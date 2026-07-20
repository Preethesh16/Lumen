import type {
  CrisisDetail,
  CrisisScore,
  ListCrisesResponse,
  ObservationPoint,
  RankedCrisis,
  ScoreHistoryPoint,
} from '@lumen/shared-types';

/**
 * Placeholder data for running the dashboard without the API.
 *
 * The figures are illustrative and always labelled as such in the UI. They are
 * shaped like real responses — including a crisis with no OCHA appeal and one
 * with a negative gap — so the views get exercised against the awkward cases
 * rather than only the tidy one.
 */

const SCORED_FOR = '2026-07-19';

function score(
  crisisId: string,
  needScore: number,
  coverageScore: number,
  fundingGapPct: number | null,
): CrisisScore {
  // Mirrors the real formula's shape: the gap is amplified by underfunding,
  // which is why it exceeds the raw difference and is not bounded at 1.
  const raw = needScore - coverageScore;
  const amplified = fundingGapPct === null ? raw : raw * (1 + fundingGapPct * 0.85);

  return {
    id: `score-${crisisId}`,
    crisisId,
    needScore,
    coverageScore,
    fundingGapPct,
    attentionGapScore: Number(amplified.toFixed(3)),
    algorithmVersion: 'mock-v1',
    scoredFor: SCORED_FOR,
    computedAt: `${SCORED_FOR}T06:00:00.000Z`,
  };
}

interface Seed {
  id: string;
  iso3: string;
  name: string;
  region: string;
  need: number;
  coverage: number;
  funding: number | null;
  rankDelta: number | null;
}

const SEEDS: Seed[] = [
  {
    id: 'sdn',
    iso3: 'SDN',
    name: 'Sudan',
    region: 'Eastern Africa',
    need: 0.91,
    coverage: 0.14,
    funding: 0.68,
    rankDelta: 2,
  },
  {
    id: 'mmr',
    iso3: 'MMR',
    name: 'Myanmar',
    region: 'South-eastern Asia',
    need: 0.83,
    coverage: 0.11,
    // No OCHA appeal on record — must never render as 0%.
    funding: null,
    rankDelta: null,
  },
  {
    id: 'hti',
    iso3: 'HTI',
    name: 'Haiti',
    region: 'Caribbean',
    need: 0.79,
    coverage: 0.22,
    funding: 0.54,
    rankDelta: -1,
  },
  {
    id: 'yem',
    iso3: 'YEM',
    name: 'Yemen',
    region: 'Western Asia',
    need: 0.88,
    coverage: 0.41,
    funding: 0.71,
    rankDelta: 0,
  },
  {
    id: 'ukr',
    iso3: 'UKR',
    name: 'Ukraine',
    region: 'Eastern Europe',
    // Well covered relative to need — produces a negative gap, so the ranking
    // view is exercised against the over-covered end of the scale too.
    need: 0.86,
    coverage: 0.94,
    funding: 0.39,
    rankDelta: -2,
  },
];

export function mockRankedCrises(): RankedCrisis[] {
  return SEEDS.map((seed) => ({
    id: seed.id,
    iso3: seed.iso3,
    name: seed.name,
    region: seed.region,
    isActive: true,
    latestScore: score(seed.id, seed.need, seed.coverage, seed.funding),
    rank: 0,
    rankDelta: seed.rankDelta,
  }))
    .sort((a, b) => b.latestScore.attentionGapScore - a.latestScore.attentionGapScore)
    .map((crisis, index) => ({ ...crisis, rank: index + 1 }));
}

export function mockListResponse(): ListCrisesResponse {
  const data = mockRankedCrises();
  return { data, scoredFor: SCORED_FOR, count: data.length };
}

function mockHistory(seed: Seed): ScoreHistoryPoint[] {
  return Array.from({ length: 6 }, (_, index) => {
    const need = Math.min(0.98, seed.need - 0.075 + index * 0.015);
    const coverage = Math.max(0.05, seed.coverage + 0.08 - index * 0.016);
    const date = new Date(Date.UTC(2026, 5, 14 + index * 7));

    return {
      scoredFor: date.toISOString().slice(0, 10),
      needScore: Number(need.toFixed(2)),
      coverageScore: Number(coverage.toFixed(2)),
      attentionGapScore: Number((need - coverage).toFixed(3)),
    };
  });
}

function mockObservations(seed: Seed): ObservationPoint[] {
  const observations: ObservationPoint[] = [
    {
      source: 'unhcr',
      metric: 'displaced_persons',
      value: 1_247_891,
      observedAt: SCORED_FOR,
    },
    {
      source: 'gdelt',
      metric: 'coverage_volume_pct',
      value: 0.42,
      observedAt: SCORED_FOR,
    },
    {
      source: 'reliefweb',
      metric: 'active_disaster_count',
      value: 12,
      observedAt: SCORED_FOR,
    },
  ];

  if (seed.funding !== null) {
    observations.push(
      {
        source: 'fts',
        metric: 'appeal_funded_pct',
        value: Number((1 - seed.funding).toFixed(2)),
        observedAt: SCORED_FOR,
      },
      {
        source: 'fts',
        metric: 'appeal_requirements_usd',
        value: 2_700_000_000,
        observedAt: SCORED_FOR,
      },
    );
  }

  return observations;
}

export function mockDetail(id: string): CrisisDetail | null {
  const seed = SEEDS.find((entry) => entry.id === id);
  if (!seed) return null;

  return {
    id: seed.id,
    iso3: seed.iso3,
    name: seed.name,
    region: seed.region,
    isActive: true,
    latestScore: score(seed.id, seed.need, seed.coverage, seed.funding),
    history: mockHistory(seed),
    latestObservations: mockObservations(seed),
    // Briefs are generated on demand rather than seeded, so the briefs view
    // exercises the real generation path even in placeholder mode.
    briefs: [],
  };
}
