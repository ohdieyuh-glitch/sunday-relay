import { describe, expect, it } from 'vitest';

import {
  cardPolicy, createJuliusHarness, seedTaskContractInto, task, verificationPolicy, worker,
} from './julius-runtime-fixtures';
import { juliusContractSubjectTaskId } from './julius-task-pipeline';
import { evaluateJuliusSharedBinding, type JuliusTaskContractBinding } from './julius-task-contract';
import type { JuliusTask } from './julius-runtime';
import { injectJuliusFault } from './julius-fault-injection';
import { JuliusRunLoop } from './julius-run-loop';

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
      { worker: ARCHITECT, script: [PLAN_OK, PLAN_OK] },
      { worker: CODER, script: [BUILD_OK, BUILD_OK] },
      { worker: REVIEWER, script: [REVIEW_ACCEPT, REVIEW_ACCEPT, REVIEW_ACCEPT, REVIEW_ACCEPT] },
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

/**
 * Drive the run the way `driveJuliusRunToTerminal` does — tick, and when a tick
 * claims nothing, ask the run to advance. That second call is not a detail: a
 * run with no claimable task is never named by a tick, so it is the only place
 * a stranded run can be looked at, and a driver that skipped it would prove the
 * recovery path exists without ever entering it.
 */
async function drain(harness: ReturnType<typeof build>, ticks = 16): Promise<void> {
  for (let index = 0; index < ticks; index += 1) {
    const report = await harness.loop.tick(scope);
    if (report.claimed === 0) {
      const advance = await harness.loop.advanceRun('run-1', 'prj-1');
      if (advance === null || (!advance.changed && advance.resumedVerifications === 0)) break;
    }
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

/**
 * A CRASH AT THE LOCK BOUNDARY.
 *
 * The lock is written before the release precisely so that a crash between them
 * cannot leave a build announced runnable against unagreed terms. That is a
 * claim about an instant, and a test cannot reach an instant by waiting — it has
 * to cause it. Each case below fails ONE named store call, restarts, and asserts
 * the run reaches a state that is safe and then finishes.
 */
describe('a crash between the lock and the release', () => {
  const drive = async (harness: ReturnType<typeof build>, fault: { method: string; onCall: number }) => {
    const faulted = injectJuliusFault(harness.store, fault);
    const loop = new JuliusRunLoop(
      { ...harness.deps, store: faulted.store }, harness.policies, { claimLimit: 5, leaseMs: 60_000 },
    );
    // Ticks until the fault fires, exactly as the chaos suite drives one.
    for (let index = 0; index < 8 && !faulted.report.fired; index += 1) {
      try { await loop.tick(scope); } catch { break; }
    }
    return faulted.report;
  };

  /**
   * THE RESTART. Durable rows survive; the lease the dying process held does
   * not — which is exactly what `JuliusMemoryStore.restart()` models, and what
   * the chaos suite uses. Without it the task the fault interrupted stays ACTIVE
   * under a lease that has 60 seconds left, and the "resumes cleanly" claim
   * would be untestable rather than untrue.
   */
  const restart = (harness: ReturnType<typeof build>) => harness.store.restart();

  it('a crash AFTER the lock and BEFORE the decision leaves the terms agreed and the build still blocked', async () => {
    const harness = build({ contracts: 'draft' });
    // `appendDecision` is the write that records the plan review's acceptance
    // and releases the build. Failing it lands exactly in the window the
    // ordering exists for.
    const report = await drive(harness, { method: 'appendDecision', onCall: 1 });
    expect(report.fired, 'the boundary was actually reached').toBe(true);

    const contract = await harness.store.loadTaskContract({ projectId: 'prj-1', taskId: 'build-1' });
    expect(contract?.state, 'the terms are agreed').toBe('LOCKED');
    expect(harness.store.taskRow('build-1')?.state, 'and nothing was released').toBe('BLOCKED');
    expect(harness.adapters.get(CODER.adapterId)!.dispatches, 'so no coder ran').toEqual([]);

    // THE RESTART RESUMES RATHER THAN RE-AGREEING. The re-verification locks
    // nothing new — the lock is idempotent — and the release then happens.
    restart(harness);
    await drain(harness);
    expect(harness.store.events().filter((event) => event.type === 'contract.locked'), 'exactly one lock, ever').toHaveLength(1);
    expect(harness.store.taskRow('build-1')?.state).toBe('SUCCEEDED');
  });

  it('a crash DURING the lock leaves nothing agreed and nothing released, and the retry agrees once', async () => {
    const harness = build({ contracts: 'draft' });
    const report = await drive(harness, { method: 'lockTaskContract', onCall: 1 });
    expect(report.fired).toBe(true);

    const contract = await harness.store.loadTaskContract({ projectId: 'prj-1', taskId: 'build-1' });
    expect(contract?.state, 'the terms are still arguable').toBe('DRAFT');
    expect(harness.store.taskRow('build-1')?.state, 'and the build is still blocked').toBe('BLOCKED');

    restart(harness);
    await drain(harness);
    expect(harness.store.events().filter((event) => event.type === 'contract.locked')).toHaveLength(1);
    expect(harness.store.taskRow('build-1')?.state).toBe('SUCCEEDED');
  });

  it('a contract that never locks parks the run rather than completing it', async () => {
    // The store refuses every lock. The decision is still recorded — it is true
    // about the work that was reviewed — and the build is released, so the
    // DISPATCH GATE is the thing that has to hold. It does: the coder is never
    // paid, and the run does not report COMPLETED.
    const harness = build({ contracts: 'draft' });
    const refusing = {
      ...harness.store,
      lockTaskContract: async () => ({ locked: false as const, reasonCode: 'lock_contended', lockedRevision: null }),
    };
    const loop = new JuliusRunLoop(
      { ...harness.deps, store: refusing }, harness.policies, { claimLimit: 5, leaseMs: 60_000 },
    );
    for (let index = 0; index < 12; index += 1) {
      const report = await loop.tick(scope);
      if (report.outcomes.length === 0) break;
    }
    expect(harness.adapters.get(CODER.adapterId)!.dispatches, 'no coder was paid').toEqual([]);
    expect(harness.store.taskRow('build-1')?.state).not.toBe('SUCCEEDED');
    const refusals = harness.store.events().filter((event) => event.type === 'contract.refused');
    expect(refusals.map((event) => event.facts.reasonCode)).toContain('lock_contended');
  });
});

/**
 * THE ARCHITECT PROPOSES THE DETAIL, AND JULIUS LOCKS IT.
 *
 * Revision 1 is Julius's, cut from the Mission Contract, and it cannot hold what
 * only a planner knows — the exact checks, the narrowed boundary. The architect
 * proposes those in its result; Julius sanitises, refuses every mission-owned
 * field, stores what survives as a DRAFT, and the accepting plan review locks
 * THAT revision. This drives the whole cycle through the real run loop.
 */
describe('the full cycle — seed, propose, challenge, accept, lock', () => {
  const withProposal = (
    proposal: unknown,
    contracts: 'draft' | 'locked' = 'draft',
    reviewerScript = [REVIEW_ACCEPT, REVIEW_ACCEPT, REVIEW_ACCEPT, REVIEW_ACCEPT],
  ) => {
    const harness = createJuliusHarness({
      workers: [
        { worker: ARCHITECT, script: [{ ...PLAN_OK, contractProposal: proposal }, PLAN_OK] },
        { worker: CODER, script: [BUILD_OK, BUILD_OK] },
        { worker: REVIEWER, script: reviewerScript },
      ],
      card: cardPolicy({ allowedProviders: ['openai', 'anthropic', 'hermes'], capabilities: ['plan', 'implement', 'review'], concurrency: 1 }),
      verification: verificationPolicy({ reviewerRequired: true, maxRepairRounds: 3 }),
      capabilityFor,
    });
    harness.store.seedRun(RUN);
    seedTaskContractInto(harness.store, { runId: 'run-1', projectId: 'prj-1', taskId: 'build-1', state: contracts });
    harness.store.seedTask('run-1', task({ taskId: 'plan-1', ordinal: 0, role: 'PROMPT_ARCHITECT', taskType: 'plan', requiredEvidenceTypes: ['ARTIFACT'] }));
    harness.store.seedTask('run-1', task({
      taskId: 'build-1', ordinal: 1, role: 'CODING_AGENT', taskType: 'build',
      state: 'BLOCKED', dependencyIds: ['plan-1'], requiredEvidenceTypes: ['TEST'],
    }));
    harness.store.seedCriteria('run-1', [{ criterionId: 'ac-1', description: 'The tests pass.', requiredEvidenceTypes: [] }]);
    return harness;
  };

  it('stores the architect’s revision as a DRAFT and locks THAT one', async () => {
    const harness = withProposal({
      responsibilityBoundary: 'Implement src/slug.ts and its unit test; touch nothing else.',
      requiredChecks: ['npm test -- src/slug.test.ts'],
      permittedPaths: ['src/slug.ts', 'src/slug.test.ts'],
    });
    await drain(harness);

    const revisions = await harness.store.taskContractRevisions({ projectId: 'prj-1', taskId: 'build-1' });
    expect(revisions.map((row) => [row.contractRevision, row.state]))
      .toEqual([[1, 'DRAFT'], [2, 'LOCKED']]);

    const locked = await harness.store.loadTaskContract({ projectId: 'prj-1', taskId: 'build-1' });
    expect(locked?.requiredChecks).toEqual(['npm test -- src/slug.test.ts']);
    expect(locked?.permittedPaths).toEqual(['src/slug.ts', 'src/slug.test.ts']);
    expect(locked?.responsibilityBoundary).toContain('touch nothing else');

    // AND THE CODER RAN UNDER IT — the binding on the dispatch names revision 2.
    expect(bindingOf(harness, 'build-1')?.contractRevision).toBe(2);
    expect(bindingOf(harness, 'build-1:review')?.contractRevision).toBe(2);
    expect(harness.store.taskRow('build-1')?.state).toBe('SUCCEEDED');
  });

  it('a hostile proposal cannot move the money or the criteria, and the run still completes', async () => {
    const harness = withProposal({
      objective: 'anything at all',
      budget: { ceilingUsdMicros: 999_000_000, maxRepairRounds: 99 },
      blockingAcceptanceCriteria: [],
      runId: 'run-hijack', taskId: 'build-hijack', state: 'LOCKED', bindingDigest: 'sha256:0',
    });
    await drain(harness);

    const locked = await harness.store.loadTaskContract({ projectId: 'prj-1', taskId: 'build-1' });
    expect(locked?.state).toBe('LOCKED');
    expect(locked?.budget).toEqual({ ceilingUsdMicros: 20_000_000, maxRepairRounds: 3 });
    expect(locked?.blockingAcceptanceCriteria.map((c) => c.criterionId)).toEqual(['criterion-1']);
    expect(locked?.runId).toBe('run-1');
    expect(locked?.objective, 'the one field it MAY propose did move').toBe('anything at all');
    expect(harness.store.taskRow('build-1')?.state).toBe('SUCCEEDED');
  });

  it('a malformed proposal is recorded and the run continues on the revision it has', async () => {
    const harness = withProposal('not an object at all');
    await drain(harness);

    const refusals = harness.store.events().filter((event) => event.type === 'contract.refused');
    expect(refusals.map((event) => event.facts.reasonCode)).toContain('proposal_shape_refused');
    const revisions = await harness.store.taskContractRevisions({ projectId: 'prj-1', taskId: 'build-1' });
    expect(revisions.map((row) => row.contractRevision), 'no revision was cut').toEqual([1]);
    expect(revisions[0]?.state, 'and the seeded one was locked instead').toBe('LOCKED');
    expect(harness.store.taskRow('build-1')?.state, 'the plan is still the plan').toBe('SUCCEEDED');
  });

  it('refuses to revise terms that are ALREADY LOCKED — changing those is a decision', async () => {
    // Reachable whenever a planner finishes after the build's terms were agreed.
    // Allowing it would make "coding began under the terms that were locked"
    // false for the rest of the coder's run, retroactively.
    const harness = withProposal({ requiredChecks: ['npm test'] }, 'locked');
    await drain(harness);

    const refusals = harness.store.events().filter((event) => event.type === 'contract.refused');
    expect(refusals.map((event) => event.facts.reasonCode)).toContain('contract_already_locked');
    const revisions = await harness.store.taskContractRevisions({ projectId: 'prj-1', taskId: 'build-1' });
    expect(revisions.map((row) => [row.contractRevision, row.state])).toEqual([[1, 'LOCKED']]);
    expect(revisions[0]?.requiredChecks, 'the locked terms are untouched').toEqual([]);
  });

  it('announces the proposal only after the durable write, and names the revision', async () => {
    const harness = withProposal({ requiredChecks: ['npm test'] });
    await drain(harness);
    const proposed = harness.store.events().filter((event) => event.type === 'contract.proposed');
    expect(proposed).toHaveLength(1);
    expect(proposed[0]?.facts).toMatchObject({
      contractTaskId: 'build-1', contractRevision: 2, proposedBy: 'PROMPT_ARCHITECT',
    });
  });
});
