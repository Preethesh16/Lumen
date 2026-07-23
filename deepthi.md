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

Owner of: content-generation agent, outreach/delivery, `apps/web`, CI/CD, docs.

---

### 2026-07-20 — Session 1 — project kickoff

**Prompt:** set up my side of Lumen from `lumen-plan.md`.

- Agent: code-logic
- Files touched: `.claude/agents/*.md`, `progress.md`, `phase.md`,
  `deepthi.md`, `preethesh.md`, `packages/shared-types/*`
- Result: branch `deepthi/dev` created; shared scaffold and subagent
  definitions in place.

---

### 2026-07-20 — Session 2 — content agent, delivery, dashboard, CI

**Prompt:** build out my scope from the plan.

- Agent: code-logic, tester
- Files touched: `apps/web/src/lib/content-agent/**`,
  `apps/web/src/lib/delivery/**`, `apps/web/src/lib/api/**`,
  `apps/web/src/app/**`, `apps/web/src/components/**`,
  `.github/workflows/ci.yml`, `README.md`, `docs/architecture.md`,
  `.env.example`
- Result: 22 tests passing, `next build` clean, all routes verified against
  a running server.

**Two bugs the tests caught**, both logged in progress.md: the grounding
validator was flagging time expressions ("24 hours") as invented statistics,
and `.js` import extensions passed under vitest but broke `next build` —
tests green while the build was broken.

**Note to self:** the mock API fallback is labelled in the UI on purpose.
Do not quietly remove the banner when the real API lands — the empty-database
window after each daily n8n run is real, and unlabelled placeholder figures
about a humanitarian crisis are the one thing this project cannot ship.

---

### 2026-07-20 — Session 1 — project kickoff

**Note to self:** the repo was empty when I started — Preethesh's `apps/api`,
`n8n/workflows`, and Docker compose do not exist yet. I authored
`packages/shared-types` myself to unblock. Get his sign-off on it before
building the dashboard against those shapes, or we will diverge exactly the
way section 9 of the plan warns about.

---

### 2026-07-20 — Session 4 — delivery routes, mock-data rewrite

**Prompt:** pull main, then continue my part of the work.

- Agent: code-logic, tester
- Files touched: `apps/web/src/app/api/deliver/**`,
  `apps/web/src/lib/delivery/auth.ts`, `apps/web/src/lib/api/mock-data.ts`,
  `apps/web/src/lib/__tests__/format.test.ts`,
  `apps/web/src/lib/delivery/__tests__/auth.test.ts`, `README.md`,
  `.env.example`
- Result: 48 tests passing, build clean, auth boundary verified live.

**The thing worth remembering:** the placeholder scores were wrong and nobody
would have noticed. `mock-data.ts` reimplemented the scoring formula by hand,
so it drifted the moment the real one changed — and it had never actually
matched. Anyone reviewing the dashboard without the API up was looking at a
ranking the system would never produce.

The fix was not to correct the numbers but to delete the duplicate: the mock
now feeds raw observations through the real `scoreCohort`. Do not reintroduce
a hand-copied formula anywhere in `apps/web`. If a value can be derived from
`@lumen/scoring`, derive it.

---

### 2026-07-24 — Final architecture reconciliation

Deepthi's dashboard, grounding, and delivery work was reconciled with the
completed backend implementation during the `preethesh/dev` → `main` merge.
The production tree now has one Next.js dashboard and one delivery path:

- the dashboard reads the real Express API and shows an explicit unavailable
  state instead of silently displaying placeholder crisis figures;
- grounded briefs are generated and persisted by `apps/api`, using optional
  Groq narration with a deterministic fallback;
- Telegram and Resend delivery run through the API and the imported n8n
  workflow; both were tested against live accounts;
- the earlier `apps/web/src` Claude/content-agent and duplicate delivery-route
  implementation remains preserved in Git history, but is not part of the
  final runtime, avoiding two competing implementations and Anthropic keys.

Deepthi's original design and testing notes above remain useful historical
context; current operating instructions live in `README.md` and
`docs/architecture.md`.
