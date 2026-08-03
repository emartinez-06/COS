'use client';

/**
 * React binding for the TreasuryRepository port.
 *
 * Same shape as the document store, and for the same reason: the port has no
 * `subscribe`, so the listing is read on mount and re-read after this browser's
 * own writes. Nothing polls.
 *
 * **The summaries are folded here, from @cos/core, and are not fetched.**
 * `summarizeFund` and `summarizeClub` run over the three lists the store
 * already holds. That is the whole point of keeping the arithmetic pure: the
 * server, this store, and any future export all fold the same rows with the
 * same function, so they cannot produce three different answers to "how much is
 * left". Anything that wanted a balance from the network would be re-deriving
 * it a second time.
 *
 * The three lists are loaded together because a summary needs all three and a
 * page that showed funds before their spending would render a balance that is
 * briefly, confidently wrong.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type {
  ExpenseRequest,
  ExpenseRequestDraft,
  ExpenseRequestPatch,
  Fund,
  FundAllocation,
  FundAllocationDraft,
  FundDraft,
  FundPatch,
  FundSummary,
  RequestStatus,
  TreasuryRepository,
} from '@cos/core';
import {summarizeClub, summarizeFund} from '@cos/core';

import {HttpTreasuryRepository} from './http-treasury-repository';
import {useSession} from './session';

interface TreasuryStore {
  funds: Fund[];
  allocations: FundAllocation[];
  requests: ExpenseRequest[];
  /** True until the first load completes. */
  isLoading: boolean;
  /** Set when the treasury could not be loaded at all. */
  error: string | null;
  clubId: string;
  /** The club's position across every fund. See `summarizeClub` on its caveat. */
  total: FundSummary;
  /** The three numbers for one fund. */
  summaryFor: (fundId: string) => FundSummary;
  refresh: () => Promise<void>;
  createFund: (draft: FundDraft) => Promise<Fund>;
  updateFund: (fundId: string, patch: FundPatch) => Promise<Fund>;
  allocate: (
    fundId: string,
    draft: FundAllocationDraft,
  ) => Promise<FundAllocation>;
  createRequest: (
    draft: ExpenseRequestDraft,
    status?: RequestStatus,
  ) => Promise<ExpenseRequest>;
  updateRequest: (
    requestId: string,
    patch: ExpenseRequestPatch,
  ) => Promise<ExpenseRequest>;
  removeRequest: (requestId: string) => Promise<void>;
}

const TreasuryStoreContext = createContext<TreasuryStore | null>(null);

const EMPTY_SUMMARY: FundSummary = {
  allocatedCents: 0,
  committedCents: 0,
  spentCents: 0,
  availableCents: 0,
};

interface TreasuryStoreProviderProps {
  children: React.ReactNode;
  clubId: string;
}

export function TreasuryStoreProvider({
  children,
  clubId,
}: TreasuryStoreProviderProps) {
  const [repository] = useState<TreasuryRepository>(
    () => new HttpTreasuryRepository(),
  );

  // Keyed on the viewer for the same reason the document store is: signing out
  // and back in as someone else does not unmount this provider, and nobody
  // should inherit the previous person's club treasury.
  const {user} = useSession();
  const viewerId = user?.id ?? null;

  const [funds, setFunds] = useState<Fund[]>([]);
  const [allocations, setAllocations] = useState<FundAllocation[]>([]);
  const [requests, setRequests] = useState<ExpenseRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * Reads all three lists.
   *
   * In parallel and applied together: a render that had funds but not yet their
   * requests would show every fund fully available, which is a wrong balance
   * rather than an incomplete one.
   */
  const read = useCallback(async () => {
    const [nextFunds, nextAllocations, nextRequests] = await Promise.all([
      repository.listFunds(clubId),
      repository.listAllocations(clubId),
      repository.listRequests(clubId),
    ]);
    setFunds(nextFunds);
    setAllocations(nextAllocations);
    setRequests(nextRequests);
  }, [repository, clubId]);

  /**
   * Re-reads after a write.
   *
   * Does not raise the loading flag: flashing the whole treasury back to a
   * skeleton because someone recorded one request would be worse than the
   * half-second of slightly stale rows it replaces.
   */
  const load = useCallback(async () => {
    try {
      await read();
      setError(null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not load this club’s treasury.',
      );
    }
  }, [read]);

  useEffect(() => {
    let isActive = true;

    setIsLoading(true);
    setError(null);
    setFunds([]);
    setAllocations([]);
    setRequests([]);

    void read()
      .then(() => {
        if (isActive) {
          setIsLoading(false);
        }
      })
      .catch((cause: unknown) => {
        if (isActive) {
          setError(
            cause instanceof Error
              ? cause.message
              : 'Could not load this club’s treasury.',
          );
          setIsLoading(false);
        }
      });

    return () => {
      isActive = false;
    };
  }, [read, viewerId]);

  const createFund = useCallback(
    async (draft: FundDraft) => {
      const created = await repository.createFund(clubId, draft);
      await load();
      return created;
    },
    [repository, clubId, load],
  );

  const updateFund = useCallback(
    async (fundId: string, patch: FundPatch) => {
      const updated = await repository.updateFund(clubId, fundId, patch);
      await load();
      return updated;
    },
    [repository, clubId, load],
  );

  const allocate = useCallback(
    async (fundId: string, draft: FundAllocationDraft) => {
      const entry = await repository.allocate(clubId, fundId, draft);
      await load();
      return entry;
    },
    [repository, clubId, load],
  );

  const createRequest = useCallback(
    async (draft: ExpenseRequestDraft, status?: RequestStatus) => {
      const created = await repository.createRequest(clubId, draft, status);
      await load();
      return created;
    },
    [repository, clubId, load],
  );

  const updateRequest = useCallback(
    async (requestId: string, patch: ExpenseRequestPatch) => {
      const updated = await repository.updateRequest(clubId, requestId, patch);
      await load();
      return updated;
    },
    [repository, clubId, load],
  );

  const removeRequest = useCallback(
    async (requestId: string) => {
      await repository.removeRequest(clubId, requestId);
      await load();
    },
    [repository, clubId, load],
  );

  /**
   * Every fund's summary, folded once per load rather than once per render of
   * every card. Keyed by fund id.
   */
  const summaries = useMemo(() => {
    const byFund = new Map<string, FundSummary>();
    for (const fund of funds) {
      byFund.set(fund.id, summarizeFund(fund.id, allocations, requests));
    }
    return byFund;
  }, [funds, allocations, requests]);

  const total = useMemo(
    () => summarizeClub(funds, allocations, requests),
    [funds, allocations, requests],
  );

  const summaryFor = useCallback(
    (fundId: string) => summaries.get(fundId) ?? EMPTY_SUMMARY,
    [summaries],
  );

  const value = useMemo<TreasuryStore>(
    () => ({
      funds,
      allocations,
      requests,
      isLoading,
      error,
      clubId,
      total,
      summaryFor,
      refresh: load,
      createFund,
      updateFund,
      allocate,
      createRequest,
      updateRequest,
      removeRequest,
    }),
    [
      funds,
      allocations,
      requests,
      isLoading,
      error,
      clubId,
      total,
      summaryFor,
      load,
      createFund,
      updateFund,
      allocate,
      createRequest,
      updateRequest,
      removeRequest,
    ],
  );

  return (
    <TreasuryStoreContext.Provider value={value}>
      {children}
    </TreasuryStoreContext.Provider>
  );
}

export function useTreasury(): TreasuryStore {
  const store = useContext(TreasuryStoreContext);
  if (!store) {
    throw new Error('useTreasury must be used within a TreasuryStoreProvider');
  }
  return store;
}
