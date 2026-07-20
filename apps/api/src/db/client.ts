import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../env.js';
import * as schema from './schema.js';

/**
 * postgres.js connection pool.
 *
 * `max: 10` keeps us well inside a free-tier connection cap while leaving
 * headroom for n8n's own pool against the same instance.
 */
export const sql = postgres(env.DATABASE_URL, {
  max: env.NODE_ENV === 'test' ? 1 : 10,
  idle_timeout: 20,
  connect_timeout: 10,
  onnotice: env.NODE_ENV === 'development' ? console.log : () => {},
});

export const db = drizzle(sql, { schema });

export type Db = typeof db;

export async function closeDb(): Promise<void> {
  await sql.end({ timeout: 5 });
}
