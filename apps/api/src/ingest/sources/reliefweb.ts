import type { ObservationInput } from '@lumen/shared-types';
import { fetchJson, HttpError } from '../http.js';
import type { ParseResult, SourceAdapter } from './types.js';

interface ReliefWebEntry {
  fields?: { country?: { iso3?: string }[] };
}
interface ReliefWebResponse {
  data?: ReliefWebEntry[];
  error?: { type?: string };
}

/**
 * Aggregate ongoing disasters into an active-disaster count per country.
 * Pure: no I/O.
 */
export function parseReliefWeb(body: ReliefWebResponse, observedAt: string): ParseResult {
  if (body.error?.type === 'AccessDeniedHttpException') {
    throw new Error(
      'ReliefWeb rejected the appname. It must be registered at ' +
        'https://apidoc.reliefweb.int/parameters#appname',
    );
  }

  const entries = body.data;
  if (!Array.isArray(entries)) {
    throw new Error('ReliefWeb returned an unexpected shape — no data array present.');
  }

  const counts = new Map<string, number>();
  for (const entry of entries) {
    for (const country of entry.fields?.country ?? []) {
      const iso3 = String(country.iso3 ?? '').toUpperCase();
      if (iso3.length !== 3) continue;
      counts.set(iso3, (counts.get(iso3) ?? 0) + 1);
    }
  }

  const observations: ObservationInput[] = [...counts.entries()].map(([iso3, value]) => ({
    iso3,
    source: 'reliefweb',
    metric: 'active_disaster_count',
    value,
    observedAt,
  }));

  const warnings: string[] = [];
  if (observations.length === 0) {
    warnings.push('ReliefWeb returned no disasters with a usable ISO3 code.');
  }
  return { observations, warnings };
}

export const reliefwebAdapter: SourceAdapter = {
  name: 'reliefweb',
  async fetch({ observedAt }): Promise<ParseResult> {
    const appname = process.env.RELIEFWEB_APPNAME;
    if (!appname || appname === 'lumen-crisis-monitor') {
      // Guard against the placeholder: an unregistered appname 403s, and a clear
      // message here beats a confusing HTTP error deep in the run.
      throw new Error(
        'RELIEFWEB_APPNAME is unset or still the placeholder. Register one at ' +
          'https://apidoc.reliefweb.int/parameters#appname before running this source.',
      );
    }

    const url =
      `https://api.reliefweb.int/v2/disasters` +
      `?appname=${encodeURIComponent(appname)}&profile=list&preset=latest&limit=500` +
      `&filter[field]=status&filter[value]=ongoing`;

    try {
      const body = await fetchJson<ReliefWebResponse>(url, { timeoutMs: 30_000 });
      return parseReliefWeb(body, observedAt);
    } catch (error) {
      if (error instanceof HttpError && error.status === 403) {
        throw new Error(
          `ReliefWeb rejected appname "${appname}" (403). Register it at ` +
            'https://apidoc.reliefweb.int/parameters#appname',
        );
      }
      throw error;
    }
  },
};
