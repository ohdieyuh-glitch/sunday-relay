import { describe, expect, it } from 'vitest';

import { JuliusRunLoop } from './julius-run-loop';
import { juliusAllocationPolicy } from './julius-allocation-runtime';
import {
  cardPolicy, createJuliusHarness, task, verificationPolicy, worker,
} from './julius-runtime-fixtures';
import type { JuliusRunRow } from './julius-runtime-ports';

/**
 * PAID RUN 34037313976, REPRODUCED OFFLINE AND REPAIRED.
 *
 * The run's evidence, in order: the Coding Agent built BEFORE the plan review
 * (DEFECT 4), the plan review judged the plan by an implementation rubric
 * (DEFECT 2, held in the adapter suites), Julius decided REPAIR for the plan
 * and the repair planner minted a `repair:plan` task on the Coding Agent that
 * nobody could route (DEFECT 3), and separately the coder was refused at a
 * 50 cent ceiling of a $20 mission (DEFECT 1). Every scenario here runs the
 * real scheduler, pipeline, evaluator and repair planner against scripted
 * adapters. No provider is contacted.
 */

const ARCHITECT = worker({
  workerId: 'architect', role: 'PROMPT_ARCHITECT',
  capabilities: ['plan'], taskTypes: ['plan', 'repair:plan'], providerId: 'openai', adapterId: 'architect-adapter',
});
const CODER = worker({
  workerId: 'coder', role: 'CODING_AGENT',
  capabilities: ['implement'], taskTypes: ['build', 'repair:build'], providerId: 'anthropic', adapterId: 'coder-adapter',
});
const REVIEWER = worker({
  workerId: 'reviewer', role: 'INDEPENDENT_REVIEWER',
  capabilities: ['review'], taskTypes: ['review:plan', 'review:build', 'review:repair:plan', 'review:repair:build'],
  providerId: 'hermes', adapterId: 'reviewer-adapter',
});

const scope = { projectId: 'prj-1' };
const RUN: JuliusRunRow = {
  runId: 'run-1', missionId: 'msn-1', projectId: 'prj-1', state: 'READY',
  cardRevision: 'card-r1', missionContractRevision: 7, projectBrainRevision: 3, version: 1,
};
const capabilityFor = (item: { role: string }) =>
  (item.role === 'PROMPT_ARCHITECT' ? 'plan' : item.role === 'INDEPENDENT_REVIEWER' ? 'review' : 'implement');

const PLAN_OK = { kind: 'succeed' as const, evidence: [{ type: 'ARTIFACT', status: 'PASSED', safeSummary: 'Plan written.' }] };
const BUILD_OK = { kind: 'succeed' as const, evidence: [{ type: 'TEST', status: 'PASSED', safeSummary: 'Suite green.' }] };
const REVIEW_REJECT = { kind: 'succeed' as const, evidence: [{ type: 'REVIEW_FINDING', status: 'FAILED', safeSummary: 'The plan has no verification strategy.' }] };
const REVIEW_ACCEPT = { kind: 'succeed' as const, evidence: [{ type: 'REVIEW_FINDING', status: 'PASSED', safeSummary: 'No blocking findings.' }] };

async function drain(loop: JuliusRunLoop, maxTicks = 16): Promise<number> {
  for (let tick = 0; tick < maxTicks; tick += 1) {
    const report = await loop.tick(scope);
    if (report.claimed === 0) return tick;
  }
  return maxTicks;
}

function seed(harness: ReturnType<typeof createJuliusHarness>) {
  harness.store.seedRun(RUN);
  harness.store.seedTask('run-1', task({ taskId: 'plan-1', ordinal: 0, role: 'PROMPT_ARCHITECT', taskType: 'plan', requiredEvidenceTypes: ['ARTIFACT'] }));
  harness.store.seedTask('run-1', task({
    taskId: 'build-1', ordinal: 1, role: 'CODING_AGENT', taskType: 'build',
    state: 'BLOCKED', dependencyIds: ['plan-1'], requiredEvidenceTypes: ['TEST'],
  }));
  harness.store.seedCriteria('run-1', [{ criterionId: 'ac-1', description: 'A run summary is printed.', requiredEvidenceTypes: [] }]);
  harness.store.seedBrain('run-1', [
    { entryId: 'brain-1', kind: 'OBJECTIVE', text: 'Print a run summary.', taskIds: [], allowedRoles: ['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER'], sensitivity: 'INTERNAL' },
  ]);
}

const build = (input: {
  architect?: Parameters<typeof createJuliusHarness>[0]['workers'][number]['script'];
  coder?: Parameters<typeof createJuliusHarness>[0]['workers'][number]['script'];
  reviewer: Parameters<typeof createJuliusHarness>[0]['workers'][number]['script'];
  workers?: readonly { worker: ReturnType<typeof worker>; script: readonly { kind: 'succeed' }[] }[];
  maxRepairRounds?: number;
  allocation?: ReturnType<typeof juliusAllocationPolicy>;
  budgetUsdMicros?: number;
}) => {
  const harness = createJuliusHarness({
    workers: input.workers ?? [
      { worker: ARCHITECT, script: input.architect ?? [PLAN_OK, PLAN_OK] },
      { worker: CODER, script: input.coder ?? [BUILD_OK] },
      { worker: REVIEWER, script: input.reviewer },
    ],
    card: cardPolicy({ allowedProviders: ['openai', 'anthropic', 'hermes'], capabilities: ['plan', 'implement', 'review'], concurrency: 1 }),
    verification: verificationPolicy({ reviewerRequired: true, maxRepairRounds: input.maxRepairRounds ?? 3 }),
    capabilityFor,
    ...(input.allocation === undefined ? {} : { allocation: input.allocation }),
    ...(input.budgetUsdMicros === undefined ? {} : { budgetUsdMicros: input.budgetUsdMicros }),
  });
  seed(harness);
  return harness;
};

/* ============================ DEFECT 4 + 3 ============================ */

describe('DEFECT 4 — build waits for the plan review, and DEFECT 3 — a rejected plan is revised by the architect', () => {
  it('the paid run\'s own sequence, repaired: plan → plan review REJECTS → architect revises → re-review ACCEPTS → build → build review → COMPLETED', async () => {
    const harness = build({ reviewer: [REVIEW_REJECT, REVIEW_ACCEPT, REVIEW_ACCEPT] });
    await drain(harness.loop);
    // The claim order IS the execution order: one task per tick, in the order
    // Julius released them. (An outcome names its subject — a REPAIR_SCHEDULED
    // outcome for a review names the reviewed task — so the ledger is read.)
    const order = harness.store.events().filter((event) => event.type === 'task.claimed').map((event) => event.taskId);
    expect(order).toEqual([
      'plan-1',
      'plan-1:review',
      'repair:plan-1:1:task',
      'repair:plan-1:1:task:review',
      'build-1',
      'build-1:review',
    ]);
    // The revision went to the ARCHITECT, not the coder; the coder ran once, after acceptance.
    expect(harness.adapters.get(ARCHITECT.adapterId)!.dispatches.map((d) => [d.taskId, d.taskType]))
      .toEqual([['plan-1', 'plan'], ['repair:plan-1:1:task', 'repair:plan']]);
    expect(harness.adapters.get(CODER.adapterId)!.dispatches.map((d) => [d.taskId, d.taskType])).toEqual([['build-1', 'build']]);
    const tasks = await harness.store.tasksForRun('run-1', 'prj-1');
    const revision = tasks.find((item) => item.taskId === 'repair:plan-1:1:task');
    expect(revision).toMatchObject({ role: 'PROMPT_ARCHITECT', taskType: 'repair:plan', parentTaskId: 'plan-1', requiredEvidenceTypes: ['ARTIFACT'] });
    expect((await harness.store.loadRun('run-1', 'prj-1'))?.state).toBe('COMPLETED');
  });

  it('plan success alone releases nothing; the accepting decision releases the build exactly once', async () => {
    const harness = build({ reviewer: [REVIEW_ACCEPT, REVIEW_ACCEPT] });
    await harness.loop.tick(scope);
    expect(harness.store.taskRow('plan-1')!.state).toBe('SUCCEEDED');
    expect(harness.store.taskRow('build-1')!.state, 'SUCCEEDED is not ACCEPTED').toBe('BLOCKED');
    expect(harness.store.events().filter((event) => event.type === 'task.runnable')).toEqual([]);
    await harness.loop.tick(scope);
    expect(harness.store.taskRow('build-1')!.state).toBe('RUNNABLE');
    const releases = harness.store.events().filter((event) => event.type === 'task.runnable');
    expect(releases.map((event) => [event.taskId, event.facts.unblockedBy])).toEqual([['build-1', 'plan-1']]);
    const decided = harness.store.events().find((event) => event.type === 'verification.decided' && event.taskId === 'plan-1');
    expect(decided?.facts.released).toBe(1);
  });

  it('a rejected plan review releases nothing, and the build cannot race the review', async () => {
    const harness = build({ reviewer: [REVIEW_REJECT, REVIEW_REJECT, REVIEW_REJECT, REVIEW_REJECT] });
    await drain(harness.loop);
    expect(harness.adapters.get(CODER.adapterId)!.dispatches, 'the coder never ran').toEqual([]);
    expect(harness.store.taskRow('build-1')!.state).toBe('BLOCKED');
    expect(harness.store.events().filter((event) => event.type === 'task.runnable')).toEqual([]);
  });

  it('the plan revision preserves the objective and criteria and sees the findings it must address', async () => {
    const harness = build({ reviewer: [REVIEW_REJECT, REVIEW_ACCEPT, REVIEW_ACCEPT] });
    await drain(harness.loop);
    const contexts = harness.store.contexts().filter((snapshot) => snapshot.taskId === 'repair:plan-1:1:task');
    expect(contexts).toHaveLength(1);
    const text = contexts[0]!.packet.blocks.map((block) => block.text).join('\n');
    expect(text, 'the objective is unchanged').toContain('Print a run summary.');
    expect(contexts[0]!.acceptanceCriterionIds).toEqual(['ac-1']);
    expect(contexts[0]!.packet.blocks.some((block) => block.kind === 'FINDING')).toBe(true);
    expect(text).toContain('The plan has no verification strategy.');
    expect(contexts[0]!.findingIds.length).toBeGreaterThan(0);
    // And the re-review of the revision sees the same findings, to judge resolution.
    const reReview = harness.store.contexts().find((snapshot) => snapshot.taskId === 'repair:plan-1:1:task:review');
    expect(reReview?.packet.blocks.some((block) => block.kind === 'FINDING')).toBe(true);
  });

  it('a repair nobody can route HALTS the run before any task, reservation or attempt is spent', async () => {
    const harness = build({
      reviewer: [REVIEW_REJECT],
      workers: [
        { worker: worker({ ...ARCHITECT, taskTypes: ['plan'] }), script: [PLAN_OK] },
        { worker: CODER, script: [BUILD_OK] },
        { worker: REVIEWER, script: [REVIEW_REJECT] },
      ],
    });
    await drain(harness.loop);
    const tasks = await harness.store.tasksForRun('run-1', 'prj-1');
    expect(tasks.map((item) => item.taskId).sort()).toEqual(['build-1', 'plan-1', 'plan-1:review']);
    expect(tasks.find((item) => item.taskId.startsWith('repair:')), 'no unroutable task exists').toBeUndefined();
    const halt = harness.store.events().find((event) => event.type === 'run.failed');
    expect(halt?.facts.reasonCode).toBe('REPAIR_UNROUTABLE');
    expect(halt?.facts.repairRole).toBe('PROMPT_ARCHITECT');
    expect(halt?.facts.repairTaskType).toBe('repair:plan');
    expect(harness.adapters.get(CODER.adapterId)!.dispatches).toEqual([]);
    expect(harness.budget.reservations().filter((row) => row.reservationId.includes('repair'))).toEqual([]);
    expect(harness.store.events().some((event) => event.type === 'task.failed' && event.facts.code === 'PROVIDER_UNAVAILABLE'),
      'never the generic outage code the paid run recorded').toBe(false);
  });

  it('repair rounds are charged honestly along the lineage and the bound holds', async () => {
    const harness = build({ reviewer: [REVIEW_REJECT, REVIEW_REJECT, REVIEW_REJECT, REVIEW_REJECT], maxRepairRounds: 2, architect: [PLAN_OK, PLAN_OK, PLAN_OK, PLAN_OK] });
    await drain(harness.loop, 24);
    const tasks = await harness.store.tasksForRun('run-1', 'prj-1');
    const revisions = tasks.filter((item) => item.taskType === 'repair:plan').map((item) => item.taskId).sort();
    expect(revisions).toEqual(['repair:plan-1:1:task', 'repair:repair:plan-1:1:task:2:task']);
    const halt = harness.store.events().find((event) => event.type === 'run.failed' && event.facts.reasonCode === 'repair_round_limit');
    expect(halt).toBeDefined();
    expect(harness.store.taskRow('build-1')!.state).toBe('BLOCKED');
  });

  it('a restart reconstructs the same claimable set from durable rows alone', async () => {
    const harness = build({ reviewer: [REVIEW_REJECT, REVIEW_ACCEPT, REVIEW_ACCEPT] });
    await harness.loop.tick(scope);
    await harness.loop.tick(scope);
    // "Restart": a fresh loop over the SAME store, with fresh adapters.
    const resumed = createJuliusHarness({
      workers: [
        { worker: ARCHITECT, script: [PLAN_OK] }, { worker: CODER, script: [BUILD_OK] }, { worker: REVIEWER, script: [REVIEW_ACCEPT, REVIEW_ACCEPT] },
      ],
      card: cardPolicy({ allowedProviders: ['openai', 'anthropic', 'hermes'], capabilities: ['plan', 'implement', 'review'], concurrency: 1 }),
      verification: verificationPolicy({ reviewerRequired: true, maxRepairRounds: 3 }),
      capabilityFor,
    });
    const loop = new JuliusRunLoop({ ...resumed.deps, store: harness.store }, resumed.policies, { claimLimit: 10, leaseMs: 60_000 });
    const order: string[] = [];
    for (let tick = 0; tick < 12; tick += 1) {
      const report = await loop.tick(scope);
      order.push(...report.outcomes.map((outcome) => outcome.taskId));
      if (report.claimed === 0) break;
    }
    expect(order).toEqual(['repair:plan-1:1:task', 'repair:plan-1:1:task:review', 'build-1', 'build-1:review']);
    expect(resumed.adapters.get(CODER.adapterId)!.dispatches.map((d) => d.taskId)).toEqual(['build-1']);
  });
});

/* ============================== DEFECT 1 ============================== */

describe('DEFECT 1 — the mission budget governs the Coding Agent dispatch', () => {
  const USD = 1_000_000;
  const MISSION_2 = juliusAllocationPolicy({ ceilingUsdMicros: 20 * USD, authorizedRepairRounds: 3 });

  it('the coder is dispatched with an allocation derived from ITS mission\'s contract, and reserves exactly that', async () => {
    const harness = build({ reviewer: [REVIEW_ACCEPT, REVIEW_ACCEPT], allocation: MISSION_2, budgetUsdMicros: 20 * USD });
    await drain(harness.loop);
    const coder = harness.adapters.get(CODER.adapterId)!.dispatches;
    expect(coder).toHaveLength(1);
    expect(coder[0]!.allocation).toEqual({ usdMicros: 5 * USD, policyVersion: 'julius-allocation.v1', basis: 'CODER_SHARE' });
    const reserved = harness.budget.reservations().find((row) => row.reservationId.includes('build-1') && row.state === 'COMMITTED');
    expect(reserved, 'settled to what the scripted coder actually reported').toMatchObject({ usdMicros: 1_000 });
    const allocated = harness.store.events().filter((event) => event.type === 'budget.allocated');
    expect(allocated.map((event) => [event.taskId, event.facts.allocatedUsdMicros, event.facts.allocationBasis]))
      .toEqual([['plan-1', 2_000, 'ESTIMATE'], ['plan-1:review', 2_000, 'ESTIMATE'], ['build-1', 5 * USD, 'CODER_SHARE'], ['build-1:review', 2_000, 'ESTIMATE']]);
    // Nothing but the coder is governed by the share; the others reserve their estimate.
    expect(harness.adapters.get(ARCHITECT.adapterId)!.dispatches[0]!.allocation?.basis).toBe('ESTIMATE');
  });

  it('a composition without a policy hands the adapter NO allocation, so its conservative default stands', async () => {
    const harness = build({ reviewer: [REVIEW_ACCEPT, REVIEW_ACCEPT] });
    await drain(harness.loop);
    expect(harness.adapters.get(CODER.adapterId)!.dispatches[0]!.allocation).toBeUndefined();
    expect(harness.store.events().filter((event) => event.type === 'budget.allocated')).toEqual([]);
  });

  it('an exhausted mission budget denies the coder BEFORE dispatch, and repairs draw from the same ledger', async () => {
    const harness = build({ reviewer: [REVIEW_ACCEPT, REVIEW_ACCEPT], allocation: MISSION_2, budgetUsdMicros: 20 * USD });
    // The plan and its review run and are accepted; then the whole remaining
    // mission budget is taken before the released build can be claimed.
    await harness.loop.tick(scope);
    await harness.loop.tick(scope);
    expect(harness.store.taskRow('build-1')!.state).toBe('RUNNABLE');
    await harness.budget.reserve({ reservationId: 'earlier', runId: 'run-1', projectId: 'prj-1', taskId: 'x', usdMicros: harness.budget.remainingUsdMicros(), inputTokens: 0, outputTokens: 0, toolCalls: 0, runtimeMs: 0, now: 'now' });
    await drain(harness.loop);
    expect(harness.adapters.get(CODER.adapterId)!.dispatches, 'no provider was reached').toEqual([]);
    const denied = harness.store.events().find((event) => event.type === 'budget.denied' && event.taskId === 'build-1');
    expect(denied?.facts.allocationBasis).toBe('EXHAUSTED');
    expect(harness.store.taskRow('build-1')!.state).toBe('FAILED');
  });

  it('allocations across the build and its repairs never sum past the ceiling', async () => {
    const policy = juliusAllocationPolicy({ ceilingUsdMicros: 12_000, authorizedRepairRounds: 1 });
    const harness = build({
      reviewer: [REVIEW_ACCEPT, REVIEW_REJECT, REVIEW_ACCEPT],
      // Each round spends within what it was allocated, as the hosted adapter
      // enforces (a run over its allocation is refused, never committed).
      coder: [{ ...BUILD_OK, usdMicros: 5_000 }, { ...BUILD_OK, usdMicros: 2_000 }],
      allocation: policy, budgetUsdMicros: 12_000, maxRepairRounds: 1,
    });
    await drain(harness.loop, 24);
    const coder = harness.adapters.get(CODER.adapterId)!.dispatches;
    // The build got a full share; by the repair, the plan, both reviews and
    // the build had settled 8,000 of the 12,000, so the repair was allocated
    // the 4,000 that remained — never its full share, never past the ceiling.
    expect(coder.map((d) => [d.taskType, d.allocation?.usdMicros, d.allocation?.basis]))
      .toEqual([['build', 6_000, 'CODER_SHARE'], ['repair:build', 4_000, 'CODER_REMAINDER']]);
    const allocated = coder.reduce((sum, d) => sum + (d.allocation?.usdMicros ?? 0), 0);
    expect(allocated).toBeLessThanOrEqual(12_000);
    // plan 1,000 + plan review 1,000 + build 5,000 + build review 1,000 +
    // repair 2,000 + repair review 1,000: settled to what each actually
    // reported, never past the ceiling, and the mission completed inside it.
    const committed = harness.budget.reservations().filter((row) => row.state === 'COMMITTED').reduce((sum, row) => sum + row.usdMicros, 0);
    expect(committed).toBe(11_000);
    expect(harness.budget.remainingUsdMicros()).toBe(1_000);
    expect((await harness.store.loadRun('run-1', 'prj-1'))?.state).toBe('COMPLETED');
  });
});

/* ================== the defects this change nearly introduced ============= */

describe('the repairs hold their own edges', () => {
  const USD = 1_000_000;
  const MISSION_2 = juliusAllocationPolicy({ ceilingUsdMicros: 20 * USD, authorizedRepairRounds: 3 });

  it('an attempt that BILLED before it failed is charged, so the retry cannot be granted that money twice', async () => {
    const harness = build({
      reviewer: [REVIEW_ACCEPT, REVIEW_ACCEPT],
      coder: [{ kind: 'fail', code: 'TIMEOUT', costUsdMicros: 4_900_000 }, BUILD_OK],
      allocation: MISSION_2, budgetUsdMicros: 20 * USD,
    });
    await drain(harness.loop, 20);
    // The timed-out attempt billed $4.90 of its $5 allocation. Releasing that
    // to zero would have handed the retry the same $5 a second time.
    const charged = harness.budget.reservations().filter((row) => row.state === 'COMMITTED' && row.usdMicros === 4_900_000);
    expect(charged, 'the billed attempt is a settlement, not a hand-back').toHaveLength(1);
    const settled = harness.store.events().filter((event) => event.type === 'budget.settled');
    expect(settled.some((event) => event.facts.usdMicros === 4_900_000 && event.facts.reason === 'TIMEOUT')).toBe(true);
    expect(harness.budget.remainingUsdMicros()).toBeLessThanOrEqual(20 * USD - 4_900_000);
    expect(harness.adapters.get(CODER.adapterId)!.dispatches, 'the retry did run').toHaveLength(2);
  });

  it('a completed dispatch whose runtime reported NO cost keeps its reservation: Unknown is not zero', async () => {
    const harness = build({
      reviewer: [REVIEW_ACCEPT, REVIEW_ACCEPT],
      coder: [{ ...BUILD_OK, usdMicros: null }],
      allocation: MISSION_2, budgetUsdMicros: 20 * USD,
    });
    await drain(harness.loop);
    const build1 = harness.budget.reservations().find((row) => row.reservationId.includes('build-1') && row.state === 'COMMITTED');
    expect(build1?.usdMicros, 'settled at what was reserved, never at zero').toBe(5 * USD);
    const settled = harness.store.events().filter((event) => event.type === 'budget.settled');
    expect(settled.some((event) => event.facts.usdMicros === null), 'and the record says Unknown, not 0').toBe(true);
  });

  it('a decision that was already recorded schedules no second repair round', async () => {
    // `appendDecision` is idempotent by key. A replayed verification that
    // ignored that would mint a SECOND repair beside the first — a fresh id, a
    // fresh reservation, a paid dispatch for work already scheduled.
    const harness = build({ reviewer: [REVIEW_REJECT, REVIEW_ACCEPT, REVIEW_ACCEPT] });
    const replaying = { ...harness.store, appendDecision: async () => false } as typeof harness.store;
    const loop = new JuliusRunLoop({ ...harness.deps, store: replaying }, harness.policies, { claimLimit: 10, leaseMs: 60_000 });
    for (let tick = 0; tick < 8; tick += 1) if ((await loop.tick(scope)).claimed === 0) break;
    const tasks = await harness.store.tasksForRun('run-1', 'prj-1');
    expect(tasks.filter((task) => task.taskId.startsWith('repair:')), 'no repair was scheduled by a decision that did not land').toEqual([]);
    expect(harness.store.events().filter((event) => event.type === 'repair.scheduled')).toEqual([]);
  });

  it('a repair whose findings do not fit its context is refused, never dispatched blind', async () => {
    const harness = build({ reviewer: [REVIEW_REJECT, REVIEW_ACCEPT, REVIEW_ACCEPT] });
    // A context budget that fits the Project Brain and not the findings: the
    // compiler stops at the first entry that would overflow, so the entries
    // the repair exists to address are exactly what it drops.
    const loop = new JuliusRunLoop({ ...harness.deps, contextCharacterBudget: 40 }, harness.policies, { claimLimit: 10, leaseMs: 60_000 });
    for (let tick = 0; tick < 8; tick += 1) if ((await loop.tick(scope)).claimed === 0) break;
    const revision = harness.store.taskRow('repair:plan-1:1:task');
    expect(revision?.state, 'the revision failed rather than revising blind').toBe('FAILED');
    const failure = harness.store.events().find((event) => event.type === 'task.failed' && event.facts.failureClass === 'repair_context_findings_dropped');
    expect(failure, 'and the record names why').toBeDefined();
    expect(failure!.facts.droppedFindings).toBe(1);
    // The architect was dispatched for the plan only, never for the blind revision.
    expect(harness.adapters.get(ARCHITECT.adapterId)!.dispatches.map((d) => d.taskId)).toEqual(['plan-1']);
  });
});

describe('a Coding Agent timeout that reported no cost', () => {
  const USD = 1_000_000;
  const MISSION_2 = juliusAllocationPolicy({ ceilingUsdMicros: 20 * USD, authorizedRepairRounds: 3 });

  it('keeps its hold, so the retry is not granted money the first attempt may already have spent', async () => {
    const harness = build({
      reviewer: [REVIEW_ACCEPT, REVIEW_ACCEPT],
      // A hosted timeout: the runtime started and the final message that would
      // have carried the cost never arrived.
      coder: [{ kind: 'fail', code: 'TIMEOUT', runtimeStarted: true }, BUILD_OK],
      allocation: MISSION_2, budgetUsdMicros: 20 * USD,
    });
    await drain(harness.loop, 20);
    // The timed-out attempt's own reservation, settled at the whole allocation
    // it was holding rather than freed.
    const held = harness.budget.reservations()
      .filter((row) => row.reservationId.includes('build-1') && row.state === 'COMMITTED' && row.usdMicros === 5 * USD);
    expect(held, 'the hold stands: Unknown spend is not zero spend').toHaveLength(1);
    const settled = harness.store.events().filter((event) => event.type === 'budget.settled' && event.facts.reason === 'TIMEOUT');
    expect(settled, 'and the record says the amount is Unknown').toHaveLength(1);
    expect(settled[0]!.facts.usdMicros).toBeNull();
  });

  it('but a dispatch that never reached a runtime hands its whole hold back', async () => {
    const harness = build({
      reviewer: [REVIEW_ACCEPT, REVIEW_ACCEPT],
      coder: [{ kind: 'fail', code: 'RATE_LIMIT', runtimeStarted: false }, BUILD_OK],
      allocation: MISSION_2, budgetUsdMicros: 20 * USD,
    });
    await drain(harness.loop, 20);
    expect(harness.budget.reservations().some((row) => row.state === 'RELEASED' && row.usdMicros === 0)).toBe(true);
  });
});
