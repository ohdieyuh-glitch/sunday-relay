/**
 * SUNDAY RELAY — LOOP RUNTIME (barrel).
 *
 * The durable execution of one Loop: its domain, its state machine, its journal
 * vocabulary, its reducer and its recovery classification. Every module here is
 * PURE — the Node adapter that writes these events to a journal file lives in
 * `src/relay/persistence/`, the same split `DurableMissionRecord` already uses.
 */

export {
  RELAY_LOOP_RUN_SCHEMA_V1,
  RELAY_LOOP_RUN_SCHEMA_VERSION,
  SUPPORTED_LOOP_RUN_SCHEMA_VERSIONS,
  RELAY_LOOP_RUNTIME_STATES,
  RELAY_LOOP_CHECKPOINT_REASONS,
  emptyLoopBudget,
  type RelayLoopRunSchemaVersion,
  type RelayLoopRuntimeState,
  type RelayLoopAssignment,
  type RelayLoopBudgetState,
  type RelayLoopObservation,
  type RelayLoopDecision,
  type RelayLoopAgentExecution,
  type RelayLoopIteration,
  type RelayLoopCheckpoint,
  type RelayLoopCheckpointReason,
  type RelayLoopRuntimeFailure,
  type RelayLoopRunLease,
  type RelayLoopRun,
} from './loop-runtime-types';

export {
  RELAY_LOOP_TRANSITIONS,
  RELAY_LOOP_LIMIT_LANDINGS,
  RELAY_LOOP_STATE_CLASS,
  RELAY_LOOP_STATE_CLASSES,
  RUNTIME_STATES_ARE_LOOP_STATES,
  classifyLoopState,
  loopStatesInClass,
  isTerminalLoopState,
  isExhaustionLoopState,
  isActiveLoopState,
  isWaitingLoopState,
  isStoppingLoopState,
  isRecoveryLoopState,
  loopRunSucceeded,
  mayDispatchAgent,
  mayResumeFrom,
  transitionLoopRun,
  landingForLimit,
  type LoopTransitionResult,
  type RelayLoopLimitKind,
  type RelayLoopStateClass,
} from './loop-runtime-state';

export {
  RELAY_LOOP_EVENT_KINDS,
  RELAY_LOOP_EVENT_SCHEMA_V1,
  RELAY_LOOP_EVENT_SCHEMA_VERSION,
  RELAY_LOOP_EVENT_STATE,
  REPEATABLE_LOOP_EVENT_KINDS,
  SUPPORTED_LOOP_EVENT_SCHEMA_VERSIONS,
  LOOP_EVENT_KINDS_REQUIRING_IDEMPOTENCY,
  buildLoopEvent,
  loopEventIdentity,
  verifyLoopEventChecksum,
  type BuildLoopEventInput,
  type BuildLoopEventResult,
  type RelayLoopEvent,
  type RelayLoopEventInput,
  type RelayLoopEventKind,
  type RelayLoopEventPayload,
} from './loop-runtime-events';

export {
  applyLoopEvent,
  replayLoopJournal,
  seedLoopRun,
  loopSnapshotFrom,
  loadLoopRun,
  type LoopApplyResult,
  type LoopReplayResult,
  type LoopJournalIntegrity,
  type RelayLoopSnapshot,
  type LoopSnapshotSource,
  type LoopLoadResult,
  type LoopDigestFn,
} from './loop-runtime-reducer';

export {
  appendLoopRunEvent,
  checkpointLoopRun,
  createInMemoryLoopBacking,
  emptyLoopRunRecord,
  readLoopRun,
  type LoopAppendInput,
  type LoopAppendResult,
  type LoopRunRecord,
  type LoopRunStoreBacking,
} from './loop-runtime-store';

export {
  LOOP_HIDDEN_REASONING_RE,
  LOOP_MAX_SUMMARY_LENGTH,
  containsForbiddenLoopMaterial,
  sanitizeLoopPayload,
  sanitizeLoopText,
} from './loop-runtime-redaction';

export { loopDigest, loopDigestOf, loopSha256Hex, loopStableSerialize } from './loop-runtime-digest';

export {
  RELAY_LOOP_AGENT_OUTCOMES,
  SAFE_TO_RETRY_OUTCOMES,
  portSupportsRole,
  type RelayLoopAgentFinding,
  type RelayLoopAgentOutcome,
  type RelayLoopAgentPort,
  type RelayLoopAgentRequest,
  type RelayLoopAgentResult,
  type RelayLoopAgentStatus,
  type RelayLoopAgentUsage,
} from './loop-agent-port';

export {
  createFakeLoopAgent,
  type FakeLoopAgent,
  type FakeLoopAgentInvocation,
  type FakeLoopAgentOptions,
  type FakeLoopAgentStep,
} from './fake-loop-agent';

export {
  LOOP_LOCK_PURPOSE,
  RELAY_LOOP_CONTROL_ACTIONS,
  confirmLoopRun,
  loopConfirmationKey,
  loopRunIsActive,
  requestLoopPause,
  requestLoopResume,
  requestLoopStop,
  type LoopConfirmationInput,
  type LoopConfirmationOutcome,
  type LoopControlOutcome,
  type LoopOperationDeps,
  type RelayLoopControlAction,
  type RelayLoopControlRequest,
} from './loop-operations';

export {
  projectLoopHistory,
  projectLoopInspection,
  projectLoopStatus,
  projectionLeaksNothing,
  type LoopHistoryEntry,
  type LoopIdentityProjection,
  type LoopInspectionProjection,
  type LoopIterationProjection,
  type LoopStatusProjection,
  type LoopUsageProjection,
} from './loop-projections';

export {
  checkLoopLimits,
  createInMemoryLoopLockPort,
  preflightLoopDispatch,
  runLoopIteration,
  runLoopUntilSettled,
  type LoopEngineContext,
  type LoopEngineDeps,
  type LoopEngineOutcome,
  type LoopLimitVerdict,
  type LoopLockResult,
  type LoopRunLockHandle,
  type LoopRunLockPort,
} from './loop-iteration-engine';

export {
  RELAY_LOOP_RECOVERY_CLASSIFICATIONS,
  RESUMABLE_LOOP_CLASSIFICATIONS,
  BLOCKING_LOOP_CLASSIFICATIONS,
  classifyLoopRecovery,
  type RelayLoopRecoveryClassification,
  type LoopRecoveryInput,
  type LoopRecoveryReport,
} from './loop-runtime-recovery';

export {
  bindLoopAdvance,
  runLoopWorkerPass,
} from './loop-worker';
export type {
  LoopAdvanceFn,
  LoopSkipReason,
  LoopWorkerAttempt,
  LoopWorkerOptions,
  LoopWorkerPass,
  LoopWorkerPorts,
} from './loop-worker';
