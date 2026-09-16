import { canonicalJuliusBrainJson, juliusBrainSha256, type JuliusBrainDraft } from './julius-brain-contracts';
import type { JuliusBrainAccessRefusal, JuliusBrainRunSession, JuliusBrainServiceCall, JuliusBrainServiceEnvironment } from './julius-brain-access';
import type { JuliusBrainOperationClass } from './julius-brain-rate-limit';
import type { JuliusBrainStateModePolicy } from './julius-brain-state-modes';

/**
 * THE BRAIN SERVICE'S REQUEST CONTRACT — TRANSPORT-NEUTRAL, NOT DEPLOYED.
 *
 * What a run may ask the Brain for, and what it gets back, without deciding yet
 * whether that travels as HTTP, a queue message or a function call. A transport
 * carries these documents; it does not add operations, fields or authority.
 *
 *   THE CLIENT SUPPLIES     a request id, an operation, a payload, and one
 *                           credential: an identity token when registering an
 *                           attempt, a session token afterwards.
 *   THE SERVICE DERIVES     everything that matters — the session, its workflow
 *                           run and attempt, its mission, the environment and
 *                           the state mode — and echoes them back as the context
 *                           the answer was computed in. A payload that tries to
 *                           name any of them is refused, not ignored: a state
 *                           mode is fixed when the attempt registers and is not
 *                           a request field afterwards.
 *   NOTHING EXPOSES THE STORE. There is no operation that takes SQL, a table, a
 *                           principal, a grant or an entity outside the session's
 *                           run; `RAW_STORE` exists only as the refusal it earns.
 *   EVERY ANSWER IS MACHINE-READABLE: OK, REFUSED with a reason code from the
 *                           access contract or this one, or FAILED with a
 *                           classified failure. Never prose a client must parse.
 *   REPEATING A REQUEST IS SAFE: a mutating operation carries a request id, and
 *                           the same id with the same canonical request returns
 *                           the first answer instead of doing it again
 *                           (`julius-brain-request-log.ts`).
 */

export const JULIUS_BRAIN_REQUEST_FORMAT = 'julius-brain-service-request.v1' as const;
export const JULIUS_BRAIN_RESPONSE_FORMAT = 'julius-brain-service-response.v1' as const;

export const JULIUS_BRAIN_SERVICE_OPERATIONS = [
  'REGISTER_ATTEMPT', 'READ_CONTEXT', 'WRITE_RECORDS', 'WRITE_ARTIFACT', 'READ_ARTIFACT',
  'CHECKPOINT', 'SEAL', 'GET_PRESERVATION_STATUS', 'RECOVER', 'VERIFY',
] as const;
export type JuliusBrainServiceOperation = typeof JULIUS_BRAIN_SERVICE_OPERATIONS[number];

export interface JuliusBrainOperationSpec {
  /** REGISTER_ATTEMPT exchanges an identity token; everything else needs a live session. */
  readonly credential: 'IDENTITY_TOKEN' | 'SESSION';
  readonly operationClass: JuliusBrainOperationClass;
  /** Whether the operation changes the Brain, and so is recorded against its request id. */
  readonly mutates: boolean;
  /** The access call this operation is authorized as, when it needs one. */
  readonly call: JuliusBrainServiceCall['type'] | null;
  readonly payload: readonly string[];
  readonly required: readonly string[];
}

export const JULIUS_BRAIN_OPERATION_SPECS: Readonly<Record<JuliusBrainServiceOperation, JuliusBrainOperationSpec>> = {
  REGISTER_ATTEMPT: { credential: 'IDENTITY_TOKEN', operationClass: 'READ', mutates: false, call: null, payload: ['projectId', 'missionId', 'stateMode'], required: ['projectId', 'missionId', 'stateMode'] },
  READ_CONTEXT: { credential: 'SESSION', operationClass: 'READ', mutates: false, call: 'READ_CONTEXT', payload: ['role', 'budgetCharacters', 'taskId'], required: ['role'] },
  WRITE_RECORDS: { credential: 'SESSION', operationClass: 'WRITE', mutates: true, call: 'WRITE', payload: ['drafts'], required: ['drafts'] },
  WRITE_ARTIFACT: { credential: 'SESSION', operationClass: 'WRITE', mutates: true, call: 'WRITE', payload: ['name', 'contentType', 'contentHash', 'byteSize', 'bytesRef'], required: ['contentHash', 'byteSize'] },
  READ_ARTIFACT: { credential: 'SESSION', operationClass: 'ARTIFACT_READ', mutates: false, call: 'READ_ARTIFACT', payload: ['contentHash'], required: ['contentHash'] },
  CHECKPOINT: { credential: 'SESSION', operationClass: 'WRITE', mutates: true, call: 'WRITE', payload: ['label'], required: ['label'] },
  SEAL: { credential: 'SESSION', operationClass: 'WRITE', mutates: true, call: 'SEAL', payload: ['expectedEntryIds'], required: [] },
  GET_PRESERVATION_STATUS: { credential: 'SESSION', operationClass: 'READ', mutates: false, call: 'READ_CONTEXT', payload: [], required: [] },
  RECOVER: { credential: 'SESSION', operationClass: 'RECOVERY', mutates: true, call: 'RECOVER', payload: ['archiveContentHash'], required: ['archiveContentHash'] },
  VERIFY: { credential: 'SESSION', operationClass: 'READ', mutates: false, call: 'READ_CONTEXT', payload: [], required: [] },
};

/** Fields the service derives and a payload may never carry. */
export const JULIUS_BRAIN_DERIVED_FIELDS: readonly string[] = [
  'sessionId', 'brainRunId', 'workflowRunId', 'workflowRunAttempt', 'runId', 'environment', 'principal', 'grant', 'stateMode', 'policyHash', 'missionId', 'projectId',
];

export interface JuliusBrainRequest {
  readonly format: typeof JULIUS_BRAIN_REQUEST_FORMAT;
  /** The client's id for this logical request. Repeating it repeats the answer, never the effect. */
  readonly requestId: string;
  readonly operation: JuliusBrainServiceOperation;
  readonly identityToken?: string;
  readonly sessionToken?: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

/** What the answer was computed in: derived, never echoed from the request. */
export interface JuliusBrainResponseContext {
  readonly sessionId: string;
  readonly brainRunId: string;
  readonly workflowRunId: string;
  readonly workflowRunAttempt: number;
  readonly missionId: string;
  readonly projectId: string;
  readonly environment: JuliusBrainServiceEnvironment;
  readonly stateMode: JuliusBrainStateModePolicy['mode'];
  readonly policyHash: string;
  readonly expiresAt: string;
}

export type JuliusBrainResponseReason = JuliusBrainAccessRefusal | 'request_invalid' | 'request_id_conflict' | 'request_in_flight' | 'operation_failed';

export interface JuliusBrainResponse {
  readonly format: typeof JULIUS_BRAIN_RESPONSE_FORMAT;
  readonly requestId: string;
  readonly operation: JuliusBrainServiceOperation;
  readonly outcome: 'OK' | 'REFUSED' | 'FAILED';
  readonly reasonCode: JuliusBrainResponseReason | null;
  readonly detail: string | null;
  readonly context: JuliusBrainResponseContext | null;
  readonly result: Readonly<Record<string, unknown>> | null;
  /** Present when a session was issued: the only time a token leaves the service. */
  readonly sessionToken?: string;
  /** The stored answer to a request id that was already handled. */
  readonly replayed?: true;
  /** Set when an admitted operation finished after its session expired (the next one needs a live session). */
  readonly completedAfterExpiry?: true;
}

const ID = /^[A-Za-z0-9_.:-]{8,128}$/;

export function validateJuliusBrainRequest(value: unknown): { readonly ok: true; readonly request: JuliusBrainRequest } | { readonly ok: false; readonly errors: readonly string[] } {
  const errors: string[] = [];
  if (typeof value !== 'object' || value === null) return { ok: false, errors: ['request: an object'] };
  const request = value as Record<string, unknown>;
  if (request.format !== JULIUS_BRAIN_REQUEST_FORMAT) errors.push(`format: ${JULIUS_BRAIN_REQUEST_FORMAT}`);
  if (typeof request.requestId !== 'string' || !ID.test(request.requestId)) errors.push('requestId: 8..128 characters of A-Z a-z 0-9 _ . : -');
  const operation = request.operation as JuliusBrainServiceOperation;
  if (!(JULIUS_BRAIN_SERVICE_OPERATIONS as readonly string[]).includes(operation)) return { ok: false, errors: [...errors, `operation: one of ${JULIUS_BRAIN_SERVICE_OPERATIONS.join(', ')}`] };
  const spec = JULIUS_BRAIN_OPERATION_SPECS[operation];
  for (const key of Object.keys(request)) if (!['format', 'requestId', 'operation', 'identityToken', 'sessionToken', 'payload'].includes(key)) errors.push(`${key}: not part of the contract`);
  if (spec.credential === 'IDENTITY_TOKEN') {
    if (typeof request.identityToken !== 'string' || request.identityToken.length === 0) errors.push('identityToken: required to register an attempt');
    if (request.sessionToken !== undefined) errors.push('sessionToken: not part of registering an attempt');
  } else {
    if (typeof request.sessionToken !== 'string' || request.sessionToken.length === 0) errors.push('sessionToken: required');
    if (request.identityToken !== undefined) errors.push('identityToken: only when registering an attempt');
  }
  const payload = request.payload;
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) errors.push('payload: an object');
  else {
    for (const key of Object.keys(payload)) {
      if (operation !== 'REGISTER_ATTEMPT' && JULIUS_BRAIN_DERIVED_FIELDS.includes(key)) errors.push(`payload.${key}: the service derives this; a request may not name it`);
      else if (!spec.payload.includes(key)) errors.push(`payload.${key}: not part of ${operation}`);
    }
    for (const key of spec.required) if ((payload as Record<string, unknown>)[key] === undefined) errors.push(`payload.${key}: required`);
  }
  return errors.length === 0 ? { ok: true, request: request as unknown as JuliusBrainRequest } : { ok: false, errors };
}

/**
 * What makes two requests the same request: the operation and the payload,
 * never the credential. A client repeating a request with a fresh session token
 * is repeating the same request.
 */
export const juliusBrainRequestDigest = (request: Pick<JuliusBrainRequest, 'operation' | 'payload'>): string =>
  juliusBrainSha256(canonicalJuliusBrainJson({ operation: request.operation, payload: request.payload }));

export const juliusBrainResponseContext = (session: JuliusBrainRunSession): JuliusBrainResponseContext => {
  const [runId, attempt] = session.brainRunId.replace(/^workflow:/, '').split('/');
  return {
    sessionId: session.sessionId, brainRunId: session.brainRunId, workflowRunId: runId ?? '', workflowRunAttempt: Number(attempt ?? 0),
    missionId: session.missionId, projectId: session.projectId, environment: session.environment,
    stateMode: session.policy.mode, policyHash: session.policyHash, expiresAt: session.expiresAt,
  };
};

export const juliusBrainDraftsOf = (payload: Readonly<Record<string, unknown>>): readonly JuliusBrainDraft[] =>
  (Array.isArray(payload.drafts) ? payload.drafts : []) as readonly JuliusBrainDraft[];
