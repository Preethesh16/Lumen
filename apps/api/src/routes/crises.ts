import { desc, eq, lt } from 'drizzle-orm';
import { Router } from 'express';
import type {
  CrisisDetail,
  CrisisScore,
  GetCrisisResponse,
  ListCrisesResponse,
  ObservationMetric,
  ObservationPoint,
  RankedCrisis,
  ScoreHistoryPoint,
  SourceName,
} from '@lumen/shared-types';
import { db } from '../db/client.js';
import { briefs, crises, crisisScores, sourceObservations } from '../db/schema.js';
import { asyncHandler, notFound } from '../lib/errors.js';
import type { ScoreRow } from '../db/schema.js';

export const crisesRouter: Router = Router();

/** numeric columns come back as strings from postgres.js — parse at the edge. */
const num = (v: string | null): number | null => (v === null ? null : Number(v));

function toCrisisScore(row: ScoreRow): CrisisScore {
  return {
    id: String(row.id),
    crisisId: row.crisisId,
    needScore: Number(row.needScore),
    coverageScore: Number(row.coverageScore),
    fundingGapPct: num(row.fundingGapPct),
    attentionGapScore: Number(row.attentionGapScore),
    algorithmVersion: row.algorithmVersion,
    scoredFor: row.scoredFor,
    computedAt: row.computedAt.toISOString(),
  };
}

/** The most recent day any score was computed for. Null on an empty database. */
async function latestScoredFor(): Promise<string | null> {
  const [row] = await db
    .select({ scoredFor: crisisScores.scoredFor })
    .from(crisisScores)
    .orderBy(desc(crisisScores.scoredFor))
    .limit(1);
  return row?.scoredFor ?? null;
}

/**
 * GET /crises — crises ranked by attention gap, most under-reported first.
 *
 * Serves the latest scored day rather than "today": if the daily n8n run
 * hasn't fired yet, showing yesterday's ranking is far more useful than an
 * empty list.
 */
crisesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);

    const scoredFor = await latestScoredFor();
    if (scoredFor === null) {
      // Cold start: no ingestion has run yet. An empty list is the correct
      // answer, not an error — the dashboard renders an empty state.
      const body: ListCrisesResponse = { data: [], scoredFor: null, count: 0 };
      res.json(body);
      return;
    }

    const current = await db
      .select({ crisis: crises, score: crisisScores })
      .from(crisisScores)
      .innerJoin(crises, eq(crises.id, crisisScores.crisisId))
      .where(eq(crisisScores.scoredFor, scoredFor))
      .orderBy(desc(crisisScores.attentionGapScore), crises.iso3)
      .limit(limit);

    // Previous run, for rankDelta. Computed server-side because it needs the
    // prior ordering, which is awkward to derive in the browser.
    const [previousDay] = await db
      .select({ scoredFor: crisisScores.scoredFor })
      .from(crisisScores)
      .where(lt(crisisScores.scoredFor, scoredFor))
      .orderBy(desc(crisisScores.scoredFor))
      .limit(1);

    const previousRanks = new Map<string, number>();
    if (previousDay) {
      const prior = await db
        .select({
          crisisId: crisisScores.crisisId,
          iso3: crises.iso3,
          gap: crisisScores.attentionGapScore,
        })
        .from(crisisScores)
        .innerJoin(crises, eq(crises.id, crisisScores.crisisId))
        .where(eq(crisisScores.scoredFor, previousDay.scoredFor))
        .orderBy(desc(crisisScores.attentionGapScore), crises.iso3);

      prior.forEach((row, i) => previousRanks.set(row.crisisId, i + 1));
    }

    const data: RankedCrisis[] = current.map((row, i) => {
      const rank = i + 1;
      const previousRank = previousRanks.get(row.crisis.id);
      return {
        id: row.crisis.id,
        iso3: row.crisis.iso3,
        name: row.crisis.name,
        region: row.crisis.region,
        isActive: row.crisis.isActive,
        latestScore: toCrisisScore(row.score),
        rank,
        // Positive means climbing toward more under-reported.
        rankDelta: previousRank === undefined ? null : previousRank - rank,
      };
    });

    const body: ListCrisesResponse = { data, scoredFor, count: data.length };
    res.json(body);
  }),
);

/**
 * GET /crises/:id — one crisis with score history and the observations behind
 * its latest score. Accepts a UUID or an ISO3 code, since ISO3 is what a human
 * reading the dashboard actually knows.
 */
crisesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    if (typeof id !== 'string' || id.length === 0) {
      throw notFound('No crisis identifier supplied');
    }
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

    const [crisis] = await db
      .select()
      .from(crises)
      .where(isUuid ? eq(crises.id, id) : eq(crises.iso3, id.toUpperCase()))
      .limit(1);

    if (!crisis) throw notFound(`No crisis found for "${id}"`);

    const historyRows = await db
      .select()
      .from(crisisScores)
      .where(eq(crisisScores.crisisId, crisis.id))
      .orderBy(desc(crisisScores.scoredFor))
      .limit(90);

    const latest = historyRows[0];
    if (!latest) {
      throw notFound(
        `Crisis "${crisis.iso3}" exists but has not been scored yet — ` +
          'no ingestion run has completed for it.',
      );
    }

    // Chronological for charting; the query above is newest-first for `latest`.
    const history: ScoreHistoryPoint[] = historyRows
      .slice()
      .reverse()
      .map((row) => ({
        scoredFor: row.scoredFor,
        needScore: Number(row.needScore),
        coverageScore: Number(row.coverageScore),
        attentionGapScore: Number(row.attentionGapScore),
      }));

    const observationRows = await db
      .select()
      .from(sourceObservations)
      .where(eq(sourceObservations.crisisId, crisis.id))
      .orderBy(desc(sourceObservations.observedAt))
      .limit(40);

    // Most recent reading per metric — the raw numbers behind the score.
    const seen = new Set<string>();
    const latestObservations: ObservationPoint[] = [];
    for (const row of observationRows) {
      if (seen.has(row.metric)) continue;
      seen.add(row.metric);
      latestObservations.push({
        source: row.source as SourceName,
        metric: row.metric as ObservationMetric,
        value: Number(row.value),
        observedAt: row.observedAt,
      });
    }

    const briefRows = await db
      .select()
      .from(briefs)
      .where(eq(briefs.crisisId, crisis.id))
      .orderBy(desc(briefs.generatedAt))
      .limit(12);

    const data: CrisisDetail = {
      id: crisis.id,
      iso3: crisis.iso3,
      name: crisis.name,
      region: crisis.region,
      isActive: crisis.isActive,
      latestScore: toCrisisScore(latest),
      history,
      latestObservations,
      briefs: briefRows.map((b) => ({
        id: b.id,
        crisisId: b.crisisId,
        scoreId: b.scoreId === null ? null : String(b.scoreId),
        audience: b.audience,
        content: b.content,
        model: b.model,
        promptVersion: b.promptVersion,
        generatedAt: b.generatedAt.toISOString(),
      })),
    };

    const body: GetCrisisResponse = { data };
    res.json(body);
  }),
);
