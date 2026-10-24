import { EventEmitter } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { Pool } from 'pg';
import { afterEach, describe, expect, it } from 'vitest';

import { openWfsPostgresStore, WFS_HELD_CONNECTION_LOST } from '../src/relay/persistence/wonderfs-postgres';
import type { WfsPrincipal } from '../src/relay/wonderfs/wonderfs-contracts';
import { WFS_MAIN_BRANCH } from '../src/relay/wonderfs/wonderfs-engine';
import type { RelayResult } from '../src/relay/protocol/errors';
import { createBrowserSessionStore } from './browser-session/grants';
import { createWonderfsMount } from './wonderfs-routes';

/**
 * R2-r4 (MAIN's product check after CI r1.16): A DATABASE CONNECTION LOST WHILE THE WONDERFS STORE HOLDS IT DOES NOT CRASH THE BRIDGE.
 * pg-pool hears a client's 'error' only while the client is idle in it (it takes its listener off at checkout and puts it back at
 * release); the bridge's pool listens for idle clients (server.ts juliusPool). A backend ended mid-transaction -- a restart or
 * failover, 57P01 / 57P02 / 57P03 -- is emitted on the CHECKED-OUT client when its socket ends: unheard, node throws it from the
 * socket's callback, an uncaught exception that takes the process down. The fake below keeps pg's order for that loss: the
 * statement in flight rejects with the server's FATAL; the socket's end then arrives on its own turn of the event loop, rejects
 * what was queued after it (the ROLLBACK) and emits 'error' on the client. An 'error' nobody hears is RECORDED as `unheard`
 * (the CONTROL shows node would throw it) so this file can count what would have crashed the bridge without crashing itself.
 *
 * R2-r5 K7: EVERY acquisition is a checkout now -- the protected-store guard's identity reads and the gate's membership lookup too (each
 * a bounded READ ONLY transaction) -- so a store's first call takes a client per guard read before its own. The loss is planted on ONE
 * statement; the case finds THE client that ran it, and holds every other client to a clean, single release.
 */

const NOW = '2026-10-13T02:00:00.000Z';
const P = 'prj-1';
const FATAL = (): Error => Object.assign(new Error('terminating connection due to administrator command'), { code: '57P01', severity: 'FATAL' });
const human = (id: string): WfsPrincipal => ({ kind: 'human', id, onBehalfOf: null, grantId: null, sessionId: null, clientBuild: null, tool: null, missionId: null, attemptId: null } as unknown as WfsPrincipal);

class FakeClient extends EventEmitter {
  readonly statements: string[] = [];
  readonly released: Array<Error | boolean | undefined> = [];
  private ended: Promise<never> | null = null;

  constructor(private readonly world: FakeWorld, private readonly diesAt: (sql: string) => boolean) {
    super();
  }

  async query(text: unknown): Promise<{ rows: unknown[]; rowCount: number }> {
    const sql = typeof text === 'string' ? text : String((text as { text?: unknown }).text ?? '');
    this.statements.push(sql);
    if (this.ended !== null) return this.ended; // queued behind the dead statement: answered only by the socket's end
    if (this.diesAt(sql)) {
      let refuse: (error: Error) => void = () => undefined;
      this.ended = new Promise<never>((_, reject) => { refuse = reject; });
      this.ended.catch(() => undefined);
      setImmediate(() => {
        // pg Client on the socket's 'end': every queued statement refused, then 'error' on the client (and a write to the dead
        // socket can report a second one)
        const terminated = new Error('Connection terminated unexpectedly');
        refuse(terminated);
        this.deliver(terminated);
        this.deliver(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
      });
      throw FATAL();
    }
    return this.world.answer(sql);
  }

  private deliver(error: Error): void {
    if (this.listenerCount('error') === 0) this.world.unheard.push(error.message);
    else this.emit('error', error);
  }

  /** pg-pool's release: its idle listener goes back on; an error (or a dead client) means the pool discards the client. */
  release(error?: Error | boolean): void {
    this.released.push(error);
    this.on('error', this.world.poolHeard);
  }
}

class FakeWorld {
  readonly unheard: string[] = [];
  readonly heardByPool: string[] = [];
  readonly clients: FakeClient[] = [];
  readonly poolHeard = (error: Error): void => { this.heardByPool.push(error.message); };

  constructor(private readonly diesAt: (sql: string) => boolean = () => false) {}

  answer(sql: string): { rows: unknown[]; rowCount: number } {
    // the protected-store guard's identity reads: an ordinary Wonderland database
    if (sql.includes('shobj_description')) return { rows: [{ c: null }], rowCount: 1 };
    if (sql === 'SELECT current_database() AS db') return { rows: [{ db: 'wonderland' }], rowCount: 1 };
    if (sql.includes('pg_control_system()')) return { rows: [{ sid: '7000000000000000001' }], rowCount: 1 };
    if (sql.startsWith('SELECT role FROM relay_wonderland.project_members')) return { rows: [{ role: 'OWNER' }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  }

  readonly pool = {
    query: async (sql: string) => this.answer(sql),
    // pg-pool's checkout: the client comes out with no pool listener on it
    connect: async () => {
      const client = new FakeClient(this, this.diesAt);
      this.clients.push(client);
      return client;
    },
  };

  get asPool(): Pool {
    return this.pool as unknown as Pool;
  }
}

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => {
    s.closeAllConnections();
    s.close(() => r());
  })));
});

const OUTAGE = { code: 'stale-ledger-version', retryable: true };
const outcome = (r: RelayResult<unknown>) => (r.ok ? 'ok' : { code: r.error.code, retryable: r.error.retryable });

describe('WonderFS store: a connection lost while held (R2-r4)', () => {
  it('CONTROL: a checked-out client nobody listens on (the r3 store: pool.connect() and no listener) -- its socket\'s end is UNHEARD, which node throws', async () => {
    expect(() => new EventEmitter().emit('error', new Error('Connection terminated unexpectedly'))).toThrow('Connection terminated unexpectedly');
    const world = new FakeWorld((sql) => sql === 'SELECT doomed');
    const client = await world.pool.connect();
    await client.query('BEGIN');
    await expect(client.query('SELECT doomed')).rejects.toMatchObject({ code: '57P01' });
    await expect(client.query('ROLLBACK')).rejects.toThrow('Connection terminated unexpectedly');
    client.release();
    expect(world.unheard).toEqual(['Connection terminated unexpectedly', 'write EPIPE']);
  });

  const sites: Array<[string, string, (store: ReturnType<typeof openWfsPostgresStore>) => Promise<RelayResult<unknown>>]> = [
    ['createProject', 'INSERT INTO relay_wonderland.wfs_projects', (s) => s.createProject(P, NOW)],
    ['tree (a snapshot read)', 'SELECT b.head_rev', (s) => s.tree(P, { branchId: WFS_MAIN_BRANCH })],
    ['commit (a mutation)', 'SELECT next_event_seq::text AS next_event_seq FROM relay_wonderland.wfs_projects', (s) => s.commit(P, { requestId: 'req-held-1', branchId: WFS_MAIN_BRANCH, baseRev: 0, principal: human('ghu-1'), ops: [{ op: 'create', path: 'd', kind: 'dir' }] }, NOW)],
    ['putBlob (an upload)', 'SELECT 1 FROM relay_wonderland.wfs_projects', (s) => s.putBlob(P, new Uint8Array([1, 2, 3]))],
  ];
  it.each(sites)('%s: the loss is HEARD -- nothing unheard, ONE fixed log line, the retryable outage, the client released WITH the error so the pool discards it, and the store\'s listener taken off', async (_name, dying, run) => {
    const world = new FakeWorld((sql) => sql.startsWith(dying));
    const logs: string[] = [];
    const store = openWfsPostgresStore(world.asPool, { log: (line) => logs.push(line) });
    expect(outcome(await run(store))).toEqual(OUTAGE);
    expect(world.unheard, 'nothing would have crashed the bridge').toEqual([]);
    expect(logs).toEqual([WFS_HELD_CONNECTION_LOST]);
    const lostOnes = world.clients.filter((c) => c.statements.some((s) => s.startsWith(dying)));
    expect(lostOnes, 'the planted loss fired on exactly one client').toHaveLength(1);
    const [client] = lostOnes;
    expect(client.released).toHaveLength(1);
    expect(client.released[0], 'released WITH the first error heard').toMatchObject({ message: 'Connection terminated unexpectedly' });
    for (const c of world.clients) {
      expect(c.released, 'every client released exactly once').toHaveLength(1);
      if (c !== client) expect(c.released[0], 'a healthy client goes back with no error').toBeUndefined();
      expect(c.listeners('error'), 'only the pool\'s own listener is left on it').toEqual([world.poolHeard]);
    }
  });

  it('CONTROL: a healthy client is released with NO error (the pool keeps it), nothing is logged, and the answer is the store\'s own', async () => {
    const world = new FakeWorld();
    const logs: string[] = [];
    const store = openWfsPostgresStore(world.asPool, { log: (line) => logs.push(line) });
    const r = await store.tree('prj-nowhere', { branchId: WFS_MAIN_BRANCH });
    expect(r.ok ? 'ok' : r.error.code).toBe('not-found');
    expect([logs, world.unheard]).toEqual([[], []]);
    expect(world.clients.length, 'the guard\'s reads, then the tree\'s snapshot (K7: each its own checkout)').toBeGreaterThanOrEqual(2);
    expect(world.clients.map((c) => c.released), 'each released once, with no error').toEqual(world.clients.map(() => [undefined]));
    for (const c of world.clients) expect(c.listeners('error')).toEqual([world.poolHeard]);
  });

  it('THE BRIDGE\'S MOUNT (createWonderfsMount, as server.ts builds it): a signed-in read whose held connection dies answers 503 wonderfs_unavailable, the line reaches the mount\'s log, and the process is still serving', async () => {
    const world = new FakeWorld((sql) => sql.startsWith('SELECT b.head_rev'));
    const logs: string[] = [];
    const sessions = createBrowserSessionStore();
    const minted = sessions.mintNativeSocialSession({ now: Date.now(), participantId: 'ghu-1' });
    if (!minted.ok) throw new Error('not minted');
    const mount = createWonderfsMount({ sessions, pool: () => world.asPool, log: (line) => logs.push(line) });
    const server = createServer((req, res) => { void mount.serve(req, res, {}); });
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const address = server.address();
    const base = `http://127.0.0.1:${typeof address === 'object' && address !== null ? address.port : 0}`;
    const ask = async () => {
      const response = await fetch(`${base}/wonderfs/v1/projects/${P}/branches/main/tree`, { headers: { authorization: `Relay-Session ${minted.session.token}` } });
      const json = (await response.json()) as { error?: { kind?: string } };
      return [response.status, json.error?.kind];
    };
    expect(await ask()).toEqual([503, 'wonderfs_unavailable']);
    expect(await ask(), 'still serving: a second request, a second client lost, a second 503').toEqual([503, 'wonderfs_unavailable']);
    expect(world.unheard).toEqual([]);
    expect(logs.filter((l) => l === WFS_HELD_CONNECTION_LOST)).toHaveLength(2);
    expect(world.clients.filter((c) => c.statements.some((s) => s.startsWith('SELECT b.head_rev'))), 'two reads, two lost clients').toHaveLength(2);
    expect(world.clients.every((c) => c.released.length === 1), 'every client (the guard\'s, the gate\'s, the reads\') released exactly once').toBe(true);
  });
});
