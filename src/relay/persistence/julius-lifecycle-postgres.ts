import type { Pool } from 'pg';

import type {
  JuliusApprovalRecord, JuliusApprovalState, JuliusApprovalStore,
  JuliusLifecycleStore, JuliusPolicyOperation,
} from '../mission/julius';

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
