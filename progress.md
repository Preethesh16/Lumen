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

---

## Session 1 — 2026-07-20 — Deepthi

**Goal:** Stand up the delivery/experience side of the project — shared
scaffold, subagent definitions, tracking files, and the shared type contract.

**Agents used:** code-logic (scaffolding)

**Changes made:**
- Created branch `deepthi/dev` off `main`.
- Created `.claude/agents/` with five subagent definitions: code-logic,
  debugger, tester, verifier, problem-solver. code-logic and tester have
  write access; debugger and verifier are read+bash only so they produce a
  diagnosis or a verdict rather than a quiet fix.
- Created `progress.md`, `phase.md`, `deepthi.md`, `preethesh.md`.
- Created `packages/shared-types` with the Crisis, ScoreHistory, Brief,
  and BriefInput interfaces.

**Bugs found:** none yet.

**Decisions made:**
- *Shared types authored unilaterally, pending sign-off.* The plan assumed
  Preethesh's scaffold would exist first; it does not — the repo contained
  only `README.md` and `lumen-plan.md`. Rather than block, I wrote
  `packages/shared-types` as a concrete proposal. **Preethesh must review
  and sign off before either side builds heavily against it.** The risk of
  a unilateral contract is exactly the silent divergence the plan warns
  about in section 9, so this is flagged loudly rather than assumed settled.
- *Email provider: Resend.* Cleaner TypeScript SDK and React Email templates
  versus SendGrid, and the free tier covers a weekly digest comfortably.
- *`lumen-plan.md` left uncommitted.* It shows as modified but the diff is
  CRLF-vs-LF only, zero content change. Committing it would put 405 lines of
  line-ending churn in the history for nothing.
- *Scores are read-only to the frontend.* The dashboard and content agent
  never compute or mutate an attention gap score — that is Preethesh's
  scoring function. Anything the UI needs derived gets derived in the API.

**Next up:**
- Preethesh signs off on `packages/shared-types` (blocking for Phase 2).
- Content-generation agent + prompt files.
- Next.js dashboard scaffold against mock data until the API exists.

---

## Session 2 — 2026-07-20 — Deepthi

**Goal:** Build the content-generation agent, delivery layer, dashboard,
and CI — everything on my side of the split that does not depend on
`apps/api` existing.

**Agents used:** code-logic (implementation), tester (grounding + delivery
suites)

**Changes made:**
- Content-generation agent (`apps/web/src/lib/content-agent/`). Prompts are
  markdown files under `prompts/`, not inline strings, so a change to what
  the model is told shows up as a reviewable diff. Three audiences:
  journalist pitch, donor one-pager, NGO fundraising angle.
- `validateGrounding` — extracts every figure from a generated brief and
  traces it to the input payload. `generateBrief` throws rather than
  returning an ungrounded brief.
- Delivery: Telegram (`telegram.ts`) with MarkdownV2 escaping, retry, and
  429 `retry_after` handling; Resend weekly digest (`digest.ts`). Neither
  throws — one failed send must not abort a batch.
- Dashboard: ranked list `/`, detail `/crises/[id]` with a need-vs-coverage
  chart and source table, briefs `/crises/[id]/briefs` with tabs and
  copy-to-clipboard.
- API client with a labelled mock fallback so the dashboard runs before
  `apps/api` exists.
- CI (`.github/workflows/ci.yml`): typecheck, lint, test on every branch;
  build without secrets; deploy to Vercel on merge to `main`.
- README.md and docs/architecture.md.

**Bugs found:**
1. *Time expressions read as statistics.* `validateGrounding` flagged the
   "24" in "37 articles in 24 hours" as an unsupported figure. Every real
   brief that dated its own data would have been withheld. Root cause: the
   figure extractor had no notion of units. Fixed by skipping numbers
   followed by a time unit; regression test added.
2. *Build failed on `.js` import extensions.* Vitest resolved them, Next's
   webpack did not, so tests passed while `next build` failed — the worst
   ordering. Fixed by dropping the extensions under bundler resolution.

**Decisions made:**
- *The mock fallback is permanent, not scaffolding.* It was written to
  unblock frontend work, but the failure it covers does not go away: n8n
  runs daily, so there is always a window where the API is down or the
  database is empty. It stays, with the banner, because placeholder data
  must never be indistinguishable from real data.
- *Grounding is enforced in code, not requested in the prompt.* Reasoning
  in docs/architecture.md — briefly, the output is a factual claim handed
  to someone who will act on it, and a prompt is a request rather than a
  guarantee.
- *Railway over Fly.io.* n8n needs a persistent volume plus managed
  Postgres; Railway gives both in one project with no Dockerfile.
- *`next lint` is deprecated* in Next 15.5 and removed in 16. It works now;
  migrating to the ESLint CLI is a Phase 4 hardening item.

**Tests:** 22 passed, 0 failed (15 grounding, 7 delivery). `next build`
succeeds. All three routes verified rendering against a running server,
including the empty-funding case and the no-API-key briefs path.

**Not done — flagged honestly:**
- No integration test against the live Claude API; the generator's retry
  path is written but has not run against a real 429.
- `apps/api`, `n8n/workflows`, and `infra/docker-compose.yml` do not exist.
  They are Preethesh's, and nothing in Phase 1 on his side is complete.
- Nothing is deployed. The CI deploy step skips cleanly until the Vercel
  secrets are added.

**Next up:**
- Preethesh's sign-off on shared-types, then swap the mock fallback for the
  live API by setting `LUMEN_API_URL`.
- Wire the Telegram send and weekly digest to a schedule once there are
  real ranked crises to send.

---

## Session 3 — 2026-07-20 — Deepthi

**Goal:** Reconcile the two independently-built halves of the project.

**Agents used:** problem-solver (contract conflict), code-logic (migration)

**What happened:** Preethesh and I scaffolded in parallel without syncing
first, so we each authored a `packages/shared-types` — and they were not
compatible. This is exactly the failure section 9 of the plan names as the
#1 risk for a two-person project, and we walked straight into it.

**The conflict, in full:**

| | Deepthi's version | Preethesh's version |
|---|---|---|
| `fundingGapPct` | `0–100` percent, optional | `0..1` share, `number \| null` |
| `Crisis` | scores flattened onto it | identity only; scores in `CrisisScore` |
| List response | bare `Crisis[]` | `{ data, scoredFor, count }` envelope |
| `Brief` | `headline` + `body` + `statsUsed` | `content` + `promptVersion` |
| Source name | `'ocha-fts'` | `'fts'` |
| `attentionGapScore` | assumed −1..1 | ~−1.5..1.5, deliberately unclamped |
| Tooling | npm workspaces | pnpm |

**The dangerous one was `fundingGapPct`.** The dashboard renders
`` `${fundingGapPct}% unfunded` ``. Against Preethesh's 0..1 data, a crisis
with 68% of its appeal unfunded would have displayed as **"0.68% unfunded"**
on a donor-facing page. It would not crash, would not fail a test, and looks
entirely plausible. The others (bare-array sort, `crisis.needScore` reads,
`Brief` field names) break loudly on contact, which is the safer kind.

**Decision: Preethesh's contract wins; the frontend adapts.**

His types are backed by a real Postgres schema and an API verified end-to-end
against a live database. Mine were an educated guess written against an empty
repo. When one side of a contract is grounded in what the data actually is and
the other is a hypothesis, the hypothesis yields. He also has
`algorithmVersion` and `promptVersion` fields I did not think of, and the
`source_observations` table means scores can be recomputed without re-hitting
rate-limited upstreams — a better design than what I assumed.

**Also resolved:**
- pnpm over npm workspaces; deleted `package-lock.json`.
- CI merged: his Postgres-migration, n8n-JSON, and committed-secret checks
  (all of which mine lacked) plus my lint step, web build, and Vercel deploy.
- Both halves of `.env.example`, `README.md`, `docs/architecture.md`, and
  the four tracking files reconciled rather than one overwriting the other.

**The process lesson, recorded so it is not repeated:** the plan said to agree
`shared-types` together before either of us wrote app code. Neither of us did,
and reconciling cost more than the sync would have. For every remaining shared
surface — the brief storage shape, the webhook payload, deployment config —
agree first, build second.

**Next up:**
- Rewrite `apps/web` against the adopted contract (in progress this session).
- Confirm with Preethesh how briefs should be persisted: his `Brief` has a
  single `content` string, my generator produces structured
  `headline`/`body`/`statsUsed`. I need the structure for the grounding
  citations UI; his schema needs to store it. This is a real open question,
  not a detail.

---

## Session 4 — 2026-07-20 — Deepthi

**Goal:** Close the gaps left after the contract reconciliation — make delivery
actually reachable, and stop placeholder data drifting from the real formula.

**Agents used:** code-logic (routes, mock rewrite), tester (auth + format suites)

**Changes made:**

- **Delivery is no longer dead code.** `sendBrief` and `sendDigest` existed but
  nothing called them, so Phase 3's "a scheduled run produces a brief that
  lands in Telegram" was not actually achievable. Added
  `POST /api/deliver/briefs` and `POST /api/deliver/digest` as n8n-triggered
  route handlers.
- **Mock data now runs the real scoring function.** `mock-data.ts` invents only
  raw upstream observations and passes them through `scoreCohort` /
  `rankByAttentionGap` from `@lumen/scoring`.
- Tests for `format.ts` (17) and the delivery auth guard (5), neither of which
  had any coverage.
- Documented `DIGEST_RECIPIENTS` and both routes in README and `.env.example`.

**Bugs found:**

1. *Placeholder scores had silently drifted from the real formula.* The mock
   hardcoded `raw * (1 + fundingGapPct * 0.85)` — an imitation that never
   matched v1.0.0 and was further wrong after Preethesh's v1.1.0 added an
   additive funding term. Anyone reviewing the dashboard without the API up was
   looking at a ranking the system would never produce. Root cause: duplicating
   a formula instead of calling it. Fixed by importing the real function, which
   makes this class of drift impossible rather than merely fixed.
2. *A comment I wrote overclaimed.* The Chad row was annotated as reproducing
   the v1.1.0 zeroing bug. It does not — Chad is not the cohort minimum on
   need, so its raw gap is non-zero and it scores 0.614. Comment corrected to
   say what the data actually does; reproducing that bug belongs in
   `packages/scoring`'s tests, not in display fixtures.

**Decisions made:**

- *Delivery is triggered by n8n, not by a cron inside the app.* One scheduler
  for the whole pipeline, and delivery cannot fire on stale scores. It also
  keeps the app stateless, which matters for Vercel.
- *Delivery routes reuse `N8N_WEBHOOK_SECRET`.* Same header and env var as
  Preethesh's ingestion webhook — one credential for n8n to hold, not two.
- *The routes fail closed.* An unset secret disables them (503) rather than
  leaving them open. They spend Claude API credits and publish to a public
  channel, so "unconfigured" must never mean "unauthenticated".
- *Telegram only sends crises with a positive attention gap; the digest sends
  regardless.* Pushing a well-covered crisis to the channel would undercut the
  one thing subscribers rely on it for. The digest is a standing weekly report,
  where a quiet week is itself information.
- *The digest returns 502 rather than sending when the API is unreachable.* An
  email saying "no crises this week" when the API was merely down reads as a
  finding rather than a failure, and someone would act on it.

**Tests:** 48 passing, 0 failing (16 grounding, 17 format, 10 delivery, 5 auth).
Full workspace typechecks, lint clean, `next build` succeeds with both routes
registered. Auth boundary verified live: 401 unauthenticated, 401 on a wrong
secret, 503 with a specific reason when config is absent, 405 on GET.

**Not done — flagged honestly:**

- Still nothing has run against the live Claude API, a real Telegram bot, or a
  real Resend account. The routes are reachable and authenticated; whether a
  message actually arrives is unproven.
- Brief persistence is still unresolved — `Brief.content` is one string and
  `statsUsed` has nowhere to go. Needs Preethesh.
- Preethesh's v1.1.0 scoring fix (`05fe591`) is on `preethesh/dev` and not in
  `main`. Deliberately not merged here — merging his work to `main` is his
  call, not mine. `main` therefore still scores on v1.0.0.

**Next up:**
- Agree brief persistence with Preethesh, then store generated briefs instead
  of regenerating on every page view.
- First real end-to-end send once a bot token exists.
