import type { Pool } from 'pg';

import type {
  JuliusAcceptanceCriterion, JuliusBrainEntry, JuliusEvidence, JuliusReviewerFinding,
  JuliusRecordedDecision, JuliusRuntimeReader, JuliusTask, JuliusTaskContractBinding, JuliusTaskRecord,
  JuliusVerificationDecision, JuliusWorkerRole,
} from '../mission/julius';
import { brainKindFromStored } from './julius-brain-kinds';

/**
 * THE READ SIDE THE RUNTIME NEEDED AND THE INHERITED STACK DID NOT HAVE.
 *
 * Every Julius repository merged in #170–#179 is WRITE-SHAPED: it can append
 * evidence, a decision, a finding, a criterion and a brain entry, and read
 * back none of them. `evaluateJuliusVerification` needs all five plus the
 * run's whole task list, which is a large part of why verification could never
 * be invoked after execution — there was no way to assemble its input.
 *
 * THIS IS A READER, NOT A SECOND AUTHORITY. It adds no table and writes
 * nothing. Every query joins `julius_runs` and filters on BOTH the run and the
 * project, so a read cannot cross a project boundary even when handed a run id
 * that belongs to another tenant.
 *
 * The first version of this file carried that sentence and none of the
 * queries: they filtered on `run_id` alone, and a caller holding a run id from
 * another tenant would have been served its evidence, findings, criteria,
 * decisions and Project Brain. A tenancy claim in a comment that the SQL does
 * not make is worse than no claim, because the next reader trusts it.
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

  async tasksForRun(runId: string, projectId: string): Promise<readonly JuliusTaskRecord[]> {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT t.task_id,t.parent_task_id,t.role,t.task_type,t.state,t.ordinal,t.required_evidence_types,t.lease_generation,r.mission_id,
              COALESCE((SELECT jsonb_agg(d.dependency_task_id) FROM relay_wonderland.julius_task_dependencies d WHERE d.task_id=t.task_id),'[]'::jsonb) AS dependency_ids
         FROM relay_wonderland.julius_tasks t
         JOIN relay_wonderland.julius_runs r ON r.run_id=t.run_id
        WHERE t.run_id=$1 AND r.project_id=$2 ORDER BY t.ordinal,t.task_id LIMIT $3`,
      [runId, projectId, JULIUS_READ_LIMIT],
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
      // The attempt this task is on. Frozen once the task has SUCCEEDED,
      // which is what lets a reader use it to name an attempt's bodies.
      leaseGeneration: Number(row.lease_generation),
    }));
  }

  async evidenceForRun(runId: string, projectId: string): Promise<readonly JuliusEvidence[]> {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT e.*,r.mission_id FROM relay_wonderland.julius_evidence e
         JOIN relay_wonderland.julius_runs r ON r.run_id=e.run_id
        WHERE e.run_id=$1 AND r.project_id=$2 ORDER BY e.occurred_at,e.evidence_id LIMIT $3`,
      [runId, projectId, JULIUS_READ_LIMIT],
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

  async findingsForRun(runId: string, projectId: string): Promise<readonly JuliusReviewerFinding[]> {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT f.* FROM relay_wonderland.julius_reviewer_findings f
         JOIN relay_wonderland.julius_runs r ON r.run_id=f.run_id
        WHERE f.run_id=$1 AND r.project_id=$2 ORDER BY f.created_at,f.finding_id LIMIT $3`,
      [runId, projectId, JULIUS_READ_LIMIT],
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

  async criteriaForRun(runId: string, projectId: string): Promise<readonly JuliusAcceptanceCriterion[]> {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT c.criterion_id,c.description,c.required_evidence_types FROM relay_wonderland.julius_acceptance_criteria c
         JOIN relay_wonderland.julius_runs r ON r.run_id=c.run_id
        WHERE c.run_id=$1 AND r.project_id=$2 ORDER BY c.ordinal LIMIT $3`,
      [runId, projectId, JULIUS_READ_LIMIT],
    );
    return result.rows.map((row) => ({
      criterionId: String(row.criterion_id),
      description: String(row.description),
      requiredEvidenceTypes: parsed<JuliusEvidence['type'][]>(row.required_evidence_types, []),
    }));
  }

  async decisionsForRun(runId: string, projectId: string): Promise<readonly JuliusRecordedDecision[]> {
    const result = await this.pool.query<Record<string, unknown>>(
      // Newest-first under the read limit, reversed back to log order below:
      // completion reads each task's CURRENT decision as its last entry, so a
      // truncated read must drop the OLDEST (superseded) entries, never the
      // newest — oldest-first truncation would resurrect a stale ACCEPT as
      // current, failing open. Below the limit the two orderings are
      // identical.
      `SELECT d.task_id,d.action,d.reason_code,d.safe_summary,d.evidence_ids FROM relay_wonderland.julius_verification_decisions d
         JOIN relay_wonderland.julius_runs r ON r.run_id=d.run_id
        WHERE d.run_id=$1 AND r.project_id=$2 ORDER BY d.occurred_at DESC,d.decision_id DESC LIMIT $3`,
      [runId, projectId, JULIUS_READ_LIMIT],
    );
    return result.rows.reverse().map((row) => ({
      taskId: String(row.task_id),
      action: String(row.action) as JuliusVerificationDecision['action'],
      reasonCode: String(row.reason_code),
      evidenceIds: parsed<string[]>(row.evidence_ids, []),
      safeSummary: String(row.safe_summary),
    }));
  }

  async brainEntriesForRun(runId: string, projectId: string): Promise<readonly JuliusBrainEntry[]> {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT b.entry_id,b.entry_kind,b.safe_content,b.task_id FROM relay_wonderland.julius_brain_entries b
        WHERE b.run_id=$1 AND b.project_id=$2 ORDER BY b.revision LIMIT $3`,
      [runId, projectId, JULIUS_READ_LIMIT],
    );
    return result.rows.map((row) => ({
      entryId: String(row.entry_id),
      // The brain table's kinds and the context compiler's kinds are two
      // vocabularies for one idea; the ones that do not overlap are carried as
      // ARTIFACT rather than dropped, because an entry the compiler cannot
      // classify is still context a worker may need.
      kind: brainKindFromStored(String(row.entry_kind)),
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

  async repairRoundsFor(taskId: string, projectId: string): Promise<number> {
    const result = await this.pool.query<{ rounds: string }>(
      `SELECT COALESCE(max(c.round),0)::text AS rounds FROM relay_wonderland.julius_repair_cycles c
         JOIN relay_wonderland.julius_runs r ON r.run_id=c.run_id
        WHERE c.original_task_id=$1 AND r.project_id=$2`,
      [taskId, projectId],
    );
    return Number(result.rows[0]?.rounds ?? 0);
  }

  async activeTaskCount(runId: string, projectId: string): Promise<number> {
    const result = await this.pool.query<{ active: string }>(
      `SELECT count(*)::text AS active FROM relay_wonderland.julius_tasks t
         JOIN relay_wonderland.julius_runs r ON r.run_id=t.run_id
        WHERE t.run_id=$1 AND r.project_id=$2 AND t.state='ACTIVE'`,
      [runId, projectId],
    );
    return Number(result.rows[0]?.active ?? 0);
  }

  /**
   * THE BINDING A TASK WAS DISPATCHED UNDER, from its durable `task.claimed`
   * event. Filtered on the project as every read here is, and on the event
   * type, so a caller holding a task id from another tenant reads nothing.
   * The newest claim wins for the same reason the in-memory store's does: the
   * work was done against the binding current at the last dispatch.
   */
  async executedBindingFor(taskId: string, projectId: string): Promise<JuliusTaskContractBinding | null> {
    const result = await this.pool.query<{ payload: unknown }>(
      `SELECT e.payload FROM relay_wonderland.events e
        WHERE e.project_id=$2 AND e.event_type='julius.task.claimed' AND e.payload->>'taskId'=$1
        ORDER BY e.sequence DESC LIMIT 1`,
      [taskId, projectId],
    );
    const payload = parsed<{ facts?: Record<string, unknown> }>(result.rows[0]?.payload, {});
    const facts = payload.facts ?? {};
    return typeof facts.contractId === 'string' && typeof facts.contractTaskId === 'string'
      && typeof facts.contractRevision === 'number' && typeof facts.bindingDigest === 'string'
      ? { contractId: facts.contractId, taskId: facts.contractTaskId, contractRevision: facts.contractRevision, bindingDigest: facts.bindingDigest }
      : null;
  }
}

/**
 * The read direction now lives in `./julius-brain-kinds.ts` beside the write
 * direction it is the inverse of. It moved rather than being duplicated: two
 * copies of one mapping is exactly the drift this repository keeps finding, and
 * a pair can be tested as a pair against the migration's own CHECK list.
 */
