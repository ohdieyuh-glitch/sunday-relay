import {
  CODING_AGENT_RUNTIME_SCHEMA_VERSION,
  NO_CAPABILITIES,
  UNKNOWN_USAGE,
  type CodingAgentCapabilities,
  type CodingAgentRuntimeRecordDraft,
} from './coding-agent-contracts';

/**
 * WHAT THE CANONICAL LAYER NEEDS FROM ANY RUNTIME PROBE.
 *
 * Declared HERE, on the mission side, and deliberately provider-neutral: an
 * adapter may never import the mission layer (adapters do not own mission
 * verdicts — `relay-core-boundary.test.ts` enforces it), so the canonical
 * layer states the shape it requires and a composition root hands it over.
 * The Claude Code probe happens to satisfy this shape structurally; a second
 * runtime would supply the same fields from its own probe.
 *
 * Every field is something a probe OBSERVED. Nothing here may be assumed.
 */
export interface CodingAgentProbeInput {
  /** Null when the runtime is not installed on this machine. */
  readonly executablePath: string | null;
  readonly version: string | null;
  readonly nonInteractiveSupported: boolean;
  readonly streamJsonSupported: boolean;
  readonly explicitResumeSupported: boolean;
  readonly structuredSchemaSupported: boolean;
  readonly cancellationSupported: boolean;
}

/**
 * Translate an observed probe into advertised capabilities. An absent
 * runtime advertises nothing, so a surface cannot offer to start it.
 */
export function capabilitiesFromProbe(probe: CodingAgentProbeInput): CodingAgentCapabilities {
  if (probe.executablePath === null) return NO_CAPABILITIES;
  return Object.freeze({
    supportsLiveExecution: probe.nonInteractiveSupported,
    supportsStreaming: probe.streamJsonSupported,
    supportsCancellation: probe.cancellationSupported,
    // Tool activity is observable only through streamed event records.
    supportsToolEvidence: probe.streamJsonSupported,
    // File evidence never comes from the runtime — Relay inspects the
    // worktree with git — so it holds whenever a run can happen at all.
    supportsFileEvidence: probe.nonInteractiveSupported,
    // Usage is reported only inside structured output.
    supportsUsage: probe.streamJsonSupported,
    supportsSessionRecovery: probe.explicitResumeSupported,
    supportsStructuredOutput: probe.structuredSchemaSupported,
  });
}

export interface CodingAgentAvailability {
  readonly installed: boolean;
  readonly version: string | null;
  readonly capabilities: CodingAgentCapabilities;
  readonly authorizedForLiveRun: boolean;
  /** Safe classification only — never an email, org, or token. */
  readonly authClass: string;
  /** Exactly why a live run cannot proceed, when it cannot. */
  readonly blockedReason: string | null;
}

/** Derive availability from an observed probe plus a safe auth class. */
export function availabilityFromProbe(input: {
  probe: CodingAgentProbeInput;
  authLoggedIn: boolean;
  authClass: string;
  authApprovedForLiveRun: boolean;
}): CodingAgentAvailability {
  const { probe } = input;
  const capabilities = capabilitiesFromProbe(probe);
  if (probe.executablePath === null) {
    return {
      installed: false,
      version: null,
      capabilities,
      authorizedForLiveRun: false,
      authClass: 'not_installed',
      blockedReason: 'The Coding Agent runtime is not installed on this machine.',
    };
  }
  const blockedReason = !probe.nonInteractiveSupported
    ? 'The installed runtime does not support non-interactive execution.'
    : !input.authLoggedIn
      ? 'Runtime authentication is unavailable.'
      : !input.authApprovedForLiveRun
        ? `Live runs require a logged-in first-party subscription (found: ${input.authClass}).`
        : null;
  return {
    installed: true,
    version: probe.version,
    capabilities,
    authorizedForLiveRun: input.authApprovedForLiveRun,
    authClass: input.authClass,
    blockedReason,
  };
}

/**
 * The runtime record for a mission BEFORE anything launches: what the
 * machine can do and, when a live run is impossible, exactly why — with
 * `launchVerified` false and both actual identities null, because nothing
 * has run.
 */
export function runtimeRecordForMission(input: {
  missionId: string;
  projectId: string;
  worktreeRef: string | null;
  requestedRuntime?: string;
  adapterId?: string;
  requestedModel?: string | null;
  availability: CodingAgentAvailability;
  now: string;
}): CodingAgentRuntimeRecordDraft {
  const { availability } = input;
  return {
    schemaVersion: CODING_AGENT_RUNTIME_SCHEMA_VERSION,
    missionId: input.missionId,
    projectId: input.projectId,
    identity: {
      requestedRuntime: input.requestedRuntime ?? 'Claude Code',
      actualRuntime: null,
      adapterId: input.adapterId ?? 'claude-code-local',
      runtimeVersion: availability.version,
      requestedModel: input.requestedModel ?? null,
      // NEVER inferred from a subscription or a local default.
      actualModel: null,
      executionMode: availability.authorizedForLiveRun ? 'live' : 'offline',
      runId: null,
      sessionRefRedacted: null,
      launchVerified: false,
    },
    capabilities: availability.capabilities,
    connectionState: availability.blockedReason === null ? 'not_connected' : 'blocked',
    processState: 'none',
    worktreeRef: input.worktreeRef,
    startedAt: null,
    lastEventAt: null,
    endedAt: null,
    exitCode: null,
    signal: null,
    cancellationRequested: false,
    terminationConfirmed: false,
    evidence: {
      commandsStarted: 0, commandsCompleted: 0, filesChanged: [],
      testsRun: 0, testStatus: 'unknown', outputRefs: [], evidenceRefs: [], warnings: [],
    },
    usage: UNKNOWN_USAGE,
    disconnectionReason: null,
    blockedReason: availability.blockedReason,
    provenance: availability.authorizedForLiveRun ? 'live' : 'offline',
    updatedAt: input.now,
  };
}
