import { digestOf } from '../durable/durable-digest';
import {
  CODING_AGENT_CONNECTION_STATES,
  CODING_AGENT_PROCESS_STATES,
  CODING_AGENT_RUNTIME_SCHEMA_VERSION,
  NO_CAPABILITIES,
  SUPPORTED_CODING_AGENT_SCHEMA_VERSIONS,
  UNKNOWN_USAGE,
  type CodingAgentRuntimeRecord,
  type CodingAgentRuntimeRecordDraft,
} from './coding-agent-contracts';

/**
 * Sealing, validation and the recovery classification for the coding-agent
 * runtime record. Pure — reuses the durable module's `digestOf` so a record
 * written by the CLI verifies byte-identically in the browser.
 */

export function sealCodingAgentRecord(
  draft: CodingAgentRuntimeRecordDraft | CodingAgentRuntimeRecord,
): CodingAgentRuntimeRecord {
  const { checksum: _stale, ...rest } = draft as CodingAgentRuntimeRecord;
  return { ...rest, checksum: digestOf(rest) };
}

export function codingAgentDraftFrom(
  record: CodingAgentRuntimeRecord,
): CodingAgentRuntimeRecordDraft {
  const { checksum: _checksum, ...rest } = record;
  return rest;
}

export function verifyCodingAgentChecksum(record: CodingAgentRuntimeRecord): boolean {
  const { checksum, ...rest } = record;
  return typeof checksum === 'string' && checksum.length > 0 && digestOf(rest) === checksum;
}

export type CodingAgentReadResult =
  | { readonly ok: true; readonly record: CodingAgentRuntimeRecord }
  | { readonly ok: false; readonly reason: 'not_found' }
  | { readonly ok: false; readonly reason: 'corrupt'; readonly detail: string }
  | { readonly ok: false; readonly reason: 'unsupported_version'; readonly detail: string };

function structurallyValid(value: unknown): value is CodingAgentRuntimeRecord {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v.missionId !== 'string' || v.missionId.length === 0) return false;
  if (typeof v.projectId !== 'string') return false;
  if (!CODING_AGENT_CONNECTION_STATES.includes(v.connectionState as never)) return false;
  if (!CODING_AGENT_PROCESS_STATES.includes(v.processState as never)) return false;
  const identity = v.identity as Record<string, unknown> | undefined;
  if (identity === undefined || identity === null || typeof identity !== 'object') return false;
  if (typeof identity.requestedRuntime !== 'string') return false;
  // requested and actual must remain SEPARATE fields, both present.
  if (identity.actualRuntime !== null && typeof identity.actualRuntime !== 'string') return false;
  if (identity.actualModel !== null && typeof identity.actualModel !== 'string') return false;
  if (typeof identity.launchVerified !== 'boolean') return false;
  const usage = v.usage as Record<string, unknown> | undefined;
  if (usage === undefined || usage === null || typeof usage !== 'object') return false;
  // Unknown usage must be explicitly null — never absent, never 0.
  if (usage.inputTokens !== null && typeof usage.inputTokens !== 'number') return false;
  if (usage.reportedCostMicros !== null && typeof usage.reportedCostMicros !== 'string') return false;
  if (typeof v.cancellationRequested !== 'boolean') return false;
  if (typeof v.terminationConfirmed !== 'boolean') return false;
  if (typeof v.checksum !== 'string') return false;
  return true;
}

export function readCodingAgentRecord(raw: unknown): CodingAgentReadResult {
  if (raw === null || raw === undefined) return { ok: false, reason: 'not_found' };
  if (typeof raw !== 'object') {
    return { ok: false, reason: 'corrupt', detail: 'stored value is not an object' };
  }
  const version = (raw as Record<string, unknown>).schemaVersion;
  if (typeof version !== 'string') {
    return { ok: false, reason: 'corrupt', detail: 'missing schema version' };
  }
  if (!(SUPPORTED_CODING_AGENT_SCHEMA_VERSIONS as readonly string[]).includes(version)) {
    return {
      ok: false,
      reason: 'unsupported_version',
      detail: `coding-agent record schema ${version} is not readable by this build (writes ${CODING_AGENT_RUNTIME_SCHEMA_VERSION})`,
    };
  }
  if (!structurallyValid(raw)) {
    return { ok: false, reason: 'corrupt', detail: 'record shape is not a coding-agent runtime record' };
  }
  if (!verifyCodingAgentChecksum(raw)) {
    return { ok: false, reason: 'corrupt', detail: 'checksum does not match record contents' };
  }
  return { ok: true, record: raw };
}

/** A truthful "nothing has run" record — the starting point for a mission. */
export function idleCodingAgentRecord(input: {
  missionId: string;
  projectId: string;
  requestedRuntime?: string;
  adapterId?: string;
  now: string;
}): CodingAgentRuntimeRecordDraft {
  return {
    schemaVersion: CODING_AGENT_RUNTIME_SCHEMA_VERSION,
    missionId: input.missionId,
    projectId: input.projectId,
    identity: {
      requestedRuntime: input.requestedRuntime ?? 'Claude Code',
      actualRuntime: null,
      adapterId: input.adapterId ?? 'claude-code-local',
      runtimeVersion: null,
      requestedModel: null,
      actualModel: null,
      executionMode: 'offline',
      runId: null,
      sessionRefRedacted: null,
      launchVerified: false,
    },
    capabilities: NO_CAPABILITIES,
    connectionState: 'not_connected',
    processState: 'none',
    worktreeRef: null,
    startedAt: null,
    lastEventAt: null,
    endedAt: null,
    exitCode: null,
    signal: null,
    cancellationRequested: false,
    terminationConfirmed: false,
    evidence: {
      commandsStarted: 0,
      commandsCompleted: 0,
      filesChanged: [],
      testsRun: 0,
      testStatus: 'unknown',
      outputRefs: [],
      evidenceRefs: [],
      warnings: [],
    },
    usage: UNKNOWN_USAGE,
    disconnectionReason: null,
    blockedReason: null,
    provenance: 'offline',
    updatedAt: input.now,
  };
}

/**
 * RECOVERY CLASSIFICATION after a restart.
 *
 * Relay never assumes an old process survived. Unless the caller can PROVE
 * the recorded process is still alive and still ours, an active-looking
 * record becomes `disconnected` with a truthful reason — never `completed`,
 * and never a silent relaunch.
 */
export function classifyRecoveredRuntime(input: {
  record: CodingAgentRuntimeRecord;
  /** True only when the caller verified the recorded process is still ours. */
  processStillOwned: boolean;
  now: string;
}): CodingAgentRuntimeRecordDraft {
  const { record, processStillOwned, now } = input;
  const wasActive = record.connectionState === 'connected' || record.connectionState === 'preparing';

  if (!wasActive) {
    // A finished run stays exactly as it was; its evidence is preserved.
    return { ...codingAgentDraftFrom(record), updatedAt: now };
  }
  if (processStillOwned) {
    return { ...codingAgentDraftFrom(record), updatedAt: now };
  }
  return {
    ...codingAgentDraftFrom(record),
    connectionState: 'disconnected',
    processState: 'unknown',
    // Completed evidence is preserved untouched — only the live claim drops.
    disconnectionReason:
      'Relay restarted and cannot confirm the Claude Code process that was running. Nothing was replayed and no new process was started.',
    updatedAt: now,
  };
}
