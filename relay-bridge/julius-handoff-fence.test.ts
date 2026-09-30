/**
 * (a2) THE HANDOFF IS FENCED BY THE LEASE, through the live composition and the memory store.
 *
 * A recovery that takes a task between its admission and `worker.dispatched` used to leave the old
 * attempt free to write the handoff and call the provider anyway, while the recovered task went
 * back to the queue: the same work could be bought twice, and a reservation released on recovery
 * could have been paid for. The handoff is now written only while the attempt owns the task.
 */

import { describe, expect, it } from 'vitest';
import {
  createJuliusMemoryStore,
  juliusPacketTextIn,
  scriptedAdapter,
  seedJuliusTaskContract,
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

const RUN = 'run:handoff-fence-1';
const PROJECT = 'prj-handoff-fence';
const MISSION = 'mission-handoff-fence';
const CARD = 'card-handoff-fence';
const PLAN = `${RUN}:plan-1`;
const REVIEWER_WORKER = reviewerWorker('hermes');

type Memory = ReturnType<typeof createJuliusMemoryStore>;
type Store = JuliusRuntimeStore & JuliusRecoveryDriver;

function seed(store: Memory): void {
  store.seedRun({
    runId: RUN, missionId: MISSION, projectId: PROJECT, state: 'READY',
    cardRevision: CARD, missionContractRevision: 1, projectBrainRevision: 0, version: 1,
  });
  store.seedTask(RUN, {
    taskId: PLAN, missionId: MISSION, parentTaskId: null, dependencyIds: [],
    requiredEvidenceTypes: ['ARTIFACT'], taskType: 'plan', role: 'PROMPT_ARCHITECT', ordinal: 0, state: 'RUNNABLE',
  });
  store.seedTask(RUN, {
    taskId: `${RUN}:build-1`, missionId: MISSION, parentTaskId: null, dependencyIds: [PLAN],
    requiredEvidenceTypes: ['TEST'], taskType: 'build', role: 'CODING_AGENT', ordinal: 1, state: 'BLOCKED',
  });
  const seeded = seedJuliusTaskContract({
    runId: RUN, taskId: `${RUN}:build-1`, missionContractRevision: 1,
    objective: 'Finish a small mission whose handoff is fenced.',
    requirements: ['Do the work.'], constraints: ['Touch only the module.'],
    acceptanceCriteria: [{ id: 'AC-1', text: 'The suite passes.', blocking: true }],
    filesInScope: [], filesOutOfScope: [], spendUsd: 10, repairCycles: 1, requiredEvidence: ['TEST'],
  });
  if (!seeded.seeded) throw new Error(`fixture contract not derivable: ${seeded.reasonCode}`);
  void store.putTaskContract({ projectId: PROJECT, contract: seeded.contract, occurredAt: '2026-09-29T00:00:00.000Z' });
  store.seedCriteria(RUN, [{ criterionId: 'AC-1', description: 'The suite passes.', requiredEvidenceTypes: [] }]);
  store.seedBrain(RUN, [{
    entryId: `${RUN}:brain-objective`, kind: 'OBJECTIVE', text: 'OBJECTIVE: finish a small mission.',
    taskIds: [], allowedRoles: ['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER'], sensitivity: 'INTERNAL',
  }]);
}

function stage(wrap?: (store: Store, memory: Memory) => Store) {
  const memory = createJuliusMemoryStore();
  seed(memory);
  const handoffs = createContextAndClaimHandoffs(memory as unknown as Store).store;
  const store = wrap === undefined ? handoffs : wrap(handoffs, memory);
  const architect = scriptedAdapter(architectWorker({}), [{ kind: 'succeed', evidence: [{ type: 'ARTIFACT', status: 'PASSED', safeSummary: 'Plan written.' }], usdMicros: null }]);
  const coder = scriptedAdapter(CODER_WORKER, [{ kind: 'succeed', evidence: [{ type: 'TEST', status: 'PASSED', safeSummary: 'Suite green.' }], usdMicros: 1_000_000 }]);
  const reviewer = scriptedAdapter(REVIEWER_WORKER,
    [{ kind: 'succeed', evidence: [{ type: 'REVIEW_FINDING', status: 'PASSED', safeSummary: 'No blocking findings.' }], usdMicros: null, answerFindings: 'RESOLVED' }],
    { packetFor: juliusPacketTextIn(memory) });
  const runtime = assembleLiveJuliusRuntime({
    store,
    entries: [
      { worker: architectWorker({}), adapter: architect },
      { worker: CODER_WORKER, adapter: coder },
      { worker: REVIEWER_WORKER, adapter: reviewer },
    ],
    cardRevision: CARD, spendCeilingUsdMicros: 20_000_000, maxRepairRounds: 1,
  });
  return {
    memory, store,
    tick: () => runtime.loop.tick({ projectId: PROJECT }),
    drive: () => driveJuliusRunToTerminal({ loop: runtime.loop, store, runId: RUN, projectId: PROJECT, verification: runtime.verification }),
    dispatches: () => architect.dispatches.length + coder.dispatches.length + reviewer.dispatches.length,
  };
}


describe('(a2) a recovery that took the task before its handoff stops the old attempt', () => {
  it('the refused handoff dispatches nothing, releases the hold, and the recovered task still completes', async () => {
    let stolen = false;
    const s = stage((store, memory) => ({
      ...store,
      async appendHandoffEvent(input) {
        if (!stolen) {
          stolen = true;
          // A recovery requeues the task: the lease this attempt holds is gone before it can hand off.
          const now = new Date().toISOString();
          expect(await memory.finishTask({ taskId: input.event.taskId!, owner: input.owner, leaseGeneration: input.leaseGeneration, state: 'FAILED', now, nextAttemptAt: now })).toBe(true);
        }
        return store.appendHandoffEvent!(input);
      },
    } as Store));
    await s.tick();
    expect(s.dispatches(), 'the attempt that lost its task called no provider').toBe(0);
    const events = s.memory.events();
    expect(events.filter((event) => event.type === 'worker.dispatched'), 'and no handoff was recorded').toEqual([]);
    const settled = events.filter((event) => event.type === 'budget.settled');
    expect(settled.map((event) => event.facts.released), 'its hold was released as spending nothing').toEqual([true]);
    expect((await s.drive()).state, 'the recovered task runs on a fresh claim, once').toBe('COMPLETED');
  });
});
