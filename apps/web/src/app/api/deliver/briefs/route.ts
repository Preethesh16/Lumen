import { NextResponse } from 'next/server';
import type { BriefAudience } from '@lumen/shared-types';
import { getCrises, getCrisis, ApiUnavailableError } from '@/lib/api/client';
import { generateBrief } from '@/lib/content-agent/generate';
import { toBriefInput } from '@/lib/content-agent/types';
import { authorize } from '@/lib/delivery/auth';
import { sendBrief } from '@/lib/delivery/telegram';

/**
 * `POST /api/deliver/briefs` — generate briefs for the most under-reported
 * crises and push them to Telegram.
 *
 * Called by n8n after a scoring run completes. Kept as an explicit trigger
 * rather than a cron inside the app so the pipeline has one scheduler (n8n)
 * and delivery cannot fire on stale scores.
 *
 * Body: `{ "limit"?: number, "audience"?: "journalist" | "donor" | "ngo" }`
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const DEFAULT_LIMIT = 3;
const MAX_LIMIT = 10;

interface DeliveryReport {
  crisisId: string;
  name: string;
  generated: boolean;
  delivered: boolean;
  error?: string;
}

export async function POST(request: Request) {
  const auth = authorize(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: 'ANTHROPIC_API_KEY is not configured, so no brief can be generated' },
      { status: 503 },
    );
  }

  let body: { limit?: number; audience?: BriefAudience } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    // An empty body is a legitimate "use the defaults" call from an n8n node
    // with no payload configured.
  }

  const limit = Math.min(Math.max(1, body.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
  const audience: BriefAudience = body.audience ?? 'journalist';

  let crises;
  try {
    ({
      data: { crises },
    } = await getCrises());
  } catch (error) {
    if (error instanceof ApiUnavailableError) {
      return NextResponse.json({ error: 'The Lumen API is unavailable' }, { status: 502 });
    }
    throw error;
  }

  // Only crises that are actually under-reported. A negative gap means the
  // crisis is well covered, and pushing it to the channel would undercut the
  // one thing subscribers rely on this feed for.
  const candidates = crises
    .filter((crisis) => crisis.latestScore.attentionGapScore > 0)
    .slice(0, limit);

  if (candidates.length === 0) {
    return NextResponse.json({
      delivered: 0,
      results: [],
      note: 'No crisis currently has a positive attention gap, so nothing was sent.',
    });
  }

  const results: DeliveryReport[] = [];

  // Sequential on purpose: parallel sends hit Telegram's per-chat rate limit,
  // and each generation is a paid model call worth failing fast on.
  for (const crisis of candidates) {
    const report: DeliveryReport = {
      crisisId: crisis.id,
      name: crisis.name,
      generated: false,
      delivered: false,
    };

    try {
      const detail = await getCrisis(crisis.id);
      if (!detail) {
        report.error = 'Crisis detail not found';
        results.push(report);
        continue;
      }

      if (detail.data.latestObservations.length === 0) {
        report.error = 'No stored observations to ground a brief in';
        results.push(report);
        continue;
      }

      const brief = await generateBrief(toBriefInput(detail.data), audience);
      report.generated = true;

      const delivery = await sendBrief(crisis, brief);
      report.delivered = delivery.delivered;
      if (delivery.error) report.error = delivery.error;
    } catch (error) {
      // One crisis failing — including a grounding violation, which is a
      // deliberate refusal to publish — must not abort the rest of the batch.
      report.error = error instanceof Error ? error.message : String(error);
    }

    results.push(report);
  }

  const delivered = results.filter((result) => result.delivered).length;

  // 207 when the batch was partially successful, so a monitoring n8n node can
  // distinguish "all fine" from "some briefs never reached anyone".
  return NextResponse.json(
    { delivered, attempted: results.length, results },
    { status: delivered === results.length ? 200 : 207 },
  );
}
