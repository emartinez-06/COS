/**
 * Tests for the React binding over the EventRepository port.
 *
 * These run the *real* `HttpEventRepository` against the fake API rather than a
 * mock repository. The store's job is almost entirely lifecycle - when it
 * subscribes, when it tears down, and what it shows in between - so a mock
 * repository would leave the interesting half untested. Only `useSession` is
 * faked, because it is the input being varied.
 *
 * The headline case is the third of last session's browser-caught defects: the
 * subscription was not keyed on the viewer, so signing out and back in as
 * someone else in the same tab left the new person watching a subscription that
 * had been paused on the previous person's behalf.
 */

import {act, cleanup, render, screen} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {EventStoreProvider, useEvents} from './event-store';
import {
  FakeApi,
  makeEvent,
  resetEventFixtures,
  setTabVisibility,
} from './test-support/fake-api';

/** The default the store constructs its repository with. */
const POLL_MS = 15_000;
const CLUB = 'club_demo';

/** Swapped by tests to simulate an in-tab account switch. */
let viewer: {id: string} | null;

vi.mock('./session', () => ({
  useSession: () => ({user: viewer}),
}));

let api: FakeApi;

beforeEach(() => {
  vi.useFakeTimers();
  resetEventFixtures();
  api = new FakeApi();
  vi.stubGlobal('fetch', api.handle);
  setTabVisibility('visible');
  viewer = {id: 'user_avery'};
});

afterEach(() => {
  // Not automatic here: React Testing Library only registers its own cleanup
  // when vitest runs with globals enabled, and this project does not.
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Renders the store's state so assertions read like the screen. */
function Probe() {
  const {events, isLoading, error} = useEvents();
  return (
    <div>
      <span data-testid="status">
        {isLoading ? 'loading' : error ? `error: ${error}` : 'ready'}
      </span>
      <span data-testid="titles">
        {events.map((event) => event.title).join(', ')}
      </span>
    </div>
  );
}

/** Advances the clock inside act(), so React applies the resulting state. */
async function advance(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function renderStore(clubId = CLUB) {
  const result = render(
    <EventStoreProvider clubId={clubId}>
      <Probe />
    </EventStoreProvider>,
  );
  return {
    ...result,
    show: (nextClubId = clubId) =>
      result.rerender(
        <EventStoreProvider clubId={nextClubId}>
          <Probe />
        </EventStoreProvider>,
      ),
  };
}

function status(): string {
  return screen.getByTestId('status').textContent ?? '';
}

function titles(): string {
  return screen.getByTestId('titles').textContent ?? '';
}

describe('the initial load', () => {
  it('shows the club events once they arrive', async () => {
    api.setEvents(CLUB, [makeEvent({title: 'Weekly Chapter Meeting'})]);

    renderStore();
    expect(status()).toBe('loading');

    await advance();

    expect(status()).toBe('ready');
    expect(titles()).toBe('Weekly Chapter Meeting');
  });

  it('reports an unreachable API instead of showing an empty calendar', async () => {
    // An empty calendar renders "Your officers have not scheduled anything
    // yet", which is a confident lie when the truth is the API is down. This
    // is the failure mode that only exists over a network.
    api.failEveryRequest(503);

    renderStore();
    await advance();

    expect(status()).toContain('error:');
    expect(titles()).toBe('');
  });

  it('leaves the loading state even when the load fails', async () => {
    api.failNextWithNetworkError();

    renderStore();
    await advance();

    // Otherwise the calendar sits on its skeleton forever.
    expect(status()).not.toBe('loading');
  });
});

describe('live updates', () => {
  it('re-renders when another officer changes the calendar', async () => {
    api.setEvents(CLUB, [makeEvent({title: 'Weekly Chapter Meeting'})]);
    renderStore();
    await advance();

    api.someoneElseAdds(
      CLUB,
      makeEvent({title: 'Fall Kickoff', startsAt: '2026-09-01T23:00:00.000Z'}),
    );
    await advance(POLL_MS);

    expect(titles()).toBe('Weekly Chapter Meeting, Fall Kickoff');
  });

  it('stops polling after unmount', async () => {
    const {unmount} = renderStore();
    await advance();
    api.clearCalls();

    unmount();
    await advance(POLL_MS * 3);

    // A provider that never unsubscribed would keep a timer alive for the life
    // of the page.
    expect(api.getCount).toBe(0);
  });
});

describe('switching clubs', () => {
  it('does not show the previous club under the new club’s loading state', async () => {
    api.setEvents('club_acm', [makeEvent({title: 'ACM Meeting'})]);
    api.setEvents('club_robotics', [makeEvent({title: 'Robotics Build Night'})]);

    const {show} = renderStore('club_acm');
    await advance();
    expect(titles()).toBe('ACM Meeting');

    show('club_robotics');
    expect(status()).toBe('loading');
    expect(titles()).toBe('');

    await advance();
    expect(titles()).toBe('Robotics Build Night');
  });
});

describe('an in-tab account switch', () => {
  it('rebuilds a subscription that was paused on the previous viewer’s behalf', async () => {
    // The defect, end to end. Signing out races a poll, that poll comes back
    // 401 and pauses the subscription, and the next person to sign in inherits
    // a calendar that silently never updates again. Keying the effect on the
    // viewer is what makes the switch tear the old subscription down.
    api.setEvents(CLUB, [makeEvent({title: 'Weekly Chapter Meeting'})]);
    const {show} = renderStore();
    await advance();
    expect(titles()).toBe('Weekly Chapter Meeting');

    // Sign out: the in-flight poll comes back 401 and the subscription pauses.
    api.failEveryRequest(401);
    await advance(POLL_MS);

    // Someone else signs in on the same tab.
    api.recover();
    viewer = {id: 'user_jordan'};
    show();
    await advance();

    expect(status()).toBe('ready');
    expect(titles()).toBe('Weekly Chapter Meeting');

    // And the new viewer is on a live subscription, not a dead one.
    api.someoneElseAdds(
      CLUB,
      makeEvent({title: 'Service Day', startsAt: '2026-09-05T23:00:00.000Z'}),
    );
    await advance(POLL_MS);
    expect(titles()).toBe('Weekly Chapter Meeting, Service Day');
  });

  it('does not tear down the subscription on an unrelated re-render', async () => {
    api.setEvents(CLUB, [makeEvent({title: 'Weekly Chapter Meeting'})]);
    const {show} = renderStore();
    await advance();
    api.clearCalls();

    // Same viewer, same club: re-subscribing here would re-list on every
    // render of a parent, which is the opposite failure.
    show();
    await advance();

    expect(api.getCount).toBe(0);
  });
});

describe('the mutators', () => {
  it('thread the club id so components pass only an event id', async () => {
    api.setEvents(CLUB, [makeEvent({id: 'evt_1', title: 'Weekly Chapter Meeting'})]);

    let store!: ReturnType<typeof useEvents>;
    function Capture() {
      store = useEvents();
      return null;
    }
    render(
      <EventStoreProvider clubId={CLUB}>
        <Capture />
        <Probe />
      </EventStoreProvider>,
    );
    await advance();

    await act(async () => {
      await store.deleteEvent('evt_1');
    });

    expect(api.callsTo('DELETE')[0]!.path).toBe(
      `/api/clubs/${CLUB}/events/evt_1`,
    );
    expect(titles()).toBe('');
  });
});

describe('useEvents outside a provider', () => {
  it('throws rather than returning undefined', () => {
    // Silencing React's error boundary logging; the throw is the assertion.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/EventStoreProvider/);
    consoleError.mockRestore();
  });
});
