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

---

# Frontend, content generation, and delivery

*Added by Deepthi. Decisions on the `apps/web` side of the split.*

## The dashboard degrades instead of failing

`apps/web` runs with no backend at all. With `LUMEN_API_URL` unset, the API
client returns placeholder data flagged as `isMock`, and the UI shows a banner
saying the figures are not real.

This started as a way to build the frontend before `apps/api` existed. It stays
now that the API works, because the failure it covers is permanent: ingestion
runs nightly, so there is always a window where the database is empty or the
API is mid-deploy, and a dashboard that renders a stack trace in that window
is not a production tool.

The rule that makes it safe: placeholder data must never be silently
indistinguishable from real data. Hence the banner, not a quiet fallback. If
that banner is ever removed, this fallback must be removed with it.

## Grounding is enforced in code, not requested in a prompt

The system prompt tells the model that the input payload is the entire universe
of available facts. `validateGrounding` then checks that every figure in the
generated body traces back to that payload, and `generateBrief` throws rather
than returning a brief that fails the check.

Trusting the prompt alone would be a reasonable design for most products. It is
not reasonable here, because the output is a factual claim about a humanitarian
emergency being handed to someone who will act on it. This pairs with the
`briefs.score_id` link in the schema: that proves which row a brief was
generated from, and the validator proves nothing outside that row got in.

The validator is deliberately conservative — it flags anything it cannot
positively trace. False positives cost a human glance at a withheld brief;
false negatives ship a fabricated number to a donor. The asymmetry justifies
the noise.

Known limits, worth revisiting:

- **It checks numbers, not claims.** "Fighting has spread to the eastern
  provinces" is unverifiable by this method and relies on the prompt alone.
- **The 5% rounding tolerance** means a figure within 5% of a real one passes.
  Tightening it would flag the legitimate rounding the prompt permits
  ("1,247,891" written as "1.2 million").
- **Normalized scores are excluded from the allowed set on purpose.** A 0..1
  score appearing as a figure in the body is itself a violation — the prompt
  forbids quoting a cohort-relative ranking as though it were a measurement,
  and treating it as "allowed" would let that reach a donor document.

## Prompts are files, not strings

`apps/web/src/lib/content-agent/prompts/` holds one markdown file per audience
plus a shared system prompt. A change to what the model is told is then a
reviewable diff rather than a string edit buried in application code. This is
what `Brief.promptVersion` should be pinned to.

## Delivery never throws

Telegram sends and digest emails return a `DeliveryResult` rather than
raising. One undeliverable brief must not abort a batch of otherwise-fine
ones. Telegram's `retry_after` is honoured on 429; 4xx below 500 is treated as
permanent (bad chat id, bot removed from the channel) and not retried, because
retrying a malformed request just burns the rate limit.

MarkdownV2 escaping and truncation are unit-tested. Telegram rejects a message
that ends mid-escape-sequence, so truncation cuts on a line boundary — a
detail that only shows up with a real long brief and a real bot.

## Open question: how briefs are persisted

`Brief.content` in `shared-types` is a single string. The generator produces
structured output — `headline`, `body`, and `statsUsed` (the figure citations
that power the provenance list under each brief).

Flattening to one string loses the citations, which are the visible evidence
that grounding happened. **This needs agreeing with Preethesh** — either
`briefs` gains columns for the headline and citation array, or the structure
is stored as jsonb. Recorded here so it is not silently resolved by whoever
touches it first, which is how the `shared-types` conflict happened.

## Testing strategy

Unit tests cover the pure logic that is easy to get subtly wrong and expensive
to get wrong in production: grounding validation, Telegram MarkdownV2 escaping
and truncation, digest rendering, and trend derivation.

External calls are not mocked into passing tests. The retry and backoff paths
are written but exercised by shape rather than by simulating every upstream
failure — integration against the live Claude API and a real Telegram bot will
surface the rest, and neither has happened yet.
