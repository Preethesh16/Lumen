# Lumen — Phase Tracker

Ownership: **P** = Preethesh (data, orchestration, scoring, API) ·
**D** = Deepthi (content generation, delivery, dashboard, CI/CD)

A box gets checked only when the work exists, has a test, and `verifier`
has returned PASS on it. "Written but untested" is not checked.

## Phase 1 — Foundation (Week 1)
- [ ] (P) Repo scaffolding + Docker compose (n8n + Postgres 16)
- [ ] (P) Data ingestion: GDELT + ReliefWeb + UNHCR + OCHA FTS HTTP nodes
- [ ] (P) DB schema for `crisis_scores` table
- [x] (D) `packages/shared-types` — Crisis, ScoreHistory, Brief interfaces
      *(proposed by Deepthi, pending Preethesh sign-off — see progress.md)*
- [x] (D) `.claude/agents/` subagent definitions
- [x] (D) Tracking files: progress.md, phase.md, deepthi.md, preethesh.md

**Acceptance:** `docker compose up` brings n8n + Postgres online locally;
one ingestion workflow writes a real row to `crisis_scores`; both sides
compile against the same `shared-types` version.

## Phase 2 — Core Agent Logic (Week 2)
- [ ] (P) Scoring node (need vs. coverage → attention gap score)
- [ ] (P) API endpoints to serve ranked crises
- [x] (D) Content-generation agent (Claude API) — 3 audience-tailored briefs
- [x] (D) Grounding validator — every stat in output traces to input payload
      *(15 tests, including fabricated-figure cases. Not yet exercised
      against live Claude API output — that lands when a real crisis row
      exists to generate from.)*

**Acceptance:** given a real crisis row, the generator returns three briefs
containing zero statistics absent from the input payload, proven by a test
that feeds it a crisis with known figures and asserts no others appear.

## Phase 3 — Delivery + Frontend (Week 3)
- [x] (D) Telegram outreach agent — push top-ranked briefs to a channel
      *(built and unit-tested; not yet sent through a real bot)*
- [x] (D) Resend weekly digest email
      *(built and unit-tested; not yet sent through a real Resend account)*
- [x] (D) Next.js dashboard — ranked list, detail + trend chart, briefs view
- [x] (D) CI/CD — lint/typecheck/test on push, deploy on merge to main
      *(deploy step skips cleanly until VERCEL_TOKEN is added)*

**Acceptance:** dashboard renders live data from the deployed API, degrades
cleanly when the API is down or returns an empty list, and a brief posted to
Telegram arrives in the channel.

## Phase 4 — Hardening (Week 4)
- [ ] (both) Error handling, rate-limit backoff on every external call
- [ ] (both) Full test suite green + verifier PASS
- [ ] (D) Final deploy (Vercel + Railway) + README walkthrough
- [ ] (both) Demo recording

**Acceptance:** a person who has never seen the repo can follow README.md
from clone to running locally without asking either of us a question.
