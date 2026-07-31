/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 5
 * Budget evaluation (PURE, exact, deterministic).
 *
 * Answers one question before Relay spends anything: may this operation
 * proceed, and what will it cost us to say yes?
 *
 * The honesty rules that make the answer trustworthy:
 *   - finalized actual always counts; provisional counts toward the
 *     PROJECTION; a pending receipt with no amount stays UNKNOWN and never
 *     becomes zero;
 *   - a warning is not a hard limit, and an approval threshold is neither;
 *   - a currency conflict blocks aggregation rather than producing a
 *     meaningless total;
 *   - when required inputs are unknown, the status says so instead of
 *     claiming an exact projection.
 *
 * Nothing here mutates a receipt, a budget, or a policy.
 */

import {
  economicsError,
  type RelayEconomicsError,
} from './economics-errors';
import {
  basisPointsOf,
  compareMoney,
  subtractMoney,
  sumMoney,
  type RelayMoney,
} from './money';
import type { RelayCostCategory, RelayCostReceipt } from './cost-receipt-types';
import {
  isFinalizedActual,
  isPending,
  isProvisionalActual,
} from './cost-receipt-types';
import type { RelayBudgetStatus, RelayMissionBudget } from './budget-types';

export const RELAY_BUDGET_EVALUATION_STATUSES = [
  'not_configured',
  'under_budget',
  'warning',
  'approval_required',
  'hard_limit_reached',
  'exhausted',
  'unknown_due_to_missing_cost',
  'currency_conflict',
] as const;
export type RelayBudgetEvaluationStatus = (typeof RELAY_BUDGET_EVALUATION_STATUSES)[number];

export interface RelayBudgetCategoryEvaluation {
  readonly category: RelayCostCategory;
  readonly limit: RelayMoney | null;
  readonly spent: RelayMoney | null;
  readonly remaining: RelayMoney | null;
  readonly limitReached: boolean;
  /**
   * True when a receipt in this category counts toward the limit but carries
   * no amount. `spent` is then a LOWER bound and `remaining` an UPPER one.
   */
  readonly hasUnknownCost: boolean;
}

export interface RelayBudgetEvaluation {
  readonly missionId: string;
  readonly budgetId?: string;

  readonly currency: string | null;

  /** The configured limit, carried directly rather than reconstructed from
      `remaining + projected` — a reconstruction that vanishes the moment
      either side is honestly unknown. */
  readonly totalLimit: RelayMoney | null;

  readonly finalizedActual: RelayMoney | null;
  readonly provisionalActual: RelayMoney | null;
  readonly pendingKnown: RelayMoney | null;
  /** True when at least one pending receipt has no amount at all. */
  readonly hasUnknownPendingCost: boolean;
  /**
   * True when at least one PROVISIONAL actual receipt has no amount. A
   * provisional receipt counts toward the projection, so an unpriced one makes
   * the projection incomplete exactly as an unpriced pending receipt does.
   */
  readonly hasUnknownProvisionalCost: boolean;
  /** How many countable receipts carry no amount at all. */
  readonly unpricedCountableReceipts: number;
  /**
   * False when ANY countable receipt is unpriced. `projectedTotal` is then a
   * LOWER BOUND, `remainingBudget` an UPPER BOUND, and no surface may present
   * either as the figure.
   */
  readonly projectedTotalComplete: boolean;
  readonly proposedCost: RelayMoney | null;
  readonly projectedTotal: RelayMoney | null;
  readonly remainingBudget: RelayMoney | null;

  readonly warningThresholdReached: boolean;
  readonly approvalRequired: boolean;
  readonly hardLimitReached: boolean;

  readonly repairCyclesUsed: number;
  readonly retriesUsed: number;

  readonly categoryEvaluations: readonly RelayBudgetCategoryEvaluation[];

  readonly status: RelayBudgetEvaluationStatus;

  readonly blockingReasons: readonly string[];
  readonly warnings: readonly string[];
  readonly errors: readonly RelayEconomicsError[];
}

export interface EvaluateMissionBudgetInput {
  budget: RelayMissionBudget | null;
  /** Every receipt for the mission; the evaluator classifies them itself. */
  receipts: readonly RelayCostReceipt[];
  /** The estimated cost of the operation being considered, when known. */
  proposedCost?: RelayMoney | null;
  /** True when an operation is proposed whose cost cannot be estimated. */
  proposedCostUnknown?: boolean;
  missionId: string;
  /** Policy for an operation whose cost is unknown. */
  unknownCostPolicy?: 'allow' | 'require_approval' | 'deny';
}

function collectCurrencies(
  receipts: readonly RelayCostReceipt[],
  budget: RelayMissionBudget | null,
  proposed: RelayMoney | null | undefined,
): Set<string> {
  const currencies = new Set<string>();
  for (const receipt of receipts) {
    if (receipt.amount && receipt.status !== 'voided') currencies.add(receipt.amount.currency);
  }
  if (budget?.totalLimit) currencies.add(budget.totalLimit.currency);
  if (proposed) currencies.add(proposed.currency);
  return currencies;
}

/**
 * Sums receipts matching a predicate. Returns null when NOTHING matched —
 * "no data" is different from "zero", and the caller must be able to tell.
 */
function sumMatching(
  receipts: readonly RelayCostReceipt[],
  predicate: (receipt: RelayCostReceipt) => boolean,
): RelayMoney | null {
  const amounts = receipts
    .filter((receipt) => predicate(receipt) && receipt.amount !== null)
    .map((receipt) => receipt.amount as RelayMoney);
  const total = sumMoney(amounts);
  return total.ok ? total.value : null;
}

export function evaluateMissionBudget(
  input: EvaluateMissionBudgetInput,
): RelayBudgetEvaluation {
  const { budget, receipts } = input;
  const proposedCost = input.proposedCost ?? null;
  const unknownCostPolicy = input.unknownCostPolicy ?? 'require_approval';

  const blockingReasons: string[] = [];
  const warnings: string[] = [];
  const errors: RelayEconomicsError[] = [];

  /* ---- currency coherence comes first: a mixed total means nothing ---- */
  const currencies = collectCurrencies(receipts, budget, proposedCost);
  if (currencies.size > 1) {
    const conflict = economicsError(
      'COST_CURRENCY_CONFLICT',
      `this mission mixes ${[...currencies].sort().join(' and ')} — Relay performs no currency conversion, so no combined total exists`,
      'record costs in a single currency, or read the per-currency figures separately',
      { missionId: input.missionId, budgetId: budget?.budgetId },
    );
    return {
      missionId: input.missionId,
      ...(budget ? { budgetId: budget.budgetId } : {}),
      currency: null,
      totalLimit: budget?.totalLimit ?? null,
      finalizedActual: null,
      provisionalActual: null,
      pendingKnown: null,
      hasUnknownPendingCost: receipts.some((r) => isPending(r) && r.amount === null),
      hasUnknownProvisionalCost: receipts.some((r) => isProvisionalActual(r) && r.amount === null),
      unpricedCountableReceipts: receipts.filter((r) => r.status !== 'voided' && r.amount === null).length,
      projectedTotalComplete: false,
      proposedCost,
      projectedTotal: null,
      remainingBudget: null,
      warningThresholdReached: false,
      approvalRequired: false,
      hardLimitReached: false,
      repairCyclesUsed: countCategory(receipts, 'repair'),
      retriesUsed: countCategory(receipts, 'retry'),
      categoryEvaluations: [],
      status: 'currency_conflict',
      blockingReasons: [conflict.reason],
      warnings: [],
      errors: [conflict],
    };
  }

  const currency = currencies.size === 1 ? [...currencies][0] : (budget?.currency ?? null);

  /* ---- classify spend. Voided never counts; disputed is held out. ---- */
  const countable = receipts.filter((r) => r.status !== 'voided');
  const finalizedActual = sumMatching(countable, isFinalizedActual);
  const provisionalActual = sumMatching(countable, isProvisionalActual);
  const pendingKnown = sumMatching(countable, isPending);
  const hasUnknownPendingCost = countable.some((r) => isPending(r) && r.amount === null);
  const hasUnknownProvisionalCost = countable.some((r) => isProvisionalActual(r) && r.amount === null);
  const disputed = countable.filter((r) => r.status === 'disputed');

  /**
   * Receipts that COUNT toward the projection but carry no amount. The
   * previous evaluation tracked only unpriced PENDING receipts, so an
   * unpriced provisional or finalized actual was dropped silently: it left no
   * trace in the total, no trace in the status, and no notice for an operator.
   * That is a silent undercount, and it is what this counts.
   */
  const unpricedCountable = countable.filter(
    (r) => r.amount === null && r.status !== 'disputed' && (isPending(r) || isProvisionalActual(r) || isFinalizedActual(r)),
  );
  const projectedTotalComplete = unpricedCountable.length === 0;

  if (disputed.length > 0) {
    warnings.push(
      `${disputed.length} disputed receipt(s) are excluded from the total until the dispute resolves`,
    );
  }
  if (hasUnknownPendingCost) {
    warnings.push('at least one pending receipt has no recorded amount — the projection is a lower bound');
  }
  if (hasUnknownProvisionalCost) {
    warnings.push(
      'at least one provisional receipt has no recorded amount — it counts toward the projection, so the projected total is a lower bound',
    );
  }
  const unpricedFinalized = unpricedCountable.filter(isFinalizedActual).length;
  if (unpricedFinalized > 0) {
    warnings.push(
      `${unpricedFinalized} finalized receipt(s) carry no amount — the recorded actual cost is incomplete`,
    );
  }

  /* ---- projected total = finalized + provisional + known pending + proposed ---- */
  const projectedParts = [finalizedActual, provisionalActual, pendingKnown, proposedCost].filter(
    (part): part is RelayMoney => part !== null,
  );
  const projectedSum = sumMoney(projectedParts);
  const projectedTotal = projectedSum.ok ? projectedSum.value : null;
  if (!projectedSum.ok) errors.push(projectedSum.error);

  /* ---- remaining ----
   * NEVER `projectedTotal ?? zeroMoney(currency)`. Substituting zero for an
   * unknown spend reported the WHOLE limit as remaining, which is the one
   * number an operator acts on and the one they must not be given. Unknown
   * spend means unknown remaining. */
  let remainingBudget: RelayMoney | null = null;
  if (budget?.totalLimit && currency && projectedTotal !== null) {
    const remaining = subtractMoney(budget.totalLimit, projectedTotal);
    if (remaining.ok) remainingBudget = remaining.value;
    else errors.push(remaining.error);
  }

  /* ---- thresholds ---- */
  let warningThresholdReached = false;
  let approvalRequired = false;
  let hardLimitReached = false;

  if (budget?.totalLimit && projectedTotal) {
    const warningAt = basisPointsOf(budget.totalLimit, budget.warningThresholdBasisPoints);
    if (warningAt.ok) {
      const comparison = compareMoney(projectedTotal, warningAt.value);
      warningThresholdReached = comparison.ok && comparison.value >= 0;
    }

    if (budget.approvalThreshold) {
      const comparison = compareMoney(projectedTotal, budget.approvalThreshold);
      if (comparison.ok && comparison.value >= 0) {
        approvalRequired = true;
        blockingReasons.push(
          'the projected total reaches the approval threshold — a human must authorize further spending',
        );
      }
    }

    const overLimit = compareMoney(projectedTotal, budget.totalLimit);
    if (overLimit.ok && overLimit.value >= 0) {
      if (budget.hardLimitEnabled) {
        hardLimitReached = true;
        blockingReasons.push(
          `the projected total ${projectedTotal.amountMicros} micros reaches the hard limit ${budget.totalLimit.amountMicros} micros`,
        );
      } else {
        warnings.push('the projected total reaches the configured limit, which is advisory for this mission');
      }
    }
  }

  /* ---- category limits ---- */
  const categoryEvaluations: RelayBudgetCategoryEvaluation[] = [];
  for (const [category, limit] of Object.entries(budget?.categoryLimits ?? {})) {
    if (!limit) continue;
    const spent = sumMatching(
      countable,
      (receipt) =>
        receipt.category === (category as RelayCostCategory) &&
        (isFinalizedActual(receipt) || isProvisionalActual(receipt)),
    );
    // An unpriced receipt in this category makes its spend a lower bound.
    const hasUnknownCost = countable.some(
      (receipt) =>
        receipt.category === (category as RelayCostCategory) &&
        receipt.amount === null &&
        receipt.status !== 'disputed' &&
        (isFinalizedActual(receipt) || isProvisionalActual(receipt) || isPending(receipt)),
    );

    let remaining: RelayMoney | null = null;
    let limitReached = false;
    if (spent) {
      const difference = subtractMoney(limit, spent);
      if (difference.ok) remaining = difference.value;
      const comparison = compareMoney(spent, limit);
      limitReached = comparison.ok && comparison.value >= 0;
      if (limitReached) {
        blockingReasons.push(`the ${category} category limit has been reached`);
      }
    }
    // `remaining` stays NULL when nothing priced was recorded. Reporting the
    // full limit there is the same fabricated zero as above: "no amount
    // recorded" is not "nothing spent".
    if (hasUnknownCost) {
      warnings.push(
        `the ${category} category has at least one unpriced receipt — its spend is a lower bound and its remaining allowance an upper one`,
      );
    }
    categoryEvaluations.push({
      category: category as RelayCostCategory,
      limit,
      spent,
      remaining,
      limitReached,
      hasUnknownCost,
    });
  }

  /* ---- repair and retry limits are counted, not priced ---- */
  const repairCyclesUsed = countCategory(countable, 'repair');
  const retriesUsed = countCategory(countable, 'retry');
  if (budget?.repairCycleLimit !== undefined && repairCyclesUsed >= budget.repairCycleLimit) {
    blockingReasons.push(
      `the repair-cycle limit (${budget.repairCycleLimit}) has been reached`,
    );
    errors.push(
      economicsError(
        'REPAIR_LIMIT_REACHED',
        `the mission has used ${repairCyclesUsed} of ${budget.repairCycleLimit} repair cycles`,
        'raise the repair limit through a validated command, or stop repairing',
        {
          missionId: input.missionId,
          budgetId: budget.budgetId,
          humanApprovalRequired: true,
        },
      ),
    );
  }
  if (budget?.retryLimit !== undefined && retriesUsed >= budget.retryLimit) {
    blockingReasons.push(`the retry limit (${budget.retryLimit}) has been reached`);
    errors.push(
      economicsError(
        'RETRY_LIMIT_REACHED',
        `the mission has used ${retriesUsed} of ${budget.retryLimit} retries`,
        'raise the retry limit through a validated command, or stop retrying',
        { missionId: input.missionId, budgetId: budget.budgetId, humanApprovalRequired: true },
      ),
    );
  }

  /* ---- an operation whose cost cannot be estimated ---- */
  if (input.proposedCostUnknown) {
    if (unknownCostPolicy === 'deny') {
      blockingReasons.push('the proposed operation has no cost estimate and policy denies unpriced work');
      errors.push(
        economicsError(
          'UNKNOWN_PROPOSED_COST',
          'the proposed operation has no cost estimate',
          'supply an estimate, or authorize the operation explicitly',
          { missionId: input.missionId, budgetId: budget?.budgetId, humanApprovalRequired: true },
        ),
      );
    } else if (unknownCostPolicy === 'require_approval') {
      approvalRequired = true;
      warnings.push('the proposed operation has no cost estimate — approval is required before it runs');
    }
  }

  /* ---- final status, in strict precedence ---- */
  const status = deriveStatus({
    budget,
    hardLimitReached,
    approvalRequired,
    warningThresholdReached,
    projectedTotal,
    projectedTotalComplete,
    proposedCostUnknown: Boolean(input.proposedCostUnknown),
    categoryLimitReached: categoryEvaluations.some((c) => c.limitReached),
    remainingBudget,
  });

  return {
    missionId: input.missionId,
    ...(budget ? { budgetId: budget.budgetId } : {}),
    currency,
    totalLimit: budget?.totalLimit ?? null,
    finalizedActual,
    provisionalActual,
    pendingKnown,
    hasUnknownPendingCost,
    hasUnknownProvisionalCost,
    unpricedCountableReceipts: unpricedCountable.length,
    projectedTotalComplete,
    proposedCost,
    projectedTotal,
    remainingBudget,
    warningThresholdReached,
    approvalRequired,
    hardLimitReached,
    repairCyclesUsed,
    retriesUsed,
    categoryEvaluations,
    status,
    blockingReasons,
    warnings,
    errors,
  };
}

function countCategory(receipts: readonly RelayCostReceipt[], category: RelayCostCategory): number {
  const runIds = new Set<string>();
  let unattributed = 0;
  for (const receipt of receipts) {
    if (receipt.category !== category || receipt.status === 'voided') continue;
    if (receipt.runId) runIds.add(receipt.runId);
    else unattributed += 1;
  }
  return runIds.size + unattributed;
}

function deriveStatus(input: {
  budget: RelayMissionBudget | null;
  hardLimitReached: boolean;
  approvalRequired: boolean;
  warningThresholdReached: boolean;
  /**
   * The projected total itself, NOT merely a flag about it. Null when nothing
   * priced was recorded and nothing was proposed — an empty ledger, or one
   * whose every receipt is unpriced. Completeness alone cannot stand in for
   * this: `projectedTotalComplete` is `unpricedCountable.length === 0`, which
   * is VACUOUSLY true when there are no receipts at all.
   */
  projectedTotal: RelayMoney | null;
  /** False when ANY countable receipt is unpriced — pending, provisional or
      finalized. The previous signal covered only pending receipts, so an
      unpriced provisional receipt still reported `under_budget`. */
  projectedTotalComplete: boolean;
  proposedCostUnknown: boolean;
  categoryLimitReached: boolean;
  remainingBudget: RelayMoney | null;
}): RelayBudgetEvaluationStatus {
  if (!input.budget || input.budget.totalLimit === null) return 'not_configured';
  if (input.hardLimitReached) {
    // Exhausted means nothing remains at all; hard_limit_reached means this
    // operation cannot proceed. Both block, and they read differently. A
    // lower-bound projection that already breaches the limit still blocks —
    // incomplete cost data may never make a breach look survivable.
    if (input.remainingBudget && BigInt(input.remainingBudget.amountMicros) <= 0n) return 'exhausted';
    return 'hard_limit_reached';
  }
  if (input.categoryLimitReached) return 'hard_limit_reached';
  if (input.approvalRequired) return 'approval_required';
  if (input.warningThresholdReached) return 'warning';
  // Unknown cost only downgrades the status when nothing more serious applies
  // — but `under_budget` is a claim, and neither an incomplete total nor an
  // ABSENT one can support it. A budget with zero receipts has no total to
  // compare against its limit, and "no cost recorded" is not "$0.00 spent";
  // reporting it as under budget states a comparison Relay never performed.
  if (
    input.projectedTotal === null ||
    !input.projectedTotalComplete ||
    input.proposedCostUnknown
  ) {
    return 'unknown_due_to_missing_cost';
  }
  return 'under_budget';
}

/**
 * The budget status to STORE, derived from an evaluation — or `null` when the
 * evaluation supports no stored status at all.
 *
 * `unknown_due_to_missing_cost` and `currency_conflict` are not budget states.
 * They are Relay saying it does not know where this mission stands: an
 * incomplete total, or two currencies that cannot be added. Neither can be
 * turned into a reading of the budget without inventing the missing figure.
 *
 * This function used to map both to `evaluation.warningThresholdReached ?
 * 'warning' : 'under_budget'`. In both cases `warningThresholdReached` is
 * necessarily false — the currency-conflict evaluation hardcodes it, and
 * {@link deriveStatus} returns `warning` before it ever reaches the
 * unknown-cost branch — so that ternary ALWAYS stored `under_budget`. Missing
 * cost data was recorded as a positive claim that the mission was within
 * budget, which is the one thing this layer exists to prevent.
 *
 * `RelayBudgetStatus` has no truthful member for "unknown", so the honest
 * answer is that no status is derivable. A caller must keep the budget's
 * existing stored status and disclose `evaluation.status` beside it — an
 * unknown never becomes a reading, and `null` never becomes `under_budget`.
 */
export function budgetStatusFromEvaluation(
  evaluation: RelayBudgetEvaluation,
): RelayBudgetStatus | null {
  switch (evaluation.status) {
    case 'currency_conflict':
    case 'unknown_due_to_missing_cost':
      return null;
    case 'not_configured':
      return 'not_configured';
    case 'under_budget':
      return 'under_budget';
    case 'warning':
      return 'warning';
    case 'approval_required':
      return 'approval_required';
    case 'hard_limit_reached':
      return 'hard_limit_reached';
    case 'exhausted':
      return 'exhausted';
  }
}
