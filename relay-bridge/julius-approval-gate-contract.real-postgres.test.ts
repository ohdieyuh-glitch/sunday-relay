import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { scriptedAdapter } from '../src/relay/mission/julius';
import { juliusTestDatabaseUrl } from '../src/relay/persistence/julius-test-database';
import { TransactionalWonderlandDatabase } from '../src/relay/persistence/wonderland-postgres';
import { composeJuliusMissionBootstrap, handleJuliusMissionRoute } from './julius-mission-routes';
import {
  architectWorker, CODER_WORKER, assembleLiveJuliusRuntime, createContextAndClaimHandoffs, driveJuliusRunToTerminal, reviewerWorker,
} from './julius/live-composition';
import { approvalScopesOf, gatedCardRevision, parseLiveMissionContract, type LiveMissionApprovalGate } from './julius/mission-contract';
import { createJuliusPostgresRuntimeStore } from './julius/postgres-store';

/**
 * V6 G-1 AGAINST A REAL POSTGRESQL: A GATED CONTRACT, END TO END TO THE HOLD.
 *
 * The contract's `approvalGates` clause is parsed by the production parser, the
 * card revision is the entrypoint's own `gatedCardRevision`, and the card's
 * `approvalScopes` is the entrypoint's own `approvalScopesOf`; the mission is
 * created by the bridge's bootstrap under that revision and driven by the run
 * loop over `createJuliusPostgresRuntimeStore(pool)`. Then, read from the tables
 * the evidence bundle reads (the amendment's E1 and E2):
 *
 *   - the plan dispatches and the build holds;
 *   - `julius_approvals` holds ONE PENDING row whose `policy_revision` is the gated
 *     revision, which is also the run's `card_revision`;
 *   - the run is BLOCKED, and its last transition's reason is `APPROVAL_REQUIRED`.
 *
 * Gated on JULIUS_TEST_DATABASE_URL like every real-postgres suite, and `todo` without it.
 */

const databaseUrl = juliusTestDatabaseUrl();
const suite = databaseUrl !== null ? describe : describe.todo;
const BASE_CARD = 'card:julius-live:1';
const nonce = () => randomBytes(4).toString('hex');
const GATE: LiveMissionApprovalGate = {
  id: 'gate-build', operation: 'DISPATCH_WORKER', roles: ['CODING_AGENT'], taskTypes: ['build'],
  reason: 'The governance owner signs off the reviewed plan before code is written.',
};
type Envelope = { data?: Record<string, unknown>; error?: { kind: string; message: string } };

suite('V6 G-1: a gated contract over a real PostgreSQL holds its build under the gated card revision', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl! });
    await new TransactionalWonderlandDatabase(pool).migrate();
  });
  afterAll(async () => pool?.end());

  it('plan dispatched, build held: ONE PENDING approval under the gated revision, the run BLOCKED by APPROVAL_REQUIRED', async () => {
    const id = nonce();
    const raw = JSON.stringify({
      missionId: `mission:gate-contract-${id}`, markerNamespace: `gate-contract-${id}`,
      projectId: `prj-gate-contract-${id}`, tenantId: `tenant-gate-contract-${id}`,
      objective: 'Write a comparison of the three candidate save-file formats.',
      requirements: ['Compare size, load time and forward compatibility.'], constraints: ['Touch only docs/.'],
      acceptanceCriteria: [{ id: 'AC-1', text: 'The comparison exists and covers all three.', blocking: true }],
      testCommand: '', workspacePath: '/workspace/gate-contract', limits: { spendUsd: 2, repairCycles: 1 },
      approvalGates: [GATE],
    });
    const parsed = parseLiveMissionContract(raw);
    if (!parsed.ok) throw new Error(parsed.problem);
    const contract = parsed.contract;
    expect(contract.approvalGates).toEqual([GATE]);
    const cardRevision = gatedCardRevision(BASE_CARD, contract.approvalGates);
    expect(cardRevision).toMatch(/^card:julius-live:1:gate-[0-9a-f]{16}$/u);

    const ports = { bootstrap: composeJuliusMissionBootstrap(pool), missingConfig: [], reviewerProvider: 'xai', cardRevision };
    const created = await handleJuliusMissionRoute({ method: 'POST', path: '/julius/missions', operator: true, body: raw }, ports);
    const data = (created?.body as Envelope).data as { runId: string; state: string };
    expect(data.state).toBe('READY');
    const runId = data.runId;

    const store = createContextAndClaimHandoffs(createJuliusPostgresRuntimeStore(pool)).store;
    const architect = scriptedAdapter(architectWorker({}), [{ kind: 'succeed', evidence: [{ type: 'ARTIFACT', status: 'PASSED', safeSummary: 'Plan written.' }], usdMicros: null }]);
    const coder = scriptedAdapter(CODER_WORKER, []);
    const reviewer = scriptedAdapter(reviewerWorker('hermes'), [{ kind: 'succeed', evidence: [{ type: 'REVIEW_FINDING', status: 'PASSED', safeSummary: 'No blocking findings.' }], usdMicros: null }]);
    const runtime = assembleLiveJuliusRuntime({
      store,
      entries: [
        { worker: architectWorker({}), adapter: architect },
        { worker: CODER_WORKER, adapter: coder },
        { worker: reviewerWorker('hermes'), adapter: reviewer },
      ],
      cardRevision, spendCeilingUsdMicros: 2_000_000, maxRepairRounds: 1,
      ...(contract.approvalGates === undefined ? {} : { approvalScopes: approvalScopesOf(contract.approvalGates) }),
    });
    const outcome = await driveJuliusRunToTerminal({ loop: runtime.loop, store, runId, projectId: contract.projectId, verification: runtime.verification });

    expect(outcome.state).toBe('BLOCKED');
    expect(architect.dispatches, 'the plan dispatched').toHaveLength(1);
    expect(coder.dispatches, 'the build is held').toHaveLength(0);

    const run = await pool.query<{ state: string; card_revision: string }>('SELECT state, card_revision FROM relay_wonderland.julius_runs WHERE run_id=$1', [runId]);
    expect(run.rows[0]).toEqual({ state: 'BLOCKED', card_revision: cardRevision });
    const approvals = await pool.query<{ state: string; policy_revision: string; reason_code: string; task_type: string }>(
      `SELECT a.state, a.policy_revision, a.reason_code, t.task_type FROM relay_wonderland.julius_approvals a
         JOIN relay_wonderland.julius_tasks t ON t.task_id=a.task_id WHERE a.run_id=$1`, [runId]);
    expect(approvals.rows).toEqual([{ state: 'PENDING', policy_revision: cardRevision, reason_code: 'CARD_SCOPED_APPROVAL_REQUIRED', task_type: 'build' }]);
    const last = await pool.query<{ to_state: string; reason_code: string }>(
      'SELECT to_state, reason_code FROM relay_wonderland.julius_transitions WHERE run_id=$1 ORDER BY sequence DESC LIMIT 1', [runId]);
    expect(last.rows[0]).toEqual({ to_state: 'BLOCKED', reason_code: 'APPROVAL_REQUIRED' });
  });
});
