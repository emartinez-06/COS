/**
 * Liveness and readiness.
 *
 * `/health` answers "is the process up", which is what a load balancer wants.
 * `/health/ready` actually touches Postgres, which is what a deploy or a
 * `docker compose up` wants before sending traffic.
 */

import {OpenAPIHono, createRoute, z} from '@hono/zod-openapi';
import {sql} from 'drizzle-orm';

import {db} from '../db/client.js';
import type {AppEnv} from '../auth/middleware.js';

const healthSchema = z
  .object({
    status: z.literal('ok'),
    service: z.string(),
  })
  .openapi('Health');

const readySchema = z
  .object({
    status: z.enum(['ok', 'degraded']),
    database: z.enum(['up', 'down']),
  })
  .openapi('Readiness');

const healthRoute = createRoute({
  method: 'get',
  path: '/health',
  tags: ['Health'],
  summary: 'Liveness check',
  responses: {
    200: {
      description: 'The service is running',
      content: {'application/json': {schema: healthSchema}},
    },
  },
});

const readyRoute = createRoute({
  method: 'get',
  path: '/health/ready',
  tags: ['Health'],
  summary: 'Readiness check, including the database',
  responses: {
    200: {
      description: 'The service can serve traffic',
      content: {'application/json': {schema: readySchema}},
    },
    503: {
      description: 'A dependency is unavailable',
      content: {'application/json': {schema: readySchema}},
    },
  },
});

export const healthRoutes = new OpenAPIHono<AppEnv>();

healthRoutes.openapi(healthRoute, (c) =>
  c.json({status: 'ok' as const, service: 'cos-api'}, 200),
);

healthRoutes.openapi(readyRoute, async (c) => {
  try {
    await db.execute(sql`select 1`);
    return c.json({status: 'ok' as const, database: 'up' as const}, 200);
  } catch {
    // The specific error goes to logs, not to an unauthenticated caller.
    return c.json({status: 'degraded' as const, database: 'down' as const}, 503);
  }
});
