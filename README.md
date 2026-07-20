# Lumen

Ranks under-reported humanitarian crises by cross-referencing crisis severity
against media coverage volume, and generates briefs for journalists, NGOs, and
donors.

The premise: humanitarian attention follows media coverage, and media coverage
is not proportional to need. Lumen measures that gap and makes it rankable.

**Authors:** Preethesh · Deepthi

---

## Status

| Component | State |
|---|---|
| Postgres schema + migrations | Working, verified against a live database |
| Scoring engine (`packages/scoring`) | Working, 37 unit tests passing |
| Backend API (`apps/api`) | Working, verified end-to-end |
| `infra/docker-compose.yml` | Working, brings up n8n + Postgres |
| n8n workflows | Written and JSON-valid; **not yet run inside n8n** |
| ReliefWeb ingestion | **Blocked** — needs a registered `appname` (see below) |
| Content-generation agent | Working, 15 tests; **not yet run against the live Claude API** |
| Dashboard (`apps/web`) | Working against the API contract; renders placeholder data until `LUMEN_API_URL` is set |
| Telegram + email delivery | Built and unit-tested; **never sent through a real bot or Resend account** |
| CI pipeline | Working |
| Deployment | **Not deployed.** The deploy job skips until `VERCEL_TOKEN` is set |

## Quickstart

Requires Node 20+, pnpm 10, and Docker.

```bash
cp .env.example .env          # then fill in the values marked change_me
pnpm install
pnpm infra:up                 # Postgres 16 + n8n
pnpm --filter "./packages/**" build
pnpm db:migrate
pnpm --filter @lumen/api db:seed
pnpm dev:api                  # http://localhost:4000
```

Verify:

```bash
curl localhost:4000/health    # {"status":"ok","database":"connected"}
curl localhost:4000/crises    # empty until an ingestion run completes
```

n8n is at http://localhost:5678 (basic auth, credentials from `.env`).
Import the four workflows from `n8n/workflows/` via **Workflows → Import from
File**. They are mounted read-only inside the container at `/workflows`.

Start the dashboard:

```bash
pnpm --filter @lumen/web dev    # http://localhost:3000
```

**The dashboard runs without any of the above.** With `LUMEN_API_URL` unset it
serves clearly-labelled placeholder data, so the frontend works before the API
is up. A banner says when figures are not real — that stays after the API
lands, because n8n runs nightly and there is always a window where the
database is empty.

Run tests:

```bash
pnpm -r test
pnpm -r typecheck
```

## Environment variables

All live in a single `.env` at the repo root. Never commit it — it is
gitignored, and CI fails the build if it is ever tracked.

| Variable | Used by | Notes |
|---|---|---|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Docker, API | |
| `POSTGRES_PORT` | Docker | Default 5432, published to the host |
| `DATABASE_URL` | API, drizzle-kit | Must match the Postgres values above |
| `API_PORT` | API | Default 4000 |
| `NODE_ENV` | API | `development` \| `test` \| `production` |
| `N8N_WEBHOOK_SECRET` | API, n8n | Min 16 chars. Sent as `x-lumen-webhook-secret` |
| `N8N_PORT` | Docker | Default 5678 |
| `N8N_BASIC_AUTH_USER` / `N8N_BASIC_AUTH_PASSWORD` | n8n | UI login |
| `N8N_ENCRYPTION_KEY` | n8n | 32+ chars. Generate: `openssl rand -hex 16` |
| `LUMEN_API_BASE_URL` | n8n | How n8n reaches the API. `http://host.docker.internal:4000` locally |
| `RELIEFWEB_APPNAME` | n8n | **Must be registered** — see below |
| `LUMEN_API_URL` | dashboard | Unset ⇒ labelled placeholder data |
| `NEXT_PUBLIC_DASHBOARD_URL` | email digest | Link target in digest emails |
| `ANTHROPIC_API_KEY` | brief generation | Deepthi |
| `ANTHROPIC_MODEL` | brief generation | Optional; defaults to `claude-sonnet-5` |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | delivery | Deepthi. Bot must be a channel admin |
| `RESEND_API_KEY` / `DIGEST_FROM_EMAIL` | email digest | From-address must be on a Resend-verified domain |

None of these are needed to start the dashboard. Each unlocks a capability,
and the UI explains what is missing when one is absent rather than failing.

## Data sources

All free, none requires a paid key. Behaviour below was verified against the
live APIs on 2026-07-20 — two of the four differ from what the project plan
assumed.

| Source | Signal | Gotcha |
|---|---|---|
| [GDELT DOC 2.0](https://api.gdeltproject.org/api/v2/doc/doc) | Media coverage volume | Hard limit **1 request / 5s**; returns plain text, not JSON, when exceeded |
| [ReliefWeb](https://apidoc.reliefweb.int/) | Active disaster count | **403 unless the `appname` is registered.** Arbitrary appname strings do not work |
| [UNHCR](https://api.unhcr.org/population/v1/population/) | Displaced persons | Some counts come back as strings |
| [OCHA FTS](https://api.hpc.tools/v2/public/plan) | Appeal size + funding gap | Plan endpoint has **no funding field**; needs a second call per plan |

### ReliefWeb is blocked

`RELIEFWEB_APPNAME` must be registered at
<https://apidoc.reliefweb.int/parameters#appname>. Until then the ReliefWeb
workflow fails with a clear error rather than silently producing no data. The
other three sources work without registration, and scoring degrades gracefully
without the disaster-count signal.

## Repository layout

```
lumen/
├── apps/
│   ├── api/                 # Express + TypeScript + Drizzle   (Preethesh)
│   └── web/                 # Next.js dashboard                 (Deepthi)
├── packages/
│   ├── shared-types/        # API contract — shared, agree before changing
│   └── scoring/             # Pure scoring engine + tests
├── n8n/workflows/           # Versioned workflow exports
├── infra/docker-compose.yml # n8n + Postgres 16
├── docs/architecture.md     # Design decisions and known limitations
├── phase.md                 # Milestones + acceptance criteria
├── progress.md              # Chronological session log
└── preethesh.md / deepthi.md
```

## How it works

Four n8n workflows run nightly, staggered from 02:00 UTC, and POST their
readings to the API. The last one triggers scoring, so the cohort is scored
once on complete data rather than four times on partial data.

The API stores every raw reading in `source_observations` before computing
anything. Scores are derived from stored observations, never directly from an
HTTP response — which means the scoring formula can change and be backfilled
across all history without re-hitting a rate-limited upstream API.

Scoring normalizes need and coverage across the cohort and takes the
difference, amplified by underfunding. Full formula, weights, and known
limitations are in [`docs/architecture.md`](docs/architecture.md).

The dashboard reads `GET /crises` and `GET /crises/:id`. For a selected
crisis, the content-generation agent turns that stored data into three
audience-tailored briefs — a journalist pitch, a donor one-pager, and an NGO
fundraising angle — which are delivered to Telegram and a weekly digest email.

### Briefs are grounded or they are withheld

The content agent receives a JSON payload and is told that payload is the
entire universe of available facts. That instruction is not trusted on its
own. `validateGrounding` extracts every figure from the generated text and
traces it back to the input; a brief containing a number that cannot be traced
is never shown and never sent.

This matters because the output is a factual claim about a humanitarian
emergency handed to a reporter or a programme officer who will act on it. An
invented casualty count that reads plausibly is worse than no brief at all, and
a prompt is a request rather than a guarantee. The validator is deliberately
conservative — it flags anything it cannot positively trace, because a false
positive costs a human glance while a false negative ships a fabricated figure
to someone who will repeat it.

Prompts live as markdown files in `apps/web/src/lib/content-agent/prompts/`
rather than inline strings, so a change to what the model is told shows up as
a reviewable diff.

## License

Not yet chosen.
