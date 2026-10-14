import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { decideJuliusApproval, scriptedAdapter, type JuliusApproverAuthority } from '../src/relay/mission/julius';
import { JuliusLifecyclePostgresRepository } from '../src/relay/persistence/julius-lifecycle-postgres';
import { JuliusPostgresRepository } from '../src/relay/persistence/julius-postgres';
import { juliusTestDatabaseUrl } from '../src/relay/persistence/julius-test-database';
import { TransactionalWonderlandDatabase } from '../src/relay/persistence/wonderland-postgres';
import { composeJuliusMissionBootstrap, missionWorkerRequests } from './julius-mission-routes';
import {
  architectWorker, CODER_WORKER, assembleLiveJuliusRuntime, createContextAndClaimHandoffs, driveJuliusRunToTerminal, reviewerWorker,
} from './julius/live-composition';
import { approvalScopesOf, compileBootstrapRequest, gatedCardRevision, parseLiveMissionContract } from './julius/mission-contract';
import { createJuliusPostgresRuntimeStore } from './julius/postgres-store';

/**
 * V6 G-3 AGAINST A REAL POSTGRESQL: THE SECOND INVOCATION RESUMES THE SAME RUN.
 *
 * The founder's in-job approval (G-W) runs the entrypoint twice: LIVE-1 drives
 * the gated run until it is HELD (exit 3), a person decides, and LIVE (resume)
 * runs the SAME contract again. That works only if bootstrapping the same
 * contract a second time finds the run rather than making or breaking one. The
 * key is the contract's content (`compileBootstrapRequest`'s idempotency key),
 * and the bootstrap's replay path answers `resumed: true` with the stored state.
 * A load-bearing assumption for G-W, so it is executed here, through the
 * production compositions, before G-W is drafted into a patch:
 *
 *   bootstrap the gated contract -> drive (held) -> decideJuliusApproval
 *   -> bootstrap the SAME contract again -> resumed, the same runId, ONE run row,
 *      no duplicate tasks, criteria or brain rows, no bootstrap_persistence_failure
 *   -> the drive completes.
 *
 * Gated on JULIUS_TEST_DATABASE_URL like every real-postgres suite, and `todo` without it.
 */

const databaseUrl = juliusTestDatabaseUrl();
const suite = databaseUrl !== null ? describe : describe.todo;
const nonce = () => randomBytes(4).toString('hex');
const anyone: JuliusApproverAuthority = { async mayApprove() { return true; } };
// The three worker requests the bridge's own route compiles, from the live composition's definitions.
const WORKERS = missionWorkerRequests('hermes');

suite('V6 G-3: a held gated run, granted, is resumed by bootstrapping the same contract again', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl! });
    await new TransactionalWonderlandDatabase(pool).migrate();
  });
  afterAll(async () => pool?.end());

  it('LIVE-1 held, a grant, LIVE-2 resumes the SAME run (one run row, nothing seeded twice) and completes', async () => {
    const id = nonce();
    const raw = JSON.stringify({
      missionId: `mission:resume-${id}`, markerNamespace: `resume-${id}`, projectId: `prj-resume-${id}`, tenantId: `tenant-resume-${id}`,
      objective: 'Write a comparison of the three candidate save-file formats.',
      requirements: ['Compare size, load time and forward compatibility.'], constraints: ['Touch only docs/.'],
      acceptanceCriteria: [{ id: 'AC-1', text: 'The comparison exists and covers all three.', blocking: true }],
      testCommand: '', workspacePath: '/workspace/resume', limits: { spendUsd: 2, repairCycles: 1 },
      approvalGates: [{ id: 'gate-build', operation: 'DISPATCH_WORKER', roles: ['CODING_AGENT'], taskTypes: ['build'], reason: 'Sign off the plan first.' }],
    });
    const parsed = parseLiveMissionContract(raw);
    if (!parsed.ok) throw new Error(parsed.problem);
    const contract = parsed.contract;
    const cardRevision = gatedCardRevision('card:julius-live:1', contract.approvalGates);
    const executionId = `exec-resume-${id}`;
    const bootstrapFor = composeJuliusMissionBootstrap(pool);

    // ONE INVOCATION OF THE ENTRYPOINT, as the job composes it: bootstrap, assemble, drive.
    const invocation = async (afterBootstrap?: (runId: string) => Promise<void>) => {
      const submitted = await bootstrapFor(executionId, contract.tenantId).submit(compileBootstrapRequest(contract, WORKERS, cardRevision));
      const store = createContextAndClaimHandoffs(createJuliusPostgresRuntimeStore(pool)).store;
      const architect = scriptedAdapter(architectWorker({}), [{ kind: 'succeed', evidence: [{ type: 'ARTIFACT', status: 'PASSED', safeSummary: 'Plan written.' }], usdMicros: null }]);
      const coder = scriptedAdapter(CODER_WORKER, [{ kind: 'succeed', evidence: [
        { type: 'TEST', status: 'PASSED', safeSummary: 'Suite green.' }, { type: 'DIFF', status: 'PASSED', safeSummary: 'The change set.' },
      ], usdMicros: 1_000 }]);
      const reviewer = scriptedAdapter(reviewerWorker('hermes'), [{ kind: 'succeed', evidence: [{ type: 'REVIEW_FINDING', status: 'PASSED', safeSummary: 'No blocking findings.' }], usdMicros: null }]);
      if (!submitted.accepted) return { submitted, outcome: null, dispatches: { architect: 0, coder: 0, reviewer: 0 } };
      // What the bootstrap alone wrote, read before the drive adds anything of its own.
      if (afterBootstrap !== undefined) await afterBootstrap(submitted.runId);
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
      const outcome = await driveJuliusRunToTerminal({ loop: runtime.loop, store, runId: submitted.runId, projectId: contract.projectId, verification: runtime.verification });
      return { submitted, outcome, dispatches: { architect: architect.dispatches.length, coder: coder.dispatches.length, reviewer: reviewer.dispatches.length } };
    };
    const counts = async (runId: string) => {
      const one = async (sql: string) => (await pool.query<{ n: number }>(sql, [runId])).rows[0]!.n;
      return {
        runs: await one('SELECT count(*)::int AS n FROM relay_wonderland.julius_runs WHERE run_id=$1'),
        seededTasks: await one(`SELECT count(*)::int AS n FROM relay_wonderland.julius_tasks WHERE run_id=$1 AND task_type IN ('plan','build')`),
        criteria: await one('SELECT count(*)::int AS n FROM relay_wonderland.julius_acceptance_criteria WHERE run_id=$1'),
        brain: await one('SELECT count(*)::int AS n FROM relay_wonderland.julius_brain_entries WHERE run_id=$1'),
      };
    };

    const first = await invocation();
    expect(first.submitted).toMatchObject({ accepted: true, resumed: false });
    if (!first.submitted.accepted) throw new Error('first bootstrap refused');
    const runId = first.submitted.runId;
    expect(first.outcome).toMatchObject({ state: 'BLOCKED', heldForApproval: true });
    expect(first.dispatches.coder, 'LIVE-1 never started the build').toBe(0);
    const seededOnce = await counts(runId);
    expect(seededOnce.runs).toBe(1);

    const lifecycle = new JuliusLifecyclePostgresRepository(pool);
    const runs = new JuliusPostgresRepository(pool);
    const [gate] = await lifecycle.pendingApprovals(runId, contract.projectId);
    expect(gate, 'LIVE-1 left one PENDING approval').toBeDefined();
    const decided = await decideJuliusApproval({
      runId, projectId: contract.projectId, approvalId: gate!.approvalId, decision: 'APPROVED', approverId: 'github:founder#1', reason: 'Plan reviewed.',
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

    const beforeReplay = await counts(runId);
    let afterReplay: Awaited<ReturnType<typeof counts>> | null = null;
    const second = await invocation(async (id) => { afterReplay = await counts(id); });
    expect(second.submitted, 'the SAME contract finds the SAME run, never a bootstrap_persistence_failure').toMatchObject({ accepted: true, resumed: true, runId, state: 'READY' });
    expect(afterReplay, 'the replayed bootstrap seeded nothing: no second run, no task, criterion or brain row twice').toEqual(beforeReplay);
    expect(second.outcome).toMatchObject({ state: 'COMPLETED', heldForApproval: false });
    expect(second.dispatches.coder, 'LIVE-2 dispatched the build once').toBe(1);
    expect(second.dispatches.architect, 'and did not redo the plan').toBe(0);
    const total = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM relay_wonderland.julius_runs WHERE mission_id=$1', [contract.missionId]);
    expect(total.rows[0]!.n, 'one run for the mission').toBe(1);
  });
});
