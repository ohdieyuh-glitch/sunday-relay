import { describe, expect, it } from 'vitest';

import {
  CAPSULE_T1,
  CAPSULE_T2,
  CLAUDE_ACTUAL,
  CLAUDE_REQUESTED,
  claudeImplementationInput,
  codexReviewInput,
  CODEX_ACTUAL,
  CODEX_REQUESTED,
  failedAttestation,
  MANUAL_ACTUAL,
  MOCK_WRAPPER_ACTUAL,
  observedOtherRuntimeAttestation,
  prepareFixture,
  verifiedAttestation,
} from './capsule-fixtures';
import {
  adaptProductionExecutionAttestation,
  createLaunchAttestation,
  evaluateReviewCredit,
  identityActualAgentId,
  identityFallbackAuthorized,
  identityFallbackOccurred,
  identityLaunchRequested,
  identityLaunchVerified,
  identityObservedAgentId,
  identitySubjectAgentIds,
  isSameExecutionParty,
} from './capsule-identity';
import { attachLaunchAttestation, markRunning, recordLaunchRequested } from './capsule-service';
import type { RelayExecutionAttestation } from '../contracts';

function startingCapsule(input = claudeImplementationInput()) {
  const prepared = prepareFixture(input);
  const starting = recordLaunchRequested(prepared, CAPSULE_T1);
  if (!starting.ok) throw new Error('setup failed');
  return starting.value;
}

describe('launch attestation boundary', () => {
  it('an agent may never attest its own launch', () => {
    const result = createLaunchAttestation({
      attestationId: 'att-self',
      capsuleId: 'cap-claude-impl',
      requestedAgentId: 'agent-claude',
      actualAgentId: 'agent-claude',
      launchRequestedAt: CAPSULE_T1,
      launchVerifiedAt: CAPSULE_T2,
      verificationSource: 'relay_supervisor',
      verified: true,
      attestedBy: 'agent-claude',
    });
    expect(!result.ok && result.error.code).toBe('AGENT_SELF_ATTESTATION_FORBIDDEN');
  });

  it('a trusted supervisor attestation is accepted', () => {
    const result = createLaunchAttestation({
      attestationId: 'att-ok',
      capsuleId: 'cap-claude-impl',
      requestedAgentId: 'agent-claude',
      actualAgentId: 'agent-claude',
      launchRequestedAt: CAPSULE_T1,
      launchVerifiedAt: CAPSULE_T2,
      verificationSource: 'relay_supervisor',
      verified: true,
      attestedBy: 'relay-supervisor',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.isFrozen(result.value)).toBe(true);
  });

  it.each([
    [
      'no verification source',
      { verificationSource: 'none' as const, actualAgentId: 'agent-claude', launchVerifiedAt: CAPSULE_T2 },
      'INVALID_LAUNCH_ATTESTATION',
    ],
    [
      'no observed identity',
      { verificationSource: 'relay_supervisor' as const, launchVerifiedAt: CAPSULE_T2 },
      'INVALID_LAUNCH_ATTESTATION',
    ],
    [
      'no verification time',
      { verificationSource: 'relay_supervisor' as const, actualAgentId: 'agent-claude' },
      'INVALID_LAUNCH_ATTESTATION',
    ],
  ] as const)('a verified attestation with %s is rejected', (_label, over, code) => {
    const result = createLaunchAttestation({
      attestationId: 'att-bad',
      capsuleId: 'cap-claude-impl',
      requestedAgentId: 'agent-claude',
      launchRequestedAt: CAPSULE_T1,
      verified: true,
      attestedBy: 'relay-supervisor',
      ...over,
    });
    expect(!result.ok && result.error.code).toBe(code);
  });

  it('verification cannot precede the launch request', () => {
    const result = createLaunchAttestation({
      attestationId: 'att-time',
      capsuleId: 'cap-claude-impl',
      requestedAgentId: 'agent-claude',
      actualAgentId: 'agent-claude',
      launchRequestedAt: CAPSULE_T2,
      launchVerifiedAt: CAPSULE_T1,
      verificationSource: 'relay_supervisor',
      verified: true,
      attestedBy: 'relay-supervisor',
    });
    expect(!result.ok && result.error.code).toBe('INVALID_TIMESTAMP_ORDER');
  });

  it('adapts the PRODUCTION execution attestation without inventing facts', () => {
    const production = {
      attestationId: 'att-prod-1',
      projectId: 'project-sunday',
      missionId: 'mission-auth',
      taskId: 'task-auth-repair',
      requestedAgentId: 'agent-claude',
      requestedAgentType: 'claude_code',
      requestedRole: 'coding_agent',
      actualAgentId: 'agent-claude',
      actualAgentType: 'claude_code',
      actualRole: 'coding_agent',
      adapterId: 'adapter-claude-code',
      adapterVersion: '2.1.0',
      runtimeVersion: '2.1.0',
      modelVersion: 'fixture-1',
      runId: 'run-claude-1',
      externalSessionId: 'session-fixture-claude',
      workspaceId: 'workspace-auth',
      policyReference: 'implementation-v3',
      startedAt: CAPSULE_T1,
      finishedAt: null,
      launchRequested: true,
      launchVerified: true,
      completionSignalReceived: true,
      workspaceInspectionCompleted: true,
      verificationCompleted: false,
      fallbackOccurred: false,
      fallbackAgentId: null,
      fallbackReason: null,
      outputDigest: null,
      activityDigest: null,
      evidenceIds: [],
      provenance: 'simulated',
      immutable: true,
    } as RelayExecutionAttestation;

    const adapted = adaptProductionExecutionAttestation(production, 'cap-claude-impl', 'relay-supervisor');
    expect(adapted.ok).toBe(true);
    if (!adapted.ok) return;
    expect(adapted.value.verified).toBe(true);
    expect(adapted.value.actualAgentId).toBe('agent-claude');
    expect(adapted.value.verificationSource).toBe('trusted_adapter');
  });

  it('an UNVERIFIED production attestation never yields an actual identity', () => {
    const production = {
      attestationId: 'att-prod-2',
      requestedAgentId: 'agent-codex',
      actualAgentId: 'agent-mock-wrapper',
      launchRequested: true,
      launchVerified: false,
      startedAt: CAPSULE_T1,
      externalSessionId: null,
      fallbackReason: 'wrapper responded instead',
    } as unknown as RelayExecutionAttestation;
    const adapted = adaptProductionExecutionAttestation(production, 'cap-codex-review', 'relay-supervisor');
    expect(adapted.ok).toBe(true);
    if (!adapted.ok) return;
    expect(adapted.value.verified).toBe(false);
    expect(adapted.value.actualAgentId).toBeUndefined();
  });
});

describe('requested versus actual identity', () => {
  it('the requested identity is preserved through every state', () => {
    const starting = startingCapsule();
    expect(starting.identity.requested.agentId).toBe('agent-claude');
    expect(identityLaunchRequested(starting.identity)).toBe(true);
    expect(identityLaunchVerified(starting.identity)).toBe(false);
    expect(identityActualAgentId(starting.identity)).toBeUndefined();
  });

  it('a failed launch receives no actual identity and no execution credit', () => {
    const starting = startingCapsule(codexReviewInput());
    const result = attachLaunchAttestation(starting, {
      attestation: failedAttestation('cap-codex-review', CODEX_REQUESTED, 'execution permission denied'),
      at: CAPSULE_T2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.identity.kind).toBe('launch_failed');
    expect(identityActualAgentId(result.value.identity)).toBeUndefined();
    expect(identityObservedAgentId(result.value.identity)).toBeUndefined();
    // …and it can never become running.
    expect(markRunning(result.value, CAPSULE_T2).ok).toBe(false);
  });

  it('a wrapper observed instead of the requested agent gets no external-agent credit', () => {
    const starting = startingCapsule(codexReviewInput());
    const result = attachLaunchAttestation(starting, {
      attestation: observedOtherRuntimeAttestation('cap-codex-review', CODEX_REQUESTED, MOCK_WRAPPER_ACTUAL),
      actualAgent: MOCK_WRAPPER_ACTUAL,
      at: CAPSULE_T2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const identity = result.value.identity;
    expect(identity.kind).toBe('fallback_unauthorized');
    // The wrapper is OBSERVED but never the capsule's actual agent.
    expect(identityActualAgentId(identity)).toBeUndefined();
    expect(identityObservedAgentId(identity)).toBe('agent-mock-wrapper');
    expect(identity.requested.agentId).toBe('agent-codex');

    const credit = evaluateReviewCredit(identity, 'review');
    expect(credit.eligible).toBe(false);
    expect(credit.reason).toMatch(/without authorization/u);

    const running = markRunning(result.value, CAPSULE_T2);
    expect(!running.ok && running.error.code).toBe('UNAUTHORIZED_FALLBACK');
  });

  it('identical requested and actual identities record no fallback', () => {
    const starting = startingCapsule();
    const result = attachLaunchAttestation(starting, {
      attestation: verifiedAttestation('cap-claude-impl', CLAUDE_REQUESTED, CLAUDE_ACTUAL),
      actualAgent: CLAUDE_ACTUAL,
      at: CAPSULE_T2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(identityFallbackOccurred(result.value.identity)).toBe(false);
    expect(identityActualAgentId(result.value.identity)).toBe('agent-claude');
  });

  it('an AUTHORIZED fallback keeps BOTH identities visible and may proceed', () => {
    const starting = startingCapsule();
    const result = attachLaunchAttestation(starting, {
      attestation: verifiedAttestation('cap-claude-impl', CLAUDE_REQUESTED, MANUAL_ACTUAL),
      actualAgent: MANUAL_ACTUAL,
      fallbackAuthorization: {
        authorized: true,
        authorizedBy: 'user-founder',
        reason: 'Claude Code unavailable; founder authorized a manual agent',
      },
      at: CAPSULE_T2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const identity = result.value.identity;
    expect(identity.kind).toBe('verified');
    expect(identity.requested.agentId).toBe('agent-claude');
    expect(identityActualAgentId(identity)).toBe('agent-manual');
    expect(identityFallbackOccurred(identity)).toBe(true);
    expect(identityFallbackAuthorized(identity)).toBe(true);
    expect(markRunning(result.value, CAPSULE_T2).ok).toBe(true);
  });

  it('an UNAUTHORIZED fallback is recorded, visible, and unrunnable', () => {
    const starting = startingCapsule();
    const result = attachLaunchAttestation(starting, {
      attestation: verifiedAttestation('cap-claude-impl', CLAUDE_REQUESTED, MOCK_WRAPPER_ACTUAL),
      actualAgent: MOCK_WRAPPER_ACTUAL,
      fallbackAuthorization: { authorized: false, reason: 'no policy permits this substitution' },
      at: CAPSULE_T2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.identity.kind).toBe('fallback_unauthorized');
    expect(identityFallbackAuthorized(result.value.identity)).toBe(false);
    expect(markRunning(result.value, CAPSULE_T2).ok).toBe(false);
  });

  it('a verified attestation disagreeing with the observed identity is rejected', () => {
    const starting = startingCapsule();
    const result = attachLaunchAttestation(starting, {
      attestation: verifiedAttestation('cap-claude-impl', CLAUDE_REQUESTED, CLAUDE_ACTUAL),
      actualAgent: MANUAL_ACTUAL,
      fallbackAuthorization: { authorized: true, reason: 'mismatch test' },
      at: CAPSULE_T2,
    });
    expect(!result.ok && result.error.code).toBe('INVALID_LAUNCH_ATTESTATION');
  });

  it('a verified attestation with no observed identity supplied is rejected', () => {
    const starting = startingCapsule();
    const result = attachLaunchAttestation(starting, {
      attestation: verifiedAttestation('cap-claude-impl', CLAUDE_REQUESTED, CLAUDE_ACTUAL),
      at: CAPSULE_T2,
    });
    expect(!result.ok && result.error.code).toBe('ACTUAL_AGENT_NOT_VERIFIED');
  });

  it('the same execution identity is detectable across different sessions', () => {
    const newSession = { ...CLAUDE_ACTUAL, externalSessionId: 'session-fixture-claude-2' };
    expect(isSameExecutionParty(CLAUDE_REQUESTED, newSession)).toBe(true);
    expect(isSameExecutionParty(CLAUDE_REQUESTED, CODEX_ACTUAL)).toBe(false);
  });

  it('subject agent ids cover both requested and observed identities', () => {
    const starting = startingCapsule(codexReviewInput());
    const wrapper = attachLaunchAttestation(starting, {
      attestation: observedOtherRuntimeAttestation('cap-codex-review', CODEX_REQUESTED, MOCK_WRAPPER_ACTUAL),
      actualAgent: MOCK_WRAPPER_ACTUAL,
      at: CAPSULE_T2,
    });
    if (!wrapper.ok) throw new Error('setup failed');
    expect(identitySubjectAgentIds(wrapper.value.identity).sort()).toEqual([
      'agent-codex',
      'agent-mock-wrapper',
    ]);
  });
});

describe('review credit eligibility', () => {
  it('an unlaunched requested reviewer receives no credit', () => {
    const prepared = prepareFixture(codexReviewInput());
    expect(evaluateReviewCredit(prepared.identity, 'review').eligible).toBe(false);
    const starting = startingCapsule(codexReviewInput());
    expect(evaluateReviewCredit(starting.identity, 'review').eligible).toBe(false);
  });

  it('a verified reviewer identity is eligible and names who is credited', () => {
    const starting = startingCapsule(codexReviewInput());
    const verified = attachLaunchAttestation(starting, {
      attestation: verifiedAttestation('cap-codex-review', CODEX_REQUESTED, CODEX_ACTUAL),
      actualAgent: CODEX_ACTUAL,
      at: CAPSULE_T2,
    });
    if (!verified.ok) throw new Error('setup failed');
    const credit = evaluateReviewCredit(verified.value.identity, 'review');
    expect(credit.eligible).toBe(true);
    expect(credit.creditedAgentId).toBe('agent-codex');
  });

  it('an authorized fallback credits the agent that ACTUALLY reviewed', () => {
    const starting = startingCapsule(codexReviewInput());
    const verified = attachLaunchAttestation(starting, {
      attestation: verifiedAttestation('cap-codex-review', CODEX_REQUESTED, MANUAL_ACTUAL),
      actualAgent: MANUAL_ACTUAL,
      fallbackAuthorization: { authorized: true, authorizedBy: 'user-founder', reason: 'Codex unavailable' },
      at: CAPSULE_T2,
    });
    if (!verified.ok) throw new Error('setup failed');
    const credit = evaluateReviewCredit(verified.value.identity, 'review');
    expect(credit.eligible).toBe(true);
    expect(credit.creditedAgentId).toBe('agent-manual');
  });

  it('a non-review responsibility is never review credit', () => {
    const starting = startingCapsule();
    const verified = attachLaunchAttestation(starting, {
      attestation: verifiedAttestation('cap-claude-impl', CLAUDE_REQUESTED, CLAUDE_ACTUAL),
      actualAgent: CLAUDE_ACTUAL,
      at: CAPSULE_T2,
    });
    if (!verified.ok) throw new Error('setup failed');
    expect(evaluateReviewCredit(verified.value.identity, 'repair').eligible).toBe(false);
  });
});
