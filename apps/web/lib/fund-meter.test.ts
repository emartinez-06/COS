import {describe, expect, it} from 'vitest';
import type {FundSummary} from '@cos/core';

import {fundMeter} from './fund-meter';

/**
 * `summarizeFund` is what produces these in the product; building them by hand
 * here keeps the meter's arithmetic isolated from the fold's.
 */
function summary(
  allocatedCents: number,
  committedCents: number,
  spentCents: number,
): FundSummary {
  return {
    allocatedCents,
    committedCents,
    spentCents,
    availableCents: allocatedCents - committedCents - spentCents,
  };
}

function percentOf(meter: ReturnType<typeof fundMeter>, key: string): number {
  return meter.segments.find((segment) => segment.key === key)?.percent ?? 0;
}

describe('fundMeter', () => {
  it('splits a healthy fund into three segments that fill the track', () => {
    const meter = fundMeter(summary(150000, 88550, 47830));

    expect(percentOf(meter, 'spent')).toBeCloseTo(31.89, 2);
    expect(percentOf(meter, 'committed')).toBeCloseTo(59.03, 2);
    expect(percentOf(meter, 'available')).toBeCloseTo(9.08, 2);
    expect(meter.isOverCommitted).toBe(false);
  });

  it('sums to the full track when nothing is over-committed', () => {
    const meter = fundMeter(summary(150000, 88550, 47830));
    const total = meter.segments.reduce((sum, s) => sum + s.percent, 0);

    // Two-decimal rounding, so allow a hair of drift rather than demanding
    // exactly 100 - the point is that no width is unaccounted for.
    expect(total).toBeCloseTo(100, 1);
  });

  it('puts the allocated mark at the end of the track when money is left', () => {
    expect(fundMeter(summary(150000, 88550, 47830)).allocatedMarkPercent).toBe(
      100,
    );
  });

  /**
   * The case the whole model exists for. Dividing by allocated alone would put
   * committed plus spent past 100% and either overflow the container or clamp
   * - and a clamped bar renders an over-committed fund as merely full.
   */
  it('scales to the real total when the fund is over-committed', () => {
    const meter = fundMeter(summary(100000, 90000, 30000));
    const total = meter.segments.reduce((sum, s) => sum + s.percent, 0);

    expect(meter.isOverCommitted).toBe(true);
    expect(total).toBeCloseTo(100, 1);
    expect(percentOf(meter, 'available')).toBe(0);
  });

  it('marks where an over-committed fund actually ran out', () => {
    // $1,000 granted, $1,200 claimed - the grant covers five sixths of it.
    const meter = fundMeter(summary(100000, 90000, 30000));

    expect(meter.allocatedMarkPercent).toBeCloseTo(83.33, 2);
  });

  it('never draws a negative available segment', () => {
    const meter = fundMeter(summary(100000, 90000, 30000));

    for (const segment of meter.segments) {
      expect(segment.percent).toBeGreaterThan(0);
    }
  });

  it('omits zero-width segments rather than drawing slivers', () => {
    const meter = fundMeter(summary(150000, 0, 0));

    expect(meter.segments.map((segment) => segment.key)).toEqual(['available']);
  });

  it('survives a fund with no allocation and nothing claimed', () => {
    const meter = fundMeter(summary(0, 0, 0));

    expect(meter.segments).toEqual([]);
    expect(meter.allocatedMarkPercent).toBe(0);
    expect(meter.isOverCommitted).toBe(false);
  });

  /**
   * A fund whose grant was cut to nothing while requests were already in
   * flight. There is no allocation to divide by, so the denominator has to
   * come from what was claimed or every width is zero and the bar lies.
   */
  it('handles money claimed against a fund with no allocation', () => {
    const meter = fundMeter(summary(0, 5000, 0));

    expect(percentOf(meter, 'committed')).toBe(100);
    expect(meter.allocatedMarkPercent).toBe(0);
    expect(meter.isOverCommitted).toBe(true);
  });

  it('keeps a small request visible rather than rounding it away', () => {
    // $8 against $1,500 is 0.53% - rounding to whole numbers would report 1%.
    const meter = fundMeter(summary(150000, 800, 0));

    expect(percentOf(meter, 'committed')).toBeCloseTo(0.53, 2);
  });
});
