/**
 * The API contract between apps/api (Preethesh) and apps/web (Deepthi).
 *
 * Shape changes here break the other side silently at runtime, so treat this
 * file as jointly owned: propose, agree, then change.
 *
 * Convention: dates crossing the wire are ISO 8601 strings, never Date
 * objects, because JSON has no date type and `new Date(undefined)` fails
 * quietly. `YYYY-MM-DD` for calendar days, full ISO datetime for instants.
 */

/** ISO 3166-1 alpha-3 country code, e.g. "SDN". The join key across all sources. */
export type Iso3 = string;

/** ISO 8601 calendar day, `YYYY-MM-DD`. */
export type IsoDate = string;

/** ISO 8601 instant, e.g. `2026-07-20T09:00:00.000Z`. */
export type IsoDateTime = string;

export const SOURCE_NAMES = ['gdelt', 'reliefweb', 'unhcr', 'fts'] as const;
export type SourceName = (typeof SOURCE_NAMES)[number];

export const BRIEF_AUDIENCES = ['journalist', 'donor', 'ngo'] as const;
export type BriefAudience = (typeof BRIEF_AUDIENCES)[number];

/**
 * Metrics written to source_observations. Kept as a closed union so a typo in
 * an ingestion workflow fails typecheck instead of silently creating a new
 * metric series that nothing reads.
 */
export const OBSERVATION_METRICS = [
  /** GDELT: share of global news volume mentioning this country, 0..100. */
  'coverage_volume_pct',
  /** UNHCR: total people of concern / forcibly displaced. */
  'displaced_persons',
  /** OCHA FTS: share of the appeal that is funded, 0..1. */
  'appeal_funded_pct',
  /** OCHA FTS: total appeal requirement in USD. */
  'appeal_requirements_usd',
  /** ReliefWeb: count of currently-active disasters. */
  'active_disaster_count',
] as const;
export type ObservationMetric = (typeof OBSERVATION_METRICS)[number];

// ---------------------------------------------------------------------------
// Core entities
// ---------------------------------------------------------------------------

export interface Crisis {
  id: string;
  iso3: Iso3;
  name: string;
  region: string | null;
  isActive: boolean;
}

export interface CrisisScore {
  id: string;
  crisisId: string;
  /** 0..1, cohort-relative. Higher = greater humanitarian need. */
  needScore: number;
  /** 0..1, cohort-relative. Higher = more media attention. */
  coverageScore: number;
  /** 0..1 — share of the appeal *unfunded*. Null when FTS has no appeal. */
  fundingGapPct: number | null;
  /**
   * Roughly -1.5..1.5. Positive = under-reported relative to need, which is
   * the entire point of the product. Not clamped: the bound moves if the
   * funding weight changes, and clamping would hide that.
   */
  attentionGapScore: number;
  /** Which formula produced this. Lets old scores survive a formula change. */
  algorithmVersion: string;
  scoredFor: IsoDate;
  computedAt: IsoDateTime;
}

/** A crisis plus its latest score and position — what the ranked list renders. */
export interface RankedCrisis extends Crisis {
  latestScore: CrisisScore;
  /** 1-based position in the current ranking. */
  rank: number;
  /**
   * Positions gained since the previous scored run. Positive = climbing
   * (more under-reported). Null when there is no previous run to compare to,
   * which is the normal state on day one.
   */
  rankDelta: number | null;
}

export interface ScoreHistoryPoint {
  scoredFor: IsoDate;
  needScore: number;
  coverageScore: number;
  attentionGapScore: number;
}

/** A single upstream reading — powers "where did this number come from". */
export interface ObservationPoint {
  source: SourceName;
  metric: ObservationMetric;
  value: number;
  observedAt: IsoDate;
}

export interface CrisisDetail extends Crisis {
  latestScore: CrisisScore;
  history: ScoreHistoryPoint[];
  latestObservations: ObservationPoint[];
  briefs: Brief[];
}

export interface Brief {
  id: string;
  crisisId: string;
  /**
   * The exact score row this brief was generated from. Every statistic in
   * `content` must be derivable from this row and its observations — that
   * traceability is what stops the model inventing numbers.
   */
  scoreId: string | null;
  audience: BriefAudience;
  content: string;
  model: string;
  promptVersion: string;
  generatedAt: IsoDateTime;
}

export type DeliveryChannel = 'telegram' | 'email';
export type DeliveryStatus = 'sent' | 'skipped' | 'failed';

export interface DeliveryResult {
  channel: DeliveryChannel;
  status: DeliveryStatus;
  message: string;
}

export interface GenerateBriefResponse {
  data: Brief;
  usedFallback: boolean;
  warning: string | null;
}

export interface DeliverBriefResponse {
  data: DeliveryResult[];
}

export interface BriefRunResult {
  crisisId: string;
  iso3: Iso3;
  brief: Brief;
  usedFallback: boolean;
  delivery: DeliveryResult[];
}

export interface RunBriefsResponse {
  data: BriefRunResult[];
}

// ---------------------------------------------------------------------------
// API responses
// ---------------------------------------------------------------------------

export interface ListCrisesResponse {
  data: RankedCrisis[];
  /** The run these rankings come from. Null when nothing has been scored yet. */
  scoredFor: IsoDate | null;
  count: number;
}

export interface GetCrisisResponse {
  data: CrisisDetail;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}

// ---------------------------------------------------------------------------
// Ingestion contract — n8n → POST /webhook/n8n-score-update
// ---------------------------------------------------------------------------

export interface ObservationInput {
  iso3: Iso3;
  source: SourceName;
  metric: ObservationMetric;
  value: number;
  observedAt: IsoDate;
  /** Optional slice of the upstream payload, kept for audit. */
  raw?: unknown;
}

export interface ScoreUpdatePayload {
  /**
   * Correlates every observation in this batch to one n8n execution, so a
   * partial run is visible in ingestion_runs rather than looking like success.
   */
  runId?: string;
  source: SourceName;
  observations: ObservationInput[];
  /**
   * Whether to recompute scores after ingesting. The last of the four daily
   * workflows sets this; the others don't, so scoring runs once per cohort
   * rather than four times on partial data.
   */
  triggerScoring?: boolean;
}

export interface ScoreUpdateResponse {
  runId: string;
  observationsWritten: number;
  scoresComputed: number;
  /** Non-fatal problems: unknown ISO3s, out-of-range values, duplicates. */
  warnings: string[];
}
