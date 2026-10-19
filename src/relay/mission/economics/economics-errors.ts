/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 5
 * Structured economics errors — typed expected failures, never thrown strings
 * (the same idiom as Milestones 1–4).
 */

export const RELAY_ECONOMICS_ERROR_CODES = [
  'MONEY_INVALID_CURRENCY',
  'MONEY_INVALID_AMOUNT',
  'MONEY_UNSAFE_PRECISION',
  'MONEY_CURRENCY_MISMATCH',
  'RECEIPT_NOT_FOUND',
  'DUPLICATE_RECEIPT_ID',
  'DUPLICATE_PROVIDER_USAGE_REFERENCE',
  'INVALID_RECEIPT_CATEGORY',
  'INVALID_RECEIPT_STATUS',
  'INVALID_RECEIPT_TRANSITION',
  'RECEIPT_AMOUNT_REQUIRED',
  'RECEIPT_ALREADY_FINALIZED',
  'RECEIPT_VOIDED',
  'RECEIPT_DISPUTED',
  'INVALID_ADJUSTMENT',
  'ADJUSTMENT_ORIGINAL_NOT_FOUND',
  'ADJUSTMENT_EXCEEDS_ALLOWED_AMOUNT',
  'MISSION_BUDGET_NOT_FOUND',
  'DUPLICATE_MISSION_BUDGET',
  'STALE_MISSION_BUDGET_REVISION',
  'INVALID_WARNING_THRESHOLD',
  'INVALID_APPROVAL_THRESHOLD',
  'INVALID_CATEGORY_LIMIT',
  'BUDGET_BELOW_FINALIZED_SPEND',
  'BUDGET_WARNING_REACHED',
  'BUDGET_APPROVAL_REQUIRED',
  'BUDGET_HARD_LIMIT_REACHED',
  'BUDGET_EXHAUSTED',
  'REPAIR_LIMIT_REACHED',
  'RETRY_LIMIT_REACHED',
  'UNKNOWN_PROPOSED_COST',
  'COST_AGGREGATION_INCOMPLETE',
  'COST_CURRENCY_CONFLICT',
  'COST_DOUBLE_COUNT_RISK',
  'COST_ATTRIBUTION_INVALID',
  'UNVERIFIED_AGENT_COST_ATTRIBUTION',
  'VERIFIED_MISSION_COST_NOT_ELIGIBLE',
  'RATE_REFERENCE_REQUIRED',
  'PRODUCTION_PRICING_UNAVAILABLE',
  'ECONOMICS_TRACE_ADAPTER_FAILED',
] as const;
export type RelayEconomicsErrorCode = (typeof RELAY_ECONOMICS_ERROR_CODES)[number];

export interface RelayEconomicsError {
  code: RelayEconomicsErrorCode;
  receiptId?: string;
  budgetId?: string;
  missionId?: string;
  missionRevision?: number;
  /** The cost category the failure concerns, when applicable. */
  category?: string;
  field?: string;
  expected?: string;
  actual?: string;
  reason: string;
  safeNextAction: string;
  /** True when re-issuing the same operation could succeed later. */
  retryable: boolean;
  humanApprovalRequired: boolean;
}

/** Compact constructor keeping call sites honest about every field. */
export function economicsError(
  code: RelayEconomicsErrorCode,
  reason: string,
  safeNextAction: string,
  details: Omit<
    RelayEconomicsError,
    'code' | 'reason' | 'safeNextAction' | 'retryable' | 'humanApprovalRequired'
  > & { retryable?: boolean; humanApprovalRequired?: boolean } = {},
): RelayEconomicsError {
  const { retryable, humanApprovalRequired, ...rest } = details;
  return {
    code,
    reason,
    safeNextAction,
    retryable: retryable ?? false,
    humanApprovalRequired: humanApprovalRequired ?? false,
    ...rest,
  };
}

export type EconomicsResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: RelayEconomicsError };

export const economicsOk = <T>(value: T): EconomicsResult<T> => ({ ok: true, value });
export const economicsFail = <T>(error: RelayEconomicsError): EconomicsResult<T> => ({
  ok: false,
  error,
});
