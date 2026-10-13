import { EventEmitter } from 'node:events';
import { createServer, type Server } from 'node:http';
import { Pool } from 'pg';
import { afterEach, describe, expect, it } from 'vitest';

import { openWfsPostgresStore } from '../src/relay/persistence/wonderfs-postgres';
import { protectedStoreWriterGuard } from '../src/relay/persistence/protected-store-writer-guard';
import type { RelayResult } from '../src/relay/protocol/errors';
import type { WfsPrincipal } from '../src/relay/wonderfs/wonderfs-contracts';
import { WFS_MAIN_BRANCH } from '../src/relay/wonderfs/wonderfs-engine';
import { createBrowserSessionStore } from './browser-session/grants';
import { createWonderfsMount } from './wonderfs-routes';

/**
 * R2-r5 K3 + K7 (contract r1.6.2 e1, §21; JULIUS_DEV C3, C10): WONDERFS NEVER HOLDS MORE THAN ITS SHARE OF THE BRIDGE'S POOL, AND NOTHING
 * IT DOES WAITS WITHOUT A BOUND. These run against the REAL pg-pool (the bridge's juliusPool is `new Pool(...)`, max 10 by pg-pool's
 * default) with a fake database client under it, so the pool's own checkout, queueing and `max` are what is measured; the statements'
 * effects on PostgreSQL itself (a lock wait cut off at lock_timeout, a statement at statement_timeout) are proven on rows in
 * relay-bridge/wonderfs-bounds.real-postgres.test.ts (CI), which also runs the guard's read in the burst on a real database.
 *
 * The CONTROLS put today's shape -- a bare `pool.query` per gate lookup, per guard read, uncapped -- on the same pool, and show it
 * taking every client ahead of a Julius-route query.
 */

const NOW = '2026-10-13T21:00:00.000Z';
const P = 'prj-1';
const ROLE_SQL = 'SELECT role FROM relay_wonderland.project_members';
const JULIUS = 'SELECT 1 AS julius_route';
const human = (id: string): WfsPrincipal => ({ kind: 'human', id, onBehalfOf: null, grantId: null, sessionId: null, clientBuild: null, tool: null, missionId: null, attemptId: null } as unknown as WfsPrincipal);
const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));
const TIMED_OUT = Symbol('still waiting');
const within = <T>(p: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> => Promise.race([p, tick(ms).then((): typeof TIMED_OUT => TIMED_OUT)]);
const outcome = (r: RelayResult<unknown>) => (r.ok ? 'ok' : { code: r.error.code, retryable: r.error.retryable });
const OUTAGE = { code: 'stale-ledger-version', retryable: true };

/** The database every fake client of one pool talks to: what each client was asked, and a gate that holds chosen statements. */
class FakeDb {
  readonly statements: Array<{ readonly client: number; readonly sql: string }> = [];
  private holding: ((sql: string) => boolean) | null = null;
  private gate: Promise<void> = Promise.resolve();
  private open: () => void = () => undefined;
  /** A statement that fails with this SQLSTATE (once), e.g. 55P03 lock_not_available, 57014 query_canceled. */
  failing: { readonly when: (sql: string) => boolean; readonly code: string } | null = null;

  hold(when: (sql: string) => boolean): void {
    this.holding = when;
    this.gate = new Promise<void>((r) => { this.open = r; });
  }

  release(): void {
    this.holding = null;
    this.open();
  }

  async answer(client: number, sql: string): Promise<{ rows: unknown[]; rowCount: number }> {
    this.statements.push({ client, sql });
    if (this.holding?.(sql)) await this.gate;
    if (this.failing !== null && this.failing.when(sql)) {
      const code = this.failing.code;
      this.failing = null;
      throw Object.assign(new Error(`fake ${code}`), { code });
    }
    // the protected-store guard's identity reads: an ordinary Wonderland database
    if (sql.includes('shobj_description')) return { rows: [{ c: null }], rowCount: 1 };
    if (sql === 'SELECT current_database() AS db') return { rows: [{ db: 'wonderland' }], rowCount: 1 };
    if (sql.includes('pg_control_system()')) return { rows: [{ sid: '7000000000000000001' }], rowCount: 1 };
    if (sql.startsWith(ROLE_SQL)) return { rows: [{ role: 'OWNER' }], rowCount: 1 };
    if (sql.startsWith('SELECT bytes FROM relay_wonderland.wfs_blob_bytes')) return { rows: [{ bytes: Buffer.from('bytes') }], rowCount: 1 };
    if (sql === JULIUS) return { rows: [{ julius_route: 1 }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  }

  /** Each client's statements, in order. */
  byClient(): Map<number, string[]> {
    const out = new Map<number, string[]>();
    for (const s of this.statements) out.set(s.client, [...(out.get(s.client) ?? []), s.sql]);
    return out;
  }
}

/** A pg Client stand-in with exactly what pg-pool uses: connect, end, query (callback or promise), events, _queryable / _ending. */
function fakeClient(db: FakeDb): new () => EventEmitter {
  let made = 0;
  return class FakePgClient extends EventEmitter {
    readonly id = (made += 1);
    _queryable = true;
    _ending = false;
    connect(cb?: (err: Error | null) => void): Promise<void> | undefined {
      if (cb === undefined) return Promise.resolve();
      setImmediate(() => cb(null));
      return undefined;
    }
    end(cb?: () => void): Promise<void> | undefined {
      this._ending = true;
      setImmediate(() => {
        this.emit('end');
        cb?.();
      });
      return cb === undefined ? Promise.resolve() : undefined;
    }
    query(text: unknown, values?: unknown, cb?: (err: Error | null, res?: unknown) => void): Promise<unknown> | undefined {
      const done = typeof values === 'function' ? (values as typeof cb) : cb;
      const sql = typeof text === 'string' ? text : String((text as { text?: unknown }).text ?? '');
      const run = db.answer(this.id, sql);
      if (done === undefined) return run;
      run.then((r) => done(null, r), (e: Error) => done(e));
      return undefined;
    }
  };
}

const pools: Pool[] = [];
const servers: Server[] = [];
const dbs: FakeDb[] = [];
/** A REAL pg-pool over the fake database (`max` as given; pg-pool's default is 10, the bridge's juliusPool). */
function pgPool(db: FakeDb, max?: number): Pool {
  if (!dbs.includes(db)) dbs.push(db);
  const pool = new Pool({ ...(max === undefined ? {} : { max }), Client: fakeClient(db) as never, idleTimeoutMillis: 0 });
  pool.on('error', () => undefined);
  pools.push(pool);
  return pool;
}
afterEach(async () => {
  // a case that failed midway leaves statements held: open every gate first, so no pool waits on them
  for (const db of dbs.splice(0)) db.release();
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => {
    s.closeAllConnections();
    s.close(() => r());
  })));
  await Promise.all(pools.splice(0).map((p) => p.end().catch(() => undefined)));
});

/** Clients checked out of the pool right now (taken, not idle). */
const checkedOut = (pool: Pool): number => pool.totalCount - pool.idleCount;

describe('K7: every WonderFS acquisition is inside its share of a shared pool (contract r1.6.2 e1 "Every acquisition counts", §21 K7; JULIUS_DEV C10)', () => {
  it('a burst of gate lookups (memberRole, run on every admitted request) holds at most 4 of a max-10 pool, and a Julius-route query still gets a client at once; past the wait the lookups answer the retryable outage, never hang (CONTROL: the same burst as bare pool.query takes every client and the Julius query waits)', async () => {
    const db = new FakeDb();
    const pool = pgPool(db);
    expect(pool.options.max, 'pg-pool\'s default: the bridge\'s juliusPool').toBe(10);
    const store = openWfsPostgresStore(pool, { bounds: { acquireWaitMs: 400 } });
    expect(outcome(await store.memberRole(P, 'ghu-1')), 'warm: the guard has cleared this pool').toBe('ok');
    db.hold((sql) => sql.startsWith(ROLE_SQL));
    const burst = Array.from({ length: 12 }, () => store.memberRole(P, 'ghu-1'));
    await tick(50);
    expect(checkedOut(pool), 'WonderFS holds its share, no more').toBeLessThanOrEqual(4);
    expect(await within(pool.query(JULIUS), 300), 'a Julius-route query gets a client at once').not.toBe(TIMED_OUT);
    // the lookups that never got one of the four answer the retryable outage at the wait's end (here 400 ms), never hang
    const late = await within(Promise.all(burst.slice(4)), 2_000);
    expect(late === TIMED_OUT ? 'hung' : late.map(outcome)).toEqual(Array.from({ length: 8 }, () => ({ code: 'stale-ledger-version', retryable: true })));
    db.release();
    expect((await Promise.all(burst.slice(0, 4))).map(outcome), 'the four held ones finish').toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(outcome(await store.memberRole(P, 'ghu-1')), 'and the next request is served').toBe('ok');

    // CONTROL: today's shape -- a bare pool.query per lookup -- on the same pool takes all 10 clients ahead of the Julius query
    db.hold((sql) => sql.startsWith(ROLE_SQL));
    const bare = Array.from({ length: 12 }, () => pool.query(`${ROLE_SQL} WHERE project_id = $1 AND player_id = $2`, [P, 'ghu-1']));
    await tick(50);
    expect(checkedOut(pool), 'CONTROL: uncapped, the burst takes every client').toBe(10);
    const starved = pool.query(JULIUS);
    expect(await within(starved, 300), 'CONTROL: the Julius query waits behind it').toBe(TIMED_OUT);
    db.release();
    await Promise.all([...bare, starved]);
  });

  it('the same with readBlob and the protected-store guard\'s identity read in the burst (a NEW store: every first call runs its guard): at most 4 held, a Julius query served (CONTROL: the guard over the bare pool, today\'s wiring, takes every client)', async () => {
    const db = new FakeDb();
    const pool = pgPool(db);
    const store = openWfsPostgresStore(pool, { bounds: { acquireWaitMs: 400 } });
    db.hold((sql) => sql.includes('shobj_description') || sql.startsWith(ROLE_SQL) || sql.startsWith('SELECT bytes FROM relay_wonderland.wfs_blob_bytes'));
    const burst: Array<Promise<unknown>> = [];
    for (let i = 0; i < 6; i += 1) {
      burst.push(store.memberRole(P, 'ghu-1').catch((e: unknown) => e)); // a guard read past the wait throws (the route's 503)
      burst.push(store.readBlob(P, 'a'.repeat(64)).catch((e: unknown) => e));
    }
    await tick(50);
    expect(db.statements.some((s) => s.sql.includes('shobj_description')), 'the guard\'s read is in the burst').toBe(true);
    expect(checkedOut(pool), 'guard reads, gate lookups and blob reads together: at most 4').toBeLessThanOrEqual(4);
    expect(await within(pool.query(JULIUS), 300), 'a Julius-route query gets a client at once').not.toBe(TIMED_OUT);
    db.release();
    await within(Promise.all(burst), 3_000);

    // CONTROL: the guard over the RAW pool (R4:PG:475's wiring), twelve first calls at once: every client taken
    db.hold((sql) => sql.includes('shobj_description'));
    const guards = Array.from({ length: 12 }, () => protectedStoreWriterGuard(pool, 'control')());
    await tick(50);
    expect(checkedOut(pool), 'CONTROL: the bare guard takes every client').toBe(10);
    const starved = pool.query(JULIUS);
    expect(await within(starved, 300), 'CONTROL: the Julius query waits').toBe(TIMED_OUT);
    db.release();
    await Promise.all([...guards, starved]);
  });

  it('the ACTUAL max: mounted on a shared pool whose max is 8, WonderFS takes NO client from it -- its queries run on its own pool (max <= 4, an \'error\' listener); on a max-10 pool it shares (at most 4) and opens none (CONTROL: a store given the max-8 pool draws from it)', async () => {
    const db = new FakeDb();
    const shared = pgPool(db, 8);
    const opened: Pool[] = [];
    const logs: string[] = [];
    const sessions = createBrowserSessionStore();
    const minted = sessions.mintNativeSocialSession({ now: Date.now(), participantId: 'ghu-1' });
    if (!minted.ok) throw new Error('not minted');
    const mountOn = async (pool: Pool) => {
      const mount = createWonderfsMount({
        sessions,
        pool: () => pool,
        log: (line) => logs.push(line),
        openDedicatedPool: (from: Pool) => {
          const own = new Pool({ ...from.options, max: 4 });
          pools.push(own);
          opened.push(own);
          return own;
        },
      });
      const server = createServer((req, res) => { void mount.serve(req, res, {}); });
      servers.push(server);
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      const address = server.address();
      return `http://127.0.0.1:${typeof address === 'object' && address !== null ? address.port : 0}`;
    };
    const ask = async (base: string) => (await fetch(`${base}/wonderfs/v1/projects/${P}/events`, { headers: { authorization: `Relay-Session ${minted.session.token}` } })).status;
    const base8 = await mountOn(shared);
    await ask(base8);
    await ask(base8);
    expect(shared.totalCount, 'not one client taken from the max-8 shared pool').toBe(0);
    expect(opened, 'one pool of its own, opened once').toHaveLength(1);
    expect([opened[0].options.max <= 4, opened[0].totalCount > 0], 'its own pool: max <= 4, and it served the requests').toEqual([true, true]);
    expect(opened[0].listenerCount('error'), 'its own pool listens for a lost idle client, as juliusPool does').toBeGreaterThanOrEqual(1);
    // a max-10 shared pool is shared (and nothing is opened)
    const roomy = pgPool(db, 10);
    await ask(await mountOn(roomy));
    expect([roomy.totalCount > 0, opened.length], 'max 10: shared, no pool of its own').toEqual([true, 1]);

    // CONTROL: today's store draws from whatever pool it is given
    const control = pgPool(db, 8);
    expect(outcome(await openWfsPostgresStore(control).memberRole(P, 'ghu-1'))).toBe('ok');
    expect(control.totalCount, 'CONTROL: a store opened on the max-8 pool takes its clients').toBeGreaterThan(0);
  });
});

describe('K3: bounded waits (contract r1.6.2 e1, §21 K3; JULIUS_DEV C3)', () => {
  /** The SET statements a client issued, in order, and whether each came after its BEGIN. */
  const bounds = (statements: readonly string[]) => statements.filter((s) => /\bSET\b/i.test(s));

  it('every WonderFS transaction sets its bounds TRANSACTION-LOCALLY right after BEGIN -- writes lock 10 s / statement 30 s (an upload 60 s) / idle-in-transaction 60 s; snapshots and direct reads statement 30 s -- and NO session-level SET ever (CONTROL: the store before R2-r5 set none)', async () => {
    const db = new FakeDb();
    const pool = pgPool(db);
    const store = openWfsPostgresStore(pool);
    await store.memberRole(P, 'ghu-1'); // the guard's reads + the gate lookup
    await store.readBlob(P, 'b'.repeat(64));
    await store.tree(P, { branchId: WFS_MAIN_BRANCH });
    await store.commit(P, { requestId: 'req-bounds-1', branchId: WFS_MAIN_BRANCH, baseRev: 0, principal: human('ghu-1'), ops: [{ op: 'create', path: 'd', kind: 'dir' }] }, NOW);
    await store.putBlob(P, new Uint8Array([1, 2, 3]));
    await store.createProject(P, NOW);
    const sessionLevel = db.statements.filter((s) => /^\s*SET\s+(?!LOCAL\b)/i.test(s.sql) || /;\s*SET\s+(?!LOCAL\b)/i.test(s.sql));
    expect(sessionLevel, 'no session-level SET: a later query of another family on the same client would inherit it').toEqual([]);
    // each client's statements cut into its transactions (pg-pool hands an idle client to the next checkout): NOTHING outside one
    const transactions: string[][] = [];
    for (const statements of db.byClient().values()) {
      let open = false;
      for (const sql of statements) {
        if (/^BEGIN\b/.test(sql)) {
          transactions.push([sql]);
          open = true;
        } else if (!open) {
          transactions.push([`(outside a transaction) ${sql}`]);
        } else {
          transactions[transactions.length - 1].push(sql);
          if (/^(COMMIT|ROLLBACK)$/.test(sql)) open = false;
        }
      }
    }
    expect(transactions.filter((t) => !/^BEGIN\b/.test(t[0])), 'every statement runs inside a transaction that opened with its bounds').toEqual([]);
    expect(transactions.length, 'the guard\'s three reads, the lookup, readBlob, tree, commit, upload, createProject').toBeGreaterThanOrEqual(9);
    const of = (needle: string) => transactions.find((st) => st.some((x) => x.startsWith(needle))) ?? [];
    expect(bounds(of(ROLE_SQL)).join(' | ')).toMatch(/SET LOCAL statement_timeout = 30000/);
    expect(bounds(of('SELECT bytes FROM relay_wonderland.wfs_blob_bytes')).join(' | ')).toMatch(/SET LOCAL statement_timeout = 30000/);
    expect(bounds(of('SELECT b.head_rev')).join(' | '), 'a snapshot').toMatch(/SET LOCAL statement_timeout = 30000/);
    const write = bounds(of('SELECT next_event_seq::text AS next_event_seq FROM relay_wonderland.wfs_projects')).join(' | ');
    for (const b of ['SET LOCAL lock_timeout = 10000', 'SET LOCAL statement_timeout = 30000', 'SET LOCAL idle_in_transaction_session_timeout = 60000']) expect(write, `a commit: ${b}`).toContain(b);
    const upload = bounds(of('SELECT 1 FROM relay_wonderland.wfs_projects')).join(' | ');
    for (const b of ['SET LOCAL lock_timeout = 10000', 'SET LOCAL statement_timeout = 60000', 'SET LOCAL idle_in_transaction_session_timeout = 60000']) expect(upload, `an upload: ${b}`).toContain(b);
    const create = bounds(of('INSERT INTO relay_wonderland.wfs_projects')).join(' | ');
    for (const b of ['SET LOCAL lock_timeout = 10000', 'SET LOCAL statement_timeout = 30000']) expect(create, `createProject: ${b}`).toContain(b);
    // the guard's identity read is bounded too
    expect(bounds(of("SELECT shobj_description")).join(' | ')).toMatch(/SET LOCAL statement_timeout = 30000/);
  });

  it('the in-process per-project queue waits a BOUNDED time: a change queued behind a stuck one answers the retryable outage at the bound, having run NOTHING (CONTROL: with a long bound it is still waiting; the stuck one ending lets it run)', async () => {
    const db = new FakeDb();
    const pool = pgPool(db);
    const FOR_UPDATE = 'SELECT next_event_seq::text AS next_event_seq FROM relay_wonderland.wfs_projects WHERE project_id = $1 AND deleted_at IS NULL FOR UPDATE';
    const req = (n: number) => ({ requestId: `req-queue-${n}x`, branchId: WFS_MAIN_BRANCH, baseRev: 0, principal: human('ghu-1'), ops: [{ op: 'create' as const, path: `d${n}`, kind: 'dir' as const }] });
    const store = openWfsPostgresStore(pool, { bounds: { queueWaitMs: 150 } });
    await store.memberRole(P, 'ghu-1'); // warm the guard
    db.hold((sql) => sql === FOR_UPDATE);
    const stuck = store.commit(P, req(1), NOW);
    await tick(30);
    const clientsBefore = db.byClient().size;
    const queued = await within(store.commit(P, req(2), NOW), 1_500);
    expect(queued === TIMED_OUT ? 'hung' : outcome(queued), 'past the bound: the retryable outage').toEqual(OUTAGE);
    expect(db.byClient().size, 'it ran nothing: no client taken, no statement sent').toBe(clientsBefore);
    db.release();
    await stuck;

    // CONTROL: a long bound -- the queued change is still waiting while the first is stuck, and runs once it ends
    const patient = openWfsPostgresStore(pool, { bounds: { queueWaitMs: 60_000 } });
    await patient.memberRole(P, 'ghu-1');
    db.hold((sql) => sql === FOR_UPDATE);
    const first = patient.commit(P, req(3), NOW);
    await tick(30);
    const second = patient.commit(P, req(4), NOW);
    expect(await within(second, 400), 'CONTROL: still waiting in the queue').toBe(TIMED_OUT);
    db.release();
    await first;
    const ran = await second;
    expect(ran.ok ? 'ok' : ran.error.code, 'CONTROL: it ran after the first (this fake holds no project: not-found)').toBe('not-found');
  });

  it('a lock wait (55P03) and a statement past its bound (57014) are the retryable outage -- for a write, an upload and a read -- never a 500 (writeFailed pinned; CONTROL: an integrity failure, 23505, is the non-retryable 500)', async () => {
    const db = new FakeDb();
    const pool = pgPool(db);
    const store = openWfsPostgresStore(pool);
    await store.memberRole(P, 'ghu-1');
    const commit = () => store.commit(P, { requestId: `req-sqlstate-${Math.random().toString(36).slice(2, 10)}`, branchId: WFS_MAIN_BRANCH, baseRev: 0, principal: human('ghu-1'), ops: [{ op: 'create', path: 'd', kind: 'dir' }] }, NOW);
    for (const code of ['55P03', '57014']) {
      db.failing = { when: (sql) => sql.includes('FOR UPDATE'), code };
      expect(outcome(await commit()), `a commit meeting ${code}`).toEqual(OUTAGE);
      db.failing = { when: (sql) => sql.includes('FOR UPDATE'), code };
      expect(outcome(await store.putBlob(P, new Uint8Array([code.length]))), `an upload meeting ${code}`).toEqual(OUTAGE);
      db.failing = { when: (sql) => sql.startsWith('SELECT b.head_rev'), code };
      expect(outcome(await store.tree(P, { branchId: WFS_MAIN_BRANCH })), `a read meeting ${code}`).toEqual(OUTAGE);
      db.failing = { when: (sql) => sql.startsWith(ROLE_SQL), code };
      expect(outcome(await store.memberRole(P, 'ghu-1')), `a gate lookup meeting ${code}`).toEqual(OUTAGE);
    }
    db.failing = { when: (sql) => sql.includes('FOR UPDATE'), code: '23505' };
    expect(outcome(await commit()), 'CONTROL: an integrity failure is not an outage').toEqual({ code: 'illegal-transition', retryable: false });
  });
});
