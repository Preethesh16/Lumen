import type { CrisisScore, ScoreHistoryPoint } from '@lumen/shared-types';

/**
 * Cohort-relative 0..1 scores shown as 0-100 for readability.
 *
 * `attentionGapScore` is NOT 0..1 — it runs roughly -1.5..1.5 because the
 * funding weight amplifies it past the raw difference, and it is deliberately
 * unclamped upstream. Use `gapPoints` for it, never this.
 */
export function asPoints(score: number): string {
  return (score * 100).toFixed(0);
}

/**
 * The attention gap on its own scale. Kept separate from `asPoints` so the
 * unclamped range cannot be mistaken for a percentage — an amplified gap of
 * 1.42 rendered by `asPoints` would read as "142", implying a percentage that
 * exceeds 100 for no visible reason.
 */
export function gapPoints(score: number): string {
  return score.toFixed(2);
}

/**
 * `fundingGapPct` is a 0..1 share of the appeal left unfunded, and it is
 * `null` when OCHA FTS has no appeal on record.
 *
 * Null is not zero. Rendering a missing appeal as "0% unfunded" would report a
 * data gap as full funding, in a view aimed at donors. Every consumer of this
 * field goes through here.
 */
export function fundingLabel(score: CrisisScore): string {
  if (score.fundingGapPct === null) return 'No appeal data';
  return `${(score.fundingGapPct * 100).toFixed(0)}% unfunded`;
}

export type Trend = 'widening' | 'narrowing' | 'flat' | 'insufficient-data';

/**
 * Direction of the attention gap over the observed period.
 *
 * A single observation yields `insufficient-data`, not `flat` — with one point
 * there is no trend, and a flat reading would imply a stability the data
 * cannot support. This is the normal state on day one.
 */
export function trendOf(points: ScoreHistoryPoint[]): Trend {
  if (points.length < 2) return 'insufficient-data';

  const sorted = [...points].sort((a, b) => a.scoredFor.localeCompare(b.scoredFor));
  const change = sorted[sorted.length - 1].attentionGapScore - sorted[0].attentionGapScore;

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

/** Rank movement since the previous run. Null on the first run — say so. */
export function rankDeltaLabel(delta: number | null): string {
  if (delta === null) return 'New';
  if (delta === 0) return 'No change';
  return delta > 0 ? `▲ ${delta}` : `▼ ${Math.abs(delta)}`;
}

const SOURCE_NAMES: Record<string, string> = {
  gdelt: 'GDELT',
  reliefweb: 'ReliefWeb',
  unhcr: 'UNHCR',
  fts: 'UN OCHA FTS',
};

export function sourceLabel(source: string): string {
  return SOURCE_NAMES[source] ?? source;
}

const METRIC_LABELS: Record<string, { label: string; unit: string }> = {
  coverage_volume_pct: { label: 'Share of global news volume', unit: '%' },
  displaced_persons: { label: 'People displaced', unit: 'people' },
  appeal_funded_pct: { label: 'Appeal funded', unit: 'share' },
  appeal_requirements_usd: { label: 'Appeal requirement', unit: 'USD' },
  active_disaster_count: { label: 'Active disasters', unit: 'reports' },
};

export function metricLabel(metric: string): { label: string; unit: string } {
  return METRIC_LABELS[metric] ?? { label: metric, unit: '' };
}

/** Formats an ISO date or datetime for display. */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
