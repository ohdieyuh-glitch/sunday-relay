/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 5
 * Mission Economics — public surface (SHARED between website and CLI).
 *
 * Cost receipts, mission budgets, exact money, aggregation, and the one
 * projection both surfaces render. Missing cost stays missing; estimated and
 * actual never blur; a requested agent is never billed for work it did not
 * verifiably do; and a verified-mission cost is only ever calculated when the
 * mission genuinely earned it.
 *
 * See docs/relay/MISSION_ECONOMICS.md.
 */

export * from './economics-errors';
export * from './money';
export * from './cost-receipt-types';
export {
  createCostReceipt,
  createAdjustment,
  markProvisional,
  finalizeReceipt,
  disputeReceipt,
  voidReceipt,
  attachSourceAttestation,
  attachTraceVerification,
  type CreateCostReceiptInput,
  type CreateAdjustmentInput,
} from './cost-receipt-service';
export {
  InMemoryCostReceiptRepository,
  attributionDrift,
} from './cost-receipt-repository';
export {
  RELAY_BUDGET_STATUSES,
  BASIS_POINTS_SCALE,
  createMissionBudget,
  createBudgetApproval,
  applyApprovedIncrease,
  type RelayMissionBudget,
  type RelayBudgetApproval,
  type RelayBudgetStatus,
  type CreateMissionBudgetInput,
} from './budget-types';
export {
  RELAY_BUDGET_EVALUATION_STATUSES,
  evaluateMissionBudget,
  budgetStatusFromEvaluation,
  type RelayBudgetEvaluation,
  type RelayBudgetEvaluationStatus,
  type RelayBudgetCategoryEvaluation,
  type EvaluateMissionBudgetInput,
} from './budget-evaluation';
export {
  RELAY_ECONOMICS_COMPLETENESS,
  RELAY_ECONOMICS_DATA_SOURCES,
  SUMMARY_CATEGORIES,
  aggregateMissionEconomics,
  type RelayMissionEconomics,
  type RelayEconomicsCompleteness,
  type RelayEconomicsDataSource,
  type AggregateMissionEconomicsInput,
} from './economics-aggregation';
export {
  UNKNOWN_LABEL,
  NOT_AVAILABLE_LABEL,
  PENDING_LABEL,
  NOT_CONFIGURED_LABEL,
  AT_LEAST_PREFIX,
  AT_MOST_PREFIX,
  SIMULATED_DATA_LABEL,
  MIXED_DATA_LABEL,
  NO_DATA_LABEL,
  amountLabel,
  boundedLabel,
  projectMissionEconomics,
  type RelayMissionEconomicsProjection,
  type RelayEconomicsCategoryProjection,
} from './economics-projection';
export {
  RELAY_ECONOMICS_TRACE_EVENT_TYPES,
  adaptReceiptCreated,
  adaptReceiptFinalized,
  adaptReceiptDisputed,
  adaptReceiptVoided,
  adaptAdjustmentRecorded,
  adaptBudgetCreated,
  adaptBudgetWarningReached,
  adaptBudgetApprovalRequired,
  adaptBudgetHardLimitReached,
  adaptBudgetIncreaseApproved,
  adaptEconomicsRecalculated,
  adaptVerifiedMissionCost,
  buildBudgetChangePreview,
  capsuleReceiptIds,
  type RelayEconomicsTraceEventType,
  type EconomicsTraceOptions,
  type BudgetChangePreviewLines,
} from './economics-trace-adapter';
