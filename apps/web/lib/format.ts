import type { ObservationMetric } from '@lumen/shared-types';

export function scorePercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function signed(value: number, digits = 3): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)}`;
}

export function compact(value: number): string {
  return new Intl.NumberFormat('en', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

export function dateLabel(value: string): string {
  return new Intl.DateTimeFormat('en', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value.slice(0, 10)}T00:00:00Z`));
}

export const metricNames: Record<ObservationMetric, string> = {
  coverage_volume_pct: 'Media coverage',
  displaced_persons: 'Displaced people',
  appeal_funded_pct: 'Appeal funded',
  appeal_requirements_usd: 'Appeal requirement',
  active_disaster_count: 'Active disasters',
};

export function observationValue(metric: ObservationMetric, value: number): string {
  if (metric === 'appeal_funded_pct') return `${(value * 100).toFixed(1)}%`;
  if (metric === 'coverage_volume_pct') return `${value.toFixed(3)}%`;
  if (metric === 'appeal_requirements_usd') return `$${compact(value)}`;
  return compact(value);
}
