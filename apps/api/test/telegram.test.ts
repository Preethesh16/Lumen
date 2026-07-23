import { describe, expect, it } from 'vitest';
import {
  buildTelegramReply,
  type LatestCrisisSummary,
} from '../src/services/telegramBot.js';

const latest: LatestCrisisSummary = {
  name: 'Sudan',
  iso3: 'SDN',
  scoredFor: '2026-07-23',
  needScore: 0.91,
  coverageScore: 0.18,
  attentionGapScore: 0.83,
  fundingGapPct: 0.72,
};

describe('Telegram command replies', () => {
  it('introduces the bot on /start', () => {
    const reply = buildTelegramReply('/start', latest);
    expect(reply).toContain('Welcome to Lumen');
    expect(reply).toContain('/status');
  });

  it('answers natural-language status questions from stored ranking data', () => {
    const reply = buildTelegramReply('What is the current update?', latest);
    expect(reply).toContain('Sudan (SDN)');
    expect(reply).toContain('Need: 91.0%');
    expect(reply).toContain('Attention gap: 0.830');
    expect(reply).toContain('72.0% funding gap');
  });

  it('handles a database with no ranking', () => {
    expect(buildTelegramReply('/status', null)).toContain('No crisis ranking');
  });

  it('guides unknown messages toward supported commands', () => {
    expect(buildTelegramReply('tell me a joke', latest)).toContain('/help');
  });
});
