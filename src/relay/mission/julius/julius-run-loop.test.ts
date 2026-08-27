import { describe, expect, it } from 'vitest';

import {
  JuliusRunLoop, planRunStatePath, targetRunState, transitionIsLegal,
} from './julius-run-loop';
import {
  createJuliusHarness, seedRun, task, worker, cardPolicy, verificationPolicy,
} from './julius-runtime-fixtures';
import type { JuliusTask } from './julius-runtime';

/**
 * DOES JULIUS ACTUALLY RUN?
 *
 * The inherited stack had a scheduler, a policy evaluator, a router, a context
 * compiler, an execution coordinator, a verification evaluator and a repair
 * planner — and an audit of merged main found no production caller for ANY of
 * them. Every assertion in this file is about the composition: that a claimed
 * task really reaches a provider, that its evidence really lands, that
 * verification really follows execution, and that the run really advances.
 */

const CODER = worker({ workerId: 'coder', role: 'CODING_AGENT', capabilities: ['implement'], taskTypes: ['build'] });
const REVIEWER = worker({ workerId: 'reviewer', role: 'INDEPENDENT_REVIEWER', capabilities: ['review'], taskTypes: ['review:build'] });

const scope = { projectId: 'prj-1' };

/* ------------------------------------------------------- the state target */

describe('the run state a task set implies', () => {
  const t = (state: JuliusTask['state'], id = state): JuliusTask =>
    ({ ...task({ taskId: id }), state } as JuliusTask);

  it('is PLANNING when nothing has been planned', () => {
    expect(targetRunState([]).state).toBe('PLANNING');
  });

  it('prefers EXECUTING over every other signal while work is in flight', () => {
    expect(targetRunState([t('ACTIVE'), t('RUNNABLE'), t('BLOCKED')]).state).toBe('EXECUTING');
  });

  it('is READY when work is available and nothing holds it', () => {
    expect(targetRunState([t('RUNNABLE'), t('SUCCEEDED')]).state).toBe('READY');
  });

  it('is WAITING when everything left is blocked on something', () => {
    expect(targetRunState([t('BLOCKED'), t('SUCCEEDED')]).state).toBe('WAITING');
  });

  it('is FAILED when a terminal task set contains a failure', () => {
    expect(targetRunState([t('FAILED'), t('SUCCEEDED')]).state).toBe('FAILED');
  });

  it('is VERIFYING only when every task is SUCCEEDED or SKIPPED', () => {
    expect(targetRunState([t('SUCCEEDED'), t('SKIPPED')]).state).toBe('VERIFYING');
  });

  it('is a pure function — the same tasks always give the same target', () => {
    const tasks = [t('ACTIVE'), t('RUNNABLE')];
    expect(targetRunState(tasks)).toEqual(targetRunState(tasks));
  });

  it('never forces an illegal move; the transition table still decides', () => {
    expect(transitionIsLegal('READY', 'EXECUTING')).toBe(true);
    expect(transitionIsLegal('EXECUTING', 'READY')).toBe(false);
    expect(transitionIsLegal('COMPLETED', 'EXECUTING')).toBe(false);
    expect(transitionIsLegal('READY', 'READY')).toBe(false);
  });
});

describe('walking to a state the table does not allow in one step', () => {
  it('finds the real path a run took rather than jumping', () => {
    // A single-task run that starts and finishes inside one tick is READY when
    // observed and VERIFYING when computed. `READY -> VERIFYING` is not in the
    // transition table because a run reaches VERIFYING by EXECUTING first, and
    // the run really did execute.
    expect(planRunStatePath('READY', 'VERIFYING')).toEqual(['EXECUTING', 'VERIFYING']);
  });

  it('takes the direct step when there is one', () => {
    expect(planRunStatePath('READY', 'EXECUTING')).toEqual(['EXECUTING']);
    expect(planRunStatePath('CREATED', 'PLANNING')).toEqual(['PLANNING']);
  });

  it('is empty for a move that is already true or genuinely unreachable', () => {
    expect(planRunStatePath('READY', 'READY')).toEqual([]);
    for (const terminal of ['COMPLETED', 'FAILED', 'CANCELLED'] as const) {
      expect(planRunStatePath(terminal, 'EXECUTING'), terminal).toEqual([]);
    }
  });

  it('never invents a step the domain would refuse', () => {
    const path = planRunStatePath('CREATED', 'COMPLETED');
    let current: Parameters<typeof transitionIsLegal>[0] = 'CREATED';
    for (const step of path) {
      expect(transitionIsLegal(current, step), `${current} -> ${step}`).toBe(true);
      current = step;
    }
    expect(path.at(-1)).toBe('COMPLETED');
  });
});

/* ---------------------------------------------------------- the happy path */

describe('a single task, end to end', () => {
  const build = () => {
    const harness = createJuliusHarness({ workers: [{ worker: CODER, script: [{ kind: 'succeed' }] }] });
    seedRun(harness, { tasks: [task({ taskId: 'task-1', ordinal: 0 })] });
    return harness;
  };

  it('claims, dispatches, records evidence, verifies and succeeds', async () => {
    const harness = build();
    const report = await harness.loop.tick(scope);

    expect(report.claimed).toBe(1);
    expect(report.outcomes).toHaveLength(1);
    expect(report.outcomes[0].kind).toBe('COMPLETED');

    // The provider was ACTUALLY reached.
    expect(harness.adapters.get(CODER.adapterId)!.dispatches).toHaveLength(1);
    // Evidence ACTUALLY landed.
    expect(await harness.store.evidenceForRun('run-1', 'prj-1')).toHaveLength(1);
    // Verification ACTUALLY followed execution.
    expect(await harness.store.decisionsForRun('run-1', 'prj-1')).toHaveLength(1);
    // The task ACTUALLY moved.
    expect(harness.store.taskRow('task-1')!.state).toBe('SUCCEEDED');
  });

  it('compiles and persists a context snapshot BEFORE dispatch', async () => {
    const harness = build();
    await harness.loop.tick(scope);
    const contexts = harness.store.contexts();
    expect(contexts).toHaveLength(1);
    expect(contexts[0].taskId).toBe('task-1');
    expect(contexts[0].workerId).toBe('coder');
    // The dispatch carried the snapshot's id, so the call is reproducible.
    expect(harness.adapters.get(CODER.adapterId)!.dispatches[0].contextId).toBe(contexts[0].contextId);
    expect(contexts[0].contentHash.startsWith('sha256:')).toBe(true);
  });

  it('reserves budget before the provider call and commits after it', async () => {
    const harness = build();
    await harness.loop.tick(scope);
    const reservations = harness.budget.reservations();
    expect(reservations).toHaveLength(1);
    expect(reservations[0].state).toBe('COMMITTED');
  });

  it('advances the run to VERIFYING once every task is terminal', async () => {
    const harness = build();
    const report = await harness.loop.tick(scope);
    expect(report.runs).toHaveLength(1);
    expect(report.runs[0].changed).toBe(true);
    expect(report.runs[0].from).toBe('READY');
    expect(report.runs[0].to).toBe('VERIFYING');
    expect((await harness.store.loadRun('run-1', 'prj-1'))!.state).toBe('VERIFYING');
    // Two versions were consumed, because the run really passed through
    // EXECUTING rather than jumping a step the transition table forbids.
    expect((await harness.store.loadRun('run-1', 'prj-1'))!.version).toBe(3);
  });

  it('emits the operational events the transition actually produced', async () => {
    const harness = build();
    await harness.loop.tick(scope);
    const types = harness.store.events().map((event) => event.type);
    expect(types).toEqual(expect.arrayContaining([
      'task.claimed', 'worker.selected', 'budget.reserved', 'worker.dispatched',
      'worker.completed', 'verification.decided',
    ]));
  });

  it('emits trajectory facts from the real execution, not a template', async () => {
    const harness = build();
    await harness.loop.tick(scope);
    const kinds = harness.store.trajectory().map((event) => event.kind);
    expect(kinds).toEqual(expect.arrayContaining(['CONTEXT_COMPILED', 'DISPATCH', 'VERIFICATION']));
    for (const event of harness.store.trajectory()) {
      expect(event.runtimeVersion).toBe('julius-runtime.v1');
      expect(event.cardRevision).toBe('card-r1');
      expect(event.missionContractRevision).toBe(1);
    }
  });

  it('claims nothing on a second tick, because nothing is runnable', async () => {
    const harness = build();
    await harness.loop.tick(scope);
    const second = await harness.loop.tick(scope);
    expect(second.claimed).toBe(0);
    expect(harness.adapters.get(CODER.adapterId)!.dispatches).toHaveLength(1);
  });
});

/* ------------------------------------------------------------ dependencies */

describe('dependency wakeup', () => {
  it('does not hand out a task whose dependency has not succeeded', async () => {
    const harness = createJuliusHarness({ workers: [{ worker: CODER, script: [{ kind: 'succeed' }] }] });
    seedRun(harness, {
      tasks: [
        task({ taskId: 'first', ordinal: 0 }),
        task({ taskId: 'second', ordinal: 1, state: 'BLOCKED', dependencyIds: ['first'] }),
      ],
    });

    const first = await harness.loop.tick(scope);
    expect(first.claimed).toBe(1);
    expect(first.outcomes[0].taskId).toBe('first');
    // `second` is BLOCKED and its dependency only just succeeded.
    expect(harness.store.taskRow('second')!.state).toBe('BLOCKED');
  });

  it('hands it out once the dependency is satisfied, with no second mechanism', async () => {
    const harness = createJuliusHarness({ workers: [{ worker: CODER, script: [{ kind: 'succeed' }] }] });
    seedRun(harness, {
      tasks: [
        task({ taskId: 'first', ordinal: 0 }),
        // RUNNABLE with an unsatisfied dependency: the claim predicate, not the
        // task state, is what holds it back. That is the property under test.
        task({ taskId: 'second', ordinal: 1, dependencyIds: ['first'] }),
      ],
    });

    const first = await harness.loop.tick(scope);
    expect(first.outcomes.map((outcome) => outcome.taskId)).toEqual(['first']);

    const second = await harness.loop.tick(scope);
    expect(second.outcomes.map((outcome) => outcome.taskId)).toEqual(['second']);
    expect(harness.store.taskRow('second')!.state).toBe('SUCCEEDED');
  });
});

/* --------------------------------------------------------------- refusals */

describe('the runtime fails closed', () => {
  it('never dispatches when C.A.R.D. denies the capability', async () => {
    const harness = createJuliusHarness({
      workers: [{ worker: CODER, script: [{ kind: 'succeed' }] }],
      card: cardPolicy({ capabilities: [], allowedProviders: [CODER.providerId] }),
    });
    seedRun(harness, { tasks: [task({ taskId: 'task-1' })] });

    const report = await harness.loop.tick(scope);
    expect(report.outcomes[0].kind).toBe('DENIED');
    expect(harness.adapters.get(CODER.adapterId)!.dispatches).toHaveLength(0);
    // And nothing was compiled for an operation nobody authorized.
    expect(harness.store.contexts()).toHaveLength(0);
    expect(harness.budget.reservations()).toHaveLength(0);
  });

  it('pauses for an approval C.A.R.D. requires, and dispatches nothing', async () => {
    const harness = createJuliusHarness({
      workers: [{ worker: CODER, script: [{ kind: 'succeed' }] }],
      card: cardPolicy({ approvals: ['DISPATCH_WORKER'], autonomy: 'SUPERVISED', allowedProviders: [CODER.providerId] }),
    });
    seedRun(harness, { tasks: [task({ taskId: 'task-1' })] });

    const report = await harness.loop.tick(scope);
    expect(report.outcomes[0].kind).toBe('APPROVAL_REQUIRED');
    expect(harness.adapters.get(CODER.adapterId)!.dispatches).toHaveLength(0);
  });

  it('denies when the budget cannot cover the task, and never calls the provider', async () => {
    const harness = createJuliusHarness({
      workers: [{ worker: CODER, script: [{ kind: 'succeed' }] }],
      budgetUsdMicros: 1,
    });
    seedRun(harness, { tasks: [task({ taskId: 'task-1' })] });

    const report = await harness.loop.tick(scope);
    expect(report.outcomes[0].kind).toBe('DENIED');
    expect(harness.adapters.get(CODER.adapterId)!.dispatches).toHaveLength(0);
    expect(harness.store.events().map((event) => event.type)).toContain('budget.denied');
  });

  it('emits task.failed — an event type the inherited catalogue did not carry', async () => {
    // `JuliusExecutionEventType` (#174) has always included `task.failed` and
    // `JULIUS_OPERATIONAL_EVENT_TYPES` (#179) did not, so the coordinator emitted
    // a type the authoritative catalogue could not name. Wiring the two together
    // is what surfaced it.
    const harness = createJuliusHarness({
      workers: [{ worker: CODER, script: [{ kind: 'fail', code: 'AUTH_CONFIGURATION' }] }],
    });
    seedRun(harness, { tasks: [task({ taskId: 'task-1' })] });
    await harness.loop.tick(scope);
    expect(harness.store.events().map((event) => event.type)).toContain('task.failed');
  });

  it('releases the reservation when the provider fails', async () => {
    const harness = createJuliusHarness({
      workers: [{ worker: CODER, script: [{ kind: 'fail', code: 'AUTH_CONFIGURATION' }] }],
    });
    seedRun(harness, { tasks: [task({ taskId: 'task-1' })] });

    const report = await harness.loop.tick(scope);
    expect(report.outcomes[0].kind).toBe('FAILED');
    expect(harness.budget.reservations()[0].state).toBe('RELEASED');
    expect(harness.budget.remainingUsdMicros()).toBe(1_000_000);
  });

  it('classifies a retryable failure as RETRY and requeues the task', async () => {
    const harness = createJuliusHarness({
      workers: [{ worker: CODER, script: [{ kind: 'fail', code: 'RATE_LIMIT' }, { kind: 'succeed' }] }],
    });
    seedRun(harness, { tasks: [task({ taskId: 'task-1' })] });

    const first = await harness.loop.tick(scope);
    expect(first.outcomes[0].kind).toBe('RETRY');
    expect(harness.store.taskRow('task-1')!.state).toBe('RUNNABLE');

    const second = await harness.loop.tick(scope);
    expect(second.outcomes[0].kind).toBe('COMPLETED');
    expect(harness.store.taskRow('task-1')!.state).toBe('SUCCEEDED');
  });

  it('refuses a provider result that claims to be from another worker', async () => {
    const harness = createJuliusHarness({
      workers: [{ worker: CODER, script: [{ kind: 'malformed' }] }],
    });
    seedRun(harness, { tasks: [task({ taskId: 'task-1' })] });
    const report = await harness.loop.tick(scope);
    expect(report.outcomes[0].kind).toBe('FAILED');
    expect(await harness.store.evidenceForRun('run-1', 'prj-1')).toHaveLength(0);
  });

  it('refuses a task whose role Julius cannot resolve', async () => {
    const harness = createJuliusHarness({ workers: [{ worker: CODER, script: [{ kind: 'succeed' }] }] });
    seedRun(harness, { tasks: [task({ taskId: 'task-1', role: 'NOT_A_ROLE' as never })] });
    const report = await harness.loop.tick(scope);
    expect(report.outcomes[0].kind).toBe('HALTED');
    expect(harness.adapters.get(CODER.adapterId)!.dispatches).toHaveLength(0);
  });

  it('halts rather than dispatching when no policy can be resolved', async () => {
    const harness = createJuliusHarness({ workers: [{ worker: CODER, script: [{ kind: 'succeed' }] }] });
    seedRun(harness, { tasks: [task({ taskId: 'task-1' })] });
    const loop = new JuliusRunLoop(
      harness.deps,
      { async policyFor() { return null; }, capabilityFor: () => 'implement' },
      { claimLimit: 5, leaseMs: 60_000 },
    );
    const report = await loop.tick(scope);
    expect(report.unresolvedPolicyRunIds).toEqual(['run-1']);
    expect(report.outcomes).toEqual([]);
    expect(harness.adapters.get(CODER.adapterId)!.dispatches).toHaveLength(0);
  });
});

/* -------------------------------------------------------------- tenancy */

describe('tenancy', () => {
  it('claims nothing from another project', async () => {
    const harness = createJuliusHarness({ workers: [{ worker: CODER, script: [{ kind: 'succeed' }] }] });
    seedRun(harness, { tasks: [task({ taskId: 'task-1' })] });
    const report = await harness.loop.tick({ projectId: 'prj-other' });
    expect(report.claimed).toBe(0);
    expect(harness.adapters.get(CODER.adapterId)!.dispatches).toHaveLength(0);
  });

  it('refuses to load a run under the wrong project', async () => {
    const harness = createJuliusHarness({ workers: [{ worker: CODER, script: [{ kind: 'succeed' }] }] });
    seedRun(harness, { tasks: [task({ taskId: 'task-1' })] });
    expect(await harness.store.loadRun('run-1', 'prj-other')).toBeNull();
  });
});

/* ------------------------------------------------- review and repair flow */

describe('review and repair actually enter the graph', () => {
  it('schedules an independent review as a real dependent task', async () => {
    const harness = createJuliusHarness({
      workers: [
        { worker: CODER, script: [{ kind: 'succeed' }] },
        { worker: REVIEWER, script: [{ kind: 'succeed', evidence: [{ type: 'REVIEW_FINDING', status: 'PASSED', safeSummary: 'No blocking findings.' }] }] },
      ],
      verification: verificationPolicy({ reviewerRequired: true }),
    });
    seedRun(harness, { tasks: [task({ taskId: 'task-1' })] });

    const first = await harness.loop.tick(scope);
    expect(first.outcomes[0].kind).toBe('REVIEW_SCHEDULED');
    const review = harness.store.taskRow('task-1:review');
    expect(review).not.toBeNull();
    expect(review!.role).toBe('INDEPENDENT_REVIEWER');
    expect(review!.dependencyIds).toEqual(['task-1']);

    // And the scheduler picks it up on the next tick, through the normal path.
    const second = await harness.loop.tick(scope);
    expect(second.outcomes.map((outcome) => outcome.taskId)).toEqual(['task-1:review']);
    expect(harness.adapters.get(REVIEWER.adapterId)!.dispatches).toHaveLength(1);
  });

  it('schedules a repair task into the DAG when a blocking finding is open', async () => {
    const harness = createJuliusHarness({
      workers: [{ worker: CODER, script: [{ kind: 'succeed' }, { kind: 'succeed' }] }],
    });
    const run = seedRun(harness, { tasks: [task({ taskId: 'task-1' })] });
    harness.store.seedFinding({
      findingId: 'finding-1', runId: run.runId, taskId: 'task-1', reviewerWorkerId: 'reviewer',
      severity: 'HIGH', category: 'correctness', claim: 'The suite does not cover the branch.',
      criterionId: null, evidenceIds: ['task-1:1:0'], blocking: true, status: 'OPEN',
      createdAt: '2026-08-27T00:00:00.000Z',
    });

    const report = await harness.loop.tick(scope);
    expect(report.outcomes[0].kind).toBe('REPAIR_SCHEDULED');
    const repairTaskId = report.outcomes[0].kind === 'REPAIR_SCHEDULED' ? report.outcomes[0].repairTaskId : '';
    const repair = harness.store.taskRow(repairTaskId);
    expect(repair).not.toBeNull();
    expect(repair!.role).toBe('CODING_AGENT');
    expect(repair!.parentTaskId).toBe('task-1');
    expect(harness.store.events().map((event) => event.type)).toContain('repair.scheduled');
  });

  it('halts rather than repairing when the budget cannot cover the round', async () => {
    const harness = createJuliusHarness({
      workers: [{ worker: CODER, script: [{ kind: 'succeed' }] }],
      // Enough for the first task and not for a repair round.
      budgetUsdMicros: 2_500,
    });
    const run = seedRun(harness, { tasks: [task({ taskId: 'task-1' })] });
    harness.store.seedFinding({
      findingId: 'finding-1', runId: run.runId, taskId: 'task-1', reviewerWorkerId: 'reviewer',
      severity: 'HIGH', category: 'correctness', claim: 'Blocking.', criterionId: null,
      evidenceIds: ['task-1:1:0'], blocking: true, status: 'OPEN', createdAt: '2026-08-27T00:00:00.000Z',
    });

    const report = await harness.loop.tick(scope);
    expect(report.outcomes[0].kind).toBe('HALTED');
    if (report.outcomes[0].kind === 'HALTED') {
      expect(report.outcomes[0].reasonCode).toBe('REPAIR_BUDGET_DENIED');
    }
  });
});

/* ------------------------------------------------------------ boundedness */

describe('the loop is bounded', () => {
  it('refuses an out-of-range claim limit or lease', () => {
    const harness = createJuliusHarness({ workers: [{ worker: CODER, script: [{ kind: 'succeed' }] }] });
    for (const claimLimit of [0, -1, 101, 1.5]) {
      expect(() => new JuliusRunLoop(harness.deps, harness.policies, { claimLimit, leaseMs: 1_000 }))
        .toThrow('invalid_julius_claim_limit');
    }
    for (const leaseMs of [0, -1, 1.5]) {
      expect(() => new JuliusRunLoop(harness.deps, harness.policies, { claimLimit: 1, leaseMs }))
        .toThrow('invalid_julius_lease_ms');
    }
  });

  it('claims at most the configured limit in one tick', async () => {
    const harness = createJuliusHarness({
      workers: [{ worker: CODER, script: [{ kind: 'succeed' }] }],
      config: { claimLimit: 2 },
    });
    seedRun(harness, {
      tasks: [0, 1, 2, 3, 4].map((n) => task({ taskId: `task-${n}`, ordinal: n })),
    });
    const report = await harness.loop.tick(scope);
    expect(report.claimed).toBe(2);
  });
});
