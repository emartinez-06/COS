/**
 * Live collaborative editing state for text documents.
 *
 * Deliberately separate from `document.ts`'s `document_revisions`, which
 * stays the audit ledger - full, readable snapshots at human-meaningful
 * intervals, attributed to a person. This table is the opposite shape: a
 * stream of opaque Yjs update operations, appended as people type, at a
 * completely different write frequency. `services/api/src/documents/
 * document-collab.ts` periodically compacts a run of these into a single new
 * `document_revisions` row, which is what keeps the two models coherent - the
 * ledger keeps getting readable versions, not one per keystroke.
 *
 * See docs/COLLABORATIVE-EDITING.md for the full design.
 */

import {index, pgTable, text, timestamp, customType} from 'drizzle-orm/pg-core';

import {user} from './auth.js';
import {documents} from './document.js';

/**
 * Postgres `bytea`, for the raw Yjs update. Drizzle has no first-class bytea
 * helper, so this is the documented `customType` escape hatch.
 *
 * `toDriver`/`fromDriver` convert explicitly to/from `Buffer` rather than
 * relying on `pg` accepting a bare `Uint8Array` for a bytea parameter - `pg`
 * checks `Buffer.isBuffer()` when serializing, so a `Uint8Array` that is not
 * itself a `Buffer` (as Yjs's own `Y.encodeStateAsUpdate` returns) needs the
 * explicit wrap. Reading back always hands a `Buffer`, which already
 * satisfies `Uint8Array` - `fromDriver` exists mainly so the exported type is
 * the plain `Uint8Array` every caller here actually works with.
 */
const bytea = customType<{data: Uint8Array; driverData: Buffer}>({
  dataType() {
    return 'bytea';
  },
  toDriver(value) {
    return Buffer.from(value);
  },
  fromDriver(value) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  },
});

export const documentCrdtUpdates = pgTable(
  'document_crdt_updates',
  {
    id: text('id').primaryKey(),
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id, {onDelete: 'cascade'}),
    update: bytea('update').notNull(),
    /**
     * `set null` rather than cascade, matching every other authorship column
     * in this schema: deleting a person must not delete what they wrote.
     */
    authoredBy: text('authored_by').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', {withTimezone: true})
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Compaction reads "every update for this document, oldest first" - the
    // only query this table serves besides the insert.
    index('document_crdt_updates_document_id_idx').on(
      table.documentId,
      table.createdAt,
    ),
  ],
);
