/**
 * The club treasury.
 *
 * The model here is deliberately not a checkbook, and that is the single most
 * important thing to understand before changing anything in this file.
 *
 * A student club under a university funding scheme has **no custody of money**.
 * It is granted an allocation, it asks for things, and a university
 * administrator outside the system does the actual buying. There is no bank
 * account, no transaction the club initiates, and no statement to reconcile
 * against. What the club owns is a record of what it was given, what it has
 * asked for, and what it can prove arrived.
 *
 * See docs/TREASURY.md for the full design and the workflow it came from.
 *
 * ## Encumbrance, and why the balance is three numbers
 *
 * There is a real delay - often weeks - between submitting a request and the
 * purchase landing. During it, the money is neither available nor spent, and a
 * model with only "spent" has nowhere to put it.
 *
 * That gap is not an edge case; it is where the whole feature lives. A
 * treasurer looking at `spent: $400 of $1,500` will approve a $400 request,
 * because $400 is obviously affordable against $1,100 - and be wrong, because
 * two more requests are already sitting unfulfilled with the dean's office. The
 * club has now asked for $1,600 of a $1,500 fund and nobody finds out until an
 * administrator declines the third one, usually the week of the event.
 *
 * So every balance is `allocated`, `committed`, and `spent`, with
 * `available = allocated - committed - spent`. This is encumbrance accounting,
 * which is what university finance offices themselves do.
 *
 * **Never render a bare "remaining" figure from these types.** A treasurer who
 * sees `$1,100 remaining` without knowing $800 of it is already promised has
 * been actively misled by their own tool.
 *
 * ## No stored balances
 *
 * No type in this file has an editable balance field. `allocatedCents` is a
 * fold over `FundAllocation` entries, including the initial grant; a mid-year
 * cut is a new negative entry, never an edit. Spending is a fold over requests.
 * That is what makes an export credible to a department: the ledger shows what
 * was recorded, when, and by whom, including mistakes and their corrections. A
 * number that can be quietly edited proves nothing about anything, and a club
 * under scrutiny is exactly when that matters.
 */

import {z} from 'zod';

import {isoInstantSchema} from './club-event.js';

/**
 * A calendar date with no time and no zone, as `YYYY-MM-DD`.
 *
 * Funds run from a date to a date, not from an instant to an instant. "The
 * fund closes on May 15" is a fact about a calendar, and storing it as an
 * instant would make it land on a different day depending on where the reader
 * is - which for a use-it-or-lose-it deadline is a real problem, not a
 * cosmetic one.
 */
export const isoDateSchema = z.iso.date();

/**
 * Money is integer cents, everywhere, with no exceptions.
 *
 * Floating point cannot represent 0.1, so a ledger built on `number` dollars
 * drifts by fractions of a cent per operation and eventually fails to balance -
 * which is the one thing an auditable ledger may not do. Integer minor units
 * are the standard answer and they keep every sum exact.
 *
 * The name of every field carrying one ends in `Cents`, so a value in dollars
 * cannot be assigned to it without the mistake being visible at the call site.
 */
export const MAX_MONEY_CENTS = 100_000_000;

/**
 * A non-negative amount of money, in cents.
 *
 * Bounded because the realistic failure is a typo, not a large club. A
 * treasurer entering `150000` when they meant `1500` produces a fund that
 * silently absorbs every request for the rest of the year, and the bound turns
 * that into a refusal at the point of entry. $1,000,000 is far past what any
 * student club is allocated, so the limit only ever catches a mistake.
 */
export const moneyCentsSchema = z
  .number()
  .int('Amounts are whole cents')
  .nonnegative()
  .max(MAX_MONEY_CENTS);

/**
 * A signed amount, for allocation entries.
 *
 * Negative is meaningful here and only here: a dean's office reducing a grant
 * mid-year is an ordinary event, and the honest way to record it is a new entry
 * that subtracts, leaving the original grant visible in the history.
 */
export const signedMoneyCentsSchema = z
  .number()
  .int('Amounts are whole cents')
  .min(-MAX_MONEY_CENTS)
  .max(MAX_MONEY_CENTS);

/**
 * Renders cents as currency for display and export.
 *
 * Shared rather than reimplemented per surface, so the figure in the UI, the
 * figure in an export, and the figure the GroupMe bot posts cannot disagree
 * about rounding or grouping.
 *
 * Currency is a parameter with a USD default rather than a stored field. Every
 * club this is built for is funded in one currency by one institution, and a
 * per-amount currency implies conversion rules the product has no business
 * inventing. Adding a currency to `Fund` later is an additive migration.
 */
export function formatMoney(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(cents / 100);
}

/**
 * Where a club's money comes from.
 *
 * A fixed list for the same reason document sections are fixed: free text turns
 * into thirty spellings of "dues". `other` exists so that a source nobody
 * anticipated still has somewhere to live, because a fund that cannot be
 * classified is a fund that gets tracked in a spreadsheet instead.
 */
export const fundSourceSchema = z.enum([
  'university',
  'dues',
  'fundraising',
  'sponsorship',
  'department',
  'other',
]);

export type FundSource = z.infer<typeof fundSourceSchema>;

export const FUND_SOURCE_LABELS: Record<FundSource, string> = {
  university: 'University or dean’s fund',
  dues: 'Member dues',
  fundraising: 'Fundraising',
  sponsorship: 'Sponsorship',
  department: 'Department',
  other: 'Other',
};

/**
 * A fund as an officer sets it up.
 *
 * Note what is absent: an amount. A fund is an identity, a period, and a set of
 * rules; the money attached to it is a fold over its allocation entries. See
 * the module doc on why no balance is ever a stored field.
 *
 * The period lives on the fund itself, and there is deliberately **no semester
 * entity**. The founding use case is one $1,500 grant spanning two semesters;
 * dues run per semester, a sponsorship might run a calendar year, and a
 * conference travel grant is a one-off with a hard deadline. A global semester
 * calendar forces every fund into one shape and breaks on the first one that
 * does not fit. "What did we spend this fall" is a reporting view over dates,
 * not a storage concept.
 */
export const fundDraftSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(120),
    source: fundSourceSchema.default('university'),
    startsOn: isoDateSchema,
    endsOn: isoDateSchema,
    /**
     * What this money may not be spent on, in the funder's own words.
     *
     * Free text rather than structured flags. University restrictions are
     * idiosyncratic ("no alcohol, no gifts, no personal equipment, food only
     * with prior approval"), they differ per institution, and a checkbox model
     * would either fail to express a real rule or quietly drop the half it
     * cannot represent. The treasurer reads this before filing a request; the
     * product does not try to enforce it.
     */
    restrictions: z.string().trim().max(2000).default(''),
    /**
     * Whether unspent money is lost when the period ends.
     *
     * True for most university grants, and the reason the product warns about
     * an underspent fund: dean's offices cut next year's allocation for clubs
     * that do not use this year's, so unspent money has a cost beyond itself.
     */
    expiresUnspent: z.boolean().default(true),
  })
  .refine((fund) => fund.endsOn >= fund.startsOn, {
    // ISO dates compare correctly as strings, which is most of why the format
    // is pinned to `YYYY-MM-DD`.
    message: 'The fund cannot end before it starts',
    path: ['endsOn'],
  });

export type FundDraft = z.infer<typeof fundDraftSchema>;

/** A persisted fund. Carries no money; see `FundSummary` for that. */
export const fundSchema = z.object({
  id: z.string().min(1),
  clubId: z.string().min(1),
  name: z.string().min(1).max(120),
  source: fundSourceSchema,
  startsOn: isoDateSchema,
  endsOn: isoDateSchema,
  restrictions: z.string().max(2000),
  expiresUnspent: z.boolean(),
  /**
   * Closed funds are kept and stop accepting new requests. Never deleted: the
   * point of the ledger is that last year's spending is still answerable for.
   */
  closedAt: isoInstantSchema.nullable(),
  createdBy: z.string().min(1),
  createdAt: isoInstantSchema,
  updatedAt: isoInstantSchema,
});

export type Fund = z.infer<typeof fundSchema>;

/**
 * An edit to a fund's identity, period, or rules.
 *
 * Note that no amount appears here, and none ever will: money enters a fund
 * only as an allocation entry. If this schema ever grows an `allocatedCents`,
 * the append-only guarantee has been lost and the export stops being evidence
 * of anything.
 *
 * The start-before-end rule cannot be checked here, because a patch may carry
 * either date or neither. The API validates it against the merged record, which
 * is the only place both values are known.
 */
export const fundPatchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  source: fundSourceSchema.optional(),
  startsOn: isoDateSchema.optional(),
  endsOn: isoDateSchema.optional(),
  restrictions: z.string().trim().max(2000).optional(),
  expiresUnspent: z.boolean().optional(),
  /**
   * Closing stops new requests without hiding anything. Reopening is allowed -
   * a fund closed by mistake in the middle of a semester should not need a
   * database repair to undo.
   */
  closed: z.boolean().optional(),
});

export type FundPatch = z.infer<typeof fundPatchSchema>;

/**
 * One movement of money *into* a fund.
 *
 * The initial grant is an entry like any other, so there is exactly one rule
 * for how a fund's total is computed and no special case for the first one.
 * A mid-year cut is a negative entry; a top-up is another positive one. The
 * fund's total is never edited, which is what keeps the original grant visible
 * after it has been revised.
 */
export const fundAllocationSchema = z.object({
  id: z.string().min(1),
  fundId: z.string().min(1),
  clubId: z.string().min(1),
  amountCents: signedMoneyCentsSchema,
  /** Why this landed. "Initial grant", "reduced by dean's office", "top-up". */
  note: z.string().max(500),
  /** Display name of whoever recorded it. Not an identity claim. */
  recordedBy: z.string().min(1),
  recordedAt: isoInstantSchema,
});

export type FundAllocation = z.infer<typeof fundAllocationSchema>;

export const fundAllocationDraftSchema = z.object({
  amountCents: signedMoneyCentsSchema,
  note: z.string().trim().max(500).default(''),
});

export type FundAllocationDraft = z.infer<typeof fundAllocationDraftSchema>;

/**
 * What a request is for.
 *
 * Fixed, and chosen to match what university funding forms actually ask for,
 * because the category is what a department's audit groups by.
 */
export const expenseCategorySchema = z.enum([
  'food',
  'supplies',
  'printing',
  'travel',
  'equipment',
  'fees',
  'other',
]);

export type ExpenseCategory = z.infer<typeof expenseCategorySchema>;

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  food: 'Food',
  supplies: 'Supplies',
  printing: 'Printing',
  travel: 'Travel',
  equipment: 'Equipment',
  fees: 'Fees and dues',
  other: 'Other',
};

/**
 * Where a request has got to.
 *
 * Every transition is recorded by the treasurer, because the university
 * administrator is outside the system and always will be. COS sends nothing to
 * the dean's office and receives nothing back; it tracks what the club did,
 * holds the evidence, and does the arithmetic. A feature that required a
 * university finance office to adopt a student club's software is a feature
 * that would never ship.
 *
 * There is no internal-approval state. At the club this was designed from, the
 * decision to ask for something happened out loud in a meeting; modelling that
 * as an enforced step would invent ceremony nobody performs and leave a queue
 * of requests awaiting an approval that already happened.
 */
export const requestStatusSchema = z.enum([
  'draft',
  'submitted',
  'approved',
  'purchased',
  'settled',
  'denied',
  'cancelled',
]);

export type RequestStatus = z.infer<typeof requestStatusSchema>;

export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  approved: 'Approved',
  purchased: 'Purchased',
  settled: 'Settled',
  denied: 'Denied',
  cancelled: 'Cancelled',
};

/** How a status affects the balance. See `FUND_BALANCE_EFFECT`. */
export type BalanceEffect = 'none' | 'committed' | 'spent';

/**
 * The one place a status becomes money.
 *
 * Expressed as data rather than as branches spread across the fold, the API,
 * and the UI, for the same reason capabilities are a `STATEMENT` object: adding
 * a status makes this map a compile error until someone decides what it means
 * financially, instead of silently defaulting to "no effect" and quietly
 * dropping money out of the club's books.
 */
export const FUND_BALANCE_EFFECT = {
  /** Not asked for yet, so it encumbers nothing. */
  draft: 'none',
  /** Asked for. The money is spoken for from this moment, not from purchase. */
  submitted: 'committed',
  /** Agreed but not yet bought. Still spoken for. */
  approved: 'committed',
  /** Bought. Moves from spoken-for to gone. */
  purchased: 'spent',
  /** Bought, evidenced, and closed. */
  settled: 'spent',
  /** Refused. Releases the commitment. */
  denied: 'none',
  /** Withdrawn by the club. Releases the commitment. */
  cancelled: 'none',
} as const satisfies Record<RequestStatus, BalanceEffect>;

/**
 * Statuses that are still waiting on someone.
 *
 * What the "requests in flight" view lists, and what a staleness warning is
 * computed over. Derived from the effect map so it cannot drift from it.
 */
export function isRequestOpen(status: RequestStatus): boolean {
  return FUND_BALANCE_EFFECT[status] === 'committed';
}

/** A request as an officer fills it in. This is the university's form. */
export const expenseRequestDraftSchema = z.object({
  fundId: z.string().min(1, 'Choose which fund this comes from'),
  title: z.string().trim().min(1, 'Title is required').max(200),
  /**
   * The justification - the qualitative half of a university funding form, and
   * the part that takes a treasurer longest to write.
   *
   * One free-text field rather than a set of institution-specific questions.
   * Baylor's fields are not necessarily anyone else's, and per-university
   * templates are deferred until a second university exists to generalise from.
   */
  justification: z.string().trim().max(5000).default(''),
  category: expenseCategorySchema.default('other'),
  requestedAmountCents: moneyCentsSchema,
  /**
   * When the club needs it by. Administrators need lead time, and this is what
   * makes "submitted three weeks ago, event is Friday" visible.
   */
  neededBy: isoDateSchema.nullable().default(null),
  /**
   * The calendar event this is for, when there is one.
   *
   * The most product-specific field here. COS already owns the club's calendar,
   * so "$120, food, for the October 14 general meeting" is a real relationship
   * rather than a string someone typed - which makes an audit export explain
   * itself, and is the thing a spreadsheet structurally cannot do.
   */
  eventId: z.string().min(1).nullable().default(null),
});

export type ExpenseRequestDraft = z.infer<typeof expenseRequestDraftSchema>;

/**
 * A persisted request.
 *
 * `requestedAmountCents` and `actualAmountCents` are two fields on purpose. The
 * request says $50 for pizza and the administrator spends $47.83. Collapsing
 * them means either the books drift from reality or the original ask is
 * destroyed, and the original ask is what the club is held to.
 */
export const expenseRequestSchema = z.object({
  id: z.string().min(1),
  clubId: z.string().min(1),
  fundId: z.string().min(1),
  title: z.string().min(1).max(200),
  justification: z.string().max(5000),
  category: expenseCategorySchema,
  status: requestStatusSchema,
  requestedAmountCents: moneyCentsSchema,
  /**
   * What it actually cost, once a confirmation says so. Null until then.
   *
   * A purchased request whose actual amount is not yet known still counts as
   * spent at the amount requested - see `summarizeFund`. Treating an unknown
   * actual as zero would make money disappear from the club's books at the
   * exact moment it left the university's.
   */
  actualAmountCents: moneyCentsSchema.nullable(),
  neededBy: isoDateSchema.nullable(),
  eventId: z.string().min(1).nullable(),
  /** Why a request was denied, in the administrator's words. */
  decisionNote: z.string().max(2000),
  /** When the club sent it to the university. Null while it is a draft. */
  submittedAt: isoInstantSchema.nullable(),
  /** Display name of whoever filed it. Not an identity claim. */
  createdBy: z.string().min(1),
  createdAt: isoInstantSchema,
  updatedAt: isoInstantSchema,
});

export type ExpenseRequest = z.infer<typeof expenseRequestSchema>;

/**
 * An edit. Every field is optional, so a patch changes only what it names.
 *
 * Status moves through here too. There is no separate transition endpoint,
 * because every transition is the treasurer recording something that already
 * happened elsewhere, and a workflow API implying the product controls the
 * sequence would be describing a system that does not exist.
 */
export const expenseRequestPatchSchema = z.object({
  fundId: z.string().min(1).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  justification: z.string().trim().max(5000).optional(),
  category: expenseCategorySchema.optional(),
  status: requestStatusSchema.optional(),
  requestedAmountCents: moneyCentsSchema.optional(),
  actualAmountCents: moneyCentsSchema.nullable().optional(),
  neededBy: isoDateSchema.nullable().optional(),
  eventId: z.string().min(1).nullable().optional(),
  decisionNote: z.string().trim().max(2000).optional(),
});

export type ExpenseRequestPatch = z.infer<typeof expenseRequestPatchSchema>;

/**
 * The three numbers, and the one derived from them.
 *
 * `availableCents` may be **negative**, and that is not a bug to clamp away. A
 * club that has committed more than it holds needs to see exactly that, at the
 * moment it becomes true. Rendering it as zero would hide the only condition
 * this whole model exists to make visible.
 */
export interface FundSummary {
  /** Sum of every allocation entry, including reductions. */
  allocatedCents: number;
  /** Submitted or approved, not yet purchased. Spoken for. */
  committedCents: number;
  /** Purchased or settled, at the actual amount where one is known. */
  spentCents: number;
  /** `allocated - committed - spent`. May be negative. */
  availableCents: number;
}

/**
 * What a request counts for financially, in cents.
 *
 * Committed uses what was asked for, because that is what the university is
 * holding against the club. Spent prefers the confirmed actual and falls back
 * to the requested amount, so a purchase awaiting its confirmation email is
 * still on the books.
 */
function amountForBalance(request: ExpenseRequest): number {
  return FUND_BALANCE_EFFECT[request.status] === 'spent'
    ? (request.actualAmountCents ?? request.requestedAmountCents)
    : request.requestedAmountCents;
}

/**
 * Folds a fund's allocations and requests into the three numbers.
 *
 * Pure, and the heart of the feature. Takes `fundId` and filters rather than
 * trusting the caller to pass pre-filtered lists: handing it the club's full
 * set is then correct by construction, and there is no way to accidentally
 * total one fund's spending against another's grant. Getting that wrong would
 * produce a plausible, confident, wrong number, which is the worst thing a
 * money screen can do.
 */
export function summarizeFund(
  fundId: string,
  allocations: readonly FundAllocation[],
  requests: readonly ExpenseRequest[],
): FundSummary {
  let allocatedCents = 0;
  for (const allocation of allocations) {
    if (allocation.fundId === fundId) {
      allocatedCents += allocation.amountCents;
    }
  }

  let committedCents = 0;
  let spentCents = 0;
  for (const request of requests) {
    if (request.fundId !== fundId) {
      continue;
    }
    const effect = FUND_BALANCE_EFFECT[request.status];
    if (effect === 'committed') {
      committedCents += amountForBalance(request);
    } else if (effect === 'spent') {
      spentCents += amountForBalance(request);
    }
  }

  return {
    allocatedCents,
    committedCents,
    spentCents,
    availableCents: allocatedCents - committedCents - spentCents,
  };
}

/**
 * The club's position across every fund it holds.
 *
 * Worth one caveat at the call site: a single total is a weaker number than it
 * looks, because funds carry different restrictions and travel money cannot buy
 * pizza. It answers "how is the club doing overall" and must not be the figure
 * someone checks before filing a request - that one is always per fund.
 */
export function summarizeClub(
  funds: readonly Fund[],
  allocations: readonly FundAllocation[],
  requests: readonly ExpenseRequest[],
): FundSummary {
  const total: FundSummary = {
    allocatedCents: 0,
    committedCents: 0,
    spentCents: 0,
    availableCents: 0,
  };

  for (const fund of funds) {
    const summary = summarizeFund(fund.id, allocations, requests);
    total.allocatedCents += summary.allocatedCents;
    total.committedCents += summary.committedCents;
    total.spentCents += summary.spentCents;
    total.availableCents += summary.availableCents;
  }

  return total;
}
