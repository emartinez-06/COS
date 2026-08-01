/**
 * The HTTP EventRepository: the calendar's events, backed by services/api.
 *
 * This replaces the in-memory stand-in. Every method is the same shape the
 * calendar already called, so the swap touched one line in `event-store.tsx`
 * and no component at all.
 *
 * ## About `subscribe`
 *
 * The port promises a fresh snapshot after any change to the club's events,
 * *including changes this browser did not make*. That is the whole point of
 * the seam, and it is worth being explicit about why it is implemented rather
 * than stubbed:
 *
 * - A club has several officers. Two of them planning during a meeting is the
 *   ordinary case, not an edge case.
 * - The GroupMe bot will eventually write events from group messages. That
 *   writer has no browser tab, so no amount of "refresh after my own write"
 *   or tab-focus refetching would ever surface it.
 *
 * Polling is the transport, not the design. Replacing it with a WebSocket or
 * SSE stream is a change to `#poll` and the timer plumbing below; nothing
 * above this file learns about it. The interval is deliberately unhurried -
 * a club calendar is not a trading screen, and each tick is one indexed query.
 *
 * Care taken here that naive polling gets wrong:
 * - One timer per club, shared by every subscriber, not one per listener.
 * - Nothing is emitted when the snapshot is byte-identical to the last one,
 *   so an idle calendar does not re-render every tick.
 * - Polling stops while the tab is hidden and catches up immediately on the
 *   way back, so a dashboard left open all afternoon is not still talking.
 * - A failed poll does not kill the subscription. Networks drop and the dev
 *   API restarts; the next tick should simply try again.
 */

import type {
  ClubEvent,
  EventDraft,
  EventPatch,
  EventRepository,
  Unsubscribe,
} from '@cos/core';

import {ApiError, readErrorMessage} from './api-error';
import {apiFetch} from './auth-client';

// Re-exported because this is where it was defined and imported from before the
// document hub needed it too.
export {ApiError};

type Listener = (events: ClubEvent[]) => void;

interface ClubSubscription {
  listeners: Set<Listener>;
  timer: ReturnType<typeof setInterval> | null;
  /** Guards against a slow poll overlapping the next tick. */
  inFlight: boolean;
  /** Serialized last snapshot, used to suppress no-op emits. */
  lastSignature: string | null;
  /** Set when the caller can no longer read this club; stops the timer. */
  halted: boolean;
}

/** Unhurried on purpose - see the note above. */
const DEFAULT_POLL_INTERVAL_MS = 15_000;

export class HttpEventRepository implements EventRepository {
  readonly #pollIntervalMs: number;
  readonly #subscriptions = new Map<string, ClubSubscription>();
  #visibilityBound = false;

  constructor(pollIntervalMs: number = DEFAULT_POLL_INTERVAL_MS) {
    this.#pollIntervalMs = pollIntervalMs;
  }

  async list(clubId: string): Promise<ClubEvent[]> {
    const events = await this.#fetchEvents(clubId);
    // Record the signature without emitting. The store calls `list` once on
    // mount for its initial render; without this the first poll would compute
    // an identical snapshot, see a null signature, and emit a pointless
    // re-render of the whole calendar.
    this.#recordSignature(clubId, events);
    return events;
  }

  async create(clubId: string, draft: EventDraft): Promise<ClubEvent> {
    const created = await this.#request<ClubEvent>(this.#eventsPath(clubId), {
      method: 'POST',
      body: JSON.stringify(draft),
    });
    await this.#refresh(clubId);
    return created;
  }

  async update(
    clubId: string,
    eventId: string,
    patch: EventPatch,
  ): Promise<ClubEvent> {
    const updated = await this.#request<ClubEvent>(
      this.#eventPath(clubId, eventId),
      {method: 'PATCH', body: JSON.stringify(patch)},
    );
    await this.#refresh(clubId);
    return updated;
  }

  async remove(clubId: string, eventId: string): Promise<void> {
    await this.#request<void>(
      this.#eventPath(clubId, eventId),
      {method: 'DELETE'},
      false,
    );
    await this.#refresh(clubId);
  }

  subscribe(clubId: string, listener: Listener): Unsubscribe {
    const subscription = this.#ensureSubscription(clubId);
    subscription.listeners.add(listener);

    return () => {
      subscription.listeners.delete(listener);
      if (subscription.listeners.size > 0) {
        return;
      }
      this.#stopTimer(subscription);
      // Delete by identity, not by key. React remounts an effect as
      // cleanup-then-subscribe, but a late cleanup from a previous mount must
      // never evict the subscription a newer mount has already installed -
      // that would leave the new listener registered against a map entry
      // nothing polls, and live updates would silently stop.
      if (this.#subscriptions.get(clubId) === subscription) {
        this.#subscriptions.delete(clubId);
      }
      this.#unbindVisibilityIfIdle();
    };
  }

  // --- requests -----------------------------------------------------------

  #eventsPath(clubId: string): string {
    return `/api/clubs/${encodeURIComponent(clubId)}/events`;
  }

  #eventPath(clubId: string, eventId: string): string {
    return `${this.#eventsPath(clubId)}/${encodeURIComponent(eventId)}`;
  }

  async #request<T>(
    path: string,
    init: RequestInit = {},
    expectBody = true,
  ): Promise<T> {
    const response = await apiFetch(path, init);

    if (!response.ok) {
      throw new ApiError(response.status, await readErrorMessage(response));
    }

    // DELETE answers 204 with no body; calling .json() on it throws.
    if (!expectBody || response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  #fetchEvents(clubId: string): Promise<ClubEvent[]> {
    return this.#request<ClubEvent[]>(this.#eventsPath(clubId));
  }

  /**
   * Re-reads the club and notifies subscribers if anything changed.
   *
   * Writes re-read rather than splicing their own response into a cached list.
   * A create returns the created event, but subscribers are owed the whole
   * ordered snapshot, and reconciling a local splice against a poll response
   * that predates the write is exactly where flicker bugs live. One extra
   * round trip against a club-sized list is a good trade for not having a
   * second, subtly different, ordering implementation on the client.
   */
  async #refresh(clubId: string): Promise<void> {
    if (!this.#subscriptions.has(clubId)) {
      return;
    }
    // Only writes call this, and a write that succeeded proves the caller can
    // reach the API - so un-pause a subscription that an earlier 401 stopped.
    this.#resume(clubId);
    this.#emitIfChanged(clubId, await this.#fetchEvents(clubId));
  }

  // --- subscription plumbing ---------------------------------------------

  #ensureSubscription(clubId: string): ClubSubscription {
    const existing = this.#subscriptions.get(clubId);
    if (existing) {
      return existing;
    }

    const subscription: ClubSubscription = {
      listeners: new Set(),
      timer: null,
      inFlight: false,
      lastSignature: null,
      halted: false,
    };
    this.#subscriptions.set(clubId, subscription);

    this.#bindVisibility();
    if (isVisible()) {
      this.#startTimer(clubId, subscription);
    }

    return subscription;
  }

  #startTimer(clubId: string, subscription: ClubSubscription): void {
    if (subscription.timer !== null || subscription.halted) {
      return;
    }
    subscription.timer = setInterval(() => {
      void this.#poll(clubId);
    }, this.#pollIntervalMs);
  }

  #stopTimer(subscription: ClubSubscription): void {
    if (subscription.timer !== null) {
      clearInterval(subscription.timer);
      subscription.timer = null;
    }
  }

  async #poll(clubId: string): Promise<void> {
    const subscription = this.#subscriptions.get(clubId);
    if (!subscription || subscription.inFlight || subscription.halted) {
      return;
    }

    subscription.inFlight = true;
    try {
      this.#emitIfChanged(clubId, await this.#fetchEvents(clubId));
    } catch (error) {
      // 401/403/404 all mean this caller is not getting events from this path
      // right now: signed out, role revoked, or not a member. Stop knocking.
      // Backing off is not a claim that the club was deleted - a non-member
      // gets 404 by design. Anything else is transient and retried next tick.
      //
      // This is a pause, never a permanent kill. Signing out and back in as
      // someone else happens in one page lifetime, and the sign-out itself
      // races a poll that gets a 401; a halt that could not recover would
      // leave the next signed-in person with a calendar that quietly never
      // updates again. `#resume` is called on tab focus and after any
      // successful write.
      if (error instanceof ApiError && [401, 403, 404].includes(error.status)) {
        subscription.halted = true;
        this.#stopTimer(subscription);
      }
    } finally {
      subscription.inFlight = false;
    }
  }

  #recordSignature(clubId: string, events: ClubEvent[]): void {
    const subscription = this.#subscriptions.get(clubId);
    if (subscription) {
      subscription.lastSignature = JSON.stringify(events);
    }
  }

  #emitIfChanged(clubId: string, events: ClubEvent[]): void {
    const subscription = this.#subscriptions.get(clubId);
    if (!subscription) {
      return;
    }

    // The API returns a stable order (startsAt ascending) and a fixed field
    // order, so serializing is a sound equality check and cheap at club size.
    const signature = JSON.stringify(events);
    if (signature === subscription.lastSignature) {
      return;
    }
    subscription.lastSignature = signature;

    // Copied because a listener may unsubscribe while being notified.
    for (const listener of [...subscription.listeners]) {
      listener(events);
    }
  }

  // --- tab visibility -----------------------------------------------------

  /**
   * Clears a paused subscription so it polls again.
   *
   * Called when the tab regains focus and after a write succeeds - both are
   * evidence the caller can reach the API again. At worst this costs one
   * request that fails and pauses it right back.
   */
  #resume(clubId: string): void {
    const subscription = this.#subscriptions.get(clubId);
    if (!subscription) {
      return;
    }
    subscription.halted = false;
    if (isVisible()) {
      this.#startTimer(clubId, subscription);
    }
  }

  #handleVisibilityChange = (): void => {
    if (isVisible()) {
      for (const clubId of [...this.#subscriptions.keys()]) {
        this.#resume(clubId);
        // Catch up now rather than waiting out a full interval, which is what
        // makes coming back to a parked tab feel instant.
        void this.#poll(clubId);
      }
      return;
    }

    for (const subscription of this.#subscriptions.values()) {
      this.#stopTimer(subscription);
    }
  };

  #bindVisibility(): void {
    if (this.#visibilityBound || typeof document === 'undefined') {
      return;
    }
    document.addEventListener('visibilitychange', this.#handleVisibilityChange);
    this.#visibilityBound = true;
  }

  #unbindVisibilityIfIdle(): void {
    if (
      !this.#visibilityBound ||
      this.#subscriptions.size > 0 ||
      typeof document === 'undefined'
    ) {
      return;
    }
    document.removeEventListener(
      'visibilitychange',
      this.#handleVisibilityChange,
    );
    this.#visibilityBound = false;
  }
}

/** True when there is no document (SSR) or the tab is on screen. */
function isVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}
