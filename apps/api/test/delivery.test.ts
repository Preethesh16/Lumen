import { describe, expect, it } from 'vitest';
import {
  buildDailyDigestText,
  type DailyDigest,
} from '../src/services/delivery.js';

const digest: DailyDigest = {
  scoredFor: '2026-07-26',
  audience: 'journalist',
  items: Array.from({ length: 5 }, (_, index) => ({
    rank: index + 1,
    name: ['Sudan', 'Syrian Arab Republic', 'Yemen', 'Afghanistan', 'Chad'][index]!,
    iso3: ['SDN', 'SYR', 'YEM', 'AFG', 'TCD'][index]!,
    needScore: 0.9 - index * 0.02,
    coverageScore: 0.2 + index * 0.03,
    attentionGapScore: 0.8 - index * 0.05,
    fundingGapPct: index === 4 ? null : 0.7 - index * 0.04,
    summary:
      'Humanitarian need is outpacing media coverage, while the response remains underfunded and warrants verified reporting.',
    usedFallback: false,
  })),
};

describe('daily digest formatting', () => {
  it('renders one concise message with all five ranked crises and detail links', () => {
    const text = buildDailyDigestText(digest);

    expect(text).toContain('Top 5 under-reported crises');
    for (const item of digest.items) {
      expect(text).toContain(`${item.rank}. ${item.name} (${item.iso3})`);
      expect(text).toContain(`/crises/${item.iso3}`);
    }
    expect(text.match(/AI summary:/g)).toHaveLength(5);
    expect(text).toContain('Full dashboard:');
    expect(text.length).toBeLessThan(4096);
  });

  it('labels missing funding data without inventing a percentage', () => {
    const text = buildDailyDigestText(digest);
    const chadEntry = text.slice(text.indexOf('5. Chad'));

    expect(chadEntry).toContain('Funding gap unavailable');
  });

  it('labels deterministic fallback summaries honestly', () => {
    const text = buildDailyDigestText({
      ...digest,
      items: [{ ...digest.items[0]!, usedFallback: true }],
    });

    expect(text).toContain('Grounded summary:');
    expect(text).not.toContain('AI summary:');
  });
});
