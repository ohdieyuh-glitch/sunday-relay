import { describe, expect, it } from 'vitest';

import { evaluateReviewerIndependence } from './command-independence';
import { createAuthMissionContext } from './command-fixtures';
import type { RelayStateChange } from './command-types';

const ownerChange = (taskId: string, agentId: string): RelayStateChange => ({
  changeId: `chg-${taskId}-${agentId}`,
  entityType: 'task',
  entityId: taskId,
  previousState: 'owner:none',
  requestedState: `owner:${agentId}`,
  reason: 'test ownership change',
});

const draft = (changes: RelayStateChange[], targetAgentIds: string[] = []) => ({
  intent: 'reassign' as const,
  secondaryIntents: [],
  targetTaskIds: changes.map((c) => c.entityId),
  targetAgentIds,
  interpretedChanges: changes,
});

describe('reviewer independence', () => {
  it('the original implementer may NOT take review responsibility (violation)', () => {
    const assessment = evaluateReviewerIndependence(
      draft([ownerChange('task-auth-review', 'agent-claude')]),
      createAuthMissionContext(),
    );
    expect(assessment.violation).toBe(true);
    expect(assessment.reasons.join(' ')).toMatch(/never independently review/u);
  });

  it('a NEW SESSION of the same execution identity is still not independent', () => {
    const assessment = evaluateReviewerIndependence(
      draft([ownerChange('task-auth-review', 'agent-claude-s2')]),
      createAuthMissionContext(),
    );
    expect(assessment.violation).toBe(true);
  });

  it('a structurally independent agent MAY take review responsibility', () => {
    const assessment = evaluateReviewerIndependence(
      draft([ownerChange('task-auth-review', 'agent-hermes')]),
      createAuthMissionContext(),
    );
    expect(assessment.violation).toBe(false);
  });

  it('the original implementer MAY repair — with the re-review requirement retained', () => {
    const assessment = evaluateReviewerIndependence(
      draft([ownerChange('task-auth-repair', 'agent-claude')]),
      createAuthMissionContext(),
    );
    expect(assessment.violation).toBe(false);
    expect(assessment.riskDetected).toBe(true);
    expect(assessment.reReviewRequired).toBe(true);
    expect(assessment.reasons.join(' ')).toMatch(/INDEPENDENT re-review/u);
  });

  it('interrupting an active review preserves its confirmed partial findings', () => {
    const assessment = evaluateReviewerIndependence(
      draft([
        {
          changeId: 'chg-review',
          entityType: 'review',
          entityId: 'review-auth-r1',
          previousState: 'in_progress',
          requestedState: 'incomplete',
          reason: 'review interrupted',
        },
      ]),
      createAuthMissionContext(),
    );
    expect(assessment.invalidatedReviewIds).toEqual(['review-auth-r1']);
    expect(assessment.preservedFindingIds).toEqual(['finding-auth-1']);
    expect(assessment.reReviewRequired).toBe(true);
  });

  it('approval backed only by a NON-independent completed review is a violation', () => {
    const context = createAuthMissionContext();
    context.reviews = [
      {
        reviewId: 'review-self',
        taskId: 'task-auth-impl',
        reviewerAgentId: 'agent-claude',
        artifactRevision: 'art-2',
        status: 'completed',
        findingIds: [],
        independent: false,
      },
    ];
    const assessment = evaluateReviewerIndependence(
      {
        intent: 'approve',
        secondaryIntents: [],
        targetTaskIds: ['task-auth-impl'],
        targetAgentIds: [],
        interpretedChanges: [
          {
            changeId: 'chg-approve',
            entityType: 'task',
            entityId: 'task-auth-impl',
            previousState: 'reviewing',
            requestedState: 'approved',
            reason: 'approve',
            statusDimension: 'verification',
          },
        ],
      },
      context,
    );
    expect(assessment.violation).toBe(true);
    expect(assessment.reasons.join(' ')).toMatch(/structurally independent/u);
  });
});
