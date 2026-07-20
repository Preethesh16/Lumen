import { describe, expect, it } from 'vitest';
import type { RankedCrisis } from '@lumen/shared-types';
import type { GeneratedBrief } from '../../content-agent/types';
import { formatBrief } from '../telegram';
import { renderDigest } from '../digest';
import { mockDetail, mockRankedCrises } from '../../api/mock-data';

const ranked = mockRankedCrises();
const sudan = ranked.find((c) => c.id === 'sdn')!;
const myanmar = ranked.find((c) => c.id === 'mmr')!;

const brief: GeneratedBrief = {
  crisisId: 'sdn',
  scoreId: 'score-sdn',
  audience: 'journalist',
  headline: 'Sudan displacement passes 1.2 million as coverage falls',
  body: 'UNHCR records 1,247,891 people displaced.',
  statsUsed: [],
  model: 'claude-sonnet-5',
  promptVersion: 'v1',
  generatedAt: '2026-07-19T08:00:00.000Z',
};

describe('formatBrief', () => {
  it('escapes MarkdownV2 control characters in model-written text', () => {
    // The headline contains a period, which Telegram rejects unescaped.
    const message = formatBrief(sudan, brief);
    expect(message).toContain('1\\.2 million');
    expect(message).not.toMatch(/(?<!\\)\./);
  });

  it('states missing funding data rather than rendering it as zero', () => {
    const message = formatBrief(myanmar, brief);
    expect(message).toContain('no appeal data');
    expect(message).not.toContain('0% unfunded');
  });

  it('truncates over-long briefs on a line boundary rather than mid-escape', () => {
    const long: GeneratedBrief = { ...brief, body: 'A very long sentence.\n'.repeat(400) };
    const message = formatBrief(sudan, long);

    expect(message.length).toBeLessThanOrEqual(4_096);
    expect(message).toContain('truncated');
    // A trailing lone backslash would make Telegram reject the whole message.
    expect(message.endsWith('\\')).toBe(false);
  });
});

describe('renderDigest', () => {
  it('renders a ranked table when crises exist', () => {
    const html = renderDigest([sudan], 'https://lumen.example');
    expect(html).toContain('Sudan');
    // fundingGapPct is a 0..1 share; 0.68 must render as 68%, not 0.68%.
    expect(html).toContain('68% unfunded');
    expect(html).not.toContain('0.68% unfunded');
  });

  it('handles the empty crisis list from a first run before ingestion', () => {
    const html = renderDigest([], 'https://lumen.example');
    expect(html).toContain('No crisis scores were available');
    expect(html).not.toContain('<tbody></tbody>');
  });

  it('escapes HTML in crisis names so upstream data cannot inject markup', () => {
    const hostile: RankedCrisis = { ...sudan, name: '<script>alert(1)</script>' };
    const html = renderDigest([hostile], 'https://lumen.example');

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('shows "No appeal data" rather than 0% when funding is absent', () => {
    const html = renderDigest([myanmar], 'https://lumen.example');
    expect(html).toContain('No appeal data');
    expect(html).not.toContain('0% unfunded');
  });
});

describe('mock data shape', () => {
  it('ranks by attention gap with 1-based positions', () => {
    expect(ranked[0].rank).toBe(1);
    expect(ranked[0].latestScore.attentionGapScore).toBeGreaterThan(
      ranked[1].latestScore.attentionGapScore,
    );
  });

  it('includes an over-covered crisis with a negative gap', () => {
    const ukraine = ranked.find((c) => c.id === 'ukr')!;
    expect(ukraine.latestScore.attentionGapScore).toBeLessThan(0);
  });

  it('keeps fundingGapPct null rather than zero when there is no appeal', () => {
    expect(mockDetail('mmr')!.latestScore.fundingGapPct).toBeNull();
  });
});
