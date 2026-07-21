/**
 * Structured Relay errors (PROTOCOL.md §1.5). Stable kebab-case codes; safe
 * messages only — never secrets, tokens, prompts, env contents, or file
 * bodies. Errors are VALUES (RelayResult), not thrown, so transition logic
 * stays pure and deterministic.
 */

export const RELAY_ERROR_CODES = [
  'protocol-mismatch',
  'validation-failed',
  'invalid-command',
  'invalid-report',
  'invalid-event',
  'illegal-transition',
  'not-found', // run/project/task — entity kind in entityIds
  'duplicate-command',
  'duplicate-event',
  'duplicate-idempotency-key',
  'duplicate-task',
  'revision-limit-exceeded',
  'immutable', // terminal run/task mutation
  'permission-denied',
  'budget-exceeded',
  'ledger-version-conflict',
  'stale-context',
  'stale-ledger-version',
  'sequence-violation',
  'evidence-required',
  'reviewer-independence',
  'claim-promotion',
  'unsupported-enforcement',
  'invalidated-by-decision',
  'checkpoint-required',
] as const;

export type RelayErrorCode = (typeof RELAY_ERROR_CODES)[number];

export interface RelayError {
  code: RelayErrorCode;
  message: string;
  /** Relevant entity ids, keyed by kind (projectId, runId, taskId, ...). */
  entityIds?: Record<string, string>;
  retryable?: boolean;
  correlationId?: string;
  /** Structured, log-safe details (field paths, expected values). */
  details?: string[];
}

export type RelayResult<T> = { ok: true; value: T } | { ok: false; error: RelayError };

export function relayError(
  code: RelayErrorCode,
  message: string,
  extra: Omit<RelayError, 'code' | 'message'> = {},
): RelayError {
  return { code, message, ...extra };
}

export const fail = <T = never>(error: RelayError): RelayResult<T> => ({ ok: false, error });
export const ok = <T>(value: T): RelayResult<T> => ({ ok: true, value });
