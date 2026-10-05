import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { juliusTestDatabaseUrl } from './julius-test-database';
import { WONDERLAND_MIGRATIONS } from './wonderland-postgres';
import { WonderlandVoicePostgresStore } from './wonderland-voice-postgres';

/**
 * WONDERLAND VOICE ON REAL POSTGRESQL — the STAGED migration 035 and its store.
 *
 * 035 is staged (docs/julius-migrations/035/) because 034 must come first and
 * does not exist yet. These cases apply it the only honest way possible today:
 * on a throwaway database at 033, after a TEST-ONLY placeholder stamp
 * `034_test_placeholder_not_a_migration` that exists in no real ledger — and
 * they prove the guard refuses without it, so the placeholder is the one thing
 * standing in for 034 and it is named for what it is.
 *
 * Runs wherever JULIUS_TEST_DATABASE_URL names a throwaway database; `todo`
 * everywhere else, so an absent database is a skipped proof, never a passing one.
 */

const databaseUrl = juliusTestDatabaseUrl();
const suite = databaseUrl !== null ? describe : describe.todo;
const DOCS = join(__dirname, '..', '..', '..', 'docs', 'julius-migrations', '035');
const committed = (name: string): string => readFileSync(join(DOCS, name), 'utf8').replace(/^\\set ON_ERROR_STOP on\s*$/mu, '');
const MIGRATION_035 = committed('035_wonderland_voice.sql');
const PLACEHOLDER_034 = "INSERT INTO relay_wonderland.schema_migrations(version) VALUES('034_test_placeholder_not_a_migration')";
const PUID = (c: string): string => c.repeat(32);

suite('Wonderland voice on real PostgreSQL (staged migration 035)', () => {
  const nonce = randomBytes(5).toString('hex');
  let admin: Pool;
  const made: Array<{ name: string; pool: Pool }> = [];
  const create = async (label: string, extra: readonly string[] = []): Promise<Pool> => {
    const name = `wvoice${label}${nonce}`;
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(databaseUrl!);
    url.pathname = `/${name}`;
    const pool = new Pool({ connectionString: url.toString(), max: 8 });
    made.push({ name, pool });
    for (const sql of WONDERLAND_MIGRATIONS) await pool.query(sql);
    for (const sql of extra) await pool.query(sql);
    return pool;
  };
  const refusalOf = async (pool: Pool, sql: string): Promise<string | null> => {
    const client = await pool.connect();
    try { await client.query(sql); return null; } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      return (error as Error).message.split(':')[0]!;
    } finally { client.release(); }
  };

  beforeAll(async () => { admin = new Pool({ connectionString: databaseUrl!, max: 2 }); });
  afterAll(async () => {
    for (const { name, pool } of made) {
      pool.on('error', () => undefined);
      await pool.end().catch(() => undefined);
      await admin.query(`DROP DATABASE IF EXISTS ${name}`).catch(() => undefined);
    }
    await admin?.end();
  });

  it('refuses without a 034 stamp, changing nothing, then applies after one: three voice tables, no token column', async () => {
    const pool = await create('apply');
    expect(await refusalOf(pool, MIGRATION_035)).toBe('migration_035_requires_034');
    expect((await pool.query("SELECT 1 FROM pg_tables WHERE schemaname='relay_wonderland' AND tablename LIKE 'voice\\_%'")).rowCount).toBe(0);
    await pool.query(PLACEHOLDER_034);
    expect(await refusalOf(pool, MIGRATION_035)).toBeNull();
    expect((await pool.query("SELECT 1 FROM pg_tables WHERE schemaname='relay_wonderland' AND tablename LIKE 'voice\\_%'")).rowCount).toBe(3);
    expect((await pool.query("SELECT 1 FROM information_schema.columns WHERE table_schema='relay_wonderland' AND table_name LIKE 'voice\\_%' AND (column_name ILIKE '%token%' OR column_name ILIKE '%secret%')")).rowCount).toBe(0);
    expect(await refusalOf(pool, MIGRATION_035), 'a second application').toBe('migration_035_tables_exist');
  });

  it('refuses before 033', async () => {
    const pool = await create('early');
    await pool.query("DELETE FROM relay_wonderland.schema_migrations WHERE version = '033_wonderland_social'");
    await pool.query(PLACEHOLDER_034);
    expect(await refusalOf(pool, MIGRATION_035)).toBe('migration_035_requires_033');
  });

  it('two players racing for one PUID: exactly one binds, the other is refused, and the table holds one row', async () => {
    const pool = await create('race', [PLACEHOLDER_034, MIGRATION_035]);
    const store = new WonderlandVoicePostgresStore(pool);
    for (let round = 0; round < 10; round += 1) {
      const puid = PUID((round % 10).toString(16).padStart(1, '0'));
      const contenders = [`racer-a-${String(round)}`, `racer-b-${String(round)}`, `racer-c-${String(round)}`];
      const outcomes = await Promise.all(contenders.map((playerId) => store.bind({ playerId, productUserId: puid, at: '2026-10-04T12:00:00.000Z' })));
      expect(outcomes.filter((outcome) => outcome.outcome === 'BIND' || outcome.outcome === 'REBIND'), `round ${String(round)}`).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome.outcome === 'REFUSED')).toHaveLength(2);
      expect((await pool.query('SELECT 1 FROM relay_wonderland.voice_identities WHERE product_user_id = $1', [puid])).rowCount).toBe(1);
      await pool.query('DELETE FROM relay_wonderland.voice_identities WHERE product_user_id = $1', [puid]);
    }
  }, 60_000);

  it('a re-bind moves the player to the new PUID, releases the old one, and keeps the history', async () => {
    const pool = await create('rebind', [PLACEHOLDER_034, MIGRATION_035]);
    const store = new WonderlandVoicePostgresStore(pool);
    expect(await store.bind({ playerId: 'ann', productUserId: PUID('1'), at: '2026-10-04T12:00:00.000Z' })).toEqual({ outcome: 'BIND', previousProductUserId: null });
    expect(await store.bind({ playerId: 'ann', productUserId: PUID('1'), at: '2026-10-04T12:01:00.000Z' })).toEqual({ outcome: 'UNCHANGED', previousProductUserId: PUID('1') });
    expect(await store.bind({ playerId: 'ann', productUserId: PUID('2'), at: '2026-10-04T12:02:00.000Z' })).toEqual({ outcome: 'REBIND', previousProductUserId: PUID('1') });
    expect(await store.bind({ playerId: 'ben', productUserId: PUID('1'), at: '2026-10-04T12:03:00.000Z' })).toEqual({ outcome: 'BIND', previousProductUserId: null });
    expect(await store.productUserIdsOf(['ann', 'ben', 'cal'])).toEqual({ ann: PUID('2'), ben: PUID('1') });
    const history = await pool.query("SELECT product_user_id FROM relay_wonderland.voice_identity_history WHERE player_id = 'ann' ORDER BY binding_seq");
    expect(history.rows.map((row) => row.product_user_id)).toEqual([PUID('1'), PUID('2')]);
  });

  it('issuances: open on issue as the identity the token admits, closed on revocation, never issued over another identity — and never a token stored', async () => {
    const pool = await create('issuance', [PLACEHOLDER_034, MIGRATION_035]);
    const store = new WonderlandVoicePostgresStore(pool);
    await store.bind({ playerId: 'ann', productUserId: PUID('a'), at: '2026-10-04T12:00:00.000Z' });
    const room = `wl_${'b'.repeat(32)}`;
    await store.recordIssuance({ playerId: 'ann', roomId: room, productUserId: PUID('a'), at: '2026-10-04T12:00:00.000Z' });
    expect(await store.openRoomsOf('ann')).toEqual([room]);
    expect(await store.openIssuancesOf('ann')).toEqual([{ roomId: room, productUserId: PUID('a') }]);
    // Ann re-binds; while her former identity still holds the room, no token is recorded over it.
    await store.bind({ playerId: 'ann', productUserId: PUID('d'), at: '2026-10-04T12:01:00.000Z' });
    await expect(store.recordIssuance({ playerId: 'ann', roomId: room, productUserId: PUID('d'), at: '2026-10-04T12:02:00.000Z' }))
      .rejects.toThrow('wonderland_voice_issuance_held');
    expect(await store.openIssuancesOf('ann'), 'nothing changed').toEqual([{ roomId: room, productUserId: PUID('a') }]);
    await store.recordRevocation({ playerId: 'ann', roomId: room, at: '2026-10-04T12:05:00.000Z' });
    expect(await store.openRoomsOf('ann')).toEqual([]);
    await store.recordIssuance({ playerId: 'ann', roomId: room, productUserId: PUID('d'), at: '2026-10-04T12:10:00.000Z' });
    expect(await store.openIssuancesOf('ann')).toEqual([{ roomId: room, productUserId: PUID('d') }]);
    const columns = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'voice_issuances' ORDER BY ordinal_position");
    expect(columns.rows.map((row) => row.column_name)).toEqual(['player_id', 'room_id', 'product_user_id', 'issued_at', 'revoked_at']);
    expect(await refusalOf(pool, `INSERT INTO relay_wonderland.voice_issuances(player_id, room_id, product_user_id, issued_at) VALUES('ann', 'not-a-room', '${PUID('a')}', now())`)).toMatch(/check constraint/u);
    expect(await refusalOf(pool, `INSERT INTO relay_wonderland.voice_issuances(player_id, room_id, product_user_id, issued_at) VALUES('ann', '${`wl_${'c'.repeat(32)}`}', 'NOT-A-PUID', now())`)).toMatch(/check constraint/u);
  });

  it('DOWN refuses to destroy voice data unless the loss is stated, then reverses cleanly', async () => {
    const pool = await create('down', [PLACEHOLDER_034, MIGRATION_035]);
    await new WonderlandVoicePostgresStore(pool).bind({ playerId: 'ann', productUserId: PUID('c'), at: '2026-10-04T12:00:00.000Z' });
    expect(await refusalOf(pool, committed('down.sql'))).toBe('migration_035_down_refused');
    expect(await refusalOf(pool, `SET relay.migration_035_down_accepts_data_loss = 'yes'; ${committed('down.sql')}`)).toBeNull();
    expect((await pool.query("SELECT 1 FROM pg_tables WHERE schemaname='relay_wonderland' AND tablename LIKE 'voice\\_%'")).rowCount).toBe(0);
    expect((await pool.query("SELECT 1 FROM relay_wonderland.schema_migrations WHERE version='035_wonderland_voice'")).rowCount).toBe(0);
  });
});
