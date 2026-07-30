/**
 * The Hono application.
 *
 * Kept separate from index.ts (which owns the listener and shutdown) so tests
 * can exercise the app with `app.request()` and no open port.
 */

import {OpenAPIHono} from '@hono/zod-openapi';
import {Scalar} from '@scalar/hono-api-reference';
import {cors} from 'hono/cors';
import {HTTPException} from 'hono/http-exception';
import {logger} from 'hono/logger';

import {auth} from './auth/auth.js';
import type {AppEnv} from './auth/middleware.js';
import {withSession} from './auth/middleware.js';
import {env, isProduction} from './env.js';
import {healthRoutes} from './routes/health.js';
import {sessionRoutes} from './routes/session.js';

export const app = new OpenAPIHono<AppEnv>({
  // Validation failures should read like the API's own errors, not like a
  // raw Zod dump.
  defaultHook: (result, c) => {
    if (!result.success) {
      return c.json(
        {
          error: 'Validation failed',
          issues: result.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
        400,
      );
    }
    return undefined;
  },
});

app.use('*', logger());

// Credentials must be allowed: the session is a cookie, not a bearer token.
// Origins are explicit rather than reflected, since `origin: '*'` and
// credentials are mutually exclusive for good reason.
app.use(
  '*',
  cors({
    origin: env.WEB_ORIGINS,
    credentials: true,
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    exposeHeaders: ['Set-Cookie'],
    maxAge: 600,
  }),
);

/**
 * better-auth owns everything under its base path: sign-up, sign-in, sign-out,
 * session refresh, and later the SSO callbacks. Mounting the whole subtree
 * rather than proxying individual routes is what keeps upgrades from becoming
 * a routing exercise.
 */
app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));

// Everything past here may know who the caller is. Anonymous is allowed;
// individual routes decide whether that is acceptable.
app.use('*', withSession);

app.route('/', healthRoutes);
app.route('/api', sessionRoutes);

app.doc('/openapi.json', {
  openapi: '3.1.0',
  info: {
    title: 'COS API',
    version: '0.1.0',
    description:
      'The API for COS, an open-source connective layer for student clubs. ' +
      'Authentication is a session cookie issued under /api/auth.',
  },
  servers: [{url: env.BETTER_AUTH_URL, description: 'This instance'}],
});

// A self-hosted product should ship its own API docs rather than point at a
// hosted spec that can drift from the running version.
app.get('/docs', Scalar({url: '/openapi.json', pageTitle: 'COS API'}));

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({error: err.message}, err.status);
  }

  console.error('Unhandled error:', err);
  return c.json(
    {
      error: isProduction ? 'Internal server error' : String(err),
    },
    500,
  );
});

app.notFound((c) => c.json({error: 'Not found'}, 404));
