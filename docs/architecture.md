# Architecture

Decisions and their reasons. Written so neither of us re-litigates a settled
choice without new information.

## Hosting: Vercel for web, Railway for everything else

`apps/web` goes to Vercel — it is a Next.js app, the integration is native, and
preview deploys per branch are useful for a two-person team reviewing each
other's work.

`apps/api`, n8n, and Postgres go to **Railway** rather than Fly.io. The
deciding factor is that n8n needs a persistent volume and a managed Postgres
alongside it; Railway gives both in one project with no Dockerfile authoring,
while Fly would mean managing volumes and a separate Postgres app. Fly is the
better choice if we later need multi-region or finer control over machine
sizing — neither applies here.

## The dashboard degrades instead of failing

`apps/web` runs with no backend at all. With `LUMEN_API_URL` unset the API
client returns placeholder data flagged as `isMock`, and the UI shows a banner
saying the figures are not real.

This exists because the frontend was built before `apps/api` did. But it stays
after the API is live, because the failure it covers is permanent: n8n runs on
a daily schedule, so there is always a window where the database is empty or
the API is mid-deploy, and a dashboard that renders a stack trace in that
window is not a production tool.

The one rule: placeholder data must never be silently indistinguishable from
real data. Hence the banner, not a quiet fallback.

## Grounding is enforced in code, not requested in a prompt

The system prompt tells the model that the input payload is the entire universe
of available facts. `validateGrounding` then checks that every figure in the
generated body traces back to that payload, and `generateBrief` throws rather
than returning a brief that fails the check.

The prompt alone would be a reasonable design for most products. It is not
reasonable here, because the output is a factual claim about a humanitarian
emergency being handed to a journalist or a programme officer. An invented
casualty count that reads plausibly is worse than no brief, and prompts are
requests rather than guarantees.

The validator is deliberately conservative — it flags anything it cannot
positively trace. False positives cost a human glance at a withheld brief;
false negatives ship a fabricated number to someone who will act on it. The
asymmetry justifies the noise.

Known limits, worth revisiting:
- It checks numbers, not claims. "Fighting has spread to the eastern provinces"
  is unverifiable by this method and relies on the prompt.
- The 5% rounding tolerance means a figure within 5% of a real one passes.
  Tightening it would flag legitimate rounding the prompt permits.

## Scoring lives in the API, not in n8n

The attention gap calculation is a plain TypeScript function in `apps/api`,
called by n8n over HTTP. Business logic buried in an n8n node cannot be unit
tested, code reviewed, or diffed — and the score is the product's central
claim, so it is the last thing that should live somewhere untestable.

## `packages/shared-types` is the contract

Both sides build against it and neither invents a parallel shape. Two
decisions encoded there worth naming:

- **`attentionGapScore` is signed.** A well-covered crisis produces a negative
  score. Clamping at zero would lose the distinction between "adequately
  covered" and "over-covered".
- **`fundingGapPct` is optional, and absence is not zero.** OCHA has no appeal
  on record for every crisis. Rendering a missing appeal as "0% funded" would
  report a data gap as a total funding failure, in a document aimed at donors.
  Every consumer — table, email, Telegram, prompts — handles this explicitly.

## Testing strategy

Unit tests cover the pure logic that is easy to get subtly wrong and expensive
to get wrong in production: grounding validation, Telegram MarkdownV2 escaping
and truncation, digest rendering, and trend derivation.

External calls are not mocked into passing tests. The retry and backoff paths
are exercised by shape rather than by simulating every upstream failure — the
value is in the code being written to handle them at all, and integration
against live GDELT and ReliefWeb during development will surface the rest.

Upstream responses are cached locally during development so test runs do not
burn GDELT and ReliefWeb quota. Both throttle under repeated testing.
