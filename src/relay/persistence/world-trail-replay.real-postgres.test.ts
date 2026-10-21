import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { WorldView } from '../social/world-presence';
import { juliusTestDatabaseUrl } from './julius-test-database';
import { openSocialPostgresStore } from './social-postgres';
import { TransactionalWonderlandDatabase } from './wonderland-postgres';
import { emptyStats, nbHistory, niPair, REPLAY_T0 } from './world-trail-replay-harness';

/**
 * THE TRANSPORT RING ON REAL POSTGRESQL (TRANSPORT_RING_DESIGN_T1_v2.md c72f1ea8 section 1.3; T1 v1 R33-R35). r16reh18 PROTOTYPE.
 *   - R27 (NB) through the PostgreSQL store: 60 seeds x 120 ops, each with at least one durable write the database refuses -- a
 *     player row deleted behind the store (the technique of social-postgres.real-postgres.test.ts), SQLSTATE class 23 -- which adopts
 *     NOTHING, and its retry after the row is restored, which adopts both.
 *   - R27b (NI) through the PostgreSQL store: 40 seeds.
 *   - R33 a block, reports and an unblock: nothing from the block period is served; R34 a refused write adopts neither the state nor
 *     the floors; R35 a restart (a new store on the same database) empties every ring, and the schema has no new table or column.
 * Runs only where JULIUS_TEST_DATABASE_URL names a THROWAWAY database; `todo` elsewhere. CI evidence must show these EXECUTED.
 */

const databaseUrl = juliusTestDatabaseUrl();
const suite = databaseUrl !== null ? describe : describe.todo;
const iso = new Date(REPLAY_T0).toISOString();

suite('the transport ring on real PostgreSQL (R27, R27b, R33-R35)', () => {
  const nonce = randomBytes(4).toString('hex');
  let pool: Pool;
  let columnsBefore = '';
  const columns = async () => JSON.stringify((await pool.query(`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'relay_wonderland' ORDER BY 1, 2`)).rows);

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl! });
    await new TransactionalWonderlandDatabase(pool).migrate();
    columnsBefore = await columns();
  }, 120_000);
  afterAll(async () => {
    await pool?.end();
  });

  /** A clean slate for these players (both histories of an R27b seed use the same ids), as social-postgres.real-postgres.test.ts
   *  removes what it made: parties they lead first (leader_id does not cascade), their conversations, events, then their rows. */
  const realStore = async (_initial: unknown, players: readonly string[]) => {
    const ids = [...players];
    await pool.query(`DELETE FROM relay_wonderland.social_parties WHERE leader_id = ANY($1::text[])`, [ids]);
    await pool.query(`DELETE FROM relay_wonderland.social_conversations WHERE conversation_id IN (SELECT conversation_id FROM relay_wonderland.social_conversation_members WHERE player_id = ANY($1::text[]))`, [ids]);
    await pool.query(`DELETE FROM relay_wonderland.social_events WHERE audience && $1::text[]`, [ids]);
    await pool.query(`DELETE FROM relay_wonderland.players WHERE player_id = ANY($1::text[])`, [ids]);
    for (const id of players) await pool.query(`INSERT INTO relay_wonderland.players(player_id) VALUES($1) ON CONFLICT DO NOTHING`, [id]);
    const store = await openSocialPostgresStore(pool);
    for (const id of players) await store.ensureUser({ userId: id, displayName: id, handle: `@${id}` }, iso);
    return {
      store,
      initial: await store.read(),
      deleteRow: async (id: string) => { await pool.query(`DELETE FROM relay_wonderland.players WHERE player_id = $1`, [id]); },
      restoreRow: async (id: string) => { await pool.query(`INSERT INTO relay_wonderland.players(player_id) VALUES($1) ON CONFLICT DO NOTHING`, [id]); },
    };
  };

  it('R27 (NB) through real PostgreSQL: 60 seeds x 120 ops, each with a refused durable write that adopts nothing, and its retry', async () => {
    const stats = emptyStats();
    const violations: string[] = [];
    for (let seed = 1; seed <= 60 && violations.length < 5; seed += 1) {
      await nbHistory(400_000 + seed, { ops: 120, makeStore: realStore, midHistoryCarriedIn: false, failedCommit: true, openings: 'none', prefix: `${nonce}a${seed}_` }, stats, violations);
    }
    if (process.env.RING_REPLAY_STATS) (await import('node:fs')).appendFileSync(process.env.RING_REPLAY_STATS, `R27-postgres-real ${JSON.stringify(stats)}\n`);
    expect(violations).toEqual([]);
    expect(stats.failedCommits).toBeGreaterThanOrEqual(60);
    expect(stats.retriesAdopted).toBeGreaterThanOrEqual(60);
    expect(stats.served).toBeGreaterThan(0);
  }, 900_000);

  it('R27b (NI) through real PostgreSQL: 40 seeds; V\'s answers byte for byte', async () => {
    const stats = emptyStats();
    const violations: string[] = [];
    for (let seed = 1; seed <= 40 && violations.length < 5; seed += 1) await niPair(500_000 + seed, { ops: 120, makeStore: realStore, prefix: `${nonce}b${seed}_` }, stats, violations);
    if (process.env.RING_REPLAY_STATS) (await import('node:fs')).appendFileSync(process.env.RING_REPLAY_STATS, `R27b-postgres-real ${JSON.stringify(stats)}\n`);
    expect(violations).toEqual([]);
    expect(stats.comparedAnswers).toBeGreaterThan(40 * 20);
  }, 900_000);

  it('R33 R34 R35 a block period is never served; a refused write adopts neither state nor floors; a restart empties every ring and adds no column', async () => {
    const [kai, nova] = [`usr_${nonce}rk`, `usr_${nonce}rn`];
    const made = await realStore(null, [kai, nova]);
    const store = made.store;
    const op = (actor: string, o: Parameters<typeof store.apply>[0], ms: number, body: Record<string, unknown> = {}, ids: string[] = [], query: Record<string, string> = {}) =>
      store.apply(o, actor, { ids, body, query }, new Date(REPLAY_T0 + ms).toISOString());
    const pos = (x: number) => ({ x, y: 0, z: 1, yaw: 0, speed: 0, motion: 'IDLE', skinId: 'shadow_flame' });
    const kaiSeesNova = async (ms: number) => {
      const r = await op(kai, 'world.state', ms, pos(1), [], { sinceMs: '0' });
      if (!r.ok) throw new Error(r.error.message);
      const f = (r.value as WorldView).avatars.find((a) => a.userId === nova);
      return f === undefined ? null : [f.x, (f.trail ?? []).map((p) => p.x)];
    };
    for (const id of [kai, nova]) await op(id, 'world.join', 1, { target: 'PUBLIC', place: `r33${nonce}` });
    for (const ms of [100, 200, 300]) await op(nova, 'world.state', ms, pos(ms));
    expect(await kaiSeesNova(350)).toEqual([300, [100, 200]]);
    // R33: a block period is never served afterwards
    expect((await op(kai, 'blocks.add', 400, { targetId: nova })).ok).toBe(true);
    for (const ms of [500, 600]) await op(nova, 'world.state', ms, pos(ms));
    expect((await op(kai, 'blocks.remove', 700, {}, [nova])).ok).toBe(true);
    await op(nova, 'world.state', 800, pos(800));
    expect(await kaiSeesNova(850)).toEqual([800, []]);
    // R34: a durable write the database refuses (Nova's row deleted behind the store) adopts neither the state nor the floors
    for (const ms of [900, 1000]) await op(nova, 'world.state', ms, pos(ms));
    expect(await kaiSeesNova(1050)).toEqual([1000, [800, 900]]);
    await made.deleteRow(nova);
    const refused = await op(kai, 'blocks.add', 1100, { targetId: nova });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe('validation-failed');
    await made.restoreRow(nova);
    expect(await kaiSeesNova(1150)).toEqual([1000, [800, 900]]);   // no block adopted, and no floor
    // R35: a restart -- a new store on the same database -- every ring is empty; the schema is unchanged
    const restarted = await openSocialPostgresStore(pool);
    // as the routes do before every operation (R34 deleted Nova's row, and its social rows with it)
    for (const id of [kai, nova]) await restarted.ensureUser({ userId: id, displayName: id, handle: `@${id}` }, iso);
    for (const id of [kai, nova]) await restarted.apply('world.join', id, { ids: [], body: { target: 'PUBLIC', place: `r33${nonce}` }, query: {} }, new Date(REPLAY_T0 + 1200).toISOString());
    await restarted.apply('world.state', nova, { ids: [], body: pos(1300), query: {} }, new Date(REPLAY_T0 + 1300).toISOString());
    const first = await restarted.apply('world.state', kai, { ids: [], body: pos(1), query: { sinceMs: '0' } }, new Date(REPLAY_T0 + 1350).toISOString());
    expect(first.ok).toBe(true);
    if (first.ok) expect((first.value as WorldView).avatars.map((a) => [a.x, a.trail])).toEqual([[1300, undefined]]);
    expect(await columns()).toBe(columnsBefore);
  }, 120_000);
});
