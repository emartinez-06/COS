/**
 * OnlyOffice Docs CE integration: signing the editor config the browser
 * hands to `DocsAPI.DocEditor`, and a short-lived token for the one
 * server-to-server call this repo did not already have a pattern for - the
 * OnlyOffice *container* fetching a file's bytes from us.
 *
 * Everything here is optional at runtime, not just at compose-file level:
 * `ONLYOFFICE_JWT_SECRET` is unset by default (see env.ts), and every
 * function here either returns `null`/throws a typed refusal rather than
 * assuming the secret exists, so a self-hoster who never enables OnlyOffice
 * never has to configure it.
 */

import jwt from 'jsonwebtoken';
import type {ClubDocumentDetail, OnlyOfficeFileInfo} from '@cos/core';
import {onlyOfficeFileInfo} from '@cos/core';

import {env} from '../env.js';

export function isOnlyOfficeConfigured(): boolean {
  return Boolean(env.ONLYOFFICE_JWT_SECRET);
}

/** What the browser hands to `DocsAPI.DocEditor`, signed as its own `token` field. */
export interface OnlyOfficeEditorConfig {
  documentType: OnlyOfficeFileInfo['documentType'];
  document: {
    fileType: string;
    key: string;
    title: string;
    url: string;
    permissions: {edit: boolean; download: boolean};
  };
  editorConfig: {
    callbackUrl: string;
    user: {id: string; name: string};
    mode: 'edit' | 'view';
  };
}

/** The config actually handed to the browser - always signed. */
export type SignedOnlyOfficeConfig = OnlyOfficeEditorConfig & {token: string};

/**
 * Builds and signs the editor config for one document.
 *
 * `document.key` changes whenever the file's content changes - that is what
 * tells the OnlyOffice document server to reload rather than serve a cached
 * copy it has open from a previous version. The document's own `version`
 * counter already changes on every save, so it is the whole key.
 */
export function buildOnlyOfficeConfig(
  clubDocument: ClubDocumentDetail,
  user: {id: string; name: string},
  canEdit: boolean,
  downloadUrl: string,
  callbackUrl: string,
): SignedOnlyOfficeConfig | null {
  if (!env.ONLYOFFICE_JWT_SECRET || !clubDocument.file) {
    return null;
  }
  const info = onlyOfficeFileInfo(clubDocument.file.contentType);
  if (!info) {
    return null;
  }

  const config: OnlyOfficeEditorConfig = {
    documentType: info.documentType,
    document: {
      fileType: info.fileType,
      key: `${clubDocument.id}-v${clubDocument.version}`,
      title: clubDocument.file.name,
      url: downloadUrl,
      permissions: {edit: canEdit, download: true},
    },
    editorConfig: {
      callbackUrl,
      user,
      mode: canEdit ? 'edit' : 'view',
    },
  };

  return {
    ...config,
    token: jwt.sign(config, env.ONLYOFFICE_JWT_SECRET, {algorithm: 'HS256'}),
  };
}

const DOWNLOAD_TOKEN_TTL_SECONDS = 5 * 60;

/**
 * A short-lived token authorizing the OnlyOffice container's own fetch of a
 * document's bytes - unrelated to OnlyOffice's own JWT scheme above. This is
 * a server-to-server call over the Docker network, not a browser request, so
 * it cannot ride the session cookie - same reasoning as the canvas presence
 * and document-collab WebSocket tickets, just with a longer TTL since
 * OnlyOffice's own fetch timing is not bounded by a human clicking anything.
 * Single-use is unnecessary here because OnlyOffice may legitimately refetch
 * within the same editing session.
 */
export function mintOnlyOfficeDownloadToken(
  clubId: string,
  documentId: string,
): string | null {
  if (!env.ONLYOFFICE_JWT_SECRET) {
    return null;
  }
  return jwt.sign({clubId, documentId}, env.ONLYOFFICE_JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: DOWNLOAD_TOKEN_TTL_SECONDS,
  });
}

export function verifyOnlyOfficeDownloadToken(
  token: string,
): {clubId: string; documentId: string} | null {
  if (!env.ONLYOFFICE_JWT_SECRET) {
    return null;
  }
  try {
    const decoded = jwt.verify(token, env.ONLYOFFICE_JWT_SECRET) as {
      clubId: string;
      documentId: string;
    };
    return {clubId: decoded.clubId, documentId: decoded.documentId};
  } catch {
    return null;
  }
}

/**
 * OnlyOffice's callback body, once its own JWT (delivered inline as `token`
 * because the document server is configured with `JWT_IN_BODY: true` - see
 * docker-compose.yml) has been verified.
 *
 * Status meanings that matter here: `2` is "ready for saving" (the document
 * server finished processing everyone's edits after all editors closed), `6`
 * is "force-saved" (someone triggered a save while still editing). Every
 * other status (document being edited, save error, ...) is not something
 * this callback acts on.
 */
export interface OnlyOfficeCallback {
  status: number;
  url?: string;
  key?: string;
}

/** Verifies and decodes a callback body's embedded token. Null on any failure. */
export function verifyOnlyOfficeCallback(
  body: unknown,
): OnlyOfficeCallback | null {
  if (!env.ONLYOFFICE_JWT_SECRET) {
    return null;
  }
  if (
    typeof body !== 'object' ||
    body === null ||
    !('token' in body) ||
    typeof (body as {token: unknown}).token !== 'string'
  ) {
    return null;
  }
  try {
    const decoded = jwt.verify(
      (body as {token: string}).token,
      env.ONLYOFFICE_JWT_SECRET,
    ) as {payload?: OnlyOfficeCallback} & OnlyOfficeCallback;
    // OnlyOffice nests the real fields under `payload` in some deployments
    // and sends them flat in others; accept either shape rather than
    // guessing which version this document server is.
    return decoded.payload ?? decoded;
  } catch {
    return null;
  }
}
