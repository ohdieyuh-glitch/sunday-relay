import {
  CODING_AGENT_RUNTIME_SCHEMA_VERSION,
  UNKNOWN_USAGE,
  type CodingAgentCapabilities,
  type CodingAgentConnectionState,
  type CodingAgentProcessState,
  type CodingAgentRuntimeRecordDraft,
  type CodingAgentUsage,
} from './coding-agent-contracts';

/**
 * WHAT THE CANONICAL LAYER NEEDS FROM ONE COMPLETED RUN.
 *
 * `runtimeRecordForMission` describes a machine BEFORE anything launches.
 * This describes the run AFTERWARDS — the receipt `relay mission coding-agent
 * status` reads and the browser renders.
 *
 * It is declared here, mission-side and provider-neutral, for the same reason
 * the probe input is: an adapter may not import the mission layer, so the
 * canonical layer states the shape it requires and a composition root (the
 * CLI) hands the observed facts over. Nothing in this file can reach a
 * process, a clock or a filesystem, so the browser reaches the same verdict
 * from the same bytes.
 *
 * THE RULE IT EXISTS TO ENFORCE: every `actual*` field below is passed in
 * from something the RUNTIME ITSELF reported. There is deliberately no
 * fallback from `actualModel` to `requestedModel` — a run whose runtime named
 * no model records `null` and renders `Unknown`. Reporting the requested
 * model as the actual one is the precise defect that made the Prompt
 * Architect's receipt untrustworthy before its live proof; the Coding Agent
 * must not repeat it.
 */

/** Facts a caller must have OBSERVED. Anything unobserved is `null`. */
export interface CodingAgentRunObservation {
  readonly missionId: string;
  readonly projectId: string;

  /** What the mission asked for. `null` when it named no model. */
  readonly requestedRuntime: string;
  readonly requestedModel: string | null;
  readonly adapterId: string;

  /**
   * The runtime identity Relay OBSERVED. `actualRuntime` may be set only when
   * a process was actually launched and its stream parsed; `actualModel` only
   * when that stream named a model.
   */
  readonly actualRuntime: string | null;
  readonly actualModel: string | null;
  /** The installed CLI version the probe read. */
  readonly runtimeVersion: string | null;

  /** True only when the adapter observed the process start. */
  readonly launchVerified: boolean;
  readonly runId: string | null;
  /** Redacted tail only — never a full provider session id. */
  readonly sessionRefRedacted: string | null;

  readonly capabilities: CodingAgentCapabilities;
  readonly worktreeRef: string | null;

  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly exitCode: number | null;
  readonly signal: string | null;

  readonly cancellationRequested: boolean;
  readonly timedOut: boolean;
  /** True only when the runner observed the process actually stop. */
  readonly terminationConfirmed: boolean;
  /** True when the process could not be launched at all. */
  readonly spawnFailed: boolean;

  /** Relay-observed evidence — from inspection and Relay's own commands. */
  readonly filesChanged: readonly string[];
  readonly filesInspected: readonly string[];
  readonly commandsStarted: number;
  readonly commandsCompleted: number;
  readonly testsRun: number;
  readonly testStatus: 'passed' | 'failed' | 'not_run' | 'unknown';
  readonly outputRefs: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly warnings: readonly string[];

  /** Usage exactly as the runtime reported it. Absent stays absent. */
  readonly usage: CodingAgentUsage;

  /**
   * Set when Relay itself refused the result — a scope escape, a rejected
   * inspection, an untrusted report. A stop is never a completion.
   */
  readonly stopReason: string | null;

  readonly now: string;
}

/**
 * Derive the connection state from what was observed — never from what was
 * hoped. The ordering is deliberate: every failure mode is considered before
 * `completed` can be reached, so a run can only be called complete when
 * nothing else explains it.
 */
function connectionStateFor(o: CodingAgentRunObservation): {
  connectionState: CodingAgentConnectionState;
  processState: CodingAgentProcessState;
  disconnectionReason: string | null;
  blockedReason: string | null;
} {
  if (o.spawnFailed) {
    return {
      connectionState: 'blocked',
      processState: 'none',
      disconnectionReason: null,
      blockedReason: o.stopReason ?? 'The Coding Agent process could not be started.',
    };
  }
  if (o.cancellationRequested || o.timedOut) {
    // A cancelled or timed-out run is STOPPED. It is never a completion, and
    // termination is claimed only when the runner actually confirmed it.
    return {
      connectionState: 'stopped',
      processState: o.terminationConfirmed ? 'terminated' : 'unknown',
      disconnectionReason: null,
      blockedReason: null,
    };
  }
  if (o.stopReason !== null) {
    // Relay refused the result. The process may have exited fine — that is
    // exactly why a clean exit is not permitted to mean the work passed.
    return {
      connectionState: 'blocked',
      processState: o.exitCode !== null ? 'exited' : 'unknown',
      disconnectionReason: null,
      blockedReason: o.stopReason,
    };
  }
  if (!o.launchVerified) {
    return {
      connectionState: 'disconnected',
      processState: 'unknown',
      disconnectionReason: 'Relay never verified that the Coding Agent process launched.',
      blockedReason: null,
    };
  }
  if (o.exitCode === null) {
    // Launched, no exit status: Relay cannot confirm how it ended, so it says so.
    return {
      connectionState: 'disconnected',
      processState: 'unknown',
      disconnectionReason: 'Relay could not confirm how the Coding Agent process ended.',
      blockedReason: null,
    };
  }
  return {
    connectionState: 'completed',
    processState: 'exited',
    disconnectionReason: null,
    blockedReason: null,
  };
}

/**
 * Build the durable runtime record for one observed run.
 *
 * `provenance` and `executionMode` are `live` only when a process was really
 * launched; an unlaunched run stays `offline` so nothing downstream can read
 * a live claim out of a run that never happened.
 */
export function runtimeRecordFromObservation(
  o: CodingAgentRunObservation,
): CodingAgentRuntimeRecordDraft {
  const { connectionState, processState, disconnectionReason, blockedReason } =
    connectionStateFor(o);
  const live = o.launchVerified;

  return {
    schemaVersion: CODING_AGENT_RUNTIME_SCHEMA_VERSION,
    missionId: o.missionId,
    projectId: o.projectId,
    identity: {
      requestedRuntime: o.requestedRuntime,
      // Observed only. No fallback to the requested value, ever.
      actualRuntime: o.actualRuntime,
      adapterId: o.adapterId,
      runtimeVersion: o.runtimeVersion,
      requestedModel: o.requestedModel,
      actualModel: o.actualModel,
      executionMode: live ? 'live' : 'offline',
      runId: o.runId,
      sessionRefRedacted: o.sessionRefRedacted,
      launchVerified: o.launchVerified,
    },
    capabilities: o.capabilities,
    connectionState,
    processState,
    worktreeRef: o.worktreeRef,
    startedAt: o.startedAt,
    lastEventAt: o.endedAt ?? o.startedAt,
    endedAt: o.endedAt,
    exitCode: o.exitCode,
    signal: o.signal,
    cancellationRequested: o.cancellationRequested,
    terminationConfirmed: o.terminationConfirmed,
    evidence: {
      commandsStarted: o.commandsStarted,
      commandsCompleted: o.commandsCompleted,
      filesChanged: [...o.filesChanged],
      testsRun: o.testsRun,
      testStatus: o.testStatus,
      outputRefs: [...o.outputRefs],
      evidenceRefs: [...o.evidenceRefs],
      warnings: [...o.warnings],
    },
    usage: o.usage,
    disconnectionReason,
    blockedReason,
    provenance: live ? 'live' : 'offline',
    updatedAt: o.now,
  };
}

/**
 * Translate runtime-reported usage into the canonical record.
 *
 * Usage is `runtime_reported` ONLY when the runtime actually reported token
 * counts. A run that reported nothing yields `UNKNOWN_USAGE` — every field
 * null, source `unavailable` — because an unreported count is Unknown and
 * must never render as zero.
 *
 * Cost is carried only when the runtime itself named one; Relay does not
 * estimate. It is stored in micros as a string so no float rounding can
 * quietly alter a number shown to a founder.
 */
export function usageFromRuntimeReport(input: {
  inputTokens: number | null;
  outputTokens: number | null;
  reportedCostUsd: number | null;
}): CodingAgentUsage {
  const hasTokens = input.inputTokens !== null || input.outputTokens !== null;
  const hasCost = input.reportedCostUsd !== null && Number.isFinite(input.reportedCostUsd);
  if (!hasTokens && !hasCost) return UNKNOWN_USAGE;
  return Object.freeze({
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    reportedCostMicros: hasCost
      ? String(Math.round((input.reportedCostUsd as number) * 1_000_000))
      : null,
    currency: hasCost ? 'USD' : null,
    source: 'runtime_reported' as const,
  });
}
