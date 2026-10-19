/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 2
 * Command intake orchestration + the ATOMIC in-memory execution boundary.
 *
 * `submitMissionCommand` runs receive → interpret → validate, persisting the
 * command, its prerequisites, and every lifecycle event.
 *
 * `executeMissionCommand` is the ONLY path from a validated command to
 * applied state: it re-reads the current context, re-validates revisions,
 * prerequisites, permissions, and workspace compatibility, builds the
 * COMPLETE proposed next context on a clone (validating every Milestone 1
 * transition through the real engine), and commits everything in one
 * replacement — or commits NOTHING. A failure after execution begins emits
 * `command_failed`, preserves the original context byte-for-byte, and leaves
 * the command inspectable.
 *
 * Nothing here controls a real process, calls a provider, or touches the
 * network. Ids and timestamps are caller-supplied.
 */

import { applyStatusTransition } from '../status/status-model';
import type { RelayMissionCommandContext } from './command-context';
import { cloneCommandContext } from './command-context';
import { commandError, type RelayMissionCommandError } from './command-errors';
import {
  createCommandEvent,
  type RelayMissionCommandEvent,
  type RelayMissionCommandEventType,
} from './command-events';
import type {
  RelayMissionCommandInterpreter,
  RelayMissionCommandNaturalRequest,
} from './command-interpreter';
import { evaluatePermissionCompatibility } from './command-permissions';
import type { RelayMissionCommandPreview } from './command-preview';
import {
  InMemoryMissionCommandRepository,
  InMemoryMissionContextStore,
} from './command-repository';
import type {
  RelayCommandPrerequisite,
  RelayMissionCommand,
  RelayStateChange,
} from './command-types';
import { currentEntityState, validateMissionCommand } from './command-validator';
import { evaluateWorkspaceCompatibility } from './command-workspace';

/* ------------------------------------------------------------ plumbing */

interface EventScope {
  commandId: string;
  projectId: string;
  missionId: string;
  missionRevision: number;
  repository: InMemoryMissionCommandRepository;
}

function appendEvent(
  scope: EventScope,
  eventType: RelayMissionCommandEventType,
  actorId: string,
  occurredAt: string,
  metadata: Record<string, unknown> = {},
): RelayMissionCommandEvent {
  const sequence = scope.repository.nextEventSequence(scope.commandId);
  const event = createCommandEvent({
    eventId: `${scope.commandId}-ev-${sequence}`,
    commandId: scope.commandId,
    projectId: scope.projectId,
    missionId: scope.missionId,
    missionRevision: scope.missionRevision,
    sequence,
    eventType,
    actorId,
    occurredAt,
    metadata,
  });
  const result = scope.repository.appendEvent(event);
  if (!result.ok) {
    // Sequences are computed from the repository itself, so this is
    // unreachable in correct use; surface loudly rather than losing history.
    throw new Error(`command event append failed: ${result.error.reason}`);
  }
  return result.value;
}

/* ---------------------------------------------------------- submission */

export interface SubmitMissionCommandInput {
  request: RelayMissionCommandNaturalRequest;
  interpreter: RelayMissionCommandInterpreter;
  context: RelayMissionCommandContext;
  repository: InMemoryMissionCommandRepository;
  /** Defaults to the request id — supplying it lets callers retry safely. */
  commandId?: string;
}

export type SubmitMissionCommandResult =
  | {
      kind: 'validated';
      command: RelayMissionCommand;
      preview: RelayMissionCommandPreview;
      prerequisites: RelayCommandPrerequisite[];
    }
  | {
      kind: 'rejected';
      command: RelayMissionCommand;
      errors: RelayMissionCommandError[];
      preview?: RelayMissionCommandPreview;
    }
  | { kind: 'clarification_required'; reason: string; missingInformation: string[] }
  | { kind: 'interpretation_rejected'; reason: string }
  | { kind: 'duplicate'; error: RelayMissionCommandError };

/** Receive → interpret → validate. Never executes anything. */
export function submitMissionCommand(
  input: SubmitMissionCommandInput,
): SubmitMissionCommandResult {
  const { request, interpreter, context, repository } = input;
  const commandId = input.commandId ?? request.requestId;

  if (repository.getCommand(commandId)) {
    return {
      kind: 'duplicate',
      error: commandError(
        'DUPLICATE_COMMAND',
        `command ${commandId} already exists`,
        'inspect the existing command or submit under a fresh id',
        { commandId, entityType: 'command', entityId: commandId },
      ),
    };
  }

  const scope: EventScope = {
    commandId,
    projectId: request.projectId,
    missionId: request.missionId,
    missionRevision: context.mission.missionRevision,
    repository,
  };
  const actor = request.issuedByUserId;
  appendEvent(scope, 'command_received', actor, request.issuedAt, { text: request.text });

  const interpretation = interpreter.interpret(request, context);
  if (interpretation.kind === 'clarification_required') {
    appendEvent(scope, 'command_clarification_required', actor, request.issuedAt, {
      reason: interpretation.reason,
      missingInformation: interpretation.missingInformation,
    });
    return {
      kind: 'clarification_required',
      reason: interpretation.reason,
      missingInformation: interpretation.missingInformation,
    };
  }
  if (interpretation.kind === 'rejected') {
    appendEvent(scope, 'command_rejected', actor, request.issuedAt, {
      reason: interpretation.reason,
      stage: 'interpretation',
    });
    return { kind: 'interpretation_rejected', reason: interpretation.reason };
  }

  appendEvent(scope, 'command_interpreted', actor, request.issuedAt, {
    intent: interpretation.commandDraft.intent,
    secondaryIntents: interpretation.commandDraft.secondaryIntents,
    targetTaskIds: interpretation.commandDraft.targetTaskIds,
    confidence: interpretation.confidence,
  });
  appendEvent(scope, 'command_validation_required', actor, request.issuedAt, {});

  const validation = validateMissionCommand({
    commandId,
    draft: interpretation.commandDraft,
    context,
  });

  if (!validation.ok) {
    const created = repository.createCommand(validation.rejectedCommand);
    if (!created.ok) return { kind: 'duplicate', error: created.error };
    appendEvent(scope, 'command_rejected', actor, request.issuedAt, {
      stage: 'validation',
      errors: validation.errors.map((e) => ({ code: e.code, reason: e.reason })),
    });
    return {
      kind: 'rejected',
      command: created.value,
      errors: validation.errors,
      preview: validation.preview,
    };
  }

  const created = repository.createCommand(validation.validatedCommand);
  if (!created.ok) return { kind: 'duplicate', error: created.error };
  repository.savePrerequisites(commandId, validation.prerequisites);
  appendEvent(scope, 'command_validated', actor, request.issuedAt, {
    risk: validation.validatedCommand.risk,
    approvalRequired: validation.validatedCommand.approvalRequired,
    checkpointRequired: validation.validatedCommand.checkpointRequired,
  });
  for (const prerequisite of validation.prerequisites) {
    appendEvent(
      scope,
      prerequisite.kind === 'checkpoint' ? 'checkpoint_required' : 'approval_required',
      actor,
      request.issuedAt,
      { prerequisiteId: prerequisite.prerequisiteId, description: prerequisite.description },
    );
  }
  return {
    kind: 'validated',
    command: created.value,
    preview: validation.preview,
    prerequisites: validation.prerequisites,
  };
}

/* ------------------------------------------------ prerequisite results */

export interface ResolvePrerequisiteInput {
  commandId: string;
  prerequisiteId: string;
  repository: InMemoryMissionCommandRepository;
  actorId: string;
  occurredAt: string;
  outcome: 'satisfied' | 'failed';
  detail?: string;
}

export type ResolvePrerequisiteResult =
  | { ok: true; prerequisite: RelayCommandPrerequisite }
  | { ok: false; error: RelayMissionCommandError };

/** Record a checkpoint/approval result. Never executes the command. */
export function resolveCommandPrerequisite(
  input: ResolvePrerequisiteInput,
): ResolvePrerequisiteResult {
  const { commandId, prerequisiteId, repository, actorId, occurredAt } = input;
  const command = repository.getCommand(commandId);
  if (!command) {
    return {
      ok: false,
      error: commandError(
        'APPROVAL_INVALID',
        `command ${commandId} does not exist`,
        'submit and validate the command first',
        { commandId, entityType: 'command', entityId: commandId },
      ),
    };
  }
  const updated = repository.updatePrerequisite(
    commandId,
    prerequisiteId,
    input.outcome === 'satisfied'
      ? { status: 'satisfied', satisfiedBy: actorId, satisfiedAt: occurredAt }
      : { status: 'failed', failureReason: input.detail ?? 'prerequisite failed' },
  );
  if (!updated.ok) return { ok: false, error: updated.error };

  const scope: EventScope = {
    commandId,
    projectId: command.projectId,
    missionId: command.missionId,
    missionRevision: command.missionRevision,
    repository,
  };
  if (updated.value.kind === 'checkpoint') {
    appendEvent(
      scope,
      input.outcome === 'satisfied' ? 'checkpoint_satisfied' : 'checkpoint_failed',
      actorId,
      occurredAt,
      { prerequisiteId, taskId: updated.value.taskId, runId: updated.value.runId, detail: input.detail },
    );
  } else if (input.outcome === 'satisfied') {
    appendEvent(scope, 'approval_received', actorId, occurredAt, { prerequisiteId });
  }
  return { ok: true, prerequisite: updated.value };
}

/* ------------------------------------------------------------ execution */

export interface ExecuteMissionCommandInput {
  commandId: string;
  repository: InMemoryMissionCommandRepository;
  contextStore: InMemoryMissionContextStore;
  actorId: string;
  occurredAt: string;
}

export type ExecuteMissionCommandResult =
  | {
      ok: true;
      command: RelayMissionCommand;
      appliedChangeIds: string[];
      /** True when this call returned an earlier execution's stored result. */
      duplicate: boolean;
    }
  | { ok: false; command: RelayMissionCommand | null; errors: RelayMissionCommandError[] };

function applyEntityChange(
  clone: RelayMissionCommandContext,
  change: RelayStateChange,
): string | null {
  switch (change.entityType) {
    case 'task': {
      const task = clone.tasks.find((t) => t.taskId === change.entityId);
      if (!task) return `task ${change.entityId} disappeared`;
      if (change.requestedState.startsWith('owner:')) {
        const owner = change.requestedState.slice('owner:'.length);
        task.ownerAgentId = owner === 'none' ? null : owner;
        return null;
      }
      if (change.requestedState.startsWith('priority:')) {
        task.priority = Number(change.requestedState.slice('priority:'.length));
        return null;
      }
      if (change.requestedState.startsWith('output_target:')) {
        task.outputTarget = change.requestedState.slice('output_target:'.length);
        return null;
      }
      return `task change "${change.requestedState}" is not applicable`;
    }
    case 'agent_run': {
      const run = clone.agentRuns.find((r) => r.runId === change.entityId);
      if (!run) return `run ${change.entityId} disappeared`;
      run.state = change.requestedState as typeof run.state;
      return null;
    }
    case 'review': {
      const review = clone.reviews.find((r) => r.reviewId === change.entityId);
      if (!review) return `review ${change.entityId} disappeared`;
      review.status = change.requestedState as typeof review.status;
      return null;
    }
    case 'workspace': {
      const workspace = clone.workspaces.find((w) => w.workspaceId === change.entityId);
      if (!workspace) return `workspace ${change.entityId} disappeared`;
      const owner = change.requestedState.slice('write_owner:'.length);
      workspace.writeOwnerAgentId = owner === 'none' ? null : owner;
      return null;
    }
    case 'permission': {
      const agent = clone.agents.find((a) => a.agentId === change.entityId);
      if (!agent) return `agent ${change.entityId} disappeared`;
      if (change.requestedState.startsWith('production_writes:')) {
        agent.passport.permissions.productionAccess =
          change.requestedState === 'production_writes:allowed';
        return null;
      }
      if (change.requestedState.startsWith('network:')) {
        agent.passport.permissions.networkPolicy = change.requestedState.slice(
          'network:'.length,
        ) as typeof agent.passport.permissions.networkPolicy;
        return null;
      }
      return `permission change "${change.requestedState}" is not applicable`;
    }
    case 'budget': {
      clone.mission.budget.maximumSpendUsd = Number(
        change.requestedState.slice('max_usd:'.length),
      );
      return null;
    }
    case 'mission': {
      const [key, ...rest] = change.requestedState.split(':');
      clone.mission.annotations[key] = rest.join(':');
      return null;
    }
    default:
      return `unknown entity type`;
  }
}

/**
 * Execution sequence (all-or-nothing):
 *   1 re-read mission revision      →  6 permissions/workspace re-check
 *   2 re-read task revisions        →  7 build the COMPLETE next state
 *   3 revalidate prerequisites      →  8 validate every M1 transition
 *   4 confirm checkpoint state      →  9 apply atomically (single commit)
 *   5 confirm approval state        → 10 emit ordered events, 11 mark executed
 */
export function executeMissionCommand(
  input: ExecuteMissionCommandInput,
): ExecuteMissionCommandResult {
  const { commandId, repository, contextStore, actorId, occurredAt } = input;
  const command = repository.getCommand(commandId);
  if (!command) {
    return {
      ok: false,
      command: null,
      errors: [
        commandError(
          'ATOMIC_APPLICATION_FAILED',
          `command ${commandId} does not exist in the repository`,
          'submit and validate the command before executing it',
          { commandId, entityType: 'command', entityId: commandId },
        ),
      ],
    };
  }

  /* Duplicate execution is idempotent: the stored result returns, no state
     transition repeats, and no execution event is duplicated. */
  if (command.status === 'executed') {
    const outcome = repository.getExecutionOutcome(commandId);
    return {
      ok: true,
      command,
      appliedChangeIds: outcome?.appliedChangeIds ?? [],
      duplicate: true,
    };
  }
  if (command.status !== 'validated') {
    return {
      ok: false,
      command,
      errors: [
        commandError(
          'INVALID_STATE_TRANSITION',
          `only a validated command may execute — ${commandId} is ${command.status}`,
          'validate the command first, or inspect why it was rejected/failed',
          {
            commandId,
            entityType: 'command',
            entityId: commandId,
            expected: 'validated',
            actual: command.status,
          },
        ),
      ],
    };
  }

  const context = contextStore.get(command.missionId);
  if (!context) {
    return {
      ok: false,
      command,
      errors: [
        commandError(
          'MISSION_NOT_FOUND',
          `mission ${command.missionId} is not in the context store`,
          'load the mission context before executing',
          { commandId, entityType: 'mission', entityId: command.missionId },
        ),
      ],
    };
  }
  const errors: RelayMissionCommandError[] = [];
  const scope: EventScope = {
    commandId,
    projectId: command.projectId,
    missionId: command.missionId,
    missionRevision: context.mission.missionRevision,
    repository,
  };

  /* 1 + 2 — revisions must still match (stale commands reject, no mutation). */
  if (context.mission.missionRevision !== command.missionRevision) {
    errors.push(
      commandError(
        'STALE_MISSION_REVISION',
        `the mission moved to revision ${context.mission.missionRevision} after validation (command holds ${command.missionRevision})`,
        're-issue and re-validate the command against the current mission',
        {
          commandId,
          entityType: 'mission',
          entityId: command.missionId,
          expected: String(context.mission.missionRevision),
          actual: String(command.missionRevision),
        },
      ),
    );
  }
  for (const [taskId, revision] of Object.entries(command.taskRevisions)) {
    const task = context.tasks.find((t) => t.taskId === taskId);
    if (!task) {
      errors.push(
        commandError('TASK_NOT_FOUND', `task ${taskId} disappeared`, 'refresh the mission context', {
          commandId,
          entityType: 'task',
          entityId: taskId,
        }),
      );
    } else if (task.taskRevision !== revision) {
      errors.push(
        commandError(
          'STALE_TASK_REVISION',
          `task ${taskId} moved to revision ${task.taskRevision} after validation`,
          're-issue and re-validate the command against the current task',
          {
            commandId,
            entityType: 'task',
            entityId: taskId,
            expected: String(task.taskRevision),
            actual: String(revision),
          },
        ),
      );
    }
  }
  if (errors.length > 0) {
    repository.updateCommand(commandId, {
      status: 'rejected',
      rejectionReason: errors.map((e) => `${e.code}: ${e.reason}`).join('; '),
    });
    appendEvent(scope, 'command_rejected', actorId, occurredAt, {
      stage: 'execution_preconditions',
      errors: errors.map((e) => ({ code: e.code, reason: e.reason })),
    });
    return { ok: false, command: repository.getCommand(commandId), errors };
  }

  /* 3 + 4 + 5 — prerequisites: checkpoints and approvals must be satisfied. */
  for (const prerequisite of repository.getPrerequisites(commandId)) {
    if (prerequisite.status === 'satisfied') continue;
    if (prerequisite.kind === 'checkpoint') {
      errors.push(
        commandError(
          prerequisite.status === 'failed' ? 'CHECKPOINT_FAILED' : 'CHECKPOINT_REQUIRED',
          prerequisite.status === 'failed'
            ? `the checkpoint for ${prerequisite.taskId} failed: ${prerequisite.failureReason ?? 'unknown'}`
            : `the checkpoint for ${prerequisite.taskId} has not been captured`,
          'satisfy the checkpoint prerequisite, then execute again',
          { commandId, entityType: 'task', entityId: prerequisite.taskId },
        ),
      );
    } else {
      errors.push(
        commandError(
          'APPROVAL_REQUIRED',
          `human approval is pending: ${prerequisite.description}`,
          'obtain the required approval, then execute again',
          { commandId, entityType: 'command', entityId: prerequisite.prerequisiteId, humanActionRequired: true },
        ),
      );
    }
  }
  if (errors.length > 0) return { ok: false, command, errors };

  /* 6 — permissions and workspace compatibility against the FRESH context. */
  const permissionCheck = evaluatePermissionCompatibility(
    { interpretedChanges: command.interpretedChanges },
    context,
  );
  errors.push(...permissionCheck.errors);
  const workspaceCheck = evaluateWorkspaceCompatibility(
    { interpretedChanges: command.interpretedChanges },
    context,
  );
  errors.push(...workspaceCheck.errors);
  if (errors.length > 0) return { ok: false, command, errors };

  /* Execution begins — from here a failure emits command_failed. */
  repository.updateCommand(commandId, { status: 'executing' });
  const startEvent = appendEvent(scope, 'command_execution_started', actorId, occurredAt, {
    changeCount: command.interpretedChanges.length,
  });

  /* 7 + 8 — build the COMPLETE proposed next state on a clone. */
  const clone = cloneCommandContext(context);
  const appliedChangeIds: string[] = [];
  const pendingChangeEvents: Array<Record<string, unknown>> = [];
  let failure: RelayMissionCommandError | null = null;

  for (const change of command.interpretedChanges) {
    const actual = currentEntityState(change, clone);
    if (actual !== change.previousState) {
      failure = commandError(
        'ATOMIC_APPLICATION_FAILED',
        `${change.entityType} ${change.entityId} is "${actual ?? 'missing'}", expected "${change.previousState}" — the context changed after validation`,
        're-validate the command against the current context',
        {
          commandId,
          entityType: change.entityType,
          entityId: change.entityId,
          expected: change.previousState,
          actual: actual ?? 'missing',
        },
      );
      break;
    }
    if (change.statusDimension) {
      const target =
        change.entityType === 'mission'
          ? clone.mission.status
          : clone.tasks.find((t) => t.taskId === change.entityId)?.status;
      if (!target) {
        failure = commandError(
          'ATOMIC_APPLICATION_FAILED',
          `${change.entityType} ${change.entityId} has no status to transition`,
          're-validate the command against the current context',
          { commandId, entityType: change.entityType, entityId: change.entityId },
        );
        break;
      }
      const supporting = clone.reviews
        .filter((r) => r.taskId === change.entityId && r.status === 'completed')
        .at(-1);
      const result = applyStatusTransition(target, {
        dimension: change.statusDimension,
        nextStatus: change.requestedState,
        reason: change.reason,
        actorId,
        actorType: 'user',
        eventId: `${commandId}-apply-${change.changeId}`,
        projectId: command.projectId,
        missionId: command.missionId,
        taskId: change.entityType === 'task' ? change.entityId : undefined,
        missionRevision: context.mission.missionRevision,
        artifactRevision:
          change.statusDimension === 'verification' ? supporting?.artifactRevision : undefined,
        currentArtifactRevision: clone.mission.artifactRevision,
        occurredAt,
        policy: clone.mission.releasePolicy,
      });
      if (!result.ok) {
        failure = commandError(
          'ATOMIC_APPLICATION_FAILED',
          `Milestone 1 rejected ${change.statusDimension} "${change.previousState}" → "${change.requestedState}": ${result.error.reason}`,
          're-validate the command against the current context',
          {
            commandId,
            entityType: change.entityType,
            entityId: change.entityId,
            expected: change.previousState,
            actual: result.error.previousStatus,
            humanActionRequired: result.error.humanActionRequired,
          },
        );
        break;
      }
      if (change.entityType === 'mission') clone.mission.status = result.status;
      else {
        const task = clone.tasks.find((t) => t.taskId === change.entityId);
        if (task) task.status = result.status;
      }
    } else {
      const problem = applyEntityChange(clone, change);
      if (problem) {
        failure = commandError(
          'ATOMIC_APPLICATION_FAILED',
          problem,
          're-validate the command against the current context',
          { commandId, entityType: change.entityType, entityId: change.entityId },
        );
        break;
      }
    }
    appliedChangeIds.push(change.changeId);
    pendingChangeEvents.push({
      changeId: change.changeId,
      entityType: change.entityType,
      entityId: change.entityId,
      previousState: change.previousState,
      requestedState: change.requestedState,
    });
  }

  if (failure) {
    /* NO partial application: the original context was never touched. */
    const failEvent = appendEvent(scope, 'command_failed', actorId, occurredAt, {
      error: { code: failure.code, reason: failure.reason },
      appliedChangeIds: [],
    });
    repository.updateCommand(commandId, {
      status: 'failed',
      executionEventIds: [startEvent.eventId, failEvent.eventId],
    });
    return { ok: false, command: repository.getCommand(commandId), errors: [failure] };
  }

  /* 9 — apply atomically: one commit, then the ordered events. */
  for (const taskId of new Set(
    command.interpretedChanges.filter((c) => c.entityType === 'task').map((c) => c.entityId),
  )) {
    const task = clone.tasks.find((t) => t.taskId === taskId);
    if (task) task.taskRevision += 1;
  }
  clone.mission.missionRevision += 1;
  contextStore.commit(command.missionId, clone);

  /* 10 + 11 — ordered events, then mark executed. */
  const eventIds = [startEvent.eventId];
  for (const metadata of pendingChangeEvents) {
    eventIds.push(appendEvent(scope, 'state_change_applied', actorId, occurredAt, metadata).eventId);
  }
  eventIds.push(
    appendEvent(scope, 'command_executed', actorId, occurredAt, {
      appliedChangeIds,
      nextMissionRevision: clone.mission.missionRevision,
    }).eventId,
  );
  repository.updateCommand(commandId, { status: 'executed', executionEventIds: eventIds });
  repository.saveExecutionOutcome({
    commandId,
    appliedChangeIds,
    executedAt: occurredAt,
    eventIds,
  });
  return { ok: true, command: repository.getCommand(commandId) as RelayMissionCommand, appliedChangeIds, duplicate: false };
}
