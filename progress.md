# Lumen — Progress Log

Append-only. Newest session at the bottom.

---

## Session 1 — 2026-07-20 — Preethesh

**Goal:** Agree the data model, then scaffold the repo, infra, scoring engine,
and backend API.

**Agents used:** code-logic (implementation), tester (scoring suite)

**Changes made:**

- pnpm workspace monorepo: `apps/api`, `packages/shared-types`,
  `packages/scoring`, `infra/`, `n8n/workflows/`, `docs/`.
- Five subagents defined in `.claude/agents/`. `code-logic` and `tester` have
  write access; `debugger` and `verifier` are read + bash only, so neither can
  silently "fix" something before the diagnosis has been seen.
- `infra/docker-compose.yml`: n8n + Postgres 16, healthchecked, named volumes.
- Drizzle schema and initial migration for the five tables.
- `packages/scoring`: pure, dependency-free scoring engine + unit tests.
- `apps/api`: Express + TypeScript. `GET /crises`, `GET /crises/:id`,
  `POST /webhook/n8n-score-update`, `GET /health`.
- Four n8n ingestion workflows exported as versioned JSON.

**Decisions made:**

1. **A crisis is one country (ISO3), not one disaster event.** All four
   upstream APIs are country-keyed; GDELT, UNHCR and FTS have no notion of a
   ReliefWeb disaster ID. Modelling per-disaster would mean inventing an
   allocation rule to split one country-level measurement across several rows.
   Revisit only if we add a source with sub-national granularity.

2. **Added `source_observations` — a raw readings table the original plan did
   not have.** This is the highest-value structural decision here. When the
   scoring weights change in week 3 (they will), we can recompute every
   historical score from stored observations without re-hitting GDELT or
   ReliefWeb. Without it, a formula tweak either destroys history or burns the
   rate limit re-fetching it.

3. **`UNIQUE (crisis_id, source, metric, observed_at)` on observations.** n8n
   retries failed nodes. Without this constraint a retry silently double-counts.
   Ingestion writes are upserts.

4. **`algorithm_version` + `inputs` jsonb on every score row.** Old scores
   survive a formula change, and every score is explainable. This also backs
   the anti-hallucination requirement: a brief cites `score_id`, so every
   number in generated copy traces to a stored row.

5. **Drizzle over Prisma and raw SQL.** Types infer straight into the shared
   package, generated migrations are readable in review, and the runtime is
   light. Prisma's client doesn't compose cleanly into `shared-types` and is
   overkill for five tables.

6. **Normalization is cohort-relative (min-max across active crises per run).**
   Known trade-off, recorded deliberately: scores are comparable *within* a
   run but drift across runs as the cohort changes. Fixed reference scales
   would be stable but need calibration data we don't have. `inputs` is stored
   precisely so we can re-derive on a fixed scale later without re-fetching.

7. **Values are log-transformed before normalization.** Displacement counts are
   heavy-tailed — Sudan vs. Vanuatu spans three orders of magnitude. Linear
   min-max would collapse every country except the largest into ~0.

**Tests:** 61 passing, 0 failing.

- `packages/scoring` — 37 unit tests (normalization, degenerate cohorts,
  missing data, funding amplification, ranking stability).
- `apps/api` — 24 integration tests against a real Postgres (auth, payload
  validation, upsert idempotency under retry, rankDelta across two runs,
  cold-start empty state, detail lookup by ISO3 and UUID).

Verified end-to-end by hand as well: `pnpm infra:up` → `db:migrate` →
`db:seed` (26 crises) → three ingestion batches → 26 scores computed →
`GET /crises` returned Sudan rank 1 (gap 1.419) and Ukraine last (gap −0.062).

**Bugs found:**

1. *(mine, caught by tests)* The `weightedMean` re-normalization test asserted
   0.68 where the correct value is 0.64. The code was right and my arithmetic
   was wrong. Kept the important assertion — that a re-normalized mean equals
   one computed without the missing component at all — which passed.
2. *(mine, caught at runtime)* `briefs.score_id` was declared `bigserial`
   rather than a `bigint` foreign key, so it would have generated its own
   values instead of referencing `crisis_scores`. That would have silently
   broken brief-to-score traceability, which is the whole anti-hallucination
   mechanism. Fixed before the first migration was generated.
3. *(environment)* The compose file failed to parse because a `:?` error
   message contained a colon. Quoted.

**Upstream API findings — two of the four differ from the project plan.**
Verified live, not assumed:

- **ReliefWeb returns HTTP 403 for an unregistered `appname`.** The plan
  recorded this as "needs an `appname` query param, no key", which is wrong —
  arbitrary appname strings are rejected outright. It must be registered at
  <https://apidoc.reliefweb.int/parameters#appname>. **This blocks the
  ReliefWeb workflow.** The other three sources work without registration and
  scoring degrades gracefully without the disaster-count signal.
- **OCHA FTS `/v2/public/plan` carries no funding figure at all.**
  `revisedRequirements` is top-level (not nested under `requirements`), and
  funding needs a second call per plan to
  `/v1/public/fts/flow?planId=…&groupby=plan`. The workflow was rewritten as a
  two-stage fan-out.
- **GDELT enforces one request per 5 seconds** and returns a plain-text warning
  rather than JSON when exceeded — hit this immediately on the first probe.
  Workflow paces at one per 6s (~3 min for 26 countries, fine nightly).
- **UNHCR works as expected.** Shape confirmed: `items[]` keyed on `coa_iso`,
  with some counts returned as strings.

**Open decision — scoring floor (needs a call before the demo):**

Chad scored **0.000** in the live run: 1.9M displaced, 89% unfunded, near-zero
coverage — tied with countries that have no data whatsoever. Two compounding
causes, both structural rather than bugs:

1. Min-max normalization forces the cohort *minimum* to exactly 0. Chad was the
   minimum on both displacement and coverage, so need = 0 and coverage = 0.
2. Funding amplification is multiplicative, and `0 × 1.445 = 0`, so the 89%
   underfunding signal was annihilated rather than applied.

This will look broken in a demo. Three options, cheapest first: normalize onto
`[0.05, 1]` instead of `[0, 1]`; switch to percentile rank; or make the funding
term partly additive. My recommendation is the first — one-line change, keeps
the formula interpretable. Not applied unilaterally because it changes approved
scoring semantics.

**Next up:**

- Decide the scoring-floor question above.
- Register a ReliefWeb appname.
- Import the four workflows into the running n8n and execute each once. They
  are JSON-valid and their parse logic is written against verified API shapes,
  but they have **not been run inside n8n** — that is the main untested surface.
- Agree `packages/shared-types` with Deepthi before she builds against it,
  especially `rankDelta`.
