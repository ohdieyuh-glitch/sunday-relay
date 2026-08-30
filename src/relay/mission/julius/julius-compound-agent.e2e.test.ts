import { describe, expect, it } from 'vitest';

import { JuliusRunLoop } from './julius-run-loop';
import { JuliusRuntimeApi } from './julius-runtime-api';
import { spawnJuliusSubagent } from './julius-subagent-runtime';
import { summariseJuliusEvals, projectJuliusMetrics } from './julius-metrics';
import {
  cardPolicy, createJuliusHarness, task, verificationPolicy, worker,
} from './julius-runtime-fixtures';
import type { JuliusRunRow } from './julius-runtime-ports';

/**
 * DO THE COMPONENTS FORM ONE SYSTEM?
 *
 * Every other suite proves one part. These three scenarios prove the parts
 * connect: a mission goes in, three roles do their work through the ordinary
 * scheduler, a review fails and produces a finding, a repair is scheduled and
 * runs, verification accepts, the run completes, and the Project Brain,
 * trajectory and operational ledger all agree about what happened.
 *
 * WHAT IS FAKED AND WHAT IS NOT. The provider adapters answer from a script,
 * because no credential exists here. Everything between the scheduler and the
 * adapter is the real runtime: the real claim, the real policy evaluation, the
 * real context compiler, the real budget reservation, the real evidence
 * normalization, the real verification evaluator, the real repair planner.
 */

const ARCHITECT = worker({
  workerId: 'architect', role: 'PROMPT_ARCHITECT',
  capabilities: ['plan'], taskTypes: ['plan'], providerId: 'openai', adapterId: 'architect-adapter',
});
const CODER = worker({
  workerId: 'coder', role: 'CODING_AGENT',
  // `repair:plan` as well as `repair:build`: `planJuliusRepair` names a repair
  // task `repair:<original taskType>` and assigns it to a CODING_AGENT
  // whatever the original role was, so a deployment must register a coding
  // agent that accepts a repair of every task type it plans. That is a real
  // deployment requirement and it is stated here rather than discovered when a
  // repair cannot be routed.
  capabilities: ['implement'], taskTypes: ['build', 'repair:build', 'repair:plan', 'audit'],
  providerId: 'anthropic', adapterId: 'coder-adapter',
});
const REVIEWER = worker({
  workerId: 'reviewer', role: 'INDEPENDENT_REVIEWER',
  capabilities: ['review'], taskTypes: ['review:build', 'review:plan'],
  providerId: 'hermes', adapterId: 'reviewer-adapter',
});
const BACKUP_CODER = worker({
  workerId: 'coder-b', role: 'CODING_AGENT',
  capabilities: ['implement'], taskTypes: ['build'],
  providerId: 'anthropic-backup', adapterId: 'coder-b-adapter',
});

const scope = { projectId: 'prj-1' };
const RUN: JuliusRunRow = {
  runId: 'run-1', missionId: 'msn-1', projectId: 'prj-1', state: 'READY',
  cardRevision: 'card-r1', missionContractRevision: 7, projectBrainRevision: 3, version: 1,
};

const capabilityFor = (item: { role: string }) =>
  (item.role === 'PROMPT_ARCHITECT' ? 'plan' : item.role === 'INDEPENDENT_REVIEWER' ? 'review' : 'implement');

/** Drain the loop, bounded, so a wedged run fails the test instead of hanging. */
async function drain(loop: JuliusRunLoop, maxTicks = 12): Promise<number> {
  for (let tick = 0; tick < maxTicks; tick += 1) {
    const report = await loop.tick(scope);
    if (report.claimed === 0) return tick;
  }
  return maxTicks;
}

/* ============================ SCENARIO 1 ============================== */

describe('scenario 1 — a mission through three roles, a failed review and a repair', () => {
  const build = () => {
    const harness = createJuliusHarness({
      workers: [
        { worker: ARCHITECT, script: [{ kind: 'succeed', evidence: [{ type: 'ARTIFACT', status: 'PASSED', safeSummary: 'Plan written.' }] }] },
        {
          worker: CODER,
          script: [
            { kind: 'succeed', evidence: [{ type: 'TEST', status: 'PASSED', safeSummary: 'Suite green.' }] },
            // The repair round.
            { kind: 'succeed', evidence: [{ type: 'TEST', status: 'PASSED', safeSummary: 'Suite green after repair.' }] },
          ],
        },
        {
          worker: REVIEWER,
          script: [
            // The review SUCCEEDS as a task and its verdict is a BLOCKING
            // finding — which is the case the product exists for, and the one
            // that produced nothing at all before the finding path was wired.
            { kind: 'succeed', evidence: [{ type: 'REVIEW_FINDING', status: 'FAILED', safeSummary: 'The branch is untested.' }] },
            { kind: 'succeed', evidence: [{ type: 'REVIEW_FINDING', status: 'PASSED', safeSummary: 'No blocking findings.' }] },
          ],
        },
      ],
      card: cardPolicy({
        allowedProviders: [ARCHITECT.providerId, CODER.providerId, REVIEWER.providerId],
        capabilities: ['plan', 'implement', 'review'],
      }),
      verification: verificationPolicy({ reviewerRequired: true, maxRepairRounds: 2 }),
      capabilityFor,
    });
    harness.store.seedRun(RUN);
    harness.store.seedTask('run-1', task({ taskId: 'plan-1', ordinal: 0, role: 'PROMPT_ARCHITECT', taskType: 'plan' }));
    harness.store.seedTask('run-1', task({
      taskId: 'build-1', ordinal: 1, role: 'CODING_AGENT', taskType: 'build',
      state: 'BLOCKED', dependencyIds: ['plan-1'], requiredEvidenceTypes: ['TEST'],
    }));
    harness.store.seedCriteria('run-1', [
      { criterionId: 'ac-1', description: 'The suite passes.', requiredEvidenceTypes: ['TEST'] },
    ]);
    harness.store.seedBrain('run-1', [
      { entryId: 'brain-1', kind: 'OBJECTIVE', text: 'Bind the Julius boundary.', taskIds: [], allowedRoles: ['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER'], sensitivity: 'INTERNAL' },
      { entryId: 'brain-secret', kind: 'CONSTRAINT', text: 'api_key=sk-must-never-appear', taskIds: [], allowedRoles: ['CODING_AGENT'], sensitivity: 'SECRET' },
    ]);
    return harness;
  };

  it('runs the architect first, and the coder only after it', async () => {
    const harness = build();
    const first = await harness.loop.tick(scope);
    expect(first.outcomes.map((outcome) => outcome.taskId)).toEqual(['plan-1']);
    expect(harness.adapters.get(CODER.adapterId)!.dispatches).toEqual([]);

    const second = await harness.loop.tick(scope);
    // `plan-1:review` becomes claimable in the same tick the plan succeeded,
    // because the claim query is the only wakeup and it runs once per tick.
    expect(second.outcomes.map((outcome) => outcome.taskId)).toContain('build-1');
  });

  it('never schedules a review OF a review — the chain would not end', async () => {
    const harness = build();
    await drain(harness.loop);
    const tasks = await harness.store.tasksForRun('run-1', 'prj-1');
    const doubleReviews = tasks.filter((item) => item.taskId.includes(':review:review'));
    expect(doubleReviews, 'a reviewer was scheduled to review a reviewer').toEqual([]);
    // Every reviewer task has a non-reviewer parent.
    for (const item of tasks.filter((entry) => entry.role === 'INDEPENDENT_REVIEWER')) {
      const parent = tasks.find((entry) => entry.taskId === item.parentTaskId);
      expect(parent?.role, `${item.taskId} reviews a reviewer`).not.toBe('INDEPENDENT_REVIEWER');
    }
  });

  it('schedules a real review, records a blocking finding, and repairs', async () => {
    const harness = build();
    await drain(harness.loop);

    // The review ran through the ordinary scheduler.
    expect(harness.adapters.get(REVIEWER.adapterId)!.dispatches.length).toBeGreaterThan(0);
    // Its failed verdict became a FINDING, not just failed evidence.
    const findings = await harness.store.findingsForRun('run-1', 'prj-1');
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((finding) => finding.blocking)).toBe(true);
    // Attributed to the task UNDER REVIEW, never to the reviewer's own task —
    // a repair has to be scheduled for the work, not for the review of it.
    const tasks = await harness.store.tasksForRun('run-1', 'prj-1');
    for (const finding of findings) {
      const subject = tasks.find((item) => item.taskId === finding.taskId);
      expect(subject, `${finding.findingId} names no task`).toBeDefined();
      expect(subject!.role).not.toBe('INDEPENDENT_REVIEWER');
    }
    // And a repair task entered the DAG and ran.
    const repairs = (await harness.store.tasksForRun('run-1', 'prj-1'))
      .filter((item) => item.taskType.startsWith('repair:'));
    expect(repairs.length).toBeGreaterThan(0);
    expect(harness.adapters.get(CODER.adapterId)!.dispatches.length).toBeGreaterThan(1);
  });

  it('carries the Project Brain into the worker\'s context and never the SECRET entry', async () => {
    const harness = build();
    await drain(harness.loop);
    const contexts = harness.store.contexts();
    expect(contexts.length).toBeGreaterThan(0);
    const text = JSON.stringify(contexts);
    expect(text).toContain('Bind the Julius boundary');
    // SECRET entries are excluded by the compiler, so the key never travels.
    expect(text).not.toContain('sk-must-never-appear');
    // Provenance: every snapshot names the revisions it was compiled from.
    for (const snapshot of contexts) {
      expect(snapshot.missionContractRevision).toBe(7);
      expect(snapshot.projectBrainRevision).toBe(3);
      expect(snapshot.cardRevision).toBe('card-r1');
      expect(snapshot.contentHash.startsWith('sha256:')).toBe(true);
    }
  });

  it('leaves an operational ledger and a trajectory that agree about the run', async () => {
    const harness = build();
    await drain(harness.loop);

    const events = new Set(harness.store.events().map((event) => event.type));
    for (const expected of ['task.claimed', 'context.compiled', 'worker.dispatched', 'worker.completed',
      'evidence.recorded', 'review.started', 'finding.recorded', 'verification.decided', 'repair.scheduled'] as const) {
      expect(events.has(expected), expected).toBe(true);
    }

    const kinds = new Set(harness.store.trajectory().map((event) => event.kind));
    for (const expected of ['TASK_TOPOLOGY', 'WORKER_SELECTED', 'PROVIDER_SELECTED',
      'CONTEXT_COMPILED', 'DISPATCH', 'VERIFICATION', 'FINDING', 'REPAIR'] as const) {
      expect(kinds.has(expected), expected).toBe(true);
    }

    // The two ledgers agree on which providers were used.
    const providers = new Set(harness.store.trajectory()
      .filter((event) => event.kind === 'PROVIDER_SELECTED').map((event) => event.providerId));
    expect(providers).toEqual(new Set(['openai', 'anthropic', 'hermes']));
  });

  it('is readable through the execution API by an authorized caller and nobody else', async () => {
    const harness = build();
    await drain(harness.loop);
    const api = new JuliusRuntimeApi({
      store: harness.store, timeline: harness.store, clock: harness.clock,
      approvers: { async mayApprove() { return true; } },
    });
    const identity = { tenantId: 't', projectId: 'prj-1', actorId: 'ghu-1', scopes: ['run:read'] as const };
    const view = await api.inspectRun(identity, 'run-1');
    expect(view.ok).toBe(true);
    if (!view.ok) return;
    expect(view.value.missionId).toBe('msn-1');
    expect(view.value.taskCounts.SUCCEEDED).toBeGreaterThan(2);

    const intruder = await api.inspectRun({ ...identity, projectId: 'prj-other' }, 'run-1');
    expect(intruder.ok).toBe(false);
  });

  it('spends only what it reserved, and settles every reservation', async () => {
    const harness = build();
    await drain(harness.loop);
    const outstanding = harness.budget.reservations().filter((row) => row.state === 'RESERVED');
    expect(outstanding, 'a reservation was left open').toEqual([]);
    expect(harness.budget.reservations().filter((row) => row.state === 'COMMITTED').length).toBeGreaterThan(2);
  });
});

/* ============================ SCENARIO 2 ============================== */

describe('scenario 2 — a transient provider failure, a fallback, and a completion', () => {
  const build = () => {
    const harness = createJuliusHarness({
      workers: [
        { worker: CODER, script: [{ kind: 'fail', code: 'PROVIDER_UNAVAILABLE' }] },
        { worker: BACKUP_CODER, script: [{ kind: 'succeed', evidence: [{ type: 'TEST', status: 'PASSED', safeSummary: 'Suite green.' }] }] },
      ],
      card: cardPolicy({
        allowedProviders: [CODER.providerId, BACKUP_CODER.providerId],
        autonomy: 'AUTONOMOUS', fallback: true,
      }),
      capabilityFor,
    });
    harness.store.seedRun(RUN);
    harness.store.seedTask('run-1', task({ taskId: 'build-1', ordinal: 0, requiredEvidenceTypes: ['TEST'] }));
    return harness;
  };

  it('falls back to a second provider and completes the run', async () => {
    const harness = build();
    await drain(harness.loop);
    expect(harness.adapters.get(CODER.adapterId)!.dispatches.length).toBeGreaterThan(0);
    expect(harness.adapters.get(BACKUP_CODER.adapterId)!.dispatches.length).toBeGreaterThan(0);
    expect((await harness.store.loadRun('run-1', 'prj-1'))!.state).toBe('COMPLETED');
  });

  it('records the failure and the fallback rather than hiding a silent recovery', async () => {
    const harness = build();
    await drain(harness.loop);
    const types = new Set(harness.store.events().map((event) => event.type));
    expect(types.has('provider.failure')).toBe(true);
    expect(types.has('fallback.selected')).toBe(true);
    expect(types.has('run.completed')).toBe(true);
  });

  it('counts the fallback in the evals, and the run as verified', async () => {
    const harness = build();
    await drain(harness.loop);
    const events = harness.store.trajectory();
    const summary = summariseJuliusEvals(events, 'julius-runtime.v1');
    expect(summary.verifiedCompletions).toBe(1);
    expect(summary.verifiedCompletionRate).toBe(1);
    expect(summary.fallbacks).toBeGreaterThan(0);
    expect(projectJuliusMetrics(events, 'julius-runtime.v1').counters.julius_runs_completed).toBe(1);
  });

  it('refuses the fallback when C.A.R.D. denies it, and does not quietly succeed', async () => {
    const harness = createJuliusHarness({
      workers: [
        { worker: CODER, script: [{ kind: 'fail', code: 'PROVIDER_UNAVAILABLE' }] },
        { worker: BACKUP_CODER, script: [{ kind: 'succeed' }] },
      ],
      card: cardPolicy({
        allowedProviders: [CODER.providerId, BACKUP_CODER.providerId],
        autonomy: 'AUTONOMOUS', fallback: false,
      }),
      capabilityFor,
    });
    harness.store.seedRun(RUN);
    harness.store.seedTask('run-1', task({ taskId: 'build-1', ordinal: 0 }));
    await drain(harness.loop);
    expect(harness.adapters.get(BACKUP_CODER.adapterId)!.dispatches).toEqual([]);
    expect((await harness.store.loadRun('run-1', 'prj-1'))!.state).not.toBe('COMPLETED');
  });
});

/* ============================ SCENARIO 3 ============================== */

describe('scenario 3 — a bounded sub-agent, across a restart', () => {
  const build = () => {
    const harness = createJuliusHarness({
      workers: [{
        worker: CODER,
        script: Array.from({ length: 8 }, () => ({ kind: 'succeed' as const, evidence: [{ type: 'TEST', status: 'PASSED', safeSummary: 'ok' }] })),
      }],
      card: cardPolicy({
        allowedProviders: [CODER.providerId], autonomy: 'AUTONOMOUS',
        subagents: { allowed: true, maxDepth: 2, maxActive: 2, maxTotal: 3 },
      }),
      capabilityFor,
    });
    harness.store.seedRun(RUN);
    harness.store.seedTask('run-1', task({ taskId: 'anchor', ordinal: 0 }));
    return harness;
  };

  const policy = cardPolicy({
    allowedProviders: [CODER.providerId], autonomy: 'AUTONOMOUS',
    subagents: { allowed: true, maxDepth: 2, maxActive: 2, maxTotal: 3 },
  });

  it('spawns a bounded sub-agent that runs through the ordinary pipeline', async () => {
    const harness = build();
    const deps = {
      store: harness.store, budget: harness.budget, clock: harness.clock,
      ids: harness.ids, events: harness.store, trajectory: harness.store,
    };
    const spawned = await spawnJuliusSubagent({
      run: RUN, policy, requestId: 'sub-1', parentTaskId: 'anchor',
      role: 'CODING_AGENT', taskType: 'audit', capability: 'implement',
      requestedPermissions: ['read'], runPermissions: ['read', 'write_worktree'], usdMicros: 500,
    }, deps);
    expect(spawned.authorized).toBe(true);
    if (!spawned.authorized) return;

    await harness.loop.tick(scope);
    expect(harness.adapters.get(CODER.adapterId)!.dispatches.map((d) => d.taskId))
      .toContain(spawned.childTask.taskId);
    // Bounded: a fourth child is refused by the C.A.R.D. total.
    for (const requestId of ['sub-2', 'sub-3']) {
      await spawnJuliusSubagent({
        run: RUN, policy, requestId, parentTaskId: 'anchor', role: 'CODING_AGENT',
        taskType: 'audit', capability: 'implement', requestedPermissions: ['read'],
        runPermissions: ['read'], usdMicros: 100,
      }, deps);
    }
    const refused = await spawnJuliusSubagent({
      run: RUN, policy, requestId: 'sub-4', parentTaskId: 'anchor', role: 'CODING_AGENT',
      taskType: 'audit', capability: 'implement', requestedPermissions: ['read'],
      runPermissions: ['read'], usdMicros: 100,
    }, deps);
    expect(refused.authorized).toBe(false);
  });

  it('resumes the sub-agent grant after a simulated restart, without re-running finished work', async () => {
    const harness = build();
    const deps = {
      store: harness.store, budget: harness.budget, clock: harness.clock,
      ids: harness.ids, events: harness.store, trajectory: harness.store,
    };
    await spawnJuliusSubagent({
      run: RUN, policy, requestId: 'sub-1', parentTaskId: 'anchor',
      role: 'CODING_AGENT', taskType: 'audit', capability: 'implement',
      requestedPermissions: ['read'], runPermissions: ['read'], usdMicros: 500,
    }, deps);
    await harness.loop.tick(scope);
    const dispatchesBefore = harness.adapters.get(CODER.adapterId)!.dispatches.length;
    expect(dispatchesBefore).toBeGreaterThan(0);

    harness.store.restart();
    const resumed = new JuliusRunLoop(
      { ...harness.deps, owner: 'worker-after-restart' }, harness.policies,
      { claimLimit: 10, leaseMs: 60_000 },
    );
    await drain(resumed);

    // The sub-agent grant survived the restart.
    expect(await harness.store.loadSubagent('run-1', 'sub-1')).not.toBeNull();
    // Nothing that had already succeeded was dispatched a second time.
    const dispatched = harness.adapters.get(CODER.adapterId)!.dispatches.map((d) => d.taskId);
    expect(new Set(dispatched).size, 'a finished task was re-dispatched').toBe(dispatched.length);
  });

  it('never writes a credential or a chain of thought anywhere across all of it', async () => {
    const harness = build();
    const deps = {
      store: harness.store, budget: harness.budget, clock: harness.clock,
      ids: harness.ids, events: harness.store, trajectory: harness.store,
    };
    await spawnJuliusSubagent({
      run: RUN, policy, requestId: 'sub-1', parentTaskId: 'anchor',
      role: 'CODING_AGENT', taskType: 'audit', capability: 'implement',
      requestedPermissions: ['read'], runPermissions: ['read'], usdMicros: 500,
    }, deps);
    await drain(harness.loop);

    const everything = JSON.stringify({
      events: harness.store.events(),
      trajectory: harness.store.trajectory(),
      contexts: harness.store.contexts(),
      results: harness.store.results(),
    });
    for (const shape of [/sk-[A-Za-z0-9]{8,}/, /gh[pousr]_[A-Za-z0-9]{20,}/, /Bearer\s+[A-Za-z0-9._-]{16,}/]) {
      expect(shape.test(everything), `matched ${shape}`).toBe(false);
    }
    for (const phrase of ['chain of thought', 'scratchpad', 'system prompt', 'internal monologue']) {
      expect(everything.toLowerCase(), phrase).not.toContain(phrase);
    }
  });
});
