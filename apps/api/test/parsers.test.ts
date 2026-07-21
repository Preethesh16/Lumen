/**
 * Parser unit tests, driven by fixtures captured from the live APIs on
 * 2026-07-21. Pure — no database, no network — so they run anywhere and pin the
 * exact response shapes the adapters depend on. If an upstream changes shape,
 * these fail loudly instead of the pipeline silently ingesting nothing.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseUnhcr } from '../src/ingest/sources/unhcr.js';
import { parseFtsPlans, parseFtsFlow, buildFtsObservations } from '../src/ingest/sources/fts.js';
import { parseGdeltTimeline } from '../src/ingest/sources/gdelt.js';
import { parseReliefWeb } from '../src/ingest/sources/reliefweb.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (name: string) =>
  JSON.parse(readFileSync(join(fixturesDir, name), 'utf8'));

const DAY = '2026-07-21';

describe('parseUnhcr', () => {
  it('aggregates displacement by country of origin', () => {
    const { observations } = parseUnhcr(fixture('unhcr.json'), DAY);
    expect(observations.length).toBeGreaterThan(0);

    const afg = observations.find((o) => o.iso3 === 'AFG');
    expect(afg).toBeDefined();
    expect(afg!.metric).toBe('displaced_persons');
    expect(afg!.source).toBe('unhcr');
    // AFG in the fixture: 3.2M IDPs + 5.77M refugees + others — well over 8M.
    expect(afg!.value).toBeGreaterThan(8_000_000);
    expect(afg!.observedAt).toBe(DAY);
  });

  it('coerces string-typed counts to numbers', () => {
    // UNHCR returns some categories as strings ("0"); a NaN would corrupt need.
    const { observations } = parseUnhcr(fixture('unhcr.json'), DAY);
    for (const o of observations) expect(Number.isFinite(o.value)).toBe(true);
  });

  it('throws on a missing items array rather than silently ingesting nothing', () => {
    expect(() => parseUnhcr({} as never, DAY)).toThrow(/unexpected shape/);
  });

  it('skips placeholder origin codes', () => {
    const body = { items: [{ year: 2024, coo_iso: '---', coa_iso: 'x', refugees: 5 }] };
    const { observations, warnings } = parseUnhcr(body as never, DAY);
    expect(observations).toHaveLength(0);
    expect(warnings.length).toBeGreaterThan(0);
  });
});

describe('parseFtsPlans', () => {
  it('reads top-level revisedRequirements and adminLevel-0 countries', () => {
    const plans = parseFtsPlans(fixture('fts_plans.json'));
    expect(plans.length).toBeGreaterThan(0);
    for (const p of plans) {
      expect(p.requirements).toBeGreaterThan(0);
      expect(p.iso3s.every((c) => c.length === 3)).toBe(true);
    }
  });

  it('throws on a missing data array', () => {
    expect(() => parseFtsPlans({} as never)).toThrow(/unexpected shape/);
  });
});

describe('parseFtsFlow', () => {
  it('extracts report1.fundingTotals.total', () => {
    expect(parseFtsFlow(fixture('fts_flow.json'))).toBeGreaterThan(0);
  });

  it('returns null when the funding path is absent', () => {
    expect(parseFtsFlow({} as never)).toBeNull();
  });
});

describe('buildFtsObservations', () => {
  it('emits requirements always and funded_pct only when funding is known', () => {
    const plans = [
      { planId: 1, requirements: 1_000_000, iso3s: ['SDN'] },
      { planId: 2, requirements: 500_000, iso3s: ['TCD'] },
    ];
    const funding = new Map<number, number | null>([
      [1, 250_000],
      [2, null], // funding lookup failed for this plan
    ]);

    const { observations, warnings } = buildFtsObservations(plans, funding, DAY);

    const sdnFunded = observations.find(
      (o) => o.iso3 === 'SDN' && o.metric === 'appeal_funded_pct',
    );
    expect(sdnFunded!.value).toBeCloseTo(0.25, 5);

    // TCD's funding lookup failed — it must get requirements but NOT a funded_pct
    // of 0, which would read as "completely unfunded".
    const tcdReq = observations.find(
      (o) => o.iso3 === 'TCD' && o.metric === 'appeal_requirements_usd',
    );
    const tcdFunded = observations.find(
      (o) => o.iso3 === 'TCD' && o.metric === 'appeal_funded_pct',
    );
    expect(tcdReq).toBeDefined();
    expect(tcdFunded).toBeUndefined();
    expect(warnings.some((w) => w.includes('2'))).toBe(true);
  });

  it('attributes a multi-country plan fully to each member', () => {
    const plans = [{ planId: 1, requirements: 900_000, iso3s: ['IRN', 'PAK'] }];
    const funding = new Map<number, number | null>([[1, 450_000]]);
    const { observations } = buildFtsObservations(plans, funding, DAY);

    const reqs = observations.filter((o) => o.metric === 'appeal_requirements_usd');
    expect(reqs).toHaveLength(2);
    for (const r of reqs) expect(r.value).toBe(900_000);
  });

  it('clamps funded_pct into 0..1 when an appeal is over-funded', () => {
    const plans = [{ planId: 1, requirements: 100, iso3s: ['SDN'] }];
    const funding = new Map<number, number | null>([[1, 150]]);
    const { observations } = buildFtsObservations(plans, funding, DAY);
    const funded = observations.find((o) => o.metric === 'appeal_funded_pct');
    expect(funded!.value).toBe(1);
  });
});

describe('parseGdeltTimeline', () => {
  it('takes the most recent value from the series', () => {
    expect(parseGdeltTimeline(fixture('gdelt.json'))).toBe(0.0135);
  });

  it('returns null for an empty or missing series (throttled/no data)', () => {
    expect(parseGdeltTimeline({})).toBeNull();
    expect(parseGdeltTimeline({ timeline: [{ data: [] }] })).toBeNull();
  });

  it('returns null rather than NaN for a non-numeric value', () => {
    expect(
      parseGdeltTimeline({ timeline: [{ data: [{ date: 'x', value: NaN }] }] }),
    ).toBeNull();
  });
});

describe('parseReliefWeb', () => {
  it('counts ongoing disasters per country', () => {
    const body = {
      data: [
        { fields: { country: [{ iso3: 'SDN' }, { iso3: 'TCD' }] } },
        { fields: { country: [{ iso3: 'sdn' }] } },
      ],
    };
    const { observations } = parseReliefWeb(body as never, DAY);
    const sdn = observations.find((o) => o.iso3 === 'SDN');
    expect(sdn!.value).toBe(2);
    expect(sdn!.metric).toBe('active_disaster_count');
  });

  it('throws a clear error on an access-denied body', () => {
    expect(() =>
      parseReliefWeb({ error: { type: 'AccessDeniedHttpException' } } as never, DAY),
    ).toThrow(/appname/);
  });
});
