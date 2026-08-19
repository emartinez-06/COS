/**
 * Tests that the canvas REST routes broadcast board-sync messages over the
 * presence socket - a move, a create, an edit, and a delete should all show
 * up on a connected officer's socket without them touching anything.
 *
 * Requires `docker compose up -d postgres minio` and a migrated database.
 */

import type {AddressInfo} from 'node:net';

import {serve} from '@hono/node-server';
import {eq} from 'drizzle-orm';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import WS, {WebSocketServer} from 'ws';

// See treasury.test.ts for why `../app.js` must be imported before `@cos/core`.
import {app} from '../app.js';

import {auth} from '../auth/auth.js';
import {closeDatabase, db} from '../db/client.js';
import {user} from '../db/schema/auth.js';
import {clubMembers, clubs} from '../db/schema/club.js';

const ORIGIN = 'http://localhost:3100';
const PASSWORD = 'test-only-password-1234';

const CLUB_ID = 'club_test_canvas_sync';

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

async function request(
  path: string,
  actor: Actor,
  init: RequestInit = {},
): Promise<Response> {
  return app.request(path, {
    ...init,
    headers: {Origin: ORIGIN, Cookie: actor.cookie, ...init.headers},
  });
}

async function json(
  path: string,
  actor: Actor,
  method: string,
  body: unknown,
): Promise<Response> {
  return request(path, actor, {
    method,
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body),
  });
}

let officer: Actor;
let wsBaseUrl: string;
let httpServer: ReturnType<typeof serve>;

beforeAll(async () => {
  await db
    .insert(clubs)
    .values({
      id: CLUB_ID,
      name: 'Canvas Sync Test Club',
      slug: 'canvas-sync-test-club',
    })
    .onConflictDoNothing();

  officer = await createActor('canvas-sync-officer@example.com', 'Sync Officer');

  await db
    .insert(clubMembers)
    .values([{userId: officer.userId, clubId: CLUB_ID, role: 'admin'}])
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

/** Same message-queueing connection helper as canvas-presence.test.ts - see there for why. */
interface Connection {
  ws: WS;
  opened: Promise<void>;
  next: () => Promise<unknown>;
}

async function connectAs(actor: Actor): Promise<Connection> {
  const ticketRes = await request(
    `/api/clubs/${CLUB_ID}/canvas/presence-ticket`,
    actor,
    {method: 'POST'},
  );
  expect(ticketRes.status).toBe(201);
  const {ticket} = (await ticketRes.json()) as {ticket: string};

  const ws = new WS(
    `${wsBaseUrl}/api/clubs/${CLUB_ID}/canvas/presence-ws?ticket=${ticket}`,
    {headers: {Origin: ORIGIN}},
  );

  const queue: unknown[] = [];
  const waiters: Array<(message: unknown) => void> = [];
  ws.on('message', (data) => {
    const parsed: unknown = JSON.parse(data.toString());
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

  const next = (): Promise<unknown> => {
    const queued = queue.shift();
    if (queued !== undefined) {
      return Promise.resolve(queued);
    }
    return new Promise((resolve) => waiters.push(resolve));
  };

  await opened;
  await next(); // the initial snapshot
  return {ws, opened, next};
}

describe('canvas REST writes broadcast over the presence socket', () => {
  it('broadcasts node-upserted on create, geometry patch, and content patch', async () => {
    const conn = await connectAs(officer);

    const createRes = await json(
      `/api/clubs/${CLUB_ID}/canvas/board/nodes`,
      officer,
      'POST',
      {
        nodeType: 'sticky_note',
        positionX: 0,
        positionY: 0,
        width: 240,
        height: 200,
        text: 'first draft',
      },
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as {id: string};

    const createdMessage = await conn.next();
    expect(createdMessage).toMatchObject({
      type: 'node-upserted',
      node: {id: created.id, stickyNoteText: 'first draft'},
    });

    const geometryRes = await json(
      `/api/clubs/${CLUB_ID}/canvas/board/nodes/${created.id}/geometry`,
      officer,
      'PATCH',
      {positionX: 50, positionY: 75},
    );
    expect(geometryRes.status).toBe(200);

    const geometryMessage = await conn.next();
    expect(geometryMessage).toMatchObject({
      type: 'node-upserted',
      node: {id: created.id, positionX: 50, positionY: 75},
    });

    const contentRes = await json(
      `/api/clubs/${CLUB_ID}/canvas/board/nodes/${created.id}/content`,
      officer,
      'PATCH',
      {nodeType: 'sticky_note', text: 'revised'},
    );
    expect(contentRes.status).toBe(200);

    const contentMessage = await conn.next();
    expect(contentMessage).toMatchObject({
      type: 'node-upserted',
      node: {id: created.id, stickyNoteText: 'revised'},
    });

    conn.ws.close();
  });

  it('broadcasts edge-upserted on connect and edge-deleted on disconnect', async () => {
    const conn = await connectAs(officer);

    const nodeA = (await (
      await json(`/api/clubs/${CLUB_ID}/canvas/board/nodes`, officer, 'POST', {
        nodeType: 'sticky_note',
        positionX: 0,
        positionY: 0,
        width: 240,
        height: 200,
      })
    ).json()) as {id: string};
    await conn.next(); // node-upserted for nodeA

    const nodeB = (await (
      await json(`/api/clubs/${CLUB_ID}/canvas/board/nodes`, officer, 'POST', {
        nodeType: 'sticky_note',
        positionX: 300,
        positionY: 0,
        width: 240,
        height: 200,
      })
    ).json()) as {id: string};
    await conn.next(); // node-upserted for nodeB

    const edgeRes = await json(
      `/api/clubs/${CLUB_ID}/canvas/board/edges`,
      officer,
      'POST',
      {sourceNodeId: nodeA.id, targetNodeId: nodeB.id},
    );
    expect(edgeRes.status).toBe(201);
    const edge = (await edgeRes.json()) as {id: string};

    const edgeMessage = await conn.next();
    expect(edgeMessage).toMatchObject({
      type: 'edge-upserted',
      edge: {id: edge.id, sourceNodeId: nodeA.id, targetNodeId: nodeB.id},
    });

    const deleteRes = await request(
      `/api/clubs/${CLUB_ID}/canvas/board/edges/${edge.id}`,
      officer,
      {method: 'DELETE'},
    );
    expect(deleteRes.status).toBe(204);

    const clearMessage = await conn.next();
    expect(clearMessage).toEqual({type: 'edge-deleted', edgeId: edge.id});

    conn.ws.close();
  });

  it('broadcasts the cascaded edge-deleted before node-deleted when a connected node is removed', async () => {
    const conn = await connectAs(officer);

    const nodeA = (await (
      await json(`/api/clubs/${CLUB_ID}/canvas/board/nodes`, officer, 'POST', {
        nodeType: 'sticky_note',
        positionX: 0,
        positionY: 0,
        width: 240,
        height: 200,
      })
    ).json()) as {id: string};
    await conn.next();

    const nodeB = (await (
      await json(`/api/clubs/${CLUB_ID}/canvas/board/nodes`, officer, 'POST', {
        nodeType: 'sticky_note',
        positionX: 300,
        positionY: 0,
        width: 240,
        height: 200,
      })
    ).json()) as {id: string};
    await conn.next();

    const edge = (await (
      await json(`/api/clubs/${CLUB_ID}/canvas/board/edges`, officer, 'POST', {
        sourceNodeId: nodeA.id,
        targetNodeId: nodeB.id,
      })
    ).json()) as {id: string};
    await conn.next();

    const deleteRes = await request(
      `/api/clubs/${CLUB_ID}/canvas/board/nodes/${nodeA.id}`,
      officer,
      {method: 'DELETE'},
    );
    expect(deleteRes.status).toBe(204);

    expect(await conn.next()).toEqual({type: 'edge-deleted', edgeId: edge.id});
    expect(await conn.next()).toEqual({type: 'node-deleted', nodeId: nodeA.id});

    conn.ws.close();
  });

  it('broadcasts to a bystander connection, not just the writer', async () => {
    const writer = await connectAs(officer);
    const bystander = await connectAs(officer);

    const createRes = await json(
      `/api/clubs/${CLUB_ID}/canvas/board/nodes`,
      officer,
      'POST',
      {nodeType: 'sticky_note', positionX: 0, positionY: 0, width: 240, height: 200},
    );
    const created = (await createRes.json()) as {id: string};

    expect(await writer.next()).toMatchObject({
      type: 'node-upserted',
      node: {id: created.id},
    });
    expect(await bystander.next()).toMatchObject({
      type: 'node-upserted',
      node: {id: created.id},
    });

    writer.ws.close();
    bystander.ws.close();
  });
});
