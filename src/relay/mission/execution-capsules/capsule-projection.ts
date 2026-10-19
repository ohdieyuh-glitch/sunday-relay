/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 3
 * Pure developer projection for the FUTURE Agent Run page (Milestone 6).
 *
 * A read model only: it renders what the capsule actually holds and refuses to
 * infer anything it does not. Specifically, it never produces a review verdict
 * ("CHANGES REQUIRED" belongs to the review/verification projection, not to a
 * process that exited), never turns a completion claim into verification, and
 * never turns missing cost receipts into a number.
 *
 * No React, no routes, no UI here — this milestone ships no interface.
 */

import { projectCapsuleExecutionStatus } from './capsule-status';
import type { AqualaExecutionStatus } from '../status/status-model';
import { deriveCostState } from './capsule-evidence';
import { TRACE_REFERENCE_CHANNELS } from './capsule-trace-reference';
import type { RelayAgentExecutionCapsule } from './capsule-types';
import { capsuleIdentityFacts, evaluateCapsuleReviewCredit } from './capsule-types';

export interface CapsuleIdentityProjection {
  requested: string;
  /** Absent until a trusted source verified a launch. */
  actual: string | null;
  /** What Relay OBSERVED, even when it was not authorized to run. */
  observed: string | null;
  launchVerified: 'Yes' | 'No';
  fallback: 'No' | 'Yes — authorized' | 'Yes — NOT authorized';
}

export interface CapsuleActivityProjection {
  fileEventReferences: number;
  toolEventReferences: number;
  commandEventReferences: number;
  processEventReferences: number;
  reviewEventReferences: number;
  approvalEventReferences: number;
  promptEventReferences: number;
  permissionEventReferences: number;
  errorReferences: number;
  warningReferences: number;
  /** Supervisory observations, as opposed to agent-authored claims. */
  supervisoryReferences: number;
  agentClaimReferences: number;
}

export interface RelayAgentRunProjection {
  headline: string;
  taskId: string;
  runId: string;
  responsibility: string;
  execution: string;
  /** The Milestone 1 EXECUTION dimension only. */
  executionStatus: AqualaExecutionStatus;
  identity: CapsuleIdentityProjection;
  context: {
    missionRevision: number;
    taskRevision: number;
    handoffCompilerVersion: string;
    policyPackVersion: string;
    passportId: string;
  };
  workspace: {
    label: string;
    branch: string | null;
    baseCommit: string | null;
    readOnly: boolean;
  } | null;
  activity: CapsuleActivityProjection;
  report: string;
  completionClaim: string;
  cost: 'Pending cost receipts' | string;
  traceIntegrity: string;
  /** Review attribution eligibility — never a verdict. */
  reviewCredit: { eligible: boolean; creditedAgentId: string | null; reason: string };
  /** What this capsule deliberately does NOT establish. */
  doesNotEstablish: string[];
}

const EXECUTION_LABELS: Record<RelayAgentExecutionCapsule['status'], string> = {
  prepared: 'Prepared',
  starting: 'Starting',
  running: 'Running',
  waiting: 'Waiting',
  stalled: 'Stalled',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
  timed_out: 'Timed out',
  orphaned: 'Orphaned',
};

export function projectAgentRun(capsule: RelayAgentExecutionCapsule): RelayAgentRunProjection {
  const facts = capsuleIdentityFacts(capsule);
  const identity = capsule.identity;

  const observed =
    identity.kind === 'verified'
      ? identity.actual.agentId
      : identity.kind === 'fallback_unauthorized'
        ? identity.observed.agentId
        : null;

  const fallbackLabel: CapsuleIdentityProjection['fallback'] = !facts.fallbackOccurred
    ? 'No'
    : facts.fallbackAuthorized
      ? 'Yes — authorized'
      : 'Yes — NOT authorized';

  let supervisory = 0;
  let claims = 0;
  for (const channel of TRACE_REFERENCE_CHANNELS) {
    for (const reference of capsule.traceReferences[channel]) {
      if (reference.source === 'agent_report') claims += 1;
      else if (reference.integrity !== 'unverified') supervisory += 1;
    }
  }

  const costState = deriveCostState(capsule.costReceiptIds);
  const credit = evaluateCapsuleReviewCredit(capsule);

  return {
    headline: `${facts.actualAgentId ?? facts.requestedAgentId} — ${capsule.binding.responsibility}`,
    taskId: capsule.taskId,
    runId: capsule.runId,
    responsibility: capsule.binding.responsibility,
    execution: EXECUTION_LABELS[capsule.status],
    executionStatus: projectCapsuleExecutionStatus(capsule.status),
    identity: {
      requested: facts.requestedAgentId,
      actual: facts.actualAgentId ?? null,
      observed,
      launchVerified: facts.launchVerified ? 'Yes' : 'No',
      fallback: fallbackLabel,
    },
    context: {
      missionRevision: capsule.binding.missionRevision,
      taskRevision: capsule.binding.taskRevision,
      handoffCompilerVersion: capsule.binding.handoffCompilerVersion,
      policyPackVersion: capsule.binding.policyPackVersion,
      passportId: capsule.binding.passportId,
    },
    workspace: capsule.workspace
      ? {
          label: `${capsule.workspace.readOnly ? 'Read-only' : 'Writable'} ${capsule.workspace.kind.replace('_', ' ')}`,
          branch: capsule.workspace.branchName,
          baseCommit: capsule.workspace.baseCommitSha,
          readOnly: capsule.workspace.readOnly,
        }
      : null,
    activity: {
      fileEventReferences: capsule.traceReferences.fileEvents.length,
      toolEventReferences: capsule.traceReferences.toolEvents.length,
      commandEventReferences: capsule.traceReferences.commandEvents.length,
      processEventReferences: capsule.traceReferences.processEvents.length,
      reviewEventReferences: capsule.traceReferences.reviewEvents.length,
      approvalEventReferences: capsule.traceReferences.approvalEvents.length,
      promptEventReferences: capsule.traceReferences.promptEvents.length,
      permissionEventReferences: capsule.traceReferences.permissionEvents.length,
      errorReferences: capsule.traceReferences.errors.length,
      warningReferences: capsule.traceReferences.warnings.length,
      supervisoryReferences: supervisory,
      agentClaimReferences: claims,
    },
    report: capsule.finalReport
      ? 'Final report received'
      : capsule.partialOutput
        ? 'Partial output preserved — no final report'
        : 'No report',
    completionClaim: capsule.completionClaim
      ? `Agent claimed "${capsule.completionClaim.claimedStatus}" — a claim, not verification`
      : 'No completion claim',
    cost: costState === 'pending' ? 'Pending cost receipts' : `${capsule.costReceiptIds.length} cost receipt(s)`,
    traceIntegrity:
      capsule.traceIntegrityStatus === 'not_evaluated'
        ? 'Not evaluated — the Aquala Trace ledger verifies integrity (Milestone 4)'
        : capsule.traceIntegrityStatus,
    reviewCredit: {
      eligible: credit.eligible,
      creditedAgentId: credit.creditedAgentId ?? null,
      reason: credit.reason,
    },
    doesNotEstablish: [
      'mission outcome satisfied',
      'verification approved or verified',
      'release eligible',
      'a review verdict',
    ],
  };
}
