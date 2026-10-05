import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { juliusTestDatabaseUrl } from './julius-test-database';
import {
  TransactionalWonderlandDatabase, WONDERLAND_MIGRATION_033, WONDERLAND_MIGRATION_034, WONDERLAND_MIGRATION_035, WONDERLAND_MIGRATIONS,
} from './wonderland-postgres';
import { WonderlandVoicePostgresStore } from './wonderland-voice-postgres';

/**
 * WONDERLAND VOICE ON REAL POSTGRESQL — migration 035 in the chain, after the reserved 034, and its store.
 *
 * 035 was staged until a 034 existed. With 034 reserved for the Project Brain
 * (prepared, not chosen: docs/JULIUS_MIGRATION_034_OPTIONS.md, option 4), both
 * are in the chain, and these cases hold both guards on throwaway databases:
 * 035 refuses without 033 and without a 034; 034 refuses without 033 and when
 * any 034 is already there, and changes no schema.
 *
 * Runs wherever JULIUS_TEST_DATABASE_URL names a throwaway database; `todo`
 * everywhere else, so an absent database is a skipped proof, never a passing one.
 */

const databaseUrl = juliusTestDatabaseUrl();
const suite = databaseUrl !== null ? describe : describe.todo;
const DOCS = join(__dirname, '..', '..', '..', 'docs', 'julius-migrations', '035');
const committed = (name: string): string => readFileSync(join(DOCS, name), 'utf8').replace(/^\\set ON_ERROR_STOP on\s*$/mu, '');
/** The chain as it stood before 034: everything through social. */
const THROUGH_033 = WONDERLAND_MIGRATIONS.slice(0, WONDERLAND_MIGRATIONS.indexOf(WONDERLAND_MIGRATION_033) + 1);
const PUID = (c: string): string => c.repeat(32);

suite('Wonderland voice on real PostgreSQL (migration 035, after the reserved 034)', () => {
  const nonce = randomBytes(5).toString('hex');
  let admin: Pool;
  const made: Array<{ name: string; pool: Pool }> = [];
  /** A throwaway database migrated through `chain`: the whole chain by `migrate()` itself, or a prefix of it by hand. */
  const create = async (label: string, chain: 'all' | 'through-033' = 'all'): Promise<Pool> => {
    const name = `wvoice${label}${nonce}`;
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(databaseUrl!);
    url.pathname = `/${name}`;
    const pool = new Pool({ connectionString: url.toString(), max: 8 });
    made.push({ name, pool });
    if (chain === 'all') await new TransactionalWonderlandDatabase(pool).migrate();
    else for (const sql of THROUGH_033) await pool.query(sql);
    return pool;
  };
  const tablesOf = async (pool: Pool): Promise<string[]> =>
    (await pool.query<{ t: string }>("SELECT tablename AS t FROM pg_tables WHERE schemaname='relay_wonderland' ORDER BY 1")).rows.map((row) => row.t);
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

  it('at 033, 035 refuses without a 034, changing nothing; the reserved 034 changes no schema; then 035 applies: three voice tables, no token column', async () => {
    const pool = await create('apply', 'through-033');
    expect(await refusalOf(pool, WONDERLAND_MIGRATION_035)).toBe('migration_035_requires_034');
    const at033 = await tablesOf(pool);
    expect(at033.filter((table) => table.startsWith('voice_'))).toEqual([]);
    expect(await refusalOf(pool, WONDERLAND_MIGRATION_034)).toBeNull();
    expect(await tablesOf(pool), 'the reserved 034 writes its ledger row and nothing else').toEqual(at033);
    expect(await refusalOf(pool, WONDERLAND_MIGRATION_035)).toBeNull();
    expect((await tablesOf(pool)).filter((table) => table.startsWith('voice_'))).toEqual(['voice_identities', 'voice_identity_history', 'voice_issuances']);
    expect((await pool.query("SELECT 1 FROM information_schema.columns WHERE table_schema='relay_wonderland' AND table_name LIKE 'voice\\_%' AND (column_name ILIKE '%token%' OR column_name ILIKE '%secret%')")).rowCount).toBe(0);
    expect(await refusalOf(pool, WONDERLAND_MIGRATION_035), 'a second application').toBe('migration_035_tables_exist');
  });

  it('035 refuses before 033 even with a 034 stamp; 034 refuses before 033, and when any 034 is already in the ledger', async () => {
    const pool = await create('early', 'through-033');
    await pool.query("DELETE FROM relay_wonderland.schema_migrations WHERE version = '033_wonderland_social'");
    expect(await refusalOf(pool, WONDERLAND_MIGRATION_034)).toBe('migration_034_requires_033');
    await pool.query("INSERT INTO relay_wonderland.schema_migrations(version) VALUES('034_julius_project_brain_reserved')");
    expect(await refusalOf(pool, WONDERLAND_MIGRATION_035)).toBe('migration_035_requires_033');
    const twice = await create('twice', 'through-033');
    await twice.query("INSERT INTO relay_wonderland.schema_migrations(version) VALUES('034_some_other_content')");
    expect(await refusalOf(twice, WONDERLAND_MIGRATION_034)).toBe('migration_034_already_numbered');
  });

  it('migrate() on a fresh database applies the whole chain: 034 stamped, 035\'s tables, in order', async () => {
    const pool = await create('fresh');
    const ledger = (await pool.query<{ version: string }>('SELECT version FROM relay_wonderland.schema_migrations ORDER BY version')).rows.map((row) => row.version);
    expect(ledger.slice(-3)).toEqual(['033_wonderland_social', '034_julius_project_brain_reserved', '035_wonderland_voice']);
    expect((await tablesOf(pool)).filter((table) => table.startsWith('voice_'))).toHaveLength(3);
  });

  it('two players racing for one PUID: exactly one binds, the other is refused, and the table holds one row', async () => {
    const pool = await create('race');
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
    const pool = await create('rebind');
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
    const pool = await create('issuance');
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
    const pool = await create('down');
    await new WonderlandVoicePostgresStore(pool).bind({ playerId: 'ann', productUserId: PUID('c'), at: '2026-10-04T12:00:00.000Z' });
    expect(await refusalOf(pool, committed('down.sql'))).toBe('migration_035_down_refused');
    expect(await refusalOf(pool, `SET relay.migration_035_down_accepts_data_loss = 'yes'; ${committed('down.sql')}`)).toBeNull();
    expect((await pool.query("SELECT 1 FROM pg_tables WHERE schemaname='relay_wonderland' AND tablename LIKE 'voice\\_%'")).rowCount).toBe(0);
    expect((await pool.query("SELECT 1 FROM relay_wonderland.schema_migrations WHERE version='035_wonderland_voice'")).rowCount).toBe(0);
  });
});
