/**
 * A DECLARED CODER SESSION BUDGET LENGTHENS THE STAGE BOUND, THE LEASE AND THE HOLD BOUND TOGETHER, AND THE STOP LINE STILL HOLDS.
 *
 * `limits.coderRuntimeMinutes` is carried by ONE object, the coder's `JuliusWorker` copy (`coderWorkerForRuntime`). Everything that
 * bounds execution is derived from the worker objects the composition registers, and these tests pin each derivation:
 *
 *   - the execution coordinator's dispatch deadline is `worker.timeoutMs`;
 *   - the lease is `max(worker.timeoutMs) + the 600 s settlement allowance`, renewed four times per lease, and never held past the
 *     task's hold bound (every worker of its role at its deadline + the same allowance);
 *   - each role's stage bound is the same hold bound with the 2-minute settlement margin, and the drive's stop line starts a stage
 *     only while `now + stage bound <= stagesEndByMs`.
 *
 * So a longer coder attempt can never leave a still-running attempt without its lease (the lease always exceeds the attempt it
 * covers), can never be held forever (the hold bound is finite and derived), and can never run past the job (the stop line declines
 * to START a stage that could not end by the stop line, ending the run FAILED with time left for its record).
 *
 * The control is the same mission with the DEFAULT coder worker, which starts the stage the declared one declines: that is the
 * "scaled deadline" at work, not a changed constant.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  createJuliusMemoryStore,
  juliusLeaseHoldBoundMs,
  juliusLeaseMsFor,
  scriptedAdapter,
  seedJuliusTaskContract,
  type JuliusProviderAdapter,
  type JuliusRecoveryDriver,
  type JuliusRuntimeStore,
  type JuliusWorker,
  type ScriptedOutcome,
} from '../../src/relay/mission/julius';
import {
  architectWorker,
  CODER_WORKER,
  assembleLiveJuliusRuntime,
  coderWorkerForRuntime,
  createContextAndClaimHandoffs,
  driveJuliusRunToTerminal,
  JULIUS_JOB_STAMP_LAG_RESERVE_MS,
  JULIUS_LIVE_LEASE_SETTLEMENT_ALLOWANCE_MS,
  JULIUS_RESERVE_AFTER_LIVE_MS,
  JULIUS_STAGE_SETTLEMENT_MARGIN_MS,
  liveStageDeadline,
  reviewerWorker,
} from './live-composition';

const RUN = `run:${'0d'.repeat(12)}`;
const PROJECT = 'prj-crt-stop';
const MISSION = 'mission-crt-stop';
const REVIEWER_WORKER = reviewerWorker('hermes');
const STAGE_MS = 10 * 60_000;
const T0 = Date.parse('2026-10-19T12:00:00.000Z');
const MIN = 60_000;

const PLAN_EVIDENCE = [{ type: 'ARTIFACT', status: 'PASSED', safeSummary: 'Plan written.' }];
const BUILD_EVIDENCE = [{ type: 'TEST', status: 'PASSED', safeSummary: 'Suite green.' }];
const PASSED_REVIEW = [{ type: 'REVIEW_FINDING', status: 'PASSED', safeSummary: 'No blocking findings.' }];

function seed(store: ReturnType<typeof createJuliusMemoryStore>): void {
  store.seedRun({
    runId: RUN, missionId: MISSION, projectId: PROJECT, state: 'READY',
    cardRevision: 'card-crt', missionContractRevision: 1, projectBrainRevision: 0, version: 1,
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
    objective: 'Finish a mission whose stages each take ten minutes.',
    requirements: ['Do the work.'], constraints: ['Touch only the module.'],
    acceptanceCriteria: [{ id: 'AC-1', text: 'The suite passes.', blocking: true }],
    filesInScope: [], filesOutOfScope: [], spendUsd: 30, repairCycles: 3, requiredEvidence: ['TEST'],
  });
  if (!seeded.seeded) throw new Error(`fixture contract not derivable: ${seeded.reasonCode}`);
  void store.putTaskContract({ projectId: PROJECT, contract: seeded.contract, occurredAt: '2026-10-19T12:00:00.000Z' });
  store.seedCriteria(RUN, [{ criterionId: 'AC-1', description: 'The suite passes.', requiredEvidenceTypes: [] }]);
  store.seedBrain(RUN, [{
    entryId: 'brain-objective', kind: 'OBJECTIVE', text: 'OBJECTIVE: finish a mission whose stages are slow.',
    taskIds: [], allowedRoles: ['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER'], sensitivity: 'INTERNAL',
  }]);
}

/** Every dispatch takes STAGE_MS on the fake clock. The coder worker is whatever the composition would register. */
async function driveWith(coderWorker: JuliusWorker, jobBudgetMs: number) {
  const memory = createJuliusMemoryStore();
  const handoffs = createContextAndClaimHandoffs(memory as unknown as JuliusRuntimeStore & JuliusRecoveryDriver);
  seed(memory);
  let clock = T0;
  const starts: { readonly role: string; readonly at: number }[] = [];
  const slow = (worker: JuliusWorker, outcome: ScriptedOutcome): JuliusProviderAdapter => ({
    adapterId: worker.adapterId,
    async dispatch(input) {
      starts.push({ role: worker.role, at: clock });
      clock += STAGE_MS;
      return scriptedAdapter(worker, [outcome]).dispatch(input);
    },
  });
  const entries = [
    { worker: architectWorker({}), adapter: slow(architectWorker({}), { kind: 'succeed', evidence: PLAN_EVIDENCE, usdMicros: null }) },
    { worker: coderWorker, adapter: slow(coderWorker, { kind: 'succeed', evidence: BUILD_EVIDENCE, usdMicros: 1_000_000 }) },
    { worker: REVIEWER_WORKER, adapter: slow(REVIEWER_WORKER, { kind: 'succeed', evidence: PASSED_REVIEW, usdMicros: null }) },
  ];
  const runtime = assembleLiveJuliusRuntime({
    store: handoffs.store, entries, cardRevision: 'card-crt', spendCeilingUsdMicros: 30_000_000, maxRepairRounds: 3,
  });
  // THE REAL stop-line derivation, from the registered workers, on a SHORTENED job so the arithmetic is small.
  const deadline = liveStageDeadline({ jobStartedAt: new Date(T0).toISOString(), workers: entries.map((entry) => entry.worker), jobBudgetMs });
  expect(deadline, 'the job start is recorded').not.toBeNull();
  const outcome = await driveJuliusRunToTerminal({
    loop: runtime.loop, store: handoffs.store, runId: RUN, projectId: PROJECT, verification: runtime.verification,
    now: () => clock, deadline: deadline!,
  });
  return { outcome, starts, deadline: deadline!, memory };
}

describe('the derivations from the worker objects', () => {
  const declared = coderWorkerForRuntime(30);
  const workers = [architectWorker({}), declared, REVIEWER_WORKER];
  const defaults = [architectWorker({}), CODER_WORKER, REVIEWER_WORKER];

  it('the declared worker carries the attempt deadline the coordinator enforces: session + the executor steps around it', () => {
    expect(declared.timeoutMs).toBe(30 * MIN + 45_000 + 420_000);
    expect(declared.timeoutMs).toBeGreaterThan(CODER_WORKER.timeoutMs);
  });

  it('the lease is the longest worker deadline + the settlement allowance, so it ALWAYS outlives the attempt it covers', () => {
    const lease = juliusLeaseMsFor(workers, JULIUS_LIVE_LEASE_SETTLEMENT_ALLOWANCE_MS);
    expect(lease).toBe(declared.timeoutMs + JULIUS_LIVE_LEASE_SETTLEMENT_ALLOWANCE_MS);
    expect(lease, 'a lost renewal cannot expire the lease under a running attempt').toBeGreaterThan(declared.timeoutMs);
    expect(lease).toBeGreaterThan(juliusLeaseMsFor(defaults, JULIUS_LIVE_LEASE_SETTLEMENT_ALLOWANCE_MS));
    // ... and it is renewed four times per lease, a finite number of times: the hold bound caps the total.
    expect(Math.floor(lease / 4)).toBeLessThan(lease);
  });

  it('the hold bound is finite and derived: every worker of the role at its deadline + the allowance; other roles are unchanged', () => {
    const bound = (list: typeof workers, role: string) => juliusLeaseHoldBoundMs(list, { role }, JULIUS_LIVE_LEASE_SETTLEMENT_ALLOWANCE_MS);
    expect(bound(workers, 'CODING_AGENT')).toBe(declared.timeoutMs + JULIUS_LIVE_LEASE_SETTLEMENT_ALLOWANCE_MS);
    expect(bound(workers, 'PROMPT_ARCHITECT')).toBe(bound(defaults, 'PROMPT_ARCHITECT'));
    expect(bound(workers, 'INDEPENDENT_REVIEWER')).toBe(bound(defaults, 'INDEPENDENT_REVIEWER'));
  });

  it('the stage bounds grow for the coder only, and the stop line itself (stamp + job - lag - reserve) does not move', () => {
    const started = new Date(T0).toISOString();
    const a = liveStageDeadline({ jobStartedAt: started, workers: defaults })!;
    const b = liveStageDeadline({ jobStartedAt: started, workers })!;
    expect(b.stageBoundMs.CODING_AGENT).toBe(declared.timeoutMs + JULIUS_STAGE_SETTLEMENT_MARGIN_MS);
    expect(b.stageBoundMs.CODING_AGENT).toBeGreaterThan(a.stageBoundMs.CODING_AGENT);
    expect(b.stageBoundMs.PROMPT_ARCHITECT).toBe(a.stageBoundMs.PROMPT_ARCHITECT);
    expect(b.stageBoundMs.INDEPENDENT_REVIEWER).toBe(a.stageBoundMs.INDEPENDENT_REVIEWER);
    expect(b.stagesEndByMs).toBe(a.stagesEndByMs);
    expect(b.hardLimitAtMs).toBe(a.hardLimitAtMs);
  });

  it('the composition builds its lease, renewal and hold bound from the registered entries\' workers (structural: no number of its own)', () => {
    const source = readFileSync(join(__dirname, 'live-composition.ts'), 'utf8');
    expect(source).toContain('const workers = options.entries.map((entry) => entry.worker);');
    expect(source).toContain('juliusLeaseMsFor(workers, JULIUS_LIVE_LEASE_SETTLEMENT_ALLOWANCE_MS)');
    expect(source).toContain('holdBoundMsFor: (task) => juliusLeaseHoldBoundMs(workers, task, JULIUS_LIVE_LEASE_SETTLEMENT_ALLOWANCE_MS)');
  });
});

describe('the stop line, with the declared worker and with the default as the control', () => {
  // A 62-minute job: stop line = T0 + 62 - 2 (lag) - 5 (reserve after LIVE) = T0 + 55 min. Plan (10) and its review (10) end at +20.
  const JOB = 62 * MIN;
  const STOP = T0 + 55 * MIN;

  it('CONTROL: the DEFAULT coder worker (bound 21.99 min) starts the build at +20 min, because +20 + 21.99 <= +55', async () => {
    const { outcome, starts, deadline } = await driveWith(CODER_WORKER, JOB);
    expect(deadline.stagesEndByMs).toBe(STOP);
    expect(deadline.stageBoundMs.CODING_AGENT).toBe(CODER_WORKER.timeoutMs + JULIUS_STAGE_SETTLEMENT_MARGIN_MS);
    expect(starts.map((s) => s.role).slice(0, 3)).toEqual(['PROMPT_ARCHITECT', 'INDEPENDENT_REVIEWER', 'CODING_AGENT']);
    expect(starts.every((s) => s.at + (deadline.stageBoundMs[s.role] ?? 0) <= STOP), 'no stage started that could not end by the stop line').toBe(true);
    expect(outcome.state).toBe('COMPLETED');
  });

  it('DECLARED 30 min (bound 39.75 min): the same mission DECLINES to start the build at +20 min (+20 + 39.75 > +55) and ends FAILED with its record, never overrunning', async () => {
    const { outcome, starts, deadline, memory } = await driveWith(coderWorkerForRuntime(30), JOB);
    expect(deadline.stagesEndByMs).toBe(STOP);
    expect(deadline.stageBoundMs.CODING_AGENT).toBe(30 * MIN + 45_000 + 420_000 + JULIUS_STAGE_SETTLEMENT_MARGIN_MS);
    expect(starts.map((s) => s.role), 'plan and its review ran; the coder stage was not started').toEqual(['PROMPT_ARCHITECT', 'INDEPENDENT_REVIEWER']);
    expect(outcome).toMatchObject({ state: 'FAILED', stalled: false });
    expect(outcome.haltCause).toMatch(/^job_deadline_reached: The next stage \(up to 2385000 ms\) cannot end by /u);
    expect((await memory.loadRun(RUN, PROJECT))?.state).toBe('FAILED');
    expect(JULIUS_JOB_STAMP_LAG_RESERVE_MS + JULIUS_RESERVE_AFTER_LIVE_MS, 'the margins this arithmetic used').toBe(7 * MIN);
  });

  it('on a job with room, the declared worker runs the SAME mission to COMPLETED (the stop line bounds; it does not forbid)', async () => {
    const { outcome, starts } = await driveWith(coderWorkerForRuntime(30), 120 * MIN);
    expect(outcome.state).toBe('COMPLETED');
    expect(starts.map((s) => s.role)).toEqual(['PROMPT_ARCHITECT', 'INDEPENDENT_REVIEWER', 'CODING_AGENT', 'INDEPENDENT_REVIEWER']);
  });
});
