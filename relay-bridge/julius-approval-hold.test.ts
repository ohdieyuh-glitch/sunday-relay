/**
 * A PENDING APPROVAL HOLDS THE RUN — THROUGH THE LOOP, NOT ONLY IN THE ROW.
 *
 * The sibling of the PAUSED defect (b61c9789). `requestJuliusApproval` records
 * a PENDING approval and moves the run to BLOCKED (`APPROVAL_REQUIRED`). The
 * claim query refuses a BLOCKED run, so the gate looks honoured. The question
 * this file asks is whether it IS: the live driver calls `advanceRun` whenever
 * a tick claims nothing, `advanceRun` computes a target from the TASKS, and
 * `BLOCKED -> READY` is a legal transition. If nothing stops it, an idle tick
 * walks the run out of BLOCKED while nobody has answered the approval, and the
 * tick after it dispatches — the approval gate bypassed.
 *
 * Driven the way the mission job drives a run: `assembleLiveJuliusRuntime`
 * with the production registrations and `driveJuliusRunToTerminal`, counting
 * what the provider adapters were actually handed. Only the adapters are
 * scripted; the store is the in-memory twin.
 */

import { describe, expect, it } from 'vitest';

import {
  createJuliusMemoryStore,
  decideJuliusApproval,
  juliusPacketTextIn,
  requestJuliusApproval,
  scriptedAdapter,
  seedJuliusTaskContract,
  type JuliusApproverAuthority,
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

const RUN = 'run:approval-1';
const PROJECT = 'prj-approval';
const MISSION = 'mission-approval';
const REVIEWER_WORKER = reviewerWorker('hermes');

const PLAN_EVIDENCE = [{ type: 'ARTIFACT', status: 'PASSED', safeSummary: 'Plan written.' }];
const BUILD_EVIDENCE = [{ type: 'TEST', status: 'PASSED', safeSummary: 'Suite green.' }];
const PASSED_REVIEW = [{ type: 'REVIEW_FINDING', status: 'PASSED', safeSummary: 'No blocking findings.' }];

type Memory = ReturnType<typeof createJuliusMemoryStore>;

function seed(store: Memory): void {
  store.seedRun({
    runId: RUN, missionId: MISSION, projectId: PROJECT, state: 'READY',
    cardRevision: 'card-approval', missionContractRevision: 1, projectBrainRevision: 0, version: 1,
  });
  store.seedTask(RUN, {
    taskId: 'plan-1', missionId: MISSION, parentTaskId: null, dependencyIds: [],
    requiredEvidenceTypes: ['ARTIFACT'], taskType: 'plan', role: 'PROMPT_ARCHITECT', ordinal: 0, state: 'RUNNABLE',
  });
  store.seedTask(RUN, {
    taskId: 'build-1', missionId: MISSION, parentTaskId: null, dependencyIds: ['plan-1'],
    requiredEvidenceTypes: ['TEST'], taskType: 'build', role: 'CODING_AGENT', ordinal: 1, state: 'BLOCKED',
  });
  const seeded = seedJuliusTaskContract({
    runId: RUN, taskId: 'build-1', missionContractRevision: 1,
    objective: 'Finish a small mission whose C.A.R.D. gates an operation behind an approval.',
    requirements: ['Do the work.'], constraints: ['Touch only the module.'],
    acceptanceCriteria: [{ id: 'AC-1', text: 'The suite passes.', blocking: true }],
    filesInScope: [], filesOutOfScope: [], spendUsd: 10, repairCycles: 1, requiredEvidence: ['TEST'],
  });
  if (!seeded.seeded) throw new Error(`fixture contract not derivable: ${seeded.reasonCode}`);
  void store.putTaskContract({ projectId: PROJECT, contract: seeded.contract, occurredAt: '2026-09-29T00:00:00.000Z' });
  store.seedCriteria(RUN, [{ criterionId: 'AC-1', description: 'The suite passes.', requiredEvidenceTypes: [] }]);
  store.seedBrain(RUN, [{
    entryId: 'brain-objective', kind: 'OBJECTIVE', text: 'OBJECTIVE: finish a small mission.',
    taskIds: [], allowedRoles: ['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER'], sensitivity: 'INTERNAL',
  }]);
}

const anyone: JuliusApproverAuthority = { async mayApprove() { return true; } };
const clock = { now: () => new Date().toISOString() };

interface Stage {
  readonly memory: Memory;
  drive(maxTicks?: number): ReturnType<typeof driveJuliusRunToTerminal>;
  dispatches(): number;
  /** The C.A.R.D. gate, recorded the way the lifecycle runtime records it. */
  gate(taskId: string, approvalId?: string): Promise<void>;
  decide(decision: 'APPROVED' | 'DENIED', approvalId?: string): ReturnType<typeof decideJuliusApproval>;
}

/** A fresh runtime over a store — a new job process, as a re-run of the mission job is. */
function stage(existing?: Memory): Stage {
  const memory = existing ?? createJuliusMemoryStore();
  if (existing === undefined) seed(memory);
  const handoffs = createContextAndClaimHandoffs(memory as unknown as JuliusRuntimeStore & JuliusRecoveryDriver);
  const architect = scriptedAdapter(architectWorker({}), [{ kind: 'succeed', evidence: PLAN_EVIDENCE, usdMicros: null }]);
  const coder = scriptedAdapter(CODER_WORKER, [{ kind: 'succeed', evidence: BUILD_EVIDENCE, usdMicros: 1_000_000 }]);
  const reviewer = scriptedAdapter(REVIEWER_WORKER,
    [{ kind: 'succeed', evidence: PASSED_REVIEW, usdMicros: null, answerFindings: 'RESOLVED' }],
    { packetFor: juliusPacketTextIn(memory) });
  const runtime = assembleLiveJuliusRuntime({
    store: handoffs.store,
    entries: [
      { worker: architectWorker({}), adapter: architect },
      { worker: CODER_WORKER, adapter: coder },
      { worker: REVIEWER_WORKER, adapter: reviewer },
    ],
    cardRevision: 'card-approval', spendCeilingUsdMicros: 20_000_000, maxRepairRounds: 1,
  });
  const deps = { store: memory as never, clock };
  return {
    memory,
    drive: (maxTicks) => driveJuliusRunToTerminal({
      loop: runtime.loop, store: handoffs.store, runId: RUN, projectId: PROJECT,
      ...(maxTicks === undefined ? { verification: runtime.verification } : { maxTicks }),
    }),
    dispatches: () => architect.dispatches.length + coder.dispatches.length + reviewer.dispatches.length,
    async gate(taskId, approvalId = 'apr-1') {
      const run = (await memory.loadRun(RUN, PROJECT))!;
      const requested = await requestJuliusApproval({
        run, approvalId, taskId, operation: 'DISPATCH_WORKER', policyRevision: 'card-approval',
        reasonCode: 'CARD_APPROVAL_REQUIRED', safeRationale: 'C.A.R.D. requires an authorized approval.',
        idempotencyKey: `gate:${approvalId}`,
      }, deps);
      if (!requested.requested || requested.runState !== 'BLOCKED') throw new Error('fixture: the gate did not block the run');
    },
    decide: (decision, approvalId = 'apr-1') => decideJuliusApproval({
      runId: RUN, projectId: PROJECT, approvalId, decision, approverId: 'ghu-founder', reason: 'Reviewed.',
    }, { ...deps, approvers: anyone }),
  };
}

async function stateOf(memory: Memory): Promise<string | undefined> {
  return (await memory.loadRun(RUN, PROJECT))?.state;
}

describe('a pending approval holds the run through the live driver', () => {
  it('CONTROL: an ungated twin is driven to COMPLETED and dispatches', async () => {
    const twin = stage();
    const outcome = await twin.drive();
    expect(outcome.state).toBe('COMPLETED');
    expect(twin.dispatches()).toBeGreaterThanOrEqual(3);
  });

  it('a run gated before its first dispatch is driven and dispatches NOTHING, and stays BLOCKED', async () => {
    const s = stage();
    await s.gate('plan-1');
    expect(await stateOf(s.memory)).toBe('BLOCKED');

    const outcome = await s.drive();
    expect(s.dispatches(), 'not one provider was asked while the approval is pending').toBe(0);
    expect(outcome.state, 'the loop did not walk around the approval').toBe('BLOCKED');
    expect(outcome.stalled).toBe(true);
    expect(outcome.haltCause).toMatch(/^run_awaiting_approval: /u);
    expect(await stateOf(s.memory)).toBe('BLOCKED');
    expect(await s.memory.pendingApprovals(RUN, PROJECT)).toHaveLength(1);

    // A second job run over the same rows is no different — idle ticks do not wear the gate down.
    const again = await stage(s.memory).drive(12);
    expect(again.state).toBe('BLOCKED');
    expect(s.dispatches()).toBe(0);
  });

  it('a gate landing mid-run stops new work: the plan ran, the build does not', async () => {
    const s = stage();
    await s.drive(1);
    const before = s.dispatches();
    expect(before, 'the plan was dispatched before the gate').toBe(1);
    await s.gate('build-1');

    const outcome = await s.drive();
    expect(outcome.state).toBe('BLOCKED');
    expect(s.dispatches(), 'no review, no build — nothing past the pending approval').toBe(before);
    const events = s.memory.events().map((event) => event.type);
    expect(events.filter((type) => type === 'run.resumed'), 'nothing announced a resume nobody granted').toHaveLength(0);
  });

  it('GRANTED: the approval releases the run and the next drive completes it, dispatching what its twin did', async () => {
    const twin = stage();
    await twin.drive();

    const s = stage();
    await s.gate('plan-1');
    await s.drive();
    expect(s.dispatches()).toBe(0);

    const decided = await s.decide('APPROVED');
    expect(decided).toMatchObject({ decided: true, state: 'APPROVED', runState: 'READY' });
    expect(s.dispatches(), 'the decision itself dispatches nothing').toBe(0);

    const outcome = await s.drive();
    expect(outcome.state).toBe('COMPLETED');
    expect(s.dispatches()).toBe(twin.dispatches());
  });

  it('TWO GATES: answering one does not release the run while the other is pending', async () => {
    const s = stage();
    await s.gate('plan-1', 'apr-1');
    // A second gate on a different operation is a second record (one PENDING per gated operation).
    const run = (await s.memory.loadRun(RUN, PROJECT))!;
    await requestJuliusApproval({
      run, approvalId: 'apr-2', taskId: 'build-1', operation: 'MUTATE_FILESYSTEM', policyRevision: 'card-approval',
      reasonCode: 'CARD_APPROVAL_REQUIRED', safeRationale: 'C.A.R.D. requires an authorized approval.',
      idempotencyKey: 'gate:apr-2',
    }, { store: s.memory as never, clock });
    expect(await s.memory.pendingApprovals(RUN, PROJECT)).toHaveLength(2);

    expect(await s.decide('APPROVED', 'apr-1')).toMatchObject({ decided: true, state: 'APPROVED', runState: 'BLOCKED' });
    const outcome = await s.drive();
    expect(outcome.state).toBe('BLOCKED');
    expect(s.dispatches(), 'one open gate still holds the run').toBe(0);

    expect(await s.decide('APPROVED', 'apr-2')).toMatchObject({ decided: true, state: 'APPROVED', runState: 'READY' });
    expect((await s.drive()).state).toBe('COMPLETED');
  });

  it('REJECTED: a denied approval fails the run, and nothing is ever dispatched', async () => {
    const s = stage();
    await s.gate('plan-1');
    await s.drive();
    expect(s.dispatches()).toBe(0);

    const decided = await s.decide('DENIED');
    expect(decided).toMatchObject({ decided: true, state: 'DENIED', runState: 'FAILED' });

    const outcome = await s.drive();
    expect(outcome.state).toBe('FAILED');
    expect(s.dispatches(), 'a rejected gate is never walked around').toBe(0);
    expect(await s.memory.pendingApprovals(RUN, PROJECT)).toHaveLength(0);
  });
});
