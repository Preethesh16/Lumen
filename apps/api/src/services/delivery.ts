import type { Brief, DeliveryChannel, DeliveryResult } from '@lumen/shared-types';
import { env } from '../env.js';

export interface DailyDigestItem {
  rank: number;
  name: string;
  iso3: string;
  needScore: number;
  coverageScore: number;
  attentionGapScore: number;
  fundingGapPct: number | null;
  summary: string;
  usedFallback: boolean;
}

export interface DailyDigest {
  scoredFor: string;
  audience: Brief['audience'];
  items: DailyDigestItem[];
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function cleanSummary(summary: string): string {
  const compact = summary.replace(/\s+/g, ' ').trim();
  if (compact.length <= 260) return compact;
  return `${compact.slice(0, 257).replace(/\s+\S*$/, '')}…`;
}

function detailUrl(iso3: string): string {
  const base = env.DASHBOARD_BASE_URL.replace(/\/+$/, '');
  return `${base}/crises/${encodeURIComponent(iso3)}`;
}

export function buildDailyDigestText(digest: DailyDigest): string {
  const heading =
    `Lumen daily humanitarian watch — ${digest.scoredFor}\n` +
    `Top ${digest.items.length} under-reported crises\n`;
  const entries = digest.items.map((item) => {
    const funding =
      item.fundingGapPct === null ? 'Funding gap unavailable' : `Funding gap ${percent(item.fundingGapPct)}`;
    const summaryLabel = item.usedFallback ? 'Grounded summary' : 'AI summary';
    return (
      `${item.rank}. ${item.name} (${item.iso3})\n` +
      `Need ${percent(item.needScore)} · Coverage ${percent(item.coverageScore)} · ` +
      `Attention gap ${item.attentionGapScore.toFixed(3)} · ${funding}\n` +
      `${summaryLabel}: ${cleanSummary(item.summary)}\n` +
      `Full details: ${detailUrl(item.iso3)}`
    );
  });
  return `${heading}\n${entries.join('\n\n')}\n\nFull dashboard: ${env.DASHBOARD_BASE_URL.replace(/\/+$/, '')}`;
}

async function deliverTelegram(brief: Brief): Promise<DeliveryResult> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    return {
      channel: 'telegram',
      status: 'skipped',
      message: 'Telegram is not configured',
    };
  }

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: env.TELEGRAM_CHAT_ID,
          text: `Lumen humanitarian brief\n\n${brief.content}`,
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        message?: string;
        error?: { message?: string };
      } | null;
      throw new Error(
        `HTTP ${response.status}: ${body?.message ?? body?.error?.message ?? 'Telegram rejected the request'}`,
      );
    }
    return { channel: 'telegram', status: 'sent', message: 'Sent to Telegram' };
  } catch (error) {
    return {
      channel: 'telegram',
      status: 'failed',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function deliverEmail(brief: Brief): Promise<DeliveryResult> {
  if (!env.RESEND_API_KEY || !env.DELIVERY_EMAIL_TO) {
    return { channel: 'email', status: 'skipped', message: 'Email is not configured' };
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: env.RESEND_FROM_EMAIL,
        to: [env.DELIVERY_EMAIL_TO],
        subject: `Lumen humanitarian brief — ${brief.audience}`,
        text: brief.content,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        message?: string;
        error?: { message?: string };
      } | null;
      throw new Error(
        `HTTP ${response.status}: ${body?.message ?? body?.error?.message ?? 'Resend rejected the request'}`,
      );
    }
    return { channel: 'email', status: 'sent', message: 'Sent by email' };
  } catch (error) {
    return {
      channel: 'email',
      status: 'failed',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function deliverBrief(
  brief: Brief,
  channels: DeliveryChannel[],
): Promise<DeliveryResult[]> {
  const unique = [...new Set(channels)];
  return Promise.all(
    unique.map((channel) =>
      channel === 'telegram' ? deliverTelegram(brief) : deliverEmail(brief),
    ),
  );
}

async function deliverTelegramDigest(digest: DailyDigest): Promise<DeliveryResult> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    return {
      channel: 'telegram',
      status: 'skipped',
      message: 'Telegram is not configured',
    };
  }

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: env.TELEGRAM_CHAT_ID,
          text: buildDailyDigestText(digest),
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        description?: string;
        message?: string;
      } | null;
      throw new Error(
        `HTTP ${response.status}: ${body?.description ?? body?.message ?? 'Telegram rejected the digest'}`,
      );
    }
    return { channel: 'telegram', status: 'sent', message: 'Daily digest sent to Telegram' };
  } catch (error) {
    return {
      channel: 'telegram',
      status: 'failed',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function deliverEmailDigest(digest: DailyDigest): Promise<DeliveryResult> {
  if (!env.RESEND_API_KEY || !env.DELIVERY_EMAIL_TO) {
    return { channel: 'email', status: 'skipped', message: 'Email is not configured' };
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: env.RESEND_FROM_EMAIL,
        to: [env.DELIVERY_EMAIL_TO],
        subject: `Lumen daily Top ${digest.items.length} — ${digest.scoredFor}`,
        text: buildDailyDigestText(digest),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        message?: string;
        error?: { message?: string };
      } | null;
      throw new Error(
        `HTTP ${response.status}: ${body?.message ?? body?.error?.message ?? 'Resend rejected the digest'}`,
      );
    }
    return { channel: 'email', status: 'sent', message: 'Daily digest sent by email' };
  } catch (error) {
    return {
      channel: 'email',
      status: 'failed',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function deliverDailyDigest(
  digest: DailyDigest,
  channels: DeliveryChannel[],
): Promise<DeliveryResult[]> {
  const unique = [...new Set(channels)];
  return Promise.all(
    unique.map((channel) =>
      channel === 'telegram' ? deliverTelegramDigest(digest) : deliverEmailDigest(digest),
    ),
  );
}
