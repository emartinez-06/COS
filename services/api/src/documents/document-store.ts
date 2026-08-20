/**
 * Reading and writing documents.
 *
 * Three things here are worth understanding before changing anything:
 *
 * **1. Reads are split by cost.** `listDocuments` never touches
 * `document_revisions` and never returns a body. `findDocument` fetches
 * exactly one body. That distinction is the reason the hub stays cheap as a
 * club accumulates documents, and it is enforced by the shapes these functions
 * return rather than by remembering to write a careful `select`.
 *
 * **2. Writes are optimistically concurrent.** A content edit carries the
 * version it was based on, and the `UPDATE` only matches a row still at that
 * version. Two officers editing the same meeting notes is the ordinary case;
 * without this the second save silently erases the first and nobody finds out.
 *
 * **3. Content is append-only.** Nothing here ever updates a revision row or
 * overwrites bytes in object storage. An edit writes a new revision at a new
 * version, and a file replacement writes to a new versioned key.
 */

import {randomUUID} from 'node:crypto';
import type {
  ClubDocument,
  ClubDocumentDetail,
  DocumentPatch,
  DocumentRevision,
  DocumentRevisionDetail,
  FileDocumentDraft,
  TextDocumentDraft,
} from '@cos/core';
import {and, desc, eq, isNull, sql} from 'drizzle-orm';
import {alias} from 'drizzle-orm/pg-core';

import {db} from '../db/client.js';
import {user} from '../db/schema/auth.js';
import {documentRevisions, documents} from '../db/schema/document.js';
import {documentStorageKey, getObject, putObject} from '../storage/object-store.js';

type DocumentRow = typeof documents.$inferSelect;
type RevisionRow = typeof documentRevisions.$inferSelect;

/**
 * Whether this caller may see documents that are still drafts.
 *
 * Resolved from the caller's role by the route, using `canSeeDraftDocuments`
 * in @cos/core, and threaded into every read. It is a parameter rather than
 * something this module works out for itself so that the authorization
 * decision stays in one place.
 */
export interface ReadScope {
  includeDrafts: boolean;
}

/** A deleted account still has to render a byline. */
const FORMER_MEMBER = 'Former member';

// Two joins onto the same table need distinct aliases.
const createdByUser = alias(user, 'created_by_user');
const updatedByUser = alias(user, 'updated_by_user');
const revisionAuthor = alias(user, 'revision_author');

function toClubDocument(
  row: DocumentRow,
  createdByName: string | null,
  updatedByName: string | null,
): ClubDocument {
  return {
    id: row.id,
    clubId: row.clubId,
    kind: row.kind,
    section: row.section,
    title: row.title,
    summary: row.summary,
    status: row.status,
    version: row.version,
    file:
      row.kind === 'file'
        ? {
            name: row.fileName ?? '',
            contentType: row.contentType ?? 'application/octet-stream',
            byteSize: row.byteSize ?? 0,
          }
        : null,
    createdBy: createdByName ?? FORMER_MEMBER,
    updatedBy: updatedByName ?? FORMER_MEMBER,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toRevision(row: RevisionRow, authorName: string | null): DocumentRevision {
  return {
    id: row.id,
    documentId: row.documentId,
    version: row.version,
    authoredBy: authorName ?? FORMER_MEMBER,
    charCount: row.content === null ? null : row.content.length,
    file:
      row.storageKey === null
        ? null
        : {
            name: row.fileName ?? '',
            contentType: row.contentType ?? 'application/octet-stream',
            byteSize: row.byteSize ?? 0,
          },
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * The conditions every read applies: this club, not deleted, and published
 * unless the caller may see drafts.
 *
 * Built in one place because a forgotten `deleted_at is null` shows a member a
 * document the club believes it removed, and a forgotten status filter shows
 * them half-written meeting notes. Neither would fail a typecheck.
 */
function visibleWhere(clubId: string, scope: ReadScope) {
  return and(
    eq(documents.clubId, clubId),
    isNull(documents.deletedAt),
    scope.includeDrafts ? undefined : eq(documents.status, 'published'),
  );
}

/**
 * The club's documents, without bodies.
 *
 * Ordered by section then title, which is exactly the order
 * `documents_club_section_idx` stores them in, so this is an index scan with
 * no sort step.
 */
export async function listDocuments(
  clubId: string,
  scope: ReadScope,
): Promise<ClubDocument[]> {
  const rows = await db
    .select({
      document: documents,
      createdByName: createdByUser.name,
      updatedByName: updatedByUser.name,
    })
    .from(documents)
    .leftJoin(createdByUser, eq(documents.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(documents.updatedBy, updatedByUser.id))
    .where(visibleWhere(clubId, scope))
    .orderBy(documents.section, documents.title);

  return rows.map((row) =>
    toClubDocument(row.document, row.createdByName, row.updatedByName),
  );
}

/** The metadata row alone, for paths that do not need a body. */
async function findRow(
  clubId: string,
  documentId: string,
  scope: ReadScope,
): Promise<DocumentRow | null> {
  const [row] = await db
    .select()
    .from(documents)
    .where(and(visibleWhere(clubId, scope), eq(documents.id, documentId)))
    .limit(1);

  return row ?? null;
}

/**
 * The body of a document's current revision, or null for a file document.
 *
 * Throws rather than returning `''` when the revision is missing. That state
 * is impossible - every write creates the document and its revision in one
 * transaction - so reaching it means something is genuinely broken, and these
 * are the club's standing records. A document that silently reads as empty
 * forever is a worse outcome than one read failing loudly enough to notice.
 *
 * This is not hypothetical: an earlier version of `updateDocument` called
 * `toDetail` from inside its transaction, where this query could not yet see
 * the revision just written, and the `?? ''` fallback turned that into an
 * empty document instead of an error.
 */
async function currentContent(row: DocumentRow): Promise<string | null> {
  if (row.kind !== 'text') {
    return null;
  }
  const [revision] = await db
    .select({content: documentRevisions.content})
    .from(documentRevisions)
    .where(
      and(
        eq(documentRevisions.documentId, row.id),
        eq(documentRevisions.version, row.version),
      ),
    )
    .limit(1);

  if (!revision) {
    throw new Error(
      `Document ${row.id} is at version ${row.version} but has no revision at that version`,
    );
  }

  return revision.content ?? '';
}

async function toDetail(row: DocumentRow): Promise<ClubDocumentDetail> {
  const [names] = await db
    .select({
      createdByName: createdByUser.name,
      updatedByName: updatedByUser.name,
    })
    .from(documents)
    .leftJoin(createdByUser, eq(documents.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(documents.updatedBy, updatedByUser.id))
    .where(eq(documents.id, row.id))
    .limit(1);

  return {
    ...toClubDocument(
      row,
      names?.createdByName ?? null,
      names?.updatedByName ?? null,
    ),
    content: await currentContent(row),
  };
}

/** One document with its body, or null when it is not visible to this caller. */
export async function findDocument(
  clubId: string,
  documentId: string,
  scope: ReadScope,
): Promise<ClubDocumentDetail | null> {
  const row = await findRow(clubId, documentId, scope);
  return row ? toDetail(row) : null;
}

/**
 * Creates an authored document and its first revision.
 *
 * In a transaction because a document whose `version` names a revision that
 * does not exist is a document that reads as empty forever.
 */
export async function createTextDocument(
  clubId: string,
  draft: TextDocumentDraft,
  authorId: string,
): Promise<ClubDocumentDetail> {
  const documentId = `doc_${randomUUID()}`;

  const row = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(documents)
      .values({
        id: documentId,
        clubId,
        kind: 'text',
        section: draft.section,
        title: draft.title,
        summary: draft.summary,
        status: draft.status,
        version: 1,
        createdBy: authorId,
        updatedBy: authorId,
      })
      .returning();

    if (!created) {
      throw new Error('Insert returned no row');
    }

    await tx.insert(documentRevisions).values({
      id: `rev_${randomUUID()}`,
      documentId,
      version: 1,
      content: draft.content,
      authoredBy: authorId,
    });

    return created;
  });

  return toDetail(row);
}

/** The bytes of an upload, already read and already checked. */
export interface UploadedFile {
  bytes: Uint8Array;
  name: string;
  contentType: string;
}

/**
 * Creates an uploaded document.
 *
 * The bytes go to object storage **before** the transaction, on purpose. The
 * two stores cannot commit together, so one of them has to be first, and the
 * failure modes are not symmetric: an orphaned object costs a few unreferenced
 * bytes that a later sweep can find, while a committed row pointing at bytes
 * that were never written is a document that permanently fails to download.
 */
export async function createFileDocument(
  clubId: string,
  draft: FileDocumentDraft,
  file: UploadedFile,
  authorId: string,
): Promise<ClubDocumentDetail> {
  const documentId = `doc_${randomUUID()}`;
  const storageKey = documentStorageKey(clubId, documentId, 1);

  await putObject(storageKey, file.bytes, file.contentType);

  const row = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(documents)
      .values({
        id: documentId,
        clubId,
        kind: 'file',
        section: draft.section,
        title: draft.title,
        summary: draft.summary,
        status: draft.status,
        version: 1,
        storageKey,
        fileName: file.name,
        contentType: file.contentType,
        byteSize: file.bytes.byteLength,
        createdBy: authorId,
        updatedBy: authorId,
      })
      .returning();

    if (!created) {
      throw new Error('Insert returned no row');
    }

    await tx.insert(documentRevisions).values({
      id: `rev_${randomUUID()}`,
      documentId,
      version: 1,
      storageKey,
      fileName: file.name,
      contentType: file.contentType,
      byteSize: file.bytes.byteLength,
      authoredBy: authorId,
    });

    return created;
  });

  return toDetail(row);
}

/** Why a write was refused. */
export type WriteFailure =
  | 'not-found'
  /** Someone else saved first. Carries the version now stored. */
  | 'conflict'
  /** A content edit that did not say which version it was based on. */
  | 'missing-version'
  /** Text content sent to a file document, or the reverse. */
  | 'wrong-kind';

export type WriteResult =
  | {document: ClubDocumentDetail}
  | {error: WriteFailure; currentVersion?: number};

/**
 * What a write transaction hands back: the updated row, or why it was refused.
 *
 * Annotated explicitly rather than inferred. Left to inference, TypeScript
 * widens each branch with the other's keys as optional-undefined, and
 * `'error' in outcome` then narrows nothing.
 */
type TransactionOutcome =
  | {error: WriteFailure; currentVersion: number}
  | {row: DocumentRow};

/**
 * Applies a patch.
 *
 * Metadata-only changes (retitling, refiling into another section,
 * publishing) do **not** bump the version or write a revision. The version is
 * the concurrency token for *content*, and making a rename invalidate an
 * in-progress edit would train people to ignore the conflict message.
 *
 * A content change requires `expectedVersion` and is refused if it has moved.
 */
export async function updateDocument(
  clubId: string,
  documentId: string,
  patch: DocumentPatch,
  editorId: string,
): Promise<WriteResult> {
  // Writers see drafts regardless: `document:edit` is what both this and draft
  // visibility key off, so anyone who reaches here can already see them.
  const scope: ReadScope = {includeDrafts: true};

  const existing = await findRow(clubId, documentId, scope);
  if (!existing) {
    return {error: 'not-found'};
  }

  const metadata: Partial<typeof documents.$inferInsert> = {};
  if (patch.title !== undefined) metadata.title = patch.title;
  if (patch.summary !== undefined) metadata.summary = patch.summary;
  if (patch.section !== undefined) metadata.section = patch.section;
  if (patch.status !== undefined) metadata.status = patch.status;

  if (patch.content === undefined) {
    if (Object.keys(metadata).length === 0) {
      return {document: await toDetail(existing)};
    }

    const [row] = await db
      .update(documents)
      .set({...metadata, updatedBy: editorId})
      .where(and(eq(documents.clubId, clubId), eq(documents.id, documentId)))
      .returning();

    return row ? {document: await toDetail(row)} : {error: 'not-found'};
  }

  // Everything below is a content edit.
  if (existing.kind !== 'text') {
    // Silently dropping the text would be worse: the officer would believe
    // they had edited the document.
    return {error: 'wrong-kind'};
  }
  if (patch.expectedVersion === undefined) {
    return {error: 'missing-version'};
  }

  const outcome: TransactionOutcome = await db.transaction(async (tx) => {
    /**
     * The concurrency control, and the reason this is one statement rather
     * than a read followed by a write.
     *
     * Under READ COMMITTED a competing transaction that already bumped the
     * version holds this row's lock; this UPDATE waits for it, then
     * re-evaluates `version = expected` against the *committed* value and
     * matches nothing. There is no window between checking and writing for a
     * second save to slip through.
     */
    const [row] = await tx
      .update(documents)
      .set({
        ...metadata,
        version: sql`${documents.version} + 1`,
        updatedBy: editorId,
      })
      .where(
        and(
          eq(documents.clubId, clubId),
          eq(documents.id, documentId),
          isNull(documents.deletedAt),
          eq(documents.version, patch.expectedVersion as number),
        ),
      )
      .returning();

    if (!row) {
      // The row exists - it was read above - so the version must have moved.
      return {
        error: 'conflict' as const,
        currentVersion: existing.version,
      };
    }

    await tx.insert(documentRevisions).values({
      id: `rev_${randomUUID()}`,
      documentId,
      version: row.version,
      content: patch.content,
      authoredBy: editorId,
    });

    return {row};
  });

  if ('error' in outcome) {
    return outcome;
  }

  // Built *after* the transaction commits, never inside it. `toDetail` reads
  // through the pool rather than through `tx`, so calling it before commit
  // would look for a revision that is not visible yet and hand back an empty
  // document. Caught by a test that asserted the response echoed the text it
  // had just saved.
  return {document: await toDetail(outcome.row)};
}

/**
 * Replaces a file document's bytes, as a new revision.
 *
 * Same version check as a text edit, for the same reason: two officers
 * uploading a corrected constitution minutes apart should not have one of them
 * silently win.
 */
export async function replaceDocumentFile(
  clubId: string,
  documentId: string,
  file: UploadedFile,
  expectedVersion: number,
  editorId: string,
): Promise<WriteResult> {
  const existing = await findRow(clubId, documentId, {includeDrafts: true});
  if (!existing) {
    return {error: 'not-found'};
  }
  if (existing.kind !== 'file') {
    return {error: 'wrong-kind'};
  }
  if (existing.version !== expectedVersion) {
    return {error: 'conflict', currentVersion: existing.version};
  }

  // A new key per version, so this never overwrites the bytes it is replacing.
  const nextVersion = existing.version + 1;
  const storageKey = documentStorageKey(clubId, documentId, nextVersion);
  await putObject(storageKey, file.bytes, file.contentType);

  const outcome: TransactionOutcome = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(documents)
      .set({
        version: nextVersion,
        storageKey,
        fileName: file.name,
        contentType: file.contentType,
        byteSize: file.bytes.byteLength,
        updatedBy: editorId,
      })
      .where(
        and(
          eq(documents.clubId, clubId),
          eq(documents.id, documentId),
          isNull(documents.deletedAt),
          eq(documents.version, expectedVersion),
        ),
      )
      .returning();

    if (!row) {
      return {error: 'conflict' as const, currentVersion: existing.version};
    }

    await tx.insert(documentRevisions).values({
      id: `rev_${randomUUID()}`,
      documentId,
      version: nextVersion,
      storageKey,
      fileName: file.name,
      contentType: file.contentType,
      byteSize: file.bytes.byteLength,
      authoredBy: editorId,
    });

    return {row};
  });

  if ('error' in outcome) {
    return outcome;
  }

  // After commit, for the same reason as the text path above.
  return {document: await toDetail(outcome.row)};
}

/**
 * Replaces a file document's bytes from an OnlyOffice save, unconditionally.
 *
 * Same shape as `replaceDocumentFile`, minus the `expectedVersion` gate -
 * OnlyOffice's own `key` mechanism (see `services/api/src/documents/
 * onlyoffice.ts`) is the concurrency control for a document open in its
 * editor, not ours. Called only from the OnlyOffice callback route, never
 * from a REST caller.
 */
export async function replaceDocumentFileFromOnlyOffice(
  clubId: string,
  documentId: string,
  file: UploadedFile,
  editorId: string | null,
): Promise<ClubDocumentDetail | null> {
  const existing = await findRow(clubId, documentId, {includeDrafts: true});
  if (!existing || existing.kind !== 'file') {
    return null;
  }

  const nextVersion = existing.version + 1;
  const storageKey = documentStorageKey(clubId, documentId, nextVersion);
  await putObject(storageKey, file.bytes, file.contentType);

  const row = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(documents)
      .set({
        version: nextVersion,
        storageKey,
        fileName: file.name,
        contentType: file.contentType,
        byteSize: file.bytes.byteLength,
        updatedBy: editorId ?? existing.updatedBy,
      })
      .where(and(eq(documents.clubId, clubId), eq(documents.id, documentId)))
      .returning();

    if (!updated) {
      throw new Error(`Document ${documentId} disappeared during OnlyOffice save`);
    }

    await tx.insert(documentRevisions).values({
      id: `rev_${randomUUID()}`,
      documentId,
      version: nextVersion,
      storageKey,
      fileName: file.name,
      contentType: file.contentType,
      byteSize: file.bytes.byteLength,
      authoredBy: editorId,
    });

    return updated;
  });

  return toDetail(row);
}

/**
 * Materializes a live collaborative session's current text as a new
 * revision, unconditionally.
 *
 * Called only by `document-collab.ts`'s compaction timer, never by a route -
 * there is no `expectedVersion` to check because compaction is authoritative:
 * the Yjs document *is* the current state by the time this runs, not a
 * client's guess at what the current state might still be. Skips writing a
 * revision when the compacted text matches what is already stored, so a
 * session that opened and closed without anyone typing does not grow a
 * no-op revision.
 */
export async function compactDocumentRevision(
  clubId: string,
  documentId: string,
  content: string,
  authorId: string | null,
): Promise<ClubDocumentDetail | null> {
  const existing = await findRow(clubId, documentId, {includeDrafts: true});
  if (!existing || existing.kind !== 'text') {
    return null;
  }

  const current = await currentContent(existing);
  if (current === content) {
    return toDetail(existing);
  }

  const row = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(documents)
      .set({
        version: sql`${documents.version} + 1`,
        updatedBy: authorId ?? existing.updatedBy,
      })
      .where(and(eq(documents.clubId, clubId), eq(documents.id, documentId)))
      .returning();

    if (!updated) {
      throw new Error(`Document ${documentId} disappeared during compaction`);
    }

    await tx.insert(documentRevisions).values({
      id: `rev_${randomUUID()}`,
      documentId,
      version: updated.version,
      content,
      authoredBy: authorId,
    });

    return updated;
  });

  return toDetail(row);
}

/**
 * Removes a document from the hub.
 *
 * A soft delete: the row is stamped rather than dropped, and the revision
 * history survives. These are a club's standing records and the two mistakes
 * are not symmetrically expensive - a stray row costs bytes, while a hard
 * delete of the bylaws costs the club its bylaws.
 *
 * Returns false when there was nothing visible to delete, which the route
 * turns into a 404. Deleting an already-deleted document is therefore a 404
 * rather than a silent success, so a client cannot conclude it removed
 * something it did not.
 */
export async function deleteDocument(
  clubId: string,
  documentId: string,
  editorId: string,
): Promise<boolean> {
  const removed = await db
    .update(documents)
    .set({deletedAt: new Date(), updatedBy: editorId})
    .where(
      and(
        eq(documents.clubId, clubId),
        eq(documents.id, documentId),
        isNull(documents.deletedAt),
      ),
    )
    .returning({id: documents.id});

  return removed.length > 0;
}

/** A document's history, newest first, without bodies. */
export async function listRevisions(
  clubId: string,
  documentId: string,
  scope: ReadScope,
): Promise<DocumentRevision[] | null> {
  // Reached through the document, so an id from another club or a deleted
  // document cannot have its history read.
  const parent = await findRow(clubId, documentId, scope);
  if (!parent) {
    return null;
  }

  const rows = await db
    .select({revision: documentRevisions, authorName: revisionAuthor.name})
    .from(documentRevisions)
    .leftJoin(
      revisionAuthor,
      eq(documentRevisions.authoredBy, revisionAuthor.id),
    )
    .where(eq(documentRevisions.documentId, documentId))
    .orderBy(desc(documentRevisions.version));

  return rows.map((row) => toRevision(row.revision, row.authorName));
}

/** One past revision with the text it held. Text documents only. */
export async function findRevision(
  clubId: string,
  documentId: string,
  version: number,
  scope: ReadScope,
): Promise<DocumentRevisionDetail | null | 'wrong-kind'> {
  const parent = await findRow(clubId, documentId, scope);
  if (!parent) {
    return null;
  }
  if (parent.kind !== 'text') {
    return 'wrong-kind';
  }

  const [row] = await db
    .select({revision: documentRevisions, authorName: revisionAuthor.name})
    .from(documentRevisions)
    .leftJoin(
      revisionAuthor,
      eq(documentRevisions.authoredBy, revisionAuthor.id),
    )
    .where(
      and(
        eq(documentRevisions.documentId, documentId),
        eq(documentRevisions.version, version),
      ),
    )
    .limit(1);

  if (!row) {
    return null;
  }

  return {
    ...toRevision(row.revision, row.authorName),
    content: row.revision.content ?? '',
  };
}

/** What a download hands back to the route. */
export interface DocumentFileBytes {
  bytes: Uint8Array;
  contentType: string;
  fileName: string;
}

/**
 * The bytes of a file document, at `version` or the current one.
 *
 * The storage key comes from the revision row rather than being rebuilt from
 * the id and version, so a key format change does not silently orphan every
 * file already stored.
 */
export async function readDocumentFile(
  clubId: string,
  documentId: string,
  scope: ReadScope,
  version?: number,
): Promise<DocumentFileBytes | null | 'wrong-kind'> {
  const parent = await findRow(clubId, documentId, scope);
  if (!parent) {
    return null;
  }
  if (parent.kind !== 'file') {
    return 'wrong-kind';
  }

  const [revision] = await db
    .select()
    .from(documentRevisions)
    .where(
      and(
        eq(documentRevisions.documentId, documentId),
        eq(documentRevisions.version, version ?? parent.version),
      ),
    )
    .limit(1);

  if (!revision?.storageKey) {
    return null;
  }

  const object = await getObject(revision.storageKey);
  if (!object) {
    return null;
  }

  return {
    bytes: object.bytes,
    contentType: revision.contentType ?? object.contentType,
    fileName: revision.fileName ?? 'document',
  };
}
