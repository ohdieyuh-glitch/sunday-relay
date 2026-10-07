import type { Pool } from 'pg';

import { decideVoiceBinding, type VoiceBindingOutcome, type VoiceBindingRow, type VoiceBindingStore } from '../social/voice-binding';

/** A relay_wonderland.voice_puid_binding row as pg returns it. */
interface BindingRowShape {
  user_id: string;
  puid: string;
  session_id: string;
  bound_at: Date;
}

const rowOf = (row: BindingRowShape | undefined): VoiceBindingRow | null =>
  row === undefined ? null : { userId: row.user_id, puid: row.puid, sessionId: row.session_id, boundAtIso: new Date(row.bound_at).toISOString() };

/**
 * PARTY VOICE PUID BINDINGS, DURABLE: relay_wonderland.voice_puid_binding (wonderland-migrations/035_wonderland_voice.sql).
 *
 * The rule is decideVoiceBinding's (src/relay/social/voice-binding.ts); this applies it in ONE transaction that locks the
 * caller's row, so two joins cannot both bind. The table's UNIQUE(puid) and PRIMARY KEY(user_id) are the last word: a race that
 * would bind one PUID to two players fails the write with 23505.
 * ON 23505 THE BIND DECIDES ONCE MORE (MAIN's internal review a6d5842c, m2): the concurrent bind that won has committed, so a
 * second transaction reads it. A player's own first join sent twice (a client retry) then answers `same`, not `refused` -- which
 * the route would have told them as "party not found". Somebody else's bind is `refused`, and a second collision is `refused`:
 * never a second owner.
 * bindingOf and ownerOf are plain reads (no lock): the voice route predicts a re-bind from them, and bind decides again.
 */
export function createPostgresVoiceBindings(pool: Pool): VoiceBindingStore {
  /** One attempt, in its own transaction; any failure is rolled back and thrown. */
  const bindOnce = async ({ userId, puid, sessionId, sessionIssuedAtIso, nowIso }: Parameters<VoiceBindingStore['bind']>[0]): Promise<VoiceBindingOutcome> => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const mineRows = await client.query<BindingRowShape>(
        'SELECT user_id, puid, session_id, bound_at FROM relay_wonderland.voice_puid_binding WHERE user_id = $1 FOR UPDATE',
        [userId],
      );
      const ownerRows = await client.query<{ user_id: string }>('SELECT user_id FROM relay_wonderland.voice_puid_binding WHERE puid = $1', [puid]);
      const mine = rowOf(mineRows.rows[0]);
      const outcome = decideVoiceBinding({ userId, puid, sessionId, sessionIssuedAtIso, mine, owner: ownerRows.rows[0]?.user_id ?? null });
      if (outcome === 'bound') {
        await client.query('INSERT INTO relay_wonderland.voice_puid_binding(user_id, puid, session_id, bound_at) VALUES($1, $2, $3, $4)', [userId, puid, sessionId, nowIso]);
      } else if (outcome === 'rebound') {
        await client.query('UPDATE relay_wonderland.voice_puid_binding SET puid = $2, session_id = $3, bound_at = $4 WHERE user_id = $1', [userId, puid, sessionId, nowIso]);
      }
      await client.query('COMMIT');
      return outcome;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  };
  const isUniqueViolation = (error: unknown): boolean => (error as { code?: unknown } | null)?.code === '23505';
  return {
    async bind(input) {
      try {
        return await bindOnce(input);
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }
      // 23505: a concurrent bind committed first. Decide again against what is there now -- once.
      try {
        return await bindOnce(input);
      } catch (error) {
        if (isUniqueViolation(error)) return 'refused';
        throw error;
      }
    },
    async bindingOf(userId) {
      const rows = await pool.query<BindingRowShape>('SELECT user_id, puid, session_id, bound_at FROM relay_wonderland.voice_puid_binding WHERE user_id = $1', [userId]);
      return rowOf(rows.rows[0]);
    },
    async ownerOf(puid) {
      const rows = await pool.query<{ user_id: string }>('SELECT user_id FROM relay_wonderland.voice_puid_binding WHERE puid = $1', [puid]);
      return rows.rows[0]?.user_id ?? null;
    },
    async puidsOf(userIds) {
      if (userIds.length === 0) return new Map();
      const rows = await pool.query<{ user_id: string; puid: string }>('SELECT user_id, puid FROM relay_wonderland.voice_puid_binding WHERE user_id = ANY($1::text[])', [[...userIds]]);
      return new Map(rows.rows.map((r) => [r.user_id, r.puid]));
    },
  };
}
