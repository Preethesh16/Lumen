import type { ObservationInput } from '@lumen/shared-types';
import { fetchJson } from '../http.js';
import type { ParseResult, SourceAdapter } from './types.js';

interface FtsLocation {
  iso3?: string;
  adminLevel?: number;
  isRegion?: boolean;
}
interface FtsPlan {
  id: number;
  revisedRequirements?: number;
  origRequirements?: number;
  locations?: FtsLocation[];
}
interface FtsPlansResponse {
  data?: FtsPlan[];
}
interface FtsFlowResponse {
  data?: { report1?: { fundingTotals?: { total?: number } } };
}

export interface PlanRequirement {
  planId: number;
  requirements: number;
  iso3s: string[];
}

/**
 * Extract each plan's requirement and the countries it covers.
 *
 * Verified against the live API: `revisedRequirements` is top-level (not nested
 * under a `requirements` object), and this endpoint carries no funding figure —
 * funding needs a second call per plan. Country rows are `adminLevel` 0 and not
 * regions, so regional plans do not double-count their member states.
 *
 * Pure: no I/O.
 */
export function parseFtsPlans(body: FtsPlansResponse): PlanRequirement[] {
  const plans = body.data;
  if (!Array.isArray(plans)) {
    throw new Error('OCHA HPC returned an unexpected shape — no data array present.');
  }

  const out: PlanRequirement[] = [];
  for (const plan of plans) {
    const requirements = Number(plan.revisedRequirements ?? plan.origRequirements);
    if (!Number.isFinite(requirements) || requirements <= 0) continue;

    const iso3s = (plan.locations ?? [])
      .filter((l) => Number(l.adminLevel) === 0 && l.isRegion === false)
      .map((l) => String(l.iso3 ?? '').toUpperCase())
      .filter((c) => c.length === 3);

    if (iso3s.length > 0) out.push({ planId: plan.id, requirements, iso3s });
  }
  return out;
}

/** Verified shape: data.report1.fundingTotals.total. Null when absent. */
export function parseFtsFlow(body: FtsFlowResponse): number | null {
  const total = Number(body.data?.report1?.fundingTotals?.total);
  return Number.isFinite(total) ? total : null;
}

/**
 * Combine plan requirements and per-plan funding into per-country observations.
 *
 * A multi-country plan's requirement is attributed in full to each country it
 * covers: splitting it evenly would understate need in the country actually
 * hosting the response, and the API offers no basis to weight it. Funding is
 * only emitted when it was actually retrieved — emitting 0 for a failed lookup
 * would read as "completely unfunded" and wrongly amplify that country's gap.
 *
 * Pure: no I/O. `funding` maps planId -> total, null where the lookup failed.
 */
export function buildFtsObservations(
  plans: PlanRequirement[],
  funding: Map<number, number | null>,
  observedAt: string,
): ParseResult {
  const byCountry = new Map<string, { requirements: number; funding: number; funded: boolean }>();
  const failedPlans: number[] = [];

  for (const plan of plans) {
    const f = funding.get(plan.planId) ?? null;
    if (f === null) failedPlans.push(plan.planId);
    for (const iso3 of plan.iso3s) {
      const acc = byCountry.get(iso3) ?? { requirements: 0, funding: 0, funded: false };
      acc.requirements += plan.requirements;
      if (f !== null) {
        acc.funding += f;
        acc.funded = true;
      }
      byCountry.set(iso3, acc);
    }
  }

  const observations: ObservationInput[] = [];
  for (const [iso3, acc] of byCountry) {
    observations.push({
      iso3,
      source: 'fts',
      metric: 'appeal_requirements_usd',
      value: acc.requirements,
      observedAt,
    });
    if (acc.funded && acc.requirements > 0) {
      observations.push({
        iso3,
        source: 'fts',
        metric: 'appeal_funded_pct',
        // Clamped: appeals can be funded above 100%, which fails 0..1 validation.
        value: Math.min(1, Math.max(0, acc.funding / acc.requirements)),
        observedAt,
      });
    }
  }

  const warnings: string[] = [];
  if (failedPlans.length > 0) {
    warnings.push(`FTS: no funding figure for plans ${failedPlans.join(', ')}`);
  }
  if (observations.length === 0) warnings.push('OCHA FTS produced no country-level rows.');

  return { observations, warnings };
}

export const ftsAdapter: SourceAdapter = {
  name: 'fts',
  async fetch({ observedAt }): Promise<ParseResult> {
    const year = new Date().getUTCFullYear();
    const plansBody = await fetchJson<FtsPlansResponse>(
      `https://api.hpc.tools/v2/public/plan?year=${year}`,
      { timeoutMs: 45_000, backoffMs: 15_000 },
    );
    const plans = parseFtsPlans(plansBody);

    // One funding call per plan (~46/year), paced modestly. A single failure
    // degrades that country's funding signal rather than aborting the run.
    const funding = new Map<number, number | null>();
    for (const plan of plans) {
      try {
        const flow = await fetchJson<FtsFlowResponse>(
          `https://api.hpc.tools/v1/public/fts/flow?planId=${plan.planId}&groupby=plan`,
          { timeoutMs: 45_000, backoffMs: 10_000, maxRetries: 2 },
        );
        funding.set(plan.planId, parseFtsFlow(flow));
      } catch {
        funding.set(plan.planId, null);
      }
    }

    return buildFtsObservations(plans, funding, observedAt);
  },
};
