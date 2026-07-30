/**
 * Authorization tests for the event routes.
 *
 * These exist because the client-side `can()` check only decides what to draw.
 * The question that matters is whether a member who bypasses the UI entirely
 * is actually stopped, and the only honest way to answer it is to make the
 * request.
 *
 * They run against a real Postgres rather than a mock, because the thing under
 * test *is* the lookup of a role from `club_members`. Mocking that would test
 * the mock. Requires `docker compose up -d postgres` and a migrated database.
 */

import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {eq} from 'drizzle-orm';

import {app} from '../app.js';
import {auth} from '../auth/auth.js';
import {closeDatabase, db} from '../db/client.js';
import {user} from '../db/schema/auth.js';
import {clubMembers, clubs} from '../db/schema/club.js';
import {events} from '../db/schema/event.js';

const ORIGIN = 'http://localhost:3100';
const PASSWORD = 'test-only-password-1234';

const CLUB_ID = 'club_test_authz';
const OTHER_CLUB_ID = 'club_test_authz_other';

interface Actor {
  userId: string;
  cookie: string;
}

/** Creates a user through better-auth and returns their session cookie. */
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
      'Content-Type': 'application/json',
      Origin: ORIGIN,
      ...(actor ? {Cookie: actor.cookie} : {}),
      ...init.headers,
    },
  });
}

const draft = {
  title: 'Authorization Test Event',
  startsAt: '2026-09-01T18:00:00.000Z',
  endsAt: '2026-09-01T19:00:00.000Z',
};

let officer: Actor;
let member: Actor;
let outsider: Actor;
let seededEventId: string;

beforeAll(async () => {
  await db
    .insert(clubs)
    .values([
      {id: CLUB_ID, name: 'Authz Test Club', slug: 'authz-test-club'},
      {id: OTHER_CLUB_ID, name: 'Other Club', slug: 'authz-other-club'},
    ])
    .onConflictDoNothing();

  officer = await createActor('authz-officer@example.com', 'Authz Officer');
  member = await createActor('authz-member@example.com', 'Authz Member');
  outsider = await createActor('authz-outsider@example.com', 'Authz Outsider');

  await db
    .insert(clubMembers)
    .values([
      {userId: officer.userId, clubId: CLUB_ID, role: 'admin'},
      {userId: member.userId, clubId: CLUB_ID, role: 'member'},
      // The outsider is a real, signed-in user - just not of this club.
      {userId: outsider.userId, clubId: OTHER_CLUB_ID, role: 'admin'},
    ])
    .onConflictDoNothing();

  const created = await request(`/api/clubs/${CLUB_ID}/events`, officer, {
    method: 'POST',
    body: JSON.stringify(draft),
  });
  expect(created.status, 'seed event').toBe(201);
  seededEventId = ((await created.json()) as {id: string}).id;
});

afterAll(async () => {
  await db.delete(events).where(eq(events.clubId, CLUB_ID));
  await db.delete(clubs).where(eq(clubs.id, CLUB_ID));
  await db.delete(clubs).where(eq(clubs.id, OTHER_CLUB_ID));
  await closeDatabase();
});

describe('anonymous callers', () => {
  it('cannot list events', async () => {
    const response = await request(`/api/clubs/${CLUB_ID}/events`, null);
    expect(response.status).toBe(401);
  });

  it('cannot create events', async () => {
    const response = await request(`/api/clubs/${CLUB_ID}/events`, null, {
      method: 'POST',
      body: JSON.stringify(draft),
    });
    expect(response.status).toBe(401);
  });
});

describe('a member', () => {
  it('may view events, which is the capability they hold', async () => {
    const response = await request(`/api/clubs/${CLUB_ID}/events`, member);
    expect(response.status).toBe(200);
    expect(Array.isArray(await response.json())).toBe(true);
  });

  it('is refused when creating an event, even bypassing the UI entirely', async () => {
    const response = await request(`/api/clubs/${CLUB_ID}/events`, member, {
      method: 'POST',
      body: JSON.stringify(draft),
    });
    expect(response.status).toBe(403);
  });

  it('is refused when editing an event', async () => {
    const response = await request(
      `/api/clubs/${CLUB_ID}/events/${seededEventId}`,
      member,
      {method: 'PATCH', body: JSON.stringify({title: 'Hijacked'})},
    );
    expect(response.status).toBe(403);
  });

  it('is refused when deleting an event', async () => {
    const response = await request(
      `/api/clubs/${CLUB_ID}/events/${seededEventId}`,
      member,
      {method: 'DELETE'},
    );
    expect(response.status).toBe(403);
  });

  it('leaves no trace: the event a member tried to delete still exists', async () => {
    const rows = await db
      .select({id: events.id})
      .from(events)
      .where(eq(events.id, seededEventId));
    expect(rows).toHaveLength(1);
  });
});

describe('an officer', () => {
  it('may create an event', async () => {
    const response = await request(`/api/clubs/${CLUB_ID}/events`, officer, {
      method: 'POST',
      body: JSON.stringify({...draft, title: 'Officer Created'}),
    });
    expect(response.status).toBe(201);

    const created = (await response.json()) as {
      title: string;
      createdBy: string;
      clubId: string;
    };
    expect(created.title).toBe('Officer Created');
    expect(created.clubId).toBe(CLUB_ID);
    // Attribution comes from the session, not from the request body.
    expect(created.createdBy).toBe('Authz Officer');
  });

  it('may edit an event', async () => {
    const response = await request(
      `/api/clubs/${CLUB_ID}/events/${seededEventId}`,
      officer,
      {method: 'PATCH', body: JSON.stringify({title: 'Renamed by officer'})},
    );
    expect(response.status).toBe(200);
    expect(((await response.json()) as {title: string}).title).toBe(
      'Renamed by officer',
    );
  });

  it('cannot set an end time before the start time', async () => {
    const response = await request(`/api/clubs/${CLUB_ID}/events`, officer, {
      method: 'POST',
      body: JSON.stringify({
        ...draft,
        endsAt: '2026-09-01T17:00:00.000Z',
      }),
    });
    expect(response.status).toBe(400);
  });

  it('may patch a title without supplying both times', async () => {
    const response = await request(
      `/api/clubs/${CLUB_ID}/events/${seededEventId}`,
      officer,
      {method: 'PATCH', body: JSON.stringify({title: 'Times untouched'})},
    );
    expect(response.status).toBe(200);
  });
});

describe('a signed-in user who is not a member of this club', () => {
  it('gets 404 rather than 403, so club ids cannot be enumerated', async () => {
    const response = await request(`/api/clubs/${CLUB_ID}/events`, outsider);
    expect(response.status).toBe(404);
  });

  it('gets 404 when creating, for the same reason', async () => {
    const response = await request(`/api/clubs/${CLUB_ID}/events`, outsider, {
      method: 'POST',
      body: JSON.stringify(draft),
    });
    expect(response.status).toBe(404);
  });

  it('cannot reach another club events by id from their own club path', async () => {
    const response = await request(
      `/api/clubs/${OTHER_CLUB_ID}/events/${seededEventId}`,
      outsider,
      {method: 'DELETE'},
    );
    // Authorized for their own club, but the event belongs to another one.
    expect(response.status).toBe(404);
  });
});
