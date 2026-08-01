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

  /**
   * S3-compatible object storage for uploaded documents.
   *
   * Defaults match the MinIO service in the repo-root docker-compose.yml, the
   * same way DATABASE_URL matches the Postgres service. Point these at R2 or
   * AWS in production; the client code does not change.
   *
   * Leave STORAGE_ENDPOINT empty to talk to real AWS S3, which is addressed by
   * region rather than by endpoint.
   */
  STORAGE_ENDPOINT: z.string().default('http://localhost:9000'),
  STORAGE_REGION: z.string().default('us-east-1'),
  STORAGE_BUCKET: z.string().default('cos-documents'),
  STORAGE_ACCESS_KEY_ID: z.string().default('cos_dev_access_key'),
  STORAGE_SECRET_ACCESS_KEY: z.string().default('cos_dev_secret_key'),
  /**
   * Path-style addressing (`endpoint/bucket/key`) rather than virtual-host
   * style (`bucket.endpoint/key`).
   *
   * Required for MinIO, because virtual-host style needs wildcard DNS that a
   * localhost container does not have. AWS and R2 work either way.
   */
  STORAGE_FORCE_PATH_STYLE: z
    .string()
    .default('true')
    .transform((value) => value !== 'false'),
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
