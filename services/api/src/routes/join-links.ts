/**
 * Join link routes.
 *
 * Three audiences:
 *
 * - `/clubs/{clubId}/join-links` is the officer's side, and unlike
 *   invitations.ts, *listing* is gated the same as creating and revoking -
 *   `requireCapability('member:invite')` for all three. An invitation only
 *   names who was asked, which is safe for any member to see
 *   (`member:view`); a join link *is* the bearer credential, so exposing the
 *   list to every member would hand out live, possibly admin-granting URLs
 *   to people who were never meant to have them.
 * - `GET /join-links/{token}` is the **public** preview - deliberately no
 *   auth at all, since the whole point is that someone sees this before they
 *   have an account.
 * - `POST /join-links/{token}/accept` requires a session (the person has to
 *   have signed up or signed in first) but is not club-scoped, matching
 *   `/invitations/{id}/respond` - the token in the URL is the authorization,
 *   not the caller's existing relationship to the club.
 */

import {OpenAPIHono, createRoute, z} from '@hono/zod-openapi';
import {HTTPException} from 'hono/http-exception';
import {clubJoinLinkSchema, joinLinkDraftSchema, joinLinkPreviewSchema} from '@cos/core';

import type {AppEnv} from '../auth/middleware.js';
import {requireAuth, requireCapability} from '../auth/middleware.js';
import {
  acceptJoinLink,
  createJoinLink,
  listClubJoinLinks,
  previewJoinLink,
  revokeJoinLink,
} from '../members/join-link-store.js';

const joinLinkSchema = clubJoinLinkSchema.openapi('ClubJoinLink');
const draftSchema = joinLinkDraftSchema.openapi('JoinLinkDraft');
const previewSchema = joinLinkPreviewSchema.openapi('JoinLinkPreview');

const clubIdParam = z.object({
  clubId: z.string().openapi({param: {name: 'clubId', in: 'path'}}),
});

const linkIdParam = z.object({
  clubId: z.string().openapi({param: {name: 'clubId', in: 'path'}}),
  linkId: z.string().openapi({param: {name: 'linkId', in: 'path'}}),
});

const tokenParam = z.object({
  token: z.string().openapi({param: {name: 'token', in: 'path'}}),
});

const errorSchema = z.object({error: z.string()}).openapi('JoinLinkError');

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
    description: 'No such club, link, or caller is not a member',
    content: {'application/json': {schema: errorSchema}},
  },
} as const;

const listRoute = createRoute({
  method: 'get',
  path: '/clubs/{clubId}/join-links',
  tags: ['Join links'],
  summary: 'Join links this club has created, newest first',
  request: {params: clubIdParam},
  responses: {
    200: {
      description: 'The links',
      content: {'application/json': {schema: z.array(joinLinkSchema)}},
    },
    ...errorResponses,
  },
});

const createRouteDef = createRoute({
  method: 'post',
  path: '/clubs/{clubId}/join-links',
  tags: ['Join links'],
  summary: 'Create a link anyone can use to join this club, for a limited time',
  request: {
    params: clubIdParam,
    body: {content: {'application/json': {schema: draftSchema}}},
  },
  responses: {
    201: {
      description: 'The created link',
      content: {'application/json': {schema: joinLinkSchema}},
    },
    ...errorResponses,
  },
});

const revokeRoute = createRoute({
  method: 'post',
  path: '/clubs/{clubId}/join-links/{linkId}/revoke',
  tags: ['Join links'],
  summary: 'Stop a link from working before it expires',
  request: {params: linkIdParam},
  responses: {
    204: {description: 'Revoked'},
    ...errorResponses,
  },
});

const previewRoute = createRoute({
  method: 'get',
  path: '/join-links/{token}',
  tags: ['Join links'],
  summary: 'What a join link grants, for someone who has not signed in yet',
  request: {params: tokenParam},
  responses: {
    200: {
      description: 'The link is active',
      content: {'application/json': {schema: previewSchema}},
    },
    404: {
      description: 'No such link, or it has expired or been revoked',
      content: {'application/json': {schema: errorSchema}},
    },
  },
});

const acceptRoute = createRoute({
  method: 'post',
  path: '/join-links/{token}/accept',
  tags: ['Join links'],
  summary: 'Join the club a link points at, as the signed-in user',
  request: {params: tokenParam},
  responses: {
    200: {
      description: 'A member of the club, whether newly joined or already one',
      content: {
        'application/json': {
          schema: z
            .object({clubId: z.string(), clubName: z.string()})
            .openapi('JoinLinkAccepted'),
        },
      },
    },
    404: {
      description: 'No such link, or it has expired or been revoked',
      content: {'application/json': {schema: errorSchema}},
    },
    401: errorResponses[401],
  },
});

export const joinLinkRoutes = new OpenAPIHono<AppEnv>();

joinLinkRoutes.use(
  '/clubs/:clubId/join-links',
  requireCapability('member:invite'),
);
joinLinkRoutes.use(
  '/clubs/:clubId/join-links/:linkId/revoke',
  requireCapability('member:invite'),
);
joinLinkRoutes.use('/join-links/:token/accept', requireAuth);

joinLinkRoutes.openapi(listRoute, async (c) => {
  const {clubId} = c.req.valid('param');
  return c.json(await listClubJoinLinks(clubId), 200);
});

joinLinkRoutes.openapi(createRouteDef, async (c) => {
  const {clubId} = c.req.valid('param');
  const draft = c.req.valid('json');
  const user = c.var.user;
  if (!user) {
    throw new HTTPException(401, {message: 'Authentication required'});
  }

  return c.json(await createJoinLink(clubId, draft, user.id), 201);
});

joinLinkRoutes.openapi(revokeRoute, async (c) => {
  const {clubId, linkId} = c.req.valid('param');
  const result = await revokeJoinLink(clubId, linkId);
  if ('error' in result) {
    throw new HTTPException(404, {message: 'No such join link'});
  }

  return c.body(null, 204);
});

joinLinkRoutes.openapi(previewRoute, async (c) => {
  const {token} = c.req.valid('param');
  const preview = await previewJoinLink(token);
  if (!preview) {
    throw new HTTPException(404, {message: 'This link is no longer valid'});
  }
  return c.json(preview, 200);
});

joinLinkRoutes.openapi(acceptRoute, async (c) => {
  const user = c.var.user;
  if (!user) {
    throw new HTTPException(401, {message: 'Authentication required'});
  }

  const {token} = c.req.valid('param');
  const result = await acceptJoinLink(token, user.id);
  if ('error' in result) {
    throw new HTTPException(404, {message: 'This link is no longer valid'});
  }

  return c.json(result, 200);
});
