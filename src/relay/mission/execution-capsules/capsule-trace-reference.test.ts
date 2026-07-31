import { describe, expect, it } from 'vitest';

import {
  CAPSULE_T3,
  CAPSULE_T4,
  CLAUDE_ACTUAL,
  claudeImplementationInput,
  runningFixture,
  secretShapedMetadata,
} from './capsule-fixtures';
import { appendCapsuleTraceReference, findTraceReference } from './capsule-service';
import {
  appendTraceReference,
  collectReferencedEventIds,
  createEmptyTraceReferences,
  createTraceReference,
  isTrustedSupervisoryReference,
  TRACE_REFERENCE_CHANNELS,
  TRUSTED_SUPERVISORY_SOURCES,
  type TraceReferenceChannel,
} from './capsule-trace-reference';
import type { RelayAgentExecutionCapsule } from './capsule-types';

const running = () => runningFixture(claudeImplementationInput(), CLAUDE_ACTUAL);

function append(
  capsule: RelayAgentExecutionCapsule,
  channel: TraceReferenceChannel,
  eventId: string,
  over: Partial<Parameters<typeof createTraceReference>[0]> = {},
) {
  return appendCapsuleTraceReference(capsule, {
    channel,
    reference: {
      referenceId: `ref-${eventId}`,
      eventId,
      eventType: `${channel}.sample`,
      occurredAt: CAPSULE_T3,
      actorId: 'relay-supervisor',
      source: 'relay_supervisor',
      integrity: 'trusted_source',
      ...over,
    },
    at: CAPSULE_T3,
  });
}

describe('trace reference channels', () => {
  it('an empty capsule exposes all ten ordered channels', () => {
    const empty = createEmptyTraceReferences();
    expect(Object.keys(empty).sort()).toEqual([...TRACE_REFERENCE_CHANNELS].sort());
    for (const channel of TRACE_REFERENCE_CHANNELS) expect(empty[channel]).toEqual([]);
  });

  it.each(TRACE_REFERENCE_CHANNELS)('appends a reference to %s', (channel) => {
    const result = append(running(), channel, `evt-${channel}`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.traceReferences[channel]).toHaveLength(1);
    expect(findTraceReference(result.value, channel, `evt-${channel}`)).toBeDefined();
  });

  it('preserves append order within a channel', () => {
    let capsule = running();
    for (const eventId of ['evt-1', 'evt-2', 'evt-3']) {
      const result = append(capsule, 'fileEvents', eventId, {
        occurredAt: `2026-07-28T12:0${eventId.slice(-1)}:00.000Z`,
      });
      if (!result.ok) throw new Error(result.error.reason);
      capsule = result.value;
    }
    expect(capsule.traceReferences.fileEvents.map((r) => r.eventId)).toEqual([
      'evt-1', 'evt-2', 'evt-3',
    ]);
  });

  it('rejects a duplicate event id — even across DIFFERENT channels', () => {
    const first = append(running(), 'fileEvents', 'evt-dup');
    if (!first.ok) throw new Error('setup failed');
    const sameChannel = append(first.value, 'fileEvents', 'evt-dup');
    expect(!sameChannel.ok && sameChannel.error.code).toBe('DUPLICATE_TRACE_REFERENCE');
    const otherChannel = append(first.value, 'toolEvents', 'evt-dup');
    expect(!otherChannel.ok && otherChannel.error.code).toBe('DUPLICATE_TRACE_REFERENCE');
    expect(first.value.traceReferences.fileEvents).toHaveLength(1);
  });

  it('collects every referenced event id across channels', () => {
    let capsule = running();
    for (const [channel, eventId] of [
      ['fileEvents', 'evt-a'],
      ['toolEvents', 'evt-b'],
      ['errors', 'evt-c'],
    ] as const) {
      const result = append(capsule, channel, eventId);
      if (!result.ok) throw new Error(result.error.reason);
      capsule = result.value;
    }
    expect([...collectReferencedEventIds(capsule.traceReferences)].sort()).toEqual([
      'evt-a', 'evt-b', 'evt-c',
    ]);
  });

  it('stored references are frozen and the input collections are never mutated', () => {
    const empty = createEmptyTraceReferences();
    const built = createTraceReference({
      referenceId: 'ref-1',
      eventId: 'evt-frozen',
      eventType: 'file.changed',
      occurredAt: CAPSULE_T3,
      actorId: 'workspace-monitor',
      source: 'workspace_monitor',
      integrity: 'trusted_source',
    });
    if (!built.ok) throw new Error('setup failed');
    expect(Object.isFrozen(built.value)).toBe(true);
    expect(() => {
      (built.value as { eventId: string }).eventId = 'tampered';
    }).toThrow();

    const appended = appendTraceReference(empty, 'fileEvents', built.value);
    expect(appended.ok).toBe(true);
    expect(empty.fileEvents).toEqual([]);
  });
});

describe('claims versus supervisory observations', () => {
  it('an agent_report reference is ALWAYS unverified, whatever integrity was asked for', () => {
    const result = append(running(), 'commandEvents', 'evt-claim', {
      actorId: 'agent-claude',
      source: 'agent_report',
      integrity: 'trusted_source',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const reference = findTraceReference(result.value, 'commandEvents', 'evt-claim');
    expect(reference?.integrity).toBe('unverified');
    expect(isTrustedSupervisoryReference(reference!)).toBe(false);
  });

  it('an agent cannot emit a TRUSTED SUPERVISORY event about itself', () => {
    for (const source of TRUSTED_SUPERVISORY_SOURCES) {
      const result = append(running(), 'processEvents', `evt-self-${source}`, {
        actorId: 'agent-claude',
        source,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('AGENT_SELF_ATTESTATION_FORBIDDEN');
    }
  });

  it('a supervisory service CAN emit an event about the agent', () => {
    const result = append(running(), 'processEvents', 'evt-supervisor', {
      actorId: 'relay-supervisor',
      source: 'relay_supervisor',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const reference = findTraceReference(result.value, 'processEvents', 'evt-supervisor');
    expect(isTrustedSupervisoryReference(reference!)).toBe(true);
  });

  it('no reference may claim `verified` integrity — nothing hash-chains yet', () => {
    const result = append(running(), 'fileEvents', 'evt-verified-claim', {
      integrity: 'verified',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(findTraceReference(result.value, 'fileEvents', 'evt-verified-claim')?.integrity).toBe(
      'trusted_source',
    );
  });

  it('capsule trace integrity stays not_evaluated as references accumulate', () => {
    const result = append(running(), 'fileEvents', 'evt-integrity');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.traceIntegrityStatus).toBe('not_evaluated');
  });

  it('reference metadata is redacted before storage and the input is not mutated', () => {
    const metadata = secretShapedMetadata();
    const snapshot = JSON.stringify(metadata);
    const result = append(running(), 'toolEvents', 'evt-secret', { metadata });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stored = JSON.stringify(findTraceReference(result.value, 'toolEvents', 'evt-secret'));
    expect(stored).not.toContain('sk-fixture0123456789abcdef');
    expect(stored).not.toContain('fixtureSecret123');
    expect(stored).toContain('[redacted]');
    // The environment-variable NAME may remain; its value never does.
    expect(stored).toContain('ANTHROPIC_API_KEY');
    expect(JSON.stringify(metadata)).toBe(snapshot);
  });

  it('an empty event id is rejected', () => {
    const result = append(running(), 'fileEvents', '   ');
    expect(result.ok).toBe(false);
  });

  it('references cannot be appended to a terminal capsule', () => {
    const capsule = running();
    const cancelled = { ...capsule, status: 'cancelled' as const, finishedAt: CAPSULE_T4 };
    const result = append(cancelled, 'fileEvents', 'evt-after-terminal');
    expect(!result.ok && result.error.code).toBe('TERMINAL_CAPSULE_IMMUTABLE');
  });
});
