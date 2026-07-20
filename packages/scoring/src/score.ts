import type { Iso3, ObservationMetric } from '@lumen/shared-types';
import { NEUTRAL_SCORE, normalizeCohort, weightedMean } from './normalize.js';

/**
 * Bump this whenever the formula or its weights change.
 *
 * It is persisted on every score row, so old scores stay interpretable and two
 * versions can be compared over the same period instead of one silently
 * overwriting the other.
 */
export const ALGORITHM_VERSION = 'v1.0.0';

/** One crisis's raw readings for a single scoring run. Null = no data. */
export interface CohortMember {
  crisisId: string;
  iso3: Iso3;
  observations: Partial<Record<ObservationMetric, number>>;
}

export interface ScoringOptions {
  /**
   * How much underfunding amplifies the gap. At the default 0.5, a fully
   * unfunded appeal multiplies the raw gap by 1.5.
   *
   * Underfunding *amplifies* rather than *adds* deliberately: it is evidence
   * about an existing gap, not an independent reason to care. Adding it would
   * let a well-covered crisis with a shaky appeal outrank an invisible one.
   */
  fundingWeight?: number;
  /** Relative contributions to need_score. Re-normalized over available data. */
  needWeights?: {
    displacement?: number;
    appealSize?: number;
    disasterCount?: number;
  };
}

const DEFAULT_OPTIONS = {
  fundingWeight: 0.5,
  needWeights: {
    displacement: 0.5,
    appealSize: 0.3,
    disasterCount: 0.2,
  },
} as const;

/** The exact inputs behind one score, persisted so any number is explainable. */
export interface ScoreInputs {
  displacedPersons: number | null;
  appealRequirementsUsd: number | null;
  activeDisasterCount: number | null;
  coverageVolumePct: number | null;
  appealFundedPct: number | null;
  normalized: {
    displacement: number | null;
    appealSize: number | null;
    disasterCount: number | null;
    coverage: number | null;
  };
  cohortSize: number;
}

export interface CrisisScoreResult {
  crisisId: string;
  iso3: Iso3;
  needScore: number;
  coverageScore: number;
  fundingGapPct: number | null;
  attentionGapScore: number;
  algorithmVersion: string;
  inputs: ScoreInputs;
  /** Non-fatal data-quality notes, surfaced up to the ingestion response. */
  warnings: string[];
}

/**
 * Pull one metric across the cohort, normalize the members that have it, and
 * map results back by index. Members missing the metric stay null rather than
 * being imputed — see `weightedMean` for why that distinction matters.
 */
function normalizeMetric(
  cohort: readonly CohortMember[],
  metric: ObservationMetric,
): (number | null)[] {
  const presentIndices: number[] = [];
  const presentValues: number[] = [];

  cohort.forEach((member, i) => {
    const value = member.observations[metric];
    if (value !== undefined && Number.isFinite(value) && value >= 0) {
      presentIndices.push(i);
      presentValues.push(value);
    }
  });

  const normalized = normalizeCohort(presentValues);
  const result: (number | null)[] = new Array(cohort.length).fill(null);
  presentIndices.forEach((originalIndex, i) => {
    result[originalIndex] = normalized[i] ?? null;
  });

  return result;
}

/**
 * Score a cohort of crises against each other.
 *
 * Cohort-relative by design: normalization is min-max across the crises scored
 * in this run, so results are comparable *within* a run but drift across runs
 * as the cohort changes. `inputs` carries the raw values precisely so scores
 * can be recomputed on a fixed scale later without re-hitting rate-limited
 * upstream APIs.
 *
 * Pure — no I/O, no clock, no randomness. Same cohort in, same scores out.
 */
export function scoreCohort(
  cohort: readonly CohortMember[],
  options: ScoringOptions = {},
): CrisisScoreResult[] {
  if (cohort.length === 0) return [];

  const fundingWeight = options.fundingWeight ?? DEFAULT_OPTIONS.fundingWeight;
  const needWeights = { ...DEFAULT_OPTIONS.needWeights, ...options.needWeights };

  const displacement = normalizeMetric(cohort, 'displaced_persons');
  const appealSize = normalizeMetric(cohort, 'appeal_requirements_usd');
  const disasterCount = normalizeMetric(cohort, 'active_disaster_count');
  const coverage = normalizeMetric(cohort, 'coverage_volume_pct');

  return cohort.map((member, i) => {
    const warnings: string[] = [];

    const normDisplacement = displacement[i] ?? null;
    const normAppealSize = appealSize[i] ?? null;
    const normDisasterCount = disasterCount[i] ?? null;
    const normCoverage = coverage[i] ?? null;

    const need = weightedMean([
      { value: normDisplacement, weight: needWeights.displacement ?? 0 },
      { value: normAppealSize, weight: needWeights.appealSize ?? 0 },
      { value: normDisasterCount, weight: needWeights.disasterCount ?? 0 },
    ]);

    if (need === null) {
      warnings.push(
        `${member.iso3}: no need signal from any source — scored neutral, not zero`,
      );
    }
    if (normCoverage === null) {
      warnings.push(
        `${member.iso3}: no GDELT coverage data — coverage scored neutral, ` +
          `so the gap for this crisis is need-driven only`,
      );
    }

    const needScore = need ?? NEUTRAL_SCORE;
    const coverageScore = normCoverage ?? NEUTRAL_SCORE;

    // Funding gap is the share *unfunded*, so it reads in the same direction
    // as every other signal here: higher means worse.
    const fundedPct = member.observations.appeal_funded_pct;
    let fundingGapPct: number | null = null;
    if (fundedPct !== undefined && Number.isFinite(fundedPct)) {
      if (fundedPct < 0 || fundedPct > 1) {
        warnings.push(
          `${member.iso3}: appeal_funded_pct ${fundedPct} outside 0..1 — clamped`,
        );
      }
      fundingGapPct = 1 - Math.min(1, Math.max(0, fundedPct));
    }

    const rawGap = needScore - coverageScore;
    const amplifier = fundingGapPct === null ? 1 : 1 + fundingWeight * fundingGapPct;
    const attentionGapScore = rawGap * amplifier;

    return {
      crisisId: member.crisisId,
      iso3: member.iso3,
      needScore,
      coverageScore,
      fundingGapPct,
      attentionGapScore,
      algorithmVersion: ALGORITHM_VERSION,
      inputs: {
        displacedPersons: member.observations.displaced_persons ?? null,
        appealRequirementsUsd: member.observations.appeal_requirements_usd ?? null,
        activeDisasterCount: member.observations.active_disaster_count ?? null,
        coverageVolumePct: member.observations.coverage_volume_pct ?? null,
        appealFundedPct: fundedPct ?? null,
        normalized: {
          displacement: normDisplacement,
          appealSize: normAppealSize,
          disasterCount: normDisasterCount,
          coverage: normCoverage,
        },
        cohortSize: cohort.length,
      },
      warnings,
    };
  });
}

/**
 * Rank scored crises, most under-reported first.
 *
 * ISO3 breaks ties so the ordering is stable across runs — without it, two
 * equal scores could swap places between runs and manufacture a phantom
 * `rankDelta` that the dashboard would present as real movement.
 */
export function rankByAttentionGap(
  scores: readonly CrisisScoreResult[],
): (CrisisScoreResult & { rank: number })[] {
  return [...scores]
    .sort((a, b) => {
      const diff = b.attentionGapScore - a.attentionGapScore;
      return diff !== 0 ? diff : a.iso3.localeCompare(b.iso3);
    })
    .map((score, i) => ({ ...score, rank: i + 1 }));
}
