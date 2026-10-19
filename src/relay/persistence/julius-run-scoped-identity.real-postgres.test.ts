import { randomBytes } from 'node:crypto';
import { juliusTestDatabaseUrl } from './julius-test-database';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { JuliusPostgresRepository } from './julius-postgres';
import { TransactionalWonderlandDatabase } from './wonderland-postgres';
import type { JuliusTask } from '../mission/julius';
import { juliusArchitectureCheckTaskId, juliusArchitectureTriggerId } from '../mission/julius/julius-architecture-drift';
import { juliusArchitectureEntryId } from '../mission/julius/julius-architecture-state';

/**
 * TWO RUNS, ONE REAL DATABASE: NO ARCHITECTURE IDENTITY IS SHARED.
 *
 * `julius_tasks.task_id` and `julius_brain_entries.entry_id` are primary keys
 * across every run the database has ever held — constraints a Map cannot have,
 * which is why the in-memory proof alone cannot close this. Before PR 4 the
 * pre-completion check of every run was `architecture:arch:PRE_COMPLETION_CHECK:r1:run:task`
 * and every run's first accepted design was `brain:architecture:r1`, so the
 * second run in a persistent database could create neither. This proves, on
 * the real schema, that both identities now carry the run — and, so the proof
 * cannot pass vacuously, that the old shapes really do collide here.
 *
 * Runs wherever JULIUS_TEST_DATABASE_URL names a THROWAWAY database (never DATABASE_URL
 * point at a PostgreSQL — the `first-live-topology` job — and is `todo`
 * elsewhere, like the other real-infrastructure cases. No provider is involved.
 */

const databaseUrl = juliusTestDatabaseUrl();
const enabled = databaseUrl !== null;
const suite = enabled ? describe : describe.todo;

suite('run-scoped architecture identities on real PostgreSQL', () => {
  const nonce = randomBytes(6).toString('hex');
  const project = `prj-identity-${nonce}`;
  const mission = `mission-identity-${nonce}`;
  const runA = `run:identity-a-${nonce}`;
  const runB = `run:identity-b-${nonce}`;
  let pool: Pool;
  let repo: JuliusPostgresRepository;

  const checkTask = (taskId: string): JuliusTask => ({
    taskId, missionId: mission, parentTaskId: null, dependencyIds: [], requiredEvidenceTypes: ['ARTIFACT'],
    taskType: 'architecture', role: 'PROMPT_ARCHITECT', ordinal: 1, state: 'RUNNABLE',
  });
  const addCheck = (runId: string, taskId: string) => repo.addTask({
    commandId: `architecture:${taskId}:${runId}`, runId, projectId: project, task: checkTask(taskId),
  });
  const appendEntry = (runId: string, entryId: string) => repo.appendBrainEntry({
    runId, projectId: project, taskId: null, workerId: 'architect', entryId, kind: 'DECISION',
    safeText: `ACCEPTED ARCHITECTURE (revision 1) for ${runId}`, evidenceIds: [], occurredAt: new Date().toISOString(),
  });

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl! });
    await new TransactionalWonderlandDatabase(pool).migrate();
    repo = new JuliusPostgresRepository(pool);
    await pool.query('INSERT INTO relay_wonderland.projects(project_id) VALUES($1)', [project]);
    await pool.query(
      "INSERT INTO relay_wonderland.mission_contracts(mission_id,project_id,stage,canonical_hash,snapshot) VALUES($1,$2,'READY',$3,'{}'::jsonb)",
      [mission, project, `identity:${nonce}`],
    );
    for (const runId of [runA, runB]) {
      await pool.query(
        "INSERT INTO relay_wonderland.julius_runs(run_id,mission_id,project_id,state,runtime_version,card_revision,mission_contract_revision,project_brain_revision) VALUES($1,$2,$3,'EXECUTING','identity','card',1,0)",
        [runId, mission, project],
      );
    }
  });

  afterAll(async () => {
    // Nothing was created when the pool never opened; otherwise remove exactly this proof's rows.
    const statements = pool === undefined ? [] : [
      'DELETE FROM relay_wonderland.julius_brain_entries WHERE project_id=$1',
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

  it('RUN A and RUN B each create their own PRE_COMPLETION_CHECK task', async () => {
    const trigger = juliusArchitectureTriggerId('PRE_COMPLETION_CHECK', 1, null);
    expect(await addCheck(runA, juliusArchitectureCheckTaskId(runA, trigger))).toBe(true);
    expect(await addCheck(runB, juliusArchitectureCheckTaskId(runB, trigger)), 'no collision with run A').toBe(true);
    const rows = await pool.query('SELECT task_id, run_id FROM relay_wonderland.julius_tasks WHERE run_id IN ($1,$2) ORDER BY run_id', [runA, runB]);
    expect(rows.rows.map((row) => row.run_id)).toEqual([runA, runB]);
  });

  it('RUN A and RUN B each record their own accepted architecture entry', async () => {
    expect(await appendEntry(runA, juliusArchitectureEntryId(runA, 1))).toBe(true);
    expect(await appendEntry(runB, juliusArchitectureEntryId(runB, 1)), 'no collision with run A').toBe(true);
    const rows = await pool.query('SELECT entry_id, run_id FROM relay_wonderland.julius_brain_entries WHERE run_id IN ($1,$2) ORDER BY run_id', [runA, runB]);
    expect(rows.rows.map((row) => row.run_id)).toEqual([runA, runB]);
  });

  it('the pre-PR-4 identities really do collide on this schema — the proof above is not vacuous', async () => {
    const legacyTask = `architecture:arch:PRE_COMPLETION_CHECK:r1:run:task:${nonce}`;
    expect(await addCheck(runA, legacyTask)).toBe(true);
    expect(await addCheck(runB, legacyTask), 'one global key: run B cannot have the same task id').toBe(false);
    const legacyEntry = `brain:architecture:r1:${nonce}`;
    expect(await appendEntry(runA, legacyEntry)).toBe(true);
    expect(await appendEntry(runB, legacyEntry), 'one global key: run B cannot have the same entry id').toBe(false);
  });
});
