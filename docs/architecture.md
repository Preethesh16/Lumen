# Lumen — Architecture

## Problem

Humanitarian attention is allocated by media coverage, and media coverage is
not proportional to need. Some of the largest crises in the world are close to
invisible. Lumen measures that gap directly: it cross-references crisis
severity against media coverage volume, ranks crises by how under-reported they
are, and generates briefs for journalists, donors, and NGOs.

## Data flow

n8n is only a **scheduler**. All fetch-and-parse logic lives in the API's
tested ingestion module (`apps/api/src/ingest`), not in n8n Code nodes — the
same principle the plan applied to scoring: business logic that deserves a unit
test does not live where it cannot be tested.

```
   ┌─ n8n (daily 02:00 UTC) ─┐
   │  Daily ingest workflow  │──── POST /ingest/run  (x-lumen-webhook-secret)
   └─────────────────────────┘        │
                                       ▼
                          ┌──────────────────────────────┐
   GDELT ◄────────────────┤  apps/api (Express)          │
   ReliefWeb ◄────────────┤   ingest/sources/*  (tested) │──── fetch + parse
   UNHCR ◄────────────────┤   ingest/run  orchestrator   │
   OCHA FTS ◄─────────────┤   ingest/persist  (upsert)   │
                          │   → packages/scoring         │──── pure, unit-tested
                          └───────────┬──────────────────┘
                                      │
   POST /webhook/n8n-score-update ────┤  (alternative entry: a caller that
   (accepts pre-parsed observations)  │   does its own fetching)
                                      ▼
                          ┌────────────────────────┐
                          │   Postgres 16          │
                          │  crises                │
                          │  ingestion_runs        │
                          │  source_observations   │◄── raw readings, replayable
                          │  crisis_scores         │◄── append-only time series
                          │  briefs                │
                          └───────────┬────────────┘
                                      │ GET /crises, /crises/:id
                                      ▼
                          ┌────────────────────────┐
                          │  apps/web (Next.js)    │
                          │  + Groq brief agent    │
                          │  + Telegram / email    │
                          └────────────────────────┘
```

### Two ingestion entry points

- **`POST /ingest/run`** — the API fetches from the live upstreams itself using
  the tested adapters, then persists and scores. This is what the n8n workflow
  and the `pnpm ingest` CLI both call. Optional `{ "source": "unhcr" }` runs one
  source; an empty body runs all four and scores once at the end.
- **`POST /webhook/n8n-score-update`** — accepts already-parsed observations
  from a caller that does its own fetching. Kept as a stable contract; both
  paths share the same `persistObservations` write logic, so upsert idempotency
  and run bookkeeping exist in exactly one place.

A source failure never aborts the others: `ingestAll` captures each result, so
ReliefWeb failing (no appname yet) still yields a full ranking from the other
three. Verified live — UNHCR and FTS produce a real ranking on their own.

## Why the schema looks like this

**`source_observations` is separate from `crisis_scores`.** This is the most
consequential decision in the design. Keeping raw readings means a change to
the scoring weights can be backfilled across all history without re-hitting
GDELT or ReliefWeb. Without it, a formula tweak either destroys history or
burns the rate limit re-fetching it. Scoring weights *will* change.

**Every write is idempotent.** `source_observations` has a unique natural key
of `(crisis_id, source, metric, observed_at)`; `crisis_scores` has
`(crisis_id, scored_for, algorithm_version)`. n8n retries failed nodes, and
without these constraints a retry silently double-counts.

**Scores carry `algorithm_version` and `inputs`.** Old scores survive a formula
change instead of being overwritten, two versions can be compared over the same
period, and every number is explainable. This also backs the anti-hallucination
requirement: a brief references `score_id`, so any statistic it cites traces to
a stored row.

**A crisis is one country (ISO3).** All four sources are country-keyed; none of
GDELT, UNHCR or FTS knows about a ReliefWeb disaster ID. Per-disaster modelling
would require inventing a rule to split one country-level measurement across
several rows. Revisit if a source with sub-national granularity is added.

## Scoring

Implemented in `packages/scoring` — pure, dependency-free, and unit-tested
outside n8n, because business logic buried in a workflow node cannot be tested.

1. **Log-transform** every input. Displacement counts span three orders of
   magnitude across the cohort; linear normalization would collapse everything
   except the largest country to near zero.
2. **Min-max normalize** across the cohort scored in this run, to 0..1.
3. **need_score** = weighted mean of normalized displacement (0.5), appeal size
   (0.3), and active disaster count (0.2). Missing components are dropped and
   the remaining weights re-normalized — a country absent from UNHCR is scored
   on the sources it does have, rather than being treated as having zero need.
   Distinguishing "no need" from "no data" matters more here than anywhere
   else in the system: conflating them would systematically rank data-poor
   crises as low-need, and data-poor crises are precisely the population this
   product exists to surface.
4. **coverage_score** = normalized GDELT coverage volume.
5. **attention_gap_score** (v1.1.0) =
   `(need − coverage) × (1 + 0.5 × funding_gap) + 0.3 × funding_gap`.
   Underfunding acts two ways: it *amplifies* an existing gap, and it adds an
   *independent* term. The additive term exists to fix a real failure of the
   original multiplicative-only formula (see below). Its trade-off, accepted
   deliberately: a well-covered but underfunded crisis gets a small positive
   nudge it did not previously get. Set `fundingBonus: 0` to recover the pure
   multiplicative model.

### Known limitations

These are recorded deliberately, not overlooked.

- **Normalization is cohort-relative.** Scores are comparable within a run but
  drift across runs as the cohort changes. `inputs` stores the raw values so
  scores can be recomputed on a fixed scale later without re-fetching.
- **Min-max floors the cohort minimum at exactly 0.** The lowest-ranked country
  on a metric scores 0 on it. Under the original multiplicative-only formula
  (v1.0.0), this combined with `0 × anything = 0` so a country that was
  genuinely low-signal but severely underfunded scored identically to one with
  no data at all. Observed live with Chad: 1.9M displaced and 89% unfunded
  scored 0.000. **v1.1.0 fixes this** with the additive funding term — Chad now
  scores 0.267 and ranks above Ukraine. The underlying floor property remains;
  the additive term is what stops it zeroing out a real signal. The fix was
  chosen empirically: a floor-only change (normalizing onto `[0.05, 1]`) was
  tried first and does *not* work, because it shifts need and coverage by the
  same amount and leaves their difference at zero.
- **Multi-country FTS plans attribute the full requirement to each member
  country.** Splitting evenly would understate need in the country actually
  hosting the response, and the API offers no basis for weighting.

## Upstream API notes (verified live 2026-07-20)

| Source | Endpoint | Auth | Verified behaviour |
|---|---|---|---|
| GDELT DOC 2.0 | `api.gdeltproject.org/api/v2/doc/doc` | none | Hard limit of **1 request / 5s**. Returns a plain-text warning, not JSON, when exceeded. Adapter paces at 1 per 6s. **Not verified end-to-end** — this dev IP was throttled during testing, so GDELT is the one source proven only at the parse layer (fixture-tested), not against a live fetch. Uses FIPS 2-letter `sourcecountry` codes (mapped in `gdelt.ts`); confirm that mapping on first clean run. |
| ReliefWeb | `api.reliefweb.int/v2/disasters` | registered `appname` | **Returns 403 for an unregistered appname.** Not merely rate-limited. Must be registered before this workflow can run. |
| UNHCR | `api.unhcr.org/population/v1/population/` | none | Works. Shape: `items[]` with `coa_iso`, `year`, and per-category counts, some as strings. |
| OCHA FTS | `api.hpc.tools/v2/public/plan` | none | Works, but carries **no funding figure** — `revisedRequirements` is top-level, and funding requires a second call to `/v1/public/fts/flow?planId=…&groupby=plan`. |

## API contract

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness + a real Postgres round-trip |
| `GET` | `/crises?limit=` | Ranked list for the latest scored day, with `rankDelta` |
| `GET` | `/crises/:id` | Detail by UUID or ISO3: score history, latest observations, briefs |
| `POST` | `/ingest/run` | Server-side fetch+parse+persist; shared-secret; `{source?}` |
| `POST` | `/webhook/n8n-score-update` | Ingest pre-parsed observations; shared-secret, idempotent |
| `POST` | `/briefs/generate` | Generate and store one grounded brief; admin-secret |
| `POST` | `/briefs/:id/deliver` | Deliver a stored brief through Telegram/email; admin-secret |
| `POST` | `/briefs/run` | Generate short summaries for the Top 5 and deliver one combined daily digest; admin-secret |

Ingestion can also be run from a terminal without n8n:
`pnpm --filter @lumen/api ingest [source]`.

`GET /crises` serves the most recent *scored* day rather than today, so a run
that hasn't fired yet shows yesterday's ranking instead of an empty list.
Cold start returns `{ data: [], scoredFor: null, count: 0 }` — an empty state,
not an error.

## Grounded brief generation

Codex is a development tool, not a runtime embedded in the deployed
application. Runtime prose therefore uses Groq when `GROQ_API_KEY` is
configured, with no Groq SDK dependency: the API calls the OpenAI-compatible
HTTP endpoint directly.

Numeric grounding is enforced structurally. The API renders the fact paragraph
itself from the exact `crisis_scores` row and latest `source_observations`.
Groq receives only qualitative facts and may write one number-free narrative
paragraph. Any digit in model output fails validation and activates the
deterministic audience-specific fallback. Thus a provider outage, missing key,
rate limit, or hallucinated quantity cannot remove or corrupt a brief.

The scheduled `/briefs/run` route defaults to the five highest attention-gap
scores. It stores one grounded brief per crisis, extracts each concise
narrative, and sends a single digest per configured channel. Each digest entry
contains the key scores and a `DASHBOARD_BASE_URL/crises/:iso3` link; the
dashboard remains the canonical location for full source evidence and history.

## Telegram interaction

Telegram has two paths. Scheduled outreach sends one Top 5 digest through
`sendMessage`; manual dashboard actions can still send an individual stored brief.
The API process also runs one long-polling command listener for `/start`,
`/help`, and `/status`. It responds only to the configured
`TELEGRAM_CHAT_ID`; other chats are ignored. Status text is queried from the
latest stored ranking rather than generated by the model.

## Ownership

| Area | Owner |
|---|---|
| `n8n/workflows`, `infra`, `apps/api`, `packages/scoring` | Preethesh |
| `apps/web`, brief generation, delivery, CI/CD, docs | Deepthi |
| `packages/shared-types` | Shared — agree before changing |
