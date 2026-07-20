import type { BriefInput, GroundingResult } from './types';

/**
 * Checks that every figure appearing in a generated brief traces back to a
 * value in the input payload.
 *
 * The system prompt tells the model not to invent statistics. This function
 * exists because a prompt is a request, not a guarantee — and the cost of an
 * invented casualty figure reaching a journalist is high enough that it
 * warrants a check that does not depend on the model having complied.
 *
 * The check is deliberately conservative: it flags anything it cannot
 * positively trace. False positives are cheap (a human looks at the brief);
 * a false negative ships a fabricated number to a donor.
 */

const MILLION = 1_000_000;
const BILLION = 1_000_000_000;
const THOUSAND = 1_000;

/** Rounding the model is permitted: "1,247,891" may be written "1.2 million". */
const RELATIVE_TOLERANCE = 0.05;

/**
 * Years read as bare 4-digit numbers in prose ("since 2023") are dates, not
 * statistics, and are checked against the payload's timestamps separately.
 */
const YEAR_PATTERN = /^(19|20)\d{2}$/;

/**
 * A number followed by a time unit is describing a window, not measuring the
 * world: "37 articles in the last 24 hours" contains one statistic, not two.
 * Without this, every brief that dated its own data would be flagged.
 */
const TIME_UNIT_PATTERN =
  /^\s*(hour|hours|day|days|week|weeks|month|months|year|years|hr|hrs|h\b)/i;

interface ExtractedFigure {
  /** The figure exactly as it appears in the text. */
  raw: string;
  /** Its numeric value, with any magnitude word applied. */
  value: number;
}

/**
 * Pulls figures out of markdown prose. Matches a number, optionally with
 * thousands separators and decimals, optionally followed by a magnitude word
 * or a percent sign.
 */
export function extractFigures(body: string): ExtractedFigure[] {
  // Strip markdown link targets and inline code — URLs and code contain
  // digits that are not claims about the world.
  const prose = body
    .replace(/\]\([^)]*\)/g, ']')
    .replace(/`[^`]*`/g, '')
    .replace(/https?:\/\/\S+/g, '');

  const pattern =
    /(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(billion|million|thousand|bn|m\b|k\b|%)?/gi;

  const figures: ExtractedFigure[] = [];
  for (const match of prose.matchAll(pattern)) {
    const [raw, numeral, magnitude] = match;
    const base = Number(numeral.replace(/,/g, ''));
    if (!Number.isFinite(base)) continue;

    // A bare 4-digit number with no magnitude word is a year, not a statistic.
    if (!magnitude && YEAR_PATTERN.test(numeral)) continue;

    const trailing = prose.slice((match.index ?? 0) + raw.length);
    if (!magnitude && TIME_UNIT_PATTERN.test(trailing)) continue;

    figures.push({ raw: raw.trim(), value: applyMagnitude(base, magnitude) });
  }
  return figures;
}

function applyMagnitude(base: number, magnitude?: string): number {
  switch (magnitude?.toLowerCase()) {
    case 'billion':
    case 'bn':
      return base * BILLION;
    case 'million':
    case 'm':
      return base * MILLION;
    case 'thousand':
    case 'k':
      return base * THOUSAND;
    default:
      return base;
  }
}

/** Every numeric value the model was actually given. */
export function allowedValues(input: BriefInput): number[] {
  const values: number[] = [];

  for (const observation of input.observations) {
    values.push(observation.value);
  }

  if (input.score.fundingGapPct !== null) {
    // Stored as a 0..1 share; a brief will legitimately write it as a
    // percentage, so both forms have to be traceable.
    values.push(input.score.fundingGapPct, input.score.fundingGapPct * 100);
  }

  // The number of observations and history points are legitimately quotable
  // ("across four data sources", "over six weeks of observations").
  values.push(input.observations.length, input.history.length);

  return values;
}

function isTraceable(figure: ExtractedFigure, allowed: number[]): boolean {
  return allowed.some((candidate) => {
    if (candidate === figure.value) return true;
    if (candidate === 0) return false;
    const drift = Math.abs(candidate - figure.value) / Math.abs(candidate);
    return drift <= RELATIVE_TOLERANCE;
  });
}

/**
 * Normalized scores are excluded from `allowedValues` on purpose. The prompt
 * forbids quoting them as statistics, so a 0-1 score appearing as a figure in
 * the body is itself a violation — treating it as "allowed" would let the
 * model present a relative ranking to a donor as though it were a measurement.
 *
 * Small integers below this threshold are skipped instead, since ordinals in
 * prose ("three angles", "2.") are not statistical claims.
 */
const ORDINAL_THRESHOLD = 10;

export function validateGrounding(body: string, input: BriefInput): GroundingResult {
  const allowed = allowedValues(input);
  const unsupported = new Set<string>();

  for (const figure of extractFigures(body)) {
    if (figure.value < ORDINAL_THRESHOLD && Number.isInteger(figure.value)) continue;
    if (isTraceable(figure, allowed)) continue;
    unsupported.add(figure.raw);
  }

  return {
    grounded: unsupported.size === 0,
    unsupportedFigures: [...unsupported],
  };
}
