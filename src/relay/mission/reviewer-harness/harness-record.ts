import { digestOf } from '../durable/durable-digest';
import {
  HARNESS_CONNECTION_STATES, NO_HARNESS_CAPABILITIES, REVIEWER_HARNESS_SCHEMA_VERSION,
  SUPPORTED_REVIEWER_HARNESS_VERSIONS, UNKNOWN_HARNESS_USAGE,
  type ReviewerHarnessRecord, type ReviewerHarnessRecordDraft,
} from './harness-contracts';
import { UNKNOWN_INDEPENDENCE } from './harness-validation';

export function sealHarnessRecord(
  draft: ReviewerHarnessRecordDraft | ReviewerHarnessRecord,
): ReviewerHarnessRecord {
  const { checksum: _stale, ...rest } = draft as ReviewerHarnessRecord;
  return { ...rest, checksum: digestOf(rest) };
}

export function harnessDraftFrom(record: ReviewerHarnessRecord): ReviewerHarnessRecordDraft {
  const { checksum: _checksum, ...rest } = record;
  return rest;
}

export function verifyHarnessChecksum(record: ReviewerHarnessRecord): boolean {
  const { checksum, ...rest } = record;
  return typeof checksum === 'string' && checksum.length > 0 && digestOf(rest) === checksum;
}

export type HarnessReadResult =
  | { readonly ok: true; readonly record: ReviewerHarnessRecord }
  | { readonly ok: false; readonly reason: 'not_found' }
  | { readonly ok: false; readonly reason: 'corrupt'; readonly detail: string }
  | { readonly ok: false; readonly reason: 'unsupported_version'; readonly detail: string };

function structurallyValid(value: unknown): value is ReviewerHarnessRecord {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v.missionId !== 'string' || v.missionId.length === 0) return false;
  if (!HARNESS_CONNECTION_STATES.includes(v.connectionState as never)) return false;
  const id = v.identity as Record<string, unknown> | undefined;
  if (id === undefined || id === null || typeof id !== 'object') return false;
  if (id.role !== 'reviewer') return false;
  // Harness and model must remain SEPARATE, independently nullable fields.
  if (typeof id.requestedHarness !== 'string') return false;
  if (id.actualHarness !== null && typeof id.actualHarness !== 'string') return false;
  if (id.actualModel !== null && typeof id.actualModel !== 'string') return false;
  if (typeof id.launchVerified !== 'boolean') return false;
  if (!Array.isArray(v.findingRefs) || !Array.isArray(v.evidenceRefs)) return false;
  // A validated verdict is Relay's, and only ever one of two values or null.
  if (v.validatedVerdict !== null
    && v.validatedVerdict !== 'approved' && v.validatedVerdict !== 'changes_requested') return false;
  if (typeof v.checksum !== 'string') return false;
  return true;
}

export function readHarnessRecord(raw: unknown): HarnessReadResult {
  if (raw === null || raw === undefined) return { ok: false, reason: 'not_found' };
  if (typeof raw !== 'object') {
    return { ok: false, reason: 'corrupt', detail: 'stored value is not an object' };
  }
  const version = (raw as Record<string, unknown>).schemaVersion;
  if (typeof version !== 'string') {
    return { ok: false, reason: 'corrupt', detail: 'missing schema version' };
  }
  if (!(SUPPORTED_REVIEWER_HARNESS_VERSIONS as readonly string[]).includes(version)) {
    return {
      ok: false, reason: 'unsupported_version',
      detail: `reviewer-harness record schema ${version} is not readable by this build (writes ${REVIEWER_HARNESS_SCHEMA_VERSION})`,
    };
  }
  if (!structurallyValid(raw)) {
    return { ok: false, reason: 'corrupt', detail: 'record shape is not a reviewer-harness record' };
  }
  if (!verifyHarnessChecksum(raw)) {
    return { ok: false, reason: 'corrupt', detail: 'checksum does not match record contents' };
  }
  return { ok: true, record: raw };
}

/** A truthful "no review has run" record. */
export function idleHarnessRecord(input: {
  missionId: string;
  projectId: string;
  missionContractRef: string;
  requestedHarness?: string;
  harnessAdapterId?: string;
  now: string;
}): ReviewerHarnessRecordDraft {
  return {
    schemaVersion: REVIEWER_HARNESS_SCHEMA_VERSION,
    missionId: input.missionId,
    projectId: input.projectId,
    identity: {
      role: 'reviewer',
      requestedHarness: input.requestedHarness ?? 'Not selected',
      actualHarness: null,
      harnessVersion: null,
      harnessAdapterId: input.harnessAdapterId ?? 'none',
      requestedModel: null,
      actualModel: null,
      provider: null,
      executionMode: 'offline',
      runId: null,
      sessionRefRedacted: null,
      launchVerified: false,
    },
    capabilities: NO_HARNESS_CAPABILITIES,
    connectionState: 'not_connected',
    missionContractRef: input.missionContractRef,
    reviewTargetRef: null,
    baseRevision: null,
    headRevision: null,
    startedAt: null,
    completedAt: null,
    findingRefs: [],
    evidenceRefs: [],
    proposedVerdict: null,
    validatedVerdict: null,
    independence: UNKNOWN_INDEPENDENCE,
    usage: UNKNOWN_HARNESS_USAGE,
    cancellationRequested: false,
    cancellationConfirmed: false,
    disconnectionReason: null,
    blockedReason: null,
    provenance: 'offline',
    updatedAt: input.now,
  };
}

/**
 * RECOVERY. An uncertain active review becomes `disconnected` — never
 * completed — and is never automatically repeated, because a review may have
 * been paid for. An explicit retry mints a NEW run id.
 */
export function classifyRecoveredHarness(input: {
  record: ReviewerHarnessRecord;
  runConfirmed: boolean;
  now: string;
}): ReviewerHarnessRecordDraft {
  const { record, runConfirmed, now } = input;
  const wasActive = record.connectionState === 'reviewing' || record.connectionState === 'preparing';
  if (!wasActive || runConfirmed) {
    return { ...harnessDraftFrom(record), updatedAt: now };
  }
  return {
    ...harnessDraftFrom(record),
    connectionState: 'disconnected',
    disconnectionReason:
      'Relay restarted and cannot confirm the Reviewer run. It was not repeated — a retry must be requested explicitly and will use a new run id.',
    updatedAt: now,
  };
}

/** A retry always mints a new run: the old one is never reused. */
export function retryHarnessRun(input: {
  record: ReviewerHarnessRecord;
  newRunId: string;
  now: string;
}): ReviewerHarnessRecordDraft {
  return {
    ...harnessDraftFrom(input.record),
    identity: { ...input.record.identity, runId: input.newRunId, launchVerified: false },
    connectionState: 'preparing',
    // Findings already validated are evidence and are preserved.
    proposedVerdict: null,
    validatedVerdict: null,
    startedAt: input.now,
    completedAt: null,
    cancellationRequested: false,
    cancellationConfirmed: false,
    disconnectionReason: null,
    updatedAt: input.now,
  };
}
