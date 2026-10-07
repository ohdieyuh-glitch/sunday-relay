import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { juliusTestDatabaseUrl } from './julius-test-database';
import { TransactionalWonderlandDatabase, WONDERLAND_MIGRATIONS, WONDERLAND_MIGRATION_035 } from './wonderland-postgres';

/**
 * MIGRATION 035: THE WONDERLAND VOICE BINDING, APPLIED EXPLICITLY AFTER 034 (founder ruling 2026-10-04 16:30Z; R16 real EOS Voice).
 * The 033 suite's cases, scaled to 035's one table (SECOND WONDERLAND, 2026-10-07; DRAFT until 034 has landed and this runs green).
 *
 * 035 creates 3 relations in relay_wonderland -- voice_puid_binding and its 2 indexes (the primary key, the unique puid), both named
 * by PostgreSQL itself -- and 1 foreign key (on players), writes NO row and changes no existing row. Each case is its OWN database:
 *   A      at 034, 035 applies with ONE precheck NOTICE; every catalog line it adds is a voice_* object (the 3 relations exactly, 2
 *          internal RI triggers on players), none is removed; no existing row changes; the table is empty; the stamp is the last;
 *   G      the guard refuses, changing and stamping nothing: before 034, a second time, after a later stamp, and when a relation 035
 *          creates already exists (the table, the implicit pkey name, the implicit puid-key name);
 *   POST   the post-check refuses, rolling everything back, when what the file creates is not what it proves (the unique key
 *          missing, a row written, the foreign key missing);
 *   H      the committed DOWN refuses while a later migration is applied, while a binding exists and while a relation is not as 035
 *          created it; then it restores the catalog EXACTLY and every row count, removes the stamp, refuses where 035 is not
 *          applied, and 035 applies again. 033's DOWN refuses while 035 is stamped;
 *   INV    033's store still works after 035 (its 47 relations, a social row written and read);
 *   CHAIN  the product's migrate() carries 035 right after 034;
 *   DOCS   the runbook's pre-check and post-check print exactly their fixed one-row blocks and report what their STOP / PASS lists
 *          name, before and after 035; the explicit apply and migrate() print the same catalog_035_md5.
 * Runs wherever JULIUS_TEST_DATABASE_URL names a THROWAWAY server (never DATABASE_URL); `todo` elsewhere.
 */

const databaseUrl = juliusTestDatabaseUrl();
const suite = databaseUrl !== null ? describe : describe.todo;
const DOCS = join(__dirname, '..', '..', '..', 'docs', 'julius-migrations');
const committed = (migration: string, name: string): string => readFileSync(join(DOCS, migration, name), 'utf8')
  .replace(/^\\set ON_ERROR_STOP on\s*$/mu, ''); // a psql meta-command; the driver runs plain SQL
const DOWN = committed('035', 'down.sql');
const PRECHECK = committed('035', 'precheck.sql');
const POSTCHECK = committed('035', 'postcheck.sql');
const DOWN_033 = committed('033', 'down.sql');
const INDEX_035 = WONDERLAND_MIGRATIONS.indexOf(WONDERLAND_MIGRATION_035);
const BEFORE_035 = WONDERLAND_MIGRATIONS.slice(0, INDEX_035);
const BEFORE_034 = WONDERLAND_MIGRATIONS.slice(0, INDEX_035 - 1);   // CHAIN proves 034 sits right before 035
const STAMP_034 = '034_project_brain_components';
const STAMP_035 = '035_wonderland_voice';
const PLAYERS = ['usr_035_a', 'usr_035_b'];
const RELATIONS = ['voice_puid_binding', 'voice_puid_binding_pkey', 'voice_puid_binding_puid_key'];
const PUID = 'a'.repeat(32);

const BLOCKS = [
  'other_client_sessions',
  ['relations_035_expected', 'relations_035_present', 'relations_035_as_created', 'voice_relations_other',
    'voice_relations_other_names', ...RELATIONS].join('|'),
  'voice_puid_binding_rows',
  'catalog_035_md5',
  'players_rows|players_referenced_by_fks|voice_fk_constraints',
  'migration_034_applied|migration_035_applied|ledger_count|ledger_last',
];
const PRE_BLOCKS = ['checked_at|database|checked_by|server', ...BLOCKS];
const POST_BLOCKS = ['checked_at|database', ...BLOCKS];

type Rows = Array<Record<string, unknown>>;
type Result = { command: string; rows: Rows; fields: Array<{ name: string }> };
type Refusal = { code: string | undefined; message: string };
const refusalOf = (error: unknown): Refusal => ({ code: (error as { code?: string }).code, message: (error as Error).message });

suite('migration 035: the Wonderland voice binding, applied explicitly after 034 (R16)', () => {
  const nonce = randomBytes(5).toString('hex');
  let admin: Pool;
  const made: Array<{ name: string; pool: Pool }> = [];

  const create = async (label: string): Promise<Pool> => {
    const name = `wonderland035${label}${nonce}`;
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(databaseUrl!);
    url.pathname = `/${name}`;
    const pool = new Pool({ connectionString: url.toString(), max: 2 });
    made.push({ name, pool });
    return pool;
  };
  const seed = async (pool: Pool): Promise<void> => {
    await pool.query('INSERT INTO relay_wonderland.players(player_id) SELECT unnest($1::text[])', [PLAYERS]);
  };
  const migrated = async (label: string, migrations: readonly string[]): Promise<Pool> => {
    const pool = await create(label);
    for (const sql of migrations) await pool.query(sql);
    await seed(pool);
    return pool;
  };
  const at034 = (label: string): Promise<Pool> => migrated(label, BEFORE_035);
  const run = async (pool: Pool, script: string): Promise<{ refusal: Refusal | null; notices: string[]; results: Result[] }> => {
    const client = await pool.connect();
    const notices: string[] = [];
    client.on('notice', (notice) => { notices.push(notice.message ?? ''); });
    try {
      const raw: unknown = await client.query(script);
      return { refusal: null, notices, results: (Array.isArray(raw) ? raw : [raw]) as Result[] };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      return { refusal: refusalOf(error), notices, results: [] };
    } finally {
      client.removeAllListeners('notice');
      client.release();
    }
  };
  const at035 = async (label: string): Promise<Pool> => {
    const pool = await at034(label);
    expect((await run(pool, WONDERLAND_MIGRATION_035)).refusal, `${label}: 035 applies`).toBeNull();
    return pool;
  };
  const count = async (pool: Pool, sql: string, values: unknown[] = []): Promise<number> => Number((await pool.query(sql, values)).rows[0].n);
  const stamped = (pool: Pool) => count(pool, 'SELECT count(*) AS n FROM relay_wonderland.schema_migrations WHERE version = $1', [STAMP_035]);
  const ledgerLast = async (pool: Pool): Promise<string> => (await pool.query(
    'SELECT max(version COLLATE "C") AS v FROM relay_wonderland.schema_migrations',
  )).rows[0].v as string;
  /** relay_wonderland's catalog by definition (the 033 suite's reading, verbatim in substance), sorted here. */
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
  const toastRelations = (pool: Pool) => count(pool, "SELECT count(*) AS n FROM pg_class WHERE relnamespace = 'pg_toast'::regnamespace");
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
      pool.on('error', () => undefined);
      await pool.end().catch(() => undefined);
      await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [name]).catch(() => undefined);
      await admin.query(`DROP DATABASE IF EXISTS ${name}`).catch(() => undefined);
    }
    await admin?.end().catch(() => undefined);
  }, 60_000);

  it('A: at 034, 035 applies: every catalog line it adds is a voice_* object (the 3 relations exactly, 2 internal triggers on players), none is removed, and no existing row changes', async () => {
    const pool = await at034('clean');
    const [catalogBefore, rowsBefore] = [await catalog(pool), await rowCounts(pool)];
    const applied = await run(pool, WONDERLAND_MIGRATION_035);
    expect(applied.refusal, '035 applies').toBeNull();
    const notice = applied.notices.filter((line) => line.startsWith('migration_035_precheck:'));
    expect(notice, 'one precheck NOTICE').toHaveLength(1);
    expect(notice[0], 'with the counts').toContain(`players ${PLAYERS.length}`);
    expect(applied.notices, 'and no other NOTICE').toHaveLength(1);
    const catalogAfter = await catalog(pool);
    expect(catalogBefore.filter((line) => !catalogAfter.includes(line)), 'nothing removed or changed').toEqual([]);
    const added = catalogAfter.filter((line) => !catalogBefore.includes(line));
    expect(added.filter((line) => !line.includes('voice_')), 'every line added is a voice_* object').toEqual([]);
    expect(added.filter((line) => line.startsWith('relation ')).map((line) => line.split(' ')[1]).sort(), 'the 3 relations, exactly')
      .toEqual([...RELATIONS].sort());
    expect(added.filter((line) => line.startsWith('internal trigger players ')), 'two RI triggers on players for its one foreign key').toHaveLength(2);
    const withStamp = rowsBefore.map((line) => (line.startsWith('schema_migrations ') ? `schema_migrations ${Number(line.split(' ')[1]) + 1}` : line));
    const rowsAfter = await rowCounts(pool);
    expect(rowsAfter.filter((line) => !line.startsWith('voice_')), 'no existing row changed; the ledger gained the stamp alone').toEqual(withStamp);
    expect(rowsAfter.filter((line) => line.startsWith('voice_')), 'the new table is empty').toEqual(['voice_puid_binding 0']);
    expect(await ledgerLast(pool), "the stamp is the ledger's last").toBe(STAMP_035);
  }, 180_000);

  it('G: the guard refuses, changing and stamping nothing: before 034, a second time, after a later stamp, and when a relation 035 creates already exists', async () => {
    const laterStamped = await at034('laterstamp');
    await laterStamped.query('INSERT INTO relay_wonderland.schema_migrations(version) VALUES($1)', ['036_later_lane_probe']);
    const tableTaken = await at034('tabletaken');
    await tableTaken.query('CREATE TABLE relay_wonderland.voice_puid_binding(x int)');
    const pkeyTaken = await at034('pkeytaken');
    await pkeyTaken.query('CREATE TABLE relay_wonderland.probe_035(x int); CREATE INDEX voice_puid_binding_pkey ON relay_wonderland.probe_035(x)');
    const puidKeyTaken = await at034('puidkeytaken');
    await puidKeyTaken.query('CREATE TABLE relay_wonderland.probe_035(x int); CREATE INDEX voice_puid_binding_puid_key ON relay_wonderland.probe_035(x)');
    const taken = 'migration_035_refused: relation(s) 035 creates, or named voice_*, already exist in relay_wonderland';
    const cases: Array<[string, Pool, string]> = [
      ['034 not applied', await migrated('at033', BEFORE_034), 'migration_035_refused: 034 is not applied here'],
      ['035 already applied', await at035('twice'), 'migration_035_refused: 035 is already applied here'],
      ['a later stamp', laterStamped, "migration_035_refused: the ledger's last stamp is 036_later_lane_probe, not 034"],
      ['the table taken', tableTaken, `${taken} (voice_puid_binding)`],
      ['the implicit pkey name taken', pkeyTaken, `${taken} (voice_puid_binding_pkey)`],
      ['the implicit puid-key name taken', puidKeyTaken, `${taken} (voice_puid_binding_puid_key)`],
    ];
    for (const [label, pool, refusal] of cases) {
      const [catalogBefore, stampsBefore] = [await catalog(pool), await stamped(pool)];
      const attempt = await run(pool, WONDERLAND_MIGRATION_035);
      expect(attempt.refusal?.message, label).toContain(refusal);
      expect(attempt.notices.some((line) => line.startsWith('migration_035_precheck:')), `${label}: no precheck NOTICE`).toBe(false);
      expect(await catalog(pool), `${label}: nothing changed`).toEqual(catalogBefore);
      expect(await stamped(pool), `${label}: nothing stamped`).toBe(stampsBefore);
    }
  }, 600_000);

  it('POST: the post-check refuses, rolling everything back, when what the file creates is not what it proves', async () => {
    const statement = (text: string): string => {
      expect(WONDERLAND_MIGRATION_035.split(text).length - 1, `written once: ${text}`).toBe(1);
      return text;
    };
    const mutants: Array<[string, string, string]> = [
      ['the unique puid key missing',
        WONDERLAND_MIGRATION_035.replace(statement("puid text NOT NULL UNIQUE CHECK(puid ~ '^[0-9a-f]{32}$'),"), "puid text NOT NULL CHECK(puid ~ '^[0-9a-f]{32}$'),"),
        "migration_035_postcheck: relation(s) not exactly as 035 creates them, or not 035's (voice_puid_binding_puid_key)"],
      ['a row written',
        WONDERLAND_MIGRATION_035.replace(statement('-- POST-CHECK, still inside the transaction:'),
          `INSERT INTO relay_wonderland.voice_puid_binding VALUES('${PLAYERS[0]}', '${PUID}', 's', now());\n-- POST-CHECK, still inside the transaction:`),
        'migration_035_postcheck: voice_puid_binding holds a row, and 035 writes none'],
      ['the foreign key missing',
        WONDERLAND_MIGRATION_035.replace(statement('user_id text PRIMARY KEY REFERENCES relay_wonderland.players ON DELETE CASCADE,'), 'user_id text PRIMARY KEY,'),
        'migration_035_postcheck: voice_puid_binding does not carry exactly the 1 foreign key'],
    ];
    const pool = await at034('postcheck');
    const catalogBefore = await catalog(pool);
    for (const [label, mutant, refusal] of mutants) {
      expect(mutant, `${label}: the mutant differs from 035`).not.toBe(WONDERLAND_MIGRATION_035);
      const attempt = await run(pool, mutant);
      expect(attempt.refusal?.message, label).toContain(refusal);
      expect(await catalog(pool), `${label}: rolled back`).toEqual(catalogBefore);
      expect(await stamped(pool), `${label}: not stamped`).toBe(0);
    }
  }, 180_000);

  it('H: the committed DOWN refuses while a later migration is applied, while a binding exists and while a relation is not as 035 created it; then it restores the catalog and every row count EXACTLY and removes the stamp', async () => {
    const pool = await at034('down');
    const [catalogBefore, toastBefore, rowsBefore] = [await catalog(pool), await toastRelations(pool), await rowCounts(pool)];
    expect((await run(pool, WONDERLAND_MIGRATION_035)).refusal, '035 applies').toBeNull();
    // THE ROLLBACK ORDER, from 033's side: its DOWN refuses while 035 (and 034) are stamped.
    expect((await run(pool, DOWN_033)).refusal?.message, "033's DOWN while 035 is applied").toContain(STAMP_035);
    const refusedWith = async (label: string, refusal: string): Promise<void> => {
      const [catalogAt, rowsAt] = [await catalog(pool), await rowCounts(pool)];
      expect((await run(pool, DOWN)).refusal?.message, label).toContain(refusal);
      expect(await catalog(pool), `${label}: nothing changed`).toEqual(catalogAt);
      expect(await rowCounts(pool), `${label}: no row changed`).toEqual(rowsAt);
      expect(await stamped(pool), `${label}: still stamped`).toBe(1);
    };
    await pool.query('INSERT INTO relay_wonderland.schema_migrations(version) VALUES($1)', ['036_later_lane_probe']);
    await refusedWith('a later migration', 'migration_035_down_refused: a later migration is applied (036_later_lane_probe)');
    await pool.query('DELETE FROM relay_wonderland.schema_migrations WHERE version = $1', ['036_later_lane_probe']);
    await pool.query('INSERT INTO relay_wonderland.voice_puid_binding VALUES($1, $2, $3, now())', [PLAYERS[0], PUID, 's']);
    await refusedWith('a binding', 'migration_035_down_refused: voice data exists (voice_puid_binding 1)');
    await pool.query('DELETE FROM relay_wonderland.voice_puid_binding');
    await pool.query('ALTER TABLE relay_wonderland.voice_puid_binding DROP CONSTRAINT voice_puid_binding_puid_key');
    await refusedWith('the unique key missing', "migration_035_down_refused: relation(s) not exactly as 035 created them, or not 035's (voice_puid_binding_puid_key)");
    await pool.query('ALTER TABLE relay_wonderland.voice_puid_binding ADD CONSTRAINT voice_puid_binding_puid_key UNIQUE (puid)');

    expect((await run(pool, DOWN)).refusal, 'DOWN applies').toBeNull();
    expect(await catalog(pool), "the whole catalog, players' internal triggers included: identical to before 035").toEqual(catalogBefore);
    expect(await toastRelations(pool), 'every TOAST relation 035 brought is gone').toBe(toastBefore);
    expect(await rowCounts(pool), 'every row count: identical to before 035').toEqual(rowsBefore);
    expect(await stamped(pool), 'the stamp is gone').toBe(0);
    expect(await ledgerLast(pool), 'the ledger ends at 034 again').toBe(STAMP_034);
    expect((await run(pool, DOWN)).refusal?.message, 'DOWN where 035 is not applied').toContain('migration_035_down_refused: 035 is not applied here');
    expect((await run(pool, WONDERLAND_MIGRATION_035)).refusal, '035 applies again after DOWN').toBeNull();
    expect(await stamped(pool)).toBe(1);
  }, 300_000);

  it("INV: 033's store still works after 035: its 47 relations stand, and a social row is written and read", async () => {
    const pool = await at035('invariants');
    expect(await count(pool, "SELECT count(*) AS n FROM pg_class c WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND c.relname LIKE 'social\\_%'"),
      "033's 47 relations").toBe(47);
    await pool.query('INSERT INTO relay_wonderland.social_privacy(player_id) VALUES($1)', [PLAYERS[1]]);
    expect(await count(pool, 'SELECT count(*) AS n FROM relay_wonderland.social_privacy WHERE player_id = $1', [PLAYERS[1]])).toBe(1);
    // and a binding is per player: a second binding of the same PUID to another player is refused by the table itself
    await pool.query('INSERT INTO relay_wonderland.voice_puid_binding VALUES($1, $2, $3, now())', [PLAYERS[0], PUID, 's1']);
    await expect(pool.query('INSERT INTO relay_wonderland.voice_puid_binding VALUES($1, $2, $3, now())', [PLAYERS[1], PUID, 's2'])).rejects.toMatchObject({ code: '23505' });
  }, 180_000);

  it("CHAIN: the product's migrate() carries 035 right after 034, so a new database has the 3 relations, no row in them, and the stamp", async () => {
    const pool = await create('chain');
    await new TransactionalWonderlandDatabase(pool).migrate();
    const stamps = (await pool.query('SELECT version FROM relay_wonderland.schema_migrations ORDER BY version COLLATE "C"')).rows.map((r: { version: string }) => r.version);
    expect(stamps.slice(-2), '034 then 035, the last two').toEqual([STAMP_034, STAMP_035]);
    const present = (await pool.query(
      "SELECT c.relname AS r FROM pg_class c WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND c.relname LIKE 'voice\\_%'",
    )).rows.map((row: { r: string }) => row.r).sort();
    expect(present, 'the 3 relations, exactly').toEqual([...RELATIONS].sort());
    expect(await count(pool, 'SELECT count(*) AS n FROM relay_wonderland.voice_puid_binding'), 'no row').toBe(0);
  }, 120_000);

  it("DOCS: the runbook's read-only pre-check and post-check print exactly their fixed one-row blocks and report what its STOP and PASS lists name, before and after 035", async () => {
    const check = async (pool: Pool, script: string, blocks: readonly string[]): Promise<Record<string, unknown>> => {
      const checked = await run(pool, script);
      expect(checked.refusal, 'the check runs').toBeNull();
      const selects = checked.results.filter((result) => result.command === 'SELECT');
      expect(selects.map((result) => result.fields.map((field) => field.name).join('|')), 'the fixed header lines, in order').toEqual([...blocks]);
      expect(selects.map((result) => result.rows.length), 'each block is one row').toEqual(blocks.map(() => 1));
      return Object.assign({}, ...selects.map((result) => result.rows[0])) as Record<string, unknown>;
    };
    const text = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));
    const named = (facts: Record<string, unknown>, keys: readonly string[]) => Object.fromEntries(keys.map((key) => [key, text(facts[key])]));
    const SUMMARY = ['relations_035_expected', 'relations_035_present', 'relations_035_as_created', 'voice_relations_other', 'voice_relations_other_names'];
    const LEDGER = ['migration_034_applied', 'migration_035_applied', 'ledger_last'];

    const pool = await at034('docs');
    const pre = await check(pool, PRECHECK, PRE_BLOCKS);
    expect(named(pre, SUMMARY), 'the pre-check passes its STOP list at 034').toEqual({
      relations_035_expected: '3', relations_035_present: '0', relations_035_as_created: '0', voice_relations_other: '0', voice_relations_other_names: null,
    });
    expect(named(pre, RELATIONS)).toEqual(Object.fromEntries(RELATIONS.map((name) => [name, 'false'])));
    expect(named(pre, ['voice_puid_binding_rows', 'catalog_035_md5', 'voice_fk_constraints'])).toEqual({ voice_puid_binding_rows: null, catalog_035_md5: null, voice_fk_constraints: '0' });
    expect(named(pre, LEDGER)).toEqual({ migration_034_applied: 'true', migration_035_applied: 'false', ledger_last: STAMP_034 });

    expect((await run(pool, WONDERLAND_MIGRATION_035)).refusal).toBeNull();
    const post = await check(pool, POSTCHECK, POST_BLOCKS);
    expect(named(post, SUMMARY), 'the post-check passes its PASS list after 035').toEqual({
      relations_035_expected: '3', relations_035_present: '3', relations_035_as_created: '3', voice_relations_other: '0', voice_relations_other_names: null,
    });
    expect(named(post, RELATIONS)).toEqual(Object.fromEntries(RELATIONS.map((name) => [name, 'true'])));
    expect(text(post.voice_puid_binding_rows), 'empty: 035 writes no row').toBe('0');
    expect(named(post, LEDGER)).toEqual({ migration_034_applied: 'true', migration_035_applied: 'true', ledger_last: STAMP_035 });
    expect(Number(post.ledger_count)).toBe(Number(pre.ledger_count) + 1);
    expect(text(post.players_rows)).toBe(text(pre.players_rows));
    expect(Number(post.players_referenced_by_fks), 'players gained the 1 foreign key').toBe(Number(pre.players_referenced_by_fks) + 1);
    expect(text(post.voice_fk_constraints)).toBe('1');
    expect(text(post.catalog_035_md5), 'a digest after 035').toMatch(/^[0-9a-f]{32}$/u);
    const chained = await create('docschain');
    await new TransactionalWonderlandDatabase(chained).migrate();
    expect((await check(chained, POSTCHECK, POST_BLOCKS)).catalog_035_md5, 'migrate() builds the same 035').toBe(post.catalog_035_md5);
  }, 180_000);
});
