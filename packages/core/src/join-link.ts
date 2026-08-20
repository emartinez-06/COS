/**
 * Club join links.
 *
 * Unlike an invitation - addressed to one email address, consumed once a
 * person accepts - a join link is addressed to nobody in particular. It is a
 * bearer credential meant to be pasted somewhere a whole group chat can see
 * it, so it has to be usable by many different people and stay open for
 * however long the admin decides the recruiting window should be.
 *
 * The role and position an admin picks apply to *everyone* who joins through
 * that link, for as long as it stays active. There is no per-recipient
 * customization the way there is with email invitations - anyone who wants a
 * different arrangement gets an email invitation instead.
 */

import {z} from 'zod';

import {isoInstantSchema} from './club-event.js';
import {positionSchema, roleSchema} from './role.js';

/**
 * A link is either usable or not. Unlike an invitation there is no
 * `accepted`/`declined` terminal state - a join link is multi-use, so no
 * single acceptance ends its life. It only stops working by expiring or by an
 * admin revoking it early.
 */
export const joinLinkStatusSchema = z.enum(['active', 'revoked']);

export type JoinLinkStatus = z.infer<typeof joinLinkStatusSchema>;

/** The active window an admin may choose, in minutes. */
export const JOIN_LINK_MIN_MINUTES = 5;

/** Ninety days. Bounded so a forgotten link cannot stay a live door forever. */
export const JOIN_LINK_MAX_MINUTES = 90 * 24 * 60;

/** What an admin fills in to create a join link. */
export const joinLinkDraftSchema = z.object({
  role: roleSchema,
  /** The job title granted alongside the role. Optional, and grants nothing. */
  position: positionSchema.nullable().default(null),
  expiresInMinutes: z
    .number()
    .int()
    .min(JOIN_LINK_MIN_MINUTES, `Must stay open for at least ${JOIN_LINK_MIN_MINUTES} minutes`)
    .max(JOIN_LINK_MAX_MINUTES, 'Cannot stay open for more than 90 days'),
});

export type JoinLinkDraft = z.infer<typeof joinLinkDraftSchema>;

export const clubJoinLinkSchema = z.object({
  id: z.string(),
  clubId: z.string(),
  /** The club's display name, denormalised for the same reason invitations carry one. */
  clubName: z.string(),
  token: z.string(),
  role: roleSchema,
  position: positionSchema.nullable(),
  status: joinLinkStatusSchema,
  /** How many people have joined through this link so far. */
  useCount: z.number().int().nonnegative(),
  createdByName: z.string().nullable(),
  createdAt: isoInstantSchema,
  expiresAt: isoInstantSchema,
});

export type ClubJoinLink = z.infer<typeof clubJoinLinkSchema>;

/**
 * What the public, unauthenticated landing page is allowed to see before
 * anyone signs in - the club's name and what joining grants, nothing that
 * identifies who created the link or how it has been used.
 */
export const joinLinkPreviewSchema = z.object({
  clubName: z.string(),
  role: roleSchema,
  position: positionSchema.nullable(),
  expiresAt: isoInstantSchema,
});

export type JoinLinkPreview = z.infer<typeof joinLinkPreviewSchema>;

/**
 * True when the link can still be used to join.
 *
 * Expiry is evaluated against a passed-in instant rather than `Date.now()`,
 * matching `isInvitationActionable`, so both stay pure and testable.
 */
export function isJoinLinkActionable(
  link: Pick<ClubJoinLink, 'status' | 'expiresAt'>,
  now: Date,
): boolean {
  if (link.status !== 'active') {
    return false;
  }
  return new Date(link.expiresAt).getTime() > now.getTime();
}
