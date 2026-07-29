/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 5
 * Economics → Aquala Trace adapters, and the Milestone 2/3 boundaries (PURE).
 *
 * Adapters translate; they never write. Each returns a trace event DRAFT — the
 * Milestone 4 ledger still allocates the sequence, binds the previous hash,
 * redacts, and hashes, so nothing here can forge a trace entry and no UI or
 * CLI component ever appends an event directly.
 *
 * What a cost event may carry: ids, an amount in canonical serialized form,
 * currency, category, source, status, revisions, and budget references. What
 * it may never carry: a provider credential, a billing credential, a PSP
 * secret, payment or bank details, a raw invoice document, or a raw provider
 * response.
 */

import type { AqualaTraceEventDraft } from '../trace/trace-types';
import type { RelayBudgetEvaluation } from './budget-evaluation';
import type { RelayBudgetApproval, RelayMissionBudget } from './budget-types';
import type { RelayCostReceipt } from './cost-receipt-types';
import type { RelayMissionEconomics } from './economics-aggregation';
import type { RelayMoney } from './money';

/** Economics event types this milestone contributes to the trace registry. */
export const RELAY_ECONOMICS_TRACE_EVENT_TYPES = [
  'cost_receipt_created',
  'cost_receipt_finalized',
  'cost_receipt_disputed',
  'cost_receipt_voided',
  'cost_adjustment_recorded',
  'mission_budget_created',
  'mission_budget_warning_reached',
  'mission_budget_approval_required',
  'mission_budget_increase_approved',
  'mission_budget_hard_limit_reached',
  'mission_economics_recalculated',
  'verified_mission_cost_calculated',
] as const;
export type RelayEconomicsTraceEventType =
  (typeof RELAY_ECONOMICS_TRACE_EVENT_TYPES)[number];

export interface EconomicsTraceOptions {
  traceId: string;
  eventId: string;
  occurredAt: string;
  actorId?: string;
  sourceService?: string;
}

/** Canonical serialized money for trace metadata — strings, never BigInt. */
function moneyMetadata(value: RelayMoney | null): Record<string, unknown> {
  if (!value) return { amountMicros: null, currency: null };
  return { amountMicros: value.amountMicros, currency: value.currency };
}

function base(
  options: EconomicsTraceOptions,
  scope: { projectId: string; missionId: string; missionRevision: number },
): Pick<
  AqualaTraceEventDraft,
  'eventId' | 'traceId' | 'projectId' | 'missionId' | 'missionRevision' | 'sourceProduct' | 'occurredAt' | 'eventFamily' | 'actorType'
> {
  return {
    eventId: options.eventId,
    traceId: options.traceId,
    projectId: scope.projectId,
    missionId: scope.missionId,
    missionRevision: scope.missionRevision,
    sourceProduct: 'sunday_relay',
    occurredAt: options.occurredAt,
    eventFamily: 'economics',
    actorType: 'system',
  };
}

/** Receipt metadata that is safe to persist in a permanent, shared ledger. */
function receiptMetadata(receipt: RelayCostReceipt): Record<string, unknown> {
  return {
    receiptId: receipt.receiptId,
    category: receipt.category,
    costClass: receipt.costClass,
    status: receipt.status,
    source: receipt.source,
    integrity: receipt.integrity,
    ...moneyMetadata(receipt.amount),
    ...(receipt.taskId ? { taskId: receipt.taskId } : {}),
    ...(receipt.runId ? { runId: receipt.runId } : {}),
    ...(receipt.capsuleId ? { capsuleId: receipt.capsuleId } : {}),
    ...(receipt.actualAgentId ? { actualAgentId: receipt.actualAgentId } : {}),
    ...(receipt.requestedAgentId ? { requestedAgentId: receipt.requestedAgentId } : {}),
    ...(receipt.pspVersionId ? { pspVersionId: receipt.pspVersionId } : {}),
    ...(receipt.providerId ? { providerId: receipt.providerId } : {}),
    ...(receipt.rateReferenceId ? { rateReferenceId: receipt.rateReferenceId } : {}),
    ...(receipt.adjustmentOfReceiptId
      ? { adjustmentOfReceiptId: receipt.adjustmentOfReceiptId }
      : {}),
  };
}

function receiptEvent(
  receipt: RelayCostReceipt,
  eventType: RelayEconomicsTraceEventType,
  options: EconomicsTraceOptions,
): AqualaTraceEventDraft {
  return {
    ...base(options, receipt),
    eventType,
    ...(receipt.taskId ? { taskId: receipt.taskId } : {}),
    ...(receipt.runId ? { runId: receipt.runId } : {}),
    ...(receipt.capsuleId ? { capsuleId: receipt.capsuleId } : {}),
    sourceService: options.sourceService ?? 'relay-cost-service',
    actorId: options.actorId ?? 'relay-cost-service',
    // A provider-reported figure is an OBSERVATION; Relay does not attest it.
    sourceTrust: receipt.integrity === 'source_attested' ? 'attested' : 'observed',
    metadata: receiptMetadata(receipt),
  };
}

export const adaptReceiptCreated = (receipt: RelayCostReceipt, options: EconomicsTraceOptions) =>
  receiptEvent(receipt, 'cost_receipt_created', options);

export const adaptReceiptFinalized = (receipt: RelayCostReceipt, options: EconomicsTraceOptions) =>
  receiptEvent(receipt, 'cost_receipt_finalized', options);

export const adaptReceiptDisputed = (receipt: RelayCostReceipt, options: EconomicsTraceOptions) =>
  receiptEvent(receipt, 'cost_receipt_disputed', options);

export const adaptReceiptVoided = (receipt: RelayCostReceipt, options: EconomicsTraceOptions) =>
  receiptEvent(receipt, 'cost_receipt_voided', options);

export const adaptAdjustmentRecorded = (receipt: RelayCostReceipt, options: EconomicsTraceOptions) =>
  receiptEvent(receipt, 'cost_adjustment_recorded', options);

/* -------------------------------------------------------------- budgets */

function budgetEvent(
  budget: RelayMissionBudget,
  eventType: RelayEconomicsTraceEventType,
  options: EconomicsTraceOptions,
  extra: Record<string, unknown> = {},
): AqualaTraceEventDraft {
  return {
    ...base(options, budget),
    eventType,
    sourceService: options.sourceService ?? 'relay-budget-service',
    actorId: options.actorId ?? 'relay-budget-service',
    sourceTrust: 'observed',
    metadata: {
      budgetId: budget.budgetId,
      budgetStatus: budget.status,
      policyVersion: budget.policyVersion,
      currency: budget.currency,
      hardLimitEnabled: budget.hardLimitEnabled,
      warningThresholdBasisPoints: budget.warningThresholdBasisPoints,
      totalLimit: budget.totalLimit ? budget.totalLimit.amountMicros : null,
      ...extra,
    },
  };
}

export const adaptBudgetCreated = (budget: RelayMissionBudget, options: EconomicsTraceOptions) =>
  budgetEvent(budget, 'mission_budget_created', options);

export const adaptBudgetWarningReached = (
  budget: RelayMissionBudget,
  evaluation: RelayBudgetEvaluation,
  options: EconomicsTraceOptions,
) =>
  budgetEvent(budget, 'mission_budget_warning_reached', options, {
    projectedTotal: evaluation.projectedTotal?.amountMicros ?? null,
    remaining: evaluation.remainingBudget?.amountMicros ?? null,
  });

export const adaptBudgetApprovalRequired = (
  budget: RelayMissionBudget,
  evaluation: RelayBudgetEvaluation,
  options: EconomicsTraceOptions,
) =>
  budgetEvent(budget, 'mission_budget_approval_required', options, {
    projectedTotal: evaluation.projectedTotal?.amountMicros ?? null,
    blockingReasons: [...evaluation.blockingReasons],
  });

export const adaptBudgetHardLimitReached = (
  budget: RelayMissionBudget,
  evaluation: RelayBudgetEvaluation,
  options: EconomicsTraceOptions,
) =>
  budgetEvent(budget, 'mission_budget_hard_limit_reached', options, {
    projectedTotal: evaluation.projectedTotal?.amountMicros ?? null,
    blockingReasons: [...evaluation.blockingReasons],
  });

export function adaptBudgetIncreaseApproved(
  budget: RelayMissionBudget,
  approval: RelayBudgetApproval,
  options: EconomicsTraceOptions,
): AqualaTraceEventDraft {
  return budgetEvent(budget, 'mission_budget_increase_approved', options, {
    approvalId: approval.approvalId,
    commandId: approval.commandId,
    previousLimit: approval.previousLimit?.amountMicros ?? null,
    approvedLimit: approval.approvedLimit.amountMicros,
    requestedByActorId: approval.requestedByActorId,
    approvedByActorId: approval.approvedByActorId,
  });
}

/* ------------------------------------------------------------ summaries */

export function adaptEconomicsRecalculated(
  economics: RelayMissionEconomics,
  options: EconomicsTraceOptions,
): AqualaTraceEventDraft {
  return {
    ...base(options, economics),
    eventType: 'mission_economics_recalculated',
    sourceService: options.sourceService ?? 'relay-cost-service',
    actorId: options.actorId ?? 'relay-cost-service',
    sourceTrust: 'observed',
    metadata: {
      completeness: economics.completeness,
      currency: economics.currency,
      actualTotal: economics.actual.total?.amountMicros ?? null,
      estimatedTotal: economics.estimated.total?.amountMicros ?? null,
      budgetStatus: economics.budgetEvaluation.status,
      receiptCounts: { ...economics.receiptCounts },
    },
  };
}

/**
 * Emitted ONLY when the mission genuinely earned a verified-mission cost.
 * Returns null otherwise, so the trace can never carry a verified cost the
 * economics layer refused to calculate.
 */
export function adaptVerifiedMissionCost(
  economics: RelayMissionEconomics,
  options: EconomicsTraceOptions,
): AqualaTraceEventDraft | null {
  if (!economics.verifiedMissionCost) return null;
  return {
    ...base(options, economics),
    eventType: 'verified_mission_cost_calculated',
    sourceService: options.sourceService ?? 'relay-verification',
    actorId: options.actorId ?? 'relay-verification',
    // A verified-mission cost is a verification-service conclusion.
    sourceTrust: 'verified',
    metadata: {
      ...moneyMetadata(economics.verifiedMissionCost),
      completeness: economics.completeness,
      reason: economics.verifiedMissionCostReason,
    },
  };
}

/* -------------------------------------- Milestone 2 command integration */

/**
 * The economics half of a `change_budget` command preview. The command domain
 * owns the intent, the risk, and the approval prerequisite — this only
 * supplies the truthful numbers, including saying when a projection cannot be
 * stated exactly.
 */
export interface BudgetChangePreviewLines {
  readonly currentFinalizedSpend: string;
  readonly knownProvisionalSpend: string;
  readonly knownPendingCost: string;
  readonly proposedEstimatedCost: string;
  readonly projectedTotal: string;
  readonly remainingBudget: string;
  readonly warningStatus: string;
  readonly approvalStatus: string;
  readonly hardLimitStatus: string;
  readonly unknownCostWarning: string | null;
}

export function buildBudgetChangePreview(
  evaluation: RelayBudgetEvaluation,
  format: (value: RelayMoney | null) => string,
): BudgetChangePreviewLines {
  return {
    currentFinalizedSpend: format(evaluation.finalizedActual),
    knownProvisionalSpend: format(evaluation.provisionalActual),
    knownPendingCost: format(evaluation.pendingKnown),
    proposedEstimatedCost: format(evaluation.proposedCost),
    projectedTotal: evaluation.hasUnknownPendingCost
      ? `${format(evaluation.projectedTotal)} (lower bound — some costs are unknown)`
      : format(evaluation.projectedTotal),
    remainingBudget: format(evaluation.remainingBudget),
    warningStatus: evaluation.warningThresholdReached ? 'Warning threshold reached' : 'Below warning threshold',
    approvalStatus: evaluation.approvalRequired ? 'Approval required' : 'No approval required',
    hardLimitStatus: evaluation.hardLimitReached ? 'Hard limit reached — blocked' : 'Within hard limit',
    unknownCostWarning: evaluation.hasUnknownPendingCost
      ? 'Some recorded costs have no amount yet, so the projected total is a lower bound.'
      : null,
  };
}

/* ------------------------------------- Milestone 3 capsule integration */

/**
 * The receipt ids a capsule should link, given the mission's receipts. The
 * capsule stores IDS only — never a receipt payload — and linking a cost
 * never changes identity, review credit, verification, or release.
 */
export function capsuleReceiptIds(
  receipts: readonly RelayCostReceipt[],
  capsuleId: string,
): string[] {
  const ids: string[] = [];
  for (const receipt of receipts) {
    if (receipt.capsuleId === capsuleId && !ids.includes(receipt.receiptId)) {
      ids.push(receipt.receiptId);
    }
  }
  return ids;
}
