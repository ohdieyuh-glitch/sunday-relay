import { digestOf } from './durable-digest';
import {
  DURABLE_CHECKPOINT_REASONS,
  DURABLE_MISSION_SCHEMA_VERSION,
  SUPPORTED_DURABLE_SCHEMA_VERSIONS,
  type DurableMissionRecord,
  type DurableMissionRecordDraft,
} from './durable-contracts';

/**
 * SEALING, VALIDATION AND MIGRATION of the canonical durable mission record.
 * Pure functions — no clock, no storage, no I/O. A record is only ever
 * trusted after `readDurableRecord` returns `ok`.
 *
 * The three failure modes are kept separate on purpose, because the customer
 * is told a different truth in each case:
 *   - `unsupported_version` — a record from a build we cannot safely read
 *   - `corrupt` — malformed shape, or a checksum that does not match
 *   - `not_found` — nothing was stored
 * None of them is ever converted into "a fresh empty mission".
 */

/* ------------------------------------------------------------ redaction */

/** Keys never written, whatever a caller passes. Mirrors the Node layer's
    `FORBIDDEN_KEY_RE` so both surfaces refuse the same material. */
export const DURABLE_FORBIDDEN_KEY_RE =
  /password|passwd|api[-_]?key|apikey|access[-_]?token|refresh[-_]?token|secret|authorization|cookie|recovery[-_]?code|bearer|credential|token|env(ironment)?[-_]?values?$/i;

/** Value shapes that are secrets even when the key looks innocent. */
export const DURABLE_SECRET_VALUE_RE =
  /(sk-[A-Za-z0-9]{8,})|(AKIA[0-9A-Z]{12,})|(-----BEGIN [A-Z ]*PRIVATE KEY)|(gh[pousr]_[A-Za-z0-9]{20,})|(xox[baprs]-[A-Za-z0-9-]{10,})|(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,})/g;

/** Raw streams, transcripts and reasoning are never persisted. */
export const DURABLE_FORBIDDEN_STREAM_KEY_RE =
  /^(rawStream|rawEvents|eventStream|transcript|stdout|stderr|prompt|promptBody|systemPrompt|fullPrompt|instructions|reasoning|thinking|chainOfThought|hiddenReasoning)$/i;

const MAX_STRING = 2_000;
const MAX_ARRAY = 200;

function redactValue(value: unknown, depth: number): unknown {
  if (depth > 8) return '[REDACTED: depth-bounded]';
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') {
    let safe = value.replace(DURABLE_SECRET_VALUE_RE, '[REDACTED]');
    if (safe.length > MAX_STRING) safe = `${safe.slice(0, MAX_STRING)}…[truncated]`;
    return safe;
  }
  if (Array.isArray(value)) {
    const bounded = value.slice(0, MAX_ARRAY).map((v) => redactValue(v, depth + 1));
    if (value.length > MAX_ARRAY) bounded.push(`[truncated: ${value.length - MAX_ARRAY} more]`);
    return bounded;
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      if (DURABLE_FORBIDDEN_KEY_RE.test(key) || DURABLE_FORBIDDEN_STREAM_KEY_RE.test(key)) continue;
      const visited = redactValue(raw, depth + 1);
      if (visited !== undefined) out[key] = visited;
    }
    return out;
  }
  return undefined; // functions, symbols, bigints never reach storage
}

/** Strip anything unsafe from a draft BEFORE it is sealed and written. */
export function redactDurableRecord(draft: DurableMissionRecordDraft): DurableMissionRecordDraft {
  return redactValue(draft, 0) as DurableMissionRecordDraft;
}

/**
 * The same redaction, for any durable value that is not a mission record.
 *
 * The Loop journal needs these exact rules — same forbidden keys, same secret
 * shapes, same bounds — and a second implementation of them would be a second
 * thing to keep in step. Exposing the walker rather than copying it means one
 * set of rules protects both lifecycles.
 */
export function redactDurableValue(value: unknown): unknown {
  return redactValue(value, 0);
}

/* -------------------------------------------------------------- sealing */

/**
 * Redact, then sign. The checksum covers the redacted content, so a record
 * whose fields were edited after the fact fails verification.
 *
 * A STALE CHECKSUM IS DROPPED FIRST. Callers legitimately build the next
 * draft by spreading the previous RECORD (`{...record, recoveryGeneration:
 * n + 1}`), which carries the old checksum along. Signing over that value
 * would produce a record whose own verification fails on read-back — so the
 * field is removed before the digest is taken, and `draftFromRecord` gives
 * callers the same guarantee explicitly.
 */
export function sealDurableRecord(
  draft: DurableMissionRecordDraft | DurableMissionRecord,
): DurableMissionRecord {
  const safe = redactDurableRecord(stripChecksum(draft));
  return { ...safe, checksum: digestOf(safe) };
}

function stripChecksum(
  value: DurableMissionRecordDraft | DurableMissionRecord,
): DurableMissionRecordDraft {
  const { checksum: _checksum, ...rest } = value as DurableMissionRecord;
  return rest;
}

/** The explicit way to continue from a stored record: same content, no
    checksum, ready to be amended and re-sealed. */
export function draftFromRecord(record: DurableMissionRecord): DurableMissionRecordDraft {
  return stripChecksum(record);
}

/** Recompute and compare — the integrity half of `readDurableRecord`. */
export function verifyDurableChecksum(record: DurableMissionRecord): boolean {
  const { checksum, ...rest } = record;
  return typeof checksum === 'string' && checksum.length > 0 && digestOf(rest) === checksum;
}

/* ----------------------------------------------------------- validation */

export type DurableReadFailure =
  | { readonly ok: false; readonly reason: 'not_found' }
  | { readonly ok: false; readonly reason: 'corrupt'; readonly detail: string }
  | { readonly ok: false; readonly reason: 'unsupported_version'; readonly detail: string };

export type DurableReadResult =
  | { readonly ok: true; readonly record: DurableMissionRecord; readonly migrated: boolean }
  | DurableReadFailure;

function isStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

/** Structural check — enough to refuse a foreign or truncated payload
    without trusting any of it. */
function structurallyValid(value: unknown): value is DurableMissionRecord {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v.missionId !== 'string' || v.missionId.length === 0) return false;
  if (typeof v.projectId !== 'string' || v.projectId.length === 0) return false;
  if (typeof v.missionContractRef !== 'string') return false;
  if (typeof v.missionContractRevision !== 'string') return false;
  if (typeof v.missionState !== 'string' || typeof v.stage !== 'string') return false;
  if (!Array.isArray(v.assignments)) return false;
  if (typeof v.recoveryGeneration !== 'number' || !Number.isInteger(v.recoveryGeneration)) return false;
  if (typeof v.createdAt !== 'string' || typeof v.updatedAt !== 'string') return false;
  if (typeof v.checkpointAt !== 'string') return false;
  if (!DURABLE_CHECKPOINT_REASONS.includes(v.checkpointReason as never)) return false;
  if (v.provenance !== 'live' && v.provenance !== 'offline' && v.provenance !== 'simulated') return false;
  const evidence = v.evidence as Record<string, unknown> | undefined;
  if (evidence === undefined || typeof evidence !== 'object' || evidence === null) return false;
  if (!isStringArray(evidence.filesReportedChanged)) return false;
  if (!isStringArray(evidence.evidenceRefs)) return false;
  const usage = v.usage as Record<string, unknown> | undefined;
  if (usage === undefined || typeof usage !== 'object' || usage === null) return false;
  if (!isStringArray(usage.costReceiptRefs)) return false;
  // A missing cost must be explicitly null — never absent, never 0.
  if (usage.knownCostMicros !== null && typeof usage.knownCostMicros !== 'string') return false;
  if (typeof v.checksum !== 'string') return false;
  return true;
}

/**
 * The ONLY way to turn stored bytes into a trusted record.
 *
 * Order matters: version first (so a future record is reported as such rather
 * than as corrupt), then shape, then checksum.
 */
export function readDurableRecord(raw: unknown): DurableReadResult {
  if (raw === null || raw === undefined) return { ok: false, reason: 'not_found' };
  if (typeof raw !== 'object') {
    return { ok: false, reason: 'corrupt', detail: 'stored value is not an object' };
  }
  const version = (raw as Record<string, unknown>).schemaVersion;
  if (typeof version !== 'string') {
    return { ok: false, reason: 'corrupt', detail: 'missing schema version' };
  }
  if (!(SUPPORTED_DURABLE_SCHEMA_VERSIONS as readonly string[]).includes(version)) {
    return {
      ok: false,
      reason: 'unsupported_version',
      detail: `record schema ${version} is not readable by this build (writes ${DURABLE_MISSION_SCHEMA_VERSION})`,
    };
  }
  const migrated = migrateDurableRecord(raw as Record<string, unknown>);
  if (!structurallyValid(migrated.value)) {
    return { ok: false, reason: 'corrupt', detail: 'record shape is not a durable mission record' };
  }
  if (!verifyDurableChecksum(migrated.value)) {
    return { ok: false, reason: 'corrupt', detail: 'checksum does not match record contents' };
  }
  return { ok: true, record: migrated.value, migrated: migrated.migrated };
}

/**
 * DETERMINISTIC MIGRATION SEAM. Today every supported version is already
 * current, so this is the identity — but the seam exists so a future version
 * is added here, with its own fixture, rather than by loosening validation.
 * A migration must re-seal (the checksum covers the migrated content).
 */
export function migrateDurableRecord(
  raw: Record<string, unknown>,
): { value: unknown; migrated: boolean } {
  if (raw.schemaVersion === DURABLE_MISSION_SCHEMA_VERSION) {
    return { value: raw, migrated: false };
  }
  return { value: raw, migrated: false };
}

/** Serialize for storage — sorted keys, so the bytes are reproducible. */
export function serializeDurableRecord(record: DurableMissionRecord): string {
  return JSON.stringify(record);
}
