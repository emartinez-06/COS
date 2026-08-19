/**
 * `canvas_nodes` — every object placed on a club's canvas board.
 *
 * Discriminated by `node_type`: `sticky_note`, `link`, `image`, or
 * `entity_embed`. There is no `kanban` type here - COS has no
 * pipeline/board-of-columns concept anywhere else in the product.
 *
 * Content is typed nullable columns, one small group per node kind, rather
 * than a single `data` jsonb column. This schema has no jsonb precedent
 * anywhere else, and with only four fixed kinds a handful of extra nullable
 * columns costs less than an untyped one - see `packages/core/src/canvas.ts`
 * for the discriminated union that is the real enforcement of "a sticky note
 * has text, a link has a URL".
 *
 * No `club_id` here, matching `fund_allocations`/`document_revisions`:
 * reached only through `board_id`, which every read already looks up by
 * `(club_id, board_id)` - a duplicated column would be a second place for it
 * to be wrong.
 */

import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

import {canvasBoards} from './canvas-boards.js';

/** Mirrors `canvasNodeTypeSchema` in @cos/core. */
export const canvasNodeType = pgEnum('canvas_node_type', [
  'sticky_note',
  'link',
  'image',
  'entity_embed',
]);

/** Mirrors `canvasEmbedEntityTypeSchema` in @cos/core. */
export const canvasEmbedEntityType = pgEnum('canvas_embed_entity_type', [
  'calendar',
  'documents',
  'expenses',
]);

/** Mirrors `stickyNoteColorSchema` in @cos/core. */
export const canvasStickyNoteColor = pgEnum('canvas_sticky_note_color', [
  'yellow',
  'pink',
  'blue',
  'green',
  'purple',
]);

/** Mirrors `canvasAccentColorSchema` in @cos/core. */
export const canvasAccentColor = pgEnum('canvas_accent_color', [
  'red',
  'orange',
  'green',
  'teal',
  'purple',
  'pink',
]);

export const canvasNodes = pgTable(
  'canvas_nodes',
  {
    id: text('id').primaryKey(),
    boardId: text('board_id')
      .notNull()
      .references(() => canvasBoards.id, {onDelete: 'cascade'}),
    nodeType: canvasNodeType('node_type').notNull(),
    positionX: integer('position_x').notNull(),
    positionY: integer('position_y').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    /** Stacking order among sibling nodes on the same board. */
    zIndex: integer('z_index').notNull().default(0),
    /**
     * Colours this node's border and every edge leaving it, so a board that
     * has grown into several clusters can be read apart at a glance. `null`
     * is the default border, not a colour in the enum, so it can never
     * collide with a deliberate choice.
     */
    accentColor: canvasAccentColor('accent_color'),
    /** Present on `sticky_note` nodes only. */
    stickyNoteText: text('sticky_note_text'),
    stickyNoteColor: canvasStickyNoteColor('sticky_note_color'),
    /** Present on `link` nodes only. */
    linkUrl: text('link_url'),
    linkTitle: text('link_title'),
    /** Present on `image` nodes only. Resolves through object storage. */
    imageStorageKey: text('image_storage_key'),
    /** Present on `entity_embed` nodes only. Fixed at creation. */
    embedEntityType: canvasEmbedEntityType('embed_entity_type'),
    createdAt: timestamp('created_at', {withTimezone: true})
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true})
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index('canvas_nodes_board_idx').on(table.boardId)],
);
