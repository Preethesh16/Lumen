import { desc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { crises, crisisScores } from '../db/schema.js';
import { env } from '../env.js';

interface TelegramChat {
  id: number;
}

interface TelegramMessage {
  chat: TelegramChat;
  text?: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

export interface LatestCrisisSummary {
  name: string;
  iso3: string;
  scoredFor: string;
  needScore: number;
  coverageScore: number;
  attentionGapScore: number;
  fundingGapPct: number | null;
}

export function buildTelegramReply(
  input: string,
  latest: LatestCrisisSummary | null,
): string {
  const text = input.trim().toLowerCase();

  if (text === '/start' || text === 'start') {
    return (
      'Welcome to Lumen.\n\n' +
      'I monitor humanitarian crises where human need is receiving too little media attention.\n\n' +
      'Commands:\n' +
      '/status — latest highest-priority crisis\n' +
      '/help — available commands'
    );
  }

  if (text === '/help' || text === 'help') {
    return (
      'Lumen commands:\n\n' +
      '/status — show the latest highest-ranked under-reported crisis\n' +
      '/start — explain what Lumen does\n\n' +
      'You can also ask “what is the current update?”'
    );
  }

  const wantsStatus =
    text === '/status' ||
    text === 'status' ||
    text.includes('current update') ||
    text.includes('latest update') ||
    text.includes('top crisis');

  if (wantsStatus) {
    if (!latest) {
      return 'No crisis ranking is available yet. Run an ingestion cycle and try /status again.';
    }
    const funding =
      latest.fundingGapPct === null
        ? 'funding data unavailable'
        : `${(latest.fundingGapPct * 100).toFixed(1)}% funding gap`;
    return (
      `Current Lumen priority: ${latest.name} (${latest.iso3}).\n\n` +
      `Scored ${latest.scoredFor}\n` +
      `Need: ${(latest.needScore * 100).toFixed(1)}%\n` +
      `Coverage: ${(latest.coverageScore * 100).toFixed(1)}%\n` +
      `Attention gap: ${latest.attentionGapScore.toFixed(3)}\n` +
      `${funding}\n\n` +
      'A positive attention gap means humanitarian need is outpacing media coverage.'
    );
  }

  return 'I did not understand that yet. Send /status for the current update or /help for commands.';
}

async function latestCrisis(): Promise<LatestCrisisSummary | null> {
  const [latestDay] = await db
    .select({ scoredFor: crisisScores.scoredFor })
    .from(crisisScores)
    .orderBy(desc(crisisScores.scoredFor))
    .limit(1);
  if (!latestDay) return null;

  const [row] = await db
    .select({ crisis: crises, score: crisisScores })
    .from(crisisScores)
    .innerJoin(crises, eq(crises.id, crisisScores.crisisId))
    .where(eq(crisisScores.scoredFor, latestDay.scoredFor))
    .orderBy(desc(crisisScores.attentionGapScore))
    .limit(1);
  if (!row) return null;

  return {
    name: row.crisis.name,
    iso3: row.crisis.iso3,
    scoredFor: row.score.scoredFor,
    needScore: Number(row.score.needScore),
    coverageScore: Number(row.score.coverageScore),
    attentionGapScore: Number(row.score.attentionGapScore),
    fundingGapPct:
      row.score.fundingGapPct === null ? null : Number(row.score.fundingGapPct),
  };
}

async function telegramRequest<T>(
  method: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    },
  );
  const result = (await response.json()) as TelegramResponse<T>;
  if (!response.ok || !result.ok) {
    throw new Error(result.description ?? `Telegram ${method} failed with HTTP ${response.status}`);
  }
  return result.result as T;
}

export interface TelegramBotHandle {
  stop(): void;
}

/**
 * Start one Telegram long-polling worker.
 *
 * It only responds to TELEGRAM_CHAT_ID, so strangers cannot use the bot as a
 * public database query endpoint. Pending messages from before process startup
 * are discarded to prevent duplicate replies after a deployment/restart.
 */
export function startTelegramBot(): TelegramBotHandle {
  let stopped = false;
  let activeRequest: AbortController | null = null;

  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    return { stop: () => {} };
  }

  const allowedChatId = String(env.TELEGRAM_CHAT_ID);

  async function run(): Promise<void> {
    let offset = 0;
    try {
      const pending = await telegramRequest<TelegramUpdate[]>('getUpdates', {
        offset: -1,
        limit: 1,
        timeout: 0,
        allowed_updates: ['message'],
      });
      const latestUpdate = pending.at(-1);
      if (latestUpdate) offset = latestUpdate.update_id + 1;
      console.log('Telegram command listener ready');
    } catch (error) {
      console.error('Telegram command listener failed to initialize:', error);
    }

    while (!stopped) {
      activeRequest = new AbortController();
      const timer = setTimeout(() => activeRequest?.abort(), 30_000);
      try {
        const updates = await telegramRequest<TelegramUpdate[]>(
          'getUpdates',
          {
            offset,
            timeout: 20,
            allowed_updates: ['message'],
          },
          activeRequest.signal,
        );

        for (const update of updates) {
          offset = Math.max(offset, update.update_id + 1);
          const message = update.message;
          if (
            !message?.text ||
            String(message.chat.id) !== allowedChatId
          ) {
            continue;
          }
          const reply = buildTelegramReply(message.text, await latestCrisis());
          await telegramRequest('sendMessage', {
            chat_id: message.chat.id,
            text: reply,
            disable_web_page_preview: true,
          });
        }
      } catch (error) {
        if (stopped) break;
        if (error instanceof Error && error.name === 'AbortError') continue;
        console.error('Telegram polling error:', error);
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      } finally {
        clearTimeout(timer);
        activeRequest = null;
      }
    }
  }

  void run();

  return {
    stop() {
      stopped = true;
      activeRequest?.abort();
    },
  };
}
