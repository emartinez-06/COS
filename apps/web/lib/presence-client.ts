'use client';

/**
 * The presence API, as the browser sees it.
 *
 * Thin, like `invitation-client`, and for the same reason: no component here
 * needs presence to be swappable against a different transport, so there is no
 * port in core to satisfy. If a second consumer ever needs one, this is the
 * file that grows it.
 */

import type {ManualPresenceStatus, MemberPresence, PresenceStatus} from '@cos/core';

import {apiFetch} from './auth-client';

export interface OwnPresence {
  status: PresenceStatus;
  manualStatus: ManualPresenceStatus | null;
}

/**
 * A heartbeat, optionally carrying a change of status.
 *
 * `manualStatus` is deliberately three-valued and the caller's `undefined` has
 * to survive all the way to the server: omitted means "just a heartbeat, leave
 * my choice alone", while `null` means "go back to automatic". Serialising an
 * omitted field as null would wipe the person's setting a few seconds after
 * they made it.
 */
export async function sendHeartbeat(
  manualStatus?: ManualPresenceStatus | null,
): Promise<OwnPresence | null> {
  const body = manualStatus === undefined ? {} : {manualStatus};

  const response = await apiFetch('/api/presence', {
    method: 'PUT',
    body: JSON.stringify(body),
  });

  // A failed heartbeat is not worth surfacing. The next one is 30 seconds
  // away, the consequence of missing one is a slightly stale dot, and a toast
  // saying "could not report that you are online" helps nobody.
  if (!response.ok) {
    return null;
  }

  return (await response.json()) as OwnPresence;
}

export async function listClubPresence(
  clubId: string,
): Promise<MemberPresence[]> {
  const response = await apiFetch(`/api/clubs/${clubId}/presence`);
  if (!response.ok) {
    return [];
  }
  return (await response.json()) as MemberPresence[];
}
