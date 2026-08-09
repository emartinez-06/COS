/**
 * Presence routes.
 *
 * Two audiences, and they need different authorization, exactly like
 * invitations:
 *
 * - `PUT /api/presence` is about **yourself**. It is gated on `requireAuth`
 *   and takes its subject from the session, never from the body - the only
 *   person whose presence you may report is you, and a `userId` parameter here
 *   would be an invitation to set someone else's.
 * - `GET /api/clubs/{clubId}/presence` is about a **club's roster**, so it is
 *   gated on `member:view`, the capability every role already holds for
 *   exactly this: seeing who else is in your club.
 *
 * The status itself is never stored. Rows hold a heartbeat and an optional
 * choice, and `resolvePresence` in @cos/core turns those into active / idle /
 * dnd / offline at read time. Storing a resolved status would mean a row that
 * says "active" long after the browser stopped talking to us, and something
 * would have to sweep the table to correct it.
 */

import {OpenAPIHono, createRoute, z} from '@hono/zod-openapi';
import {HTTPException} from 'hono/http-exception';
import {
  memberPresenceSchema,
  presenceUpdateSchema,
  resolvePresence,
} from '@cos/core';

import type {AppEnv} from '../auth/middleware.js';
import {requireAuth, requireCapability} from '../auth/middleware.js';
import {
  findPresence,
  listClubPresence,
  recordHeartbeat,
} from '../presence/presence-store.js';

const memberPresenceOut = memberPresenceSchema.openapi('MemberPresence');

const presenceUpdateIn = presenceUpdateSchema.openapi('PresenceUpdate');

const ownPresenceOut = z
  .object({
    status: memberPresenceSchema.shape.status,
    manualStatus: presenceUpdateSchema.shape.manualStatus,
  })
  .openapi('OwnPresence');

export const presenceRoutes = new OpenAPIHono<AppEnv>();

/**
 * The heartbeat.
 *
 * `PUT` rather than `POST` because it is idempotent - sending the same body
 * twice leaves the same single row, and there is no new resource created by
 * the second call. It answers with the caller's own resolved status so the
 * browser can reflect a change immediately rather than waiting for the next
 * roster poll to tell it what it just said.
 */
presenceRoutes.openapi(
  createRoute({
    method: 'put',
    path: '/presence',
    tags: ['Presence'],
    summary: 'Record that you are here, and optionally set your status',
    middleware: [requireAuth] as const,
    request: {
      body: {
        content: {'application/json': {schema: presenceUpdateIn}},
        required: false,
      },
    },
    responses: {
      200: {
        description: 'Your presence as it now stands',
        content: {'application/json': {schema: ownPresenceOut}},
      },
      401: {description: 'Not signed in'},
    },
  }),
  async (c) => {
    // `requireAuth` has already rejected an anonymous caller; this narrows the
    // nullable session variable, matching how the invitation routes do it.
    const user = c.var.user;
    if (!user) {
      throw new HTTPException(401, {message: 'Authentication required'});
    }

    // The body is optional, so a bare heartbeat can be sent with no payload at
    // all. An absent body means "say nothing about my choice", which is the
    // same as an absent field.
    const body = c.req.valid('json') ?? {};

    await recordHeartbeat(user.id, body.manualStatus);

    const record = await findPresence(user.id);

    return c.json(
      {
        status: record
          ? resolvePresence(record)
          : ('offline' as const),
        manualStatus: record?.manualStatus ?? null,
      },
      200,
    );
  },
);

/**
 * The club's roster, with everyone's status resolved.
 *
 * Resolved here rather than in the browser so that every client - including a
 * future bot answering "who is around?" - gets the same answer without
 * reimplementing the windows. The raw `lastSeenAt` still goes out, because
 * "active" and "last seen 40 seconds ago" are different amounts of
 * information and the UI may want the second.
 */
presenceRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/clubs/{clubId}/presence',
    tags: ['Presence'],
    summary: "Who is around in this club",
    middleware: [requireCapability('member:view')] as const,
    request: {
      params: z.object({clubId: z.string().openapi({example: 'club_baylor_acm'})}),
    },
    responses: {
      200: {
        description: 'Every member of the club and their current status',
        content: {'application/json': {schema: z.array(memberPresenceOut)}},
      },
      401: {description: 'Not signed in'},
      404: {description: 'No such club, or you are not in it'},
    },
  }),
  async (c) => {
    const {clubId} = c.req.valid('param');
    const rows = await listClubPresence(clubId);

    // One `now` for the whole roster. Calling `new Date()` per row would let a
    // slow query resolve the first and last members against different instants
    // - harmless in practice, and the kind of thing that makes a test flake.
    const now = new Date();

    return c.json(
      rows.map((row) => ({
        userId: row.userId,
        name: row.name,
        image: row.image,
        status: resolvePresence(row, now),
        lastSeenAt: row.lastSeenAt,
      })),
      200,
    );
  },
);
