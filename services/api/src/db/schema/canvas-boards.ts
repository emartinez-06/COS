/**
 * `canvas_boards` — the club's one shared, officer-only whiteboard.
 *
 * One row per club (a unique index on `club_id` enforces it at the database
 * level, not just by convention), created lazily on first visit rather than
 * at club creation - a club that never opens the canvas never gets a row.
 *
 * There is no CRDT/realtime layer in this repo, so a concurrent edit from
 * two officers at once is last-write-wins by design, matching
 * `CanvasRepository`'s note that the canvas has no `subscribe` - an accepted
 * v1 tradeoff, not an oversight.
 */

import {
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import {clubs} from './club.js';

export const canvasBoards = pgTable(
  'canvas_boards',
  {
    id: text('id').primaryKey(),
    clubId: text('club_id')
      .notNull()
      .references(() => clubs.id, {onDelete: 'cascade'}),
    /** Last-known pan position (flow-space x), so the board reopens where it was left. */
    viewportX: integer('viewport_x').notNull().default(0),
    /** Last-known pan position (flow-space y). */
    viewportY: integer('viewport_y').notNull().default(0),
    /** Last-known zoom, as an integer percent (100 = 100%) - avoids a float column. */
    viewportZoom: integer('viewport_zoom').notNull().default(100),
    createdAt: timestamp('created_at', {withTimezone: true})
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true})
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Enforces "one board per club" at the database level.
    uniqueIndex('canvas_boards_club_idx').on(table.clubId),
  ],
);
