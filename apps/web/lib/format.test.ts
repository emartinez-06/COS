import {describe, expect, it} from 'vitest';

import {formatBytes} from './format';

describe('formatBytes', () => {
  it('shows whole bytes below a kilobyte', () => {
    expect(formatBytes(0)).toBe('0 bytes');
    expect(formatBytes(950)).toBe('950 bytes');
  });

  it('steps up through decimal units', () => {
    expect(formatBytes(1000)).toBe('1 KB');
    expect(formatBytes(2_400_000)).toBe('2.4 MB');
    expect(formatBytes(3_200_000_000)).toBe('3.2 GB');
  });

  it('drops a trailing zero, because `1 MB` is a size and `1.0 MB` is a measurement', () => {
    expect(formatBytes(1_000_000)).toBe('1 MB');
  });

  it('stops at gigabytes rather than inventing a unit', () => {
    // The hub refuses anything over 25 MB, so this only ever comes up on a
    // number that is wrong; running off the end of the unit list would be
    // worse than a large one.
    expect(formatBytes(5_000_000_000_000)).toBe('5000 GB');
  });

  it('says nothing rather than something wrong for a nonsense size', () => {
    expect(formatBytes(-1)).toBe('');
    expect(formatBytes(Number.NaN)).toBe('');
  });
});
