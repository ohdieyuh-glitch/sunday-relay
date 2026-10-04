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
  /** Audit: which player was given a token for which room, when. The token is never stored. */
  recordIssuance(input: { readonly playerId: string; readonly roomId: string; readonly at: string }): Promise<void>;
  /** The rooms a player was given a token for and that the trusted server has not taken back. */
  openRoomsOf(playerId: string): Promise<readonly string[]>;
  /** The trusted server removed the player from the room: the token no longer admits them. */
  recordRevocation(input: { readonly playerId: string; readonly roomId: string; readonly at: string }): Promise<void>;
}

export function createMemoryWonderlandVoiceIdentityStore(): WonderlandVoiceIdentityStore & {
  issuances(): readonly { readonly playerId: string; readonly roomId: string; readonly at: string }[];
  revocations(): readonly { readonly playerId: string; readonly roomId: string; readonly at: string }[];
  history(): readonly { readonly playerId: string; readonly productUserId: string; readonly at: string }[];
} {
  const byPlayer = new Map<string, string>();
  const byPuid = new Map<string, string>();
  const issued: { playerId: string; roomId: string; at: string }[] = [];
  const history: { playerId: string; productUserId: string; at: string }[] = [];
  const open = new Set<string>();
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
    async recordIssuance(input) { issued.push({ ...input }); open.add(`${input.playerId}\u0000${input.roomId}`); },
    async openRoomsOf(playerId) {
      return [...open].filter((key) => key.startsWith(`${playerId}\u0000`)).map((key) => key.slice(playerId.length + 1)).sort();
    },
    async recordRevocation(input) { open.delete(`${input.playerId}\u0000${input.roomId}`); revoked.push({ ...input }); },
    issuances: () => issued,
    revocations: () => revoked,
    history: () => history,
  };
}
