import type { Crisis, CrisisDetail } from '@lumen/shared-types';
import { mockCrises, mockDetail } from './mock-data';

/**
 * Client for Preethesh's API (`apps/api`).
 *
 * That API does not exist yet, so when `LUMEN_API_URL` is unset the client
 * serves mock data and says so. This lets the dashboard be built and reviewed
 * against the agreed `shared-types` contract without blocking on the backend —
 * and the moment the real API appears, setting one env var switches over with
 * no code change.
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
  /** True when this came from mock data rather than the live API. */
  isMock: boolean;
}

function baseUrl(): string | undefined {
  return process.env.LUMEN_API_URL;
}

export function isUsingMockData(): boolean {
  return !baseUrl();
}

async function request<T>(path: string): Promise<T> {
  const url = `${baseUrl()}${path}`;

  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // Scores update once daily; a short revalidate keeps the dashboard
      // fresh without hammering the API on every page view.
      next: { revalidate: 300 },
    });
  } catch (error) {
    throw new ApiUnavailableError(error);
  }

  if (!response.ok) {
    throw new ApiUnavailableError(new Error(`API returned ${response.status} for ${path}`));
  }

  try {
    return (await response.json()) as T;
  } catch (error) {
    throw new ApiUnavailableError(error);
  }
}

/** Ranked crisis list, highest attention gap first. */
export async function getCrises(): Promise<ApiResponse<Crisis[]>> {
  if (!baseUrl()) return { data: mockCrises, isMock: true };

  const crises = await request<Crisis[]>('/crises');
  // Sort defensively rather than trusting the API's ordering — the ranking is
  // the entire point of the product, and a silently mis-sorted list looks
  // completely normal.
  return {
    data: [...crises].sort((a, b) => b.attentionGapScore - a.attentionGapScore),
    isMock: false,
  };
}

export async function getCrisis(id: string): Promise<ApiResponse<CrisisDetail> | null> {
  if (!baseUrl()) {
    const detail = mockDetail(id);
    return detail ? { data: detail, isMock: true } : null;
  }

  try {
    return { data: await request<CrisisDetail>(`/crises/${encodeURIComponent(id)}`), isMock: false };
  } catch (error) {
    if (error instanceof ApiUnavailableError) throw error;
    return null;
  }
}
