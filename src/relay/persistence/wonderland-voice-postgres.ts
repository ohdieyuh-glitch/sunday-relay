import type { Pool } from 'pg';

import {
  WONDERLAND_EOS_PUID,
  decideWonderlandVoiceBinding,
  type WonderlandVoiceBindingDecision,
  type WonderlandVoiceIdentityStore,
  type WonderlandVoiceIssuance,
} from '../mission/wonderland-voice';

/**
 * WONDERLAND VOICE ON POSTGRESQL (migration 035, staged until 034 lands).
 *
 * BINDING IS ONE TRANSACTION, AND THE TABLE IS THE ARBITER. Both rows the
 * decision reads — this player's identity and this PUID's holder — are read
 * FOR UPDATE, the domain decides (`decideWonderlandVoiceBinding`), and the
 * write lands under UNIQUE(product_user_id). Two players racing for one PUID:
 * one commits, the other's write meets the constraint and is answered REFUSED,
 * whatever its own read said a moment earlier.
 *
 * ISSUANCES ARE A RECORD, NEVER A TOKEN: one row per (player, room), naming the
 * EOS identity the token admits. Re-issue re-opens it, revocation closes it, and
 * a row still open for ANOTHER identity is never re-issued over: that identity
 * has to be taken out of the room first. `openIssuancesOf` is what the reconciler
 * takes back from when the wall moves or the player re-binds.
 */
export class WonderlandVoicePostgresStore implements WonderlandVoiceIdentityStore {
  constructor(private readonly pool: Pool) {}

  async bind(input: { readonly playerId: string; readonly productUserId: string; readonly at: string }): Promise<WonderlandVoiceBindingDecision> {
    if (!WONDERLAND_EOS_PUID.test(input.productUserId)) throw new Error('wonderland_voice_puid_invalid');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO relay_wonderland.players(player_id) VALUES($1) ON CONFLICT DO NOTHING', [input.playerId]);
      const mine = await client.query<{ product_user_id: string }>(
        'SELECT product_user_id FROM relay_wonderland.voice_identities WHERE player_id = $1 FOR UPDATE', [input.playerId]);
      const holder = await client.query<{ player_id: string }>(
        'SELECT player_id FROM relay_wonderland.voice_identities WHERE product_user_id = $1 FOR UPDATE', [input.productUserId]);
      const decision = decideWonderlandVoiceBinding({
        playerId: input.playerId,
        productUserId: input.productUserId,
        currentForPlayer: mine.rows[0]?.product_user_id ?? null,
        currentHolder: holder.rows[0]?.player_id ?? null,
      });
      if (decision.outcome === 'BIND' || decision.outcome === 'REBIND') {
        await client.query(
          `INSERT INTO relay_wonderland.voice_identities(player_id, product_user_id, bound_at) VALUES($1,$2,$3)
           ON CONFLICT (player_id) DO UPDATE SET product_user_id = EXCLUDED.product_user_id, bound_at = EXCLUDED.bound_at`,
          [input.playerId, input.productUserId, input.at]);
        await client.query(
          'INSERT INTO relay_wonderland.voice_identity_history(player_id, product_user_id, bound_at) VALUES($1,$2,$3)',
          [input.playerId, input.productUserId, input.at]);
      }
      await client.query('COMMIT');
      return decision;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      // The constraint decided a race the reads could not see: another player bound this PUID first.
      if ((error as { code?: string }).code === '23505') return { outcome: 'REFUSED', reason: 'puid_bound_to_another_player' };
      throw error;
    } finally {
      client.release();
    }
  }

  async productUserIdOf(playerId: string): Promise<string | null> {
    const result = await this.pool.query<{ product_user_id: string }>(
      'SELECT product_user_id FROM relay_wonderland.voice_identities WHERE player_id = $1', [playerId]);
    return result.rows[0]?.product_user_id ?? null;
  }

  async productUserIdsOf(playerIds: readonly string[]): Promise<Readonly<Record<string, string>>> {
    if (playerIds.length === 0) return {};
    const result = await this.pool.query<{ player_id: string; product_user_id: string }>(
      'SELECT player_id, product_user_id FROM relay_wonderland.voice_identities WHERE player_id = ANY($1)', [[...playerIds]]);
    return Object.fromEntries(result.rows.map((row) => [row.player_id, row.product_user_id]));
  }

  async recordIssuance(input: { readonly playerId: string; readonly roomId: string; readonly productUserId: string; readonly at: string }): Promise<void> {
    if (!WONDERLAND_EOS_PUID.test(input.productUserId)) throw new Error('wonderland_voice_puid_invalid');
    const written = await this.pool.query(
      `INSERT INTO relay_wonderland.voice_issuances(player_id, room_id, product_user_id, issued_at, revoked_at) VALUES($1,$2,$3,$4,NULL)
       ON CONFLICT (player_id, room_id) DO UPDATE SET product_user_id = EXCLUDED.product_user_id, issued_at = EXCLUDED.issued_at, revoked_at = NULL
        WHERE voice_issuances.revoked_at IS NOT NULL OR voice_issuances.product_user_id = EXCLUDED.product_user_id`,
      [input.playerId, input.roomId, input.productUserId, input.at]);
    if ((written.rowCount ?? 0) === 0) throw new Error('wonderland_voice_issuance_held');
  }

  async openRoomsOf(playerId: string): Promise<readonly string[]> {
    return (await this.openIssuancesOf(playerId)).map((row) => row.roomId);
  }

  async openIssuancesOf(playerId: string): Promise<readonly WonderlandVoiceIssuance[]> {
    const result = await this.pool.query<{ room_id: string; product_user_id: string }>(
      'SELECT room_id, product_user_id FROM relay_wonderland.voice_issuances WHERE player_id = $1 AND revoked_at IS NULL ORDER BY room_id', [playerId]);
    return result.rows.map((row) => ({ roomId: row.room_id, productUserId: row.product_user_id }));
  }

  async recordRevocation(input: { readonly playerId: string; readonly roomId: string; readonly at: string }): Promise<void> {
    await this.pool.query(
      'UPDATE relay_wonderland.voice_issuances SET revoked_at = GREATEST($3::timestamptz, issued_at) WHERE player_id = $1 AND room_id = $2 AND revoked_at IS NULL',
      [input.playerId, input.roomId, input.at]);
  }
}
