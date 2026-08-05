import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LOOP_JOURNAL_FILE,
  LOOP_METADATA_FILE,
  LOOP_SNAPSHOT_FILE,
  LOOP_SNAPSHOT_PREVIOUS_FILE,
  createLoopRunNodeStore,
  readLoopJournal,
  resolveLoopRunDir,
} from './loop-run-node';
import { stableSerialize } from './integrity';
import { LOCK_FILE } from './lock';
import {
  appendLoopRunEvent,
  buildLoopEvent,
  checkpointLoopRun,
  emptyLoopBudget,
  loopDigest,
  readLoopRun,
  seedLoopRun,
  type RelayLoopEventInput,
  type RelayLoopEventPayload,
  type RelayLoopRun,
} from '../mission/loop/runtime';

/**
 * STAGE 2 — the Loop run on a real filesystem.
 *
 * These tests use an actual temp directory rather than the in-memory backing,
 * because the claims being made are about bytes: that an append survives a
 * process ending, that a torn tail is recovered to the last complete line, that
 * a rotated snapshot leaves the previous copy readable, and that a run's state
 * cannot be written outside its own directory.
 */

const T0 = '2026-08-03T12:00:00.000Z';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'relay-loop-store-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function seed(runId = 'lpr_node1', loopId = 'lpe_node1'): RelayLoopRun {
  return seedLoopRun({
    runId,
    loopId,
    projectId: 'prj_node',
    workspaceId: null,
    contractRef: 'loop-contract-1',
    contractVersion: 1,
    contractBindingDigest: 'binding-1',
    budget: emptyLoopBudget({
      maxIterations: 5, maxTotalDurationMinutes: 60, maxSpendMicros: '1000000',
      currency: 'USD', maxTotalTokens: 100_000, maxProviderCalls: 10, maxConsecutiveFailures: 3,
    }),
    createdAt: T0,
    provenance: 'offline',
  });
}

const base = (
  run: RelayLoopRun,
  payload: RelayLoopEventPayload,
  idempotencyKey: string | null = null,
): RelayLoopEventInput => ({
  at: T0,
  runId: run.runId,
  loopId: run.loopId,
  projectId: run.projectId,
  kind: payload.kind,
  actor: 'founder',
  recoveryGeneration: 0,
  expectedPreviousState: null,
  idempotencyKey,
  payload,
});

/** A store with a created run and the two admission lines written. */
function admitted(runId = 'lpr_node1') {
  const store = createLoopRunNodeStore({ root });
  const run = seed(runId);
  const created = store.createRun(run);
  if (!created.ok) throw new Error(created.error.message);
  for (const [payload, key] of [
    [{ kind: 'loop.contract_confirmed', contractRef: run.contractRef, contractVersion: 1, bindingDigest: 'binding-1', confirmedBy: 'founder' }, null],
    [{ kind: 'loop.run_created', idempotencyKey: 'confirm-1', creationSource: 'cli', createdBy: 'founder' }, 'confirm-1'],
  ] as const) {
    const appended = appendLoopRunEvent(store, {
      runId: run.runId, base: base(run, payload as RelayLoopEventPayload, key), digest: loopDigest,
    });
    if (!appended.ok) throw new Error(appended.problem);
  }
  return { store, run, dir: created.value };
}

/* =================================================== path containment === */

describe('a run cannot write outside its own directory', () => {
  it('refuses a traversal in either identifier', () => {
    expect(resolveLoopRunDir(root, '../escape', 'lpr_1').ok).toBe(false);
    expect(resolveLoopRunDir(root, 'lpe_1', '../../escape').ok).toBe(false);
    expect(resolveLoopRunDir(root, 'lpe_1', 'a/b').ok).toBe(false);
    expect(resolveLoopRunDir(root, '.', 'lpr_1').ok).toBe(false);
    expect(resolveLoopRunDir(root, 'lpe_1', '').ok).toBe(false);
  });

  it('accepts ordinary identifiers and nests runs under their Loop', () => {
    const resolved = resolveLoopRunDir(root, 'lpe_abc', 'lpr_def');
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) throw new Error('unreachable');
    expect(resolved.value).toBe(join(root, 'loops', 'lpe_abc', 'runs', 'lpr_def'));
  });

  it('refuses a run directory that resolves outside the root through a symlink', () => {
    const outside = mkdtempSync(join(tmpdir(), 'relay-loop-outside-'));
    try {
      mkdirSync(join(root, 'loops', 'lpe_link', 'runs'), { recursive: true });
      symlinkSync(outside, join(root, 'loops', 'lpe_link', 'runs', 'lpr_link'), 'dir');
      const resolved = resolveLoopRunDir(root, 'lpe_link', 'lpr_link');
      expect(resolved.ok).toBe(false);
      if (resolved.ok) throw new Error('unreachable');
      expect(resolved.error.message).toContain('outside the state root');
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('keeps state out of the repository checkout', () => {
    const { dir } = admitted();
    // The whole hierarchy lives under the temp state root, which is not this
    // repository. A `git clean` here would destroy the record of paid work.
    expect(dir.startsWith(root)).toBe(true);
    expect(dir).not.toContain(process.cwd());
  });
});

/* ======================================================= durable append === */

describe('the journal is append-only and validated', () => {
  it('writes one NDJSON line per event and reads them back', () => {
    const { store, run, dir } = admitted();
    const raw = readFileSync(join(dir, LOOP_JOURNAL_FILE), 'utf8');
    expect(raw.trimEnd().split('\n')).toHaveLength(2);
    const record = store.read(run.runId);
    expect(record?.events.map((e) => e.sequence)).toEqual([1, 2]);
    expect(record?.integrity).toBe('ok');
  });

  it('reconstructs the run by replaying what it wrote', () => {
    const { store, run } = admitted();
    const loaded = readLoopRun(store, run.runId, loopDigest);
    expect(loaded?.run?.state).toBe('queued');
    expect(loaded?.source).toBe('replay_only');
    expect(loaded?.recoveryRequired).toBe(false);
  });

  it('rejects a sequence gap rather than reducing what remains', () => {
    const { store, run, dir } = admitted();
    const lines = readFileSync(join(dir, LOOP_JOURNAL_FILE), 'utf8').trimEnd().split('\n');
    // A PROPERLY SIGNED line at the wrong sequence. Re-signing matters: a
    // hand-edited line fails its checksum first, which would prove the checksum
    // works and say nothing about gap detection.
    const gapped = buildLoopEvent({
      base: base(run, { kind: 'loop.blocked', blockers: [] }),
      sequence: 7,
      previousStateDigest: 'p',
      resultingStateDigest: 'r',
      digest: loopDigest,
    });
    if (!gapped.ok) throw new Error(gapped.problem);
    writeFileSync(join(dir, LOOP_JOURNAL_FILE), `${lines[0]}\n`);
    appendFileSync(join(dir, LOOP_JOURNAL_FILE), `${stableSerialize(gapped.event)}\n`);

    const journal = readLoopJournal(dir);
    expect(journal.integrity).toBe('corrupt');
    expect(journal.corruptReason).toContain('sequence 7');
    expect(journal.corruptReason).not.toContain('checksum');
    // And the store reports it as an uncertain run, never as a shorter one.
    expect(readLoopRun(store, run.runId, loopDigest)?.source).toBe('recovery_required');
  });

  it('skips an identical redelivered line idempotently', () => {
    const { store, run, dir } = admitted();
    const lines = readFileSync(join(dir, LOOP_JOURNAL_FILE), 'utf8').trimEnd().split('\n');
    appendFileSync(join(dir, LOOP_JOURNAL_FILE), `${lines[1]}\n`);
    const journal = readLoopJournal(dir);
    expect(journal.integrity).toBe('ok');
    expect(journal.events).toHaveLength(2);
    expect(journal.diagnostics.join(' ')).toContain('skipped idempotently');
    expect(readLoopRun(store, run.runId, loopDigest)?.run?.state).toBe('queued');
  });

  it('treats two different lines sharing an event id as corruption', () => {
    const { dir } = admitted();
    const lines = readFileSync(join(dir, LOOP_JOURNAL_FILE), 'utf8').trimEnd().split('\n');
    const parsed = JSON.parse(lines[1]) as Record<string, unknown>;
    appendFileSync(join(dir, LOOP_JOURNAL_FILE), `${stableSerialize({ ...parsed, actor: 'someone-else' })}\n`);
    const journal = readLoopJournal(dir);
    expect(journal.integrity).toBe('corrupt');
    expect(journal.corruptReason).toMatch(/share the event id|checksum/);
  });

  it('detects a tampered line by its checksum', () => {
    const { dir } = admitted();
    const lines = readFileSync(join(dir, LOOP_JOURNAL_FILE), 'utf8').trimEnd().split('\n');
    const parsed = JSON.parse(lines[0]) as Record<string, unknown>;
    writeFileSync(join(dir, LOOP_JOURNAL_FILE), `${stableSerialize({ ...parsed, actor: 'forged' })}\n${lines[1]}\n`);
    const journal = readLoopJournal(dir);
    expect(journal.integrity).toBe('corrupt');
    expect(journal.corruptReason).toContain('checksum');
  });

  it('recovers a torn final line to the last complete event', () => {
    const { store, run, dir } = admitted();
    // Exactly what a kill -9 mid-append leaves behind.
    appendFileSync(join(dir, LOOP_JOURNAL_FILE), '{"schemaVersion":"relay-loop-ev');
    const journal = readLoopJournal(dir);
    expect(journal.integrity).toBe('truncated_tail');
    expect(journal.events).toHaveLength(2);
    expect(journal.diagnostics.join(' ')).toContain('torn write');

    const loaded = readLoopRun(store, run.runId, loopDigest);
    // The complete lines still reduce; the tear is reported, not hidden.
    expect(loaded?.run?.state).toBe('queued');
    expect(loaded?.journalIntegrity).toBe('truncated_tail');
    expect(loaded?.problems.join(' ')).toContain('torn write');
  });

  it('refuses to append to a journal that does not read cleanly', () => {
    const { store, run, dir } = admitted();
    appendFileSync(join(dir, LOOP_JOURNAL_FILE), 'not json at all\nand another line\n');
    const appended = appendLoopRunEvent(store, {
      runId: run.runId,
      base: base(run, { kind: 'loop.agent_assigned', assignment: {
        requestedRole: 'coding_agent', resolvedRole: 'coding_agent', requestedAdapterId: 'fake',
        actualAdapterId: null, actualAgentId: null, actualModel: null, requestedModel: null, assignedAt: T0,
      } }),
      digest: loopDigest,
    });
    expect(appended.ok).toBe(false);
  });

  it('recognises a retry by idempotency key without writing a second line', () => {
    const { store, run, dir } = admitted();
    const before = readFileSync(join(dir, LOOP_JOURNAL_FILE), 'utf8');
    const retry = appendLoopRunEvent(store, {
      runId: run.runId,
      base: base(run, { kind: 'loop.run_created', idempotencyKey: 'confirm-1', creationSource: 'website', createdBy: 'founder' }, 'confirm-1'),
      digest: loopDigest,
    });
    expect(retry.ok && retry.duplicate).toBe(true);
    expect(readFileSync(join(dir, LOOP_JOURNAL_FILE), 'utf8')).toBe(before);
  });
});

/* ========================================================== snapshots === */

describe('snapshots rotate and never outrank the journal', () => {
  it('writes the current snapshot and rotates the old one', () => {
    const { store, run, dir } = admitted();
    expect(checkpointLoopRun(store, run.runId, loopDigest).ok).toBe(true);
    expect(existsSync(join(dir, LOOP_SNAPSHOT_FILE))).toBe(true);
    expect(existsSync(join(dir, LOOP_SNAPSHOT_PREVIOUS_FILE))).toBe(false);

    appendLoopRunEvent(store, {
      runId: run.runId,
      base: base(run, { kind: 'loop.agent_assigned', assignment: {
        requestedRole: 'coding_agent', resolvedRole: 'coding_agent', requestedAdapterId: 'fake',
        actualAdapterId: null, actualAgentId: null, actualModel: null, requestedModel: null, assignedAt: T0,
      } }),
      digest: loopDigest,
    });
    expect(checkpointLoopRun(store, run.runId, loopDigest).ok).toBe(true);
    // The older copy survived the newer write — that is what makes the
    // previous-snapshot fallback possible at all.
    expect(existsSync(join(dir, LOOP_SNAPSHOT_PREVIOUS_FILE))).toBe(true);
    expect(readLoopRun(store, run.runId, loopDigest)?.source).toBe('current');
  });

  it('falls back to the previous snapshot when the current one is unreadable', () => {
    const { store, run, dir } = admitted();
    checkpointLoopRun(store, run.runId, loopDigest);
    checkpointLoopRun(store, run.runId, loopDigest);
    // A crash DURING the snapshot write leaves the current file torn.
    writeFileSync(join(dir, LOOP_SNAPSHOT_FILE), '{"schemaVersion":"relay-loop-run.v1","runId":');
    const loaded = readLoopRun(store, run.runId, loopDigest);
    expect(loaded?.source).toBe('previous');
    expect(loaded?.run?.state).toBe('queued');
  });

  it('falls back to full replay when neither snapshot is usable', () => {
    const { store, run, dir } = admitted();
    checkpointLoopRun(store, run.runId, loopDigest);
    checkpointLoopRun(store, run.runId, loopDigest);
    writeFileSync(join(dir, LOOP_SNAPSHOT_FILE), 'torn');
    writeFileSync(join(dir, LOOP_SNAPSHOT_PREVIOUS_FILE), 'also torn');
    const loaded = readLoopRun(store, run.runId, loopDigest);
    expect(loaded?.source).toBe('replay_only');
    // The journal alone still produced the answer.
    expect(loaded?.run?.state).toBe('queued');
  });

  it('never substitutes a good snapshot for an unreadable journal', () => {
    const { store, run, dir } = admitted();
    checkpointLoopRun(store, run.runId, loopDigest);
    writeFileSync(join(dir, LOOP_JOURNAL_FILE), 'garbage\nmore garbage\n');
    const loaded = readLoopRun(store, run.runId, loopDigest);
    expect(loaded?.source).toBe('recovery_required');
    expect(loaded?.recoveryRequired).toBe(true);
    expect(loaded?.run).toBeNull();
  });

  it('ignores a snapshot written by a build it cannot read', () => {
    const { store, run, dir } = admitted();
    checkpointLoopRun(store, run.runId, loopDigest);
    const snapshot = JSON.parse(readFileSync(join(dir, LOOP_SNAPSHOT_FILE), 'utf8')) as Record<string, unknown>;
    writeFileSync(join(dir, LOOP_SNAPSHOT_FILE), stableSerialize({ ...snapshot, schemaVersion: 'relay-loop-run.v99' }));
    expect(readLoopRun(store, run.runId, loopDigest)?.source).toBe('replay_only');
  });
});

/* ============================================================ locking === */

describe('the run lock', () => {
  it('is taken and released, and a second holder is refused meanwhile', () => {
    const { store, run } = admitted();
    const first = store.lock(run.loopId, run.runId, 'iteration', () => T0);
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error('unreachable');

    const second = store.lock(run.loopId, run.runId, 'iteration', () => T0);
    expect(second.ok).toBe(false);

    first.value.lock.release();
    const third = store.lock(run.loopId, run.runId, 'iteration', () => T0);
    expect(third.ok).toBe(true);
    if (third.ok) third.value.lock.release();
  });

  it('leaves no lock file behind after release', () => {
    const { store, run, dir } = admitted();
    const held = store.lock(run.loopId, run.runId, 'iteration', () => T0);
    if (!held.ok) throw new Error('unreachable');
    expect(existsSync(join(dir, LOCK_FILE))).toBe(true);
    held.value.lock.release();
    expect(existsSync(join(dir, LOCK_FILE))).toBe(false);
  });

  it('classifies a stale lock from a dead process and reclaims it', () => {
    const { store, run, dir } = admitted();
    // A pid that cannot exist, on this host: the documented reclaim condition.
    writeFileSync(join(dir, LOCK_FILE), JSON.stringify({
      pid: 2_147_483_600, hostname: require('node:os').hostname(), acquiredAt: T0, purpose: 'crashed',
    }));
    const inspected = store.inspect(run.loopId, run.runId);
    expect(inspected.ok).toBe(true);
    if (!inspected.ok) throw new Error('unreachable');
    expect(inspected.value.status).toBe('stale_owner_dead');

    const reclaimed = store.lock(run.loopId, run.runId, 'iteration', () => T0);
    expect(reclaimed.ok).toBe(true);
    if (!reclaimed.ok) throw new Error('unreachable');
    // The stale lock is PRESERVED for diagnosis rather than deleted.
    expect(reclaimed.value.diagnostics.join(' ')).toContain('preserved');
    reclaimed.value.lock.release();
  });

  it('inspects without acquiring', () => {
    const { store, run, dir } = admitted();
    expect(store.inspect(run.loopId, run.runId).ok).toBe(true);
    expect(existsSync(join(dir, LOCK_FILE))).toBe(false);
  });
});

/* =========================================================== restart === */

describe('a restart reconstructs the same run', () => {
  it('replays to identical state from a brand-new store instance', () => {
    const { store, run } = admitted();
    for (const payload of [
      { kind: 'loop.agent_assigned', assignment: {
        requestedRole: 'coding_agent' as const, resolvedRole: 'coding_agent' as const, requestedAdapterId: 'fake',
        actualAdapterId: null, actualAgentId: null, actualModel: null, requestedModel: null, assignedAt: T0,
      } },
      { kind: 'loop.iteration_started', iterationId: 'lpi_1', ordinal: 1 },
    ] as const) {
      const appended = appendLoopRunEvent(store, {
        runId: run.runId, base: base(run, payload as RelayLoopEventPayload), digest: loopDigest,
      });
      if (!appended.ok) throw new Error(appended.problem);
    }
    const before = readLoopRun(store, run.runId, loopDigest);

    // A different process would build a fresh store over the same bytes.
    const restarted = createLoopRunNodeStore({ root });
    const after = readLoopRun(restarted, run.runId, loopDigest);

    expect(after?.run?.state).toBe(before?.run?.state);
    expect(loopDigest(after?.run)).toBe(loopDigest(before?.run));
    expect(after?.run?.iterations).toHaveLength(1);
  });

  it('finds a run whose Loop this process has never seen', () => {
    const { run } = admitted('lpr_unseen');
    const fresh = createLoopRunNodeStore({ root });
    expect(fresh.read(run.runId)?.events).toHaveLength(2);
  });

  it('reports an unknown run as absent, never as empty', () => {
    const store = createLoopRunNodeStore({ root });
    expect(store.read('lpr_missing')).toBeNull();
    expect(readLoopRun(store, 'lpr_missing', loopDigest)).toBeNull();
  });

  it('treats a run whose metadata cannot be read as uncertain, not as new', () => {
    const { store, run, dir } = admitted();
    writeFileSync(join(dir, LOOP_METADATA_FILE), 'not json');
    const record = store.read(run.runId);
    expect(record?.integrity).toBe('corrupt');
    expect(readLoopRun(store, run.runId, loopDigest)?.source).toBe('recovery_required');
  });
});
