import { Router } from 'express';
import { z } from 'zod';
import { SOURCE_NAMES } from '@lumen/shared-types';
import { asyncHandler, badRequest, unauthorized } from '../lib/errors.js';
import { ingestAll, ingestSource } from '../ingest/run.js';
import { secretMatches } from './webhook.js';

export const ingestRouter: Router = Router();

const bodySchema = z.object({
  // Omit to run every source; name one to run just that source.
  source: z.enum(SOURCE_NAMES).optional(),
  triggerScoring: z.boolean().optional(),
});

/**
 * POST /ingest/run
 *
 * Server-side ingestion: the API fetches from the live upstreams itself, using
 * the tested adapter modules, and persists via the same path as the webhook.
 * This is what the n8n workflows call — n8n becomes a scheduler rather than a
 * place where fetch-and-parse logic lives untested.
 *
 * Secret-protected with the same shared secret as the webhook. Runs
 * synchronously; a full run (GDELT paces at 1 country / 6s) can take minutes,
 * so callers should use a generous timeout.
 */
ingestRouter.post(
  '/run',
  asyncHandler(async (req, res) => {
    if (!secretMatches(req.header('x-lumen-webhook-secret'))) {
      throw unauthorized('Invalid or missing x-lumen-webhook-secret header');
    }

    const parsed = bodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw badRequest(
        parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; '),
      );
    }

    const { source, triggerScoring } = parsed.data;

    if (source) {
      const result = await ingestSource(source, { triggerScoring: triggerScoring ?? true });
      res.status(result.ok ? 200 : 502).json(result);
      return;
    }

    const results = await ingestAll();
    const anyFailed = results.some((r) => !r.ok);
    // 207-ish semantics: a partial success (some sources down) is still useful,
    // but signal it so a caller/monitor can tell a clean run from a degraded one.
    res.status(anyFailed ? 207 : 200).json({ results });
  }),
);
