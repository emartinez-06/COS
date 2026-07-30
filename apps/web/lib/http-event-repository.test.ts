/**
 * Tests for the HTTP EventRepository, weighted heavily toward the subscription
 * lifecycle.
 *
 * That weighting is not arbitrary. Three defects shipped into a browser session
 * before being caught by hand, and all three lived here: teardown that deleted
 * by key instead of by identity, a 401 that halted a subscription permanently,
 * and a subscription that outlived the viewer it was built for. The third is in
 * `event-store.tsx`; the first two are below, named after what they broke.
 *
 * Every test drives real timers through vitest's fake clock and a fake API
 * installed over the global `fetch`, so URL construction, credential handling,
 * and the 204-with-no-body path stay inside the system under test.
 */

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {ClubEvent} from '@cos/core';

import {ApiError, HttpEventRepository} from './http-event-repository';
import {
  FakeApi,
  makeDraft,
  makeEvent,
  resetEventFixtures,
  setTabVisibility,
} from './test-support/fake-api';

const CLUB = 'club_demo';
const POLL_MS = 15_000;

let api: FakeApi;
let repository: HttpEventRepository;
/** Every subscription opened by a test, torn down in afterEach. */
let openSubscriptions: Array<() => void>;

/** Subscribes and registers the teardown, so no test leaks a live timer. */
function subscribe(
  clubId: string,
  listener: (events: ClubEvent[]) => void,
): () => void {
  const unsubscribe = repository.subscribe(clubId, listener);
  openSubscriptions.push(unsubscribe);
  return unsubscribe;
}

/** Advances the clock and lets the resulting fetches settle. */
async function tick(count = 1): Promise<void> {
  await vi.advanceTimersByTimeAsync(POLL_MS * count);
}

/** Settles promises that are not waiting on the clock. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers();
  resetEventFixtures();
  api = new FakeApi();
  vi.stubGlobal('fetch', api.handle);
  setTabVisibility('visible');
  repository = new HttpEventRepository(POLL_MS);
  openSubscriptions = [];
});

afterEach(() => {
  for (const unsubscribe of openSubscriptions) {
    unsubscribe();
  }
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('list', () => {
  it('GETs the club events path with the session cookie attached', async () => {
    const event = makeEvent({title: 'Weekly Chapter Meeting'});
    api.setEvents(CLUB, [event]);

    await expect(repository.list(CLUB)).resolves.toEqual([event]);

    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]).toMatchObject({
      method: 'GET',
      path: `/api/clubs/${CLUB}/events`,
      // Omitting this fails silently and confusingly: the request succeeds
      // without the cookie and comes back 401.
      credentials: 'include',
    });
  });

  it('encodes a club id rather than letting it change the path', async () => {
    api.setEvents('club/../admin', []);
    await repository.list('club/../admin');
    expect(api.calls[0]!.path).toBe('/api/clubs/club%2F..%2Fadmin/events');
  });

  it('throws an ApiError carrying the status and the API message', async () => {
    api.failNext(403, 'You do not have permission to view these events.');

    const thrown = await repository.list(CLUB).catch((error: unknown) => error);

    // The store renders this message in a Banner instead of the grid, so both
    // the type and the text are part of the contract.
    expect(thrown).toBeInstanceOf(ApiError);
    expect(thrown).toMatchObject({
      status: 403,
      message: 'You do not have permission to view these events.',
    });
  });

  it('falls back to the status text when the error body is not JSON', async () => {
    vi.stubGlobal('fetch', async () =>
      // A proxy or a crashed process answers with HTML, not the API's shape.
      new Response('<html>502</html>', {status: 502, statusText: 'Bad Gateway'}),
    );

    await expect(repository.list(CLUB)).rejects.toMatchObject({
      status: 502,
      message: 'Bad Gateway',
    });
  });
});

describe('subscribe', () => {
  it('delivers a change this browser did not make', async () => {
    // The whole reason subscribe is implemented rather than stubbed: this
    // writer could just as well be the GroupMe bot, which has no tab at all.
    api.setEvents(CLUB, [makeEvent()]);
    const listener = vi.fn();
    subscribe(CLUB, listener);
    await repository.list(CLUB);

    const fromAnotherOfficer = makeEvent({title: 'Fall Kickoff'});
    api.someoneElseAdds(CLUB, fromAnotherOfficer);
    await tick();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.lastCall![0]).toEqual([
      expect.objectContaining({title: 'Event 1'}),
      fromAnotherOfficer,
    ]);
  });

  it('stays quiet when nothing changed, so an idle calendar does not re-render', async () => {
    api.setEvents(CLUB, [makeEvent()]);
    const listener = vi.fn();
    subscribe(CLUB, listener);
    await repository.list(CLUB);

    await tick(4);

    expect(api.getCount).toBeGreaterThanOrEqual(4);
    expect(listener).not.toHaveBeenCalled();
  });

  it('does not re-emit the snapshot list() already returned', async () => {
    // `list` records the signature without emitting for exactly this reason.
    // Without it the first poll computes an identical snapshot, finds a null
    // signature, and re-renders the whole calendar for nothing.
    api.setEvents(CLUB, [makeEvent()]);
    const listener = vi.fn();
    subscribe(CLUB, listener);
    await repository.list(CLUB);

    await tick();

    expect(listener).not.toHaveBeenCalled();
  });

  it('shares one timer and one request across every subscriber of a club', async () => {
    api.setEvents(CLUB, [makeEvent()]);
    const officer = vi.fn();
    const contextPanel = vi.fn();
    subscribe(CLUB, officer);
    subscribe(CLUB, contextPanel);
    await repository.list(CLUB);
    api.clearCalls();

    api.someoneElseAdds(CLUB, makeEvent({title: 'Service Day'}));
    await tick();

    // Two listeners, one request. One timer per listener would multiply load
    // by however many components happen to be mounted.
    expect(api.getCount).toBe(1);
    expect(officer).toHaveBeenCalledTimes(1);
    expect(contextPanel).toHaveBeenCalledTimes(1);
  });

  it('keeps polling for the remaining subscribers when one leaves', async () => {
    const listener = vi.fn();
    const leaving = vi.fn();
    subscribe(CLUB, listener);
    const unsubscribeLeaving = subscribe(CLUB, leaving);

    unsubscribeLeaving();
    api.someoneElseAdds(CLUB, makeEvent());
    await tick();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(leaving).not.toHaveBeenCalled();
  });

  it('stops polling once the last subscriber leaves', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribe(CLUB, listener);
    await tick();
    const countWhileSubscribed = api.getCount;
    expect(countWhileSubscribed).toBeGreaterThan(0);

    unsubscribe();
    await tick(4);

    expect(api.getCount).toBe(countWhileSubscribed);
  });

  it('lets a listener unsubscribe while it is being notified', async () => {
    const survivor = vi.fn();
    let unsubscribeSelf!: () => void;
    const selfRemoving = vi.fn(() => {
      unsubscribeSelf();
    });
    unsubscribeSelf = subscribe(CLUB, selfRemoving);
    subscribe(CLUB, survivor);

    api.someoneElseAdds(CLUB, makeEvent());
    await tick();

    expect(selfRemoving).toHaveBeenCalledTimes(1);
    expect(survivor).toHaveBeenCalledTimes(1);
  });

  it('does not notify a listener that subscribed during the notification', async () => {
    // This is what copying the listener set actually buys. Removing from a Set
    // mid-iteration is safe in JS, but *adding* is not: the new entry is
    // visited in the same pass. So a listener that subscribes on notify would
    // be handed a snapshot it was not registered for, and one that
    // unsubscribes and resubscribes would iterate forever.
    const latecomer = vi.fn();
    const recruiter = vi.fn(() => {
      subscribe(CLUB, latecomer);
    });
    subscribe(CLUB, recruiter);

    api.someoneElseAdds(CLUB, makeEvent());
    await tick();

    expect(recruiter).toHaveBeenCalledTimes(1);
    expect(latecomer).not.toHaveBeenCalled();

    // It is subscribed, though, so the next real change reaches it.
    api.someoneElseAdds(CLUB, makeEvent());
    await tick();
    expect(latecomer).toHaveBeenCalledTimes(1);
  });

  it('polls each club independently', async () => {
    const acm = vi.fn();
    const robotics = vi.fn();
    subscribe('club_acm', acm);
    subscribe('club_robotics', robotics);

    api.someoneElseAdds('club_acm', makeEvent({clubId: 'club_acm'}));
    await tick();

    expect(acm).toHaveBeenCalledTimes(1);
    expect(robotics).toHaveBeenCalledTimes(1); // its own first snapshot ([])
    expect(acm.mock.lastCall![0]).toHaveLength(1);
    expect(robotics.mock.lastCall![0]).toEqual([]);
  });

  it('does not stack requests when a poll outlives its interval', async () => {
    subscribe(CLUB, vi.fn());
    const release = api.holdNextRequest();

    await tick(); // first poll starts and hangs
    expect(api.getCount).toBe(1);

    await tick(2); // two more ticks pass while it is still in flight
    expect(api.getCount).toBe(1);

    release();
    await settle();
    await tick();
    expect(api.getCount).toBe(2);
  });
});

describe('subscription teardown', () => {
  it('does not evict a newer subscription when a stale cleanup runs late', async () => {
    // The defect: the unsubscribe closure deleted from the map by club id
    // rather than by identity. React runs an effect remount as
    // cleanup-then-subscribe, but a cleanup arriving after the newer mount had
    // already installed its subscription would evict it - leaving the new
    // listener registered against a map entry that nothing polls, and live
    // updates silently dead for the rest of the page's life.
    const abandoned = vi.fn();
    const current = vi.fn();

    const staleCleanup = subscribe(CLUB, abandoned);
    staleCleanup();

    subscribe(CLUB, current);
    staleCleanup(); // late, duplicate, from the previous mount

    api.someoneElseAdds(CLUB, makeEvent({title: 'Officer Sync'}));
    await tick();

    expect(current).toHaveBeenCalledTimes(1);
    expect(current.mock.lastCall![0]).toEqual([
      expect.objectContaining({title: 'Officer Sync'}),
    ]);
    expect(abandoned).not.toHaveBeenCalled();
  });

  it('is idempotent, so a double cleanup is not an error', () => {
    const unsubscribe = subscribe(CLUB, vi.fn());
    unsubscribe();
    expect(() => {
      unsubscribe();
    }).not.toThrow();
  });
});

describe('a poll that fails', () => {
  it('retries on the next tick after a transient error', async () => {
    const listener = vi.fn();
    subscribe(CLUB, listener);

    api.failNext(500);
    await tick();
    expect(listener).not.toHaveBeenCalled();

    // Networks drop and the dev API restarts. One bad tick must not be fatal.
    api.someoneElseAdds(CLUB, makeEvent());
    await tick();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('retries after a dropped connection', async () => {
    const listener = vi.fn();
    subscribe(CLUB, listener);

    api.failNextWithNetworkError();
    await tick();
    expect(listener).not.toHaveBeenCalled();

    api.someoneElseAdds(CLUB, makeEvent());
    await tick();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403, 404])(
    'stops knocking every interval after a %i',
    async (status) => {
      subscribe(CLUB, vi.fn());
      api.failEveryRequest(status);

      await tick();
      const countAtPause = api.getCount;

      await tick(6);

      // 404 is a non-member by design, not a deleted club, so backing off is
      // the same correct response as for 401 and 403.
      expect(api.getCount).toBe(countAtPause);
    },
  );
});

describe('a paused subscription recovers', () => {
  it('resumes when the tab regains focus', async () => {
    // The defect: `halted` was permanent. Signing out races a poll that comes
    // back 401, so the next person to sign in inherited a calendar that
    // silently never updated again for the life of the page.
    const listener = vi.fn();
    subscribe(CLUB, listener);

    api.failEveryRequest(401);
    await tick();
    await tick(4);
    expect(listener).not.toHaveBeenCalled();

    api.recover();
    api.someoneElseAdds(CLUB, makeEvent({title: 'Back In'}));

    setTabVisibility('hidden');
    setTabVisibility('visible');
    await settle();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.lastCall![0]).toEqual([
      expect.objectContaining({title: 'Back In'}),
    ]);
  });

  it('keeps polling on the interval after it recovers', async () => {
    const listener = vi.fn();
    subscribe(CLUB, listener);

    api.failEveryRequest(401);
    await tick();
    api.recover();

    setTabVisibility('hidden');
    setTabVisibility('visible');
    await settle();
    api.clearCalls();

    // A resume that only fired the catch-up poll and never restarted the timer
    // would look fixed and still be broken a minute later.
    api.someoneElseAdds(CLUB, makeEvent());
    await tick();
    expect(api.getCount).toBe(1);
    expect(listener).toHaveBeenCalled();
  });

  it('resumes after a write succeeds', async () => {
    const listener = vi.fn();
    subscribe(CLUB, listener);

    api.failEveryRequest(401);
    await tick();
    api.recover();

    // A write that succeeded is proof the caller can reach the API again.
    await repository.create(CLUB, makeDraft({title: 'Rush Info Night'}));

    expect(listener).toHaveBeenCalledTimes(1);
    api.clearCalls();

    api.someoneElseAdds(CLUB, makeEvent({startsAt: '2026-10-01T23:00:00.000Z'}));
    await tick();
    expect(api.getCount).toBe(1);
  });
});

describe('tab visibility', () => {
  it('stops polling while the tab is hidden', async () => {
    subscribe(CLUB, vi.fn());
    await tick();
    const countWhileVisible = api.getCount;

    setTabVisibility('hidden');
    await tick(6);

    // A dashboard left open all afternoon should not still be talking.
    expect(api.getCount).toBe(countWhileVisible);
  });

  it('catches up on return instead of waiting out a full interval', async () => {
    const listener = vi.fn();
    subscribe(CLUB, listener);
    setTabVisibility('hidden');

    api.someoneElseAdds(CLUB, makeEvent({title: 'Missed While Away'}));
    await tick(4);
    expect(listener).not.toHaveBeenCalled();

    setTabVisibility('visible');
    await settle(); // no clock advance: the catch-up must be immediate

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.lastCall![0]).toEqual([
      expect.objectContaining({title: 'Missed While Away'}),
    ]);
  });

  it('does not start a timer when subscribing into a hidden tab', async () => {
    setTabVisibility('hidden');
    const listener = vi.fn();
    subscribe(CLUB, listener);

    await tick(4);
    expect(api.getCount).toBe(0);

    setTabVisibility('visible');
    await settle();
    expect(api.getCount).toBe(1);

    api.someoneElseAdds(CLUB, makeEvent());
    await tick();
    expect(listener).toHaveBeenCalled();
  });

  it('releases the document listener once the last subscription is gone', () => {
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');

    const first = subscribe(CLUB, vi.fn());
    const second = subscribe('club_robotics', vi.fn());
    // One listener for the repository, not one per subscription.
    expect(countVisibilityCalls(add)).toBe(1);

    first();
    expect(countVisibilityCalls(remove)).toBe(0);
    second();
    expect(countVisibilityCalls(remove)).toBe(1);
  });
});

describe('writes', () => {
  it('POSTs the draft and returns the persisted event', async () => {
    const draft = makeDraft({title: 'Resume Workshop'});

    const created = await repository.create(CLUB, draft);

    expect(api.callsTo('POST')[0]).toMatchObject({
      path: `/api/clubs/${CLUB}/events`,
      body: draft,
    });
    expect(created).toMatchObject({
      title: 'Resume Workshop',
      clubId: CLUB,
      // Attribution comes from the session, which is why `create` takes no
      // author argument.
      createdBy: 'Avery Officer',
    });
  });

  it('re-reads after a write rather than splicing its own response in', async () => {
    api.setEvents(CLUB, [makeEvent({startsAt: '2026-08-01T23:00:00.000Z'})]);
    const listener = vi.fn();
    subscribe(CLUB, listener);
    await repository.list(CLUB);
    api.clearCalls();

    await repository.create(
      CLUB,
      makeDraft({
        title: 'Resume Workshop',
        startsAt: '2026-07-01T23:00:00.000Z',
        endsAt: '2026-07-02T00:00:00.000Z',
      }),
    );

    expect(api.callsTo('POST')).toHaveLength(1);
    expect(api.callsTo('GET')).toHaveLength(1);
    // Subscribers are owed the whole ordered snapshot. The new event sorts
    // first, which a naive append would have gotten wrong.
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.lastCall![0].map((e: ClubEvent) => e.title)).toEqual([
      'Resume Workshop',
      'Event 1',
    ]);
  });

  it('PATCHes the event path with the id encoded', async () => {
    api.setEvents(CLUB, [makeEvent({id: 'evt/1'})]);

    const updated = await repository.update(CLUB, 'evt/1', {location: 'Rogers 109'});

    expect(api.callsTo('PATCH')[0]).toMatchObject({
      path: `/api/clubs/${CLUB}/events/evt%2F1`,
      body: {location: 'Rogers 109'},
    });
    expect(updated.location).toBe('Rogers 109');
  });

  it('DELETEs and tolerates a 204 with no body', async () => {
    api.setEvents(CLUB, [makeEvent({id: 'evt_1'})]);
    const listener = vi.fn();
    subscribe(CLUB, listener);
    await repository.list(CLUB);

    // Calling .json() on a bodyless 204 throws, so this passing is the point.
    await expect(repository.remove(CLUB, 'evt_1')).resolves.toBeUndefined();

    expect(api.callsTo('DELETE')[0]!.path).toBe(
      `/api/clubs/${CLUB}/events/evt_1`,
    );
    expect(listener).toHaveBeenCalledWith([]);
  });

  it('does not re-read when nothing is subscribed', async () => {
    await repository.create(CLUB, makeDraft());

    // Nobody is listening, so the extra round trip would buy nothing.
    expect(api.callsTo('GET')).toHaveLength(0);
  });

  it('rejects a refused write and leaves subscribers untouched', async () => {
    api.setEvents(CLUB, [makeEvent()]);
    const listener = vi.fn();
    subscribe(CLUB, listener);
    await repository.list(CLUB);

    api.failNext(403, 'Only officers can create events.');

    await expect(repository.create(CLUB, makeDraft())).rejects.toMatchObject({
      status: 403,
      message: 'Only officers can create events.',
    });
    expect(listener).not.toHaveBeenCalled();
  });
});

/** How many of a spy's calls were for `visibilitychange`. */
function countVisibilityCalls(spy: {mock: {calls: unknown[][]}}): number {
  return spy.mock.calls.filter((call) => call[0] === 'visibilitychange').length;
}
