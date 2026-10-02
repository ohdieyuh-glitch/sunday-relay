import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { juliusTestDatabaseUrl } from './julius-test-database';
import { WONDERLAND_MIGRATIONS, WONDERLAND_MIGRATION_030 } from './wonderland-postgres';

/**
 * MIGRATION 030 UNDER THE FOUNDER'S GATES (2026-10-02).
 *
 * 030 drops ONE foreign key on the LIVE database when it is deployed: `outbox_event_id_fkey`, whose check was a
 * serializable read of events that made two runs' appends cancel each other on a small table (row 13 (i)). The founder
 * approved it only with gates, and each one is executed here on throwaway databases:
 *   A/F  the only constraint change in relay_wonderland is that key removed; nothing else is collateral;
 *   D    030 STOPS, changing nothing, if the key is not exactly the one it replaces, is missing, or if an outbox row
 *        already names a missing event;
 *   E    afterwards no orphan exists and no row was lost;
 *   B    the committed DOWN script (docs/julius-migrations/030/down.sql) restores the identical constraint set,
 *        removes every 030 trigger and deletes the stamp.
 * Each case is its OWN database, migrated to 029 from the real migration list and seeded with events and their outbox
 * rows, then created and dropped here. Runs wherever JULIUS_TEST_DATABASE_URL names a THROWAWAY server (never
 * DATABASE_URL); `todo` elsewhere.
 */

const databaseUrl = juliusTestDatabaseUrl();
const suite = databaseUrl !== null ? describe : describe.todo;
const DOWN = readFileSync(join(__dirname, '..', '..', '..', 'docs', 'julius-migrations', '030', 'down.sql'), 'utf8')
  .replace(/^\\set ON_ERROR_STOP on\s*$/mu, ''); // a psql meta-command; the driver runs plain SQL
const BEFORE_030 = WONDERLAND_MIGRATIONS.slice(0, WONDERLAND_MIGRATIONS.indexOf(WONDERLAND_MIGRATION_030));
const ADDED_TRIGGERS = ['events_event_id_immutable', 'events_truncate_refused', 'events_written_remember', 'outbox_event_id_immutable',
  'outbox_follows_event_delete', 'outbox_requires_event_written'];

suite('migration 030 under the founder gates (row 13 (i))', () => {
  const nonce = randomBytes(5).toString('hex');
  let admin: Pool;
  const made: Array<{ name: string; pool: Pool }> = [];

  /** A fresh database at 029, with three events and their outbox rows written the way the writers write them. */
  const at029 = async (label: string): Promise<Pool> => {
    const name = `julius030${label}${nonce}`;
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(databaseUrl!);
    url.pathname = `/${name}`;
    const pool = new Pool({ connectionString: url.toString(), max: 2 });
    made.push({ name, pool });
    for (const sql of BEFORE_030) await pool.query(sql);
    await pool.query(`BEGIN;
      INSERT INTO relay_wonderland.projects(project_id) VALUES('prj-030');
      INSERT INTO relay_wonderland.events(event_id,stream_id,project_id,sequence,event_type,visibility,payload,occurred_at)
        SELECT 'event:030:' || g, 'run:030', 'prj-030', g, 'julius.worker.dispatched', 'PROJECT', '{}'::jsonb, now() FROM generate_series(1,3) g;
      INSERT INTO relay_wonderland.outbox(outbox_id,event_id,project_id) SELECT 'outbox:event:030:' || g, 'event:030:' || g, 'prj-030' FROM generate_series(1,3) g;
      COMMIT;`);
    return pool;
  };
  const constraints = async (pool: Pool): Promise<string[]> => (await pool.query(
    "SELECT conrelid::regclass::text || '|' || conname || '|' || contype || '|' || pg_get_constraintdef(oid) AS c FROM pg_constraint WHERE connamespace = 'relay_wonderland'::regnamespace ORDER BY 1",
  )).rows.map((row: { c: string }) => row.c);
  const triggers = async (pool: Pool): Promise<string[]> => (await pool.query(
    "SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('relay_wonderland.events'::regclass,'relay_wonderland.outbox'::regclass) ORDER BY 1",
  )).rows.map((row: { tgname: string }) => row.tgname);
  const state = async (pool: Pool) => (await pool.query(`SELECT
      (SELECT count(*)::int FROM relay_wonderland.events) AS events,
      (SELECT count(*)::int FROM relay_wonderland.outbox) AS outbox,
      (SELECT count(*)::int FROM relay_wonderland.outbox o WHERE NOT EXISTS (SELECT 1 FROM relay_wonderland.events e WHERE e.event_id = o.event_id)) AS orphans,
      (SELECT count(*)::int FROM relay_wonderland.schema_migrations WHERE version = '030_julius_outbox_event_no_reread') AS stamped`)).rows[0] as
      { events: number; outbox: number; orphans: number; stamped: number };
  const refusalOf030 = async (pool: Pool) => pool.query(WONDERLAND_MIGRATION_030).then(() => null, (error: unknown) => error as { message: string });

  beforeAll(async () => { admin = new Pool({ connectionString: databaseUrl! }); }, 30_000);
  afterAll(async () => {
    for (const { name, pool } of made) {
      await pool.end().catch(() => undefined);
      await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [name]).catch(() => undefined);
      await admin.query(`DROP DATABASE IF EXISTS ${name}`).catch(() => undefined);
    }
    await admin?.end().catch(() => undefined);
  });

  it('A/F + E: on a clean database 030 applies, the ONLY constraint change is outbox_event_id_fkey removed, and no row is lost', async () => {
    const pool = await at029('clean');
    const [before, rowsBefore] = [await constraints(pool), await state(pool)];
    expect(before.filter((line) => line.startsWith('relay_wonderland.outbox|outbox_event_id_fkey|f|'))).toEqual(
      ['relay_wonderland.outbox|outbox_event_id_fkey|f|FOREIGN KEY (event_id) REFERENCES relay_wonderland.events(event_id) ON DELETE CASCADE']);
    expect(await refusalOf030(pool), '030 applies').toBeNull();
    const after = await constraints(pool);
    expect(before.filter((line) => !after.includes(line)), 'removed: exactly the one key').toEqual(
      ['relay_wonderland.outbox|outbox_event_id_fkey|f|FOREIGN KEY (event_id) REFERENCES relay_wonderland.events(event_id) ON DELETE CASCADE']);
    expect(after.filter((line) => !before.includes(line)), 'added: no constraint').toEqual([]);
    expect(await triggers(pool), 'the six 030 triggers beside the existing notify trigger').toEqual([...ADDED_TRIGGERS, 'project_brain_event_notify'].sort());
    expect(await state(pool), 'no lost write, no orphan, stamped').toEqual({ ...rowsBefore, stamped: 1 });
  }, 120_000);

  it('D: an outbox row that already names a missing event makes 030 refuse; it rolls back, and the foreign key remains', async () => {
    const pool = await at029('orphan');
    await pool.query("SET session_replication_role = replica; INSERT INTO relay_wonderland.outbox(outbox_id,event_id,project_id) VALUES('outbox:orphan','event:none','prj-030'); SET session_replication_role = DEFAULT;");
    const refused = await refusalOf030(pool);
    expect(refused?.message).toContain('migration_030_refused');
    expect((await constraints(pool)).some((line) => line.startsWith('relay_wonderland.outbox|outbox_event_id_fkey|')), 'nothing was dropped').toBe(true);
    expect((await state(pool)).stamped).toBe(0);
  }, 120_000);

  it('D: a foreign key that is not exactly the one 030 replaces (no ON DELETE CASCADE), or none at all, makes 030 refuse', async () => {
    const different = await at029('different');
    await different.query('ALTER TABLE relay_wonderland.outbox DROP CONSTRAINT outbox_event_id_fkey; ALTER TABLE relay_wonderland.outbox ADD CONSTRAINT outbox_event_id_fkey FOREIGN KEY (event_id) REFERENCES relay_wonderland.events(event_id);');
    expect((await refusalOf030(different))?.message).toContain('migration_030_refused');
    const missing = await at029('missing');
    await missing.query('ALTER TABLE relay_wonderland.outbox DROP CONSTRAINT outbox_event_id_fkey;');
    expect((await refusalOf030(missing))?.message).toContain('migration_030_refused');
    expect([(await state(different)).stamped, (await state(missing)).stamped]).toEqual([0, 0]);
  }, 180_000);

  it('B: the committed DOWN script restores the identical constraint set, removes every 030 trigger, and deletes the stamp', async () => {
    const pool = await at029('down');
    const [before, triggersBefore] = [await constraints(pool), await triggers(pool)];
    expect(await refusalOf030(pool)).toBeNull();
    await pool.query(DOWN);
    expect(await constraints(pool), 'identical to before 030').toEqual(before);
    expect(await triggers(pool), 'only what was there before 030').toEqual(triggersBefore);
    expect((await state(pool)).stamped).toBe(0);
  }, 120_000);
});
