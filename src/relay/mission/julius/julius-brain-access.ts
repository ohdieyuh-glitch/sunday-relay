import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto';

import { juliusPrincipal, type JuliusBrainDraft, type JuliusBrainPrincipal, type JuliusBrainRecordKind } from './julius-brain-contracts';
import type { JuliusBrainEntityState } from './julius-brain-projection';
import type { JuliusBrainContextView } from './julius-brain-query';
import { defaultJuliusBrainReadGrant } from './julius-brain-service';
import { compileJuliusBrainContextForMode, juliusBrainStateModePolicyHash, validateJuliusBrainStateModePolicy, type JuliusBrainStateModePolicy } from './julius-brain-state-modes';

/**
 * THE CONTROLLED BRAIN SERVICE'S ACCESS CONTRACT — LOCAL, NOT DEPLOYED.
 *
 * A GitHub-hosted paid run never holds a Brain database credential. It presents
 * a short-lived GitHub Actions OIDC token; the service verifies it, binds a
 * session to exactly one workflow attempt, and decides every call itself. A
 * faulty or compromised client cannot widen anything by asking differently,
 * because nothing it asks for is trusted:
 *
 *   run identity         `workflow:<run_id>/<run_attempt>` from the verified
 *                        token — never a run id the client names
 *   environment          the token's protected environment, mapped by policy,
 *                        must be the service's own; a development session is
 *                        unknown to a production service
 *   mission identity     bound when the attempt first registers
 *   state mode           bound when the attempt first registers — a later
 *                        session cannot change it — and anything but FRESH
 *                        needs an operator grant naming the run and policy
 *   write kinds          an allowlist; mission authority is never written by
 *                        a run
 *   retrieval scope      selected server-side under the bound mode
 *   mutation scope       every draft must be scoped to the session's run and
 *                        mission
 *   expiry               the session's, never refreshed by the client
 *   replay               a token id (jti) is accepted once
 *   raw store            never exposed
 *
 * Every decision — issued, refused, allowed — is audited without the token.
 * Transport, key fetching and storage are deployment; this is what they must
 * enforce, runnable and proven.
 */

export const GITHUB_ACTIONS_OIDC_ISSUER = 'https://token.actions.githubusercontent.com';
const CLOCK_SKEW_SECONDS = 60;
const MAX_TOKEN_AGE_SECONDS = 15 * 60;

export interface JuliusBrainAccessPolicy {
  readonly audience: string;
  readonly repositoryId: string;
  readonly repositoryOwnerId: string;
  /** e.g. `owner/repo/.github/workflows/julius-first-live-mission.yml@refs/heads/main` */
  readonly workflowRef: string;
  readonly ref: string;
  readonly allowedEvents: readonly string[];
  /** Protected GitHub environment name → the Brain environment it may reach. */
  readonly environments: Readonly<Record<string, 'development' | 'test' | 'production'>>;
  readonly sessionTtlMs: number;
}

export interface JuliusBrainOidcClaims {
  readonly jti: string;
  readonly exp: number;
  readonly iat: number;
  readonly repositoryId: string;
  readonly runId: string;
  readonly runAttempt: number;
  readonly environment: string;
  readonly workflowRef: string;
}

export type JuliusBrainAccessRefusal =
  | 'token_malformed' | 'token_algorithm_refused' | 'token_key_unknown' | 'token_signature_invalid' | 'token_issuer_refused' | 'token_audience_refused'
  | 'token_expired' | 'token_not_yet_valid' | 'token_too_old' | 'token_claim_refused' | 'token_replayed'
  | 'environment_mismatch' | 'state_mode_invalid' | 'state_mode_not_for_this_run' | 'state_mode_not_authorized' | 'run_registration_mismatch'
  | 'session_unknown' | 'session_expired' | 'other_run' | 'other_mission' | 'state_mode_is_bound' | 'kind_not_permitted' | 'mutation_out_of_scope' | 'raw_store_not_exposed';

/** An RSA public key as the issuer publishes it (JWKS). */
export interface JuliusBrainJwk { readonly kty: string; readonly kid?: string; readonly n?: string; readonly e?: string; readonly alg?: string; readonly use?: string }

const b64url = (value: string): Buffer | null => (/^[A-Za-z0-9_-]*$/.test(value) ? Buffer.from(value, 'base64url') : null);
const sha256Hex = (value: string) => createHash('sha256').update(value).digest('hex');

/** Verify a GitHub Actions OIDC token against the issuer's keys and the policy. Pure but for the clock and keys it is given. */
export function verifyJuliusBrainOidcToken(input: {
  readonly token: string;
  readonly jwks: { readonly keys: readonly JuliusBrainJwk[] };
  readonly policy: JuliusBrainAccessPolicy;
  readonly nowSeconds: number;
}): { readonly ok: true; readonly claims: JuliusBrainOidcClaims } | { readonly ok: false; readonly reasonCode: JuliusBrainAccessRefusal; readonly detail: string } {
  const refuse = (reasonCode: JuliusBrainAccessRefusal, detail: string) => ({ ok: false as const, reasonCode, detail });
  const parts = input.token.split('.');
  if (parts.length !== 3) return refuse('token_malformed', 'not a JWS compact token');
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(b64url(headerPart)?.toString('utf8') ?? 'null');
    payload = JSON.parse(b64url(payloadPart)?.toString('utf8') ?? 'null');
  } catch { return refuse('token_malformed', 'header or payload is not JSON'); }
  if (header === null || typeof header !== 'object' || payload === null || typeof payload !== 'object') return refuse('token_malformed', 'header or payload is not an object');
  // Only the issuer's algorithm: never `none`, never a symmetric algorithm keyed by a public key.
  if (header.alg !== 'RS256') return refuse('token_algorithm_refused', `alg ${String(header.alg)}`);
  const key = input.jwks.keys.find((candidate) => candidate.kid === header.kid && candidate.kty === 'RSA');
  if (key === undefined) return refuse('token_key_unknown', `kid ${String(header.kid)}`);
  const signature = b64url(signaturePart);
  if (signature === null) return refuse('token_malformed', 'signature is not base64url');
  const valid = verify('RSA-SHA256', Buffer.from(`${headerPart}.${payloadPart}`), createPublicKey({ key: { kty: key.kty, n: key.n, e: key.e }, format: 'jwk' }), signature);
  if (!valid) return refuse('token_signature_invalid', 'signature does not verify');

  const now = input.nowSeconds;
  if (payload.iss !== GITHUB_ACTIONS_OIDC_ISSUER) return refuse('token_issuer_refused', String(payload.iss));
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(input.policy.audience)) return refuse('token_audience_refused', String(payload.aud));
  const exp = Number(payload.exp);
  const iat = Number(payload.iat);
  const nbf = payload.nbf === undefined ? iat : Number(payload.nbf);
  if (!Number.isFinite(exp) || exp + CLOCK_SKEW_SECONDS <= now) return refuse('token_expired', `exp ${String(payload.exp)}`);
  if (!Number.isFinite(iat) || !Number.isFinite(nbf) || nbf - CLOCK_SKEW_SECONDS > now || iat - CLOCK_SKEW_SECONDS > now) return refuse('token_not_yet_valid', `nbf ${String(payload.nbf)}`);
  if (now - iat > MAX_TOKEN_AGE_SECONDS) return refuse('token_too_old', `iat ${String(payload.iat)}`);

  const claim = (name: string, expected: string | readonly string[]) => {
    const value = payload[name];
    return typeof value === 'string' && (typeof expected === 'string' ? value === expected : expected.includes(value));
  };
  if (!claim('repository_id', input.policy.repositoryId)) return refuse('token_claim_refused', 'repository_id');
  if (!claim('repository_owner_id', input.policy.repositoryOwnerId)) return refuse('token_claim_refused', 'repository_owner_id');
  if (!claim('workflow_ref', input.policy.workflowRef) && !claim('job_workflow_ref', input.policy.workflowRef)) return refuse('token_claim_refused', 'workflow_ref');
  if (!claim('ref', input.policy.ref)) return refuse('token_claim_refused', 'ref');
  if (String(payload.event_name).startsWith('pull_request') || !claim('event_name', input.policy.allowedEvents)) return refuse('token_claim_refused', 'event_name');
  if (!claim('environment', Object.keys(input.policy.environments))) return refuse('token_claim_refused', 'environment');
  if (typeof payload.run_id !== 'string' || !/^[0-9]{1,20}$/.test(payload.run_id)) return refuse('token_claim_refused', 'run_id');
  if (typeof payload.run_attempt !== 'string' || !/^[1-9][0-9]{0,4}$/.test(payload.run_attempt)) return refuse('token_claim_refused', 'run_attempt');
  if (typeof payload.jti !== 'string' || payload.jti.length === 0 || payload.jti.length > 128) return refuse('token_claim_refused', 'jti');
  return {
    ok: true,
    claims: {
      jti: payload.jti, exp, iat, repositoryId: String(payload.repository_id), runId: payload.run_id, runAttempt: Number(payload.run_attempt),
      environment: String(payload.environment), workflowRef: String(payload.workflow_ref ?? payload.job_workflow_ref),
    },
  };
}

/** Record kinds a run session may write. Mission authority (MISSION, MISSION_STATE) and checkpoints are never among them. */
export const JULIUS_BRAIN_RUN_WRITE_KINDS: readonly JuliusBrainRecordKind[] = [
  'OBJECTIVE', 'REQUIREMENT', 'ACCEPTANCE_CRITERION', 'CONSTRAINT', 'PROHIBITION', 'ASSUMPTION', 'OPEN_QUESTION', 'ARCHITECTURE_COMPONENT', 'ARCHITECTURE_INTERFACE',
  'DECISION', 'RESEARCH', 'MEMORY_FACT', 'EVIDENCE', 'EVAL', 'ARTIFACT', 'FINDING', 'REPAIR', 'HANDOFF', 'TRACE',
];

export interface JuliusBrainRunSession {
  readonly sessionId: string;
  readonly brainRunId: string;
  readonly projectId: string;
  readonly missionId: string;
  readonly environment: 'development' | 'test' | 'production';
  readonly policy: JuliusBrainStateModePolicy;
  readonly policyHash: string;
  /** Server-constructed; the client never names a principal. */
  readonly principal: JuliusBrainPrincipal;
  readonly writeKinds: readonly JuliusBrainRecordKind[];
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export type JuliusBrainServiceCall =
  | { readonly type: 'READ_CONTEXT'; readonly runId?: string; readonly missionId?: string; readonly stateMode?: JuliusBrainStateModePolicy }
  | { readonly type: 'WRITE'; readonly drafts: readonly JuliusBrainDraft[] }
  | { readonly type: 'SEAL'; readonly runId: string }
  | { readonly type: 'RAW_STORE'; readonly operation: string };

export interface JuliusBrainAuditEvent {
  readonly at: string;
  readonly action: 'SESSION_ISSUED' | 'SESSION_REFUSED' | 'CALL_ALLOWED' | 'CALL_REFUSED';
  readonly sessionId: string | null;
  readonly brainRunId: string | null;
  readonly call: JuliusBrainServiceCall['type'] | null;
  readonly reasonCode: JuliusBrainAccessRefusal | null;
}

/** An operator's authorisation for a run to use prior state: exactly this run, mission and mode policy. */
export interface JuliusBrainStateModeGrant { readonly brainRunId: string; readonly missionId: string; readonly policyHash: string }

export function createJuliusBrainAccessService(deps: {
  readonly brainId: string;
  readonly environment: 'development' | 'test' | 'production';
  readonly policy: JuliusBrainAccessPolicy;
  readonly jwks: () => { readonly keys: readonly JuliusBrainJwk[] };
  readonly grants: () => readonly JuliusBrainStateModeGrant[];
  readonly clock: { now(): string };
  readonly audit: (event: JuliusBrainAuditEvent) => void;
}) {
  const sessions = new Map<string, JuliusBrainRunSession>();
  const seenTokens = new Map<string, number>();
  const registrations = new Map<string, { readonly projectId: string; readonly missionId: string; readonly policyHash: string }>();
  const nowIso = () => deps.clock.now();
  const nowSeconds = () => Math.floor(Date.parse(nowIso()) / 1000);

  const refuseIssue = (reasonCode: JuliusBrainAccessRefusal, detail: string, brainRunId: string | null) => {
    deps.audit({ at: nowIso(), action: 'SESSION_REFUSED', sessionId: null, brainRunId, call: null, reasonCode });
    return { ok: false as const, reasonCode, detail };
  };

  return {
    issueSession(input: { readonly token: string; readonly projectId: string; readonly missionId: string; readonly stateMode: JuliusBrainStateModePolicy }):
      { readonly ok: true; readonly sessionToken: string; readonly session: JuliusBrainRunSession } | { readonly ok: false; readonly reasonCode: JuliusBrainAccessRefusal; readonly detail: string } {
      const verified = verifyJuliusBrainOidcToken({ token: input.token, jwks: deps.jwks(), policy: deps.policy, nowSeconds: nowSeconds() });
      if (!verified.ok) return refuseIssue(verified.reasonCode, verified.detail, null);
      const { claims } = verified;
      const brainRunId = `workflow:${claims.runId}/${claims.runAttempt}`;
      if (deps.policy.environments[claims.environment] !== deps.environment) {
        return refuseIssue('environment_mismatch', `environment ${claims.environment} does not reach a ${deps.environment} Brain`, brainRunId);
      }
      for (const [jti, exp] of seenTokens) if (exp + CLOCK_SKEW_SECONDS <= nowSeconds()) seenTokens.delete(jti);
      if (seenTokens.has(claims.jti)) return refuseIssue('token_replayed', 'this token was already exchanged', brainRunId);
      seenTokens.set(claims.jti, claims.exp);

      const policy = input.stateMode;
      if (validateJuliusBrainStateModePolicy(policy).length > 0) return refuseIssue('state_mode_invalid', validateJuliusBrainStateModePolicy(policy).join('; '), brainRunId);
      if (policy.runId !== brainRunId || policy.missionId !== input.missionId) return refuseIssue('state_mode_not_for_this_run', `the policy names ${policy.runId} of ${policy.missionId}`, brainRunId);
      const policyHash = juliusBrainStateModePolicyHash(policy);
      if (policy.mode !== 'FRESH' && !deps.grants().some((grant) => grant.brainRunId === brainRunId && grant.missionId === input.missionId && grant.policyHash === policyHash)) {
        return refuseIssue('state_mode_not_authorized', `${policy.mode} needs an operator grant for ${brainRunId}`, brainRunId);
      }
      const registered = registrations.get(brainRunId);
      if (registered !== undefined && (registered.projectId !== input.projectId || registered.missionId !== input.missionId || registered.policyHash !== policyHash)) {
        return refuseIssue('run_registration_mismatch', `${brainRunId} is registered with another project, mission or state mode`, brainRunId);
      }
      registrations.set(brainRunId, { projectId: input.projectId, missionId: input.missionId, policyHash });

      const sessionToken = randomBytes(32).toString('base64url');
      const issuedAt = nowIso();
      const session: JuliusBrainRunSession = {
        sessionId: `bsess:${sha256Hex(`${sessionToken}:id`).slice(0, 24)}`, brainRunId, projectId: input.projectId, missionId: input.missionId,
        environment: deps.environment, policy, policyHash, principal: juliusPrincipal('JULIUS', `julius:${brainRunId}`), writeKinds: JULIUS_BRAIN_RUN_WRITE_KINDS,
        issuedAt, expiresAt: new Date(Date.parse(issuedAt) + deps.policy.sessionTtlMs).toISOString(),
      };
      sessions.set(sha256Hex(sessionToken), session);
      deps.audit({ at: issuedAt, action: 'SESSION_ISSUED', sessionId: session.sessionId, brainRunId, call: null, reasonCode: null });
      return { ok: true, sessionToken, session };
    },

    authorize(input: { readonly sessionToken: string; readonly call: JuliusBrainServiceCall }):
      { readonly ok: true; readonly session: JuliusBrainRunSession } | { readonly ok: false; readonly reasonCode: JuliusBrainAccessRefusal; readonly detail: string } {
      const session = sessions.get(sha256Hex(input.sessionToken)) ?? null;
      const refuse = (reasonCode: JuliusBrainAccessRefusal, detail: string) => {
        deps.audit({ at: nowIso(), action: 'CALL_REFUSED', sessionId: session?.sessionId ?? null, brainRunId: session?.brainRunId ?? null, call: input.call.type, reasonCode });
        return { ok: false as const, reasonCode, detail };
      };
      if (session === null) return refuse('session_unknown', 'no such session in this service');
      if (Date.parse(nowIso()) >= Date.parse(session.expiresAt)) return refuse('session_expired', `expired ${session.expiresAt}`);
      if (session.environment !== deps.environment) return refuse('environment_mismatch', `a ${session.environment} session in a ${deps.environment} service`);
      const { call } = input;
      switch (call.type) {
        case 'RAW_STORE':
          return refuse('raw_store_not_exposed', call.operation);
        case 'READ_CONTEXT':
          if (call.runId !== undefined && call.runId !== session.brainRunId) return refuse('other_run', call.runId);
          if (call.missionId !== undefined && call.missionId !== session.missionId) return refuse('other_mission', call.missionId);
          if (call.stateMode !== undefined && juliusBrainStateModePolicyHash(call.stateMode) !== session.policyHash) return refuse('state_mode_is_bound', `${call.stateMode.mode} is not this session's mode`);
          break;
        case 'SEAL':
          if (call.runId !== session.brainRunId) return refuse('other_run', call.runId);
          break;
        case 'WRITE':
          for (const [index, draft] of call.drafts.entries()) {
            if (!session.writeKinds.includes(draft.kind)) return refuse('kind_not_permitted', `drafts[${index}]: ${draft.kind}`);
            if (draft.scope.runId !== session.brainRunId || draft.scope.missionId !== session.missionId) return refuse('mutation_out_of_scope', `drafts[${index}]: scoped to ${draft.scope.runId ?? 'no run'} of ${draft.scope.missionId ?? 'no mission'}`);
          }
          break;
      }
      deps.audit({ at: nowIso(), action: 'CALL_ALLOWED', sessionId: session.sessionId, brainRunId: session.brainRunId, call: call.type, reasonCode: null });
      return { ok: true, session };
    },

    /** Retrieval, selected here under the session's bound mode: the client names no mode, run or grant. */
    context(session: JuliusBrainRunSession, entities: readonly JuliusBrainEntityState[], request: { readonly role: 'PROMPT_ARCHITECT' | 'CODING_AGENT' | 'INDEPENDENT_REVIEWER'; readonly budgetCharacters: number }): JuliusBrainContextView | null {
      const view = compileJuliusBrainContextForMode(entities, {
        taskId: null, role: request.role, grant: defaultJuliusBrainReadGrant(juliusPrincipal('WORKER', `session:${session.sessionId}`, { role: request.role }), deps.brainId),
        budgetCharacters: request.budgetCharacters, asOf: nowIso(),
      }, session.policy);
      return 'outcome' in view ? null : view.context;
    },
  };
}
