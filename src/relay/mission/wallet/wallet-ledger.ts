import { fail, ok, relayError, type RelayResult } from '../../protocol/errors';
import {
  isValidMoney,
  type Money,
  type WalletLedgerEntry,
  type WonderlandCurrency,
} from './wallet-contracts';

/**
 * THE LEDGER IS THE AUTHORITY.
 *
 * Balances are DERIVED here, from entries, every time. The wallet record carries
 * a cached pair of numbers for display and for cheap reads, but this function is
 * what decides what is true — and `wallet.test.ts` asserts the cache equals the
 * derivation after every operation, so the two cannot quietly separate.
 *
 * Why that matters more than it sounds: a balance field that is its own source
 * of truth will eventually be updated by one code path and not another, and the
 * discrepancy will be invisible until somebody's money is wrong. A derivation
 * cannot be forgotten, because it reads the same rows that record the spending.
 */

export interface DerivedBalance {
  readonly available: Money;
  readonly reserved: Money;
  /** available + reserved. What the account actually holds. */
  readonly total: Money;
}

/**
 * Recompute both balances from the whole entry list.
 *
 * `RESERVATION` moves money from available to reserved; `RESERVATION_RELEASE`
 * moves it back; `PURCHASE` consumes it from reserved. Keeping those three
 * distinct is what lets a failed purchase be unwound without guessing whether
 * money was spent.
 */
export function deriveBalance(
  entries: readonly WalletLedgerEntry[],
  currency: WonderlandCurrency,
): DerivedBalance {
  let available = 0;
  let reserved = 0;

  for (const entry of entries) {
    const amount = entry.amount.amountMinor;
    switch (entry.type) {
      case 'CREDIT':
      case 'REFUND':
        available += amount;
        break;
      case 'DEBIT':
        available -= amount;
        break;
      case 'RESERVATION':
        available -= amount;
        reserved += amount;
        break;
      case 'RESERVATION_RELEASE':
        reserved -= amount;
        available += amount;
        break;
      case 'PURCHASE':
        // The money was already moved out of available by the reservation. A
        // purchase settles it out of reserved, which is why a purchase without
        // a preceding reservation is refused at append time.
        reserved -= amount;
        break;
      case 'ADJUSTMENT':
        // A correction. Signed by convention on the entry's own reference text
        // rather than the amount, so an adjustment always CREDITS; a negative
        // correction is a DEBIT with an adjustment reference.
        available += amount;
        break;
    }
  }

  return {
    available: { amountMinor: available, currency },
    reserved: { amountMinor: reserved, currency },
    total: { amountMinor: available + reserved, currency },
  };
}

/* ------------------------------------------------------------- appending */

export interface LedgerAppendResult {
  readonly entries: readonly WalletLedgerEntry[];
  /** True when the key was already present and nothing was appended. */
  readonly deduplicated: boolean;
  readonly entry: WalletLedgerEntry;
}

/**
 * APPEND ONE ENTRY, IDEMPOTENTLY.
 *
 * If the idempotency key is already present, the existing entry is returned and
 * NOTHING is appended. That single behaviour is what makes a retry after a lost
 * connection safe, and it is why every commerce operation in this module routes
 * through here rather than pushing onto an array.
 *
 * The entry is also checked against the balance it would produce: a reservation
 * larger than what is available, or a purchase with no matching reservation, is
 * refused rather than recorded and reconciled later.
 */
export function appendLedgerEntry(
  entries: readonly WalletLedgerEntry[],
  entry: WalletLedgerEntry,
  currency: WonderlandCurrency,
): RelayResult<LedgerAppendResult> {
  if (!isValidMoney(entry.amount)) {
    return fail(
      relayError('validation-failed', 'A ledger amount must be a non-negative integer of minor units.', {
        details: [String(entry.amount.amountMinor)],
      }),
    );
  }
  if (entry.amount.currency !== currency) {
    return fail(
      relayError('validation-failed', 'A ledger entry must match the wallet currency.'),
    );
  }
  if (entry.idempotencyKey.trim() === '') {
    return fail(relayError('validation-failed', 'Every ledger entry needs an idempotency key.'));
  }

  const existing = entries.find((candidate) => candidate.idempotencyKey === entry.idempotencyKey);
  if (existing !== undefined) {
    // THE DOUBLE-CHARGE GUARD. Same key, same event. Return what already
    // happened rather than making it happen again.
    return ok({ entries, deduplicated: true, entry: existing });
  }

  const balance = deriveBalance(entries, currency);

  if (entry.type === 'RESERVATION' && entry.amount.amountMinor > balance.available.amountMinor) {
    return fail(
      relayError('budget-exceeded', 'This wallet does not hold enough available funds to reserve that.', {
        entityIds: { walletId: entry.walletId },
      }),
    );
  }
  if (entry.type === 'DEBIT' && entry.amount.amountMinor > balance.available.amountMinor) {
    return fail(
      relayError('budget-exceeded', 'This wallet does not hold enough available funds.', {
        entityIds: { walletId: entry.walletId },
      }),
    );
  }
  if (
    (entry.type === 'PURCHASE' || entry.type === 'RESERVATION_RELEASE') &&
    entry.amount.amountMinor > balance.reserved.amountMinor
  ) {
    // A purchase settles a reservation. Without one there is nothing to settle,
    // and recording it would silently overdraw the wallet.
    return fail(
      relayError('evidence-required', 'No matching reservation is held for that amount.', {
        entityIds: { walletId: entry.walletId, purchaseId: entry.purchaseId ?? 'none' },
      }),
    );
  }

  return ok({ entries: [...entries, entry], deduplicated: false, entry });
}

/* --------------------------------------------------------------- queries */

/** Every entry belonging to one purchase, oldest first. */
export function entriesForPurchase(
  entries: readonly WalletLedgerEntry[],
  purchaseId: string,
): readonly WalletLedgerEntry[] {
  return entries.filter((entry) => entry.purchaseId === purchaseId);
}

/** Total settled spend on a UTC day, for the daily policy limit. */
export function spentOnDay(
  entries: readonly WalletLedgerEntry[],
  dayIso: string,
  currency: WonderlandCurrency,
): Money {
  const day = dayIso.slice(0, 10);
  const total = entries
    .filter((entry) => entry.type === 'PURCHASE' && entry.occurredAtIso.slice(0, 10) === day)
    .reduce((sum, entry) => sum + entry.amount.amountMinor, 0);
  return { amountMinor: total, currency };
}

/** Total settled spend attributed to one mission, for the per-mission limit. */
export function spentOnMission(
  entries: readonly WalletLedgerEntry[],
  missionId: string,
  currency: WonderlandCurrency,
): Money {
  const total = entries
    .filter((entry) => entry.type === 'PURCHASE' && entry.missionId === missionId)
    .reduce((sum, entry) => sum + entry.amount.amountMinor, 0);
  return { amountMinor: total, currency };
}

/**
 * THE AUDIT ANSWER. Every entry that explains one spend, in order.
 *
 * This is what makes "why did Julius spend $42" answerable exactly rather than
 * approximately: the reservation, the purchase, the authorization source and the
 * mission that caused it are all rows, and they are all here.
 */
export function explainSpend(
  entries: readonly WalletLedgerEntry[],
  purchaseId: string,
): readonly string[] {
  return entriesForPurchase(entries, purchaseId).map(
    (entry) =>
      `${entry.occurredAtIso} ${entry.type} ${entry.amount.amountMinor} ` +
      `(${entry.authorizationSource}) ${entry.reference}`,
  );
}
