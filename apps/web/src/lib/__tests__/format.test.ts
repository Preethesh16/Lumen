import { describe, expect, it } from 'vitest';
import type { CrisisScore, ScoreHistoryPoint } from '@lumen/shared-types';
import {
  asPoints,
  fundingLabel,
  gapPoints,
  metricLabel,
  rankDeltaLabel,
  sourceLabel,
  trendLabel,
  trendOf,
} from '../format';

function scoreWith(fundingGapPct: number | null): CrisisScore {
  return {
    id: 'score-1',
    crisisId: 'sdn',
    needScore: 0.91,
    coverageScore: 0.14,
    fundingGapPct,
    attentionGapScore: 1.219,
    algorithmVersion: 'v1.1.0',
    scoredFor: '2026-07-19',
    computedAt: '2026-07-19T06:00:00.000Z',
  };
}

function history(...gaps: number[]): ScoreHistoryPoint[] {
  return gaps.map((attentionGapScore, index) => ({
    scoredFor: `2026-07-${String(index + 1).padStart(2, '0')}`,
    needScore: 0.8,
    coverageScore: 0.2,
    attentionGapScore,
  }));
}

describe('fundingLabel', () => {
  it('converts the 0..1 share to a percentage', () => {
    // The bug this guards: rendering the raw 0..1 value would show "0.68%
    // unfunded" on a donor-facing view for a 68%-unfunded appeal.
    expect(fundingLabel(scoreWith(0.68))).toBe('68% unfunded');
  });

  it('reports absent appeal data rather than implying full funding', () => {
    expect(fundingLabel(scoreWith(null))).toBe('No appeal data');
  });

  it('does not confuse a genuinely fully-funded appeal with missing data', () => {
    expect(fundingLabel(scoreWith(0))).toBe('0% unfunded');
  });
});

describe('asPoints and gapPoints', () => {
  it('scales cohort-relative scores to 0-100', () => {
    expect(asPoints(0.91)).toBe('91');
  });

  it('keeps the unclamped attention gap off the 0-100 scale', () => {
    // The gap runs roughly -1.5..1.5. Passing it through asPoints would render
    // 1.42 as "142", implying a percentage that inexplicably exceeds 100.
    expect(gapPoints(1.42)).toBe('1.42');
    expect(gapPoints(-0.201)).toBe('-0.20');
  });
});

describe('trendOf', () => {
  it('reports insufficient data for a single observation', () => {
    // Day one state. Calling this "flat" would imply a stability one point
    // cannot evidence.
    expect(trendOf(history(0.5))).toBe('insufficient-data');
    expect(trendOf([])).toBe('insufficient-data');
  });

  it('detects a widening gap', () => {
    expect(trendOf(history(0.4, 0.6, 0.8))).toBe('widening');
  });

  it('detects a narrowing gap', () => {
    expect(trendOf(history(0.8, 0.5, 0.3))).toBe('narrowing');
  });

  it('treats sub-threshold movement as stable', () => {
    expect(trendOf(history(0.5, 0.505, 0.51))).toBe('flat');
  });

  it('is order-independent — it sorts by date, not array position', () => {
    const shuffled = [...history(0.3, 0.6, 0.9)].reverse();
    expect(trendOf(shuffled)).toBe('widening');
  });

  it('labels every trend state', () => {
    for (const trend of ['widening', 'narrowing', 'flat', 'insufficient-data'] as const) {
      expect(trendLabel(trend)).toBeTruthy();
    }
  });
});

describe('rankDeltaLabel', () => {
  it('says "New" when there is no previous run to compare against', () => {
    expect(rankDeltaLabel(null)).toBe('New');
  });

  it('distinguishes climbing, falling, and unchanged', () => {
    expect(rankDeltaLabel(3)).toContain('3');
    expect(rankDeltaLabel(-2)).toContain('2');
    expect(rankDeltaLabel(0)).toBe('No change');
  });
});

describe('source and metric labels', () => {
  it('renders the FTS source name in full rather than as its code', () => {
    expect(sourceLabel('fts')).toBe('UN OCHA FTS');
  });

  it('falls back to the raw value for an unrecognised source', () => {
    // A new source added upstream should show up as itself, not blank.
    expect(sourceLabel('newwire')).toBe('newwire');
  });

  it('gives every known observation metric a human label and unit', () => {
    expect(metricLabel('displaced_persons')).toEqual({
      label: 'People displaced',
      unit: 'people',
    });
  });

  it('falls back to the raw metric name when unrecognised', () => {
    expect(metricLabel('some_new_metric').label).toBe('some_new_metric');
  });
});
