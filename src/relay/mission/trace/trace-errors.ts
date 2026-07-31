/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 4
 * Structured trace errors — typed expected failures, never thrown strings
 * (same idiom as Milestones 1–3).
 */

export const AQUALA_TRACE_ERROR_CODES = [
  'TRACE_NOT_FOUND',
  'DUPLICATE_TRACE_ID',
  'DUPLICATE_EVENT_ID',
  'TRACE_SEALED',
  'TRACE_INTEGRITY_FAILED',
  'UNSUPPORTED_TRACE_SCHEMA',
  'UNSUPPORTED_EVENT_SCHEMA',
  'UNSUPPORTED_CANONICALIZATION_VERSION',
  'UNSUPPORTED_HASH_ALGORITHM',
  'INVALID_GENESIS_EVENT',
  'INVALID_EVENT_TYPE',
  'INVALID_EVENT_FAMILY',
  'INVALID_SOURCE_PRODUCT',
  'INVALID_SOURCE_SERVICE',
  'INVALID_ACTOR',
  'INVALID_SOURCE_TRUST',
  'AGENT_SELF_ATTESTATION_FORBIDDEN',
  'MISSING_PROJECT_ID',
  'TRACE_IDENTITY_MISMATCH',
  'TRACE_SCOPE_MISMATCH',
  'INVALID_MISSION_REVISION',
  'INVALID_TASK_REVISION',
  'INVALID_EVENT_SEQUENCE',
  'SEQUENCE_GAP',
  'PREVIOUS_HASH_MISMATCH',
  'EVENT_HASH_MISMATCH',
  'INVALID_HASH_FORMAT',
  'STALE_TRACE_HEAD',
  'TIMESTAMP_REGRESSION',
  'CANONICALIZATION_FAILED',
  'UNSUPPORTED_METADATA_VALUE',
  'SECRET_REDACTION_FAILED',
  'EVENT_BATCH_REJECTED',
  'TRACE_SEAL_REJECTED',
  'TRACE_RECONSTRUCTION_FAILED',
] as const;
export type AqualaTraceErrorCode = (typeof AQUALA_TRACE_ERROR_CODES)[number];

export interface AqualaTraceError {
  code: AqualaTraceErrorCode;
  traceId?: string;
  eventId?: string;
  sequence?: number;
  /** The affected field or referenced entity. */
  field?: string;
  expected?: string;
  actual?: string;
  reason: string;
  safeNextAction: string;
  humanActionRequired: boolean;
}

/** Compact constructor keeping call sites honest about every field. */
export function traceError(
  code: AqualaTraceErrorCode,
  reason: string,
  safeNextAction: string,
  details: Omit<AqualaTraceError, 'code' | 'reason' | 'safeNextAction' | 'humanActionRequired'> & {
    humanActionRequired?: boolean;
  } = {},
): AqualaTraceError {
  const { humanActionRequired, ...rest } = details;
  return {
    code,
    reason,
    safeNextAction,
    humanActionRequired: humanActionRequired ?? false,
    ...rest,
  };
}

export type TraceResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: AqualaTraceError };

export const traceOk = <T>(value: T): TraceResult<T> => ({ ok: true, value });
export const traceFail = <T>(error: AqualaTraceError): TraceResult<T> => ({ ok: false, error });
