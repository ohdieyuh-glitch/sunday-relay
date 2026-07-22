import { fail, ok, relayError, type RelayResult } from '../protocol/errors';
import type { Provenance } from '../protocol/enums';
import type { RelayExecutionAttestation } from './contracts';
import { stableDigest } from './mission';

/**
 * Execution attestation builder (Prompt 8.1). Immutable projection that
 * separates the REQUESTED agent from the agent that ACTUALLY ran. A launch
 * request is not proof; a process start without verified initialization is
 * not success proof; a failed launch cannot satisfy required execution; a
 * fallback is always visible and must be policy-authorized and never inherit
 * the requested identity. Simulated executions get simulated provenance;
 * live Claude execution gets live provenance. No credential, raw stream,
 * hidden reasoning, private prompt, or auth data ever enters an attestation.
 *
 * A pure deterministic digest (browser-safe, no Node crypto) is computed
 * over already-safe, bounded summaries — never over secrets — so the whole
 * mission module stays reusable by a future graphical Mission Control.
 */

export interface ExecutionFacts {
  attestationId: string;
  projectId: string;
  missionId: string;
  taskId: string;
  runId: string;
  requestedAgentId: string;
  requestedAgentType: string;
  requestedRole: string;
  actualAgentId: string;
  actualAgentType: string;
  actualRole: string;
  adapterId: string;
  adapterVersion?: string | null;
  runtimeVersion?: string | null;
  modelVersion?: string | null;
  externalSessionId?: string | null;
  workspaceId?: string | null;
  policyReference?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  launchRequested: boolean;
  launchVerified: boolean;
  completionSignalReceived: boolean;
  workspaceInspectionCompleted: boolean;
  verificationCompleted: boolean;
  fallback?: { occurred: boolean; agentId: string | null; reason: string | null; authorized: boolean };
  /** Safe, bounded summary strings ONLY (never raw streams or secrets). */
  outputSummary?: string | null;
  activitySummary?: string | null;
  evidenceIds: string[];
  provenance: Provenance;
}

const digest = (text: string | null | undefined): string | null =>
  text == null || text === '' ? null : stableDigest(text);

export function buildExecutionAttestation(facts: ExecutionFacts): RelayResult<RelayExecutionAttestation> {
  const fb = facts.fallback ?? { occurred: false, agentId: null, reason: null, authorized: true };

  // A fallback must be policy-authorized and must never inherit the
  // requested agent's identity.
  if (fb.occurred) {
    if (!fb.authorized) {
      return fail(relayError('permission-denied', 'Fallback is not policy-authorized — cannot attest.'));
    }
    if (fb.agentId && fb.agentId === facts.requestedAgentId) {
      return fail(relayError('validation-failed', 'A fallback may not inherit the requested agent identity.'));
    }
  }
  // Simulated runs never receive a live attestation and vice versa: the
  // provenance is taken verbatim from the caller's execution facts, and the
  // caller derives it from the adapter descriptor's provenance.

  const attestation: RelayExecutionAttestation = {
    attestationId: facts.attestationId,
    projectId: facts.projectId,
    missionId: facts.missionId,
    taskId: facts.taskId,
    requestedAgentId: facts.requestedAgentId,
    requestedAgentType: facts.requestedAgentType,
    requestedRole: facts.requestedRole,
    actualAgentId: facts.actualAgentId,
    actualAgentType: facts.actualAgentType,
    actualRole: facts.actualRole,
    adapterId: facts.adapterId,
    adapterVersion: facts.adapterVersion ?? null,
    runtimeVersion: facts.runtimeVersion ?? null,
    modelVersion: facts.modelVersion ?? null,
    runId: facts.runId,
    externalSessionId: facts.externalSessionId ?? null,
    workspaceId: facts.workspaceId ?? null,
    policyReference: facts.policyReference ?? null,
    startedAt: facts.startedAt ?? null,
    finishedAt: facts.finishedAt ?? null,
    launchRequested: facts.launchRequested,
    launchVerified: facts.launchVerified,
    completionSignalReceived: facts.completionSignalReceived,
    workspaceInspectionCompleted: facts.workspaceInspectionCompleted,
    verificationCompleted: facts.verificationCompleted,
    fallbackOccurred: fb.occurred,
    fallbackAgentId: fb.agentId,
    fallbackReason: fb.reason,
    outputDigest: digest(facts.outputSummary),
    activityDigest: digest(facts.activitySummary),
    evidenceIds: [...facts.evidenceIds],
    provenance: facts.provenance,
    immutable: true,
  };
  return ok(Object.freeze(attestation));
}

/** Did this attestation actually PROVE the required execution ran? A launch
 * request alone, or a start without verified initialization, is not proof. */
export function attestsSuccessfulExecution(a: RelayExecutionAttestation): boolean {
  return a.launchRequested && a.launchVerified && a.completionSignalReceived;
}

/** Was an identity-sensitive execution by `agentId` actually attested (not
 * merely requested)? Used to forbid a "Reviewed by Codex" state without a
 * Codex attestation. */
export function hasAttestedExecutionBy(
  attestations: readonly RelayExecutionAttestation[],
  agentId: string,
  role: string,
): boolean {
  return attestations.some(
    (a) => a.actualAgentId === agentId && a.actualRole === role && attestsSuccessfulExecution(a),
  );
}
