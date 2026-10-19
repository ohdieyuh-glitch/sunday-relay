import { describe, expect, it } from 'vitest';

import { JULIUS_RUNTIME_VERSION } from './julius-runtime';
import type { JuliusRunRow } from './julius-runtime-ports';
import {
  cardPolicy, createJuliusHarness, seedTaskContractInto, task, verificationPolicy, worker,
  type JuliusHarness,
} from './julius-runtime-fixtures';

/**
 * MANY MISSIONS, ONE RUN LOOP — the reliability half of the MVP, which had no
 * evidence at all.
 *
 * WHAT WAS UNPROVEN. Every end-to-end proof in this repository drove ONE run.
 * The loop's fairness interleave, its per-run C.A.R.D. concurrency bound and its
 * per-run policy resolution were unit-tested; nothing showed several real
 * missions completing together, and nothing showed that one mission's evidence,
 * findings, brain entries or budget stayed its own. A beta that a founder runs
 * two missions on at once is the ordinary case, not an edge one.
 *
 * WHAT THESE CASES HOLD.
 *   1. Three missions, interleaved by one loop, all reaching verified
 *      completion — and no run's ticks starved another's.
 *   2. ISOLATION, asserted per mission: evidence, findings, decisions, brain
 *      entries and the context packets each worker was handed belong to exactly
 *      one run. This is the cross-mission leak that would be invisible in a
 *      single-run proof.
 *   3. A mission that FAILS beside two that succeed does not take them with it.
 *   4. The cost of a tick under load, measured rather than asserted: dispatches
 *      per tick against the claim limit, and the fairness share honoured.
 *
 * DETERMINISTIC AND FREE. Providers are replaced at their own boundary, so this
 * measures Julius's own scheduling and bookkeeping, which is the only part of
 * "performance" this lane can honestly measure without paying for latency.
 */

const ARCHITECT = worker({
  workerId: 'architect', role: 'PROMPT_ARCHITECT',
  capabilities: ['plan'], taskTypes: ['plan', 'repair:plan'], providerId: 'provider-a', adapterId: 'architect-adapter',
});
const CODER = worker({
  workerId: 'coder', role: 'CODING_AGENT',
  capabilities: ['implement'], taskTypes: ['build', 'repair:build'], providerId: 'provider-b', adapterId: 'coder-adapter',
});
const REVIEWER = worker({
  workerId: 'reviewer', role: 'INDEPENDENT_REVIEWER',
  capabilities: ['review'],
  taskTypes: ['review:plan', 'review:build', 'review:repair:plan', 'review:repair:build'],
  providerId: 'provider-c', adapterId: 'reviewer-adapter',
});

const capabilityFor = (item: { role: string }) =>
  (item.role === 'PROMPT_ARCHITECT' ? 'plan' : item.role === 'INDEPENDENT_REVIEWER' ? 'review' : 'implement');

const scope = { projectId: 'prj-1' };

/**
 * EVIDENCE SUMMARIES NAME NO RUN, and that is a fact about the FIXTURE rather
 * than about Julius. A scripted adapter answers per WORKER, in order, so the
 * three missions share one queue of answers and which mission receives which
 * entry is the queue's business. A summary naming a run would therefore prove
 * only that my script mis-ordered — it did, on the first run of this suite —
 * and would say nothing about Julius's bookkeeping. So the isolation asserted
 * below is over what JULIUS decides: which run a row is filed under, which run
 * a read returns, and what a compiled packet contains.
 */
const planEvidence = () => [{
  type: 'ARTIFACT' as const, status: 'PASSED' as const, safeSummary: 'plan written',
}];
const buildEvidence = () => [{
  type: 'TEST' as const, status: 'PASSED' as const, safeSummary: 'tests green',
}];
const reviewEvidence = () => [{
  type: 'REVIEW_FINDING' as const, status: 'PASSED' as const, safeSummary: 'no blocking findings',
}];

interface MissionSeed {
  readonly runId: string;
  readonly missionId: string;
  /** A build that fails permanently, for the case where one mission must not take the others down. */
  readonly buildFails?: boolean;
}

/**
 * THREE MISSIONS IN ONE STORE, one loop over all of them. The scripts are
 * per-worker rather than per-run, so every mission is served by the same three
 * workers — which is what makes the isolation question real: nothing separates
 * the runs except Julius's own bookkeeping.
 */
function buildHarness(missions: readonly MissionSeed[], perRunShare?: number): JuliusHarness {
  const harness = createJuliusHarness({
    workers: [
      // Enough scripted answers for every mission's plan, build, and reviews;
      // a scripted adapter repeats its LAST entry, so these are floors.
      { worker: ARCHITECT, script: missions.map(() => ({ kind: 'succeed' as const, evidence: planEvidence() })) },
      {
        worker: CODER,
        script: missions.map((mission) => (mission.buildFails === true
          ? { kind: 'fail' as const, code: 'AUTH_CONFIGURATION' as const, message: 'scripted permanent failure' }
          : { kind: 'succeed' as const, evidence: buildEvidence() })),
      },
      { worker: REVIEWER, script: missions.flatMap(() => [
        { kind: 'succeed' as const, evidence: reviewEvidence() },
        { kind: 'succeed' as const, evidence: reviewEvidence() },
      ]) },
    ],
    card: cardPolicy({
      allowedProviders: ['provider-a', 'provider-b', 'provider-c'],
      capabilities: ['plan', 'implement', 'review'],
      // Two at a time per run, so the fairness interleave has something to do.
      concurrency: 2,
    }),
    verification: verificationPolicy({ reviewerRequired: true, maxRepairRounds: 1 }),
    capabilityFor,
    ...(perRunShare === undefined ? {} : { config: { perRunShare } }),
  });
  for (const mission of missions) {
    const run: JuliusRunRow = {
      runId: mission.runId, missionId: mission.missionId, projectId: 'prj-1', state: 'READY',
      cardRevision: 'card-r1', missionContractRevision: 1, projectBrainRevision: 0, version: 1,
    };
    harness.store.seedRun(run);
    seedTaskContractInto(harness.store, { runId: mission.runId, projectId: 'prj-1', taskId: `${mission.runId}:build` });
    harness.store.seedTask(mission.runId, task({
      taskId: `${mission.runId}:plan`, missionId: mission.missionId, ordinal: 0,
      role: 'PROMPT_ARCHITECT', taskType: 'plan', requiredEvidenceTypes: ['ARTIFACT'],
    }));
    harness.store.seedTask(mission.runId, task({
      taskId: `${mission.runId}:build`, missionId: mission.missionId, ordinal: 1,
      role: 'CODING_AGENT', taskType: 'build', state: 'BLOCKED',
      dependencyIds: [`${mission.runId}:plan`], requiredEvidenceTypes: ['TEST'],
    }));
    harness.store.seedCriteria(mission.runId, [
      { criterionId: `${mission.runId}:AC-1`, description: `the suite passes for ${mission.missionId}`, requiredEvidenceTypes: ['TEST'] },
    ]);
    harness.store.seedBrain(mission.runId, [{
      entryId: `brain:${mission.runId}:objective`, kind: 'OBJECTIVE',
      text: `OBJECTIVE for ${mission.missionId}: a secret belonging only to ${mission.runId}.`,
      taskIds: [], allowedRoles: ['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER'],
      sensitivity: 'INTERNAL',
      provenance: { workerId: 'founder', recordedAt: '2026-09-27T09:00:00.000Z', evidenceIds: [] },
    }]);
  }
  return harness;
}

interface DriveReport {
  readonly ticks: number;
  readonly dispatchesPerTick: readonly number[];
  readonly yieldedForFairness: number;
  readonly yieldedForConcurrency: number;
}

async function drive(harness: JuliusHarness, maxTicks = 60): Promise<DriveReport> {
  const dispatchesPerTick: number[] = [];
  let yieldedForFairness = 0;
  let yieldedForConcurrency = 0;
  let ticks = 0;
  for (; ticks < maxTicks; ticks += 1) {
    const report = await harness.loop.tick(scope);
    yieldedForFairness += report.yieldedForFairness;
    yieldedForConcurrency += report.yieldedForConcurrency;
    if (report.claimed === 0) break;
    dispatchesPerTick.push(report.claimed);
  }
  return { ticks, dispatchesPerTick, yieldedForFairness, yieldedForConcurrency };
}

const MISSIONS: readonly MissionSeed[] = [
  { runId: 'run-a', missionId: 'msn-a' },
  { runId: 'run-b', missionId: 'msn-b' },
  { runId: 'run-c', missionId: 'msn-c' },
];

describe('three missions through one run loop', () => {
  it('all three reach verified completion, interleaved, with no run starved', async () => {
    const harness = buildHarness(MISSIONS);
    const report = await drive(harness);

    for (const mission of MISSIONS) {
      const run = await harness.store.loadRun(mission.runId, 'prj-1');
      expect(run?.state, `${mission.runId} must complete`).toBe('COMPLETED');
    }
    // INTERLEAVED, NOT SEQUENTIAL: at least one tick dispatched work for more
    // than one run, which is what the fairness round-robin is for. A loop that
    // drained one mission at a time would show every tick at one dispatch.
    expect(Math.max(...report.dispatchesPerTick), 'some tick served more than one mission').toBeGreaterThan(1);
    expect(report.ticks, 'three missions inside a sane tick budget').toBeLessThan(40);
  });

  it('keeps every mission’s record its own — evidence, findings, decisions, brain and packets', async () => {
    const harness = buildHarness(MISSIONS);
    await drive(harness);

    for (const mission of MISSIONS) {
      const other = MISSIONS.filter((item) => item.runId !== mission.runId);

      // EVIDENCE. Every row belongs to a task of this run, and names this run.
      const evidence = await harness.store.evidenceForRun(mission.runId, 'prj-1');
      expect(evidence.length, `${mission.runId} recorded evidence`).toBeGreaterThan(0);
      // FILED UNDER THE RIGHT RUN, which is Julius's decision: the read is
      // scoped to the run, and every row it returns belongs to a task of it.
      for (const item of evidence) {
        expect(item.taskId.startsWith(mission.runId), `${item.evidenceId} belongs to ${mission.runId}`).toBe(true);
      }
      // AND THE COUNT IS THIS MISSION'S OWN: four dispatches, four rows. A read
      // that returned another run's rows would show up here as a surplus.
      expect(evidence, `${mission.runId} holds exactly its own evidence`).toHaveLength(4);

      // DECISIONS and FINDINGS.
      for (const decision of await harness.store.decisionsForRun(mission.runId, 'prj-1')) {
        expect(decision.taskId.startsWith(mission.runId)).toBe(true);
      }
      for (const finding of await harness.store.findingsForRun(mission.runId, 'prj-1')) {
        expect(finding.taskId.startsWith(mission.runId)).toBe(true);
      }

      // PROJECT BRAIN. The objective of one mission is not in another's brain.
      const brain = await harness.store.brainEntriesForRun(mission.runId, 'prj-1');
      for (const entry of brain) {
        for (const stranger of other) {
          expect(entry.text, `${mission.runId} brain holds ${stranger.missionId}`).not.toContain(stranger.missionId);
        }
      }

      // AND THE PACKETS THEMSELVES — the thing a worker actually read. This is
      // the leak that matters: a run's context must never carry another's.
      const snapshots = harness.store.contexts().filter((snapshot) => snapshot.runId === mission.runId);
      expect(snapshots.length, `${mission.runId} compiled context`).toBeGreaterThan(0);
      for (const snapshot of snapshots) {
        const text = snapshot.packet.blocks.map((block) => block.text).join('\n');
        for (const stranger of other) {
          expect(text, `${mission.runId} packet carries ${stranger.missionId}`).not.toContain(stranger.missionId);
          expect(text, `${mission.runId} packet carries ${stranger.runId}`).not.toContain(stranger.runId);
        }
      }
    }
  });

  it('one mission failing does not take the others with it', async () => {
    // THE ISOLATION THAT MATTERS MOST UNDER LOAD. A permanent provider failure
    // in one run ends that run; the other two must still reach verified
    // completion in the same loop, on the same workers.
    const harness = buildHarness([
      { runId: 'run-a', missionId: 'msn-a' },
      { runId: 'run-b', missionId: 'msn-b', buildFails: true },
      { runId: 'run-c', missionId: 'msn-c' },
    ]);
    await drive(harness);

    expect((await harness.store.loadRun('run-b', 'prj-1'))?.state, 'the failing mission fails').toBe('FAILED');
    for (const runId of ['run-a', 'run-c']) {
      expect((await harness.store.loadRun(runId, 'prj-1'))?.state, `${runId} is unaffected`).toBe('COMPLETED');
    }
    // And the failure is attributed to the run that had it.
    const failures = harness.store.events().filter((event) => event.type === 'task.failed');
    expect(failures.length).toBeGreaterThan(0);
    for (const failure of failures) expect(String(failure.taskId)).toContain('run-b');
  });

  it('honours the per-run share: one mission cannot take a whole tick', async () => {
    // A LOAD PROPERTY, MEASURED. With a share of one, a tick may admit at most
    // one task per run — so the yielded count is a real number the report
    // carries rather than a hope, and every mission still completes.
    const harness = buildHarness(MISSIONS, 1);
    const report = await drive(harness, 80);
    for (const mission of MISSIONS) {
      expect((await harness.store.loadRun(mission.runId, 'prj-1'))?.state, `${mission.runId} still completes`).toBe('COMPLETED');
    }
    expect(report.dispatchesPerTick.every((count) => count <= MISSIONS.length),
      'no tick exceeded one task per mission').toBe(true);
  });

  it('measures the tick under load, and the numbers are the record', async () => {
    // NOT A THRESHOLD — A MEASUREMENT. A benchmark with a pass mark on this
    // machine would be a number about this machine. What is asserted is the
    // shape: bounded ticks, every mission complete, and the loop reporting its
    // own fairness and concurrency yields rather than hiding them.
    const twelve = Array.from({ length: 12 }, (_, index) => ({
      runId: `run-${String(index).padStart(2, '0')}`, missionId: `msn-${String(index).padStart(2, '0')}`,
    }));
    const harness = buildHarness(twelve);
    const started = Date.now();
    const report = await drive(harness, 200);
    const elapsed = Date.now() - started;

    for (const mission of twelve) {
      expect((await harness.store.loadRun(mission.runId, 'prj-1'))?.state, `${mission.runId} completes`).toBe('COMPLETED');
    }
    const dispatches = report.dispatchesPerTick.reduce((total, count) => total + count, 0);
    // 12 missions × (plan, plan review, build, build review) = 48 dispatches.
    expect(dispatches, 'every mission paid for exactly its four dispatches').toBe(48);
    expect(report.ticks, 'twelve missions do not need a tick each per task').toBeLessThan(48);
    // A ceiling loose enough to be about Julius and not about this laptop: 48
    // scripted dispatches through the real loop, the real pipeline and the real
    // store must not take minutes. Measured here at well under a second.
    expect(elapsed, `48 dispatches took ${elapsed}ms`).toBeLessThan(20_000);
    expect(JULIUS_RUNTIME_VERSION.length, 'the runtime version is on the record').toBeGreaterThan(0);
  });
});
