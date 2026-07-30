'use client';

/**
 * Page header for the calendar: month position, navigation, and create.
 *
 * Deliberately not Astryx `Toolbar` - that component is documented for
 * contextual actions *within* a content area, not as a page-level header.
 */

import type {CSSProperties} from 'react';
import {Button} from '@astryxdesign/core/Button';
import {HStack, VStack} from '@astryxdesign/core/Stack';
import {Heading, Text} from '@astryxdesign/core/Text';
import {Icon} from '@astryxdesign/core/Icon';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
} from '@heroicons/react/24/outline';
import {formatMonthYear} from '../../lib/datetime';

const header: CSSProperties = {
  paddingBlockEnd: 'var(--spacing-4)',
};

interface CalendarToolbarProps {
  month: Date;
  /** Count shown beside the month, so the header carries some information. */
  eventCount: number;
  canCreate: boolean;
  onPreviousMonth: () => void;
  onNextMonth: () => void;
  onToday: () => void;
  onCreate: () => void;
}

export function CalendarToolbar({
  month,
  eventCount,
  canCreate,
  onPreviousMonth,
  onNextMonth,
  onToday,
  onCreate,
}: CalendarToolbarProps) {
  return (
    <HStack hAlign="between" vAlign="center" gap={4} style={header}>
      <VStack gap={0}>
        <Heading level={2}>{formatMonthYear(month)}</Heading>
        <Text type="supporting" color="secondary">
          {eventCount === 0
            ? 'No events this month'
            : `${eventCount} ${eventCount === 1 ? 'event' : 'events'} this month`}
        </Text>
      </VStack>

      <HStack gap={2} vAlign="center">
        <Button
          label="Previous month"
          variant="ghost"
          size="sm"
          isIconOnly
          icon={<Icon icon={ChevronLeftIcon} size="sm" />}
          onClick={onPreviousMonth}
        />
        <Button label="Today" variant="secondary" size="sm" onClick={onToday} />
        <Button
          label="Next month"
          variant="ghost"
          size="sm"
          isIconOnly
          icon={<Icon icon={ChevronRightIcon} size="sm" />}
          onClick={onNextMonth}
        />
        {canCreate && (
          <Button
            label="New event"
            variant="primary"
            size="sm"
            icon={<Icon icon={PlusIcon} size="sm" />}
            onClick={onCreate}
          />
        )}
      </HStack>
    </HStack>
  );
}
