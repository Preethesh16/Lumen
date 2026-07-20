# Preethesh — Work Log

Scope: data ingestion, n8n orchestration, scoring, backend API, local infra.

---

### 2026-07-20 — Prompt: "read the plan and start building"

- Agent: code-logic
- Proposed the Postgres schema and shared-types interfaces for approval before
  scaffolding, per the plan. Two forks resolved: a crisis is country-level
  (ISO3), and schema/migrations use Drizzle + drizzle-kit.
- Files touched: repo root config, `.claude/agents/*`, `phase.md`,
  `progress.md`, `preethesh.md`, `deepthi.md`
- Result: scaffold committed on `preethesh/dev`

### 2026-07-20 — Infra

- Agent: code-logic
- Files touched: `infra/docker-compose.yml`, `.env.example`
- n8n + Postgres 16 with healthchecks so n8n waits for a genuinely ready
  database rather than a started container. Postgres port is published to the
  host so drizzle-kit and the API can reach it from outside Docker.
- Result: implemented, not yet run against a clean machine

### 2026-07-20 — Shared types

- Agent: code-logic
- Files touched: `packages/shared-types/src/index.ts`
- `Crisis`, `CrisisScore`, `RankedCrisis`, `ScoreHistoryPoint`, `CrisisDetail`,
  `Brief`, plus the webhook payload contract.
- Result: implemented — **pending sign-off from Deepthi before she builds
  against it**

### 2026-07-20 — Scoring engine

- Agent: code-logic, then tester
- Files touched: `packages/scoring/src/*`, `packages/scoring/test/*`
- Pure and dependency-free so it is unit-testable outside n8n, per the plan's
  explicit instruction not to bury business logic in a workflow node. Log
  transform before min-max because displacement is heavy-tailed. Degenerate
  cohorts (empty, single member, all-identical) resolve to a neutral 0.5
  rather than dividing by zero.
- Result: implemented with tests

### 2026-07-20 — Backend API

- Agent: code-logic
- Files touched: `apps/api/src/**`
- Drizzle schema + migration, `GET /crises`, `GET /crises/:id`,
  `POST /webhook/n8n-score-update` (shared-secret auth, idempotent upserts),
  `GET /health`.
- Result: implemented, not yet exercised against a live database

### 2026-07-20 — Backend API verified end-to-end

- Agent: tester
- Files touched: `apps/api/test/api.test.ts`, `apps/api/vitest.config.ts`
- 24 integration tests against a real Postgres. Stood the stack up by hand
  too: migrate → seed 26 crises → three ingestion batches → 26 scores →
  Sudan rank 1 (gap 1.419), Ukraine last (gap −0.062). Idempotency confirmed
  by re-posting a batch and checking the row count was unchanged at 12.
- Result: 24/24 passing. Combined suite 61/61.

### 2026-07-20 — n8n workflows

- Agent: code-logic
- Files touched: `n8n/workflows/*.json`
- Four daily schedule-triggered ingestion workflows (GDELT, ReliefWeb, UNHCR,
  OCHA FTS) with retry/backoff on every HTTP node. Probed all four live APIs
  before writing the parse logic rather than trusting the plan's description —
  which was the right call: ReliefWeb 403s without a registered appname, and
  FTS's plan endpoint carries no funding figure, so that workflow needed a
  two-stage fan-out. GDELT rate-limited on the very first probe.
- Result: implemented and JSON-valid, **not yet imported into a running n8n
  instance**. Parse logic is written against verified response shapes, but the
  workflows themselves are the main untested surface — verify next session.

### 2026-07-20 — Docs

- Agent: code-logic
- Files touched: `README.md`, `docs/architecture.md`, `.github/workflows/ci.yml`
- CI runs lint, typecheck, tests, a migration against a clean Postgres service
  (catches schema drift), n8n JSON validation, and a check that `.env` is never
  tracked.
- Result: implemented, **not yet run on GitHub Actions**

### 2026-07-20 — Scoring v1.1.0 (additive funding term)

- Agent: problem-solver, then code-logic + tester
- Files touched: `packages/scoring/src/score.ts`, `packages/scoring/test/*`,
  `apps/api/test/api.test.ts`, `docs/architecture.md`, `progress.md`
- Fixed the Chad-scores-0.000 problem. Verified the fix empirically first,
  which overturned my own Session 1 recommendation — the floor idea does not
  work; only an additive funding term does. Bumped ALGORITHM_VERSION so old
  scores survive. Re-scored the live DB: Chad 0.000 → 0.267, rank 2.
- Result: 63/63 tests passing. See Session 2 in progress.md for the reasoning
  and the trade-off.
