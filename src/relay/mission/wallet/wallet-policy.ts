import {
  PHYSICAL_CATEGORIES,
  RIGHTS_CLEARED_FOR_MANUFACTURE,
  formatMoney,
  type JuliusSpendingPolicy,
  type Money,
  type PurchaseQuote,
  type RightsClassification,
  type WalletLedgerEntry,
  type WonderlandCurrency,
} from './wallet-contracts';
import { spentOnDay, spentOnMission } from './wallet-ledger';

/**
 * WHAT JULIUS MAY SPEND, AND WHY.
 *
 * The rule this module exists to enforce: THE EXISTENCE OF FUNDS IS NOT
 * PERMISSION TO SPEND THEM. Balance and policy are evaluated separately and both
 * must pass, so a full wallet with `enabled: false` spends exactly nothing.
 *
 * Every refusal carries a REASON a user can read. A denial with no reason is not
 * reviewable, and this is the module a user will most want to interrogate after
 * the fact.
 *
 * THREE OUTCOMES, not two. A purchase is permitted, refused, or REQUIRES A
 * HUMAN. The third is not a soft refusal — it is the normal path for anything
 * above the user's autonomous authority, and collapsing it into "no" would make
 * the wallet useless for exactly the purchases people care about.
 */

export const POLICY_REFUSALS = [
  'autonomous_spend_disabled',
  'over_per_transaction_limit',
  'over_daily_limit',
  'over_mission_limit',
  'category_not_allowed',
  'merchant_not_allowed',
  'physical_goods_not_allowed',
  'digital_goods_not_allowed',
  'rights_not_cleared',
  'quote_expired',
  'wallet_not_active',
] as const;
export type PolicyRefusal = (typeof POLICY_REFUSALS)[number];

export type PolicyDecision =
  | { readonly outcome: 'permitted'; readonly detail: string }
  | { readonly outcome: 'requires_human'; readonly reason: 'above_confirmation_threshold' | 'above_autonomous_limit'; readonly detail: string }
  | { readonly outcome: 'refused'; readonly reason: PolicyRefusal; readonly detail: string };

export interface PolicyEvaluationInput {
  readonly policy: JuliusSpendingPolicy;
  readonly quote: PurchaseQuote;
  readonly rights: RightsClassification;
  readonly entries: readonly WalletLedgerEntry[];
  readonly currency: WonderlandCurrency;
  readonly missionId: string | null;
  readonly nowIso: string;
  readonly walletActive: boolean;
}

/**
 * Evaluate ONE purchase against the policy.
 *
 * Order matters and is deliberate: structural refusals first (wallet state,
 * rights, category, merchant), then limits, then the human-approval threshold
 * LAST — so a purchase that would be refused outright is never reported to the
 * user as "waiting for your approval", which would imply that approving it would
 * work.
 */
export function evaluateSpendingPolicy(input: PolicyEvaluationInput): PolicyDecision {
  const { policy, quote } = input;

  if (!input.walletActive) {
    return { outcome: 'refused', reason: 'wallet_not_active', detail: 'This wallet is not active.' };
  }

  /**
   * RIGHTS BEFORE MONEY. A physical good whose rights are unresolved is refused
   * even when every limit would allow it — the wallet does not get to bypass the
   * rights layer simply because funds are available. `REQUIRES_RIGHTS_REVIEW` is
   * the default classification, so "we never checked" lands here.
   */
  if (
    PHYSICAL_CATEGORIES.includes(quote.category) &&
    !RIGHTS_CLEARED_FOR_MANUFACTURE.includes(input.rights)
  ) {
    return {
      outcome: 'refused',
      reason: 'rights_not_cleared',
      detail: `Manufacturing this requires cleared rights; this design is classified ${input.rights}.`,
    };
  }

  if (quote.expiresAtIso !== null && Date.parse(input.nowIso) > Date.parse(quote.expiresAtIso)) {
    return {
      outcome: 'refused',
      reason: 'quote_expired',
      detail: 'This quote has expired, so its price is no longer authorized.',
    };
  }

  if (!policy.enabled) {
    // Not a refusal of THIS purchase so much as of all of them. Said plainly,
    // because the fix is a setting the user controls.
    return {
      outcome: 'refused',
      reason: 'autonomous_spend_disabled',
      detail: 'Autonomous spending is switched off for this wallet.',
    };
  }

  if (!policy.allowedCategories.includes(quote.category)) {
    return {
      outcome: 'refused',
      reason: 'category_not_allowed',
      detail: `This wallet does not permit purchases in the ${quote.category} category.`,
    };
  }
  if (PHYSICAL_CATEGORIES.includes(quote.category) && !policy.physicalGoodsAllowed) {
    return {
      outcome: 'refused',
      reason: 'physical_goods_not_allowed',
      detail: 'This wallet does not permit physical goods.',
    };
  }
  if (!PHYSICAL_CATEGORIES.includes(quote.category) && quote.category !== 'service' && !policy.digitalGoodsAllowed) {
    return {
      outcome: 'refused',
      reason: 'digital_goods_not_allowed',
      detail: 'This wallet does not permit digital goods.',
    };
  }
  if (policy.allowedMerchants.length === 0 || !policy.allowedMerchants.includes(quote.merchantId)) {
    return {
      outcome: 'refused',
      reason: 'merchant_not_allowed',
      detail: `${quote.merchantId} is not an approved merchant for this wallet.`,
    };
  }

  const total = quote.total.amountMinor;

  if (total > policy.maxPerTransaction.amountMinor) {
    // Above the autonomous limit is NOT a refusal — it is the human-approval
    // path. The user set a limit on what Julius may do alone, not a limit on
    // what they themselves may buy.
    return {
      outcome: 'requires_human',
      reason: 'above_autonomous_limit',
      detail:
        `${formatMoney(quote.total)} exceeds the ${formatMoney(policy.maxPerTransaction)} ` +
        'Julius may spend on a single purchase without asking.',
    };
  }

  const today = spentOnDay(input.entries, input.nowIso, input.currency).amountMinor;
  if (today + total > policy.maxPerDay.amountMinor) {
    return {
      outcome: 'refused',
      reason: 'over_daily_limit',
      detail:
        `This would bring today's autonomous spend to ${formatMoney({ amountMinor: today + total, currency: input.currency })}, ` +
        `over the ${formatMoney(policy.maxPerDay)} daily limit.`,
    };
  }

  if (input.missionId !== null) {
    const mission = spentOnMission(input.entries, input.missionId, input.currency).amountMinor;
    if (mission + total > policy.maxPerMission.amountMinor) {
      return {
        outcome: 'refused',
        reason: 'over_mission_limit',
        detail:
          `This would bring the mission's spend to ${formatMoney({ amountMinor: mission + total, currency: input.currency })}, ` +
          `over the ${formatMoney(policy.maxPerMission)} limit for one mission.`,
      };
    }
  }

  if (
    policy.requiresConfirmationAbove.amountMinor > 0 &&
    total > policy.requiresConfirmationAbove.amountMinor
  ) {
    return {
      outcome: 'requires_human',
      reason: 'above_confirmation_threshold',
      detail:
        `${formatMoney(quote.total)} is above the ${formatMoney(policy.requiresConfirmationAbove)} ` +
        'you asked to confirm personally.',
    };
  }

  return {
    outcome: 'permitted',
    detail:
      `Within the ${formatMoney(policy.maxPerTransaction)} per-purchase and ` +
      `${formatMoney(policy.maxPerDay)} daily limits you set.`,
  };
}

/* ------------------------------------------------------- approval request */

/**
 * WHAT A HUMAN IS ASKED TO APPROVE.
 *
 * Every number broken out, because approving a total without seeing shipping and
 * tax is approving a number you were shown rather than a purchase you
 * understood. `reason` says why approval was needed at all.
 */
export interface PurchaseApprovalRequest {
  readonly purchaseId: string;
  readonly walletId: string;
  readonly ownerUserId: string;
  readonly itemDescription: string;
  readonly merchantId: string;
  readonly itemPrice: Money;
  readonly shipping: Money;
  readonly tax: Money;
  readonly total: Money;
  readonly reason: string;
  readonly missionId: string | null;
  readonly rights: RightsClassification;
  readonly requestedAtIso: string;
}

export function buildApprovalRequest(input: {
  readonly purchaseId: string;
  readonly walletId: string;
  readonly ownerUserId: string;
  readonly quote: PurchaseQuote;
  readonly rights: RightsClassification;
  readonly reason: string;
  readonly missionId: string | null;
  readonly nowIso: string;
}): PurchaseApprovalRequest {
  return {
    purchaseId: input.purchaseId,
    walletId: input.walletId,
    ownerUserId: input.ownerUserId,
    itemDescription: input.quote.itemDescription,
    merchantId: input.quote.merchantId,
    itemPrice: input.quote.itemPrice,
    shipping: input.quote.shipping,
    tax: input.quote.tax,
    total: input.quote.total,
    reason: input.reason,
    missionId: input.missionId,
    rights: input.rights,
    requestedAtIso: input.nowIso,
  };
}
