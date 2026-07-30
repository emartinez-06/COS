/**
 * Club invitations.
 *
 * An invitation is addressed to an **email address**, not to a user id. That
 * is the whole reason it is a durable record rather than a direct membership
 * write: the person being invited may not have an account yet, and an officer
 * should not have to wait for them to sign up before adding them to the club.
 *
 * The consequence is that accepting is a separate step, performed by whoever
 * proves they control that address by signing in with it. Until then the
 * invitation simply sits pending.
 *
 * Note that an invitation carries a `role` and an optional `position`. The
 * role is what the invitee will actually be able to do; the position is only
 * the job title they will be listed under. See role.ts - a position grants
 * nothing, and inviting someone as "Treasurer" does not by itself make them an
 * officer. The role does that.
 */

import {z} from 'zod';

import {isoInstantSchema} from './club-event.js';
import {positionSchema, roleSchema} from './role.js';

/**
 * Where an invitation is in its life.
 *
 * `revoked` is distinct from `declined` on purpose: one is the club changing
 * its mind, the other is the person. Collapsing them would lose the ability to
 * tell an officer why an invitation disappeared.
 */
export const invitationStatusSchema = z.enum([
  'pending',
  'accepted',
  'declined',
  'revoked',
]);

export type InvitationStatus = z.infer<typeof invitationStatusSchema>;

/**
 * What an officer fills in to invite someone.
 *
 * Email is lowercased at the boundary rather than compared case-insensitively
 * later. Addresses are practically case-insensitive, and normalising once
 * means the uniqueness constraint and the recipient lookup cannot disagree.
 */
export const invitationDraftSchema = z.object({
  // Normalise *before* validating, not after. `z.email()` runs against the raw
  // input, so validating first would reject the trailing space that comes free
  // with every pasted address.
  email: z
    .string()
    .transform((value) => value.trim().toLowerCase())
    .pipe(z.email('Enter a valid email address')),
  role: roleSchema,
  /** The job title they will hold. Optional, and grants nothing. */
  position: positionSchema.nullable().default(null),
});

export type InvitationDraft = z.infer<typeof invitationDraftSchema>;

export const clubInvitationSchema = z.object({
  id: z.string(),
  clubId: z.string(),
  /** The club's display name, denormalised so the recipient sees who invited them. */
  clubName: z.string(),
  email: z.email(),
  role: roleSchema,
  position: positionSchema.nullable(),
  status: invitationStatusSchema,
  /**
   * The name of the officer who sent it, resolved on read. Null when that
   * person has since been deleted - the invitation outlives them.
   */
  invitedByName: z.string().nullable(),
  createdAt: isoInstantSchema,
  expiresAt: isoInstantSchema,
});

export type ClubInvitation = z.infer<typeof clubInvitationSchema>;

/**
 * How long an invitation stays good.
 *
 * Bounded because a permanently valid invitation is a permanently valid way
 * into a club, and clubs turn over their officers every year. Two weeks covers
 * a student who checks email slowly without outliving the semester.
 */
export const INVITATION_TTL_DAYS = 14;

/**
 * True when the invitation can still be acted on.
 *
 * Expiry is evaluated against a passed-in instant rather than `Date.now()` so
 * this stays pure and testable, matching the rest of core.
 */
export function isInvitationActionable(
  invitation: Pick<ClubInvitation, 'status' | 'expiresAt'>,
  now: Date,
): boolean {
  if (invitation.status !== 'pending') {
    return false;
  }
  return new Date(invitation.expiresAt).getTime() > now.getTime();
}
