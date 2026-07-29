import { describe, expect, it } from 'vitest';

import { calculateCheckpointRequirements } from './command-checkpoint';
import { createAuthMissionContext } from './command-fixtures';

const draft = (
  intent: 'pause' | 'cancel' | 'resume' | 'approve' | 'reassign',
  targetTaskIds: string[],
  secondaryIntents: Array<'cancel' | 'pause'> = [],
) => ({ intent, secondaryIntents, targetTaskIds });

describe('checkpoint-before-intervention', () => {
  it('an active task with NO partial work needs no checkpoint', () => {
    const context = createAuthMissionContext();
    const run = context.agentRuns.find((r) => r.runId === 'run-hermes-backend');
    if (run) {
      run.partialWork = {
        changedFiles: [], commandsRun: 0, testsRun: 0, knownErrors: [],
        findingIds: [], unresolvedQuestions: [], costConsumedUsd: 0,
      };
    }
    const [requirement] = calculateCheckpointRequirements(draft('pause', ['task-backend']), context);
    expect(requirement.required).toBe(false);
    expect(requirement.status).toBe('not_required');
    expect(requirement.requiredCapture).toEqual([]);
  });

  it('partial work produces a required checkpoint with every applicable capture', () => {
    const context = createAuthMissionContext();
    const [requirement] = calculateCheckpointRequirements(
      draft('reassign', ['task-auth-review'], ['cancel']),
      context,
    );
    expect(requirement.required).toBe(true);
    expect(requirement.status).toBe('required');
    expect(requirement.taskId).toBe('task-auth-review');
    expect(requirement.runId).toBe('run-codex-review');
    expect(requirement.requiredCapture).toEqual([
      'commands', 'tests', 'findings', 'processes', 'workspace_state', 'cost', 'unresolved_questions',
    ]);
    expect(requirement.reasons.length).toBeGreaterThanOrEqual(6);
  });

  it('changed files require partial_output + changed_files capture', () => {
    const context = createAuthMissionContext();
    const [requirement] = calculateCheckpointRequirements(draft('cancel', ['task-backend']), context);
    expect(requirement.requiredCapture).toContain('partial_output');
    expect(requirement.requiredCapture).toContain('changed_files');
  });

  it('an already-satisfied run checkpoint reports satisfied', () => {
    const context = createAuthMissionContext();
    const run = context.agentRuns.find((r) => r.runId === 'run-codex-review');
    if (run) run.checkpointStatus = 'satisfied';
    const [requirement] = calculateCheckpointRequirements(draft('cancel', ['task-auth-review']), context);
    expect(requirement.status).toBe('satisfied');
  });

  it('a failed run checkpoint reports failed', () => {
    const context = createAuthMissionContext();
    const run = context.agentRuns.find((r) => r.runId === 'run-codex-review');
    if (run) run.checkpointStatus = 'failed';
    const [requirement] = calculateCheckpointRequirements(draft('cancel', ['task-auth-review']), context);
    expect(requirement.status).toBe('failed');
  });

  it('non-intervention intents produce no checkpoint requirements', () => {
    const context = createAuthMissionContext();
    expect(calculateCheckpointRequirements(draft('resume', ['task-frontend']), context)).toEqual([]);
    expect(calculateCheckpointRequirements(draft('approve', ['task-auth-impl']), context)).toEqual([]);
  });

  it('tasks without an active run are skipped', () => {
    const context = createAuthMissionContext();
    expect(calculateCheckpointRequirements(draft('pause', ['task-frontend']), context)).toEqual([]);
  });
});
