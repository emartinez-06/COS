'use client';

/**
 * The join link API, as the browser sees it.
 *
 * Thin, matching invitation-client.ts's reasoning: nothing here is rendered
 * by a component that needs a swappable transport.
 *
 * `previewJoinLink` and `acceptJoinLink` are called from a page nobody has to
 * be signed in to load, so `apiFetch` carrying no session cookie yet is the
 * expected, ordinary case here - not an error state to guard against.
 */

import type {ClubJoinLink, JoinLinkDraft, JoinLinkPreview} from '@cos/core';

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

export async function listJoinLinks(clubId: string): Promise<ClubJoinLink[]> {
  const response = await apiFetch(`/api/clubs/${clubId}/join-links`);
  if (!response.ok) {
    throw new Error(await messageFrom(response));
  }
  return (await response.json()) as ClubJoinLink[];
}

export async function createJoinLink(
  clubId: string,
  draft: JoinLinkDraft,
): Promise<ClubJoinLink> {
  const response = await apiFetch(`/api/clubs/${clubId}/join-links`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(draft),
  });
  if (!response.ok) {
    throw new Error(await messageFrom(response));
  }
  return (await response.json()) as ClubJoinLink;
}

export async function revokeJoinLink(
  clubId: string,
  linkId: string,
): Promise<void> {
  const response = await apiFetch(
    `/api/clubs/${clubId}/join-links/${linkId}/revoke`,
    {method: 'POST'},
  );
  if (!response.ok) {
    throw new Error(await messageFrom(response));
  }
}

/** What a link grants, or null when it does not exist, has expired, or was revoked. */
export async function previewJoinLink(
  token: string,
): Promise<JoinLinkPreview | null> {
  const response = await apiFetch(`/api/join-links/${token}`);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(await messageFrom(response));
  }
  return (await response.json()) as JoinLinkPreview;
}

export type AcceptedClub = {clubId: string; clubName: string};

/** Joins the club a token points at, as whoever the session cookie names. */
export async function acceptJoinLink(token: string): Promise<AcceptedClub> {
  const response = await apiFetch(`/api/join-links/${token}/accept`, {
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error(await messageFrom(response));
  }
  return (await response.json()) as AcceptedClub;
}
