import express, { type Express } from 'express';
import { sql } from './db/client.js';
import { errorHandler } from './lib/errors.js';
import { crisesRouter } from './routes/crises.js';
import { ingestRouter } from './routes/ingest.js';
import { webhookRouter } from './routes/webhook.js';
import { briefsRouter } from './routes/briefs.js';

export function createApp(): Express {
  const app = express();

  app.use(express.json({ limit: '5mb' }));

  /**
   * Liveness + readiness in one. Actually round-trips to Postgres: a health
   * check that only proves the process is running will report green while
   * every request 500s on a dead database.
   */
  app.get('/health', async (_req, res) => {
    try {
      await sql`SELECT 1`;
      res.json({ status: 'ok', database: 'connected' });
    } catch (error) {
      console.error('Health check failed:', error);
      res.status(503).json({ status: 'degraded', database: 'unreachable' });
    }
  });

  app.use('/crises', crisesRouter);
  app.use('/webhook', webhookRouter);
  app.use('/ingest', ingestRouter);
  app.use('/briefs', briefsRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: 'Route not found' } });
  });

  app.use(errorHandler);

  return app;
}
