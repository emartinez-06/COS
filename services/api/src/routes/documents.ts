/**
 * Document hub routes.
 *
 * Same enforcement model as the event routes: every path sits behind
 * `requireCapability`, using the same capability strings the UI will pass to
 * `useCan`. The client check decides what to draw; this one decides what
 * happens.
 *
 * Two things differ from events and are worth knowing before editing:
 *
 * **Draft visibility is resolved here, once.** `canSeeDraftDocuments` turns the
 * caller's role into a read scope that is threaded into every store call. The
 * store never works it out for itself, so there is one place where "who may see
 * unfinished work" is decided.
 *
 * **Three routes are plain Hono handlers rather than `.openapi()` ones**:
 * creating a file document, replacing its bytes, and downloading them. Those
 * carry multipart or binary bodies, which a Zod request validator has nothing
 * useful to say about - the real checks are the content-type allowlist and the
 * size limit in @cos/core, applied against the parsed upload. They are
 * registered in the OpenAPI document by hand so the generated spec still
 * describes the whole API.
 */

import {OpenAPIHono, createRoute, z} from '@hono/zod-openapi';
import type {DocumentSection, DocumentStatus} from '@cos/core';
import {
  MAX_DOCUMENT_FILE_BYTES,
  UPLOAD_REJECTION_MESSAGES,
  canSeeDraftDocuments,
  checkDocumentUpload,
  clubDocumentDetailSchema,
  clubDocumentSchema,
  documentPatchSchema,
  documentRevisionDetailSchema,
  documentRevisionSchema,
  fileDocumentDraftSchema,
  textDocumentDraftSchema,
} from '@cos/core';
import {HTTPException} from 'hono/http-exception';

import type {AppEnv} from '../auth/middleware.js';
import {requireCapability} from '../auth/middleware.js';
import type {ReadScope, UploadedFile} from '../documents/document-store.js';
import {
  createFileDocument,
  createTextDocument,
  deleteDocument,
  findDocument,
  findRevision,
  listDocuments,
  listRevisions,
  readDocumentFile,
  replaceDocumentFile,
  updateDocument,
} from '../documents/document-store.js';

const documentSchema = clubDocumentSchema.openapi('ClubDocument');
const detailSchema = clubDocumentDetailSchema.openapi('ClubDocumentDetail');
const patchSchema = documentPatchSchema.openapi('DocumentPatch');
const revisionSchema = documentRevisionSchema.openapi('DocumentRevision');
const revisionDetailSchema = documentRevisionDetailSchema.openapi(
  'DocumentRevisionDetail',
);

const clubIdParam = z.object({
  clubId: z.string().openapi({param: {name: 'clubId', in: 'path'}}),
});

const documentParams = z.object({
  clubId: z.string().openapi({param: {name: 'clubId', in: 'path'}}),
  documentId: z.string().openapi({param: {name: 'documentId', in: 'path'}}),
});

const revisionParams = documentParams.extend({
  version: z.coerce
    .number()
    .int()
    .positive()
    .openapi({param: {name: 'version', in: 'path'}}),
});

const errorSchema = z.object({error: z.string()}).openapi('ApiError');

const conflictSchema = z
  .object({
    error: z.string(),
    /** What the document is actually at, so a client can offer to reload. */
    currentVersion: z.number().int().positive(),
  })
  .openapi('DocumentVersionConflict');

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
    description:
      'No such club or document, or the caller is not a member of the club',
    content: {'application/json': {schema: errorSchema}},
  },
} as const;

export const documentRoutes = new OpenAPIHono<AppEnv>();

/**
 * The capability gates.
 *
 * Registered per path pattern rather than as one wildcard, so a new route
 * cannot inherit a gate that happens to be lying around. Hono matches
 * `use(path)` against the whole path, so the nested `/file` and `/revisions`
 * paths need their own entries - they are not covered by the `:documentId`
 * pattern above them.
 */
documentRoutes.use('/clubs/:clubId/documents', async (c, next) => {
  const gate =
    c.req.method === 'POST'
      ? requireCapability('document:create')
      : requireCapability('document:view');
  return gate(c, next);
});

documentRoutes.use('/clubs/:clubId/documents/:documentId', async (c, next) => {
  const gate =
    c.req.method === 'DELETE'
      ? requireCapability('document:delete')
      : c.req.method === 'PATCH'
        ? requireCapability('document:edit')
        : requireCapability('document:view');
  return gate(c, next);
});

documentRoutes.use(
  '/clubs/:clubId/documents/:documentId/file',
  async (c, next) => {
    const gate =
      c.req.method === 'PUT'
        ? requireCapability('document:edit')
        : requireCapability('document:view');
    return gate(c, next);
  },
);

documentRoutes.use(
  '/clubs/:clubId/documents/:documentId/revisions',
  requireCapability('document:view'),
);

documentRoutes.use(
  '/clubs/:clubId/documents/:documentId/revisions/:version',
  requireCapability('document:view'),
);

/**
 * The caller's read scope.
 *
 * `requireCapability` has already put the membership on the context, so the
 * role is known and never taken from the request.
 */
function scopeFor(c: {var: AppEnv['Variables']}): ReadScope {
  const role = c.var.membership?.role;
  return {includeDrafts: role ? canSeeDraftDocuments(role) : false};
}

function requireUser(c: {var: AppEnv['Variables']}): string {
  const user = c.var.user;
  if (!user) {
    throw new HTTPException(401, {message: 'Authentication required'});
  }
  return user.id;
}

const listRoute = createRoute({
  method: 'get',
  path: '/clubs/{clubId}/documents',
  tags: ['Documents'],
  summary: "A club's documents, by section then title",
  description:
    'Metadata only - bodies are never included in a listing. Drafts appear ' +
    'only for a caller who could edit them.',
  request: {params: clubIdParam},
  responses: {
    200: {
      description: 'The documents',
      content: {'application/json': {schema: z.array(documentSchema)}},
    },
    ...errorResponses,
  },
});

const getRoute = createRoute({
  method: 'get',
  path: '/clubs/{clubId}/documents/{documentId}',
  tags: ['Documents'],
  summary: 'One document, with its content',
  request: {params: documentParams},
  responses: {
    200: {
      description: 'The document',
      content: {'application/json': {schema: detailSchema}},
    },
    ...errorResponses,
  },
});

const patchRoute = createRoute({
  method: 'patch',
  path: '/clubs/{clubId}/documents/{documentId}',
  tags: ['Documents'],
  summary: 'Update a document',
  description:
    'A content change must carry `expectedVersion` and is refused with 409 ' +
    'if someone else has saved since. Metadata-only changes do not bump the ' +
    'version and do not need it.',
  request: {
    params: documentParams,
    body: {content: {'application/json': {schema: patchSchema}}},
  },
  responses: {
    200: {
      description: 'The updated document',
      content: {'application/json': {schema: detailSchema}},
    },
    409: {
      description: 'Someone else saved first',
      content: {'application/json': {schema: conflictSchema}},
    },
    ...errorResponses,
  },
});

const deleteRoute = createRoute({
  method: 'delete',
  path: '/clubs/{clubId}/documents/{documentId}',
  tags: ['Documents'],
  summary: 'Remove a document from the hub',
  description:
    'A soft delete. The document stops appearing and its revision history is ' +
    'kept.',
  request: {params: documentParams},
  responses: {204: {description: 'Removed'}, ...errorResponses},
});

const revisionsRoute = createRoute({
  method: 'get',
  path: '/clubs/{clubId}/documents/{documentId}/revisions',
  tags: ['Documents'],
  summary: "A document's history, newest first",
  request: {params: documentParams},
  responses: {
    200: {
      description: 'The revisions, without bodies',
      content: {'application/json': {schema: z.array(revisionSchema)}},
    },
    ...errorResponses,
  },
});

const revisionRoute = createRoute({
  method: 'get',
  path: '/clubs/{clubId}/documents/{documentId}/revisions/{version}',
  tags: ['Documents'],
  summary: 'One past revision, with the text it held',
  request: {params: revisionParams},
  responses: {
    200: {
      description: 'The revision',
      content: {'application/json': {schema: revisionDetailSchema}},
    },
    409: {
      description:
        'This is a file document; fetch past bytes from the file route ' +
        'with ?version=',
      content: {'application/json': {schema: errorSchema}},
    },
    ...errorResponses,
  },
});

documentRoutes.openapi(listRoute, async (c) => {
  const {clubId} = c.req.valid('param');
  return c.json(await listDocuments(clubId, scopeFor(c)), 200);
});

documentRoutes.openapi(getRoute, async (c) => {
  const {clubId, documentId} = c.req.valid('param');
  const document = await findDocument(clubId, documentId, scopeFor(c));
  if (!document) {
    throw new HTTPException(404, {message: 'Document not found'});
  }
  return c.json(document, 200);
});

documentRoutes.openapi(patchRoute, async (c) => {
  const {clubId, documentId} = c.req.valid('param');
  const patch = c.req.valid('json');
  const editorId = requireUser(c);

  const result = await updateDocument(clubId, documentId, patch, editorId);

  if ('error' in result) {
    switch (result.error) {
      case 'not-found':
        throw new HTTPException(404, {message: 'Document not found'});
      case 'conflict':
        return c.json(
          {
            error:
              'This document was changed by someone else while you were editing it',
            currentVersion: result.currentVersion ?? 0,
          },
          409,
        );
      case 'missing-version':
        throw new HTTPException(400, {
          message:
            'A content change must include expectedVersion, the version you were editing',
        });
      case 'wrong-kind':
        throw new HTTPException(400, {
          message:
            'This is an uploaded file. Replace its contents with PUT .../file rather than sending text',
        });
    }
  }

  return c.json(result.document, 200);
});

documentRoutes.openapi(deleteRoute, async (c) => {
  const {clubId, documentId} = c.req.valid('param');
  const editorId = requireUser(c);

  if (!(await deleteDocument(clubId, documentId, editorId))) {
    throw new HTTPException(404, {message: 'Document not found'});
  }
  return c.body(null, 204);
});

documentRoutes.openapi(revisionsRoute, async (c) => {
  const {clubId, documentId} = c.req.valid('param');
  const revisions = await listRevisions(clubId, documentId, scopeFor(c));
  if (!revisions) {
    throw new HTTPException(404, {message: 'Document not found'});
  }
  return c.json(revisions, 200);
});

documentRoutes.openapi(revisionRoute, async (c) => {
  const {clubId, documentId, version} = c.req.valid('param');
  const revision = await findRevision(
    clubId,
    documentId,
    version,
    scopeFor(c),
  );

  if (revision === 'wrong-kind') {
    return c.json(
      {
        error:
          'This is an uploaded file. Fetch past versions from the file route with ?version=',
      },
      409,
    );
  }
  if (!revision) {
    throw new HTTPException(404, {message: 'Revision not found'});
  }
  return c.json(revision, 200);
});

/**
 * Reads an upload out of a multipart body, refusing it if it breaks the hub's
 * limits.
 *
 * The `Content-Length` check happens *before* parsing, which is the point of
 * doing it separately: `parseBody` buffers the whole request in memory, so
 * checking the size only after parsing would mean a 2 GB upload has already
 * been accepted into the process before anything rejects it.
 *
 * The declared content type is checked against the allowlist rather than
 * trusted, because it is chosen by whoever is uploading.
 */
async function readUpload(c: {
  req: {
    header: (name: string) => string | undefined;
    parseBody: () => Promise<Record<string, unknown>>;
  };
}): Promise<{file: UploadedFile; fields: Record<string, string>}> {
  const declaredLength = Number(c.req.header('content-length') ?? '0');
  if (declaredLength > MAX_DOCUMENT_FILE_BYTES + 1024 * 1024) {
    throw new HTTPException(413, {
      message: UPLOAD_REJECTION_MESSAGES['too-large'],
    });
  }

  const body = await c.req.parseBody();
  const uploaded = body['file'];

  if (!(uploaded instanceof File)) {
    throw new HTTPException(400, {
      message: 'Expected a multipart form with a "file" part',
    });
  }

  const check = checkDocumentUpload({
    contentType: uploaded.type,
    byteSize: uploaded.size,
  });
  if (!check.ok) {
    throw new HTTPException(check.reason === 'too-large' ? 413 : 400, {
      message: UPLOAD_REJECTION_MESSAGES[check.reason],
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
      name: uploaded.name,
      contentType: uploaded.type.split(';')[0]?.trim() ?? uploaded.type,
    },
    fields,
  };
}

/**
 * Create a document.
 *
 * One collection, one create, branching on content type: JSON authors a text
 * document, multipart uploads a file. Splitting these into two paths would
 * have meant two "create a document" endpoints for one concept, and a path
 * segment that collides with a document id.
 */
documentRoutes.post('/clubs/:clubId/documents', async (c) => {
  const clubId = c.req.param('clubId');
  const authorId = requireUser(c);
  const contentType = c.req.header('content-type') ?? '';

  if (contentType.includes('multipart/form-data')) {
    const {file, fields} = await readUpload(c);

    const draft = fileDocumentDraftSchema.safeParse({
      kind: 'file',
      title: fields['title'] ?? file.name,
      summary: fields['summary'] ?? '',
      section: (fields['section'] ?? 'other') as DocumentSection,
      status: (fields['status'] ?? 'draft') as DocumentStatus,
    });

    if (!draft.success) {
      return c.json(
        {
          error: 'Validation failed',
          issues: draft.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
        400,
      );
    }

    const created = await createFileDocument(
      clubId,
      draft.data,
      file,
      authorId,
    );
    return c.json(created, 201);
  }

  const parsed = textDocumentDraftSchema.safeParse({
    kind: 'text',
    ...(await c.req.json().catch(() => ({}))),
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

  const created = await createTextDocument(clubId, parsed.data, authorId);
  return c.json(created, 201);
});

/** Replace an uploaded document's bytes, as a new revision. */
documentRoutes.put(
  '/clubs/:clubId/documents/:documentId/file',
  async (c) => {
    const clubId = c.req.param('clubId');
    const documentId = c.req.param('documentId');
    const editorId = requireUser(c);

    const {file, fields} = await readUpload(c);

    const expectedVersion = Number(fields['expectedVersion'] ?? '');
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      throw new HTTPException(400, {
        message:
          'Replacing a file must include expectedVersion, the version you were looking at',
      });
    }

    const result = await replaceDocumentFile(
      clubId,
      documentId,
      file,
      expectedVersion,
      editorId,
    );

    if ('error' in result) {
      switch (result.error) {
        case 'not-found':
          throw new HTTPException(404, {message: 'Document not found'});
        case 'wrong-kind':
          throw new HTTPException(400, {
            message:
              'This is an authored document. Edit its text with PATCH rather than uploading a file',
          });
        default:
          return c.json(
            {
              error:
                'This document was changed by someone else while you were editing it',
              currentVersion: result.currentVersion ?? 0,
            },
            409,
          );
      }
    }

    return c.json(result.document, 200);
  },
);

/**
 * Download an uploaded document's bytes.
 *
 * `?version=` fetches a past revision's file. The stored content type is sent
 * back rather than one from the request, and `Content-Disposition` is
 * `attachment` so a browser saves the file instead of rendering it inline -
 * an uploaded document is a club's file, not a page this app is serving.
 */
documentRoutes.get('/clubs/:clubId/documents/:documentId/file', async (c) => {
  const clubId = c.req.param('clubId');
  const documentId = c.req.param('documentId');

  const requested = c.req.query('version');
  const version = requested === undefined ? undefined : Number(requested);
  if (version !== undefined && (!Number.isInteger(version) || version < 1)) {
    throw new HTTPException(400, {message: 'version must be a whole number'});
  }

  const result = await readDocumentFile(
    clubId,
    documentId,
    scopeFor(c),
    version,
  );

  if (result === 'wrong-kind') {
    throw new HTTPException(400, {
      message: 'This is an authored document; read its text from the document itself',
    });
  }
  if (!result) {
    throw new HTTPException(404, {message: 'File not found'});
  }

  return c.body(result.bytes as unknown as ArrayBuffer, 200, {
    'Content-Type': result.contentType,
    'Content-Length': String(result.bytes.byteLength),
    // The filename is quoted and stripped of quotes and control characters:
    // it came from an upload and ends up in a response header.
    'Content-Disposition': `attachment; filename="${result.fileName.replace(
      /["\\\r\n]/g,
      '',
    )}"`,
  });
});

/**
 * The three routes above carry multipart or binary bodies, so they are plain
 * Hono handlers. Registering them here by hand keeps the generated spec a
 * complete description of the API rather than one that quietly omits uploads.
 *
 * Paths are written **without** the `/api` prefix, exactly like the
 * `createRoute` definitions above: `app.route('/api', documentRoutes)` applies
 * it to hand-registered paths too. Writing it here produced `/api/api/...` in
 * the generated spec.
 */
const uploadPartSchema = z
  .object({
    file: z.any().openapi({type: 'string', format: 'binary'}),
    title: z.string().optional(),
    summary: z.string().optional(),
    section: z.string().optional(),
    status: z.string().optional(),
  })
  .openapi('DocumentUpload');

documentRoutes.openAPIRegistry.registerPath({
  method: 'post',
  path: '/clubs/{clubId}/documents',
  tags: ['Documents'],
  summary: 'Create a document',
  description:
    'A JSON body authors a text document; a multipart body uploads a file.',
  request: {
    params: clubIdParam,
    body: {
      content: {
        'application/json': {schema: textDocumentDraftSchema},
        'multipart/form-data': {schema: uploadPartSchema},
      },
    },
  },
  responses: {
    201: {
      description: 'The created document',
      content: {'application/json': {schema: detailSchema}},
    },
    413: {
      description: 'The file is larger than the hub accepts',
      content: {'application/json': {schema: errorSchema}},
    },
    ...errorResponses,
  },
});

documentRoutes.openAPIRegistry.registerPath({
  method: 'put',
  path: '/clubs/{clubId}/documents/{documentId}/file',
  tags: ['Documents'],
  summary: "Replace an uploaded document's bytes",
  request: {
    params: documentParams,
    body: {
      content: {
        'multipart/form-data': {
          schema: uploadPartSchema.extend({expectedVersion: z.string()}),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'The updated document',
      content: {'application/json': {schema: detailSchema}},
    },
    409: {
      description: 'Someone else saved first',
      content: {'application/json': {schema: conflictSchema}},
    },
    ...errorResponses,
  },
});

documentRoutes.openAPIRegistry.registerPath({
  method: 'get',
  path: '/clubs/{clubId}/documents/{documentId}/file',
  tags: ['Documents'],
  summary: "Download an uploaded document's bytes",
  request: {
    params: documentParams,
    query: z.object({
      version: z.string().optional().openapi({
        param: {name: 'version', in: 'query'},
        description: 'A past revision. Defaults to the current one.',
      }),
    }),
  },
  responses: {
    200: {
      description: 'The file',
      content: {'application/octet-stream': {schema: {type: 'string', format: 'binary'}}},
    },
    ...errorResponses,
  },
});
