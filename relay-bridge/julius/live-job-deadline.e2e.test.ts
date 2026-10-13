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
  JULIUS_LIVE_RATE_LIMIT_BACKOFF,
  juliusRateLimitBackoffMs,
  JULIUS_RESERVE_AFTER_LIVE_MS,
  liveRunAttemptRefusal,
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
async function driveSlowMission(
  deadline?: { readonly stopStartingAtMs: number; readonly hardLimitAtMs: number },
  options: { readonly rateLimitFirstBuild?: boolean; readonly backoff?: boolean } = {},
) {
  const memory = createJuliusMemoryStore();
  const handoffs = createContextAndClaimHandoffs(memory as unknown as JuliusRuntimeStore & JuliusRecoveryDriver);
  seed(memory);
  let clock = T0;
  const starts: number[] = [];
  const sleeps: number[] = [];
  let rateLimited = options.rateLimitFirstBuild !== true;
  const slow = (worker: JuliusWorker, outcome: ScriptedOutcome): JuliusProviderAdapter => ({
    adapterId: worker.adapterId,
    async dispatch(input) {
      starts.push(clock);
      clock += STAGE_MS;
      if (worker === CODER_WORKER && !rateLimited) {
        rateLimited = true;
        return scriptedAdapter(worker, [{ kind: 'fail', code: 'RATE_LIMIT' }]).dispatch(input);
      }
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
    ...(options.backoff === true ? { retryBackoff: JULIUS_LIVE_RATE_LIMIT_BACKOFF, sleep: async (ms: number) => { sleeps.push(ms); clock += ms; } } : {}),
  });
  const timeline: JuliusTimelineEntry[] = [];
  let sinceSequence = 0;
  for (;;) {
    const page = await memory.timeline({ runId: RUN, projectId: PROJECT, sinceSequence, limit: 500 });
    timeline.push(...page.entries);
    if (page.entries.length === 0 || !page.hasMore) break;
    sinceSequence = Math.max(...page.entries.map((entry) => entry.sequence));
  }
  return { outcome, starts, sleeps, timeline, memory };
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

describe('F4: a GitHub re-run of a paid run stops before the drive, whichever jobs were re-run', () => {
  it('under Actions only attempt "1" proceeds; a later or absent attempt is refused; a local launch is unaffected', () => {
    expect(liveRunAttemptRefusal({ GITHUB_ACTIONS: 'true', GITHUB_RUN_ATTEMPT: '1' })).toBeNull();
    expect(liveRunAttemptRefusal({ GITHUB_ACTIONS: 'true', GITHUB_RUN_ATTEMPT: '2' })).toMatch(/^paid_run_rerun_refused: workflow run attempt 2 is not the first/u);
    expect(liveRunAttemptRefusal({ GITHUB_ACTIONS: 'true' })).toMatch(/^paid_run_rerun_refused: workflow run attempt unknown/u);
    expect(liveRunAttemptRefusal({})).toBeNull();
    expect(liveRunAttemptRefusal({ GITHUB_RUN_ATTEMPT: '2' }), 'off a runner the attempt means nothing').toBeNull();
  });

  it('the entrypoint checks it after the bootstrap and before the runtime and the drive, and says so as a RESULT the allowlist keeps', () => {
    const entry = readFileSync(join(ROOT, 'relay-bridge/julius-live-mission.ts'), 'utf8');
    const check = entry.indexOf('const rerunRefusal = liveRunAttemptRefusal(env);');
    expect(check).toBeGreaterThan(entry.indexOf('const submitted = await bootstrap.submit(request);'));
    expect(check).toBeLessThan(entry.indexOf('const runtime = assembleLiveJuliusRuntime({'));
    expect(check).toBeLessThan(entry.indexOf('const outcome = await driveJuliusRunToTerminal({'));
    const line = `RESULT: BLOCKED — ${liveRunAttemptRefusal({ GITHUB_ACTIONS: 'true', GITHUB_RUN_ATTEMPT: '2' })}`;
    const filtered = spawnSync(process.execPath, [join(ROOT, 'scripts/julius-live-evidence.mjs'), '-'], { input: `${line}\n`, encoding: 'utf8' });
    expect(filtered.stdout.split('\n')).toContain(line);
  });
});

describe('F5: a rate-limited retry waits a bounded backoff, never past the stop line', () => {
  it('the backoff: 15 s, then 30 s, capped at 120 s; a provider Retry-After is honoured within the cap', () => {
    const at = (retries: number, retryAfterMs: number | null = null) => juliusRateLimitBackoffMs({ ...JULIUS_LIVE_RATE_LIMIT_BACKOFF, retries, retryAfterMs });
    expect([at(1), at(2), at(3), at(4), at(5)]).toEqual([15_000, 30_000, 60_000, 120_000, 120_000]);
    expect([at(1, 45_000), at(1, 0), at(2, 10 * 60_000)]).toEqual([45_000, 0, 120_000]);
  });

  it('CONTROL: without the backoff the drive retries at once, as every other caller still does', async () => {
    const { outcome, sleeps } = await driveSlowMission(undefined, { rateLimitFirstBuild: true });
    expect(outcome.state).toBe('COMPLETED');
    expect(sleeps).toEqual([]);
  });

  it('with the backoff the rate-limited build waits 15 s once, then completes', async () => {
    const { outcome, sleeps, starts } = await driveSlowMission(undefined, { rateLimitFirstBuild: true, backoff: true });
    expect(outcome.state).toBe('COMPLETED');
    expect(sleeps).toEqual([15_000]);
    const retried = starts.findIndex((at, index) => index > 0 && at - starts[index - 1]! === STAGE_MS + 15_000);
    expect(retried, 'the retry started one stage plus the backoff after the refused dispatch').toBeGreaterThan(0);
  });

  it('the wait never crosses the stop line: 10 s before it, the drive waits 10 s and the deadline then ends the run', async () => {
    // plan at 0, its review at 25, the rate-limited build at 50 (the clock reads 75 min after it).
    const stop = T0 + 75 * 60_000 + 10_000;
    const { outcome, sleeps } = await driveSlowMission({ stopStartingAtMs: stop, hardLimitAtMs: stop + 40 * 60_000 }, { rateLimitFirstBuild: true, backoff: true });
    expect(sleeps).toEqual([10_000]);
    expect(outcome.state).toBe('FAILED');
    expect(outcome.haltCause).toMatch(/^job_deadline_reached: /u);
  });
});
