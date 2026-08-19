/**
 * `canvas_edges` — connections between nodes on a club's canvas board.
 *
 * A plain node-to-node link: no direction semantics beyond which end was
 * dragged from, no label. `source_node_id`/`target_node_id` cascade-delete
 * with their node, so deleting either endpoint removes the connection
 * rather than leaving a dangling edge.
 */

import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import {canvasBoards} from './canvas-boards.js';
import {canvasNodes} from './canvas-nodes.js';

export const canvasEdges = pgTable(
  'canvas_edges',
  {
    id: text('id').primaryKey(),
    boardId: text('board_id')
      .notNull()
      .references(() => canvasBoards.id, {onDelete: 'cascade'}),
    sourceNodeId: text('source_node_id')
      .notNull()
      .references(() => canvasNodes.id, {onDelete: 'cascade'}),
    targetNodeId: text('target_node_id')
      .notNull()
      .references(() => canvasNodes.id, {onDelete: 'cascade'}),
    createdAt: timestamp('created_at', {withTimezone: true})
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('canvas_edges_board_idx').on(table.boardId),
    // Connecting the same pair twice is a no-op, not a duplicate row -
    // enforced here rather than only checked in the store, since two
    // concurrent requests could otherwise both pass an existence check
    // before either commits. Does not dedupe the reverse direction (a
    // separate target->source row); two overlapping arrows from connecting
    // both ways is an acceptable cosmetic quirk, not worth canonicalizing.
    uniqueIndex('canvas_edges_unique_pair_idx').on(
      table.boardId,
      table.sourceNodeId,
      table.targetNodeId,
    ),
  ],
);
