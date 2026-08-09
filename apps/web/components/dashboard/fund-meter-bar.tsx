'use client';

/**
 * The shape of a fund's balance, drawn beside the figures rather than instead
 * of them.
 *
 * This component holds no arithmetic - `lib/fund-meter.ts` turns a
 * `FundSummary` into widths and is tested on its own. All that happens here is
 * turning those widths into styles.
 *
 * It is deliberately not a substitute for `FundBalance`. Every surface that
 * shows money still shows all four numbers; this sits above them and answers
 * the one question four equally-weighted figures answer badly - how much of
 * the fund is already promised.
 */

import type {CSSProperties} from 'react';
import {HStack, VStack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';
import type {FundSummary} from '@cos/core';

import {fundMeter, type FundMeterSegmentKey} from '../../lib/fund-meter';
import styles from './dashboard.module.css';

// `string | undefined` because the CSS module's generated type does not
// promise a class exists; the fallback keeps the join below total.
const SEGMENT_CLASS: Record<FundMeterSegmentKey, string | undefined> = {
  spent: styles.meterSpent,
  committed: styles.meterCommitted,
  available: styles.meterAvailable,
};

/** Only the painted segments get a swatch; "available" is the bare track. */
const LEGEND: {key: FundMeterSegmentKey; label: string; color: string}[] = [
  {key: 'spent', label: 'Spent', color: 'var(--fund-spent)'},
  {key: 'committed', label: 'Committed', color: 'var(--fund-committed)'},
];

export function FundMeterBar({summary}: {summary: FundSummary}) {
  const meter = fundMeter(summary);

  // An untouched fund with no grant has no shape to draw, and an empty track
  // reads as "something at zero" rather than "nothing here yet".
  if (meter.segments.length === 0) {
    return null;
  }

  return (
    <VStack gap={2} hAlign="stretch">
      <div
        className={styles.meterTrack}
        // The bar repeats what the figures below already say, so it is
        // decoration to a screen reader rather than a second, wordier copy of
        // the same four amounts.
        aria-hidden>
        {meter.segments.map((segment) => (
          <div
            key={segment.key}
            className={[styles.meterSegment, SEGMENT_CLASS[segment.key]]
              .filter(Boolean)
              .join(' ')}
            style={{width: `${segment.percent}%`}}
          />
        ))}
        {meter.isOverCommitted ? (
          <div
            className={styles.allocatedMark}
            style={{insetInlineStart: `${meter.allocatedMarkPercent}%`}}
          />
        ) : null}
      </div>

      <HStack gap={4} vAlign="center" wrap="wrap">
        {LEGEND.map((entry) => (
          <HStack key={entry.key} gap={2} vAlign="center">
            <span
              className={styles.swatch}
              style={{backgroundColor: entry.color} as CSSProperties}
              aria-hidden
            />
            <Text type="supporting" color="secondary">
              {entry.label}
            </Text>
          </HStack>
        ))}
        {meter.isOverCommitted ? (
          <Text type="supporting" style={{color: 'var(--color-error)'}}>
            The line marks where the grant ran out
          </Text>
        ) : null}
      </HStack>
    </VStack>
  );
}
