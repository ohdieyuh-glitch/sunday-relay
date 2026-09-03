import { describe, expect, it } from 'vitest';

import {
  createJuliusHarness, seedRun, task, worker, cardPolicy, verificationPolicy, type ScriptedOutcome,
} from './julius-runtime-fixtures';
import { JuliusRunLoop } from './julius-run-loop';
import { prepareClaimedTask } from './julius-task-pipeline';
import { MAX_TASK_RECOVERIES, planJuliusRecovery } from './julius-recovery';
import { MAX_TASK_ATTEMPTS } from './julius-task-pipeline';

/**
 * A CLAIM IS NOT AN EXECUTION.
 *
 * `attempt` was incremented by `claimRunnable`, and the run loop claims BEFORE
 * it decides. It resolves the run's policy, compares the run's C.A.R.D.
 * concurrency allowance against what is already in flight, and hands back what
 * it cannot run — so a task could be claimed, handed straight back, and be one
 * attempt poorer with no worker ever dispatched.
 *
 * The first-live composition reaches that shape on every mission: a claim limit
 * of 4 against a C.A.R.D. concurrency of 1, and `build` plus the plan's review
 * task both claimable on the tick after the plan succeeds. A task yielded twice
 * arrived at its FIRST genuine dispatch carrying attempt 3 of 3, where a rate
 * limit is refused as `RETRY_ATTEMPTS_EXHAUSTED` without one provider call
 * having been made — after money had already been spent on the plan.
 *
 * These cases hold the boundary from both sides: a scheduling hand-back must
 * never spend an execution attempt, and a genuine execution must always spend
 * exactly one.
 */

const CODER = worker({ workerId: 'coder', role: 'CODING_AGENT', capabilities: ['implement'], taskTypes: ['build'] });
const SUCCESS = { kind: 'succeed' } as const;

/** One run, two tasks that are claimable together, one worker slot. */
function twoClaimableTasks(script: readonly ScriptedOutcome[] = [SUCCESS, SUCCESS]) {
  const harness = createJuliusHarness({
    workers: [{ worker: CODER, script }],
    // THE LIVE SHAPE. The claim limit is deliberately wider than the run's
    // allowance — that is exactly the production configuration, and it is what
    // makes a hand-back the normal case rather than an edge one.
    config: { claimLimit: 4 },
    card: cardPolicy({ allowedProviders: [CODER.providerId], concurrency: 1 }),
  });
  const { runId, projectId } = seedRun(harness, {
    tasks: [
      task({ taskId: 'a', ordinal: 0, state: 'RUNNABLE' }),
      task({ taskId: 'b', ordinal: 1, state: 'RUNNABLE' }),
    ],
  });
  return { harness, runId, projectId };
}

describe('an execution attempt is spent at admission, never at the claim', () => {
  /* ------------------------------------------------------------- CASE A --- */
  it('CASE A: a task that is claimed and admitted runs as attempt 1', async () => {
    const harness = createJuliusHarness({ workers: [{ worker: CODER, script: [SUCCESS] }] });
    const { projectId } = seedRun(harness, { tasks: [task({ taskId: 'only' })] });

    expect(harness.store.taskRow('only')!.attempt, 'nothing has run yet').toBe(0);
    const report = await harness.loop.tick({ projectId });

    expect(report.outcomes).toHaveLength(1);
    expect(harness.store.taskRow('only')!.attempt, 'one execution, one attempt').toBe(1);
  });

  /* ------------------------------------------------------------- CASE B --- */
  it('CASE B: a concurrency hand-back costs a lease generation and no attempt', async () => {
    const { harness, projectId } = twoClaimableTasks();
    const report = await harness.loop.tick({ projectId });

    expect(report.claimed, 'the claim limit offers both').toBe(2);
    expect(report.yieldedForConcurrency, 'the allowance admits one').toBe(1);
    expect(report.outcomes, 'and exactly one executed').toHaveLength(1);

    const rows = ['a', 'b'].map((id) => harness.store.taskRow(id)!);
    const [admitted, yielded] = rows[0]!.state === 'RUNNABLE' ? [rows[1]!, rows[0]!] : [rows[0]!, rows[1]!];
    expect(admitted.attempt, 'the admitted task spent one').toBe(1);
    expect(yielded.attempt, 'THE HANDED-BACK TASK SPENT NONE').toBe(0);
    expect(yielded.state, 'and it is claimable again immediately').toBe('RUNNABLE');
    expect(yielded.leaseGeneration, 'the claim it did take is still visible as ownership').toBeGreaterThan(0);
  });

  /* ------------------------------------------------------------- CASE C --- */
  it('CASE C: a task handed back repeatedly still executes as attempt 1', async () => {
    // Three tasks, one slot: on each tick the loop claims all three, admits one
    // and hands two back. The task that runs LAST has been yielded twice, which
    // is the shape that used to arrive at attempt 3 of 3.
    const harness = createJuliusHarness({
      workers: [{ worker: CODER, script: [SUCCESS, SUCCESS, SUCCESS] }],
      config: { claimLimit: 4 },
      card: cardPolicy({ allowedProviders: [CODER.providerId], concurrency: 1 }),
    });
    const { projectId } = seedRun(harness, {
      tasks: [
        task({ taskId: 'a', ordinal: 0 }), task({ taskId: 'b', ordinal: 1 }), task({ taskId: 'c', ordinal: 2 }),
      ],
    });

    const yieldedTwice = 'c';
    await harness.loop.tick({ projectId });
    await harness.loop.tick({ projectId });
    expect(harness.store.taskRow(yieldedTwice)!.attempt, 'two hand-backs, no execution, no attempt').toBe(0);
    const generationAfterTwoYields = harness.store.taskRow(yieldedTwice)!.leaseGeneration;
    expect(generationAfterTwoYields, 'but it really was claimed twice').toBe(2);

    await harness.loop.tick({ projectId });
    const row = harness.store.taskRow(yieldedTwice)!;
    expect(row.state, 'it finally ran').toBe('SUCCEEDED');
    expect(row.attempt, 'ITS FIRST EXECUTION IS ATTEMPT 1, not 3').toBe(1);
    expect(row.attempt, 'and it is nowhere near the ceiling').toBeLessThan(MAX_TASK_ATTEMPTS);
  });

  /* ------------------------------------------------------------- CASE D --- */
  it('CASE D: a retryable worker failure makes the next genuine execution attempt 2', async () => {
    const harness = createJuliusHarness({
      workers: [{ worker: CODER, script: [{ kind: 'fail', code: 'RATE_LIMIT' }, SUCCESS] }],
      card: cardPolicy({ allowedProviders: [CODER.providerId], automaticRetry: true }),
    });
    const { projectId } = seedRun(harness, { tasks: [task({ taskId: 'only' })] });

    await harness.loop.tick({ projectId });
    expect(harness.store.taskRow('only')!.attempt, 'the failed execution counted').toBe(1);
    expect(harness.store.taskRow('only')!.state, 'and it was handed back for a retry').toBe('RUNNABLE');

    await harness.loop.tick({ projectId });
    const row = harness.store.taskRow('only')!;
    expect(row.attempt, 'the retry is the SECOND execution').toBe(2);
    expect(row.state).toBe('SUCCEEDED');
  });

  /* ------------------------------------------------------------- CASE E --- */
  it('CASE E: scheduling yields alone can never exhaust the worker retry budget', async () => {
    // Four ticks of pure hand-back for the last task, then its first execution.
    // Under claim-counting it would have been refused before running at all.
    const harness = createJuliusHarness({
      workers: [{ worker: CODER, script: [SUCCESS, SUCCESS, SUCCESS, SUCCESS, SUCCESS] }],
      config: { claimLimit: 8 },
      card: cardPolicy({ allowedProviders: [CODER.providerId], concurrency: 1, automaticRetry: true }),
    });
    const { projectId } = seedRun(harness, {
      tasks: ['a', 'b', 'c', 'd', 'e'].map((id, index) => task({ taskId: id, ordinal: index })),
    });

    for (let tick = 0; tick < 4; tick += 1) await harness.loop.tick({ projectId });
    const last = harness.store.taskRow('e')!;
    expect(last.state, 'still waiting its turn').toBe('RUNNABLE');
    expect(last.leaseGeneration, 'claimed and yielded on every tick').toBe(4);
    expect(last.attempt, 'and it has spent nothing').toBe(0);

    await harness.loop.tick({ projectId });
    expect(harness.store.taskRow('e')!.attempt, 'its first execution is attempt 1').toBe(1);
    expect(harness.store.taskRow('e')!.state).toBe('SUCCEEDED');
  });

  /* ------------------------------------------------------------- CASE F --- */
  it('CASE F: a non-retryable failure still ends the task FAILED, with one attempt spent', async () => {
    const harness = createJuliusHarness({
      workers: [{ worker: CODER, script: [{ kind: 'fail', code: 'AUTH_CONFIGURATION' }] }],
      card: cardPolicy({ allowedProviders: [CODER.providerId], automaticRetry: true }),
    });
    const { projectId } = seedRun(harness, { tasks: [task({ taskId: 'only' })] });

    await harness.loop.tick({ projectId });
    const row = harness.store.taskRow('only')!;
    expect(row.state, 'no hidden retry').toBe('FAILED');
    expect(row.attempt, 'the execution that failed is still an execution').toBe(1);

    // A second tick must not resurrect it.
    await harness.loop.tick({ projectId });
    expect(harness.store.taskRow('only')!.state).toBe('FAILED');
    expect(harness.store.taskRow('only')!.attempt).toBe(1);
  });

  /* ------------------------------------------------------------- CASE G --- */
  it('CASE G: a crash between claim and admission spends no attempt, and cannot loop forever', async () => {
    const harness = createJuliusHarness({ workers: [{ worker: CODER, script: [SUCCESS] }] });
    const { runId, projectId } = seedRun(harness, { tasks: [task({ taskId: 'only' })] });

    // Claim without admitting — exactly what a process that dies between the
    // two leaves behind — then expire the lease, as a restart does.
    for (let round = 1; round <= MAX_TASK_RECOVERIES; round += 1) {
      const claimed = await harness.deps.store.claimRunnable({
        owner: 'worker-a', now: harness.clock.now(), leaseExpiresAt: harness.clock.now(),
        limit: 1, projectId,
      });
      expect(claimed, `round ${round} claimed the task`).toHaveLength(1);
      expect(harness.store.taskRow('only')!.attempt, 'a claim that never admitted spends nothing').toBe(0);
      const actions = await harness.store.recoverExpired(harness.clock.now(), 10, projectId);
      expect(actions[0]!.runId).toBe(runId);
      if (round < MAX_TASK_RECOVERIES) {
        expect(actions[0]!.action, `round ${round} is still recoverable`).toBe('REQUEUE');
      }
    }

    // The bound is the RECOVERY counter, because the attempt counter — correctly
    // — never moved. Without it this loop has nothing that terminates it.
    const row = harness.store.taskRow('only')!;
    expect(row.recoveries, 'each requeue was counted').toBe(MAX_TASK_RECOVERIES);
    expect(row.attempt, 'and no execution was ever charged').toBe(0);

    await harness.deps.store.claimRunnable({
      owner: 'worker-a', now: harness.clock.now(), leaseExpiresAt: harness.clock.now(), limit: 1, projectId,
    });
    const final = await harness.store.recoverExpired(harness.clock.now(), 10, projectId);
    expect(final[0]!.action, 'the recovery loop is bounded').toBe('FAIL_TASK');
    expect(final[0]!.reasonCode, 'and it names the bound that stopped it').toBe('RECOVERY_LIMIT_REACHED');
    expect(harness.store.taskRow('only')!.state).toBe('FAILED');
  });

  /* ------------------------------------------------------------- CASE H --- */
  it('CASE H: a crash after admission has spent its attempt, conservatively', async () => {
    const harness = createJuliusHarness({ workers: [{ worker: CODER, script: [SUCCESS] }] });
    const { projectId } = seedRun(harness, { tasks: [task({ taskId: 'only' })] });

    const [claim] = await harness.deps.store.claimRunnable({
      owner: 'worker-a', now: harness.clock.now(), leaseExpiresAt: harness.clock.now(), limit: 1, projectId,
    });
    const admitted = await harness.deps.store.admitTask({
      taskId: 'only', owner: 'worker-a', leaseGeneration: claim!.leaseGeneration, now: harness.clock.now(),
    });
    expect(admitted, 'the attempt is durable BEFORE any dispatch could happen').toBe(1);

    // The worker dies here. A provider may or may not have been called; the
    // durable record already assumes it was, which is the safe direction.
    const actions = await harness.store.recoverExpired(harness.clock.now(), 10, projectId);
    expect(actions[0]!.action).toBe('REQUEUE');
    const row = harness.store.taskRow('only')!;
    expect(row.attempt, 'the attempt is NOT refunded').toBe(1);
    expect(row.recoveries, 'and the recovery is counted separately').toBe(1);
  });

  /* ------------------------------------------------------------- CASE I --- */
  it('CASE I: a stale lease cannot admit, and cannot spend an attempt', async () => {
    const harness = createJuliusHarness({ workers: [{ worker: CODER, script: [SUCCESS] }] });
    const { projectId } = seedRun(harness, { tasks: [task({ taskId: 'only' })] });

    const [first] = await harness.deps.store.claimRunnable({
      owner: 'worker-a', now: harness.clock.now(), leaseExpiresAt: harness.clock.now(), limit: 1, projectId,
    });
    // The lease expires and another worker takes it.
    await harness.store.recoverExpired(harness.clock.now(), 10, projectId);
    const [second] = await harness.deps.store.claimRunnable({
      owner: 'worker-b', now: harness.clock.now(), leaseExpiresAt: '2099-01-01T00:00:00.000Z', limit: 1, projectId,
    });
    expect(second!.leaseGeneration, 'a new generation').toBeGreaterThan(first!.leaseGeneration);

    const stale = await harness.deps.store.admitTask({
      taskId: 'only', owner: 'worker-a', leaseGeneration: first!.leaseGeneration, now: harness.clock.now(),
    });
    expect(stale, 'the previous holder has no authority').toBeNull();
    expect(harness.store.taskRow('only')!.attempt, 'and spent nothing').toBe(0);

    const wrongOwner = await harness.deps.store.admitTask({
      taskId: 'only', owner: 'worker-c', leaseGeneration: second!.leaseGeneration, now: harness.clock.now(),
    });
    expect(wrongOwner, 'nor does a stranger holding the right generation').toBeNull();
    expect(harness.store.taskRow('only')!.attempt).toBe(0);

    const rightful = await harness.deps.store.admitTask({
      taskId: 'only', owner: 'worker-b', leaseGeneration: second!.leaseGeneration, now: harness.clock.now(),
    });
    expect(rightful, 'the current holder can').toBe(1);
  });

  /* ------------------------------------------------------------- CASE L --- */
  it('CASE L: a lease lost between claim and admission runs nothing and holds no slot', async () => {
    const { harness, projectId } = twoClaimableTasks();
    // The first admission loses its race; the second must still be admitted,
    // because the task that lost is not running and is not occupying the run's
    // allowance of one.
    let refusals = 0;
    const store = {
      ...harness.deps.store,
      admitTask: async (input: Parameters<typeof harness.deps.store.admitTask>[0]) => {
        if (refusals === 0) { refusals += 1; return null; }
        return harness.deps.store.admitTask(input);
      },
    } as typeof harness.deps.store;
    const loop = new JuliusRunLoop({ ...harness.deps, store }, harness.policies, { claimLimit: 4, leaseMs: 60_000 });

    const report = await loop.tick({ projectId });
    expect(refusals, 'the first admission was refused').toBe(1);
    expect(report.lostLeases, 'and the tick says so, distinctly from a hand-back').toBe(1);
    expect(report.outcomes, 'the other task still ran — the lost lease held no slot').toHaveLength(1);

    const rows = ['a', 'b'].map((id) => harness.store.taskRow(id)!);
    expect(rows.filter((row) => row.attempt === 1), 'exactly one execution was charged').toHaveLength(1);
    expect(rows.filter((row) => row.attempt === 0), 'and the refused one was charged nothing').toHaveLength(1);
  });

  /* ------------------------------------------------------------- CASE G2 -- */
  it('CASE G2: a reclaimed expired lease is counted, and the reclaim loop is bounded', async () => {
    // THE BOUND ONLY EXISTS IF THE SWEEP RUNS. The claim query USED to also
    // offer an ACTIVE task whose lease had expired, and that path reclaimed
    // WITHOUT counting — so a task claimed by a worker that died before
    // admission could be picked up forever: `attempt` stays 0 because nothing
    // ran, and the counter that bounds this loop was never reached. That
    // branch is gone, and `tick` sweeps before it claims.
    const harness = createJuliusHarness({ workers: [{ worker: CODER, script: [SUCCESS] }] });
    const { projectId } = seedRun(harness, { tasks: [task({ taskId: 'only' })] });

    for (let round = 0; round < MAX_TASK_RECOVERIES + 1; round += 1) {
      await harness.loop.recover({ projectId }, harness.store);
      // A worker claims and dies before admitting; the lease is already expired.
      await harness.deps.store.claimRunnable({
        owner: 'dying-worker', now: harness.clock.now(), leaseExpiresAt: harness.clock.now(),
        limit: 1, projectId,
      });
    }
    await harness.loop.recover({ projectId }, harness.store);

    const row = harness.store.taskRow('only')!;
    expect(row.attempt, 'nothing ever executed, so nothing was charged').toBe(0);
    expect(row.state, 'and the churn is terminated rather than endless').toBe('FAILED');
    expect(row.recoveries, 'by the counter written for exactly this loop')
      .toBeGreaterThanOrEqual(MAX_TASK_RECOVERIES);
  });

  /* ------------------------------------------------ the policy gate matrix -- */
  /**
   * A REFUSAL IS NOT AN EXECUTION.
   *
   * Admission used to happen in the run loop BEFORE the pipeline evaluated the
   * task-level gates, so a C.A.R.D. that denied the capability, an approval
   * nobody had given, or a role Julius could not resolve each spent one of the
   * task's three attempts on work Julius had just decided not to do. The gates
   * answer first now, and the attempt is spent only once nothing can refuse it.
   */
  describe('a pre-execution refusal spends no execution attempt', () => {
    const refusals = [
      ['a C.A.R.D. that denies the capability', { card: cardPolicy({ allowedProviders: [CODER.providerId], capabilities: [] }) }, 'DENIED'],
      ['an approval nobody has given', { card: cardPolicy({ allowedProviders: [CODER.providerId], approvals: ['DISPATCH_WORKER'] }) }, 'APPROVAL_REQUIRED'],
    ] as const;

    it.each(refusals)('%s refuses without admitting', async (_name, overrides, kind) => {
      const harness = createJuliusHarness({ workers: [{ worker: CODER, script: [SUCCESS] }], ...overrides });
      const { projectId } = seedRun(harness, { tasks: [task({ taskId: 'only' })] });

      const report = await harness.loop.tick({ projectId });
      expect(report.outcomes[0]?.kind, 'the gate refused it').toBe(kind);
      expect(report.refusedBeforeAdmission, 'and the tick says so').toBe(1);
      expect(harness.store.taskRow('only')!.attempt, 'NO ATTEMPT WAS SPENT ON WORK JULIUS REFUSED').toBe(0);
      expect(harness.store.taskRow('only')!.leaseGeneration, 'though it really was claimed').toBe(1);
      expect(harness.adapters.get(CODER.adapterId)!.dispatches, 'and no worker ran').toHaveLength(0);
    });

    it('an unresolvable role refuses without admitting', async () => {
      const harness = createJuliusHarness({ workers: [{ worker: CODER, script: [SUCCESS] }] });
      const { projectId } = seedRun(harness, { tasks: [task({ taskId: 'only', role: 'SPECIALIST:' as never })] });

      const report = await harness.loop.tick({ projectId });
      expect(report.outcomes[0]).toMatchObject({ kind: 'HALTED', reasonCode: 'UNRESOLVED_WORKER_ROLE' });
      expect(report.refusedBeforeAdmission).toBe(1);
      expect(harness.store.taskRow('only')!.attempt, 'a role Julius cannot resolve is not an execution').toBe(0);
      expect(harness.adapters.get(CODER.adapterId)!.dispatches).toHaveLength(0);
    });

    /**
     * TENANCY REFUSES, AND WRITES NOTHING.
     *
     * Stated plainly: this gate is NOT reachable through the run loop, because
     * `resolvePolicy` loads the run first and a run it cannot load is skipped
     * before the gates run at all. So this drives the gate directly and claims
     * only what that proves — the refusal happens, and it writes nothing into
     * another tenant's stream. The ORDER of admission against the gates is
     * proven by the three cases above, which do go through `tick`.
     */
    it('a run outside this scope refuses, and writes nothing', async () => {
      const harness = createJuliusHarness({ workers: [{ worker: CODER, script: [SUCCESS] }] });
      seedRun(harness, { tasks: [task({ taskId: 'only' })] });
      const [claim] = await harness.deps.store.claimRunnable({
        owner: 'worker-a', now: harness.clock.now(), leaseExpiresAt: '2099-01-01T00:00:00.000Z',
        limit: 1, projectId: 'prj-1',
      });
      const before = harness.store.events().length;

      const preflight = await prepareClaimedTask(
        { claim: claim!, policy: cardPolicy(), verification: verificationPolicy(), capability: 'implement' },
        harness.deps, { projectId: 'prj-somebody-else' },
      );
      expect(preflight).toMatchObject({ kind: 'REFUSED', outcome: { reasonCode: 'RUN_NOT_IN_SCOPE' } });
      expect(harness.store.events().length, 'not even a failure event reaches another tenant').toBe(before);
      expect(harness.store.taskRow('only')!.attempt, 'and no attempt is spent').toBe(0);
    });

    it('a task that passes every gate is admitted, and runs as attempt 1', async () => {
      const harness = createJuliusHarness({ workers: [{ worker: CODER, script: [SUCCESS] }] });
      const { projectId } = seedRun(harness, { tasks: [task({ taskId: 'only' })] });

      const report = await harness.loop.tick({ projectId });
      expect(report.refusedBeforeAdmission, 'nothing refused it').toBe(0);
      expect(harness.store.taskRow('only')!.attempt).toBe(1);
      expect(harness.adapters.get(CODER.adapterId)!.dispatches, 'and the worker really ran').toHaveLength(1);
    });

    /**
     * THE LEASE MOVES BETWEEN THE GATES AND THE ADMISSION.
     *
     * The gates take real time — they read the run, the task row and the
     * C.A.R.D. — so a lease can expire and be reclaimed in between. The old
     * owner must execute nothing and spend nothing; the attempt belongs to
     * whoever holds the lease now.
     */
    it('a lease reclaimed while a worker decides admits nobody stale', async () => {
      const harness = createJuliusHarness({ workers: [{ worker: CODER, script: [SUCCESS] }] });
      const { projectId } = seedRun(harness, { tasks: [task({ taskId: 'only' })] });

      const [stale] = await harness.deps.store.claimRunnable({
        owner: 'worker-a', now: harness.clock.now(), leaseExpiresAt: harness.clock.now(),
        limit: 1, projectId,
      });
      // The lease expires and recovery hands it back — the one path from an
      // expired lease — then another worker takes it while the first is still
      // deciding.
      await harness.loop.recover({ projectId }, harness.store);
      await harness.deps.store.claimRunnable({
        owner: 'worker-b', now: harness.clock.now(), leaseExpiresAt: '2099-01-01T00:00:00.000Z',
        limit: 1, projectId,
      });

      const admitted = await harness.deps.store.admitTask({
        taskId: 'only', owner: 'worker-a', leaseGeneration: stale!.leaseGeneration, now: harness.clock.now(),
      });
      expect(admitted, 'the stale owner is refused at the admission boundary').toBeNull();
      expect(harness.store.taskRow('only')!.attempt, 'and spends nothing').toBe(0);
    });
  });

  /* ------------------------------------------- the one path from an expiry -- */
  /**
   * AN EXPIRED LEASE HAS EXACTLY ONE WAY BACK.
   *
   * The claim query used to also offer an ACTIVE task whose lease had expired,
   * which reclaimed it while raising only `lease_generation` — so a task that
   * was claimed and died before admission could be picked up forever, past
   * `MAX_TASK_RECOVERIES`, with no `recovery.action` row and no terminal
   * behaviour. Recovery is the only path now, and it runs inside `tick` rather
   * than in whichever driver remembers to call it.
   */
  describe('an expired lease is reclaimable only through bounded recovery', () => {
    const expiredClaim = async (harness: ReturnType<typeof createJuliusHarness>, projectId: string, limit = 1) =>
      harness.deps.store.claimRunnable({
        owner: 'dying-worker', now: harness.clock.now(), leaseExpiresAt: harness.clock.now(), limit, projectId,
      });

    it('the claim query refuses an expired ACTIVE task outright', async () => {
      const harness = createJuliusHarness({ workers: [{ worker: CODER, script: [SUCCESS] }] });
      const { projectId } = seedRun(harness, { tasks: [task({ taskId: 'only' })] });

      await expiredClaim(harness, projectId);
      expect(harness.store.taskRow('only')!.state).toBe('ACTIVE');

      const second = await harness.deps.store.claimRunnable({
        owner: 'another-worker', now: harness.clock.now(), leaseExpiresAt: '2099-01-01T00:00:00.000Z',
        limit: 5, projectId,
      });
      expect(second, 'a bare claim cannot take it — that path bypassed the ceiling').toHaveLength(0);
      expect(harness.store.taskRow('only')!.recoveries, 'and nothing was counted').toBe(0);
    });

    it('recovery hands it back, counted, and then it is claimable', async () => {
      const harness = createJuliusHarness({ workers: [{ worker: CODER, script: [SUCCESS] }] });
      const { projectId } = seedRun(harness, { tasks: [task({ taskId: 'only' })] });

      await expiredClaim(harness, projectId);
      await harness.loop.recover({ projectId }, harness.store);

      const row = harness.store.taskRow('only')!;
      expect(row.state, 'handed back').toBe('RUNNABLE');
      expect(row.recoveries, 'and counted on the way').toBe(1);
      expect(row.attempt, 'while the abandoned claim still spent no attempt').toBe(0);

      const claimed = await harness.deps.store.claimRunnable({
        owner: 'another-worker', now: harness.clock.now(), leaseExpiresAt: '2099-01-01T00:00:00.000Z',
        limit: 5, projectId,
      });
      expect(claimed.map((entry) => entry.taskId)).toContain('only');
    });

    it('tick itself sweeps, so no driver can bypass the invariant by ticking differently', async () => {
      const harness = createJuliusHarness({ workers: [{ worker: CODER, script: [SUCCESS] }] });
      const { projectId } = seedRun(harness, { tasks: [task({ taskId: 'only' })] });

      await expiredClaim(harness, projectId);
      // No explicit recover() call here — only the loop's own tick.
      const report = await harness.loop.tick({ projectId });

      expect(harness.store.taskRow('only')!.recoveries, 'the kernel swept').toBe(1);
      expect(report.outcomes[0]?.kind, 'and the recovered task ran in the same tick').toBe('COMPLETED');
      expect(harness.store.taskRow('only')!.attempt, 'as its first execution').toBe(1);
    });

    /**
     * MORE EXPIRED TASKS THAN ONE SWEEP TAKES.
     *
     * The sweep is bounded by the claim limit, so a burst of expiries is
     * carried across ticks. What must NOT happen is the claim query picking up
     * the remainder outside the bound — the leftovers stay ACTIVE and wait for
     * the next sweep rather than being reclaimed uncounted.
     */
    it('leftovers beyond one sweep are not reclaimable outside recovery', async () => {
      const harness = createJuliusHarness({
        workers: [{ worker: CODER, script: [SUCCESS, SUCCESS, SUCCESS] }],
        config: { claimLimit: 1 },
      });
      const { projectId } = seedRun(harness, {
        tasks: ['a', 'b', 'c'].map((id, index) => task({ taskId: id, ordinal: index })),
      });
      await expiredClaim(harness, projectId, 3);
      for (const id of ['a', 'b', 'c']) expect(harness.store.taskRow(id)!.state).toBe('ACTIVE');

      await harness.loop.recover({ projectId }, harness.store, 1);
      const recovered = ['a', 'b', 'c'].filter((id) => harness.store.taskRow(id)!.state === 'RUNNABLE');
      expect(recovered, 'the sweep took only its limit').toHaveLength(1);

      const claimed = await harness.deps.store.claimRunnable({
        owner: 'another-worker', now: harness.clock.now(), leaseExpiresAt: '2099-01-01T00:00:00.000Z',
        limit: 5, projectId,
      });
      expect(claimed.map((entry) => entry.taskId), 'only the recovered one is claimable').toEqual(recovered);
      for (const id of ['a', 'b', 'c']) {
        if (recovered.includes(id)) continue;
        expect(harness.store.taskRow(id)!.state, `${id} waits for the next sweep`).toBe('ACTIVE');
        expect(harness.store.taskRow(id)!.recoveries, `${id} was not counted by a bypass`).toBe(0);
      }
    });
  });

  /* ---------------------------------------- one trajectory row per recovery */
  it('records one RECOVERY trajectory row per reclaim, not one per run version', async () => {
    // A recovery does not change the run's version, and every REQUEUE carries
    // the same reason — so keyed by run version alone, a task crash-looping
    // before admission recorded ONE row for three reclaims, and the eval metric
    // that counts recoveries under-reported in the one scenario it is for.
    const harness = createJuliusHarness({ workers: [{ worker: CODER, script: [SUCCESS] }] });
    const { projectId } = seedRun(harness, { tasks: [task({ taskId: 'only' })] });

    for (let round = 0; round < 3; round += 1) {
      await harness.deps.store.claimRunnable({
        owner: 'dying-worker', now: harness.clock.now(), leaseExpiresAt: harness.clock.now(),
        limit: 1, projectId,
      });
      await harness.loop.recover({ projectId }, harness.store);
    }

    const rows = harness.store.trajectory().filter((event) => event.kind === 'RECOVERY');
    expect(rows.length, 'each reclaim is its own row, because each follows its own claim').toBe(3);
    expect(new Set(rows.map((row) => row.idempotencyKey)).size, 'and each carries a distinct key').toBe(3);
  });

  /* ---------------------------------------------- the planner, in isolation */
  it('the recovery planner reports the execution ceiling before the recovery one', () => {
    const base = {
      runId: 'r', projectId: 'p', runState: 'EXECUTING' as const, taskId: 't',
      maxRetries: MAX_TASK_ATTEMPTS - 1, leaseGeneration: 1,
    };
    expect(planJuliusRecovery({ ...base, attempt: 0, recoveries: 0 }).action).toBe('REQUEUE');
    expect(planJuliusRecovery({ ...base, attempt: MAX_TASK_ATTEMPTS, recoveries: 0 }).reasonCode)
      .toBe('RETRIES_EXHAUSTED');
    expect(planJuliusRecovery({ ...base, attempt: 0, recoveries: MAX_TASK_RECOVERIES }).reasonCode)
      .toBe('RECOVERY_LIMIT_REACHED');
    // A task that has exhausted both reports the executions, because that is
    // the cause an operator acts on.
    expect(planJuliusRecovery({ ...base, attempt: MAX_TASK_ATTEMPTS, recoveries: MAX_TASK_RECOVERIES }).reasonCode)
      .toBe('RETRIES_EXHAUSTED');
    // Omitted behaves exactly as before this change.
    expect(planJuliusRecovery({ ...base, attempt: 0 }).action).toBe('REQUEUE');
  });
});
