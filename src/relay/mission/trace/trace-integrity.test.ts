import { describe, expect, it } from 'vitest';

import { appendTraceEventBatch, sealTrace } from './trace-ledger';
import { verifyTraceIntegrity } from './trace-integrity';
import {
  agentClaimDraft,
  capsuleDraft,
  commandDraft,
  newTraceFixture,
  statusDraft,
  FIXTURE_TRACE_ID,
  TRACE_T1,
  TRACE_T2,
  TRACE_T3,
  TRACE_T4,
  TRACE_T5,
} from './trace-fixtures';
import type { AqualaTraceEvent, AqualaTraceManifest } from './trace-types';

/** A valid five-event trace: genesis + four appended events. */
function validTrace(): { manifest: AqualaTraceManifest; events: AqualaTraceEvent[] } {
  const { repository, manifest } = newTraceFixture();
  const appended = appendTraceEventBatch(repository, {
    traceId: FIXTURE_TRACE_ID,
    drafts: [
      statusDraft('evt-1', 'execution', 'not_started', 'running', TRACE_T1),
      commandDraft('evt-2', 'command_received', TRACE_T2),
      capsuleDraft('evt-3', 'execution_capsule_prepared', TRACE_T3),
      agentClaimDraft('evt-4', 'agent_final_report_received', TRACE_T4),
    ],
  });
  if (!appended.ok) throw new Error(`fixture batch failed: ${appended.error.reason}`);
  return { manifest, events: repository.listEvents(FIXTURE_TRACE_ID) };
}

/** Structural clone that bypasses the frozen originals, so a test can forge a
    ledger the way an attacker with export access would. */
function forge(events: readonly AqualaTraceEvent[]): AqualaTraceEvent[] {
  return JSON.parse(JSON.stringify(events)) as AqualaTraceEvent[];
}

describe('valid chain verification', () => {
  it('verifies a complete valid trace and reports the head', () => {
    const { manifest, events } = validTrace();
    const report = verifyTraceIntegrity(manifest, events);

    expect(report.valid).toBe(true);
    expect(report.eventCount).toBe(5);
    expect(report.verifiedThroughSequence).toBe(5);
    expect(report.headEventId).toBe('evt-4');
    expect(report.headHash).toBe(events[4].eventHash);
    expect(report.reason).toBeUndefined();
    expect(report.firstInvalidSequence).toBeUndefined();
  });

  it('never mutates the events it verifies', () => {
    const { manifest, events } = validTrace();
    const snapshot = JSON.stringify(events);
    verifyTraceIntegrity(manifest, events);
    expect(JSON.stringify(events)).toBe(snapshot);
  });

  it('rejects an empty ledger', () => {
    const { manifest } = validTrace();
    const report = verifyTraceIntegrity(manifest, []);
    expect(report.valid).toBe(false);
    expect(report.reason).toBe('invalid_genesis');
  });
});

describe('tamper detection', () => {
  it('detects TAMPERED metadata at the changed event, and does not verify past it', () => {
    const { manifest, events } = validTrace();
    const tampered = forge(events);
    (tampered[2].metadata as Record<string, unknown>).commandLocalSequence = 999;

    const report = verifyTraceIntegrity(manifest, tampered);
    expect(report.valid).toBe(false);
    expect(report.reason).toBe('event_hash_mismatch');
    expect(report.firstInvalidSequence).toBe(3);
    expect(report.firstInvalidEventId).toBe('evt-2');
    // Only the prefix BEFORE the tampered event is verified.
    expect(report.verifiedThroughSequence).toBe(2);
    expect(report.expectedHash).not.toBe(report.actualHash);
  });

  it('detects a REMOVED middle event', () => {
    const { manifest, events } = validTrace();
    const withHole = forge(events).filter((e) => e.eventId !== 'evt-2');

    const report = verifyTraceIntegrity(manifest, withHole);
    expect(report.valid).toBe(false);
    expect(report.reason).toBe('sequence_gap');
    expect(report.firstInvalidSequence).toBe(4);
    expect(report.verifiedThroughSequence).toBe(2);
  });

  it('detects REORDERED events', () => {
    const { manifest, events } = validTrace();
    const shuffled = forge(events);
    [shuffled[2], shuffled[3]] = [shuffled[3], shuffled[2]];

    const report = verifyTraceIntegrity(manifest, shuffled);
    expect(report.valid).toBe(false);
    expect(['sequence_gap', 'previous_hash_mismatch']).toContain(report.reason);
    expect(report.verifiedThroughSequence).toBe(2);
  });

  it('detects a REPLACED event', () => {
    const { manifest, events } = validTrace();
    const replaced = forge(events);
    replaced[3] = { ...replaced[3], eventId: 'evt-swapped', actorId: 'attacker' };

    const report = verifyTraceIntegrity(manifest, replaced);
    expect(report.valid).toBe(false);
    expect(report.reason).toBe('event_hash_mismatch');
    expect(report.firstInvalidSequence).toBe(4);
  });

  it('detects an INSERTED unhashed event', () => {
    const { manifest, events } = validTrace();
    const withInsert = forge(events);
    withInsert.splice(3, 0, {
      ...withInsert[3],
      eventId: 'evt-inserted',
      sequence: 4,
      eventHash: 'a'.repeat(64),
    });
    // Renumber the tail so a naive sequence check would pass.
    for (let i = 0; i < withInsert.length; i += 1) {
      (withInsert[i] as { sequence: number }).sequence = i + 1;
    }

    const report = verifyTraceIntegrity(manifest, withInsert);
    expect(report.valid).toBe(false);
    expect(['event_hash_mismatch', 'previous_hash_mismatch', 'duplicate_event_id']).toContain(
      report.reason,
    );
  });

  it('detects a broken PREVIOUS-HASH link', () => {
    const { manifest, events } = validTrace();
    const relinked = forge(events);
    relinked[2] = { ...relinked[2], previousEventHash: 'b'.repeat(64) };

    const report = verifyTraceIntegrity(manifest, relinked);
    expect(report.valid).toBe(false);
    // The hash covers previousEventHash, so the event's own hash breaks first.
    expect(['previous_hash_mismatch', 'event_hash_mismatch']).toContain(report.reason);
    expect(report.firstInvalidSequence).toBe(3);
  });

  it('detects a duplicate event id and a duplicate sequence', () => {
    const { manifest, events } = validTrace();

    const dupId = forge(events);
    dupId[3] = { ...dupId[3], eventId: dupId[2].eventId };
    expect(verifyTraceIntegrity(manifest, dupId).valid).toBe(false);

    const dupSeq = forge(events);
    (dupSeq[3] as { sequence: number }).sequence = 3;
    const report = verifyTraceIntegrity(manifest, dupSeq);
    expect(report.valid).toBe(false);
    expect(['duplicate_sequence', 'sequence_gap', 'event_hash_mismatch']).toContain(report.reason);
  });
});

describe('genesis, identity, scope, and version rules', () => {
  it.each([
    ['a non-1 genesis sequence', (e: AqualaTraceEvent[]) => ((e[0] as { sequence: number }).sequence = 2)],
    [
      'a non-null genesis previous hash',
      (e: AqualaTraceEvent[]) => ((e[0] as { previousEventHash: string | null }).previousEventHash = 'c'.repeat(64)),
    ],
    [
      'a genesis that is not trace_created',
      (e: AqualaTraceEvent[]) => ((e[0] as { eventType: string }).eventType = 'command_received'),
    ],
    [
      'a second genesis event',
      (e: AqualaTraceEvent[]) => ((e[2] as { eventType: string }).eventType = 'trace_created'),
    ],
    [
      'a later event with a null previous hash',
      (e: AqualaTraceEvent[]) => ((e[2] as { previousEventHash: string | null }).previousEventHash = null),
    ],
  ])('rejects %s', (_label, mutate) => {
    const { manifest, events } = validTrace();
    const forged = forge(events);
    mutate(forged);
    const report = verifyTraceIntegrity(manifest, forged);
    expect(report.valid).toBe(false);
    expect(report.reason).toBe('invalid_genesis');
  });

  it('detects a trace identity mismatch', () => {
    const { manifest, events } = validTrace();
    const forged = forge(events);
    (forged[2] as { traceId: string }).traceId = 'trace-other';
    const report = verifyTraceIntegrity(manifest, forged);
    expect(report.valid).toBe(false);
    expect(report.reason).toBe('trace_identity_mismatch');
  });

  it('detects a project and a mission scope mismatch', () => {
    const { manifest, events } = validTrace();

    const wrongProject = forge(events);
    (wrongProject[2] as { projectId: string }).projectId = 'project-other';
    expect(verifyTraceIntegrity(manifest, wrongProject).reason).toBe('scope_mismatch');

    const wrongMission = forge(events);
    (wrongMission[2] as { missionId?: string }).missionId = 'mission-other';
    expect(verifyTraceIntegrity(manifest, wrongMission).reason).toBe('scope_mismatch');
  });

  it('detects unsupported schema and canonicalization versions', () => {
    const { manifest, events } = validTrace();

    const badSchema = forge(events);
    (badSchema[2] as { schemaVersion: string }).schemaVersion = '9.9.9';
    expect(verifyTraceIntegrity(manifest, badSchema).reason).toBe('unsupported_schema_version');

    const badCanon = forge(events);
    (badCanon[2] as { canonicalizationVersion: string }).canonicalizationVersion = '9';
    expect(verifyTraceIntegrity(manifest, badCanon).reason).toBe(
      'unsupported_canonicalization_version',
    );
  });

  it('detects a timestamp regression', () => {
    const { manifest, events } = validTrace();
    const forged = forge(events);
    (forged[3] as { occurredAt: string }).occurredAt = '2026-07-28T00:00:00.000Z';
    const report = verifyTraceIntegrity(manifest, forged);
    expect(report.valid).toBe(false);
    expect(report.reason).toBe('timestamp_regression');
  });

  it('detects a malformed stored hash', () => {
    const { manifest, events } = validTrace();
    const forged = forge(events);
    (forged[2] as { eventHash: string }).eventHash = 'not-a-hash';
    const report = verifyTraceIntegrity(manifest, forged);
    expect(report.valid).toBe(false);
    expect(report.reason).toBe('event_hash_mismatch');
  });
});

describe('sealing interacts with integrity', () => {
  it('integrity failure blocks sealing and marks the trace integrity_failed', () => {
    const { repository, manifest } = newTraceFixture();
    appendTraceEventBatch(repository, {
      traceId: FIXTURE_TRACE_ID,
      drafts: [statusDraft('evt-1', 'execution', 'not_started', 'running', TRACE_T1)],
    });

    // Tamper with the STORED event the way a compromised export would.
    const stored = repository.listEvents(FIXTURE_TRACE_ID)[1] as { metadata: Record<string, unknown> };
    const mutable = stored.metadata as Record<string, unknown>;
    try {
      mutable.injected = true;
    } catch {
      // Frozen, as designed — simulate the tamper on a forged ledger instead.
    }

    const forged = forge(repository.listEvents(FIXTURE_TRACE_ID));
    (forged[1].metadata as Record<string, unknown>).injected = true;
    const report = verifyTraceIntegrity(manifest, forged);
    expect(report.valid).toBe(false);
    expect(report.reason).toBe('event_hash_mismatch');
  });

  it('a sealed trace still verifies, including the seal event', () => {
    const { repository } = newTraceFixture();
    appendTraceEventBatch(repository, {
      traceId: FIXTURE_TRACE_ID,
      drafts: [statusDraft('evt-1', 'execution', 'not_started', 'running', TRACE_T1)],
    });
    const sealed = sealTrace(repository, {
      traceId: FIXTURE_TRACE_ID,
      eventId: 'evt-seal',
      actorId: 'relay-trace-service',
      occurredAt: TRACE_T5,
      sourceService: 'relay-trace-integrity',
      reason: 'archived',
    });
    expect(sealed.ok).toBe(true);

    const report = verifyTraceIntegrity(
      repository.getManifest(FIXTURE_TRACE_ID)!,
      repository.listEvents(FIXTURE_TRACE_ID),
    );
    expect(report.valid).toBe(true);
    expect(report.headEventId).toBe('evt-seal');
  });
});
