import { describe, expect, it } from 'vitest';

import {
  deriveReferenceIntegrity,
  eventIsSelfReport,
  traceEventToReference,
  traceIntegrityToCapsuleStatus,
} from './trace-reference-adapter';
import { appendTraceEventBatch } from './trace-ledger';
import { verifyTraceIntegrity } from './trace-integrity';
import {
  agentClaimDraft,
  capsuleDraft,
  newTraceFixture,
  statusDraft,
  FIXTURE_TRACE_ID,
  TRACE_T1,
  TRACE_T2,
} from './trace-fixtures';
import {
  TRACE_REFERENCE_INTEGRITIES,
  TRACE_REFERENCE_SOURCES,
} from '../execution-capsules/capsule-trace-reference';
import type { AqualaTraceEvent } from './trace-types';

function tracedEvents() {
  const { repository, manifest } = newTraceFixture();
  const appended = appendTraceEventBatch(repository, {
    traceId: FIXTURE_TRACE_ID,
    subjectAgentIds: ['agent-claude'],
    drafts: [
      capsuleDraft('evt-file', 'file_reference_linked', TRACE_T1, {
        eventFamily: 'file',
        sourceService: 'relay-workspace-monitor',
        actorId: 'relay-workspace-monitor',
        sourceTrust: 'attested',
        metadata: { path: 'src/auth/session.ts' },
      }),
      agentClaimDraft('evt-report', 'agent_final_report_received', TRACE_T2),
      statusDraft('evt-status', 'execution', 'not_started', 'running', TRACE_T2),
    ],
  });
  if (!appended.ok) throw new Error(appended.error.reason);
  return { repository, manifest, events: repository.listEvents(FIXTURE_TRACE_ID) };
}

const byId = (events: readonly AqualaTraceEvent[], id: string): AqualaTraceEvent =>
  events.find((e) => e.eventId === id)!;

describe('trace event → capsule TraceReference', () => {
  it('preserves the event id, type, actor, and timestamp', () => {
    const { events } = tracedEvents();
    const event = byId(events, 'evt-file');
    const reference = traceEventToReference(event);

    expect(reference.eventId).toBe('evt-file');
    expect(reference.eventType).toBe('file_reference_linked');
    expect(reference.actorId).toBe('relay-workspace-monitor');
    expect(reference.occurredAt).toBe(TRACE_T1);
    expect(reference.referenceId).toBe('evt-file');
    expect(Object.isFrozen(reference)).toBe(true);
  });

  it('maps to a valid capsule source and integrity vocabulary', () => {
    const { events } = tracedEvents();
    for (const event of events) {
      const reference = traceEventToReference(event);
      expect(TRACE_REFERENCE_SOURCES).toContain(reference.source);
      expect(TRACE_REFERENCE_INTEGRITIES).toContain(reference.integrity);
    }
  });

  it.each([
    ['file', 'evt-file', 'workspace_monitor'],
    ['agent report', 'evt-report', 'agent_report'],
    ['status', 'evt-status', 'relay_supervisor'],
  ])('maps a %s event to the %s source', (_label, eventId, source) => {
    const { events } = tracedEvents();
    expect(traceEventToReference(byId(events, eventId)).source).toBe(source);
  });

  it('carries the chain facts in reference metadata', () => {
    const { events } = tracedEvents();
    const reference = traceEventToReference(byId(events, 'evt-file'));
    expect(reference.metadata?.traceId).toBe(FIXTURE_TRACE_ID);
    expect(reference.metadata?.sequence).toBe(2);
    expect(reference.metadata?.eventHash).toBe(byId(events, 'evt-file').eventHash);
    expect(reference.metadata?.sourceTrust).toBe('attested');
  });
});

describe('integrity is EARNED, never assumed', () => {
  it('a stored event alone is only trusted_source', () => {
    const { events } = tracedEvents();
    expect(traceEventToReference(byId(events, 'evt-file')).integrity).toBe('trusted_source');
  });

  it('becomes verified ONLY after a full-chain verification covering it', () => {
    const { manifest, events } = tracedEvents();
    const report = verifyTraceIntegrity(manifest, events);
    expect(report.valid).toBe(true);

    const reference = traceEventToReference(byId(events, 'evt-file'), { integrity: report });
    expect(reference.integrity).toBe('verified');
  });

  it('stays trusted_source when verification did not reach that sequence', () => {
    const { manifest, events } = tracedEvents();
    const report = verifyTraceIntegrity(manifest, events);
    const partial = { ...report, verifiedThroughSequence: 1 };
    expect(traceEventToReference(byId(events, 'evt-file'), { integrity: partial }).integrity).toBe(
      'trusted_source',
    );
  });

  it('stays trusted_source when the chain FAILED verification', () => {
    const { manifest, events } = tracedEvents();
    const forged = JSON.parse(JSON.stringify(events)) as AqualaTraceEvent[];
    (forged[1].metadata as Record<string, unknown>).tampered = true;
    const report = verifyTraceIntegrity(manifest, forged);
    expect(report.valid).toBe(false);
    expect(traceEventToReference(byId(events, 'evt-file'), { integrity: report }).integrity).toBe(
      'trusted_source',
    );
  });

  it('an AGENT CLAIM stays unverified no matter how good the chain is', () => {
    const { manifest, events } = tracedEvents();
    const report = verifyTraceIntegrity(manifest, events);
    expect(report.valid).toBe(true);

    const reference = traceEventToReference(byId(events, 'evt-report'), { integrity: report });
    expect(reference.source).toBe('agent_report');
    expect(reference.integrity).toBe('unverified');
    expect(eventIsSelfReport(byId(events, 'evt-report'))).toBe(true);
  });

  it('a report for a DIFFERENT trace never upgrades integrity', () => {
    const { manifest, events } = tracedEvents();
    const report = { ...verifyTraceIntegrity(manifest, events), traceId: 'trace-other' };
    expect(traceEventToReference(byId(events, 'evt-file'), { integrity: report }).integrity).toBe(
      'trusted_source',
    );
  });

  it('derives capsule-level integrity status from the report', () => {
    const { manifest, events } = tracedEvents();
    const valid = verifyTraceIntegrity(manifest, events);
    expect(traceIntegrityToCapsuleStatus(valid)).toBe('verified');
    expect(traceIntegrityToCapsuleStatus({ ...valid, valid: false })).toBe('failed');
    expect(traceIntegrityToCapsuleStatus(undefined)).toBe('not_evaluated');
  });

  it('deriveReferenceIntegrity is a pure function of event + source + report', () => {
    const { manifest, events } = tracedEvents();
    const report = verifyTraceIntegrity(manifest, events);
    const event = byId(events, 'evt-file');
    expect(deriveReferenceIntegrity(event, 'workspace_monitor', report)).toBe('verified');
    expect(deriveReferenceIntegrity(event, 'agent_report', report)).toBe('unverified');
    expect(deriveReferenceIntegrity(event, 'workspace_monitor', undefined)).toBe('trusted_source');
  });

  it('never mutates the event it converts', () => {
    const { events } = tracedEvents();
    const snapshot = JSON.stringify(events);
    for (const event of events) traceEventToReference(event);
    expect(JSON.stringify(events)).toBe(snapshot);
  });
});
