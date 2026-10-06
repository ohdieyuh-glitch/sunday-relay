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
/**
 * ONE PLAYER'S VOICE LOCK, WHERE EVERY BRIDGE PROCESS SEES IT.
 *
 * The routes already run one player's voice steps one at a time inside a process. Two processes on one database (a
 * deploy's overlap, a second replica) each had their own order, and the races that order closed came back between
 * them: a join that had planned before another process's block issued the blocked pair's room after that block's
 * reconcile had taken it back. So a store several processes share holds the player's lock in PostgreSQL for the step.
 *
 * - A session-level advisory lock in the TWO-KEY space (`WONDERLAND_VOICE_LOCK_SPACE`, `hashtext(player)`). The two-key
 *   and one-key spaces never overlap, so it cannot meet the one-key locks the social store, `migrate()` and the Julius
 *   writer take. Two players whose names share a hash merely take turns.
 * - On its OWN small pool: the lock's connection holds the lock and nothing else, and the step's reads and writes go
 *   through the store's pool as before. A step holding a connection from the pool its own queries need would let
 *   enough concurrent players hold every connection and wait on each other for ever.
 * - Bounded: a wait longer than `lockTimeoutMs` is an error (55P03), never a hang.
 * - Released when the step settles, whatever its outcome. A session that cannot confirm the release is ended rather
 *   than returned to the pool, and the server releases what that session held.
 */
export const WONDERLAND_VOICE_LOCK_SPACE = 0x574c5643; // 'WLVC'
export const WONDERLAND_VOICE_LOCK_TIMEOUT_MS = 15_000;

async function holdWonderlandVoiceLock<T>(locks: Pool, playerId: string, timeoutMs: number, step: () => Promise<T>): Promise<T> {
  const client = await locks.connect();
  let held = false;
  let healthy = true;
  try {
    await client.query("SELECT set_config('lock_timeout', $1, false)", [`${String(Math.max(1, Math.floor(timeoutMs)))}ms`]);
    await client.query('SELECT pg_advisory_lock($1, hashtext($2))', [WONDERLAND_VOICE_LOCK_SPACE, playerId]);
    held = true;
    return await step();
  } catch (error) {
    // A lock wait that ran out leaves a healthy session; anything else may not have.
    if (!held && (error as { code?: string }).code !== '55P03') healthy = false;
    throw error;
  } finally {
    if (held) {
      const released = await client.query<{ released: boolean }>(
        'SELECT pg_advisory_unlock($1, hashtext($2)) AS released', [WONDERLAND_VOICE_LOCK_SPACE, playerId],
      ).then((result) => result.rows[0]?.released === true, () => false);
      if (!released) healthy = false;
    }
    client.release(healthy ? undefined : true);
  }
}

export class WonderlandVoicePostgresStore implements WonderlandVoiceIdentityStore {
  /** Present only when the store was given a lock pool: see `holdWonderlandVoiceLock`. */
  readonly withPlayerVoiceLock?: <T>(playerId: string, step: () => Promise<T>) => Promise<T>;

  constructor(private readonly pool: Pool, options: { readonly locks?: Pool; readonly lockTimeoutMs?: number } = {}) {
    const locks = options.locks;
    const timeoutMs = options.lockTimeoutMs ?? WONDERLAND_VOICE_LOCK_TIMEOUT_MS;
    if (locks !== undefined) this.withPlayerVoiceLock = (playerId, step) => holdWonderlandVoiceLock(locks, playerId, timeoutMs, step);
  }

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
