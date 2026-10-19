import { describe, expect, it } from 'vitest';

import { DeterministicCommandInterpreter } from './deterministic-command-interpreter';
import { createAuthMissionContext, createStaleReviewContext, naturalRequest } from './command-fixtures';
import {
  RELAY_MISSION_COMMAND_INTENTS,
  RELAY_MISSION_COMMAND_STATUSES,
  RELAY_MISSION_COMMAND_RISKS,
  RELAY_STATE_CHANGE_ENTITY_TYPES,
} from './command-types';
import type { RelayMissionCommandDraft } from './command-types';

const interpreter = new DeterministicCommandInterpreter();

function interpret(text: string, context = createAuthMissionContext()) {
  return interpreter.interpret(naturalRequest(`req-${text.replace(/\W+/gu, '-')}`, text), context);
}

function draftOf(text: string, context = createAuthMissionContext()): RelayMissionCommandDraft {
  const result = interpret(text, context);
  if (result.kind !== 'interpreted') {
    throw new Error(`expected interpreted, got ${result.kind}: ${JSON.stringify(result)}`);
  }
  return result.commandDraft;
}

describe('canonical vocabularies', () => {
  it('exposes exactly the canonical intents', () => {
    expect(RELAY_MISSION_COMMAND_INTENTS).toEqual([
      'start', 'pause', 'resume', 'cancel', 'redirect', 'reassign', 'approve',
      'reject', 'retry', 'escalate', 'change_priority', 'change_budget', 'change_permissions',
    ]);
  });

  it('exposes exactly the canonical command statuses (distinct from the four-status model)', () => {
    expect(RELAY_MISSION_COMMAND_STATUSES).toEqual([
      'received', 'interpreted', 'validation_required', 'validated', 'rejected',
      'executing', 'executed', 'failed',
    ]);
  });

  it('exposes the four risk levels and seven entity types', () => {
    expect(RELAY_MISSION_COMMAND_RISKS).toEqual(['low', 'medium', 'high', 'critical']);
    expect(RELAY_STATE_CHANGE_ENTITY_TYPES).toEqual([
      'mission', 'task', 'agent_run', 'workspace', 'review', 'permission', 'budget',
    ]);
  });
});

describe('deterministic interpretation', () => {
  it('pause the backend task → execution running → waiting with revisions captured', () => {
    const draft = draftOf('Pause the backend task.');
    expect(draft.intent).toBe('pause');
    expect(draft.secondaryIntents).toEqual([]);
    expect(draft.targetTaskIds).toEqual(['task-backend']);
    expect(draft.interpretedChanges).toHaveLength(1);
    expect(draft.interpretedChanges[0]).toMatchObject({
      entityType: 'task',
      entityId: 'task-backend',
      previousState: 'running',
      requestedState: 'waiting',
      statusDimension: 'execution',
      expectedRevision: 1,
    });
    expect(draft.missionRevision).toBe(3);
    expect(draft.taskRevisions).toEqual({ 'task-backend': 1 });
    const raw = interpret('Pause the backend task.');
    expect(raw.kind === 'interpreted' && raw.confidence).toBe('deterministic');
  });

  it('resume the frontend task → waiting → running', () => {
    const draft = draftOf('Resume the frontend task.');
    expect(draft.intent).toBe('resume');
    expect(draft.interpretedChanges[0]).toMatchObject({
      entityId: 'task-frontend',
      previousState: 'waiting',
      requestedState: 'running',
      statusDimension: 'execution',
    });
  });

  it('cancel the backend task → run + task cancellation changes', () => {
    const draft = draftOf('Cancel the backend task.');
    expect(draft.intent).toBe('cancel');
    expect(draft.interpretedChanges.map((c) => [c.entityType, c.requestedState])).toEqual([
      ['agent_run', 'cancelled'],
      ['task', 'cancelled'],
    ]);
  });

  it('stop codex → cancel of the active review run, preserving the review as incomplete', () => {
    const draft = draftOf('Stop Codex.');
    expect(draft.intent).toBe('cancel');
    expect(draft.targetAgentIds).toEqual(['agent-codex']);
    expect(draft.interpretedChanges.map((c) => [c.entityType, c.entityId, c.requestedState])).toEqual([
      ['agent_run', 'run-codex-review', 'cancelled'],
      ['task', 'task-auth-review', 'cancelled'],
      ['review', 'review-auth-r1', 'incomplete'],
    ]);
  });

  it('the compound stop-and-repair keeps one primary intent plus an explicit secondary', () => {
    const draft = draftOf('Stop Codex and have Claude repair the authentication problem.');
    expect(draft.intent).toBe('reassign');
    expect(draft.secondaryIntents).toEqual(['cancel']);
    expect(draft.targetTaskIds).toEqual(['task-auth-review', 'task-auth-repair']);
    expect(draft.targetAgentIds).toEqual(['agent-codex', 'agent-claude']);
    const kinds = draft.interpretedChanges.map((c) => `${c.entityType}:${c.requestedState}`);
    expect(kinds).toEqual([
      'agent_run:cancelled',
      'task:cancelled',
      'review:incomplete',
      'task:owner:agent-claude',
    ]);
    // The interpreter NEVER emits verification or release decisions here.
    expect(draft.interpretedChanges.some((c) => c.statusDimension === 'verification')).toBe(false);
    expect(draft.interpretedChanges.some((c) => c.statusDimension === 'release')).toBe(false);
  });

  it.each([
    ['Approve the repair.', 'approve'],
    ['Reject this implementation.', 'reject'],
    ['Allow production writes.', 'change_permissions'],
    ['Continue, but prohibit production changes.', 'change_permissions'],
    ['Increase the repair budget to $20.', 'change_budget'],
    ['Escalate this finding to the project leader.', 'escalate'],
    ['Move the frontend task to Hermes.', 'reassign'],
    ['Redirect the output of task-backend to task-frontend.', 'redirect'],
    ['Set task-frontend priority to 1.', 'change_priority'],
    ['Start the mission.', 'start'],
  ] as const)('"%s" → intent %s', (text, intent) => {
    const context =
      intent === 'approve' ? createStaleReviewContext() : createAuthMissionContext();
    expect(draftOf(text, context).intent).toBe(intent);
  });

  it('retry targets a failed run', () => {
    const context = createAuthMissionContext();
    context.agentRuns.push({
      runId: 'run-frontend-failed',
      taskId: 'task-frontend',
      requestedAgentId: 'agent-hermes',
      actualAgentId: 'agent-hermes',
      state: 'failed',
      partialWork: {
        changedFiles: [], commandsRun: 0, testsRun: 0, knownErrors: ['boot failure'],
        findingIds: [], unresolvedQuestions: [], costConsumedUsd: 0,
      },
      childProcessRefs: [],
      checkpointStatus: 'none',
    });
    const draft = draftOf('Retry the frontend task.', context);
    expect(draft.intent).toBe('retry');
    expect(draft.interpretedChanges[0]).toMatchObject({
      entityType: 'agent_run',
      entityId: 'run-frontend-failed',
      previousState: 'failed',
      requestedState: 'retry_requested',
    });
  });
});

describe('ambiguity and rejection — the interpreter never guesses', () => {
  it('"Stop it and give it to the other one." requires clarification with the missing targets', () => {
    const result = interpret('Stop it and give it to the other one.');
    expect(result.kind).toBe('clarification_required');
    if (result.kind !== 'clarification_required') return;
    expect(result.missingInformation).toEqual(['target task', 'current agent', 'replacement agent']);
  });

  it('"Move the frontend task to another agent." asks for the replacement agent', () => {
    const result = interpret('Move the frontend task to another agent.');
    expect(result.kind).toBe('clarification_required');
    if (result.kind !== 'clarification_required') return;
    expect(result.missingInformation).toContain('replacement agent');
  });

  it('a budget increase without an amount requires clarification', () => {
    const result = interpret('Increase the repair budget.');
    expect(result.kind).toBe('clarification_required');
  });

  it('an unknown task name requires clarification, never a guess', () => {
    const result = interpret('Pause the quantum task.');
    expect(result.kind).toBe('clarification_required');
  });

  it('stopping an agent with no active run requires clarification', () => {
    const result = interpret('Stop Claude and have Hermes repair the authentication problem.');
    expect(result.kind).toBe('clarification_required');
    if (result.kind !== 'clarification_required') return;
    expect(result.reason).toMatch(/no active run/u);
  });

  it('unrecognized language is rejected outright', () => {
    const result = interpret('Please synergize the roadmap holistically.');
    expect(result.kind).toBe('rejected');
    if (result.kind !== 'rejected') return;
    expect(result.reason).toMatch(/deterministic/iu);
  });

  it('never mutates the context it interprets against', () => {
    const context = createAuthMissionContext();
    const snapshot = JSON.stringify(context);
    interpret('Stop Codex and have Claude repair the authentication problem.');
    interpreter.interpret(naturalRequest('req-mut', 'Pause the backend task.'), context);
    expect(JSON.stringify(context)).toBe(snapshot);
  });
});
