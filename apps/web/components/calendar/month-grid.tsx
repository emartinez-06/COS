'use client';

/**
 * The month calendar grid.
 *
 * Composed from Grid/Stack primitives rather than Astryx `Calendar` on purpose:
 * `Calendar` is a date *picker* (it has no per-day content slot, only
 * selection and marker states), whereas this surface has to render several
 * event chips per cell and treat empty space as a create affordance. Different
 * job, so it gets a composition instead of a misused component.
 *
 * Layout budget for a 6-row grid: header row 32px, each day cell min 104px,
 * hairline borders drawn on the cell so the grid reads as one ruled surface
 * rather than 42 separate boxes.
 */

import type {CSSProperties} from 'react';
import {Grid} from '@astryxdesign/core/Grid';
import {VStack, HStack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';
import type {ClubEvent} from '@cos/core';
import {groupEventsByDay, toLocalDayKey} from '@cos/core';
import {
  WEEKDAY_LABELS,
  buildMonthGrid,
  isSameDay,
  isSameMonth,
} from '../../lib/datetime';
import {EventChip} from './event-chip';

const MAX_CHIPS_PER_DAY = 3;

const surface: CSSProperties = {
  backgroundColor: 'var(--color-background-surface)',
  borderRadius: 'var(--radius-container)',
  border: 'var(--border-width) solid var(--color-border)',
  overflow: 'hidden',
};

const weekdayHeader: CSSProperties = {
  borderBottom: 'var(--border-width) solid var(--color-border)',
  backgroundColor: 'var(--color-background-muted)',
};

const weekdayCell: CSSProperties = {
  paddingBlock: 'var(--spacing-2)',
  textAlign: 'center',
};

/**
 * Cells draw only their top and start borders; the container clips the
 * outermost ones, which avoids doubled 2px lines between neighbours.
 */
const dayCellBase: CSSProperties = {
  minHeight: 104,
  padding: 'var(--spacing-1-5)',
  borderTop: 'var(--border-width) solid var(--color-border)',
  borderInlineStart: 'var(--border-width) solid var(--color-border)',
  cursor: 'pointer',
  minWidth: 0,
  transition: 'background-color var(--duration-fast) ease',
};

const outsideMonthCell: CSSProperties = {
  backgroundColor: 'var(--color-background-muted)',
};

const selectedDayCell: CSSProperties = {
  // Inset ring rather than an outline so it does not shift the grid lines.
  boxShadow: 'inset 0 0 0 2px var(--color-accent)',
};

const dayNumberBase: CSSProperties = {
  width: 24,
  height: 24,
  borderRadius: 'var(--radius-full)',
  flexShrink: 0,
};

/** Today gets the filled navy pill - the one high-contrast marker in the grid. */
const todayNumber: CSSProperties = {
  ...dayNumberBase,
  backgroundColor: 'var(--color-accent)',
};

// `minWidth: 0` lets chips shrink inside the grid track instead of forcing the
// column wider; `overflow: hidden` is what actually gives Token its ellipsis.
const chipStack: CSSProperties = {
  minWidth: 0,
  width: '100%',
  overflow: 'hidden',
};

interface MonthGridProps {
  /** Any date within the month to display. */
  month: Date;
  events: readonly ClubEvent[];
  selectedEventId: string | null;
  selectedDay: Date | null;
  onSelectEvent: (event: ClubEvent) => void;
  onSelectDay: (day: Date) => void;
  /** Double-clicking a day is a shortcut straight to the composer, not just a selection. */
  onCreateDay: (day: Date) => void;
}

export function MonthGrid({
  month,
  events,
  selectedEventId,
  selectedDay,
  onSelectEvent,
  onSelectDay,
  onCreateDay,
}: MonthGridProps) {
  const days = buildMonthGrid(month);
  const eventsByDay = groupEventsByDay(events);
  const today = new Date();

  return (
    <VStack gap={0} style={surface}>
      <Grid columns={7} gap={0} style={weekdayHeader}>
        {WEEKDAY_LABELS.map((label) => (
          <Text
            key={label}
            type="supporting"
            weight="semibold"
            color="secondary"
            display="block"
            style={weekdayCell}>
            {label}
          </Text>
        ))}
      </Grid>

      <Grid columns={7} gap={0}>
        {days.map((day) => {
          const dayEvents = eventsByDay.get(toLocalDayKey(day)) ?? [];
          const isToday = isSameDay(day, today);
          const isOutside = !isSameMonth(day, month);
          const isSelected = selectedDay ? isSameDay(day, selectedDay) : false;
          const overflow = dayEvents.length - MAX_CHIPS_PER_DAY;

          return (
            <VStack
              key={day.toISOString()}
              gap={1}
              style={{
                ...dayCellBase,
                ...(isOutside ? outsideMonthCell : null),
                ...(isSelected ? selectedDayCell : null),
              }}
              // A day cell is a create affordance for officers and a focus
              // target for members; the composer decides what a click means.
              onClick={() => onSelectDay(day)}
              onDoubleClick={() => onCreateDay(day)}>
              <HStack gap={1} vAlign="center" hAlign="start">
                <HStack
                  vAlign="center"
                  hAlign="center"
                  style={isToday ? todayNumber : dayNumberBase}>
                  <Text
                    type="supporting"
                    weight={isToday ? 'bold' : 'medium'}
                    color={
                      isToday ? 'inherit' : isOutside ? 'disabled' : 'primary'
                    }
                    style={isToday ? {color: 'var(--color-on-accent)'} : undefined}>
                    {day.getDate()}
                  </Text>
                </HStack>
              </HStack>

              <VStack gap={0.5} style={chipStack}>
                {dayEvents.slice(0, MAX_CHIPS_PER_DAY).map((event) => (
                  <EventChip
                    key={event.id}
                    event={event}
                    isSelected={event.id === selectedEventId}
                    onSelect={onSelectEvent}
                  />
                ))}
                {overflow > 0 && (
                  <Text type="supporting" color="secondary">
                    +{overflow} more
                  </Text>
                )}
              </VStack>
            </VStack>
          );
        })}
      </Grid>
    </VStack>
  );
}
