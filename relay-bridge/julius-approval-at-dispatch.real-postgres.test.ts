import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  decideJuliusApproval,
  juliusDispatchApprovalId,
  scriptedAdapter,
  type JuliusApprovalRecord,
  type JuliusApproverAuthority,
} from '../src/relay/mission/julius';
import { JuliusLifecyclePostgresRepository } from '../src/relay/persistence/julius-lifecycle-postgres';
import { JuliusPostgresRepository } from '../src/relay/persistence/julius-postgres';
import { juliusTestDatabaseUrl } from '../src/relay/persistence/julius-test-database';
import { TransactionalWonderlandDatabase } from '../src/relay/persistence/wonderland-postgres';
import { composeJuliusMissionBootstrap, handleJuliusMissionRoute } from './julius-mission-routes';
import {
  architectWorker, CODER_WORKER, assembleLiveJuliusRuntime, createContextAndClaimHandoffs, driveJuliusRunToTerminal, reviewerWorker,
} from './julius/live-composition';
import { createJuliusPostgresRuntimeStore } from './julius/postgres-store';

/**
 * THE C.A.R.D. GATE AT DISPATCH AND THE CLAIM HOLD, AGAINST A REAL POSTGRESQL.
 *
 * `julius-approval-at-dispatch.test.ts` drives the live run loop over the
 * memory store. This says the other half against the database itself, through
 * the PRODUCTION compositions: a mission created by
 * `composeJuliusMissionBootstrap`, the run loop assembled over
 * `createJuliusPostgresRuntimeStore(pool)`, and the real claim query
 * (`JuliusPostgresRepository.claimRunnable`). What it pins:
 *
 *   - the claim offers nothing from a run holding a PENDING approval, or a
 *     DENIED one, while its run row still says READY (the NOT EXISTS against
 *     `julius_approvals`), and offers the work again once it is granted;
 *   - such a denial ENDS the run at the next advance, through the production
 *     store's `deniedApprovals`: FAILED as APPROVAL_DENIED, announced, and
 *     nothing dispatched;
 *   - admission is the last check before money (F3): a run paused after its
 *     task was claimed spends no attempt, nor does one already CANCELLED,
 *     FAILED, COMPLETED or BLOCKED while its task is still ACTIVE (the cancel
 *     window), and an admission that meets a pause still being written WAITS
 *     for it (the run row is read FOR SHARE) and then refuses;
 *   - one tick of a gated run writes the PENDING approval and moves the run to
 *     BLOCKED in one transaction, as RECORDED transitions (READY -> EXECUTING
 *     -> BLOCKED, `APPROVAL_REQUIRED`, with their events), hands the task back
 *     RUNNABLE at attempt 0, and dispatches nothing;
 *   - a grant puts the run back to READY and the next tick dispatches exactly
 *     the gated work.
 *
 * Gated on JULIUS_TEST_DATABASE_URL like every other real-postgres suite, and
 * `todo` without it, so an absent database is a skipped proof rather than a
 * passing one. Every mission carries a random identity.
 */

const databaseUrl = juliusTestDatabaseUrl();
const enabled = databaseUrl !== null;
const suite = enabled ? describe : describe.todo;
const CARD = 'card:dispatch-gate:1';

const nonce = () => randomBytes(4).toString('hex');

function contractFor(id: string) {
  return {
    missionId: `mission:dispatch-gate-${id}`, markerNamespace: `dispatch-gate-${id}`,
    projectId: `prj-dispatch-gate-${id}`, tenantId: `tenant-dispatch-gate-${id}`,
    objective: 'Write a comparison of the three candidate save-file formats.',
    requirements: ['Compare size, load time and forward compatibility.'],
    constraints: ['Touch only docs/.'],
    acceptanceCriteria: [{ id: 'AC-1', text: 'The comparison exists and covers all three.', blocking: true }],
    testCommand: '',
    workspacePath: '/workspace/dispatch-gate',
    limits: { spendUsd: 2, repairCycles: 1 },
  };
}

type Envelope = { data?: Record<string, unknown>; error?: { kind: string; message: string } };
const anyone: JuliusApproverAuthority = { async mayApprove() { return true; } };

suite('the C.A.R.D. gate at dispatch and the claim hold over a real PostgreSQL', () => {
  let pool: Pool;
  let runs: JuliusPostgresRepository;
  let lifecycle: JuliusLifecyclePostgresRepository;
  let create: (body: string) => Promise<{ status: number; body: unknown } | null>;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl! });
    await new TransactionalWonderlandDatabase(pool).migrate();
    const bootstrap = composeJuliusMissionBootstrap(pool);
    runs = new JuliusPostgresRepository(pool);
    lifecycle = new JuliusLifecyclePostgresRepository(pool);
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

  const claim = (projectId: string) => {
    const now = new Date().toISOString();
    return runs.claimRunnable({
      owner: `dispatch-gate-proof-${nonce()}`, now, leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(), limit: 4, projectId,
    });
  };

  const record = (run: { runId: string; projectId: string; planTaskId: string }, key: string): JuliusApprovalRecord => ({
    approvalId: `apr-${key}`, runId: run.runId, projectId: run.projectId, taskId: run.planTaskId, operation: 'DISPATCH_WORKER',
    policyRevision: CARD, reasonCode: 'CARD_APPROVAL_REQUIRED', safeRationale: 'Gate.', state: 'PENDING',
    requestedAt: new Date().toISOString(), decidedAt: null, decidedBy: null, decisionReason: null, idempotencyKey: `key-${key}`,
  });

  const runState = async (runId: string) =>
    (await pool.query<{ state: string }>('SELECT state FROM relay_wonderland.julius_runs WHERE run_id=$1', [runId])).rows[0]!.state;

  it('CLAIM: a PENDING approval holds a run whose row still says READY, and a grant releases it', async () => {
    const run = await created();
    const key = nonce();
    // The non-atomic write: the approval row lands, the run row never moves.
    expect((await lifecycle.requestApproval(record(run, key))).created).toBe(true);
    expect(await runState(run.runId)).toBe('READY');
    expect(await claim(run.projectId), 'the real claim query refuses a run with a PENDING approval').toEqual([]);

    expect(await lifecycle.decideApproval({
      runId: run.runId, approvalId: `apr-${key}`, projectId: run.projectId, state: 'APPROVED',
      decidedBy: 'ghu-founder', decisionReason: 'Reviewed.', decidedAt: new Date().toISOString(),
    })).toBe(true);
    const offered = await claim(run.projectId);
    expect(offered.map((task) => task.taskType), 'granted, the plan is claimable again').toEqual(['plan']);
  });

  it('CLAIM: a DENIED approval holds a run whose FAILED move never happened', async () => {
    const run = await created();
    const key = nonce();
    await lifecycle.requestApproval(record(run, key));
    await lifecycle.decideApproval({
      runId: run.runId, approvalId: `apr-${key}`, projectId: run.projectId, state: 'DENIED',
      decidedBy: 'ghu-founder', decisionReason: 'No.', decidedAt: new Date().toISOString(),
    });
    expect(await runState(run.runId)).toBe('READY');
    expect(await claim(run.projectId), 'a denial stops the work whatever the run row says').toEqual([]);
  });

  it('ENACTMENT: that denial ENDS the run at the next advance through the production store, and nothing is dispatched', async () => {
    const run = await created();
    const key = nonce();
    await lifecycle.requestApproval(record(run, key));
    await lifecycle.decideApproval({
      runId: run.runId, approvalId: `apr-${key}`, projectId: run.projectId, state: 'DENIED',
      decidedBy: 'ghu-founder', decisionReason: 'No.', decidedAt: new Date().toISOString(),
    });
    expect(await runState(run.runId), 'the denial landed and the run row never moved').toBe('READY');

    const store = createContextAndClaimHandoffs(createJuliusPostgresRuntimeStore(pool)).store;
    expect((await store.deniedApprovals(run.runId, run.projectId)).map((row) => row.approvalId), 'the production store reads it')
      .toEqual([`apr-${key}`]);
    const architect = scriptedAdapter(architectWorker({}), []);
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
    expect(outcome, 'ended, not stalled READY for ever').toMatchObject({ state: 'FAILED', stalled: false });
    expect(architect.dispatches.length + coder.dispatches.length + reviewer.dispatches.length, 'nothing dispatched').toBe(0);
    const last = await pool.query<{ to_state: string; reason_code: string }>(
      'SELECT to_state, reason_code FROM relay_wonderland.julius_transitions WHERE run_id=$1 ORDER BY sequence DESC LIMIT 1', [run.runId]);
    expect(last.rows[0], 'a RECORDED move, with the denial as its reason').toEqual({ to_state: 'FAILED', reason_code: 'APPROVAL_DENIED' });
    const announced = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM relay_wonderland.events WHERE stream_id=$1 AND event_type='julius.run.failed'`, [run.runId]);
    expect(announced.rows[0]!.n, 'and announced once').toBe(1);
  });

  const claimAs = async (owner: string, projectId: string) => {
    const now = new Date().toISOString();
    return runs.claimRunnable({ owner, now, leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(), limit: 4, projectId });
  };

  it('ADMISSION (F3): a run paused after its task was claimed spends no attempt; resumed, the same lease admits it', async () => {
    const run = await created();
    const owner = `admission-proof-${nonce()}`;
    const [task] = await claimAs(owner, run.projectId);
    expect(task?.taskId).toBe(run.planTaskId);
    await pool.query("UPDATE relay_wonderland.julius_runs SET state='PAUSED' WHERE run_id=$1", [run.runId]);

    const admit = () => runs.admitTask({ taskId: task!.taskId, owner, leaseGeneration: task!.leaseGeneration, now: new Date().toISOString() });
    expect(await admit(), 'the run refused the admission, not the lease').toEqual({ held: true, runState: 'PAUSED', pendingApprovals: 0, deniedApprovals: 0 });
    const spent = await pool.query<{ attempt: number; state: string }>('SELECT attempt, state FROM relay_wonderland.julius_tasks WHERE task_id=$1', [task!.taskId]);
    expect(spent.rows[0], 'nothing was spent, and the claimant still holds the lease').toEqual({ attempt: 0, state: 'ACTIVE' });

    await pool.query("UPDATE relay_wonderland.julius_runs SET state='READY' WHERE run_id=$1", [run.runId]);
    expect(await admit(), 'resumed, the same lease admits and spends attempt 1').toBe(1);
  });

  it('ADMISSION (F3): a PENDING or a DENIED approval written after the claim refuses the admission', async () => {
    const run = await created();
    const owner = `admission-proof-${nonce()}`;
    const [task] = await claimAs(owner, run.projectId);
    const key = nonce();
    await lifecycle.requestApproval(record(run, key));
    const admit = () => runs.admitTask({ taskId: task!.taskId, owner, leaseGeneration: task!.leaseGeneration, now: new Date().toISOString() });
    expect(await admit()).toEqual({ held: true, runState: 'READY', pendingApprovals: 1, deniedApprovals: 0 });
    await lifecycle.decideApproval({
      runId: run.runId, approvalId: `apr-${key}`, projectId: run.projectId, state: 'DENIED',
      decidedBy: 'ghu-founder', decisionReason: 'No.', decidedAt: new Date().toISOString(),
    });
    expect(await admit()).toEqual({ held: true, runState: 'READY', pendingApprovals: 0, deniedApprovals: 1 });
  });

  it('ADMISSION LOCK (F3): an admission that meets a pause still being written waits for it, then refuses', async () => {
    const run = await created();
    const owner = `admission-proof-${nonce()}`;
    const [task] = await claimAs(owner, run.projectId);
    const operator = await pool.connect();
    let admission: Promise<unknown> | null = null;
    try {
      await operator.query('BEGIN');
      await operator.query("UPDATE relay_wonderland.julius_runs SET state='PAUSED' WHERE run_id=$1", [run.runId]);
      admission = runs.admitTask({ taskId: task!.taskId, owner, leaseGeneration: task!.leaseGeneration, now: new Date().toISOString() });
      const early = await Promise.race([admission.then(() => 'answered'), new Promise((resolve) => setTimeout(() => resolve('waiting'), 500))]);
      expect(early, 'the admission waits on the run row the pause is writing').toBe('waiting');
      await operator.query('COMMIT');
    } catch (error) {
      await operator.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      operator.release();
    }
    expect(await admission, 'the pause committed first, and the admission saw it').toEqual({ held: true, runState: 'PAUSED', pendingApprovals: 0, deniedApprovals: 0 });
    const spent = await pool.query<{ attempt: number }>('SELECT attempt FROM relay_wonderland.julius_tasks WHERE task_id=$1', [task!.taskId]);
    expect(spent.rows[0]!.attempt).toBe(0);
  });

  it('ADMISSION (F3): a run already over, or BLOCKED, while its task is still ACTIVE refuses the admission (the cancel window)', async () => {
    // `cancelJuliusRun` moves the RUN first and sweeps its tasks after, so a claimant can reach
    // admission with its task still ACTIVE under a run that is already CANCELLED. Every state the
    // claim would not offer is held here, not only PAUSED: the review's mutant R3 held only PAUSED
    // and every other case in this suite passed it.
    for (const state of ['CANCELLED', 'FAILED', 'COMPLETED', 'BLOCKED'] as const) {
      const run = await created();
      const owner = `admission-proof-${nonce()}`;
      const [task] = await claimAs(owner, run.projectId);
      expect(task?.taskId).toBe(run.planTaskId);
      await pool.query('UPDATE relay_wonderland.julius_runs SET state=$2 WHERE run_id=$1', [run.runId, state]);
      const answer = await runs.admitTask({ taskId: task!.taskId, owner, leaseGeneration: task!.leaseGeneration, now: new Date().toISOString() });
      expect(answer, `a ${state} run refuses the admission`).toEqual({ held: true, runState: state, pendingApprovals: 0, deniedApprovals: 0 });
      const spent = await pool.query<{ attempt: number; state: string }>('SELECT attempt, state FROM relay_wonderland.julius_tasks WHERE task_id=$1', [task!.taskId]);
      expect(spent.rows[0], `${state}: nothing spent, and the task is still ACTIVE under its lease`).toEqual({ attempt: 0, state: 'ACTIVE' });
    }
  });

  it('THE GATE: one tick writes the PENDING approval and a RECORDED move to BLOCKED; a grant dispatches exactly the gated work', async () => {
    const run = await created();
    const store = createContextAndClaimHandoffs(createJuliusPostgresRuntimeStore(pool)).store;
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
      cardRevision: CARD, spendCeilingUsdMicros: 20_000_000, maxRepairRounds: 1, approvals: ['DISPATCH_WORKER'],
    });
    const dispatches = () => architect.dispatches.length + coder.dispatches.length + reviewer.dispatches.length;

    const first = await runtime.loop.tick({ projectId: run.projectId });
    expect(first.outcomes[0]).toMatchObject({ kind: 'APPROVAL_REQUIRED', reasonCode: 'CARD_APPROVAL_REQUIRED' });
    expect(dispatches(), 'nothing dispatched while the approval is pending').toBe(0);

    // THE APPROVAL ROW, keyed as the gate keys it.
    const approvals = await pool.query<{ approval_id: string; task_id: string; operation: string; state: string; policy_revision: string }>(
      'SELECT approval_id, task_id, operation, state, policy_revision FROM relay_wonderland.julius_approvals WHERE run_id=$1', [run.runId]);
    expect(approvals.rows).toHaveLength(1);
    const gate = approvals.rows[0]!;
    expect(gate).toMatchObject({ task_id: run.planTaskId, operation: 'DISPATCH_WORKER', state: 'PENDING', policy_revision: CARD });
    expect(gate.approval_id).toBe(juliusDispatchApprovalId({
      runId: run.runId, taskId: run.planTaskId, operation: 'DISPATCH_WORKER', capability: '', policyRevision: CARD,
    }));

    // THE RUN ROW and its RECORDED walk to BLOCKED — not a bare UPDATE.
    expect(await runState(run.runId)).toBe('BLOCKED');
    const transitions = await pool.query<{ from_state: string; to_state: string; reason_code: string }>(
      'SELECT from_state, to_state, reason_code FROM relay_wonderland.julius_transitions WHERE run_id=$1 ORDER BY sequence', [run.runId]);
    expect(transitions.rows.slice(-2)).toEqual([
      { from_state: 'READY', to_state: 'EXECUTING', reason_code: 'PASSED_THROUGH' },
      { from_state: 'EXECUTING', to_state: 'BLOCKED', reason_code: 'APPROVAL_REQUIRED' },
    ]);
    const announced = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM relay_wonderland.events WHERE stream_id=$1 AND event_type='julius.run.transitioned'`, [run.runId]);
    expect(announced.rows[0]!.n, 'each step announced').toBeGreaterThanOrEqual(2);

    // THE TASK: handed back, not failed, and no attempt spent.
    const task = await pool.query<{ state: string; attempt: number }>(
      'SELECT state, attempt FROM relay_wonderland.julius_tasks WHERE task_id=$1', [run.planTaskId]);
    expect(task.rows[0]).toEqual({ state: 'RUNNABLE', attempt: 0 });
    expect(await claim(run.projectId), 'and nothing is offered while it waits').toEqual([]);

    // A GRANT, through the one production decision path.
    const decided = await decideJuliusApproval({
      runId: run.runId, projectId: run.projectId, approvalId: gate.approval_id, decision: 'APPROVED',
      approverId: 'ghu-founder', reason: 'Plan dispatch approved.',
    }, {
      store: Object.assign(Object.create(null), {
        loadRun: runs.loadRun.bind(runs), transition: runs.transition.bind(runs),
        requestApproval: lifecycle.requestApproval.bind(lifecycle), loadApproval: lifecycle.loadApproval.bind(lifecycle),
        pendingApprovals: lifecycle.pendingApprovals.bind(lifecycle), decideApproval: lifecycle.decideApproval.bind(lifecycle),
        cancelRunTasks: lifecycle.cancelRunTasks.bind(lifecycle), recordLifecycle: lifecycle.recordLifecycle.bind(lifecycle),
      }),
      clock: { now: () => new Date().toISOString() }, approvers: anyone,
    });
    expect(decided).toMatchObject({ decided: true, state: 'APPROVED', runState: 'READY' });

    const second = await runtime.loop.tick({ projectId: run.projectId });
    expect(architect.dispatches, 'the granted plan dispatched, once').toHaveLength(1);
    expect(coder.dispatches.length + reviewer.dispatches.length, 'and nothing else').toBe(0);
    expect(second.outcomes.some((outcome) => outcome.kind === 'APPROVAL_REQUIRED'), 'the granted gate did not ask again').toBe(false);
    const after = await pool.query<{ state: string; decided_by: string }>(
      'SELECT state, decided_by FROM relay_wonderland.julius_approvals WHERE approval_id=$1', [gate.approval_id]);
    expect(after.rows[0]).toEqual({ state: 'APPROVED', decided_by: 'ghu-founder' });
  });
});
