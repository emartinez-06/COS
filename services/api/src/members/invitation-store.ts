/**
 * Reading and writing invitations, and the conversion between the database row
 * and the `ClubInvitation` shape in @cos/core.
 *
 * Accepting an invitation is the interesting operation here. It has to create
 * a membership and resolve the invitation together, which is why it runs in a
 * transaction: a crash between the two would either give someone access with
 * no record of why, or burn their invitation without letting them in.
 */

import {randomUUID} from 'node:crypto';
import type {
  ClubInvitation,
  InvitationDraft,
  Position,
  Role,
} from '@cos/core';
import {INVITATION_TTL_DAYS, isInvitationActionable} from '@cos/core';
import {and, desc, eq} from 'drizzle-orm';

import {db} from '../db/client.js';
import {user} from '../db/schema/auth.js';
import {clubInvitations, clubMembers, clubs} from '../db/schema/club.js';

type InvitationRow = typeof clubInvitations.$inferSelect;

function toInvitation(
  row: InvitationRow,
  clubName: string,
  invitedByName: string | null,
): ClubInvitation {
  return {
    id: row.id,
    clubId: row.clubId,
    clubName,
    email: row.email,
    role: row.role,
    position: row.position ?? null,
    status: row.status,
    invitedByName,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}

function expiryFrom(now: Date): Date {
  const expires = new Date(now);
  expires.setDate(expires.getDate() + INVITATION_TTL_DAYS);
  return expires;
}

/** Why an invitation could not be created. */
export type InviteFailure = 'already-a-member' | 'already-invited';

export async function createInvitation(
  clubId: string,
  draft: InvitationDraft,
  invitedBy: string,
): Promise<{invitation: ClubInvitation} | {error: InviteFailure}> {
  // Inviting someone who is already in the club is a mistake worth naming
  // rather than a no-op: the officer is usually looking at a stale roster.
  const existing = await db
    .select({userId: clubMembers.userId})
    .from(clubMembers)
    .innerJoin(user, eq(clubMembers.userId, user.id))
    .where(and(eq(clubMembers.clubId, clubId), eq(user.email, draft.email)))
    .limit(1);

  if (existing.length > 0) {
    return {error: 'already-a-member'};
  }

  const now = new Date();
  const [row] = await db
    .insert(clubInvitations)
    .values({
      id: `inv_${randomUUID()}`,
      clubId,
      email: draft.email,
      role: draft.role,
      position: draft.position,
      invitedBy,
      expiresAt: expiryFrom(now),
    })
    // The partial unique index already forbids a second pending invitation for
    // the same address. Catching it here turns a 500 into a sentence the
    // officer can act on.
    .onConflictDoNothing()
    .returning();

  if (!row) {
    return {error: 'already-invited'};
  }

  const [club] = await db
    .select({name: clubs.name})
    .from(clubs)
    .where(eq(clubs.id, clubId))
    .limit(1);

  const [inviter] = await db
    .select({name: user.name})
    .from(user)
    .where(eq(user.id, invitedBy))
    .limit(1);

  return {
    invitation: toInvitation(row, club?.name ?? '', inviter?.name ?? null),
  };
}

/** Every invitation a club has sent, newest first. */
export async function listClubInvitations(
  clubId: string,
): Promise<ClubInvitation[]> {
  const rows = await db
    .select({
      invitation: clubInvitations,
      clubName: clubs.name,
      invitedByName: user.name,
    })
    .from(clubInvitations)
    .innerJoin(clubs, eq(clubInvitations.clubId, clubs.id))
    .leftJoin(user, eq(clubInvitations.invitedBy, user.id))
    .where(eq(clubInvitations.clubId, clubId))
    .orderBy(desc(clubInvitations.createdAt));

  return rows.map((row) =>
    toInvitation(row.invitation, row.clubName, row.invitedByName),
  );
}

/**
 * Invitations waiting for this email address, across every club.
 *
 * Keyed on the address rather than a user id, because that is what an
 * invitation is addressed to. Expired ones are filtered in code using the same
 * pure predicate the client uses, so both agree on what "actionable" means.
 */
export async function listPendingInvitationsFor(
  email: string,
): Promise<ClubInvitation[]> {
  const rows = await db
    .select({
      invitation: clubInvitations,
      clubName: clubs.name,
      invitedByName: user.name,
    })
    .from(clubInvitations)
    .innerJoin(clubs, eq(clubInvitations.clubId, clubs.id))
    .leftJoin(user, eq(clubInvitations.invitedBy, user.id))
    .where(
      and(
        eq(clubInvitations.email, email.toLowerCase()),
        eq(clubInvitations.status, 'pending'),
      ),
    )
    .orderBy(desc(clubInvitations.createdAt));

  const now = new Date();
  return rows
    .map((row) => toInvitation(row.invitation, row.clubName, row.invitedByName))
    .filter((invitation) => isInvitationActionable(invitation, now));
}

export type RespondFailure = 'not-found' | 'not-actionable';

/**
 * Accept or decline, on behalf of the person who holds the address.
 *
 * `email` is passed in from the *session*, never from the request body. That
 * is the entire authorization check for this operation: an invitation is a
 * bearer token addressed to an address, and proving you hold the address is
 * how you claim it.
 */
export async function respondToInvitation(
  invitationId: string,
  userId: string,
  email: string,
  decision: 'accepted' | 'declined',
): Promise<{ok: true} | {error: RespondFailure}> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(clubInvitations)
      .where(
        and(
          eq(clubInvitations.id, invitationId),
          eq(clubInvitations.email, email.toLowerCase()),
        ),
      )
      .limit(1);

    if (!row) {
      // Also the answer when the invitation belongs to someone else's address:
      // "not found" rather than "not yours", so an id cannot be probed.
      return {error: 'not-found' as const};
    }

    if (
      !isInvitationActionable(
        {status: row.status, expiresAt: row.expiresAt.toISOString()},
        new Date(),
      )
    ) {
      return {error: 'not-actionable' as const};
    }

    await tx
      .update(clubInvitations)
      .set({status: decision})
      .where(eq(clubInvitations.id, invitationId));

    if (decision === 'accepted') {
      await tx
        .insert(clubMembers)
        .values({
          userId,
          clubId: row.clubId,
          role: row.role as Role,
          position: (row.position ?? null) as Position | null,
        })
        // Someone already in the club accepting a stale invitation should not
        // fail, and must not silently overwrite the role they already hold.
        .onConflictDoNothing({
          target: [clubMembers.userId, clubMembers.clubId],
        });
    }

    return {ok: true as const};
  });
}
