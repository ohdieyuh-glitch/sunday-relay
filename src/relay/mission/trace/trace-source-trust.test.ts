import { describe, expect, it } from 'vitest';

import {
  AUTHORIZED_ATTESTATION_SERVICES,
  AUTHORIZED_VERIFICATION_SERVICES,
  defaultTrustForActor,
  isSupervisoryTrust,
  validateSourceTrust,
} from './trace-source-trust';
import { appendTraceEvent } from './trace-ledger';
import {
  agentClaimDraft,
  capsuleDraft,
  newTraceFixture,
  FIXTURE_TRACE_ID,
  TRACE_T1,
  TRACE_T2,
} from './trace-fixtures';

describe('source-trust defaults', () => {
  it.each([
    ['agent', 'claim'],
    ['reviewer', 'claim'],
    ['relay', 'observed'],
    ['system', 'observed'],
    ['user', 'observed'],
    ['adapter', 'observed'],
  ] as const)('%s defaults to %s', (actorType, expected) => {
    expect(defaultTrustForActor(actorType)).toBe(expected);
  });

  it('distinguishes supervisory trust from self-reports', () => {
    expect(isSupervisoryTrust('attested')).toBe(true);
    expect(isSupervisoryTrust('verified')).toBe(true);
    expect(isSupervisoryTrust('observed')).toBe(false);
    expect(isSupervisoryTrust('claim')).toBe(false);
  });
});

describe('nobody grades their own homework', () => {
  it.each(['attested', 'observed', 'verified'] as const)(
    'an agent cannot mark its own event %s',
    (requestedTrust) => {
      const result = validateSourceTrust({
        actorId: 'agent-claude',
        actorType: 'agent',
        sourceService: 'relay-capsule-service',
        requestedTrust,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('AGENT_SELF_ATTESTATION_FORBIDDEN');
      expect(result.error.expected).toBe('claim');
    },
  );

  it('an agent CAN record a claim about itself', () => {
    const result = validateSourceTrust({
      actorId: 'agent-claude',
      actorType: 'agent',
      sourceService: 'relay-capsule-service',
      requestedTrust: 'claim',
    });
    expect(result.ok).toBe(true);
  });

  it('an actor that is the SUBJECT of the event cannot attest, whatever its type', () => {
    const result = validateSourceTrust({
      actorId: 'agent-codex',
      actorType: 'adapter',
      sourceService: 'relay-supervisor',
      requestedTrust: 'attested',
      subjectAgentIds: ['agent-codex'],
    });
    expect(!result.ok && result.error.code).toBe('AGENT_SELF_ATTESTATION_FORBIDDEN');
  });

  it('a supervisor CAN attest about an agent it observed', () => {
    const result = validateSourceTrust({
      actorId: 'relay-supervisor',
      actorType: 'relay',
      sourceService: 'relay-supervisor',
      requestedTrust: 'attested',
      subjectAgentIds: ['agent-codex'],
    });
    expect(result.ok).toBe(true);
  });
});

describe('service authorization', () => {
  it('only an authorized verification service may mark an event verified', () => {
    for (const sourceService of AUTHORIZED_VERIFICATION_SERVICES) {
      expect(
        validateSourceTrust({
          actorId: sourceService,
          actorType: 'system',
          sourceService,
          requestedTrust: 'verified',
        }).ok,
      ).toBe(true);
    }

    const impostor = validateSourceTrust({
      actorId: 'relay-capsule-service',
      actorType: 'system',
      sourceService: 'relay-capsule-service',
      requestedTrust: 'verified',
    });
    expect(!impostor.ok && impostor.error.code).toBe('INVALID_SOURCE_TRUST');
  });

  it('only a trusted supervisory source may attest', () => {
    for (const sourceService of AUTHORIZED_ATTESTATION_SERVICES) {
      expect(
        validateSourceTrust({
          actorId: sourceService,
          actorType: 'relay',
          sourceService,
          requestedTrust: 'attested',
        }).ok,
      ).toBe(true);
    }

    const impostor = validateSourceTrust({
      actorId: 'some-service',
      actorType: 'system',
      sourceService: 'some-service',
      requestedTrust: 'attested',
    });
    expect(!impostor.ok && impostor.error.code).toBe('INVALID_SOURCE_TRUST');
    expect(!impostor.ok && impostor.error.field).toBe('sourceService');
  });

  it('a wrapper cannot claim an unavailable external agent identity', () => {
    // The wrapper tries to attest that it is Codex.
    const result = validateSourceTrust({
      actorId: 'agent-mock-wrapper',
      actorType: 'agent',
      sourceService: 'relay-supervisor',
      requestedTrust: 'attested',
      subjectAgentIds: ['agent-codex', 'agent-mock-wrapper'],
    });
    expect(!result.ok && result.error.code).toBe('AGENT_SELF_ATTESTATION_FORBIDDEN');
  });
});

describe('source trust through the ledger', () => {
  it("an agent's final report is stored as a claim", () => {
    const { repository } = newTraceFixture();
    const appended = appendTraceEvent(repository, {
      traceId: FIXTURE_TRACE_ID,
      draft: agentClaimDraft('evt-report', 'agent_final_report_received', TRACE_T1),
    });
    expect(appended.ok).toBe(true);
    if (!appended.ok) return;
    expect(appended.value.sourceTrust).toBe('claim');
    expect(appended.value.actorType).toBe('agent');
  });

  it("an agent's completion claim stays a claim", () => {
    const { repository } = newTraceFixture();
    const appended = appendTraceEvent(repository, {
      traceId: FIXTURE_TRACE_ID,
      draft: agentClaimDraft('evt-claim', 'agent_completion_claim_received', TRACE_T1),
    });
    expect(appended.ok).toBe(true);
    if (!appended.ok) return;
    expect(appended.value.sourceTrust).toBe('claim');
  });

  it("an agent's test claim stays a claim, with no monitored evidence implied", () => {
    const { repository } = newTraceFixture();
    const appended = appendTraceEvent(repository, {
      traceId: FIXTURE_TRACE_ID,
      draft: agentClaimDraft('evt-test', 'test_reference_linked', TRACE_T1, 'agent-claude', {
        eventFamily: 'test',
        metadata: { testsClaimed: 12, monitored: false },
      }),
    });
    expect(appended.ok).toBe(true);
    if (!appended.ok) return;
    expect(appended.value.sourceTrust).toBe('claim');
  });

  it('an agent attempting to self-attest through the ledger is rejected', () => {
    const { repository } = newTraceFixture();
    const result = appendTraceEvent(repository, {
      traceId: FIXTURE_TRACE_ID,
      subjectAgentIds: ['agent-claude'],
      draft: capsuleDraft('evt-self', 'agent_launch_verified', TRACE_T1, {
        actorId: 'agent-claude',
        actorType: 'agent',
        sourceTrust: 'attested',
      }),
    });
    expect(!result.ok && result.error.code).toBe('AGENT_SELF_ATTESTATION_FORBIDDEN');
    expect(repository.eventCount(FIXTURE_TRACE_ID)).toBe(1);
  });

  it('a supervisor attestation about that agent is accepted', () => {
    const { repository } = newTraceFixture();
    const result = appendTraceEvent(repository, {
      traceId: FIXTURE_TRACE_ID,
      subjectAgentIds: ['agent-claude'],
      draft: capsuleDraft('evt-attested', 'agent_launch_verified', TRACE_T2, {
        actorId: 'relay-supervisor',
        actorType: 'relay',
        sourceService: 'relay-supervisor',
        sourceTrust: 'attested',
        metadata: { requestedAgentId: 'agent-claude', actualAgentId: 'agent-claude' },
      }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sourceTrust).toBe('attested');
  });
});
