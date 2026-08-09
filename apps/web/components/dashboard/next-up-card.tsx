'use client';

/**
 * What the club is doing next.
 *
 * The calendar's own `UpcomingPanel` answers the same question, and this is
 * deliberately not a copy of it: that panel is an agenda beside a month grid,
 * with a GroupMe draft under it, and it assumes the reader is already looking
 * at the calendar. This is the summary that decides whether they need to.
 *
 * So it shows fewer events, leads with the nearest one, and its whole surface
 * is a link to the calendar.
 */

import type {CSSProperties} from 'react';
import NextLink from 'next/link';
import {Card} from '@astryxdesign/core/Card';
import {Divider} from '@astryxdesign/core/Divider';
import {HStack, VStack} from '@astryxdesign/core/Stack';
import {Heading, Text} from '@astryxdesign/core/Text';
import {Token} from '@astryxdesign/core/Token';
import {Skeleton} from '@astryxdesign/core/Skeleton';
import {CATEGORY_COLORS, CATEGORY_LABELS, upcomingEvents} from '@cos/core';
import type {ClubEvent} from '@cos/core';

import {formatDayLong, formatTime} from '../../lib/datetime';
import {useEvents} from '../../lib/event-store';
import {CardShell} from './card-shell';

const MAX_ROWS = 3;

const hero: CSSProperties = {minWidth: 0};

function EventRow({event, isFirst}: {event: ClubEvent; isFirst: boolean}) {
  return (
    <VStack gap={0} style={hero} hAlign="stretch">
      <HStack gap={2} vAlign="center" wrap="wrap">
        <Token
          label={formatDayLong(new Date(event.startsAt))}
          // Same cast the calendar's event chip uses: the category colours are
          // plain strings in core, which imports nothing from Astryx.
          color={
            CATEGORY_COLORS[event.category] as React.ComponentProps<
              typeof Token
            >['color']
          }
          size="sm"
        />
        <Text type="supporting" color="secondary">
          {CATEGORY_LABELS[event.category]}
        </Text>
      </HStack>
      <Text
        type={isFirst ? 'large' : 'body'}
        weight="semibold"
        display="block">
        {event.title}
      </Text>
      <Text type="supporting" color="secondary" display="block">
        {formatTime(event.startsAt)}
        {event.location ? ` - ${event.location}` : ''}
      </Text>
    </VStack>
  );
}

export function NextUpCard() {
  const {events, isLoading, error} = useEvents();

  const upcoming = upcomingEvents(events).slice(0, MAX_ROWS);
  const totalUpcoming = upcomingEvents(events).length;

  return (
    <CardShell
      title="Calendar"
      href="/calendar"
      actionLabel="Open the calendar"
      // Counting only what is still ahead. A total that includes last term's
      // events answers a question nobody asked on a page about what is next.
      meta={
        isLoading || error
          ? undefined
          : `${totalUpcoming} ${totalUpcoming === 1 ? 'event' : 'events'} ahead`
      }>
      {isLoading ? (
        <VStack gap={3} hAlign="stretch">
          <Skeleton height={20} />
          <Skeleton height={20} />
        </VStack>
      ) : error ? (
        <Text type="body" color="secondary">
          The calendar could not be loaded.
        </Text>
      ) : upcoming.length === 0 ? (
        <Text type="body" color="secondary">
          Nothing on the calendar yet.
        </Text>
      ) : (
        <VStack gap={3} hAlign="stretch">
          {upcoming.map((event, index) => (
            <VStack key={event.id} gap={3} hAlign="stretch">
              {index > 0 ? <Divider /> : null}
              <EventRow event={event} isFirst={index === 0} />
            </VStack>
          ))}
        </VStack>
      )}
    </CardShell>
  );
}
