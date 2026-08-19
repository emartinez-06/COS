'use client';

/**
 * The calendar's upcoming agenda, embedded on the canvas.
 *
 * Reuses `useEvents()` and `upcomingEvents` directly rather than fetching a
 * second time. Deliberately lighter than `UpcomingPanel`: no GroupMe draft
 * section (a compose workflow does not belong in a small overview widget)
 * and no click-to-select (there is no detail panel here for a click to
 * populate).
 */

import type {CSSProperties} from 'react';
import {Divider} from '@astryxdesign/core/Divider';
import {HStack, VStack} from '@astryxdesign/core/Stack';
import {Skeleton} from '@astryxdesign/core/Skeleton';
import {Text} from '@astryxdesign/core/Text';
import {Token} from '@astryxdesign/core/Token';
import {CATEGORY_COLORS, upcomingEvents} from '@cos/core';

import {formatDayLong, formatTime} from '../../../lib/datetime';
import {useEvents} from '../../../lib/event-store';
import type {EntityEmbedRendererProps} from '../entity-embed-registry';

const MAX_AGENDA_ITEMS = 5;

const scroll: CSSProperties = {overflowY: 'auto', height: '100%'};

export function CanvasCalendarEmbed(_props: EntityEmbedRendererProps) {
  const {events, isLoading, error} = useEvents();

  if (isLoading) {
    return (
      <VStack gap={2} hAlign="stretch">
        <Skeleton height={20} />
        <Skeleton height={20} />
        <Skeleton height={20} />
      </VStack>
    );
  }

  if (error) {
    return (
      <Text type="body" color="secondary">
        The calendar could not be loaded.
      </Text>
    );
  }

  const agenda = upcomingEvents(events).slice(0, MAX_AGENDA_ITEMS);

  if (agenda.length === 0) {
    return (
      <Text type="body" color="secondary">
        Nothing scheduled. Upcoming events appear here as officers add them.
      </Text>
    );
  }

  return (
    <VStack gap={0} style={scroll}>
      {agenda.map((event, index) => (
        <VStack key={event.id} gap={0}>
          {index > 0 && <Divider />}
          <VStack gap={1} style={{paddingBlock: 'var(--spacing-2)'}}>
            <HStack gap={2} vAlign="center">
              <Token
                size="sm"
                label={formatDayLong(new Date(event.startsAt))}
                color={
                  CATEGORY_COLORS[event.category] as React.ComponentProps<
                    typeof Token
                  >['color']
                }
              />
            </HStack>
            <Text type="body" weight="medium" display="block">
              {event.title}
            </Text>
            <Text type="supporting" color="secondary" display="block">
              {formatTime(event.startsAt)}
              {event.location ? ` - ${event.location}` : ''}
            </Text>
          </VStack>
        </VStack>
      ))}
    </VStack>
  );
}
