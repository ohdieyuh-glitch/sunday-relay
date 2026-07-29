/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 5
 * The SHARED mission economics projection (PURE).
 *
 * This is what makes website/CLI parity real rather than aspirational: both
 * surfaces render THIS object. The website styles it; the CLI prints it; the
 * semantics — every label, every status, every "Unknown" — are decided here,
 * once, so the two surfaces cannot drift.
 *
 * The rule that governs every label: a missing amount renders as "Unknown",
 * "Pending", or "Not available". It NEVER renders as $0.00, because a
 * fabricated zero is the one number an operator will act on and shouldn't.
 *
 * No React, no terminal escape codes, no clock, no currency conversion.
 */

import type { RelayBudgetEvaluation, RelayBudgetEvaluationStatus } from './budget-evaluation';
import type { RelayCostCategory } from './cost-receipt-types';
import type { RelayEconomicsCompleteness, RelayMissionEconomics } from './economics-aggregation';
import { SUMMARY_CATEGORIES } from './economics-aggregation';
import { formatMoney, type RelayMoney } from './money';

/** The one place a missing amount becomes words. */
export const UNKNOWN_LABEL = 'Unknown';
export const NOT_AVAILABLE_LABEL = 'Not available';
export const PENDING_LABEL = 'Pending';
export const NOT_CONFIGURED_LABEL = 'Not configured';

export interface RelayEconomicsCategoryProjection {
  readonly category: RelayCostCategory;
  readonly label: string;
  readonly estimatedLabel: string;
  readonly actualLabel: string;
  readonly statusLabel: string;
}

export interface RelayMissionEconomicsProjection {
  readonly missionId: string;
  readonly missionRevision: number;

  readonly currency: string | null;

  readonly budgetLabel: string;
  readonly finalizedActualLabel: string;
  readonly provisionalActualLabel: string;
  readonly pendingLabel: string;
  readonly projectedTotalLabel: string;
  readonly remainingLabel: string;

  readonly statusLabel: string;
  readonly completenessLabel: string;

  readonly warning: boolean;
  readonly approvalRequired: boolean;
  readonly hardLimitReached: boolean;

  readonly categories: readonly RelayEconomicsCategoryProjection[];

  readonly verifiedMissionCostLabel: string;

  /** Truthful, non-alarming notices an operator needs to see. */
  readonly safeNotices: readonly string[];
}

const CATEGORY_LABELS: Record<RelayCostCategory, string> = {
  planning: 'Planning',
  model_inference: 'Model',
  agent_execution: 'Agent execution',
  tool_execution: 'Tools',
  workspace: 'Workspace',
  testing: 'Testing',
  build: 'Build',
  review: 'Review',
  repair: 'Repair',
  retry: 'Retry',
  infrastructure: 'Infrastructure',
  human_intervention: 'Human intervention',
  adjustment: 'Adjustments',
};

const STATUS_LABELS: Record<RelayBudgetEvaluationStatus, string> = {
  not_configured: 'No budget configured',
  under_budget: 'Under budget',
  warning: 'Warning threshold reached',
  approval_required: 'Approval required',
  hard_limit_reached: 'Hard limit reached',
  exhausted: 'Budget exhausted',
  unknown_due_to_missing_cost: 'Unknown — cost data missing',
  currency_conflict: 'Currency conflict — no combined total',
};

const COMPLETENESS_LABELS: Record<RelayEconomicsCompleteness, string> = {
  not_available: 'Not available',
  estimated_only: 'Estimated only',
  partial: 'Partial',
  complete: 'Complete',
  disputed: 'Disputed',
  currency_conflict: 'Currency conflict',
};

/** Money or an honest word — never a fabricated zero. */
export function amountLabel(value: RelayMoney | null, missing = UNKNOWN_LABEL): string {
  return value === null ? missing : formatMoney(value);
}

export function projectMissionEconomics(
  economics: RelayMissionEconomics,
): RelayMissionEconomicsProjection {
  const evaluation: RelayBudgetEvaluation = economics.budgetEvaluation;
  const conflict = evaluation.status === 'currency_conflict';

  const categories = SUMMARY_CATEGORIES.map((category) => {
    const estimated = economics.estimated[category] ?? null;
    const actual = economics.actual[category] ?? null;
    return {
      category,
      label: CATEGORY_LABELS[category],
      estimatedLabel: amountLabel(estimated, NOT_AVAILABLE_LABEL),
      actualLabel: amountLabel(actual, NOT_AVAILABLE_LABEL),
      statusLabel:
        actual !== null
          ? 'Recorded'
          : estimated !== null
            ? 'Estimated only'
            : NOT_AVAILABLE_LABEL,
    };
  });

  const safeNotices: string[] = [];
  if (conflict) {
    safeNotices.push(
      'This mission mixes currencies. Relay performs no conversion, so no combined total is shown.',
    );
  }
  if (evaluation.hasUnknownPendingCost) {
    safeNotices.push(
      'At least one pending receipt has no recorded amount — the projected total is a lower bound.',
    );
  }
  if (economics.receiptCounts.disputed > 0) {
    safeNotices.push(
      `${economics.receiptCounts.disputed} disputed receipt(s) are held out of the total until resolved.`,
    );
  }
  if (economics.receiptCounts.voided > 0) {
    safeNotices.push(
      `${economics.receiptCounts.voided} voided receipt(s) remain inspectable but are not counted.`,
    );
  }
  if (evaluation.status === 'not_configured') {
    safeNotices.push('No mission budget is configured. This is not the same as unlimited spending.');
  }
  for (const warning of evaluation.warnings) {
    if (!safeNotices.some((notice) => notice.includes(warning))) safeNotices.push(warning);
  }
  for (const reason of evaluation.blockingReasons) safeNotices.push(reason);
  if (economics.verifiedMissionCost === null) {
    safeNotices.push(`Verified mission cost unavailable: ${economics.verifiedMissionCostReason}.`);
  }

  return {
    missionId: economics.missionId,
    missionRevision: economics.missionRevision,
    currency: economics.currency,

    budgetLabel: conflict
      ? NOT_AVAILABLE_LABEL
      : evaluation.status === 'not_configured'
        ? NOT_CONFIGURED_LABEL
        : amountLabel(evaluation.remainingBudget !== null || evaluation.projectedTotal !== null
            ? budgetTotalOf(evaluation)
            : null, NOT_CONFIGURED_LABEL),
    finalizedActualLabel: amountLabel(evaluation.finalizedActual, NOT_AVAILABLE_LABEL),
    provisionalActualLabel: amountLabel(evaluation.provisionalActual, NOT_AVAILABLE_LABEL),
    pendingLabel: evaluation.hasUnknownPendingCost
      ? `${amountLabel(evaluation.pendingKnown, PENDING_LABEL)} + unknown`
      : amountLabel(evaluation.pendingKnown, NOT_AVAILABLE_LABEL),
    projectedTotalLabel: amountLabel(evaluation.projectedTotal, UNKNOWN_LABEL),
    remainingLabel: amountLabel(evaluation.remainingBudget, NOT_AVAILABLE_LABEL),

    statusLabel: STATUS_LABELS[evaluation.status],
    completenessLabel: COMPLETENESS_LABELS[economics.completeness],

    warning: evaluation.warningThresholdReached,
    approvalRequired: evaluation.approvalRequired,
    hardLimitReached: evaluation.hardLimitReached,

    categories,

    verifiedMissionCostLabel: amountLabel(economics.verifiedMissionCost, NOT_AVAILABLE_LABEL),

    safeNotices,
  };
}

/** Reconstructs the configured total from the evaluation, when there is one. */
function budgetTotalOf(evaluation: RelayBudgetEvaluation): RelayMoney | null {
  if (!evaluation.remainingBudget || !evaluation.projectedTotal) return null;
  const micros =
    BigInt(evaluation.remainingBudget.amountMicros) + BigInt(evaluation.projectedTotal.amountMicros);
  return { currency: evaluation.remainingBudget.currency, amountMicros: micros.toString() };
}
