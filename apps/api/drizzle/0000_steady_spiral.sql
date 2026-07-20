CREATE TYPE "public"."brief_audience" AS ENUM('journalist', 'donor', 'ngo');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('running', 'success', 'partial', 'failed');--> statement-breakpoint
CREATE TYPE "public"."source_name" AS ENUM('gdelt', 'reliefweb', 'unhcr', 'fts');--> statement-breakpoint
CREATE TABLE "briefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"crisis_id" uuid NOT NULL,
	"score_id" bigint,
	"audience" "brief_audience" NOT NULL,
	"content" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"iso3" char(3) NOT NULL,
	"name" text NOT NULL,
	"region" text,
	"reliefweb_id" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crises_iso3_unique" UNIQUE("iso3")
);
--> statement-breakpoint
CREATE TABLE "crisis_scores" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"crisis_id" uuid NOT NULL,
	"need_score" numeric(5, 4) NOT NULL,
	"coverage_score" numeric(5, 4) NOT NULL,
	"funding_gap_pct" numeric(5, 4),
	"attention_gap_score" numeric(6, 4) NOT NULL,
	"algorithm_version" text NOT NULL,
	"inputs" jsonb NOT NULL,
	"scored_for" date NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crisis_scores_natural_key" UNIQUE("crisis_id","scored_for","algorithm_version"),
	CONSTRAINT "need_score_range" CHECK ("crisis_scores"."need_score" BETWEEN 0 AND 1),
	CONSTRAINT "coverage_score_range" CHECK ("crisis_scores"."coverage_score" BETWEEN 0 AND 1),
	CONSTRAINT "funding_gap_range" CHECK ("crisis_scores"."funding_gap_pct" IS NULL OR "crisis_scores"."funding_gap_pct" BETWEEN 0 AND 1)
);
--> statement-breakpoint
CREATE TABLE "ingestion_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" "source_name" NOT NULL,
	"status" "run_status" NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"records_written" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "source_observations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"crisis_id" uuid NOT NULL,
	"source" "source_name" NOT NULL,
	"metric" text NOT NULL,
	"value" numeric NOT NULL,
	"observed_at" date NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"run_id" uuid,
	"raw" jsonb,
	CONSTRAINT "source_observations_natural_key" UNIQUE("crisis_id","source","metric","observed_at")
);
--> statement-breakpoint
ALTER TABLE "briefs" ADD CONSTRAINT "briefs_crisis_id_crises_id_fk" FOREIGN KEY ("crisis_id") REFERENCES "public"."crises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefs" ADD CONSTRAINT "briefs_score_id_crisis_scores_id_fk" FOREIGN KEY ("score_id") REFERENCES "public"."crisis_scores"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crisis_scores" ADD CONSTRAINT "crisis_scores_crisis_id_crises_id_fk" FOREIGN KEY ("crisis_id") REFERENCES "public"."crises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_observations" ADD CONSTRAINT "source_observations_crisis_id_crises_id_fk" FOREIGN KEY ("crisis_id") REFERENCES "public"."crises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_observations" ADD CONSTRAINT "source_observations_run_id_ingestion_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ingestion_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "briefs_crisis_idx" ON "briefs" USING btree ("crisis_id","generated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "crisis_scores_ranking_idx" ON "crisis_scores" USING btree ("scored_for" DESC NULLS LAST,"attention_gap_score" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "crisis_scores_history_idx" ON "crisis_scores" USING btree ("crisis_id","scored_for" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "source_observations_lookup_idx" ON "source_observations" USING btree ("crisis_id","metric","observed_at" DESC NULLS LAST);