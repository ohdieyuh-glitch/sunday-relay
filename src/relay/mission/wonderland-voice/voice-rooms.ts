import { isWonderlandVisibleTo, type WonderlandSocialState } from '../wonderland-social';

/**
 * WONDERLAND VOICE — WHO SHARES A ROOM, decided so the room ITSELF keeps the privacy wall.
 *
 * WHY ROOMS AND NOT MUTES. EOS voice has no server-side, per-listener mute: a
 * hard mute silences a participant for the whole room, and per-listener
 * muting (`UpdateReceiving`) is something a CLIENT does, which a modified client
 * simply does not. Worse for privacy, every member of an EOS room is told who
 * else is in it. So a room is a disclosure: everybody in it learns everybody
 * else is there. The only enforcement a trusted server has is WHICH ROOMS EACH
 * PLAYER HOLDS A TOKEN FOR.
 *
 * THEREFORE THE RULE, in rooms:
 *   (a) every room is a set of players who may ALL see one another — mutual
 *       visibility for every pair (a clique of the mutual-visibility graph);
 *   (b) every mutually visible pair shares EXACTLY one room — they hear each
 *       other, and once, never doubled;
 *   (c) a pair that is not mutually visible shares NO room — a blocked pair
 *       never, a hidden player and a stranger never.
 * (c) has a consequence the wall requires: a player hidden from strangers can
 * neither be heard by them NOR hear them, because hearing them would put the
 * hidden player in a room the strangers can see.
 *
 * THE COMMON CASE IS ONE ROOM. When everyone in a channel may see everyone
 * (no hidden player among strangers, no block), the partition is the whole
 * channel in a single room. Rooms multiply only where the wall requires them.
 *
 * ROOM NAMES ARE OPAQUE AND DETERMINISTIC: a digest of the channel and the
 * room's members, so every player's plan names the same rooms without a
 * coordinator, and a room name says nothing about who is in it. The digest is
 * injected (`digest`) because the domain has no crypto; the bridge passes
 * sha256.
 *
 * Pure: no clock, no store, no Node.
 */

export const WONDERLAND_VOICE_CHANNEL_KINDS = ['INSTANCE', 'PARTY'] as const;
export type WonderlandVoiceChannelKind = (typeof WONDERLAND_VOICE_CHANNEL_KINDS)[number];

export interface WonderlandVoiceChannel {
  readonly kind: WonderlandVoiceChannelKind;
  /** The instance id or the party id the channel belongs to. */
  readonly scopeId: string;
  /** Who is in the channel: present in the instance, or members of the party. */
  readonly participantIds: readonly string[];
}

export interface WonderlandVoiceRoom {
  readonly roomId: string;
  /** Sorted. Every pair of them is mutually visible. */
  readonly memberIds: readonly string[];
}

export interface WonderlandVoicePlan {
  readonly channel: { readonly kind: WonderlandVoiceChannelKind; readonly scopeId: string };
  readonly rooms: readonly WonderlandVoiceRoom[];
  /** Per participant, the rooms they hold a token for. A participant with none hears and is heard by nobody. */
  readonly joins: Readonly<Record<string, readonly string[]>>;
}

/** Mutual visibility: each may see the other. The only relation a shared room can carry. */
export const isWonderlandMutuallyVisible = (state: WonderlandSocialState, a: string, b: string): boolean =>
  a !== b && isWonderlandVisibleTo(state, a, b) && isWonderlandVisibleTo(state, b, a);

const pairKey = (a: string, b: string): string => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);

/**
 * PLAN THE ROOMS: a deterministic edge clique PARTITION of the channel's
 * mutual-visibility graph. Greedy, in player-id order: take the first edge no
 * room covers yet, and grow it with every player (in order) who is mutually
 * visible to all of the room's members AND shares no covered edge with any of
 * them, so no pair can end up in two rooms.
 */
export function planWonderlandVoiceRooms(
  state: WonderlandSocialState,
  channel: WonderlandVoiceChannel,
  digest: (text: string) => string,
): WonderlandVoicePlan {
  const players = [...new Set(channel.participantIds)].sort();
  const covered = new Set<string>();
  const rooms: WonderlandVoiceRoom[] = [];
  for (let i = 0; i < players.length; i += 1) {
    for (let j = i + 1; j < players.length; j += 1) {
      const a = players[i]!;
      const b = players[j]!;
      if (covered.has(pairKey(a, b)) || !isWonderlandMutuallyVisible(state, a, b)) continue;
      const members = [a, b];
      for (const candidate of players) {
        if (members.includes(candidate)) continue;
        if (members.every((member) => isWonderlandMutuallyVisible(state, member, candidate) && !covered.has(pairKey(member, candidate)))) {
          members.push(candidate);
        }
      }
      for (let x = 0; x < members.length; x += 1) {
        for (let y = x + 1; y < members.length; y += 1) covered.add(pairKey(members[x]!, members[y]!));
      }
      const memberIds = [...members].sort();
      rooms.push(Object.freeze({
        roomId: `wl_${digest(`${channel.kind}\u0000${channel.scopeId}\u0000${memberIds.join('\u0000')}`).slice(0, 32)}`,
        memberIds: Object.freeze(memberIds),
      }));
    }
  }
  const joins: Record<string, string[]> = Object.fromEntries(players.map((player) => [player, []]));
  for (const room of rooms) for (const member of room.memberIds) joins[member]!.push(room.roomId);
  return Object.freeze({
    channel: Object.freeze({ kind: channel.kind, scopeId: channel.scopeId }),
    rooms: Object.freeze(rooms),
    joins: Object.freeze(Object.fromEntries(Object.entries(joins).map(([player, ids]) => [player, Object.freeze([...ids].sort())]))),
  });
}

/**
 * WHAT A PLAN CHANGE MUST UNDO ON THE TRUSTED SERVER. A token already issued
 * stays valid until the server removes the participant, so when a block, a
 * hide or a departure changes the plan, every (room, player) membership that
 * the new plan does not hold is a removal the server must make — before any
 * client is trusted to leave on its own.
 */
export function diffWonderlandVoicePlans(previous: WonderlandVoicePlan, next: WonderlandVoicePlan): {
  readonly removals: readonly { readonly roomId: string; readonly playerId: string }[];
  readonly additions: readonly { readonly roomId: string; readonly playerId: string }[];
} {
  const memberships = (plan: WonderlandVoicePlan): Set<string> =>
    new Set(plan.rooms.flatMap((room) => room.memberIds.map((member) => `${room.roomId}\u0000${member}`)));
  const before = memberships(previous);
  const after = memberships(next);
  const split = (key: string) => { const [roomId, playerId] = key.split('\u0000') as [string, string]; return Object.freeze({ roomId, playerId }); };
  return Object.freeze({
    removals: Object.freeze([...before].filter((key) => !after.has(key)).sort().map(split)),
    additions: Object.freeze([...after].filter((key) => !before.has(key)).sort().map(split)),
  });
}
