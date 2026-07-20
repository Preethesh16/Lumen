# Lumen — Architecture

## Problem

Humanitarian attention is allocated by media coverage, and media coverage is
not proportional to need. Some of the largest crises in the world are close to
invisible. Lumen measures that gap directly: it cross-references crisis
severity against media coverage volume, ranks crises by how under-reported they
are, and generates briefs for journalists, donors, and NGOs.

## Data flow

```
                    ┌──────────── n8n (daily, staggered 02:00–02:45 UTC) ────────────┐
                    │                                                                │
  GDELT DOC 2.0 ────┤ 01  coverage_volume_pct                                        │
  ReliefWeb     ────┤ 02  active_disaster_count                                      │
  UNHCR         ────┤ 03  displaced_persons                                          │
  OCHA FTS      ────┤ 04  appeal_requirements_usd, appeal_funded_pct  + triggerScoring│
                    │                                                                │
                    └────────────────────────────┬───────────────────────────────────┘
                                                 │ POST /webhook/n8n-score-update
                                                 │ (x-lumen-webhook-secret)
                                                 ▼
                                    ┌────────────────────────┐
                                    │   apps/api (Express)   │
                                    │                        │
                                    │  upsert observations   │
                                    │  → packages/scoring    │──── pure, unit-tested
                                    │  → persist scores      │
                                    └───────────┬────────────┘
                                                │
                                    ┌───────────▼────────────┐
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
                                    │  + Claude brief agent  │
                                    │  + Telegram / email    │
                                    └────────────────────────┘
```

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
5. **attention_gap_score** = `(need − coverage) × (1 + 0.5 × funding_gap)`.
   Underfunding *amplifies* rather than *adds*, because it is evidence about an
   existing gap rather than an independent reason to care. Adding it would let
   a well-covered crisis with a shaky appeal outrank an invisible one.

### Known limitations

These are recorded deliberately, not overlooked.

- **Normalization is cohort-relative.** Scores are comparable within a run but
  drift across runs as the cohort changes. `inputs` stores the raw values so
  scores can be recomputed on a fixed scale later without re-fetching.
- **Min-max floors the cohort minimum at exactly 0.** The lowest-ranked country
  on a metric scores 0 on it. Combined with multiplicative funding
  amplification (`0 × anything = 0`), a country that is genuinely low-signal
  but severely underfunded can score identically to one with no data at all.
  Observed live with Chad: 1.9M displaced and 89% unfunded scored 0.000, tied
  with countries having no observations. See "Open decisions" in `progress.md`.
- **Multi-country FTS plans attribute the full requirement to each member
  country.** Splitting evenly would understate need in the country actually
  hosting the response, and the API offers no basis for weighting.

## Upstream API notes (verified live 2026-07-20)

| Source | Endpoint | Auth | Verified behaviour |
|---|---|---|---|
| GDELT DOC 2.0 | `api.gdeltproject.org/api/v2/doc/doc` | none | Hard limit of **1 request / 5s**. Returns a plain-text warning, not JSON, when exceeded. Workflow paces at 1 per 6s. |
| ReliefWeb | `api.reliefweb.int/v2/disasters` | registered `appname` | **Returns 403 for an unregistered appname.** Not merely rate-limited. Must be registered before this workflow can run. |
| UNHCR | `api.unhcr.org/population/v1/population/` | none | Works. Shape: `items[]` with `coa_iso`, `year`, and per-category counts, some as strings. |
| OCHA FTS | `api.hpc.tools/v2/public/plan` | none | Works, but carries **no funding figure** — `revisedRequirements` is top-level, and funding requires a second call to `/v1/public/fts/flow?planId=…&groupby=plan`. |

## API contract

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness + a real Postgres round-trip |
| `GET` | `/crises?limit=` | Ranked list for the latest scored day, with `rankDelta` |
| `GET` | `/crises/:id` | Detail by UUID or ISO3: score history, latest observations, briefs |
| `POST` | `/webhook/n8n-score-update` | Ingestion from n8n; shared-secret auth, idempotent upserts |

`GET /crises` serves the most recent *scored* day rather than today, so a run
that hasn't fired yet shows yesterday's ranking instead of an empty list.
Cold start returns `{ data: [], scoredFor: null, count: 0 }` — an empty state,
not an error.

## Ownership

| Area | Owner |
|---|---|
| `n8n/workflows`, `infra`, `apps/api`, `packages/scoring` | Preethesh |
| `apps/web`, brief generation, delivery, CI/CD, docs | Deepthi |
| `packages/shared-types` | Shared — agree before changing |
