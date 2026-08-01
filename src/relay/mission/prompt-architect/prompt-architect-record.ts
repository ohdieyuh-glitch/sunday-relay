import { digestOf } from '../durable/durable-digest';
import {
  ARCHITECT_CONNECTION_STATES,
  NO_ARCHITECT_CAPABILITIES,
  PROMPT_ARCHITECT_SCHEMA_VERSION,
  SUPPORTED_PROMPT_ARCHITECT_VERSIONS,
  UNKNOWN_ARCHITECT_USAGE,
  type PromptArchitectRecord,
  type PromptArchitectRecordDraft,
} from './prompt-architect-contracts';

/** Sealing, validation and recovery classification. Reuses the durable
    module's digest so a record written by the bridge verifies in the CLI. */

export function sealArchitectRecord(
  draft: PromptArchitectRecordDraft | PromptArchitectRecord,
): PromptArchitectRecord {
  const { checksum: _stale, ...rest } = draft as PromptArchitectRecord;
  return { ...rest, checksum: digestOf(rest) };
}

export function architectDraftFrom(record: PromptArchitectRecord): PromptArchitectRecordDraft {
  const { checksum: _checksum, ...rest } = record;
  return rest;
}

export function verifyArchitectChecksum(record: PromptArchitectRecord): boolean {
  const { checksum, ...rest } = record;
  return typeof checksum === 'string' && checksum.length > 0 && digestOf(rest) === checksum;
}

export type ArchitectReadResult =
  | { readonly ok: true; readonly record: PromptArchitectRecord }
  | { readonly ok: false; readonly reason: 'not_found' }
  | { readonly ok: false; readonly reason: 'corrupt'; readonly detail: string }
  | { readonly ok: false; readonly reason: 'unsupported_version'; readonly detail: string };

function structurallyValid(value: unknown): value is PromptArchitectRecord {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v.missionId !== 'string' || v.missionId.length === 0) return false;
  if (!ARCHITECT_CONNECTION_STATES.includes(v.connectionState as never)) return false;
  const id = v.identity as Record<string, unknown> | undefined;
  if (id === undefined || id === null || typeof id !== 'object') return false;
  if (id.role !== 'prompt_architect') return false;
  // requested and actual must both exist as distinct fields.
  if (id.actualModel !== null && typeof id.actualModel !== 'string') return false;
  if (id.requestedModel !== null && typeof id.requestedModel !== 'string') return false;
  if (typeof id.launchVerified !== 'boolean') return false;
  const usage = v.usage as Record<string, unknown> | undefined;
  if (usage === undefined || usage === null || typeof usage !== 'object') return false;
  if (usage.inputTokens !== null && typeof usage.inputTokens !== 'number') return false;
  // Cost is Unknown by contract until a pricing authority exists.
  if (usage.costKnown !== false) return false;
  if (typeof v.checksum !== 'string') return false;
  return true;
}

export function readArchitectRecord(raw: unknown): ArchitectReadResult {
  if (raw === null || raw === undefined) return { ok: false, reason: 'not_found' };
  if (typeof raw !== 'object') {
    return { ok: false, reason: 'corrupt', detail: 'stored value is not an object' };
  }
  const version = (raw as Record<string, unknown>).schemaVersion;
  if (typeof version !== 'string') {
    return { ok: false, reason: 'corrupt', detail: 'missing schema version' };
  }
  if (!(SUPPORTED_PROMPT_ARCHITECT_VERSIONS as readonly string[]).includes(version)) {
    return {
      ok: false,
      reason: 'unsupported_version',
      detail: `prompt-architect record schema ${version} is not readable by this build (writes ${PROMPT_ARCHITECT_SCHEMA_VERSION})`,
    };
  }
  if (!structurallyValid(raw)) {
    return { ok: false, reason: 'corrupt', detail: 'record shape is not a prompt-architect record' };
  }
  if (!verifyArchitectChecksum(raw)) {
    return { ok: false, reason: 'corrupt', detail: 'checksum does not match record contents' };
  }
  return { ok: true, record: raw };
}

/** A truthful "nothing has run" record. */
export function idleArchitectRecord(input: {
  missionId: string;
  projectId: string;
  missionContractRef: string;
  requestedRuntime?: string;
  adapterId?: string;
  now: string;
}): PromptArchitectRecordDraft {
  return {
    schemaVersion: PROMPT_ARCHITECT_SCHEMA_VERSION,
    missionId: input.missionId,
    projectId: input.projectId,
    identity: {
      role: 'prompt_architect',
      requestedRuntime: input.requestedRuntime ?? 'GPT (OpenAI)',
      actualRuntime: null,
      provider: 'OpenAI',
      adapterId: input.adapterId ?? 'gpt-prompt-architect',
      requestedModel: null,
      actualModel: null,
      executionMode: 'offline',
      responseIdRedacted: null,
      runId: null,
      launchVerified: false,
    },
    capabilities: NO_ARCHITECT_CAPABILITIES,
    connectionState: 'not_connected',
    missionContractRef: input.missionContractRef,
    contextRefs: [],
    startedAt: null,
    completedAt: null,
    plan: null,
    approvalState: 'not_requested',
    usage: UNKNOWN_ARCHITECT_USAGE,
    cancellationRequested: false,
    cancellationConfirmed: false,
    failureClass: null,
    failureMessage: null,
    provenance: 'offline',
    updatedAt: input.now,
  };
}

/**
 * RECOVERY. An in-flight planning request whose outcome Relay cannot confirm
 * becomes `disconnected` — never completed, and never automatically repeated,
 * because the request may already have been billed. A retry is an explicit
 * act that mints a NEW run id.
 */
export function classifyRecoveredArchitect(input: {
  record: PromptArchitectRecord;
  requestConfirmed: boolean;
  now: string;
}): PromptArchitectRecordDraft {
  const { record, requestConfirmed, now } = input;
  const wasActive = record.connectionState === 'planning' || record.connectionState === 'preparing';
  if (!wasActive || requestConfirmed) {
    return { ...architectDraftFrom(record), updatedAt: now };
  }
  return {
    ...architectDraftFrom(record),
    connectionState: 'disconnected',
    failureClass: 'network_disconnected',
    failureMessage:
      'Relay restarted and cannot confirm the planning request. It was not repeated — a retry must be requested explicitly and will use a new run id.',
    updatedAt: now,
  };
}
