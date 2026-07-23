import { desc, eq } from 'drizzle-orm';
import type {
  Brief,
  BriefAudience,
  GenerateBriefResponse,
  ObservationMetric,
  ObservationPoint,
  SourceName,
} from '@lumen/shared-types';
import { db } from '../db/client.js';
import {
  briefs,
  crises,
  crisisScores,
  sourceObservations,
  type BriefRow,
} from '../db/schema.js';
import { env } from '../env.js';
import { notFound } from '../lib/errors.js';

const PROMPT_VERSION = 'grounded-v1';
const TEMPLATE_MODEL = 'lumen-template-v1';

const metricLabels: Record<ObservationMetric, string> = {
  coverage_volume_pct: 'media coverage volume',
  displaced_persons: 'displaced people',
  appeal_funded_pct: 'appeal funded',
  appeal_requirements_usd: 'appeal requirement',
  active_disaster_count: 'active disasters',
};

function briefFromRow(row: BriefRow): Brief {
  return {
    id: row.id,
    crisisId: row.crisisId,
    scoreId: row.scoreId === null ? null : String(row.scoreId),
    audience: row.audience,
    content: row.content,
    model: row.model,
    promptVersion: row.promptVersion,
    generatedAt: row.generatedAt.toISOString(),
  };
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function compactNumber(value: number): string {
  return new Intl.NumberFormat('en', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

function observationFact(point: ObservationPoint): string {
  switch (point.metric) {
    case 'appeal_funded_pct':
      return `${percent(point.value)} appeal funded`;
    case 'coverage_volume_pct':
      return `${point.value.toFixed(3)}% media coverage volume`;
    case 'appeal_requirements_usd':
      return `${compactNumber(point.value)} USD appeal requirement`;
    case 'displaced_persons':
      return `${compactNumber(point.value)} displaced people`;
    case 'active_disaster_count':
      return `${compactNumber(point.value)} active disasters`;
    default:
      return `${compactNumber(point.value)} ${metricLabels[point.metric]}`;
  }
}

function audienceAction(audience: BriefAudience): string {
  if (audience === 'donor') {
    return 'Funding attention should be reviewed against the documented need and current appeal gap.';
  }
  if (audience === 'ngo') {
    return 'Response teams can use this signal to prioritize coordination, evidence gathering, and advocacy.';
  }
  return 'Editors should consider commissioning verified reporting that centers affected communities and local responders.';
}

interface Grounding {
  crisisId: string;
  iso3: string;
  name: string;
  region: string | null;
  scoreId: number;
  scoredFor: string;
  needScore: number;
  coverageScore: number;
  attentionGapScore: number;
  fundingGapPct: number | null;
  observations: ObservationPoint[];
}

async function loadGrounding(identifier: string): Promise<Grounding> {
  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);
  const [crisis] = await db
    .select()
    .from(crises)
    .where(isUuid ? eq(crises.id, identifier) : eq(crises.iso3, identifier.toUpperCase()))
    .limit(1);
  if (!crisis) throw notFound(`No crisis found for "${identifier}"`);

  const [score] = await db
    .select()
    .from(crisisScores)
    .where(eq(crisisScores.crisisId, crisis.id))
    .orderBy(desc(crisisScores.scoredFor), desc(crisisScores.computedAt))
    .limit(1);
  if (!score) throw notFound(`Crisis "${crisis.iso3}" has not been scored yet`);

  const rows = await db
    .select()
    .from(sourceObservations)
    .where(eq(sourceObservations.crisisId, crisis.id))
    .orderBy(desc(sourceObservations.observedAt))
    .limit(40);

  const seen = new Set<string>();
  const observations: ObservationPoint[] = [];
  for (const row of rows) {
    if (seen.has(row.metric)) continue;
    seen.add(row.metric);
    observations.push({
      source: row.source as SourceName,
      metric: row.metric as ObservationMetric,
      value: Number(row.value),
      observedAt: row.observedAt,
    });
  }

  return {
    crisisId: crisis.id,
    iso3: crisis.iso3,
    name: crisis.name,
    region: crisis.region,
    scoreId: score.id,
    scoredFor: score.scoredFor,
    needScore: Number(score.needScore),
    coverageScore: Number(score.coverageScore),
    attentionGapScore: Number(score.attentionGapScore),
    fundingGapPct: score.fundingGapPct === null ? null : Number(score.fundingGapPct),
    observations,
  };
}

function factParagraph(data: Grounding): string {
  const scoreFacts = [
    `need score ${percent(data.needScore)}`,
    `coverage score ${percent(data.coverageScore)}`,
    `attention gap ${data.attentionGapScore.toFixed(3)}`,
  ];
  if (data.fundingGapPct !== null) {
    scoreFacts.push(`funding gap ${percent(data.fundingGapPct)}`);
  }
  const observations = data.observations.map(observationFact);
  const sourceText =
    observations.length > 0 ? ` Latest source readings: ${observations.join('; ')}.` : '';
  return `${data.name} (${data.iso3}), scored ${data.scoredFor}: ${scoreFacts.join(', ')}.${sourceText}`;
}

async function groqNarrative(
  data: Grounding,
  audience: BriefAudience,
): Promise<{ content: string; model: string }> {
  if (!env.GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY is not configured');
  }

  const facts = {
    country: data.name,
    region: data.region,
    audience,
    needRelativeToCoverage:
      data.needScore > data.coverageScore ? 'need is higher than coverage' : 'coverage meets or exceeds need',
    funding:
      data.fundingGapPct === null
        ? 'funding data is unavailable'
        : data.fundingGapPct >= 0.5
          ? 'the response is substantially underfunded'
          : 'the response has a smaller funding gap',
  };

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.GROQ_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: env.GROQ_MODEL,
      temperature: 0.2,
      max_completion_tokens: 180,
      messages: [
        {
          role: 'system',
          content:
            'Write one concise humanitarian briefing paragraph. Use only the supplied qualitative facts. ' +
            'Do not include digits, quantities, dates, rankings, percentages, quotations, names of organizations, ' +
            'or facts not supplied. Do not use markdown. Avoid sensational language.',
        },
        {
          role: 'user',
          content: JSON.stringify(facts),
        },
      ],
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`Groq request failed with HTTP ${response.status}`);
  }

  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const content = body.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error('Groq returned an empty response');
  if (/\d/.test(content)) {
    throw new Error('Groq response failed the no-invented-statistics guard');
  }
  return { content, model: env.GROQ_MODEL };
}

export async function generateBrief(
  identifier: string,
  audience: BriefAudience,
  options: { forceTemplate?: boolean } = {},
): Promise<GenerateBriefResponse> {
  const data = await loadGrounding(identifier);
  const facts = factParagraph(data);
  let narrative = audienceAction(audience);
  let model = TEMPLATE_MODEL;
  let warning: string | null = null;

  if (!options.forceTemplate) {
    try {
      const generated = await groqNarrative(data, audience);
      narrative = generated.content;
      model = generated.model;
    } catch (error) {
      warning = error instanceof Error ? error.message : String(error);
    }
  }

  const [row] = await db
    .insert(briefs)
    .values({
      crisisId: data.crisisId,
      scoreId: data.scoreId,
      audience,
      content: `${facts}\n\n${narrative}`,
      model,
      promptVersion: PROMPT_VERSION,
    })
    .returning();

  return {
    data: briefFromRow(row!),
    usedFallback: model === TEMPLATE_MODEL,
    warning,
  };
}
