import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { closeDb, db } from './client.js';

/**
 * Applies pending migrations from ./drizzle. Safe to run repeatedly —
 * drizzle tracks what has already been applied.
 */
async function main(): Promise<void> {
  console.log('Running migrations...');
  await migrate(db, { migrationsFolder: './drizzle' });
  console.log('Migrations complete.');
  await closeDb();
}

main().catch(async (error: unknown) => {
  console.error('Migration failed:', error);
  await closeDb().catch(() => {});
  process.exit(1);
});
