'use client';

/**
 * Default content for the calendar's end panel when no event is selected.
 *
 * Two jobs:
 * - Members get the "what's next" agenda, which is what they actually open the
 *   dashboard for.
 * - Officers additionally get the GroupMe announcement preview. That preview is
 *   rendered from the same `draftAnnouncement` function the bot will call, so
 *   what the officer reads here is what the group receives - it is not a
 *   mock-up of the message.
 */

import type {CSSProperties} from 'react';
import {Card} from '@astryxdesign/core/Card';
import {Divider} from '@astryxdesign/core/Divider';
import {HStack, VStack} from '@astryxdesign/core/Stack';
import {Heading, Text} from '@astryxdesign/core/Text';
import {Token} from '@astryxdesign/core/Token';
import {Icon} from '@astryxdesign/core/Icon';
import {ChatBubbleLeftRightIcon} from '@heroicons/react/24/outline';
import {
  CATEGORY_COLORS,
  type ClubEvent,
  draftAnnouncement,
  upcomingEvents,
} from '@cos/core';
import {formatDayLong, formatTime} from '../../lib/datetime';
import {useCan} from '../../lib/session';

const MAX_AGENDA_ITEMS = 5;

const agendaRow: CSSProperties = {
  cursor: 'pointer',
  paddingBlock: 'var(--spacing-2)',
};

/**
 * Monospace and pre-wrap because this is a preview of literal GroupMe text -
 * showing it in the body font would misrepresent the line breaks members see.
 */
const messagePreview: CSSProperties = {
  whiteSpace: 'pre-wrap',
  fontFamily: 'var(--font-family-code)',
};

interface UpcomingPanelProps {
  events: readonly ClubEvent[];
  clubName: string;
  onSelectEvent: (event: ClubEvent) => void;
}

export function UpcomingPanel({
  events,
  clubName,
  onSelectEvent,
}: UpcomingPanelProps) {
  const canDraft = useCan('announcement:draft');
  const upcoming = upcomingEvents(events);
  const agenda = upcoming.slice(0, MAX_AGENDA_ITEMS);
  const announcement = draftAnnouncement(events, {clubName});

  return (
    <VStack gap={5}>
      <VStack gap={2}>
        <Heading level={3}>Up next</Heading>
        {agenda.length === 0 ? (
          <Text type="supporting" color="secondary">
            Nothing scheduled. Upcoming events appear here as officers add them.
          </Text>
        ) : (
          <VStack gap={0}>
            {agenda.map((event, index) => (
              <VStack key={event.id} gap={0}>
                {index > 0 && <Divider />}
                <VStack
                  gap={1}
                  style={agendaRow}
                  onClick={() => onSelectEvent(event)}>
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
        )}
      </VStack>

      {canDraft && (
        <VStack gap={2}>
          <HStack gap={2} vAlign="center">
            <Icon icon={ChatBubbleLeftRightIcon} size="sm" color="accent" />
            <Heading level={4}>GroupMe draft</Heading>
          </HStack>
          <Text type="supporting" color="secondary">
            What the bot will post for the next two weeks. Generated from the
            events above.
          </Text>
          <Card variant="muted" padding={3}>
            <Text type="supporting" style={messagePreview}>
              {announcement.text}
            </Text>
          </Card>
          <Text type="supporting" color="disabled">
            {announcement.events.length === 0
              ? 'No events in range.'
              : `Drafted from ${announcement.events.length} ${
                  announcement.events.length === 1 ? 'event' : 'events'
                }. Sending is not wired up yet.`}
          </Text>
        </VStack>
      )}
    </VStack>
  );
}
