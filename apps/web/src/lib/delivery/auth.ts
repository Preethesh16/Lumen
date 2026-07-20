import { timingSafeEqual } from 'node:crypto';

/**
 * Shared-secret auth for the delivery routes.
 *
 * Deliberately the same header and env var Preethesh's
 * `POST /webhook/n8n-score-update` uses, so n8n has one credential to hold and
 * one convention to follow rather than two.
 */

const HEADER = 'x-lumen-webhook-secret';

export type AuthResult = { ok: true } | { ok: false; status: number; message: string };

export function authorize(request: Request): AuthResult {
  const expected = process.env.N8N_WEBHOOK_SECRET;

  // Fail closed. An unset secret must not mean "open to anyone" — these routes
  // spend Claude API credits and push to a public channel.
  if (!expected) {
    return {
      ok: false,
      status: 503,
      message: 'N8N_WEBHOOK_SECRET is not configured, so delivery routes are disabled',
    };
  }

  const provided = request.headers.get(HEADER);
  if (!provided) {
    return { ok: false, status: 401, message: `Missing ${HEADER} header` };
  }

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);

  // Length must match before timingSafeEqual, which throws on mismatch — and
  // comparing lengths first leaks only the length, not the secret.
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, status: 401, message: 'Invalid webhook secret' };
  }

  return { ok: true };
}
