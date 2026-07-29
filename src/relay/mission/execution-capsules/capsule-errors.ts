/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 3
 * Structured execution-capsule errors — typed expected failures, never thrown
 * strings (same idiom as Milestone 1/2).
 *
 * Every rejection names the affected field, what was expected, what was
 * actually found, a concise reason, and the safe next action — so a future
 * Agent Run interface can explain a refusal without inventing text.
 */

export const RELAY_EXECUTION_CAPSULE_ERROR_CODES = [
  'CAPSULE_NOT_FOUND',
  'DUPLICATE_CAPSULE_ID',
  'DUPLICATE_RUN_ID',
  'INVALID_CAPSULE_STATUS_TRANSITION',
  'MISSING_PROJECT_ID',
  'MISSING_MISSION_ID',
  'MISSING_TASK_ID',
  'MISSING_RUN_ID',
  'INVALID_MISSION_REVISION',
  'INVALID_TASK_REVISION',
  'MISSING_HANDOFF_REFERENCE',
  'MISSING_POLICY_REFERENCE',
  'MISSING_PASSPORT_REFERENCE',
  'MISSING_REQUESTED_AGENT',
  'ACTUAL_AGENT_NOT_VERIFIED',
  'LAUNCH_NOT_REQUESTED',
  'LAUNCH_NOT_VERIFIED',
  'INVALID_LAUNCH_ATTESTATION',
  'UNAUTHORIZED_FALLBACK',
  'WORKSPACE_REQUIRED',
  'WORKSPACE_INCOMPATIBLE',
  'WRITE_OWNER_CONFLICT',
  'DUPLICATE_TRACE_REFERENCE',
  'DUPLICATE_EVIDENCE_REFERENCE',
  'DUPLICATE_COST_RECEIPT_REFERENCE',
  'FINAL_REPORT_REQUIRED',
  'INVALID_TIMESTAMP_ORDER',
  'RESPONSIBILITY_REVISION_MISMATCH',
  'SECRET_REDACTION_FAILED',
  'AGENT_SELF_ATTESTATION_FORBIDDEN',
  'REVIEW_CREDIT_NOT_ELIGIBLE',
  'TERMINAL_CAPSULE_IMMUTABLE',
  'CAPSULE_RECONSTRUCTION_FAILED',
] as const;
export type RelayExecutionCapsuleErrorCode =
  (typeof RELAY_EXECUTION_CAPSULE_ERROR_CODES)[number];

export interface RelayExecutionCapsuleError {
  code: RelayExecutionCapsuleErrorCode;
  capsuleId?: string;
  runId?: string;
  /** The affected capsule field or referenced entity. */
  field?: string;
  expected?: string;
  actual?: string;
  reason: string;
  safeNextAction: string;
  humanActionRequired: boolean;
}

/** Compact constructor keeping call sites honest about every field. */
export function capsuleError(
  code: RelayExecutionCapsuleErrorCode,
  reason: string,
  safeNextAction: string,
  details: Omit<
    RelayExecutionCapsuleError,
    'code' | 'reason' | 'safeNextAction' | 'humanActionRequired'
  > & { humanActionRequired?: boolean } = {},
): RelayExecutionCapsuleError {
  const { humanActionRequired, ...rest } = details;
  return {
    code,
    reason,
    safeNextAction,
    humanActionRequired: humanActionRequired ?? false,
    ...rest,
  };
}

/** Every capsule operation returns this — the previous capsule is preserved
    byte-for-byte on failure (the caller keeps its own reference). */
export type CapsuleResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: RelayExecutionCapsuleError };

export const capsuleOk = <T>(value: T): CapsuleResult<T> => ({ ok: true, value });
export const capsuleFail = <T>(error: RelayExecutionCapsuleError): CapsuleResult<T> => ({
  ok: false,
  error,
});
