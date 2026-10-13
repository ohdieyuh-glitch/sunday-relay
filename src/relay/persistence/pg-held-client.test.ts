import { EventEmitter } from 'node:events';
import type { Pool } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkoutHeld } from './pg-held-client';
import { openSocialPostgresStore } from './social-postgres';
import { createPostgresVoiceBindings } from './voice-binding-postgres';
import { TransactionalWonderlandDatabase } from './wonderland-postgres';

/*
 * MW-B-001 (MAIN WONDERLAND's audit, 2026-10-13): a client that a store HOLDS mid-transaction had no 'error' listener, so a
 * PostgreSQL restart or a terminated backend (57P01) raised the client's 'error' as an uncaught exception and the bridge died.
 * The pool listens only while a client is idle. This pins, against a scripted pool whose clients are real EventEmitters (as pg's
 * are), that each Wonderland store hears that event, fails the operation as its retryable error, and serves the next one.
 * The same death on real PostgreSQL (pg_terminate_backend on the held backend) is pg-held-client.real-postgres.test.ts.
 */

const NOW = '2026-10-13T12:00:00.000Z';
const NOT_QUERYABLE = 'Client has encountered a connection error and is not queryable';
/** What pg reports when PostgreSQL ends the backend: the server's FATAL ErrorResponse (a DatabaseError has `severity`). */
const fatal = (): Error => Object.assign(new Error('terminating connection due to administrator command'), { code: '57P01', severity: 'FATAL' });
const closed = (): Error => new Error('Connection terminated unexpectedly');

/**
 * HOW A BACKEND DIES UNDER A HELD CLIENT, the two ways pg 8 sees it:
 *  - during-statement: the statement in flight rejects with the FATAL (57P01). The socket then closes, and pg emits 'error'
 *    ("Connection terminated unexpectedly") on a LATER turn of the event loop, failing whatever was sent after it (the
 *    ROLLBACK). The store still holds the client at that moment, because it is waiting on that ROLLBACK.
 *  - between-statements (idle in transaction): pg emits the FATAL as 'error' on its own turn of the event loop, then emits
 *    again when the socket closes. The next statement is refused as not queryable.
 */
type Death = 'during-statement' | 'between-statements';

/**
 * A pool whose clients die on request. The emit runs where pg's socket handler runs it, outside the store's promise chain.
 * With no listener, EventEmitter throws there: in pg that is an UNCAUGHT exception, and the process exits. The pool records
 * that throw as `uncaught`, so it does not end the test runner, and records how many listeners each emission found.
 */
function dyingPool() {
  const seen = { uncaught: 0, listenersAtDeath: [] as number[], released: [] as unknown[], connects: 0 };
  let kill: { at: (sql: string) => boolean; death: Death } | null = null;
  const answer = async (sql: string) => {
    // the C2 guard's identity reads (protected-store.ts): an ordinary database
    if (sql.includes('shobj_description')) return { rows: [{ c: null }], rowCount: 1 };
    if (sql === 'SELECT current_database() AS db') return { rows: [{ db: 'wonderland' }], rowCount: 1 };
    if (sql.includes('pg_control_system()')) return { rows: [{ sid: '7000000000000000001' }], rowCount: 1 };
    // every table is empty, and every write touches one row
    return { rows: [], rowCount: 1 };
  };
  const fromTheSocket = (client: EventEmitter, error: Error): void => {
    seen.listenersAtDeath.push(client.listenerCount('error'));
    try {
      client.emit('error', error);
    } catch {
      seen.uncaught += 1;
    }
  };
  const connect = async () => {
    seen.connects += 1;
    const client = new EventEmitter() as EventEmitter & { query: (sql: string, values?: unknown[]) => Promise<unknown>; release: (error?: unknown) => void };
    let state: 'up' | 'closing' | 'down' = 'up';
    const waiting: Array<(error: Error) => void> = [];
    client.query = async (sql: string) => {
      if (state === 'down') throw new Error(NOT_QUERYABLE);
      if (state === 'closing') return new Promise((_resolve, reject) => waiting.push(reject));
      const death = kill !== null && kill.at(sql.trim()) ? kill.death : null;
      if (death === null) return answer(sql.trim());
      kill = null;
      if (death === 'during-statement') {
        state = 'closing';
        setImmediate(() => {
          state = 'down';
          const error = closed();
          fromTheSocket(client, error);
          for (const reject of waiting.splice(0)) reject(error);
        });
        throw fatal();
      }
      await new Promise<void>((resolve) => setImmediate(() => {
        state = 'down';
        fromTheSocket(client, fatal());
        fromTheSocket(client, closed());
        resolve();
      }));
      throw new Error(NOT_QUERYABLE);
    };
    client.release = (error?: unknown) => { seen.released.push(error); };
    return client;
  };
  return {
    pool: { connect, query: (sql: string) => answer(sql.trim()) } as unknown as Pool,
    seen,
    killAt: (at: (sql: string) => boolean, death: Death) => { kill = { at, death }; },
  };
}

/** The shape every Wonderland store had at b01ee6bd: connect, BEGIN, a write, ROLLBACK on failure, release. No listener. */
async function preFixTransaction(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO relay_wonderland.example(id) VALUES($1)', ['x']);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

const isInsert = (sql: string): boolean => sql.startsWith('INSERT');
const storeLines = (warn: { mock: { calls: unknown[][] } }): string[] =>
  warn.mock.calls.map((call) => String(call[0])).filter((line) => line.startsWith('[relay-store]'));

afterEach(() => {
  vi.restoreAllMocks();
});

/** Per death: what the statement in flight rejects with, the SQLSTATE the first emission carries, and how many emissions. */
const DEATHS: ReadonlyArray<{ readonly death: Death; readonly rejects: string; readonly code: string; readonly emissions: number }> = [
  { death: 'during-statement', rejects: 'administrator command', code: 'no SQLSTATE', emissions: 1 },
  { death: 'between-statements', rejects: NOT_QUERYABLE, code: 'SQLSTATE 57P01', emissions: 2 },
];

describe('MW-B-001, the CONTROL: without a listener, the death of a held client is an uncaught exception', () => {
  for (const { death, rejects, emissions } of DEATHS) {
    it(`${death}: the pre-fix shape lets it through (this instrument can fail)`, async () => {
      const db = dyingPool();
      db.killAt(isInsert, death);
      await expect(preFixTransaction(db.pool)).rejects.toThrow(rejects);
      // nobody listened, at every emission: each one would have ended the bridge
      expect(db.seen.listenersAtDeath).toEqual(Array<number>(emissions).fill(0));
      expect(db.seen.uncaught).toBe(emissions);
    });
  }
});

describe('MW-B-001: checkoutHeld hears the death, logs it once by SQLSTATE, and has the pool destroy the client', () => {
  for (const { death, rejects, code, emissions } of DEATHS) it(`${death}: heard (${code}), never uncaught`, async () => {
    const db = dyingPool();
    const lines: string[] = [];
    db.killAt(isInsert, death);
    const { client, release } = await checkoutHeld(db.pool, 'test store', (line) => lines.push(line));
    expect(client.listenerCount('error'), 'one listener while held').toBe(1);
    const run = async () => {
      try {
        await client.query('BEGIN');
        await client.query('INSERT INTO relay_wonderland.example(id) VALUES($1)', ['x']);
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        release();
      }
    };
    await expect(run()).rejects.toThrow(rejects);
    expect(db.seen.listenersAtDeath).toEqual(Array<number>(emissions).fill(1));
    expect(db.seen.uncaught).toBe(0);
    // ONE fixed line, by SQLSTATE only: never the error's message, a statement or a value
    expect(lines).toEqual([`[relay-store] test store: a held database connection was lost (${code}); the operation in flight fails as retryable`]);
    expect(lines.join('\n')).not.toMatch(/administrator|terminated|INSERT|example/u);
    // handed back WITH the error, so pg-pool destroys it rather than reusing it; and the listener goes with the checkout
    expect(db.seen.released).toHaveLength(1);
    expect(db.seen.released[0]).toBeInstanceOf(Error);
    expect(client.listenerCount('error')).toBe(0);
  });

  it('a healthy checkout logs nothing and goes back to the pool as reusable', async () => {
    const db = dyingPool();
    const lines: string[] = [];
    const { client, release } = await checkoutHeld(db.pool, 'test store', (line) => lines.push(line));
    await client.query('BEGIN');
    await client.query('COMMIT');
    release();
    expect(lines).toEqual([]);
    expect(db.seen.released).toEqual([undefined]);
    expect(client.listenerCount('error')).toBe(0);
  });
});

describe('MW-B-001: each Wonderland store survives a held client dying, answers its retryable error, and serves the next call', () => {
  it('the social store: apply answers stale-ledger-version, retryable (the route answers 503), adopts nothing, then saves', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const db = dyingPool();
    const store = await openSocialPostgresStore(db.pool);
    await store.ensureUser({ userId: 'usr_kai', displayName: 'Kai', handle: '@kai' }, NOW);
    const busy = () => store.apply('presence.update_self', 'usr_kai', { ids: [], body: { availability: 'BUSY' }, query: {} }, NOW);
    for (const death of ['during-statement', 'between-statements'] as const) {
      db.killAt(isInsert, death);
      const before = await store.read();
      expect(await busy(), death).toEqual({ ok: false, error: expect.objectContaining({ code: 'stale-ledger-version', retryable: true }) });
      expect(await store.read(), `${death}: nothing was adopted`).toBe(before);
    }
    expect(db.seen.listenersAtDeath).toEqual([1, 1, 1]);
    expect(db.seen.uncaught).toBe(0);
    expect(storeLines(warn)).toEqual([
      '[relay-store] social store: a held database connection was lost (no SQLSTATE); the operation in flight fails as retryable',
      '[relay-store] social store: a held database connection was lost (SQLSTATE 57P01); the operation in flight fails as retryable',
    ]);
    // THE NEXT CALL WORKS: a fresh client, and the change is saved and adopted
    expect((await busy()).ok).toBe(true);
    expect((await store.read()).users.usr_kai?.presence.availability).toBe('BUSY');
  });

  it('the voice bindings: bind throws (the voice route answers 503), then binds', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const db = dyingPool();
    const bindings = createPostgresVoiceBindings(db.pool);
    const bind = () => bindings.bind({ userId: 'ghu-1', puid: '0123456789abcdef0123456789abcdef', sessionId: 's1', sessionIssuedAtIso: null, sessionIssuedAtOf: null, nowIso: NOW });
    db.killAt(isInsert, 'during-statement');
    await expect(bind()).rejects.toMatchObject({ code: '57P01' });
    db.killAt(isInsert, 'between-statements');
    await expect(bind()).rejects.toThrow(NOT_QUERYABLE);
    expect(db.seen.listenersAtDeath).toEqual([1, 1, 1]);
    expect(db.seen.uncaught).toBe(0);
    expect(storeLines(warn)).toHaveLength(2);
    expect(await bind()).toBe('bound');
  });

  it('the wonderland store: transaction() and createSwarmRun throw and are not retried (only 40001/40P01 are), then succeed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const db = dyingPool();
    const wonderland = new TransactionalWonderlandDatabase(db.pool);
    db.killAt((sql) => sql.startsWith('SELECT payload'), 'between-statements');
    await expect(wonderland.replayEvents('prj-1', 0, 10)).rejects.toThrow(NOT_QUERYABLE);
    const run = {
      swarmId: 'swarm-1', battleId: 'b-1', parentExecutionId: 'e-1', parentAgentId: 'a-1', cardVersionId: 'c-1', mode: 'GOAL' as const,
      requestedRoles: ['CODER'], authorizedRoles: ['CODER'], concurrencyCeiling: 1, budget: {}, activatedAt: NOW, deadline: NOW,
      workers: [{ workerId: 'w-1', role: 'CODER' }],
    };
    db.killAt(isInsert, 'during-statement');
    await expect(wonderland.createSwarmRun(run)).rejects.toMatchObject({ code: '57P01' });
    expect(db.seen.connects, 'one checkout each: a lost connection is not retried').toBe(2);
    expect(db.seen.listenersAtDeath).toEqual([1, 1, 1]);
    expect(db.seen.uncaught).toBe(0);
    expect(storeLines(warn)).toHaveLength(2);
    expect(await wonderland.replayEvents('prj-1', 0, 10)).toEqual([]);
    expect(await wonderland.createSwarmRun(run)).toBe(true);
  });
});
