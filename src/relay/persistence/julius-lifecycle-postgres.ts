import type { Pool } from 'pg';

import {
  planRunStatePath,
  type JuliusApprovalRecord, type JuliusApprovalState, type JuliusApprovalStore,
  type JuliusLifecycleStore, type JuliusMissionState, type JuliusPolicyOperation,
} from '../mission/julius';
import { transitionJuliusRunWithin } from './julius-postgres';
import { juliusSerializable } from './julius-serializable';

/**
 * DURABLE APPROVALS AND LIFECYCLE FACTS.
 *
 * TWO IDEMPOTENCY RULES, BOTH IN THE SCHEMA. `UNIQUE(run_id, idempotency_key)`
 * makes a retried request a no-op. The partial index
 * `WHERE state='PENDING'` makes two workers reaching the same gate produce ONE
 * request for a human — which is the rule that matters, because the two
 * workers have different operation ids and would otherwise each raise one.
 *
 * A DECIDED APPROVAL STAYS DECIDED. `state='PENDING'` in the WHERE clause of
 * `decideApproval` is what makes a second approver lose the race without
 * anything breaking, and what stops a late denial overwriting an approval that
 * has already let work through.
 */

export class JuliusLifecyclePostgresRepository implements JuliusApprovalStore, JuliusLifecycleStore {
  constructor(private readonly pool: Pool) {}

  async requestApproval(record: JuliusApprovalRecord): Promise<{ created: boolean; record: JuliusApprovalRecord }> {
    const inserted = await this.pool.query(
      `INSERT INTO relay_wonderland.julius_approvals
         (approval_id,run_id,project_id,task_id,operation,policy_revision,reason_code,safe_rationale,state,requested_at,idempotency_key)
       SELECT $1,$2,$3,$4,$5,$6,$7,$8,'PENDING',$9,$10
        WHERE EXISTS(SELECT 1 FROM relay_wonderland.julius_runs WHERE run_id=$2 AND project_id=$3)
       ON CONFLICT DO NOTHING`,
      [record.approvalId, record.runId, record.projectId, record.taskId, record.operation,
        record.policyRevision, record.reasonCode, record.safeRationale, record.requestedAt, record.idempotencyKey],
    );
    if (inserted.rowCount === 1) return { created: true, record };

    // `ON CONFLICT DO NOTHING` covers the primary key, the idempotency key AND
    // the one-pending index, so the existing row is found by whichever of them
    // fired: first the caller's own key, then the open gate.
    const byKey = await this.pool.query<Record<string, unknown>>(
      'SELECT * FROM relay_wonderland.julius_approvals WHERE run_id=$1 AND idempotency_key=$2',
      [record.runId, record.idempotencyKey],
    );
    if (byKey.rows[0]) return { created: false, record: this.map(byKey.rows[0]) };

    const pending = await this.pool.query<Record<string, unknown>>(
      `SELECT * FROM relay_wonderland.julius_approvals
        WHERE run_id=$1 AND COALESCE(task_id,'')=COALESCE($2,'') AND operation=$3 AND state='PENDING'`,
      [record.runId, record.taskId, record.operation],
    );
    return pending.rows[0] ? { created: false, record: this.map(pending.rows[0]) } : { created: false, record };
  }

  /**
   * THE GATE AND ITS RECORDED MOVE TO BLOCKED, ONE TRANSACTION, ON THE SHARED RETRY POLICY. A 40001 from
   * the run loop writing the same run is replayed by `juliusSerializable`: the body is SQL over the
   * caller's record, idempotent by `(run_id, idempotency_key)`, and a stale `expectedRunVersion` is the
   * caller's own conflict, surfaced at once.
   */
  async requestApprovalAndBlock(input:{record:JuliusApprovalRecord;expectedRunVersion:number}):Promise<{created:boolean;record:JuliusApprovalRecord;runState:'BLOCKED'}>{
    return juliusSerializable(this.pool,async(client)=>{const locked=await client.query('SELECT state,version,mission_id FROM relay_wonderland.julius_runs WHERE run_id=$1 AND project_id=$2 FOR UPDATE',[input.record.runId,input.record.projectId]);if(!locked.rows[0])throw new Error('julius_run_not_found');const prior=await client.query<Record<string,unknown>>('SELECT * FROM relay_wonderland.julius_approvals WHERE run_id=$1 AND idempotency_key=$2 FOR UPDATE',[input.record.runId,input.record.idempotencyKey]);if(prior.rows[0]){if(locked.rows[0].state!=='BLOCKED')throw new Error('approval_run_state_conflict');return{created:false,record:this.map(prior.rows[0]),runState:'BLOCKED'};}if(Number(locked.rows[0].version)!==input.expectedRunVersion)throw new Error('julius_run_version_conflict');if(['COMPLETED','FAILED','CANCELLED'].includes(String(locked.rows[0].state)))throw new Error('julius_run_terminal');
      const inserted=await client.query(`INSERT INTO relay_wonderland.julius_approvals(approval_id,run_id,project_id,task_id,operation,policy_revision,reason_code,safe_rationale,state,requested_at,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'PENDING',$9,$10) ON CONFLICT DO NOTHING RETURNING *`,[input.record.approvalId,input.record.runId,input.record.projectId,input.record.taskId,input.record.operation,input.record.policyRevision,input.record.reasonCode,input.record.safeRationale,input.record.requestedAt,input.record.idempotencyKey]);
      let record=input.record;if(!inserted.rows[0]){const collision=await client.query<Record<string,unknown>>('SELECT run_id,project_id FROM relay_wonderland.julius_approvals WHERE approval_id=$1',[input.record.approvalId]);if(collision.rows[0]&&(collision.rows[0].run_id!==input.record.runId||collision.rows[0].project_id!==input.record.projectId))throw new Error('approval_id_scope_conflict');const existing=await client.query<Record<string,unknown>>(`SELECT * FROM relay_wonderland.julius_approvals WHERE run_id=$1 AND COALESCE(task_id,'')=COALESCE($2,'') AND operation=$3 AND state='PENDING' ORDER BY requested_at LIMIT 1 FOR UPDATE`,[input.record.runId,input.record.taskId,input.record.operation]);if(!existing.rows[0])throw new Error('approval_conflict_without_record');record=this.map(existing.rows[0]);}
      // THE MOVE TO BLOCKED IS A TRANSITION, RECORDED AS ONE. It was a bare
      // UPDATE: no transition-table check, no `julius_transitions` row and no
      // `julius.run.transitioned` event, so a gated run's history showed a
      // BLOCKED -> READY grant with no BLOCKED before it. It now takes the walk
      // the in-memory store takes (`planRunStatePath`: READY reaches BLOCKED
      // through EXECUTING), every step checked by `transitionMission` and
      // written by `transitionJuliusRunWithin` — inside THIS transaction, so the
      // PENDING row and the recorded move still commit together or not at all.
      const from=String(locked.rows[0].state) as JuliusMissionState;
      const path=from==='BLOCKED'?[]:planRunStatePath(from,'BLOCKED');
      if(from!=='BLOCKED'&&path.length===0)throw new Error('approval_block_unreachable');
      let current={runId:input.record.runId,projectId:input.record.projectId,missionId:String(locked.rows[0].mission_id),state:from,version:input.expectedRunVersion};
      for(const [index,step] of path.entries()){
        const last=index===path.length-1;
        await transitionJuliusRunWithin(client,current,{
          commandId:`approval:${input.record.approvalId}:${current.version}:${step}`,to:step,
          reasonCode:last?'APPROVAL_REQUIRED':'PASSED_THROUGH',
          safeSummary:last?`Waiting on an authorized approval for ${input.record.operation}.`:`Run passed through ${step} on the way to BLOCKED.`,
          evidenceIds:[],occurredAt:input.record.requestedAt,
        });
        current={...current,state:step,version:current.version+1};
      }
      return{created:inserted.rowCount===1,record,runState:'BLOCKED'};
    });
  }

  async loadApproval(runId: string, approvalId: string, projectId: string): Promise<JuliusApprovalRecord | null> {
    const result = await this.pool.query<Record<string, unknown>>(
      'SELECT * FROM relay_wonderland.julius_approvals WHERE run_id=$1 AND approval_id=$2 AND project_id=$3',
      [runId, approvalId, projectId],
    );
    return result.rows[0] ? this.map(result.rows[0]) : null;
  }

  async pendingApprovals(runId: string, projectId: string): Promise<readonly JuliusApprovalRecord[]> {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT * FROM relay_wonderland.julius_approvals
        WHERE run_id=$1 AND project_id=$2 AND state='PENDING' ORDER BY requested_at,approval_id LIMIT 200`,
      [runId, projectId],
    );
    return result.rows.map((row) => this.map(row));
  }

  /** A denial ends the run; the claim already refuses a run holding one (the same state list). */
  async deniedApprovals(runId: string, projectId: string): Promise<readonly JuliusApprovalRecord[]> {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT * FROM relay_wonderland.julius_approvals
        WHERE run_id=$1 AND project_id=$2 AND state='DENIED' ORDER BY decided_at,approval_id LIMIT 200`,
      [runId, projectId],
    );
    return result.rows.map((row) => this.map(row));
  }

  async decideApproval(input: {
    runId: string; approvalId: string; projectId: string;
    state: Extract<JuliusApprovalState, 'APPROVED' | 'DENIED' | 'CANCELLED'>;
    decidedBy: string; decisionReason: string; decidedAt: string;
  }): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE relay_wonderland.julius_approvals
          SET state=$4,decided_by=$5,decision_reason=$6,decided_at=$7
        WHERE run_id=$1 AND approval_id=$2 AND project_id=$3 AND state='PENDING'`,
      [input.runId, input.approvalId, input.projectId, input.state,
        input.decidedBy, input.decisionReason, input.decidedAt],
    );
    return result.rowCount === 1;
  }

  /**
   * Cancel every task that is not already finished.
   *
   * SUCCEEDED, FAILED, SKIPPED and CANCELLED are left alone: a cancellation
   * stops future work and does not rewrite the record of work that already
   * happened. The project is in the join, so a cancel cannot reach into
   * another tenant's run even with the right run id.
   */
  async cancelRunTasks(runId: string, projectId: string, now: string): Promise<number> {
    const result = await this.pool.query(
      `UPDATE relay_wonderland.julius_tasks t
          SET state='CANCELLED',lease_owner=NULL,lease_expires_at=NULL,version=t.version+1,updated_at=$3
         FROM relay_wonderland.julius_runs r
        WHERE r.run_id=t.run_id AND t.run_id=$1 AND r.project_id=$2
          AND t.state NOT IN('SUCCEEDED','FAILED','CANCELLED','SKIPPED')`,
      [runId, projectId, now],
    );
    return result.rowCount ?? 0;
  }

  async recordLifecycle(input: {
    runId: string; projectId: string; reason: string; actor: string; at: string;
  }): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE relay_wonderland.julius_runs
          SET lifecycle_reason=$3,lifecycle_actor=$4,lifecycle_at=$5
        WHERE run_id=$1 AND project_id=$2`,
      [input.runId, input.projectId, input.reason.slice(0, 500), input.actor.slice(0, 200), input.at],
    );
    return result.rowCount === 1;
  }

  private map(row: Record<string, unknown>): JuliusApprovalRecord {
    return {
      approvalId: String(row.approval_id),
      runId: String(row.run_id),
      projectId: String(row.project_id),
      taskId: row.task_id === null ? null : String(row.task_id),
      operation: String(row.operation) as JuliusPolicyOperation,
      policyRevision: String(row.policy_revision),
      reasonCode: String(row.reason_code),
      safeRationale: String(row.safe_rationale),
      state: String(row.state) as JuliusApprovalState,
      requestedAt: new Date(String(row.requested_at)).toISOString(),
      decidedAt: row.decided_at === null ? null : new Date(String(row.decided_at)).toISOString(),
      decidedBy: row.decided_by === null ? null : String(row.decided_by),
      decisionReason: row.decision_reason === null ? null : String(row.decision_reason),
      idempotencyKey: String(row.idempotency_key),
    };
  }
}
