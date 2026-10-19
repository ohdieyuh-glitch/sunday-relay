import type { RelayResult } from '../../protocol/errors';
import {
  SANDBOX_FUNDS_LABEL,
  formatMoney,
  type JuliusSpendingPolicy,
  type Money,
  type PurchaseCategory,
  type PurchaseQuote,
  type PurchaseReceipt,
  type PurchaseState,
  type RightsClassification,
  type WalletLedgerEntry,
  type WonderlandWalletDraft,
} from './wallet-contracts';
import type { PurchaseApprovalRequest } from './wallet-policy';

/**
 * THE INTERFACE JULIUS CALLS.
 *
 * Julius never touches a store, a ledger array or a balance field. It calls
 * governed operations, each of which runs the same authorization and idempotency
 * rules no matter who is calling. That is the difference between an agent with
 * a spending limit and an agent with a database connection.
 *
 * Every operation that can move money takes an `idempotencyKey` the CALLER
 * derives deterministically from the intent, so a Continuation Loop that resumes
 * a mission presents the same key and the operation deduplicates instead of
 * charging again.
 *
 * WHAT IS DELIBERATELY ABSENT: there is no `setPolicy`, no `credit`, and no
 * `openWallet`. Julius may spend within limits a HUMAN set; it may not raise its
 * own limits or fund its own wallet. A commerce agent that can widen its own
 * authority has no authority model at all.
 */

/* ------------------------------------------------------------- summaries */

/**
 * What Julius is told about the money.
 *
 * `fundingLabel` is carried so that every surface rendering this is obliged to
 * show it, and so a sandbox balance is never mistaken for spendable cash — by a
 * user or by a model reasoning about what it may do.
 */
export interface WalletSummary {
  readonly walletId: string;
  readonly ownerUserId: string;
  readonly currency: string;
  readonly available: Money;
  readonly reserved: Money;
  readonly availableLabel: string;
  readonly fundingLabel: string;
  readonly isSandbox: boolean;
  readonly status: string;
}

export function summariseWallet(wallet: WonderlandWalletDraft): WalletSummary {
  return {
    walletId: wallet.walletId,
    ownerUserId: wallet.ownerUserId,
    currency: wallet.currency,
    available: wallet.availableBalance,
    reserved: wallet.reservedBalance,
    availableLabel: formatMoney(wallet.availableBalance),
    fundingLabel: wallet.fundingSource === 'SANDBOX' ? SANDBOX_FUNDS_LABEL : 'Funded account',
    isSandbox: wallet.fundingSource === 'SANDBOX',
    status: wallet.status,
  };
}

/**
 * The policy as a set of sentences.
 *
 * Julius is a language model; handing it prose it cannot misread is worth more
 * than handing it numbers it might reason around. The numbers are present too —
 * this is in addition to the typed policy, never instead of it.
 */
export interface SpendingPolicySummary {
  readonly policy: JuliusSpendingPolicy;
  readonly enabled: boolean;
  readonly sentences: readonly string[];
}

export function summarisePolicy(policy: JuliusSpendingPolicy): SpendingPolicySummary {
  if (!policy.enabled) {
    return {
      policy,
      enabled: false,
      sentences: [
        'Autonomous spending is OFF. You may not make any purchase without explicit human approval.',
      ],
    };
  }
  const sentences = [
    `You may spend up to ${formatMoney(policy.maxPerTransaction)} on a single purchase without asking.`,
    `You may spend up to ${formatMoney(policy.maxPerDay)} in total per day.`,
    `You may spend up to ${formatMoney(policy.maxPerMission)} on any one mission.`,
    policy.requiresConfirmationAbove.amountMinor > 0
      ? `Anything above ${formatMoney(policy.requiresConfirmationAbove)} needs the user to confirm, even if it is within your limits.`
      : 'No separate confirmation threshold is set.',
    policy.physicalGoodsAllowed
      ? 'Physical goods are permitted, subject to rights clearance.'
      : 'Physical goods are NOT permitted.',
    policy.digitalGoodsAllowed ? 'Digital goods are permitted.' : 'Digital goods are NOT permitted.',
    policy.recurringPurchasesAllowed
      ? 'Recurring purchases are permitted.'
      : 'Recurring purchases are NOT permitted.',
    policy.allowedMerchants.length === 0
      ? 'No merchant is approved, so no purchase can proceed.'
      : `Approved merchants: ${policy.allowedMerchants.join(', ')}.`,
    'Funds existing is not permission to spend them. Every purchase is checked against this policy.',
  ];
  return { policy, enabled: true, sentences };
}

/* ------------------------------------------------------- the operations */

export interface RequestPurchaseInput {
  readonly requesterUserId: string;
  readonly quote: PurchaseQuote;
  readonly rights: RightsClassification;
  readonly missionId: string | null;
  readonly projectId: string | null;
  readonly creationId: string | null;
  /** Deterministic from the intent, so a resumed mission presents the same one. */
  readonly idempotencyKey: string;
  readonly nowIso: string;
}

export type RequestPurchaseResult =
  | { readonly kind: 'purchased'; readonly receipt: PurchaseReceipt }
  | { readonly kind: 'awaiting_approval'; readonly request: PurchaseApprovalRequest }
  | { readonly kind: 'refused'; readonly reason: string }
  | { readonly kind: 'already_done'; readonly receipt: PurchaseReceipt };

/**
 * THE GOVERNED SURFACE. An implementation is wired by a composition root that
 * holds the store; Julius receives only this object.
 */
export interface JuliusWalletPort {
  getWalletSummary(requesterUserId: string): Promise<RelayResult<WalletSummary>>;
  getSpendingPolicy(requesterUserId: string): Promise<RelayResult<SpendingPolicySummary>>;
  /** The whole flow: policy, balance, reserve, submit, commit, receipt. */
  requestPurchase(input: RequestPurchaseInput): Promise<RelayResult<RequestPurchaseResult>>;
  /** Resume a purchase whose outcome was never observed. Never a blind retry. */
  reconcilePurchase(
    purchaseId: string,
    requesterUserId: string,
    nowIso: string,
  ): Promise<RelayResult<{ readonly state: PurchaseState; readonly receipt: PurchaseReceipt | null }>>;
  recordRefund(
    purchaseId: string,
    requesterUserId: string,
    reason: string,
    nowIso: string,
  ): Promise<RelayResult<null>>;
  /** Every entry explaining one spend, for "why did Julius spend $42". */
  explainPurchase(
    purchaseId: string,
    requesterUserId: string,
  ): Promise<RelayResult<readonly string[]>>;
}

/* ------------------------------------------------------ commerce provider */

/**
 * A REPLACEABLE COMMERCE ADAPTER.
 *
 * Nothing in the wallet knows what a printing company is. A provider quotes and
 * submits; the wallet decides whether it may. Binding the wallet to one
 * fulfilment company is how "turn this into a shirt" and "turn this into a
 * plush" would end up being two different systems.
 *
 * `submitOrder` returns an outcome that CANNOT express "I do not know" — a
 * provider that cannot determine an outcome must throw or time out, so the
 * caller lands in the reconciliation path rather than silently choosing a branch.
 */
export interface CommerceProviderPort {
  readonly providerId: string;
  readonly isSandbox: boolean;
  quote(input: {
    readonly itemDescription: string;
    readonly category: PurchaseCategory;
    readonly creationId: string | null;
    readonly nowIso: string;
  }): Promise<RelayResult<PurchaseQuote>>;
  submitOrder(input: {
    readonly quote: PurchaseQuote;
    /** The provider MUST treat two calls with this key as one order. */
    readonly idempotencyKey: string;
    readonly nowIso: string;
  }): Promise<RelayResult<{ readonly orderRef: string }>>;
  /** The authoritative answer for a submitted order whose result was lost. */
  lookupOrder(idempotencyKey: string): Promise<RelayResult<{ readonly orderRef: string } | null>>;
}

/* ------------------------------------------------------------ rights hook */

/**
 * THE PRE-PURCHASE RIGHTS CLASSIFIER.
 *
 * A separate port because classification is a judgement this module is not
 * qualified to make. The default when no classifier is wired is
 * `REQUIRES_RIGHTS_REVIEW`, which blocks manufacturing — an unclassified design
 * must never behave like a cleared one.
 */
export interface RightsClassifierPort {
  classify(input: {
    readonly creationId: string | null;
    readonly itemDescription: string;
    readonly category: PurchaseCategory;
  }): Promise<RightsClassification>;
}

export const CONSERVATIVE_RIGHTS_CLASSIFIER: RightsClassifierPort = {
  async classify() {
    return 'REQUIRES_RIGHTS_REVIEW';
  },
};

/* --------------------------------------------------------------- receipts */

/** The user-facing answer to "why did this charge happen". */
export function explainReceipt(receipt: PurchaseReceipt, entries: readonly WalletLedgerEntry[]): string {
  const cause = receipt.missionId === null
    ? 'It was not attached to a mission.'
    : `It was caused by mission ${receipt.missionId}.`;
  const who = receipt.humanApprovalRequired
    ? 'You approved it personally.'
    : 'Julius made it within the autonomous spending limits you set.';
  const rows = entries.filter((entry) => entry.purchaseId === receipt.purchaseId).length;
  return [
    `${formatMoney(receipt.total)} to ${receipt.merchantId} for ${receipt.itemDescription}.`,
    `Item ${formatMoney(receipt.itemPrice)}, shipping ${formatMoney(receipt.shipping)}, tax ${formatMoney(receipt.tax)}.`,
    who,
    cause,
    `Order ${receipt.orderRef}, rights classified ${receipt.rights}, ${rows} ledger entries record it.`,
  ].join(' ');
}
