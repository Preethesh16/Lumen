import type {
  BriefAudience,
  CrisisDetail,
  CrisisScore,
  ObservationPoint,
  ScoreHistoryPoint,
  SourceName,
} from '@lumen/shared-types';

/**
 * Types internal to the content-generation agent.
 *
 * These are deliberately NOT in `packages/shared-types`. That package is the
 * API contract between `apps/api` and `apps/web`; the structure below never
 * crosses that boundary. Adding it there would make the contract broader than
 * the thing it actually contracts.
 *
 * The exception worth flagging: `statsUsed` is real output that should be
 * persisted, and `Brief.content` in the shared contract is a single string
 * with nowhere to put it. See docs/architecture.md — open question.
 */

/**
 * Everything the model is allowed to know about a crisis.
 *
 * If a fact is not reachable from this object, it may not appear in the
 * output. `validateGrounding` enforces that against this exact structure,
 * so anything added here widens what the model may legitimately say.
 */
export interface BriefInput {
  crisisName: string;
  country: string;
  iso3: string;
  score: CrisisScore;
  history: ScoreHistoryPoint[];
  observations: ObservationPoint[];
}

/** Builds the generation payload from an API detail response. */
export function toBriefInput(detail: CrisisDetail): BriefInput {
  return {
    crisisName: detail.name,
    country: detail.region ?? detail.name,
    iso3: detail.iso3,
    score: detail.latestScore,
    history: detail.history,
    observations: detail.latestObservations,
  };
}

/** A statistic the model claims to have used, traced to its origin. */
export interface StatCitation {
  /** The figure as it appears in the generated body, e.g. "1.2 million". */
  value: string;
  /** Which observation or score field it came from. */
  from: string;
  source: SourceName | 'computed';
}

/**
 * The agent's structured output, before it is flattened for storage.
 *
 * `statsUsed` is the visible evidence that grounding happened — it drives the
 * provenance list under each brief in the UI.
 */
export interface GeneratedBrief {
  crisisId: string;
  scoreId: string;
  audience: BriefAudience;
  headline: string;
  /** Markdown. Every figure here must appear in `statsUsed`. */
  body: string;
  statsUsed: StatCitation[];
  model: string;
  promptVersion: string;
  generatedAt: string;
}

/** Result of checking a generated brief against its input payload. */
export interface GroundingResult {
  grounded: boolean;
  /** Figures in the body that do not trace back to the input. */
  unsupportedFigures: string[];
}
