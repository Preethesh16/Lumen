import { timingSafeEqual } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import {
  BRIEF_AUDIENCES,
  type Brief,
  type DeliverBriefResponse,
  type RunBriefsResponse,
} from '@lumen/shared-types';
import { db } from '../db/client.js';
import { briefs, crises, crisisScores } from '../db/schema.js';
import { env } from '../env.js';
import { asyncHandler, badRequest, notFound, unauthorized } from '../lib/errors.js';
import { deliverBrief, deliverDailyDigest, type DailyDigestItem } from '../services/delivery.js';
import { generateBrief } from '../services/briefs.js';

export const briefsRouter: Router = Router();

function adminMatches(candidate: string | undefined): boolean {
  if (!candidate) return false;
  const expected = Buffer.from(env.N8N_WEBHOOK_SECRET);
  const received = Buffer.from(candidate);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

briefsRouter.use((req, _res, next) => {
  if (!adminMatches(req.header('x-lumen-admin-secret'))) {
    next(unauthorized('Invalid or missing x-lumen-admin-secret header'));
    return;
  }
  next();
});

const generateSchema = z.object({
  crisisId: z.string().min(2),
  audience: z.enum(BRIEF_AUDIENCES).default('journalist'),
  forceTemplate: z.boolean().optional(),
});

briefsRouter.post(
  '/generate',
  asyncHandler(async (req, res) => {
    const parsed = generateSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw badRequest(parsed.error.issues.map((i) => i.message).join('; '));
    const result = await generateBrief(parsed.data.crisisId, parsed.data.audience, {
      forceTemplate: parsed.data.forceTemplate,
    });
    res.status(201).json(result);
  }),
);

const deliverySchema = z.object({
  channels: z.array(z.enum(['telegram', 'email'])).min(1).default(['telegram']),
});

briefsRouter.post(
  '/:id/deliver',
  asyncHandler(async (req, res) => {
    const parsed = deliverySchema.safeParse(req.body ?? {});
    if (!parsed.success) throw badRequest(parsed.error.issues.map((i) => i.message).join('; '));
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const [row] = await db.select().from(briefs).where(eq(briefs.id, id!)).limit(1);
    if (!row) throw notFound(`No brief found for "${id}"`);
    const brief: Brief = {
      id: row.id,
      crisisId: row.crisisId,
      scoreId: row.scoreId === null ? null : String(row.scoreId),
      audience: row.audience,
      content: row.content,
      model: row.model,
      promptVersion: row.promptVersion,
      generatedAt: row.generatedAt.toISOString(),
    };
    const body: DeliverBriefResponse = {
      data: await deliverBrief(brief, parsed.data.channels),
    };
    res.json(body);
  }),
);

const runSchema = z.object({
  limit: z.number().int().min(1).max(10).default(5),
  audience: z.enum(BRIEF_AUDIENCES).default('journalist'),
  channels: z.array(z.enum(['telegram', 'email'])).default(['telegram', 'email']),
  forceTemplate: z.boolean().optional(),
});

briefsRouter.post(
  '/run',
  asyncHandler(async (req, res) => {
    const parsed = runSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw badRequest(parsed.error.issues.map((i) => i.message).join('; '));

    const [latest] = await db
      .select({ scoredFor: crisisScores.scoredFor })
      .from(crisisScores)
      .orderBy(desc(crisisScores.scoredFor))
      .limit(1);
    if (!latest) throw notFound('No scored crises are available');

    const ranked = await db
      .select({
        crisisId: crises.id,
        iso3: crises.iso3,
        name: crises.name,
        needScore: crisisScores.needScore,
        coverageScore: crisisScores.coverageScore,
        attentionGapScore: crisisScores.attentionGapScore,
        fundingGapPct: crisisScores.fundingGapPct,
      })
      .from(crisisScores)
      .innerJoin(crises, eq(crises.id, crisisScores.crisisId))
      .where(eq(crisisScores.scoredFor, latest.scoredFor))
      .orderBy(desc(crisisScores.attentionGapScore))
      .limit(parsed.data.limit);

    const data = [];
    const digestItems: DailyDigestItem[] = [];
    for (const [index, crisis] of ranked.entries()) {
      const generated = await generateBrief(crisis.crisisId, parsed.data.audience, {
        forceTemplate: parsed.data.forceTemplate,
      });
      const summary = generated.data.content.split(/\n\n+/).slice(1).join(' ').trim();
      const item = {
        rank: index + 1,
        name: crisis.name,
        iso3: crisis.iso3,
        needScore: Number(crisis.needScore),
        coverageScore: Number(crisis.coverageScore),
        attentionGapScore: Number(crisis.attentionGapScore),
        fundingGapPct:
          crisis.fundingGapPct === null ? null : Number(crisis.fundingGapPct),
        summary,
        usedFallback: generated.usedFallback,
      };
      digestItems.push(item);
      data.push({
        crisisId: crisis.crisisId,
        iso3: crisis.iso3,
        name: crisis.name,
        rank: item.rank,
        needScore: item.needScore,
        coverageScore: item.coverageScore,
        attentionGapScore: item.attentionGapScore,
        fundingGapPct: item.fundingGapPct,
        brief: generated.data,
        usedFallback: generated.usedFallback,
      });
    }

    const delivery = await deliverDailyDigest(
      {
        scoredFor: latest.scoredFor,
        audience: parsed.data.audience,
        items: digestItems,
      },
      parsed.data.channels,
    );
    const body: RunBriefsResponse = { scoredFor: latest.scoredFor, data, delivery };
    res.status(201).json(body);
  }),
);
