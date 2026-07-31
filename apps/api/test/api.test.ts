/**
 * Integration tests against a real Postgres.
 *
 * These exercise the properties that unit tests cannot reach: webhook auth,
 * upsert idempotency under retry, rankDelta across two runs, and cold-start
 * behaviour on an empty database.
 *
 * Requires a running database (`pnpm infra:up`). Truncates Lumen's tables
 * between tests, so it refuses to run unless NODE_ENV=test.
 */
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

process.env.NODE_ENV = 'test';

const { createApp } = await import('../src/app.js');
const { db, sql, closeDb } = await import('../src/db/client.js');
const { crises } = await import('../src/db/schema.js');
const { env } = await import('../src/env.js');

let server: Server;
let baseUrl: string;

const SECRET = env.N8N_WEBHOOK_SECRET;
const TODAY = new Date().toISOString().slice(0, 10);

async function post(body: unknown, secret: string | null = SECRET) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (secret !== null) headers['x-lumen-webhook-secret'] = secret;
  const res = await fetch(`${baseUrl}/webhook/n8n-score-update`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const obs = (iso3: string, metric: string, value: number, source = 'unhcr') => ({
  iso3,
  source,
  metric,
  value,
  observedAt: TODAY,
});

beforeAll(async () => {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('Refusing to run: these tests truncate tables.');
  }
  server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closeDb();
});

beforeEach(async () => {
  // CASCADE clears observations, scores and briefs via their FKs.
  await sql`TRUNCATE crises, ingestion_runs RESTART IDENTITY CASCADE`;
  await db.insert(crises).values([
    { iso3: 'SDN', name: 'Sudan', region: 'Africa' },
    { iso3: 'UKR', name: 'Ukraine', region: 'Europe' },
    { iso3: 'TCD', name: 'Chad', region: 'Africa' },
  ]);
});

describe('GET /health', () => {
  it('reports ok when the database is reachable', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', database: 'connected' });
  });
});

describe('GET /crises — cold start', () => {
  it('returns an empty list rather than an error when nothing is scored', async () => {
    const res = await fetch(`${baseUrl}/crises`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: [], scoredFor: null, count: 0 });
  });
});

describe('POST /webhook/n8n-score-update — auth', () => {
  it('rejects a request with no secret', async () => {
    expect((await post({ source: 'unhcr', observations: [] }, null)).status).toBe(401);
  });

  it('rejects a wrong secret', async () => {
    expect((await post({ source: 'unhcr', observations: [] }, 'nope')).status).toBe(401);
  });

  it('rejects a secret that is a prefix of the real one', async () => {
    // Guards the length check in the constant-time comparison.
    expect((await post({ source: 'unhcr', observations: [] }, SECRET.slice(0, -1))).status).toBe(
      401,
    );
  });

  it('accepts the correct secret', async () => {
    expect((await post({ source: 'unhcr', observations: [] })).status).toBe(200);
  });
});

describe('POST /webhook/n8n-score-update — validation', () => {
  it('rejects an unknown metric', async () => {
    const res = await post({
      source: 'unhcr',
      observations: [obs('SDN', 'not_a_real_metric', 1)],
    });
    expect(res.status).toBe(400);
  });

  it('rejects a negative value', async () => {
    const res = await post({
      source: 'unhcr',
      observations: [obs('SDN', 'displaced_persons', -5)],
    });
    expect(res.status).toBe(400);
  });

  it('rejects a malformed observedAt', async () => {
    const res = await post({
      source: 'unhcr',
      observations: [{ ...obs('SDN', 'displaced_persons', 1), observedAt: '20-07-2026' }],
    });
    expect(res.status).toBe(400);
  });

  it('skips an unknown iso3 with a warning instead of failing the batch', async () => {
    const res = await post({
      source: 'unhcr',
      observations: [obs('SDN', 'displaced_persons', 100), obs('ZZZ', 'displaced_persons', 5)],
    });
    expect(res.status).toBe(200);
    expect(res.json.observationsWritten).toBe(1);
    expect(res.json.warnings.some((w: string) => w.includes('ZZZ'))).toBe(true);
  });
});

describe('POST /webhook/n8n-score-update — idempotency', () => {
  it('does not double-count when an n8n node retries the same batch', async () => {
    const batch = {
      source: 'unhcr',
      observations: [obs('SDN', 'displaced_persons', 100), obs('UKR', 'displaced_persons', 50)],
    };

    await post(batch);
    await post(batch);

    const [row] = await sql`SELECT count(*)::int AS n FROM source_observations`;
    expect(row!.n).toBe(2);
  });

  it('updates the value in place when a retry carries corrected data', async () => {
    await post({ source: 'unhcr', observations: [obs('SDN', 'displaced_persons', 100)] });
    await post({ source: 'unhcr', observations: [obs('SDN', 'displaced_persons', 999)] });

    const rows = await sql`SELECT value FROM source_observations`;
    expect(rows.length).toBe(1);
    expect(Number(rows[0]!.value)).toBe(999);
  });

  it('records every run in ingestion_runs, including retries', async () => {
    await post({ source: 'unhcr', observations: [obs('SDN', 'displaced_persons', 1)] });
    await post({ source: 'unhcr', observations: [obs('SDN', 'displaced_persons', 1)] });

    const [row] = await sql`SELECT count(*)::int AS n FROM ingestion_runs`;
    expect(row!.n).toBe(2);
  });
});

describe('scoring and ranking', () => {
  async function ingestThreeSources() {
    await post({
      source: 'unhcr',
      observations: [
        obs('SDN', 'displaced_persons', 10_000_000),
        obs('UKR', 'displaced_persons', 9_500_000),
        obs('TCD', 'displaced_persons', 1_900_000),
      ],
    });
    await post({
      source: 'fts',
      observations: [
        obs('SDN', 'appeal_funded_pct', 0.15, 'fts'),
        obs('UKR', 'appeal_funded_pct', 0.65, 'fts'),
        obs('TCD', 'appeal_funded_pct', 0.11, 'fts'),
      ],
    });
    return post({
      source: 'gdelt',
      triggerScoring: true,
      observations: [
        obs('SDN', 'coverage_volume_pct', 0.01, 'gdelt'),
        obs('UKR', 'coverage_volume_pct', 8.5, 'gdelt'),
        obs('TCD', 'coverage_volume_pct', 0.003, 'gdelt'),
      ],
    });
  }

  it('computes scores only when triggerScoring is set', async () => {
    const first = await post({
      source: 'unhcr',
      observations: [obs('SDN', 'displaced_persons', 100)],
    });
    expect(first.json.scoresComputed).toBe(0);

    const second = await post({
      source: 'unhcr',
      triggerScoring: true,
      observations: [obs('UKR', 'displaced_persons', 200)],
    });
    expect(second.json.scoresComputed).toBe(3);
  });

  it('ranks the under-reported crisis above the well-covered one', async () => {
    await ingestThreeSources();

    const res = await fetch(`${baseUrl}/crises`);
    const body = await res.json();

    expect(body.scoredFor).toBe(TODAY);
    expect(body.data[0].iso3).toBe('SDN');
    expect(body.data[0].rank).toBe(1);
    // The core property: the under-reported crisis ranks above the saturated
    // one. Ukraine's absolute score is not asserted — it is 65% funded, so the
    // v1.1.0 additive bonus can lift it slightly positive.
    const sdn = body.data.find((c: { iso3: string }) => c.iso3 === 'SDN');
    const ukr = body.data.find((c: { iso3: string }) => c.iso3 === 'UKR');
    expect(sdn.latestScore.attentionGapScore).toBeGreaterThan(
      ukr.latestScore.attentionGapScore,
    );
    expect(ukr.rank).toBeGreaterThan(sdn.rank);
  });

  it('returns null rankDelta on the first run', async () => {
    await ingestThreeSources();
    const body = await (await fetch(`${baseUrl}/crises`)).json();
    for (const c of body.data) expect(c.rankDelta).toBeNull();
  });

  it('computes rankDelta once a previous run exists', async () => {
    await ingestThreeSources();
    // Backdate to yesterday and demote Sudan, so there is real movement.
    await sql`UPDATE crisis_scores SET scored_for = scored_for - 1`;
    await sql`UPDATE crisis_scores SET attention_gap_score = -0.9
              WHERE crisis_id = (SELECT id FROM crises WHERE iso3 = 'SDN')`;
    await ingestThreeSources();

    const body = await (await fetch(`${baseUrl}/crises`)).json();
    const sdn = body.data.find((c: { iso3: string }) => c.iso3 === 'SDN');
    expect(sdn.rank).toBe(1);
    // Was last of three yesterday, first today.
    expect(sdn.rankDelta).toBe(2);
  });

  it('re-scoring the same day replaces rather than duplicating', async () => {
    await ingestThreeSources();
    await ingestThreeSources();

    const [row] = await sql`SELECT count(*)::int AS n FROM crisis_scores`;
    expect(row!.n).toBe(3);
  });

  it('persists inputs so every score is explainable', async () => {
    await ingestThreeSources();
    const rows = await sql`SELECT inputs FROM crisis_scores LIMIT 1`;
    expect(rows[0]!.inputs).toHaveProperty('cohortSize');
    expect(rows[0]!.inputs).toHaveProperty('normalized');
  });
});

describe('GET /crises/:id', () => {
  it('404s for an unknown crisis', async () => {
    expect((await fetch(`${baseUrl}/crises/XXX`)).status).toBe(404);
  });

  it('404s with an explanatory message for a known but unscored crisis', async () => {
    const res = await fetch(`${baseUrl}/crises/SDN`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.message).toContain('not been scored');
  });

  it('returns detail by iso3, case-insensitively', async () => {
    await post({
      source: 'unhcr',
      triggerScoring: true,
      observations: [obs('SDN', 'displaced_persons', 100)],
    });

    const res = await fetch(`${baseUrl}/crises/sdn`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.iso3).toBe('SDN');
    expect(body.data.history.length).toBeGreaterThan(0);
    expect(body.data.latestObservations[0].metric).toBe('displaced_persons');
  });

  it('returns detail by uuid', async () => {
    await post({
      source: 'unhcr',
      triggerScoring: true,
      observations: [obs('SDN', 'displaced_persons', 100)],
    });

    const [row] = await sql`SELECT id FROM crises WHERE iso3 = 'SDN'`;
    const res = await fetch(`${baseUrl}/crises/${row!.id}`);
    expect(res.status).toBe(200);
    expect((await res.json()).data.iso3).toBe('SDN');
  });
});

describe('brief generation and delivery', () => {
  async function createScore() {
    await post({
      source: 'unhcr',
      triggerScoring: true,
      observations: [obs('SDN', 'displaced_persons', 12_900_000)],
    });
  }

  async function briefRequest(
    path: string,
    body: unknown,
    secret: string | null = SECRET,
  ) {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (secret !== null) headers['x-lumen-admin-secret'] = secret;
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    return { status: response.status, json: await response.json() };
  }

  it('protects brief write routes with the admin secret', async () => {
    const response = await briefRequest(
      '/briefs/generate',
      { crisisId: 'SDN', forceTemplate: true },
      null,
    );
    expect(response.status).toBe(401);
  });

  it('generates a grounded template linked to the exact score row', async () => {
    await createScore();
    const response = await briefRequest('/briefs/generate', {
      crisisId: 'SDN',
      audience: 'journalist',
      forceTemplate: true,
    });

    expect(response.status).toBe(201);
    expect(response.json.usedFallback).toBe(true);
    expect(response.json.data.model).toBe('lumen-template-v1');
    expect(response.json.data.scoreId).not.toBeNull();
    expect(response.json.data.content).toContain('Sudan (SDN)');
    expect(response.json.data.content).toContain('12.9M displaced people');

    const detail = await (await fetch(`${baseUrl}/crises/SDN`)).json();
    expect(detail.data.briefs).toHaveLength(1);
    expect(detail.data.briefs[0].scoreId).toBe(response.json.data.scoreId);
  });

  it('reports unconfigured delivery channels as skipped instead of crashing', async () => {
    await createScore();
    const generated = await briefRequest('/briefs/generate', {
      crisisId: 'SDN',
      forceTemplate: true,
    });
    const delivered = await briefRequest(`/briefs/${generated.json.data.id}/deliver`, {
      channels: ['telegram', 'email'],
    });

    expect(delivered.status).toBe(200);
    expect(delivered.json.data.map((item: { status: string }) => item.status)).toEqual([
      'skipped',
      'skipped',
    ]);
  });

  it('runs brief generation and returns one combined digest delivery result', async () => {
    await createScore();
    const response = await briefRequest('/briefs/run', {
      limit: 1,
      forceTemplate: true,
      channels: [],
    });
    expect(response.status).toBe(201);
    expect(response.json.data).toHaveLength(1);
    expect(response.json.data[0].iso3).toBe('SDN');
    expect(response.json.data[0].rank).toBe(1);
    expect(response.json.delivery).toEqual([]);
    expect(response.json.scoredFor).toBe(TODAY);
  });

  it('defaults to a multi-crisis daily digest instead of a single crisis', async () => {
    await createScore();
    const response = await briefRequest('/briefs/run', {
      forceTemplate: true,
      channels: [],
    });

    expect(response.status).toBe(201);
    expect(response.json.data).toHaveLength(3);
    expect(response.json.data.map((item: { rank: number }) => item.rank)).toEqual([1, 2, 3]);
  });
});

describe('unknown routes', () => {
  it('404s with a structured error body', async () => {
    const res = await fetch(`${baseUrl}/nope`);
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('not_found');
  });
});
