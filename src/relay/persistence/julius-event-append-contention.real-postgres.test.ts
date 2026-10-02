import { randomBytes, randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { juliusTestDatabaseUrl } from './julius-test-database';
import { TransactionalWonderlandDatabase } from './wonderland-postgres';
import { JuliusEventPostgresRepository, appendJuliusEventWithin, type JuliusEventTransaction } from './julius-event-postgres';
import { JuliusEventIdConflict, type JuliusOperationalEvent } from '../mission/julius';

/**
 * ROW 13 (i): TWO APPENDS THAT SHARE NO ROW MUST NOT CANCEL EACH OTHER.
 *
 * The 09-30 failure (julius-real-infra 36679405489, host-visible, at 2f4010bf): the multi-mission
 * suite's run loop died on `could not serialize access due to read/write dependencies among
 * transactions` at the events INSERT, after all six `juliusSerializable` attempts. Reproduced
 * deterministically on the code that landed as 11c1c890: the append's duplicate check read an id that
 * did not exist yet, which under SERIALIZABLE locks the index PAGE it searched; another run's append
 * inserted into that page and committed first, and the first append was cancelled as the pivot of a
 * read/write cycle at its own INSERT ("Canceled on identification as a pivot, during write"). These
 * cases replay that exact interleaving, and pin the invariants the fix must keep: a replay allocates
 * nothing, a taken id is judged against the row that holds it, and one stream stays unique and gapless.
 *
 * ITS OWN DATABASE, created and dropped here. SSI tracks every serializable transaction in a database,
 * and the real-PostgreSQL suites run in parallel against one: a transaction of another suite could join
 * a cycle here and make a pass or a failure say nothing about the append. Runs wherever
 * JULIUS_TEST_DATABASE_URL names a THROWAWAY server (never DATABASE_URL); `todo` elsewhere. No provider.
 */

const databaseUrl = juliusTestDatabaseUrl();
const suite = databaseUrl !== null ? describe : describe.todo;

// The shape production gives an id (`ids.next(`event:${type}`)`): a type prefix every run shares.
const PREFIX = 'event:worker.dispatched:';
const INSERT_EVENTS = /^INSERT INTO relay_wonderland\.events\(/;

/** A transaction whose next statement matching `pattern` waits until it is released. */
function gated(client: PoolClient) {
  let gate: { pattern: RegExp; reached: () => void; released: Promise<void> } | null = null;
  const statements: string[] = [];
  const transaction: JuliusEventTransaction = {
    query: async (sql, values) => {
      const pending = gate;
      if (pending !== null && pending.pattern.test(sql)) {
        gate = null;
        pending.reached();
        await pending.released;
      }
      statements.push(sql.replace(/\s+/g, ' ').slice(0, 60));
      return client.query(sql, values as unknown[] | undefined);
    },
  };
  const pauseBefore = (pattern: RegExp) => {
    let reached!: () => void;
    let release!: () => void;
    const arrived = new Promise<void>((resolve) => { reached = resolve; });
    const released = new Promise<void>((resolve) => { release = resolve; });
    gate = { pattern, reached, released };
    return { arrived, release };
  };
  return { transaction, statements, pauseBefore };
}

type Outcome = 'COMMITTED' | { code: string | undefined; message: string };
const outcomeOf = (error: unknown): Outcome => ({ code: (error as { code?: string }).code, message: (error as Error).message });

suite('two Julius event appends under SERIALIZABLE (row 13 (i), the 09-30 failure)', () => {
  const nonce = randomBytes(6).toString('hex');
  const database = `julius13i${nonce}`;
  const project = `prj-13i-${nonce}`;
  const mission = `mission-13i-${nonce}`;
  let admin: Pool;
  let pool: Pool;
  let repository: JuliusEventPostgresRepository;

  const event = (runId: string, eventId = `${PREFIX}${randomUUID()}`, facts: JuliusOperationalEvent['facts'] = { attempt: 1 }): JuliusOperationalEvent => ({
    eventId, runId, projectId: project, type: 'worker.dispatched', taskId: `${runId}:build`, workerId: 'coding-agent',
    correlationId: `${runId}:build:1`, causationId: null, occurredAt: '2099-01-01T00:00:00.000Z', facts,
  });
  const newRun = async (label: string): Promise<string> => {
    const run = `run:${label}-${randomBytes(4).toString('hex')}`;
    await pool.query(
      "INSERT INTO relay_wonderland.julius_runs(run_id,mission_id,project_id,state,runtime_version,card_revision,mission_contract_revision,project_brain_revision) VALUES($1,$2,$3,'EXECUTING','13i','card',1,0)",
      [run, mission, project],
    );
    return run;
  };
  const sequencesOf = async (run: string): Promise<number[]> => (await pool.query(
    'SELECT sequence FROM relay_wonderland.events WHERE stream_id=$1 ORDER BY sequence', [run],
  )).rows.map((row: { sequence: string }) => Number(row.sequence));
  const count = async (sql: string, values: unknown[]): Promise<number> => Number((await pool.query(sql, values)).rows[0].n);

  /**
   * THE 09-30 INTERLEAVING. A (run A) runs its append up to the events INSERT and waits; B (ANOTHER run)
   * appends and commits; then A's INSERT runs. Both are opened exactly as `juliusSerializable` opens them.
   */
  const interleave = async (input: { idA?: string; idB?: string }) => {
    const [runA, runB] = [await newRun('a'), await newRun('b')];
    const [clientA, clientB, watcher] = [await pool.connect(), await pool.connect(), await pool.connect()];
    try {
      const pidA = Number((await clientA.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
      const a = gated(clientA);
      await clientA.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await clientB.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const gate = a.pauseBefore(INSERT_EVENTS);
      const pendingA = appendJuliusEventWithin(a.transaction, event(runA, input.idA)).then(() => null, (error: unknown) => error);
      await gate.arrived;
      // What A holds the moment before its INSERT: the cycle needed a page of the events key index.
      const predicateLocksA = (await watcher.query(
        "SELECT locktype, relation::regclass::text AS rel FROM pg_locks WHERE pid=$1 AND mode='SIReadLock'", [pidA],
      )).rows.map((row: { locktype: string; rel: string }) => `${row.locktype}:${row.rel}`);
      let b: Outcome = 'COMMITTED';
      try {
        await appendJuliusEventWithin({ query: (sql, values) => clientB.query(sql, values as unknown[] | undefined) }, event(runB, input.idB));
        await clientB.query('COMMIT');
      } catch (error) {
        await clientB.query('ROLLBACK').catch(() => undefined);
        b = outcomeOf(error);
      }
      gate.release();
      const failedA = await pendingA;
      let a2: Outcome = 'COMMITTED';
      if (failedA === null) {
        await clientA.query('COMMIT').catch(async (error: unknown) => { a2 = outcomeOf(error); await clientA.query('ROLLBACK').catch(() => undefined); });
      } else {
        a2 = outcomeOf(failedA);
        await clientA.query('ROLLBACK').catch(() => undefined);
      }
      return { a: a2, b, predicateLocksA, statementsA: a.statements };
    } finally {
      clientA.release();
      clientB.release();
      watcher.release();
    }
  };

  beforeAll(async () => {
    admin = new Pool({ connectionString: databaseUrl! });
    await admin.query(`CREATE DATABASE ${database}`);
    const url = new URL(databaseUrl!);
    url.pathname = `/${database}`;
    pool = new Pool({ connectionString: url.toString(), max: 12 });
    await new TransactionalWonderlandDatabase(pool).migrate();
    repository = new JuliusEventPostgresRepository(pool);
    await pool.query('INSERT INTO relay_wonderland.projects(project_id) VALUES($1)', [project]);
    await pool.query(
      "INSERT INTO relay_wonderland.mission_contracts(mission_id,project_id,stage,canonical_hash,snapshot) VALUES($1,$2,'READY',$3,'{}'::jsonb)",
      [mission, project, `13i:${nonce}`],
    );
  }, 120_000);

  afterAll(async () => {
    await pool?.end().catch(() => undefined);
    if (admin !== undefined) {
      await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [database]).catch(() => undefined);
      await admin.query(`DROP DATABASE IF EXISTS ${database}`).catch(() => undefined);
      await admin.end().catch(() => undefined);
    }
  });

  // FIRST, so the events table is as small as the suite's was: every key on one or two index pages.
  it('TWO RUNS, A SMALL INDEX (the 09-30 interleaving): the paused append commits after the other run’s append commits', async () => {
    const result = await interleave({});
    expect(result.b, 'the other run’s append').toBe('COMMITTED');
    expect(result.a, 'the paused append: on 11c1c890 this was 40001 "read/write dependencies" at the events INSERT').toBe('COMMITTED');
    expect(
      result.predicateLocksA.filter((lock) => lock === 'page:relay_wonderland.events_pkey'),
      'before its INSERT the append holds no page of the events key index: that page is what the 09-30 cycle ran through',
    ).toEqual([]);
    expect(result.statementsA.some((sql) => sql.startsWith('SELECT sequence,payload FROM relay_wonderland.events')), 'a new event is never read by id').toBe(false);
  });

  it('TWO RUNS, A LARGE INDEX, ADJACENT IDS (one leaf page) and FAR-APART IDS: every append commits', async () => {
    // 20,000 rows: the key index spans many leaf pages, so "adjacent" and "far apart" mean different pages.
    await pool.query(`INSERT INTO relay_wonderland.events(event_id,stream_id,project_id,sequence,event_type,visibility,payload,occurred_at)
      SELECT $2 || md5(g::text), 'run:filler-${nonce}', $1, g, 'filler.row', 'PROJECT', '{}'::jsonb, now() FROM generate_series(1,20000) g`, [project, PREFIX]);
    await pool.query('ANALYZE relay_wonderland.events');
    const near = await interleave({ idA: `${PREFIX}80000000-0000-4000-8000-000000000001`, idB: `${PREFIX}80000000-0000-4000-8000-000000000002` });
    const far = await interleave({ idA: `${PREFIX}00000000-0000-4000-8000-000000000001`, idB: `${PREFIX}ffffffff-0000-4000-8000-000000000001` });
    await pool.query("DELETE FROM relay_wonderland.events WHERE event_type='filler.row'");
    expect([near.a, near.b], 'adjacent ids: on 11c1c890 the paused append was cancelled as a pivot').toEqual(['COMMITTED', 'COMMITTED']);
    expect([far.a, far.b], 'far-apart ids').toEqual(['COMMITTED', 'COMMITTED']);
  }, 60_000);

  /**
   * THE SAME ID, WRITTEN TWICE, the second writer unable to see the first. Its snapshot is taken by an
   * earlier statement of its transaction (as a caller's own reads take it) BEFORE the other write commits,
   * so the committed row is not in it. Recording it "again" would be a second row; the only honest
   * answers are a serialization failure now and the replay on the retry.
   */
  const raceTheSameId = async (writer: JuliusOperationalEvent, other: JuliusOperationalEvent) => {
    const client = await pool.connect();
    const statements: string[] = [];
    let outcome: Outcome = 'COMMITTED';
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await client.query('SELECT 1');
      expect((await repository.append(other)).recorded, 'the other writer records the id first').toBe(true);
      try {
        await appendJuliusEventWithin({ query: (sql, values) => { statements.push(sql); return client.query(sql, values as unknown[] | undefined); } }, writer);
        await client.query('COMMIT');
      } catch (error) {
        outcome = outcomeOf(error);
        await client.query('ROLLBACK').catch(() => undefined);
      }
    } finally {
      client.release();
    }
    return { outcome, failedAt: statements.at(-1) ?? '' };
  };

  it('A TRUE DUPLICATE IN ONE RUN: the writer that cannot see the other’s row fails 40001, writes no second row, and its retry is the replay', async () => {
    const run = await newRun('dup');
    const duplicate = event(run);
    const raced = await raceTheSameId(duplicate, duplicate);
    expect(raced.outcome, 'a serialization failure, never a second row').toMatchObject({ code: '40001' });
    expect(await count('SELECT count(*)::int AS n FROM relay_wonderland.events WHERE event_id=$1', [duplicate.eventId])).toBe(1);
    expect((await repository.append(duplicate)).recorded, 'the retry sees the row: the replay').toBe(false);
    await expect(repository.append({ ...duplicate, facts: { attempt: 2 } }), 'a different event under the id').rejects.toBeInstanceOf(JuliusEventIdConflict);
    expect(await sequencesOf(run), 'one event, one sequence').toEqual([1]);
  });

  it('THE SAME ID FROM TWO RUNS: 40001 at the events INSERT itself, where ON CONFLICT meets a row the snapshot cannot see; the retry is the typed conflict', async () => {
    const [runA, runB] = [await newRun('ida'), await newRun('idb')];
    const id = `${PREFIX}${randomUUID()}`;
    const raced = await raceTheSameId(event(runA, id), event(runB, id));
    expect(raced.outcome).toMatchObject({ code: '40001' });
    expect(raced.failedAt, 'the other run’s stream and counter are not this one’s, so it is the id that stops it').toMatch(INSERT_EVENTS);
    expect(await count('SELECT count(*)::int AS n FROM relay_wonderland.events WHERE event_id=$1', [id])).toBe(1);
    await expect(repository.append(event(runA, id)), 'the id belongs to another run’s event').rejects.toBeInstanceOf(JuliusEventIdConflict);
    expect(await sequencesOf(runA), 'and run A allocated nothing for it').toEqual([]);
  });

  it('A REPLAY ALLOCATES NOTHING AND WRITES NO OUTBOX ROW: the next event takes the next sequence', async () => {
    const run = await newRun('replay');
    const first = event(run);
    const written = await repository.append(first);
    expect(written.recorded).toBe(true);
    expect(await repository.append(first)).toEqual({ recorded: false, sequence: written.sequence });
    const next = await repository.append(event(run));
    expect(next.sequence, 'the replay took no sequence number').toBe(written.sequence + 1);
    expect(await count('SELECT count(*)::int AS n FROM relay_wonderland.outbox WHERE event_id=$1', [first.eventId]), 'one outbox row per event, never per write').toBe(1);
    expect(await sequencesOf(run)).toEqual([written.sequence, written.sequence + 1]);
  });

  it('A CONFLICTING REPLAY ALLOCATES NOTHING: refused, and the stream stays gapless', async () => {
    const run = await newRun('conflict');
    const first = event(run);
    const written = await repository.append(first);
    await expect(repository.append({ ...first, facts: { attempt: 9 } })).rejects.toBeInstanceOf(JuliusEventIdConflict);
    const next = await repository.append(event(run));
    expect(next.sequence).toBe(written.sequence + 1);
    const stored = (await pool.query('SELECT payload FROM relay_wonderland.events WHERE event_id=$1', [first.eventId])).rows[0] as { payload: { facts: { attempt: number } } };
    expect(stored.payload.facts.attempt, 'the first event stands').toBe(1);
  });

  it('CONCURRENT APPENDS TO ONE STREAM end unique and gapless, and every outcome is a record or a retryable 40001', async () => {
    const run = await newRun('stream');
    const appends = Array.from({ length: 6 }, () => event(run));
    const settled = await Promise.allSettled(appends.map((value) => repository.append(value)));
    const refused = settled.flatMap((result, index) => (result.status === 'rejected' ? [{ index, reason: result.reason as { code?: string } }] : []));
    expect(refused.every((entry) => entry.reason.code === '40001'), 'a lost race surfaces as a retryable serialization failure, nothing else').toBe(true);
    // The caller's answer to a surfaced 40001 is to write the same event again.
    for (const entry of refused) expect((await repository.append(appends[entry.index]!)).recorded).toBe(true);
    expect(await sequencesOf(run), 'unique and gapless').toEqual([1, 2, 3, 4, 5, 6]);
    expect(await count('SELECT count(*)::int AS n FROM relay_wonderland.outbox o JOIN relay_wonderland.events e USING (event_id) WHERE e.stream_id=$1', [run])).toBe(6);
  });
});
