/**
 * Ports: the interfaces the app depends on instead of depending on transports.
 *
 * The calendar UI imports `EventRepository` and nothing else, so the transport
 * underneath it can change without touching a component. That held: swapping
 * the in-memory implementation for the HTTP one changed a single line in
 * `event-store.tsx`.
 *
 * `subscribe` is the realtime seam. It is defined in terms of *what the caller
 * is promised* - a fresh snapshot after any change to the club's events,
 * whoever made it - and deliberately not in terms of how that change is
 * discovered. Today the HTTP implementation discovers it by polling; replacing
 * that with a WebSocket frame is a change inside the repository and invisible
 * above it.
 *
 * Note that "whoever made it" is load-bearing. A change can originate from
 * another officer's browser, or from a server-side writer with no browser at
 * all, which the GroupMe bot will be. An implementation that only notifies the
 * caller of their own writes does not satisfy this interface.
 */

import type {ClubEvent, EventDraft} from './club-event.js';

/** Unsubscribes a listener registered with `subscribe`. */
export type Unsubscribe = () => void;

/**
 * Fields of an event an officer may change after creation.
 * `id`, `clubId`, and the audit fields are deliberately excluded.
 */
export type EventPatch = Partial<EventDraft>;

export interface EventRepository {
  /** All events for a club, chronological. */
  list(clubId: string): Promise<ClubEvent[]>;

  /**
   * Creates an event and returns the persisted record.
   *
   * There is no author parameter on purpose. Attribution comes from the
   * authenticated session on the server; a client-supplied author would be
   * both untrustworthy and ignored.
   */
  create(clubId: string, draft: EventDraft): Promise<ClubEvent>;

  /**
   * Applies a partial update and returns the updated record.
   *
   * `clubId` is required even though `eventId` is unique, because it is what
   * authorization is scoped to: the server resolves the caller's role from
   * their membership of *this club* before touching the event. An in-memory
   * implementation can find the event by id alone, but designing the port
   * around that would have made the authorized case the awkward one.
   */
  update(clubId: string, eventId: string, patch: EventPatch): Promise<ClubEvent>;

  /** Removes an event. `clubId` scopes authorization, as in `update`. */
  remove(clubId: string, eventId: string): Promise<void>;

  /**
   * Registers `listener`, called with a fresh snapshot after any change to
   * this club's events - including changes this caller did not make.
   */
  subscribe(clubId: string, listener: (events: ClubEvent[]) => void): Unsubscribe;
}
