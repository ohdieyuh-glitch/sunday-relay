import {
  ACTIVE_CONNECTION_STATES,
  BLOCKING_CONNECTION_STATES,
  CODING_AGENT_CAPABILITIES,
  type CodingAgentCapability,
  type CodingAgentConnectionState,
  type CodingAgentRuntimeRecord,
} from './coding-agent-contracts';

/**
 * THE ONE CODING-AGENT RUNTIME PROJECTION — rendered identically by the
 * website's Coding Agent panel and by `relay mission coding-agent status`.
 * Every operator-facing string is worded here once, so the two surfaces
 * cannot drift and neither can invent a claim.
 *
 * Three truths it enforces:
 *   - `Connected` appears only for a verified launch;
 *   - a value the runtime never reported prints `Unknown`, never a default,
 *     never a zero;
 *   - a disconnection is never rendered as a completion.
 */

export const CONNECTION_STATE_LABEL: Readonly<Record<CodingAgentConnectionState, string>> =
  Object.freeze({
    not_connected: 'Not connected',
    bridge_required: 'Relay Bridge required',
    preparing: 'Preparing',
    connected: 'Connected',
    completed: 'Completed',
    stopped: 'Stopped',
    disconnected: 'Disconnected',
    blocked: 'Blocked',
  });

export const UNKNOWN_LABEL = 'Unknown';
/** The static deployment hosts no Relay Bridge, so it can launch nothing. */
export const BRIDGE_REQUIRED_LABEL =
  'The Relay Bridge is required to run a Coding Agent. Not available in offline demo.';
export const SIMULATED_RUNTIME_LABEL =
  'SIMULATED CODING AGENT — DEMO SIMULATION — NO CLAUDE CODE PROCESS RAN';

export interface CodingAgentView {
  readonly present: boolean;
  /** e.g. `Claude Code · Connected` or `Claude Code · Not connected`. */
  readonly summary: string;
  readonly connectionState: CodingAgentConnectionState;
  readonly connectionLabel: string;
  readonly requestedRuntime: string;
  readonly actualRuntime: string;
  readonly versionLabel: string;
  readonly modelLabel: string;
  readonly executionModeLabel: string;
  readonly launchVerified: boolean;
  readonly elapsedLabel: string;
  readonly filesChangedLabel: string;
  readonly filesChanged: readonly string[];
  readonly commandsLabel: string;
  readonly testsLabel: string;
  readonly usageLabel: string;
  readonly cancellationLabel: string;
  readonly outcomeLabel: string;
  readonly capabilityLabels: readonly string[];
  readonly blocking: boolean;
  readonly active: boolean;
  /** Whether a surface may offer a Start control at all. */
  readonly canStart: boolean;
  readonly canStop: boolean;
  readonly disclosure: string | null;
}

export interface CodingAgentProjectionOptions {
  /** True in the static deployment: no bridge, so nothing can launch. */
  readonly bridgeAvailable?: boolean;
  readonly simulated?: boolean;
  /** Injected so elapsed time is deterministic and testable. */
  readonly nowIso?: string;
}

const CAPABILITY_LABEL: Readonly<Record<CodingAgentCapability, string>> = Object.freeze({
  supportsLiveExecution: 'Live execution',
  supportsStreaming: 'Streaming',
  supportsCancellation: 'Cancellation',
  supportsToolEvidence: 'Tool evidence',
  supportsFileEvidence: 'File evidence',
  supportsUsage: 'Usage reporting',
  supportsSessionRecovery: 'Session recovery',
  supportsStructuredOutput: 'Structured output',
});

function elapsed(startedAt: string | null, endedAt: string | null, nowIso?: string): string {
  if (startedAt === null) return UNKNOWN_LABEL;
  const start = Date.parse(startedAt);
  const end = endedAt !== null ? Date.parse(endedAt) : nowIso !== undefined ? Date.parse(nowIso) : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return UNKNOWN_LABEL;
  const seconds = Math.floor((end - start) / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/**
 * Project the runtime record — or its absence — into the single view both
 * surfaces render. `record === null` with no bridge yields the honest
 * bridge-required state, never a fabricated runtime.
 */
export function projectCodingAgentRuntime(
  record: CodingAgentRuntimeRecord | null,
  options: CodingAgentProjectionOptions = {},
): CodingAgentView {
  const bridgeAvailable = options.bridgeAvailable === true;
  const simulated = options.simulated === true;

  if (record === null) {
    const state: CodingAgentConnectionState = bridgeAvailable ? 'not_connected' : 'bridge_required';
    return {
      present: false,
      summary: `Claude Code · ${CONNECTION_STATE_LABEL[state]}`,
      connectionState: state,
      connectionLabel: CONNECTION_STATE_LABEL[state],
      requestedRuntime: 'Claude Code',
      actualRuntime: UNKNOWN_LABEL,
      versionLabel: UNKNOWN_LABEL,
      modelLabel: UNKNOWN_LABEL,
      executionModeLabel: simulated ? 'Simulated' : bridgeAvailable ? 'Offline' : 'Offline',
      launchVerified: false,
      elapsedLabel: UNKNOWN_LABEL,
      filesChangedLabel: 'None recorded',
      filesChanged: [],
      commandsLabel: 'None recorded',
      testsLabel: UNKNOWN_LABEL,
      usageLabel: UNKNOWN_LABEL,
      cancellationLabel: 'Not requested',
      outcomeLabel: bridgeAvailable ? 'No run has started.' : BRIDGE_REQUIRED_LABEL,
      capabilityLabels: [],
      blocking: false,
      active: false,
      // With no bridge a surface must NOT offer to launch anything.
      canStart: bridgeAvailable,
      canStop: false,
      disclosure: simulated ? SIMULATED_RUNTIME_LABEL : null,
    };
  }

  const { identity, evidence, usage } = record;
  const isSimulated = simulated || record.provenance === 'simulated';
  const blocking = BLOCKING_CONNECTION_STATES.includes(record.connectionState);
  const active = ACTIVE_CONNECTION_STATES.includes(record.connectionState);

  const outcomeLabel = (() => {
    if (record.connectionState === 'disconnected') {
      // A disconnection is NEVER phrased as a completion.
      return record.disconnectionReason ?? 'Relay can no longer confirm the Coding Agent process.';
    }
    if (record.connectionState === 'blocked') {
      return record.blockedReason ?? 'The Coding Agent is blocked.';
    }
    if (record.connectionState === 'stopped') {
      return record.terminationConfirmed
        ? 'Stopped. Termination confirmed and mission work preserved.'
        : 'Stop requested — termination is not yet confirmed.';
    }
    if (record.connectionState === 'completed') {
      return record.exitCode === 0
        ? 'The process exited successfully and Relay recorded the evidence.'
        : `The process exited with code ${record.exitCode ?? UNKNOWN_LABEL}.`;
    }
    if (active) return 'Working in the isolated mission worktree.';
    return 'No run has started.';
  })();

  return {
    present: true,
    summary: `${identity.actualRuntime ?? identity.requestedRuntime} · ${CONNECTION_STATE_LABEL[record.connectionState]}`,
    connectionState: record.connectionState,
    connectionLabel: CONNECTION_STATE_LABEL[record.connectionState],
    requestedRuntime: identity.requestedRuntime,
    actualRuntime: identity.actualRuntime ?? UNKNOWN_LABEL,
    versionLabel: identity.runtimeVersion ?? UNKNOWN_LABEL,
    // The model is Unknown unless the runtime itself reported one.
    modelLabel: identity.actualModel ?? UNKNOWN_LABEL,
    executionModeLabel:
      identity.executionMode === 'live' ? 'Live'
        : identity.executionMode === 'simulated' ? 'Simulated' : 'Offline',
    launchVerified: identity.launchVerified,
    elapsedLabel: elapsed(record.startedAt, record.endedAt, options.nowIso),
    filesChangedLabel: evidence.filesChanged.length === 0
      ? 'None recorded'
      : `${evidence.filesChanged.length} changed`,
    filesChanged: evidence.filesChanged,
    commandsLabel: `${evidence.commandsCompleted} of ${evidence.commandsStarted} completed`,
    testsLabel: evidence.testStatus === 'unknown'
      ? UNKNOWN_LABEL
      : `${evidence.testStatus} (${evidence.testsRun} run)`,
    // Unknown usage stays Unknown. It never becomes zero.
    usageLabel: usage.source === 'unavailable' || usage.inputTokens === null
      ? UNKNOWN_LABEL
      : `${usage.inputTokens} in / ${usage.outputTokens ?? UNKNOWN_LABEL} out`,
    cancellationLabel: record.cancellationRequested
      ? record.terminationConfirmed ? 'Requested — termination confirmed' : 'Requested — awaiting confirmation'
      : 'Not requested',
    outcomeLabel,
    capabilityLabels: CODING_AGENT_CAPABILITIES
      .filter((c) => record.capabilities[c])
      .map((c) => CAPABILITY_LABEL[c]),
    blocking,
    active,
    canStart: !active && bridgeAvailable,
    canStop: active,
    disclosure: isSimulated ? SIMULATED_RUNTIME_LABEL : null,
  };
}

/** The lines `relay mission coding-agent status` prints — from the SAME view
    the website renders, so the surfaces provably agree. */
export function renderCodingAgentStatusLines(
  missionId: string,
  view: CodingAgentView,
): string[] {
  const lines: string[] = [`CODING AGENT — ${missionId}`];
  if (view.disclosure !== null) lines.push(view.disclosure);
  lines.push(`  Runtime:      ${view.requestedRuntime} (requested)`);
  lines.push(`  Actual:       ${view.actualRuntime}`);
  lines.push(`  Version:      ${view.versionLabel}`);
  lines.push(`  Model:        ${view.modelLabel}`);
  lines.push(`  Connection:   ${view.connectionLabel}`);
  lines.push(`  Launch:       ${view.launchVerified ? 'verified' : 'not verified'}`);
  lines.push(`  Mode:         ${view.executionModeLabel}`);
  lines.push(`  Elapsed:      ${view.elapsedLabel}`);
  lines.push(`  Commands:     ${view.commandsLabel}`);
  lines.push(`  Files:        ${view.filesChangedLabel}`);
  lines.push(`  Tests:        ${view.testsLabel}`);
  lines.push(`  Usage:        ${view.usageLabel}`);
  lines.push(`  Cancellation: ${view.cancellationLabel}`);
  lines.push(`  Outcome:      ${view.outcomeLabel}`);
  return lines;
}

/* --------------------------------------------------------- notifications */

/**
 * The exact notification wording, defined once so no surface invents a
 * phrase and nothing can announce a state that has not been verified.
 */
export const CODING_AGENT_NOTIFICATIONS = Object.freeze({
  started: {
    title: 'Coding Agent started',
    body: 'Claude Code is working in an isolated mission worktree.',
  },
  completed: {
    title: 'Coding Agent completed',
    body: 'Claude Code returned a result and Relay recorded the evidence.',
  },
  stopped: {
    title: 'Coding Agent stopped',
    body: 'Claude Code was stopped. Mission work remains preserved.',
  },
  disconnected: {
    title: 'Coding Agent disconnected',
    body: 'Relay can no longer confirm the Claude Code process.',
  },
});

/**
 * Which notification (if any) a state transition earns. `started` requires a
 * VERIFIED launch, `completed` requires an exit plus captured evidence, and
 * `stopped` requires confirmed termination — so no announcement can outrun
 * the fact it describes.
 */
export function notificationForRuntime(
  record: CodingAgentRuntimeRecord,
): { key: string; title: string; body: string; kind: 'info' | 'success' | 'warning' | 'critical' } | null {
  const base = `coding-agent:${record.missionId}:${record.identity.runId ?? 'no-run'}`;
  switch (record.connectionState) {
    case 'connected':
      if (!record.identity.launchVerified) return null;
      return { key: `${base}:started`, ...CODING_AGENT_NOTIFICATIONS.started, kind: 'info' };
    case 'completed':
      if (record.processState !== 'exited') return null;
      return { key: `${base}:completed`, ...CODING_AGENT_NOTIFICATIONS.completed, kind: 'success' };
    case 'stopped':
      if (!record.terminationConfirmed) return null;
      return { key: `${base}:stopped`, ...CODING_AGENT_NOTIFICATIONS.stopped, kind: 'warning' };
    case 'disconnected':
      return {
        key: `${base}:disconnected`,
        title: CODING_AGENT_NOTIFICATIONS.disconnected.title,
        body: record.disconnectionReason ?? CODING_AGENT_NOTIFICATIONS.disconnected.body,
        kind: 'critical',
      };
    case 'blocked':
      return {
        key: `${base}:blocked`,
        title: 'Coding Agent blocked',
        body: record.blockedReason ?? 'The Coding Agent cannot continue.',
        kind: 'critical',
      };
    default:
      return null;
  }
}
