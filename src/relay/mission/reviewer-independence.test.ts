import { describe, expect, it } from 'vitest';

import { assessReviewIndependence, projectMission, type MissionProjectionInput } from './read-models';
import { COMPETITIVE_MISSION_SPEC } from '../shared/competitive-mission';
import type { ReviewInput } from './review-repair';

/**
 * REVIEWER INDEPENDENCE (N-3).
 *
 * `independentReviewComplete` used to mean only "a review was approved and the
 * reviewer was attested". Neither says the reviewer was a DIFFERENT party from
 * the author, so a run in which one agent implemented and then reviewed its
 * own work reported `independentReviewComplete: true` — which is the single
 * thing the field exists to rule out.
 *
 * Independence is now derived from whatever identity evidence the run carries
 * — actual agent, PSP Agent ID, human identity, run identity — and the three
 * outcomes stay distinct. `unknown` is never treated as independence: absence
 * of evidence is not evidence of separation.
 */

const NOW = '2026-07-30T00:00:00.000Z';

const AGENT_A = 'agent-claude-code';
const AGENT_B = 'agent-hermes';

function review(over: Partial<ReviewInput> = {}): ReviewInput {
  return {
    attempt: 1,
    verdict: 'approved',
    reviewerAgentId: AGENT_B,
    requestedReviewerAgentId: AGENT_B,
    independent: true,
    provenance: 'simulated',
    findings: [],
    ...over,
  } as ReviewInput;
}

function projection(over: Partial<MissionProjectionInput> = {}) {
  return projectMission({
    spec: COMPETITIVE_MISSION_SPEC,
    missionId: 'msn_independence',
    projectId: 'prj_independence',
    taskId: 'tsk_independence',
    runId: 'run-implementation',
    now: NOW,
    provenance: 'simulated',
    requestedImplementerId: AGENT_A,
    requestedReviewerId: AGENT_B,
    actualImplementerId: AGENT_A,
    actualReviewerId: AGENT_B,
    implementerAdapterProvenance: 'simulated',
    reviewerAdapterProvenance: 'simulated',
    implementerLaunchVerified: true,
    implementerCompletionSignal: true,
    reviewerLaunchVerified: true,
    implementerSessionId: null,
    workspaceId: null,
    workspaceInspectionCompleted: true,
    verificationCompleted: true,
    runStatus: 'completed',
    reviews: [review()],
    originalClaimedFiles: ['src/access/anonymous-policy.ts'],
    affectedCriterionIds: ['AC-1'],
    workspaceRevision: 'rev-1',
    postRepairEvidenceIds: ['ev-1'],
    allEvidence: [{ evidenceId: 'ev-1', status: 'passed' }],
    requiredEvidenceCount: 1,
    passedEvidenceCount: 1,
    repairDispatched: false,
    implementationReported: true,
    events: [],
    ...over,
  });
}

/* --------------------------------------------------- the pure assessor */

describe('N-3 — assessReviewIndependence', () => {
  it('the SAME actual agent authoring and reviewing is NOT independent', () => {
    const result = assessReviewIndependence({ actualImplementerId: AGENT_A, actualReviewerId: AGENT_A });
    expect(result.independence).toBe('not_independent');
    expect(result.reason).toMatch(/actual agent/u);
    expect(result.reason).toMatch(/cannot independently review work it authored/u);
  });

  it('the SAME PSP Agent ID is not independent, even with different adapter ids', () => {
    const result = assessReviewIndependence({
      actualImplementerId: AGENT_A,
      actualReviewerId: AGENT_B,
      implementerPspId: 'psp-entitlement-1',
      reviewerPspId: 'psp-entitlement-1',
    });
    expect(result.independence).toBe('not_independent');
    expect(result.reason).toMatch(/PSP Agent ID/u);
  });

  it('the SAME human identity is not independent', () => {
    const result = assessReviewIndependence({
      actualImplementerId: AGENT_A,
      actualReviewerId: AGENT_B,
      implementerHumanId: 'human-founder',
      reviewerHumanId: 'human-founder',
    });
    expect(result.independence).toBe('not_independent');
    expect(result.reason).toMatch(/human identity/u);
  });

  it('the SAME run is not independent — one context is not two parties', () => {
    const result = assessReviewIndependence({
      actualImplementerId: AGENT_A,
      actualReviewerId: AGENT_B,
      implementerRunId: 'run-1',
      reviewerRunId: 'run-1',
    });
    expect(result.independence).toBe('not_independent');
    expect(result.reason).toMatch(/run identity/u);
  });

  it('DIFFERENT actual agents are independent', () => {
    const result = assessReviewIndependence({ actualImplementerId: AGENT_A, actualReviewerId: AGENT_B });
    expect(result.independence).toBe('independent');
  });

  it('different agents with different PSP, human and run identities stay independent', () => {
    const result = assessReviewIndependence({
      actualImplementerId: AGENT_A,
      actualReviewerId: AGENT_B,
      implementerPspId: 'psp-1',
      reviewerPspId: 'psp-2',
      implementerHumanId: 'human-a',
      reviewerHumanId: 'human-b',
      implementerRunId: 'run-1',
      reviewerRunId: 'run-2',
    });
    expect(result.independence).toBe('independent');
  });

  it('a MISSING reviewer identity is unknown, never independent', () => {
    for (const actualReviewerId of [null, '', '   ']) {
      const result = assessReviewIndependence({ actualImplementerId: AGENT_A, actualReviewerId });
      expect(result.independence, JSON.stringify(actualReviewerId)).toBe('unknown');
      expect(result.independence).not.toBe('independent');
    }
  });

  it('a MISSING implementer identity is unknown, never independent', () => {
    const result = assessReviewIndependence({ actualImplementerId: '', actualReviewerId: AGENT_B });
    expect(result.independence).toBe('unknown');
  });

  it('a HUMAN review by a different person is independent', () => {
    const result = assessReviewIndependence({
      actualImplementerId: AGENT_A,
      actualReviewerId: 'human-reviewer',
      implementerHumanId: null,
      reviewerHumanId: 'human-reviewer',
    });
    expect(result.independence).toBe('independent');
  });

  it('a HUMAN who both wrote and reviewed is not independent', () => {
    const result = assessReviewIndependence({
      actualImplementerId: 'human-founder',
      actualReviewerId: 'human-founder',
      implementerHumanId: 'human-founder',
      reviewerHumanId: 'human-founder',
    });
    expect(result.independence).toBe('not_independent');
  });
});

/* ------------------------------------------------ through projectMission */

describe('N-3 — projectMission never reports a self-review as independent', () => {
  it('a different reviewer with an approved, attested review IS complete', () => {
    const bundle = projection();
    expect(bundle.executionSummary.reviewIndependence).toBe('independent');
    expect(bundle.executionSummary.independentReviewComplete).toBe(true);
  });

  it('the SAME agent implementing and reviewing is NOT complete', () => {
    const bundle = projection({
      actualReviewerId: AGENT_A,
      reviews: [review({ reviewerAgentId: AGENT_A })],
    });
    expect(bundle.executionSummary.reviewIndependence).toBe('not_independent');
    expect(bundle.executionSummary.independentReviewComplete).toBe(false);
    expect(bundle.executionSummary.reviewIndependenceReason).toMatch(/authored/u);
  });

  it('a shared PSP Agent ID is NOT complete, however the review reads', () => {
    const bundle = projection({ implementerPspId: 'psp-shared', reviewerPspId: 'psp-shared' });
    expect(bundle.executionSummary.reviewIndependence).toBe('not_independent');
    expect(bundle.executionSummary.independentReviewComplete).toBe(false);
  });

  it('a shared RUN is NOT complete', () => {
    const bundle = projection({ reviewerRunId: 'run-implementation' });
    expect(bundle.executionSummary.reviewIndependence).toBe('not_independent');
    expect(bundle.executionSummary.independentReviewComplete).toBe(false);
  });

  it('a missing reviewer identity is UNKNOWN and not complete', () => {
    const bundle = projection({ actualReviewerId: null, reviews: [] });
    expect(bundle.executionSummary.reviewIndependence).toBe('unknown');
    expect(bundle.executionSummary.independentReviewComplete).toBe(false);
  });

  it('MULTI-STAGE repaired work: the re-reviewer must still not be the author', () => {
    // Attempt 1 requires changes, the author repairs, attempt 2 approves —
    // and attempt 2 is performed by the author. That is not a review.
    const bundle = projection({
      actualReviewerId: AGENT_A,
      repairDispatched: true,
      reviews: [
        review({
          attempt: 1,
          verdict: 'changes_requested',
          reviewerAgentId: AGENT_A,
          findings: [
            {
              id: 'F-1',
              severity: 'blocking',
              title: 'Edge-case input is not validated.',
              detail: 'Empty input reaches the core module.',
              recommendation: 'Validate before dispatch.',
            },
          ],
        }),
        review({ attempt: 2, verdict: 'approved', reviewerAgentId: AGENT_A }),
      ],
    });
    expect(bundle.executionSummary.reviewIndependence).toBe('not_independent');
    expect(bundle.executionSummary.independentReviewComplete).toBe(false);
  });

  it('MULTI-STAGE repaired work with a genuinely separate re-reviewer IS complete', () => {
    const bundle = projection({
      repairDispatched: true,
      reviews: [
        review({
          attempt: 1,
          verdict: 'changes_requested',
          findings: [
            {
              id: 'F-1',
              severity: 'blocking',
              title: 'Edge-case input is not validated.',
              detail: 'Empty input reaches the core module.',
              recommendation: 'Validate before dispatch.',
            },
          ],
        }),
        review({ attempt: 2, verdict: 'approved' }),
      ],
    });
    expect(bundle.executionSummary.reviewIndependence).toBe('independent');
    expect(bundle.executionSummary.independentReviewComplete).toBe(true);
  });

  it('the reason is always populated, so a false value is never unexplained', () => {
    for (const bundle of [
      projection(),
      projection({ actualReviewerId: AGENT_A, reviews: [review({ reviewerAgentId: AGENT_A })] }),
      projection({ actualReviewerId: null, reviews: [] }),
    ]) {
      expect(bundle.executionSummary.reviewIndependenceReason.length).toBeGreaterThan(20);
    }
  });
});
