/**
 * THE JOB'S CLOCK, ENFORCED BY THE DRIVE (Decision C, audit F3, 2026-10-13).
 *
 * The workflow's job timeout was the only stop: the entrypoint printed its wall-clock deadline and never enforced it,
 * and the job budget prices no repair cycle while each C arm may run three. A slow, legal arm was therefore cut by the
 * runner mid-stage: the run stayed RUNNING, no `run.failed`, no learning record, no store export.
 *
 * These drive `assembleLiveJuliusRuntime` with the production registrations and scripted adapters on a FAKE CLOCK on
 * which every dispatch takes 25 minutes. Past the stop line no stage starts, the run ends FAILED through its ordinary
 * path with the Julius code TIMEOUT, and the learning record a registered arm owes is written.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  createJuliusMemoryStore,
  juliusLeaseHoldBoundMs,
  scriptedAdapter,
  seedJuliusTaskContract,
  type JuliusLearningRegistration,
  type JuliusProviderAdapter,
  type JuliusRecoveryDriver,
  type JuliusRuntimeStore,
  type JuliusTimelineEntry,
  type JuliusWorker,
  type ScriptedOutcome,
} from '../../src/relay/mission/julius';
import { JOB_BUDGET_MS } from '../reviewer-deadline';
import {
  architectWorker,
  CODER_WORKER,
  assembleLiveJuliusRuntime,
  createContextAndClaimHandoffs,
  driveJuliusRunToTerminal,
  JULIUS_JOB_STAMP_LAG_RESERVE_MS,
  JULIUS_LIVE_LEASE_SETTLEMENT_ALLOWANCE_MS,
  JULIUS_RESERVE_AFTER_LIVE_MS,
  liveStageDeadline,
  recordJuliusLearningOutcome,
  reviewerWorker,
} from './live-composition';
import { liveStageDeadlineLine } from './live-report-lines';

const ROOT = process.cwd();
const RUN = `run:${'0c'.repeat(12)}`;
const PROJECT = 'prj-deadline';
const MISSION = 'mission-deadline';
const REVIEWER_WORKER = reviewerWorker('hermes');
const STAGE_MS = 25 * 60_000;
const T0 = Date.parse('2026-10-13T12:00:00.000Z');

const PLAN_EVIDENCE = [{ type: 'ARTIFACT', status: 'PASSED', safeSummary: 'Plan written.' }];
const BUILD_EVIDENCE = [{ type: 'TEST', status: 'PASSED', safeSummary: 'Suite green.' }];
const PASSED_REVIEW = [{ type: 'REVIEW_FINDING', status: 'PASSED', safeSummary: 'No blocking findings.' }];

function seed(store: ReturnType<typeof createJuliusMemoryStore>): void {
  store.seedRun({
    runId: RUN, missionId: MISSION, projectId: PROJECT, state: 'READY',
    cardRevision: 'card-deadline', missionContractRevision: 1, projectBrainRevision: 0, version: 1,
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
    objective: 'Finish a mission whose every stage takes twenty-five minutes.',
    requirements: ['Do the work.'], constraints: ['Touch only the module.'],
    acceptanceCriteria: [{ id: 'AC-1', text: 'The suite passes.', blocking: true }],
    filesInScope: [], filesOutOfScope: [], spendUsd: 30, repairCycles: 3, requiredEvidence: ['TEST'],
  });
  if (!seeded.seeded) throw new Error(`fixture contract not derivable: ${seeded.reasonCode}`);
  void store.putTaskContract({ projectId: PROJECT, contract: seeded.contract, occurredAt: '2026-10-13T12:00:00.000Z' });
  store.seedCriteria(RUN, [{ criterionId: 'AC-1', description: 'The suite passes.', requiredEvidenceTypes: [] }]);
  store.seedBrain(RUN, [{
    entryId: 'brain-objective', kind: 'OBJECTIVE', text: 'OBJECTIVE: finish a mission whose stages are slow.',
    taskIds: [], allowedRoles: ['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER'], sensitivity: 'INTERNAL',
  }]);
}

/** A mission whose every dispatch takes STAGE_MS on the fake clock, driven with (or without) a deadline. */
async function driveSlowMission(deadline?: { readonly stopStartingAtMs: number; readonly hardLimitAtMs: number }) {
  const memory = createJuliusMemoryStore();
  const handoffs = createContextAndClaimHandoffs(memory as unknown as JuliusRuntimeStore & JuliusRecoveryDriver);
  seed(memory);
  let clock = T0;
  const starts: number[] = [];
  const slow = (worker: JuliusWorker, outcome: ScriptedOutcome): JuliusProviderAdapter => ({
    adapterId: worker.adapterId,
    async dispatch(input) {
      starts.push(clock);
      clock += STAGE_MS;
      return scriptedAdapter(worker, [outcome]).dispatch(input);
    },
  });
  const runtime = assembleLiveJuliusRuntime({
    store: handoffs.store,
    entries: [
      { worker: architectWorker({}), adapter: slow(architectWorker({}), { kind: 'succeed', evidence: PLAN_EVIDENCE, usdMicros: null }) },
      { worker: CODER_WORKER, adapter: slow(CODER_WORKER, { kind: 'succeed', evidence: BUILD_EVIDENCE, usdMicros: 1_000_000 }) },
      { worker: REVIEWER_WORKER, adapter: slow(REVIEWER_WORKER, { kind: 'succeed', evidence: PASSED_REVIEW, usdMicros: null }) },
    ],
    cardRevision: 'card-deadline', spendCeilingUsdMicros: 30_000_000, maxRepairRounds: 3,
  });
  const outcome = await driveJuliusRunToTerminal({
    loop: runtime.loop, store: handoffs.store, runId: RUN, projectId: PROJECT, verification: runtime.verification,
    now: () => clock,
    ...(deadline === undefined ? {} : { deadline: { ...deadline, longestStageMs: STAGE_MS, reserveAfterLiveMs: 10 * 60_000 } }),
  });
  const timeline: JuliusTimelineEntry[] = [];
  let sinceSequence = 0;
  for (;;) {
    const page = await memory.timeline({ runId: RUN, projectId: PROJECT, sinceSequence, limit: 500 });
    timeline.push(...page.entries);
    if (page.entries.length === 0 || !page.hasMore) break;
    sinceSequence = Math.max(...page.entries.map((entry) => entry.sequence));
  }
  return { outcome, starts, timeline, memory };
}

describe('F3: past the stop line no stage starts, and the run ends FAILED with a record', () => {
  it('CONTROL: without a deadline the same slow mission completes', async () => {
    const { outcome, starts } = await driveSlowMission();
    expect(outcome.state).toBe('COMPLETED');
    expect(starts.length, 'plan, its review, build, its review').toBeGreaterThanOrEqual(4);
  });

  it('with the stop line at +60 min: no stage starts at or after it, the run is FAILED (job_deadline_reached, TIMEOUT), and its learning record is written', async () => {
    const stop = T0 + 60 * 60_000;
    const { outcome, starts, timeline, memory } = await driveSlowMission({ stopStartingAtMs: stop, hardLimitAtMs: T0 + 100 * 60_000 });
    expect(starts.length, 'stages started').toBeGreaterThan(0);
    expect(starts.every((at) => at < stop), `every stage started before the stop line: ${starts.map((at) => (at - T0) / 60_000).join(',')} min`).toBe(true);
    expect(starts.length, 'and the mission did not get to finish').toBe(3);
    expect(outcome).toMatchObject({ state: 'FAILED', stalled: false });
    expect(outcome.haltCause).toMatch(/^job_deadline_reached: No new stage may start after 2026-10-13T13:00:00\.000Z/u);
    expect((await memory.loadRun(RUN, PROJECT))?.state).toBe('FAILED');
    const failed = timeline.filter((entry) => entry.type === 'run.failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]!.facts).toMatchObject({
      reasonCode: 'job_deadline_reached', code: 'TIMEOUT', stopStartingAt: '2026-10-13T13:00:00.000Z', hardLimitAt: '2026-10-13T13:40:00.000Z',
      longestStageMs: STAGE_MS, reserveAfterLiveMs: 600_000,
    });

    // THE RECORD A REGISTERED ARM OWES: a run killed by the runner stays RUNNING and records NOT_TERMINAL; this one is
    // terminal, so the learning loop's caller writes the arm's event, as the entrypoint does right after the drive.
    const registration: JuliusLearningRegistration = {
      registrationDigest: createHash('sha256').update('f3 fixture').digest('hex'), arm: 'WITHOUT',
      policy: { dimensions: ['repairs'], minimumRelativeImprovement: 0.5, minimumImprovedDimensions: 1 },
    };
    const learning = await recordJuliusLearningOutcome({
      store: memory, runId: RUN, projectId: PROJECT, registration,
      objectiveDigest: `sha256:${createHash('sha256').update('objective').digest('hex')}`,
      roles: ['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER'],
    });
    expect(learning).toMatchObject({ record: 'RECORDED', runState: 'FAILED' });
  });

  it('a stop line already behind the clock starts nothing at all', async () => {
    const { outcome, starts } = await driveSlowMission({ stopStartingAtMs: T0, hardLimitAtMs: T0 + 40 * 60_000 });
    expect(starts).toEqual([]);
    expect(outcome.state).toBe('FAILED');
  });
});

describe('F3: the entrypoint derives the stop line from the job stamp and the workers, prints it, and enforces it', () => {
  const workers = [architectWorker({}), CODER_WORKER, REVIEWER_WORKER];

  it('stop line = stamp + JOB_BUDGET_MS - the stamp lag - the reserve after LIVE - the longest hold bound', () => {
    const longest = Math.max(...workers.map((worker) => juliusLeaseHoldBoundMs(workers, worker, JULIUS_LIVE_LEASE_SETTLEMENT_ALLOWANCE_MS)));
    const started = Date.parse('2026-10-13T12:00:00Z');
    expect(liveStageDeadline({ jobStartedAt: '2026-10-13T12:00:00Z', workers })).toEqual({
      hardLimitAtMs: started + JOB_BUDGET_MS - JULIUS_JOB_STAMP_LAG_RESERVE_MS,
      stopStartingAtMs: started + JOB_BUDGET_MS - JULIUS_JOB_STAMP_LAG_RESERVE_MS - JULIUS_RESERVE_AFTER_LIVE_MS - longest,
      longestStageMs: longest, reserveAfterLiveMs: JULIUS_RESERVE_AFTER_LIVE_MS,
    });
    for (const unrecorded of [undefined, '', 'not a time']) expect(liveStageDeadline({ jobStartedAt: unrecorded, workers })).toBeNull();
  });

  it('the entrypoint passes the deadline to the drive and prints the line, which the evidence allowlist keeps', () => {
    const entry = readFileSync(join(ROOT, 'relay-bridge/julius-live-mission.ts'), 'utf8');
    const drive = entry.indexOf('const outcome = await driveJuliusRunToTerminal({');
    expect(entry.indexOf('liveStageDeadline({ jobStartedAt: env.JULIUS_JOB_STARTED_AT'), 'derived before the drive').toBeLessThan(drive);
    expect(entry.slice(drive, entry.indexOf('});', drive))).toContain('deadline: stageDeadline');
    expect(entry.indexOf('recordJuliusLearningOutcome({'), 'the learning record still follows the drive').toBeGreaterThan(drive);

    const lines = [
      liveStageDeadlineLine(liveStageDeadline({ jobStartedAt: '2026-10-13T12:00:00Z', workers })),
      liveStageDeadlineLine(null),
    ];
    const filtered = spawnSync(process.execPath, [join(ROOT, 'scripts/julius-live-evidence.mjs'), '-'], { input: `${lines.join('\n')}\n`, encoding: 'utf8' });
    expect(filtered.status, filtered.stderr).toBe(0);
    for (const line of lines) expect(filtered.stdout.split('\n'), line).toContain(line);
  });
});
