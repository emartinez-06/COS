/**
 * Reading and writing events, and the conversion between the database row and
 * the `ClubEvent` shape in @cos/core.
 *
 * The conversion lives here rather than in the route handlers so there is
 * exactly one place that knows a `timestamptz` column becomes an ISO string
 * with an offset, and that `createdBy` is a user id in the database but a
 * display name in the domain.
 */

import {randomUUID} from 'node:crypto';
import type {ClubEvent, EventDraft, EventPatch} from '@cos/core';
import {and, asc, eq} from 'drizzle-orm';

import {db} from '../db/client.js';
import {user} from '../db/schema/auth.js';
import {events} from '../db/schema/event.js';

type EventRow = typeof events.$inferSelect;

/** A row plus the author's display name, which lives on another table. */
function toClubEvent(row: EventRow, authorName: string | null): ClubEvent {
  return {
    id: row.id,
    clubId: row.clubId,
    title: row.title,
    description: row.description,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    location: row.location,
    speaker: row.speaker ?? null,
    links: row.links,
    category: row.category,
    visibility: row.visibility,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    // A deleted account leaves its events behind; the domain still needs a
    // name to render, so say so plainly rather than showing an empty byline.
    createdBy: authorName ?? 'Former member',
  };
}

/** Every event for a club, earliest first. */
export async function listEvents(clubId: string): Promise<ClubEvent[]> {
  const rows = await db
    .select({event: events, authorName: user.name})
    .from(events)
    .leftJoin(user, eq(events.createdBy, user.id))
    .where(eq(events.clubId, clubId))
    .orderBy(asc(events.startsAt));

  return rows.map((row) => toClubEvent(row.event, row.authorName));
}

/** One event, scoped to its club so an id from another club cannot be read. */
export async function findEvent(
  clubId: string,
  eventId: string,
): Promise<ClubEvent | null> {
  const [row] = await db
    .select({event: events, authorName: user.name})
    .from(events)
    .leftJoin(user, eq(events.createdBy, user.id))
    .where(and(eq(events.clubId, clubId), eq(events.id, eventId)))
    .limit(1);

  return row ? toClubEvent(row.event, row.authorName) : null;
}

export async function createEvent(
  clubId: string,
  draft: EventDraft,
  authorId: string,
): Promise<ClubEvent> {
  const [row] = await db
    .insert(events)
    .values({
      id: `evt_${randomUUID()}`,
      clubId,
      title: draft.title,
      description: draft.description,
      startsAt: new Date(draft.startsAt),
      endsAt: new Date(draft.endsAt),
      location: draft.location,
      speaker: draft.speaker,
      links: [...draft.links],
      category: draft.category,
      visibility: draft.visibility,
      createdBy: authorId,
    })
    .returning();

  if (!row) {
    throw new Error('Insert returned no row');
  }

  const [author] = await db
    .select({name: user.name})
    .from(user)
    .where(eq(user.id, authorId))
    .limit(1);

  return toClubEvent(row, author?.name ?? null);
}

/**
 * Applies a partial update. Returns null when the event does not exist in
 * this club, so the caller can answer 404 without a separate read.
 */
export async function updateEvent(
  clubId: string,
  eventId: string,
  patch: EventPatch,
): Promise<ClubEvent | null> {
  // Only the keys actually present are written, so omitting a field leaves it
  // alone rather than nulling it.
  const changes: Partial<typeof events.$inferInsert> = {};
  if (patch.title !== undefined) changes.title = patch.title;
  if (patch.description !== undefined) changes.description = patch.description;
  if (patch.startsAt !== undefined) changes.startsAt = new Date(patch.startsAt);
  if (patch.endsAt !== undefined) changes.endsAt = new Date(patch.endsAt);
  if (patch.location !== undefined) changes.location = patch.location;
  if (patch.speaker !== undefined) changes.speaker = patch.speaker;
  if (patch.links !== undefined) changes.links = [...patch.links];
  if (patch.category !== undefined) changes.category = patch.category;
  if (patch.visibility !== undefined) changes.visibility = patch.visibility;

  if (Object.keys(changes).length === 0) {
    return findEvent(clubId, eventId);
  }

  const [row] = await db
    .update(events)
    .set(changes)
    .where(and(eq(events.clubId, clubId), eq(events.id, eventId)))
    .returning();

  if (!row) {
    return null;
  }

  const [author] = row.createdBy
    ? await db
        .select({name: user.name})
        .from(user)
        .where(eq(user.id, row.createdBy))
        .limit(1)
    : [];

  return toClubEvent(row, author?.name ?? null);
}

/** True when a row was actually removed. */
export async function deleteEvent(
  clubId: string,
  eventId: string,
): Promise<boolean> {
  const removed = await db
    .delete(events)
    .where(and(eq(events.clubId, clubId), eq(events.id, eventId)))
    .returning({id: events.id});

  return removed.length > 0;
}
