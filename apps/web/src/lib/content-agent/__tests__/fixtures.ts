import type { BriefInput } from '../types';

/**
 * A crisis with deliberately distinctive figures, so a test can tell the
 * difference between a number the model was given and one it invented.
 */
export const sudanInput: BriefInput = {
  crisisName: 'Sudan',
  country: 'Eastern Africa',
  iso3: 'SDN',
  score: {
    id: 'score-sdn',
    crisisId: 'sdn',
    needScore: 0.91,
    coverageScore: 0.14,
    // 0..1 share of the appeal unfunded — 68%.
    fundingGapPct: 0.68,
    attentionGapScore: 1.219,
    algorithmVersion: 'v1',
    scoredFor: '2026-07-19',
    computedAt: '2026-07-19T06:00:00.000Z',
  },
  history: [
    {
      scoredFor: '2026-07-05',
      needScore: 0.88,
      coverageScore: 0.19,
      attentionGapScore: 0.69,
    },
    {
      scoredFor: '2026-07-12',
      needScore: 0.9,
      coverageScore: 0.16,
      attentionGapScore: 0.74,
    },
    {
      scoredFor: '2026-07-19',
      needScore: 0.91,
      coverageScore: 0.14,
      attentionGapScore: 0.77,
    },
  ],
  observations: [
    {
      source: 'unhcr',
      metric: 'displaced_persons',
      value: 1_247_891,
      observedAt: '2026-07-19',
    },
    {
      source: 'gdelt',
      metric: 'coverage_volume_pct',
      value: 0.42,
      observedAt: '2026-07-19',
    },
    {
      source: 'fts',
      metric: 'appeal_funded_pct',
      value: 0.32,
      observedAt: '2026-07-19',
    },
  ],
};

/** A crisis with no OCHA appeal on record — funding data genuinely absent. */
export const noFundingDataInput: BriefInput = {
  crisisName: 'Myanmar',
  country: 'South-eastern Asia',
  iso3: 'MMR',
  score: {
    id: 'score-mmr',
    crisisId: 'mmr',
    needScore: 0.83,
    coverageScore: 0.11,
    fundingGapPct: null,
    attentionGapScore: 0.72,
    algorithmVersion: 'v1',
    scoredFor: '2026-07-19',
    computedAt: '2026-07-19T06:00:00.000Z',
  },
  history: [
    {
      scoredFor: '2026-07-19',
      needScore: 0.83,
      coverageScore: 0.11,
      attentionGapScore: 0.72,
    },
  ],
  observations: [
    {
      source: 'unhcr',
      metric: 'displaced_persons',
      value: 512_400,
      observedAt: '2026-07-19',
    },
  ],
};
