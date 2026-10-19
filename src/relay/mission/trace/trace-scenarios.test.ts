import { describe, expect, it } from 'vitest';

/**
 * The twelve required deterministic fixtures (A–L), driven END-TO-END through
 * the real ledger, verifier, and reconstruction.
 */

import { appendTraceEvent, appendTraceEventBatch, completeTrace, sealTrace } from './trace-ledger';
import { verifyTraceIntegrity } from './trace-integrity';
import { reconstructTrace } from './trace-reconstruction';
import {
  agentClaimDraft,
  capsuleDraft,
  commandDraft,
  newTraceFixture,
  secretShapedEventMetadata,
  statusDraft,
  FIXTURE_TRACE_ID,
  TRACE_T1,
  TRACE_T2,
  TRACE_T3,
  TRACE_T4,
  TRACE_T5,
} from './trace-fixtures';
import type { AqualaTraceEvent } from './trace-types';

const forge = (events: readonly AqualaTraceEvent[]): AqualaTraceEvent[] =>
  JSON.parse(JSON.stringify(events)) as AqualaTraceEvent[];

describe('fixture A — basic Relay mission trace', () => {
  it('records the whole run and leaves outcome, verification, and release untouched', () => {
    const { repository, manifest } = newTraceFixture();
    const appended = appendTraceEventBatch(repository, {
      traceId: FIXTURE_TRACE_ID,
      subjectAgentIds: ['agent-claude'],
      drafts: [
        statusDraft('evt-1', 'execution', 'not_started', 'running', TRACE_T1),
        commandDraft('evt-2', 'command_received', TRACE_T1),
        commandDraft('evt-3', 'command_validated', TRACE_T1),
        capsuleDraft('evt-4', 'execution_capsule_prepared', TRACE_T2, {
          metadata: { requestedAgentId: 'agent-claude' },
        }),
        capsuleDraft('evt-5', 'agent_launch_requested', TRACE_T2, {
          metadata: { requestedAgentId: 'agent-claude', launchVerified: false },
        }),
        capsuleDraft('evt-6', 'agent_launch_verified', TRACE_T2, {
          sourceTrust: 'attested',
          metadata: {
            requestedAgentId: 'agent-claude',
            actualAgentId: 'agent-claude',
            launchVerified: true,
          },
        }),
        capsuleDraft('evt-7', 'agent_execution_started', TRACE_T3),
        agentClaimDraft('evt-8', 'agent_final_report_received', TRACE_T3),
        capsuleDraft('evt-9', 'agent_execution_completed', TRACE_T4),
        statusDraft('evt-10', 'execution', 'running', 'completed', TRACE_T4),
      ],
    });
    expect(appended.ok).toBe(true);

    const events = repository.listEvents(FIXTURE_TRACE_ID);
    expect(verifyTraceIntegrity(manifest, events).valid).toBe(true);

    const trace = reconstructTrace(manifest, events);
    expect(trace.ok).toBe(true);
    if (!trace.ok) return;
    expect(trace.value.verification.executionStatus).toBe('completed');
    expect(trace.value.verification.outcomeStatus).toBe('unknown');
    expect(trace.value.verification.verificationStatus).toBe('unverified');
    expect(trace.value.verification.releaseStatus).toBe('not_eligible');
  });
});

describe('fixture B — verified review and repair trace', () => {
  it('reaches outcome satisfied, verification verified, and release human approval required', () => {
    const { repository, manifest } = newTraceFixture();
    const appended = appendTraceEventBatch(repository, {
      traceId: FIXTURE_TRACE_ID,
      subjectAgentIds: ['agent-claude', 'agent-codex'],
      drafts: [
        statusDraft('evt-1', 'execution', 'not_started', 'running', TRACE_T1),
        capsuleDraft('evt-2', 'execution_capsule_prepared', TRACE_T1, {
          metadata: { requestedAgentId: 'agent-claude' },
        }),
        capsuleDraft('evt-3', 'agent_launch_verified', TRACE_T1, {
          sourceTrust: 'attested',
          metadata: { requestedAgentId: 'agent-claude', actualAgentId: 'agent-claude' },
        }),
        // Independent Codex reviewer, verified identity.
        capsuleDraft('evt-4', 'execution_capsule_prepared', TRACE_T2, {
          capsuleId: 'cap-codex-review',
          runId: 'run-codex-1',
          metadata: { requestedAgentId: 'agent-codex' },
        }),
        capsuleDraft('evt-5', 'agent_launch_verified', TRACE_T2, {
          capsuleId: 'cap-codex-review',
          runId: 'run-codex-1',
          sourceTrust: 'attested',
          metadata: { requestedAgentId: 'agent-codex', actualAgentId: 'agent-codex' },
        }),
        capsuleDraft('evt-6', 'review_reference_linked', TRACE_T2, {
          eventFamily: 'review',
          capsuleId: 'cap-codex-review',
          sourceService: 'relay-review-service',
          actorId: 'relay-review-service',
          metadata: { reviewId: 'review-1' },
        }),
        capsuleDraft('evt-7', 'finding_reference_linked', TRACE_T2, {
          eventFamily: 'finding',
          sourceService: 'relay-review-service',
          actorId: 'relay-review-service',
          metadata: { findingId: 'finding-auth-1' },
        }),
        statusDraft('evt-8', 'verification', 'unverified', 'reviewing', TRACE_T2),
        statusDraft('evt-9', 'verification', 'reviewing', 'changes_required', TRACE_T2),
        // Repair, then independent re-review.
        commandDraft('evt-10', 'command_validated', TRACE_T3),
        capsuleDraft('evt-11', 'repair_reference_linked', TRACE_T3, {
          eventFamily: 'repair',
          sourceService: 'relay-review-service',
          actorId: 'relay-review-service',
          metadata: { repairId: 'repair-1' },
        }),
        capsuleDraft('evt-12', 'evidence_reference_linked', TRACE_T3, {
          eventFamily: 'evidence',
          metadata: { evidenceId: 'ev-repair-tests' },
        }),
        statusDraft('evt-13', 'verification', 'changes_required', 'reviewing', TRACE_T3),
        statusDraft('evt-14', 'verification', 'reviewing', 'approved', TRACE_T4),
        statusDraft('evt-15', 'execution', 'running', 'completed', TRACE_T4),
        statusDraft('evt-16', 'outcome', 'unknown', 'satisfied', TRACE_T4),
        statusDraft('evt-17', 'verification', 'approved', 'verified', TRACE_T4),
        statusDraft('evt-18', 'release', 'not_eligible', 'human_approval_required', TRACE_T5),
      ],
    });
    expect(appended.ok).toBe(true);
    if (!appended.ok) return;

    const events = repository.listEvents(FIXTURE_TRACE_ID);
    expect(verifyTraceIntegrity(manifest, events).valid).toBe(true);

    const trace = reconstructTrace(manifest, events);
    expect(trace.ok).toBe(true);
    if (!trace.ok) return;
    expect(trace.value.verification.outcomeStatus).toBe('satisfied');
    expect(trace.value.verification.verificationStatus).toBe('verified');
    expect(trace.value.verification.releaseStatus).toBe('human_approval_required');
    expect(trace.value.verification.reviewIds).toEqual(['review-1']);
    expect(trace.value.verification.findingIds).toEqual(['finding-auth-1']);
    expect(trace.value.verification.repairIds).toEqual(['repair-1']);
    expect([...trace.value.execution.capsuleIds].sort()).toEqual(['cap-claude-impl', 'cap-codex-review']);
  });
});

describe('fixture C — failed Codex launch', () => {
  it('records the failure with no actual identity and no verified review event', () => {
    const { repository, manifest } = newTraceFixture();
    appendTraceEventBatch(repository, {
      traceId: FIXTURE_TRACE_ID,
      subjectAgentIds: ['agent-codex'],
      drafts: [
        capsuleDraft('evt-1', 'execution_capsule_prepared', TRACE_T1, {
          capsuleId: 'cap-codex-review',
          runId: 'run-codex-1',
          metadata: { requestedAgentId: 'agent-codex' },
        }),
        capsuleDraft('evt-2', 'agent_launch_requested', TRACE_T1, {
          capsuleId: 'cap-codex-review',
          runId: 'run-codex-1',
          metadata: { requestedAgentId: 'agent-codex', launchVerified: false },
        }),
        capsuleDraft('evt-3', 'agent_launch_failed', TRACE_T2, {
          capsuleId: 'cap-codex-review',
          runId: 'run-codex-1',
          sourceTrust: 'attested',
          metadata: {
            requestedAgentId: 'agent-codex',
            launchVerified: false,
            failureReason: 'execution permission denied',
          },
        }),
        capsuleDraft('evt-4', 'agent_execution_failed', TRACE_T2, {
          capsuleId: 'cap-codex-review',
          runId: 'run-codex-1',
        }),
      ],
    });

    const events = repository.listEvents(FIXTURE_TRACE_ID);
    const trace = reconstructTrace(manifest, events);
    if (!trace.ok) throw new Error('setup failed');

    expect(trace.value.execution.identities[0].requestedAgentId).toBe('agent-codex');
    expect(trace.value.execution.identities[0].actualAgentId).toBeUndefined();
    expect(trace.value.execution.identities[0].launchVerified).toBe(false);
    expect(trace.value.verification.reviewIds).toEqual([]);
    expect(trace.value.verification.verificationStatus).toBe('unverified');
  });
});

describe('fixture D — unauthorized wrapper fallback', () => {
  it('records a security event, keeps the wrapper visible, and credits nothing to Codex', () => {
    const { repository, manifest } = newTraceFixture();
    appendTraceEventBatch(repository, {
      traceId: FIXTURE_TRACE_ID,
      subjectAgentIds: ['agent-codex', 'agent-mock-wrapper'],
      drafts: [
        capsuleDraft('evt-1', 'execution_capsule_prepared', TRACE_T1, {
          metadata: { requestedAgentId: 'agent-codex' },
        }),
        capsuleDraft('evt-2', 'agent_fallback_rejected', TRACE_T2, {
          eventFamily: 'security',
          sourceTrust: 'attested',
          metadata: {
            requestedAgentId: 'agent-codex',
            observedAgentId: 'agent-mock-wrapper',
            launchVerified: false,
            fallbackAuthorized: false,
            reason: 'no policy permits a wrapper substitution',
          },
        }),
      ],
    });

    const events = repository.listEvents(FIXTURE_TRACE_ID);
    expect(events.some((e) => e.eventFamily === 'security')).toBe(true);

    const trace = reconstructTrace(manifest, events);
    if (!trace.ok) throw new Error('setup failed');
    const identity = trace.value.execution.identities[0];
    expect(identity.requestedAgentId).toBe('agent-codex');
    expect(identity.observedAgentId).toBe('agent-mock-wrapper');
    expect(identity.actualAgentId).toBeUndefined();
    expect(trace.value.verification.verificationStatus).toBe('unverified');
    expect(trace.value.eventCountsByFamily.security).toBe(1);
  });
});

describe('fixture E — command rejection trace', () => {
  it('keeps the clarification and rejection inspectable with no mission state change', () => {
    const { repository, manifest } = newTraceFixture();
    appendTraceEventBatch(repository, {
      traceId: FIXTURE_TRACE_ID,
      drafts: [
        commandDraft('evt-1', 'command_received', TRACE_T1, {
          metadata: { text: 'stop it and give it to the other one' },
        }),
        commandDraft('evt-2', 'command_clarification_required', TRACE_T1, {
          metadata: { missingInformation: ['target task', 'current agent', 'replacement agent'] },
        }),
        commandDraft('evt-3', 'command_rejected', TRACE_T2, {
          metadata: { stage: 'interpretation' },
        }),
      ],
    });

    const events = repository.listEvents(FIXTURE_TRACE_ID);
    expect(verifyTraceIntegrity(manifest, events).valid).toBe(true);

    const trace = reconstructTrace(manifest, events);
    if (!trace.ok) throw new Error('setup failed');
    // No mission state moved at all.
    expect(trace.value.verification.executionStatus).toBe('not_started');
    expect(trace.value.verification.outcomeStatus).toBe('unknown');
    expect(repository.getEvent(FIXTURE_TRACE_ID, 'evt-3')?.eventType).toBe('command_rejected');
  });
});

describe('fixtures F, G, H — tampering, removal, reordering', () => {
  function threeEventTrace() {
    const fixture = newTraceFixture();
    appendTraceEventBatch(fixture.repository, {
      traceId: FIXTURE_TRACE_ID,
      drafts: [
        statusDraft('evt-1', 'execution', 'not_started', 'running', TRACE_T1),
        commandDraft('evt-2', 'command_received', TRACE_T2),
        commandDraft('evt-3', 'command_validated', TRACE_T3),
      ],
    });
    return fixture;
  }

  it('F — tampered metadata fails at the changed event and verifies nothing after it', () => {
    const { repository, manifest } = threeEventTrace();
    const exported = forge(repository.listEvents(FIXTURE_TRACE_ID));
    (exported[2].metadata as Record<string, unknown>).commandLocalSequence = 42;

    const report = verifyTraceIntegrity(manifest, exported);
    expect(report.valid).toBe(false);
    expect(report.reason).toBe('event_hash_mismatch');
    expect(report.firstInvalidSequence).toBe(3);
    expect(report.verifiedThroughSequence).toBe(2);
  });

  it('G — a removed middle event is caught at the first invalid sequence', () => {
    const { repository, manifest } = threeEventTrace();
    const exported = forge(repository.listEvents(FIXTURE_TRACE_ID)).filter(
      (e) => e.eventId !== 'evt-2',
    );
    const report = verifyTraceIntegrity(manifest, exported);
    expect(report.valid).toBe(false);
    expect(report.reason).toBe('sequence_gap');
    expect(report.firstInvalidSequence).toBe(4);
  });

  it('H — reordered events break the sequence or the previous-hash link', () => {
    const { repository, manifest } = threeEventTrace();
    const exported = forge(repository.listEvents(FIXTURE_TRACE_ID));
    [exported[1], exported[2]] = [exported[2], exported[1]];
    const report = verifyTraceIntegrity(manifest, exported);
    expect(report.valid).toBe(false);
    expect(['sequence_gap', 'previous_hash_mismatch']).toContain(report.reason);
  });
});

describe('fixture I — secret redaction', () => {
  it('stores only redacted values, hashes the redacted form, and leaves the input alone', () => {
    const { repository, manifest } = newTraceFixture();
    const metadata = secretShapedEventMetadata();
    const snapshot = JSON.stringify(metadata);

    const appended = appendTraceEvent(repository, {
      traceId: FIXTURE_TRACE_ID,
      draft: capsuleDraft('evt-secret', 'tool_reference_linked', TRACE_T1, {
        eventFamily: 'tool',
        metadata,
      }),
    });
    expect(appended.ok).toBe(true);
    if (!appended.ok) return;

    const stored = JSON.stringify(appended.value);
    expect(stored).not.toContain('sk-fixture0123456789abcdefghij');
    expect(stored).not.toContain('fixture-token-0123456789abcd');
    expect(stored).not.toContain('fixture-cookie-value-0123456789');
    expect(stored).not.toContain('fixtureSecret123456');
    expect(appended.value.redactionStatus).toBe('redacted');
    expect(JSON.stringify(metadata)).toBe(snapshot);

    // The chain verifies from the redacted event alone.
    expect(verifyTraceIntegrity(manifest, repository.listEvents(FIXTURE_TRACE_ID)).valid).toBe(true);
  });
});

describe('fixture J — completed but unsealed, then sealed', () => {
  it('accepts late approval and release events, then seals', () => {
    const { repository } = newTraceFixture();
    appendTraceEventBatch(repository, {
      traceId: FIXTURE_TRACE_ID,
      drafts: [
        statusDraft('evt-1', 'execution', 'not_started', 'running', TRACE_T1),
        statusDraft('evt-2', 'execution', 'running', 'completed', TRACE_T2),
        statusDraft('evt-3', 'outcome', 'unknown', 'satisfied', TRACE_T2),
        statusDraft('evt-4', 'verification', 'unverified', 'reviewing', TRACE_T2),
        statusDraft('evt-5', 'verification', 'reviewing', 'approved', TRACE_T2),
        statusDraft('evt-6', 'verification', 'approved', 'verified', TRACE_T2),
      ],
    });

    const completed = completeTrace(repository, {
      traceId: FIXTURE_TRACE_ID,
      eventId: 'evt-complete',
      actorId: 'relay-trace-service',
      occurredAt: TRACE_T3,
      sourceService: 'relay-trace-service',
      reason: 'execution ended',
    });
    expect(completed.ok).toBe(true);
    expect(repository.getManifest(FIXTURE_TRACE_ID)?.lifecycleStatus).toBe('completed');

    const late = appendTraceEventBatch(repository, {
      traceId: FIXTURE_TRACE_ID,
      drafts: [
        {
          ...commandDraft('evt-approval', 'command_approval_received', TRACE_T4),
          eventFamily: 'approval',
          metadata: { approvalId: 'approval-1' },
        },
        statusDraft('evt-release', 'release', 'not_eligible', 'human_approval_required', TRACE_T4),
      ],
    });
    expect(late.ok).toBe(true);

    const sealed = sealTrace(repository, {
      traceId: FIXTURE_TRACE_ID,
      eventId: 'evt-seal',
      actorId: 'relay-trace-service',
      occurredAt: TRACE_T5,
      sourceService: 'relay-trace-integrity',
      reason: 'archived',
    });
    expect(sealed.ok).toBe(true);

    const trace = reconstructTrace(
      repository.getManifest(FIXTURE_TRACE_ID)!,
      repository.listEvents(FIXTURE_TRACE_ID),
    );
    if (!trace.ok) throw new Error('setup failed');
    expect(trace.value.lifecycleStatus).toBe('sealed');
    expect(trace.value.completedAt).toBe(TRACE_T3);
    expect(trace.value.sealedAt).toBe(TRACE_T5);
    expect(trace.value.policy.approvalIds).toEqual(['approval-1']);
    expect(trace.value.verification.releaseStatus).toBe('human_approval_required');
    expect(trace.value.integrity.valid).toBe(true);
  });
});

describe('fixture K — stale-head conflict', () => {
  it('the first writer wins, the second is rejected, and the ledger stays valid', () => {
    const { repository, manifest } = newTraceFixture();
    const headA = repository.getHead(FIXTURE_TRACE_ID);
    const headB = repository.getHead(FIXTURE_TRACE_ID);

    const first = appendTraceEvent(repository, {
      traceId: FIXTURE_TRACE_ID,
      expectedHead: headA,
      draft: statusDraft('evt-writer-a', 'execution', 'not_started', 'running', TRACE_T1),
    });
    expect(first.ok).toBe(true);

    const second = appendTraceEvent(repository, {
      traceId: FIXTURE_TRACE_ID,
      expectedHead: headB,
      draft: statusDraft('evt-writer-b', 'outcome', 'unknown', 'partial', TRACE_T2),
    });
    expect(!second.ok && second.error.code).toBe('STALE_TRACE_HEAD');

    expect(repository.eventCount(FIXTURE_TRACE_ID)).toBe(2);
    expect(repository.getEvent(FIXTURE_TRACE_ID, 'evt-writer-b')).toBeNull();
    expect(verifyTraceIntegrity(manifest, repository.listEvents(FIXTURE_TRACE_ID)).valid).toBe(true);

    // Re-reading the head lets the second writer succeed.
    const retry = appendTraceEvent(repository, {
      traceId: FIXTURE_TRACE_ID,
      expectedHead: repository.getHead(FIXTURE_TRACE_ID),
      draft: statusDraft('evt-writer-b', 'outcome', 'unknown', 'partial', TRACE_T2),
    });
    expect(retry.ok).toBe(true);
  });
});

describe('fixture L — atomic batch failure', () => {
  it('stores nothing when a later draft in the batch is invalid', () => {
    const { repository, manifest } = newTraceFixture();
    const before = JSON.stringify(repository.listEvents(FIXTURE_TRACE_ID));

    const result = appendTraceEventBatch(repository, {
      traceId: FIXTURE_TRACE_ID,
      drafts: [
        statusDraft('evt-valid-1', 'execution', 'not_started', 'running', TRACE_T1),
        statusDraft('evt-valid-2', 'outcome', 'unknown', 'partial', TRACE_T2),
        { ...commandDraft('evt-invalid', 'command_received', TRACE_T3), actorId: '' },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_ACTOR');
    expect(result.error.reason).toMatch(/batch rejected at draft 2/u);

    expect(repository.eventCount(FIXTURE_TRACE_ID)).toBe(1);
    expect(repository.getEvent(FIXTURE_TRACE_ID, 'evt-valid-1')).toBeNull();
    expect(JSON.stringify(repository.listEvents(FIXTURE_TRACE_ID))).toBe(before);
    expect(verifyTraceIntegrity(manifest, repository.listEvents(FIXTURE_TRACE_ID)).valid).toBe(true);
  });
});
