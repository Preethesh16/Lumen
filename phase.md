# Lumen — Phase Tracker

Acceptance criteria are what `verifier` checks line by line before any merge to
`main`. A box is only ticked when the criterion under it is demonstrably true.

---

## Phase 1 — Foundation (Week 1)

- [x] Monorepo scaffolding (pnpm workspaces, shared tsconfig, lint/format)
- [x] `infra/docker-compose.yml` brings up n8n + Postgres 16 with one command
- [x] DB schema: `crises`, `ingestion_runs`, `source_observations`,
      `crisis_scores`, `briefs` — with idempotency constraints
- [x] `packages/shared-types` agreed and published to the workspace
- [x] Data ingestion: tested fetch+parse adapters for GDELT, ReliefWeb, UNHCR,
      OCHA FTS in `apps/api/src/ingest`; one thin n8n scheduler workflow
- [x] Live-data verification: UNHCR + FTS ingested from the real APIs and ranked
      (GDELT parser tested, live fetch pending an un-throttled IP; ReliefWeb
      blocked on appname)

**Acceptance:** `pnpm infra:up && pnpm db:migrate` succeeds from a clean clone.
`pnpm --filter @lumen/api ingest` writes rows to `source_observations` with no
duplicates on re-run, and `GET /crises` returns a ranking. ✅ met for UNHCR+FTS.

## Phase 2 — Core Agent Logic (Week 2)

- [x] Scoring function: pure, unit-tested, outside n8n
- [ ] API endpoints serving ranked crises
- [ ] Content-generation agent (Claude API) for briefs — *Deepthi*

**Acceptance:** `GET /crises` returns crises ranked by `attention_gap_score`
descending with a non-null `rankDelta` once two runs exist. Scoring has tests
covering empty cohort, single-member cohort, identical values, and missing
funding data. Every generated brief cites a real `score_id`; no statistic
appears in a brief that is not in the database.

## Phase 3 — Delivery + Frontend (Week 3)

- [ ] Telegram + email outreach agent — *Deepthi*
- [ ] Next.js dashboard — *Deepthi*
- [ ] CI/CD + deployment — *Deepthi*

**Acceptance:** A scheduled run produces a brief that lands in Telegram. The
dashboard renders the ranked list, a detail view with the need-vs-coverage
trend, and briefs with copy-to-clipboard. Deployed and reachable at a URL.

## Phase 4 — Hardening (Week 4)

- [ ] Retry/backoff on every upstream call; partial data degrades gracefully
- [ ] Empty states and API-failure states in the dashboard
- [ ] Full test suite green; `verifier` PASS
- [ ] Final deploy + demo recording + README walkthrough

**Acceptance:** Killing the API mid-session leaves the dashboard showing an
error state, not a blank page. A cold start with an empty database renders
sensible empty states everywhere. No secret appears anywhere in git history.
