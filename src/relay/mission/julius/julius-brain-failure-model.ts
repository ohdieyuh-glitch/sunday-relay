import type { JuliusBrainStateMode } from './julius-brain-state-modes';

/**
 * THE PROJECT BRAIN FAILURE MODEL.
 *
 * What a run does when the Brain — its service, its database, or the identity
 * that reaches it — fails. Two questions decide it, and neither is answered by
 * hoping:
 *
 *   1. WHAT FAILED, AND DID THE REQUEST TAKE EFFECT?
 *      `classifyJuliusBrainFailure` names the failure from the error itself, and
 *      says whether the operation certainly did not apply (refused before or
 *      rolled back by the server) or may have applied (the connection or a
 *      gateway was lost after the request left). A write whose outcome is
 *      unknown is never assumed to have failed or succeeded: the Brain is read
 *      again, and the same idempotency keys make the retry a no-op if it landed.
 *
 *   2. WHAT DOES THE RUN NEED THE BRAIN FOR, AT THIS MOMENT?
 *      `decideJuliusBrainFailure` answers by state mode and phase:
 *
 *        reading required state   FRESH is not shaped by prior state: it
 *        (open, context)          PROCEEDS WITHOUT THE BRAIN, NOT PRESERVED.
 *                                 CONTINUATION, LEARNING and REGRESSION exist to
 *                                 use prior state: before the run starts they
 *                                 REFUSE THE RUN; during it they REFUSE THE
 *                                 DISPATCH that would act without it.
 *        writing history          every mode CONTINUES; the attempt's preservation
 *        (mirror, marker, seal)   is at risk and the seal says what reached the
 *                                 Brain. The paid-run archive recovers the rest.
 *
 *   Never, in any row: a fallback to other memory (the v1 table, a local file, a
 *   cache, an earlier export) standing in for the Brain; a TLS failure retried
 *   without TLS or verification; a claim of PRESERVED the Brain cannot show.
 */

export const JULIUS_BRAIN_FAILURE_CLASSES = [
  'SERVICE_UNAVAILABLE', 'DATABASE_UNAVAILABLE', 'DATABASE_READ_ONLY', 'TLS_VALIDATION_FAILED', 'SCHEMA_MISMATCH', 'TRANSACTION_TIMEOUT',
  'NETWORK_PARTIAL', 'OIDC_UNAVAILABLE', 'SESSION_LOST', 'SESSION_EXPIRED', 'RATE_LIMITED', 'ACCESS_REFUSED', 'UNKNOWN',
] as const;
export type JuliusBrainFailureClass = typeof JULIUS_BRAIN_FAILURE_CLASSES[number];

/** NOT_APPLIED: the operation certainly did not take effect. UNKNOWN: it may have. */
export type JuliusBrainOutcomeCertainty = 'NOT_APPLIED' | 'UNKNOWN';

export interface JuliusBrainFailure {
  readonly failureClass: JuliusBrainFailureClass;
  readonly outcome: JuliusBrainOutcomeCertainty;
  /** Whether trying again (after renewal or reconciliation where needed) can help. A configuration or security failure cannot. */
  readonly retryable: boolean;
  /** The code the error carried (SQLSTATE, errno, TLS or HTTP), never its message. */
  readonly code: string | null;
}

/* ------------------------------------------------------------ typed errors */

/** The Brain service did not answer, or answered that it cannot serve. */
export class JuliusBrainServiceUnavailableError extends Error {
  constructor(readonly status: number | null, detail = 'the Brain service is unavailable') { super(`julius_brain_service_unavailable: ${detail}`); this.name = 'JuliusBrainServiceUnavailableError'; }
}
/** No OIDC token could be obtained for the run (the issuer or the runner's token endpoint failed). */
export class JuliusBrainOidcUnavailableError extends Error {
  constructor(detail = 'no identity token could be obtained') { super(`julius_brain_oidc_unavailable: ${detail}`); this.name = 'JuliusBrainOidcUnavailableError'; }
}
/** The Brain service refused the call, with the service's reason code (`JuliusBrainAccessRefusal`). */
export class JuliusBrainAccessError extends Error {
  constructor(readonly reasonCode: string, detail: string) { super(`julius_brain_access_refused: ${reasonCode}: ${detail}`); this.name = 'JuliusBrainAccessError'; }
}
/** A run that needs prior state could not read it safely: the dispatch must not be made without it. */
export class JuliusBrainRequiredStateUnavailableError extends Error {
  constructor(readonly mode: JuliusBrainStateMode, readonly failure: JuliusBrainFailure | null, detail: string) {
    super(`julius_brain_required_state_unavailable: a ${mode} run cannot act without its prior state (${failure?.failureClass ?? 'REFUSED'}): ${detail}`);
    this.name = 'JuliusBrainRequiredStateUnavailableError';
  }
}

/* ------------------------------------------------------------- classifier */

const TLS_CODES = new Set([
  'SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED', 'CERT_NOT_YET_VALID', 'CERT_UNTRUSTED', 'CERT_REJECTED', 'CERT_SIGNATURE_FAILURE', 'ERR_TLS_CERT_ALTNAME_INVALID', 'HOSTNAME_MISMATCH',
]);
/** Refused before anything was sent, or before the server accepted work. */
const UNREACHABLE_ERRNO = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH']);
/** The connection was lost while a request may have been in flight. */
const LOST_ERRNO = new Set(['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ECONNABORTED']);

const codeOf = (error: unknown): string | null => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' || typeof code === 'number' ? String(code) : null;
};
const messageOf = (error: unknown): string => (error instanceof Error ? error.message : typeof error === 'string' ? error : '');

const isFailure = (value: unknown): value is JuliusBrainFailure =>
  typeof value === 'object' && value !== null
  && (JULIUS_BRAIN_FAILURE_CLASSES as readonly string[]).includes((value as JuliusBrainFailure).failureClass)
  && ((value as JuliusBrainFailure).outcome === 'NOT_APPLIED' || (value as JuliusBrainFailure).outcome === 'UNKNOWN');

export function classifyJuliusBrainFailure(error: unknown): JuliusBrainFailure {
  // An error that already carries a classification (a wrapper raised by the retry
  // runner or the binding) keeps it: re-reading its message would lose the outcome.
  const carried = (error as { failure?: unknown } | null)?.failure;
  if (isFailure(carried)) return carried;
  const code = codeOf(error);
  const message = messageOf(error);
  const failure = (failureClass: JuliusBrainFailureClass, outcome: JuliusBrainOutcomeCertainty, retryable: boolean): JuliusBrainFailure => ({ failureClass, outcome, retryable, code });

  if (error instanceof JuliusBrainAccessError) {
    if (error.reasonCode === 'session_expired') return { failureClass: 'SESSION_EXPIRED', outcome: 'NOT_APPLIED', retryable: true, code: error.reasonCode };
    if (error.reasonCode === 'session_unknown') return { failureClass: 'SESSION_LOST', outcome: 'NOT_APPLIED', retryable: true, code: error.reasonCode };
    // The service could not reach the issuer's keys: an identity failure, not a refusal of this caller.
    if (error.reasonCode === 'issuer_keys_unavailable') return { failureClass: 'OIDC_UNAVAILABLE', outcome: 'NOT_APPLIED', retryable: true, code: error.reasonCode };
    // Throttled: the call was not made, and the same call is welcome once the window turns.
    if (error.reasonCode === 'rate_limited') return { failureClass: 'RATE_LIMITED', outcome: 'NOT_APPLIED', retryable: true, code: error.reasonCode };
    return { failureClass: 'ACCESS_REFUSED', outcome: 'NOT_APPLIED', retryable: false, code: error.reasonCode };
  }
  if (error instanceof JuliusBrainOidcUnavailableError) return failure('OIDC_UNAVAILABLE', 'NOT_APPLIED', true);
  if (error instanceof JuliusBrainServiceUnavailableError) {
    // A 503 is the service declining work; a 502/504 or no answer at all may be a gateway that already forwarded it.
    return { failureClass: 'SERVICE_UNAVAILABLE', outcome: error.status === 503 ? 'NOT_APPLIED' : 'UNKNOWN', retryable: true, code: error.status === null ? null : String(error.status) };
  }
  // The Brain database refusing a connection that is not what production requires is configuration, never retried around.
  if (/julius_brain_database_connection_not_encrypted/.test(message)) return { failureClass: 'TLS_VALIDATION_FAILED', outcome: 'NOT_APPLIED', retryable: false, code: 'julius_brain_database_connection_not_encrypted' };
  if (code !== null && TLS_CODES.has(code)) return failure('TLS_VALIDATION_FAILED', 'NOT_APPLIED', false);
  // The database is not the one this code knows how to write to. Waiting does not fix it.
  const schema = /julius_brain_database_(not_dedicated|not_migrated|identity_missing|newer_than_code|migrations_pending|environment_mismatch)/.exec(message);
  if (schema !== null) return { failureClass: 'SCHEMA_MISMATCH', outcome: 'NOT_APPLIED', retryable: false, code: `julius_brain_database_${schema[1]}` };
  if (/self[- ]signed certificate|unable to verify the first certificate|certificate has expired|Hostname\/IP does not match certificate/i.test(message)) return failure('TLS_VALIDATION_FAILED', 'NOT_APPLIED', false);

  switch (code) {
    case '25006': return failure('DATABASE_READ_ONLY', 'NOT_APPLIED', true); // read_only_sql_transaction: rejected, nothing applied
    case '57014': // query_canceled (statement_timeout): the server rolled the transaction back
    case '55P03': // lock_not_available (lock_timeout)
    case '25P03': // idle_in_transaction_session_timeout
      return failure('TRANSACTION_TIMEOUT', 'NOT_APPLIED', true);
    case '40001': case '40P01': return failure('TRANSACTION_TIMEOUT', 'NOT_APPLIED', true); // serialization failure, deadlock: rolled back
    case '57P03': case '53300': return failure('DATABASE_UNAVAILABLE', 'NOT_APPLIED', true); // cannot_connect_now, too_many_connections
    case '08001': case '08004': return failure('DATABASE_UNAVAILABLE', 'NOT_APPLIED', true); // unable to establish, rejected
    case '57P01': case '57P02': case '08006': case '08003': case '08007': return failure('NETWORK_PARTIAL', 'UNKNOWN', true); // terminated / lost mid-session
    default: break;
  }
  if (code !== null && UNREACHABLE_ERRNO.has(code)) return failure('DATABASE_UNAVAILABLE', 'NOT_APPLIED', true);
  if (code !== null && LOST_ERRNO.has(code)) return failure('NETWORK_PARTIAL', 'UNKNOWN', true);
  if (/Connection terminated unexpectedly|Client has encountered a connection error|connection terminated|terminating connection due to|Query read timeout/i.test(message)) return failure('NETWORK_PARTIAL', 'UNKNOWN', true);
  if (/timeout exceeded when trying to connect|connect ECONNREFUSED|getaddrinfo ENOTFOUND/i.test(message)) return failure('DATABASE_UNAVAILABLE', 'NOT_APPLIED', true);
  // The breaker refusing a call is the Brain being unreachable, said early.
  if (/julius_brain_circuit_open/.test(message)) return { failureClass: 'SERVICE_UNAVAILABLE', outcome: 'NOT_APPLIED', retryable: true, code: 'julius_brain_circuit_open' };
  return failure('UNKNOWN', 'UNKNOWN', false);
}

/* ---------------------------------------------------------------- decision */

/** Where in a run the Brain was needed when it failed. */
export type JuliusBrainPhase =
  | 'OPEN' // create/open and verify the Brain, re-drive v1 entries, write the run-opened marker — before the run starts
  | 'READ_CONTEXT' // compile the typed context a dispatch is handed
  | 'MIRROR' // mirror one v1 write
  | 'SEAL'; // seal and checkpoint at the end of a drive

export interface JuliusBrainFailureDecision {
  readonly failure: JuliusBrainFailure;
  /** Before the decision below applies: what may be tried, within the caller's bound. */
  readonly retry: 'NONE' | 'RETRY' | 'RENEW_SESSION' | 'RECONCILE_THEN_RETRY';
  /** When retries are exhausted or none is allowed. */
  readonly then: 'PROCEED_WITHOUT_BRAIN' | 'REFUSE_RUN' | 'REFUSE_DISPATCH' | 'CONTINUE_WITHOUT_BRAIN';
  /** What this does to the attempt's preservation, as the Brain will later show it. */
  readonly preservation: 'NOT_PRESERVED' | 'AT_RISK';
  /** Always NONE: nothing else stands in for the Brain. */
  readonly memoryFallback: 'NONE';
  /** Whether an operator must act: a failure no retry can fix. */
  readonly alert: 'NONE' | 'CONFIGURATION' | 'SECURITY';
  readonly rationale: string;
}

export function decideJuliusBrainFailure(input: { readonly mode: JuliusBrainStateMode; readonly phase: JuliusBrainPhase; readonly failure: JuliusBrainFailure }): JuliusBrainFailureDecision {
  const { mode, phase, failure } = input;
  const required = mode !== 'FRESH';
  const retry: JuliusBrainFailureDecision['retry'] = !failure.retryable ? 'NONE'
    : failure.failureClass === 'SESSION_EXPIRED' || failure.failureClass === 'SESSION_LOST' ? 'RENEW_SESSION'
      : failure.outcome === 'UNKNOWN' ? 'RECONCILE_THEN_RETRY' : 'RETRY';
  const alert: JuliusBrainFailureDecision['alert'] = failure.failureClass === 'TLS_VALIDATION_FAILED' || failure.failureClass === 'SCHEMA_MISMATCH' ? 'CONFIGURATION'
    : failure.failureClass === 'ACCESS_REFUSED' ? 'SECURITY' : failure.failureClass === 'UNKNOWN' ? 'CONFIGURATION' : 'NONE';
  const base = { failure, retry, memoryFallback: 'NONE' as const, alert };

  if (phase === 'OPEN' || phase === 'READ_CONTEXT') {
    if (!required) {
      return {
        ...base, then: phase === 'OPEN' ? 'PROCEED_WITHOUT_BRAIN' : 'CONTINUE_WITHOUT_BRAIN', preservation: 'NOT_PRESERVED',
        rationale: 'FRESH is not shaped by prior state: the run proceeds on its own context, detached from the Brain, and can never be PRESERVED.',
      };
    }
    return {
      ...base, then: phase === 'OPEN' ? 'REFUSE_RUN' : 'REFUSE_DISPATCH', preservation: 'NOT_PRESERVED',
      rationale: `${mode} exists to use prior state that could not be read safely; acting without it, or on anything standing in for it, is refused.`,
    };
  }
  if (phase === 'MIRROR') {
    return {
      ...base, then: 'CONTINUE_WITHOUT_BRAIN', preservation: 'AT_RISK',
      rationale: 'The v1 write stands; the seal re-checks what the Brain holds, and anything missing is recovered from the paid-run archive.',
    };
  }
  return {
    ...base, then: 'CONTINUE_WITHOUT_BRAIN', preservation: 'NOT_PRESERVED',
    rationale: 'Without a committed seal and checkpoint the attempt is not PRESERVED; preservation is read back from the Brain, never assumed.',
  };
}
