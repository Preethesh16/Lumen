import Anthropic from '@anthropic-ai/sdk';
import type { Brief, BriefAudience } from '@lumen/shared-types';
import type { BriefInput, GeneratedBrief, StatCitation } from './types';
import { validateGrounding } from './grounding';
import { audiencePrompt, systemPrompt } from './prompts';

const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5';
/** Bumped whenever a file in prompts/ changes, and stored on every brief. */
export const PROMPT_VERSION = 'v1';
const MAX_ATTEMPTS = 4;
const BASE_BACKOFF_MS = 1_000;

export class GroundingViolationError extends Error {
  constructor(
    readonly crisisId: string,
    readonly audience: BriefAudience,
    readonly unsupportedFigures: string[],
  ) {
    super(
      `Generated ${audience} brief for ${crisisId} contained ${unsupportedFigures.length} ` +
        `figure(s) absent from the input payload: ${unsupportedFigures.join(', ')}`,
    );
    this.name = 'GroundingViolationError';
  }
}

interface ModelOutput {
  headline: string;
  body: string;
  statsUsed: StatCitation[];
}

let client: Anthropic | undefined;

function anthropic(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not set — see README.md for required env vars');
    }
    client = new Anthropic({ apiKey });
  }
  return client;
}

/**
 * The payload is passed as JSON rather than prose so the model cannot mistake
 * our framing for a fact. What it sees is exactly what `validateGrounding`
 * will check against.
 */
function userMessage(input: BriefInput, instructions: string): string {
  return [
    instructions,
    '',
    'Here is the complete data payload. Nothing outside it may appear in your output.',
    '',
    '```json',
    JSON.stringify(input, null, 2),
    '```',
  ].join('\n');
}

function parseModelOutput(text: string): ModelOutput {
  // The model is asked for bare JSON, but wrapping it in a fenced block is a
  // common and harmless deviation — tolerate it rather than failing the run.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? text).trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    throw new Error(`Model did not return parseable JSON. Received: ${text.slice(0, 200)}`);
  }

  const output = parsed as Partial<ModelOutput>;
  if (!output.headline || !output.body || !Array.isArray(output.statsUsed)) {
    throw new Error('Model output is missing one of: headline, body, statsUsed');
  }
  return output as ModelOutput;
}

function isRetryable(error: unknown): boolean {
  if (error instanceof Anthropic.APIError) {
    return error.status === 429 || error.status === undefined || error.status >= 500;
  }
  // Network-level failures surface as plain errors and are worth another try.
  return error instanceof Error && /timeout|ECONNRESET|ENOTFOUND|fetch failed/i.test(error.message);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Generates one audience-tailored brief.
 *
 * Throws `GroundingViolationError` rather than returning an ungrounded brief.
 * A brief with an invented statistic is worse than no brief at all — these go
 * to journalists and donors who act on them, and a caller that wants to
 * degrade gracefully should catch this and show the crisis without a brief.
 */
export async function generateBrief(
  input: BriefInput,
  audience: BriefAudience,
  model: string = DEFAULT_MODEL,
): Promise<GeneratedBrief> {
  const [system, instructions] = await Promise.all([systemPrompt(), audiencePrompt(audience)]);

  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await anthropic().messages.create({
        model,
        max_tokens: 2_000,
        system,
        messages: [{ role: 'user', content: userMessage(input, instructions) }],
      });

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('');

      const output = parseModelOutput(text);

      const grounding = validateGrounding(output.body, input);
      if (!grounding.grounded) {
        throw new GroundingViolationError(
          input.score.crisisId,
          audience,
          grounding.unsupportedFigures,
        );
      }

      return {
        crisisId: input.score.crisisId,
        // Links the brief to the exact score row it was generated from, so
        // every figure traces to stored data rather than to a moment in time.
        scoreId: input.score.id,
        audience,
        headline: output.headline,
        body: output.body,
        statsUsed: output.statsUsed,
        model,
        promptVersion: PROMPT_VERSION,
        generatedAt: new Date().toISOString(),
      };
    } catch (error) {
      // A grounding violation is a content failure, not a transport failure.
      // Retrying is legitimate — sampling differs between calls — but it must
      // not be retried silently forever, and it must never be swallowed.
      lastError = error;

      const worthRetrying = isRetryable(error) || error instanceof GroundingViolationError;
      if (!worthRetrying || attempt === MAX_ATTEMPTS) break;

      await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
    }
  }

  throw lastError;
}

/**
 * Flattens a generated brief into the stored `Brief` shape.
 *
 * NOTE: `Brief.content` is a single string, so `statsUsed` has nowhere to go
 * and is dropped here. Those citations are the visible evidence that grounding
 * happened, so this is a real loss, not a formatting detail — the UI reads the
 * structured form directly and never round-trips through this. Resolving it
 * needs a schema change agreed with Preethesh; see docs/architecture.md.
 */
export function toStoredBrief(generated: GeneratedBrief, id: string): Brief {
  return {
    id,
    crisisId: generated.crisisId,
    scoreId: generated.scoreId,
    audience: generated.audience,
    content: `${generated.headline}\n\n${generated.body}`,
    model: generated.model,
    promptVersion: generated.promptVersion,
    generatedAt: generated.generatedAt,
  };
}

/** Generates all three audience briefs for one crisis. */
export async function generateAllBriefs(input: BriefInput): Promise<{
  briefs: GeneratedBrief[];
  failures: { audience: BriefAudience; error: string }[];
}> {
  const audiences: BriefAudience[] = ['journalist', 'donor', 'ngo'];

  const settled = await Promise.allSettled(
    audiences.map((audience) => generateBrief(input, audience)),
  );

  const briefs: GeneratedBrief[] = [];
  const failures: { audience: BriefAudience; error: string }[] = [];

  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      briefs.push(result.value);
    } else {
      // One audience failing does not invalidate the other two.
      failures.push({
        audience: audiences[index],
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    }
  });

  return { briefs, failures };
}
