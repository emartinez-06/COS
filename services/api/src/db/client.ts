/**
 * The Postgres connection and the Drizzle client built on it.
 *
 * One pool per process. Everything that touches the database imports `db`
 * from here so connection configuration exists in exactly one place.
 */

import {drizzle} from 'drizzle-orm/node-postgres';
import {Pool} from 'pg';

import {env, isProduction} from '../env.js';
import * as schema from './schema/index.js';

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  // Small by design: this is a club calendar, not a write-heavy system, and a
  // modest ceiling keeps a self-hosted Postgres on shared hardware healthy.
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

export const db = drizzle(pool, {schema, logger: !isProduction});

export type Database = typeof db;

/** Closes the pool. Called on shutdown so in-flight queries can finish. */
export async function closeDatabase(): Promise<void> {
  await pool.end();
}
