import { fail, ok, relayError, type RelayResult } from '../../protocol/errors';
import {
  formatMoney,
  type Money,
  type PurchaseIntent,
  type PurchaseQuote,
  type PurchaseReceipt,
  type PurchaseState,
  type RightsClassification,
  type WalletAuthorizationSource,
  type WalletLedgerEntry,
  type WonderlandWalletDraft,
} from './wallet-contracts';
import { appendLedgerEntry, deriveBalance, entriesForPurchase } from './wallet-ledger';
import { evaluateSpendingPolicy, type PolicyDecision } from './wallet-policy';

/**
 * THE PURCHASE FLOW.
 *
 *   REQUEST -> QUOTE -> POLICY -> BALANCE -> RESERVE -> SUBMIT -> COMMIT -> RECEIPT
 *
 * with a release path at every failure and a reconciliation path for the one
 * state where the outcome is genuinely unknown.
 *
 * THE STATE THIS MODULE IS BUILT AROUND IS `SUBMITTED`. The request reached the
 * merchant and the answer never came back. A resumed mission must ASK THE
 * PROVIDER what happened — it may not retry, and it may not assume failure and
 * release the funds either, because both of those are guesses about somebody's
 * money. `reconcileSubmittedPurchase` is the only way out of that state, and it
 * demands an authoritative answer as an argument.
 *
 * Every mutation returns the new intent AND the new ledger, so a caller persists
 * both together or neither. Splitting them would create a window in which money
 * was reserved but no intent recorded it.
 */

const LEGAL_PURCHASE_EDGES: Readonly<Record<PurchaseState, readonly PurchaseState[]>> =
  Object.freeze({
    NOT_STARTED: ['AUTHORIZED', 'FAILED'],
    AUTHORIZED: ['FUNDS_RESERVED', 'FAILED'],
    FUNDS_RESERVED: ['SUBMITTED', 'FAILED'],
    SUBMITTED: ['PURCHASED', 'FAILED'],
    PURCHASED: ['REFUNDED'],
    FAILED: [],
    REFUNDED: [],
  });

export function isLegalPurchaseTransition(from: PurchaseState, to: PurchaseState): boolean {
  return LEGAL_PURCHASE_EDGES[from].includes(to);
}

export interface PurchaseStep {
  readonly intent: PurchaseIntent;
  readonly entries: readonly WalletLedgerEntry[];
}

function advance(
  intent: PurchaseIntent,
  to: PurchaseState,
  atIso: string,
  patch: Partial<PurchaseIntent> = {},
): RelayResult<PurchaseIntent> {
  if (!isLegalPurchaseTransition(intent.state, to)) {
    return fail(
      relayError('illegal-transition', `A purchase cannot go from ${intent.state} to ${to}.`, {
        entityIds: { purchaseId: intent.purchaseId },
      }),
    );
  }
  return ok({ ...intent, ...patch, state: to, updatedAtIso: atIso });
}

/** Only the owning account may touch a wallet. Checked before everything else. */
export function assertWalletOwner(
  wallet: WonderlandWalletDraft,
  requesterUserId: string,
): RelayResult<null> {
  if (wallet.ownerUserId !== requesterUserId) {
    return fail(
      relayError('permission-denied', 'A wallet may only be used by the account that owns it.', {
        entityIds: { walletId: wallet.walletId, requesterUserId },
      }),
    );
  }
  return ok(null);
}

/* ------------------------------------------------------------- authorize */

export interface AuthorizePurchaseInput {
  readonly purchaseId: string;
  readonly wallet: WonderlandWalletDraft;
  readonly requesterUserId: string;
  readonly quote: PurchaseQuote;
  readonly rights: RightsClassification;
  readonly entries: readonly WalletLedgerEntry[];
  readonly missionId: string | null;
  readonly projectId: string | null;
  readonly creationId: string | null;
  readonly idempotencyKey: string;
  readonly nowIso: string;
  /** Set when a human already approved this exact total. */
  readonly humanApproval?: { readonly approvedByUserId: string; readonly approvedTotal: Money } | null;
}

export type AuthorizeOutcome =
  | { readonly kind: 'authorized'; readonly intent: PurchaseIntent; readonly decision: PolicyDecision }
  | { readonly kind: 'requires_human'; readonly decision: PolicyDecision }
  | { readonly kind: 'refused'; readonly decision: PolicyDecision };

/**
 * POLICY FIRST, THEN BALANCE. Both must pass.
 *
 * A human approval, when present, satisfies the POLICY question only — it never
 * conjures funds, and the balance check still runs. It is also matched against
 * the exact total that was approved: a user who approved $32 has not approved
 * $90, and a quote that moved after approval is refused rather than charged.
 */
export function authorizePurchase(input: AuthorizePurchaseInput): RelayResult<AuthorizeOutcome> {
  const owned = assertWalletOwner(input.wallet, input.requesterUserId);
  if (!owned.ok) return owned;

  const approval = input.humanApproval ?? null;
  let decision: PolicyDecision;
  let source: WalletAuthorizationSource;

  if (approval !== null) {
    // AN APPROVAL IS FOR AN AMOUNT, NOT FOR A PURCHASE IN GENERAL.
    if (approval.approvedTotal.amountMinor !== input.quote.total.amountMinor) {
      return fail(
        relayError(
          'validation-failed',
          `The price changed after approval: ${formatMoney(approval.approvedTotal)} was approved, this quote is ${formatMoney(input.quote.total)}. A new authorization is required.`,
          { entityIds: { purchaseId: input.purchaseId } },
        ),
      );
    }
    decision = { outcome: 'permitted', detail: `Approved by ${approval.approvedByUserId}.` };
    source = 'user_approved';
  } else {
    decision = evaluateSpendingPolicy({
      policy: input.wallet.policy,
      quote: input.quote,
      rights: input.rights,
      entries: input.entries,
      currency: input.wallet.currency,
      missionId: input.missionId,
      nowIso: input.nowIso,
      walletActive: input.wallet.status === 'ACTIVE',
    });
    source = 'julius_autonomous';
    if (decision.outcome === 'requires_human') return ok({ kind: 'requires_human', decision });
    if (decision.outcome === 'refused') return ok({ kind: 'refused', decision });
  }

  // Funds are checked even for an approved purchase. Permission is not money.
  const balance = deriveBalance(input.entries, input.wallet.currency);
  if (input.quote.total.amountMinor > balance.available.amountMinor) {
    return ok({
      kind: 'refused',
      decision: {
        outcome: 'refused',
        reason: 'over_per_transaction_limit',
        detail:
          `This wallet holds ${formatMoney(balance.available)} available, ` +
          `and the purchase totals ${formatMoney(input.quote.total)}.`,
      },
    });
  }

  return ok({
    kind: 'authorized',
    decision,
    intent: {
      purchaseId: input.purchaseId,
      walletId: input.wallet.walletId,
      ownerUserId: input.wallet.ownerUserId,
      quote: input.quote,
      state: 'AUTHORIZED',
      rights: input.rights,
      missionId: input.missionId,
      projectId: input.projectId,
      creationId: input.creationId,
      authorizedTotal: input.quote.total,
      authorizationSource: source,
      idempotencyKey: input.idempotencyKey,
      createdAtIso: input.nowIso,
      updatedAtIso: input.nowIso,
      merchantOrderRef: null,
      failureReason: null,
    },
  });
}

/* --------------------------------------------------------------- reserve */

/**
 * Hold the money. A real ledger entry, not a flag — so two purchases cannot both
 * see the same dollar as available.
 */
export function reserveFundsForPurchase(
  intent: PurchaseIntent,
  entries: readonly WalletLedgerEntry[],
  wallet: WonderlandWalletDraft,
  atIso: string,
): RelayResult<PurchaseStep> {
  const appended = appendLedgerEntry(
    entries,
    {
      entryId: `led_${intent.purchaseId}_reserve`,
      walletId: wallet.walletId,
      type: 'RESERVATION',
      amount: intent.authorizedTotal,
      occurredAtIso: atIso,
      idempotencyKey: `${intent.idempotencyKey}:reserve`,
      reference: `Reserved for ${intent.quote.itemDescription}`,
      authorizationSource: intent.authorizationSource,
      purchaseId: intent.purchaseId,
      missionId: intent.missionId,
      projectId: intent.projectId,
      merchantRef: intent.quote.merchantId,
      orderRef: null,
    },
    wallet.currency,
  );
  if (!appended.ok) return appended;

  const advanced = advance(intent, 'FUNDS_RESERVED', atIso);
  if (!advanced.ok) return advanced;
  return ok({ intent: advanced.value, entries: appended.value.entries });
}

/* ---------------------------------------------------------------- submit */

/**
 * The request has gone to the merchant. From here the outcome is unknown until
 * somebody is told otherwise, and this is the state a Continuation Loop must
 * reconcile rather than retry.
 */
export function markPurchaseSubmitted(
  intent: PurchaseIntent,
  entries: readonly WalletLedgerEntry[],
  atIso: string,
): RelayResult<PurchaseStep> {
  const advanced = advance(intent, 'SUBMITTED', atIso);
  if (!advanced.ok) return advanced;
  return ok({ intent: advanced.value, entries });
}

/* ---------------------------------------------------------------- commit */

export function commitPurchase(
  intent: PurchaseIntent,
  entries: readonly WalletLedgerEntry[],
  wallet: WonderlandWalletDraft,
  merchantOrderRef: string,
  atIso: string,
): RelayResult<PurchaseStep & { readonly receipt: PurchaseReceipt }> {
  const appended = appendLedgerEntry(
    entries,
    {
      entryId: `led_${intent.purchaseId}_purchase`,
      walletId: wallet.walletId,
      type: 'PURCHASE',
      amount: intent.authorizedTotal,
      occurredAtIso: atIso,
      // The SAME stable key on every retry: committing twice is one commit.
      idempotencyKey: `${intent.idempotencyKey}:commit`,
      reference: `Purchased ${intent.quote.itemDescription}`,
      authorizationSource: intent.authorizationSource,
      purchaseId: intent.purchaseId,
      missionId: intent.missionId,
      projectId: intent.projectId,
      merchantRef: intent.quote.merchantId,
      orderRef: merchantOrderRef,
    },
    wallet.currency,
  );
  if (!appended.ok) return appended;

  // Already committed: return the existing state rather than advancing again.
  if (appended.value.deduplicated && intent.state === 'PURCHASED') {
    return ok({
      intent,
      entries: appended.value.entries,
      receipt: buildReceipt(intent, merchantOrderRef, atIso),
    });
  }

  const advanced = advance(intent, 'PURCHASED', atIso, { merchantOrderRef });
  if (!advanced.ok) return advanced;
  return ok({
    intent: advanced.value,
    entries: appended.value.entries,
    receipt: buildReceipt(advanced.value, merchantOrderRef, atIso),
  });
}

function buildReceipt(
  intent: PurchaseIntent,
  orderRef: string,
  atIso: string,
): PurchaseReceipt {
  return {
    receiptId: `rcp_${intent.purchaseId}`,
    purchaseId: intent.purchaseId,
    walletId: intent.walletId,
    ownerUserId: intent.ownerUserId,
    merchantId: intent.quote.merchantId,
    orderRef,
    itemDescription: intent.quote.itemDescription,
    category: intent.quote.category,
    itemPrice: intent.quote.itemPrice,
    shipping: intent.quote.shipping,
    tax: intent.quote.tax,
    total: intent.authorizedTotal,
    occurredAtIso: atIso,
    missionId: intent.missionId,
    projectId: intent.projectId,
    authorizationSource: intent.authorizationSource,
    humanApprovalRequired: intent.authorizationSource === 'user_approved',
    rights: intent.rights,
    refunded: false,
  };
}

/* ----------------------------------------------------------------- fail */

/**
 * The purchase did not happen. Release the hold.
 *
 * Releasing is idempotent and is a no-op when nothing is held — a purchase that
 * failed before reserving must not create a release that credits money the
 * wallet never held.
 */
export function failPurchase(
  intent: PurchaseIntent,
  entries: readonly WalletLedgerEntry[],
  wallet: WonderlandWalletDraft,
  reason: string,
  atIso: string,
): RelayResult<PurchaseStep> {
  let current = entries;

  const held = entriesForPurchase(entries, intent.purchaseId).some((e) => e.type === 'RESERVATION');
  const settled = entriesForPurchase(entries, intent.purchaseId).some((e) => e.type === 'PURCHASE');

  if (held && !settled) {
    const released = appendLedgerEntry(
      current,
      {
        entryId: `led_${intent.purchaseId}_release`,
        walletId: wallet.walletId,
        type: 'RESERVATION_RELEASE',
        amount: intent.authorizedTotal,
        occurredAtIso: atIso,
        idempotencyKey: `${intent.idempotencyKey}:release`,
        reference: `Released after failure: ${reason}`,
        authorizationSource: 'system',
        purchaseId: intent.purchaseId,
        missionId: intent.missionId,
        projectId: intent.projectId,
        merchantRef: intent.quote.merchantId,
        orderRef: null,
      },
      wallet.currency,
    );
    if (!released.ok) return released;
    current = released.value.entries;
  }

  const advanced = advance(intent, 'FAILED', atIso, { failureReason: reason });
  if (!advanced.ok) return advanced;
  return ok({ intent: advanced.value, entries: current });
}

/* ----------------------------------------------------------- reconcile */

/**
 * THE AUTHORITATIVE ANSWER about a submitted purchase.
 *
 * This type exists so that "unknown" cannot be passed in. A reconciliation needs
 * a fact from the provider, and a caller that does not have one must go and get
 * one rather than choosing a branch.
 */
export type MerchantOutcome =
  | { readonly settled: true; readonly orderRef: string }
  | { readonly settled: false; readonly reason: string };

/**
 * Resume a purchase that was SUBMITTED when everything stopped.
 *
 * The merchant's answer decides. If it settled, the ledger commits — and because
 * the commit's idempotency key is stable, a purchase that ALREADY committed
 * before the interruption commits exactly once and the second attempt
 * deduplicates. If it did not settle, the reservation is released.
 *
 * There is no third branch, and that is the point: a Continuation Loop cannot
 * reach this function without an answer, so it cannot retry on a guess.
 */
export function reconcileSubmittedPurchase(
  intent: PurchaseIntent,
  entries: readonly WalletLedgerEntry[],
  wallet: WonderlandWalletDraft,
  outcome: MerchantOutcome,
  atIso: string,
): RelayResult<PurchaseStep & { readonly receipt: PurchaseReceipt | null }> {
  if (intent.state !== 'SUBMITTED' && intent.state !== 'PURCHASED') {
    return fail(
      relayError('illegal-transition', `Only a submitted purchase needs reconciling; this one is ${intent.state}.`, {
        entityIds: { purchaseId: intent.purchaseId },
      }),
    );
  }
  if (outcome.settled) {
    const committed = commitPurchase(intent, entries, wallet, outcome.orderRef, atIso);
    if (!committed.ok) return committed;
    return ok({ ...committed.value, receipt: committed.value.receipt });
  }
  const failed = failPurchase(intent, entries, wallet, outcome.reason, atIso);
  if (!failed.ok) return failed;
  return ok({ ...failed.value, receipt: null });
}

/* -------------------------------------------------------------- refund */

export function refundPurchase(
  intent: PurchaseIntent,
  entries: readonly WalletLedgerEntry[],
  wallet: WonderlandWalletDraft,
  reason: string,
  atIso: string,
): RelayResult<PurchaseStep> {
  const appended = appendLedgerEntry(
    entries,
    {
      entryId: `led_${intent.purchaseId}_refund`,
      walletId: wallet.walletId,
      type: 'REFUND',
      amount: intent.authorizedTotal,
      occurredAtIso: atIso,
      idempotencyKey: `${intent.idempotencyKey}:refund`,
      reference: `Refunded: ${reason}`,
      authorizationSource: 'system',
      purchaseId: intent.purchaseId,
      missionId: intent.missionId,
      projectId: intent.projectId,
      merchantRef: intent.quote.merchantId,
      orderRef: intent.merchantOrderRef,
    },
    wallet.currency,
  );
  if (!appended.ok) return appended;
  const advanced = advance(intent, 'REFUNDED', atIso);
  if (!advanced.ok) return advanced;
  return ok({ intent: advanced.value, entries: appended.value.entries });
}
