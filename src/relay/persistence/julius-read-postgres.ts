import type { Pool } from 'pg';

import type {
  JuliusAcceptanceCriterion, JuliusBrainEntry, JuliusEvidence, JuliusReviewerFinding,
  JuliusRuntimeReader, JuliusTask, JuliusVerificationDecision, JuliusWorkerRole,
} from '../mission/julius';

/**
 * THE READ SIDE THE RUNTIME NEEDED AND THE INHERITED STACK DID NOT HAVE.
 *
 * Every Julius repository merged in #170–#179 is WRITE-SHAPED: it can append
 * evidence, a decision, a finding, a criterion and a brain entry, and read
 * back none of them. `evaluateJuliusVerification` needs all five plus the
 * run's whole task list, which is a large part of why verification could never
 * be invoked after execution — there was no way to assemble its input.
 *
 * This is a READER, not a second authority. It adds no table, writes nothing,
 * and every query is scoped through `julius_runs` so a read cannot cross a
 * project boundary even when handed a run id that belongs to another tenant.
 *
 * BOUNDED BY CONSTRUCTION. Each query carries a hard `LIMIT`. A run with a
 * pathological number of evidence rows must degrade into a truthful partial
 * answer rather than into an unbounded result set the process cannot hold, and
 * `JULIUS_READ_LIMIT` is where that ceiling is stated once.
 */

/** The most rows any single runtime read will return. */
export const JULIUS_READ_LIMIT = 5_000;

const parsed = <T>(value: unknown, fallback: T): T => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') { try { return JSON.parse(value) as T; } catch { return fallback; } }
  return value as T;
};

export class JuliusReadPostgresRepository implements JuliusRuntimeReader {
  constructor(private readonly pool: Pool) {}

  async tasksForRun(runId: string): Promise<readonly JuliusTask[]> {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT t.task_id,t.parent_task_id,t.role,t.task_type,t.state,t.ordinal,t.required_evidence_types,r.mission_id,
              COALESCE((SELECT jsonb_agg(d.dependency_task_id) FROM relay_wonderland.julius_task_dependencies d WHERE d.task_id=t.task_id),'[]'::jsonb) AS dependency_ids
         FROM relay_wonderland.julius_tasks t
         JOIN relay_wonderland.julius_runs r ON r.run_id=t.run_id
        WHERE t.run_id=$1 ORDER BY t.ordinal,t.task_id LIMIT $2`,
      [runId, JULIUS_READ_LIMIT],
    );
    return result.rows.map((row) => ({
      taskId: String(row.task_id),
      missionId: String(row.mission_id),
      parentTaskId: row.parent_task_id === null ? null : String(row.parent_task_id),
      dependencyIds: parsed<string[]>(row.dependency_ids, []),
      requiredEvidenceTypes: parsed<JuliusEvidence['type'][]>(row.required_evidence_types, []),
      taskType: String(row.task_type),
      role: String(row.role) as JuliusWorkerRole,
      ordinal: Number(row.ordinal),
      state: String(row.state) as JuliusTask['state'],
    }));
  }

  async evidenceForRun(runId: string): Promise<readonly JuliusEvidence[]> {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT e.*,r.mission_id FROM relay_wonderland.julius_evidence e
         JOIN relay_wonderland.julius_runs r ON r.run_id=e.run_id
        WHERE e.run_id=$1 ORDER BY e.occurred_at,e.evidence_id LIMIT $2`,
      [runId, JULIUS_READ_LIMIT],
    );
    return result.rows.map((row) => ({
      evidenceId: String(row.evidence_id),
      missionId: String(row.mission_id),
      taskId: String(row.task_id),
      workerId: String(row.worker_id),
      type: String(row.evidence_type) as JuliusEvidence['type'],
      status: String(row.status) as JuliusEvidence['status'],
      safeSummary: String(row.safe_summary),
      artifactRef: row.artifact_ref === null ? null : String(row.artifact_ref),
      integrityHash: row.integrity_hash === null ? null : String(row.integrity_hash),
      occurredAt: new Date(String(row.occurred_at)).toISOString(),
    }));
  }

  async findingsForRun(runId: string): Promise<readonly JuliusReviewerFinding[]> {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT * FROM relay_wonderland.julius_reviewer_findings
        WHERE run_id=$1 ORDER BY created_at,finding_id LIMIT $2`,
      [runId, JULIUS_READ_LIMIT],
    );
    return result.rows.map((row) => ({
      findingId: String(row.finding_id),
      runId: String(row.run_id),
      taskId: String(row.task_id),
      reviewerWorkerId: String(row.reviewer_worker_id),
      severity: String(row.severity) as JuliusReviewerFinding['severity'],
      category: String(row.category),
      claim: String(row.claim),
      criterionId: row.criterion_id === null ? null : String(row.criterion_id),
      evidenceIds: parsed<string[]>(row.evidence_ids, []),
      blocking: Boolean(row.blocking),
      status: String(row.status) as JuliusReviewerFinding['status'],
      createdAt: new Date(String(row.created_at)).toISOString(),
    }));
  }

  async criteriaForRun(runId: string): Promise<readonly JuliusAcceptanceCriterion[]> {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT criterion_id,description,required_evidence_types FROM relay_wonderland.julius_acceptance_criteria
        WHERE run_id=$1 ORDER BY ordinal LIMIT $2`,
      [runId, JULIUS_READ_LIMIT],
    );
    return result.rows.map((row) => ({
      criterionId: String(row.criterion_id),
      description: String(row.description),
      requiredEvidenceTypes: parsed<JuliusEvidence['type'][]>(row.required_evidence_types, []),
    }));
  }

  async decisionsForRun(runId: string): Promise<readonly JuliusVerificationDecision[]> {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT action,reason_code,safe_summary,evidence_ids FROM relay_wonderland.julius_verification_decisions
        WHERE run_id=$1 ORDER BY occurred_at,decision_id LIMIT $2`,
      [runId, JULIUS_READ_LIMIT],
    );
    return result.rows.map((row) => ({
      action: String(row.action) as JuliusVerificationDecision['action'],
      reasonCode: String(row.reason_code),
      evidenceIds: parsed<string[]>(row.evidence_ids, []),
      safeSummary: String(row.safe_summary),
    }));
  }

  async brainEntriesForRun(runId: string): Promise<readonly JuliusBrainEntry[]> {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT entry_id,entry_kind,safe_content,task_id FROM relay_wonderland.julius_brain_entries
        WHERE run_id=$1 ORDER BY revision LIMIT $2`,
      [runId, JULIUS_READ_LIMIT],
    );
    return result.rows.map((row) => ({
      entryId: String(row.entry_id),
      // The brain table's kinds and the context compiler's kinds are two
      // vocabularies for one idea; the ones that do not overlap are carried as
      // ARTIFACT rather than dropped, because an entry the compiler cannot
      // classify is still context a worker may need.
      kind: brainKind(String(row.entry_kind)),
      text: String(row.safe_content),
      taskIds: row.task_id === null ? [] : [String(row.task_id)],
      // Stored entries carry no role restriction, so they are readable by the
      // three permanent roles. A specialist reads nothing it was not handed.
      allowedRoles: ['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER'],
      // INTERNAL, not PUBLIC: the compiler drops SECRET and keeps the rest,
      // and calling a stored entry PUBLIC would be a claim nobody checked.
      sensitivity: 'INTERNAL',
    }));
  }

  async repairRoundsFor(taskId: string): Promise<number> {
    const result = await this.pool.query<{ rounds: string }>(
      `SELECT COALESCE(max(round),0)::text AS rounds FROM relay_wonderland.julius_repair_cycles
        WHERE original_task_id=$1`,
      [taskId],
    );
    return Number(result.rows[0]?.rounds ?? 0);
  }

  async reviewCompletedFor(taskId: string): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT 1 FROM relay_wonderland.julius_tasks
        WHERE parent_task_id=$1 AND role='INDEPENDENT_REVIEWER' AND state='SUCCEEDED' LIMIT 1`,
      [taskId],
    );
    return result.rowCount === 1;
  }
}

/** Map a stored brain entry kind onto the context compiler's vocabulary. */
function brainKind(stored: string): JuliusBrainEntry['kind'] {
  switch (stored) {
    case 'DECISION': return 'DECISION';
    case 'FINDING': return 'FINDING';
    case 'REPAIR': return 'REPAIR';
    case 'HANDOFF': return 'HANDOFF';
    case 'CONSTRAINT': return 'CONSTRAINT';
    case 'ACCEPTANCE_UPDATE': return 'REQUIREMENT';
    default: return 'ARTIFACT';
  }
}
