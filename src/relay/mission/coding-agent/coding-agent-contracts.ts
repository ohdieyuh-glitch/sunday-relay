/**
 * THE CANONICAL CODING-AGENT RUNTIME RECORD.
 *
 * Sunday Relay already has a real, offline-proven Claude Code connector
 * (`src/relay/connectors/claude-code/`): it launches the actual CLI with an
 * argument array, restricts tools, isolates settings and MCP, bounds runtime
 * and output, confirms termination, captures and resumes sessions, and omits
 * hidden reasoning. What it did not have is a MISSION-FACING, durable,
 * provider-neutral record of what is running — the thing the website, the
 * CLI and recovery all need to agree about.
 *
 * This is that record. It is pure domain (no Node, no process, no clock) so
 * the browser can render a runtime it can never launch, and it is
 * deliberately NOT Claude-specific: Claude Code is one implementation of the
 * capability set below, and a second runtime would fill in the same fields.
 *
 * THE RULE THAT SHAPES EVERY FIELD: requested and actual are separate. A
 * mission asks for a runtime and a model; only the process itself can say
 * what actually ran. Anything Relay has not observed is `null`, and `null`
 * renders as `Unknown` — never as a default, never inferred from a
 * subscription or a local setting.
 */

export const CODING_AGENT_RUNTIME_SCHEMA_V1 = 'relay-coding-agent-runtime.v1' as const;
export const CODING_AGENT_RUNTIME_SCHEMA_VERSION = CODING_AGENT_RUNTIME_SCHEMA_V1;
export const SUPPORTED_CODING_AGENT_SCHEMA_VERSIONS = [CODING_AGENT_RUNTIME_SCHEMA_V1] as const;
export type CodingAgentSchemaVersion = (typeof SUPPORTED_CODING_AGENT_SCHEMA_VERSIONS)[number];

/**
 * Capabilities an adapter may advertise. An adapter must advertise only what
 * it has PROVEN — the Claude binding derives these from the installed CLI's
 * own `--help`, not from a hard-coded list.
 */
export const CODING_AGENT_CAPABILITIES = [
  'supportsLiveExecution',
  'supportsStreaming',
  'supportsCancellation',
  'supportsToolEvidence',
  'supportsFileEvidence',
  'supportsUsage',
  'supportsSessionRecovery',
  'supportsStructuredOutput',
] as const;
export type CodingAgentCapability = (typeof CODING_AGENT_CAPABILITIES)[number];

export type CodingAgentCapabilities = Readonly<Record<CodingAgentCapability, boolean>>;

export const NO_CAPABILITIES: CodingAgentCapabilities = Object.freeze({
  supportsLiveExecution: false,
  supportsStreaming: false,
  supportsCancellation: false,
  supportsToolEvidence: false,
  supportsFileEvidence: false,
  supportsUsage: false,
  supportsSessionRecovery: false,
  supportsStructuredOutput: false,
});

/**
 * Connection state. `not_connected` is the honest default and the state the
 * static deployment always shows — a runtime is never `connected` until a
 * process actually launched AND the adapter verified it.
 */
export const CODING_AGENT_CONNECTION_STATES = [
  'not_connected',
  'bridge_required',
  'preparing',
  'connected',
  'completed',
  'stopped',
  'disconnected',
  'blocked',
] as const;
export type CodingAgentConnectionState = (typeof CODING_AGENT_CONNECTION_STATES)[number];

/** What Relay knows about the OS process. */
export const CODING_AGENT_PROCESS_STATES = [
  'none', 'starting', 'running', 'exited', 'terminated', 'unknown',
] as const;
export type CodingAgentProcessState = (typeof CODING_AGENT_PROCESS_STATES)[number];

export const CODING_AGENT_EXECUTION_MODES = ['live', 'simulated', 'offline'] as const;
export type CodingAgentExecutionMode = (typeof CODING_AGENT_EXECUTION_MODES)[number];

/** Runtime identity: what was asked for versus what actually ran. */
export interface CodingAgentIdentity {
  /** e.g. 'Claude Code' — what the Mission Contract asked for. */
  readonly requestedRuntime: string;
  /** Observed only after a verified launch. `null` = Unknown. */
  readonly actualRuntime: string | null;
  readonly adapterId: string;
  /** The installed CLI version the probe actually read. `null` = Unknown. */
  readonly runtimeVersion: string | null;
  /** A model the mission requested, when it named one. */
  readonly requestedModel: string | null;
  /**
   * The model the RUNTIME ITSELF reported. Never inferred from a
   * subscription, a setting or a default — if the runtime does not say,
   * this stays null and the surface prints Unknown.
   */
  readonly actualModel: string | null;
  readonly executionMode: CodingAgentExecutionMode;
  /** Relay's own run identifier, never an external provider session id. */
  readonly runId: string | null;
  /** Redacted tail of a provider session id, when one was captured. */
  readonly sessionRefRedacted: string | null;
  /** True only after the adapter observed the process start. */
  readonly launchVerified: boolean;
}

/** Evidence gathered from PROCESS and GIT — never from the agent's prose. */
export interface CodingAgentEvidence {
  readonly commandsStarted: number;
  readonly commandsCompleted: number;
  /** From Relay's own worktree inspection, not from the agent's claim. */
  readonly filesChanged: readonly string[];
  readonly testsRun: number;
  readonly testStatus: 'passed' | 'failed' | 'not_run' | 'unknown';
  /** Bounded references — large output is referenced, never copied here. */
  readonly outputRefs: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly warnings: readonly string[];
}

/** Usage as REPORTED by the runtime. Unknown stays unknown. */
export interface CodingAgentUsage {
  /** `null` when the runtime did not report trustworthy usage. */
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  /** Relay does not estimate cost. Either the runtime reported it or null. */
  readonly reportedCostMicros: string | null;
  readonly currency: string | null;
  /** Where the numbers came from, so nothing can pass as measured. */
  readonly source: 'runtime_reported' | 'unavailable';
}

export const UNKNOWN_USAGE: CodingAgentUsage = Object.freeze({
  inputTokens: null,
  outputTokens: null,
  reportedCostMicros: null,
  currency: null,
  source: 'unavailable',
});

export interface CodingAgentRuntimeRecord {
  readonly schemaVersion: CodingAgentSchemaVersion;
  readonly missionId: string;
  readonly projectId: string;
  readonly identity: CodingAgentIdentity;
  readonly capabilities: CodingAgentCapabilities;
  readonly connectionState: CodingAgentConnectionState;
  readonly processState: CodingAgentProcessState;
  /** The isolated worktree this runtime is bound to. A reference, not a copy. */
  readonly worktreeRef: string | null;
  readonly startedAt: string | null;
  readonly lastEventAt: string | null;
  readonly endedAt: string | null;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly cancellationRequested: boolean;
  /** Confirmed only when the adapter observed the process actually stop. */
  readonly terminationConfirmed: boolean;
  readonly evidence: CodingAgentEvidence;
  readonly usage: CodingAgentUsage;
  /** Exactly why Relay cannot confirm the process, when it cannot. */
  readonly disconnectionReason: string | null;
  /** Exactly why the runtime is blocked, when it is. */
  readonly blockedReason: string | null;
  readonly provenance: 'live' | 'simulated' | 'offline';
  readonly updatedAt: string;
  readonly checksum: string;
}

export type CodingAgentRuntimeRecordDraft = Omit<CodingAgentRuntimeRecord, 'checksum'>;

/** Connection states that mean a process may actually be alive right now. */
export const ACTIVE_CONNECTION_STATES: readonly CodingAgentConnectionState[] = [
  'preparing', 'connected',
];

/** States that must stay visible until the user acts. */
export const BLOCKING_CONNECTION_STATES: readonly CodingAgentConnectionState[] = [
  'disconnected', 'blocked',
];
