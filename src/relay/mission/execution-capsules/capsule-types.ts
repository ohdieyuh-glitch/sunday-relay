/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 3
 * The Relay Agent Execution Capsule record + cross-field invariants (PURE).
 *
 * ONE capsule per agent run: the single coherent, inspectable answer to "what
 * was this run responsible for, who actually ran, under which revisions,
 * permissions, and workspace, what did it touch, what did it claim, what
 * supports that claim, what did it cost, and can I still inspect it after the
 * session is gone?"
 *
 * The capsule is serializable by construction: no functions, no provider
 * objects, no raw secrets, no event payloads — identities, references, and
 * ids only.
 */

import type { CapsuleCostState } from './capsule-evidence';
import { deriveCostState } from './capsule-evidence';
import { capsuleError, type RelayExecutionCapsuleError } from './capsule-errors';
import type {
  CapsuleInputContext,
  CapsulePermissionSnapshot,
  CapsuleResponsibilityBinding,
  CapsuleWorkspaceBinding,
} from './capsule-context';
import { workspaceRequiredFor } from './capsule-context';
import type { CapsuleIdentityState, ReviewCreditAssessment } from './capsule-identity';
import {
  evaluateReviewCredit,
  identityActualAgentId,
  identityFallbackAuthorized,
  identityFallbackOccurred,
  identityLaunchRequested,
  identityLaunchVerified,
} from './capsule-identity';
import type {
  CapsuleCompletionClaimReference,
  CapsuleFinalReportReference,
  CapsulePartialOutputReference,
} from './capsule-reports';
import {
  isTerminalCapsuleStatus,
  type RelayAgentExecutionCapsuleStatus,
} from './capsule-status';
import type { TraceReferenceCollections } from './capsule-trace-reference';

export const CAPSULE_TRACE_INTEGRITY_STATUSES = [
  'not_evaluated',
  'pending',
  'verified',
  'failed',
] as const;
export type CapsuleTraceIntegrityStatus = (typeof CAPSULE_TRACE_INTEGRITY_STATUSES)[number];

export interface RelayAgentExecutionCapsule {
  readonly capsuleId: string;

  readonly projectId: string;
  readonly missionId: string;
  readonly taskId: string;
  readonly runId: string;

  /** Requested vs actual identity, launch verification, and fallback — a
      discriminated union, so `actual` cannot exist without verification. */
  readonly identity: CapsuleIdentityState;

  /** Revisions, handoff, policy pack, passport — immutable after preparation. */
  readonly binding: CapsuleResponsibilityBinding;
  readonly inputContext: CapsuleInputContext;
  readonly permissions: CapsulePermissionSnapshot;
  readonly workspace?: CapsuleWorkspaceBinding;

  readonly launchAttestationId?: string;
  /** The production `RelayExecutionAttestation` this run maps to, when one
      exists. Milestone 3 never creates production attestations. */
  readonly executionAttestationId?: string;

  readonly traceReferences: TraceReferenceCollections;
  readonly traceIntegrityStatus: CapsuleTraceIntegrityStatus;

  readonly partialOutput?: CapsulePartialOutputReference;
  readonly finalReport?: CapsuleFinalReportReference;
  readonly completionClaim?: CapsuleCompletionClaimReference;

  readonly evidenceIds: readonly string[];
  readonly costReceiptIds: readonly string[];

  readonly startedAt?: string;
  readonly lastHeartbeatAt?: string;
  readonly finishedAt?: string;

  readonly status: RelayAgentExecutionCapsuleStatus;

  readonly createdAt: string;
  readonly updatedAt: string;
}

/* --------------------------------------------------- flat read helpers */

/** The flat projection of the identity union, for callers (and reports) that
    want the plain requested/actual/launch/fallback facts. */
export interface CapsuleIdentityFacts {
  requestedAgentId: string;
  requestedAgentType: string;
  actualAgentId?: string;
  actualAgentType?: string;
  launchRequested: boolean;
  launchVerified: boolean;
  fallbackOccurred: boolean;
  fallbackAuthorized: boolean;
}

export function capsuleIdentityFacts(capsule: RelayAgentExecutionCapsule): CapsuleIdentityFacts {
  const identity = capsule.identity;
  return {
    requestedAgentId: identity.requested.agentId,
    requestedAgentType: identity.requested.agentType,
    actualAgentId: identityActualAgentId(identity),
    actualAgentType: identity.kind === 'verified' ? identity.actual.agentType : undefined,
    launchRequested: identityLaunchRequested(identity),
    launchVerified: identityLaunchVerified(identity),
    fallbackOccurred: identityFallbackOccurred(identity),
    fallbackAuthorized: identityFallbackAuthorized(identity),
  };
}

export function capsuleCostState(capsule: RelayAgentExecutionCapsule): CapsuleCostState {
  return deriveCostState(capsule.costReceiptIds);
}

/**
 * Review credit at CAPSULE scope: a verified reviewer identity is necessary
 * but not sufficient. The run must also have COMPLETED — a review Relay lost
 * contact with (orphaned), that timed out, was cancelled, or failed is not a
 * review, however legitimate the reviewer was. Whether the findings still
 * apply to the CURRENT artifact remains a Milestone 1/2 question
 * (stale-review detection), deliberately not decided here.
 */
export function evaluateCapsuleReviewCredit(
  capsule: RelayAgentExecutionCapsule,
): ReviewCreditAssessment {
  const identityCredit = evaluateReviewCredit(capsule.identity, capsule.binding.responsibility);
  if (!identityCredit.eligible) return identityCredit;
  if (capsule.status !== 'completed') {
    return {
      eligible: false,
      reason: `the review run is ${capsule.status}, not completed — an unfinished review earns no credit`,
    };
  }
  return identityCredit;
}

/* ------------------------------------------------ cross-field invariants */

/**
 * Guards the combinations no single field can see. Returns the FIRST violated
 * invariant, or null when the capsule is coherent. Called on every proposed
 * next capsule — a rejected operation therefore leaves the stored capsule
 * byte-for-byte unchanged.
 */
export function validateCapsuleInvariants(
  capsule: RelayAgentExecutionCapsule,
): RelayExecutionCapsuleError | null {
  const { identity, status } = capsule;
  const fail = (
    code: Parameters<typeof capsuleError>[0],
    reason: string,
    action: string,
    field: string,
    extra: { expected?: string; actual?: string } = {},
  ) =>
    capsuleError(code, reason, action, {
      capsuleId: capsule.capsuleId,
      runId: capsule.runId,
      field,
      ...extra,
    });

  // 1: a requested identity is always present (structural, but persisted data
  // can carry anything).
  if (!identity.requested.agentId) {
    return fail(
      'MISSING_REQUESTED_AGENT',
      'a capsule must always record which agent Relay requested',
      'record the requested agent identity',
      'identity.requested.agentId',
    );
  }

  // 3/4: launch verification requires a requested launch, an attestation, and
  // an actual identity — all three are structural in the union, so this only
  // catches forged/persisted records.
  if (identity.kind === 'verified' && !identity.attestationId) {
    return fail(
      'LAUNCH_NOT_VERIFIED',
      'a verified launch must reference the attestation that proved it',
      'attach the trusted launch attestation',
      'identity.attestationId',
    );
  }

  // 11: an unauthorized fallback is visible forever and never runnable.
  // Checked BEFORE the generic launch check so the reported reason names the
  // real problem — something else ran — rather than the symptom.
  if (
    identity.kind === 'fallback_unauthorized' &&
    !isTerminalCapsuleStatus(status) &&
    status !== 'starting'
  ) {
    return fail(
      'UNAUTHORIZED_FALLBACK',
      `${identity.observed.agentId} ran instead of ${identity.requested.agentId} without authorization — this capsule cannot proceed`,
      'fail or cancel this capsule; authorize the fallback in policy if it was legitimate',
      'status',
      { expected: 'a terminal status', actual: status },
    );
  }

  // 5/6: running, waiting, and stalled all require a VERIFIED launch.
  if (
    (status === 'running' || status === 'waiting' || status === 'stalled') &&
    identity.kind !== 'verified'
  ) {
    return fail(
      'LAUNCH_NOT_VERIFIED',
      `a capsule cannot be ${status} without an independently verified launch`,
      'verify the launch with a trusted supervisory source first',
      'status',
      { expected: 'verified launch', actual: identity.kind },
    );
  }

  // 7: completed requires a final report unless policy waived it.
  if (status === 'completed' && !capsule.finalReport && !capsule.binding.finalReportWaived) {
    return fail(
      'FINAL_REPORT_REQUIRED',
      'a completed run must supply a final report unless the task policy waives it',
      'attach the final report, or complete under an explicit report waiver',
      'finalReport',
    );
  }

  // 9: a failed launch receives no actual-agent credit.
  if (identity.kind === 'launch_failed' && identityActualAgentId(identity) !== undefined) {
    return fail(
      'ACTUAL_AGENT_NOT_VERIFIED',
      'a failed launch cannot carry an actual agent identity',
      'record what was observed as an unauthorized fallback instead',
      'identity',
    );
  }

  // 82: a failed launch can never carry a final report or completion claim.
  if (
    (identity.kind === 'launch_failed' || identity.kind === 'launch_requested') &&
    (capsule.finalReport || capsule.completionClaim)
  ) {
    return fail(
      'ACTUAL_AGENT_NOT_VERIFIED',
      'a run whose launch was never verified cannot produce a final report or completion claim',
      'discard the fabricated report; only a verified run reports',
      'finalReport',
    );
  }

  // 10: fallback requires requested and actual identities to differ.
  if (identity.kind === 'verified' && identity.fallback.occurred) {
    if (identity.actual.agentId === identity.requested.agentId) {
      return fail(
        'UNAUTHORIZED_FALLBACK',
        'fallback cannot be recorded when the actual agent equals the requested agent',
        'clear the fallback record, or name the agent that actually ran',
        'identity.fallback',
        { expected: `not ${identity.requested.agentId}`, actual: identity.actual.agentId },
      );
    }
  }
  if (
    identity.kind === 'verified' &&
    !identity.fallback.occurred &&
    identity.actual.agentId !== identity.requested.agentId
  ) {
    return fail(
      'UNAUTHORIZED_FALLBACK',
      `${identity.actual.agentId} ran but ${identity.requested.agentId} was requested — this is a fallback and must be recorded as one`,
      'record the fallback and whether policy authorized it',
      'identity.fallback',
    );
  }

  // 12: file-changing responsibilities require a workspace.
  if (workspaceRequiredFor(capsule.binding.responsibility) && !capsule.workspace) {
    return fail(
      'WORKSPACE_REQUIRED',
      `a ${capsule.binding.responsibility} run changes files and requires a workspace binding`,
      'bind the run to a writable workspace',
      'workspace',
    );
  }
  if (
    capsule.workspace &&
    workspaceRequiredFor(capsule.binding.responsibility) &&
    capsule.workspace.readOnly
  ) {
    return fail(
      'WORKSPACE_INCOMPATIBLE',
      `a ${capsule.binding.responsibility} run cannot execute in a read-only workspace`,
      'bind a writable workspace, or change the run responsibility',
      'workspace.readOnly',
    );
  }

  // 13/14: timestamps must match the lifecycle stage.
  if (isTerminalCapsuleStatus(status) && !capsule.finishedAt) {
    return fail(
      'INVALID_TIMESTAMP_ORDER',
      `a ${status} capsule must record when it finished`,
      'supply finishedAt with the terminal transition',
      'finishedAt',
    );
  }
  if (status === 'running' && !capsule.startedAt) {
    return fail(
      'INVALID_TIMESTAMP_ORDER',
      'a running capsule must record when it started',
      'supply startedAt with the running transition',
      'startedAt',
    );
  }

  // 15/16: ordering.
  if (capsule.finishedAt && capsule.startedAt && capsule.finishedAt < capsule.startedAt) {
    return fail(
      'INVALID_TIMESTAMP_ORDER',
      'finishedAt cannot precede startedAt',
      'correct the lifecycle timestamps',
      'finishedAt',
      { expected: `>= ${capsule.startedAt}`, actual: capsule.finishedAt },
    );
  }
  if (
    capsule.lastHeartbeatAt &&
    capsule.startedAt &&
    capsule.lastHeartbeatAt < capsule.startedAt
  ) {
    return fail(
      'INVALID_TIMESTAMP_ORDER',
      'a heartbeat cannot precede startedAt',
      'correct the heartbeat timestamp',
      'lastHeartbeatAt',
      { expected: `>= ${capsule.startedAt}`, actual: capsule.lastHeartbeatAt },
    );
  }

  // 19/20: reference uniqueness (append helpers enforce it; this catches
  // forged or persisted records).
  if (new Set(capsule.evidenceIds).size !== capsule.evidenceIds.length) {
    return fail(
      'DUPLICATE_EVIDENCE_REFERENCE',
      'evidence ids must be unique within a capsule',
      'remove the duplicate evidence reference',
      'evidenceIds',
    );
  }
  if (new Set(capsule.costReceiptIds).size !== capsule.costReceiptIds.length) {
    return fail(
      'DUPLICATE_COST_RECEIPT_REFERENCE',
      'cost receipt ids must be unique within a capsule',
      'remove the duplicate receipt reference',
      'costReceiptIds',
    );
  }

  return null;
}
