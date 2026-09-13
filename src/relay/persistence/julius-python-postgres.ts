import type { Pool, PoolClient } from 'pg';

import {
  settleJuliusPythonPlanAsync,
  type JuliusPythonExecutionRecord,
  type JuliusPythonExecutionStore,
  type JuliusPythonSettleInput,
  type JuliusPythonSettleResult,
} from '../mission/julius/julius-python-service';
import { commitJuliusBrainGroupWithin } from './julius-brain-postgres';

/**
 * DURABLE PYTHON EXECUTIONS.
 *
 * Every mutation reads the row `FOR UPDATE`, computes the next record in
 * TypeScript with the same rules the in-memory model applies, and writes the
 * document and its typed columns in one statement. Settlement holds that row
 * lock while it takes the Brain row lock and commits the execution's Brain
 * records through `commitJuliusBrainGroupWithin` — so the terminal state and the
 * records it announces commit together, and a cancellation committed first
 * (which needs the same row lock) is seen by the settlement, not overwritten.
 *
 * Lock order is always execution row, then Brain row. Brain writers take only
 * the Brain row and cancellations only the execution row, so there is no cycle.
 */

type Queryable = Pick<PoolClient, 'query'>;
const parsed = <T>(value: unknown): T => (typeof value === 'string' ? JSON.parse(value) as T : value as T);

export class JuliusPythonExecutionPostgresStore implements JuliusPythonExecutionStore {
  constructor(private readonly pool: Pool) {}

  async create(record: JuliusPythonExecutionRecord): Promise<{ readonly created: boolean; readonly record: JuliusPythonExecutionRecord }> {
    const inserted = await this.pool.query(
      `INSERT INTO relay_wonderland.julius_python_executions(execution_id,project_id,brain_id,mission_id,run_id,task_id,idempotency_key,request_digest,script_hash,state,host_instance_id,requested_at,started_at,completed_at,version,record)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb)
       ON CONFLICT(project_id,idempotency_key) DO NOTHING`,
      [record.executionId, record.projectId, record.brainId, record.missionId, record.runId, record.taskId, record.idempotencyKey, record.requestDigest,
        record.scriptHash, record.state, record.hostInstanceId, record.requestedAt, record.startedAt, record.completedAt, record.version, JSON.stringify(record)],
    ).catch((error: { code?: string; constraint?: string }) => {
      if (error.code === '23505') throw new Error('julius_python_execution_id_taken');
      throw error;
    });
    if (inserted.rowCount === 1) return { created: true, record };
    const existing = await this.pool.query('SELECT record FROM relay_wonderland.julius_python_executions WHERE project_id=$1 AND idempotency_key=$2', [record.projectId, record.idempotencyKey]);
    const stored = parsed<JuliusPythonExecutionRecord>(existing.rows[0].record);
    if (stored.requestDigest !== record.requestDigest) throw new Error('julius_python_idempotency_conflict');
    return { created: false, record: stored };
  }

  async load(executionId: string, projectId: string): Promise<JuliusPythonExecutionRecord | null> {
    const result = await this.pool.query('SELECT record FROM relay_wonderland.julius_python_executions WHERE execution_id=$1 AND project_id=$2', [executionId, projectId]);
    return result.rows[0] ? parsed<JuliusPythonExecutionRecord>(result.rows[0].record) : null;
  }

  async start(input: Parameters<JuliusPythonExecutionStore['start']>[0]): Promise<boolean> {
    return this.mutate(input.executionId, input.projectId, (row) => row.state !== 'REQUESTED' ? null : {
      ...row, state: 'RUNNING', hostInstanceId: input.hostInstanceId, startedAt: input.startedAt, decisions: input.decisions, version: row.version + 1,
    }).then((next) => next !== null);
  }

  async requestCancel(input: Parameters<JuliusPythonExecutionStore['requestCancel']>[0]): Promise<JuliusPythonExecutionRecord | null> {
    let current: JuliusPythonExecutionRecord | null = null;
    const next = await this.mutate(input.executionId, input.projectId, (row) => {
      current = row;
      return row.state !== 'RUNNING' ? null : { ...row, state: 'CANCEL_REQUESTED', cancellation: { requestedBy: input.requestedBy, requestedAt: input.requestedAt }, version: row.version + 1 };
    });
    return next ?? current;
  }

  async settle(input: JuliusPythonSettleInput): Promise<JuliusPythonSettleResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const row = await this.lock(client, input.executionId, input.projectId);
      if (row === null || !input.expectedStates.includes(row.state)) {
        await client.query('ROLLBACK');
        return { settled: false, record: row };
      }
      const plan = await settleJuliusPythonPlanAsync(input, row, (groups) =>
        commitJuliusBrainGroupWithin(client, { brainId: row.brainId, projectId: row.projectId, recordedAt: input.recordedAt, groups }));
      const settled: JuliusPythonExecutionRecord = { ...row, state: plan.terminal, outcome: plan.outcome, completedAt: input.completedAt, version: row.version + 1 };
      await this.write(client, settled);
      await client.query('COMMIT');
      return { settled: true, record: settled };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async listInFlight(input: { readonly startedBefore: string; readonly limit: number }): Promise<readonly JuliusPythonExecutionRecord[]> {
    const result = await this.pool.query(
      `SELECT record FROM relay_wonderland.julius_python_executions WHERE state IN('RUNNING','CANCEL_REQUESTED') AND started_at<$1 ORDER BY started_at LIMIT $2`,
      [input.startedBefore, Math.max(1, Math.min(input.limit, 1_000))],
    );
    return result.rows.map((row) => parsed<JuliusPythonExecutionRecord>(row.record));
  }

  /* -------------------------------------------------------------- private */

  private async lock(client: Queryable, executionId: string, projectId: string): Promise<JuliusPythonExecutionRecord | null> {
    const result = await client.query('SELECT record FROM relay_wonderland.julius_python_executions WHERE execution_id=$1 AND project_id=$2 FOR UPDATE', [executionId, projectId]);
    return result.rows[0] ? parsed<JuliusPythonExecutionRecord>(result.rows[0].record) : null;
  }

  private async write(client: Queryable, record: JuliusPythonExecutionRecord): Promise<void> {
    const updated = await client.query(
      `UPDATE relay_wonderland.julius_python_executions SET state=$3,host_instance_id=$4,started_at=$5,completed_at=$6,version=$7,record=$8::jsonb
        WHERE execution_id=$1 AND project_id=$2 AND version=$9`,
      [record.executionId, record.projectId, record.state, record.hostInstanceId, record.startedAt, record.completedAt, record.version, JSON.stringify(record), record.version - 1],
    );
    if (updated.rowCount !== 1) throw new Error('julius_python_execution_version_moved_under_lock');
  }

  private async mutate(executionId: string, projectId: string, next: (row: JuliusPythonExecutionRecord) => JuliusPythonExecutionRecord | null): Promise<JuliusPythonExecutionRecord | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const row = await this.lock(client, executionId, projectId);
      const updated = row === null ? null : next(row);
      if (updated === null) {
        await client.query('ROLLBACK');
        return null;
      }
      await this.write(client, updated);
      await client.query('COMMIT');
      return updated;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
