/**
 * C.A.R.D. REQUIRE-APPROVAL AT DISPATCH, AND THE HOLD AT THE CLAIM/DISPATCH
 * BOUNDARY — the two gaps #291 left open, proven through the live driver.
 *
 * A. A C.A.R.D. that lists an operation in `approvals` makes its dispatch a
 *    question for a person: the RUNTIME (not a fixture) writes a PENDING
 *    approval, the run holds BLOCKED, nothing is dispatched while it is
 *    pending, a GRANT lets exactly the intended work go on, a DENY stops it,
 *    and the record says who decided and why. Before, the gate ended the task
 *    FAILED, announced a pause nobody made, and wrote no approval at all:
 *    `requestJuliusApproval` had no production caller.
 *
 * B. The hold is enforced where work STARTS, not only in the run loop: the
 *    claim refuses a run holding a PENDING or DENIED approval whatever its state
 *    says, and the dispatch boundary re-reads the run after the claim, so a
 *    pause, a gate or a cancellation landing between the two starts nothing.
 *
 * Driven the way the mission job drives a run: `assembleLiveJuliusRuntime` with
 * the production registrations and `driveJuliusRunToTerminal`, counting what
 * the provider adapters were actually handed. Only the adapters are scripted;
 * the store is the in-memory twin (the PostgreSQL half is
 * `julius-approval-at-dispatch.real-postgres.test.ts`).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

import { createJuliusPostgresRuntimeStore } from './julius/postgres-store';
import {
  JULIUS_CLAIMABLE_RUN_STATES,
  cancelJuliusRun,
  createJuliusMemoryStore,
  decideJuliusApproval,
  juliusDispatchApprovalId,
  juliusPacketTextIn,
  pauseJuliusRun,
  requestJuliusApproval,
  resumeJuliusRun,
  scriptedAdapter,
  seedJuliusTaskContract,
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

const RUN = 'run:dispatch-gate-1';
const PROJECT = 'prj-dispatch-gate';
const MISSION = 'mission-dispatch-gate';
const CARD = 'card-dispatch-gate';
const REVIEWER_WORKER = reviewerWorker('hermes');

const PLAN_EVIDENCE = [{ type: 'ARTIFACT', status: 'PASSED', safeSummary: 'Plan written.' }];
const BUILD_EVIDENCE = [{ type: 'TEST', status: 'PASSED', safeSummary: 'Suite green.' }];
const PASSED_REVIEW = [{ type: 'REVIEW_FINDING', status: 'PASSED', safeSummary: 'No blocking findings.' }];

type Memory = ReturnType<typeof createJuliusMemoryStore>;

function seed(store: Memory, runId = RUN): void {
  store.seedRun({
    runId, missionId: MISSION, projectId: PROJECT, state: 'READY',
    cardRevision: CARD, missionContractRevision: 1, projectBrainRevision: 0, version: 1,
  });
  store.seedTask(runId, {
    taskId: `${runId}:plan-1`, missionId: MISSION, parentTaskId: null, dependencyIds: [],
    requiredEvidenceTypes: ['ARTIFACT'], taskType: 'plan', role: 'PROMPT_ARCHITECT', ordinal: 0, state: 'RUNNABLE',
  });
  store.seedTask(runId, {
    taskId: `${runId}:build-1`, missionId: MISSION, parentTaskId: null, dependencyIds: [`${runId}:plan-1`],
    requiredEvidenceTypes: ['TEST'], taskType: 'build', role: 'CODING_AGENT', ordinal: 1, state: 'BLOCKED',
  });
  const seeded = seedJuliusTaskContract({
    runId, taskId: `${runId}:build-1`, missionContractRevision: 1,
    objective: 'Finish a small mission whose C.A.R.D. holds its dispatches for a person.',
    requirements: ['Do the work.'], constraints: ['Touch only the module.'],
    acceptanceCriteria: [{ id: 'AC-1', text: 'The suite passes.', blocking: true }],
    filesInScope: [], filesOutOfScope: [], spendUsd: 10, repairCycles: 1, requiredEvidence: ['TEST'],
  });
  if (!seeded.seeded) throw new Error(`fixture contract not derivable: ${seeded.reasonCode}`);
  void store.putTaskContract({ projectId: PROJECT, contract: seeded.contract, occurredAt: '2026-09-29T00:00:00.000Z' });
  store.seedCriteria(runId, [{ criterionId: 'AC-1', description: 'The suite passes.', requiredEvidenceTypes: [] }]);
  store.seedBrain(runId, [{
    entryId: `${runId}:brain-objective`, kind: 'OBJECTIVE', text: 'OBJECTIVE: finish a small mission.',
    taskIds: [], allowedRoles: ['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER'], sensitivity: 'INTERNAL',
  }]);
}

const anyone: JuliusApproverAuthority = { async mayApprove() { return true; } };
const clock = { now: () => new Date().toISOString() };

type Store = JuliusRuntimeStore & JuliusRecoveryDriver;

interface Stage {
  readonly memory: Memory;
  readonly store: Store;
  drive(maxTicks?: number, runId?: string): ReturnType<typeof driveJuliusRunToTerminal>;
  dispatches(): number;
  decide(approvalId: string, decision: 'APPROVED' | 'DENIED'): ReturnType<typeof decideJuliusApproval>;
  tick(): Promise<Awaited<ReturnType<ReturnType<typeof assembleLiveJuliusRuntime>['loop']['tick']>>>;
}

/**
 * A fresh runtime over a store. `approvals` is the C.A.R.D.'s gate list;
 * `wrap` lets a test stand between the run loop and the store (the claim).
 */
function stage(options: {
  readonly approvals?: readonly JuliusPolicyOperation[];
  readonly memory?: Memory;
  readonly wrap?: (store: Store, memory: Memory) => Store;
} = {}): Stage {
  const memory = options.memory ?? createJuliusMemoryStore();
  if (options.memory === undefined) seed(memory);
  const handoffs = createContextAndClaimHandoffs(memory as unknown as Store);
  const store = options.wrap === undefined ? handoffs.store : options.wrap(handoffs.store, memory);
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
    ...(options.approvals === undefined ? {} : { approvals: options.approvals }),
  });
  return {
    memory, store,
    drive: (maxTicks, runId = RUN) => driveJuliusRunToTerminal({
      loop: runtime.loop, store, runId, projectId: PROJECT,
      ...(maxTicks === undefined ? { verification: runtime.verification } : { maxTicks }),
    }),
    dispatches: () => architect.dispatches.length + coder.dispatches.length + reviewer.dispatches.length,
    decide: (approvalId, decision) => decideJuliusApproval({
      runId: RUN, projectId: PROJECT, approvalId, decision, approverId: 'ghu-founder', reason: `Reviewed: ${decision}.`,
    }, { store: memory as never, clock, approvers: anyone }),
    tick: () => runtime.loop.tick({ projectId: PROJECT }),
  };
}

async function stateOf(memory: Memory, runId = RUN): Promise<string | undefined> {
  return (await memory.loadRun(runId, PROJECT))?.state;
}

/* ============================================================== A. the gate */

describe('A. a C.A.R.D. REQUIRE_APPROVAL at dispatch is a grantable approval, not a refusal', () => {
  it('CONTROL: the same mission with an empty approvals list completes and dispatches', async () => {
    const twin = stage();
    const outcome = await twin.drive();
    expect(outcome.state).toBe('COMPLETED');
    expect(twin.dispatches()).toBeGreaterThanOrEqual(3);
  });

  it('the RUNTIME writes the PENDING approval, holds the run BLOCKED and dispatches nothing', async () => {
    const s = stage({ approvals: ['DISPATCH_WORKER'] });
    const outcome = await s.drive();

    expect(s.dispatches(), 'not one provider was asked while the approval is pending').toBe(0);
    expect(outcome.state).toBe('BLOCKED');
    expect(outcome.haltCause).toMatch(/^run_awaiting_approval: /u);

    const pending = await s.memory.pendingApprovals(RUN, PROJECT);
    expect(pending, 'exactly one question for a person').toHaveLength(1);
    const [gate] = pending;
    expect(gate).toMatchObject({
      taskId: `${RUN}:plan-1`, operation: 'DISPATCH_WORKER', policyRevision: CARD,
      reasonCode: 'CARD_APPROVAL_REQUIRED', state: 'PENDING', decidedBy: null,
    });
    expect(gate!.approvalId).toMatch(new RegExp(`^approval:dispatch:${RUN}:${RUN}:plan-1:DISPATCH_WORKER:${CARD}$`, 'u'));

    // The gated task is WAITING, not dead: handed back RUNNABLE, no attempt spent.
    const task = s.memory.taskRow(`${RUN}:plan-1`)!;
    expect(task.state, 'handed back, never FAILED').toBe('RUNNABLE');
    expect(task.attempt, 'the gate cost no execution attempt').toBe(0);

    const types = s.memory.events().map((event) => event.type);
    expect(types).toContain('approval.requested');
    expect(types, 'nobody paused this run, and nothing says so any more').not.toContain('run.paused');
    expect(types, 'and it did not fail').not.toContain('run.failed');

    // Idle ticks and a second job over the same rows neither dispatch nor ask twice.
    // The second job has adapters of its OWN; counting only the first job's could not fail.
    const second = stage({ approvals: ['DISPATCH_WORKER'], memory: s.memory });
    const again = await second.drive(12);
    expect(again.state).toBe('BLOCKED');
    expect(s.dispatches() + second.dispatches(), 'neither job asked a provider anything').toBe(0);
    expect(await s.memory.pendingApprovals(RUN, PROJECT)).toHaveLength(1);
  });

  it('GRANT: each gate is answered in turn, the mission completes, and every dispatch was granted first', async () => {
    const twin = stage();
    await twin.drive();

    const s = stage({ approvals: ['DISPATCH_WORKER'] });
    const granted: string[] = [];
    for (let round = 0; round < 12; round += 1) {
      const before = s.dispatches();
      const outcome = await s.drive();
      if (outcome.state === 'COMPLETED') break;
      const pending = await s.memory.pendingApprovals(RUN, PROJECT);
      expect(outcome.state, `round ${round}: held, not stuck`).toBe('BLOCKED');
      expect(pending, `round ${round}: one open gate`).toHaveLength(1);
      // While that gate was pending, nothing was dispatched past the last grant.
      expect(s.dispatches(), `round ${round}: nothing ran on an unanswered gate`).toBeLessThanOrEqual(before + 1);
      const decided = await s.decide(pending[0]!.approvalId, 'APPROVED');
      expect(decided).toMatchObject({ decided: true, state: 'APPROVED', runState: 'READY' });
      granted.push(pending[0]!.taskId!);
    }

    expect(await stateOf(s.memory)).toBe('COMPLETED');
    expect(s.dispatches(), 'exactly the work its ungated twin did').toBe(twin.dispatches());
    expect(new Set(granted).size, 'one grant per gated task, never the same question twice').toBe(granted.length);
    expect(granted.length, 'every dispatch was behind a grant').toBe(s.dispatches());
    for (const taskId of granted) {
      const id = juliusDispatchApprovalId({ runId: RUN, taskId, operation: 'DISPATCH_WORKER', capability: '', policyRevision: CARD });
      const record = await s.memory.loadApproval(RUN, id, PROJECT);
      expect(record, `the evidence records ${taskId}'s decision`).toMatchObject({
        state: 'APPROVED', decidedBy: 'ghu-founder', decisionReason: 'Reviewed: APPROVED.',
      });
    }
  });

  it('DENY: a denied gate fails the run, nothing is ever dispatched, and the record says who denied it', async () => {
    const s = stage({ approvals: ['DISPATCH_WORKER'] });
    await s.drive();
    const [gate] = await s.memory.pendingApprovals(RUN, PROJECT);
    expect(gate).toBeDefined();

    expect(await s.decide(gate!.approvalId, 'DENIED')).toMatchObject({ decided: true, state: 'DENIED', runState: 'FAILED' });
    const outcome = await s.drive();
    expect(outcome.state).toBe('FAILED');
    expect(s.dispatches(), 'a denied gate is never walked around').toBe(0);
    expect(await s.memory.loadApproval(RUN, gate!.approvalId, PROJECT)).toMatchObject({
      state: 'DENIED', decidedBy: 'ghu-founder', decisionReason: 'Reviewed: DENIED.',
    });
    expect(s.memory.taskRow(`${RUN}:plan-1`)!.state, 'the gated work never ran').not.toBe('SUCCEEDED');
  });

  it('a USE_CAPABILITY gate carries the capability in its key', async () => {
    const s = stage({ approvals: ['USE_CAPABILITY'] });
    await s.drive();
    const [gate] = await s.memory.pendingApprovals(RUN, PROJECT);
    expect(gate).toMatchObject({ operation: 'USE_CAPABILITY', taskId: `${RUN}:plan-1`, state: 'PENDING' });
    expect(gate!.approvalId).toMatch(new RegExp(`^approval:dispatch:${RUN}:${RUN}:plan-1:USE_CAPABILITY:[a-z]+:${CARD}$`, 'u'));
    expect(s.dispatches()).toBe(0);
  });

  it('a store that cannot hold an approval refuses the gated work (APPROVAL_UNSERVED) and never walks through it', async () => {
    const s = stage({
      approvals: ['DISPATCH_WORKER'],
      wrap: (store) => {
        const bare: Record<string, unknown> = { ...store };
        delete bare.requestApproval;
        delete bare.requestApprovalAndBlock;
        delete bare.loadApproval;
        return bare as unknown as Store;
      },
    });
    await s.drive(6);
    expect(s.dispatches()).toBe(0);
    const failed = s.memory.events().filter((event) => event.type === 'run.failed');
    expect(failed.map((event) => event.facts.reasonCode)).toContain('APPROVAL_UNSERVED');
    expect(await s.memory.pendingApprovals(RUN, PROJECT)).toHaveLength(0);
  });

  it('the gate key binds the run, task, operation, capability and C.A.R.D. revision', () => {
    const base = { runId: 'r', taskId: 't', operation: 'DISPATCH_WORKER' as const, capability: 'implement', policyRevision: 'c1' };
    const id = juliusDispatchApprovalId(base);
    expect(juliusDispatchApprovalId(base), 'deterministic').toBe(id);
    expect(juliusDispatchApprovalId({ ...base, policyRevision: 'c2' }), 'an answer under one C.A.R.D. is not one under another').not.toBe(id);
    expect(juliusDispatchApprovalId({ ...base, taskId: 't2' })).not.toBe(id);
    expect(juliusDispatchApprovalId({ ...base, runId: 'r2' })).not.toBe(id);
    const cap = { ...base, operation: 'USE_CAPABILITY' as const };
    expect(juliusDispatchApprovalId(cap)).not.toBe(juliusDispatchApprovalId({ ...cap, capability: 'review' }));
  });
});

/* =================================================== B. the claim/dispatch hold */

describe('B. the hold is enforced where work starts: the claim and the dispatch boundary', () => {
  it('CLAIM: a PENDING approval holds the run even when its state says READY', async () => {
    const s = stage();
    // The race the atomic request exists to prevent, forced: the record lands, the run never moves.
    await s.memory.requestApproval({
      approvalId: 'apr-raced', runId: RUN, projectId: PROJECT, taskId: `${RUN}:plan-1`, operation: 'DISPATCH_WORKER',
      policyRevision: CARD, reasonCode: 'CARD_APPROVAL_REQUIRED', safeRationale: 'Gate.', state: 'PENDING',
      requestedAt: clock.now(), decidedAt: null, decidedBy: null, decisionReason: null, idempotencyKey: 'raced',
    });
    expect(await stateOf(s.memory)).toBe('READY');

    const claimed = await s.memory.claimRunnable({ owner: 'probe', now: clock.now(), leaseExpiresAt: clock.now(), limit: 10 });
    expect(claimed, 'the claim offered nothing from a run holding a pending approval').toHaveLength(0);

    await s.drive(6);
    expect(s.dispatches(), 'and the live driver dispatched nothing').toBe(0);
  });

  it('CLAIM: a DENIED approval holds the run even when its FAILED move was lost', async () => {
    const s = stage();
    await s.memory.requestApproval({
      approvalId: 'apr-denied', runId: RUN, projectId: PROJECT, taskId: `${RUN}:plan-1`, operation: 'DISPATCH_WORKER',
      policyRevision: CARD, reasonCode: 'CARD_APPROVAL_REQUIRED', safeRationale: 'Gate.', state: 'PENDING',
      requestedAt: clock.now(), decidedAt: null, decidedBy: null, decisionReason: null, idempotencyKey: 'denied',
    });
    // Decided at the store only: the run's move to FAILED never happened.
    await s.memory.decideApproval({
      runId: RUN, approvalId: 'apr-denied', projectId: PROJECT, state: 'DENIED',
      decidedBy: 'ghu-founder', decisionReason: 'No.', decidedAt: clock.now(),
    });
    expect(await stateOf(s.memory)).toBe('READY');
    expect(await s.memory.claimRunnable({ owner: 'probe', now: clock.now(), leaseExpiresAt: clock.now(), limit: 10 })).toHaveLength(0);
    await s.drive(6);
    expect(s.dispatches(), 'a denial stops the work whatever the run row says').toBe(0);
  });

  it('CLAIM: the hold is per run — an ungated run in the same store is still offered', async () => {
    const s = stage();
    seed(s.memory, 'run:dispatch-gate-2');
    await s.memory.requestApproval({
      approvalId: 'apr-one', runId: RUN, projectId: PROJECT, taskId: `${RUN}:plan-1`, operation: 'DISPATCH_WORKER',
      policyRevision: CARD, reasonCode: 'CARD_APPROVAL_REQUIRED', safeRationale: 'Gate.', state: 'PENDING',
      requestedAt: clock.now(), decidedAt: null, decidedBy: null, decisionReason: null, idempotencyKey: 'one',
    });
    const claimed = await s.memory.claimRunnable({ owner: 'probe', now: clock.now(), leaseExpiresAt: clock.now(), limit: 10 });
    expect(claimed.map((claim) => claim.runId)).toEqual(['run:dispatch-gate-2']);
  });

  /** Stand between the loop and the store: after the claim, something else happens to the run. */
  const afterClaim = (then: (memory: Memory) => Promise<unknown>) => (store: Store, memory: Memory): Store => {
    let fired = false;
    return {
      ...store,
      async claimRunnable(input) {
        const claimed = await store.claimRunnable(input);
        if (!fired && claimed.length > 0) {
          fired = true;
          await then(memory);
        }
        return claimed;
      },
    } as Store;
  };
  const lifecycleDeps = (memory: Memory) => ({ store: memory as never, clock });

  it('DISPATCH BOUNDARY: a pause landing between the claim and the preflight starts nothing, and resume goes on', async () => {
    const s = stage({ wrap: afterClaim((memory) => pauseJuliusRun(
      { runId: RUN, projectId: PROJECT, actor: 'ghu-founder', reason: 'Hold.' }, lifecycleDeps(memory))) });
    const report = await s.tick();
    expect(report.outcomes[0]).toMatchObject({ kind: 'HELD', reasonCode: 'RUN_PAUSED', runState: 'PAUSED' });
    expect(s.dispatches(), 'claimed, but never dispatched').toBe(0);
    const task = s.memory.taskRow(`${RUN}:plan-1`)!;
    expect(task.state, 'handed back for after the pause').toBe('RUNNABLE');
    expect(task.attempt, 'no attempt spent on a held run').toBe(0);

    expect(await resumeJuliusRun({ runId: RUN, projectId: PROJECT, actor: 'ghu-founder', reason: 'Go.' }, lifecycleDeps(s.memory)))
      .toMatchObject({ applied: true, to: 'READY' });
    expect((await s.drive()).state).toBe('COMPLETED');
  });

  it('DISPATCH BOUNDARY: a gate landing between the claim and the preflight holds the claimed task', async () => {
    const s = stage({ wrap: afterClaim(async (memory) => {
      const run = (await memory.loadRun(RUN, PROJECT))!;
      await requestJuliusApproval({
        run, approvalId: 'apr-late', taskId: `${RUN}:build-1`, operation: 'MUTATE_FILESYSTEM', policyRevision: CARD,
        reasonCode: 'CARD_APPROVAL_REQUIRED', safeRationale: 'Gate.', idempotencyKey: 'late',
      }, lifecycleDeps(memory));
    }) });
    const report = await s.tick();
    expect(report.outcomes[0]).toMatchObject({ kind: 'HELD', reasonCode: 'RUN_AWAITING_APPROVAL' });
    expect(s.dispatches()).toBe(0);
    expect(s.memory.taskRow(`${RUN}:plan-1`)!.state).toBe('RUNNABLE');
  });

  it('DISPATCH BOUNDARY: a cancellation landing between the claim and the preflight ends the task CANCELLED', async () => {
    const s = stage({ wrap: afterClaim((memory) => cancelJuliusRun(
      { runId: RUN, projectId: PROJECT, actor: 'ghu-founder', reason: 'Stop.' }, lifecycleDeps(memory))) });
    const report = await s.tick();
    expect(report.outcomes[0]).toMatchObject({ kind: 'HELD', reasonCode: 'RUN_CANCELLED' });
    expect(s.dispatches()).toBe(0);
    expect(s.memory.taskRow(`${RUN}:plan-1`)!.state).toBe('CANCELLED');
  });

  it('PRODUCTION COMPOSITION: the PostgreSQL runtime store serves the gate its questions', () => {
    // Before, `createJuliusPostgresRuntimeStore` bound only `pendingApprovals`: the live job's gate would have
    // found nowhere to ask and failed closed as APPROVAL_UNSERVED. No connection is made to construct it.
    const store = createJuliusPostgresRuntimeStore(new Pool({ connectionString: 'postgres://nobody@127.0.0.1:1/none' }));
    for (const method of ['requestApproval', 'requestApprovalAndBlock', 'loadApproval', 'pendingApprovals', 'deniedApprovals'] as const) {
      expect(typeof store[method], method).toBe('function');
    }
    // BOUND TO THE RIGHT READ, not merely present. `deniedApprovals` bound to the PENDING read would end
    // every run holding a pending approval as APPROVAL_DENIED; only the real-PostgreSQL ENACTMENT case
    // could see that, and nothing runs it before the founder's catch-all. The bound name says it offline.
    expect(store.pendingApprovals.name).toBe('bound pendingApprovals');
    expect(store.deniedApprovals.name).toBe('bound deniedApprovals');
  });

  it('PARITY: the PostgreSQL approval reads select the state their names promise', () => {
    // The offline half of the real-PostgreSQL ENACTMENT case: a `deniedApprovals` whose SQL read PENDING
    // would pass every in-memory test and fail every run with a pending approval.
    const source = readFileSync(join(__dirname, '..', 'src', 'relay', 'persistence', 'julius-lifecycle-postgres.ts'), 'utf8');
    const read = (name: string) => {
      const start = source.indexOf(`async ${name}(`);
      return source.slice(start, source.indexOf('\n  }\n', start));
    };
    expect(read('pendingApprovals')).toContain("state='PENDING'");
    expect(read('pendingApprovals')).not.toContain("state='DENIED'");
    expect(read('deniedApprovals')).toContain("state='DENIED'");
    expect(read('deniedApprovals')).not.toContain("state='PENDING'");
  });

  it('PARITY: the PostgreSQL claim uses JULIUS_CLAIMABLE_RUN_STATES and refuses PENDING and DENIED approvals', () => {
    const source = readFileSync(join(__dirname, '..', 'src', 'relay', 'persistence', 'julius-postgres.ts'), 'utf8');
    const claim = source.slice(source.indexOf('async claimRunnable('), source.indexOf('RETURNING t.task_id', source.indexOf('async claimRunnable(')));
    const states = /r\.state IN\(([^)]*)\)/u.exec(claim)?.[1]?.split(',').map((value) => value.trim().replace(/'/gu, ''));
    expect(states, 'the SQL list is the constant, in order').toEqual([...JULIUS_CLAIMABLE_RUN_STATES]);
    expect(claim).toContain("NOT EXISTS(SELECT 1 FROM relay_wonderland.julius_approvals a WHERE a.run_id=t.run_id AND a.state IN('PENDING','DENIED'))");
  });
});

/* ======================================== E. the orders an adversary picks */

/**
 * FOUND BY AN ADVERSARIAL REVIEW OF THIS CHANNEL (2026-09-29), each written RED
 * against the code it found wanting before anything was changed.
 *
 *   F1  A grant took a PAUSED run straight back to READY: only a resume may.
 *   F2  A denial whose FAILED move lost a race left the run READY for ever:
 *       nothing ran, but the denial was invisible and the drive "stalled".
 *   F4  The dispatch boundary held on a PENDING approval and not on a DENIED one.
 *   F6  Resume took a run still waiting on an approval to READY, a state that
 *       says it will continue when driven. It will not: it waits on a person.
 *   F5  Two boundary branches no test could fail: the approval-only hold on a
 *       run whose state is claimable, and the FAILED branch a denial leaves.
 */
describe('E. the governance holds survive the orders an adversary picks', () => {
  const lifecycle = (memory: Memory) => ({ store: memory as never, clock });
  const hold = { runId: RUN, projectId: PROJECT, actor: 'ghu-founder', reason: 'Hold.' };
  const go = { runId: RUN, projectId: PROJECT, actor: 'ghu-founder', reason: 'Go.' };
  const gateRecord = (approvalId: string, taskId: string) => ({
    approvalId, runId: RUN, projectId: PROJECT, taskId, operation: 'DISPATCH_WORKER' as const,
    policyRevision: CARD, reasonCode: 'CARD_APPROVAL_REQUIRED', safeRationale: 'Gate.', state: 'PENDING' as const,
    requestedAt: clock.now(), decidedAt: null, decidedBy: null, decisionReason: null, idempotencyKey: approvalId,
  });
  /** After the claim, something else happens to the run: the window the boundary guards. */
  const afterClaim = (then: (memory: Memory) => Promise<unknown>) => (store: Store, memory: Memory): Store => {
    let fired = false;
    return {
      ...store,
      async claimRunnable(input) {
        const claimed = await store.claimRunnable(input);
        if (!fired && claimed.length > 0) { fired = true; await then(memory); }
        return claimed;
      },
    } as Store;
  };

  it('F1 A GRANT DOES NOT DEFEAT A PAUSE: a run paused while it waits stays PAUSED when its approval is granted', async () => {
    const s = stage({ approvals: ['DISPATCH_WORKER'] });
    expect((await s.drive()).state).toBe('BLOCKED');
    const [gate] = await s.memory.pendingApprovals(RUN, PROJECT);
    expect(await pauseJuliusRun(hold, lifecycle(s.memory))).toMatchObject({ applied: true, to: 'PAUSED' });

    expect(await s.decide(gate!.approvalId, 'APPROVED'), 'the grant is recorded').toMatchObject({ decided: true, state: 'APPROVED' });
    expect(await stateOf(s.memory), 'only a resume takes a run out of PAUSED').toBe('PAUSED');
    await s.drive(8);
    expect(s.dispatches(), 'nothing started while the run was paused').toBe(0);

    // The grant stands, and the resume takes the run on from it.
    expect((await s.memory.loadApproval(RUN, gate!.approvalId, PROJECT))?.state).toBe('APPROVED');
    expect(await resumeJuliusRun(go, lifecycle(s.memory))).toMatchObject({ applied: true, to: 'READY' });
    await s.drive(8);
    expect(s.dispatches(), 'the granted dispatch runs once the pause is lifted').toBeGreaterThan(0);
  });

  it('F2 A LOST DENIAL STILL ENDS THE RUN: the next advance fails a run holding a DENIED approval', async () => {
    const s = stage();
    await s.memory.requestApproval(gateRecord('apr-denied-lost', `${RUN}:plan-1`));
    // Decided at the store only: the run's own move to FAILED lost its race and never happened.
    await s.memory.decideApproval({
      runId: RUN, approvalId: 'apr-denied-lost', projectId: PROJECT, state: 'DENIED',
      decidedBy: 'ghu-founder', decisionReason: 'No.', decidedAt: clock.now(),
    });
    expect(await stateOf(s.memory)).toBe('READY');

    const outcome = await s.drive(6);
    expect(s.dispatches(), 'nothing ran').toBe(0);
    expect(outcome.state, 'and the denial ENDS the run, rather than leaving it READY for ever').toBe('FAILED');
    expect(outcome.stalled).toBe(false);
  });

  it('F4 THE DISPATCH BOUNDARY HOLDS ON A DENIAL, not only on a pending approval', async () => {
    const s = stage({ wrap: afterClaim(async (memory) => {
      await memory.requestApproval(gateRecord('apr-late-deny', `${RUN}:build-1`));
      await memory.decideApproval({
        runId: RUN, approvalId: 'apr-late-deny', projectId: PROJECT, state: 'DENIED',
        decidedBy: 'ghu-founder', decisionReason: 'No.', decidedAt: clock.now(),
      });
    }) });
    const report = await s.tick();
    expect(s.dispatches(), 'a denial landing after the claim starts nothing').toBe(0);
    expect(report.outcomes[0]).toMatchObject({ kind: 'HELD', reasonCode: 'RUN_APPROVAL_DENIED' });
    expect(s.memory.taskRow(`${RUN}:plan-1`)!.state, 'the run is denied, so its claimed task ends').toBe('FAILED');
  });

  it('F5a THE BOUNDARY HOLDS ON A PENDING APPROVAL ALONE, while the run state is still claimable', async () => {
    // Written at the store without moving the run, so only the approval can hold it.
    const s = stage({ wrap: afterClaim((memory) => memory.requestApproval(gateRecord('apr-state-ready', `${RUN}:build-1`))) });
    const report = await s.tick();
    expect(await stateOf(s.memory), 'the run state alone would have admitted it').toBe('READY');
    expect(report.outcomes[0]).toMatchObject({ kind: 'HELD', reasonCode: 'RUN_AWAITING_APPROVAL' });
    expect(s.dispatches()).toBe(0);
    expect(s.memory.taskRow(`${RUN}:plan-1`)!.state, 'handed back for when the hold lifts').toBe('RUNNABLE');
  });

  it('F5c A DENIAL THAT FAILED THE RUN AFTER THE CLAIM ends the claimed task at the boundary', async () => {
    const s = stage({ wrap: afterClaim(async (memory) => {
      await memory.requestApproval(gateRecord('apr-deny-moved', `${RUN}:build-1`));
      await decideJuliusApproval({
        runId: RUN, projectId: PROJECT, approvalId: 'apr-deny-moved', decision: 'DENIED', approverId: 'ghu-founder', reason: 'No.',
      }, { store: memory as never, clock, approvers: anyone });
    }) });
    expect((await s.tick()).outcomes[0]).toMatchObject({ kind: 'HELD', reasonCode: 'RUN_FAILED' });
    expect(await stateOf(s.memory)).toBe('FAILED');
    expect(s.dispatches()).toBe(0);
    expect(s.memory.taskRow(`${RUN}:plan-1`)!.state).toBe('FAILED');
  });

  it('F6 RESUME RETURNS A RUN STILL WAITING ON AN APPROVAL TO BLOCKED, not to READY', async () => {
    const s = stage({ approvals: ['DISPATCH_WORKER'] });
    expect((await s.drive()).state).toBe('BLOCKED');
    expect(await pauseJuliusRun(hold, lifecycle(s.memory))).toMatchObject({ applied: true, to: 'PAUSED' });
    expect(await resumeJuliusRun(go, lifecycle(s.memory)), 'resumed to what it really is: waiting on a person')
      .toMatchObject({ applied: true, to: 'BLOCKED' });
    expect(await stateOf(s.memory)).toBe('BLOCKED');
    expect(await s.memory.pendingApprovals(RUN, PROJECT)).toHaveLength(1);
    await s.drive(6);
    expect(s.dispatches()).toBe(0);
  });

  it('F6 and a resume that lands in BLOCKED is still announced as a resume', async () => {
    const s = stage({ approvals: ['DISPATCH_WORKER'] });
    await s.drive();
    let sequence = 0;
    const announced = { store: s.memory as never, clock, events: s.memory, ids: { next: (kind: string) => `${kind}:${String(sequence += 1)}` } };
    await pauseJuliusRun(hold, announced);
    expect(await resumeJuliusRun(go, announced)).toMatchObject({ applied: true, to: 'BLOCKED' });
    const types = s.memory.events().map((event) => event.type);
    expect(types, 'the operator resumed the run, and the record says so').toContain('run.resumed');
  });
});

/* ============================== F. admission is the last check before money */

/**
 * F3, FOUND BY THE SAME ADVERSARIAL REVIEW, written RED first.
 *
 * The dispatch boundary reads the run and its approvals; the context is then
 * compiled, the contract checked, and only after all of that does `admitTask`
 * spend the attempt and let the provider be called. A pause, an approval gate
 * or a denial committed in that window was never seen: admission was a lease
 * check and nothing else, so a run its operator had just paused still bought a
 * provider call. Wherever a bridge and a mission job share a database, that
 * window is real.
 *
 * Admission now re-reads the run and its approvals AS PART OF THE ADMISSION,
 * and a held run's task is refused there: handed back unspent (paused,
 * blocked, awaiting a person), or ended (denied, terminal), exactly as the
 * boundary would have done.
 */
describe('F. admission is the last governance check before money (F3)', () => {
  const lifecycle = (memory: Memory) => ({ store: memory as never, clock });
  const hold = { runId: RUN, projectId: PROJECT, actor: 'ghu-founder', reason: 'Hold.' };
  const go = { runId: RUN, projectId: PROJECT, actor: 'ghu-founder', reason: 'Go.' };
  const gateRecord = (approvalId: string, taskId: string) => ({
    approvalId, runId: RUN, projectId: PROJECT, taskId, operation: 'DISPATCH_WORKER' as const,
    policyRevision: CARD, reasonCode: 'CARD_APPROVAL_REQUIRED', safeRationale: 'Gate.', state: 'PENDING' as const,
    requestedAt: clock.now(), decidedAt: null, decidedBy: null, decisionReason: null, idempotencyKey: approvalId,
  });
  /** After the dispatch boundary, immediately before the admission: the window F3 is about. */
  const beforeAdmission = (then: (memory: Memory) => Promise<unknown>) => (store: Store, memory: Memory): Store => {
    let fired = false;
    return {
      ...store,
      async admitTask(input) {
        if (!fired) { fired = true; await then(memory); }
        return store.admitTask(input);
      },
    } as Store;
  };

  it('F3a A PAUSE LANDING AFTER THE BOUNDARY CHECK starts nothing: admission refuses, and the task goes back unspent', async () => {
    const s = stage({ wrap: beforeAdmission((memory) => pauseJuliusRun(hold, lifecycle(memory))) });
    const report = await s.tick();
    expect(s.dispatches(), 'a run paused before its admission bought no provider call').toBe(0);
    expect(report.outcomes[0]).toMatchObject({ kind: 'HELD', reasonCode: 'RUN_PAUSED' });
    const row = s.memory.taskRow(`${RUN}:plan-1`)!;
    expect(row.state, 'handed back for when the pause lifts').toBe('RUNNABLE');
    expect(row.attempt, 'and no execution attempt was spent on it').toBe(0);

    expect(await resumeJuliusRun(go, lifecycle(s.memory))).toMatchObject({ applied: true, to: 'READY' });
    expect((await s.drive()).state, 'resumed, the mission runs to the end as it would have').toBe('COMPLETED');
  });

  it('F3b AN APPROVAL GATE LANDING AFTER THE BOUNDARY CHECK holds the dispatch until a person answers', async () => {
    // Written at the store without moving the run, so only the approval can hold it.
    const s = stage({ wrap: beforeAdmission((memory) => memory.requestApproval(gateRecord('apr-at-admission', `${RUN}:plan-1`))) });
    const report = await s.tick();
    expect(s.dispatches()).toBe(0);
    expect(report.outcomes[0]).toMatchObject({ kind: 'HELD', reasonCode: 'RUN_AWAITING_APPROVAL' });
    const row = s.memory.taskRow(`${RUN}:plan-1`)!;
    expect(row.state).toBe('RUNNABLE');
    expect(row.attempt).toBe(0);
  });

  it('F3c A DENIAL LANDING AFTER THE BOUNDARY CHECK ends the claimed task, and nothing is dispatched', async () => {
    const s = stage({ wrap: beforeAdmission(async (memory) => {
      await memory.requestApproval(gateRecord('apr-denied-at-admission', `${RUN}:plan-1`));
      await memory.decideApproval({
        runId: RUN, approvalId: 'apr-denied-at-admission', projectId: PROJECT, state: 'DENIED',
        decidedBy: 'ghu-founder', decisionReason: 'No.', decidedAt: clock.now(),
      });
    }) });
    const report = await s.tick();
    expect(s.dispatches()).toBe(0);
    expect(report.outcomes[0]).toMatchObject({ kind: 'HELD', reasonCode: 'RUN_APPROVAL_DENIED' });
    expect(s.memory.taskRow(`${RUN}:plan-1`)!.state, 'a denied run will not resume, so its task ends').toBe('FAILED');
    expect((await s.drive(6)).state, 'and the run ends with it').toBe('FAILED');
    expect(s.dispatches()).toBe(0);
  });

  it('F3d A CANCEL LANDING AFTER THE BOUNDARY CHECK: admission finds the task gone, and nothing runs', async () => {
    const s = stage({ wrap: beforeAdmission((memory) => cancelJuliusRun(
      { runId: RUN, projectId: PROJECT, actor: 'ghu-founder', reason: 'Stop.' }, lifecycle(memory))) });
    const report = await s.tick();
    expect(s.dispatches()).toBe(0);
    expect(report.lostLeases, 'the cancelled task is nobody\'s to run').toBe(1);
    expect(s.memory.taskRow(`${RUN}:plan-1`)!.state).toBe('CANCELLED');
  });

  it('F3e NOTHING HELD, NOTHING CHANGES: an unheld mission admits and completes with the same dispatches as before', async () => {
    const plain = stage();
    const watched = stage({ wrap: beforeAdmission(async () => undefined) });
    expect((await plain.drive()).state).toBe('COMPLETED');
    expect((await watched.drive()).state).toBe('COMPLETED');
    expect(watched.dispatches(), 'admission added no hold to a run nobody held').toBe(plain.dispatches());
  });
});
