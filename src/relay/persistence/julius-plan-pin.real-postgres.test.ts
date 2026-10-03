import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { JuliusOperationalEvent } from '../mission/julius';
import { appendJuliusEventWithin, type JuliusEventTransaction } from './julius-event-postgres';
import { JULIUS_PLAN_PIN, juliusSerializable } from './julius-serializable';
import { juliusTestDatabaseUrl } from './julius-test-database';
import { TransactionalWonderlandDatabase } from './wonderland-postgres';

/**
 * ROW 13 (i), THE THIRD MECHANISM: A READ OF ONE RUN MUST NOT LOCK EVERY RUN.
 *
 * Measured on the fixed append (2026-10-03, stack 1ccc5d18, throwaway PostgreSQL 16.15): with M1 and M2 gone, the
 * 8-writer stress still cancelled 78-81 transactions per run and exhausted the retries of two run transitions, and
 * what it left traced to sequential-scan reads of small tables, `julius_runs` chief among them: the only write-time
 * pivot left was a transition's UPDATE of it. On a fresh database (S0: every CI job, every paid run) that table holds
 * a few rows on one page, so the planner reads it SEQUENTIALLY: the append's ownership read, a transition's own
 * UPDATE, every foreign key that names a run. Under SERIALIZABLE a sequential scan locks the whole relation and reads
 * every run's row, so two transactions on two different runs that overlap form a read/write cycle.
 *
 * `juliusSerializable` sets `JULIUS_PLAN_PIN` at the start of every attempt: index scans, and a fresh plan per
 * execution. These cases measure, in the S0 state itself, what that buys and what it does not:
 *   - PIN-1: the run-ownership read, through `juliusSerializable`, locks one index page and one row, not the relation;
 *   - PIN-2: a foreign-key check of julius_runs, on a connection whose CACHED plan for it is a sequential scan;
 *   - PIN-3: the product's own run statements, read verbatim from their source, plan as index scans;
 *   - PIN-4: two runs' transitions interleaved as the stress lost them: unpinned one is cancelled, pinned both commit;
 *   - PIN-5, THE RESIDUAL: two transitions that each READ their run before either WRITES still meet on the run
 *     index's leaf page (`state` is indexed, so a transition is never a HOT update), and one is cancelled even pinned.
 *
 * ITS OWN DATABASE, created and dropped here, autovacuum off on the tables involved, ANALYZED once after its eight
 * runs exist (S0, as the stress builds it). Runs wherever JULIUS_TEST_DATABASE_URL names a THROWAWAY server (never
 * DATABASE_URL); `todo` elsewhere.
 */

const databaseUrl = juliusTestDatabaseUrl();
const suite = databaseUrl !== null ? describe : describe.todo;

const TABLES = ['events', 'outbox', 'stream_sequences', 'julius_runs', 'projects', 'julius_acceptance_criteria'];
const RUNS_RELATION = 'relation:relay_wonderland.julius_runs';

/** The product's statements on julius_runs that a run's writes go through, each with the file it is read from. */
const RUN_STATEMENTS: readonly { file: string; sql: string; values: (run: string, project: string) => unknown[] }[] = [
  { file: 'julius-event-postgres.ts', sql: 'SELECT 1 FROM relay_wonderland.julius_runs WHERE run_id=$1 AND project_id=$2 FOR UPDATE', values: (run, project) => [run, project] },
  { file: 'julius-postgres.ts', sql: 'UPDATE relay_wonderland.julius_runs SET state=$2,version=version+1,updated_at=$3 WHERE run_id=$1 AND version=$4 RETURNING *', values: (run) => [run, 'REVIEWING', '2099-01-01T00:00:00.000Z', 1] },
  { file: 'julius-postgres.ts', sql: 'SELECT * FROM relay_wonderland.julius_runs WHERE run_id=$1 AND project_id=$2 FOR UPDATE', values: (run, project) => [run, project] },
  { file: 'julius-lifecycle-postgres.ts', sql: 'SELECT state,version,mission_id FROM relay_wonderland.julius_runs WHERE run_id=$1 AND project_id=$2 FOR UPDATE', values: (run, project) => [run, project] },
  { file: 'julius-repair-postgres.ts', sql: 'SELECT state FROM relay_wonderland.julius_runs WHERE run_id=$1 AND project_id=$2 FOR UPDATE', values: (run, project) => [run, project] },
];
/** The stress's transition (row13i/stress.cjs): the run's state flips and its event is written, in one transaction. */
const STRESS_TRANSITION = 'UPDATE relay_wonderland.julius_runs SET state=$2,version=version+1,updated_at=now() WHERE run_id=$1';

type Outcome = 'COMMITTED' | { code: string | undefined; message: string };
const outcomeOf = (error: unknown): Outcome => ({ code: (error as { code?: string }).code, message: (error as Error).message });
const plain = (client: PoolClient): JuliusEventTransaction => ({ query: (sql, values) => client.query(sql, values as unknown[] | undefined) });

/** Every scan of a relation in an EXPLAIN (FORMAT JSON) plan, as `<node type> on <relation>`. */
const scansOf = (plan: unknown): string[] => {
  const scans: string[] = [];
  const walk = (node: Record<string, unknown>) => {
    if (typeof node['Relation Name'] === 'string' && String(node['Node Type']).includes('Scan')) scans.push(`${String(node['Node Type'])} on ${node['Relation Name']}`);
    for (const child of (node['Plans'] as Record<string, unknown>[] | undefined) ?? []) walk(child);
  };
  walk((plan as { Plan: Record<string, unknown> }[])[0]!.Plan);
  return scans;
};

suite('the plan pin: under SERIALIZABLE, a read of one run locks one run (row 13 (i), the third mechanism)', () => {
  const nonce = randomBytes(6).toString('hex');
  const database = `juliuspin${nonce}`;
  const project = `prj-pin-${nonce}`;
  const mission = `mission-pin-${nonce}`;
  const runs: string[] = [];
  let admin: Pool;
  let pool: Pool;

  const urlOf = () => { const url = new URL(databaseUrl!); url.pathname = `/${database}`; return url.toString(); };
  const event = (runId: string): JuliusOperationalEvent => ({
    eventId: `event:run.transitioned:${randomUUID()}`, runId, projectId: project, type: 'run.transitioned', taskId: `${runId}:build`,
    workerId: 'coding-agent', correlationId: `${runId}:build:1`, causationId: null, occurredAt: '2099-01-01T00:00:00.000Z', facts: { attempt: 1 },
  });
  const pidOf = async (client: PoolClient): Promise<number> => Number((await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
  /** The SIREAD locks a backend holds, read from another connection while its transaction is open. */
  const sireadOf = async (pid: number): Promise<string[]> => (await pool.query(
    "SELECT locktype, relation::regclass::text AS rel FROM pg_locks WHERE pid=$1 AND mode='SIReadLock' ORDER BY 1, 2", [pid],
  )).rows.map((row: { locktype: string; rel: string }) => `${row.locktype}:${row.rel}`);

  /**
   * Two runs' transitions, step by step on two connections, each in its own SERIALIZABLE transaction opened with or
   * without the pin: [read each run first,] each UPDATE, each run.transitioned event, then A commits and B commits.
   */
  const pair = async (pin: string | null, readFirst: boolean, runA: string, runB: string) => {
    const clients = { a: await pool.connect(), b: await pool.connect() };
    const runOf = { a: runA, b: runB };
    const outcomes: Record<'a' | 'b', Outcome> = { a: 'COMMITTED', b: 'COMMITTED' };
    const each = async (work: (client: PoolClient, run: string) => Promise<unknown>) => {
      for (const who of ['a', 'b'] as const) {
        if (outcomes[who] !== 'COMMITTED') continue;
        try { await work(clients[who], runOf[who]); } catch (error) {
          outcomes[who] = outcomeOf(error);
          await clients[who].query('ROLLBACK').catch(() => undefined);
        }
      }
    };
    try {
      await each(async (client) => { await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE'); if (pin !== null) await client.query(pin); });
      if (readFirst) await each((client, run) => client.query(RUN_STATEMENTS[3]!.sql, RUN_STATEMENTS[3]!.values(run, project)));
      await each((client, run) => client.query(STRESS_TRANSITION, [run, 'REVIEWING']));
      await each((client, run) => appendJuliusEventWithin(plain(client), event(run)));
      await each((client) => client.query('COMMIT'));
      return outcomes;
    } finally {
      clients.a.release();
      clients.b.release();
    }
  };
  const committed = (outcomes: Record<'a' | 'b', Outcome>) => Object.values(outcomes).filter((outcome) => outcome === 'COMMITTED').length;
  const failure = (outcomes: Record<'a' | 'b', Outcome>) => Object.values(outcomes).find((outcome) => outcome !== 'COMMITTED');

  beforeAll(async () => {
    admin = new Pool({ connectionString: databaseUrl! });
    await admin.query(`CREATE DATABASE ${database}`);
    pool = new Pool({ connectionString: urlOf(), max: 8 });
    await new TransactionalWonderlandDatabase(pool).migrate();
    // Experimental control, in this database only: no ANALYZE may move the planner out of S0.
    for (const table of TABLES) await pool.query(`ALTER TABLE relay_wonderland.${table} SET (autovacuum_enabled = false)`);
    await pool.query('INSERT INTO relay_wonderland.projects(project_id) VALUES($1)', [project]);
    await pool.query(
      "INSERT INTO relay_wonderland.mission_contracts(mission_id,project_id,stage,canonical_hash,snapshot) VALUES($1,$2,'READY',$3,'{}'::jsonb)",
      [mission, project, `pin:${nonce}`],
    );
    for (let index = 0; index < 8; index += 1) {
      const run = `run:pin-${index}-${randomBytes(4).toString('hex')}`;
      await pool.query(
        "INSERT INTO relay_wonderland.julius_runs(run_id,mission_id,project_id,state,runtime_version,card_revision,mission_contract_revision,project_brain_revision) VALUES($1,$2,$3,'EXECUTING','pin','card',1,0)",
        [run, mission, project],
      );
      runs.push(run);
    }
    // S0 as the stress builds it: the eight runs, then ANALYZE, and nothing analyzes again.
    for (const table of TABLES) await pool.query(`ANALYZE relay_wonderland.${table}`);
  }, 120_000);

  afterAll(async () => {
    // pool.end() resolves before its idle clients have closed (pg-pool 3.14's _remove() does not await client.end()),
    // so the terminate below can reach a client that is still closing, and pg-pool re-emits that 57P01 as the pool's
    // 'error': with no listener, an unhandled error that fails the run (CI, 2026-10-03). The terminate is this
    // suite's own teardown, so its echo is expected here and nowhere else.
    pool?.on('error', () => undefined);
    await pool?.end().catch(() => undefined);
    if (admin !== undefined) {
      await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [database]).catch(() => undefined);
      await admin.query(`DROP DATABASE IF EXISTS ${database}`).catch(() => undefined);
      await admin.end().catch(() => undefined);
    }
  });

  it('S0 HOLDS: julius_runs is analyzed with its eight runs on one page, and unpinned, the run-ownership read is a sequential scan', async () => {
    const stats = (await pool.query("SELECT reltuples, relpages FROM pg_class WHERE oid='relay_wonderland.julius_runs'::regclass")).rows[0];
    expect([Number(stats.reltuples), Number(stats.relpages)]).toEqual([8, 1]);
    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const plan = (await client.query(`EXPLAIN (FORMAT JSON) ${RUN_STATEMENTS[0]!.sql}`, RUN_STATEMENTS[0]!.values(runs[0]!, project))).rows[0]['QUERY PLAN'];
      expect(scansOf(plan)).toEqual(['Seq Scan on julius_runs']);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  });

  it('PIN-1: the run-ownership read, through juliusSerializable, locks one index page and one row of julius_runs, never the relation', async () => {
    const control = await pool.connect();
    let unpinned: string[];
    try {
      await control.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await control.query(RUN_STATEMENTS[0]!.sql, RUN_STATEMENTS[0]!.values(runs[0]!, project));
      unpinned = await sireadOf(await pidOf(control));
    } finally {
      await control.query('ROLLBACK').catch(() => undefined);
      control.release();
    }
    expect(unpinned, 'CONTROL: unpinned, in S0, the read locks the whole relation (the M3 lock)').toContain(RUNS_RELATION);

    const pinned = await juliusSerializable(pool, async (client) => {
      await client.query(RUN_STATEMENTS[0]!.sql, RUN_STATEMENTS[0]!.values(runs[0]!, project));
      return sireadOf(await pidOf(client));
    }, { attempts: 1 });
    expect(pinned, 'pinned: not the relation').not.toContain(RUNS_RELATION);
    expect(pinned, 'pinned: the index page it searched, and the row it returned')
      .toEqual(expect.arrayContaining(['page:relay_wonderland.julius_runs_pkey', 'tuple:relay_wonderland.julius_runs']));
  });

  it('PIN-2: a foreign-key check of julius_runs, on a connection whose cached plan for it is a sequential scan, locks no relation under the pin', async () => {
    // ONE backend: PostgreSQL caches a foreign key's check plan per connection.
    const single = new Pool({ connectionString: urlOf(), max: 1 });
    const run = runs[1]!;
    let ordinal = 0;
    const insertCriterion = (client: PoolClient) => client.query(
      "INSERT INTO relay_wonderland.julius_acceptance_criteria(criterion_id,run_id,description,required_evidence_types,ordinal) VALUES($1,$2,'pin','[]'::jsonb,$3)",
      [`criterion:pin:${randomUUID()}`, run, ordinal++],
    );
    const insertUnder = async (setting: string | null): Promise<string[]> => {
      const client = await single.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        if (setting !== null) await client.query(setting);
        await insertCriterion(client);
        const locks = await sireadOf(await pidOf(client));
        await client.query('COMMIT');
        return locks;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    };
    try {
      // Five custom plans, then PostgreSQL caches the generic one: on an eight-row table, a sequential scan.
      for (let warm = 0; warm < 6; warm += 1) await insertUnder(null);
      expect(await insertUnder(null), 'CONTROL: the cached check plan locks the whole relation').toContain(RUNS_RELATION);
      expect(await insertUnder('SET LOCAL enable_seqscan = off'),
        'enable_seqscan alone never reaches a cached plan: why the pin also sets plan_cache_mode').toContain(RUNS_RELATION);
      const pinned = await juliusSerializable(single, async (client) => {
        await insertCriterion(client);
        return sireadOf(await pidOf(client));
      }, { attempts: 1 });
      expect(pinned, 'pinned: the check is planned again, by the primary key').not.toContain(RUNS_RELATION);
      expect(pinned).toEqual(expect.arrayContaining(['page:relay_wonderland.julius_runs_pkey']));
    } finally {
      await single.end().catch(() => undefined);
    }
  });

  it('PIN-3: the product’s own run statements, read verbatim from their source, plan as index scans pinned and as sequential scans unpinned', async () => {
    for (const statement of RUN_STATEMENTS) {
      expect(readFileSync(join(process.cwd(), 'src/relay/persistence', statement.file), 'utf8'), `${statement.file} still runs: ${statement.sql}`).toContain(statement.sql);
    }
    const scansUnder = async (pin: string | null): Promise<string[][]> => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        if (pin !== null) await client.query(pin);
        const plans: string[][] = [];
        for (const statement of RUN_STATEMENTS) {
          plans.push(scansOf((await client.query(`EXPLAIN (FORMAT JSON) ${statement.sql}`, statement.values(runs[2]!, project))).rows[0]['QUERY PLAN']));
        }
        return plans;
      } finally {
        await client.query('ROLLBACK').catch(() => undefined);
        client.release();
      }
    };
    for (const [index, scans] of (await scansUnder(null)).entries()) {
      expect(scans, `CONTROL, unpinned: ${RUN_STATEMENTS[index]!.sql}`).toContain('Seq Scan on julius_runs');
    }
    for (const [index, scans] of (await scansUnder(JULIUS_PLAN_PIN)).entries()) {
      expect(scans, `pinned, no sequential read: ${RUN_STATEMENTS[index]!.sql}`).not.toContain('Seq Scan on julius_runs');
      expect(scans.some((scan) => /^(Index Scan|Index Only Scan|Bitmap Heap Scan) on julius_runs$/u.test(scan)), `pinned, by an index: ${RUN_STATEMENTS[index]!.sql}`).toBe(true);
    }
  });

  it('PIN-4: two runs’ transitions, interleaved as the stress lost them: unpinned, one is cancelled with 40001; pinned, both commit', async () => {
    const unpinned = await pair(null, false, runs[3]!, runs[4]!);
    expect(committed(unpinned), 'CONTROL: unpinned, exactly one commits').toBe(1);
    expect(failure(unpinned), 'and the other is a serialization failure').toMatchObject({ code: '40001' });
    const pinned = await pair(JULIUS_PLAN_PIN, false, runs[3]!, runs[4]!);
    expect(pinned, 'pinned: both commit').toEqual({ a: 'COMMITTED', b: 'COMMITTED' });
  });

  it('PIN-5, THE RESIDUAL: two transitions that each READ their run before either WRITES meet on the run index’s leaf page, and one is cancelled even pinned', async () => {
    const pinned = await pair(JULIUS_PLAN_PIN, true, runs[5]!, runs[6]!);
    expect(committed(pinned), 'one commits').toBe(1);
    expect(failure(pinned), 'and the other is cancelled: the pin does not reach this cycle').toMatchObject({ code: '40001' });
    const indexes = (await pool.query("SELECT indexdef FROM pg_indexes WHERE schemaname='relay_wonderland' AND tablename='julius_runs'")).rows
      .map((row: { indexdef: string }) => row.indexdef);
    expect(indexes.some((definition) => definition.includes('(project_id, state, created_at)')),
      'because `state` is indexed: a transition inserts index entries on the leaf both reads locked, never a HOT update').toBe(true);
  });
});
