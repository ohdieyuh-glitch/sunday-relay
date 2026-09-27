import { randomBytes } from 'node:crypto';
import { juliusTestDatabaseUrl } from './julius-test-database';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { JuliusPostgresRepository } from './julius-postgres';
import { TransactionalWonderlandDatabase } from './wonderland-postgres';
import { JULIUS_DECISION_WRITE_CASES, type JuliusDecisionWriteStore } from './julius-decision-write-conformance';
import type { JuliusOperationalEvent, JuliusVerificationDecision } from '../mission/julius';

/**
 * THE SAME DECISION WRITE CONTRACT, ON REAL PostgreSQL.
 *
 * These are the cases the in-memory store runs
 * (`../mission/julius/julius-decision-history.test.ts`), against the SQL
 * production writes to — and this is the half only a database can prove: the
 * decision, the release and the events that explain them are ONE TRANSACTION,
 * so a failure anywhere in it rolls back all three. Before this change the
 * events were appended afterwards in transactions of their own, and a process
 * that died in between left a decision no history could account for.
 *
 * Runs wherever JULIUS_TEST_DATABASE_URL names a THROWAWAY database (never DATABASE_URL
 * point at a PostgreSQL — the `first-live-topology` job — and is `todo`
 * elsewhere. No provider is involved.
 */

const databaseUrl = juliusTestDatabaseUrl();
const enabled = databaseUrl !== null;
const suite = enabled ? describe : describe.todo;

suite('the decision write contract on real PostgreSQL', () => {
  const nonce = randomBytes(6).toString('hex');
  const project = `prj-decision-${nonce}`;
  const mission = `mission-decision-${nonce}`;
  const run = `run:decision-${nonce}`;
  let pool: Pool;
  let runs: JuliusPostgresRepository;

  /** Each case gets its own tasks, ordinals and ids, so one run holds them all. */
  let nextOrdinal = 0;
  const bind = async (prefix: string): Promise<{ store: JuliusDecisionWriteStore; build: Parameters<(typeof JULIUS_DECISION_WRITE_CASES)[number]['run']>[1] }> => {
    const subject = `${prefix}:plan`;
    const blocked = `${prefix}:build`;
    const ordinal = nextOrdinal;
    nextOrdinal += 2;
    // The real schema: no `mission_id` on a task (the run carries it) and no
    // `dependency_ids` column (dependencies are their own table). The release
    // under test is driven by `releaseTaskIds`, which names the task directly.
    await pool.query(
      "INSERT INTO relay_wonderland.julius_tasks(task_id,run_id,parent_task_id,role,task_type,state,ordinal,required_evidence_types) VALUES($1,$2,NULL,'PROMPT_ARCHITECT','plan','SUCCEEDED',$3,'[]'::jsonb)",
      [subject, run, ordinal],
    );
    await pool.query(
      "INSERT INTO relay_wonderland.julius_tasks(task_id,run_id,parent_task_id,role,task_type,state,ordinal,required_evidence_types) VALUES($1,$2,NULL,'CODING_AGENT','build','BLOCKED',$3,'[]'::jsonb)",
      [blocked, run, ordinal + 1],
    );
    await pool.query(
      'INSERT INTO relay_wonderland.julius_task_dependencies(task_id,dependency_task_id) VALUES($1,$2)',
      [blocked, subject],
    );
    return {
      store: {
        appendDecision: (input) => runs.appendDecision({ ...input, runId: run }),
        decisionsFor: async (taskId) => {
          const result = await pool.query('SELECT count(*)::int AS rows FROM relay_wonderland.julius_verification_decisions WHERE run_id=$1 AND task_id=$2', [run, taskId]);
          return (result.rows[0] as { rows: number }).rows;
        },
        rowsFor: async (eventId) => {
          const result = await pool.query('SELECT count(*)::int AS rows FROM relay_wonderland.events WHERE event_id=$1', [`${prefix}:${eventId}`]);
          return (result.rows[0] as { rows: number }).rows;
        },
        stateOf: async (taskId) => {
          const result = await pool.query('SELECT state FROM relay_wonderland.julius_tasks WHERE run_id=$1 AND task_id=$2', [run, taskId]);
          return (result.rows[0] as { state: string } | undefined)?.state ?? null;
        },
      },
      build: {
        subjectTaskId: subject,
        blockedTaskId: blocked,
        decision: (over: Partial<JuliusVerificationDecision> = {}): JuliusVerificationDecision => ({
          action: 'ACCEPT', reasonCode: 'CRITERIA_MET', evidenceIds: [], safeSummary: 'Accepted.', ...over,
        }),
        event: (over: Partial<JuliusOperationalEvent> = {}): JuliusOperationalEvent => ({
          eventId: `${prefix}:event:1`, runId: run, projectId: project, type: 'verification.decided',
          taskId: subject, workerId: null, correlationId: `corr-${nonce}`, causationId: null,
          occurredAt: '2099-01-01T00:00:00.000Z', facts: { action: 'ACCEPT' },
          ...over,
          ...(over.eventId === undefined ? {} : { eventId: `${prefix}:${over.eventId}` }),
          ...(over.taskId === undefined ? {} : { taskId: over.taskId }),
        }),
      },
    };
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl! });
    await new TransactionalWonderlandDatabase(pool).migrate();
    runs = new JuliusPostgresRepository(pool);
    await pool.query('INSERT INTO relay_wonderland.projects(project_id) VALUES($1)', [project]);
    await pool.query(
      "INSERT INTO relay_wonderland.mission_contracts(mission_id,project_id,stage,canonical_hash,snapshot) VALUES($1,$2,'READY',$3,'{}'::jsonb)",
      [mission, project, `decision:${nonce}`],
    );
    await pool.query(
      "INSERT INTO relay_wonderland.julius_runs(run_id,mission_id,project_id,state,runtime_version,card_revision,mission_contract_revision,project_brain_revision) VALUES($1,$2,$3,'EXECUTING','decision','card',1,0)",
      [run, mission, project],
    );
  });

  afterAll(async () => {
    const statements = pool === undefined ? [] : [
      'DELETE FROM relay_wonderland.outbox o USING relay_wonderland.events e WHERE o.event_id=e.event_id AND e.project_id=$1',
      'DELETE FROM relay_wonderland.events WHERE project_id=$1',
      'DELETE FROM relay_wonderland.stream_sequences WHERE stream_id IN (SELECT run_id FROM relay_wonderland.julius_runs WHERE project_id=$1)',
      'DELETE FROM relay_wonderland.julius_verification_decisions WHERE run_id IN (SELECT run_id FROM relay_wonderland.julius_runs WHERE project_id=$1)',
      'DELETE FROM relay_wonderland.julius_tasks WHERE run_id IN (SELECT run_id FROM relay_wonderland.julius_runs WHERE project_id=$1)',
      'DELETE FROM relay_wonderland.julius_runs WHERE project_id=$1',
      'DELETE FROM relay_wonderland.mission_contracts WHERE project_id=$1',
      'DELETE FROM relay_wonderland.projects WHERE project_id=$1',
    ];
    for (const sql of statements) {
      await pool.query(sql, [project]).catch(() => undefined);
    }
    await pool?.end().catch(() => undefined);
  });

  for (const [index, contractCase] of JULIUS_DECISION_WRITE_CASES.entries()) {
    it(contractCase.name, async () => {
      const bound = await bind(`case-${String(index)}`);
      await expect(contractCase.run(bound.store, bound.build)).resolves.toBeUndefined();
    });
  }

  /**
   * WHAT ONLY A DATABASE CAN SHOW.
   *
   * An event the write cannot accept takes the whole write down with it: no
   * decision, no release, no partial history. Appended afterwards, the decision
   * would have stood and this event would simply have been missing.
   */
  it('a decision whose history cannot be written is not written either', async () => {
    const bound = await bind('rollback');
    const refused = await bound.store.appendDecision({
      decisionId: 'decision:rollback', runId: run, taskId: bound.build.subjectTaskId, policyRevision: 'v1',
      idempotencyKey: 'key:rollback', occurredAt: '2099-01-01T00:00:00.000Z', decision: bound.build.decision(),
      releaseTaskIds: [bound.build.blockedTaskId],
      events: [
        bound.build.event({ eventId: 'event:rollback' }),
        // A run that does not exist: the append refuses it inside the transaction.
        bound.build.event({ eventId: 'event:rollback-bad', runId: `${run}:absent` }),
      ],
    }).then(() => 'accepted' as const, (error: unknown) => error);

    expect(refused, 'the write should have been refused').not.toBe('accepted');
    expect(await bound.store.decisionsFor(bound.build.subjectTaskId), 'the decision rolled back with it').toBe(0);
    expect(await bound.store.stateOf(bound.build.blockedTaskId), 'and so did the release').toBe('BLOCKED');
    expect(await bound.store.rowsFor('event:rollback'), 'and so did the event that had already been written').toBe(0);
  });

  it('the release and the row that announces it are visible together or not at all', async () => {
    const bound = await bind('together');
    await bound.store.appendDecision({
      decisionId: 'decision:together', runId: run, taskId: bound.build.subjectTaskId, policyRevision: 'v1',
      idempotencyKey: 'key:together', occurredAt: '2099-01-01T00:00:00.000Z', decision: bound.build.decision(),
      releaseTaskIds: [bound.build.blockedTaskId],
      events: [bound.build.event({ eventId: 'event:together', type: 'task.runnable', taskId: bound.build.blockedTaskId })],
    });
    expect(await bound.store.stateOf(bound.build.blockedTaskId)).toBe('RUNNABLE');
    expect(await bound.store.rowsFor('event:together')).toBe(1);
    // And the row carries the outbox entry every event gets, because it went
    // through the same append the event port uses.
    const outbox = await pool.query('SELECT count(*)::int AS rows FROM relay_wonderland.outbox WHERE event_id=$1', ['together:event:together']);
    expect((outbox.rows[0] as { rows: number }).rows, 'an event written inside a decision is still a published event').toBe(1);
  });
});
