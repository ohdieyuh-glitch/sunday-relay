import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { JuliusPostgresRepository } from './julius-postgres';
import { JuliusRecoveryPostgresRepository } from './julius-recovery-postgres';
import { TransactionalWonderlandDatabase } from './wonderland-postgres';
import type { JuliusTask } from '../mission/julius';
import { keepJuliusLease } from '../mission/julius/julius-lease-keeper';
import { createFakeTime } from '../mission/julius/julius-runtime-fixtures';

/**
 * LEASE RENEWAL ON THE REAL SCHEMA.
 *
 * The in-memory store models the lease compare-and-set; this holds the same two
 * rules against the SQL that production runs: a legitimate holder's renewals
 * keep `lease_expires_at` ahead of time and the sweep reclaims nothing, and a
 * holder whose task was reclaimed has its renewal refused by the generation
 * fence without disturbing the new holder's lease. Renewal never writes an
 * expiry past the hold bound.
 *
 * Time is the fake clock's, far in the future, so the database's own clock and
 * defaults cannot make a claim or a sweep pass for the wrong reason.
 *
 * Runs wherever JULIUS_REAL_POSTGRES=1 (or JULIUS_REAL_INFRA=1) and DATABASE_URL
 * point at a PostgreSQL — the `first-live-topology` job — and is `todo`
 * elsewhere. No provider is involved.
 */

const enabled = process.env.JULIUS_REAL_INFRA === '1' || process.env.JULIUS_REAL_POSTGRES === '1';
const suite = enabled ? describe : describe.todo;

suite('Julius lease renewal on real PostgreSQL', () => {
  const nonce = randomBytes(6).toString('hex');
  const project = `prj-lease-${nonce}`;
  const mission = `mission-lease-${nonce}`;
  const run = `run:lease-${nonce}`;
  let pool: Pool;
  let repo: JuliusPostgresRepository;
  let recovery: JuliusRecoveryPostgresRepository;

  const buildTask = (taskId: string): JuliusTask => ({
    taskId, missionId: mission, parentTaskId: null, dependencyIds: [], requiredEvidenceTypes: ['TEST'],
    taskType: 'build', role: 'CODING_AGENT', ordinal: 1, state: 'RUNNABLE',
  });
  const leaseOf = async (taskId: string) => {
    const row = await pool.query('SELECT state, lease_owner, lease_generation, lease_expires_at FROM relay_wonderland.julius_tasks WHERE task_id=$1', [taskId]);
    const found = row.rows[0] as { state: string; lease_owner: string | null; lease_generation: number; lease_expires_at: Date | null };
    return { ...found, expiresMs: found.lease_expires_at === null ? null : found.lease_expires_at.getTime() };
  };
  const claimAs = async (owner: string, time: ReturnType<typeof createFakeTime>, taskId: string) => {
    const claimed = await repo.claimRunnable({
      owner, now: time.clock.now(), leaseExpiresAt: new Date(time.nowMs() + 1_000).toISOString(), limit: 100, projectId: project,
    });
    const claim = claimed.find((entry) => entry.taskId === taskId);
    expect(claim, `${owner} claims ${taskId}`).toBeDefined();
    expect(await repo.admitTask({ taskId, owner, leaseGeneration: claim!.leaseGeneration, now: time.clock.now() })).not.toBeNull();
    return claim!;
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await new TransactionalWonderlandDatabase(pool).migrate();
    repo = new JuliusPostgresRepository(pool);
    recovery = new JuliusRecoveryPostgresRepository(pool);
    await pool.query('INSERT INTO relay_wonderland.projects(project_id) VALUES($1)', [project]);
    await pool.query(
      "INSERT INTO relay_wonderland.mission_contracts(mission_id,project_id,stage,canonical_hash,snapshot) VALUES($1,$2,'READY',$3,'{}'::jsonb)",
      [mission, project, `lease:${nonce}`],
    );
    await pool.query(
      "INSERT INTO relay_wonderland.julius_runs(run_id,mission_id,project_id,state,runtime_version,card_revision,mission_contract_revision,project_brain_revision) VALUES($1,$2,$3,'EXECUTING','lease','card',1,0)",
      [run, mission, project],
    );
  });

  afterAll(async () => {
    // Nothing was created when the pool never opened; otherwise remove exactly this proof's rows.
    const statements = pool === undefined ? [] : [
      'DELETE FROM relay_wonderland.julius_tasks t USING relay_wonderland.julius_runs r WHERE t.run_id=r.run_id AND r.project_id=$1',
      'DELETE FROM relay_wonderland.julius_runs WHERE project_id=$1',
      'DELETE FROM relay_wonderland.mission_contracts WHERE project_id=$1',
      'DELETE FROM relay_wonderland.projects WHERE project_id=$1',
    ];
    for (const sql of statements) {
      await pool.query(sql, [project]).catch(() => undefined);
    }
    await pool?.end().catch(() => undefined);
  });

  it('a legitimate holder\'s renewals keep the lease ahead of time, and the sweep reclaims nothing', async () => {
    const taskId = `build:${nonce}:legitimate`;
    await repo.addTask({ commandId: `lease:${taskId}`, runId: run, projectId: project, task: buildTask(taskId) });
    const time = createFakeTime('2099-01-01T00:00:00.000Z');
    const claim = await claimAs('worker-a', time, taskId);
    const keeper = keepJuliusLease({
      store: repo, clock: time.clock, timers: time.timers, taskId, owner: 'worker-a',
      leaseGeneration: claim.leaseGeneration, leaseMs: 1_000, renewEveryMs: 250, holdUntilMs: time.nowMs() + 60_000,
    });
    expect(await keeper.renewNow()).toBe(true);
    for (let step = 0; step < 20; step += 1) {
      await time.advance(250);
      // A real round trip per renewal: let it land before reading the row.
      for (let settle = 0; settle < 50 && keeper.renewals() < step + 2; settle += 1) await new Promise((resolve) => setTimeout(resolve, 10));
      const lease = await leaseOf(taskId);
      expect(lease.state).toBe('ACTIVE');
      expect(lease.expiresMs!, `lease lapsed at ${time.clock.now()}`).toBeGreaterThan(time.nowMs());
      expect(await recovery.recoverExpired(time.clock.now(), 100, project)).toEqual([]);
    }
    await keeper.stop();
    expect(keeper.signal.aborted).toBe(false);
  });

  it('a reclaimed holder\'s renewal is refused by the generation fence and leaves the new lease untouched', async () => {
    const taskId = `build:${nonce}:reclaimed`;
    await repo.addTask({ commandId: `lease:${taskId}`, runId: run, projectId: project, task: buildTask(taskId) });
    const time = createFakeTime('2099-02-01T00:00:00.000Z');
    const stale = await claimAs('worker-a', time, taskId);
    // Worker A stops renewing; its lease lapses and the sweep hands the task back.
    await time.advance(5_000);
    const swept = await recovery.recoverExpired(time.clock.now(), 100, project);
    expect(swept.map((action) => [action.taskId, action.action])).toContainEqual([taskId, 'REQUEUE']);
    const fresh = await claimAs('worker-b', time, taskId);
    expect(fresh.leaseGeneration).toBeGreaterThan(stale.leaseGeneration);
    const before = await leaseOf(taskId);

    const keeper = keepJuliusLease({
      store: repo, clock: time.clock, timers: time.timers, taskId, owner: 'worker-a',
      leaseGeneration: stale.leaseGeneration, leaseMs: 60_000, renewEveryMs: 250, holdUntilMs: time.nowMs() + 600_000,
    });
    expect(await keeper.renewNow()).toBe(false);
    expect(keeper.signal.reason).toBe('lease_lost');
    const after = await leaseOf(taskId);
    expect(after).toEqual(before);
    expect(after.lease_owner).toBe('worker-b');
  });

  it('renewal never writes an expiry past the hold bound', async () => {
    const taskId = `build:${nonce}:bounded`;
    await repo.addTask({ commandId: `lease:${taskId}`, runId: run, projectId: project, task: buildTask(taskId) });
    const time = createFakeTime('2099-03-01T00:00:00.000Z');
    const claim = await claimAs('worker-a', time, taskId);
    const holdUntilMs = time.nowMs() + 1_600;
    const keeper = keepJuliusLease({
      store: repo, clock: time.clock, timers: time.timers, taskId, owner: 'worker-a',
      leaseGeneration: claim.leaseGeneration, leaseMs: 1_000, renewEveryMs: 250, holdUntilMs,
    });
    expect(await keeper.renewNow()).toBe(true);
    for (let step = 0; step < 12; step += 1) {
      await time.advance(250);
      for (let settle = 0; settle < 20; settle += 1) await new Promise((resolve) => setTimeout(resolve, 5));
      const lease = await leaseOf(taskId);
      expect(lease.expiresMs!).toBeLessThanOrEqual(holdUntilMs);
    }
    expect(keeper.signal.reason).toBe('lease_hold_exhausted');
    expect((await leaseOf(taskId)).expiresMs).toBe(holdUntilMs);
  });
});
