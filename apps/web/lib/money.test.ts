/**
 * Tests for the dollars-to-cents boundary.
 *
 * Small surface, disproportionate consequences: this is the only place in the
 * browser where a person's typing becomes an amount of the club's money, and
 * every sum after it depends on this rounding once and rounding correctly.
 */

import {describe, expect, it} from 'vitest';

import {centsToInput, parseMoneyToCents} from './money';

describe('parseMoneyToCents', () => {
  it('converts whole dollars', () => {
    expect(parseMoneyToCents('1500')).toEqual({ok: true, cents: 150_000});
  });

  it('converts dollars and cents', () => {
    expect(parseMoneyToCents('47.83')).toEqual({ok: true, cents: 4_783});
  });

  it('rounds rather than truncating the float', () => {
    // `47.83 * 100` is 4782.999999999999 in binary floating point. Truncating
    // would quietly bill the club a cent less, and every later total inherits
    // the error.
    expect(parseMoneyToCents('47.83').cents).toBe(4_783);
    expect(parseMoneyToCents('0.07').cents).toBe(7);
    expect(parseMoneyToCents('1.10').cents).toBe(110);
    expect(parseMoneyToCents('8.29').cents).toBe(829);
  });

  it('accepts what people actually paste', () => {
    expect(parseMoneyToCents('$1,500.00').cents).toBe(150_000);
    expect(parseMoneyToCents('  47.83  ').cents).toBe(4_783);
    expect(parseMoneyToCents('.5').cents).toBe(50);
    expect(parseMoneyToCents('12.').cents).toBe(1_200);
  });

  it('accepts a negative, which is how a fund reduction is recorded', () => {
    expect(parseMoneyToCents('-500').cents).toBe(-50_000);
  });

  it('refuses an empty amount', () => {
    expect(parseMoneyToCents('').error).toBe('empty');
    expect(parseMoneyToCents('   ').error).toBe('empty');
    expect(parseMoneyToCents('-').error).toBe('empty');
  });

  it('refuses anything that is not a number', () => {
    for (const input of ['abc', '1.2.3', '12abc', '--5', '1e5', '$']) {
      expect(parseMoneyToCents(input).ok, input).toBe(false);
    }
  });

  it('refuses more than two decimal places rather than rounding them away', () => {
    // A third digit means the person has misunderstood something. Silently
    // rounding hides that; refusing surfaces it while they are still looking.
    const result = parseMoneyToCents('47.831');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('too-precise');
  });

  it('never returns a fractional cent', () => {
    for (const input of ['0.01', '999999.99', '-0.01', '3.5']) {
      const {cents} = parseMoneyToCents(input);
      expect(Number.isInteger(cents), input).toBe(true);
    }
  });
});

describe('centsToInput', () => {
  it('renders a plain editable string with no currency furniture', () => {
    // Deliberately not `formatMoney` - putting "$1,500.00" into a text field
    // and asking someone to edit around the punctuation is how a typo becomes a
    // wrong number.
    expect(centsToInput(150_000)).toBe('1500.00');
    expect(centsToInput(4_783)).toBe('47.83');
    expect(centsToInput(0)).toBe('0.00');
  });

  it('round-trips through the parser', () => {
    for (const cents of [0, 1, 999, 4_783, 150_000, 99_999_999]) {
      expect(parseMoneyToCents(centsToInput(cents)).cents).toBe(cents);
    }
  });
});
