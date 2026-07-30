/**
 * Authorization and lifecycle tests for the invitation routes.
 *
 * Two audiences with different rules, and both are worth pinning:
 *
 * - The officer's side is ordinary club-scoped authorization, same as events.
 * - The recipient's side is not club-scoped at all, because the person
 *   answering is by definition not in the club yet. Its only check is that the
 *   invitation is addressed to the session's email, which makes "can someone
 *   accept an invitation meant for another address" the single most important
 *   test in this file.
 *
 * Runs against a real Postgres for the same reason the event tests do: the
 * subject under test is a row lookup and the constraints around it.
 */

import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {and, eq} from 'drizzle-orm';

import {app} from '../app.js';
import {auth} from '../auth/auth.js';
import {closeDatabase, db} from '../db/client.js';
import {user} from '../db/schema/auth.js';
import {clubInvitations, clubMembers, clubs} from '../db/schema/club.js';

const ORIGIN = 'http://localhost:3100';
const PASSWORD = 'test-only-password-1234';
const CLUB_ID = 'club_test_invites';

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

async function invite(
  actor: Actor,
  body: Record<string, unknown>,
): Promise<Response> {
  return request(`/api/clubs/${CLUB_ID}/invitations`, actor, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * Resets the club between tests.
 *
 * Clears invitations so the pending-uniqueness index is fresh, and drops the
 * memberships that accepting creates. Without the second half, a test that
 * accepts leaves the invitee inside the club and every later invite to them
 * correctly fails with "already a member" - which reads as a broken test
 * rather than the leaked state it is.
 *
 * The officer and member fixtures are left alone; they are the club's
 * permanent cast.
 */
async function resetClub(): Promise<void> {
  await db.delete(clubInvitations).where(eq(clubInvitations.clubId, CLUB_ID));
  for (const actor of [invitee, bystander]) {
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
let invitee: Actor;
let bystander: Actor;

beforeAll(async () => {
  await db
    .insert(clubs)
    .values({id: CLUB_ID, name: 'Invite Test Club', slug: 'invite-test-club'})
    .onConflictDoNothing();

  officer = await createActor('invite-officer@example.com', 'Invite Officer');
  member = await createActor('invite-member@example.com', 'Invite Member');
  invitee = await createActor('invite-invitee@example.com', 'Invite Invitee');
  bystander = await createActor('invite-bystander@example.com', 'Bystander');

  await db
    .insert(clubMembers)
    .values([
      {userId: officer.userId, clubId: CLUB_ID, role: 'admin'},
      {userId: member.userId, clubId: CLUB_ID, role: 'member'},
    ])
    .onConflictDoNothing();
});

afterAll(async () => {
  await db.delete(clubInvitations).where(eq(clubInvitations.clubId, CLUB_ID));
  await db.delete(clubs).where(eq(clubs.id, CLUB_ID));
  await closeDatabase();
});

describe('who may invite', () => {
  it('lets an officer invite an address', async () => {
    await resetClub();
    const response = await invite(officer, {
      email: invitee.email,
      role: 'member',
    });
    expect(response.status).toBe(201);

    const body = (await response.json()) as {email: string; status: string};
    expect(body.email).toBe(invitee.email);
    expect(body.status).toBe('pending');
  });

  it('refuses a member, whatever the UI showed them', async () => {
    await resetClub();
    const response = await invite(member, {
      email: 'someone-new@example.com',
      role: 'member',
    });
    expect(response.status).toBe(403);
  });

  it('refuses an anonymous caller', async () => {
    await resetClub();
    const response = await request(`/api/clubs/${CLUB_ID}/invitations`, null, {
      method: 'POST',
      body: JSON.stringify({email: 'x@example.com', role: 'member'}),
    });
    expect(response.status).toBe(401);
  });

  it('hides the club from a non-member with 404, not 403', async () => {
    // Same rule as events: whether a club exists is itself information.
    const response = await request(
      `/api/clubs/${CLUB_ID}/invitations`,
      bystander,
    );
    expect(response.status).toBe(404);
  });

  it('leaves no invitation behind when it refuses a member', async () => {
    await resetClub();
    await invite(member, {email: 'ghost@example.com', role: 'member'});

    const rows = await db
      .select()
      .from(clubInvitations)
      .where(eq(clubInvitations.clubId, CLUB_ID));
    expect(rows).toHaveLength(0);
  });
});

describe('invitation creation rules', () => {
  it('normalises the address before storing it', async () => {
    await resetClub();
    const response = await invite(officer, {
      email: '  MiXeD.Case@Example.COM ',
      role: 'member',
    });
    expect(response.status).toBe(201);
    expect(((await response.json()) as {email: string}).email).toBe(
      'mixed.case@example.com',
    );
  });

  it('refuses a second pending invitation for the same address', async () => {
    await resetClub();
    expect((await invite(officer, {email: invitee.email, role: 'member'})).status).toBe(201);

    const second = await invite(officer, {email: invitee.email, role: 'member'});
    expect(second.status).toBe(409);
  });

  it('refuses inviting someone already in the club', async () => {
    await resetClub();
    const response = await invite(officer, {
      email: member.email,
      role: 'member',
    });
    expect(response.status).toBe(409);
  });

  it('rejects a role that is not a role', async () => {
    await resetClub();
    const response = await invite(officer, {
      email: 'nope@example.com',
      role: 'president',
    });
    expect(response.status).toBe(400);
  });

  it('carries an officer role and a position through to the invitation', async () => {
    await resetClub();
    const response = await invite(officer, {
      email: 'new-treasurer@example.com',
      role: 'admin',
      position: 'treasurer',
    });
    expect(response.status).toBe(201);

    const body = (await response.json()) as {role: string; position: string};
    expect(body.role).toBe('admin');
    expect(body.position).toBe('treasurer');
  });
});

describe('answering an invitation', () => {
  async function pendingIdFor(actor: Actor): Promise<string> {
    const response = await request('/api/invitations', actor);
    expect(response.status).toBe(200);
    const list = (await response.json()) as {id: string}[];
    const first = list[0];
    if (!first) {
      throw new Error('expected a pending invitation');
    }
    return first.id;
  }

  it('shows the recipient only invitations for their own address', async () => {
    await resetClub();
    await invite(officer, {email: invitee.email, role: 'member'});

    const mine = (await (
      await request('/api/invitations', invitee)
    ).json()) as unknown[];
    expect(mine).toHaveLength(1);

    const theirs = (await (
      await request('/api/invitations', bystander)
    ).json()) as unknown[];
    expect(theirs).toHaveLength(0);
  });

  it('creates the membership on accept', async () => {
    await resetClub();
    await invite(officer, {email: invitee.email, role: 'admin', position: 'vice_president'});

    const id = await pendingIdFor(invitee);
    const response = await request(`/api/invitations/${id}/respond`, invitee, {
      method: 'POST',
      body: JSON.stringify({decision: 'accepted'}),
    });
    expect(response.status).toBe(204);

    const [row] = await db
      .select()
      .from(clubMembers)
      .where(
        and(
          eq(clubMembers.userId, invitee.userId),
          eq(clubMembers.clubId, CLUB_ID),
        ),
      );
    expect(row?.role).toBe('admin');
    expect(row?.position).toBe('vice_president');
  });

  it('creates no membership on decline', async () => {
    await resetClub();
    await invite(officer, {email: invitee.email, role: 'member'});

    const id = await pendingIdFor(invitee);
    const response = await request(`/api/invitations/${id}/respond`, invitee, {
      method: 'POST',
      body: JSON.stringify({decision: 'declined'}),
    });
    expect(response.status).toBe(204);

    const rows = await db
      .select()
      .from(clubMembers)
      .where(
        and(
          eq(clubMembers.userId, invitee.userId),
          eq(clubMembers.clubId, CLUB_ID),
        ),
      );
    expect(rows).toHaveLength(0);
  });

  it('refuses to let someone answer an invitation sent to another address', async () => {
    // The one that matters. An invitation is claimed by proving control of the
    // address it names; without this check the id alone would be enough.
    await resetClub();
    await invite(officer, {email: invitee.email, role: 'admin'});

    const id = await pendingIdFor(invitee);
    const response = await request(`/api/invitations/${id}/respond`, bystander, {
      method: 'POST',
      body: JSON.stringify({decision: 'accepted'}),
    });
    // 404 rather than 403: an id belonging to someone else should not be
    // confirmable as real.
    expect(response.status).toBe(404);

    const rows = await db
      .select()
      .from(clubMembers)
      .where(
        and(
          eq(clubMembers.userId, bystander.userId),
          eq(clubMembers.clubId, CLUB_ID),
        ),
      );
    expect(rows, 'a refused accept must not create a membership').toHaveLength(
      0,
    );
  });

  it('refuses to answer the same invitation twice', async () => {
    await resetClub();
    await invite(officer, {email: invitee.email, role: 'member'});

    const id = await pendingIdFor(invitee);
    expect(
      (
        await request(`/api/invitations/${id}/respond`, invitee, {
          method: 'POST',
          body: JSON.stringify({decision: 'accepted'}),
        })
      ).status,
    ).toBe(204);

    const again = await request(`/api/invitations/${id}/respond`, invitee, {
      method: 'POST',
      body: JSON.stringify({decision: 'accepted'}),
    });
    expect(again.status).toBe(409);
  });

  it('refuses an expired invitation even though it is still pending', async () => {
    await resetClub();
    await invite(officer, {email: invitee.email, role: 'member'});

    const id = await pendingIdFor(invitee);
    await db
      .update(clubInvitations)
      .set({expiresAt: new Date('2020-01-01T00:00:00.000Z')})
      .where(eq(clubInvitations.id, id));

    // It drops out of the recipient's list...
    const mine = (await (
      await request('/api/invitations', invitee)
    ).json()) as unknown[];
    expect(mine).toHaveLength(0);

    // ...and cannot be answered directly either, which is the half that
    // actually protects anything.
    const response = await request(`/api/invitations/${id}/respond`, invitee, {
      method: 'POST',
      body: JSON.stringify({decision: 'accepted'}),
    });
    expect(response.status).toBe(409);
  });

  it('refuses an anonymous caller', async () => {
    await resetClub();
    await invite(officer, {email: invitee.email, role: 'member'});
    const id = await pendingIdFor(invitee);

    const response = await request(`/api/invitations/${id}/respond`, null, {
      method: 'POST',
      body: JSON.stringify({decision: 'accepted'}),
    });
    expect(response.status).toBe(401);
  });
});
