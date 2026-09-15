import { Pool, type PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';

import { createJuliusBrainAccessService } from '../src/relay/mission/julius/julius-brain-access';
import { createAccessFixtureIssuer } from '../src/relay/mission/julius/julius-brain-access-fixtures';
import { juliusPrincipal, type JuliusBrainDraft } from '../src/relay/mission/julius/julius-brain-contracts';
import { classifyJuliusBrainFailure, decideJuliusBrainFailure } from '../src/relay/mission/julius/julius-brain-failure-model';
import { createJuliusProjectBrainService } from '../src/relay/mission/julius/julius-brain-service';
import { createJuliusBrainSessionClient } from '../src/relay/mission/julius/julius-brain-session-client';
import type { JuliusBrainStateModePolicy } from '../src/relay/mission/julius/julius-brain-state-modes';
import { readAllJuliusBrainRecords, type JuliusBrainStore } from '../src/relay/mission/julius/julius-brain-store';
import type { JuliusRunRow } from '../src/relay/mission/julius/julius-runtime-ports';
import { JuliusBrainAccessPostgresState } from '../src/relay/persistence/julius-brain-access-postgres';
import { assertJuliusBrainDatabase, migrateJuliusBrainDatabase } from '../src/relay/persistence/julius-brain-database';
import { JuliusBrainPostgresStore } from '../src/relay/persistence/julius-brain-postgres';
import { createLiveJuliusProjectBrainBinding } from '../relay-bridge/julius/project-brain-binding';

/**
 * THE FAILURE MODEL, AGAINST A REAL POSTGRESQL.
 *
 * Each named failure is produced for real, classified from the error the driver
 * raised, and shown to do what the model says: nothing applied when it says
 * NOT_APPLIED, a reconciliation that finds the truth when it says UNKNOWN, a
 * FRESH run proceeding unpreserved and a LEARNING run refused, no retry of a TLS
 * failure. `JULIUS_REAL_POSTGRES=1` with `DATABASE_URL`; todo otherwise. The TLS
 * proof needs a server that offers TLS with a certificate this client does not
 * trust (the development instance's self-signed one).
 */
const enabled = (process.env.JULIUS_REAL_INFRA === '1' || process.env.JULIUS_REAL_POSTGRES === '1') && (process.env.DATABASE_URL ?? '') !== '';
const suite = enabled ? describe : describe.todo;
const PROJECT = 'prj-julius-live-4';
const BRAIN = 'brain:prj-julius-live-4';
const MISSION = 'mission:julius-live-4';
const RUN = 'run:julius-live-4';
const ATTEMPT = 'workflow:35000000000/1';
const NOW = '2026-09-15T12:00:00.000Z';
const JULIUS = juliusPrincipal('JULIUS', 'julius');
const clock = { now: () => NOW };
const runRow: JuliusRunRow = { runId: RUN, missionId: MISSION, projectId: PROJECT, state: 'EXECUTING', cardRevision: 'card', missionContractRevision: 1, projectBrainRevision: 0, version: 1 };
const quiet = (pool: Pool) => { pool.on('error', () => undefined); return pool; };
const caught = async (promise: Promise<unknown>) => promise.then(() => { throw new Error('expected a failure'); }, (error: unknown) => error);

async function freshDatabase(label: string) {
  const name = `jbfail${label}${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  const admin = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try { await admin.query(`CREATE DATABASE ${name}`); } finally { await admin.end(); }
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `/${name}`;
  const pools: Pool[] = [];
  const pool = (options: Partial<ConstructorParameters<typeof Pool>[0]> = {}) => { const p = quiet(new Pool({ connectionString: url.toString(), max: 2, ...options })); pools.push(p); return p; };
  const owner = pool();
  await migrateJuliusBrainDatabase(owner, { environment: 'test' });
  await createJuliusProjectBrainService({ store: new JuliusBrainPostgresStore(owner), clock }).initialize({ brainId: BRAIN, projectId: PROJECT, title: 'Julius', principal: JULIUS });
  return {
    name, url: url.toString(), owner, pool,
    end: async () => {
      await Promise.all(pools.map((p) => p.end().catch(() => undefined)));
      const drop = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
      await drop.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).catch(() => undefined);
      await drop.end();
    },
  };
}

const evidence = (key: string): JuliusBrainDraft => ({
  kind: 'TRACE', op: 'CREATE', entityId: `trace:${key}`, expectedVersion: 0, body: { traceClass: 'ACTION', summary: `failure proof ${key}`, facts: {} }, links: [],
  scope: { missionId: MISSION, runId: ATTEMPT, taskId: null }, retention: 'DURABLE', confidence: null, sensitivity: 'INTERNAL',
  provenance: { source: 'run_observed', provider: null, model: null, tool: null, commit: null, externalRef: null, executionId: null }, idempotencyKey: `failure:${key}`, occurredAt: null,
});
const commitOne = (store: JuliusBrainStore, key: string) => store.commit({ brainId: BRAIN, projectId: PROJECT, principal: JULIUS, grant: null, recordedAt: NOW, drafts: [evidence(key)] });
/** APPENDED or DUPLICATE: whether the write added a record or found it already there. */
const written = async (store: JuliusBrainStore, key: string) => {
  const result = await commitOne(store, key);
  if (result.outcome !== 'COMMITTED') throw new Error(`${result.reasonCode}: ${result.detail}`);
  return result.receipts[0]!.outcome;
};

const learningFor = (run: JuliusRunRow, brainRunId: string): JuliusBrainStateModePolicy => ({ mode: 'LEARNING', missionId: run.missionId, runId: brainRunId, learnFrom: { runIds: null, kinds: ['FINDING'], requireVerified: false } });
const bindingOver = (store: JuliusBrainStore, stateModeFor?: typeof learningFor) => createLiveJuliusProjectBrainBinding({
  store, clock, projectId: PROJECT, title: 'Julius', runs: { loadRun: async () => runRow }, legacyEntries: async () => [], brainRunIdFor: () => ATTEMPT, stateModeFor,
});

suite('the Brain failure model on a real PostgreSQL', () => {
  it('PostgreSQL unavailable: classified before anything applies; FRESH proceeds unpreserved, LEARNING does not start', async () => {
    const dead = quiet(new Pool({ connectionString: 'postgresql://brain:brain@127.0.0.1:1/brain', max: 1, connectionTimeoutMillis: 2_000 }));
    try {
      const store = new JuliusBrainPostgresStore(dead);
      expect(classifyJuliusBrainFailure(await caught(store.head(BRAIN, PROJECT)))).toMatchObject({ failureClass: 'DATABASE_UNAVAILABLE', outcome: 'NOT_APPLIED', retryable: true });
      expect(await bindingOver(store).bootstrap({ runId: RUN })).toMatchObject({ outcome: 'UNAVAILABLE', proceed: true, failure: { failureClass: 'DATABASE_UNAVAILABLE' } });
      expect(await bindingOver(store, learningFor).bootstrap({ runId: RUN })).toMatchObject({ outcome: 'UNAVAILABLE', proceed: false, failure: { failureClass: 'DATABASE_UNAVAILABLE' } });
    } finally { await dead.end(); }
  }, 30_000);

  it('PostgreSQL read-only: a write is refused and nothing applies; reads still answer, so preservation is derived — NOT_PRESERVED — not guessed', async () => {
    const db = await freshDatabase('ro');
    try {
      await db.owner.query(`ALTER DATABASE ${db.name} SET default_transaction_read_only = on`);
      const readOnly = new JuliusBrainPostgresStore(db.pool());
      const head = await readOnly.head(BRAIN, PROJECT);
      const refused = await caught(commitOne(readOnly, 'ro'));
      expect(classifyJuliusBrainFailure(refused)).toEqual({ failureClass: 'DATABASE_READ_ONLY', outcome: 'NOT_APPLIED', retryable: true, code: '25006' });
      expect(await readOnly.head(BRAIN, PROJECT)).toEqual(head);

      const fresh = bindingOver(readOnly);
      expect(await fresh.bootstrap({ runId: RUN })).toMatchObject({ outcome: 'UNAVAILABLE', proceed: true, failure: { failureClass: 'DATABASE_READ_ONLY' } });
      expect(await fresh.seal({ runId: RUN })).toMatchObject({ outcome: 'NOT_SEALED', reason: 'BRAIN_DETACHED' });
      expect(await fresh.preservation({ runId: RUN })).toMatchObject({ outcome: 'DERIVED', preservation: { status: 'NOT_PRESERVED' } });
      expect(await bindingOver(readOnly, learningFor).bootstrap({ runId: RUN })).toMatchObject({ outcome: 'UNAVAILABLE', proceed: false });
    } finally { await db.end(); }
  }, 60_000);

  it('transaction timeout: a lock or statement timeout rolls back — nothing applied — and the retry commits once', async () => {
    const db = await freshDatabase('timeout');
    try {
      // Another writer holds the Brain row.
      const holder: PoolClient = await db.owner.connect();
      await holder.query('BEGIN');
      await holder.query('SELECT 1 FROM julius_brain.brains WHERE brain_id = $1 FOR UPDATE', [BRAIN]);
      const lockTimeout = new JuliusBrainPostgresStore(db.pool({ options: '-c lock_timeout=300' }));
      const statementTimeout = new JuliusBrainPostgresStore(db.pool({ options: '-c statement_timeout=300' }));
      const locked = classifyJuliusBrainFailure(await caught(commitOne(lockTimeout, 'timeout')));
      expect(locked).toEqual({ failureClass: 'TRANSACTION_TIMEOUT', outcome: 'NOT_APPLIED', retryable: true, code: '55P03' });
      expect(classifyJuliusBrainFailure(await caught(commitOne(statementTimeout, 'timeout')))).toEqual({ failureClass: 'TRANSACTION_TIMEOUT', outcome: 'NOT_APPLIED', retryable: true, code: '57014' });
      expect(decideJuliusBrainFailure({ mode: 'FRESH', phase: 'MIRROR', failure: locked })).toMatchObject({ retry: 'RETRY', then: 'CONTINUE_WITHOUT_BRAIN', preservation: 'AT_RISK' });
      await holder.query('ROLLBACK');
      holder.release();
      expect((await readAllJuliusBrainRecords(lockTimeout, BRAIN, PROJECT)).some((record) => record.idempotencyKey === 'failure:timeout')).toBe(false);
      expect(await written(lockTimeout, 'timeout')).toBe('APPENDED');
      expect(await written(statementTimeout, 'timeout')).toBe('DUPLICATE');
    } finally { await db.end(); }
  }, 60_000);

  it('TLS: an untrusted certificate is a validation failure no retry may route around, and an unencrypted production connection is refused', async () => {
    const db = await freshDatabase('tls');
    try {
      const offersTls = await db.pool({ ssl: { rejectUnauthorized: false } }).query('SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()').then((r) => r.rows[0]?.ssl === true, () => false);
      if (!offersTls) throw new Error('this server does not offer TLS; enable ssl on the development instance to run this proof');
      const verifying = new JuliusBrainPostgresStore(db.pool({ ssl: { rejectUnauthorized: true } }));
      const failure = classifyJuliusBrainFailure(await caught(verifying.head(BRAIN, PROJECT)));
      expect(failure).toMatchObject({ failureClass: 'TLS_VALIDATION_FAILED', outcome: 'NOT_APPLIED', retryable: false });
      expect(decideJuliusBrainFailure({ mode: 'FRESH', phase: 'OPEN', failure })).toMatchObject({ retry: 'NONE', alert: 'CONFIGURATION', then: 'PROCEED_WITHOUT_BRAIN' });
      expect(decideJuliusBrainFailure({ mode: 'REGRESSION', phase: 'OPEN', failure })).toMatchObject({ retry: 'NONE', then: 'REFUSE_RUN' });
      const plain = classifyJuliusBrainFailure(await caught(assertJuliusBrainDatabase(db.pool({ ssl: false }), { environment: 'production' })));
      expect(plain).toEqual({ failureClass: 'TLS_VALIDATION_FAILED', outcome: 'NOT_APPLIED', retryable: false, code: 'julius_brain_database_connection_not_encrypted' });
    } finally { await db.end(); }
  }, 60_000);

  it('partial network loss: a connection lost mid-commit, or a response lost after the commit, is UNKNOWN; reconciliation finds which, and the retry writes once', async () => {
    const db = await freshDatabase('net');
    const admin = quiet(new Pool({ connectionString: process.env.DATABASE_URL, max: 1 }));
    try {
      // Lost mid-commit: the backend is terminated at the record insert.
      const pool = db.pool();
      const facade = {
        query: (...args: unknown[]) => (pool.query as (...a: unknown[]) => Promise<unknown>)(...args),
        connect: async (): Promise<PoolClient> => {
          const client = await pool.connect();
          client.on('error', () => undefined);
          const pid = (await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
          const query = client.query.bind(client) as (...args: unknown[]) => Promise<unknown>;
          return Object.assign(Object.create(client) as PoolClient, {
            query: async (...args: unknown[]) => { if (typeof args[0] === 'string' && args[0].includes('INSERT INTO julius_brain.records')) await admin.query('SELECT pg_terminate_backend($1)', [pid]); return query(...args); },
            release: (error?: Error | boolean) => client.release(error),
          });
        },
      };
      const cut = new JuliusBrainPostgresStore(facade as unknown as Pool);
      const cold = new JuliusBrainPostgresStore(db.pool());
      const before = await cold.head(BRAIN, PROJECT);
      const midCommit = classifyJuliusBrainFailure(await caught(commitOne(cut, 'net')));
      expect(midCommit).toMatchObject({ failureClass: 'NETWORK_PARTIAL', outcome: 'UNKNOWN', retryable: true });
      expect(decideJuliusBrainFailure({ mode: 'LEARNING', phase: 'SEAL', failure: midCommit }).retry).toBe('RECONCILE_THEN_RETRY');
      // Reconcile: it did not land.
      expect(await cold.head(BRAIN, PROJECT)).toEqual(before);
      expect(await written(cold, 'net')).toBe('APPENDED');

      // Lost response: the commit landed, the answer did not arrive.
      const lostResponse: JuliusBrainStore = { ...cold, head: (b, p) => cold.head(b, p), records: (b, p, q) => cold.records(b, p, q), entities: (b, p, f) => cold.entities(b, p, f), createBrain: (i) => cold.createBrain(i), loadBrain: (b, p) => cold.loadBrain(b, p), listBrains: (p) => cold.listBrains(p), commitGroup: (i) => cold.commitGroup(i), restore: (i, r) => cold.restore(i, r),
        commit: async (input) => { await cold.commit(input); throw Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }); } };
      const afterFirst = await cold.head(BRAIN, PROJECT);
      const lost = classifyJuliusBrainFailure(await caught(commitOne(lostResponse, 'lost')));
      expect(lost).toMatchObject({ failureClass: 'NETWORK_PARTIAL', outcome: 'UNKNOWN' });
      // Reconcile: it did land; the retry under the same key is a no-op.
      expect((await cold.head(BRAIN, PROJECT))!.sequence).toBe(afterFirst!.sequence + 1);
      expect(await written(cold, 'lost')).toBe('DUPLICATE');
      expect((await readAllJuliusBrainRecords(cold, BRAIN, PROJECT)).filter((record) => record.idempotencyKey === 'failure:lost')).toHaveLength(1);
    } finally { await admin.end(); await db.end(); }
  }, 60_000);

  it('a service restart during a session and a session expiring mid-operation, over the durable access state: the operation completes, never under a wider session', async () => {
    const db = await freshDatabase('session');
    try {
      const START = Date.parse(NOW) / 1000;
      const issuer = createAccessFixtureIssuer(START);
      let now = START * 1000;
      const policy = { ...issuer.policy, environments: { 'julius-paid': 'test' as const } };
      const serviceProcess = () => createJuliusBrainAccessService({
        brainId: BRAIN, environment: 'test', binding: { databaseEnvironment: 'test' }, policy, jwks: () => issuer.jwks, grants: () => [],
        clock: { now: () => new Date(now).toISOString() }, state: new JuliusBrainAccessPostgresState(db.pool()),
      });
      let service = serviceProcess();
      const client = createJuliusBrainSessionClient({
        access: { issueSession: (input) => service.issueSession(input), authorize: (input) => service.authorize(input) },
        identityToken: async () => { const iat = Math.floor(now / 1000); return issuer.mint({ iat, nbf: iat, exp: iat + 300 }); },
        projectId: PROJECT, missionId: MISSION, stateMode: { mode: 'FRESH', missionId: MISSION, runId: ATTEMPT },
      });
      const store = new JuliusBrainPostgresStore(db.pool());
      await client.call({ type: 'WRITE', drafts: [evidence('s1')] }, async () => commitOne(store, 's1'));
      service = serviceProcess(); // restart
      await client.call({ type: 'WRITE', drafts: [evidence('s2')] }, async () => commitOne(store, 's2'));
      expect(client.issued()).toBe(1);
      now += policy.sessionTtlMs; // expires between two calls of one operation
      await client.call({ type: 'WRITE', drafts: [evidence('s3')] }, async (session) => { expect(session.policy.mode).toBe('FRESH'); return commitOne(store, 's3'); });
      expect(client.issued()).toBe(2);
      const keys = (await readAllJuliusBrainRecords(store, BRAIN, PROJECT)).map((record) => record.idempotencyKey);
      expect(keys.filter((key) => key.startsWith('failure:s'))).toEqual(['failure:s1', 'failure:s2', 'failure:s3']);
    } finally { await db.end(); }
  }, 60_000);
});
