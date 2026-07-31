# Lumen

## Humanitarian Attention-Gap Intelligence

**Concept Note · IBM SkillsBuild Project**  
**Authors:** Preethesh and Deepthi  
**Date:** July 2026  
**Live prototype:** https://lumen.64-227-166-157.sslip.io

## 1. Executive Summary

Lumen is a humanitarian intelligence platform that identifies crises where human need is high but public and media attention is disproportionately low. It combines displacement, humanitarian appeal, funding, disaster and media-coverage signals; produces a transparent Attention-Gap Score; and converts the resulting evidence into grounded briefs for journalists, NGOs and donors.

The project responds to a practical information problem: crisis data exists, but it is fragmented across specialist systems, difficult to compare and slow to translate into communication or funding action. Lumen creates one repeatable flow from evidence to ranking to outreach. A public dashboard explains the scores and source readings, while Telegram and email deliver ready-to-share briefs.

The production prototype is deployed and operational. It monitors an initial cohort of 26 crises, stores raw observations for traceability, supports daily automated ingestion through n8n, and continues operating when an optional source or AI provider is unavailable.

## 2. Problem and Rationale

Humanitarian attention does not always follow humanitarian need. Large displacement numbers, severe funding gaps and major appeals may coexist with relatively low media visibility. This creates three connected problems:

1. Journalists, humanitarian teams and researchers must manually reconcile fragmented, rate-limited datasets before they can compare crises.
2. Low-visibility emergencies can be discovered too late for timely reporting, advocacy and resource mobilization.
3. Generic alerts and ungrounded AI summaries may be fast, but they do not provide a transparent, reproducible basis for prioritization.

Existing platforms such as ReliefWeb and OCHA provide valuable source information. Lumen complements them by comparing need with attention across a common cohort, preserving the evidence behind every score and turning the result into an actionable communication product.

## 3. Goal, Objectives and Intended Users

### Goal

Improve the visibility of under-reported humanitarian crises by transforming trusted public data into explainable prioritization and timely outreach.

### Objectives

- Ingest and harmonize crisis-severity, displacement, funding and coverage signals from public humanitarian data sources.
- Calculate a transparent and versioned Attention-Gap Score that can be audited and recomputed.
- Present rankings, trends, evidence and briefs through a public dashboard.
- Generate audience-specific, evidence-grounded briefs without allowing an AI model to invent statistics.
- Deliver priority briefs through Telegram and email on an automated daily schedule.
- Build a historical evidence base for research, monitoring and future model improvement.

### Primary users

- Journalists, editors and newsroom researchers seeking overlooked stories.
- NGO and UN humanitarian, advocacy and communications analysts.
- Donor, policy and grantmaking teams prioritizing attention and resources.
- University journalism and humanitarian research groups.

Early adopters are expected to include small global-affairs newsrooms, independent journalists, university labs and crisis-monitoring teams that need a lightweight alternative to manual spreadsheet research.

## 4. Proposed Intervention

Lumen operates as a six-stage evidence-to-action pipeline:

1. **Collect:** A daily n8n workflow triggers ingestion from GDELT, ReliefWeb, UNHCR and OCHA Financial Tracking Service.
2. **Store:** The backend writes raw source observations to PostgreSQL before scoring, retaining the evidence needed for audit and recalculation.
3. **Score:** A tested scoring engine log-transforms and normalizes available signals across the active cohort.
4. **Rank:** The platform compares humanitarian need with media coverage and adjusts for underfunding to surface the largest attention gaps.
5. **Explain:** The dashboard displays the ranked list, crisis detail, score history, latest evidence and generated briefs.
6. **Act:** The highest-priority grounded brief is delivered through Telegram and email.

The current scoring model uses displacement, appeal requirements and active-disaster count to estimate need; GDELT volume to estimate coverage; and the humanitarian funding gap as an amplifying and independent signal. Missing components are dropped and remaining weights are re-normalized, avoiding the harmful assumption that “no data” means “no need.”

Every score records its algorithm version and inputs. Every brief references the score from which it was produced. Numeric facts are rendered deterministically from stored data. Groq may add only a number-free narrative; any provider failure or validation failure activates a deterministic fallback. Rankings and outreach therefore do not depend on an LLM.

## 5. Innovation and Value Proposition

**Unique value proposition:** Lumen reveals where humanitarian need is high but attention is low—then turns the evidence into a ready-to-share brief.

Unlike a static dashboard, Lumen links prioritization directly to action. Its differentiators are:

- A transparent need-versus-attention framing rather than an opaque priority score.
- Raw, replayable source evidence and versioned scoring for auditability.
- Graceful degradation when a data source or AI provider is unavailable.
- One integrated workflow spanning ingestion, ranking, explanation and delivery.
- A growing historical dataset that becomes more useful for trends and research over time.

## 6. Implementation Status and Technical Approach

The prototype uses a TypeScript monorepo with an Express API, Next.js dashboard, PostgreSQL database, n8n scheduler and Docker-based deployment. CI verifies the project on every push, while production images are versioned and published from the main branch.

### Completed

- PostgreSQL schema, migrations and idempotent writes.
- Tested Attention-Gap scoring engine.
- Express API for health, rankings, crisis details, ingestion, briefs and delivery.
- Live UNHCR and OCHA FTS ingestion, with tested adapters for GDELT and ReliefWeb.
- Public dashboard with ranked list, details, trends, evidence and failure states.
- Grounded brief generation with optional Groq narrative and deterministic fallback.
- Telegram bot and Resend email delivery, both live-tested.
- Daily n8n workflow and public HTTPS production deployment.

### Current limitation

ReliefWeb requires a pre-approved application name. Until approval is received, that optional source is skipped and the remaining sources continue producing rankings. GDELT is protected by strict rate limits and is handled with pacing, retry and graceful degradation.

## 7. Expected Outputs, Outcomes and Measurement

### Outputs

- Daily refreshed multi-source crisis observations.
- Ranked crisis list and evidence-backed detail pages.
- Stored score history and versioned algorithm inputs.
- Grounded briefs delivered through web, Telegram and email.
- A reusable open-source technical foundation for humanitarian attention monitoring.

### Short-term outcomes

- Faster identification of crises that may merit additional reporting or advocacy.
- Lower research effort for journalists and humanitarian communication teams.
- More traceable briefs, with statistics linked to stored source readings.
- Greater visibility for crises with high need, low coverage or severe underfunding.

### Key indicators

- Source freshness and ingestion success rate.
- Number and proportion of monitored crises successfully scored.
- Brief generation and delivery success rate.
- Data-to-brief turnaround time.
- Active dashboard users, brief shares and downstream reporting or advocacy actions.
- Number of institutional pilots, alert subscriptions or data partnerships.

Lumen supports SDG 10 through attention to unequal visibility, SDG 16 through access to explainable public-interest information, and SDG 17 through cross-sector data and outreach partnerships.

## 8. Risks and Mitigation

| Risk | Mitigation |
|---|---|
| Upstream API failure or rate limiting | Timeouts, retry/backoff, paced requests and partial-source scoring |
| Missing or uneven country data | Drop missing components, re-normalize weights and visibly retain source evidence |
| Misleading AI-generated statistics | Deterministic numeric paragraph, score linkage, digit validation and non-AI fallback |
| Cohort-relative score drift | Store raw inputs and algorithm version so history can be recomputed on a fixed scale |
| Data-source interpretation errors | Source-specific tested parsers and documented known limitations |
| Exposure of delivery or database secrets | Environment-only secrets, git checks, HTTPS and restricted administrative routes |
| Operational cost after cloud credits expire | Small deployment, spending alerts, usage monitoring and ability to downsize |

## 9. Sustainability and Scale

The public dashboard can remain free to maximize humanitarian value, trust and discoverability. Sustainability options include team subscriptions for custom alerts, exports and historical analytics; institutional API access for newsrooms, NGOs and donors; sponsored regional monitoring; and research or philanthropic grants.

The current production server costs approximately USD 24 per month, with variable provider, domain and monitoring costs. The architecture can be downsized for a pilot or scaled through containerized services as usage grows. The main non-financial requirements are source monitoring, scoring review, security updates, user research and partnership development.

The historical observation model creates a compounding asset: new source readings improve trend analysis without discarding old evidence. Future work can add a fixed-reference scoring baseline, sub-national sources, more delivery channels, user-configurable watchlists and evaluation with newsroom and humanitarian partners.

## 10. Work Plan

| Phase | Main activities | Status |
|---|---|---|
| 1. Foundation | Repository, database, ingestion adapters and infrastructure | Completed |
| 2. Core intelligence | Scoring engine, API and grounded brief generation | Completed |
| 3. Delivery and experience | Dashboard, Telegram, email, CI/CD and deployment | Completed |
| 4. Validation and partnerships | ReliefWeb approval, user pilots, usage evaluation and demo documentation | Next |

## 11. Conclusion

Lumen demonstrates that humanitarian data can be converted into a transparent, resilient and actionable attention-gap monitor. It does not replace expert judgment or established humanitarian platforms. It provides a focused decision-support layer that helps people discover overlooked crises, inspect the evidence and communicate the finding quickly.

The deployed prototype proves the complete workflow from public data to scoring, dashboard and live notification delivery. The next priority is structured validation with journalists, humanitarian analysts and donor teams, followed by iterative calibration of the model and expansion of data partnerships.

