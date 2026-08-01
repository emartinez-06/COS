/**
 * Small display formatters that are not about time.
 */

const UNITS = ['bytes', 'KB', 'MB', 'GB'] as const;

/**
 * A byte count as something a person reads at a glance: `2.4 MB`.
 *
 * Decimal units rather than binary ones (KB = 1000, not 1024), because this
 * number sits next to a download link and the reader is comparing it against
 * what their operating system and their email client told them the same file
 * was. Being consistent with those beats being technically precise about a
 * distinction nobody is making here.
 *
 * Whole bytes below 1 KB and one decimal place above it: `950 bytes` and
 * `2.4 MB` are useful, `2.4382 MB` is noise.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '';
  }
  if (bytes < 1000) {
    return `${Math.round(bytes)} bytes`;
  }

  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }

  // `1.0 MB` reads as a rounded-off measurement where `1 MB` reads as a size,
  // so a trailing zero is dropped.
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)} ${
    UNITS[unit]
  }`;
}
