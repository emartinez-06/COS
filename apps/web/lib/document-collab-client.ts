'use client';

/**
 * The document collaboration API, as the browser sees it: mint a short-lived
 * ticket over an ordinary authenticated fetch, and derive the WebSocket URL
 * it unlocks.
 *
 * Same shape as `canvas-presence-client.ts`, and the same reasoning: the
 * browser's native `WebSocket` constructor cannot set `credentials` or
 * custom headers, so the session cookie cannot ride the handshake - see
 * `services/api/src/routes/document-collab.ts`.
 */

import {API_URL, apiFetch} from './auth-client';

/** Null on any failure - the caller retries with backoff, so one failed mint is not worth surfacing. */
export async function mintDocumentCollabTicket(
  clubId: string,
  documentId: string,
): Promise<string | null> {
  const response = await apiFetch(
    `/api/clubs/${clubId}/documents/${documentId}/collab-ticket`,
    {method: 'POST'},
  );
  if (!response.ok) {
    return null;
  }
  const body = (await response.json()) as {ticket: string};
  return body.ticket;
}

export function documentCollabSocketUrl(
  clubId: string,
  documentId: string,
  ticket: string,
): string {
  const wsOrigin = API_URL.replace(/^http/, 'ws');
  return `${wsOrigin}/api/clubs/${clubId}/documents/${documentId}/collab-ws?ticket=${encodeURIComponent(ticket)}`;
}
