'use client';

/**
 * The invitation API, as the browser sees it.
 *
 * Thin on purpose. There is no repository port here the way there is for
 * events, because nothing about invitations is rendered by a component that
 * should be swappable against a different transport - and inventing a port for
 * one consumer is the kind of abstraction that has to be maintained without
 * ever paying for itself. If a second consumer appears, this is the file that
 * grows a port.
 */

import type {ClubInvitation, InvitationDraft} from '@cos/core';

import {apiFetch} from './auth-client';

/** Reads the API's error message, falling back to something honest. */
async function messageFrom(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as {error?: string};
    return body.error ?? `Request failed (${response.status})`;
  } catch {
    return `Request failed (${response.status})`;
  }
}

export async function listClubInvitations(
  clubId: string,
): Promise<ClubInvitation[]> {
  const response = await apiFetch(`/api/clubs/${clubId}/invitations`);
  if (!response.ok) {
    throw new Error(await messageFrom(response));
  }
  return (await response.json()) as ClubInvitation[];
}

export async function createInvitation(
  clubId: string,
  draft: InvitationDraft,
): Promise<ClubInvitation> {
  const response = await apiFetch(`/api/clubs/${clubId}/invitations`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(draft),
  });
  if (!response.ok) {
    // 409 carries a sentence worth showing verbatim ("already in this club"),
    // which is why this surfaces the server's message rather than a generic one.
    throw new Error(await messageFrom(response));
  }
  return (await response.json()) as ClubInvitation;
}

/** Pending, unexpired invitations addressed to the signed-in user. */
export async function listMyInvitations(): Promise<ClubInvitation[]> {
  const response = await apiFetch('/api/invitations');
  if (!response.ok) {
    throw new Error(await messageFrom(response));
  }
  return (await response.json()) as ClubInvitation[];
}

export async function respondToInvitation(
  invitationId: string,
  decision: 'accepted' | 'declined',
): Promise<void> {
  const response = await apiFetch(`/api/invitations/${invitationId}/respond`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({decision}),
  });
  // 204 has no body, so `ok` is the whole answer here.
  if (!response.ok) {
    throw new Error(await messageFrom(response));
  }
}
