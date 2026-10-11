import { Client } from 'pg';
import { describe, expect, it } from 'vitest';

import {
  WONDERLAND_JULIUS_READ_ONLY_BEGIN,
  WONDERLAND_JULIUS_WORLD_CONNECT_TIMEOUT_MS,
  WONDERLAND_JULIUS_WORLD_IDLE_IN_TRANSACTION_TIMEOUT_MS,
  WONDERLAND_JULIUS_WORLD_POOL_MAX,
  WONDERLAND_JULIUS_WORLD_SESSION_OPTIONS,
  WONDERLAND_JULIUS_WORLD_STATEMENT_TIMEOUT_MS,
  createWonderlandJuliusWorldPool,
  withWonderlandJuliusReadOnlyTransaction,
  wonderlandJuliusWorld,
  wonderlandJuliusWorldPoolConfig,
} from './wonderland-julius-world';
import type { WonderlandJuliusReadOnlyQueryable } from './wonderland-julius-world';
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
 * audits them. The spy pool also behaves the way PostgreSQL does:
 *   - inside a transaction begun READ ONLY, a write is refused with SQLSTATE 25006;
 *   - the SIMPLE protocol runs every command a text holds, in order; the EXTENDED
 *     protocol carries exactly one and refuses a text with more (42601).
 * The real-PostgreSQL half (that the exact BEGIN text, the world pool's session
 * default and the extended protocol make a real server refuse) is in
 * wonderland-julius-create-observe.real-postgres.test.ts.
 *
 * Since the internal review (M1+M2): the facade sends every statement on the
 * extended protocol, is closed before COMMIT/ROLLBACK, and destroys its
 * connection whenever the work rejects; and the world has its own bounded,
 * read-only-by-default pool.
 */

const NOW = 1_790_000_000_000;
const PLAYER = 'ghu-424242';
const PROJECT = 'project-alpha';
const RUN = 'run:0a1b2c';
const AT = '2026-10-07T12:00:00.000Z';

/** A statement that changes something, or locks a row for changing. Never a world read. */
const WRITE = /\b(?:INSERT|UPDATE|DELETE|MERGE|TRUNCATE|CREATE|ALTER|DROP|GRANT|REVOKE)\b|\bFOR\s+(?:NO\s+KEY\s+)?(?:UPDATE|SHARE|KEY\s+SHARE)\b/iu;
/** The transaction's own control statements, which the wrapper sends on the simple protocol. */
const CONTROL_STATEMENT = /^\s*(?:BEGIN|COMMIT|ROLLBACK)\b/iu;

interface Connection {
  /** Every COMMAND the emulated server executed, in order. */
  readonly statements: string[];
  /** Every message the client sent, and whether it went on the extended protocol. */
  readonly sent: Array<{ readonly text: string; readonly extended: boolean }>;
  released: 'returned' | 'destroyed' | null;
  readOnly: boolean;
}

/** The commands in one query text, split where PostgreSQL splits them: at a `;` outside a comment or a quoted string. */
function commandsOf(text: string): string[] {
  const commands: string[] = [];
  let start = 0;
  let at = 0;
  while (at < text.length) {
    const c = text[at];
    if (c === '-' && text[at + 1] === '-') {
      const end = text.indexOf('\n', at);
      at = end === -1 ? text.length : end;
    } else if (c === '/' && text[at + 1] === '*') {
      const end = text.indexOf('*/', at + 2);
      at = end === -1 ? text.length : end + 2;
    } else if (c === '\'' || c === '"') {
      const end = text.indexOf(c, at + 1);
      at = end === -1 ? text.length : end + 1;
    } else {
      if (c === ';') {
        commands.push(text.slice(start, at));
        start = at + 1;
      }
      at += 1;
    }
  }
  commands.push(text.slice(start));
  return commands.map((command) => command.trim()).filter((command) => command !== '');
}

type QueryInput = string | { readonly text: string; readonly values?: readonly unknown[]; readonly queryMode?: string };

/**
 * A pool that records everything and answers like PostgreSQL would: rows by the
 * statement's table; inside a transaction begun READ ONLY, SQLSTATE 25006 for
 * anything that writes; and the two protocols' rule for a text holding several
 * commands -- the simple one runs them all, the extended one refuses (42601).
 * `pg` picks the extended protocol when asked (`queryMode`) or when values are bound.
 */
function spyPool(options: { readonly member?: boolean; readonly failOn?: RegExp; readonly runProject?: string | null } = {}) {
  const connections: Connection[] = [];
  const direct: string[] = [];
  // Where the run lives: PROJECT by default, another project for a foreign run, nowhere (null) for an absent one.
  const runProject = options.runProject === undefined ? PROJECT : options.runProject;
  const event = (sequence: number, type: string, payload: Record<string, unknown>) => ({
    event_id: `event-${sequence}`, stream_id: RUN, project_id: PROJECT, sequence: String(sequence),
    event_type: `julius.${type}`, occurred_at: AT,
    payload: { schemaVersion: 'relay-julius-event.v1', eventId: `event-${sequence}`, streamId: RUN, projectId: PROJECT, occurredAt: AT, payload: { runId: RUN, ...payload } },
  });
  const rowsFor = (sql: string, values: readonly unknown[]): readonly Record<string, unknown>[] => {
    if (sql.includes('project_members')) return options.member === false ? [] : [{ role: 'OWNER' }];
    // Every run-scoped read below is keyed (run, project), as the SQL keys it: a run is found only where it lives.
    const here = values[0] === RUN && values[1] === runProject;
    if (sql.includes('julius_context_snapshots')) return [];
    if (sql.includes('LEFT JOIN LATERAL')) return here ? [{ revision: '9', ...event(4, 'run.transitioned', { to: 'REVIEWING' }) }] : [];
    // The hydration's run statement, by the column only it selects (task and evidence reads JOIN julius_runs too).
    if (sql.includes('AS at_sequence')) {
      return here ? [{
        state: 'REVIEWING', version: '9', mission_id: 'mission:alpha', card_revision: 'card:v3',
        at_sequence: '3', active_tasks: '0', pending_approvals: '0', open_gates: null, observed_at: AT,
      }] : [];
    }
    // Julius's own loadRun, keyed by (run, project) like every read here.
    if (/FROM relay_wonderland\.julius_runs WHERE run_id=\$1 AND project_id=\$2/u.test(sql)) {
      return here
        ? [{ run_id: RUN, mission_id: 'mission:alpha', project_id: PROJECT, state: 'REVIEWING', card_revision: 'card:v3', mission_contract_revision: '1', project_brain_revision: '0', version: '9' }]
        : [];
    }
    if (sql.includes('FROM relay_wonderland.events') && sql.includes('sequence<=$3')) {
      return here ? [event(1, 'run.created', { missionId: 'mission:alpha' }), event(3, 'run.transitioned', { to: 'EXECUTING' })] : [];
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
      const connection: Connection = { statements: [], sent: [], released: null, readOnly: false };
      connections.push(connection);
      const execute = (command: string, values: readonly unknown[]) => {
        connection.statements.push(command);
        if (/^BEGIN\b/iu.test(command)) {
          connection.readOnly = /\bREAD\s+ONLY\b/iu.test(command);
          return { rows: [], rowCount: 0 };
        }
        if (/^(?:COMMIT|ROLLBACK)\b/iu.test(command)) {
          connection.readOnly = false;
          return { rows: [], rowCount: 0 };
        }
        // POSTGRESQL'S OWN RULE, emulated: inside a READ ONLY transaction a write is refused.
        if (connection.readOnly && WRITE.test(command)) {
          throw Object.assign(new Error('cannot execute UPDATE in a read-only transaction'), { code: '25006' });
        }
        const rows = rowsFor(command, values);
        return { rows, rowCount: rows.length };
      };
      return {
        query: async (input: QueryInput, positional: readonly unknown[] = []) => {
          const text = typeof input === 'string' ? input : input.text;
          const values = typeof input === 'string' ? positional : (input.values ?? []);
          const extended = (typeof input !== 'string' && input.queryMode === 'extended') || values.length > 0;
          connection.sent.push({ text, extended });
          if (options.failOn?.test(text)) throw Object.assign(new Error('the server went away'), { code: '57P01' });
          const commands = commandsOf(text);
          // THE EXTENDED PROTOCOL'S RULE, emulated: one Parse message, one command.
          if (extended && commands.length > 1) {
            throw Object.assign(new Error('cannot insert multiple commands into a prepared statement'), { code: '42601' });
          }
          // THE SIMPLE PROTOCOL'S, emulated: every command in the text runs, in order.
          let last: { rows: readonly Record<string, unknown>[]; rowCount: number } = { rows: [], rowCount: 0 };
          for (const command of commands) last = execute(command, values);
          return last;
        },
        release: (destroy?: boolean | Error) => { connection.released = destroy ? 'destroyed' : 'returned'; },
      };
    },
  };
  return { pool, connections, direct };
}

/**
 * THE AUDIT. Every connection: BEGIN ... READ ONLY first, COMMIT or ROLLBACK last,
 * nothing between but reads, each read sent on the EXTENDED protocol, the
 * connection returned to the pool. Nothing on the pool itself.
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
    for (const message of connection.sent.filter((sent) => !CONTROL_STATEMENT.test(sent.text))) {
      expect(message.extended, `a read sent on the simple protocol: ${message.text.slice(0, 80)}`).toBe(true);
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
    it(`${route}: BEGIN ... READ ONLY, reads only (each on the extended protocol), COMMIT -- through main's real compositions`, async () => {
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

describe('a write cannot happen, by independent locks', () => {
  it('the facade refuses a statement that is not a read BEFORE it is sent, rolls back, and destroys the connection', async () => {
    const spy = spyPool();
    await expect(withWonderlandJuliusReadOnlyTransaction(spy.pool as never, (db) => db.query('INSERT INTO relay_wonderland.players(player_id) VALUES($1)', ['x'])))
      .rejects.toThrow(/not a read/u);
    expect(spy.connections[0].statements).toEqual([WONDERLAND_JULIUS_READ_ONLY_BEGIN, 'ROLLBACK']);
    expect(spy.connections[0].released).toBe('destroyed');
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

  it('a SMUGGLED `SELECT 1; COMMIT; UPDATE ...` is refused: the facade speaks the extended protocol, one command per statement (review M1)', async () => {
    const smuggled = 'SELECT 1; COMMIT; UPDATE relay_wonderland.julius_runs SET version=0';
    const spy = spyPool();
    await expect(withWonderlandJuliusReadOnlyTransaction(spy.pool as never, (db) => db.query(smuggled)))
      .rejects.toMatchObject({ code: '42601' });
    // Nothing of it ran: no COMMIT inside the transaction, no UPDATE after it.
    expect(spy.connections[0].statements).toEqual([WONDERLAND_JULIUS_READ_ONLY_BEGIN, 'ROLLBACK']);
    expect(spy.connections[0].sent.find((message) => message.text === smuggled)?.extended).toBe(true);
    expect(spy.connections[0].released).toBe('destroyed');
  });

  it('CONTROL -- on the SIMPLE protocol the same text ends the transaction and writes outside it, so the emulation can fail', async () => {
    // The first-word check alone would have let it through: it starts with SELECT.
    const control = spyPool();
    const client = await (control.pool as unknown as { connect(): Promise<{ query(text: string): Promise<unknown> }> }).connect();
    await client.query(WONDERLAND_JULIUS_READ_ONLY_BEGIN);
    await client.query('SELECT 1; COMMIT; UPDATE relay_wonderland.julius_runs SET version=0');
    expect(control.connections[0].statements).toEqual([
      WONDERLAND_JULIUS_READ_ONLY_BEGIN, 'SELECT 1', 'COMMIT', 'UPDATE relay_wonderland.julius_runs SET version=0',
    ]);
    expect(() => auditReadOnly(control)).toThrow();
  });

  it('a call after COMMIT is refused, and nothing is sent', async () => {
    const spy = spyPool();
    let kept: WonderlandJuliusReadOnlyQueryable | null = null;
    await withWonderlandJuliusReadOnlyTransaction(spy.pool as never, async (db) => { kept = db; return db.query('SELECT 1'); });
    const sentBefore = spy.connections[0].sent.length;
    await expect((kept as unknown as WonderlandJuliusReadOnlyQueryable).query('SELECT 2')).rejects.toThrow(/after its transaction ended/u);
    expect(spy.connections[0].sent.length).toBe(sentBefore);
    expect(spy.connections[0].statements).toEqual([WONDERLAND_JULIUS_READ_ONLY_BEGIN, 'SELECT 1', 'COMMIT']);
  });

  it('a call after ROLLBACK is refused too -- a straggler from a failed Promise.all sends nothing after it', async () => {
    // inspectResult reads in a Promise.all: one branch failing must not let its sibling's NEXT statement reach a
    // connection whose transaction already ended (and which, before the review, went back to the pool).
    const spy = spyPool();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let straggler: Promise<unknown> = Promise.resolve();
    await expect(withWonderlandJuliusReadOnlyTransaction(spy.pool as never, (db) => {
      straggler = (async () => { await gate; return db.query('SELECT 2'); })();
      return Promise.all([Promise.reject(new Error('a sibling failed')), straggler]);
    })).rejects.toThrow('a sibling failed');
    release();
    await expect(straggler).rejects.toThrow(/after its transaction ended/u);
    expect(spy.connections[0].statements).toEqual([WONDERLAND_JULIUS_READ_ONLY_BEGIN, 'ROLLBACK']);
    expect(spy.connections[0].released).toBe('destroyed');
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
    const of = (statements: string[], extended = true) => ({
      statements, sent: statements.map((text) => ({ text, extended: extended && !CONTROL_STATEMENT.test(text) })),
      released: 'returned' as const, readOnly: false,
    });
    const mutant = { connections: [of(['BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ', 'SELECT 1', 'COMMIT'])], direct: [] };
    expect(() => auditReadOnly(mutant)).toThrow(/READ ONLY/u);
    const readWrite = { connections: [of(['BEGIN READ WRITE', 'SELECT 1', 'COMMIT'])], direct: [] };
    expect(() => auditReadOnly(readWrite)).toThrow();
    const writes = { connections: [of([WONDERLAND_JULIUS_READ_ONLY_BEGIN, 'UPDATE relay_wonderland.julius_runs SET version=1', 'COMMIT'])], direct: [] };
    expect(() => auditReadOnly(writes)).toThrow();
    const outside = { connections: [of([WONDERLAND_JULIUS_READ_ONLY_BEGIN, 'COMMIT'])], direct: ['SELECT 1'] };
    expect(() => auditReadOnly(outside)).toThrow();
    const simple = { connections: [of([WONDERLAND_JULIUS_READ_ONLY_BEGIN, 'SELECT 1', 'COMMIT'], false)], direct: [] };
    expect(() => auditReadOnly(simple)).toThrow(/simple protocol/u);
    // CONTROL of the control: the clean shape passes.
    expect(() => auditReadOnly({ connections: [of([WONDERLAND_JULIUS_READ_ONLY_BEGIN, 'SELECT 1', 'COMMIT'])], direct: [] })).not.toThrow();
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

  it('a REJECTING work rolls back and DESTROYS its connection, whether or not the rollback answers (review M1)', async () => {
    const rolledBack = spyPool();
    await expect(withWonderlandJuliusReadOnlyTransaction(rolledBack.pool as never, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(rolledBack.connections[0].statements).toEqual([WONDERLAND_JULIUS_READ_ONLY_BEGIN, 'ROLLBACK']);
    expect(rolledBack.connections[0].released).toBe('destroyed');
    const unrolled = spyPool({ failOn: /^ROLLBACK$/u });
    await expect(withWonderlandJuliusReadOnlyTransaction(unrolled.pool as never, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(unrolled.connections[0].released).toBe('destroyed');
  });

  it('CONTROL: a work that resolves COMMITs and RETURNS its connection', async () => {
    const spy = spyPool();
    expect(await withWonderlandJuliusReadOnlyTransaction(spy.pool as never, async () => 'done')).toBe('done');
    expect(spy.connections[0].statements).toEqual([WONDERLAND_JULIUS_READ_ONLY_BEGIN, 'COMMIT']);
    expect(spy.connections[0].released).toBe('returned');
  });
});

describe('the world\'s own pool: bounded, and read-only before any BEGIN (review M1+M2)', () => {
  const HARMLESS = 'postgres://world@127.0.0.1:9/never';
  type StartupConf = Record<string, string>;
  const startupOf = (config: object): StartupConf => (new Client(config) as unknown as { getStartupConf(): StartupConf }).getStartupConf();

  it('the pool\'s options are as stated: max 4, read-only sessions, statement and idle-in-transaction timeouts, a connect bound', async () => {
    const pool = createWonderlandJuliusWorldPool(HARMLESS);
    expect(pool).not.toBeNull();
    try {
      expect(pool?.options).toMatchObject({
        connectionString: HARMLESS,
        max: 4,
        options: '-c default_transaction_read_only=on',
        statement_timeout: 5_000,
        idle_in_transaction_session_timeout: 10_000,
        connectionTimeoutMillis: 5_000,
      });
      expect([WONDERLAND_JULIUS_WORLD_POOL_MAX, WONDERLAND_JULIUS_WORLD_SESSION_OPTIONS, WONDERLAND_JULIUS_WORLD_STATEMENT_TIMEOUT_MS,
        WONDERLAND_JULIUS_WORLD_IDLE_IN_TRANSACTION_TIMEOUT_MS, WONDERLAND_JULIUS_WORLD_CONNECT_TIMEOUT_MS])
        .toEqual([4, '-c default_transaction_read_only=on', 5_000, 10_000, 5_000]);
      // WHAT THE SERVER IS TOLD: the startup message a connection of this pool would send (pg 8.23 Client#getStartupConf).
      expect(startupOf(pool?.options as object)).toMatchObject({
        options: '-c default_transaction_read_only=on', statement_timeout: '5000', idle_in_transaction_session_timeout: '10000',
      });
    } finally {
      await pool?.end();
    }
  });

  it('no database is no pool', () => {
    expect(createWonderlandJuliusWorldPool(null)).toBeNull();
  });

  it('a URL that would REPLACE a fixed setting is refused, by key, never by value -- pg lets the URL win', () => {
    for (const [query, key] of [
      ['options=-c%20default_transaction_read_only%3Doff', 'options'],
      ['statement_timeout=0', 'statement_timeout'],
      ['idle_in_transaction_session_timeout=0', 'idle_in_transaction_session_timeout'],
    ] as const) {
      const lines: string[] = [];
      expect(createWonderlandJuliusWorldPool(`${HARMLESS}?${query}`, (line) => lines.push(line)), key).toBeNull();
      expect(lines).toEqual([`julius world pool refused: the database URL sets ${key}, which would replace the world's read-only session settings`]);
    }
    // CONTROL: why the refusal exists. Built anyway, pg sends the URL's options instead of the pool's.
    expect(startupOf(wonderlandJuliusWorldPoolConfig(`${HARMLESS}?options=-c%20default_transaction_read_only%3Doff`)).options)
      .toBe('-c default_transaction_read_only=off');
  });

  it('CONTROL: a URL with other parameters (sslmode) still gets its pool, with the settings intact', async () => {
    const pool = createWonderlandJuliusWorldPool(`${HARMLESS}?sslmode=disable`);
    expect(pool).not.toBeNull();
    try {
      expect(startupOf(pool?.options as object).options).toBe('-c default_transaction_read_only=on');
    } finally {
      await pool?.end();
    }
  });
});
