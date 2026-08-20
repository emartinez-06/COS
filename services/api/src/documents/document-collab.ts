/**
 * Live collaborative editing: in-memory Yjs state for open text documents,
 * and the WebSocket connections attached to each one.
 *
 * Structured like `canvas/canvas-presence.ts` - a ticket map plus a
 * per-resource connection registry, all in one process and none of it
 * surviving a restart unassisted, the same accepted deployment shape as
 * everywhere else in this file's family (a single self-hosted API process,
 * not a cluster). What makes a restart survivable here, unlike presence, is
 * `document_crdt_updates`: every accepted edit is persisted there before
 * being applied in memory, and `getOrCreateSession` replays that log to
 * reconstruct a document's live state from nothing.
 *
 * ## Why reconstruction replays the update log rather than re-seeding content
 *
 * A Yjs document's internal structure identifies every inserted item by
 * (client id, clock), not by position. If a restarted process re-seeded a
 * document's shared type with a synthetic insert built from the last
 * materialized revision, and then tried to replay updates generated against
 * the *previous* process's Y.Doc, those updates would reference structure
 * that does not exist in the freshly-seeded one - Yjs would either buffer
 * them forever as unsatisfied dependencies or fail to apply them coherently.
 * The only correct way to reconstruct exact prior state is to replay the
 * same update stream that built it, via `Y.applyUpdate`, which is exactly
 * what `document_crdt_updates` exists to make possible.
 *
 * That means the update log is **not** disposed of at compaction the way a
 * write-ahead log might be - it is this feature's actual durable storage, and
 * `document_revisions` (see `document-store.ts`) is a read-optimized,
 * human-readable markdown projection of it (see `markdown-schema.ts` for how
 * that projection is built). Pruning the log once it is large is a real
 * future need (`docs/COLLABORATIVE-EDITING.md` names this as an open
 * question) but is not required for correctness today, so it is left alone.
 * A synthetic seed is only ever safe once, for a document that has never had
 * a single collaborative update - there is no prior Yjs structure for it to
 * conflict with.
 */

import {randomUUID} from 'node:crypto';
import {
  DOCUMENT_COLLAB_FRAME_TYPE,
  DOCUMENT_COLLAB_XML_FRAGMENT_FIELD,
  encodeCollabFrame,
} from '@cos/core';
import {prosemirrorToYXmlFragment, yXmlFragmentToProsemirror} from '@tiptap/y-tiptap';
import {asc, eq} from 'drizzle-orm';
import type {WSContext} from 'hono/ws';
import * as Y from 'yjs';

import {db} from '../db/client.js';
import {documentCrdtUpdates} from '../db/schema/document-collab.js';
import {compactDocumentRevision, findDocument} from './document-store.js';
import {
  documentSchema,
  markdownToProseMirrorDoc,
  proseMirrorDocToMarkdown,
} from './markdown-schema.js';

interface Connection {
  ws: WSContext;
  userId: string;
  canEdit: boolean;
}

interface DocumentSession {
  clubId: string;
  ydoc: Y.Doc;
  connections: Map<string, Connection>;
  compactionTimer: ReturnType<typeof setTimeout> | null;
  lastAuthorId: string | null;
}

/** documentId -> live session state. Empty when nothing is connected to it. */
const sessions = new Map<string, DocumentSession>();

interface Ticket {
  userId: string;
  clubId: string;
  documentId: string;
  expiresAt: number;
}

/** Single-use, short-lived tickets - see `canvas-presence.ts` for the reasoning. */
const tickets = new Map<string, Ticket>();

const TICKET_TTL_MS = 30_000;

export function mintTicket(
  userId: string,
  clubId: string,
  documentId: string,
): string {
  const ticket = randomUUID();
  tickets.set(ticket, {
    userId,
    clubId,
    documentId,
    expiresAt: Date.now() + TICKET_TTL_MS,
  });
  return ticket;
}

export function consumeTicket(
  ticket: string,
  clubId: string,
  documentId: string,
): {userId: string} | null {
  const found = tickets.get(ticket);
  tickets.delete(ticket);
  if (
    !found ||
    found.clubId !== clubId ||
    found.documentId !== documentId ||
    found.expiresAt < Date.now()
  ) {
    return null;
  }
  return {userId: found.userId};
}

/** How long after the last edit compaction waits before materializing a revision. */
const COMPACTION_DEBOUNCE_MS = 30_000;

async function loadSession(
  clubId: string,
  documentId: string,
): Promise<DocumentSession> {
  const ydoc = new Y.Doc();

  const updates = await db
    .select({update: documentCrdtUpdates.update})
    .from(documentCrdtUpdates)
    .where(eq(documentCrdtUpdates.documentId, documentId))
    .orderBy(asc(documentCrdtUpdates.createdAt));

  if (updates.length > 0) {
    Y.transact(ydoc, () => {
      for (const row of updates) {
        Y.applyUpdate(ydoc, row.update);
      }
    });
  } else {
    // No collaborative history yet - the document has only ever been edited
    // through the plain REST path, or is brand new. Safe to seed directly;
    // see the module doc for why this is the *only* case where that holds.
    // Markdown -> tree, then the tree into the fragment the editor actually
    // syncs - see markdown-schema.ts's module doc for why this exists at all.
    const document = await findDocument(clubId, documentId, {
      includeDrafts: true,
    });
    if (document?.content) {
      const doc = markdownToProseMirrorDoc(document.content);
      prosemirrorToYXmlFragment(
        doc,
        ydoc.getXmlFragment(DOCUMENT_COLLAB_XML_FRAGMENT_FIELD),
      );
    }
  }

  return {
    clubId,
    ydoc,
    connections: new Map(),
    compactionTimer: null,
    lastAuthorId: null,
  };
}

/** The session for a document, creating and loading it if this is the first connection. */
export async function getOrCreateSession(
  clubId: string,
  documentId: string,
): Promise<DocumentSession> {
  const existing = sessions.get(documentId);
  if (existing) {
    return existing;
  }
  const session = await loadSession(clubId, documentId);
  sessions.set(documentId, session);
  return session;
}

/** Whether a document currently has anyone connected to its live session. */
export function hasOpenSession(documentId: string): boolean {
  return (sessions.get(documentId)?.connections.size ?? 0) > 0;
}

export function join(
  documentId: string,
  connectionId: string,
  connection: Connection,
): void {
  sessions.get(documentId)?.connections.set(connectionId, connection);
}

/**
 * Drops a connection. When it was the last one on a document, the
 * compaction timer is fired immediately (rather than left to expire on its
 * own after everyone has gone) so a session's final edits are not sitting
 * unmaterialized for up to `COMPACTION_DEBOUNCE_MS` after nobody is even
 * looking, and the whole session is torn out of memory - the update log in
 * Postgres is what the next connection reloads from.
 */
export function leave(documentId: string, connectionId: string): void {
  const session = sessions.get(documentId);
  if (!session) {
    return;
  }
  session.connections.delete(connectionId);
  if (session.connections.size > 0) {
    return;
  }
  if (session.compactionTimer) {
    clearTimeout(session.compactionTimer);
  }
  void compact(session, documentId);
  sessions.delete(documentId);
}

/**
 * Applies an accepted sync frame: persist first, then apply in memory, then
 * broadcast. Persisting before applying means a crash between the two still
 * leaves the update durable and replayable; applying before persisting would
 * risk a broadcast (and an in-memory state change) that a restart could
 * never reconstruct.
 */
export async function applyUpdate(
  documentId: string,
  update: Uint8Array,
  authorId: string,
  fromConnectionId: string,
): Promise<void> {
  const session = sessions.get(documentId);
  if (!session) {
    return;
  }

  await db.insert(documentCrdtUpdates).values({
    id: `crdt_${randomUUID()}`,
    documentId,
    update,
    authoredBy: authorId,
  });

  Y.applyUpdate(session.ydoc, update);
  session.lastAuthorId = authorId;

  broadcast(session, fromConnectionId, update);
  scheduleCompaction(session, documentId);
}

/** Awareness frames are relayed only - never persisted, never applied to the Y.Doc. */
export function relayAwareness(
  documentId: string,
  update: Uint8Array,
  fromConnectionId: string,
): void {
  const session = sessions.get(documentId);
  if (!session) {
    return;
  }
  broadcast(session, fromConnectionId, update, true);
}

function broadcast(
  session: DocumentSession,
  fromConnectionId: string,
  payload: Uint8Array,
  awareness = false,
): void {
  const frame = encodeCollabFrame(
    awareness
      ? DOCUMENT_COLLAB_FRAME_TYPE.awareness
      : DOCUMENT_COLLAB_FRAME_TYPE.sync,
    payload,
  );
  for (const [connectionId, connection] of session.connections) {
    if (connectionId === fromConnectionId) {
      continue;
    }
    connection.ws.send(frame);
  }
}

/** The current full document state, for a newly-joined connection to catch up on. */
export function currentStateUpdate(session: DocumentSession): Uint8Array {
  return Y.encodeStateAsUpdate(session.ydoc);
}

function scheduleCompaction(session: DocumentSession, documentId: string): void {
  if (session.compactionTimer) {
    clearTimeout(session.compactionTimer);
  }
  session.compactionTimer = setTimeout(() => {
    session.compactionTimer = null;
    void compact(session, documentId);
  }, COMPACTION_DEBOUNCE_MS);
}

async function compact(
  session: DocumentSession,
  documentId: string,
): Promise<void> {
  const doc = yXmlFragmentToProsemirror(
    documentSchema,
    session.ydoc.getXmlFragment(DOCUMENT_COLLAB_XML_FRAGMENT_FIELD),
  );
  const content = proseMirrorDocToMarkdown(doc);
  try {
    await compactDocumentRevision(
      session.clubId,
      documentId,
      content,
      session.lastAuthorId,
    );
  } catch (cause) {
    // A failed compaction is not data loss - the update log this content was
    // derived from is already durable in Postgres, and the next successful
    // compaction (from this session or the next one) materializes the same
    // (or newer) content. Logged so a persistent failure is at least visible.
    console.error(`Compaction failed for document ${documentId}:`, cause);
  }
}
