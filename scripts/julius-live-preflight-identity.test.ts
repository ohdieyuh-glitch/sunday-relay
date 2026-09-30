import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { juliusTestDatabaseUrl } from '../src/relay/persistence/julius-test-database';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { JuliusPostgresRepository } from '../src/relay/persistence/julius-postgres';
import { JuliusRecoveryPostgresRepository } from '../src/relay/persistence/julius-recovery-postgres';
import { JuliusDispatchError, MAX_TASK_RECOVERIES } from '../src/relay/mission/julius';
import { WONDERLAND_MIGRATIONS } from '../src/relay/persistence/wonderland-postgres';
import { JuliusToolPostgresRepository } from '../src/relay/persistence/julius-tool-postgres';
import { JuliusToolRecoveryPostgresRepository } from '../src/relay/persistence/julius-tool-recovery-postgres';
import { JuliusToolSettlementPostgresRepository } from '../src/relay/persistence/julius-tool-settlement-postgres';
import { JULIUS_SERIALIZABLE_ATTEMPTS } from '../src/relay/persistence/julius-serializable';
import { JULIUS_ENCODED_TEXT_MARKER, decodePgJson, decodePgText } from '../src/relay/persistence/julius-storage-encoding';
import { EXECUTOR_SANDBOX_LIMITS, EXECUTOR_SANDBOX_POLICY } from '../relay-bridge/julius/sandbox-limits';
import { juliusAttemptCloseCommand, parseJuliusAttemptClose } from '../relay-bridge/julius/coder-workspace';
import { createExecutorShellPort, executorInvocationId, type ShellEffectResult } from '../relay-bridge/julius/executor-effects';
import { digestOf } from '../relay-bridge/julius/shell-settlement';
import { durableExecutorStandIn, refusedAt, type StandInOutcome } from './julius-executor-standin';
import {
  PREFLIGHT_PROJECT_PREFIX,
  cleanupPreflightIdentity,
  migrateIfNeeded,
  preflightIdentityFor,
  preflightNonce,
  seedPreflightIdentity,
  seedPreflightInvocation,
  type PreflightIdentity,
} from './julius-live-preflight-identity';

/**
 * REGRESSION — GitHub Actions run 33635375764, free dry run #2, and its proof in
 * PR #214: the executor's own persistence refused the preflight's first sandbox
 * with SQLSTATE 23503 because the preflight had seeded none of the ancestry
 * `julius_sandboxes` references. These cases run against a REAL PostgreSQL
 * (the same migrations, the same repositories) and prove the fixture is a
 * legitimate participant: the executor's insert succeeds, every identity field
 * matches the seeded rows, the foreign keys are still enabled, removing any
 * required parent — the invocation above all — brings 23503 back, another
 * preflight's rows cannot satisfy this one by accident, concurrent preflights
 * do not collide, and cleanup removes exactly this preflight's rows.
 *
 * They run wherever JULIUS_TEST_DATABASE_URL names a throwaway database, never the
 * inherited DATABASE_URL, and
 * DATABASE_URL point at a migrated-or-empty PostgreSQL — the sibling
 * infrastructure workflow's `first-live-topology` job — and are `todo`
 * elsewhere, like the other real-infrastructure cases. No provider is involved.
 */

const databaseUrl = juliusTestDatabaseUrl();
const enabled = databaseUrl !== null;
const suite = enabled ? describe : describe.todo;

/** The executor's identifier grammar (executor-schema.ts `identifier`). Every fixture id must satisfy it. */
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const TENANT = 'tenant';
const POLICY = 'card:julius-live:1';

/** The sandbox record the executor persists on `createSandbox`, built from a fixture the way the preflight builds it. */
const sandboxRecord = (identity: PreflightIdentity, invocationId: string, overrides: Partial<{ projectId: string; runId: string; taskId: string }> = {}) => ({
  sandboxId: invocationId, invocationId, tenantId: identity.tenantId,
  projectId: overrides.projectId ?? identity.projectId, runId: overrides.runId ?? identity.runId, taskId: overrides.taskId ?? identity.taskId,
  leaseGeneration: identity.leaseGeneration, policyRevision: identity.policyRevision,
  createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600_000).toISOString(),
  state: 'CREATING' as const, workspaceRef: null, runtimeKind: 'docker-rootless-boundary',
  limits: EXECUTOR_SANDBOX_LIMITS, policy: EXECUTOR_SANDBOX_POLICY, safeFailure: null,
  runtimeInstanceId: 'executor-preflight-regression', containerId: null, imageDigest: `sha256:${'0'.repeat(64)}`,
  lastHeartbeatAt: new Date().toISOString(),
});

const sqlstate = async (attempt: () => Promise<unknown>): Promise<string | null> => {
  try { await attempt(); return null; } catch (error) { return String((error as { code?: unknown }).code ?? 'no-code'); }
};

suite('dry run 33635375764 — the preflight identity satisfies the executor’s foreign keys', () => {
  let pool: Pool;
  let store: JuliusToolRecoveryPostgresRepository;
  const fixtures: PreflightIdentity[] = [];
  const fixture = (): PreflightIdentity => {
    const identity = preflightIdentityFor({ tenantId: TENANT, nonce: preflightNonce(), policyRevision: POLICY });
    fixtures.push(identity);
    return identity;
  };
  const invocationId = (identity: PreflightIdentity, step: number): string => `preflight:${identity.nonce}:${step}`;
  const DIGEST = 'a'.repeat(64);
  const seedInvocation = (identity: PreflightIdentity, step: number): Promise<{ dispatchGeneration: number }> =>
    seedPreflightInvocation(pool, identity, { invocationId: invocationId(identity, step), requestDigest: DIGEST, requestedAt: new Date().toISOString() });
  /** The executor's execute-time authorization, exactly as `DockerJuliusSandboxAdapter.executeTool` performs it. */
  const authorize = (identity: PreflightIdentity, step: number, dispatchGeneration: number) => store.authorizeExecution({
    sandboxId: invocationId(identity, step), runtimeInstanceId: 'executor-preflight-regression', invocationId: invocationId(identity, step),
    leaseGeneration: identity.leaseGeneration, dispatchGeneration, requestDigest: DIGEST, executionTokenHash: 'b'.repeat(64),
  });
  const bind = (identity: PreflightIdentity, step: number) => store.bindPhysical({
    sandboxId: invocationId(identity, step), runtimeInstanceId: 'executor-preflight-regression', leaseGeneration: identity.leaseGeneration,
    containerId: `container-${identity.nonce}-${step}`, workspaceRef: '/tmp/julius-workspace/tenant/ws',
  });
  const rowsFor = async (identity: PreflightIdentity): Promise<number> => {
    const result = await pool.query<{ total: string }>(
      `SELECT (SELECT count(*) FROM relay_wonderland.julius_sandboxes WHERE project_id=$1)
            + (SELECT count(*) FROM relay_wonderland.julius_tool_invocations WHERE project_id=$1)
            + (SELECT count(*) FROM relay_wonderland.julius_tasks WHERE run_id=$2)
            + (SELECT count(*) FROM relay_wonderland.julius_runs WHERE run_id=$2)
            + (SELECT count(*) FROM relay_wonderland.mission_contracts WHERE mission_id=$3)
            + (SELECT count(*) FROM relay_wonderland.project_members WHERE project_id=$1)
            + (SELECT count(*) FROM relay_wonderland.projects WHERE project_id=$1) AS total`,
      [identity.projectId, identity.runId, identity.missionId],
    );
    return Number(result.rows[0]?.total ?? 0);
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl! });
    // `migrate()` applies only versions `schema_migrations` does not hold, so calling it
    // after the preflight already migrated is a no-op rather than a 42P07.
    await migrateIfNeeded(pool);
    store = new JuliusToolRecoveryPostgresRepository(pool);
  });
  afterAll(async () => {
    for (const identity of fixtures) await cleanupPreflightIdentity(pool, identity).catch(() => undefined);
    await pool.end().catch(() => undefined);
  });

  it('applies the migrations and keeps every foreign key on the sandbox table enabled', async () => {
    const versions = await pool.query<{ version: string }>('SELECT version FROM relay_wonderland.schema_migrations ORDER BY version');
    expect(versions.rows.length).toBeGreaterThanOrEqual(21);
    const keys = await pool.query<{ conname: string; convalidated: boolean }>(
      `SELECT conname, convalidated FROM pg_constraint WHERE contype='f' AND conrelid='relay_wonderland.julius_sandboxes'::regclass`,
    );
    // projects, julius_runs, julius_tasks, and the composite key to julius_tool_invocations.
    expect(keys.rows.length).toBeGreaterThanOrEqual(4);
    for (const key of keys.rows) expect(key.convalidated, `${key.conname} must be enforced`).toBe(true);
  });

  it('seeds the ancestry before the first create, and the executor’s own persistence then accepts the sandbox', async () => {
    const identity = fixture();
    for (const id of [identity.projectId, identity.missionId, identity.runId, identity.taskId, invocationId(identity, 1)]) {
      expect(id).toMatch(IDENTIFIER);
    }
    await seedPreflightIdentity(pool, identity);
    // Fixture rows exist BEFORE any create is attempted.
    expect(await rowsFor(identity)).toBe(5);
    const { dispatchGeneration } = await seedInvocation(identity, 1);
    // REQUESTED → AUTHORIZED through the production repository, then the dispatch claimed for this
    // invocation alone: the state the live dispatcher leaves behind before it asks for a sandbox.
    const invocation = await pool.query<{ state: string; dispatch_generation: string; dispatch_claimed_by: string }>(
      'SELECT state, dispatch_generation, dispatch_claimed_by FROM relay_wonderland.julius_tool_invocations WHERE invocation_id=$1', [invocationId(identity, 1)]);
    expect(invocation.rows[0]).toEqual({ state: 'DISPATCHING', dispatch_generation: '1', dispatch_claimed_by: identity.workerId });
    expect(dispatchGeneration).toBe(1);
    const outbox = await pool.query<{ state: string; claimed_by: string }>('SELECT state, claimed_by FROM relay_wonderland.julius_tool_outbox WHERE invocation_id=$1', [invocationId(identity, 1)]);
    expect(outbox.rows[0]).toEqual({ state: 'CLAIMED', claimed_by: identity.workerId });

    // The exact insert that dry run #2 died on, through the executor's own repository.
    expect(await store.save(sandboxRecord(identity, invocationId(identity, 1)))).toBe(true);
    const saved = await pool.query<Record<string, string>>(
      'SELECT tenant_id, project_id, run_id, task_id, invocation_id, policy_revision, state FROM relay_wonderland.julius_sandboxes WHERE sandbox_id=$1',
      [invocationId(identity, 1)],
    );
    // Every identity field the executor persisted is the seeded ancestry, field for field.
    expect(saved.rows[0]).toEqual({
      tenant_id: identity.tenantId, project_id: identity.projectId, run_id: identity.runId, task_id: identity.taskId,
      invocation_id: invocationId(identity, 1), policy_revision: identity.policyRevision, state: 'CREATING',
    });
  });

  it('the executor then authorizes execution against the claimed dispatch, as the mission’s execute step requires', async () => {
    const identity = fixture();
    await seedPreflightIdentity(pool, identity);
    const { dispatchGeneration } = await seedInvocation(identity, 1);
    expect(await store.save(sandboxRecord(identity, invocationId(identity, 1)))).toBe(true);
    expect(await bind(identity, 1)).toBe(true);
    // `authorizeExecution` joins the invocation, the task and the run: DISPATCHING with this generation,
    // this digest, an ACTIVE task with a live lease, and a run whose card revision is the policy.
    const authorized = await authorize(identity, 1, dispatchGeneration);
    expect(authorized).toMatchObject({ sandboxId: invocationId(identity, 1), state: 'RUNNING' });
  });

  it('MUTATION: an invocation left AUTHORIZED, without the dispatch claim, loses execution authority exactly as PR #214’s host-visible entry did', async () => {
    const identity = fixture();
    await seedPreflightIdentity(pool, identity);
    // The state the fixture used to leave behind: REQUESTED → AUTHORIZED, no claim.
    const tools = new JuliusToolPostgresRepository(pool);
    const invocation = invocationId(identity, 1);
    await tools.request({
      invocationId: invocation, idempotencyKey: invocation, requestDigest: DIGEST,
      tenantId: identity.tenantId, projectId: identity.projectId, runId: identity.runId, taskId: identity.taskId,
      workerId: identity.workerId, leaseGeneration: identity.leaseGeneration, policyRevision: identity.policyRevision,
      toolId: 'shell.bash', toolVersion: '1', mutationClass: 'WORKSPACE', requestedAt: new Date().toISOString(),
    });
    expect(await tools.authorize({
      invocationId: invocation, tenantId: identity.tenantId, projectId: identity.projectId, requestDigest: DIGEST,
      policyRevision: identity.policyRevision, budgetReservationId: `budget:${invocation}`, authorizedAt: new Date().toISOString(),
    })).toBe(true);
    expect(await store.save(sandboxRecord(identity, invocation))).toBe(true);
    expect(await bind(identity, 1)).toBe(true);
    await expect(authorize(identity, 1, 1)).rejects.toThrow('sandbox_execution_authority_lost');
  });

  it('the dispatch claim touches this invocation only', async () => {
    const mine = fixture();
    const theirs = fixture();
    await seedPreflightIdentity(pool, mine);
    await seedPreflightIdentity(pool, theirs);
    // Theirs: AUTHORIZED and pending, the way a real dispatcher's candidate would sit.
    const tools = new JuliusToolPostgresRepository(pool);
    const pending = invocationId(theirs, 1);
    await tools.request({
      invocationId: pending, idempotencyKey: pending, requestDigest: DIGEST,
      tenantId: theirs.tenantId, projectId: theirs.projectId, runId: theirs.runId, taskId: theirs.taskId,
      workerId: theirs.workerId, leaseGeneration: theirs.leaseGeneration, policyRevision: theirs.policyRevision,
      toolId: 'shell.bash', toolVersion: '1', mutationClass: 'WORKSPACE', requestedAt: new Date().toISOString(),
    });
    await tools.authorize({
      invocationId: pending, tenantId: theirs.tenantId, projectId: theirs.projectId, requestDigest: DIGEST,
      policyRevision: theirs.policyRevision, budgetReservationId: `budget:${pending}`, authorizedAt: new Date().toISOString(),
    });
    await seedInvocation(mine, 1);
    const untouched = await pool.query<{ state: string; dispatch_generation: string }>('SELECT state, dispatch_generation FROM relay_wonderland.julius_tool_invocations WHERE invocation_id=$1', [pending]);
    expect(untouched.rows[0], 'another run’s pending dispatch must never be claimed by a preflight').toEqual({ state: 'AUTHORIZED', dispatch_generation: '0' });
  });

  /**
   * DEFECT B, AGAINST THE PRODUCTION CLAIM. The live shell port used to sweep up to sixteen AUTHORIZED
   * invocations of ANY run and keep its own, leaving every other one DISPATCHING under a caller that
   * would never execute it. Scoped to one invocation in one project, the same SQL takes that one only.
   */
  it('DEFECT B: the production dispatch claim, scoped, takes only its own invocation and leaves another project’s pending', async () => {
    const mine = fixture();
    const theirs = fixture();
    await seedPreflightIdentity(pool, mine);
    await seedPreflightIdentity(pool, theirs);
    const tools = new JuliusToolPostgresRepository(pool);
    const pend = async (identity: PreflightIdentity, step = 7): Promise<string> => {
      const id = invocationId(identity, step);
      await tools.request({
        invocationId: id, idempotencyKey: id, requestDigest: DIGEST,
        tenantId: identity.tenantId, projectId: identity.projectId, runId: identity.runId, taskId: identity.taskId,
        workerId: identity.workerId, leaseGeneration: identity.leaseGeneration, policyRevision: identity.policyRevision,
        toolId: 'shell.bash', toolVersion: '1', mutationClass: 'WORKSPACE', requestedAt: new Date().toISOString(),
      });
      expect(await tools.authorize({
        invocationId: id, tenantId: identity.tenantId, projectId: identity.projectId, requestDigest: DIGEST,
        policyRevision: identity.policyRevision, budgetReservationId: `budget:${id}`, authorizedAt: new Date().toISOString(),
      })).toBe(true);
      return id;
    };
    const theirsId = await pend(theirs);
    const mineId = await pend(mine);
    // A second step of the same task, pending in the SAME project: the project alone cannot tell them apart.
    const siblingId = await pend(mine, 8);
    const now = new Date().toISOString();
    const claimedUntil = new Date(Date.now() + 120_000).toISOString();
    const stateOf = async (id: string) => (await pool.query<{ state: string; dispatch_generation: string }>(
      'SELECT state, dispatch_generation FROM relay_wonderland.julius_tool_invocations WHERE invocation_id=$1', [id])).rows[0];

    const claimed = await tools.claimDispatch({ claimedBy: 'julius-live', now, claimedUntil, limit: 16, invocationId: mineId, projectId: mine.projectId });
    expect(claimed.map((entry) => entry.invocation.invocationId), 'the claim took its own invocation and nothing else').toEqual([mineId]);
    expect(await stateOf(theirsId), 'another project’s pending dispatch is still theirs to claim').toEqual({ state: 'AUTHORIZED', dispatch_generation: '0' });
    expect(await stateOf(siblingId), 'and so is another step pending in the same project').toEqual({ state: 'AUTHORIZED', dispatch_generation: '0' });

    const misScoped = await tools.claimDispatch({ claimedBy: 'julius-live', now, claimedUntil, limit: 16, invocationId: theirsId, projectId: mine.projectId });
    expect(misScoped, 'an invocation named under the wrong project is never claimed').toEqual([]);
    const theirClaim = await tools.claimDispatch({ claimedBy: 'julius-live-other', now, claimedUntil, limit: 16, invocationId: theirsId, projectId: theirs.projectId });
    expect(theirClaim.map((entry) => entry.invocation.invocationId), 'and its own port then claims it').toEqual([theirsId]);
  });

  it('MUTATION: without the invocation seed, the executor’s insert fails with 23503 exactly as dry run #2 did', async () => {
    const identity = fixture();
    await seedPreflightIdentity(pool, identity);
    // The ancestry is there; the invocation is not.
    expect(await sqlstate(() => store.save(sandboxRecord(identity, invocationId(identity, 1))))).toBe('23503');
    // And with the invocation present the same record is accepted.
    await seedInvocation(identity, 1);
    expect(await store.save(sandboxRecord(identity, invocationId(identity, 1)))).toBe(true);
  });

  it('removing any other required parent brings 23503 back too', async () => {
    const identity = fixture();
    await seedPreflightIdentity(pool, identity);
    await seedInvocation(identity, 2);
    const missing = preflightIdentityFor({ tenantId: TENANT, nonce: `${preflightNonce()}-unseeded`, policyRevision: POLICY });
    expect(await sqlstate(() => store.save(sandboxRecord(identity, invocationId(identity, 2), { taskId: missing.taskId })))).toBe('23503');
    expect(await sqlstate(() => store.save(sandboxRecord(identity, invocationId(identity, 2), { runId: missing.runId })))).toBe('23503');
    expect(await sqlstate(() => store.save(sandboxRecord(identity, invocationId(identity, 2), { projectId: missing.projectId })))).toBe('23503');
  });

  it('another preflight’s rows cannot satisfy this one by accident', async () => {
    const first = fixture();
    const second = fixture();
    await seedPreflightIdentity(pool, first);
    await seedPreflightIdentity(pool, second);
    await seedInvocation(first, 3);
    // Second's ancestry with first's invocation: the composite key needs all five columns to agree.
    expect(await sqlstate(() => store.save(sandboxRecord(second, invocationId(first, 3))))).toBe('23503');
    // First's project, but second's run and task: refused as well.
    expect(await sqlstate(() => store.save(sandboxRecord(first, invocationId(first, 3), { runId: second.runId, taskId: second.taskId })))).toBe('23503');
  });

  it('concurrent preflights carry distinct identities and both are accepted', async () => {
    const [a, b] = [fixture(), fixture()];
    expect(a.nonce).not.toBe(b.nonce);
    for (const key of ['projectId', 'missionId', 'runId', 'taskId'] as const) expect(a[key]).not.toBe(b[key]);
    expect(a.projectId.startsWith(PREFLIGHT_PROJECT_PREFIX)).toBe(true);
    await Promise.all([seedPreflightIdentity(pool, a), seedPreflightIdentity(pool, b)]);
    await Promise.all([seedInvocation(a, 1), seedInvocation(b, 1)]);
    const [savedA, savedB] = await Promise.all([store.save(sandboxRecord(a, invocationId(a, 1))), store.save(sandboxRecord(b, invocationId(b, 1)))]);
    expect(savedA).toBe(true);
    expect(savedB).toBe(true);
  });

  it('cleanup removes exactly this preflight’s rows and leaves every other preflight untouched', async () => {
    const mine = fixture();
    const theirs = fixture();
    await seedPreflightIdentity(pool, mine);
    await seedPreflightIdentity(pool, theirs);
    await seedInvocation(mine, 1);
    await seedInvocation(theirs, 1);
    await store.save(sandboxRecord(mine, invocationId(mine, 1)));
    await store.save(sandboxRecord(theirs, invocationId(theirs, 1)));
    const theirsBefore = await rowsFor(theirs);
    const players = await pool.query('SELECT count(*) AS n FROM relay_wonderland.players WHERE player_id=$1', [TENANT]);

    const report = await cleanupPreflightIdentity(pool, mine);
    expect(report.remaining).toBe(0);
    expect(report.deleted.julius_sandboxes).toBe(1);
    expect(report.deleted.julius_tool_invocations).toBe(1);
    expect(report.deleted.projects).toBe(1);
    expect(await rowsFor(mine)).toBe(0);
    expect(await rowsFor(theirs), 'the other preflight must be untouched').toBe(theirsBefore);
    // The tenant's player row is shared with the mission and is never deleted.
    expect((await pool.query('SELECT count(*) AS n FROM relay_wonderland.players WHERE player_id=$1', [TENANT])).rows[0]).toEqual(players.rows[0]);
  });

  /**
   * FOUND BY THE INDEPENDENT REVIEW OF PR #215, AND NOT INTRODUCED BY IT.
   *
   * `finishTask(state:'FAILED', nextAttemptAt)` is the runtime's "hand this
   * task back" call — the run loop yields a claim with it when the C.A.R.D.
   * concurrency allowance is spent, and the pipeline requeues an authorized
   * retry with it. The memory store answers by setting the task RUNNABLE. This
   * store set it FAILED, where no claim query can reach it again, so in
   * production a yielded or retried task was destroyed for a benign reason.
   * BOTH PATHS REACH A PAID MISSION, and the second one reaches it first.
   * The pipeline requeues an authorized retry, and the live C.A.R.D. sets
   * `automaticRetry`, so a rate-limited or timed-out worker takes that path.
   * The concurrency yield needs two tasks of one run claimable in the same
   * tick, and the live graph produces exactly that on the tick after the
   * architect succeeds: `build` depends on `plan`, and the review task is
   * created BLOCKED on `plan` too — by which time `plan` is already SUCCEEDED,
   * so both unblock together. The repository's own end-to-end case says so
   * ("`plan-1:review` becomes claimable in the same tick the plan succeeded").
   * With `concurrency: 1` against a claim limit of 4, one of the two is handed
   * back on that tick. Before this repair, PostgreSQL destroyed it.
   *
   * Two reviewers disagreed about this, in both directions. It is settled here
   * from the task graph and that end-to-end case, not from either verdict.
   *
   * These two cases are the behavioural proof, against the real schema: handed
   * back means claimable again, and a genuine failure still ends terminal.
   */
  it('a task handed back with a next attempt returns to RUNNABLE and can be claimed again', async () => {
    const identity = fixture();
    await seedPreflightIdentity(pool, identity);
    const repo = new JuliusPostgresRepository(pool);
    const now = new Date().toISOString();

    const handedBack = await repo.finishTask({
      taskId: identity.taskId, owner: 'julius-live-preflight',
      leaseGeneration: identity.leaseGeneration, state: 'FAILED', now, nextAttemptAt: now,
    });
    expect(handedBack, 'the lease was live and owned, so the call applies').toBe(true);

    const row = await pool.query<{ state: string; lease_owner: string | null }>(
      'SELECT state, lease_owner FROM relay_wonderland.julius_tasks WHERE task_id=$1', [identity.taskId],
    );
    expect(row.rows[0]?.state, 'handed back is not failed').toBe('RUNNABLE');
    expect(row.rows[0]?.lease_owner, 'and the lease is released').toBeNull();

    const claimed = await repo.claimRunnable({
      owner: 'another-worker', now,
      leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      limit: 5, projectId: identity.projectId,
    });
    expect(claimed.map((task) => task.taskId), 'the whole point of handing it back').toContain(identity.taskId);
  });

  it('MUTATION: a real failure, with no next attempt, still ends the task terminally', async () => {
    const identity = fixture();
    await seedPreflightIdentity(pool, identity);
    const repo = new JuliusPostgresRepository(pool);
    const now = new Date().toISOString();

    const finished = await repo.finishTask({
      taskId: identity.taskId, owner: 'julius-live-preflight',
      leaseGeneration: identity.leaseGeneration, state: 'FAILED', now,
    });
    expect(finished).toBe(true);

    const row = await pool.query<{ state: string }>(
      'SELECT state FROM relay_wonderland.julius_tasks WHERE task_id=$1', [identity.taskId],
    );
    expect(row.rows[0]?.state, 'a failure the runtime did not ask to requeue stays FAILED').toBe('FAILED');

    const claimed = await repo.claimRunnable({
      owner: 'another-worker', now,
      leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      limit: 5, projectId: identity.projectId,
    });
    expect(claimed.map((task) => task.taskId), 'and nothing revives it').not.toContain(identity.taskId);
  });

  /**
   * A CLAIM IS NOT AN EXECUTION, against the real schema.
   *
   * `claimRunnable` used to carry `attempt=t.attempt+1`, so the concurrency
   * hand-back proven above — the one the live graph performs on the tick after
   * the architect succeeds — also spent one of the task's three execution
   * attempts, on a provider that was never called. A task yielded twice
   * reached its FIRST real dispatch at attempt 3 of 3, where a rate limit is
   * refused as exhausted. The attempt is spent by `admitTask` now, in one
   * atomic statement immediately before provider-capable work begins.
   *
   * The offline model is held to the same rule in
   * `src/relay/mission/julius/julius-execution-attempts.test.ts`; this is the
   * proof that the SQL agrees, which is the half no laptop can run.
   */
  it('a claim takes a generation and spends no execution attempt; admission spends exactly one', async () => {
    const identity = fixture();
    await seedPreflightIdentity(pool, identity);
    const repo = new JuliusPostgresRepository(pool);
    const now = new Date().toISOString();

    const before = await pool.query<{ attempt: number; recoveries: number }>(
      'SELECT attempt, recoveries FROM relay_wonderland.julius_tasks WHERE task_id=$1', [identity.taskId],
    );
    expect(Number(before.rows[0]?.attempt), 'the seeded task has executed nothing').toBe(0);
    expect(Number(before.rows[0]?.recoveries), 'and has never been recovered').toBe(0);

    // Hand it back so it is claimable, then claim it for real.
    await repo.finishTask({
      taskId: identity.taskId, owner: 'julius-live-preflight',
      leaseGeneration: identity.leaseGeneration, state: 'FAILED', now, nextAttemptAt: now,
    });
    const [claim] = await repo.claimRunnable({
      owner: 'admitting-worker', now,
      leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      limit: 5, projectId: identity.projectId,
    });
    expect(claim?.taskId, 'the claim is the subject of this case').toBe(identity.taskId);

    const claimed = await pool.query<{ attempt: number; lease_generation: string }>(
      'SELECT attempt, lease_generation FROM relay_wonderland.julius_tasks WHERE task_id=$1', [identity.taskId],
    );
    expect(Number(claimed.rows[0]?.attempt), 'THE CLAIM SPENT NO ATTEMPT').toBe(0);
    expect(Number(claimed.rows[0]?.lease_generation), 'but it did take ownership')
      .toBeGreaterThan(identity.leaseGeneration);

    // A stale generation cannot admit, and must not move the counter.
    const stale = await repo.admitTask({
      taskId: identity.taskId, owner: 'admitting-worker', leaseGeneration: claim!.leaseGeneration - 1, now,
    });
    expect(stale, 'a lease that has moved on carries no authority').toBeNull();
    const wrongOwner = await repo.admitTask({
      taskId: identity.taskId, owner: 'someone-else', leaseGeneration: claim!.leaseGeneration, now,
    });
    expect(wrongOwner, 'nor does another owner holding the right generation').toBeNull();
    const untouched = await pool.query<{ attempt: number }>(
      'SELECT attempt FROM relay_wonderland.julius_tasks WHERE task_id=$1', [identity.taskId],
    );
    expect(Number(untouched.rows[0]?.attempt), 'a refused admission spends nothing').toBe(0);

    const admitted = await repo.admitTask({
      taskId: identity.taskId, owner: 'admitting-worker', leaseGeneration: claim!.leaseGeneration, now,
    });
    expect(admitted, 'the holder admits, and is told which attempt it runs as').toBe(1);
    const second = await repo.admitTask({
      taskId: identity.taskId, owner: 'admitting-worker', leaseGeneration: claim!.leaseGeneration, now,
    });
    expect(second, 'a second admission on the same lease is the second execution').toBe(2);
  });

  /**
   * AN EXPIRED LEASE CANNOT BE RECLAIMED BY A BARE CLAIM, against the real schema.
   *
   * The claim query used to offer an ACTIVE task whose lease had expired. That
   * reclaim raised only `lease_generation`, so a task claimed by a worker that
   * died before admission could be retaken forever — past `MAX_TASK_RECOVERIES`,
   * with no `recovery.action` row and no terminal behaviour. Recovery is the
   * only way back now, and this is the half no laptop can run.
   */
  it('a bare claim cannot reclaim an expired lease; the recovery sweep can, and counts it', async () => {
    const identity = fixture();
    await seedPreflightIdentity(pool, identity);
    const repo = new JuliusPostgresRepository(pool);
    const recovery = new JuliusRecoveryPostgresRepository(pool);
    const now = new Date().toISOString();

    // The seeded task is ACTIVE with a live lease; expire it, which is what a
    // worker that died between the claim and the admission leaves behind.
    await pool.query(
      "UPDATE relay_wonderland.julius_tasks SET lease_expires_at=now()-interval '1 minute' WHERE task_id=$1",
      [identity.taskId],
    );

    const bare = await repo.claimRunnable({
      owner: 'opportunist', now, leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      limit: 5, projectId: identity.projectId,
    });
    expect(bare.map((entry) => entry.taskId), 'the bypass is closed in the SQL').not.toContain(identity.taskId);
    const untouched = await pool.query<{ recoveries: number; state: string }>(
      'SELECT recoveries, state FROM relay_wonderland.julius_tasks WHERE task_id=$1', [identity.taskId],
    );
    expect(Number(untouched.rows[0]?.recoveries), 'and nothing was counted by a bypass').toBe(0);
    expect(untouched.rows[0]?.state, 'the task is still held, waiting for the sweep').toBe('ACTIVE');

    const actions = await recovery.recoverExpired(now, 10, identity.projectId);
    expect(actions.map((action) => action.taskId), 'the sweep is the one path back').toContain(identity.taskId);
    const recovered = await pool.query<{ recoveries: number; state: string; attempt: number }>(
      'SELECT recoveries, state, attempt FROM relay_wonderland.julius_tasks WHERE task_id=$1', [identity.taskId],
    );
    expect(Number(recovered.rows[0]?.recoveries), 'the reclaim is counted durably').toBe(1);
    expect(recovered.rows[0]?.state, 'and handed back for an ordinary claim').toBe('RUNNABLE');
    expect(Number(recovered.rows[0]?.attempt), 'the abandoned claim still spent no execution attempt').toBe(0);

    const afterRecovery = await repo.claimRunnable({
      owner: 'opportunist', now, leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      limit: 5, projectId: identity.projectId,
    });
    expect(afterRecovery.map((entry) => entry.taskId), 'now it is claimable').toContain(identity.taskId);
  });

  /**
   * THE RECOVERY CEILING PERSISTS, and ends the task when it is reached.
   */
  it('the recovery ceiling is durable and terminal', async () => {
    const identity = fixture();
    await seedPreflightIdentity(pool, identity);
    const repo = new JuliusPostgresRepository(pool);
    const recovery = new JuliusRecoveryPostgresRepository(pool);

    for (let round = 0; round < MAX_TASK_RECOVERIES + 1; round += 1) {
      await pool.query(
        "UPDATE relay_wonderland.julius_tasks SET state='ACTIVE',lease_owner='dying-worker',lease_expires_at=now()-interval '1 minute' WHERE task_id=$1",
        [identity.taskId],
      );
      const actions = await recovery.recoverExpired(new Date().toISOString(), 10, identity.projectId);
      const action = actions.find((entry) => entry.taskId === identity.taskId);
      if (round < MAX_TASK_RECOVERIES) {
        expect(action?.action, `round ${round + 1} still has turns left`).toBe('REQUEUE');
      } else {
        expect(action?.action, 'the ceiling ends it').toBe('FAIL_TASK');
        expect(action?.reasonCode, 'and names the bound that stopped it').toBe('RECOVERY_LIMIT_REACHED');
      }
    }

    const final = await pool.query<{ recoveries: number; state: string; attempt: number }>(
      'SELECT recoveries, state, attempt FROM relay_wonderland.julius_tasks WHERE task_id=$1', [identity.taskId],
    );
    expect(Number(final.rows[0]?.recoveries), 'every requeue counted').toBe(MAX_TASK_RECOVERIES);
    expect(final.rows[0]?.state, 'and the churn is terminated').toBe('FAILED');
    expect(Number(final.rows[0]?.attempt), 'with no execution ever charged').toBe(0);

    const claimed = await repo.claimRunnable({
      owner: 'anyone', now: new Date().toISOString(),
      leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(), limit: 5, projectId: identity.projectId,
    });
    expect(claimed.map((entry) => entry.taskId), 'nothing revives it').not.toContain(identity.taskId);
  });

  /**
   * MIGRATION 022 UPGRADES AN EXISTING 021 DATABASE, against a real one.
   *
   * This is the case CI can otherwise never see: every workflow migrates a
   * container that starts EMPTY, so the sentinel that used to guard `migrate()`
   * — a probe for one column of the then-last migration — could report
   * "already migrated" for a database at 021 and skip 022 entirely, and no job
   * would notice. The guard is the version ledger now; this proves it against
   * a database that genuinely holds 21 versions and not 22.
   */
  it('brings a database at 021 up to 022, without replaying what it already has', async () => {
    // Wind the real schema back to 021: drop the column 022 adds and its stamp.
    await pool.query('ALTER TABLE relay_wonderland.julius_tasks DROP COLUMN IF EXISTS recoveries');
    await pool.query("DELETE FROM relay_wonderland.schema_migrations WHERE version='022_julius_execution_attempts'");
    const at021 = await pool.query<{ count: string }>(
      "SELECT count(*) FROM relay_wonderland.schema_migrations WHERE version='022_julius_execution_attempts'",
    );
    expect(Number(at021.rows[0]?.count), 'the database is genuinely at 021').toBe(0);

    const result = await migrateIfNeeded(pool);
    expect(result.applied, 'exactly the missing version, and nothing replayed')
      .toEqual(['022_julius_execution_attempts']);
    // Derived, not pinned: a literal count would fail on migration 023 for a
    // reason that has nothing to do with what this case measures.
    expect(result.alreadyPresent, 'every other version was left alone')
      .toBe(WONDERLAND_MIGRATIONS.length - 1);

    const column = await pool.query<{ count: string }>(
      "SELECT count(*) FROM information_schema.columns WHERE table_schema='relay_wonderland' AND table_name='julius_tasks' AND column_name='recoveries'",
    );
    expect(Number(column.rows[0]?.count), 'the column the recovery bound depends on exists').toBe(1);

    // And a second call is a no-op rather than a 42P07.
    const again = await migrateIfNeeded(pool);
    expect(again.applied, 'nothing left to do').toEqual([]);
    expect(again.alreadyPresent).toBe(WONDERLAND_MIGRATIONS.length);
  });

  it('refuses to seed or clean up an identity it does not own, on any of its identifiers', async () => {
    const owned = fixture();
    for (const foreign of [
      { ...owned, projectId: 'prj-julius-first-live' },
      { ...owned, runId: 'run:some-real-mission' },
      { ...owned, taskId: 'task:some-real-task' },
      { ...owned, missionId: 'mission:some-real-mission' },
      // The three the settlement's budget needs are the nonce's too, or cleanup would reach a real session.
      { ...owned, executionId: 'execution:julius-live:mission:julius-live-6' },
      { ...owned, agentId: 'agent:tenant' },
      { ...owned, cardVersionId: 'card-v' },
    ]) {
      await expect(cleanupPreflightIdentity(pool, foreign)).rejects.toThrow('preflight_identity_not_owned');
      await expect(seedPreflightIdentity(pool, foreign)).rejects.toThrow('preflight_identity_not_owned');
    }
  });
});

/**
 * PAID RUN 36568129865 (Mission 6, run:efb6e20f0d11885bc5085a68): THE CLOSE-OUT, ON A REAL POSTGRESQL.
 *
 * RUNS IN CI ONLY AFTER THE FOUNDER'S REAL-POSTGRES WORKFLOW PATCH (JULIUS_TEST_DATABASE_URL) LANDS.
 * Since #288 every gated suite reads that variable alone and julius-real-infra.yml sets only
 * JULIUS_REAL_POSTGRES=1, so this suite, like every other gated one there, reports `todo` in CI today
 * (run 36594464267: this file 1 passed, 17 todo). These cases are NOT current CI proof. The proof that
 * runs on every PR now is the provider-free preflight (`npm run relay:julius:preflight`, the
 * first-live-topology host-visible entry): the real close-out through the real executor and store.
 *
 * What these hold that the preflight cannot reach without an executor that fails on purpose (the
 * topology job refuses any executor refusal): a close-out whose executor fails AFTER its effect, a
 * refused create, the terminal-state invariant across every open state, and the mutations that put the
 * pre-fix behaviour back and watch it fail. The executor is `durableExecutorStandIn`: its durable path
 * (save, bind, authorize, consume, record) with the REAL receipt store and the REAL repositories, minus
 * the container; the shell port, the settlement and the run repository are production code.
 */
suite('paid run 36568129865 — the NUL-separated close-out settles on real PostgreSQL, and a finished run leaves nothing open', () => {
  let pool: Pool;
  let receiptRoot: string;
  const fixtures: PreflightIdentity[] = [];
  const TREES = { baseTree: 'a'.repeat(40), startTree: 'b'.repeat(40) };
  const END = 'c'.repeat(40);
  const SECTION = '\u0000JULIUS-SECTION-9f2a\u0000';
  /** What the real close-out prints when an attempt modified README.md: five NUL-separated sections. */
  const CLOSE_OUT = [`END ${END}\n`, ' M README.md\u0000', 'M\u0000README.md\u0000', '', 'M\u0000README.md\u0000'].join(SECTION);
  const OPEN_STATES = "('REQUESTED','AUTHORIZED','DISPATCHING','RUNNING')";
  /** THE INVARIANT, as a query: a terminal run of this project holding an invocation that is not terminal. */
  const OPEN_IN_TERMINAL_RUNS = `SELECT i.invocation_id, i.state FROM relay_wonderland.julius_tool_invocations i
    JOIN relay_wonderland.julius_runs r ON r.run_id=i.run_id AND r.project_id=i.project_id
    WHERE r.project_id=$1 AND r.state IN('FAILED','COMPLETED','CANCELLED') AND i.state IN ${OPEN_STATES}`;

  const fixture = async (): Promise<PreflightIdentity> => {
    const identity = preflightIdentityFor({ tenantId: TENANT, nonce: preflightNonce(), policyRevision: POLICY });
    fixtures.push(identity);
    await seedPreflightIdentity(pool, identity);
    return identity;
  };
  /** The live shell port over the real repositories, dispatching to the stand-in executor. */
  const portFor = (identity: PreflightIdentity, outcome: (invocationId: string) => StandInOutcome, options: {
    settlement?: { settle: JuliusToolSettlementPostgresRepository['settle'] };
    recordReceipt?: JuliusToolRecoveryPostgresRepository['recordReceipt'];
  } = {}) => createExecutorShellPort({
    pool, tools: new JuliusToolPostgresRepository(pool),
    settlement: (options.settlement ?? new JuliusToolSettlementPostgresRepository(pool)) as JuliusToolSettlementPostgresRepository,
    client: durableExecutorStandIn({ pool, receiptRoot, outcome, recordReceipt: options.recordReceipt }),
    claims: { claimFor: () => ({ leaseGeneration: identity.leaseGeneration }) },
    tenantId: identity.tenantId, callerId: 'julius-live', policyRevision: identity.policyRevision,
    executionId: identity.executionId, workspaceSourceRef: '/tmp/julius-workspace/tenant/ws',
  });
  /** The close-out step exactly as the coding adapter issues it. */
  const closeOutStep = (identity: PreflightIdentity) => ({
    runId: identity.runId, projectId: identity.projectId, taskId: identity.taskId, workerId: identity.workerId,
    invocationKey: `${identity.taskId}:status`, command: juliusAttemptCloseCommand(TREES), timeoutMs: 30_000,
  });
  const closeOutId = (identity: PreflightIdentity): string => executorInvocationId(`${identity.taskId}:status`, identity.leaseGeneration);
  const rowOf = async (invocationId: string) => (await pool.query<{
    state: string; exit_code: number | null; recovery_state: string; stdout_preview: string; safe_summary: string | null; outbox_state: string; last_error: string | null;
  }>(`SELECT i.state, i.exit_code, i.recovery_state, i.stdout_preview, i.safe_summary, o.state AS outbox_state, o.last_error
      FROM relay_wonderland.julius_tool_invocations i JOIN relay_wonderland.julius_tool_outbox o USING(invocation_id) WHERE i.invocation_id=$1`, [invocationId])).rows[0];
  const openCount = async (identity: PreflightIdentity): Promise<number> => Number((await pool.query<{ n: string }>(
    `SELECT count(*) AS n FROM relay_wonderland.julius_tool_invocations WHERE project_id=$1 AND state IN ${OPEN_STATES}`, [identity.projectId])).rows[0]?.n);
  const codeOf = (error: unknown): string => String((error as { code?: unknown } | null)?.code ?? (error instanceof Error ? error.message : error));
  const failureOf = async (attempt: Promise<unknown>): Promise<unknown> => attempt.then(() => { throw new Error('expected the effect to fail'); }, (error: unknown) => error);

  /**
   * THE REPOSITORIES AS THEY WERE BEFORE THE FIX: the same modules, loaded fresh with `nul-escaped-v1`
   * taken back out. `encode: false` restores the raw writes; `decode: false` restores the digest that
   * was taken over whatever the column returned.
   */
  const preFix = async (strip: { readonly encode: boolean; readonly decode: boolean }) => {
    const path = '../src/relay/persistence/julius-storage-encoding';
    vi.resetModules();
    vi.doMock(path, async (importOriginal) => {
      const original = await importOriginal<typeof import('../src/relay/persistence/julius-storage-encoding')>();
      return {
        ...original,
        ...(strip.encode ? { encodePgText: (text: string) => text, encodePgJson: (value: unknown) => value, pgJson: (value: unknown) => JSON.stringify(value) } : {}),
        ...(strip.decode ? { decodePgText: (text: string) => text, decodePgJson: (value: unknown) => value } : {}),
      };
    });
    try {
      const recovery = await import('../src/relay/persistence/julius-tool-recovery-postgres');
      const settlement = await import('../src/relay/persistence/julius-tool-settlement-postgres');
      return { recovery: new recovery.JuliusToolRecoveryPostgresRepository(pool), settlement: new settlement.JuliusToolSettlementPostgresRepository(pool) };
    } finally {
      vi.doUnmock(path);
      vi.resetModules();
    }
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl! });
    await migrateIfNeeded(pool);
    receiptRoot = await mkdtemp(join(tmpdir(), 'julius-standin-receipts-'));
  });
  afterAll(async () => {
    for (const identity of fixtures) await cleanupPreflightIdentity(pool, identity).catch(() => undefined);
    await pool.end().catch(() => undefined);
  });

  it('(1)(2)(3)(4)(5)(7)(8) the close-out reaches PostgreSQL with its NULs, settles SUCCEEDED, is stored marked and exact, and Julius still parses every byte', async () => {
    const identity = await fixture();
    const result = await portFor(identity, () => ({ stdout: CLOSE_OUT, exitCode: 0 })).run(closeOutStep(identity));
    // What Julius receives is raw: the parser reads it exactly as the coding adapter does.
    expect(result).toMatchObject({ status: 'SUCCEEDED', exitCode: 0 });
    expect(result.stdout).toBe(CLOSE_OUT);
    const parsed = parseJuliusAttemptClose(result.stdout, true);
    expect(parsed.endTree).toBe(END);
    expect(parsed.own?.map((change) => change.path)).toEqual(['README.md']);

    const invocationId = closeOutId(identity);
    const row = await rowOf(invocationId);
    expect(row).toMatchObject({ state: 'SUCCEEDED', exit_code: 0, recovery_state: 'RECONCILED', outbox_state: 'DELIVERED' });
    // Explicit and reversible: the stored preview says it was encoded, and decodes to what Julius parsed.
    expect(row!.stdout_preview.startsWith(JULIUS_ENCODED_TEXT_MARKER)).toBe(true);
    expect(decodePgText(row!.stdout_preview)).toBe(CLOSE_OUT);
    expect(parseJuliusAttemptClose(decodePgText(row!.stdout_preview), true)).toEqual(parsed);
    const firstLine = await pool.query<{ line: string }>("SELECT split_part(stdout_preview, E'\\n', 1) AS line FROM relay_wonderland.julius_tool_invocations WHERE invocation_id=$1", [invocationId]);
    expect(firstLine.rows[0]?.line, 'inspectable in SQL: the first line names the encoding').toBe('julius-encoding:nul-escaped-v1');

    // The executor's receipt (the write that died with 22P05) and the settlement: marked, exact, digests over the decoded value.
    const receipt = (await pool.query<{ state: string; result: { stdout: string }; result_digest: string }>(
      'SELECT state, result, result_digest FROM relay_wonderland.julius_tool_execution_receipts WHERE invocation_id=$1', [invocationId])).rows[0]!;
    expect(receipt.state).toBe('COMPLETED_WITH_RESULT');
    expect(receipt.result.stdout.startsWith(JULIUS_ENCODED_TEXT_MARKER)).toBe(true);
    expect(decodePgJson<ShellEffectResult>(receipt.result).stdout).toBe(CLOSE_OUT);
    expect(digestOf(decodePgJson(receipt.result))).toBe(receipt.result_digest);
    const settled = (await pool.query<{ result: unknown; result_digest: string }>(
      'SELECT result, result_digest FROM relay_wonderland.julius_tool_settlements WHERE invocation_id=$1', [invocationId])).rows[0]!;
    expect(settled.result_digest).toBe(receipt.result_digest);
    expect(digestOf(decodePgJson(settled.result))).toBe(settled.result_digest);
    const evidence = await pool.query<{ status: string }>('SELECT status FROM relay_wonderland.julius_evidence WHERE evidence_id=$1', [`tool:${invocationId}`]);
    expect(evidence.rows[0]?.status).toBe('PASSED');
    const budget = await pool.query<{ state: string }>('SELECT state FROM relay_wonderland.budget_reservations WHERE reservation_id=$1', [`budget:${invocationId}`]);
    expect(budget.rows[0]?.state).toBe('COMMITTED');
    expect(await openCount(identity), 'nothing is left DISPATCHING').toBe(0);
  });

  it('(6) a failing close-out settles truthfully: FAILED with its exit code, its output stored and decoded the same way', async () => {
    const identity = await fixture();
    const result = await portFor(identity, () => ({ stdout: CLOSE_OUT, stderr: 'fatal: \u0000 in stderr too\n', exitCode: 3 })).run(closeOutStep(identity));
    expect(result).toMatchObject({ status: 'FAILED', exitCode: 3 });
    expect(result.stdout).toBe(CLOSE_OUT);
    const invocationId = closeOutId(identity);
    const row = await rowOf(invocationId);
    expect(row).toMatchObject({ state: 'FAILED', exit_code: 3, recovery_state: 'RECONCILED', outbox_state: 'DELIVERED' });
    expect(decodePgText(row!.stdout_preview)).toBe(CLOSE_OUT);
    const stderr = await pool.query<{ stderr_preview: string }>('SELECT stderr_preview FROM relay_wonderland.julius_tool_invocations WHERE invocation_id=$1', [invocationId]);
    expect(decodePgText(stderr.rows[0]!.stderr_preview)).toBe('fatal: \u0000 in stderr too\n');
    const receipt = await pool.query<{ state: string }>('SELECT state FROM relay_wonderland.julius_tool_execution_receipts WHERE invocation_id=$1', [invocationId]);
    expect(receipt.rows[0]?.state).toBe('FAILED_WITH_RESULT');
    const evidence = await pool.query<{ status: string }>('SELECT status FROM relay_wonderland.julius_evidence WHERE evidence_id=$1', [`tool:${invocationId}`]);
    expect(evidence.rows[0]?.status).toBe('FAILED');
    expect(await openCount(identity)).toBe(0);
  });

  it('(6)(8) an executor that fails AFTER the effect — paid run 36568129865\'s 500 — leaves the dispatch closed as an unknown outcome, never DISPATCHING', async () => {
    const identity = await fixture();
    const failure = await failureOf(portFor(identity, () => ({ stdout: CLOSE_OUT, failAfterReceipt: true })).run(closeOutStep(identity)));
    expect(failure).toBeInstanceOf(JuliusDispatchError);
    expect((failure as JuliusDispatchError).failureClass).toBe('executor_unavailable');
    const invocationId = closeOutId(identity);
    const row = await rowOf(invocationId);
    expect(row).toMatchObject({ state: 'FAILED', recovery_state: 'UNKNOWN_OUTCOME', outbox_state: 'DEAD', last_error: 'executor_unavailable' });
    expect(row!.safe_summary).toContain('unknown to Julius');
    // The effect's own record survives, decodable: the unknown outcome is inspectable, not lost.
    const receipt = (await pool.query<{ result: unknown }>('SELECT result FROM relay_wonderland.julius_tool_execution_receipts WHERE invocation_id=$1', [invocationId])).rows[0];
    expect(decodePgJson<ShellEffectResult>(receipt?.result).stdout).toBe(CLOSE_OUT);
    expect(await openCount(identity)).toBe(0);
  });

  it('(8) a refused create is closed as no effect: FAILED, recovery NONE, no receipt, never DISPATCHING', async () => {
    const identity = await fixture();
    const failure = await failureOf(portFor(identity, () => refusedAt('create')).run(closeOutStep(identity)));
    expect(failure).toBeInstanceOf(JuliusDispatchError);
    const invocationId = closeOutId(identity);
    expect(await rowOf(invocationId)).toMatchObject({ state: 'FAILED', recovery_state: 'NONE', outbox_state: 'DEAD', last_error: 'executor_unavailable' });
    expect((await rowOf(invocationId))!.safe_summary).toContain('the executor ran nothing');
    const receipts = await pool.query<{ n: string }>('SELECT count(*) AS n FROM relay_wonderland.julius_tool_execution_receipts WHERE invocation_id=$1', [invocationId]);
    expect(receipts.rows[0]?.n).toBe('0');
    expect(await openCount(identity)).toBe(0);
  });

  it('(9) MUTATION: with the encoding taken out, the executor\'s receipt write is refused with 22P05 — exactly paid run 36568129865 — and the dispatch is still closed, not left DISPATCHING', async () => {
    const identity = await fixture();
    const { recovery } = await preFix({ encode: true, decode: false });
    expect(recovery, 'the mutant is a fresh module, not the fixed one').not.toBeInstanceOf(JuliusToolRecoveryPostgresRepository);
    const refused: string[] = [];
    const port = portFor(identity, () => ({ stdout: CLOSE_OUT }), {
      recordReceipt: async (receipt) => { try { return await recovery.recordReceipt(receipt); } catch (error) { refused.push(codeOf(error)); throw error; } },
    });
    expect(await failureOf(port.run(closeOutStep(identity)))).toBeInstanceOf(JuliusDispatchError);
    expect(refused).toEqual(['22P05']);
    expect(await rowOf(closeOutId(identity))).toMatchObject({ state: 'FAILED', recovery_state: 'UNKNOWN_OUTCOME', outbox_state: 'DEAD' });
    expect(await openCount(identity)).toBe(0);
  });

  it('(9) MUTATION: with the encoding taken out of the settlement, its preview write is refused with 22021; the dispatch is closed as unknown', async () => {
    const identity = await fixture();
    const { settlement } = await preFix({ encode: true, decode: false });
    const failure = await failureOf(portFor(identity, () => ({ stdout: CLOSE_OUT }), { settlement }).run(closeOutStep(identity)));
    expect(codeOf(failure)).toBe('22021');
    expect(await rowOf(closeOutId(identity))).toMatchObject({ state: 'FAILED', recovery_state: 'UNKNOWN_OUTCOME', outbox_state: 'DEAD', last_error: 'tool_settlement_failed' });
    expect(await openCount(identity)).toBe(0);
  });

  it('(9) MUTATION: a settlement that digests the STORED receipt instead of the decoded one refuses the honest result as a conflict', async () => {
    const identity = await fixture();
    const { settlement } = await preFix({ encode: false, decode: true });
    const failure = await failureOf(portFor(identity, () => ({ stdout: CLOSE_OUT }), { settlement }).run(closeOutStep(identity)));
    expect(codeOf(failure)).toBe('tool_settlement_receipt_conflict');
    expect(await openCount(identity)).toBe(0);
  });

  /**
   * A settlement whose attempts meet a REAL serialization conflict: once an attempt holds its snapshot,
   * a concurrent transaction commits a change to the run's `stream_sequences` row, which the attempt's
   * event then upserts. PostgreSQL refuses that attempt with 40001. `conflicts` says how many attempts.
   */
  const conflictedSettlement = (identity: PreflightIdentity, conflicts: number) => {
    const seen = { attempts: 0 };
    const settlement = new JuliusToolSettlementPostgresRepository(pool, undefined, async (point) => {
      if (point === 'AFTER_BUDGET') {
        seen.attempts += 1;
        if (seen.attempts <= conflicts) await pool.query('UPDATE relay_wonderland.stream_sequences SET next_sequence=next_sequence+1 WHERE stream_id=$1', [identity.runId]);
      }
    });
    return { settlement, seen };
  };
  const seedStream = (identity: PreflightIdentity) => pool.query('INSERT INTO relay_wonderland.stream_sequences(stream_id,next_sequence) VALUES($1,2) ON CONFLICT DO NOTHING', [identity.runId]);

  it('SERIALIZATION: a settlement that meets a real concurrent commit on the run\'s event stream (40001) is replayed and settles', async () => {
    const identity = await fixture();
    await seedStream(identity);
    const { settlement, seen } = conflictedSettlement(identity, 1);
    const result = await portFor(identity, () => ({ stdout: CLOSE_OUT }), { settlement }).run(closeOutStep(identity));
    expect(result).toMatchObject({ status: 'SUCCEEDED', stdout: CLOSE_OUT });
    expect(seen.attempts, 'refused once, settled on the replay').toBe(2);
    expect(await rowOf(closeOutId(identity))).toMatchObject({ state: 'SUCCEEDED', recovery_state: 'RECONCILED', outbox_state: 'DELIVERED' });
    const settlements = await pool.query<{ n: string }>('SELECT count(*) AS n FROM relay_wonderland.julius_tool_settlements WHERE invocation_id=$1', [closeOutId(identity)]);
    expect(settlements.rows[0]?.n, 'exactly one settlement, however many attempts').toBe('1');
    expect(await openCount(identity)).toBe(0);
  });

  /**
   * THE BOUND IS THE SHARED POLICY'S, NOT A LOCAL THREE. The settlement carried its own three-attempt
   * loop when this case was written; it now runs on `juliusSerializable`, whose bound is
   * JULIUS_SERIALIZABLE_ATTEMPTS. Three conflicts are therefore absorbed on the fourth attempt, which
   * is the intended behaviour, and only a conflict on EVERY attempt may surface. The case never ran
   * before the real-PostgreSQL CI step existed (Windows refuses the directory fsync this suite needs),
   * so the stale three went unnoticed until its first execution on Linux.
   */
  it('SERIALIZATION: a conflict on every attempt surfaces as 40001, and the dispatch is closed as an unknown outcome, never DISPATCHING', async () => {
    const identity = await fixture();
    await seedStream(identity);
    const { settlement, seen } = conflictedSettlement(identity, JULIUS_SERIALIZABLE_ATTEMPTS);
    const failure = await failureOf(portFor(identity, () => ({ stdout: CLOSE_OUT }), { settlement }).run(closeOutStep(identity)));
    expect(codeOf(failure)).toBe('40001');
    expect(seen.attempts, 'every attempt the shared policy allows was made, and each met a conflict').toBe(JULIUS_SERIALIZABLE_ATTEMPTS);
    expect(await rowOf(closeOutId(identity))).toMatchObject({ state: 'FAILED', recovery_state: 'UNKNOWN_OUTCOME', outbox_state: 'DEAD', last_error: 'tool_settlement_failed' });
    expect(await openCount(identity)).toBe(0);
  });

  it('INVARIANT: a run made terminal through the store closes every open invocation as what it is, surfaces each by name, and touches nothing else', async () => {
    const mine = await fixture();
    const theirs = await fixture();
    // Settled first: the live port's dispatch claim is fleet-wide, so the open ones are made after it.
    await portFor(mine, () => ({ stdout: CLOSE_OUT })).run(closeOutStep(mine));
    const settledId = closeOutId(mine);
    const dispatchedId = `preflight:${mine.nonce}:dispatched`, authorizedId = `preflight:${mine.nonce}:authorized`, foreignId = `preflight:${theirs.nonce}:dispatched`;
    await seedPreflightInvocation(pool, mine, { invocationId: dispatchedId, requestDigest: 'a'.repeat(64), requestedAt: new Date().toISOString() });
    await seedPreflightInvocation(pool, theirs, { invocationId: foreignId, requestDigest: 'a'.repeat(64), requestedAt: new Date().toISOString() });
    const tools = new JuliusToolPostgresRepository(pool);
    await tools.request({
      invocationId: authorizedId, idempotencyKey: authorizedId, requestDigest: 'a'.repeat(64), tenantId: mine.tenantId, projectId: mine.projectId,
      runId: mine.runId, taskId: mine.taskId, workerId: mine.workerId, leaseGeneration: mine.leaseGeneration, policyRevision: mine.policyRevision,
      toolId: 'shell.bash', toolVersion: '1', mutationClass: 'WORKSPACE', requestedAt: new Date().toISOString(),
    });
    expect(await tools.authorize({ invocationId: authorizedId, tenantId: mine.tenantId, projectId: mine.projectId, requestDigest: 'a'.repeat(64), policyRevision: mine.policyRevision, budgetReservationId: `budget:${authorizedId}`, authorizedAt: new Date().toISOString() })).toBe(true);

    const runs = new JuliusPostgresRepository(pool);
    const run = (await runs.loadRun(mine.runId, mine.projectId))!;
    const ended = await runs.transition({ commandId: `invariant:${mine.nonce}`, runId: mine.runId, projectId: mine.projectId, expectedVersion: run.version, to: 'FAILED', reasonCode: 'TASK_FAILED', safeSummary: 'The coder failed with its close-out still dispatched.', evidenceIds: [], occurredAt: new Date().toISOString() });
    expect(ended.state).toBe('FAILED');

    expect(await rowOf(dispatchedId)).toMatchObject({ state: 'FAILED', recovery_state: 'UNKNOWN_OUTCOME', outbox_state: 'DEAD', last_error: 'run_terminal_unsettled' });
    expect(await rowOf(authorizedId)).toMatchObject({ state: 'CANCELLED', recovery_state: 'NONE', outbox_state: 'DEAD' });
    expect(await rowOf(settledId), 'a settled invocation keeps its truth').toMatchObject({ state: 'SUCCEEDED', recovery_state: 'RECONCILED', outbox_state: 'DELIVERED' });
    expect(await rowOf(foreignId), 'another run is untouched').toMatchObject({ state: 'DISPATCHING', outbox_state: 'CLAIMED' });
    expect((await pool.query(OPEN_IN_TERMINAL_RUNS, [mine.projectId])).rows).toEqual([]);

    const surfaced = await pool.query<{ event_id: string; code: string; failure_class: string; prior: string; closed: string; recovery: string }>(
      `SELECT event_id, payload->'facts'->>'code' AS code, payload->'facts'->>'failureClass' AS failure_class, payload->'facts'->>'priorState' AS prior,
              payload->'facts'->>'closedAs' AS closed, payload->'facts'->>'recoveryState' AS recovery
       FROM relay_wonderland.events WHERE project_id=$1 AND event_type='julius.recovery.action' ORDER BY event_id`, [mine.projectId]);
    expect(surfaced.rows).toEqual([
      { event_id: `julius:tool-invocation-closed:${authorizedId}`, code: 'TOOL_INVOCATION_UNRESOLVED', failure_class: 'infrastructure_evidence_integrity', prior: 'AUTHORIZED', closed: 'CANCELLED', recovery: 'NONE' },
      { event_id: `julius:tool-invocation-closed:${dispatchedId}`, code: 'TOOL_INVOCATION_UNRESOLVED', failure_class: 'infrastructure_evidence_integrity', prior: 'DISPATCHING', closed: 'FAILED', recovery: 'UNKNOWN_OUTCOME' },
    ]);

    // Nothing new opens on the finished run, and a late settlement of the closed dispatch is refused.
    await expect(tools.request({
      invocationId: `${dispatchedId}:late`, idempotencyKey: `${dispatchedId}:late`, requestDigest: 'a'.repeat(64), tenantId: mine.tenantId, projectId: mine.projectId,
      runId: mine.runId, taskId: mine.taskId, workerId: mine.workerId, leaseGeneration: mine.leaseGeneration, policyRevision: mine.policyRevision,
      toolId: 'shell.bash', toolVersion: '1', mutationClass: 'WORKSPACE', requestedAt: new Date().toISOString(),
    })).rejects.toThrow('tool_run_terminal');
    const lateResult = { invocationId: dispatchedId, status: 'SUCCEEDED' as const, exitCode: 0, safeSummary: 'late', stdout: CLOSE_OUT, stderr: '', stdoutRef: null, stderrRef: null, artifacts: [], evidence: [], durationMs: 1, resourceUsage: { toolCalls: 1, runtimeMs: 1, outputBytes: 1 }, policyDecisionRef: POLICY, mutations: [] };
    await expect(new JuliusToolSettlementPostgresRepository(pool).settle({
      settlementId: `settlement:${dispatchedId}`, invocationId: dispatchedId, dispatchGeneration: 1, resultDigest: digestOf(lateResult), result: lateResult,
      artifacts: [], evidence: [], taskOutcome: null, occurredAt: new Date().toISOString(),
    })).rejects.toThrow('tool_settlement_authority_lost');
  });

  it('INVARIANT: a transition that is not terminal closes nothing', async () => {
    const identity = await fixture();
    const invocationId = `preflight:${identity.nonce}:dispatched`;
    await seedPreflightInvocation(pool, identity, { invocationId, requestDigest: 'a'.repeat(64), requestedAt: new Date().toISOString() });
    const runs = new JuliusPostgresRepository(pool);
    const run = (await runs.loadRun(identity.runId, identity.projectId))!;
    await runs.transition({ commandId: `waiting:${identity.nonce}`, runId: identity.runId, projectId: identity.projectId, expectedVersion: run.version, to: 'WAITING', reasonCode: 'TASKS_BLOCKED', safeSummary: 'Waiting.', evidenceIds: [], occurredAt: new Date().toISOString() });
    expect(await rowOf(invocationId)).toMatchObject({ state: 'DISPATCHING', outbox_state: 'CLAIMED' });
    const events = await pool.query<{ n: string }>("SELECT count(*) AS n FROM relay_wonderland.events WHERE project_id=$1 AND event_type='julius.recovery.action'", [identity.projectId]);
    expect(events.rows[0]?.n).toBe('0');
  });

  it('INVARIANT MUTATION: a run made terminal behind the store\'s back — the pre-fix transition, with no sweep — keeps its dispatch open, and the invariant check catches it', async () => {
    const identity = await fixture();
    const invocationId = `preflight:${identity.nonce}:dispatched`;
    await seedPreflightInvocation(pool, identity, { invocationId, requestDigest: 'a'.repeat(64), requestedAt: new Date().toISOString() });
    // Exactly paid run 36568129865's end state: the run FAILED, its close-out still DISPATCHING.
    await pool.query("UPDATE relay_wonderland.julius_runs SET state='FAILED',version=version+1 WHERE run_id=$1 AND project_id=$2", [identity.runId, identity.projectId]);
    expect((await pool.query(OPEN_IN_TERMINAL_RUNS, [identity.projectId])).rows).toEqual([{ invocation_id: invocationId, state: 'DISPATCHING' }]);
  });
});

describe('the preflight identity module reaches PostgreSQL and nothing else', () => {
  it('imports no provider, no executor secret and no docker binding', () => {
    const source = readFileSync(resolve(__dirname, 'julius-live-preflight-identity.ts'), 'utf8');
    expect(source).not.toMatch(/openai|anthropic|hermes|claude-agent-sdk|EXECUTOR_SIGNING_KEY_PATH|EXECUTOR_RECEIPT_ROOT|docker/iu);
    // Every identifier is scoped by the nonce, so no two preflights can collide and cleanup has a boundary.
    expect(source).toContain("projectId: `${PREFLIGHT_PROJECT_PREFIX}${input.nonce}`");
    expect(source).toMatch(/runId: `run:julius-preflight-\$\{input\.nonce\}`/u);
  });
});
