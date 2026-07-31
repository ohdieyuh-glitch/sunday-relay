/**
 * DURABLE MISSION PERSISTENCE — the canonical record shared by the browser
 * application and Node, its storage port, the checkpoint policy, the
 * ownership guard, and recovery classification. Pure domain: no storage
 * engine, no clock, no execution, no provider.
 */
export {
  BLOCKING_CLASSIFICATIONS,
  DURABLE_CHECKPOINT_REASONS,
  DURABLE_MISSION_SCHEMA_V1,
  DURABLE_MISSION_SCHEMA_VERSION,
  DURABLE_RECOVERY_CLASSIFICATIONS,
  RESUMABLE_CLASSIFICATIONS,
  SUPPORTED_DURABLE_SCHEMA_VERSIONS,
} from './durable-contracts';
export type {
  DurableActionRecord,
  DurableAgentAssignment,
  DurableCheckpointReason,
  DurableEvidenceRefs,
  DurableMissionRecord,
  DurableMissionRecordDraft,
  DurableMissionSchemaVersion,
  DurableOwnerLease,
  DurableRecoveryClassification,
  DurableUsageState,
} from './durable-contracts';
export { digestOf, sha256Hex, stableSerialize } from './durable-digest';
export {
  DURABLE_FORBIDDEN_KEY_RE,
  DURABLE_FORBIDDEN_STREAM_KEY_RE,
  DURABLE_SECRET_VALUE_RE,
  draftFromRecord,
  migrateDurableRecord,
  readDurableRecord,
  redactDurableRecord,
  sealDurableRecord,
  serializeDurableRecord,
  verifyDurableChecksum,
} from './durable-record';
export type { DurableReadFailure, DurableReadResult } from './durable-record';
export {
  createDurableMissionStore,
  createInMemoryDurableBacking,
} from './durable-store';
export type {
  DurableKeyValueBacking,
  DurableMissionStorePort,
  DurableWriteFailed,
  DurableWriteOk,
  DurableWriteResult,
} from './durable-store';
export {
  OWNER_LEASE_MS,
  claimLease,
  createResumeCoordinator,
  leaseAllows,
  shouldCheckpoint,
} from './durable-checkpoint';
export type { CheckpointDecision, ResumeOutcome } from './durable-checkpoint';
export { assessRecovery, executionMayStart } from './durable-recovery';
export type { RecoveryAssessment, RecoveryEnvironment } from './durable-recovery';
