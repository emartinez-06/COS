/**
 * A stand-in for the treasury routes in services/api, installed over `fetch`.
 *
 * Its own fake rather than an addition to the event or document ones, matching
 * the precedent: each models one surface's state, and a single fake pretending
 * to be all three would be harder to read than any of them.
 *
 * Same principle, which is the important part: **`fetch` is replaced, never
 * `apiFetch`.** That keeps URL construction, `credentials: 'include'`, and the
 * 204-has-no-body path inside the system under test.
 *
 * The fake stores rows and never computes a balance, which mirrors the real API
 * exactly. If a test wants the three numbers it folds them with `summarizeFund`
 * from @cos/core - the same function the store uses - so a test cannot
 * accidentally verify the arithmetic against a second copy of the arithmetic.
 */

import type {ExpenseRequest, Fund, FundAllocation} from '@cos/core';

import {API_URL} from '../auth-client';

export interface RecordedCall {
  method: string;
  path: string;
  body: unknown;
  credentials: RequestCredentials | undefined;
}

export class FakeTreasuryApi {
  readonly calls: RecordedCall[] = [];

  readonly #funds = new Map<string, Fund[]>();
  readonly #allocations = new Map<string, FundAllocation[]>();
  readonly #requests = new Map<string, ExpenseRequest[]>();
  #nextId = 1;
  #status: number | null = null;

  // --- arranging ----------------------------------------------------------

  addFund(clubId: string, fund: Fund): Fund {
    this.#funds.set(clubId, [...this.fundsOf(clubId), fund]);
    return fund;
  }

  addAllocation(clubId: string, allocation: FundAllocation): FundAllocation {
    this.#allocations.set(clubId, [
      ...this.allocationsOf(clubId),
      allocation,
    ]);
    return allocation;
  }

  addRequest(clubId: string, request: ExpenseRequest): ExpenseRequest {
    this.#requests.set(clubId, [...this.requestsOf(clubId), request]);
    return request;
  }

  fundsOf(clubId: string): Fund[] {
    return this.#funds.get(clubId) ?? [];
  }

  allocationsOf(clubId: string): FundAllocation[] {
    return this.#allocations.get(clubId) ?? [];
  }

  requestsOf(clubId: string): ExpenseRequest[] {
    return this.#requests.get(clubId) ?? [];
  }

  /** Every request fails with this status until `recover()`. */
  failWith(status: number): void {
    this.#status = status;
  }

  recover(): void {
    this.#status = null;
  }

  callsTo(method: string): RecordedCall[] {
    return this.calls.filter((call) => call.method === method);
  }

  pathsTo(method: string): string[] {
    return this.callsTo(method).map((call) => call.path);
  }

  clearCalls(): void {
    this.calls.length = 0;
  }

  // --- the handler --------------------------------------------------------

  readonly handle = async (
    input: string | URL | Request,
    init: RequestInit = {},
  ): Promise<Response> => {
    const url = new URL(String(input));
    const method = (init.method ?? 'GET').toUpperCase();

    this.calls.push({
      method,
      path: url.pathname,
      body:
        typeof init.body === 'string'
          ? (JSON.parse(init.body) as unknown)
          : init.body,
      credentials: init.credentials,
    });

    if (this.#status !== null) {
      return json({error: `Request failed with ${this.#status}`}, this.#status);
    }

    return this.#route(method, url, init.body);
  };

  #route(
    method: string,
    url: URL,
    body: BodyInit | null | undefined,
  ): Response {
    const parsed =
      typeof body === 'string' ? (JSON.parse(body) as Record<string, unknown>) : {};

    const funds = /^\/api\/clubs\/([^/]+)\/funds(?:\/([^/]+))?(?:\/(allocations))?$/.exec(
      url.pathname,
    );
    if (funds) {
      const clubId = decodeURIComponent(funds[1]!);
      const fundId = funds[2] ? decodeURIComponent(funds[2]) : null;
      const sub = funds[3] ?? null;

      if (!fundId) {
        if (method === 'GET') return json(this.fundsOf(clubId), 200);
        if (method === 'POST') return json(this.#createFund(clubId, parsed), 201);
      } else if (sub === 'allocations' && method === 'POST') {
        return json(this.#allocate(clubId, fundId, parsed), 201);
      } else if (method === 'PATCH') {
        return json(this.#patchFund(clubId, fundId, parsed), 200);
      }
      return json({error: 'Method not allowed'}, 405);
    }

    if (/^\/api\/clubs\/([^/]+)\/allocations$/.test(url.pathname)) {
      const clubId = decodeURIComponent(
        /^\/api\/clubs\/([^/]+)\/allocations$/.exec(url.pathname)![1]!,
      );
      return json(this.allocationsOf(clubId), 200);
    }

    const requests = /^\/api\/clubs\/([^/]+)\/requests(?:\/([^/]+))?$/.exec(
      url.pathname,
    );
    if (requests) {
      const clubId = decodeURIComponent(requests[1]!);
      const requestId = requests[2] ? decodeURIComponent(requests[2]) : null;

      if (!requestId) {
        if (method === 'GET') return json(this.requestsOf(clubId), 200);
        if (method === 'POST') {
          return json(this.#createRequest(clubId, parsed), 201);
        }
      } else if (method === 'PATCH') {
        return json(this.#patchRequest(clubId, requestId, parsed), 200);
      } else if (method === 'DELETE') {
        this.#requests.set(
          clubId,
          this.requestsOf(clubId).filter((entry) => entry.id !== requestId),
        );
        return new Response(null, {status: 204});
      }
      return json({error: 'Method not allowed'}, 405);
    }

    return json({error: 'Not found'}, 404);
  }

  #createFund(clubId: string, body: Record<string, unknown>): Fund {
    const fund: Fund = {
      id: `fund_${this.#nextId++}`,
      clubId,
      name: String(body.name ?? 'Fund'),
      source: (body.source as Fund['source']) ?? 'university',
      startsOn: String(body.startsOn ?? '2026-08-01'),
      endsOn: String(body.endsOn ?? '2027-05-15'),
      restrictions: String(body.restrictions ?? ''),
      expiresUnspent: body.expiresUnspent !== false,
      closedAt: null,
      createdBy: 'Tess Officer',
      createdAt: '2026-08-01T12:00:00.000Z',
      updatedAt: '2026-08-01T12:00:00.000Z',
    };
    return this.addFund(clubId, fund);
  }

  #patchFund(
    clubId: string,
    fundId: string,
    body: Record<string, unknown>,
  ): Fund {
    const existing = this.fundsOf(clubId).find((entry) => entry.id === fundId)!;
    const updated: Fund = {
      ...existing,
      ...(body.name === undefined ? {} : {name: String(body.name)}),
      ...(body.closed === undefined
        ? {}
        : {closedAt: body.closed ? '2026-08-03T12:00:00.000Z' : null}),
    };
    this.#funds.set(
      clubId,
      this.fundsOf(clubId).map((entry) =>
        entry.id === fundId ? updated : entry,
      ),
    );
    return updated;
  }

  #allocate(
    clubId: string,
    fundId: string,
    body: Record<string, unknown>,
  ): FundAllocation {
    return this.addAllocation(clubId, {
      id: `alloc_${this.#nextId++}`,
      fundId,
      clubId,
      amountCents: Number(body.amountCents ?? 0),
      note: String(body.note ?? ''),
      recordedBy: 'Tess Officer',
      recordedAt: '2026-08-01T12:00:00.000Z',
    });
  }

  #createRequest(
    clubId: string,
    body: Record<string, unknown>,
  ): ExpenseRequest {
    const status = (body.status as ExpenseRequest['status']) ?? 'draft';
    return this.addRequest(clubId, {
      id: `req_${this.#nextId++}`,
      clubId,
      fundId: String(body.fundId ?? ''),
      title: String(body.title ?? ''),
      justification: String(body.justification ?? ''),
      category: (body.category as ExpenseRequest['category']) ?? 'other',
      status,
      requestedAmountCents: Number(body.requestedAmountCents ?? 0),
      actualAmountCents: null,
      neededBy: (body.neededBy as string | null) ?? null,
      eventId: (body.eventId as string | null) ?? null,
      decisionNote: '',
      submittedAt: status === 'draft' ? null : '2026-08-01T12:00:00.000Z',
      createdBy: 'Tess Officer',
      createdAt: '2026-08-01T12:00:00.000Z',
      updatedAt: '2026-08-01T12:00:00.000Z',
    });
  }

  #patchRequest(
    clubId: string,
    requestId: string,
    body: Record<string, unknown>,
  ): ExpenseRequest {
    const existing = this.requestsOf(clubId).find(
      (entry) => entry.id === requestId,
    )!;
    const updated: ExpenseRequest = {
      ...existing,
      ...(body.status === undefined
        ? {}
        : {status: body.status as ExpenseRequest['status']}),
      ...(body.actualAmountCents === undefined
        ? {}
        : {actualAmountCents: body.actualAmountCents as number | null}),
    };
    this.#requests.set(
      clubId,
      this.requestsOf(clubId).map((entry) =>
        entry.id === requestId ? updated : entry,
      ),
    );
    return updated;
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'Content-Type': 'application/json'},
  });
}

/** The origin the repository is expected to call, for asserting on paths. */
export const FAKE_API_ORIGIN = API_URL;
