import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { JuliusOperationalEvent } from '../mission/julius';
import { appendJuliusEventWithin, type JuliusEventTransaction } from './julius-event-postgres';
import { JULIUS_PLAN_PIN } from './julius-serializable';
import { juliusTestDatabaseUrl } from './julius-test-database';
import { TransactionalWonderlandDatabase, WONDERLAND_MIGRATIONS, WONDERLAND_MIGRATION_030, WONDERLAND_MIGRATION_031 } from './wonderland-postgres';

/**
 * MIGRATION 031: A RUN'S UPDATE IS A HOT UPDATE (row 13 (i), what 030 and the plan pin left).
 *
 * `julius_run_project_state (project_id, state, created_at)` held `state`, so a run's transition was never a heap-only
 * (HOT) update: it inserted an entry into every index of julius_runs, the primary key's included, and under SERIALIZABLE
 * that insert met the predicate lock another run's read held on the same leaf page. 031 re-keys the index as
 * (project_id, created_at). Each case is its OWN database, created and dropped here, migrated to 030 from the real
 * migration list (or by the product's migrate()):
 *   A      on a clean database 031 applies; julius_runs ends with exactly its three indexes; the only index change in
 *          the schema is the run index re-keyed; no constraint or row changes; it is stamped. migrate() carries it;
 *   HOT    the product's own run updates, read verbatim from their source, are all HOT after 031, and the same workload
 *          before 031 is not (the control: the counter can fail);
 *   C      031 refuses, changing nothing, when the index it replaces is not exactly 011's, is missing, or the new name is
 *          taken; and its post-check refuses, rolling everything back, when another index would still hold a column a
 *          run update changes (as a key column, in an expression, or in a partial index's predicate);
 *   D      the committed DOWN script restores the identical index set and removes the stamp, and refuses where 031 is
 *          not applied;
 *   CYCLE  two runs' transitions that each read their run before either writes, under the plan pin: before 031 one is
 *          cancelled with 40001; with 031 both commit.
 * Runs wherever JULIUS_TEST_DATABASE_URL names a THROWAWAY server (never DATABASE_URL); `todo` elsewhere.
 */

const databaseUrl = juliusTestDatabaseUrl();
const suite = databaseUrl !== null ? describe : describe.todo;
const DOWN = readFileSync(join(__dirname, '..', '..', '..', 'docs', 'julius-migrations', '031', 'down.sql'), 'utf8')
  .replace(/^\\set ON_ERROR_STOP on\s*$/mu, ''); // a psql meta-command; the driver runs plain SQL
const BEFORE_031 = WONDERLAND_MIGRATIONS.slice(0, WONDERLAND_MIGRATIONS.indexOf(WONDERLAND_MIGRATION_031));
const OLD_INDEX = 'CREATE INDEX julius_run_project_state ON relay_wonderland.julius_runs USING btree (project_id, state, created_at)';
const NEW_INDEX = 'CREATE INDEX julius_run_project_created ON relay_wonderland.julius_runs USING btree (project_id, created_at)';
/** julius_runs after 031, by definition: its primary key, its (mission_id, run_id) key and the re-keyed run index. */
const RUN_INDEXES_AFTER_031 = [
  NEW_INDEX,
  'CREATE UNIQUE INDEX julius_runs_mission_id_run_id_key ON relay_wonderland.julius_runs USING btree (mission_id, run_id)',
  'CREATE UNIQUE INDEX julius_runs_pkey ON relay_wonderland.julius_runs USING btree (run_id)',
].sort();

/** The product's statements on julius_runs that these cases run, each with the file it is read from verbatim. */
const TRANSITION = {
  file: 'julius-postgres.ts',
  sql: 'UPDATE relay_wonderland.julius_runs SET state=$2,version=version+1,updated_at=$3 WHERE run_id=$1 AND version=$4 RETURNING *',
};
const LIFECYCLE = {
  file: 'julius-lifecycle-postgres.ts',
  sql: `UPDATE relay_wonderland.julius_runs
          SET lifecycle_reason=$3,lifecycle_actor=$4,lifecycle_at=$5
        WHERE run_id=$1 AND project_id=$2`,
};
const RUN_READ = {
  file: 'julius-lifecycle-postgres.ts',
  sql: 'SELECT state,version,mission_id FROM relay_wonderland.julius_runs WHERE run_id=$1 AND project_id=$2 FOR UPDATE',
};

type Seeded = { pool: Pool; runs: string[]; project: string };
type Outcome = 'COMMITTED' | { code: string | undefined; message: string };
const outcomeOf = (error: unknown): Outcome => ({ code: (error as { code?: string }).code, message: (error as Error).message });
const plain = (client: PoolClient): JuliusEventTransaction => ({ query: (sql, values) => client.query(sql, values as unknown[] | undefined) });

suite('migration 031: a run update is a HOT update (row 13 (i))', () => {
  const nonce = randomBytes(5).toString('hex');
  let admin: Pool;
  const made: Array<{ name: string; pool: Pool }> = [];

  const create = async (label: string): Promise<Pool> => {
    const name = `julius031${label}${nonce}`;
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(databaseUrl!);
    url.pathname = `/${name}`;
    const pool = new Pool({ connectionString: url.toString(), max: 4 });
    made.push({ name, pool });
    return pool;
  };
  /** A fresh database at 030, from the real migration list, with one project, one mission and `count` runs. */
  const at030 = async (label: string, count = 3): Promise<Seeded> => {
    const pool = await create(label);
    for (const sql of BEFORE_031) await pool.query(sql);
    const project = `prj-031-${label}`;
    const mission = `mission-031-${label}`;
    await pool.query('INSERT INTO relay_wonderland.projects(project_id) VALUES($1)', [project]);
    await pool.query(
      "INSERT INTO relay_wonderland.mission_contracts(mission_id,project_id,stage,canonical_hash,snapshot) VALUES($1,$2,'READY',$3,'{}'::jsonb)",
      [mission, project, `031:${label}:${nonce}`],
    );
    const runs: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const run = `run:031-${label}-${index}`;
      await pool.query(
        "INSERT INTO relay_wonderland.julius_runs(run_id,mission_id,project_id,state,runtime_version,card_revision,mission_contract_revision,project_brain_revision) VALUES($1,$2,$3,'EXECUTING','031','card',1,0)",
        [run, mission, project],
      );
      runs.push(run);
    }
    return { pool, runs, project };
  };
  // Sorted here, not by ORDER BY: that follows the database's collation.
  const runIndexes = async (pool: Pool): Promise<string[]> => (await pool.query(
    "SELECT pg_get_indexdef(indexrelid) AS d FROM pg_index WHERE indrelid = 'relay_wonderland.julius_runs'::regclass",
  )).rows.map((row: { d: string }) => row.d).sort();
  const schemaIndexes = async (pool: Pool): Promise<string[]> => (await pool.query(
    "SELECT pg_get_indexdef(i.indexrelid) AS d FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relnamespace = 'relay_wonderland'::regnamespace",
  )).rows.map((row: { d: string }) => row.d).sort();
  const constraints = async (pool: Pool): Promise<string[]> => (await pool.query(
    "SELECT conrelid::regclass::text || '|' || conname || '|' || contype::text || '|' || pg_get_constraintdef(oid) AS c FROM pg_constraint WHERE connamespace = 'relay_wonderland'::regnamespace",
  )).rows.map((row: { c: string }) => row.c).sort();
  const runRows = async (pool: Pool) => (await pool.query(
    'SELECT run_id, state, version::int AS version, updated_at FROM relay_wonderland.julius_runs ORDER BY run_id',
  )).rows;
  const stamped = async (pool: Pool): Promise<number> => (await pool.query(
    "SELECT count(*)::int AS n FROM relay_wonderland.schema_migrations WHERE version = '031_julius_run_transition_hot'",
  )).rows[0].n as number;
  const refusalOf = async (pool: Pool, sql: string) => pool.query(sql).then(() => null, (error: unknown) => error as { message: string });

  /** julius_runs' update counters once at least `expected` updates are visible (statistics are flushed asynchronously). */
  const updateCounters = async (client: PoolClient, expected: number): Promise<{ updates: number; hot: number }> => {
    const flushes = (await client.query("SELECT to_regproc('pg_stat_force_next_flush') IS NOT NULL AS f")).rows[0].f as boolean;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (flushes) await client.query('SELECT pg_stat_force_next_flush()');
      const row = (await client.query(
        "SELECT n_tup_upd::int AS updates, n_tup_hot_upd::int AS hot FROM pg_stat_user_tables WHERE relid = 'relay_wonderland.julius_runs'::regclass",
      )).rows[0] as { updates: number; hot: number };
      if (row.updates >= expected) return row;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`the julius_runs update counter never reached ${expected}`);
  };

  beforeAll(async () => { admin = new Pool({ connectionString: databaseUrl! }); }, 30_000);
  afterAll(async () => {
    for (const { name, pool } of made) {
      // pool.end() resolves before its idle clients have closed (pg-pool 3.14's _remove() does not await client.end()),
      // so the terminate below can reach a client that is still closing, and pg-pool re-emits that 57P01 as the pool's
      // 'error' (julius-migration-030's teardown, CI 2026-10-03; here in CI on 2026-10-07). The terminate is this suite's
      // own teardown.
      pool.on('error', () => undefined);
      await pool.end().catch(() => undefined);
      await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [name]).catch(() => undefined);
      await admin.query(`DROP DATABASE IF EXISTS ${name}`).catch(() => undefined);
    }
    await admin?.end().catch(() => undefined);
    // An explicit bound: this loop ends, terminates and drops one database per case, which can outlast vitest's default
    // 10_000 ms for a hook on a loaded runner (032's timed out in CI on 2026-10-07; every case passed).
  }, 60_000);

  it('A: on a clean database at 030, 031 applies; julius_runs ends with exactly its three indexes, the only index change is the run index re-keyed, and no constraint or row changes', async () => {
    const { pool } = await at030('clean');
    const [indexesBefore, constraintsBefore, rowsBefore] = [await schemaIndexes(pool), await constraints(pool), await runRows(pool)];
    expect(indexesBefore).toContain(OLD_INDEX);
    expect(await refusalOf(pool, WONDERLAND_MIGRATION_031), '031 applies').toBeNull();
    const indexesAfter = await schemaIndexes(pool);
    expect(indexesBefore.filter((line) => !indexesAfter.includes(line)), 'removed: exactly the old run index').toEqual([OLD_INDEX]);
    expect(indexesAfter.filter((line) => !indexesBefore.includes(line)), 'added: exactly the re-keyed one').toEqual([NEW_INDEX]);
    expect(await runIndexes(pool), 'julius_runs, exactly').toEqual(RUN_INDEXES_AFTER_031);
    expect(await constraints(pool), 'no constraint changed').toEqual(constraintsBefore);
    expect(await runRows(pool), 'no row changed').toEqual(rowsBefore);
    expect(await stamped(pool)).toBe(1);
  }, 120_000);

  it('A, THE CHAIN: the product’s migrate() carries 031 after 030, so a new database has exactly the 031 run indexes and its stamp', async () => {
    expect(WONDERLAND_MIGRATIONS.indexOf(WONDERLAND_MIGRATION_031), 'listed after 030').toBeGreaterThan(WONDERLAND_MIGRATIONS.indexOf(WONDERLAND_MIGRATION_030));
    const pool = await create('chain');
    await new TransactionalWonderlandDatabase(pool).migrate();
    expect(await runIndexes(pool)).toEqual(RUN_INDEXES_AFTER_031);
    expect(await stamped(pool)).toBe(1);
  }, 120_000);

  it('HOT: after 031 every product update of a run is a HOT update; before 031 its transitions are not (the control: the counter can fail)', async () => {
    for (const statement of [TRANSITION, LIFECYCLE]) {
      expect(readFileSync(join(__dirname, statement.file), 'utf8'), `${statement.file} still runs: ${statement.sql}`).toContain(statement.sql);
    }
    const workload = async ({ pool, runs, project }: Seeded) => {
      const client = await pool.connect();
      try {
        const base = await updateCounters(client, 0);
        // Each statement its own transaction, as the product runs it: four transitions and a lifecycle record per run.
        for (const run of runs) {
          for (const [step, state] of ['PLANNING', 'READY', 'EXECUTING', 'REVIEWING'].entries()) {
            const moved = await client.query(TRANSITION.sql, [run, state, `2099-01-01T00:00:0${step}.000Z`, step + 1]);
            expect(moved.rowCount, `${run} moved to ${state}`).toBe(1);
          }
          const recorded = await client.query(LIFECYCLE.sql, [run, project, 'hot proof', 'migration-031-suite', '2099-01-01T00:01:00.000Z']);
          expect(recorded.rowCount, `${run} lifecycle recorded`).toBe(1);
        }
        const total = await updateCounters(client, base.updates + runs.length * 5);
        return { updates: total.updates - base.updates, hot: total.hot - base.hot };
      } finally {
        client.release();
      }
    };
    const before = await at030('hot030');
    const after = await at030('hot031');
    expect(await refusalOf(after.pool, WONDERLAND_MIGRATION_031)).toBeNull();
    expect(await workload(before), 'CONTROL, before 031: the 12 transitions are not HOT (state is indexed); the 3 lifecycle records are')
      .toEqual({ updates: 15, hot: 3 });
    expect(await workload(after), 'with 031: all 15 are HOT').toEqual({ updates: 15, hot: 15 });
  }, 180_000);

  it('C: 031 refuses, changing nothing, when julius_run_project_state is not exactly 011’s index (other columns, or none), or the new name is taken', async () => {
    const cases: Array<[string, string]> = [
      ['reordered', 'DROP INDEX relay_wonderland.julius_run_project_state; CREATE INDEX julius_run_project_state ON relay_wonderland.julius_runs(project_id,created_at,state)'],
      ['fewer', 'DROP INDEX relay_wonderland.julius_run_project_state; CREATE INDEX julius_run_project_state ON relay_wonderland.julius_runs(project_id,created_at)'],
      ['missing', 'DROP INDEX relay_wonderland.julius_run_project_state'],
      ['taken', 'CREATE INDEX julius_run_project_created ON relay_wonderland.julius_runs(project_id)'],
    ];
    for (const [label, tamper] of cases) {
      const { pool } = await at030(label);
      await pool.query(tamper);
      const [indexesBefore, constraintsBefore] = [await schemaIndexes(pool), await constraints(pool)];
      expect((await refusalOf(pool, WONDERLAND_MIGRATION_031))?.message, label).toContain('migration_031_refused');
      expect(await schemaIndexes(pool), `${label}: no index changed`).toEqual(indexesBefore);
      expect(await constraints(pool), `${label}: no constraint changed`).toEqual(constraintsBefore);
      expect(await stamped(pool), `${label}: not stamped`).toBe(0);
    }
  }, 300_000);

  it('C, THE POST-CHECK: another index that would still hold a column a run update changes makes 031 refuse after its change, and roll all of it back', async () => {
    const cases: Array<[string, string, string]> = [
      ['keyed', 'CREATE INDEX julius_runs_extra_state ON relay_wonderland.julius_runs(state)', 'julius_runs_extra_state.state'],
      ['partial', "CREATE INDEX julius_runs_extra_partial ON relay_wonderland.julius_runs(project_id) WHERE state = 'EXECUTING'", 'julius_runs_extra_partial.state'],
      ['expression', 'CREATE INDEX julius_runs_extra_expression ON relay_wonderland.julius_runs((lower(lifecycle_actor)))', 'julius_runs_extra_expression.lifecycle_actor'],
    ];
    for (const [label, extra, named] of cases) {
      const { pool } = await at030(label);
      await pool.query(extra);
      const indexesBefore = await schemaIndexes(pool);
      const refused = await refusalOf(pool, WONDERLAND_MIGRATION_031);
      expect(refused?.message, label).toContain('migration_031_postcheck');
      expect(refused?.message, `${label}: it names the index and the column`).toContain(named);
      expect(await schemaIndexes(pool), `${label}: rolled back, the old run index included`).toEqual(indexesBefore);
      expect(await stamped(pool), `${label}: not stamped`).toBe(0);
    }
  }, 240_000);

  it('D: the committed DOWN script restores the identical index set and removes the stamp; it refuses where 031 is not applied', async () => {
    const { pool } = await at030('down');
    const [indexesBefore, constraintsBefore] = [await schemaIndexes(pool), await constraints(pool)];
    expect(await refusalOf(pool, WONDERLAND_MIGRATION_031)).toBeNull();
    expect(await runIndexes(pool)).toEqual(RUN_INDEXES_AFTER_031);
    expect(await refusalOf(pool, DOWN), 'DOWN applies').toBeNull();
    expect(await schemaIndexes(pool), 'identical to before 031, by definition').toEqual(indexesBefore);
    expect(await constraints(pool)).toEqual(constraintsBefore);
    expect(await stamped(pool)).toBe(0);
    expect((await refusalOf(pool, DOWN))?.message, 'DOWN where 031 is not applied').toContain('migration_031_down_refused');
  }, 120_000);

  it('CYCLE: two runs’ transitions that each read their run before either writes, under the plan pin: before 031 one is cancelled with 40001; with 031 both commit', async () => {
    expect(readFileSync(join(__dirname, RUN_READ.file), 'utf8'), `${RUN_READ.file} still runs: ${RUN_READ.sql}`).toContain(RUN_READ.sql);
    const event = (runId: string, projectId: string): JuliusOperationalEvent => ({
      eventId: `event:run.transitioned:${randomUUID()}`, runId, projectId, type: 'run.transitioned', taskId: `${runId}:build`,
      workerId: 'coding-agent', correlationId: `${runId}:build:1`, causationId: null, occurredAt: '2099-01-01T00:00:00.000Z', facts: { attempt: 1 },
    });
    /** S0 as the plan-pin suite builds it: eight runs on one page, analyzed once, autovacuum off on the tables involved. */
    const s0 = async (label: string, migrateTo031: boolean): Promise<Seeded> => {
      const seeded = await at030(label, 8);
      if (migrateTo031) expect(await refusalOf(seeded.pool, WONDERLAND_MIGRATION_031)).toBeNull();
      for (const table of ['events', 'outbox', 'stream_sequences', 'julius_runs', 'projects']) {
        await seeded.pool.query(`ALTER TABLE relay_wonderland.${table} SET (autovacuum_enabled = false)`);
        await seeded.pool.query(`ANALYZE relay_wonderland.${table}`);
      }
      return seeded;
    };
    /** Step by step on two connections: read each run, each transition, each run.transitioned event, then A and B commit. */
    const pair = async ({ pool, runs, project }: Seeded) => {
      const clients = { a: await pool.connect(), b: await pool.connect() };
      const runOf = { a: runs[5]!, b: runs[6]! };
      const versionOf = { a: 0, b: 0 };
      const outcomes: Record<'a' | 'b', Outcome> = { a: 'COMMITTED', b: 'COMMITTED' };
      const each = async (work: (who: 'a' | 'b', client: PoolClient, run: string) => Promise<unknown>) => {
        for (const who of ['a', 'b'] as const) {
          if (outcomes[who] !== 'COMMITTED') continue;
          try { await work(who, clients[who], runOf[who]); } catch (error) {
            outcomes[who] = outcomeOf(error);
            await clients[who].query('ROLLBACK').catch(() => undefined);
          }
        }
      };
      try {
        await each(async (_who, client) => { await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE'); await client.query(JULIUS_PLAN_PIN); });
        await each(async (who, client, run) => { versionOf[who] = Number((await client.query(RUN_READ.sql, [run, project])).rows[0].version); });
        await each(async (who, client, run) => {
          const moved = await client.query(TRANSITION.sql, [run, 'REVIEWING', '2099-01-01T00:00:00.000Z', versionOf[who]]);
          if (moved.rowCount !== 1) throw new Error(`${run} did not move`);
        });
        await each((_who, client, run) => appendJuliusEventWithin(plain(client), event(run, project)));
        await each(async (_who, client) => { await client.query('COMMIT'); });
        return outcomes;
      } finally {
        clients.a.release();
        clients.b.release();
      }
    };
    const before = await pair(await s0('cycle030', false));
    expect(Object.values(before).filter((outcome) => outcome === 'COMMITTED').length, 'CONTROL, before 031: exactly one commits').toBe(1);
    expect(Object.values(before).find((outcome) => outcome !== 'COMMITTED'), 'and the other is a serialization failure').toMatchObject({ code: '40001' });
    expect(await pair(await s0('cycle031', true)), 'with 031: both commit').toEqual({ a: 'COMMITTED', b: 'COMMITTED' });
  }, 180_000);
});
