import type { RelayResult } from '../../protocol/errors';
import type { RelayExecutionAttestation } from '../../mission/contracts';
import { buildExecutionAttestation } from '../../mission/attestation';

/**
 * Reviewer Execution Attestation composer (Prompt 8.3). Relay — never Codex —
 * builds and validates the attestation using the Prompt-8.1 model. It
 * separates the REQUESTED reviewer from the ACTUAL reviewer, marks launch
 * verified only after supported initialization evidence, records the read-only
 * isolated workspace and live provenance, and carries NO fallback. Digests are
 * over already-safe bounded summaries only — never raw streams, hidden
 * reasoning, credentials, or unrelated source. The reviewer's own report can
 * never claim its own successful attestation.
 */

export interface ReviewerAttestationInput {
  attestationId: string;
  projectId: string;
  missionId: string;
  taskId: string;
  runId: string;
  requestedReviewerId: string;
  actualReviewerId: string;
  adapterId: string;
  adapterVersion?: string | null;
  runtimeVersion?: string | null;
  modelVersion?: string | null;
  codexSessionId: string | null;
  workspaceId: string;
  policyReference?: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  launchRequested: boolean;
  /** True only after verified initialization (init record + session id). */
  launchVerified: boolean;
  reportReceived: boolean;
  workspaceInspectionCompleted: boolean;
  /** Safe bounded summaries ONLY. */
  reviewContractSummary: string;
  activitySummary: string;
  reportSummary: string;
  evidenceIds: string[];
}

export const REVIEWER_ROLE = 'independent_coding_reviewer' as const;

export function buildReviewerAttestation(input: ReviewerAttestationInput): RelayResult<RelayExecutionAttestation> {
  return buildExecutionAttestation({
    attestationId: input.attestationId,
    projectId: input.projectId,
    missionId: input.missionId,
    taskId: input.taskId,
    runId: input.runId,
    requestedAgentId: input.requestedReviewerId,
    requestedAgentType: 'codex',
    requestedRole: REVIEWER_ROLE,
    actualAgentId: input.actualReviewerId,
    actualAgentType: 'codex',
    actualRole: REVIEWER_ROLE,
    adapterId: input.adapterId,
    adapterVersion: input.adapterVersion ?? null,
    runtimeVersion: input.runtimeVersion ?? null,
    modelVersion: input.modelVersion ?? null,
    externalSessionId: input.codexSessionId,
    workspaceId: input.workspaceId,
    policyReference: input.policyReference ?? null,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    launchRequested: input.launchRequested,
    launchVerified: input.launchVerified,
    completionSignalReceived: input.reportReceived,
    workspaceInspectionCompleted: input.workspaceInspectionCompleted,
    // A read-only reviewer runs no Relay verification of its own; the mission
    // verification was completed by the implementer flow before review.
    verificationCompleted: input.workspaceInspectionCompleted,
    // The live Codex reviewer NEVER falls back to a simulated reviewer.
    fallback: { occurred: false, agentId: null, reason: null, authorized: true },
    outputSummary: `${input.reviewContractSummary} | ${input.reportSummary}`,
    activitySummary: input.activitySummary,
    evidenceIds: input.evidenceIds,
    provenance: 'live',
  });
}
