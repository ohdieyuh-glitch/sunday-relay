import { randomBytes, randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { juliusTestDatabaseUrl } from './julius-test-database';
import { TransactionalWonderlandDatabase } from './wonderland-postgres';
import { JuliusEventPostgresRepository, appendJuliusEventWithin, type JuliusEventTransaction } from './julius-event-postgres';
import { JuliusEventIdConflict, type JuliusOperationalEvent } from '../mission/julius';

/**
 * ROW 13 (i): TWO APPENDS THAT SHARE NO ROW MUST NOT CANCEL EACH OTHER, UNDER ANY PLAN.
 *
 * The 09-30 failure (julius-real-infra 36679405489, host-visible, at 2f4010bf): the multi-mission suite's run loop
 * died on `could not serialize access due to read/write dependencies among transactions` at the events INSERT, after
 * all six `juliusSerializable` attempts. Reproduced deterministically on 11c1c890's code, and isolated on a throwaway
 * database with the planner state pinned (`_qa_handoff/julius_readiness/row13i/`): the append READ the events table
 * twice, and under SERIALIZABLE each read is a predicate lock.
 *   - M1: its duplicate check looked up an id that did not exist yet (fixed: the write comes first, ON CONFLICT
 *     decides);
 *   - M2: the outbox's foreign key re-read the event (fixed: migration 030 drops it and keeps the guarantee with
 *     triggers that read no relation).
 * On a small events table (every fresh database, so every CI job) the planner runs those reads as SEQUENTIAL SCANS,
 * which lock the whole relation: then any two runs' appends formed a read/write cycle, and so did an append and
 * another run's transition or creation that wrote its own event. These cases pin that state (S0) and the large-table
 * state (S1), ASSERT which state they are in, and replay the interleavings in both.
 *
 * ITS OWN DATABASE, created and dropped here, with autovacuum off on the tables involved. SSI tracks every
 * serializable transaction in a database, and the real-PostgreSQL suites run in parallel against one; a transaction
 * of another suite, or an ANALYZE nobody asked for, could otherwise make a pass or a failure here say nothing about
 * the append. Runs wherever JULIUS_TEST_DATABASE_URL names a THROWAWAY server (never DATABASE_URL); `todo` elsewhere.
 */

const databaseUrl = juliusTestDatabaseUrl();
const suite = databaseUrl !== null ? describe : describe.todo;

// The shape production gives an id (`ids.next(`event:${type}`)`): a type prefix every run shares.
const PREFIX = 'event:worker.dispatched:';
const INSERT_EVENTS = /^INSERT INTO relay_wonderland\.events\(/;
const INSERT_OUTBOX = /^INSERT INTO relay_wonderland\.outbox\(/;
const TABLES = ['events', 'outbox', 'stream_sequences', 'julius_runs', 'projects'];

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
const plain = (client: PoolClient): JuliusEventTransaction => ({ query: (sql, values) => client.query(sql, values as unknown[] | undefined) });

type Outcome = 'COMMITTED' | { code: string | undefined; message: string };
const outcomeOf = (error: unknown): Outcome => ({ code: (error as { code?: string }).code, message: (error as Error).message });

suite('Julius event appends under SERIALIZABLE, in both plan states (row 13 (i), the 09-30 failure)', () => {
  const nonce = randomBytes(6).toString('hex');
  const database = `julius13i${nonce}`;
  const project = `prj-13i-${nonce}`;
  const mission = `mission-13i-${nonce}`;
  const filler = `run:filler-${nonce}`;
  let admin: Pool;
  let pool: Pool;
  let repository: JuliusEventPostgresRepository;

  const event = (runId: string, eventId = `${PREFIX}${randomUUID()}`, facts: JuliusOperationalEvent['facts'] = { attempt: 1 }): JuliusOperationalEvent => ({
    eventId, runId, projectId: project, type: 'worker.dispatched', taskId: `${runId}:build`, workerId: 'coding-agent',
    correlationId: `${runId}:build:1`, causationId: null, occurredAt: '2099-01-01T00:00:00.000Z', facts,
  });
  const newRun = async (label: string, client: { query: (sql: string, values: unknown[]) => Promise<unknown> } = pool): Promise<string> => {
    const run = `run:${label}-${randomBytes(4).toString('hex')}`;
    await client.query(
      "INSERT INTO relay_wonderland.julius_runs(run_id,mission_id,project_id,state,runtime_version,card_revision,mission_contract_revision,project_brain_revision) VALUES($1,$2,$3,'EXECUTING','13i','card',1,0)",
      [run, mission, project],
    );
    return run;
  };
  const sequencesOf = async (run: string): Promise<number[]> => (await pool.query(
    'SELECT sequence FROM relay_wonderland.events WHERE stream_id=$1 ORDER BY sequence', [run],
  )).rows.map((row: { sequence: string }) => Number(row.sequence));
  const count = async (sql: string, values: unknown[]): Promise<number> => Number((await pool.query(sql, values)).rows[0].n);
  const sireadOf = async (watcher: PoolClient, pid: number): Promise<string[]> => (await watcher.query(
    "SELECT locktype, relation::regclass::text AS rel FROM pg_locks WHERE pid=$1 AND mode='SIReadLock'", [pid],
  )).rows.map((row: { locktype: string; rel: string }) => `${row.locktype}:${row.rel}`);
  const onEvents = (locks: string[]) => locks.filter((lock) => lock === 'relation:relay_wonderland.events' || lock === 'page:relay_wonderland.events_pkey');

  /**
   * THE PLANNER STATE, PINNED. S0: the events table ANALYZED EMPTY, so a by-id read of it would be a sequential scan,
   * as in every fresh database. S1: 20,000 rows ANALYZED, so it would use the index.
   */
  const pinState = async (state: 'S0' | 'S1') => {
    if (state === 'S0') {
      await pool.query('DELETE FROM relay_wonderland.events');
      await pool.query('VACUUM relay_wonderland.events');
    } else if (await count('SELECT count(*)::int AS n FROM relay_wonderland.events WHERE stream_id=$1', [filler]) === 0) {
      await pool.query(`INSERT INTO relay_wonderland.events(event_id,stream_id,project_id,sequence,event_type,visibility,payload,occurred_at)
        SELECT $2 || md5(g::text), $3, $1, g, 'filler.row', 'PROJECT', '{}'::jsonb, now() FROM generate_series(1,20000) g`, [project, PREFIX, filler]);
    }
    for (const table of TABLES) await pool.query(`ANALYZE relay_wonderland.${table}`);
  };
  /** Which state THIS session's planner is in: read in the appender's own session, outside its transaction. */
  const planStateIn = async (client: PoolClient) => {
    const reltuples = Number((await client.query("SELECT reltuples FROM pg_class WHERE oid='relay_wonderland.events'::regclass")).rows[0].reltuples);
    await client.query('SET plan_cache_mode = force_generic_plan');
    await client.query('PREPARE by_id(text) AS SELECT 1 FROM ONLY relay_wonderland.events x WHERE event_id = $1 FOR KEY SHARE OF x');
    const plan = (await client.query("EXPLAIN EXECUTE by_id('x')")).rows.map((row: Record<string, string>) => row['QUERY PLAN']).join(' | ');
    await client.query('DEALLOCATE by_id');
    await client.query('RESET plan_cache_mode');
    return { reltuples, plan };
  };

  /**
   * THE 09-30 INTERLEAVING. A (run A) runs its append up to the events INSERT and waits; B, ANOTHER run, does its
   * work and commits; then A's INSERT runs. Both are opened exactly as `juliusSerializable` opens them.
   */
  const interleave = async (b: (client: PoolClient) => Promise<void>, idA?: string) => {
    const runA = await newRun('a');
    const [clientA, clientB, watcher] = [await pool.connect(), await pool.connect(), await pool.connect()];
    try {
      const planB = await planStateIn(clientB);
      const [pidA, pidB] = [Number((await clientA.query('SELECT pg_backend_pid() AS pid')).rows[0].pid), Number((await clientB.query('SELECT pg_backend_pid() AS pid')).rows[0].pid)];
      const a = gated(clientA);
      await clientA.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await clientB.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const gate = a.pauseBefore(INSERT_EVENTS);
      const pendingA = appendJuliusEventWithin(a.transaction, event(runA, idA)).then(() => null, (error: unknown) => error);
      await gate.arrived;
      const locksA = await sireadOf(watcher, pidA);
      let outcomeB: Outcome = 'COMMITTED';
      let locksB: string[] = [];
      try {
        await b(clientB);
        locksB = await sireadOf(watcher, pidB);
        await clientB.query('COMMIT');
      } catch (error) {
        await clientB.query('ROLLBACK').catch(() => undefined);
        outcomeB = outcomeOf(error);
      }
      gate.release();
      const failedA = await pendingA;
      let outcomeA: Outcome = 'COMMITTED';
      if (failedA === null) {
        await clientA.query('COMMIT').catch(async (error: unknown) => { outcomeA = outcomeOf(error); await clientA.query('ROLLBACK').catch(() => undefined); });
      } else {
        outcomeA = outcomeOf(failedA);
        await clientA.query('ROLLBACK').catch(() => undefined);
      }
      return { a: outcomeA, b: outcomeB, locksA, locksB, planB, statementsA: a.statements };
    } finally {
      clientA.release();
      clientB.release();
      watcher.release();
    }
  };
  // What another run's loop does while A's append is in flight. Runs that already exist are created beforehand, in
  // autocommit (not a serializable transaction, so outside SSI); only the creation scenario creates its run inside B.
  const appendsItsOwn = async (client: PoolClient, id?: string) => { const run = await newRun('b'); await appendJuliusEventWithin(plain(client), event(run, id)); };
  const transitionsWithEvent = async (client: PoolClient) => {
    const run = await newRun('t');
    await client.query("UPDATE relay_wonderland.julius_runs SET state='REVIEWING',version=version+1,updated_at=now() WHERE run_id=$1", [run]);
    await appendJuliusEventWithin(plain(client), { ...event(run), type: 'run.transitioned' });
  };
  const createsWithEvent = async (client: PoolClient) => {
    const run = await newRun('c', client);
    await appendJuliusEventWithin(plain(client), { ...event(run), type: 'run.created' });
  };

  beforeAll(async () => {
    admin = new Pool({ connectionString: databaseUrl! });
    await admin.query(`CREATE DATABASE ${database}`);
    const url = new URL(databaseUrl!);
    url.pathname = `/${database}`;
    pool = new Pool({ connectionString: url.toString(), max: 12 });
    await new TransactionalWonderlandDatabase(pool).migrate();
    // Experimental control, in this database only: no ANALYZE may move the planner between the pinned states.
    for (const table of TABLES) await pool.query(`ALTER TABLE relay_wonderland.${table} SET (autovacuum_enabled = false)`);
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

  /* ---------------------------------------------- S0: the CI state (a small, analyzed events table) */

  it('S0, TWO RUNS’ APPENDS (the 09-30 interleaving): the paused append commits after the other run’s append commits', async () => {
    await pinState('S0');
    const result = await interleave(appendsItsOwn);
    expect(result.planB.reltuples, 'S0: the events table is analyzed empty').toBe(0);
    expect(result.planB.plan, 'S0: in the appender’s own session, a by-id read of events WOULD be a sequential scan').toMatch(/Seq Scan on events/u);
    expect(result.locksA, 'S0, live: the appender’s own reads here are sequential scans (its run lookup locks the whole relation)').toContain('relation:relay_wonderland.julius_runs');
    expect(result.b, 'the other run’s append').toBe('COMMITTED');
    expect(result.a, 'the paused append: on 11c1c890 this was 40001 at the events INSERT (M1), and without 030 at the outbox INSERT (M2)').toBe('COMMITTED');
    expect(onEvents(result.locksA), 'before its INSERT the append has read nothing of events').toEqual([]);
    expect(onEvents(result.locksB), 'and the other append, before its COMMIT, read nothing of events either: that read was the cycle’s closing edge').toEqual([]);
    expect(result.statementsA.some((sql) => sql.startsWith('SELECT sequence,payload FROM relay_wonderland.events')), 'a new event is never read by id').toBe(false);
  });

  it('S0, ANOTHER RUN’S TRANSITION WITH ITS EVENT while an append is in flight: both commit', async () => {
    await pinState('S0');
    const result = await interleave(transitionsWithEvent);
    expect([result.planB.reltuples, /Seq Scan on events/u.test(result.planB.plan)]).toEqual([0, true]);
    expect([result.a, result.b]).toEqual(['COMMITTED', 'COMMITTED']);
    expect(onEvents(result.locksB)).toEqual([]);
  });

  it('S0, ANOTHER RUN’S CREATION WITH ITS EVENT while an append is in flight: both commit', async () => {
    await pinState('S0');
    const result = await interleave(createsWithEvent);
    expect([result.planB.reltuples, /Seq Scan on events/u.test(result.planB.plan)]).toEqual([0, true]);
    expect([result.a, result.b]).toEqual(['COMMITTED', 'COMMITTED']);
    expect(onEvents(result.locksB)).toEqual([]);
  });

  /* ---------------------------------------------- S1: a large, analyzed events table */

  it('S1, A LARGE INDEX: two runs’ appends with ADJACENT ids (one leaf page) and FAR-APART ids, and a transition with its event, all commit', async () => {
    await pinState('S1');
    const near = await interleave((client) => appendsItsOwn(client, `${PREFIX}80000000-0000-4000-8000-000000000002`), `${PREFIX}80000000-0000-4000-8000-000000000001`);
    const far = await interleave((client) => appendsItsOwn(client, `${PREFIX}ffffffff-0000-4000-8000-000000000001`), `${PREFIX}00000000-0000-4000-8000-000000000001`);
    const transition = await interleave(transitionsWithEvent);
    expect(near.planB.reltuples, 'S1: the events table is analyzed large').toBeGreaterThan(19_000);
    expect(near.planB.plan, 'S1: a by-id read would use the index').toMatch(/Index/u);
    expect([near.a, near.b], 'adjacent ids: on 11c1c890 the paused append was cancelled as a pivot (M1)').toEqual(['COMMITTED', 'COMMITTED']);
    expect([far.a, far.b], 'far-apart ids').toEqual(['COMMITTED', 'COMMITTED']);
    expect([transition.a, transition.b]).toEqual(['COMMITTED', 'COMMITTED']);
  }, 60_000);

  /* ---------------------------------------------- the same id twice */

  /**
   * THE SAME ID, WRITTEN TWICE, the second writer unable to see the first. Its snapshot is taken by an earlier
   * statement of its transaction (as a caller's own reads take it) BEFORE the other write commits, so the committed
   * row is not in it. Recording it "again" would be a second row; the only honest answers are a serialization
   * failure now and the replay on the retry.
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
    // "Allocated nothing" is read on the counter itself, not on the events (which would be empty either way).
    expect(await count('SELECT count(*)::int AS n FROM relay_wonderland.stream_sequences WHERE stream_id=$1', [runA]), 'run A allocated nothing for it: no counter row').toBe(0);
    expect((await repository.append(event(runA))).sequence, 'and run A’s first event takes sequence 1').toBe(1);
  });

  /* ---------------------------------------------- the invariants the fix must keep */

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

  /* ---------------------------------------------- what migration 030 enforces in place of the foreign key */

  const refusalOf = async (statements: Array<[string, unknown[]]>): Promise<{ code?: string; message: string } | null> => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const [sql, values] of statements.slice(0, -1)) await client.query(sql, values);
      const [sql, values] = statements.at(-1)!;
      const error = await client.query(sql, values).then(() => null, (raised: unknown) => raised as { code?: string; message: string });
      await client.query('ROLLBACK');
      return error;
    } finally {
      client.release();
    }
  };
  const insertEvent = (id: string, stream: string, sequence: number, type = 'julius.worker.dispatched'): [string, unknown[]] => [
    "INSERT INTO relay_wonderland.events(event_id,stream_id,project_id,sequence,event_type,visibility,payload,occurred_at) VALUES($1,$2,$3,$4,$5,'PROJECT','{}'::jsonb,now())",
    [id, stream, project, sequence, type],
  ];
  const insertOutbox = (id: string): [string, unknown[]] => [
    'INSERT INTO relay_wonderland.outbox(outbox_id,event_id,project_id) VALUES($1,$2,$3)', [`outbox:${randomUUID()}`, id, project],
  ];

  it('030: an outbox row whose event was not written earlier IN THIS TRANSACTION is refused (23503), even when the event exists', async () => {
    const run = await newRun('g2');
    const existing = event(run);
    await repository.append(existing);
    const forExisting = await refusalOf([insertOutbox(existing.eventId)]);
    expect(forExisting?.code, 'an event committed by another transaction gives no right to a new outbox row').toBe('23503');
    expect(forExisting?.message).toContain('outbox_event_not_written');
    const forNothing = await refusalOf([insertOutbox(`${PREFIX}${randomUUID()}`)]);
    expect(forNothing?.code, 'nor does an id no event has').toBe('23503');
    const sameTransaction = await refusalOf([insertEvent(`${PREFIX}g2-${nonce}`, `run:g2-${nonce}`, 1), insertOutbox(`${PREFIX}g2-${nonce}`)]);
    expect(sameTransaction, 'CONTROL: an event written earlier in the same transaction is accepted').toBeNull();
  });

  it('030: an event rolled back to a savepoint gives no right to an outbox row', async () => {
    const id = `${PREFIX}sp-${nonce}`;
    const refused = await refusalOf([
      ['SAVEPOINT before_event', []], insertEvent(id, `run:sp-${nonce}`, 1), ['ROLLBACK TO SAVEPOINT before_event', []], insertOutbox(id),
    ]);
    expect(refused?.code, 'the savepoint rollback forgets the event with the row').toBe('23503');
  });

  it('030: an outbox event id that is empty or contains the registry delimiter is refused, so no id matches across two registered ones', async () => {
    const [x, y] = [`${PREFIX}x-${nonce}`, `${PREFIX}y-${nonce}`];
    // x and y in ONE statement: the registry then holds ␟x␟y␟, which CONTAINS ␟(x␟y)␟. So without the malformed
    // check the crafted id would be ACCEPTED; the refusal is behaviour, not a message.
    const across = await refusalOf([
      ["INSERT INTO relay_wonderland.events(event_id,stream_id,project_id,sequence,event_type,visibility,payload,occurred_at) VALUES($1,$3,$4,1,'julius.worker.dispatched','PROJECT','{}'::jsonb,now()),($2,$3,$4,2,'julius.worker.dispatched','PROJECT','{}'::jsonb,now())", [x, y, `run:xy-${nonce}`, project]],
      insertOutbox(`${x}\u001f${y}`),
    ]);
    expect([across?.code, across?.message.includes('outbox_event_id_malformed')], 'a crafted id spanning two written ids').toEqual(['23503', true]);
    // Two SEPARATE statements: the registry then holds ␟x2␟␟y2␟, which contains ␟␟. So without the malformed check
    // an empty id would match it.
    const [x2, y2] = [`${PREFIX}x2-${nonce}`, `${PREFIX}y2-${nonce}`];
    const empty = await refusalOf([insertEvent(x2, `run:x2-${nonce}`, 1), insertEvent(y2, `run:y2-${nonce}`, 1), insertOutbox('')]);
    expect([empty?.code, empty?.message.includes('outbox_event_id_malformed')]).toEqual(['23503', true]);
  });

  it('030: the registry matches an id EXACTLY: a prefix or a suffix of a written id gives no right to an outbox row', async () => {
    const written = `exact-${nonce}-abc-1`;
    const stream = `run:exact-${nonce}`;
    const prefix = await refusalOf([insertEvent(written, stream, 1), insertOutbox(`exact-${nonce}-abc`)]);
    expect(prefix?.message, 'a prefix of the written id').toContain('outbox_event_not_written');
    const suffix = await refusalOf([insertEvent(written, stream, 1), insertOutbox(`${nonce}-abc-1`)]);
    expect(suffix?.message, 'a suffix of the written id').toContain('outbox_event_not_written');
    const exact = await refusalOf([insertEvent(written, stream, 1), insertOutbox(written)]);
    expect(exact, 'CONTROL: the id itself is accepted').toBeNull();
  });

  it('030: ONE statement writing two events gives each its own outbox row (the registry’s separator)', async () => {
    const [first, second] = [`two-${nonce}-1`, `two-${nonce}-2`];
    const both = await refusalOf([
      ["INSERT INTO relay_wonderland.events(event_id,stream_id,project_id,sequence,event_type,visibility,payload,occurred_at) VALUES($1,$3,$4,1,'julius.worker.dispatched','PROJECT','{}'::jsonb,now()),($2,$3,$4,2,'julius.worker.dispatched','PROJECT','{}'::jsonb,now())", [first, second, `run:two-${nonce}`, project]],
      insertOutbox(first),
      insertOutbox(second),
    ]);
    expect(both, 'both outbox rows accepted').toBeNull();
  });

  it('030: a TRUNCATE of events is refused, as the foreign key refused it (row triggers never see a TRUNCATE)', async () => {
    // The refusal itself is the evidence: refusalOf rolls back, so the table's contents afterwards would prove nothing.
    const refused = await refusalOf([['TRUNCATE relay_wonderland.events', []]]);
    expect(refused?.message, 'without the guard the TRUNCATE succeeds and this is null').toContain('events_truncate_refused');
  });

  it('030: an event’s id, and an outbox row’s event id, never change (the foreign key covered updates)', async () => {
    const run = await newRun('g3');
    const value = event(run);
    await repository.append(value);
    const eventUpdate = await refusalOf([['UPDATE relay_wonderland.events SET event_id=$2 WHERE event_id=$1', [value.eventId, `${value.eventId}:moved`]]]);
    expect([eventUpdate?.code, eventUpdate?.message.includes('event_id_immutable')]).toEqual(['23503', true]);
    const outboxUpdate = await refusalOf([['UPDATE relay_wonderland.outbox SET event_id=$2 WHERE event_id=$1', [value.eventId, `${PREFIX}${randomUUID()}`]]]);
    expect([outboxUpdate?.code, outboxUpdate?.message.includes('event_id_immutable')]).toEqual(['23503', true]);
    const payloadUpdate = await refusalOf([['UPDATE relay_wonderland.events SET payload=payload WHERE event_id=$1', [value.eventId]]]);
    expect(payloadUpdate, 'CONTROL: an update that leaves the id alone is not refused by it').toBeNull();
  });

  it('030: deleting an event deletes its outbox row, as ON DELETE CASCADE did', async () => {
    const run = await newRun('cascade');
    const value = event(run);
    await repository.append(value);
    expect(await count('SELECT count(*)::int AS n FROM relay_wonderland.outbox WHERE event_id=$1', [value.eventId])).toBe(1);
    await pool.query('DELETE FROM relay_wonderland.events WHERE event_id=$1', [value.eventId]);
    expect(await count('SELECT count(*)::int AS n FROM relay_wonderland.outbox WHERE event_id=$1', [value.eventId])).toBe(0);
  });

  it('A FAILURE BETWEEN THE EVENT AND ITS OUTBOX ROW ROLLS BOTH BACK', async () => {
    const run = await newRun('atomic');
    const value = event(run);
    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const failing: JuliusEventTransaction = {
        query: async (sql, values) => {
          if (INSERT_OUTBOX.test(sql)) throw new Error('injected: the process died between the event and its outbox row');
          return client.query(sql, values as unknown[] | undefined);
        },
      };
      await expect(appendJuliusEventWithin(failing, value)).rejects.toThrow('injected');
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    expect(await count('SELECT count(*)::int AS n FROM relay_wonderland.events WHERE event_id=$1', [value.eventId]), 'no event without its outbox row').toBe(0);
    expect(await count('SELECT count(*)::int AS n FROM relay_wonderland.outbox WHERE event_id=$1', [value.eventId])).toBe(0);
  });

  it('PROJECT BRAIN’S SHAPE: an event written with no outbox row is accepted, and none is made for it', async () => {
    const id = `project_brain:entry:${nonce}`;
    const [sql, values] = insertEvent(id, `brain:${nonce}`, 1, 'project_brain.record.created');
    await pool.query(sql, values);
    expect(await count('SELECT count(*)::int AS n FROM relay_wonderland.events WHERE event_id=$1', [id])).toBe(1);
    expect(await count('SELECT count(*)::int AS n FROM relay_wonderland.outbox WHERE event_id=$1', [id]), 'the outbox is not derived from events').toBe(0);
  });

  it('NO ORPHAN: every outbox row in this database names an event that exists', async () => {
    expect(await count('SELECT count(*)::int AS n FROM relay_wonderland.outbox o WHERE NOT EXISTS (SELECT 1 FROM relay_wonderland.events e WHERE e.event_id=o.event_id)', [])).toBe(0);
  });
});
