import { describe, expect, it } from 'vitest';

import { cardPolicy, createJuliusHarness, task, verificationPolicy, worker, type JuliusHarness } from './julius-runtime-fixtures';
import { juliusDecisionEventId } from './julius-events';
import { lockJuliusTaskContract, seedJuliusTaskContract } from './julius-task-contract';
import type { JuliusRunRow } from './julius-runtime-ports';

/**
 * THE RUN THAT COULD NOT EXPLAIN ITS OWN DECISION.
 *
 * Reproduced on trusted main `3203b6d7` before it was fixed: drive a mission
 * to the window the resume sweep exists for — reviewed work whose decision was
 * never written — then let the resumed verification die the instant after its
 * decision landed. The decision stood. The release stood. The five events that
 * explained them were gone, and the next resume wrote nothing at all, because
 * the sweep skips a task that already has a decision.
 *
 * This drives the same shape through the real pipeline and asks the ledger to
 * account for what the decision did.
 */

const RUN: JuliusRunRow = {
  runId: 'run-1', missionId: 'msn-1', projectId: 'prj-1', state: 'READY',
  cardRevision: 'card-r1', missionContractRevision: 7, projectBrainRevision: 3, version: 1,
};
const capabilityFor = (item: { role: string }) =>
  (item.role === 'PROMPT_ARCHITECT' ? 'plan' : item.role === 'INDEPENDENT_REVIEWER' ? 'review' : 'implement');
const PASSED_REVIEW = [{ type: 'REVIEW_FINDING', status: 'PASSED', safeSummary: 'No blocking findings.' }];
const PLAN_EVIDENCE = [{ type: 'ARTIFACT', status: 'PASSED', safeSummary: 'Plan written.' }];
const TEST_PASSED = [{ type: 'TEST', status: 'PASSED', safeSummary: 'Suite green.' }];

class ProcessDeath extends Error {}

const lockedContract = () => {
  const seeded = seedJuliusTaskContract({
    runId: 'run-1', taskId: 'build-1', missionContractRevision: 1,
    objective: 'Normalize.', requirements: ['slug'], constraints: [],
    acceptanceCriteria: [{ id: 'criterion-1', text: 'the slug test passes', blocking: true }],
    filesInScope: ['src/a.ts'], filesOutOfScope: [], spendUsd: 20, repairCycles: 3, requiredEvidence: ['TEST'],
  });
  if (!seeded.seeded) throw new Error(seeded.reasonCode);
  const locked = lockJuliusTaskContract({ contract: seeded.contract, verdict: { verdict: 'ACCEPT', evaluatorId: 'f' }, lockedAt: '2026-09-16T00:00:00.000Z' });
  if (locked.outcome !== 'LOCKED') throw new Error('not lockable');
  return locked.contract;
};

/** Kills the process on the next decision write, or on the first event written after one. */
const brittle = (
  store: JuliusHarness['store'],
  deaths: { beforeDecision: number; afterDecision: number; armed: boolean; separateAppends: string[] },
): JuliusHarness['store'] => new Proxy(store, {
  get(target, property, receiver) {
    const value = Reflect.get(target, property, receiver) as unknown;
    if (typeof value !== 'function') return value;
    if (property === 'appendDecision') {
      return (...args: unknown[]) => {
        if (deaths.beforeDecision > 0) { deaths.beforeDecision -= 1; throw new ProcessDeath('died before the decision landed'); }
        const outcome = (value as (...rest: unknown[]) => unknown).apply(target, args);
        if (deaths.afterDecision > 0) { deaths.afterDecision -= 1; deaths.armed = true; }
        return outcome;
      };
    }
    if (property === 'appendEvent') {
      return (...args: unknown[]) => {
        deaths.separateAppends.push((args[0] as { type: string }).type);
        if (deaths.armed) { deaths.armed = false; throw new ProcessDeath('died just after the decision landed'); }
        return (value as (...rest: unknown[]) => unknown).apply(target, args);
      };
    }
    return value;
  },
}) as JuliusHarness['store'];

const build = (store?: JuliusHarness['store']): JuliusHarness => {
  const harness = createJuliusHarness({
    workers: [
      { worker: worker({ workerId: 'architect', role: 'PROMPT_ARCHITECT', providerId: 'openai', adapterId: 'architect-adapter', capabilities: ['plan'], taskTypes: ['plan'] }), script: [{ kind: 'succeed', evidence: PLAN_EVIDENCE }] },
      { worker: worker({ workerId: 'coder', role: 'CODING_AGENT', providerId: 'anthropic', adapterId: 'coder-adapter', capabilities: ['implement'], taskTypes: ['build', 'repair:build'] }), script: [{ kind: 'succeed', evidence: TEST_PASSED }] },
      { worker: worker({ workerId: 'reviewer', role: 'INDEPENDENT_REVIEWER', providerId: 'hermes', adapterId: 'reviewer-adapter', capabilities: ['review'], taskTypes: ['review:plan', 'review:build', 'review:repair:build'] }), script: [{ kind: 'succeed', evidence: PASSED_REVIEW, answerFindings: 'RESOLVED' }] },
    ],
    card: cardPolicy({ allowedProviders: ['openai', 'anthropic', 'hermes'], capabilities: ['plan', 'implement', 'review'] }),
    verification: verificationPolicy({ reviewerRequired: true, maxRepairRounds: 2 }),
    capabilityFor,
    ...(store === undefined ? {} : { store }),
  });
  if (store === undefined) {
    harness.store.seedRun(RUN);
    void harness.store.putTaskContract({ projectId: 'prj-1', contract: lockedContract(), occurredAt: '2026-09-16T00:00:00.000Z' });
    harness.store.seedTask('run-1', task({ taskId: 'plan-1', ordinal: 0, role: 'PROMPT_ARCHITECT', taskType: 'plan', requiredEvidenceTypes: ['ARTIFACT'] }));
    harness.store.seedTask('run-1', task({ taskId: 'build-1', ordinal: 1, role: 'CODING_AGENT', taskType: 'build', state: 'BLOCKED', dependencyIds: ['plan-1'], requiredEvidenceTypes: ['TEST'] }));
    harness.store.seedCriteria('run-1', [{ criterionId: 'ac-1', description: 'The slug test passes.', requiredEvidenceTypes: ['TEST'] }]);
  }
  return harness;
};

/** Leaves the run exactly where a crash between a result and its decision does. */
const strandedRun = async (deaths: { beforeDecision: number; afterDecision: number; armed: boolean; separateAppends: string[] }): Promise<JuliusHarness['store']> => {
  const origin = build();
  const store = origin.store;
  deaths.beforeDecision = 99;
  const crashing = build(brittle(store, deaths));
  for (let index = 0; index < 8; index += 1) {
    await crashing.loop.tick({ projectId: 'prj-1' }).catch((error: unknown) => {
      if (!(error instanceof ProcessDeath)) throw error;
    });
  }
  deaths.beforeDecision = 0;
  return store;
};

describe('a resumed verification explains itself in the same write', () => {
  it('records the decision and its history together, even when the process dies the instant after', async () => {
    const deaths = { beforeDecision: 0, afterDecision: 0, armed: false, separateAppends: [] as string[] };
    const store = await strandedRun(deaths);
    expect(await store.decisionsForRun('run-1', 'prj-1'), 'the run should be stranded with no decision').toHaveLength(0);

    // The resume dies on the first event it writes OUTSIDE the decision.
    deaths.afterDecision = 1;
    const resumed = build(brittle(store, deaths));
    resumed.clock.advance(60_000);
    await resumed.loop.advanceRun('run-1', 'prj-1').catch((error: unknown) => {
      if (!(error instanceof ProcessDeath)) throw error;
    });

    const decisions = await store.decisionsForRun('run-1', 'prj-1');
    expect(decisions, 'the resume should have decided the stranded work').toHaveLength(1);

    // THE POINT. The decision is recorded, so the ledger must be able to say so
    // — and must say what it released.
    const events = store.events();
    expect(events.filter((event) => event.type === 'verification.decided' && event.taskId === 'plan-1'),
      'the decision stands and the history cannot say it was decided').toHaveLength(1);
    expect(events.filter((event) => event.type === 'task.runnable' && event.taskId === 'build-1'),
      'the build became claimable and the history cannot say so').toHaveLength(1);
    const released = (await store.tasksForRun('run-1', 'prj-1')).find((row) => row.taskId === 'build-1');
    expect(released?.state, 'the release itself').toBe('RUNNABLE');
  });

  it('writes that history through the decision, not as separate appends after it', async () => {
    const deaths = { beforeDecision: 0, afterDecision: 0, armed: false, separateAppends: [] as string[] };
    const store = await strandedRun(deaths);

    deaths.separateAppends.length = 0;
    const resumed = build(brittle(store, deaths));
    resumed.clock.advance(60_000);
    await resumed.loop.advanceRun('run-1', 'prj-1');

    // If either type appears here, it was appended on its own — which is the
    // window a crash used to fall into.
    expect(deaths.separateAppends.filter((type) => type === 'verification.decided' || type === 'task.runnable'),
      'a decision event was appended outside the decision write').toHaveLength(0);
    expect(store.events().some((event) => event.type === 'verification.decided'), 'but it is in the ledger').toBe(true);
  });

  /**
   * WHY THE NAME IS NOT DECORATION.
   *
   * A reader holding a decision row can compute the id of the event that must
   * explain it and go and look for it. With a minted `${kind}:${randomUUID()}`
   * there is no question to ask: the id is a fact about the process that
   * happened to write it, so an auditor can only search by shape and hope. An
   * unexplained decision is exactly the state this change makes impossible, so
   * being able to ASK is what makes it checkable rather than merely intended.
   */
  it('lets a reader find the event that explains a decision, from the decision alone', async () => {
    const deaths = { beforeDecision: 0, afterDecision: 0, armed: false, separateAppends: [] as string[] };
    const store = await strandedRun(deaths);
    const resumed = build(store);
    resumed.clock.advance(60_000);
    await resumed.loop.advanceRun('run-1', 'prj-1');

    const [decision] = await store.decisionsForRun('run-1', 'prj-1');
    expect(decision).toBeDefined();
    // The key the store deduped the decision on, rebuilt from the durable row.
    const key = `${decision!.taskId}:${decision!.action}:${decision!.reasonCode}`;
    const expected = juliusDecisionEventId(key, 'verification.decided', 0);
    expect(store.events().find((event) => event.eventId === expected),
      'the decision names its own explanation, and the ledger holds it under that name').toBeDefined();

    const released = juliusDecisionEventId(key, 'task.runnable', 0);
    expect(store.events().find((event) => event.eventId === released),
      'and names what it released').toBeDefined();
  });

  it('replays a decision without writing its history twice', async () => {
    const deaths = { beforeDecision: 0, afterDecision: 0, armed: false, separateAppends: [] as string[] };
    const store = await strandedRun(deaths);

    for (let pass = 0; pass < 3; pass += 1) {
      const resumed = build(store);
      resumed.clock.advance(60_000);
      await resumed.loop.advanceRun('run-1', 'prj-1');
    }

    expect(await store.decisionsForRun('run-1', 'prj-1'), 'one decision').toHaveLength(1);
    expect(store.events().filter((event) => event.type === 'verification.decided' && event.taskId === 'plan-1'),
      'one announcement of it').toHaveLength(1);
    expect(store.events().filter((event) => event.type === 'task.runnable' && event.taskId === 'build-1'),
      'one announcement of the release').toHaveLength(1);
  });
});

describe('one decision that releases two tasks', () => {
  /**
   * The ordinal is what keeps two events of the same type, written by one
   * decision, apart. Without it both releases would be named identically:
   * the second write would either be swallowed as a replay or refused as a
   * conflict, and a task that became claimable would go unrecorded.
   */
  it('announces both, under names of their own', async () => {
    const harness = build();
    harness.store.seedTask('run-1', task({
      taskId: 'build-2', ordinal: 2, role: 'CODING_AGENT', taskType: 'build',
      state: 'BLOCKED', dependencyIds: ['plan-1'], requiredEvidenceTypes: ['TEST'],
    }));

    for (let index = 0; index < 40; index += 1) {
      const report = await harness.loop.tick({ projectId: 'prj-1' });
      if (report.claimed === 0) {
        const advance = await harness.loop.advanceRun('run-1', 'prj-1');
        if (advance === null || (!advance.changed && advance.resumedVerifications === 0)) break;
      }
    }

    const announced = harness.store.events()
      .filter((event) => event.type === 'task.runnable' && event.facts.unblockedBy === 'plan-1');
    expect(announced.map((event) => event.taskId).sort(), 'both releases are in the ledger')
      .toEqual(['build-1', 'build-2']);
    expect(new Set(announced.map((event) => event.eventId)).size, 'under two different names')
      .toBe(2);
  });
});

describe('a run that FAILED is finished too', () => {
  /**
   * THE LIVELOCK THIS CLOSES, REPRODUCED.
   *
   * A review whose dispatch fails leaves the work SUCCEEDED and undecided
   * forever: no review can conclude now. The stranded sweep found it on every
   * pass and wrote another `review.started` each time — 80 of them under 80
   * different ids in the probe that found this, growing a finished run's
   * ledger without bound for as long as anything advanced it.
   *
   * COMPLETED is the easy half of terminal. This is the half that mattered.
   */
  it('is never swept again, and its ledger stops growing', async () => {
    const harness = createJuliusHarness({
      workers: [
        { worker: worker({ workerId: 'architect', role: 'PROMPT_ARCHITECT', providerId: 'openai', adapterId: 'architect-adapter', capabilities: ['plan'], taskTypes: ['plan'] }), script: [{ kind: 'succeed', evidence: PLAN_EVIDENCE }] },
        { worker: worker({ workerId: 'coder', role: 'CODING_AGENT', providerId: 'anthropic', adapterId: 'coder-adapter', capabilities: ['implement'], taskTypes: ['build', 'repair:build'] }), script: [{ kind: 'succeed', evidence: TEST_PASSED }] },
        {
          worker: worker({ workerId: 'reviewer', role: 'INDEPENDENT_REVIEWER', providerId: 'hermes', adapterId: 'reviewer-adapter', capabilities: ['review'], taskTypes: ['review:plan', 'review:build', 'review:repair:build'] }),
          script: [{ kind: 'fail', code: 'PROVIDER_UNAVAILABLE', runtimeStarted: false }],
        },
      ],
      card: cardPolicy({ allowedProviders: ['openai', 'anthropic', 'hermes'], capabilities: ['plan', 'implement', 'review'] }),
      verification: verificationPolicy({ reviewerRequired: true, maxRepairRounds: 2 }),
      capabilityFor,
    });
    harness.store.seedRun(RUN);
    void harness.store.putTaskContract({ projectId: 'prj-1', contract: lockedContract(), occurredAt: '2026-09-16T00:00:00.000Z' });
    harness.store.seedTask('run-1', task({ taskId: 'plan-1', ordinal: 0, role: 'PROMPT_ARCHITECT', taskType: 'plan', requiredEvidenceTypes: ['ARTIFACT'] }));
    harness.store.seedCriteria('run-1', [{ criterionId: 'ac-1', description: 'The slug test passes.', requiredEvidenceTypes: ['TEST'] }]);

    for (let index = 0; index < 6; index += 1) await harness.loop.tick({ projectId: 'prj-1' });
    const run = await harness.store.loadRun('run-1', 'prj-1');
    expect(run?.state, 'a review that cannot run fails the mission').toBe('FAILED');

    const before = harness.store.events().length;
    for (let index = 0; index < 10; index += 1) {
      const advance = await harness.loop.advanceRun('run-1', 'prj-1');
      expect(advance?.reasonCode).toBe('RUN_TERMINAL');
      expect(advance?.resumedVerifications, 'nothing a failed run owes can still be paid').toBe(0);
    }
    expect(harness.store.events().length - before, 'ten advances of a failed run wrote nothing').toBe(0);
  });
});

describe('a finished run is finished', () => {
  it('advancing a terminal run resumes nothing and writes nothing', async () => {
    const harness = build();
    for (let index = 0; index < 40; index += 1) {
      const report = await harness.loop.tick({ projectId: 'prj-1' });
      if (report.claimed === 0) {
        const advance = await harness.loop.advanceRun('run-1', 'prj-1');
        if (advance === null || (!advance.changed && advance.resumedVerifications === 0)) break;
      }
    }
    const run = await harness.store.loadRun('run-1', 'prj-1');
    expect(run?.state, 'the mission should have finished').toBe('COMPLETED');

    const before = harness.store.events().length;
    for (let index = 0; index < 5; index += 1) {
      const advance = await harness.loop.advanceRun('run-1', 'prj-1');
      expect(advance?.resumedVerifications, 'a finished run owes no verification').toBe(0);
      expect(advance?.changed).toBe(false);
      expect(advance?.reasonCode).toBe('RUN_TERMINAL');
    }
    expect(harness.store.events().length, 'a finished run must not grow a ledger').toBe(before);
  });
});
