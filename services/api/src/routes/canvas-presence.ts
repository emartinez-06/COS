/**
 * Live canvas presence: a short-lived ticket, and the WebSocket it unlocks.
 *
 * The ticket route (`POST .../presence-ticket`) is an ordinary
 * `requireCapability('canvas:view')`-gated route, same as everything in
 * `canvas.ts` - the session cookie works fine for a plain `fetch`.
 *
 * The socket route (`GET .../presence-ws`) is deliberately **not** behind
 * `requireCapability`. The browser's native `WebSocket` constructor cannot
 * set `credentials` or custom headers the way `fetch` can, and this
 * repo already hit the analogous cross-origin cookie gap once for canvas
 * image downloads (see `canvas-image-node.tsx`) - a WebSocket handshake is in
 * the same risk class, not the `apiFetch` one. So this route trusts nothing
 * but the ticket: it is minted over a normal cookie-authenticated request,
 * single-use, and expires in seconds. Authorization for the socket itself is
 * the membership + `canvas:view` check performed right after the ticket is
 * consumed, re-run on a timer for as long as the socket stays open.
 */

import {upgradeWebSocket} from '@hono/node-server';
import {OpenAPIHono, createRoute, z} from '@hono/zod-openapi';
import {can, canvasPresenceClientMessageSchema} from '@cos/core';
import type {CanvasPresenceServerMessage} from '@cos/core';
import {HTTPException} from 'hono/http-exception';

import {findMembershipForPresence} from '../auth/membership.js';
import type {AppEnv} from '../auth/middleware.js';
import {requireCapability} from '../auth/middleware.js';
import {
  consumeTicket,
  join,
  leave,
  mintTicket,
  positionColorFor,
  setNode,
  snapshot,
} from '../canvas/canvas-presence.js';
import {env} from '../env.js';

export const canvasPresenceRoutes = new OpenAPIHono<AppEnv>();

const clubIdParam = z.object({
  clubId: z.string().openapi({param: {name: 'clubId', in: 'path'}}),
});

const errorSchema = z.object({error: z.string()}).openapi('ApiError');

const ticketOut = z
  .object({ticket: z.string()})
  .openapi('CanvasPresenceTicket');

const mintTicketRoute = createRoute({
  method: 'post',
  path: '/clubs/{clubId}/canvas/presence-ticket',
  tags: ['Canvas'],
  summary: 'Mint a short-lived ticket to open the canvas presence socket',
  request: {params: clubIdParam},
  responses: {
    201: {
      description: 'The ticket, valid for a few seconds and single-use',
      content: {'application/json': {schema: ticketOut}},
    },
    401: {
      description: 'Not signed in',
      content: {'application/json': {schema: errorSchema}},
    },
    403: {
      description: 'Signed in, but this role may not view the canvas',
      content: {'application/json': {schema: errorSchema}},
    },
    404: {
      description: 'No such club, or the caller is not a member',
      content: {'application/json': {schema: errorSchema}},
    },
  },
});

canvasPresenceRoutes.use(
  '/clubs/:clubId/canvas/presence-ticket',
  requireCapability('canvas:view'),
);

canvasPresenceRoutes.openapi(mintTicketRoute, (c) => {
  const {clubId} = c.req.valid('param');
  // requireCapability has already confirmed c.var.user is set.
  const userId = c.var.user?.id;
  if (!userId) {
    throw new HTTPException(401, {message: 'Authentication required'});
  }
  return c.json({ticket: mintTicket(userId, clubId)}, 201);
});

/**
 * How often an open socket re-proves it is still allowed to be open. Matches
 * the reasoning in `docs/COLLABORATIVE-EDITING.md`: a capability check at
 * connect time alone is insufficient because membership can be revoked while
 * the socket is open. Also doubles as the liveness check for a connection
 * whose TCP stream died without a clean close frame - `ws.readyState` is
 * checked on the same tick, closing out anything not actually open anymore.
 */
const MEMBERSHIP_RECHECK_MS = 30_000;

const WS_OPEN = 1;

canvasPresenceRoutes.get(
  '/clubs/:clubId/canvas/presence-ws',
  upgradeWebSocket(async (c) => {
    // `c.req.param` isn't typed off this route's path literal inside
    // `upgradeWebSocket`'s own handler signature the way it is in a plain
    // `.get()` handler, so it comes back possibly-undefined here.
    const clubId = c.req.param('clubId');
    if (!clubId) {
      throw new HTTPException(400, {message: 'Missing club id'});
    }

    const origin = c.req.raw.headers.get('Origin');
    if (!origin || !env.WEB_ORIGINS.includes(origin)) {
      throw new HTTPException(403, {message: 'Origin not allowed'});
    }

    const ticket = c.req.query('ticket');
    const consumed = ticket ? consumeTicket(ticket, clubId) : null;
    if (!consumed) {
      throw new HTTPException(401, {message: 'Invalid or expired ticket'});
    }

    const membership = await findMembershipForPresence(
      consumed.userId,
      clubId,
    );
    if (!membership || !can(membership.role, 'canvas:view')) {
      throw new HTTPException(403, {
        message: 'Your role in this club may not view the canvas',
      });
    }

    const connectionId = crypto.randomUUID();
    const positionColor = positionColorFor(membership.position);
    let recheckTimer: ReturnType<typeof setInterval> | undefined;

    return {
      onOpen(_evt, ws) {
        join(clubId, connectionId, {
          ws,
          userId: consumed.userId,
          name: membership.name,
          positionColor,
          currentNodeId: null,
        });

        const snapshotMessage: CanvasPresenceServerMessage = {
          type: 'snapshot',
          entries: snapshot(clubId, connectionId),
        };
        ws.send(JSON.stringify(snapshotMessage));

        recheckTimer = setInterval(() => {
          void (async () => {
            if (ws.readyState !== WS_OPEN) {
              clearInterval(recheckTimer);
              return;
            }
            const stillMember = await findMembershipForPresence(
              consumed.userId,
              clubId,
            );
            if (!stillMember || !can(stillMember.role, 'canvas:view')) {
              ws.close(4001, 'Membership revoked');
            }
          })();
        }, MEMBERSHIP_RECHECK_MS);
      },
      onMessage(evt) {
        if (typeof evt.data !== 'string') {
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(evt.data);
        } catch {
          return;
        }
        const result = canvasPresenceClientMessageSchema.safeParse(parsed);
        if (!result.success) {
          return;
        }
        setNode(
          clubId,
          connectionId,
          result.data.type === 'select' ? result.data.nodeId : null,
        );
      },
      onClose() {
        clearInterval(recheckTimer);
        leave(clubId, connectionId);
      },
      onError() {
        clearInterval(recheckTimer);
        leave(clubId, connectionId);
      },
    };
  }),
);

canvasPresenceRoutes.openAPIRegistry.registerPath({
  method: 'get',
  path: '/clubs/{clubId}/canvas/presence-ws',
  tags: ['Canvas'],
  summary: 'Live canvas presence (WebSocket upgrade)',
  description:
    'Upgrades to a WebSocket carrying which node each connected officer has ' +
    'selected. Authenticated by a `?ticket=` query param minted from ' +
    'POST .../presence-ticket, not by the session cookie.',
  request: {params: clubIdParam},
  responses: {
    101: {description: 'Switching Protocols'},
    401: {
      description: 'Missing, invalid, or expired ticket',
      content: {'application/json': {schema: errorSchema}},
    },
    403: {
      description: 'Origin not allowed, or this role may not view the canvas',
      content: {'application/json': {schema: errorSchema}},
    },
  },
});
