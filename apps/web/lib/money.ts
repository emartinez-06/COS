/**
 * Turning what someone types into cents.
 *
 * The domain is integer cents everywhere (see `treasury.ts` in @cos/core), but
 * a person types dollars, so exactly one place in the browser converts between
 * them. That place is here, and it is deliberately not inlined into a form:
 * every rounding decision about a club's money should be one function with
 * tests rather than three slightly different expressions in three dialogs.
 *
 * `Math.round` is doing real work. `47.83 * 100` is `4782.999999999999` in
 * binary floating point, and truncating instead of rounding would quietly bill
 * the club $47.82. Rounding once, at the boundary, is what keeps every later sum
 * exact - after this point nothing is ever a fraction again.
 */

/** Why a typed amount was refused. */
export type MoneyParseError = 'empty' | 'not-a-number' | 'too-precise';

export interface MoneyParseResult {
  ok: boolean;
  cents: number;
  error?: MoneyParseError;
}

export const MONEY_PARSE_MESSAGES: Record<MoneyParseError, string> = {
  empty: 'Enter an amount.',
  'not-a-number': 'Enter an amount like 47.83.',
  'too-precise': 'Amounts go to the cent - 47.83, not 47.831.',
};

/**
 * Parses a typed dollar amount into whole cents.
 *
 * Accepts what people actually type: `$1,500`, `1500.00`, ` 47.83 `, and a
 * leading `-` for the reduction case on an allocation. Rejects more than two
 * decimal places rather than silently rounding them, because a treasurer typing
 * a third digit has misunderstood something and a quiet round would hide it.
 */
export function parseMoneyToCents(input: string): MoneyParseResult {
  const cleaned = input.trim().replace(/[$,\s]/g, '');

  if (cleaned === '' || cleaned === '-') {
    return {ok: false, cents: 0, error: 'empty'};
  }

  if (!/^-?\d*(\.\d*)?$/.test(cleaned) || !/\d/.test(cleaned)) {
    return {ok: false, cents: 0, error: 'not-a-number'};
  }

  const [, decimals] = cleaned.split('.');
  if (decimals !== undefined && decimals.length > 2) {
    return {ok: false, cents: 0, error: 'too-precise'};
  }

  const asNumber = Number(cleaned);
  if (!Number.isFinite(asNumber)) {
    return {ok: false, cents: 0, error: 'not-a-number'};
  }

  return {ok: true, cents: Math.round(asNumber * 100)};
}

/**
 * Cents as a plain editable string, with no currency symbol or grouping.
 *
 * For seeding a text field someone is about to edit. `formatMoney` in @cos/core
 * is the one for *display* - putting "$1,500.00" into an input and asking a
 * person to edit around the punctuation is how a typo becomes a wrong number.
 */
export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2);
}
