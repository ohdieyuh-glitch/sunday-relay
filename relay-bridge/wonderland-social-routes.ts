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
 * PARTY VOICE. `POST /parties/:id/voice/join {eosProductUserId}` asks the configured provider's minter for a token to the
 * caller's OWN party room, for the caller's server-bound EOS PUID (src/relay/social/voice-binding.ts). EOS keeps ONE room per
 * party and the client plays every participant in it, so the block floor is enforced before anything is bound or minted: only a
 * member walled from nobody in the party is admitted (voiceAudienceIfAdmitted), and their audience is the whole party. A
 * non-member, a WALLED member (a blocked pair still sharing a party: carried-in data, a restore) and another player's PUID all
 * answer the stranger's 404; the answer's audience lists only server-bound PUID -> player pairs. With no provider (or no binding
 * store) it is 503 VOICE TRANSPORT PENDING: a connected voice state is never fabricated.
 *
 * THE GAME CLIENT'S EOS CONFIG. `GET /voice/eos-client-config` answers the five values the desktop client's EOS platform starts
 * with -- the GAME client's (founder, 10-04: handed out by the backend, held in the client's memory only, never in the package),
 * never the Trusted Server's -- as {schema: wonderland-eos-client-config.v1, productId, sandboxId, deploymentId, clientId,
 * clientSecret}, after the same five gates as every operation. At most 6 a minute per session (429, with Retry-After).
 * Without the bridge's game config, its voice provider, its binding store or its rate limit: 503. The log says only whom it
 * served, hashed; never a value.
 *
 * NEVER STORED ON THE WAY. Every answer here -- a refusal included -- carries Cache-Control: no-store (and Pragma: no-cache):
 * a social view is one viewer's, and the EOS client config carries a secret.
 *
 * THE DELIVERY TAP (tests and QA only). When server.ts is given WONDERLAND_SOCIAL_TAP, every events poll and every
 * snapshot.read answered here is told to the tap: who received it, which event sequences and operations, and which user
 * ids the snapshot named -- never a message body or any other content.
 */

import type { SocialOperationId } from '../src/relay/social/social-contracts';
import type { SocialPlayerIdentity, SocialStore } from '../src/relay/social/social-store';
import { voiceAudienceFor, walledFromParty } from '../src/relay/social/social-parties';
import { partyById, type SocialState } from '../src/relay/social/social-state';
import { decideVoiceBinding, normalizePuid, oneVoiceJoinAtATime, type SessionIssuedAtLookup, type VoiceBindingOutcome, type VoiceBindingRow, type VoiceBindingStore } from '../src/relay/social/voice-binding';
import type { BrowserSessionStore } from './browser-session/grants';
import { bindSocialActor, NATIVE_SOCIAL_CAPABILITY, nativeSocialMayCall, SOCIAL_OPERATIONS } from './wonderland-social-scope';
import { EOS_CLIENT_CONFIG_SCHEMA, failureTag, hashId, hashPuid, type EosGameClientConfig } from './eos-voice';

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
  /**
   * When the session was issued (ms since the epoch): the voice re-bind's "newest session wins" (m3). REQUIRED (MAIN's internal
   * reviews af2eb058 m-d, a8ed4c0b MAJOR 1): every producer -- the bridge's session store, the dev server -- sets it, so no hop can
   * drop it and silently weaken the rule.
   */
  readonly issuedAtMs: number;
  /** The capabilities the session holds (a desktop sign-in's `native_social` session holds `social`). */
  readonly capabilities: readonly string[];
  /** Which native scope verified it. Absent means `native_world` (the dev server and the older tests). */
  readonly scope?: 'native_world' | 'native_social';
}

/** What a voice provider hands one member for their party's room. Its token is the member's own, for that room only. */
export interface PartyVoiceGrant {
  readonly providerId: string;
  readonly roomId: string;
  readonly participantToken: string;
  readonly expiresAtIso: string;
}

/**
 * THE PROVIDER SEAM. A real provider (EOS Voice, LiveKit, Vivox ...) implements this; it admits the caller, and never anyone else
 * on their behalf, to their party's room. The route asks only for a member walled from nobody in the party, so `audience` is the
 * whole party: a provider with one room per party (EOS) cannot carry a voice across a wall. Absent: party voice is honestly
 * unavailable.
 */
export interface PartyVoiceTokenMinter {
  readonly providerId: string;
  /** `puid`: the caller's server-bound EOS ProductUserId (EOS voice admits exactly that PUID to the room). */
  mint(input: { readonly partyId: string; readonly participantId: string; readonly audience: readonly string[]; readonly nowIso: string; readonly puid?: string }): Promise<PartyVoiceGrant>;
  /**
   * Take a player out of their party's room, server-side (EOS: removeParticipant, which also revokes the room token): every PUID
   * this process minted a token for, for them in that room, plus `puids` (a binding, whose token may predate a restart). Resolves
   * only when every removal is confirmed (an absent participant counts); rejects otherwise.
   * `mustLeave` (MAIN's internal review af2eb058, m-a): true when these PUIDs must leave whatever the answer (a token taken back, a
   * re-bind already made) -- one not confirmed is kept pending and tried again; false for a re-bind held on failure (its binding
   * is unchanged, so its PUID may stay).
   */
  removeFromRoom(input: { readonly partyId: string; readonly participantId: string; readonly puids: readonly string[]; readonly mustLeave: boolean }): Promise<void>;
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
  /**
   * The session store's lookup of a session's issue time by id: ms while it is live, null once it is gone (expired, revoked, never
   * known to this process). The voice re-bind asks it about the session that made the caller's binding: NEWEST SESSION WINS
   * (MAIN's internal review af2eb058, m-d). REQUIRED, so the bridge cannot drop it silently; null says out loud that this server's
   * sessions cannot answer (the dev server, tests), and the rule then compares with the binding's bound_at.
   */
  readonly sessionIssuedAt: ((sessionId: string, now: number) => number | null) | null;
  /** Who the paired player is, for their social record. Null when the account is unknown. */
  readonly identify: (participantId: string) => Promise<SocialPlayerIdentity | null>;
  /**
   * The social store, or null when this bridge has none (every call is 503, after the gates). A FUNCTION is called only once the
   * session and the table have admitted the call, so an anonymous or refused request never opens it (JUJU MAIN's hosted plan r3).
   */
  readonly store: SocialStore | null | (() => Promise<SocialStore | null>);
  /** The party voice provider's token minter. Absent or null: voice is 503 VOICE TRANSPORT PENDING. */
  readonly voice?: PartyVoiceTokenMinter | null;
  /** Who holds which EOS PUID (migration 035). Required with a minter; absent: voice is 503. */
  readonly voiceBindings?: VoiceBindingStore | null;
  /** The GAME client's EOS config, read once at start (eos-voice.ts loadEosGameClientConfig). Absent or null: the route is 503. */
  readonly eosClientConfig?: EosGameClientConfig | null;
  /** Whether this session may have the EOS client config now (createSessionRateLimit). Built ONCE by the bridge -- deps are
   *  per request. Absent or null: the route is 503 (it never serves unlimited). */
  readonly eosClientConfigAllowed?: ((sessionId: string, now: number) => SessionRateDecision) | null;
  /** Presence as a LEASE (createPresenceLease), built ONCE by the bridge. Absent or null: `connected` is cleared only by the client,
   *  a sign-out or a restart -- the behaviour a crashed client exposed (it stayed ONLINE to its friends). */
  readonly presenceLease?: PresenceLease | null;
  /** Per-player command budgets (createCommandBudgets), built ONCE by the bridge. Absent or null: unlimited (tests and the dev server). */
  readonly commandBudgets?: CommandBudgets | null;
  /** The bridge's log. The EOS client config route says only whom it served, hashed. */
  readonly log?: ((line: string) => void) | null;
  /** Tests and QA only: told about every events poll and snapshot answered. */
  readonly tap?: ((record: SocialDeliveryRecord) => void) | null;
}

/**
 * THE BRIDGE'S SESSION HOPS FOR SOCIAL, in one tested place (server.ts spreads exactly this; MAIN's internal reviews af2eb058 m-d
 * and m-e, a8ed4c0b MAJOR 1): a native social session's facts -- its issue time included -- and the lookup of a session's issue
 * time by id, which the voice re-bind asks about the session that made a binding.
 */
export function nativeSocialSessionDeps(
  sessions: Pick<BrowserSessionStore, 'verifyNativeSocialSession' | 'nativeSocialSessionIssuedAt'>,
): Pick<SocialRouteDeps, 'verifySession' | 'sessionIssuedAt'> {
  return {
    verifySession: (token, now) => {
      const verified = sessions.verifyNativeSocialSession({ token, now });
      return verified.ok
        ? { sessionId: verified.sessionId, participantId: verified.participantId, capabilities: [NATIVE_SOCIAL_CAPABILITY], scope: 'native_social', issuedAtMs: verified.issuedAt }
        : null;
    },
    sessionIssuedAt: (sessionId, now) => sessions.nativeSocialSessionIssuedAt({ sessionId, now }),
  };
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

/** The EOS client config's rate: a client fetches it once per sign-in. */
export const EOS_CLIENT_CONFIG_RATE = Object.freeze({ limit: 6, windowMs: 60_000 });

/** Never stored by anything between the bridge and the client: on every social answer. */
const NO_STORE: Readonly<Record<string, string>> = Object.freeze({ 'cache-control': 'no-store', pragma: 'no-cache' });

/** A session rate limit's answer: admitted, or refused until `retryAfterMs` from now (when the oldest counted call leaves the window). */
export type SessionRateDecision = { readonly ok: true } | { readonly ok: false; readonly retryAfterMs: number };

/**
 * At most `limit` calls per session in any `windowMs`; a refused call is not counted. The state lives in the closure, so the
 * bridge builds ONE and passes it with every request's deps. Sessions idle for a whole window are forgotten.
 */
export function createSessionRateLimit(limit: number, windowMs: number): (sessionId: string, now: number) => SessionRateDecision {
  const seen = new Map<string, number[]>();
  return (sessionId, now) => {
    if (seen.size > 10_000) for (const [id, times] of seen) if (times.every((t) => t <= now - windowMs)) seen.delete(id);
    const recent = (seen.get(sessionId) ?? []).filter((t) => t > now - windowMs);
    if (recent.length >= limit) {
      seen.set(sessionId, recent);
      return { ok: false, retryAfterMs: Math.max(1, recent[recent.length - limit] + windowMs - now) };
    }
    seen.set(sessionId, [...recent, now]);
    return { ok: true };
  };
}

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
  // A VOICE JOIN writes PostgreSQL and calls Epic (a token, createRoomToken, maybe a DELETE), so it is not charged as a read
  // (MAIN's internal review a6d5842c, m5). The client asks again to name each new room member, throttled to one a second (CORE's
  // client contract, 10-07): one a second, after a burst of ten, never refuses that rhythm and caps a flood at a fifth of the
  // read rate.
  voice: Object.freeze({ burst: 10, everyMs: 1_000 }),
});
export type SocialBudgetClass = keyof typeof SOCIAL_BUDGETS;
type BudgetTable = Readonly<Record<SocialBudgetClass, Readonly<{ burst: number; everyMs: number }>>>;

const INVITATION_OPS = new Set(['requests.send', 'parties.invite', 'world.invite']);

/** The classes a call is charged to: the world report alone; a voice join alone; any other read; any write, plus message / invitation for those. */
export function budgetClassesOf(op: { readonly id: string; readonly writes: boolean }): SocialBudgetClass[] {
  if (op.id === 'world.state') return ['report'];
  if (op.id === 'parties.voice_join') return ['voice'];
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

/**
 * WHO MAY HOLD A TOKEN TO A PARTY'S VOICE ROOM, AND WHOM THEY HEAR (MAIN's internal review a6d5842c, M2). EOS keeps ONE room per
 * party, and the client plays every participant of the room, bound or not: a token is never narrower than the whole room. So the
 * block floor is enforced HERE, before anything is bound or minted: a member walled from anybody in the party (a blocked pair
 * still sharing it -- carried-in data, a restore; blocks.add separates a live one) gets no token at all, the stranger's 404, like
 * a non-member. Whoever is admitted is walled from nobody, so their audience is the whole party. Null: not admitted.
 */
function voiceAudienceIfAdmitted(state: SocialState, userId: string, partyId: string): string[] | null {
  const party = partyById(state, partyId);
  if (party === undefined || walledFromParty(state, party, userId)) return null;
  const audience = voiceAudienceFor(state, userId, partyId);
  return audience.length === 0 ? null : audience;
}

/**
 * POST /parties/:id/voice/join {eosProductUserId}: a token to the caller's own party room, for their server-bound PUID.
 *   1. ADMITTED (M2): a member walled from nobody in the party, or the stranger's 404.
 *   2. THE RE-BIND (B1), one voice change per player at a time (their joins, and their departures' removals queued before this
 *      join: oneVoiceJoinAtATime, af2eb058 m-b): the outcome is predicted with decideVoiceBinding from the binding now.
 *      A predicted re-bind first takes the replaced PUID (and every PUID minted for the caller in that room) out of the room.
 *      If that fails, the answer is 503 and nothing is bound: the old binding stays. Then the store binds. If the store's
 *      outcome differs from the prediction (another process moved the binding), it is logged with hashed ids, and a re-bind
 *      nobody predicted takes the caller's minted PUIDs out of the room before any token is minted.
 *   3. The token. Then membership is READ AGAIN (M1): a caller kicked, separated or walled while this ran gets their token taken
 *      back (removeFromRoom) and the stranger's 404.
 *   4. The answer's audience: only server-bound PUID -> player pairs.
 */
async function answerVoiceJoin(input: {
  readonly store: SocialStore;
  readonly deps: SocialRouteDeps;
  readonly actorId: string;
  readonly sessionId: string;
  readonly sessionIssuedAtIso: string | null;
  /** The session store's lookup for the session that made the caller's binding (m-d), or null when it cannot answer. */
  readonly sessionIssuedAtOf: SessionIssuedAtLookup | null;
  readonly partyId: string;
  readonly body: Readonly<Record<string, unknown>>;
  readonly nowIso: string;
}): Promise<SocialRouteResult> {
  const { store, deps, actorId, sessionId, sessionIssuedAtIso, sessionIssuedAtOf, partyId, nowIso } = input;
  // Every refusal that concerns WHO the caller is answers exactly as a party that does not exist (the uniform stranger 404).
  const notThere = () => err(404, 'not-found', 'party not found');
  const audience = voiceAudienceIfAdmitted(await store.read(), actorId, partyId);
  if (audience === null) return notThere();
  const voice = deps.voice ?? null;
  const bindings = deps.voiceBindings ?? null;
  if (voice === null || bindings === null) return err(503, 'voice_unavailable', 'VOICE TRANSPORT PENDING');
  // THE CALLER'S EOS PUID, bound to them server-side (review #2): another player's PUID, or a different one of their own
  // within the session that bound the first, is refused -- as a stranger is.
  const puid = normalizePuid(input.body.eosProductUserId);
  if (puid === null) return err(400, 'validation-failed', 'eosProductUserId must be an EOS ProductUserId (32 hex characters)');
  const log = deps.log ?? (() => undefined);
  const who = `user=${hashId(actorId)} puid=${hashPuid(puid)}`;
  /**
   * A 503 that says honestly WHAT failed (CORE's client contract, 10-07: every voice 503 read "no voice provider"), with a log line
   * that carries hashed ids and a hashed reason only, never the error's text (MAIN's internal review a6d5842c, NOTE).
   */
  const failed = (message: string, what: string, error: unknown): SocialRouteResult => {
    log(`voice join: ${what} ${who} (${failureTag(error)})`);
    return err(503, 'voice_unavailable', message);
  };
  return oneVoiceJoinAtATime(bindings, actorId, async () => {
    let mine: VoiceBindingRow | null;
    let owner: string | null;
    try {
      [mine, owner] = await Promise.all([bindings.bindingOf(actorId), bindings.ownerOf(puid)]);
    } catch (error) {
      return failed('Party voice could not read your voice identity right now.', 'the binding could not be read', error);
    }
    const predicted = decideVoiceBinding({ userId: actorId, puid, sessionId, sessionIssuedAtIso, sessionIssuedAtOf, mine, owner });
    if (predicted === 'rebound' && mine !== null) {
      try {
        await voice.removeFromRoom({ partyId, participantId: actorId, puids: [mine.puid], mustLeave: false });
      } catch (error) {
        return failed(
          'Party voice could not take your previous device out of the room, so your voice identity was not changed. Try again.',
          `re-bind held, the replaced PUID is not confirmed out of the room (replaced=${hashPuid(mine.puid)})`,
          error,
        );
      }
    }
    let outcome: VoiceBindingOutcome;
    try {
      outcome = await bindings.bind({ userId: actorId, puid, sessionId, sessionIssuedAtIso, sessionIssuedAtOf, nowIso });
    } catch (error) {
      return failed('Party voice could not record your voice identity right now.', 'the bind failed', error);
    }
    if (outcome !== predicted) log(`voice join: the binding moved under this join ${who} predicted=${predicted} actual=${outcome}`);
    if (outcome === 'refused') return notThere();
    if (outcome === 'rebound' && predicted !== 'rebound') {
      try {
        await voice.removeFromRoom({ partyId, participantId: actorId, puids: mine === null ? [] : [mine.puid], mustLeave: true });
      } catch (error) {
        return failed('Party voice could not take your previous device out of the room. Try again.', 'an unpredicted re-bind left minted PUIDs in the room; no token minted', error);
      }
    }
    let grant: PartyVoiceGrant;
    try {
      grant = await voice.mint({ partyId, participantId: actorId, audience, nowIso, puid });
    } catch (error) {
      return failed('The voice provider could not admit you right now.', 'the provider minted no token', error);
    }
    // THE JOIN/KICK RACE (M1): membership was read before the bind and the mint. A kick, a leave or a block committed in between
    // queued its removal, which may have reached Epic before this token existed. So read again. No longer admitted: this PUID
    // leaves the room now (best effort, logged; a removal not confirmed is kept PENDING by the provider and tried again before
    // the room's next removal or mint, and by a timer -- af2eb058 m-a), and the answer is the stranger's 404. Not readable: the
    // same removal, and 503.
    let admittedNow: string[] | null;
    try {
      admittedNow = voiceAudienceIfAdmitted(await store.read(), actorId, partyId);
    } catch (error) {
      await takeBackToken(voice, log, { partyId, actorId, puid, who, why: `the party could not be read again (${failureTag(error)})` });
      return err(503, 'voice_unavailable', 'Party voice could not confirm your party right now.');
    }
    if (admittedNow === null) {
      await takeBackToken(voice, log, { partyId, actorId, puid, who, why: 'left the party while joining' });
      return notThere();
    }
    let bound: ReadonlyMap<string, string>;
    try {
      bound = await bindings.puidsOf(admittedNow);
    } catch (error) {
      return failed("Party voice could not read the party's voice identities right now.", 'the audience could not be read', error);
    }
    // the audience a client maps voices with: ONLY server-bound PUID -> player pairs, of the party as it is now
    const pairs = admittedNow.filter((id) => bound.has(id)).map((id) => ({ userId: id, puid: bound.get(id) as string }));
    return ok({ providerId: grant.providerId, roomId: grant.roomId, participantToken: grant.participantToken, expiresAt: grant.expiresAtIso, audience: pairs });
  });
}

/**
 * A token minted for a caller who is no longer admitted: its PUID leaves the room now. Best effort: a failure is logged, hashed, and
 * the PUID is kept pending by the provider (mustLeave), tried again before the room's next removal or mint and by a timer (m-a).
 */
async function takeBackToken(voice: PartyVoiceTokenMinter, log: (line: string) => void, input: { partyId: string; actorId: string; puid: string; who: string; why: string }): Promise<void> {
  try {
    await voice.removeFromRoom({ partyId: input.partyId, participantId: input.actorId, puids: [input.puid], mustLeave: true });
    log(`voice join: ${input.why}; the new token is revoked ${input.who}`);
  } catch (error) {
    log(`voice join: ${input.why}; its removal is NOT confirmed (kept pending: tried again before the room's next removal or mint, and by a timer) ${input.who} (${failureTag(error)})`);
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
  if (op.id === 'parties.voice_join') {
    const [partyId = ''] = idsOf(op.template, pathname);
    const lookup = deps.sessionIssuedAt;
    return answerVoiceJoin({
      store, deps, actorId: actor.actorId, sessionId: facts.sessionId,
      // a time that is not a finite number is unknown, never a thrown 500 at toISOString (MAIN's internal review af2eb058, NOTE)
      sessionIssuedAtIso: Number.isFinite(facts.issuedAtMs) ? new Date(facts.issuedAtMs).toISOString() : null,
      sessionIssuedAtOf: lookup === null ? null : (sessionId) => lookup(sessionId, request.now),
      partyId, body, nowIso,
    });
  }
  if (op.id === 'voice.eos_client_config') {
    // THE GAME CLIENT'S EOS CONFIG: to this signed-in player only, never in a log line; no-store, as every social answer.
    const allowed = deps.eosClientConfigAllowed ?? null;
    const config = deps.eosClientConfig ?? null;
    if (allowed === null || config === null || deps.voice === undefined || deps.voice === null || deps.voiceBindings === undefined || deps.voiceBindings === null) {
      return err(503, 'voice_unavailable', 'VOICE TRANSPORT PENDING');
    }
    const admitted = allowed(facts.sessionId, request.now);
    if (!admitted.ok) {
      // with its Retry-After, as every other social 429 (CORE's client contract, 10-07: MISMATCHES.md 8)
      const seconds = Math.max(1, Math.ceil(admitted.retryAfterMs / 1000));
      return { ...err(429, 'rate_limited', `Too many requests for the voice config; try again in ${seconds} s.`), headers: { 'retry-after': String(seconds) } };
    }
    deps.log?.(`eos client config served to ${hashId(actor.actorId)}`);
    const { productId, sandboxId, deploymentId, clientId, clientSecret } = config;
    return ok({ schema: EOS_CLIENT_CONFIG_SCHEMA, productId, sandboxId, deploymentId, clientId, clientSecret });
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
