import { eq } from 'drizzle-orm';
import type { SourceName } from '@lumen/shared-types';
import { db } from '../db/client.js';
import { crises } from '../db/schema.js';
import { gdeltAdapter } from './sources/gdelt.js';
import { unhcrAdapter } from './sources/unhcr.js';
import { ftsAdapter } from './sources/fts.js';
import { reliefwebAdapter } from './sources/reliefweb.js';
import { todayUtc, type SourceAdapter } from './sources/types.js';
import { persistObservations } from './persist.js';

const ADAPTERS: Record<SourceName, SourceAdapter> = {
  gdelt: gdeltAdapter,
  unhcr: unhcrAdapter,
  fts: ftsAdapter,
  reliefweb: reliefwebAdapter,
};

export interface IngestResult {
  source: SourceName;
  ok: boolean;
  observationsWritten: number;
  scoresComputed: number;
  warnings: string[];
  error?: string;
}

/** Active-crisis ISO3 cohort — the set GDELT queries per country. */
async function activeCohort(): Promise<string[]> {
  const rows = await db
    .select({ iso3: crises.iso3 })
    .from(crises)
    .where(eq(crises.isActive, true));
  return rows.map((r) => r.iso3);
}

/**
 * Fetch one source, persist its observations, and optionally trigger scoring.
 *
 * A source failure is captured and returned, never thrown — one dead upstream
 * must not abort a multi-source run. Scoring is the caller's decision so a
 * partial run does not score on incomplete data.
 */
export async function ingestSource(
  source: SourceName,
  opts: { triggerScoring?: boolean; observedAt?: string; iso3s?: string[] } = {},
): Promise<IngestResult> {
  const observedAt = opts.observedAt ?? todayUtc();
  try {
    const iso3s = opts.iso3s ?? (source === 'gdelt' ? await activeCohort() : []);
    const { observations, warnings } = await ADAPTERS[source].fetch({ observedAt, iso3s });

    const result = await persistObservations({
      source,
      observations,
      triggerScoring: opts.triggerScoring ?? false,
    });

    return {
      source,
      ok: true,
      observationsWritten: result.observationsWritten,
      scoresComputed: result.scoresComputed,
      warnings: [...warnings, ...result.warnings],
    };
  } catch (error) {
    return {
      source,
      ok: false,
      observationsWritten: 0,
      scoresComputed: 0,
      warnings: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Run every source in sequence, scoring once at the end on the combined data.
 *
 * ReliefWeb is included but will fail cleanly until its appname is registered;
 * the other three still produce a full ranking.
 */
export async function ingestAll(
  order: SourceName[] = ['unhcr', 'fts', 'reliefweb', 'gdelt'],
): Promise<IngestResult[]> {
  const results: IngestResult[] = [];
  for (let i = 0; i < order.length; i++) {
    const isLast = i === order.length - 1;
    results.push(await ingestSource(order[i]!, { triggerScoring: isLast }));
  }
  return results;
}
