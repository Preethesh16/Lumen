import type { BriefInput } from '@lumen/shared-types';

/**
 * A crisis with deliberately distinctive figures, so a test can tell the
 * difference between a number the model was given and one it invented.
 */
export const sudanInput: BriefInput = {
  crisis: {
    crisisId: 'sdn-displacement-2026',
    name: 'Sudan conflict displacement',
    country: 'Sudan',
    countryCode: 'SDN',
    needScore: 0.91,
    coverageScore: 0.14,
    attentionGapScore: 0.77,
    fundingGapPct: 68,
    computedAt: '2026-07-19T06:00:00.000Z',
  },
  history: {
    crisisId: 'sdn-displacement-2026',
    points: [
      {
        computedAt: '2026-07-05T06:00:00.000Z',
        needScore: 0.88,
        coverageScore: 0.19,
        attentionGapScore: 0.69,
        fundingGapPct: 64,
      },
      {
        computedAt: '2026-07-12T06:00:00.000Z',
        needScore: 0.9,
        coverageScore: 0.16,
        attentionGapScore: 0.74,
        fundingGapPct: 66,
      },
      {
        computedAt: '2026-07-19T06:00:00.000Z',
        needScore: 0.91,
        coverageScore: 0.14,
        attentionGapScore: 0.77,
        fundingGapPct: 68,
      },
    ],
  },
  sources: [
    {
      source: 'unhcr',
      label: 'People displaced, cumulative',
      value: 1_247_891,
      unit: 'people',
      retrievedAt: '2026-07-19T05:12:00.000Z',
      url: 'https://api.unhcr.org/population/v1/',
    },
    {
      source: 'gdelt',
      label: 'Articles mentioning crisis, last 24h',
      value: 37,
      unit: 'articles',
      retrievedAt: '2026-07-19T05:14:00.000Z',
    },
    {
      source: 'ocha-fts',
      label: 'Appeal funding received',
      value: 32,
      unit: 'percent',
      retrievedAt: '2026-07-19T05:20:00.000Z',
    },
  ],
};

/** A crisis with no OCHA appeal on record — funding data genuinely absent. */
export const noFundingDataInput: BriefInput = {
  ...sudanInput,
  crisis: {
    ...sudanInput.crisis,
    crisisId: 'mmr-displacement-2026',
    name: 'Myanmar internal displacement',
    country: 'Myanmar',
    countryCode: 'MMR',
    fundingGapPct: undefined,
  },
  history: {
    crisisId: 'mmr-displacement-2026',
    points: [
      {
        computedAt: '2026-07-19T06:00:00.000Z',
        needScore: 0.83,
        coverageScore: 0.11,
        attentionGapScore: 0.72,
      },
    ],
  },
  sources: [
    {
      source: 'unhcr',
      label: 'People displaced, cumulative',
      value: 512_400,
      unit: 'people',
      retrievedAt: '2026-07-19T05:12:00.000Z',
    },
  ],
};
