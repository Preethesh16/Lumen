import type { ObservationInput, SourceName } from '@lumen/shared-types';

export interface ParseResult {
  observations: ObservationInput[];
  /** Non-fatal data-quality notes (skipped countries, throttled queries). */
  warnings: string[];
}

export interface SourceAdapter {
  name: SourceName;
  /**
   * Fetch from the live API and parse to observations. `iso3s` is the cohort
   * to fetch for sources that query per-country (GDELT); ignored by sources
   * that return all countries in one call.
   */
  fetch(args: { observedAt: string; iso3s: string[] }): Promise<ParseResult>;
}

/** Today in UTC as YYYY-MM-DD — the default observedAt for a live run. */
export const todayUtc = (): string => new Date().toISOString().slice(0, 10);
