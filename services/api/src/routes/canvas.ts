/**
 * Canvas routes.
 *
 * The canvas is officer-only **including read** - every path sits behind
 * `canvas:*`, the same shape the treasury uses, and `member` holds none of
 * them. Unlike the document hub there is no read/write split to route
 * around: every capability maps straight to an HTTP method via
 * `CANVAS_METHOD_CAPABILITY`, exactly as `TREASURY_METHOD_CAPABILITY` does.
 *
 * Board and viewport routes never take a `boardId` path param - a club has
 * exactly one board, resolved server-side by `getOrCreateBoard`, so there is
 * nothing for a client to supply or get wrong.
 *
 * **Two routes are plain Hono handlers rather than `.openapi()` ones**:
 * creating a node (JSON for sticky-note/link/entity-embed, multipart for
 * `image`) and downloading an image node's bytes (binary). Same reasoning as
 * the document hub's upload/download routes - a Zod request validator has
 * nothing useful to say about a multipart or binary body.
 */

import {OpenAPIHono, createRoute, z} from '@hono/zod-openapi';
import {
  CANVAS_IMAGE_UPLOAD_REJECTION_MESSAGES,
  MAX_CANVAS_IMAGE_BYTES,
  canvasBoardSchema,
  canvasEdgeCreateSchema,
  canvasEdgeSchema,
  canvasNodeContentPatchSchema,
  canvasNodeDraftSchema,
  canvasNodeGeometryPatchSchema,
  canvasNodeSchema,
  canvasViewportPatchSchema,
  checkCanvasImageUpload,
  entityEmbedNodeDraftSchema,
  linkNodeDraftSchema,
  stickyNoteNodeDraftSchema,
} from '@cos/core';
import type {Capability} from '@cos/core';
import {HTTPException} from 'hono/http-exception';

import type {AppEnv} from '../auth/middleware.js';
import {requireCapability} from '../auth/middleware.js';
import {broadcastSync} from '../canvas/canvas-presence.js';
import type {UploadedImage} from '../canvas/canvas-store.js';
import {
  MissingImageFileError,
  SelfConnectionError,
  UnknownCanvasBoardError,
  UnknownCanvasEdgeError,
  UnknownCanvasNodeError,
  WrongNodeKindError,
  createEdge,
  createNode,
  deleteEdge,
  deleteNode,
  getOrCreateBoard,
  listEdges,
  listNodes,
  readNodeImage,
  updateNodeContent,
  updateNodeGeometry,
  updateViewport,
} from '../canvas/canvas-store.js';

const boardOut = canvasBoardSchema.openapi('CanvasBoard');
const nodeOut = canvasNodeSchema.openapi('CanvasNode');
const edgeOut = canvasEdgeSchema.openapi('CanvasEdge');

/** JSON node creation covers every kind but `image`, which is multipart-only. */
const jsonNodeDraftIn = z
  .discriminatedUnion('nodeType', [
    stickyNoteNodeDraftSchema,
    linkNodeDraftSchema,
    entityEmbedNodeDraftSchema,
  ])
  .openapi('CanvasNodeDraft');

const geometryPatchIn = canvasNodeGeometryPatchSchema.openapi(
  'CanvasNodeGeometryPatch',
);
const contentPatchIn = canvasNodeContentPatchSchema.openapi(
  'CanvasNodeContentPatch',
);
const edgeDraftIn = canvasEdgeCreateSchema.openapi('CanvasEdgeDraft');
const viewportPatchIn = canvasViewportPatchSchema.openapi(
  'CanvasViewportPatch',
);

const clubIdParam = z.object({
  clubId: z.string().openapi({param: {name: 'clubId', in: 'path'}}),
});

const nodeParams = z.object({
  clubId: z.string().openapi({param: {name: 'clubId', in: 'path'}}),
  nodeId: z.string().openapi({param: {name: 'nodeId', in: 'path'}}),
});

const edgeParams = z.object({
  clubId: z.string().openapi({param: {name: 'clubId', in: 'path'}}),
  edgeId: z.string().openapi({param: {name: 'edgeId', in: 'path'}}),
});

const errorSchema = z.object({error: z.string()}).openapi('ApiError');

const errorResponses = {
  400: {
    description: 'The request names a node, edge, or file that cannot be used',
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

const getBoardRoute = createRoute({
  method: 'get',
  path: '/clubs/{clubId}/canvas/board',
  tags: ['Canvas'],
  summary: "Get the club's board, creating it on first visit",
  request: {params: clubIdParam},
  responses: {
    200: {description: 'The board', content: {'application/json': {schema: boardOut}}},
    ...errorResponses,
  },
});

const listNodesRoute = createRoute({
  method: 'get',
  path: '/clubs/{clubId}/canvas/board/nodes',
  tags: ['Canvas'],
  summary: 'Every node on the board',
  request: {params: clubIdParam},
  responses: {
    200: {
      description: 'The nodes',
      content: {'application/json': {schema: z.array(nodeOut)}},
    },
    ...errorResponses,
  },
});

const updateNodeGeometryRoute = createRoute({
  method: 'patch',
  path: '/clubs/{clubId}/canvas/board/nodes/{nodeId}/geometry',
  tags: ['Canvas'],
  summary: "Change a node's position, size, stacking order, or accent colour",
  request: {
    params: nodeParams,
    body: {content: {'application/json': {schema: geometryPatchIn}}},
  },
  responses: {
    200: {description: 'The updated node', content: {'application/json': {schema: nodeOut}}},
    ...errorResponses,
  },
});

const updateNodeContentRoute = createRoute({
  method: 'patch',
  path: '/clubs/{clubId}/canvas/board/nodes/{nodeId}/content',
  tags: ['Canvas'],
  summary: "Edit a sticky note's text/colour or a link's URL/title",
  request: {
    params: nodeParams,
    body: {content: {'application/json': {schema: contentPatchIn}}},
  },
  responses: {
    200: {description: 'The updated node', content: {'application/json': {schema: nodeOut}}},
    ...errorResponses,
  },
});

const deleteNodeRoute = createRoute({
  method: 'delete',
  path: '/clubs/{clubId}/canvas/board/nodes/{nodeId}',
  tags: ['Canvas'],
  summary: 'Delete a node and every connection attached to it',
  request: {params: nodeParams},
  responses: {204: {description: 'Deleted'}, ...errorResponses},
});

const listEdgesRoute = createRoute({
  method: 'get',
  path: '/clubs/{clubId}/canvas/board/edges',
  tags: ['Canvas'],
  summary: 'Every connection on the board',
  request: {params: clubIdParam},
  responses: {
    200: {
      description: 'The connections',
      content: {'application/json': {schema: z.array(edgeOut)}},
    },
    ...errorResponses,
  },
});

const createEdgeRoute = createRoute({
  method: 'post',
  path: '/clubs/{clubId}/canvas/board/edges',
  tags: ['Canvas'],
  summary: 'Connect two nodes',
  request: {
    params: clubIdParam,
    body: {content: {'application/json': {schema: edgeDraftIn}}},
  },
  responses: {
    201: {
      description: 'The connection (an existing one, if this pair was already connected)',
      content: {'application/json': {schema: edgeOut}},
    },
    ...errorResponses,
  },
});

const deleteEdgeRoute = createRoute({
  method: 'delete',
  path: '/clubs/{clubId}/canvas/board/edges/{edgeId}',
  tags: ['Canvas'],
  summary: 'Remove a connection',
  request: {params: edgeParams},
  responses: {204: {description: 'Deleted'}, ...errorResponses},
});

const updateViewportRoute = createRoute({
  method: 'patch',
  path: '/clubs/{clubId}/canvas/board/viewport',
  tags: ['Canvas'],
  summary: 'Persist the last-known pan position and zoom',
  request: {
    params: clubIdParam,
    body: {content: {'application/json': {schema: viewportPatchIn}}},
  },
  responses: {
    200: {description: 'The board', content: {'application/json': {schema: boardOut}}},
    ...errorResponses,
  },
});

export const canvasRoutes = new OpenAPIHono<AppEnv>();

/**
 * Which capability each method requires. Exported as data for the same
 * reason `TREASURY_METHOD_CAPABILITY` is: a mutation swapping `canvas:view`
 * and `canvas:create` survives every authorization test today, because
 * `admin` holds both and `member` holds neither. Pinning the map is the only
 * way to test the distinction is real rather than coincidental.
 */
export const CANVAS_METHOD_CAPABILITY = {
  GET: 'canvas:view',
  POST: 'canvas:create',
  PATCH: 'canvas:edit',
  DELETE: 'canvas:delete',
} as const satisfies Record<string, Capability>;

function gateFor(method: string) {
  const capability =
    CANVAS_METHOD_CAPABILITY[method as keyof typeof CANVAS_METHOD_CAPABILITY] ??
    CANVAS_METHOD_CAPABILITY.GET;
  return requireCapability(capability);
}

/** Every canvas path, including the two hand-registered ones below. Gates
 * are registered before any handler, so a handler never runs for a caller
 * who was not authorized. */
export const CANVAS_PATHS = [
  '/clubs/:clubId/canvas/board',
  '/clubs/:clubId/canvas/board/nodes',
  '/clubs/:clubId/canvas/board/nodes/:nodeId',
  '/clubs/:clubId/canvas/board/nodes/:nodeId/geometry',
  '/clubs/:clubId/canvas/board/nodes/:nodeId/content',
  '/clubs/:clubId/canvas/board/nodes/:nodeId/image',
  '/clubs/:clubId/canvas/board/edges',
  '/clubs/:clubId/canvas/board/edges/:edgeId',
  '/clubs/:clubId/canvas/board/viewport',
] as const;

for (const path of CANVAS_PATHS) {
  canvasRoutes.use(path, async (c, next) => gateFor(c.req.method)(c, next));
}

/**
 * Turns a store invariant violation into an HTTP response.
 *
 * `Unknown*Error`s are 404: the caller is a member of this club (the
 * capability gate already confirmed it), so an unknown node/edge/board id
 * is a real not-found rather than the club-enumeration case that returns 404
 * for a different reason. `WrongNodeKindError`, `MissingImageFileError`, and
 * `SelfConnectionError` are 400s - things the caller sent that cannot work.
 */
function asHttp(error: unknown): never {
  if (
    error instanceof UnknownCanvasBoardError ||
    error instanceof UnknownCanvasNodeError ||
    error instanceof UnknownCanvasEdgeError
  ) {
    throw new HTTPException(404, {message: error.message});
  }
  if (
    error instanceof WrongNodeKindError ||
    error instanceof MissingImageFileError ||
    error instanceof SelfConnectionError
  ) {
    throw new HTTPException(400, {message: error.message});
  }
  throw error;
}

canvasRoutes.openapi(getBoardRoute, async (c) => {
  const {clubId} = c.req.valid('param');
  return c.json(await getOrCreateBoard(clubId), 200);
});

canvasRoutes.openapi(listNodesRoute, async (c) => {
  const {clubId} = c.req.valid('param');
  const board = await getOrCreateBoard(clubId);
  return c.json(await listNodes(clubId, board.id), 200);
});

canvasRoutes.openapi(updateNodeGeometryRoute, async (c) => {
  const {clubId, nodeId} = c.req.valid('param');
  const patch = c.req.valid('json');
  const node = await updateNodeGeometry(clubId, nodeId, patch).catch(asHttp);
  broadcastSync(clubId, {type: 'node-upserted', node});
  return c.json(node, 200);
});

canvasRoutes.openapi(updateNodeContentRoute, async (c) => {
  const {clubId, nodeId} = c.req.valid('param');
  const patch = c.req.valid('json');
  const node = await updateNodeContent(clubId, nodeId, patch).catch(asHttp);
  broadcastSync(clubId, {type: 'node-upserted', node});
  return c.json(node, 200);
});

canvasRoutes.openapi(deleteNodeRoute, async (c) => {
  const {clubId, nodeId} = c.req.valid('param');
  const {deletedEdgeIds} = await deleteNode(clubId, nodeId).catch(asHttp);
  for (const edgeId of deletedEdgeIds) {
    broadcastSync(clubId, {type: 'edge-deleted', edgeId});
  }
  broadcastSync(clubId, {type: 'node-deleted', nodeId});
  return c.body(null, 204);
});

canvasRoutes.openapi(listEdgesRoute, async (c) => {
  const {clubId} = c.req.valid('param');
  const board = await getOrCreateBoard(clubId);
  return c.json(await listEdges(clubId, board.id), 200);
});

canvasRoutes.openapi(createEdgeRoute, async (c) => {
  const {clubId} = c.req.valid('param');
  const draft = c.req.valid('json');
  const board = await getOrCreateBoard(clubId);
  const edge = await createEdge(clubId, board.id, draft).catch(asHttp);
  broadcastSync(clubId, {type: 'edge-upserted', edge});
  return c.json(edge, 201);
});

canvasRoutes.openapi(deleteEdgeRoute, async (c) => {
  const {clubId, edgeId} = c.req.valid('param');
  await deleteEdge(clubId, edgeId).catch(asHttp);
  broadcastSync(clubId, {type: 'edge-deleted', edgeId});
  return c.body(null, 204);
});

canvasRoutes.openapi(updateViewportRoute, async (c) => {
  const {clubId} = c.req.valid('param');
  const patch = c.req.valid('json');
  const board = await getOrCreateBoard(clubId);
  return c.json(await updateViewport(clubId, board.id, patch), 200);
});

/**
 * Reads an image upload out of a multipart body, refusing it if it breaks
 * the canvas's limits. Mirrors `documents.ts`'s `readUpload`: the
 * `Content-Length` check happens before parsing, since `parseBody` buffers
 * the whole request in memory.
 */
async function readImageUpload(c: {
  req: {
    header: (name: string) => string | undefined;
    parseBody: () => Promise<Record<string, unknown>>;
  };
}): Promise<{file: UploadedImage; fields: Record<string, string>}> {
  const declaredLength = Number(c.req.header('content-length') ?? '0');
  if (declaredLength > MAX_CANVAS_IMAGE_BYTES + 1024 * 1024) {
    throw new HTTPException(413, {
      message: CANVAS_IMAGE_UPLOAD_REJECTION_MESSAGES['too-large'],
    });
  }

  const body = await c.req.parseBody();
  const uploaded = body['file'];

  if (!(uploaded instanceof File)) {
    throw new HTTPException(400, {
      message: 'Expected a multipart form with a "file" part',
    });
  }

  const check = checkCanvasImageUpload({
    contentType: uploaded.type,
    byteSize: uploaded.size,
  });
  if (!check.ok) {
    throw new HTTPException(check.reason === 'too-large' ? 413 : 400, {
      message: CANVAS_IMAGE_UPLOAD_REJECTION_MESSAGES[check.reason],
    });
  }

  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(body)) {
    if (typeof value === 'string') {
      fields[key] = value;
    }
  }

  return {
    file: {
      bytes: new Uint8Array(await uploaded.arrayBuffer()),
      contentType: uploaded.type.split(';')[0]?.trim() ?? uploaded.type,
    },
    fields,
  };
}

/**
 * Create a node.
 *
 * One collection, one create, branching on content type - exactly
 * `documents.ts`'s pattern for the same reason: JSON creates a
 * sticky-note/link/entity-embed node, multipart uploads an `image` one, and
 * splitting these into two endpoints would mean two "create a node"
 * operations for one concept.
 */
canvasRoutes.post('/clubs/:clubId/canvas/board/nodes', async (c) => {
  const clubId = c.req.param('clubId');
  const board = await getOrCreateBoard(clubId);
  const contentType = c.req.header('content-type') ?? '';

  if (contentType.includes('multipart/form-data')) {
    const {file, fields} = await readImageUpload(c);

    const parsed = canvasNodeDraftSchema.safeParse({
      nodeType: 'image',
      positionX: Number(fields['positionX'] ?? '0'),
      positionY: Number(fields['positionY'] ?? '0'),
      width: Number(fields['width'] ?? '0'),
      height: Number(fields['height'] ?? '0'),
    });

    if (!parsed.success) {
      return c.json(
        {
          error: 'Validation failed',
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
        400,
      );
    }

    const node = await createNode(clubId, board.id, parsed.data, file).catch(
      asHttp,
    );
    broadcastSync(clubId, {type: 'node-upserted', node});
    return c.json(node, 201);
  }

  const parsed = jsonNodeDraftIn.safeParse(await c.req.json().catch(() => ({})));

  if (!parsed.success) {
    return c.json(
      {
        error: 'Validation failed',
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
      400,
    );
  }

  const node = await createNode(clubId, board.id, parsed.data).catch(asHttp);
  broadcastSync(clubId, {type: 'node-upserted', node});
  return c.json(node, 201);
});

/** Download an `image` node's bytes. Rendered inline, so no `Content-Disposition`. */
canvasRoutes.get(
  '/clubs/:clubId/canvas/board/nodes/:nodeId/image',
  async (c) => {
    const clubId = c.req.param('clubId');
    const nodeId = c.req.param('nodeId');

    const result = await readNodeImage(clubId, nodeId).catch(asHttp);
    if (!result) {
      throw new HTTPException(404, {message: 'Image not found'});
    }

    return c.body(result.bytes as unknown as ArrayBuffer, 200, {
      'Content-Type': result.contentType,
      'Content-Length': String(result.bytes.byteLength),
    });
  },
);

/**
 * The two routes above carry multipart or binary bodies, so they are plain
 * Hono handlers. Registered here by hand, without the `/api` prefix -
 * exactly like the `createRoute` definitions above - so the generated spec
 * still describes them without producing `/api/api/...`.
 */
const imageUploadPartSchema = z
  .object({
    file: z.any().openapi({type: 'string', format: 'binary'}),
    positionX: z.string(),
    positionY: z.string(),
    width: z.string(),
    height: z.string(),
  })
  .openapi('CanvasImageNodeUpload');

canvasRoutes.openAPIRegistry.registerPath({
  method: 'post',
  path: '/clubs/{clubId}/canvas/board/nodes',
  tags: ['Canvas'],
  summary: 'Create a node',
  description:
    'A JSON body creates a sticky-note, link, or entity-embed node; a multipart body uploads an image node.',
  request: {
    params: clubIdParam,
    body: {
      required: true,
      content: {
        'application/json': {schema: jsonNodeDraftIn},
        'multipart/form-data': {schema: imageUploadPartSchema},
      },
    },
  },
  responses: {
    201: {description: 'The created node', content: {'application/json': {schema: nodeOut}}},
    413: {
      description: 'The image is larger than the canvas accepts',
      content: {'application/json': {schema: errorSchema}},
    },
    ...errorResponses,
  },
});

canvasRoutes.openAPIRegistry.registerPath({
  method: 'get',
  path: '/clubs/{clubId}/canvas/board/nodes/{nodeId}/image',
  tags: ['Canvas'],
  summary: "An image node's bytes",
  request: {params: nodeParams},
  responses: {
    200: {
      description: 'The image bytes',
      content: {'image/png': {schema: {type: 'string', format: 'binary'}}},
    },
    ...errorResponses,
  },
});

