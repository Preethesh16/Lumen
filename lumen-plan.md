# Lumen — Production Build Plan
### Senior architecture + 2-person work split + Claude Code multi-agent kickoff prompts

---

## 1. Stack decision (and why)

| Layer | Choice | Why |
|---|---|---|
| Orchestration engine | **n8n**, self-hosted via Docker | Required by the course brief; also genuinely the right tool — visual workflow + schedule triggers + HTTP nodes + native AI Agent nodes |
| Backend API | **Node.js + Express (TypeScript)** | Thin layer between n8n (webhooks) and the frontend/DB. TS gives shared types with a Next.js frontend, which matters more than it sounds for a 2-person team |
| Database | **PostgreSQL** (via Supabase or Neon free tier) | Structured time-series data (crisis scores over time) — relational, not document — Postgres is the right call, not Mongo |
| LLM | **Groq API** for optional brief narrative; deterministic grounded fallback | Fast runtime generation without making scoring or outreach depend on an LLM |
| Frontend | **Next.js 15 (App Router) + Tailwind + shadcn/ui** | Fast to build a dashboard, deploys trivially to Vercel, TS shared with backend |
| Data sources | GDELT DOC 2.0, ReliefWeb API, UNHCR API, OCHA FTS API — all free, no keys except registration-only ones | Confirmed free during the research phase |
| Notifications | Telegram Bot API (fastest to stand up) + Resend/SendGrid for email | Telegram needs zero business verification, ships same day |
| CI/CD | **GitHub Actions** — lint, typecheck, test on every push; deploy on merge to `main` | Standard, free for small repos |
| Hosting | n8n + Postgres + API → **Railway** or **Fly.io**; Frontend → **Vercel** | Zero-DevOps-team-friendly, still "real" production infra |
| Secrets | `.env` locally, GitHub Actions/Railway/Vercel env vars in prod — **never committed** | Non-negotiable |
| Monitoring | Railway/Vercel built-in logs + optional free Sentry tier | Enough for a capstone-to-production jump without overkill |

This is intentionally boring, cheap, and provable — a senior engineer's job is to pick the stack that ships, not the one that's impressive on a resume.

---

## 2. Repo structure

```
lumen/
├── README.md                 # project overview (owned by both, generated first)
├── progress.md                # chronological log — EVERY session appends here
├── phase.md                   # milestone/phase tracker with checkboxes
├── preethesh.md                # Preethesh's personal work log (AI-updated every action)
├── deepthi.md                  # Deepthi's personal work log (AI-updated every action)
├── .claude/
│   └── agents/
│       ├── code-logic.md
│       ├── debugger.md
│       ├── tester.md
│       ├── verifier.md
│       └── problem-solver.md
├── .github/workflows/ci.yml
├── n8n/
│   └── workflows/             # exported n8n JSON workflow files (versioned!)
├── apps/
│   ├── api/                   # Express backend — Preethesh owns
│   └── web/                   # Next.js dashboard — Deepthi owns
├── packages/
│   └── shared-types/          # shared TS types between api and web
├── infra/
│   └── docker-compose.yml     # local n8n + postgres spin-up
└── docs/
    └── architecture.md
```

---

## 3. Git workflow (SSH, no AI co-author trailers)

- `main` = always deployable.
- Each person works on their own long-lived branch: `preethesh/dev`, `deepthi/dev`.
- Feature work happens in short-lived branches off those, e.g. `preethesh/data-ingestion`, `deepthi/dashboard-ui`, merged into their own `dev` branch first, then into `main`.
- **Tell Claude Code explicitly not to add `Co-Authored-By: Claude` trailers or any AI attribution to commits.** Both prompts below include this instruction.
- Push over SSH as normal: `git push origin preethesh/dev`.

Commit convention: `feat(api): add GDELT ingestion agent`, `fix(web): correct gap-score sort order`, `docs(progress): log session 4`.

---

## 4. The five subagents (real Claude Code feature)

Claude Code supports **subagents**: Markdown files with YAML frontmatter in `.claude/agents/`, each with its own isolated context window, tool permissions, and system prompt. The main session automatically delegates to them based on their `description` field, and they can run **in parallel**. This is the real mechanism behind what you're describing. Both prompts below tell Claude Code to create these files first.

**`.claude/agents/code-logic.md`**
```markdown
---
name: code-logic
description: Designs and implements core business logic, API routes, n8n workflow logic, and data models. Use for any new feature implementation.
tools: Read, Write, Edit, Glob, Grep, Bash
model: sonnet
---
You are the Code Logic agent. You implement features cleanly and idiomatically
in the project's chosen stack. You do NOT skip error handling, you write
typed interfaces first, and you never leave TODOs without opening a note in
progress.md. After every change you make, append a one-line entry to the
relevant person's log file (preethesh.md or deepthi.md) describing what you
built and why, with a timestamp.
```

**`.claude/agents/debugger.md`**
```markdown
---
name: debugger
description: Investigates failing code, stack traces, and unexpected behavior. Use proactively whenever something breaks or a test fails.
tools: Read, Grep, Glob, Bash
model: sonnet
---
You are the Debugging agent. You reproduce the issue, isolate root cause with
targeted logging before any fix is attempted. You do not guess-and-check
blindly. Log every bug found and its root cause to progress.md under a
"Bugs Found" section.
```

**`.claude/agents/tester.md`**
```markdown
---
name: tester
description: Writes and runs unit/integration tests, and validates n8n workflow outputs against expected data. Use after any feature is implemented.
tools: Read, Write, Edit, Bash, Grep
model: sonnet
---
You are the Testing agent. You write tests BEFORE marking any task complete,
cover edge cases (empty API responses, malformed data, rate limits), and run
the full suite before reporting success. Record pass/fail counts in progress.md.
```

**`.claude/agents/verifier.md`**
```markdown
---
name: verifier
description: Cross-checks completed work against the original requirement, checks for hallucinated data or incorrect assumptions, and confirms production-readiness. Use before any merge to main.
tools: Read, Grep, Glob, Bash
model: sonnet
---
You are the Verify agent — the most skeptical member of the team. You compare
finished work against phase.md's stated acceptance criteria line by line, flag
anything that "looks done but isn't", check that secrets aren't hardcoded, and
block merge-readiness claims until everything checks out. Write your verdict
(PASS/FAIL + reasons) into progress.md.
```

**`.claude/agents/problem-solver.md`**
```markdown
---
name: problem-solver
description: Handles ambiguous architecture decisions, unblocks the team when multiple approaches are possible, and resolves conflicts between agent recommendations. Use when other agents disagree or a design decision is unclear.
tools: Read, Grep, Glob, WebSearch, WebFetch
model: sonnet
---
You are the Problem Solver. You are called in when there's a fork in the
road — competing implementation strategies, an ambiguous requirement, or a
blocked task. You research if needed, weigh trade-offs explicitly, pick one
path, and explain why in progress.md so the decision is never re-litigated
without new information.
```

---

## 5. Markdown tracking file templates (Claude Code should create these on first run)

**`progress.md`** — append-only chronological log, every session:
```markdown
## Session [N] — [date] — [Preethesh/Deepthi]
**Goal:** ...
**Agents used:** code-logic, tester
**Changes made:**
- ...
**Bugs found:** ...
**Decisions made:** ...
**Next up:** ...
```

**`phase.md`** — milestone tracker:
```markdown
## Phase 1 — Foundation (Week 1)
- [x] Repo scaffolding + Docker compose (n8n + Postgres)
- [x] Data ingestion: GDELT + ReliefWeb + UNHCR HTTP nodes
- [x] DB schema for crisis_scores table
## Phase 2 — Core Agent Logic (Week 2)
- [x] Scoring node (need vs. coverage → gap score)
- [x] Content-generation agent (Groq API + grounded fallback) for briefs
- [x] API endpoints to serve ranked crises
## Phase 3 — Delivery + Frontend (Week 3)
- [x] Telegram/email outreach agent
- [x] Next.js dashboard
- [x] CI/CD + deployment artifacts
## Phase 4 — Hardening (Week 4)
- [x] Error handling, rate-limit backoff
- [x] Tests + verify pass
- [ ] Final deploy + demo recording
```

**`preethesh.md`** / **`deepthi.md`** — personal running log, auto-appended after every prompt/action:
```markdown
### [timestamp] Prompt: "add GDELT ingestion node"
- Agent: code-logic
- Files touched: apps/api/src/ingestion/gdelt.ts
- Result: implemented, tests pending
```

---

## 6. Work split (minimizes merge conflicts — split by directory ownership)

**Preethesh — Data & Orchestration Owner**
- n8n workflows (GDELT, ReliefWeb, UNHCR, OCHA FTS ingestion)
- Postgres schema + migrations
- Scoring algorithm (need vs. coverage → Attention-Gap Score)
- Backend API (`apps/api`)
- Docker Compose local infra

**Deepthi — Delivery & Experience Owner**
- Groq API integration for the Content-Generation Agent (brief writing)
- Telegram bot + email delivery (Outreach agent)
- Next.js dashboard (`apps/web`)
- CI/CD pipeline + deployment (Railway + Vercel)
- README.md + docs/architecture.md

They meet in the middle at the API contract (`packages/shared-types`) — agree on that schema together on day one before splitting off.

---

## 7. Prompt for Preethesh (paste into Claude Code)

```
I'm Preethesh, working on "Lumen" — a production-grade
multi-agent system that ranks under-reported humanitarian crises by
cross-referencing crisis-severity data against media-coverage volume, and
auto-generates briefs for journalists/NGOs/donors. This is a 2-person
project built with a teammate, Deepthi, who owns the frontend/delivery side.
I own data ingestion, orchestration, scoring, and the backend API.

Repo: [paste your git remote URL]. I use SSH, so push directly to
origin — do NOT add yourself as a contributor, do NOT add any
"Co-Authored-By: Claude" or AI-attribution trailers to commits. Commits
should look like normal human commits from me.

SETUP — do this first, in order:
1. If not already present, create the repo structure exactly as below and
   commit it as the initial scaffold on branch `preethesh/dev`:
   lumen/
   ├── README.md, progress.md, phase.md, preethesh.md, deepthi.md
   ├── .claude/agents/{code-logic,debugger,tester,verifier,problem-solver}.md
   ├── .github/workflows/ci.yml
   ├── n8n/workflows/
   ├── apps/api/  (Node.js + Express + TypeScript)
   ├── apps/web/  (leave empty, Deepthi owns this)
   ├── packages/shared-types/
   ├── infra/docker-compose.yml (n8n + Postgres)
   └── docs/architecture.md

2. Create the five subagent files in .claude/agents/ with this exact
   frontmatter and role split — code-logic (implements features),
   debugger (root-causes failures), tester (writes/runs tests before
   anything is marked done), verifier (cross-checks finished work against
   phase.md acceptance criteria before I merge, blocks bad merges),
   problem-solver (resolves ambiguous design decisions). Give code-logic
   and tester write access; give verifier and debugger read+bash only, no
   write, so they can't quietly "fix" things without me seeing the diagnosis
   first. Use these subagents proactively and in parallel where the work
   is independent — e.g. while code-logic implements the GDELT ingestion
   node, tester can be writing test fixtures for it from the API docs.

3. Initialize progress.md, phase.md (use the 4-phase plan below), and
   preethesh.md. From now on, EVERY time you take an action — write code,
   run a command, make a design decision, or I give you a new prompt —
   append a timestamped entry to preethesh.md AND to progress.md
   summarizing what happened, which subagent handled it, and the result.
   This is not optional; treat it as part of "done."

MY SCOPE OF WORK (do not touch apps/web — that's Deepthi's):
- infra/docker-compose.yml: local n8n (with the AI Agent node enabled) +
  Postgres 16.
- n8n/workflows/: build and EXPORT (as versioned JSON) the ingestion
  workflows:
  - GDELT DOC 2.0 API (https://api.gdeltproject.org/api/v2/doc/doc,
    mode=timelinevol and artlist, no key) — pull media-coverage volume
    per crisis/country.
  - ReliefWeb API (https://api.reliefweb.int/v2/, needs an `appname`
    query param, no key) — pull disaster/crisis severity data.
  - UNHCR Refugee Data Finder API (https://api.unhcr.org/population/v1/,
    no key) — displacement counts.
  - UN OCHA FTS/HPC API (https://api.hpc.tools/v2/, no key) — appeal
    funding percentage, for the underfunding signal.
  Schedule-trigger these to run daily.
- Postgres schema: a `crisis_scores` table storing crisis_id, country,
  need_score, coverage_score, funding_gap_pct, attention_gap_score,
  computed_at — designed so we can query week-over-week trend changes.
- Scoring logic: normalize need and coverage to 0-1, compute
  attention_gap_score = need_score - coverage_score (weighted by
  underfunding if available). Put this as a well-tested pure function,
  not buried inside an n8n node, so it's unit-testable.
- apps/api: Express + TypeScript REST API exposing:
  GET /crises (ranked list), GET /crises/:id (detail + history),
  POST /webhook/n8n-score-update (n8n calls this after each run to
  persist scores to Postgres).
- packages/shared-types: the Crisis, ScoreHistory, Brief TypeScript
  interfaces — coordinate with Deepthi so these match what she needs on
  the frontend before either of us builds against them.

Use real error handling (API timeouts, malformed JSON, rate limits —
GDELT and ReliefWeb WILL occasionally 429 or return partial data; build
retry/backoff). No hardcoded secrets — use .env locally and document
required vars in README.md.

Start by proposing the exact Postgres schema and the shared-types
interfaces as a first message for me to approve before you scaffold
everything — then proceed.
```

---

## 8. Prompt for Deepthi (paste into Claude Code)

```
I'm Deepthi, working on "Lumen" — a production-grade
multi-agent system that ranks under-reported humanitarian crises by
cross-referencing crisis-severity data against media-coverage volume, and
auto-generates briefs for journalists/NGOs/donors. This is a 2-person
project built with a teammate, Preethesh, who owns data ingestion,
orchestration (n8n), scoring, and the backend API. I own the
Content-Generation agent, delivery/notifications, the frontend dashboard,
and deployment.

Repo: [paste your git remote URL]. I use SSH, so push directly to
origin — do NOT add yourself as a contributor, do NOT add any
"Co-Authored-By: Claude" or AI-attribution trailers to commits. Commits
should look like normal human commits from me.

SETUP — do this first, in order:
1. Clone the repo and check out (or create) branch `deepthi/dev` off
   `main`. The repo scaffold (including .claude/agents/, progress.md,
   phase.md, preethesh.md, deepthi.md) should already exist from
   Preethesh's setup — if any piece is missing, create it to match this
   structure without touching his apps/api work:
   lumen/
   ├── README.md, progress.md, phase.md, preethesh.md, deepthi.md
   ├── .claude/agents/{code-logic,debugger,tester,verifier,problem-solver}.md
   ├── .github/workflows/ci.yml
   ├── n8n/workflows/        (Preethesh owns — don't edit)
   ├── apps/api/             (Preethesh owns — don't edit, only consume)
   ├── apps/web/             (MINE — Next.js 15, App Router, Tailwind, shadcn/ui)
   ├── packages/shared-types/ (SHARED — coordinate before changing)
   └── docs/architecture.md

2. If .claude/agents/ subagent files don't exist yet, create them with
   this exact role split — code-logic (implements features), debugger
   (root-causes failures), tester (writes/runs tests before anything is
   marked done), verifier (cross-checks finished work against phase.md
   acceptance criteria before I merge, blocks bad merges), problem-solver
   (resolves ambiguous design decisions). Give code-logic and tester
   write access; give verifier and debugger read+bash only, no write.
   Use these subagents proactively and in parallel where work is
   independent — e.g. while code-logic builds the dashboard's crisis
   list view, tester can be writing component tests against mock data
   in parallel.

3. Initialize/continue progress.md, phase.md (use the 4-phase plan
   below), and deepthi.md. From now on, EVERY time you take an action —
   write code, run a command, make a design decision, or I give you a
   new prompt — append a timestamped entry to deepthi.md AND to
   progress.md summarizing what happened, which subagent handled it,
   and the result. This is not optional; treat it as part of "done."

MY SCOPE OF WORK (do not touch apps/api or n8n/workflows — that's
Preethesh's):
- Content-Generation agent: a service (can live as a small module I own,
  called either from n8n or from apps/web's server actions) that calls
  the Groq API to turn a ranked crisis + its raw data into THREE
  audience-tailored outputs: a journalist pitch, a donor one-pager, and
  an NGO fundraising angle. Ground every generation strictly in the
  structured data passed in — never let the model invent statistics.
  Keep prompts in version-controlled files, not hardcoded inline strings.
- Outreach/delivery: Telegram Bot API integration (fastest path — set up
  a bot via BotFather, no business verification needed) to push new
  top-ranked briefs to a channel/chat. Also wire up email delivery via
  Resend or SendGrid for a "weekly digest" email. Handle delivery
  failures gracefully and log them.
- apps/web: Next.js 15 dashboard consuming Preethesh's API
  (GET /crises, GET /crises/:id) — a ranked table/cards view of crises
  by Attention-Gap Score, a detail view showing the need vs. coverage
  trend over time (simple chart), and a view of generated briefs per
  crisis with copy-to-clipboard. Clean, readable, no over-design — this
  is a working tool, not a marketing site.
- CI/CD: .github/workflows/ci.yml running lint + typecheck + tests on
  every push to any branch, and a separate deploy step that runs on
  merge to main — apps/web deploys to Vercel, apps/api + n8n + Postgres
  deploy to Railway (or Fly.io if Railway's free tier doesn't fit — you
  decide and document the choice in docs/architecture.md).
- README.md: write the final project overview — problem, solution,
  architecture diagram (can be ASCII or Mermaid), how to run locally,
  how it's deployed, and credit both of us as authors normally (not as
  AI-generated).
- packages/shared-types: coordinate with Preethesh's Crisis, ScoreHistory,
  Brief interfaces before building UI against them — don't invent a
  parallel shape.

Use real error handling (Groq API rate limits/timeouts, Telegram send
failures, empty crisis lists on first run). No hardcoded secrets — use
.env locally and document required vars in README.md.

Start by proposing the exact shape of the Content-Generation agent's
prompt template and the dashboard's page structure as a first message
for me to approve before you scaffold everything — then proceed.
```

---

## 9. A few senior-level things to actually do (not just say)

- **Agree on `packages/shared-types` together, live, before either of you writes a line of app code.** This is the #1 place 2-person projects silently diverge.
- **Run `verifier` before every merge to `main`**, not just at the end — catch drift early.
- **Don't let n8n hold business logic that needs unit tests** — push scoring/normalization into a plain TypeScript function that n8n calls via an HTTP node to your own API, so it's testable outside n8n's UI.
- **Rate limits are real**: GDELT and ReliefWeb will throttle you during testing. Cache responses locally during dev so you're not burning quota on every test run.
- **Demo-readiness**: since this needs to be "working, deployed," budget the last few days purely for hardening — empty states, API failures, and a clean `README.md` walkthrough matter as much as the core feature for how this reads as production-grade.
