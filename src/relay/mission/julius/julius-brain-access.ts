import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto';

import { canonicalJuliusBrainJson, juliusBrainSha256, juliusPrincipal, type JuliusBrainDraft, type JuliusBrainPrincipal, type JuliusBrainRecordKind } from './julius-brain-contracts';
import type { JuliusBrainOidcKeyStore } from './julius-brain-oidc-keys';
import type { JuliusBrainOperationClass, JuliusBrainRateLimiter, JuliusBrainRateScope } from './julius-brain-rate-limit';
import type { JuliusBrainEntityState } from './julius-brain-projection';
import type { JuliusBrainContextView } from './julius-brain-query';
import { defaultJuliusBrainReadGrant } from './julius-brain-service';
import {
  compileJuliusBrainContextForMode,
  juliusBrainStateModePolicyHash,
  selectJuliusBrainEntitiesForMode,
  validateJuliusBrainStateModePolicy,
  type JuliusBrainStateModePolicy,
} from './julius-brain-state-modes';

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
 *                        must be the service's own, and the service must be
 *                        bound to a Brain database of that same environment
 *   mission identity     bound when the attempt first registers
 *   state mode           bound when the attempt first registers — a later
 *                        session, even after a service restart, cannot change
 *                        it — and anything but FRESH needs an operator grant
 *                        naming the run and policy
 *   write kinds          an allowlist; mission authority is never written by
 *                        a run
 *   retrieval scope      selected server-side under the bound mode
 *   artifact reads       only an artifact an entity admitted under the bound
 *                        mode references
 *   mutation scope       every draft scoped to the session's run and mission;
 *                        a revision or retirement only of an entity the
 *                        service resolved to that run and mission
 *   expiry               the session's, never refreshed by the client
 *   replay               a token id is accepted once, durably
 *   raw store            never exposed
 *
 * Token claims, registrations and sessions live behind a state port, so a
 * service restart forgets nothing that protects the Brain. Every decision —
 * issued, refused, allowed — is appended to a hash-chained audit before it takes
 * effect, without any token; an audit that cannot be written is a refusal.
 */

export const GITHUB_ACTIONS_OIDC_ISSUER = 'https://token.actions.githubusercontent.com';
const CLOCK_SKEW_SECONDS = 60;
const MAX_TOKEN_AGE_SECONDS = 15 * 60;

export type JuliusBrainServiceEnvironment = 'development' | 'test' | 'production';

export interface JuliusBrainAccessPolicy {
  readonly audience: string;
  readonly repositoryId: string;
  readonly repositoryOwnerId: string;
  /** e.g. `owner/repo/.github/workflows/julius-first-live-mission.yml@refs/heads/main` */
  readonly workflowRef: string;
  readonly ref: string;
  readonly allowedEvents: readonly string[];
  /** Protected GitHub environment name → the Brain environment it may reach. */
  readonly environments: Readonly<Record<string, JuliusBrainServiceEnvironment>>;
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
  | 'session_unknown' | 'session_expired' | 'other_run' | 'other_mission' | 'state_mode_is_bound' | 'kind_not_permitted' | 'mutation_out_of_scope'
  | 'mutation_target_unresolved' | 'artifact_not_admitted' | 'raw_store_not_exposed' | 'issuer_keys_unavailable' | 'rate_limited';

/** An RSA public key as the issuer publishes it (JWKS). */
export interface JuliusBrainJwk { readonly kty: string; readonly kid?: string; readonly n?: string; readonly e?: string; readonly alg?: string; readonly use?: string }

const b64url = (value: string): Buffer | null => (/^[A-Za-z0-9_-]*$/.test(value) ? Buffer.from(value, 'base64url') : null);

/**
 * The algorithm and key id a token claims, read before anything is verified —
 * so the right key can be resolved. Nothing here is trusted: the header only
 * says which key to check the signature against.
 */
export function readJuliusBrainTokenHeader(token: string): { readonly ok: true; readonly alg: string; readonly kid: string } | { readonly ok: false; readonly reasonCode: JuliusBrainAccessRefusal; readonly detail: string } {
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reasonCode: 'token_malformed', detail: 'not a JWS compact token' };
  let header: unknown;
  try { header = JSON.parse(b64url(parts[0]!)?.toString('utf8') ?? 'null'); } catch { return { ok: false, reasonCode: 'token_malformed', detail: 'header is not JSON' }; }
  if (typeof header !== 'object' || header === null) return { ok: false, reasonCode: 'token_malformed', detail: 'header is not an object' };
  const { alg, kid } = header as Record<string, unknown>;
  if (alg !== 'RS256') return { ok: false, reasonCode: 'token_algorithm_refused', detail: `alg ${String(alg)}` };
  if (typeof kid !== 'string' || kid.length === 0 || kid.length > 256) return { ok: false, reasonCode: 'token_key_unknown', detail: `kid ${String(kid)}` };
  return { ok: true, alg, kid };
}
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
  readonly environment: JuliusBrainServiceEnvironment;
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
  | { readonly type: 'READ_ARTIFACT'; readonly contentHash: string }
  | { readonly type: 'RECOVER'; readonly archiveContentHash: string }
  | { readonly type: 'RAW_STORE'; readonly operation: string };

/** What a call costs against the abuse boundary. */
export const JULIUS_BRAIN_CALL_OPERATION_CLASS: Readonly<Record<JuliusBrainServiceCall['type'], JuliusBrainOperationClass>> = {
  READ_CONTEXT: 'READ', WRITE: 'WRITE', SEAL: 'WRITE', READ_ARTIFACT: 'ARTIFACT_READ', RECOVER: 'RECOVERY', RAW_STORE: 'ADMIN',
};

/** What the service resolved, server-side, about the entities a call touches. The client supplies none of it. */
export interface JuliusBrainCallFacts {
  /** For WRITE: the current scope of every entity a non-CREATE draft targets. */
  readonly targets?: ReadonlyMap<string, { readonly runId: string | null; readonly missionId: string | null }>;
  /** For READ_ARTIFACT: the Brain's entities, from which the bound mode's admissions are selected. */
  readonly entities?: readonly JuliusBrainEntityState[];
}

/* -------------------------------------------------------------- the audit */

export interface JuliusBrainAuditEntry {
  readonly at: string;
  readonly action: 'SESSION_ISSUED' | 'SESSION_REFUSED' | 'CALL_ALLOWED' | 'CALL_REFUSED';
  readonly sessionId: string | null;
  readonly brainRunId: string | null;
  readonly call: JuliusBrainServiceCall['type'] | null;
  readonly reasonCode: JuliusBrainAccessRefusal | null;
  /** For a refused call, the rate-limit scope that refused it; for an allowed one, null. */
  readonly rateScope?: JuliusBrainRateScope | null;
  /** True when an admitted operation completed after its session expired (allowed; the next call needs a live session). */
  readonly afterExpiry?: true;
}

/** An audit entry as chained: each one commits to the one before it. */
export interface JuliusBrainAuditEvent extends JuliusBrainAuditEntry {
  readonly sequence: number;
  readonly previousHash: string | null;
  readonly hash: string;
}

export const JULIUS_BRAIN_AUDIT_GENESIS = null;

export function chainJuliusBrainAuditEvent(previous: Pick<JuliusBrainAuditEvent, 'sequence' | 'hash'> | null, entry: JuliusBrainAuditEntry): JuliusBrainAuditEvent {
  const unhashed = {
    at: entry.at, action: entry.action, sessionId: entry.sessionId, brainRunId: entry.brainRunId, call: entry.call, reasonCode: entry.reasonCode,
    // Optional facts are part of the entry, so they are part of what the hash commits to.
    ...(entry.rateScope === undefined || entry.rateScope === null ? {} : { rateScope: entry.rateScope }),
    ...(entry.afterExpiry === undefined ? {} : { afterExpiry: entry.afterExpiry }),
    sequence: (previous?.sequence ?? 0) + 1, previousHash: previous?.hash ?? JULIUS_BRAIN_AUDIT_GENESIS,
  };
  return { ...unhashed, hash: juliusBrainSha256(canonicalJuliusBrainJson(unhashed)) };
}

/**
 * Whether an audit is the chain it claims to be. Detects an edited, removed,
 * inserted or reordered event anywhere in the chain; removal of the newest
 * events is detected only against an anchor (a head recorded elsewhere).
 */
export function verifyJuliusBrainAuditChain(events: readonly JuliusBrainAuditEvent[], anchor?: { readonly sequence: number; readonly hash: string }): { readonly ok: boolean; readonly problems: readonly string[] } {
  const problems: string[] = [];
  let previous: JuliusBrainAuditEvent | null = null;
  for (const event of events) {
    const expected = chainJuliusBrainAuditEvent(previous, event);
    if (event.sequence !== expected.sequence) problems.push(`event ${event.sequence}: out of sequence (expected ${expected.sequence})`);
    else if (event.previousHash !== expected.previousHash) problems.push(`event ${event.sequence}: does not follow event ${expected.sequence - 1}`);
    else if (event.hash !== expected.hash) problems.push(`event ${event.sequence}: its content does not match its hash`);
    if (problems.length > 0) break;
    previous = event;
  }
  if (problems.length === 0 && anchor !== undefined) {
    const at = events.find((event) => event.sequence === anchor.sequence);
    if (at === undefined) problems.push(`the anchored event ${anchor.sequence} is missing`);
    else if (at.hash !== anchor.hash) problems.push(`event ${anchor.sequence}: does not match the anchor`);
  }
  return { ok: problems.length === 0, problems };
}

/* ------------------------------------------------------------ durable state */

export interface JuliusBrainAccessRegistration {
  readonly brainRunId: string;
  readonly projectId: string;
  readonly missionId: string;
  readonly policyHash: string;
  readonly environment: JuliusBrainServiceEnvironment;
  readonly registeredAt: string;
}

/** What must survive a service restart. Every method is atomic against concurrent callers. */
export interface JuliusBrainAccessStatePort {
  /** True the first time this token digest is claimed; false ever after. Only the digest is kept, never the token or its id. */
  claimToken(tokenDigest: string, expiresAt: string): Promise<boolean>;
  /** Registers the attempt if it is not registered, and returns the registration that holds either way. */
  register(registration: JuliusBrainAccessRegistration): Promise<JuliusBrainAccessRegistration>;
  /** Sessions are kept by the digest of their token, never the token. */
  putSession(tokenDigest: string, session: JuliusBrainRunSession): Promise<void>;
  getSession(tokenDigest: string): Promise<JuliusBrainRunSession | null>;
  /** Chains the entry after the current head and appends it. */
  appendAudit(entry: JuliusBrainAuditEntry): Promise<JuliusBrainAuditEvent>;
  readAudit(): Promise<readonly JuliusBrainAuditEvent[]>;
}

export function createJuliusBrainAccessMemoryState(): JuliusBrainAccessStatePort & { readonly audit: JuliusBrainAuditEvent[] } {
  const claims = new Map<string, string>();
  const registrations = new Map<string, JuliusBrainAccessRegistration>();
  const sessions = new Map<string, JuliusBrainRunSession>();
  const audit: JuliusBrainAuditEvent[] = [];
  return {
    audit,
    async claimToken(digest, expiresAt) { if (claims.has(digest)) return false; claims.set(digest, expiresAt); return true; },
    async register(registration) { const held = registrations.get(registration.brainRunId); if (held !== undefined) return held; registrations.set(registration.brainRunId, registration); return registration; },
    async putSession(digest, session) { sessions.set(digest, session); },
    async getSession(digest) { return sessions.get(digest) ?? null; },
    async appendAudit(entry) { const event = chainJuliusBrainAuditEvent(audit.at(-1) ?? null, entry); audit.push(event); return event; },
    async readAudit() { return [...audit]; },
  };
}

/* ---------------------------------------------------------------- the service */

/** An operator's authorisation for a run to use prior state: exactly this run, mission and mode policy. */
export interface JuliusBrainStateModeGrant { readonly brainRunId: string; readonly missionId: string; readonly policyHash: string }

export type JuliusBrainAccessResult<T> = { readonly ok: true } & T | { readonly ok: false; readonly reasonCode: JuliusBrainAccessRefusal; readonly detail: string };

export function createJuliusBrainAccessService(deps: {
  readonly brainId: string;
  readonly environment: JuliusBrainServiceEnvironment;
  /** The environment the Brain database this service is bound to records (as `assertJuliusBrainDatabase` verified it). */
  readonly binding: { readonly databaseEnvironment: JuliusBrainServiceEnvironment };
  readonly policy: JuliusBrainAccessPolicy;
  /** Where the issuer's signing keys come from: cached, rotated and bounded (`julius-brain-oidc-keys.ts`). */
  readonly keys: JuliusBrainOidcKeyStore;
  readonly grants: () => readonly JuliusBrainStateModeGrant[];
  readonly clock: { now(): string };
  readonly state: JuliusBrainAccessStatePort;
  /** The abuse boundary. Without one, calls are unlimited — acceptable locally, never in production. */
  readonly limits?: JuliusBrainRateLimiter;
}) {
  // A service is never bound to a Brain of another environment: a production service over a development database refuses to exist.
  if (deps.binding.databaseEnvironment !== deps.environment) {
    throw new Error(`julius_brain_access_binding_mismatch: a ${deps.environment} service bound to a ${deps.binding.databaseEnvironment} Brain database`);
  }
  const nowIso = () => deps.clock.now();
  const nowSeconds = () => Math.floor(Date.parse(nowIso()) / 1000);

  const refuseIssue = async (reasonCode: JuliusBrainAccessRefusal, detail: string, brainRunId: string | null) => {
    await deps.state.appendAudit({ at: nowIso(), action: 'SESSION_REFUSED', sessionId: null, brainRunId, call: null, reasonCode });
    return { ok: false as const, reasonCode, detail };
  };

  return {
    async issueSession(input: { readonly token: string; readonly projectId: string; readonly missionId: string; readonly stateMode: JuliusBrainStateModePolicy }):
      Promise<JuliusBrainAccessResult<{ readonly sessionToken: string; readonly session: JuliusBrainRunSession }>> {
      // The header says which key; the key store says whether the issuer publishes it, refreshing on an unknown id.
      const header = readJuliusBrainTokenHeader(input.token);
      if (!header.ok) return refuseIssue(header.reasonCode, header.detail, null);
      const resolved = await deps.keys.resolve(GITHUB_ACTIONS_OIDC_ISSUER, header.kid);
      if (!resolved.ok) {
        const reasonCode: JuliusBrainAccessRefusal = resolved.reasonCode === 'key_unknown' || resolved.reasonCode === 'key_ambiguous' || resolved.reasonCode === 'issuer_unknown' ? 'token_key_unknown' : 'issuer_keys_unavailable';
        return refuseIssue(reasonCode, resolved.detail, null);
      }
      const verified = verifyJuliusBrainOidcToken({ token: input.token, jwks: { keys: [resolved.key] }, policy: deps.policy, nowSeconds: nowSeconds() });
      if (!verified.ok) return refuseIssue(verified.reasonCode, verified.detail, null);
      const { claims } = verified;
      const brainRunId = `workflow:${claims.runId}/${claims.runAttempt}`;
      if (deps.policy.environments[claims.environment] !== deps.environment) {
        return refuseIssue('environment_mismatch', `environment ${claims.environment} does not reach a ${deps.environment} Brain`, brainRunId);
      }
      // Consumed once, durably, before anything else is decided: a refused exchange still spends the token.
      if (!(await deps.state.claimToken(sha256Hex(`${GITHUB_ACTIONS_OIDC_ISSUER}|${claims.jti}`), new Date(claims.exp * 1000).toISOString()))) {
        return refuseIssue('token_replayed', 'this token was already exchanged', brainRunId);
      }

      const policy = input.stateMode;
      const invalid = validateJuliusBrainStateModePolicy(policy);
      if (invalid.length > 0) return refuseIssue('state_mode_invalid', invalid.join('; '), brainRunId);
      if (policy.runId !== brainRunId || policy.missionId !== input.missionId) return refuseIssue('state_mode_not_for_this_run', `the policy names ${policy.runId} of ${policy.missionId}`, brainRunId);
      const policyHash = juliusBrainStateModePolicyHash(policy);
      if (policy.mode !== 'FRESH' && !deps.grants().some((grant) => grant.brainRunId === brainRunId && grant.missionId === input.missionId && grant.policyHash === policyHash)) {
        return refuseIssue('state_mode_not_authorized', `${policy.mode} needs an operator grant for ${brainRunId}`, brainRunId);
      }
      const registered = await deps.state.register({ brainRunId, projectId: input.projectId, missionId: input.missionId, policyHash, environment: deps.environment, registeredAt: nowIso() });
      if (registered.projectId !== input.projectId || registered.missionId !== input.missionId || registered.policyHash !== policyHash || registered.environment !== deps.environment) {
        return refuseIssue('run_registration_mismatch', `${brainRunId} is registered with another project, mission, state mode or environment`, brainRunId);
      }

      const sessionToken = randomBytes(32).toString('base64url');
      const issuedAt = nowIso();
      const session: JuliusBrainRunSession = {
        sessionId: `bsess:${sha256Hex(`${sessionToken}:id`).slice(0, 24)}`, brainRunId, projectId: input.projectId, missionId: input.missionId,
        environment: deps.environment, policy, policyHash, principal: juliusPrincipal('JULIUS', `julius:${brainRunId}`), writeKinds: JULIUS_BRAIN_RUN_WRITE_KINDS,
        issuedAt, expiresAt: new Date(Date.parse(issuedAt) + deps.policy.sessionTtlMs).toISOString(),
      };
      await deps.state.putSession(sha256Hex(sessionToken), session);
      // The token is handed over only once the issuance is audited.
      await deps.state.appendAudit({ at: issuedAt, action: 'SESSION_ISSUED', sessionId: session.sessionId, brainRunId, call: null, reasonCode: null });
      return { ok: true, sessionToken, session };
    },

    async authorize(input: { readonly sessionToken: string; readonly call: JuliusBrainServiceCall; readonly facts?: JuliusBrainCallFacts }):
      Promise<JuliusBrainAccessResult<{ readonly session: JuliusBrainRunSession }>> {
      const session = await deps.state.getSession(sha256Hex(input.sessionToken));
      const refuse = async (reasonCode: JuliusBrainAccessRefusal, detail: string, rateScope: JuliusBrainRateScope | null = null) => {
        await deps.state.appendAudit({ at: nowIso(), action: 'CALL_REFUSED', sessionId: session?.sessionId ?? null, brainRunId: session?.brainRunId ?? null, call: input.call.type, reasonCode, ...(rateScope === null ? {} : { rateScope }) });
        return { ok: false as const, reasonCode, detail };
      };
      if (session === null) return refuse('session_unknown', 'no such session in this service');
      if (Date.parse(nowIso()) >= Date.parse(session.expiresAt)) return refuse('session_expired', `expired ${session.expiresAt}`);
      if (session.environment !== deps.environment) return refuse('environment_mismatch', `a ${session.environment} session in a ${deps.environment} service`);
      const { call } = input;
      switch (call.type) {
        case 'RAW_STORE':
          return refuse('raw_store_not_exposed', call.operation.slice(0, 80));
        case 'READ_CONTEXT':
          if (call.runId !== undefined && call.runId !== session.brainRunId) return refuse('other_run', call.runId);
          if (call.missionId !== undefined && call.missionId !== session.missionId) return refuse('other_mission', call.missionId);
          if (call.stateMode !== undefined && juliusBrainStateModePolicyHash(call.stateMode) !== session.policyHash) return refuse('state_mode_is_bound', `${call.stateMode.mode} is not this session's mode`);
          break;
        case 'SEAL':
          if (call.runId !== session.brainRunId) return refuse('other_run', call.runId);
          break;
        case 'READ_ARTIFACT': {
          const entities = input.facts?.entities;
          if (entities === undefined) return refuse('artifact_not_admitted', 'the service did not resolve what this session may see');
          const selection = selectJuliusBrainEntitiesForMode(entities, session.policy);
          if (selection.outcome !== 'SELECTED') return refuse('artifact_not_admitted', selection.detail);
          const visible = [...selection.admitted.map((item) => item.entity), ...(selection.baseline ?? [])];
          if (!visible.some((state) => state.kind === 'ARTIFACT' && state.body.contentHash === call.contentHash)) return refuse('artifact_not_admitted', `${call.contentHash.slice(0, 23)}… is referenced by nothing this session's mode admits`);
          break;
        }
        case 'WRITE':
          for (const [index, draft] of call.drafts.entries()) {
            if (!session.writeKinds.includes(draft.kind)) return refuse('kind_not_permitted', `drafts[${index}]: ${draft.kind}`);
            if (draft.scope.runId !== session.brainRunId || draft.scope.missionId !== session.missionId) return refuse('mutation_out_of_scope', `drafts[${index}]: scoped to ${draft.scope.runId ?? 'no run'} of ${draft.scope.missionId ?? 'no mission'}`);
            if (draft.op !== 'CREATE') {
              const target = draft.entityId === null ? undefined : input.facts?.targets?.get(draft.entityId);
              if (target === undefined) return refuse('mutation_target_unresolved', `drafts[${index}]: ${draft.op} of an entity the service did not resolve`);
              if (target.runId !== session.brainRunId || target.missionId !== session.missionId) return refuse('mutation_out_of_scope', `drafts[${index}]: ${draft.op} of an entity of ${target.runId ?? 'no run'}`);
            }
          }
          break;
      }
      // The abuse boundary is the last gate before the call is admitted, and it changes nothing when it refuses.
      if (deps.limits !== undefined) {
        const admitted = await deps.limits.admit({
          principalId: session.principal.id, brainRunId: session.brainRunId, missionId: session.missionId,
          operationClass: JULIUS_BRAIN_CALL_OPERATION_CLASS[call.type],
        });
        if (!admitted.ok) return refuse('rate_limited', `${admitted.operationClass} is limited to ${admitted.limit} per ${admitted.windowMs}ms for this ${admitted.scope.toLowerCase()}; retry in ${admitted.retryAfterMs}ms`, admitted.scope);
      }
      await deps.state.appendAudit({ at: nowIso(), action: 'CALL_ALLOWED', sessionId: session.sessionId, brainRunId: session.brainRunId, call: call.type, reasonCode: null });
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
