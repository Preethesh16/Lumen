import {
  bigint,
  bigserial,
  boolean,
  char,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const sourceNameEnum = pgEnum('source_name', [
  'gdelt',
  'reliefweb',
  'unhcr',
  'fts',
]);

export const runStatusEnum = pgEnum('run_status', [
  'running',
  'success',
  'partial',
  'failed',
]);

export const briefAudienceEnum = pgEnum('brief_audience', [
  'journalist',
  'donor',
  'ngo',
]);

/**
 * A crisis is one country, keyed by ISO3.
 *
 * All four upstream sources are country-keyed; none of GDELT, UNHCR or FTS
 * knows about a ReliefWeb disaster ID. Modelling per-disaster would mean
 * inventing a rule to split one country-level measurement across several rows.
 * Revisit if we add a source with sub-national granularity.
 */
export const crises = pgTable('crises', {
  id: uuid('id').primaryKey().defaultRandom(),
  iso3: char('iso3', { length: 3 }).notNull().unique(),
  name: text('name').notNull(),
  region: text('region'),
  reliefwebId: integer('reliefweb_id'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One row per n8n ingestion execution. Without this, a workflow that fetched
 * three of two hundred countries and gave up looks exactly like a healthy run.
 */
export const ingestionRuns = pgTable('ingestion_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  source: sourceNameEnum('source').notNull(),
  status: runStatusEnum('status').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  recordsWritten: integer('records_written').notNull().default(0),
  error: text('error'),
});

/**
 * Raw normalized readings — the highest-value table in this schema.
 *
 * Keeping observations separate from computed scores means a change to the
 * scoring weights can be backfilled across all history without re-hitting
 * GDELT or ReliefWeb. Without it, a formula tweak either destroys history or
 * burns the rate limit re-fetching it.
 */
export const sourceObservations = pgTable(
  'source_observations',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    crisisId: uuid('crisis_id')
      .notNull()
      .references(() => crises.id, { onDelete: 'cascade' }),
    source: sourceNameEnum('source').notNull(),
    metric: text('metric').notNull(),
    value: numeric('value').notNull(),
    /** The day the data describes — not the day it was fetched. */
    observedAt: date('observed_at').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
    runId: uuid('run_id').references(() => ingestionRuns.id),
    raw: jsonb('raw'),
  },
  (table) => [
    // n8n retries failed nodes. Without this constraint a retry silently
    // double-counts; with it, ingestion is a safe upsert.
    unique('source_observations_natural_key').on(
      table.crisisId,
      table.source,
      table.metric,
      table.observedAt,
    ),
    index('source_observations_lookup_idx').on(
      table.crisisId,
      table.metric,
      table.observedAt.desc(),
    ),
  ],
);

/**
 * Computed scores, append-only.
 *
 * `algorithmVersion` and `inputs` together make every score reproducible and
 * explainable: old scores survive a formula change, and each number a brief
 * cites can be traced back to the values that produced it.
 */
export const crisisScores = pgTable(
  'crisis_scores',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    crisisId: uuid('crisis_id')
      .notNull()
      .references(() => crises.id, { onDelete: 'cascade' }),
    needScore: numeric('need_score', { precision: 5, scale: 4 }).notNull(),
    coverageScore: numeric('coverage_score', { precision: 5, scale: 4 }).notNull(),
    fundingGapPct: numeric('funding_gap_pct', { precision: 5, scale: 4 }),
    /** Roughly -1.5..1.5; the bound moves with the funding weight. */
    attentionGapScore: numeric('attention_gap_score', {
      precision: 6,
      scale: 4,
    }).notNull(),
    algorithmVersion: text('algorithm_version').notNull(),
    inputs: jsonb('inputs').notNull(),
    scoredFor: date('scored_for').notNull(),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('crisis_scores_natural_key').on(
      table.crisisId,
      table.scoredFor,
      table.algorithmVersion,
    ),
    // Serves the ranked-list query: latest run, ordered by gap.
    index('crisis_scores_ranking_idx').on(
      table.scoredFor.desc(),
      table.attentionGapScore.desc(),
    ),
    // Serves the detail/history query.
    index('crisis_scores_history_idx').on(table.crisisId, table.scoredFor.desc()),
    check('need_score_range', sql`${table.needScore} BETWEEN 0 AND 1`),
    check('coverage_score_range', sql`${table.coverageScore} BETWEEN 0 AND 1`),
    check(
      'funding_gap_range',
      sql`${table.fundingGapPct} IS NULL OR ${table.fundingGapPct} BETWEEN 0 AND 1`,
    ),
  ],
);

/**
 * Generated briefs. `scoreId` is the anti-hallucination anchor: every
 * statistic in `content` must be derivable from that score row and its
 * observations.
 */
export const briefs = pgTable(
  'briefs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    crisisId: uuid('crisis_id')
      .notNull()
      .references(() => crises.id, { onDelete: 'cascade' }),
    scoreId: bigint('score_id', { mode: 'number' }).references(() => crisisScores.id, {
      onDelete: 'set null',
    }),
    audience: briefAudienceEnum('audience').notNull(),
    content: text('content').notNull(),
    model: text('model').notNull(),
    promptVersion: text('prompt_version').notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('briefs_crisis_idx').on(table.crisisId, table.generatedAt.desc())],
);

export type CrisisRow = typeof crises.$inferSelect;
export type NewCrisisRow = typeof crises.$inferInsert;
export type ObservationRow = typeof sourceObservations.$inferSelect;
export type NewObservationRow = typeof sourceObservations.$inferInsert;
export type ScoreRow = typeof crisisScores.$inferSelect;
export type NewScoreRow = typeof crisisScores.$inferInsert;
export type BriefRow = typeof briefs.$inferSelect;
export type IngestionRunRow = typeof ingestionRuns.$inferSelect;
