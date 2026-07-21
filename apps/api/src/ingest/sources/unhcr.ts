import type { ObservationInput } from '@lumen/shared-types';
import { fetchJson } from '../http.js';
import type { ParseResult, SourceAdapter } from './types.js';

interface UnhcrRow {
  year: number;
  coo_iso: string;
  coa_iso: string;
  refugees?: number | string;
  asylum_seekers?: number | string;
  idps?: number | string;
  ooc?: number | string;
  stateless?: number | string;
}

interface UnhcrResponse {
  items?: UnhcrRow[];
}

// Categories summed into one displacement figure per country.
const CATEGORIES = ['refugees', 'asylum_seekers', 'idps', 'ooc', 'stateless'] as const;

const toNum = (v: number | string | undefined): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * Aggregate UNHCR rows into displacement per country, grouped by **country of
 * origin** (coo).
 *
 * This is a deliberate change from the original n8n workflow, which grouped by
 * country of asylum. Asylum-country totals measure who *hosts* refugees;
 * origin-country totals measure who is *displaced by* a crisis, which is the
 * severity signal this product ranks on. IDPs are internal, so their origin and
 * asylum coincide and they land on the right country either way.
 *
 * Pure: no I/O. Keeps only the most recent year present per country, since the
 * endpoint can return two years at once.
 */
export function parseUnhcr(body: UnhcrResponse, observedAt: string): ParseResult {
  const rows = body.items;
  if (!Array.isArray(rows)) {
    throw new Error('UNHCR returned an unexpected shape — no items array present.');
  }

  const latestYear = new Map<string, number>();
  for (const row of rows) {
    const iso3 = String(row.coo_iso ?? '').toUpperCase();
    const year = Number(row.year);
    if (iso3.length !== 3 || iso3 === '---' || !Number.isFinite(year)) continue;
    const seen = latestYear.get(iso3);
    if (seen === undefined || year > seen) latestYear.set(iso3, year);
  }

  const totals = new Map<string, number>();
  for (const row of rows) {
    const iso3 = String(row.coo_iso ?? '').toUpperCase();
    if (iso3.length !== 3 || iso3 === '---') continue;
    if (Number(row.year) !== latestYear.get(iso3)) continue;

    let sum = 0;
    for (const c of CATEGORIES) sum += toNum(row[c]);
    totals.set(iso3, (totals.get(iso3) ?? 0) + sum);
  }

  const observations: ObservationInput[] = [...totals.entries()].map(([iso3, value]) => ({
    iso3,
    source: 'unhcr',
    metric: 'displaced_persons',
    value,
    observedAt,
  }));

  const warnings: string[] = [];
  if (observations.length === 0) warnings.push('UNHCR returned no usable country rows.');

  return { observations, warnings };
}

export const unhcrAdapter: SourceAdapter = {
  name: 'unhcr',
  async fetch({ observedAt }): Promise<ParseResult> {
    const year = new Date().getUTCFullYear();
    // coo_all groups by country of origin; a two-year window catches the latest
    // published figures, which lag by roughly a year.
    const url =
      `https://api.unhcr.org/population/v1/population/` +
      `?limit=1000&yearFrom=${year - 1}&yearTo=${year}&coo_all=true`;
    const body = await fetchJson<UnhcrResponse>(url, { timeoutMs: 45_000, backoffMs: 15_000 });
    return parseUnhcr(body, observedAt);
  },
};
