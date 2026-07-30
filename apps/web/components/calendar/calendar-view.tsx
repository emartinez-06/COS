'use client';

/**
 * The calendar surface: month grid plus a context panel.
 *
 * Layout budget (Layout `content` + `end`): the grid takes the remaining width,
 * the context panel is a fixed 340px so event detail never reflows the grid.
 *
 * Officer and member render the same tree. Every difference is a capability
 * check, which is what makes the "one dashboard, two views" claim real rather
 * than two parallel implementations that drift.
 *
 * Rendering waits for mount. The seed data and the "today" marker both derive
 * from `new Date()`, which differs between the server pass and the client and
 * would otherwise be a hydration mismatch.
 */

import {useEffect, useMemo, useState, type CSSProperties} from 'react';
import {Layout, LayoutContent, LayoutPanel} from '@astryxdesign/core/Layout';
import {VStack} from '@astryxdesign/core/Stack';
import {Skeleton} from '@astryxdesign/core/Skeleton';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {Button} from '@astryxdesign/core/Button';
import {Banner} from '@astryxdesign/core/Banner';
import {Icon} from '@astryxdesign/core/Icon';
import {CalendarDaysIcon} from '@heroicons/react/24/outline';
import type {ClubEvent, EventDraft} from '@cos/core';
import {isSameMonth, startOfMonth, addMonths} from '../../lib/datetime';
import {useEvents} from '../../lib/event-store';
import {useCan, useSession} from '../../lib/session';
import {CalendarToolbar} from './calendar-toolbar';
import {EventComposerDialog} from './event-composer-dialog';
import {EventDetailPanel} from './event-detail-panel';
import {MonthGrid} from './month-grid';
import {UpcomingPanel} from './upcoming-panel';

const CONTEXT_PANEL_WIDTH = 340;

const page: CSSProperties = {
  padding: 'var(--spacing-5)',
  minWidth: 0,
};

/**
 * The context panel is chrome, not canvas: it gets a solid surface so its text
 * never sits on the dot grid showing through from the shell background.
 */
const contextPanel: CSSProperties = {
  backgroundColor: 'var(--color-background-surface)',
  height: '100%',
};

const panelInner: CSSProperties = {
  padding: 'var(--spacing-4)',
};

export function CalendarView() {
  const {events, isLoading, error, createEvent, updateEvent, deleteEvent} =
    useEvents();
  const canCreate = useCan('event:create');
  // The club's real name, from the session's membership list. It used to come
  // from the web-side fixture, which only worked while the demo club was the
  // only club that existed.
  const {activeClub} = useSession();

  const [isMounted, setIsMounted] = useState(false);
  const [month, setMonth] = useState<Date>(() => startOfMonth(new Date()));
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [composer, setComposer] = useState<{
    isOpen: boolean;
    event: ClubEvent | null;
    day: Date;
  }>(() => ({isOpen: false, event: null, day: new Date()}));

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const monthEvents = useMemo(
    () => events.filter((event) => isSameMonth(new Date(event.startsAt), month)),
    [events, month],
  );

  // The selection is derived from the store rather than held as state, so an
  // edit or a delete elsewhere is reflected here without extra bookkeeping.
  const selectedEvent = useMemo(
    () => events.find((event) => event.id === selectedEventId) ?? null,
    [events, selectedEventId],
  );

  const handleSelectDay = (day: Date) => {
    setSelectedDay(day);
    setSelectedEventId(null);
  };

  const handleSubmit = async (draft: EventDraft) => {
    if (composer.event) {
      await updateEvent(composer.event.id, draft);
    } else {
      const created = await createEvent(draft);
      // Jump to the created event so the officer sees the result of the save.
      setSelectedEventId(created.id);
      setMonth(startOfMonth(new Date(created.startsAt)));
    }
  };

  const handleDelete = async (event: ClubEvent) => {
    await deleteEvent(event.id);
    setSelectedEventId(null);
  };

  const openComposer = (event: ClubEvent | null, day: Date) => {
    setComposer({isOpen: true, event, day});
  };

  if (!isMounted || isLoading) {
    return (
      <VStack gap={4} style={page}>
        <Skeleton width={260} height={32} />
        <Skeleton height={640} />
      </VStack>
    );
  }

  // Shown instead of the grid, not above it. A failed load leaves `events`
  // empty, and an empty calendar renders "Your officers have not scheduled
  // anything yet" - which would be a confident lie when the truth is that we
  // could not reach the API.
  if (error) {
    return (
      <VStack gap={4} style={page}>
        <Banner
          status="error"
          title="Could not load this club’s events"
          description={error}
          endContent={
            <Button
              label="Retry"
              variant="secondary"
              onClick={() => window.location.reload()}
            />
          }
        />
      </VStack>
    );
  }

  return (
    <>
      <Layout
        height="fill"
        content={
          <LayoutContent padding={0}>
            <VStack gap={0} style={page}>
              <CalendarToolbar
                month={month}
                eventCount={monthEvents.length}
                canCreate={canCreate}
                onPreviousMonth={() => setMonth(addMonths(month, -1))}
                onNextMonth={() => setMonth(addMonths(month, 1))}
                onToday={() => setMonth(startOfMonth(new Date()))}
                onCreate={() => openComposer(null, selectedDay ?? new Date())}
              />
              <MonthGrid
                month={month}
                events={events}
                selectedEventId={selectedEventId}
                selectedDay={selectedDay}
                onSelectEvent={(event) => {
                  setSelectedEventId(event.id);
                  setSelectedDay(new Date(event.startsAt));
                }}
                onSelectDay={handleSelectDay}
              />
            </VStack>
          </LayoutContent>
        }
        end={
          <LayoutPanel
            hasDivider
            padding={0}
            width={CONTEXT_PANEL_WIDTH}
            style={contextPanel}>
            <VStack gap={0} style={panelInner}>
              {selectedEvent ? (
                <EventDetailPanel
                  event={selectedEvent}
                  onEdit={(event) =>
                    openComposer(event, new Date(event.startsAt))
                  }
                  onDelete={(event) => void handleDelete(event)}
                />
              ) : events.length === 0 ? (
                <EmptyState
                  icon={<Icon icon={CalendarDaysIcon} />}
                  title="No events yet"
                  description={
                    canCreate
                      ? 'Create the first event and it appears on every member’s calendar immediately.'
                      : 'Your officers have not scheduled anything yet.'
                  }
                  isCompact
                  actions={
                    canCreate ? (
                      <Button
                        label="New event"
                        variant="primary"
                        size="sm"
                        onClick={() => openComposer(null, new Date())}
                      />
                    ) : undefined
                  }
                />
              ) : (
                <UpcomingPanel
                  events={events}
                  clubName={activeClub?.name ?? 'your club'}
                  onSelectEvent={(event) => {
                    setSelectedEventId(event.id);
                    setMonth(startOfMonth(new Date(event.startsAt)));
                  }}
                />
              )}
            </VStack>
          </LayoutPanel>
        }
      />

      {canCreate && (
        <EventComposerDialog
          isOpen={composer.isOpen}
          event={composer.event}
          defaultDay={composer.day}
          onClose={() => setComposer((c) => ({...c, isOpen: false}))}
          onSubmit={handleSubmit}
        />
      )}
    </>
  );
}
