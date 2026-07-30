/**
 * Applies pending migrations, then exits.
 *
 * Kept as a separate entry point rather than running on server boot: several
 * API instances starting at once would otherwise race to migrate the same
 * database, and a self-hoster should be able to run migrations as a deliberate
 * step before a deploy.
 */

import {migrate} from 'drizzle-orm/node-postgres/migrator';

import {closeDatabase, db} from './client.js';

async function main(): Promise<void> {
  console.log('Applying migrations...');
  await migrate(db, {migrationsFolder: './drizzle'});
  console.log('Migrations up to date.');
}

main()
  .catch((error: unknown) => {
    console.error('Migration failed:', error);
    process.exitCode = 1;
  })
  .finally(() => closeDatabase());
