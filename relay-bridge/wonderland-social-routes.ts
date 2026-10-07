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
 *   6. THE PRESENCE LEASE (createPresenceLease, when the bridge gives one): the call renews the player's lease, and anyone silent
 *      for longer than PRESENCE_LEASE_MS goes OFFLINE through the sign-out path.
 *   7. THE PLAYER'S BUDGETS (createCommandBudgets, when the bridge gives them): over budget is 429 rate_limited + Retry-After, and
 *      nothing runs.
 * Then ONE operation runs, atomically, in the social store (src/relay/social/social-store.ts), and the change is told to
 * its audience through the events stream.
 *
 * EVENTS FOR A CLIENT THAT CANNOT HOLD A STREAM OPEN. Unreal polls: `GET /wonderland/social/events?after=<seq>` returns
 * the player's events after that sequence (which operation, when -- never what), the latest sequence, and `reset` when the
 * log no longer reaches back that far. The client then reads `snapshot.read` again; what it sees is what the presence
 * authority lets it see.
 *
 * HOW A SESSION GETS HERE (R16). The desktop client signs its player in by GitHub's device flow
 * (wonderland-native-signin-routes.ts) and holds a `native_social` session carrying `social`; server.ts serves these routes
 * only when the deployment sets WONDERLAND_SOCIAL_ENABLED=1.
 *
 * NEVER STORED ON THE WAY. Every answer here -- a refusal included -- carries Cache-Control: no-store (and Pragma: no-cache):
 * a social view is one viewer's.
 *
 * THE DELIVERY TAP (tests and QA only). When server.ts is given WONDERLAND_SOCIAL_TAP, every events poll and every
 * snapshot.read answered here is told to the tap: who received it, which event sequences and operations, and which user
 * ids the snapshot named -- never a message body or any other content.
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
  /** This answer's own response headers, added to the bridge's: every social answer's no-store. */
  readonly headers?: Readonly<Record<string, string>>;
}

/** What the session store knows about a live native session. */
export interface SocialSessionFacts {
  readonly sessionId: string;
  readonly participantId: string;
  /** The capabilities the session holds (a desktop sign-in's `native_social` session holds `social`). */
  readonly capabilities: readonly string[];
  /** Which native scope verified it. Absent means `native_world` (the dev server and the older tests). */
  readonly scope?: 'native_world' | 'native_social';
}

/** One answer as the tap records it: ids and sequence numbers only. */
export interface SocialDeliveryRecord {
  readonly at: string;
  readonly recipient: string;
  readonly kind: 'events' | 'snapshot';
  readonly seqs: readonly number[];
  readonly ops: readonly string[];
  readonly userIds: readonly string[];
}

export interface SocialRouteDeps {
  /** A live native session's facts, or null (unknown, expired, revoked, or not a native session). */
  readonly verifySession: (token: string, now: number) => SocialSessionFacts | null;
  /** Who the paired player is, for their social record. Null when the account is unknown. */
  readonly identify: (participantId: string) => Promise<SocialPlayerIdentity | null>;
  /**
   * The social store, or null when this bridge has none (every call is 503, after the gates). A FUNCTION is called only once the
   * session and the table have admitted the call, so an anonymous or refused request never opens it (JUJU MAIN's hosted plan r3).
   */
  readonly store: SocialStore | null | (() => Promise<SocialStore | null>);
  /** Presence as a LEASE (createPresenceLease), built ONCE by the bridge. Absent or null: `connected` is cleared only by the client,
   *  a sign-out or a restart -- the behaviour a crashed client exposed (it stayed ONLINE to its friends). */
  readonly presenceLease?: PresenceLease | null;
  /** Per-player command budgets (createCommandBudgets), built ONCE by the bridge. Absent or null: unlimited (tests and the dev server). */
  readonly commandBudgets?: CommandBudgets | null;
  /** Tests and QA only: told about every events poll and snapshot answered. */
  readonly tap?: ((record: SocialDeliveryRecord) => void) | null;
}

/** The keys of a social view that name a PERSON. Party, conversation and request ids are not people. */
const PERSON_KEYS = new Set(['userId', 'leaderId', 'fromUserId', 'toUserId', 'senderId', 'otherUserId', 'targetId', 'blockerId', 'blockedId', 'memberIds']);

/** Every person a view names, by the keys above, anywhere in it. Values only; never a body. */
function peopleNamedIn(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) peopleNamedIn(item, into);
  } else if (value !== null && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      if (PERSON_KEYS.has(key)) {
        if (typeof inner === 'string' && inner !== '') into.add(inner);
        if (Array.isArray(inner)) for (const id of inner) if (typeof id === 'string' && id !== '') into.add(id);
      } else {
        peopleNamedIn(inner, into);
      }
    }
  }
  return into;
}

const ok = (data: unknown): SocialRouteResult => ({ status: 200, body: { data } });
const err = (status: number, kind: string, message: string): SocialRouteResult => ({ status, body: { error: { kind, message } } });

/** Never stored by anything between the bridge and the client: on every social answer. */
const NO_STORE: Readonly<Record<string, string>> = Object.freeze({ 'cache-control': 'no-store', pragma: 'no-cache' });

/**
 * PRESENCE IS A LEASE (Second's R16 review, 10-06). The client says `connected: true` once, when its live service starts, and
 * `false` only on a graceful exit; a client that crashed, was killed or lost its network stayed ONLINE to its friends until a sign-out
 * or a restart. But a live client talks to the bridge all the time (its events poll every 2 s, its world report at 5 Hz), so every
 * authenticated social call renews the player's lease. A player silent for longer than the lease is taken OFFLINE through the same
 * path as a sign-out (the presence authority tells exactly whom it may: P1), and their next call restores them. A player who said
 * `connected: false` themselves is never resurrected by the lease. The lease is held in memory by ONE bridge process -- as
 * `connected` itself is never stored (a restart signs everyone out) -- so the hosted bridge runs a single instance.
 */
export const PRESENCE_LEASE_MS = 60_000;

export interface PresenceLease {
  /** The player made an authenticated social call at `now`. True when the LEASE had taken them offline: restore their presence. */
  touch(userId: string, now: number): boolean;
  /** Players silent for longer than the lease, each returned ONCE (until they call again); at most one sweep per second. */
  lapsed(now: number): string[];
  /** The lease took this player offline (they were still connected): their next call restores them. Never set for a player who
   *  said goodbye themselves -- a stray call after `connected: false` must not resurrect them. */
  markTakenOffline(userId: string): void;
  /** A sign-out already ended their presence: forget them, so the lease neither ends nor restores it again. */
  forget(userId: string): void;
}

export function createPresenceLease(leaseMs: number = PRESENCE_LEASE_MS): PresenceLease {
  const lastCall = new Map<string, number>();
  const takenOffline = new Set<string>();
  let lastSweep = Number.NEGATIVE_INFINITY;
  return {
    touch(userId, now) {
      lastCall.set(userId, now);
      return takenOffline.delete(userId);
    },
    lapsed(now) {
      if (now - lastSweep < 1_000) return [];
      lastSweep = now;
      const gone: string[] = [];
      for (const [userId, at] of lastCall) {
        if (now - at > leaseMs) {
          lastCall.delete(userId);
          gone.push(userId);
        }
      }
      return gone;
    },
    markTakenOffline(userId) {
      takenOffline.add(userId);
    },
    forget(userId) {
      lastCall.delete(userId);
      takenOffline.delete(userId);
    },
  };
}

/**
 * PER-PLAYER COMMAND BUDGETS (Second's R16 review, 10-06: before this, a signed-in account could send friend requests, messages,
 * invitations and reports without limit). Each budget is a burst, then one call per `everyMs` (an integer-millisecond GCRA: no
 * fractional token that never comes due). A call is charged to EVERY class it belongs to, and only when all of them admit it: a
 * refused call is not executed and charges nothing. The live client's own rhythm -- the 2 s events poll, the 5 Hz world report, a
 * snapshot after each action -- stays far inside its budgets.
 */
export const SOCIAL_BUDGETS = Object.freeze({
  read: Object.freeze({ burst: 120, everyMs: 200 }),
  report: Object.freeze({ burst: 30, everyMs: 100 }),
  write: Object.freeze({ burst: 60, everyMs: 1_000 }),
  message: Object.freeze({ burst: 20, everyMs: 3_000 }),
  invitation: Object.freeze({ burst: 10, everyMs: 30_000 }),
});
export type SocialBudgetClass = keyof typeof SOCIAL_BUDGETS;
type BudgetTable = Readonly<Record<SocialBudgetClass, Readonly<{ burst: number; everyMs: number }>>>;

const INVITATION_OPS = new Set(['requests.send', 'parties.invite', 'world.invite']);

/** The classes a call is charged to: the world report alone; any other read; any write, plus message / invitation for those. */
export function budgetClassesOf(op: { readonly id: string; readonly writes: boolean }): SocialBudgetClass[] {
  if (op.id === 'world.state') return ['report'];
  if (!op.writes) return ['read'];
  if (op.id === 'messages.send') return ['write', 'message'];
  if (INVITATION_OPS.has(op.id)) return ['write', 'invitation'];
  return ['write'];
}

export interface CommandBudgets {
  take(userId: string, classes: readonly SocialBudgetClass[], now: number): { ok: true } | { ok: false; retryAfterMs: number; budget: SocialBudgetClass };
}

export function createCommandBudgets(table: BudgetTable = SOCIAL_BUDGETS): CommandBudgets {
  const tat = new Map<string, number>();   // `${class}:${userId}` -> the theoretical arrival time, integer ms
  let lastPrune = 0;
  return {
    take(userId, classes, now) {
      const at = Math.floor(now);
      if (at - lastPrune > 60_000) {
        lastPrune = at;
        for (const [key, t] of tat) if (t <= at) tat.delete(key);   // fully refilled: nothing to remember
      }
      const next: Array<[string, number]> = [];
      for (const budget of classes) {
        const { burst, everyMs } = table[budget];
        const key = `${budget}:${userId}`;
        const t = Math.max(tat.get(key) ?? at, at);
        const tolerance = (burst - 1) * everyMs;
        if (t - at > tolerance) return { ok: false, retryAfterMs: t - at - tolerance, budget };
        next.push([key, t + everyMs]);
      }
      for (const [key, t] of next) tat.set(key, t);
      return { ok: true };
    },
  };
}

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
  const result = await answerSocialRoute(request, deps);
  return result === null ? null : { ...result, headers: { ...NO_STORE, ...(result.headers ?? {}) } };
}

async function answerSocialRoute(request: SocialRouteRequest, deps: SocialRouteDeps): Promise<SocialRouteResult | null> {
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
  const scope = facts.scope ?? 'native_world';
  const op = nativeSocialMayCall(request.method, pathname, { scope, participantId: facts.participantId, capabilities: facts.capabilities });
  if (op === null) return err(403, 'not_permitted', 'This session may not do that.');
  const store = typeof deps.store === 'function' ? await deps.store() : deps.store;
  if (store === null) return err(503, 'social_unavailable', 'Social is not available on this server.');
  // 4. the actor is the session's player
  const body = request.body !== null && typeof request.body === 'object' && !Array.isArray(request.body) ? (request.body as Record<string, unknown>) : {};
  const actor = bindSocialActor({ scope, participantId: facts.participantId, capabilities: facts.capabilities }, body);
  if (!actor.ok) return err(403, 'actor_mismatch', actor.error);
  // 5. their social record
  const identity = await deps.identify(actor.actorId);
  if (identity === null) return err(403, 'unknown_player', 'This account has no Wonderland player.');
  const nowIso = new Date(request.now).toISOString();
  await store.ensureUser(identity, nowIso);
  // 6. the lease: this call proves the player is here (restoring them if the lease took them offline -- unless this very call is
  // their own goodbye); then anyone silent for longer than the lease goes offline through the sign-out path
  const lease = deps.presenceLease ?? null;
  if (lease !== null) {
    const goodbye = op.id === 'presence.update_self' && body.connected === false;
    if (lease.touch(actor.actorId, request.now) && !goodbye) {
      await store.apply('presence.update_self', actor.actorId, { ids: [], body: { connected: true }, query: {} }, nowIso);
    }
    const silent = lease.lapsed(request.now);
    if (silent.length > 0) {
      // only a player still CONNECTED is taken offline (and only they are restored by their next call): one who said goodbye stays gone
      const state = await store.read();
      for (const gone of silent) {
        if (state.users[gone]?.presence.connected === true) {
          await endSocialPresence(store, gone, request.now);
          lease.markTakenOffline(gone);
        }
      }
    }
  }
  // 7. the budget: a refused call is not executed and charges nothing
  const budgets = deps.commandBudgets ?? null;
  if (budgets !== null) {
    const took = budgets.take(actor.actorId, budgetClassesOf(op), request.now);
    if (!took.ok) {
      const seconds = Math.max(1, Math.ceil(took.retryAfterMs / 1000));
      return { ...err(429, 'rate_limited', `Too many requests; try again in ${seconds} s.`), headers: { 'retry-after': String(seconds) } };
    }
  }

  const query = parseQuery(search);
  if (op.id === 'events.stream') {
    const after = Number.parseInt(query.after ?? '0', 10);
    const limit = Number.parseInt(query.limit ?? '100', 10);
    const page = await store.eventsFor(actor.actorId, Number.isFinite(after) && after > 0 ? after : 0, Number.isFinite(limit) && limit > 0 ? limit : 100);
    deps.tap?.({ at: nowIso, recipient: actor.actorId, kind: 'events', seqs: page.events.map((e) => e.seq), ops: page.events.map((e) => e.op), userIds: [] });
    return ok(page);
  }
  const result = await store.apply(op.id as SocialOperationId, actor.actorId, { ids: idsOf(op.template, pathname), body, query }, nowIso);
  // A RETRYABLE FAILURE IS AN OUTAGE, NOT A REFUSAL: a durable write that did not commit changed nothing and says 503.
  if (!result.ok) return err(result.error.retryable === true ? 503 : statusFor(result.error.code), result.error.code, result.error.message);
  if (op.id === 'snapshot.read') {
    deps.tap?.({ at: nowIso, recipient: actor.actorId, kind: 'snapshot', seqs: [], ops: [], userIds: [...peopleNamedIn(result.value)].sort() });
  }
  return ok(result.value);
}

/** Every operation this module serves, for a reviewer: exactly the table's. */
export const SOCIAL_ROUTE_OPERATIONS: readonly SocialOperationId[] = SOCIAL_OPERATIONS.map((o) => o.id);

/**
 * SIGN-OUT ENDS PRESENCE. A signed-out player is OFFLINE to everybody at once (their friends and party are told, through the one
 * presence authority, exactly as if their client had reported it) and leaves their world context. Before this, `connected` was
 * cleared only by the client or a bridge restart (Second's R16 run, 10-04: C saw A ONLINE after A signed out). A player with no
 * social record is left alone.
 */
export async function endSocialPresence(store: SocialStore | null, participantId: string, now: number): Promise<void> {
  if (store === null) return;
  const nowIso = new Date(now).toISOString();
  await store.apply('presence.update_self', participantId, { ids: [], body: { connected: false }, query: {} }, nowIso);
  await store.apply('world.leave', participantId, { ids: [], body: {}, query: {} }, nowIso);
}
