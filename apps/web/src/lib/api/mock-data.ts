import type { Crisis, CrisisDetail, ScoreHistoryPoint } from '@lumen/shared-types';

/**
 * Placeholder data for building the dashboard before `apps/api` exists.
 *
 * The figures are illustrative and clearly labelled as mock in the UI. They
 * are shaped like real upstream responses — including a crisis with no OCHA
 * appeal — so the views get exercised against the awkward cases, not just the
 * tidy one.
 */

function history(seed: number, weeks = 6): ScoreHistoryPoint[] {
  return Array.from({ length: weeks }, (_, index) => {
    const need = Math.min(0.98, seed + index * 0.015);
    const coverage = Math.max(0.05, 0.3 - index * 0.03);
    const date = new Date(Date.UTC(2026, 5, 7 + index * 7, 6));

    return {
      computedAt: date.toISOString(),
      needScore: Number(need.toFixed(2)),
      coverageScore: Number(coverage.toFixed(2)),
      attentionGapScore: Number((need - coverage).toFixed(2)),
      fundingGapPct: 60 + index,
    };
  });
}

export const mockCrises: Crisis[] = [
  {
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
  {
    crisisId: 'mmr-displacement-2026',
    name: 'Myanmar internal displacement',
    country: 'Myanmar',
    countryCode: 'MMR',
    needScore: 0.83,
    coverageScore: 0.11,
    attentionGapScore: 0.72,
    // No OCHA appeal on record — the UI must not render this as 0%.
    computedAt: '2026-07-19T06:00:00.000Z',
  },
  {
    crisisId: 'hti-insecurity-2026',
    name: 'Haiti gang violence and food insecurity',
    country: 'Haiti',
    countryCode: 'HTI',
    needScore: 0.79,
    coverageScore: 0.22,
    attentionGapScore: 0.57,
    fundingGapPct: 54,
    computedAt: '2026-07-19T06:00:00.000Z',
  },
  {
    crisisId: 'yem-food-2026',
    name: 'Yemen food insecurity',
    country: 'Yemen',
    countryCode: 'YEM',
    needScore: 0.88,
    coverageScore: 0.41,
    attentionGapScore: 0.47,
    fundingGapPct: 71,
    computedAt: '2026-07-19T06:00:00.000Z',
  },
  {
    crisisId: 'ukr-conflict-2026',
    name: 'Ukraine conflict',
    country: 'Ukraine',
    countryCode: 'UKR',
    needScore: 0.86,
    coverageScore: 0.94,
    // Negative: well covered relative to need. Included so the ranking view
    // is exercised against the over-covered end of the scale too.
    attentionGapScore: -0.08,
    fundingGapPct: 39,
    computedAt: '2026-07-19T06:00:00.000Z',
  },
];

export function mockDetail(id: string): CrisisDetail | null {
  const crisis = mockCrises.find((entry) => entry.crisisId === id);
  if (!crisis) return null;

  return {
    crisis,
    history: { crisisId: crisis.crisisId, points: history(crisis.needScore - 0.075) },
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
        source: 'reliefweb',
        label: 'Active disaster reports',
        value: 12,
        unit: 'reports',
        retrievedAt: '2026-07-19T05:16:00.000Z',
      },
      ...(crisis.fundingGapPct !== undefined
        ? [
            {
              source: 'ocha-fts' as const,
              label: 'Appeal funding received',
              value: 100 - crisis.fundingGapPct,
              unit: 'percent',
              retrievedAt: '2026-07-19T05:20:00.000Z',
            },
          ]
        : []),
    ],
  };
}
