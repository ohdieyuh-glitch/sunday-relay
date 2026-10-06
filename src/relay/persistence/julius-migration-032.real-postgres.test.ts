import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { juliusTestDatabaseUrl } from './julius-test-database';
import { TransactionalWonderlandDatabase, WONDERLAND_MIGRATIONS, WONDERLAND_MIGRATION_031, WONDERLAND_MIGRATION_032 } from './wonderland-postgres';

/**
 * MIGRATION 032: NO OUTBOX ROW CAN NAME A MISSING EVENT, BY EITHER OF 030'S TWO PATHS (row 13 (i), 030 repaired;
 * founder ruling 2026-10-04).
 *
 * 030 replaced the outbox's foreign key with a transaction-local registry of the event ids the transaction INSERTED. Two
 * paths let an outbox row commit naming a missing event, which the foreign key refused:
 *   1. nothing ever took an id out of the registry, so INSERT event E -> DELETE event E -> INSERT outbox(E), in ONE
 *      transaction, committed an orphan (Codex finding (1), confirmed by Second:
 *      _qa_handoff/julius_readiness/landing/SECOND_JUDGEMENT_CODEX_030_P1_20261004.md);
 *   2. every written id was registered whole, so an event id holding chr(31) registered its parts, and
 *      INSERT event 'r' || chr(31) || 's' -> INSERT outbox('r') committed an orphan (folded in by the reviewer's ruling).
 * 032 makes 030's delete trigger also rewrite the registry without the deleted id, and 030's insert trigger register only
 * well-formed ids, both reading no relation. Each case is its OWN database, created and dropped here, migrated from the
 * real migration list (or by the product's migrate()) and seeded with three events and their outbox rows, written the way
 * the writers write them:
 *   A      path 1: before 032 the sequence commits an orphan (the control: the defect is real, so this case can fail),
 *          and 032's own guard then refuses that database; after 032 the same sequence is refused (23503
 *          outbox_event_not_written) and leaves nothing behind. 032 changes exactly two function bodies, in place: every
 *          trigger (by oid), constraint, index and other function is identical, and no row changes;
 *   A2     path 2, the same way: before 032 an outbox row for a part of 'r' US 's' commits an orphan (the control) and 032
 *          refuses that database; after 032 a row for either part is refused;
 *   B      the control: INSERT E -> INSERT outbox(E) still commits;
 *   C      INSERT E -> DELETE E -> INSERT E -> INSERT outbox(E) commits (the second INSERT registers E again);
 *   D      a DELETE rolled back to a savepoint is forgotten with its forget; a released one stays forgotten;
 *   E      deleting an event still deletes its outbox row (030's cascade), later or in its own transaction;
 *   F      two ids written by ONE statement: deleting either leaves the other registered and refuses its own; an id
 *          holding the delimiter, deleted, forgets nothing, so it cannot erase two well-formed neighbours;
 *   F2     a statement that wrote ONLY ids that are empty or hold the delimiter registers nothing (030's
 *          IF written IS NOT NULL holds with the filter), read from the registry itself; before 032 it registered them;
 *   G      the guard refuses, changing and stamping nothing, when an outbox row already names a missing event, when 031
 *          is not applied and when 032 already is; and when the delete trigger, a registry trigger or either function
 *          is not 030's. Bodies that differ from 030's only in whitespace are accepted (the control for "robustly");
 *   POST   the post-check refuses, rolling everything back, when a body installed is not the body it proves (either);
 *   H      the committed DOWN script restores both of 030's functions exactly (pg_get_functiondef of each, before 032 =
 *          after DOWN) and removes the stamp; it refuses while a later migration is applied and where 032 is not; 032
 *          applies again;
 *   CHAIN  the product's migrate() carries 032 right after 031;
 *   DOCS   the runbook's read-only pre-check and post-check report what its STOP and PASS lists name.
 * The one-edit mutants that must turn A, A2 and F red are recorded with the review (MUTANTS.md).
 * Runs wherever JULIUS_TEST_DATABASE_URL names a THROWAWAY server (never DATABASE_URL); `todo` elsewhere.
 */

const databaseUrl = juliusTestDatabaseUrl();
const suite = databaseUrl !== null ? describe : describe.todo;
const DOCS = join(__dirname, '..', '..', '..', 'docs', 'julius-migrations', '032');
const committed = (name: string): string => readFileSync(join(DOCS, name), 'utf8')
  .replace(/^\\set ON_ERROR_STOP on\s*$/mu, ''); // a psql meta-command; the driver runs plain SQL
const DOWN = committed('down.sql');
const PRECHECK = committed('precheck.sql');
const POSTCHECK = committed('postcheck.sql');
const BEFORE_031 = WONDERLAND_MIGRATIONS.slice(0, WONDERLAND_MIGRATIONS.indexOf(WONDERLAND_MIGRATION_031));
const BEFORE_032 = WONDERLAND_MIGRATIONS.slice(0, WONDERLAND_MIGRATIONS.indexOf(WONDERLAND_MIGRATION_032));
const STAMP_031 = '031_julius_run_transition_hot';
const STAMP_032 = '032_julius_outbox_event_delete_forgets';
const PROJECT = 'prj-032';
const US = '\u001f'; // chr(31): the registry's delimiter
/** The forget, as 032 writes it; the function's definition after 032 carries both verbatim. */
const FORGET = ["set_config('relay_wonderland.events_written',", 'chr(31) || OLD.event_id || chr(31), chr(31))'];
/** The registry's writer, and the filter 032 gives it, verbatim; its definition after 032 carries the filter. */
const REMEMBER = 'events_written_remember';
const FILTER = "FROM written_events WHERE event_id <> '' AND position(chr(31) IN event_id) = 0;";

type Step = readonly [sql: string, values: readonly unknown[]];
type Rows = Array<Record<string, unknown>>;
type Refusal = { code: string | undefined; message: string };
type Outcome = 'COMMITTED' | (Refusal & { step: number });

const refusalOf = (error: unknown): Refusal => ({ code: (error as { code?: string }).code, message: (error as Error).message });
/** An outcome as the cases read it: COMMITTED, or the refused step, its SQLSTATE and the named check (the message's first word). */
const verdict = (outcome: Outcome) => (outcome === 'COMMITTED' ? outcome : { step: outcome.step, code: outcome.code, check: outcome.message.split(':')[0] });
/** 030's refusal of an outbox row whose event is not registered, at the given step. */
const notWritten = (step: number) => ({ step, code: '23503', check: 'outbox_event_not_written' });

/** ONE statement writing every id given: one firing of 030's statement trigger, one registry segment. */
const insertEvents = (...ids: string[]): Step => [
  `INSERT INTO relay_wonderland.events(event_id,stream_id,project_id,sequence,event_type,visibility,payload,occurred_at)
     SELECT u.id, 'stream:' || md5(u.id), $2, 1, 'julius.worker.dispatched', 'PROJECT', '{}'::jsonb, now() FROM unnest($1::text[]) AS u(id)`,
  [ids, PROJECT],
];
const deleteEvent = (id: string): Step => ['DELETE FROM relay_wonderland.events WHERE event_id=$1', [id]];
const insertOutbox = (id: string): Step => [
  'INSERT INTO relay_wonderland.outbox(outbox_id,event_id,project_id) VALUES($1,$2,$3)', [`outbox:${randomUUID()}`, id, PROJECT],
];

suite('migration 032: deleting an event forgets it, so no outbox row can name it (row 13 (i), 030 repaired)', () => {
  const nonce = randomBytes(5).toString('hex');
  let admin: Pool;
  const made: Array<{ name: string; pool: Pool }> = [];

  const create = async (label: string): Promise<Pool> => {
    const name = `julius032${label}${nonce}`;
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(databaseUrl!);
    url.pathname = `/${name}`;
    const pool = new Pool({ connectionString: url.toString(), max: 2 });
    made.push({ name, pool });
    return pool;
  };
  /** One project, three events and their outbox rows, in one transaction, the way the writers write them. */
  const seed = async (pool: Pool): Promise<void> => {
    await pool.query(`BEGIN;
      INSERT INTO relay_wonderland.projects(project_id) VALUES('${PROJECT}');
      INSERT INTO relay_wonderland.events(event_id,stream_id,project_id,sequence,event_type,visibility,payload,occurred_at)
        SELECT 'event:032:' || g, 'run:032', '${PROJECT}', g, 'julius.worker.dispatched', 'PROJECT', '{}'::jsonb, now() FROM generate_series(1,3) g;
      INSERT INTO relay_wonderland.outbox(outbox_id,event_id,project_id) SELECT 'outbox:event:032:' || g, 'event:032:' || g, '${PROJECT}' FROM generate_series(1,3) g;
      COMMIT;`);
  };
  /** A fresh database migrated through `migrations` from the real list, then seeded. */
  const migrated = async (label: string, migrations: readonly string[]): Promise<Pool> => {
    const pool = await create(label);
    for (const sql of migrations) await pool.query(sql);
    await seed(pool);
    return pool;
  };
  const at031 = (label: string): Promise<Pool> => migrated(label, BEFORE_032);

  /** A whole script (a migration, DOWN, a check) on its own session: its result sets, its NOTICE lines, its refusal. */
  const run = async (pool: Pool, script: string): Promise<{ refusal: Refusal | null; notices: string[]; results: Array<{ rows: Rows }> }> => {
    const client = await pool.connect();
    const notices: string[] = [];
    client.on('notice', (notice) => { notices.push(notice.message ?? ''); });
    try {
      const raw: unknown = await client.query(script);
      return { refusal: null, notices, results: (Array.isArray(raw) ? raw : [raw]) as Array<{ rows: Rows }> };
    } catch (error) {
      // A refused script stops inside its own BEGIN: end that transaction before the session goes back to the pool.
      await client.query('ROLLBACK').catch(() => undefined);
      return { refusal: refusalOf(error), notices, results: [] };
    } finally {
      client.removeAllListeners('notice');
      client.release();
    }
  };
  const at032 = async (label: string): Promise<Pool> => {
    const pool = await at031(label);
    expect((await run(pool, WONDERLAND_MIGRATION_032)).refusal, `${label}: 032 applies`).toBeNull();
    return pool;
  };
  /** The steps in ONE transaction: COMMITTED, or the first refused step (its index, SQLSTATE and message), rolled back. */
  const inOneTransaction = async (pool: Pool, steps: readonly Step[]): Promise<Outcome> => {
    const client = await pool.connect();
    let step = -1;
    try {
      await client.query('BEGIN');
      for (const [index, [sql, values]] of steps.entries()) {
        step = index;
        await client.query(sql, [...values]);
      }
      step = steps.length; // the COMMIT itself
      await client.query('COMMIT');
      return 'COMMITTED';
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      return { step, ...refusalOf(error) };
    } finally {
      client.release();
    }
  };
  /** The registry exactly as the transaction sees it after the steps; the transaction is then rolled back. */
  const registryAfter = async (pool: Pool, steps: readonly Step[]): Promise<string> => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const [sql, values] of steps) await client.query(sql, [...values]);
      return (await client.query("SELECT coalesce(current_setting('relay_wonderland.events_written', true), '') AS registry")).rows[0].registry as string;
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  };

  const count = async (pool: Pool, sql: string, values: unknown[] = []): Promise<number> => Number((await pool.query(sql, values)).rows[0].n);
  const eventsOf = (pool: Pool, id: string) => count(pool, 'SELECT count(*) AS n FROM relay_wonderland.events WHERE event_id=$1', [id]);
  const outboxOf = (pool: Pool, id: string) => count(pool, 'SELECT count(*) AS n FROM relay_wonderland.outbox WHERE event_id=$1', [id]);
  const orphans = (pool: Pool) => count(pool,
    'SELECT count(*) AS n FROM relay_wonderland.outbox o WHERE NOT EXISTS (SELECT 1 FROM relay_wonderland.events e WHERE e.event_id = o.event_id)');
  const stamped = (pool: Pool) => count(pool, 'SELECT count(*) AS n FROM relay_wonderland.schema_migrations WHERE version = $1', [STAMP_032]);
  /** pg_get_functiondef of one of the two functions 032 replaces: the delete trigger's unless named. */
  const definition = async (pool: Pool, fn = 'outbox_follows_event_delete'): Promise<string> => (await pool.query(
    'SELECT pg_get_functiondef(to_regprocedure($1)) AS d', [`relay_wonderland.${fn}()`],
  )).rows[0].d as string;
  /**
   * relay_wonderland's catalog, by definition: every trigger WITH ITS OID (a re-created trigger shows), every constraint,
   * index, and function with its oid and body digest. Sorted here, not by ORDER BY: that follows the database's collation.
   */
  const catalog = async (pool: Pool): Promise<string[]> => (await pool.query(`
    SELECT 'trigger ' || t.oid::text || ' ' || pg_get_triggerdef(t.oid) || ' enabled=' || t.tgenabled::text AS line
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
     WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND NOT t.tgisinternal
    UNION ALL
    SELECT 'constraint ' || conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid)
      FROM pg_constraint WHERE connamespace = 'relay_wonderland'::regnamespace
    UNION ALL
    SELECT 'index ' || pg_get_indexdef(i.indexrelid)
      FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relnamespace = 'relay_wonderland'::regnamespace
    UNION ALL
    SELECT 'function ' || p.oid::text || ' ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') body_md5=' || md5(p.prosrc)
      FROM pg_proc p WHERE p.pronamespace = 'relay_wonderland'::regnamespace`)).rows.map((row: { line: string }) => row.line).sort();
  const rowCounts = async (pool: Pool): Promise<number[]> => [
    await count(pool, 'SELECT count(*) AS n FROM relay_wonderland.events'),
    await count(pool, 'SELECT count(*) AS n FROM relay_wonderland.outbox'),
  ];

  beforeAll(async () => { admin = new Pool({ connectionString: databaseUrl! }); }, 30_000);
  // ITS OWN TIMEOUT. This suite makes about a dozen databases and drops them one at a time, and on PostgreSQL 15+ every
  // DROP DATABASE requests an immediate checkpoint and waits for it (CREATE DATABASE does not; measured): a checkpoint
  // of the whole cluster, costing whatever every suite running beside it has dirtied. With CI's real-PostgreSQL step
  // run locally, one such checkpoint took 6.96 s (log_checkpoints). The default 10 s hook timeout failed this teardown
  // on both CI runs of #336 (2026-10-05, 2026-10-06) while every one of its cases passed.
  afterAll(async () => {
    for (const { name, pool } of made) {
      // pool.end() resolves before its idle clients have closed (pg-pool 3.14's _remove() does not await client.end()),
      // so the terminate below can reach a client that is still closing, and pg-pool re-emits that 57P01 as the pool's
      // 'error' (julius-migration-030's teardown, CI 2026-10-03). The terminate is this suite's own teardown.
      pool.on('error', () => undefined);
      await pool.end().catch(() => undefined);
      await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [name]).catch(() => undefined);
      await admin.query(`DROP DATABASE IF EXISTS ${name}`).catch(() => undefined);
    }
    await admin?.end().catch(() => undefined);
  }, 120_000);

  it('A: before 032 the delete path commits an orphan (the control) and 032 refuses that database; after 032 it is refused, and 032 changed exactly two function bodies, in place', async () => {
    const id = 'event:032:defect';
    const sequence = [insertEvents(id), deleteEvent(id), insertOutbox(id)];

    const before = await at031('defect');
    expect(await inOneTransaction(before, sequence), 'CONTROL, before 032: INSERT E -> DELETE E -> INSERT outbox(E) commits').toBe('COMMITTED');
    expect(await orphans(before), 'and leaves an outbox row naming a missing event').toBe(1);
    const definitionAtDefect = await definition(before);
    const refused = await run(before, WONDERLAND_MIGRATION_032);
    expect(refused.refusal?.message, '032 refuses the orphan 030 let in').toContain('migration_032_refused: 1 outbox row(s) already name a missing event');
    expect(await definition(before), 'nothing changed').toBe(definitionAtDefect);
    expect(await stamped(before), 'nothing stamped').toBe(0);

    const after = await at031('fixed');
    const [catalogBefore, rowsBefore] = [await catalog(after), await rowCounts(after)];
    const applied = await run(after, WONDERLAND_MIGRATION_032);
    expect(applied.refusal, '032 applies').toBeNull();
    const notice = applied.notices.filter((line) => line.startsWith('migration_032_precheck:'));
    expect(notice, 'one precheck NOTICE').toHaveLength(1);
    expect(notice[0], 'with the counts').toContain('orphan outbox rows 0; events 3; outbox 3');
    // The behaviour first, so a mutant that drops the forget fails HERE, on what the database does (MUTANTS.md).
    expect(verdict(await inOneTransaction(after, sequence)), 'with 032: the outbox INSERT is refused, as the foreign key refused it').toEqual(notWritten(2));
    expect([await eventsOf(after, id), await outboxOf(after, id), await orphans(after)], 'nothing left behind').toEqual([0, 0, 0]);

    const catalogAfter = await catalog(after);
    const removed = catalogBefore.filter((line) => !catalogAfter.includes(line));
    const added = catalogAfter.filter((line) => !catalogBefore.includes(line));
    const withoutDigest = (lines: string[]) => lines.map((line) => line.replace(/ body_md5=[0-9a-f]{32}$/u, ''));
    expect(removed, 'removed: two lines, the old bodies').toHaveLength(2);
    expect(withoutDigest(removed).map((line) => line.replace(/^function \d+ /u, '')).sort(), 'exactly the two functions 032 replaces')
      .toEqual([`${REMEMBER}()`, 'outbox_follows_event_delete()']);
    expect(withoutDigest(added), 'the same two functions (same oids), replaced in place; every trigger line, oid included, is unchanged')
      .toEqual(withoutDigest(removed));
    for (const piece of FORGET) expect(await definition(after), `the definition carries ${piece}`).toContain(piece);
    expect(await definition(after, REMEMBER), 'the remember function carries the filter').toContain(FILTER);
    expect(await rowCounts(after), 'no row changed').toEqual(rowsBefore);
    expect(await stamped(after)).toBe(1);
  }, 180_000);

  it('A2: before 032 an event id holding the delimiter registers its parts, so an outbox row for a part commits an orphan (the control); after 032 it is refused', async () => {
    const whole = `r${US}s`;
    const sequence = [insertEvents(whole), insertOutbox('r')];

    const before = await at031('fragment');
    expect(await inOneTransaction(before, sequence), 'CONTROL, before 032: INSERT event r US s -> INSERT outbox(r) commits').toBe('COMMITTED');
    expect([await eventsOf(before, 'r'), await outboxOf(before, 'r'), await orphans(before)], 'an outbox row naming the missing event r')
      .toEqual([0, 1, 1]);
    const refused = await run(before, WONDERLAND_MIGRATION_032);
    expect(refused.refusal?.message, '032 refuses the orphan 030 let in').toContain('migration_032_refused: 1 outbox row(s) already name a missing event');
    expect(await stamped(before), 'nothing stamped').toBe(0);

    const after = await at032('fragmentfixed');
    expect(verdict(await inOneTransaction(after, sequence)), 'with 032: refused, as the foreign key refused it').toEqual(notWritten(1));
    expect(verdict(await inOneTransaction(after, [insertEvents(whole), insertOutbox('s')])), 'and for the other part').toEqual(notWritten(1));
    expect([await eventsOf(after, whole), await outboxOf(after, 'r'), await outboxOf(after, 's'), await orphans(after)], 'nothing left behind')
      .toEqual([0, 0, 0, 0]);
  }, 180_000);

  it('B, THE CONTROL: after 032, INSERT E -> INSERT outbox(E) in one transaction still commits', async () => {
    const pool = await at032('control');
    const id = 'event:032:control';
    expect(await inOneTransaction(pool, [insertEvents(id), insertOutbox(id)])).toBe('COMMITTED');
    expect([await eventsOf(pool, id), await outboxOf(pool, id), await orphans(pool)]).toEqual([1, 1, 0]);
  }, 120_000);

  it('C: INSERT E -> DELETE E -> INSERT E -> INSERT outbox(E) commits: the second INSERT registers E again (and a second DELETE forgets it again)', async () => {
    const pool = await at032('reinsert');
    const id = 'event:032:reinsert';
    expect(await inOneTransaction(pool, [insertEvents(id), deleteEvent(id), insertEvents(id), insertOutbox(id)])).toBe('COMMITTED');
    expect([await eventsOf(pool, id), await outboxOf(pool, id), await orphans(pool)]).toEqual([1, 1, 0]);
    const twice = 'event:032:reinsert-twice';
    expect(verdict(await inOneTransaction(pool, [insertEvents(twice), deleteEvent(twice), insertEvents(twice), deleteEvent(twice), insertOutbox(twice)])))
      .toEqual(notWritten(4));
    expect(await orphans(pool)).toBe(0);
  }, 120_000);

  it('D: a DELETE rolled back to a savepoint takes its forget with it (the row and its registration come back together); a released one stays forgotten', async () => {
    const pool = await at032('savepoint');
    const kept = 'event:032:savepoint-rolled-back';
    expect(await inOneTransaction(pool, [insertEvents(kept), ['SAVEPOINT s', []], deleteEvent(kept), ['ROLLBACK TO SAVEPOINT s', []], insertOutbox(kept)]))
      .toBe('COMMITTED');
    expect([await eventsOf(pool, kept), await outboxOf(pool, kept), await orphans(pool)]).toEqual([1, 1, 0]);
    const gone = 'event:032:savepoint-released';
    expect(verdict(await inOneTransaction(pool, [insertEvents(gone), ['SAVEPOINT s', []], deleteEvent(gone), ['RELEASE SAVEPOINT s', []], insertOutbox(gone)])))
      .toEqual(notWritten(4));
    expect([await eventsOf(pool, gone), await orphans(pool)]).toEqual([0, 0]);
  }, 120_000);

  it('E: deleting an event still deletes its outbox row, as ON DELETE CASCADE did (030), in a later transaction or in its own', async () => {
    const pool = await at032('cascade');
    const id = 'event:032:cascade';
    expect(await inOneTransaction(pool, [insertEvents(id), insertOutbox(id)])).toBe('COMMITTED');
    expect(await outboxOf(pool, id)).toBe(1);
    expect(await inOneTransaction(pool, [deleteEvent(id)])).toBe('COMMITTED');
    expect([await eventsOf(pool, id), await outboxOf(pool, id)], 'a later transaction').toEqual([0, 0]);
    const same = 'event:032:cascade-same-transaction';
    expect(await inOneTransaction(pool, [insertEvents(same), insertOutbox(same), deleteEvent(same)])).toBe('COMMITTED');
    expect([await eventsOf(pool, same), await outboxOf(pool, same), await orphans(pool)], 'its own transaction').toEqual([0, 0, 0]);
  }, 120_000);

  it('F: two ids written by ONE statement: deleting either leaves the other registered and refuses its own; an id holding the delimiter, deleted, forgets nothing', async () => {
    const pool = await at032('onestatement');
    const pair = (tag: string) => [`event:032:${tag}-x`, `event:032:${tag}-y`] as const;
    const [x1, y1] = pair('first');
    expect(await inOneTransaction(pool, [insertEvents(x1, y1), deleteEvent(x1), insertOutbox(y1)]), 'the first deleted, the second still registered').toBe('COMMITTED');
    const [x2, y2] = pair('first-refused');
    expect(verdict(await inOneTransaction(pool, [insertEvents(x2, y2), deleteEvent(x2), insertOutbox(x2)])), 'the deleted first one refused').toEqual(notWritten(2));
    const [x3, y3] = pair('last');
    expect(await inOneTransaction(pool, [insertEvents(x3, y3), deleteEvent(y3), insertOutbox(x3)]), 'the last deleted, the first still registered').toBe('COMMITTED');
    const [x4, y4] = pair('last-refused');
    expect(verdict(await inOneTransaction(pool, [insertEvents(x4, y4), deleteEvent(y4), insertOutbox(y4)])), 'the deleted last one refused').toEqual(notWritten(2));
    expect([await outboxOf(pool, y1), await outboxOf(pool, x3), await orphans(pool)]).toEqual([1, 1, 0]);

    // THE GUARD. After these two INSERTs the registry holds US p US q US: the second registered nothing, since p US q
    // holds the delimiter (032's filter). Replacing US p US q US by one US would leave US alone and refuse p's and q's own
    // outbox rows. So an id holding the delimiter is never forgotten (no outbox row can name one: 030 refuses it), and
    // both neighbours keep their registration.
    const [p, q] = pair('neighbour');
    expect(await inOneTransaction(pool, [insertEvents(p, q), insertEvents(`${p}${US}${q}`), deleteEvent(`${p}${US}${q}`), insertOutbox(p), insertOutbox(q)]),
      'both well-formed neighbours keep their outbox rows').toBe('COMMITTED');
    expect([await outboxOf(pool, p), await outboxOf(pool, q), await orphans(pool)]).toEqual([1, 1, 0]);
  }, 120_000);

  it('F2: a statement that wrote ONLY ids that are empty or hold the delimiter registers nothing (030’s IF written IS NOT NULL holds with the filter); a well-formed id beside them still registers', async () => {
    const pool = await at031('malformedonly');
    const holding = `m${US}n`;
    // CONTROL, before 032, read from the registry itself: 030 registered such ids, as two parts or as an empty entry.
    expect(await registryAfter(pool, [insertEvents(holding)]), 'before 032: m US n registers its parts').toBe(`${US}m${US}n${US}`);
    expect(await registryAfter(pool, [insertEvents('')]), 'before 032: the empty id registers an empty entry').toBe(`${US}${US}`);

    expect((await run(pool, WONDERLAND_MIGRATION_032)).refusal, '032 applies').toBeNull();
    expect(await registryAfter(pool, []), 'a transaction starts with nothing registered').toBe('');
    expect(await registryAfter(pool, [insertEvents('')]), 'only an empty id: nothing registered').toBe('');
    expect(await registryAfter(pool, [insertEvents(holding)]), 'only an id holding the delimiter: nothing registered').toBe('');
    expect(await registryAfter(pool, [insertEvents('', holding)]), 'both in one statement: nothing registered').toBe('');
    expect(await registryAfter(pool, [insertEvents('event:032:wellformed', '', holding)]), 'a well-formed id beside them registers alone')
      .toBe(`${US}event:032:wellformed${US}`);
    expect(verdict(await inOneTransaction(pool, [insertEvents('', holding), insertOutbox('m')])), 'and no part of one gives an outbox row')
      .toEqual(notWritten(1));
    expect(await orphans(pool)).toBe(0);
  }, 120_000);

  it('G: the guard refuses, changing and stamping nothing, when an outbox row already names a missing event, when 031 is not applied, and when 032 already is', async () => {
    // AN ORPHAN MADE ON PURPOSE, in this throwaway database only. 030's outbox trigger is the very guard that refuses one,
    // so the table's owner disables it for this one INSERT, inside one transaction, and enables it again before COMMIT.
    const orphaned = await at031('orphan');
    await orphaned.query(`BEGIN;
      ALTER TABLE relay_wonderland.outbox DISABLE TRIGGER outbox_requires_event_written;
      INSERT INTO relay_wonderland.outbox(outbox_id,event_id,project_id) VALUES('outbox:orphan','event:none','${PROJECT}');
      ALTER TABLE relay_wonderland.outbox ENABLE TRIGGER outbox_requires_event_written;
      COMMIT;`);
    expect(await orphans(orphaned)).toBe(1);
    const cases: Array<[string, Pool, string]> = [
      ['an orphan', orphaned, 'migration_032_refused: 1 outbox row(s) already name a missing event'],
      ['031 not applied', await migrated('at030', BEFORE_031), 'migration_032_refused: 031 is not applied here'],
      ['032 already applied', await at032('twice'), 'migration_032_refused: 032 is already applied here'],
    ];
    for (const [label, pool, refusal] of cases) {
      const [catalogBefore, stampsBefore] = [await catalog(pool), await stamped(pool)];
      const attempt = await run(pool, WONDERLAND_MIGRATION_032);
      expect(attempt.refusal?.message, label).toContain(refusal);
      expect(attempt.notices.some((line) => line.startsWith('migration_032_precheck:')), `${label}: no precheck NOTICE`).toBe(false);
      expect(await catalog(pool), `${label}: nothing changed`).toEqual(catalogBefore);
      expect(await stamped(pool), `${label}: nothing stamped`).toBe(stampsBefore);
    }
  }, 300_000);

  it('G, THE SHAPE: the guard refuses when the delete trigger, a registry trigger or either function is not 030’s; 030’s bodies with other whitespace are accepted', async () => {
    const tampers: Array<[string, string, string]> = [
      ['deletedisabled', 'ALTER TABLE relay_wonderland.events DISABLE TRIGGER outbox_follows_event_delete', 'the trigger outbox_follows_event_delete'],
      ['deleteperstatement', 'DROP TRIGGER outbox_follows_event_delete ON relay_wonderland.events; CREATE TRIGGER outbox_follows_event_delete AFTER DELETE ON relay_wonderland.events FOR EACH STATEMENT EXECUTE FUNCTION relay_wonderland.outbox_follows_event_delete()', 'the trigger outbox_follows_event_delete'],
      ['remembermissing', 'DROP TRIGGER events_written_remember ON relay_wonderland.events', 'the registry triggers'],
      ['requiresdisabled', 'ALTER TABLE relay_wonderland.outbox DISABLE TRIGGER outbox_requires_event_written', 'the registry triggers'],
      ['bodychanged', 'CREATE OR REPLACE FUNCTION relay_wonderland.outbox_follows_event_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END; $$', 'relay_wonderland.outbox_follows_event_delete() is not'],
      ['bodysettings', 'ALTER FUNCTION relay_wonderland.outbox_follows_event_delete() SET search_path = pg_catalog', 'relay_wonderland.outbox_follows_event_delete() is not'],
      ['rememberbodychanged', 'CREATE OR REPLACE FUNCTION relay_wonderland.events_written_remember() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END; $$', 'relay_wonderland.events_written_remember() is not'],
      ['remembersettings', 'ALTER FUNCTION relay_wonderland.events_written_remember() SET search_path = pg_catalog', 'relay_wonderland.events_written_remember() is not'],
    ];
    for (const [label, tamper, named] of tampers) {
      const pool = await at031(label);
      await pool.query(tamper);
      const [catalogBefore, definitionBefore, rememberBefore] = [await catalog(pool), await definition(pool), await definition(pool, REMEMBER)];
      const attempt = await run(pool, WONDERLAND_MIGRATION_032);
      expect(attempt.refusal?.message, label).toContain(`migration_032_refused: ${named}`);
      expect(await catalog(pool), `${label}: nothing changed`).toEqual(catalogBefore);
      expect(await definition(pool), `${label}: the function as it was`).toBe(definitionBefore);
      expect(await definition(pool, REMEMBER), `${label}: the remember function as it was`).toBe(rememberBefore);
      expect(await stamped(pool), `${label}: not stamped`).toBe(0);
    }
    // THE CONTROL for "compared robustly": 030's two bodies with CRLF line ends, other indentation and a tab are still
    // 030's bodies.
    const flipped = await at031('bodywhitespace');
    await flipped.query([
      'CREATE OR REPLACE FUNCTION relay_wonderland.outbox_follows_event_delete() RETURNS trigger LANGUAGE plpgsql AS $$\r\nBEGIN\r\n    DELETE FROM relay_wonderland.outbox WHERE event_id = OLD.event_id;\r\n\tRETURN NULL;\r\nEND;\r\n$$;',
      "CREATE OR REPLACE FUNCTION relay_wonderland.events_written_remember() RETURNS trigger LANGUAGE plpgsql AS $$\r\nDECLARE\r\n written text;\r\nBEGIN\r\n\tSELECT string_agg(event_id, chr(31)) INTO written FROM written_events;\r\n IF written IS NOT NULL THEN\r\n   PERFORM set_config('relay_wonderland.events_written',\r\n coalesce(current_setting('relay_wonderland.events_written', true), '') || chr(31) || written || chr(31), true);\r\n END IF;\r\n RETURN NULL;\r\nEND;\r\n$$;",
    ].join('\n'));
    expect((await run(flipped, WONDERLAND_MIGRATION_032)).refusal, 'a line-ending flip is not a refusal').toBeNull();
    for (const piece of FORGET) expect(await definition(flipped)).toContain(piece);
    expect(await definition(flipped, REMEMBER)).toContain(FILTER);
    expect(await stamped(flipped)).toBe(1);
  }, 600_000);

  it('POST: the post-check refuses, rolling everything back, when a body the migration installs is not the body it proves (either function)', async () => {
    // MUTANTS of 032 itself: one line of a function it creates changes, the post-check's copy does not. Each text is
    // written twice, the function first; String.replace takes the first.
    const guard = 'position(chr(31) IN OLD.event_id) = 0';
    expect(WONDERLAND_MIGRATION_032.split(guard).length - 1, 'the guard is written twice: in the function, then in the post-check').toBe(2);
    expect(WONDERLAND_MIGRATION_032.split(FILTER).length - 1, 'the filter is written twice: in the function, then in the post-check').toBe(2);
    const mutants: Array<[string, string, string]> = [
      ['the delete function', WONDERLAND_MIGRATION_032.replace(guard, 'position(chr(31) IN OLD.event_id) >= 0'),
        'migration_032_postcheck: relay_wonderland.outbox_follows_event_delete() does not carry exactly the forget'],
      ['the remember function', WONDERLAND_MIGRATION_032.replace(FILTER, "FROM written_events WHERE event_id <> '';"),
        'migration_032_postcheck: relay_wonderland.events_written_remember() does not carry exactly the filter'],
    ];
    const pool = await at031('postcheck');
    const [catalogBefore, definitionBefore, rememberBefore] = [await catalog(pool), await definition(pool), await definition(pool, REMEMBER)];
    for (const [label, mutant, refusal] of mutants) {
      expect(mutant, `${label}: the mutant differs from 032`).not.toBe(WONDERLAND_MIGRATION_032);
      const attempt = await run(pool, mutant);
      expect(attempt.refusal?.message, label).toContain(refusal);
      expect(await catalog(pool), `${label}: rolled back, 030’s bodies included`).toEqual(catalogBefore);
      expect([await definition(pool), await definition(pool, REMEMBER)], label).toEqual([definitionBefore, rememberBefore]);
      expect(await stamped(pool), label).toBe(0);
    }
  }, 120_000);

  it('H: the committed DOWN script restores both of 030’s functions exactly and removes the stamp; it refuses while a later migration is applied and where 032 is not', async () => {
    const pool = await at031('down');
    const [catalogBefore, definitionBefore, rememberBefore] = [await catalog(pool), await definition(pool), await definition(pool, REMEMBER)];
    expect((await run(pool, WONDERLAND_MIGRATION_032)).refusal).toBeNull();
    expect(await definition(pool), 'the delete function changed').not.toBe(definitionBefore);
    expect(await definition(pool, REMEMBER), 'the remember function changed').not.toBe(rememberBefore);

    // A later lane's stamp (033 is Wonderland social's number). Rolling 032 back under it would leave a gap in the ledger.
    await pool.query('INSERT INTO relay_wonderland.schema_migrations(version) VALUES($1)', ['033_later_lane_probe']);
    const blocked = await run(pool, DOWN);
    expect(blocked.refusal?.message, 'DOWN while a later migration is applied').toContain('migration_032_down_refused: a later migration is applied (033_later_lane_probe)');
    expect(await stamped(pool), 'nothing changed').toBe(1);
    await pool.query('DELETE FROM relay_wonderland.schema_migrations WHERE version = $1', ['033_later_lane_probe']);

    expect((await run(pool, DOWN)).refusal, 'DOWN applies').toBeNull();
    expect(await definition(pool), 'pg_get_functiondef of the delete function: identical to before 032').toBe(definitionBefore);
    expect(await definition(pool, REMEMBER), 'pg_get_functiondef of the remember function: identical to before 032').toBe(rememberBefore);
    expect(await catalog(pool), 'and the whole catalog, both functions’ oids and body digests included').toEqual(catalogBefore);
    expect(await stamped(pool), 'the stamp is gone').toBe(0);
    expect((await run(pool, DOWN)).refusal?.message, 'DOWN where 032 is not applied').toContain('migration_032_down_refused: 032 is not applied here');
    // DOWN returns the store to exactly what 032's guard accepts.
    expect((await run(pool, WONDERLAND_MIGRATION_032)).refusal, '032 applies again after DOWN').toBeNull();
    expect(await stamped(pool)).toBe(1);
  }, 180_000);

  it('CHAIN: the product’s migrate() carries 032 right after 031, so a new database has the forget, the filter and its stamp, and refuses both paths', async () => {
    expect(WONDERLAND_MIGRATIONS.indexOf(WONDERLAND_MIGRATION_032), 'listed right after 031').toBe(WONDERLAND_MIGRATIONS.indexOf(WONDERLAND_MIGRATION_031) + 1);
    const pool = await create('chain');
    await new TransactionalWonderlandDatabase(pool).migrate();
    await seed(pool);
    for (const piece of FORGET) expect(await definition(pool)).toContain(piece);
    expect(await definition(pool, REMEMBER)).toContain(FILTER);
    expect(await stamped(pool)).toBe(1);
    const id = 'event:032:chain';
    expect(verdict(await inOneTransaction(pool, [insertEvents(id), deleteEvent(id), insertOutbox(id)])), 'the delete path').toEqual(notWritten(2));
    expect(verdict(await inOneTransaction(pool, [insertEvents(`r${US}s`), insertOutbox('r')])), 'the parts path').toEqual(notWritten(1));
  }, 120_000);

  it('DOCS: the runbook’s read-only pre-check and post-check report what its STOP and PASS lists name, before and after 032', async () => {
    const pool = await at031('docs');
    const check = async (script: string) => {
      const checked = await run(pool, script);
      expect(checked.refusal, 'the check runs').toBeNull();
      // Every single-row result set merged (each fact is named once in a script); the trigger listing is the multi-row one.
      const facts = Object.assign({}, ...checked.results.filter((result) => result.rows.length === 1).map((result) => result.rows[0])) as Record<string, unknown>;
      return { facts, triggers: checked.results.find((result) => result.rows.length > 1)?.rows ?? [] };
    };
    const NAMED = ['delete_trigger_matches', 'registry_triggers_match', 'function_is_030', 'function_has_forget', 'remember_is_030',
      'remember_has_filter', 'orphan_outbox_rows', 'migration_030_applied', 'migration_031_applied', 'migration_032_applied', 'ledger_last'];
    const named = (facts: Record<string, unknown>) => Object.fromEntries(NAMED.map((key) => [key, String(facts[key])]));
    const lines = (facts: Record<string, unknown>, key = 'function_definition') => String(facts[key]).split('\n');

    const pre = await check(PRECHECK);
    expect(named(pre.facts), 'the pre-check passes its STOP list at 031').toEqual({
      delete_trigger_matches: 'true', registry_triggers_match: 'true', function_is_030: 'true', function_has_forget: 'false',
      remember_is_030: 'true', remember_has_filter: 'false',
      orphan_outbox_rows: '0', migration_030_applied: 'true', migration_031_applied: 'true', migration_032_applied: 'false', ledger_last: STAMP_031,
    });
    expect(pre.triggers.length, 'the trigger listing is there').toBeGreaterThan(1);
    expect((await run(pool, WONDERLAND_MIGRATION_032)).refusal).toBeNull();
    const post = await check(POSTCHECK);
    expect(named(post.facts), 'the post-check passes its PASS list after 032').toEqual({
      delete_trigger_matches: 'true', registry_triggers_match: 'true', function_is_030: 'false', function_has_forget: 'true',
      remember_is_030: 'false', remember_has_filter: 'true',
      orphan_outbox_rows: '0', migration_030_applied: 'true', migration_031_applied: 'true', migration_032_applied: 'true', ledger_last: STAMP_032,
    });
    expect(post.triggers, 'the trigger listing, line for line').toEqual(pre.triggers);
    expect(lines(pre.facts).filter((line) => !lines(post.facts).includes(line)), 'nothing of 030’s definition is gone').toEqual([]);
    expect(lines(post.facts).filter((line) => !lines(pre.facts).includes(line)).join('\n'), 'what was added is the forget').toContain(FORGET[0]);
    const remember = (facts: Record<string, unknown>) => lines(facts, 'remember_definition');
    expect(remember(pre.facts).filter((line) => !remember(post.facts).includes(line)), 'the remember definition loses only its unfiltered SELECT')
      .toEqual(['  SELECT string_agg(event_id, chr(31)) INTO written FROM written_events;']);
    expect(remember(post.facts).filter((line) => !remember(pre.facts).includes(line)), 'and gains only the filtered one')
      .toEqual([`  SELECT string_agg(event_id, chr(31)) INTO written ${FILTER}`]);
    expect(Number(post.facts.ledger_count), 'the ledger grew by the stamp alone').toBe(Number(pre.facts.ledger_count) + 1);
    expect([post.facts.events_rows, post.facts.outbox_rows], 'no row changed').toEqual([pre.facts.events_rows, pre.facts.outbox_rows]);
  }, 120_000);
});
