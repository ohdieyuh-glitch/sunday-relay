/**
 * THE WONDERFS GATE (R1): every /wonderfs/v1 request passes the same gates, in this order, before any WonderFS row is read.
 *
 *   1. DESKTOP ONLY. A request with a browser Origin is refused (403 desktop_only), as social's.
 *   2. THE SCHEME (plan §2.2, interface point 1): `Authorization: Relay-Session <token>` is a PLAYER; `WonderFS-Grant <token>` is
 *      RESERVED for agents and refused until the agent phase builds grants (A1); anything else is no credential. A player session
 *      never acts under a grant, and a grant never acts as a player.
 *   3. A LIVE SESSION: the desktop client's `native_social` session (grants.ts), the same `ghu-<id>` player social sees, admitted
 *      here holding ONE capability, `wonderfs`. Its `session_ref` (§19.m1) is read with it: the principal's provenance session id.
 *      No session: 401 session_required.
 *   4. THE TABLE (wonderfs-scope.ts): the path is exactly one operation's, or 403 not_permitted.
 *   5. THE STORE EXISTS: without a database the answer is 503 wonderfs_unavailable -- a fact about this server, NEVER a switch
 *      (INV-10, §19.m6). Nothing here reads a setting.
 *   6. THE BUDGET (wonderfs-budgets.ts, §8.4): 429 rate_limited + Retry-After N, "try again in N s.", and nothing runs.
 *   7. THE ROLE, READ NOW (§8.2): the player's `project_members` role through the ONE mapping (`memberRole`, R0a/R0b), then
 *      `authorizeHuman`. This is the FIRST storage read a project operation makes, and it reads no wfs_* row: an unknown project
 *      and a project the player is not in take the same path and get the same answer, byte for byte (§9.1, §19.m2).
 *      R0a review MINOR-5(a): authorization comes before every other lookup (and, for R2's writes, before the replay lookup).
 *
 * THE ERROR MODEL (plan §1.2; contract §9.1, §8.4, §6.6): `{error:{kind, message}}`, and every answer -- a refusal included --
 * carries `Cache-Control: no-store` and `Pragma: no-cache`. Every not-found is the ONE body (`WONDERFS_NOT_FOUND`): status, body
 * and headers identical whatever was missing. A RelayError's `details` (the refusal's reason) go to the server's log only, never
 * to the caller, and no answer carries a path, a token or a stack.
 */

import type { WfsHumanRole } from '../src/relay/wonderfs/wonderfs-authz';
import { authorizeHuman } from '../src/relay/wonderfs/wonderfs-authz';
import type { WfsPrincipal } from '../src/relay/wonderfs/wonderfs-contracts';
import type { WfsStore } from '../src/relay/wonderfs/wonderfs-store';
import type { RelayError } from '../src/relay/protocol/errors';
import type { BrowserSessionStore } from './browser-session/grants';
import { wonderfsRetrySeconds, type WonderfsBudgets } from './wonderfs-budgets';
import { NATIVE_WONDERFS_CAPABILITY, wonderfsMayCall, type WonderfsAdmitted } from './wonderfs-scope';

/* --------------------------------------------------------------------------------------------------------------- answers */

/** One WonderFS answer, ready to write: JSON or bytes, always with its headers. */
export interface WonderfsAnswer {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Buffer;
}

export const WONDERFS_NO_STORE: Readonly<Record<string, string>> = Object.freeze({ 'cache-control': 'no-store', pragma: 'no-cache' });

export function wonderfsJson(status: number, value: unknown, headers: Readonly<Record<string, string>> = {}): WonderfsAnswer {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  return { status, body, headers: { ...WONDERFS_NO_STORE, 'content-type': 'application/json; charset=utf-8', 'content-length': String(body.byteLength), ...headers } };
}

export function wonderfsError(status: number, kind: string, message: string, headers: Readonly<Record<string, string>> = {}): WonderfsAnswer {
  return wonderfsJson(status, { error: { kind, message } }, headers);
}

/** THE one not-found (§9.1, §19.m2): the same status, body and headers for unknown and unauthorized alike. */
export const WONDERFS_NOT_FOUND_MESSAGE = 'Not found.';
export const wonderfsNotFound = (): WonderfsAnswer => wonderfsError(404, 'not_found', WONDERFS_NOT_FOUND_MESSAGE);

export const wonderfsUnavailable = (): WonderfsAnswer =>
  wonderfsError(503, 'wonderfs_unavailable', 'WonderFS is not available on this server right now; try again shortly.');

/** §8.4: the 429, its Retry-After and the body's "try again in N s." share ONE N. */
export function wonderfsRateLimited(retryAfterMs: number): WonderfsAnswer {
  const n = wonderfsRetrySeconds(retryAfterMs);
  return wonderfsError(429, 'rate_limited', `Too many requests; try again in ${n} s.`, { 'retry-after': String(n) });
}

/**
 * A store's refusal as HTTP (plan §1.2). The caller learns the KIND; the reason (`details`) is logged here and never sent.
 *   not-found (and permission-denied: a read never says "forbidden")  -> the one 404
 *   validation-failed                                                  -> 400 invalid_request (the stores' messages are fixed
 *                                                                         phrases that never echo a path or a value, §6.6)
 *   retryable / stale-ledger-version (an outage)                       -> 503 wonderfs_unavailable, never "not found"
 *   anything else (a bug)                                              -> 500, said plainly, nothing of it
 */
export function wonderfsFromRelayError(error: RelayError, what: string, log?: (line: string) => void): WonderfsAnswer {
  log?.(`wonderfs: ${what} refused ${error.code}${error.details === undefined ? '' : ` (${error.details.join('; ')})`}`);
  if (error.code === 'not-found' || error.code === 'permission-denied') return wonderfsNotFound();
  if (error.retryable === true || error.code === 'stale-ledger-version') return wonderfsUnavailable();
  if (error.code === 'validation-failed') return wonderfsError(400, 'invalid_request', error.message);
  return wonderfsError(500, 'wonderfs_error', 'WonderFS could not answer that request.');
}

/* --------------------------------------------------------------------------------------------------------------- session */

/** What WonderFS needs of a verified desktop session. */
export interface WonderfsSessionFacts {
  readonly sessionId: string;
  readonly participantId: string;
  /** §19.m1: the NON-AUTHENTICATING session_ref; a principal's provenance `session_id`. Never the token or its hash. */
  readonly sessionRef: string;
  readonly capabilities: readonly string[];
}

export type WonderfsSessionVerifier = (token: string, now: number) => WonderfsSessionFacts | null;

/**
 * THE BRIDGE'S SESSION HOP FOR WONDERFS, its own (it does not reuse social's `nativeSocialSessionDeps`): a live native social session,
 * its session_ref read beside it, holding exactly `wonderfs` here. A session with no session_ref (gone between the two reads) is no
 * session.
 */
export function wonderfsSessionVerifier(sessions: Pick<BrowserSessionStore, 'verifyNativeSocialSession' | 'nativeSocialSessionRef'>): WonderfsSessionVerifier {
  return (token, now) => {
    const verified = sessions.verifyNativeSocialSession({ token, now });
    if (!verified.ok) return null;
    const sessionRef = sessions.nativeSocialSessionRef({ sessionId: verified.sessionId, now });
    if (sessionRef === null) return null;
    return { sessionId: verified.sessionId, participantId: verified.participantId, sessionRef, capabilities: [NATIVE_WONDERFS_CAPABILITY] };
  };
}

/** The Authorization header, by SCHEME (plan §2.2 interface point 1). */
export type WonderfsCredential = { readonly kind: 'session'; readonly token: string } | { readonly kind: 'grant' } | { readonly kind: 'none' };

export function wonderfsCredential(header: string | undefined): WonderfsCredential {
  if (header === undefined) return { kind: 'none' };
  const session = /^Relay-Session\s+(\S+)$/i.exec(header.trim());
  if (session !== null) return { kind: 'session', token: session[1] };
  if (/^WonderFS-Grant\s+\S+$/i.test(header.trim())) return { kind: 'grant' };
  return { kind: 'none' };
}

/** The client's WLBUILD identity, when it names one in this shape (plan §3.3); anything else is unknown, never an error. */
const CLIENT_BUILD = /^[A-Za-z0-9._+-]{1,64}$/;

/**
 * THE PRINCIPAL, built HERE and only here (plan §2.2 interface point 2): from the verified session, never from a request body.
 * Reads record nothing; R2's commits carry exactly this.
 */
export function wonderfsHumanPrincipal(facts: WonderfsSessionFacts, clientBuild: string | undefined): WfsPrincipal {
  return {
    kind: 'human',
    id: facts.participantId,
    onBehalfOf: null,
    grantId: null,
    sessionId: facts.sessionRef,
    clientBuild: clientBuild !== undefined && CLIENT_BUILD.test(clientBuild) ? clientBuild : null,
    tool: 'wonderland-client',
    missionId: null,
    attemptId: null,
  };
}

/* ------------------------------------------------------------------------------------------------------------------ gate */

export interface WonderfsRequest {
  readonly method: string;
  /** The path after /relay-api, WITH its query string. */
  readonly url: string;
  readonly authorization: string | undefined;
  readonly origin: string | undefined;
  /** `x-wonderland-build`. */
  readonly clientBuild: string | undefined;
  /** `range`. */
  readonly range: string | undefined;
  readonly now: number;
}

export interface WonderfsGateDeps {
  readonly verifySession: WonderfsSessionVerifier;
  /** The store, or null when this server has no database (a FACT: 503, never a switch). Lazy: opened only after the session gate. */
  readonly store: WfsStore | null | (() => WfsStore | null);
  /** The process's budgets; null only in a test that is not about budgets. */
  readonly budgets: WonderfsBudgets | null;
  /** The server's WARN log: operation ids, error codes and the store's reason tags only -- never a token, a path or content. */
  readonly log?: (line: string) => void;
}

export interface WonderfsAdmission extends WonderfsAdmitted {
  readonly principal: WfsPrincipal;
  readonly store: WfsStore;
  /** The caller's WonderFS role in `projectId`, read NOW; null for an operation that names no project. */
  readonly role: WfsHumanRole | null;
  readonly search: string;
}

export type WonderfsGateResult = { readonly ok: true; readonly admitted: WonderfsAdmission } | { readonly ok: false; readonly answer: WonderfsAnswer };

const refuse = (answer: WonderfsAnswer): WonderfsGateResult => ({ ok: false, answer });

export async function wonderfsGate(request: WonderfsRequest, deps: WonderfsGateDeps): Promise<WonderfsGateResult> {
  // 1. desktop only
  if (request.origin !== undefined && request.origin !== '') {
    return refuse(wonderfsError(403, 'desktop_only', 'WonderFS is reached from the Wonderland desktop client.'));
  }
  // 2. the scheme; 3. a live session
  const credential = wonderfsCredential(request.authorization);
  if (credential.kind === 'grant') return refuse(wonderfsError(401, 'grant_not_accepted', 'Agent access to WonderFS is not available yet.'));
  const facts = credential.kind === 'session' ? deps.verifySession(credential.token, request.now) : null;
  if (facts === null) return refuse(wonderfsError(401, 'session_required', 'Sign in to Wonderland to use your project files.'));
  // 4. the table
  // everything after the FIRST '?' is the query (a second '?' stays in it, and its value is refused there, never dropped)
  const q = request.url.indexOf('?');
  const pathname = q < 0 ? request.url : request.url.slice(0, q);
  const search = q < 0 ? '' : request.url.slice(q + 1);
  const admitted = wonderfsMayCall(request.method, pathname, facts);
  if (admitted === null) return refuse(wonderfsError(403, 'not_permitted', 'This session may not do that.'));
  // 5. the store (opened only now: an anonymous request never opens it)
  const store = typeof deps.store === 'function' ? deps.store() : deps.store;
  if (store === null) return refuse(wonderfsUnavailable());
  // 6. the budget: charged before the membership read, so probing costs budget; identical for unknown and unauthorized
  if (deps.budgets !== null) {
    const took = deps.budgets.take(facts.participantId, admitted.projectId, request.now);
    if (!took.ok) return refuse(wonderfsRateLimited(took.retryAfterMs));
  }
  const principal = wonderfsHumanPrincipal(facts, request.clientBuild);
  if (admitted.op.action === null || admitted.projectId === null) return { ok: true, admitted: { ...admitted, principal, store, role: null, search } };
  // 7. the role, NOW, through the one mapping -- the first storage read, and no wfs_* row
  const role = await store.memberRole(admitted.projectId, facts.participantId);
  if (!role.ok) return refuse(wonderfsFromRelayError(role.error, `${admitted.op.id} membership`, deps.log));
  const allowed = authorizeHuman({ role: role.value, action: admitted.op.action, paths: [] });
  if (!allowed.ok) return refuse(wonderfsFromRelayError(allowed.error, admitted.op.id, deps.log));
  return { ok: true, admitted: { ...admitted, principal, store, role: role.value, search } };
}
