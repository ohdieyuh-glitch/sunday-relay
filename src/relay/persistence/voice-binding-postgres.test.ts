import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

import { createPostgresVoiceBindings } from './voice-binding-postgres';

/*
 * THE 23505 RE-READ (MAIN's internal review a6d5842c, m2), against a scripted client. A player's first join sent twice at once (a
 * client retry) made the second INSERT fail with 23505, which the store answered `refused`: the player was told "party not found".
 * The store now decides once more against what is there. This pins what one bind sends PostgreSQL and how it answers when a
 * concurrent bind commits first, which a real race reaches only by chance. The table's own UNIQUE(puid) and PK(user_id) are proven
 * on PostgreSQL itself (voice-binding-postgres.real-postgres.test.ts, which also races a same-player first join).
 */

const NOW = '2026-10-07T12:00:00.000Z';
const P1 = '0123456789abcdef0123456789abcdef';

interface Row {
  user_id: string;
  puid: string;
  session_id: string;
  bound_at: Date;
}

/**
 * A pool whose one client answers from an in-memory table. `collisions[n]` runs at the n-th INSERT or UPDATE: it commits a
 * concurrent row (or nothing) and the write fails with 23505, as PostgreSQL's unique index does. `failWith` fails every write.
 */
function scriptedPool(opts: { collisions?: Array<((table: Row[]) => void) | undefined>; failWith?: { code: string } }) {
  const table: Row[] = [];
  const sent: string[] = [];
  let released = 0;
  let writes = 0;
  const query = async (sql: string, params: unknown[] = []) => {
    const verb = sql.trim().split(/\s+/)[0].toUpperCase();
    sent.push(verb !== 'SELECT' ? verb : sql.includes('FOR UPDATE') ? 'SELECT mine' : 'SELECT owner');
    if (verb === 'SELECT') {
      return { rows: sql.includes('WHERE user_id = $1') ? table.filter((r) => r.user_id === params[0]) : table.filter((r) => r.puid === params[0]) };
    }
    if (verb === 'INSERT' || verb === 'UPDATE') {
      const collide = opts.collisions?.[writes];
      writes += 1;
      if (collide !== undefined) {
        collide(table);
        throw Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });
      }
      if (opts.failWith !== undefined) throw Object.assign(new Error('terminating connection due to administrator command'), opts.failWith);
      const [user, puid, session, at] = params as [string, string, string, string];
      const mine = table.find((r) => r.user_id === user);
      if (verb === 'INSERT') table.push({ user_id: user, puid, session_id: session, bound_at: new Date(at) });
      if (verb === 'UPDATE' && mine !== undefined) Object.assign(mine, { puid, session_id: session, bound_at: new Date(at) });
    }
    return { rows: [] };
  };
  const client = { query, release: () => { released += 1; } };
  const pool = { connect: async () => client, query } as unknown as Pool;
  return { pool, table, sent, released: () => released };
}

const ONE_TRY = ['BEGIN', 'SELECT mine', 'SELECT owner'];

describe('the PostgreSQL bind re-reads ONCE on 23505 (review a6d5842c, m2)', () => {
  it("the control: no collision, one transaction, 'bound'", async () => {
    const db = scriptedPool({});
    expect(await createPostgresVoiceBindings(db.pool).bind({ userId: 'ghu-1', puid: P1, sessionId: 's1', nowIso: NOW })).toBe('bound');
    expect(db.sent).toEqual([...ONE_TRY, 'INSERT', 'COMMIT']);
    expect(db.released()).toBe(1);
  });

  it("a player's first join sent twice at once: the INSERT collides with their OWN committed row, and the re-read answers 'same' (never 'refused')", async () => {
    const db = scriptedPool({ collisions: [(t) => t.push({ user_id: 'ghu-1', puid: P1, session_id: 's1', bound_at: new Date(NOW) })] });
    expect(await createPostgresVoiceBindings(db.pool).bind({ userId: 'ghu-1', puid: P1, sessionId: 's1', nowIso: NOW })).toBe('same');
    expect(db.sent).toEqual([...ONE_TRY, 'INSERT', 'ROLLBACK', ...ONE_TRY, 'COMMIT']);
    expect(db.released()).toBe(2);
    expect(db.table).toHaveLength(1);
  });

  it("the collision was ANOTHER player's bind of that PUID: the re-read answers 'refused' -- never a second owner", async () => {
    const db = scriptedPool({ collisions: [(t) => t.push({ user_id: 'ghu-2', puid: P1, session_id: 's9', bound_at: new Date(NOW) })] });
    expect(await createPostgresVoiceBindings(db.pool).bind({ userId: 'ghu-1', puid: P1, sessionId: 's1', nowIso: NOW })).toBe('refused');
    expect(db.sent).toEqual([...ONE_TRY, 'INSERT', 'ROLLBACK', ...ONE_TRY, 'COMMIT']);
    expect(db.table.map((r) => r.user_id)).toEqual(['ghu-2']);
  });

  it("one re-read only: a second collision is 'refused', each transaction rolled back and its client released", async () => {
    const db = scriptedPool({ collisions: [() => undefined, () => undefined] });
    expect(await createPostgresVoiceBindings(db.pool).bind({ userId: 'ghu-1', puid: P1, sessionId: 's1', nowIso: NOW })).toBe('refused');
    expect(db.sent).toEqual([...ONE_TRY, 'INSERT', 'ROLLBACK', ...ONE_TRY, 'INSERT', 'ROLLBACK']);
    expect(db.released()).toBe(2);
    expect(db.table).toEqual([]);
  });

  it('any other failure is thrown at once: rolled back, released, never retried', async () => {
    const db = scriptedPool({ failWith: { code: '57P01' } });
    await expect(createPostgresVoiceBindings(db.pool).bind({ userId: 'ghu-1', puid: P1, sessionId: 's1', nowIso: NOW })).rejects.toMatchObject({ code: '57P01' });
    expect(db.sent).toEqual([...ONE_TRY, 'INSERT', 'ROLLBACK']);
    expect(db.released()).toBe(1);
  });
});
