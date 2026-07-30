'use client';

/**
 * The treasury's expense surface.
 *
 * Intentionally empty. The section exists so the navigation reflects the
 * product's real shape while the feature is built; it renders an honest
 * placeholder rather than mock rows, because fake totals in a money screen are
 * the kind of thing that gets believed.
 *
 * The Card is not decoration. The shell paints a dot grid behind the content
 * area, so anything text-bearing needs its own surface or the grid shows
 * through - the same defect already fixed once on the calendar's context
 * panel.
 */

import type {CSSProperties} from 'react';
import {Card} from '@astryxdesign/core/Card';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {Icon} from '@astryxdesign/core/Icon';
import {VStack} from '@astryxdesign/core/Stack';
import {Heading, Text} from '@astryxdesign/core/Text';
import {BanknotesIcon} from '@heroicons/react/24/outline';

const page: CSSProperties = {
  padding: 'var(--spacing-5)',
  minWidth: 0,
};

export function ExpensesView() {
  return (
    <VStack gap={5} style={page} hAlign="stretch">
      <VStack gap={1}>
        <Heading level={2}>Expenses</Heading>
        <Text type="body" color="secondary">
          Set the fund the club starts the semester with, then track what it
          spends against it.
        </Text>
      </VStack>

      <Card padding={8}>
        <EmptyState
          icon={<Icon icon={BanknotesIcon} />}
          title="Expense tracking is not built yet"
          description="This is where the semester’s opening balance and every expense recorded against it will live, so the remaining fund is always current. Nothing to show until that lands."
        />
      </Card>
    </VStack>
  );
}
