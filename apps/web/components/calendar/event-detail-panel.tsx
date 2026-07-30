'use client';

/**
 * The selected event, shown in the calendar's end panel.
 *
 * Officer and member see the same content; only the action row differs, gated
 * on capabilities rather than on the role directly.
 */

import type {CSSProperties} from 'react';
import {Button} from '@astryxdesign/core/Button';
import {Divider} from '@astryxdesign/core/Divider';
import {HStack, VStack} from '@astryxdesign/core/Stack';
import {Heading, Text} from '@astryxdesign/core/Text';
import {Link} from '@astryxdesign/core/Link';
import {Token} from '@astryxdesign/core/Token';
import {Icon} from '@astryxdesign/core/Icon';
import {
  ArrowTopRightOnSquareIcon,
  ClockIcon,
  MapPinIcon,
  MicrophoneIcon,
  PencilSquareIcon,
  TrashIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline';
import {
  CATEGORY_COLORS,
  CATEGORY_LABELS,
  type ClubEvent,
} from '@cos/core';
import {formatDayLong, formatTime} from '../../lib/datetime';
import {useCan} from '../../lib/session';

const description: CSSProperties = {
  whiteSpace: 'pre-wrap',
};

interface DetailRowProps {
  icon: React.ComponentProps<typeof Icon>['icon'];
  children: React.ReactNode;
}

function DetailRow({icon, children}: DetailRowProps) {
  return (
    <HStack gap={2} vAlign="start">
      <Icon icon={icon} size="sm" color="secondary" />
      <VStack gap={0}>{children}</VStack>
    </HStack>
  );
}

interface EventDetailPanelProps {
  event: ClubEvent;
  onEdit: (event: ClubEvent) => void;
  onDelete: (event: ClubEvent) => void;
}

export function EventDetailPanel({
  event,
  onEdit,
  onDelete,
}: EventDetailPanelProps) {
  const canEdit = useCan('event:edit');
  const canDelete = useCan('event:delete');

  const start = new Date(event.startsAt);

  return (
    <VStack gap={4}>
      <VStack gap={2}>
        {/* HStack so the token hugs its label; as a direct VStack child it
            would stretch to the full panel width. */}
        <HStack hAlign="start">
          <Token
            size="sm"
            label={CATEGORY_LABELS[event.category]}
            color={
              CATEGORY_COLORS[event.category] as React.ComponentProps<
                typeof Token
              >['color']
            }
          />
        </HStack>
        <Heading level={3}>{event.title}</Heading>
      </VStack>

      <VStack gap={3}>
        <DetailRow icon={ClockIcon}>
          <Text type="body" weight="medium" display="block">
            {formatDayLong(start)}
          </Text>
          <Text type="supporting" color="secondary" display="block">
            {formatTime(event.startsAt)} - {formatTime(event.endsAt)}
          </Text>
        </DetailRow>

        {event.location && (
          <DetailRow icon={MapPinIcon}>
            <Text type="body" display="block">
              {event.location}
            </Text>
          </DetailRow>
        )}

        {event.speaker && (
          <DetailRow icon={MicrophoneIcon}>
            <Text type="body" weight="medium" display="block">
              {event.speaker.name}
            </Text>
            {(event.speaker.title || event.speaker.affiliation) && (
              <Text type="supporting" color="secondary" display="block">
                {[event.speaker.title, event.speaker.affiliation]
                  .filter(Boolean)
                  .join(', ')}
              </Text>
            )}
          </DetailRow>
        )}

        <DetailRow icon={UserGroupIcon}>
          <Text type="supporting" color="secondary" display="block">
            {event.visibility === 'public'
              ? 'Public - visible on the club page'
              : 'Members only'}
          </Text>
        </DetailRow>
      </VStack>

      {event.description && (
        <>
          <Divider />
          <Text type="body" color="secondary" style={description}>
            {event.description}
          </Text>
        </>
      )}

      {event.links.length > 0 && (
        <>
          <Divider />
          <VStack gap={2}>
            <Text type="label" weight="semibold">
              Links
            </Text>
            {event.links.map((link) => (
              <HStack key={link.url} gap={1} vAlign="center">
                <Icon
                  icon={ArrowTopRightOnSquareIcon}
                  size="sm"
                  color="secondary"
                />
                <Link href={link.url} target="_blank" rel="noreferrer">
                  {link.label}
                </Link>
              </HStack>
            ))}
          </VStack>
        </>
      )}

      {(canEdit || canDelete) && (
        <>
          <Divider />
          <HStack gap={2}>
            {canEdit && (
              <Button
                label="Edit"
                variant="secondary"
                size="sm"
                icon={<Icon icon={PencilSquareIcon} size="sm" />}
                onClick={() => onEdit(event)}
              />
            )}
            {canDelete && (
              <Button
                label="Delete"
                variant="ghost"
                size="sm"
                icon={<Icon icon={TrashIcon} size="sm" />}
                onClick={() => onDelete(event)}
              />
            )}
          </HStack>
        </>
      )}

      <Text type="supporting" color="disabled">
        Added by {event.createdBy}
      </Text>
    </VStack>
  );
}
