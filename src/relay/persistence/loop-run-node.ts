import { existsSync, mkdirSync, readdirSync, realpathSync, renameSync } from 'node:fs';
import { join, sep } from 'node:path';
import { appendLineDurable, readTextIfExists, writeFileAtomic } from './atomic-file';
import { stableSerialize } from './integrity';
import { acquireRunLock, inspectLock, type AcquiredLock, type LockClassification } from './lock';
import { safeRunSegment } from './paths';
import { fail, ok, relayError, type RelayResult } from '../protocol/errors';
import {
  RELAY_LOOP_EVENT_KINDS,
  SUPPORTED_LOOP_EVENT_SCHEMA_VERSIONS,
  SUPPORTED_LOOP_RUN_SCHEMA_VERSIONS,
  emptyLoopBudget,
  loopDigest,
  seedLoopRun,
  verifyLoopEventChecksum,
  type LoopJournalIntegrity,
  type LoopRunRecord,
  type LoopRunStoreBacking,
  type RelayLoopEvent,
  type RelayLoopRun,
  type RelayLoopSnapshot,
} from '../mission/loop/runtime';

/**
 * SUNDAY RELAY — THE LOOP RUN ON DISK.
 *
 * The Node backing for `LoopRunStoreBacking`. Everything durable about a Loop
 * run lives here; everything that DECIDES anything lives in the pure runtime
 * and is unit-testable without a filesystem. This file knows about bytes.
 *
 * IT REUSES, IT DOES NOT REINVENT. The state root, safe path segments,
 * containment, atomic writes, durable appends, the O_EXCL lock with its stale
 * owner classification, and snapshot rotation are the primitives the mission
 * store already uses, imported rather than copied. What is new is only the
 * shape of the directory and the fact that Loop events are validated with the
 * Loop's own checksum.
 *
 * WHY STATE IS NEVER IN THE REPOSITORY. A Loop run holds evidence references,
 * usage and a lock. Putting that in a checkout means a `git clean` destroys the
 * record of what a paid agent did, and a branch switch changes what the runtime
 * believes about work already performed. `resolveStateRoot` already refuses a
 * Git work tree, a credential directory and Downloads; this reuses it.
 *
 * THE TORN TAIL IS EXPECTED, NOT EXCEPTIONAL. A process killed mid-append
 * leaves a partial final line. That is the ONE malformation treated as a torn
 * tail; anything earlier in the file is corruption, because a run whose middle
 * is unreadable is not a run missing one fact.
 */

/* --------------------------------------------------------------- layout */

export const LOOPS_DIR = 'loops';
export const LOOP_RUNS_DIR = 'runs';
export const LOOP_JOURNAL_FILE = 'journal.jsonl';
export const LOOP_SNAPSHOT_FILE = 'snapshot.json';
export const LOOP_SNAPSHOT_PREVIOUS_FILE = 'snapshot.previous.json';
export const LOOP_METADATA_FILE = 'metadata.json';

/**
 * `<root>/loops/<loopId>/runs/<runId>/…`
 *
 * The nesting is the point: a Loop DEFINITION owns its runs, so listing what a
 * Loop has ever done is a directory read rather than a scan of every run in the
 * system filtered by a field. Both ids are validated as single safe segments,
 * so neither can climb out with `..` or a separator.
 */
export function resolveLoopRunDir(
  root: string,
  loopId: string,
  runId: string,
): RelayResult<string> {
  const loopSegment = safeRunSegment(loopId);
  if (!loopSegment.ok) {
    return fail(relayError('validation-failed', 'Loop reference is not a safe identifier.'));
  }
  const runSegment = safeRunSegment(runId);
  if (!runSegment.ok) {
    return fail(relayError('validation-failed', 'Loop run reference is not a safe identifier.'));
  }
  if (!existsSync(root)) {
    return fail(relayError('validation-failed', 'The state root does not exist yet.'));
  }
  const canonicalRoot = realpathSync(root);
  const dir = join(canonicalRoot, LOOPS_DIR, loopSegment.value, LOOP_RUNS_DIR, runSegment.value);
  if (!(dir + sep).startsWith(canonicalRoot + sep)) {
    return fail(relayError('permission-denied', 'Loop run reference escapes the state root.'));
  }
  if (existsSync(dir)) {
    const real = realpathSync(dir);
    if (!(real + sep).startsWith(canonicalRoot + sep)) {
      return fail(relayError('permission-denied', 'Loop run directory resolves outside the state root.'));
    }
  }
  return ok(dir);
}

/* -------------------------------------------------------------- reading */

const KIND_SET = new Set<string>(RELAY_LOOP_EVENT_KINDS);
const EVENT_SCHEMAS = new Set<string>(SUPPORTED_LOOP_EVENT_SCHEMA_VERSIONS);
const RUN_SCHEMAS = new Set<string>(SUPPORTED_LOOP_RUN_SCHEMA_VERSIONS);

export interface LoopJournalReadResult {
  readonly events: readonly RelayLoopEvent[];
  readonly integrity: LoopJournalIntegrity;
  readonly diagnostics: readonly string[];
  readonly corruptReason: string | null;
}

function shapeProblem(value: unknown): string | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return 'line is not an object';
  const e = value as Record<string, unknown>;
  for (const field of ['schemaVersion', 'eventId', 'at', 'runId', 'loopId', 'projectId', 'kind', 'actor',
    'previousStateDigest', 'resultingStateDigest', 'checksum'] as const) {
    if (typeof e[field] !== 'string' || e[field] === '') return `missing or invalid ${field}`;
  }
  if (typeof e.sequence !== 'number' || !Number.isInteger(e.sequence) || e.sequence < 1) return 'invalid sequence';
  if (typeof e.recoveryGeneration !== 'number' || !Number.isInteger(e.recoveryGeneration)) {
    return 'missing recovery generation';
  }
  if (e.expectedPreviousState !== null && typeof e.expectedPreviousState !== 'string') {
    return 'invalid expected previous state';
  }
  if (e.idempotencyKey !== null && typeof e.idempotencyKey !== 'string') return 'invalid idempotency key';
  if (!KIND_SET.has(e.kind as string)) return `unknown event kind ${String(e.kind)}`;
  if (e.payload === null || typeof e.payload !== 'object') return 'payload is not an object';
  return null;
}

/**
 * Read and validate a whole Loop journal.
 *
 * Every line is checked four ways — shape, schema, checksum, sequence — and the
 * FIRST failure decides the verdict for the file. An identical duplicate line
 * (same id, same checksum) is a redelivery and is skipped idempotently; a line
 * reusing an id with DIFFERENT content is corruption, because one of the two is
 * a forgery and there is no way to tell which.
 */
export function readLoopJournal(runDir: string): LoopJournalReadResult {
  const raw = readTextIfExists(join(runDir, LOOP_JOURNAL_FILE));
  const diagnostics: string[] = [];
  if (raw === null) {
    return { events: [], integrity: 'ok', diagnostics: ['journal absent (new run)'], corruptReason: null };
  }

  const lines = raw.split('\n').filter((line, i, all) => !(line === '' && i === all.length - 1));
  const events: RelayLoopEvent[] = [];
  const seenIds = new Map<string, string>();
  let integrity: LoopJournalIntegrity = 'ok';

  const corrupt = (reason: string): LoopJournalReadResult => ({
    events, integrity: 'corrupt', diagnostics, corruptReason: reason,
  });

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const isLast = i === lines.length - 1;
    if (line.trim() === '') {
      if (isLast) continue;
      return corrupt(`blank interior line ${i + 1}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      if (isLast) {
        diagnostics.push(
          `partial final line dropped (torn write at line ${i + 1}); recovered to the last complete event`,
        );
        integrity = 'truncated_tail';
        break;
      }
      return corrupt(`malformed interior line ${i + 1}`);
    }
    const problem = shapeProblem(parsed);
    if (problem !== null) {
      // A torn tail can also produce a line that PARSES but is missing fields.
      if (isLast) {
        diagnostics.push(`incomplete final line dropped (${problem} at line ${i + 1})`);
        integrity = 'truncated_tail';
        break;
      }
      return corrupt(`line ${i + 1}: ${problem}`);
    }
    const event = parsed as RelayLoopEvent;
    if (!EVENT_SCHEMAS.has(event.schemaVersion)) {
      return corrupt(
        `line ${i + 1}: event schema ${event.schemaVersion} is not readable by this build (future schemas are refused, never guessed)`,
      );
    }
    if (!verifyLoopEventChecksum(event, loopDigest)) {
      return corrupt(`line ${i + 1}: checksum does not match the line's contents (possible tampering)`);
    }
    const previous = seenIds.get(event.eventId);
    if (previous !== undefined) {
      if (previous === event.checksum) {
        diagnostics.push(`duplicate line ${event.eventId} skipped idempotently`);
        continue;
      }
      return corrupt(`line ${i + 1}: two different lines share the event id ${event.eventId}`);
    }
    const expected = events.length === 0 ? 1 : events[events.length - 1].sequence + 1;
    if (event.sequence !== expected) {
      return corrupt(
        `line ${i + 1}: sequence ${event.sequence} where ${expected} was expected — a line is missing or reordered`,
      );
    }
    seenIds.set(event.eventId, event.checksum);
    events.push(event);
  }

  return { events, integrity, diagnostics, corruptReason: null };
}

function readSnapshotFile(path: string, diagnostics: string[], label: string): RelayLoopSnapshot | null {
  const text = readTextIfExists(path);
  if (text === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    diagnostics.push(`the ${label} snapshot is not valid JSON and was ignored`);
    return null;
  }
  if (parsed === null || typeof parsed !== 'object') {
    diagnostics.push(`the ${label} snapshot is not an object and was ignored`);
    return null;
  }
  const snapshot = parsed as RelayLoopSnapshot;
  if (!RUN_SCHEMAS.has(snapshot.schemaVersion)) {
    diagnostics.push(`the ${label} snapshot has schema ${String(snapshot.schemaVersion)} and was ignored`);
    return null;
  }
  // The digest itself is re-verified by the pure loader, which owns that rule.
  return snapshot;
}

interface LoopRunMetadata {
  readonly schemaVersion: string;
  readonly loopId: string;
  readonly runId: string;
  readonly projectId: string;
  readonly createdAt: string;
  readonly seed: RelayLoopRun;
}

/* --------------------------------------------------------------- store */

export interface LoopRunNodeStore extends LoopRunStoreBacking {
  readonly root: string;
  /** Where a run's bytes live. Exposed for diagnostics and tests. */
  runDir(loopId: string, runId: string): RelayResult<string>;
  /** Take the run lock. Every mutation the engine performs holds this. */
  lock(loopId: string, runId: string, purpose: string, now: () => string):
    RelayResult<{ lock: AcquiredLock; diagnostics: string[] }>;
  /** Read-only lock inspection — never acquires. */
  inspect(loopId: string, runId: string): RelayResult<LockClassification>;
  createRun(seed: RelayLoopRun): RelayResult<string>;
  /**
   * The runs belonging to ONE Loop definition, or `null` when the Loop has no
   * directory at all. Reads that Loop's own folder and nothing else — history
   * for one Loop never loads another Loop's runs, which is both faster and the
   * reason a caller cannot accidentally enumerate the whole system.
   */
  runIdsForLoop(loopId: string): readonly string[] | null;
}

/**
 * A Loop run store over a real filesystem.
 *
 * The backing methods take a runId alone because that is what the pure store
 * calls them with, so the loop id is resolved through an index the store keeps
 * in memory for its lifetime and re-derives from a run's metadata on read. A
 * run whose directory this process has never seen is looked up by scanning the
 * Loops it knows — bounded, and only on a miss.
 */
export function createLoopRunNodeStore(options: { root: string }): LoopRunNodeStore {
  const root = options.root;
  mkdirSync(join(root, LOOPS_DIR), { recursive: true, mode: 0o700 });
  const loopOfRun = new Map<string, string>();

  const dirFor = (loopId: string, runId: string): RelayResult<string> =>
    resolveLoopRunDir(root, loopId, runId);

  const dirForRun = (runId: string): string | null => {
    const known = loopOfRun.get(runId);
    if (known !== undefined) {
      const resolved = dirFor(known, runId);
      return resolved.ok ? resolved.value : null;
    }
    // Miss: find the Loop that owns this run. Only reached after a restart,
    // and only once per run per process.
    const loopsRoot = join(root, LOOPS_DIR);
    if (!existsSync(loopsRoot)) return null;
    for (const loopId of safeChildren(loopsRoot)) {
      const candidate = dirFor(loopId, runId);
      if (candidate.ok && existsSync(join(candidate.value, LOOP_METADATA_FILE))) {
        loopOfRun.set(runId, loopId);
        return candidate.value;
      }
    }
    return null;
  };

  const readRecord = (runId: string): LoopRunRecord | null => {
    const dir = dirForRun(runId);
    if (dir === null) return null;
    const metadataText = readTextIfExists(join(dir, LOOP_METADATA_FILE));
    if (metadataText === null) return null;
    let metadata: LoopRunMetadata;
    try {
      metadata = JSON.parse(metadataText) as LoopRunMetadata;
    } catch {
      // Metadata carries the seed. Without it there is no starting point for
      // replay, and inventing one would reconstruct history from today's facts.
      return unreadableRecord(runId);
    }
    if (!RUN_SCHEMAS.has(metadata.schemaVersion)) {
      return unreadableRecord(runId);
    }

    const journal = readLoopJournal(dir);
    const diagnostics: string[] = [];
    return {
      runId,
      seed: metadata.seed,
      events: journal.events,
      snapshot: readSnapshotFile(join(dir, LOOP_SNAPSHOT_FILE), diagnostics, 'current'),
      previousSnapshot: readSnapshotFile(join(dir, LOOP_SNAPSHOT_PREVIOUS_FILE), diagnostics, 'previous'),
      integrity: journal.integrity,
    };
  };

  return {
    root,

    runDir: dirFor,

    lock: (loopId, runId, purpose, now) => {
      const dir = dirFor(loopId, runId);
      if (!dir.ok) return dir;
      if (!existsSync(dir.value)) {
        return fail(relayError('not-found', `There is no Loop run ${runId} to lock.`));
      }
      return acquireRunLock(dir.value, purpose, now);
    },

    inspect: (loopId, runId) => {
      const dir = dirFor(loopId, runId);
      if (!dir.ok) return dir;
      if (!existsSync(dir.value)) return ok({ status: 'free', owner: null } as LockClassification);
      return ok(inspectLock(dir.value));
    },

    createRun: (seed) => {
      const dir = dirFor(seed.loopId, seed.runId);
      if (!dir.ok) return dir;
      if (existsSync(join(dir.value, LOOP_METADATA_FILE))) {
        return fail(relayError('validation-failed', `Loop run ${seed.runId} already exists.`));
      }
      writeRunDirectory(dir.value, seed);
      loopOfRun.set(seed.runId, seed.loopId);
      return ok(dir.value);
    },

    runIdsForLoop: (loopId) => {
      const segment = safeRunSegment(loopId);
      if (!segment.ok) return null;
      const runsDir = join(root, LOOPS_DIR, segment.value, LOOP_RUNS_DIR);
      if (!existsSync(runsDir)) return null;
      return safeChildren(runsDir)
        .filter((runId) => existsSync(join(runsDir, runId, LOOP_METADATA_FILE)))
        .sort();
    },

    read: readRecord,

    create: (record) => {
      const dir = dirFor(record.seed.loopId, record.runId);
      if (!dir.ok) throw new Error(dir.error.message);
      if (existsSync(join(dir.value, LOOP_METADATA_FILE))) {
        throw new Error(`Loop run ${record.runId} already exists.`);
      }
      writeRunDirectory(dir.value, record.seed);
      loopOfRun.set(record.runId, record.seed.loopId);
      for (const event of record.events) {
        appendLineDurable(join(dir.value, LOOP_JOURNAL_FILE), stableSerialize(event));
      }
    },

    appendEvent: (runId, event) => {
      const dir = dirForRun(runId);
      if (dir === null) throw new Error(`There is no Loop run ${runId} to append to.`);
      appendLineDurable(join(dir, LOOP_JOURNAL_FILE), stableSerialize(event));
    },

    writeSnapshot: (runId, snapshot) => {
      const dir = dirForRun(runId);
      if (dir === null) throw new Error(`There is no Loop run ${runId} to snapshot.`);
      const current = join(dir, LOOP_SNAPSHOT_FILE);
      const previous = join(dir, LOOP_SNAPSHOT_PREVIOUS_FILE);
      // Rotate before writing. The known-good copy is never overwritten in
      // place, so a crash during the write leaves one intact snapshot.
      if (existsSync(current)) renameSync(current, previous);
      writeFileAtomic(current, stableSerialize(snapshot));
    },
  };
}

function writeRunDirectory(dir: string, seed: RelayLoopRun): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const metadata: LoopRunMetadata = {
    schemaVersion: seed.schemaVersion,
    loopId: seed.loopId,
    runId: seed.runId,
    projectId: seed.projectId,
    createdAt: seed.createdAt,
    seed,
  };
  writeFileAtomic(join(dir, LOOP_METADATA_FILE), stableSerialize(metadata));
}

/**
 * The record returned for a run whose metadata cannot be read.
 *
 * It exists ONLY to carry `integrity: 'corrupt'` to the pure loader, which
 * turns it into `recovery_required`. Nothing replays from it and nothing may be
 * appended to it — a run without its seed has no starting point, and inventing
 * one would reconstruct history out of today's facts.
 */
function unreadableRecord(runId: string): LoopRunRecord {
  return {
    runId,
    seed: seedLoopRun({
      runId,
      loopId: 'unreadable',
      projectId: 'unreadable',
      workspaceId: null,
      contractRef: 'unreadable',
      contractVersion: 0,
      contractBindingDigest: 'unreadable',
      budget: emptyLoopBudget({
        maxIterations: null, maxTotalDurationMinutes: null, maxSpendMicros: null, currency: null,
        maxTotalTokens: null, maxProviderCalls: null, maxConsecutiveFailures: 0,
      }),
      createdAt: '1970-01-01T00:00:00.000Z',
      provenance: 'offline',
    }),
    events: [],
    snapshot: null,
    previousSnapshot: null,
    integrity: 'corrupt',
  };
}

function safeChildren(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => safeRunSegment(name).ok);
  } catch {
    return [];
  }
}
