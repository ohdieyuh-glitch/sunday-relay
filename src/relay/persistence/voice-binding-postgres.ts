import type { Pool } from 'pg';

import { decideVoiceBinding, type VoiceBindingRow, type VoiceBindingStore } from '../social/voice-binding';

/**
 * PARTY VOICE PUID BINDINGS, DURABLE: relay_wonderland.voice_puid_binding (wonderland-migrations/034_wonderland_voice.sql).
 *
 * The rule is decideVoiceBinding's (src/relay/social/voice-binding.ts); this applies it in ONE transaction that locks the
 * caller's row, so two joins cannot both bind. The table's UNIQUE(puid) is the last word: a race that would bind one PUID to two
 * players fails the insert, and that is answered as `refused` -- never as a second owner.
 */
export function createPostgresVoiceBindings(pool: Pool): VoiceBindingStore {
  return {
    async bind({ userId, puid, sessionId, nowIso }) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const mineRows = await client.query<{ user_id: string; puid: string; session_id: string; bound_at: Date }>(
          'SELECT user_id, puid, session_id, bound_at FROM relay_wonderland.voice_puid_binding WHERE user_id = $1 FOR UPDATE',
          [userId],
        );
        const ownerRows = await client.query<{ user_id: string }>('SELECT user_id FROM relay_wonderland.voice_puid_binding WHERE puid = $1', [puid]);
        const row = mineRows.rows[0];
        const mine: VoiceBindingRow | null = row === undefined ? null : { userId: row.user_id, puid: row.puid, sessionId: row.session_id, boundAtIso: new Date(row.bound_at).toISOString() };
        const outcome = decideVoiceBinding({ userId, puid, sessionId, mine, owner: ownerRows.rows[0]?.user_id ?? null });
        if (outcome === 'bound') {
          await client.query('INSERT INTO relay_wonderland.voice_puid_binding(user_id, puid, session_id, bound_at) VALUES($1, $2, $3, $4)', [userId, puid, sessionId, nowIso]);
        } else if (outcome === 'rebound') {
          await client.query('UPDATE relay_wonderland.voice_puid_binding SET puid = $2, session_id = $3, bound_at = $4 WHERE user_id = $1', [userId, puid, sessionId, nowIso]);
        }
        await client.query('COMMIT');
        return outcome;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        // 23505 unique_violation: somebody else bound this PUID (or this player) in between -- never a second owner
        if ((error as { code?: string }).code === '23505') return 'refused';
        throw error;
      } finally {
        client.release();
      }
    },
    async puidsOf(userIds) {
      if (userIds.length === 0) return new Map();
      const rows = await pool.query<{ user_id: string; puid: string }>('SELECT user_id, puid FROM relay_wonderland.voice_puid_binding WHERE user_id = ANY($1::text[])', [[...userIds]]);
      return new Map(rows.rows.map((r) => [r.user_id, r.puid]));
    },
  };
}
