/**
 * Club event routes.
 *
 * These are the first routes to enforce capabilities server-side. Every one of
 * them sits behind `requireCapability`, which reads the caller's role from
 * `club_members` for the `clubId` in the path and asks `can()` in @cos/core.
 *
 * The capability strings here are the same ones the calendar UI passes to
 * `useCan`. The client check decides whether to draw a button; this one
 * decides whether anything happens.
 */

import {OpenAPIHono, createRoute, z} from '@hono/zod-openapi';
import {clubEventSchema, eventDraftSchema} from '@cos/core';
import {HTTPException} from 'hono/http-exception';

import type {AppEnv} from '../auth/middleware.js';
import {requireCapability} from '../auth/middleware.js';
import {
  createEvent,
  deleteEvent,
  listEvents,
  updateEvent,
} from '../events/event-store.js';

// Reused straight from @cos/core, so the documented contract is the domain
// model rather than a copy of it that can drift.
const eventSchema = clubEventSchema.openapi('ClubEvent');
const draftSchema = eventDraftSchema.openapi('EventDraft');

/**
 * Every field optional: a patch changes only what it names.
 *
 * Derived from `clubEventSchema` rather than from `eventDraftSchema` because
 * the draft carries an "end must be after start" refinement that assumes both
 * fields are present. Reusing it here would reject a patch that renames an
 * event and touches neither time. The rule is reinstated below for the case it
 * actually applies to.
 */
const patchSchema = clubEventSchema
  .pick({
    title: true,
    description: true,
    startsAt: true,
    endsAt: true,
    location: true,
    speaker: true,
    links: true,
    category: true,
    visibility: true,
  })
  .partial()
  .refine(
    (patch) =>
      patch.startsAt === undefined ||
      patch.endsAt === undefined ||
      new Date(patch.endsAt) > new Date(patch.startsAt),
    {
      message: 'End time must be after the start time',
      path: ['endsAt'],
    },
  )
  .openapi('EventPatch');

const clubIdParam = z.object({
  clubId: z.string().openapi({param: {name: 'clubId', in: 'path'}}),
});

const eventParams = z.object({
  clubId: z.string().openapi({param: {name: 'clubId', in: 'path'}}),
  eventId: z.string().openapi({param: {name: 'eventId', in: 'path'}}),
});

const errorSchema = z.object({error: z.string()}).openapi('ApiError');

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
    description: 'No such club or event, or the caller is not a member',
    content: {'application/json': {schema: errorSchema}},
  },
} as const;

const listRoute = createRoute({
  method: 'get',
  path: '/clubs/{clubId}/events',
  tags: ['Events'],
  summary: "A club's events, earliest first",
  request: {params: clubIdParam},
  responses: {
    200: {
      description: 'The events',
      content: {'application/json': {schema: z.array(eventSchema)}},
    },
    ...errorResponses,
  },
});

const createRouteDef = createRoute({
  method: 'post',
  path: '/clubs/{clubId}/events',
  tags: ['Events'],
  summary: 'Create an event',
  request: {
    params: clubIdParam,
    body: {content: {'application/json': {schema: draftSchema}}},
  },
  responses: {
    201: {
      description: 'The created event',
      content: {'application/json': {schema: eventSchema}},
    },
    ...errorResponses,
  },
});

const updateRouteDef = createRoute({
  method: 'patch',
  path: '/clubs/{clubId}/events/{eventId}',
  tags: ['Events'],
  summary: 'Update an event',
  request: {
    params: eventParams,
    body: {content: {'application/json': {schema: patchSchema}}},
  },
  responses: {
    200: {
      description: 'The updated event',
      content: {'application/json': {schema: eventSchema}},
    },
    ...errorResponses,
  },
});

const deleteRouteDef = createRoute({
  method: 'delete',
  path: '/clubs/{clubId}/events/{eventId}',
  tags: ['Events'],
  summary: 'Delete an event',
  request: {params: eventParams},
  responses: {
    204: {description: 'Deleted'},
    ...errorResponses,
  },
});

export const eventRoutes = new OpenAPIHono<AppEnv>();

// The capability gate for each route. Registered before the handlers so a
// handler can never run for a caller who was not authorized.
eventRoutes.use('/clubs/:clubId/events', async (c, next) => {
  const gate =
    c.req.method === 'POST'
      ? requireCapability('event:create')
      : requireCapability('event:view');
  return gate(c, next);
});

eventRoutes.use('/clubs/:clubId/events/:eventId', async (c, next) => {
  const gate =
    c.req.method === 'DELETE'
      ? requireCapability('event:delete')
      : c.req.method === 'PATCH'
        ? requireCapability('event:edit')
        : requireCapability('event:view');
  return gate(c, next);
});

eventRoutes.openapi(listRoute, async (c) => {
  const {clubId} = c.req.valid('param');
  return c.json(await listEvents(clubId), 200);
});

eventRoutes.openapi(createRouteDef, async (c) => {
  const {clubId} = c.req.valid('param');
  const draft = c.req.valid('json');

  const user = c.var.user;
  if (!user) {
    throw new HTTPException(401, {message: 'Authentication required'});
  }

  return c.json(await createEvent(clubId, draft, user.id), 201);
});

eventRoutes.openapi(updateRouteDef, async (c) => {
  const {clubId, eventId} = c.req.valid('param');
  const patch = c.req.valid('json');

  const updated = await updateEvent(clubId, eventId, patch);
  if (!updated) {
    throw new HTTPException(404, {message: 'Event not found'});
  }

  return c.json(updated, 200);
});

eventRoutes.openapi(deleteRouteDef, async (c) => {
  const {clubId, eventId} = c.req.valid('param');

  if (!(await deleteEvent(clubId, eventId))) {
    throw new HTTPException(404, {message: 'Event not found'});
  }

  return c.body(null, 204);
});
