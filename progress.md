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

**Next up:**

- Register a ReliefWeb appname.
- Import the four workflows into the running n8n and execute each once. They
  are JSON-valid and their parse logic is written against verified API shapes,
  but they have **not been run inside n8n** — that is the main untested surface.
- Agree `packages/shared-types` with Deepthi before she builds against it,
  especially `rankDelta`.

---

## Session 2 — 2026-07-20 — Preethesh

**Goal:** Resolve the scoring-floor problem (Chad scoring 0.000).

**Agents used:** problem-solver (verify the fix empirically), code-logic, tester

**Decision — scoring formula v1.1.0:**

Before touching the formula, tested the candidate fixes against the live Chad
data in a throwaway script rather than trusting the reasoning. This overturned
the recommendation from Session 1: **normalizing onto `[0.05, 1]` does not work.**
A floor shifts need and coverage by the same amount, so their difference — the
gap — stays exactly 0, and multiplicative funding still cannot lift it. Chad
stayed at 0.000 for every floor value tried.

The only candidate that actually rescued Chad was an **additive funding term**.
Formula bumped from v1.0.0 to v1.1.0:

    attention_gap = (need − coverage) × (1 + 0.5·funding_gap) + 0.3·funding_gap

Chose the version bump rather than an in-place edit precisely so the v1.0.0
scores already in the table stay interpretable — this is what the
`algorithm_version` column was added for in Session 1.

Trade-off, accepted with the decision: a well-covered but underfunded crisis
now gets a small positive nudge. In the live cohort this moved Ukraine (65%
funded) from −0.062 to +0.043. Judged acceptable — underfunding is a real
signal, and Ukraine still ranks last of the three. `fundingBonus: 0` recovers
the pure multiplicative model for anyone who disagrees.

**Changes made:**

- `packages/scoring`: added `fundingBonus` (default 0.3), applied the additive
  term, bumped `ALGORITHM_VERSION` to v1.1.0.
- Updated the scoring and API tests that had encoded the old contract — two of
  them asserted the exact behaviour we deliberately changed (funding can now
  flip a well-covered crisis positive). Rewrote them to assert the new
  semantics, and added a test proving the floor case is rescued plus one
  proving `fundingBonus: 0` restores v1.0.0 behaviour.

**Verified end-to-end:** re-scored the live dev database under v1.1.0. Chad:
**0.000 → 0.267, now rank 2, above Ukraine.** Matches the offline probe exactly
(SDN 1.674, TCD 0.267, UKR 0.043).

**Tests:** 63 passing (39 scoring, 24 API), 0 failing.

**Next up:** unchanged from Session 1 — ReliefWeb appname, run the workflows
inside n8n, agree shared-types with Deepthi.

---

## Session 3 — 2026-07-21 — Preethesh

**Goal:** Retire the biggest project risk — that no real data had ever flowed
through the system — without needing the n8n UI or any manual step.

**Agents used:** code-logic, tester

**What changed — ingestion moved out of n8n into a tested TS module:**

The four n8n workflows held their fetch-and-parse logic inside Code nodes,
which cannot be unit-tested — the exact anti-pattern the plan called out for
scoring. Rebuilt ingestion as `apps/api/src/ingest`:

- `http.ts` — one fetch client with timeout + exponential backoff, retrying
  429/5xx/timeouts and treating a non-JSON 200 as a GDELT soft-throttle.
- `sources/{gdelt,unhcr,fts,reliefweb}.ts` — each splits a **pure `parse`**
  (fixture-tested) from the I/O `fetch`.
- `persist.ts` — extracted the upsert + run-bookkeeping + scoring from the
  webhook handler, now shared by both the webhook and the runner. The webhook
  route dropped from 249 to 68 lines.
- `run.ts` — orchestrates; a source failure is captured, never thrown, so one
  dead upstream cannot abort a multi-source run.
- `routes/ingest.ts` — `POST /ingest/run` (secret-protected), and a
  `pnpm ingest` CLI.

The four fat workflows collapsed into one thin `lumen-daily-ingest.json` that
just POSTs `/ingest/run`. No parse logic in two places, so no drift for the
verifier to catch.

**Decision — UNHCR groups by country of origin, not asylum.** The original n8n
code aggregated by country of asylum (who hosts refugees). For ranking crisis
severity, country of origin (who is displaced *by* a crisis) is the right
signal. Changed the query to `coo_all=true` and aggregate on `coo_iso`.

**Verified against the LIVE APIs — first real data through the system:**

- **UNHCR:** 26/26 crises ingested. Sudan 12.9M displaced, Syria 10.6M, Ukraine
  9.7M — real, plausible figures.
- **OCHA FTS:** two-stage fan-out (plans + per-plan funding) works end-to-end.
  Afghanistan $1.7B appeal at 20.5% funded, DRC $1.4B at 55%.
- **Real ranking (UNHCR + FTS only):** Syria, Sudan, Yemen, Afghanistan on top —
  all genuinely severe and underfunded. Coverage sat at neutral 0.5 for all,
  which is the **graceful-degradation path working**: with GDELT absent the
  system still produces a need+funding ranking rather than failing.

**Known gap — GDELT not verified live.** This dev IP was throttled throughout
(GDELT enforces 1 req/5s and had already flagged my earlier probes), so 26
paced calls exceeded the run window. GDELT is proven only at the parse layer
(fixture-tested). Its `sourcecountry` FIPS-code mapping in `gdelt.ts` also needs
confirming on a first clean run. Recorded honestly rather than claimed done.

**Tests:** 79 passing (39 scoring, 40 API incl. 16 new parser tests), 0 failing.
Lint clean, all packages typecheck.

**Next up:**

- Confirm GDELT live from an un-throttled IP; verify the FIPS mapping.
- ReliefWeb appname (still blocked).
- Run the one workflow inside n8n once (the only remaining untested surface is
  n8n → API reachability on Linux).
- Agree shared-types with Deepthi.

---

## Session 4 — 2026-07-24 — Delivery, dashboard, and production completion

**Goal:** Complete the previously unimplemented delivery/experience scope and
replace the planned Claude runtime dependency with Groq.

**Changes made:**

- Added secret-protected brief generation and batch-run APIs. Every numeric fact
  is assembled from the exact `crisis_scores` row and latest stored
  observations. Groq can add only number-free narrative; digit-containing,
  empty, timed-out, or failed output falls back to a deterministic brief.
- Added Telegram Bot API and Resend email delivery with per-channel
  sent/skipped/failed results.
- Built the complete responsive Next.js dashboard: ranked/searchable/sortable
  crisis index, detail pages, need-vs-coverage chart, source evidence, brief
  generation, copy and delivery controls, and loading/empty/error states.
- Extended the daily n8n workflow from ingest through generation and outreach.
- Added production Dockerfiles and a full-stack Compose deployment.
- Extended CI with production dashboard builds and credential-pattern checks;
  added `main` branch API/web image publishing to GitHub Container Registry and
  an optional host deployment hook.
- Added MIT license and updated the README, architecture, phase tracker, and
  Deepthi log to match the implemented system.

**Verification:** lint clean; every package typechecks; 83 tests pass (39
scoring + 44 API/parser); the Next.js production build succeeds. Live UNHCR
and OCHA FTS ingestion populated the 26-country cohort. The list and detail
pages were inspected in a headless browser, and the complete
browser → Next server → API → database brief path passed.
The first remote CI run exposed a workflow-ordering bug (tests ran before the
clean Postgres service was migrated); migration now runs before tests, and the
deprecated GitHub action runtimes were upgraded.

**External steps remaining:** rotate the Groq key exposed in chat; configure
fresh provider credentials; import/activate n8n; approve ReliefWeb appname;
choose a production host/domain; perform a live delivery; record the demo.
