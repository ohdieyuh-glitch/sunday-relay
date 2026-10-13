import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { Pool, type PoolClient } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { juliusTestDatabaseUrl } from '../src/relay/persistence/julius-test-database';
import { protectedStoreWriterGuard } from '../src/relay/persistence/protected-store-writer-guard';
import { openWfsPostgresStore } from '../src/relay/persistence/wonderfs-postgres';
import { wfsThrowawayDatabases } from '../src/relay/persistence/wonderfs-test-databases';
import { TransactionalWonderlandDatabase } from '../src/relay/persistence/wonderland-postgres';
import type { RelayResult } from '../src/relay/protocol/errors';
import type { WfsCommitRequest, WfsPrincipal } from '../src/relay/wonderfs/wonderfs-contracts';
import { WFS_MAIN_BRANCH } from '../src/relay/wonderfs/wonderfs-engine';
import { createBrowserSessionStore } from './browser-session/grants';
import { createWonderfsMount } from './wonderfs-routes';

/**
 * R2-r5 K3 + K7 ON REAL POSTGRESQL (contract r1.6.2 e1, §21 K3 / K7; JULIUS_DEV C3, C10). What only a database can show:
 *   - LOCK BOUND: a write meeting a project row another transaction holds FOR UPDATE is cut off at lock_timeout (55P03) -- the
 *     retryable outage, nothing written (CONTROL: with a long bound it is still waiting, and lands once the lock goes);
 *   - STATEMENT BOUND: a write's, an upload's and a snapshot read's statement past statement_timeout (57014) -- the outage;
 *   - DIRECT READS (K7): the gate's membership lookup and readBlob, each bounded the same way (CONTROL: an unbounded one waits);
 *   - POOL SHARE: with WonderFS holding its share of a max-10 pool, a Julius-route query still gets a client (CONTROL: an uncapped
 *     burst takes every client and the Julius query waits);
 *   - THE GUARD IN THE BURST (K7 test 2): a NEW store, whose every first call runs the protected-store guard's identity read, with gate
 *     lookups and blob reads behind it, still holds at most 4 (CONTROL: the guard over the bare pool, R4's wiring, takes all 10). The
 *     guard's read is held at a JS gate on the client it checked out -- holding it in PostgreSQL would need a lock on the shared catalog
 *     pg_database (dev report open question 7) -- and runs for real once the gate opens;
 *   - THE ACTUAL MAX (K7): mounted on a shared pool of max 8, WonderFS takes no client from it (CONTROL: a store given it does);
 *   - NO LEAK (e1 l.582, JULIUS_DEV N16): WonderFS's bounds are transaction-local -- the next query of another family on the same client
 *     does not carry them (CONTROL: a session-level SET does leak).
 * The pool model with pg-pool itself over a fake client is relay-bridge/wonderfs-pool-share.test.ts, every run.
 * Runs wherever JULIUS_TEST_DATABASE_URL names a THROWAWAY server (never DATABASE_URL); `todo` elsewhere.
 */

const databaseUrl = juliusTestDatabaseUrl();
const suite = databaseUrl !== null ? describe : describe.todo;
const P = 'prj-bounds';
const NOW = () => new Date().toISOString();
const OUTAGE = { code: 'stale-ledger-version', retryable: true };
const outcome = (r: RelayResult<unknown>) => (r.ok ? 'ok' : { code: r.error.code, retryable: r.error.retryable });
const tick = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const TIMED_OUT = Symbol('still waiting');
const within = <T>(p: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> => Promise.race([p, tick(ms).then((): typeof TIMED_OUT => TIMED_OUT)]);
/** Poll `ok` every 20 ms for at most `ms` (a slow CI runner connects clients more slowly; no fixed sleep decides a case). */
const until = async (ok: () => boolean, ms: number): Promise<boolean> => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) return false;
    await tick(20);
  }
  return true;
};
/** `until`, for a condition read from the database. */
const untilAsync = async (ok: () => Promise<boolean>, ms: number): Promise<boolean> => {
  const end = Date.now() + ms;
  while (!(await ok())) {
    if (Date.now() > end) return false;
    await tick(50);
  }
  return true;
};
const owner: WfsPrincipal = { kind: 'human', id: 'ghu-1', onBehalfOf: null, grantId: null, sessionId: null, clientBuild: null, tool: null, missionId: null, attemptId: null };
let counter = 0;
const rid = (label: string): string => `req-${label}-${String((counter += 1)).padStart(5, '0')}`;

/** A pool whose clients RECORD the SQLSTATE of every statement that fails (so a case can tell 55P03 from 57014). */
function recording(pool: Pool, codes: string[]): Pool {
  const wrap = (client: PoolClient): PoolClient => new Proxy(client, {
    get(target, prop) {
      if (prop === 'query') {
        return async (text: unknown, params?: unknown) => {
          try {
            return await Reflect.apply(target.query, target, params === undefined ? [text] : [text, params]);
          } catch (error) {
            const code = (error as { code?: unknown }).code;
            codes.push(typeof code === 'string' ? code : 'none');
            throw error;
          }
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

/**
 * K7 test 2: a pool whose clients HOLD every statement `when` matches at ONE JS gate -- after the checkout, so the client stays taken, as a
 * slow statement would keep it -- until `open()`; from then on every statement runs on PostgreSQL as written. `held()` counts the holds.
 */
function gated(pool: Pool, when: (sql: string) => boolean): { readonly pool: Pool; held(): number; open(): void } {
  let opened = false;
  let openGate: () => void = () => undefined;
  const gate = new Promise<void>((r) => { openGate = r; });
  let held = 0;
  const wrap = (client: PoolClient): PoolClient => new Proxy(client, {
    get(target, prop) {
      if (prop === 'query') {
        return async (text: unknown, params?: unknown) => {
          if (!opened && typeof text === 'string' && when(text)) {
            held += 1;
            await gate;
          }
          return Reflect.apply(target.query, target, params === undefined ? [text] : [text, params]);
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return {
    pool: new Proxy(pool, {
      get(target, prop) {
        if (prop === 'connect') return async () => wrap(await target.connect());
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }),
    held: () => held,
    open: () => {
      opened = true;
      openGate();
    },
  };
}

suite('WonderFS bounded waits and its pool share on real PostgreSQL (R2-r5 K3, K7)', () => {
  const nonce = randomBytes(5).toString('hex');
  const name = `wfsbounds${nonce}`;
  const databases = wfsThrowawayDatabases();
  const servers: Server[] = [];
  let admin: Pool;
  let url = '';
  /** A pool on the suite's database, tracked from birth (ended before the database is dropped). */
  const open = (max: number): Pool => databases.track(name, new Pool({ connectionString: url, max }));
  let seedPool: Pool;

  beforeAll(async () => {
    admin = new Pool({ connectionString: databaseUrl! });
    await admin.query(`CREATE DATABASE ${name}`);
    const u = new URL(databaseUrl!);
    u.pathname = `/${name}`;
    url = u.toString();
    seedPool = open(4);
    await new TransactionalWonderlandDatabase(seedPool).migrate();
    await seedPool.query("INSERT INTO relay_wonderland.players(player_id) VALUES('ghu-1')");
    await seedPool.query('INSERT INTO relay_wonderland.projects(project_id) VALUES($1)', [P]);
    await seedPool.query("INSERT INTO relay_wonderland.project_members(project_id, player_id, role) VALUES($1, 'ghu-1', 'OWNER')", [P]);
    expect((await openWfsPostgresStore(seedPool).createProject(P, NOW())).ok).toBe(true);
  }, 60_000);
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => {
      s.closeAllConnections();
      s.close(() => r());
    })));
    expect(databases.takeCaseErrors(), 'no pool lost a client during the case').toEqual([]);
  });
  afterAll(async () => {
    try {
      if (admin !== undefined) await databases.teardown(admin);
    } finally {
      await admin?.end().catch(() => undefined);
    }
  }, 60_000);

  /** ONE other transaction holding what `statements` take, until `release()`. */
  const holding = async (pool: Pool, statements: readonly string[]) => {
    const client = await pool.connect();
    await client.query('BEGIN');
    for (const sql of statements) await client.query(sql, sql.includes('$1') ? [P] : undefined);
    return async () => {
      await client.query('ROLLBACK');
      client.release();
    };
  };
  const ROW_LOCK = 'SELECT 1 FROM relay_wonderland.wfs_projects WHERE project_id = $1 FOR UPDATE';
  const count = async (table: string) => Number((await seedPool.query<{ n: string }>(`SELECT count(*)::text AS n FROM relay_wonderland.${table} WHERE project_id = $1`, [P])).rows[0].n);
  const rows = async () => ({ commits: await count('wfs_commits'), requests: await count('wfs_requests'), events: await count('wfs_events'), blobs: await count('wfs_blobs') });
  const headRev = async (): Promise<number> => {
    const h = await openWfsPostgresStore(seedPool).head(P);
    if (!h.ok) throw new Error(h.error.message);
    return h.value.main.headRev;
  };
  const dirCommit = async (path: string): Promise<WfsCommitRequest> => ({ requestId: rid('k3'), branchId: WFS_MAIN_BRANCH, baseRev: await headRev(), principal: owner, ops: [{ op: 'create', path, kind: 'dir' }] });

  it('K3 LOCK BOUND: a commit meeting the project row held FOR UPDATE is cut off at lock_timeout (55P03) -- the retryable outage, NOTHING written; CONTROL: with a long bound it is still waiting, and lands once the lock is gone', async () => {
    const pool = open(10);
    const codes: string[] = [];
    const store = openWfsPostgresStore(recording(pool, codes), { bounds: { lockTimeoutMs: 300 } });
    const before = await rows();
    const release = await holding(pool, [ROW_LOCK]);
    try {
      const started = Date.now();
      expect(outcome(await store.commit(P, await dirCommit('locked-out'), NOW())), 'the outage').toEqual(OUTAGE);
      expect(Date.now() - started, 'answered at the bound, not after the lock').toBeLessThan(5_000);
      expect(codes, 'lock_not_available').toContain('55P03');
      expect(await rows(), 'nothing written').toEqual(before);
      // CONTROL: a long bound waits -- the bound is what answered above
      const patient = openWfsPostgresStore(pool, { bounds: { lockTimeoutMs: 60_000 } });
      const waiting = patient.commit(P, await dirCommit('waited'), NOW());
      expect(await within(waiting, 1_000), 'CONTROL: still waiting on the lock').toBe(TIMED_OUT);
      await release();
      const landed = await waiting;
      expect(landed.ok && landed.value.status, 'CONTROL: it lands once the lock is gone').toBe('committed');
    } finally {
      await release().catch(() => undefined);
    }
  }, 60_000);

  it('K3 STATEMENT BOUND: a commit\'s and an upload\'s statement past statement_timeout (57014, the lock bound set far above it) and a snapshot read\'s past its own are the retryable outage; nothing written; CONTROL: the same reads, unlocked, are served', async () => {
    const pool = open(10);
    const codes: string[] = [];
    const store = openWfsPostgresStore(recording(pool, codes), { bounds: { lockTimeoutMs: 60_000, statementTimeoutMs: 300, uploadStatementTimeoutMs: 300 } });
    const before = await rows();
    let release = await holding(pool, [ROW_LOCK]);
    try {
      expect(outcome(await store.commit(P, await dirCommit('too-slow'), NOW())), 'a commit').toEqual(OUTAGE);
      expect(outcome(await store.putBlob(P, new TextEncoder().encode(`slow ${nonce}`))), 'an upload').toEqual(OUTAGE);
      expect(codes.filter((c) => c === '57014'), 'query_canceled, twice').toHaveLength(2);
      expect(await rows(), 'nothing written').toEqual(before);
    } finally {
      await release();
    }
    // a snapshot read: wfs_branches held ACCESS EXCLUSIVE -- the read's statement waits, then is cut off
    release = await holding(pool, ['LOCK TABLE relay_wonderland.wfs_branches IN ACCESS EXCLUSIVE MODE']);
    try {
      expect(outcome(await store.tree(P, { branchId: WFS_MAIN_BRANCH })), 'a snapshot read').toEqual(OUTAGE);
      expect(codes.filter((c) => c === '57014'), 'query_canceled').toHaveLength(3);
    } finally {
      await release();
    }
    expect(outcome(await store.tree(P, { branchId: WFS_MAIN_BRANCH })), 'CONTROL: unlocked, served').toBe('ok');
  }, 60_000);

  it('K7 DIRECT READS: the gate\'s membership lookup and readBlob past their statement bound answer the outage, and the next request is served; CONTROL: an unbounded lookup (today\'s bare pool.query) is still waiting', async () => {
    const pool = open(10);
    const codes: string[] = [];
    const store = openWfsPostgresStore(recording(pool, codes), { bounds: { statementTimeoutMs: 300 } });
    expect(outcome(await store.memberRole(P, 'ghu-1')), 'warm (the guard cleared)').toBe('ok');
    let release = await holding(pool, ['LOCK TABLE relay_wonderland.project_members IN ACCESS EXCLUSIVE MODE']);
    try {
      expect(outcome(await store.memberRole(P, 'ghu-1')), 'the gate lookup').toEqual(OUTAGE);
      expect(codes).toContain('57014');
      // CONTROL: the same lookup with no bound (as bare pool.query had none) waits on the lock
      const unbounded = pool.query('SELECT role FROM relay_wonderland.project_members WHERE project_id = $1 AND player_id = $2', [P, 'ghu-1']);
      expect(await within(unbounded, 1_000), 'CONTROL: unbounded, still waiting').toBe(TIMED_OUT);
      await release();
      await unbounded;
    } finally {
      await release().catch(() => undefined);
    }
    expect(outcome(await store.memberRole(P, 'ghu-1')), 'the next request is served').toBe('ok');
    release = await holding(pool, ['LOCK TABLE relay_wonderland.wfs_blob_bytes IN ACCESS EXCLUSIVE MODE']);
    try {
      await expect(store.readBlob(P, 'c'.repeat(64)), 'readBlob past its bound fails (never hangs)').rejects.toMatchObject({ code: '57014' });
    } finally {
      await release();
    }
    expect(await store.readBlob(P, 'c'.repeat(64)), 'CONTROL: unlocked, answered').toBeNull();
  }, 60_000);

  it('K3 + K7 POOL SHARE: gate lookups, blob reads and commits all held up at once take at most 4 clients of a max-10 pool, and a Julius-route query still gets one at once; CONTROL: an uncapped burst takes all 10 and the Julius query waits', async () => {
    const pool = open(10);
    const store = openWfsPostgresStore(pool, { bounds: { acquireWaitMs: 20_000 } });
    expect(outcome(await store.memberRole(P, 'ghu-1')), 'warm').toBe('ok');
    const release = await holding(seedPool, [
      ROW_LOCK,
      'LOCK TABLE relay_wonderland.project_members IN ACCESS EXCLUSIVE MODE',
      'LOCK TABLE relay_wonderland.wfs_blob_bytes IN ACCESS EXCLUSIVE MODE',
    ]);
    const burst: Array<Promise<unknown>> = [];
    try {
      for (let i = 0; i < 6; i += 1) {
        burst.push(store.memberRole(P, 'ghu-1'));
        burst.push(store.readBlob(P, 'd'.repeat(64)).catch((e: unknown) => e));
      }
      burst.push(store.commit(P, await dirCommit('burst-a'), NOW()));
      expect(await until(() => pool.totalCount - pool.idleCount >= 4, 10_000), 'WonderFS takes its share').toBe(true);
      await tick(300);
      expect(pool.totalCount - pool.idleCount, 'WonderFS holds its share, no more').toBeLessThanOrEqual(4);
      const julius = await within(pool.query('SELECT 1 AS julius_route'), 1_500);
      expect(julius === TIMED_OUT ? 'starved' : 'served', 'a Julius-route query gets a client').toBe('served');
    } finally {
      await release();
    }
    await Promise.all(burst);

    // CONTROL: the same burst as bare pool.query (today's direct reads) takes every client ahead of the Julius query
    const releaseAgain = await holding(seedPool, ['LOCK TABLE relay_wonderland.project_members IN ACCESS EXCLUSIVE MODE']);
    const bare = Array.from({ length: 12 }, () => pool.query('SELECT role FROM relay_wonderland.project_members WHERE project_id = $1 AND player_id = $2', [P, 'ghu-1']));
    let starved: Promise<unknown> = Promise.resolve();
    try {
      expect(await until(() => pool.totalCount === 10 && pool.idleCount === 0, 10_000), 'CONTROL: uncapped, every client taken').toBe(true);
      starved = pool.query('SELECT 1 AS julius_route');
      expect(await within(starved, 1_500), 'CONTROL: the Julius query waits').toBe(TIMED_OUT);
    } finally {
      await releaseAgain();
    }
    await Promise.all([...bare, starved]);
  }, 90_000);

  it('K7 THE GUARD IN THE BURST (test 2): a NEW store -- every first call runs the protected-store guard\'s identity read -- with its guard reads held, then the gate lookups and blob reads behind them held, takes at most 4 clients of a max-10 pool, and a Julius-route query still gets one at once; then every call is served; CONTROL: the guard over the bare pool (R4\'s wiring) takes all 10 and the Julius query waits', async () => {
    const pool = open(10);
    const guardRead = (sql: string): boolean => sql.includes('shobj_description');
    const checkedOut = (): number => pool.totalCount - pool.idleCount;
    const julius = async (): Promise<string> => ((await within(pool.query('SELECT 1 AS julius_route'), 1_500)) === TIMED_OUT ? 'starved' : 'served');
    const lockWaiters = async (): Promise<number> => Number((await seedPool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM pg_stat_activity WHERE datname = $1 AND wait_event_type = 'Lock'", [name],
    )).rows[0].n);
    const g = gated(pool, guardRead);
    const store = openWfsPostgresStore(g.pool, { bounds: { acquireWaitMs: 20_000 } }); // NEW, never warmed: its guard has not cleared
    const release = await holding(seedPool, [
      'LOCK TABLE relay_wonderland.project_members IN ACCESS EXCLUSIVE MODE',
      'LOCK TABLE relay_wonderland.wfs_blob_bytes IN ACCESS EXCLUSIVE MODE',
    ]);
    const burst: Array<Promise<unknown>> = [];
    try {
      for (let i = 0; i < 6; i += 1) {
        burst.push(store.memberRole(P, 'ghu-1'));
        burst.push(store.readBlob(P, 'f'.repeat(64)));
      }
      // 1. the guard's identity reads: four hold the four clients; the other eight wait in the cap, never in the pool
      expect(await until(() => g.held() >= 4, 10_000), 'the guard\'s reads are in the burst').toBe(true);
      await tick(300);
      expect(g.held(), 'four guard reads reached a client, no more').toBe(4);
      expect(checkedOut(), 'WonderFS holds its share, no more').toBeLessThanOrEqual(4);
      expect(await julius(), 'a Julius-route query gets a client at once').toBe('served');
      // 2. the guard reads run on PostgreSQL; the gate lookups and blob reads behind them meet the held tables, inside the same four
      g.open();
      expect(await untilAsync(async () => (await lockWaiters()) >= 4, 10_000), 'gate lookups and blob reads now hold the four, waiting on the tables').toBe(true);
      await tick(300);
      expect(await lockWaiters(), 'no more than four wait').toBe(4);
      expect(checkedOut(), 'WonderFS still holds its share, no more').toBeLessThanOrEqual(4);
      expect(await julius(), 'and a Julius-route query still gets a client at once').toBe('served');
    } finally {
      g.open();
      await release();
    }
    const settled = await Promise.all(burst);
    expect(settled.map((r) => (r === null ? 'no such blob' : outcome(r as RelayResult<unknown>))), 'every call is served once the tables are free')
      .toEqual(Array.from({ length: 12 }, (_, i) => (i % 2 === 0 ? 'ok' : 'no such blob')));

    // CONTROL: the guard over the BARE pool (R4:PG:475's wiring: pool.query = check out, run, give back, no cap), twelve first calls at
    // once -- every client taken, and the Julius query waits
    const bare = gated(pool, guardRead);
    const bareQuery = {
      query: (async (text: string, values?: unknown[]) => {
        const client = await bare.pool.connect();
        try {
          return await client.query(text, values);
        } finally {
          client.release();
        }
      }) as Pool['query'],
    };
    const guards = Array.from({ length: 12 }, () => protectedStoreWriterGuard(bareQuery, 'control')());
    let starved: Promise<unknown> = Promise.resolve();
    try {
      expect(await until(() => pool.totalCount === 10 && pool.idleCount === 0, 10_000), 'CONTROL: uncapped, every client taken').toBe(true);
      starved = pool.query('SELECT 1 AS julius_route');
      expect(await within(starved, 1_500), 'CONTROL: the Julius query waits').toBe(TIMED_OUT);
    } finally {
      bare.open();
    }
    await Promise.all([...guards, starved]);
  }, 90_000);

  it('K7 THE ACTUAL MAX: mounted on a shared pool whose max is 8, WonderFS takes NO client from it -- it runs on its own pool (max <= 4); CONTROL: a store given the max-8 pool draws from it', async () => {
    const shared = open(8);
    const own: Pool[] = [];
    const sessions = createBrowserSessionStore();
    const minted = sessions.mintNativeSocialSession({ now: Date.now(), participantId: 'ghu-1' });
    if (!minted.ok) throw new Error('not minted');
    const mount = createWonderfsMount({ sessions, pool: () => shared, openDedicatedPool: () => { const p = open(4); own.push(p); return p; } });
    const server = createServer((req, res) => { void mount.serve(req, res, {}); });
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const address = server.address();
    const base = `http://127.0.0.1:${typeof address === 'object' && address !== null ? address.port : 0}`;
    const answer = await fetch(`${base}/wonderfs/v1/projects/${P}/events`, { headers: { authorization: `Relay-Session ${minted.session.token}` } });
    expect(answer.status, 'served').toBe(200);
    expect(shared.totalCount, 'not one client of the max-8 shared pool').toBe(0);
    expect([own.length, own[0]?.options.max, (own[0]?.totalCount ?? 0) > 0], 'its own pool, max 4, served it').toEqual([1, 4, true]);
    // CONTROL
    expect(outcome(await openWfsPostgresStore(shared).memberRole(P, 'ghu-1'))).toBe('ok');
    expect(shared.totalCount, 'CONTROL: a store opened on the max-8 pool takes its clients').toBeGreaterThan(0);
  }, 60_000);

  it('NO LEAK (e1, JULIUS_DEV N16): after WonderFS\'s bounded read on a client, the next query of another family on THAT client does not carry WonderFS\'s statement_timeout; CONTROL: a session-level SET does leak', async () => {
    const pool = open(1); // one client: every query below meets the same one
    const show = async () => (await pool.query<{ statement_timeout: string }>('SHOW statement_timeout')).rows[0].statement_timeout;
    const baseline = await show();
    const store = openWfsPostgresStore(pool, { bounds: { statementTimeoutMs: 4_321 } });
    expect(outcome(await store.memberRole(P, 'ghu-1'))).toBe('ok');
    expect(await store.readBlob(P, 'e'.repeat(64))).toBeNull();
    expect(outcome(await store.tree(P, { branchId: WFS_MAIN_BRANCH }))).toBe('ok');
    expect(await show(), 'the next query on the same client: the server\'s own value').toBe(baseline);
    // CONTROL: a session-level SET on that client is inherited by whoever takes it next
    const c = await pool.connect();
    await c.query('SET statement_timeout = 4321');
    c.release();
    expect(await show(), 'CONTROL: a session SET leaks').toBe('4321ms');
    await pool.query('RESET statement_timeout');
  }, 60_000);
});
