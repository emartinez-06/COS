/**
 * Reading and writing presence.
 *
 * Two operations, and the interesting one is the write: a heartbeat has to
 * create the row the first time and update it every time after, without the
 * caller knowing which case it is in. That is one `INSERT ... ON CONFLICT DO
 * UPDATE`, not a read followed by a branch - two browsers of the same person
 * beating at once would both read "no row" and both insert, and the second
 * would fail on the primary key.
 *
 * Nothing here decides what a status *is*. `resolvePresence` in @cos/core does
 * that, and it is called by the caller of `listClubPresence` so the API, the
 * tests, and the browser all get the same answer from the same function.
 */

import {and, eq, inArray} from 'drizzle-orm';
import type {ManualPresenceStatus, PresenceRecord} from '@cos/core';

import {db} from '../db/client.js';
import {clubMembers, user, userPresence} from '../db/schema/index.js';

/**
 * Records a heartbeat, and optionally the person's own choice.
 *
 * `manualStatus` is a three-way input and each case is different:
 * - `undefined` - a plain heartbeat. Leave whatever they chose alone.
 * - `null` - "go back to automatic". Clear the choice.
 * - a status - set it.
 *
 * Collapsing the first two would mean every heartbeat wiped the person's
 * setting a few seconds after they made it.
 */
export async function recordHeartbeat(
  userId: string,
  manualStatus: ManualPresenceStatus | null | undefined,
): Promise<void> {
  const now = new Date();

  await db
    .insert(userPresence)
    .values({
      userId,
      lastSeenAt: now,
      // On insert there is no prior choice to preserve, so `undefined` and
      // `null` mean the same thing here and both store null.
      manualStatus: manualStatus ?? null,
    })
    .onConflictDoUpdate({
      target: userPresence.userId,
      set: {
        lastSeenAt: now,
        // Only touch the choice when the caller actually said something about
        // it. Spreading a conditional object is what keeps `undefined` out of
        // the SET list rather than writing null into it.
        ...(manualStatus === undefined ? {} : {manualStatus}),
      },
    });
}

export interface ClubPresenceRow extends PresenceRecord {
  name: string;
  image: string | null;
}

/**
 * Every member of the club, with their presence if they have any.
 *
 * A left join rather than an inner one: a member who has never opened the app
 * since presence shipped has no row, and they must still appear in the roster
 * - as offline, which is what `resolvePresence` returns for a null
 * `lastSeenAt`. An inner join would silently shorten the roster to "people
 * who have been seen", which is a different list.
 */
export async function listClubPresence(
  clubId: string,
): Promise<ClubPresenceRow[]> {
  const rows = await db
    .select({
      userId: user.id,
      name: user.name,
      image: user.image,
      manualStatus: userPresence.manualStatus,
      lastSeenAt: userPresence.lastSeenAt,
    })
    .from(clubMembers)
    .innerJoin(user, eq(clubMembers.userId, user.id))
    .leftJoin(userPresence, eq(userPresence.userId, user.id))
    .where(eq(clubMembers.clubId, clubId));

  return rows.map((row) => ({
    userId: row.userId,
    name: row.name,
    image: row.image ?? null,
    manualStatus: row.manualStatus ?? null,
    // The wire format is an ISO instant with an offset, like every other
    // timestamp this API returns.
    lastSeenAt: row.lastSeenAt ? row.lastSeenAt.toISOString() : null,
  }));
}

/**
 * One person's own presence, for echoing their setting back to them after a
 * heartbeat without making them wait for the next roster poll.
 */
export async function findPresence(
  userId: string,
): Promise<PresenceRecord | null> {
  const [row] = await db
    .select({
      userId: userPresence.userId,
      manualStatus: userPresence.manualStatus,
      lastSeenAt: userPresence.lastSeenAt,
    })
    .from(userPresence)
    .where(eq(userPresence.userId, userId))
    .limit(1);

  if (!row) {
    return null;
  }

  return {
    userId: row.userId,
    manualStatus: row.manualStatus ?? null,
    lastSeenAt: row.lastSeenAt ? row.lastSeenAt.toISOString() : null,
  };
}

/**
 * Whether someone is in a club. The roster route is capability-gated like the
 * rest, but membership is what decides *which* club's roster they may read.
 */
export async function isClubMember(
  userId: string,
  clubId: string,
): Promise<boolean> {
  const [row] = await db
    .select({userId: clubMembers.userId})
    .from(clubMembers)
    .where(and(eq(clubMembers.userId, userId), eq(clubMembers.clubId, clubId)))
    .limit(1);

  return Boolean(row);
}

/** Used by the tests to reset between runs. */
export async function deletePresenceFor(userIds: string[]): Promise<void> {
  if (userIds.length === 0) {
    return;
  }
  await db.delete(userPresence).where(inArray(userPresence.userId, userIds));
}
