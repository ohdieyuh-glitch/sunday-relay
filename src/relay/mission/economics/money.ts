/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 5
 * Exact money (PURE, deterministic, no clock, no browser).
 *
 * Financial truth is never a JavaScript float. `0.1 + 0.2` is not `0.3`, and a
 * budget that silently drifts by a fraction of a cent is a budget nobody can
 * defend. So the stored value is a base-10 INTEGER STRING of millionths of a
 * currency unit ("micros"), and every arithmetic operation goes through
 * BigInt inside these helpers before returning to a string.
 *
 * BigInt never escapes this module: the Aquala Trace canonicalizer rejects
 * BigInt outright, so anything hashed into a trace event must already be a
 * plain JSON string. That is exactly what `RelayMoney` is.
 *
 * There is NO currency conversion here, and there never will be in this
 * milestone — mixing currencies produces a typed error, not a guess.
 */

import { economicsError, economicsFail, economicsOk, type EconomicsResult } from './economics-errors';

export interface RelayMoney {
  /** Uppercase ISO-style code. Relay development fixtures use USD. */
  readonly currency: string;
  /** Base-10 integer string of millionths of one currency unit. */
  readonly amountMicros: string;
}

export const MICROS_PER_UNIT = 1_000_000n;

const CURRENCY_PATTERN = /^[A-Z]{3}$/u;
/** Optional leading '-', then digits. No '+', no exponent, no separators. */
const MICROS_PATTERN = /^-?[0-9]+$/u;

/* --------------------------------------------------------- construction */

/**
 * Validates and canonicalizes a money value. Leading zeros collapse, "-0"
 * becomes "0", and anything that is not an exact integer string is refused —
 * a decimal point, an exponent, a comma, whitespace, `NaN`, or `Infinity` all
 * fail rather than being coerced.
 *
 * Currency is normalized to uppercase; a non-ISO-shaped code is rejected
 * rather than invented.
 */
export function createMoney(currency: string, amountMicros: string): EconomicsResult<RelayMoney> {
  const normalizedCurrency = typeof currency === 'string' ? currency.trim().toUpperCase() : '';
  if (!CURRENCY_PATTERN.test(normalizedCurrency)) {
    return economicsFail(
      economicsError(
        'MONEY_INVALID_CURRENCY',
        `"${currency}" is not an ISO-style three-letter currency code`,
        'supply a three-letter uppercase currency code such as USD',
        { field: 'currency', actual: String(currency) },
      ),
    );
  }

  if (typeof amountMicros !== 'string') {
    return economicsFail(
      economicsError(
        'MONEY_INVALID_AMOUNT',
        'an amount must be an exact base-10 integer STRING of micros, never a number',
        'supply the amount as an integer string of millionths',
        { field: 'amountMicros', actual: String(amountMicros) },
      ),
    );
  }
  // No trimming: surrounding whitespace is a malformed value, not a style.
  if (!MICROS_PATTERN.test(amountMicros)) {
    return economicsFail(
      economicsError(
        'MONEY_INVALID_AMOUNT',
        `"${amountMicros}" is not an exact integer string of micros`,
        'remove any decimal point, exponent, separator, or whitespace',
        { field: 'amountMicros', actual: amountMicros },
      ),
    );
  }

  let value: bigint;
  try {
    value = BigInt(amountMicros);
  } catch {
    return economicsFail(
      economicsError(
        'MONEY_UNSAFE_PRECISION',
        `"${amountMicros}" cannot be represented exactly`,
        'supply an exact integer string of micros',
        { field: 'amountMicros', actual: amountMicros },
      ),
    );
  }

  return economicsOk(Object.freeze({ currency: normalizedCurrency, amountMicros: value.toString() }));
}

/** Convenience for fixtures and tests. Throws only on programmer error. */
export function money(currency: string, amountMicros: string): RelayMoney {
  const result = createMoney(currency, amountMicros);
  if (!result.ok) throw new Error(`invalid money literal: ${result.error.reason}`);
  return result.value;
}

export const zeroMoney = (currency: string): RelayMoney => money(currency, '0');

/* ------------------------------------------------------------ accessors */

export function toBigIntMicros(value: RelayMoney): bigint {
  return BigInt(value.amountMicros);
}

export function isZero(value: RelayMoney): boolean {
  return toBigIntMicros(value) === 0n;
}

export function isNegative(value: RelayMoney): boolean {
  return toBigIntMicros(value) < 0n;
}

/* ----------------------------------------------------------- arithmetic */

function requireSameCurrency(
  a: RelayMoney,
  b: RelayMoney,
): EconomicsResult<string> {
  if (a.currency !== b.currency) {
    return economicsFail(
      economicsError(
        'MONEY_CURRENCY_MISMATCH',
        `cannot combine ${a.currency} with ${b.currency} — Relay performs no currency conversion`,
        'record the amounts in a single currency, or keep them separate',
        { field: 'currency', expected: a.currency, actual: b.currency },
      ),
    );
  }
  return economicsOk(a.currency);
}

export function addMoney(a: RelayMoney, b: RelayMoney): EconomicsResult<RelayMoney> {
  const currency = requireSameCurrency(a, b);
  if (!currency.ok) return economicsFail(currency.error);
  return createMoney(currency.value, (toBigIntMicros(a) + toBigIntMicros(b)).toString());
}

export function subtractMoney(a: RelayMoney, b: RelayMoney): EconomicsResult<RelayMoney> {
  const currency = requireSameCurrency(a, b);
  if (!currency.ok) return economicsFail(currency.error);
  return createMoney(currency.value, (toBigIntMicros(a) - toBigIntMicros(b)).toString());
}

/** Multiplication by an INTEGER quantity only — no fractional scaling, so no
    rounding policy is needed and no precision is silently lost. */
export function multiplyMoney(value: RelayMoney, quantity: string | number): EconomicsResult<RelayMoney> {
  const raw = typeof quantity === 'number' ? String(quantity) : quantity;
  if (!MICROS_PATTERN.test(raw)) {
    return economicsFail(
      economicsError(
        'MONEY_INVALID_AMOUNT',
        `"${raw}" is not an exact integer quantity`,
        'multiply by an integer quantity; fractional rates need an explicit rate reference',
        { field: 'quantity', actual: raw },
      ),
    );
  }
  return createMoney(value.currency, (toBigIntMicros(value) * BigInt(raw)).toString());
}

/** Sums a list. An empty list is `null` — UNKNOWN, never a fabricated zero. */
export function sumMoney(values: readonly RelayMoney[]): EconomicsResult<RelayMoney | null> {
  if (values.length === 0) return economicsOk(null);
  let total = values[0];
  for (let i = 1; i < values.length; i += 1) {
    const next = addMoney(total, values[i]);
    if (!next.ok) return economicsFail(next.error);
    total = next.value;
  }
  return economicsOk(total);
}

/** -1, 0, or 1. Exact — never a float subtraction. */
export function compareMoney(a: RelayMoney, b: RelayMoney): EconomicsResult<-1 | 0 | 1> {
  const currency = requireSameCurrency(a, b);
  if (!currency.ok) return economicsFail(currency.error);
  const left = toBigIntMicros(a);
  const right = toBigIntMicros(b);
  return economicsOk(left < right ? -1 : left > right ? 1 : 0);
}

export function moneyEquals(a: RelayMoney, b: RelayMoney): boolean {
  return a.currency === b.currency && a.amountMicros === b.amountMicros;
}

/* ------------------------------------------------- threshold arithmetic */

/**
 * A fraction of an amount expressed in BASIS POINTS (10,000 = 100%), computed
 * exactly with integer maths. Percentages are never floats here: 80% of
 * $10.00 is exactly $8.00, not 7.999999999999999.
 *
 * Truncates toward zero — a threshold is reached when spend REACHES it, so
 * rounding a threshold up would let spending slip past it.
 */
export function basisPointsOf(value: RelayMoney, basisPoints: number): EconomicsResult<RelayMoney> {
  if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > 10_000) {
    return economicsFail(
      economicsError(
        'INVALID_WARNING_THRESHOLD',
        `${basisPoints} is not a valid basis-point value (0–10000)`,
        'express the threshold in basis points, where 10000 is 100%',
        { field: 'basisPoints', expected: '0..10000', actual: String(basisPoints) },
      ),
    );
  }
  const scaled = (toBigIntMicros(value) * BigInt(basisPoints)) / 10_000n;
  return createMoney(value.currency, scaled.toString());
}

/* ---------------------------------------------------------- presentation */

/**
 * Human-readable, exact, and locale-agnostic — the presentation boundary can
 * layer locale on top. Trailing micro-digits are kept only when they carry
 * information, so $2.15 renders as "$2.15" and $0.000001 as "$0.000001"
 * rather than a rounded "$0.00" that would misrepresent a real charge.
 */
export function formatMoney(value: RelayMoney): string {
  const micros = toBigIntMicros(value);
  const negative = micros < 0n;
  const absolute = negative ? -micros : micros;

  const units = absolute / MICROS_PER_UNIT;
  const fraction = absolute % MICROS_PER_UNIT;

  let fractionText = fraction.toString().padStart(6, '0').replace(/0+$/u, '');
  if (fractionText.length < 2) fractionText = fractionText.padEnd(2, '0');

  const symbol = value.currency === 'USD' ? '$' : `${value.currency} `;
  return `${negative ? '-' : ''}${symbol}${units.toString()}.${fractionText}`;
}

/** Converts a decimal string such as "2.15" into micros. Used by fixtures and
    by operator-entered values — never by provider parsing, which supplies its
    own units through an explicit rate reference. */
export function moneyFromDecimalString(
  currency: string,
  decimal: string,
): EconomicsResult<RelayMoney> {
  if (!/^-?[0-9]+(\.[0-9]{1,6})?$/u.test(decimal)) {
    return economicsFail(
      economicsError(
        'MONEY_UNSAFE_PRECISION',
        `"${decimal}" is not an exact decimal with at most six fractional digits`,
        'supply at most six decimal places, or use micros directly',
        { field: 'decimal', actual: decimal },
      ),
    );
  }
  const negative = decimal.startsWith('-');
  const [unitPart, fractionPart = ''] = decimal.replace(/^-/u, '').split('.');
  const micros =
    BigInt(unitPart) * MICROS_PER_UNIT + BigInt(fractionPart.padEnd(6, '0') || '0');
  return createMoney(currency, (negative ? -micros : micros).toString());
}
