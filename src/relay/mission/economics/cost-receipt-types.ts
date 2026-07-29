/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 5
 * Cost receipt model (PURE types + vocabularies).
 *
 * A receipt records what something COST and who it is attributable to. Two
 * rules shape the whole model:
 *
 *   - missing cost information stays missing. A pending receipt has a null
 *     amount, and null never becomes $0;
 *   - estimated and actual are different facts, and provider-reported,
 *     adapter-observed, Relay-calculated, human-entered, and development
 *     fixture are different levels of trust that never blur together.
 *
 * A finalized receipt is immutable. Corrections are separate ADJUSTMENT
 * records that reference the original — history is never rewritten.
 */

import type { RelayMoney } from './money';

export const RELAY_COST_CATEGORIES = [
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
  'adjustment',
] as const;
export type RelayCostCategory = (typeof RELAY_COST_CATEGORIES)[number];

/** Human time is valued separately and never mixed into provider spend. */
export const PROVIDER_SPEND_CATEGORIES: readonly RelayCostCategory[] = [
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
];

export const RELAY_COST_CLASSES = ['estimated', 'actual'] as const;
export type RelayCostClass = (typeof RELAY_COST_CLASSES)[number];

export const RELAY_RECEIPT_STATUSES = [
  'pending',
  'provisional',
  'finalized',
  'voided',
  'disputed',
] as const;
export type RelayReceiptStatus = (typeof RELAY_RECEIPT_STATUSES)[number];

export const RELAY_RECEIPT_SOURCES = [
  'provider_reported',
  'adapter_observed',
  'relay_calculated',
  'human_entered',
  'development_fixture',
] as const;
export type RelayReceiptSource = (typeof RELAY_RECEIPT_SOURCES)[number];

export const RELAY_RECEIPT_QUANTITY_UNITS = [
  'input_token',
  'output_token',
  'cached_input_token',
  'agent_second',
  'tool_call',
  'workspace_second',
  'test_run',
  'build_run',
  'review_run',
  'repair_cycle',
  'retry_attempt',
  'human_minute',
  'custom',
] as const;
export type RelayReceiptQuantityUnit = (typeof RELAY_RECEIPT_QUANTITY_UNITS)[number];

export const RELAY_RECEIPT_INTEGRITIES = [
  'unverified',
  'source_attested',
  'trace_verified',
] as const;
export type RelayReceiptIntegrity = (typeof RELAY_RECEIPT_INTEGRITIES)[number];

export interface RelayReceiptQuantity {
  readonly unit: RelayReceiptQuantityUnit;
  /** Exact integer string — token counts are never floats. */
  readonly value: string;
  readonly customUnit?: string;
}

export interface RelayCostReceipt {
  readonly receiptId: string;

  readonly projectId: string;
  readonly missionId: string;

  readonly taskId?: string;
  readonly runId?: string;
  readonly capsuleId?: string;
  readonly commandId?: string;

  readonly pspId?: string;
  readonly pspVersionId?: string;

  /** What Relay ASKED to run. Never billed as the actual agent. */
  readonly requestedAgentId?: string;
  /** What Relay OBSERVED running, when launch was verified. */
  readonly actualAgentId?: string;

  readonly providerId?: string;
  readonly modelId?: string;
  readonly toolId?: string;
  readonly workspaceId?: string;

  readonly category: RelayCostCategory;
  readonly costClass: RelayCostClass;
  readonly status: RelayReceiptStatus;
  readonly source: RelayReceiptSource;

  /** null means UNKNOWN, and unknown never becomes zero. */
  readonly amount: RelayMoney | null;

  readonly quantity?: RelayReceiptQuantity;

  readonly rateReferenceId?: string;
  readonly providerUsageReferenceId?: string;
  readonly adjustmentOfReceiptId?: string;
  readonly adjustmentReason?: string;

  readonly missionRevision: number;
  readonly taskRevision?: number;

  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly finalizedAt?: string;

  readonly metadata: Record<string, unknown>;

  readonly integrity: RelayReceiptIntegrity;
  readonly redactionStatus: 'not_required' | 'redacted';
}

/* --------------------------------------------------- rate references */

export const RELAY_RATE_TRUSTS = [
  'development_fixture',
  'operator_configured',
  'provider_reported',
] as const;
export type RelayRateTrust = (typeof RELAY_RATE_TRUSTS)[number];

/**
 * A rate is a REFERENCE, never a hardcoded product truth. Relay performs no
 * live pricing lookup and no billing API call in this milestone, so a
 * `development_fixture` rate must never be presented as a current provider
 * price.
 */
export interface RelayRateReference {
  readonly rateReferenceId: string;
  readonly source: string;
  readonly version: string;
  readonly effectiveAt: string;
  readonly currency: string;
  readonly unit: RelayReceiptQuantityUnit | string;
  readonly amountPerUnit: RelayMoney;
  readonly trust: RelayRateTrust;
}

/* ---------------------------------------------------------- predicates */

export const TERMINAL_RECEIPT_STATUSES: readonly RelayReceiptStatus[] = ['voided'];

/** Counts toward actual spend: finalized actual receipts only. */
export function isFinalizedActual(receipt: RelayCostReceipt): boolean {
  return receipt.status === 'finalized' && receipt.costClass === 'actual';
}

/** Counts toward the PROJECTION but not toward settled actual spend. */
export function isProvisionalActual(receipt: RelayCostReceipt): boolean {
  return receipt.status === 'provisional' && receipt.costClass === 'actual';
}

export function isPending(receipt: RelayCostReceipt): boolean {
  return receipt.status === 'pending';
}

export function isExcludedFromTotals(receipt: RelayCostReceipt): boolean {
  // A voided receipt is inspectable but never counted. A disputed receipt is
  // represented separately rather than silently folded into a total.
  return receipt.status === 'voided' || receipt.status === 'disputed';
}

export function isAdjustment(receipt: RelayCostReceipt): boolean {
  return receipt.category === 'adjustment';
}

/** A development fixture may never be treated as a production receipt. */
export function isProductionTrustedSource(receipt: RelayCostReceipt): boolean {
  return receipt.source !== 'development_fixture';
}
