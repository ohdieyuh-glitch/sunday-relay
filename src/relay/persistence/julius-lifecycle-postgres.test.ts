import { describe, expect, it } from 'vitest';

import type { JuliusApprovalRecord } from '../mission/julius';
import { JuliusLifecyclePostgresRepository } from './julius-lifecycle-postgres';
import { JuliusPostgresRepository } from './julius-postgres';

/**
 * THE ATOMIC APPROVAL GATE RECORDS ITS MOVE TO BLOCKED — WITHOUT A DATABASE.
 *
 * `requestApprovalAndBlock` is the path the C.A.R.D. gate at dispatch takes in
 * production: the PENDING approval and the run's move to BLOCKED commit
 * together. The move used to be a bare `UPDATE julius_runs SET state='BLOCKED'`
 * — no transition-table check, no `julius_transitions` row, no
 * `julius.run.transitioned` event — so a gated run's history held a
 * BLOCKED -> READY grant with no BLOCKED before it. These cases pin, on every
 * run and in seconds, that the move is now the walk every other transition
 * takes, written inside the same transaction. The real schema says the same
 * in CI (`julius-approval-at-dispatch.real-postgres.test.ts`).
 */

const RECORD: JuliusApprovalRecord = {
  approvalId: 'approval:dispatch:run-1:task-1:DISPATCH_WORKER:card-1', runId: 'run-1', projectId: 'prj-1',
  taskId: 'task-1', operation: 'DISPATCH_WORKER', policyRevision: 'card-1', reasonCode: 'CARD_APPROVAL_REQUIRED',
  safeRationale: 'C.A.R.D. requires an authorized approval.', state: 'PENDING', requestedAt: '2099-01-01T00:00:00.000Z',
  decidedAt: null, decidedBy: null, decisionReason: null, idempotencyKey: 'approval:dispatch:run-1:task-1:DISPATCH_WORKER:card-1',
};

const approvalRow = {
  approval_id: RECORD.approvalId, run_id: RECORD.runId, project_id: RECORD.projectId, task_id: RECORD.taskId,
  operation: RECORD.operation, policy_revision: RECORD.policyRevision, reason_code: RECORD.reasonCode,
  safe_rationale: RECORD.safeRationale, state: 'PENDING', requested_at: RECORD.requestedAt, decided_at: null,
  decided_by: null, decision_reason: null, idempotency_key: RECORD.idempotencyKey,
};

/** A pool whose one transaction answers from a script and remembers what it was asked. */
function fakePool(script: { runState: string; runVersion: number; prior?: boolean }) {
  const queries: { sql: string; values: readonly unknown[] }[] = [];
  let version = script.runVersion;
  const client = {
    released: false,
    async query(sql: string, values: readonly unknown[] = []) {
      queries.push({ sql, values });
      if (sql.startsWith('SELECT state,version,mission_id FROM relay_wonderland.julius_runs')) {
        return { rows: [{ state: script.runState, version: script.runVersion, mission_id: 'mission-1' }], rowCount: 1 };
      }
      if (sql.startsWith('SELECT * FROM relay_wonderland.julius_runs')) {
        return {
          rows: [{ run_id: 'run-1', mission_id: 'mission-1', project_id: 'prj-1', state: script.runState, card_revision: 'card-1',
            mission_contract_revision: 1, project_brain_revision: 0, version: script.runVersion }], rowCount: 1,
        };
      }
      if (sql.includes('FROM relay_wonderland.julius_approvals WHERE run_id=$1 AND idempotency_key=$2 FOR UPDATE')) {
        return script.prior === true ? { rows: [approvalRow], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      if (sql.startsWith('INSERT INTO relay_wonderland.julius_approvals')) return { rows: [approvalRow], rowCount: 1 };
      if (sql.startsWith('UPDATE relay_wonderland.julius_runs')) {
        const [runId, to, occurredAt, expected] = values as [string, string, string, number];
        if (expected !== version) return { rows: [], rowCount: 0 };
        version += 1;
        return {
          rows: [{ run_id: runId, mission_id: 'mission-1', project_id: 'prj-1', state: to, card_revision: 'card-1',
            mission_contract_revision: 1, project_brain_revision: 0, version, updated_at: occurredAt }], rowCount: 1,
        };
      }
      if (sql.includes('stream_sequences')) return { rows: [{ sequence: String(queries.length) }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
    release() { client.released = true; },
  };
  return { pool: { connect: async () => client } as never, queries, client };
}

const transitionsOf = (queries: readonly { sql: string; values: readonly unknown[] }[]) => queries
  .filter((query) => query.sql.startsWith('INSERT INTO relay_wonderland.julius_transitions'))
  .map((query) => ({ from: query.values[2], to: query.values[3], reason: query.values[4], sequence: query.values[9] }));
const eventsOf = (queries: readonly { sql: string; values: readonly unknown[] }[]) => queries
  .filter((query) => query.sql.startsWith('INSERT INTO relay_wonderland.events'))
  .map((query) => query.values[4]);

describe('the atomic approval gate records its move to BLOCKED as transitions', () => {
  it('a READY run walks READY -> EXECUTING -> BLOCKED: each step a row, an event and a version, inside the one transaction', async () => {
    const fake = fakePool({ runState: 'READY', runVersion: 3 });
    const outcome = await new JuliusLifecyclePostgresRepository(fake.pool).requestApprovalAndBlock({ record: RECORD, expectedRunVersion: 3 });
    expect(outcome).toMatchObject({ created: true, runState: 'BLOCKED', record: { approvalId: RECORD.approvalId, state: 'PENDING' } });

    expect(transitionsOf(fake.queries), 'the same walk the in-memory store takes, recorded').toEqual([
      { from: 'READY', to: 'EXECUTING', reason: 'PASSED_THROUGH', sequence: 3 },
      { from: 'EXECUTING', to: 'BLOCKED', reason: 'APPROVAL_REQUIRED', sequence: 4 },
    ]);
    expect(eventsOf(fake.queries), 'announced like every transition').toEqual(['julius.run.transitioned', 'julius.run.transitioned']);

    const sql = fake.queries.map((query) => query.sql);
    const approval = sql.findIndex((statement) => statement.startsWith('INSERT INTO relay_wonderland.julius_approvals'));
    const firstMove = sql.findIndex((statement) => statement.startsWith('UPDATE relay_wonderland.julius_runs'));
    expect(approval, 'the PENDING row is written').toBeGreaterThan(-1);
    expect(firstMove, 'and the run moves after it, in the same transaction').toBeGreaterThan(approval);
    expect(sql[0]).toBe('BEGIN ISOLATION LEVEL SERIALIZABLE');
    expect(sql.at(-1), 'one commit, at the end').toBe('COMMIT');
    expect(sql, 'nothing was rolled back').not.toContain('ROLLBACK');
    expect(sql.some((statement) => statement.includes("SET state='BLOCKED'")), 'no bare UPDATE the history never saw').toBe(false);
    expect(fake.client.released).toBe(true);
  });

  it('a run already BLOCKED (a second gate) is not moved again: no transition, no version change', async () => {
    const fake = fakePool({ runState: 'BLOCKED', runVersion: 7 });
    const outcome = await new JuliusLifecyclePostgresRepository(fake.pool).requestApprovalAndBlock({ record: RECORD, expectedRunVersion: 7 });
    expect(outcome.runState).toBe('BLOCKED');
    expect(transitionsOf(fake.queries)).toEqual([]);
    expect(fake.queries.some((query) => query.sql.startsWith('UPDATE relay_wonderland.julius_runs'))).toBe(false);
    expect(fake.queries.at(-1)!.sql).toBe('COMMIT');
  });

  it('a stale run version writes nothing and rolls back', async () => {
    const fake = fakePool({ runState: 'READY', runVersion: 3 });
    await expect(new JuliusLifecyclePostgresRepository(fake.pool).requestApprovalAndBlock({ record: RECORD, expectedRunVersion: 2 }))
      .rejects.toThrow('julius_run_version_conflict');
    expect(fake.queries.some((query) => query.sql.startsWith('INSERT'))).toBe(false);
    expect(fake.queries.at(-1)!.sql).toBe('ROLLBACK');
  });

  it('a terminal run is refused before anything is written', async () => {
    const fake = fakePool({ runState: 'FAILED', runVersion: 3 });
    await expect(new JuliusLifecyclePostgresRepository(fake.pool).requestApprovalAndBlock({ record: RECORD, expectedRunVersion: 3 }))
      .rejects.toThrow('julius_run_terminal');
    expect(fake.queries.some((query) => query.sql.startsWith('INSERT'))).toBe(false);
  });

  it('REGRESSION: JuliusPostgresRepository.transition still writes the run row, the transition row and the event', async () => {
    const fake = fakePool({ runState: 'READY', runVersion: 5 });
    const moved = await new JuliusPostgresRepository(fake.pool).transition({
      commandId: 'cmd-1', runId: 'run-1', projectId: 'prj-1', expectedVersion: 5, to: 'EXECUTING',
      reasonCode: 'TASKS_RUNNABLE', safeSummary: 'Work began.', evidenceIds: [], occurredAt: '2099-01-01T00:00:00.000Z',
    });
    expect(moved).toMatchObject({ runId: 'run-1', state: 'EXECUTING', version: 6 });
    expect(transitionsOf(fake.queries)).toEqual([{ from: 'READY', to: 'EXECUTING', reason: 'TASKS_RUNNABLE', sequence: 5 }]);
    expect(eventsOf(fake.queries)).toEqual(['julius.run.transitioned']);
    const transitionRow = fake.queries.find((query) => query.sql.startsWith('INSERT INTO relay_wonderland.julius_transitions'))!;
    expect(transitionRow.values[0], 'the transition id is the command id').toBe('transition:cmd-1');
    expect(fake.queries.at(-1)!.sql).toBe('COMMIT');
  });
});
