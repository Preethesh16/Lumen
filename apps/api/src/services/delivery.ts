import type { Brief, DeliveryChannel, DeliveryResult } from '@lumen/shared-types';
import { env } from '../env.js';

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
