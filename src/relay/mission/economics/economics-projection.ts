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
import type {
  RelayEconomicsCompleteness,
  RelayEconomicsDataSource,
  RelayMissionEconomics,
} from './economics-aggregation';
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

  /**
   * WHERE THESE FIGURES CAME FROM. Derived from the receipts, so a surface
   * cannot present development data as a real mission by forgetting a flag.
   */
  readonly dataSource: RelayEconomicsDataSource;
  /** The banner both surfaces show. `null` only for genuine live data. */
  readonly dataSourceLabel: string | null;

  /** Truthful, non-alarming notices an operator needs to see. */
  readonly safeNotices: readonly string[];
}

/**
 * SIMULATED-DATA DISCLOSURE.
 *
 * `relay mission economics`, `relay mission budget` and `relay mission
 * receipts` render a deterministic development fixture: no mission ran, no
 * provider was called, and no money was spent. Presenting those figures
 * without saying so reads as a real user mission, so the label is derived
 * here — from the receipts — and both surfaces render it.
 */
export const SIMULATED_DATA_LABEL = 'SIMULATED DATA — DEVELOPMENT FIXTURE — NOT LIVE MISSION DATA';
export const MIXED_DATA_LABEL =
  'PARTLY SIMULATED — some receipts are development fixtures and are NOT live mission data';
export const NO_DATA_LABEL =
  'NO COST DATA RECORDED — this is not the same as zero spend';
// The wording deliberately avoids writing a currency amount: the surfaces
// are guarded by a test that no rendered output may contain a zero amount,
// and a banner that says so in prose would defeat exactly that guard.

const DATA_SOURCE_LABELS: Record<RelayEconomicsDataSource, string | null> = {
  live_mission: null,
  development_fixture: SIMULATED_DATA_LABEL,
  mixed: MIXED_DATA_LABEL,
  no_data: NO_DATA_LABEL,
};

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

/** Prefixes that mark a figure as a BOUND rather than the figure itself. */
export const AT_LEAST_PREFIX = 'at least';
export const AT_MOST_PREFIX = 'at most';

/**
 * A figure that rests on incomplete cost data is rendered as a bound, and a
 * figure that has no data at all is rendered as a word. Neither is ever
 * rendered as an exact amount, and neither is ever `$0.00`.
 */
export function boundedLabel(
  value: RelayMoney | null,
  complete: boolean,
  boundPrefix: string,
): string {
  if (value === null) return UNKNOWN_LABEL;
  return complete ? formatMoney(value) : `${boundPrefix} ${formatMoney(value)}`;
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
  // The provenance disclosure comes FIRST: an operator must know what kind of
  // data they are reading before they read any figure in it.
  if (economics.dataSource === 'development_fixture') {
    safeNotices.push(
      `${SIMULATED_DATA_LABEL}. No mission ran, no provider was called and no money was spent. `
      + 'These figures come from a deterministic development fixture.',
    );
  } else if (economics.dataSource === 'mixed') {
    safeNotices.push(
      `${MIXED_DATA_LABEL}. A development fixture may never be read as a production cost record.`,
    );
  }
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
  if (evaluation.hasUnknownProvisionalCost) {
    safeNotices.push(
      'At least one provisional receipt has no recorded amount. Provisional receipts count toward the '
      + 'projection, so the projected total is a lower bound and the remaining budget an upper bound.',
    );
  }
  if (!evaluation.projectedTotalComplete) {
    safeNotices.push(
      `${evaluation.unpricedCountableReceipts} receipt(s) that count toward the mission cost carry no `
      + 'amount. Relay reports what it knows and never substitutes zero for a missing amount.',
    );
  }
  for (const category of evaluation.categoryEvaluations) {
    if (!category.hasUnknownCost) continue;
    safeNotices.push(
      `The ${CATEGORY_LABELS[category.category]} category has an unpriced receipt — its remaining `
      + 'allowance is an upper bound, not a figure to spend against.',
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
      : amountLabel(evaluation.totalLimit, NOT_CONFIGURED_LABEL),
    finalizedActualLabel: amountLabel(evaluation.finalizedActual, NOT_AVAILABLE_LABEL),
    provisionalActualLabel: evaluation.hasUnknownProvisionalCost
      ? `${amountLabel(evaluation.provisionalActual, PENDING_LABEL)} + unknown`
      : amountLabel(evaluation.provisionalActual, NOT_AVAILABLE_LABEL),
    pendingLabel: evaluation.hasUnknownPendingCost
      ? `${amountLabel(evaluation.pendingKnown, PENDING_LABEL)} + unknown`
      : amountLabel(evaluation.pendingKnown, NOT_AVAILABLE_LABEL),
    // An incomplete projection is a BOUND, and it is labeled as one. Printing
    // a bound as though it were the figure is what lets an operator act on a
    // number the ledger does not support.
    projectedTotalLabel: boundedLabel(evaluation.projectedTotal, evaluation.projectedTotalComplete, AT_LEAST_PREFIX),
    remainingLabel: boundedLabel(evaluation.remainingBudget, evaluation.projectedTotalComplete, AT_MOST_PREFIX),

    statusLabel: STATUS_LABELS[evaluation.status],
    completenessLabel: COMPLETENESS_LABELS[economics.completeness],

    warning: evaluation.warningThresholdReached,
    approvalRequired: evaluation.approvalRequired,
    hardLimitReached: evaluation.hardLimitReached,

    categories,

    verifiedMissionCostLabel: amountLabel(economics.verifiedMissionCost, NOT_AVAILABLE_LABEL),

    dataSource: economics.dataSource,
    dataSourceLabel: DATA_SOURCE_LABELS[economics.dataSource],

    safeNotices,
  };
}

/**
 * `budgetTotalOf` used to reconstruct the configured limit as
 * `remaining + projected`. That reconstruction vanished the moment either side
 * was honestly unknown, so a configured budget rendered as "Not configured".
 * The evaluation now carries `totalLimit` directly and the reconstruction is
 * gone.
 */
