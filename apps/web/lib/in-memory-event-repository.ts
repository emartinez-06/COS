/**
 * The in-memory EventRepository.
 *
 * This is the phase-1 stand-in for services/api. It exists so the calendar can
 * be built and judged against the real domain model before the API framework
 * and auth decisions are made (both still open - see docs/OPEN-QUESTIONS.md).
 *
 * Because it satisfies `EventRepository`, replacing it with an HTTP-backed
 * implementation is a one-line swap in `event-store.tsx` and touches no UI.
 *
 * Deliberately NOT persisted: a page refresh restores the seed. Wiring this to
 * localStorage would invent a migration problem for data that is about to be
 * thrown away when the real API lands.
 */

import type {
  ClubEvent,
  EventDraft,
  EventPatch,
  EventRepository,
  Unsubscribe,
} from '@cos/core';
import {byStartTime} from '@cos/core';

type Listener = (events: ClubEvent[]) => void;

export class InMemoryEventRepository implements EventRepository {
  #events: ClubEvent[];
  #listeners = new Set<{clubId: string; listener: Listener}>();

  constructor(seed: readonly ClubEvent[] = []) {
    this.#events = [...seed];
  }

  async list(clubId: string): Promise<ClubEvent[]> {
    return this.#forClub(clubId);
  }

  async create(
    clubId: string,
    draft: EventDraft,
    author: string,
  ): Promise<ClubEvent> {
    const now = new Date().toISOString();
    const event: ClubEvent = {
      ...draft,
      id: newId(),
      clubId,
      createdAt: now,
      updatedAt: now,
      createdBy: author,
    };
    this.#events = [...this.#events, event];
    this.#emit(clubId);
    return event;
  }

  async update(id: string, patch: EventPatch): Promise<ClubEvent> {
    const existing = this.#events.find((event) => event.id === id);
    if (!existing) {
      throw new Error(`No event with id ${id}`);
    }
    const updated: ClubEvent = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this.#events = this.#events.map((event) =>
      event.id === id ? updated : event,
    );
    this.#emit(existing.clubId);
    return updated;
  }

  async remove(id: string): Promise<void> {
    const existing = this.#events.find((event) => event.id === id);
    if (!existing) {
      return;
    }
    this.#events = this.#events.filter((event) => event.id !== id);
    this.#emit(existing.clubId);
  }

  subscribe(clubId: string, listener: Listener): Unsubscribe {
    const entry = {clubId, listener};
    this.#listeners.add(entry);
    return () => {
      this.#listeners.delete(entry);
    };
  }

  #forClub(clubId: string): ClubEvent[] {
    return this.#events
      .filter((event) => event.clubId === clubId)
      .sort(byStartTime);
  }

  #emit(clubId: string): void {
    const snapshot = this.#forClub(clubId);
    for (const {clubId: subscribed, listener} of this.#listeners) {
      if (subscribed === clubId) {
        listener(snapshot);
      }
    }
  }
}

/**
 * `crypto.randomUUID` needs a secure context; fall back to a random suffix so
 * the dashboard still works over plain http on a LAN address.
 */
function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `evt_${Math.random().toString(36).slice(2, 10)}`;
}
