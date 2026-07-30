/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 5
 * Mission economics aggregation, completeness, and verified mission cost
 * (PURE, exact, deterministic).
 *
 * The question this answers is COST PER VERIFIED MISSION, not cost per model
 * call. A cheap call that causes three repairs and a human intervention is
 * expensive; an expensive call that lands a verified result first time is
 * cheap. Only the mission-level number tells the truth.
 *
 * `verifiedMissionCost` is therefore deliberately hard to obtain: it requires
 * a satisfied outcome, a VERIFIED verification, complete actual costs, no
 * material dispute, no currency conflict, and trace integrity. Execution
 * completing, a reviewer finishing, a completion claim, or a release being
 * approved are none of those things.
 */

import type { RelayBudgetEvaluation } from './budget-evaluation';
import type { RelayCostCategory, RelayCostReceipt } from './cost-receipt-types';
import { isFinalizedActual, isProvisionalActual } from './cost-receipt-types';
import { sumMoney, type RelayMoney } from './money';

/**
 * The Milestone 1 four-status model, described STRUCTURALLY so the economics
 * core stays dependency-free and can be carried byte-identically by both
 * surfaces. The website passes its real `AqualaOutcomeStatus` directly.
 */
export interface RelayMissionStatusSnapshot {
  readonly executionStatus: string;
  readonly outcomeStatus: string;
  readonly verificationStatus: string;
  readonly releaseStatus: string;
}

export const RELAY_ECONOMICS_COMPLETENESS = [
  'not_available',
  'estimated_only',
  'partial',
  'complete',
  'disputed',
  'currency_conflict',
] as const;
export type RelayEconomicsCompleteness = (typeof RELAY_ECONOMICS_COMPLETENESS)[number];

/** The categories reported in the summary, in display order. */
export const SUMMARY_CATEGORIES: readonly RelayCostCategory[] = [
  'planning',
  'model_inference',
  'agent_execution',
  'tool_execution',
  'workspace',
  'testing',
  'build',
  'review',
  'repair',
  'retry',
  'infrastructure',
  'human_intervention',
];

export type RelayCategoryTotals = Readonly<Partial<Record<RelayCostCategory, RelayMoney | null>>>;

export interface RelayMissionEconomics {
  readonly projectId: string;
  readonly missionId: string;
  readonly missionRevision: number;

  readonly currency: string | null;

  readonly estimated: RelayCategoryTotals & { readonly total: RelayMoney | null };
  readonly actual: RelayCategoryTotals & {
    readonly adjustments: RelayMoney | null;
    readonly total: RelayMoney | null;
  };

  readonly receiptCounts: {
    readonly pending: number;
    readonly provisional: number;
    readonly finalized: number;
    readonly disputed: number;
    readonly voided: number;
  };

  readonly completeness: RelayEconomicsCompleteness;
  readonly budgetEvaluation: RelayBudgetEvaluation;

  /** Only present when the mission genuinely earned the number. */
  readonly verifiedMissionCost: RelayMoney | null;
  readonly verifiedMissionCostReason: string;

  /**
   * WHERE THESE FIGURES CAME FROM, derived from the receipts themselves so no
   * surface can present development data as a real mission by forgetting to
   * pass a flag. `mixed` is reported rather than rounded to either side.
   */
  readonly dataSource: RelayEconomicsDataSource;

  readonly generatedAt: string;
}

export const RELAY_ECONOMICS_DATA_SOURCES = [
  'no_data',
  'live_mission',
  'development_fixture',
  'mixed',
] as const;
export type RelayEconomicsDataSource = (typeof RELAY_ECONOMICS_DATA_SOURCES)[number];

function deriveDataSource(countable: readonly RelayCostReceipt[]): RelayEconomicsDataSource {
  if (countable.length === 0) return 'no_data';
  const fixture = countable.filter((r) => r.source === 'development_fixture').length;
  if (fixture === 0) return 'live_mission';
  return fixture === countable.length ? 'development_fixture' : 'mixed';
}

export interface AggregateMissionEconomicsInput {
  projectId: string;
  missionId: string;
  missionRevision: number;
  receipts: readonly RelayCostReceipt[];
  budgetEvaluation: RelayBudgetEvaluation;
  /** The Milestone 1 four-status model at mission scope. */
  missionStatus?: RelayMissionStatusSnapshot;
  /** Categories the mission's policy requires before cost is "complete". */
  requiredCategories?: readonly RelayCostCategory[];
  /** Trace integrity, when a chain verification was performed. */
  traceIntegrityVerified?: boolean;
  /** Caller-supplied instant — the domain never reads a clock. */
  generatedAt: string;
}

function totalFor(
  receipts: readonly RelayCostReceipt[],
  category: RelayCostCategory,
  predicate: (receipt: RelayCostReceipt) => boolean,
): RelayMoney | null {
  const amounts = receipts
    .filter((r) => r.category === category && predicate(r) && r.amount !== null)
    .map((r) => r.amount as RelayMoney);
  if (amounts.length === 0) return null; // UNKNOWN, never zero.
  const total = sumMoney(amounts);
  return total.ok ? total.value : null;
}

function sumOfKnown(values: readonly (RelayMoney | null)[]): RelayMoney | null {
  const known = values.filter((v): v is RelayMoney => v !== null);
  if (known.length === 0) return null;
  const total = sumMoney(known);
  return total.ok ? total.value : null;
}

export function aggregateMissionEconomics(
  input: AggregateMissionEconomicsInput,
): RelayMissionEconomics {
  const { receipts, budgetEvaluation } = input;

  const countable = receipts.filter((r) => r.status !== 'voided');
  const currencyConflict = budgetEvaluation.status === 'currency_conflict';

  const receiptCounts = {
    pending: receipts.filter((r) => r.status === 'pending').length,
    provisional: receipts.filter((r) => r.status === 'provisional').length,
    finalized: receipts.filter((r) => r.status === 'finalized').length,
    disputed: receipts.filter((r) => r.status === 'disputed').length,
    voided: receipts.filter((r) => r.status === 'voided').length,
  };

  /* Estimated and actual are separate ledgers and never mix. */
  const isEstimate = (r: RelayCostReceipt) => r.costClass === 'estimated' && r.status !== 'disputed';
  const isActual = (r: RelayCostReceipt) =>
    (isFinalizedActual(r) || isProvisionalActual(r)) && r.status !== 'disputed';

  const estimated: Partial<Record<RelayCostCategory, RelayMoney | null>> = {};
  const actual: Partial<Record<RelayCostCategory, RelayMoney | null>> = {};

  if (!currencyConflict) {
    for (const category of SUMMARY_CATEGORIES) {
      estimated[category] = totalFor(countable, category, isEstimate);
      actual[category] = totalFor(countable, category, isActual);
    }
  }

  // Adjustments are applied EXACTLY ONCE, as their own line.
  const adjustments = currencyConflict
    ? null
    : totalFor(countable, 'adjustment', (r) => r.status === 'finalized');

  const estimatedTotal = currencyConflict
    ? null
    : sumOfKnown(SUMMARY_CATEGORIES.map((c) => estimated[c] ?? null));

  // Provider spend excludes human-time valuation; the adjustment line is
  // added once on top of the category totals.
  const actualTotal = currencyConflict
    ? null
    : sumOfKnown([...SUMMARY_CATEGORIES.map((c) => actual[c] ?? null), adjustments]);

  const completeness = deriveCompleteness({
    currencyConflict,
    receiptCounts,
    countable,
    actual,
    requiredCategories: input.requiredCategories ?? [],
  });

  const verified = deriveVerifiedMissionCost({
    missionStatus: input.missionStatus,
    completeness,
    actualTotal,
    traceIntegrityVerified: input.traceIntegrityVerified,
  });

  return {
    projectId: input.projectId,
    missionId: input.missionId,
    missionRevision: input.missionRevision,
    currency: budgetEvaluation.currency,
    estimated: { ...estimated, total: estimatedTotal },
    actual: { ...actual, adjustments, total: actualTotal },
    receiptCounts,
    completeness,
    budgetEvaluation,
    verifiedMissionCost: verified.cost,
    verifiedMissionCostReason: verified.reason,
    dataSource: deriveDataSource(countable),
    generatedAt: input.generatedAt,
  };
}

function deriveCompleteness(input: {
  currencyConflict: boolean;
  receiptCounts: RelayMissionEconomics['receiptCounts'];
  countable: readonly RelayCostReceipt[];
  actual: Partial<Record<RelayCostCategory, RelayMoney | null>>;
  requiredCategories: readonly RelayCostCategory[];
}): RelayEconomicsCompleteness {
  if (input.currencyConflict) return 'currency_conflict';
  if (input.receiptCounts.disputed > 0) return 'disputed';

  const hasActual = input.countable.some((r) => isFinalizedActual(r) || isProvisionalActual(r));
  const hasEstimate = input.countable.some((r) => r.costClass === 'estimated');
  if (!hasActual && !hasEstimate) return 'not_available';
  if (!hasActual) return 'estimated_only';

  // Anything still open, or any required category with no actual figure,
  // means the picture is partial — not complete.
  const stillOpen =
    input.receiptCounts.pending > 0 ||
    input.receiptCounts.provisional > 0 ||
    input.countable.some((r) => r.status !== 'voided' && r.costClass === 'actual' && r.amount === null);
  if (stillOpen) return 'partial';

  for (const category of input.requiredCategories) {
    if (!input.actual[category]) return 'partial';
  }
  return 'complete';
}

function deriveVerifiedMissionCost(input: {
  missionStatus?: RelayMissionStatusSnapshot;
  completeness: RelayEconomicsCompleteness;
  actualTotal: RelayMoney | null;
  traceIntegrityVerified?: boolean;
}): { cost: RelayMoney | null; reason: string } {
  const status = input.missionStatus;
  if (!status) {
    return { cost: null, reason: 'the mission status is unknown to the economics layer' };
  }
  // Outcome and verification are BOTH required, and neither is implied by
  // execution completing or by a reviewer process finishing.
  if (status.outcomeStatus !== 'satisfied') {
    return {
      cost: null,
      reason: `the mission outcome is "${status.outcomeStatus}", not satisfied — a cost is only a verified-mission cost when the mission actually succeeded`,
    };
  }
  if (status.verificationStatus !== 'verified') {
    return {
      cost: null,
      reason: `verification is "${status.verificationStatus}", not verified — completion is not verification`,
    };
  }
  if (input.completeness !== 'complete') {
    return {
      cost: null,
      reason: `cost records are "${input.completeness}" — a verified-mission cost cannot be presented while costs are incomplete`,
    };
  }
  if (input.traceIntegrityVerified === false) {
    return {
      cost: null,
      reason: 'trace integrity verification failed — the cost record cannot be trusted',
    };
  }
  if (!input.actualTotal) {
    return { cost: null, reason: 'no actual cost total is available' };
  }
  return {
    cost: input.actualTotal,
    reason: 'outcome satisfied, verification verified, and all required actual costs are complete',
  };
}
