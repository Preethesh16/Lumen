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
| Scoring engine (`packages/scoring`) | Working, 39 unit tests passing |
| Backend API (`apps/api`) | Working, verified end-to-end |
| Ingestion (UNHCR, FTS) | **Working against the live APIs** — real data ranked |
| Ingestion (GDELT) | Parser tested; live fetch unverified (dev IP throttled) |
| Ingestion (ReliefWeb) | **Blocked** — needs a registered `appname` (see below) |
| Local + production containers | Working; separate development and production Compose files |
| n8n workflow | Daily ingest → grounded brief → Telegram/email delivery; JSON-validated |
| Next.js dashboard (`apps/web`) | Complete; list, detail, trends, evidence, briefs, empty/error states |
| Brief generation | Complete; optional Groq narrative with deterministic grounded fallback |
| Telegram + email delivery | Complete and live-tested; Telegram also supports `/start`, `/help`, `/status` |
| CI/CD | Verification on every push; production images published from `main` |

## Quickstart

Requires Node 20+, pnpm 10, and Docker.

```bash
cp .env.example .env          # then fill in the values marked change_me
pnpm install
pnpm infra:up                 # Postgres 16 + n8n
pnpm --filter "./packages/**" build
pnpm db:migrate
pnpm --filter @lumen/api db:seed
pnpm dev                      # API :4000 and dashboard :3000
```

Ingest real data and see a ranking — no n8n needed:

```bash
pnpm --filter @lumen/api ingest unhcr   # one source
pnpm --filter @lumen/api ingest fts     # ~46 funding calls, ~1 min
pnpm --filter @lumen/api ingest         # all sources, scores at the end
curl localhost:4000/crises              # ranked list
```

Verify:

```bash
curl localhost:4000/health    # {"status":"ok","database":"connected"}
curl localhost:4000/crises    # empty until an ingestion run completes
```

Open the dashboard at <http://localhost:3000>.

n8n (for scheduled runs) is at http://localhost:5678 (basic auth, credentials
from `.env`). Import `n8n/workflows/lumen-daily-ingest.json` via **Workflows →
Import from File**, then activate it. The workflow calls `POST /ingest/run`,
generates a brief for the highest-ranked crisis, and attempts configured
delivery channels. All business logic lives in tested API modules, not in n8n.
For n8n to reach the API on Linux, run the API on the host and keep
`LUMEN_API_BASE_URL=http://host.docker.internal:4000`.

When Telegram credentials are configured, the API process also starts a
long-polling command listener restricted to `TELEGRAM_CHAT_ID`. `/status`
returns the latest highest-ranked crisis directly from Postgres; unknown chats
are ignored.

Run tests:

```bash
pnpm -r test
pnpm -r typecheck
pnpm --filter @lumen/web build
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
| `RELIEFWEB_APPNAME` | API | Optional; **must be registered** — see below |
| `GROQ_API_KEY` / `GROQ_MODEL` | brief generation | Optional. Without a key the grounded template is used |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | delivery | Optional until Telegram delivery is enabled |
| `RESEND_API_KEY` / `RESEND_FROM_EMAIL` / `DELIVERY_EMAIL_TO` | delivery | Optional until email delivery is enabled |
| `API_BASE_URL` | web server | Internal URL of the Express API |
| `LUMEN_ADMIN_SECRET` | web server | Optional override; otherwise `N8N_WEBHOOK_SECRET` is used. Never exposed to the browser |

### Why Groq is optional

Codex builds the repository but is not a runtime service inside a deployed
application. Lumen therefore needs a callable model API for newly generated
prose after deployment. Groq is optional: numeric facts are always rendered
deterministically from the exact stored score and observations; Groq may add
only a number-free narrative. Any model error or validation failure falls back
to the deterministic brief, so rankings and outreach never depend on an LLM.

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

One n8n workflow runs nightly at 02:00 UTC. It asks the API to fetch all
sources, persist observations, score the complete cohort once, generate a
grounded brief for the highest-ranked crisis, and attempt Telegram/email
delivery.

The API stores every raw reading in `source_observations` before computing
anything. Scores are derived from stored observations, never directly from an
HTTP response — which means the scoring formula can change and be backfilled
across all history without re-hitting a rate-limited upstream API.

Scoring normalizes need and coverage across the cohort and takes the
difference, amplified by underfunding. Full formula, weights, and known
limitations are in [`docs/architecture.md`](docs/architecture.md).

## Production deployment

Build and run the complete production stack:

```bash
docker compose --env-file .env -f infra/docker-compose.prod.yml up -d --build
```

On every push to `main`, GitHub Actions builds versioned API and web images and
publishes them to GitHub Container Registry. Configure the optional repository
secret `DEPLOY_HOOK_URL` to trigger a hosting platform after both images are
published.

External account actions that cannot be committed in source control:

1. Revoke any API key pasted into chat and create a fresh Groq key.
2. Put the fresh key only in `.env` locally and in the hosting provider's secret store.
3. Create a Telegram bot/chat and Resend sender if those channels are required.
4. Register the ReliefWeb appname when approval arrives; the other sources work without it.
5. Import and activate the n8n workflow once, then configure the production domain/deploy hook.

## License

MIT — see [`LICENSE`](LICENSE).
