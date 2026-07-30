/**
 * Reading a person's role within a club.
 *
 * This is the bridge between identity (better-auth knows *who* you are) and
 * authorization (@cos/core knows what a role *may do*). Nothing else should
 * query club_members for permission purposes.
 */

import type {Role} from '@cos/core';
import {and, eq} from 'drizzle-orm';

import {db} from '../db/client.js';
import {clubMembers, clubs} from '../db/schema/club.js';

export interface Membership {
  clubId: string;
  userId: string;
  role: Role;
}

/** The user's role in one club, or null when they are not a member. */
export async function findMembership(
  userId: string,
  clubId: string,
): Promise<Membership | null> {
  const [row] = await db
    .select({
      clubId: clubMembers.clubId,
      userId: clubMembers.userId,
      role: clubMembers.role,
    })
    .from(clubMembers)
    .where(and(eq(clubMembers.userId, userId), eq(clubMembers.clubId, clubId)))
    .limit(1);

  return row ?? null;
}

export interface ClubMembershipSummary {
  clubId: string;
  name: string;
  slug: string;
  role: Role;
}

/**
 * Every club the user belongs to, with their role in each.
 *
 * Returned as a set rather than a single "active" club on purpose: the
 * dashboard shows one merged calendar across a student's clubs, which is
 * exactly what better-auth's organization plugin could not express.
 */
export async function listMemberships(
  userId: string,
): Promise<ClubMembershipSummary[]> {
  return db
    .select({
      clubId: clubs.id,
      name: clubs.name,
      slug: clubs.slug,
      role: clubMembers.role,
    })
    .from(clubMembers)
    .innerJoin(clubs, eq(clubMembers.clubId, clubs.id))
    .where(eq(clubMembers.userId, userId))
    .orderBy(clubs.name);
}
