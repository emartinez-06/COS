/**
 * The treasury's tables.
 *
 * Three of them, and the shape follows one rule from docs/TREASURY.md: **no
 * balance is ever a stored column.** A fund's total is a fold over its
 * allocation entries and a club's spending is a fold over its requests, so
 * there is nowhere for a number to be edited into disagreement with the entries
 * that produced it. That is what makes an export evidence rather than an
 * assertion.
 *
 * - **`funds`** is identity, period, and rules. Deliberately carries no amount.
 * - **`fund_allocations`** is money entering a fund, append-only. The initial
 *   grant is an ordinary row, so there is no special case for the first one,
 *   and a mid-year reduction is a new negative row rather than an edit that
 *   would erase what the club was originally promised.
 * - **`expense_requests`** is money leaving, with the status that decides
 *   whether it is merely committed or actually spent.
 *
 * ## Why money is `integer`
 *
 * Every amount is whole cents, never a float: a ledger built on floating-point
 * dollars drifts and eventually fails to balance, which is the one thing an
 * auditable ledger may not do. `integer` holds ±2.1 billion cents (about $21
 * million) and @cos/core bounds a single amount at $1,000,000, so no individual
 * value can approach the limit. Postgres promotes `sum(integer)` to `bigint`
 * on its own, so totals cannot overflow either.
 */

import {relations} from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

import {user} from './auth.js';
import {clubs} from './club.js';
import {events} from './event.js';

/** Mirrors `fundSourceSchema` in @cos/core. */
export const fundSource = pgEnum('fund_source', [
  'university',
  'dues',
  'fundraising',
  'sponsorship',
  'department',
  'other',
]);

/** Mirrors `expenseCategorySchema` in @cos/core. */
export const expenseCategory = pgEnum('expense_category', [
  'food',
  'supplies',
  'printing',
  'travel',
  'equipment',
  'fees',
  'other',
]);

/**
 * Mirrors `requestStatusSchema` in @cos/core.
 *
 * The financial meaning of each value lives in `FUND_BALANCE_EFFECT` there, not
 * here. Adding a value to this enum without adding it there is a compile error
 * in core, which is the intended order of operations.
 */
export const requestStatus = pgEnum('request_status', [
  'draft',
  'submitted',
  'approved',
  'purchased',
  'settled',
  'denied',
  'cancelled',
]);

export const funds = pgTable(
  'funds',
  {
    id: text('id').primaryKey(),
    clubId: text('club_id')
      .notNull()
      .references(() => clubs.id, {onDelete: 'cascade'}),
    name: text('name').notNull(),
    source: fundSource('source').notNull().default('university'),
    /**
     * The period, as calendar dates rather than instants.
     *
     * `mode: 'string'` keeps these as `YYYY-MM-DD` end to end, matching
     * `isoDateSchema`. A fund closing "on May 15" is a fact about a calendar,
     * and storing it as a timestamp would move the deadline depending on where
     * the reader is - which for use-it-or-lose-it money is a real problem.
     *
     * There is deliberately no semester table. The founding case is one grant
     * spanning two semesters; dues run per semester and a travel grant is a
     * one-off. A global semester calendar breaks on the first fund that does
     * not fit, and "what did we spend this fall" is a query over dates.
     */
    startsOn: date('starts_on', {mode: 'string'}).notNull(),
    endsOn: date('ends_on', {mode: 'string'}).notNull(),
    /** The funder's restrictions in their own words. Not enforced by us. */
    restrictions: text('restrictions').notNull().default(''),
    /**
     * Whether unspent money is lost at the end of the period. True for most
     * university grants, and what the underspend warning keys off.
     */
    expiresUnspent: boolean('expires_unspent').notNull().default(true),
    /**
     * Closed funds stop accepting requests and are never deleted. Last year's
     * spending stays answerable for, which is the point of the ledger.
     */
    closedAt: timestamp('closed_at', {withTimezone: true}),
    createdBy: text('created_by').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', {withTimezone: true})
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true})
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Every read is scoped to one club, so `club_id` leads. Ordering by the
    // start date puts the current year's funds first, which is the order the
    // treasury page wants them in.
    index('funds_club_idx').on(table.clubId, table.startsOn),
  ],
);

/**
 * Money entering a fund. Append-only: never updated, never deleted.
 *
 * There is **no `club_id` here**, matching `document_revisions`. Tenancy is
 * enforced by reaching allocations only through their fund, which every code
 * path already looks up by `(club_id, id)`. Copying the club id down would
 * create a second place for it to be wrong, and a row whose club silently
 * disagreed with its fund's club is exactly the kind of corruption that
 * produces a confident wrong number on a money screen.
 *
 * `amount_cents` is signed on purpose. A dean's office cutting a grant mid-year
 * is ordinary, and recording it as a negative entry keeps the original grant
 * visible in a way an edit would not.
 */
export const fundAllocations = pgTable(
  'fund_allocations',
  {
    id: text('id').primaryKey(),
    fundId: text('fund_id')
      .notNull()
      .references(() => funds.id, {onDelete: 'cascade'}),
    amountCents: integer('amount_cents').notNull(),
    /** Why this landed. "Initial grant", "reduced by dean's office". */
    note: text('note').notNull().default(''),
    recordedBy: text('recorded_by').references(() => user.id, {
      onDelete: 'set null',
    }),
    recordedAt: timestamp('recorded_at', {withTimezone: true})
      .notNull()
      .defaultNow(),
  },
  (table) => [index('fund_allocations_fund_idx').on(table.fundId)],
);

/**
 * A request for money, and the record of what became of it.
 *
 * Carries `club_id` even though `fund_id` implies it, because this is a
 * top-level entity that every read scopes by club and that authorization
 * resolves against directly - the same pattern as `events` and `documents`,
 * and unlike `fund_allocations`, which is only ever reached through its parent.
 *
 * The consequence is an invariant the database cannot express: a request's fund
 * must belong to the same club as the request. `treasury-store.ts` enforces it
 * on every write, because filing a request against another club's fund would
 * both leak that the fund exists and corrupt two clubs' balances at once.
 */
export const expenseRequests = pgTable(
  'expense_requests',
  {
    id: text('id').primaryKey(),
    clubId: text('club_id')
      .notNull()
      .references(() => clubs.id, {onDelete: 'cascade'}),
    fundId: text('fund_id')
      .notNull()
      .references(() => funds.id, {onDelete: 'restrict'}),
    title: text('title').notNull(),
    /** The qualitative half of the university's form. */
    justification: text('justification').notNull().default(''),
    category: expenseCategory('category').notNull().default('other'),
    status: requestStatus('status').notNull().default('draft'),
    /**
     * What was asked for, and what it actually cost.
     *
     * Two columns on purpose. The request says $50 for pizza and the
     * administrator spends $47.83; collapsing them means either the books drift
     * from reality or the original ask is destroyed, and the original ask is
     * what the club is held to.
     */
    requestedAmountCents: integer('requested_amount_cents').notNull(),
    actualAmountCents: integer('actual_amount_cents'),
    neededBy: date('needed_by', {mode: 'string'}),
    /**
     * The calendar event this pays for, when there is one.
     *
     * `set null` rather than cascade, and the distinction matters more here
     * than anywhere else in the schema: deleting an event must never delete the
     * record that the club spent $120 of the dean's money. The spending is the
     * thing being audited; the event is context.
     */
    eventId: text('event_id').references(() => events.id, {
      onDelete: 'set null',
    }),
    /** Why it was refused, in the administrator's words. */
    decisionNote: text('decision_note').notNull().default(''),
    /** When the club sent it to the university. Null while it is a draft. */
    submittedAt: timestamp('submitted_at', {withTimezone: true}),
    createdBy: text('created_by').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', {withTimezone: true})
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true})
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // The listing: one club's requests, newest first.
    index('expense_requests_club_idx').on(table.clubId, table.createdAt),
    // The fold groups by fund, and this is also the FK's own index.
    index('expense_requests_fund_idx').on(table.fundId),
  ],
);

export const fundsRelations = relations(funds, ({one, many}) => ({
  club: one(clubs, {fields: [funds.clubId], references: [clubs.id]}),
  creator: one(user, {fields: [funds.createdBy], references: [user.id]}),
  allocations: many(fundAllocations),
  requests: many(expenseRequests),
}));

export const fundAllocationsRelations = relations(fundAllocations, ({one}) => ({
  fund: one(funds, {
    fields: [fundAllocations.fundId],
    references: [funds.id],
  }),
  recorder: one(user, {
    fields: [fundAllocations.recordedBy],
    references: [user.id],
  }),
}));

export const expenseRequestsRelations = relations(expenseRequests, ({one}) => ({
  club: one(clubs, {fields: [expenseRequests.clubId], references: [clubs.id]}),
  fund: one(funds, {
    fields: [expenseRequests.fundId],
    references: [funds.id],
  }),
  event: one(events, {
    fields: [expenseRequests.eventId],
    references: [events.id],
  }),
  creator: one(user, {
    fields: [expenseRequests.createdBy],
    references: [user.id],
  }),
}));
