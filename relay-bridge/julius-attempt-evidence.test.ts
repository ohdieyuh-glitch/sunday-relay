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
 * A task's decision reads the rows of the attempt its task row names (for a SUCCEEDED task, the
 * accepted one), and keeps any row that names none.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

function stage(planEvidence: readonly { type: string; status: string; safeSummary: string }[] = [{ type: 'ARTIFACT', status: 'PASSED', safeSummary: 'Plan written.' }]) {
  const memory = createJuliusMemoryStore();
  seed(memory);
  const store = createContextAndClaimHandoffs(memory as unknown as Store).store;
  const architect = scriptedAdapter(architectWorker({}), [{ kind: 'succeed', evidence: planEvidence as never, usdMicros: null }]);
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

/* ============ the review of 785aa19c: the accepted attempt, not the latest one with rows ============ */

/**
 * DA0-DA6 are the independent reviewer's probes (defect_a/review-probe-defect-a.test.ts), now tests.
 * DA1, DA2, DA4 and DA6 were RED against 785aa19c, whose "latest generation with a row" was a false
 * accept: an accepted attempt that wrote nothing was judged on the rows a lost lease left behind.
 */
describe('defect A (review of 785aa19c): the decision reads the ACCEPTED attempt the task row names', () => {
  /** A lost lease that had already persisted a PASSED row: claimed (g1), the row written, the lease already expired. */
  async function aLostLeasePersistedAPassingRow(memory: Memory): Promise<string> {
    const now = new Date().toISOString();
    const [claimed] = await memory.claimRunnable({ owner: 'an-earlier-process', now, leaseExpiresAt: now, limit: 1, projectId: PROJECT });
    expect(claimed?.taskId).toBe(PLAN);
    const evidenceId = `${PLAN}:${String(claimed!.leaseGeneration)}:0`;
    expect(await memory.appendEvidence({
      runId: RUN, projectId: PROJECT, idempotencyKey: `${PLAN}:${String(claimed!.leaseGeneration)}:${evidenceId}`,
      evidence: {
        evidenceId, missionId: MISSION, taskId: PLAN, workerId: 'prompt-architect-openai', type: 'ARTIFACT', status: 'PASSED',
        safeSummary: 'Plan written (by an attempt whose lease was lost).', artifactRef: null, integrityHash: null, occurredAt: now,
      },
    })).toBe(true);
    return evidenceId;
  }
  const planDecisions = async (memory: Memory) => (await memory.decisionsForRun(RUN, PROJECT)).filter((decision) => decision.taskId === PLAN);

  it('DA0 CONTROL: an accepted attempt with no evidence at all is HALTED as REQUIRED_EVIDENCE_MISSING', async () => {
    const s = stage([]);
    await s.drive();
    expect((await planDecisions(s.memory)).map((d) => `${d.action}:${d.reasonCode}`)).toEqual(['HALT:REQUIRED_EVIDENCE_MISSING']);
  });

  it('DA1 a lost lease’s PASSED row does not launder a zero-evidence accepted attempt into ACCEPT', async () => {
    const s = stage([]);
    const stale = await aLostLeasePersistedAPassingRow(s.memory);
    await s.drive();
    const decisions = await planDecisions(s.memory);
    expect(decisions.map((d) => `${d.action}:${d.reasonCode}`), 'judged on its own attempt, which produced nothing').toEqual(['HALT:REQUIRED_EVIDENCE_MISSING']);
    expect(decisions[0]!.evidenceIds).not.toContain(stale);
    expect(s.memory.taskRow(PLAN)!.leaseGeneration, 'the accepted attempt is the second claim').toBe(2);
  });

  it('DA2 an attempt whose only evidence was refused is a zero-row attempt too', async () => {
    const s = stage([{ type: 'TEST', status: 'PASSED', safeSummary: 'I ran the tests.' }]);
    const stale = await aLostLeasePersistedAPassingRow(s.memory);
    await s.drive();
    const decisions = await planDecisions(s.memory);
    expect(decisions.map((d) => `${d.action}:${d.reasonCode}`)).toEqual(['HALT:REQUIRED_EVIDENCE_MISSING']);
    expect(decisions[0]!.evidenceIds).not.toContain(stale);
  });

  it('DA6 a lost lease’s FAILED tool row does not send a zero-evidence accepted attempt to a paid repair', async () => {
    const s = stage([]);
    const now = new Date().toISOString();
    const [claimed] = await s.memory.claimRunnable({ owner: 'an-earlier-process', now, leaseExpiresAt: now, limit: 1, projectId: PROJECT });
    const stale = `tool:${PLAN}:status:g${String(claimed!.leaseGeneration)}`;
    await s.memory.appendEvidence({
      runId: RUN, projectId: PROJECT, idempotencyKey: `tool-settlement:settlement:${stale}`,
      evidence: {
        evidenceId: stale, missionId: MISSION, taskId: PLAN, workerId: 'prompt-architect-openai', type: 'COMMAND', status: 'FAILED',
        safeSummary: 'Sandbox command failed (lost attempt).', artifactRef: null, integrityHash: null, occurredAt: now,
      },
    });
    await s.drive();
    const decisions = await planDecisions(s.memory);
    expect(decisions.map((d) => `${d.action}:${d.reasonCode}`)).toEqual(['HALT:REQUIRED_EVIDENCE_MISSING']);
    expect(decisions[0]!.evidenceIds).not.toContain(stale);
  });

  it('DA4 (A-2) a finding that cites a superseded attempt’s row no longer wedges every verification of its run', async () => {
    const s = stage();
    const stale = await aLostLeasePersistedAPassingRow(s.memory);
    s.memory.seedFinding({
      findingId: `finding:${stale}`, runId: RUN, taskId: `${RUN}:build-1`, reviewerWorkerId: 'reviewer', severity: 'HIGH',
      category: 'review', claim: 'From a superseded attempt.', criterionId: null, evidenceIds: [stale], blocking: false,
      status: 'OPEN', createdAt: new Date().toISOString(),
    } as never);
    expect((await s.drive()).state, 'verification ran to the end instead of throwing reviewer_finding_evidence_not_found').toBe('COMPLETED');
  });

  it('CONFORMANCE (memory): tasksForRun names every task’s generation, so the fallback is never reached', async () => {
    const s = stage();
    await s.drive();
    const tasks = await s.memory.tasksForRun(RUN, PROJECT);
    for (const task of tasks) expect(typeof task.leaseGeneration, task.taskId).toBe('number');
    expect(tasks.find((task) => task.taskId === PLAN)!.leaseGeneration).toBe(1);
  });

  it('CONFORMANCE (PostgreSQL, offline): the reader selects and maps julius_tasks.lease_generation', () => {
    const source = readFileSync(join(__dirname, '..', 'src', 'relay', 'persistence', 'julius-read-postgres.ts'), 'utf8');
    const method = source.slice(source.indexOf('async tasksForRun('), source.indexOf('async evidenceForRun('));
    expect(method).toContain('t.lease_generation');
    expect(method).toContain('leaseGeneration: Number(row.lease_generation)');
  });
});

describe('defect A (review of 785aa19c, A-3): the parser, pinned where a mutant survived', () => {
  const row = (evidenceId: string, taskId: string): JuliusEvidence => ({
    evidenceId, missionId: MISSION, taskId, workerId: 'w', type: 'COMMAND', status: 'FAILED',
    safeSummary: 's', artifactRef: null, integrityHash: null, occurredAt: '2026-09-29T00:00:00.000Z',
  });

  it('generations compare as numbers, not strings (g10 is later than g9)', () => {
    const odd = 'run:g7:segment:g3:2';
    expect(juliusEvidenceGeneration(row(`${odd}:10:0`, odd))).toBe(10);
    expect(juliusEvidenceGeneration(row(`tool:${odd}:diff:g9`, odd))).toBe(9);
    expect(juliusCurrentAttemptEvidence([row(`tool:${odd}:diff:g9`, odd), row(`${odd}:10:0`, odd), row(`tool:${odd}:test:g10`, odd)]).map((r) => r.evidenceId))
      .toEqual([`${odd}:10:0`, `tool:${odd}:test:g10`]);
  });

  it('both patterns are anchored: an earlier g<digits> segment, or a stray digit, is never read as the generation', () => {
    expect(juliusEvidenceGeneration(row('tool:run:g5:plan:status:g7', 'run:g5:plan')), 'the LAST :g<n>, not the first').toBe(7);
    expect(juliusEvidenceGeneration(row(`${PLAN}:x9:0`, PLAN)), 'digits must start the suffix').toBe(null);
  });

  it('the task row’s generation wins over the latest one with a row', () => {
    const rows = [row(`${PLAN}:1:0`, PLAN), row(`${PLAN}:2:0`, PLAN)];
    expect(juliusCurrentAttemptEvidence(rows, [{ taskId: PLAN, leaseGeneration: 1 }]).map((r) => r.evidenceId)).toEqual([`${PLAN}:1:0`]);
    expect(juliusCurrentAttemptEvidence(rows, [{ taskId: PLAN, leaseGeneration: 3 }]), 'an accepted attempt with no rows keeps none').toEqual([]);
  });
});
