'use client';

/**
 * React binding for the EventRepository port.
 *
 * Components get events and mutators from `useEvents()` and never learn where
 * the data came from. That indirection paid off exactly as intended: moving
 * from an in-memory array to services/api changed the one `useState`
 * initialiser below and no component.
 *
 * `clubId` is threaded in here rather than by callers, which is why the
 * mutators components see still take only an event id even though the API
 * scopes authorization by club.
 *
 * Live updates come from `repository.subscribe`, which delivers a fresh
 * snapshot after *any* change to the club - including one made by another
 * officer in another browser, or by a server-side writer such as the GroupMe
 * bot. The previous in-memory implementation could only ever see this tab's
 * own writes; that limitation is gone.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type {ClubEvent, EventDraft, EventPatch, EventRepository} from '@cos/core';
import {HttpEventRepository} from './http-event-repository';
import {useSession} from './session';

interface EventStore {
  events: ClubEvent[];
  /** True until the first snapshot arrives. */
  isLoading: boolean;
  /**
   * Set when the events could not be loaded at all, which over HTTP is a real
   * possibility the in-memory store never had. Without this the calendar
   * would sit on its skeleton forever whenever the API is down.
   */
  error: string | null;
  createEvent: (draft: EventDraft) => Promise<ClubEvent>;
  updateEvent: (id: string, patch: EventPatch) => Promise<ClubEvent>;
  deleteEvent: (id: string) => Promise<void>;
}

const EventStoreContext = createContext<EventStore | null>(null);

interface EventStoreProviderProps {
  children: React.ReactNode;
  clubId: string;
}

export function EventStoreProvider({
  children,
  clubId,
}: EventStoreProviderProps) {
  // Constructed once, and deliberately not per club: the repository keys its
  // subscriptions by club id, so switching clubs reuses the same instance.
  const [repository] = useState<EventRepository>(
    () => new HttpEventRepository(),
  );

  // Signing out and back in as someone else happens without this provider
  // unmounting, and the sign-out races a poll that comes back 401. Keying the
  // subscription on the viewer means the account switch tears the old one down
  // and builds a fresh one, instead of leaving the new person watching a
  // subscription that was paused on the old person's behalf.
  const {user} = useSession();
  const viewerId = user?.id ?? null;

  const [events, setEvents] = useState<ClubEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;

    // Reset when the club changes, so the previous club's events are not shown
    // underneath the new club's loading state.
    setIsLoading(true);
    setError(null);
    setEvents([]);

    const unsubscribe = repository.subscribe(clubId, (next) => {
      if (isActive) {
        setEvents(next);
      }
    });

    void repository
      .list(clubId)
      .then((initial) => {
        if (isActive) {
          setEvents(initial);
          setIsLoading(false);
        }
      })
      .catch((cause: unknown) => {
        if (isActive) {
          setError(
            cause instanceof Error
              ? cause.message
              : 'Could not load this club’s events.',
          );
          setIsLoading(false);
        }
      });

    return () => {
      isActive = false;
      unsubscribe();
    };
  }, [repository, clubId, viewerId]);

  const createEvent = useCallback(
    (draft: EventDraft) => repository.create(clubId, draft),
    [repository, clubId],
  );

  const updateEvent = useCallback(
    (id: string, patch: EventPatch) => repository.update(clubId, id, patch),
    [repository, clubId],
  );

  const deleteEvent = useCallback(
    (id: string) => repository.remove(clubId, id),
    [repository, clubId],
  );

  const value = useMemo<EventStore>(
    () => ({events, isLoading, error, createEvent, updateEvent, deleteEvent}),
    [events, isLoading, error, createEvent, updateEvent, deleteEvent],
  );

  return (
    <EventStoreContext.Provider value={value}>
      {children}
    </EventStoreContext.Provider>
  );
}

export function useEvents(): EventStore {
  const store = useContext(EventStoreContext);
  if (!store) {
    throw new Error('useEvents must be used within an EventStoreProvider');
  }
  return store;
}
