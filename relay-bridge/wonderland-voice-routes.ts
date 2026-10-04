import {
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
 * TAKE BACK WHAT THE WALL NO LONGER ALLOWS. For each player: the rooms their
 * open issuances name, minus the rooms their current plans give them, are
 * removed on the trusted server and recorded as revoked. Returns what it did;
 * throws nothing a caller could mistake for success.
 */
export async function reconcileWonderlandVoice(ports: WonderlandVoiceRoutePorts, playerIds: readonly string[], at: string): Promise<{
  readonly removed: readonly { readonly playerId: string; readonly roomId: string }[];
  readonly failed: readonly { readonly playerId: string; readonly roomId: string }[];
}> {
  const removed: { playerId: string; roomId: string }[] = [];
  const failed: { playerId: string; roomId: string }[] = [];
  if (ports.identities === null || ports.social === null || ports.voice === null) return { removed, failed };
  for (const playerId of [...new Set(playerIds)].sort()) {
    const open = await ports.identities.openRoomsOf(playerId);
    if (open.length === 0) continue;
    const puid = await ports.identities.productUserIdOf(playerId);
    const state = await ports.social.stateFor({ viewerId: playerId });
    const allowed = new Set<string>();
    for (const kind of ['INSTANCE', 'PARTY'] as const) {
      const channel = channelOf(state, playerId, kind);
      if (channel === null) continue;
      const { plan } = await planFor(ports, channel);
      for (const roomId of plan.joins[playerId] ?? []) allowed.add(roomId);
    }
    for (const roomId of open) {
      if (allowed.has(roomId)) continue;
      try {
        if (puid !== null) await ports.voice.removeParticipant({ roomId, productUserId: puid });
        await ports.identities.recordRevocation({ playerId, roomId, at });
        removed.push({ playerId, roomId });
      } catch {
        failed.push({ playerId, roomId });
      }
    }
  }
  return { removed, failed };
}

/** Who a committed social command can move: the actor, its target, and everyone sharing a channel with either, before or after. */
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
        for (const id of channelOf(state, player, kind)?.candidates ?? []) around.add(id);
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
    const decision = await ports.identities.bind({ playerId: player, productUserId: verified.productUserId, at });
    if (decision.outcome === 'REFUSED') return error(409, 'puid_bound_to_another_player', 'This EOS account is already bound to another Wonderland player.');
    // A re-bind takes the old identity out of every room it held.
    if (decision.outcome === 'REBIND') await reconcileWonderlandVoice(ports, [player], at);
    return { status: 200, body: { data: { productUserId: verified.productUserId, outcome: decision.outcome } }, headers: NO_STORE };
  }

  if (input.path === '/wonderland/voice/join') {
    if (ports.voice === null) return error(503, 'eos_not_configured', 'The trusted voice server is not configured on this backend.');
    const kind = body.channel === 'PARTY' ? 'PARTY' : body.channel === 'INSTANCE' ? 'INSTANCE' : null;
    if (kind === null) return error(400, 'channel_invalid', 'channel is INSTANCE or PARTY.');
    const puid = await ports.identities.productUserIdOf(player);
    if (puid === null) return error(409, 'voice_identity_required', 'Bind your EOS identity first (POST /wonderland/voice/identity).');
    const state = await ports.social.stateFor({ viewerId: player });
    const channel = channelOf(state, player, kind);
    if (channel === null) return error(409, kind === 'INSTANCE' ? 'not_in_instance' : 'not_in_party', `You are not in ${kind === 'INSTANCE' ? 'an instance' : 'a party'}.`);
    const { plan } = await planFor(ports, channel);
    const rooms: { roomId: string; token: string; clientBaseUrl: string }[] = [];
    for (const roomId of plan.joins[player] ?? []) {
      const issued = await ports.voice.roomToken({ roomId, productUserId: puid });
      await ports.identities.recordIssuance({ playerId: player, roomId, at });
      rooms.push({ roomId, token: issued.token, clientBaseUrl: issued.clientBaseUrl });
    }
    // Rooms the player still holds from an earlier plan of this channel are taken back now.
    const reconciled = await reconcileWonderlandVoice(ports, [player], at);
    return {
      status: 200,
      body: { data: { channel: kind, rooms, revoked: reconciled.removed.length, revocationFailures: reconciled.failed.length } },
      headers: NO_STORE,
    };
  }
  return error(404, 'voice_route_not_found', 'No such voice route.');
}
