import type { Pool } from 'pg';
import { planJuliusRecovery, type JuliusMissionState, type JuliusRecoveryAction, type JuliusRecoveryCandidate } from '../mission/julius';

export interface JuliusWorkerResultInput {
  readonly resultId: string; readonly idempotencyKey: string; readonly runId: string; readonly projectId: string;
  readonly taskId: string; readonly leaseGeneration: number; readonly workerId: string;
  readonly status: 'SUCCEEDED' | 'FAILED' | 'CANCELLED'; readonly safeSummary: string;
  readonly evidenceIds: readonly string[]; readonly providerReceiptIds: readonly string[]; readonly occurredAt: string;
}
export interface JuliusResultReceipt { readonly recorded: boolean; readonly duplicate: boolean; readonly taskState: string; }
const json = (value: unknown) => JSON.stringify(value);

export class JuliusRecoveryPostgresRepository {
  constructor(private readonly pool: Pool) {}

  /** Result and task transition are one boundary. Duplicate callbacks return the prior result; stale generations never mutate the task. */
  async acceptWorkerResult(input: JuliusWorkerResultInput): Promise<JuliusResultReceipt> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const existing = await client.query<{ status: string }>('SELECT status FROM relay_wonderland.julius_worker_results WHERE run_id=$1 AND idempotency_key=$2 FOR UPDATE', [input.runId, input.idempotencyKey]);
      if (existing.rows[0]) { await client.query('COMMIT'); return { recorded: false, duplicate: true, taskState: existing.rows[0].status }; }
      const task = await client.query<{ state: string; lease_generation: string; project_id: string; run_state: JuliusMissionState }>(`SELECT t.state,t.lease_generation,r.project_id,r.state AS run_state FROM relay_wonderland.julius_tasks t JOIN relay_wonderland.julius_runs r ON r.run_id=t.run_id WHERE t.task_id=$1 AND t.run_id=$2 FOR UPDATE OF t,r`, [input.taskId, input.runId]);
      const row = task.rows[0]; if (!row || row.project_id !== input.projectId) throw new Error('julius_task_not_found');
      if (row.run_state === 'CANCELLED' || row.state === 'CANCELLED') throw new Error('result_after_cancellation');
      if (row.state !== 'ACTIVE' || Number(row.lease_generation) !== input.leaseGeneration) throw new Error('stale_worker_result');
      await client.query(`INSERT INTO relay_wonderland.julius_worker_results(result_id,run_id,task_id,lease_generation,worker_id,status,safe_summary,evidence_ids,provider_receipt_ids,idempotency_key,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11)`, [input.resultId,input.runId,input.taskId,input.leaseGeneration,input.workerId,input.status,input.safeSummary,json(input.evidenceIds),json(input.providerReceiptIds),input.idempotencyKey,input.occurredAt]);
      const next = input.status === 'SUCCEEDED' ? 'SUCCEEDED' : input.status === 'FAILED' ? 'FAILED' : 'CANCELLED';
      await client.query(`UPDATE relay_wonderland.julius_tasks SET state=$4,lease_owner=NULL,lease_expires_at=NULL,version=version+1,updated_at=$5 WHERE task_id=$1 AND run_id=$2 AND lease_generation=$3`, [input.taskId,input.runId,input.leaseGeneration,next,input.occurredAt]);
      await client.query('COMMIT'); return { recorded: true, duplicate: false, taskState: next };
    } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; } finally { client.release(); }
  }

  /**
   * Reclaim expired leases.
   *
   * `projectId` is OPTIONAL and additive: omitted, this sweeps every project,
   * which is what an operator-level recovery worker wants and what the
   * inherited signature did unconditionally. Supplied, it scopes the sweep —
   * so a per-tenant worker can exist without one tenant's recovery pass
   * touching another's tasks. Adding the parameter rather than requiring it
   * keeps every existing caller correct.
   */
  async recoverExpired(now: string, limit = 100, projectId?: string): Promise<JuliusRecoveryAction[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error('invalid_recovery_limit');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const rows = await client.query<Record<string, unknown>>(`SELECT t.task_id,t.run_id,t.attempt,t.lease_generation,2 AS max_retries,r.project_id,r.state AS run_state FROM relay_wonderland.julius_tasks t JOIN relay_wonderland.julius_runs r ON r.run_id=t.run_id WHERE t.state='ACTIVE' AND t.lease_expires_at<=$1 AND ($3::text IS NULL OR r.project_id=$3) ORDER BY t.lease_expires_at,t.created_at FOR UPDATE OF t SKIP LOCKED LIMIT $2`, [now,limit,projectId??null]);
      const actions: JuliusRecoveryAction[] = [];
      for (const row of rows.rows) {
        const candidate: JuliusRecoveryCandidate = { runId:String(row.run_id),projectId:String(row.project_id),runState:String(row.run_state) as JuliusMissionState,taskId:String(row.task_id),attempt:Number(row.attempt),maxRetries:Number(row.max_retries),leaseGeneration:Number(row.lease_generation) };
        const action = planJuliusRecovery(candidate); actions.push(action);
        const state = action.action === 'REQUEUE' ? 'RUNNABLE' : action.action === 'CANCEL_TASK' ? 'CANCELLED' : 'FAILED';
        await client.query(`UPDATE relay_wonderland.julius_tasks SET state=$3,lease_owner=NULL,lease_expires_at=NULL,next_attempt_at=$2,version=version+1,updated_at=$2 WHERE task_id=$1 AND state='ACTIVE' AND lease_generation=$4`, [candidate.taskId,now,state,candidate.leaseGeneration]);
      }
      await client.query('COMMIT'); return actions;
    } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; } finally { client.release(); }
  }
}
