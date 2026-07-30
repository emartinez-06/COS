'use client';

/**
 * Who you are, which club you are viewing, and how to leave.
 *
 * Replaces the phase-1 Officer/Member switch. That control simulated a role;
 * this one reports the real one, which is why the role is shown as a label
 * rather than as something selectable.
 *
 * Club switching lives here because a person genuinely belongs to several
 * clubs. It only appears when they belong to more than one - a switcher with
 * a single option is noise.
 */

import {Badge} from '@astryxdesign/core/Badge';
import {DropdownMenu} from '@astryxdesign/core/DropdownMenu';
import {HStack} from '@astryxdesign/core/Stack';
import {ROLE_LABELS} from '@cos/core';

import {useSession} from '../../lib/session';

export function UserMenu() {
  const {user, memberships, activeClub, role, selectClub, signOut} =
    useSession();

  if (!user) {
    return null;
  }

  const canSwitchClubs = memberships.length > 1;

  return (
    <HStack gap={2} vAlign="center">
      {role && <Badge label={ROLE_LABELS[role]} />}
      <DropdownMenu
        button={{
          label: user.name,
          variant: 'ghost',
          size: 'sm',
        }}
        items={[
          ...(canSwitchClubs
            ? ([
                {
                  type: 'section' as const,
                  title: 'Clubs',
                  items: memberships.map((club) => ({
                    label:
                      club.clubId === activeClub?.clubId
                        ? `${club.name} (current)`
                        : club.name,
                    onClick: () => selectClub(club.clubId),
                  })),
                },
                {type: 'divider' as const},
              ] as const)
            : []),
          {
            label: 'Sign out',
            onClick: () => void signOut(),
          },
        ]}
      />
    </HStack>
  );
}
