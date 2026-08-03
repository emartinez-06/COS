'use client';

/**
 * The three numbers, and the one derived from them.
 *
 * This component exists so that no screen in the product can render a bare
 * "remaining" figure. That is the rule `docs/TREASURY.md` states and it is the
 * whole reason the model tracks committed separately from spent: a treasurer
 * who sees `$1,100 remaining` without knowing $800 of it is already promised has
 * been actively misled by their own tool, and will approve a request the fund
 * cannot cover.
 *
 * So available never appears alone here. It is always shown beside what was
 * allocated, what is committed, and what is spent, and the layout puts
 * *committed* immediately next to available because that is the pair whose
 * relationship people get wrong.
 */

import type {CSSProperties} from 'react';
import {Card} from '@astryxdesign/core/Card';
import {VStack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';
import type {FundSummary} from '@cos/core';
import {formatMoney} from '@cos/core';

const grid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
  gap: 'var(--spacing-4)',
  minWidth: 0,
};

const figure: CSSProperties = {minWidth: 0};

/**
 * Available is the number people act on, so it is the one that gets weight -
 * and the one that turns red when it goes negative rather than being clamped.
 * An over-committed club has to see it the moment it becomes true.
 */
function amountColor(cents: number, emphasis: boolean): CSSProperties {
  if (cents < 0) {
    return {color: 'var(--color-error)'};
  }
  return emphasis ? {} : {color: 'var(--color-text-secondary)'};
}

function Figure({
  label,
  cents,
  hint,
  emphasis = false,
}: {
  label: string;
  cents: number;
  hint?: string;
  emphasis?: boolean;
}) {
  return (
    <VStack gap={0} style={figure} hAlign="stretch">
      <Text type="supporting" color="secondary" display="block">
        {label}
      </Text>
      <Text
        type={emphasis ? 'large' : 'body'}
        weight="semibold"
        display="block"
        style={amountColor(cents, emphasis)}>
        {formatMoney(cents)}
      </Text>
      {hint ? (
        <Text type="supporting" color="secondary" display="block">
          {hint}
        </Text>
      ) : null}
    </VStack>
  );
}

export function FundBalance({
  summary,
  /** Rendered without its own Card, for use inside one. */
  bare = false,
}: {
  summary: FundSummary;
  bare?: boolean;
}) {
  const isOverCommitted = summary.availableCents < 0;

  const content = (
    <VStack gap={3} hAlign="stretch">
      <div style={grid}>
        <Figure
          label="Available to ask for"
          cents={summary.availableCents}
          emphasis
          hint={isOverCommitted ? 'More is promised than the fund holds' : undefined}
        />
        <Figure
          label="Committed"
          cents={summary.committedCents}
          hint="Asked for, not yet bought"
        />
        <Figure label="Spent" cents={summary.spentCents} hint="Confirmed" />
        <Figure label="Allocated" cents={summary.allocatedCents} />
      </div>
    </VStack>
  );

  if (bare) {
    return content;
  }

  return <Card padding={5}>{content}</Card>;
}
