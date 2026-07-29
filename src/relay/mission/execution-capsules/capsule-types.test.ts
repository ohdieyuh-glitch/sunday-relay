import { describe, expect, it } from 'vitest';

import {
  browserWorkspace,
  CAPSULE_T1,
  CAPSULE_T2,
  CAPSULE_T4,
  CLAUDE_ACTUAL,
  CLAUDE_REQUESTED,
  claudeImplementationInput,
  codexReviewInput,
  completionClaim,
  finalReport,
  MANUAL_ACTUAL,
  prepareFixture,
  runningFixture,
} from './capsule-fixtures';
import { capsuleCostState, capsuleIdentityFacts, validateCapsuleInvariants } from './capsule-types';
import type { RelayAgentExecutionCapsule } from './capsule-types';
import { markCompleted } from './capsule-service';

const running = () => runningFixture(claudeImplementationInput(), CLAUDE_ACTUAL);

describe('capsule identity facts', () => {
  it('flattens the identity union without inventing an actual agent', () => {
    const prepared = prepareFixture(claudeImplementationInput());
    expect(capsuleIdentityFacts(prepared)).toEqual({
      requestedAgentId: 'agent-claude',
      requestedAgentType: 'claude_code',
      actualAgentId: undefined,
      actualAgentType: undefined,
      launchRequested: false,
      launchVerified: false,
      fallbackOccurred: false,
      fallbackAuthorized: false,
    });
  });

  it('reports a verified run with both identities', () => {
    const facts = capsuleIdentityFacts(running());
    expect(facts.launchVerified).toBe(true);
    expect(facts.actualAgentId).toBe('agent-claude');
    expect(facts.fallbackOccurred).toBe(false);
  });

  it('reports cost as pending until receipts arrive', () => {
    expect(capsuleCostState(running())).toBe('pending');
  });
});

describe('cross-field invariants', () => {
  const forge = (over: Partial<RelayAgentExecutionCapsule>): RelayAgentExecutionCapsule => ({
    ...running(),
    ...over,
  });

  it('accepts a coherent capsule', () => {
    expect(validateCapsuleInvariants(running())).toBeNull();
    expect(validateCapsuleInvariants(prepareFixture(claudeImplementationInput()))).toBeNull();
  });

  it('requires a requested agent id', () => {
    const forged = forge({
      identity: { kind: 'requested', requested: { agentId: '', agentType: 'claude_code' } },
      status: 'prepared',
      startedAt: undefined,
    });
    expect(validateCapsuleInvariants(forged)?.code).toBe('MISSING_REQUESTED_AGENT');
  });

  it.each(['running', 'waiting', 'stalled'] as const)(
    '%s requires a verified launch',
    (status) => {
      const prepared = prepareFixture(claudeImplementationInput());
      const forged = forge({
        ...prepared,
        status,
        startedAt: CAPSULE_T2,
      });
      expect(validateCapsuleInvariants(forged)?.code).toBe('LAUNCH_NOT_VERIFIED');
    },
  );

  it('an unauthorized fallback cannot sit in a non-terminal activity state', () => {
    const forged = forge({
      identity: {
        kind: 'fallback_unauthorized',
        requested: CLAUDE_REQUESTED,
        observed: MANUAL_ACTUAL,
        launchRequestedAt: CAPSULE_T1,
        attestationId: 'att-x',
        reason: 'not authorized',
      },
      status: 'running',
      startedAt: CAPSULE_T2,
    });
    expect(validateCapsuleInvariants(forged)?.code).toBe('UNAUTHORIZED_FALLBACK');
  });

  it('completed requires a final report unless waived', () => {
    const forged = forge({ status: 'completed', finishedAt: CAPSULE_T4 });
    expect(validateCapsuleInvariants(forged)?.code).toBe('FINAL_REPORT_REQUIRED');

    const waived = forge({
      status: 'completed',
      finishedAt: CAPSULE_T4,
      binding: { ...running().binding, finalReportWaived: true },
    });
    expect(validateCapsuleInvariants(waived)).toBeNull();
  });

  it('a verified fallback must actually differ from the requested agent', () => {
    const forged = forge({
      identity: {
        kind: 'verified',
        requested: CLAUDE_REQUESTED,
        actual: CLAUDE_ACTUAL,
        launchRequestedAt: CAPSULE_T1,
        launchVerifiedAt: CAPSULE_T2,
        attestationId: 'att-x',
        fallback: { occurred: true, authorized: true, authorizedBy: 'founder', reason: 'test' },
      },
    });
    expect(validateCapsuleInvariants(forged)?.code).toBe('UNAUTHORIZED_FALLBACK');
  });

  it('a different actual agent MUST be recorded as a fallback', () => {
    const forged = forge({
      identity: {
        kind: 'verified',
        requested: CLAUDE_REQUESTED,
        actual: MANUAL_ACTUAL,
        launchRequestedAt: CAPSULE_T1,
        launchVerifiedAt: CAPSULE_T2,
        attestationId: 'att-x',
        fallback: { occurred: false },
      },
    });
    expect(validateCapsuleInvariants(forged)?.code).toBe('UNAUTHORIZED_FALLBACK');
  });

  it('a file-changing responsibility requires a writable workspace', () => {
    expect(validateCapsuleInvariants(forge({ workspace: undefined }))?.code).toBe(
      'WORKSPACE_REQUIRED',
    );
    expect(
      validateCapsuleInvariants(forge({ workspace: { ...browserWorkspace(), readOnly: true } }))?.code,
    ).toBe('WORKSPACE_INCOMPATIBLE');
  });

  it.each([
    ['a terminal capsule with no finishedAt', { status: 'failed' as const }, 'INVALID_TIMESTAMP_ORDER'],
    [
      'finishedAt before startedAt',
      { status: 'failed' as const, finishedAt: CAPSULE_T1 },
      'INVALID_TIMESTAMP_ORDER',
    ],
    [
      'a heartbeat before startedAt',
      { lastHeartbeatAt: CAPSULE_T1 },
      'INVALID_TIMESTAMP_ORDER',
    ],
  ] as const)('rejects %s', (_label, over, code) => {
    expect(validateCapsuleInvariants(forge(over))?.code).toBe(code);
  });

  it('rejects duplicate evidence and cost receipt ids', () => {
    expect(validateCapsuleInvariants(forge({ evidenceIds: ['ev-1', 'ev-1'] }))?.code).toBe(
      'DUPLICATE_EVIDENCE_REFERENCE',
    );
    expect(
      validateCapsuleInvariants(forge({ costReceiptIds: ['receipt-1', 'receipt-1'] }))?.code,
    ).toBe('DUPLICATE_COST_RECEIPT_REFERENCE');
  });

  it('a run whose launch was never verified cannot hold a report or claim', () => {
    const prepared = prepareFixture(claudeImplementationInput());
    const forged = forge({
      ...prepared,
      identity: {
        kind: 'launch_requested',
        requested: CLAUDE_REQUESTED,
        launchRequestedAt: CAPSULE_T1,
      },
      status: 'starting',
      startedAt: undefined,
      finishedAt: undefined,
      finalReport: finalReport('agent-claude'),
    });
    expect(validateCapsuleInvariants(forged)?.code).toBe('ACTUAL_AGENT_NOT_VERIFIED');
  });
});

describe('responsibility and revision binding', () => {
  it('binds mission and task revisions at preparation', () => {
    const capsule = prepareFixture(claudeImplementationInput());
    expect(capsule.binding.missionRevision).toBe(4);
    expect(capsule.binding.taskRevision).toBe(2);
  });

  it('an old capsule stays attributable to the revision it received', () => {
    const first = prepareFixture(claudeImplementationInput());
    const later = prepareFixture(
      claudeImplementationInput({
        capsuleId: 'cap-claude-impl-v5',
        runId: 'run-claude-2',
        missionRevision: 5,
        taskRevision: 3,
      }),
    );
    expect(first.binding.missionRevision).toBe(4);
    expect(later.binding.missionRevision).toBe(5);
    expect(first.capsuleId).not.toBe(later.capsuleId);
    expect(first.runId).not.toBe(later.runId);
  });

  it('the binding block is frozen on the prepared record', () => {
    const capsule = prepareFixture(codexReviewInput());
    expect(Object.isFrozen(capsule.binding)).toBe(true);
    expect(() => {
      (capsule.binding as { missionRevision: number }).missionRevision = 9;
    }).toThrow();
  });

  it('completion keeps the final report bound to the revision the agent received', () => {
    const completed = markCompleted(running(), {
      at: CAPSULE_T4,
      finalReport: finalReport('agent-claude'),
      completionClaim: completionClaim('agent-claude'),
    });
    expect(completed.ok).toBe(true);
    if (!completed.ok) return;
    expect(completed.value.binding.missionRevision).toBe(4);
    expect(completed.value.binding.taskRevision).toBe(2);
    expect(completed.value.finalReport?.receivedAt).toBe(CAPSULE_T4);
  });

  it('the handoff, policy pack, and passport travel with the run', () => {
    const capsule = prepareFixture(claudeImplementationInput());
    expect(capsule.binding.handoffId).toBe('handoff-auth-repair-1');
    expect(capsule.binding.handoffCompilerVersion).toBe('0.3.1');
    expect(capsule.binding.policyPackVersion).toBe('implementation-v3');
    expect(capsule.binding.passportId).toBe('passport-claude-1');
    expect(capsule.permissions.permissionPolicyVersion).toBe('permissions-v3');
    expect(capsule.permissions.capturedAt).toBe(capsule.createdAt);
  });

  it('a later permission change never rewrites the preparation snapshot', () => {
    const capsule = running();
    const snapshot = JSON.stringify(capsule.permissions);
    // Permission changes arrive as trace references, not as snapshot edits —
    // the snapshot has no mutation path at all.
    expect(Object.isFrozen(capsule.permissions)).toBe(true);
    expect(JSON.stringify(capsule.permissions)).toBe(snapshot);
    expect(capsule.permissions.effective.productionAccess).toBe(false);
  });

  it('a reviewer permission snapshot is read-only and carries no secrets', () => {
    const reviewer = prepareFixture(codexReviewInput());
    expect(reviewer.permissions.readOnly).toBe(true);
    expect(reviewer.permissions.effective.writablePaths).toEqual([]);
    expect(reviewer.permissions.effective.secretPolicy).toBe('handles_only');
    expect(JSON.stringify(reviewer.permissions)).not.toMatch(/sk-|Bearer /u);
  });
});
