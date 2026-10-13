/**
 * V6 G-2 THROUGH THE LIVE DRIVER: A SCOPED GATE ASKS A PERSON ONCE, FOR THE BUILD.
 *
 * `julius-approval-at-dispatch.test.ts` proves the unscoped gate: a C.A.R.D.
 * listing `DISPATCH_WORKER` in `approvals` holds every dispatch, so a mission is
 * granted one dispatch at a time (its case "GRANT: each gate is answered in
 * turn"). That is the RED control here. A mission that wants its governance
 * owner to sign off ONE step (the Coding Agent's build, after the plan was
 * reviewed) declares an `approvalScopes` entry instead, and then:
 *
 *  - the plan and its review dispatch ungated;
 *  - the build is held: ONE PENDING approval, on the build, with the scoped
 *    reason code, and nothing of the build dispatched;
 *  - a grant releases it, and the mission completes with exactly the work its
 *    ungated twin did, one question asked in all.
 *
 * Driven the way the mission job drives a run (`assembleLiveJuliusRuntime`,
 * `driveJuliusRunToTerminal`), over the in-memory store. The PostgreSQL half is
 * `julius-approval-scoped.real-postgres.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import {
  createJuliusMemoryStore,
  decideJuliusApproval,
  juliusPacketTextIn,
  scriptedAdapter,
  seedJuliusTaskContract,
  type JuliusApprovalScope,
  type JuliusApproverAuthority,
  type JuliusPolicyOperation,
  type JuliusRecoveryDriver,
  type JuliusRuntimeStore,
} from '../src/relay/mission/julius';
import {
  architectWorker,
  CODER_WORKER,
  assembleLiveJuliusRuntime,
  createContextAndClaimHandoffs,
  driveJuliusRunToTerminal,
  reviewerWorker,
} from './julius/live-composition';

const RUN = 'run:scoped-gate-1';
const PROJECT = 'prj-scoped-gate';
const MISSION = 'mission-scoped-gate';
const CARD = 'card-scoped-gate';
const REVIEWER_WORKER = reviewerWorker('hermes');
const BUILD_GATE: JuliusApprovalScope = { operation: 'DISPATCH_WORKER', roles: ['CODING_AGENT'], taskTypes: ['build'] };

const PLAN_EVIDENCE = [{ type: 'ARTIFACT', status: 'PASSED', safeSummary: 'Plan written.' }];
const BUILD_EVIDENCE = [{ type: 'TEST', status: 'PASSED', safeSummary: 'Suite green.' }];
const PASSED_REVIEW = [{ type: 'REVIEW_FINDING', status: 'PASSED', safeSummary: 'No blocking findings.' }];

type Memory = ReturnType<typeof createJuliusMemoryStore>;
type Store = JuliusRuntimeStore & JuliusRecoveryDriver;

function seed(store: Memory): void {
  store.seedRun({
    runId: RUN, missionId: MISSION, projectId: PROJECT, state: 'READY',
    cardRevision: CARD, missionContractRevision: 1, projectBrainRevision: 0, version: 1,
  });
  store.seedTask(RUN, {
    taskId: `${RUN}:plan-1`, missionId: MISSION, parentTaskId: null, dependencyIds: [],
    requiredEvidenceTypes: ['ARTIFACT'], taskType: 'plan', role: 'PROMPT_ARCHITECT', ordinal: 0, state: 'RUNNABLE',
  });
  store.seedTask(RUN, {
    taskId: `${RUN}:build-1`, missionId: MISSION, parentTaskId: null, dependencyIds: [`${RUN}:plan-1`],
    requiredEvidenceTypes: ['TEST'], taskType: 'build', role: 'CODING_AGENT', ordinal: 1, state: 'BLOCKED',
  });
  const seeded = seedJuliusTaskContract({
    runId: RUN, taskId: `${RUN}:build-1`, missionContractRevision: 1,
    objective: 'Finish a small mission whose C.A.R.D. holds its build for a person.',
    requirements: ['Do the work.'], constraints: ['Touch only the module.'],
    acceptanceCriteria: [{ id: 'AC-1', text: 'The suite passes.', blocking: true }],
    filesInScope: [], filesOutOfScope: [], spendUsd: 10, repairCycles: 1, requiredEvidence: ['TEST'],
  });
  if (!seeded.seeded) throw new Error(`fixture contract not derivable: ${seeded.reasonCode}`);
  void store.putTaskContract({ projectId: PROJECT, contract: seeded.contract, occurredAt: '2026-10-13T00:00:00.000Z' });
  store.seedCriteria(RUN, [{ criterionId: 'AC-1', description: 'The suite passes.', requiredEvidenceTypes: [] }]);
  store.seedBrain(RUN, [{
    entryId: `${RUN}:brain-objective`, kind: 'OBJECTIVE', text: 'OBJECTIVE: finish a small mission.',
    taskIds: [], allowedRoles: ['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER'], sensitivity: 'INTERNAL',
  }]);
}

const anyone: JuliusApproverAuthority = { async mayApprove() { return true; } };
const clock = { now: () => new Date().toISOString() };

function stage(gates: { readonly approvals?: readonly JuliusPolicyOperation[]; readonly approvalScopes?: readonly JuliusApprovalScope[] } = {}) {
  const memory = createJuliusMemoryStore();
  seed(memory);
  const handoffs = createContextAndClaimHandoffs(memory as unknown as Store);
  const store = handoffs.store;
  const architect = scriptedAdapter(architectWorker({}), [{ kind: 'succeed', evidence: PLAN_EVIDENCE, usdMicros: null }]);
  const coder = scriptedAdapter(CODER_WORKER, [{ kind: 'succeed', evidence: BUILD_EVIDENCE, usdMicros: 1_000_000 }]);
  const reviewer = scriptedAdapter(REVIEWER_WORKER,
    [{ kind: 'succeed', evidence: PASSED_REVIEW, usdMicros: null, answerFindings: 'RESOLVED' }],
    { packetFor: juliusPacketTextIn(memory) });
  const runtime = assembleLiveJuliusRuntime({
    store,
    entries: [
      { worker: architectWorker({}), adapter: architect },
      { worker: CODER_WORKER, adapter: coder },
      { worker: REVIEWER_WORKER, adapter: reviewer },
    ],
    cardRevision: CARD, spendCeilingUsdMicros: 20_000_000, maxRepairRounds: 1,
    ...(gates.approvals === undefined ? {} : { approvals: gates.approvals }),
    ...(gates.approvalScopes === undefined ? {} : { approvalScopes: gates.approvalScopes }),
  });
  return {
    memory, runtime,
    drive: () => driveJuliusRunToTerminal({ loop: runtime.loop, store, runId: RUN, projectId: PROJECT, verification: runtime.verification }),
    counts: () => ({ architect: architect.dispatches.length, coder: coder.dispatches.length, reviewer: reviewer.dispatches.length }),
    decide: (approvalId: string, decision: 'APPROVED' | 'DENIED') => decideJuliusApproval({
      runId: RUN, projectId: PROJECT, approvalId, decision, approverId: 'github:founder#1', reason: `Reviewed the plan: ${decision}.`,
    }, { store: memory as never, clock, approvers: anyone }),
  };
}

const requested = (memory: Memory) => memory.events().filter((event) => event.type === 'approval.requested');

describe('V6 G-2: a scoped C.A.R.D. gate holds the build, and only the build', () => {
  it('the card carries the scopes only when given: absent, the card is byte-for-byte the ungated one', () => {
    const plain = stage();
    expect('approvalScopes' in plain.runtime.card, 'an ungated mission composes no scopes key at all').toBe(false);
    const gated = stage({ approvalScopes: [BUILD_GATE] });
    expect(gated.runtime.card.approvalScopes).toEqual([BUILD_GATE]);
    expect(gated.runtime.card.approvals, 'the unscoped list keeps its own meaning, empty here').toEqual([]);
  });

  it('RED before G-2: the plan and its review dispatch, the build is held with ONE PENDING approval, and nothing of the build ran', async () => {
    const s = stage({ approvalScopes: [BUILD_GATE] });
    const outcome = await s.drive();
    expect(outcome.state).toBe('BLOCKED');
    expect(outcome.haltCause).toMatch(/^run_awaiting_approval: /u);
    expect(s.counts(), 'the plan was written and reviewed; the build was not started').toEqual({ architect: 1, coder: 0, reviewer: 1 });

    const pending = await s.memory.pendingApprovals(RUN, PROJECT);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      taskId: `${RUN}:build-1`, operation: 'DISPATCH_WORKER', policyRevision: CARD,
      reasonCode: 'CARD_SCOPED_APPROVAL_REQUIRED', state: 'PENDING', decidedBy: null,
    });
    expect(pending[0]!.approvalId).toBe(`approval:dispatch:${RUN}:${RUN}:build-1:DISPATCH_WORKER:${CARD}`);
    expect(requested(s.memory), 'one question for a person').toHaveLength(1);
    const build = s.memory.taskRow(`${RUN}:build-1`)!;
    expect(build.state, 'the build waits, handed back').toBe('RUNNABLE');
    expect(build.attempt, 'the gate cost the build no execution attempt').toBe(0);
  });

  it('GRANT: one decision releases the build, the mission completes, and it did exactly its ungated twin\'s work', async () => {
    const twin = stage();
    expect((await twin.drive()).state).toBe('COMPLETED');

    const s = stage({ approvalScopes: [BUILD_GATE] });
    expect((await s.drive()).state).toBe('BLOCKED');
    const [gate] = await s.memory.pendingApprovals(RUN, PROJECT);
    expect(await s.decide(gate!.approvalId, 'APPROVED')).toMatchObject({ decided: true, state: 'APPROVED', runState: 'READY', duplicate: false });
    const outcome = await s.drive();
    expect(outcome.state).toBe('COMPLETED');
    expect(s.counts(), 'exactly the work the ungated twin did').toEqual(twin.counts());
    expect(s.counts().coder, 'the build dispatched exactly once, after the grant').toBe(1);
    expect(requested(s.memory), 'one question asked in the whole mission').toHaveLength(1);
    expect(await s.memory.pendingApprovals(RUN, PROJECT)).toHaveLength(0);
    expect(await s.memory.loadApproval(RUN, gate!.approvalId, PROJECT)).toMatchObject({
      state: 'APPROVED', decidedBy: 'github:founder#1', decisionReason: 'Reviewed the plan: APPROVED.',
    });
  });

  it('DENY: the build never runs and the run fails; the plan work already done stays done', async () => {
    const s = stage({ approvalScopes: [BUILD_GATE] });
    await s.drive();
    const [gate] = await s.memory.pendingApprovals(RUN, PROJECT);
    expect(await s.decide(gate!.approvalId, 'DENIED')).toMatchObject({ decided: true, state: 'DENIED', runState: 'FAILED' });
    expect((await s.drive()).state).toBe('FAILED');
    expect(s.counts()).toEqual({ architect: 1, coder: 0, reviewer: 1 });
  });

  it('RED CONTROL: the same intent written as the unscoped list asks before EVERY dispatch, the plan first', async () => {
    const s = stage({ approvals: ['DISPATCH_WORKER'] });
    expect((await s.drive()).state).toBe('BLOCKED');
    const pending = await s.memory.pendingApprovals(RUN, PROJECT);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ taskId: `${RUN}:plan-1`, reasonCode: 'CARD_APPROVAL_REQUIRED' });
    expect(s.counts()).toEqual({ architect: 0, coder: 0, reviewer: 0 });
  });
});
