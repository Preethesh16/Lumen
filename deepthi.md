# Deepthi — Work Log

Scope: content-generation agent (Groq API), outreach/delivery (Telegram +
email), Next.js dashboard, CI/CD and deployment, README and architecture docs.

---

### 2026-07-20 — Repo scaffold created by Preethesh

- Agent: code-logic (Preethesh's session)
- `apps/web/` is reserved and empty — it's yours. Nothing in it was created,
  so you're free to run `create-next-app` into it without unpicking anything.
- `packages/shared-types` is populated and ready to consume:
  `Crisis`, `CrisisScore`, `RankedCrisis`, `ScoreHistoryPoint`, `CrisisDetail`,
  `Brief`. **This needs your sign-off before you build UI against it.**
- The API contract you'll consume is `GET /crises` and `GET /crises/:id`,
  documented in `docs/architecture.md`.
- Result: unblocked to start

**Two things worth your attention before you build:**

1. `RankedCrisis.rankDelta` — position change vs. the previous run. Computed
   server-side because it needs the prior run's ordering, which is awkward to
   derive in the browser. If you don't want it, say so and it comes out; if you
   want it over a 7-day window instead of one run, that's a cheap change now
   and an annoying one later.

2. `briefs.score_id` links every generated brief to the exact `crisis_scores`
   row it was generated from. Please generate strictly from the numbers passed
   in and store that link — `verifier` treats any statistic in a brief that
   isn't traceable to a stored row as a FAIL, not a nitpick.

### 2026-07-24 — Delivery and experience scope completed

- Replaced the planned Claude runtime with optional Groq
  (`llama-3.3-70b-versatile`) and a deterministic fallback.
- Added a grounding guard: every numeric fact is rendered from the stored score
  and observations; model-written narrative is rejected if it contains digits.
- Added secret-protected brief generation, batch generation, Telegram delivery,
  and Resend email delivery routes with graceful unconfigured states.
- Built the responsive Next.js dashboard: ranking/search/sort, crisis detail,
  need-vs-coverage trend, source evidence, brief generation/copy/delivery,
  loading, empty, not-found, and API-failure states.
- Extended the daily n8n workflow through brief generation and delivery.
- Added production Dockerfiles, full-stack Compose, CI production web build,
  secret-pattern checks, and GitHub Container Registry image publishing.
- Shared types approved and extended for brief and delivery responses.
- Result: implementation complete. External credentials, workflow activation,
  production hosting, and demo recording remain owner-operated steps.
