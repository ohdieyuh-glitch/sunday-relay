/**
 * V6 G-3: A RUN HELD FOR AN APPROVAL EXITS AS HELD, NOT AS A FAILURE.
 *
 * Before this, a gated run that stopped on its PENDING approval printed
 * `RESULT: BLOCKED (stalled before terminal state) after N ticks`, its run and
 * `cause: run_awaiting_approval: …`, and returned 1: the job's failure exit,
 * indistinguishable from a defect. A workflow cannot ask a person to decide on
 * an exit it cannot tell from a crash.
 *
 * Now, when the drive says the run is HELD FOR APPROVAL (BLOCKED, and the loop's
 * own reason is RUN_AWAITING_APPROVAL) AND the contract declares the gate AND
 * the store holds the PENDING approval, the entrypoint prints one
 * `HELD_FOR_APPROVAL: run … approval … operation … task …` line per approval,
 * the run, the tick account and the tasks, and NO `RESULT:` line, and returns 3
 * (`JULIUS_EXIT_HELD_FOR_APPROVAL`). Every other case prints exactly the report
 * it always printed (those statements are unchanged and still pinned by
 * `scripts/julius-first-live-mission.test.ts`); an ungated run that somehow
 * reached REQUIRE_APPROVAL keeps RESULT + exit 1.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createJuliusMemoryStore,
  decideJuliusApproval,
  juliusPacketTextIn,
  pauseJuliusRun,
  scriptedAdapter,
  seedJuliusTaskContract,
  type JuliusApproverAuthority,
  type JuliusRecoveryDriver,
  type JuliusRuntimeStore,
} from '../src/relay/mission/julius';
import {
  architectWorker, CODER_WORKER, assembleLiveJuliusRuntime, createContextAndClaimHandoffs, driveJuliusRunToTerminal, reviewerWorker,
  type DriveOutcome,
} from './julius/live-composition';
import { JULIUS_EXIT_HELD_FOR_APPROVAL, liveHeldForApprovalLines, liveTickAccountLine } from './julius/live-report-lines';

const ROOT = join(__dirname, '..');
const RUN = 'run:held-1';
const PROJECT = 'prj-held';
const CARD = 'card:julius-live:1:gate-0123456789abcdef';
const APPROVAL = `approval:dispatch:${RUN}:${RUN}:build-1:DISPATCH_WORKER:${CARD}`;
const ACCOUNT = {
  plannedTicks: 9, hardMaxTicks: 40, allowance: 9, ticksConsumed: 4, ticksRemaining: 5, beyondMainPath: 0,
  disagreementTicks: 0, architectureTicks: 0, retries: 0, override: null, reason: 'units=PROMPT_ARCHITECT,CODING_AGENT', exhausted: false,
};
const HELD: DriveOutcome = {
  state: 'BLOCKED', ticks: 4, stalled: true, heldForApproval: true, tickAccount: ACCOUNT,
  haltCause: 'run_awaiting_approval: the run is BLOCKED on a PENDING approval and claims no new work until an authorized approver decides it',
};
const TASKS = [
  { taskId: `${RUN}:plan-1`, role: 'PROMPT_ARCHITECT', taskType: 'plan', state: 'SUCCEEDED' },
  { taskId: `${RUN}:build-1`, role: 'CODING_AGENT', taskType: 'build', state: 'RUNNABLE' },
];
const PENDING = [{ approvalId: APPROVAL, operation: 'DISPATCH_WORKER', taskId: `${RUN}:build-1` }];
const held = (overrides: Partial<Parameters<typeof liveHeldForApprovalLines>[0]> = {}) => liveHeldForApprovalLines({
  outcome: HELD, runId: RUN, gated: true, pending: PENDING, tasks: TASKS, ...overrides,
});
const allowlisted = (lines: readonly string[]): string[] => execFileSync(process.execPath, ['scripts/julius-live-evidence.mjs', '-'], {
  cwd: ROOT, input: lines.join('\n'), encoding: 'utf8',
}).split('\n');

describe('V6 G-3: the held-for-approval report', () => {
  it('RED before G-3: a gated run held on a PENDING approval reports HELD_FOR_APPROVAL, its run, ticks and tasks, and NO RESULT line', () => {
    expect(JULIUS_EXIT_HELD_FOR_APPROVAL).toBe(3);
    const lines = held();
    expect(lines).toEqual([
      `HELD_FOR_APPROVAL: run ${RUN} approval ${APPROVAL} operation DISPATCH_WORKER task ${RUN}:build-1`,
      `  run: ${RUN}`,
      liveTickAccountLine(ACCOUNT),
      `  task ${RUN}:plan-1 [PROMPT_ARCHITECT/plan] → SUCCEEDED`,
      `  task ${RUN}:build-1 [CODING_AGENT/build] → RUNNABLE`,
    ]);
    expect(lines!.some((line) => line.startsWith('RESULT:')), 'held is not an answer').toBe(false);
  });

  it('a run-level approval (no task) names its task as none; two approvals are two lines', () => {
    expect(held({ pending: [{ approvalId: 'approval:run-level', operation: 'DISPATCH_WORKER', taskId: null }] })![0])
      .toBe(`HELD_FOR_APPROVAL: run ${RUN} approval approval:run-level operation DISPATCH_WORKER task none`);
    const two = held({ pending: [...PENDING, { approvalId: 'approval:second', operation: 'USE_CAPABILITY', taskId: `${RUN}:plan-1` }] })!;
    expect(two.filter((line) => line.startsWith('HELD_FOR_APPROVAL: '))).toHaveLength(2);
  });

  it('every other case is null, so the entrypoint prints the report it always printed (RESULT, exit 0 or 1)', () => {
    expect(held({ gated: false }), 'UNGATED: the same stall keeps RESULT and the failure exit (fail closed)').toBeNull();
    expect(held({ pending: [] }), 'a held exit needs the approval it is held on').toBeNull();
    const paused: DriveOutcome = { ...HELD, state: 'PAUSED', heldForApproval: false, haltCause: 'run_paused_by_operator: the run is PAUSED and claims no new work until an operator resumes it' };
    expect(held({ outcome: paused }), 'PAUSED is not held for approval').toBeNull();
    const completed: DriveOutcome = { state: 'COMPLETED', ticks: 7, stalled: false, heldForApproval: false, haltCause: null, tickAccount: ACCOUNT };
    expect(held({ outcome: completed })).toBeNull();
  });

  it('the evidence allowlist keeps the HELD line, and drops one with any extra suffix', () => {
    const line = held()![0]!;
    const kept = allowlisted([line, `${line} and more`, `${line}; RESULT: COMPLETED`]);
    expect(kept).toContain(line);
    expect(kept.filter((entry) => entry.startsWith('HELD_FOR_APPROVAL'))).toEqual([line]);
  });
});

/* ------------------------------------------------- the drive names the hold */

const anyone: JuliusApproverAuthority = { async mayApprove() { return true; } };
type Memory = ReturnType<typeof createJuliusMemoryStore>;
type Store = JuliusRuntimeStore & JuliusRecoveryDriver;

function gatedStage() {
  const memory = createJuliusMemoryStore();
  memory.seedRun({ runId: RUN, missionId: 'mission-held', projectId: PROJECT, state: 'READY', cardRevision: CARD, missionContractRevision: 1, projectBrainRevision: 0, version: 1 });
  memory.seedTask(RUN, { taskId: `${RUN}:plan-1`, missionId: 'mission-held', parentTaskId: null, dependencyIds: [], requiredEvidenceTypes: ['ARTIFACT'], taskType: 'plan', role: 'PROMPT_ARCHITECT', ordinal: 0, state: 'RUNNABLE' });
  memory.seedTask(RUN, { taskId: `${RUN}:build-1`, missionId: 'mission-held', parentTaskId: null, dependencyIds: [`${RUN}:plan-1`], requiredEvidenceTypes: ['TEST'], taskType: 'build', role: 'CODING_AGENT', ordinal: 1, state: 'BLOCKED' });
  const seeded = seedJuliusTaskContract({
    runId: RUN, taskId: `${RUN}:build-1`, missionContractRevision: 1, objective: 'Hold the build for a person.',
    requirements: ['Do the work.'], constraints: ['Touch only the module.'], acceptanceCriteria: [{ id: 'AC-1', text: 'The suite passes.', blocking: true }],
    filesInScope: [], filesOutOfScope: [], spendUsd: 10, repairCycles: 1, requiredEvidence: ['TEST'],
  });
  if (!seeded.seeded) throw new Error(seeded.reasonCode);
  void memory.putTaskContract({ projectId: PROJECT, contract: seeded.contract, occurredAt: '2026-10-13T00:00:00.000Z' });
  memory.seedCriteria(RUN, [{ criterionId: 'AC-1', description: 'The suite passes.', requiredEvidenceTypes: [] }]);
  memory.seedBrain(RUN, [{ entryId: `${RUN}:brain`, kind: 'OBJECTIVE', text: 'OBJECTIVE: hold.', taskIds: [], allowedRoles: ['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER'], sensitivity: 'INTERNAL' }]);
  const store = createContextAndClaimHandoffs(memory as unknown as Store).store;
  const runtime = assembleLiveJuliusRuntime({
    store,
    entries: [
      { worker: architectWorker({}), adapter: scriptedAdapter(architectWorker({}), [{ kind: 'succeed', evidence: [{ type: 'ARTIFACT', status: 'PASSED', safeSummary: 'Plan.' }], usdMicros: null }]) },
      { worker: CODER_WORKER, adapter: scriptedAdapter(CODER_WORKER, [{ kind: 'succeed', evidence: [{ type: 'TEST', status: 'PASSED', safeSummary: 'Green.' }], usdMicros: 1_000 }]) },
      {
        worker: reviewerWorker('hermes'),
        adapter: scriptedAdapter(reviewerWorker('hermes'), [{ kind: 'succeed', evidence: [{ type: 'REVIEW_FINDING', status: 'PASSED', safeSummary: 'Fine.' }], usdMicros: null, answerFindings: 'RESOLVED' }],
          { packetFor: juliusPacketTextIn(memory) }),
      },
    ],
    cardRevision: CARD, spendCeilingUsdMicros: 20_000_000, maxRepairRounds: 1,
    approvalScopes: [{ operation: 'DISPATCH_WORKER', roles: ['CODING_AGENT'], taskTypes: ['build'] }],
  });
  return { memory, drive: () => driveJuliusRunToTerminal({ loop: runtime.loop, store, runId: RUN, projectId: PROJECT, verification: runtime.verification }) };
}
const deps = (memory: Memory) => ({ store: memory as never, clock: { now: () => new Date().toISOString() }, approvers: anyone });

describe('V6 G-3: driveJuliusRunToTerminal says when a run is held for an approval, and only then', () => {
  it('RED before G-3: a gated run stalled on its PENDING approval is heldForApproval; the grant and the completion are not', async () => {
    const s = gatedStage();
    const stalled = await s.drive();
    expect(stalled).toMatchObject({ state: 'BLOCKED', stalled: true, heldForApproval: true });
    const [gate] = await s.memory.pendingApprovals(RUN, PROJECT);
    await decideJuliusApproval({ runId: RUN, projectId: PROJECT, approvalId: gate!.approvalId, decision: 'APPROVED', approverId: 'github:founder#1', reason: 'Reviewed.' }, deps(s.memory));
    const done = await s.drive();
    expect(done).toMatchObject({ state: 'COMPLETED', stalled: false, heldForApproval: false });
  });

  it('a PAUSED run is not held for approval, even with an approval pending', async () => {
    const s = gatedStage();
    await s.drive();
    expect((await pauseJuliusRun({ runId: RUN, projectId: PROJECT, actor: 'operator', reason: 'Paused for the test.' }, deps(s.memory))).applied).toBe(true);
    const paused = await s.drive();
    expect(paused.state).toBe('PAUSED');
    expect(paused.heldForApproval).toBe(false);
  });

  it('a DENIED gate ends FAILED, not held', async () => {
    const s = gatedStage();
    await s.drive();
    const [gate] = await s.memory.pendingApprovals(RUN, PROJECT);
    await decideJuliusApproval({ runId: RUN, projectId: PROJECT, approvalId: gate!.approvalId, decision: 'DENIED', approverId: 'github:founder#1', reason: 'No.' }, deps(s.memory));
    expect(await s.drive()).toMatchObject({ state: 'FAILED', heldForApproval: false });
  });
});

/* ---------------------------------------------------------- the structure */

describe('V6 G-3: the entrypoint and the gate, read as source', () => {
  const ENTRY = readFileSync(join(ROOT, 'relay-bridge', 'julius-live-mission.ts'), 'utf8');

  it('RED before G-3: exit 3 has exactly one site, behind the held report; the literal exits stay {0, 1, 2, 5}', () => {
    const literal = [...ENTRY.matchAll(/\breturn (\d+);/gu)].map((match) => Number(match[1]));
    expect([...new Set(literal)].sort()).toEqual([0, 1, 2, 5]);
    expect(ENTRY.match(/return JULIUS_EXIT_HELD_FOR_APPROVAL;/gu), 'the one held exit').toHaveLength(1);
    const at = ENTRY.indexOf('return JULIUS_EXIT_HELD_FOR_APPROVAL;');
    expect(ENTRY.slice(ENTRY.lastIndexOf('if (held !== null) {', at), at)).toContain('for (const line of held) out(line);');
    expect(ENTRY.match(/return outcome\.state === 'COMPLETED' && !learningUnrecorded \? 0 : 1;/gu), 'the run\'s own exit, unchanged').toHaveLength(1);
    expect(at, 'the held exit comes before any RESULT line is printed').toBeLessThan(ENTRY.indexOf('out(`RESULT: ${outcome.state}'));
  });

  it('the pending approvals are read only for a gated run the drive says is held', () => {
    expect(ENTRY).toContain('const pending = contract.approvalGates !== undefined && outcome.heldForApproval');
  });

  it('the Beta Gate reads only lines that START with RESULT:, so a HELD line is never an answer', () => {
    const gate = readFileSync(join(ROOT, 'scripts', 'wonderland-beta-gate.mjs'), 'utf8');
    const body = gate.slice(gate.indexOf('function resultsOf(ev) {'), gate.indexOf('function resultFor(ev, runId) {'));
    expect(body, 'resultsOf must be found, or this pin is vacuous').toContain("if (!line.startsWith('RESULT:')) return;");
  });
});
