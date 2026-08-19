'use client';

/**
 * The canvas presence API, as the browser sees it: mint a short-lived ticket
 * over an ordinary authenticated fetch, and derive the WebSocket URL it
 * unlocks.
 *
 * Thin, like `presence-client.ts` - the socket's own open/reconnect/message
 * lifecycle lives in `canvas-presence-store.tsx`, not here. The ticket
 * indirection exists because the browser's native `WebSocket` constructor
 * cannot set `credentials` or custom headers the way `fetch` can, so the
 * session cookie cannot be trusted to ride along on the handshake - see
 * `services/api/src/routes/canvas-presence.ts` for the full reasoning.
 */

import {API_URL, apiFetch} from './auth-client';

/** Null on any failure - the caller retries with backoff, so one failed mint is not worth surfacing. */
export async function mintCanvasPresenceTicket(
  clubId: string,
): Promise<string | null> {
  const response = await apiFetch(
    `/api/clubs/${clubId}/canvas/presence-ticket`,
    {method: 'POST'},
  );
  if (!response.ok) {
    return null;
  }
  const body = (await response.json()) as {ticket: string};
  return body.ticket;
}

/** The socket lives on the API origin, same as every other canvas call - `API_URL` with the scheme swapped. */
export function canvasPresenceSocketUrl(clubId: string, ticket: string): string {
  const wsOrigin = API_URL.replace(/^http/, 'ws');
  return `${wsOrigin}/api/clubs/${clubId}/canvas/presence-ws?ticket=${encodeURIComponent(ticket)}`;
}
