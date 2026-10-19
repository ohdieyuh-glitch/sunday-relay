import { describe, expect, it } from 'vitest';

import {
  adaptCapsulePrepared,
  adaptCapsuleStatus,
  adaptCommandEvent,
  adaptCompletionClaim,
  adaptCostReceiptLink,
  adaptEvidenceLink,
  adaptFinalReport,
  adaptHeartbeat,
  adaptLaunchOutcome,
  adaptLaunchRequested,
  adaptPartialOutput,
  adaptStatusTransitionEvent,
} from './trace-adapters';
import { appendTraceEvent } from './trace-ledger';
import { newTraceFixture, FIXTURE_TRACE_ID, TRACE_T1, TRACE_T2 } from './trace-fixtures';
import { applyStatusTransition, createInitialAqualaOutcomeStatus } from '../status/status-model';
import { createCommandEvent } from '../commands/command-events';
import {
  attachLaunchAttestation,
  markCancelled,
  markCompleted,
  prepareExecutionCapsule,
  recordLaunchRequested,
} from '../execution-capsules/capsule-service';
import {
  claudeImplementationInput,
  codexReviewInput,
  CLAUDE_ACTUAL,
  CLAUDE_REQUESTED,
  CODEX_REQUESTED,
  CAPSULE_T1,
  CAPSULE_T2,
  CAPSULE_T4,
  completionClaim,
  failedAttestation,
  finalReport,
  MANUAL_ACTUAL,
  MOCK_WRAPPER_ACTUAL,
  observedOtherRuntimeAttestation,
  partialOutput,
  prepareFixture,
  runningFixture,
  verifiedAttestation,
} from '../execution-capsules/capsule-fixtures';
import type { RelayAgentExecutionCapsule } from '../execution-capsules/capsule-types';

/* ------------------------------------------------- Milestone 1 adapter */

describe('Milestone 1 status-transition adapter', () => {
  function acceptedTransition(
    dimension: 'execution' | 'outcome' | 'verification' | 'release',
    nextStatus: string,
    from = createInitialAqualaOutcomeStatus(),
  ) {
    const result = applyStatusTransition(from, {
      dimension,
      nextStatus,
      reason: 'test transition',
      actorId: 'relay-status-model',
      actorType: 'relay',
      eventId: 'status-evt-1',
      projectId: 'project-sunday',
      missionId: 'mission-auth',
      missionRevision: 4,
      artifactRevision: 'art-2',
      occurredAt: TRACE_T1,
    });
    if (!result.ok) throw new Error(`setup failed: ${result.error.reason}`);
    return result;
  }

  it.each([
    ['execution', 'running', 'mission_execution_status_changed', 'mission'],
    ['outcome', 'partial', 'mission_outcome_status_changed', 'mission'],
    ['verification', 'reviewing', 'mission_verification_status_changed', 'verification'],
  ] as const)('adapts a %s transition', (dimension, nextStatus, eventType, family) => {
    const accepted = acceptedTransition(dimension, nextStatus);
    const draft = adaptStatusTransitionEvent(accepted.event, {
      traceId: FIXTURE_TRACE_ID,
      eventId: 'evt-status',
    });

    expect(draft.eventType).toBe(eventType);
    expect(draft.eventFamily).toBe(family);
    expect(draft.missionRevision).toBe(4);
    expect(draft.artifactRevision).toBe('art-2');
    expect(draft.metadata.dimension).toBe(dimension);
    expect(draft.metadata.nextStatus).toBe(nextStatus);
    expect(draft.metadata.statusEventId).toBe('status-evt-1');
    expect(draft.sourceTrust).toBe('observed');
  });

  it('adapts a release transition into the release family', () => {
    const gated = {
      executionStatus: 'completed' as const,
      outcomeStatus: 'satisfied' as const,
      verificationStatus: 'verified' as const,
      releaseStatus: 'not_eligible' as const,
    };
    const accepted = acceptedTransition('release', 'human_approval_required', gated);
    const draft = adaptStatusTransitionEvent(accepted.event, {
      traceId: FIXTURE_TRACE_ID,
      eventId: 'evt-release',
    });
    expect(draft.eventType).toBe('mission_release_status_changed');
    expect(draft.eventFamily).toBe('release');
  });

  it('a REJECTED transition produces no event to adapt', () => {
    // Milestone 1 returns an error and NO event, so a refusal can never be
    // recorded as an applied change.
    const rejected = applyStatusTransition(createInitialAqualaOutcomeStatus(), {
      dimension: 'execution',
      nextStatus: 'completed',
      reason: 'illegal jump',
      actorId: 'relay-status-model',
      actorType: 'relay',
      eventId: 'status-evt-bad',
      projectId: 'project-sunday',
      missionId: 'mission-auth',
      missionRevision: 4,
      occurredAt: TRACE_T1,
    });
    expect(rejected.ok).toBe(false);
    expect('event' in rejected).toBe(false);
  });

  it('the adapted draft appends cleanly and preserves the status event id', () => {
    const { repository } = newTraceFixture();
    const accepted = acceptedTransition('execution', 'running');
    const appended = appendTraceEvent(repository, {
      traceId: FIXTURE_TRACE_ID,
      draft: adaptStatusTransitionEvent(accepted.event, {
        traceId: FIXTURE_TRACE_ID,
        eventId: 'evt-status',
      }),
    });
    expect(appended.ok).toBe(true);
    if (!appended.ok) return;
    expect(appended.value.sequence).toBe(2);
    expect(appended.value.metadata.statusEventId).toBe('status-evt-1');
  });
});

/* ------------------------------------------------- Milestone 2 adapter */

describe('Milestone 2 command-event adapter', () => {
  const commandEvent = (eventType: string, sequence: number, metadata: Record<string, unknown> = {}) =>
    createCommandEvent({
      eventId: `cmd-evt-${sequence}`,
      commandId: 'cmd-auth-1',
      projectId: 'project-sunday',
      missionId: 'mission-auth',
      missionRevision: 4,
      sequence,
      eventType: eventType as never,
      actorId: 'user-founder',
      occurredAt: TRACE_T1,
      metadata,
    });

  it.each([
    ['command_received', 'command_received', 'command'],
    ['command_interpreted', 'command_interpreted', 'command'],
    ['command_validated', 'command_validated', 'command'],
    ['command_rejected', 'command_rejected', 'command'],
    ['checkpoint_required', 'command_checkpoint_required', 'command'],
    ['checkpoint_satisfied', 'command_checkpoint_satisfied', 'command'],
    ['approval_required', 'command_approval_required', 'approval'],
    ['approval_received', 'command_approval_received', 'approval'],
    ['state_change_applied', 'command_state_change_applied', 'command'],
    ['command_executed', 'command_executed', 'command'],
    ['command_failed', 'command_failed', 'command'],
  ])('adapts %s', (commandType, traceType, family) => {
    const draft = adaptCommandEvent(commandEvent(commandType, 3), {
      traceId: FIXTURE_TRACE_ID,
      eventId: `evt-${traceType}`,
    });
    expect(draft).not.toBeNull();
    if (!draft) return;
    expect(draft.eventType).toBe(traceType);
    expect(draft.eventFamily).toBe(family);
    expect(draft.commandId).toBe('cmd-auth-1');
    expect(draft.missionRevision).toBe(4);
  });

  it('preserves the command-LOCAL sequence in metadata while the ledger owns trace order', () => {
    const { repository } = newTraceFixture();
    const draft = adaptCommandEvent(commandEvent('command_received', 7), {
      traceId: FIXTURE_TRACE_ID,
      eventId: 'evt-cmd',
    });
    expect(draft?.metadata.commandLocalSequence).toBe(7);

    const appended = appendTraceEvent(repository, { traceId: FIXTURE_TRACE_ID, draft: draft! });
    expect(appended.ok).toBe(true);
    if (!appended.ok) return;
    // Global trace sequence is 2 — the command's own 7 is only metadata.
    expect(appended.value.sequence).toBe(2);
    expect(appended.value.metadata.commandLocalSequence).toBe(7);
  });

  it('carries redacted command metadata through and re-redacts at the ledger', () => {
    const { repository } = newTraceFixture();
    const draft = adaptCommandEvent(
      commandEvent('command_received', 0, { note: 'token=abcdef1234567890' }),
      { traceId: FIXTURE_TRACE_ID, eventId: 'evt-secret' },
    );
    const appended = appendTraceEvent(repository, { traceId: FIXTURE_TRACE_ID, draft: draft! });
    expect(appended.ok).toBe(true);
    if (!appended.ok) return;
    expect(JSON.stringify(appended.value)).not.toContain('abcdef1234567890');
  });

  it('returns null for an unmapped command event type', () => {
    expect(
      adaptCommandEvent(commandEvent('command_clarification_required', 1), {
        traceId: FIXTURE_TRACE_ID,
        eventId: 'evt-x',
      }),
    ).not.toBeNull();
    const unknown = { ...commandEvent('command_received', 1), eventType: 'invented' as never };
    expect(adaptCommandEvent(unknown, { traceId: FIXTURE_TRACE_ID, eventId: 'evt-y' })).toBeNull();
  });
});

/* ------------------------------------------------- Milestone 3 adapter */

describe('Milestone 3 capsule adapter', () => {
  const options = (eventId: string, occurredAt = TRACE_T2) => ({
    traceId: FIXTURE_TRACE_ID,
    eventId,
    occurredAt,
  });

  function startingCapsule(input = claudeImplementationInput()): RelayAgentExecutionCapsule {
    const prepared = prepareFixture(input);
    const starting = recordLaunchRequested(prepared, CAPSULE_T1);
    if (!starting.ok) throw new Error('setup failed');
    return starting.value;
  }

  it('adapts capsule preparation with the REQUESTED identity and every binding', () => {
    const capsule = prepareFixture(claudeImplementationInput());
    const draft = adaptCapsulePrepared(capsule, options('evt-prepared'));

    expect(draft.eventType).toBe('execution_capsule_prepared');
    expect(draft.capsuleId).toBe('cap-claude-impl');
    expect(draft.runId).toBe('run-claude-1');
    expect(draft.missionRevision).toBe(4);
    expect(draft.taskRevision).toBe(2);
    expect(draft.metadata.requestedAgentId).toBe('agent-claude');
    expect(draft.metadata.actualAgentId).toBeUndefined();
    expect(draft.metadata.handoffId).toBe('handoff-auth-repair-1');
    expect(draft.metadata.handoffCompilerVersion).toBe('0.3.1');
    expect(draft.metadata.policyPackVersion).toBe('implementation-v3');
    expect(draft.metadata.passportId).toBe('passport-claude-1');
    expect(draft.metadata.workspaceId).toBe('workspace-auth');
  });

  it('adapts a launch request without any actual identity', () => {
    const draft = adaptLaunchRequested(startingCapsule(), options('evt-launch-req'));
    expect(draft.eventType).toBe('agent_launch_requested');
    expect(draft.metadata.launchVerified).toBe(false);
    expect(draft.metadata.actualAgentId).toBeUndefined();
  });

  it('adapts a VERIFIED launch as attested, carrying both identities', () => {
    const capsule = runningFixture(claudeImplementationInput(), CLAUDE_ACTUAL);
    const draft = adaptLaunchOutcome(capsule, options('evt-verified'));
    expect(draft).not.toBeNull();
    if (!draft) return;

    expect(draft.eventType).toBe('agent_launch_verified');
    expect(draft.sourceTrust).toBe('attested');
    expect(draft.metadata.requestedAgentId).toBe('agent-claude');
    expect(draft.metadata.actualAgentId).toBe('agent-claude');
    expect(draft.metadata.launchVerified).toBe(true);
    expect(draft.metadata.attestationId).toBeTruthy();
  });

  it('adapts a FAILED launch with no actual identity and no credit', () => {
    const starting = startingCapsule(codexReviewInput());
    const failed = attachLaunchAttestation(starting, {
      attestation: failedAttestation('cap-codex-review', CODEX_REQUESTED, 'permission denied'),
      at: CAPSULE_T2,
    });
    if (!failed.ok) throw new Error('setup failed');

    const draft = adaptLaunchOutcome(failed.value, options('evt-failed'));
    expect(draft?.eventType).toBe('agent_launch_failed');
    expect(draft?.metadata.actualAgentId).toBeUndefined();
    expect(draft?.metadata.launchVerified).toBe(false);
    expect(draft?.metadata.failureReason).toBe('permission denied');
  });

  it('adapts an AUTHORIZED fallback keeping both identities visible', () => {
    const starting = startingCapsule();
    const verified = attachLaunchAttestation(starting, {
      attestation: verifiedAttestation('cap-claude-impl', CLAUDE_REQUESTED, MANUAL_ACTUAL),
      actualAgent: MANUAL_ACTUAL,
      fallbackAuthorization: { authorized: true, authorizedBy: 'user-founder', reason: 'unavailable' },
      at: CAPSULE_T2,
    });
    if (!verified.ok) throw new Error('setup failed');

    const draft = adaptLaunchOutcome(verified.value, options('evt-fallback-ok'));
    expect(draft?.eventType).toBe('agent_fallback_authorized');
    expect(draft?.metadata.requestedAgentId).toBe('agent-claude');
    expect(draft?.metadata.actualAgentId).toBe('agent-manual');
    expect(draft?.metadata.fallbackAuthorized).toBe(true);
  });

  it('adapts an UNAUTHORIZED wrapper as a SECURITY event with no Codex credit', () => {
    const starting = startingCapsule(codexReviewInput());
    const wrapper = attachLaunchAttestation(starting, {
      attestation: observedOtherRuntimeAttestation('cap-codex-review', CODEX_REQUESTED, MOCK_WRAPPER_ACTUAL),
      actualAgent: MOCK_WRAPPER_ACTUAL,
      at: CAPSULE_T2,
    });
    if (!wrapper.ok) throw new Error('setup failed');

    const draft = adaptLaunchOutcome(wrapper.value, options('evt-wrapper'));
    expect(draft?.eventType).toBe('agent_fallback_rejected');
    expect(draft?.eventFamily).toBe('security');
    expect(draft?.metadata.requestedAgentId).toBe('agent-codex');
    // OBSERVED, never actual — the wrapper is not credited as Codex.
    expect(draft?.metadata.observedAgentId).toBe('agent-mock-wrapper');
    expect(draft?.metadata.actualAgentId).toBeUndefined();
    expect(draft?.metadata.launchVerified).toBe(false);
    expect(draft?.metadata.fallbackAuthorized).toBe(false);
  });

  it('adapts capsule status changes', () => {
    const running = runningFixture(claudeImplementationInput(), CLAUDE_ACTUAL);
    expect(adaptCapsuleStatus(running, options('evt-running'))?.eventType).toBe(
      'agent_execution_started',
    );

    const cancelled = markCancelled(running, { at: CAPSULE_T4, partialOutput: partialOutput() });
    if (!cancelled.ok) throw new Error('setup failed');
    expect(adaptCapsuleStatus(cancelled.value, options('evt-cancelled'))?.eventType).toBe(
      'agent_execution_cancelled',
    );

    const prepared = prepareFixture(claudeImplementationInput());
    expect(adaptCapsuleStatus(prepared, options('evt-prepared-status'))).toBeNull();
  });

  it('adapts heartbeat, partial output, final report, and completion claim', () => {
    const running = runningFixture(claudeImplementationInput(), CLAUDE_ACTUAL);
    expect(adaptHeartbeat(running, options('evt-hb')).eventType).toBe('agent_heartbeat');

    const cancelled = markCancelled(running, { at: CAPSULE_T4, partialOutput: partialOutput() });
    if (!cancelled.ok) throw new Error('setup failed');
    const partialDraft = adaptPartialOutput(cancelled.value, options('evt-partial'));
    expect(partialDraft?.eventType).toBe('agent_partial_output_saved');
    expect(partialDraft?.metadata.changedFileCount).toBe(2);

    const completed = markCompleted(running, {
      at: CAPSULE_T4,
      finalReport: finalReport('agent-claude'),
      completionClaim: completionClaim('agent-claude'),
    });
    if (!completed.ok) throw new Error('setup failed');

    const reportDraft = adaptFinalReport(completed.value, options('evt-report'));
    expect(reportDraft?.eventType).toBe('agent_final_report_received');
    expect(reportDraft?.actorType).toBe('agent');
    expect(reportDraft?.sourceTrust).toBe('claim');

    const claimDraft = adaptCompletionClaim(completed.value, options('evt-claim'));
    expect(claimDraft?.eventType).toBe('agent_completion_claim_received');
    // A claim stays a claim, and says so explicitly.
    expect(claimDraft?.sourceTrust).toBe('claim');
    expect(claimDraft?.metadata.establishesVerification).toBe(false);
  });

  it('adapts evidence and cost-receipt links WITHOUT calculating anything', () => {
    const running = runningFixture(claudeImplementationInput(), CLAUDE_ACTUAL);

    const evidence = adaptEvidenceLink(running, 'ev-tests-1', options('evt-evidence'));
    expect(evidence.eventType).toBe('evidence_reference_linked');
    expect(evidence.metadata.evidenceId).toBe('ev-tests-1');

    const cost = adaptCostReceiptLink(running, 'receipt-1', options('evt-cost'));
    expect(cost.eventType).toBe('cost_receipt_reference_linked');
    expect(cost.eventFamily).toBe('economics');
    expect(cost.metadata.costReceiptId).toBe('receipt-1');
    expect(cost.metadata.amountCalculated).toBe(false);
    // No amount, no total, no currency anywhere.
    expect(JSON.stringify(cost.metadata)).not.toMatch(/usd|amount"|total/iu);
  });

  it('never mutates the capsule it adapts', () => {
    const capsule = runningFixture(claudeImplementationInput(), CLAUDE_ACTUAL);
    const snapshot = JSON.stringify(capsule);
    adaptCapsulePrepared(capsule, options('evt-a'));
    adaptLaunchOutcome(capsule, options('evt-b'));
    adaptCapsuleStatus(capsule, options('evt-c'));
    adaptEvidenceLink(capsule, 'ev-1', options('evt-d'));
    expect(JSON.stringify(capsule)).toBe(snapshot);
  });

  it('adapted capsule drafts append cleanly in order', () => {
    const { repository } = newTraceFixture();
    const capsule = runningFixture(claudeImplementationInput(), CLAUDE_ACTUAL);
    const prepared = prepareExecutionCapsule(claudeImplementationInput());
    expect(prepared.ok).toBe(true);

    const first = appendTraceEvent(repository, {
      traceId: FIXTURE_TRACE_ID,
      draft: adaptCapsulePrepared(capsule, options('evt-p', TRACE_T1)),
    });
    const second = appendTraceEvent(repository, {
      traceId: FIXTURE_TRACE_ID,
      subjectAgentIds: ['agent-claude'],
      draft: adaptLaunchOutcome(capsule, options('evt-v', TRACE_T2))!,
    });
    expect(first.ok && second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.sequence).toBe(3);
    expect(second.value.sourceTrust).toBe('attested');
  });
});
