/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 4
 * Aquala Trace Event Ledger — public surface.
 *
 * One append-only, versioned, SHA-256 hash-chained trace connects user intent
 * through routing, contracts, commands, capsules, activity, evidence, review,
 * approval, verification, release, and (later) economics. Events are never
 * edited or deleted; secrets are redacted before hashing; agent claims stay
 * distinguishable from supervisory observations; and nothing about mission
 * success is ever inferred from a process finishing.
 *
 * See docs/relay/AQUALA_TRACE_STANDARD.md.
 */

export * from './trace-errors';
export * from './trace-types';
export * from './trace-event-types';
export {
  canonicalSerialize,
  canonicalEventInput,
} from './trace-canonicalization';
export { sha256Hex, isValidHashFormat, normalizeHash } from './trace-hashing';
export {
  redactEventMetadata,
  metadataContainsSecrets,
  containsResidualSecret,
  type RedactedMetadata,
} from './trace-redaction';
export {
  validateSourceTrust,
  defaultTrustForActor,
  isSupervisoryTrust,
  AUTHORIZED_ATTESTATION_SERVICES,
  AUTHORIZED_VERIFICATION_SERVICES,
  type SourceTrustContext,
} from './trace-source-trust';
export {
  createAqualaTraceEvent,
  recomputeEventHash,
  type CreateTraceEventInput,
} from './trace-event-factory';
export { InMemoryTraceRepository } from './trace-repository';
export {
  createTrace,
  appendTraceEvent,
  appendTraceEventBatch,
  completeTrace,
  sealTrace,
  markTraceIntegrityFailed,
  type CreateTraceInput,
  type CreatedTrace,
  type AppendEventInput,
  type AppendBatchInput,
  type CompleteTraceInput,
  type SealTraceInput,
} from './trace-ledger';
export {
  verifyTraceIntegrity,
  type AqualaTraceIntegrityReport,
  type AqualaTraceIntegrityReason,
} from './trace-integrity';
export { reconstructTrace } from './trace-reconstruction';
export {
  AQUALA_ECONOMICS_STATUSES,
  type AqualaTrace,
  type AqualaEconomicsStatus,
  type AqualaTraceIdentitySummary,
} from './trace-summary';
export {
  adaptStatusTransitionEvent,
  adaptCommandEvent,
  adaptCapsulePrepared,
  adaptLaunchRequested,
  adaptLaunchOutcome,
  adaptCapsuleStatus,
  adaptHeartbeat,
  adaptPartialOutput,
  adaptFinalReport,
  adaptCompletionClaim,
  adaptEvidenceLink,
  adaptCostReceiptLink,
  type StatusEventAdapterOptions,
  type CommandEventAdapterOptions,
  type CapsuleEventAdapterOptions,
  type ReferenceLinkOptions,
} from './trace-adapters';
export {
  traceEventToReference,
  deriveReferenceIntegrity,
  traceIntegrityToCapsuleStatus,
  eventIsSelfReport,
  type TraceReferenceAdapterOptions,
} from './trace-reference-adapter';
