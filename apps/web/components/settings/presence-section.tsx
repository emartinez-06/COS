'use client';

/**
 * Setting your own status.
 *
 * This lives in Settings rather than in a menu hanging off the sidebar avatar,
 * which is where most products put it and where it was tempting to put here.
 * The 2026-07-30 decision that deleted `user-menu.tsx` is the reason: a
 * dropdown anchored to the sidebar footer covers the very identity block it
 * hangs from, in a 260px rail with no room to open anywhere else. That was
 * found by looking at it, and it applies to any menu in that corner, not just
 * the one that was removed.
 *
 * The four options are three choices plus "automatic", and automatic is the
 * default because most people never touch this and the heartbeat is right
 * about them.
 */

import {Card} from '@astryxdesign/core/Card';
import {RadioList, RadioListItem} from '@astryxdesign/core/RadioList';
import {HStack, VStack} from '@astryxdesign/core/Stack';
import {Heading, Text} from '@astryxdesign/core/Text';
import {
  PRESENCE_STATUS_LABELS,
  type ManualPresenceStatus,
} from '@cos/core';

import {usePresence} from '../../lib/presence-store';
import {MemberAvatar} from '../shell/member-avatar';
import {useSession} from '../../lib/session';

const AUTOMATIC = 'automatic';

const OPTIONS = [
  {
    value: AUTOMATIC,
    label: 'Automatic',
    description:
      'Active while you have COS open, idle after a while, offline once you close it.',
  },
  {
    value: 'active',
    label: PRESENCE_STATUS_LABELS.active,
    description: 'Always show as around, even when you have stepped away.',
  },
  {
    value: 'idle',
    label: PRESENCE_STATUS_LABELS.idle,
    description: 'Show as away while you keep working.',
  },
  {
    value: 'dnd',
    label: PRESENCE_STATUS_LABELS.dnd,
    description: 'Tell the club you would rather not be interrupted.',
  },
];

export function PresenceSection() {
  const {user} = useSession();
  const presence = usePresence();

  // Rendered inside the dashboard, so the provider is always above this. The
  // guard is for the type, and for the case someone reuses this elsewhere.
  if (!presence || !user) {
    return null;
  }

  const {ownStatus, manualStatus, setManualStatus} = presence;

  return (
    <VStack gap={5} hAlign="stretch">
      <VStack gap={1}>
        <Heading level={2}>Availability</Heading>
        <Text type="body" color="secondary">
          What the rest of {`your club`} sees next to your name.
        </Text>
      </VStack>

      <Card padding={6}>
        <VStack gap={5} hAlign="stretch">
          {/*
            Showing the result rather than only the control. "Do not disturb"
            as a selected radio and "do not disturb" as the badge other people
            actually see are different things, and only the second is what the
            person is trying to decide about.
          */}
          <HStack gap={3} vAlign="center">
            <MemberAvatar
              name={user.name}
              image={user.image}
              status={ownStatus}
              size="lg"
              hasTooltip={false}
            />
            <VStack gap={0}>
              <Text type="body" weight="semibold">
                {user.name}
              </Text>
              <Text type="supporting" color="secondary">
                Showing as {PRESENCE_STATUS_LABELS[ownStatus].toLowerCase()}
              </Text>
            </VStack>
          </HStack>

          <RadioList
            label="Your status"
            value={manualStatus ?? AUTOMATIC}
            onChange={(value) => {
              void setManualStatus(
                value === AUTOMATIC ? null : (value as ManualPresenceStatus),
              );
            }}>
            {OPTIONS.map((option) => (
              <RadioListItem
                key={option.value}
                value={option.value}
                label={option.label}
                description={option.description}
              />
            ))}
          </RadioList>
        </VStack>
      </Card>

      <Text type="supporting" color="secondary">
        Whatever you pick here, you stop showing as around once you have been
        gone long enough - a status set last week is not a claim about today.
      </Text>
    </VStack>
  );
}
