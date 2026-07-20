import { NextResponse } from 'next/server';
import { ApiUnavailableError, getCrises } from '@/lib/api/client';
import { authorize } from '@/lib/delivery/auth';
import { sendDigest } from '@/lib/delivery/digest';

/**
 * `POST /api/deliver/digest` — send the weekly digest email.
 *
 * Triggered by a weekly n8n schedule. Unlike the Telegram route this sends
 * even when every gap is negative: the digest is a standing weekly report, and
 * a week where nothing is badly under-reported is itself worth reporting.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DEFAULT_TOP_N = 10;

function recipients(): string[] {
  return (process.env.DIGEST_RECIPIENTS ?? '')
    .split(',')
    .map((address) => address.trim())
    .filter(Boolean);
}

export async function POST(request: Request) {
  const auth = authorize(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const to = recipients();
  if (to.length === 0) {
    return NextResponse.json(
      { error: 'DIGEST_RECIPIENTS is empty, so there is nobody to send the digest to' },
      { status: 503 },
    );
  }

  let crises;
  try {
    ({
      data: { crises },
    } = await getCrises());
  } catch (error) {
    if (error instanceof ApiUnavailableError) {
      // Do not send a digest built from an unknown state. An email claiming
      // "no crises this week" when the API was merely down is worse than a
      // missed send, because it reads as a finding rather than a failure.
      return NextResponse.json(
        { error: 'The Lumen API is unavailable; digest not sent' },
        { status: 502 },
      );
    }
    throw error;
  }

  const result = await sendDigest(crises.slice(0, DEFAULT_TOP_N), to);

  if (!result.delivered) {
    return NextResponse.json({ delivered: false, error: result.error }, { status: 502 });
  }

  return NextResponse.json({
    delivered: true,
    recipients: to.length,
    crises: Math.min(crises.length, DEFAULT_TOP_N),
  });
}
