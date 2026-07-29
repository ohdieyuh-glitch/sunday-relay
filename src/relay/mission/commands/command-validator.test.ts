import { describe, expect, it } from 'vitest';

import { DeterministicCommandInterpreter } from './deterministic-command-interpreter';
import { createAuthMissionContext, naturalRequest, FIXTURE_TIME } from './command-fixtures';
import { validateMissionCommand } from './command-validator';
import type { RelayMissionCommandDraft, RelayStateChange } from './command-types';

const interpreter = new DeterministicCommandInterpreter();

function draftOf(text: string, context = createAuthMissionContext()): RelayMissionCommandDraft {
  const result = interpreter.interpret(naturalRequest(`req-${text.replace(/\W+/gu, '-')}`, text), context);
  if (result.kind !== 'interpreted') throw new Error(`expected interpreted, got ${result.kind}`);
  return result.commandDraft;
}

function manualDraft(over: Partial<RelayMissionCommandDraft>): RelayMissionCommandDraft {
  return {
    projectId: 'project-sunday',
    missionId: 'mission-auth',
    issuedByUserId: 'user-founder',
    issuedAt: FIXTURE_TIME,
    naturalLanguageRequest: 'manual draft',
    intent: 'pause',
    secondaryIntents: [],
    targetTaskIds: [],
    targetAgentIds: [],
    interpretedChanges: [],
    missionRevision: 3,
    taskRevisions: {},
    ...over,
  };
}

const change = (over: Partial<RelayStateChange>): RelayStateChange => ({
  changeId: 'chg-manual-1',
  entityType: 'task',
  entityId: 'task-backend',
  previousState: 'running',
  requestedState: 'waiting',
  reason: 'manual test change',
  statusDimension: 'execution',
  ...over,
});

describe('validation pipeline — existence and staleness gates', () => {
  it('rejects a command for a mission that is not in context (MISSION_NOT_FOUND)', () => {
    const result = validateMissionCommand({
      commandId: 'cmd-1',
      draft: manualDraft({ missionId: 'mission-ghost' }),
      context: createAuthMissionContext(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0].code).toBe('MISSION_NOT_FOUND');
    expect(result.rejectedCommand.status).toBe('rejected');
    expect(result.rejectedCommand.rejectionReason).toContain('MISSION_NOT_FOUND');
  });

  it('rejects a stale mission revision before anything else (STALE_MISSION_REVISION)', () => {
    const result = validateMissionCommand({
      commandId: 'cmd-2',
      draft: manualDraft({ missionRevision: 2 }),
      context: createAuthMissionContext(),
    });
    expect(!result.ok && result.errors[0].code).toBe('STALE_MISSION_REVISION');
    if (result.ok) return;
    expect(result.errors[0].expected).toBe('3');
    expect(result.errors[0].actual).toBe('2');
  });

  it('rejects a missing target task (TASK_NOT_FOUND)', () => {
    const result = validateMissionCommand({
      commandId: 'cmd-3',
      draft: manualDraft({ targetTaskIds: ['task-ghost'] }),
      context: createAuthMissionContext(),
    });
    expect(!result.ok && result.errors[0].code).toBe('TASK_NOT_FOUND');
  });

  it('rejects a stale task revision (STALE_TASK_REVISION)', () => {
    const result = validateMissionCommand({
      commandId: 'cmd-4',
      draft: manualDraft({
        targetTaskIds: ['task-backend'],
        taskRevisions: { 'task-backend': 99 },
        interpretedChanges: [change({})],
      }),
      context: createAuthMissionContext(),
    });
    expect(!result.ok && result.errors[0].code).toBe('STALE_TASK_REVISION');
  });

  it('rejects a missing agent (AGENT_NOT_FOUND)', () => {
    const result = validateMissionCommand({
      commandId: 'cmd-5',
      draft: manualDraft({
        intent: 'reassign',
        targetTaskIds: ['task-auth-repair'],
        taskRevisions: { 'task-auth-repair': 1 },
        interpretedChanges: [
          change({
            entityId: 'task-auth-repair',
            previousState: 'owner:none',
            requestedState: 'owner:agent-ghost',
            statusDimension: undefined,
          }),
        ],
      }),
      context: createAuthMissionContext(),
    });
    expect(!result.ok && result.errors[0].code).toBe('AGENT_NOT_FOUND');
  });
});

describe('validation pipeline — state compatibility and Milestone 1 integration', () => {
  it('rejects when the interpreted previous state no longer matches the entity', () => {
    const result = validateMissionCommand({
      commandId: 'cmd-6',
      draft: manualDraft({
        targetTaskIds: ['task-frontend'],
        taskRevisions: { 'task-frontend': 1 },
        interpretedChanges: [
          change({ entityId: 'task-frontend', previousState: 'running', requestedState: 'waiting' }),
        ],
      }),
      context: createAuthMissionContext(),
    });
    expect(!result.ok && result.errors[0].code).toBe('INVALID_STATE_TRANSITION');
    if (result.ok) return;
    expect(result.errors[0].expected).toBe('running');
    expect(result.errors[0].actual).toBe('waiting');
  });

  it('rejects an unknown status value for a dimension', () => {
    const result = validateMissionCommand({
      commandId: 'cmd-7',
      draft: manualDraft({
        targetTaskIds: ['task-backend'],
        taskRevisions: { 'task-backend': 1 },
        interpretedChanges: [change({ previousState: 'running', requestedState: 'hibernating' })],
      }),
      context: createAuthMissionContext(),
    });
    expect(!result.ok && result.errors.some((e) => e.code === 'INVALID_STATE_TRANSITION')).toBe(true);
  });

  it('accepts a valid Milestone 1 transition (pause: running → waiting)', () => {
    const context = createAuthMissionContext();
    const result = validateMissionCommand({
      commandId: 'cmd-8',
      draft: draftOf('Pause the backend task.', context),
      context,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.validatedCommand.status).toBe('validated');
    expect(result.validatedCommand.risk).toBe('medium');
  });

  it('rejects a Milestone 1 terminal-state violation through the real engine (completed → running)', () => {
    const context = createAuthMissionContext();
    const backend = context.tasks.find((t) => t.taskId === 'task-backend');
    if (backend) {
      backend.status = { ...backend.status, executionStatus: 'completed' };
    }
    context.agentRuns = context.agentRuns.filter((r) => r.taskId !== 'task-backend');
    const result = validateMissionCommand({
      commandId: 'cmd-9',
      draft: draftOf('Resume the backend task.', context),
      context,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0].code).toBe('INVALID_STATE_TRANSITION');
    expect(result.errors[0].reason).toMatch(/atomically/u);
  });

  it('rejects resuming a task whose prerequisites are not completed (DEPENDENCY_BLOCKED)', () => {
    const context = createAuthMissionContext();
    const result = validateMissionCommand({
      commandId: 'cmd-10',
      draft: draftOf('Resume the frontend task.', context),
      context,
    });
    expect(!result.ok && result.errors[0].code).toBe('DEPENDENCY_BLOCKED');
    if (result.ok) return;
    expect(result.errors[0].actual).toContain('task-api');
  });
});

describe('validation pipeline — purity and inspectability', () => {
  it('never mutates the context or the draft', () => {
    const context = createAuthMissionContext();
    const draft = draftOf('Stop Codex and have Claude repair the authentication problem.', context);
    const contextSnapshot = JSON.stringify(context);
    const draftSnapshot = JSON.stringify(draft);
    validateMissionCommand({ commandId: 'cmd-11', draft, context });
    expect(JSON.stringify(context)).toBe(contextSnapshot);
    expect(JSON.stringify(draft)).toBe(draftSnapshot);
  });

  it('a rejected command carries every structured error field', () => {
    const result = validateMissionCommand({
      commandId: 'cmd-12',
      draft: manualDraft({ missionRevision: 1 }),
      context: createAuthMissionContext(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const error = result.errors[0];
    expect(error.code).toBeTruthy();
    expect(error.reason).toBeTruthy();
    expect(error.safeNextAction).toBeTruthy();
    expect(typeof error.humanActionRequired).toBe('boolean');
    expect(error.commandId).toBe('cmd-12');
  });

  it('identifies current ownership, partial work, and child processes for interventions', () => {
    const context = createAuthMissionContext();
    const result = validateMissionCommand({
      commandId: 'cmd-13',
      draft: draftOf('Stop Codex and have Claude repair the authentication problem.', context),
      context,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.analyses.currentOwnership['task-auth-review']).toBe('agent-codex');
    expect(result.analyses.riskInput.partialWorkPresent).toBe(true);
    expect(result.analyses.childProcessesPresent).toBe(true);
  });
});
