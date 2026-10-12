import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PRIVATE_SERVER_POLICY, type PrivateServerRecord } from '../social/private-server-lifecycle';
import { PRIVATE_SERVER_UNAVAILABLE_MESSAGE } from '../social/private-server-registry';
import type { WorldView } from '../social/world-presence';
import { juliusTestDatabaseUrl } from './julius-test-database';
import { readPrivateServerRecords, writePrivateServerRecord } from './private-server-postgres';
import { openSocialPostgresStore } from './social-postgres';
import { migrationVersion, TransactionalWonderlandDatabase, WONDERLAND_MIGRATIONS, WONDERLAND_MIGRATION_036, WONDERLAND_MIGRATION_037 } from './wonderland-postgres';

/**
 * MIGRATION 037: WONDERLAND PRIVATE SERVERS (the founder's private-server rules, 2026-10-11), APPLIED EXPLICITLY AFTER 036. PROVISIONAL
 * NUMBER (036 WonderFS / 037 this / 038 Project Brain file-memory, agreed with MAIN JUJU). 037 creates 4 relations in relay_wonderland --
 * private_server_entitlements, private_servers and their primary keys -- and 2 foreign keys (both to players, ON DELETE CASCADE), writes
 * NO row and changes no existing row. Each case is its OWN database:
 *   A      at 036, 037 applies with ONE precheck NOTICE; every catalog line it adds is a private_server* object or an internal RI trigger
 *          its keys put on players; none is removed; no existing row changes; both tables are empty; the stamp is the last;
 *   G      the guard refuses, changing and stamping nothing: before 036, a second time, after a later stamp, a private_server* relation;
 *   C      every constraint holds against real rows, each refusal with a control that is accepted: no TEAM or FREE tier row, a period in
 *          order, the Free window and cooldown inside the 24 h SANITY BOUNDS at both ends (the 6-8 h / 4-5 h durations are PROPOSED, not
 *          approved, and not encoded: a 9 h window is accepted, a 25 h one refused), a Free row's times all-or-none and in order, a
 *          continuous row with no window, no control character in a name, the owner a real player;
 *   H      the committed DOWN refuses while a later migration is applied and while EITHER table holds a row; then it restores the
 *          catalog EXACTLY, removes the stamp, and 037 applies again. 036's DOWN refuses while 037 is stamped;
 *   CAS    two connections racing the same first insert, and the same update: exactly one wins, the other changes nothing;
 *   STORE  through the real social store: a Free open writes server times; a RESTART (a second store on the same database) keeps the
 *          cooldown; a cycle changes NO other row (WonderFS, social, players: checksummed); the tier table missing = 503, nothing opened;
 *   ROLE   a NOSUPERUSER database owner (the O1 bootstrap's D4 role) applies the whole chain, 037 included.
 * Runs wherever JULIUS_TEST_DATABASE_URL names a THROWAWAY server (never DATABASE_URL); `todo` elsewhere.
 */

const databaseUrl = juliusTestDatabaseUrl();
const suite = databaseUrl !== null ? describe : describe.todo;
const DOCS = join(__dirname, '..', '..', '..', 'docs', 'julius-migrations');
const committed = (migration: string, name: string): string => readFileSync(join(DOCS, migration, name), 'utf8')
  .replace(/^\\set ON_ERROR_STOP on\s*$/mu, ''); // a psql meta-command; the driver runs plain SQL
const DOWN = committed('037', 'down.sql');
const DOWN_036 = committed('036', 'down.sql');
const INDEX_037 = WONDERLAND_MIGRATIONS.indexOf(WONDERLAND_MIGRATION_037);
const BEFORE_037 = WONDERLAND_MIGRATIONS.slice(0, INDEX_037);
const BEFORE_036 = WONDERLAND_MIGRATIONS.slice(0, INDEX_037 - 1);
const STAMP_036 = '036_wonderfs';
const STAMP_037 = '037_wonderland_private_servers';
const PLAYERS = ['usr_037_a', 'usr_037_b'];
const TABLES = ['private_server_entitlements', 'private_servers'];
const RELATIONS = [...TABLES, ...TABLES.map((t) => `${t}_pkey`)];
const MIN = 60_000;
const HOUR = 60 * MIN;
const T0 = Date.parse('2026-10-12T08:00:00.000Z');
const ts = (ms: number) => new Date(ms).toISOString();

type Refusal = { code: string | undefined; message: string; constraint?: string };
const refusalOf = (error: unknown): Refusal => ({
  code: (error as { code?: string }).code, message: (error as Error).message, constraint: (error as { constraint?: string }).constraint,
});

suite('migration 037: Wonderland private servers, applied explicitly after 036', () => {
  const nonce = randomBytes(5).toString('hex');
  let admin: Pool;
  const made: Array<{ name: string; pool: Pool }> = [];
  const roles: string[] = [];

  const create = async (label: string, owner?: { role: string; password: string }): Promise<Pool> => {
    const name = `wonderland037${label}${nonce}`;
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
  const at036 = (label: string): Promise<Pool> => migrated(label, BEFORE_037);
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
  const at037 = async (label: string): Promise<Pool> => {
    const pool = await at036(label);
    expect((await run(pool, WONDERLAND_MIGRATION_037)).refusal, `${label}: 037 applies`).toBeNull();
    return pool;
  };
  const count = async (pool: Pool, sql: string, values: unknown[] = []): Promise<number> => Number((await pool.query(sql, values)).rows[0].n);
  const stamped = (pool: Pool, version = STAMP_037) => count(pool, 'SELECT count(*) AS n FROM relay_wonderland.schema_migrations WHERE version = $1', [version]);
  const ledgerLast = async (pool: Pool): Promise<string> => (await pool.query('SELECT max(version COLLATE "C") AS v FROM relay_wonderland.schema_migrations')).rows[0].v as string;
  const present = async (pool: Pool): Promise<string[]> => (await pool.query(
    "SELECT c.relname AS r FROM pg_class c WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND c.relname LIKE 'private\\_server%'",
  )).rows.map((row: { r: string }) => row.r).sort();
  /** relay_wonderland's catalog by definition, sorted (the 033 / 035 / 036 suites' reading, without functions' bodies). */
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
  /** Every relay_wonderland table's rows, as a checksum per table (EXCEPT the ones a world operation is meant to move). */
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

  it('A: at 036, 037 applies with one precheck NOTICE: it only ADDS private_server* objects (and the RI triggers its keys put on players), no row moves, both tables empty, the stamp last', async () => {
    const pool = await at036('clean');
    const before = await catalog(pool);
    const rowsBefore = await checksums(pool, []);
    const { refusal, notices } = await run(pool, WONDERLAND_MIGRATION_037);
    expect(refusal).toBeNull();
    expect(notices.filter((n) => n.startsWith('migration_037_precheck'))).toHaveLength(1);
    const after = await catalog(pool);
    expect(before.filter((line) => !after.includes(line)), 'nothing removed').toEqual([]);
    const added = after.filter((line) => !before.includes(line));
    for (const line of added) expect(line, 'every added line is 037\'s').toMatch(/private_server/u);
    expect(added.filter((line) => line.startsWith('internal trigger players ')), 'the RI triggers on players: 2 per key').toHaveLength(4);
    expect(await present(pool)).toEqual([...RELATIONS].sort());
    const counts = (await pool.query(`
      SELECT count(*) FILTER (WHERE contype = 'c') AS checks, count(*) FILTER (WHERE contype = 'p') AS pks, count(*) FILTER (WHERE contype = 'f') AS fks
        FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
       WHERE c.relnamespace = 'relay_wonderland'::regnamespace AND c.relname LIKE 'private\\_server%'`)).rows[0];
    expect({ checks: Number(counts.checks), pks: Number(counts.pks), fks: Number(counts.fks) }).toEqual({ checks: 12, pks: 2, fks: 2 });
    const rowsAfter = await checksums(pool, TABLES);
    expect({ ...rowsAfter, schema_migrations: '-' }).toEqual({ ...Object.fromEntries(Object.entries(rowsBefore)), schema_migrations: '-' });
    for (const t of TABLES) expect(await count(pool, `SELECT count(*) AS n FROM relay_wonderland.${t}`), `${t} empty`).toBe(0);
    expect(await ledgerLast(pool)).toBe(STAMP_037);
  }, 180_000);

  it('G: the guard refuses before 036, a second time, after a later stamp, and with a private_server* relation present -- creating and stamping nothing', async () => {
    const early = await migrated('early', BEFORE_036);
    const twice = await at037('twice');
    const later = await at036('later');
    await later.query('INSERT INTO relay_wonderland.schema_migrations(version) VALUES($1)', ['038_later_lane_probe']);
    const squatted = await at036('squat');
    await squatted.query('CREATE TABLE relay_wonderland.private_server_notes(x int)');
    for (const [label, pool, message] of [
      ['before 036', early, 'migration_037_refused: 036 is not applied here'],
      ['a second time', twice, 'migration_037_refused: 037 is already applied here'],
      ['a later stamp', later, "migration_037_refused: the ledger's last stamp is 038_later_lane_probe, not 036"],
      ['a relation present', squatted, 'migration_037_refused: relation(s) named private_server* already exist in relay_wonderland (private_server_notes)'],
    ] as const) {
      const before = await catalog(pool);
      const { refusal } = await run(pool, WONDERLAND_MIGRATION_037);
      expect(refusal?.message, label).toContain(message);
      expect(await catalog(pool), `${label}: nothing changed`).toEqual(before);
    }
    expect(await stamped(early)).toBe(0);
  }, 180_000);

  it('C: every constraint holds against real rows, each refusal beside a control that is accepted', async () => {
    const pool = await at037('constraints');
    const [A, B] = PLAYERS;
    const tier = 'INSERT INTO relay_wonderland.private_server_entitlements(player_id, tier, valid_from, valid_until, source) VALUES($1,$2,$3,$4,$5)';
    await refused(pool, 'a TEAM tier', tier, [A, 'TEAM', ts(T0), null, 'operator'], '23514');
    await refused(pool, 'a FREE row', tier, [A, 'FREE', ts(T0), null, 'operator'], '23514');
    await refused(pool, 'a period out of order', tier, [A, 'PRO', ts(T0), ts(T0), 'operator'], '23514', 'private_server_entitlements_period');
    await refused(pool, 'an unknown source', tier, [A, 'PRO', ts(T0), null, 'client'], '23514');
    await refused(pool, 'not a player', tier, ['usr_nobody', 'PRO', ts(T0), null, 'operator'], '23503', 'private_server_entitlements_player_fk');
    await pool.query(tier, [A, 'MAX', ts(T0), null, 'operator']); // CONTROL
    await pool.query(tier, [B, 'PRO', ts(T0), ts(T0 + HOUR), 'billing']); // CONTROL

    const row = 'INSERT INTO relay_wonderland.private_servers(owner_id, server_name, status, cycle_tier, policy_id, activated_at, active_until, cooldown_until, version, created_at, updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)';
    const free = (w: number, c: number, over: Partial<Record<'name' | 'status' | 'tier' | 'activated' | 'until' | 'cool' | 'version' | 'updated', unknown>> = {}) => [
      A, over.name ?? 'Lab', over.status ?? 'ACTIVE', over.tier ?? 'FREE', 'free-480m-cool-240m-proposed',
      over.activated !== undefined ? over.activated : ts(T0), over.until !== undefined ? over.until : ts(T0 + w), over.cool !== undefined ? over.cool : ts(T0 + w + c),
      over.version ?? 1, ts(T0), over.updated ?? ts(T0),
    ];
    const cycle = 'private_servers_free_cycle';
    // The Free durations are PROPOSED (not approved), so the CHECK holds only NEUTRAL SANITY BOUNDS: a window of 1 minute to 24 h,
    // a cooldown of 1 minute to 24 h, the times in order.
    await refused(pool, 'a zero window', row, free(0, 4 * HOUR), '23514', cycle);
    await refused(pool, 'a window that ends before it opens', row, free(-HOUR, 4 * HOUR), '23514', cycle);
    await refused(pool, 'a window over 24 h (24 h + 1 min)', row, free(24 * HOUR + MIN, 4 * HOUR), '23514', cycle);
    await refused(pool, 'a 25 h window', row, free(25 * HOUR, 4 * HOUR), '23514', cycle);
    await refused(pool, 'a cooldown over 24 h (24 h + 1 min)', row, free(8 * HOUR, 24 * HOUR + MIN), '23514', cycle);
    await refused(pool, 'no cooldown at all (0): a Free server always cools down', row, free(8 * HOUR, 0), '23514', cycle);
    await refused(pool, 'a window under 1 minute (59 s)', row, free(59_000, 4 * HOUR), '23514', cycle);
    await refused(pool, 'a cooldown before the window ends', row, free(8 * HOUR, 4 * HOUR, { cool: ts(T0 + HOUR) }), '23514', cycle);
    await refused(pool, 'a Free row with only some times', row, free(8 * HOUR, 4 * HOUR, { cool: null }), '23514', cycle);
    await refused(pool, 'a Free row called CONTINUOUS', row, free(8 * HOUR, 4 * HOUR, { status: 'CONTINUOUS' }), '23514', cycle);
    await refused(pool, 'a never-opened Free row that says ACTIVE', row, free(0, 0, { activated: null, until: null, cool: null }), '23514', cycle);
    await refused(pool, 'a PRO row with a window', row, free(8 * HOUR, 4 * HOUR, { tier: 'PRO', status: 'CONTINUOUS' }), '23514', 'private_servers_continuous_cycle');
    await refused(pool, 'a PRO row that is not CONTINUOUS', row, free(0, 0, { tier: 'PRO', until: null, cool: null }), '23514', 'private_servers_continuous_cycle');
    await refused(pool, 'a TEAM cycle', row, free(0, 0, { tier: 'TEAM', status: 'CONTINUOUS', until: null, cool: null }), '23514');
    await refused(pool, 'a control character in the name', row, free(8 * HOUR, 4 * HOUR, { name: 'Lab\nX' }), '23514');
    await refused(pool, 'a name over 60', row, free(8 * HOUR, 4 * HOUR, { name: 'x'.repeat(61) }), '23514');
    await refused(pool, 'version 0', row, free(8 * HOUR, 4 * HOUR, { version: 0 }), '23514');
    await refused(pool, 'activated after its own update', row, free(8 * HOUR, 4 * HOUR, { activated: ts(T0 + MIN) }), '23514');
    await refused(pool, 'not a player', row, ['usr_nobody', ...free(8 * HOUR, 4 * HOUR).slice(1)], '23503', 'private_servers_owner_fk');
    // CONTROLS: both ends of both sanity bounds are accepted; so are the PROPOSED 6-8 h / 4-5 h figures and a 9 h or 10 h window
    // outside them (the proposal is not law in the database); and a continuous row
    for (const [w, c] of [[MIN, MIN], [24 * HOUR, 24 * HOUR], [6 * HOUR, 4 * HOUR], [8 * HOUR, 5 * HOUR], [9 * HOUR, 4 * HOUR], [10 * HOUR, 4 * HOUR]]) {
      await pool.query(row, free(w, c));
      await pool.query('DELETE FROM relay_wonderland.private_servers WHERE owner_id = $1', [A]);
    }
    await pool.query(row, free(0, 0, { tier: 'MAX', status: 'CONTINUOUS', until: null, cool: null }));
    await pool.query(row, [B, 'Never opened', 'READY', 'FREE', PRIVATE_SERVER_POLICY.policyId, null, null, null, 1, ts(T0), ts(T0)]);
  }, 180_000);

  it('H: DOWN refuses while a later migration is applied and while either table holds a row; empty, it restores the catalog exactly, and 037 applies again; 036\'s DOWN refuses while 037 is stamped', async () => {
    const pool = await at036('down');
    const before037 = await catalog(pool);
    expect((await run(pool, WONDERLAND_MIGRATION_037)).refusal).toBeNull();
    expect((await run(pool, DOWN_036)).refusal?.message).toContain('migration_036_down_refused: a later migration is applied (037_wonderland_private_servers)');
    await pool.query("INSERT INTO relay_wonderland.schema_migrations(version) VALUES('038_later_lane_probe')");
    expect((await run(pool, DOWN)).refusal?.message).toContain('migration_037_down_refused: a later migration is applied (038_later_lane_probe)');
    await pool.query("DELETE FROM relay_wonderland.schema_migrations WHERE version = '038_later_lane_probe'");
    await pool.query("INSERT INTO relay_wonderland.private_server_entitlements(player_id, tier, valid_from, source) VALUES($1,'PRO',now(),'operator')", [PLAYERS[0]]);
    expect((await run(pool, DOWN)).refusal?.message).toContain('migration_037_down_refused: private-server data exists (private_server_entitlements 1)');
    await pool.query('DELETE FROM relay_wonderland.private_server_entitlements');
    await pool.query("INSERT INTO relay_wonderland.private_servers(owner_id, server_name, status, cycle_tier, policy_id, version, created_at, updated_at) VALUES($1,'Lab','READY','FREE','p',1,now(),now())", [PLAYERS[0]]);
    expect((await run(pool, DOWN)).refusal?.message).toContain('migration_037_down_refused: private-server data exists (private_servers 1)');
    await pool.query('DELETE FROM relay_wonderland.private_servers');
    expect((await run(pool, DOWN)).refusal).toBeNull();
    expect(await catalog(pool), 'the catalog exactly as before 037').toEqual(before037);
    expect(await stamped(pool)).toBe(0);
    expect((await run(pool, WONDERLAND_MIGRATION_037)).refusal, '037 applies again').toBeNull();
  }, 180_000);

  it('CAS: two connections racing the same first insert, and the same update -- exactly one wins each time, the other writes nothing', async () => {
    const pool = await at037('cas');
    const owner = PLAYERS[0];
    const v1: PrivateServerRecord = {
      ownerId: owner, serverName: 'Lab', status: 'ACTIVE', cycleTier: 'FREE', policyId: PRIVATE_SERVER_POLICY.policyId,
      activatedAtMs: T0, activeUntilMs: T0 + PRIVATE_SERVER_POLICY.freeActiveWindowMs, cooldownUntilMs: T0 + PRIVATE_SERVER_POLICY.freeActiveWindowMs + PRIVATE_SERVER_POLICY.freeCooldownMs,
      version: 1, createdAtMs: T0, updatedAtMs: T0,
    };
    const race = async (a: PrivateServerRecord, b: PrivateServerRecord): Promise<[boolean, boolean]> => {
      const c1 = await pool.connect();
      const c2 = await pool.connect();
      try {
        await c1.query('BEGIN');
        await c2.query('BEGIN');
        const first = await writePrivateServerRecord(c1, a);
        const second = writePrivateServerRecord(c2, b); // blocks on c1's row until c1 commits
        await new Promise((r) => setTimeout(r, 200));
        await c1.query('COMMIT');
        const won = await second;
        await c2.query('COMMIT');
        return [first, won];
      } finally {
        c1.release();
        c2.release();
      }
    };
    expect(await race(v1, { ...v1, serverName: 'Other' })).toEqual([true, false]);
    expect((await readPrivateServerRecords(pool, owner)).record).toMatchObject({ serverName: 'Lab', version: 1 });
    const v2 = { ...v1, serverName: 'Lab 2', version: 2, updatedAtMs: T0 + MIN };
    expect(await race(v2, { ...v2, serverName: 'Lab 3' })).toEqual([true, false]);
    expect((await readPrivateServerRecords(pool, owner)).record).toMatchObject({ serverName: 'Lab 2', version: 2 });
    // and a stale writer (version 2 again, on top of 2) is refused outright
    expect(await writePrivateServerRecord(pool, { ...v2, serverName: 'Stale' })).toBe(false);
  }, 180_000);

  it('STORE: a Free open writes server times; a restart keeps the cooldown; a whole cycle changes no other row; a missing table is a 503 and opens nothing', async () => {
    const pool = await create('store');
    await new TransactionalWonderlandDatabase(pool).migrate();
    await seed(pool);
    // a WonderFS project and other people's data, to prove the cycle leaves them alone
    await pool.query("INSERT INTO relay_wonderland.projects(project_id) VALUES('prj_037')");
    await pool.query("INSERT INTO relay_wonderland.wfs_projects(project_id, genesis_hash) VALUES('prj_037', repeat('a', 64))");
    const [kai, nova] = PLAYERS;
    const at = (ms: number) => ts(T0 + ms);
    const join = (store: Awaited<ReturnType<typeof openSocialPostgresStore>>, actor: string, ms: number) =>
      store.apply('world.join', actor, { ids: [], body: { target: 'PRIVATE', name: 'Lab' }, query: {} }, at(ms));
    const store = await openSocialPostgresStore(pool);
    await store.ensureUser({ userId: kai, displayName: 'Kai', handle: '@kai037' }, at(0));
    await store.ensureUser({ userId: nova, displayName: 'Nova', handle: '@nova037' }, at(0));
    await store.apply('requests.send', kai, { ids: [], body: { toUserId: nova }, query: {} }, at(0));
    const W = PRIVATE_SERVER_POLICY.freeActiveWindowMs;
    const C = PRIVATE_SERVER_POLICY.freeCooldownMs;
    const untouched = ['private_servers', 'social_presence', 'social_events', 'social_meta', 'social_recent_players', 'schema_migrations'];
    const before = await checksums(pool, untouched);

    const opened = await join(store, kai, 0);
    expect(opened.ok).toBe(true);
    expect((opened as { ok: true; value: WorldView }).value.context?.lifecycle).toMatchObject({ status: 'ACTIVE', tier: 'FREE', closesAtIso: at(W) });
    expect((await readPrivateServerRecords(pool, kai)).record).toMatchObject({ cycleTier: 'FREE', status: 'ACTIVE', activatedAtMs: T0, activeUntilMs: T0 + W, cooldownUntilMs: T0 + W + C, version: 1 });

    // the window ends; a report closes it; the RESTARTED bridge (a second store on the same database) still refuses the open
    const closed = await store.apply('world.state', kai, { ids: [], body: { x: 1, y: 2, z: 3, yaw: 0, speed: 0, motion: 'IDLE', skinId: 'relay_og' }, query: {} }, at(W));
    expect((closed as { ok: true; value: WorldView }).value.context).toBeNull();
    const restarted = await openSocialPostgresStore(pool);
    const refusedOpen = await join(restarted, kai, W + HOUR);
    expect(refusedOpen.ok === false && refusedOpen.error.code).toBe('illegal-transition');
    // after the cooldown, a NEW window from that moment
    expect((await join(restarted, kai, W + C)).ok).toBe(true);
    expect((await readPrivateServerRecords(pool, kai)).record).toMatchObject({ activatedAtMs: T0 + W + C, activeUntilMs: T0 + W + C + W });
    expect(await checksums(pool, untouched), 'no other row changed: WonderFS, profiles, requests, players').toEqual(before);

    // A LAPSE, WRITTEN DOWN AGAINST 037's CHECKs (review M1 / m6): Nova's PRO (an operator's row) lapses; the first read after it writes
    // the Free cycle from the lapse; deleting the expired row then moves nothing; a rename is written too
    const lapse = 3 * HOUR;
    await pool.query("INSERT INTO relay_wonderland.private_server_entitlements(player_id, tier, valid_from, valid_until, source) VALUES($1,'PRO',$2,$3,'operator')", [nova, at(-HOUR), at(lapse)]);
    expect((await join(restarted, nova, 0)).ok).toBe(true);
    expect((await readPrivateServerRecords(pool, nova)).record).toMatchObject({ cycleTier: 'PRO', status: 'CONTINUOUS', activeUntilMs: null });
    expect((await join(restarted, nova, lapse + W + HOUR)).ok, 'resting after the lapse window').toBe(false);
    expect((await readPrivateServerRecords(pool, nova)).record).toMatchObject({ cycleTier: 'FREE', status: 'COOLDOWN', activatedAtMs: T0 + lapse, activeUntilMs: T0 + lapse + W, cooldownUntilMs: T0 + lapse + W + C });
    await pool.query('DELETE FROM relay_wonderland.private_server_entitlements WHERE player_id = $1', [nova]);
    expect((await join(await openSocialPostgresStore(pool), nova, lapse + W + 2 * HOUR)).ok, 'still resting: the deletion moved nothing').toBe(false);
    const renamed = await restarted.apply('world.join', nova, { ids: [], body: { target: 'PRIVATE', name: 'Den 2' }, query: {} }, at(lapse + W + C));
    expect(renamed.ok).toBe(true);
    expect((await readPrivateServerRecords(pool, nova)).record).toMatchObject({ serverName: 'Den 2', cycleTier: 'FREE', status: 'ACTIVE', activatedAtMs: T0 + lapse + W + C });

    // FAIL CLOSED: the tier table unreadable -> the open is a retryable outage and nothing opens
    const cleo = 'usr_037_c';
    await pool.query('INSERT INTO relay_wonderland.players(player_id) VALUES($1)', [cleo]);
    const third = await openSocialPostgresStore(pool);
    await third.ensureUser({ userId: cleo, displayName: 'Cleo', handle: '@cleo037' }, at(0));
    await pool.query('ALTER TABLE relay_wonderland.private_server_entitlements RENAME TO private_server_entitlements_gone');
    try {
      const outage = await join(third, cleo, W + C + MIN);
      expect(outage.ok === false && outage.error).toMatchObject({ code: 'stale-ledger-version', retryable: true, message: PRIVATE_SERVER_UNAVAILABLE_MESSAGE });
      expect((await pool.query('SELECT count(*) AS n FROM relay_wonderland.private_servers WHERE owner_id = $1', [cleo])).rows[0].n).toBe('0');
    } finally {
      await pool.query('ALTER TABLE relay_wonderland.private_server_entitlements_gone RENAME TO private_server_entitlements');
    }
  }, 180_000);

  it('ROLE: a NOSUPERUSER database owner (the O1 bootstrap D4 role) applies the whole chain, 037 included', async () => {
    const role = `ps037owner${nonce}`;
    const password = randomBytes(18).toString('hex');
    await admin.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${password}'`);
    roles.push(role);
    const pool = await create('role', { role, password });
    await new TransactionalWonderlandDatabase(pool).migrate();
    expect(await stamped(pool, STAMP_036)).toBe(1);
    expect(await ledgerLast(pool)).toBe(migrationVersion(WONDERLAND_MIGRATIONS[WONDERLAND_MIGRATIONS.length - 1]));
    expect(await present(pool)).toEqual([...RELATIONS].sort());
  }, 180_000);
});

void WONDERLAND_MIGRATION_036;
