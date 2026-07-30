/**
 * Environment configuration, validated once at startup.
 *
 * Parsing here rather than reading process.env at each use site means a
 * misconfigured deployment fails immediately with a readable message instead
 * of throwing something obscure on the first request that happens to need it.
 */

import {z} from 'zod';

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),

  PORT: z.coerce.number().int().positive().default(3200),

  /** Postgres connection string. See .env.example. */
  DATABASE_URL: z.url({protocol: /^postgres(ql)?$/}),

  /**
   * Signing secret for sessions. Rotating it invalidates every session, which
   * is the intended emergency lever.
   */
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),

  /** Public origin of this API, used to build callback URLs. */
  BETTER_AUTH_URL: z.url().default('http://localhost:3200'),

  /**
   * Origins allowed to call this API with credentials. Comma-separated so a
   * self-hoster can add their own domain without a code change.
   */
  WEB_ORIGINS: z
    .string()
    .default('http://localhost:3100')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
});

export type Env = z.infer<typeof envSchema>;

function load(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Invalid environment configuration:\n${details}\n\nSee services/api/.env.example.`,
    );
  }

  return parsed.data;
}

export const env = load();

export const isProduction = env.NODE_ENV === 'production';
