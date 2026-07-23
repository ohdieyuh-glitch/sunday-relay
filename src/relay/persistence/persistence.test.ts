import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RELAY_EVENT_KINDS } from '../protocol/envelopes';
import {
  callAuthorization, DEFAULT_RETENTION_POLICY, freshCallBudget, RELAY_STATE_SCHEMA_V0,
  RELAY_STATE_SCHEMA_VERSION, validateRetentionPolicy,
  type PersistedEventInput, type ProviderSessionReference,
} from './contracts';
import { resolveStateRoot, safeRunSegment, resolveRunDir, ensureStateRoot } from './paths';
import { digestOf, sha256Hex, stableSerialize } from './integrity';
import { containsForbiddenMaterial, sanitizePayload, sanitizeText } from './redaction';
import { writeFileAtomic } from './atomic-file';
import { eventChecksum, readJournal, JOURNAL_FILE } from './journal';
import { canTransition, loadSnapshot, replayJournal, snapshotFromState, writeSnapshot } from './snapshot';
import { acquireRunLock, inspectLock } from './lock';
import { createStateStore } from './store';
import { migrateRun } from './migrations';
import { classifySessionReadiness, dogStateForRecovery, recoverRun } from './recovery';
import { stateDoctorReport } from './doctor';

/**
 * Focused persistence tests (Prompt 8.5). Unit + small in-process
 * integration coverage; the cross-PROCESS restart proof lives in
 * verify-harness.ts (also runnable via relay:persistence:contract-verify).
 * No provider call anywhere.
 */

const tmp = (): string => mkdtempSync(join(tmpdir(), 'relay-persist-test-'));

const baseEvent = (runId: string, kind: PersistedEventInput['kind'], payload: Record<string, unknown>, at = '2026-07-25T00:00:00.000Z'): PersistedEventInput => ({
  at, projectId: 'prj-t', missionId: 'msn-t', taskId: 'tsk-t', runId, attemptId: 'attempt-1',
  kind, actor: 'relay-supervised', payload,
});

const initPayload = {
  runId: 'run-a', projectId: 'prj-t', missionId: 'msn-t', taskId: 'tsk-t',
  displayName: 'test', objective: 'obj', maxCalls: 4,
  providerBudgets: { claude: 2, codex: 2 }, phase: 'initialized',
};

describe('storage-root resolution', () => {
  it('honors override, RELAY_STATE_HOME, XDG_STATE_HOME, then the home default', () => {
    const dir = tmp();
    expect(resolveStateRoot({}, dir)).toMatchObject({ ok: true, value: { root: dir, source: 'override' } });
    const viaRelay = resolveStateRoot({ RELAY_STATE_HOME: join(dir, 'r') });
    expect(viaRelay.ok && viaRelay.value.source).toBe('RELAY_STATE_HOME');
    const viaXdg = resolveStateRoot({ XDG_STATE_HOME: join(dir, 'x') });
    expect(viaXdg.ok && viaXdg.value.root.endsWith('sunday-relay')).toBe(true);
    const viaHome = resolveStateRoot({});
    expect(viaHome.ok && viaHome.value.root.includes('.local/state/sunday-relay')).toBe(true);
  });

  it('rejects provider credential/download directories and Git work trees', () => {
    expect(resolveStateRoot({ RELAY_STATE_HOME: '/home/user/.codex/state' }).ok).toBe(false);
    expect(resolveStateRoot({ RELAY_STATE_HOME: '/home/user/Downloads/state' }).ok).toBe(false);
    const repo = tmp();
    mkdirSync(join(repo, '.git'));
    expect(resolveStateRoot({ RELAY_STATE_HOME: repo }).ok).toBe(false);
  });
});

describe('path safety', () => {
  it('rejects traversal-shaped run references', () => {
    for (const bad of ['../escape', 'a/b', '..', '.', '.hidden', 'x'.repeat(200), '']) {
      expect(safeRunSegment(bad).ok, bad).toBe(false);
    }
    expect(safeRunSegment('run_t0001-patha').ok).toBe(true);
  });

  it('rejects symlinked run directories (never followed)', () => {
    const root = tmp();
    ensureStateRoot(root);
    const outside = join(root, '..', `outside-${process.pid}`);
    mkdirSync(outside, { recursive: true });
    symlinkSync(outside, join(root, 'runs', 'run-sym'));
    expect(resolveRunDir(root, 'runs', 'run-sym').ok).toBe(false);
  });
});

describe('atomic writes + permissions', () => {
  it('writes via temp + rename with restrictive mode', () => {
    const dir = tmp();
    const file = join(dir, 'x.json');
    writeFileAtomic(file, '{"a":1}');
    expect(readFileSync(file, 'utf8')).toBe('{"a":1}');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    writeFileAtomic(file, '{"a":2}');
    expect(JSON.parse(readFileSync(file, 'utf8')).a).toBe(2);
  });
});

describe('journal integrity', () => {
  const buildRun = (dir: string): void => {
    const store = createStateStore({ root: dir });
    store.initRun({ runId: 'run-a', projectId: 'prj-t', displayName: 'test', at: '2026-07-25T00:00:00.000Z' });
    expect(store.appendEvent('run-a', baseEvent('run-a', 'run.initialized', initPayload)).ok).toBe(true);
    expect(store.appendEvent('run-a', baseEvent('run-a', 'provider_launch.authorized', {
      provider: 'claude', attempt: 1, lifecycleAfter: 'implementation_running',
    }, '2026-07-25T00:00:01.000Z')).ok).toBe(true);
  };

  it('appends monotonic checksummed events and replays them deterministically', () => {
    const root = tmp();
    buildRun(root);
    const runDir = join(root, 'runs', 'run-a');
    const journal = readJournal(runDir);
    expect(journal.integrity).toBe('ok');
    expect(journal.events.map((e) => e.sequence)).toEqual([1, 2]);
    const replayA = replayJournal('run-a', journal.events);
    const replayB = replayJournal('run-a', journal.events);
    expect(replayA.state).not.toBeNull();
    expect(digestOf(replayA.state)).toBe(digestOf(replayB.state));
    expect(replayA.state?.callBudget.consumed).toBe(1);
  });

  it('drops a torn final line with a diagnostic and never invents the partial event', () => {
    const root = tmp();
    buildRun(root);
    const journalPath = join(root, 'runs', 'run-a', JOURNAL_FILE);
    appendFileSync(journalPath, '{"schemaVersion":"relay-state.v1","eventId":"pev-torn');
    const journal = readJournal(join(root, 'runs', 'run-a'));
    expect(journal.integrity).toBe('truncated_tail');
    expect(journal.events).toHaveLength(2);
    expect(journal.diagnostics.join(' ')).toMatch(/partial final journal line/);
  });

  it('detects tampering (checksum), gaps, interior corruption, and unknown future schemas', () => {
    const root = tmp();
    buildRun(root);
    const runDir = join(root, 'runs', 'run-a');
    const journalPath = join(runDir, JOURNAL_FILE);
    const original = readFileSync(journalPath, 'utf8');
    const lines = original.split('\n').filter((l) => l.trim() !== '');

    const tampered = JSON.parse(lines[0]);
    tampered.payload.maxCalls = 99;
    writeFileSync(journalPath, `${JSON.stringify(tampered)}\n${lines[1]}\n`);
    expect(readJournal(runDir)).toMatchObject({ integrity: 'corrupt' });

    writeFileSync(journalPath, `${lines[1]}\n`); // sequence 2 without 1 → gap
    expect(readJournal(runDir).corruptReason).toMatch(/expected 1/);

    writeFileSync(journalPath, `not-json\n${lines[1]}\n`);
    expect(readJournal(runDir).corruptReason).toMatch(/malformed interior/);

    const future = JSON.parse(lines[0]);
    future.schemaVersion = 'relay-state.v99';
    writeFileSync(journalPath, `${JSON.stringify(future)}\n`);
    expect(readJournal(runDir).corruptReason).toMatch(/unknown schema/);
  });

  it('skips exact duplicate events idempotently (budget not double-consumed)', () => {
    const root = tmp();
    buildRun(root);
    const runDir = join(root, 'runs', 'run-a');
    const journalPath = join(runDir, JOURNAL_FILE);
    const lines = readFileSync(journalPath, 'utf8').split('\n').filter((l) => l.trim() !== '');
    appendFileSync(journalPath, `${lines[1]}\n`);
    const journal = readJournal(runDir);
    expect(journal.integrity).toBe('ok');
    expect(journal.events).toHaveLength(2);
    expect(replayJournal('run-a', journal.events).state?.callBudget.consumed).toBe(1);
  });

  it('the state machine rejects invalid transitions and over-budget authorizations', () => {
    expect(canTransition('initialized', 'implementation_running')).toBe(true);
    expect(canTransition('initialized', 'verified_complete')).toBe(false);
    expect(canTransition('held_for_review', 'repair_running')).toBe(false);
    expect(canTransition('implementation_running', 'recovery_required')).toBe(true);
    expect(canTransition('verified_complete', 'recovery_required')).toBe(false);
    const root = tmp();
    buildRun(root);
    const store = createStateStore({ root });
    const illegal = store.appendEvent('run-a', baseEvent('run-a', 'run.verified_complete', {
      lifecycleAfter: 'verified_complete',
    }, '2026-07-25T00:00:02.000Z'));
    expect(illegal.ok).toBe(false);
    // Over-budget: consume claude twice more (max 2).
    expect(store.appendEvent('run-a', baseEvent('run-a', 'provider_launch.authorized', { provider: 'claude' }, '2026-07-25T00:00:03.000Z')).ok).toBe(true);
    const third = store.appendEvent('run-a', baseEvent('run-a', 'provider_launch.authorized', { provider: 'claude' }, '2026-07-25T00:00:04.000Z'));
    expect(third.ok).toBe(false);
  });
});

describe('snapshots', () => {
  it('rotates previous, validates digests, and falls back current→previous→replay', () => {
    const dir = tmp();
    const replay = replayJournal('run-a', []);
    const snapA = snapshotFromState({ ...replay.state!, lastEventSequence: 1 });
    const snapB = snapshotFromState({ ...replay.state!, lastEventSequence: 2 });
    writeSnapshot(dir, snapA);
    writeSnapshot(dir, snapB);
    expect(loadSnapshot(dir)).toMatchObject({ source: 'current' });
    writeFileSync(join(dir, 'snapshot.json'), '{ corrupt');
    const fallback = loadSnapshot(dir);
    expect(fallback.source).toBe('previous');
    expect(fallback.snapshot?.lastEventSequence).toBe(1);
    writeFileSync(join(dir, 'snapshot.previous.json'), '{ also corrupt');
    expect(loadSnapshot(dir).source).toBe('replay_only');
    // A digest mismatch is rejected even when the JSON parses.
    const forged = { ...snapB, stateDigest: sha256Hex('forged') };
    writeFileSync(join(dir, 'snapshot.json'), JSON.stringify(forged));
    expect(loadSnapshot(dir).source).toBe('replay_only');
  });
});

describe('locks', () => {
  it('holds, rejects a second writer, and releases explicitly', () => {
    const dir = tmp();
    const now = () => '2026-07-25T00:00:00.000Z';
    const first = acquireRunLock(dir, 'test', now);
    expect(first.ok).toBe(true);
    expect(inspectLock(dir).status).toBe('held_by_live_owner');
    const second = acquireRunLock(dir, 'test-2', now);
    expect(second.ok).toBe(false);
    if (first.ok) first.value.lock.release();
    expect(inspectLock(dir).status).toBe('free');
  });

  it('classifies a dead-owner lock stale and reclaims it with the original preserved', () => {
    const dir = tmp();
    const dead = spawnSync(process.execPath, ['-e', '']);
    expect(typeof dead.pid).toBe('number');
    writeFileSync(join(dir, 'lock'), JSON.stringify({
      pid: dead.pid, hostname: require('node:os').hostname(),
      acquiredAt: '2026-07-25T00:00:00.000Z', purpose: 'crashed',
    }));
    expect(inspectLock(dir).status).toBe('stale_owner_dead');
    const reclaimed = acquireRunLock(dir, 'recovery', () => '2026-07-25T00:01:00.000Z');
    expect(reclaimed.ok).toBe(true);
    expect(reclaimed.ok && reclaimed.value.diagnostics.join(' ')).toMatch(/stale lock/);
    const preserved = require('node:fs').readdirSync(dir).some((n: string) => n.startsWith('lock.stale-'));
    expect(preserved).toBe(true);
  });
});

describe('redaction', () => {
  it('drops forbidden keys, redacts secret shapes, bounds strings, strips hidden reasoning', () => {
    const { payload, droppedKeys } = sanitizePayload({
      ok: 'fine', password: 'SENTINEL', apiKey: 'x', accessToken: 'y', transcript: 'raw', prompt: 'body',
      note: 'key sk-FAKETESTNOTREAL000000 embedded', long: 'a'.repeat(5000),
      nested: { authorization: 'Bearer z', keep: 1 },
    });
    expect(droppedKeys).toBeGreaterThanOrEqual(6);
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('SENTINEL');
    expect(serialized).not.toContain('sk-FAKETESTNOTREAL');
    expect(serialized).not.toContain('Bearer z');
    expect((payload.nested as Record<string, unknown>).keep).toBe(1);
    expect((payload.long as string).length).toBeLessThan(2100);
    expect(sanitizeText('my chain of thought here')).toMatch(/REDACTED/);
    expect(containsForbiddenMaterial('clean text')).toBeNull();
    expect(containsForbiddenMaterial('sk-FAKETESTNOTREAL000000')).not.toBeNull();
  });
});

describe('store + recovery (in-process)', () => {
  it('indexes, inspects, recovers with founder-authorization-required plans, and archives', () => {
    const root = tmp();
    const store = createStateStore({ root });
    store.initRun({ runId: 'run-a', projectId: 'prj-t', displayName: 'test', at: '2026-07-25T00:00:00.000Z' });
    store.appendEvent('run-a', baseEvent('run-a', 'run.initialized', initPayload));
    store.appendEvent('run-a', baseEvent('run-a', 'provider_launch.authorized',
      { provider: 'claude', attempt: 1, lifecycleAfter: 'implementation_running' }, '2026-07-25T00:00:01.000Z'));
    expect(store.listRuns()).toHaveLength(1);
    expect(store.listRuns()[0].lifecycle).toBe('implementation_running');

    // Archive of a non-terminal run is refused (evidence-preserving policy).
    expect(store.archiveRun('run-a', '2026-07-25T00:00:02.000Z').ok).toBe(false);

    const recovered = recoverRun({ store, reference: 'run-a', now: () => '2026-07-25T00:00:03.000Z' });
    expect(recovered.ok).toBe(true);
    if (recovered.ok) {
      expect(recovered.value.plan.requiresFounderAuthorizationForLiveCalls).toBe(true);
      expect(recovered.value.plan.outcome).toBe('waiting_for_user');
      expect(recovered.value.plan.callBudget.consumed).toBe(1);
      // Every projection kind is a real protocol event kind (safe Terminal feed).
      for (const event of recovered.value.projectionEvents) {
        expect(RELAY_EVENT_KINDS).toContain(event.kind as never);
      }
    }

    store.appendEvent('run-a', baseEvent('run-a', 'run.stopped_safely',
      { stopReason: 'test stop', lifecycleAfter: 'stopped_safely' }, '2026-07-25T00:00:04.000Z'));
    const archived = store.archiveRun('run-a', '2026-07-25T00:00:05.000Z');
    expect(archived.ok).toBe(true);
    const loaded = store.loadRun('run-a');
    expect(loaded.ok && loaded.value.area).toBe('archive');
    expect(loaded.ok && loaded.value.state?.run.stopReason).toBe('test stop');
  });

  it('load rejects traversal references and the doctor reports truthfully', () => {
    const root = tmp();
    const store = createStateStore({ root });
    expect(store.loadRun('../etc').ok).toBe(false);
    const report = stateDoctorReport({ env: {}, overrideRoot: root, now: '2026-07-25T00:00:00.000Z' });
    expect(report.exitCode).toBe(0);
    expect(report.lines.join('\n')).toContain('State health');
  });
});

describe('migrations', () => {
  it('migrates v0 with a backup, no-ops on current, rejects unknown future schemas', () => {
    const root = tmp();
    ensureStateRoot(root);
    const v0Dir = join(root, 'runs', 'run-v0');
    mkdirSync(v0Dir, { recursive: true });
    writeFileSync(join(v0Dir, 'metadata.json'), JSON.stringify({
      schemaVersion: RELAY_STATE_SCHEMA_V0, runId: 'run-v0', projectId: 'p', displayName: 'old',
      createdAt: 'x', updatedAt: 'x', lifecycle: 'initialized', archived: false,
    }));
    const v0Event = {
      schemaVersion: RELAY_STATE_SCHEMA_V0, eventId: 'pev-run-v0-000001', sequence: 1,
      at: '2026-07-01T00:00:00.000Z', projectId: 'p', runId: 'run-v0',
      kind: 'run.initialized', actor: 'relay-supervised',
      previousStateDigest: 'v0', resultingStateDigest: 'v0',
      payload: { ...initPayload, runId: 'run-v0', budgetMax: 4, maxCalls: undefined },
    };
    writeFileSync(join(v0Dir, JOURNAL_FILE),
      `${stableSerialize({ ...v0Event, checksum: eventChecksum(v0Event as never) })}\n`);

    const store = createStateStore({ root });
    expect(store.loadRun('run-v0').ok).toBe(false); // migrate-first, never guessed

    const migrated = migrateRun(root, 'run-v0', '2026-07-25T00:00:00.000Z');
    expect(migrated.ok && migrated.value.migrated).toBe(true);
    expect(migrated.ok && migrated.value.backupDir && existsSync(migrated.value.backupDir)).toBe(true);
    const loaded = store.loadRun('run-v0');
    expect(loaded.ok && loaded.value.state?.callBudget.maxCalls).toBe(4);
    expect(loaded.ok && loaded.value.metadata.schemaVersion).toBe(RELAY_STATE_SCHEMA_VERSION);

    const noop = migrateRun(root, 'run-v0', '2026-07-25T00:01:00.000Z');
    expect(noop.ok && noop.value.migrated).toBe(false);

    const futureDir = join(root, 'runs', 'run-future');
    mkdirSync(futureDir, { recursive: true });
    writeFileSync(join(futureDir, 'metadata.json'), JSON.stringify({ schemaVersion: 'relay-state.v99' }));
    expect(migrateRun(root, 'run-future', 'now').ok).toBe(false);
  });
});

describe('session readiness + Relay Dog recovery states', () => {
  const session = (over: Partial<ProviderSessionReference>): ProviderSessionReference => ({
    provider: 'claude', adapterId: 'claude-code-local', relayRef: 'r', providerSessionId: 'uuid',
    projectId: 'p', missionId: 'm', taskId: 't', runId: 'run', workspaceId: 'w', attempt: 1,
    executionAuthor: 'claude-code', independenceGroup: 'implementers', initializationVerified: true,
    createdAt: 'x', lastUsedAt: 'x', resumeEligible: true, invalidated: false,
    readiness: 'persisted_unverified', ...over,
  });

  it('classifies persisted references honestly — never proof of availability', () => {
    expect(classifySessionReadiness({ session: session({}), lifecycle: 'revision_required', workspaceReconciliation: 'match' }))
      .toBe('persisted_unverified');
    expect(classifySessionReadiness({ session: session({ invalidated: true }), lifecycle: 'revision_required', workspaceReconciliation: 'match' }))
      .toBe('invalid');
    expect(classifySessionReadiness({ session: session({ providerSessionId: null }), lifecycle: 'revision_required', workspaceReconciliation: 'match' }))
      .toBe('invalid');
    expect(classifySessionReadiness({ session: session({ attempt: 2, resumeEligible: false }), lifecycle: 'held_for_rereview', workspaceReconciliation: 'match' }))
      .toBe('expired');
    expect(classifySessionReadiness({ session: session({}), lifecycle: 'revision_required', workspaceReconciliation: 'missing' }))
      .toBe('resume_unavailable');
    expect(classifySessionReadiness({ session: session({}), lifecycle: 'revision_required', workspaceReconciliation: 'drift' }))
      .toBe('manual_action_required');
  });

  it('derives Relay Dog state from recovered canonical state', () => {
    expect(dogStateForRecovery('waiting_for_user', 'recovery_required')).toBe('waiting_for_user');
    expect(dogStateForRecovery('ready_for_verification', 'recovery_required')).toBe('verifying');
    expect(dogStateForRecovery('ready_for_exact_claude_resume', 'revision_required')).toBe('waiting_for_user');
    expect(dogStateForRecovery('ready_for_exact_codex_resume', 'held_for_rereview')).toBe('waiting_for_user');
    expect(dogStateForRecovery('unrecoverable', 'corrupted')).toBe('stopped_safely');
    expect(dogStateForRecovery('inspection_only', 'verified_complete')).toBe('complete');
  });
});

describe('retention + budget durability primitives', () => {
  it('defaults preserve evidence and validate', () => {
    expect(validateRetentionPolicy(DEFAULT_RETENTION_POLICY)).toEqual([]);
    expect(validateRetentionPolicy({ ...DEFAULT_RETENTION_POLICY, snapshotIntervalEvents: 0 })).not.toEqual([]);
  });

  it('call authorization can never be reset by construction', () => {
    const budget = freshCallBudget(4, { claude: 2, codex: 2 });
    budget.consumed = 4; budget.remaining = 0;
    budget.byProvider.claude.consumed = 2; budget.byProvider.codex.consumed = 2;
    expect(callAuthorization(budget, 'claude').authorized).toBe(false);
    expect(callAuthorization(budget, 'unknown').authorized).toBe(false);
    expect(budget.automaticRetryProhibited).toBe(true);
  });
});

describe('offline process-restart proof (separate Node processes)', () => {
  it('every persistence contract check passes with zero provider calls', async () => {
    const { runPersistenceContractVerification } = await import('./verify-harness');
    const { checks, failures, processesSpawned } = await runPersistenceContractVerification();
    const failed = checks.filter((c) => !c.ok).map((c) => `${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
    expect(failed, failed.join('\n')).toEqual([]);
    expect(failures).toBe(0);
    expect(processesSpawned).toBeGreaterThanOrEqual(30);
  }, 600_000);
});
