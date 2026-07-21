import { SOURCE_NAMES, type SourceName } from '@lumen/shared-types';
import { closeDb } from '../db/client.js';
import { ingestAll, ingestSource } from './run.js';

/**
 * CLI ingestion runner: `pnpm --filter @lumen/api ingest [source]`.
 *
 * With no argument, runs every source and scores at the end. With a source
 * name, runs just that one. Exists so ingestion can be triggered and debugged
 * from a terminal without n8n, and so a cron or a one-off backfill has a clean
 * entry point.
 */
async function main(): Promise<void> {
  const arg = process.argv[2] as SourceName | undefined;

  if (arg && !SOURCE_NAMES.includes(arg)) {
    console.error(`Unknown source "${arg}". One of: ${SOURCE_NAMES.join(', ')}`);
    process.exit(2);
  }

  const results = arg
    ? [await ingestSource(arg, { triggerScoring: true })]
    : await ingestAll();

  let failed = 0;
  for (const r of results) {
    const status = r.ok ? 'ok' : 'FAILED';
    console.log(
      `[${status}] ${r.source}: ${r.observationsWritten} observations, ` +
        `${r.scoresComputed} scores`,
    );
    if (r.error) {
      console.log(`         error: ${r.error}`);
      failed++;
    }
    for (const w of r.warnings.slice(0, 8)) console.log(`         warn: ${w}`);
    if (r.warnings.length > 8) console.log(`         ... and ${r.warnings.length - 8} more`);
  }

  await closeDb();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (error: unknown) => {
  console.error('Ingestion crashed:', error);
  await closeDb().catch(() => {});
  process.exit(1);
});
