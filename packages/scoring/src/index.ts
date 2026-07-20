export {
  ALGORITHM_VERSION,
  scoreCohort,
  rankByAttentionGap,
  type CohortMember,
  type ScoringOptions,
  type ScoreInputs,
  type CrisisScoreResult,
} from './score.js';

export {
  NEUTRAL_SCORE,
  logTransform,
  minMaxNormalize,
  normalizeCohort,
  weightedMean,
  clamp,
} from './normalize.js';
