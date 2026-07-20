import type { Brief, Crisis } from '@lumen/shared-types';

/**
 * Pushes newly generated briefs to a Telegram channel.
 *
 * Telegram is the fastest delivery path to stand up — a bot from BotFather
 * needs no business verification — so it is the primary channel, with email
 * as the weekly digest.
 */

const TELEGRAM_API = 'https://api.telegram.org';
const MAX_MESSAGE_LENGTH = 4_096;
const MAX_ATTEMPTS = 3;

export interface DeliveryResult {
  delivered: boolean;
  /** Present when delivery failed, for logging upstream. */
  error?: string;
}

function config(): { token: string; chatId: string } {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    throw new Error(
      'TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set — see README.md for required env vars',
    );
  }
  return { token, chatId };
}

/** Telegram's MarkdownV2 requires these escaped anywhere they appear. */
function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (char) => `\\${char}`);
}

export function formatBrief(crisis: Crisis, brief: Brief): string {
  const gap = (crisis.attentionGapScore * 100).toFixed(0);

  const funding =
    crisis.fundingGapPct !== undefined
      ? `${crisis.fundingGapPct}% of the appeal unfunded`
      : 'no appeal funding data available';

  const message = [
    `*${escapeMarkdown(brief.headline)}*`,
    '',
    escapeMarkdown(`${crisis.name} — ${crisis.country}`),
    escapeMarkdown(`Attention gap: ${gap} · ${funding}`),
    '',
    escapeMarkdown(brief.body),
    '',
    escapeMarkdown(`Audience: ${brief.audience} · generated ${brief.generatedAt.slice(0, 10)}`),
  ].join('\n');

  if (message.length <= MAX_MESSAGE_LENGTH) return message;

  // Truncating mid-escape-sequence would produce a message Telegram rejects
  // outright, so cut on a line boundary and say the message was cut.
  const notice = escapeMarkdown('\n\n[…truncated — see dashboard for the full brief]');
  const budget = MAX_MESSAGE_LENGTH - notice.length;
  const cut = message.slice(0, budget);
  const lastBreak = cut.lastIndexOf('\n');

  return (lastBreak > 0 ? cut.slice(0, lastBreak) : cut) + notice;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sends one brief. Never throws — a delivery failure should be logged and
 * surfaced, not allowed to abort a batch of otherwise-deliverable briefs.
 */
export async function sendBrief(crisis: Crisis, brief: Brief): Promise<DeliveryResult> {
  let token: string;
  let chatId: string;
  try {
    ({ token, chatId } = config());
  } catch (error) {
    return { delivered: false, error: error instanceof Error ? error.message : String(error) };
  }

  const body = {
    chat_id: chatId,
    text: formatBrief(crisis, brief),
    parse_mode: 'MarkdownV2',
    disable_web_page_preview: true,
  };

  let lastError = 'unknown error';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });

      if (response.ok) return { delivered: true };

      const detail = await response.text().catch(() => '');
      lastError = `Telegram returned ${response.status}: ${detail.slice(0, 200)}`;

      // 429 carries retry_after; 4xx otherwise means the request itself is
      // wrong (bad chat id, bot removed from channel) and will never succeed.
      if (response.status === 429) {
        const retryAfter = Number(JSON.parse(detail || '{}')?.parameters?.retry_after) || attempt;
        await sleep(retryAfter * 1_000);
        continue;
      }
      if (response.status < 500) return { delivered: false, error: lastError };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    if (attempt < MAX_ATTEMPTS) await sleep(1_000 * 2 ** (attempt - 1));
  }

  return { delivered: false, error: lastError };
}
