import { randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { scriptedAdapter } from '../src/relay/mission/julius';
import { JuliusLifecyclePostgresRepository } from '../src/relay/persistence/julius-lifecycle-postgres';
import { juliusTestDatabaseUrl } from '../src/relay/persistence/julius-test-database';
import { TransactionalWonderlandDatabase } from '../src/relay/persistence/wonderland-postgres';
import {
  committedApproverAuthority, composeJuliusDecideStore, decideJuliusApprovalGuarded, juliusPlanCitation,
  juliusRunIdForContract, parseJuliusApproverAllowlist, parseJuliusWorkflowApprovers,
} from './julius-approval-decide';
import { composeJuliusMissionBootstrap, handleJuliusMissionRoute } from './julius-mission-routes';
import {
  architectWorker, CODER_WORKER, assembleLiveJuliusRuntime, createContextAndClaimHandoffs, driveJuliusRunToTerminal, reviewerWorker,
} from './julius/live-composition';
import { approvalScopesOf, gatedCardRevision, parseLiveMissionContract } from './julius/mission-contract';
import { createJuliusPostgresRuntimeStore } from './julius/postgres-store';

/**
 * V6 G-4 AGAINST A REAL POSTGRESQL: THE DECIDE CLI'S OWN COMPOSITION, END TO END.
 *
 * A gated mission is created by the bridge's bootstrap under its gated card revision and driven until its build
 * is HELD; then the decision goes through `composeJuliusDecideStore(pool)` and `decideJuliusApprovalGuarded`,
 * exactly as the CLI composes them, under a committed authority (an approver on both lists). It pins:
 *
 *   (a) GRANT: APPROVED with decided_by `github:<login>#<id>` and the decision reason; the
 *       `julius.approval.decided` event; BLOCKED -> READY `APPROVAL_GRANTED`; the next drive dispatches the build once;
 *   (b) RACE: two concurrent decisions (APPROVED and DENIED): exactly one wins at the store (`WHERE state='PENDING'`),
 *       the loser exits 4, and the run's state is the winner's;
 *   (c) DENY DRILL (the amendment's E8, at zero spend): the run FAILED by `APPROVAL_DENIED`, no provider attempt of
 *       the build and no `julius.budget.reserved` for it;
 *   (d) CRASH between the decision write and the run's move: the next drive heals the run, and the heal is NOT
 *       recorded as `APPROVAL_GRANTED` (so a V6 reading of E5 cannot be met by it).
 *
 * Gated on JULIUS_TEST_DATABASE_URL like every real-postgres suite, and `todo` without it.
 */

const databaseUrl = juliusTestDatabaseUrl();
const suite = databaseUrl !== null ? describe : describe.todo;
const nonce = () => randomBytes(4).toString('hex');
const FOUNDER = 'github:founder#1001';
const AUTHORITY = committedApproverAuthority({
  file: parseJuliusApproverAllowlist(JSON.stringify({ version: 1, approvers: [{ login: 'founder', id: 1001 }], operations: ['DISPATCH_WORKER'] })),
  workflow: parseJuliusWorkflowApprovers('founder#1001'),
});
const clock = { now: () => new Date().toISOString() };
const ids = { next: (kind: string) => `${kind}:${randomUUID()}` };
type Envelope = { data?: Record<string, unknown> };

suite('V6 G-4: the decide CLI composition over a real PostgreSQL', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl!, max: 8 });
    await new TransactionalWonderlandDatabase(pool).migrate();
  });
  afterAll(async () => pool?.end());

  /** A gated mission, created and driven until its build is held. */
  async function held() {
    const id = nonce();
    const raw = JSON.stringify({
      missionId: `mission:decide-${id}`, markerNamespace: `decide-${id}`, projectId: `prj-decide-${id}`, tenantId: `tenant-decide-${id}`,
      objective: 'Write a comparison of the three candidate save-file formats.',
      requirements: ['Compare size, load time and forward compatibility.'], constraints: ['Touch only docs/.'],
      acceptanceCriteria: [{ id: 'AC-1', text: 'The comparison exists and covers all three.', blocking: true }],
      testCommand: '', workspacePath: '/workspace/decide', limits: { spendUsd: 2, repairCycles: 1 },
      approvalGates: [{ id: 'gate-build', operation: 'DISPATCH_WORKER', roles: ['CODING_AGENT'], taskTypes: ['build'], reason: 'Sign off the plan first.' }],
    });
    const parsed = parseLiveMissionContract(raw);
    if (!parsed.ok) throw new Error(parsed.problem);
    const contract = parsed.contract;
    const cardRevision = gatedCardRevision('card:julius-live:1', contract.approvalGates);
    const ports = { bootstrap: composeJuliusMissionBootstrap(pool), missingConfig: [], reviewerProvider: 'xai', cardRevision };
    const created = await handleJuliusMissionRoute({ method: 'POST', path: '/julius/missions', operator: true, body: raw }, ports);
    const runId = ((created?.body as Envelope).data as { runId: string }).runId;
    const target = juliusRunIdForContract(raw);
    expect(target.ok && target.runId, 'the CLI names the run the bootstrap created').toBe(runId);

    const store = createContextAndClaimHandoffs(createJuliusPostgresRuntimeStore(pool)).store;
    const coder = scriptedAdapter(CODER_WORKER, [{ kind: 'succeed', evidence: [
      { type: 'TEST', status: 'PASSED', safeSummary: 'Suite green.' }, { type: 'DIFF', status: 'PASSED', safeSummary: 'The change set.' },
    ], usdMicros: 1_000 }]);
    const runtime = assembleLiveJuliusRuntime({
      store,
      entries: [
        { worker: architectWorker({}), adapter: scriptedAdapter(architectWorker({}), [{ kind: 'succeed', evidence: [{ type: 'ARTIFACT', status: 'PASSED', safeSummary: 'Plan written.' }], usdMicros: null }]) },
        { worker: CODER_WORKER, adapter: coder },
        { worker: reviewerWorker('hermes'), adapter: scriptedAdapter(reviewerWorker('hermes'), [{ kind: 'succeed', evidence: [{ type: 'REVIEW_FINDING', status: 'PASSED', safeSummary: 'No blocking findings.' }], usdMicros: null }]) },
      ],
      cardRevision, spendCeilingUsdMicros: 2_000_000, maxRepairRounds: 1,
      ...(contract.approvalGates === undefined ? {} : { approvalScopes: approvalScopesOf(contract.approvalGates) }),
    });
    const drive = () => driveJuliusRunToTerminal({ loop: runtime.loop, store, runId, projectId: contract.projectId, verification: runtime.verification });
    expect(await drive()).toMatchObject({ state: 'BLOCKED', heldForApproval: true });
    const decide = composeJuliusDecideStore(pool);
    const [gate] = await decide.store.pendingApprovals(runId, contract.projectId);
    const citation = juliusPlanCitation(await decide.store.tasksForRun(runId, contract.projectId), await decide.store.evidenceForRun(runId, contract.projectId));
    if (gate === undefined || citation === null) throw new Error('the gated run did not hold with a plan to cite');
    const build = (await pool.query<{ task_id: string }>(`SELECT task_id FROM relay_wonderland.julius_tasks WHERE run_id=$1 AND task_type='build'`, [runId])).rows[0]!.task_id;
    const guarded = (decision: 'APPROVED' | 'DENIED', commentId = '42') => decideJuliusApprovalGuarded({
      runId, projectId: contract.projectId, approvalId: gate.approvalId, decision, approverId: FOUNDER,
      reason: `Plan ${citation} reviewed: ${decision}.`, commentId,
    }, { store: decide.store, events: decide.events, authority: AUTHORITY, clock, ids });
    return { runId, projectId: contract.projectId, approvalId: gate.approvalId, citation, build, coder, drive, guarded };
  }

  const approvalRow = async (approvalId: string) => (await pool.query<{ state: string; decided_by: string | null; decision_reason: string | null; decided_at: Date | null }>(
    'SELECT state, decided_by, decision_reason, decided_at FROM relay_wonderland.julius_approvals WHERE approval_id=$1', [approvalId])).rows[0]!;
  const runState = async (runId: string) => (await pool.query<{ state: string }>('SELECT state FROM relay_wonderland.julius_runs WHERE run_id=$1', [runId])).rows[0]!.state;
  const transitions = async (runId: string) => (await pool.query<{ from_state: string; to_state: string; reason_code: string }>(
    'SELECT from_state, to_state, reason_code FROM relay_wonderland.julius_transitions WHERE run_id=$1 ORDER BY sequence', [runId])).rows;
  const providerRowsFor = async (runId: string, taskId: string) => (await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM relay_wonderland.julius_trajectory_events WHERE run_id=$1 AND task_id=$2 AND event_kind IN ('DISPATCH','RETRY') AND provider_id IS NOT NULL`,
    [runId, taskId])).rows[0]!.n;
  const reservedFor = async (runId: string, taskId: string) => (await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM relay_wonderland.events WHERE stream_id=$1 AND event_type='julius.budget.reserved' AND payload->>'taskId'=$2`,
    [runId, taskId])).rows[0]!.n;

  it('(a) GRANT through the CLI composition: the person, the reason, the event, APPROVAL_GRANTED, then one build dispatch', async () => {
    const s = await held();
    const result = await s.guarded('APPROVED');
    expect(result).toEqual({ exitCode: 0, line: `APPROVAL_DECIDED approval=${s.approvalId} decision=APPROVED by=${FOUNDER} run_state=READY comment=42` });
    expect(await approvalRow(s.approvalId)).toMatchObject({ state: 'APPROVED', decided_by: FOUNDER, decision_reason: `Plan ${s.citation} reviewed: APPROVED.` });
    const decided = await pool.query<{ facts: Record<string, unknown> }>(
      `SELECT payload->'facts' AS facts FROM relay_wonderland.events WHERE stream_id=$1 AND event_type='julius.approval.decided'`, [s.runId]);
    expect(decided.rows).toHaveLength(1);
    expect(decided.rows[0]!.facts).toMatchObject({ approvalId: s.approvalId, decision: 'APPROVED', decidedBy: FOUNDER });
    expect((await transitions(s.runId)).at(-1)).toEqual({ from_state: 'BLOCKED', to_state: 'READY', reason_code: 'APPROVAL_GRANTED' });
    expect((await s.drive()).state).toBe('COMPLETED');
    expect(s.coder.dispatches, 'the build dispatched exactly once, after the grant').toHaveLength(1);
    expect(await providerRowsFor(s.runId, s.build)).toBe(1);
  });

  it('(b) RACE: APPROVED and DENIED at once; exactly one wins, the loser exits 4, and the run is the winner\'s', async () => {
    const s = await held();
    const [approve, deny] = await Promise.all([s.guarded('APPROVED', '1'), s.guarded('DENIED', '2')]);
    const winners = [approve, deny].filter((result) => result.exitCode === 0);
    expect(winners, JSON.stringify([approve, deny])).toHaveLength(1);
    const loser = [approve, deny].find((result) => result.exitCode !== 0)!;
    expect(loser.exitCode).toBe(4);
    expect(loser.line).toMatch(/^(APPROVAL_ALREADY_DECIDED approval=|APPROVAL_REFUSED reason=(RUN_NOT_BLOCKED|NOT_EXACTLY_ONE_PENDING_APPROVAL)$)/u);
    const row = await approvalRow(s.approvalId);
    const state = await runState(s.runId);
    if (winners[0] === approve) expect([row.state, state]).toEqual(['APPROVED', 'READY']);
    else expect([row.state, state]).toEqual(['DENIED', 'FAILED']);
    const decidedEvents = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM relay_wonderland.events WHERE stream_id=$1 AND event_type='julius.approval.decided'`, [s.runId]);
    expect(decidedEvents.rows[0]!.n, 'one decision announced').toBe(1);
  });

  it('(c) DENY DRILL at zero spend: the run FAILED by APPROVAL_DENIED; the build had no provider attempt and no reservation', async () => {
    const s = await held();
    const result = await s.guarded('DENIED');
    expect(result).toEqual({ exitCode: 0, line: `APPROVAL_DECIDED approval=${s.approvalId} decision=DENIED by=${FOUNDER} run_state=FAILED comment=42` });
    expect((await s.drive()).state).toBe('FAILED');
    expect((await transitions(s.runId)).at(-1)).toMatchObject({ to_state: 'FAILED', reason_code: 'APPROVAL_DENIED' });
    expect(s.coder.dispatches).toHaveLength(0);
    expect(await providerRowsFor(s.runId, s.build)).toBe(0);
    expect(await reservedFor(s.runId, s.build)).toBe(0);
    const task = await pool.query<{ state: string }>('SELECT state FROM relay_wonderland.julius_tasks WHERE task_id=$1', [s.build]);
    expect(task.rows[0]!.state, 'the gated work never ran').not.toBe('SUCCEEDED');
  });

  it('(d) CRASH between the decision write and the run\'s move: the drive heals it, and the heal is not APPROVAL_GRANTED', async () => {
    const s = await held();
    // The first of decideJuliusApproval's two writes, alone: the approval row is decided, the run is still BLOCKED.
    expect(await new JuliusLifecyclePostgresRepository(pool).decideApproval({
      runId: s.runId, approvalId: s.approvalId, projectId: s.projectId, state: 'APPROVED',
      decidedBy: FOUNDER, decisionReason: `Plan ${s.citation} reviewed.`, decidedAt: new Date().toISOString(),
    })).toBe(true);
    expect(await runState(s.runId)).toBe('BLOCKED');
    expect((await s.drive()).state).toBe('COMPLETED');
    const walk = await transitions(s.runId);
    const leftBlocked = walk.filter((row) => row.from_state === 'BLOCKED');
    expect(leftBlocked.length).toBeGreaterThanOrEqual(1);
    expect(leftBlocked.map((row) => row.reason_code), 'a healed run never claims a recorded grant transition').not.toContain('APPROVAL_GRANTED');
    const decided = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM relay_wonderland.events WHERE stream_id=$1 AND event_type='julius.approval.decided'`, [s.runId]);
    expect(decided.rows[0]!.n, 'and no decision was announced').toBe(0);
  });
});
