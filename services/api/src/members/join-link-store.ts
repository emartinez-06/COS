/**
 * Reading and writing join links, and the conversion between the database row
 * and the `ClubJoinLink`/`JoinLinkPreview` shapes in @cos/core.
 *
 * Accepting through a join link, like accepting an invitation, has to create
 * a membership and record the use together - it runs in a transaction for the
 * same reason. Unlike an invitation, a second accept from someone already a
 * member is not an error: a public, multi-use link is exactly the kind of
 * thing a person might click twice, and that must stay harmless.
 */

import {randomBytes, randomUUID} from 'node:crypto';
import type {
  ClubJoinLink,
  JoinLinkDraft,
  JoinLinkPreview,
  Position,
  Role,
} from '@cos/core';
import {isJoinLinkActionable} from '@cos/core';
import {and, desc, eq} from 'drizzle-orm';

import {db} from '../db/client.js';
import {user} from '../db/schema/auth.js';
import {clubJoinLinks, clubMembers, clubs} from '../db/schema/club.js';

type JoinLinkRow = typeof clubJoinLinks.$inferSelect;

/** URL-safe and high-entropy - this is a bearer credential, not a lookup key. */
function generateToken(): string {
  return randomBytes(24).toString('base64url');
}

function toJoinLink(
  row: JoinLinkRow,
  clubName: string,
  createdByName: string | null,
): ClubJoinLink {
  return {
    id: row.id,
    clubId: row.clubId,
    clubName,
    token: row.token,
    role: row.role,
    position: row.position ?? null,
    status: row.status,
    useCount: row.useCount,
    createdByName,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}

export async function createJoinLink(
  clubId: string,
  draft: JoinLinkDraft,
  createdBy: string,
): Promise<ClubJoinLink> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + draft.expiresInMinutes * 60_000);

  const [row] = await db
    .insert(clubJoinLinks)
    .values({
      id: `join_${randomUUID()}`,
      clubId,
      token: generateToken(),
      role: draft.role,
      position: draft.position,
      createdBy,
      expiresAt,
    })
    .returning();

  if (!row) {
    throw new Error('Failed to create join link');
  }

  const [club] = await db
    .select({name: clubs.name})
    .from(clubs)
    .where(eq(clubs.id, clubId))
    .limit(1);

  const [creator] = await db
    .select({name: user.name})
    .from(user)
    .where(eq(user.id, createdBy))
    .limit(1);

  return toJoinLink(row, club?.name ?? '', creator?.name ?? null);
}

/** Every join link a club has ever created, newest first. */
export async function listClubJoinLinks(
  clubId: string,
): Promise<ClubJoinLink[]> {
  const rows = await db
    .select({
      link: clubJoinLinks,
      clubName: clubs.name,
      createdByName: user.name,
    })
    .from(clubJoinLinks)
    .innerJoin(clubs, eq(clubJoinLinks.clubId, clubs.id))
    .leftJoin(user, eq(clubJoinLinks.createdBy, user.id))
    .where(eq(clubJoinLinks.clubId, clubId))
    .orderBy(desc(clubJoinLinks.createdAt));

  return rows.map((row) => toJoinLink(row.link, row.clubName, row.createdByName));
}

export type RevokeFailure = 'not-found';

export async function revokeJoinLink(
  clubId: string,
  linkId: string,
): Promise<{ok: true} | {error: RevokeFailure}> {
  const [row] = await db
    .update(clubJoinLinks)
    .set({status: 'revoked'})
    .where(and(eq(clubJoinLinks.id, linkId), eq(clubJoinLinks.clubId, clubId)))
    .returning({id: clubJoinLinks.id});

  return row ? {ok: true} : {error: 'not-found'};
}

/**
 * The public, unauthenticated preview a landing page shows before anyone
 * signs in. Returns null for a token that does not exist, has expired, or has
 * been revoked - the caller cannot tell those apart, matching the "not found"
 * answer invitations give for someone else's address.
 */
export async function previewJoinLink(
  token: string,
): Promise<JoinLinkPreview | null> {
  const [row] = await db
    .select({link: clubJoinLinks, clubName: clubs.name})
    .from(clubJoinLinks)
    .innerJoin(clubs, eq(clubJoinLinks.clubId, clubs.id))
    .where(eq(clubJoinLinks.token, token))
    .limit(1);

  if (!row) {
    return null;
  }

  const link = toJoinLink(row.link, row.clubName, null);
  if (!isJoinLinkActionable(link, new Date())) {
    return null;
  }

  return {
    clubName: row.clubName,
    role: link.role,
    position: link.position,
    expiresAt: link.expiresAt,
  };
}

export type AcceptJoinLinkFailure = 'invalid';

/**
 * Join the club a token points at. Idempotent for someone already a member -
 * a link meant to be clicked by many people, possibly more than once by the
 * same person, must not error on a repeat.
 */
export async function acceptJoinLink(
  token: string,
  userId: string,
): Promise<{clubId: string; clubName: string} | {error: AcceptJoinLinkFailure}> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({link: clubJoinLinks, clubName: clubs.name})
      .from(clubJoinLinks)
      .innerJoin(clubs, eq(clubJoinLinks.clubId, clubs.id))
      .where(eq(clubJoinLinks.token, token))
      .limit(1);

    if (!row) {
      return {error: 'invalid' as const};
    }

    const link = toJoinLink(row.link, row.clubName, null);
    if (!isJoinLinkActionable(link, new Date())) {
      return {error: 'invalid' as const};
    }

    const inserted = await tx
      .insert(clubMembers)
      .values({
        userId,
        clubId: link.clubId,
        role: link.role as Role,
        position: (link.position ?? null) as Position | null,
      })
      .onConflictDoNothing({target: [clubMembers.userId, clubMembers.clubId]})
      .returning({userId: clubMembers.userId});

    // Only a genuinely new membership grows the use count - a repeat click by
    // someone already in the club is not a second person joining.
    if (inserted.length > 0) {
      await tx
        .update(clubJoinLinks)
        .set({useCount: row.link.useCount + 1})
        .where(eq(clubJoinLinks.id, row.link.id));
    }

    return {clubId: link.clubId, clubName: row.clubName};
  });
}
