/**
 * Invitation routes.
 *
 * Two distinct audiences, and the split in authorization is the thing to
 * notice:
 *
 * - `/clubs/{clubId}/invitations` is the officer's side, gated by
 *   `requireCapability('member:invite')` like every other club-scoped route.
 * - `/invitations` and its accept/decline actions are the *recipient's* side.
 *   Those cannot be club-scoped, because the whole point is that the person
 *   answering is not in the club yet. They are gated by `requireAuth` and then
 *   matched on the session's email address.
 */

import {OpenAPIHono, createRoute, z} from '@hono/zod-openapi';
import {HTTPException} from 'hono/http-exception';
import {
  can,
  clubInvitationSchema,
  invitationDraftSchema,
} from '@cos/core';

import type {AppEnv} from '../auth/middleware.js';
import {requireAuth, requireCapability} from '../auth/middleware.js';
import {
  createInvitation,
  listClubInvitations,
  listPendingInvitationsFor,
  respondToInvitation,
} from '../members/invitation-store.js';

const invitationSchema = clubInvitationSchema.openapi('ClubInvitation');
const draftSchema = invitationDraftSchema.openapi('InvitationDraft');

const clubIdParam = z.object({
  clubId: z.string().openapi({param: {name: 'clubId', in: 'path'}}),
});

const invitationIdParam = z.object({
  invitationId: z.string().openapi({param: {name: 'invitationId', in: 'path'}}),
});

const errorSchema = z.object({error: z.string()}).openapi('InvitationError');

const errorResponses = {
  401: {
    description: 'Not signed in',
    content: {'application/json': {schema: errorSchema}},
  },
  403: {
    description: 'Signed in, but this role may not do that',
    content: {'application/json': {schema: errorSchema}},
  },
  404: {
    description: 'No such club or invitation, or the caller is not a member',
    content: {'application/json': {schema: errorSchema}},
  },
} as const;

const listClubRoute = createRoute({
  method: 'get',
  path: '/clubs/{clubId}/invitations',
  tags: ['Invitations'],
  summary: 'Invitations this club has sent, newest first',
  request: {params: clubIdParam},
  responses: {
    200: {
      description: 'The invitations',
      content: {'application/json': {schema: z.array(invitationSchema)}},
    },
    ...errorResponses,
  },
});

const createInvitationRoute = createRoute({
  method: 'post',
  path: '/clubs/{clubId}/invitations',
  tags: ['Invitations'],
  summary: 'Invite an email address to the club',
  request: {
    params: clubIdParam,
    body: {content: {'application/json': {schema: draftSchema}}},
  },
  responses: {
    201: {
      description: 'The created invitation',
      content: {'application/json': {schema: invitationSchema}},
    },
    409: {
      description: 'Already a member, or already invited and still pending',
      content: {'application/json': {schema: errorSchema}},
    },
    ...errorResponses,
  },
});

const listMineRoute = createRoute({
  method: 'get',
  path: '/invitations',
  tags: ['Invitations'],
  summary: 'Invitations waiting for the signed-in address, across every club',
  responses: {
    200: {
      description: 'Pending, unexpired invitations',
      content: {'application/json': {schema: z.array(invitationSchema)}},
    },
    401: errorResponses[401],
  },
});

const respondRoute = createRoute({
  method: 'post',
  path: '/invitations/{invitationId}/respond',
  tags: ['Invitations'],
  summary: 'Accept or decline an invitation addressed to you',
  request: {
    params: invitationIdParam,
    body: {
      content: {
        'application/json': {
          schema: z
            .object({decision: z.enum(['accepted', 'declined'])})
            .openapi('InvitationResponse'),
        },
      },
    },
  },
  responses: {
    204: {description: 'Recorded'},
    409: {
      description: 'Already answered, or expired',
      content: {'application/json': {schema: errorSchema}},
    },
    401: errorResponses[401],
    404: errorResponses[404],
  },
});

export const invitationRoutes = new OpenAPIHono<AppEnv>();

// The officer's side: club-scoped, capability-gated, exactly like events.
invitationRoutes.use(
  '/clubs/:clubId/invitations',
  requireCapability('member:view'),
);
invitationRoutes.use('/invitations', requireAuth);
invitationRoutes.use('/invitations/:invitationId/respond', requireAuth);

invitationRoutes.openapi(listClubRoute, async (c) => {
  const {clubId} = c.req.valid('param');
  return c.json(await listClubInvitations(clubId), 200);
});

invitationRoutes.openapi(createInvitationRoute, async (c) => {
  const user = c.var.user;
  if (!user) {
    throw new HTTPException(401, {message: 'Authentication required'});
  }

  // Capability is checked here rather than in middleware because listing and
  // creating share a path and need different capabilities: a member may see
  // who has been invited, only an officer may invite.
  const membership = c.var.membership;
  if (!membership || !can(membership.role, 'member:invite')) {
    throw new HTTPException(403, {
      message: 'Your role in this club may not member:invite',
    });
  }

  const {clubId} = c.req.valid('param');
  const draft = c.req.valid('json');

  const result = await createInvitation(clubId, draft, user.id);

  if ('error' in result) {
    throw new HTTPException(409, {
      message:
        result.error === 'already-a-member'
          ? 'That person is already in this club'
          : 'That address already has a pending invitation',
    });
  }

  return c.json(result.invitation, 201);
});

invitationRoutes.openapi(listMineRoute, async (c) => {
  const user = c.var.user;
  if (!user) {
    throw new HTTPException(401, {message: 'Authentication required'});
  }
  return c.json(await listPendingInvitationsFor(user.email), 200);
});

invitationRoutes.openapi(respondRoute, async (c) => {
  const user = c.var.user;
  if (!user) {
    throw new HTTPException(401, {message: 'Authentication required'});
  }

  const {invitationId} = c.req.valid('param');
  const {decision} = c.req.valid('json');

  const result = await respondToInvitation(
    invitationId,
    user.id,
    user.email,
    decision,
  );

  if ('error' in result) {
    throw result.error === 'not-found'
      ? new HTTPException(404, {message: 'No such invitation'})
      : new HTTPException(409, {message: 'That invitation is no longer open'});
  }

  return c.body(null, 204);
});
