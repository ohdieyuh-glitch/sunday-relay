import { existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { fail, ok, relayError, type RelayResult } from '../protocol/errors';
import {
  DEFAULT_RETENTION_POLICY, RELAY_STATE_SCHEMA_VERSION, TERMINAL_LIFECYCLE_STATES,
  type PersistedEvent, type PersistedEventInput, type RetentionPolicy, type RunIndexEntry,
  type RunMetadata, type RunSnapshot,
} from './contracts';
import { digestOf } from './integrity';
import { sanitizePayload } from './redaction';
import { ensureStateRoot, resolveRunDir, safeRunSegment } from './paths';
import { appendEventLine, buildPersistedEvent, readJournal, type JournalReadResult } from './journal';
import {
  applyEvent, loadSnapshot, replayJournal, snapshotFromState, writeSnapshot,
  type ReducedState, type SnapshotSource,
} from './snapshot';
import { readTextIfExists, writeFileAtomic } from './atomic-file';

/**
 * Durable run store (Prompt 8.5). Composes the append-only journal (the
 * authority), derived snapshots, run metadata, the run index, the workspace
 * registry, archive, and quarantine over one canonical state root. All
 * writes are crash-safe (atomic snapshot/metadata/index; durable journal
 * appends); nothing here launches a provider or deletes evidence.
 */

export const METADATA_FILE = 'metadata.json';
export const INDEX_FILE = join('index', 'runs.json');

export interface LoadedRun {
  runDir: string;
  area: 'runs' | 'archive';
  metadata: RunMetadata;
  journal: JournalReadResult;
  /** Authoritative state — full journal replay (null when corrupt). */
  state: ReducedState | null;
  replayProblems: string[];
  snapshotSource: SnapshotSource;
  snapshotDiagnostics: string[];
  /** True when the stored snapshot's digest matches the replayed state. */
  snapshotConsistent: boolean;
}

export interface StateStore {
  readonly root: string;
  readonly retention: RetentionPolicy;
  initRun(input: { runId: string; projectId: string; displayName: string; at: string }): RelayResult<string>;
  appendEvent(runId: string, input: PersistedEventInput): RelayResult<PersistedEvent>;
  loadRun(reference: string): RelayResult<LoadedRun>;
  listRuns(): RunIndexEntry[];
  archiveRun(reference: string, at: string): RelayResult<{ from: string; to: string }>;
  quarantineRun(reference: string, reason: string, at: string): RelayResult<{ to: string }>;
  writeWorkspaceRecord(workspaceId: string, record: Record<string, unknown>): RelayResult<string>;
  /** Project records (Prompt 8.6 CLI product) — safe drafts/settings under
   * `<root>/projects/`, sanitized + atomic like everything else. */
  writeProjectRecord(projectId: string, record: Record<string, unknown>): RelayResult<string>;
  readProjectRecord(projectId: string): RelayResult<Record<string, unknown>>;
  listProjectRecords(): Array<Record<string, unknown>>;
}

export function createStateStore(options: {
  root: string;
  retention?: RetentionPolicy;
}): StateStore {
  const root = options.root;
  const retention = options.retention ?? DEFAULT_RETENTION_POLICY;
  ensureStateRoot(root);

  const readIndex = (): RunIndexEntry[] => {
    const text = readTextIfExists(join(root, INDEX_FILE));
    if (text === null) return [];
    try {
      const parsed = JSON.parse(text) as { runs?: RunIndexEntry[] };
      return Array.isArray(parsed.runs) ? parsed.runs : [];
    } catch {
      return [];
    }
  };
  const writeIndex = (runs: RunIndexEntry[]): void => {
    writeFileAtomic(join(root, INDEX_FILE), JSON.stringify({ schemaVersion: RELAY_STATE_SCHEMA_VERSION, runs }, null, 1));
  };
  const upsertIndex = (entry: RunIndexEntry): void => {
    const runs = readIndex().filter((r) => r.runId !== entry.runId);
    runs.push(entry);
    runs.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    writeIndex(runs);
  };

  const readMetadata = (runDir: string): RunMetadata | null => {
    const text = readTextIfExists(join(runDir, METADATA_FILE));
    if (text === null) return null;
    try { return JSON.parse(text) as RunMetadata; } catch { return null; }
  };
  const writeMetadata = (runDir: string, metadata: RunMetadata): void => {
    writeFileAtomic(join(runDir, METADATA_FILE), JSON.stringify(metadata, null, 1));
  };

  const locateRun = (reference: string): RelayResult<{ runDir: string; area: 'runs' | 'archive' }> => {
    for (const area of ['runs', 'archive'] as const) {
      const dir = resolveRunDir(root, area, reference);
      if (!dir.ok) return dir;
      if (existsSync(dir.value)) return ok({ runDir: dir.value, area });
    }
    return fail(relayError('not-found', 'No persisted run with that reference.'));
  };

  const store: StateStore = {
    root,
    retention,

    initRun(input) {
      const dirResult = resolveRunDir(root, 'runs', input.runId);
      if (!dirResult.ok) return dirResult;
      if (existsSync(dirResult.value)) {
        return fail(relayError('duplicate-command', 'A persisted run with this id already exists.'));
      }
      mkdirSync(dirResult.value, { recursive: true, mode: 0o700 });
      const metadata: RunMetadata = {
        schemaVersion: RELAY_STATE_SCHEMA_VERSION, runId: input.runId, projectId: input.projectId,
        displayName: input.displayName, createdAt: input.at, updatedAt: input.at,
        lifecycle: 'initialized', archived: false,
      };
      writeMetadata(dirResult.value, metadata);
      upsertIndex({
        runId: input.runId, projectId: input.projectId, displayName: input.displayName,
        lifecycle: 'initialized', phase: 'initialized', updatedAt: input.at,
        archived: false, recoveryRequired: false,
      });
      return ok(dirResult.value);
    },

    appendEvent(runId, input) {
      const located = locateRun(runId);
      if (!located.ok) return located;
      const { runDir } = located.value;
      const journal = readJournal(runDir);
      if (journal.integrity === 'corrupt') {
        return fail(relayError('validation-failed',
          `Journal is corrupt (${journal.corruptReason}) — refusing to append; recover or quarantine first.`));
      }
      const replayed = replayJournal(runId, journal.events);
      if (!replayed.state) {
        return fail(relayError('validation-failed', `Journal replay failed: ${replayed.problems.join('; ')}`));
      }
      const previousStateDigest = digestOf(replayed.state);
      const sequence = (journal.events[journal.events.length - 1]?.sequence ?? 0) + 1;
      const draft = buildPersistedEvent({
        base: input, sequence, previousStateDigest, resultingStateDigest: previousStateDigest,
      });
      // Apply to compute the resulting digest, then rebuild with the final
      // digests + checksum (the reducer never reads digest fields).
      const next = structuredClone(replayed.state);
      const applyProblem = applyEvent(next, draft);
      if (applyProblem) {
        return fail(relayError('illegal-transition', `Event rejected by the state machine: ${applyProblem}`));
      }
      const event = buildPersistedEvent({
        base: input, sequence, previousStateDigest, resultingStateDigest: digestOf(next),
      });
      appendEventLine(runDir, event);

      if (sequence % retention.snapshotIntervalEvents === 0 || TERMINAL_LIFECYCLE_STATES.includes(next.run.lifecycle)) {
        writeSnapshot(runDir, snapshotFromState(next));
      }
      const metadata = readMetadata(runDir);
      if (metadata) {
        writeMetadata(runDir, { ...metadata, updatedAt: input.at, lifecycle: next.run.lifecycle });
      }
      upsertIndex({
        runId, projectId: next.project.projectId || metadata?.projectId || '',
        displayName: metadata?.displayName ?? runId,
        lifecycle: next.run.lifecycle, phase: next.run.phase, updatedAt: input.at,
        archived: metadata?.archived ?? false,
        recoveryRequired: next.run.lifecycle === 'recovery_required',
      });
      return ok(event);
    },

    loadRun(reference) {
      const segment = safeRunSegment(reference);
      if (!segment.ok) return segment;
      const located = locateRun(reference);
      if (!located.ok) return located;
      const { runDir, area } = located.value;
      const metadata = readMetadata(runDir);
      if (!metadata) return fail(relayError('not-found', 'Run metadata is missing or unreadable.'));
      if (metadata.schemaVersion !== RELAY_STATE_SCHEMA_VERSION) {
        return fail(relayError('validation-failed',
          `Run uses schema ${metadata.schemaVersion} — migrate it explicitly before loading (never guessed).`));
      }
      const journal = readJournal(runDir);
      const replayed = journal.integrity === 'corrupt'
        ? { state: null, problems: [journal.corruptReason ?? 'corrupt journal'] }
        : replayJournal(reference, journal.events);
      const snap = loadSnapshot(runDir);
      const snapshotConsistent = !!(replayed.state && snap.snapshot &&
        snap.snapshot.stateDigest === snapshotFromState(clampToSequence(replayed.state, snap.snapshot.lastEventSequence, journal, reference)).stateDigest);
      return ok({
        runDir, area, metadata, journal,
        state: replayed.state, replayProblems: replayed.problems,
        snapshotSource: snap.source, snapshotDiagnostics: snap.diagnostics,
        snapshotConsistent,
      });
    },

    listRuns() {
      return readIndex();
    },

    archiveRun(reference, at) {
      const located = locateRun(reference);
      if (!located.ok) return located;
      if (located.value.area === 'archive') {
        return fail(relayError('duplicate-command', 'Run is already archived.'));
      }
      const loaded = store.loadRun(reference);
      if (!loaded.ok) return loaded;
      const lifecycle = loaded.value.state?.run.lifecycle ?? loaded.value.metadata.lifecycle;
      if (!TERMINAL_LIFECYCLE_STATES.includes(lifecycle) && lifecycle !== 'recovery_required') {
        return fail(relayError('illegal-transition',
          `Only a completed, safely-stopped, or explicitly abandoned run may be archived (lifecycle: ${lifecycle}).`));
      }
      const target = resolveRunDir(root, 'archive', reference);
      if (!target.ok) return target;
      renameSync(located.value.runDir, target.value);
      const metadata = readMetadata(target.value);
      if (metadata) writeMetadata(target.value, { ...metadata, archived: true, updatedAt: at });
      const runs = readIndex().map((r) => (r.runId === reference ? { ...r, archived: true, updatedAt: at } : r));
      writeIndex(runs);
      return ok({ from: located.value.runDir, to: target.value });
    },

    quarantineRun(reference, reason, at) {
      const located = locateRun(reference);
      if (!located.ok) return located;
      const target = resolveRunDir(root, 'quarantine', `${reference}-${at.replaceAll(':', '').replaceAll('.', '')}`);
      if (!target.ok) return target;
      renameSync(located.value.runDir, target.value);
      writeFileAtomic(join(target.value, 'quarantine-reason.json'),
        JSON.stringify({ reference, reason, at }, null, 1));
      const runs = readIndex().map((r) => (r.runId === reference
        ? { ...r, lifecycle: 'quarantined' as const, recoveryRequired: false, updatedAt: at } : r));
      writeIndex(runs);
      return ok({ to: target.value });
    },

    writeWorkspaceRecord(workspaceId, record) {
      const segment = safeRunSegment(workspaceId);
      if (!segment.ok) return segment;
      const filePath = join(root, 'workspaces', `${segment.value}.json`);
      writeFileAtomic(filePath, JSON.stringify(record, null, 1));
      return ok(filePath);
    },

    writeProjectRecord(projectId, record) {
      const segment = safeRunSegment(projectId);
      if (!segment.ok) return segment;
      const { payload } = sanitizePayload(record, { maxStringLength: 2000 });
      const filePath = join(root, 'projects', `${segment.value}.json`);
      writeFileAtomic(filePath, JSON.stringify({ schemaVersion: RELAY_STATE_SCHEMA_VERSION, ...payload }, null, 1));
      return ok(filePath);
    },

    readProjectRecord(projectId) {
      const segment = safeRunSegment(projectId);
      if (!segment.ok) return segment;
      const text = readTextIfExists(join(root, 'projects', `${segment.value}.json`));
      if (text === null) return fail(relayError('not-found', 'No project record with that reference.'));
      try {
        return ok(JSON.parse(text) as Record<string, unknown>);
      } catch {
        return fail(relayError('validation-failed', 'Project record is unreadable.'));
      }
    },

    listProjectRecords() {
      const dir = join(root, 'projects');
      if (!existsSync(dir)) return [];
      const records: Array<Record<string, unknown>> = [];
      for (const name of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
        const text = readTextIfExists(join(dir, name));
        if (text === null) continue;
        try { records.push(JSON.parse(text) as Record<string, unknown>); } catch { /* skip unreadable */ }
      }
      return records;
    },
  };
  return store;
}

/** Rebuild the state as of a snapshot's sequence (for consistency checks). */
function clampToSequence(
  fullState: ReducedState, sequence: number, journal: JournalReadResult, runId: string,
): ReducedState {
  if (fullState.lastEventSequence === sequence) return fullState;
  const upTo = journal.events.filter((e) => e.sequence <= sequence);
  const replayed = replayJournal(runId, upTo);
  return replayed.state ?? fullState;
}

export type { RunSnapshot };
