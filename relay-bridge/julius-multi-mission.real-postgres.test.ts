import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { scriptedAdapter } from '../src/relay/mission/julius';
import { JuliusPostgresRepository } from '../src/relay/persistence/julius-postgres';
import { juliusTestDatabaseUrl } from '../src/relay/persistence/julius-test-database';
import { TransactionalWonderlandDatabase } from '../src/relay/persistence/wonderland-postgres';
import { composeJuliusMissionBootstrap, handleJuliusMissionRoute } from './julius-mission-routes';
import { architectWorker, CODER_WORKER, assembleLiveJuliusRuntime, createContextAndClaimHandoffs, reviewerWorker } from './julius/live-composition';
import { createJuliusPostgresRuntimeStore } from './julius/postgres-store';

/**
 * MANY MISSIONS, TWO WORKERS, ONE REAL POSTGRESQL — scorecard row 13's missing
 * half.
 *
 * `src/relay/mission/julius/julius-multi-mission.e2e.test.ts` proves several
 * missions through one run loop on the IN-MEMORY store, "where the claim query
 * is a model of the real one" (the scorecard's own words). What that cannot
 * show is the real claim under contention: `FOR UPDATE OF t SKIP LOCKED`,
 * lease generations, the serializable transitions, two processes' worth of run
 * loops racing for the same rows. This suite says it against PostgreSQL itself,
 * through the PRODUCTION compositions: missions created by
 * `composeJuliusMissionBootstrap`, run loops assembled over
 * `createJuliusPostgresRuntimeStore(pool)`.
 *
 *   1. THE CLAIM RACE: ten claimants at once over five runnable plans — every
 *      plan is claimed exactly once, nobody gets a task twice, and each claimed
 *      task's lease generation is 1.
 *   2. SIX MISSIONS, TWO RUN LOOPS, one project, driven concurrently to the
 *      end: every mission COMPLETES; no task is dispatched twice or claimed
 *      twice; both loops did real work; every evidence row belongs to its own
 *      run. And the cost is MEASURED, not asserted: each tick's wall clock, per
 *      loop, printed as one `JULIUS_REAL_PG_CONCURRENCY` line — Julius's own
 *      scheduling and bookkeeping latency on a real database. (A real mission's
 *      provider latency is the live lane's to measure; providers are scripted
 *      here, and that is the honest scope of this number.)
 *
 * Gated on JULIUS_TEST_DATABASE_URL like every real-postgres suite, and `todo`
 * without it. Every mission carries a random identity.
 */

const databaseUrl = juliusTestDatabaseUrl();
const enabled = databaseUrl !== null;
const suite = enabled ? describe : describe.todo;
const CARD = 'card:multi-mission:1';
const TERMINAL = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

const nonce = () => randomBytes(4).toString('hex');

function contractFor(project: string, tenant: string, id: string) {
  return {
    missionId: `mission:multi-${id}`, markerNamespace: `multi-${id}`, projectId: project, tenantId: tenant,
    objective: 'Write a comparison of the three candidate save-file formats.',
    requirements: ['Compare size, load time and forward compatibility.'],
    constraints: ['Touch only docs/.'],
    acceptanceCriteria: [{ id: 'AC-1', text: 'The comparison exists and covers all three.', blocking: true }],
    testCommand: '',
    workspacePath: '/workspace/multi',
    limits: { spendUsd: 2, repairCycles: 1 },
  };
}

type Envelope = { data?: Record<string, unknown>; error?: { kind: string; message: string } };

const PLAN = [{ type: 'ARTIFACT' as const, status: 'PASSED' as const, safeSummary: 'Plan written.' }];
// The build's required type is TEST or DIFF depending on the declared check; both are offered.
const BUILD = [
  { type: 'TEST' as const, status: 'PASSED' as const, safeSummary: 'Suite green.' },
  { type: 'DIFF' as const, status: 'PASSED' as const, safeSummary: 'The change set.' },
];
const REVIEW = [{ type: 'REVIEW_FINDING' as const, status: 'PASSED' as const, safeSummary: 'No blocking findings.' }];

const percentile = (values: readonly number[], p: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
};

suite('many missions, two run loops, one real PostgreSQL', () => {
  let pool: Pool;
  let runs: JuliusPostgresRepository;
  let create: (body: string) => Promise<{ status: number; body: unknown } | null>;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl!, max: 12 });
    await new TransactionalWonderlandDatabase(pool).migrate();
    runs = new JuliusPostgresRepository(pool);
    const ports = { bootstrap: composeJuliusMissionBootstrap(pool), missingConfig: [], reviewerProvider: 'xai', cardRevision: CARD };
    create = (body) => handleJuliusMissionRoute({ method: 'POST', path: '/julius/missions', operator: true, body }, ports);
  });
  afterAll(async () => pool?.end());

  async function missions(count: number): Promise<{ projectId: string; runIds: string[] }> {
    const projectId = `prj-multi-${nonce()}`;
    const tenantId = `tenant-multi-${nonce()}`;
    const runIds: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const result = await create(JSON.stringify(contractFor(projectId, tenantId, nonce())));
      const body = result?.body as Envelope;
      expect(body.error, `mission ${index} created: ${JSON.stringify(body.error)}`).toBeUndefined();
      runIds.push((body.data as { runId: string }).runId);
    }
    return { projectId, runIds };
  }

  it('THE CLAIM RACE: ten claimants at once over five runnable plans, each plan claimed exactly once', async () => {
    const { projectId, runIds } = await missions(5);
    const now = new Date().toISOString();
    const leaseExpiresAt = new Date(Date.now() + 60_000).toISOString();
    const claims = await Promise.all(Array.from({ length: 10 }, (_, index) => runs.claimRunnable({
      owner: `racer-${index}`, now, leaseExpiresAt, limit: 1, projectId,
    })));
    const claimed = claims.flat();
    const ids = claimed.map((task) => task.taskId);
    expect(new Set(ids).size, 'nobody holds a task another racer holds').toBe(ids.length);
    expect(ids.length, 'every runnable plan was claimed, and nothing else was').toBe(5);
    expect(new Set(claimed.map((task) => task.runId))).toEqual(new Set(runIds));
    expect(claimed.every((task) => task.leaseGeneration === 1), 'each claimed exactly once').toBe(true);
    const owners = await pool.query<{ task_id: string; lease_owner: string }>(
      `SELECT task_id, lease_owner FROM relay_wonderland.julius_tasks WHERE run_id = ANY($1) AND state = 'ACTIVE'`, [runIds]);
    expect(owners.rows).toHaveLength(5);
    expect(new Set(owners.rows.map((row) => row.lease_owner)).size, 'five different racers won').toBe(5);
  });

  it('SIX MISSIONS, TWO RUN LOOPS: all complete, nothing is dispatched or claimed twice, and the tick cost is measured', async () => {
    const { projectId, runIds } = await missions(6);

    const loop = (owner: string) => {
      const architect = scriptedAdapter(architectWorker({}), [{ kind: 'succeed', evidence: PLAN, usdMicros: null }]);
      const coder = scriptedAdapter(CODER_WORKER, [{ kind: 'succeed', evidence: BUILD, usdMicros: 1_000 }]);
      const reviewer = scriptedAdapter(reviewerWorker('hermes'), [{ kind: 'succeed', evidence: REVIEW, usdMicros: null }]);
      const runtime = assembleLiveJuliusRuntime({
        store: createContextAndClaimHandoffs(createJuliusPostgresRuntimeStore(pool)).store,
        entries: [
          { worker: architectWorker({}), adapter: architect },
          { worker: CODER_WORKER, adapter: coder },
          { worker: reviewerWorker('hermes'), adapter: reviewer },
        ],
        cardRevision: CARD, spendCeilingUsdMicros: 20_000_000, maxRepairRounds: 1, owner,
      });
      const dispatched = () => [...architect.dispatches, ...coder.dispatches, ...reviewer.dispatches].map((item) => item.taskId);
      return { owner, runtime, dispatched };
    };
    const workers = [loop('loop-a'), loop('loop-b')];

    const allTerminal = async (): Promise<boolean> => {
      const rows = await pool.query<{ state: string }>('SELECT state FROM relay_wonderland.julius_runs WHERE run_id = ANY($1)', [runIds]);
      return rows.rows.length === runIds.length && rows.rows.every((row) => TERMINAL.has(row.state));
    };

    // A DRIVER THAT SHARES THE PROJECT. `driveJuliusRunToTerminal` drives ONE run and calls an idle tick a stall;
    // with two loops racing, a tick that claims nothing is ordinary, so each loop keeps ticking the project and
    // advancing every run until all six are terminal, or the wall-clock bound says it is stuck.
    const deadline = Date.now() + 120_000;
    const drive = async (worker: ReturnType<typeof loop>) => {
      const tickMs: number[] = [];
      let claimed = 0;
      while (Date.now() < deadline && !(await allTerminal())) {
        const started = performance.now();
        const report = await worker.runtime.loop.tick({ projectId });
        tickMs.push(performance.now() - started);
        claimed += report.claimed;
        if (report.claimed === 0) {
          for (const runId of runIds) await worker.runtime.loop.advanceRun(runId, projectId);
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
      }
      return { owner: worker.owner, tickMs, claimed };
    };
    const began = performance.now();
    const results = await Promise.all(workers.map(drive));
    const wallMs = performance.now() - began;

    const states = await pool.query<{ run_id: string; state: string }>(
      'SELECT run_id, state FROM relay_wonderland.julius_runs WHERE run_id = ANY($1) ORDER BY run_id', [runIds]);
    expect(states.rows.map((row) => row.state), JSON.stringify(states.rows)).toEqual(runIds.map(() => 'COMPLETED'));

    // NOTHING TWICE: a task dispatched by both loops, or claimed more than once, would be here.
    const dispatched = workers.flatMap((worker) => worker.dispatched());
    expect(new Set(dispatched).size, 'no task was dispatched twice across the two loops').toBe(dispatched.length);
    const tasks = await pool.query<{ task_id: string; state: string; lease_generation: number; attempt: number }>(
      'SELECT task_id, state, lease_generation, attempt FROM relay_wonderland.julius_tasks WHERE run_id = ANY($1)', [runIds]);
    const claimedTwice = tasks.rows.filter((row) => row.lease_generation > 1 || row.attempt > 1);
    expect(claimedTwice, 'every task claimed and attempted exactly once').toEqual([]);
    expect(tasks.rows.every((row) => row.state === 'SUCCEEDED' || row.state === 'SKIPPED'), JSON.stringify(tasks.rows)).toBe(true);
    expect(dispatched.length, 'every succeeded task was dispatched exactly once').toBe(
      tasks.rows.filter((row) => row.state === 'SUCCEEDED').length);
    for (const worker of workers) {
      expect(worker.dispatched().length, `${worker.owner} did real work: the race was real`).toBeGreaterThan(0);
    }

    // ISOLATION: every evidence row is filed under the run its task belongs to.
    const misfiled = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM relay_wonderland.julius_evidence e
         JOIN relay_wonderland.julius_tasks t ON t.task_id = e.task_id
        WHERE e.run_id = ANY($1) AND t.run_id <> e.run_id`, [runIds]);
    expect(misfiled.rows[0]!.n, 'no evidence crossed between missions').toBe(0);

    // THE MEASUREMENT: Julius's own tick cost on a real database, under contention.
    const summary = {
      missions: runIds.length, loops: workers.length, dispatches: dispatched.length, wallMs: Math.round(wallMs),
      perLoop: results.map((result) => ({
        owner: result.owner, ticks: result.tickMs.length, claimed: result.claimed,
        p50Ms: Math.round(percentile(result.tickMs, 50)), p95Ms: Math.round(percentile(result.tickMs, 95)),
        maxMs: Math.round(Math.max(0, ...result.tickMs)),
      })),
    };
    console.log(`JULIUS_REAL_PG_CONCURRENCY ${JSON.stringify(summary)}`);
    expect(wallMs, 'six scripted missions finish well inside the bound').toBeLessThan(120_000);
  }, 180_000);
});
