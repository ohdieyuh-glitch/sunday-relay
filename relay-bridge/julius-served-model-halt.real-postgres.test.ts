import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createJuliusMemoryStore, scriptedAdapter, type JuliusOperationalEvent } from '../src/relay/mission/julius';
import { juliusTestDatabaseUrl } from '../src/relay/persistence/julius-test-database';
import { TransactionalWonderlandDatabase } from '../src/relay/persistence/wonderland-postgres';
import { composeJuliusMissionBootstrap, handleJuliusMissionRoute } from './julius-mission-routes';
import {
  architectWorker, CODER_WORKER, assembleLiveJuliusRuntime, createContextAndClaimHandoffs, driveJuliusRunToTerminal, reviewerWorker,
} from './julius/live-composition';
import { createJuliusPostgresRuntimeStore } from './julius/postgres-store';

/**
 * A CODER ANSWERED BY A MODEL IT DID NOT ASK FOR ENDS THE RUN, AGAINST A REAL POSTGRESQL.
 *
 * `julius/coder-served-model-halt.runtime.test.ts` follows the stop from the real provider through
 * the kernel over the memory store. This says the other half against the database itself, through the
 * PRODUCTION compositions: a mission created by `composeJuliusMissionBootstrap`, and the run loop
 * assembled over `createJuliusPostgresRuntimeStore(pool)`. What it pins:
 *
 *   - THE READ: `haltingFailureClasses` returns the closed-set classes on the run's `task.failed` rows,
 *     each once, first recorded first. Not an ordinary class, not the same class on another event
 *     type, not another run's, not across a project. And the memory store answers the same sequence
 *     the same way (PARITY).
 *   - THE ENACTMENT: a run holding such a row, whose run row still says READY, ENDS at the next
 *     advance: FAILED with the class as the RECORDED transition's reason, announced once. Its
 *     claimed task is refused at the dispatch boundary with no attempt spent, and nothing is
 *     dispatched.
 *
 * Gated on JULIUS_TEST_DATABASE_URL like every other real-postgres suite, and `todo` without it, so an
 * absent database is a skipped proof rather than a passing one. Every mission carries a random
 * identity.
 */

const databaseUrl = juliusTestDatabaseUrl();
const enabled = databaseUrl !== null;
const suite = enabled ? describe : describe.todo;
const CARD = 'card:served-model-halt:1';
const MISMATCH = 'coder_served_model_mismatch';
const UNATTESTED = 'coder_served_model_unattested';

const nonce = () => randomBytes(4).toString('hex');

function contractFor(id: string) {
  return {
    missionId: `mission:served-halt-${id}`, markerNamespace: `served-halt-${id}`,
    projectId: `prj-served-halt-${id}`, tenantId: `tenant-served-halt-${id}`,
    objective: 'Write a comparison of the three candidate save-file formats.',
    requirements: ['Compare size, load time and forward compatibility.'],
    constraints: ['Touch only docs/.'],
    acceptanceCriteria: [{ id: 'AC-1', text: 'The comparison exists and covers all three.', blocking: true }],
    testCommand: '',
    workspacePath: '/workspace/served-halt',
    limits: { spendUsd: 2, repairCycles: 1 },
  };
}

type Envelope = { data?: Record<string, unknown>; error?: { kind: string; message: string } };

/** A failure row as the coordinator writes one: the class on `failureClass`. */
const failed = (runId: string, projectId: string, failureClass: string, type: JuliusOperationalEvent['type'] = 'task.failed'): JuliusOperationalEvent => {
  const id = nonce();
  return {
    eventId: `event:served-halt:${id}`, runId, projectId, type, taskId: `build-${id}`, workerId: 'coder',
    correlationId: `build-${id}`, causationId: null, occurredAt: new Date().toISOString(),
    facts: { code: 'WORKER_EXECUTION_FAILURE', errorRetryable: false, failureClass },
  };
};

suite('a served-model halt over a real PostgreSQL', () => {
  let pool: Pool;
  let create: (body: string) => Promise<{ status: number; body: unknown } | null>;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl! });
    await new TransactionalWonderlandDatabase(pool).migrate();
    const bootstrap = composeJuliusMissionBootstrap(pool);
    const ports = { bootstrap, missingConfig: [], reviewerProvider: 'xai', cardRevision: CARD };
    create = (body) => handleJuliusMissionRoute({ method: 'POST', path: '/julius/missions', operator: true, body }, ports);
  });
  afterAll(async () => pool?.end());

  async function created(): Promise<{ runId: string; projectId: string; planTaskId: string }> {
    const contract = contractFor(nonce());
    const result = await create(JSON.stringify(contract));
    const data = (result?.body as Envelope).data as { runId: string; state: string };
    expect(data.state).toBe('READY');
    const plan = await pool.query<{ task_id: string }>(
      `SELECT task_id FROM relay_wonderland.julius_tasks WHERE run_id=$1 AND task_type='plan'`, [data.runId]);
    return { runId: data.runId, projectId: contract.projectId, planTaskId: plan.rows[0]!.task_id };
  }

  const runState = async (runId: string) =>
    (await pool.query<{ state: string }>('SELECT state FROM relay_wonderland.julius_runs WHERE run_id=$1', [runId])).rows[0]!.state;

  it('THE READ: the closed set, each once, first recorded first; and the memory store agrees', async () => {
    const a = await created();
    const b = await created();
    // A clean run beside two that hold the class: nothing of theirs may halt it.
    const c = await created();
    const store = createJuliusPostgresRuntimeStore(pool);
    const memory = createJuliusMemoryStore();
    for (const run of [a, b, c]) {
      memory.seedRun({
        runId: run.runId, missionId: `msn-${run.runId}`, projectId: run.projectId, state: 'READY',
        cardRevision: CARD, missionContractRevision: 1, projectBrainRevision: 1, version: 1,
      });
    }
    const sequence = [
      failed(a.runId, a.projectId, 'coder_timed_out'),
      failed(a.runId, a.projectId, UNATTESTED),
      // The same class on a row that did NOT end a task says nothing about the run.
      failed(a.runId, a.projectId, MISMATCH, 'retry.scheduled'),
      failed(a.runId, a.projectId, MISMATCH),
      failed(a.runId, a.projectId, UNATTESTED),
      failed(b.runId, b.projectId, MISMATCH),
    ];
    for (const event of sequence) {
      expect(await store.appendEvent(event)).toBe(true);
      expect(await memory.appendEvent(event)).toBe(true);
    }

    for (const [label, reader] of [['postgres', store], ['memory', memory]] as const) {
      expect(await reader.haltingFailureClasses(a.runId, a.projectId), `${label}: run a, once each, in order`).toEqual([UNATTESTED, MISMATCH]);
      expect(await reader.haltingFailureClasses(b.runId, b.projectId), `${label}: run b`).toEqual([MISMATCH]);
      expect(await reader.haltingFailureClasses(a.runId, b.projectId), `${label}: never across a project`).toEqual([]);
      expect(await reader.haltingFailureClasses(c.runId, c.projectId), `${label}: never across a run`).toEqual([]);
    }
    const ordinary = await created();
    await store.appendEvent(failed(ordinary.runId, ordinary.projectId, 'coder_timed_out'));
    expect(await store.haltingFailureClasses(ordinary.runId, ordinary.projectId), 'an ordinary failure ends nothing').toEqual([]);
  });

  it('THE ENACTMENT: a run whose row still says READY ENDS at the next advance, and nothing is dispatched', async () => {
    const run = await created();
    const store = createContextAndClaimHandoffs(createJuliusPostgresRuntimeStore(pool)).store;
    // The coder's failure, recorded; the run row never moved (its advance had not run yet, or lost a race).
    expect(await store.appendEvent(failed(run.runId, run.projectId, MISMATCH))).toBe(true);
    expect(await runState(run.runId)).toBe('READY');

    const architect = scriptedAdapter(architectWorker({}), [{
      kind: 'succeed', evidence: [{ type: 'ARTIFACT', status: 'PASSED', safeSummary: 'Plan written.' }], usdMicros: null,
    }]);
    const coder = scriptedAdapter(CODER_WORKER, []);
    const reviewer = scriptedAdapter(reviewerWorker('hermes'), []);
    const runtime = assembleLiveJuliusRuntime({
      store,
      entries: [
        { worker: architectWorker({}), adapter: architect },
        { worker: CODER_WORKER, adapter: coder },
        { worker: reviewerWorker('hermes'), adapter: reviewer },
      ],
      cardRevision: CARD, spendCeilingUsdMicros: 20_000_000, maxRepairRounds: 1,
    });

    const outcome = await driveJuliusRunToTerminal({ loop: runtime.loop, store, runId: run.runId, projectId: run.projectId, maxTicks: 4 });
    expect(outcome, 'ended, not stalled').toMatchObject({ state: 'FAILED', stalled: false });
    expect(architect.dispatches.length + coder.dispatches.length + reviewer.dispatches.length, 'nothing dispatched').toBe(0);

    const plan = await pool.query<{ state: string; attempt: number }>(
      'SELECT state, attempt FROM relay_wonderland.julius_tasks WHERE task_id=$1', [run.planTaskId]);
    expect(plan.rows[0], 'the claimed plan was refused at the dispatch boundary, no attempt spent').toEqual({ state: 'FAILED', attempt: 0 });
    const last = await pool.query<{ to_state: string; reason_code: string }>(
      'SELECT to_state, reason_code FROM relay_wonderland.julius_transitions WHERE run_id=$1 ORDER BY sequence DESC LIMIT 1', [run.runId]);
    expect(last.rows[0], 'a RECORDED move, with the class as its reason').toEqual({ to_state: 'FAILED', reason_code: MISMATCH });
    const announced = await pool.query<{ reason: string }>(
      `SELECT payload->'facts'->>'reasonCode' AS reason FROM relay_wonderland.events WHERE stream_id=$1 AND event_type='julius.run.failed'`, [run.runId]);
    expect(announced.rows, 'announced once, naming the class').toEqual([{ reason: MISMATCH }]);
  });
});
