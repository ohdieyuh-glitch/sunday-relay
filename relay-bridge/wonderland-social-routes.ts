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
 * HOW A SESSION GETS HERE (R16). The desktop client signs its player in by GitHub's device flow
 * (wonderland-native-signin-routes.ts) and holds a `native_social` session carrying `social`; server.ts serves these routes
 * only when the deployment sets WONDERLAND_SOCIAL_ENABLED=1.
 *
 * PARTY VOICE. `POST /parties/:id/voice/join {eosProductUserId}` asks the configured provider's minter for a token to the
 * caller's OWN party room, for the voice audience only (voiceAudienceFor: the members minus anyone blocked either way), for the
 * caller's server-bound EOS PUID (src/relay/social/voice-binding.ts). A non-member, a walled caller, and another player's PUID all
 * answer the stranger's 404; the answer's audience lists only server-bound PUID -> player pairs. With no provider (or no binding
 * store) it is 503 VOICE TRANSPORT PENDING: a connected voice state is never fabricated.
 *
 * THE GAME CLIENT'S EOS CONFIG. `GET /voice/eos-client-config` answers the five values the desktop client's EOS platform starts
 * with -- the GAME client's (founder, 10-04: handed out by the backend, held in the client's memory only, never in the package),
 * never the Trusted Server's -- as {schema: wonderland-eos-client-config.v1, productId, sandboxId, deploymentId, clientId,
 * clientSecret}, after the same five gates as every operation. At most 6 a minute per session
 * (429). Without the bridge's game config, its voice provider or its rate limit: 503. The log says only whom it served,
 * hashed; never a value.
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
import { voiceAudienceFor } from '../src/relay/social/social-parties';
import { normalizePuid, type VoiceBindingStore } from '../src/relay/social/voice-binding';
import { bindSocialActor, nativeSocialMayCall, SOCIAL_OPERATIONS } from './wonderland-social-scope';
import { EOS_CLIENT_CONFIG_SCHEMA, hashId, type EosGameClientConfig } from './eos-voice';

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

/** What a voice provider hands one member for their party's room. Its token is the member's own, for that room only. */
export interface PartyVoiceGrant {
  readonly providerId: string;
  readonly roomId: string;
  readonly participantToken: string;
  readonly expiresAtIso: string;
}

/**
 * THE PROVIDER SEAM. A real provider (EOS Voice, LiveKit, Vivox ...) implements this; it must admit the caller to the room
 * ONLY as one of `audience`, and never anyone else on their behalf. Absent: party voice is honestly unavailable.
 */
export interface PartyVoiceTokenMinter {
  readonly providerId: string;
  /** `puid`: the caller's server-bound EOS ProductUserId (EOS voice admits exactly that PUID to the room). */
  mint(input: { readonly partyId: string; readonly participantId: string; readonly audience: readonly string[]; readonly nowIso: string; readonly puid?: string }): Promise<PartyVoiceGrant>;
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
  /** The party voice provider's token minter. Absent or null: voice is 503 VOICE TRANSPORT PENDING. */
  readonly voice?: PartyVoiceTokenMinter | null;
  /** Who holds which EOS PUID (migration 035). Required with a minter; absent: voice is 503. */
  readonly voiceBindings?: VoiceBindingStore | null;
  /** The GAME client's EOS config, read once at start (eos-voice.ts loadEosGameClientConfig). Absent or null: the route is 503. */
  readonly eosClientConfig?: EosGameClientConfig | null;
  /** Whether this session may have the EOS client config now (createSessionRateLimit). Built ONCE by the bridge -- deps are
   *  per request. Absent or null: the route is 503 (it never serves unlimited). */
  readonly eosClientConfigAllowed?: ((sessionId: string, now: number) => boolean) | null;
  /** The bridge's log. The EOS client config route says only whom it served, hashed. */
  readonly log?: ((line: string) => void) | null;
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

/** The EOS client config's rate: a client fetches it once per sign-in. */
export const EOS_CLIENT_CONFIG_RATE = Object.freeze({ limit: 6, windowMs: 60_000 });

/** Never stored by anything between the bridge and the client: on every social answer. */
const NO_STORE: Readonly<Record<string, string>> = Object.freeze({ 'cache-control': 'no-store', pragma: 'no-cache' });

/**
 * At most `limit` calls per session in any `windowMs`; a refused call is not counted. The state lives in the closure, so the
 * bridge builds ONE and passes it with every request's deps. Sessions idle for a whole window are forgotten.
 */
export function createSessionRateLimit(limit: number, windowMs: number): (sessionId: string, now: number) => boolean {
  const seen = new Map<string, number[]>();
  return (sessionId, now) => {
    if (seen.size > 10_000) for (const [id, times] of seen) if (times.every((t) => t <= now - windowMs)) seen.delete(id);
    const recent = (seen.get(sessionId) ?? []).filter((t) => t > now - windowMs);
    if (recent.length >= limit) {
      seen.set(sessionId, recent);
      return false;
    }
    seen.set(sessionId, [...recent, now]);
    return true;
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

  const query = parseQuery(search);
  if (op.id === 'events.stream') {
    const after = Number.parseInt(query.after ?? '0', 10);
    const limit = Number.parseInt(query.limit ?? '100', 10);
    const page = await store.eventsFor(actor.actorId, Number.isFinite(after) && after > 0 ? after : 0, Number.isFinite(limit) && limit > 0 ? limit : 100);
    deps.tap?.({ at: nowIso, recipient: actor.actorId, kind: 'events', seqs: page.events.map((e) => e.seq), ops: page.events.map((e) => e.op), userIds: [] });
    return ok(page);
  }
  if (op.id === 'parties.voice_join') {
    const [partyId] = idsOf(op.template, pathname);
    // The audience is the WALLED one: a non-member gets none at all, and a member never gets anyone blocked either way.
    // Every refusal that concerns WHO the caller is answers exactly as a party that does not exist (the uniform stranger 404).
    const notThere = () => err(404, 'not-found', 'party not found');
    const audience = voiceAudienceFor(await store.read(), actor.actorId, partyId ?? '');
    if (audience.length === 0) return notThere();
    if (deps.voice === undefined || deps.voice === null || deps.voiceBindings === undefined || deps.voiceBindings === null) {
      return err(503, 'voice_unavailable', 'VOICE TRANSPORT PENDING');
    }
    // THE CALLER'S EOS PUID, bound to them server-side (review #2): another player's PUID, or a different one of their own
    // within the session that bound the first, is refused -- as a stranger is.
    const puid = normalizePuid(body.eosProductUserId);
    if (puid === null) return err(400, 'validation-failed', 'eosProductUserId must be an EOS ProductUserId (32 hex characters)');
    let binding: string;
    try {
      binding = await deps.voiceBindings.bind({ userId: actor.actorId, puid, sessionId: facts.sessionId, nowIso });
    } catch {
      return err(503, 'voice_unavailable', 'The voice provider could not admit you right now.');
    }
    if (binding === 'refused') return notThere();
    let grant: PartyVoiceGrant;
    let bound: ReadonlyMap<string, string>;
    try {
      grant = await deps.voice.mint({ partyId: partyId ?? '', participantId: actor.actorId, audience, nowIso, puid });
      bound = await deps.voiceBindings.puidsOf(audience);
    } catch {
      return err(503, 'voice_unavailable', 'The voice provider could not admit you right now.');
    }
    // the audience a client maps voices with: ONLY server-bound PUID -> player pairs, only of the walled audience
    const pairs = audience.filter((id) => bound.has(id)).map((id) => ({ userId: id, puid: bound.get(id) as string }));
    return ok({ providerId: grant.providerId, roomId: grant.roomId, participantToken: grant.participantToken, expiresAt: grant.expiresAtIso, audience: pairs });
  }
  if (op.id === 'voice.eos_client_config') {
    // THE GAME CLIENT'S EOS CONFIG: to this signed-in player only, never in a log line; no-store, as every social answer.
    const allowed = deps.eosClientConfigAllowed ?? null;
    const config = deps.eosClientConfig ?? null;
    if (allowed === null || config === null || deps.voice === undefined || deps.voice === null || deps.voiceBindings === undefined || deps.voiceBindings === null) {
      return err(503, 'voice_unavailable', 'VOICE TRANSPORT PENDING');
    }
    if (!allowed(facts.sessionId, request.now)) return err(429, 'rate_limited', 'Too many requests for the voice config; try again in a minute.');
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
