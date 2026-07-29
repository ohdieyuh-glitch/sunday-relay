/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 4
 * Pure adapters from Milestones 1–3 into trace-event DRAFTS.
 *
 * Adapters translate; they never execute, never persist, and never modify the
 * domains they read. Each returns a draft — the LEDGER still allocates the
 * global sequence, binds the previous hash, redacts, and hashes, so a
 * domain-local sequence (a command's own event order, say) is preserved in
 * metadata and never mistaken for trace order.
 *
 * The identity rule from Milestone 3 travels with the events: a requested
 * agent is never projected as an actual agent, an unauthorized substitution
 * is recorded as OBSERVED rather than actual, and an agent's own report stays
 * a `claim`.
 */

import type { AqualaStatusTransitionEvent } from '../status/status-model';
import type { RelayMissionCommandEvent } from '../commands/command-events';
import type { RelayAgentExecutionCapsule } from '../execution-capsules/capsule-types';
import { capsuleIdentityFacts } from '../execution-capsules/capsule-types';
import type { RelayAgentExecutionCapsuleStatus } from '../execution-capsules/capsule-status';
import type { AqualaTraceEventDraft, AqualaTraceSourceTrust } from './trace-types';

/* ------------------------------------------------- Milestone 1 adapter */

const DIMENSION_EVENT_TYPES = {
  execution: 'mission_execution_status_changed',
  outcome: 'mission_outcome_status_changed',
  verification: 'mission_verification_status_changed',
  release: 'mission_release_status_changed',
} as const;

const DIMENSION_FAMILIES = {
  execution: 'mission',
  outcome: 'mission',
  verification: 'verification',
  release: 'release',
} as const;

export interface StatusEventAdapterOptions {
  traceId: string;
  sourceService?: string;
  /** Distinct from the status event id, which is preserved in metadata. */
  eventId: string;
}

/**
 * Adapts an ACCEPTED Milestone 1 status transition. A rejected transition
 * never reaches this function — the status engine returns an error instead of
 * an event, so a refusal can never be recorded as an applied change.
 */
export function adaptStatusTransitionEvent(
  event: AqualaStatusTransitionEvent,
  options: StatusEventAdapterOptions,
): AqualaTraceEventDraft {
  return {
    eventId: options.eventId,
    traceId: options.traceId,
    projectId: event.projectId,
    missionId: event.missionId,
    ...(event.taskId ? { taskId: event.taskId } : {}),
    missionRevision: event.missionRevision,
    ...(event.artifactRevision ? { artifactRevision: event.artifactRevision } : {}),
    eventFamily: DIMENSION_FAMILIES[event.dimension],
    eventType: DIMENSION_EVENT_TYPES[event.dimension],
    sourceProduct: 'sunday_relay',
    sourceService: options.sourceService ?? 'relay-status-model',
    actorId: event.actorId,
    actorType: event.actorType === 'agent' || event.actorType === 'reviewer' ? event.actorType : 'relay',
    // A status transition is a Relay decision the status engine already
    // validated, so it is an observation — never the actor's own claim.
    sourceTrust: 'observed',
    occurredAt: event.occurredAt,
    metadata: {
      statusEventId: event.eventId,
      dimension: event.dimension,
      previousStatus: event.previousStatus,
      nextStatus: event.nextStatus,
      reason: event.reason,
      actorType: event.actorType,
    },
  };
}

/* ------------------------------------------------- Milestone 2 adapter */

/** Command event type → trace event type. The trace vocabulary is explicit
    about checkpoints and approvals, which the command layer names generically. */
const COMMAND_EVENT_TYPES: Readonly<Record<string, string>> = {
  command_received: 'command_received',
  command_interpreted: 'command_interpreted',
  command_clarification_required: 'command_clarification_required',
  command_validation_required: 'command_validation_required',
  command_validated: 'command_validated',
  command_rejected: 'command_rejected',
  checkpoint_required: 'command_checkpoint_required',
  checkpoint_satisfied: 'command_checkpoint_satisfied',
  checkpoint_failed: 'command_checkpoint_required',
  approval_required: 'command_approval_required',
  approval_received: 'command_approval_received',
  command_execution_started: 'command_execution_started',
  state_change_applied: 'command_state_change_applied',
  command_executed: 'command_executed',
  command_failed: 'command_failed',
};

const COMMAND_EVENT_FAMILIES: Readonly<Record<string, AqualaTraceEventDraft['eventFamily']>> = {
  command_approval_required: 'approval',
  command_approval_received: 'approval',
};

export interface CommandEventAdapterOptions {
  traceId: string;
  eventId: string;
  sourceService?: string;
  actorType?: AqualaTraceEventDraft['actorType'];
}

export function adaptCommandEvent(
  event: RelayMissionCommandEvent,
  options: CommandEventAdapterOptions,
): AqualaTraceEventDraft | null {
  const eventType = COMMAND_EVENT_TYPES[event.eventType];
  if (!eventType) return null;

  return {
    eventId: options.eventId,
    traceId: options.traceId,
    projectId: event.projectId,
    missionId: event.missionId,
    commandId: event.commandId,
    missionRevision: event.missionRevision,
    eventFamily: COMMAND_EVENT_FAMILIES[eventType] ?? 'command',
    eventType,
    sourceProduct: 'sunday_relay',
    sourceService: options.sourceService ?? 'relay-command-protocol',
    actorId: event.actorId,
    actorType: options.actorType ?? 'user',
    sourceTrust: 'observed',
    occurredAt: event.occurredAt,
    metadata: {
      commandEventId: event.eventId,
      // The command's OWN order is preserved; the ledger allocates trace order.
      commandLocalSequence: event.sequence,
      commandEventType: event.eventType,
      ...event.metadata,
    },
  };
}

/* ------------------------------------------------- Milestone 3 adapter */

const CAPSULE_STATUS_EVENT_TYPES: Readonly<
  Partial<Record<RelayAgentExecutionCapsuleStatus, string>>
> = {
  running: 'agent_execution_started',
  waiting: 'agent_waiting',
  stalled: 'agent_stalled',
  completed: 'agent_execution_completed',
  failed: 'agent_execution_failed',
  cancelled: 'agent_execution_cancelled',
  timed_out: 'agent_execution_timed_out',
  orphaned: 'agent_execution_orphaned',
};

export interface CapsuleEventAdapterOptions {
  traceId: string;
  eventId: string;
  occurredAt: string;
  actorId?: string;
  sourceService?: string;
}

function capsuleBase(
  capsule: RelayAgentExecutionCapsule,
  options: CapsuleEventAdapterOptions,
): Pick<
  AqualaTraceEventDraft,
  'eventId' | 'traceId' | 'projectId' | 'missionId' | 'taskId' | 'capsuleId' | 'runId' | 'missionRevision' | 'taskRevision' | 'sourceProduct' | 'occurredAt'
> {
  return {
    eventId: options.eventId,
    traceId: options.traceId,
    projectId: capsule.projectId,
    missionId: capsule.missionId,
    taskId: capsule.taskId,
    capsuleId: capsule.capsuleId,
    runId: capsule.runId,
    missionRevision: capsule.binding.missionRevision,
    taskRevision: capsule.binding.taskRevision,
    sourceProduct: 'sunday_relay',
    occurredAt: options.occurredAt,
  };
}

/** Capsule preparation: responsibility, bindings, and the REQUESTED identity
    only — nothing has launched, so no actual identity exists to record. */
export function adaptCapsulePrepared(
  capsule: RelayAgentExecutionCapsule,
  options: CapsuleEventAdapterOptions,
): AqualaTraceEventDraft {
  const facts = capsuleIdentityFacts(capsule);
  return {
    ...capsuleBase(capsule, options),
    eventFamily: 'execution',
    eventType: 'execution_capsule_prepared',
    sourceService: options.sourceService ?? 'relay-capsule-service',
    actorId: options.actorId ?? 'relay-capsule-service',
    actorType: 'relay',
    sourceTrust: 'observed',
    metadata: {
      responsibility: capsule.binding.responsibility,
      requestedAgentId: facts.requestedAgentId,
      requestedAgentType: facts.requestedAgentType,
      handoffId: capsule.binding.handoffId,
      handoffCompilerVersion: capsule.binding.handoffCompilerVersion,
      policyPackVersion: capsule.binding.policyPackVersion,
      passportId: capsule.binding.passportId,
      permissionPolicyVersion: capsule.permissions.permissionPolicyVersion,
      ...(capsule.workspace
        ? {
            workspaceId: capsule.workspace.workspaceId,
            workspaceKind: capsule.workspace.kind,
            branchName: capsule.workspace.branchName,
            baseCommitSha: capsule.workspace.baseCommitSha,
          }
        : {}),
    },
  };
}

export function adaptLaunchRequested(
  capsule: RelayAgentExecutionCapsule,
  options: CapsuleEventAdapterOptions,
): AqualaTraceEventDraft {
  const facts = capsuleIdentityFacts(capsule);
  return {
    ...capsuleBase(capsule, options),
    eventFamily: 'execution',
    eventType: 'agent_launch_requested',
    sourceService: options.sourceService ?? 'relay-supervisor',
    actorId: options.actorId ?? 'relay-supervisor',
    actorType: 'relay',
    sourceTrust: 'observed',
    metadata: { requestedAgentId: facts.requestedAgentId, launchVerified: false },
  };
}

/**
 * Launch outcome. Which event type and trust level this produces is decided
 * ENTIRELY by the capsule's identity state, so no caller can promote a
 * failed or unauthorized launch into a verified one.
 */
export function adaptLaunchOutcome(
  capsule: RelayAgentExecutionCapsule,
  options: CapsuleEventAdapterOptions,
): AqualaTraceEventDraft | null {
  const identity = capsule.identity;
  const base = capsuleBase(capsule, options);
  const attester = options.actorId ?? 'relay-supervisor';

  switch (identity.kind) {
    case 'verified': {
      const authorizedFallback = identity.fallback.occurred;
      return {
        ...base,
        eventFamily: 'execution',
        eventType: authorizedFallback ? 'agent_fallback_authorized' : 'agent_launch_verified',
        sourceService: options.sourceService ?? 'relay-supervisor',
        actorId: attester,
        actorType: 'relay',
        // A trusted supervisory source proved the launch.
        sourceTrust: 'attested',
        metadata: {
          requestedAgentId: identity.requested.agentId,
          actualAgentId: identity.actual.agentId,
          actualAgentType: identity.actual.agentType,
          executionIdentityId: identity.actual.executionIdentityId ?? null,
          externalSessionId: identity.actual.externalSessionId ?? null,
          attestationId: identity.attestationId,
          launchVerified: true,
          fallbackOccurred: authorizedFallback,
          fallbackAuthorized: authorizedFallback,
          ...(authorizedFallback && identity.fallback.occurred
            ? { fallbackAuthorizedBy: identity.fallback.authorized ? identity.fallback.authorizedBy : null }
            : {}),
        },
      };
    }
    case 'launch_failed':
      return {
        ...base,
        eventFamily: 'execution',
        eventType: 'agent_launch_failed',
        sourceService: options.sourceService ?? 'relay-supervisor',
        actorId: attester,
        actorType: 'relay',
        sourceTrust: 'attested',
        metadata: {
          requestedAgentId: identity.requested.agentId,
          launchVerified: false,
          failureReason: identity.failureReason,
          attestationId: identity.attestationId,
        },
      };
    case 'fallback_unauthorized':
      return {
        ...base,
        eventFamily: 'security',
        eventType: 'agent_fallback_rejected',
        sourceService: options.sourceService ?? 'relay-supervisor',
        actorId: attester,
        actorType: 'relay',
        sourceTrust: 'attested',
        metadata: {
          requestedAgentId: identity.requested.agentId,
          // OBSERVED, never actual — the wrapper earns no requested-agent credit.
          observedAgentId: identity.observed.agentId,
          observedAgentType: identity.observed.agentType,
          launchVerified: false,
          fallbackOccurred: true,
          fallbackAuthorized: false,
          reason: identity.reason,
        },
      };
    default:
      return null;
  }
}

export function adaptCapsuleStatus(
  capsule: RelayAgentExecutionCapsule,
  options: CapsuleEventAdapterOptions,
): AqualaTraceEventDraft | null {
  const eventType = CAPSULE_STATUS_EVENT_TYPES[capsule.status];
  if (!eventType) return null;
  const facts = capsuleIdentityFacts(capsule);
  return {
    ...capsuleBase(capsule, options),
    eventFamily: 'execution',
    eventType,
    sourceService: options.sourceService ?? 'relay-supervisor',
    actorId: options.actorId ?? 'relay-supervisor',
    actorType: 'relay',
    sourceTrust: 'observed',
    metadata: {
      capsuleStatus: capsule.status,
      requestedAgentId: facts.requestedAgentId,
      ...(facts.actualAgentId ? { actualAgentId: facts.actualAgentId } : {}),
      launchVerified: facts.launchVerified,
    },
  };
}

export function adaptHeartbeat(
  capsule: RelayAgentExecutionCapsule,
  options: CapsuleEventAdapterOptions,
): AqualaTraceEventDraft {
  return {
    ...capsuleBase(capsule, options),
    eventFamily: 'process',
    eventType: 'agent_heartbeat',
    sourceService: options.sourceService ?? 'relay-supervisor',
    actorId: options.actorId ?? 'relay-supervisor',
    actorType: 'relay',
    sourceTrust: 'observed',
    metadata: { lastHeartbeatAt: capsule.lastHeartbeatAt ?? null },
  };
}

export function adaptPartialOutput(
  capsule: RelayAgentExecutionCapsule,
  options: CapsuleEventAdapterOptions,
): AqualaTraceEventDraft | null {
  const partial = capsule.partialOutput;
  if (!partial) return null;
  return {
    ...capsuleBase(capsule, options),
    eventFamily: 'report',
    eventType: 'agent_partial_output_saved',
    sourceService: options.sourceService ?? 'relay-supervisor',
    actorId: partial.capturedBy,
    actorType: partial.truth === 'agent_claim' ? 'agent' : 'relay',
    sourceTrust: partial.truth === 'agent_claim' ? 'claim' : 'observed',
    metadata: {
      partialOutputReferenceId: partial.referenceId,
      changedFileCount: partial.changedFileCount,
      commandCount: partial.commandCount,
      testCount: partial.testCount,
      findingCount: partial.findingCount,
      truth: partial.truth,
    },
  };
}

/** A final report is the AGENT's account of its own work: always a claim. */
export function adaptFinalReport(
  capsule: RelayAgentExecutionCapsule,
  options: CapsuleEventAdapterOptions,
): AqualaTraceEventDraft | null {
  const report = capsule.finalReport;
  if (!report) return null;
  return {
    ...capsuleBase(capsule, options),
    eventFamily: 'report',
    eventType: 'agent_final_report_received',
    sourceService: options.sourceService ?? 'relay-capsule-service',
    actorId: report.reportedBy,
    actorType: 'agent',
    sourceTrust: 'claim',
    metadata: {
      finalReportReferenceId: report.referenceId,
      reportFormat: report.reportFormat,
      truth: report.truth,
    },
  };
}

/** "I finished" — a claim, never verification. */
export function adaptCompletionClaim(
  capsule: RelayAgentExecutionCapsule,
  options: CapsuleEventAdapterOptions,
): AqualaTraceEventDraft | null {
  const claim = capsule.completionClaim;
  if (!claim) return null;
  return {
    ...capsuleBase(capsule, options),
    eventFamily: 'report',
    eventType: 'agent_completion_claim_received',
    sourceService: options.sourceService ?? 'relay-capsule-service',
    actorId: claim.claimedBy,
    actorType: 'agent',
    sourceTrust: 'claim',
    metadata: {
      completionClaimReferenceId: claim.referenceId,
      claimedStatus: claim.claimedStatus,
      truth: claim.truth,
      establishesVerification: false,
    },
  };
}

export interface ReferenceLinkOptions extends CapsuleEventAdapterOptions {
  sourceTrust?: AqualaTraceSourceTrust;
}

export function adaptEvidenceLink(
  capsule: RelayAgentExecutionCapsule,
  evidenceId: string,
  options: ReferenceLinkOptions,
): AqualaTraceEventDraft {
  return {
    ...capsuleBase(capsule, options),
    eventFamily: 'evidence',
    eventType: 'evidence_reference_linked',
    sourceService: options.sourceService ?? 'relay-supervisor',
    actorId: options.actorId ?? 'relay-supervisor',
    actorType: 'relay',
    sourceTrust: options.sourceTrust ?? 'observed',
    metadata: { evidenceId },
  };
}

/** Links a receipt ID only. No amount, no total, no pricing lookup — Mission
    Economics (Milestone 5) owns every number. */
export function adaptCostReceiptLink(
  capsule: RelayAgentExecutionCapsule,
  costReceiptId: string,
  options: ReferenceLinkOptions,
): AqualaTraceEventDraft {
  return {
    ...capsuleBase(capsule, options),
    eventFamily: 'economics',
    eventType: 'cost_receipt_reference_linked',
    sourceService: options.sourceService ?? 'relay-cost-service',
    actorId: options.actorId ?? 'relay-cost-service',
    actorType: 'system',
    sourceTrust: options.sourceTrust ?? 'observed',
    metadata: { costReceiptId, amountCalculated: false },
  };
}
