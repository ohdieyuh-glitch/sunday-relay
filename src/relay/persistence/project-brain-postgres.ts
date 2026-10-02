import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

import type { JuliusBrainEntry } from '../mission/julius/julius-runtime';
import {
  PROJECT_BRAIN_EVENT_SCHEMA_V1,
  PROJECT_BRAIN_LIVE_STATUSES,
  PROJECT_BRAIN_MUTATION_SCHEMA_V1,
  advanceProjectBrainCursor,
  authorizeProjectBrainMutation,
  encodeProjectBrainCursor,
  parseProjectBrainRef,
  projectBrainContentIdentity,
  projectBrainEventTypeForJulius,
  projectBrainMutationEventType,
  projectBrainRef,
  projectBrainRefusal,
  projectBrainRequestIdentity,
  projectBrainStreamId,
  type ProjectBrainActor,
  type ProjectBrainCapability,
  type ProjectBrainCursor,
  type ProjectBrainDeliverer,
  type ProjectBrainEventType,
  type ProjectBrainMutationCommand,
  type ProjectBrainProvenance,
  type ProjectBrainRecordDomain,
  type ProjectBrainRecordState,
  type ProjectBrainRefusal,
  type ProjectBrainScope,
  type ProjectBrainStatus,
} from '../mission/project-brain/project-brain';
import {
  buildProjectBrainDocument,
  type PbRecordRow,
  type PbSlotRow,
  type ProjectBrainDocument,
  type ProjectBrainRows,
} from '../mission/project-brain/project-brain-document';
import { projectBrainContextEntries } from '../mission/project-brain/project-brain-views';

/**
 * THE PROJECT BRAIN'S DURABLE STORE: JULIUS'S OWN DATABASE, READ AND WRITTEN AS ONE.
 *
 * READS take one REPEATABLE READ, READ ONLY snapshot, so a document and the feed
 * cursor it carries describe the same instant: everything in the document is at
 * or before the cursor, and everything after it arrives on the feed. No reader
 * here writes, and none of them opens a second connection mid-read.
 *
 * A WRITE IS ONE TRANSACTION, and it is answered only after COMMIT returns:
 *
 *   - the project's mutations are serialised by a transaction-scoped advisory
 *     lock, so the idempotency check, the version check and the stream sequence
 *     are race-free without SERIALIZABLE retries;
 *   - a replayed idempotency key with the same request is answered from the log,
 *     unchanged, with nothing written; the same key with a different request is a
 *     conflict, never a second write;
 *   - a revision or status move names the version it changes and is refused if
 *     that is no longer the current one -- no blind last-write-wins;
 *   - every reference a mutation names must exist IN THIS PROJECT, checked in the
 *     same transaction; a guessed id from another project reads exactly like one
 *     that does not exist;
 *   - the record, its version, its links, the mutation row and the event that
 *     announces it commit together or not at all.
 *
 * TRUTHFUL FAILURE. An error before COMMIT is `durable: false` (nothing was
 * stored). An error DURING COMMIT is `durable: 'unknown'` -- the client is told
 * the outcome is unknown and that retrying with the same idempotency key is safe,
 * because it is: the retry finds the mutation if it committed and applies it if
 * it did not.
 */

const ENTRY_KIND_SQL = `(event_type LIKE 'julius.%' OR event_type LIKE 'project_brain.%')`;

export interface ProjectBrainMutationResult {
  readonly schemaVersion: typeof PROJECT_BRAIN_MUTATION_SCHEMA_V1;
  readonly mutationId: string;
  readonly operation: ProjectBrainMutationCommand['operation'];
  readonly projectId: string;
  readonly runId: string | null;
  readonly recordRef: string | null;
  readonly version: number | null;
  readonly status: ProjectBrainStatus | null;
  readonly eventId: string;
  readonly eventType: ProjectBrainEventType;
  readonly streamId: string;
  readonly sequence: number;
  readonly occurredAt: string;
  readonly author: ProjectBrainActor;
  readonly deliverer: ProjectBrainDeliverer;
}

export type ProjectBrainMutationOutcome =
  | { readonly ok: true; readonly durable: true; readonly replayed: boolean; readonly result: ProjectBrainMutationResult }
  | (ProjectBrainRefusal & { readonly durable: false | 'unknown'; readonly details?: Readonly<Record<string, unknown>> });

export interface ProjectBrainFeedEvent {
  readonly eventId: string;
  readonly type: ProjectBrainEventType;
  readonly sourceType: string;
  readonly projectId: string;
  readonly runId: string | null;
  readonly streamId: string;
  readonly sequence: number;
  readonly occurredAt: string;
  /** Typed references to what changed. Never the content. */
  readonly refs: readonly string[];
  readonly actor: string | null;
  /** The cursor that resumes AFTER this event. */
  readonly cursor: string;
}

export interface ProjectBrainReadLimits {
  readonly missions: number; readonly entries: number; readonly rows: number; readonly events: number; readonly records: number;
}
export const PROJECT_BRAIN_READ_LIMITS: ProjectBrainReadLimits = { missions: 50, entries: 1000, rows: 500, events: 200, records: 1000 };

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
type Row = Record<string, unknown>;
const str = (value: unknown): string => (value === null || value === undefined ? '' : String(value));
const strOrNull = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));
const num = (value: unknown): number => Number(value);
const numOrNull = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));
const iso = (value: unknown): string => new Date(String(value)).toISOString();
const isoOrNull = (value: unknown): string | null => (value === null || value === undefined ? null : iso(value));
const jsonOf = <T>(value: unknown, fallback: T): T => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') { try { return JSON.parse(value) as T; } catch { return fallback; } }
  return value as T;
};
const strings = (value: unknown): string[] => {
  const parsed = jsonOf<unknown>(value, []);
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
};
const objectOf = (value: unknown): Record<string, unknown> => {
  const parsed = jsonOf<unknown>(value, {});
  return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
};
const actorOf = (kind: unknown, id: unknown): ProjectBrainActor => ({ kind: str(kind) as ProjectBrainActor['kind'], id: str(id) });
const delivererOf = (kind: unknown, id: unknown): ProjectBrainDeliverer => ({ kind: str(kind) as ProjectBrainDeliverer['kind'], id: str(id) });
const codeOf = (error: unknown): string | undefined =>
  error !== null && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : undefined;

const recordRowOf = (row: Row): PbRecordRow => ({
  recordId: str(row.record_id),
  runId: strOrNull(row.run_id),
  scope: str(row.scope) as ProjectBrainScope,
  domain: str(row.domain) as ProjectBrainRecordDomain,
  status: str(row.status) as ProjectBrainStatus,
  title: str(row.title),
  body: str(row.body),
  subjectRef: strOrNull(row.subject_ref),
  version: num(row.version),
  contentHash: str(row.content_hash),
  author: actorOf(row.author_kind, row.author_id),
  deliverer: delivererOf(row.deliverer_kind, row.deliverer_id),
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
});

/** Claim evidence refs ({kind,id}) as Project Brain refs. */
const claimRefs = (value: unknown): string[] => {
  const parsed = jsonOf<unknown>(value, []);
  if (!Array.isArray(parsed)) return [];
  const type = { EVIDENCE: 'evidence', DECISION: 'decision', FINDING: 'finding', RUN: 'mission', REVIEW: 'decision' } as const;
  return parsed.flatMap((ref) => {
    const record = ref !== null && typeof ref === 'object' ? ref as { kind?: unknown; id?: unknown } : {};
    const mapped = type[String(record.kind) as keyof typeof type];
    return mapped === undefined || typeof record.id !== 'string' ? [] : [projectBrainRef(mapped, record.id)];
  });
};

/** Payload keys a Julius or Project Brain event may name an object by. Content is never read. */
const REF_KEYS: ReadonlyArray<readonly [string, Parameters<typeof projectBrainRef>[0]]> = [
  ['findingId', 'finding'], ['evidenceId', 'evidence'], ['decisionId', 'decision'], ['repairId', 'repair'],
  ['approvalId', 'approval'], ['criterionId', 'criterion'], ['artifactId', 'artifact'], ['taskId', 'task'],
];

function feedRefs(payload: Record<string, unknown>, runId: string | null): string[] {
  const refs = new Set<string>();
  if (runId !== null) refs.add(projectBrainRef('mission', runId));
  for (const key of ['recordRef', 'fromRef', 'toRef', 'subjectRef']) {
    const value = payload[key];
    if (typeof value === 'string' && parseProjectBrainRef(value) !== null) refs.add(value);
  }
  const facts = objectOf(payload.facts);
  for (const [key, type] of REF_KEYS) {
    for (const source of [payload, facts]) {
      const value = source[key];
      if (typeof value === 'string' && value !== '') {
        refs.add(type === 'criterion' && runId !== null ? projectBrainRef('criterion', `${runId}/${value}`) : projectBrainRef(type, value));
      }
    }
  }
  return [...refs].slice(0, 16);
}

/**
 * A CHECKED-OUT CLIENT MUST NOT CRASH THE PROCESS WHEN ITS CONNECTION DIES.
 *
 * node-postgres emits `error` on a client whose backend is terminated; a pool only
 * listens while the client is idle. Unheard, that event is an uncaught exception
 * -- one database restart mid-write would take the whole bridge down instead of
 * answering `durable: false`. The failed query already rejects; this only keeps
 * the event from being fatal while the client is held.
 */
async function checkout(pool: Pool): Promise<{ client: PoolClient; release: (error?: Error) => void }> {
  const client = await pool.connect();
  const swallow = () => undefined;
  client.on('error', swallow);
  return {
    client,
    release: (error?: Error) => {
      client.off('error', swallow);
      client.release(error);
    },
  };
}

export class ProjectBrainPostgresStore {
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(private readonly pool: Pool, options: { readonly now?: () => Date; readonly newId?: () => string } = {}) {
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? randomUUID;
  }

  /* ------------------------------------------------------------ membership */

  /** The membership role a player holds in a project, or null. One primary-key read; both ids are parameters. */
  async membershipRole(input: { readonly projectId: string; readonly playerId: string }): Promise<string | null> {
    const result = await this.pool.query<{ role: string }>(
      'SELECT role FROM relay_wonderland.project_members WHERE project_id=$1 AND player_id=$2', [input.projectId, input.playerId]);
    return result.rows[0]?.role ?? null;
  }

  /* ----------------------------------------------------------------- reads */

  /**
   * EVERYTHING DURABLE ABOUT A PROJECT, in one snapshot. `runId` narrows to one
   * mission: that mission's rows plus the project-wide records.
   */
  async readRows(input: {
    readonly projectId: string;
    readonly runId?: string | null;
    readonly limits?: ProjectBrainReadLimits;
    /** Served-model topology per role for the newest missions; supplied by the composition that owns the Julius API. */
    readonly slots?: (runIds: readonly string[]) => Promise<readonly PbSlotRow[]>;
  }): Promise<ProjectBrainRows | null> {
    const limits = input.limits ?? PROJECT_BRAIN_READ_LIMITS;
    const runId = input.runId ?? null;
    const { client, release } = await checkout(this.pool);
    let broken: Error | undefined;
    try {
      await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const exists = await client.query('SELECT 1 FROM relay_wonderland.projects WHERE project_id=$1', [input.projectId]);
      if (exists.rowCount === 0) { await client.query('ROLLBACK'); return null; }
      if (runId !== null) {
        const owned = await client.query('SELECT 1 FROM relay_wonderland.julius_runs WHERE run_id=$1 AND project_id=$2', [runId, input.projectId]);
        if (owned.rowCount === 0) { await client.query('ROLLBACK'); return null; }
      }
      const p = input.projectId;
      const truncated: string[] = [];
      const q = async (label: string, sql: string, values: readonly unknown[], limit: number): Promise<Row[]> => {
        const result = await client.query<Row>(`${sql} LIMIT ${Math.trunc(limit) + 1}`, [...values]);
        if (result.rows.length > limit) { truncated.push(label); return result.rows.slice(0, limit); }
        return result.rows;
      };
      // Run filter: every Julius table is joined to julius_runs on project, and optionally narrowed to one run.
      const runFilter = runId === null ? '' : ' AND r.run_id=$2';
      const values = runId === null ? [p] : [p, runId];

      const missions = await q('missions', `SELECT r.run_id,r.mission_id,r.state,r.created_at,r.updated_at,r.card_revision,r.mission_contract_revision,r.project_brain_revision,
          r.lifecycle_reason,r.lifecycle_actor,r.lifecycle_at,mc.snapshot
        FROM relay_wonderland.julius_runs r LEFT JOIN relay_wonderland.mission_contracts mc ON mc.mission_id=r.mission_id AND mc.project_id=r.project_id
        WHERE r.project_id=$1${runFilter} ORDER BY r.created_at DESC, r.run_id`, values, limits.missions);
      const entries = await q('entries', `SELECT b.entry_id,b.run_id,b.task_id,b.worker_id,b.entry_kind,b.safe_content,b.evidence_ids,b.revision,b.created_at
        FROM relay_wonderland.julius_brain_entries b JOIN relay_wonderland.julius_runs r ON r.run_id=b.run_id AND r.project_id=b.project_id
        WHERE b.project_id=$1${runFilter} ORDER BY b.created_at DESC, b.entry_id`, values, limits.entries);
      const criteria = await q('criteria', `SELECT c.run_id,c.criterion_id,c.description,c.ordinal,
          COALESCE((SELECT jsonb_agg(ce.evidence_id ORDER BY ce.evidence_id) FROM relay_wonderland.julius_criterion_evidence ce WHERE ce.run_id=c.run_id AND ce.criterion_id=c.criterion_id),'[]') AS linked,
          COALESCE((SELECT jsonb_agg(ce.evidence_id ORDER BY ce.evidence_id) FROM relay_wonderland.julius_criterion_evidence ce JOIN relay_wonderland.julius_evidence e ON e.evidence_id=ce.evidence_id
             WHERE ce.run_id=c.run_id AND ce.criterion_id=c.criterion_id AND e.status='PASSED'),'[]') AS passed
        FROM relay_wonderland.julius_acceptance_criteria c JOIN relay_wonderland.julius_runs r ON r.run_id=c.run_id
        WHERE r.project_id=$1${runFilter} ORDER BY c.run_id, c.ordinal`, values, limits.rows);
      const findings = await q('findings', `SELECT f.* FROM relay_wonderland.julius_reviewer_findings f JOIN relay_wonderland.julius_runs r ON r.run_id=f.run_id
        WHERE r.project_id=$1${runFilter} ORDER BY f.updated_at DESC, f.finding_id`, values, limits.rows);
      const evidence = await q('evidence', `SELECT e.evidence_id,e.run_id,e.task_id,e.worker_id,e.evidence_type,e.status,e.safe_summary,e.integrity_hash,e.occurred_at,t.role
        FROM relay_wonderland.julius_evidence e JOIN relay_wonderland.julius_runs r ON r.run_id=e.run_id LEFT JOIN relay_wonderland.julius_tasks t ON t.task_id=e.task_id
        WHERE r.project_id=$1${runFilter} ORDER BY e.occurred_at DESC, e.evidence_id`, values, limits.rows);
      const artifacts = await q('artifacts', `SELECT a.artifact_id,a.run_id,a.task_id,a.role,a.kind,a.byte_size,a.content_hash,a.occurred_at
        FROM relay_wonderland.julius_work_artifacts a JOIN relay_wonderland.julius_runs r ON r.run_id=a.run_id
        WHERE a.project_id=$1${runFilter} ORDER BY a.occurred_at DESC, a.artifact_id`, values, limits.rows);
      const decisions = await q('decisions', `SELECT d.* FROM relay_wonderland.julius_verification_decisions d JOIN relay_wonderland.julius_runs r ON r.run_id=d.run_id
        WHERE r.project_id=$1${runFilter} ORDER BY d.occurred_at DESC, d.decision_id`, values, limits.rows);
      const repairs = await q('repairs', `SELECT c.* FROM relay_wonderland.julius_repair_cycles c JOIN relay_wonderland.julius_runs r ON r.run_id=c.run_id
        WHERE r.project_id=$1${runFilter} ORDER BY c.updated_at DESC, c.repair_id`, values, limits.rows);
      const approvals = await q('approvals', `SELECT a.* FROM relay_wonderland.julius_approvals a JOIN relay_wonderland.julius_runs r ON r.run_id=a.run_id
        WHERE a.project_id=$1${runFilter} ORDER BY a.requested_at DESC, a.approval_id`, values, limits.rows);
      const contracts = await q('contracts', `SELECT c.contract_id,c.contract_revision,c.run_id,c.task_id,c.state,c.locked_at,c.locked_by_evaluator_id,c.created_at
        FROM relay_wonderland.julius_task_contracts c JOIN relay_wonderland.julius_runs r ON r.run_id=c.run_id
        WHERE c.project_id=$1${runFilter} ORDER BY c.created_at DESC, c.contract_id, c.contract_revision`, values, limits.rows);
      const transitions = await q('transitions', `SELECT t.* FROM relay_wonderland.julius_transitions t JOIN relay_wonderland.julius_runs r ON r.run_id=t.run_id
        WHERE r.project_id=$1${runFilter} ORDER BY t.occurred_at DESC, t.sequence DESC`, values, limits.rows);
      const trajectory = await q('trajectory', `SELECT j.trajectory_event_id,j.run_id,j.event_kind,j.task_id,j.worker_id,j.provider_id,j.outcome,j.duration_ms,j.input_tokens,j.output_tokens,j.occurred_at
        FROM relay_wonderland.julius_trajectory_events j JOIN relay_wonderland.julius_runs r ON r.run_id=j.run_id
        WHERE j.project_id=$1${runFilter} ORDER BY j.occurred_at DESC, j.trajectory_event_id`, values, limits.rows);
      const claims = await q('claims', `SELECT DISTINCT ON (s.claim_id) s.* FROM relay_wonderland.julius_claim_standings s JOIN relay_wonderland.julius_runs r ON r.run_id=s.run_id
        WHERE s.project_id=$1${runFilter} ORDER BY s.claim_id, s.standing_revision DESC`, values, limits.rows);
      const contexts = await q('contexts', `SELECT x.context_id,x.run_id,x.task_id,x.worker_role,x.compiler_version,x.character_count,x.truncated,x.redaction_count,
          jsonb_array_length(x.source_entry_ids) AS source_count,x.created_at
        FROM relay_wonderland.julius_context_snapshots x JOIN relay_wonderland.julius_runs r ON r.run_id=x.run_id
        WHERE r.project_id=$1${runFilter} ORDER BY x.created_at DESC, x.context_id`, values, limits.rows);
      const tasks = await q('tasks', `SELECT t.task_id,t.run_id,t.role,t.task_type,t.state,t.updated_at FROM relay_wonderland.julius_tasks t JOIN relay_wonderland.julius_runs r ON r.run_id=t.run_id
        WHERE r.project_id=$1${runFilter} ORDER BY t.updated_at DESC, t.task_id`, values, limits.entries);
      const subagents = await q('subagents', `SELECT s.request_id,s.run_id,s.capability,s.state,s.depth,s.updated_at FROM relay_wonderland.julius_subagents s JOIN relay_wonderland.julius_runs r ON r.run_id=s.run_id
        WHERE s.project_id=$1${runFilter} ORDER BY s.updated_at DESC, s.request_id`, values, limits.rows);
      const recordFilter = runId === null ? '' : ` AND (scope='PROJECT' OR run_id=$2)`;
      const records = await q('records', `SELECT * FROM relay_wonderland.project_brain_records WHERE project_id=$1${recordFilter}
        ORDER BY updated_at DESC, record_id`, values, limits.records);
      const links = await q('links', `SELECT link_id,from_ref,relation,to_ref,created_at FROM relay_wonderland.project_brain_links WHERE project_id=$1
        ORDER BY created_at DESC, link_id`, [p], limits.records);
      const mutations = await q('mutations', `SELECT mutation_id,operation,record_id,resulting_version,run_id,author_kind,author_id,deliverer_kind,deliverer_id,event_id,occurred_at
        FROM relay_wonderland.project_brain_mutations WHERE project_id=$1${runId === null ? '' : ' AND (run_id IS NULL OR run_id=$2)'}
        ORDER BY occurred_at DESC, mutation_id`, values, limits.rows);
      const events = await q('events', `SELECT event_id,stream_id,sequence,event_type,payload->>'runId' AS run_id,payload->>'taskId' AS task_id,payload->>'workerId' AS worker_id,occurred_at
        FROM relay_wonderland.events WHERE project_id=$1 AND visibility='PROJECT' AND ${ENTRY_KIND_SQL}${runId === null ? '' : ` AND (stream_id=$2 OR payload->>'runId'=$2 OR payload->>'runId' IS NULL)`}
        ORDER BY occurred_at DESC, stream_id, sequence DESC`, values, limits.events);
      const revision = await client.query<{ revision: string }>(`SELECT
          (SELECT count(*) FROM relay_wonderland.julius_brain_entries b WHERE b.project_id=$1${runId === null ? '' : ' AND b.run_id=$2'})
        + (SELECT COALESCE(sum(version),0) FROM relay_wonderland.project_brain_records WHERE project_id=$1${recordFilter}) AS revision`, values);
      const cursor = await this.headWithin(client, p);
      await client.query('COMMIT');

      const runIds = missions.slice(0, 3).map((row) => str(row.run_id));
      const slots = input.slots === undefined || runIds.length === 0 ? [] : await input.slots(runIds);
      return {
        projectId: p,
        observedAt: this.now().toISOString(),
        cursor,
        runId,
        missions: missions.map((row) => {
          const snapshot = objectOf(row.snapshot);
          const scope = objectOf(snapshot.scope);
          const limitsOf = objectOf(snapshot.limits);
          const workers = Array.isArray(snapshot.workers) ? snapshot.workers as unknown[] : [];
          return {
            runId: str(row.run_id), missionId: str(row.mission_id), state: str(row.state),
            objective: typeof snapshot.objective === 'string' ? snapshot.objective : null,
            createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), cardRevision: str(row.card_revision),
            contractRevision: num(row.mission_contract_revision), brainRevision: num(row.project_brain_revision),
            lifecycleReason: strOrNull(row.lifecycle_reason), lifecycleActor: strOrNull(row.lifecycle_actor), lifecycleAt: isoOrNull(row.lifecycle_at),
            policy: {
              executionMode: typeof snapshot.executionMode === 'string' ? snapshot.executionMode : null,
              reviewRequirement: typeof snapshot.reviewRequirement === 'string' ? snapshot.reviewRequirement : null,
              completionRule: typeof snapshot.completionRule === 'string' ? snapshot.completionRule : null,
              limits: Object.keys(limitsOf).length === 0 ? null : Object.fromEntries(Object.entries(limitsOf)
                .filter(([, value]) => value === null || typeof value === 'number')) as Record<string, number | null>,
              requestedPermissions: strings(snapshot.requestedPermissions),
              systemsInScope: strings(scope.systemsInScope),
              systemsOutOfScope: strings(scope.systemsOutOfScope),
              workerRoles: workers.flatMap((worker) => (worker !== null && typeof worker === 'object' && typeof (worker as { role?: unknown }).role === 'string'
                ? [(worker as { role: string }).role] : [])),
            },
          };
        }),
        entries: entries.map((row) => ({
          entryId: str(row.entry_id), runId: str(row.run_id), taskId: strOrNull(row.task_id), workerId: str(row.worker_id), kind: str(row.entry_kind),
          text: str(row.safe_content), evidenceIds: strings(row.evidence_ids), revision: num(row.revision), createdAt: iso(row.created_at),
        })),
        criteria: criteria.map((row) => ({
          runId: str(row.run_id), criterionId: str(row.criterion_id), description: str(row.description), ordinal: num(row.ordinal),
          passedEvidenceIds: strings(row.passed), linkedEvidenceIds: strings(row.linked),
        })),
        findings: findings.map((row) => ({
          findingId: str(row.finding_id), runId: str(row.run_id), taskId: str(row.task_id), reviewerWorkerId: str(row.reviewer_worker_id),
          severity: str(row.severity), category: str(row.category), claim: str(row.claim), criterionId: strOrNull(row.criterion_id),
          evidenceIds: strings(row.evidence_ids), blocking: row.blocking === true, status: str(row.status), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
        })),
        evidence: evidence.map((row) => ({
          evidenceId: str(row.evidence_id), runId: str(row.run_id), taskId: str(row.task_id), workerId: str(row.worker_id), evidenceType: str(row.evidence_type),
          status: str(row.status), summary: str(row.safe_summary), integrityHash: strOrNull(row.integrity_hash), occurredAt: iso(row.occurred_at), role: strOrNull(row.role),
        })),
        artifacts: artifacts.map((row) => ({
          artifactId: str(row.artifact_id), runId: str(row.run_id), taskId: str(row.task_id), role: str(row.role), kind: str(row.kind),
          byteSize: num(row.byte_size), contentHash: str(row.content_hash), occurredAt: iso(row.occurred_at),
        })),
        decisions: decisions.map((row) => ({
          decisionId: str(row.decision_id), runId: str(row.run_id), taskId: str(row.task_id), action: str(row.action), reasonCode: str(row.reason_code),
          summary: str(row.safe_summary), evidenceIds: strings(row.evidence_ids), policyRevision: str(row.policy_revision), occurredAt: iso(row.occurred_at),
        })),
        repairs: repairs.map((row) => ({
          repairId: str(row.repair_id), runId: str(row.run_id), originalTaskId: str(row.original_task_id), repairTaskId: str(row.repair_task_id),
          round: num(row.round), findingIds: strings(row.finding_ids), evidenceIds: strings(row.evidence_ids), state: str(row.state),
          createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
        })),
        approvals: approvals.map((row) => ({
          approvalId: str(row.approval_id), runId: str(row.run_id), taskId: strOrNull(row.task_id), operation: str(row.operation),
          policyRevision: str(row.policy_revision), reasonCode: str(row.reason_code), rationale: str(row.safe_rationale), state: str(row.state),
          requestedAt: iso(row.requested_at), decidedAt: isoOrNull(row.decided_at), decidedBy: strOrNull(row.decided_by),
        })),
        contracts: contracts.map((row) => ({
          contractId: str(row.contract_id), revision: num(row.contract_revision), runId: str(row.run_id), taskId: str(row.task_id), state: str(row.state),
          lockedAt: isoOrNull(row.locked_at), lockedBy: strOrNull(row.locked_by_evaluator_id), createdAt: iso(row.created_at),
        })),
        transitions: transitions.map((row) => ({
          transitionId: str(row.transition_id), runId: str(row.run_id), fromState: str(row.from_state), toState: str(row.to_state),
          reasonCode: str(row.reason_code), summary: str(row.safe_summary), evidenceIds: strings(row.evidence_ids), occurredAt: iso(row.occurred_at), sequence: num(row.sequence),
        })),
        trajectory: trajectory.map((row) => ({
          id: str(row.trajectory_event_id), runId: str(row.run_id), kind: str(row.event_kind), taskId: strOrNull(row.task_id), workerId: strOrNull(row.worker_id),
          providerId: strOrNull(row.provider_id), outcome: strOrNull(row.outcome), durationMs: numOrNull(row.duration_ms),
          inputTokens: numOrNull(row.input_tokens), outputTokens: numOrNull(row.output_tokens), occurredAt: iso(row.occurred_at),
        })),
        claims: claims.map((row) => ({
          claimId: str(row.claim_id), standingRevision: num(row.standing_revision), runId: str(row.run_id), entryId: str(row.entry_id),
          provenance: str(row.provenance), trust: str(row.trust), assertedBy: str(row.asserted_by), assertedAt: iso(row.asserted_at),
          evidenceRefs: claimRefs(row.evidence), reason: str(row.reason),
        })),
        contexts: contexts.map((row) => ({
          contextId: str(row.context_id), runId: str(row.run_id), taskId: str(row.task_id), workerRole: str(row.worker_role),
          compilerVersion: str(row.compiler_version), characterCount: num(row.character_count), truncated: row.truncated === true,
          redactionCount: num(row.redaction_count), sourceEntryCount: num(row.source_count), createdAt: iso(row.created_at),
        })),
        tasks: tasks.map((row) => ({
          taskId: str(row.task_id), runId: str(row.run_id), role: str(row.role), taskType: str(row.task_type), state: str(row.state), updatedAt: iso(row.updated_at),
        })),
        subagents: subagents.map((row) => ({
          requestId: str(row.request_id), runId: str(row.run_id), capability: str(row.capability), state: str(row.state), depth: num(row.depth), updatedAt: iso(row.updated_at),
        })),
        records: records.map(recordRowOf),
        links: links.map((row) => ({ linkId: str(row.link_id), fromRef: str(row.from_ref), relation: str(row.relation), toRef: str(row.to_ref), createdAt: iso(row.created_at) })),
        mutations: mutations.map((row) => ({
          mutationId: str(row.mutation_id), operation: str(row.operation), recordId: strOrNull(row.record_id), resultingVersion: numOrNull(row.resulting_version),
          runId: strOrNull(row.run_id), author: actorOf(row.author_kind, row.author_id), deliverer: delivererOf(row.deliverer_kind, row.deliverer_id),
          eventId: str(row.event_id), occurredAt: iso(row.occurred_at),
        })),
        events: events.map((row) => ({
          eventId: str(row.event_id), streamId: str(row.stream_id), sequence: num(row.sequence), eventType: str(row.event_type),
          runId: strOrNull(row.run_id), taskId: strOrNull(row.task_id), workerId: strOrNull(row.worker_id), occurredAt: iso(row.occurred_at),
        })),
        slots,
        truncated,
        revision: num(revision.rows[0]?.revision ?? 0),
      };
    } catch (error) {
      broken = error instanceof Error ? error : new Error(String(error));
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      release(broken);
    }
  }

  async readDocument(input: Parameters<ProjectBrainPostgresStore['readRows']>[0]): Promise<ProjectBrainDocument | null> {
    const rows = await this.readRows(input);
    return rows === null ? null : buildProjectBrainDocument(rows);
  }

  /**
   * WHAT JULIUS READS DURING A MISSION: the project's live statements plus this
   * run's own. Scoped by the query (project AND (project-wide OR this run)) before
   * anything else looks at them.
   */
  async contextEntriesForRun(runId: string, projectId: string): Promise<readonly JuliusBrainEntry[]> {
    const result = await this.pool.query<Row>(
      `SELECT * FROM relay_wonderland.project_brain_records
        WHERE project_id=$1 AND (scope='PROJECT' OR run_id=$2) AND status = ANY($3::text[]) AND domain<>'SCRATCHPAD'
        ORDER BY updated_at DESC, record_id LIMIT 200`,
      [projectId, runId, [...PROJECT_BRAIN_LIVE_STATUSES]],
    );
    return projectBrainContextEntries(result.rows.map(recordRowOf), runId);
  }

  /* ------------------------------------------------------------------ feed */

  private async headWithin(client: PoolClient | Pool, projectId: string): Promise<ProjectBrainCursor> {
    const result = await client.query<{ stream_id: string; head: string }>(
      `SELECT stream_id, max(sequence) AS head FROM relay_wonderland.events
        WHERE project_id=$1 AND visibility='PROJECT' AND ${ENTRY_KIND_SQL} GROUP BY stream_id`, [projectId]);
    const cursor: Record<string, number> = {};
    for (const row of result.rows) cursor[row.stream_id] = Number(row.head);
    return cursor;
  }

  /** The current head of a project's feed. */
  async head(projectId: string): Promise<ProjectBrainCursor> {
    return this.headWithin(this.pool, projectId);
  }

  /**
   * EVERY DURABLE EVENT AFTER A CURSOR, exactly once. Within a stream, events are
   * returned in sequence order and the cursor only advances over what was
   * returned, so a page boundary never skips one.
   */
  async eventsAfter(input: { readonly projectId: string; readonly cursor: ProjectBrainCursor; readonly limit?: number; readonly runId?: string | null }): Promise<{
    readonly events: readonly ProjectBrainFeedEvent[]; readonly cursor: ProjectBrainCursor;
  }> {
    const limit = Math.max(1, Math.min(input.limit ?? 200, 500));
    const result = await this.pool.query<Row>(
      `SELECT event_id,stream_id,sequence,event_type,payload,occurred_at FROM relay_wonderland.events
        WHERE project_id=$1 AND visibility='PROJECT' AND ${ENTRY_KIND_SQL}
          AND sequence > COALESCE(($2::jsonb ->> stream_id)::bigint, 0)
        ORDER BY stream_id, sequence LIMIT $3`,
      [input.projectId, JSON.stringify(input.cursor), limit],
    );
    let cursor = input.cursor;
    const events: ProjectBrainFeedEvent[] = [];
    for (const row of result.rows) {
      const streamId = str(row.stream_id);
      const sequence = num(row.sequence);
      cursor = advanceProjectBrainCursor(cursor, streamId, sequence);
      const payload = objectOf(row.payload);
      const sourceType = str(row.event_type);
      const runId = typeof payload.runId === 'string' ? payload.runId : null;
      if (input.runId !== undefined && input.runId !== null && runId !== null && runId !== input.runId) continue;
      const actorObject = objectOf(payload.author);
      events.push({
        eventId: str(row.event_id),
        type: sourceType.startsWith('project_brain.') ? sourceType as ProjectBrainEventType : projectBrainEventTypeForJulius(sourceType),
        sourceType,
        projectId: input.projectId,
        runId,
        streamId,
        sequence,
        occurredAt: iso(row.occurred_at),
        refs: feedRefs(payload, runId),
        actor: typeof actorObject.kind === 'string' ? `${actorObject.kind}:${str(actorObject.id)}`
          : typeof payload.workerId === 'string' ? payload.workerId : null,
        cursor: encodeProjectBrainCursor(cursor),
      });
    }
    return { events, cursor };
  }

  /* ------------------------------------------------------------- mutations */

  private async resolveRef(client: PoolClient, projectId: string, ref: string): Promise<boolean> {
    const parsed = parseProjectBrainRef(ref);
    if (parsed === null) return false;
    const { type, id } = parsed;
    const one = async (sql: string, values: readonly unknown[]) => ((await client.query(sql, [...values])).rowCount ?? 0) > 0;
    const viaRun = (table: string, column: string) => one(
      `SELECT 1 FROM relay_wonderland.${table} x JOIN relay_wonderland.julius_runs r ON r.run_id=x.run_id WHERE x.${column}=$1 AND r.project_id=$2`, [id, projectId]);
    switch (type) {
      case 'pbr': return one('SELECT 1 FROM relay_wonderland.project_brain_records WHERE record_id=$1 AND project_id=$2', [ref, projectId]);
      case 'mission': return one('SELECT 1 FROM relay_wonderland.julius_runs WHERE run_id=$1 AND project_id=$2', [id, projectId]);
      case 'entry': return one('SELECT 1 FROM relay_wonderland.julius_brain_entries WHERE entry_id=$1 AND project_id=$2', [id, projectId]);
      case 'claim': return one('SELECT 1 FROM relay_wonderland.julius_claim_standings WHERE claim_id=$1 AND project_id=$2', [id, projectId]);
      case 'finding': return viaRun('julius_reviewer_findings', 'finding_id');
      case 'evidence': return viaRun('julius_evidence', 'evidence_id');
      case 'decision': return viaRun('julius_verification_decisions', 'decision_id');
      case 'repair': return viaRun('julius_repair_cycles', 'repair_id');
      case 'transition': return viaRun('julius_transitions', 'transition_id');
      case 'task': return viaRun('julius_tasks', 'task_id');
      case 'approval': return one('SELECT 1 FROM relay_wonderland.julius_approvals WHERE approval_id=$1 AND project_id=$2', [id, projectId]);
      case 'artifact': return one('SELECT 1 FROM relay_wonderland.julius_work_artifacts WHERE artifact_id=$1 AND project_id=$2', [id, projectId]);
      case 'trajectory': return one('SELECT 1 FROM relay_wonderland.julius_trajectory_events WHERE trajectory_event_id=$1 AND project_id=$2', [id, projectId]);
      case 'event': return one('SELECT 1 FROM relay_wonderland.events WHERE event_id=$1 AND project_id=$2', [id, projectId]);
      case 'criterion': {
        const slash = id.indexOf('/');
        if (slash <= 0) return false;
        return one(`SELECT 1 FROM relay_wonderland.julius_acceptance_criteria c JOIN relay_wonderland.julius_runs r ON r.run_id=c.run_id
          WHERE c.run_id=$1 AND c.criterion_id=$2 AND r.project_id=$3`, [id.slice(0, slash), id.slice(slash + 1), projectId]);
      }
      case 'contract': {
        const at = id.lastIndexOf('@');
        const revision = Number(id.slice(at + 1));
        if (at <= 0 || !Number.isSafeInteger(revision)) return false;
        return one('SELECT 1 FROM relay_wonderland.julius_task_contracts WHERE contract_id=$1 AND contract_revision=$2 AND project_id=$3', [id.slice(0, at), revision, projectId]);
      }
      default: return false;
    }
  }

  /**
   * APPLY ONE MUTATION, or say exactly why not. `capabilities` come from the
   * caller's membership row and `provenance` from its authenticated channel --
   * neither is read from the request.
   */
  async mutate(input: {
    readonly projectId: string;
    readonly provenance: ProjectBrainProvenance;
    readonly capabilities: readonly ProjectBrainCapability[];
    readonly command: ProjectBrainMutationCommand;
  }): Promise<ProjectBrainMutationOutcome> {
    const { projectId, provenance, command } = input;
    const refuse = (refusal: ProjectBrainRefusal, details?: Record<string, unknown>): ProjectBrainMutationOutcome =>
      ({ ...refusal, durable: false, ...(details === undefined ? {} : { details }) });
    let client: PoolClient;
    let release: (error?: Error) => void;
    try {
      ({ client, release } = await checkout(this.pool));
    } catch {
      return refuse(projectBrainRefusal(503, 'project_brain_unavailable', 'The Project Brain database could not be reached. Nothing was saved.'));
    }
    let phase: 'open' | 'commit' | 'done' = 'open';
    let broken: Error | undefined;
    const abort = async (outcome: ProjectBrainMutationOutcome): Promise<ProjectBrainMutationOutcome> => {
      await client.query('ROLLBACK').catch(() => undefined);
      phase = 'done';
      return outcome;
    };
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`project_brain:${projectId}`]);
      const project = await client.query('SELECT 1 FROM relay_wonderland.projects WHERE project_id=$1', [projectId]);
      if (project.rowCount === 0) return abort(refuse(projectBrainRefusal(404, 'project_not_found', 'No such project.')));

      const requestHash = sha256(projectBrainRequestIdentity(projectId, provenance, command));
      const prior = await client.query<{ request_hash: string; result: unknown }>(
        'SELECT request_hash,result FROM relay_wonderland.project_brain_mutations WHERE project_id=$1 AND idempotency_key=$2',
        [projectId, command.idempotencyKey]);
      if (prior.rows[0] !== undefined) {
        if (prior.rows[0].request_hash !== requestHash) {
          return abort(refuse(projectBrainRefusal(409, 'idempotency_conflict',
            'That idempotency key was already used for a different change. Nothing was saved; use a new key for a new change.')));
        }
        await client.query('ROLLBACK');
        phase = 'done';
        return { ok: true, durable: true, replayed: true, result: jsonOf<ProjectBrainMutationResult>(prior.rows[0].result, {} as ProjectBrainMutationResult) };
      }

      let runId: string | null = null;
      let stored: ProjectBrainRecordState & { title: string; body: string; subjectRef: string | null; runId: string | null; scope: ProjectBrainScope } | null = null;
      if (command.operation === 'CREATE' && command.runId !== null) {
        const owned = await client.query('SELECT 1 FROM relay_wonderland.julius_runs WHERE run_id=$1 AND project_id=$2', [command.runId, projectId]);
        if (owned.rowCount === 0) return abort(refuse(projectBrainRefusal(404, 'run_not_found', 'No such mission in this project.')));
        runId = command.runId;
      }
      if (command.operation === 'REVISE' || command.operation === 'SET_STATUS') {
        const found = await client.query<Row>(
          'SELECT * FROM relay_wonderland.project_brain_records WHERE record_id=$1 AND project_id=$2 FOR UPDATE', [command.recordId, projectId]);
        const row = found.rows[0];
        if (row === undefined) return abort(refuse(projectBrainRefusal(404, 'record_not_found', 'No such record in this project.')));
        const record = recordRowOf(row);
        stored = { recordId: record.recordId, projectId, domain: record.domain, status: record.status, version: record.version, author: record.author,
          title: record.title, body: record.body, subjectRef: record.subjectRef, runId: record.runId, scope: record.scope };
        runId = record.runId;
        if (record.version !== command.expectedVersion) {
          return abort(refuse(projectBrainRefusal(409, 'version_conflict',
            `The record is at version ${record.version}, not ${command.expectedVersion}. Read it again and decide; nothing was overwritten.`),
          { currentVersion: record.version }));
        }
      }

      const authorized = authorizeProjectBrainMutation({ provenance, capabilities: input.capabilities, command, record: stored });
      if (!authorized.ok) return abort(refuse(authorized));

      const refs = command.operation === 'CREATE'
        ? [...(command.subjectRef === null ? [] : [command.subjectRef]), ...command.links.map((link) => link.toRef)]
        : command.operation === 'LINK' ? [command.fromRef, command.toRef] : [];
      for (const ref of refs) {
        if (!(await this.resolveRef(client, projectId, ref))) {
          return abort(refuse(projectBrainRefusal(404, 'ref_not_found', `${ref} does not name anything in this project.`)));
        }
      }
      if (command.operation === 'LINK') {
        const existing = await client.query('SELECT 1 FROM relay_wonderland.project_brain_links WHERE project_id=$1 AND from_ref=$2 AND relation=$3 AND to_ref=$4',
          [projectId, command.fromRef, command.relation, command.toRef]);
        if ((existing.rowCount ?? 0) > 0) return abort(refuse(projectBrainRefusal(409, 'link_exists', 'That link is already recorded.')));
      }

      const occurredAt = this.now().toISOString();
      const mutationId = `pbm:${this.newId()}`;
      const eventId = `project-brain:${this.newId()}`;
      const streamId = projectBrainStreamId(projectId);
      const eventType = projectBrainMutationEventType(command.operation);
      const allocated = await client.query<{ sequence: string }>(
        `INSERT INTO relay_wonderland.stream_sequences(stream_id,next_sequence) VALUES($1,2)
         ON CONFLICT(stream_id) DO UPDATE SET next_sequence=relay_wonderland.stream_sequences.next_sequence+1 RETURNING next_sequence-1 AS sequence`, [streamId]);
      const sequence = Number(allocated.rows[0]?.sequence);

      let recordId: string | null = null;
      let version: number | null = null;
      let status: ProjectBrainStatus | null = null;
      let title = '';
      let body = '';
      let subjectRef: string | null = null;
      if (command.operation === 'CREATE') {
        recordId = `pbr:${this.newId()}`;
        version = 1;
        status = authorized.nextStatus;
        title = command.title;
        body = command.body;
        subjectRef = command.subjectRef;
      } else if (stored !== null) {
        recordId = stored.recordId;
        version = stored.version + 1;
        status = command.operation === 'SET_STATUS' ? command.status : stored.status;
        title = command.operation === 'REVISE' && command.title !== null ? command.title : stored.title;
        body = command.operation === 'REVISE' && command.body !== null ? command.body : stored.body;
        subjectRef = stored.subjectRef;
      }

      const result: ProjectBrainMutationResult = {
        schemaVersion: PROJECT_BRAIN_MUTATION_SCHEMA_V1, mutationId, operation: command.operation, projectId, runId,
        recordRef: recordId, version, status, eventId, eventType, streamId, sequence, occurredAt,
        author: provenance.author, deliverer: provenance.deliverer,
      };
      await client.query(
        `INSERT INTO relay_wonderland.project_brain_mutations(mutation_id,project_id,idempotency_key,request_hash,operation,record_id,resulting_version,run_id,
           author_kind,author_id,deliverer_kind,deliverer_id,event_id,result,occurred_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15)`,
        [mutationId, projectId, command.idempotencyKey, requestHash, command.operation, recordId, version, runId,
          provenance.author.kind, provenance.author.id, provenance.deliverer.kind, provenance.deliverer.id, eventId, JSON.stringify(result), occurredAt]);

      if (recordId !== null && version !== null && status !== null) {
        const domain = command.operation === 'CREATE' ? command.domain : stored!.domain;
        const contentHash = sha256(projectBrainContentIdentity({ domain, title, body, subjectRef, status }));
        if (command.operation === 'CREATE') {
          await client.query(
            `INSERT INTO relay_wonderland.project_brain_records(record_id,project_id,run_id,scope,domain,status,title,body,subject_ref,version,content_hash,
               author_kind,author_id,deliverer_kind,deliverer_id,created_at,updated_at,last_mutation_id)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16,$17)`,
            [recordId, projectId, runId, command.scope, domain, status, title, body, subjectRef, version, contentHash,
              provenance.author.kind, provenance.author.id, provenance.deliverer.kind, provenance.deliverer.id, occurredAt, mutationId]);
        } else {
          const updated = await client.query(
            `UPDATE relay_wonderland.project_brain_records SET status=$3,title=$4,body=$5,version=$6,content_hash=$7,deliverer_kind=$8,deliverer_id=$9,updated_at=$10,last_mutation_id=$11
              WHERE record_id=$1 AND project_id=$2 AND version=$12`,
            [recordId, projectId, status, title, body, version, contentHash, provenance.deliverer.kind, provenance.deliverer.id, occurredAt, mutationId, version - 1]);
          if (updated.rowCount !== 1) return abort(refuse(projectBrainRefusal(409, 'version_conflict', 'The record changed while this change was applied; nothing was overwritten.')));
        }
        await client.query(
          `INSERT INTO relay_wonderland.project_brain_record_versions(record_id,project_id,version,mutation_id,status,title,body,subject_ref,content_hash,
             author_kind,author_id,deliverer_kind,deliverer_id,recorded_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [recordId, projectId, version, mutationId, status, title, body, subjectRef, contentHash,
            provenance.author.kind, provenance.author.id, provenance.deliverer.kind, provenance.deliverer.id, occurredAt]);
      }
      const links = command.operation === 'CREATE' ? command.links.map((link) => ({ fromRef: recordId!, relation: link.relation, toRef: link.toRef }))
        : command.operation === 'LINK' ? [{ fromRef: command.fromRef, relation: command.relation, toRef: command.toRef }] : [];
      for (const link of links) {
        await client.query(
          `INSERT INTO relay_wonderland.project_brain_links(link_id,project_id,from_ref,relation,to_ref,mutation_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [`pbl:${this.newId()}`, projectId, link.fromRef, link.relation, link.toRef, mutationId, occurredAt]);
      }
      const payload = {
        schemaVersion: PROJECT_BRAIN_EVENT_SCHEMA_V1, projectId, type: eventType, mutationId, runId,
        recordRef: recordId, version, status,
        ...(command.operation === 'LINK' ? { fromRef: command.fromRef, toRef: command.toRef, relation: command.relation } : {}),
        ...(subjectRef === null ? {} : { subjectRef }),
        author: provenance.author, deliverer: { kind: provenance.deliverer.kind }, occurredAt,
      };
      await client.query(
        `INSERT INTO relay_wonderland.events(event_id,stream_id,project_id,sequence,event_type,visibility,payload,occurred_at) VALUES($1,$2,$3,$4,$5,'PROJECT',$6::jsonb,$7)`,
        [eventId, streamId, projectId, sequence, eventType, JSON.stringify(payload), occurredAt]);

      phase = 'commit';
      await client.query('COMMIT');
      phase = 'done';
      return { ok: true, durable: true, replayed: false, result };
    } catch (error) {
      broken = error instanceof Error ? error : new Error(String(error));
      if (phase === 'commit') {
        // COMMIT was sent and not confirmed: the one case where nobody here knows.
        return {
          ...projectBrainRefusal(503, 'project_brain_commit_unknown',
            'The database did not confirm the change. It may or may not be saved; retrying with the same idempotency key is safe.'),
          durable: 'unknown',
        };
      }
      await client.query('ROLLBACK').catch(() => undefined);
      if (codeOf(error) === '23505') {
        return refuse(projectBrainRefusal(409, 'idempotency_conflict', 'A concurrent change used the same key or link. Nothing was saved; read again and retry.'));
      }
      return refuse(projectBrainRefusal(503, 'project_brain_persistence_failed', 'The Project Brain could not save this change. Nothing was saved.'));
    } finally {
      // A connection that threw is destroyed rather than returned to the pool half-known.
      release(broken);
    }
  }
}
