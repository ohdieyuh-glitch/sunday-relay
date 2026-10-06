import {
  isWonderlandMutuallyVisible,
  planWonderlandVoiceRooms,
  type WonderlandVoiceChannel,
  type WonderlandVoiceIdentityStore,
} from '../src/relay/mission/wonderland-voice';
import {
  wonderlandPartyOf,
  type WonderlandSocialCommand,
  type WonderlandSocialState,
  type WonderlandSocialStore,
} from '../src/relay/mission/wonderland-social';
import type { WonderlandEosClientConfig, WonderlandEosVoicePort } from './wonderland-voice/eos';
import { resolveWonderlandPlayer, type WonderlandSocialRoutePorts } from './wonderland-social-routes';

/**
 * WONDERLAND EOS AND VOICE — `/wonderland/eos/*` and `/wonderland/voice/*`.
 *
 *   GET  /wonderland/eos/client-config   the game client's minimum EOS configuration, at runtime, `no-store`
 *   POST /wonderland/voice/identity      { idToken }: bind the EOS PUID this player PROVES, one PUID per player
 *   POST /wonderland/voice/join          { channel: INSTANCE | PARTY }: tokens for exactly the rooms of this
 *                                        player's plan — nothing a plan does not name is ever issued
 *
 * THE ROOM IS THE WALL (`planWonderlandVoiceRooms`): players share a room only
 * when every pair in it may see one another. A token is the only key to a room,
 * this file is the only place a token is issued, and it issues one only for a
 * room the plan gives the asking player.
 *
 * A TOKEN ALREADY ISSUED IS TAKEN BACK when the wall moves. `reconcileWonderland
 * Voice` compares every OPEN issuance of the affected players with their plans
 * now, and asks the trusted server to remove each membership the plan no longer
 * holds — a block, a hide, a departure. It runs after every committed social
 * command (`afterSocialCommand`), and a failure is reported, never swallowed:
 * the issuance stays open, so the next reconcile retries it.
 *
 * Who is asking: the same resolver, and so the same copy guard, as the social
 * routes. Native clients: the same `allowNative` switch.
 *
 * ONE PLAYER'S VOICE, ONE STEP AT A TIME (review finding, 2026-10-05). A token
 * and its record are two writes on two systems, Epic's room and our issuance,
 * and so are a removal and its revocation. Interleaved for one player, they
 * disagreed:
 *   - a re-issue landing between a removal and its revocation was recorded as
 *     revoked while its token still admitted the player, so no later reconcile
 *     took it out, and a block afterwards left the pair in one room;
 *   - a join that had read the player's identity before a re-bind minted a fresh
 *     token for the former identity after the re-bind had taken it out;
 *   - a join that had planned before a block issued the blocked pair's room
 *     after the block's reconcile had run.
 * So every step that issues, binds or takes back one player's voice runs under
 * that player's lock (`underVoiceLock`): a join, a bind, and each player's
 * reconcile. A step never holds two players' locks, so no two steps can wait on
 * each other. The order is kept in this process, and, when the identity store is
 * one several processes share (PostgreSQL), each step also holds the player's
 * lock in the database (`withPlayerVoiceLock`): two bridge processes on one
 * database, a deploy's overlap or a second replica, take turns as well.
 */

export interface WonderlandVoiceRoutePorts extends Pick<WonderlandSocialRoutePorts, 'sessions' | 'allowNative'> {
  readonly social: WonderlandSocialStore | null;
  readonly identities: WonderlandVoiceIdentityStore | null;
  /** The game client's configuration, or the variables missing to make it. */
  readonly eos: { readonly ok: true; readonly config: WonderlandEosClientConfig } | { readonly ok: false; readonly missing: readonly string[] };
  readonly verifyIdToken: ((token: string) => Promise<{ ok: true; productUserId: string } | { ok: false; reason: string }>) | null;
  readonly voice: WonderlandEosVoicePort | null;
  /** sha256 hex, for opaque room names. */
  readonly digest: (text: string) => string;
}

export interface WonderlandVoiceRouteRequest {
  readonly method: string;
  readonly path: string;
  readonly authorization: string | undefined;
  readonly origin: string | undefined;
  readonly body: unknown;
  readonly now: number;
}

type Result = { readonly status: number; readonly body: unknown; readonly headers?: Readonly<Record<string, string>> };
const error = (status: number, kind: string, message: string): Result => ({ status, body: { error: { kind, message } } });
const NO_STORE = Object.freeze({ 'cache-control': 'no-store', pragma: 'no-cache' });

export const isWonderlandVoiceRoute = (path: string): boolean =>
  path === '/wonderland/eos/client-config' || path.startsWith('/wonderland/voice/');

/** The channel a player is in now: the instance they stand in, or their party. Null when they are in neither. */
function channelOf(state: WonderlandSocialState, playerId: string, kind: 'INSTANCE' | 'PARTY'): Omit<WonderlandVoiceChannel, 'participantIds'> & { readonly candidates: readonly string[] } | null {
  if (kind === 'INSTANCE') {
    const instanceId = state.presence[playerId]?.instanceId;
    if (instanceId === undefined) return null;
    return {
      kind, scopeId: instanceId,
      candidates: Object.values(state.presence).filter((presence) => presence.instanceId === instanceId).map((presence) => presence.playerId),
    };
  }
  const party = wonderlandPartyOf(state, playerId);
  return party === null ? null : { kind, scopeId: party.partyId, candidates: party.memberIds };
}

const voiceLocks = new WeakMap<object, Map<string, Promise<void>>>();

/** Run `step` after every earlier step for this player, whatever their outcome. Queued at the call, before anything is awaited. */
function underVoiceLock<T>(ports: WonderlandVoiceRoutePorts, playerId: string, step: () => Promise<T>): Promise<T> {
  const key: object = ports.identities ?? ports;
  let locks = voiceLocks.get(key);
  if (locks === undefined) {
    locks = new Map();
    voiceLocks.set(key, locks);
  }
  const chain = locks;
  const identities = ports.identities;
  // Read when the step runs, through the store, so a store that wraps another keeps its own `this`.
  const locked = identities?.withPlayerVoiceLock === undefined ? step : () => identities.withPlayerVoiceLock!(playerId, step);
  const run = (chain.get(playerId) ?? Promise.resolve()).then(locked);
  const settled = run.then(() => undefined, () => undefined);
  chain.set(playerId, settled);
  void settled.then(() => { if (chain.get(playerId) === settled) chain.delete(playerId); });
  return run;
}

/** Every voice step already queued, finished, including those a command left for after its answer. For tests and orderly shutdown. */
export async function settleWonderlandVoice(ports: WonderlandVoiceRoutePorts): Promise<void> {
  const locks = voiceLocks.get(ports.identities ?? ports);
  while (locks !== undefined && locks.size > 0) {
    await Promise.all([...locks.values()]);
    await new Promise<void>((resolve) => { setImmediate(resolve); });
  }
}

/** The plan for one channel, among the players who have a proven EOS identity. */
async function planFor(
  ports: WonderlandVoiceRoutePorts,
  channel: Omit<WonderlandVoiceChannel, 'participantIds'> & { readonly candidates: readonly string[] },
): Promise<{ plan: ReturnType<typeof planWonderlandVoiceRooms>; puids: Readonly<Record<string, string>> }> {
  const puids = await ports.identities!.productUserIdsOf(channel.candidates);
  const participantIds = channel.candidates.filter((id) => puids[id] !== undefined);
  const state = await ports.social!.voiceStateFor({ participantIds });
  return { plan: planWonderlandVoiceRooms(state, { kind: channel.kind, scopeId: channel.scopeId, participantIds }, ports.digest), puids };
}

/**
 * TAKE BACK WHAT THE WALL NO LONGER ALLOWS. For each player, an open issuance
 * is removed on the trusted server and recorded as revoked when its room is not
 * in the player's current plans, OR when the identity its token admits is not
 * the one the player is bound to now (a re-bind). The identity removed is the
 * one the token admitted, never the current one: removing the current identity
 * from a room a former one holds removes nobody. Returns what it did; throws
 * nothing a caller could mistake for success.
 */
type Reconciled = {
  readonly removed: { readonly playerId: string; readonly roomId: string }[];
  readonly failed: { readonly playerId: string; readonly roomId: string }[];
};

/** One player's reconcile. The caller holds that player's lock. */
async function reconcileOne(ports: WonderlandVoiceRoutePorts, playerId: string, at: string, into: Reconciled): Promise<void> {
  const identities = ports.identities!;
  const voice = ports.voice!;
  const open = await identities.openIssuancesOf(playerId);
  if (open.length === 0) return;
  const puid = await identities.productUserIdOf(playerId);
  const state = await ports.social!.stateFor({ viewerId: playerId });
  const allowed = new Set<string>();
  for (const kind of ['INSTANCE', 'PARTY'] as const) {
    const channel = channelOf(state, playerId, kind);
    if (channel === null) continue;
    const { plan } = await planFor(ports, channel);
    for (const roomId of plan.joins[playerId] ?? []) allowed.add(roomId);
  }
  for (const { roomId, productUserId } of open) {
    if (allowed.has(roomId) && productUserId === puid) continue;
    try {
      await voice.removeParticipant({ roomId, productUserId });
      await identities.recordRevocation({ playerId, roomId, at });
      into.removed.push({ playerId, roomId });
    } catch {
      into.failed.push({ playerId, roomId });
    }
  }
}

export async function reconcileWonderlandVoice(ports: WonderlandVoiceRoutePorts, playerIds: readonly string[], at: string): Promise<{
  readonly removed: readonly { readonly playerId: string; readonly roomId: string }[];
  readonly failed: readonly { readonly playerId: string; readonly roomId: string }[];
}> {
  const into: Reconciled = { removed: [], failed: [] };
  if (ports.identities === null || ports.social === null || ports.voice === null) return into;
  for (const playerId of [...new Set(playerIds)].sort()) {
    await underVoiceLock(ports, playerId, () => reconcileOne(ports, playerId, at, into));
  }
  return into;
}

/**
 * AFTER A COMMITTED SOCIAL COMMAND. The ACTOR's own rooms are taken back before
 * the answer, and counted on it. Everyone else the command can move is
 * reconciled after the answer, never inside it: their removals are Epic round
 * trips, and an answer that waited for them took longer exactly when the
 * command ended rooms of players the actor cannot see (review finding,
 * 2026-10-05: an owner's answer took twice as long when the removed member's
 * hidden friend was present). Their steps are queued before the answer leaves,
 * so none of them is issued anything until their reconcile has run. A removal
 * that fails there leaves its issuance open, and their next reconcile retries it.
 */
export async function reconcileWonderlandVoiceAfterCommand(
  ports: WonderlandVoiceRoutePorts,
  actorId: string,
  affected: readonly string[],
  at: string,
  onLaterFailure: (failures: number) => void = (failures) => {
    console.warn(`[relay-bridge] wonderland voice: ${String(failures)} removal(s) after a social command failed; each stays open and is retried by its player's next reconcile`);
  },
): Promise<{
  readonly removed: readonly { readonly playerId: string; readonly roomId: string }[];
  readonly failed: readonly { readonly playerId: string; readonly roomId: string }[];
}> {
  const own = await reconcileWonderlandVoice(ports, [actorId], at);
  if (ports.identities === null || ports.social === null || ports.voice === null) return own;
  for (const playerId of [...new Set(affected)].filter((id) => id !== actorId).sort()) {
    const later: Reconciled = { removed: [], failed: [] };
    void underVoiceLock(ports, playerId, () => reconcileOne(ports, playerId, at, later))
      .then(() => { if (later.failed.length > 0) onLaterFailure(later.failed.length); }, () => onLaterFailure(1));
  }
  return own;
}

/**
 * Who a committed social command can move: the actor, its target, and every
 * channel mate of either who could share a room with them, before or after.
 *
 * A command changes only its actor's and its target's settings, relations,
 * presence and memberships, so the only rooms it can end are rooms with one of
 * them in it, and a room exists only between a mutually visible pair. A channel
 * mate who could see neither of them, before or after, holds no room the
 * command can end. Reconciling them would remove nothing, and the work would be
 * the only trace that an invisible player had acted, so they are left out.
 */
export function wonderlandVoiceAffected(before: WonderlandSocialState, after: WonderlandSocialState, actorId: string, command: WonderlandSocialCommand): readonly string[] {
  const record = command as unknown as Record<string, unknown>;
  const touched = new Set<string>([actorId]);
  for (const key of ['toId', 'fromId', 'otherId', 'targetId', 'inviteeId', 'memberId']) {
    if (typeof record[key] === 'string') touched.add(record[key] as string);
  }
  const around = new Set<string>(touched);
  for (const state of [before, after]) {
    for (const player of touched) {
      for (const kind of ['INSTANCE', 'PARTY'] as const) {
        for (const id of channelOf(state, player, kind)?.candidates ?? []) {
          if (isWonderlandMutuallyVisible(before, player, id) || isWonderlandMutuallyVisible(after, player, id)) around.add(id);
        }
      }
    }
  }
  return [...around].sort();
}

export async function handleWonderlandVoiceRoute(input: WonderlandVoiceRouteRequest, ports: WonderlandVoiceRoutePorts): Promise<Result | null> {
  if (!isWonderlandVoiceRoute(input.path)) return null;
  const player = await resolveWonderlandPlayer(input, ports);
  if (typeof player !== 'string') return player;

  if (input.path === '/wonderland/eos/client-config') {
    if (input.method !== 'GET') return error(405, 'method_not_allowed', 'GET only.');
    if (!ports.eos.ok) return error(503, 'eos_not_configured', `EOS is not configured on this backend: ${ports.eos.missing.join(', ')}.`);
    const { productId, sandboxId, deploymentId, clientId, clientSecret } = ports.eos.config;
    return { status: 200, body: { data: { productId, sandboxId, deploymentId, clientId, clientSecret } }, headers: NO_STORE };
  }

  if (input.method !== 'POST') return error(405, 'method_not_allowed', 'POST only.');
  if (ports.social === null || ports.identities === null) return error(503, 'voice_store_unavailable', 'No voice database is configured; nothing was read or written.');
  const body = (input.body ?? {}) as Record<string, unknown>;
  const at = new Date(input.now).toISOString();

  if (input.path === '/wonderland/voice/identity') {
    if (ports.verifyIdToken === null) return error(503, 'eos_not_configured', 'EOS identity cannot be verified on this backend.');
    if (typeof body.idToken !== 'string' || body.idToken.length > 8192) return error(400, 'id_token_required', 'Send the EOS Connect ID token your client obtained.');
    const verified = await ports.verifyIdToken(body.idToken);
    if (!verified.ok) return error(401, 'id_token_refused', `The EOS ID token was refused: ${verified.reason}.`);
    const identities = ports.identities;
    return underVoiceLock(ports, player, async (): Promise<Result> => {
      const decision = await identities.bind({ playerId: player, productUserId: verified.productUserId, at });
      if (decision.outcome === 'REFUSED') return error(409, 'puid_bound_to_another_player', 'This EOS account is already bound to another Wonderland player.');
      // A re-bind takes the old identity out of every room it held, before any join of this player can issue again.
      if (decision.outcome === 'REBIND') await reconcileOne(ports, player, at, { removed: [], failed: [] });
      return { status: 200, body: { data: { productUserId: verified.productUserId, outcome: decision.outcome } }, headers: NO_STORE };
    });
  }

  if (input.path === '/wonderland/voice/join') {
    if (ports.voice === null) return error(503, 'eos_not_configured', 'The trusted voice server is not configured on this backend.');
    const kind = body.channel === 'PARTY' ? 'PARTY' : body.channel === 'INSTANCE' ? 'INSTANCE' : null;
    if (kind === null) return error(400, 'channel_invalid', 'channel is INSTANCE or PARTY.');
    const identities = ports.identities;
    const social = ports.social;
    const voice = ports.voice;
    // The identity, the plan, what is taken back and what is issued are one step for this player: nothing of theirs moves in between.
    return underVoiceLock(ports, player, async (): Promise<Result> => {
      const puid = await identities.productUserIdOf(player);
      if (puid === null) return error(409, 'voice_identity_required', 'Bind your EOS identity first (POST /wonderland/voice/identity).');
      const state = await social.stateFor({ viewerId: player });
      const channel = channelOf(state, player, kind);
      if (channel === null) return error(409, kind === 'INSTANCE' ? 'not_in_instance' : 'not_in_party', `You are not in ${kind === 'INSTANCE' ? 'an instance' : 'a party'}.`);
      const { plan } = await planFor(ports, channel);
      // First, what the player still holds from an earlier plan, or as a former identity, is taken back.
      const reconciled: Reconciled = { removed: [], failed: [] };
      await reconcileOne(ports, player, at, reconciled);
      // A room a former identity still holds (its removal failed) is not issued again until that identity is out.
      const heldByAnother = new Set((await identities.openIssuancesOf(player))
        .filter((row) => row.productUserId !== puid).map((row) => row.roomId));
      const rooms: { roomId: string; token: string; clientBaseUrl: string }[] = [];
      for (const roomId of plan.joins[player] ?? []) {
        if (heldByAnother.has(roomId)) continue;
        // Recorded BEFORE the token exists, so every token Epic issues is on the record the reconciler reads.
        await identities.recordIssuance({ playerId: player, roomId, productUserId: puid, at });
        const issued = await voice.roomToken({ roomId, productUserId: puid });
        rooms.push({ roomId, token: issued.token, clientBaseUrl: issued.clientBaseUrl });
      }
      return {
        status: 200,
        body: { data: { channel: kind, rooms, revoked: reconciled.removed.length, revocationFailures: reconciled.failed.length } },
        headers: NO_STORE,
      };
    });
  }
  return error(404, 'voice_route_not_found', 'No such voice route.');
}
