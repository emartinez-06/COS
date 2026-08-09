/**
 * The fund balance as proportions, for the dashboard's meter.
 *
 * Pure arithmetic, kept out of the component for the same reason
 * `summarizeFund` is kept out of the treasury routes and `orbit-geometry` out
 * of the orbit: this is the part that can be *wrong*, and a bar whose widths
 * are only checkable by looking at a screenshot does not get checked.
 *
 * The meter never replaces the four figures. `FundBalance` remains the only
 * component that puts an amount on screen, and `docs/TREASURY.md`'s rule that
 * no surface renders a bare "remaining" is unchanged - this draws the *shape*
 * of a balance the reader is already being shown in full.
 *
 * What the shape adds over the numbers is the one relationship people misread:
 * how much of the fund is already promised. Four figures in a row are equally
 * weighted and equally easy to skim past; a bar that is two thirds full is not.
 */

import type {FundSummary} from '@cos/core';

/** Ordered outward from money that is definitely gone to money still free. */
export type FundMeterSegmentKey = 'spent' | 'committed' | 'available';

export interface FundMeterSegment {
  key: FundMeterSegmentKey;
  /** Width as a percentage of the track, 0..100. */
  percent: number;
}

export interface FundMeter {
  /** Only non-zero segments, so the component never draws a zero-width sliver. */
  segments: FundMeterSegment[];
  /**
   * Where the allocated line sits, 0..100. Exactly 100 unless the fund is
   * over-committed, in which case the bar runs past it and this marks how far
   * along the club's actual grant ran out.
   */
  allocatedMarkPercent: number;
  isOverCommitted: boolean;
}

/**
 * Rounds to two decimals rather than to whole numbers.
 *
 * A $1,500 fund with an $8 request is 0.53% of the track. Rounded to integers
 * that becomes 1%, which is nearly double, and a column of such roundings no
 * longer sums to the total width. Two decimals is well below what a screen can
 * resolve and keeps the arithmetic honest.
 */
function toPercent(part: number, whole: number): number {
  if (whole <= 0) {
    return 0;
  }
  return Math.round((part / whole) * 10000) / 100;
}

/**
 * The denominator is the larger of what the club was given and what it has
 * actually laid claim to.
 *
 * Dividing by `allocatedCents` alone would be wrong in exactly the case the
 * treasury model exists to make visible: once committed plus spent exceeds the
 * grant, those segments sum past 100% and the bar either overflows its
 * container or gets silently clamped - and a clamped bar shows an
 * over-committed fund as merely "full", which is the one reading that must
 * never happen. Scaling to the true total keeps the overspend on screen, and
 * the allocated mark is what says where the money ran out.
 */
export function fundMeter(summary: FundSummary): FundMeter {
  const claimed = summary.committedCents + summary.spentCents;
  const denominator = Math.max(summary.allocatedCents, claimed);
  const isOverCommitted = summary.availableCents < 0;

  const candidates: FundMeterSegment[] = [
    {key: 'spent', percent: toPercent(summary.spentCents, denominator)},
    {key: 'committed', percent: toPercent(summary.committedCents, denominator)},
    {
      key: 'available',
      // Never negative. The overspend is already visible as committed and
      // spent running past the allocated mark; drawing it a second time as a
      // negative-width segment would double-count it.
      percent: toPercent(Math.max(summary.availableCents, 0), denominator),
    },
  ];

  return {
    segments: candidates.filter((segment) => segment.percent > 0),
    allocatedMarkPercent: toPercent(summary.allocatedCents, denominator),
    isOverCommitted,
  };
}
