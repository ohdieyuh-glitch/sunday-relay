import { parseJuliusAdmissionRunId } from '../scripts/julius-admission-run-id.mjs';
import type { CompanionDisposition } from './julius-companion-slot';

/**
 * COMPANION EVIDENCE THE LOOPBACK READ WILL SERVE.
 *
 * BRIDGE owns `GET /relay-api/wonderland/julius/missions/{wljRunId}/companion`.
 * This module does not mount that route. It stores the row the route reads:
 * the companion state, an untrusted summary, a content hash, and provenance.
 * The key is a canonical `wlj_` id. A legacy `run:` id is refused on read and
 * on write. A missing row is no result. The summary is never verified.
 */

export const COMPANION_EVIDENCE_SCHEMA_VERSION = 1 as const;

export const COMPANION_EVIDENCE_FIELDS = [
  'schemaVersion',
  'wljRunId',
  'legacyRunId',
  'taskId',
  'state',
  'summary',
  'contentSha256',
  'artifactKind',
  'byteLength',
  'provenance',
  'updatedAt',
] as const;

export const COMPANION_WIRE_STATES = [
  'none',
  'invited',
  'delivered',
  'delivery_failed',
  'result_received',
  'integrated',
  'rejected',
  'timed_out',
  'no_result',
  'cancelled',
] as const;

export type CompanionWireState = (typeof COMPANION_WIRE_STATES)[number];

export const COMPANION_ARTIFACT_KINDS = ['text', 'patch', 'json'] as const;
export type CompanionArtifactKind = (typeof COMPANION_ARTIFACT_KINDS)[number];

/** Four kibibytes of UTF-8. A longer summary is not stored. */
export const COMPANION_SUMMARY_MAX_BYTES = 4096;

const CMP_TASK_ID = /^cmp_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256_HEX = /^[0-9a-f]{64}$/u;
const UTC_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const RESULT_STATES: ReadonlySet<CompanionWireState> = new Set(['result_received', 'integrated', 'rejected']);

export type CompanionProvenanceSource = 'companion_port' | 'simulated';

/** Provenance carries no verifier. A simulated source has no `verifiedBy`. */
export interface CompanionProvenance {
  readonly source: CompanionProvenanceSource;
  readonly wakeId: string | null;
  readonly bodyDigest: string | null;
  readonly contentSha256: string;
}

export interface StoredCompanionEvidence {
  readonly schemaVersion: typeof COMPANION_EVIDENCE_SCHEMA_VERSION;
  readonly wljRunId: string;
  readonly legacyRunId: string | null;
  readonly taskId: string | null;
  readonly state: CompanionWireState;
  readonly summary: string | null;
  readonly contentSha256: string | null;
  readonly artifactKind: CompanionArtifactKind | null;
  readonly byteLength: number | null;
  readonly provenance: CompanionProvenance | null;
  readonly updatedAt: string;
}

export interface CompanionEvidenceDraft {
  readonly wljRunId: string;
  readonly legacyRunId: string | null;
  readonly taskId?: string | null;
  /** Slot disposition. Mapped onto the wire state. Refused when it disagrees with `state`. */
  readonly disposition?: CompanionDisposition;
  readonly state?: CompanionWireState;
  /** Untrusted text. The store has no verified flag for it. */
  readonly summary: string | null;
  readonly contentSha256: string | null;
  readonly artifactKind?: CompanionArtifactKind | null;
  readonly byteLength?: number | null;
  readonly provenance: CompanionProvenance | null;
  readonly updatedAt: string;
}

export type CompanionEvidenceRefusal = 'companion_legacy_read_only' | 'companion_run_id_invalid' | 'companion_evidence_invalid';

export type CompanionEvidenceWrite =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: CompanionEvidenceRefusal };

/** The body the route will serve. `result` is null when there is nothing to show. */
export interface CompanionEvidenceView {
  readonly wljRunId: string;
  readonly taskId: string | null;
  readonly companion: { readonly state: CompanionWireState };
  readonly result: null | {
    readonly untrusted: true;
    readonly summary: string;
    readonly artifact: { readonly kind: CompanionArtifactKind; readonly sha256: string; readonly byteLength: number };
  };
  readonly provenance: CompanionProvenance | null;
  readonly legacyRunId: string | null;
  readonly updatedAt: string;
}

export type CompanionEvidenceRead =
  | { readonly ok: true; readonly result: CompanionEvidenceView | null }
  | { readonly ok: false; readonly reason: 'companion_legacy_read_only' | 'companion_run_id_invalid' };

export interface CompanionEvidenceStore {
  readonly schemaVersion: typeof COMPANION_EVIDENCE_SCHEMA_VERSION;
  record(draft: CompanionEvidenceDraft): CompanionEvidenceWrite;
  read(runId: string): CompanionEvidenceRead;
}

export function companionStateFromDisposition(disposition: CompanionDisposition): CompanionWireState {
  switch (disposition) {
    case 'absent': return 'none';
    case 'refused': return 'rejected';
    case 'timed_out': return 'timed_out';
    case 'failed': return 'delivery_failed';
    case 'missing': return 'no_result';
    case 'integrated': return 'integrated';
    case 'rejected': return 'rejected';
  }
}

export function createMemoryCompanionEvidenceStore(): CompanionEvidenceStore {
  const rows = new Map<string, StoredCompanionEvidence>();
  return {
    schemaVersion: COMPANION_EVIDENCE_SCHEMA_VERSION,
    record(draft) {
      const stored = validateDraft(draft);
      if (!stored.ok) return stored;
      rows.set(stored.row.wljRunId, stored.row);
      return { ok: true };
    },
    read(runId) {
      const parsed = parseJuliusAdmissionRunId(runId);
      if (!parsed.ok) return { ok: false, reason: 'companion_run_id_invalid' };
      if (parsed.form === 'legacy') return { ok: false, reason: 'companion_legacy_read_only' };
      const row = rows.get(parsed.runId);
      if (row === undefined) return { ok: true, result: null };
      return { ok: true, result: project(row) };
    },
  };
}

function project(row: StoredCompanionEvidence): CompanionEvidenceView {
  const received = RESULT_STATES.has(row.state);
  return {
    wljRunId: row.wljRunId,
    taskId: row.taskId,
    companion: { state: row.state },
    result: received ? servedResult(row) : null,
    provenance: received ? row.provenance : null,
    legacyRunId: row.legacyRunId,
    updatedAt: row.updatedAt,
  };
}

function servedResult(row: StoredCompanionEvidence): CompanionEvidenceView['result'] {
  if (!RESULT_STATES.has(row.state)) return null;
  if (row.summary === null || row.contentSha256 === null || row.artifactKind === null || row.byteLength === null || row.provenance === null) {
    return null;
  }
  return {
    untrusted: true,
    summary: row.summary,
    artifact: { kind: row.artifactKind, sha256: row.contentSha256, byteLength: row.byteLength },
  };
}

function validateDraft(draft: CompanionEvidenceDraft): { readonly ok: true; readonly row: StoredCompanionEvidence } | { readonly ok: false; readonly reason: CompanionEvidenceRefusal } {
  const parsed = parseJuliusAdmissionRunId(draft.wljRunId);
  if (!parsed.ok) return { ok: false, reason: 'companion_run_id_invalid' };
  if (parsed.form === 'legacy') return { ok: false, reason: 'companion_legacy_read_only' };
  const legacy = legacyOf(draft.legacyRunId);
  if (!legacy.ok) return { ok: false, reason: legacy.reason };
  const state = resolveState(draft);
  if (state === null) return { ok: false, reason: 'companion_evidence_invalid' };
  const taskId = draft.taskId === undefined ? null : draft.taskId;
  if (taskId !== null && !CMP_TASK_ID.test(taskId)) return { ok: false, reason: 'companion_evidence_invalid' };
  if (draft.summary !== null && new TextEncoder().encode(draft.summary).byteLength > COMPANION_SUMMARY_MAX_BYTES) {
    return { ok: false, reason: 'companion_evidence_invalid' };
  }
  if (draft.contentSha256 !== null && !SHA256_HEX.test(draft.contentSha256)) return { ok: false, reason: 'companion_evidence_invalid' };
  const artifactKind = draft.artifactKind === undefined ? null : draft.artifactKind;
  if (artifactKind !== null && !COMPANION_ARTIFACT_KINDS.includes(artifactKind)) return { ok: false, reason: 'companion_evidence_invalid' };
  const byteLength = draft.byteLength === undefined ? null : draft.byteLength;
  if (byteLength !== null && (!Number.isSafeInteger(byteLength) || byteLength < 0)) return { ok: false, reason: 'companion_evidence_invalid' };
  if (!UTC_ISO.test(draft.updatedAt)) return { ok: false, reason: 'companion_evidence_invalid' };
  const provenance = draft.provenance;
  if (provenance !== null) {
    if (provenance.source !== 'companion_port' && provenance.source !== 'simulated') return { ok: false, reason: 'companion_evidence_invalid' };
    if (provenance.wakeId !== null && typeof provenance.wakeId !== 'string') return { ok: false, reason: 'companion_evidence_invalid' };
    if (provenance.bodyDigest !== null && !SHA256_HEX.test(provenance.bodyDigest)) return { ok: false, reason: 'companion_evidence_invalid' };
    if (!SHA256_HEX.test(provenance.contentSha256)) return { ok: false, reason: 'companion_evidence_invalid' };
    if (draft.contentSha256 !== null && provenance.contentSha256 !== draft.contentSha256) return { ok: false, reason: 'companion_evidence_invalid' };
  }
  return {
    ok: true,
    row: {
      schemaVersion: COMPANION_EVIDENCE_SCHEMA_VERSION,
      wljRunId: parsed.runId,
      legacyRunId: legacy.legacyRunId,
      taskId,
      state,
      summary: draft.summary,
      contentSha256: draft.contentSha256,
      artifactKind,
      byteLength,
      provenance,
      updatedAt: draft.updatedAt,
    },
  };
}

function legacyOf(value: string | null): { readonly ok: true; readonly legacyRunId: string | null } | { readonly ok: false; readonly reason: CompanionEvidenceRefusal } {
  if (value === null || value === '') return { ok: true, legacyRunId: null };
  const parsed = parseJuliusAdmissionRunId(value);
  if (!parsed.ok || parsed.form !== 'legacy') return { ok: false, reason: 'companion_run_id_invalid' };
  return { ok: true, legacyRunId: parsed.runId };
}

function resolveState(draft: CompanionEvidenceDraft): CompanionWireState | null {
  const fromDisposition = draft.disposition === undefined ? null : companionStateFromDisposition(draft.disposition);
  const named = draft.state === undefined ? null : draft.state;
  if (named !== null && !COMPANION_WIRE_STATES.includes(named)) return null;
  if (fromDisposition !== null && named !== null && fromDisposition !== named) return null;
  return named ?? fromDisposition;
}
