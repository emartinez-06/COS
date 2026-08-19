/**
 * Tests for live canvas presence: the ticket route and the WebSocket it
 * unlocks.
 *
 * The ticket route is tested the ordinary `app.request()` way, like every
 * other canvas route. The socket itself needs a real listening server -
 * `app.request()` never opens a port - so this file is the first in the
 * repo to `serve()` a real instance for its own tests, torn down in
 * `afterAll`.
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

const CLUB_ID = 'club_test_canvas_presence';

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

let officer: Actor;
let member: Actor;
let wsBaseUrl: string;
let httpServer: ReturnType<typeof serve>;

beforeAll(async () => {
  await db
    .insert(clubs)
    .values({
      id: CLUB_ID,
      name: 'Canvas Presence Test Club',
      slug: 'canvas-presence-test-club',
    })
    .onConflictDoNothing();

  officer = await createActor('canvas-presence-officer@example.com', 'Pat Officer');
  member = await createActor('canvas-presence-member@example.com', 'Sam Member');

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
): Promise<{status: number; ticket?: string}> {
  const response = await app.request(
    `/api/clubs/${CLUB_ID}/canvas/presence-ticket`,
    {method: 'POST', headers: {Origin: ORIGIN, Cookie: actor.cookie}},
  );
  if (response.status !== 201) {
    return {status: response.status};
  }
  const body = (await response.json()) as {ticket: string};
  return {status: response.status, ticket: body.ticket};
}

/**
 * A connection that queues every message from the moment it is constructed,
 * not from whenever `next()` happens to be called. The server sends its
 * snapshot the instant the socket opens, on the same loopback round trip as
 * the upgrade completing - a `.once('message', ...)` registered only after
 * `await`ing `open` can lose that race and never see it. Queueing from
 * construction is what makes `next()` safe to call at any point.
 */
interface Connection {
  ws: WS;
  opened: Promise<void>;
  next: () => Promise<unknown>;
}

function connect(path: string, withOrigin = true): Connection {
  const ws = new WS(
    `${wsBaseUrl}${path}`,
    withOrigin ? {headers: {Origin: ORIGIN}} : undefined,
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

  return {ws, opened, next};
}

/** A rejected upgrade never reaches `open` - the server answers with a plain HTTP error response instead. */
function waitForRejection(ws: WS): Promise<number> {
  return new Promise((resolve) => {
    ws.once('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
  });
}

describe('minting a presence ticket', () => {
  it('refuses an anonymous caller', async () => {
    const response = await app.request(
      `/api/clubs/${CLUB_ID}/canvas/presence-ticket`,
      {method: 'POST', headers: {Origin: ORIGIN}},
    );
    expect(response.status).toBe(401);
  });

  it('refuses a member', async () => {
    const {status} = await mintTicket(member);
    expect(status).toBe(403);
  });

  it('gives an officer a ticket', async () => {
    const {status, ticket} = await mintTicket(officer);
    expect(status).toBe(201);
    expect(ticket).toBeTruthy();
  });
});

describe('the presence socket', () => {
  it('refuses an upgrade with no Origin header', async () => {
    const ws = new WS(
      `${wsBaseUrl}/api/clubs/${CLUB_ID}/canvas/presence-ws?ticket=whatever`,
    );
    expect(await waitForRejection(ws)).toBe(403);
  });

  it('refuses an upgrade with a missing or invalid ticket', async () => {
    const ws = new WS(
      `${wsBaseUrl}/api/clubs/${CLUB_ID}/canvas/presence-ws?ticket=not-a-real-ticket`,
      {headers: {Origin: ORIGIN}},
    );
    expect(await waitForRejection(ws)).toBe(401);
  });

  it('refuses a ticket a second time - tickets are single-use', async () => {
    const {ticket} = await mintTicket(officer);
    const path = `/api/clubs/${CLUB_ID}/canvas/presence-ws?ticket=${ticket}`;

    const first = connect(path);
    await first.opened;
    await first.next(); // the initial snapshot
    first.ws.close();

    const second = new WS(`${wsBaseUrl}${path}`, {headers: {Origin: ORIGIN}});
    expect(await waitForRejection(second)).toBe(401);
  });

  it('refuses a member, even with a request that reached the ticket route', async () => {
    // The mint route itself already 403s a member (covered above), so there
    // is no member ticket to hand the socket in the first place - the
    // authorization boundary is entirely at the mint step.
    const {status} = await mintTicket(member);
    expect(status).toBe(403);
  });

  it('sends a snapshot on connect, then broadcasts selection to every other connection but never back to the sender', async () => {
    const {ticket: ticketA} = await mintTicket(officer);
    const a = connect(
      `/api/clubs/${CLUB_ID}/canvas/presence-ws?ticket=${ticketA}`,
    );
    await a.opened;
    expect(await a.next()).toEqual({type: 'snapshot', entries: []});

    const {ticket: ticketB} = await mintTicket(officer);
    const b = connect(
      `/api/clubs/${CLUB_ID}/canvas/presence-ws?ticket=${ticketB}`,
    );
    await b.opened;
    expect(await b.next()).toEqual({type: 'snapshot', entries: []});

    const onB = b.next();
    a.ws.send(JSON.stringify({type: 'select', nodeId: 'node_1'}));
    expect(await onB).toEqual({
      type: 'presence',
      entry: {
        userId: officer.userId,
        name: 'Pat Officer',
        positionColor: 'gray',
        nodeId: 'node_1',
      },
    });

    // a never hears its own selection echoed back.
    const raced = await Promise.race([
      a.next().then(() => 'message' as const),
      new Promise<'timeout'>((resolve) =>
        setTimeout(() => resolve('timeout'), 300),
      ),
    ]);
    expect(raced).toBe('timeout');

    const clearOnB = b.next();
    a.ws.send(JSON.stringify({type: 'deselect'}));
    expect(await clearOnB).toEqual({
      type: 'presence-clear',
      userId: officer.userId,
      nodeId: 'node_1',
    });

    a.ws.close();
    b.ws.close();
  });

  it('broadcasts a clear when a connection disconnects while a node is selected', async () => {
    const {ticket: ticketA} = await mintTicket(officer);
    const a = connect(
      `/api/clubs/${CLUB_ID}/canvas/presence-ws?ticket=${ticketA}`,
    );
    await a.opened;
    await a.next(); // snapshot

    const {ticket: ticketB} = await mintTicket(officer);
    const b = connect(
      `/api/clubs/${CLUB_ID}/canvas/presence-ws?ticket=${ticketB}`,
    );
    await b.opened;
    await b.next(); // snapshot

    const presenceOnB = b.next();
    a.ws.send(JSON.stringify({type: 'select', nodeId: 'node_2'}));
    await presenceOnB;

    const clearOnB = b.next();
    a.ws.close();
    expect(await clearOnB).toEqual({
      type: 'presence-clear',
      userId: officer.userId,
      nodeId: 'node_2',
    });

    b.ws.close();
  });
});
