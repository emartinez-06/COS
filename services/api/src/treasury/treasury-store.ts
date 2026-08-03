/**
 * Reading and writing the treasury, and the conversion between database rows
 * and the shapes in @cos/core.
 *
 * Two rules run through everything here.
 *
 * **Nothing computes a balance.** The three numbers come from `summarizeFund`
 * in @cos/core, folded over the rows these functions return. There is no SQL
 * `sum()` anywhere in this file, and there should never be one: a second
 * implementation of the most consequential arithmetic in the product would
 * eventually disagree with the first, and the disagreement would surface as a
 * confidently wrong number on a money screen.
 *
 * **A request's fund must belong to the request's club.** The database cannot
 * express that - both rows carry a club, and a foreign key cannot compare them.
 * So every write that names a fund checks it here. Skipping the check would let
 * one club file a request against another club's grant, which both leaks that
 * the fund exists and corrupts two clubs' balances at once.
 */

import {randomUUID} from 'node:crypto';
import type {
  ExpenseRequest,
  ExpenseRequestDraft,
  ExpenseRequestPatch,
  Fund,
  FundAllocation,
  FundAllocationDraft,
  FundDraft,
  FundPatch,
} from '@cos/core';
import {and, desc, eq} from 'drizzle-orm';

import {db} from '../db/client.js';
import {user} from '../db/schema/auth.js';
import {events} from '../db/schema/event.js';
import {
  expenseRequests,
  fundAllocations,
  funds,
} from '../db/schema/treasury.js';

type FundRow = typeof funds.$inferSelect;
type AllocationRow = typeof fundAllocations.$inferSelect;
type RequestRow = typeof expenseRequests.$inferSelect;

/** A deleted account leaves its records behind; the domain still needs a name. */
const FORMER_MEMBER = 'Former member';

function toFund(row: FundRow, createdByName: string | null): Fund {
  return {
    id: row.id,
    clubId: row.clubId,
    name: row.name,
    source: row.source,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    restrictions: row.restrictions,
    expiresUnspent: row.expiresUnspent,
    closedAt: row.closedAt?.toISOString() ?? null,
    createdBy: createdByName ?? FORMER_MEMBER,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toAllocation(
  row: AllocationRow,
  clubId: string,
  recordedByName: string | null,
): FundAllocation {
  return {
    id: row.id,
    fundId: row.fundId,
    // Read from the fund rather than from a column of its own - see the note
    // on `fund_allocations` in the schema for why the column does not exist.
    clubId,
    amountCents: row.amountCents,
    note: row.note,
    recordedBy: recordedByName ?? FORMER_MEMBER,
    recordedAt: row.recordedAt.toISOString(),
  };
}

function toRequest(
  row: RequestRow,
  createdByName: string | null,
): ExpenseRequest {
  return {
    id: row.id,
    clubId: row.clubId,
    fundId: row.fundId,
    title: row.title,
    justification: row.justification,
    category: row.category,
    status: row.status,
    requestedAmountCents: row.requestedAmountCents,
    actualAmountCents: row.actualAmountCents,
    neededBy: row.neededBy,
    eventId: row.eventId,
    decisionNote: row.decisionNote,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    createdBy: createdByName ?? FORMER_MEMBER,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Raised when a write names a fund that is not this club's, or not there. */
export class UnknownFundError extends Error {
  constructor(readonly fundId: string) {
    super('That fund does not exist in this club');
    this.name = 'UnknownFundError';
  }
}

/** Raised when a write targets a fund the club has closed. */
export class ClosedFundError extends Error {
  constructor(readonly fundId: string) {
    super('That fund is closed');
    this.name = 'ClosedFundError';
  }
}

/** Raised when a request points at an event that is not this club's. */
export class UnknownEventError extends Error {
  constructor(readonly eventId: string) {
    super('That event does not exist in this club');
    this.name = 'UnknownEventError';
  }
}

/**
 * Checks that a linked event is this club's, or throws.
 *
 * Refused rather than stored, because a dangling link is worse than no link: it
 * renders as a blank on the audit export, which is the one document where an
 * unexplained line item costs a club its funding. It would also be a way to
 * probe whether an event id exists in another club.
 */
async function requireEventInClub(
  clubId: string,
  eventId: string,
): Promise<void> {
  const [row] = await db
    .select({id: events.id})
    .from(events)
    .where(and(eq(events.clubId, clubId), eq(events.id, eventId)))
    .limit(1);

  if (!row) {
    throw new UnknownEventError(eventId);
  }
}

/**
 * Resolves a fund inside a club, or throws.
 *
 * The single choke point for the cross-club invariant. Every write that names a
 * fund goes through here, so there is one place to get it right rather than one
 * per handler.
 */
async function requireFund(clubId: string, fundId: string): Promise<FundRow> {
  const [row] = await db
    .select()
    .from(funds)
    .where(and(eq(funds.clubId, clubId), eq(funds.id, fundId)))
    .limit(1);

  if (!row) {
    throw new UnknownFundError(fundId);
  }
  return row;
}

/** Every fund the club holds, including closed ones, earliest period first. */
export async function listFunds(clubId: string): Promise<Fund[]> {
  const rows = await db
    .select({fund: funds, createdByName: user.name})
    .from(funds)
    .leftJoin(user, eq(funds.createdBy, user.id))
    .where(eq(funds.clubId, clubId))
    .orderBy(funds.startsOn, funds.name);

  return rows.map((row) => toFund(row.fund, row.createdByName));
}

export async function findFund(
  clubId: string,
  fundId: string,
): Promise<Fund | null> {
  const [row] = await db
    .select({fund: funds, createdByName: user.name})
    .from(funds)
    .leftJoin(user, eq(funds.createdBy, user.id))
    .where(and(eq(funds.clubId, clubId), eq(funds.id, fundId)))
    .limit(1);

  return row ? toFund(row.fund, row.createdByName) : null;
}

export async function createFund(
  clubId: string,
  draft: FundDraft,
  authorId: string,
): Promise<Fund> {
  const [row] = await db
    .insert(funds)
    .values({
      id: `fund_${randomUUID()}`,
      clubId,
      name: draft.name,
      source: draft.source,
      startsOn: draft.startsOn,
      endsOn: draft.endsOn,
      restrictions: draft.restrictions,
      expiresUnspent: draft.expiresUnspent,
      createdBy: authorId,
    })
    .returning();

  if (!row) {
    throw new Error('Insert returned no row');
  }

  const [author] = await db
    .select({name: user.name})
    .from(user)
    .where(eq(user.id, authorId))
    .limit(1);

  return toFund(row, author?.name ?? null);
}

/**
 * Edits a fund's identity, period, or rules. Never its balance.
 *
 * Returns null when the fund is not in this club, so the caller answers 404
 * without a second read.
 */
export async function updateFund(
  clubId: string,
  fundId: string,
  patch: FundPatch,
): Promise<Fund | null> {
  const changes: Partial<typeof funds.$inferInsert> = {};
  if (patch.name !== undefined) changes.name = patch.name;
  if (patch.source !== undefined) changes.source = patch.source;
  if (patch.startsOn !== undefined) changes.startsOn = patch.startsOn;
  if (patch.endsOn !== undefined) changes.endsOn = patch.endsOn;
  if (patch.restrictions !== undefined) {
    changes.restrictions = patch.restrictions;
  }
  if (patch.expiresUnspent !== undefined) {
    changes.expiresUnspent = patch.expiresUnspent;
  }
  // Reopening is deliberately allowed: a fund closed by mistake in the middle
  // of a semester should not need a database repair to undo.
  if (patch.closed !== undefined) {
    changes.closedAt = patch.closed ? new Date() : null;
  }

  if (Object.keys(changes).length === 0) {
    return findFund(clubId, fundId);
  }

  const [row] = await db
    .update(funds)
    .set(changes)
    .where(and(eq(funds.clubId, clubId), eq(funds.id, fundId)))
    .returning();

  if (!row) {
    return null;
  }

  const [author] = row.createdBy
    ? await db
        .select({name: user.name})
        .from(user)
        .where(eq(user.id, row.createdBy))
        .limit(1)
    : [];

  return toFund(row, author?.name ?? null);
}

/**
 * Every allocation entry across the club's funds, newest first.
 *
 * Joined through `funds` rather than filtered on a `club_id` column, because
 * the entries do not carry one. One join is the price of not having a second
 * place for the club id to be wrong.
 */
export async function listAllocations(
  clubId: string,
): Promise<FundAllocation[]> {
  const rows = await db
    .select({
      allocation: fundAllocations,
      clubId: funds.clubId,
      recordedByName: user.name,
    })
    .from(fundAllocations)
    .innerJoin(funds, eq(fundAllocations.fundId, funds.id))
    .leftJoin(user, eq(fundAllocations.recordedBy, user.id))
    .where(eq(funds.clubId, clubId))
    .orderBy(desc(fundAllocations.recordedAt));

  return rows.map((row) =>
    toAllocation(row.allocation, row.clubId, row.recordedByName),
  );
}

/**
 * Records money entering a fund.
 *
 * Append-only by omission: there is no update or delete counterpart, which is
 * what keeps a superseded grant visible after it has been revised.
 */
export async function allocate(
  clubId: string,
  fundId: string,
  draft: FundAllocationDraft,
  authorId: string,
): Promise<FundAllocation> {
  const fund = await requireFund(clubId, fundId);
  if (fund.closedAt) {
    throw new ClosedFundError(fundId);
  }

  const [row] = await db
    .insert(fundAllocations)
    .values({
      id: `alloc_${randomUUID()}`,
      fundId,
      amountCents: draft.amountCents,
      note: draft.note,
      recordedBy: authorId,
    })
    .returning();

  if (!row) {
    throw new Error('Insert returned no row');
  }

  const [author] = await db
    .select({name: user.name})
    .from(user)
    .where(eq(user.id, authorId))
    .limit(1);

  return toAllocation(row, clubId, author?.name ?? null);
}

/** Every request the club has filed, newest first. */
export async function listRequests(clubId: string): Promise<ExpenseRequest[]> {
  const rows = await db
    .select({request: expenseRequests, createdByName: user.name})
    .from(expenseRequests)
    .leftJoin(user, eq(expenseRequests.createdBy, user.id))
    .where(eq(expenseRequests.clubId, clubId))
    .orderBy(desc(expenseRequests.createdAt));

  return rows.map((row) => toRequest(row.request, row.createdByName));
}

export async function findRequest(
  clubId: string,
  requestId: string,
): Promise<ExpenseRequest | null> {
  const [row] = await db
    .select({request: expenseRequests, createdByName: user.name})
    .from(expenseRequests)
    .leftJoin(user, eq(expenseRequests.createdBy, user.id))
    .where(
      and(
        eq(expenseRequests.clubId, clubId),
        eq(expenseRequests.id, requestId),
      ),
    )
    .limit(1);

  return row ? toRequest(row.request, row.createdByName) : null;
}

/**
 * Files a request against one of the club's funds.
 *
 * `submittedAt` is stamped when a request is created already submitted, which
 * is the common path: a treasurer records what they sent rather than drafting
 * it here first.
 */
export async function createRequest(
  clubId: string,
  draft: ExpenseRequestDraft,
  authorId: string,
  status: ExpenseRequest['status'] = 'draft',
): Promise<ExpenseRequest> {
  const fund = await requireFund(clubId, draft.fundId);
  if (fund.closedAt) {
    throw new ClosedFundError(draft.fundId);
  }
  if (draft.eventId !== null) {
    await requireEventInClub(clubId, draft.eventId);
  }

  const [row] = await db
    .insert(expenseRequests)
    .values({
      id: `req_${randomUUID()}`,
      clubId,
      fundId: draft.fundId,
      title: draft.title,
      justification: draft.justification,
      category: draft.category,
      status,
      requestedAmountCents: draft.requestedAmountCents,
      neededBy: draft.neededBy,
      eventId: draft.eventId,
      submittedAt: status === 'draft' ? null : new Date(),
      createdBy: authorId,
    })
    .returning();

  if (!row) {
    throw new Error('Insert returned no row');
  }

  const [author] = await db
    .select({name: user.name})
    .from(user)
    .where(eq(user.id, authorId))
    .limit(1);

  return toRequest(row, author?.name ?? null);
}

/**
 * Applies a partial update, including status transitions.
 *
 * Two things happen implicitly, both because they are facts about the record
 * rather than choices a caller should have to remember:
 *
 * - moving out of `draft` stamps `submittedAt`, once, and never re-stamps it,
 *   so "how long has this been waiting" stays answerable after a later edit
 * - moving a request to another fund re-checks that the new fund is this
 *   club's, which is the cross-club invariant this module exists to hold
 */
export async function updateRequest(
  clubId: string,
  requestId: string,
  patch: ExpenseRequestPatch,
): Promise<ExpenseRequest | null> {
  const existing = await findRequest(clubId, requestId);
  if (!existing) {
    return null;
  }

  if (patch.fundId !== undefined && patch.fundId !== existing.fundId) {
    const fund = await requireFund(clubId, patch.fundId);
    if (fund.closedAt) {
      throw new ClosedFundError(patch.fundId);
    }
  }
  if (patch.eventId !== undefined && patch.eventId !== null) {
    await requireEventInClub(clubId, patch.eventId);
  }

  const changes: Partial<typeof expenseRequests.$inferInsert> = {};
  if (patch.fundId !== undefined) changes.fundId = patch.fundId;
  if (patch.title !== undefined) changes.title = patch.title;
  if (patch.justification !== undefined) {
    changes.justification = patch.justification;
  }
  if (patch.category !== undefined) changes.category = patch.category;
  if (patch.status !== undefined) changes.status = patch.status;
  if (patch.requestedAmountCents !== undefined) {
    changes.requestedAmountCents = patch.requestedAmountCents;
  }
  if (patch.actualAmountCents !== undefined) {
    changes.actualAmountCents = patch.actualAmountCents;
  }
  if (patch.neededBy !== undefined) changes.neededBy = patch.neededBy;
  if (patch.eventId !== undefined) changes.eventId = patch.eventId;
  if (patch.decisionNote !== undefined) {
    changes.decisionNote = patch.decisionNote;
  }

  // Stamped on the first move out of draft and never overwritten. Re-stamping
  // on a later edit would quietly reset the age of a request that has been
  // sitting with the university for a month, which is the number a staleness
  // warning is computed from.
  if (
    patch.status !== undefined &&
    patch.status !== 'draft' &&
    existing.submittedAt === null
  ) {
    changes.submittedAt = new Date();
  }

  if (Object.keys(changes).length === 0) {
    return existing;
  }

  const [row] = await db
    .update(expenseRequests)
    .set(changes)
    .where(
      and(
        eq(expenseRequests.clubId, clubId),
        eq(expenseRequests.id, requestId),
      ),
    )
    .returning();

  if (!row) {
    return null;
  }

  const [author] = row.createdBy
    ? await db
        .select({name: user.name})
        .from(user)
        .where(eq(user.id, row.createdBy))
        .limit(1)
    : [];

  return toRequest(row, author?.name ?? null);
}

/** Raised when a delete targets a request the club actually asked for. */
export class RequestNotDraftError extends Error {
  constructor(readonly status: ExpenseRequest['status']) {
    super('Only a draft can be deleted; cancel the request instead');
    this.name = 'RequestNotDraftError';
  }
}

/**
 * Deletes a request that was never submitted.
 *
 * Drafts only, and the restriction is the point. Anything the club actually
 * asked for is cancelled instead, so that "we asked and withdrew" stays
 * distinguishable from "we never asked" - a distinction an audit cares about
 * and that a delete would destroy silently.
 */
export async function deleteRequest(
  clubId: string,
  requestId: string,
): Promise<boolean> {
  const existing = await findRequest(clubId, requestId);
  if (!existing) {
    return false;
  }
  if (existing.status !== 'draft') {
    throw new RequestNotDraftError(existing.status);
  }

  const removed = await db
    .delete(expenseRequests)
    .where(
      and(
        eq(expenseRequests.clubId, clubId),
        eq(expenseRequests.id, requestId),
      ),
    )
    .returning({id: expenseRequests.id});

  return removed.length > 0;
}

