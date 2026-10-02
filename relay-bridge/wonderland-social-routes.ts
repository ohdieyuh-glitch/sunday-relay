/**
 * WONDERLAND SOCIAL — the desktop client's social routes, /wonderland/social/*.
 *
 * Every request passes the same gates, in order, before a rule runs:
 *   1. DESKTOP ONLY. A request with a browser Origin is refused: the `social` capability is the desktop client's.
 *   2. A LIVE NATIVE SESSION (`Authorization: Relay-Session <token>`), verified by the session store.
 *   3. THE TABLE. `nativeSocialMayCall` (wonderland-social-scope.ts): the session holds the `social` capability and the path
 *      is exactly one operation's -- anything else is refused, whatever its prefix.
 *   4. THE ACTOR IS THE SESSION'S PLAYER (`bindSocialActor`): a body naming another actor is refused.
 *   5. THE PLAYER'S SOCIAL RECORD exists (created on first contact from the account they paired with).
 * Then ONE operation runs, atomically, in the social store (src/relay/social/social-store.ts), and the change is told to
 * its audience through the events stream.
 *
 * EVENTS FOR A CLIENT THAT CANNOT HOLD A STREAM OPEN. Unreal polls: `GET /wonderland/social/events?after=<seq>` returns
 * the player's events after that sequence (which operation, when -- never what), the latest sequence, and `reset` when the
 * log no longer reaches back that far. The client then reads `snapshot.read` again; what it sees is what the presence
 * authority lets it see.
 *
 * NOT WIRED YET. The `social` capability is granted at pairing on the integrated line (founder-gated); until then
 * `verifySession` returns sessions without it and every call is refused at gate 3.
 */

import type { SocialOperationId } from '../src/relay/social/social-contracts';
import type { SocialPlayerIdentity, SocialStore } from '../src/relay/social/social-store';
import { bindSocialActor, nativeSocialMayCall, SOCIAL_OPERATIONS } from './wonderland-social-scope';

export const SOCIAL_ROUTE_PREFIX = '/wonderland/social';

export interface SocialRouteRequest {
  readonly method: string;
  /** Path with `/relay-api` already stripped; may carry a query string. */
  readonly path: string;
  readonly authorization: string | undefined;
  readonly origin: string | undefined;
  readonly body: unknown;
  readonly now: number;
}

export interface SocialRouteResult {
  readonly status: number;
  readonly body: unknown;
}

/** What the session store knows about a live native session. */
export interface SocialSessionFacts {
  readonly sessionId: string;
  readonly participantId: string;
  /** Granted at pairing. */
  readonly capabilities: readonly string[];
}

export interface SocialRouteDeps {
  /** A live native session's facts, or null (unknown, expired, revoked, or not a native session). */
  readonly verifySession: (token: string, now: number) => SocialSessionFacts | null;
  /** Who the paired player is, for their social record. Null when the account is unknown. */
  readonly identify: (participantId: string) => Promise<SocialPlayerIdentity | null>;
  /** Null when this bridge has no social store: every call is 503. */
  readonly store: SocialStore | null;
}

const ok = (data: unknown): SocialRouteResult => ({ status: 200, body: { data } });
const err = (status: number, kind: string, message: string): SocialRouteResult => ({ status, body: { error: { kind, message } } });

export function isSocialRoute(path: string): boolean {
  const pathname = path.split('?')[0];
  return pathname === SOCIAL_ROUTE_PREFIX || pathname.startsWith(`${SOCIAL_ROUTE_PREFIX}/`);
}

function sessionToken(header: string | undefined): string | null {
  if (header === undefined) return null;
  const match = /^Relay-Session\s+(.+)$/i.exec(header.trim());
  return match === null ? null : match[1];
}

function parseQuery(search: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of search.split('&')) {
    if (pair.length === 0) continue;
    const at = pair.indexOf('=');
    const key = at < 0 ? pair : pair.slice(0, at);
    const value = at < 0 ? '' : pair.slice(at + 1);
    // Only plain tokens are meaningful here (numbers, ids); anything encoded is ignored rather than decoded.
    if (/^[A-Za-z0-9_-]{1,32}$/.test(key) && /^[A-Za-z0-9_.-]{0,80}$/.test(value)) out[key] = value;
  }
  return out;
}

/** The ids of a path, in the order its template names them ("/parties/:id/members/:id/remove" -> [party, member]). */
function idsOf(template: string, pathname: string): string[] {
  const want = template.split('/');
  const got = pathname.slice(SOCIAL_ROUTE_PREFIX.length).split('/');
  const ids: string[] = [];
  want.forEach((segment, index) => {
    if (segment === ':id') ids.push(got[index] ?? '');
  });
  return ids;
}

/** A refusal from a rule, as HTTP. */
function statusFor(code: string): number {
  switch (code) {
    case 'not-found':
      return 404;
    case 'permission-denied':
      return 403;
    case 'validation-failed':
    case 'invalid-command':
      return 400;
    case 'illegal-transition':
    case 'duplicate-command':
    case 'immutable':
      return 409;
    default:
      return 400;
  }
}

export async function handleSocialRoute(request: SocialRouteRequest, deps: SocialRouteDeps): Promise<SocialRouteResult | null> {
  if (!isSocialRoute(request.path)) return null;
  // 1. desktop only
  if (request.origin !== undefined && request.origin !== '') {
    return err(403, 'desktop_only', 'Wonderland social is reached from the Wonderland desktop client.');
  }
  // 2. a live native session
  const token = sessionToken(request.authorization);
  const facts = token === null ? null : deps.verifySession(token, request.now);
  if (facts === null) return err(401, 'session_required', 'Sign in to Wonderland to use social.');
  // 3. the table
  const [pathname, search = ''] = request.path.split('?', 2);
  const op = nativeSocialMayCall(request.method, pathname, { scope: 'native_world', participantId: facts.participantId, capabilities: facts.capabilities });
  if (op === null) return err(403, 'not_permitted', 'This session may not do that.');
  if (deps.store === null) return err(503, 'social_unavailable', 'Social is not available on this server.');
  // 4. the actor is the session's player
  const body = request.body !== null && typeof request.body === 'object' && !Array.isArray(request.body) ? (request.body as Record<string, unknown>) : {};
  const actor = bindSocialActor({ scope: 'native_world', participantId: facts.participantId, capabilities: facts.capabilities }, body);
  if (!actor.ok) return err(403, 'actor_mismatch', actor.error);
  // 5. their social record
  const identity = await deps.identify(actor.actorId);
  if (identity === null) return err(403, 'unknown_player', 'This account has no Wonderland player.');
  const nowIso = new Date(request.now).toISOString();
  await deps.store.ensureUser(identity, nowIso);

  const query = parseQuery(search);
  if (op.id === 'events.stream') {
    const after = Number.parseInt(query.after ?? '0', 10);
    const limit = Number.parseInt(query.limit ?? '100', 10);
    return ok(await deps.store.eventsFor(actor.actorId, Number.isFinite(after) && after > 0 ? after : 0, Number.isFinite(limit) && limit > 0 ? limit : 100));
  }
  const result = await deps.store.apply(op.id as SocialOperationId, actor.actorId, { ids: idsOf(op.template, pathname), body, query }, nowIso);
  if (!result.ok) return err(statusFor(result.error.code), result.error.code, result.error.message);
  return ok(result.value);
}

/** Every operation this module serves, for a reviewer: exactly the table's. */
export const SOCIAL_ROUTE_OPERATIONS: readonly SocialOperationId[] = SOCIAL_OPERATIONS.map((o) => o.id);
