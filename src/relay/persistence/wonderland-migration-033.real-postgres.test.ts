import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { juliusTestDatabaseUrl } from './julius-test-database';
import { TransactionalWonderlandDatabase, WONDERLAND_MIGRATIONS, WONDERLAND_MIGRATION_032, WONDERLAND_MIGRATION_033 } from './wonderland-postgres';

/**
 * MIGRATION 033: THE WONDERLAND SOCIAL STORE, APPLIED EXPLICITLY AFTER 032 (founder ruling 2026-10-04 16:30Z; R16).
 *
 * 033 creates 47 relations in relay_wonderland -- 17 tables, the sequence behind social_events.seq and 29 indexes, 19 of
 * the 47 named by PostgreSQL itself -- and 25 foreign keys (21 on players), writes NO row (Julius's bootstrap leaves every
 * table empty; the store writes social_meta's next_serial with its first id) and changes no existing row. Each case is its OWN database, created and dropped here, migrated from the real migration
 * list (or by the product's migrate()) and seeded with two players, the rows 033's foreign keys reference:
 *   A      at 032, 033 applies with ONE precheck NOTICE carrying the counts; every catalog line it adds is a social_*
 *          object (the 47 relations exactly, 42 internal RI triggers on players) and none is removed or changed; no
 *          existing row changes; the new tables are empty; the stamp is the ledger's last;
 *   G      the guard refuses, changing and stamping nothing: before 032, a second time, after a later stamp, and when a
 *          relation 033 creates already exists -- a table, an implicit key name, the sequence name. The control: a taken
 *          implicit name is no error to PostgreSQL, which quietly names the key social_privacy_pkey1;
 *   POST   the post-check refuses, rolling everything back, when what the file creates is not what it proves (an index
 *          renamed, a row written, a foreign key missing);
 *   H      the committed DOWN script refuses while a later migration is applied, while social data exists (a row, the id
 *          serial written, the event sequence used) and while a relation is not as 033 created it; then it restores the
 *          catalog EXACTLY (players' internal triggers and the TOAST count included) and every row count, removes the
 *          stamp, refuses where 033 is not applied, and 033 applies again. 032's DOWN refuses while 033 is stamped;
 *   INV    030-032's invariants still hold after 033: an outbox row for an event deleted in its transaction (032's forget) or
 *          for a part of a delimited id (032's filter) is refused as 030's foreign key refused it, deleting an event still
 *          deletes its outbox row (030), and julius_runs keeps 031's index; the control, event then outbox, commits;
 *   CHAIN  the product's migrate() carries 033 right after 032;
 *   DOCS   the runbook's read-only pre-check and post-check print exactly their fixed one-row blocks (the header lines
 *          psql -A -F '|' prints) and report what its STOP and PASS lists name, before and after 033; the explicit
 *          apply and migrate() print the same catalog_033_md5.
 * Runs wherever JULIUS_TEST_DATABASE_URL names a THROWAWAY server (never DATABASE_URL); `todo` elsewhere.
 */

const databaseUrl = juliusTestDatabaseUrl();
const suite = databaseUrl !== null ? describe : describe.todo;
const DOCS = join(__dirname, '..', '..', '..', 'docs', 'julius-migrations');
const committed = (migration: string, name: string): string => readFileSync(join(DOCS, migration, name), 'utf8')
  .replace(/^\\set ON_ERROR_STOP on\s*$/mu, ''); // a psql meta-command; the driver runs plain SQL
const DOWN = committed('033', 'down.sql');
const PRECHECK = committed('033', 'precheck.sql');
const POSTCHECK = committed('033', 'postcheck.sql');
const DOWN_032 = committed('032', 'down.sql');
const BEFORE_032 = WONDERLAND_MIGRATIONS.slice(0, WONDERLAND_MIGRATIONS.indexOf(WONDERLAND_MIGRATION_032));
const BEFORE_033 = WONDERLAND_MIGRATIONS.slice(0, WONDERLAND_MIGRATIONS.indexOf(WONDERLAND_MIGRATION_033));
const STAMP_032 = '032_julius_outbox_event_delete_forgets';
const STAMP_033 = '033_wonderland_social';
const PLAYERS = ['usr_033_a', 'usr_033_b'];

/** What 033 creates, in the order its guard, the check scripts and DOWN list it. */
const TABLES = [
  'social_privacy', 'social_friendships', 'social_friend_requests', 'social_blocks', 'social_mutes', 'social_reports',
  'social_recent_players', 'social_conversations', 'social_conversation_members', 'social_messages', 'social_parties',
  'social_party_members', 'social_party_invites', 'social_profiles', 'social_presence', 'social_meta', 'social_events',
];
const SEQUENCE = 'social_events_seq_seq';
const INDEXES = [
  'social_privacy_pkey', 'social_friendships_pkey', 'social_friendships_b', 'social_friend_requests_pkey',
  'social_friend_requests_one_pending', 'social_friend_requests_inbox', 'social_blocks_pkey', 'social_blocks_blocked',
  'social_mutes_pkey', 'social_reports_pkey', 'social_recent_players_pkey', 'social_recent_players_recent',
  'social_conversations_pkey', 'social_conversation_members_pkey', 'social_conversation_members_player',
  'social_messages_pkey', 'social_messages_conversation_id_sequence_key', 'social_parties_pkey',
  'social_party_members_pkey', 'social_party_members_one_party', 'social_party_invites_pkey',
  'social_party_invites_one_pending', 'social_profiles_pkey', 'social_profiles_handle', 'social_presence_pkey',
  'social_meta_pkey', 'social_events_pkey', 'social_events_audience', 'social_events_at',
];
const RELATIONS = [...TABLES, SEQUENCE, ...INDEXES];

/** The one-row blocks both check scripts print after their first, each by the header line psql -A -F '|' prints. */
const BLOCKS = [
  'other_client_sessions',
  ['relations_033_expected', 'relations_033_present', 'relations_033_as_created', 'social_relations_other',
    'social_relations_other_names', ...RELATIONS].join('|'),
  TABLES.map((table) => `${table}_rows`).join('|'),
  'catalog_033_md5',
  'players_rows|players_referenced_by_fks|social_fk_constraints',
  'migration_031_applied|migration_032_applied|migration_033_applied|ledger_count|ledger_last',
];
const PRE_BLOCKS = ['checked_at|database|checked_by|server', ...BLOCKS];
const POST_BLOCKS = ['checked_at|database', ...BLOCKS];

type Rows = Array<Record<string, unknown>>;
type Result = { command: string; rows: Rows; fields: Array<{ name: string }> };
type Refusal = { code: string | undefined; message: string };
type Step = readonly [sql: string, values: readonly unknown[]];
type Outcome = 'COMMITTED' | (Refusal & { step: number });

const refusalOf = (error: unknown): Refusal => ({ code: (error as { code?: string }).code, message: (error as Error).message });
/** An outcome as INV reads it (julius-migration-032's form): COMMITTED, or the refused step, its SQLSTATE and the named check. */
const verdict = (outcome: Outcome) => (outcome === 'COMMITTED' ? outcome : { step: outcome.step, code: outcome.code, check: outcome.message.split(':')[0] });
/** 030's refusal of an outbox row whose event is not registered, at the given step. */
const notWritten = (step: number) => ({ step, code: '23503', check: 'outbox_event_not_written' });
const PROJECT = 'prj-033';
/** 031's re-keyed run index, exactly as julius-migration-031 names it; 011's index it replaced must stay gone. */
const RUN_INDEX_031 = 'CREATE INDEX julius_run_project_created ON relay_wonderland.julius_runs USING btree (project_id, created_at)';
const RUN_INDEX_011 = 'julius_run_project_state';
/** ONE statement writing every id given (julius-migration-032's insertEvents): one firing of 030's statement trigger. */
const insertEvents = (...ids: string[]): Step => [
  `INSERT INTO relay_wonderland.events(event_id,stream_id,project_id,sequence,event_type,visibility,payload,occurred_at)
     SELECT u.id, 'stream:' || md5(u.id), $2, 1, 'julius.worker.dispatched', 'PROJECT', '{}'::jsonb, now() FROM unnest($1::text[]) AS u(id)`,
  [ids, PROJECT],
];
const deleteEvent = (id: string): Step => ['DELETE FROM relay_wonderland.events WHERE event_id=$1', [id]];
const insertOutbox = (id: string): Step => [
  'INSERT INTO relay_wonderland.outbox(outbox_id,event_id,project_id) VALUES($1,$2,$3)', [`outbox:${randomUUID()}`, id, PROJECT],
];

suite('migration 033: the Wonderland social store, applied explicitly after 032 (R16)', () => {
  const nonce = randomBytes(5).toString('hex');
  let admin: Pool;
  const made: Array<{ name: string; pool: Pool }> = [];

  const create = async (label: string): Promise<Pool> => {
    const name = `wonderland033${label}${nonce}`;
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(databaseUrl!);
    url.pathname = `/${name}`;
    const pool = new Pool({ connectionString: url.toString(), max: 2 });
    made.push({ name, pool });
    return pool;
  };
  /** Two players, as sign-in writes them: the rows 033's foreign keys reference. */
  const seed = async (pool: Pool): Promise<void> => {
    await pool.query('INSERT INTO relay_wonderland.players(player_id) SELECT unnest($1::text[])', [PLAYERS]);
  };
  /** A fresh database migrated through `migrations` from the real list, then seeded. */
  const migrated = async (label: string, migrations: readonly string[]): Promise<Pool> => {
    const pool = await create(label);
    for (const sql of migrations) await pool.query(sql);
    await seed(pool);
    return pool;
  };
  const at032 = (label: string): Promise<Pool> => migrated(label, BEFORE_033);

  /** A whole script (a migration, DOWN, a check) on its own session: its result sets, its NOTICE lines, its refusal. */
  const run = async (pool: Pool, script: string): Promise<{ refusal: Refusal | null; notices: string[]; results: Result[] }> => {
    const client = await pool.connect();
    const notices: string[] = [];
    client.on('notice', (notice) => { notices.push(notice.message ?? ''); });
    try {
      const raw: unknown = await client.query(script);
      return { refusal: null, notices, results: (Array.isArray(raw) ? raw : [raw]) as Result[] };
    } catch (error) {
      // A refused script stops inside its own BEGIN: end that transaction before the session goes back to the pool.
      await client.query('ROLLBACK').catch(() => undefined);
      return { refusal: refusalOf(error), notices, results: [] };
    } finally {
      client.removeAllListeners('notice');
      client.release();
    }
  };
  const at033 = async (label: string): Promise<Pool> => {
    const pool = await at032(label);
    expect((await run(pool, WONDERLAND_MIGRATION_033)).refusal, `${label}: 033 applies`).toBeNull();
    return pool;
  };

  const count = async (pool: Pool, sql: string, values: unknown[] = []): Promise<number> => Number((await pool.query(sql, values)).rows[0].n);
  const stamped = (pool: Pool) => count(pool, 'SELECT count(*) AS n FROM relay_wonderland.schema_migrations WHERE version = $1', [STAMP_033]);
  const ledgerLast = async (pool: Pool): Promise<string> => (await pool.query(
    'SELECT max(version COLLATE "C") AS v FROM relay_wonderland.schema_migrations',
  )).rows[0].v as string;
  /**
   * relay_wonderland's catalog, by definition: every relation, column, constraint and index; every trigger WITH ITS OID
   * (as 032's suite reads it); the internal RI triggers by table, function, type and constraint (their own names carry
   * oids); every function with its oid and body digest; every sequence and type. Sorted here, not by ORDER BY: that
   * follows the database's collation.
   */
  const catalog = async (pool: Pool): Promise<string[]> => (await pool.query(`
    SELECT 'relation ' || c.relname || ' kind=' || c.relkind::text || ' persistence=' || c.relpersistence::text AS line
      FROM pg_class c WHERE c.relnamespace = 'relay_wonderland'::regnamespace
    UNION ALL
    SELECT 'column ' || c.relname || ' #' || a.attnum::text || ' ' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
           || CASE WHEN a.attnotnull THEN ' not-null' ELSE '' END || coalesce(' default=' || pg_get_expr(d.adbin, d.adrelid), '')
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND a.attnum > 0 AND NOT a.attisdropped
    UNION ALL
    SELECT 'constraint ' || conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid)
      FROM pg_constraint WHERE connamespace = 'relay_wonderland'::regnamespace
    UNION ALL
    SELECT 'index ' || pg_get_indexdef(i.indexrelid)
      FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relnamespace = 'relay_wonderland'::regnamespace
    UNION ALL
    SELECT 'trigger ' || t.oid::text || ' ' || pg_get_triggerdef(t.oid) || ' enabled=' || t.tgenabled::text
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
     WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND NOT t.tgisinternal
    UNION ALL
    SELECT 'internal trigger ' || c.relname || ' ' || p.proname || ' type=' || t.tgtype::text || ' constraint=' || coalesce(k.conname::text, '-')
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_proc p ON p.oid = t.tgfoid
      LEFT JOIN pg_constraint k ON k.oid = t.tgconstraint
     WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND t.tgisinternal
    UNION ALL
    SELECT 'function ' || p.oid::text || ' ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') body_md5=' || md5(p.prosrc)
      FROM pg_proc p WHERE p.pronamespace = 'relay_wonderland'::regnamespace
    UNION ALL
    SELECT 'sequence ' || c.relname || ' ' || format_type(s.seqtypid, NULL) || ' start=' || s.seqstart::text || ' inc=' || s.seqincrement::text
      FROM pg_sequence s JOIN pg_class c ON c.oid = s.seqrelid WHERE c.relnamespace = 'relay_wonderland'::regnamespace
    UNION ALL
    SELECT 'type ' || t.typname || ' typtype=' || t.typtype::text
      FROM pg_type t WHERE t.typnamespace = 'relay_wonderland'::regnamespace`)).rows.map((row: { line: string }) => row.line).sort();
  /** The database's TOAST relations: each social table brings its own, and DOWN must take every one away. */
  const toastRelations = (pool: Pool) => count(pool, "SELECT count(*) AS n FROM pg_class WHERE relnamespace = 'pg_toast'::regnamespace");
  /** Every base table of relay_wonderland with its exact row count, as `<table> <rows>`, sorted. */
  const rowCounts = async (pool: Pool): Promise<string[]> => {
    const tables = (await pool.query(
      "SELECT c.relname AS t FROM pg_class c WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND c.relkind = 'r'",
    )).rows.map((row: { t: string }) => row.t);
    const lines: string[] = [];
    for (const table of tables) lines.push(`${table} ${await count(pool, `SELECT count(*) AS n FROM relay_wonderland.${table}`)}`);
    return lines.sort();
  };

  beforeAll(async () => { admin = new Pool({ connectionString: databaseUrl! }); }, 30_000);
  afterAll(async () => {
    for (const { name, pool } of made) {
      // pool.end() resolves before its idle clients have closed, so the terminate below can reach a client that is still
      // closing, and pg-pool re-emits that 57P01 as the pool's 'error' (julius-migration-032's teardown). The terminate is
      // this suite's own teardown.
      pool.on('error', () => undefined);
      await pool.end().catch(() => undefined);
      await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [name]).catch(() => undefined);
      await admin.query(`DROP DATABASE IF EXISTS ${name}`).catch(() => undefined);
    }
    await admin?.end().catch(() => undefined);
  });

  it('A: at 032, 033 applies: every catalog line it adds is a social_* object (the 47 relations exactly, 42 internal triggers on players), none is removed, and no existing row changes (the ledger gains the stamp alone)', async () => {
    const pool = await at032('clean');
    const [catalogBefore, toastBefore, rowsBefore] = [await catalog(pool), await toastRelations(pool), await rowCounts(pool)];
    const applied = await run(pool, WONDERLAND_MIGRATION_033);
    expect(applied.refusal, '033 applies').toBeNull();
    const notice = applied.notices.filter((line) => line.startsWith('migration_033_precheck:'));
    expect(notice, 'one precheck NOTICE').toHaveLength(1);
    expect(notice[0], 'with the counts').toContain(`players ${PLAYERS.length}`);
    expect(applied.notices, 'and no other NOTICE').toHaveLength(1);

    const catalogAfter = await catalog(pool);
    expect(catalogBefore.filter((line) => !catalogAfter.includes(line)), 'nothing removed or changed').toEqual([]);
    const added = catalogAfter.filter((line) => !catalogBefore.includes(line));
    expect(added.filter((line) => !line.includes('social_')), 'every line added is a social_* object').toEqual([]);
    expect(added.filter((line) => line.startsWith('relation ')).map((line) => line.split(' ')[1]).sort(), 'the 47 relations, exactly')
      .toEqual([...RELATIONS].sort());
    expect(added.filter((line) => line.startsWith('internal trigger players ')), 'two RI triggers on players per foreign key').toHaveLength(42);
    expect(await toastRelations(pool), 'the new tables bring their TOAST relations').toBeGreaterThan(toastBefore);

    const rowsAfter = await rowCounts(pool);
    // the ledger is the one existing table 033 writes: exactly its stamp, one row (case H's DOWN takes it back)
    const withStamp = rowsBefore.map((line) => (line.startsWith('schema_migrations ') ? `schema_migrations ${Number(line.split(' ')[1]) + 1}` : line));
    expect(withStamp, 'the ledger is counted').not.toEqual(rowsBefore);
    expect(rowsAfter.filter((line) => !line.startsWith('social_')), 'no existing row changed; the ledger gained the stamp alone').toEqual(withStamp);
    expect(rowsAfter.filter((line) => line.startsWith('social_')), 'the new tables are empty: 033 writes no row')
      .toEqual(TABLES.map((table) => `${table} 0`).sort());
    expect(await stamped(pool)).toBe(1);
    expect(await ledgerLast(pool), "and the stamp is the ledger's last").toBe(STAMP_033);
  }, 180_000);

  it('G: the guard refuses, changing and stamping nothing: before 032, a second time, after a later stamp, and when a relation 033 creates already exists', async () => {
    // THE CONTROL for the implicit names: a key whose index name is taken is NOT an error; PostgreSQL picks another name.
    const control = await at032('implicitcontrol');
    const client = await control.connect();
    try {
      await client.query('BEGIN');
      await client.query('CREATE TABLE relay_wonderland.probe_033(x int)');
      await client.query('CREATE INDEX social_privacy_pkey ON relay_wonderland.probe_033(x)');
      await client.query('CREATE TABLE relay_wonderland.social_privacy(player_id text PRIMARY KEY)');
      const key = (await client.query(
        "SELECT conindid::regclass::text AS i FROM pg_constraint WHERE conrelid = 'relay_wonderland.social_privacy'::regclass AND contype = 'p'",
      )).rows[0].i as string;
      expect(key, 'CONTROL: without the guard the key is quietly renamed').toBe('relay_wonderland.social_privacy_pkey1');
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }

    const laterStamped = await at032('laterstamp');
    await laterStamped.query('INSERT INTO relay_wonderland.schema_migrations(version) VALUES($1)', ['034_later_lane_probe']);
    const tableTaken = await at032('tabletaken');
    await tableTaken.query('CREATE TABLE relay_wonderland.social_privacy(x int)');
    const keyTaken = await at032('keytaken');
    await keyTaken.query('CREATE TABLE relay_wonderland.probe_033(x int); CREATE INDEX social_privacy_pkey ON relay_wonderland.probe_033(x)');
    const sequenceTaken = await at032('sequencetaken');
    await sequenceTaken.query('CREATE SEQUENCE relay_wonderland.social_events_seq_seq');
    const taken = 'migration_033_refused: relation(s) 033 creates, or named social_*, already exist in relay_wonderland';
    const cases: Array<[string, Pool, string]> = [
      ['032 not applied', await migrated('at031', BEFORE_032), 'migration_033_refused: 032 is not applied here'],
      ['033 already applied', await at033('twice'), 'migration_033_refused: 033 is already applied here'],
      ['a later stamp', laterStamped, "migration_033_refused: the ledger's last stamp is 034_later_lane_probe, not 032"],
      ['a table taken', tableTaken, `${taken} (social_privacy)`],
      ['an implicit key name taken', keyTaken, `${taken} (social_privacy_pkey)`],
      ['the sequence name taken', sequenceTaken, `${taken} (social_events_seq_seq)`],
    ];
    for (const [label, pool, refusal] of cases) {
      const [catalogBefore, stampsBefore] = [await catalog(pool), await stamped(pool)];
      const attempt = await run(pool, WONDERLAND_MIGRATION_033);
      expect(attempt.refusal?.message, label).toContain(refusal);
      expect(attempt.notices.some((line) => line.startsWith('migration_033_precheck:')), `${label}: no precheck NOTICE`).toBe(false);
      expect(await catalog(pool), `${label}: nothing changed`).toEqual(catalogBefore);
      expect(await stamped(pool), `${label}: nothing stamped`).toBe(stampsBefore);
    }
  }, 600_000);

  it('POST: the post-check refuses, rolling everything back, when what the file creates is not what it proves', async () => {
    /** A statement the mutant rewrites: written ONCE in 033 (String.replace takes the first). */
    const statement = (text: string): string => {
      expect(WONDERLAND_MIGRATION_033.split(text).length - 1, `written once: ${text}`).toBe(1);
      return text;
    };
    const mutants: Array<[string, string, string]> = [
      ['an index renamed',
        WONDERLAND_MIGRATION_033.replace(statement('CREATE INDEX social_events_at ON relay_wonderland.social_events(at);'),
          'CREATE INDEX social_events_at_mutant ON relay_wonderland.social_events(at);'),
        "migration_033_postcheck: relation(s) not exactly as 033 creates them, or not 033's (social_events_at, social_events_at_mutant)"],
      ['a row written (the seed 033 no longer writes)',
        WONDERLAND_MIGRATION_033.replace(statement('-- THE CHANGE EVENTS CLIENTS POLL.'),
          "INSERT INTO relay_wonderland.social_meta(name, value) VALUES('next_serial', 1);\n-- THE CHANGE EVENTS CLIENTS POLL."),
        'migration_033_postcheck: social_meta holds a row, and 033 writes none'],
      ['a foreign key missing',
        WONDERLAND_MIGRATION_033.replace(statement('leader_id text NOT NULL REFERENCES relay_wonderland.players,'), 'leader_id text NOT NULL,'),
        'migration_033_postcheck: the social tables do not carry exactly the 25 foreign keys'],
    ];
    const pool = await at032('postcheck');
    const catalogBefore = await catalog(pool);
    for (const [label, mutant, refusal] of mutants) {
      expect(mutant, `${label}: the mutant differs from 033`).not.toBe(WONDERLAND_MIGRATION_033);
      const attempt = await run(pool, mutant);
      expect(attempt.refusal?.message, label).toContain(refusal);
      expect(await catalog(pool), `${label}: rolled back`).toEqual(catalogBefore);
      expect(await stamped(pool), `${label}: not stamped`).toBe(0);
    }
  }, 180_000);

  it('H: the committed DOWN script refuses while a later migration is applied, while social data exists and while a relation is not as 033 created it; then it restores the catalog and every row count EXACTLY and removes the stamp', async () => {
    const pool = await at032('down');
    const [catalogBefore, toastBefore, rowsBefore] = [await catalog(pool), await toastRelations(pool), await rowCounts(pool)];
    expect((await run(pool, WONDERLAND_MIGRATION_033)).refusal, '033 applies').toBeNull();

    // THE ROLLBACK ORDER, from 032's side: its DOWN refuses while 033 is stamped.
    expect((await run(pool, DOWN_032)).refusal?.message, "032's DOWN while 033 is applied")
      .toContain('migration_032_down_refused: a later migration is applied (033_wonderland_social)');

    const refusedWith = async (label: string, refusal: string): Promise<void> => {
      const [catalogAt, rowsAt] = [await catalog(pool), await rowCounts(pool)];
      expect((await run(pool, DOWN)).refusal?.message, label).toContain(refusal);
      expect(await catalog(pool), `${label}: nothing changed`).toEqual(catalogAt);
      expect(await rowCounts(pool), `${label}: no row changed`).toEqual(rowsAt);
      expect(await stamped(pool), `${label}: still stamped`).toBe(1);
    };
    // A later lane's stamp (034 is Project Brain's number). Rolling 033 back under it would leave a gap in the ledger.
    await pool.query('INSERT INTO relay_wonderland.schema_migrations(version) VALUES($1)', ['034_later_lane_probe']);
    await refusedWith('a later migration', 'migration_033_down_refused: a later migration is applied (034_later_lane_probe)');
    await pool.query('DELETE FROM relay_wonderland.schema_migrations WHERE version = $1', ['034_later_lane_probe']);

    // SOCIAL DATA, each kind refused and then undone here: a row, the id serial written (ids were minted), the event sequence used.
    await pool.query('INSERT INTO relay_wonderland.social_privacy(player_id) VALUES($1)', [PLAYERS[0]]);
    await refusedWith('a social row', 'migration_033_down_refused: social data exists (social_privacy 1)');
    await pool.query('DELETE FROM relay_wonderland.social_privacy');
    await pool.query("INSERT INTO relay_wonderland.social_meta(name, value) VALUES('next_serial', 2)");
    await refusedWith('the id serial written', 'migration_033_down_refused: social data exists (social_meta 1)');
    await pool.query('DELETE FROM relay_wonderland.social_meta');
    await pool.query("SELECT nextval('relay_wonderland.social_events_seq_seq')");
    await refusedWith('the event sequence used', 'migration_033_down_refused: social data exists (social_events_seq_seq used)');
    await pool.query("SELECT setval('relay_wonderland.social_events_seq_seq', 1, false)");

    // A RELATION NOT AS 033 CREATED IT: refused, then put back exactly.
    await pool.query('DROP INDEX relay_wonderland.social_events_at');
    await refusedWith('an index missing', "migration_033_down_refused: relation(s) not exactly as 033 created them, or not 033's (social_events_at)");
    await pool.query('CREATE INDEX social_events_at ON relay_wonderland.social_events(at)');

    expect((await run(pool, DOWN)).refusal, 'DOWN applies').toBeNull();
    expect(await catalog(pool), "the whole catalog, players' internal triggers included: identical to before 033").toEqual(catalogBefore);
    expect(await toastRelations(pool), 'every TOAST relation 033 brought is gone').toBe(toastBefore);
    expect(await rowCounts(pool), 'every row count: identical to before 033').toEqual(rowsBefore);
    expect(await stamped(pool), 'the stamp is gone').toBe(0);
    expect(await ledgerLast(pool), 'the ledger ends at 032 again').toBe(STAMP_032);
    expect((await run(pool, DOWN)).refusal?.message, 'DOWN where 033 is not applied').toContain('migration_033_down_refused: 033 is not applied here');
    // DOWN returns the store to exactly what 033's guard accepts.
    expect((await run(pool, WONDERLAND_MIGRATION_033)).refusal, '033 applies again after DOWN').toBeNull();
    expect(await stamped(pool)).toBe(1);
  }, 300_000);

  it("INV: 030-032's invariants still hold after 033: an orphan outbox row is refused on both of 032's paths, a deleted event takes its outbox row (030), julius_runs keeps 031's index, and the control commits", async () => {
    const pool = await at033('invariants');
    await pool.query('INSERT INTO relay_wonderland.projects(project_id) VALUES($1)', [PROJECT]);
    /** The steps in ONE transaction: COMMITTED, or the first refused step (its index, SQLSTATE and message), rolled back. */
    const inOneTransaction = async (steps: readonly Step[]): Promise<Outcome> => {
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
    const events = (id: string) => count(pool, 'SELECT count(*) AS n FROM relay_wonderland.events WHERE event_id=$1', [id]);
    const outbox = (id: string) => count(pool, 'SELECT count(*) AS n FROM relay_wonderland.outbox WHERE event_id=$1', [id]);
    const orphans = () => count(pool,
      'SELECT count(*) AS n FROM relay_wonderland.outbox o WHERE NOT EXISTS (SELECT 1 FROM relay_wonderland.events e WHERE e.event_id = o.event_id)');

    // THE CONTROL: the ordinary write still commits, so a refusal below is the invariant, not a broken write path
    const kept = 'event:033:control';
    expect(await inOneTransaction([insertEvents(kept), insertOutbox(kept)]), 'CONTROL: INSERT E -> INSERT outbox(E) commits').toBe('COMMITTED');
    expect([await events(kept), await outbox(kept)]).toEqual([1, 1]);
    // 032's forget: INSERT E -> DELETE E -> INSERT outbox(E) is refused at the outbox INSERT
    const gone = 'event:033:deleted';
    expect(verdict(await inOneTransaction([insertEvents(gone), deleteEvent(gone), insertOutbox(gone)])), "032's forget").toEqual(notWritten(2));
    // 032's filter: an id holding the registry's delimiter registers none of its parts
    expect(verdict(await inOneTransaction([insertEvents('r\u001fs'), insertOutbox('r')])), "032's filter").toEqual(notWritten(1));
    // 030's cascade: deleting an event deletes its outbox row
    expect(await inOneTransaction([deleteEvent(kept)]), "030's cascade").toBe('COMMITTED');
    expect([await events(kept), await outbox(kept), await orphans()], 'nothing left behind').toEqual([0, 0, 0]);
    // 031's run index: the re-keyed index is there, 011's is not
    const runIndexes = (await pool.query(
      "SELECT indexname AS n, indexdef AS d FROM pg_indexes WHERE schemaname = 'relay_wonderland' AND tablename = 'julius_runs'",
    )).rows as Array<{ n: string; d: string }>;
    expect(runIndexes.map((index) => index.d), "031's run index").toContain(RUN_INDEX_031);
    expect(runIndexes.map((index) => index.n), "011's run index stays gone").not.toContain(RUN_INDEX_011);
  }, 180_000);

  it("CHAIN: the product's migrate() carries 033 right after 032, so a new database has the 47 relations, no row in them, and the stamp", async () => {
    expect(WONDERLAND_MIGRATIONS.indexOf(WONDERLAND_MIGRATION_033), 'listed right after 032').toBe(WONDERLAND_MIGRATIONS.indexOf(WONDERLAND_MIGRATION_032) + 1);
    const pool = await create('chain');
    await new TransactionalWonderlandDatabase(pool).migrate();
    const present = (await pool.query(
      "SELECT c.relname AS r FROM pg_class c WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND c.relname LIKE 'social\\_%'",
    )).rows.map((row: { r: string }) => row.r).sort();
    expect(present, 'the 47 relations, exactly').toEqual([...RELATIONS].sort());
    expect(await count(pool, 'SELECT count(*) AS n FROM relay_wonderland.social_meta'), 'no row: the store writes next_serial with its first id').toBe(0);
    expect(await stamped(pool)).toBe(1);
  }, 120_000);

  it("DOCS: the runbook's read-only pre-check and post-check print exactly their fixed one-row blocks and report what its STOP and PASS lists name, before and after 033", async () => {
    const check = async (pool: Pool, script: string, blocks: readonly string[]): Promise<Record<string, unknown>> => {
      const checked = await run(pool, script);
      expect(checked.refusal, 'the check runs').toBeNull();
      const selects = checked.results.filter((result) => result.command === 'SELECT');
      // What psql -A -F '|' prints for each SELECT: the header line, its ONE row, "(1 row)".
      expect(selects.map((result) => result.fields.map((field) => field.name).join('|')), 'the fixed header lines, in order').toEqual([...blocks]);
      expect(selects.map((result) => result.rows.length), 'each block is one row').toEqual(blocks.map(() => 1));
      return Object.assign({}, ...selects.map((result) => result.rows[0])) as Record<string, unknown>;
    };
    const text = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));
    const named = (facts: Record<string, unknown>, keys: readonly string[]) => Object.fromEntries(keys.map((key) => [key, text(facts[key])]));
    const SUMMARY = ['relations_033_expected', 'relations_033_present', 'relations_033_as_created', 'social_relations_other', 'social_relations_other_names'];
    const ROWS = TABLES.map((table) => `${table}_rows`);
    const LEDGER = ['migration_031_applied', 'migration_032_applied', 'migration_033_applied', 'ledger_last'];

    const pool = await at032('docs');
    const pre = await check(pool, PRECHECK, PRE_BLOCKS);
    expect(named(pre, SUMMARY), 'the pre-check passes its STOP list at 032').toEqual({
      relations_033_expected: '47', relations_033_present: '0', relations_033_as_created: '0', social_relations_other: '0',
      social_relations_other_names: null,
    });
    expect(named(pre, RELATIONS), 'no relation 033 creates exists').toEqual(Object.fromEntries(RELATIONS.map((name) => [name, 'false'])));
    expect(named(pre, ROWS), 'no table to count').toEqual(Object.fromEntries(ROWS.map((name) => [name, null])));
    expect(named(pre, ['catalog_033_md5', 'social_fk_constraints']), 'nothing social in the catalog').toEqual({ catalog_033_md5: null, social_fk_constraints: '0' });
    expect(named(pre, LEDGER)).toEqual({ migration_031_applied: 'true', migration_032_applied: 'true', migration_033_applied: 'false', ledger_last: STAMP_032 });

    expect((await run(pool, WONDERLAND_MIGRATION_033)).refusal).toBeNull();
    const post = await check(pool, POSTCHECK, POST_BLOCKS);
    expect(named(post, SUMMARY), 'the post-check passes its PASS list after 033').toEqual({
      relations_033_expected: '47', relations_033_present: '47', relations_033_as_created: '47', social_relations_other: '0',
      social_relations_other_names: null,
    });
    expect(named(post, RELATIONS), 'every relation exactly as 033 creates it').toEqual(Object.fromEntries(RELATIONS.map((name) => [name, 'true'])));
    expect(named(post, ROWS), 'every table empty: 033 writes no row').toEqual(Object.fromEntries(ROWS.map((name) => [name, '0'])));
    expect(named(post, LEDGER)).toEqual({ migration_031_applied: 'true', migration_032_applied: 'true', migration_033_applied: 'true', ledger_last: STAMP_033 });
    expect(Number(post.ledger_count), 'the ledger grew by the stamp alone').toBe(Number(pre.ledger_count) + 1);
    expect(text(post.players_rows), 'no players row changed').toBe(text(pre.players_rows));
    expect(Number(post.players_referenced_by_fks), 'players gained the 21 foreign keys').toBe(Number(pre.players_referenced_by_fks) + 21);
    expect(text(post.social_fk_constraints), 'the social tables carry 25').toBe('25');

    // THE TWO PATHS BUILD THE SAME 033: this explicit apply, and the product's migrate() on a new database.
    expect(text(post.catalog_033_md5), 'a digest after 033').toMatch(/^[0-9a-f]{32}$/u);
    const chained = await create('docschain');
    await new TransactionalWonderlandDatabase(chained).migrate();
    expect((await check(chained, POSTCHECK, POST_BLOCKS)).catalog_033_md5, 'migrate() builds the same 033').toBe(post.catalog_033_md5);
  }, 180_000);
});
