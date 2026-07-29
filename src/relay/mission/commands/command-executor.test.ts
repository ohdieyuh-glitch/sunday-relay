import { describe, expect, it } from 'vitest';

import {
  executeMissionCommand,
  resolveCommandPrerequisite,
  submitMissionCommand,
} from './command-executor';
import { DeterministicCommandInterpreter } from './deterministic-command-interpreter';
import { createAuthMissionContext, naturalRequest, FIXTURE_TIME } from './command-fixtures';
import {
  InMemoryMissionCommandRepository,
  InMemoryMissionContextStore,
} from './command-repository';
import type { RelayMissionCommand } from './command-types';
import type { RelayMissionCommandContext } from './command-context';

const interpreter = new DeterministicCommandInterpreter();

/** Context where task-api is a valid low-risk resume target. */
function resumableContext(): RelayMissionCommandContext {
  const context = createAuthMissionContext();
  const backend = context.tasks.find((t) => t.taskId === 'task-backend');
  if (backend) backend.status = { ...backend.status, executionStatus: 'completed' };
  context.agentRuns = context.agentRuns.filter((r) => r.taskId !== 'task-backend');
  return context;
}

function submit(
  text: string,
  context: RelayMissionCommandContext,
  repository: InMemoryMissionCommandRepository,
  commandId: string,
) {
  return submitMissionCommand({
    request: naturalRequest(commandId, text),
    interpreter,
    context,
    repository,
    commandId,
  });
}

describe('submission lifecycle events', () => {
  it('a validated command emits received → interpreted → validation_required → validated in order', () => {
    const repository = new InMemoryMissionCommandRepository();
    const context = resumableContext();
    const result = submit('Resume the api task.', context, repository, 'cmd-resume');
    expect(result.kind).toBe('validated');
    expect(repository.listEvents('cmd-resume').map((e) => e.eventType)).toEqual([
      'command_received', 'command_interpreted', 'command_validation_required', 'command_validated',
    ]);
    expect(repository.listEvents('cmd-resume').map((e) => e.sequence)).toEqual([0, 1, 2, 3]);
  });

  it('a rejected command is stored, inspectable, and ends with command_rejected', () => {
    const repository = new InMemoryMissionCommandRepository();
    const context = createAuthMissionContext();
    const result = submit('Move the review task to Claude.', context, repository, 'cmd-independence');
    expect(result.kind).toBe('rejected');
    if (result.kind !== 'rejected') return;
    expect(result.errors.some((e) => e.code === 'REVIEWER_INDEPENDENCE_VIOLATION')).toBe(true);
    expect(repository.getCommand('cmd-independence')?.status).toBe('rejected');
    const events = repository.listEvents('cmd-independence').map((e) => e.eventType);
    expect(events.at(-1)).toBe('command_rejected');
  });

  it('a clarification stores no command and emits command_clarification_required', () => {
    const repository = new InMemoryMissionCommandRepository();
    const result = submit('Stop it and give it to the other one.', createAuthMissionContext(), repository, 'cmd-ambiguous');
    expect(result.kind).toBe('clarification_required');
    expect(repository.getCommand('cmd-ambiguous')).toBeNull();
    expect(repository.listEvents('cmd-ambiguous').map((e) => e.eventType)).toEqual([
      'command_received', 'command_clarification_required',
    ]);
  });

  it('secrets in the raw request never reach stored events', () => {
    const repository = new InMemoryMissionCommandRepository();
    submit('Stop it token=supersecret123', createAuthMissionContext(), repository, 'cmd-secret');
    const [received] = repository.listEvents('cmd-secret');
    expect(JSON.stringify(received.metadata)).not.toContain('supersecret123');
    expect(JSON.stringify(received.metadata)).toContain('[redacted]');
  });

  it('a duplicate command id is rejected at submission (DUPLICATE_COMMAND)', () => {
    const repository = new InMemoryMissionCommandRepository();
    const context = resumableContext();
    submit('Resume the api task.', context, repository, 'cmd-dup');
    const again = submit('Resume the api task.', context, repository, 'cmd-dup');
    expect(again.kind).toBe('duplicate');
    if (again.kind !== 'duplicate') return;
    expect(again.error.code).toBe('DUPLICATE_COMMAND');
  });
});

describe('atomic execution', () => {
  it('a low-risk command with no prerequisites executes atomically and bumps revisions', () => {
    const repository = new InMemoryMissionCommandRepository();
    const contextStore = new InMemoryMissionContextStore();
    const context = resumableContext();
    contextStore.save(context);
    submit('Resume the api task.', context, repository, 'cmd-exec');

    const result = executeMissionCommand({
      commandId: 'cmd-exec',
      repository,
      contextStore,
      actorId: 'user-founder',
      occurredAt: FIXTURE_TIME,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.duplicate).toBe(false);
    expect(result.appliedChangeIds).toHaveLength(1);
    expect(result.command.status).toBe('executed');
    expect(result.command.executionEventIds.length).toBeGreaterThanOrEqual(3);

    const next = contextStore.get('mission-auth');
    expect(next?.tasks.find((t) => t.taskId === 'task-api')?.status.executionStatus).toBe('running');
    expect(next?.tasks.find((t) => t.taskId === 'task-api')?.taskRevision).toBe(2);
    expect(next?.mission.missionRevision).toBe(4);

    const eventTypes = repository.listEvents('cmd-exec').map((e) => e.eventType);
    expect(eventTypes.slice(-3)).toEqual([
      'command_execution_started', 'state_change_applied', 'command_executed',
    ]);
  });

  it('duplicate execution is idempotent — no repeated transitions, no repeated events', () => {
    const repository = new InMemoryMissionCommandRepository();
    const contextStore = new InMemoryMissionContextStore();
    const context = resumableContext();
    contextStore.save(context);
    submit('Resume the api task.', context, repository, 'cmd-idem');
    executeMissionCommand({
      commandId: 'cmd-idem', repository, contextStore,
      actorId: 'user-founder', occurredAt: FIXTURE_TIME,
    });
    const eventCount = repository.listEvents('cmd-idem').length;
    const revision = contextStore.get('mission-auth')?.mission.missionRevision;

    const second = executeMissionCommand({
      commandId: 'cmd-idem', repository, contextStore,
      actorId: 'user-founder', occurredAt: FIXTURE_TIME,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.duplicate).toBe(true);
    expect(second.appliedChangeIds).toHaveLength(1);
    expect(repository.listEvents('cmd-idem')).toHaveLength(eventCount);
    expect(contextStore.get('mission-auth')?.mission.missionRevision).toBe(revision);
  });

  it('an unsatisfied checkpoint blocks execution (CHECKPOINT_REQUIRED)', () => {
    const repository = new InMemoryMissionCommandRepository();
    const contextStore = new InMemoryMissionContextStore();
    const context = createAuthMissionContext();
    contextStore.save(context);
    submit('Pause the backend task.', context, repository, 'cmd-pause');
    const result = executeMissionCommand({
      commandId: 'cmd-pause', repository, contextStore,
      actorId: 'user-founder', occurredAt: FIXTURE_TIME,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0].code).toBe('CHECKPOINT_REQUIRED');
    expect(contextStore.get('mission-auth')?.tasks.find((t) => t.taskId === 'task-backend')?.status.executionStatus).toBe('running');
  });

  it('a satisfied checkpoint unblocks execution; a failed one blocks with CHECKPOINT_FAILED', () => {
    const repository = new InMemoryMissionCommandRepository();
    const contextStore = new InMemoryMissionContextStore();
    const context = createAuthMissionContext();
    contextStore.save(context);
    const submitted = submit('Pause the backend task.', context, repository, 'cmd-pause-2');
    if (submitted.kind !== 'validated') throw new Error('expected validated');
    const checkpoint = submitted.prerequisites.find((p) => p.kind === 'checkpoint');
    if (!checkpoint) throw new Error('expected a checkpoint prerequisite');

    const satisfied = resolveCommandPrerequisite({
      commandId: 'cmd-pause-2', prerequisiteId: checkpoint.prerequisiteId,
      repository, actorId: 'relay', occurredAt: FIXTURE_TIME, outcome: 'satisfied',
    });
    expect(satisfied.ok).toBe(true);
    expect(repository.listEvents('cmd-pause-2').map((e) => e.eventType)).toContain('checkpoint_satisfied');

    const result = executeMissionCommand({
      commandId: 'cmd-pause-2', repository, contextStore,
      actorId: 'user-founder', occurredAt: FIXTURE_TIME,
    });
    expect(result.ok).toBe(true);
    expect(contextStore.get('mission-auth')?.tasks.find((t) => t.taskId === 'task-backend')?.status.executionStatus).toBe('waiting');
  });

  it('a FAILED checkpoint preserves state and blocks execution', () => {
    const repository = new InMemoryMissionCommandRepository();
    const contextStore = new InMemoryMissionContextStore();
    const context = createAuthMissionContext();
    contextStore.save(context);
    const submitted = submit('Pause the backend task.', context, repository, 'cmd-pause-3');
    if (submitted.kind !== 'validated') throw new Error('expected validated');
    const checkpoint = submitted.prerequisites[0];
    resolveCommandPrerequisite({
      commandId: 'cmd-pause-3', prerequisiteId: checkpoint.prerequisiteId,
      repository, actorId: 'relay', occurredAt: FIXTURE_TIME,
      outcome: 'failed', detail: 'capture write failed',
    });
    expect(repository.listEvents('cmd-pause-3').map((e) => e.eventType)).toContain('checkpoint_failed');
    const result = executeMissionCommand({
      commandId: 'cmd-pause-3', repository, contextStore,
      actorId: 'user-founder', occurredAt: FIXTURE_TIME,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0].code).toBe('CHECKPOINT_FAILED');
    expect(contextStore.get('mission-auth')?.tasks.find((t) => t.taskId === 'task-backend')?.status.executionStatus).toBe('running');
  });

  it('an invalid approval reference is rejected (APPROVAL_INVALID) and double-approval is impossible', () => {
    const repository = new InMemoryMissionCommandRepository();
    const context = createAuthMissionContext();
    const submitted = submit('Cancel the backend task.', context, repository, 'cmd-approval');
    if (submitted.kind !== 'validated') throw new Error('expected validated');
    const approval = submitted.prerequisites.find((p) => p.kind === 'human_approval');
    if (!approval) throw new Error('expected an approval prerequisite');

    const wrong = resolveCommandPrerequisite({
      commandId: 'cmd-approval', prerequisiteId: 'cmd-approval-pre-99',
      repository, actorId: 'user-founder', occurredAt: FIXTURE_TIME, outcome: 'satisfied',
    });
    expect(!wrong.ok && wrong.error.code).toBe('APPROVAL_INVALID');

    const first = resolveCommandPrerequisite({
      commandId: 'cmd-approval', prerequisiteId: approval.prerequisiteId,
      repository, actorId: 'user-founder', occurredAt: FIXTURE_TIME, outcome: 'satisfied',
    });
    expect(first.ok).toBe(true);
    const second = resolveCommandPrerequisite({
      commandId: 'cmd-approval', prerequisiteId: approval.prerequisiteId,
      repository, actorId: 'user-founder', occurredAt: FIXTURE_TIME, outcome: 'satisfied',
    });
    expect(!second.ok && second.error.code).toBe('APPROVAL_INVALID');
  });

  it('a stale mission revision at execution time rejects BEFORE any mutation', () => {
    const repository = new InMemoryMissionCommandRepository();
    const contextStore = new InMemoryMissionContextStore();
    const context = resumableContext();
    contextStore.save(context);
    submit('Resume the api task.', context, repository, 'cmd-stale');

    const moved = contextStore.get('mission-auth') as RelayMissionCommandContext;
    moved.mission.missionRevision = 4;
    contextStore.commit('mission-auth', moved);
    const snapshot = JSON.stringify(contextStore.get('mission-auth'));

    const result = executeMissionCommand({
      commandId: 'cmd-stale', repository, contextStore,
      actorId: 'user-founder', occurredAt: FIXTURE_TIME,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0].code).toBe('STALE_MISSION_REVISION');
    expect(JSON.stringify(contextStore.get('mission-auth'))).toBe(snapshot);
    expect(repository.getCommand('cmd-stale')?.status).toBe('rejected');
  });

  it('an atomic multi-change failure applies NOTHING and preserves the original context', () => {
    const repository = new InMemoryMissionCommandRepository();
    const contextStore = new InMemoryMissionContextStore();
    const context = createAuthMissionContext();
    contextStore.save(context);

    // Hand-stored validated command whose SECOND change cannot apply.
    const command: RelayMissionCommand = {
      commandId: 'cmd-atomic',
      projectId: 'project-sunday',
      missionId: 'mission-auth',
      issuedByUserId: 'user-founder',
      issuedAt: FIXTURE_TIME,
      naturalLanguageRequest: 'atomic failure fixture',
      intent: 'pause',
      secondaryIntents: [],
      targetTaskIds: ['task-backend'],
      targetAgentIds: [],
      interpretedChanges: [
        {
          changeId: 'chg-a',
          entityType: 'task',
          entityId: 'task-backend',
          previousState: 'running',
          requestedState: 'waiting',
          reason: 'valid first change',
          statusDimension: 'execution',
        },
        {
          changeId: 'chg-b',
          entityType: 'agent_run',
          entityId: 'run-hermes-backend',
          previousState: 'completed', // WRONG on purpose — the run is running
          requestedState: 'cancelled',
          reason: 'invalid second change',
        },
      ],
      affectedDependencies: [],
      affectedWorkspaces: [],
      affectedReviews: [],
      affectedFindings: [],
      checkpointRequired: false,
      approvalRequired: false,
      independenceRiskDetected: false,
      permissionChangeDetected: false,
      risk: 'medium',
      riskFactors: [],
      status: 'validated',
      missionRevision: 3,
      taskRevisions: { 'task-backend': 1 },
      executionEventIds: [],
    };
    repository.createCommand(command);
    const snapshot = JSON.stringify(contextStore.get('mission-auth'));

    const result = executeMissionCommand({
      commandId: 'cmd-atomic', repository, contextStore,
      actorId: 'user-founder', occurredAt: FIXTURE_TIME,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0].code).toBe('ATOMIC_APPLICATION_FAILED');

    // NOTHING applied — including the valid first change.
    expect(JSON.stringify(contextStore.get('mission-auth'))).toBe(snapshot);
    expect(repository.getCommand('cmd-atomic')?.status).toBe('failed');
    const eventTypes = repository.listEvents('cmd-atomic').map((e) => e.eventType);
    expect(eventTypes).toEqual(['command_execution_started', 'command_failed']);
  });

  it('executing an unknown or non-validated command fails structurally', () => {
    const repository = new InMemoryMissionCommandRepository();
    const contextStore = new InMemoryMissionContextStore();
    const unknown = executeMissionCommand({
      commandId: 'cmd-ghost', repository, contextStore,
      actorId: 'user-founder', occurredAt: FIXTURE_TIME,
    });
    expect(unknown.ok).toBe(false);

    const context = createAuthMissionContext();
    contextStore.save(context);
    submit('Move the review task to Claude.', context, repository, 'cmd-rejected-exec');
    const rejected = executeMissionCommand({
      commandId: 'cmd-rejected-exec', repository, contextStore,
      actorId: 'user-founder', occurredAt: FIXTURE_TIME,
    });
    expect(rejected.ok).toBe(false);
    if (rejected.ok) return;
    expect(rejected.errors[0].expected).toBe('validated');
    expect(rejected.errors[0].actual).toBe('rejected');
  });
});
