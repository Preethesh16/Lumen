import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BriefAudience } from '@lumen/shared-types';

/**
 * Prompts live in version-controlled markdown files, not inline strings, so a
 * change to what the model is told shows up as a reviewable diff.
 */

const PROMPT_DIR = join(dirname(fileURLToPath(import.meta.url)), 'prompts');

const AUDIENCE_FILES: Record<BriefAudience, string> = {
  journalist: 'journalist-pitch.md',
  donor: 'donor-onepager.md',
  ngo: 'ngo-fundraising.md',
};

const cache = new Map<string, string>();

async function load(filename: string): Promise<string> {
  const cached = cache.get(filename);
  if (cached !== undefined) return cached;

  const contents = await readFile(join(PROMPT_DIR, filename), 'utf8');
  cache.set(filename, contents);
  return contents;
}

export async function systemPrompt(): Promise<string> {
  return load('system.md');
}

export async function audiencePrompt(audience: BriefAudience): Promise<string> {
  const filename = AUDIENCE_FILES[audience];
  if (!filename) {
    throw new Error(`No prompt file registered for audience "${audience}"`);
  }
  return load(filename);
}
