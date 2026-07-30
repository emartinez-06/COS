/**
 * The zone boundary is the whole point of this module, so these tests run in a
 * pinned zone (America/Chicago, set in vitest.config.mts) and assert against
 * literal strings rather than against values recomputed from the same local
 * getters the code uses. A test that builds its expectation the way the
 * implementation does cannot catch an off-by-one-day.
 */

import {describe, expect, it} from 'vitest';

import {
  addHours,
  addMonths,
  buildMonthGrid,
  formatDayLong,
  formatMonthYear,
  formatTime,
  fromInputValue,
  isSameDay,
  isSameMonth,
  startOfMonth,
  toInputValue,
  WEEKDAY_LABELS,
} from './datetime';

describe('the pinned test zone', () => {
  it('is Central time, so the rest of these expectations mean something', () => {
    // Sanity check with teeth: if the zone is not what the file below assumes,
    // every date expectation here is silently testing something else.
    expect(new Date('2026-08-14T18:00:00.000Z').getHours()).toBe(13); // CDT, -5
    expect(new Date('2026-01-14T18:00:00.000Z').getHours()).toBe(12); // CST, -6
  });
});

describe('toInputValue', () => {
  it('renders a UTC instant as local wall-clock time', () => {
    // 23:00Z in August is 18:00 in Central. Getting this backwards is the
    // classic bug: the officer typed 6pm and must see 6pm again on reopen.
    expect(toInputValue('2026-08-14T23:00:00.000Z')).toBe('2026-08-14T18:00');
  });

  it('shifts the date, not just the clock, when local time is the day before', () => {
    // 02:00Z on the 15th is 21:00 on the 14th in Central. An implementation
    // that formatted the UTC date with local hours would print the 15th.
    expect(toInputValue('2026-08-15T02:00:00.000Z')).toBe('2026-08-14T21:00');
  });

  it('zero-pads every component', () => {
    expect(toInputValue('2026-01-05T15:07:00.000Z')).toBe('2026-01-05T09:07');
  });

  it('returns undefined for empty input, so it can feed an optional value prop', () => {
    expect(toInputValue(undefined)).toBeUndefined();
    expect(toInputValue('')).toBeUndefined();
  });

  it('returns undefined rather than "NaN-NaN-NaN" for an unparseable instant', () => {
    expect(toInputValue('not a date')).toBeUndefined();
  });
});

describe('fromInputValue', () => {
  it('reads the offset-free input as local time, not UTC', () => {
    // The whole reason this function exists. `new Date('2026-08-14T18:00')` is
    // local by spec; the date-only form would be UTC.
    expect(fromInputValue('2026-08-14T18:00')).toBe('2026-08-14T23:00:00.000Z');
  });

  it('uses the standard-time offset in winter', () => {
    expect(fromInputValue('2026-01-14T18:00')).toBe('2026-01-15T00:00:00.000Z');
  });

  it('round-trips with toInputValue', () => {
    const typed = '2026-11-02T09:30';
    expect(toInputValue(fromInputValue(typed))).toBe(typed);
  });

  it('returns undefined for empty or unparseable input', () => {
    expect(fromInputValue(undefined)).toBeUndefined();
    expect(fromInputValue('')).toBeUndefined();
    expect(fromInputValue('whenever')).toBeUndefined();
  });
});

describe('addHours', () => {
  it('adds to the instant', () => {
    expect(addHours('2026-08-14T23:00:00.000Z', 2)).toBe(
      '2026-08-15T01:00:00.000Z',
    );
  });

  it('accepts negative hours', () => {
    expect(addHours('2026-08-14T23:00:00.000Z', -1)).toBe(
      '2026-08-14T22:00:00.000Z',
    );
  });

  it('adds real hours across a spring-forward, so local time jumps two', () => {
    // 2026-03-08 01:30 Central is 07:30Z. One real hour later is 08:30Z, which
    // is 03:30 local - 02:30 never happens. Instant arithmetic is the correct
    // reading for "an event that starts at 1:30am and runs an hour".
    const oneThirtyAm = fromInputValue('2026-03-08T01:30');
    expect(oneThirtyAm).toBe('2026-03-08T07:30:00.000Z');
    expect(toInputValue(addHours(oneThirtyAm!, 1))).toBe('2026-03-08T03:30');
  });
});

describe('formatTime', () => {
  it('formats the local time of the instant', () => {
    expect(formatTime('2026-08-14T23:00:00.000Z')).toBe('6:00 PM');
  });

  it('uses a 12-hour clock with a padded minute', () => {
    expect(formatTime('2026-08-14T14:05:00.000Z')).toBe('9:05 AM');
  });
});

describe('formatDayLong and formatMonthYear', () => {
  it('formats a day as weekday, month, and date', () => {
    expect(formatDayLong(new Date(2026, 7, 14))).toBe('Friday, August 14');
  });

  it('formats a month and year', () => {
    expect(formatMonthYear(new Date(2026, 7, 14))).toBe('August 2026');
  });
});

describe('startOfMonth', () => {
  it('returns local midnight on the 1st', () => {
    const start = startOfMonth(new Date(2026, 7, 14, 18, 30));
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(7);
    expect(start.getDate()).toBe(1);
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
  });
});

describe('addMonths', () => {
  it('moves forward and back', () => {
    expect(formatMonthYear(addMonths(new Date(2026, 7, 14), 1))).toBe(
      'September 2026',
    );
    expect(formatMonthYear(addMonths(new Date(2026, 7, 14), -1))).toBe(
      'July 2026',
    );
  });

  it('crosses a year boundary in both directions', () => {
    expect(formatMonthYear(addMonths(new Date(2026, 11, 14), 1))).toBe(
      'January 2027',
    );
    expect(formatMonthYear(addMonths(new Date(2026, 0, 14), -1))).toBe(
      'December 2025',
    );
  });

  it('does not skip February when paging from the 31st', () => {
    // The reason it clamps to the 1st. `new Date(2026, 0, 31)` plus one month
    // naively is Feb 31, which the constructor rolls over into March, so the
    // user would page January -> March and never see February.
    expect(formatMonthYear(addMonths(new Date(2026, 0, 31), 1))).toBe(
      'February 2026',
    );
  });
});

describe('buildMonthGrid', () => {
  it('always returns six weeks, so the calendar height does not jump', () => {
    // February 2026 starts on a Sunday and has 28 days, so it fits in exactly
    // four weeks. The grid pads it anyway, on purpose.
    expect(buildMonthGrid(new Date(2026, 1, 1))).toHaveLength(42);
    expect(buildMonthGrid(new Date(2026, 7, 1))).toHaveLength(42);
  });

  it('starts on the Sunday on or before the 1st', () => {
    // August 2026 starts on a Saturday, so the grid opens on July 26.
    const grid = buildMonthGrid(new Date(2026, 7, 1));
    expect(grid[0]!.getDay()).toBe(0);
    expect(formatDayLong(grid[0]!)).toBe('Sunday, July 26');
  });

  it('starts on the 1st itself when the month begins on a Sunday', () => {
    const grid = buildMonthGrid(new Date(2026, 1, 1));
    expect(formatDayLong(grid[0]!)).toBe('Sunday, February 1');
  });

  it('runs 42 consecutive days with no gap or repeat across a DST change', () => {
    // March 2026 contains the spring-forward. Building days by incrementing a
    // local date component (rather than adding 24h of milliseconds) is what
    // keeps every cell at local midnight through the transition.
    const grid = buildMonthGrid(new Date(2026, 2, 1));
    for (const [index, day] of grid.entries()) {
      expect(day.getHours()).toBe(0);
      if (index > 0) {
        const previous = grid[index - 1]!;
        const elapsed = day.getTime() - previous.getTime();
        // 23h on the spring-forward day, 24h otherwise - and never 0 or 48.
        expect(elapsed).toBeGreaterThanOrEqual(23 * 3600_000);
        expect(elapsed).toBeLessThanOrEqual(25 * 3600_000);
        expect(day.getDate()).not.toBe(previous.getDate());
      }
    }
    expect(formatDayLong(grid[41]!)).toBe('Saturday, April 11');
  });

  it('covers every day of the month it was asked for', () => {
    const grid = buildMonthGrid(new Date(2026, 7, 1));
    const august = grid.filter((day) => day.getMonth() === 7);
    expect(august).toHaveLength(31);
  });
});

describe('isSameDay and isSameMonth', () => {
  it('compares the calendar day, not the instant', () => {
    expect(isSameDay(new Date(2026, 7, 14, 0, 1), new Date(2026, 7, 14, 23, 59))).toBe(
      true,
    );
    expect(isSameDay(new Date(2026, 7, 14), new Date(2026, 7, 15))).toBe(false);
  });

  it('does not confuse the same day number in different months or years', () => {
    expect(isSameDay(new Date(2026, 7, 14), new Date(2026, 8, 14))).toBe(false);
    expect(isSameDay(new Date(2025, 7, 14), new Date(2026, 7, 14))).toBe(false);
    expect(isSameMonth(new Date(2025, 7, 1), new Date(2026, 7, 1))).toBe(false);
  });

  it('treats any two days in the same month and year as the same month', () => {
    expect(isSameMonth(new Date(2026, 7, 1), new Date(2026, 7, 31))).toBe(true);
  });
});

describe('WEEKDAY_LABELS', () => {
  it('is Sunday-first, matching the grid buildMonthGrid produces', () => {
    expect(WEEKDAY_LABELS).toHaveLength(7);
    expect(WEEKDAY_LABELS[0]).toBe('Sun');
    const grid = buildMonthGrid(new Date(2026, 7, 1));
    expect(grid[0]!.getDay()).toBe(0);
  });
});
