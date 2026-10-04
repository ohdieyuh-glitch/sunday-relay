import type { Pool, PoolClient } from 'pg';
import { appendJuliusEventWithin } from './julius-event-postgres';
import { juliusSerializable } from './julius-serializable';
import {
  MAX_TASK_RECOVERIES, juliusRecoverySettlementEvent, planJuliusRecovery, planJuliusRecoverySettlements,
  type JuliusMissionState, type JuliusOpenReservation, type JuliusRecoveryAction, type JuliusRecoveryCandidate, type JuliusRecoverySettlement,
} from '../mission/julius';

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

  /**
   * Result and task transition are one boundary. Duplicate callbacks return the prior result; stale generations never mutate the task.
   *
   * A serialization failure is retried (`juliusSerializable`): the body is SQL
   * over a result the caller built, and idempotent by `(run_id,
   * idempotency_key)` besides. Unretried, a 40001 here was caught by the
   * execution coordinator as "Execution boundary failed." — a WORKER failure,
   * non-retryable — and the mission FAILED for a database race its worker
   * never saw (measured: two run loops, six missions, one in four runs).
   */
  async acceptWorkerResult(input: JuliusWorkerResultInput): Promise<JuliusResultReceipt> {
    return juliusSerializable(this.pool, async (client) => {
      const existing = await client.query<{ status: string }>('SELECT status FROM relay_wonderland.julius_worker_results WHERE run_id=$1 AND idempotency_key=$2 FOR UPDATE', [input.runId, input.idempotencyKey]);
      if (existing.rows[0]) return { recorded: false, duplicate: true, taskState: existing.rows[0].status };
      const task = await client.query<{ state: string; lease_generation: string; project_id: string; run_state: JuliusMissionState }>(`SELECT t.state,t.lease_generation,r.project_id,r.state AS run_state FROM relay_wonderland.julius_tasks t JOIN relay_wonderland.julius_runs r ON r.run_id=t.run_id WHERE t.task_id=$1 AND t.run_id=$2 FOR UPDATE OF t,r`, [input.taskId, input.runId]);
      const row = task.rows[0]; if (!row || row.project_id !== input.projectId) throw new Error('julius_task_not_found');
      if (row.run_state === 'CANCELLED' || row.state === 'CANCELLED') throw new Error('result_after_cancellation');
      if (row.state !== 'ACTIVE' || Number(row.lease_generation) !== input.leaseGeneration) throw new Error('stale_worker_result');
      await client.query(`INSERT INTO relay_wonderland.julius_worker_results(result_id,run_id,task_id,lease_generation,worker_id,status,safe_summary,evidence_ids,provider_receipt_ids,idempotency_key,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11)`, [input.resultId,input.runId,input.taskId,input.leaseGeneration,input.workerId,input.status,input.safeSummary,json(input.evidenceIds),json(input.providerReceiptIds),input.idempotencyKey,input.occurredAt]);
      const next = input.status === 'SUCCEEDED' ? 'SUCCEEDED' : input.status === 'FAILED' ? 'FAILED' : 'CANCELLED';
      await client.query(`UPDATE relay_wonderland.julius_tasks SET state=$4,lease_owner=NULL,lease_expires_at=NULL,version=version+1,updated_at=$5 WHERE task_id=$1 AND run_id=$2 AND lease_generation=$3`, [input.taskId,input.runId,input.leaseGeneration,next,input.occurredAt]);
      return { recorded: true, duplicate: false, taskState: next };
    });
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
    // ROW 13 (i), THE TASK PATH (P2-1). The sweep runs before every tick of every loop and almost always finds
    // nothing, yet as a SERIALIZABLE read it held a predicate lock on every ACTIVE task row: an rw edge into every
    // serializable task write of that tick. So a lock-free probe asks first, in its own READ COMMITTED, READ ONLY
    // transaction (explicit, so a database whose default is SERIALIZABLE cannot turn it back into a predicate read),
    // whether any lease has expired. Only then does the serializable sweep below open, unchanged. A lease that expires
    // just after a negative probe is swept by the next tick, as one that expired during the sweep's own scan always was.
    if (!await this.anyLeaseExpired(now, projectId)) return [];
    // SQL over the expired rows it selects, and pure planning: a serialization
    // failure is retried (`juliusSerializable`) — the kernel sweeps before every
    // tick, so an unretried 40001 here threw the tick itself.
    return juliusSerializable(this.pool, async (client) => {
      // HANDED: the coordinator writes `worker.dispatched` for the claimed attempt
      // before it hands the work to a provider, so the event is the durable
      // answer to "may this attempt have been paid for?". A handed attempt is
      // never requeued (`planJuliusRecovery`).
      const rows = await client.query<Record<string, unknown>>(`SELECT t.task_id,t.run_id,t.attempt,t.recoveries,t.lease_generation,2 AS max_retries,r.project_id,r.state AS run_state,EXISTS(SELECT 1 FROM relay_wonderland.events e WHERE e.stream_id=t.run_id AND e.event_type='julius.worker.dispatched' AND e.payload->>'taskId'=t.task_id AND e.payload->'facts'->>'attempt'=t.attempt::text) AS handed FROM relay_wonderland.julius_tasks t JOIN relay_wonderland.julius_runs r ON r.run_id=t.run_id WHERE t.state='ACTIVE' AND t.lease_expires_at<=$1 AND ($3::text IS NULL OR r.project_id=$3) ORDER BY t.lease_expires_at,t.created_at FOR UPDATE OF t SKIP LOCKED LIMIT $2`, [now,limit,projectId??null]);
      const actions: JuliusRecoveryAction[] = [];
      for (const row of rows.rows) {
        const candidate: JuliusRecoveryCandidate = { runId:String(row.run_id),projectId:String(row.project_id),runState:String(row.run_state) as JuliusMissionState,taskId:String(row.task_id),attempt:Number(row.attempt),maxRetries:Number(row.max_retries),leaseGeneration:Number(row.lease_generation),recoveries:Number(row.recoveries),maxRecoveries:MAX_TASK_RECOVERIES,handed:row.handed===true };
        const action = planJuliusRecovery(candidate);
        const state = action.action === 'REQUEUE' ? 'RUNNABLE' : action.action === 'CANCEL_TASK' ? 'CANCELLED' : 'FAILED';
        // COUNTED ON THE WAY OUT, in the same statement that hands the task
        // back, so a crash between the two cannot leave a requeue uncounted
        // and the loop unbounded. A terminal decision does not raise it: the
        // number bounds how many more turns recovery may give, and a task with
        // no turns left is not being given one.
        await client.query(`UPDATE relay_wonderland.julius_tasks SET state=$3,lease_owner=NULL,lease_expires_at=NULL,next_attempt_at=$2,recoveries=recoveries+$5,version=version+1,updated_at=$2 WHERE task_id=$1 AND state='ACTIVE' AND lease_generation=$4`, [candidate.taskId,now,state,candidate.leaseGeneration,action.action==='REQUEUE'?1:0]);
        const settlements = await closeRecoveredReservations(client, candidate, now);
        actions.push(settlements.length > 0 ? { ...action, settlements } : action);
      }
      return actions;
    });
  }

  /** Whether any ACTIVE task's lease has expired, read without a predicate lock (READ COMMITTED, READ ONLY). */
  private async anyLeaseExpired(now: string, projectId?: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY');
      const probe = await client.query<{ expired: boolean }>(
        `SELECT EXISTS(SELECT 1 FROM relay_wonderland.julius_tasks t JOIN relay_wonderland.julius_runs r ON r.run_id=t.run_id
          WHERE t.state='ACTIVE' AND t.lease_expires_at<=$1 AND ($2::text IS NULL OR r.project_id=$2)) AS expired`,
        [now, projectId ?? null],
      );
      await client.query('COMMIT');
      return probe.rows[0]?.expired === true;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

/**
 * (a2) STEP 2, IN THE SWEEP'S OWN TRANSACTION: every reservation the recovered task left open (a
 * `budget.reserved` row of this task with no `budget.settled` for its id), closed by the shared rule
 * (`planJuliusRecoverySettlements`) and written by the shared row, before the lease change commits.
 *
 * Each close is an ordinary append (`appendJuliusEventWithin`), which locks the run row and moves
 * the run's stream counter. So a settlement another writer commits while this sweep runs moves the
 * same counter: this serializable transaction then fails with 40001, `juliusSerializable` retries
 * it, and the retry reads that settlement and writes no second close. The locks are taken task
 * first, then run, the order the fenced handoff takes them too.
 */
async function closeRecoveredReservations(
  client: PoolClient,
  task: Pick<JuliusRecoveryCandidate, 'runId' | 'projectId' | 'taskId'>,
  now: string,
): Promise<JuliusRecoverySettlement[]> {
  const reserved = await client.query<{ reservation_id: string; role: string | null; attempt: unknown }>(
    `SELECT reservation_id,role,attempt FROM (
       SELECT DISTINCT ON (e.payload->'facts'->>'reservationId') e.payload->'facts'->>'reservationId' AS reservation_id,
              e.payload->'facts'->>'role' AS role,e.payload->'facts'->'attempt' AS attempt,e.sequence
         FROM relay_wonderland.events e
        WHERE e.stream_id=$1 AND e.event_type='julius.budget.reserved' AND e.payload->>'taskId'=$2
          AND COALESCE(e.payload->'facts'->>'reservationId','')<>''
          AND NOT EXISTS(SELECT 1 FROM relay_wonderland.events s WHERE s.stream_id=e.stream_id AND s.event_type='julius.budget.settled'
                          AND s.payload->'facts'->>'reservationId'=e.payload->'facts'->>'reservationId')
        ORDER BY e.payload->'facts'->>'reservationId',e.sequence) opened
     ORDER BY sequence`,
    [task.runId, task.taskId]);
  if (reserved.rows.length === 0) return [];
  const dispatched = await client.query<{ attempt: unknown; reservation_id: string | null }>(
    `SELECT e.payload->'facts'->'attempt' AS attempt,NULLIF(e.payload->'facts'->>'reservationId','') AS reservation_id FROM relay_wonderland.events e WHERE e.stream_id=$1 AND e.event_type='julius.worker.dispatched' AND e.payload->>'taskId'=$2`,
    [task.runId, task.taskId]);
  const open: JuliusOpenReservation[] = reserved.rows.map((row) => ({
    reservationId: row.reservation_id,
    role: row.role,
    attempt: typeof row.attempt === 'number' ? row.attempt : null,
  }));
  const settlements = planJuliusRecoverySettlements(open, dispatched.rows.map((row) => ({
    attempt: typeof row.attempt === 'number' ? row.attempt : null,
    reservationId: row.reservation_id,
  })));
  for (const [index, settlement] of settlements.entries()) {
    await appendJuliusEventWithin(client, juliusRecoverySettlementEvent({ ...task, reservation: open[index]!, settlement, occurredAt: now }));
  }
  return settlements;
}
