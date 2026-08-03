/**
 * Tests for the React binding over the TreasuryRepository port.
 *
 * Drives the *real* `HttpTreasuryRepository` against a fake API and mocks only
 * `useSession`, for the same reason the other stores do: mocking the repository
 * would remove the part that actually breaks.
 *
 * What is specific to this store, and what these tests are mostly about:
 *
 * - **the summaries are folded here, not fetched.** The fake never computes a
 *   balance, exactly like the real API, so a wrong fold has nowhere to hide.
 * - **all three lists load together.** A render holding funds but not yet their
 *   requests would show every fund fully available, which is a *wrong* balance
 *   rather than a partial one - the worst failure mode a money screen has.
 * - **a write re-reads.** With no subscription, that is the whole freshness
 *   story, and a mistake is invisible until someone files a request and watches
 *   the available figure not move.
 */

import {act, cleanup, render, screen} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {ExpenseRequest, Fund, FundAllocation} from '@cos/core';

import {TreasuryStoreProvider, useTreasury} from './treasury-store';
import {FakeTreasuryApi} from './test-support/fake-treasury-api';

const CLUB = 'club_demo';

/** Swapped by tests to simulate an in-tab account switch. */
let viewer: {id: string} | null;

vi.mock('./session', () => ({
  useSession: () => ({user: viewer}),
}));

let api: FakeTreasuryApi;

beforeEach(() => {
  api = new FakeTreasuryApi();
  vi.stubGlobal('fetch', api.handle);
  viewer = {id: 'user_tess'};
});

afterEach(() => {
  // Not automatic: RTL only registers its own cleanup under `globals: true`,
  // which this project does not enable.
  cleanup();
  vi.unstubAllGlobals();
});

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function fund(overrides: Partial<Fund> = {}): Fund {
  return {
    id: 'fund_deans',
    clubId: CLUB,
    name: "Dean's Fund",
    source: 'university',
    startsOn: '2026-08-01',
    endsOn: '2027-05-15',
    restrictions: '',
    expiresUnspent: true,
    closedAt: null,
    createdBy: 'Tess Officer',
    createdAt: '2026-08-01T12:00:00.000Z',
    updatedAt: '2026-08-01T12:00:00.000Z',
    ...overrides,
  };
}

function allocation(overrides: Partial<FundAllocation> = {}): FundAllocation {
  return {
    id: `alloc_${Math.random()}`,
    fundId: 'fund_deans',
    clubId: CLUB,
    amountCents: 150_000,
    note: 'Initial grant',
    recordedBy: 'Tess Officer',
    recordedAt: '2026-08-01T12:00:00.000Z',
    ...overrides,
  };
}

function request(overrides: Partial<ExpenseRequest> = {}): ExpenseRequest {
  return {
    id: `req_${Math.random()}`,
    clubId: CLUB,
    fundId: 'fund_deans',
    title: 'Pizza',
    justification: '',
    category: 'food',
    status: 'submitted',
    requestedAmountCents: 40_000,
    actualAmountCents: null,
    neededBy: null,
    eventId: null,
    decisionNote: '',
    submittedAt: '2026-09-01T12:00:00.000Z',
    createdBy: 'Tess Officer',
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: '2026-09-01T12:00:00.000Z',
    ...overrides,
  };
}

/** Renders the store's numbers so assertions read like the screen. */
function Probe() {
  const {funds, requests, isLoading, error, total, summaryFor} = useTreasury();
  const deans = summaryFor('fund_deans');

  return (
    <div>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="error">{error ?? ''}</span>
      <span data-testid="fund-count">{funds.length}</span>
      <span data-testid="request-count">{requests.length}</span>
      <span data-testid="allocated">{deans.allocatedCents}</span>
      <span data-testid="committed">{deans.committedCents}</span>
      <span data-testid="spent">{deans.spentCents}</span>
      <span data-testid="available">{deans.availableCents}</span>
      <span data-testid="total-available">{total.availableCents}</span>
    </div>
  );
}

function mount() {
  return render(
    <TreasuryStoreProvider clubId={CLUB}>
      <Probe />
    </TreasuryStoreProvider>,
  );
}

function value(testId: string): string {
  return screen.getByTestId(testId).textContent ?? '';
}

describe('loading', () => {
  it('reads funds, allocations, and requests', async () => {
    api.addFund(CLUB, fund());
    api.addAllocation(CLUB, allocation());
    api.addRequest(CLUB, request());

    mount();
    await settle();

    expect(value('loading')).toBe('false');
    expect(value('fund-count')).toBe('1');
    expect(value('request-count')).toBe('1');
    expect(api.pathsTo('GET').sort()).toEqual([
      `/api/clubs/${CLUB}/allocations`,
      `/api/clubs/${CLUB}/funds`,
      `/api/clubs/${CLUB}/requests`,
    ]);
  });

  it('never shows a fund before the spending against it', async () => {
    // The failure this guards is not a flicker, it is a wrong number: funds
    // applied without their requests renders every fund fully available. So
    // nothing is applied until all three lists have arrived.
    api.addFund(CLUB, fund());
    api.addAllocation(CLUB, allocation());
    api.addRequest(CLUB, request({requestedAmountCents: 40_000}));

    mount();

    // Mid-flight: still loading, and no partially-applied state on screen.
    expect(value('loading')).toBe('true');
    expect(value('fund-count')).toBe('0');

    await settle();

    expect(value('fund-count')).toBe('1');
    expect(value('committed')).toBe('40000');
  });

  it('sends credentials, so the session cookie travels', async () => {
    mount();
    await settle();

    for (const call of api.callsTo('GET')) {
      expect(call.credentials).toBe('include');
    }
  });

  it('reports a failed load rather than rendering an empty treasury', async () => {
    // An empty treasury renders as "$0.00 available", which is a confident lie
    // when the truth is that the API is unreachable.
    api.failWith(500);

    mount();
    await settle();

    expect(value('loading')).toBe('false');
    expect(value('error')).not.toBe('');
  });

  it('re-reads when the viewer changes in-tab', async () => {
    api.addFund(CLUB, fund());
    mount();
    await settle();
    api.clearCalls();

    viewer = {id: 'user_someone_else'};
    await act(async () => {
      mount();
      await Promise.resolve();
    });
    await settle();

    expect(api.callsTo('GET').length).toBeGreaterThan(0);
  });
});

describe('the fold', () => {
  it('separates committed from spent', async () => {
    api.addFund(CLUB, fund());
    api.addAllocation(CLUB, allocation({amountCents: 150_000}));
    api.addRequest(CLUB, request({status: 'submitted', requestedAmountCents: 40_000}));
    api.addRequest(
      CLUB,
      request({
        status: 'purchased',
        requestedAmountCents: 50_000,
        actualAmountCents: 47_830,
      }),
    );

    mount();
    await settle();

    expect(value('allocated')).toBe('150000');
    expect(value('committed')).toBe('40000');
    expect(value('spent')).toBe('47830');
    expect(value('available')).toBe(String(150_000 - 40_000 - 47_830));
  });

  it('reports a negative available figure rather than clamping', async () => {
    api.addFund(CLUB, fund());
    api.addAllocation(CLUB, allocation({amountCents: 10_000}));
    api.addRequest(CLUB, request({requestedAmountCents: 25_000}));

    mount();
    await settle();

    expect(value('available')).toBe('-15000');
  });

  it('does not count another fund’s money', async () => {
    api.addFund(CLUB, fund());
    api.addFund(CLUB, fund({id: 'fund_dues', name: 'Dues'}));
    api.addAllocation(CLUB, allocation({amountCents: 150_000}));
    api.addAllocation(
      CLUB,
      allocation({fundId: 'fund_dues', amountCents: 80_000}),
    );
    api.addRequest(
      CLUB,
      request({fundId: 'fund_dues', requestedAmountCents: 70_000}),
    );

    mount();
    await settle();

    expect(value('allocated')).toBe('150000');
    expect(value('committed')).toBe('0');
    // The club-wide total does include both.
    expect(value('total-available')).toBe(String(150_000 + 80_000 - 70_000));
  });

  it('is zero for a fund the club does not have', async () => {
    mount();
    await settle();

    expect(value('allocated')).toBe('0');
    expect(value('available')).toBe('0');
  });
});

describe('writes re-read', () => {
  function Writer() {
    const {createRequest, allocate, summaryFor} = useTreasury();
    const deans = summaryFor('fund_deans');

    return (
      <div>
        <span data-testid="available">{deans.availableCents}</span>
        <button
          type="button"
          data-testid="file"
          onClick={() => {
            void createRequest(
              {
                fundId: 'fund_deans',
                title: 'Stickers',
                justification: '',
                category: 'supplies',
                requestedAmountCents: 30_000,
                neededBy: null,
                eventId: null,
              },
              'submitted',
            );
          }}
        />
        <button
          type="button"
          data-testid="allocate"
          onClick={() => {
            void allocate('fund_deans', {amountCents: 50_000, note: 'Top-up'});
          }}
        />
      </div>
    );
  }

  function mountWriter() {
    return render(
      <TreasuryStoreProvider clubId={CLUB}>
        <Writer />
      </TreasuryStoreProvider>,
    );
  }

  it('moves the available figure after filing a request', async () => {
    api.addFund(CLUB, fund());
    api.addAllocation(CLUB, allocation({amountCents: 150_000}));

    mountWriter();
    await settle();
    expect(screen.getByTestId('available').textContent).toBe('150000');

    await act(async () => {
      screen.getByTestId('file').click();
      await Promise.resolve();
    });
    await settle();

    // Committed immediately on filing, not on purchase. With no subscription,
    // this only happens because the write re-reads.
    expect(screen.getByTestId('available').textContent).toBe('120000');
  });

  it('moves it after recording an allocation', async () => {
    api.addFund(CLUB, fund());

    mountWriter();
    await settle();
    expect(screen.getByTestId('available').textContent).toBe('0');

    await act(async () => {
      screen.getByTestId('allocate').click();
      await Promise.resolve();
    });
    await settle();

    expect(screen.getByTestId('available').textContent).toBe('50000');
  });
});
