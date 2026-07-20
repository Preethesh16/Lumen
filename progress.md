# Lumen — Progress Log

Append-only. Newest session at the bottom. Every session gets an entry.

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
