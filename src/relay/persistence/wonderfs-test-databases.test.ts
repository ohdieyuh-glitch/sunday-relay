import { EventEmitter } from 'node:events';
import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

import { wfsThrowawayDatabases, type WfsTrackedPool } from './wonderfs-test-databases';

/**
 * R2-r4: THE TEARDOWN ORDER OF THE WONDERFS REAL-POSTGRESQL SUITES, proven without a database (CI's real-PostgreSQL job runs the
 * suites themselves). The fakes keep the two pg-pool 3.14 facts the CI failure turned on:
 *   - end() takes every IDLE client out at once and resolves; each socket closes LATER (its 'remove'), so a terminate sent right after
 *     end() can still reach it;
 *   - a terminated backend's FATAL on an idle (or closing) client is re-emitted as the POOL's 'error'. Node throws an 'error' event
 *     nobody hears; arriving on a socket's data, that is the uncaught exception vitest counted as an Error. The fake RECORDS such an
 *     event as `unheard` instead of throwing, so the CONTROL can count them without crashing this run.
 */

const FATAL = (): Error => Object.assign(new Error('terminating connection due to administrator command'), { code: '57P01', severity: 'FATAL' });

interface FakeClient { state: 'idle' | 'out' | 'closing' | 'closed' }

class FakePool extends EventEmitter {
  readonly clients = new Set<FakeClient>();
  private ending = false;

  constructor(readonly database: string, private readonly world: World, private readonly stuckClosing = false) {
    super();
  }

  get totalCount(): number {
    return this.clients.size;
  }

  withIdle(n: number): this {
    for (let i = 0; i < n; i += 1) this.clients.add({ state: 'idle' });
    return this;
  }

  checkOut(): this {
    this.clients.add({ state: 'out' });
    return this;
  }

  end(): Promise<void> {
    if (this.ending) return Promise.reject(new Error('Called end on pool more than once'));
    this.ending = true;
    this.world.log.push(`end ${this.database}`);
    for (const client of [...this.clients].filter((c) => c.state === 'idle')) {
      this.clients.delete(client);
      client.state = 'closing';
      this.world.closing.add(client);
      if (!this.stuckClosing) {
        setTimeout(() => {
          client.state = 'closed';
          this.world.closing.delete(client);
          this.world.log.push(`closed ${this.database}`);
          this.emit('remove', client);
        }, 5);
      }
    }
    // a checked-out client: pg-pool's end() waits for its release (never, here)
    return this.clients.size === 0 ? Promise.resolve() : new Promise<void>(() => undefined);
  }

  /** The server terminated this pool's backends: every client whose socket is still open receives the FATAL. */
  terminated(closingOfThisPool: ReadonlySet<FakeClient>): void {
    const open = [...this.clients].filter((c) => c.state === 'idle').concat([...closingOfThisPool]);
    for (const client of open) {
      this.clients.delete(client);
      client.state = 'closed';
      if (this.listenerCount('error') === 0) this.world.unheard.push(this.database);
      else this.emit('error', FATAL());
    }
  }
}

class World {
  readonly log: string[] = [];
  readonly unheard: string[] = [];
  readonly closing = new Set<FakeClient>();
  readonly pools: FakePool[] = [];

  pool(database: string, idle = 1, stuckClosing = false): FakePool {
    const pool = new FakePool(database, this, stuckClosing).withIdle(idle);
    this.pools.push(pool);
    return pool;
  }

  /** The admin connection: a terminate reaches every pool on that database (its own closing clients included). */
  readonly admin = {
    query: async (sql: string, params: unknown[] = []): Promise<unknown> => {
      if (sql.startsWith('SELECT pg_terminate_backend')) {
        const database = params[0] as string;
        this.log.push(`terminate ${database}`);
        for (const pool of this.pools.filter((p) => p.database === database)) {
          const mine = new Set([...this.closing].filter((c) => this.owner.get(c) === pool));
          for (const c of mine) this.closing.delete(c);
          pool.terminated(mine);
        }
      } else if (sql.startsWith('DROP DATABASE IF EXISTS ')) {
        this.log.push(`drop ${sql.slice('DROP DATABASE IF EXISTS '.length)}`);
      } else {
        throw new Error(`unexpected admin statement: ${sql}`);
      }
      return { rows: [] };
    },
  };

  /** Which pool a closing client came from (set when the pool is built). */
  readonly owner = new Map<FakeClient, FakePool>();

  register(): void {
    for (const pool of this.pools) for (const c of pool.clients) this.owner.set(c, pool);
  }
}

const asPool = (p: FakePool): WfsTrackedPool => p as unknown as WfsTrackedPool;
const asAdmin = (w: World): Pick<Pool, 'query'> => w.admin as unknown as Pick<Pool, 'query'>;

/** The write suite's databases at r3/r4: mount (+1 reopen), mountother, crash (+2 reopens); one idle client each, as in CI's 7 s run. */
function writeSuite(world: World): Array<{ name: string; pool: FakePool }> {
  const made = [
    { name: 'wfswritemount', pool: world.pool('wfswritemount') },
    { name: 'wfswritemount', pool: world.pool('wfswritemount') },
    { name: 'wfswritemountother', pool: world.pool('wfswritemountother') },
    { name: 'wfswritecrash', pool: world.pool('wfswritecrash') },
    { name: 'wfswritecrash', pool: world.pool('wfswritecrash') },
    { name: 'wfswritecrash', pool: world.pool('wfswritecrash') },
  ];
  world.register();
  return made;
}

describe('WonderFS real-PostgreSQL teardown (R2-r4: CI r1.16\'s 3 uncaught 57P01 Errors)', () => {
  it('CONTROL: node throws an \'error\' event nobody hears (on a socket\'s data, the uncaught exception CI counted)', () => {
    expect(() => new EventEmitter().emit('error', FATAL())).toThrow('terminating connection due to administrator command');
  });

  it('CONTROL, r3\'s afterAll replayed: one pool ended, then its database terminated -- each REOPENED pool on it is unheard, 3 in all (CI: "Errors 3 errors")', async () => {
    const world = new World();
    for (const { name, pool } of writeSuite(world)) {
      pool.on('error', () => undefined);
      await pool.end().catch(() => undefined);
      await world.admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [name]);
      await world.admin.query(`DROP DATABASE IF EXISTS ${name}`);
    }
    expect(world.unheard).toEqual(['wfswritemount', 'wfswritecrash', 'wfswritecrash']);
  });

  it('r4: EVERY pool ends and every client closes before the first terminate; each database is terminated and dropped ONCE; nothing is unheard, nothing even reaches a listener', async () => {
    const world = new World();
    const databases = wfsThrowawayDatabases();
    for (const { name, pool } of writeSuite(world)) databases.track(name, asPool(pool));
    const result = await databases.teardown(asAdmin(world));
    expect(world.unheard, 'no uncaught exception').toEqual([]);
    expect(result.heard, 'no client was still open at the terminate').toEqual([]);
    expect(result.dropped).toEqual(['wfswritemount', 'wfswritemountother', 'wfswritecrash']);
    const firstTerminate = world.log.findIndex((l) => l.startsWith('terminate '));
    const before = world.log.slice(0, firstTerminate);
    expect(before.filter((l) => l.startsWith('end ')).length, 'all six pools ended first').toBe(6);
    expect(before.filter((l) => l.startsWith('closed ')).length, 'and all six clients closed first').toBe(6);
    expect(world.log.slice(firstTerminate)).toEqual([
      'terminate wfswritemount', 'drop wfswritemount',
      'terminate wfswritemountother', 'drop wfswritemountother',
      'terminate wfswritecrash', 'drop wfswritecrash',
    ]);
    expect(world.pools.every((p) => p.totalCount === 0)).toBe(true);
  });

  it('a pool that loses a client DURING a case is RECORDED (database, SQLSTATE) and taken once by the suite\'s afterEach -- never thrown, never swallowed', async () => {
    const world = new World();
    const databases = wfsThrowawayDatabases();
    const pool = world.pool('wfswritelocked', 2);
    world.register();
    databases.track('wfswritelocked', asPool(pool));
    expect(databases.databaseOf(asPool(pool))).toBe('wfswritelocked');
    expect(databases.databaseOf(asPool(world.pool('elsewhere')))).toBe(null);
    pool.terminated(new Set()); // a restart mid-case: both idle clients get the FATAL
    expect(world.unheard).toEqual([]);
    const taken = databases.takeCaseErrors();
    expect(taken).toEqual([
      { database: 'wfswritelocked', code: '57P01', message: 'terminating connection due to administrator command', during: 'case' },
      { database: 'wfswritelocked', code: '57P01', message: 'terminating connection due to administrator command', during: 'case' },
    ]);
    expect(databases.takeCaseErrors(), 'taken: the next case starts clean').toEqual([]);
    expect((await databases.teardown(asAdmin(world))).heard).toEqual([]);
  });

  it('a socket that never finishes closing: teardown waits only its bound, then the terminate\'s echo on it is RECORDED as teardown (not a case error, not uncaught)', async () => {
    const world = new World();
    const databases = wfsThrowawayDatabases();
    databases.track('wfsstuck', asPool(world.pool('wfsstuck', 1, true)));
    world.register();
    const result = await databases.teardown(asAdmin(world), { closeWithinMs: 30 });
    expect(world.unheard).toEqual([]);
    expect(result.heard).toEqual([{ database: 'wfsstuck', code: '57P01', message: 'terminating connection due to administrator command', during: 'teardown' }]);
    expect(databases.takeCaseErrors()).toEqual([]);
    expect(result.dropped).toEqual(['wfsstuck']);
  });

  it('GUARD: a pool still holding a checked-out client fails the teardown by name, and NOTHING is terminated or dropped', async () => {
    const world = new World();
    const databases = wfsThrowawayDatabases();
    databases.track('wfsleak', asPool(world.pool('wfsleak', 1).checkOut()));
    databases.track('wfsfine', asPool(world.pool('wfsfine', 1)));
    world.register();
    await expect(databases.teardown(asAdmin(world), { closeWithinMs: 30 })).rejects.toThrow('1 pool(s) still hold a client (wfsleak); nothing was terminated or dropped');
    expect(world.log.filter((l) => l.startsWith('terminate ') || l.startsWith('drop '))).toEqual([]);
  });

  it('only a throwaway database name is ever interpolated into DROP DATABASE', () => {
    const databases = wfsThrowawayDatabases();
    const world = new World();
    for (const bad of ['wfs; DROP DATABASE x', 'WfsUpper', '', 'wfs-dash', `w${'x'.repeat(63)}`]) {
      expect(() => databases.track(bad, asPool(world.pool('x'))), bad).toThrow('is not a throwaway database name');
    }
    expect(() => databases.track('wfswrite_ok1', asPool(world.pool('x')))).not.toThrow();
  });
});
