import type { JuliusBrainAccessStatePort, JuliusBrainCallFacts, JuliusBrainRunSession, JuliusBrainServiceCall } from './julius-brain-access';
import { classifyJuliusBrainFailure } from './julius-brain-failure-model';
import { createJuliusBrainRequestMemoryLog, juliusBrainRequestKey, type JuliusBrainRequestLog } from './julius-brain-request-log';
import type { JuliusBrainAccessPort } from './julius-brain-session-client';
import {
  JULIUS_BRAIN_OPERATION_SPECS,
  JULIUS_BRAIN_RESPONSE_FORMAT,
  juliusBrainDraftsOf,
  juliusBrainRequestDigest,
  juliusBrainResponseContext,
  validateJuliusBrainRequest,
  type JuliusBrainRequest,
  type JuliusBrainResponse,
  type JuliusBrainResponseReason,
  type JuliusBrainServiceOperation,
} from './julius-brain-service-api';
import type { JuliusBrainStateModePolicy } from './julius-brain-state-modes';

/**
 * THE SERVICE, ABOVE THE ACCESS CONTRACT AND BELOW ANY TRANSPORT.
 *
 * One function turns a request document into a response document:
 *
 *   validate  →  authorize (the access contract decides everything)
 *             →  claim the request id, or answer what that id already answered
 *             →  run the effect, which never sees a token
 *             →  record the answer
 *
 * The effects are a port. This module knows nothing about PostgreSQL, HTTP or
 * files, and it hands no caller a store, a principal or a grant.
 *
 * AN ADMITTED OPERATION FINISHES. Authorization is decided when the call is
 * admitted; if the session expires while a bounded operation is running, that
 * operation completes and the answer says so (`completedAfterExpiry`), the audit
 * records it, and the NEXT request needs a live session. Nothing an admitted
 * operation does starts another authorized operation.
 */

/** What the router needs of the access contract: issue, authorize, and read a session before deciding what a call touches. */
export type JuliusBrainRouterAccess = JuliusBrainAccessPort & { session(sessionToken: string): Promise<JuliusBrainRunSession | null> };

export interface JuliusBrainServiceEffects {
  readContext(input: { readonly session: JuliusBrainRunSession; readonly role: string; readonly budgetCharacters: number | null; readonly taskId: string | null }): Promise<Record<string, unknown>>;
  writeRecords(input: { readonly session: JuliusBrainRunSession; readonly drafts: readonly unknown[] }): Promise<Record<string, unknown>>;
  writeArtifact(input: { readonly session: JuliusBrainRunSession; readonly payload: Readonly<Record<string, unknown>> }): Promise<Record<string, unknown>>;
  readArtifact(input: { readonly session: JuliusBrainRunSession; readonly contentHash: string }): Promise<Record<string, unknown>>;
  checkpoint(input: { readonly session: JuliusBrainRunSession; readonly label: string }): Promise<Record<string, unknown>>;
  seal(input: { readonly session: JuliusBrainRunSession; readonly expectedEntryIds: readonly string[] | null }): Promise<Record<string, unknown>>;
  preservation(input: { readonly session: JuliusBrainRunSession }): Promise<Record<string, unknown>>;
  recover(input: { readonly session: JuliusBrainRunSession; readonly archiveContentHash: string }): Promise<Record<string, unknown>>;
  verify(input: { readonly session: JuliusBrainRunSession }): Promise<Record<string, unknown>>;
  /** What the service resolves server-side so the access contract can decide: admitted entities, mutation targets. */
  facts?(input: { readonly session: JuliusBrainRunSession; readonly call: JuliusBrainServiceCall }): Promise<JuliusBrainCallFacts>;
}

/** Operations whose answer is remembered against its request id. */
export const JULIUS_BRAIN_LOGGED_OPERATIONS: readonly JuliusBrainServiceOperation[] = ['REGISTER_ATTEMPT', 'WRITE_RECORDS', 'WRITE_ARTIFACT', 'CHECKPOINT', 'SEAL', 'RECOVER'];

export function createJuliusBrainServiceRouter(deps: {
  readonly access: JuliusBrainRouterAccess;
  readonly effects: JuliusBrainServiceEffects;
  readonly requests?: JuliusBrainRequestLog;
  readonly clock: { now(): string };
  /** Used only to record that an admitted operation completed after its session expired. */
  readonly state?: Pick<JuliusBrainAccessStatePort, 'appendAudit'>;
}) {
  const requests = deps.requests ?? createJuliusBrainRequestMemoryLog();

  const answer = (request: Pick<JuliusBrainRequest, 'requestId' | 'operation'>, outcome: JuliusBrainResponse['outcome'], reasonCode: JuliusBrainResponseReason | null, detail: string | null, extra: Partial<JuliusBrainResponse> = {}): JuliusBrainResponse => ({
    format: JULIUS_BRAIN_RESPONSE_FORMAT, requestId: request.requestId, operation: request.operation, outcome, reasonCode, detail, context: null, result: null, ...extra,
  });

  const callFor = (operation: JuliusBrainServiceOperation, payload: Readonly<Record<string, unknown>>, session: JuliusBrainRunSession): JuliusBrainServiceCall => {
    switch (operation) {
      case 'WRITE_RECORDS': return { type: 'WRITE', drafts: juliusBrainDraftsOf(payload) };
      case 'WRITE_ARTIFACT': case 'CHECKPOINT': return { type: 'WRITE', drafts: [] };
      case 'READ_ARTIFACT': return { type: 'READ_ARTIFACT', contentHash: String(payload.contentHash) };
      case 'SEAL': return { type: 'SEAL', runId: session.brainRunId };
      case 'RECOVER': return { type: 'RECOVER', archiveContentHash: String(payload.archiveContentHash) };
      default: return { type: 'READ_CONTEXT' };
    }
  };

  const effectFor = async (operation: JuliusBrainServiceOperation, payload: Readonly<Record<string, unknown>>, session: JuliusBrainRunSession): Promise<Record<string, unknown>> => {
    switch (operation) {
      case 'READ_CONTEXT': return deps.effects.readContext({ session, role: String(payload.role), budgetCharacters: typeof payload.budgetCharacters === 'number' ? payload.budgetCharacters : null, taskId: typeof payload.taskId === 'string' ? payload.taskId : null });
      case 'WRITE_RECORDS': return deps.effects.writeRecords({ session, drafts: juliusBrainDraftsOf(payload) });
      case 'WRITE_ARTIFACT': return deps.effects.writeArtifact({ session, payload });
      case 'READ_ARTIFACT': return deps.effects.readArtifact({ session, contentHash: String(payload.contentHash) });
      case 'CHECKPOINT': return deps.effects.checkpoint({ session, label: String(payload.label) });
      case 'SEAL': return deps.effects.seal({ session, expectedEntryIds: Array.isArray(payload.expectedEntryIds) ? payload.expectedEntryIds.map(String) : null });
      case 'GET_PRESERVATION_STATUS': return deps.effects.preservation({ session });
      case 'RECOVER': return deps.effects.recover({ session, archiveContentHash: String(payload.archiveContentHash) });
      case 'VERIFY': return deps.effects.verify({ session });
      default: return {};
    }
  };

  return {
    async handle(raw: unknown): Promise<JuliusBrainResponse> {
      const checked = validateJuliusBrainRequest(raw);
      if (!checked.ok) {
        const identity = (raw as { requestId?: unknown; operation?: unknown } | null) ?? {};
        return answer(
          { requestId: typeof identity.requestId === 'string' ? identity.requestId.slice(0, 128) : 'unknown', operation: (identity.operation as JuliusBrainServiceOperation) ?? 'READ_CONTEXT' },
          'REFUSED', 'request_invalid', checked.errors.slice(0, 8).join('; '),
        );
      }
      const request = checked.request;
      const spec = JULIUS_BRAIN_OPERATION_SPECS[request.operation];
      const logged = JULIUS_BRAIN_LOGGED_OPERATIONS.includes(request.operation);
      const digest = juliusBrainRequestDigest(request);

      // Registering an attempt is the one operation that exchanges an identity token for a session.
      if (spec.credential === 'IDENTITY_TOKEN') {
        const key = juliusBrainRequestKey('registration', request.requestId);
        const held = await requests.begin({ key, requestDigest: digest, operation: request.operation, at: deps.clock.now() });
        if (held.state === 'REPLAY') return { ...held.response, replayed: true };
        if (held.state === 'CONFLICT') return answer(request, 'REFUSED', 'request_id_conflict', `request ${request.requestId} already carried another ${held.heldOperation}`);
        if (held.state === 'IN_FLIGHT') return answer(request, 'REFUSED', 'request_in_flight', `request ${request.requestId} is still being handled`);
        let issued: Awaited<ReturnType<JuliusBrainAccessPort['issueSession']>>;
        try {
          issued = await deps.access.issueSession({
            token: request.identityToken!, projectId: String(request.payload.projectId), missionId: String(request.payload.missionId),
            stateMode: request.payload.stateMode as JuliusBrainStateModePolicy,
          });
        } catch (error) {
          await requests.abandon({ key });
          return answer(request, 'FAILED', 'operation_failed', classifyJuliusBrainFailure(error).failureClass);
        }
        const response = issued.ok
          ? answer(request, 'OK', null, null, { context: juliusBrainResponseContext(issued.session), sessionToken: issued.sessionToken, result: { writeKinds: issued.session.writeKinds } })
          : answer(request, 'REFUSED', issued.reasonCode, issued.detail);
        await requests.complete({ key, response, at: deps.clock.now() });
        return response;
      }

      // Everything else: the service resolves what the call touches, the access contract decides once, then the effect runs.
      let authorized: Awaited<ReturnType<JuliusBrainAccessPort['authorize']>>;
      let call: JuliusBrainServiceCall;
      let held: JuliusBrainRunSession | null;
      try {
        held = await deps.access.session(request.sessionToken!);
        call = callFor(request.operation, request.payload, held ?? ({ brainRunId: '', missionId: '' } as JuliusBrainRunSession));
        const facts = held === null || deps.effects.facts === undefined ? undefined : await deps.effects.facts({ session: held, call });
        authorized = await deps.access.authorize({ sessionToken: request.sessionToken!, call, facts });
      } catch (error) {
        return answer(request, 'FAILED', 'operation_failed', classifyJuliusBrainFailure(error).failureClass);
      }
      // A refusal still says which session it was decided for, when there was one.
      if (!authorized.ok) return answer(request, 'REFUSED', authorized.reasonCode, authorized.detail, held === null ? {} : { context: juliusBrainResponseContext(held) });
      const { session } = authorized;
      const context = juliusBrainResponseContext(session);

      const key = juliusBrainRequestKey(session.brainRunId, request.requestId);
      if (logged) {
        const held = await requests.begin({ key, requestDigest: digest, operation: request.operation, at: deps.clock.now() });
        if (held.state === 'REPLAY') return { ...held.response, replayed: true };
        if (held.state === 'CONFLICT') return answer(request, 'REFUSED', 'request_id_conflict', `request ${request.requestId} already carried another ${held.heldOperation}`, { context });
        if (held.state === 'IN_FLIGHT') return answer(request, 'REFUSED', 'request_in_flight', `request ${request.requestId} is still being handled`, { context });
      }
      let result: Record<string, unknown>;
      try {
        result = await effectFor(request.operation, request.payload, session);
      } catch (error) {
        if (logged) await requests.abandon({ key });
        const failure = classifyJuliusBrainFailure(error);
        return answer(request, 'FAILED', 'operation_failed', failure.failureClass, { context });
      }
      // An admitted operation finishes; the answer and the audit say when it finished past its session.
      const afterExpiry = Date.parse(deps.clock.now()) >= Date.parse(session.expiresAt);
      if (afterExpiry) {
        await deps.state?.appendAudit({ at: deps.clock.now(), action: 'CALL_ALLOWED', sessionId: session.sessionId, brainRunId: session.brainRunId, call: call.type, reasonCode: null, afterExpiry: true });
      }
      const response = answer(request, 'OK', null, null, { context, result, ...(afterExpiry ? { completedAfterExpiry: true as const } : {}) });
      if (logged) await requests.complete({ key, response, at: deps.clock.now() });
      return response;
    },
  };
}
