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
 *   (d) what a player's rooms are, and who is in them, never depends on anyone
 *       that player cannot see (P1, no inference).
 * (c) has a consequence the wall requires: a player hidden from strangers can
 * neither be heard by them NOR hear them, because hearing them would put the
 * hidden player in a room the strangers can see.
 *
 * (d) IS WHY EVERY ROOM IS A PAIR. A room of three or more is a choice about
 * which pair it covers, and that choice can always be forced by somebody one of
 * its members cannot see. Two players who cannot see each other (a block), both
 * seen by a and c: with only one of them present, the natural room for a, c and
 * that one is a single room; with both present the pair a–c can be in only one
 * room, so one of the two players' rooms must change with the arrival of
 * someone they cannot see. A first greedy partition did exactly that: a hidden
 * player's arrival split a stranger's room, the reconcile kicked the stranger
 * from voice, and his client showed two rooms where there had been one (found by
 * an adversarial review, 2026-10-05). A pair room depends on nothing but the
 * pair: a player's rooms are exactly one per channel mate they can mutually
 * see, whoever else is present. So does a block: it ends exactly one room.
 *
 * THE COST is rooms: a player holds one per mutually visible channel mate (a
 * full party of four, three each). How many rooms an EOS client may hold, and
 * so how large a voice channel can be, is the client's question (CORE); the
 * wall does not bend to it.
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

/**
 * PLAN THE ROOMS: one room for every mutually visible pair in the channel, and
 * no other. Each room is the pair alone, so every invariant above holds by
 * construction, (d) included: nothing about a pair's room depends on anyone else.
 */
export function planWonderlandVoiceRooms(
  state: WonderlandSocialState,
  channel: WonderlandVoiceChannel,
  digest: (text: string) => string,
): WonderlandVoicePlan {
  const players = [...new Set(channel.participantIds)].sort();
  const rooms: WonderlandVoiceRoom[] = [];
  for (let i = 0; i < players.length; i += 1) {
    for (let j = i + 1; j < players.length; j += 1) {
      const a = players[i]!;
      const b = players[j]!;
      if (!isWonderlandMutuallyVisible(state, a, b)) continue;
      rooms.push(Object.freeze({
        roomId: `wl_${digest(`${channel.kind}\u0000${channel.scopeId}\u0000${a}\u0000${b}`).slice(0, 32)}`,
        memberIds: Object.freeze([a, b]),
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
