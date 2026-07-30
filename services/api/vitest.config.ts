import {defineConfig} from 'vitest/config';

// src/env.ts validates configuration at import time and throws if it is
// missing, so .env has to be in process.env before any test file is loaded.
// A missing file is not an error: CI supplies the variables directly.
try {
  process.loadEnvFile('.env');
} catch {
  // Intentionally empty.
}

export default defineConfig({
  test: {
    // These are integration tests against one shared Postgres. Running files
    // in parallel would have them racing on the same rows.
    fileParallelism: false,
    // Sign-up hashes passwords with scrypt, which is deliberately slow, and
    // beforeAll does it three times.
    hookTimeout: 30_000,
  },
});
