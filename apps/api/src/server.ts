import { createApp } from './app.js';
import { closeDb } from './db/client.js';
import { env } from './env.js';

const app = createApp();
const server = app.listen(env.API_PORT, () => {
  console.log(`Lumen API listening on http://localhost:${env.API_PORT}`);
});

/**
 * Drain in-flight requests and close the pool before exiting, so a deploy
 * doesn't sever a request mid-transaction.
 */
async function shutdown(signal: string): Promise<void> {
  console.log(`${signal} received, shutting down...`);
  server.close(async () => {
    await closeDb().catch((e: unknown) => console.error('Error closing pool:', e));
    process.exit(0);
  });
  // Don't hang forever if a connection refuses to drain.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
