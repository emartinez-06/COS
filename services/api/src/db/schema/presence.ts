/**
 * Where someone last checked in from, and what they said about being
 * available.
 *
 * Keyed on the user, not on the membership. Presence is a property of a person
 * and their browser, not of a club - someone in four clubs is at their desk
 * once, and a per-club row would let the same person be "active" in one club
 * and "offline" in another at the same instant, which is not a state that can
 * exist. Each club reads the same row for its own roster.
 *
 * This is the one table in the schema that is **not** an append-only record.
 * Every other write in this product is history a club may need later; a
 * heartbeat is a fact about right now that is worthless a minute afterwards,
 * and keeping one row per beat would add tens of thousands of rows a day to
 * answer a question only ever asked about the newest of them. So the row is
 * updated in place, and nothing here is auditable by design.
 */

import {pgEnum, pgTable, text, timestamp} from 'drizzle-orm/pg-core';

import {user} from './auth.js';

/**
 * Mirrors `ManualPresenceStatus` in @cos/core, and deliberately does not
 * include `offline`. Offline is the absence of a heartbeat rather than
 * something a person declares, so there is no valid row that stores it.
 */
export const manualPresenceStatus = pgEnum('manual_presence_status', [
  'active',
  'idle',
  'dnd',
]);

export const userPresence = pgTable('user_presence', {
  /**
   * Primary key as well as foreign key: one row per person, updated in place.
   * `cascade` because a deleted account's presence is meaningless and there is
   * no history worth orphaning here.
   */
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, {onDelete: 'cascade'}),

  /**
   * What the person chose. Null means "decide from the heartbeat", which is
   * the default and the common case - most people never touch the control.
   */
  manualStatus: manualPresenceStatus('manual_status'),

  /**
   * When their browser last checked in. Not null: a row only exists because a
   * heartbeat created it, so there is no such thing as a presence row that has
   * never been seen.
   */
  lastSeenAt: timestamp('last_seen_at', {withTimezone: true})
    .notNull()
    .defaultNow(),
});

/**
 * No index on `last_seen_at`.
 *
 * The only query is "the presence rows for these member ids", which is a
 * primary-key lookup, and the active/idle/offline split is computed in
 * `resolvePresence` rather than in SQL - so no query filters or sorts on this
 * column. An index would be written on every heartbeat and read by nothing.
 */
