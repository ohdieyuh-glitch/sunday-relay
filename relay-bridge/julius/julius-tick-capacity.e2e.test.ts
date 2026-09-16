/**
 * THE TICK ALLOWANCE ON THE LIVE COMPOSITION, WITH NO SPEND.
 *
 * Qualification attempt 4 (run 34774471909) stopped at a fixed ceiling of 32
 * ticks, 44 minutes into a 120-minute job, with its run row READY, a build
 * review claimable and two of three repair rounds used per unit. Nothing on the
 * ledger said why.
 *
 * These drive `assembleLiveJuliusRuntime` with the production registrations;
 * only the provider adapters are scripted. A mission shaped like attempt 4 —
 * workers pausing at every segment, a reviewer refusing work round after round —
 * needs more than 32 ticks and completes under the allowance Julius derives. An
 * allowance that runs out ends the run FAILED, with the numbers on the record.
 */

import { describe, expect, it } from 'vitest';

import {
  createJuliusMemoryStore,
  scriptedAdapter,
  seedJuliusTaskContract,
  type JuliusProviderAdapter,
  type JuliusRecoveryDriver,
  type JuliusRuntimeStore,
  type JuliusTimelineEntry,
  type ScriptedOutcome,
} from '../../src/relay/mission/julius';
import {
  architectWorker,
  CODER_WORKER,
  assembleLiveJuliusRuntime,
  createContextAndClaimHandoffs,
  driveJuliusRunToTerminal,
  reviewerWorker,
} from './live-composition';

const RUN = 'run-ticks';
const PROJECT = 'prj-ticks';
const MISSION = 'mission-ticks';
const REVIEWER_WORKER = reviewerWorker('hermes');

const PLAN_EVIDENCE = [{ type: 'ARTIFACT', status: 'PASSED', safeSummary: 'Plan written.' }];
const BUILD_EVIDENCE = [{ type: 'TEST', status: 'PASSED', safeSummary: 'Suite green.' }];
const PASSED_REVIEW = [{ type: 'REVIEW_FINDING', status: 'PASSED', safeSummary: 'No blocking findings.' }];
const FAILED_REVIEW = [{ type: 'REVIEW_FINDING', status: 'FAILED', safeSummary: 'A blocking finding.' }];

/** An ask this mission grants nobody: refused, and still a pause that mints the next segment. */
const PAUSE = Object.freeze({
  researchAsks: [{ source: 'web', capability: 'read_item', reference: 'https://docs.example.test/page', purpose: 'Read the page.' }],
  segmentResume: { completedSoFar: ['did the first part'], nextIntent: 'finish the rest' },
});

function seed(store: ReturnType<typeof createJuliusMemoryStore>): void {
  store.seedRun({
    runId: RUN, missionId: MISSION, projectId: PROJECT, state: 'READY',
    cardRevision: 'card-ticks', missionContractRevision: 1, projectBrainRevision: 0, version: 1,
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
    objective: 'Finish a mission that pauses and is refused before it is accepted.',
    requirements: ['Do the work.'], constraints: ['Touch only the module.'],
    acceptanceCriteria: [{ id: 'AC-1', text: 'The suite passes.', blocking: true }],
    filesInScope: [], filesOutOfScope: [], spendUsd: 60, repairCycles: 3, requiredEvidence: ['TEST'],
  });
  if (!seeded.seeded) throw new Error(`fixture contract not derivable: ${seeded.reasonCode}`);
  void store.putTaskContract({ projectId: PROJECT, contract: seeded.contract, occurredAt: '2026-09-15T00:00:00.000Z' });
  store.seedCriteria(RUN, [{ criterionId: 'AC-1', description: 'The suite passes.', requiredEvidenceTypes: [] }]);
  store.seedBrain(RUN, [{
    entryId: 'brain-objective', kind: 'OBJECTIVE', text: 'OBJECTIVE: finish a mission that pauses and is refused.',
    taskIds: [], allowedRoles: ['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER'], sensitivity: 'INTERNAL',
  }]);
}

/** Segments 1–3 of every lineage pause; the fourth finishes. The same shape whatever order the loop claims in. */
const segmentOf = (taskId: string): number => {
  const match = /^segment:.+:(\d+):task$/u.exec(taskId);
  return match === null ? 1 : Number(match[1]);
};

/** An adapter whose answer is chosen from the task it was handed. */
function byTask(base: ReturnType<typeof scriptedAdapter>, pick: (taskId: string, taskType: string | undefined) => ScriptedOutcome) {
  const dispatches: { taskId: string; taskType?: string }[] = [];
  const adapter: JuliusProviderAdapter = {
    adapterId: base.adapterId,
    async dispatch(input) {
      dispatches.push({ taskId: input.taskId, ...(input.taskType === undefined ? {} : { taskType: input.taskType }) });
      const worker = base.adapterId === architectWorker({}).adapterId ? architectWorker({})
        : base.adapterId === CODER_WORKER.adapterId ? CODER_WORKER : REVIEWER_WORKER;
      return scriptedAdapter(worker, [pick(input.taskId, input.taskType)]).dispatch(input);
    },
  };
  return { adapter, dispatches };
}

/**
 * ATTEMPT 4'S SHAPE, AND A LITTLE MORE. The architect's plan and the coder's
 * build pause at segments 1–3 of every lineage. The reviewer refuses the plan
 * twice and the build three times, spending every repair round the contract
 * authorises, then accepts. That is 3 × (4 + 1) plan dispatches and
 * 4 × (4 + 1) build dispatches, 35 in all, against a derived plan of 73.
 */
async function driveAttemptFourShape(options: { readonly derived: boolean; readonly maxTicks?: number; readonly rateLimitFirstBuild?: boolean }) {
  const memory = createJuliusMemoryStore();
  const handoffs = createContextAndClaimHandoffs(memory as unknown as JuliusRuntimeStore & JuliusRecoveryDriver);
  seed(memory);
  const reviews = new Map<string, number>();
  const architect = byTask(scriptedAdapter(architectWorker({}), []), (taskId) => (segmentOf(taskId) < 4
    ? { kind: 'succeed', evidence: PLAN_EVIDENCE, usdMicros: null, ...PAUSE }
    : { kind: 'succeed', evidence: PLAN_EVIDENCE, usdMicros: null }));
  let rateLimited = options.rateLimitFirstBuild !== true;
  const coder = byTask(scriptedAdapter(CODER_WORKER, []), (taskId): ScriptedOutcome => {
    if (!rateLimited) {
      rateLimited = true;
      return { kind: 'fail', code: 'RATE_LIMIT' };
    }
    return segmentOf(taskId) < 4
      ? { kind: 'succeed', evidence: BUILD_EVIDENCE, usdMicros: 1_000_000, ...PAUSE }
      : { kind: 'succeed', evidence: BUILD_EVIDENCE, usdMicros: 1_000_000 };
  });
  const reviewer = byTask(scriptedAdapter(REVIEWER_WORKER, []), (_taskId, taskType) => {
    const stage = taskType?.endsWith(':plan') ? 'plan' : 'build';
    const seen = (reviews.get(stage) ?? 0) + 1;
    reviews.set(stage, seen);
    const refusals = stage === 'plan' ? 2 : 3;
    return { kind: 'succeed', evidence: seen <= refusals ? FAILED_REVIEW : PASSED_REVIEW, usdMicros: null };
  });
  const runtime = assembleLiveJuliusRuntime({
    store: handoffs.store,
    entries: [
      { worker: architectWorker({}), adapter: architect.adapter },
      { worker: CODER_WORKER, adapter: coder.adapter },
      { worker: REVIEWER_WORKER, adapter: reviewer.adapter },
    ],
    cardRevision: 'card-ticks', spendCeilingUsdMicros: 60_000_000, maxRepairRounds: 3,
  });
  const outcome = await driveJuliusRunToTerminal({
    loop: runtime.loop, store: handoffs.store, runId: RUN, projectId: PROJECT,
    ...(options.derived ? { verification: runtime.verification } : {}),
    ...(options.maxTicks === undefined ? {} : { maxTicks: options.maxTicks }),
  });
  const timeline: JuliusTimelineEntry[] = [];
  let sinceSequence = 0;
  for (;;) {
    const page = await memory.timeline({ runId: RUN, projectId: PROJECT, sinceSequence, limit: 500 });
    timeline.push(...page.entries);
    if (page.entries.length === 0 || !page.hasMore) break;
    sinceSequence = Math.max(...page.entries.map((entry) => entry.sequence));
  }
  const dispatches = architect.dispatches.length + coder.dispatches.length + reviewer.dispatches.length;
  return { outcome, timeline, dispatches, memory, runtime };
}

describe('T1 — a mission that legitimately needs more than 32 ticks', () => {
  it('BEFORE: the old fixed ceiling stops it at 32 with the run still READY and nothing on the record', async () => {
    const { outcome, timeline, dispatches } = await driveAttemptFourShape({ derived: false, maxTicks: 32 });
    expect(outcome).toMatchObject({ state: 'READY', ticks: 32, stalled: true, tickAccount: null });
    expect(dispatches, 'one dispatch per tick').toBe(32);
    expect(timeline.filter((entry) => entry.type === 'run.failed'), 'and no failure recorded').toEqual([]);
  });

  it('AFTER: under the derived allowance it completes, one dispatch per tick, well inside the plan', async () => {
    const { outcome, dispatches } = await driveAttemptFourShape({ derived: true });
    expect(outcome.state).toBe('COMPLETED');
    expect(dispatches, '3 x (4 + 1) plan dispatches and 4 x (4 + 1) build dispatches').toBe(35);
    expect(outcome.ticks, 'three past the old ceiling, one dispatch each').toBe(35);
    expect(outcome.tickAccount).toMatchObject({
      plannedTicks: 73, hardMaxTicks: 3457, allowance: 73, beyondMainPath: 0, disagreementTicks: 0, retries: 0, override: null, exhausted: false,
      reason: 'units=PROMPT_ARCHITECT,CODING_AGENT repair_rounds=3 segment_ceiling=4 reviewer=required attempts=3 disagreement=one_rebuttal_one_re_review_per_review',
    });
    expect(outcome.tickAccount!.ticksConsumed).toBe(outcome.ticks);
    expect(outcome.tickAccount!.ticksRemaining).toBe(73 - outcome.ticks);
  });
});

describe('T2 — an allowance that runs out ends the run FAILED, with the numbers', () => {
  it('tightened to 20 ticks, the run fails at the boundary, records why, and dispatches nothing after', async () => {
    const { outcome, timeline, dispatches, memory } = await driveAttemptFourShape({ derived: true, maxTicks: 20 });
    expect(outcome).toMatchObject({ state: 'FAILED', ticks: 20, stalled: false });
    expect(outcome.haltCause).toMatch(/^tick_budget_exhausted: /u);
    expect(outcome.tickAccount).toMatchObject({
      plannedTicks: 73, allowance: 20, override: 20, ticksConsumed: 20, ticksRemaining: 0, exhausted: true,
    });
    expect(dispatches, 'not one dispatch past the allowance').toBe(20);
    const run = await memory.loadRun(RUN, PROJECT);
    expect(run?.state).toBe('FAILED');
    const failed = timeline.filter((entry) => entry.type === 'run.failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]!.facts).toMatchObject({
      reasonCode: 'tick_budget_exhausted', plannedTicks: 73, allowance: 20, ticksConsumed: 20, hardMaxTicks: 3457,
      beyondMainPath: 0, retries: 0, override: 20,
      tickBudgetReason: 'units=PROMPT_ARCHITECT,CODING_AGENT repair_rounds=3 segment_ceiling=4 reviewer=required attempts=3 disagreement=one_rebuttal_one_re_review_per_review',
    });
  });

  it('an override larger than the derived allowance cannot loosen it', async () => {
    const { outcome } = await driveAttemptFourShape({ derived: true, maxTicks: 5_000 });
    expect(outcome.state).toBe('COMPLETED');
    expect(outcome.tickAccount).toMatchObject({ allowance: 73, override: 5_000 });
  });
});

describe('T3 — a retried attempt is paid for with a tick, and the allowance grows by exactly that tick', () => {
  it('a rate-limited first build dispatch is retried, counted, and the mission still completes', async () => {
    const { outcome, dispatches } = await driveAttemptFourShape({ derived: true, rateLimitFirstBuild: true });
    expect(outcome.state).toBe('COMPLETED');
    expect(dispatches, 'the 35 dispatches of the shape, plus the one that was refused and retried').toBe(36);
    expect(outcome.tickAccount).toMatchObject({ retries: 1, allowance: 74, beyondMainPath: 0, exhausted: false });
  });
});
