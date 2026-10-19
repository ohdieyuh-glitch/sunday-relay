import { describe, expect, it } from 'vitest';

import { analyzeDependencyImpact, findUnmetPrerequisites } from './command-dependencies';
import { createAuthMissionContext } from './command-fixtures';

describe('dependency protection', () => {
  it('pausing a prerequisite identifies its DIRECT blocked dependents', () => {
    const impact = analyzeDependencyImpact(
      { intent: 'pause', secondaryIntents: [], targetTaskIds: ['task-backend'] },
      createAuthMissionContext(),
    );
    expect(impact.blockedDependents).toEqual(['task-api']);
    expect(impact.affectedDependencyIds).toEqual(['task-api']);
    expect(impact.highImpact).toBe(false);
    expect(impact.reasons[0]).toContain('blocks dependent');
  });

  it('cancelling a prerequisite identifies TRANSITIVE invalidated dependents', () => {
    const impact = analyzeDependencyImpact(
      { intent: 'cancel', secondaryIntents: [], targetTaskIds: ['task-backend'] },
      createAuthMissionContext(),
    );
    expect(impact.invalidatedDependents.sort()).toEqual(['task-api', 'task-frontend']);
    expect(impact.highImpact).toBe(true);
  });

  it('redirect identifies the consumers of the previous output', () => {
    const impact = analyzeDependencyImpact(
      { intent: 'redirect', secondaryIntents: [], targetTaskIds: ['task-backend'] },
      createAuthMissionContext(),
    );
    expect(impact.consumersOfRedirectedOutput).toEqual(['task-api']);
  });

  it('reassignment preserves dependency relationships without damaging them', () => {
    const impact = analyzeDependencyImpact(
      { intent: 'reassign', secondaryIntents: [], targetTaskIds: ['task-backend'] },
      createAuthMissionContext(),
    );
    expect(impact.blockedDependents).toEqual([]);
    expect(impact.invalidatedDependents).toEqual([]);
    expect(impact.highImpact).toBe(false);
    expect(impact.reasons.some((r) => r.includes('preserves its dependency'))).toBe(true);
  });

  it('a compound cancel inside a reassign still reports invalidation', () => {
    const impact = analyzeDependencyImpact(
      { intent: 'reassign', secondaryIntents: ['cancel'], targetTaskIds: ['task-auth-review'] },
      createAuthMissionContext(),
    );
    expect(impact.invalidatedDependents).toEqual(['task-auth-repair']);
  });

  it('findUnmetPrerequisites reports incomplete prerequisite tasks', () => {
    const context = createAuthMissionContext();
    expect(findUnmetPrerequisites(context, 'task-frontend')).toEqual(['task-api']);
    expect(findUnmetPrerequisites(context, 'task-backend')).toEqual([]);
    const api = context.tasks.find((t) => t.taskId === 'task-api');
    if (api) api.status = { ...api.status, executionStatus: 'completed' };
    expect(findUnmetPrerequisites(context, 'task-frontend')).toEqual([]);
  });
});
