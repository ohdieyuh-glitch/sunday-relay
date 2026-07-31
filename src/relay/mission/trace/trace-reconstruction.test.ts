import { describe, expect, it } from 'vitest';

import { reconstructTrace } from './trace-reconstruction';
import { appendTraceEventBatch, completeTrace, sealTrace } from './trace-ledger';
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
import type { AqualaTraceEvent } from './trace-types';

function missionTrace() {
  const fixture = newTraceFixture();
  const appended = appendTraceEventBatch(fixture.repository, {
    traceId: FIXTURE_TRACE_ID,
    subjectAgentIds: ['agent-claude'],
    drafts: [
      statusDraft('evt-1', 'execution', 'not_started', 'running', TRACE_T1),
      commandDraft('evt-2', 'command_received', TRACE_T1),
      commandDraft('evt-3', 'command_validated', TRACE_T1),
      capsuleDraft('evt-4', 'execution_capsule_prepared', TRACE_T2, {
        metadata: {
          requestedAgentId: 'agent-claude',
          workspaceId: 'workspace-auth',
          passportId: 'passport-claude-1',
          handoffCompilerVersion: '0.3.1',
          policyPackVersion: 'implementation-v3',
        },
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
      capsuleDraft('evt-9', 'evidence_reference_linked', TRACE_T3, {
        eventFamily: 'evidence',
        metadata: { evidenceId: 'ev-tests-1' },
      }),
      capsuleDraft('evt-10', 'agent_execution_completed', TRACE_T4),
      statusDraft('evt-11', 'execution', 'running', 'completed', TRACE_T4),
    ],
  });
  if (!appended.ok) throw new Error(`fixture failed: ${appended.error.reason}`);
  return fixture;
}

describe('basic mission trace reconstruction', () => {
  it('reconstructs identity, ids, statuses, and counts without inferring anything', () => {
    const { repository, manifest } = missionTrace();
    const result = reconstructTrace(manifest, repository.listEvents(FIXTURE_TRACE_ID));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const trace = result.value;

    expect(trace.traceId).toBe(FIXTURE_TRACE_ID);
    expect(trace.projectId).toBe('project-sunday');
    expect(trace.missionId).toBe('mission-auth');
    expect(trace.sourceProducts).toEqual(['sunday_relay']);

    expect(trace.execution.capsuleIds).toEqual(['cap-claude-impl']);
    expect(trace.execution.runIds).toEqual(['run-claude-1']);
    expect(trace.execution.commandIds).toEqual(['cmd-auth-1']);
    expect(trace.execution.workspaceIds).toEqual(['workspace-auth']);
    expect(trace.policy.passportIds).toEqual(['passport-claude-1']);
    expect(trace.policy.policyPackVersion).toBe('implementation-v3');
    expect(trace.context.handoffCompilerVersion).toBe('0.3.1');
    expect(trace.context.missionRevision).toBe(4);
    expect(trace.verification.evidenceIds).toEqual(['ev-tests-1']);

    // Requested and actual identity travel separately.
    expect(trace.execution.identities).toHaveLength(1);
    expect(trace.execution.identities[0]).toMatchObject({
      capsuleId: 'cap-claude-impl',
      requestedAgentId: 'agent-claude',
      actualAgentId: 'agent-claude',
      launchVerified: true,
      fallbackOccurred: false,
    });

    // Execution completed — and NOTHING else is inferred from that.
    expect(trace.verification.executionStatus).toBe('completed');
    expect(trace.verification.outcomeStatus).toBe('unknown');
    expect(trace.verification.verificationStatus).toBe('unverified');
    expect(trace.verification.releaseStatus).toBe('not_eligible');

    expect(trace.eventCount).toBe(12);
    expect(trace.eventCountsByFamily.execution).toBe(5);
    expect(trace.eventCountsByFamily.command).toBe(2);
    expect(trace.eventCountsByFamily.report).toBe(1);
    expect(trace.firstEventAt).toBeTruthy();
    expect(trace.lastEventAt).toBe(TRACE_T4);
    expect(trace.integrity.valid).toBe(true);
    expect(trace.lifecycleStatus).toBe('open');
  });

  it('reconstructs the request and brain revision from genesis metadata', () => {
    const { repository, manifest } = missionTrace();
    const result = reconstructTrace(manifest, repository.listEvents(FIXTURE_TRACE_ID));
    if (!result.ok) throw new Error('setup failed');
    expect(result.value.request.userIntent).toBe('repair the authentication defect');
    expect(result.value.request.objectiveReference).toBe('mission-auth#objective');
    expect(result.value.context.projectBrainRevision).toBe(7);
  });

  it('missing cost receipts stay not_available with NULL totals — never zero', () => {
    const { repository, manifest } = missionTrace();
    const result = reconstructTrace(manifest, repository.listEvents(FIXTURE_TRACE_ID));
    if (!result.ok) throw new Error('setup failed');
    const economics = result.value.economics;

    expect(economics.costReceiptIds).toEqual([]);
    expect(economics.status).toBe('not_available');
    expect(economics.totalCostUsd).toBeNull();
    expect(economics.directModelCostUsd).toBeNull();
    expect(economics.agentExecutionCostUsd).toBeNull();
    expect(economics.reviewCostUsd).toBeNull();
    expect(economics.repairCostUsd).toBeNull();
    expect(economics.retryCostUsd).toBeNull();
    expect(economics.runtimeMs).toBeNull();
  });

  it('becomes partial once receipts are linked, still without amounts', () => {
    const { repository, manifest } = missionTrace();
    appendTraceEventBatch(repository, {
      traceId: FIXTURE_TRACE_ID,
      drafts: [
        capsuleDraft('evt-cost', 'cost_receipt_reference_linked', TRACE_T5, {
          eventFamily: 'economics',
          sourceService: 'relay-cost-service',
          actorId: 'relay-cost-service',
          actorType: 'system',
          metadata: { costReceiptId: 'receipt-1' },
        }),
      ],
    });
    const result = reconstructTrace(manifest, repository.listEvents(FIXTURE_TRACE_ID));
    if (!result.ok) throw new Error('setup failed');
    expect(result.value.economics.costReceiptIds).toEqual(['receipt-1']);
    expect(result.value.economics.status).toBe('partial');
    expect(result.value.economics.totalCostUsd).toBeNull();
  });
});

describe('reconstruction never infers', () => {
  it('a reviewer finishing does not set verification, and verification does not set release', () => {
    const { repository, manifest } = newTraceFixture();
    appendTraceEventBatch(repository, {
      traceId: FIXTURE_TRACE_ID,
      drafts: [
        capsuleDraft('evt-1', 'execution_capsule_prepared', TRACE_T1, {
          metadata: { requestedAgentId: 'agent-codex' },
        }),
        capsuleDraft('evt-2', 'agent_launch_verified', TRACE_T1, {
          sourceTrust: 'attested',
          metadata: { requestedAgentId: 'agent-codex', actualAgentId: 'agent-codex' },
        }),
        capsuleDraft('evt-3', 'agent_execution_completed', TRACE_T2),
        capsuleDraft('evt-4', 'review_reference_linked', TRACE_T2, {
          eventFamily: 'review',
          sourceService: 'relay-review-service',
          actorId: 'relay-review-service',
          metadata: { reviewId: 'review-1' },
        }),
      ],
    });
    const result = reconstructTrace(manifest, repository.listEvents(FIXTURE_TRACE_ID));
    if (!result.ok) throw new Error('setup failed');

    expect(result.value.verification.reviewIds).toEqual(['review-1']);
    // A completed reviewer process proves nothing about verification.
    expect(result.value.verification.verificationStatus).toBe('unverified');
    expect(result.value.verification.releaseStatus).toBe('not_eligible');
    expect(result.value.verification.outcomeStatus).toBe('unknown');
  });

  it('a requested identity is never promoted to an actual identity', () => {
    const { repository, manifest } = newTraceFixture();
    appendTraceEventBatch(repository, {
      traceId: FIXTURE_TRACE_ID,
      drafts: [
        capsuleDraft('evt-1', 'execution_capsule_prepared', TRACE_T1, {
          metadata: { requestedAgentId: 'agent-codex' },
        }),
        capsuleDraft('evt-2', 'agent_launch_failed', TRACE_T1, {
          sourceTrust: 'attested',
          metadata: { requestedAgentId: 'agent-codex', launchVerified: false, failureReason: 'denied' },
        }),
      ],
    });
    const result = reconstructTrace(manifest, repository.listEvents(FIXTURE_TRACE_ID));
    if (!result.ok) throw new Error('setup failed');
    const identity = result.value.execution.identities[0];
    expect(identity.requestedAgentId).toBe('agent-codex');
    expect(identity.actualAgentId).toBeUndefined();
    expect(identity.launchVerified).toBe(false);
  });

  it('an unauthorized wrapper is reconstructed as OBSERVED, never actual', () => {
    const { repository, manifest } = newTraceFixture();
    appendTraceEventBatch(repository, {
      traceId: FIXTURE_TRACE_ID,
      drafts: [
        capsuleDraft('evt-1', 'execution_capsule_prepared', TRACE_T1, {
          metadata: { requestedAgentId: 'agent-codex' },
        }),
        capsuleDraft('evt-2', 'agent_fallback_rejected', TRACE_T1, {
          eventFamily: 'security',
          sourceTrust: 'attested',
          metadata: {
            requestedAgentId: 'agent-codex',
            observedAgentId: 'agent-mock-wrapper',
            fallbackAuthorized: false,
          },
        }),
      ],
    });
    const result = reconstructTrace(manifest, repository.listEvents(FIXTURE_TRACE_ID));
    if (!result.ok) throw new Error('setup failed');
    const identity = result.value.execution.identities[0];
    expect(identity.requestedAgentId).toBe('agent-codex');
    expect(identity.observedAgentId).toBe('agent-mock-wrapper');
    expect(identity.actualAgentId).toBeUndefined();
    expect(identity.launchVerified).toBe(false);
    expect(identity.fallbackAuthorized).toBe(false);
  });

  it('an authorized fallback keeps both identities', () => {
    const { repository, manifest } = newTraceFixture();
    appendTraceEventBatch(repository, {
      traceId: FIXTURE_TRACE_ID,
      drafts: [
        capsuleDraft('evt-1', 'agent_fallback_authorized', TRACE_T1, {
          sourceTrust: 'attested',
          metadata: {
            requestedAgentId: 'agent-claude',
            actualAgentId: 'agent-manual',
            launchVerified: true,
            fallbackAuthorized: true,
          },
        }),
      ],
    });
    const result = reconstructTrace(manifest, repository.listEvents(FIXTURE_TRACE_ID));
    if (!result.ok) throw new Error('setup failed');
    expect(result.value.execution.identities[0]).toMatchObject({
      requestedAgentId: 'agent-claude',
      actualAgentId: 'agent-manual',
      launchVerified: true,
      fallbackOccurred: true,
      fallbackAuthorized: true,
    });
  });

  it('source trust survives reconstruction', () => {
    const { repository } = missionTrace();
    const events = repository.listEvents(FIXTURE_TRACE_ID);
    expect(events.find((e) => e.eventId === 'evt-8')?.sourceTrust).toBe('claim');
    expect(events.find((e) => e.eventId === 'evt-6')?.sourceTrust).toBe('attested');
  });
});

describe('lifecycle and failure reconstruction', () => {
  it('reconstructs a completed-but-unsealed trace', () => {
    const { repository, manifest } = missionTrace();
    completeTrace(repository, {
      traceId: FIXTURE_TRACE_ID,
      eventId: 'evt-complete',
      actorId: 'relay-trace-service',
      occurredAt: TRACE_T4,
      sourceService: 'relay-trace-service',
      reason: 'execution ended',
    });
    const result = reconstructTrace(
      repository.getManifest(FIXTURE_TRACE_ID)!,
      repository.listEvents(FIXTURE_TRACE_ID),
    );
    if (!result.ok) throw new Error('setup failed');
    expect(result.value.lifecycleStatus).toBe('completed');
    expect(result.value.completedAt).toBe(TRACE_T4);
    expect(result.value.sealedAt).toBeUndefined();
    expect(manifest.traceId).toBe(FIXTURE_TRACE_ID);
  });

  it('reconstructs a sealed trace', () => {
    const { repository } = missionTrace();
    sealTrace(repository, {
      traceId: FIXTURE_TRACE_ID,
      eventId: 'evt-seal',
      actorId: 'relay-trace-service',
      occurredAt: TRACE_T5,
      sourceService: 'relay-trace-integrity',
      reason: 'archived',
    });
    const result = reconstructTrace(
      repository.getManifest(FIXTURE_TRACE_ID)!,
      repository.listEvents(FIXTURE_TRACE_ID),
    );
    if (!result.ok) throw new Error('setup failed');
    expect(result.value.lifecycleStatus).toBe('sealed');
    expect(result.value.sealedAt).toBe(TRACE_T5);
    expect(result.value.integrity.valid).toBe(true);
  });

  it('reports integrity_failed rather than a trustworthy-looking summary', () => {
    const { repository, manifest } = missionTrace();
    const forged = JSON.parse(JSON.stringify(repository.listEvents(FIXTURE_TRACE_ID))) as AqualaTraceEvent[];
    (forged[3].metadata as Record<string, unknown>).tampered = true;

    const result = reconstructTrace(manifest, forged);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.integrity.valid).toBe(false);
    expect(result.value.lifecycleStatus).toBe('integrity_failed');
  });

  it('fails deterministically on a contradictory status history', () => {
    const { repository, manifest } = newTraceFixture();
    appendTraceEventBatch(repository, {
      traceId: FIXTURE_TRACE_ID,
      drafts: [
        // completed without ever running — an illegal Milestone 1 transition
        statusDraft('evt-bad', 'execution', 'not_started', 'completed', TRACE_T1),
      ],
    });
    const result = reconstructTrace(manifest, repository.listEvents(FIXTURE_TRACE_ID));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('TRACE_RECONSTRUCTION_FAILED');
    expect(result.error.sequence).toBe(2);
  });

  it('fails on an empty ledger and never mutates its input', () => {
    const { repository, manifest } = missionTrace();
    expect(reconstructTrace(manifest, []).ok).toBe(false);

    const events = repository.listEvents(FIXTURE_TRACE_ID);
    const snapshot = JSON.stringify(events);
    reconstructTrace(manifest, events);
    expect(JSON.stringify(events)).toBe(snapshot);
  });
});
