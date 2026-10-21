/**
 * ADVERSARIAL e2e of the stop line under a declared coder session budget (juju2, 2026-10-20). The reviewer REFUSES the build until the
 * contract's repair rounds are spent, every dispatch takes ten fake minutes, and the job length is swept. The properties are the ones the
 * budget promises: no stage ever starts that could not end by the stop line (inclusive boundary), the run ends COMPLETED or FAILED with
 * job_deadline_reached (never stalled, never an overrun), a longer coder bound never starts MORE stages than the default, more room
 * never starts FEWER, and no repair cycle is dropped while the clock allows it (3 declared => 3 run on a job with room).
 */

import { describe, expect, it } from 'vitest';

import {
  createJuliusMemoryStore,
  juliusLeaseHoldBoundMs,
  juliusLeaseMsFor,
  juliusPacketTextIn,
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


const FAILED_REVIEW = [{ type: 'REVIEW_FINDING', status: 'FAILED', safeSummary: 'A blocking finding.' }];

/** Like the stop-line fixture, but the reviewer refuses the BUILD `refusals` times (each refusal buys one repair round), then accepts. */
async function drive(coderWorker: JuliusWorker, jobBudgetMs: number, refusals: number, repairRounds: number) {
  const memory = createJuliusMemoryStore();
  const handoffs = createContextAndClaimHandoffs(memory as unknown as JuliusRuntimeStore & JuliusRecoveryDriver);
  seed(memory);
  let clock = T0;
  const starts: { readonly role: string; readonly at: number; readonly taskType?: string }[] = [];
  let buildReviews = 0;
  const slow = (worker: JuliusWorker, pick: (taskType: string | undefined) => ScriptedOutcome): JuliusProviderAdapter => ({
    adapterId: worker.adapterId,
    async dispatch(input) {
      starts.push({ role: worker.role, at: clock, ...(input.taskType === undefined ? {} : { taskType: input.taskType }) });
      clock += STAGE_MS;
      return scriptedAdapter(worker, [pick(input.taskType)], { packetFor: juliusPacketTextIn(memory) }).dispatch(input);
    },
  });
  const entries = [
    { worker: architectWorker({}), adapter: slow(architectWorker({}), () => ({ kind: 'succeed', evidence: PLAN_EVIDENCE, usdMicros: null })) },
    { worker: coderWorker, adapter: slow(coderWorker, () => ({ kind: 'succeed', evidence: BUILD_EVIDENCE, usdMicros: 1_000_000 })) },
    {
      worker: REVIEWER_WORKER,
      adapter: slow(REVIEWER_WORKER, (taskType) => {
        if (taskType?.endsWith(':plan')) return { kind: 'succeed', evidence: PASSED_REVIEW, usdMicros: null };
        buildReviews += 1;
        return buildReviews <= refusals ? { kind: 'succeed', evidence: FAILED_REVIEW, usdMicros: null } : { kind: 'succeed', evidence: PASSED_REVIEW, usdMicros: null, ...(refusals > 0 ? { answerFindings: 'RESOLVED' as const } : {}) };
      }),
    },
  ];
  const runtime = assembleLiveJuliusRuntime({
    store: handoffs.store, entries, cardRevision: 'card-crt', spendCeilingUsdMicros: 30_000_000, maxRepairRounds: repairRounds,
  });
  const deadline = liveStageDeadline({ jobStartedAt: new Date(T0).toISOString(), workers: entries.map((entry) => entry.worker), jobBudgetMs });
  expect(deadline).not.toBeNull();
  const outcome = await driveJuliusRunToTerminal({
    loop: runtime.loop, store: handoffs.store, runId: RUN, projectId: PROJECT, verification: runtime.verification,
    now: () => clock, deadline: deadline!,
  });
  return { outcome, starts, deadline: deadline!, endClock: clock };
}

const coderStarts = (starts: readonly { role: string }[]) => starts.filter((s) => s.role === 'CODING_AGENT').length;

describe('ADVERSARIAL stop line: sweep the job length with a reviewer that refuses until the repair rounds are spent', () => {
  const JOBS = Array.from({ length: 24 }, (_, k) => (70 + k * 9) * MIN);

  it('INVARIANTS for the declared 45-minute coder (bound 54.75 min) at 3 repair rounds, across 24 job lengths', async () => {
    const declared = coderWorkerForRuntime(45);
    let previousCoderStarts = -1;
    for (const job of JOBS) {
      const { outcome, starts, deadline, endClock } = await drive(declared, job, 3, 3);
      const stop = deadline.stagesEndByMs;
      for (const s of starts) expect(s.at + (deadline.stageBoundMs[s.role] ?? 0), `job ${job / MIN} min: a ${s.role} stage started at +${(s.at - T0) / MIN} that could not end by the stop line`).toBeLessThanOrEqual(stop);
      expect(outcome.stalled, `job ${job / MIN}`).toBe(false);
      expect(['COMPLETED', 'FAILED'], `job ${job / MIN}`).toContain(outcome.state);
      if (outcome.state === 'FAILED') {
        expect(outcome.haltCause, `job ${job / MIN}`).toMatch(/^job_deadline_reached: /u);
        const declinedUpTo = Number(/The next stage \(up to (\d+) ms\)/u.exec(outcome.haltCause ?? '')?.[1]);
        expect(Number.isFinite(declinedUpTo), `job ${job / MIN}: ${outcome.haltCause}`).toBe(true);
        expect(endClock + declinedUpTo, `job ${job / MIN}: it declined a stage that still fit`).toBeGreaterThan(stop);
      }
      const n = coderStarts(starts);
      expect(n, `job ${job / MIN}`).toBeGreaterThanOrEqual(previousCoderStarts);
      previousCoderStarts = n;
      expect(n).toBeLessThanOrEqual(4);
    }
  }, 120_000);

  it('a job with room runs ALL declared repair rounds (no cycle dropped by the budget): 3 refusals => 4 coder stages, COMPLETED', async () => {
    const { outcome, starts } = await drive(coderWorkerForRuntime(45), 300 * MIN, 3, 3);
    expect(outcome.state).toBe('COMPLETED');
    expect(coderStarts(starts)).toBe(4);
  }, 60_000);

  it('the DEFAULT coder never starts FEWER stages than the declared 45-minute coder on the same job (the longer bound can only decline earlier)', async () => {
    for (const job of JOBS) {
      const a = await drive(coderWorkerForRuntime(45), job, 3, 3);
      const b = await drive(CODER_WORKER, job, 3, 3);
      expect(coderStarts(b.starts), `job ${job / MIN} min`).toBeGreaterThanOrEqual(coderStarts(a.starts));
    }
  }, 180_000);

  it('BOUNDARY: a stage whose bound lands EXACTLY on the stop line starts; one millisecond less room declines it', async () => {
    const declared = coderWorkerForRuntime(30);
    const bound = declared.timeoutMs + JULIUS_STAGE_SETTLEMENT_MARGIN_MS;
    const exactJob = 20 * MIN + bound + 7 * MIN;
    const exact = await drive(declared, exactJob, 0, 0);
    expect(exact.starts.map((s) => s.role).slice(0, 3)).toEqual(['PROMPT_ARCHITECT', 'INDEPENDENT_REVIEWER', 'CODING_AGENT']);
    const short = await drive(declared, exactJob - 1, 0, 0);
    expect(short.starts.map((s) => s.role)).toEqual(['PROMPT_ARCHITECT', 'INDEPENDENT_REVIEWER']);
    expect(short.outcome.state).toBe('FAILED');
  }, 60_000);

  it('repair rounds: with ZERO declared rounds a refusing reviewer produces the SAME outcome and the SAME number of coder stages with the declared 45-minute coder as with the default (the budget adds and removes no cycle)', async () => {
    const declared = await drive(coderWorkerForRuntime(45), 300 * MIN, 5, 0);
    const control = await drive(CODER_WORKER, 300 * MIN, 5, 0);
    expect(coderStarts(declared.starts)).toBe(1);
    expect(coderStarts(control.starts)).toBe(1);
    expect(declared.outcome.state).toBe(control.outcome.state);
    expect(declared.outcome.stalled).toBe(control.outcome.stalled);
    expect(declared.starts.map((s) => s.role)).toEqual(control.starts.map((s) => s.role));
  }, 60_000);
  it('the SAME equivalence for 1, 2 and 3 declared rounds with a reviewer that refuses more often than the rounds allow', async () => {
    for (const rounds of [1, 2, 3]) {
      const declared = await drive(coderWorkerForRuntime(45), 400 * MIN, 9, rounds);
      const control = await drive(CODER_WORKER, 400 * MIN, 9, rounds);
      expect(coderStarts(declared.starts), `rounds ${rounds}`).toBe(coderStarts(control.starts));
      expect(coderStarts(declared.starts), `rounds ${rounds}`).toBeLessThanOrEqual(rounds + 1);
      expect(declared.outcome.state).toBe(control.outcome.state);
    }
  }, 120_000);
});
