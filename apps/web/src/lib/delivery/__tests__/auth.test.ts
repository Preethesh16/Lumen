import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { authorize } from '../auth';

const SECRET = 'ci_webhook_secret_at_least_16';

function requestWith(header?: string): Request {
  return new Request('https://lumen.example/api/deliver/briefs', {
    method: 'POST',
    headers: header === undefined ? {} : { 'x-lumen-webhook-secret': header },
  });
}

describe('authorize', () => {
  const original = process.env.N8N_WEBHOOK_SECRET;

  beforeEach(() => {
    process.env.N8N_WEBHOOK_SECRET = SECRET;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.N8N_WEBHOOK_SECRET;
    else process.env.N8N_WEBHOOK_SECRET = original;
  });

  it('accepts the correct secret', () => {
    expect(authorize(requestWith(SECRET))).toEqual({ ok: true });
  });

  it('rejects a wrong secret of the same length', () => {
    const wrong = 'x'.repeat(SECRET.length);
    const result = authorize(requestWith(wrong));

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ status: 401 });
  });

  it('rejects a wrong secret of a different length without throwing', () => {
    // timingSafeEqual throws on length mismatch; the length check must come
    // first or every short guess becomes a 500 instead of a 401.
    expect(() => authorize(requestWith('short'))).not.toThrow();
    expect(authorize(requestWith('short'))).toMatchObject({ ok: false, status: 401 });
  });

  it('rejects a request with no header at all', () => {
    expect(authorize(requestWith())).toMatchObject({ ok: false, status: 401 });
  });

  it('fails closed when no secret is configured', () => {
    // An unset secret must never mean "open". These routes spend API credits
    // and publish to a channel.
    delete process.env.N8N_WEBHOOK_SECRET;
    const result = authorize(requestWith(SECRET));

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ status: 503 });
  });
});
