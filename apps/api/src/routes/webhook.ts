import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { OBSERVATION_METRICS, SOURCE_NAMES } from '@lumen/shared-types';
import { env } from '../env.js';
import { asyncHandler, badRequest, unauthorized } from '../lib/errors.js';
import { persistObservations } from '../ingest/persist.js';

export const webhookRouter: Router = Router();

const observationSchema = z.object({
  iso3: z.string().length(3),
  source: z.enum(SOURCE_NAMES),
  metric: z.enum(OBSERVATION_METRICS),
  value: z.number().finite().nonnegative(),
  observedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'observedAt must be YYYY-MM-DD'),
  raw: z.unknown().optional(),
});

const payloadSchema = z.object({
  runId: z.string().uuid().optional(),
  source: z.enum(SOURCE_NAMES),
  observations: z.array(observationSchema).max(5000),
  triggerScoring: z.boolean().optional().default(false),
});

/**
 * Constant-time secret comparison. A plain `===` leaks the secret one byte at
 * a time to anyone who can measure response latency.
 */
export function secretMatches(provided: string | undefined): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(env.N8N_WEBHOOK_SECRET);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * POST /webhook/n8n-score-update
 *
 * Accepts already-parsed observations from an external caller (n8n, or any
 * process that does its own fetching). The actual write path lives in
 * `persistObservations`, shared with the in-process ingestion runner.
 */
webhookRouter.post(
  '/n8n-score-update',
  asyncHandler(async (req, res) => {
    if (!secretMatches(req.header('x-lumen-webhook-secret'))) {
      throw unauthorized('Invalid or missing x-lumen-webhook-secret header');
    }

    const parsed = payloadSchema.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest(
        `Invalid payload: ${parsed.error.issues
          .map((i) => `${i.path.join('.')} ${i.message}`)
          .join('; ')}`,
      );
    }

    const { source, observations, triggerScoring } = parsed.data;
    const result = await persistObservations({ source, observations, triggerScoring });
    res.status(200).json(result);
  }),
);
