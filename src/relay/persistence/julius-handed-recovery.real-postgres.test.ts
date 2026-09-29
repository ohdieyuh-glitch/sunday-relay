import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { JuliusTask } from '../mission/julius';
import { createFakeTime } from '../mission/julius/julius-runtime-fixtures';
import { JuliusEventPostgresRepository } from './julius-event-postgres';
import { JuliusPostgresRepository } from './julius-postgres';
import { JuliusRecoveryPostgresRepository } from './julius-recovery-postgres';
import { juliusTestDatabaseUrl } from './julius-test-database';
import { TransactionalWonderlandDatabase } from './wonderland-postgres';

/**
 * A HANDED ATTEMPT IS NEVER REQUEUED, ON THE REAL SCHEMA.
 *
 * The recovery sweep reads "was this attempt handed to a provider?" from the
 * `julius.worker.dispatched` event the coordinator writes before the handoff,
 * matched on the task and on the attempt the task is on. The in-memory store
 * answers the same question from its own log. This holds the SQL: the JSON
 * paths, the attempt match, and the event's own stream.
 *
 * Runs wherever JULIUS_TEST_DATABASE_URL names a THROWAWAY database, and is
 * `todo` elsewhere. No provider is involved.
 */

const databaseUrl = juliusTestDatabaseUrl();
const suite = databaseUrl !== null ? describe : describe.todo;

suite('recovery of a handed attempt, on real PostgreSQL', () => {
  const nonce = randomBytes(6).toString('hex');
  const project = `prj-handed-${nonce}`;
  const mission = `mission-handed-${nonce}`;
  const run = `run:handed-${nonce}`;
  let pool: Pool;
  let repo: JuliusPostgresRepository;
  let events: JuliusEventPostgresRepository;
  let recovery: JuliusRecoveryPostgresRepository;
  const time = createFakeTime('2099-01-01T00:00:00.000Z');
  const id = (name: string) => `build:${nonce}:${name}`;

  const buildTask = (taskId: string, ordinal: number): JuliusTask => ({
    taskId, missionId: mission, parentTaskId: null, dependencyIds: [], requiredEvidenceTypes: ['TEST'],
    taskType: 'build', role: 'CODING_AGENT', ordinal, state: 'RUNNABLE',
  });
  /** Claimed and admitted, so the task is ACTIVE on attempt 1 under a lease that has already lapsed. */
  const admitted = async (taskId: string, ordinal: number) => {
    await repo.addTask({ commandId: `add:${taskId}`, runId: run, projectId: project, task: buildTask(taskId, ordinal) });
    const claimed = await repo.claimRunnable({ owner: 'dead-worker', now: time.clock.now(), leaseExpiresAt: new Date(time.nowMs() + 1_000).toISOString(), limit: 100, projectId: project });
    const claim = claimed.find((entry) => entry.taskId === taskId)!;
    const attempt = await repo.admitTask({ taskId, owner: 'dead-worker', leaseGeneration: claim.leaseGeneration, now: time.clock.now() });
    expect(attempt, `${taskId} admitted`).toBe(1);
    return claim;
  };
  const dispatched = async (taskId: string, attempt: number) => events.append({
    eventId: `event:dispatched:${taskId}:${attempt}`, runId: run, projectId: project, type: 'worker.dispatched',
    taskId, workerId: null, correlationId: taskId, causationId: null, occurredAt: time.clock.now(),
    facts: { workerId: 'coder', attempt, runId: run },
  });
  const stateOf = async (taskId: string) => (await pool.query<{ state: string; recoveries: number }>(
    'SELECT state, recoveries FROM relay_wonderland.julius_tasks WHERE task_id=$1', [taskId])).rows[0]!;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl!, max: 4 });
    await new TransactionalWonderlandDatabase(pool).migrate();
    repo = new JuliusPostgresRepository(pool);
    events = new JuliusEventPostgresRepository(pool);
    recovery = new JuliusRecoveryPostgresRepository(pool);
    await pool.query('INSERT INTO relay_wonderland.projects(project_id) VALUES($1)', [project]);
    await pool.query("INSERT INTO relay_wonderland.mission_contracts(mission_id,project_id,stage,canonical_hash,snapshot) VALUES($1,$2,'READY',$3,'{}'::jsonb)", [mission, project, `handed:${nonce}`]);
    await pool.query("INSERT INTO relay_wonderland.julius_runs(run_id,mission_id,project_id,state,runtime_version,card_revision,mission_contract_revision,project_brain_revision) VALUES($1,$2,$3,'EXECUTING','handed','card',1,0)", [run, mission, project]);
  });
  afterAll(async () => {
    // Nothing was created when the pool never opened; otherwise remove exactly this proof's rows.
    const statements = pool === undefined ? [] : [
      'DELETE FROM relay_wonderland.outbox WHERE project_id=$1',
      'DELETE FROM relay_wonderland.events WHERE project_id=$1',
      'DELETE FROM relay_wonderland.julius_tasks t USING relay_wonderland.julius_runs r WHERE t.run_id=r.run_id AND r.project_id=$1',
      'DELETE FROM relay_wonderland.julius_runs WHERE project_id=$1',
      'DELETE FROM relay_wonderland.mission_contracts WHERE project_id=$1',
      'DELETE FROM relay_wonderland.projects WHERE project_id=$1',
    ];
    for (const sql of statements) await pool.query(sql, [project]).catch(() => undefined);
    await pool?.end().catch(() => undefined);
  });

  it('a handed attempt ends HANDED_OUTCOME_UNKNOWN; one never handed, or handed on an EARLIER attempt, is requeued', async () => {
    await admitted(id('handed'), 1);
    await dispatched(id('handed'), 1);
    await admitted(id('never-handed'), 2);
    await admitted(id('other-attempt'), 3);
    await dispatched(id('other-attempt'), 0); // a record for an attempt this task is not on

    await time.advance(5_000);
    const actions = await recovery.recoverExpired(time.clock.now(), 100, project);
    const byTask = new Map(actions.map((action) => [action.taskId, `${action.action}:${action.reasonCode}`]));

    expect(byTask.get(id('handed'))).toBe('FAIL_TASK:HANDED_OUTCOME_UNKNOWN');
    expect(await stateOf(id('handed')), 'ended, and not counted as a requeue').toEqual({ state: 'FAILED', recoveries: 0 });
    expect(byTask.get(id('never-handed'))).toBe('REQUEUE:LEASE_EXPIRED');
    expect(await stateOf(id('never-handed'))).toEqual({ state: 'RUNNABLE', recoveries: 1 });
    expect(byTask.get(id('other-attempt')), 'the attempt must match: an old record does not make this one handed').toBe('REQUEUE:LEASE_EXPIRED');
  });
});
