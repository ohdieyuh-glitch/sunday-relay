import type { Pool } from 'pg';

import type {
  JuliusSubagentContext, JuliusSubagentRecord, JuliusSubagentState, JuliusSubagentStore,
} from '../mission/julius';

/**
 * DURABLE SUB-AGENT GRANTS.
 *
 * #172 authorized sub-agents with a pure function and stored nothing, so every
 * bound it enforced — depth, active count, total count, the permission subset —
 * was recomputed from numbers the REQUEST supplied and lost on restart. A
 * worker could state its own depth as zero and be believed.
 *
 * Every one of those numbers is read from this table instead. The counting
 * query and the insert run in ONE serializable transaction, so two workers
 * racing to spawn the last permitted child cannot both see a count below the
 * cap: the second is refused by the same bound the first passed.
 */

const json = (value: unknown) => JSON.stringify(value);
const parsed = <T>(value: unknown, fallback: T): T => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') { try { return JSON.parse(value) as T; } catch { return fallback; } }
  return value as T;
};

/** The states that count against the per-parent active bound. */
const ACTIVE_STATES = ['AUTHORIZED', 'ACTIVE'] as const;

export class JuliusSubagentPostgresRepository implements JuliusSubagentStore {
  constructor(private readonly pool: Pool) {}

  async subagentContext(runId: string, parentTaskId: string): Promise<JuliusSubagentContext> {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT
         COALESCE((SELECT depth FROM relay_wonderland.julius_subagents WHERE run_id=$1 AND child_task_id=$2),0)::text AS parent_depth,
         COALESCE((SELECT permissions FROM relay_wonderland.julius_subagents WHERE run_id=$1 AND child_task_id=$2),'[]'::jsonb) AS parent_permissions,
         (SELECT count(*) FROM relay_wonderland.julius_subagents WHERE run_id=$1 AND parent_task_id=$2 AND state=ANY($3))::text AS active_children,
         (SELECT count(*) FROM relay_wonderland.julius_subagents WHERE run_id=$1)::text AS total_children`,
      [runId, parentTaskId, ACTIVE_STATES],
    );
    const row = result.rows[0] ?? {};
    return {
      parentDepth: Number(row.parent_depth ?? 0),
      activeChildren: Number(row.active_children ?? 0),
      totalChildren: Number(row.total_children ?? 0),
      parentPermissions: parsed<string[]>(row.parent_permissions, []),
    };
  }

  /**
   * Insert the grant, or report the one that is already there.
   *
   * `ON CONFLICT DO NOTHING` on the primary key is what makes a retried spawn
   * safe: the second attempt records nothing and is told it is a duplicate,
   * rather than raising and rolling back a transaction that already inserted
   * the child task.
   */
  async recordSubagent(record: JuliusSubagentRecord): Promise<{ recorded: boolean; duplicate: boolean }> {
    const result = await this.pool.query(
      `INSERT INTO relay_wonderland.julius_subagents
         (request_id,run_id,project_id,parent_task_id,child_task_id,depth,capability,permissions,budget_reservation_id,state)
       SELECT $1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10
        WHERE EXISTS(SELECT 1 FROM relay_wonderland.julius_runs WHERE run_id=$2 AND project_id=$3)
       ON CONFLICT(request_id) DO NOTHING`,
      [record.requestId, record.runId, record.projectId, record.parentTaskId, record.childTaskId,
        record.depth, record.capability, json(record.permissions), record.budgetReservationId, record.state],
    );
    const recorded = result.rowCount === 1;
    return { recorded, duplicate: !recorded };
  }

  async loadSubagent(runId: string, requestId: string): Promise<JuliusSubagentRecord | null> {
    const result = await this.pool.query<Record<string, unknown>>(
      'SELECT * FROM relay_wonderland.julius_subagents WHERE run_id=$1 AND request_id=$2',
      [runId, requestId],
    );
    return result.rows[0] ? this.map(result.rows[0]) : null;
  }

  async subagentsForRun(runId: string): Promise<readonly JuliusSubagentRecord[]> {
    const result = await this.pool.query<Record<string, unknown>>(
      'SELECT * FROM relay_wonderland.julius_subagents WHERE run_id=$1 ORDER BY created_at,request_id LIMIT 1000',
      [runId],
    );
    return result.rows.map((row) => this.map(row));
  }

  /**
   * A terminal state is FINAL. The `state<>ALL(terminal)` guard is what stops a
   * late worker callback from moving a cancelled sub-agent back to SUCCEEDED —
   * the same shape as `result_after_cancellation` on the task side.
   */
  async setSubagentState(runId: string, requestId: string, state: JuliusSubagentState): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE relay_wonderland.julius_subagents SET state=$3,updated_at=now()
        WHERE run_id=$1 AND request_id=$2 AND state<>ALL($4)`,
      [runId, requestId, state, ['SUCCEEDED', 'FAILED', 'CANCELLED']],
    );
    return result.rowCount === 1;
  }

  private map(row: Record<string, unknown>): JuliusSubagentRecord {
    return {
      requestId: String(row.request_id),
      runId: String(row.run_id),
      projectId: String(row.project_id),
      parentTaskId: String(row.parent_task_id),
      childTaskId: String(row.child_task_id),
      depth: Number(row.depth),
      capability: String(row.capability),
      permissions: parsed<string[]>(row.permissions, []),
      budgetReservationId: String(row.budget_reservation_id),
      state: String(row.state) as JuliusSubagentState,
    };
  }
}
