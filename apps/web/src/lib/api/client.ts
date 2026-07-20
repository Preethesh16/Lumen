import type {
  CrisisDetail,
  GetCrisisResponse,
  ListCrisesResponse,
  RankedCrisis,
} from '@lumen/shared-types';
import { mockDetail, mockListResponse } from './mock-data';

/**
 * Client for the Lumen API (`apps/api`).
 *
 * When `LUMEN_API_URL` is unset the client serves placeholder data and flags
 * it as such. Ingestion runs nightly, so there is always a window where the
 * database is empty or the API is mid-deploy — the dashboard has to stay
 * usable then. The one rule: placeholder data is never silently
 * indistinguishable from real data, hence `isMock` and the banner it drives.
 */

const TIMEOUT_MS = 8_000;

export class ApiUnavailableError extends Error {
  constructor(readonly cause: unknown) {
    super('The Lumen API is unavailable');
    this.name = 'ApiUnavailableError';
  }
}

export interface ApiResponse<T> {
  data: T;
  /** True when this came from placeholder data rather than the live API. */
  isMock: boolean;
}

function baseUrl(): string | undefined {
  return process.env.LUMEN_API_URL;
}

async function request<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // Scores update once nightly; a short revalidate keeps the dashboard
      // fresh without hammering the API on every page view.
      next: { revalidate: 300 },
    });
  } catch (error) {
    throw new ApiUnavailableError(error);
  }

  if (response.status === 404) return null as T;

  if (!response.ok) {
    throw new ApiUnavailableError(new Error(`API returned ${response.status} for ${path}`));
  }

  try {
    return (await response.json()) as T;
  } catch (error) {
    throw new ApiUnavailableError(error);
  }
}

export interface CrisisList {
  crises: RankedCrisis[];
  /** The scoring run these rankings come from. Null when nothing is scored. */
  scoredFor: string | null;
}

/** `GET /crises` — ranked list, most under-reported first. */
export async function getCrises(): Promise<ApiResponse<CrisisList>> {
  if (!baseUrl()) {
    const mock = mockListResponse();
    return {
      data: { crises: mock.data, scoredFor: mock.scoredFor },
      isMock: true,
    };
  }

  const response = await request<ListCrisesResponse>('/crises');

  // Sort defensively rather than trusting the API's ordering. The ranking is
  // the product's central claim, and a silently mis-sorted list looks
  // completely normal.
  const crises = [...response.data].sort(
    (a, b) => b.latestScore.attentionGapScore - a.latestScore.attentionGapScore,
  );

  return { data: { crises, scoredFor: response.scoredFor }, isMock: false };
}

/** `GET /crises/:id` — detail, history, observations, and stored briefs. */
export async function getCrisis(id: string): Promise<ApiResponse<CrisisDetail> | null> {
  if (!baseUrl()) {
    const detail = mockDetail(id);
    return detail ? { data: detail, isMock: true } : null;
  }

  const response = await request<GetCrisisResponse | null>(`/crises/${encodeURIComponent(id)}`);
  if (!response) return null;

  return { data: response.data, isMock: false };
}
