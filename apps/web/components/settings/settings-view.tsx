'use client';

/**
 * Settings, with a sub-navigation panel.
 *
 * Adapted from Astryx's `settings-sidebar` template rather than dropped in
 * whole. Two things had to change: the template is a standalone screen that
 * anchors itself to `100dvh`, which would fight the AppShell it now lives
 * inside, and its sections are a consumer app's (Taxes, Payments, Travel for
 * work). What is kept is the shape - a fixed-width `LayoutPanel` of section
 * links beside a scrolling content area.
 *
 * Sections are limited to what this product can actually answer today.
 * Profile and Club are read-only because there is no endpoint to write them
 * yet, and showing an editable field that silently discards the edit is worse
 * than showing the value plainly.
 */

import {useEffect, useState, type CSSProperties} from 'react';
import {useSearchParams} from 'next/navigation';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {Selector} from '@astryxdesign/core/Selector';
import {Divider} from '@astryxdesign/core/Divider';
import {Icon} from '@astryxdesign/core/Icon';
import {
  Layout,
  LayoutContent,
  LayoutPanel,
} from '@astryxdesign/core/Layout';
import {List, ListItem} from '@astryxdesign/core/List';
import {HStack, VStack} from '@astryxdesign/core/Stack';
import {Text, Heading} from '@astryxdesign/core/Text';
import {
  BuildingLibraryIcon,
  CommandLineIcon,
  SignalIcon,
  UserGroupIcon,
  UserIcon,
} from '@heroicons/react/24/outline';

import {useSession} from '../../lib/session';
import {MembersSection} from './members-section';
import {PresenceSection} from './presence-section';
import {ShortcutsSection} from './shortcuts-section';

const NAV_WIDTH = 240;

const panelSurface: CSSProperties = {
  backgroundColor: 'var(--color-background-surface)',
  height: '100%',
};

const panelInner: CSSProperties = {padding: 'var(--spacing-3)'};
const page: CSSProperties = {padding: 'var(--spacing-5)', minWidth: 0};
const rowPadding: CSSProperties = {paddingBlock: 'var(--spacing-3)'};

type SectionId =
  | 'profile'
  | 'availability'
  | 'club'
  | 'members'
  | 'shortcuts';

const SECTIONS: {id: SectionId; label: string; icon: typeof UserIcon}[] = [
  {id: 'profile', label: 'Your profile', icon: UserIcon},
  {id: 'availability', label: 'Availability', icon: SignalIcon},
  {id: 'club', label: 'Club', icon: BuildingLibraryIcon},
  {id: 'members', label: 'Members', icon: UserGroupIcon},
  {id: 'shortcuts', label: 'Keyboard shortcuts', icon: CommandLineIcon},
];

/** A label and its value. The read-only half of settings. */
function InfoRow({label, value}: {label: string; value: string}) {
  return (
    <>
      <HStack hAlign="between" vAlign="start" style={rowPadding} gap={3}>
        <Text type="body" weight="semibold">
          {label}
        </Text>
        <Text type="body" color="secondary">
          {value}
        </Text>
      </HStack>
      <Divider />
    </>
  );
}

function ProfileSection() {
  const {user, title, activeClub, signOut} = useSession();

  return (
    <VStack gap={5} hAlign="stretch">
      <VStack gap={1}>
        <Heading level={2}>Your profile</Heading>
        <Text type="body" color="secondary">
          How you appear to the rest of {activeClub?.name ?? 'your club'}.
        </Text>
      </VStack>

      <Card padding={6}>
        <VStack gap={0} hAlign="stretch">
          <InfoRow label="Name" value={user?.name ?? '-'} />
          <InfoRow label="Email" value={user?.email ?? '-'} />
          <InfoRow label="Your role here" value={title ?? '-'} />
        </VStack>
      </Card>

      <Text type="supporting" color="secondary">
        Editing these is not built yet.
      </Text>

      {/*
        Sign out lives here rather than in a dropdown off the sidebar. It is an
        account action, this is the account screen, and a menu anchored to the
        sidebar footer covered the very title it hung from.
      */}
      <Card padding={6}>
        <VStack gap={3} hAlign="stretch">
          <VStack gap={1}>
            <Heading level={3}>Session</Heading>
            <Text type="supporting" color="secondary">
              You are signed in as {user?.email ?? 'this account'}.
            </Text>
          </VStack>
          <HStack hAlign="start">
            <Button
              label="Sign out"
              variant="destructive"
              onClick={() => void signOut()}
            />
          </HStack>
        </VStack>
      </Card>
    </VStack>
  );
}

function ClubSection() {
  const {activeClub, memberships, selectClub} = useSession();

  // A switcher with one option is noise, so it only appears for someone who
  // genuinely belongs to more than one club.
  const canSwitchClubs = memberships.length > 1;

  return (
    <VStack gap={5} hAlign="stretch">
      <VStack gap={1}>
        <Heading level={2}>Club</Heading>
        <Text type="body" color="secondary">
          The club this dashboard is showing.
        </Text>
      </VStack>

      {canSwitchClubs ? (
        <Card padding={6}>
          <VStack gap={3} hAlign="stretch">
            <Heading level={3}>Which club are you looking at?</Heading>
            <Selector
              label="Active club"
              options={memberships.map((club) => ({
                value: club.clubId,
                label: club.name,
              }))}
              value={activeClub?.clubId}
              onChange={(value) => value && selectClub(value)}
            />
          </VStack>
        </Card>
      ) : null}

      <Card padding={6}>
        <VStack gap={0} hAlign="stretch">
          <InfoRow label="Name" value={activeClub?.name ?? '-'} />
          <InfoRow label="Address" value={activeClub?.slug ?? '-'} />
          <InfoRow
            label="Clubs you belong to"
            value={String(memberships.length)}
          />
        </VStack>
      </Card>

      <Text type="supporting" color="secondary">
        Renaming a club is not built yet.
      </Text>
    </VStack>
  );
}

/** Only ids this screen actually renders; anything else falls back. */
function parseSection(value: string | null): SectionId | null {
  return SECTIONS.some((entry) => entry.id === value)
    ? (value as SectionId)
    : null;
}

export function SettingsView() {
  /**
   * `?section=` makes each pane a real destination, which is what lets search
   * offer "Members" and land on it. The selection stays local state rather
   * than being driven from the URL on every click: these are panes of one
   * screen, and pushing a history entry per pane would make Back walk through
   * tabs instead of leaving settings.
   *
   * So the parameter is an opening position, read once per navigation.
   */
  const searchParams = useSearchParams();
  const requested = parseSection(searchParams.get('section'));
  const [section, setSection] = useState<SectionId>(requested ?? 'profile');

  useEffect(() => {
    if (requested) {
      setSection(requested);
    }
  }, [requested]);

  return (
    <Layout
      height="fill"
      start={
        <LayoutPanel
          hasDivider
          padding={0}
          width={NAV_WIDTH}
          label="Settings sections"
          style={panelSurface}>
          <VStack gap={0} style={panelInner} hAlign="stretch">
            <List>
              {SECTIONS.map((entry) => (
                <ListItem
                  key={entry.id}
                  label={entry.label}
                  startContent={<Icon icon={entry.icon} />}
                  isSelected={section === entry.id}
                  onClick={() => setSection(entry.id)}
                />
              ))}
            </List>
          </VStack>
        </LayoutPanel>
      }
      content={
        <LayoutContent padding={0}>
          <VStack gap={0} style={page} hAlign="stretch">
            {section === 'profile' ? <ProfileSection /> : null}
            {section === 'availability' ? <PresenceSection /> : null}
            {section === 'club' ? <ClubSection /> : null}
            {section === 'members' ? <MembersSection /> : null}
            {section === 'shortcuts' ? <ShortcutsSection /> : null}
          </VStack>
        </LayoutContent>
      }
    />
  );
}
