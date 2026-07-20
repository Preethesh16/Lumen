/**
 * Normalization primitives. Pure, dependency-free, and separately testable
 * from the scoring formula that composes them.
 */

/**
 * Natural log with a +1 offset so zero maps to zero and negatives are
 * rejected rather than silently becoming NaN.
 *
 * Every quantity we normalize is heavy-tailed — displacement counts span three
 * orders of magnitude between Sudan and Vanuatu, and GDELT coverage share is
 * worse. Linear min-max on raw values collapses every country except the
 * largest into approximately zero, which would make the whole ranking a
 * restatement of "which country is biggest".
 */
export function logTransform(value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`logTransform expects a finite number, got ${value}`);
  }
  if (value < 0) {
    throw new RangeError(`logTransform expects a non-negative number, got ${value}`);
  }
  return Math.log1p(value);
}

/**
 * The value a degenerate cohort normalizes to.
 *
 * When every member is identical (or there is only one), there is no spread to
 * rank against, so no member is more or less extreme than any other. 0.5 says
 * "neutral, no information" — which is honest. Returning 0 or 1 would assert
 * an extreme the data does not support, and would flow straight into
 * attention_gap_score as a fabricated signal.
 */
export const NEUTRAL_SCORE = 0.5;

/** Values closer than this are treated as one value, guarding float noise. */
const EPSILON = 1e-9;

/**
 * Min-max normalize a cohort to 0..1.
 *
 * Returns NEUTRAL_SCORE for every member when the cohort has no spread, rather
 * than dividing by zero. This is not a rare edge case: on day one the cohort
 * may be a single crisis, and a source that fails for every country but one
 * produces an all-identical cohort.
 */
export function minMaxNormalize(values: readonly number[]): number[] {
  if (values.length === 0) return [];

  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (!Number.isFinite(v)) {
      throw new RangeError(`minMaxNormalize expects finite numbers, got ${v}`);
    }
    if (v < min) min = v;
    if (v > max) max = v;
  }

  const range = max - min;
  if (range < EPSILON) return values.map(() => NEUTRAL_SCORE);

  return values.map((v) => (v - min) / range);
}

/**
 * Log-transform then min-max normalize. The standard treatment for every
 * heavy-tailed input in this system.
 */
export function normalizeCohort(values: readonly number[]): number[] {
  return minMaxNormalize(values.map(logTransform));
}

/** Clamp into an inclusive range. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Weighted mean over the components that actually have data.
 *
 * Missing components are dropped and the remaining weights re-normalized, so a
 * country with no UNHCR figure is scored on the sources it does have rather
 * than being penalised to zero for an upstream gap. Distinguishing "no need"
 * from "no data" is the single most important correctness property here —
 * conflating them would systematically rank data-poor crises as low-need,
 * which is precisely the population this product exists to surface.
 *
 * Returns null when no component has data at all.
 */
export function weightedMean(
  components: readonly { value: number | null; weight: number }[],
): number | null {
  let weightedSum = 0;
  let totalWeight = 0;

  for (const { value, weight } of components) {
    if (value === null || !Number.isFinite(value)) continue;
    if (weight <= 0) continue;
    weightedSum += value * weight;
    totalWeight += weight;
  }

  if (totalWeight === 0) return null;
  return weightedSum / totalWeight;
}
