/**
 * Conversions between the domain's ISO instants and Astryx's date inputs.
 *
 * Two representations are in play and mixing them up is the classic source of
 * off-by-one-day bugs:
 *
 * - `@cos/core` stores instants as full ISO 8601 *with* an offset, so an event
 *   means the same moment regardless of who loads it.
 * - Astryx `DateTimeInput` speaks offset-free local wall-clock time,
 *   `YYYY-MM-DDTHH:mm` - what the officer literally typed.
 *
 * Everything crossing that boundary goes through this module.
 */

/** Astryx brands its datetime strings; this is the cast, in one place. */
type AstryxDateTime = string & {readonly __brand: 'ISODateTimeString'};

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * Full ISO instant to the local wall-clock string the input expects.
 * Returns undefined for empty input so it can feed an optional `value` prop.
 */
export function toInputValue(iso: string | undefined): AstryxDateTime | undefined {
  if (!iso) {
    return undefined;
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  const local =
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return local as AstryxDateTime;
}

/**
 * Local wall-clock string back to a full ISO instant.
 *
 * `new Date('2026-08-14T18:00')` is interpreted in the *local* zone by every
 * modern engine (unlike the date-only form, which is treated as UTC), which is
 * exactly the reading we want: 6pm means 6pm where the officer is.
 */
export function fromInputValue(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return date.toISOString();
}

/** Adds hours to an ISO instant, returning a new ISO instant. */
export function addHours(iso: string, hours: number): string {
  return new Date(new Date(iso).getTime() + hours * 3600_000).toISOString();
}

/** `6:00 PM` */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** `Thursday, August 14` */
export function formatDayLong(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

/** `August 2026` */
export function formatMonthYear(date: Date): string {
  return date.toLocaleDateString('en-US', {month: 'long', year: 'numeric'});
}

/** Start of the given date's month, local time. */
export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/** `offset` months from `date`, clamped to the 1st to avoid month-end skew. */
export function addMonths(date: Date, offset: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + offset, 1);
}

/**
 * The 42 days (6 weeks) covering a month grid, starting on Sunday.
 *
 * A fixed six-week grid keeps the calendar's height stable as the user pages
 * between months, which matters more than avoiding a trailing empty row.
 */
export function buildMonthGrid(month: Date): Date[] {
  const first = startOfMonth(month);
  const gridStart = new Date(
    first.getFullYear(),
    first.getMonth(),
    1 - first.getDay(),
  );
  return Array.from({length: 42}, (_, index) => {
    return new Date(
      gridStart.getFullYear(),
      gridStart.getMonth(),
      gridStart.getDate() + index,
    );
  });
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

export const WEEKDAY_LABELS = [
  'Sun',
  'Mon',
  'Tue',
  'Wed',
  'Thu',
  'Fri',
  'Sat',
] as const;
