/**
 * V6 G-4: THE DECIDE PATH, ITS COMMITTED AUTHORITY, AND THE ROUTE-LEVEL GUARD.
 *
 * `relay-bridge/julius-approval-decide.ts` is the first caller of `decideJuliusApproval` with a real authority:
 * an approver on BOTH the committed `.github/julius-approvers.json` and the founder workflow's literal. It never
 * says yes by default, and the bridge's `mayApprove: async () => false` is untouched (pinned below).
 *
 * THE GUARD (MAIN ruling). `decideJuliusApproval` has two latent early branches (V6 design; the proposed natural
 * mission task, so it is NOT modified here): on a CANCELLED run it writes `decidedBy = <caller>` before its
 * blank-name and authority checks, and on an already-decided approval it returns the decision and the run's state
 * before its authority check. These cases prove the CLI keeps both unreachable: a blank or unauthorised caller,
 * on a CANCELLED run and on an already-decided approval, is refused with NO store access at all (so no write and
 * no state disclosure), and an AUTHORISED caller is refused before the kernel too, because a cancelled run is not
 * BLOCKED and a decided approval is not PENDING.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  cancelJuliusRun,
  createJuliusMemoryStore,
  decideJuliusApproval,
  juliusPacketTextIn,
  scriptedAdapter,
  seedJuliusTaskContract,
  type JuliusApprovalRecord,
  type JuliusApproverAuthority,
  type JuliusRecoveryDriver,
  type JuliusRuntimeStore,
} from '../src/relay/mission/julius';
import {
  committedApproverAuthority,
  decideJuliusApprovalGuarded,
  juliusDecidePrecheck,
  juliusPlanCitation,
  juliusRunIdForContract,
  parseJuliusApproverAllowlist,
  parseJuliusApproverId,
  parseJuliusWorkflowApprovers,
  readJuliusApproverFile,
  type JuliusDecideInput,
  type JuliusDecideStore,
} from './julius-approval-decide';
import {
  architectWorker, CODER_WORKER, assembleLiveJuliusRuntime, createContextAndClaimHandoffs, driveJuliusRunToTerminal, reviewerWorker,
} from './julius/live-composition';
import { compileBootstrapRequest, parseLiveMissionContract } from './julius/mission-contract';

const ROOT = join(__dirname, '..');
const RUN = 'run:decide-1';
const PROJECT = 'prj-decide';
const CARD = 'card:decide:1';
const FOUNDER = 'github:founder#1001';
const FILE = parseJuliusApproverAllowlist(JSON.stringify({ version: 1, approvers: [{ login: 'founder', id: 1001 }], operations: ['DISPATCH_WORKER'] }));
const WORKFLOW = parseJuliusWorkflowApprovers('founder#1001');
const AUTHORITY = committedApproverAuthority({ file: FILE, workflow: WORKFLOW });
const clock = { now: () => new Date().toISOString() };
const anyone: JuliusApproverAuthority = { async mayApprove() { return true; } };

type Memory = ReturnType<typeof createJuliusMemoryStore>;
type Store = JuliusRuntimeStore & JuliusRecoveryDriver;

/** A run driven by the live composition until its build is HELD: the producer's own rows, never hand-written ones. */
async function heldRun(): Promise<{ memory: Memory; approvalId: string; citation: string; drive: () => ReturnType<typeof driveJuliusRunToTerminal> }> {
  const memory = createJuliusMemoryStore();
  memory.seedRun({ runId: RUN, missionId: 'mission-decide', projectId: PROJECT, state: 'READY', cardRevision: CARD, missionContractRevision: 1, projectBrainRevision: 0, version: 1 });
  memory.seedTask(RUN, { taskId: `${RUN}:plan-1`, missionId: 'mission-decide', parentTaskId: null, dependencyIds: [], requiredEvidenceTypes: ['ARTIFACT'], taskType: 'plan', role: 'PROMPT_ARCHITECT', ordinal: 0, state: 'RUNNABLE' });
  memory.seedTask(RUN, { taskId: `${RUN}:build-1`, missionId: 'mission-decide', parentTaskId: null, dependencyIds: [`${RUN}:plan-1`], requiredEvidenceTypes: ['TEST'], taskType: 'build', role: 'CODING_AGENT', ordinal: 1, state: 'BLOCKED' });
  const seeded = seedJuliusTaskContract({
    runId: RUN, taskId: `${RUN}:build-1`, missionContractRevision: 1, objective: 'Decide who decides.',
    requirements: ['Do the work.'], constraints: ['Touch only the module.'], acceptanceCriteria: [{ id: 'AC-1', text: 'The suite passes.', blocking: true }],
    filesInScope: [], filesOutOfScope: [], spendUsd: 10, repairCycles: 1, requiredEvidence: ['TEST'],
  });
  if (!seeded.seeded) throw new Error(seeded.reasonCode);
  void memory.putTaskContract({ projectId: PROJECT, contract: seeded.contract, occurredAt: '2026-10-13T00:00:00.000Z' });
  memory.seedCriteria(RUN, [{ criterionId: 'AC-1', description: 'The suite passes.', requiredEvidenceTypes: [] }]);
  memory.seedBrain(RUN, [{ entryId: `${RUN}:brain`, kind: 'OBJECTIVE', text: 'OBJECTIVE: decide.', taskIds: [], allowedRoles: ['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER'], sensitivity: 'INTERNAL' }]);
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
  const drive = () => driveJuliusRunToTerminal({ loop: runtime.loop, store, runId: RUN, projectId: PROJECT, verification: runtime.verification });
  expect((await drive()).state).toBe('BLOCKED');
  const [gate] = await memory.pendingApprovals(RUN, PROJECT);
  const citation = juliusPlanCitation(await memory.tasksForRun(RUN, PROJECT), await memory.evidenceForRun(RUN, PROJECT));
  if (gate === undefined || citation === null) throw new Error('fixture did not hold');
  return { memory, approvalId: gate.approvalId, citation, drive };
}

/** Every store property the guarded path touches, recorded, so "no access at all" is a count, not a belief. */
function recorded(memory: Memory): { store: JuliusDecideStore; calls: string[] } {
  const calls: string[] = [];
  const store = new Proxy(memory as unknown as JuliusDecideStore, {
    get(target, key, receiver) {
      calls.push(String(key));
      const value = Reflect.get(target, key, receiver) as unknown;
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
  return { store, calls };
}

const input = (overrides: Partial<JuliusDecideInput> & Pick<JuliusDecideInput, 'approvalId'>): JuliusDecideInput => ({
  runId: RUN, projectId: PROJECT, decision: 'APPROVED', approverId: FOUNDER, reason: 'Plan reviewed.', commentId: '42', ...overrides,
});
const snapshot = async (memory: Memory, approvalId: string): Promise<JuliusApprovalRecord | null> => memory.loadApproval(RUN, approvalId, PROJECT);

/* ======================================================== the authority */

describe('V6 G-4: the committed approver authority is the intersection of two lists, and never a default yes', () => {
  it('in both lists: permitted, for a listed operation only', async () => {
    expect(AUTHORITY.listed(FOUNDER)).toBe(true);
    expect(await AUTHORITY.mayApprove({ projectId: PROJECT, runId: RUN, approverId: FOUNDER, operation: 'DISPATCH_WORKER' })).toBe(true);
    expect(await AUTHORITY.mayApprove({ projectId: PROJECT, runId: RUN, approverId: FOUNDER, operation: 'USE_CAPABILITY' }), 'an operation the file does not list').toBe(false);
  });

  it('in one list only: refused, either way round (intersection, never union)', () => {
    const fileOnly = committedApproverAuthority({ file: FILE, workflow: parseJuliusWorkflowApprovers('someone#7') });
    const workflowOnly = committedApproverAuthority({ file: parseJuliusApproverAllowlist(JSON.stringify({ version: 1, approvers: [{ login: 'someone', id: 7 }], operations: ['DISPATCH_WORKER'] })), workflow: WORKFLOW });
    expect(fileOnly.listed(FOUNDER)).toBe(false);
    expect(workflowOnly.listed(FOUNDER)).toBe(false);
  });

  it('the login matches but the numeric id differs: refused (a renamed or squatted login is not the person)', () => {
    expect(AUTHORITY.listed('github:founder#1002')).toBe(false);
    expect(committedApproverAuthority({ file: FILE, workflow: parseJuliusWorkflowApprovers('founder#9') }).listed(FOUNDER)).toBe(false);
    expect(AUTHORITY.listed('github:FOUNDER#1001'), 'GitHub logins are case-insensitive; the id is exact').toBe(true);
  });

  it('an empty, unreadable or malformed list refuses everyone', () => {
    const empty = parseJuliusApproverAllowlist(JSON.stringify({ version: 1, approvers: [], operations: ['DISPATCH_WORKER'] }));
    expect(committedApproverAuthority({ file: empty, workflow: WORKFLOW }).listed(FOUNDER)).toBe(false);
    expect(committedApproverAuthority({ file: null, workflow: WORKFLOW }).listed(FOUNDER)).toBe(false);
    expect(committedApproverAuthority({ file: FILE, workflow: null }).listed(FOUNDER)).toBe(false);
    for (const text of [
      null, '', 'not json', '[]', '{"version":2,"approvers":[],"operations":[]}',
      '{"version":1,"approvers":[{"login":"founder","id":"1001"}],"operations":["DISPATCH_WORKER"]}',
      '{"version":1,"approvers":[{"login":"founder","id":1001,"admin":true}],"operations":["DISPATCH_WORKER"]}',
      '{"version":1,"approvers":[],"operations":["DISPATCH_WORKER"],"default":"allow"}',
      '{"version":1,"approvers":[{"login":"julius-worker[bot]","id":325202980}],"operations":["DISPATCH_WORKER"]}',
    ]) expect(parseJuliusApproverAllowlist(text), String(text)).toBeNull();
    expect(parseJuliusWorkflowApprovers(''), 'no literal').toBeNull();
    expect(parseJuliusWorkflowApprovers(undefined)).toBeNull();
    expect(parseJuliusWorkflowApprovers('founder#1001, other#x'), 'one malformed entry voids the literal').toBeNull();
    expect(parseJuliusWorkflowApprovers('founder#1001, other#2')).toHaveLength(2);
  });

  it('identities: github:<login>#<numeric id> only; a bot, a blank and a zero id are not identities', () => {
    expect(parseJuliusApproverId(FOUNDER)).toEqual({ login: 'founder', id: '1001' });
    for (const raw of ['', '  ', 'founder', 'github:founder', 'github:founder#0', 'github:founder#abc', 'github:julius-worker[bot]#325202980', 'github: founder#1', 'gitlab:founder#1']) {
      expect(parseJuliusApproverId(raw), raw).toBeNull();
    }
  });

  it('THE COMMITTED FILE parses, lists DISPATCH_WORKER, and registers NOBODY: today everyone is refused', () => {
    const file = parseJuliusApproverAllowlist(readJuliusApproverFile(ROOT));
    expect(file, '.github/julius-approvers.json is well formed').not.toBeNull();
    expect(file!.approvers).toEqual([]);
    expect(file!.operations).toEqual(['DISPATCH_WORKER']);
    expect(committedApproverAuthority({ file, workflow: WORKFLOW }).listed(FOUNDER)).toBe(false);
  });

  it('PIN: the bridge still composes an authority that refuses every approval, and the CLI has no default yes', () => {
    const routes = readFileSync(join(ROOT, 'relay-bridge', 'julius-state-routes.ts'), 'utf8');
    expect(routes.match(/approvers: \{ mayApprove: async \(\) => false \},/gu), 'composeJuliusStateApi is unchanged').toHaveLength(1);
    const cli = readFileSync(join(ROOT, 'relay-bridge', 'julius-approval-decide.ts'), 'utf8');
    expect(cli).not.toMatch(/async \(\) => true/u);
    expect(cli).not.toMatch(/mayApprove[^\n]*return true/u);
  });
});

/* ===================================================== the route guard */

describe('V6 G-4: the route-level guard keeps decideJuliusApproval\'s two early branches unreachable', () => {
  it('a BLANK caller on a CANCELLED run: APPROVER_REQUIRED, no store access, no write', async () => {
    const s = await heldRun();
    expect((await cancelJuliusRun({ runId: RUN, projectId: PROJECT, actor: 'operator', reason: 'Cancelled for the test.' }, { store: s.memory as never, clock })).applied).toBe(true);
    const before = await snapshot(s.memory, s.approvalId);
    const { store, calls } = recorded(s.memory);
    const result = await decideJuliusApprovalGuarded(input({ approvalId: s.approvalId, approverId: '  ', reason: `Plan ${s.citation} reviewed.` }), { store, authority: AUTHORITY, clock });
    expect(result).toEqual({ exitCode: 4, line: 'APPROVAL_REFUSED reason=APPROVER_REQUIRED' });
    expect(calls, 'the store was never touched').toEqual([]);
    expect(await snapshot(s.memory, s.approvalId), 'the approval is exactly as it was').toEqual(before);
    expect(before?.decidedBy ?? null, 'nobody is recorded as its decider').toBeNull();
  });

  it('an UNAUTHORISED caller on a CANCELLED run: APPROVER_NOT_AUTHORIZED, no store access, no write', async () => {
    const s = await heldRun();
    await cancelJuliusRun({ runId: RUN, projectId: PROJECT, actor: 'operator', reason: 'Cancelled for the test.' }, { store: s.memory as never, clock });
    const before = await snapshot(s.memory, s.approvalId);
    const { store, calls } = recorded(s.memory);
    const result = await decideJuliusApprovalGuarded(input({ approvalId: s.approvalId, approverId: 'github:intruder#666', reason: `Plan ${s.citation} reviewed.` }), { store, authority: AUTHORITY, clock });
    expect(result).toEqual({ exitCode: 4, line: 'APPROVAL_REFUSED reason=APPROVER_NOT_AUTHORIZED' });
    expect(calls).toEqual([]);
    expect(await snapshot(s.memory, s.approvalId)).toEqual(before);
  });

  it('an UNAUTHORISED or BLANK caller on an ALREADY-DECIDED approval: refused, no store access, told nothing', async () => {
    const s = await heldRun();
    await decideJuliusApproval({ runId: RUN, projectId: PROJECT, approvalId: s.approvalId, decision: 'APPROVED', approverId: FOUNDER, reason: 'First.' }, { store: s.memory as never, clock, approvers: anyone });
    const before = await snapshot(s.memory, s.approvalId);
    expect(before).toMatchObject({ state: 'APPROVED', decidedBy: FOUNDER, decisionReason: 'First.' });
    for (const [approverId, code] of [['github:intruder#666', 'APPROVER_NOT_AUTHORIZED'], ['', 'APPROVER_REQUIRED'], ['github:founder#1002', 'APPROVER_NOT_AUTHORIZED']] as const) {
      const { store, calls } = recorded(s.memory);
      const result = await decideJuliusApprovalGuarded(input({ approvalId: s.approvalId, approverId, decision: 'DENIED', reason: `Plan ${s.citation} reviewed.` }), { store, authority: AUTHORITY, clock });
      expect(result, approverId).toEqual({ exitCode: 4, line: `APPROVAL_REFUSED reason=${code}` });
      expect(result.line, 'neither the decision nor the run state is disclosed').not.toMatch(/APPROVED|READY|BLOCKED|duplicate/u);
      expect(calls, approverId).toEqual([]);
    }
    expect(await snapshot(s.memory, s.approvalId), 'the first decision stands, untouched').toEqual(before);
  });

  it('NO DISCLOSURE: an unauthorised caller gets the same line whatever the run is (held, cancelled, decided, absent)', async () => {
    const lines = new Set<string>();
    const held = await heldRun();
    for (const target of [held.approvalId, 'approval:does-not-exist']) {
      lines.add((await decideJuliusApprovalGuarded(input({ approvalId: target, approverId: 'github:intruder#666' }), { store: recorded(held.memory).store, authority: AUTHORITY, clock })).line);
    }
    lines.add((await decideJuliusApprovalGuarded(input({ approvalId: held.approvalId, approverId: 'github:intruder#666', runId: 'run:absent' }), { store: recorded(held.memory).store, authority: AUTHORITY, clock })).line);
    expect([...lines]).toEqual(['APPROVAL_REFUSED reason=APPROVER_NOT_AUTHORIZED']);
    expect(juliusDecidePrecheck(input({ approvalId: 'x', approverId: 'github:intruder#666' }), AUTHORITY), 'decided from the arguments alone')
      .toEqual({ exitCode: 4, line: 'APPROVAL_REFUSED reason=APPROVER_NOT_AUTHORIZED' });
  });

  it('an AUTHORISED caller on a CANCELLED run is refused BEFORE the kernel: RUN_NOT_BLOCKED, and no approval write', async () => {
    const s = await heldRun();
    await cancelJuliusRun({ runId: RUN, projectId: PROJECT, actor: 'operator', reason: 'Cancelled for the test.' }, { store: s.memory as never, clock });
    const before = await snapshot(s.memory, s.approvalId);
    const { store, calls } = recorded(s.memory);
    const result = await decideJuliusApprovalGuarded(input({ approvalId: s.approvalId, reason: `Plan ${s.citation} reviewed.` }), { store, authority: AUTHORITY, clock });
    expect(result).toEqual({ exitCode: 4, line: 'APPROVAL_REFUSED reason=RUN_NOT_BLOCKED' });
    expect(calls, 'read only; the kernel (and its decideApproval write) was never reached').not.toContain('decideApproval');
    expect(await snapshot(s.memory, s.approvalId)).toEqual(before);
  });

  it('an AUTHORISED caller on an ALREADY-DECIDED approval is refused BEFORE the kernel, with no write', async () => {
    const s = await heldRun();
    await decideJuliusApproval({ runId: RUN, projectId: PROJECT, approvalId: s.approvalId, decision: 'APPROVED', approverId: FOUNDER, reason: 'First.' }, { store: s.memory as never, clock, approvers: anyone });
    const before = await snapshot(s.memory, s.approvalId);
    const { store, calls } = recorded(s.memory);
    const result = await decideJuliusApprovalGuarded(input({ approvalId: s.approvalId, decision: 'DENIED', reason: `Plan ${s.citation} reviewed.` }), { store, authority: AUTHORITY, clock });
    expect(result.exitCode).toBe(4);
    expect(result.line).toBe('APPROVAL_REFUSED reason=RUN_NOT_BLOCKED');
    expect(calls).not.toContain('decideApproval');
    expect(await snapshot(s.memory, s.approvalId)).toEqual(before);
  });
});

/* ======================================================== the refusals */

describe('V6 G-4: every refusal is decided before any write', () => {
  it('the words: decision, reason (blank, oversize, unsafe, uncited) and comment id', async () => {
    const s = await heldRun();
    const cases: Array<[Partial<JuliusDecideInput>, string]> = [
      [{ decision: 'MAYBE' }, 'DECISION_INVALID'],
      [{ reason: '   ' }, 'REASON_REQUIRED'],
      [{ reason: `${s.citation} ${'x'.repeat(280)}` }, 'REASON_TOO_LONG'],
      [{ reason: `Plan ${s.citation} ok; $(rm -rf /)` }, 'REASON_UNSAFE'],
      [{ reason: `Plan ${s.citation}\nreviewed` }, 'REASON_UNSAFE'],
      [{ reason: 'Plan reviewed, no citation.' }, 'REASON_UNCITED'],
      [{ commentId: 'abc', reason: `Plan ${s.citation} reviewed.` }, 'COMMENT_ID_INVALID'],
      [{ approvalId: 'approval:some-other', reason: `Plan ${s.citation} reviewed.` }, 'APPROVAL_NOT_THE_PENDING_ONE'],
      [{ runId: 'run:absent', reason: `Plan ${s.citation} reviewed.` }, 'RUN_NOT_FOUND'],
    ];
    for (const [overrides, code] of cases) {
      const { store, calls } = recorded(s.memory);
      const result = await decideJuliusApprovalGuarded(input({ approvalId: s.approvalId, ...overrides }), { store, authority: AUTHORITY, clock });
      expect(result, code).toEqual({ exitCode: 4, line: `APPROVAL_REFUSED reason=${code}` });
      expect(calls, code).not.toContain('decideApproval');
    }
    expect((await s.memory.pendingApprovals(RUN, PROJECT)).map((row) => row.approvalId), 'still exactly the one PENDING approval').toEqual([s.approvalId]);
  });

  it('zero or two PENDING approvals, a run not BLOCKED, an operation the file does not list, no plan evidence', async () => {
    const run = { runId: RUN, missionId: 'm', projectId: PROJECT, state: 'BLOCKED' as const, cardRevision: CARD, missionContractRevision: 1, projectBrainRevision: 0, version: 3 };
    const gate = (approvalId: string, operation = 'DISPATCH_WORKER') => ({ approvalId, operation, runId: RUN, projectId: PROJECT, taskId: 't', state: 'PENDING' });
    const stub = (over: Record<string, unknown>): JuliusDecideStore => ({
      loadRun: async () => run, pendingApprovals: async () => [gate('a1')],
      tasksForRun: async () => [{ taskId: 'p', taskType: 'plan', state: 'SUCCEEDED' }],
      evidenceForRun: async () => [{ evidenceId: 'ev-plan', taskId: 'p', status: 'PASSED', occurredAt: '2026-10-13T00:00:00.000Z' }],
      decideApproval: async () => { throw new Error('never reached'); },
      ...over,
    } as unknown as JuliusDecideStore);
    const go = (store: JuliusDecideStore) => decideJuliusApprovalGuarded(input({ approvalId: 'a1', reason: 'Plan ev-plan reviewed.' }), { store, authority: AUTHORITY, clock });
    expect((await go(stub({ pendingApprovals: async () => [] }))).line).toBe('APPROVAL_REFUSED reason=NOT_EXACTLY_ONE_PENDING_APPROVAL');
    expect((await go(stub({ pendingApprovals: async () => [gate('a1'), gate('a2')] }))).line).toBe('APPROVAL_REFUSED reason=NOT_EXACTLY_ONE_PENDING_APPROVAL');
    expect((await go(stub({ loadRun: async () => ({ ...run, state: 'READY' }) }))).line).toBe('APPROVAL_REFUSED reason=RUN_NOT_BLOCKED');
    expect((await go(stub({ pendingApprovals: async () => [gate('a1', 'USE_CAPABILITY')] }))).line).toBe('APPROVAL_REFUSED reason=APPROVER_NOT_AUTHORIZED');
    expect((await go(stub({ evidenceForRun: async () => [] }))).line).toBe('APPROVAL_REFUSED reason=NO_PLAN_EVIDENCE');
  });

  it('the citation is the newest PASSED evidence of the SUCCEEDED plan task, and nothing else', () => {
    const tasks = [{ taskId: 'p', taskType: 'plan', state: 'SUCCEEDED' }, { taskId: 'b', taskType: 'build', state: 'RUNNABLE' }, { taskId: 'q', taskType: 'plan', state: 'FAILED' }];
    const evidence = [
      { evidenceId: 'ev-old', taskId: 'p', status: 'PASSED', occurredAt: '2026-10-13T00:00:00.000Z' },
      { evidenceId: 'ev-new', taskId: 'p', status: 'PASSED', occurredAt: '2026-10-13T00:01:00.000Z' },
      { evidenceId: 'ev-fail', taskId: 'p', status: 'FAILED', occurredAt: '2026-10-13T00:02:00.000Z' },
      { evidenceId: 'ev-build', taskId: 'b', status: 'PASSED', occurredAt: '2026-10-13T00:03:00.000Z' },
      { evidenceId: 'ev-q', taskId: 'q', status: 'PASSED', occurredAt: '2026-10-13T00:04:00.000Z' },
    ];
    expect(juliusPlanCitation(tasks, evidence)).toBe('ev-new');
    expect(juliusPlanCitation(tasks, evidence.filter((row) => row.taskId !== 'p'))).toBeNull();
  });
});

/* ===================================================== the outcomes */

describe('V6 G-4: outcome mapping, one machine line each', () => {
  it('GRANT: exit 0, APPROVAL_DECIDED … decision=APPROVED run_state=READY; the record names the person and the reason; the run completes', async () => {
    const s = await heldRun();
    const reason = `Plan ${s.citation} reviewed; go ahead.`;
    const result = await decideJuliusApprovalGuarded(input({ approvalId: s.approvalId, reason }), { store: s.memory as unknown as JuliusDecideStore, authority: AUTHORITY, clock });
    expect(result).toEqual({ exitCode: 0, line: `APPROVAL_DECIDED approval=${s.approvalId} decision=APPROVED by=${FOUNDER} run_state=READY comment=42` });
    expect(await snapshot(s.memory, s.approvalId)).toMatchObject({ state: 'APPROVED', decidedBy: FOUNDER, decisionReason: reason });
    expect((await s.drive()).state).toBe('COMPLETED');
  });

  it('DENY: exit 0, decision=DENIED run_state=FAILED; the build never runs', async () => {
    const s = await heldRun();
    const result = await decideJuliusApprovalGuarded(input({ approvalId: s.approvalId, decision: 'DENIED', reason: `Plan ${s.citation} is not acceptable.` }), { store: s.memory as unknown as JuliusDecideStore, authority: AUTHORITY, clock });
    expect(result).toEqual({ exitCode: 0, line: `APPROVAL_DECIDED approval=${s.approvalId} decision=DENIED by=${FOUNDER} run_state=FAILED comment=42` });
    expect((await s.drive()).state).toBe('FAILED');
    expect(s.memory.taskRow(`${RUN}:build-1`)!.state).not.toBe('SUCCEEDED');
  });

  it('A RACE LOST AT THE STORE is never read as this caller\'s decision: exit 4 APPROVAL_ALREADY_DECIDED', async () => {
    const s = await heldRun();
    const store = new Proxy(s.memory as unknown as JuliusDecideStore, {
      get(target, key, receiver) {
        if (key === 'decideApproval') {
          // Another decider wins between this caller's read and its write: the PENDING-guarded UPDATE matches nothing.
          return async () => {
            await decideJuliusApproval({ runId: RUN, projectId: PROJECT, approvalId: s.approvalId, decision: 'DENIED', approverId: 'github:other#5', reason: 'The other one.' }, { store: s.memory as never, clock, approvers: anyone });
            return false;
          };
        }
        const value = Reflect.get(target, key, receiver) as unknown;
        return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    });
    const result = await decideJuliusApprovalGuarded(input({ approvalId: s.approvalId, reason: `Plan ${s.citation} reviewed.` }), { store, authority: AUTHORITY, clock });
    expect(result).toEqual({ exitCode: 4, line: `APPROVAL_ALREADY_DECIDED approval=${s.approvalId}` });
    expect(await snapshot(s.memory, s.approvalId)).toMatchObject({ state: 'DENIED', decidedBy: 'github:other#5' });
  });

  it('a run cancelled between the guard and the kernel: the kernel answers RUN_CANCELLED (exit 4), and the decider it records is the AUTHORISED caller, never a blank or a stranger', async () => {
    const s = await heldRun();
    let reads = 0;
    const store = new Proxy(s.memory as unknown as JuliusDecideStore, {
      get(target, key, receiver) {
        if (key === 'loadRun') {
          return async (runId: string, projectId: string) => {
            reads += 1;
            if (reads === 2) await cancelJuliusRun({ runId, projectId, actor: 'operator', reason: 'Cancelled mid-decision.' }, { store: s.memory as never, clock });
            return s.memory.loadRun(runId, projectId);
          };
        }
        const value = Reflect.get(target, key, receiver) as unknown;
        return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    });
    const result = await decideJuliusApprovalGuarded(input({ approvalId: s.approvalId, reason: `Plan ${s.citation} reviewed.` }), { store, authority: AUTHORITY, clock });
    expect(result).toEqual({ exitCode: 4, line: 'APPROVAL_REFUSED reason=RUN_CANCELLED' });
    // The kernel's own cancelled branch ran (the race the guard cannot close), with the identity the guard admitted.
    expect(await snapshot(s.memory, s.approvalId)).toMatchObject({ state: 'CANCELLED', decidedBy: FOUNDER });
  });
});

/* ===================================================== the run it names */

describe('V6 G-4: the CLI decides the run its contract names, exactly as the bootstrap derives it', () => {
  it('run:<contract-derived idempotency key>, the same for every invocation of the same file', () => {
    const raw = readFileSync(join(ROOT, '.github', 'julius-missions', 'julius-first-live', 'contract.json'), 'utf8');
    const target = juliusRunIdForContract(raw);
    const parsed = parseLiveMissionContract(raw);
    if (!target.ok || !parsed.ok) throw new Error('the committed contract must parse');
    expect(target.runId).toBe(`run:${compileBootstrapRequest(parsed.contract, [], 'card:julius-live:1').idempotencyKey}`);
    expect(target.projectId).toBe(parsed.contract.projectId);
    expect(juliusRunIdForContract('{').ok).toBe(false);
  });

  it('the bundle script exists, beside the live entrypoint\'s', () => {
    const scripts = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts;
    const build = scripts['relay:julius:decide:build'] ?? '';
    expect(build).toMatch(/^esbuild relay-bridge\/julius-approval-decide\.ts --bundle --platform=node --format=cjs /u);
    expect(build).toContain('--outfile=dist-relay-bridge/julius-approval-decide.cjs');
    expect(build).toContain('--external:pg');
  });
});
