import type { Crisis, IsoDateTime, ScoreHistory, SourceObservation } from './crisis.js';

/** The three audiences Lumen generates for. */
export type BriefAudience = 'journalist' | 'donor' | 'ngo';

/**
 * Everything the content-generation agent is allowed to know.
 * The agent receives this and nothing else — if a fact is not reachable from
 * this object, it may not appear in the output. That is the whole grounding
 * contract, and `validateGrounding` enforces it in code rather than trusting
 * the prompt alone.
 */
export interface BriefInput {
  crisis: Crisis;
  history: ScoreHistory;
  sources: SourceObservation[];
}

/** A statistic the model claims to have used, traced back to its origin. */
export interface StatCitation {
  /** The figure as it appears in the generated body, e.g. "8.1 million". */
  value: string;
  /** Which source observation or crisis field it came from. */
  from: string;
  source: SourceObservation['source'] | 'computed';
}

export interface Brief {
  briefId: string;
  crisisId: string;
  audience: BriefAudience;
  headline: string;
  /** Markdown body. Every figure in here must appear in `statsUsed`. */
  body: string;
  statsUsed: StatCitation[];
  generatedAt: IsoDateTime;
  /** Model identifier used, recorded so regenerations are comparable. */
  model: string;
}

/** Result of checking a generated brief against its input payload. */
export interface GroundingResult {
  grounded: boolean;
  /** Figures found in the body that do not trace back to the input. */
  unsupportedFigures: string[];
}
