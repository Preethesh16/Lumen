import type { Crisis, ScoreHistoryPoint } from '@lumen/shared-types';

/** Scores are 0-1 internally; the UI shows them as 0-100 for readability. */
export function asPoints(score: number): string {
  return (score * 100).toFixed(0);
}

/**
 * Funding is optional because OCHA FTS has no appeal for every crisis.
 * Absence is not zero, and rendering it as "0% funded" would misreport a
 * data gap as a total funding failure.
 */
export function fundingLabel(crisis: Crisis): string {
  return crisis.fundingGapPct === undefined
    ? 'No appeal data'
    : `${crisis.fundingGapPct}% unfunded`;
}

export type Trend = 'widening' | 'narrowing' | 'flat' | 'insufficient-data';

/**
 * Direction of the attention gap over the observed period.
 *
 * A single observation gets `insufficient-data` rather than `flat` — with one
 * point there is no trend, and showing a flat arrow would imply a stability
 * the data cannot support.
 */
export function trendOf(points: ScoreHistoryPoint[]): Trend {
  if (points.length < 2) return 'insufficient-data';

  const sorted = [...points].sort((a, b) => a.computedAt.localeCompare(b.computedAt));
  const change =
    sorted[sorted.length - 1].attentionGapScore - sorted[0].attentionGapScore;

  if (Math.abs(change) < 0.02) return 'flat';
  return change > 0 ? 'widening' : 'narrowing';
}

export function trendLabel(trend: Trend): string {
  switch (trend) {
    case 'widening':
      return 'Gap widening';
    case 'narrowing':
      return 'Gap narrowing';
    case 'flat':
      return 'Gap stable';
    case 'insufficient-data':
      return 'Not enough history';
  }
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
