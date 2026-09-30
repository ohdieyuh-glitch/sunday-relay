/**
 * DEFECT A: A DECISION READS THE ATTEMPT THAT WAS ACCEPTED, NOT THE ONES BEFORE IT.
 *
 * Evidence reaches a task's rows from outside the lease fence: the tool settlement writes each
 * executor effect's COMMAND row (`tool:<invocation>`, PASSED or FAILED by its exit code) while the
 * attempt runs, and the coordinator persists a result's evidence before the result is accepted. An
 * attempt that then fails, or loses its lease, leaves those rows behind. `verifyTask` read EVERY row
 * on the task, so the next attempt's clean work was sent to a paid REPAIR round over a row that
 * describes a workspace that no longer exists.
 *
 * Every row Julius writes names its attempt: `<task>:<generation>:<n>` (the coordinator),
 * `<task>:<generation>:workspace|scope` (the pipeline) and `tool:…:g<generation>` (the settlement).
 * A task's decision now reads the rows of its latest generation, and keeps any row that names none.
 */

import { describe, expect, it } from 'vitest';
import {
  createJuliusMemoryStore,
  juliusCurrentAttemptEvidence,
  juliusEvidenceGeneration,
  juliusPacketTextIn,
  scriptedAdapter,
  seedJuliusTaskContract,
  type JuliusEvidence,
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

const RUN = 'run:attempt-evidence-1';
const PROJECT = 'prj-attempt-evidence';
const MISSION = 'mission-attempt-evidence';
const CARD = 'card-attempt-evidence';
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
    objective: 'Finish a small mission whose plan was attempted twice.',
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

function stage() {
  const memory = createJuliusMemoryStore();
  seed(memory);
  const store = createContextAndClaimHandoffs(memory as unknown as Store).store;
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
    memory,
    drive: () => driveJuliusRunToTerminal({ loop: runtime.loop, store, runId: RUN, projectId: PROJECT, verification: runtime.verification }),
    dispatches: () => architect.dispatches.length + coder.dispatches.length + reviewer.dispatches.length,
  };
}

/** An earlier process claims the plan, its tool effect settles FAILED under that attempt, and the attempt is handed back. */
async function anEarlierAttemptLeftAFailedRow(memory: Memory): Promise<string> {
  const now = new Date().toISOString();
  const [claimed] = await memory.claimRunnable({ owner: 'an-earlier-process', now, leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(), limit: 1, projectId: PROJECT });
  expect(claimed?.taskId).toBe(PLAN);
  const evidenceId = `tool:${PLAN}:status:g${String(claimed!.leaseGeneration)}`;
  expect(await memory.appendEvidence({
    runId: RUN, projectId: PROJECT, idempotencyKey: `tool-settlement:settlement:${evidenceId}`,
    evidence: {
      evidenceId, missionId: MISSION, taskId: PLAN, workerId: 'prompt-architect-openai', type: 'COMMAND', status: 'FAILED',
      safeSummary: 'Sandbox command failed.', artifactRef: null, integrityHash: null, occurredAt: now,
    },
  })).toBe(true);
  expect(await memory.finishTask({ taskId: PLAN, owner: 'an-earlier-process', leaseGeneration: claimed!.leaseGeneration, state: 'FAILED', now, nextAttemptAt: now })).toBe(true);
  return evidenceId;
}

describe('defect A: a decision reads the attempt that was accepted', () => {
  it('RED FIRST: an earlier attempt\'s FAILED tool row does not send the accepted plan to a paid repair', async () => {
    const twin = stage();
    expect((await twin.drive()).state).toBe('COMPLETED');

    const s = stage();
    const stale = await anEarlierAttemptLeftAFailedRow(s.memory);
    expect((await s.drive()).state).toBe('COMPLETED');
    const decisions = await s.memory.decisionsForRun(RUN, PROJECT);
    const planDecisions = decisions.filter((decision) => decision.taskId === PLAN);
    expect(planDecisions.map((decision) => decision.action), 'the plan was accepted on its own attempt').toEqual(['ACCEPT']);
    expect(planDecisions[0]!.evidenceIds, 'and the decision does not cite the earlier attempt').not.toContain(stale);
    const tasks = await s.memory.tasksForRun(RUN, PROJECT);
    expect(tasks.some((task) => task.taskType.startsWith('repair:')), 'no repair round was bought').toBe(false);
    expect(s.dispatches(), 'the same dispatches as a mission nothing interrupted').toBe(twin.dispatches());
  });

  it('CONTROL: a FAILED row from the ACCEPTED attempt itself still sends the work to repair', async () => {
    const s = stage();
    // The accepted attempt's own FAILED row, named with its generation (the first claim is generation 1).
    const evidenceId = `tool:${PLAN}:status:g1`;
    const now = new Date().toISOString();
    await s.memory.appendEvidence({
      runId: RUN, projectId: PROJECT, idempotencyKey: `tool-settlement:settlement:${evidenceId}`,
      evidence: {
        evidenceId, missionId: MISSION, taskId: PLAN, workerId: 'prompt-architect-openai', type: 'COMMAND', status: 'FAILED',
        safeSummary: 'Sandbox command failed.', artifactRef: null, integrityHash: null, occurredAt: now,
      },
    });
    await s.drive();
    const planDecisions = (await s.memory.decisionsForRun(RUN, PROJECT)).filter((decision) => decision.taskId === PLAN);
    expect(planDecisions[0], 'the accepted attempt\'s own failure is still judged').toMatchObject({ action: 'REPAIR', reasonCode: 'EVIDENCE_FAILED' });
    expect(planDecisions[0]!.evidenceIds).toContain(evidenceId);
  });
});

describe('the generation an evidence id names', () => {
  const row = (evidenceId: string, taskId = PLAN): JuliusEvidence => ({
    evidenceId, missionId: MISSION, taskId, workerId: 'w', type: 'COMMAND', status: 'FAILED',
    safeSummary: 's', artifactRef: null, integrityHash: null, occurredAt: '2026-09-29T00:00:00.000Z',
  });

  it.each([
    [`${PLAN}:3:0`, 3],
    [`${PLAN}:12:workspace`, 12],
    [`${PLAN}:2:scope`, 2],
    [`tool:${PLAN}:status:g4`, 4],
    ['tool:x-0123456789abcdef0123456789abcdef:test:g7', 7],
    ['evidence:hand-written', null],
    [`${PLAN}:not-a-generation:0`, null],
    ['tool:no-generation', null],
  ] as const)('%s → %s', (evidenceId, generation) => {
    expect(juliusEvidenceGeneration(row(evidenceId))).toBe(generation);
  });

  it('a task keeps its latest attempt\'s rows and every row that names no attempt; other tasks are judged on their own', () => {
    const other = `${RUN}:build-1`;
    const rows = [
      row(`${PLAN}:1:0`), row(`tool:${PLAN}:status:g1`), row(`${PLAN}:2:0`), row(`tool:${PLAN}:test:g2`), row('evidence:hand-written'),
      row(`${other}:1:0`, other),
    ];
    expect(juliusCurrentAttemptEvidence(rows).map((item) => item.evidenceId))
      .toEqual([`${PLAN}:2:0`, `tool:${PLAN}:test:g2`, 'evidence:hand-written', `${other}:1:0`]);
  });
});
