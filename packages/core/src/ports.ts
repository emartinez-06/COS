/**
 * Ports: the interfaces the app depends on instead of depending on transports.
 *
 * The calendar UI imports `EventRepository` and nothing else. Today the only
 * implementation is an in-memory store in apps/web; when services/api exists,
 * an HTTP-backed implementation satisfies the same interface and no UI changes.
 *
 * `subscribe` is the realtime seam. An in-memory store notifies synchronously;
 * an HTTP implementation will notify from a WebSocket frame. Callers cannot
 * tell the difference, which is the point.
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

  /** Creates an event and returns the persisted record. */
  create(clubId: string, draft: EventDraft, author: string): Promise<ClubEvent>;

  /** Applies a partial update and returns the updated record. */
  update(id: string, patch: EventPatch): Promise<ClubEvent>;

  /** Removes an event. */
  remove(id: string): Promise<void>;

  /**
   * Registers `listener`, called after any change to this club's events.
   * Used for live updates between the officer and member views.
   */
  subscribe(clubId: string, listener: (events: ClubEvent[]) => void): Unsubscribe;
}
