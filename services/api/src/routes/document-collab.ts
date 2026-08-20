/**
 * Live collaborative document editing: a short-lived ticket, and the
 * WebSocket it unlocks.
 *
 * Same shape as `routes/canvas-presence.ts`, including the reasoning for why
 * the socket route trusts a ticket rather than the session cookie (a native
 * `WebSocket` cannot set `credentials`), and re-checks membership on a
 * timer rather than only at connect time. Two things differ from canvas
 * presence, both because a document is not a club-wide board:
 *
 * - **A connection is read-only or read-write**, decided once at connect
 *   time from the caller's actual `document:edit` capability - never
 *   trusted from the client - and enforced again on every sync frame the
 *   server receives, not just at connect.
 * - **Draft visibility must hold on the socket exactly as it holds over
 *   REST.** `canSeeDraftDocuments` gates both the ticket mint and the
 *   membership recheck, so a member can never open a live view of a draft
 *   they could not otherwise read - `docs/COLLABORATIVE-EDITING.md` names
 *   this risk explicitly.
 */

import {upgradeWebSocket} from '@hono/node-server';
import {OpenAPIHono, createRoute, z} from '@hono/zod-openapi';
import {
  DOCUMENT_COLLAB_FRAME_TYPE,
  can,
  canSeeDraftDocuments,
  decodeCollabFrame,
  encodeCollabFrame,
} from '@cos/core';
import {HTTPException} from 'hono/http-exception';

import {findMembershipForPresence} from '../auth/membership.js';
import type {AppEnv} from '../auth/middleware.js';
import {requireCapability} from '../auth/middleware.js';
import {
  applyUpdate,
  consumeTicket,
  currentStateUpdate,
  getOrCreateSession,
  join,
  leave,
  mintTicket,
  relayAwareness,
} from '../documents/document-collab.js';
import {findDocument} from '../documents/document-store.js';
import {env} from '../env.js';

export const documentCollabRoutes = new OpenAPIHono<AppEnv>();

const documentParams = z.object({
  clubId: z.string().openapi({param: {name: 'clubId', in: 'path'}}),
  documentId: z.string().openapi({param: {name: 'documentId', in: 'path'}}),
});

const errorSchema = z.object({error: z.string()}).openapi('ApiError');

const ticketOut = z
  .object({ticket: z.string()})
  .openapi('DocumentCollabTicket');

const mintTicketRoute = createRoute({
  method: 'post',
  path: '/clubs/{clubId}/documents/{documentId}/collab-ticket',
  tags: ['Documents'],
  summary: 'Mint a short-lived ticket to open the live editing socket',
  request: {params: documentParams},
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
      description: 'Signed in, but this role may not view the document',
      content: {'application/json': {schema: errorSchema}},
    },
    404: {
      description:
        'No such document, the caller is not a member of the club, or ' +
        'the document is a draft this role may not see',
      content: {'application/json': {schema: errorSchema}},
    },
  },
});

documentCollabRoutes.use(
  '/clubs/:clubId/documents/:documentId/collab-ticket',
  requireCapability('document:view'),
);

documentCollabRoutes.openapi(mintTicketRoute, async (c) => {
  const {clubId, documentId} = c.req.valid('param');
  const userId = c.var.user?.id;
  const role = c.var.membership?.role;
  if (!userId || !role) {
    throw new HTTPException(401, {message: 'Authentication required'});
  }

  // Mirrors the REST route's own scoping: a live session is exactly as
  // visible as the document itself.
  const document = await findDocument(clubId, documentId, {
    includeDrafts: canSeeDraftDocuments(role),
  });
  if (!document) {
    throw new HTTPException(404, {message: 'Document not found'});
  }
  if (document.kind !== 'text') {
    throw new HTTPException(400, {
      message: 'Only authored text documents support live collaboration',
    });
  }

  return c.json({ticket: mintTicket(userId, clubId, documentId)}, 201);
});

/** Matches `MEMBERSHIP_RECHECK_MS` in `canvas-presence.ts` - see its comment. */
const MEMBERSHIP_RECHECK_MS = 30_000;

const WS_OPEN = 1;

documentCollabRoutes.get(
  '/clubs/:clubId/documents/:documentId/collab-ws',
  upgradeWebSocket(async (c) => {
    const clubId = c.req.param('clubId');
    const documentId = c.req.param('documentId');
    if (!clubId || !documentId) {
      throw new HTTPException(400, {message: 'Missing club or document id'});
    }

    const origin = c.req.raw.headers.get('Origin');
    if (!origin || !env.WEB_ORIGINS.includes(origin)) {
      throw new HTTPException(403, {message: 'Origin not allowed'});
    }

    const ticket = c.req.query('ticket');
    const consumed = ticket ? consumeTicket(ticket, clubId, documentId) : null;
    if (!consumed) {
      throw new HTTPException(401, {message: 'Invalid or expired ticket'});
    }

    const membership = await findMembershipForPresence(
      consumed.userId,
      clubId,
    );
    if (!membership || !can(membership.role, 'document:view')) {
      throw new HTTPException(403, {
        message: 'Your role in this club may not view this document',
      });
    }

    const document = await findDocument(clubId, documentId, {
      includeDrafts: canSeeDraftDocuments(membership.role),
    });
    if (!document || document.kind !== 'text') {
      throw new HTTPException(404, {message: 'Document not found'});
    }

    const canEdit = can(membership.role, 'document:edit');
    const connectionId = crypto.randomUUID();
    let recheckTimer: ReturnType<typeof setInterval> | undefined;

    return {
      async onOpen(_evt, ws) {
        const session = await getOrCreateSession(clubId, documentId);
        join(documentId, connectionId, {ws, userId: consumed.userId, canEdit});

        ws.send(
          encodeCollabFrame(
            DOCUMENT_COLLAB_FRAME_TYPE.sync,
            currentStateUpdate(session),
          ),
        );

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
            const stillVisible =
              stillMember &&
              (await findDocument(clubId, documentId, {
                includeDrafts: canSeeDraftDocuments(stillMember.role),
              }));
            if (
              !stillMember ||
              !can(stillMember.role, 'document:view') ||
              !stillVisible
            ) {
              ws.close(4001, 'No longer allowed to view this document');
            }
          })();
        }, MEMBERSHIP_RECHECK_MS);
      },
      onMessage(evt) {
        if (typeof evt.data === 'string' || !canEdit) {
          // A read-only connection's client never sends a frame in the
          // first place (its editor mounts non-editable) - this is defense
          // in depth against a client that does anyway, not the primary
          // guard.
          return;
        }
        // The `ws` package (what `@hono/node-server` delegates to) always
        // delivers a binary frame as a Node `Buffer`, which already is a
        // `Uint8Array` - no copy needed. The `ArrayBuffer` branch is dead in
        // practice here but keeps this correct if that ever changes.
        const bytes =
          evt.data instanceof Uint8Array
            ? evt.data
            : new Uint8Array(evt.data as ArrayBuffer);
        let decoded: {type: number; payload: Uint8Array};
        try {
          decoded = decodeCollabFrame(bytes);
        } catch {
          return;
        }
        if (decoded.type === DOCUMENT_COLLAB_FRAME_TYPE.sync) {
          void applyUpdate(
            documentId,
            decoded.payload,
            consumed.userId,
            connectionId,
          );
        } else if (decoded.type === DOCUMENT_COLLAB_FRAME_TYPE.awareness) {
          relayAwareness(documentId, decoded.payload, connectionId);
        }
      },
      onClose() {
        clearInterval(recheckTimer);
        leave(documentId, connectionId);
      },
      onError() {
        clearInterval(recheckTimer);
        leave(documentId, connectionId);
      },
    };
  }),
);

documentCollabRoutes.openAPIRegistry.registerPath({
  method: 'get',
  path: '/clubs/{clubId}/documents/{documentId}/collab-ws',
  tags: ['Documents'],
  summary: 'Live collaborative editing (WebSocket upgrade)',
  description:
    'Upgrades to a WebSocket carrying Yjs sync and awareness frames for one ' +
    'text document. Authenticated by a `?ticket=` query param minted from ' +
    'POST .../collab-ticket, not by the session cookie.',
  request: {params: documentParams},
  responses: {
    101: {description: 'Switching Protocols'},
    401: {
      description: 'Missing, invalid, or expired ticket',
      content: {'application/json': {schema: errorSchema}},
    },
    403: {
      description: 'Origin not allowed, or this role may not view the document',
      content: {'application/json': {schema: errorSchema}},
    },
    404: {
      description: 'No such document, or it is a draft this role may not see',
      content: {'application/json': {schema: errorSchema}},
    },
  },
});
