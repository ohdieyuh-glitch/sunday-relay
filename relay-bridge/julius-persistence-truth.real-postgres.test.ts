import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { juliusStoreErrorClass, scriptedAdapter } from '../src/relay/mission/julius';
import { juliusTestDatabaseUrl } from '../src/relay/persistence/julius-test-database';
import { TransactionalWonderlandDatabase } from '../src/relay/persistence/wonderland-postgres';
import { composeJuliusMissionBootstrap, handleJuliusMissionRoute } from './julius-mission-routes';
import { architectWorker, CODER_WORKER, assembleLiveJuliusRuntime, createContextAndClaimHandoffs, reviewerWorker } from './julius/live-composition';
import { createJuliusPostgresRuntimeStore } from './julius/postgres-store';

/**
 * A LOST CONNECTION IS JULIUS'S, AGAINST A REAL POSTGRESQL.
 *
 * The coordinator's cases fake the ports, and the pipeline's run on the memory
 * store. Two things only a real database can say:
 *   - that the error the pg DRIVER raises when a connection dies is one the
 *     classifier calls transient. The error here comes from a real backend,
 *     terminated with `pg_terminate_backend`; it is not a hand-built object;
 *   - that the real repositories' idempotency is what the bookkeeping retry
 *     relies on. An accept retried after its commit landed answers `duplicate`
 *     and writes nothing, and a settlement composed once is one row.
 *
 * Each mission runs through the PRODUCTION compositions (`composeJuliusMissionBootstrap`,
 * `createJuliusPostgresRuntimeStore`, `assembleLiveJuliusRuntime`) with scripted
 * providers. Gated on JULIUS_TEST_DATABASE_URL like every real-postgres suite, and
 * `todo` without it.
 */

const databaseUrl = juliusTestDatabaseUrl();
const enabled = databaseUrl !== null;
const suite = enabled ? describe : describe.todo;
const CARD = 'card:persistence-truth:1';
const TERMINAL = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);
const nonce = () => randomBytes(4).toString('hex');

const PLAN = [{ type: 'ARTIFACT' as const, status: 'PASSED' as const, safeSummary: 'Plan written.' }];
const BUILD = [
  { type: 'TEST' as const, status: 'PASSED' as const, safeSummary: 'Suite green.' },
  { type: 'DIFF' as const, status: 'PASSED' as const, safeSummary: 'The change set.' },
];
const REVIEW = [{ type: 'REVIEW_FINDING' as const, status: 'PASSED' as const, safeSummary: 'No blocking findings.' }];

function contractFor(id: string) {
  return {
    missionId: `mission:truth-${id}`, markerNamespace: `truth-${id}`, projectId: `prj-truth-${id}`, tenantId: `tenant-truth-${id}`,
    objective: 'Write a comparison of the three candidate save-file formats.',
    requirements: ['Compare size, load time and forward compatibility.'],
    constraints: ['Touch only docs/.'],
    acceptanceCriteria: [{ id: 'AC-1', text: 'The comparison exists and covers all three.', blocking: true }],
    testCommand: '',
    workspacePath: '/workspace/truth',
    limits: { spendUsd: 2, repairCycles: 1 },
  };
}

/**
 * THE DRIVER'S OWN ERROR FOR A DEAD CONNECTION. A pooled client's backend is
 * terminated from another session, and the next query on that client fails as
 * a lost connection would in production. The client is destroyed rather than
 * returned to the pool.
 */
async function terminatedConnectionError(pool: Pool): Promise<unknown> {
  const victim = await pool.connect();
  // The server's FATAL arrives as an event on the client. Unhandled, it would crash the process.
  victim.on('error', () => undefined);
  try {
    const pid = (await victim.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
    await pool.query('SELECT pg_terminate_backend($1)', [pid]);
    for (let wait = 0; wait < 40; wait += 1) {
      const alive = await pool.query('SELECT 1 FROM pg_stat_activity WHERE pid = $1', [pid]);
      if (alive.rowCount === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    try {
      await victim.query('SELECT 1');
    } catch (error) {
      return error;
    }
    throw new Error('a terminated backend answered a query');
  } finally {
    victim.release(true);
  }
}

suite('a lost connection is Julius\'s own, against a real PostgreSQL', () => {
  let pool: Pool;
  let create: (body: string) => Promise<{ status: number; body: unknown } | null>;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl!, max: 8 });
    await new TransactionalWonderlandDatabase(pool).migrate();
    const ports = { bootstrap: composeJuliusMissionBootstrap(pool), missingConfig: [], reviewerProvider: 'xai', cardRevision: CARD };
    create = (body) => handleJuliusMissionRoute({ method: 'POST', path: '/julius/missions', operator: true, body }, ports);
  });
  afterAll(async () => pool?.end());

  /** One mission, run through the live composition over a store the case may wrap, until it is terminal. */
  async function runMission(wrap: (store: ReturnType<typeof createJuliusPostgresRuntimeStore>) => ReturnType<typeof createJuliusPostgresRuntimeStore>) {
    const contract = contractFor(nonce());
    const created = await create(JSON.stringify(contract));
    const runId = ((created?.body as { data: { runId: string } }).data).runId;
    const architect = scriptedAdapter(architectWorker({}), [{ kind: 'succeed', evidence: PLAN, usdMicros: null }]);
    const coder = scriptedAdapter(CODER_WORKER, [{ kind: 'succeed', evidence: BUILD, usdMicros: 1_000 }]);
    const reviewer = scriptedAdapter(reviewerWorker('hermes'), [{ kind: 'succeed', evidence: REVIEW, usdMicros: null }]);
    const runtime = assembleLiveJuliusRuntime({
      store: createContextAndClaimHandoffs(wrap(createJuliusPostgresRuntimeStore(pool))).store,
      entries: [
        { worker: architectWorker({}), adapter: architect },
        { worker: CODER_WORKER, adapter: coder },
        { worker: reviewerWorker('hermes'), adapter: reviewer },
      ],
      cardRevision: CARD, spendCeilingUsdMicros: 20_000_000, maxRepairRounds: 1, owner: 'truth-loop',
    });
    const state = async () => (await pool.query<{ state: string }>('SELECT state FROM relay_wonderland.julius_runs WHERE run_id=$1', [runId])).rows[0]!.state;
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline && !TERMINAL.has(await state())) {
      const report = await runtime.loop.tick({ projectId: contract.projectId });
      if (report.claimed === 0) await runtime.loop.advanceRun(runId, contract.projectId);
    }
    const dispatched = [...architect.dispatches, ...coder.dispatches, ...reviewer.dispatches].map((item) => item.taskId);
    return { runId, state: await state(), dispatched };
  }

  const failures = async (runId: string) => (await pool.query(
    `SELECT event_type FROM relay_wonderland.events WHERE stream_id=$1 AND event_type='julius.task.failed'`, [runId])).rows;
  const settledTwice = async (runId: string) => (await pool.query(
    `SELECT payload->'facts'->>'reservationId' AS reservation, count(*)::int AS n FROM relay_wonderland.events
      WHERE stream_id=$1 AND event_type='julius.budget.settled' GROUP BY 1 HAVING count(*) > 1`, [runId])).rows;

  it('the driver\'s error for a terminated backend is a lost connection, which Julius may repeat its own writes through', async () => {
    const error = await terminatedConnectionError(pool);
    expect(juliusStoreErrorClass(error), `code=${String((error as { code?: unknown }).code)} message=${String((error as Error).message)}`).toBe('connection');
  });

  it('an ACCEPT whose connection died after its commit: the retry finds its own write, and the mission completes with one result per task', async () => {
    let lost = false;
    let genuine: unknown = null;
    const outcome = await runMission((store) => ({
      ...store,
      async acceptWorkerResult(input: Parameters<typeof store.acceptWorkerResult>[0]) {
        const receipt = await store.acceptWorkerResult(input);
        if (!lost) {
          // The commit landed; the acknowledgement is what the dead connection loses.
          lost = true;
          genuine = await terminatedConnectionError(pool);
          throw genuine;
        }
        return receipt;
      },
    }) as never);
    expect(genuine, 'a real driver error was raised').not.toBeNull();
    expect(outcome.state, JSON.stringify(await failures(outcome.runId))).toBe('COMPLETED');
    expect(new Set(outcome.dispatched).size, 'nothing was dispatched twice').toBe(outcome.dispatched.length);
    const results = await pool.query<{ task_id: string; n: number }>(
      'SELECT task_id, count(*)::int AS n FROM relay_wonderland.julius_worker_results WHERE run_id=$1 GROUP BY 1', [outcome.runId]);
    expect(results.rows.every((row) => row.n === 1), JSON.stringify(results.rows)).toBe(true);
    expect(await failures(outcome.runId), 'a lost acknowledgement is nobody\'s failure').toEqual([]);
  }, 90_000);

  it('an EFFORT row whose connection died after the budget commit: one settlement per reservation, and the mission completes', async () => {
    let lost = false;
    const outcome = await runMission((store) => ({
      ...store,
      async appendEvent(event: Parameters<typeof store.appendEvent>[0]) {
        if (!lost && event.type === 'worker.effort') {
          lost = true;
          throw await terminatedConnectionError(pool);
        }
        return store.appendEvent(event);
      },
    }) as never);
    expect(lost).toBe(true);
    expect(outcome.state, JSON.stringify(await failures(outcome.runId))).toBe('COMPLETED');
    expect(await settledTwice(outcome.runId), 'cost-accounting.tsv sums every settled row: none may appear twice').toEqual([]);
    expect(await failures(outcome.runId)).toEqual([]);
  }, 90_000);
});
