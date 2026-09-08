import { describe, expect, it } from 'vitest';

import {
  cardPolicy, createJuliusHarness, seedTaskContractInto, task, verificationPolicy, worker, type JuliusHarness,
} from './julius-runtime-fixtures';
import { juliusContractSubjectTaskId, prepareClaimedTask, runClaimedTask, type JuliusPipelineRequest, type JuliusTaskPreflight } from './julius-task-pipeline';
import type { JuliusTask } from './julius-runtime';
import {
  evaluateJuliusSharedBinding, juliusTaskContractBindingDigest, reviseJuliusTaskContract,
  type JuliusTaskContract, type JuliusTaskContractBinding, type JuliusTaskContractProposal,
} from './julius-task-contract';
import { spawnJuliusSubagent } from './julius-subagent-runtime';
import { injectJuliusFault } from './julius-fault-injection';
import { JuliusRunLoop } from './julius-run-loop';

/**
 * STALE HANDOFF REJECTION AND LOCK INTEGRITY.
 *
 * `julius-contract-gate.e2e.test.ts` proves a build cannot START before its
 * terms are locked. This file proves the harder half: that a handoff compiled
 * under one agreement cannot be EXECUTED under another, that the reviewer
 * grades against the agreement the coder held and no other, that a locked
 * agreement cannot be edited, that repairs and sub-agents inherit it rather
 * than write their own, and that a crash at any of those boundaries leaves the
 * same agreement standing.
 *
 * Nothing here is a second state machine. Every case drives the real run loop
 * or the real pipeline functions the loop calls, against the real memory store
 * and the same scripted adapters every other end-to-end suite uses, and reads
 * its answers back off the durable ledger.
 *
 * WHY SOME CASES CALL THE PIPELINE DIRECTLY. The window a stale handoff lives
 * in is between `prepareClaimedTask` reading the lock and `runClaimedTask`
 * reserving money — a window the loop crosses in one breath, with no hook to
 * hold it open. Calling the two halves by hand is the only honest way to stand
 * inside it; it is the same code, in the same order, with the same store.
 */

const ARCHITECT = worker({
  workerId: 'architect', role: 'PROMPT_ARCHITECT', providerId: 'openai',
  adapterId: 'architect-adapter', capabilities: ['plan'], taskTypes: ['plan', 'repair:plan'],
});
const CODER = worker({
  workerId: 'coder', role: 'CODING_AGENT', providerId: 'anthropic',
  adapterId: 'coder-adapter', capabilities: ['implement'], taskTypes: ['build', 'repair:build', 'audit'],
});
const REVIEWER = worker({
  workerId: 'reviewer', role: 'INDEPENDENT_REVIEWER', providerId: 'hermes',
  adapterId: 'reviewer-adapter', capabilities: ['review'],
  taskTypes: ['review:plan', 'review:build', 'review:repair:plan', 'review:repair:build'],
});
/** A resolvable, dispatchable role that is none of the three slots — the shape that used to run under no agreement. */
const SPECIALIST = worker({
  workerId: 'specialist', role: 'SPECIALIST:research', providerId: 'openai',
  adapterId: 'specialist-adapter', capabilities: ['implement'], taskTypes: ['audit', 'research'],
});

const PLAN_OK = { kind: 'succeed' as const, evidence: [{ type: 'ARTIFACT' as const, status: 'PASSED' as const, safeSummary: 'plan' }] };
const BUILD_OK = { kind: 'succeed' as const, evidence: [{ type: 'TEST' as const, status: 'PASSED' as const, safeSummary: 'tests pass' }] };
const REVIEW_ACCEPT = { kind: 'succeed' as const, evidence: [{ type: 'REVIEW_FINDING' as const, status: 'PASSED' as const, safeSummary: 'no blocking findings' }] };
const REVIEW_REJECT = { kind: 'succeed' as const, evidence: [{ type: 'REVIEW_FINDING' as const, status: 'FAILED' as const, safeSummary: 'a blocking finding' }] };

type Script = Parameters<typeof createJuliusHarness>[0]['workers'][number]['script'];

const capabilityFor = (value: { role: string }) =>
  value.role === 'PROMPT_ARCHITECT' ? 'plan' : value.role === 'INDEPENDENT_REVIEWER' ? 'review' : 'implement';

const scope = { projectId: 'prj-1' };
const RUN = {
  runId: 'run-1', missionId: 'msn-1', projectId: 'prj-1', state: 'READY' as const,
  cardRevision: 'card-r1', missionContractRevision: 1, projectBrainRevision: 0, version: 1,
};

/**
 * Three graphs, each the smallest that reaches the boundary under test:
 *
 *   plan+build       the ordinary mission — the accepting plan review locks the
 *                    terms and releases the build, exactly as production does
 *   build-only       a build already released, so a claim reaches the handoff
 *                    in one step
 *   build-reviewed   a build that SUCCEEDED with no record of the agreement it
 *                    ran under, and its review waiting — the shape a store
 *                    written before the binding was recorded would present
 */
function build(input: {
  contracts?: 'locked' | 'draft' | 'none';
  graph?: 'plan+build' | 'build-only' | 'build-reviewed';
  architect?: Script; coder?: Script; reviewer?: Script;
  subagents?: boolean;
} = {}): JuliusHarness {
  const harness = createJuliusHarness({
    workers: [
      { worker: ARCHITECT, script: input.architect ?? [PLAN_OK, PLAN_OK, PLAN_OK] },
      { worker: CODER, script: input.coder ?? [BUILD_OK, BUILD_OK, BUILD_OK] },
      { worker: REVIEWER, script: input.reviewer ?? [REVIEW_ACCEPT, REVIEW_ACCEPT, REVIEW_ACCEPT, REVIEW_ACCEPT, REVIEW_ACCEPT] },
      { worker: SPECIALIST, script: [BUILD_OK, BUILD_OK] },
    ],
    card: cardPolicy({
      allowedProviders: ['openai', 'anthropic', 'hermes'], capabilities: ['plan', 'implement', 'review'], concurrency: 1,
      ...(input.subagents === true ? { autonomy: 'AUTONOMOUS' as const, subagents: { allowed: true, maxDepth: 2, maxActive: 2, maxTotal: 3 } } : {}),
    }),
    verification: verificationPolicy({ reviewerRequired: true, maxRepairRounds: 3 }),
    capabilityFor,
  });
  harness.store.seedRun(RUN);
  seedTaskContractInto(harness.store, { runId: 'run-1', projectId: 'prj-1', taskId: 'build-1', state: input.contracts ?? 'locked' });
  const graph = input.graph ?? 'plan+build';
  if (graph === 'plan+build') {
    harness.store.seedTask('run-1', task({ taskId: 'plan-1', ordinal: 0, role: 'PROMPT_ARCHITECT', taskType: 'plan', requiredEvidenceTypes: ['ARTIFACT'] }));
    harness.store.seedTask('run-1', task({
      taskId: 'build-1', ordinal: 1, role: 'CODING_AGENT', taskType: 'build',
      state: 'BLOCKED', dependencyIds: ['plan-1'], requiredEvidenceTypes: ['TEST'],
    }));
  } else if (graph === 'build-only') {
    harness.store.seedTask('run-1', task({ taskId: 'build-1', ordinal: 0, role: 'CODING_AGENT', taskType: 'build', requiredEvidenceTypes: ['TEST'] }));
  } else {
    harness.store.seedTask('run-1', task({ taskId: 'build-1', ordinal: 0, role: 'CODING_AGENT', taskType: 'build', state: 'SUCCEEDED', requiredEvidenceTypes: ['TEST'] }));
    harness.store.seedTask('run-1', task({
      taskId: 'build-1:review', ordinal: 1, role: 'INDEPENDENT_REVIEWER', taskType: 'review:build',
      parentTaskId: 'build-1', dependencyIds: ['build-1'], requiredEvidenceTypes: ['REVIEW_FINDING'],
    }));
  }
  harness.store.seedCriteria('run-1', [{ criterionId: 'ac-1', description: 'The tests pass.', requiredEvidenceTypes: [] }]);
  return harness;
}

/* ------------------------------------------------------------- drivers */

/** Drive the run as `driveJuliusRunToTerminal` does: tick, and advance when a tick claims nothing. */
async function drain(harness: JuliusHarness, ticks = 20): Promise<void> {
  for (let index = 0; index < ticks; index += 1) {
    const report = await harness.loop.tick(scope);
    if (report.claimed === 0) {
      const advance = await harness.loop.advanceRun('run-1', 'prj-1');
      if (advance === null || (!advance.changed && advance.resumedVerifications === 0)) break;
    }
  }
}

/** Tick until a durable condition holds, checked BEFORE each tick so the loop stops at the boundary rather than past it. */
async function tickUntil(harness: JuliusHarness, holds: () => boolean, ticks = 20): Promise<boolean> {
  for (let index = 0; index < ticks; index += 1) {
    if (holds()) return true;
    const report = await harness.loop.tick(scope);
    if (report.claimed === 0) {
      const advance = await harness.loop.advanceRun('run-1', 'prj-1');
      if (advance === null || (!advance.changed && advance.resumedVerifications === 0)) break;
    }
  }
  return holds();
}

type Eligible = Extract<JuliusTaskPreflight, { kind: 'ELIGIBLE' }>;

/** Claim ONE task exactly as the loop does and build the request the loop would hand the pipeline. */
async function claimDirect(harness: JuliusHarness, taskId: string): Promise<JuliusPipelineRequest> {
  const now = harness.clock.now();
  const claims = await harness.store.claimRunnable({
    owner: harness.deps.owner, now, leaseExpiresAt: new Date(Date.parse(now) + 60_000).toISOString(), limit: 1, projectId: 'prj-1',
  });
  const claim = claims[0];
  if (claim === undefined || claim.taskId !== taskId) {
    throw new Error(`expected to claim ${taskId}, claimed ${claim?.taskId ?? 'nothing'}`);
  }
  const run = await harness.store.loadRun('run-1', 'prj-1');
  if (run === null) throw new Error('run-1 missing');
  const policy = await harness.policies.policyFor(run);
  if (policy === null) throw new Error('no policy for run-1');
  return {
    claim, policy: policy.card, verification: policy.verification,
    capability: harness.policies.capabilityFor(claim),
    capabilityFor: (value) => harness.policies.capabilityFor(value),
  };
}

async function prepare(harness: JuliusHarness, request: JuliusPipelineRequest): Promise<Eligible> {
  const preflight = await prepareClaimedTask(request, harness.deps, scope);
  if (preflight.kind !== 'ELIGIBLE') throw new Error(`refused before any handoff existed: ${preflight.kind}`);
  return preflight;
}

/** The loop's second half: admit the attempt, then run under the handoff given — tampered or not. */
async function execute(harness: JuliusHarness, request: JuliusPipelineRequest, preflight: Eligible) {
  const attempt = await harness.store.admitTask({
    taskId: request.claim.taskId, owner: harness.deps.owner, leaseGeneration: request.claim.leaseGeneration, now: harness.clock.now(),
  });
  if (attempt === null) throw new Error('lease lost');
  return runClaimedTask({ ...request, claim: { ...request.claim, attempt } }, harness.deps, preflight);
}

/** Revise the current contract and LOCK the new revision through the store — the same two writes the runtime performs. */
async function lockNextRevision(
  harness: JuliusHarness, proposal: JuliusTaskContractProposal, evaluatorId = 'evaluator-2',
): Promise<JuliusTaskContract> {
  const current = await harness.store.loadTaskContract({ projectId: 'prj-1', taskId: 'build-1' });
  if (current === null) throw new Error('no contract to revise');
  const revised = reviseJuliusTaskContract({ contract: current, proposal });
  if (revised.outcome !== 'REVISED') throw new Error(revised.reasonCode);
  await harness.store.putTaskContract({ projectId: 'prj-1', contract: revised.contract, occurredAt: harness.clock.now() });
  const locked = await harness.store.lockTaskContract({
    projectId: 'prj-1', contractId: revised.contract.contractId, contractRevision: revised.contract.contractRevision,
    bindingDigest: juliusTaskContractBindingDigest(revised.contract), lockedAt: harness.clock.now(), evaluatorId,
  });
  if (!locked.locked) throw new Error(locked.reasonCode);
  return locked.contract;
}

/** The binding a dispatch was RECORDED under, read off the durable claim event — never off the code path. */
const bindingOf = (harness: JuliusHarness, taskId: string): JuliusTaskContractBinding | null => {
  const claimed = [...harness.store.events()].reverse().find((event) => event.type === 'task.claimed' && event.taskId === taskId);
  const facts = claimed?.facts ?? {};
  return typeof facts.contractId === 'string' && typeof facts.contractTaskId === 'string'
    && typeof facts.contractRevision === 'number' && typeof facts.bindingDigest === 'string'
    ? { contractId: facts.contractId, taskId: facts.contractTaskId, contractRevision: facts.contractRevision, bindingDigest: facts.bindingDigest }
    : null;
};

const refusalsOf = (harness: JuliusHarness, taskId: string) =>
  harness.store.events().filter((event) => event.type === 'contract.refused' && event.taskId === taskId).map((event) => event.facts);

const dispatched = (harness: JuliusHarness, adapterId: string) =>
  harness.adapters.get(adapterId)!.dispatches.map((dispatch) => dispatch.taskId);

/* ================================================================== */
/*  2. A STALE HANDOFF IS REFUSED, AND NOTHING DOWNSTREAM OF IT HAPPENS */
/* ================================================================== */

describe('a stale handoff: the agreement moved after the packet was compiled', () => {
  /**
   * The whole chain the founder's rule names, asserted as one: no worker, no
   * provider, no reservation, no evidence, no success — and a durable reason.
   */
  const expectRefusedWithoutSpending = async (
    harness: JuliusHarness, outcome: Awaited<ReturnType<typeof execute>>, reasonCode: string,
    reservationsBefore: readonly unknown[],
  ) => {
    expect(outcome).toMatchObject({ kind: 'HALTED', taskId: 'build-1', reasonCode: 'TASK_CONTRACT_STALE' });
    expect(dispatched(harness, CODER.adapterId), 'the worker did not run, so the provider did not run').toEqual([]);
    expect(harness.store.events().filter((event) => event.type === 'budget.reserved'), 'no reservation was announced').toEqual([]);
    expect(harness.budget.reservations(), 'no reservation became spend').toEqual(reservationsBefore);
    expect(await harness.store.evidenceForRun('run-1', 'prj-1'), 'no evidence was accepted').toEqual([]);
    expect(harness.store.results(), 'no result was accepted').toEqual([]);
    expect(harness.store.taskRow('build-1')?.state, 'the task is FAILED, not falsely successful').toBe('FAILED');
    expect(refusalsOf(harness, 'build-1').map((facts) => facts.reasonCode), 'the reason is durable').toContain(reasonCode);
    // A REFUSED HANDOFF IS NEVER UPGRADED: the one recorded claim still names
    // the revision the packet was compiled under, and nothing re-claims it.
    const claims = harness.store.events().filter((event) => event.type === 'task.claimed' && event.taskId === 'build-1');
    expect(claims).toHaveLength(1);
    await drain(harness);
    expect(dispatched(harness, CODER.adapterId), 'nothing retried it under the newer terms').toEqual([]);
    expect((await harness.store.loadRun('run-1', 'prj-1'))?.state).not.toBe('COMPLETED');
  };

  it('a handoff for revision 1 after revision 2 is locked — STALE, and the superseded row says why', async () => {
    const harness = build({ graph: 'build-only' });
    const request = await claimDirect(harness, 'build-1');
    const preflight = await prepare(harness, request);
    expect(preflight.contractBinding?.contractRevision).toBe(1);
    const reservations = harness.budget.reservations();

    // Between the read and the run, an acceptance elsewhere locks revision 2.
    const revision2 = await lockNextRevision(harness, { requiredChecks: ['npm test -- src/slug.test.ts'] });
    expect(revision2.contractRevision).toBe(2);

    const outcome = await execute(harness, request, preflight);
    await expectRefusedWithoutSpending(harness, outcome, 'binding_stale', reservations);
    expect(refusalsOf(harness, 'build-1')[0]).toMatchObject({
      reasonCode: 'binding_stale', contractTaskId: 'build-1', role: 'CODING_AGENT',
      recordedRevision: 1, currentRevision: 2, currentState: 'LOCKED',
    });
    const revisions = await harness.store.taskContractRevisions({ projectId: 'prj-1', taskId: 'build-1' });
    expect(revisions.map((row) => [row.contractRevision, row.state])).toEqual([[1, 'SUPERSEDED'], [2, 'LOCKED']]);
  });

  it('the right revision with the wrong digest — FOREIGN, never "close enough"', async () => {
    const harness = build({ graph: 'build-only' });
    const request = await claimDirect(harness, 'build-1');
    const preflight = await prepare(harness, request);
    const reservations = harness.budget.reservations();
    const tampered = { ...preflight, contractBinding: { ...preflight.contractBinding!, bindingDigest: 'sha256:0000' } };
    const outcome = await execute(harness, request, tampered);
    await expectRefusedWithoutSpending(harness, outcome, 'binding_foreign', reservations);
  });

  it('the right digest with the wrong revision — a record newer than the agreement is FOREIGN', async () => {
    const harness = build({ graph: 'build-only' });
    const request = await claimDirect(harness, 'build-1');
    const preflight = await prepare(harness, request);
    const reservations = harness.budget.reservations();
    const tampered = { ...preflight, contractBinding: { ...preflight.contractBinding!, contractRevision: 2 } };
    const outcome = await execute(harness, request, tampered);
    await expectRefusedWithoutSpending(harness, outcome, 'binding_foreign', reservations);
  });

  it('the wrong revision AND the wrong digest — FOREIGN', async () => {
    const harness = build({ graph: 'build-only' });
    const request = await claimDirect(harness, 'build-1');
    const preflight = await prepare(harness, request);
    const reservations = harness.budget.reservations();
    const tampered = { ...preflight, contractBinding: { ...preflight.contractBinding!, contractRevision: 7, bindingDigest: 'sha256:ffff' } };
    const outcome = await execute(harness, request, tampered);
    await expectRefusedWithoutSpending(harness, outcome, 'binding_foreign', reservations);
  });

  it('an UNLOCKED revision — a draft nobody accepted, cited as if it were the agreement', async () => {
    const harness = build({ graph: 'build-only' });
    const request = await claimDirect(harness, 'build-1');
    const preflight = await prepare(harness, request);
    const reservations = harness.budget.reservations();
    // Revision 2 exists as a DRAFT only; revision 1 is what is locked.
    const current = await harness.store.loadTaskContract({ projectId: 'prj-1', taskId: 'build-1' });
    const revised = reviseJuliusTaskContract({ contract: current!, proposal: { permittedPaths: ['src/**'] } });
    if (revised.outcome !== 'REVISED') throw new Error(revised.reasonCode);
    await harness.store.putTaskContract({ projectId: 'prj-1', contract: revised.contract, occurredAt: harness.clock.now() });
    const tampered = {
      ...preflight,
      contractBinding: { ...preflight.contractBinding!, contractRevision: 2, bindingDigest: juliusTaskContractBindingDigest(revised.contract) },
    };
    const outcome = await execute(harness, request, tampered);
    await expectRefusedWithoutSpending(harness, outcome, 'binding_foreign', reservations);
    const revisions = await harness.store.taskContractRevisions({ projectId: 'prj-1', taskId: 'build-1' });
    expect(revisions.map((row) => [row.contractRevision, row.state]), 'the draft stayed a draft').toEqual([[1, 'LOCKED'], [2, 'DRAFT']]);
  });

  it('another contract entirely — FOREIGN, whatever its revision says', async () => {
    const harness = build({ graph: 'build-only' });
    const request = await claimDirect(harness, 'build-1');
    const preflight = await prepare(harness, request);
    const reservations = harness.budget.reservations();
    const tampered = { ...preflight, contractBinding: { ...preflight.contractBinding!, contractId: 'contract:run-9:build-9' } };
    const outcome = await execute(harness, request, tampered);
    await expectRefusedWithoutSpending(harness, outcome, 'binding_foreign', reservations);
  });

  it('a revision that cannot exist — INDETERMINATE refuses too; not knowing is not a licence', async () => {
    const harness = build({ graph: 'build-only' });
    const request = await claimDirect(harness, 'build-1');
    const preflight = await prepare(harness, request);
    const reservations = harness.budget.reservations();
    const tampered = { ...preflight, contractBinding: { ...preflight.contractBinding!, contractRevision: 0 } };
    const outcome = await execute(harness, request, tampered);
    await expectRefusedWithoutSpending(harness, outcome, 'binding_indeterminate', reservations);
  });

  it('the NEWEST digest under the OLD revision number is still stale — the revision is compared first', async () => {
    // The tempting shortcut: "the digest matches what is locked now, so run
    // it". A packet that says revision 1 was compiled from revision 1's terms
    // whatever digest it carries, and the terms have moved.
    const harness = build({ graph: 'build-only' });
    const request = await claimDirect(harness, 'build-1');
    const preflight = await prepare(harness, request);
    const reservations = harness.budget.reservations();
    const revision2 = await lockNextRevision(harness, { outOfScope: ['package.json'] });
    const tampered = { ...preflight, contractBinding: { ...preflight.contractBinding!, bindingDigest: revision2.bindingDigest! } };
    const outcome = await execute(harness, request, tampered);
    await expectRefusedWithoutSpending(harness, outcome, 'binding_stale', reservations);
  });

  it('a handoff whose agreement did NOT move runs, and records the revision it ran under', async () => {
    // The control: the same two halves, nothing moved between them.
    const harness = build({ graph: 'build-only' });
    const request = await claimDirect(harness, 'build-1');
    const preflight = await prepare(harness, request);
    const outcome = await execute(harness, request, preflight);
    expect(outcome.kind).toBe('REVIEW_SCHEDULED');
    expect(dispatched(harness, CODER.adapterId)).toEqual(['build-1']);
    expect(bindingOf(harness, 'build-1')).toEqual(preflight.contractBinding);
    expect(harness.store.taskRow('build-1')?.state).toBe('SUCCEEDED');
  });
});

/* ================================================================== */
/*  3. THE REVIEWER HOLDS THE CODER'S BINDING, OR DOES NOT RUN          */
/* ================================================================== */

describe('the reviewer must hold the binding the coder executed under', () => {
  it('revision N+1 locked between the build and its review — the review is refused, not re-aimed', async () => {
    const harness = build();
    const reached = await tickUntil(harness, () => harness.store.taskRow('build-1')?.state === 'SUCCEEDED');
    expect(reached, 'the build completed under revision 1').toBe(true);
    expect(bindingOf(harness, 'build-1')?.contractRevision).toBe(1);
    expect(harness.store.taskRow('build-1:review')?.state, 'and its review is waiting').toBe('RUNNABLE');

    // An acceptance elsewhere locks revision 2 before the reviewer is claimed.
    await lockNextRevision(harness, { reviewCriteria: ['Does the diff satisfy every criterion, including the new one?'] });

    await drain(harness);
    expect(dispatched(harness, REVIEWER.adapterId), 'no reviewer was paid to grade against terms the coder never held')
      .not.toContain('build-1:review');
    expect(harness.store.taskRow('build-1:review')?.state).toBe('FAILED');
    expect(refusalsOf(harness, 'build-1:review')[0]).toMatchObject({
      reasonCode: 'binding_revision_mismatch', contractTaskId: 'build-1', subjectTaskId: 'build-1',
      role: 'INDEPENDENT_REVIEWER', reviewRevision: 2, implementationRevision: 1,
    });
    // THE CODER'S WORK IS NOT DISCARDED BY THE REFUSAL — it is SUCCEEDED and
    // bound to revision 1; what is refused is grading it against revision 2.
    expect(harness.store.taskRow('build-1')?.state).toBe('SUCCEEDED');
    expect(bindingOf(harness, 'build-1')?.contractRevision).toBe(1);
    expect((await harness.store.loadRun('run-1', 'prj-1'))?.state).not.toBe('COMPLETED');
  });

  it('revision N-1 in the reviewer\'s handoff — refused before the review is even claimed', async () => {
    const harness = build();
    await tickUntil(harness, () => harness.store.taskRow('build-1:review')?.state === 'RUNNABLE');
    const request = await claimDirect(harness, 'build-1:review');
    const preflight = await prepare(harness, request);
    const tampered = { ...preflight, contractBinding: { ...preflight.contractBinding!, contractRevision: preflight.contractBinding!.contractRevision - 1 } };
    const outcome = await execute(harness, request, tampered);
    expect(outcome).toMatchObject({ kind: 'HALTED', reasonCode: 'REVIEW_CONTRACT_MISMATCH' });
    expect(dispatched(harness, REVIEWER.adapterId)).not.toContain('build-1:review');
    expect(refusalsOf(harness, 'build-1:review')[0]).toMatchObject({ reasonCode: 'binding_revision_mismatch', reviewRevision: 0, implementationRevision: 1 });
    // Refused BEFORE the claim was announced, so no reviewer claim exists to cite.
    expect(harness.store.events().filter((event) => event.type === 'task.claimed' && event.taskId === 'build-1:review')).toEqual([]);
  });

  it('the same revision with a different digest — refused; two records agreeing on a number is not agreement', async () => {
    const harness = build();
    await tickUntil(harness, () => harness.store.taskRow('build-1:review')?.state === 'RUNNABLE');
    const request = await claimDirect(harness, 'build-1:review');
    const preflight = await prepare(harness, request);
    const tampered = { ...preflight, contractBinding: { ...preflight.contractBinding!, bindingDigest: 'sha256:1111' } };
    const outcome = await execute(harness, request, tampered);
    expect(outcome).toMatchObject({ kind: 'HALTED', reasonCode: 'REVIEW_CONTRACT_MISMATCH' });
    expect(refusalsOf(harness, 'build-1:review')[0]?.reasonCode).toBe('binding_digest_mismatch');
    expect(dispatched(harness, REVIEWER.adapterId)).not.toContain('build-1:review');
  });

  it('a build with NO recorded binding cannot be reviewed under a contract — absence refuses, it does not default', async () => {
    const harness = build({ graph: 'build-reviewed' });
    await drain(harness);
    expect(dispatched(harness, REVIEWER.adapterId)).toEqual([]);
    expect(harness.store.taskRow('build-1:review')?.state).toBe('FAILED');
    expect(refusalsOf(harness, 'build-1:review')[0]).toMatchObject({ reasonCode: 'implementation_binding_absent', implementationRevision: null });
  });

  it('the control: coder and reviewer under one lock share the binding, and the ledger proves it', async () => {
    const harness = build();
    await drain(harness);
    const implementation = bindingOf(harness, 'build-1');
    const review = bindingOf(harness, 'build-1:review');
    expect(evaluateJuliusSharedBinding({ implementation, review })).toEqual({ shared: true, binding: implementation });
    expect(dispatched(harness, REVIEWER.adapterId)).toContain('build-1:review');
    expect((await harness.store.loadRun('run-1', 'prj-1'))?.state).toBe('COMPLETED');
  });
});

/* ================================================================== */
/*  4. A LOCKED AGREEMENT CANNOT BE EDITED                             */
/* ================================================================== */

describe('mutation after LOCK is refused, and history stays bound to the historical digest', () => {
  const categories: readonly [string, JuliusTaskContractProposal][] = [
    ['objective', { objective: 'Do something else entirely.' }],
    ['scope', { inScope: ['src/**'], outOfScope: [] }],
    ['acceptance criteria', { reviewCriteria: ['Anything at all.'], failureConditions: [] }],
    ['evidence', { requiredChecks: [], expectedOutputs: ['a promise'] }],
    ['tool permission', { permittedPaths: ['**'], prohibitedActions: [] }],
    ['budget / stopping', { stoppingCondition: 'Never.' }],
    ['repair policy', { repairRules: ['Skip the review.'] }],
  ];

  for (const [category, proposal] of categories) {
    it(`a planner proposing a new ${category} after the lock is refused, and the coder runs under the original`, async () => {
      const harness = build({ contracts: 'locked', architect: [{ ...PLAN_OK, contractProposal: proposal }, PLAN_OK] });
      const before = await harness.store.loadTaskContract({ projectId: 'prj-1', taskId: 'build-1' });
      await drain(harness);

      expect(refusalsOf(harness, 'plan-1').map((facts) => facts.reasonCode)).toContain('contract_already_locked');
      const revisions = await harness.store.taskContractRevisions({ projectId: 'prj-1', taskId: 'build-1' });
      expect(revisions.map((row) => [row.contractRevision, row.state]), 'no revision was cut').toEqual([[1, 'LOCKED']]);
      const after = await harness.store.loadTaskContract({ projectId: 'prj-1', taskId: 'build-1' });
      expect(after, 'the locked terms are byte-for-byte what they were').toEqual(before);
      expect(bindingOf(harness, 'build-1')?.bindingDigest).toBe(before?.bindingDigest);
      expect(harness.store.taskRow('build-1')?.state).toBe('SUCCEEDED');
    });
  }

  it('the store refuses to overwrite a locked revision with different terms, budget included', async () => {
    const harness = build({ graph: 'build-only' });
    const locked = (await harness.store.loadTaskContract({ projectId: 'prj-1', taskId: 'build-1' }))!;
    for (const mutation of [
      { objective: 'edited' },
      { budget: { ceilingUsdMicros: 999_000_000, maxRepairRounds: 99 } },
      { blockingAcceptanceCriteria: [] },
      { permittedPaths: ['**'] },
    ] as const) {
      await expect(harness.store.putTaskContract({ projectId: 'prj-1', contract: { ...locked, ...mutation }, occurredAt: harness.clock.now() }))
        .rejects.toThrow('julius_task_contract_revision_conflict');
    }
    const still = await harness.store.loadTaskContract({ projectId: 'prj-1', taskId: 'build-1' });
    expect(still).toEqual(locked);
    expect(juliusTaskContractBindingDigest(still!)).toBe(locked.bindingDigest);
  });

  it('work done under revision 1 stays bound to revision 1 after revision 2 is legitimately locked', async () => {
    const harness = build({ graph: 'build-only' });
    await drain(harness);
    const historical = bindingOf(harness, 'build-1');
    expect(historical?.contractRevision).toBe(1);

    const revision2 = await lockNextRevision(harness, { requiredChecks: ['npm test'] });
    expect((await harness.store.loadTaskContract({ projectId: 'prj-1', taskId: 'build-1' }))?.contractRevision).toBe(2);
    // The durable record of what the coder executed under has not moved.
    expect(await harness.store.executedBindingFor('build-1', 'prj-1')).toEqual(historical);
    expect(bindingOf(harness, 'build-1')).toEqual(historical);
    expect(historical?.bindingDigest).not.toBe(revision2.bindingDigest);
  });
});

/* ================================================================== */
/*  5 + 6. REPAIRS AND SUB-AGENTS INHERIT THE AGREEMENT                */
/* ================================================================== */

describe('a repair round and its re-review reference the build\'s locked contract', () => {
  it('build → finding → repair → re-review all carry ONE binding, and the run completes under it', async () => {
    const harness = build({ reviewer: [REVIEW_ACCEPT, REVIEW_REJECT, REVIEW_ACCEPT, REVIEW_ACCEPT] });
    await drain(harness);
    expect((await harness.store.loadRun('run-1', 'prj-1'))?.state).toBe('COMPLETED');

    const lineage = ['build-1', 'build-1:review', 'repair:build-1:1:task', 'repair:build-1:1:task:review'];
    const bindings = lineage.map((taskId) => bindingOf(harness, taskId));
    for (const [index, binding] of bindings.entries()) {
      expect(binding, `${lineage[index]} was dispatched under a binding`).not.toBeNull();
      expect(binding, `${lineage[index]} holds the build's binding`).toEqual(bindings[0]);
      expect(binding?.taskId, 'the subject is the build, not the repair').toBe('build-1');
    }
    // The context each was compiled from names the same digest, so the packet
    // and the ledger agree about which terms every worker saw.
    for (const taskId of lineage) {
      const context = harness.store.contexts().find((snapshot) => snapshot.taskId === taskId);
      expect(context?.taskContractDigest, taskId).toBe(bindings[0]?.bindingDigest);
      expect(context?.taskContractRevision, taskId).toBe(bindings[0]?.contractRevision);
    }
  });

  it('a repair that tries to widen its own permissions is refused — the lock is the coder\'s too', async () => {
    const harness = build({
      reviewer: [REVIEW_ACCEPT, REVIEW_REJECT, REVIEW_ACCEPT, REVIEW_ACCEPT],
      coder: [BUILD_OK, { ...BUILD_OK, contractProposal: { permittedPaths: ['**'], prohibitedActions: [], reviewCriteria: ['Pass.'] } }],
    });
    const before = await harness.store.loadTaskContract({ projectId: 'prj-1', taskId: 'build-1' });
    await drain(harness);
    expect(refusalsOf(harness, 'repair:build-1:1:task')[0]).toMatchObject({ reasonCode: 'contract_already_locked', contractTaskId: 'build-1', proposedBy: 'CODING_AGENT' });
    expect(await harness.store.loadTaskContract({ projectId: 'prj-1', taskId: 'build-1' })).toEqual(before);
    expect(bindingOf(harness, 'repair:build-1:1:task:review')).toEqual(bindingOf(harness, 'build-1'));
    expect((await harness.store.loadRun('run-1', 'prj-1'))?.state).toBe('COMPLETED');
  });
});

describe('a bounded sub-agent inherits its parent\'s envelope', () => {
  const spawn = (harness: JuliusHarness, requestId: string, over: Partial<Parameters<typeof spawnJuliusSubagent>[0]> = {}) =>
    spawnJuliusSubagent({
      run: RUN, policy: cardPolicy({
        allowedProviders: ['openai', 'anthropic', 'hermes'], capabilities: ['plan', 'implement', 'review'], concurrency: 1,
        autonomy: 'AUTONOMOUS', subagents: { allowed: true, maxDepth: 2, maxActive: 2, maxTotal: 3 },
      }),
      requestId, parentTaskId: 'build-1', role: 'CODING_AGENT', taskType: 'audit', capability: 'implement',
      requestedPermissions: ['read'], runPermissions: ['read', 'write_worktree'], usdMicros: 500, ...over,
    }, { store: harness.store, budget: harness.budget, clock: harness.clock, ids: harness.ids });

  it('the child is dispatched under the parent\'s contract binding, with the parent named as the subject', async () => {
    const harness = build({ graph: 'build-only', subagents: true });
    const spawned = await spawn(harness, 'sub-1');
    expect(spawned.authorized).toBe(true);
    if (!spawned.authorized) return;
    await drain(harness);

    const parent = bindingOf(harness, 'build-1');
    const child = bindingOf(harness, spawned.childTask.taskId);
    expect(dispatched(harness, CODER.adapterId)).toEqual(expect.arrayContaining(['build-1', spawned.childTask.taskId]));
    expect(child, 'the child ran under a binding').not.toBeNull();
    expect(child).toEqual(parent);
    expect(child?.taskId, 'a child cannot claim a contract of its own').toBe('build-1');
    const context = harness.store.contexts().find((snapshot) => snapshot.taskId === spawned.childTask.taskId);
    expect(context?.taskContractDigest).toBe(parent?.bindingDigest);
  });

  it('a child proposing looser terms is refused against the parent\'s lock', async () => {
    const harness = build({
      graph: 'build-only', subagents: true,
      coder: [BUILD_OK, { ...BUILD_OK, contractProposal: { permittedPaths: ['**'], stoppingCondition: 'Whenever.' } }],
    });
    const spawned = await spawn(harness, 'sub-1');
    if (!spawned.authorized) throw new Error(spawned.reasonCode);
    await drain(harness);
    expect(refusalsOf(harness, spawned.childTask.taskId)[0]).toMatchObject({ reasonCode: 'contract_already_locked', contractTaskId: 'build-1' });
    const revisions = await harness.store.taskContractRevisions({ projectId: 'prj-1', taskId: 'build-1' });
    expect(revisions.map((row) => [row.contractRevision, row.state])).toEqual([[1, 'LOCKED']]);
  });

  it('a child may not carry permissions its parent does not hold', async () => {
    const harness = build({ graph: 'build-only', subagents: true });
    const escalated = await spawn(harness, 'sub-escalate', { requestedPermissions: ['read', 'network'], runPermissions: ['read'] });
    expect(escalated.authorized).toBe(false);
    expect(harness.store.taskRow('subagent:sub-escalate'), 'no task entered the graph').toBeNull();
  });
});

/* ================================================================== */
/*  7. RESTART: THE SAME AGREEMENT STANDS                              */
/* ================================================================== */

describe('a crash at the lock boundary and after the coder\'s result', () => {
  const crashAt = async (harness: JuliusHarness, method: string, onCall: number) => {
    const faulted = injectJuliusFault(harness.store, { method, onCall });
    const loop = new JuliusRunLoop({ ...harness.deps, store: faulted.store }, harness.policies, { claimLimit: 5, leaseMs: 60_000 });
    for (let index = 0; index < 8 && !faulted.report.fired; index += 1) {
      try { await loop.tick(scope); } catch { break; }
    }
    return faulted.report;
  };
  const contractState = async (harness: JuliusHarness) => {
    const revisions = await harness.store.taskContractRevisions({ projectId: 'prj-1', taskId: 'build-1' });
    return revisions.map((row) => ({ revision: row.contractRevision, state: row.state, digest: row.bindingDigest, lockedBy: row.lockedByEvaluatorId, lockedAt: row.lockedAt }));
  };

  it('after LOCK, before the decision: the restart neither re-accepts, re-locks nor rewinds', async () => {
    const harness = build({ contracts: 'draft' });
    const report = await crashAt(harness, 'appendDecision', 1);
    expect(report.fired).toBe(true);
    const locked = await contractState(harness);
    expect(locked).toEqual([expect.objectContaining({ revision: 1, state: 'LOCKED' })]);
    expect(await harness.store.decisionsForRun('run-1', 'prj-1'), 'no decision was written').toEqual([]);

    harness.store.restart();
    await drain(harness);

    expect(await contractState(harness), 'the same revision, digest, lock state and evaluator').toEqual(locked);
    expect(harness.store.events().filter((event) => event.type === 'contract.locked'), 'no duplicate lock').toHaveLength(1);
    expect((await harness.store.decisionsForRun('run-1', 'prj-1')).filter((decision) => decision.taskId === 'plan-1'), 'exactly one acceptance').toHaveLength(1);
    expect(bindingOf(harness, 'build-1')?.bindingDigest).toBe(locked[0]?.digest);
    expect(bindingOf(harness, 'build-1:review')).toEqual(bindingOf(harness, 'build-1'));
    expect((await harness.store.loadRun('run-1', 'prj-1'))?.state).toBe('COMPLETED');
  });

  it('after the coder\'s result, before its review exists: the reviewer still receives the exact locked contract', async () => {
    const harness = build();
    // `addTask` #1 creates the plan's review; #2 creates the build's. Failing
    // the second lands after the result was accepted and before any review.
    const report = await crashAt(harness, 'addTask', 2);
    expect(report.fired).toBe(true);
    expect(harness.store.taskRow('build-1')?.state).toBe('SUCCEEDED');
    expect(harness.store.taskRow('build-1:review'), 'no review was created').toBeNull();
    const coder = bindingOf(harness, 'build-1');
    const locked = await contractState(harness);

    harness.store.restart();
    await drain(harness);

    expect(dispatched(harness, CODER.adapterId), 'the coder was not paid twice').toEqual(['build-1']);
    expect(dispatched(harness, REVIEWER.adapterId).filter((taskId) => taskId === 'build-1:review')).toHaveLength(1);
    expect(bindingOf(harness, 'build-1:review')).toEqual(coder);
    expect(await contractState(harness)).toEqual(locked);
    expect((await harness.store.loadRun('run-1', 'prj-1'))?.state).toBe('COMPLETED');
  });

  it('after the reviewer is claimed, before it is admitted: the re-claim recomputes the same binding', async () => {
    const harness = build();
    // Admissions: plan, plan review, build, build review.
    const report = await crashAt(harness, 'admitTask', 4);
    expect(report.fired).toBe(true);
    expect(dispatched(harness, REVIEWER.adapterId)).not.toContain('build-1:review');
    const coder = bindingOf(harness, 'build-1');

    harness.store.restart();
    await drain(harness);

    expect(dispatched(harness, REVIEWER.adapterId).filter((taskId) => taskId === 'build-1:review')).toHaveLength(1);
    expect(bindingOf(harness, 'build-1:review')).toEqual(coder);
    expect((await harness.store.loadRun('run-1', 'prj-1'))?.state).toBe('COMPLETED');
  });
});

/* ================================================================== */
/*  1. THE WHOLE LIFECYCLE, THROUGH THE REAL LOOP                      */
/* ================================================================== */

describe('R1 seeded → R2 proposed → challenged → R3 proposed → accepted → LOCKED', () => {
  it('records every step durably, and the coder and reviewer run under the revision that was locked', async () => {
    const harness = build({
      contracts: 'draft',
      architect: [
        { ...PLAN_OK, contractProposal: { requiredChecks: ['npm test -- src/slug.test.ts'] } },
        { ...PLAN_OK, contractProposal: { permittedPaths: ['src/slug.ts', 'src/slug.test.ts'], responsibilityBoundary: 'The slug helper and its test; nothing else.' } },
      ],
      // Plan review: CHALLENGE. Re-review of the revised plan: ACCEPT. Build review: ACCEPT.
      reviewer: [REVIEW_REJECT, REVIEW_ACCEPT, REVIEW_ACCEPT],
    });
    await drain(harness, 24);

    const revisions = await harness.store.taskContractRevisions({ projectId: 'prj-1', taskId: 'build-1' });
    expect(revisions.map((row) => [row.contractRevision, row.state])).toEqual([[1, 'DRAFT'], [2, 'CHALLENGED'], [3, 'LOCKED']]);
    expect(new Set(revisions.map((row) => row.contractId)).size, 'one contract throughout').toBe(1);

    const locked = await harness.store.loadTaskContract({ projectId: 'prj-1', taskId: 'build-1' });
    expect(locked).toMatchObject({
      contractRevision: 3, state: 'LOCKED', lockedByEvaluatorId: REVIEWER.workerId,
      objective: 'The seeded mission objective.',
      responsibilityBoundary: 'The slug helper and its test; nothing else.',
      requiredChecks: ['npm test -- src/slug.test.ts'],
      permittedPaths: ['src/slug.ts', 'src/slug.test.ts'],
      requiredEvidence: ['TEST'],
      budget: { ceilingUsdMicros: 20_000_000, maxRepairRounds: 3 },
    });
    expect(locked?.blockingAcceptanceCriteria.map((criterion) => criterion.criterionId)).toEqual(['criterion-1']);
    expect(locked?.failureConditions.length).toBeGreaterThan(0);
    expect(locked?.repairRules).toBeDefined();
    expect(locked?.bindingDigest).toBe(juliusTaskContractBindingDigest(locked!));
    expect(locked?.lockedAt).not.toBeNull();

    // THE ORDER OF THE RECORD is the order of the agreement.
    const trail = harness.store.events()
      .filter((event) => ['contract.proposed', 'contract.challenged', 'contract.locked', 'task.runnable', 'task.claimed'].includes(event.type))
      .map((event) => (event.type.startsWith('contract.') ? `${event.type}:${event.facts.contractRevision}` : `${event.type}:${event.taskId}`));
    const at = (name: string) => { const index = trail.indexOf(name); expect(index, name).toBeGreaterThanOrEqual(0); return index; };
    expect(at('contract.proposed:2')).toBeLessThan(at('contract.challenged:2'));
    expect(at('contract.challenged:2')).toBeLessThan(at('contract.proposed:3'));
    expect(at('contract.proposed:3')).toBeLessThan(at('contract.locked:3'));
    expect(at('contract.locked:3')).toBeLessThan(at('task.runnable:build-1'));
    expect(at('task.runnable:build-1')).toBeLessThan(at('task.claimed:build-1'));

    const challenged = harness.store.events().find((event) => event.type === 'contract.challenged');
    expect(challenged?.facts).toMatchObject({ contractTaskId: 'build-1', contractRevision: 2 });
    expect(challenged?.facts.objectionCount).toBeGreaterThanOrEqual(2);
    expect(challenged?.workerId).toBe(REVIEWER.workerId);

    // The coder and its reviewer ran under revision 3 and nothing else.
    const implementation = bindingOf(harness, 'build-1');
    expect(implementation).toMatchObject({ contractRevision: 3, bindingDigest: locked?.bindingDigest, taskId: 'build-1' });
    expect(evaluateJuliusSharedBinding({ implementation, review: bindingOf(harness, 'build-1:review') })).toMatchObject({ shared: true });
    expect(harness.store.events().filter((event) => event.type === 'contract.refused'), 'nothing was refused along the way').toEqual([]);
    expect((await harness.store.loadRun('run-1', 'prj-1'))?.state).toBe('COMPLETED');
  });

  it('a challenge with no revision offered: the accepted repair locks the challenged revision, and says so', async () => {
    const harness = build({ contracts: 'draft', reviewer: [REVIEW_REJECT, REVIEW_ACCEPT, REVIEW_ACCEPT] });
    await drain(harness, 24);
    const revisions = await harness.store.taskContractRevisions({ projectId: 'prj-1', taskId: 'build-1' });
    expect(revisions.map((row) => [row.contractRevision, row.state])).toEqual([[1, 'LOCKED']]);
    const types = harness.store.events().map((event) => `${event.type}:${event.facts.contractRevision ?? ''}`);
    expect(types.indexOf('contract.challenged:1')).toBeGreaterThanOrEqual(0);
    expect(types.indexOf('contract.challenged:1')).toBeLessThan(types.indexOf('contract.locked:1'));
    expect((await harness.store.loadRun('run-1', 'prj-1'))?.state).toBe('COMPLETED');
  });

  it('a build released while its terms are CHALLENGED is refused with that reason, not "not locked"', async () => {
    const harness = build({ graph: 'build-only', contracts: 'draft' });
    const draft = (await harness.store.loadTaskContract({ projectId: 'prj-1', taskId: 'build-1' }))!;
    expect(await harness.store.challengeTaskContract({ projectId: 'prj-1', contractId: draft.contractId, contractRevision: 1 })).toBe(true);
    await drain(harness);
    expect(dispatched(harness, CODER.adapterId)).toEqual([]);
    expect(refusalsOf(harness, 'build-1').map((facts) => facts.reasonCode)).toContain('contract_challenged');
    expect(harness.store.taskRow('build-1')?.state).toBe('FAILED');
  });

  it('a locked contract is never challenged by a later rejection — LOCKED terms are not arguable', async () => {
    // The plan review rejects a plan whose build terms are ALREADY locked.
    const harness = build({ contracts: 'locked', reviewer: [REVIEW_REJECT, REVIEW_ACCEPT, REVIEW_ACCEPT] });
    await drain(harness, 24);
    expect(harness.store.events().filter((event) => event.type === 'contract.challenged')).toEqual([]);
    const revisions = await harness.store.taskContractRevisions({ projectId: 'prj-1', taskId: 'build-1' });
    expect(revisions.map((row) => [row.contractRevision, row.state])).toEqual([[1, 'LOCKED']]);
    expect((await harness.store.loadRun('run-1', 'prj-1'))?.state).toBe('COMPLETED');
  });
});

/* ================================================================== */
/*  9. EVERY EXECUTABLE KIND OF TASK BINDS, OR IS PROVABLY NOT RUN      */
/* ================================================================== */

describe('the binding audit — every task kind either binds explicitly or cannot execute', () => {
  /**
   * The roles Julius can resolve are the three slots and `SPECIALIST:*`. For
   * every placement of every one of them the resolver must answer, and the
   * only permitted null is the Prompt Architect and its review — the pair that
   * PRODUCES the terms. A specialist used to be a fourth null, silently.
   */
  const graph = [
    task({ taskId: 'plan-1', role: 'PROMPT_ARCHITECT', taskType: 'plan' }),
    task({ taskId: 'plan-1:review', role: 'INDEPENDENT_REVIEWER', taskType: 'review:plan', parentTaskId: 'plan-1' }),
    task({ taskId: 'build-1', role: 'CODING_AGENT', taskType: 'build', dependencyIds: ['plan-1'] }),
    task({ taskId: 'build-1:review', role: 'INDEPENDENT_REVIEWER', taskType: 'review:build', parentTaskId: 'build-1' }),
    task({ taskId: 'repair:build-1:1:task', role: 'CODING_AGENT', taskType: 'repair:build', parentTaskId: 'build-1' }),
    task({ taskId: 'repair:build-1:1:task:review', role: 'INDEPENDENT_REVIEWER', taskType: 'review:repair:build', parentTaskId: 'repair:build-1:1:task' }),
    task({ taskId: 'subagent:audit', role: 'CODING_AGENT', taskType: 'audit', parentTaskId: 'build-1' }),
    task({ taskId: 'subagent:research', role: 'SPECIALIST:research', taskType: 'research', parentTaskId: 'build-1' }),
    task({ taskId: 'subagent:research:deeper', role: 'SPECIALIST:research', taskType: 'research', parentTaskId: 'subagent:research' }),
    task({ taskId: 'subagent:research:review', role: 'INDEPENDENT_REVIEWER', taskType: 'review:build', parentTaskId: 'subagent:research' }),
    task({ taskId: 'specialist-under-plan', role: 'SPECIALIST:research', taskType: 'research', parentTaskId: 'plan-1' }),
    task({ taskId: 'specialist-root', role: 'SPECIALIST:research', taskType: 'research' }),
  ].map((value) => ({ ...value, missionId: 'msn-1' })) as readonly JuliusTask[];
  const subject = (taskId: string) => juliusContractSubjectTaskId(graph.find((value) => value.taskId === taskId)!, graph);

  const cases: readonly [string, string | null, string][] = [
    ['plan-1', null, 'the architect produces the terms'],
    ['plan-1:review', null, 'the plan review judges the terms'],
    ['build-1', 'build-1', 'the build is its own subject'],
    ['build-1:review', 'build-1', 'the build review holds the build\'s agreement'],
    ['repair:build-1:1:task', 'build-1', 'a repair inherits'],
    ['repair:build-1:1:task:review', 'build-1', 'a re-review inherits'],
    ['subagent:audit', 'build-1', 'a coding sub-agent inherits'],
    ['subagent:research', 'build-1', 'a specialist under a build inherits the build\'s agreement'],
    ['subagent:research:deeper', 'build-1', 'a specialist under a specialist climbs to the coding work'],
    ['subagent:research:review', 'build-1', 'a review of a specialist holds what the specialist held'],
    ['specialist-under-plan', 'specialist-under-plan', 'a specialist with no coding ancestor is bound to itself'],
    ['specialist-root', 'specialist-root', 'a root specialist is bound to itself'],
  ];
  it.each(cases)('%s → %s (%s)', (taskId, expected) => {
    expect(subject(taskId)).toBe(expected);
  });

  it('the only unbound kinds are the architect and its review — by enumeration, not by omission', () => {
    const unbound = graph.filter((value) => juliusContractSubjectTaskId(value, graph) === null).map((value) => value.taskId).sort();
    expect(unbound).toEqual(['plan-1', 'plan-1:review']);
  });

  it('a specialist child of the build is dispatched under the build\'s binding', async () => {
    const harness = build({ graph: 'build-only', subagents: true });
    const spawned = await spawnJuliusSubagent({
      run: RUN, policy: cardPolicy({
        allowedProviders: ['openai', 'anthropic', 'hermes'], capabilities: ['plan', 'implement', 'review'], concurrency: 1,
        autonomy: 'AUTONOMOUS', subagents: { allowed: true, maxDepth: 2, maxActive: 2, maxTotal: 3 },
      }),
      requestId: 'research-1', parentTaskId: 'build-1', role: 'SPECIALIST:research', taskType: 'research', capability: 'implement',
      requestedPermissions: ['read'], runPermissions: ['read', 'write_worktree'], usdMicros: 500,
    }, { store: harness.store, budget: harness.budget, clock: harness.clock, ids: harness.ids });
    if (!spawned.authorized) throw new Error(spawned.reasonCode);
    await drain(harness);

    expect(dispatched(harness, SPECIALIST.adapterId)).toEqual([spawned.childTask.taskId]);
    const child = bindingOf(harness, spawned.childTask.taskId);
    expect(child).not.toBeNull();
    expect(child).toEqual(bindingOf(harness, 'build-1'));
    expect(child?.taskId).toBe('build-1');
    expect(harness.store.contexts().find((snapshot) => snapshot.taskId === spawned.childTask.taskId)?.taskContractDigest)
      .toBe(child?.bindingDigest);
  });

  it('a specialist with no coding ancestor and no contract of its own is refused before any reservation', async () => {
    const harness = build({ graph: 'build-only' });
    harness.store.seedTask('run-1', task({ taskId: 'specialist-root', ordinal: 5, role: 'SPECIALIST:research', taskType: 'research' }));
    const reservations = harness.budget.reservations();
    await drain(harness);

    expect(dispatched(harness, SPECIALIST.adapterId), 'no provider ran for ungoverned work').toEqual([]);
    expect(harness.store.taskRow('specialist-root')?.state).toBe('FAILED');
    expect(harness.store.taskRow('specialist-root')?.attempt, 'refused before admission, so no attempt was spent').toBe(0);
    expect(refusalsOf(harness, 'specialist-root')[0]).toMatchObject({ reasonCode: 'contract_absent', contractTaskId: 'specialist-root' });
    expect(harness.store.events().filter((event) => event.type === 'budget.reserved' && event.taskId === 'specialist-root')).toEqual([]);
    // The build beside it, which IS governed, still ran.
    expect(dispatched(harness, CODER.adapterId)).toEqual(['build-1']);
    expect(harness.budget.reservations().length).toBeGreaterThan(reservations.length);
  });
});

/* ================================================================== */
/*  10. THE EVIDENCE IS MACHINE-READABLE AND CARRIES NO PROSE           */
/* ================================================================== */

describe('the refusal is legible from the ledger alone', () => {
  it('names contract, revision, digest state, binding and reason as facts, with no free text', async () => {
    const harness = build({ graph: 'build-only' });
    const request = await claimDirect(harness, 'build-1');
    const preflight = await prepare(harness, request);
    await lockNextRevision(harness, { requiredChecks: ['npm test'] });
    await execute(harness, request, preflight);

    const claim = harness.store.events().find((event) => event.type === 'task.claimed' && event.taskId === 'build-1');
    expect(claim?.facts).toMatchObject({ contractTaskId: 'build-1', contractRevision: 1 });
    expect(typeof claim?.facts.contractId).toBe('string');
    expect(String(claim?.facts.bindingDigest)).toMatch(/^sha256:[0-9a-f]{64}$/u);

    const refusal = refusalsOf(harness, 'build-1')[0]!;
    // `owner` is the ledger's own stamp on every event it writes.
    expect(Object.keys(refusal).sort()).toEqual(['contractId', 'contractTaskId', 'currentRevision', 'currentState', 'owner', 'reasonCode', 'recordedRevision', 'role']);
    for (const value of Object.values(refusal)) {
      expect(['string', 'number'].includes(typeof value) || value === null).toBe(true);
      if (typeof value === 'string') expect(value, 'no sentence reaches the facts').not.toMatch(/\s/u);
    }
    expect(refusal.reasonCode).toMatch(/^[a-z_]+$/u);
    const trajectory = harness.store.trajectory().find((event) => event.kind === 'DISPATCH' && event.taskId === 'build-1');
    expect(trajectory?.outcome).toBe('CONTRACT_STALE');
    expect(trajectory?.safeFacts).toMatchObject({ reasonCode: 'binding_stale', recordedRevision: 1, currentRevision: 2 });
  });
});
