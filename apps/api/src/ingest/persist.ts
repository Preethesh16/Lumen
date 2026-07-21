import { eq, inArray, sql as raw } from 'drizzle-orm';
import type { ObservationInput, ScoreUpdateResponse, SourceName } from '@lumen/shared-types';
import { ALGORITHM_VERSION, scoreCohort, type CohortMember } from '@lumen/scoring';
import { db } from '../db/client.js';
import { crises, crisisScores, ingestionRuns, sourceObservations } from '../db/schema.js';

/**
 * Persist a batch of observations from one source, idempotently, and optionally
 * recompute scores.
 *
 * This is the single write path into `source_observations`. Both the n8n
 * webhook and the in-process ingestion runner call it, so upsert semantics,
 * run bookkeeping, and unknown-country handling live in exactly one place.
 */
export async function persistObservations(args: {
  source: SourceName;
  observations: ObservationInput[];
  triggerScoring?: boolean;
}): Promise<ScoreUpdateResponse> {
  const { source, observations, triggerScoring = false } = args;
  const warnings: string[] = [];

  const [run] = await db
    .insert(ingestionRuns)
    .values({ source, status: 'running' })
    .returning();
  const runId = run!.id;

  try {
    // Resolve ISO3 -> crisis id in one query rather than per observation.
    const iso3s = [...new Set(observations.map((o) => o.iso3.toUpperCase()))];
    const known =
      iso3s.length === 0
        ? []
        : await db
            .select({ id: crises.id, iso3: crises.iso3 })
            .from(crises)
            .where(inArray(crises.iso3, iso3s));

    const idByIso3 = new Map(known.map((c) => [c.iso3, c.id]));

    const rows = [];
    for (const obs of observations) {
      const iso3 = obs.iso3.toUpperCase();
      const crisisId = idByIso3.get(iso3);
      if (!crisisId) {
        // An unknown country is a data-quality signal, not a failure: sources
        // disagree about which countries have active crises. Skip and report.
        warnings.push(`Unknown iso3 "${iso3}" — observation skipped`);
        continue;
      }
      rows.push({
        crisisId,
        source,
        metric: obs.metric,
        value: String(obs.value),
        observedAt: obs.observedAt,
        runId,
        raw: obs.raw === undefined ? null : (obs.raw as object),
      });
    }

    if (rows.length > 0) {
      await db
        .insert(sourceObservations)
        .values(rows)
        .onConflictDoUpdate({
          target: [
            sourceObservations.crisisId,
            sourceObservations.source,
            sourceObservations.metric,
            sourceObservations.observedAt,
          ],
          set: {
            value: raw`excluded.value`,
            fetchedAt: raw`now()`,
            runId: raw`excluded.run_id`,
            raw: raw`excluded.raw`,
          },
        });
    }

    let scoresComputed = 0;
    if (triggerScoring) {
      const result = await recomputeScores();
      scoresComputed = result.scoresComputed;
      warnings.push(...result.warnings);
    }

    await db
      .update(ingestionRuns)
      .set({
        status: warnings.length > 0 ? 'partial' : 'success',
        finishedAt: new Date(),
        recordsWritten: rows.length,
      })
      .where(eq(ingestionRuns.id, runId));

    return { runId, observationsWritten: rows.length, scoresComputed, warnings };
  } catch (error) {
    // Mark the run failed before rethrowing, so a crash is visible in
    // ingestion_runs rather than leaving a row stuck at 'running'.
    await db
      .update(ingestionRuns)
      .set({
        status: 'failed',
        finishedAt: new Date(),
        error: error instanceof Error ? error.message : String(error),
      })
      .where(eq(ingestionRuns.id, runId))
      .catch(() => {});
    throw error;
  }
}

/**
 * Recompute today's scores for every active crisis from stored observations.
 *
 * Reads only the latest observation per (crisis, metric) within a 14-day
 * window — sources update on different cadences, so requiring same-day data
 * from all four would score almost nothing.
 */
export async function recomputeScores(
  scoredFor: string = new Date().toISOString().slice(0, 10),
): Promise<{ scoresComputed: number; warnings: string[] }> {
  const active = await db.select().from(crises).where(eq(crises.isActive, true));
  if (active.length === 0) {
    return { scoresComputed: 0, warnings: ['No active crises to score'] };
  }

  const latestPerMetric = await db.execute<{
    crisis_id: string;
    metric: string;
    value: string;
  }>(raw`
    SELECT DISTINCT ON (crisis_id, metric)
      crisis_id, metric, value
    FROM source_observations
    WHERE observed_at >= (${scoredFor}::date - INTERVAL '14 days')
      AND observed_at <= ${scoredFor}::date
    ORDER BY crisis_id, metric, observed_at DESC
  `);

  const byCrisis = new Map<string, Record<string, number>>();
  for (const row of latestPerMetric) {
    const existing = byCrisis.get(row.crisis_id) ?? {};
    existing[row.metric] = Number(row.value);
    byCrisis.set(row.crisis_id, existing);
  }

  const cohort: CohortMember[] = active.map((crisis) => ({
    crisisId: crisis.id,
    iso3: crisis.iso3,
    observations: byCrisis.get(crisis.id) ?? {},
  }));

  const results = scoreCohort(cohort);
  if (results.length === 0) return { scoresComputed: 0, warnings: [] };

  await db
    .insert(crisisScores)
    .values(
      results.map((r) => ({
        crisisId: r.crisisId,
        needScore: r.needScore.toFixed(4),
        coverageScore: r.coverageScore.toFixed(4),
        fundingGapPct: r.fundingGapPct === null ? null : r.fundingGapPct.toFixed(4),
        attentionGapScore: r.attentionGapScore.toFixed(4),
        algorithmVersion: ALGORITHM_VERSION,
        inputs: r.inputs,
        scoredFor,
      })),
    )
    // Re-running the same day replaces that day's scores rather than erroring,
    // so a manual re-run after fixing bad data is a safe operation.
    .onConflictDoUpdate({
      target: [crisisScores.crisisId, crisisScores.scoredFor, crisisScores.algorithmVersion],
      set: {
        needScore: raw`excluded.need_score`,
        coverageScore: raw`excluded.coverage_score`,
        fundingGapPct: raw`excluded.funding_gap_pct`,
        attentionGapScore: raw`excluded.attention_gap_score`,
        inputs: raw`excluded.inputs`,
        computedAt: raw`now()`,
      },
    });

  return {
    scoresComputed: results.length,
    warnings: results.flatMap((r) => r.warnings),
  };
}
