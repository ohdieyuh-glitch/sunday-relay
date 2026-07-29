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
  zeroMoney,
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
}

export interface RelayBudgetEvaluation {
  readonly missionId: string;
  readonly budgetId?: string;

  readonly currency: string | null;

  readonly finalizedActual: RelayMoney | null;
  readonly provisionalActual: RelayMoney | null;
  readonly pendingKnown: RelayMoney | null;
  /** True when at least one pending receipt has no amount at all. */
  readonly hasUnknownPendingCost: boolean;
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
      finalizedActual: null,
      provisionalActual: null,
      pendingKnown: null,
      hasUnknownPendingCost: receipts.some((r) => isPending(r) && r.amount === null),
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
  const disputed = countable.filter((r) => r.status === 'disputed');

  if (disputed.length > 0) {
    warnings.push(
      `${disputed.length} disputed receipt(s) are excluded from the total until the dispute resolves`,
    );
  }
  if (hasUnknownPendingCost) {
    warnings.push('at least one pending receipt has no recorded amount — the projection is a lower bound');
  }

  /* ---- projected total = finalized + provisional + known pending + proposed ---- */
  const projectedParts = [finalizedActual, provisionalActual, pendingKnown, proposedCost].filter(
    (part): part is RelayMoney => part !== null,
  );
  const projectedSum = sumMoney(projectedParts);
  const projectedTotal = projectedSum.ok ? projectedSum.value : null;
  if (!projectedSum.ok) errors.push(projectedSum.error);

  /* ---- remaining ---- */
  let remainingBudget: RelayMoney | null = null;
  if (budget?.totalLimit && currency) {
    const spent = projectedTotal ?? zeroMoney(currency);
    const remaining = subtractMoney(budget.totalLimit, spent);
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
    } else {
      remaining = limit;
    }
    categoryEvaluations.push({
      category: category as RelayCostCategory,
      limit,
      spent,
      remaining,
      limitReached,
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
    hasUnknownPendingCost,
    proposedCostUnknown: Boolean(input.proposedCostUnknown),
    categoryLimitReached: categoryEvaluations.some((c) => c.limitReached),
    remainingBudget,
  });

  return {
    missionId: input.missionId,
    ...(budget ? { budgetId: budget.budgetId } : {}),
    currency,
    finalizedActual,
    provisionalActual,
    pendingKnown,
    hasUnknownPendingCost,
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
  hasUnknownPendingCost: boolean;
  proposedCostUnknown: boolean;
  categoryLimitReached: boolean;
  remainingBudget: RelayMoney | null;
}): RelayBudgetEvaluationStatus {
  if (!input.budget || input.budget.totalLimit === null) return 'not_configured';
  if (input.hardLimitReached) {
    // Exhausted means nothing remains at all; hard_limit_reached means this
    // operation cannot proceed. Both block, and they read differently.
    if (input.remainingBudget && BigInt(input.remainingBudget.amountMicros) <= 0n) return 'exhausted';
    return 'hard_limit_reached';
  }
  if (input.categoryLimitReached) return 'hard_limit_reached';
  if (input.approvalRequired) return 'approval_required';
  if (input.warningThresholdReached) return 'warning';
  // Unknown cost only downgrades the status when nothing more serious applies.
  if (input.hasUnknownPendingCost || input.proposedCostUnknown) return 'unknown_due_to_missing_cost';
  return 'under_budget';
}

/** The budget status to STORE, derived from an evaluation. */
export function budgetStatusFromEvaluation(
  evaluation: RelayBudgetEvaluation,
): RelayBudgetStatus {
  switch (evaluation.status) {
    case 'currency_conflict':
    case 'unknown_due_to_missing_cost':
      // Neither is a budget state; the stored budget keeps its own reading.
      return evaluation.warningThresholdReached ? 'warning' : 'under_budget';
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
