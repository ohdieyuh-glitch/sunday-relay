import { describe, expect, it } from 'vitest';

import { injectJuliusFault } from './julius-fault-injection';
import { JuliusRunLoop } from './julius-run-loop';
import { createJuliusHarness, seedRun, task, worker, cardPolicy } from './julius-runtime-fixtures';

/**
 * CRASH AT EVERY BOUNDARY, THEN RESTART.
 *
 * "The runtime recovers" is a claim about what happens when a process dies at
 * a specific instant. Those instants are the transaction boundaries, and a
 * test cannot reach them by waiting — it has to cause them. Each case below
 * fails ONE named store call, then restarts and asserts the runtime reaches a
 * deterministic state and nothing ran twice.
 *
 * WHAT A PASS PROVES: the runtime's logic. Not PostgreSQL — a real database
 * can also roll back a transaction this model treats as committed, and
 * `julius-memory-store.ts` states that limit rather than implying it is
 * covered.
 */

const CODER = worker({ workerId: 'coder', role: 'CODING_AGENT', capabilities: ['implement'], taskTypes: ['build'] });
const scope = { projectId: 'prj-1' };

const build = (script: Parameters<typeof createJuliusHarness>[0]['workers'][0]['script'] = [{ kind: 'succeed' }, { kind: 'succeed' }, { kind: 'succeed' }]) => {
  const harness = createJuliusHarness({
    workers: [{ worker: CODER, script }],
    card: cardPolicy({ allowedProviders: [CODER.providerId] }),
  });
  seedRun(harness, { tasks: [task({ taskId: 'task-1' })] });
  return harness;
};

/** Run one tick against a store that fails at a named boundary. */
const crashAt = async (
  harness: ReturnType<typeof build>,
  method: string,
  onCall = 1,
) => {
  const faulted = injectJuliusFault(harness.store, { method, onCall });
  const loop = new JuliusRunLoop(
    { ...harness.deps, store: faulted.store }, harness.policies, { claimLimit: 5, leaseMs: 60_000 },
  );
  let threw = false;
  try { await loop.tick(scope); } catch { threw = true; }
  return { report: faulted.report, threw };
};

/* --------------------------------------------------- each boundary in turn */

describe('a crash at each transaction boundary', () => {
  /**
   * `finishTask` IS ABSENT FROM THIS LIST ON PURPOSE, and its absence is a
   * property rather than an oversight. `acceptWorkerResult` moves the task out
   * of ACTIVE inside its own transaction, so on the SUCCESS path `finishTask`
   * is never called — calling it there would be a second writer for one fact.
   * It is exercised below on the failure path, where it is the writer.
   */
  const BOUNDARIES = [
    'claimRunnable', 'loadRun', 'tasksForRun', 'persist', 'appendEvidence',
    'acceptWorkerResult', 'appendDecision', 'appendEvent', 'appendTrajectory',
    'transition',
  ];

  for (const method of BOUNDARIES) {
    it(`fails at ${method} and leaves the run in a state a restart can resume`, async () => {
      const harness = build();
      const { report } = await crashAt(harness, method);
      expect(report.fired, `${method} was never reached`).toBe(true);

      // Whatever happened, the durable state is coherent: a task is in exactly
      // one state, and the run is in a state the transition table permits.
      const row = harness.store.taskRow('task-1');
      expect(row).not.toBeNull();
      expect(['BLOCKED', 'RUNNABLE', 'ACTIVE', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'SKIPPED'])
        .toContain(row!.state);

      // And a restart makes progress rather than wedging.
      harness.store.restart();
      const resumed = new JuliusRunLoop(
        { ...harness.deps, owner: 'worker-after-crash' }, harness.policies,
        { claimLimit: 5, leaseMs: 60_000 },
      );
      await resumed.tick(scope);
      await resumed.tick(scope);
      const after = harness.store.taskRow('task-1')!;
      expect(['SUCCEEDED', 'FAILED', 'RUNNABLE', 'ACTIVE'], `${method} wedged in ${after.state}`)
        .toContain(after.state);
    });
  }

  it('fails at finishTask on the failure path, where finishTask is the writer', async () => {
    const harness = build([{ kind: 'fail', code: 'AUTH_CONFIGURATION' }, { kind: 'succeed' }]);
    const { report } = await crashAt(harness, 'finishTask');
    expect(report.fired, 'finishTask was never reached on the failure path').toBe(true);

    // The task is still ACTIVE with a lease nobody is holding — precisely the
    // shape a crashed worker leaves, and precisely what the expired-lease path
    // is written to find.
    expect(harness.store.taskRow('task-1')!.state).toBe('ACTIVE');
    harness.store.restart();
    const resumed = new JuliusRunLoop(
      { ...harness.deps, owner: 'worker-after-crash' }, harness.policies,
      { claimLimit: 5, leaseMs: 60_000 },
    );
    await resumed.tick(scope);
    expect(harness.store.taskRow('task-1')!.state).not.toBe('ACTIVE');
  });
});
/* ---------------------------------------------- the expensive double-run */

/**
 * THE WINDOW THAT STRANDED A RUN, AND WHAT THE OLD ASSERTION MISSED.
 *
 * `acceptWorkerResult` moves a task out of ACTIVE in its own transaction; the
 * verification decision is a SEPARATE write. A process that dies between them
 * leaves a SUCCEEDED task with no decision, and nothing ever looks at it again:
 * the claim query offers RUNNABLE tasks only, so the run parks in VERIFYING
 * permanently.
 *
 * The boundary loop above reached this exact window and passed, because it asked
 * whether the task wedged in an IMPOSSIBLE state. It did not. A mission that
 * never finishes, in a perfectly legal state, with the money already spent, is
 * the failure that question cannot see — so this asks the other one: does the
 * run still REACH a terminal state?
 */
describe('a crash between accepting a result and recording its decision', () => {
  const advanceUntilTerminal = async (harness: ReturnType<typeof build>, ticks = 12) => {
    for (let index = 0; index < ticks; index += 1) {
      const report = await harness.loop.tick(scope);
      if (report.claimed === 0) {
        const advance = await harness.loop.advanceRun('run-1', 'prj-1');
        if (advance === null || (!advance.changed && advance.resumedVerifications === 0)) break;
      }
    }
    return harness.store.loadRun('run-1', 'prj-1');
  };

  it('strands nothing: the restart runs the verification that never ran, and the run completes', async () => {
    const harness = build();
    const { report } = await crashAt(harness, 'appendDecision');
    expect(report.fired, 'the boundary was reached').toBe(true);

    // The shape the crash leaves: the work is durably done and unjudged.
    expect(harness.store.taskRow('task-1')!.state).toBe('SUCCEEDED');
    expect(await harness.store.decisionsForRun('run-1', 'prj-1')).toEqual([]);

    harness.store.restart();
    const run = await advanceUntilTerminal(harness);

    expect(await harness.store.decisionsForRun('run-1', 'prj-1'), 'the decision was resumed')
      .toHaveLength(1);
    expect(run?.state, 'and the run reached a terminal state rather than parking forever')
      .toBe('COMPLETED');
    // AND IT WAS NOT PAID FOR TWICE. The result was already accepted; what was
    // missing was Julius's judgement of it, and that costs nothing to redo.
    expect(harness.adapters.get(CODER.adapterId)!.dispatches).toHaveLength(1);
  });

  it('attributes the resumed decision to the runtime, never to a worker that did not make it', async () => {
    const harness = build();
    await crashAt(harness, 'appendDecision');
    harness.store.restart();
    await advanceUntilTerminal(harness);

    const decided = harness.store.events().filter((event) => event.type === 'verification.decided');
    expect(decided).toHaveLength(1);
    expect(decided[0]?.workerId).toBe('julius-verification-resume');
  });

  it('is idempotent: a second resume adds no decision and no second repair round', async () => {
    const harness = build();
    await crashAt(harness, 'appendDecision');
    harness.store.restart();
    await advanceUntilTerminal(harness);
    const after = await harness.store.decisionsForRun('run-1', 'prj-1');

    const tasksBefore = (await harness.store.tasksForRun('run-1', 'prj-1')).length;
    await harness.loop.advanceRun('run-1', 'prj-1');
    await harness.loop.advanceRun('run-1', 'prj-1');
    expect(await harness.store.decisionsForRun('run-1', 'prj-1')).toEqual(after);
    expect((await harness.store.tasksForRun('run-1', 'prj-1')).length, 'no task was minted by re-asking')
      .toBe(tasksBefore);
    expect(harness.store.events().filter((event) => event.type === 'verification.decided'),
      'and no second decision event').toHaveLength(1);
  });
});

describe('nothing is executed twice across a crash', () => {
  /**
   * THE CRASH AFTER THE ANSWER WAS BOUGHT.
   *
   * A provider has answered, Julius has accepted the result durably, and the
   * process dies BEFORE the verification decision is written. On restart the
   * task is SUCCEEDED, undecided, and holds no lease — so the claim query will
   * never offer it and the lease sweep will never find it. Two things must
   * hold, and only one of them is about state:
   *
   *   the provider is NEVER asked again — the answer was already paid for;
   *   the verification still happens — otherwise the mission strands having
   *   spent the money and learned nothing.
   *
   * `resumeUnverifiedTasks` exists for exactly this and was reached by two
   * tests only as a loop-termination condition. Nothing asserted either
   * property.
   *
   * WHY THE RESUME IS DRIVEN THE WAY IT IS HERE. `tick()` advances only the
   * runs it TOUCHED — the ones it claimed a task from — so a run whose only
   * task is SUCCEEDED-and-undecided is never passed to `advanceRun`, and the
   * resume never fires. That is not a production defect: the one driver that
   * runs Julius (`driveJuliusRunToTerminal`) calls `advanceRun` explicitly
   * whenever a tick claimed nothing, and says why. This case drives it the same
   * way, so it tests the contract production actually relies on rather than a
   * shape nothing uses.
   */
  it('a crash between the provider result and its verification never buys the answer twice', async () => {
    const harness = build();
    const adapter = harness.adapters.get(CODER.adapterId)!;

    const { threw } = await crashAt(harness, 'appendDecision');
    expect(threw, 'the verification write is where this crashes').toBe(true);
    expect(adapter.dispatches, 'the provider answered once, and was paid for once').toHaveLength(1);
    expect(harness.store.taskRow('task-1')?.state, 'the result landed durably').toBe('SUCCEEDED');
    expect(await harness.store.decisionsForRun('run-1', scope.projectId), 'and the decision did not').toHaveLength(0);

    // THE RESTART: a new loop, a new owner, the same durable facts.
    harness.store.restart();
    const resumed = new JuliusRunLoop(
      { ...harness.deps, owner: 'worker-after-crash' }, harness.policies,
      { claimLimit: 5, leaseMs: 60_000 },
    );
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const report = await resumed.tick(scope);
      if (report.claimed === 0) await resumed.advanceRun('run-1', scope.projectId);
      if (harness.store.taskRow('task-1')?.state !== 'SUCCEEDED') break;
      if ((await harness.store.decisionsForRun('run-1', scope.projectId)).length > 0) break;
    }

    // THE ASSERTION THAT IS ABOUT MONEY. The rest is about state.
    expect(adapter.dispatches, 'the provider was never asked again').toHaveLength(1);
    expect(adapter.dispatches[0]!.taskId).toBe('task-1');

    // And the run did not strand: the resume reached a verification decision.
    const decisions = await harness.store.decisionsForRun('run-1', scope.projectId);
    expect(decisions.length, 'verification happened on the restart, not on a re-dispatch').toBeGreaterThan(0);
    expect(decisions.map((decision) => decision.taskId)).toContain('task-1');
  });

  it('does not re-dispatch a task whose result was already accepted', async () => {
    const harness = build();
    // Crash AFTER the result is accepted — the task has moved and the
    // verification has not run. A restart must not pay for the work again.
    await crashAt(harness, 'appendDecision');
    const dispatchesBefore = harness.adapters.get(CODER.adapterId)!.dispatches.length;
    expect(dispatchesBefore).toBe(1);
    expect(harness.store.results()).toHaveLength(1);

    harness.store.restart();
    const resumed = new JuliusRunLoop(
      { ...harness.deps, owner: 'worker-after-crash' }, harness.policies,
      { claimLimit: 5, leaseMs: 60_000 },
    );
    await resumed.tick(scope);
    expect(harness.adapters.get(CODER.adapterId)!.dispatches).toHaveLength(dispatchesBefore);
    expect(harness.store.results()).toHaveLength(1);
  });

  it('does not double-charge the budget when the commit is retried', async () => {
    const harness = build();
    await crashAt(harness, 'appendDecision');
    const committed = harness.budget.reservations().filter((row) => row.state === 'COMMITTED');
    expect(committed).toHaveLength(1);

    harness.store.restart();
    const resumed = new JuliusRunLoop(
      { ...harness.deps, owner: 'worker-after-crash' }, harness.policies,
      { claimLimit: 5, leaseMs: 60_000 },
    );
    await resumed.tick(scope);
    expect(harness.budget.reservations().filter((row) => row.state === 'COMMITTED')).toHaveLength(1);
  });

  it('does not record evidence twice when the batch is retried', async () => {
    const harness = build();
    // Crash on the SECOND evidence write, so the first has landed.
    const faulted = injectJuliusFault(harness.store, { method: 'appendEvidence', onCall: 2 });
    const loop = new JuliusRunLoop(
      { ...harness.deps, store: faulted.store }, harness.policies, { claimLimit: 5, leaseMs: 60_000 },
    );
    try { await loop.tick(scope); } catch { /* the boundary failed, as planned */ }

    harness.store.restart();
    const resumed = new JuliusRunLoop(
      { ...harness.deps, owner: 'worker-after-crash' }, harness.policies,
      { claimLimit: 5, leaseMs: 60_000 },
    );
    await resumed.tick(scope);
    const evidence = await harness.store.evidenceForRun('run-1', 'prj-1');
    const ids = evidence.map((item) => item.evidenceId);
    expect(new Set(ids).size, 'evidence was recorded twice').toBe(ids.length);
  });

  it('holds no reservation open after a dispatch failure', async () => {
    const harness = build([{ kind: 'fail', code: 'AUTH_CONFIGURATION' }]);
    await harness.loop.tick(scope);
    expect(harness.budget.reservations().filter((row) => row.state === 'RESERVED')).toEqual([]);
    expect(harness.budget.remainingUsdMicros()).toBe(1_000_000);
  });
});

/* -------------------------------------------------------- provider chaos */

describe('provider failure modes', () => {
  const CODES = ['RATE_LIMIT', 'TIMEOUT', 'AUTH_CONFIGURATION', 'PROVIDER_UNAVAILABLE', 'WORKER_EXECUTION_FAILURE'] as const;

  for (const code of CODES) {
    it(`classifies ${code} without leaving the task ACTIVE`, async () => {
      const harness = build([{ kind: 'fail', code }]);
      const report = await harness.loop.tick(scope);
      expect(['RETRY', 'FAILED', 'DENIED']).toContain(report.outcomes[0]!.kind);
      expect(harness.store.taskRow('task-1')!.state).not.toBe('ACTIVE');
      expect(harness.store.taskRow('task-1')!.leaseOwner).toBeNull();
    });
  }

  it('refuses a malformed provider result and records no evidence from it', async () => {
    const harness = build([{ kind: 'malformed' }]);
    const report = await harness.loop.tick(scope);
    expect(report.outcomes[0]!.kind).toBe('FAILED');
    expect(await harness.store.evidenceForRun('run-1', 'prj-1')).toEqual([]);
    expect(harness.store.results()).toEqual([]);
  });

  it('stops rather than looping when the budget is exhausted mid-run', async () => {
    const harness = createJuliusHarness({
      workers: [{ worker: CODER, script: [{ kind: 'succeed' }] }],
      budgetUsdMicros: 2_000,
      card: cardPolicy({ allowedProviders: [CODER.providerId] }),
    });
    seedRun(harness, { tasks: [0, 1, 2].map((n) => task({ taskId: `task-${n}`, ordinal: n })) });
    const first = await harness.loop.tick(scope);
    const denied = first.outcomes.filter((outcome) => outcome.kind === 'DENIED');
    expect(denied.length).toBeGreaterThan(0);
    // A denied task does not come back for another attempt on the next tick.
    const second = await harness.loop.tick(scope);
    expect(second.outcomes.filter((outcome) => outcome.kind === 'COMPLETED')).toEqual([]);
  });
});

/* ------------------------------------------------------------ idempotency */

describe('every replayable operation absorbs its replay', () => {
  it('re-running a completed tick changes nothing', async () => {
    const harness = build();
    await harness.loop.tick(scope);
    const snapshot = {
      events: harness.store.events().length,
      trajectory: harness.store.trajectory().length,
      results: harness.store.results().length,
      contexts: harness.store.contexts().length,
      evidence: (await harness.store.evidenceForRun('run-1', 'prj-1')).length,
    };
    await harness.loop.tick(scope);
    await harness.loop.tick(scope);
    expect(harness.store.results()).toHaveLength(snapshot.results);
    expect(harness.store.contexts()).toHaveLength(snapshot.contexts);
    expect(await harness.store.evidenceForRun('run-1', 'prj-1')).toHaveLength(snapshot.evidence);
  });

  it('absorbs a replayed write on every store method that claims to', async () => {
    const harness = build();
    await harness.loop.tick(scope);
    const evidence = (await harness.store.evidenceForRun('run-1', 'prj-1'))[0]!;

    // Each of these is documented as idempotent; each is asked twice.
    expect(await harness.store.appendEvidence({
      runId: 'run-1', projectId: 'prj-1', idempotencyKey: 'replay', evidence,
    })).toBe(true);
    expect(await harness.store.appendEvidence({
      runId: 'run-1', projectId: 'prj-1', idempotencyKey: 'replay', evidence,
    })).toBe(false);

    expect(await harness.store.appendDecision({
      decisionId: 'd-1', runId: 'run-1', taskId: 'task-1', policyRevision: 'v',
      idempotencyKey: 'replay', occurredAt: harness.clock.now(),
      decision: { action: 'ACCEPT', reasonCode: 'X', evidenceIds: [], safeSummary: 'ok' },
    })).toBe(true);
    expect(await harness.store.appendDecision({
      decisionId: 'd-2', runId: 'run-1', taskId: 'task-1', policyRevision: 'v',
      idempotencyKey: 'replay', occurredAt: harness.clock.now(),
      decision: { action: 'ACCEPT', reasonCode: 'X', evidenceIds: [], safeSummary: 'ok' },
    })).toBe(false);

    const snapshot = harness.store.contexts()[0]!;
    // A REPLAY RETURNS THE STORED ID, which is a stronger statement of the same
    // idempotency: the second write stores nothing AND tells the caller which
    // row every downstream reference must name. Returning `false` here is what
    // let a retry reference a context that was never stored.
    const first = await harness.store.persist({ projectId: 'prj-1', snapshot });
    expect(first).toBe(snapshot.contextId);
    const replay = await harness.store.persist({ projectId: 'prj-1', snapshot: { ...snapshot, contextId: 'context#replayed' } });
    expect(replay, 'the id already stored, not the one just minted').toBe(snapshot.contextId);
  });

  it('refuses a stale run version rather than applying it twice', async () => {
    const harness = build();
    const run = (await harness.store.loadRun('run-1', 'prj-1'))!;
    await harness.store.transition({
      commandId: 'c1', runId: 'run-1', projectId: 'prj-1', expectedVersion: run.version,
      to: 'EXECUTING', reasonCode: 'X', safeSummary: 'x', evidenceIds: [], occurredAt: harness.clock.now(),
    });
    await expect(harness.store.transition({
      commandId: 'c2', runId: 'run-1', projectId: 'prj-1', expectedVersion: run.version,
      to: 'PAUSED', reasonCode: 'X', safeSummary: 'x', evidenceIds: [], occurredAt: harness.clock.now(),
    })).rejects.toThrow('optimistic_concurrency_conflict');
  });
});

/* ------------------------------------------------------------ at scale */

describe('a large graph stays bounded', () => {
  const bigRun = (tasks: number) => {
    const harness = createJuliusHarness({
      workers: [{ worker: CODER, script: [{ kind: 'succeed' }] }],
      card: cardPolicy({ allowedProviders: [CODER.providerId], concurrency: 100 }),
      config: { claimLimit: 25 },
    });
    seedRun(harness, {
      tasks: Array.from({ length: tasks }, (_, index) => task({ taskId: `task-${index}`, ordinal: index })),
    });
    return harness;
  };

  it('claims at most the configured limit however many are runnable', async () => {
    const harness = bigRun(300);
    const report = await harness.loop.tick(scope);
    expect(report.claimed).toBe(25);
  });

  it('drains a 300-task run across ticks without a single unbounded pass', async () => {
    const harness = bigRun(300);
    let ticks = 0;
    while (ticks < 40) {
      const report = await harness.loop.tick(scope);
      ticks += 1;
      if (report.claimed === 0) break;
    }
    const remaining = Array.from({ length: 300 }, (_, index) => harness.store.taskRow(`task-${index}`)!)
      .filter((row) => row.state !== 'SUCCEEDED');
    expect(remaining, `${remaining.length} tasks left after ${ticks} ticks`).toEqual([]);
    expect(ticks).toBeLessThanOrEqual(40);
  });

  it('handles a wide fan-in without the claim query offering a blocked task', async () => {
    const harness = createJuliusHarness({
      workers: [{ worker: CODER, script: [{ kind: 'succeed' }] }],
      card: cardPolicy({ allowedProviders: [CODER.providerId], concurrency: 100 }),
      config: { claimLimit: 100 },
    });
    const leaves = Array.from({ length: 50 }, (_, index) => task({ taskId: `leaf-${index}`, ordinal: index }));
    seedRun(harness, {
      tasks: [
        ...leaves,
        task({ taskId: 'join', ordinal: 99, state: 'BLOCKED', dependencyIds: leaves.map((leaf) => leaf.taskId) }),
      ],
    });
    const first = await harness.loop.tick(scope);
    expect(first.outcomes.map((outcome) => outcome.taskId)).not.toContain('join');
    expect(first.claimed).toBe(50);

    const second = await harness.loop.tick(scope);
    expect(second.outcomes.map((outcome) => outcome.taskId)).toEqual(['join']);
  });

  it('pages a long timeline instead of returning all of it', async () => {
    const harness = bigRun(60);
    for (let index = 0; index < 3; index += 1) await harness.loop.tick(scope);
    const page = await harness.store.timeline({
      runId: 'run-1', projectId: 'prj-1', sinceSequence: 0, limit: 10,
    });
    expect(page.entries).toHaveLength(10);
    expect(page.hasMore).toBe(true);
  });
});
