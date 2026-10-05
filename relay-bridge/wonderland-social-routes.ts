import type { BrowserSessionStore } from './browser-session/grants';
import { sessionTokenFrom } from './browser-session/routes';
import {
  WONDERLAND_ACTIVITIES,
  isWonderlandEntityId,
  isWonderlandInstanceId,
  isWonderlandPlayerId,
  projectWonderlandConversation,
  projectWonderlandFriends,
  projectWonderlandInbox,
  projectWonderlandInstanceListing,
  projectWonderlandParty,
  projectWonderlandPresenceOf,
  projectWonderlandRecentPlayers,
  projectWonderlandRoster,
  projectWonderlandServer,
  projectWonderlandServers,
  wonderlandVisibilityOf,
  type WonderlandSocialCommand,
  type WonderlandSocialState,
  type WonderlandSocialStore,
} from '../src/relay/mission/wonderland-social';
import type { WonderlandCommandLimiter } from './wonderland-social-rate-limit';

/**
 * THE HOSTED SOCIAL API — `/wonderland/social/*`.
 *
 *   POST /wonderland/social/commands              one command, as the session's player: { commandId, command }
 *   GET  /wonderland/social/me                    settings, friends, requests, party, servers, inbox, Recent Players
 *   GET  /wonderland/social/roster                who the player sees in the instance they stand in
 *   GET  /wonderland/social/instances?ids=a,b     the instance browser (counts of who the player may see)
 *   GET  /wonderland/social/presence/:playerId    a friend's or party-mate's whereabouts; UNAVAILABLE otherwise
 *   GET  /wonderland/social/conversations/:id     one conversation (hidden from both while a block exists)
 *   GET  /wonderland/social/servers/:serverId     a private server, as one of its members sees it
 *
 * WHO IS ASKING comes from the session, never the body: a player session
 * (`browser_control`, minted by sign-in) names the player. The operator token is
 * not a player and is refused. A read-only browser session is not a player and
 * is refused.
 *
 * THE NATIVE CLIENT. A `native_world` session (the paired desktop client) is
 * refused here unless the composition passes `allowNative: true`. The native
 * scope was confined to the Julius world stream by founder decision
 * (2026-09-27); the final RC needs social from the native client, and widening
 * the scope is a decision for SECOND Wonderland and the founder, made once, on
 * purpose — not a default this file grants. The code path exists and is tested
 * so the decision costs one line.
 *
 * EVERY RESPONSE IS A PROJECTION from `wonderland-social-privacy.ts`, computed
 * over the store's slice for this viewer. Nothing in this file decides who may
 * see whom; a route that did would be a second privacy wall that drifts.
 */

export interface WonderlandSocialRouteRequest {
  readonly method: string;
  readonly path: string;
  readonly url: string;
  readonly authorization: string | undefined;
  readonly origin: string | undefined;
  readonly body: unknown;
  readonly now: number;
}

export interface WonderlandSocialRoutePorts {
  /** Null when no database is configured: every route answers 503, nothing is pretended. */
  readonly store: WonderlandSocialStore | null;
  readonly sessions: Pick<BrowserSessionStore, 'verifySession' | 'verifyNativeSession'>;
  /** Whether a paired native client may use social. Off unless a reviewed decision turns it on. */
  readonly allowNative: boolean;
  /**
   * Per-player command budgets (`wonderland-social-rate-limit.ts`). Absent, nothing is limited. A refused command
   * is answered 429 and is not executed; a replay of one already executed answers its record once the budget allows.
   */
  readonly limiter?: WonderlandCommandLimiter;
  /** The account's display name for a player, server-side. Null renders Unknown. */
  readonly displayNameFor?: (playerId: string) => Promise<string | null>;
  /**
   * After a command CHANGED something: what else must follow the wall (voice
   * room memberships taken back on the trusted server). Its result is reported
   * on the response, never swallowed; absent, nothing else runs.
   */
  readonly afterCommand?: (input: {
    readonly actorId: string;
    readonly command: WonderlandSocialCommand;
    readonly before: WonderlandSocialState;
    readonly after: WonderlandSocialState;
    readonly at: string;
  }) => Promise<{
    readonly removed: readonly { readonly playerId: string }[];
    /** A failure with no player is the reconcile itself failing, so nobody's voice state is known. */
    readonly failed: readonly { readonly playerId?: string }[];
  }>;
}

export const WONDERLAND_SOCIAL_PREFIX = '/wonderland/social/';
export const isWonderlandSocialRoute = (path: string): boolean => path.startsWith(WONDERLAND_SOCIAL_PREFIX);

type Result = { readonly status: number; readonly body: unknown; readonly headers?: Readonly<Record<string, string>> };
const error = (status: number, kind: string, message: string): Result => ({ status, body: { error: { kind, message } } });

const KEYS: Readonly<Record<WonderlandSocialCommand['kind'], readonly string[]>> = {
  SET_SETTINGS: ['settings'],
  FRIEND_REQUEST: ['toId'], FRIEND_ACCEPT: ['fromId'], FRIEND_DECLINE: ['fromId'], FRIEND_REMOVE: ['otherId'],
  BLOCK: ['targetId'], UNBLOCK: ['targetId'],
  PARTY_CREATE: ['partyId'], PARTY_INVITE: ['inviteeId'], PARTY_JOIN: ['partyId'], PARTY_LEAVE: [], PARTY_KICK: ['memberId'],
  SERVER_CREATE: ['serverId', 'name'], SERVER_INVITE: ['serverId', 'inviteeId'], SERVER_JOIN: ['serverId'],
  SERVER_LEAVE: ['serverId'], SERVER_REMOVE_MEMBER: ['serverId', 'memberId'],
  ENTER_INSTANCE: ['instanceId', 'location', 'activity', 'dogId'], UPDATE_PRESENCE: ['location', 'activity'], LEAVE_INSTANCE: [],
  SEND_MESSAGE: ['messageId', 'toId', 'body'],
};

/**
 * THE WIRE SHAPE OF A COMMAND. Exactly the keys its kind has: an extra key is
 * refused rather than ignored, so a client can never believe it set something
 * this backend does not have (the P3 lesson, applied to every command).
 */
export function parseWonderlandSocialCommand(value: unknown): WonderlandSocialCommand | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const kind = record.kind;
  if (typeof kind !== 'string' || !Object.prototype.hasOwnProperty.call(KEYS, kind)) return null;
  const allowed = new Set(['kind', ...KEYS[kind as WonderlandSocialCommand['kind']]]);
  if (Object.keys(record).some((key) => !allowed.has(key))) return null;
  for (const key of KEYS[kind as WonderlandSocialCommand['kind']]) {
    if (!(key in record)) return null;
  }
  return record as unknown as WonderlandSocialCommand;
}

/**
 * WHO IS ASKING, with the copy guard applied.
 *
 * `verifySession` skips the origin check for a request with no Origin header,
 * because a native client sends none — so a BROWSER token copied into some
 * other client would pass it. For a privacy API that is not acceptable, so:
 *   - no Origin: only a NATIVE credential is considered (`verifyNativeSession`,
 *     which refuses a browser token however valid), and only when native social
 *     is enabled;
 *   - an Origin: only a browser PLAYER session bound to that origin is accepted;
 *     a native credential presented from a web origin is refused.
 */
export async function resolveWonderlandPlayer(
  input: Pick<WonderlandSocialRouteRequest, 'authorization' | 'origin' | 'now'>,
  ports: Pick<WonderlandSocialRoutePorts, 'sessions' | 'allowNative'>,
): Promise<string | { readonly status: number; readonly body: unknown }> {
  const token = sessionTokenFrom(input.authorization);
  if (token === null) return error(401, 'player_session_required', 'A signed-in player session is required.');
  if (input.origin === undefined) {
    if (!ports.allowNative) return error(403, 'native_social_not_enabled', 'A native Wonderland session does not reach social yet; that scope is a reviewed decision.');
    const native = ports.sessions.verifyNativeSession({ token, now: input.now });
    return native.ok && isWonderlandPlayerId(native.participantId)
      ? native.participantId
      : error(401, 'player_session_required', 'A paired native session is required.');
  }
  const verified = ports.sessions.verifySession({ token, origin: input.origin, now: input.now });
  if (!verified.ok) return error(401, 'player_session_required', 'A signed-in player session is required.');
  if (verified.scope === 'browser_control' && verified.participantId !== null && isWonderlandPlayerId(verified.participantId)) {
    return verified.participantId;
  }
  return error(403, 'player_session_required', 'This session does not act as a player here.');
}

const REFUSAL_STATUS: Readonly<Record<string, number>> = { INVALID: 400, SELF: 400 };

export async function handleWonderlandSocialRoute(
  input: WonderlandSocialRouteRequest,
  ports: WonderlandSocialRoutePorts,
): Promise<Result | null> {
  if (!isWonderlandSocialRoute(input.path)) return null;
  if (ports.store === null) return error(503, 'social_store_unavailable', 'No social database is configured; nothing was read or written.');
  const player = await resolveWonderlandPlayer(input, ports);
  if (typeof player !== 'string') return player;
  const store = ports.store;
  // A signed-in player EXISTS socially from their first request: others can find them, befriend them and block them.
  // The name is the account's: recorded at sign-in from the verified identity (`onIdentityVerified`), or supplied
  // here by a composition that has an authoritative source. A request that knows no name never erases one.
  if (ports.displayNameFor === undefined) await store.ensureProfile(player);
  else await store.upsertProfile({ playerId: player, displayName: await ports.displayNameFor(player) });
  // Every read is the world as it is at this request: presence that has expired by now is not presence.
  const now = new Date(input.now).toISOString();
  const tail = input.path.slice(WONDERLAND_SOCIAL_PREFIX.length);
  const segment = (prefix: string): string | null => {
    if (!tail.startsWith(prefix)) return null;
    let rest: string;
    try { rest = decodeURIComponent(tail.slice(prefix.length)); } catch { return null; }
    return rest.includes('/') || rest === '' ? null : rest;
  };

  if (input.method === 'POST' && tail === 'commands') {
    const body = input.body as { commandId?: unknown; command?: unknown } | undefined;
    if (!isWonderlandEntityId(body?.commandId)) return error(400, 'command_id_required', 'Every social write carries a commandId.');
    const command = parseWonderlandSocialCommand(body?.command);
    if (command === null) return error(400, 'command_invalid', 'The command is not one this backend has, or carries a field it does not have.');
    const budget = ports.limiter?.take(player, command.kind, input.now);
    if (budget !== undefined && !budget.allowed) {
      return {
        status: 429,
        body: {
          error: {
            kind: 'rate_limited',
            message: `Too many social commands (${budget.bucket}): this command was not executed. Retry in ${String(budget.retryAfterSeconds)} s.`,
            bucket: budget.bucket,
            retryAfterSeconds: budget.retryAfterSeconds,
          },
        },
        headers: { 'retry-after': String(budget.retryAfterSeconds) },
      };
    }
    const at = new Date(input.now).toISOString();
    const before = ports.afterCommand === undefined ? null : await store.stateFor({ viewerId: player, now });
    const outcome = await store.execute({ actorId: player, commandId: body!.commandId as string, command, at });
    if (!outcome.ok) return { status: REFUSAL_STATUS[outcome.code] ?? 409, body: { data: outcome } };
    if (outcome.code !== 'DONE' || ports.afterCommand === undefined || before === null) return { status: 200, body: { data: outcome } };
    // The write is committed; what follows it is reported, and a failure here never reads as success.
    const followed = await ports.afterCommand({ actorId: player, command, before, after: await store.stateFor({ viewerId: player, now }), at })
      .catch(() => ({ removed: [], failed: [{}] }));
    // Only the ACTOR's own memberships are counted. The reconcile also moves channel mates the actor may not be able
    // to see (a hidden player, someone they blocked or who blocked them), and a count over them would tell the actor
    // that someone is there (P1, no inference). Theirs are retried by their own next reconcile.
    const own = (row: { readonly playerId?: string }): boolean => row.playerId === undefined || row.playerId === player;
    return {
      status: 200,
      body: { data: outcome, voice: { revoked: followed.removed.filter(own).length, revocationFailures: followed.failed.filter(own).length } },
    };
  }
  if (input.method !== 'GET') return error(405, 'method_not_allowed', 'Social reads are GET; writes are POST /wonderland/social/commands.');

  if (tail === 'me') {
    const state = await store.stateFor({ viewerId: player, now });
    return {
      status: 200,
      body: {
        data: {
          playerId: player,
          settings: { visibility: wonderlandVisibilityOf(state, player) },
          activities: WONDERLAND_ACTIVITIES,
          ...projectWonderlandFriends(state, player),
          party: projectWonderlandParty(state, player),
          ...projectWonderlandServers(state, player),
          inbox: projectWonderlandInbox(state, player),
          recentPlayers: projectWonderlandRecentPlayers(state, player),
        },
      },
    };
  }
  if (tail === 'roster') {
    const state = await store.stateFor({ viewerId: player, now });
    const instanceId = state.presence[player]?.instanceId;
    return { status: 200, body: { data: instanceId === undefined ? { available: false } : projectWonderlandRoster(state, player, instanceId) } };
  }
  if (tail.startsWith('instances')) {
    const requested = (new URL(input.url, 'http://relay.invalid').searchParams.get('ids') ?? '')
      .split(',').map((id) => id.trim()).filter(isWonderlandInstanceId).slice(0, 50);
    const state = await store.stateFor({ viewerId: player, publicInstanceIds: requested, now });
    return { status: 200, body: { data: projectWonderlandInstanceListing(state, player, requested) } };
  }
  const presenceOf = segment('presence/');
  if (presenceOf !== null) {
    const state = await store.stateFor({ viewerId: player, now });
    return { status: 200, body: { data: projectWonderlandPresenceOf(state, player, presenceOf) } };
  }
  const conversationWith = segment('conversations/');
  if (conversationWith !== null) {
    const state = await store.stateFor({ viewerId: player, now });
    return { status: 200, body: { data: projectWonderlandConversation(state, player, conversationWith) } };
  }
  const serverId = segment('servers/');
  if (serverId !== null) {
    const state = await store.stateFor({ viewerId: player, now });
    return { status: 200, body: { data: projectWonderlandServer(state, player, serverId) } };
  }
  return error(404, 'social_route_not_found', 'No such social route.');
}
