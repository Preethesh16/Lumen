import { describe, expect, it } from 'vitest';
import { extractFigures, validateGrounding } from '../grounding';
import { noFundingDataInput, sudanInput } from './fixtures';

describe('extractFigures', () => {
  it('reads thousands separators and magnitude words', () => {
    const figures = extractFigures('1,247,891 displaced, up from 1.2 million and 512k before.');
    expect(figures.map((f) => f.value)).toEqual([1_247_891, 1_200_000, 512_000]);
  });

  it('ignores years, which are dates rather than statistics', () => {
    expect(extractFigures('Fighting has continued since 2023.')).toHaveLength(0);
  });

  it('ignores numbers attached to a time unit', () => {
    // Regression: "37 articles in the last 24 hours" was flagging the 24 as an
    // unsupported statistic, which would have failed almost every real brief.
    const figures = extractFigures('37 articles in the last 24 hours, over 3 weeks.');
    expect(figures.map((f) => f.value)).toEqual([37]);
  });

  it('ignores digits inside URLs and markdown link targets', () => {
    const body = 'See [the data](https://api.unhcr.org/population/v1/?year=2026&limit=5000).';
    expect(extractFigures(body)).toHaveLength(0);
  });
});

describe('validateGrounding — accepts what the model was given', () => {
  it('passes a body quoting exact payload figures', () => {
    const body = 'UNHCR records 1,247,891 people displaced. GDELT logged 37 articles in 24 hours.';
    expect(validateGrounding(body, sudanInput)).toEqual({
      grounded: true,
      unsupportedFigures: [],
    });
  });

  it('permits the rounding the prompt explicitly allows', () => {
    const body = 'Roughly 1.2 million people have been displaced.';
    expect(validateGrounding(body, sudanInput).grounded).toBe(true);
  });

  it('passes prose describing scores qualitatively rather than quoting them', () => {
    const body =
      'This is among the least-covered crises Lumen tracks, despite need remaining near the ' +
      'top of the set. Only 37 articles appeared in the last 24 hours.';
    expect(validateGrounding(body, sudanInput).grounded).toBe(true);
  });
});

describe('validateGrounding — catches what the model invented', () => {
  it('flags a fabricated casualty figure', () => {
    const body = 'UNHCR records 1,247,891 displaced, and an estimated 14,300 people have died.';
    const result = validateGrounding(body, sudanInput);

    expect(result.grounded).toBe(false);
    expect(result.unsupportedFigures).toContain('14,300');
  });

  it('flags a plausible-looking figure the payload never contained', () => {
    const body = 'Some 2.4 million people are in need of humanitarian assistance.';
    const result = validateGrounding(body, sudanInput);

    expect(result.grounded).toBe(false);
    expect(result.unsupportedFigures).toContain('2.4 million');
  });

  it('flags a derived per-capita rate the model computed itself', () => {
    // 1,247,891 across a population the payload never stated.
    const body = 'That is 2,847 displaced people per 100,000 residents.';
    expect(validateGrounding(body, sudanInput).grounded).toBe(false);
  });

  it('flags an invented funding figure when no appeal data exists', () => {
    // The most consequential failure mode: a donor document with a made-up
    // funding gap for a crisis that has no appeal on record at all.
    const body = 'The appeal remains 71% unfunded.';
    const result = validateGrounding(body, noFundingDataInput);

    expect(result.grounded).toBe(false);
    expect(result.unsupportedFigures).toContain('71%');
  });

  it('flags a normalized score quoted as though it were a measurement', () => {
    // 0.91 is real and in the payload, but presenting a relative ranking to a
    // donor as a statistic is exactly what the prompt forbids.
    const body = 'Sudan has a need score of 0.91, the highest we track.';
    expect(validateGrounding(body, sudanInput).grounded).toBe(false);
  });
});

describe('validateGrounding — prose that is not a statistical claim', () => {
  it('does not flag small ordinals used in prose', () => {
    const body = 'Three story angles follow. 1. Displacement. 2. Funding. 3. Access.';
    expect(validateGrounding(body, sudanInput).grounded).toBe(true);
  });

  it('accepts a brief that states missing data instead of inventing it', () => {
    const body =
      'No OCHA appeal funding data was available for this crisis, so the underfunding ' +
      'signal could not be assessed. UNHCR records 512,400 people displaced.';
    expect(validateGrounding(body, noFundingDataInput).grounded).toBe(true);
  });

  it('handles an empty body without throwing', () => {
    expect(validateGrounding('', sudanInput)).toEqual({
      grounded: true,
      unsupportedFigures: [],
    });
  });
});
