# Deepthi — Work Log

Scope: content-generation agent (Claude API), outreach/delivery (Telegram +
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
