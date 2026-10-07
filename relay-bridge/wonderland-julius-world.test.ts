import { describe, expect, it } from 'vitest';

import {
  WONDERLAND_JULIUS_READ_ONLY_BEGIN,
  withWonderlandJuliusReadOnlyTransaction,
  wonderlandJuliusWorld,
} from './wonderland-julius-world';
import { handleWonderlandJuliusRoute } from './wonderland-julius-routes';
import { NATIVE_WORLD_AUDIENCE, createBrowserSessionStore } from './browser-session/grants';
import type { BrowserSessionStore } from './browser-session/grants';
import { WONDERLAND_UNAVAILABLE_MESSAGE } from '../src/relay/mission/wonderland/wonderland-authorization';

/**
 * ROW 12, R1: THE WORLD ROUTES CANNOT WRITE.
 *
 * Every database access a world request makes runs inside ONE transaction begun
 * READ ONLY, on a facade that has nothing but `query`. This suite records every
 * statement a real composition sends -- membership, the world reader, AND
 * Julius's own result API (`composeJuliusStateApi`, main's, unmodified) -- and
 * audits them. The spy pool also behaves the way PostgreSQL does inside a READ
 * ONLY transaction: a write is refused with SQLSTATE 25006. The real-PostgreSQL
 * half (that the exact BEGIN text makes a real server refuse) is in
 * wonderland-julius-create-observe.real-postgres.test.ts.
 */

const NOW = 1_790_000_000_000;
const PLAYER = 'ghu-424242';
const PROJECT = 'project-alpha';
const RUN = 'run:0a1b2c';
const AT = '2026-10-07T12:00:00.000Z';

/** A statement that changes something, or locks a row for changing. Never a world read. */
const WRITE = /\b(?:INSERT|UPDATE|DELETE|MERGE|TRUNCATE|CREATE|ALTER|DROP|GRANT|REVOKE)\b|\bFOR\s+(?:NO\s+KEY\s+)?(?:UPDATE|SHARE|KEY\s+SHARE)\b/iu;

interface Connection {
  readonly statements: string[];
  released: 'returned' | 'destroyed' | null;
  readOnly: boolean;
}

/**
 * A pool that records everything and answers like PostgreSQL would: rows by the
 * statement's table, and -- inside a transaction begun READ ONLY -- SQLSTATE
 * 25006 for anything that writes.
 */
function spyPool(options: { readonly member?: boolean; readonly failOn?: RegExp } = {}) {
  const connections: Connection[] = [];
  const direct: string[] = [];
  const event = (sequence: number, type: string, payload: Record<string, unknown>) => ({
    event_id: `event-${sequence}`, stream_id: RUN, project_id: PROJECT, sequence: String(sequence),
    event_type: `julius.${type}`, occurred_at: AT,
    payload: { schemaVersion: 'relay-julius-event.v1', eventId: `event-${sequence}`, streamId: RUN, projectId: PROJECT, occurredAt: AT, payload: { runId: RUN, ...payload } },
  });
  const rowsFor = (sql: string, values: readonly unknown[]): readonly Record<string, unknown>[] => {
    if (sql.includes('project_members')) return options.member === false ? [] : [{ role: 'OWNER' }];
    if (sql.includes('julius_context_snapshots')) return [];
    if (sql.includes('LEFT JOIN LATERAL')) return [{ revision: '9', ...event(4, 'run.transitioned', { to: 'REVIEWING' }) }];
    // The hydration's run statement, by the column only it selects (task and evidence reads JOIN julius_runs too).
    if (sql.includes('AS at_sequence')) {
      return [{
        state: 'REVIEWING', version: '9', mission_id: 'mission:alpha', card_revision: 'card:v3',
        at_sequence: '3', active_tasks: '0', pending_approvals: '0', open_gates: null, observed_at: AT,
      }];
    }
    // Julius's own loadRun, keyed by (run, project) like every read here.
    if (/FROM relay_wonderland\.julius_runs WHERE run_id=\$1 AND project_id=\$2/u.test(sql)) {
      return values[0] === RUN && values[1] === PROJECT
        ? [{ run_id: RUN, mission_id: 'mission:alpha', project_id: PROJECT, state: 'REVIEWING', card_revision: 'card:v3', mission_contract_revision: '1', project_brain_revision: '0', version: '9' }]
        : [];
    }
    if (sql.includes('FROM relay_wonderland.events') && sql.includes('sequence<=$3')) {
      return [event(1, 'run.created', { missionId: 'mission:alpha' }), event(3, 'run.transitioned', { to: 'EXECUTING' })];
    }
    return [];
  };
  const pool = {
    // A query on the POOL is a statement outside any transaction: recorded, and refused.
    query: async (sql: string) => {
      direct.push(sql);
      throw new Error('a statement was sent outside the read-only transaction');
    },
    connect: async () => {
      const connection: Connection = { statements: [], released: null, readOnly: false };
      connections.push(connection);
      return {
        query: async (sql: string, values: readonly unknown[] = []) => {
          connection.statements.push(sql);
          if (options.failOn?.test(sql)) throw Object.assign(new Error('the server went away'), { code: '57P01' });
          if (/^\s*BEGIN\b/iu.test(sql)) {
            connection.readOnly = /\bREAD\s+ONLY\b/iu.test(sql);
            return { rows: [], rowCount: 0 };
          }
          if (/^\s*(?:COMMIT|ROLLBACK)\b/iu.test(sql)) return { rows: [], rowCount: 0 };
          // POSTGRESQL'S OWN RULE, emulated: inside a READ ONLY transaction a write is refused.
          if (connection.readOnly && WRITE.test(sql)) {
            throw Object.assign(new Error('cannot execute INSERT in a read-only transaction'), { code: '25006' });
          }
          const rows = rowsFor(sql, values);
          return { rows, rowCount: rows.length };
        },
        release: (destroy?: boolean | Error) => { connection.released = destroy ? 'destroyed' : 'returned'; },
      };
    },
  };
  return { pool, connections, direct };
}

/**
 * THE AUDIT. Every connection: BEGIN ... READ ONLY first, COMMIT or ROLLBACK last,
 * nothing between but reads, returned to the pool. Nothing on the pool itself.
 */
function auditReadOnly(spy: { readonly connections: readonly Connection[]; readonly direct: readonly string[] }): void {
  expect(spy.direct, 'a statement went to the pool outside any transaction').toEqual([]);
  expect(spy.connections.length, 'no transaction was opened at all').toBeGreaterThan(0);
  for (const connection of spy.connections) {
    const [first, ...rest] = connection.statements;
    expect(first, 'the transaction did not begin READ ONLY').toMatch(/^BEGIN\b[^;]*\bREAD ONLY\b[^;]*$/iu);
    expect(rest.at(-1), 'the transaction did not end').toMatch(/^(?:COMMIT|ROLLBACK)$/u);
    for (const statement of rest.slice(0, -1)) {
      expect(statement, 'a statement that is not a read').toMatch(/^\s*(?:SELECT|WITH)\b/iu);
      expect(WRITE.test(statement), `a write inside the world: ${statement.slice(0, 80)}`).toBe(false);
    }
    expect(connection.released).toBe('returned');
  }
}

function nativeSession(store: BrowserSessionStore): string {
  const grant = store.createGrant({ origin: NATIVE_WORLD_AUDIENCE, now: NOW, scope: 'native_world', participantId: PLAYER, projectId: PROJECT });
  const redeemed = store.consumeGrant({ grantId: grant.grantId, secret: grant.secret, origin: NATIVE_WORLD_AUDIENCE, now: NOW });
  if (!redeemed.ok) throw new Error('fixture could not redeem');
  return redeemed.session.token;
}

const ask = (store: BrowserSessionStore, token: string, route: 'hydrate' | 'events' | 'result', world: ReturnType<typeof wonderlandJuliusWorld>) =>
  handleWonderlandJuliusRoute({
    method: 'GET',
    path: `/wonderland/julius/${route}`,
    url: `/wonderland/julius/${route}?projectId=${PROJECT}&runId=${RUN}&cursor=0${route === 'events' ? '&mode=page' : ''}`,
    authorization: `Relay-Session ${token}`,
    origin: undefined,
    now: NOW,
  }, { sessions: store, world });

describe('every world read runs inside ONE read-only transaction', () => {
  for (const route of ['hydrate', 'events', 'result'] as const) {
    it(`${route}: BEGIN ... READ ONLY, reads only, COMMIT -- through main's real compositions`, async () => {
      const spy = spyPool();
      const store = createBrowserSessionStore();
      const answer = await ask(store, nativeSession(store), route, wonderlandJuliusWorld(spy.pool as never));
      expect(answer?.status, JSON.stringify(answer?.body)).toBe(200);
      // ONE transaction for the whole request: membership and the read share a snapshot.
      expect(spy.connections.length).toBe(1);
      auditReadOnly(spy);
      // And the reads really happened inside it: membership first, then the run.
      expect(spy.connections[0].statements[1]).toContain('project_members');
      expect(spy.connections[0].statements.slice(2).some((statement) => statement.includes('julius_runs'))).toBe(true);
    });
  }

  it('the result read -- Julius\'s own API, the billing walk included -- issues no statement outside the transaction', async () => {
    // The owner's request walks inspectResult, inspectSlots and every timeline page:
    // the widest read a world can cause, and still nothing but SELECTs in one transaction.
    const spy = spyPool();
    const store = createBrowserSessionStore();
    const answer = await ask(store, nativeSession(store), 'result', wonderlandJuliusWorld(spy.pool as never));
    expect((answer?.body as { data: { cost: { visible: boolean } } }).data.cost.visible).toBe(true);
    auditReadOnly(spy);
    expect(spy.connections[0].statements.filter((statement) => statement.includes('FROM relay_wonderland.events')).length).toBeGreaterThan(1);
  });

  it('a refused request opens no transaction at all', async () => {
    const spy = spyPool();
    const store = createBrowserSessionStore();
    const anonymous = await handleWonderlandJuliusRoute({
      method: 'GET', path: '/wonderland/julius/hydrate', url: `/wonderland/julius/hydrate?projectId=${PROJECT}&runId=${RUN}`,
      authorization: undefined, origin: undefined, now: NOW,
    }, { sessions: store, world: wonderlandJuliusWorld(spy.pool as never) });
    expect(anonymous?.status).toBe(401);
    expect(spy.connections).toEqual([]);
    expect(spy.direct).toEqual([]);
  });

  it('a non-member\'s request is refused INSIDE the read-only transaction, and reads no run', async () => {
    const spy = spyPool({ member: false });
    const store = createBrowserSessionStore();
    const answer = await ask(store, nativeSession(store), 'hydrate', wonderlandJuliusWorld(spy.pool as never));
    expect(answer?.status).toBe(404);
    auditReadOnly(spy);
    expect(spy.connections[0].statements).toEqual([WONDERLAND_JULIUS_READ_ONLY_BEGIN, expect.stringContaining('project_members'), 'COMMIT']);
  });
});

describe('a write cannot happen, by two independent locks', () => {
  it('the facade refuses a statement that is not a read BEFORE it is sent, and rolls back', async () => {
    const spy = spyPool();
    await expect(withWonderlandJuliusReadOnlyTransaction(spy.pool as never, (db) => db.query('INSERT INTO relay_wonderland.players(player_id) VALUES($1)', ['x'])))
      .rejects.toThrow(/not a read/u);
    expect(spy.connections[0].statements).toEqual([WONDERLAND_JULIUS_READ_ONLY_BEGIN, 'ROLLBACK']);
    expect(spy.connections[0].released).toBe('returned');
  });

  it('a write disguised as a read (a data-modifying WITH) is refused by the server: 25006, and the route says 503', async () => {
    const spy = spyPool();
    await expect(withWonderlandJuliusReadOnlyTransaction(spy.pool as never,
      (db) => db.query('WITH gone AS (DELETE FROM relay_wonderland.players RETURNING 1) SELECT count(*) FROM gone')))
      .rejects.toMatchObject({ code: '25006' });
    expect(spy.connections[0].statements.at(-1)).toBe('ROLLBACK');

    // Through the route: a reader that tried to write is an unavailable store, never a 200 and never a leak.
    const store = createBrowserSessionStore();
    const lines: string[] = [];
    const answer = await handleWonderlandJuliusRoute({
      method: 'GET', path: '/wonderland/julius/hydrate', url: `/wonderland/julius/hydrate?projectId=${PROJECT}&runId=${RUN}`,
      authorization: `Relay-Session ${nativeSession(store)}`, origin: undefined, now: NOW,
    }, {
      sessions: store,
      log: (line) => lines.push(line),
      world: {
        read: (work) => withWonderlandJuliusReadOnlyTransaction(spy.pool as never, (db) => work({
          membership: { lookup: async ({ playerId, projectId }) => ({ playerId, projectId, role: 'OWNER' }) },
          reader: {
            hydrate: async () => { await db.query('WITH gone AS (UPDATE relay_wonderland.julius_runs SET version=0 RETURNING 1) SELECT 1'); return null; },
            events: async () => null,
          },
          results: { result: async () => null },
        })),
      },
    });
    expect(answer).toEqual({ status: 503, body: { error: WONDERLAND_UNAVAILABLE_MESSAGE } });
    expect(lines.join('\n')).toContain('sqlstate=25006');
  });

  it('the facade has nothing but query: no second connection can be opened outside the transaction', async () => {
    const spy = spyPool();
    const shape = await wonderlandJuliusWorld(spy.pool as never).read(async (scope) => {
      const facade = (scope.membership as unknown as { pool: Record<string, unknown> }).pool;
      return { keys: Object.keys(facade), connect: typeof facade.connect };
    });
    expect(shape).toEqual({ keys: ['query'], connect: 'undefined' });
    expect(spy.connections.length).toBe(1);
  });

  it('CONTROL -- the audit catches a transaction that did not begin READ ONLY (the mutant this suite exists for)', () => {
    // The mutation: WONDERLAND_JULIUS_READ_ONLY_BEGIN without READ ONLY. The
    // audit reads the statement the pool RECEIVED, not the constant, so it is
    // caught however the constant is spelt.
    const mutant = { connections: [{ statements: ['BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ', 'SELECT 1', 'COMMIT'], released: 'returned' as const, readOnly: false }], direct: [] };
    expect(() => auditReadOnly(mutant)).toThrow(/READ ONLY/u);
    const readWrite = { connections: [{ statements: ['BEGIN READ WRITE', 'SELECT 1', 'COMMIT'], released: 'returned' as const, readOnly: false }], direct: [] };
    expect(() => auditReadOnly(readWrite)).toThrow();
    const writes = { connections: [{ statements: [WONDERLAND_JULIUS_READ_ONLY_BEGIN, 'UPDATE relay_wonderland.julius_runs SET version=1', 'COMMIT'], released: 'returned' as const, readOnly: true }], direct: [] };
    expect(() => auditReadOnly(writes)).toThrow();
    const outside = { connections: [{ statements: [WONDERLAND_JULIUS_READ_ONLY_BEGIN, 'COMMIT'], released: 'returned' as const, readOnly: true }], direct: ['SELECT 1'] };
    expect(() => auditReadOnly(outside)).toThrow();
  });

  it('the BEGIN is REPEATABLE READ, READ ONLY -- one snapshot, never SERIALIZABLE (no predicate locks on a writer)', () => {
    expect(WONDERLAND_JULIUS_READ_ONLY_BEGIN).toBe('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
  });
});

describe('a connection in an unknown state is never handed back to the pool', () => {
  it('a failed BEGIN destroys the connection', async () => {
    const spy = spyPool({ failOn: /^BEGIN/u });
    await expect(withWonderlandJuliusReadOnlyTransaction(spy.pool as never, async () => 1)).rejects.toMatchObject({ code: '57P01' });
    expect(spy.connections[0].released).toBe('destroyed');
  });

  it('a failed COMMIT destroys the connection', async () => {
    const spy = spyPool({ failOn: /^COMMIT$/u });
    await expect(withWonderlandJuliusReadOnlyTransaction(spy.pool as never, async () => 1)).rejects.toMatchObject({ code: '57P01' });
    expect(spy.connections[0].released).toBe('destroyed');
  });

  it('a failed read rolls back and RETURNS the connection; a failed rollback destroys it', async () => {
    const rolledBack = spyPool();
    await expect(withWonderlandJuliusReadOnlyTransaction(rolledBack.pool as never, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(rolledBack.connections[0].statements).toEqual([WONDERLAND_JULIUS_READ_ONLY_BEGIN, 'ROLLBACK']);
    expect(rolledBack.connections[0].released).toBe('returned');
    const unrolled = spyPool({ failOn: /^ROLLBACK$/u });
    await expect(withWonderlandJuliusReadOnlyTransaction(unrolled.pool as never, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(unrolled.connections[0].released).toBe('destroyed');
  });
});
