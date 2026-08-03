/**
 * Authorization and invariant tests for the treasury routes.
 *
 * Two things are being checked, and only one of them is authorization.
 *
 * The first is the usual question: does a member who bypasses the UI actually
 * get stopped. The treasury is the first surface that is officer-only
 * **including read**, so a member is refused a `GET` here - which is the
 * opposite of the document hub and worth pinning, because it is exactly the
 * kind of asymmetry a later refactor "tidies up".
 *
 * The second is the cross-club fund invariant. A request carries a `club_id`
 * and a `fund_id`, and no foreign key can compare the two, so nothing but
 * `treasury-store.ts` stops one club filing a request against another club's
 * grant. That would corrupt two clubs' balances at once and leak that the fund
 * exists, and it cannot be tested without a real database holding both clubs.
 *
 * Requires `docker compose up -d postgres` and a migrated database.
 */

import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {eq} from 'drizzle-orm';

/**
 * `../app.js` must be imported before `@cos/core`, and the order is load-bearing.
 *
 * Under vitest, `@cos/core` is a workspace package resolved through Node's own
 * module registry while this file is transformed by vite, so the two can end up
 * holding separate instances of `zod`. `@hono/zod-openapi` extends
 * `ZodType.prototype` with `.openapi()` on whichever instance it reaches first;
 * importing core ahead of it creates every core schema against the other one,
 * and the route modules then die on `clubDocumentSchema.openapi is not a
 * function` before a single test runs.
 *
 * Production never hits this - `src/index.ts` reaches `app.ts` and its routes,
 * and therefore `@hono/zod-openapi`, before anything touches a core schema.
 * The failure is loud rather than silent, so this comment is the guard rather
 * than a lint rule.
 */
import {app} from '../app.js';
import {summarizeFund} from '@cos/core';
import type {ExpenseRequest, Fund, FundAllocation} from '@cos/core';

import {auth} from '../auth/auth.js';
import {closeDatabase, db} from '../db/client.js';
import {user} from '../db/schema/auth.js';
import {clubMembers, clubs} from '../db/schema/club.js';
import {events} from '../db/schema/event.js';
import {
  expenseRequests,
  fundAllocations,
  funds,
} from '../db/schema/treasury.js';

const ORIGIN = 'http://localhost:3100';
const PASSWORD = 'test-only-password-1234';

const CLUB_ID = 'club_test_treasury';
const OTHER_CLUB_ID = 'club_test_treasury_other';

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
      'Content-Type': 'application/json',
      Origin: ORIGIN,
      ...(actor ? {Cookie: actor.cookie} : {}),
      ...init.headers,
    },
  });
}

const fundDraft = {
  name: "Dean's Fund 2026-27",
  source: 'university',
  startsOn: '2026-08-01',
  endsOn: '2027-05-15',
  restrictions: 'No alcohol.',
};

let officer: Actor;
let member: Actor;
let outsider: Actor;
/** The club's own fund, allocated $1,500. */
let fundId: string;
/** A fund belonging to a different club entirely. */
let otherClubFundId: string;
/** An event in the other club, for the cross-club link test. */
let otherClubEventId: string;

beforeAll(async () => {
  await db
    .insert(clubs)
    .values([
      {id: CLUB_ID, name: 'Treasury Test Club', slug: 'treasury-test-club'},
      {id: OTHER_CLUB_ID, name: 'Other Club', slug: 'treasury-other-club'},
    ])
    .onConflictDoNothing();

  officer = await createActor('treasury-officer@example.com', 'Tess Officer');
  member = await createActor('treasury-member@example.com', 'Mel Member');
  outsider = await createActor('treasury-outsider@example.com', 'Otto Outside');

  await db
    .insert(clubMembers)
    .values([
      {userId: officer.userId, clubId: CLUB_ID, role: 'admin'},
      {userId: member.userId, clubId: CLUB_ID, role: 'member'},
      // An officer of a *different* club - real, signed in, and entitled to
      // nothing here.
      {userId: outsider.userId, clubId: OTHER_CLUB_ID, role: 'admin'},
    ])
    .onConflictDoNothing();

  const created = await request(`/api/clubs/${CLUB_ID}/funds`, officer, {
    method: 'POST',
    body: JSON.stringify(fundDraft),
  });
  expect(created.status, 'seed fund').toBe(201);
  fundId = ((await created.json()) as Fund).id;

  const otherFund = await request(
    `/api/clubs/${OTHER_CLUB_ID}/funds`,
    outsider,
    {method: 'POST', body: JSON.stringify({...fundDraft, name: 'Their fund'})},
  );
  expect(otherFund.status, 'seed other club fund').toBe(201);
  otherClubFundId = ((await otherFund.json()) as Fund).id;

  const otherEvent = await request(
    `/api/clubs/${OTHER_CLUB_ID}/events`,
    outsider,
    {
      method: 'POST',
      body: JSON.stringify({
        title: 'Their meeting',
        startsAt: '2026-10-14T18:00:00.000Z',
        endsAt: '2026-10-14T19:00:00.000Z',
      }),
    },
  );
  expect(otherEvent.status, 'seed other club event').toBe(201);
  otherClubEventId = ((await otherEvent.json()) as {id: string}).id;
});

afterAll(async () => {
  // Order matters: `expense_requests.fund_id` is ON DELETE restrict, so
  // requests go before funds.
  for (const club of [CLUB_ID, OTHER_CLUB_ID]) {
    await db.delete(expenseRequests).where(eq(expenseRequests.clubId, club));
  }
  const clubFunds = await db
    .select({id: funds.id})
    .from(funds)
    .where(eq(funds.clubId, CLUB_ID));
  const otherFunds = await db
    .select({id: funds.id})
    .from(funds)
    .where(eq(funds.clubId, OTHER_CLUB_ID));
  for (const fund of [...clubFunds, ...otherFunds]) {
    await db.delete(fundAllocations).where(eq(fundAllocations.fundId, fund.id));
  }
  for (const club of [CLUB_ID, OTHER_CLUB_ID]) {
    await db.delete(funds).where(eq(funds.clubId, club));
    await db.delete(events).where(eq(events.clubId, club));
    await db.delete(clubs).where(eq(clubs.id, club));
  }
  await closeDatabase();
});

describe('anonymous callers', () => {
  it('cannot list funds', async () => {
    const response = await request(`/api/clubs/${CLUB_ID}/funds`, null);
    expect(response.status).toBe(401);
  });

  it('cannot list requests', async () => {
    const response = await request(`/api/clubs/${CLUB_ID}/requests`, null);
    expect(response.status).toBe(401);
  });

  it('cannot create a fund', async () => {
    const response = await request(`/api/clubs/${CLUB_ID}/funds`, null, {
      method: 'POST',
      body: JSON.stringify(fundDraft),
    });
    expect(response.status).toBe(401);
  });
});

describe('a member', () => {
  it('is refused even reading the treasury, unlike the document hub', async () => {
    // The treasury is officer-only *including read*, because `expense:view` is
    // what the sidebar gates on - granting it would put the section in front of
    // the whole club. This asymmetry with documents is deliberate.
    const response = await request(`/api/clubs/${CLUB_ID}/funds`, member);
    expect(response.status).toBe(403);
  });

  it('is refused reading requests', async () => {
    const response = await request(`/api/clubs/${CLUB_ID}/requests`, member);
    expect(response.status).toBe(403);
  });

  it('is refused reading allocations', async () => {
    const response = await request(`/api/clubs/${CLUB_ID}/allocations`, member);
    expect(response.status).toBe(403);
  });

  it('is refused creating a fund, bypassing the UI entirely', async () => {
    const response = await request(`/api/clubs/${CLUB_ID}/funds`, member, {
      method: 'POST',
      body: JSON.stringify(fundDraft),
    });
    expect(response.status).toBe(403);
  });

  it('is refused filing a request', async () => {
    const response = await request(`/api/clubs/${CLUB_ID}/requests`, member, {
      method: 'POST',
      body: JSON.stringify({
        fundId,
        title: 'Pizza',
        requestedAmountCents: 5_000,
      }),
    });
    expect(response.status).toBe(403);
  });

  it('is refused recording an allocation', async () => {
    const response = await request(
      `/api/clubs/${CLUB_ID}/funds/${fundId}/allocations`,
      member,
      {method: 'POST', body: JSON.stringify({amountCents: 100_000})},
    );
    expect(response.status).toBe(403);
  });
});

describe('the method-to-capability map', () => {
  it('asks for the specific capability each method needs', async () => {
    // Not reachable through HTTP with the roles that exist: `admin` holds all
    // four `expense:*` and `member` holds none, so `expense:view` and
    // `expense:create` currently permit exactly the same callers. A gate asking
    // for the wrong one is invisible until a third role holds read without
    // write, and then it is a privilege escalation. Found by mutation - both
    // swaps survived every authorization test in this file.
    const {TREASURY_METHOD_CAPABILITY} = await import('./treasury.js');

    expect(TREASURY_METHOD_CAPABILITY).toEqual({
      GET: 'expense:view',
      POST: 'expense:create',
      PATCH: 'expense:edit',
      DELETE: 'expense:delete',
    });
  });

  it('gates every treasury path, so none is left open', async () => {
    const {TREASURY_PATHS} = await import('./treasury.js');

    // If a path is added to the router without being added here, it inherits
    // no gate at all and answers to any signed-in member of the club.
    expect([...TREASURY_PATHS].sort()).toEqual(
      [
        '/clubs/:clubId/allocations',
        '/clubs/:clubId/funds',
        '/clubs/:clubId/funds/:fundId',
        '/clubs/:clubId/funds/:fundId/allocations',
        '/clubs/:clubId/requests',
        '/clubs/:clubId/requests/:requestId',
      ].sort(),
    );
  });
});

describe('someone from another club', () => {
  it('gets 404 rather than 403, so club ids cannot be enumerated', async () => {
    const response = await request(`/api/clubs/${CLUB_ID}/funds`, outsider);
    expect(response.status).toBe(404);
  });

  it('cannot read another club’s requests', async () => {
    const response = await request(`/api/clubs/${CLUB_ID}/requests`, outsider);
    expect(response.status).toBe(404);
  });
});

describe('the cross-club fund invariant', () => {
  it('refuses a request filed against another club’s fund', async () => {
    // No foreign key can express this: both rows carry a club, and comparing
    // them is the store's job. Without the check, one club could spend against
    // another's grant and corrupt two balances at once.
    const response = await request(`/api/clubs/${CLUB_ID}/requests`, officer, {
      method: 'POST',
      body: JSON.stringify({
        fundId: otherClubFundId,
        title: 'Not our money',
        requestedAmountCents: 5_000,
      }),
    });

    expect(response.status).toBe(400);
  });

  it('refuses moving an existing request onto another club’s fund', async () => {
    const created = await request(`/api/clubs/${CLUB_ID}/requests`, officer, {
      method: 'POST',
      body: JSON.stringify({
        fundId,
        title: 'Legitimate request',
        requestedAmountCents: 5_000,
      }),
    });
    const request_ = (await created.json()) as ExpenseRequest;

    const moved = await request(
      `/api/clubs/${CLUB_ID}/requests/${request_.id}`,
      officer,
      {method: 'PATCH', body: JSON.stringify({fundId: otherClubFundId})},
    );

    expect(moved.status).toBe(400);
  });

  it('refuses a request linked to another club’s event', async () => {
    // A dangling link renders as a blank on the audit export, which is the one
    // document where an unexplained line costs a club its funding.
    const response = await request(`/api/clubs/${CLUB_ID}/requests`, officer, {
      method: 'POST',
      body: JSON.stringify({
        fundId,
        title: 'Food for their meeting',
        requestedAmountCents: 5_000,
        eventId: otherClubEventId,
      }),
    });

    expect(response.status).toBe(400);
  });

  it('refuses an allocation into another club’s fund', async () => {
    const response = await request(
      `/api/clubs/${CLUB_ID}/funds/${otherClubFundId}/allocations`,
      officer,
      {method: 'POST', body: JSON.stringify({amountCents: 100_000})},
    );

    expect(response.status).toBe(400);
  });
});

describe('the ledger’s append-only rules', () => {
  it('deletes a draft, which was never asked for', async () => {
    const created = await request(`/api/clubs/${CLUB_ID}/requests`, officer, {
      method: 'POST',
      body: JSON.stringify({
        fundId,
        title: 'Filed by mistake',
        requestedAmountCents: 1_000,
      }),
    });
    const draft = (await created.json()) as ExpenseRequest;
    expect(draft.status).toBe('draft');

    const deleted = await request(
      `/api/clubs/${CLUB_ID}/requests/${draft.id}`,
      officer,
      {method: 'DELETE'},
    );

    expect(deleted.status).toBe(204);
  });

  it('refuses to delete a request the club actually asked for', async () => {
    // "We asked and withdrew" must stay distinguishable from "we never asked".
    // A delete would destroy that distinction silently.
    const created = await request(`/api/clubs/${CLUB_ID}/requests`, officer, {
      method: 'POST',
      body: JSON.stringify({
        fundId,
        title: 'Genuinely submitted',
        requestedAmountCents: 1_000,
        status: 'submitted',
      }),
    });
    const submitted = (await created.json()) as ExpenseRequest;

    const deleted = await request(
      `/api/clubs/${CLUB_ID}/requests/${submitted.id}`,
      officer,
      {method: 'DELETE'},
    );

    expect(deleted.status).toBe(400);

    // And it is still there.
    const stillThere = await request(
      `/api/clubs/${CLUB_ID}/requests`,
      officer,
    );
    const all = (await stillThere.json()) as ExpenseRequest[];
    expect(all.some((entry) => entry.id === submitted.id)).toBe(true);
  });

  it('stamps submittedAt once and never re-stamps it on a later edit', async () => {
    // The age of a request is what a staleness warning is computed from.
    // Re-stamping would quietly reset a request that has been sitting with the
    // university for a month.
    const created = await request(`/api/clubs/${CLUB_ID}/requests`, officer, {
      method: 'POST',
      body: JSON.stringify({
        fundId,
        title: 'Ages slowly',
        requestedAmountCents: 1_000,
        status: 'submitted',
      }),
    });
    const first = (await created.json()) as ExpenseRequest;
    expect(first.submittedAt).not.toBeNull();

    const patched = await request(
      `/api/clubs/${CLUB_ID}/requests/${first.id}`,
      officer,
      {method: 'PATCH', body: JSON.stringify({status: 'approved'})},
    );
    const second = (await patched.json()) as ExpenseRequest;

    expect(second.submittedAt).toBe(first.submittedAt);
  });

  it('has no route that edits or deletes an allocation entry', async () => {
    const entry = await request(
      `/api/clubs/${CLUB_ID}/funds/${fundId}/allocations`,
      officer,
      {method: 'POST', body: JSON.stringify({amountCents: 1_000})},
    );
    expect(entry.status).toBe(201);
    const created = (await entry.json()) as FundAllocation;

    // Correcting an entry means recording the correction, so the original
    // stays visible. There is deliberately no endpoint for either of these.
    const patched = await request(
      `/api/clubs/${CLUB_ID}/funds/${fundId}/allocations/${created.id}`,
      officer,
      {method: 'PATCH', body: JSON.stringify({amountCents: 1})},
    );
    expect(patched.status).toBe(404);
  });

  it('refuses an amount that is not whole cents', async () => {
    const response = await request(`/api/clubs/${CLUB_ID}/requests`, officer, {
      method: 'POST',
      body: JSON.stringify({
        fundId,
        title: 'Fractional',
        requestedAmountCents: 50.5,
      }),
    });

    expect(response.status).toBe(400);
  });
});

describe('a closed fund', () => {
  it('stops accepting requests but stays readable', async () => {
    const created = await request(`/api/clubs/${CLUB_ID}/funds`, officer, {
      method: 'POST',
      body: JSON.stringify({...fundDraft, name: 'Closing soon'}),
    });
    const fund = (await created.json()) as Fund;

    const closed = await request(
      `/api/clubs/${CLUB_ID}/funds/${fund.id}`,
      officer,
      {method: 'PATCH', body: JSON.stringify({closed: true})},
    );
    expect(closed.status).toBe(200);
    expect(((await closed.json()) as Fund).closedAt).not.toBeNull();

    const refused = await request(`/api/clubs/${CLUB_ID}/requests`, officer, {
      method: 'POST',
      body: JSON.stringify({
        fundId: fund.id,
        title: 'Too late',
        requestedAmountCents: 1_000,
      }),
    });
    expect(refused.status).toBe(400);

    // Still listed. Closing is not deleting - last year's spending stays
    // answerable for.
    const listed = await request(`/api/clubs/${CLUB_ID}/funds`, officer);
    const all = (await listed.json()) as Fund[];
    expect(all.some((entry) => entry.id === fund.id)).toBe(true);
  });

  it('can be reopened, so a mistake needs no database repair', async () => {
    const created = await request(`/api/clubs/${CLUB_ID}/funds`, officer, {
      method: 'POST',
      body: JSON.stringify({...fundDraft, name: 'Closed by mistake'}),
    });
    const fund = (await created.json()) as Fund;

    await request(`/api/clubs/${CLUB_ID}/funds/${fund.id}`, officer, {
      method: 'PATCH',
      body: JSON.stringify({closed: true}),
    });
    const reopened = await request(
      `/api/clubs/${CLUB_ID}/funds/${fund.id}`,
      officer,
      {method: 'PATCH', body: JSON.stringify({closed: false})},
    );

    expect(((await reopened.json()) as Fund).closedAt).toBeNull();
  });
});

describe('a fund never stores a balance', () => {
  it('ignores an amount supplied on create', async () => {
    const created = await request(`/api/clubs/${CLUB_ID}/funds`, officer, {
      method: 'POST',
      body: JSON.stringify({
        ...fundDraft,
        name: 'Sneaky',
        allocatedCents: 999_999,
      }),
    });
    const fund = (await created.json()) as Fund & {allocatedCents?: number};

    expect(fund.allocatedCents).toBeUndefined();

    // And the fund really is empty - the number went nowhere.
    const allocations = await request(
      `/api/clubs/${CLUB_ID}/allocations`,
      officer,
    );
    const entries = (await allocations.json()) as FundAllocation[];
    expect(entries.filter((entry) => entry.fundId === fund.id)).toHaveLength(0);
  });

  it('refuses a period that ends before it starts, on a patch too', async () => {
    const response = await request(
      `/api/clubs/${CLUB_ID}/funds/${fundId}`,
      officer,
      {method: 'PATCH', body: JSON.stringify({endsOn: '2020-01-01'})},
    );

    expect(response.status).toBe(400);
  });
});

describe('the three numbers, over real HTTP', () => {
  it('folds the whole founding use case correctly', async () => {
    // A $1,500 dean's fund, one purchase confirmed cheaper than requested, and
    // two requests still sitting with the university. This is the case the
    // whole model exists for: a treasurer reading only "spent" would see $478
    // and believe there is $1,022 left to ask for.
    const created = await request(`/api/clubs/${CLUB_ID}/funds`, officer, {
      method: 'POST',
      body: JSON.stringify({...fundDraft, name: 'End to end'}),
    });
    const fund = (await created.json()) as Fund;

    await request(
      `/api/clubs/${CLUB_ID}/funds/${fund.id}/allocations`,
      officer,
      {
        method: 'POST',
        body: JSON.stringify({
          amountCents: 150_000,
          note: 'Initial grant',
        }),
      },
    );

    const purchased = await request(
      `/api/clubs/${CLUB_ID}/requests`,
      officer,
      {
        method: 'POST',
        body: JSON.stringify({
          fundId: fund.id,
          title: 'Pizza for the October meeting',
          requestedAmountCents: 50_000,
          status: 'submitted',
        }),
      },
    );
    const pizza = (await purchased.json()) as ExpenseRequest;
    await request(`/api/clubs/${CLUB_ID}/requests/${pizza.id}`, officer, {
      method: 'PATCH',
      body: JSON.stringify({status: 'purchased', actualAmountCents: 47_830}),
    });

    for (const title of ['Stickers', 'Competition entry']) {
      await request(`/api/clubs/${CLUB_ID}/requests`, officer, {
        method: 'POST',
        body: JSON.stringify({
          fundId: fund.id,
          title,
          requestedAmountCents: 40_000,
          status: 'submitted',
        }),
      });
    }

    const [allocationsResponse, requestsResponse] = await Promise.all([
      request(`/api/clubs/${CLUB_ID}/allocations`, officer),
      request(`/api/clubs/${CLUB_ID}/requests`, officer),
    ]);

    const summary = summarizeFund(
      fund.id,
      (await allocationsResponse.json()) as FundAllocation[],
      (await requestsResponse.json()) as ExpenseRequest[],
    );

    expect(summary.allocatedCents).toBe(150_000);
    expect(summary.spentCents).toBe(47_830);
    expect(summary.committedCents).toBe(80_000);
    // The number that matters, and the one a spreadsheet gets wrong: $22.17,
    // not the $1,022 that "allocated minus spent" would show.
    expect(summary.availableCents).toBe(22_170);
  });

  it('reports a negative available figure when the club over-commits', async () => {
    const created = await request(`/api/clubs/${CLUB_ID}/funds`, officer, {
      method: 'POST',
      body: JSON.stringify({...fundDraft, name: 'Over-committed'}),
    });
    const fund = (await created.json()) as Fund;

    await request(
      `/api/clubs/${CLUB_ID}/funds/${fund.id}/allocations`,
      officer,
      {method: 'POST', body: JSON.stringify({amountCents: 10_000})},
    );
    await request(`/api/clubs/${CLUB_ID}/requests`, officer, {
      method: 'POST',
      body: JSON.stringify({
        fundId: fund.id,
        title: 'More than we have',
        requestedAmountCents: 25_000,
        status: 'submitted',
      }),
    });

    const [allocationsResponse, requestsResponse] = await Promise.all([
      request(`/api/clubs/${CLUB_ID}/allocations`, officer),
      request(`/api/clubs/${CLUB_ID}/requests`, officer),
    ]);

    const summary = summarizeFund(
      fund.id,
      (await allocationsResponse.json()) as FundAllocation[],
      (await requestsResponse.json()) as ExpenseRequest[],
    );

    expect(summary.availableCents).toBe(-15_000);
  });

  it('subtracts a mid-year reduction recorded as a negative entry', async () => {
    const created = await request(`/api/clubs/${CLUB_ID}/funds`, officer, {
      method: 'POST',
      body: JSON.stringify({...fundDraft, name: 'Cut mid-year'}),
    });
    const fund = (await created.json()) as Fund;

    for (const [amountCents, note] of [
      [150_000, 'Initial grant'],
      [-50_000, 'Reduced by the dean’s office'],
    ] as const) {
      const response = await request(
        `/api/clubs/${CLUB_ID}/funds/${fund.id}/allocations`,
        officer,
        {method: 'POST', body: JSON.stringify({amountCents, note})},
      );
      expect(response.status).toBe(201);
    }

    const allocationsResponse = await request(
      `/api/clubs/${CLUB_ID}/allocations`,
      officer,
    );
    const entries = (await allocationsResponse.json()) as FundAllocation[];
    const summary = summarizeFund(fund.id, entries, []);

    expect(summary.allocatedCents).toBe(100_000);
    // The original grant is still on the record, which an edit would have
    // destroyed.
    expect(
      entries.filter(
        (entry) => entry.fundId === fund.id && entry.amountCents === 150_000,
      ),
    ).toHaveLength(1);
  });
});
