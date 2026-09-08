import { describe, expect, it } from 'vitest';

import {
  cardPolicy, createJuliusHarness, seedTaskContractInto, task, verificationPolicy, worker,
} from './julius-runtime-fixtures';
import { juliusContractSubjectTaskId } from './julius-task-pipeline';
import { evaluateJuliusSharedBinding, type JuliusTaskContractBinding } from './julius-task-contract';
import type { JuliusTask } from './julius-runtime';

/**
 * THE CONTRACT GATE, DRIVEN THROUGH THE REAL RUN LOOP.
 *
 * `julius-task-contract.test.ts` proves the rules and
 * `julius-task-contract-store.test.ts` proves the durability. This proves the
 * WIRING: that a build genuinely cannot start before its terms are locked, that
 * the accepting plan review is what locks them, and that the coder and its
 * reviewer end up holding the same binding — read back off the durable ledger
 * rather than asserted about the code path.
 *
 * Every case runs provider-free against scripted adapters.
 */

const ARCHITECT = worker({
  workerId: 'architect', role: 'PROMPT_ARCHITECT', providerId: 'openai',
  adapterId: 'architect-adapter', capabilities: ['plan'], taskTypes: ['plan', 'repair:plan'],
});
const CODER = worker({
  workerId: 'coder', role: 'CODING_AGENT', providerId: 'anthropic',
  adapterId: 'coder-adapter', capabilities: ['implement'], taskTypes: ['build', 'repair:build'],
});
const REVIEWER = worker({
  workerId: 'reviewer', role: 'INDEPENDENT_REVIEWER', providerId: 'hermes',
  adapterId: 'reviewer-adapter', capabilities: ['review'],
  taskTypes: ['review:plan', 'review:build', 'review:repair:plan', 'review:repair:build'],
});

const PLAN_OK = { kind: 'succeed' as const, evidence: [{ type: 'ARTIFACT' as const, status: 'PASSED' as const, safeSummary: 'plan' }] };
const BUILD_OK = { kind: 'succeed' as const, evidence: [{ type: 'TEST' as const, status: 'PASSED' as const, safeSummary: 'tests pass' }] };
const REVIEW_ACCEPT = { kind: 'succeed' as const, evidence: [{ type: 'REVIEW_FINDING' as const, status: 'PASSED' as const, safeSummary: 'no blocking findings' }] };

const capabilityFor = (value: { role: string }) =>
  value.role === 'PROMPT_ARCHITECT' ? 'plan' : value.role === 'INDEPENDENT_REVIEWER' ? 'review' : 'implement';

const scope = { projectId: 'prj-1' };
const RUN = {
  runId: 'run-1', missionId: 'msn-1', projectId: 'prj-1', state: 'READY' as const,
  cardRevision: 'card-r1', missionContractRevision: 1, projectBrainRevision: 0, version: 1,
};

function build(input: { contracts?: 'locked' | 'draft' | 'none' } = {}) {
  const harness = createJuliusHarness({
    workers: [
      { worker: ARCHITECT, script: [PLAN_OK] },
      { worker: CODER, script: [BUILD_OK] },
      { worker: REVIEWER, script: [REVIEW_ACCEPT, REVIEW_ACCEPT] },
    ],
    card: cardPolicy({ allowedProviders: ['openai', 'anthropic', 'hermes'], capabilities: ['plan', 'implement', 'review'], concurrency: 1 }),
    verification: verificationPolicy({ reviewerRequired: true, maxRepairRounds: 3 }),
    capabilityFor,
  });
  harness.store.seedRun(RUN);
  seedTaskContractInto(harness.store, {
    runId: 'run-1', projectId: 'prj-1', taskId: 'build-1', state: input.contracts ?? 'draft',
  });
  harness.store.seedTask('run-1', task({ taskId: 'plan-1', ordinal: 0, role: 'PROMPT_ARCHITECT', taskType: 'plan', requiredEvidenceTypes: ['ARTIFACT'] }));
  harness.store.seedTask('run-1', task({
    taskId: 'build-1', ordinal: 1, role: 'CODING_AGENT', taskType: 'build',
    state: 'BLOCKED', dependencyIds: ['plan-1'], requiredEvidenceTypes: ['TEST'],
  }));
  harness.store.seedCriteria('run-1', [{ criterionId: 'ac-1', description: 'The tests pass.', requiredEvidenceTypes: [] }]);
  return harness;
}

async function drain(harness: ReturnType<typeof build>, ticks = 14): Promise<void> {
  for (let index = 0; index < ticks; index += 1) {
    const outcomes = await harness.loop.tick(scope);
    if (outcomes.length === 0) return;
  }
}

const bindingOf = (harness: ReturnType<typeof build>, taskId: string): JuliusTaskContractBinding | null => {
  const claimed = harness.store.events().find((event) => event.type === 'task.claimed' && event.taskId === taskId);
  const facts = claimed?.facts ?? {};
  return typeof facts.bindingDigest === 'string' && typeof facts.contractRevision === 'number' && typeof facts.contractId === 'string'
    ? { contractId: facts.contractId, taskId: 'build-1', contractRevision: facts.contractRevision, bindingDigest: facts.bindingDigest }
    : null;
};

describe('rule 1 — the build cannot start before its contract is locked', () => {
  it('a run whose contract is only a DRAFT still locks it at the accepting plan review, then builds', async () => {
    const harness = build({ contracts: 'draft' });
    await drain(harness);

    const locks = harness.store.events().filter((event) => event.type === 'contract.locked');
    expect(locks).toHaveLength(1);
    expect(locks[0]?.facts.contractTaskId).toBe('build-1');
    expect(locks[0]?.facts.contractRevision).toBe(1);

    // THE ORDER IS THE GUARANTEE: the lock is written before the release, so no
    // ledger ever shows a build announced runnable against unagreed terms.
    const types = harness.store.events().map((event) => `${event.type}:${event.taskId}`);
    expect(types.indexOf('contract.locked:build-1')).toBeLessThan(types.indexOf('task.runnable:build-1'));
    expect(types.indexOf('contract.locked:build-1')).toBeLessThan(types.indexOf('task.claimed:build-1'));

    expect(harness.store.taskRow('build-1')?.state).toBe('SUCCEEDED');
  });

  it('with NO contract at all the coder is refused, before any attempt is spent', async () => {
    const harness = build({ contracts: 'none' });
    await drain(harness);

    const refusals = harness.store.events().filter((event) => event.type === 'contract.refused');
    expect(refusals.map((event) => event.facts.reasonCode)).toContain('contract_absent');
    expect(harness.adapters.get(CODER.adapterId)!.dispatches, 'no coder was paid for a run with no agreed terms').toEqual([]);
    expect(harness.store.taskRow('build-1')?.state).toBe('FAILED');
    // THE REFUSAL COSTS NO TURN: the gate runs before `admitTask`, so the task
    // failed on attempt 0 rather than burning one of its three.
    expect(harness.store.taskRow('build-1')?.attempt).toBe(0);
  });

  it('the architect and its own review are never gated — they are what produce the terms', async () => {
    const harness = build({ contracts: 'none' });
    await drain(harness);
    expect(harness.adapters.get(ARCHITECT.adapterId)!.dispatches.map((d) => d.taskId)).toEqual(['plan-1']);
    expect(harness.store.taskRow('plan-1')?.state).toBe('SUCCEEDED');
    expect(harness.store.taskRow('plan-1:review')?.state).toBe('SUCCEEDED');
  });
});

describe('rule 2 — the coder and its reviewer hold the same binding', () => {
  it('records the same contract, revision and digest on both dispatches', async () => {
    const harness = build({ contracts: 'draft' });
    await drain(harness);

    const implementation = bindingOf(harness, 'build-1');
    const review = bindingOf(harness, 'build-1:review');
    expect(implementation, 'the coder was dispatched under a binding').not.toBeNull();
    expect(review, 'the reviewer was dispatched under a binding').not.toBeNull();
    expect(evaluateJuliusSharedBinding({ implementation, review }))
      .toEqual({ shared: true, binding: implementation });
  });

  it('the architect carries no binding — a null that says "not bound", not "unchecked"', async () => {
    const harness = build({ contracts: 'draft' });
    await drain(harness);
    const claimed = harness.store.events().find((event) => event.type === 'task.claimed' && event.taskId === 'plan-1');
    expect(claimed?.facts.bindingDigest).toBeNull();
    expect(claimed?.facts.contractRevision).toBeNull();
  });
});

describe('which task’s contract governs which', () => {
  const tasks = [
    task({ taskId: 'build-1', role: 'CODING_AGENT', taskType: 'build' }),
    task({ taskId: 'repair:build-1:1:task', role: 'CODING_AGENT', taskType: 'repair:build', parentTaskId: 'build-1' }),
    task({ taskId: 'repair:repair:build-1:1:task:1:task', role: 'CODING_AGENT', taskType: 'repair:repair:build', parentTaskId: 'repair:build-1:1:task' }),
    task({ taskId: 'subagent:audit-1', role: 'CODING_AGENT', taskType: 'audit', parentTaskId: 'build-1' }),
    task({ taskId: 'build-1:review', role: 'INDEPENDENT_REVIEWER', taskType: 'review:build', parentTaskId: 'build-1' }),
    task({ taskId: 'plan-1', role: 'PROMPT_ARCHITECT', taskType: 'plan' }),
    task({ taskId: 'plan-1:review', role: 'INDEPENDENT_REVIEWER', taskType: 'review:plan', parentTaskId: 'plan-1' }),
  ].map((value) => ({ ...value, missionId: 'msn-1' })) as readonly JuliusTask[];

  const subject = (taskId: string) =>
    juliusContractSubjectTaskId(tasks.find((value) => value.taskId === taskId)!, tasks);

  it('a repair round, and a repair of a repair, are governed by the build’s contract', () => {
    expect(subject('build-1')).toBe('build-1');
    expect(subject('repair:build-1:1:task')).toBe('build-1');
    expect(subject('repair:repair:build-1:1:task:1:task')).toBe('build-1');
  });

  it('a bounded sub-agent inherits its parent’s contract, so it cannot write its own', () => {
    expect(subject('subagent:audit-1')).toBe('build-1');
  });

  it('the reviewer of a coding task is bound by that task’s contract', () => {
    expect(subject('build-1:review')).toBe('build-1');
  });

  it('the architect and its review are bound by none — they produce the terms', () => {
    expect(subject('plan-1')).toBeNull();
    expect(subject('plan-1:review')).toBeNull();
  });

  it('a cycle in the parent chain is climbed once and then abandoned, never forever', () => {
    const cyclic = [
      { ...task({ taskId: 'a', role: 'CODING_AGENT', parentTaskId: 'b' }), missionId: 'msn-1' },
      { ...task({ taskId: 'b', role: 'CODING_AGENT', parentTaskId: 'a' }), missionId: 'msn-1' },
    ] as readonly JuliusTask[];
    expect(juliusContractSubjectTaskId(cyclic[0]!, cyclic)).toBe('b');
  });
});
