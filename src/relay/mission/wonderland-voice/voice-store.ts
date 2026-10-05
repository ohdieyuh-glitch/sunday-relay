import { decideWonderlandVoiceBinding, WONDERLAND_EOS_PUID, type WonderlandVoiceBindingDecision } from './eos-claims';

/**
 * WHERE A PLAYER'S PROVEN EOS IDENTITY LIVES, and the record of every voice
 * token issued — never the token itself.
 *
 * `bind` applies `decideWonderlandVoiceBinding` atomically: the PostgreSQL store
 * (migration 035) holds UNIQUE(product_user_id), so two players racing for one
 * PUID cannot both win, whatever the decision said before the write.
 */
export interface WonderlandVoiceIdentityStore {
  bind(input: { readonly playerId: string; readonly productUserId: string; readonly at: string }): Promise<WonderlandVoiceBindingDecision>;
  productUserIdOf(playerId: string): Promise<string | null>;
  productUserIdsOf(playerIds: readonly string[]): Promise<Readonly<Record<string, string>>>;
  /**
   * Audit: which player was given a token for which room, as which EOS identity, and when. The token is never stored.
   * The identity is the one the token ADMITS, so a removal takes out that identity whatever the player is bound to
   * by then. Refuses (throws `wonderland_voice_issuance_held`) to re-issue a room still held open by another identity.
   */
  recordIssuance(input: { readonly playerId: string; readonly roomId: string; readonly productUserId: string; readonly at: string }): Promise<void>;
  /** The rooms a player was given a token for and that the trusted server has not taken back. */
  openRoomsOf(playerId: string): Promise<readonly string[]>;
  /** The same, with the identity each token admitted. */
  openIssuancesOf(playerId: string): Promise<readonly WonderlandVoiceIssuance[]>;
  /** The trusted server removed the player from the room: the token no longer admits them. */
  recordRevocation(input: { readonly playerId: string; readonly roomId: string; readonly at: string }): Promise<void>;
}

/** An open token: the room, and the EOS identity it admits. */
export interface WonderlandVoiceIssuance {
  readonly roomId: string;
  readonly productUserId: string;
}

export function createMemoryWonderlandVoiceIdentityStore(): WonderlandVoiceIdentityStore & {
  issuances(): readonly { readonly playerId: string; readonly roomId: string; readonly productUserId: string; readonly at: string }[];
  revocations(): readonly { readonly playerId: string; readonly roomId: string; readonly at: string }[];
  history(): readonly { readonly playerId: string; readonly productUserId: string; readonly at: string }[];
} {
  const byPlayer = new Map<string, string>();
  const byPuid = new Map<string, string>();
  const issued: { playerId: string; roomId: string; productUserId: string; at: string }[] = [];
  const history: { playerId: string; productUserId: string; at: string }[] = [];
  /** (player, room) -> the identity the open token admits. */
  const open = new Map<string, string>();
  const revoked: { playerId: string; roomId: string; at: string }[] = [];
  return {
    async bind({ playerId, productUserId, at }) {
      if (!WONDERLAND_EOS_PUID.test(productUserId)) throw new Error('wonderland_voice_puid_invalid');
      const decision = decideWonderlandVoiceBinding({
        playerId, productUserId,
        currentForPlayer: byPlayer.get(playerId) ?? null,
        currentHolder: byPuid.get(productUserId) ?? null,
      });
      if (decision.outcome === 'BIND' || decision.outcome === 'REBIND') {
        if (decision.previousProductUserId !== null) byPuid.delete(decision.previousProductUserId);
        byPlayer.set(playerId, productUserId);
        byPuid.set(productUserId, playerId);
        history.push({ playerId, productUserId, at });
      }
      return decision;
    },
    async productUserIdOf(playerId) { return byPlayer.get(playerId) ?? null; },
    async productUserIdsOf(playerIds) {
      return Object.fromEntries(playerIds.flatMap((id) => (byPlayer.has(id) ? [[id, byPlayer.get(id)!]] : [])));
    },
    async recordIssuance(input) {
      if (!WONDERLAND_EOS_PUID.test(input.productUserId)) throw new Error('wonderland_voice_puid_invalid');
      const key = `${input.playerId}\u0000${input.roomId}`;
      const holder = open.get(key);
      if (holder !== undefined && holder !== input.productUserId) throw new Error('wonderland_voice_issuance_held');
      issued.push({ ...input });
      open.set(key, input.productUserId);
    },
    async openRoomsOf(playerId) {
      return [...open.keys()].filter((key) => key.startsWith(`${playerId}\u0000`)).map((key) => key.slice(playerId.length + 1)).sort();
    },
    async openIssuancesOf(playerId) {
      return [...open.entries()].filter(([key]) => key.startsWith(`${playerId}\u0000`))
        .map(([key, productUserId]) => ({ roomId: key.slice(playerId.length + 1), productUserId }))
        .sort((a, b) => (a.roomId < b.roomId ? -1 : a.roomId > b.roomId ? 1 : 0));
    },
    async recordRevocation(input) { open.delete(`${input.playerId}\u0000${input.roomId}`); revoked.push({ ...input }); },
    issuances: () => issued,
    revocations: () => revoked,
    history: () => history,
  };
}
