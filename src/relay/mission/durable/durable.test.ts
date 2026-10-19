import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DURABLE_MISSION_SCHEMA_VERSION,
  type DurableMissionRecordDraft,
} from './durable-contracts';
import { digestOf, sha256Hex, stableSerialize } from './durable-digest';
import {
  readDurableRecord,
  redactDurableRecord,
  sealDurableRecord,
  verifyDurableChecksum,
} from './durable-record';
import {
  createDurableMissionStore,
  createInMemoryDurableBacking,
} from './durable-store';
import {
  claimLease,
  createResumeCoordinator,
  leaseAllows,
  shouldCheckpoint,
} from './durable-checkpoint';
import { assessRecovery, executionMayStart } from './durable-recovery';

/**
 * The canonical durable mission record: identical digests on both surfaces,
 * sealing + validation, rejection of malformed / future / tampered records,
 * checkpoint policy, ownership, and recovery classification. All pure.
 */

const NOW = '2026-08-01T10:00:00.000Z';

function draft(overrides: Partial<DurableMissionRecordDraft> = {}): DurableMissionRecordDraft {
  return {
    schemaVersion: DURABLE_MISSION_SCHEMA_VERSION,
    missionId: 'mission-1',
    projectId: 'rly-002',
    missionContractRef: 'rly-002:mission-1',
    missionContractRevision: 'r1',
    assignments: [
      {
        role: 'coding_agent',
        displayName: 'Claude Code',
        requestedRuntime: 'Claude Code',
        actualRuntime: null,
        environmentRef: 'env-local',
        grantedTools: ['Read files', 'Edit assigned files'],
      },
    ],
    missionState: 'coding',
    stage: 'coding_agent_working',
    currentTaskRef: 'exec-1',
    lastCompletedAction: {
      actionId: 'a-1',
      kind: 'command',
      summary: 'RUN typecheck',
      startedAt: NOW,
      outcome: 'completed',
      completedAt: NOW,
    },
    inFlightAction: null,
    evidence: {
      filesReportedChanged: ['src/relay/ui/app/store.ts'],
      commandsReported: ['RUN typecheck'],
      testStatus: 'passed',
      evidenceRefs: ['att-1'],
      traceLedgerRefs: ['ev-1'],
      executionCapsuleRefs: ['exec-1'],
      findingRefs: [],
      repairRefs: [],
      handoffRefs: ['digest-1'],
      approvalRefs: [],
    },
    usage: {
      costReceiptRefs: ['receipt-1'],
      knownCostMicros: null,
      currency: null,
      budgetStatus: 'under_budget',
      usageProvenance: 'offline',
    },
    interruptionReason: null,
    provenance: 'offline',
    createdAt: NOW,
    updatedAt: NOW,
    checkpointReason: 'bounded_task_completed',
    checkpointAt: NOW,
    recoveryGeneration: 0,
    owner: null,
    ...overrides,
  };
}

const env = (overrides: Partial<Parameters<typeof assessRecovery>[1]> = {}) => ({
  runtimeAvailable: false,
  budgetSufficient: true,
  sessionId: 'session-a',
  now: NOW,
  ...overrides,
});

/* --------------------------------------------------------------- digest */

describe('shared digest', () => {
  it('matches node:crypto exactly, so browser and Node checksums agree', () => {
    for (const sample of ['', 'abc', 'relay', 'héllo — ünicode ✓', '🐕 relay dog', 'x'.repeat(500)]) {
      expect(sha256Hex(sample), sample.slice(0, 12)).toBe(
        createHash('sha256').update(sample, 'utf8').digest('hex'),
      );
    }
  });

  it('serializes deterministically regardless of key order', () => {
    expect(stableSerialize({ b: 1, a: 2 })).toBe(stableSerialize({ a: 2, b: 1 }));
    expect(digestOf({ b: 1, a: 2 })).toBe(digestOf({ a: 2, b: 1 }));
  });
});

/* ------------------------------------------------------- seal + validate */

describe('sealing and validation', () => {
  it('round-trips a record through the canonical interface', async () => {
    const store = createDurableMissionStore(createInMemoryDurableBacking());
    const written = await store.write(draft());
    expect(written.ok).toBe(true);
    const read = await store.read('mission-1');
    expect(read.ok).toBe(true);
    if (!read.ok || !written.ok) throw new Error('expected a readable record');
    expect(read.record).toEqual(written.record);
    expect(read.record.evidence.filesReportedChanged).toEqual(['src/relay/ui/app/store.ts']);
  });

  it('verifies its own checksum and rejects a tampered record', () => {
    const sealed = sealDurableRecord(draft());
    expect(verifyDurableChecksum(sealed)).toBe(true);
    const tampered = { ...sealed, missionState: 'verified_complete' };
    expect(verifyDurableChecksum(tampered)).toBe(false);
    const result = readDurableRecord(tampered);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('tampered record must not load');
    expect(result.reason).toBe('corrupt');
  });

  it('rejects malformed records without inventing an empty mission', () => {
    for (const bad of [
      null,
      'not-an-object',
      {},
      { schemaVersion: DURABLE_MISSION_SCHEMA_VERSION },
      { ...sealDurableRecord(draft()), missionId: '' },
    ]) {
      const result = readDurableRecord(bad);
      expect(result.ok, JSON.stringify(bad).slice(0, 40)).toBe(false);
    }
    // …and nothing ever comes back as a usable blank mission.
    const empty = readDurableRecord({});
    expect(empty.ok).toBe(false);
  });

  it('reports a FUTURE schema as unsupported, not as corrupt', () => {
    const future = { ...sealDurableRecord(draft()), schemaVersion: 'relay-durable-mission.v99' };
    const result = readDurableRecord(future);
    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== 'unsupported_version') {
      throw new Error('future record must be reported as an unsupported version');
    }
    expect(result.detail).toContain('relay-durable-mission.v99');
  });

  it('a supported current-version record loads and reports no migration', () => {
    const result = readDurableRecord(sealDurableRecord(draft()));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('current record must load');
    expect(result.migrated).toBe(false);
    expect(result.record.schemaVersion).toBe(DURABLE_MISSION_SCHEMA_VERSION);
  });

  it('missing values stay null — a missing cost never becomes zero', () => {
    const sealed = sealDurableRecord(draft());
    expect(sealed.usage.knownCostMicros).toBeNull();
    expect(JSON.stringify(sealed)).not.toContain('"knownCostMicros":0');
    const zeroed = { ...sealed, usage: { ...sealed.usage, knownCostMicros: 0 as never } };
    expect(readDurableRecord(zeroed).ok).toBe(false);
  });
});

/* ------------------------------------------------------------- secrets */

describe('secret handling', () => {
  it('never serializes credential-shaped keys or values', () => {
    const sealed = sealDurableRecord({
      ...draft(),
      // Callers cannot smuggle these through — they are dropped at seal time.
      ...({
        apiKey: 'sk-FAKETESTNOTREALFAKETESTNOTREAL',
        accessToken: 'ghp_FAKETESTNOTREALFAKETESTNOTREAL00',
        environmentValues: { HOME: '/root' },
        transcript: 'the whole conversation',
        systemPrompt: 'you are…',
      } as Partial<DurableMissionRecordDraft>),
      interruptionReason: 'stopped while using sk-FAKETESTNOTREALabcdefgh',
    });
    const serialized = JSON.stringify(sealed);
    expect(serialized).not.toContain('apiKey');
    expect(serialized).not.toContain('accessToken');
    expect(serialized).not.toContain('environmentValues');
    expect(serialized).not.toContain('transcript');
    expect(serialized).not.toContain('systemPrompt');
    expect(serialized).not.toMatch(/sk-[A-Za-z0-9]{8,}/);
    expect(serialized).toContain('[REDACTED]');
  });

  it('references the Mission Contract instead of copying its instructions', () => {
    const sealed = sealDurableRecord({
      ...draft(),
      ...({ instructions: ['do the thing', 'then the other thing'] } as Partial<DurableMissionRecordDraft>),
    });
    const serialized = JSON.stringify(sealed);
    expect(serialized).toContain('rly-002:mission-1');
    expect(serialized).toContain('"missionContractRevision":"r1"');
    expect(serialized).not.toContain('do the thing');
  });

  it('redaction is idempotent and bounded', () => {
    const once = redactDurableRecord(draft());
    expect(redactDurableRecord(once)).toEqual(once);
  });
});

/* ---------------------------------------------------------- checkpoints */

describe('checkpoint policy', () => {
  it('always writes the first checkpoint', () => {
    const decision = shouldCheckpoint({
      reason: 'mission_execution_began',
      previous: null,
      next: draft(),
    });
    expect(decision.write).toBe(true);
  });

  it('skips a boundary that changed nothing material', () => {
    const previous = sealDurableRecord(draft());
    const decision = shouldCheckpoint({
      reason: previous.checkpointReason,
      previous,
      next: draft({ updatedAt: '2026-08-01T10:05:00.000Z' }),
    });
    expect(decision.write).toBe(false);
    expect(decision.skipped).toContain('no material change');
  });

  it('writes when the mission actually moved', () => {
    const previous = sealDurableRecord(draft());
    for (const next of [
      draft({ missionState: 'relay_verifying' }),
      draft({ stage: 'reviewing' }),
      draft({ evidence: { ...draft().evidence, findingRefs: ['F-1'] } }),
      draft({ usage: { ...draft().usage, budgetStatus: 'warning' } }),
    ]) {
      expect(shouldCheckpoint({ reason: next.checkpointReason, previous, next }).write).toBe(true);
    }
  });
});

/* -------------------------------------------------------------- leases */

describe('ownership leases', () => {
  it('allows the holder and blocks a different live session', () => {
    const record = sealDurableRecord(draft({ owner: claimLease('session-a', NOW) }));
    expect(leaseAllows(record, 'session-a', NOW)).toBe(true);
    expect(leaseAllows(record, 'session-b', NOW)).toBe(false);
  });

  it('lets another session take over an EXPIRED lease', () => {
    const record = sealDurableRecord(draft({ owner: claimLease('session-a', NOW) }));
    const later = '2026-08-01T10:01:00.000Z'; // beyond the 30s lease
    expect(leaseAllows(record, 'session-b', later)).toBe(true);
  });
});

/* -------------------------------------------------------- duplicate work */

describe('resume is idempotent', () => {
  it('two concurrent Resume clicks produce ONE accepted resume', async () => {
    const store = createDurableMissionStore(createInMemoryDurableBacking());
    await store.write(draft());
    const coordinator = createResumeCoordinator(store);
    const [first, second] = await Promise.all([
      coordinator.resume({ missionId: 'mission-1', sessionId: 'session-a', now: NOW }),
      coordinator.resume({ missionId: 'mission-1', sessionId: 'session-a', now: NOW }),
    ]);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error('both calls should resolve ok');
    // Exactly one generation was consumed.
    expect(first.record.recoveryGeneration).toBe(1);
    expect(second.record.recoveryGeneration).toBe(1);
    expect([first.alreadyOwned, second.alreadyOwned].filter(Boolean)).toHaveLength(1);
  });

  it('a sequential repeat click does not bump the generation again', async () => {
    const store = createDurableMissionStore(createInMemoryDurableBacking());
    await store.write(draft());
    const coordinator = createResumeCoordinator(store);
    const first = await coordinator.resume({ missionId: 'mission-1', sessionId: 'session-a', now: NOW });
    const second = await coordinator.resume({ missionId: 'mission-1', sessionId: 'session-a', now: NOW });
    expect(first.ok && second.ok).toBe(true);
    if (!second.ok) throw new Error('second resume should resolve ok');
    expect(second.alreadyOwned).toBe(true);
    expect(second.record.recoveryGeneration).toBe(1);
  });

  it('refuses to resume a mission another live session holds', async () => {
    const store = createDurableMissionStore(createInMemoryDurableBacking());
    await store.write(draft({ owner: claimLease('session-a', NOW) }));
    const coordinator = createResumeCoordinator(store);
    const outcome = await coordinator.resume({ missionId: 'mission-1', sessionId: 'session-b', now: NOW });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('a held mission must not resume');
    expect(outcome.reason).toContain('another session');
  });
});

/* ------------------------------------------------------------ recovery */

describe('recovery classification', () => {
  const read = async (record: DurableMissionRecordDraft) => {
    const store = createDurableMissionStore(createInMemoryDurableBacking());
    await store.write(record);
    return store.read(record.missionId);
  };

  it('a clean record is ready to resume — and never claims a live runtime', async () => {
    const assessment = assessRecovery(await read(draft()), env());
    expect(assessment.classification).toBe('ready_to_resume');
    expect(assessment.canResume).toBe(true);
    expect(assessment.runtimeReconnected).toBe(false);
    expect(assessment.summary).toContain('No runtime is attached');
    // …and with no runtime, execution may not start.
    expect(executionMayStart(assessment, env())).toBe(false);
    expect(executionMayStart(assessment, env({ runtimeAvailable: true }))).toBe(true);
  });

  it('an interrupted action with an unknown outcome is NOT replayed', async () => {
    const assessment = assessRecovery(
      await read(draft({
        inFlightAction: {
          actionId: 'a-9',
          kind: 'command',
          summary: 'RUN migration',
          startedAt: NOW,
          outcome: 'unknown',
          completedAt: null,
        },
      })),
      env(),
    );
    expect(assessment.classification).toBe('cannot_resume_safely');
    expect(assessment.canResume).toBe(false);
    expect(assessment.summary).toContain('cannot tell whether');
    expect(assessment.diagnostics.join(' ')).toContain('will not be repeated automatically');
  });

  it('classifies paused, awaiting approval, budget, environment and completion', async () => {
    const paused = assessRecovery(await read(draft({ checkpointReason: 'mission_paused' })), env());
    expect(paused.classification).toBe('paused');
    expect(paused.canResume).toBe(true);

    const approval = assessRecovery(
      await read(draft({ checkpointReason: 'approval_requested' })), env(),
    );
    expect(approval.classification).toBe('awaiting_approval');

    const budget = assessRecovery(await read(draft()), env({ budgetSufficient: false }));
    expect(budget.classification).toBe('budget_blocked');
    expect(budget.blocking).toBe(true);

    const environment = assessRecovery(
      await read(draft()), env({ knownEnvironmentRefs: ['env-other'] }),
    );
    expect(environment.classification).toBe('environment_requires_inspection');

    const done = assessRecovery(await read(draft({ missionState: 'verified_complete' })), env());
    expect(done.classification).toBe('completed');
    expect(done.canResume).toBe(false);
  });

  it('a corrupt record blocks recovery and is never silently discarded', () => {
    const assessment = assessRecovery(
      { ok: false, reason: 'corrupt', detail: 'checksum does not match record contents' },
      env(),
    );
    expect(assessment.classification).toBe('record_corrupt');
    expect(assessment.blocking).toBe(true);
    expect(assessment.record).toBeNull();
    expect(assessment.diagnostics.join(' ')).toContain('left untouched for inspection');
  });

  it('an unsupported version is reported as such, not as corruption', () => {
    const assessment = assessRecovery(
      { ok: false, reason: 'unsupported_version', detail: 'record schema v99' },
      env(),
    );
    expect(assessment.classification).toBe('unsupported_record_version');
    expect(assessment.summary).toContain('newer version');
  });

  it('a mission held by another session cannot be resumed', async () => {
    const assessment = assessRecovery(
      await read(draft({ owner: claimLease('session-b', NOW) })),
      env({ sessionId: 'session-a' }),
    );
    expect(assessment.classification).toBe('cannot_resume_safely');
  });

  it('a stale contract revision blocks resume', async () => {
    const assessment = assessRecovery(
      await read(draft()),
      env({ knownContractRevisions: ['r2'] }),
    );
    expect(assessment.classification).toBe('cannot_resume_safely');
    expect(assessment.diagnostics.join(' ')).toContain('no longer resolves');
  });

  it('review findings and known costs survive the round trip', async () => {
    const withEvidence = draft({
      evidence: { ...draft().evidence, findingRefs: ['F-1', 'F-2'], repairRefs: ['R-1'] },
      usage: { ...draft().usage, knownCostMicros: '1250000', currency: 'USD' },
    });
    const assessment = assessRecovery(await read(withEvidence), env());
    expect(assessment.record?.evidence.findingRefs).toEqual(['F-1', 'F-2']);
    expect(assessment.record?.evidence.repairRefs).toEqual(['R-1']);
    expect(assessment.record?.usage.knownCostMicros).toBe('1250000');
  });

  it('simulated provenance stays disclosed through recovery', async () => {
    const assessment = assessRecovery(await read(draft({ provenance: 'simulated' })), env());
    expect(assessment.record?.provenance).toBe('simulated');
  });
});

/* ----------------------------------------------------- write failures */

describe('durable write failures', () => {
  it('a failed write reports failure — never success', async () => {
    const backing = createInMemoryDurableBacking({ failWrites: true });
    const store = createDurableMissionStore(backing);
    const result = await store.write(draft());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('a failing backing must not report success');
    expect(result.reason).toBe('storage unavailable');
  });

  it('a failed write leaves the previous known-good record readable', async () => {
    const backing = createInMemoryDurableBacking();
    const store = createDurableMissionStore(backing);
    await store.write(draft({ stage: 'first' }));
    backing.failWrites = true;
    const failed = await store.write(draft({ stage: 'second' }));
    expect(failed.ok).toBe(false);
    const read = await store.read('mission-1');
    expect(read.ok).toBe(true);
    if (!read.ok) throw new Error('previous checkpoint must survive');
    expect(read.record.stage).toBe('first');
  });

  it('an in-memory backing never claims durability', () => {
    const store = createDurableMissionStore(createInMemoryDurableBacking());
    expect(store.durability).toBe('volatile-test-only');
    expect(store.locationLabel).toContain('not durable');
  });
});
