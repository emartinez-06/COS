'use client';

/**
 * Officer/Member view switch.
 *
 * Phase-1 scaffolding, not a product feature: it stands in for auth so both
 * audiences can be reviewed in one browser. It is intentionally conspicuous
 * rather than tucked away, because anyone looking at this dashboard needs to
 * know the role is being simulated.
 */

import {SegmentedControl, SegmentedControlItem} from '@astryxdesign/core/SegmentedControl';
import {HStack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';
import type {Role} from '@cos/core';
import {useSession} from '../../lib/session';

export function RoleSwitcher() {
  const {role, setRole} = useSession();

  return (
    <HStack gap={2} vAlign="center">
      <Text type="supporting" color="secondary">
        Viewing as
      </Text>
      <SegmentedControl
        label="Switch between the officer and member view"
        size="sm"
        value={role}
        onChange={(next) => setRole(next as Role)}>
        <SegmentedControlItem value="admin" label="Officer" />
        <SegmentedControlItem value="member" label="Member" />
      </SegmentedControl>
    </HStack>
  );
}
