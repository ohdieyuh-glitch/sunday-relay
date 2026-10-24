import { parseJuliusAdmissionRunId } from '../scripts/julius-admission-run-id.mjs';
import {
  companionAgentConnection,
  type CompanionAgentDescriptor,
  type CompanionAgentKind,
  type CompanionDisposition,
} from './julius-companion-slot';

/**
 * COMPANION EVIDENCE THE LOOPBACK READ WILL SERVE.
 *
 * BRIDGE owns the route. This module does not mount it. The served body is
 * companion status shape v0.1 plus `agents[]` from companion contract v0.2.
 * v0.1 is the state, the untrusted summary, the content hash, and provenance.
 * `verified` is false. v0.2 keys each agent by the canonical `wlj_` id and
 * its `agentId`. `providerId` is an opaque string: it is stored as written
 * and never matched against a catalog. An unknown provider is an unsupported
 * slot, and that write still succeeds. A legacy `run:` id is refused on read
 * and on write. A missing run is no result.
 */

const IDENTITY_MAX = 200;
const CAPABILITY_MAX = 80;
const CAPABILITIES_MAX = 8;

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
  'agent',
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

/**
 * How this row was produced. `simulated` stays labeled so a fixture cannot
 * read as a live companion. This is not a provider id and not a catalog.
 */
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
  /** Null on a status-only row. A model name is not stored here. */
  readonly agent: CompanionAgentDescriptor | null;
  readonly updatedAt: string;
}

export interface CompanionEvidenceDraft {
  readonly wljRunId: string;
  readonly legacyRunId: string | null;
  readonly taskId?: string | null;
  /** Slot disposition. Mapped onto the wire state. Refused when it disagrees with `state`. */
  readonly disposition?: CompanionDisposition;
  readonly state?: CompanionWireState;
  /** Untrusted text. Served with verified false, never as a verified summary. */
  readonly summary: string | null;
  readonly contentSha256: string | null;
  readonly artifactKind?: CompanionArtifactKind | null;
  readonly byteLength?: number | null;
  readonly provenance: CompanionProvenance | null;
  readonly agent?: CompanionAgentDescriptor | null;
  readonly updatedAt: string;
}

export type CompanionEvidenceRefusal = 'companion_legacy_read_only' | 'companion_run_id_invalid' | 'companion_evidence_invalid';

export type CompanionEvidenceWrite =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: CompanionEvidenceRefusal };

/**
 * Status shape v0.1, with contract v0.2 `agents` and `verified: false`
 * beside it. `result` is null when there is nothing to show.
 */
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
  readonly verified: false;
  readonly agents: readonly CompanionAgentDescriptor[];
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

interface HeldRow {
  readonly row: StoredCompanionEvidence;
  readonly seq: number;
}

/** `wlj_` plus `agentId`. A status-only row uses an empty agent id. */
const evidenceKey = (wljRunId: string, agentId: string | null): string => `${wljRunId}\0${agentId ?? ''}`;

export function createMemoryCompanionEvidenceStore(): CompanionEvidenceStore {
  const rows = new Map<string, HeldRow>();
  let seq = 0;
  return {
    schemaVersion: COMPANION_EVIDENCE_SCHEMA_VERSION,
    record(draft) {
      const stored = validateDraft(draft);
      if (!stored.ok) return stored;
      seq += 1;
      rows.set(evidenceKey(stored.row.wljRunId, stored.row.agent?.agentId ?? null), { row: stored.row, seq });
      return { ok: true };
    },
    read(runId) {
      const parsed = parseJuliusAdmissionRunId(runId);
      if (!parsed.ok) return { ok: false, reason: 'companion_run_id_invalid' };
      if (parsed.form === 'legacy') return { ok: false, reason: 'companion_legacy_read_only' };
      const prefix = `${parsed.runId}\0`;
      const matched = [...rows.entries()].filter(([key]) => key.startsWith(prefix)).map(([, held]) => held);
      if (matched.length === 0) return { ok: true, result: null };
      return { ok: true, result: project(matched) };
    },
  };
}

function project(held: readonly HeldRow[]): CompanionEvidenceView {
  const latest = held.reduce((best, item) => (item.seq > best.seq ? item : best));
  const row = latest.row;
  const received = RESULT_STATES.has(row.state);
  const agents: CompanionAgentDescriptor[] = [];
  for (const item of [...held].sort((a, b) => a.seq - b.seq)) {
    if (item.row.agent !== null) agents.push(item.row.agent);
  }
  return {
    wljRunId: row.wljRunId,
    taskId: row.taskId,
    companion: { state: row.state },
    result: received ? servedResult(row) : null,
    provenance: received ? row.provenance : null,
    legacyRunId: row.legacyRunId,
    updatedAt: row.updatedAt,
    verified: false,
    agents,
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
  const provenance = cleanProvenance(draft.provenance);
  if (provenance === 'invalid') return { ok: false, reason: 'companion_evidence_invalid' };
  if (provenance !== null && draft.contentSha256 !== null && provenance.contentSha256 !== draft.contentSha256) {
    return { ok: false, reason: 'companion_evidence_invalid' };
  }
  const agent = normalizeAgent(draft.agent);
  if (!agent.ok) return { ok: false, reason: 'companion_evidence_invalid' };
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
      agent: agent.agent,
      updatedAt: draft.updatedAt,
    },
  };
}

const INVALID = Symbol('invalid');

const credentialShaped = (value: string): boolean =>
  /sk-[A-Za-z0-9]/u.test(value)
  || /bearer\s+[A-Za-z0-9]/iu.test(value)
  || /(?:api[_-]?key|password|secret)\s*[:=]/iu.test(value);

/** A credential-shaped token is withheld. Any other shape is invalid. */
function strictOpaque(value: unknown, max: number): string | null | typeof INVALID {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return INVALID;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max || trimmed.includes('\0')) return INVALID;
  if (credentialShaped(trimmed)) return null;
  return trimmed;
}

function strictCapabilities(value: unknown): readonly string[] | typeof INVALID {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > CAPABILITIES_MAX) return INVALID;
  const out: string[] = [];
  for (const item of value) {
    const token = strictOpaque(item, CAPABILITY_MAX);
    if (token === INVALID) return INVALID;
    if (token !== null) out.push(token);
  }
  return out;
}

function kindOf(value: unknown): CompanionAgentKind | typeof INVALID {
  if (value === 'single' || value === 'compound') return value;
  return INVALID;
}

/**
 * Copies the descriptor and drops every other field, including `model`.
 * A present `providerId` is kept as an opaque string. A connected claim becomes
 * `unsupported` because this store has no provider adapter. That rewrite
 * still returns ok. A missing or unknown `kind`, or a missing `providerId`,
 * is not a descriptor: the write is refused. A credential-shaped display name
 * is withheld.
 */
function normalizeAgent(value: unknown): { readonly ok: true; readonly agent: CompanionAgentDescriptor | null } | { readonly ok: false } {
  if (value === undefined || value === null) return { ok: true, agent: null };
  if (typeof value !== 'object' || Array.isArray(value)) return { ok: false };
  const v = value as Record<string, unknown>;
  const agentId = strictOpaque(v.agentId, IDENTITY_MAX);
  const providerId = strictOpaque(v.providerId, IDENTITY_MAX);
  const displayName = strictOpaque(v.displayName, IDENTITY_MAX);
  const adapterVersion = strictOpaque(v.adapterVersion, IDENTITY_MAX);
  const kind = kindOf(v.kind);
  const declaredCapabilities = strictCapabilities(v.declaredCapabilities);
  const authorizedCapabilities = strictCapabilities(v.authorizedCapabilities);
  if (
    agentId === INVALID || providerId === INVALID || displayName === INVALID || adapterVersion === INVALID
    || kind === INVALID || declaredCapabilities === INVALID || authorizedCapabilities === INVALID
  ) return { ok: false };
  if (agentId === null) return { ok: true, agent: null };
  if (providerId === null) return { ok: false };
  return {
    ok: true,
    agent: {
      agentId,
      providerId,
      displayName,
      kind,
      adapterVersion,
      declaredCapabilities,
      authorizedCapabilities,
      connection: companionAgentConnection(v.connection, false),
    },
  };
}

/** Copies the four provenance fields. A provider id does not belong here. */
function cleanProvenance(provenance: CompanionProvenance | null): CompanionProvenance | null | 'invalid' {
  if (provenance === null) return null;
  if (provenance.source !== 'companion_port' && provenance.source !== 'simulated') return 'invalid';
  if (provenance.wakeId !== null && typeof provenance.wakeId !== 'string') return 'invalid';
  if (provenance.bodyDigest !== null && !SHA256_HEX.test(provenance.bodyDigest)) return 'invalid';
  if (!SHA256_HEX.test(provenance.contentSha256)) return 'invalid';
  return {
    source: provenance.source,
    wakeId: provenance.wakeId,
    bodyDigest: provenance.bodyDigest,
    contentSha256: provenance.contentSha256,
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
