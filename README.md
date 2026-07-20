# Lumen

**Lumen finds the humanitarian crises nobody is reporting on.**

A crisis being severe and a crisis being covered are two different things, and
the gap between them is measurable. Lumen pulls humanitarian severity data and
media-coverage volume from four public sources, scores every tracked crisis on
both, and ranks them by the distance between the two — then writes briefs that
journalists, donors, and NGOs can act on.

Built by **Deepthi** and **Preethesh**.

---

## The problem

Media attention is not distributed in proportion to need. A displacement crisis
affecting a million people can run for months with almost no coverage while a
smaller emergency dominates the news cycle. Funding follows coverage, so the
under-reported crises stay under-funded — and the people who could change that
(reporters looking for a story, programme officers allocating budget) have no
systematic way to find them.

## The approach

```
┌─────────────────────────────────────────────────────────────────┐
│  Data sources (free, no API keys)                               │
│  GDELT DOC 2.0 · ReliefWeb · UNHCR · UN OCHA FTS                │
└────────────────────────────┬────────────────────────────────────┘
                             │  daily schedule trigger
                             ▼
                   ┌───────────────────┐
                   │   n8n workflows   │  ingestion + orchestration
                   └─────────┬─────────┘
                             │  POST /webhook/n8n-score-update
                             ▼
              ┌──────────────────────────────┐
              │   apps/api  (Express + TS)   │
              │   scoring · persistence      │
              └───────┬──────────────┬───────┘
                      │              │
                      ▼              ▼
             ┌────────────────┐   ┌──────────────┐
             │  PostgreSQL    │   │  apps/web    │  Next.js dashboard
             │  crisis_scores │   │              │
             └────────────────┘   └──────┬───────┘
                                         │
                          ┌──────────────┴──────────────┐
                          ▼                             ▼
              ┌───────────────────────┐      ┌────────────────────┐
              │ Content-gen agent     │      │ Delivery           │
              │ Claude API · 3 briefs │─────▶│ Telegram · Resend  │
              │ + grounding check     │      │                    │
              └───────────────────────┘      └────────────────────┘
```

**The attention gap score** is `need − coverage`, both normalized to 0–1 across
the tracked set and weighted by underfunding where OCHA has an appeal on
record. Positive means under-reported relative to need. It is a relative
ranking across tracked crises, not an absolute measurement, and the UI says so.

**Briefs are grounded or they are withheld.** The content agent gets a JSON
payload and is told that payload is the entire universe of available facts.
That instruction is not trusted on its own: `validateGrounding` extracts every
figure from the generated text and traces it back to the input, and a brief
with an untraceable number is never shown. These briefs go to journalists and
donors who act on them — a fabricated casualty figure or an invented funding
gap would do real damage, so a missing brief is the better failure.

---

## Running locally

**Prerequisites:** Node 20+, Docker (for n8n and Postgres).

```bash
git clone git@github.com:Preethesh16/Lumen.git
cd Lumen
npm install
cp .env.example .env          # fill in the keys you need — see below
npm run build --workspace=@lumen/shared-types
```

Start the infrastructure and the API (Preethesh's side):

```bash
docker compose -f infra/docker-compose.yml up -d   # n8n on :5678, Postgres on :5432
npm run dev --workspace=@lumen/api                 # API on :4000
```

Start the dashboard:

```bash
npm run dev --workspace=@lumen/web                 # dashboard on :3000
```

**The dashboard runs without any of that.** With `LUMEN_API_URL` unset it
serves clearly-labelled placeholder data, so the frontend can be developed and
reviewed before the backend exists. A banner tells you when you are looking at
placeholder figures.

### Environment variables

Every variable is documented in [`.env.example`](.env.example). Nothing is
required to start the dashboard; each one unlocks a capability:

| Variable | Needed for | Without it |
|---|---|---|
| `LUMEN_API_URL` | Live crisis data | Placeholder data, labelled in the UI |
| `ANTHROPIC_API_KEY` | Brief generation | Briefs page explains why it is empty |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | Telegram delivery | Send returns a logged failure |
| `RESEND_API_KEY` / `DIGEST_FROM_EMAIL` | Weekly digest email | Digest returns a logged failure |
| `DATABASE_URL` | API persistence | API cannot start |

No secret is ever committed. CI builds without any of them on purpose — if the
build needs a secret, something is reading it at build time that should be
reading it per request.

### Tests

```bash
npm test --workspaces --if-present
```

The suite that matters most is `apps/web/src/lib/content-agent/__tests__` — it
feeds the grounding validator briefs containing fabricated statistics and
asserts they are caught.

---

## Repository layout

| Path | Contents | Owner |
|---|---|---|
| `apps/web` | Next.js dashboard, content agent, delivery | Deepthi |
| `apps/api` | Express API, scoring, persistence | Preethesh |
| `n8n/workflows` | Exported n8n workflow JSON | Preethesh |
| `packages/shared-types` | The API contract between the two | Shared |
| `infra` | Docker Compose for n8n + Postgres | Preethesh |
| `.claude/agents` | Subagent definitions | Shared |
| `progress.md` · `phase.md` | Session log and milestone tracker | Shared |

## Deployment

`apps/web` deploys to Vercel; `apps/api`, n8n, and Postgres to Railway. CI runs
lint, typecheck, and tests on every branch, and deploys on merge to `main`.
Rationale is in [`docs/architecture.md`](docs/architecture.md).

## Data sources

| Source | Provides | Access |
|---|---|---|
| [GDELT DOC 2.0](https://api.gdeltproject.org/api/v2/doc/doc) | Media coverage volume | Free, no key |
| [ReliefWeb](https://api.reliefweb.int/v2/) | Disaster and crisis severity | Free, `appname` param |
| [UNHCR Refugee Data Finder](https://api.unhcr.org/population/v1/) | Displacement counts | Free, no key |
| [UN OCHA FTS](https://api.hpc.tools/v2/) | Appeal funding percentage | Free, no key |
