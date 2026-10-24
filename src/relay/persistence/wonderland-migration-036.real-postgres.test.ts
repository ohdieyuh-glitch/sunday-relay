import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { juliusTestDatabaseUrl } from './julius-test-database';
import { TransactionalWonderlandDatabase, WONDERLAND_MIGRATIONS, WONDERLAND_MIGRATION_035, WONDERLAND_MIGRATION_036 } from './wonderland-postgres';

/**
 * MIGRATION 036: WONDERFS (contract r1.4, frozen 2026-10-11), APPLIED EXPLICITLY AFTER 035. PROVISIONAL NUMBER (the founder orders it).
 * 036 creates 37 relations in relay_wonderland -- 16 wfs_* tables and their 21 indexes -- and 22 foreign keys (one of them out of wfs_*,
 * to projects), writes NO row and changes no existing row. Each case is its OWN database:
 *   A      at 035, 036 applies with ONE precheck NOTICE; every catalog line it adds is a wfs_* object (the 37 relations exactly, 2 internal
 *          RI triggers on projects), none is removed; no existing row changes; every new table is empty; the stamp is the last;
 *   G      the guard refuses, changing and stamping nothing: before 035, a second time, after a later stamp, a wfs_* relation existing;
 *   POST   the post-check refuses, rolling everything back, when what the file creates is not what it proves;
 *   C      every constraint holds against real rows: INV-9 live-path uniqueness (and its control), per-project blob addressing (INV-5),
 *          no blob deleted while a version / an entry / a retained conflict names it (§19.m3, N-MAJOR-1), the NULL-safe record identity,
 *          the Alpha grant rules, one main per project, INV-4 one commit per revision, INV-8 one answer per request id, the projects
 *          foreign key; and a project PURGE cascades every wfs_* row of that project and nothing else;
 *   H      the committed DOWN refuses while a later migration is applied, while ANY WonderFS row exists, and while a relation is not as
 *          036 created it; then it restores the catalog EXACTLY and every row count, removes the stamp, and 036 applies again. 035's DOWN
 *          refuses while 036 is stamped;
 *   INV    035's voice binding and 033's social store still work after 036;
 *   CHAIN  the product's migrate() carries 036 right after 035, and a second migrate() changes nothing;
 *   ROLE   a NOSUPERUSER database owner (the O1 bootstrap's D4 role) applies the whole chain, 036 included.
 * Runs wherever JULIUS_TEST_DATABASE_URL names a THROWAWAY server (never DATABASE_URL); `todo` elsewhere.
 */

const databaseUrl = juliusTestDatabaseUrl();
const suite = databaseUrl !== null ? describe : describe.todo;
const DOCS = join(__dirname, '..', '..', '..', 'docs', 'julius-migrations');
const committed = (migration: string, name: string): string => readFileSync(join(DOCS, migration, name), 'utf8')
  .replace(/^\\set ON_ERROR_STOP on\s*$/mu, ''); // a psql meta-command; the driver runs plain SQL
const DOWN = committed('036', 'down.sql');
const DOWN_035 = committed('035', 'down.sql');
const INDEX_036 = WONDERLAND_MIGRATIONS.indexOf(WONDERLAND_MIGRATION_036);
const BEFORE_036 = WONDERLAND_MIGRATIONS.slice(0, INDEX_036);
const BEFORE_035 = WONDERLAND_MIGRATIONS.slice(0, INDEX_036 - 1);
const STAMP_035 = '035_wonderland_voice';
const STAMP_036 = '036_wonderfs';
const PLAYERS = ['usr_036_a', 'usr_036_b'];
const PROJECTS = ['prj_036_a', 'prj_036_b'];
const TABLES = ['wfs_projects', 'wfs_branches', 'wfs_blobs', 'wfs_blob_bytes', 'wfs_entries', 'wfs_branch_base', 'wfs_commits', 'wfs_versions',
  'wfs_requests', 'wfs_conflicts', 'wfs_conflict_blobs', 'wfs_events', 'wfs_grants', 'wfs_grant_tokens', 'wfs_approvals', 'wfs_snapshots'];
const INDEXES = [...TABLES.map((t) => `${t}_pkey`), 'wfs_entries_live_path', 'wfs_commits_commit_id', 'wfs_commits_hash', 'wfs_versions_by_rev', 'wfs_conflicts_open'];
const RELATIONS = [...TABLES, ...INDEXES];
const H = (c: string): string => c.repeat(64);

type Rows = Array<Record<string, unknown>>;
type Result = { command: string; rows: Rows; fields: Array<{ name: string }> };
type Refusal = { code: string | undefined; message: string; constraint?: string };
const refusalOf = (error: unknown): Refusal => ({
  code: (error as { code?: string }).code, message: (error as Error).message, constraint: (error as { constraint?: string }).constraint,
});

suite('migration 036: WonderFS, applied explicitly after 035 (contract r1.4)', () => {
  const nonce = randomBytes(5).toString('hex');
  let admin: Pool;
  const made: Array<{ name: string; pool: Pool }> = [];
  const roles: string[] = [];

  const create = async (label: string, owner?: { role: string; password: string }): Promise<Pool> => {
    const name = `wonderland036${label}${nonce}`;
    await admin.query(`CREATE DATABASE ${name}${owner ? ` OWNER ${owner.role}` : ''}`);
    const url = new URL(databaseUrl!);
    url.pathname = `/${name}`;
    if (owner) { url.username = owner.role; url.password = owner.password; }
    const pool = new Pool({ connectionString: url.toString(), max: 2 });
    made.push({ name, pool });
    return pool;
  };
  const seed = async (pool: Pool): Promise<void> => {
    await pool.query('INSERT INTO relay_wonderland.players(player_id) SELECT unnest($1::text[])', [PLAYERS]);
    await pool.query('INSERT INTO relay_wonderland.projects(project_id) SELECT unnest($1::text[])', [PROJECTS]);
  };
  const migrated = async (label: string, migrations: readonly string[]): Promise<Pool> => {
    const pool = await create(label);
    for (const sql of migrations) await pool.query(sql);
    await seed(pool);
    return pool;
  };
  const at035 = (label: string): Promise<Pool> => migrated(label, BEFORE_036);
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
  const at036 = async (label: string): Promise<Pool> => {
    const pool = await at035(label);
    expect((await run(pool, WONDERLAND_MIGRATION_036)).refusal, `${label}: 036 applies`).toBeNull();
    return pool;
  };
  const count = async (pool: Pool, sql: string, values: unknown[] = []): Promise<number> => Number((await pool.query(sql, values)).rows[0].n);
  const stamped = (pool: Pool) => count(pool, 'SELECT count(*) AS n FROM relay_wonderland.schema_migrations WHERE version = $1', [STAMP_036]);
  const ledgerLast = async (pool: Pool): Promise<string> => (await pool.query(
    'SELECT max(version COLLATE "C") AS v FROM relay_wonderland.schema_migrations',
  )).rows[0].v as string;
  /** relay_wonderland's catalog by definition (the 033 / 035 suites' reading), sorted here. */
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
  /** A statement the schema must refuse, with the SQLSTATE and (where PostgreSQL names it) the constraint that refuses it. */
  const refused = async (pool: Pool, label: string, sql: string, values: unknown[], code: string, constraint?: string): Promise<void> => {
    const error = await pool.query(sql, values).then(() => null, (e: unknown) => refusalOf(e));
    expect(error, `${label}: refused`).not.toBeNull();
    expect(error?.code, `${label}: SQLSTATE (${error?.message})`).toBe(code);
    if (constraint !== undefined) expect(error?.constraint, `${label}: the constraint`).toBe(constraint);
  };

  beforeAll(async () => { admin = new Pool({ connectionString: databaseUrl! }); }, 30_000);
  afterAll(async () => {
    for (const { name, pool } of made) {
      pool.on('error', () => undefined);
      await pool.end().catch(() => undefined);
      await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [name]).catch(() => undefined);
      await admin.query(`DROP DATABASE IF EXISTS ${name}`).catch(() => undefined);
    }
    for (const role of roles) await admin.query(`DROP ROLE IF EXISTS ${role}`).catch(() => undefined);
    await admin?.end().catch(() => undefined);
  }, 60_000);

  it('A: at 035, 036 applies: every catalog line it adds is a wfs_* object (the 37 relations exactly, 2 internal triggers on projects), none is removed, and no existing row changes', async () => {
    const pool = await at035('clean');
    const [catalogBefore, rowsBefore] = [await catalog(pool), await rowCounts(pool)];
    const applied = await run(pool, WONDERLAND_MIGRATION_036);
    expect(applied.refusal, '036 applies').toBeNull();
    const notice = applied.notices.filter((line) => line.startsWith('migration_036_precheck:'));
    expect(notice, 'one precheck NOTICE').toHaveLength(1);
    expect(notice[0], 'with the counts').toContain(`projects ${PROJECTS.length}`);
    expect(applied.notices, 'and no other NOTICE').toHaveLength(1);
    const catalogAfter = await catalog(pool);
    expect(catalogBefore.filter((line) => !catalogAfter.includes(line)), 'nothing removed or changed').toEqual([]);
    const added = catalogAfter.filter((line) => !catalogBefore.includes(line));
    expect(added.filter((line) => !line.includes('wfs_')), 'every line added is a wfs_* object').toEqual([]);
    expect(added.filter((line) => line.startsWith('relation ')).map((line) => line.split(' ')[1]).sort(), 'the 37 relations, exactly')
      .toEqual([...RELATIONS].sort());
    expect(added.filter((line) => line.startsWith('internal trigger projects ')), 'two RI triggers on projects for its one foreign key out').toHaveLength(2);
    expect(added.filter((line) => line.startsWith('constraint ') && / FOREIGN KEY /u.test(line)), 'the 22 foreign keys').toHaveLength(22);
    // THE SCHEMA COUNTS, from the catalog itself (the DDL holds 92 CHECKs, 16 primary keys, 2 UNIQUE constraints, 22 foreign keys).
    // 92 = r1.4's 91 + wfs_requests.actor_key's CHECK(actor_key ~ '^[0-9a-f]{64}$'), which contract r1.6.2 §21 K4 requires (e2).
    const kinds = Object.fromEntries((await pool.query(
      "SELECT k.contype AS t, count(*) AS n FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND c.relname LIKE 'wfs\\_%' GROUP BY k.contype",
    )).rows.map((row: { t: string; n: string }) => [row.t, Number(row.n)]));
    expect(kinds, 'CHECK 92, PRIMARY KEY 16, UNIQUE 2, FOREIGN KEY 22, nothing else').toEqual({ c: 92, p: 16, u: 2, f: 22 });
    expect(await count(pool, "SELECT count(*) AS n FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND c.relname LIKE 'wfs\\_%' AND k.contype = 'f' AND k.condeferrable AND k.condeferred"),
      'the 6 purge-path keys are DEFERRABLE INITIALLY DEFERRED').toBe(6);
    const withStamp = rowsBefore.map((line) => (line.startsWith('schema_migrations ') ? `schema_migrations ${Number(line.split(' ')[1]) + 1}` : line));
    const rowsAfter = await rowCounts(pool);
    expect(rowsAfter.filter((line) => !line.startsWith('wfs_')), 'no existing row changed; the ledger gained the stamp alone').toEqual(withStamp);
    expect(rowsAfter.filter((line) => line.startsWith('wfs_')), 'every new table is empty').toEqual([...TABLES].sort().map((t) => `${t} 0`));
    expect(await ledgerLast(pool), "the stamp is the ledger's last").toBe(STAMP_036);
  }, 180_000);

  it('G: the guard refuses, changing and stamping nothing: before 035, a second time, after a later stamp, and when a wfs_* relation already exists', async () => {
    const laterStamped = await at035('laterstamp');
    await laterStamped.query('INSERT INTO relay_wonderland.schema_migrations(version) VALUES($1)', ['037_later_lane_probe']);
    const tableTaken = await at035('tabletaken');
    await tableTaken.query('CREATE TABLE relay_wonderland.wfs_blobs(x int)');
    const indexTaken = await at035('indextaken');
    await indexTaken.query('CREATE TABLE relay_wonderland.probe_036(x int); CREATE INDEX wfs_entries_live_path ON relay_wonderland.probe_036(x)');
    const taken = 'migration_036_refused: relation(s) named wfs_* already exist in relay_wonderland';
    const cases: Array<[string, Pool, string]> = [
      ['035 not applied', await migrated('at034', BEFORE_035), 'migration_036_refused: 035 is not applied here'],
      ['036 already applied', await at036('twice'), 'migration_036_refused: 036 is already applied here'],
      ['a later stamp', laterStamped, "migration_036_refused: the ledger's last stamp is 037_later_lane_probe, not 035"],
      ['a table name taken', tableTaken, `${taken} (wfs_blobs)`],
      ['an index name taken', indexTaken, `${taken} (wfs_entries_live_path)`],
    ];
    for (const [label, pool, refusal] of cases) {
      const [catalogBefore, stampsBefore] = [await catalog(pool), await stamped(pool)];
      const attempt = await run(pool, WONDERLAND_MIGRATION_036);
      expect(attempt.refusal?.message, label).toContain(refusal);
      expect(attempt.notices.some((line) => line.startsWith('migration_036_precheck:')), `${label}: no precheck NOTICE`).toBe(false);
      expect(await catalog(pool), `${label}: nothing changed`).toEqual(catalogBefore);
      expect(await stamped(pool), `${label}: nothing stamped`).toBe(stampsBefore);
    }
  }, 600_000);

  it('POST: the post-check refuses, rolling everything back, when what the file creates is not what it proves', async () => {
    const statement = (text: string): string => {
      expect(WONDERLAND_MIGRATION_036.split(text).length - 1, `written once: ${text}`).toBe(1);
      return text;
    };
    const mutants: Array<[string, string, string]> = [
      ['the live-path unique index missing',
        WONDERLAND_MIGRATION_036.replace(statement('CREATE UNIQUE INDEX wfs_entries_live_path ON relay_wonderland.wfs_entries(project_id, branch_id, path_key) WHERE NOT deleted;'), () => ''),
        "migration_036_postcheck: relation(s) not exactly as 036 creates them, or not 036's (wfs_entries_live_path)"],
      ['the live-path index not unique',
        WONDERLAND_MIGRATION_036.replace(statement('CREATE UNIQUE INDEX wfs_entries_live_path'), () => 'CREATE INDEX wfs_entries_live_path'),
        "migration_036_postcheck: relation(s) not exactly as 036 creates them, or not 036's (wfs_entries_live_path)"],
      ['a row written',
        WONDERLAND_MIGRATION_036.replace(statement('-- POST-CHECK, still inside the transaction:'),
          () => `INSERT INTO relay_wonderland.wfs_projects(project_id, genesis_hash) VALUES('${PROJECTS[0]}', '${H('a')}');\n-- POST-CHECK, still inside the transaction:`),
        'migration_036_postcheck: wfs_projects holds 1 row(s), and 036 writes none'],
      ['a foreign key missing (the version -> blob key that keeps history readable)',
        WONDERLAND_MIGRATION_036.replace(statement('  CONSTRAINT wfs_versions_blob_fk FOREIGN KEY(project_id, sha256) REFERENCES relay_wonderland.wfs_blobs(project_id, sha256) DEFERRABLE INITIALLY DEFERRED,\n'), () => ''),
        'migration_036_postcheck: the wfs_* tables carry 21 foreign keys, not the 22 036 writes'],
    ];
    const pool = await at035('postcheck');
    const catalogBefore = await catalog(pool);
    for (const [label, mutant, refusal] of mutants) {
      expect(mutant, `${label}: the mutant differs from 036`).not.toBe(WONDERLAND_MIGRATION_036);
      const attempt = await run(pool, mutant);
      expect(attempt.refusal?.message, label).toContain(refusal);
      expect(await catalog(pool), `${label}: rolled back`).toEqual(catalogBefore);
      expect(await stamped(pool), `${label}: not stamped`).toBe(0);
    }
  }, 300_000);

  it('C: every constraint holds against real rows, and a project purge removes exactly that project\'s WonderFS rows', async () => {
    const pool = await at036('constraints');
    const [A, B] = PROJECTS;
    const record = (over: Record<string, unknown> = {}) => JSON.stringify({
      projectId: A, branchId: 'main', rev: 1, commitId: 'cmt-1', requestId: 'req-00000001', prevCommitHash: H('a'), commitHash: H('c'), ...over,
    });
    // A VALID project: genesis, main at rev 1, two blobs (one is only a conflict's), a file entry, its commit and version, a request.
    await pool.query('INSERT INTO relay_wonderland.wfs_projects(project_id, genesis_hash) VALUES($1, $2), ($3, $4)', [A, H('a'), B, H('b')]);
    await pool.query("INSERT INTO relay_wonderland.wfs_branches(project_id, branch_id, kind, head_rev, head_commit_hash, anchor_hash) VALUES($1, 'main', 'main', 1, $2, $3), ($4, 'main', 'main', 0, $5, $5)", [A, H('c'), H('a'), B, H('b')]);
    await pool.query("INSERT INTO relay_wonderland.wfs_blobs(project_id, sha256, size, store) VALUES($1, $2, 5, 'pg'), ($1, $3, 3, 'pg')", [A, H('1'), H('2')]);
    await pool.query("INSERT INTO relay_wonderland.wfs_blob_bytes VALUES($1, $2, convert_to('hello', 'UTF8'))", [A, H('1')]);
    await pool.query('INSERT INTO relay_wonderland.wfs_commits(project_id, branch_id, rev, commit_id, request_id, prev_commit_hash, commit_hash, record, at) VALUES($1, \'main\', 1, \'cmt-1\', \'req-00000001\', $2, $3, $4, now())', [A, H('a'), H('c'), record()]);
    const entry = 'INSERT INTO relay_wonderland.wfs_entries(project_id, branch_id, file_id, kind, path, path_key, sha256, size, deleted, version, content_version, path_version, created_rev, updated_rev) VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, 1, 1, 1, 1)';
    await pool.query(entry, [A, 'main', 'f1', 'file', 'Docs/Readme.md', 'docs/readme.md', H('1'), 5, false]);
    await pool.query(entry, [A, 'main', 'd1', 'dir', 'Docs', 'docs', null, null, false]);
    await pool.query("INSERT INTO relay_wonderland.wfs_versions(project_id, branch_id, file_id, version, rev, kind, path, path_key, sha256, size, deleted, content_version, path_version, created_rev, updated_rev) VALUES($1, 'main', 'f1', 1, 1, 'file', 'Docs/Readme.md', 'docs/readme.md', $2, 5, false, 1, 1, 1, 1)", [A, H('1')]);
    await pool.query("INSERT INTO relay_wonderland.wfs_requests(project_id, actor_key, request_id, payload_hash, outcome) VALUES($1, $2, 'req-00000001', $3, '{\"status\":\"committed\"}')", [A, H('a'), H('d')]);
    await pool.query("INSERT INTO relay_wonderland.wfs_conflicts(project_id, conflict_id, branch_id, request_id, status, record, opened_at) VALUES($1, 'cfl-1', 'main', 'req-00000002', 'open', $2, now())",
      [A, JSON.stringify({ conflictId: 'cfl-1', branchId: 'main', requestId: 'req-00000002' })]);
    await pool.query('INSERT INTO relay_wonderland.wfs_conflict_blobs VALUES($1, \'cfl-1\', $2)', [A, H('2')]);
    // CONTROL for INV-9: a TOMBSTONE may share a live path's fold key
    await pool.query(entry, [A, 'main', 'f-old', 'file', 'DOCS/README.MD', 'docs/readme.md', H('1'), 5, true]);

    // INV-9: one LIVE path per fold key per branch, enforced by the database
    await refused(pool, 'a second live entry on the same fold key', entry, [A, 'main', 'f2', 'file', 'docs/README.md', 'docs/readme.md', H('1'), 5, false], '23505', 'wfs_entries_live_path');
    // a file names a blob THIS project holds; INV-5: another project's blob is not addressable
    await refused(pool, 'an unheld blob', entry, [A, 'main', 'f3', 'file', 'x.bin', 'x.bin', H('9'), 1, false], '23503', 'wfs_entries_blob_fk');
    await refused(pool, "another project's blob", entry, [B, 'main', 'f4', 'file', 'y.bin', 'y.bin', H('1'), 5, false], '23503', 'wfs_entries_blob_fk');
    await refused(pool, 'a file with no content', entry, [A, 'main', 'f5', 'file', 'z.txt', 'z.txt', null, null, false], '23514', 'wfs_entries_content');
    await refused(pool, 'a directory with content', entry, [A, 'main', 'd2', 'dir', 'Other', 'other', H('1'), 5, false], '23514', 'wfs_entries_content');
    await refused(pool, 'a 201-character path', entry, [A, 'main', 'f6', 'file', 'p'.repeat(201), 'p'.repeat(201), H('1'), 5, false], '23514');
    // blobs: a sha256 is 64 lower-hex characters; 64 MiB per file (§11)
    await refused(pool, 'a malformed sha256', "INSERT INTO relay_wonderland.wfs_blobs(project_id, sha256, size, store) VALUES($1, $2, 1, 'pg')", [A, 'X'.repeat(64)], '23514');
    await refused(pool, 'a blob over 64 MiB', "INSERT INTO relay_wonderland.wfs_blobs(project_id, sha256, size, store) VALUES($1, $2, 67108865, 'pg')", [A, H('3')], '23514');
    // no blob goes while a version, an entry or a RETAINED conflict names it (§19.m3, N-MAJOR-1)
    await refused(pool, 'deleting a blob a version and an entry name', 'DELETE FROM relay_wonderland.wfs_blobs WHERE project_id = $1 AND sha256 = $2', [A, H('1')], '23503');
    await refused(pool, "deleting a blob a retained conflict names", 'DELETE FROM relay_wonderland.wfs_blobs WHERE project_id = $1 AND sha256 = $2', [A, H('2')], '23503', 'wfs_conflict_blobs_blob_fk');
    // branches: exactly one main, id 'main'; an agent branch has an owner and a fork point
    await refused(pool, 'a second main under another id', "INSERT INTO relay_wonderland.wfs_branches(project_id, branch_id, kind, head_commit_hash, anchor_hash) VALUES($1, 'trunk', 'main', $2, $2)", [A, H('a')], '23514', 'wfs_branches_main_is_main');
    await refused(pool, 'an agent branch with no owner', "INSERT INTO relay_wonderland.wfs_branches(project_id, branch_id, kind, parent_branch_id, fork_rev, head_commit_hash, anchor_hash) VALUES($1, 'agent-1', 'agent', 'main', 1, $2, $2)", [A, H('c')], '23514', 'wfs_branches_agent_has_owner');
    await refused(pool, 'an agent branch forked from a missing parent', "INSERT INTO relay_wonderland.wfs_branches(project_id, branch_id, kind, parent_branch_id, fork_rev, owner, head_commit_hash, anchor_hash) VALUES($1, 'agent-2', 'agent', 'nope', 1, '{}', $2, $2)", [A, H('c')], '23503', 'wfs_branches_parent_fk');
    // commits: INV-4 one per revision; the record's identity equals the columns, and a MISSING key reads false (NULL-safe)
    const commit = 'INSERT INTO relay_wonderland.wfs_commits(project_id, branch_id, rev, commit_id, request_id, prev_commit_hash, commit_hash, record, at) VALUES($1, \'main\', $2, $3, \'req-00000003\', $4, $5, $6, now())';
    await refused(pool, 'a second commit at revision 1', commit, [A, 1, 'cmt-2', H('c'), H('e'), record({ commitId: 'cmt-2', requestId: 'req-00000003', rev: 1, prevCommitHash: H('c'), commitHash: H('e') })], '23505', 'wfs_commits_pkey');
    const { commitHash: _omitted, ...withoutHash } = JSON.parse(record({ commitId: 'cmt-3', requestId: 'req-00000003', rev: 2, prevCommitHash: H('c'), commitHash: H('e') })) as Record<string, unknown>;
    await refused(pool, 'a record missing its commitHash', commit, [A, 2, 'cmt-3', H('c'), H('e'), JSON.stringify(withoutHash)], '23514', 'wfs_commits_record_identity');
    await refused(pool, 'a record naming another hash', commit, [A, 2, 'cmt-3', H('c'), H('e'), record({ commitId: 'cmt-3', requestId: 'req-00000003', rev: 2, prevCommitHash: H('c'), commitHash: H('f') })], '23514', 'wfs_commits_record_identity');
    // versions: made by an existing commit, at that commit's revision
    await refused(pool, 'a version with no commit', "INSERT INTO relay_wonderland.wfs_versions(project_id, branch_id, file_id, version, rev, kind, path, path_key, sha256, size, deleted, content_version, path_version, created_rev, updated_rev) VALUES($1, 'main', 'f1', 2, 2, 'file', 'a', 'a', $2, 5, false, 2, 1, 1, 2)", [A, H('1')], '23503', 'wfs_versions_commit_fk');
    await refused(pool, 'a version not at its commit', "INSERT INTO relay_wonderland.wfs_versions(project_id, branch_id, file_id, version, rev, kind, path, path_key, sha256, size, deleted, content_version, path_version, created_rev, updated_rev) VALUES($1, 'main', 'd1', 1, 1, 'dir', 'Docs', 'docs', NULL, NULL, false, 1, 1, 0, 0)", [A], '23514', 'wfs_versions_made_by_its_commit');
    // INV-8, per ACTOR (contract r1.6.2 e2 / K4): a request id answers once for one actor; another actor's same id is its own row
    const request = "INSERT INTO relay_wonderland.wfs_requests(project_id, actor_key, request_id, payload_hash, outcome) VALUES($1, $2, 'req-00000001', $3, '{}')";
    await refused(pool, 'a request id reused by the same actor', request, [A, H('a'), H('e')], '23505', 'wfs_requests_pkey');
    await pool.query(request, [A, H('b'), H('e')]); // CONTROL: another actor, the same id
    await refused(pool, 'an actor key that is not 64 lower-case hex', request, [A, 'A'.repeat(64), H('e')], '23514');
    await refused(pool, 'a request with no actor key', "INSERT INTO relay_wonderland.wfs_requests(project_id, request_id, payload_hash, outcome) VALUES($1, 'req-00000009', $2, '{}')", [A, H('e')], '23502');
    // conflicts: closing needs a time and a retention
    await refused(pool, 'a resolved conflict with no close time', "INSERT INTO relay_wonderland.wfs_conflicts(project_id, conflict_id, branch_id, request_id, status, record, opened_at) VALUES($1, 'cfl-2', 'main', 'req-00000004', 'resolved', $2, now())",
      [A, JSON.stringify({ conflictId: 'cfl-2', branchId: 'main', requestId: 'req-00000004' })], '23514', 'wfs_conflicts_closing');
    // grants (§8.3): main_and_own cannot be held; a service reads only; a clone's grant is cut from a grant; an issuer with no kind is refused
    const grant = "INSERT INTO relay_wonderland.wfs_grants(project_id, grant_id, principal_id, principal_kind, issued_by, branches, ops, paths, expires_at) VALUES($1, $2, 'jul-1', $3, $4, $5, $6, ARRAY['**'], now() + interval '1 hour')";
    await pool.query(grant, [A, 'g-ok', 'julius', '{"kind":"human","userId":"ghu-1"}', 'own', ['read', 'write']]); // CONTROL: a valid grant
    await refused(pool, 'main_and_own', grant, [A, 'g-1', 'julius', '{"kind":"human","userId":"ghu-1"}', 'main_and_own', ['read']], '23514');
    await refused(pool, 'a writing service', grant, [A, 'g-2', 'service', '{"kind":"human","userId":"ghu-1"}', 'own', ['read', 'write']], '23514', 'wfs_grants_service_reads');
    await refused(pool, "a clone's grant issued by a person", grant, [A, 'g-3', 'clone', '{"kind":"human","userId":"ghu-1"}', 'own', ['read']], '23514', 'wfs_grants_issuer');
    await refused(pool, 'an issuer with no kind', grant, [A, 'g-4', 'julius', '{"userId":"ghu-1"}', 'own', ['read']], '23514', 'wfs_grants_issuer');
    await refused(pool, 'an unknown op', grant, [A, 'g-5', 'julius', '{"kind":"human","userId":"ghu-1"}', 'own', ['read', 'admin']], '23514');
    // a project is soft-deleted, never deleted under its files
    await refused(pool, 'deleting a project that has WonderFS rows', 'DELETE FROM relay_wonderland.projects WHERE project_id = $1', [A], '23503', 'wfs_projects_project_fk');

    // DEFERRED, NOT WEAKER: inside an explicit transaction the delete of a blob a version names is accepted at first, and the COMMIT
    // is refused (23503), rolling the whole transaction back: the blob and everything else are still there
    {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM relay_wonderland.wfs_blobs WHERE project_id = $1 AND sha256 = $2', [A, H('1')]);
        const atCommit = await client.query('COMMIT').then(() => null, (e: unknown) => refusalOf(e));
        expect(atCommit?.code, 'the COMMIT is refused').toBe('23503');
      } finally {
        await client.query('ROLLBACK').catch(() => undefined);
        client.release();
      }
      expect(await count(pool, 'SELECT count(*) AS n FROM relay_wonderland.wfs_blobs WHERE project_id = $1 AND sha256 = $2', [A, H('1')]), 'the blob is still held').toBe(1);
    }

    // the purge must cross every DEFERRED key: an agent branch under main, and a conflict a commit resolved
    await pool.query("INSERT INTO relay_wonderland.wfs_branches(project_id, branch_id, kind, parent_branch_id, fork_rev, owner, head_commit_hash, anchor_hash) VALUES($1, 'agent-1', 'agent', 'main', 1, '{\"kind\":\"julius\",\"id\":\"jul-1\"}', $2, $2)", [A, H('c')]);
    await pool.query("INSERT INTO relay_wonderland.wfs_branch_base(project_id, branch_id, file_id, kind, path, path_key, sha256, size, deleted, version, content_version, path_version, created_rev, updated_rev) VALUES($1, 'agent-1', 'f1', 'file', 'Docs/Readme.md', 'docs/readme.md', $2, 5, false, 1, 1, 1, 1, 1)", [A, H('1')]);
    await pool.query("INSERT INTO relay_wonderland.wfs_conflicts(project_id, conflict_id, branch_id, request_id, status, record, opened_at, closed_at, resolved_by_commit_id, retain_until) VALUES($1, 'cfl-3', 'main', 'req-00000005', 'resolved', $2, now(), now(), 'cmt-1', now() + interval '30 days')",
      [A, JSON.stringify({ conflictId: 'cfl-3', branchId: 'main', requestId: 'req-00000005' })]);

    // A PURGE (deleting the WonderFS project) cascades every wfs_* row of THAT project, and leaves the other project's rows alone
    const rowsOf = async (project: string): Promise<number> => {
      let n = 0;
      for (const t of TABLES.filter((x) => x !== 'wfs_grant_tokens')) n += await count(pool, `SELECT count(*) AS n FROM relay_wonderland.${t} WHERE project_id = $1`, [project]);
      return n;
    };
    expect(await rowsOf(A), 'project A has rows').toBeGreaterThan(10);
    const bBefore = await rowsOf(B);
    await pool.query('DELETE FROM relay_wonderland.wfs_projects WHERE project_id = $1', [A]);
    expect(await rowsOf(A), "the purge removed every one of A's WonderFS rows").toBe(0);
    expect(await rowsOf(B), "and none of B's").toBe(bBefore);
    expect(await count(pool, 'SELECT count(*) AS n FROM relay_wonderland.projects WHERE project_id = $1', [A]), 'the projects row stays (soft delete is the product path)').toBe(1);
  }, 300_000);

  it('H: the committed DOWN refuses while a later migration is applied, while ANY WonderFS row exists and while a relation is not as 036 created it; then it restores the catalog and every row count EXACTLY and removes the stamp', async () => {
    const pool = await at035('down');
    const [catalogBefore, toastBefore, rowsBefore] = [await catalog(pool), await toastRelations(pool), await rowCounts(pool)];
    expect((await run(pool, WONDERLAND_MIGRATION_036)).refusal, '036 applies').toBeNull();
    // THE ROLLBACK ORDER, from 035's side: its DOWN refuses while 036 is stamped
    expect((await run(pool, DOWN_035)).refusal?.message, "035's DOWN while 036 is applied").toContain(`a later migration is applied (${STAMP_036})`);
    // a later migration
    await pool.query("INSERT INTO relay_wonderland.schema_migrations(version) VALUES('037_later_lane_probe')");
    expect((await run(pool, DOWN)).refusal?.message).toContain('migration_036_down_refused: a later migration is applied (037_later_lane_probe)');
    await pool.query("DELETE FROM relay_wonderland.schema_migrations WHERE version = '037_later_lane_probe'");
    // ANY WonderFS row: no down script of this chain loses data
    await pool.query('INSERT INTO relay_wonderland.wfs_projects(project_id, genesis_hash) VALUES($1, $2)', [PROJECTS[0], H('a')]);
    expect((await run(pool, DOWN)).refusal?.message).toContain('migration_036_down_refused: WonderFS data exists (wfs_projects 1)');
    await pool.query('DELETE FROM relay_wonderland.wfs_projects');
    // a relation not as 036 created it
    await pool.query('DROP INDEX relay_wonderland.wfs_versions_by_rev');
    expect((await run(pool, DOWN)).refusal?.message).toContain("migration_036_down_refused: relation(s) not exactly as 036 created them, or not 036's (wfs_versions_by_rev)");
    await pool.query('CREATE INDEX wfs_versions_by_rev ON relay_wonderland.wfs_versions(project_id, branch_id, rev)');
    expect(await stamped(pool), 'every refusal changed nothing').toBe(1);
    // THE WAY BACK
    expect((await run(pool, DOWN)).refusal, 'the DOWN runs').toBeNull();
    expect(await catalog(pool), 'the catalog is EXACTLY as before 036').toEqual(catalogBefore);
    expect(await toastRelations(pool), 'no toast relation left behind').toBe(toastBefore);
    expect(await rowCounts(pool), 'every row count as before 036').toEqual(rowsBefore);
    expect(await stamped(pool), 'the stamp is gone').toBe(0);
    expect((await run(pool, DOWN)).refusal?.message, 'a second DOWN').toContain('migration_036_down_refused: 036 is not applied here');
    expect((await run(pool, WONDERLAND_MIGRATION_036)).refusal, '036 applies again').toBeNull();
  }, 300_000);

  it("INV: 035's voice binding and 033's social store still work after 036", async () => {
    const pool = await at036('inv');
    await pool.query("INSERT INTO relay_wonderland.voice_puid_binding VALUES($1, $2, 's1', now())", [PLAYERS[0], 'a'.repeat(32)]);
    await expect(pool.query("INSERT INTO relay_wonderland.voice_puid_binding VALUES($1, $2, 's2', now())", [PLAYERS[1], 'a'.repeat(32)])).rejects.toMatchObject({ code: '23505' });
    await pool.query('INSERT INTO relay_wonderland.social_privacy(player_id) VALUES($1)', [PLAYERS[1]]);
    expect(await count(pool, 'SELECT count(*) AS n FROM relay_wonderland.social_privacy WHERE player_id = $1', [PLAYERS[1]])).toBe(1);
  }, 180_000);

  it("CHAIN: the product's migrate() carries 036 right after 035, a new database has the 37 relations and no WonderFS row, and a second migrate() changes nothing", async () => {
    const pool = await create('chain');
    await new TransactionalWonderlandDatabase(pool).migrate();
    const stamps = (await pool.query('SELECT version FROM relay_wonderland.schema_migrations ORDER BY version COLLATE "C"')).rows.map((r: { version: string }) => r.version);
    expect(stamps.slice(stamps.indexOf(STAMP_035), stamps.indexOf(STAMP_035) + 2), '035 then 036, adjacent').toEqual([STAMP_035, STAMP_036]);
    expect(WONDERLAND_MIGRATIONS.indexOf(WONDERLAND_MIGRATION_036), 'registered right after 035').toBe(WONDERLAND_MIGRATIONS.indexOf(WONDERLAND_MIGRATION_035) + 1);
    const present = (await pool.query(
      "SELECT c.relname AS r FROM pg_class c WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND c.relname LIKE 'wfs\\_%'",
    )).rows.map((row: { r: string }) => row.r).sort();
    expect(present, 'the 37 relations, exactly').toEqual([...RELATIONS].sort());
    const catalogOnce = await catalog(pool);
    await new TransactionalWonderlandDatabase(pool).migrate();
    expect(await catalog(pool), 'a second migrate() changes nothing').toEqual(catalogOnce);
    for (const t of TABLES) expect(await count(pool, `SELECT count(*) AS n FROM relay_wonderland.${t}`), `${t} is empty`).toBe(0);
  }, 180_000);

  it('ROLE: a NOSUPERUSER database owner (the O1 bootstrap D4 role) applies the whole chain, 036 included', async () => {
    const role = `wfs036owner${nonce}`;
    const password = randomBytes(18).toString('hex');
    await admin.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${password}'`);
    roles.push(role);
    const pool = await create('role', { role, password });
    expect((await pool.query('SELECT rolsuper FROM pg_roles WHERE rolname = current_user')).rows[0].rolsuper, 'not a superuser').toBe(false);
    await new TransactionalWonderlandDatabase(pool).migrate();
    expect(await ledgerLast(pool), 'the whole chain, 036 last').toBe(STAMP_036);
    expect(await count(pool, "SELECT count(*) AS n FROM pg_class c WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND c.relname LIKE 'wfs\\_%'")).toBe(RELATIONS.length);
  }, 180_000);
});
