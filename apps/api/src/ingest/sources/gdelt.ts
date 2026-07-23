import type { ObservationInput } from '@lumen/shared-types';
import { fetchJson } from '../http.js';
import type { ParseResult, SourceAdapter } from './types.js';

interface GdeltTimeline {
  timeline?: { data?: { date: string; value: number }[] }[];
}

/** ISO3 -> GDELT's 2-letter FIPS-ish source-country code. */
const GDELT_COUNTRY: Record<string, string> = {
  AFG: 'AF', BFA: 'UV', CAF: 'CT', CMR: 'CM', COD: 'CG', COL: 'CO', ETH: 'ET',
  HTI: 'HA', IRQ: 'IZ', LBN: 'LE', LBY: 'LY', MLI: 'ML', MMR: 'BM', MOZ: 'MZ',
  NER: 'NG', NGA: 'NI', PSE: 'WE', SDN: 'SU', SOM: 'SO', SSD: 'OD', SYR: 'SY',
  TCD: 'CD', UKR: 'UP', VEN: 'VE', YEM: 'YM', ZWE: 'ZI',
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MAX_CONSECUTIVE_FAILURES = 3;

/**
 * Parse a GDELT timelinevol response into a single coverage value.
 *
 * GDELT returns HTML or an empty body when throttled; `fetchJson` already
 * retries those, but a genuinely empty series still reaches here and must be
 * reported as "no data", not scored as zero coverage. Pure: no I/O.
 */
export function parseGdeltTimeline(body: GdeltTimeline): number | null {
  const series = body.timeline?.[0]?.data;
  if (!Array.isArray(series) || series.length === 0) return null;
  const value = Number(series[series.length - 1]?.value);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export const gdeltAdapter: SourceAdapter = {
  name: 'gdelt',
  /**
   * GDELT has no bulk endpoint and enforces one request per 5 seconds (verified
   * live — it returns a plain-text warning, not JSON, when exceeded), so this
   * fetches one country at a time with a 6-second gap. A country that yields no
   * usable series is skipped with a warning rather than failing the batch.
   */
  async fetch({ observedAt, iso3s }): Promise<ParseResult> {
    const observations: ObservationInput[] = [];
    const warnings: string[] = [];
    let consecutiveFailures = 0;

    for (let i = 0; i < iso3s.length; i++) {
      const iso3 = iso3s[i]!.toUpperCase();
      const code = GDELT_COUNTRY[iso3];
      if (!code) {
        warnings.push(`GDELT: no source-country code for ${iso3} — skipped`);
        continue;
      }

      if (i > 0) await sleep(6_000);

      try {
        const url =
          `https://api.gdeltproject.org/api/v2/doc/doc` +
          `?query=sourcecountry:${code}&mode=timelinevol&timespan=1d&format=json`;
        const body = await fetchJson<GdeltTimeline>(url, {
          // Bound an unavailable GDELT run so the scheduler can still score
          // and deliver a brief from UNHCR/FTS data within its HTTP timeout.
          timeoutMs: 12_000,
          backoffMs: 6_000,
          maxRetries: 1,
        });
        consecutiveFailures = 0;
        const value = parseGdeltTimeline(body);
        if (value === null) {
          warnings.push(`GDELT: no usable series for ${iso3}`);
          continue;
        }
        observations.push({
          iso3,
          source: 'gdelt',
          metric: 'coverage_volume_pct',
          value,
          observedAt,
        });
      } catch (error) {
        consecutiveFailures++;
        warnings.push(
          `GDELT: fetch failed for ${iso3} — ${error instanceof Error ? error.message : error}`,
        );
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          const remaining = iso3s.length - i - 1;
          warnings.push(
            `GDELT: stopped after ${MAX_CONSECUTIVE_FAILURES} consecutive failures; ` +
              `${remaining} remaining countries skipped`,
          );
          break;
        }
      }
    }

    if (observations.length === 0) {
      warnings.push('GDELT returned no usable data for any country — likely throttled.');
    }
    return { observations, warnings };
  },
};
