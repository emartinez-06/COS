/**
 * OnlyOffice Docs CE integration routes.
 *
 * Three routes, three different trust models - worth being explicit about
 * since none of them look like the rest of this file's siblings:
 *
 * - **The config route** (`GET .../onlyoffice-config`) is an ordinary
 *   cookie-authenticated, capability-gated route like everything else in
 *   `documents.ts`. It hands the browser a signed config to pass to
 *   `DocsAPI.DocEditor`.
 * - **The download route** (`GET /internal/onlyoffice/download`) is called
 *   by the OnlyOffice *container* itself, server-to-server over the Docker
 *   network - it never carries a session cookie, so it is authenticated by
 *   its own short-lived token instead (`onlyoffice.ts`'s
 *   `verifyOnlyOfficeDownloadToken`).
 * - **The callback route** (`POST /internal/onlyoffice/callback/...`) is
 *   also called by the document server, and is authenticated by verifying
 *   *OnlyOffice's own* JWT embedded in the callback body - a completely
 *   separate signature scheme from the two above, which is why
 *   `docker-compose.yml` sets `JWT_IN_BODY: true` for this document server.
 *
 * All three answer "not configured" (503) when `ONLYOFFICE_JWT_SECRET` is
 * unset, rather than the API failing to start - see env.ts's module doc.
 */

import {OpenAPIHono, createRoute, z} from '@hono/zod-openapi';
import {can, onlyOfficeFileInfo} from '@cos/core';
import {HTTPException} from 'hono/http-exception';

import {findMembershipForPresence} from '../auth/membership.js';
import type {AppEnv} from '../auth/middleware.js';
import {requireCapability} from '../auth/middleware.js';
import {
  buildOnlyOfficeConfig,
  isOnlyOfficeConfigured,
  mintOnlyOfficeDownloadToken,
  verifyOnlyOfficeCallback,
  verifyOnlyOfficeDownloadToken,
} from '../documents/onlyoffice.js';
import {
  findDocument,
  readDocumentFile,
  replaceDocumentFileFromOnlyOffice,
} from '../documents/document-store.js';
import {env} from '../env.js';

export const onlyOfficeRoutes = new OpenAPIHono<AppEnv>();

const documentParams = z.object({
  clubId: z.string().openapi({param: {name: 'clubId', in: 'path'}}),
  documentId: z.string().openapi({param: {name: 'documentId', in: 'path'}}),
});

const errorSchema = z.object({error: z.string()}).openapi('ApiError');

const configOut = z
  .object({
    documentType: z.enum(['word', 'cell', 'slide']),
    document: z.object({
      fileType: z.string(),
      key: z.string(),
      title: z.string(),
      url: z.string(),
      permissions: z.object({edit: z.boolean(), download: z.boolean()}),
    }),
    editorConfig: z.object({
      callbackUrl: z.string(),
      user: z.object({id: z.string(), name: z.string()}),
      mode: z.enum(['edit', 'view']),
    }),
    token: z.string(),
  })
  .openapi('OnlyOfficeConfig');

const configRoute = createRoute({
  method: 'get',
  path: '/clubs/{clubId}/documents/{documentId}/onlyoffice-config',
  tags: ['Documents'],
  summary: 'A signed OnlyOffice editor config for one file document',
  request: {params: documentParams},
  responses: {
    200: {
      description: 'The config, ready to pass to DocsAPI.DocEditor',
      content: {'application/json': {schema: configOut}},
    },
    400: {
      description: 'Not a file document, or not an Office format OnlyOffice understands',
      content: {'application/json': {schema: errorSchema}},
    },
    404: {
      description: 'Document not found',
      content: {'application/json': {schema: errorSchema}},
    },
    503: {
      description: 'OnlyOffice is not configured on this deployment',
      content: {'application/json': {schema: errorSchema}},
    },
  },
});

onlyOfficeRoutes.use(
  '/clubs/:clubId/documents/:documentId/onlyoffice-config',
  requireCapability('document:view'),
);

onlyOfficeRoutes.openapi(configRoute, async (c) => {
  if (!isOnlyOfficeConfigured()) {
    return c.json({error: 'OnlyOffice is not configured on this deployment'}, 503);
  }

  const {clubId, documentId} = c.req.valid('param');
  const userId = c.var.user?.id;
  const role = c.var.membership?.role;
  if (!userId || !role) {
    throw new HTTPException(401, {message: 'Authentication required'});
  }

  const document = await findDocument(clubId, documentId, {includeDrafts: true});
  if (!document) {
    throw new HTTPException(404, {message: 'Document not found'});
  }
  if (document.kind !== 'file' || !document.file) {
    throw new HTTPException(400, {message: 'Only uploaded files use OnlyOffice'});
  }
  if (!onlyOfficeFileInfo(document.file.contentType)) {
    throw new HTTPException(400, {
      message: 'This file type is not an Office format OnlyOffice can open',
    });
  }

  const downloadToken = mintOnlyOfficeDownloadToken(clubId, documentId);
  if (!downloadToken) {
    return c.json({error: 'OnlyOffice is not configured on this deployment'}, 503);
  }

  // These routes are mounted under /api (`app.route('/api', onlyOfficeRoutes)`
  // in app.ts), unlike the OpenAPI registrations below, which - like every
  // other hand-registered path in this codebase - are written without the
  // prefix because app.route() applies it to those too.
  const downloadUrl = `${env.ONLYOFFICE_CALLBACK_ORIGIN}/api/internal/onlyoffice/download?token=${encodeURIComponent(downloadToken)}`;
  const callbackUrl = `${env.ONLYOFFICE_CALLBACK_ORIGIN}/api/internal/onlyoffice/callback/${clubId}/${documentId}`;

  const config = buildOnlyOfficeConfig(
    document,
    {id: userId, name: c.var.user?.name ?? 'Someone'},
    can(role, 'document:edit'),
    downloadUrl,
    callbackUrl,
  );
  if (!config) {
    return c.json({error: 'OnlyOffice is not configured on this deployment'}, 503);
  }

  return c.json(config, 200);
});

/**
 * What the OnlyOffice *container* fetches - never a browser, so no
 * capability gate and no cookie. `?token=` is the whole authorization.
 */
onlyOfficeRoutes.get('/internal/onlyoffice/download', async (c) => {
  const token = c.req.query('token');
  const consumed = token ? verifyOnlyOfficeDownloadToken(token) : null;
  if (!consumed) {
    throw new HTTPException(401, {message: 'Invalid or expired download token'});
  }

  const result = await readDocumentFile(
    consumed.clubId,
    consumed.documentId,
    {includeDrafts: true},
  );
  if (result === 'wrong-kind' || !result) {
    throw new HTTPException(404, {message: 'File not found'});
  }

  return c.body(result.bytes as unknown as ArrayBuffer, 200, {
    'Content-Type': result.contentType,
    'Content-Length': String(result.bytes.byteLength),
  });
});

/**
 * What the OnlyOffice document server calls when it has something to save.
 * Verified by its own embedded JWT, not by anything this route's caller
 * could forge just by knowing the URL.
 */
onlyOfficeRoutes.post(
  '/internal/onlyoffice/callback/:clubId/:documentId',
  async (c) => {
    const clubId = c.req.param('clubId');
    const documentId = c.req.param('documentId');
    const body = await c.req.json().catch(() => null);
    const callback = verifyOnlyOfficeCallback(body);

    if (!callback) {
      // OnlyOffice retries on a nonzero `error`, and an unverifiable
      // callback is exactly the case worth it retrying rather than
      // silently dropping - could be a transient secret mismatch during a
      // deploy, not necessarily an attack.
      return c.json({error: 1}, 200);
    }

    // 2 = ready for saving (every editor closed); 6 = force-saved (someone
    // triggered a save while still editing). Every other status - actively
    // editing, a save error on OnlyOffice's own side - has nothing for this
    // route to do.
    if ((callback.status === 2 || callback.status === 6) && callback.url) {
      try {
        const response = await fetch(callback.url);
        if (!response.ok) {
          return c.json({error: 1}, 200);
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        const contentType =
          response.headers.get('content-type') ?? 'application/octet-stream';

        const existing = await findDocument(clubId, documentId, {
          includeDrafts: true,
        });
        if (!existing?.file) {
          return c.json({error: 1}, 200);
        }

        await replaceDocumentFileFromOnlyOffice(
          clubId,
          documentId,
          {bytes, name: existing.file.name, contentType},
          null,
        );
      } catch {
        return c.json({error: 1}, 200);
      }
    }

    return c.json({error: 0}, 200);
  },
);

onlyOfficeRoutes.openAPIRegistry.registerPath({
  method: 'get',
  path: '/internal/onlyoffice/download',
  tags: ['Documents'],
  summary: "OnlyOffice's own fetch of a document's bytes (server-to-server)",
  request: {
    query: z.object({
      token: z.string().openapi({param: {name: 'token', in: 'query'}}),
    }),
  },
  responses: {
    200: {
      description: 'The file',
      content: {'application/octet-stream': {schema: {type: 'string', format: 'binary'}}},
    },
    401: {
      description: 'Invalid or expired token',
      content: {'application/json': {schema: errorSchema}},
    },
  },
});

onlyOfficeRoutes.openAPIRegistry.registerPath({
  method: 'post',
  path: '/internal/onlyoffice/callback/{clubId}/{documentId}',
  tags: ['Documents'],
  summary: 'OnlyOffice save callback (server-to-server)',
  request: {params: documentParams},
  responses: {
    200: {description: 'Always 200 - the body itself carries error:0/1'},
  },
});
