import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JuliusPostgresRepository } from '../src/relay/persistence/julius-postgres';
import { JuliusRecoveryPostgresRepository } from '../src/relay/persistence/julius-recovery-postgres';
import { MAX_TASK_RECOVERIES } from '../src/relay/mission/julius';
import { JuliusToolPostgresRepository } from '../src/relay/persistence/julius-tool-postgres';
import { JuliusToolRecoveryPostgresRepository } from '../src/relay/persistence/julius-tool-recovery-postgres';
import { EXECUTOR_SANDBOX_LIMITS, EXECUTOR_SANDBOX_POLICY } from '../relay-bridge/julius/sandbox-limits';
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
 * They run wherever JULIUS_REAL_POSTGRES=1 (or JULIUS_REAL_INFRA=1) and
 * DATABASE_URL point at a migrated-or-empty PostgreSQL — the sibling
 * infrastructure workflow's `first-live-topology` job — and are `todo`
 * elsewhere, like the other real-infrastructure cases. No provider is involved.
 */

const enabled = process.env.JULIUS_REAL_POSTGRES === '1' || process.env.JULIUS_REAL_INFRA === '1';
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
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
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

  it('refuses to seed or clean up an identity it does not own, on any of its identifiers', async () => {
    const owned = fixture();
    for (const foreign of [
      { ...owned, projectId: 'prj-julius-first-live' },
      { ...owned, runId: 'run:some-real-mission' },
      { ...owned, taskId: 'task:some-real-task' },
      { ...owned, missionId: 'mission:some-real-mission' },
    ]) {
      await expect(cleanupPreflightIdentity(pool, foreign)).rejects.toThrow('preflight_identity_not_owned');
      await expect(seedPreflightIdentity(pool, foreign)).rejects.toThrow('preflight_identity_not_owned');
    }
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
