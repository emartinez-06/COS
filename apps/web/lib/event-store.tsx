'use client';

/**
 * React binding for the EventRepository port.
 *
 * Components get events and mutators from `useEvents()` and never learn where
 * the data came from. Today the provider constructs an in-memory repository;
 * pointing it at services/api later means changing the one `useState`
 * initialiser below.
 *
 * Live updates work through `repository.subscribe`, which is why an officer
 * creating an event immediately shows up in the member view: both views read
 * the same subscribed snapshot rather than their own copy.
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
import {InMemoryEventRepository} from './in-memory-event-repository';
import {buildSeedEvents} from './seed-events';
import {useSession} from './session';

interface EventStore {
  events: ClubEvent[];
  /** True until the first snapshot arrives. */
  isLoading: boolean;
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
  const {name: author} = useSession();

  // Constructed once. Swap this line for an HttpEventRepository when the API
  // exists; nothing else in the app changes.
  const [repository] = useState<EventRepository>(
    () => new InMemoryEventRepository(buildSeedEvents()),
  );

  const [events, setEvents] = useState<ClubEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isActive = true;

    const unsubscribe = repository.subscribe(clubId, (next) => {
      if (isActive) {
        setEvents(next);
      }
    });

    void repository.list(clubId).then((initial) => {
      if (isActive) {
        setEvents(initial);
        setIsLoading(false);
      }
    });

    return () => {
      isActive = false;
      unsubscribe();
    };
  }, [repository, clubId]);

  const createEvent = useCallback(
    (draft: EventDraft) => repository.create(clubId, draft, author),
    [repository, clubId, author],
  );

  const updateEvent = useCallback(
    (id: string, patch: EventPatch) => repository.update(id, patch),
    [repository],
  );

  const deleteEvent = useCallback(
    (id: string) => repository.remove(id),
    [repository],
  );

  const value = useMemo<EventStore>(
    () => ({events, isLoading, createEvent, updateEvent, deleteEvent}),
    [events, isLoading, createEvent, updateEvent, deleteEvent],
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
