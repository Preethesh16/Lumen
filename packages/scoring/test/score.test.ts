import { describe, expect, it } from 'vitest';
import { NEUTRAL_SCORE } from '../src/normalize.js';
import {
  ALGORITHM_VERSION,
  type CohortMember,
  rankByAttentionGap,
  scoreCohort,
} from '../src/score.js';

/** A crisis with high need and low media coverage — the target of the product. */
const underReported: CohortMember = {
  crisisId: 'c-under',
  iso3: 'SDN',
  observations: {
    displaced_persons: 10_000_000,
    appeal_requirements_usd: 2_700_000_000,
    active_disaster_count: 4,
    coverage_volume_pct: 0.01,
    appeal_funded_pct: 0.15,
  },
};

/** High need, saturated media coverage. */
const wellCovered: CohortMember = {
  crisisId: 'c-covered',
  iso3: 'UKR',
  observations: {
    displaced_persons: 9_500_000,
    appeal_requirements_usd: 2_500_000_000,
    active_disaster_count: 3,
    coverage_volume_pct: 8.5,
    appeal_funded_pct: 0.65,
  },
};

/** Low need, low coverage — proportionate, should sit in the middle. */
const quiet: CohortMember = {
  crisisId: 'c-quiet',
  iso3: 'VUT',
  observations: {
    displaced_persons: 12_000,
    appeal_requirements_usd: 15_000_000,
    active_disaster_count: 1,
    coverage_volume_pct: 0.005,
    appeal_funded_pct: 0.9,
  },
};

describe('scoreCohort — core behaviour', () => {
  it('returns an empty array for an empty cohort', () => {
    // First run against an empty database. Must not throw.
    expect(scoreCohort([])).toEqual([]);
  });

  it('ranks the under-reported crisis above the well-covered one', () => {
    // The single property the entire product rests on.
    const [sdn, ukr] = scoreCohort([underReported, wellCovered]);
    expect(sdn!.attentionGapScore).toBeGreaterThan(ukr!.attentionGapScore);
  });

  it('gives a well-covered crisis a negative gap', () => {
    const scores = scoreCohort([underReported, wellCovered, quiet]);
    const ukr = scores.find((s) => s.iso3 === 'UKR')!;
    expect(ukr.attentionGapScore).toBeLessThan(0);
  });

  it('keeps need and coverage inside 0..1', () => {
    for (const score of scoreCohort([underReported, wellCovered, quiet])) {
      expect(score.needScore).toBeGreaterThanOrEqual(0);
      expect(score.needScore).toBeLessThanOrEqual(1);
      expect(score.coverageScore).toBeGreaterThanOrEqual(0);
      expect(score.coverageScore).toBeLessThanOrEqual(1);
    }
  });

  it('stamps the algorithm version on every score', () => {
    for (const score of scoreCohort([underReported, wellCovered])) {
      expect(score.algorithmVersion).toBe(ALGORITHM_VERSION);
    }
  });

  it('preserves raw inputs so every score is explainable', () => {
    const [sdn] = scoreCohort([underReported, wellCovered]);
    expect(sdn!.inputs.displacedPersons).toBe(10_000_000);
    expect(sdn!.inputs.coverageVolumePct).toBe(0.01);
    expect(sdn!.inputs.cohortSize).toBe(2);
  });

  it('is pure — identical input yields identical output', () => {
    const a = scoreCohort([underReported, wellCovered, quiet]);
    const b = scoreCohort([underReported, wellCovered, quiet]);
    expect(a).toEqual(b);
  });
});

describe('scoreCohort — degenerate cohorts', () => {
  it('scores a single-member cohort neutrally rather than NaN', () => {
    const [only] = scoreCohort([underReported]);
    expect(only!.needScore).toBe(NEUTRAL_SCORE);
    expect(only!.coverageScore).toBe(NEUTRAL_SCORE);
    // Neutral need minus neutral coverage is zero gap — the honest answer when
    // there is nothing to compare against.
    expect(only!.attentionGapScore).toBe(0);
    expect(Number.isNaN(only!.attentionGapScore)).toBe(false);
  });

  it('handles a cohort where every member has identical values', () => {
    const clone = { ...underReported, crisisId: 'c-2', iso3: 'TCD' };
    for (const score of scoreCohort([underReported, clone])) {
      expect(Number.isNaN(score.attentionGapScore)).toBe(false);
      expect(score.needScore).toBe(NEUTRAL_SCORE);
    }
  });

  it('scores a crisis with no observations at all without throwing', () => {
    const blank: CohortMember = { crisisId: 'c-blank', iso3: 'XXX', observations: {} };
    const [score] = scoreCohort([blank, underReported]);
    expect(score!.needScore).toBe(NEUTRAL_SCORE);
    expect(score!.coverageScore).toBe(NEUTRAL_SCORE);
    expect(score!.warnings.length).toBeGreaterThan(0);
  });

  it('ignores zero-valued observations without treating them as missing', () => {
    const zeroed: CohortMember = {
      crisisId: 'c-zero',
      iso3: 'ZZZ',
      observations: { displaced_persons: 0, coverage_volume_pct: 0 },
    };
    const [score] = scoreCohort([zeroed, underReported]);
    expect(score!.inputs.normalized.displacement).toBe(0);
    expect(Number.isNaN(score!.needScore)).toBe(false);
  });
});

describe('scoreCohort — missing and malformed data', () => {
  it('scores a crisis with no funding data', () => {
    const noFunding: CohortMember = {
      crisisId: 'c-nf',
      iso3: 'MMR',
      observations: { displaced_persons: 1_000_000, coverage_volume_pct: 0.02 },
    };
    const [score] = scoreCohort([noFunding, wellCovered]);
    expect(score!.fundingGapPct).toBeNull();
    expect(Number.isFinite(score!.attentionGapScore)).toBe(true);
  });

  it('does not penalise a crisis for a missing need source', () => {
    // A country absent from UNHCR must not be scored as if it had zero need —
    // data-poor crises are exactly the ones this product exists to surface.
    const partial: CohortMember = {
      crisisId: 'c-partial',
      iso3: 'HTI',
      observations: { appeal_requirements_usd: 2_600_000_000, coverage_volume_pct: 0.02 },
    };
    const scores = scoreCohort([partial, underReported, wellCovered]);
    const hti = scores.find((s) => s.iso3 === 'HTI')!;

    expect(hti.inputs.normalized.displacement).toBeNull();
    expect(hti.needScore).toBeGreaterThan(0.3);
    expect(hti.warnings.length).toBe(0);
  });

  it('warns and clamps when appeal_funded_pct is out of range', () => {
    const bad: CohortMember = {
      crisisId: 'c-bad',
      iso3: 'AFG',
      observations: { displaced_persons: 500_000, appeal_funded_pct: 1.4 },
    };
    const [score] = scoreCohort([bad, underReported]);
    expect(score!.fundingGapPct).toBe(0);
    expect(score!.warnings.some((w) => w.includes('outside 0..1'))).toBe(true);
  });

  it('warns when a crisis has no coverage data', () => {
    const noCoverage: CohortMember = {
      crisisId: 'c-nc',
      iso3: 'YEM',
      observations: { displaced_persons: 4_500_000 },
    };
    const [score] = scoreCohort([noCoverage, underReported]);
    expect(score!.warnings.some((w) => w.includes('no GDELT coverage'))).toBe(true);
  });
});

describe('scoreCohort — funding amplification', () => {
  it('amplifies the gap for an underfunded crisis', () => {
    const funded = { ...underReported, crisisId: 'c-f', observations: { ...underReported.observations, appeal_funded_pct: 1 } };
    const unfunded = { ...underReported, crisisId: 'c-u', iso3: 'TCD', observations: { ...underReported.observations, appeal_funded_pct: 0 } };

    const scores = scoreCohort([funded, unfunded, wellCovered]);
    const a = scores.find((s) => s.crisisId === 'c-f')!;
    const b = scores.find((s) => s.crisisId === 'c-u')!;

    // Identical need and coverage; only funding differs.
    expect(a.needScore).toBe(b.needScore);
    expect(b.attentionGapScore).toBeGreaterThan(a.attentionGapScore);
  });

  it('amplifies rather than adds, so funding cannot flip the sign of a gap', () => {
    // A well-covered crisis must stay negative no matter how underfunded it is —
    // underfunding is evidence about a gap, not a gap in itself.
    const desperate = { ...wellCovered, observations: { ...wellCovered.observations, appeal_funded_pct: 0 } };
    const scores = scoreCohort([underReported, desperate]);
    const ukr = scores.find((s) => s.iso3 === 'UKR')!;
    expect(ukr.attentionGapScore).toBeLessThan(0);
  });

  it('respects a custom funding weight', () => {
    const light = scoreCohort([underReported, wellCovered], { fundingWeight: 0 });
    const heavy = scoreCohort([underReported, wellCovered], { fundingWeight: 2 });
    expect(heavy[0]!.attentionGapScore).toBeGreaterThan(light[0]!.attentionGapScore);
  });
});

describe('rankByAttentionGap', () => {
  it('ranks descending by gap, 1-based', () => {
    const ranked = rankByAttentionGap(scoreCohort([wellCovered, underReported, quiet]));
    expect(ranked[0]!.iso3).toBe('SDN');
    expect(ranked[0]!.rank).toBe(1);
    expect(ranked.at(-1)!.iso3).toBe('UKR');
  });

  it('breaks ties on iso3 so ordering is stable across runs', () => {
    // Without a deterministic tiebreak, equal scores could swap between runs
    // and the dashboard would report phantom rank movement as real.
    const tied = scoreCohort([
      { crisisId: 'a', iso3: 'ZWE', observations: { displaced_persons: 100 } },
      { crisisId: 'b', iso3: 'AFG', observations: { displaced_persons: 100 } },
    ]);
    expect(rankByAttentionGap(tied).map((s) => s.iso3)).toEqual(['AFG', 'ZWE']);
    expect(rankByAttentionGap([...tied].reverse()).map((s) => s.iso3)).toEqual(['AFG', 'ZWE']);
  });

  it('does not mutate its input', () => {
    const scores = scoreCohort([wellCovered, underReported]);
    const before = scores.map((s) => s.crisisId);
    rankByAttentionGap(scores);
    expect(scores.map((s) => s.crisisId)).toEqual(before);
  });

  it('returns an empty array for no scores', () => {
    expect(rankByAttentionGap([])).toEqual([]);
  });
});
