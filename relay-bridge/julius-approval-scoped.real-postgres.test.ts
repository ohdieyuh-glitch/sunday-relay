import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  decideJuliusApproval,
  scriptedAdapter,
  type JuliusApprovalScope,
  type JuliusApproverAuthority,
} from '../src/relay/mission/julius';
import { JuliusLifecyclePostgresRepository } from '../src/relay/persistence/julius-lifecycle-postgres';
import { JuliusPostgresRepository } from '../src/relay/persistence/julius-postgres';
import { juliusTestDatabaseUrl } from '../src/relay/persistence/julius-test-database';
import { TransactionalWonderlandDatabase } from '../src/relay/persistence/wonderland-postgres';
import { composeJuliusMissionBootstrap, handleJuliusMissionRoute } from './julius-mission-routes';
import {
  architectWorker, CODER_WORKER, assembleLiveJuliusRuntime, createContextAndClaimHandoffs, driveJuliusRunToTerminal, reviewerWorker,
} from './julius/live-composition';
import { createJuliusPostgresRuntimeStore } from './julius/postgres-store';

/**
 * V6 G-2 AGAINST A REAL POSTGRESQL: THE SCOPED GATE HOLDS THE BUILD, AND THE WHOLE RUN WAITS.
 *
 * `julius-approval-scoped.test.ts` drives the scoped gate over the memory store.
 * This is the production half: a mission created by the bridge's own bootstrap
 * (`composeJuliusMissionBootstrap`), driven by the run loop over
 * `createJuliusPostgresRuntimeStore(pool)`, read back from the tables the
 * evidence bundle reads. What it pins (the amendment's E2/E3/E4/E6 window):
 *
 *   - ONE `julius_approvals` row, on the build, PENDING, `CARD_SCOPED_APPROVAL_REQUIRED`;
 *     the plan's provider DISPATCH row is earlier than its `requested_at`;
 *   - between `requested_at` and `decided_at` there is NO `julius.budget.reserved`
 *     event and no provider attempt for ANY task of the run;
 *   - after the grant, exactly ONE provider-class DISPATCH row for the build, later
 *     than `decided_at`; the review that follows asks nobody.
 *
 * Gated on JULIUS_TEST_DATABASE_URL like every real-postgres suite, and `todo`
 * without it. Every mission carries a random identity.
 */

const databaseUrl = juliusTestDatabaseUrl();
const suite = databaseUrl !== null ? describe : describe.todo;
const CARD = 'card:scoped-gate:1';
const BUILD_GATE: JuliusApprovalScope = { operation: 'DISPATCH_WORKER', roles: ['CODING_AGENT'], taskTypes: ['build'] };
const nonce = () => randomBytes(4).toString('hex');

const PLAN = [{ type: 'ARTIFACT' as const, status: 'PASSED' as const, safeSummary: 'Plan written.' }];
const BUILD = [
  { type: 'TEST' as const, status: 'PASSED' as const, safeSummary: 'Suite green.' },
  { type: 'DIFF' as const, status: 'PASSED' as const, safeSummary: 'The change set.' },
];
const REVIEW = [{ type: 'REVIEW_FINDING' as const, status: 'PASSED' as const, safeSummary: 'No blocking findings.' }];
const anyone: JuliusApproverAuthority = { async mayApprove() { return true; } };

function contractFor(id: string) {
  return {
    missionId: `mission:scoped-gate-${id}`, markerNamespace: `scoped-gate-${id}`,
    projectId: `prj-scoped-gate-${id}`, tenantId: `tenant-scoped-gate-${id}`,
    objective: 'Write a comparison of the three candidate save-file formats.',
    requirements: ['Compare size, load time and forward compatibility.'],
    constraints: ['Touch only docs/.'],
    acceptanceCriteria: [{ id: 'AC-1', text: 'The comparison exists and covers all three.', blocking: true }],
    testCommand: '',
    workspacePath: '/workspace/scoped-gate',
    limits: { spendUsd: 2, repairCycles: 1 },
  };
}

type Envelope = { data?: Record<string, unknown>; error?: { kind: string; message: string } };

suite('V6 G-2: a scoped gate over a real PostgreSQL holds the build, and the whole run, until it is granted', () => {
  let pool: Pool;
  let runs: JuliusPostgresRepository;
  let lifecycle: JuliusLifecyclePostgresRepository;
  let create: (body: string) => Promise<{ status: number; body: unknown } | null>;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl! });
    await new TransactionalWonderlandDatabase(pool).migrate();
    runs = new JuliusPostgresRepository(pool);
    lifecycle = new JuliusLifecyclePostgresRepository(pool);
    const ports = { bootstrap: composeJuliusMissionBootstrap(pool), missingConfig: [], reviewerProvider: 'xai', cardRevision: CARD };
    create = (body) => handleJuliusMissionRoute({ method: 'POST', path: '/julius/missions', operator: true, body }, ports);
  });
  afterAll(async () => pool?.end());

  it('ONE PENDING approval on the build; no reservation and no provider attempt while it waits; one build dispatch after the grant', async () => {
    const contract = contractFor(nonce());
    const result = await create(JSON.stringify(contract));
    const data = (result?.body as Envelope).data as { runId: string; state: string };
    expect(data.state).toBe('READY');
    const runId = data.runId;
    const projectId = contract.projectId;

    const store = createContextAndClaimHandoffs(createJuliusPostgresRuntimeStore(pool)).store;
    const architect = scriptedAdapter(architectWorker({}), [{ kind: 'succeed', evidence: PLAN, usdMicros: null }]);
    const coder = scriptedAdapter(CODER_WORKER, [{ kind: 'succeed', evidence: BUILD, usdMicros: 1_000 }]);
    const reviewer = scriptedAdapter(reviewerWorker('hermes'), [{ kind: 'succeed', evidence: REVIEW, usdMicros: null }]);
    const runtime = assembleLiveJuliusRuntime({
      store,
      entries: [
        { worker: architectWorker({}), adapter: architect },
        { worker: CODER_WORKER, adapter: coder },
        { worker: reviewerWorker('hermes'), adapter: reviewer },
      ],
      cardRevision: CARD, spendCeilingUsdMicros: 20_000_000, maxRepairRounds: 1, approvalScopes: [BUILD_GATE],
    });
    const drive = () => driveJuliusRunToTerminal({ loop: runtime.loop, store, runId, projectId, verification: runtime.verification });

    const held = await drive();
    expect(held.state).toBe('BLOCKED');
    expect(coder.dispatches, 'the build was not started').toHaveLength(0);
    expect(architect.dispatches).toHaveLength(1);

    const build = (await pool.query<{ task_id: string }>(
      `SELECT task_id FROM relay_wonderland.julius_tasks WHERE run_id=$1 AND task_type='build'`, [runId])).rows[0]!.task_id;
    const approvals = await pool.query<{ approval_id: string; task_id: string; state: string; reason_code: string; policy_revision: string; requested_at: Date }>(
      'SELECT approval_id, task_id, state, reason_code, policy_revision, requested_at FROM relay_wonderland.julius_approvals WHERE run_id=$1', [runId]);
    expect(approvals.rows).toHaveLength(1);
    const gate = approvals.rows[0]!;
    expect(gate).toMatchObject({ task_id: build, state: 'PENDING', reason_code: 'CARD_SCOPED_APPROVAL_REQUIRED', policy_revision: CARD });

    const providerRows = async () => (await pool.query<{ task_id: string; task_type: string; occurred_at: Date }>(
      `SELECT e.task_id, t.task_type, e.occurred_at FROM relay_wonderland.julius_trajectory_events e
         JOIN relay_wonderland.julius_tasks t ON t.task_id=e.task_id
        WHERE e.run_id=$1 AND e.event_kind IN ('DISPATCH','RETRY') AND e.provider_id IS NOT NULL
        ORDER BY e.occurred_at, e.trajectory_event_id`, [runId])).rows;
    const before = await providerRows();
    const plan = before.filter((row) => row.task_type === 'plan');
    expect(plan.length, 'the plan was dispatched before the gate').toBeGreaterThanOrEqual(1);
    expect(plan[0]!.occurred_at.getTime(), 'the plan DISPATCH row is earlier than requested_at').toBeLessThanOrEqual(gate.requested_at.getTime());
    expect(before.filter((row) => row.task_id === build), 'no provider attempt of the build while it is held').toHaveLength(0);

    // The run waits for a person: a few idle ticks start nothing.
    for (let i = 0; i < 3; i += 1) await runtime.loop.tick({ projectId });
    expect(coder.dispatches).toHaveLength(0);

    const decided = await decideJuliusApproval({
      runId, projectId, approvalId: gate.approval_id, decision: 'APPROVED', approverId: 'github:founder#1', reason: 'Plan reviewed; build approved.',
    }, {
      store: Object.assign(Object.create(null), {
        loadRun: runs.loadRun.bind(runs), transition: runs.transition.bind(runs),
        requestApproval: lifecycle.requestApproval.bind(lifecycle), loadApproval: lifecycle.loadApproval.bind(lifecycle),
        pendingApprovals: lifecycle.pendingApprovals.bind(lifecycle), decideApproval: lifecycle.decideApproval.bind(lifecycle),
        cancelRunTasks: lifecycle.cancelRunTasks.bind(lifecycle), recordLifecycle: lifecycle.recordLifecycle.bind(lifecycle),
      }),
      clock: { now: () => new Date().toISOString() }, approvers: anyone,
    });
    expect(decided).toMatchObject({ decided: true, state: 'APPROVED', runState: 'READY' });

    const done = await drive();
    expect(done.state).toBe('COMPLETED');
    const decidedAt = (await pool.query<{ decided_at: Date }>(
      'SELECT decided_at FROM relay_wonderland.julius_approvals WHERE approval_id=$1', [gate.approval_id])).rows[0]!.decided_at;

    // THE WINDOW [requested_at, decided_at]: no reservation and no provider attempt for ANY task.
    const reserved = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM relay_wonderland.events
        WHERE stream_id=$1 AND event_type='julius.budget.reserved' AND occurred_at >= $2 AND occurred_at <= $3`,
      [runId, gate.requested_at, decidedAt]);
    expect(reserved.rows[0]!.n, 'nothing was reserved while the run was held').toBe(0);
    const after = await providerRows();
    expect(after.filter((row) => row.occurred_at >= gate.requested_at && row.occurred_at <= decidedAt), 'no provider attempt inside the window').toHaveLength(0);
    const buildRows = after.filter((row) => row.task_id === build);
    expect(buildRows, 'exactly one provider dispatch of the build').toHaveLength(1);
    expect(buildRows[0]!.occurred_at.getTime(), 'and it came after the grant').toBeGreaterThan(decidedAt.getTime());
    expect(coder.dispatches).toHaveLength(1);

    const rows = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM relay_wonderland.julius_approvals WHERE run_id=$1', [runId]);
    expect(rows.rows[0]!.n, 'the reviews and everything else asked nobody').toBe(1);
  });
});
