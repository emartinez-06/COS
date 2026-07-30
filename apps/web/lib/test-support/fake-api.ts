/**
 * A stand-in for services/api, installed over the global `fetch`.
 *
 * Stubbing `fetch` rather than the `apiFetch` module is deliberate: it keeps
 * URL construction, `credentials: 'include'`, and the 204-has-no-body handling
 * inside the system under test. Mocking one layer higher would test the mock.
 *
 * It models the club's event list as real state, so a test can say "another
 * officer added an event" and let the next poll discover it, which is the
 * behaviour the repository actually exists to provide.
 */

import type {ClubEvent, EventDraft} from '@cos/core';

import {API_URL} from '../auth-client';

export interface RecordedCall {
  method: string;
  /** Path only; the origin is asserted separately and is noise otherwise. */
  path: string;
  body: unknown;
  credentials: RequestCredentials | undefined;
}

/** A queued or standing failure. `'network'` is a rejected fetch, not a status. */
type Failure = {status: number; body?: string} | 'network';

export class FakeApi {
  readonly calls: RecordedCall[] = [];

  readonly #eventsByClub = new Map<string, ClubEvent[]>();
  /** Consumed one per request, in order. */
  readonly #queuedFailures: Failure[] = [];
  /** Applies to every request until `recover()`. */
  #standingFailure: Failure | null = null;
  /** Gates that hold a request open so overlap can be tested. */
  readonly #gates: Array<Promise<void>> = [];
  #nextId = 1;

  // --- arranging ----------------------------------------------------------

  /** Seeds a club's events without recording a call. */
  setEvents(clubId: string, events: ClubEvent[]): void {
    this.#eventsByClub.set(clubId, [...events]);
  }

  /**
   * A change this browser did not make: another officer, or the GroupMe bot.
   * The repository is supposed to discover it on the next poll.
   */
  someoneElseAdds(clubId: string, event: ClubEvent): void {
    this.#eventsByClub.set(clubId, [...this.eventsOf(clubId), event]);
  }

  someoneElseRemoves(clubId: string, eventId: string): void {
    this.#eventsByClub.set(
      clubId,
      this.eventsOf(clubId).filter((event) => event.id !== eventId),
    );
  }

  eventsOf(clubId: string): ClubEvent[] {
    return this.#eventsByClub.get(clubId) ?? [];
  }

  /** The next request fails with this status; later ones succeed. */
  failNext(status: number, body?: string): void {
    this.#queuedFailures.push({status, body});
  }

  /** The next request rejects, as a dropped connection does. */
  failNextWithNetworkError(): void {
    this.#queuedFailures.push('network');
  }

  /** Every request fails until `recover()`. */
  failEveryRequest(status: number): void {
    this.#standingFailure = {status};
  }

  recover(): void {
    this.#standingFailure = null;
    this.#queuedFailures.length = 0;
  }

  /**
   * Holds the next request open. Returns the release. The call is recorded
   * before it blocks, so a test can assert one request is in flight.
   */
  holdNextRequest(): () => void {
    let release!: () => void;
    this.#gates.push(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    return release;
  }

  // --- asserting ----------------------------------------------------------

  callsTo(method: string): RecordedCall[] {
    return this.calls.filter((call) => call.method === method);
  }

  get getCount(): number {
    return this.callsTo('GET').length;
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
      body: parseBody(init.body),
      credentials: init.credentials,
    });

    const gate = this.#gates.shift();
    if (gate) {
      await gate;
    }

    const failure = this.#queuedFailures.shift() ?? this.#standingFailure;
    if (failure === 'network') {
      throw new TypeError('Failed to fetch');
    }
    if (failure) {
      return jsonResponse(
        {error: failure.body ?? `Request failed with ${failure.status}`},
        failure.status,
      );
    }

    return this.#route(method, url.pathname, parseBody(init.body));
  };

  /** The origin `apiFetch` prefixes onto every path. */
  get origin(): string {
    return API_URL;
  }

  #route(method: string, pathname: string, body: unknown): Response {
    // /api/clubs/:clubId/events[/:eventId]
    const match = /^\/api\/clubs\/([^/]+)\/events(?:\/([^/]+))?$/.exec(pathname);
    if (!match) {
      return jsonResponse({error: 'Not found'}, 404);
    }
    const clubId = decodeURIComponent(match[1]!);
    const eventId = match[2] ? decodeURIComponent(match[2]) : null;
    const events = this.eventsOf(clubId);

    if (method === 'GET' && !eventId) {
      return jsonResponse(events, 200);
    }

    if (method === 'POST' && !eventId) {
      const created = this.#persist(clubId, body as EventDraft);
      return jsonResponse(created, 201);
    }

    if (method === 'PATCH' && eventId) {
      const existing = events.find((event) => event.id === eventId);
      if (!existing) {
        return jsonResponse({error: 'Not found'}, 404);
      }
      const updated = {...existing, ...(body as object)} as ClubEvent;
      this.setEvents(
        clubId,
        sortByStart(events.map((e) => (e.id === eventId ? updated : e))),
      );
      return jsonResponse(updated, 200);
    }

    if (method === 'DELETE' && eventId) {
      this.setEvents(
        clubId,
        events.filter((event) => event.id !== eventId),
      );
      // 204 with no body at all: calling .json() on this throws, which is the
      // case `expectBody = false` exists for.
      return new Response(null, {status: 204});
    }

    return jsonResponse({error: 'Method not allowed'}, 405);
  }

  #persist(clubId: string, draft: EventDraft): ClubEvent {
    const created: ClubEvent = {
      ...makeEvent({id: `evt_server_${this.#nextId++}`, clubId}),
      ...draft,
      clubId,
      // Server-owned, and the reason `create` takes no author argument.
      createdBy: 'Avery Officer',
    };
    this.setEvents(clubId, sortByStart([...this.eventsOf(clubId), created]));
    return created;
  }
}

function sortByStart(events: ClubEvent[]): ClubEvent[] {
  return [...events].sort(
    (a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt),
  );
}

function parseBody(body: BodyInit | null | undefined): unknown {
  if (typeof body !== 'string') {
    return undefined;
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return body;
  }
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'Content-Type': 'application/json'},
  });
}

// --- fixtures -------------------------------------------------------------

let fixtureCounter = 0;

/** Fresh ids per test; call `resetEventFixtures()` in beforeEach. */
export function resetEventFixtures(): void {
  fixtureCounter = 0;
}

export function makeEvent(overrides: Partial<ClubEvent> = {}): ClubEvent {
  fixtureCounter += 1;
  return {
    id: `evt_${fixtureCounter}`,
    clubId: 'club_demo',
    title: `Event ${fixtureCounter}`,
    description: '',
    startsAt: '2026-08-14T23:00:00.000Z',
    endsAt: '2026-08-15T01:00:00.000Z',
    location: '',
    speaker: null,
    links: [],
    category: 'meeting',
    visibility: 'members',
    createdAt: '2026-07-30T12:00:00.000Z',
    updatedAt: '2026-07-30T12:00:00.000Z',
    createdBy: 'Avery Officer',
    ...overrides,
  };
}

export function makeDraft(overrides: Partial<EventDraft> = {}): EventDraft {
  return {
    title: 'Officer Sync',
    description: '',
    startsAt: '2026-09-01T23:00:00.000Z',
    endsAt: '2026-09-02T00:00:00.000Z',
    location: 'Rogers 109',
    speaker: null,
    links: [],
    category: 'meeting',
    visibility: 'members',
    ...overrides,
  };
}

// --- tab visibility -------------------------------------------------------

/**
 * jsdom's `document.visibilityState` is a read-only getter, so this redefines
 * it and fires the event the repository listens for.
 */
export function setTabVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}
