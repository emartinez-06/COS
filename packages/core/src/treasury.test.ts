/**
 * Tests for the treasury's domain model.
 *
 * The weight is deliberately on `summarizeFund`, because it is the one piece of
 * arithmetic the product asks a treasurer to trust. Everything else on the
 * screen is recoverable by reading it; a wrong balance is confidently wrong and
 * gets acted on.
 *
 * The invariants worth the most here:
 *
 * - committed and spent are separate, and a submitted request encumbers money
 *   from the moment it is asked for rather than when it is bought
 * - an available figure may go negative, and is not clamped
 * - a purchase with no confirmed amount yet still counts, at the amount asked
 * - one fund's money never leaks into another's total
 */

import {describe, expect, it} from 'vitest';

import {
  FUND_BALANCE_EFFECT,
  MAX_MONEY_CENTS,
  expenseRequestDraftSchema,
  formatMoney,
  fundDraftSchema,
  fundPatchSchema,
  isRequestOpen,
  moneyCentsSchema,
  requestStatusSchema,
  signedMoneyCentsSchema,
  summarizeClub,
  summarizeFund,
} from './treasury.js';
import type {
  ExpenseRequest,
  Fund,
  FundAllocation,
  RequestStatus,
} from './treasury.js';

const fund: Fund = {
  id: 'fund_deans',
  clubId: 'club_1',
  name: "Dean's Fund 2026-27",
  source: 'university',
  startsOn: '2026-08-01',
  endsOn: '2027-05-15',
  restrictions: 'No alcohol. No gifts.',
  expiresUnspent: true,
  closedAt: null,
  createdBy: 'Avery Officer',
  createdAt: '2026-08-01T12:00:00.000Z',
  updatedAt: '2026-08-01T12:00:00.000Z',
};

function allocation(
  overrides: Partial<FundAllocation> & {amountCents: number},
): FundAllocation {
  return {
    id: `alloc_${Math.random()}`,
    fundId: fund.id,
    clubId: 'club_1',
    note: '',
    recordedBy: 'Avery Officer',
    recordedAt: '2026-08-01T12:00:00.000Z',
    ...overrides,
  };
}

function request(
  overrides: Partial<ExpenseRequest> & {requestedAmountCents: number},
): ExpenseRequest {
  return {
    id: `req_${Math.random()}`,
    clubId: 'club_1',
    fundId: fund.id,
    title: 'Pizza for the general meeting',
    justification: 'Food raises attendance at the recruiting meeting.',
    category: 'food',
    status: 'submitted',
    actualAmountCents: null,
    neededBy: null,
    eventId: null,
    decisionNote: '',
    submittedAt: '2026-09-01T12:00:00.000Z',
    createdBy: 'Avery Officer',
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: '2026-09-01T12:00:00.000Z',
    ...overrides,
  };
}

/** $1,500, the founding use case's dean's fund. */
const GRANT = allocation({amountCents: 150_000, note: 'Initial grant'});

describe('the three numbers', () => {
  it('counts a submitted request as committed, not spent', () => {
    const summary = summarizeFund(
      fund.id,
      [GRANT],
      [request({requestedAmountCents: 40_000, status: 'submitted'})],
    );

    expect(summary.committedCents).toBe(40_000);
    expect(summary.spentCents).toBe(0);
    expect(summary.availableCents).toBe(110_000);
  });

  it('keeps an approved request committed - agreed is not yet bought', () => {
    const summary = summarizeFund(
      fund.id,
      [GRANT],
      [request({requestedAmountCents: 40_000, status: 'approved'})],
    );

    expect(summary.committedCents).toBe(40_000);
    expect(summary.spentCents).toBe(0);
  });

  it('moves a purchased request from committed to spent', () => {
    const summary = summarizeFund(
      fund.id,
      [GRANT],
      [
        request({
          requestedAmountCents: 40_000,
          actualAmountCents: 38_745,
          status: 'purchased',
        }),
      ],
    );

    expect(summary.committedCents).toBe(0);
    expect(summary.spentCents).toBe(38_745);
    expect(summary.availableCents).toBe(150_000 - 38_745);
  });

  it('spends the actual amount, not the amount asked for', () => {
    // The request said $50 for pizza; the administrator spent $47.83. The club
    // is out $47.83 and its books have to say so.
    const summary = summarizeFund(
      fund.id,
      [GRANT],
      [
        request({
          requestedAmountCents: 5_000,
          actualAmountCents: 4_783,
          status: 'settled',
        }),
      ],
    );

    expect(summary.spentCents).toBe(4_783);
  });

  it('still counts a purchase whose actual amount is not known yet', () => {
    // The regression this guards: treating a null actual as zero makes the
    // money vanish from the club's books at the exact moment it left the
    // university's, and the fund looks richer than it is until the
    // confirmation email arrives.
    const summary = summarizeFund(
      fund.id,
      [GRANT],
      [
        request({
          requestedAmountCents: 40_000,
          actualAmountCents: null,
          status: 'purchased',
        }),
      ],
    );

    expect(summary.spentCents).toBe(40_000);
    expect(summary.availableCents).toBe(110_000);
  });

  it('encumbers the authorized amount even when the price is known early', () => {
    // Found by mutation: nothing pinned which amount a *committed* request
    // uses, so switching it to the actual survived the suite.
    //
    // The authorized figure is the right one, and this is the standard
    // encumbrance rule rather than a preference - a purchase order encumbers
    // the PO amount, and that is only relieved and replaced by the true cost
    // when the invoice is paid. It is also the conservative direction: a
    // treasurer who hears "it'll be a bit cheaper" should not see the fund
    // free up money the university has not released.
    const summary = summarizeFund(
      fund.id,
      [GRANT],
      [
        request({
          requestedAmountCents: 5_000,
          actualAmountCents: 4_783,
          status: 'approved',
        }),
      ],
    );

    expect(summary.committedCents).toBe(5_000);
    expect(summary.spentCents).toBe(0);
  });

  it('ignores a draft, which has not been asked for', () => {
    const summary = summarizeFund(
      fund.id,
      [GRANT],
      [request({requestedAmountCents: 40_000, status: 'draft'})],
    );

    expect(summary.committedCents).toBe(0);
    expect(summary.spentCents).toBe(0);
    expect(summary.availableCents).toBe(150_000);
  });

  it.each(['denied', 'cancelled'] as const)(
    'releases the commitment when a request is %s',
    (status) => {
      const summary = summarizeFund(
        fund.id,
        [GRANT],
        [request({requestedAmountCents: 40_000, status})],
      );

      expect(summary.committedCents).toBe(0);
      expect(summary.spentCents).toBe(0);
      expect(summary.availableCents).toBe(150_000);
    },
  );
});

describe('the overspending case this model exists for', () => {
  it('shows three in-flight requests eating the fund before any is bought', () => {
    // The spreadsheet failure: each request is individually affordable against
    // a "spent" figure of zero, and together they exceed the grant. A treasurer
    // reading only "spent" approves all three and finds out in December.
    const summary = summarizeFund(
      fund.id,
      [GRANT],
      [
        request({requestedAmountCents: 40_000, status: 'submitted'}),
        request({requestedAmountCents: 40_000, status: 'submitted'}),
        request({requestedAmountCents: 40_000, status: 'approved'}),
      ],
    );

    expect(summary.spentCents).toBe(0);
    expect(summary.committedCents).toBe(120_000);
    expect(summary.availableCents).toBe(30_000);
  });

  it('reports a negative available figure rather than clamping it to zero', () => {
    // Clamping would hide the only condition the whole model exists to make
    // visible. An over-committed club needs to see it the moment it is true.
    const summary = summarizeFund(
      fund.id,
      [GRANT],
      [
        request({requestedAmountCents: 100_000, status: 'submitted'}),
        request({requestedAmountCents: 100_000, status: 'approved'}),
      ],
    );

    expect(summary.availableCents).toBe(-50_000);
  });
});

describe('allocations', () => {
  it('sums every entry, so the grant is not a special case', () => {
    const summary = summarizeFund(
      fund.id,
      [GRANT, allocation({amountCents: 25_000, note: 'Top-up'})],
      [],
    );

    expect(summary.allocatedCents).toBe(175_000);
  });

  it('subtracts a reduction recorded as a negative entry', () => {
    // A dean's office cutting a grant mid-year is ordinary. Recording it as a
    // new entry keeps the original $1,500 visible, which an edit would destroy.
    const summary = summarizeFund(
      fund.id,
      [GRANT, allocation({amountCents: -50_000, note: 'Reduced by dean'})],
      [],
    );

    expect(summary.allocatedCents).toBe(100_000);
    expect(summary.availableCents).toBe(100_000);
  });

  it('reports zero for a fund with no allocation yet', () => {
    expect(summarizeFund(fund.id, [], [])).toEqual({
      allocatedCents: 0,
      committedCents: 0,
      spentCents: 0,
      availableCents: 0,
    });
  });
});

describe('fund isolation', () => {
  it('never counts another fund’s allocations or requests', () => {
    // Passing the club's full lists has to be correct by construction, because
    // totalling one fund's spending against another's grant produces a
    // plausible, confident, wrong number - the worst thing a money screen does.
    const summary = summarizeFund(
      fund.id,
      [GRANT, allocation({fundId: 'fund_dues', amountCents: 80_000})],
      [
        request({requestedAmountCents: 10_000, status: 'submitted'}),
        request({
          fundId: 'fund_dues',
          requestedAmountCents: 70_000,
          status: 'settled',
        }),
      ],
    );

    expect(summary.allocatedCents).toBe(150_000);
    expect(summary.committedCents).toBe(10_000);
    expect(summary.spentCents).toBe(0);
  });

  it('totals across funds for the club view', () => {
    const dues: Fund = {...fund, id: 'fund_dues', name: 'Fall dues'};
    const summary = summarizeClub(
      [fund, dues],
      [GRANT, allocation({fundId: 'fund_dues', amountCents: 80_000})],
      [
        request({requestedAmountCents: 10_000, status: 'submitted'}),
        request({
          fundId: 'fund_dues',
          requestedAmountCents: 70_000,
          actualAmountCents: 69_000,
          status: 'settled',
        }),
      ],
    );

    expect(summary.allocatedCents).toBe(230_000);
    expect(summary.committedCents).toBe(10_000);
    expect(summary.spentCents).toBe(69_000);
    expect(summary.availableCents).toBe(151_000);
  });

  it('leaves a fund the club view does not list out of the total', () => {
    // summarizeClub folds over the funds it is given, so a fund omitted from
    // that list contributes nothing - including its spending.
    const summary = summarizeClub(
      [fund],
      [GRANT, allocation({fundId: 'fund_dues', amountCents: 80_000})],
      [],
    );

    expect(summary.allocatedCents).toBe(150_000);
  });
});

describe('the status-to-money map', () => {
  it('assigns an effect to every status', () => {
    // The map is `satisfies Record<RequestStatus, BalanceEffect>`, so this
    // cannot fail at runtime without failing to compile first. It is here so
    // that adding a status is a conscious financial decision rather than a
    // silent default to "no effect", which would drop money out of the books.
    for (const status of requestStatusSchema.options) {
      expect(FUND_BALANCE_EFFECT[status]).toBeDefined();
    }
  });

  it('treats exactly the in-flight statuses as open', () => {
    const open = requestStatusSchema.options.filter((status: RequestStatus) =>
      isRequestOpen(status),
    );

    expect(open).toEqual(['submitted', 'approved']);
  });
});

describe('money', () => {
  it('refuses fractional cents', () => {
    expect(moneyCentsSchema.safeParse(1_50.5).success).toBe(false);
  });

  it('refuses a negative amount on a request', () => {
    expect(moneyCentsSchema.safeParse(-1).success).toBe(false);
  });

  it('allows a negative allocation, which is how a reduction is recorded', () => {
    expect(signedMoneyCentsSchema.safeParse(-50_000).success).toBe(true);
  });

  it('bounds an amount, so a missing decimal point is refused not stored', () => {
    // $1,500 typed as 150000 dollars rather than cents is the realistic error,
    // and an unbounded field would absorb every request for the rest of the year.
    expect(moneyCentsSchema.safeParse(MAX_MONEY_CENTS + 1).success).toBe(false);
  });

  it('formats cents as currency without floating-point drift', () => {
    expect(formatMoney(150_000)).toBe('$1,500.00');
    expect(formatMoney(4_783)).toBe('$47.83');
    expect(formatMoney(0)).toBe('$0.00');
  });

  it('formats a negative balance as negative rather than as a bare number', () => {
    expect(formatMoney(-50_000)).toBe('-$500.00');
  });
});

describe('the fund schema', () => {
  it('refuses a period that ends before it starts', () => {
    const result = fundDraftSchema.safeParse({
      name: "Dean's Fund",
      startsOn: '2027-05-15',
      endsOn: '2026-08-01',
    });

    expect(result.success).toBe(false);
  });

  it('accepts a period spanning two semesters, which is the founding case', () => {
    const result = fundDraftSchema.safeParse({
      name: "Dean's Fund 2026-27",
      startsOn: '2026-08-01',
      endsOn: '2027-05-15',
    });

    expect(result.success).toBe(true);
  });

  it('accepts a single-day fund', () => {
    const result = fundDraftSchema.safeParse({
      name: 'Conference grant',
      startsOn: '2026-10-01',
      endsOn: '2026-10-01',
    });

    expect(result.success).toBe(true);
  });

  it('has no way to set an amount, on either the draft or the patch', () => {
    // Money enters a fund only as an allocation entry. If either of these ever
    // carries an amount through, the append-only guarantee is gone and the
    // export stops being evidence of anything.
    const draft = fundDraftSchema.parse({
      name: "Dean's Fund",
      startsOn: '2026-08-01',
      endsOn: '2027-05-15',
      allocatedCents: 150_000,
    });
    const patch = fundPatchSchema.parse({allocatedCents: 150_000});

    expect(draft).not.toHaveProperty('allocatedCents');
    expect(patch).not.toHaveProperty('allocatedCents');
  });

  it('defaults a university fund to expiring unspent', () => {
    const parsed = fundDraftSchema.parse({
      name: "Dean's Fund",
      startsOn: '2026-08-01',
      endsOn: '2027-05-15',
    });

    expect(parsed.expiresUnspent).toBe(true);
    expect(parsed.source).toBe('university');
  });
});

describe('the request draft', () => {
  it('requires a fund, because money always comes from somewhere', () => {
    const result = expenseRequestDraftSchema.safeParse({
      title: 'Pizza',
      requestedAmountCents: 5_000,
    });

    expect(result.success).toBe(false);
  });

  it('keeps the justification optional but the amount and title required', () => {
    const parsed = expenseRequestDraftSchema.parse({
      fundId: 'fund_deans',
      title: 'Pizza for the general meeting',
      requestedAmountCents: 5_000,
    });

    expect(parsed.justification).toBe('');
    expect(parsed.category).toBe('other');
    expect(parsed.neededBy).toBeNull();
    expect(parsed.eventId).toBeNull();
  });

  it('carries a link to the calendar event the money is for', () => {
    const parsed = expenseRequestDraftSchema.parse({
      fundId: 'fund_deans',
      title: 'Pizza for the general meeting',
      requestedAmountCents: 5_000,
      eventId: 'evt_general_meeting',
      neededBy: '2026-10-14',
    });

    expect(parsed.eventId).toBe('evt_general_meeting');
    expect(parsed.neededBy).toBe('2026-10-14');
  });
});
