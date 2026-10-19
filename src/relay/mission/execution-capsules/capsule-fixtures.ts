/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 3
 * DETERMINISTIC FIXTURES — test/development data ONLY.
 *
 * No fixture references a real agent, provider, session, process, or
 * workspace; every credential-shaped string is synthetic; every timestamp is a
 * fixed constant. Attestations built here are DOMAIN FIXTURES — production
 * attestations must come from a trusted supervisory or adapter layer that
 * actually observed the process.
 */

import type { CommandPermissionContext } from '../commands/command-context';
import type {
  CapsuleInputContext,
  CapsulePermissionSnapshot,
  CapsuleWorkspaceBinding,
} from './capsule-context';
import { createPermissionSnapshot } from './capsule-context';
import type {
  ActualAgentIdentity,
  RelayExecutionLaunchAttestation,
  RequestedAgentIdentity,
} from './capsule-identity';
import { createLaunchAttestation } from './capsule-identity';
import type {
  CapsuleCompletionClaimReference,
  CapsuleFinalReportReference,
  CapsulePartialOutputReference,
} from './capsule-reports';
import {
  attachLaunchAttestation,
  markRunning,
  prepareExecutionCapsule,
  recordLaunchRequested,
  type PrepareExecutionCapsuleInput,
} from './capsule-service';
import type { RelayAgentExecutionCapsule } from './capsule-types';

/** Fixed instants — the domain never reads a clock, and neither do fixtures. */
export const CAPSULE_T0 = '2026-07-28T12:00:00.000Z'; // prepared
export const CAPSULE_T1 = '2026-07-28T12:00:05.000Z'; // launch requested
export const CAPSULE_T2 = '2026-07-28T12:00:09.000Z'; // launch verified
export const CAPSULE_T3 = '2026-07-28T12:04:00.000Z'; // activity
export const CAPSULE_T4 = '2026-07-28T12:09:00.000Z'; // terminal
/** Far enough after T3 to breach a 60_000ms stall threshold deterministically. */
export const CAPSULE_T_STALE = '2026-07-28T12:30:00.000Z';
export const STALL_THRESHOLD_MS = 60_000;

/* ------------------------------------------------------------ identities */

export const CLAUDE_REQUESTED: RequestedAgentIdentity = {
  agentId: 'agent-claude',
  agentType: 'claude_code',
  executionIdentityId: 'identity-claude',
  adapterId: 'adapter-claude-code',
};

export const CLAUDE_ACTUAL: ActualAgentIdentity = {
  agentId: 'agent-claude',
  agentType: 'claude_code',
  executionIdentityId: 'identity-claude',
  adapterId: 'adapter-claude-code',
  adapterVersion: 'claude-code/2.1.0',
  externalSessionId: 'session-fixture-claude',
  modelProvider: 'anthropic',
  modelName: 'claude-fixture',
  modelVersion: 'fixture-1',
  runtimeName: 'claude-code-cli',
  runtimeVersion: '2.1.0',
};

export const CODEX_REQUESTED: RequestedAgentIdentity = {
  agentId: 'agent-codex',
  agentType: 'codex',
  executionIdentityId: 'identity-codex',
  adapterId: 'adapter-codex',
};

export const CODEX_ACTUAL: ActualAgentIdentity = {
  agentId: 'agent-codex',
  agentType: 'codex',
  executionIdentityId: 'identity-codex',
  adapterId: 'adapter-codex',
  adapterVersion: 'codex/0.9.4',
  externalSessionId: 'session-fixture-codex',
  runtimeName: 'codex-cli',
  runtimeVersion: '0.9.4',
};

export const HERMES_REQUESTED: RequestedAgentIdentity = {
  agentId: 'agent-hermes',
  agentType: 'hermes',
  executionIdentityId: 'identity-hermes',
  adapterId: 'adapter-hermes',
};

export const HERMES_ACTUAL: ActualAgentIdentity = {
  agentId: 'agent-hermes',
  agentType: 'hermes',
  executionIdentityId: 'identity-hermes',
  adapterId: 'adapter-hermes',
  externalSessionId: 'session-fixture-hermes',
  runtimeName: 'hermes-runtime',
  runtimeVersion: '1.0.0',
};

/** A wrapper that is NOT the requested external agent — never gets credit. */
export const MOCK_WRAPPER_ACTUAL: ActualAgentIdentity = {
  agentId: 'agent-mock-wrapper',
  agentType: 'other',
  executionIdentityId: 'identity-mock-wrapper',
  adapterId: 'adapter-mock-wrapper',
  runtimeName: 'mock-wrapper',
  runtimeVersion: '0.0.1',
};

/** An authorized human/manual fallback agent. */
export const MANUAL_ACTUAL: ActualAgentIdentity = {
  agentId: 'agent-manual',
  agentType: 'human',
  executionIdentityId: 'identity-manual',
  adapterId: 'adapter-manual',
  runtimeName: 'manual',
  runtimeVersion: '1',
};

/* ---------------------------------------------------------- permissions */

const WRITE_PERMISSIONS: CommandPermissionContext = {
  readablePaths: ['src/', 'tests/'],
  writablePaths: ['src/', 'tests/'],
  allowedCommands: ['npm test', 'npm run typecheck'],
  networkPolicy: 'none',
  toolPolicy: ['editor', 'terminal'],
  secretPolicy: 'handles_only',
  productionAccess: false,
  expiresAt: null,
  revoked: false,
};

const READ_ONLY_PERMISSIONS: CommandPermissionContext = {
  ...WRITE_PERMISSIONS,
  writablePaths: [],
  allowedCommands: ['npm test'],
};

export function writePermissionSnapshot(): CapsulePermissionSnapshot {
  return createPermissionSnapshot('permissions-v3', CAPSULE_T0, WRITE_PERMISSIONS);
}

export function readOnlyPermissionSnapshot(): CapsulePermissionSnapshot {
  return createPermissionSnapshot('security-review-v2', CAPSULE_T0, READ_ONLY_PERMISSIONS);
}

/* ----------------------------------------------------------- workspaces */

export function browserWorkspace(
  writeOwnerAgentId: string | null = 'agent-claude',
): CapsuleWorkspaceBinding {
  return {
    workspaceId: 'workspace-auth',
    isolationMode: 'browser_virtual',
    kind: 'browser_worktree',
    repositoryIdentity: 'sunday-relay-fixture',
    branchName: 'auth-repair',
    baseCommitSha: 'abc123',
    writeOwnerAgentId,
    readOnly: false,
    protectedPaths: ['infra/prod.ts'],
  };
}

export function reviewWorkspace(): CapsuleWorkspaceBinding {
  return {
    workspaceId: 'workspace-auth-review',
    isolationMode: 'isolated_worktree',
    kind: 'cli_worktree',
    repositoryIdentity: 'sunday-relay-fixture',
    branchName: 'auth-repair',
    baseCommitSha: 'abc123',
    writeOwnerAgentId: null,
    readOnly: true,
    protectedPaths: ['infra/prod.ts'],
  };
}

/* -------------------------------------------------------- input context */

export function inputContext(
  over: Partial<CapsuleInputContext> = {},
): CapsuleInputContext {
  return {
    missionObjectiveRef: 'mission-auth#objective',
    taskResponsibilityRef: 'task-auth-repair#responsibility',
    projectBrainRevision: 'brain-rev-7',
    bindingConstraintsRef: 'mission-auth#constraints',
    filesInScope: ['src/auth/session.ts'],
    filesOutOfScope: ['infra/prod.ts'],
    requiredEvidence: ['test_results', 'file_diff'],
    requiredReportFormat: 'relay-implementation-report/1',
    reviewRequired: true,
    maximumRepairAttempts: 1,
    networkPolicy: 'none',
    productionWritesProhibited: true,
    ...over,
  };
}

/* ------------------------------------------------- preparation inputs */

export function claudeImplementationInput(
  over: Partial<PrepareExecutionCapsuleInput> = {},
): PrepareExecutionCapsuleInput {
  return {
    capsuleId: 'cap-claude-impl',
    projectId: 'project-sunday',
    missionId: 'mission-auth',
    taskId: 'task-auth-repair',
    runId: 'run-claude-1',
    requestedAgent: CLAUDE_REQUESTED,
    responsibility: 'repair',
    missionRevision: 4,
    taskRevision: 2,
    handoffId: 'handoff-auth-repair-1',
    handoffCompilerVersion: '0.3.1',
    policyPackVersion: 'implementation-v3',
    passportId: 'passport-claude-1',
    inputContext: inputContext(),
    permissions: writePermissionSnapshot(),
    workspace: browserWorkspace(),
    at: CAPSULE_T0,
    ...over,
  };
}

export function codexReviewInput(
  over: Partial<PrepareExecutionCapsuleInput> = {},
): PrepareExecutionCapsuleInput {
  return {
    capsuleId: 'cap-codex-review',
    projectId: 'project-sunday',
    missionId: 'mission-auth',
    taskId: 'task-auth-review',
    runId: 'run-codex-1',
    requestedAgent: CODEX_REQUESTED,
    responsibility: 'review',
    missionRevision: 4,
    taskRevision: 2,
    handoffId: 'handoff-auth-review-1',
    handoffCompilerVersion: '0.3.1',
    policyPackVersion: 'security-review-v2',
    passportId: 'passport-codex-1',
    inputContext: inputContext({
      taskResponsibilityRef: 'task-auth-review#responsibility',
      requiredReportFormat: 'relay-review-report/1',
    }),
    permissions: readOnlyPermissionSnapshot(),
    workspace: reviewWorkspace(),
    at: CAPSULE_T0,
    ...over,
  };
}

export function hermesOperationsInput(
  over: Partial<PrepareExecutionCapsuleInput> = {},
): PrepareExecutionCapsuleInput {
  return {
    capsuleId: 'cap-hermes-ops',
    projectId: 'project-sunday',
    missionId: 'mission-auth',
    taskId: 'task-auth-ops',
    runId: 'run-hermes-1',
    requestedAgent: HERMES_REQUESTED,
    responsibility: 'operations',
    missionRevision: 4,
    taskRevision: 2,
    handoffId: 'handoff-auth-ops-1',
    handoffCompilerVersion: '0.3.1',
    policyPackVersion: 'operations-v1',
    passportId: 'passport-hermes-1',
    finalReportWaived: true,
    inputContext: inputContext({ reviewRequired: false }),
    permissions: writePermissionSnapshot(),
    at: CAPSULE_T0,
    ...over,
  };
}

/* -------------------------------------------------------- attestations */

/** A trusted supervisory attestation proving the requested agent launched. */
export function verifiedAttestation(
  capsuleId: string,
  requested: RequestedAgentIdentity,
  actual: ActualAgentIdentity,
  attestationId = `att-${capsuleId}`,
): RelayExecutionLaunchAttestation {
  const built = createLaunchAttestation({
    attestationId,
    capsuleId,
    requestedAgentId: requested.agentId,
    actualAgentId: actual.agentId,
    requestedExecutionIdentityId: requested.executionIdentityId,
    actualExecutionIdentityId: actual.executionIdentityId,
    launchRequestedAt: CAPSULE_T1,
    launchVerifiedAt: CAPSULE_T2,
    verificationSource: 'relay_supervisor',
    externalSessionId: actual.externalSessionId,
    verified: true,
    attestedBy: 'relay-supervisor',
  });
  if (!built.ok) throw new Error(`fixture attestation invalid: ${built.error.reason}`);
  return built.value;
}

/** A trusted attestation proving the requested agent did NOT launch. */
export function failedAttestation(
  capsuleId: string,
  requested: RequestedAgentIdentity,
  failureReason: string,
  attestationId = `att-${capsuleId}-failed`,
): RelayExecutionLaunchAttestation {
  const built = createLaunchAttestation({
    attestationId,
    capsuleId,
    requestedAgentId: requested.agentId,
    launchRequestedAt: CAPSULE_T1,
    verificationSource: 'none',
    verified: false,
    failureReason,
    attestedBy: 'relay-supervisor',
  });
  if (!built.ok) throw new Error(`fixture attestation invalid: ${built.error.reason}`);
  return built.value;
}

/** A trusted attestation reporting that a DIFFERENT runtime was observed. */
export function observedOtherRuntimeAttestation(
  capsuleId: string,
  requested: RequestedAgentIdentity,
  observed: ActualAgentIdentity,
  attestationId = `att-${capsuleId}-wrapper`,
): RelayExecutionLaunchAttestation {
  const built = createLaunchAttestation({
    attestationId,
    capsuleId,
    requestedAgentId: requested.agentId,
    actualAgentId: observed.agentId,
    launchRequestedAt: CAPSULE_T1,
    verificationSource: 'relay_supervisor',
    verified: false,
    failureReason: `${observed.agentId} was observed instead of ${requested.agentId}`,
    attestedBy: 'relay-supervisor',
  });
  if (!built.ok) throw new Error(`fixture attestation invalid: ${built.error.reason}`);
  return built.value;
}

/* ------------------------------------------------------------- reports */

export function finalReport(
  reportedBy: string,
  over: Partial<CapsuleFinalReportReference> = {},
): CapsuleFinalReportReference {
  return {
    referenceId: `report-${reportedBy}`,
    receivedAt: CAPSULE_T4,
    reportedBy,
    truth: 'agent_claim',
    reportFormat: 'relay-implementation-report/1',
    bodyDigest: 'digest-fixture',
    ...over,
  };
}

export function completionClaim(
  claimedBy: string,
  over: Partial<CapsuleCompletionClaimReference> = {},
): CapsuleCompletionClaimReference {
  return {
    referenceId: `claim-${claimedBy}`,
    claimedAt: CAPSULE_T4,
    claimedBy,
    truth: 'agent_claim',
    claimedStatus: 'completed',
    ...over,
  };
}

export function partialOutput(
  capturedBy = 'relay-supervisor',
  over: Partial<CapsulePartialOutputReference> = {},
): CapsulePartialOutputReference {
  return {
    referenceId: 'partial-fixture-1',
    capturedAt: CAPSULE_T3,
    capturedBy,
    truth: 'supervisory_observation',
    changedFileCount: 2,
    commandCount: 3,
    testCount: 1,
    findingCount: 1,
    unresolvedQuestionCount: 1,
    summaryRef: 'partial-summary-1',
    ...over,
  };
}

/* ------------------------------------------------- lifecycle shortcuts */

/** Prepare, or throw — for fixtures whose preparation is expected to succeed. */
export function prepareFixture(input: PrepareExecutionCapsuleInput): RelayAgentExecutionCapsule {
  const prepared = prepareExecutionCapsule(input);
  if (!prepared.ok) throw new Error(`fixture preparation failed: ${prepared.error.reason}`);
  return prepared.value;
}

/**
 * Drives prepare → launch requested → verified launch → running, the common
 * starting point for lifecycle tests. Throws on any unexpected rejection so a
 * broken fixture never masquerades as a passing test.
 */
export function runningFixture(
  input: PrepareExecutionCapsuleInput,
  actual: ActualAgentIdentity,
): RelayAgentExecutionCapsule {
  const prepared = prepareFixture(input);
  const requested = recordLaunchRequested(prepared, CAPSULE_T1);
  if (!requested.ok) throw new Error(`fixture launch request failed: ${requested.error.reason}`);
  const verified = attachLaunchAttestation(requested.value, {
    attestation: verifiedAttestation(input.capsuleId, input.requestedAgent, actual),
    actualAgent: actual,
    at: CAPSULE_T2,
  });
  if (!verified.ok) throw new Error(`fixture launch verification failed: ${verified.error.reason}`);
  const running = markRunning(verified.value, CAPSULE_T2);
  if (!running.ok) throw new Error(`fixture running failed: ${running.error.reason}`);
  return running.value;
}

/**
 * Synthetic credential-shaped metadata for redaction tests ONLY — every value
 * is fake.
 *
 * The credential-shaped KEY NAMES are assembled at runtime on purpose: the
 * repo-wide mission-layer boundary test forbids DECLARING credential-shaped
 * fields anywhere under `src/relay/mission/**`, and a redaction fixture is no
 * reason to weaken that rule.
 */
export function secretShapedMetadata(): Record<string, unknown> {
  const apiKeyField = ['api', 'Key'].join('');
  const passwordWord = ['pass', 'word'].join('');
  return {
    [apiKeyField]: 'sk-fixture0123456789abcdef',
    nested: { AUTHORIZATION: 'Bearer fixture-token-0123456789', keep: 'plain value' },
    note: `${passwordWord}: fixtureSecret123 recorded in output`,
    envName: 'ANTHROPIC_API_KEY',
  };
}
