/**
 * Authorization and invariant tests for the canvas routes.
 *
 * The canvas is officer-only *including read* - the same asymmetry the
 * treasury has with the document hub, and worth pinning here too since it
 * is exactly the kind of thing a later refactor "tidies up" by accident.
 *
 * Requires `docker compose up -d postgres minio` and a migrated database.
 */

import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {eq} from 'drizzle-orm';

// See treasury.test.ts for why `../app.js` must be imported before `@cos/core`.
import {app} from '../app.js';
import type {CanvasBoard, CanvasEdge, CanvasNode} from '@cos/core';

import {auth} from '../auth/auth.js';
import {closeDatabase, db} from '../db/client.js';
import {user} from '../db/schema/auth.js';
import {clubMembers, clubs} from '../db/schema/club.js';
import {canvasBoards} from '../db/schema/canvas-boards.js';

const ORIGIN = 'http://localhost:3100';
const PASSWORD = 'test-only-password-1234';

const CLUB_ID = 'club_test_canvas';

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
  actor: Actor | null,
  init: RequestInit = {},
): Promise<Response> {
  return app.request(path, {
    ...init,
    headers: {
      Origin: ORIGIN,
      ...(actor ? {Cookie: actor.cookie} : {}),
      ...init.headers,
    },
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
let member: Actor;

beforeAll(async () => {
  await db
    .insert(clubs)
    .values({id: CLUB_ID, name: 'Canvas Test Club', slug: 'canvas-test-club'})
    .onConflictDoNothing();

  officer = await createActor('canvas-officer@example.com', 'Cass Officer');
  member = await createActor('canvas-member@example.com', 'Mo Member');

  await db
    .insert(clubMembers)
    .values([
      {userId: officer.userId, clubId: CLUB_ID, role: 'admin'},
      {userId: member.userId, clubId: CLUB_ID, role: 'member'},
    ])
    .onConflictDoNothing();
});

afterAll(async () => {
  await db.delete(canvasBoards).where(eq(canvasBoards.clubId, CLUB_ID));
  await db.delete(clubs).where(eq(clubs.id, CLUB_ID));
  await closeDatabase();
});

describe('anonymous callers', () => {
  it('cannot read the board', async () => {
    const response = await request(`/api/clubs/${CLUB_ID}/canvas/board`, null);
    expect(response.status).toBe(401);
  });

  it('cannot create a node', async () => {
    const response = await request(
      `/api/clubs/${CLUB_ID}/canvas/board/nodes`,
      null,
      {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          nodeType: 'sticky_note',
          positionX: 0,
          positionY: 0,
          width: 240,
          height: 200,
        }),
      },
    );
    expect(response.status).toBe(401);
  });
});

describe('a member', () => {
  it('is refused even reading the board, the same asymmetry as the treasury', async () => {
    const response = await request(`/api/clubs/${CLUB_ID}/canvas/board`, member);
    expect(response.status).toBe(403);
  });

  it('is refused listing nodes', async () => {
    const response = await request(
      `/api/clubs/${CLUB_ID}/canvas/board/nodes`,
      member,
    );
    expect(response.status).toBe(403);
  });

  it('is refused creating a node, bypassing the UI entirely', async () => {
    const response = await json(
      `/api/clubs/${CLUB_ID}/canvas/board/nodes`,
      member,
      'POST',
      {nodeType: 'sticky_note', positionX: 0, positionY: 0, width: 240, height: 200},
    );
    expect(response.status).toBe(403);
  });
});

describe('an officer', () => {
  it('gets the same board on every call - one board per club', async () => {
    const first = await request(`/api/clubs/${CLUB_ID}/canvas/board`, officer);
    expect(first.status).toBe(200);
    const firstBoard = (await first.json()) as CanvasBoard;

    const second = await request(`/api/clubs/${CLUB_ID}/canvas/board`, officer);
    const secondBoard = (await second.json()) as CanvasBoard;

    expect(secondBoard.id).toBe(firstBoard.id);
  });

  it('creates, patches, and deletes a sticky note', async () => {
    const created = await json(
      `/api/clubs/${CLUB_ID}/canvas/board/nodes`,
      officer,
      'POST',
      {
        nodeType: 'sticky_note',
        positionX: 10,
        positionY: 20,
        width: 240,
        height: 200,
        text: 'Bring cups',
        color: 'yellow',
      },
    );
    expect(created.status).toBe(201);
    const node = (await created.json()) as CanvasNode;
    expect(node.stickyNoteText).toBe('Bring cups');

    const geometry = await json(
      `/api/clubs/${CLUB_ID}/canvas/board/nodes/${node.id}/geometry`,
      officer,
      'PATCH',
      {positionX: 100, accentColor: 'teal'},
    );
    expect(geometry.status).toBe(200);
    const updated = (await geometry.json()) as CanvasNode;
    expect(updated.positionX).toBe(100);
    expect(updated.accentColor).toBe('teal');

    const content = await json(
      `/api/clubs/${CLUB_ID}/canvas/board/nodes/${node.id}/content`,
      officer,
      'PATCH',
      {nodeType: 'sticky_note', text: 'Bring cups and napkins'},
    );
    expect(content.status).toBe(200);
    expect(((await content.json()) as CanvasNode).stickyNoteText).toBe(
      'Bring cups and napkins',
    );

    const deleted = await request(
      `/api/clubs/${CLUB_ID}/canvas/board/nodes/${node.id}`,
      officer,
      {method: 'DELETE'},
    );
    expect(deleted.status).toBe(204);
  });

  it('refuses a content patch whose nodeType does not match the node', async () => {
    const created = await json(
      `/api/clubs/${CLUB_ID}/canvas/board/nodes`,
      officer,
      'POST',
      {nodeType: 'link', positionX: 0, positionY: 0, width: 280, height: 130, url: 'https://example.com'},
    );
    const node = (await created.json()) as CanvasNode;

    const response = await json(
      `/api/clubs/${CLUB_ID}/canvas/board/nodes/${node.id}/content`,
      officer,
      'PATCH',
      {nodeType: 'sticky_note', text: 'wrong kind'},
    );
    expect(response.status).toBe(400);

    await request(`/api/clubs/${CLUB_ID}/canvas/board/nodes/${node.id}`, officer, {
      method: 'DELETE',
    });
  });

  it('connects two nodes, collapses a duplicate connection, and refuses a self-loop', async () => {
    const a = (await (
      await json(`/api/clubs/${CLUB_ID}/canvas/board/nodes`, officer, 'POST', {
        nodeType: 'sticky_note',
        positionX: 0,
        positionY: 0,
        width: 240,
        height: 200,
      })
    ).json()) as CanvasNode;
    const b = (await (
      await json(`/api/clubs/${CLUB_ID}/canvas/board/nodes`, officer, 'POST', {
        nodeType: 'sticky_note',
        positionX: 300,
        positionY: 0,
        width: 240,
        height: 200,
      })
    ).json()) as CanvasNode;

    const first = await json(
      `/api/clubs/${CLUB_ID}/canvas/board/edges`,
      officer,
      'POST',
      {sourceNodeId: a.id, targetNodeId: b.id},
    );
    expect(first.status).toBe(201);
    const firstEdge = (await first.json()) as CanvasEdge;

    const again = await json(
      `/api/clubs/${CLUB_ID}/canvas/board/edges`,
      officer,
      'POST',
      {sourceNodeId: a.id, targetNodeId: b.id},
    );
    expect(again.status).toBe(201);
    expect(((await again.json()) as CanvasEdge).id).toBe(firstEdge.id);

    const selfLoop = await json(
      `/api/clubs/${CLUB_ID}/canvas/board/edges`,
      officer,
      'POST',
      {sourceNodeId: a.id, targetNodeId: a.id},
    );
    expect(selfLoop.status).toBe(400);

    // Deleting a node cascades its edges - listing edges afterward is empty.
    await request(`/api/clubs/${CLUB_ID}/canvas/board/nodes/${a.id}`, officer, {
      method: 'DELETE',
    });
    const edges = (await (
      await request(`/api/clubs/${CLUB_ID}/canvas/board/edges`, officer)
    ).json()) as CanvasEdge[];
    expect(edges).toHaveLength(0);

    await request(`/api/clubs/${CLUB_ID}/canvas/board/nodes/${b.id}`, officer, {
      method: 'DELETE',
    });
  });

  it('uploads and downloads an image node', async () => {
    const bytes = Uint8Array.from([137, 80, 78, 71]); // a PNG-ish byte prefix is enough here
    const form = new FormData();
    form.append('file', new Blob([bytes], {type: 'image/png'}), 'pixel.png');
    form.append('positionX', '0');
    form.append('positionY', '0');
    form.append('width', '320');
    form.append('height', '260');

    const created = await request(
      `/api/clubs/${CLUB_ID}/canvas/board/nodes`,
      officer,
      {method: 'POST', body: form},
    );
    expect(created.status).toBe(201);
    const node = (await created.json()) as CanvasNode;
    expect(node.nodeType).toBe('image');
    expect(node.imageStorageKey).toBeTruthy();

    const download = await request(
      `/api/clubs/${CLUB_ID}/canvas/board/nodes/${node.id}/image`,
      officer,
    );
    expect(download.status).toBe(200);
    expect(download.headers.get('content-type')).toBe('image/png');
    const downloaded = new Uint8Array(await download.arrayBuffer());
    expect(downloaded).toEqual(bytes);

    await request(`/api/clubs/${CLUB_ID}/canvas/board/nodes/${node.id}`, officer, {
      method: 'DELETE',
    });
  });

  it('persists the viewport', async () => {
    const response = await json(
      `/api/clubs/${CLUB_ID}/canvas/board/viewport`,
      officer,
      'PATCH',
      {viewportX: -120, viewportY: 40, viewportZoom: 150},
    );
    expect(response.status).toBe(200);
    const board = (await response.json()) as CanvasBoard;
    expect(board.viewportX).toBe(-120);
    expect(board.viewportZoom).toBe(150);
  });
});
