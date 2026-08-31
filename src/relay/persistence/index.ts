/**
 * Durable local persistence (Prompt 8.5) — public surface. Append-only
 * journal (the authority) + versioned snapshots + atomic writes + locks +
 * migrations + the recovery service, all under a local application-state
 * root (never the Git repository). No provider is ever launched from this
 * module; recovery produces plans that always require explicit founder
 * authorization before any further live call.
 */

export * from './contracts';
export { resolveStateRoot, ensureStateRoot, safeRunSegment, resolveRunDir, STATE_DIR_NAME } from './paths';
export { stableSerialize, sha256Hex, digestOf } from './integrity';
export {
  sanitizePayload, sanitizeText, containsForbiddenMaterial,
  FORBIDDEN_KEY_RE, SECRET_VALUE_RE, HIDDEN_REASONING_RE,
} from './redaction';
export { writeFileAtomic, appendLineDurable, readTextIfExists } from './atomic-file';
export {
  JOURNAL_FILE, buildPersistedEvent, eventChecksum, readJournal,
  type JournalIntegrity, type JournalReadResult,
} from './journal';
export {
  SNAPSHOT_FILE, SNAPSHOT_PREVIOUS_FILE, canTransition, applyEvent, replayJournal,
  snapshotFromState, writeSnapshot, loadSnapshot,
  type ReducedState, type SnapshotSource,
} from './snapshot';
export { LOCK_FILE, acquireRunLock, inspectLock, type AcquiredLock, type LockClassification } from './lock';
export { createStateStore, type StateStore, type LoadedRun } from './store';
export { migrateRun, runSchemaVersion, type MigrationResult } from './migrations';
export {
  recoverRun, classifySessionReadiness, dogStateForRecovery, type RecoveryReport,
} from './recovery';
export { reinspectWorkspace, type RecoveredWorkspaceInspection } from './recovery-inspector';
export { stateDoctorReport } from './doctor';
export { createSupervisedRunRecorder, type SupervisedRunRecorder } from './supervised-recorder';
export { runPersistenceContractVerification, type PersistenceContractCheck } from './verify-harness';
export { runRecoveryDrill } from './recovery-drill';
export {
  DURABLE_MISSIONS_DIR, createNodeDurableBacking, createNodeDurableMissionStore,
  createNodeCodingAgentStore, createNodeMissionWorktreeStore, createNodePromptArchitectStore, createNodeReviewerHarnessStore, readPreviousDurableRecordText,
} from './durable-mission-file';
export {
  createBetaEnrolmentStore, isUsableParticipantId,
  type BetaEnrolmentStore, type EnrolResult,
} from './beta-enrollment-node';
export {
  createRepositoryRegistrationStore,
  type RepositoryRegistrationStore,
} from './repository-registration-node';
export {
  createBrainMemoryStore,
  type BrainMemoryStore,
} from './brain-memory-node';

export {
  createPspConfigStore,
  type PspConfigStore,
  type SavedPsp,
} from './psp-config-node';
export { TransactionalWonderlandDatabase, postgresWonderlandDatabaseFromEnv, WONDERLAND_MIGRATION_001, WONDERLAND_MIGRATION_002, WONDERLAND_MIGRATION_003, WONDERLAND_MIGRATION_004, WONDERLAND_MIGRATION_005, WONDERLAND_MIGRATION_006, WONDERLAND_MIGRATION_007, WONDERLAND_MIGRATION_008, WONDERLAND_MIGRATION_009, WONDERLAND_MIGRATION_010, WONDERLAND_MIGRATION_019, WONDERLAND_MIGRATION_020, WONDERLAND_MIGRATION_021, WONDERLAND_MIGRATIONS, type WonderlandTransaction, type ClaimedOutbox, type BudgetAmounts, type BudgetReservation, type DurableEvalRuntime, type ClaimedSwarmWorker, type CreateSwarmRun } from './wonderland-postgres';
export { JULIUS_READ_LIMIT, JuliusReadPostgresRepository } from './julius-read-postgres';
export { JuliusSubagentPostgresRepository } from './julius-subagent-postgres';
export { JuliusLifecyclePostgresRepository } from './julius-lifecycle-postgres';
export { JuliusTimelinePostgresRepository } from './julius-timeline-postgres';
export { GauntletPostgresRepository } from './gauntlet-postgres';
export { JuliusToolPostgresRepository } from './julius-tool-postgres';

export { JuliusToolRecoveryPostgresRepository } from './julius-tool-recovery-postgres';
export { JuliusToolSettlementPostgresRepository } from './julius-tool-settlement-postgres';
