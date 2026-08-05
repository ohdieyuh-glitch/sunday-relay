/**
 * SUNDAY RELAY — PROJECT BRAIN LLMOPS
 * Tokens and cost, CITED from `../economics` rather than recomputed.
 *
 * The operations view names six things: tokens, cost, latency, errors, health
 * and evaluations. Four of them are modelled here. The other two — tokens and
 * money — already have a careful model next door, with receipts, statuses,
 * cost classes, sources and an explicit unknown discipline. This module reads
 * that model and reports it. It does not add up a second opinion.
 *
 * That distinction is the whole reason this file is small. A second summation
 * of the same receipts would eventually disagree with the first, and the two
 * numbers would be equally plausible on screen.
 *
 * WHAT IT REFUSES.
 *
 * - **To turn an unknown amount into zero.** A pending receipt has
 *   `amount: null`. It is counted as a receipt whose cost is not yet known, and
 *   the count is reported beside the total so a small total cannot be read as a
 *   cheap run.
 * - **To add estimated to actual.** They are different facts. A projected cost
 *   and a billed one are reported separately and never summed together.
 * - **To count a voided or disputed receipt as spend.** Those are records of
 *   something that did not stand.
 * - **To mix currencies.** Sums are per-currency; a receipt in another currency
 *   is reported in its own bucket rather than converted at an invented rate.
 * - **To let a fixture look like a bill.** Receipts sourced from
 *   `development_fixture` are counted separately and labelled.
 * - **To drop a refund.** `adjustment` is the ONE category permitted to carry a
 *   negative amount, so it is how this repository records a credit or a
 *   correction. Excluding it made every refund invisible and every total too
 *   high. It counts. Anything else excluded by category is COUNTED and
 *   reported, so a total can never quietly omit a receipt.
 */

import type {
  RelayCostReceipt, RelayReceiptQuantityUnit,
} from '../economics/cost-receipt-types';
import { PROVIDER_SPEND_CATEGORIES } from '../economics/cost-receipt-types';
import type { RelayCostCategory } from '../economics/cost-receipt-types';
import type { RelayMoney } from '../economics/money';

/* ---------------------------------------------------------------- tokens */

/**
 * Categories that belong in a SPEND total: provider spend, plus `adjustment`,
 * which is the only category allowed a negative amount and therefore the only
 * way a credit or correction is recorded. Human time is valued separately and
 * stays out.
 */
const SPEND_CATEGORIES: readonly RelayCostCategory[] = Object.freeze([
  ...PROVIDER_SPEND_CATEGORIES, 'adjustment',
]);

/** The three units that are tokens. Everything else is time, calls or runs. */
export const TOKEN_UNITS: readonly RelayReceiptQuantityUnit[] = Object.freeze([
  'input_token',
  'output_token',
  'cached_input_token',
]);

export interface RelayTokenTotals {
  /** Exact integer strings — token counts are never floats and never rounded. */
  readonly input: string;
  readonly output: string;
  readonly cachedInput: string;
  readonly total: string;
  /** Receipts that recorded a token unit whose value could not be read. */
  readonly unreadable: number;
}

/* ------------------------------------------------------------------ cost */

export interface RelayCurrencyTotal {
  readonly currency: string;
  /** Base-10 integer string of millionths. */
  readonly amountMicros: string;
  readonly receipts: number;
}

export interface RelaySpendCitation {
  readonly tokens: RelayTokenTotals;
  /** Billed or provider-reported spend that STANDS. Per currency. */
  readonly actual: readonly RelayCurrencyTotal[];
  /** Projections. Never added to `actual`. */
  readonly estimated: readonly RelayCurrencyTotal[];
  /** Receipts with no amount yet. Reported, never zeroed. */
  readonly amountUnknown: number;
  /** Receipts whose amount exists but could not be read. Not the same fact. */
  readonly amountUnreadable: number;
  /** Receipts excluded from the total by category — human time, chiefly. */
  readonly excludedByCategory: number;
  /** Receipts excluded because they did not stand. */
  readonly voidedOrDisputed: number;
  /** Receipts whose source is a development fixture. Never a bill. */
  readonly fixtureSourced: number;
  readonly receiptsRead: number;
}

const emptyTokens = (): RelayTokenTotals => ({
  input: '0', output: '0', cachedInput: '0', total: '0', unreadable: 0,
});

export function emptySpendCitation(): RelaySpendCitation {
  return {
    tokens: emptyTokens(),
    actual: [],
    estimated: [],
    amountUnknown: 0,
    amountUnreadable: 0,
    excludedByCategory: 0,
    voidedOrDisputed: 0,
    fixtureSourced: 0,
    receiptsRead: 0,
  };
}

/** An exact non-negative integer string, or null. Token counts never round. */
function readIntegerString(value: string | undefined): bigint | null {
  if (typeof value !== 'string' || !/^-?[0-9]+$/u.test(value.trim())) return null;
  return BigInt(value.trim());
}

function readMicros(amount: RelayMoney | null | undefined): bigint | null {
  if (amount === null || amount === undefined) return null;
  if (typeof amount.amountMicros !== 'string' || !/^-?[0-9]+$/u.test(amount.amountMicros)) {
    return null;
  }
  if (typeof amount.currency !== 'string' || !/^[A-Z]{3}$/u.test(amount.currency)) return null;
  return BigInt(amount.amountMicros);
}

/**
 * Read a project's receipts into the figures the operations view reports.
 *
 * Pure, and total: a malformed receipt reduces what is KNOWN rather than
 * throwing, because an operations surface that goes blank when one row is odd
 * is less useful than one that says "nine of ten".
 */
export function citeSpend(receipts: readonly RelayCostReceipt[]): RelaySpendCitation {
  let input = 0n;
  let output = 0n;
  let cachedInput = 0n;
  let unreadable = 0;
  let amountUnknown = 0;
  let amountUnreadable = 0;
  let excludedByCategory = 0;
  let voidedOrDisputed = 0;
  let fixtureSourced = 0;

  const actual = new Map<string, { micros: bigint; receipts: number }>();
  const estimated = new Map<string, { micros: bigint; receipts: number }>();

  for (const receipt of receipts) {
    // Tokens are counted from every receipt that recorded them, including ones
    // whose money is still unknown: the tokens WERE spent even if the bill has
    // not landed.
    const quantity = receipt.quantity;
    if (quantity !== undefined && TOKEN_UNITS.includes(quantity.unit)) {
      const value = readIntegerString(quantity.value);
      if (value === null) unreadable += 1;
      else if (quantity.unit === 'input_token') input += value;
      else if (quantity.unit === 'output_token') output += value;
      else cachedInput += value;
    }

    if (receipt.source === 'development_fixture') fixtureSourced += 1;

    // A voided or disputed receipt is a record of something that did not
    // stand. It is counted and excluded, never silently dropped.
    if (receipt.status === 'voided' || receipt.status === 'disputed') {
      voidedOrDisputed += 1;
      continue;
    }

    // Human time is valued separately and never mixed into provider spend —
    // but it is COUNTED, so a total never quietly omits a receipt.
    if (!SPEND_CATEGORIES.includes(receipt.category)) {
      excludedByCategory += 1;
      continue;
    }

    const micros = readMicros(receipt.amount);
    if (micros === null) {
      // A receipt that HAS an amount which cannot be read is a different fact
      // from one that has none yet, and "no cost recorded yet" would be the
      // wrong sentence for it.
      if (receipt.amount === null || receipt.amount === undefined) amountUnknown += 1;
      else amountUnreadable += 1;
      continue;
    }

    const bucket = receipt.costClass === 'actual' ? actual : estimated;
    const currency = receipt.amount!.currency;
    const entry = bucket.get(currency) ?? { micros: 0n, receipts: 0 };
    entry.micros += micros;
    entry.receipts += 1;
    bucket.set(currency, entry);
  }

  const totals = (bucket: Map<string, { micros: bigint; receipts: number }>) =>
    [...bucket]
      .map(([currency, v]) => ({
        currency, amountMicros: v.micros.toString(), receipts: v.receipts,
      }))
      .sort((a, b) => a.currency.localeCompare(b.currency));

  return {
    tokens: {
      input: input.toString(),
      output: output.toString(),
      cachedInput: cachedInput.toString(),
      total: (input + output + cachedInput).toString(),
      unreadable,
    },
    actual: totals(actual),
    estimated: totals(estimated),
    amountUnknown,
    amountUnreadable,
    excludedByCategory,
    voidedOrDisputed,
    fixtureSourced,
    receiptsRead: receipts.length,
  };
}

/**
 * Money as text, from micros, without floating point.
 *
 * `Number(micros) / 1e6` loses exactness above 2^53 micros — about nine billion
 * currency units — and more importantly makes the rounding invisible. This
 * divides the integer, and ROUNDS HALF AWAY FROM ZERO rather than truncating:
 * truncation printed 999999 micros as `0.99`, understating every total by up to
 * a cent while looking exact.
 */
export function formatMicros(currency: string, amountMicros: string): string {
  if (!/^-?[0-9]+$/u.test(amountMicros)) return `${currency} —`;
  const value = BigInt(amountMicros);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  // Round to cents on the integer: add half a cent, then divide.
  const cents = (absolute + 5_000n) / 10_000n;
  const units = cents / 100n;
  const fraction = (cents % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${currency} ${units.toString()}.${fraction}`;
}
