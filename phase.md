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
- [ ] Data ingestion: GDELT + ReliefWeb + UNHCR + OCHA FTS workflows exported
      to `n8n/workflows/` as versioned JSON

**Acceptance:** `pnpm infra:up && pnpm db:migrate` succeeds from a clean clone.
Each of the four ingestion workflows can be imported into n8n and run manually
end-to-end, writing rows to `source_observations` with no duplicates on re-run.

## Phase 2 — Core Agent Logic (Week 2)

- [x] Scoring function: pure, unit-tested, outside n8n
- [ ] API endpoints serving ranked crises
- [x] Content-generation agent (Claude API) for briefs — *Deepthi*
      *(three audiences, prompts version-controlled as files, grounding
      enforced in code — 15 tests. Not yet run against the live Claude API,
      and brief persistence is unresolved: the generator produces structured
      headline/body/statsUsed, `Brief.content` is a single string.)*

**Acceptance:** `GET /crises` returns crises ranked by `attention_gap_score`
descending with a non-null `rankDelta` once two runs exist. Scoring has tests
covering empty cohort, single-member cohort, identical values, and missing
funding data. Every generated brief cites a real `score_id`; no statistic
appears in a brief that is not in the database.

## Phase 3 — Delivery + Frontend (Week 3)

- [x] Telegram + email outreach agent — *Deepthi*
      *(built and unit-tested; never sent through a real bot or Resend account)*
- [x] Next.js dashboard — *Deepthi*
      *(ranked list, detail + trend chart, briefs with copy-to-clipboard;
      verified rendering against a running server)*
- [x] CI/CD + deployment — *Deepthi*
      *(pipeline built; deploy step skips cleanly until VERCEL_TOKEN is set,
      so nothing is actually deployed yet)*

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
