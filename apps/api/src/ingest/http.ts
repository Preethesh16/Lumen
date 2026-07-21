/**
 * HTTP client for upstream ingestion.
 *
 * Every source in this system throttles, times out, or returns partial data as
 * normal behaviour rather than as an exception, so retry/backoff and timeout
 * handling live here rather than being re-implemented per source.
 */

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly bodyPreview: string,
  ) {
    super(`HTTP ${status} from ${url}: ${bodyPreview.slice(0, 200)}`);
    this.name = 'HttpError';
  }
}

export interface FetchOptions {
  timeoutMs?: number;
  maxRetries?: number;
  /** Base backoff; doubles each retry. GDELT needs a large value. */
  backoffMs?: number;
  headers?: Record<string, string>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch and parse JSON, retrying on timeout, 429, and 5xx with exponential
 * backoff. A 4xx other than 429 fails immediately — retrying a bad request or
 * an auth failure only wastes quota.
 *
 * GDELT is a special case: it returns HTTP 200 with a plain-text throttle
 * warning instead of JSON, so a 200 whose body will not parse is treated as a
 * retryable throttle rather than a hard failure.
 */
export async function fetchJson<T>(url: string, options: FetchOptions = {}): Promise<T> {
  const { timeoutMs = 30_000, maxRetries = 3, backoffMs = 1_000, headers = {} } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) await sleep(backoffMs * 2 ** (attempt - 1));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        headers: { accept: 'application/json', ...headers },
        signal: controller.signal,
      });

      const text = await res.text();

      if (!res.ok) {
        // 429 and 5xx are transient; retry. Everything else is caller error.
        if (res.status === 429 || res.status >= 500) {
          lastError = new HttpError(res.status, url, text);
          continue;
        }
        throw new HttpError(res.status, url, text);
      }

      try {
        return JSON.parse(text) as T;
      } catch {
        // A 200 that is not JSON is almost always a soft throttle (GDELT does
        // exactly this). Retry rather than crash.
        lastError = new HttpError(200, url, `non-JSON body: ${text.slice(0, 120)}`);
        continue;
      }
    } catch (error) {
      // AbortError (timeout) and network errors are retryable. A thrown
      // HttpError for a non-retryable status is rethrown immediately.
      if (error instanceof HttpError && error.status !== 429 && error.status < 500) {
        throw error;
      }
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`fetchJson failed for ${url}: ${String(lastError)}`);
}
