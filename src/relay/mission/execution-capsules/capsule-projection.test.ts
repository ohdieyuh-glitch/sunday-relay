import { describe, expect, it } from 'vitest';

import {
  CAPSULE_T1,
  CAPSULE_T2,
  CAPSULE_T3,
  CAPSULE_T4,
  CLAUDE_ACTUAL,
  claudeImplementationInput,
  codexReviewInput,
  CODEX_ACTUAL,
  CODEX_REQUESTED,
  completionClaim,
  failedAttestation,
  finalReport,
  MOCK_WRAPPER_ACTUAL,
  observedOtherRuntimeAttestation,
  prepareFixture,
  runningFixture,
} from './capsule-fixtures';
import { projectAgentRun } from './capsule-projection';
import {
  appendCapsuleTraceReference,
  attachCostReceiptId,
  attachEvidenceId,
  attachLaunchAttestation,
  markCompleted,
  recordLaunchRequested,
} from './capsule-service';
import type { RelayAgentExecutionCapsule } from './capsule-types';

function completedReviewer(): RelayAgentExecutionCapsule {
  let capsule = runningFixture(codexReviewInput(), CODEX_ACTUAL);
  const activity: Array<[Parameters<typeof appendCapsuleTraceReference>[1]['channel'], string]> = [
    ['fileEvents', 'evt-file-1'],
    ['fileEvents', 'evt-file-2'],
    ['toolEvents', 'evt-tool-1'],
    ['reviewEvents', 'evt-finding-1'],
  ];
  for (const [channel, eventId] of activity) {
    const result = appendCapsuleTraceReference(capsule, {
      channel,
      reference: {
        referenceId: `ref-${eventId}`,
        eventId,
        eventType: `${channel}.observed`,
        occurredAt: CAPSULE_T3,
        actorId: 'workspace-monitor',
        source: 'workspace_monitor',
        integrity: 'trusted_source',
      },
      at: CAPSULE_T3,
    });
    if (!result.ok) throw new Error(result.error.reason);
    capsule = result.value;
  }
  const claim = appendCapsuleTraceReference(capsule, {
    channel: 'commandEvents',
    reference: {
      referenceId: 'ref-claim-1',
      eventId: 'evt-claim-1',
      eventType: 'agent.command_claimed',
      occurredAt: CAPSULE_T3,
      actorId: 'agent-codex',
      source: 'agent_report',
    },
    at: CAPSULE_T3,
  });
  if (!claim.ok) throw new Error(claim.error.reason);

  const withFinding = attachEvidenceId(claim.value, 'finding-auth-1', CAPSULE_T3);
  if (!withFinding.ok) throw new Error(withFinding.error.reason);
  const completed = markCompleted(withFinding.value, {
    at: CAPSULE_T4,
    finalReport: finalReport('agent-codex', { reportFormat: 'relay-review-report/1' }),
  });
  if (!completed.ok) throw new Error(completed.error.reason);
  return completed.value;
}

describe('agent run projection', () => {
  it('renders the reviewer run with requested and actual identity kept SEPARATE', () => {
    const projection = projectAgentRun(completedReviewer());

    expect(projection.headline).toBe('agent-codex — review');
    expect(projection.taskId).toBe('task-auth-review');
    expect(projection.execution).toBe('Completed');
    expect(projection.executionStatus).toBe('completed');

    expect(projection.identity).toEqual({
      requested: 'agent-codex',
      actual: 'agent-codex',
      observed: 'agent-codex',
      launchVerified: 'Yes',
      fallback: 'No',
    });

    expect(projection.context).toEqual({
      missionRevision: 4,
      taskRevision: 2,
      handoffCompilerVersion: '0.3.1',
      policyPackVersion: 'security-review-v2',
      passportId: 'passport-codex-1',
    });

    expect(projection.workspace).toEqual({
      label: 'Read-only cli worktree',
      branch: 'auth-repair',
      baseCommit: 'abc123',
      readOnly: true,
    });

    expect(projection.activity.fileEventReferences).toBe(2);
    expect(projection.activity.reviewEventReferences).toBe(1);
    expect(projection.activity.supervisoryReferences).toBe(4);
    expect(projection.activity.agentClaimReferences).toBe(1);
    expect(projection.report).toBe('Final report received');
  });

  it('shows PENDING cost when no receipt exists, and never a zero amount', () => {
    const projection = projectAgentRun(completedReviewer());
    expect(projection.cost).toBe('Pending cost receipts');
    expect(JSON.stringify(projection)).not.toContain('$0');
    expect(JSON.stringify(projection)).not.toContain('0.00');
  });

  it('reports attached receipts once they arrive', () => {
    const withReceipt = attachCostReceiptId(completedReviewer(), 'receipt-1', CAPSULE_T4);
    if (!withReceipt.ok) throw new Error('setup failed');
    expect(projectAgentRun(withReceipt.value).cost).toBe('1 cost receipt(s)');
  });

  it('never fabricates a review verdict from capsule completion', () => {
    const projection = projectAgentRun(completedReviewer());
    const serialized = JSON.stringify(projection).toLowerCase();
    expect(serialized).not.toContain('changes required');
    expect(serialized).not.toContain('changes_required');
    // The projection has no verdict field at all, and the only place the word
    // "approved" may appear is the explicit list of what a capsule does NOT
    // establish.
    expect(Object.keys(projection)).not.toContain('verdict');
    const withoutDisclaimer = JSON.stringify({ ...projection, doesNotEstablish: [] }).toLowerCase();
    expect(withoutDisclaimer).not.toContain('approved');
    expect(projection.doesNotEstablish).toContain('a review verdict');
    expect(projection.doesNotEstablish).toContain('verification approved or verified');
    expect(projection.doesNotEstablish).toContain('release eligible');
    // Review CREDIT (identity eligibility) is not a verdict.
    expect(projection.reviewCredit.eligible).toBe(true);
    expect(projection.reviewCredit.creditedAgentId).toBe('agent-codex');
  });

  it('a completion claim is labeled a claim, never verification', () => {
    const running = runningFixture(claudeImplementationInput(), CLAUDE_ACTUAL);
    const completed = markCompleted(running, {
      at: CAPSULE_T4,
      finalReport: finalReport('agent-claude'),
      completionClaim: completionClaim('agent-claude'),
    });
    if (!completed.ok) throw new Error('setup failed');
    const projection = projectAgentRun(completed.value);
    expect(projection.completionClaim).toContain('a claim, not verification');
  });

  it('a failed launch shows the requested agent with NO actual identity', () => {
    const prepared = prepareFixture(codexReviewInput());
    const starting = recordLaunchRequested(prepared, CAPSULE_T1);
    if (!starting.ok) throw new Error('setup failed');
    const failed = attachLaunchAttestation(starting.value, {
      attestation: failedAttestation('cap-codex-review', CODEX_REQUESTED, 'execution permission denied'),
      at: CAPSULE_T2,
    });
    if (!failed.ok) throw new Error('setup failed');

    const projection = projectAgentRun(failed.value);
    expect(projection.identity.requested).toBe('agent-codex');
    expect(projection.identity.actual).toBeNull();
    expect(projection.identity.observed).toBeNull();
    expect(projection.identity.launchVerified).toBe('No');
    expect(projection.headline).toBe('agent-codex — review');
    expect(projection.reviewCredit.eligible).toBe(false);
  });

  it('an unauthorized fallback shows WHAT RAN without granting it the requested identity', () => {
    const prepared = prepareFixture(codexReviewInput());
    const starting = recordLaunchRequested(prepared, CAPSULE_T1);
    if (!starting.ok) throw new Error('setup failed');
    const wrapper = attachLaunchAttestation(starting.value, {
      attestation: observedOtherRuntimeAttestation('cap-codex-review', CODEX_REQUESTED, MOCK_WRAPPER_ACTUAL),
      actualAgent: MOCK_WRAPPER_ACTUAL,
      at: CAPSULE_T2,
    });
    if (!wrapper.ok) throw new Error('setup failed');

    const projection = projectAgentRun(wrapper.value);
    expect(projection.identity.requested).toBe('agent-codex');
    expect(projection.identity.actual).toBeNull();
    expect(projection.identity.observed).toBe('agent-mock-wrapper');
    expect(projection.identity.fallback).toBe('Yes — NOT authorized');
    expect(projection.reviewCredit.eligible).toBe(false);
  });

  it('trace integrity is reported as not evaluated, never as verified', () => {
    expect(projectAgentRun(completedReviewer()).traceIntegrity).toMatch(/Not evaluated/u);
  });

  it('a run with no workspace projects a null workspace block', () => {
    const projection = projectAgentRun(prepareFixture(codexReviewInput({ workspace: undefined })));
    expect(projection.workspace).toBeNull();
  });
});
