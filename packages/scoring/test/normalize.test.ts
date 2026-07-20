import { describe, expect, it } from 'vitest';
import {
  NEUTRAL_SCORE,
  logTransform,
  minMaxNormalize,
  normalizeCohort,
  weightedMean,
} from '../src/normalize.js';

describe('logTransform', () => {
  it('maps zero to zero', () => {
    expect(logTransform(0)).toBe(0);
  });

  it('compresses heavy tails so orders of magnitude stay distinguishable', () => {
    // The reason this transform exists: raw min-max over these three would put
    // the two smaller countries at ~0.00001 and ~0.001, i.e. indistinguishable.
    const raw = [10_000, 1_000_000, 10_000_000];
    const linear = minMaxNormalize(raw);
    const logged = normalizeCohort(raw);

    expect(linear[1]!).toBeLessThan(0.1);
    expect(logged[1]!).toBeGreaterThan(0.6);
  });

  it('rejects negatives rather than returning NaN', () => {
    expect(() => logTransform(-1)).toThrow(RangeError);
  });

  it('rejects non-finite input', () => {
    expect(() => logTransform(NaN)).toThrow(RangeError);
    expect(() => logTransform(Infinity)).toThrow(RangeError);
  });
});

describe('minMaxNormalize', () => {
  it('returns an empty array for an empty cohort', () => {
    expect(minMaxNormalize([])).toEqual([]);
  });

  it('maps min to 0 and max to 1', () => {
    expect(minMaxNormalize([2, 4, 6])).toEqual([0, 0.5, 1]);
  });

  it('returns neutral for a single-member cohort instead of dividing by zero', () => {
    // Day one: one crisis in the table. Must not produce NaN.
    expect(minMaxNormalize([42])).toEqual([NEUTRAL_SCORE]);
  });

  it('returns neutral when every value is identical', () => {
    // Happens when a source fails for all but one country.
    expect(minMaxNormalize([7, 7, 7])).toEqual([
      NEUTRAL_SCORE,
      NEUTRAL_SCORE,
      NEUTRAL_SCORE,
    ]);
  });

  it('treats float-noise spread as no spread', () => {
    const result = minMaxNormalize([1, 1 + 1e-12]);
    expect(result).toEqual([NEUTRAL_SCORE, NEUTRAL_SCORE]);
  });

  it('never produces NaN for any degenerate cohort', () => {
    for (const cohort of [[0], [0, 0], [5, 5, 5], [1e-15]]) {
      for (const v of minMaxNormalize(cohort)) {
        expect(Number.isNaN(v)).toBe(false);
      }
    }
  });
});

describe('weightedMean', () => {
  it('averages by weight', () => {
    const result = weightedMean([
      { value: 1, weight: 3 },
      { value: 0, weight: 1 },
    ]);
    expect(result).toBe(0.75);
  });

  it('re-normalizes weights when a component is missing', () => {
    // The key property: a missing UNHCR figure must not drag the score toward
    // zero. Scoring on the remaining sources should equal scoring a cohort
    // that only ever had those sources.
    const withMissing = weightedMean([
      { value: null, weight: 0.5 },
      { value: 0.8, weight: 0.3 },
      { value: 0.4, weight: 0.2 },
    ]);
    const withoutMissing = weightedMean([
      { value: 0.8, weight: 0.3 },
      { value: 0.4, weight: 0.2 },
    ]);

    // (0.8 * 0.3 + 0.4 * 0.2) / (0.3 + 0.2) = 0.32 / 0.5
    expect(withMissing).toBeCloseTo(0.64, 10);
    expect(withMissing).toBe(withoutMissing);
  });

  it('returns null when no component has data', () => {
    expect(
      weightedMean([
        { value: null, weight: 1 },
        { value: null, weight: 2 },
      ]),
    ).toBeNull();
  });

  it('returns null for an empty component list', () => {
    expect(weightedMean([])).toBeNull();
  });

  it('ignores zero and negative weights', () => {
    expect(
      weightedMean([
        { value: 1, weight: 0 },
        { value: 0.5, weight: 1 },
      ]),
    ).toBe(0.5);
  });
});
