import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { juliusTestDatabaseUrl } from './julius-test-database';
import { TransactionalWonderlandDatabase, WONDERLAND_MIGRATIONS, WONDERLAND_MIGRATION_033, WONDERLAND_MIGRATION_034 } from './wonderland-postgres';

/**
 * MIGRATION 034: THE PROJECT BRAIN COMPONENTS, APPLIED EXPLICITLY AFTER 033 (founder ruling 2026-10-04 16:30Z).
 *
 * 034 creates 9 tables, 12 indexes, 69 named constraints (24 foreign keys, 9 of them DEFERRABLE references to the mutation
 * log), 3 functions and 25 triggers (4 of them TRUNCATE guards on 029's tables), replaces 029's operation CHECK on
 * project_brain_mutations under the same name, and writes NO row. Each case is its OWN database, created and dropped here,
 * migrated from the real migration list (or by the product's migrate()):
 *   A      at 033, 034 applies with ONE precheck NOTICE: the one catalog line it removes is 029's operation CHECK, every line
 *          it adds is a project_brain object (the 21 relations exactly; the RI triggers its references put on projects,
 *          julius_runs and the mutation log), no existing row changes, its tables are empty, the stamp is the ledger's last;
 *   G      the guard refuses, changing and stamping nothing: before 033, a second time, after a later stamp, and when a name
 *          034 creates is taken -- a table, an implicit key name, an implicit constraint name, a function, a trigger. The
 *          controls: a taken implicit key or constraint name is no error to PostgreSQL, which quietly picks another;
 *   H      the committed DOWN script refuses while a later migration is applied and while an object is not as 034 created
 *          it; then it restores the catalog EXACTLY (029's CHECK, the RI triggers on projects and julius_runs, the TOAST
 *          count) and every row count, removes the stamp, refuses where 034 is not applied, and 034 applies again. 033's
 *          DOWN refuses while 034 is stamped;
 *   DATA   DOWN refuses while Project Brain component data exists -- a component operation in the append-only mutation log,
 *          a row in one of 034's tables -- and changes nothing (each on its own database: the log can never be emptied);
 *   CAT    034's catalog EXACTLY, by name, from the product's migrate(): every trigger on a project_brain_* table (table,
 *          function, type), every constraint on 034's tables (type, referenced table, deferral), every index (columns,
 *          unique, primary, partial), every project_brain_* function, the 15 operations the mutation log admits. Compared
 *          with toEqual, never arrayContaining: a trigger, CHECK, key or index dropped from 034 fails here;
 *   CHAIN  the product's migrate() carries 034 right after 033;
 *   DOCS   the runbook's read-only pre-check and post-check print exactly their fixed one-row blocks and report what its
 *          STOP and PASS lists name, before and after 034 and after DOWN; the explicit apply and migrate() print the same
 *          catalog_034_md5.
 * Runs wherever JULIUS_TEST_DATABASE_URL names a THROWAWAY server (never DATABASE_URL); `todo` elsewhere.
 */

const databaseUrl = juliusTestDatabaseUrl();
const suite = databaseUrl !== null ? describe : describe.todo;
const DOCS = join(__dirname, '..', '..', '..', 'docs', 'julius-migrations');
const committed = (migration: string, name: string): string => readFileSync(join(DOCS, migration, name), 'utf8')
  .replace(/^\\set ON_ERROR_STOP on\s*$/mu, ''); // a psql meta-command; the driver runs plain SQL
const DOWN = committed('034', 'down.sql');
const PRECHECK = committed('034', 'precheck.sql');
const POSTCHECK = committed('034', 'postcheck.sql');
const DOWN_033 = committed('033', 'down.sql');
const BEFORE_033 = WONDERLAND_MIGRATIONS.slice(0, WONDERLAND_MIGRATIONS.indexOf(WONDERLAND_MIGRATION_033));
const BEFORE_034 = WONDERLAND_MIGRATIONS.slice(0, WONDERLAND_MIGRATIONS.indexOf(WONDERLAND_MIGRATION_034));
const STAMP_033 = '033_wonderland_social';
const STAMP_034 = '034_project_brain_components';
const PROJECT = 'prj-034';

/** What 034 creates, written out from 034_project_brain_components.sql by hand (never derived from the database). */
const TABLES = [
  'project_brain_cards', 'project_brain_card_versions', 'project_brain_card_selection', 'project_brain_mission_cards',
  'project_brain_handoffs', 'project_brain_handoff_versions', 'project_brain_evals', 'project_brain_eval_versions',
  'project_brain_member_versions',
];
/** Every index on 034's tables: [table, index, unique, primary, columns, partial]. */
const INDEX_SPEC: ReadonlyArray<readonly [string, string, boolean, boolean, string, boolean]> = [
  ['project_brain_cards', 'project_brain_cards_pkey', true, true, 'card_id', false],
  ['project_brain_cards', 'project_brain_cards_project', false, false, 'project_id,state,updated_at', false],
  ['project_brain_card_versions', 'project_brain_card_versions_pkey', true, true, 'card_id,version', false],
  ['project_brain_card_selection', 'project_brain_card_selection_pkey', true, true, 'project_id', false],
  ['project_brain_mission_cards', 'project_brain_mission_cards_pkey', true, true, 'run_id', false],
  ['project_brain_handoffs', 'project_brain_handoffs_pkey', true, true, 'run_id', false],
  ['project_brain_handoff_versions', 'project_brain_handoff_versions_pkey', true, true, 'run_id,version', false],
  ['project_brain_evals', 'project_brain_evals_pkey', true, true, 'eval_id', false],
  ['project_brain_evals', 'project_brain_evals_one_current', true, false, 'project_id,subject_ref,criterion', true],
  ['project_brain_evals', 'project_brain_evals_subject', false, false, 'project_id,subject_ref,subject_revision', false],
  ['project_brain_eval_versions', 'project_brain_eval_versions_pkey', true, true, 'eval_id,version', false],
  ['project_brain_member_versions', 'project_brain_member_versions_pkey', true, true, 'project_id,player_id,version', false],
];
const RELATIONS = [...TABLES, ...INDEX_SPEC.map(([, index]) => index)];
const FUNCTIONS = ['project_brain_component_guard', 'project_brain_run_in_project', 'project_brain_truncate_refused'];
/** pg_trigger.tgtype: ROW 1 + BEFORE 2 + DELETE 8 + UPDATE 16; ROW 1 + BEFORE 2 + INSERT 4; BEFORE 2 + TRUNCATE 32 (statement). */
const ROW_UPDATE_DELETE = 27;
const ROW_INSERT = 7;
const STATEMENT_TRUNCATE = 34;
const TABLES_029 = ['project_brain_records', 'project_brain_mutations', 'project_brain_record_versions', 'project_brain_links'];
/** Every trigger 034 creates: [table, trigger, function, tgtype]. */
const TRIGGER_SPEC: ReadonlyArray<readonly [string, string, string, number]> = [
  ['project_brain_card_versions', 'project_brain_card_versions_immutable', 'project_brain_refuse_change', ROW_UPDATE_DELETE],
  ['project_brain_mission_cards', 'project_brain_mission_cards_immutable', 'project_brain_refuse_change', ROW_UPDATE_DELETE],
  ['project_brain_handoff_versions', 'project_brain_handoff_versions_immutable', 'project_brain_refuse_change', ROW_UPDATE_DELETE],
  ['project_brain_eval_versions', 'project_brain_eval_versions_immutable', 'project_brain_refuse_change', ROW_UPDATE_DELETE],
  ['project_brain_cards', 'project_brain_cards_guard', 'project_brain_component_guard', ROW_UPDATE_DELETE],
  ['project_brain_card_selection', 'project_brain_card_selection_guard', 'project_brain_component_guard', ROW_UPDATE_DELETE],
  ['project_brain_handoffs', 'project_brain_handoffs_guard', 'project_brain_component_guard', ROW_UPDATE_DELETE],
  ['project_brain_evals', 'project_brain_evals_guard', 'project_brain_component_guard', ROW_UPDATE_DELETE],
  ['project_brain_mission_cards', 'project_brain_mission_cards_project', 'project_brain_run_in_project', ROW_INSERT],
  ['project_brain_handoffs', 'project_brain_handoffs_project', 'project_brain_run_in_project', ROW_INSERT],
  ['project_brain_evals', 'project_brain_evals_project', 'project_brain_run_in_project', ROW_INSERT],
  ['project_brain_member_versions', 'project_brain_member_versions_immutable', 'project_brain_refuse_change', ROW_UPDATE_DELETE],
  ...[...TABLES_029, ...TABLES].map((table) => [table, `${table}_truncate_refused`, 'project_brain_truncate_refused', STATEMENT_TRUNCATE] as const),
];
/** 029's own triggers on its tables, which 034 leaves as they are. */
const TRIGGER_SPEC_029: ReadonlyArray<readonly [string, string, string, number]> = [
  ['project_brain_mutations', 'project_brain_mutations_immutable', 'project_brain_refuse_change', ROW_UPDATE_DELETE],
  ['project_brain_record_versions', 'project_brain_versions_immutable', 'project_brain_refuse_change', ROW_UPDATE_DELETE],
  ['project_brain_links', 'project_brain_links_immutable', 'project_brain_refuse_change', ROW_UPDATE_DELETE],
  ['project_brain_records', 'project_brain_records_guard', 'project_brain_record_guard', ROW_UPDATE_DELETE],
];
const TRIGGERS = TRIGGER_SPEC.map(([, trigger]) => trigger);
const MUTATIONS = 'project_brain_mutations';
/**
 * Every constraint on 034's tables but NOT NULL, by the name PostgreSQL gives it: [suffix, type, referenced table,
 * DEFERRABLE INITIALLY DEFERRED]. A one-column CHECK is <table>_<column>_check; a CHECK over two columns is <table>_check,
 * then <table>_check1, in the order written.
 */
const CONSTRAINT_SPEC: Record<string, ReadonlyArray<readonly [string, 'p' | 'f' | 'c', string?, true?]>> = {
  project_brain_cards: [['pkey', 'p'], ['card_id_check', 'c'], ['project_id_fkey', 'f', 'projects'], ['state_check', 'c'], ['name_check', 'c'],
    ['content_check', 'c'], ['content_hash_check', 'c'], ['version_check', 'c'], ['last_mutation_id_fkey', 'f', MUTATIONS, true]],
  project_brain_card_versions: [['pkey', 'p'], ['card_id_fkey', 'f', 'project_brain_cards'], ['project_id_fkey', 'f', 'projects'], ['version_check', 'c'],
    ['mutation_id_fkey', 'f', MUTATIONS, true], ['state_check', 'c'], ['content_hash_check', 'c']],
  project_brain_card_selection: [['pkey', 'p'], ['project_id_fkey', 'f', 'projects'], ['card_ref_check', 'c'], ['version_check', 'c'],
    ['last_mutation_id_fkey', 'f', MUTATIONS, true]],
  project_brain_mission_cards: [['pkey', 'p'], ['run_id_fkey', 'f', 'julius_runs'], ['project_id_fkey', 'f', 'projects'], ['card_ref_check', 'c'],
    ['card_version_check', 'c'], ['content_hash_check', 'c'], ['mutation_id_fkey', 'f', MUTATIONS, true]],
  project_brain_handoffs: [['pkey', 'p'], ['run_id_fkey', 'f', 'julius_runs'], ['project_id_fkey', 'f', 'projects'], ['state_check', 'c'],
    ['form_check', 'c'], ['version_check', 'c'], ['last_mutation_id_fkey', 'f', MUTATIONS, true]],
  project_brain_handoff_versions: [['pkey', 'p'], ['run_id_fkey', 'f', 'project_brain_handoffs'], ['project_id_fkey', 'f', 'projects'],
    ['version_check', 'c'], ['mutation_id_fkey', 'f', MUTATIONS, true], ['state_check', 'c']],
  project_brain_evals: [['pkey', 'p'], ['eval_id_check', 'c'], ['project_id_fkey', 'f', 'projects'], ['run_id_fkey', 'f', 'julius_runs'],
    ['subject_ref_check', 'c'], ['subject_revision_check', 'c'], ['criterion_check', 'c'], ['result_check', 'c'], ['evidence_refs_check', 'c'],
    ['status_check', 'c'], ['superseded_by_check', 'c'], ['version_check', 'c'], ['last_mutation_id_fkey', 'f', MUTATIONS, true],
    ['check', 'c'], // a PASS cites evidence
    ['check1', 'c']], // SUPERSEDED exactly when superseded_by is set
  project_brain_eval_versions: [['pkey', 'p'], ['eval_id_fkey', 'f', 'project_brain_evals'], ['project_id_fkey', 'f', 'projects'], ['version_check', 'c'],
    ['mutation_id_fkey', 'f', MUTATIONS, true], ['status_check', 'c']],
  project_brain_member_versions: [['pkey', 'p'], ['project_id_fkey', 'f', 'projects'], ['player_id_check', 'c'], ['version_check', 'c'],
    ['role_check', 'c'], ['mutation_id_fkey', 'f', MUTATIONS, true],
    ['check', 'c']], // a change is never a no-op
};
const CONSTRAINT_LINES = Object.entries(CONSTRAINT_SPEC).flatMap(([table, specs]) => specs.map(([suffix, type, references, deferred]) =>
  `${table} ${table}_${suffix} ${type} ${references ?? '-'} deferrable=${deferred === true} deferred=${deferred === true}`));
const OPERATIONS_029 = ['CREATE', 'REVISE', 'SET_STATUS', 'LINK'];
const OPERATIONS_034 = [...OPERATIONS_029, 'CARD_CREATE', 'CARD_UPDATE', 'CARD_DELETE', 'CARD_SELECT', 'MISSION_PIN_CARD',
  'HANDOFF_ENTER', 'HANDOFF_EXIT', 'EVAL_RECORD', 'EVAL_INVALIDATE', 'MEMBER_SET', 'MEMBER_REMOVE'];

/** The one-row blocks both check scripts print after their first, each by the header line psql -A -F '|' prints. */
const BLOCKS = [
  'other_client_sessions',
  ['relations_034_expected', 'relations_034_present', 'relations_034_as_created', 'project_brain_relations_other',
    'project_brain_relations_other_names', ...RELATIONS].join('|'),
  ['functions_034_expected', 'functions_034_present', 'triggers_034_expected', 'triggers_034_present', 'triggers_034_as_created',
    'project_brain_triggers_other', 'project_brain_triggers_other_names', ...TRIGGERS].join('|'),
  ['constraints_034_expected', 'constraints_034_present', 'constraints_034_as_created', 'constraints_034_wrong_names',
    'constraints_on_034_tables_other', 'constraints_on_034_tables_other_names', 'fk_constraints_034', 'deferred_fks_to_project_brain_mutations'].join('|'),
  'project_brain_mutations_operations|project_brain_mutations_operation_count',
  TABLES.map((table) => `${table}_rows`).join('|'),
  'project_brain_mutations_rows|component_operations_in_log',
  'catalog_034_md5',
  'apply_role|owner_029_tables|apply_role_owns_029|owner_034_tables',
  'migration_033_applied|migration_034_applied|ledger_count|ledger_last',
];
const PRE_BLOCKS = ['checked_at|database|checked_by|server', ...BLOCKS];
const POST_BLOCKS = ['checked_at|database', ...BLOCKS];

type Rows = Array<Record<string, unknown>>;
type Result = { command: string; rows: Rows; fields: Array<{ name: string }> };
type Refusal = { code: string | undefined; message: string };
const refusalOf = (error: unknown): Refusal => ({ code: (error as { code?: string }).code, message: (error as Error).message });

suite('migration 034: the Project Brain components, applied explicitly after 033', () => {
  const nonce = randomBytes(5).toString('hex');
  let admin: Pool;
  const made: Array<{ name: string; pool: Pool }> = [];

  const create = async (label: string): Promise<Pool> => {
    const name = `wonderland034${label}${nonce}`;
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(databaseUrl!);
    url.pathname = `/${name}`;
    const pool = new Pool({ connectionString: url.toString(), max: 2 });
    made.push({ name, pool });
    return pool;
  };
  /** One project, the row a mutation-log entry references. */
  const seed = async (pool: Pool): Promise<void> => {
    await pool.query('INSERT INTO relay_wonderland.projects(project_id) VALUES($1)', [PROJECT]);
  };
  /** A fresh database migrated through `migrations` from the real list, then seeded. */
  const migrated = async (label: string, migrations: readonly string[]): Promise<Pool> => {
    const pool = await create(label);
    for (const sql of migrations) await pool.query(sql);
    await seed(pool);
    return pool;
  };
  const at033 = (label: string): Promise<Pool> => migrated(label, BEFORE_034);

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
  const at034 = async (label: string): Promise<Pool> => {
    const pool = await at033(label);
    expect((await run(pool, WONDERLAND_MIGRATION_034)).refusal, `${label}: 034 applies`).toBeNull();
    return pool;
  };

  const count = async (pool: Pool, sql: string, values: unknown[] = []): Promise<number> => Number((await pool.query(sql, values)).rows[0].n);
  const stamped = (pool: Pool) => count(pool, 'SELECT count(*) AS n FROM relay_wonderland.schema_migrations WHERE version = $1', [STAMP_034]);
  const ledgerLast = async (pool: Pool): Promise<string> => (await pool.query(
    'SELECT max(version COLLATE "C") AS v FROM relay_wonderland.schema_migrations',
  )).rows[0].v as string;
  /**
   * relay_wonderland's catalog, by definition (wonderland-migration-033's, line for line): every relation, column,
   * constraint and index; every trigger WITH ITS OID; the internal RI triggers by table, function, type and constraint;
   * every function with its oid and body digest; every sequence and type. Sorted here, not by ORDER BY.
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
  /** The database's TOAST relations: each of 034's tables brings its own, and DOWN must take every one away. */
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
  /** The operations 029's CHECK, as 034 replaces it, admits: every quoted literal of its definition, sorted. */
  const operations = async (pool: Pool): Promise<string[]> => (await pool.query(`
    SELECT (regexp_matches(pg_get_constraintdef(k.oid), '''([A-Z_]+)''', 'g'))[1] AS op FROM pg_constraint k
     WHERE k.conrelid = 'relay_wonderland.project_brain_mutations'::regclass AND k.conname = 'project_brain_mutations_operation_check'`))
    .rows.map((row: { op: string }) => row.op).sort();
  /** One mutation-log row, as the store writes one (029's columns), with the operation given. */
  const logMutation = (pool: Pool, operation: string, mutationId: string) => pool.query(
    `INSERT INTO relay_wonderland.project_brain_mutations(mutation_id,project_id,idempotency_key,request_hash,operation,author_kind,author_id,deliverer_kind,deliverer_id,event_id,result,occurred_at)
     VALUES($1,$2,$3,$4,$5,'JULIUS','julius','JULIUS_RUNTIME','relay-bridge:julius',$6,'{}'::jsonb,now())`,
    [mutationId, PROJECT, `ik-${mutationId}`, 'a'.repeat(64), operation, `event:${mutationId}`]);

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
    // An explicit bound (as #344 gives 030-033's): this loop ends, terminates and drops one database per case.
  }, 120_000);

  it("A: at 033, 034 applies: the one catalog line it removes is 029's operation CHECK, every line it adds is a project_brain object (the 21 relations exactly), and no existing row changes (the ledger gains the stamp alone)", async () => {
    const pool = await at033('clean');
    const [catalogBefore, toastBefore, rowsBefore] = [await catalog(pool), await toastRelations(pool), await rowCounts(pool)];
    const applied = await run(pool, WONDERLAND_MIGRATION_034);
    expect(applied.refusal, '034 applies').toBeNull();
    const notice = applied.notices.filter((line) => line.startsWith('migration_034_precheck:'));
    expect(notice, 'one precheck NOTICE').toHaveLength(1);
    expect(notice[0], 'with the counts').toContain('project_brain_mutations 0; ledger ');
    expect(applied.notices, 'and no other NOTICE').toHaveLength(1);

    const catalogAfter = await catalog(pool);
    const removed = catalogBefore.filter((line) => !catalogAfter.includes(line));
    const replaced = 'constraint relay_wonderland.project_brain_mutations project_brain_mutations_operation_check ';
    expect(removed.map((line) => line.slice(0, replaced.length)), "the one line removed: 029's operation CHECK, replaced under its name").toEqual([replaced]);
    const added = catalogAfter.filter((line) => !catalogBefore.includes(line));
    expect(added.filter((line) => line.startsWith(replaced)), 'and its replacement').toHaveLength(1);
    expect(added.filter((line) => !line.includes('project_brain')), 'every line added is a project_brain object').toEqual([]);
    expect(added.filter((line) => line.startsWith('relation ')).map((line) => line.split(' ')[1]).sort(), 'the 21 relations, exactly')
      .toEqual([...RELATIONS].sort());
    // Two RI triggers on the referenced table per foreign key: 9 references to projects, 3 to julius_runs, 9 to the log.
    for (const [table, triggers] of [['projects', 18], ['julius_runs', 6], ['project_brain_mutations', 18]] as const) {
      expect(added.filter((line) => line.startsWith(`internal trigger ${table} `)), `${table}: RI triggers of 034's references`).toHaveLength(triggers);
    }
    expect(await toastRelations(pool), 'the new tables bring their TOAST relations').toBeGreaterThan(toastBefore);
    expect(await operations(pool), 'the mutation log admits the 15 operations').toEqual([...OPERATIONS_034].sort());

    const rowsAfter = await rowCounts(pool);
    const withStamp = rowsBefore.map((line) => (line.startsWith('schema_migrations ') ? `schema_migrations ${Number(line.split(' ')[1]) + 1}` : line));
    expect(withStamp, 'the ledger is counted').not.toEqual(rowsBefore);
    expect(rowsAfter.filter((line) => !TABLES.includes(line.split(' ')[0]!)), 'no existing row changed; the ledger gained the stamp alone').toEqual(withStamp);
    expect(rowsAfter.filter((line) => TABLES.includes(line.split(' ')[0]!)), "034's tables are empty: 034 writes no row")
      .toEqual(TABLES.map((table) => `${table} 0`).sort());
    expect(await stamped(pool)).toBe(1);
    expect(await ledgerLast(pool), "and the stamp is the ledger's last").toBe(STAMP_034);
  }, 180_000);

  it('G: the guard refuses, changing and stamping nothing: before 033, a second time, after a later stamp, and when a name 034 creates is taken', async () => {
    // THE CONTROLS for the implicit names: a taken key name, or a taken constraint name, is NOT an error; PostgreSQL picks
    // another one (constraint names are chosen unique across the schema, not the table).
    const control = await at033('implicitcontrol');
    const client = await control.connect();
    try {
      await client.query('BEGIN');
      await client.query('CREATE TABLE relay_wonderland.probe_034(x int, y int, CONSTRAINT project_brain_evals_check CHECK (x <> y))');
      await client.query('CREATE INDEX project_brain_cards_pkey ON relay_wonderland.probe_034(x)');
      await client.query('CREATE TABLE relay_wonderland.project_brain_cards(card_id text PRIMARY KEY)');
      await client.query("CREATE TABLE relay_wonderland.project_brain_evals(result text, evidence_refs jsonb, CHECK(result<>'PASS' OR jsonb_array_length(evidence_refs)>0))");
      const key = (await client.query(
        "SELECT conindid::regclass::text AS i FROM pg_constraint WHERE conrelid = 'relay_wonderland.project_brain_cards'::regclass AND contype = 'p'",
      )).rows[0].i as string;
      expect(key, 'CONTROL: without the guard the key is quietly renamed').toBe('relay_wonderland.project_brain_cards_pkey1');
      const check = (await client.query(
        "SELECT conname AS c FROM pg_constraint WHERE conrelid = 'relay_wonderland.project_brain_evals'::regclass AND contype = 'c'",
      )).rows.map((row: { c: string }) => row.c);
      expect(check, 'CONTROL: without the guard the CHECK is quietly renamed').toEqual(['project_brain_evals_check1']);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }

    const laterStamped = await at033('laterstamp');
    await laterStamped.query('INSERT INTO relay_wonderland.schema_migrations(version) VALUES($1)', ['035_later_lane_probe']);
    const tableTaken = await at033('tabletaken');
    await tableTaken.query('CREATE TABLE relay_wonderland.project_brain_cards(x int)');
    const keyTaken = await at033('keytaken');
    await keyTaken.query('CREATE TABLE relay_wonderland.probe_034(x int); CREATE INDEX project_brain_cards_pkey ON relay_wonderland.probe_034(x)');
    const constraintTaken = await at033('constrainttaken');
    await constraintTaken.query('CREATE TABLE relay_wonderland.probe_034(x int, CONSTRAINT project_brain_evals_check CHECK (x > 0))');
    const functionTaken = await at033('functiontaken');
    await functionTaken.query("CREATE FUNCTION relay_wonderland.project_brain_component_guard() RETURNS int LANGUAGE sql AS 'SELECT 1'");
    const triggerTaken = await at033('triggertaken');
    await triggerTaken.query(`CREATE TRIGGER project_brain_records_truncate_refused BEFORE TRUNCATE ON relay_wonderland.project_brain_records
      FOR EACH STATEMENT EXECUTE FUNCTION relay_wonderland.project_brain_refuse_change()`);
    const taken = 'migration_034_refused: name(s) 034 creates are already taken in relay_wonderland';
    const cases: Array<[string, Pool, string]> = [
      ['033 not applied', await migrated('at032', BEFORE_033), 'migration_034_refused: 033 is not applied here'],
      ['034 already applied', await at034('twice'), 'migration_034_refused: 034 is already applied here'],
      ['a later stamp', laterStamped, "migration_034_refused: the ledger's last stamp is 035_later_lane_probe, not 033"],
      ['a table taken', tableTaken, `${taken} (project_brain_cards)`],
      ['an implicit key name taken', keyTaken, `${taken} (project_brain_cards_pkey)`],
      ['an implicit constraint name taken', constraintTaken, `${taken} (project_brain_evals_check)`],
      ['a function name taken', functionTaken, `${taken} (project_brain_component_guard)`],
      ['a trigger name taken', triggerTaken, `${taken} (project_brain_records_truncate_refused)`],
    ];
    for (const [label, pool, refusal] of cases) {
      const [catalogBefore, stampsBefore] = [await catalog(pool), await stamped(pool)];
      const attempt = await run(pool, WONDERLAND_MIGRATION_034);
      expect(attempt.refusal?.message, label).toContain(refusal);
      expect(attempt.notices.some((line) => line.startsWith('migration_034_precheck:')), `${label}: no precheck NOTICE`).toBe(false);
      expect(await catalog(pool), `${label}: nothing changed`).toEqual(catalogBefore);
      expect(await stamped(pool), `${label}: nothing stamped`).toBe(stampsBefore);
    }
  }, 600_000);

  it("H: the committed DOWN script refuses while a later migration is applied and while an object is not as 034 created it; then it restores the catalog and every row count EXACTLY and removes the stamp", async () => {
    const pool = await at033('down');
    const [catalogBefore, toastBefore, rowsBefore] = [await catalog(pool), await toastRelations(pool), await rowCounts(pool)];
    expect((await run(pool, WONDERLAND_MIGRATION_034)).refusal, '034 applies').toBeNull();

    // THE ROLLBACK ORDER, from 033's side: its DOWN refuses while 034 is stamped.
    expect((await run(pool, DOWN_033)).refusal?.message, "033's DOWN while 034 is applied")
      .toContain(`migration_033_down_refused: a later migration is applied (${STAMP_034})`);

    const refusedWith = async (label: string, refusal: string): Promise<void> => {
      const [catalogAt, rowsAt] = [await catalog(pool), await rowCounts(pool)];
      expect((await run(pool, DOWN)).refusal?.message, label).toContain(refusal);
      expect(await catalog(pool), `${label}: nothing changed`).toEqual(catalogAt);
      expect(await rowCounts(pool), `${label}: no row changed`).toEqual(rowsAt);
      expect(await stamped(pool), `${label}: still stamped`).toBe(1);
    };
    // A later lane's stamp (035 is voice's number). Rolling 034 back under it would leave a gap in the ledger.
    await pool.query('INSERT INTO relay_wonderland.schema_migrations(version) VALUES($1)', ['035_later_lane_probe']);
    await refusedWith('a later migration', 'migration_034_down_refused: a later migration is applied (035_later_lane_probe)');
    await pool.query('DELETE FROM relay_wonderland.schema_migrations WHERE version = $1', ['035_later_lane_probe']);

    // OBJECTS NOT AS 034 CREATED THEM: refused, then put back exactly as 034 writes them.
    await pool.query('DROP INDEX relay_wonderland.project_brain_evals_subject');
    await refusedWith('an index missing', "migration_034_down_refused: object(s) not exactly as 034 created them, or not 034's (project_brain_evals_subject)");
    await pool.query('CREATE INDEX project_brain_evals_subject ON relay_wonderland.project_brain_evals(project_id,subject_ref,subject_revision)');
    await pool.query('DROP TRIGGER project_brain_links_truncate_refused ON relay_wonderland.project_brain_links');
    await refusedWith('a trigger on 029\'s table missing', "migration_034_down_refused: object(s) not exactly as 034 created them, or not 034's (project_brain_links_truncate_refused)");
    await pool.query(`CREATE TRIGGER project_brain_links_truncate_refused BEFORE TRUNCATE ON relay_wonderland.project_brain_links
      FOR EACH STATEMENT EXECUTE FUNCTION relay_wonderland.project_brain_truncate_refused()`);
    await pool.query('CREATE INDEX project_brain_extra_probe ON relay_wonderland.project_brain_cards(name)');
    await refusedWith('another project_brain_* relation', "migration_034_down_refused: object(s) not exactly as 034 created them, or not 034's (project_brain_extra_probe)");
    await pool.query('DROP INDEX relay_wonderland.project_brain_extra_probe');

    expect((await run(pool, DOWN)).refusal, 'DOWN applies').toBeNull();
    expect(await catalog(pool), "the whole catalog, 029's CHECK and the RI triggers on projects and julius_runs included: identical to before 034").toEqual(catalogBefore);
    expect(await toastRelations(pool), 'every TOAST relation 034 brought is gone').toBe(toastBefore);
    expect(await rowCounts(pool), 'every row count: identical to before 034').toEqual(rowsBefore);
    expect(await operations(pool), "the mutation log admits 029's four operations again").toEqual([...OPERATIONS_029].sort());
    expect(await stamped(pool), 'the stamp is gone').toBe(0);
    expect(await ledgerLast(pool), 'the ledger ends at 033 again').toBe(STAMP_033);
    expect((await run(pool, DOWN)).refusal?.message, 'DOWN where 034 is not applied').toContain('migration_034_down_refused: 034 is not applied here');
    // DOWN returns the store to exactly what 034's guard accepts.
    expect((await run(pool, WONDERLAND_MIGRATION_034)).refusal, '034 applies again after DOWN').toBeNull();
    expect(await stamped(pool)).toBe(1);
  }, 300_000);

  it('DATA: DOWN refuses while Project Brain component data exists -- a component operation in the append-only log, a row in one of its tables -- and changes nothing', async () => {
    const refused = async (pool: Pool, label: string, refusal: string): Promise<void> => {
      const [catalogAt, rowsAt] = [await catalog(pool), await rowCounts(pool)];
      expect((await run(pool, DOWN)).refusal?.message, label).toContain(refusal);
      expect(await catalog(pool), `${label}: nothing changed`).toEqual(catalogAt);
      expect(await rowCounts(pool), `${label}: no row changed`).toEqual(rowsAt);
      expect(await stamped(pool), `${label}: still stamped`).toBe(1);
    };
    const data = 'migration_034_down_refused: Project Brain component data exists';
    // A component operation alone: no row of 034's, but 029's CHECK could never be restored over it.
    const logged = await at034('dataops');
    await logMutation(logged, 'CARD_CREATE', 'pbm:probe-ops');
    await refused(logged, 'a component operation in the log', `${data} (operation CARD_CREATE 1)`);
    // A row of 034's, written by an operation 029 admits (the log cannot tell it apart; the table can).
    const rowed = await at034('datarows');
    await logMutation(rowed, 'CREATE', 'pbm:probe-rows');
    await rowed.query("INSERT INTO relay_wonderland.project_brain_card_selection(project_id,card_ref,version,updated_at,last_mutation_id) VALUES($1,'pbcard:default',1,now(),'pbm:probe-rows')", [PROJECT]);
    await refused(rowed, 'a row in one of 034\'s tables', `${data} (project_brain_card_selection 1)`);
  }, 300_000);

  it("CAT: 034's catalog EXACTLY, by name, from the product's migrate(): every trigger, constraint, index and function, and the 15 operations of the log", async () => {
    // The lists above are 034's, written out by hand; each is checked for its own size so a typo cannot shrink a check.
    expect(TRIGGER_SPEC, '25 triggers').toHaveLength(25);
    expect(CONSTRAINT_LINES, '69 named constraints').toHaveLength(69);
    expect(CONSTRAINT_LINES.filter((line) => line.split(' ')[2] === 'f'), '24 foreign keys').toHaveLength(24);
    expect(CONSTRAINT_LINES.filter((line) => line.endsWith('deferred=true')), '9 deferred references to the log').toHaveLength(9);
    expect(INDEX_SPEC, '12 indexes').toHaveLength(12);

    const pool = await create('catalog');
    await new TransactionalWonderlandDatabase(pool).migrate();
    const lines = async (sql: string, values: unknown[] = []): Promise<string[]> => (await pool.query(sql, values)).rows.map((row: { line: string }) => row.line).sort();

    const triggers = await lines(`
      SELECT c.relname || ' ' || t.tgname || ' ' || p.proname || ' type=' || t.tgtype::text || ' enabled=' || t.tgenabled::text
             || ' when=' || (t.tgqual IS NOT NULL)::text || ' args=' || t.tgnargs::text AS line
        FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_proc p ON p.oid = t.tgfoid
       WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND NOT t.tgisinternal AND c.relname LIKE 'project\\_brain\\_%'`);
    expect(triggers, "every trigger on a Project Brain table: 029's 4 and 034's 25, exactly").toEqual(
      [...TRIGGER_SPEC_029, ...TRIGGER_SPEC].map(([table, trigger, fn, type]) => `${table} ${trigger} ${fn} type=${type} enabled=O when=false args=0`).sort());

    const constraints = await lines(`
      SELECT c.relname || ' ' || k.conname || ' ' || k.contype::text || ' ' || coalesce(f.relname::text, '-')
             || ' deferrable=' || k.condeferrable::text || ' deferred=' || k.condeferred::text AS line
        FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid LEFT JOIN pg_class f ON f.oid = k.confrelid
       WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND c.relname = ANY($1::text[]) AND k.contype IN ('p', 'u', 'f', 'c', 'x')`, [TABLES]);
    expect(constraints, "every constraint on 034's tables (NOT NULL aside), by name, type, referenced table and deferral").toEqual([...CONSTRAINT_LINES].sort());

    const indexes = await lines(`
      SELECT c.relname || ' ' || x.relname || ' unique=' || i.indisunique::text || ' primary=' || i.indisprimary::text
             || ' cols=' || (SELECT string_agg(a.attname::text, ',' ORDER BY k.ord) FROM unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
                              JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum)
             || ' partial=' || (i.indpred IS NOT NULL)::text AS line
        FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid JOIN pg_class x ON x.oid = i.indexrelid
       WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND c.relname = ANY($1::text[])`, [TABLES]);
    expect(indexes, "every index on 034's tables: columns, unique, primary, partial").toEqual(
      INDEX_SPEC.map(([table, index, unique, primary, columns, partial]) => `${table} ${index} unique=${unique} primary=${primary} cols=${columns} partial=${partial}`).sort());

    const functions = await lines(`
      SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') returns ' || format_type(p.prorettype, NULL) AS line
        FROM pg_proc p WHERE p.pronamespace = 'relay_wonderland'::regnamespace AND p.proname LIKE 'project\\_brain\\_%'`);
    expect(functions, "every Project Brain function: 029's 3 and 034's 3").toEqual(
      ['project_brain_refuse_change', 'project_brain_record_guard', 'project_brain_notify', ...FUNCTIONS].map((fn) => `${fn}() returns trigger`).sort());

    expect(await operations(pool), 'the mutation log admits exactly the 15 operations').toEqual([...OPERATIONS_034].sort());
    const tables = await lines("SELECT c.relname AS line FROM pg_class c WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND c.relkind = 'r' AND c.relname LIKE 'project\\_brain\\_%'");
    expect(tables, "every Project Brain table: 029's 4 and 034's 9").toEqual([...TABLES_029, ...TABLES].sort());
  }, 180_000);

  it("CHAIN: the product's migrate() carries 034 right after 033, so a new database has its 9 tables, no row in them, and the stamp", async () => {
    expect(WONDERLAND_MIGRATIONS.indexOf(WONDERLAND_MIGRATION_033), '033 is registered').toBeGreaterThan(0);
    expect(WONDERLAND_MIGRATIONS.indexOf(WONDERLAND_MIGRATION_034), 'listed right after 033').toBe(WONDERLAND_MIGRATIONS.indexOf(WONDERLAND_MIGRATION_033) + 1);
    const pool = await create('chain');
    await new TransactionalWonderlandDatabase(pool).migrate();
    const present = (await pool.query(
      "SELECT c.relname AS r FROM pg_class c WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND c.relname = ANY($1::text[])", [RELATIONS],
    )).rows.map((row: { r: string }) => row.r).sort();
    expect(present, 'the 21 relations, exactly').toEqual([...RELATIONS].sort());
    for (const table of TABLES) expect(await count(pool, `SELECT count(*) AS n FROM relay_wonderland.${table}`), `${table}: no row`).toBe(0);
    expect(await stamped(pool)).toBe(1);
  }, 120_000);

  it("DOCS: the runbook's read-only pre-check and post-check print exactly their fixed one-row blocks and report what its STOP and PASS lists name, before and after 034 and after DOWN", async () => {
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
    const every = (keys: readonly string[], value: string | null) => Object.fromEntries(keys.map((key) => [key, value]));
    const SUMMARY = ['relations_034_expected', 'relations_034_present', 'relations_034_as_created', 'project_brain_relations_other', 'project_brain_relations_other_names',
      'functions_034_expected', 'functions_034_present', 'triggers_034_expected', 'triggers_034_present', 'triggers_034_as_created',
      'project_brain_triggers_other', 'project_brain_triggers_other_names', 'constraints_034_expected', 'constraints_034_present',
      'constraints_034_as_created', 'constraints_034_wrong_names', 'constraints_on_034_tables_other', 'constraints_on_034_tables_other_names',
      'fk_constraints_034', 'deferred_fks_to_project_brain_mutations'];
    const ROWS = TABLES.map((table) => `${table}_rows`);
    const LEDGER = ['migration_033_applied', 'migration_034_applied', 'ledger_last'];
    const OPS = ['project_brain_mutations_operations', 'project_brain_mutations_operation_count'];
    const summary = (present: string, fks: string, deferred: string) => ({
      relations_034_expected: '21', relations_034_present: present === '0' ? '0' : '21', relations_034_as_created: present === '0' ? '0' : '21',
      project_brain_relations_other: '0', project_brain_relations_other_names: null,
      functions_034_expected: '3', functions_034_present: present === '0' ? '0' : '3',
      triggers_034_expected: '25', triggers_034_present: present === '0' ? '0' : '25', triggers_034_as_created: present === '0' ? '0' : '25',
      project_brain_triggers_other: '0', project_brain_triggers_other_names: null,
      constraints_034_expected: '69', constraints_034_present: present, constraints_034_as_created: present, constraints_034_wrong_names: null,
      constraints_on_034_tables_other: '0', constraints_on_034_tables_other_names: null,
      fk_constraints_034: fks, deferred_fks_to_project_brain_mutations: deferred,
    });

    const pool = await at033('docs');
    const pre = await check(pool, PRECHECK, PRE_BLOCKS);
    expect(named(pre, SUMMARY), 'the pre-check passes its STOP list at 033').toEqual(summary('0', '0', '0'));
    expect(named(pre, [...RELATIONS, ...TRIGGERS]), 'nothing 034 creates exists').toEqual(every([...RELATIONS, ...TRIGGERS], 'false'));
    expect(named(pre, ROWS), 'no table to count').toEqual(every(ROWS, null));
    expect(named(pre, OPS), "029's operation CHECK").toEqual({ project_brain_mutations_operations: [...OPERATIONS_029].sort().join(','), project_brain_mutations_operation_count: '4' });
    expect(named(pre, ['catalog_034_md5', 'component_operations_in_log', 'apply_role_owns_029', 'owner_034_tables']), 'nothing of 034 in the catalog; the apply role owns 029')
      .toEqual({ catalog_034_md5: null, component_operations_in_log: '0', apply_role_owns_029: 'true', owner_034_tables: null });
    expect(named(pre, LEDGER)).toEqual({ migration_033_applied: 'true', migration_034_applied: 'false', ledger_last: STAMP_033 });

    expect((await run(pool, WONDERLAND_MIGRATION_034)).refusal).toBeNull();
    const post = await check(pool, POSTCHECK, POST_BLOCKS);
    expect(named(post, SUMMARY), 'the post-check passes its PASS list after 034').toEqual(summary('69', '24', '9'));
    expect(named(post, [...RELATIONS, ...TRIGGERS]), 'everything exactly as 034 creates it').toEqual(every([...RELATIONS, ...TRIGGERS], 'true'));
    expect(named(post, ROWS), 'every table empty: 034 writes no row').toEqual(every(ROWS, '0'));
    expect(named(post, OPS), "034's operation CHECK").toEqual({ project_brain_mutations_operations: [...OPERATIONS_034].sort().join(','), project_brain_mutations_operation_count: '15' });
    expect(named(post, LEDGER)).toEqual({ migration_033_applied: 'true', migration_034_applied: 'true', ledger_last: STAMP_034 });
    expect(Number(post.ledger_count), 'the ledger grew by the stamp alone').toBe(Number(pre.ledger_count) + 1);
    expect(text(post.project_brain_mutations_rows), 'no mutation-log row changed').toBe(text(pre.project_brain_mutations_rows));
    expect(text(post.component_operations_in_log)).toBe('0');
    expect(text(post.owner_034_tables), "one role owns 029's tables and 034's").toBe(text(pre.owner_029_tables));
    expect(text(post.apply_role_owns_029)).toBe('true');

    // THE TWO PATHS BUILD THE SAME 034: this explicit apply, and the product's migrate() on a new database.
    expect(text(post.catalog_034_md5), 'a digest after 034').toMatch(/^[0-9a-f]{32}$/u);
    const chained = await create('docschain');
    await new TransactionalWonderlandDatabase(chained).migrate();
    expect((await check(chained, POSTCHECK, POST_BLOCKS)).catalog_034_md5, 'migrate() builds the same 034').toBe(post.catalog_034_md5);

    // AFTER DOWN, step 2's check passes its STOP list again, with every recorded value equal to the original pre-check's
    // (the session count aside: this suite's own pool holds a varying number of idle sessions).
    expect((await run(pool, DOWN)).refusal, 'DOWN applies').toBeNull();
    const again = await check(pool, PRECHECK, PRE_BLOCKS);
    const unstamped = (facts: Record<string, unknown>) => Object.fromEntries(Object.entries(facts)
      .filter(([key]) => !['checked_at', 'database', 'checked_by', 'server', 'other_client_sessions'].includes(key)).map(([key, value]) => [key, text(value)]));
    expect(unstamped(again), 'the pre-check record after DOWN equals the one before 034').toEqual(unstamped(pre));
  }, 300_000);
});
