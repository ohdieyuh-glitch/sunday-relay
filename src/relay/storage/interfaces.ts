import type { RelayResult } from '../protocol/errors';
import type { CommandEnvelope, EventEnvelope, ReportEnvelope } from '../protocol/envelopes';
import type {
  AgentHandoffPackage, AgentSessionReference, ArtifactReference, EvidenceBundle,
  EvidenceRecord, FailureRecord, FileClaim, FinalAuditReport,
  HandoffCompilationRecord, RelayProject, RelayRun, RelayTask, ResourceClaim,
  TaskAssignment, UsageRecord,
} from '../protocol/contracts';
import type { ProjectId, RunId, TaskId } from '../protocol/ids';

/**
 * Repository PORTS (ARCHITECTURE §2 dependency direction): relay-core and
 * relay-ledger depend on these interfaces only; concrete adapters
 * (in-memory now, durable later) implement them from the outside. Nothing
 * in these ports assumes node fs, a database, or a network.
 */

export interface EventStorePort {
  /** Ordered by sequence, ascending. Never exposes mutation of stored events. */
  listByProject(projectId: ProjectId): readonly EventEnvelope[];
  findByEventId(eventId: string): EventEnvelope | null;
  findByIdempotencyKey(projectId: ProjectId, key: string): EventEnvelope | null;
  findByClaimId(claimId: string): EventEnvelope | null;
  /** Rejects duplicate eventId, duplicate sequence, and sequence gaps. */
  append(event: EventEnvelope, idempotencyKey?: string): RelayResult<null>;
}

export interface KeyedStorePort<T> {
  get(id: string): T | null;
  put(id: string, value: T): RelayResult<null>;
  list(): readonly T[];
}

export interface RelayStores {
  projects: KeyedStorePort<RelayProject>;
  runs: KeyedStorePort<RelayRun>;
  events: EventStorePort;
  tasks: KeyedStorePort<RelayTask>;
  assignments: KeyedStorePort<TaskAssignment>;
  fileClaims: KeyedStorePort<FileClaim>;
  resourceClaims: KeyedStorePort<ResourceClaim>;
  packages: KeyedStorePort<AgentHandoffPackage>;
  compilations: KeyedStorePort<HandoffCompilationRecord>;
  failures: KeyedStorePort<FailureRecord>;
  reports: KeyedStorePort<ReportEnvelope>;
  evidence: KeyedStorePort<EvidenceRecord>;
  evidenceBundles: KeyedStorePort<EvidenceBundle>;
  sessionRefs: KeyedStorePort<AgentSessionReference>;
  artifacts: KeyedStorePort<ArtifactReference>;
  usage: KeyedStorePort<UsageRecord>;
  commands: KeyedStorePort<CommandEnvelope>;
  audits: KeyedStorePort<FinalAuditReport>;
  /** Truthful labeling: volatile stores never masquerade as durable. */
  readonly durability: 'volatile-test-only';
}

export interface RunLookup {
  byId(runId: RunId): RelayRun | null;
}
export interface TaskLookup {
  byId(taskId: TaskId): RelayTask | null;
}
