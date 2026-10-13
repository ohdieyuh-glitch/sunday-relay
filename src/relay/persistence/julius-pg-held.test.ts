import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSync } from 'esbuild';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * A JULIUS STORE'S HELD CONNECTION THAT DIES MUST NOT TAKE THE PROCESS DOWN (WONDERLAND_DEV's finding on the Julius
 * stores, mailbox M20261013T141845Z-WONDERLAND_DEV-7f8abe, 2026-10-13).
 *
 * node-postgres emits `error` on a client whose backend goes away (a PostgreSQL restart, a terminated backend: 57P01).
 * pg-pool listens only while the client is IDLE; while a store HOLDS it, nobody does, and the emit is an uncaught
 * exception: the bridge exits, or a paid arm's entrypoint dies without its RESULT line and its learning record.
 *
 * WHAT IS REAL here: the stores' own code, a real `pg.Pool` (pg-pool 3, the one the bridge and the entrypoint use), and a
 * separate Node process. The only fake is the pg CLIENT class the pool is given, and it dies the way pg 8 reports a
 * death: the statement in flight rejects with the server's FATAL (57P01), or the next one is refused as not queryable,
 * and the client's `error` is emitted on a LATER turn of the event loop, outside the caller's promise chain, exactly
 * where pg's socket handler emits it. Nothing catches that emit. With nobody listening, the child process dies of an
 * uncaught exception, which is what the CONTROL below shows and what every store did before it listened.
 *
 * The rest of the file is the sweep: every pool and every checkout in a Julius- or Project-Brain-owned file either goes
 * through `julius-pg-held.ts` or is named below with the reason it is already listened to.
 */

const ROOT = process.cwd();
const dir = mkdtempSync(join(tmpdir(), 'julius-pg-held-'));
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

/** The dying pg client every child is built on: prepended to each child's own source and bundled by esbuild; pg itself is external. */
const CHILD_COMMON = String.raw`
import { EventEmitter } from 'node:events';
import { Pool } from 'pg';

const NOT_QUERYABLE = 'Client has encountered a connection error and is not queryable';
const fatal = () => Object.assign(new Error('terminating connection due to administrator command'), { code: '57P01', severity: 'FATAL' });
const closed = () => new Error('Connection terminated unexpectedly');
const seen = { clients: 0, listenersAtDeath: [] as number[], releasedWithError: [] as boolean[] };
let armed: 'during-statement' | 'between-statements' | null = null;
const arm = (death: string) => { armed = death === 'during-statement' ? 'during-statement' : 'between-statements'; };

/** The statement a death lands on: the first one on a HELD client after its BEGIN (or its first, without one), never a lock. */
const lands = (client: DyingClient, sql: string) => client.held && !sql.startsWith('BEGIN') && !sql.includes('pg_advisory_');

class DyingClient extends EventEmitter {
  _queryable = true;
  _ending = false;
  held = false;
  private state: 'up' | 'closing' | 'down' = 'up';
  private waiting: Array<(error: Error) => void> = [];
  constructor() { super(); seen.clients += 1; }
  connect(callback?: (error?: Error) => void) { setImmediate(() => callback?.()); return callback === undefined ? Promise.resolve() : undefined; }
  end(callback?: () => void) { this._ending = true; setImmediate(() => { this.emit('end'); callback?.(); }); return callback === undefined ? Promise.resolve() : undefined; }
  /** pg's socket handler: no try, no catch. Unheard, this throws an uncaught exception and the process exits. */
  fromTheSocket(error: Error) { this._queryable = false; seen.listenersAtDeath.push(this.listenerCount('error')); this.emit('error', error); }
  query(sql: unknown, values?: unknown, callback?: unknown) {
    const cb = typeof values === 'function' ? values : callback;
    const result = this.run(String(sql).trim());
    if (typeof cb === 'function') { result.then((rows) => cb(undefined, rows), (error) => cb(error)); return undefined; }
    return result;
  }
  private async run(sql: string): Promise<unknown> {
    if (this.state === 'down') throw new Error(NOT_QUERYABLE);
    if (this.state === 'closing') return new Promise((_resolve, reject) => { this.waiting.push(reject); });
    const death = armed !== null && lands(this, sql) ? armed : null;
    if (death === null) return { rows: [], rowCount: 1 };
    armed = null;
    if (death === 'during-statement') {
      this.state = 'closing';
      setImmediate(() => {
        this.state = 'down';
        const error = closed();
        this.fromTheSocket(error);
        for (const reject of this.waiting.splice(0)) reject(error);
      });
      throw fatal();
    }
    await new Promise<void>((resolve) => setImmediate(() => {
      this.state = 'down';
      this.fromTheSocket(fatal());
      this.fromTheSocket(closed());
      resolve();
    }));
    throw new Error(NOT_QUERYABLE);
  }
}

/** A real pg.Pool over the dying client. A promise-style connect() is a store's checkout; the pool's own query() is not. */
function dyingPool(): Pool {
  const pool = new Pool({ Client: DyingClient as never, max: 2 });
  // what each HELD client went back with: an Error makes pg-pool destroy it
  pool.on('release', (error: unknown, client: unknown) => { if ((client as DyingClient).held) seen.releasedWithError.push(error instanceof Error); });
  const connect = pool.connect.bind(pool) as (callback?: unknown) => unknown;
  (pool as unknown as { connect: unknown }).connect = (callback?: unknown) => (callback === undefined
    ? (connect() as Promise<DyingClient>).then((client) => { client.held = true; return client; })
    : connect(callback));
  return pool;
}

const connectionError = (error: unknown) => /not queryable|administrator command|terminated unexpectedly/u.test(String((error as Error)?.message));
const report = (fields: Record<string, unknown>) => { process.stdout.write('CHILD ' + JSON.stringify({ ...fields, ...seen }) + '\n'); };
`;

/** Each Julius store's held checkout, driven once with a death armed and once without. */
const STORES_CHILD = String.raw`
import { juliusSerializable } from './julius-serializable';
import { JuliusClaimPostgresRepository } from './julius-claim-postgres';
import { JuliusRecoveryPostgresRepository } from './julius-recovery-postgres';
import { JuliusContextPostgresRepository } from './julius-context-postgres';
import { JuliusToolPostgresRepository } from './julius-tool-postgres';

const [op, death] = process.argv.slice(2);
const AT = '2026-10-13T12:00:00.000Z';
const pool = dyingPool();
const OPS: Record<string, () => Promise<unknown>> = {
  'control': async () => {
    // THE PRE-FIX SHAPE every one of these stores had: connect, BEGIN, a write, ROLLBACK on failure, release. No listener.
    const client = await pool.connect();
    try { await client.query('BEGIN'); await client.query('INSERT INTO relay_wonderland.example(id) VALUES($1)', ['x']); await client.query('COMMIT'); }
    catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
    finally { client.release(); }
  },
  'serializable': () => juliusSerializable(pool, async (client) => client.query('INSERT INTO relay_wonderland.example(id) VALUES($1)', ['x']), { pause: async () => undefined }),
  'claim': () => new JuliusClaimPostgresRepository(pool).recordClaimStanding({ runId: 'run:x', projectId: 'prj-x', claim: { claimId: 'claim:x' }, reason: 'r', occurredAt: AT } as never),
  'recovery': () => new JuliusRecoveryPostgresRepository(pool).recoverExpired(AT),
  'context': () => new JuliusContextPostgresRepository(pool).persist({ projectId: 'prj-x', snapshot: { contextId: 'ctx-x', runId: 'run:x', taskId: 't', workerId: 'w', contentHash: 'h' } as never }),
  'tool-deny': () => new JuliusToolPostgresRepository(pool).deny({ invocationId: 'i', tenantId: 't', projectId: 'p', requestDigest: 'd', safeSummary: 's', completedAt: AT }),
  'tool-fail-dispatch': () => new JuliusToolPostgresRepository(pool).failDispatch({ invocationId: 'i', dispatchGeneration: 1, failure: 'UNKNOWN_OUTCOME', failureClass: 'executor_refused', safeSummary: 's', completedAt: AT } as never),
  'tool-complete': () => new JuliusToolPostgresRepository(pool).complete({ invocationId: 'i', claimedBy: 'c', dispatchGeneration: 1, result: { invocationId: 'i', status: 'SUCCEEDED', exitCode: 0, safeSummary: 's', stdout: '', stderr: '', stdoutRef: null, stderrRef: null, durationMs: 1 } as never, artifacts: [], evidence: [], completedAt: AT }),
};
const settle = async () => { try { await OPS[op](); return 'resolved'; } catch (error) { return connectionError(error) ? 'connection_error' : 'other_error'; } };
(async () => {
  arm(death);
  const first = await settle();
  // THE NEXT CALL, on whatever client the pool hands out now: a dead one must never be handed out again.
  const next = await settle();
  report({ first, next });
  await pool.end();
})();
`;

/**
 * A pool's IDLE client dying: pg-pool re-emits it on the pool, which must be listened to as well. Two children, so the
 * CONTROL builds without the helper. Each defines the `pool` the drive below uses.
 */
const POOL_DRIVE = String.raw`
(async () => {
  const client = await pool.connect();
  client.release();
  // idle in the pool now, with pg-pool's own listener on it: the death is the pool's to report
  await new Promise<void>((resolve) => setImmediate(() => { (client as unknown as DyingClient).fromTheSocket(Object.assign(new Error('terminating connection due to administrator command'), { code: '57P01', severity: 'FATAL' })); resolve(); }));
  const again = await pool.connect();
  again.release();
  report({ idleCount: pool.idleCount, totalCount: pool.totalCount, clientsMade: seen.clients });
  await pool.end();
})();
`;
const POOL_BARE_CHILD = String.raw`
const pool = new Pool({ Client: DyingClient as never, max: 2 });
` + POOL_DRIVE;
const POOL_LISTENED_CHILD = String.raw`
import { listenJuliusPool } from './julius-pg-held';
const pool = listenJuliusPool(new Pool({ Client: DyingClient as never, max: 2 }), 'julius test pool');
` + POOL_DRIVE;

/** Bundles one child (CHILD_COMMON, then its own source), or returns the build error as text. */
function bundle(name: string, source: string): { file: string } | { buildError: string } {
  const file = join(dir, `${name}.cjs`);
  try {
    buildSync({
      stdin: { contents: `${CHILD_COMMON}\n${source}`, resolveDir: __dirname, sourcefile: `${name}.ts`, loader: 'ts' },
      bundle: true, platform: 'node', format: 'cjs', packages: 'external', outfile: file, logLevel: 'silent',
    });
    return { file };
  } catch (error) {
    return { buildError: error instanceof Error ? error.message.split('\n')[0]! : String(error) };
  }
}

interface ChildRun { readonly status: number | null; readonly report: Record<string, unknown> | null; readonly storeLines: string[]; readonly stderr: string }
function run(child: { file: string } | { buildError: string }, args: readonly string[]): ChildRun {
  if ('buildError' in child) return { status: null, report: null, storeLines: [], stderr: `BUILD FAILED: ${child.buildError}` };
  const out = spawnSync(process.execPath, [child.file, ...args], {
    encoding: 'utf8', timeout: 60_000, env: { ...process.env, NODE_PATH: join(ROOT, 'node_modules') },
  });
  const line = out.stdout.split('\n').find((entry) => entry.startsWith('CHILD '));
  return {
    status: out.status,
    report: line === undefined ? null : JSON.parse(line.slice('CHILD '.length)) as Record<string, unknown>,
    storeLines: out.stderr.split('\n').filter((entry) => entry.startsWith('[julius-store]')),
    stderr: out.stderr,
  };
}

const stores = bundle('stores', STORES_CHILD);
const barePool = bundle('pool-bare', POOL_BARE_CHILD);
const listenedPool = bundle('pool-listened', POOL_LISTENED_CHILD);

/** Per death: how many times pg emits, and what the first emission carries. */
const DEATHS = [
  { death: 'during-statement', emissions: 1, code: 'no SQLSTATE' },
  { death: 'between-statements', emissions: 2, code: 'SQLSTATE 57P01' },
] as const;

describe('the CONTROL: a held client nobody listens to kills the process when its connection dies', () => {
  for (const { death } of DEATHS) {
    it(`${death}: the pre-fix shape dies of an uncaught exception (this instrument can fail)`, () => {
      const child = run(stores, ['control', death]);
      expect(child.status, child.stderr.slice(0, 400)).toBe(1);
      expect(child.stderr).toMatch(/Unhandled 'error' event|Emitted 'error' event/u);
      expect(child.report, 'the process never reached its report').toBeNull();
    }, 60_000);
  }
});

describe('every Julius store hears its held client die: the operation fails, the process lives, the client is destroyed', () => {
  const STORES: ReadonlyArray<readonly [op: string, store: string]> = [
    ['serializable', 'julius serializable'],
    ['claim', 'julius claim store'],
    ['recovery', 'julius recovery store'],
    ['context', 'julius context store'],
    ['tool-deny', 'julius tool store'],
    ['tool-fail-dispatch', 'julius tool store'],
    ['tool-complete', 'julius tool store'],
  ];
  for (const [op, store] of STORES) {
    // THE CONTEXT STORE HOLDS NO TRANSACTION: its one fresh-snapshot read is its whole hold. A FATAL that fails that
    // statement is answered before the socket closes, so the client is already back in the pool when pg emits the
    // close, and that death is the POOL's to hear (listenJuliusPool, below; the bridge's pool listens too). Only a death
    // while it holds the client, before its read, is the store's.
    for (const { death, emissions, code } of DEATHS.filter((entry) => op !== 'context' || entry.death === 'between-statements')) {
      it(`${op}, ${death}: one fixed line (${code}), a failed operation, a live process, and a fresh client next`, () => {
        const child = run(stores, [op, death]);
        expect(child.status, child.stderr.slice(0, 600)).toBe(0);
        // the operation in flight failed through its own error path, and the next one was served on a client that works
        expect(child.report).toMatchObject({ first: 'connection_error' });
        expect(child.report?.next, 'the dead client was handed out again').not.toBe('connection_error');
        // every emission found exactly one listener: the store's
        expect(child.report?.listenersAtDeath).toEqual(Array<number>(emissions).fill(1));
        // the dead client went back WITH the error, so the pool destroyed it
        expect((child.report?.releasedWithError as boolean[])[0]).toBe(true);
        // ONE fixed line: the store's name and the SQLSTATE, never the message, a statement or a value
        expect(child.storeLines).toEqual([`[julius-store] ${store}: a held database connection was lost (${code}); the operation in flight fails`]);
        expect(child.stderr).not.toMatch(/administrator|terminated|INSERT|UPDATE|SELECT|not queryable/u);
      }, 60_000);
    }
  }
});

describe('a pool hears its idle clients die (the entrypoint\'s pools, the executor\'s, the scripts\')', () => {
  it('the CONTROL: a pool nobody listens to dies of the uncaught re-emit', () => {
    const child = run(barePool, []);
    expect(child.status, child.stderr.slice(0, 400)).toBe(1);
    expect(child.stderr).toMatch(/Unhandled 'error' event|Emitted 'error' event/u);
  }, 60_000);

  it('listenJuliusPool: one fixed line, the dead client discarded, the next checkout served by a new one', () => {
    const child = run(listenedPool, []);
    expect(child.status, child.stderr.slice(0, 400)).toBe(0);
    expect(child.storeLines).toEqual(['[julius-store] julius test pool: an idle database connection was lost (SQLSTATE 57P01); the pool discards it']);
    expect(child.report).toMatchObject({ clientsMade: 2, totalCount: 1 });
    expect(child.stderr).not.toMatch(/administrator|terminated/u);
  }, 60_000);
});

/* ------------------------------------------------------------------------------------------------------------ the sweep */

/**
 * THE SWEEP, as a rule that stays true. Every Julius- and Project-Brain-owned source file (the stores, the Julius tools,
 * the bridge's Julius entrypoints and modules, the Julius and Project Brain scripts) is read, and every pool it builds and
 * every client it checks out must go through `listenJuliusPool` / `checkoutJuliusHeld`, or be named here with the reason it
 * is already listened to. A new `new Pool(` or `.connect()` in one of those files fails this test until it is one or the other.
 */
const OWNED = /^(src\/relay\/persistence\/(julius|project-brain)-[^/]+|src\/relay\/workspace\/julius-tools\/.+|relay-bridge\/julius-[^/]+|relay-bridge\/julius\/.+|relay-bridge\/project-brain\/.+|scripts\/(julius|project-brain)-[^/]+)\.(ts|mts|mjs|cjs|js)$/u;
const ALREADY_LISTENED: Readonly<Record<string, { readonly sites: number; readonly reason: string }>> = {
  'src/relay/persistence/julius-pg-held.ts': { sites: 1, reason: 'the helper itself: its own checkout is the one that listens' },
  'src/relay/persistence/project-brain-pg-shared.ts': { sites: 1, reason: "Project Brain's checkout() listens for the hold time (silently) and its callers release with the error; PB is VERIFIED and unchanged here" },
  'scripts/project-brain-proof-main.ts': { sites: 1, reason: "the proof's pool is listened to on the next line (pool.on('error', ...)); PB, unchanged here" },
  'relay-bridge/project-brain/brain-wakeups.ts': { sites: 2, reason: "a dedicated LISTEN client (not a pool checkout) with its own 'error' and 'end' listeners, attached before it connects: a death drops it and reconnects" },
  'relay-bridge/project-brain/compose.ts': { sites: 1, reason: 'builds that LISTEN client for brain-wakeups.ts, which listens to it' },
};

describe('the sweep: every Julius- and Project-Brain-owned pool and checkout is listened to', () => {
  const owned = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n')
    .filter((file) => OWNED.test(file) && !/\.test\.|\.d\.m?ts$/u.test(file));
  const sites = (pattern: RegExp) => owned.flatMap((file) => readFileSync(join(ROOT, file), 'utf8').split('\n')
    .flatMap((line, index) => [...line.matchAll(pattern)].map(() => ({ file, line: index + 1, text: line.trim() }))));

  it('reads the files the finding named, so the rule below is not vacuous', () => {
    for (const file of ['src/relay/persistence/julius-serializable.ts', 'src/relay/persistence/julius-tool-postgres.ts', 'relay-bridge/julius-live-mission.ts',
      'src/relay/workspace/julius-tools/executor-control-plane-main.ts', 'scripts/julius-live-preflight-identity.ts']) expect(owned).toContain(file);
  });

  it('every `new Pool(` is handed straight to listenJuliusPool', () => {
    const unlistened = sites(/new (?:pg\.)?Pool\(/gu)
      .filter((site) => !/listenJuliusPool\(new (?:pg\.)?Pool\(/u.test(site.text) && ALREADY_LISTENED[site.file] === undefined);
    expect(unlistened.map((site) => `${site.file}:${site.line}`)).toEqual([]);
  });

  it('every checkout goes through checkoutJuliusHeld, and nothing else is exempt', () => {
    const checkouts = sites(/\.connect\(\)|new (?:pg\.)?Client\(/gu);
    expect(checkouts.filter((site) => ALREADY_LISTENED[site.file] === undefined).map((site) => `${site.file}:${site.line} ${site.text.slice(0, 80)}`)).toEqual([]);
    for (const [file, { sites: count }] of Object.entries(ALREADY_LISTENED)) {
      const found = checkouts.filter((site) => site.file === file).length + sites(/new (?:pg\.)?Pool\(/gu).filter((site) => site.file === file).length;
      expect(found, `${file}: the exemption names exactly the sites it has`).toBe(count);
    }
  });
});
