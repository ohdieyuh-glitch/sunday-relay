import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { Pool, type PoolClient } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { juliusTestDatabaseUrl } from '../src/relay/persistence/julius-test-database';
import { openWfsPostgresStore } from '../src/relay/persistence/wonderfs-postgres';
import { TransactionalWonderlandDatabase } from '../src/relay/persistence/wonderland-postgres';
import { WFS_ALPHA_LIMITS, type WfsLimits, type WfsOp } from '../src/relay/wonderfs/wonderfs-contracts';
import { WFS_MAIN_BRANCH, type WfsBranchState } from '../src/relay/wonderfs/wonderfs-engine';
import { WFS_CONFLICT_RETENTION_MS, WFS_PROJECT_FULL_MESSAGE, type WfsStore } from '../src/relay/wonderfs/wonderfs-store';
import { createBrowserSessionStore, type BrowserSessionStore } from './browser-session/grants';
import { wonderfsNotFound, wonderfsSessionVerifier } from './wonderfs-gate';
import { answerWonderfs, createWonderfsMount, wonderfsRequestOf, writeWonderfsAnswer, type WonderfsRouteDeps } from './wonderfs-routes';
import { wonderfsCompactUtc, wonderfsKeepBoth, wonderfsKeepMine, wonderfsKeepTheirs } from './wonderfs-write-routes';

/**
 * WONDERFS R2 WRITE ROUTES ON REAL POSTGRESQL (migration 036; CI's real-PostgreSQL catch-all runs every `*real-postgres*` file). The
 * routes of wonderfs-write-routes.test.ts over ROWS, where what only a database can show is shown:
 *   - the bridge's own MOUNT (createWonderfsMount: the body is the IncomingMessage, the write budgets derived once per process);
 *   - the role read INSIDE the write's transaction, FOR SHARE: a demotion committed while the write waits on that row writes nothing
 *     (CONTROL: the same demotion rolled back lets it land);
 *   - T-CRASH rows 1, 3 and 4 killed at the store seam, statement by statement (a pool whose client fails one statement): inside the
 *     upload, inside the commit (nothing on any row), after COMMIT before the answer (the retry after a NEW sign-in answers the
 *     ORIGINAL revision; one commit row) -- and row 2, an orphan, invisible;
 *   - T-PERSIST across a new pool, store and sign-in; T-CONFLICT's rows (wfs_conflicts status, wfs_conflict_blobs, retention);
 *   - §10.1's 422 and §19.m3's pending bytes counted from rows (T-ORPHAN's counting half, N-MAJOR-1), and bytes repaired.
 * Runs wherever JULIUS_TEST_DATABASE_URL names a THROWAWAY server (never DATABASE_URL); `todo` elsewhere.
 *
 * ONE CLOCK (R2-r2: CI r1.13's time bomb). The bridge's mount stamps each request with the WALL clock (createWonderfsMount:
 * `Date.now()`), so every session here is minted on that clock -- T0 is the wall time this file loaded -- and nothing below expects a
 * wall-clock-pinned value: the keep-both name is computed from T0 like everything else.
 */

const databaseUrl = juliusTestDatabaseUrl();
const suite = databaseUrl !== null ? describe : describe.todo;
const T0 = Date.now();
const NOW = new Date(T0).toISOString();
const P = 'prj-alpha';
const NOT_FOUND = { error: { kind: 'not_found', message: 'Not found.' } };
/** What a conflict made through `bootDeps` (stamped T0 + 1) is named for keep-both. */
const AT_UTC = wonderfsCompactUtc(new Date(T0 + 1).toISOString()) as string;
const SMALL: WfsLimits = { ...WFS_ALPHA_LIMITS, maxFileBytes: 64, maxProjectBytes: 100 };
const realFetch = globalThis.fetch.bind(globalThis);
const sha = (text: string | Uint8Array): string => createHash('sha256').update(typeof text === 'string' ? Buffer.from(text, 'utf8') : text).digest('hex');
let counter = 0;
const rid = (label: string): string => `req-${label}-${String((counter += 1)).padStart(5, '0')}`;

/** A pool whose clients fail ONE statement, once, when armed: before it runs, or after it ran (its effect kept, its answer lost). */
interface Fault {
  armed: boolean;
  readonly when: (sql: string) => boolean;
  readonly phase: 'before' | 'after';
}

function faulty(pool: Pool, fault: Fault): Pool {
  const wrap = (client: PoolClient): PoolClient => new Proxy(client, {
    get(target, prop) {
      if (prop === 'query') {
        return async (text: unknown, params?: unknown) => {
          const sql = typeof text === 'string' ? text : String((text as { text?: unknown }).text ?? '');
          if (fault.armed && fault.when(sql)) {
            fault.armed = false;
            if (fault.phase === 'before') throw new Error('wonderfs test: killed before the statement');
            await Reflect.apply(target.query, target, [text, params]);
            throw new Error('wonderfs test: killed after the statement');
          }
          return Reflect.apply(target.query, target, [text, params]);
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return new Proxy(pool, {
    get(target, prop) {
      if (prop === 'connect') return async () => wrap(await target.connect());
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

suite('WonderFS R2 write routes on real PostgreSQL', () => {
  const nonce = randomBytes(5).toString('hex');
  let admin: Pool;
  const made: Array<{ name: string; pool: Pool }> = [];
  const servers: Server[] = [];

  const fresh = async (label: string): Promise<Pool> => {
    const name = `wfswrite${label}${nonce}`;
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(databaseUrl!);
    url.pathname = `/${name}`;
    const pool = new Pool({ connectionString: url.toString(), max: 6 });
    made.push({ name, pool });
    await new TransactionalWonderlandDatabase(pool).migrate();
    return pool;
  };
  /** Another pool on the SAME database (a restarted bridge). */
  const reopen = (pool: Pool): Pool => {
    const name = made.find((m) => m.pool === pool)?.name as string;
    const url = new URL(databaseUrl!);
    url.pathname = `/${name}`;
    const again = new Pool({ connectionString: url.toString(), max: 6 });
    made.push({ name, pool: again });
    return again;
  };

  beforeAll(async () => { admin = new Pool({ connectionString: databaseUrl! }); }, 30_000);
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => {
      s.closeAllConnections();
      s.close(() => r());
    })));
  });
  afterAll(async () => {
    for (const { name, pool } of made) {
      pool.on('error', () => undefined);
      await pool.end().catch(() => undefined);
      await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [name]).catch(() => undefined);
      await admin.query(`DROP DATABASE IF EXISTS ${name}`).catch(() => undefined);
    }
    await admin?.end().catch(() => undefined);
  }, 60_000);

  /** The product's rows, as the product writes them (OWNER / ADMIN / MEMBER; a lower-case legacy row), and the file environments. */
  const seeded = async (pool: Pool): Promise<void> => {
    for (const p of ['ghu-1', 'ghu-2', 'ghu-3', 'ghu-5', 'ghu-9']) await pool.query('INSERT INTO relay_wonderland.players(player_id) VALUES($1)', [p]);
    for (const p of [P, 'prj-beta']) await pool.query('INSERT INTO relay_wonderland.projects(project_id) VALUES($1)', [p]);
    for (const [project, player, role] of [[P, 'ghu-1', 'OWNER'], [P, 'ghu-2', 'ADMIN'], [P, 'ghu-3', 'MEMBER'], [P, 'ghu-9', 'owner'], ['prj-beta', 'ghu-5', 'OWNER']]) {
      await pool.query('INSERT INTO relay_wonderland.project_members(project_id, player_id, role) VALUES($1,$2,$3)', [project, player, role]);
    }
    const store = openWfsPostgresStore(pool);
    for (const p of [P, 'prj-beta']) expect((await store.createProject(p, NOW)).ok).toBe(true);
  };

  /** A sign-in for each player; calling it again is a NEW sign-in (new tokens, new session_refs). */
  const signIn = (players: readonly string[]) => {
    const sessions = createBrowserSessionStore();
    const tokens: Record<string, string> = {};
    for (const p of players) {
      const m = sessions.mintNativeSocialSession({ now: T0, participantId: p });
      if (!m.ok) throw new Error('not minted');
      tokens[p] = m.session.token;
    }
    const refOf = (player: string): string => {
      const v = sessions.verifyNativeSocialSession({ token: tokens[player], now: T0 + 1 });
      if (!v.ok) throw new Error('no session');
      return sessions.nativeSocialSessionRef({ sessionId: v.sessionId, now: T0 + 1 }) as string;
    };
    return { sessions, tokens, refOf };
  };

  const listen = async (handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<string> => {
    const server = createServer(handler);
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const address = server.address();
    return `http://127.0.0.1:${typeof address === 'object' && address !== null ? address.port : 0}`;
  };
  /** THE BRIDGE'S MOUNT, as server.ts builds it (its own store on the pool, its own budgets). */
  const bootMount = (sessions: BrowserSessionStore, pool: Pool) => {
    const mount = createWonderfsMount({ sessions, pool: () => pool });
    return listen((req, res) => { void mount.serve(req, res, {}); });
  };
  /** The routes over a given store (limits, a planted defect). */
  const bootDeps = (deps: WonderfsRouteDeps) => listen((req, res) => {
    void (async () => {
      const answer = await answerWonderfs(wonderfsRequestOf(req, T0 + 1), deps);
      writeWonderfsAnswer(res, answer ?? wonderfsNotFound());
    })();
  });
  const depsOf = (store: WfsStore, sessions: BrowserSessionStore, extra: Partial<WonderfsRouteDeps> = {}): WonderfsRouteDeps =>
    ({ verifySession: wonderfsSessionVerifier(sessions), store, budgets: null, writeBudgets: null, ...extra });

  const send = async (base: string, path: string, init: { method?: string; token?: string; headers?: Record<string, string>; body?: Uint8Array | string } = {}) => {
    const headers: Record<string, string> = { ...(init.headers ?? {}) };
    if (init.token !== undefined) headers.authorization = `Relay-Session ${init.token}`;
    // a copy on its own ArrayBuffer: fetch's BodyInit takes no view of a shared or pooled buffer
    const body = init.body === undefined || typeof init.body === 'string' ? init.body : new Uint8Array(init.body);
    const response = await realFetch(`${base}${path}`, { method: init.method ?? 'GET', headers, body });
    const bytes = Buffer.from(await response.arrayBuffer());
    const out: Record<string, string> = {};
    response.headers.forEach((value, key) => { out[key] = value; });
    const json: any = (out['content-type'] ?? '').startsWith('application/json') ? JSON.parse(bytes.toString('utf8')) : null;
    return { status: response.status, headers: out, bytes, json };
  };
  const comparable = (a: { status: number; headers: Record<string, string>; bytes: Buffer }) => ({ status: a.status, body: a.bytes.toString('base64'), headers: Object.fromEntries(Object.entries(a.headers).filter(([k]) => k !== 'date')) });
  const BLOBS = (project = P) => `/wonderfs/v1/projects/${project}/blobs`;
  const upload = (base: string, token: string, text: string, extra: { project?: string; sha?: string } = {}) =>
    send(base, BLOBS(extra.project), { method: 'POST', token, headers: { 'content-type': 'application/octet-stream', ...(extra.sha === undefined ? {} : { 'x-wonderfs-sha256': extra.sha }) }, body: Buffer.from(text, 'utf8') });
  const commit = (base: string, token: string, body: unknown, project = P) =>
    send(base, `/wonderfs/v1/projects/${project}/branches/main/commits`, { method: 'POST', token, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const uploaded = async (base: string, token: string, text: string) => {
    const a = await upload(base, token, text);
    expect(a.status, JSON.stringify(a.json)).toBe(200);
    return { sha256: a.json.data.sha256 as string, size: a.json.data.size as number };
  };
  const committed = async (base: string, token: string, baseRev: number, ops: WfsOp[]) => {
    const a = await commit(base, token, { requestId: rid('ok'), baseRev, ops });
    expect(a.status, JSON.stringify(a.json)).toBe(200);
    return a.json.data.rev as number;
  };
  const count = async (pool: Pool, table: string, where = 'TRUE', params: unknown[] = []) =>
    Number((await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM relay_wonderland.${table} WHERE project_id = '${P}' AND ${where}`, params)).rows[0].n);
  const mainOf = async (store: WfsStore): Promise<WfsBranchState> => (await store.project(P))?.branches.get(WFS_MAIN_BRANCH) as WfsBranchState;
  const fileId = async (store: WfsStore, path: string) => [...(await mainOf(store)).entries.values()].find((e) => e.path === path && !e.deleted)?.fileId as string;

  it('THE MOUNT ON ROWS: OWNER, ADMIN and MEMBER write; a stranger, a legacy row and an unknown project get ONE identical 404 and no row is written; T-PERSIST: files and bytes identical by sha256 after a new pool, store and sign-in (CONTROL: another database has none)', async () => {
    const pool = await fresh('mount');
    await seeded(pool);
    const s = signIn(['ghu-1', 'ghu-2', 'ghu-3', 'ghu-5', 'ghu-9']);
    const base = await bootMount(s.sessions, pool);
    for (const [i, player] of ['ghu-1', 'ghu-2', 'ghu-3'].entries()) {
      const blob = await uploaded(base, s.tokens[player], `by ${player}`);
      expect(blob).toEqual({ sha256: sha(`by ${player}`), size: 8 });
      expect(await committed(base, s.tokens[player], i, [{ op: 'create', path: `f-${player}.txt`, kind: 'file', ...blob }])).toBe(i + 1);
    }
    const rows = [await count(pool, 'wfs_blobs'), await count(pool, 'wfs_commits')];
    const stranger = await commit(base, s.tokens['ghu-5'], { requestId: rid('who'), baseRev: 3, ops: [{ op: 'create', path: 'z', kind: 'dir' }] });
    expect(stranger.json).toEqual(NOT_FOUND);
    expect(comparable(await commit(base, s.tokens['ghu-9'], { requestId: rid('who'), baseRev: 3, ops: [{ op: 'create', path: 'z', kind: 'dir' }] }))).toEqual(comparable(stranger));
    expect(comparable(await commit(base, s.tokens['ghu-1'], { requestId: rid('who'), baseRev: 3, ops: [{ op: 'create', path: 'z', kind: 'dir' }] }, 'prj-nowhere'))).toEqual(comparable(stranger));
    const strangerUp = await upload(base, s.tokens['ghu-5'], 'x');
    expect(comparable(await upload(base, s.tokens['ghu-9'], 'x'))).toEqual(comparable(strangerUp));
    expect([await count(pool, 'wfs_blobs'), await count(pool, 'wfs_commits')], 'no row written').toEqual(rows);
    // T-PERSIST: a restarted bridge -- another pool, another store, a new sign-in
    const tree = (await send(base, `/wonderfs/v1/projects/${P}/branches/main/tree`, { token: s.tokens['ghu-1'] })).json.data.entries;
    const again = reopen(pool);
    const s2 = signIn(['ghu-1']);
    const base2 = await bootMount(s2.sessions, again);
    const tree2 = await send(base2, `/wonderfs/v1/projects/${P}/branches/main/tree`, { token: s2.tokens['ghu-1'] });
    expect([tree2.status, tree2.json.data.entries]).toEqual([200, tree]);
    for (const e of tree as Array<{ fileId: string; sha256: string }>) {
      const bytes = await send(base2, `/wonderfs/v1/projects/${P}/branches/main/files/${e.fileId}/content`, { token: s2.tokens['ghu-1'] });
      expect(sha(bytes.bytes)).toBe(e.sha256);
    }
    // CONTROL: a database that never saw these writes
    const other = await fresh('mountother');
    await seeded(other);
    const empty = await send(await bootMount(s2.sessions, other), `/wonderfs/v1/projects/${P}/branches/main/tree`, { token: s2.tokens['ghu-1'] });
    expect([empty.status, empty.json.data.entries]).toEqual([200, []]);
  }, 180_000);

  it('THE ROLE INSIDE THE TRANSACTION, FOR SHARE: a demotion committed while the write waits on the membership row writes nothing (commit and upload: the one 404); CONTROL: the same demotion rolled back lets the write land', async () => {
    const pool = await fresh('locked');
    await seeded(pool);
    const s = signIn(['ghu-3']);
    const base = await bootDeps(depsOf(openWfsPostgresStore(pool), s.sessions));
    const waiting = async () => Number((await admin.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM pg_stat_activity WHERE datname = $1 AND wait_event_type = 'Lock'",
      [made.find((m) => m.pool === pool)?.name],
    )).rows[0].n);
    const demoteWhileWaiting = async (write: () => Promise<{ status: number; json: any }>, keep: boolean) => {
      const demoter = await pool.connect();
      try {
        await demoter.query('BEGIN');
        await demoter.query("UPDATE relay_wonderland.project_members SET role = 'VIEWER' WHERE project_id = $1 AND player_id = 'ghu-3'", [P]);
        const pending = write(); // the gate reads the COMMITTED role (MEMBER); the write's FOR SHARE read then waits on this row
        await vi.waitFor(async () => expect(await waiting()).toBeGreaterThan(0), { timeout: 10_000, interval: 10 });
        await demoter.query(keep ? 'COMMIT' : 'ROLLBACK');
        return await pending;
      } finally {
        demoter.release();
      }
    };
    const body = { requestId: rid('locked'), baseRev: 0, ops: [{ op: 'create', path: 'late', kind: 'dir' }] };
    const refused = await demoteWhileWaiting(() => commit(base, s.tokens['ghu-3'], body), true);
    expect([refused.status, refused.json]).toEqual([404, NOT_FOUND]);
    expect([await count(pool, 'wfs_commits'), await count(pool, 'wfs_requests')], 'nothing written').toEqual([0, 0]);
    await pool.query("UPDATE relay_wonderland.project_members SET role = 'MEMBER' WHERE project_id = $1 AND player_id = 'ghu-3'", [P]);
    const up = await demoteWhileWaiting(() => upload(base, s.tokens['ghu-3'], 'late bytes'), true);
    expect([up.status, up.json, await count(pool, 'wfs_blobs')]).toEqual([404, NOT_FOUND, 0]);
    // CONTROL: the demotion rolled back -- the write that waited lands
    await pool.query("UPDATE relay_wonderland.project_members SET role = 'MEMBER' WHERE project_id = $1 AND player_id = 'ghu-3'", [P]);
    const landed = await demoteWhileWaiting(() => commit(base, s.tokens['ghu-3'], body), false);
    expect([landed.status, landed.json.data?.rev]).toEqual([200, 1]);
    // a removal committed before the write reads it (between the gate and the store): the one 404, nothing written
    const removing = openWfsPostgresStore(pool);
    const removedMidway: WfsStore = new Proxy(removing, {
      get: (target, prop) => (prop === 'commit'
        ? async (...args: Parameters<WfsStore['commit']>) => {
          await pool.query("DELETE FROM relay_wonderland.project_members WHERE project_id = $1 AND player_id = 'ghu-3'", [P]);
          return target.commit(...args);
        }
        : Reflect.get(target, prop)),
    });
    const removed = await commit(await bootDeps(depsOf(removedMidway, s.sessions)), s.tokens['ghu-3'], { requestId: rid('locked'), baseRev: 1, ops: [{ op: 'create', path: 'later', kind: 'dir' }] });
    expect([removed.status, removed.json, await count(pool, 'wfs_commits')]).toEqual([404, NOT_FOUND, 1]);
  }, 180_000);

  it('T-CRASH on rows, killed at three chosen statements (an upload\'s bytes INSERT, a commit\'s event INSERT, a commit\'s COMMIT; not a sweep): inside the upload (no blob row), after the blob (an orphan nobody can read), inside the commit (no row anywhere), after COMMIT before the answer (the retry after a NEW sign-in is the ORIGINAL revision; one commit row)', async () => {
    const pool = await fresh('crash');
    await seeded(pool);
    const fault: Fault = { armed: false, when: () => false, phase: 'before' };
    const arm = (when: (sql: string) => boolean, phase: 'before' | 'after') => Object.assign(fault, { armed: true, when, phase });
    const s1 = signIn(['ghu-3']);
    const base1 = await bootMount(s1.sessions, faulty(pool, fault));
    // ROW 1: inside the upload's transaction, at the bytes
    arm((sql) => sql.startsWith('INSERT INTO relay_wonderland.wfs_blob_bytes'), 'before');
    const dead = await upload(base1, s1.tokens['ghu-3'], 'journaled bytes');
    expect(fault.armed, 'row 1: the planted fault fired').toBe(false);
    expect([dead.status, dead.json.error.kind, await count(pool, 'wfs_blobs')]).toEqual([503, 'wonderfs_unavailable', 0]);
    // ROW 2: after the blob, before the commit -- an orphan, invisible by address
    const blob = await uploaded(base1, s1.tokens['ghu-3'], 'journaled bytes');
    expect((await send(base1, `${BLOBS()}/${blob.sha256}`, { token: s1.tokens['ghu-3'] })).status).toBe(404);
    // ROW 3: inside the commit's transaction, at its event
    const body = { requestId: rid('crash'), baseRev: 0, ops: [{ op: 'create', path: 'kept.txt', kind: 'file', ...blob }] };
    arm((sql) => sql.startsWith('INSERT INTO relay_wonderland.wfs_events'), 'before');
    const inside = await commit(base1, s1.tokens['ghu-3'], body);
    expect(fault.armed, 'row 3: the planted fault fired').toBe(false);
    expect([inside.status, inside.json.error.kind]).toEqual([503, 'wonderfs_unavailable']);
    expect([await count(pool, 'wfs_commits'), await count(pool, 'wfs_requests'), await count(pool, 'wfs_versions'), await count(pool, 'wfs_events')], 'rolled back whole').toEqual([0, 0, 0, 0]);
    // ROW 4: after COMMIT, before the answer
    arm((sql) => sql === 'COMMIT', 'after');
    const lost = await commit(base1, s1.tokens['ghu-3'], body);
    expect(fault.armed, 'row 4: the planted fault fired').toBe(false);
    expect([lost.status, lost.json.error.kind, await count(pool, 'wfs_commits')]).toEqual([503, 'wonderfs_unavailable', 1]);
    const row = (await pool.query<{ commit_id: string; commit_hash: string; record: { principal: { sessionId: string } } }>('SELECT commit_id, commit_hash, record FROM relay_wonderland.wfs_commits WHERE project_id = $1', [P])).rows[0];
    expect(row.record.principal.sessionId).toBe(s1.refOf('ghu-3'));
    // the journal replays after a NEW sign-in on a restarted bridge (a pool without the fault)
    const s2 = signIn(['ghu-3']);
    expect(s2.refOf('ghu-3')).not.toBe(s1.refOf('ghu-3'));
    const base2 = await bootMount(s2.sessions, reopen(pool));
    const retried = await commit(base2, s2.tokens['ghu-3'], body);
    expect([retried.status, retried.json.data]).toEqual([200, { schema: 'wonderfs.commit_result.v1', branchId: 'main', rev: 1, commitId: row.commit_id, commitHash: row.commit_hash, replay: true }]);
    expect([await count(pool, 'wfs_commits'), await count(pool, 'wfs_events')], 'applied once').toEqual([1, 1]);
    expect((await send(base2, `${BLOBS()}/${blob.sha256}`, { token: s2.tokens['ghu-3'] })).status, 'named now').toBe(200);
    // CONTROL: the replay path is real -- the same id with another change is refused
    const changed = await commit(base2, s2.tokens['ghu-3'], { ...body, ops: [{ op: 'create', path: 'other.txt', kind: 'file', ...blob }] });
    expect([changed.status, changed.json.error.kind]).toEqual([409, 'duplicate_idempotency_key']);
  }, 180_000);

  it('B1 ON ROWS (R2-r2): over H12, a commit that frees a path and takes it again -- delete + create of one path, a rename chain -- answers 200 in the file-id order that met the live-path index; CONTROL: the other order lands too', async () => {
    const pool = await fresh('livepath');
    await seeded(pool);
    const s = signIn(['ghu-1']);
    /** A project of its own, and a store whose next file ids are `ids`, in order: the case forces which file sorts first. */
    const project = async (projectId: string, ids: readonly string[]) => {
      await pool.query('INSERT INTO relay_wonderland.projects(project_id) VALUES($1)', [projectId]);
      await pool.query("INSERT INTO relay_wonderland.project_members(project_id, player_id, role) VALUES($1, 'ghu-1', 'OWNER')", [projectId]);
      let next = 0;
      const store = openWfsPostgresStore(pool, { newId: (kind) => (kind === 'file' && next < ids.length ? ids[next++] : `${kind}_${randomBytes(8).toString('hex')}`) });
      expect((await store.createProject(projectId, NOW)).ok).toBe(true);
      return bootDeps(depsOf(store, s.sessions));
    };
    const treeOf = async (base: string, projectId: string) =>
      ((await send(base, `/wonderfs/v1/projects/${projectId}/branches/main/tree`, { token: s.tokens['ghu-1'] })).json.data.entries as Array<{ path: string; fileId: string }>).map((e) => [e.path, e.fileId]);
    const blobIn = async (base: string, projectId: string, text: string) => {
      const a = await upload(base, s.tokens['ghu-1'], text, { project: projectId });
      expect(a.status).toBe(200);
      return { sha256: a.json.data.sha256 as string, size: a.json.data.size as number };
    };
    for (const [oldId, newId] of [['file-zz', 'file-aa'], ['file-aa', 'file-zz']] as const) {
      const projectId = `prj-replace-${oldId}`;
      const base = await project(projectId, [oldId, newId]);
      const before = await blobIn(base, projectId, 'old words');
      const after = await blobIn(base, projectId, 'new words');
      expect((await commit(base, s.tokens['ghu-1'], { requestId: rid('lp'), baseRev: 0, ops: [{ op: 'create', path: 'notes.txt', kind: 'file', ...before }] }, projectId)).status).toBe(200);
      const replaced = await commit(base, s.tokens['ghu-1'], { requestId: rid('lp'), baseRev: 1, ops: [{ op: 'delete', fileId: oldId, expectContentVersion: 1 }, { op: 'create', path: 'notes.txt', kind: 'file', ...after }] }, projectId);
      expect([replaced.status, replaced.json.data?.rev], `delete + create of one path (old ${oldId}, new ${newId})`).toEqual([200, 2]);
      expect(await treeOf(base, projectId)).toEqual([['notes.txt', newId]]);
    }
    for (const [xId, yId] of [['file-aa', 'file-zz'], ['file-zz', 'file-aa']] as const) {
      const projectId = `prj-chain-${xId}`;
      const base = await project(projectId, [xId, yId]);
      expect((await commit(base, s.tokens['ghu-1'], { requestId: rid('lp'), baseRev: 0, ops: [{ op: 'create', path: 'p', kind: 'dir' }, { op: 'create', path: 'q', kind: 'dir' }] }, projectId)).status).toBe(200);
      const chain = await commit(base, s.tokens['ghu-1'], { requestId: rid('lp'), baseRev: 1, ops: [{ op: 'move', fileId: yId, expectPathVersion: 1, newPath: 'r' }, { op: 'move', fileId: xId, expectPathVersion: 1, newPath: 'q' }] }, projectId);
      expect([chain.status, chain.json.data?.rev], `a rename chain (x ${xId}, y ${yId})`).toEqual([200, 2]);
      expect(await treeOf(base, projectId)).toEqual([['q', xId], ['r', yId]]);
    }
  }, 180_000);

  it('T-CONFLICT on rows: one of two lands, the other is kept whole (wfs_conflicts open, its bytes in wfs_conflict_blobs); keep theirs is DISMISSED and retained 30 days, keep mine and keep both RESOLVED', async () => {
    const pool = await fresh('conflict');
    await seeded(pool);
    const s = signIn(['ghu-1', 'ghu-2', 'ghu-3']);
    const store = openWfsPostgresStore(pool);
    const base = await bootDeps(depsOf(store, s.sessions));
    const first = await uploaded(base, s.tokens['ghu-1'], 'first words');
    await committed(base, s.tokens['ghu-1'], 0, [{ op: 'create', path: 'docs', kind: 'dir' }, { op: 'create', path: 'docs/readme.txt', kind: 'file', ...first }]);
    const readme = await fileId(store, 'docs/readme.txt');
    const mine = { 'ghu-2': await uploaded(base, s.tokens['ghu-2'], 'from the ADMIN'), 'ghu-3': await uploaded(base, s.tokens['ghu-3'], 'from the MEMBER') };
    const answers = await Promise.all((['ghu-2', 'ghu-3'] as const).map((p) => commit(base, s.tokens[p], { requestId: rid('race'), baseRev: 1, ops: [{ op: 'update', fileId: readme, expectContentVersion: 1, ...mine[p] }] })));
    expect(answers.map((a) => a.status).sort()).toEqual([200, 409]);
    const lost = answers.findIndex((a) => a.status === 409);
    const loser = (['ghu-2', 'ghu-3'] as const)[lost];
    const conflictId = answers[lost].json.error.conflictId as string;
    const row = (await pool.query<{ status: string; request_id: string }>('SELECT status, request_id FROM relay_wonderland.wfs_conflicts WHERE project_id = $1 AND conflict_id = $2', [P, conflictId])).rows[0];
    expect(row.status).toBe('open');
    expect(await count(pool, 'wfs_conflict_blobs', 'conflict_id = $1 AND sha256 = $2', [conflictId, mine[loser].sha256]), 'its exact bytes are held').toBe(1);
    // keep theirs
    const now = async () => {
      const main = await mainOf(store);
      return { entries: main.entries, headRev: main.headRev };
    };
    expect((await commit(base, s.tokens[loser], wonderfsKeepTheirs(conflictId, rid('res'), (await now()).headRev))).status).toBe(200);
    const closed = (await pool.query<{ status: string; closed_at: Date; retain_until: Date }>('SELECT status, closed_at, retain_until FROM relay_wonderland.wfs_conflicts WHERE project_id = $1 AND conflict_id = $2', [P, conflictId])).rows[0];
    expect([closed.status, closed.retain_until.getTime() - closed.closed_at.getTime()]).toEqual(['dismissed', WFS_CONFLICT_RETENTION_MS]);
    expect(await count(pool, 'wfs_conflict_blobs', 'conflict_id = $1', [conflictId]), 'retained: its blobs stay named (N-MAJOR-1)').toBe(1);
    // keep mine, then keep both, each on a fresh conflict
    for (const how of ['mine', 'both'] as const) {
      const cur = (await mainOf(store)).entries.get(readme);
      const theirs = await uploaded(base, s.tokens['ghu-2'], `theirs ${how}`);
      await committed(base, s.tokens['ghu-2'], (await now()).headRev, [{ op: 'update', fileId: readme, expectContentVersion: cur?.contentVersion as number, ...theirs }]);
      const late = await uploaded(base, s.tokens['ghu-3'], `late ${how}`);
      const refused = await commit(base, s.tokens['ghu-3'], { requestId: rid('res'), baseRev: 1, ops: [{ op: 'update', fileId: readme, expectContentVersion: cur?.contentVersion as number, ...late }] });
      expect(refused.status).toBe(409);
      const view = await store.conflict(P, refused.json.error.conflictId);
      if (!view.ok) throw new Error('no conflict record');
      const resolution = how === 'mine' ? wonderfsKeepMine(view.value.record, await now(), rid('res')) : wonderfsKeepBoth(view.value.record, await now(), rid('res'));
      expect((await commit(base, s.tokens['ghu-3'], resolution)).status, how).toBe(200);
      const status = (await pool.query<{ status: string }>('SELECT status FROM relay_wonderland.wfs_conflicts WHERE project_id = $1 AND conflict_id = $2', [P, refused.json.error.conflictId])).rows[0].status;
      expect(status, how).toBe('resolved');
    }
    const kept = await count(pool, 'wfs_entries', "branch_id = 'main' AND path = $1 AND NOT deleted", [`docs/readme (conflict, ghu-3, ${AT_UTC}).txt`]);
    expect(kept, 'keep both made its file').toBe(1);
  }, 180_000);

  it('§10.1 and §19.m3 on rows: a mismatching claimed address is 422 and NO row is kept; pending bytes are counted from rows (to the limit, then 413 project_full; a held blob grows nothing; a conflict-held upload stays pending while staying readable); missing bytes are repaired by the same upload', async () => {
    const pool = await fresh('orphan');
    await seeded(pool);
    const s = signIn(['ghu-1']);
    const store = openWfsPostgresStore(pool, { limits: SMALL });
    const base = await bootDeps(depsOf(store, s.sessions, { limits: SMALL }));
    const lie = await upload(base, s.tokens['ghu-1'], 'other bytes', { sha: sha('not these') });
    expect([lie.status, lie.json.error.kind, await count(pool, 'wfs_blobs'), await count(pool, 'wfs_blob_bytes')]).toEqual([422, 'hash_mismatch', 0, 0]);
    const direct = await store.putBlob(P, Buffer.from('direct'), { claimedSha256: sha('elsewhere') });
    expect(direct.ok ? 'kept' : direct.error.details).toEqual(['wonderfs: hash_mismatch']);
    expect(await count(pool, 'wfs_blobs'), 'the store kept nothing either').toBe(0);
    expect((await upload(base, s.tokens['ghu-1'], 'right bytes', { sha: sha('right bytes') })).status, 'CONTROL').toBe(200);
    await pool.query('DELETE FROM relay_wonderland.wfs_blob_bytes WHERE project_id = $1', [P]);
    await pool.query('DELETE FROM relay_wonderland.wfs_blobs WHERE project_id = $1', [P]);
    // pending, from rows
    const a60 = await uploaded(base, s.tokens['ghu-1'], 'a'.repeat(60));
    await uploaded(base, s.tokens['ghu-1'], 'b'.repeat(40));
    const full = await upload(base, s.tokens['ghu-1'], 'c');
    expect([full.status, full.json.error, await count(pool, 'wfs_blobs')]).toEqual([413, { kind: 'project_full', message: WFS_PROJECT_FULL_MESSAGE }, 2]);
    expect((await upload(base, s.tokens['ghu-1'], 'a'.repeat(60))).status, 'held: grows nothing').toBe(200);
    await committed(base, s.tokens['ghu-1'], 0, [{ op: 'create', path: 'a.txt', kind: 'file', ...a60 }]);
    expect((await upload(base, s.tokens['ghu-1'], 'c')).status, 'live 60 + pending 40').toBe(413);
    const aFile = await fileId(store, 'a.txt');
    await committed(base, s.tokens['ghu-1'], 1, [{ op: 'delete', fileId: aFile, expectContentVersion: 1 }]);
    await uploaded(base, s.tokens['ghu-1'], 'c'); // the deleted file's bytes are history (wfs_versions), not pending
    const d59 = await uploaded(base, s.tokens['ghu-1'], 'd'.repeat(59));
    expect((await upload(base, s.tokens['ghu-1'], 'e')).status, 'CONTROL: d is pending').toBe(413);
    const refused = await commit(base, s.tokens['ghu-1'], { requestId: rid('orphan'), baseRev: 2, ops: [{ op: 'update', fileId: aFile, expectContentVersion: 1, ...d59 }] });
    expect(refused.status).toBe(409);
    expect((await upload(base, s.tokens['ghu-1'], 'e'.repeat(59))).status, 'a conflict-held upload is still PENDING (R2-r2, security MAJOR-3): full').toBe(413);
    expect((await commit(base, s.tokens['ghu-1'], wonderfsKeepTheirs(refused.json.error.conflictId, rid('orphan'), 2))).status).toBe(200);
    expect((await send(base, `${BLOBS()}/${d59.sha256}`, { token: s.tokens['ghu-1'] })).status, 'dismissed, retained, still named').toBe(200);
    expect((await upload(base, s.tokens['ghu-1'], 'e')).status, 'and still pending').toBe(413);
    // repair: a held blob whose bytes went missing is restored by uploading the same bytes
    await pool.query('DELETE FROM relay_wonderland.wfs_blob_bytes WHERE project_id = $1 AND sha256 = $2', [P, d59.sha256]);
    expect((await send(base, `${BLOBS()}/${d59.sha256}`, { token: s.tokens['ghu-1'] })).status, 'never served without its bytes').toBe(503);
    expect((await upload(base, s.tokens['ghu-1'], 'd'.repeat(59))).status).toBe(200);
    const repaired = await send(base, `${BLOBS()}/${d59.sha256}`, { token: s.tokens['ghu-1'] });
    expect([repaired.status, sha(repaired.bytes)]).toEqual([200, d59.sha256]);
  }, 180_000);
});
