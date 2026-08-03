/**
 * Treasury routes.
 *
 * Every one sits behind `requireCapability` with an `expense:*` capability -
 * the same strings the UI passes to `useCan`. Until this file existed those
 * capabilities were enforced only in the browser, which is fine for a page that
 * renders a placeholder and is not fine for one that holds a club's money.
 *
 * The treasury is officer-only **including read**, unlike the document hub.
 * `expense:view` is what the sidebar gates on, so granting it to members would
 * also put the section in front of everyone.
 *
 * Note what is absent: any endpoint that returns a balance. The three numbers
 * are folded from these lists by `summarizeFund` in @cos/core, so there is one
 * implementation of that arithmetic rather than one here and one in the
 * browser that eventually disagree.
 */

import {OpenAPIHono, createRoute, z} from '@hono/zod-openapi';
import {
  expenseRequestDraftSchema,
  expenseRequestPatchSchema,
  expenseRequestSchema,
  fundAllocationDraftSchema,
  fundAllocationSchema,
  fundDraftSchema,
  fundPatchSchema,
  fundSchema,
  requestStatusSchema,
} from '@cos/core';
import type {Capability} from '@cos/core';
import {HTTPException} from 'hono/http-exception';

import type {AppEnv} from '../auth/middleware.js';
import {requireCapability} from '../auth/middleware.js';
import {
  ClosedFundError,
  RequestNotDraftError,
  UnknownEventError,
  UnknownFundError,
  allocate,
  createFund,
  createRequest,
  deleteRequest,
  listAllocations,
  listFunds,
  listRequests,
  updateFund,
  updateRequest,
} from '../treasury/treasury-store.js';

const fundOut = fundSchema.openapi('Fund');
const allocationOut = fundAllocationSchema.openapi('FundAllocation');
const requestOut = expenseRequestSchema.openapi('ExpenseRequest');

const fundDraftIn = fundDraftSchema.openapi('FundDraft');
const fundPatchIn = fundPatchSchema.openapi('FundPatch');
const allocationDraftIn = fundAllocationDraftSchema.openapi(
  'FundAllocationDraft',
);

/**
 * A request may be created already submitted.
 *
 * The common path is a treasurer recording something they have already sent to
 * the university rather than drafting it here first, so forcing every request
 * to be born a draft and immediately patched would add a round trip to model a
 * step that did not happen.
 */
const requestDraftIn = expenseRequestDraftSchema
  .extend({
    status: requestStatusSchema.default('draft'),
  })
  .openapi('ExpenseRequestDraft');

const requestPatchIn = expenseRequestPatchSchema.openapi('ExpenseRequestPatch');

const clubIdParam = z.object({
  clubId: z.string().openapi({param: {name: 'clubId', in: 'path'}}),
});

const fundParams = z.object({
  clubId: z.string().openapi({param: {name: 'clubId', in: 'path'}}),
  fundId: z.string().openapi({param: {name: 'fundId', in: 'path'}}),
});

const requestParams = z.object({
  clubId: z.string().openapi({param: {name: 'clubId', in: 'path'}}),
  requestId: z.string().openapi({param: {name: 'requestId', in: 'path'}}),
});

const errorSchema = z.object({error: z.string()}).openapi('ApiError');

const errorResponses = {
  400: {
    description: 'The request names a fund or event that cannot be used',
    content: {'application/json': {schema: errorSchema}},
  },
  401: {
    description: 'Not signed in',
    content: {'application/json': {schema: errorSchema}},
  },
  403: {
    description: 'Signed in, but this role may not do that',
    content: {'application/json': {schema: errorSchema}},
  },
  404: {
    description: 'No such club or record, or the caller is not a member',
    content: {'application/json': {schema: errorSchema}},
  },
} as const;

const listFundsRoute = createRoute({
  method: 'get',
  path: '/clubs/{clubId}/funds',
  tags: ['Treasury'],
  summary: "A club's funds, earliest period first",
  request: {params: clubIdParam},
  responses: {
    200: {
      description: 'The funds',
      content: {'application/json': {schema: z.array(fundOut)}},
    },
    ...errorResponses,
  },
});

const createFundRoute = createRoute({
  method: 'post',
  path: '/clubs/{clubId}/funds',
  tags: ['Treasury'],
  summary: 'Create a fund',
  request: {
    params: clubIdParam,
    body: {content: {'application/json': {schema: fundDraftIn}}},
  },
  responses: {
    201: {
      description: 'The created fund',
      content: {'application/json': {schema: fundOut}},
    },
    ...errorResponses,
  },
});

const updateFundRoute = createRoute({
  method: 'patch',
  path: '/clubs/{clubId}/funds/{fundId}',
  tags: ['Treasury'],
  summary: "Edit a fund's identity, period, or rules",
  request: {
    params: fundParams,
    body: {content: {'application/json': {schema: fundPatchIn}}},
  },
  responses: {
    200: {
      description: 'The updated fund',
      content: {'application/json': {schema: fundOut}},
    },
    ...errorResponses,
  },
});

const listAllocationsRoute = createRoute({
  method: 'get',
  path: '/clubs/{clubId}/allocations',
  tags: ['Treasury'],
  summary: 'Every allocation entry across the club’s funds, newest first',
  request: {params: clubIdParam},
  responses: {
    200: {
      description: 'The allocation entries',
      content: {'application/json': {schema: z.array(allocationOut)}},
    },
    ...errorResponses,
  },
});

const allocateRoute = createRoute({
  method: 'post',
  path: '/clubs/{clubId}/funds/{fundId}/allocations',
  tags: ['Treasury'],
  summary: 'Record money entering a fund (negative to record a reduction)',
  request: {
    params: fundParams,
    body: {content: {'application/json': {schema: allocationDraftIn}}},
  },
  responses: {
    201: {
      description: 'The recorded entry',
      content: {'application/json': {schema: allocationOut}},
    },
    ...errorResponses,
  },
});

const listRequestsRoute = createRoute({
  method: 'get',
  path: '/clubs/{clubId}/requests',
  tags: ['Treasury'],
  summary: "A club's expense requests, newest first",
  request: {params: clubIdParam},
  responses: {
    200: {
      description: 'The requests',
      content: {'application/json': {schema: z.array(requestOut)}},
    },
    ...errorResponses,
  },
});

const createRequestRoute = createRoute({
  method: 'post',
  path: '/clubs/{clubId}/requests',
  tags: ['Treasury'],
  summary: 'File an expense request',
  request: {
    params: clubIdParam,
    body: {content: {'application/json': {schema: requestDraftIn}}},
  },
  responses: {
    201: {
      description: 'The created request',
      content: {'application/json': {schema: requestOut}},
    },
    ...errorResponses,
  },
});

const updateRequestRoute = createRoute({
  method: 'patch',
  path: '/clubs/{clubId}/requests/{requestId}',
  tags: ['Treasury'],
  summary: 'Update a request, including its status',
  request: {
    params: requestParams,
    body: {content: {'application/json': {schema: requestPatchIn}}},
  },
  responses: {
    200: {
      description: 'The updated request',
      content: {'application/json': {schema: requestOut}},
    },
    ...errorResponses,
  },
});

const deleteRequestRoute = createRoute({
  method: 'delete',
  path: '/clubs/{clubId}/requests/{requestId}',
  tags: ['Treasury'],
  summary: 'Delete a draft request (anything submitted is cancelled instead)',
  request: {params: requestParams},
  responses: {
    204: {description: 'Deleted'},
    ...errorResponses,
  },
});

export const treasuryRoutes = new OpenAPIHono<AppEnv>();

/**
 * Which capability each method requires.
 *
 * Exported as data rather than buried in a switch so it can be asserted
 * directly. That matters more here than it looks: `admin` currently holds all
 * four `expense:*` capabilities and `member` holds none, so over HTTP
 * `expense:view` and `expense:create` are indistinguishable - every request
 * that one allows, the other allows too. A mutation swapping them survives
 * every authorization test that can be written against the present two roles.
 *
 * The distinction is not decoration, it is the insurance the capability model
 * exists for: the moment a third role holds `expense:view` without
 * `expense:create` - a treasurer-only-read advisor, an alumnus - a gate that
 * asked for the wrong one becomes a privilege escalation. Pinning the map is
 * the only way to test that today.
 */
export const TREASURY_METHOD_CAPABILITY = {
  GET: 'expense:view',
  POST: 'expense:create',
  PATCH: 'expense:edit',
  DELETE: 'expense:delete',
} as const satisfies Record<string, Capability>;

/**
 * The capability gate for a method, defaulting to read.
 *
 * Read is `expense:view`, which members do not hold - the treasury is
 * officer-only including read, unlike the document hub.
 */
function gateFor(method: string) {
  const capability =
    TREASURY_METHOD_CAPABILITY[
      method as keyof typeof TREASURY_METHOD_CAPABILITY
    ] ?? TREASURY_METHOD_CAPABILITY.GET;
  return requireCapability(capability);
}

/** Every treasury path. Gates are registered before any handler, so a handler
 * cannot run for a caller who was not authorized. */
export const TREASURY_PATHS = [
  '/clubs/:clubId/funds',
  '/clubs/:clubId/funds/:fundId',
  '/clubs/:clubId/funds/:fundId/allocations',
  '/clubs/:clubId/allocations',
  '/clubs/:clubId/requests',
  '/clubs/:clubId/requests/:requestId',
] as const;

for (const path of TREASURY_PATHS) {
  treasuryRoutes.use(path, async (c, next) => gateFor(c.req.method)(c, next));
}

/** The caller, or a 401. Attribution never comes from the request body. */
function requireUser(c: {var: {user?: {id: string} | null}}): {id: string} {
  const user = c.var.user;
  if (!user) {
    throw new HTTPException(401, {message: 'Authentication required'});
  }
  return user;
}

/**
 * Turns a store invariant violation into a 400 with its own message.
 *
 * These are client errors rather than server faults: naming a fund from another
 * club, or one that is closed, is something a caller can fix. They are 400 and
 * not 404 because the caller is a member of this club and the club is real -
 * the resource-hiding rule that returns 404 to non-members is about club
 * enumeration and does not apply here.
 */
function asHttp(error: unknown): never {
  if (
    error instanceof UnknownFundError ||
    error instanceof ClosedFundError ||
    error instanceof UnknownEventError ||
    error instanceof RequestNotDraftError
  ) {
    throw new HTTPException(400, {message: error.message});
  }
  throw error;
}

treasuryRoutes.openapi(listFundsRoute, async (c) => {
  const {clubId} = c.req.valid('param');
  return c.json(await listFunds(clubId), 200);
});

treasuryRoutes.openapi(createFundRoute, async (c) => {
  const {clubId} = c.req.valid('param');
  const draft = c.req.valid('json');
  const user = requireUser(c);

  return c.json(await createFund(clubId, draft, user.id), 201);
});

treasuryRoutes.openapi(updateFundRoute, async (c) => {
  const {clubId, fundId} = c.req.valid('param');
  const patch = c.req.valid('json');

  const updated = await updateFund(clubId, fundId, patch).catch(asHttp);
  if (!updated) {
    throw new HTTPException(404, {message: 'Fund not found'});
  }

  // The start-before-end rule cannot live on the patch schema, which may carry
  // either date or neither. This is the only place both values are known.
  if (updated.endsOn < updated.startsOn) {
    throw new HTTPException(400, {
      message: 'The fund cannot end before it starts',
    });
  }

  return c.json(updated, 200);
});

treasuryRoutes.openapi(listAllocationsRoute, async (c) => {
  const {clubId} = c.req.valid('param');
  return c.json(await listAllocations(clubId), 200);
});

treasuryRoutes.openapi(allocateRoute, async (c) => {
  const {clubId, fundId} = c.req.valid('param');
  const draft = c.req.valid('json');
  const user = requireUser(c);

  const entry = await allocate(clubId, fundId, draft, user.id).catch(asHttp);
  return c.json(entry, 201);
});

treasuryRoutes.openapi(listRequestsRoute, async (c) => {
  const {clubId} = c.req.valid('param');
  return c.json(await listRequests(clubId), 200);
});

treasuryRoutes.openapi(createRequestRoute, async (c) => {
  const {clubId} = c.req.valid('param');
  const {status, ...draft} = c.req.valid('json');
  const user = requireUser(c);

  const created = await createRequest(clubId, draft, user.id, status).catch(
    asHttp,
  );
  return c.json(created, 201);
});

treasuryRoutes.openapi(updateRequestRoute, async (c) => {
  const {clubId, requestId} = c.req.valid('param');
  const patch = c.req.valid('json');

  const updated = await updateRequest(clubId, requestId, patch).catch(asHttp);
  if (!updated) {
    throw new HTTPException(404, {message: 'Request not found'});
  }

  return c.json(updated, 200);
});

treasuryRoutes.openapi(deleteRequestRoute, async (c) => {
  const {clubId, requestId} = c.req.valid('param');

  const removed = await deleteRequest(clubId, requestId).catch(asHttp);
  if (!removed) {
    throw new HTTPException(404, {message: 'Request not found'});
  }

  return c.body(null, 204);
});
