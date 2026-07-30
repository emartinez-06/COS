/**
 * Who am I, and what may I do?
 *
 * The web app calls this once on load to replace what used to be a hardcoded
 * Officer/Member switch. It returns the clubs the caller belongs to and their
 * role in each, rather than a single active club.
 */

import {OpenAPIHono, createRoute, z} from '@hono/zod-openapi';
import {
  capabilitySchema,
  capabilitiesFor,
  positionSchema,
  roleSchema,
} from '@cos/core';

import type {AppEnv} from '../auth/middleware.js';
import {requireAuth} from '../auth/middleware.js';
import {listMemberships} from '../auth/membership.js';

const userSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    email: z.email(),
    image: z.string().nullable(),
  })
  .openapi('User');

const membershipSchema = z
  .object({
    clubId: z.string(),
    name: z.string(),
    slug: z.string(),
    // Reused from @cos/core rather than redeclared, so the documented contract
    // cannot drift from what the domain actually permits.
    role: roleSchema,
    /**
     * The officer's job title, or null. Display only: it is what the UI calls
     * this person, never what it lets them do. `capabilities` below is derived
     * from `role` alone.
     */
    position: positionSchema.nullable(),
    /**
     * Expanded server-side so non-TypeScript clients get the same answer as
     * `can()` without reimplementing the map.
     */
    capabilities: z.array(capabilitySchema),
  })
  .openapi('Membership');

const sessionResponseSchema = z
  .object({
    user: userSchema,
    memberships: z.array(membershipSchema),
  })
  .openapi('SessionResponse');

const errorSchema = z
  .object({error: z.string()})
  .openapi('Error');

const getSessionRoute = createRoute({
  method: 'get',
  path: '/session',
  tags: ['Session'],
  summary: 'The signed-in user and their club memberships',
  responses: {
    200: {
      description: 'The current session',
      content: {'application/json': {schema: sessionResponseSchema}},
    },
    401: {
      description: 'Not signed in',
      content: {'application/json': {schema: errorSchema}},
    },
  },
});

export const sessionRoutes = new OpenAPIHono<AppEnv>();

sessionRoutes.use('/session', requireAuth);

sessionRoutes.openapi(getSessionRoute, async (c) => {
  // requireAuth guarantees this; the check keeps the type honest.
  const user = c.var.user;
  if (!user) {
    return c.json({error: 'Authentication required'}, 401);
  }

  const memberships = await listMemberships(user.id);

  return c.json(
    {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image ?? null,
      },
      memberships: memberships.map((membership) => ({
        ...membership,
        capabilities: [...capabilitiesFor(membership.role)],
      })),
    },
    200,
  );
});
