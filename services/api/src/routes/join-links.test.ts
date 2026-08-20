/**
 * Authorization and lifecycle tests for the join link routes.
 *
 * Three shapes worth pinning, matching the three audiences in join-links.ts:
 *
 * - The officer's side (create/list/revoke) is ordinary club-scoped
 *   authorization, same as invitations.
 * - The public preview leaks nothing beyond what joining grants, and answers
 *   the same for "never existed", "expired" and "revoked" - a prober should
 *   not be able to tell those apart.
 * - Accepting is idempotent for someone already a member, unlike accepting an
 *   invitation - a multi-use public link being clicked twice must not error.
 *
 * Runs against a real Postgres, matching invitations.test.ts.
 */

import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {and, eq} from 'drizzle-orm';

import {app} from '../app.js';
import {auth} from '../auth/auth.js';
import {closeDatabase, db} from '../db/client.js';
import {user} from '../db/schema/auth.js';
import {clubJoinLinks, clubMembers, clubs} from '../db/schema/club.js';

const ORIGIN = 'http://localhost:3100';
const PASSWORD = 'test-only-password-1234';
const CLUB_ID = 'club_test_join_links';

interface Actor {
  userId: string;
  email: string;
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

  return {userId: row.id, email, cookie};
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

async function createLink(
  actor: Actor | null,
  body: Record<string, unknown> = {role: 'member', expiresInMinutes: 60},
): Promise<Response> {
  return request(`/api/clubs/${CLUB_ID}/join-links`, actor, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * Resets the club between tests, matching invitations.test.ts's reasoning:
 * links must be cleared so listings start empty, and the joiner's membership
 * must be cleared too, or a later "accept creates a membership" test finds
 * one already there and passes for the wrong reason.
 */
async function resetClub(): Promise<void> {
  await db.delete(clubJoinLinks).where(eq(clubJoinLinks.clubId, CLUB_ID));
  for (const actor of [joiner, bystander]) {
    await db
      .delete(clubMembers)
      .where(
        and(
          eq(clubMembers.userId, actor.userId),
          eq(clubMembers.clubId, CLUB_ID),
        ),
      );
  }
}

let officer: Actor;
let member: Actor;
let joiner: Actor;
let bystander: Actor;

beforeAll(async () => {
  await db
    .insert(clubs)
    .values({id: CLUB_ID, name: 'Join Link Test Club', slug: 'join-link-test-club'})
    .onConflictDoNothing();

  officer = await createActor('joinlink-officer@example.com', 'Officer');
  member = await createActor('joinlink-member@example.com', 'Member');
  joiner = await createActor('joinlink-joiner@example.com', 'Joiner');
  bystander = await createActor('joinlink-bystander@example.com', 'Bystander');

  await db
    .insert(clubMembers)
    .values([
      {userId: officer.userId, clubId: CLUB_ID, role: 'admin'},
      {userId: member.userId, clubId: CLUB_ID, role: 'member'},
    ])
    .onConflictDoNothing();
});

afterAll(async () => {
  await db.delete(clubJoinLinks).where(eq(clubJoinLinks.clubId, CLUB_ID));
  await db.delete(clubs).where(eq(clubs.id, CLUB_ID));
  await closeDatabase();
});

describe('who may create or revoke a join link', () => {
  it('lets an officer create one', async () => {
    await resetClub();
    const response = await createLink(officer);
    expect(response.status).toBe(201);

    const body = (await response.json()) as {status: string; token: string; useCount: number};
    expect(body.status).toBe('active');
    expect(body.useCount).toBe(0);
    expect(body.token.length).toBeGreaterThan(20);
  });

  it('refuses a member, whatever the UI showed them', async () => {
    await resetClub();
    const response = await createLink(member);
    expect(response.status).toBe(403);
  });

  it('refuses an anonymous caller', async () => {
    await resetClub();
    const response = await createLink(null);
    expect(response.status).toBe(401);
  });

  it('hides the club from a non-member with 404, not 403', async () => {
    const response = await request(`/api/clubs/${CLUB_ID}/join-links`, bystander);
    expect(response.status).toBe(404);
  });

  it('refuses a member trying to list, unlike invitations - a link is the credential itself', async () => {
    await resetClub();
    const response = await request(`/api/clubs/${CLUB_ID}/join-links`, member);
    expect(response.status).toBe(403);
  });

  it('lets an officer revoke a link, and a revoked link no longer previews', async () => {
    await resetClub();
    const created = (await (await createLink(officer)).json()) as {
      id: string;
      token: string;
    };

    const revoke = await request(
      `/api/clubs/${CLUB_ID}/join-links/${created.id}/revoke`,
      officer,
      {method: 'POST'},
    );
    expect(revoke.status).toBe(204);

    const preview = await request(`/api/join-links/${created.token}`, null);
    expect(preview.status).toBe(404);
  });

  it('refuses a member trying to revoke', async () => {
    await resetClub();
    const created = (await (await createLink(officer)).json()) as {id: string};

    const revoke = await request(
      `/api/clubs/${CLUB_ID}/join-links/${created.id}/revoke`,
      member,
      {method: 'POST'},
    );
    expect(revoke.status).toBe(403);
  });

  it('rejects a duration outside the allowed bounds', async () => {
    await resetClub();
    const response = await createLink(officer, {role: 'member', expiresInMinutes: 0});
    expect(response.status).toBe(400);
  });

  it('carries the chosen role and position through to the link', async () => {
    await resetClub();
    const response = await createLink(officer, {
      role: 'admin',
      position: 'treasurer',
      expiresInMinutes: 120,
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as {role: string; position: string};
    expect(body.role).toBe('admin');
    expect(body.position).toBe('treasurer');
  });
});

describe('the public preview', () => {
  it('answers the same for a token that never existed as for one that expired', async () => {
    const neverExisted = await request('/api/join-links/not-a-real-token', null);
    expect(neverExisted.status).toBe(404);

    await resetClub();
    const created = (await (await createLink(officer)).json()) as {
      id: string;
      token: string;
    };
    await db
      .update(clubJoinLinks)
      .set({expiresAt: new Date('2020-01-01T00:00:00.000Z')})
      .where(eq(clubJoinLinks.id, created.id));

    const expired = await request(`/api/join-links/${created.token}`, null);
    expect(expired.status).toBe(404);
  });

  it('needs no session at all', async () => {
    await resetClub();
    const created = (await (await createLink(officer)).json()) as {token: string};
    const response = await request(`/api/join-links/${created.token}`, null);
    expect(response.status).toBe(200);

    const body = (await response.json()) as {clubName: string; role: string};
    expect(body.clubName).toBe('Join Link Test Club');
    expect(body.role).toBe('member');
  });
});

describe('accepting a join link', () => {
  it('creates a membership with the link\'s role and position', async () => {
    await resetClub();
    const created = (await (
      await createLink(officer, {role: 'admin', position: 'marketing_director', expiresInMinutes: 60})
    ).json()) as {token: string};

    const response = await request(`/api/join-links/${created.token}/accept`, joiner, {
      method: 'POST',
    });
    expect(response.status).toBe(200);

    const [row] = await db
      .select()
      .from(clubMembers)
      .where(and(eq(clubMembers.userId, joiner.userId), eq(clubMembers.clubId, CLUB_ID)));
    expect(row?.role).toBe('admin');
    expect(row?.position).toBe('marketing_director');
  });

  it('is idempotent for someone already a member, and does not double-count the use', async () => {
    await resetClub();
    const created = (await (await createLink(officer)).json()) as {
      id: string;
      token: string;
    };

    expect(
      (await request(`/api/join-links/${created.token}/accept`, joiner, {method: 'POST'})).status,
    ).toBe(200);
    expect(
      (await request(`/api/join-links/${created.token}/accept`, joiner, {method: 'POST'})).status,
    ).toBe(200);

    const [row] = await db
      .select({useCount: clubJoinLinks.useCount})
      .from(clubJoinLinks)
      .where(eq(clubJoinLinks.id, created.id));
    expect(row?.useCount).toBe(1);
  });

  it('lets a second, different person use the same link', async () => {
    await resetClub();
    const created = (await (await createLink(officer)).json()) as {
      id: string;
      token: string;
    };

    expect(
      (await request(`/api/join-links/${created.token}/accept`, joiner, {method: 'POST'})).status,
    ).toBe(200);
    expect(
      (await request(`/api/join-links/${created.token}/accept`, bystander, {method: 'POST'}))
        .status,
    ).toBe(200);

    const [row] = await db
      .select({useCount: clubJoinLinks.useCount})
      .from(clubJoinLinks)
      .where(eq(clubJoinLinks.id, created.id));
    expect(row?.useCount).toBe(2);
  });

  it('refuses a revoked link', async () => {
    await resetClub();
    const created = (await (await createLink(officer)).json()) as {
      id: string;
      token: string;
    };
    await request(`/api/clubs/${CLUB_ID}/join-links/${created.id}/revoke`, officer, {
      method: 'POST',
    });

    const response = await request(`/api/join-links/${created.token}/accept`, joiner, {
      method: 'POST',
    });
    expect(response.status).toBe(404);

    const rows = await db
      .select()
      .from(clubMembers)
      .where(and(eq(clubMembers.userId, joiner.userId), eq(clubMembers.clubId, CLUB_ID)));
    expect(rows).toHaveLength(0);
  });

  it('refuses an expired link', async () => {
    await resetClub();
    const created = (await (await createLink(officer)).json()) as {
      id: string;
      token: string;
    };
    await db
      .update(clubJoinLinks)
      .set({expiresAt: new Date('2020-01-01T00:00:00.000Z')})
      .where(eq(clubJoinLinks.id, created.id));

    const response = await request(`/api/join-links/${created.token}/accept`, joiner, {
      method: 'POST',
    });
    expect(response.status).toBe(404);
  });

  it('refuses an anonymous caller', async () => {
    await resetClub();
    const created = (await (await createLink(officer)).json()) as {token: string};

    const response = await request(`/api/join-links/${created.token}/accept`, null, {
      method: 'POST',
    });
    expect(response.status).toBe(401);
  });

  it('refuses a made-up token', async () => {
    const response = await request('/api/join-links/not-a-real-token/accept', joiner, {
      method: 'POST',
    });
    expect(response.status).toBe(404);
  });
});
