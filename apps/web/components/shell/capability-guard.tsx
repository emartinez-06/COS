'use client';

/**
 * Gates a whole surface on a capability.
 *
 * Hiding a section from the sidebar is not enough: the URL is still typeable,
 * and a member who follows a link an officer sent them would otherwise land on
 * a screen built for someone else. This renders an explanation instead.
 *
 * Like AuthGuard, this is a routing convenience and not a security control. It
 * decides what to draw. The API applies `requireCapability` to the request
 * regardless of what the browser believes, which is the check that actually
 * protects anything.
 *
 * Safe to render inside AuthGuard only: `useCan` answers false while the
 * session is still loading, and AuthGuard is what holds the spinner until it
 * resolves. Used outside it, this would flash the refusal at everyone.
 */

import type {CSSProperties} from 'react';
import type {Capability} from '@cos/core';
import {Card} from '@astryxdesign/core/Card';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {Icon} from '@astryxdesign/core/Icon';
import {VStack} from '@astryxdesign/core/Stack';
import {LockClosedIcon} from '@heroicons/react/24/outline';

import {useCan} from '../../lib/session';

const page: CSSProperties = {
  padding: 'var(--spacing-5)',
  minWidth: 0,
};

export function CapabilityGuard({
  capability,
  children,
}: {
  capability: Capability;
  children: React.ReactNode;
}) {
  const allowed = useCan(capability);

  if (!allowed) {
    return (
      <VStack gap={5} style={page} hAlign="stretch">
        <Card padding={8}>
          <EmptyState
            icon={<Icon icon={LockClosedIcon} />}
            title="This section is for officers"
            // Names the remedy rather than just the refusal. "Ask an officer"
            // is actionable; "access denied" leaves someone stuck.
            description="Your club's officers manage this. Ask one of them if you think you should have access."
          />
        </Card>
      </VStack>
    );
  }

  return <>{children}</>;
}
