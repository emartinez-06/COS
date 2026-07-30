import {defineConfig} from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    // drizzle-kit runs outside the app, so it reads the variable directly
    // rather than through src/env.ts. `generate` does not need it; `migrate`
    // and `studio` do.
    url: process.env.DATABASE_URL ?? '',
  },
  // Migrations are reviewed before they run against a self-hoster's database,
  // so they are plain SQL files rather than pushed schema diffs.
  verbose: true,
  strict: true,
});
