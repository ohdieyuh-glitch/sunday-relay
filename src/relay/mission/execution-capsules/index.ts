/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 3
 * Per-Agent Execution Capsule domain — public surface.
 *
 * One capsule per agent run: requested vs actual identity, verified launch,
 * revision/handoff/policy/passport binding, permission snapshot, workspace
 * binding, ordered trace references, reports and claims, evidence and cost
 * references — inspectable long after the session ends.
 *
 * A capsule describes a PROCESS. It never decides mission outcome,
 * verification, or release. See docs/relay/EXECUTION_CAPSULES.md.
 */

export * from './capsule-errors';
export * from './capsule-status';
export * from './capsule-identity';
export * from './capsule-context';
export * from './capsule-trace-reference';
export * from './capsule-reports';
export * from './capsule-evidence';
export * from './capsule-types';
export {
  redactCapsuleMetadata,
  redactCapsuleText,
  containsSecretShapedValue,
  requireSecretFreeMetadata,
} from './capsule-redaction';
export {
  prepareExecutionCapsule,
  recordLaunchRequested,
  attachLaunchAttestation,
  markRunning,
  markWaiting,
  markStalled,
  markCompleted,
  markFailed,
  markCancelled,
  markTimedOut,
  markOrphaned,
  recordHeartbeat,
  evaluateHeartbeatLiveness,
  appendCapsuleTraceReference,
  attachEvidenceId,
  attachCostReceiptId,
  attachPartialOutput,
  attachFinalReport,
  attachCompletionClaim,
  findTraceReference,
  type PrepareExecutionCapsuleInput,
  type AttachLaunchAttestationInput,
  type AppendTraceReferenceInput,
  type CompleteCapsuleInput,
  type TerminateCapsuleInput,
} from './capsule-service';
export {
  InMemoryExecutionCapsuleRepository,
  bindingDrift,
} from './capsule-repository';
export {
  validateCapsuleSnapshot,
  replayCapsuleOperations,
  type CapsuleOperationRecord,
  type CapsuleReplayResult,
  type CapsuleSnapshotValidation,
} from './capsule-reconstruction';
export {
  projectAgentRun,
  type RelayAgentRunProjection,
  type CapsuleIdentityProjection,
  type CapsuleActivityProjection,
} from './capsule-projection';
