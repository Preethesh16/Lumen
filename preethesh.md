# Preethesh — Work Log

Owner of: n8n workflows, Postgres schema + migrations, scoring algorithm,
`apps/api`, Docker Compose infra.

---

*No entries yet — this file is created by the scaffold and is appended to by
Preethesh's own sessions.*

### Open item raised by Deepthi — 2026-07-20

`packages/shared-types` was authored by Deepthi in Session 1 because the
repo was empty and the frontend had nothing to build against. It is a
**proposal, not an agreement**. Please review `Crisis`, `ScoreHistory`,
`Brief`, and `BriefInput` and either sign off or send back changes before
Phase 2 starts. Specific things to check against your Postgres schema:

- Is `attention_gap_score` really a signed value (need − coverage), so it can
  be negative for over-covered crises? The types assume yes.
- `funding_gap_pct` is optional — OCHA FTS will not have an appeal for every
  crisis. Confirm that matches what you will actually persist.
- Are score values normalized 0–1 at the API boundary, or raw? The types
  assume normalized 0–1 for `need_score` and `coverage_score`.
