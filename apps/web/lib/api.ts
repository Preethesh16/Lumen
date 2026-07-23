import type {
  ApiError,
  GetCrisisResponse,
  ListCrisesResponse,
} from '@lumen/shared-types';

const baseUrl = process.env.API_BASE_URL ?? 'http://localhost:4000';

export class LumenApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'LumenApiError';
  }
}

async function apiGet<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new LumenApiError(
      'The Lumen API is unavailable. Start the API and database, then try again.',
      503,
    );
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiError | null;
    throw new LumenApiError(
      body?.error.message ?? `The API returned HTTP ${response.status}.`,
      response.status,
    );
  }
  return (await response.json()) as T;
}

export function getCrises(): Promise<ListCrisesResponse> {
  return apiGet<ListCrisesResponse>('/crises');
}

export function getCrisis(id: string): Promise<GetCrisisResponse> {
  return apiGet<GetCrisisResponse>(`/crises/${encodeURIComponent(id)}`);
}
