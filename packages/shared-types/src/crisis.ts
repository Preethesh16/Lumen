/**
 * The API contract between `apps/api` (Preethesh) and `apps/web` +
 * the content-generation agent (Deepthi).
 *
 * Changing an exported shape here is a breaking change for the other side.
 * Note it in progress.md under "Decisions made" when you do.
 */

/** ISO-8601 timestamp string, e.g. "2026-07-20T09:30:00.000Z". */
export type IsoDateTime = string;

/** ISO 3166-1 alpha-3 country code, e.g. "SDN". */
export type CountryCode = string;

/**
 * A score normalized to the 0-1 range at the API boundary.
 * Raw source values (article counts, refugee headcounts) are normalized by
 * the scoring function before they cross into the API, so the frontend never
 * has to know a source's native scale.
 */
export type NormalizedScore = number;

export interface Crisis {
  /** Stable identifier, unique per crisis. */
  crisisId: string;
  /** Human-readable name, e.g. "Sudan conflict displacement". */
  name: string;
  country: string;
  countryCode: CountryCode;

  /** Severity of need, normalized 0-1. Higher = greater need. */
  needScore: NormalizedScore;
  /** Media coverage volume, normalized 0-1. Higher = more covered. */
  coverageScore: NormalizedScore;

  /**
   * needScore - coverageScore, optionally weighted by underfunding.
   * Signed and in the range -1..1: positive means under-reported relative to
   * need (what Lumen exists to surface), negative means over-covered.
   */
  attentionGapScore: number;

  /**
   * Percentage of the UN appeal that remains unfunded, 0-100.
   * Undefined when OCHA FTS has no appeal on record for this crisis —
   * absence is not zero, and the UI must not render it as 0%.
   */
  fundingGapPct?: number;

  /** When the score was last computed. */
  computedAt: IsoDateTime;
}

/** One historical score observation, for the trend chart. */
export interface ScoreHistoryPoint {
  computedAt: IsoDateTime;
  needScore: NormalizedScore;
  coverageScore: NormalizedScore;
  attentionGapScore: number;
  fundingGapPct?: number;
}

export interface ScoreHistory {
  crisisId: string;
  points: ScoreHistoryPoint[];
}

/** `GET /crises/:id` — detail view payload. */
export interface CrisisDetail {
  crisis: Crisis;
  history: ScoreHistory;
  /** Raw evidence rows behind the score, shown in the detail view and used
   *  as grounding input for brief generation. */
  sources: SourceObservation[];
}

/** A single raw figure retrieved from one upstream data source. */
export interface SourceObservation {
  source: 'gdelt' | 'reliefweb' | 'unhcr' | 'ocha-fts';
  /** What this figure measures, e.g. "articles in last 24h". */
  label: string;
  value: number;
  unit: string;
  retrievedAt: IsoDateTime;
  /** Link back to the upstream record where available. */
  url?: string;
}
