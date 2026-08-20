/**
 * Integration tests for live collaborative document editing: the ticket
 * route, the WebSocket it unlocks, compaction on the last connection
 * leaving, and the REST PATCH guard while a session is open.
 *
 * Same shape as `canvas/canvas-presence.test.ts`: a real listening server,
 * because `app.request()` never opens a port a WebSocket can upgrade
 * against. Frames here are binary (a one-byte type prefix plus a Yjs
 * payload), not JSON, so `connect()` decodes with `decodeCollabFrame`
 * instead of `JSON.parse`.
 *
 * Requires `docker compose up -d` (Postgres and MinIO) and a migrated
 * database.
 */

import type {AddressInfo} from 'node:net';

import {serve} from '@hono/node-server';
import {eq} from 'drizzle-orm';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import WS, {WebSocketServer} from 'ws';
import * as Y from 'yjs';

// See treasury.test.ts for why `../app.js` must be imported before `@cos/core`.
import {app} from '../app.js';

import {
  DOCUMENT_COLLAB_FRAME_TYPE,
  DOCUMENT_COLLAB_XML_FRAGMENT_FIELD,
  decodeCollabFrame,
  encodeCollabFrame,
} from '@cos/core';
import {
  prosemirrorToYXmlFragment,
  yXmlFragmentToProsemirror,
} from '@tiptap/y-tiptap';
import {auth} from '../auth/auth.js';
import {closeDatabase, db} from '../db/client.js';
import {user} from '../db/schema/auth.js';
import {clubMembers, clubs} from '../db/schema/club.js';
import {documentRevisions, documents} from '../db/schema/document.js';
import {documentSchema} from './markdown-schema.js';

const ORIGIN = 'http://localhost:3100';
const PASSWORD = 'test-only-password-1234';

const CLUB_ID = 'club_test_document_collab';

interface Actor {
  userId: string;
  cookie: string;
}

async function createActor(email: string, name: string): Promise<Actor> {
  const existing = await db
    .select({id: user.id})
    .from(user)
    .where(eq(user.email, email))
    .limit(1);

  if (existing.length === 0) {
    await auth.api.signUpEmail({body: {email, name, password: PASSWORD}});
  }

  const response = await app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: {'Content-Type': 'application/json', Origin: ORIGIN},
    body: JSON.stringify({email, password: PASSWORD}),
  });

  expect(response.status, `sign-in for ${email}`).toBe(200);

  const cookie = (response.headers.getSetCookie?.() ?? [])
    .map((value) => value.split(';')[0])
    .join('; ');

  const [row] = await db
    .select({id: user.id})
    .from(user)
    .where(eq(user.email, email))
    .limit(1);

  if (!row) {
    throw new Error(`No user row for ${email}`);
  }

  return {userId: row.id, cookie};
}

async function createTextDocument(
  actor: Actor,
  overrides: {status?: 'draft' | 'published'} = {},
): Promise<string> {
  const response = await app.request(`/api/clubs/${CLUB_ID}/documents`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: ORIGIN,
      Cookie: actor.cookie,
    },
    body: JSON.stringify({
      kind: 'text',
      title: 'Collab test doc',
      section: 'other',
      status: overrides.status ?? 'published',
      content: '',
    }),
  });
  expect(response.status, 'creating the test document').toBe(201);
  const body = (await response.json()) as {id: string};
  return body.id;
}

let officer: Actor;
let member: Actor;
let wsBaseUrl: string;
let httpServer: ReturnType<typeof serve>;

beforeAll(async () => {
  await db
    .insert(clubs)
    .values({
      id: CLUB_ID,
      name: 'Document Collab Test Club',
      slug: 'document-collab-test-club',
    })
    .onConflictDoNothing();

  officer = await createActor('document-collab-officer@example.com', 'Pat Officer');
  member = await createActor('document-collab-member@example.com', 'Sam Member');

  await db
    .insert(clubMembers)
    .values([
      {userId: officer.userId, clubId: CLUB_ID, role: 'admin'},
      {userId: member.userId, clubId: CLUB_ID, role: 'member'},
    ])
    .onConflictDoNothing();

  const wss = new WebSocketServer({noServer: true});
  httpServer = serve({fetch: app.fetch, port: 0, websocket: {server: wss}});
  await new Promise<void>((resolve) => httpServer.once('listening', resolve));
  const address = httpServer.address() as AddressInfo;
  wsBaseUrl = `ws://localhost:${address.port}`;
}, 30_000);

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  await db.delete(clubs).where(eq(clubs.id, CLUB_ID));
  await closeDatabase();
});

async function mintTicket(
  actor: Actor,
  documentId: string,
): Promise<{status: number; ticket?: string}> {
  const response = await app.request(
    `/api/clubs/${CLUB_ID}/documents/${documentId}/collab-ticket`,
    {method: 'POST', headers: {Origin: ORIGIN, Cookie: actor.cookie}},
  );
  if (response.status !== 201) {
    return {status: response.status};
  }
  const body = (await response.json()) as {ticket: string};
  return {status: response.status, ticket: body.ticket};
}

interface Connection {
  ws: WS;
  opened: Promise<void>;
  next: () => Promise<{type: number; payload: Uint8Array}>;
}

/** Queues every binary frame from construction, same reasoning as canvas-presence.test.ts. */
function connect(path: string): Connection {
  const ws = new WS(`${wsBaseUrl}${path}`, {headers: {Origin: ORIGIN}});

  const queue: Array<{type: number; payload: Uint8Array}> = [];
  const waiters: Array<(message: {type: number; payload: Uint8Array}) => void> = [];
  ws.on('message', (data: Buffer) => {
    const parsed = decodeCollabFrame(new Uint8Array(data));
    const waiter = waiters.shift();
    if (waiter) {
      waiter(parsed);
    } else {
      queue.push(parsed);
    }
  });

  const opened = new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });

  const next = (): Promise<{type: number; payload: Uint8Array}> => {
    const queued = queue.shift();
    if (queued !== undefined) {
      return Promise.resolve(queued);
    }
    return new Promise((resolve) => waiters.push(resolve));
  };

  return {ws, opened, next};
}

function waitForRejection(ws: WS): Promise<number> {
  return new Promise((resolve) => {
    ws.once('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
  });
}

/**
 * A real Yjs update that inserts a single paragraph containing `text` into
 * a fresh document's collaborative fragment - the same shape an actual
 * Tiptap client produces, not a plain `Y.Text` (see `document-collab.ts`'s
 * module doc for why the two are not interchangeable).
 */
function insertUpdate(text: string): Uint8Array {
  const ydoc = new Y.Doc();
  const doc = documentSchema.node('doc', null, [
    documentSchema.node('paragraph', null, [documentSchema.text(text)]),
  ]);
  prosemirrorToYXmlFragment(
    doc,
    ydoc.getXmlFragment(DOCUMENT_COLLAB_XML_FRAGMENT_FIELD),
  );
  return Y.encodeStateAsUpdate(ydoc);
}

describe('minting a collaboration ticket', () => {
  it('refuses an anonymous caller', async () => {
    const documentId = await createTextDocument(officer);
    const response = await app.request(
      `/api/clubs/${CLUB_ID}/documents/${documentId}/collab-ticket`,
      {method: 'POST', headers: {Origin: ORIGIN}},
    );
    expect(response.status).toBe(401);
  });

  it('gives a member a ticket for a published document', async () => {
    const documentId = await createTextDocument(officer);
    const {status, ticket} = await mintTicket(member, documentId);
    expect(status).toBe(201);
    expect(ticket).toBeTruthy();
  });

  it('refuses a member a ticket for a draft document', async () => {
    const documentId = await createTextDocument(officer, {status: 'draft'});
    const {status} = await mintTicket(member, documentId);
    expect(status).toBe(404);
  });

  it('gives an officer a ticket for a draft document', async () => {
    const documentId = await createTextDocument(officer, {status: 'draft'});
    const {status, ticket} = await mintTicket(officer, documentId);
    expect(status).toBe(201);
    expect(ticket).toBeTruthy();
  });
});

describe('the collaboration socket', () => {
  it('refuses an upgrade with no Origin header', async () => {
    const documentId = await createTextDocument(officer);
    const ws = new WS(
      `${wsBaseUrl}/api/clubs/${CLUB_ID}/documents/${documentId}/collab-ws?ticket=whatever`,
    );
    expect(await waitForRejection(ws)).toBe(403);
  });

  it('refuses an upgrade with a missing or invalid ticket', async () => {
    const documentId = await createTextDocument(officer);
    const ws = new WS(
      `${wsBaseUrl}/api/clubs/${CLUB_ID}/documents/${documentId}/collab-ws?ticket=not-a-real-ticket`,
      {headers: {Origin: ORIGIN}},
    );
    expect(await waitForRejection(ws)).toBe(401);
  });

  it('refuses a ticket a second time - tickets are single-use', async () => {
    const documentId = await createTextDocument(officer);
    const {ticket} = await mintTicket(officer, documentId);
    const path = `/api/clubs/${CLUB_ID}/documents/${documentId}/collab-ws?ticket=${ticket}`;

    const first = connect(path);
    await first.opened;
    await first.next(); // initial sync
    first.ws.close();

    const second = new WS(`${wsBaseUrl}${path}`, {headers: {Origin: ORIGIN}});
    expect(await waitForRejection(second)).toBe(401);
  });

  it('sends the current document state as a sync frame on connect', async () => {
    const documentId = await createTextDocument(officer);
    const {ticket} = await mintTicket(officer, documentId);
    const conn = connect(
      `/api/clubs/${CLUB_ID}/documents/${documentId}/collab-ws?ticket=${ticket}`,
    );
    await conn.opened;
    const initial = await conn.next();
    expect(initial.type).toBe(DOCUMENT_COLLAB_FRAME_TYPE.sync);
    conn.ws.close();
  });

  it('applies and broadcasts a sync update from an editor to every other connection, never back to the sender', async () => {
    const documentId = await createTextDocument(officer);

    const {ticket: ticketA} = await mintTicket(officer, documentId);
    const a = connect(
      `/api/clubs/${CLUB_ID}/documents/${documentId}/collab-ws?ticket=${ticketA}`,
    );
    await a.opened;
    await a.next(); // initial sync

    const {ticket: ticketB} = await mintTicket(officer, documentId);
    const b = connect(
      `/api/clubs/${CLUB_ID}/documents/${documentId}/collab-ws?ticket=${ticketB}`,
    );
    await b.opened;
    await b.next(); // initial sync

    const onB = b.next();
    const update = insertUpdate('hello');
    a.ws.send(encodeCollabFrame(DOCUMENT_COLLAB_FRAME_TYPE.sync, update));

    const received = await onB;
    expect(received.type).toBe(DOCUMENT_COLLAB_FRAME_TYPE.sync);
    const merged = new Y.Doc();
    Y.applyUpdate(merged, received.payload);
    const mergedDoc = yXmlFragmentToProsemirror(
      documentSchema,
      merged.getXmlFragment(DOCUMENT_COLLAB_XML_FRAGMENT_FIELD),
    );
    expect(mergedDoc.textContent).toBe('hello');

    // a never hears its own edit echoed back.
    const raced = await Promise.race([
      a.next().then(() => 'message' as const),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 300)),
    ]);
    expect(raced).toBe('timeout');

    a.ws.close();
    b.ws.close();
  });

  it('drops a sync frame from a view-only connection rather than applying it', async () => {
    const documentId = await createTextDocument(officer);

    const {ticket: officerTicket} = await mintTicket(officer, documentId);
    const editor = connect(
      `/api/clubs/${CLUB_ID}/documents/${documentId}/collab-ws?ticket=${officerTicket}`,
    );
    await editor.opened;
    await editor.next(); // initial sync

    const {ticket: memberTicket} = await mintTicket(member, documentId);
    const viewer = connect(
      `/api/clubs/${CLUB_ID}/documents/${documentId}/collab-ws?ticket=${memberTicket}`,
    );
    await viewer.opened;
    await viewer.next(); // initial sync

    viewer.ws.send(
      encodeCollabFrame(DOCUMENT_COLLAB_FRAME_TYPE.sync, insertUpdate('should not land')),
    );

    // Nothing arrives at the editor - the member's frame was never relayed.
    const raced = await Promise.race([
      editor.next().then(() => 'message' as const),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 300)),
    ]);
    expect(raced).toBe('timeout');

    editor.ws.close();
    viewer.ws.close();
  });

  it('compacts into a new revision when the last connection leaves, and unblocks the REST PATCH path', async () => {
    const documentId = await createTextDocument(officer);

    const {ticket} = await mintTicket(officer, documentId);
    const conn = connect(
      `/api/clubs/${CLUB_ID}/documents/${documentId}/collab-ws?ticket=${ticket}`,
    );
    await conn.opened;
    await conn.next(); // initial sync

    conn.ws.send(
      encodeCollabFrame(DOCUMENT_COLLAB_FRAME_TYPE.sync, insertUpdate('compacted content')),
    );
    // Give the server a moment to persist+apply before we close.
    await new Promise((resolve) => setTimeout(resolve, 200));

    // While the session is open, a direct content PATCH is refused.
    const blockedPatch = await app.request(
      `/api/clubs/${CLUB_ID}/documents/${documentId}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          Cookie: officer.cookie,
        },
        body: JSON.stringify({content: 'direct write', expectedVersion: 1}),
      },
    );
    expect(blockedPatch.status).toBe(409);

    conn.ws.close();
    // Compaction runs synchronously off the close handler's `leave()` call,
    // but is itself async (a DB write) - poll briefly rather than assume a
    // fixed delay is enough.
    let revisionRow: {content: string | null} | undefined;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const [row] = await db
        .select({content: documentRevisions.content})
        .from(documentRevisions)
        .where(eq(documentRevisions.documentId, documentId))
        .orderBy(documentRevisions.version)
        .limit(1)
        .offset(1); // version 2 - version 1 is the empty document created above
      if (row) {
        revisionRow = row;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(revisionRow?.content).toBe('compacted content');

    const [documentRow] = await db
      .select({version: documents.version})
      .from(documents)
      .where(eq(documents.id, documentId))
      .limit(1);
    expect(documentRow?.version).toBe(2);

    // The session is gone now, so a direct PATCH works again.
    const unblockedPatch = await app.request(
      `/api/clubs/${CLUB_ID}/documents/${documentId}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          Cookie: officer.cookie,
        },
        body: JSON.stringify({content: 'direct write', expectedVersion: 2}),
      },
    );
    expect(unblockedPatch.status).toBe(200);
  });
});
