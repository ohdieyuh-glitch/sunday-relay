import { join } from 'node:path';
import {
  KNOWN_STATE_SCHEMA_VERSIONS, PERSISTED_EVENT_KINDS, RELAY_STATE_SCHEMA_VERSION,
  type PersistedEvent, type PersistedEventInput,
} from './contracts';
import { sha256Hex, stableSerialize } from './integrity';
import { sanitizePayload } from './redaction';
import { appendLineDurable, readTextIfExists } from './atomic-file';

/**
 * Append-only event journal (Prompt 8.5). One JSONL file per run; every
 * line is a schema-versioned, checksummed, monotonically-sequenced event.
 * The journal is the single durable authority — snapshots are derived.
 *
 * Reader guarantees: schema validation, checksum validation, monotonic
 * sequence validation, duplicate-event idempotent handling, missing-event
 * detection, explicit partial-final-line handling, and a corruption verdict
 * that is never silently discarded.
 */

export const JOURNAL_FILE = 'journal.jsonl';

const KIND_SET = new Set<string>(PERSISTED_EVENT_KINDS);
const KNOWN_SCHEMAS = new Set<string>(KNOWN_STATE_SCHEMA_VERSIONS);

export function buildPersistedEvent(input: {
  base: PersistedEventInput;
  sequence: number;
  previousStateDigest: string;
  resultingStateDigest: string;
}): PersistedEvent {
  const sanitized = sanitizePayload(input.base.payload);
  const sansChecksum: Omit<PersistedEvent, 'checksum'> = {
    schemaVersion: RELAY_STATE_SCHEMA_VERSION,
    eventId: `pev-${input.base.runId}-${String(input.sequence).padStart(6, '0')}`,
    sequence: input.sequence,
    at: input.base.at,
    projectId: input.base.projectId,
    ...(input.base.missionId !== undefined ? { missionId: input.base.missionId } : {}),
    ...(input.base.taskId !== undefined ? { taskId: input.base.taskId } : {}),
    runId: input.base.runId,
    attemptId: input.base.attemptId,
    kind: input.base.kind,
    actor: input.base.actor,
    ...(input.base.workspaceRevision !== undefined ? { workspaceRevision: input.base.workspaceRevision } : {}),
    previousStateDigest: input.previousStateDigest,
    resultingStateDigest: input.resultingStateDigest,
    payload: sanitized.payload,
  };
  return { ...sansChecksum, checksum: eventChecksum(sansChecksum) };
}

export function eventChecksum(event: Omit<PersistedEvent, 'checksum'>): string {
  return sha256Hex(stableSerialize(event));
}

export function appendEventLine(runDir: string, event: PersistedEvent): void {
  appendLineDurable(join(runDir, JOURNAL_FILE), stableSerialize(event));
}

export type JournalIntegrity = 'ok' | 'truncated_tail' | 'corrupt';

export interface JournalReadResult {
  events: PersistedEvent[];
  integrity: JournalIntegrity;
  diagnostics: string[];
  /** Present only when integrity === 'corrupt'. */
  corruptReason?: string;
}

function validateEventShape(value: unknown): string | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return 'event is not an object';
  const e = value as Record<string, unknown>;
  for (const field of ['schemaVersion', 'eventId', 'at', 'projectId', 'runId', 'attemptId', 'kind', 'actor',
    'previousStateDigest', 'resultingStateDigest', 'checksum'] as const) {
    if (typeof e[field] !== 'string' || (e[field] as string) === '') return `missing/invalid field ${field}`;
  }
  if (typeof e.sequence !== 'number' || !Number.isInteger(e.sequence) || e.sequence < 1) return 'invalid sequence';
  if (!KIND_SET.has(e.kind as string)) return `unknown event kind ${String(e.kind)}`;
  if (e.payload === null || typeof e.payload !== 'object' || Array.isArray(e.payload)) return 'payload is not an object';
  return null;
}

/** Read + validate the whole journal. A malformed FINAL line is treated as a
 * torn tail (the partial event is never invented); any earlier malformation,
 * checksum mismatch, sequence gap, or conflicting duplicate is corruption. */
export function readJournal(runDir: string): JournalReadResult {
  const raw = readTextIfExists(join(runDir, JOURNAL_FILE));
  const diagnostics: string[] = [];
  if (raw === null) return { events: [], integrity: 'ok', diagnostics: ['journal absent (new run)'] };

  const lines = raw.split('\n').filter((line, i, all) => !(line === '' && i === all.length - 1));
  const events: PersistedEvent[] = [];
  const seenIds = new Map<string, string>(); // eventId -> checksum
  let integrity: JournalIntegrity = 'ok';

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const isLast = i === lines.length - 1;
    if (line.trim() === '') {
      if (isLast) continue;
      return { events, integrity: 'corrupt', diagnostics, corruptReason: `blank interior line ${i + 1}` };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      if (isLast) {
        diagnostics.push(`partial final journal line dropped (torn write at line ${i + 1}); recovered to last complete event`);
        integrity = 'truncated_tail';
        break;
      }
      return { events, integrity: 'corrupt', diagnostics, corruptReason: `malformed interior line ${i + 1}` };
    }
    const shapeProblem = validateEventShape(parsed);
    if (shapeProblem) {
      return { events, integrity: 'corrupt', diagnostics, corruptReason: `line ${i + 1}: ${shapeProblem}` };
    }
    const event = parsed as PersistedEvent;
    if (!KNOWN_SCHEMAS.has(event.schemaVersion)) {
      return {
        events, integrity: 'corrupt', diagnostics,
        corruptReason: `line ${i + 1}: unknown schema version ${event.schemaVersion} (future schemas are rejected, never guessed)`,
      };
    }
    const { checksum, ...rest } = event;
    if (eventChecksum(rest) !== checksum) {
      return { events, integrity: 'corrupt', diagnostics, corruptReason: `line ${i + 1}: checksum mismatch (possible tampering)` };
    }
    const previous = seenIds.get(event.eventId);
    if (previous !== undefined) {
      if (previous === checksum) {
        diagnostics.push(`duplicate event ${event.eventId} skipped idempotently`);
        continue;
      }
      return { events, integrity: 'corrupt', diagnostics, corruptReason: `line ${i + 1}: conflicting duplicate ${event.eventId}` };
    }
    const expected = events.length === 0 ? 1 : events[events.length - 1].sequence + 1;
    if (event.sequence !== expected) {
      return {
        events, integrity: 'corrupt', diagnostics,
        corruptReason: `line ${i + 1}: sequence ${event.sequence} (expected ${expected}) — missing or reordered event`,
      };
    }
    seenIds.set(event.eventId, checksum);
    events.push(event);
  }
  return { events, integrity, diagnostics };
}
