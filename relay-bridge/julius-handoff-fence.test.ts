/**
 * (a2) THE HANDOFF IS FENCED BY THE LEASE, through the live composition and the memory store.
 *
 * A recovery that takes a task between its admission and `worker.dispatched` used to leave the old
 * attempt free to write the handoff and call the provider anyway, while the recovered task went
 * back to the queue: the same work could be bought twice, and a reservation released on recovery
 * could have been paid for. The handoff is now written only while the attempt owns the task.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

/**
 * THE MEMORY FENCE READS THE LEASE, NOT ONLY THE STATE (the review of fd588ed4, finding 6).
 *
 * The case above takes the task out of ACTIVE, so a fence that checked the state alone passed it,
 * and one that ignored the generation passed it too. Production's owner is ONE constant name for
 * every process (`julius-live-mission`), so the generation is the only thing that tells two claims
 * of the same task apart. And the check and the write are one synchronous step: a sweep called on
 * the very next line already sees the handoff.
 */
describe('(a2) the memory fence reads the owner and the generation, atomically', () => {
  const OWNER = 'julius-live-mission';
  const handoffEvent = (id: string) => ({
    eventId: `event:worker.dispatched:${id}`, runId: RUN, projectId: PROJECT, type: 'worker.dispatched' as const,
    taskId: PLAN, workerId: 'architect-openai', correlationId: RUN, causationId: null,
    occurredAt: '2026-09-29T12:00:00.000Z', facts: { workerId: 'architect-openai', attempt: 1, runId: RUN },
  });
  const claimedBy = async (memory: Memory, owner: string, leaseMs = 60_000) => {
    const now = new Date().toISOString();
    const [claim] = await memory.claimRunnable({ owner, now, leaseExpiresAt: new Date(Date.now() + leaseMs).toISOString(), limit: 1, projectId: PROJECT });
    expect(claim?.taskId).toBe(PLAN);
    return claim!;
  };
  const handoffs = (memory: Memory) => memory.events().filter((event) => event.type === 'worker.dispatched');

  it('RE-CLAIMED under the SAME owner name: the old generation’s handoff is refused and writes nothing; the new one’s is recorded', async () => {
    const memory = createJuliusMemoryStore();
    seed(memory);
    const first = await claimedBy(memory, OWNER);
    const now = new Date().toISOString();
    expect(await memory.finishTask({ taskId: PLAN, owner: OWNER, leaseGeneration: first.leaseGeneration, state: 'FAILED', now, nextAttemptAt: now })).toBe(true);
    const again = await claimedBy(memory, OWNER);
    expect(again.leaseGeneration, 'ACTIVE again, under a newer generation').toBe(first.leaseGeneration + 1);

    expect(await memory.appendHandoffEvent!({ event: handoffEvent('old'), owner: OWNER, leaseGeneration: first.leaseGeneration })).toBe('LEASE_LOST');
    expect(handoffs(memory), 'the old generation wrote nothing').toEqual([]);
    expect(await memory.appendHandoffEvent!({ event: handoffEvent('new'), owner: OWNER, leaseGeneration: again.leaseGeneration })).toBe('RECORDED');
  });

  it('ANOTHER owner naming the right generation is refused', async () => {
    const memory = createJuliusMemoryStore();
    seed(memory);
    const claim = await claimedBy(memory, 'owner-a');
    expect(await memory.appendHandoffEvent!({ event: handoffEvent('b'), owner: 'owner-b', leaseGeneration: claim.leaseGeneration })).toBe('LEASE_LOST');
    expect(handoffs(memory)).toEqual([]);
  });

  it('the check and the write are one step: a sweep on the very next line reads the task handed, never requeues it', async () => {
    const memory = createJuliusMemoryStore();
    seed(memory);
    const claim = await claimedBy(memory, OWNER, -1_000); // a lease already lapsed, not yet swept
    // Admitted, as every handoff is: the attempt the handoff names (1) is the one the task is on.
    expect(await memory.admitTask({ taskId: PLAN, owner: OWNER, leaseGeneration: claim.leaseGeneration, now: new Date().toISOString() })).toBe(1);
    const fenced = memory.appendHandoffEvent!({ event: handoffEvent('racing'), owner: OWNER, leaseGeneration: claim.leaseGeneration });
    const actions = await memory.recoverExpired(new Date(Date.now() + 1_000).toISOString(), 10, PROJECT);
    expect(await fenced).toBe('RECORDED');
    expect(actions.map((action) => action.reasonCode), 'handed when the sweep looked, so never bought twice').toEqual(['HANDED_OUTCOME_UNKNOWN']);
  });
});

/**
 * WHAT THE POSTGRESQL FENCE RESTS ON, PINNED OFFLINE (the review of fd588ed4, finding 5). No
 * real-PostgreSQL case can see either property fail:
 *   (a) the FOR SHARE read and the insert share ONE serializable transaction. Split them, and a
 *       recovery can requeue between the check's commit and the insert, and the task is bought twice;
 *   (b) recovery runs SERIALIZABLE. One interleaving (recovery's snapshot before the fence commits,
 *       its row lock after) is resolved only by SSI; under READ COMMITTED it requeues a handed task.
 * So the source itself is held: each method is one `juliusSerializable` body, and every statement in
 * it runs on that transaction's client.
 */
describe('(a2) the PostgreSQL fence and sweep are each one serializable transaction (source pins)', () => {
  const source = (...path: string[]) => readFileSync(join(__dirname, '..', ...path), 'utf8');

  it('(a) the fence reads the task FOR SHARE and inserts the handoff inside one juliusSerializable body', () => {
    const text = source('src', 'relay', 'persistence', 'julius-event-postgres.ts');
    const body = text.split('\n').find((line) => line.includes('async appendHandoff('));
    expect(body, 'appendHandoff is found').toBeDefined();
    expect(body!.match(/juliusSerializable\(/gu), 'exactly one transaction').toHaveLength(1);
    expect(body).toMatch(/juliusSerializable\(this\.pool,async\(client\)=>\{const held=await client\.query\(`SELECT 1 FROM relay_wonderland\.julius_tasks WHERE [^`]*FOR SHARE`/u);
    expect(body).toContain('appendJuliusEventWithin(client,input.event)');
    expect(body, 'no statement outside it').not.toMatch(/this\.pool\.(query|connect)/u);
  });

  it('(b) recovery sweeps, and closes what it recovers, inside one juliusSerializable body', () => {
    const text = source('src', 'relay', 'persistence', 'julius-recovery-postgres.ts');
    const start = text.indexOf('async recoverExpired(');
    expect(start, 'recoverExpired is found').toBeGreaterThanOrEqual(0);
    const body = text.slice(start, text.indexOf('\n  }\n', start));
    expect(body).toMatch(/\n    return juliusSerializable\(this\.pool, async \(client\) => \{/u);
    expect(body.match(/juliusSerializable\(/gu), 'exactly one transaction').toHaveLength(1);
    expect(body).toContain('FOR UPDATE OF t SKIP LOCKED');
    expect(body).toContain('await closeRecoveredReservations(client, candidate, now)');
    expect(body, 'no statement outside it').not.toMatch(/this\.pool\.(query|connect)/u);
  });
});
