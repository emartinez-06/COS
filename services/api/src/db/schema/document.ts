/**
 * The document hub's tables.
 *
 * Two tables, and the split between them is the design:
 *
 * - **`documents`** is metadata: title, section, status, who touched it last.
 *   Small, fixed-width, and the only thing a listing reads.
 * - **`document_revisions`** is content, append-only. One row per save, never
 *   updated in place.
 *
 * ## Why content is not a column on `documents`
 *
 * The hub's hot query is "everything in this club, grouped by section", and it
 * runs on every page load for every member. If bodies lived on `documents`,
 * that query would either drag every body across the wire or need a careful
 * column list that one future `select()` would forget. Putting content in
 * another table makes the cheap query the *default* one - there is no body on
 * the table to accidentally select.
 *
 * The second reason is history. Rules and bylaws are exactly the documents
 * where "who changed this, and what did it say before" is a real question, and
 * an append-only revision chain answers it for free. It also matches the
 * append-only ledger docs/ARCHITECTURE.md already commits to.
 *
 * ## How the current content is found
 *
 * `documents.version` names the current revision, and `(document_id, version)`
 * is unique, so reading a document's body is one index lookup. There is
 * deliberately no `current_revision_id` pointer: that would be a second source
 * of truth about which revision is current, and the two could disagree.
 */

import {relations, sql} from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import {user} from './auth.js';
import {clubs} from './club.js';

/** Mirrors `documentSectionSchema` in @cos/core. */
export const documentSection = pgEnum('document_section', [
  'rules',
  'onboarding',
  'meeting_notes',
  'forms',
  'other',
]);

/** Mirrors `documentKindSchema` in @cos/core. */
export const documentKind = pgEnum('document_kind', ['text', 'file']);

/** Mirrors `documentStatusSchema` in @cos/core. */
export const documentStatus = pgEnum('document_status', ['draft', 'published']);

export const documents = pgTable(
  'documents',
  {
    id: text('id').primaryKey(),
    clubId: text('club_id')
      .notNull()
      .references(() => clubs.id, {onDelete: 'cascade'}),
    kind: documentKind('kind').notNull(),
    section: documentSection('section').notNull().default('other'),
    title: text('title').notNull(),
    summary: text('summary').notNull().default(''),
    status: documentStatus('status').notNull().default('draft'),
    /**
     * The current revision number, and the optimistic concurrency token.
     *
     * An edit carries the version it was based on; the update only matches a
     * row still at that version, so two officers saving the same document
     * cannot silently overwrite each other. See `document-store.ts`.
     */
    version: integer('version').notNull().default(1),
    /**
     * The **current** revision's file, denormalised onto the document.
     *
     * All null for a `text` document. Duplicated from `document_revisions`
     * deliberately and for the same reason `version` is: the hub listing shows
     * a file's name and size next to every row, and making that listing join
     * history to render itself would undo the point of splitting the tables.
     * These columns are a cache of "current", written in the same transaction
     * as the revision they mirror.
     *
     * The bytes are not in Postgres on purpose. A 25 MB bytea column is
     * replicated, backed up, and loaded into memory by any query that forgets
     * to exclude it, and none of that buys anything a blob store does not do
     * better.
     */
    storageKey: text('storage_key'),
    fileName: text('file_name'),
    contentType: text('content_type'),
    byteSize: integer('byte_size'),
    /**
     * `set null` rather than cascade, matching events: deleting a person must
     * not delete the club's rules. The name is joined on read.
     */
    createdBy: text('created_by').references(() => user.id, {
      onDelete: 'set null',
    }),
    updatedBy: text('updated_by').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', {withTimezone: true})
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true})
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    /**
     * Soft delete. Set instead of removing the row.
     *
     * These are a club's standing records, and the cost of the two options is
     * not symmetric: a stray row costs bytes, while a hard delete of the
     * bylaws costs the club its bylaws and takes the revision history with it.
     * Every read filters on this being null.
     */
    deletedAt: timestamp('deleted_at', {withTimezone: true}),
  },
  (table) => [
    /**
     * The hub listing, and the only index it needs.
     *
     * `club_id` leads because every query is scoped to one club, which is what
     * makes this scale with the number of clubs rather than with the total
     * number of documents. `section` and `title` follow the page's own
     * grouping and ordering, so the index can also supply the sort order.
     *
     * Measured rather than assumed, at 18,000 documents across 300 clubs: one
     * club's listing touches 58 index rows in 0.06 ms. Note that Postgres
     * picks a *bitmap* index scan at that size and then sorts the ~50 rows,
     * which costs nothing; the ordering only comes free once the planner
     * prefers a plain index scan. The column order is worth keeping either
     * way - it is what makes that choice available at all.
     *
     * Partial on `deleted_at is null`: deleted documents are never listed, so
     * they should not take up space in the index that lists things.
     */
    index('documents_club_section_idx')
      .on(table.clubId, table.section, table.title)
      .where(sql`${table.deletedAt} is null`),
  ],
);

/**
 * Append-only history, covering **both** kinds. One row per save, never
 * updated in place and never deleted.
 *
 * Text revisions carry `content`; file revisions carry `storage_key` and the
 * file's metadata. Exactly one of the two, enforced by a check constraint
 * rather than by convention - a revision that is neither is a lost edit, and a
 * revision that is both is two sources of truth.
 *
 * File replacements get history for the same reason text edits do. "Who
 * changed the constitution and what did the old one say" is the question this
 * table exists to answer, and it does not stop being the question because the
 * constitution happens to be a PDF. Each file revision has its own storage
 * key, so uploading a replacement never overwrites bytes in place - the store
 * is append-only in both media.
 *
 * There is no `club_id` here. Tenancy is enforced by reaching revisions only
 * through their document, which every code path already looks up by
 * `(club_id, id)`. Copying the club id down would create a second place for it
 * to be wrong.
 */
export const documentRevisions = pgTable(
  'document_revisions',
  {
    id: text('id').primaryKey(),
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id, {onDelete: 'cascade'}),
    version: integer('version').notNull(),
    /**
     * The full body as of this save, not a diff. Null on file revisions.
     *
     * Snapshots rather than deltas because reading the current version must be
     * one row - reconstructing a document by replaying 200 diffs to render a
     * page is the wrong trade when the bodies are this small. Postgres TOASTs
     * anything past ~2 KB out of the main heap and compresses it, so the
     * duplication costs far less than it appears to.
     */
    content: text('content'),
    /** Object storage key for this revision's bytes. Null on text revisions. */
    storageKey: text('storage_key'),
    fileName: text('file_name'),
    contentType: text('content_type'),
    byteSize: integer('byte_size'),
    authoredBy: text('authored_by').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', {withTimezone: true})
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Makes "the content at version N" a single index lookup, and makes a
    // duplicate version number impossible rather than merely unlikely - which
    // matters because the version is also the concurrency token.
    uniqueIndex('document_revisions_version_idx').on(
      table.documentId,
      table.version,
    ),
    // Exactly one body, in the database rather than only in the store module.
    // `<>` on two booleans is XOR in Postgres.
    check(
      'document_revisions_one_body',
      sql`(${table.content} is not null) <> (${table.storageKey} is not null)`,
    ),
  ],
);

export const documentsRelations = relations(documents, ({one, many}) => ({
  club: one(clubs, {fields: [documents.clubId], references: [clubs.id]}),
  author: one(user, {fields: [documents.createdBy], references: [user.id]}),
  editor: one(user, {fields: [documents.updatedBy], references: [user.id]}),
  revisions: many(documentRevisions),
}));

export const documentRevisionsRelations = relations(
  documentRevisions,
  ({one}) => ({
    document: one(documents, {
      fields: [documentRevisions.documentId],
      references: [documents.id],
    }),
    author: one(user, {
      fields: [documentRevisions.authoredBy],
      references: [user.id],
    }),
  }),
);
