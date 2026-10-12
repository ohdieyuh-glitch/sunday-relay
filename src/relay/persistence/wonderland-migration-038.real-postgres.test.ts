import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  LFF_CATEGORIES,
  LFF_DESCRIPTION_MAX,
  LFF_MESSAGE_MAX,
  LFF_POST_STATUSES,
  LFF_POST_TTL_MS,
  LFF_PROJECT_LABEL_MAX,
  LFF_REQUEST_STATUSES,
  LFF_SKILL_MAX,
  LFF_SKILLS_MAX,
  LFF_SLOTS_MAX,
  LFF_SLOTS_MIN,
  LFF_TITLE_MAX,
} from '../social/social-lff';
import { juliusTestDatabaseUrl } from './julius-test-database';
import { migrationVersion, TransactionalWonderlandDatabase, WONDERLAND_MIGRATIONS, WONDERLAND_MIGRATION_037, WONDERLAND_MIGRATION_038 } from './wonderland-postgres';

/**
 * MIGRATION 038: WONDERLAND LFF, the "Looking For Feed" (the private-Alpha launch gate, founder 2026-10-12; contract r1 + AMENDMENT
 * r2 / r2.1), APPLIED EXPLICITLY AFTER 037. PROVISIONAL NUMBER (claimed at landing; whichever of LFF and the Julius file-memory lands
 * second renumbers). 038 creates 13 relations in relay_wonderland -- lff_posts, lff_join_requests, lff_post_creations, their primary
 * keys and 7 indexes -- 22 constraints (3 primary keys, 4 foreign keys, 15 CHECKs), writes NO row and changes no existing row.
 * Each database case is its OWN database:
 *   A      at 037, 038 applies with ONE precheck NOTICE; every catalog line it adds is an lff_* object or an internal RI trigger its
 *          keys put on players / lff_posts; EVERY COLUMN exactly (name, type, NOT NULL; requests carry no version); none is removed;
 *          no existing row changes; all three tables are empty; the stamp is the last;
 *   G      the guard refuses, changing and stamping nothing: before 037, a second time, after a later stamp, an lff_* relation present;
 *   POST   the in-transaction post-check refuses (rolling everything back) when what the file creates is not what it proves;
 *   C      every constraint holds against real rows, each refusal beside a control that is accepted, at each bound's edge and one
 *          past it; the vocabularies are social-lff.ts's own (CANCELLED stored; EXPIRED never stored); the domain's refused
 *          characters (C0, DEL, C1, U+2028/9) refused in every text and every allowed neighbour (ZWJ emoji included) accepted, under
 *          any locale; one LIVE (PENDING or ACCEPTED) request per (post, requester); the creation record, which a post delete
 *          leaves and a player delete removes; the cascades; what the schema deliberately does NOT refuse;
 *   H      the committed DOWN refuses while a later migration is applied, while ANY of the three tables holds a row and while a
 *          relation is not as 038 created it; then it restores the catalog EXACTLY, removes the stamp, and 038 applies again.
 *          037's DOWN refuses while 038 is stamped;
 *   CHAIN  the product's migrate() carries 038 right after 037 on a fresh database, and a second migrate() changes nothing;
 *   ROLE   a NOSUPERUSER database owner (the O1 bootstrap's D4 role) applies the whole chain, 038 included.
 * The STORE case (durability through openSocialPostgresStore across a restart) arrives with slice B2b's store wiring.
 * There is no DOCS case: like 037, 038 has no separate precheck.sql / postcheck.sql (its NOTICE and post-check are A / G / POST).
 * Runs wherever JULIUS_TEST_DATABASE_URL names a THROWAWAY server (never DATABASE_URL); `todo` elsewhere. The static block at the
 * end needs no database and runs everywhere: the schema states exactly social-lff.ts's vocabulary and bounds.
 */

const databaseUrl = juliusTestDatabaseUrl();
const suite = databaseUrl !== null ? describe : describe.todo;
const DOCS = join(__dirname, '..', '..', '..', 'docs', 'julius-migrations');
const committed = (migration: string, name: string): string => readFileSync(join(DOCS, migration, name), 'utf8')
  .replace(/^\\set ON_ERROR_STOP on\s*$/mu, ''); // a psql meta-command; the driver runs plain SQL
const DOWN = committed('038', 'down.sql');
const DOWN_037 = committed('037', 'down.sql');
const INDEX_038 = WONDERLAND_MIGRATIONS.indexOf(WONDERLAND_MIGRATION_038);
const BEFORE_038 = WONDERLAND_MIGRATIONS.slice(0, INDEX_038);
const BEFORE_037 = WONDERLAND_MIGRATIONS.slice(0, INDEX_038 - 1); // CHAIN proves 037 sits right before 038
const STAMP_037 = '037_wonderland_private_servers';
const STAMP_038 = '038_wonderland_lff';
const PLAYERS = ['usr_038_a', 'usr_038_b', 'usr_038_c', 'usr_038_d'];
const TABLES = ['lff_join_requests', 'lff_post_creations', 'lff_posts'];
const RELATIONS = [
  'lff_posts', 'lff_posts_pkey', 'lff_posts_feed', 'lff_posts_category_feed', 'lff_posts_owner',
  'lff_join_requests', 'lff_join_requests_pkey', 'lff_join_requests_one_live', 'lff_join_requests_requester', 'lff_join_requests_post',
  'lff_post_creations', 'lff_post_creations_pkey', 'lff_post_creations_recent',
];
/** Every column 038 creates, as the catalog reads it: name, type, NOT NULL. Requests carry NO version (contract r2). */
const COLUMNS = [
  'column lff_posts #1 post_id text not-null', 'column lff_posts #2 owner_id text not-null', 'column lff_posts #3 category text not-null',
  'column lff_posts #4 title text not-null', 'column lff_posts #5 description text not-null', 'column lff_posts #6 project_label text not-null',
  'column lff_posts #7 skills text[] not-null', 'column lff_posts #8 open_slots integer not-null', 'column lff_posts #9 status text not-null',
  'column lff_posts #10 created_at timestamp with time zone not-null', 'column lff_posts #11 updated_at timestamp with time zone not-null',
  'column lff_posts #12 expires_at timestamp with time zone not-null', 'column lff_posts #13 version bigint not-null',
  'column lff_join_requests #1 request_id text not-null', 'column lff_join_requests #2 post_id text not-null',
  'column lff_join_requests #3 requester_id text not-null', 'column lff_join_requests #4 message text not-null',
  'column lff_join_requests #5 status text not-null', 'column lff_join_requests #6 created_at timestamp with time zone not-null',
  'column lff_join_requests #7 updated_at timestamp with time zone not-null',
  'column lff_post_creations #1 owner_id text not-null', 'column lff_post_creations #2 post_id text not-null',
  'column lff_post_creations #3 created_at timestamp with time zone not-null',
];
const ONE_LIVE = 'lff_join_requests_one_live';
const DAY = 24 * 60 * 60_000;
const T0 = Date.parse('2026-10-12T08:00:00.000Z');
const ts = (ms: number) => new Date(ms).toISOString();
/** One code point that is two UTF-16 units: a bound counted in code points accepts exactly N of them. */
const FOX = '\u{1F98A}';
/**
 * The characters the domain refuses in player text (social-commands.ts hasControlCharacter + hasC1Control), at each range's edges:
 * C0, DEL, C1 and the two Unicode separators. 038 must refuse each one under EVERY locale and collation provider.
 */
const REFUSED_CHARACTERS: ReadonlyArray<readonly [string, string]> = [
  ['U+0001', '\u0001'], ['a tab', '\t'], ['a line feed', '\n'], ['a carriage return', '\r'], ['U+001F', '\u001f'], ['DEL U+007F', '\u007f'],
  ['C1 U+0080', '\u0080'], ['NEXT LINE U+0085', '\u0085'], ['C1 U+009F', '\u009f'], ['LINE SEPARATOR U+2028', '\u2028'], ['PARAGRAPH SEPARATOR U+2029', '\u2029'],
];
/** Their neighbours and the format characters the domain ACCEPTS (an ICU [[:cntrl:]] would refuse some): 038 must accept each. */
const ALLOWED_CHARACTERS: ReadonlyArray<readonly [string, string]> = [
  ['a space', ' '], ['a tilde U+007E (before DEL)', '~'], ['NO-BREAK SPACE U+00A0 (after C1)', '\u00a0'], ['SOFT HYPHEN U+00AD', '\u00ad'],
  ['ZERO WIDTH SPACE U+200B', '\u200b'], ['ZERO WIDTH NON-JOINER U+200C', '\u200c'], ['a ZWJ emoji (U+1F468 U+200D U+1F469)', '\u{1F468}\u200d\u{1F469}'],
  ['U+2027 (before U+2028)', '\u2027'], ['U+202A (after U+2029)', '\u202a'], ['ZERO WIDTH NO-BREAK SPACE U+FEFF', '\ufeff'],
];
/** What social-lff.ts STORES for a post: EXPIRED is derived at read (lffPostStatusAt), never stored. */
const STORED_POST_STATUSES = LFF_POST_STATUSES.filter((s) => s !== 'EXPIRED');

const POST_SQL = 'INSERT INTO relay_wonderland.lff_posts(post_id, owner_id, category, title, description, project_label, skills, open_slots, status, created_at, updated_at, expires_at, version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)';
const REQUEST_SQL = 'INSERT INTO relay_wonderland.lff_join_requests(request_id, post_id, requester_id, message, status, created_at, updated_at) VALUES($1,$2,$3,$4,$5,$6,$7)';
const CREATION_SQL = 'INSERT INTO relay_wonderland.lff_post_creations(owner_id, post_id, created_at) VALUES($1,$2,$3)';
let serial = 0;
interface PostRow { id: string; owner: string; category: string; title: string; description: string; label: string; skills: unknown; slots: number; status: string; created: number; updated: number; expires: number; version: number }
/** A post row that every CHECK accepts, with one field overridden; a fresh `lffp_<serial>` id unless one is given. */
const post = (over: Partial<PostRow> = {}): unknown[] => {
  const r: PostRow = {
    id: `lffp_${++serial}`, owner: PLAYERS[0], category: 'TEAMS', title: 'Looking for a team', description: '', label: '', skills: [], slots: 3,
    status: 'OPEN', created: T0, updated: T0, expires: T0 + LFF_POST_TTL_MS, version: 1, ...over,
  };
  return [r.id, r.owner, r.category, r.title, r.description, r.label, r.skills, r.slots, r.status, ts(r.created), ts(r.updated), ts(r.expires), r.version];
};
interface RequestRow { id: string; post: string; requester: string; message: string; status: string; created: number; updated: number }
/** A request row every CHECK accepts (DECLINED by default, so it never holds the live slot), with one field overridden. */
const request = (postId: string, over: Partial<RequestRow> = {}): unknown[] => {
  const r: RequestRow = { id: `lffr_${++serial}`, post: postId, requester: PLAYERS[1], message: '', status: 'DECLINED', created: T0, updated: T0, ...over };
  return [r.id, r.post, r.requester, r.message, r.status, ts(r.created), ts(r.updated)];
};

type Refusal = { code: string | undefined; message: string; constraint?: string };
const refusalOf = (error: unknown): Refusal => ({
  code: (error as { code?: string }).code, message: (error as Error).message, constraint: (error as { constraint?: string }).constraint,
});

suite('migration 038: Wonderland LFF, applied explicitly after 037', () => {
  const nonce = randomBytes(5).toString('hex');
  let admin: Pool;
  const made: Array<{ name: string; pool: Pool }> = [];
  const roles: string[] = [];

  const create = async (label: string, owner?: { role: string; password: string }): Promise<Pool> => {
    const name = `wonderland038${label}${nonce}`;
    await admin.query(`CREATE DATABASE ${name}${owner ? ` OWNER ${owner.role}` : ''}`);
    const url = new URL(databaseUrl!);
    url.pathname = `/${name}`;
    if (owner) { url.username = owner.role; url.password = owner.password; }
    const pool = new Pool({ connectionString: url.toString(), max: 4 });
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
  const at037 = (label: string): Promise<Pool> => migrated(label, BEFORE_038);
  const run = async (pool: Pool, script: string): Promise<{ refusal: Refusal | null; notices: string[] }> => {
    const client = await pool.connect();
    const notices: string[] = [];
    client.on('notice', (notice) => { notices.push(notice.message ?? ''); });
    try {
      await client.query(script);
      return { refusal: null, notices };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      return { refusal: refusalOf(error), notices };
    } finally {
      client.removeAllListeners('notice');
      client.release();
    }
  };
  const at038 = async (label: string): Promise<Pool> => {
    const pool = await at037(label);
    expect((await run(pool, WONDERLAND_MIGRATION_038)).refusal, `${label}: 038 applies`).toBeNull();
    return pool;
  };
  const count = async (pool: Pool, sql: string, values: unknown[] = []): Promise<number> => Number((await pool.query(sql, values)).rows[0].n);
  const stamped = (pool: Pool, version = STAMP_038) => count(pool, 'SELECT count(*) AS n FROM relay_wonderland.schema_migrations WHERE version = $1', [version]);
  const ledgerLast = async (pool: Pool): Promise<string> => (await pool.query('SELECT max(version COLLATE "C") AS v FROM relay_wonderland.schema_migrations')).rows[0].v as string;
  const present = async (pool: Pool): Promise<string[]> => (await pool.query(
    "SELECT c.relname AS r FROM pg_class c WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND c.relname LIKE 'lff\\_%'",
  )).rows.map((row: { r: string }) => row.r).sort();
  /** relay_wonderland's catalog by definition, sorted (the 033 / 035 / 036 / 037 suites' reading, without functions' bodies). */
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
    SELECT 'internal trigger ' || c.relname || ' ' || p.proname || ' type=' || t.tgtype::text || ' constraint=' || coalesce(k.conname::text, '-')
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_proc p ON p.oid = t.tgfoid
      LEFT JOIN pg_constraint k ON k.oid = t.tgconstraint
     WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND t.tgisinternal`)).rows.map((row: { line: string }) => row.line).sort();
  /** Every relay_wonderland table's rows, as a checksum per table (EXCEPT the listed ones). */
  const checksums = async (pool: Pool, except: readonly string[]): Promise<Record<string, string>> => {
    const tables = (await pool.query(
      "SELECT c.relname AS t FROM pg_class c WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND c.relkind = 'r' ORDER BY 1",
    )).rows.map((row: { t: string }) => row.t).filter((t: string) => !except.includes(t));
    const out: Record<string, string> = {};
    for (const t of tables) {
      out[t] = (await pool.query(`SELECT count(*)::text || ':' || coalesce(md5(string_agg(r::text, '|' ORDER BY r::text)), '-') AS h FROM relay_wonderland.${t} r`)).rows[0].h as string;
    }
    return out;
  };
  const toastRelations = (pool: Pool) => count(pool, "SELECT count(*) AS n FROM pg_class WHERE relnamespace = 'pg_toast'::regnamespace");
  /** A statement the schema must refuse, with the SQLSTATE and the constraint (or unique index) that refuses it. */
  const refused = async (pool: Pool, label: string, sql: string, values: unknown[], code: string, constraint: string): Promise<void> => {
    const error = await pool.query(sql, values).then(() => null, (e: unknown) => refusalOf(e));
    expect(error, `${label}: refused`).not.toBeNull();
    expect(error?.code, `${label}: SQLSTATE (${error?.message})`).toBe(code);
    expect(error?.constraint, `${label}: the constraint`).toBe(constraint);
  };
  /** The CONTROL beside a refusal: the same statement shape, accepted. */
  const accepts = async (pool: Pool, label: string, sql: string, values: unknown[]): Promise<void> => {
    const error = await pool.query(sql, values).then(() => null, (e: unknown) => refusalOf(e));
    expect(error, `${label}: accepted`).toBeNull();
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

  it('A: at 037, 038 applies with one precheck NOTICE: it only ADDS lff_* objects (and the RI triggers its keys put on players), every column exactly, no row moves, all three tables empty, the stamp last', async () => {
    const pool = await at037('clean');
    const before = await catalog(pool);
    const rowsBefore = await checksums(pool, []);
    const { refusal, notices } = await run(pool, WONDERLAND_MIGRATION_038);
    expect(refusal).toBeNull();
    expect(notices.filter((n) => n.startsWith('migration_038_precheck'))).toHaveLength(1);
    const after = await catalog(pool);
    expect(before.filter((line) => !after.includes(line)), 'nothing removed').toEqual([]);
    const added = after.filter((line) => !before.includes(line));
    for (const line of added) expect(line, 'every added line is 038\'s').toMatch(/lff_/u);
    // EVERY COLUMN of the three tables: name, position, type and NOT NULL, and no other (requests carry no version, r2)
    expect(added.filter((line) => /^column lff_(posts|join_requests|post_creations) #/u.test(line)).sort(), 'every column, exactly').toEqual([...COLUMNS].sort());
    expect(added.some((line) => line.startsWith('column lff_join_requests ') && line.includes(' version ')), 'a request has no version').toBe(false);
    expect(added.filter((line) => line.startsWith('internal trigger players ')), 'the RI triggers on players: 2 per key, 3 keys').toHaveLength(6);
    expect(added.filter((line) => line.startsWith('internal trigger lff_posts ')), 'on lff_posts: its own key\'s 2 checks, and 2 as the requests\' parent').toHaveLength(4);
    expect(added.filter((line) => line.startsWith('internal trigger lff_join_requests ')), 'on lff_join_requests: 2 checks per key, 2 keys').toHaveLength(4);
    expect(added.filter((line) => line.startsWith('internal trigger lff_post_creations ')), 'on lff_post_creations: its one key\'s 2 checks (none to lff_posts)').toHaveLength(2);
    expect(added.filter((line) => line.startsWith('internal trigger ') && !/^internal trigger (players|lff_posts|lff_join_requests|lff_post_creations) /u.test(line)), 'no RI trigger anywhere else').toEqual([]);
    expect(await present(pool)).toEqual([...RELATIONS].sort());
    const counts = (await pool.query(`
      SELECT count(*) FILTER (WHERE contype = 'c') AS checks, count(*) FILTER (WHERE contype = 'p') AS pks, count(*) FILTER (WHERE contype = 'f') AS fks,
             count(*) FILTER (WHERE contype = 'u') AS uniques
        FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
       WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND c.relname LIKE 'lff\\_%'`)).rows[0];
    expect({ checks: Number(counts.checks), pks: Number(counts.pks), fks: Number(counts.fks), uniques: Number(counts.uniques) }).toEqual({ checks: 15, pks: 3, fks: 4, uniques: 0 });
    expect(await count(pool, "SELECT count(*) AS n FROM pg_constraint WHERE contype = 'f' AND conrelid = 'relay_wonderland.lff_post_creations'::regclass AND confrelid = 'relay_wonderland.lff_posts'::regclass"), 'a creation record has no key to its post').toBe(0);
    const partial = (await pool.query(`SELECT pg_get_expr(indpred, indrelid) AS p FROM pg_index WHERE indexrelid = 'relay_wonderland.${ONE_LIVE}'::regclass`)).rows[0].p as string;
    for (const live of ['PENDING', 'ACCEPTED']) expect(partial, `the one-live index holds ${live} rows`).toContain(`'${live}'`);
    for (const resolved of ['DECLINED', 'WITHDRAWN', 'CANCELLED']) expect(partial, `the one-live index leaves ${resolved} rows out`).not.toContain(resolved);
    const rowsAfter = await checksums(pool, TABLES);
    expect({ ...rowsAfter, schema_migrations: '-' }).toEqual({ ...rowsBefore, schema_migrations: '-' });
    for (const t of TABLES) expect(await count(pool, `SELECT count(*) AS n FROM relay_wonderland.${t}`), `${t} empty`).toBe(0);
    expect(await ledgerLast(pool)).toBe(STAMP_038);
  }, 180_000);

  it('G: the guard refuses before 037, a second time, after a later stamp, and with an lff_* relation present -- creating and stamping nothing', async () => {
    const early = await migrated('early', BEFORE_037);
    const twice = await at038('twice');
    const later = await at037('later');
    await later.query('INSERT INTO relay_wonderland.schema_migrations(version) VALUES($1)', ['039_later_lane_probe']);
    const squatted = await at037('squat');
    await squatted.query('CREATE TABLE relay_wonderland.lff_notes(x int)');
    const nameTaken = await at037('nametaken');
    await nameTaken.query('CREATE TABLE relay_wonderland.probe_038(x int); CREATE INDEX lff_post_creations_pkey ON relay_wonderland.probe_038(x)');
    const taken = 'migration_038_refused: relation(s) named lff_* already exist in relay_wonderland';
    for (const [label, pool, message] of [
      ['before 037', early, 'migration_038_refused: 037 is not applied here'],
      ['a second time', twice, 'migration_038_refused: 038 is already applied here'],
      ['a later stamp', later, "migration_038_refused: the ledger's last stamp is 039_later_lane_probe, not 037"],
      ['a relation present', squatted, `${taken} (lff_notes)`],
      ['a name 038 creates, taken by another table\'s index', nameTaken, `${taken} (lff_post_creations_pkey)`],
    ] as const) {
      const [catalogBefore, stampsBefore] = [await catalog(pool), await stamped(pool)];
      const attempt = await run(pool, WONDERLAND_MIGRATION_038);
      expect(attempt.refusal?.message, label).toContain(message);
      expect(attempt.notices.some((line) => line.startsWith('migration_038_precheck:')), `${label}: no precheck NOTICE`).toBe(false);
      expect(await catalog(pool), `${label}: nothing changed`).toEqual(catalogBefore);
      expect(await stamped(pool), `${label}: nothing stamped`).toBe(stampsBefore);
    }
    expect(await stamped(early)).toBe(0);
  }, 300_000);

  it('POST: the post-check refuses, rolling everything back, when what the file creates is not what it proves', async () => {
    const statement = (text: string): string => {
      expect(WONDERLAND_MIGRATION_038.split(text).length - 1, `written once: ${text}`).toBe(1);
      return text;
    };
    // A replacer FUNCTION throughout: as a replacement STRING, "$'" would expand to the text after the match.
    const mutate = (text: string, replacement: string): string => WONDERLAND_MIGRATION_038.replace(statement(text), () => replacement);
    const relations = "migration_038_postcheck: relation(s) not exactly as 038 creates them, or not 038's";
    const constraints = "migration_038_postcheck: constraint(s) not exactly as 038 creates them, or not 038's";
    const ONE_LIVE_WHERE = "ON relay_wonderland.lff_join_requests(post_id, requester_id) WHERE status IN ('PENDING', 'ACCEPTED');";
    const OWNER_FK = 'CONSTRAINT lff_posts_owner_fk FOREIGN KEY(owner_id) REFERENCES relay_wonderland.players(player_id) ON DELETE CASCADE,';
    const LAST_INDEX = 'CREATE INDEX lff_post_creations_recent ON relay_wonderland.lff_post_creations(owner_id, created_at);';
    const after = (sql: string) => mutate(LAST_INDEX, `${LAST_INDEX}\n${sql}`);
    const mutants: Array<[string, string, string]> = [
      ['the one-live index not partial (it would refuse every second request, ever)',
        mutate(ONE_LIVE_WHERE, 'ON relay_wonderland.lff_join_requests(post_id, requester_id);'), `${relations} (${ONE_LIVE})`],
      ['an extra lff_* relation', after('CREATE INDEX lff_posts_extra ON relay_wonderland.lff_posts(title);'), `${relations} (lff_posts_extra)`],
      ['a CHECK missing', mutate('CONSTRAINT lff_posts_open_slots CHECK(open_slots BETWEEN 1 AND 20),', ''), `${constraints} (lff_posts_open_slots)`],
      ['an extra constraint', after('ALTER TABLE relay_wonderland.lff_posts ADD CONSTRAINT lff_posts_extra_check CHECK(open_slots < 99);'), `${constraints} (lff_posts_extra_check)`],
      ['a key from a creation record to its post (a delete would then forget it, and the cap would reset)',
        after('ALTER TABLE relay_wonderland.lff_post_creations ADD CONSTRAINT lff_post_creations_post_fk FOREIGN KEY(post_id) REFERENCES relay_wonderland.lff_posts(post_id) ON DELETE CASCADE;'),
        `${constraints} (lff_post_creations_post_fk)`],
      ['the owner key no longer cascading', mutate(OWNER_FK, OWNER_FK.replace('ON DELETE CASCADE', 'ON DELETE RESTRICT')), `${constraints} (lff_posts_owner_fk)`],
      ['a row written', after(`INSERT INTO relay_wonderland.lff_post_creations(owner_id, post_id, created_at) VALUES('${PLAYERS[0]}', 'lffp_1', now());`),
        'migration_038_postcheck: lff_post_creations holds 1 row(s), and 038 writes none'],
    ];
    const pool = await at037('postcheck');
    const catalogBefore = await catalog(pool);
    for (const [label, mutant, refusal] of mutants) {
      expect(mutant, `${label}: the mutant differs from 038`).not.toBe(WONDERLAND_MIGRATION_038);
      const attempt = await run(pool, mutant);
      expect(attempt.refusal?.message, label).toContain(refusal);
      expect(await catalog(pool), `${label}: rolled back`).toEqual(catalogBefore);
      expect(await stamped(pool), `${label}: not stamped`).toBe(0);
    }
    // CONTROL: the file itself passes its own post-check on the same database
    expect((await run(pool, WONDERLAND_MIGRATION_038)).refusal, '038 itself applies').toBeNull();
  }, 300_000);

  it('C: every constraint holds against real rows, each refusal beside a control that is accepted, with social-lff.ts\'s own vocabulary, bounds and refused characters', async () => {
    const pool = await at038('constraints');
    const [A, B, C, D] = PLAYERS;
    const P = POST_SQL;
    const R = REQUEST_SQL;

    // THE POST ID: `lffp_<serial>`, the serial a positive integer
    await refused(pool, 'a post id with a leading zero', P, post({ id: 'lffp_01' }), '23514', 'lff_posts_post_id_shape');
    await refused(pool, 'post id 0', P, post({ id: 'lffp_0' }), '23514', 'lff_posts_post_id_shape');
    await refused(pool, 'a request-shaped id on a post', P, post({ id: 'lffr_7' }), '23514', 'lff_posts_post_id_shape');
    await refused(pool, 'a post id of 19 digits', P, post({ id: `lffp_${'1'.repeat(19)}` }), '23514', 'lff_posts_post_id_shape');
    await accepts(pool, 'a post id of 18 digits', P, post({ id: `lffp_${'9'.repeat(18)}` }));
    // THE OWNER: a real player
    await refused(pool, 'an owner who is not a player', P, post({ owner: 'usr_nobody' }), '23503', 'lff_posts_owner_fk');
    // THE CATEGORY: exactly social-lff.ts's six
    await refused(pool, 'a category outside the six', P, post({ category: 'MENTORS' }), '23514', 'lff_posts_category');
    await refused(pool, 'a category in another case', P, post({ category: 'teams' }), '23514', 'lff_posts_category');
    for (const category of LFF_CATEGORIES) await accepts(pool, `category ${category}`, P, post({ category }));
    // THE TITLE: 1-80 code points
    await refused(pool, 'an empty title', P, post({ title: '' }), '23514', 'lff_posts_title');
    await accepts(pool, 'a title of 1', P, post({ title: 'x' }));
    await accepts(pool, `a title of ${LFF_TITLE_MAX}`, P, post({ title: 'x'.repeat(LFF_TITLE_MAX) }));
    await refused(pool, `a title of ${LFF_TITLE_MAX + 1}`, P, post({ title: 'x'.repeat(LFF_TITLE_MAX + 1) }), '23514', 'lff_posts_title');
    await accepts(pool, `a title of ${LFF_TITLE_MAX} code points (${LFF_TITLE_MAX * 2} UTF-16 units)`, P, post({ title: FOX.repeat(LFF_TITLE_MAX) }));
    await refused(pool, `a title of ${LFF_TITLE_MAX + 1} code points`, P, post({ title: FOX.repeat(LFF_TITLE_MAX + 1) }), '23514', 'lff_posts_title');
    // THE DESCRIPTION: 0-1000, and NO line break (the contract refuses control characters everywhere; social-commands.ts lffText)
    await accepts(pool, 'an empty description', P, post({ description: '' }));
    await accepts(pool, `a description of ${LFF_DESCRIPTION_MAX}`, P, post({ description: 'd'.repeat(LFF_DESCRIPTION_MAX) }));
    await refused(pool, `a description of ${LFF_DESCRIPTION_MAX + 1}`, P, post({ description: 'd'.repeat(LFF_DESCRIPTION_MAX + 1) }), '23514', 'lff_posts_description');
    await accepts(pool, 'a description with punctuation and spaces', P, post({ description: 'We build: a co-op raid. 4 evenings / week, UTC+1!' }));
    // THE PROJECT / ACTIVITY LABEL: 0-80
    await accepts(pool, 'no label', P, post({ label: '' }));
    await accepts(pool, `a label of ${LFF_PROJECT_LABEL_MAX}`, P, post({ label: 'p'.repeat(LFF_PROJECT_LABEL_MAX) }));
    await refused(pool, `a label of ${LFF_PROJECT_LABEL_MAX + 1}`, P, post({ label: 'p'.repeat(LFF_PROJECT_LABEL_MAX + 1) }), '23514', 'lff_posts_project_label');
    // THE DOMAIN'S REFUSED CHARACTERS, in every text of a post, whatever the database's locale; each allowed neighbour accepted
    for (const [name, ch] of REFUSED_CHARACTERS) {
      await refused(pool, `${name} in the title`, P, post({ title: `a${ch}b` }), '23514', 'lff_posts_title');
      await refused(pool, `${name} in the description`, P, post({ description: `line one${ch}line two` }), '23514', 'lff_posts_description');
      await refused(pool, `${name} in the label`, P, post({ label: `a${ch}b` }), '23514', 'lff_posts_project_label');
      await refused(pool, `${name} inside a skill`, P, post({ skills: ['ux', `a${ch}b`] }), '23514', 'lff_posts_skills');
    }
    for (const [name, ch] of ALLOWED_CHARACTERS) {
      await accepts(pool, `${name} in the title`, P, post({ title: `a${ch}b` }));
      await accepts(pool, `${name} in the description`, P, post({ description: `line one${ch}line two` }));
      await accepts(pool, `${name} in the label`, P, post({ label: `a${ch}b` }));
      await accepts(pool, `${name} inside a skill`, P, post({ skills: ['ux', `a${ch}b`] }));
    }
    // THE SKILLS: 0-8 items, each 1-32 code points, no refused character, no NULL item, one dimension
    const S = 'lff_posts_skills';
    const skills = (n: number) => Array.from({ length: n }, (_, i) => `skill-${i}`);
    await accepts(pool, 'no skills', P, post({ skills: [] }));
    await accepts(pool, 'one skill of one character', P, post({ skills: ['a'] }));
    await accepts(pool, `${LFF_SKILLS_MAX} skills`, P, post({ skills: skills(LFF_SKILLS_MAX) }));
    await refused(pool, `${LFF_SKILLS_MAX + 1} skills`, P, post({ skills: skills(LFF_SKILLS_MAX + 1) }), '23514', S);
    await accepts(pool, `a skill of ${LFF_SKILL_MAX}`, P, post({ skills: ['ux', 's'.repeat(LFF_SKILL_MAX)] }));
    await accepts(pool, `a skill of ${LFF_SKILL_MAX} code points`, P, post({ skills: [FOX.repeat(LFF_SKILL_MAX), 'ux'] }));
    await refused(pool, `a skill of ${LFF_SKILL_MAX + 1}`, P, post({ skills: ['ux', 's'.repeat(LFF_SKILL_MAX + 1)] }), '23514', S);
    await refused(pool, `a skill of ${LFF_SKILL_MAX + 1} code points`, P, post({ skills: [FOX.repeat(LFF_SKILL_MAX + 1)] }), '23514', S);
    await accepts(pool, 'skills with spaces and punctuation', P, post({ skills: ['Unreal Engine 5', 'C++', 'UX/UI'] }));
    for (const [label, list] of [['alone', ['']], ['first', ['', 'ux']], ['between', ['ux', '', 'ui']], ['last', ['ux', '']]] as const) {
      await refused(pool, `an empty skill, ${label}`, P, post({ skills: [...list] }), '23514', S);
    }
    await refused(pool, 'a NULL skill', P, post({ skills: ['ux', null] }), '23514', S);
    await refused(pool, 'a NULL skill alone', P, post({ skills: [null] }), '23514', S);
    // the separator the CHECK joins with (U+001F), inside ONE item, must not read as two items of 1-32
    await refused(pool, 'one skill holding the join separator', P, post({ skills: ['ux\u001fui'] }), '23514', S);
    await refused(pool, 'a two-dimensional list', P, post({ skills: [['ux', 'ui'], ['qa', 'pm']] }), '23514', S);
    // OPEN SLOTS: 1-20
    for (const slots of [LFF_SLOTS_MIN - 2, LFF_SLOTS_MIN - 1, LFF_SLOTS_MAX + 1]) await refused(pool, `${slots} slots`, P, post({ slots }), '23514', 'lff_posts_open_slots');
    for (const slots of [LFF_SLOTS_MIN, LFF_SLOTS_MAX]) await accepts(pool, `${slots} slots`, P, post({ slots }));
    // THE STATUS: exactly what social-lff.ts STORES. EXPIRED is never stored: it is read, strictly after expires_at.
    for (const status of STORED_POST_STATUSES) await accepts(pool, `a stored ${status} post`, P, post({ status }));
    for (const status of ['EXPIRED', 'FULL', 'open', 'DELETED']) await refused(pool, `a stored ${status} post`, P, post({ status }), '23514', 'lff_posts_status');
    // THE VERSION (a post's; a request has none): from 1
    await refused(pool, 'version 0', P, post({ version: 0 }), '23514', 'lff_posts_version');
    await accepts(pool, 'version 2', P, post({ version: 2 }));
    // THE TIMES: in order; the expiry after creation and at most 30 days after it (a SANITY bound; 14 days is PROPOSED, D-L2)
    const times = 'lff_posts_times';
    await refused(pool, 'updated before created', P, post({ updated: T0 - 1 }), '23514', times);
    await refused(pool, 'expiring at its creation', P, post({ expires: T0 }), '23514', times);
    await refused(pool, 'expiring before its creation', P, post({ expires: T0 - DAY }), '23514', times);
    await refused(pool, 'expiring 30 days + 1 ms after its creation', P, post({ expires: T0 + 30 * DAY + 1 }), '23514', times);
    await accepts(pool, 'expiring 1 ms after its creation', P, post({ expires: T0 + 1 }));
    await accepts(pool, 'expiring exactly 30 days after its creation', P, post({ expires: T0 + 30 * DAY }));
    await accepts(pool, 'the PROPOSED 14-day expiry (LFF_POST_TTL_MS), edited a day later', P, post({ expires: T0 + LFF_POST_TTL_MS, updated: T0 + DAY }));

    // REQUESTS, against two real posts
    const BASE = 'lffp_700001';
    const OTHER = 'lffp_700002';
    await accepts(pool, 'the base post (owner A)', P, post({ id: BASE, owner: A }));
    await accepts(pool, 'another post (owner B)', P, post({ id: OTHER, owner: B }));
    // THE REQUEST ID, THE POST, THE REQUESTER
    await refused(pool, 'a request id with a leading zero', R, request(BASE, { id: 'lffr_01' }), '23514', 'lff_join_requests_request_id_shape');
    await refused(pool, 'a post-shaped id on a request', R, request(BASE, { id: 'lffp_9' }), '23514', 'lff_join_requests_request_id_shape');
    await refused(pool, 'a post that does not exist', R, request('lffp_404'), '23503', 'lff_join_requests_post_fk');
    await refused(pool, 'a requester who is not a player', R, request(BASE, { requester: 'usr_nobody' }), '23503', 'lff_join_requests_requester_fk');
    // THE MESSAGE: 0-200, none of the domain's refused characters
    await accepts(pool, 'no message', R, request(BASE, { message: '' }));
    await accepts(pool, `a message of ${LFF_MESSAGE_MAX}`, R, request(BASE, { message: 'm'.repeat(LFF_MESSAGE_MAX) }));
    await accepts(pool, `a message of ${LFF_MESSAGE_MAX} code points`, R, request(BASE, { message: FOX.repeat(LFF_MESSAGE_MAX) }));
    await refused(pool, `a message of ${LFF_MESSAGE_MAX + 1}`, R, request(BASE, { message: 'm'.repeat(LFF_MESSAGE_MAX + 1) }), '23514', 'lff_join_requests_message');
    for (const [name, ch] of REFUSED_CHARACTERS) await refused(pool, `${name} in the message`, R, request(BASE, { message: `hi${ch}there` }), '23514', 'lff_join_requests_message');
    for (const [name, ch] of ALLOWED_CHARACTERS) await accepts(pool, `${name} in the message`, R, request(BASE, { message: `hi${ch}there` }));
    // THE STATUS: exactly social-lff.ts LFF_REQUEST_STATUSES, CANCELLED (a block crossed it) included; NO_LONGER_AVAILABLE is a view.
    // One row each; the two LIVE ones (PENDING, ACCEPTED) by different requesters, as the one-live index requires.
    for (const status of LFF_REQUEST_STATUSES) await accepts(pool, `a stored ${status} request`, R, request(BASE, { requester: status === 'ACCEPTED' ? D : B, status }));
    for (const status of ['NO_LONGER_AVAILABLE', 'EXPIRED', 'CANCELED', 'cancelled', 'pending']) {
      await refused(pool, `a stored ${status} request`, R, request(BASE, { status }), '23514', 'lff_join_requests_status');
    }
    // THE TIMES
    await refused(pool, 'a request updated before it was made', R, request(BASE, { updated: T0 - 1 }), '23514', 'lff_join_requests_times');
    await accepts(pool, 'a request updated after it was made', R, request(BASE, { updated: T0 + DAY }));

    // ONE LIVE REQUEST PER (post, requester): PENDING or ACCEPTED (social-lff.ts createLffRequest refuses a new request while the
    // pair holds either). B holds a PENDING on BASE and D an ACCEPTED one (the status loop above).
    const liveOf = (postId: string, requester: string) => count(pool, "SELECT count(*) AS n FROM relay_wonderland.lff_join_requests WHERE post_id = $1 AND requester_id = $2 AND status IN ('PENDING', 'ACCEPTED')", [postId, requester]);
    expect([await liveOf(BASE, B), await liveOf(BASE, D)], 'one live request each').toEqual([1, 1]);
    await refused(pool, 'a second PENDING request for the same pair', R, request(BASE, { requester: B, status: 'PENDING' }), '23505', ONE_LIVE);
    await refused(pool, 'an ACCEPTED request beside a PENDING one for the same pair', R, request(BASE, { requester: B, status: 'ACCEPTED' }), '23505', ONE_LIVE);
    await refused(pool, 'a new PENDING request once accepted', R, request(BASE, { requester: D, status: 'PENDING' }), '23505', ONE_LIVE);
    await refused(pool, 'a second ACCEPTED request for the same pair (one person, two slots)', R, request(BASE, { requester: D, status: 'ACCEPTED' }), '23505', ONE_LIVE);
    await accepts(pool, 'CONTROL: the same requester, PENDING on another post', R, request(OTHER, { requester: B, status: 'PENDING' }));
    await accepts(pool, 'CONTROL: another requester, PENDING on the same post', R, request(BASE, { requester: C, status: 'PENDING' }));
    for (const status of ['DECLINED', 'WITHDRAWN', 'CANCELLED']) {
      await accepts(pool, `CONTROL: another ${status} row beside a live one (resolved rows hold no slot)`, R, request(BASE, { requester: B, status }));
    }
    // an accept changes the row in place: still one live row
    await accepts(pool, 'a PENDING request accepted in place', "UPDATE relay_wonderland.lff_join_requests SET status = 'ACCEPTED', updated_at = $3 WHERE post_id = $1 AND requester_id = $2 AND status = 'PENDING'", [BASE, B, ts(T0 + DAY)]);
    expect(await liveOf(BASE, B)).toBe(1);
    // CANCELLED holds no live slot: a block cancels C's PENDING request; after an unblock C may ask again
    await pool.query("UPDATE relay_wonderland.lff_join_requests SET status = 'CANCELLED', updated_at = $3 WHERE post_id = $1 AND requester_id = $2 AND status = 'PENDING'", [BASE, C, ts(T0 + DAY)]);
    expect(await liveOf(BASE, C)).toBe(0);
    await accepts(pool, 'a new PENDING request after a CANCELLED one', R, request(BASE, { requester: C, status: 'PENDING' }));
    // a block may cancel an ACCEPTED request too, freeing its slot: D's row moves ACCEPTED -> CANCELLED, and D may ask again
    const dAccepted = (await pool.query("SELECT request_id AS id FROM relay_wonderland.lff_join_requests WHERE post_id = $1 AND requester_id = $2 AND status = 'ACCEPTED'", [BASE, D])).rows[0].id as string;
    await accepts(pool, 'an ACCEPTED request cancelled by a block', "UPDATE relay_wonderland.lff_join_requests SET status = 'CANCELLED', updated_at = $2 WHERE request_id = $1", [dAccepted, ts(T0 + 2 * DAY)]);
    await accepts(pool, 'a new PENDING request after a cancelled acceptance', R, request(BASE, { requester: D, status: 'PENDING' }));
    // the index guards UPDATEs too: the cancelled acceptance cannot come back beside D's new PENDING request
    await refused(pool, 'a CANCELLED request back to ACCEPTED beside a PENDING one', "UPDATE relay_wonderland.lff_join_requests SET status = 'ACCEPTED' WHERE request_id = $1", [dAccepted], '23505', ONE_LIVE);
    // a decline frees the slot: C's PENDING request declined, then C asks again
    await pool.query("UPDATE relay_wonderland.lff_join_requests SET status = 'DECLINED', updated_at = $3 WHERE post_id = $1 AND requester_id = $2 AND status = 'PENDING'", [BASE, C, ts(T0 + DAY)]);
    await accepts(pool, 'the same pair asks again after a decline', R, request(BASE, { requester: C, status: 'PENDING' }));

    // NOT A SCHEMA RULE, DELIBERATELY: the owner requesting their own post. No plain CHECK can read lff_posts from a request row;
    // social-lff.ts refuses it (a self-request), and the schema says nothing either way.
    await accepts(pool, 'the owner requesting their own post (the domain refuses it; the schema cannot)', R, request(BASE, { requester: A, status: 'WITHDRAWN' }));

    // THE CREATION RECORD (the r2 creation cap's durable fact): one per (owner, post), a real owner, a post-shaped id, NO key to the post
    const PC = CREATION_SQL;
    await accepts(pool, 'a creation record', PC, [A, BASE, ts(T0)]);
    await accepts(pool, 'another owner\'s creation record', PC, [B, OTHER, ts(T0)]);
    await refused(pool, 'the same post recorded twice for its owner', PC, [A, BASE, ts(T0 + 1)], '23505', 'lff_post_creations_pkey');
    await refused(pool, 'a creation record for an owner who is not a player', PC, ['usr_nobody', 'lffp_800001', ts(T0)], '23503', 'lff_post_creations_owner_fk');
    for (const id of ['lffr_1', 'lffp_0', 'lffp_01', `lffp_${'1'.repeat(19)}`, 'post_1']) {
      await refused(pool, `a creation record for post id ${id}`, PC, [A, id, ts(T0)], '23514', 'lff_post_creations_post_id_shape');
    }
    await accepts(pool, 'a creation record whose post no longer exists (a deleted post still counts toward the cap)', PC, [A, 'lffp_800002', ts(T0)]);
    await accepts(pool, 'two creation records at the same time', PC, [A, 'lffp_800003', ts(T0)]);

    // THE CASCADES
    const requestsOn = (postId: string) => count(pool, 'SELECT count(*) AS n FROM relay_wonderland.lff_join_requests WHERE post_id = $1', [postId]);
    const requestsBy = (player: string) => count(pool, 'SELECT count(*) AS n FROM relay_wonderland.lff_join_requests WHERE requester_id = $1', [player]);
    const postsOf = (player: string) => count(pool, 'SELECT count(*) AS n FROM relay_wonderland.lff_posts WHERE owner_id = $1', [player]);
    const creationsOf = (player: string) => count(pool, 'SELECT count(*) AS n FROM relay_wonderland.lff_post_creations WHERE owner_id = $1', [player]);
    // a post delete (the owner's HARD delete) takes its requests, and only its own -- and LEAVES its creation record
    const [onBase, onOther] = [await requestsOn(BASE), await requestsOn(OTHER)];
    expect(onOther, 'OTHER has a request').toBeGreaterThan(0);
    await pool.query('DELETE FROM relay_wonderland.lff_posts WHERE post_id = $1', [OTHER]);
    expect(await requestsOn(OTHER), 'the deleted post\'s requests went with it').toBe(0);
    expect(await requestsOn(BASE), 'no other post\'s requests moved').toBe(onBase);
    expect(await count(pool, 'SELECT count(*) AS n FROM relay_wonderland.lff_post_creations WHERE owner_id = $1 AND post_id = $2', [B, OTHER]), 'the creation record outlives the post: the cap still counts it').toBe(1);
    // a player delete takes their own requests (C only requested), and leaves the posts they asked to join
    const THIRD = 'lffp_700003';
    await accepts(pool, 'a post by B', P, post({ id: THIRD, owner: B }));
    await accepts(pool, 'A asks to join B\'s post', R, request(THIRD, { requester: A, status: 'PENDING' }));
    const byC = await requestsBy(C);
    expect(byC, 'C has requests').toBeGreaterThan(0);
    await pool.query('DELETE FROM relay_wonderland.players WHERE player_id = $1', [C]);
    expect(await requestsBy(C), 'C\'s requests went with C').toBe(0);
    expect(await requestsOn(BASE), 'BASE kept every request but C\'s').toBe(onBase - byC);
    // an OWNER's delete takes their posts, every request TO those posts, their own requests on others' posts, and their creation records
    expect([await postsOf(A) > 0, await creationsOf(A) > 0]).toEqual([true, true]);
    await pool.query('DELETE FROM relay_wonderland.players WHERE player_id = $1', [A]);
    expect(await postsOf(A), 'A\'s posts went with A').toBe(0);
    expect(await requestsOn(BASE), 'and every request to them').toBe(0);
    expect(await requestsBy(A), 'and A\'s own request on B\'s post').toBe(0);
    expect(await creationsOf(A), 'and A\'s creation records').toBe(0);
    expect(await count(pool, 'SELECT count(*) AS n FROM relay_wonderland.lff_posts WHERE post_id = $1', [THIRD]), 'B\'s post stays').toBe(1);
    expect(await creationsOf(B), 'B\'s creation record stays').toBe(1);
    expect(await count(pool, 'SELECT count(*) AS n FROM relay_wonderland.players WHERE player_id = $1', [B]), 'B stays').toBe(1);
  }, 300_000);

  it('H: DOWN refuses while a later migration is applied, while any table holds a row and while a relation is not as 038 created it; empty, it restores the catalog exactly, and 038 applies again; 037\'s DOWN refuses while 038 is stamped', async () => {
    const pool = await at037('down');
    const [before038, toastBefore, rowsBefore] = [await catalog(pool), await toastRelations(pool), await checksums(pool, [])];
    expect((await run(pool, WONDERLAND_MIGRATION_038)).refusal, '038 applies').toBeNull();
    // THE ROLLBACK ORDER, from 037's side: its DOWN refuses while 038 is stamped
    expect((await run(pool, DOWN_037)).refusal?.message).toContain(`migration_037_down_refused: a later migration is applied (${STAMP_038})`);
    // a later migration
    await pool.query("INSERT INTO relay_wonderland.schema_migrations(version) VALUES('039_later_lane_probe')");
    expect((await run(pool, DOWN)).refusal?.message).toContain('migration_038_down_refused: a later migration is applied (039_later_lane_probe)');
    await pool.query("DELETE FROM relay_wonderland.schema_migrations WHERE version = '039_later_lane_probe'");
    // ANY LFF row: no down script of this chain loses data (a creation record is a player's cap history)
    const data = 'migration_038_down_refused: LFF data exists';
    await pool.query(POST_SQL, post({ id: 'lffp_1' }));
    expect((await run(pool, DOWN)).refusal?.message).toContain(`${data} (lff_posts 1)`);
    await pool.query(REQUEST_SQL, request('lffp_1', { status: 'PENDING' }));
    expect((await run(pool, DOWN)).refusal?.message).toContain(`${data} (lff_join_requests 1, lff_posts 1)`);
    await pool.query(CREATION_SQL, [PLAYERS[0], 'lffp_1', ts(T0)]);
    expect((await run(pool, DOWN)).refusal?.message).toContain(`${data} (lff_join_requests 1, lff_post_creations 1, lff_posts 1)`);
    await pool.query('DELETE FROM relay_wonderland.lff_posts');
    expect((await run(pool, DOWN)).refusal?.message, 'the post delete cascaded its request, and left its creation record').toContain(`${data} (lff_post_creations 1)`);
    await pool.query('DELETE FROM relay_wonderland.lff_post_creations');
    // a relation not as 038 created it
    await pool.query('DROP INDEX relay_wonderland.lff_posts_feed');
    expect((await run(pool, DOWN)).refusal?.message).toContain("migration_038_down_refused: relation(s) not exactly as 038 created them, or not 038's (lff_posts_feed)");
    await pool.query('CREATE INDEX lff_posts_feed ON relay_wonderland.lff_posts(created_at DESC, post_id)');
    expect(await stamped(pool), 'every refusal changed nothing').toBe(1);
    // THE WAY BACK
    expect((await run(pool, DOWN)).refusal, 'the DOWN runs').toBeNull();
    expect(await catalog(pool), 'the catalog exactly as before 038').toEqual(before038);
    expect(await toastRelations(pool), 'no toast relation left behind').toBe(toastBefore);
    expect(await checksums(pool, []), 'every row as before 038').toEqual(rowsBefore);
    expect(await stamped(pool), 'the stamp is gone').toBe(0);
    expect(await ledgerLast(pool)).toBe(STAMP_037);
    expect((await run(pool, DOWN)).refusal?.message, 'a second DOWN').toContain('migration_038_down_refused: 038 is not applied here');
    expect((await run(pool, WONDERLAND_MIGRATION_038)).refusal, '038 applies again').toBeNull();
  }, 300_000);

  it("CHAIN: the product's migrate() carries 038 right after 037, a new database has the 13 relations and no LFF row, and a second migrate() changes nothing", async () => {
    const pool = await create('chain');
    await new TransactionalWonderlandDatabase(pool).migrate();
    const stamps = (await pool.query('SELECT version FROM relay_wonderland.schema_migrations ORDER BY version COLLATE "C"')).rows.map((r: { version: string }) => r.version);
    expect(stamps.slice(stamps.indexOf(STAMP_037), stamps.indexOf(STAMP_037) + 2), '037 then 038, adjacent').toEqual([STAMP_037, STAMP_038]);
    expect(WONDERLAND_MIGRATIONS.indexOf(WONDERLAND_MIGRATION_038), 'registered right after 037').toBe(WONDERLAND_MIGRATIONS.indexOf(WONDERLAND_MIGRATION_037) + 1);
    expect(await present(pool), 'the 13 relations, exactly').toEqual([...RELATIONS].sort());
    const catalogOnce = await catalog(pool);
    await new TransactionalWonderlandDatabase(pool).migrate();
    expect(await catalog(pool), 'a second migrate() changes nothing').toEqual(catalogOnce);
    for (const t of TABLES) expect(await count(pool, `SELECT count(*) AS n FROM relay_wonderland.${t}`), `${t} is empty`).toBe(0);
  }, 180_000);

  it('ROLE: a NOSUPERUSER database owner (the O1 bootstrap D4 role) applies the whole chain, 038 included', async () => {
    const role = `lff038owner${nonce}`;
    const password = randomBytes(18).toString('hex');
    await admin.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${password}'`);
    roles.push(role);
    const pool = await create('role', { role, password });
    expect((await pool.query('SELECT rolsuper FROM pg_roles WHERE rolname = current_user')).rows[0].rolsuper, 'not a superuser').toBe(false);
    await new TransactionalWonderlandDatabase(pool).migrate();
    expect(await stamped(pool), 'the whole chain, 038 included').toBe(1);
    expect(await ledgerLast(pool), 'the whole chain, to its last').toBe(migrationVersion(WONDERLAND_MIGRATIONS[WONDERLAND_MIGRATIONS.length - 1]));
    expect(await present(pool)).toEqual([...RELATIONS].sort());
  }, 180_000);
});

/**
 * STATIC (no database; runs in every suite): the schema states EXACTLY social-lff.ts's vocabulary and bounds, and the domain's
 * refused-character set as an explicit, locale-independent class, so memory and PostgreSQL cannot drift apart. The real-PostgreSQL
 * C case above proves each one holds at its edge; this pins the numbers.
 */
describe('migration 038 states social-lff.ts\'s own vocabulary and bounds (static)', () => {
  const sql = WONDERLAND_MIGRATION_038;
  /** The domain's refused set as the SQL spells it (social-commands.ts hasControlCharacter + hasC1Control). */
  const REFUSED = '\\u0001-\\u001f\\u007f-\\u009f\\u2028\\u2029';
  /** The quoted values of `CONSTRAINT <name> CHECK(<column> IN (...))`, in order. */
  const listIn = (constraint: string): string[] => {
    const match = new RegExp(`CONSTRAINT ${constraint} CHECK\\(\\w+ IN \\(([^)]*)\\)\\)`, 'u').exec(sql);
    expect(match, `${constraint} is an IN list`).not.toBeNull();
    return [...(match?.[1] ?? '').matchAll(/'([^']*)'/gu)].map((m) => m[1]);
  };
  const occurrences = (text: string): number => sql.split(text).length - 1;

  it('is registered, right after 037, and stamps its own version', () => {
    expect(sql.trim()).not.toBe('');
    expect(INDEX_038).toBe(WONDERLAND_MIGRATIONS.indexOf(WONDERLAND_MIGRATION_037) + 1);
    expect(migrationVersion(sql)).toBe(STAMP_038);
  });

  it('the categories, the STORED post statuses and the request statuses are exactly social-lff.ts\'s, in order', () => {
    expect(listIn('lff_posts_category')).toEqual([...LFF_CATEGORIES]);
    expect(listIn('lff_posts_status'), 'EXPIRED is read, never stored').toEqual(STORED_POST_STATUSES);
    expect(listIn('lff_join_requests_status'), 'CANCELLED included').toEqual([...LFF_REQUEST_STATUSES]);
  });

  it('every bound is social-lff.ts\'s number, counted in code points', () => {
    expect(occurrences(`char_length(title) BETWEEN 1 AND ${LFF_TITLE_MAX} AND title !~ '[${REFUSED}]'`)).toBe(1);
    expect(occurrences(`char_length(description) <= ${LFF_DESCRIPTION_MAX} AND description !~ '[${REFUSED}]'`)).toBe(1);
    expect(occurrences(`char_length(project_label) <= ${LFF_PROJECT_LABEL_MAX} AND project_label !~ '[${REFUSED}]'`)).toBe(1);
    expect(occurrences(`char_length(message) <= ${LFF_MESSAGE_MAX} AND message !~ '[${REFUSED}]'`)).toBe(1);
    expect(occurrences(`cardinality(skills) <= ${LFF_SKILLS_MAX}`)).toBe(1);
    expect(occurrences(`'^[^${REFUSED}]{1,${LFF_SKILL_MAX}}(\\u001f[^${REFUSED}]{1,${LFF_SKILL_MAX}})*$'`)).toBe(1);
    expect(occurrences(`open_slots BETWEEN ${LFF_SLOTS_MIN} AND ${LFF_SLOTS_MAX}`)).toBe(1);
  });

  it('every text refuses the domain\'s set through ONE explicit class, never the locale-dependent POSIX cntrl class', () => {
    expect(occurrences(`!~ '[${REFUSED}]'`), 'title, description, label, message and the skills').toBe(5);
    expect(sql, 'no POSIX class anywhere').not.toContain('[:cntrl:]');
    // the class's own code points, read from the SQL text: C0 from U+0001, DEL, C1, U+2028 and U+2029 -- and nothing else
    const codePoints = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
    const inClass = new Set([...codePoints(0x01, 0x1f), ...codePoints(0x7f, 0x9f), 0x2028, 0x2029]);
    const spelled = [...REFUSED.matchAll(/\\u([0-9a-f]{4})(?:-\\u([0-9a-f]{4}))?/gu)]
      .flatMap((m) => codePoints(Number.parseInt(m[1], 16), Number.parseInt(m[2] ?? m[1], 16)));
    expect(new Set(spelled)).toEqual(inClass);
  });

  it('a request carries no version; a post keeps its own', () => {
    const requests = sql.slice(sql.indexOf('CREATE TABLE relay_wonderland.lff_join_requests('), sql.indexOf('CREATE UNIQUE INDEX'));
    expect(requests).not.toMatch(/\bversion\b/u);
    expect(occurrences('CONSTRAINT lff_posts_version CHECK(version >= 1)')).toBe(1);
  });

  it('the PROPOSED expiry sits inside the schema\'s 30-day SANITY bound, which is not policy', () => {
    expect(LFF_POST_TTL_MS).toBeGreaterThan(0);
    expect(LFF_POST_TTL_MS).toBeLessThanOrEqual(30 * DAY);
    expect(occurrences("expires_at > created_at AND expires_at - created_at <= interval '30 days'")).toBe(1);
    expect(occurrences(`${LFF_POST_TTL_MS}`), 'the TTL itself is not in the schema').toBe(0);
    expect(sql).not.toMatch(/interval '14 days'/u);
  });
});
