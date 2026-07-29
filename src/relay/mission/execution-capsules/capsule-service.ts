/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 3
 * Capsule preparation and lifecycle operations (PURE).
 *
 * Every mutation is a NAMED operation with its own preconditions — there is no
 * generic setter, so nothing can quietly rewrite an identity, a revision, or a
 * history. Each operation returns either the complete next capsule or a
 * structured error; on failure the caller's capsule is untouched, because
 * operations build a new record and never mutate the input.
 *
 * Two guarantees run through all of it:
 *   - `prepareExecutionCapsule` is ATOMIC — a failed preparation stores
 *     nothing and leaves the repository unchanged;
 *   - a TERMINAL capsule is immutable. The single deliberate exception is
 *     cost-receipt attachment, because economics receipts are reconciled after
 *     a run ends (Milestone 5); every other post-terminal operation is
 *     rejected with `TERMINAL_CAPSULE_IMMUTABLE`.
 *
 * No clocks, no id generation, no provider calls, no process control: `at`
 * timestamps and every id are supplied by the caller.
 */

import type {
  CapsuleInputContext,
  CapsulePermissionSnapshot,
  CapsuleResponsibility,
  CapsuleResponsibilityBinding,
  CapsuleWorkspaceBinding,
} from './capsule-context';
import { workspaceRequiredFor } from './capsule-context';
import { appendCostReceiptId, appendEvidenceId } from './capsule-evidence';
import {
  capsuleError,
  capsuleFail,
  capsuleOk,
  type CapsuleResult,
  type RelayExecutionCapsuleError,
} from './capsule-errors';
import type {
  ActualAgentIdentity,
  CapsuleIdentityState,
  RelayExecutionLaunchAttestation,
  RequestedAgentIdentity,
} from './capsule-identity';
import {
  identitySubjectAgentIds,
  isSameExecutionParty,
  NO_FALLBACK,
} from './capsule-identity';
import {
  isTerminalCapsuleStatus,
  validateCapsuleStatusTransition,
  type RelayAgentExecutionCapsuleStatus,
} from './capsule-status';
import type {
  CapsuleCompletionClaimReference,
  CapsuleFinalReportReference,
  CapsulePartialOutputReference,
} from './capsule-reports';
import {
  appendTraceReference,
  createEmptyTraceReferences,
  createTraceReference,
  type TraceReference,
  type TraceReferenceChannel,
  type TraceReferenceInput,
} from './capsule-trace-reference';
import type { RelayAgentExecutionCapsule } from './capsule-types';
import { validateCapsuleInvariants } from './capsule-types';

/* --------------------------------------------------------- preparation */

export interface PrepareExecutionCapsuleInput {
  capsuleId: string;
  projectId: string;
  missionId: string;
  taskId: string;
  runId: string;
  requestedAgent: RequestedAgentIdentity;
  responsibility: CapsuleResponsibility;
  missionRevision: number;
  taskRevision: number;
  handoffId: string;
  handoffCompilerVersion: string;
  policyPackVersion: string;
  passportId: string;
  finalReportWaived?: boolean;
  inputContext: CapsuleInputContext;
  permissions: CapsulePermissionSnapshot;
  workspace?: CapsuleWorkspaceBinding;
  /** Caller-supplied preparation instant — the domain never reads a clock. */
  at: string;
}

const REQUIRED_IDS: Array<[keyof PrepareExecutionCapsuleInput, RelayExecutionCapsuleError['code']]> = [
  ['projectId', 'MISSING_PROJECT_ID'],
  ['missionId', 'MISSING_MISSION_ID'],
  ['taskId', 'MISSING_TASK_ID'],
  ['runId', 'MISSING_RUN_ID'],
];

const REQUIRED_REFERENCES: Array<
  [keyof PrepareExecutionCapsuleInput, RelayExecutionCapsuleError['code'], string]
> = [
  ['handoffId', 'MISSING_HANDOFF_REFERENCE', 'the compiled handoff the agent received'],
  ['policyPackVersion', 'MISSING_POLICY_REFERENCE', 'the policy pack version in force'],
  ['passportId', 'MISSING_PASSPORT_REFERENCE', 'the Agent Passport authorizing this run'],
];

/**
 * Validates identity, revisions, references, permissions, and workspace, then
 * returns the canonical PREPARED capsule: requested identity present, actual
 * identity absent, launch neither requested nor verified, trace integrity
 * `not_evaluated`. Emits no provider call and mutates no input.
 */
export function prepareExecutionCapsule(
  input: PrepareExecutionCapsuleInput,
): CapsuleResult<RelayAgentExecutionCapsule> {
  for (const [field, code] of REQUIRED_IDS) {
    if (!String(input[field] ?? '').trim()) {
      return capsuleFail(
        capsuleError(code, `${field} is required to prepare a capsule`, `supply the ${field}`, {
          capsuleId: input.capsuleId,
          field: String(field),
        }),
      );
    }
  }

  if (!Number.isInteger(input.missionRevision) || input.missionRevision <= 0) {
    return capsuleFail(
      capsuleError(
        'INVALID_MISSION_REVISION',
        'mission revision must be a positive integer bound at preparation',
        'supply the mission revision the agent is answering to',
        {
          capsuleId: input.capsuleId,
          field: 'missionRevision',
          expected: 'a positive integer',
          actual: String(input.missionRevision),
        },
      ),
    );
  }
  if (!Number.isInteger(input.taskRevision) || input.taskRevision <= 0) {
    return capsuleFail(
      capsuleError(
        'INVALID_TASK_REVISION',
        'task revision must be a positive integer bound at preparation',
        'supply the task revision the agent is answering to',
        {
          capsuleId: input.capsuleId,
          field: 'taskRevision',
          expected: 'a positive integer',
          actual: String(input.taskRevision),
        },
      ),
    );
  }

  for (const [field, code, what] of REQUIRED_REFERENCES) {
    if (!String(input[field] ?? '').trim()) {
      return capsuleFail(
        capsuleError(code, `a capsule must reference ${what}`, `supply ${String(field)}`, {
          capsuleId: input.capsuleId,
          field: String(field),
        }),
      );
    }
  }

  if (!input.requestedAgent?.agentId?.trim()) {
    return capsuleFail(
      capsuleError(
        'MISSING_REQUESTED_AGENT',
        'a capsule must record which agent Relay requested before any launch',
        'supply the requested agent identity',
        { capsuleId: input.capsuleId, field: 'requestedAgent' },
      ),
    );
  }

  if (workspaceRequiredFor(input.responsibility) && !input.workspace) {
    return capsuleFail(
      capsuleError(
        'WORKSPACE_REQUIRED',
        `a ${input.responsibility} run changes files and requires a workspace binding`,
        'bind a writable workspace before preparing this run',
        { capsuleId: input.capsuleId, field: 'workspace' },
      ),
    );
  }

  // Concurrent write ownership is rejected at preparation: the workspace may
  // already be owned, but never by a DIFFERENT agent than the one this run
  // will write with.
  if (
    input.workspace &&
    !input.workspace.readOnly &&
    input.workspace.writeOwnerAgentId !== null &&
    input.workspace.writeOwnerAgentId !== input.requestedAgent.agentId
  ) {
    return capsuleFail(
      capsuleError(
        'WRITE_OWNER_CONFLICT',
        `${input.workspace.workspaceId} write ownership is held by ${input.workspace.writeOwnerAgentId}, not ${input.requestedAgent.agentId}`,
        'release or reassign workspace write ownership through a validated command first',
        {
          capsuleId: input.capsuleId,
          field: 'workspace.writeOwnerAgentId',
          expected: input.requestedAgent.agentId,
          actual: input.workspace.writeOwnerAgentId,
        },
      ),
    );
  }

  const binding: CapsuleResponsibilityBinding = Object.freeze({
    responsibility: input.responsibility,
    missionRevision: input.missionRevision,
    taskRevision: input.taskRevision,
    handoffId: input.handoffId,
    handoffCompilerVersion: input.handoffCompilerVersion,
    policyPackVersion: input.policyPackVersion,
    passportId: input.passportId,
    finalReportWaived: input.finalReportWaived ?? false,
  });

  const capsule: RelayAgentExecutionCapsule = {
    capsuleId: input.capsuleId,
    projectId: input.projectId,
    missionId: input.missionId,
    taskId: input.taskId,
    runId: input.runId,
    identity: { kind: 'requested', requested: { ...input.requestedAgent } },
    binding,
    inputContext: { ...input.inputContext },
    permissions: input.permissions,
    ...(input.workspace ? { workspace: { ...input.workspace } } : {}),
    traceReferences: createEmptyTraceReferences(),
    traceIntegrityStatus: 'not_evaluated',
    evidenceIds: [],
    costReceiptIds: [],
    status: 'prepared',
    createdAt: input.at,
    updatedAt: input.at,
  };

  const invariant = validateCapsuleInvariants(capsule);
  if (invariant) return capsuleFail(invariant);
  return capsuleOk(capsule);
}

/* ----------------------------------------------------- shared plumbing */

function terminalGuard(
  capsule: RelayAgentExecutionCapsule,
  operation: string,
): RelayExecutionCapsuleError | null {
  if (!isTerminalCapsuleStatus(capsule.status)) return null;
  return capsuleError(
    'TERMINAL_CAPSULE_IMMUTABLE',
    `${capsule.capsuleId} is ${capsule.status}; ${operation} cannot change a terminal run's history`,
    'inspect the capsule, or create a new run for further work',
    { capsuleId: capsule.capsuleId, runId: capsule.runId, field: 'status', actual: capsule.status },
  );
}

/** Applies a patch, revalidates every invariant, and returns the next capsule
    only when it is fully coherent. */
function commit(
  capsule: RelayAgentExecutionCapsule,
  patch: Partial<RelayAgentExecutionCapsule>,
  at: string,
): CapsuleResult<RelayAgentExecutionCapsule> {
  const next: RelayAgentExecutionCapsule = { ...capsule, ...patch, updatedAt: at };
  const invariant = validateCapsuleInvariants(next);
  if (invariant) return capsuleFail(invariant);
  return capsuleOk(next);
}

function transition(
  capsule: RelayAgentExecutionCapsule,
  next: RelayAgentExecutionCapsuleStatus,
  patch: Partial<RelayAgentExecutionCapsule>,
  at: string,
): CapsuleResult<RelayAgentExecutionCapsule> {
  const validation = validateCapsuleStatusTransition(capsule.status, next);
  if (!validation.ok) {
    return capsuleFail(
      capsuleError(
        'INVALID_CAPSULE_STATUS_TRANSITION',
        validation.reason,
        'inspect the capsule status, or create a new run',
        {
          capsuleId: capsule.capsuleId,
          runId: capsule.runId,
          field: 'status',
          expected: `a valid transition from ${capsule.status}`,
          actual: next,
        },
      ),
    );
  }
  return commit(capsule, { ...patch, status: next }, at);
}

/* --------------------------------------------------------- launch flow */

export function recordLaunchRequested(
  capsule: RelayAgentExecutionCapsule,
  at: string,
): CapsuleResult<RelayAgentExecutionCapsule> {
  const guard = terminalGuard(capsule, 'requesting a launch');
  if (guard) return capsuleFail(guard);
  if (capsule.identity.kind !== 'requested') {
    return capsuleFail(
      capsuleError(
        'INVALID_CAPSULE_STATUS_TRANSITION',
        'a launch has already been requested for this capsule',
        'inspect the existing launch record',
        { capsuleId: capsule.capsuleId, field: 'identity', actual: capsule.identity.kind },
      ),
    );
  }
  const identity: CapsuleIdentityState = {
    kind: 'launch_requested',
    requested: capsule.identity.requested,
    launchRequestedAt: at,
  };
  return transition(capsule, 'starting', { identity }, at);
}

export interface AttachLaunchAttestationInput {
  attestation: RelayExecutionLaunchAttestation;
  /** Observed runtime identity — required when the attestation is verified,
      or when an unverified attestation reports a DIFFERENT runtime ran. */
  actualAgent?: ActualAgentIdentity;
  /** Policy authorization for a fallback, when one occurred. */
  fallbackAuthorization?: { authorized: boolean; authorizedBy?: string; reason: string };
  at: string;
}

/**
 * Attaches a trusted launch attestation and moves identity to its proven
 * state: verified, launch_failed, or fallback_unauthorized. This is the ONLY
 * way an actual identity ever enters a capsule — no report, wrapper response,
 * or agent claim can reach it.
 */
export function attachLaunchAttestation(
  capsule: RelayAgentExecutionCapsule,
  input: AttachLaunchAttestationInput,
): CapsuleResult<RelayAgentExecutionCapsule> {
  const guard = terminalGuard(capsule, 'attaching a launch attestation');
  if (guard) return capsuleFail(guard);

  const identity = capsule.identity;
  if (identity.kind !== 'launch_requested') {
    return capsuleFail(
      capsuleError(
        'LAUNCH_NOT_REQUESTED',
        `a launch attestation requires a requested launch (identity is "${identity.kind}")`,
        'record the launch request before attaching an attestation',
        { capsuleId: capsule.capsuleId, field: 'identity', actual: identity.kind },
      ),
    );
  }

  const { attestation } = input;
  if (attestation.capsuleId !== capsule.capsuleId) {
    return capsuleFail(
      capsuleError(
        'INVALID_LAUNCH_ATTESTATION',
        'the attestation belongs to a different capsule',
        'attach the attestation issued for this capsule',
        {
          capsuleId: capsule.capsuleId,
          field: 'attestation.capsuleId',
          expected: capsule.capsuleId,
          actual: attestation.capsuleId,
        },
      ),
    );
  }
  if (attestation.requestedAgentId !== identity.requested.agentId) {
    return capsuleFail(
      capsuleError(
        'INVALID_LAUNCH_ATTESTATION',
        'the attestation names a different requested agent',
        'attach the attestation for the agent this capsule requested',
        {
          capsuleId: capsule.capsuleId,
          field: 'attestation.requestedAgentId',
          expected: identity.requested.agentId,
          actual: attestation.requestedAgentId,
        },
      ),
    );
  }

  /* ---- launch was NOT verified ---- */
  if (!attestation.verified) {
    if (input.actualAgent) {
      // Something else ran. Authorized fallback still requires VERIFIED
      // observation of that runtime, so an unverified attestation naming a
      // different runtime is always the unauthorized-fallback state.
      const failed: CapsuleIdentityState = {
        kind: 'fallback_unauthorized',
        requested: identity.requested,
        observed: { ...input.actualAgent },
        launchRequestedAt: identity.launchRequestedAt,
        attestationId: attestation.attestationId,
        reason:
          input.fallbackAuthorization?.reason ??
          attestation.failureReason ??
          `${input.actualAgent.agentId} was observed instead of ${identity.requested.agentId}`,
      };
      return commit(capsule, { identity: failed, launchAttestationId: attestation.attestationId }, input.at);
    }
    const failed: CapsuleIdentityState = {
      kind: 'launch_failed',
      requested: identity.requested,
      launchRequestedAt: identity.launchRequestedAt,
      attestationId: attestation.attestationId,
      failureReason: attestation.failureReason ?? 'the requested runtime did not become active',
    };
    return commit(capsule, { identity: failed, launchAttestationId: attestation.attestationId }, input.at);
  }

  /* ---- launch WAS verified ---- */
  const actual = input.actualAgent;
  if (!actual) {
    return capsuleFail(
      capsuleError(
        'ACTUAL_AGENT_NOT_VERIFIED',
        'a verified launch must supply the observed runtime identity',
        'record which agent the supervisory source actually observed',
        { capsuleId: capsule.capsuleId, field: 'actualAgent' },
      ),
    );
  }
  if (attestation.actualAgentId !== actual.agentId) {
    return capsuleFail(
      capsuleError(
        'INVALID_LAUNCH_ATTESTATION',
        'the attestation and the observed identity disagree about which agent ran',
        'attach an attestation that matches the observed runtime',
        {
          capsuleId: capsule.capsuleId,
          field: 'actualAgent.agentId',
          expected: attestation.actualAgentId ?? 'none',
          actual: actual.agentId,
        },
      ),
    );
  }

  const samePartyAsRequested = isSameExecutionParty(identity.requested, actual);
  if (samePartyAsRequested && actual.agentId === identity.requested.agentId) {
    const verified: CapsuleIdentityState = {
      kind: 'verified',
      requested: identity.requested,
      actual: { ...actual },
      launchRequestedAt: identity.launchRequestedAt,
      launchVerifiedAt: attestation.launchVerifiedAt ?? input.at,
      attestationId: attestation.attestationId,
      fallback: NO_FALLBACK,
    };
    return commit(
      capsule,
      { identity: verified, launchAttestationId: attestation.attestationId },
      input.at,
    );
  }

  /* A different agent ran — fallback. Authorization decides whether the run
     may proceed, and BOTH identities stay visible either way. */
  const authorization = input.fallbackAuthorization;
  if (!authorization?.authorized) {
    const unauthorized: CapsuleIdentityState = {
      kind: 'fallback_unauthorized',
      requested: identity.requested,
      observed: { ...actual },
      launchRequestedAt: identity.launchRequestedAt,
      attestationId: attestation.attestationId,
      reason:
        authorization?.reason ??
        `${actual.agentId} ran instead of ${identity.requested.agentId} without policy authorization`,
    };
    return commit(
      capsule,
      { identity: unauthorized, launchAttestationId: attestation.attestationId },
      input.at,
    );
  }

  const authorizedFallback: CapsuleIdentityState = {
    kind: 'verified',
    requested: identity.requested,
    actual: { ...actual },
    launchRequestedAt: identity.launchRequestedAt,
    launchVerifiedAt: attestation.launchVerifiedAt ?? input.at,
    attestationId: attestation.attestationId,
    fallback: {
      occurred: true,
      authorized: true,
      authorizedBy: authorization.authorizedBy ?? 'mission_policy',
      reason: authorization.reason,
    },
  };
  return commit(
    capsule,
    { identity: authorizedFallback, launchAttestationId: attestation.attestationId },
    input.at,
  );
}

/* ------------------------------------------------------ activity states */

export function markRunning(
  capsule: RelayAgentExecutionCapsule,
  at: string,
): CapsuleResult<RelayAgentExecutionCapsule> {
  const guard = terminalGuard(capsule, 'marking a run running');
  if (guard) return capsuleFail(guard);
  if (capsule.identity.kind === 'fallback_unauthorized') {
    return capsuleFail(
      capsuleError(
        'UNAUTHORIZED_FALLBACK',
        `${capsule.identity.observed.agentId} ran instead of ${capsule.identity.requested.agentId} without authorization — this run cannot proceed`,
        'fail this capsule and prepare an authorized run',
        { capsuleId: capsule.capsuleId, runId: capsule.runId, field: 'identity' },
      ),
    );
  }
  if (capsule.identity.kind !== 'verified') {
    return capsuleFail(
      capsuleError(
        'LAUNCH_NOT_VERIFIED',
        'a run cannot be marked running before its launch is independently verified',
        'attach a trusted launch attestation first',
        {
          capsuleId: capsule.capsuleId,
          field: 'identity',
          expected: 'verified',
          actual: capsule.identity.kind,
        },
      ),
    );
  }
  const startedAt = capsule.startedAt ?? at;
  return transition(capsule, 'running', { startedAt }, at);
}

export const markWaiting = (capsule: RelayAgentExecutionCapsule, at: string) =>
  lifecycleTransition(capsule, 'waiting', at, 'marking a run waiting');

export const markStalled = (capsule: RelayAgentExecutionCapsule, at: string) =>
  lifecycleTransition(capsule, 'stalled', at, 'marking a run stalled');

function lifecycleTransition(
  capsule: RelayAgentExecutionCapsule,
  next: RelayAgentExecutionCapsuleStatus,
  at: string,
  operation: string,
): CapsuleResult<RelayAgentExecutionCapsule> {
  const guard = terminalGuard(capsule, operation);
  if (guard) return capsuleFail(guard);
  return transition(capsule, next, {}, at);
}

export function recordHeartbeat(
  capsule: RelayAgentExecutionCapsule,
  at: string,
): CapsuleResult<RelayAgentExecutionCapsule> {
  const guard = terminalGuard(capsule, 'recording a heartbeat');
  if (guard) return capsuleFail(guard);
  if (capsule.identity.kind !== 'verified') {
    return capsuleFail(
      capsuleError(
        'LAUNCH_NOT_VERIFIED',
        'only a verified run produces heartbeats',
        'verify the launch first',
        { capsuleId: capsule.capsuleId, field: 'lastHeartbeatAt' },
      ),
    );
  }
  if (capsule.lastHeartbeatAt && at < capsule.lastHeartbeatAt) {
    return capsuleFail(
      capsuleError(
        'INVALID_TIMESTAMP_ORDER',
        'a heartbeat cannot precede the previous heartbeat',
        'supply a monotonic heartbeat timestamp',
        {
          capsuleId: capsule.capsuleId,
          field: 'lastHeartbeatAt',
          expected: `>= ${capsule.lastHeartbeatAt}`,
          actual: at,
        },
      ),
    );
  }
  return commit(capsule, { lastHeartbeatAt: at }, at);
}

/** Pure liveness evaluation against an INJECTED clock — the domain never
    reads an ambient clock, so `now` is always supplied by the caller. */
export function evaluateHeartbeatLiveness(
  capsule: RelayAgentExecutionCapsule,
  now: string,
  stallThresholdMs: number,
): { stalled: boolean; silentForMs: number | null; reason: string } {
  const last = capsule.lastHeartbeatAt ?? capsule.startedAt;
  if (!last) return { stalled: false, silentForMs: null, reason: 'the run has not started' };
  const silentForMs = Date.parse(now) - Date.parse(last);
  if (!Number.isFinite(silentForMs)) {
    return { stalled: false, silentForMs: null, reason: 'timestamps are not comparable' };
  }
  return silentForMs > stallThresholdMs
    ? {
        stalled: true,
        silentForMs,
        reason: `no heartbeat for ${silentForMs}ms, beyond the ${stallThresholdMs}ms threshold`,
      }
    : { stalled: false, silentForMs, reason: 'the run is within its heartbeat threshold' };
}

/* --------------------------------------------------- trace + references */

export interface AppendTraceReferenceInput {
  channel: TraceReferenceChannel;
  reference: TraceReferenceInput;
  at: string;
}

/** Builds, validates, and appends ONE trace reference. Agent-authored
    supervisory events and duplicate event ids are rejected. */
export function appendCapsuleTraceReference(
  capsule: RelayAgentExecutionCapsule,
  input: AppendTraceReferenceInput,
): CapsuleResult<RelayAgentExecutionCapsule> {
  const guard = terminalGuard(capsule, 'appending a trace reference');
  if (guard) return capsuleFail(guard);

  const built = createTraceReference(input.reference, {
    subjectAgentIds: identitySubjectAgentIds(capsule.identity),
  });
  if (!built.ok) return capsuleFail({ ...built.error, capsuleId: capsule.capsuleId });

  const appended = appendTraceReference(capsule.traceReferences, input.channel, built.value);
  if (!appended.ok) return capsuleFail({ ...appended.error, capsuleId: capsule.capsuleId });

  return commit(capsule, { traceReferences: appended.value }, input.at);
}

export function attachEvidenceId(
  capsule: RelayAgentExecutionCapsule,
  evidenceId: string,
  at: string,
): CapsuleResult<RelayAgentExecutionCapsule> {
  const guard = terminalGuard(capsule, 'attaching evidence');
  if (guard) return capsuleFail(guard);
  const appended = appendEvidenceId(capsule.evidenceIds, evidenceId, capsule.capsuleId);
  if (!appended.ok) return capsuleFail(appended.error);
  return commit(capsule, { evidenceIds: appended.value }, at);
}

/**
 * Cost receipts are the ONE post-terminal attachment: economics reconciles
 * after a run ends (Milestone 5). Nothing else about a terminal capsule may
 * change, and a missing receipt stays missing — never $0.
 */
export function attachCostReceiptId(
  capsule: RelayAgentExecutionCapsule,
  costReceiptId: string,
  at: string,
): CapsuleResult<RelayAgentExecutionCapsule> {
  const appended = appendCostReceiptId(capsule.costReceiptIds, costReceiptId, capsule.capsuleId);
  if (!appended.ok) return capsuleFail(appended.error);
  return commit(capsule, { costReceiptIds: appended.value }, at);
}

/* --------------------------------------------------- reports and claims */

export function attachPartialOutput(
  capsule: RelayAgentExecutionCapsule,
  partialOutput: CapsulePartialOutputReference,
  at: string,
): CapsuleResult<RelayAgentExecutionCapsule> {
  const guard = terminalGuard(capsule, 'attaching partial output');
  if (guard) return capsuleFail(guard);
  return commit(capsule, { partialOutput }, at);
}

export function attachFinalReport(
  capsule: RelayAgentExecutionCapsule,
  finalReport: CapsuleFinalReportReference,
  at: string,
): CapsuleResult<RelayAgentExecutionCapsule> {
  const guard = terminalGuard(capsule, 'attaching a final report');
  if (guard) return capsuleFail(guard);
  return commit(capsule, { finalReport }, at);
}

export function attachCompletionClaim(
  capsule: RelayAgentExecutionCapsule,
  completionClaim: CapsuleCompletionClaimReference,
  at: string,
): CapsuleResult<RelayAgentExecutionCapsule> {
  const guard = terminalGuard(capsule, 'attaching a completion claim');
  if (guard) return capsuleFail(guard);
  return commit(capsule, { completionClaim }, at);
}

/* ------------------------------------------------------ terminal states */

export interface CompleteCapsuleInput {
  at: string;
  finalReport?: CapsuleFinalReportReference;
  completionClaim?: CapsuleCompletionClaimReference;
}

/**
 * Marks the process complete. This says the run FINISHED and reported — it
 * never sets mission outcome, verification, or release, which remain
 * Milestone 1 decisions driven by evidence and independent review.
 */
export function markCompleted(
  capsule: RelayAgentExecutionCapsule,
  input: CompleteCapsuleInput,
): CapsuleResult<RelayAgentExecutionCapsule> {
  const guard = terminalGuard(capsule, 'completing a run');
  if (guard) return capsuleFail(guard);
  return transition(
    capsule,
    'completed',
    {
      ...(input.finalReport ? { finalReport: input.finalReport } : {}),
      ...(input.completionClaim ? { completionClaim: input.completionClaim } : {}),
      finishedAt: input.at,
    },
    input.at,
  );
}

export interface TerminateCapsuleInput {
  at: string;
  /** Preserved recoverable work — cancellation, failure, timeout, and loss of
      control all keep whatever was captured. */
  partialOutput?: CapsulePartialOutputReference;
  reason?: string;
}

function terminate(
  capsule: RelayAgentExecutionCapsule,
  next: RelayAgentExecutionCapsuleStatus,
  input: TerminateCapsuleInput,
  operation: string,
): CapsuleResult<RelayAgentExecutionCapsule> {
  const guard = terminalGuard(capsule, operation);
  if (guard) return capsuleFail(guard);
  return transition(
    capsule,
    next,
    {
      ...(input.partialOutput ? { partialOutput: input.partialOutput } : {}),
      finishedAt: input.at,
    },
    input.at,
  );
}

export const markFailed = (capsule: RelayAgentExecutionCapsule, input: TerminateCapsuleInput) =>
  terminate(capsule, 'failed', input, 'failing a run');

export const markCancelled = (capsule: RelayAgentExecutionCapsule, input: TerminateCapsuleInput) =>
  terminate(capsule, 'cancelled', input, 'cancelling a run');

export const markTimedOut = (capsule: RelayAgentExecutionCapsule, input: TerminateCapsuleInput) =>
  terminate(capsule, 'timed_out', input, 'timing out a run');

/** Relay can no longer prove control of, or communication with, a previously
    active external process. It is NOT a completion and NOT a plain failure —
    nothing is inferred about what the agent did after contact was lost. */
export const markOrphaned = (capsule: RelayAgentExecutionCapsule, input: TerminateCapsuleInput) =>
  terminate(capsule, 'orphaned', input, 'orphaning a run');

/* ------------------------------------------------------------- helpers */

/** Convenience for tests/fixtures: the trace reference the capsule stored. */
export function findTraceReference(
  capsule: RelayAgentExecutionCapsule,
  channel: TraceReferenceChannel,
  eventId: string,
): TraceReference | undefined {
  return capsule.traceReferences[channel].find((reference) => reference.eventId === eventId);
}
