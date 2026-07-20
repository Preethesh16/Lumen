import {
  rankByAttentionGap,
  scoreCohort,
  type CohortMember,
  type CrisisScoreResult,
} from '@lumen/scoring';
import type {
  CrisisDetail,
  CrisisScore,
  ListCrisesResponse,
  ObservationMetric,
  ObservationPoint,
  RankedCrisis,
  ScoreHistoryPoint,
} from '@lumen/shared-types';

/**
 * Placeholder data for running the dashboard without the API.
 *
 * Only the raw upstream observations are invented here. The scores themselves
 * come from the real `scoreCohort` — the same function `apps/api` calls — so
 * placeholder data cannot drift from the live formula.
 *
 * That drift was not hypothetical: this file previously hardcoded
 * `raw * (1 + fundingGapPct * 0.85)`, which never matched v1.0.0 and was
 * further wrong once v1.1.0 added an additive funding term. Deriving from the
 * real function means a scoring change is reflected here automatically.
 *
 * The cohort deliberately includes the awkward cases — a crisis with no OCHA
 * appeal, and one that is well covered relative to need — so the views are
 * exercised against them rather than only the tidy row.
 */

const SCORED_FOR = '2026-07-19';
const WEEKS_OF_HISTORY = 6;

interface Seed {
  crisisId: string;
  iso3: string;
  name: string;
  region: string;
  observations: Partial<Record<ObservationMetric, number>>;
  rankDelta: number | null;
}

const SEEDS: Seed[] = [
  {
    crisisId: 'sdn',
    iso3: 'SDN',
    name: 'Sudan',
    region: 'Eastern Africa',
    observations: {
      displaced_persons: 1_247_891,
      appeal_requirements_usd: 2_700_000_000,
      active_disaster_count: 12,
      coverage_volume_pct: 0.42,
      appeal_funded_pct: 0.32,
    },
    rankDelta: 2,
  },
  {
    crisisId: 'mmr',
    iso3: 'MMR',
    name: 'Myanmar',
    region: 'South-eastern Asia',
    observations: {
      displaced_persons: 512_400,
      active_disaster_count: 7,
      coverage_volume_pct: 0.18,
      // No OCHA appeal on record — appeal_funded_pct absent, so fundingGapPct
      // resolves to null. Must never render as 0%.
    },
    rankDelta: null,
  },
  {
    crisisId: 'tcd',
    iso3: 'TCD',
    name: 'Chad',
    region: 'Middle Africa',
    observations: {
      // Severely underfunded (89%) and near-invisible in coverage — the shape
      // of crisis the v1.1.0 additive funding term was added for. It does not
      // reproduce the exact zeroing bug here (Chad is not the cohort minimum
      // on need, so its raw gap is non-zero); reproducing that belongs in
      // packages/scoring's own tests, not in display fixtures.
      displaced_persons: 1_900_000,
      appeal_requirements_usd: 1_100_000_000,
      active_disaster_count: 4,
      coverage_volume_pct: 0.03,
      appeal_funded_pct: 0.11,
    },
    rankDelta: 4,
  },
  {
    crisisId: 'hti',
    iso3: 'HTI',
    name: 'Haiti',
    region: 'Caribbean',
    observations: {
      displaced_persons: 362_000,
      appeal_requirements_usd: 674_000_000,
      active_disaster_count: 9,
      coverage_volume_pct: 0.61,
      appeal_funded_pct: 0.46,
    },
    rankDelta: -1,
  },
  {
    crisisId: 'yem',
    iso3: 'YEM',
    name: 'Yemen',
    region: 'Western Asia',
    observations: {
      displaced_persons: 4_500_000,
      appeal_requirements_usd: 2_300_000_000,
      active_disaster_count: 11,
      coverage_volume_pct: 1.4,
      appeal_funded_pct: 0.29,
    },
    rankDelta: 0,
  },
  {
    crisisId: 'ukr',
    iso3: 'UKR',
    name: 'Ukraine',
    region: 'Eastern Europe',
    observations: {
      // Heavily covered relative to need — produces a low or negative gap, so
      // the ranking view is exercised at the over-covered end of the scale.
      displaced_persons: 3_700_000,
      appeal_requirements_usd: 3_100_000_000,
      active_disaster_count: 6,
      coverage_volume_pct: 18.5,
      appeal_funded_pct: 0.61,
    },
    rankDelta: -2,
  },
];

const COHORT: CohortMember[] = SEEDS.map((seed) => ({
  crisisId: seed.crisisId,
  iso3: seed.iso3,
  observations: seed.observations,
}));

/** Real scores from the real formula, computed once at module load. */
const SCORED = rankByAttentionGap(scoreCohort(COHORT));

function toCrisisScore(result: CrisisScoreResult): CrisisScore {
  return {
    id: `score-${result.crisisId}`,
    crisisId: result.crisisId,
    needScore: result.needScore,
    coverageScore: result.coverageScore,
    fundingGapPct: result.fundingGapPct,
    attentionGapScore: result.attentionGapScore,
    algorithmVersion: result.algorithmVersion,
    scoredFor: SCORED_FOR,
    computedAt: `${SCORED_FOR}T06:00:00.000Z`,
  };
}

export function mockRankedCrises(): RankedCrisis[] {
  return SCORED.map((result) => {
    const seed = SEEDS.find((entry) => entry.crisisId === result.crisisId)!;
    return {
      id: seed.crisisId,
      iso3: seed.iso3,
      name: seed.name,
      region: seed.region,
      isActive: true,
      latestScore: toCrisisScore(result),
      rank: result.rank,
      rankDelta: seed.rankDelta,
    };
  });
}

export function mockListResponse(): ListCrisesResponse {
  const data = mockRankedCrises();
  return { data, scoredFor: SCORED_FOR, count: data.length };
}

/**
 * Synthesises earlier runs by scaling coverage back through the real formula,
 * so the trend line is consistent with the scores shown beside it rather than
 * being an independently invented curve.
 */
function mockHistory(crisisId: string): ScoreHistoryPoint[] {
  return Array.from({ length: WEEKS_OF_HISTORY }, (_, week) => {
    // Coverage decays toward the present; need drifts up slightly.
    const coverageFactor = 1 + (WEEKS_OF_HISTORY - 1 - week) * 0.22;
    const needFactor = 1 - (WEEKS_OF_HISTORY - 1 - week) * 0.04;

    const pastCohort: CohortMember[] = COHORT.map((member) => ({
      ...member,
      observations: {
        ...member.observations,
        coverage_volume_pct:
          member.observations.coverage_volume_pct === undefined
            ? undefined
            : member.observations.coverage_volume_pct * coverageFactor,
        displaced_persons:
          member.observations.displaced_persons === undefined
            ? undefined
            : Math.round(member.observations.displaced_persons * needFactor),
      },
    }));

    const point = scoreCohort(pastCohort).find((entry) => entry.crisisId === crisisId)!;
    const date = new Date(Date.UTC(2026, 5, 14 + week * 7));

    return {
      scoredFor: date.toISOString().slice(0, 10),
      needScore: point.needScore,
      coverageScore: point.coverageScore,
      attentionGapScore: point.attentionGapScore,
    };
  });
}

function mockObservations(seed: Seed): ObservationPoint[] {
  return (Object.entries(seed.observations) as [ObservationMetric, number][]).map(
    ([metric, value]) => ({
      source: metricSource(metric),
      metric,
      value,
      observedAt: SCORED_FOR,
    }),
  );
}

function metricSource(metric: ObservationMetric): ObservationPoint['source'] {
  switch (metric) {
    case 'coverage_volume_pct':
      return 'gdelt';
    case 'displaced_persons':
      return 'unhcr';
    case 'active_disaster_count':
      return 'reliefweb';
    case 'appeal_funded_pct':
    case 'appeal_requirements_usd':
      return 'fts';
  }
}

export function mockDetail(id: string): CrisisDetail | null {
  const seed = SEEDS.find((entry) => entry.crisisId === id);
  if (!seed) return null;

  const result = SCORED.find((entry) => entry.crisisId === id)!;

  return {
    id: seed.crisisId,
    iso3: seed.iso3,
    name: seed.name,
    region: seed.region,
    isActive: true,
    latestScore: toCrisisScore(result),
    history: mockHistory(seed.crisisId),
    latestObservations: mockObservations(seed),
    // Briefs are generated on demand rather than seeded, so the briefs view
    // exercises the real generation path even in placeholder mode.
    briefs: [],
  };
}
