import { describe, expect, it } from 'vitest';
import type { Brief, Crisis } from '@lumen/shared-types';
import { formatBrief } from '../telegram';
import { renderDigest } from '../digest';
import { sudanInput, noFundingDataInput } from '../../content-agent/__tests__/fixtures';

const crisis: Crisis = sudanInput.crisis;

const brief: Brief = {
  briefId: 'sdn-journalist-1',
  crisisId: crisis.crisisId,
  audience: 'journalist',
  headline: 'Sudan displacement passes 1.2 million as coverage falls',
  body: 'UNHCR records 1,247,891 people displaced. GDELT logged 37 articles in 24 hours.',
  statsUsed: [],
  generatedAt: '2026-07-19T08:00:00.000Z',
  model: 'claude-sonnet-5',
};

describe('formatBrief', () => {
  it('escapes MarkdownV2 control characters in model-written text', () => {
    // The headline contains a period, which Telegram rejects unescaped.
    const message = formatBrief(crisis, brief);
    expect(message).toContain('1\\.2 million');
    expect(message).not.toMatch(/(?<!\\)\./);
  });

  it('states missing funding data rather than rendering it as zero', () => {
    const message = formatBrief(noFundingDataInput.crisis, brief);
    expect(message).toContain('no appeal funding data available');
    expect(message).not.toContain('0% of the appeal');
  });

  it('truncates over-long briefs on a line boundary rather than mid-escape', () => {
    const long: Brief = { ...brief, body: 'A very long sentence.\n'.repeat(400) };
    const message = formatBrief(crisis, long);

    expect(message.length).toBeLessThanOrEqual(4_096);
    expect(message).toContain('truncated');
    // A trailing lone backslash would make Telegram reject the whole message.
    expect(message.endsWith('\\')).toBe(false);
  });
});

describe('renderDigest', () => {
  it('renders a ranked table when crises exist', () => {
    const html = renderDigest([crisis], 'https://lumen.example');
    expect(html).toContain('Sudan conflict displacement');
    expect(html).toContain('68% unfunded');
  });

  it('handles the empty crisis list from a first run before ingestion', () => {
    const html = renderDigest([], 'https://lumen.example');
    expect(html).toContain('No crisis scores were available');
    expect(html).not.toContain('<tbody></tbody>');
  });

  it('escapes HTML in crisis names so upstream data cannot inject markup', () => {
    const hostile: Crisis = { ...crisis, name: '<script>alert(1)</script>' };
    const html = renderDigest([hostile], 'https://lumen.example');

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('shows "no appeal data" rather than 0% when funding is absent', () => {
    const html = renderDigest([noFundingDataInput.crisis], 'https://lumen.example');
    expect(html).toContain('no appeal data');
    expect(html).not.toContain('0% unfunded');
  });
});
