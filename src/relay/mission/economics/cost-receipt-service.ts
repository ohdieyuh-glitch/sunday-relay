/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 5
 * Cost receipt validation, lifecycle, and attribution (PURE).
 *
 * Every mutation is a NAMED operation with its own preconditions — there is
 * no generic setter and no delete. A finalized receipt is immutable; a
 * correction is a separate adjustment record that references the original and
 * leaves it exactly as it was.
 *
 * The attribution rule that matters most: a REQUESTED agent that never
 * verifiably launched can never be billed for execution. Cost follows the
 * agent Relay actually observed.
 */

import { redactEconomicsMetadata } from './economics-redaction';
import {
  economicsError,
  economicsFail,
  economicsOk,
  type EconomicsResult,
} from './economics-errors';
import { isNegative, isZero, type RelayMoney } from './money';
import {
  RELAY_COST_CATEGORIES,
  RELAY_COST_CLASSES,
  RELAY_RECEIPT_SOURCES,
  RELAY_RECEIPT_STATUSES,
  type RelayCostCategory,
  type RelayCostClass,
  type RelayCostReceipt,
  type RelayReceiptIntegrity,
  type RelayReceiptQuantity,
  type RelayReceiptSource,
  type RelayReceiptStatus,
} from './cost-receipt-types';

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const inner of Object.values(value as Record<string, unknown>)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

/* ------------------------------------------------------------ creation */

export interface CreateCostReceiptInput {
  receiptId: string;
  projectId: string;
  missionId: string;
  missionRevision: number;

  taskId?: string;
  taskRevision?: number;
  runId?: string;
  capsuleId?: string;
  commandId?: string;

  pspId?: string;
  pspVersionId?: string;

  requestedAgentId?: string;
  actualAgentId?: string;

  providerId?: string;
  modelId?: string;
  toolId?: string;
  workspaceId?: string;

  category: RelayCostCategory;
  costClass: RelayCostClass;
  status: RelayReceiptStatus;
  source: RelayReceiptSource;

  amount?: RelayMoney | null;
  quantity?: RelayReceiptQuantity;

  rateReferenceId?: string;
  providerUsageReferenceId?: string;
  adjustmentOfReceiptId?: string;
  adjustmentReason?: string;

  occurredAt: string;
  recordedAt: string;
  finalizedAt?: string;

  metadata?: Record<string, unknown>;
  integrity?: RelayReceiptIntegrity;
  /** True when a trusted supervisory source verified the agent's launch. */
  launchVerified?: boolean;
}

const required = (value: string | undefined): boolean => Boolean(value && value.trim());

/**
 * Validates and builds an immutable receipt. Metadata is redacted before
 * storage, so a provider response fragment can never carry a credential into
 * the record.
 */
export function createCostReceipt(
  input: CreateCostReceiptInput,
): EconomicsResult<RelayCostReceipt> {
  const fail = (
    code: Parameters<typeof economicsError>[0],
    reason: string,
    action: string,
    extra: Record<string, unknown> = {},
  ) =>
    economicsFail<RelayCostReceipt>(
      economicsError(code, reason, action, {
        receiptId: input.receiptId,
        missionId: input.missionId,
        missionRevision: input.missionRevision,
        category: input.category,
        ...extra,
      }),
    );

  if (!required(input.receiptId)) {
    return fail('COST_ATTRIBUTION_INVALID', 'a receipt requires an id', 'supply a receipt id', {
      field: 'receiptId',
    });
  }
  if (!required(input.projectId)) {
    return fail('COST_ATTRIBUTION_INVALID', 'a receipt requires a project id', 'supply the project id', {
      field: 'projectId',
    });
  }
  if (!required(input.missionId)) {
    return fail('COST_ATTRIBUTION_INVALID', 'a receipt requires a mission id', 'supply the mission id', {
      field: 'missionId',
    });
  }
  if (!Number.isInteger(input.missionRevision) || input.missionRevision <= 0) {
    return fail(
      'COST_ATTRIBUTION_INVALID',
      'mission revision must be a positive integer — a receipt stays bound to the revision it was incurred under',
      'supply the mission revision this cost belongs to',
      { field: 'missionRevision', actual: String(input.missionRevision) },
    );
  }
  if (!(RELAY_COST_CATEGORIES as readonly string[]).includes(input.category)) {
    return fail('INVALID_RECEIPT_CATEGORY', `"${input.category}" is not a cost category`, 'use a registered category', {
      field: 'category',
      actual: input.category,
    });
  }
  if (!(RELAY_COST_CLASSES as readonly string[]).includes(input.costClass)) {
    return fail('INVALID_RECEIPT_STATUS', `"${input.costClass}" is not a cost class`, 'use estimated or actual', {
      field: 'costClass',
      actual: input.costClass,
    });
  }
  if (!(RELAY_RECEIPT_STATUSES as readonly string[]).includes(input.status)) {
    return fail('INVALID_RECEIPT_STATUS', `"${input.status}" is not a receipt status`, 'use a registered status', {
      field: 'status',
      actual: input.status,
    });
  }
  if (!(RELAY_RECEIPT_SOURCES as readonly string[]).includes(input.source)) {
    return fail('INVALID_RECEIPT_STATUS', `"${input.source}" is not a receipt source`, 'use a registered source', {
      field: 'source',
      actual: input.source,
    });
  }

  const amount = input.amount ?? null;

  /* A finalized receipt must state what it cost. */
  if (input.status === 'finalized' && amount === null) {
    return fail(
      'RECEIPT_AMOUNT_REQUIRED',
      'a finalized receipt must carry an amount — finalizing an unknown cost would fabricate certainty',
      'supply the amount, or keep the receipt pending until it is known',
      { field: 'amount' },
    );
  }

  /* Only adjustments may be negative, and they must say what they correct. */
  if (amount !== null && isNegative(amount) && input.category !== 'adjustment') {
    return fail(
      'INVALID_ADJUSTMENT',
      'only an adjustment receipt may carry a negative amount',
      'record the correction as an adjustment referencing the original receipt',
      { field: 'amount', actual: amount.amountMicros },
    );
  }
  if (input.category === 'adjustment') {
    if (!required(input.adjustmentOfReceiptId)) {
      return fail(
        'INVALID_ADJUSTMENT',
        'an adjustment must identify the receipt it corrects',
        'supply adjustmentOfReceiptId',
        { field: 'adjustmentOfReceiptId' },
      );
    }
    if (!required(input.adjustmentReason)) {
      return fail(
        'INVALID_ADJUSTMENT',
        'an adjustment must state why the correction was made',
        'supply an adjustment reason such as refund, credit, or provider correction',
        { field: 'adjustmentReason' },
      );
    }
  }

  /* A provider-reported ACTUAL charge must be traceable to provider usage. */
  if (
    input.source === 'provider_reported' &&
    input.costClass === 'actual' &&
    input.status === 'finalized' &&
    !required(input.providerUsageReferenceId)
  ) {
    return fail(
      'COST_ATTRIBUTION_INVALID',
      'a finalized provider-reported actual cost must reference the provider usage record it came from',
      'supply providerUsageReferenceId',
      { field: 'providerUsageReferenceId' },
    );
  }

  /* A calculated amount needs the rate it was calculated from — Relay never
     invents a provider price. */
  if (
    input.source === 'relay_calculated' &&
    amount !== null &&
    !isZero(amount) &&
    !required(input.rateReferenceId)
  ) {
    return fail(
      'RATE_REFERENCE_REQUIRED',
      'a Relay-calculated amount must reference the rate it was derived from',
      'supply rateReferenceId, or record the amount as provider-reported',
      { field: 'rateReferenceId' },
    );
  }
  if (
    input.category === 'human_intervention' &&
    amount !== null &&
    !isZero(amount) &&
    !required(input.rateReferenceId)
  ) {
    return fail(
      'RATE_REFERENCE_REQUIRED',
      'valuing human time requires an explicit rate reference — Relay never invents an hourly rate',
      'configure a human-time rate reference, or record the time without an amount',
      { field: 'rateReferenceId' },
    );
  }

  /* Execution cost belongs to the agent that actually ran. */
  const attribution = validateAgentAttribution(input);
  if (!attribution.ok) return economicsFail(attribution.error);

  const redacted = redactEconomicsMetadata(input.metadata ?? {});
  const wasRedacted = JSON.stringify(redacted) !== JSON.stringify(input.metadata ?? {});

  const receipt: RelayCostReceipt = {
    receiptId: input.receiptId,
    projectId: input.projectId,
    missionId: input.missionId,
    ...(input.taskId ? { taskId: input.taskId } : {}),
    ...(input.runId ? { runId: input.runId } : {}),
    ...(input.capsuleId ? { capsuleId: input.capsuleId } : {}),
    ...(input.commandId ? { commandId: input.commandId } : {}),
    ...(input.pspId ? { pspId: input.pspId } : {}),
    ...(input.pspVersionId ? { pspVersionId: input.pspVersionId } : {}),
    ...(input.requestedAgentId ? { requestedAgentId: input.requestedAgentId } : {}),
    ...(input.actualAgentId ? { actualAgentId: input.actualAgentId } : {}),
    ...(input.providerId ? { providerId: input.providerId } : {}),
    ...(input.modelId ? { modelId: input.modelId } : {}),
    ...(input.toolId ? { toolId: input.toolId } : {}),
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    category: input.category,
    costClass: input.costClass,
    status: input.status,
    source: input.source,
    amount,
    ...(input.quantity ? { quantity: { ...input.quantity } } : {}),
    ...(input.rateReferenceId ? { rateReferenceId: input.rateReferenceId } : {}),
    ...(input.providerUsageReferenceId
      ? { providerUsageReferenceId: input.providerUsageReferenceId }
      : {}),
    ...(input.adjustmentOfReceiptId ? { adjustmentOfReceiptId: input.adjustmentOfReceiptId } : {}),
    ...(input.adjustmentReason ? { adjustmentReason: input.adjustmentReason } : {}),
    missionRevision: input.missionRevision,
    ...(input.taskRevision !== undefined ? { taskRevision: input.taskRevision } : {}),
    occurredAt: input.occurredAt,
    recordedAt: input.recordedAt,
    ...(input.finalizedAt ? { finalizedAt: input.finalizedAt } : {}),
    metadata: redacted,
    integrity: input.integrity ?? 'unverified',
    redactionStatus: wasRedacted ? 'redacted' : 'not_required',
  };

  return economicsOk(deepFreeze(receipt));
}

/** Categories whose cost is the work of a specific agent. */
const AGENT_ATTRIBUTED_CATEGORIES: readonly RelayCostCategory[] = [
  'planning',
  'model_inference',
  'agent_execution',
  'review',
  'repair',
  'retry',
];

function validateAgentAttribution(
  input: CreateCostReceiptInput,
): EconomicsResult<true> {
  if (!AGENT_ATTRIBUTED_CATEGORIES.includes(input.category)) return economicsOk(true);
  // Attributing agent work to an agent Relay never observed running would bill
  // a request as if it were an execution.
  if (input.actualAgentId === undefined && input.requestedAgentId !== undefined) {
    if (input.launchVerified === true) {
      return economicsFail(
        economicsError(
          'UNVERIFIED_AGENT_COST_ATTRIBUTION',
          'a verified launch must name the agent that actually ran',
          'supply actualAgentId from the execution capsule',
          {
            receiptId: input.receiptId,
            missionId: input.missionId,
            category: input.category,
            field: 'actualAgentId',
          },
        ),
      );
    }
    return economicsFail(
      economicsError(
        'UNVERIFIED_AGENT_COST_ATTRIBUTION',
        `${input.requestedAgentId} was requested but never verifiably launched — execution cost cannot be attributed to it`,
        'record this as infrastructure or adapter cost, or supply the verified actual agent',
        {
          receiptId: input.receiptId,
          missionId: input.missionId,
          category: input.category,
          field: 'actualAgentId',
          expected: 'the observed agent',
          actual: 'none',
        },
      ),
    );
  }
  return economicsOk(true);
}

/* ----------------------------------------------------------- lifecycle */

const VALID_TRANSITIONS: Record<RelayReceiptStatus, readonly RelayReceiptStatus[]> = {
  pending: ['provisional', 'finalized', 'voided'],
  provisional: ['finalized', 'voided', 'disputed'],
  finalized: ['disputed', 'voided'],
  // A dispute resolves through a NEW adjustment or a finalization decision.
  disputed: ['finalized', 'voided'],
  voided: [],
};

function transition(
  receipt: RelayCostReceipt,
  next: RelayReceiptStatus,
  patch: Partial<RelayCostReceipt>,
): EconomicsResult<RelayCostReceipt> {
  if (receipt.status === 'voided') {
    return economicsFail(
      economicsError(
        'RECEIPT_VOIDED',
        `receipt ${receipt.receiptId} is voided and can never become active again`,
        'record a new receipt instead',
        { receiptId: receipt.receiptId, missionId: receipt.missionId, actual: 'voided' },
      ),
    );
  }
  if (!VALID_TRANSITIONS[receipt.status].includes(next)) {
    return economicsFail(
      economicsError(
        'INVALID_RECEIPT_TRANSITION',
        `receipt ${receipt.receiptId} cannot move from ${receipt.status} to ${next}`,
        'inspect the receipt status',
        {
          receiptId: receipt.receiptId,
          missionId: receipt.missionId,
          field: 'status',
          expected: VALID_TRANSITIONS[receipt.status].join('|') || 'none',
          actual: next,
        },
      ),
    );
  }
  return economicsOk(deepFreeze({ ...receipt, ...patch, status: next }));
}

export function markProvisional(
  receipt: RelayCostReceipt,
  amount: RelayMoney | null,
): EconomicsResult<RelayCostReceipt> {
  return transition(receipt, 'provisional', { amount });
}

/**
 * Finalization is IDEMPOTENT: finalizing an already-finalized receipt with
 * the same amount returns it unchanged rather than failing, because a retried
 * settlement must not become an error. A DIFFERENT amount is refused — that
 * is a correction, and corrections are adjustments.
 */
export function finalizeReceipt(
  receipt: RelayCostReceipt,
  amount: RelayMoney,
  finalizedAt: string,
): EconomicsResult<RelayCostReceipt> {
  if (receipt.status === 'finalized') {
    if (
      receipt.amount &&
      receipt.amount.currency === amount.currency &&
      receipt.amount.amountMicros === amount.amountMicros
    ) {
      return economicsOk(receipt);
    }
    return economicsFail(
      economicsError(
        'RECEIPT_ALREADY_FINALIZED',
        `receipt ${receipt.receiptId} is finalized and its amount cannot be edited`,
        'record an adjustment referencing this receipt instead',
        {
          receiptId: receipt.receiptId,
          missionId: receipt.missionId,
          field: 'amount',
          expected: receipt.amount?.amountMicros ?? 'none',
          actual: amount.amountMicros,
        },
      ),
    );
  }
  if (isNegative(amount) && receipt.category !== 'adjustment') {
    return economicsFail(
      economicsError(
        'INVALID_ADJUSTMENT',
        'only an adjustment may finalize to a negative amount',
        'record the correction as an adjustment',
        { receiptId: receipt.receiptId, missionId: receipt.missionId, field: 'amount' },
      ),
    );
  }
  return transition(receipt, 'finalized', { amount, finalizedAt });
}

export function disputeReceipt(
  receipt: RelayCostReceipt,
  reason: string,
): EconomicsResult<RelayCostReceipt> {
  return transition(receipt, 'disputed', {
    metadata: deepFreeze({ ...receipt.metadata, disputeReason: reason }),
  });
}

export function voidReceipt(
  receipt: RelayCostReceipt,
  reason: string,
): EconomicsResult<RelayCostReceipt> {
  return transition(receipt, 'voided', {
    metadata: deepFreeze({ ...receipt.metadata, voidReason: reason }),
  });
}

export function attachSourceAttestation(
  receipt: RelayCostReceipt,
): EconomicsResult<RelayCostReceipt> {
  return economicsOk(deepFreeze({ ...receipt, integrity: 'source_attested' }));
}

/** Only a verified trace chain may raise a receipt to `trace_verified`. */
export function attachTraceVerification(
  receipt: RelayCostReceipt,
  chainVerified: boolean,
): EconomicsResult<RelayCostReceipt> {
  if (!chainVerified) {
    return economicsFail(
      economicsError(
        'ECONOMICS_TRACE_ADAPTER_FAILED',
        'trace verification was not proven for this receipt',
        'verify the trace chain before marking the receipt trace-verified',
        { receiptId: receipt.receiptId, missionId: receipt.missionId, field: 'integrity' },
      ),
    );
  }
  return economicsOk(deepFreeze({ ...receipt, integrity: 'trace_verified' }));
}

/* ---------------------------------------------------------- adjustments */

export interface CreateAdjustmentInput {
  receiptId: string;
  original: RelayCostReceipt;
  amount: RelayMoney;
  reason: string;
  recordedAt: string;
  occurredAt: string;
  source?: RelayReceiptSource;
  metadata?: Record<string, unknown>;
}

/**
 * Builds an adjustment against a finalized receipt. The original is returned
 * untouched — an adjustment is an additional record, never an edit — and a
 * credit may not exceed what was actually charged.
 */
export function createAdjustment(
  input: CreateAdjustmentInput,
): EconomicsResult<RelayCostReceipt> {
  const { original } = input;
  if (original.status !== 'finalized' && original.status !== 'disputed') {
    return economicsFail(
      economicsError(
        'INVALID_ADJUSTMENT',
        `receipt ${original.receiptId} is ${original.status}; only a finalized or disputed receipt can be adjusted`,
        'finalize the original receipt first',
        { receiptId: input.receiptId, missionId: original.missionId, actual: original.status },
      ),
    );
  }
  if (!original.amount) {
    return economicsFail(
      economicsError(
        'INVALID_ADJUSTMENT',
        'the original receipt has no amount to adjust',
        'finalize the original receipt with an amount first',
        { receiptId: input.receiptId, missionId: original.missionId },
      ),
    );
  }
  if (original.amount.currency !== input.amount.currency) {
    return economicsFail(
      economicsError(
        'MONEY_CURRENCY_MISMATCH',
        `an adjustment in ${input.amount.currency} cannot correct a ${original.amount.currency} charge`,
        'record the adjustment in the original currency',
        { receiptId: input.receiptId, missionId: original.missionId },
      ),
    );
  }
  // A credit larger than the original charge would invent money.
  if (isNegative(input.amount)) {
    const credit = -BigInt(input.amount.amountMicros);
    if (credit > BigInt(original.amount.amountMicros)) {
      return economicsFail(
        economicsError(
          'ADJUSTMENT_EXCEEDS_ALLOWED_AMOUNT',
          `a credit of ${input.amount.amountMicros} micros exceeds the original charge of ${original.amount.amountMicros}`,
          'credit at most the original amount',
          {
            receiptId: input.receiptId,
            missionId: original.missionId,
            expected: `<= ${original.amount.amountMicros}`,
            actual: input.amount.amountMicros,
          },
        ),
      );
    }
  }

  return createCostReceipt({
    receiptId: input.receiptId,
    projectId: original.projectId,
    missionId: original.missionId,
    missionRevision: original.missionRevision,
    ...(original.taskId ? { taskId: original.taskId } : {}),
    ...(original.runId ? { runId: original.runId } : {}),
    ...(original.capsuleId ? { capsuleId: original.capsuleId } : {}),
    ...(original.pspVersionId ? { pspVersionId: original.pspVersionId } : {}),
    ...(original.actualAgentId ? { actualAgentId: original.actualAgentId } : {}),
    ...(original.providerId ? { providerId: original.providerId } : {}),
    category: 'adjustment',
    costClass: 'actual',
    status: 'finalized',
    source: input.source ?? 'provider_reported',
    amount: input.amount,
    adjustmentOfReceiptId: original.receiptId,
    adjustmentReason: input.reason,
    providerUsageReferenceId: original.providerUsageReferenceId,
    occurredAt: input.occurredAt,
    recordedAt: input.recordedAt,
    finalizedAt: input.recordedAt,
    metadata: input.metadata ?? {},
  });
}
