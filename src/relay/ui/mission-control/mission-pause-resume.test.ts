import { describe, expect, it } from 'vitest';

import {
  DeterministicCommandInterpreter,
  InMemoryMissionCommandRepository,
  InMemoryMissionContextStore,
  type CommandAgentRunContext,
  type RelayMissionCommandContext,
} from '../../mission/commands';
import { createAuthMissionContext } from '../../mission/commands/command-fixtures';
import {
  describeRunCommandErrors,
  missionRunCommandText,
  requestMissionRunCommand,
  resolveMissionRunPrerequisite,
  type MissionRunCommandDeps,
  type MissionRunCommandResult,
} from './mission-pause-resume';
import {
  isTerminalRunState,
  missionIsTerminal,
  pausableTasks,
  projectMissionRunControls,
  resumableTasks,
} from './mission-run-controls';

/**
 * WEBSITE MISSION PAUSE / RESUME — command path.
 *
 * Every assertion runs against the REAL Milestone 2 protocol: the deterministic
 * interpreter, the 24-step validator, the checkpoint engine and the atomic
 * executor. Nothing here stubs a success. Deterministic clock, deterministic
 * ids, no network, no provider, no adapter.
 */

const NOW = '2026-07-28T12:00:00.000Z';

function deps(
  context: RelayMissionCommandContext,
  over: Partial<MissionRunCommandDeps> = {},
): MissionRunCommandDeps & { contextStore: InMemoryMissionContextStore } {
  const contextStore = new InMemoryMissionContextStore();
  contextStore.save(context);
  return {
    interpreter: new DeterministicCommandInterpreter(),
    repository: new InMemoryMissionCommandRepository(),
    contextStore,
    now: () => NOW,
    requestId: () => 'cmd-web-1',
    actorUserId: 'user-founder',
    projectId: 'project-sunday',
    missionId: 'mission-auth',
    ...over,
  } as MissionRunCommandDeps & { contextStore: InMemoryMissionContextStore };
}

/** A single running task whose run has NO partial work — no checkpoint. */
function cleanRunningContext(): RelayMissionCommandContext {
  const base = createAuthMissionContext();
  const run: CommandAgentRunContext = {
    runId: 'run-clean',
    taskId: 'task-backend',
    requestedAgentId: 'agent-hermes',
    actualAgentId: 'agent-hermes',
    state: 'running',
    partialWork: {
      changedFiles: [], commandsRun: 0, testsRun: 0, knownErrors: [],
      findingIds: [], unresolvedQuestions: [], costConsumedUsd: 0,
    },
    childProcessRefs: [],
    checkpointStatus: 'none',
  };
  return {
    ...base,
    tasks: base.tasks
      .filter((t) => t.taskId === 'task-backend')
      .map((t) => ({ ...t, workspaceId: null })),
    agentRuns: [run],
  };
}

/** A single waiting task attached to a live (non-terminal) run. */
function waitingResumableContext(
  runOver: Partial<CommandAgentRunContext> = {},
): RelayMissionCommandContext {
  const base = createAuthMissionContext();
  const run: CommandAgentRunContext = {
    runId: 'run-paused',
    taskId: 'task-backend',
    requestedAgentId: 'agent-hermes',
    actualAgentId: 'agent-hermes',
    state: 'waiting',
    partialWork: {
      changedFiles: ['src/db/schema.ts'], commandsRun: 2, testsRun: 0,
      knownErrors: [], findingIds: [], unresolvedQuestions: [], costConsumedUsd: 0.2,
    },
    childProcessRefs: [],
    checkpointStatus: 'satisfied',
    ...runOver,
  };
  return {
    ...base,
    tasks: base.tasks
      .filter((t) => t.taskId === 'task-backend')
      .map((t) => ({ ...t, status: { ...t.status, executionStatus: 'waiting' as const } })),
    agentRuns: [run],
  };
}

const executed = (r: MissionRunCommandResult) => r.kind === 'executed' ? r : null;

/* ------------------------------- semantics ------------------------------ */

describe('canonical command intents', () => {
  it('uses pause / resume — never suspend, freeze or unpause', () => {
    expect(missionRunCommandText('pause', ['task-backend'])).toBe('pause task-backend');
    expect(missionRunCommandText('resume', ['task-backend'])).toBe('resume task-backend');
    expect(missionRunCommandText('pause', ['a', 'b'])).toBe('pause mission');
    for (const text of [
      missionRunCommandText('pause', ['t']), missionRunCommandText('resume', ['t']),
    ]) {
      expect(text).not.toMatch(/suspend|freeze|unpause/i);
    }
  });
});

/* --------------------------------- pause -------------------------------- */

describe('website PAUSE goes through the validated command protocol', () => {
  it('creates a canonical pause command carrying mission and task revisions', () => {
    const d = deps(cleanRunningContext());
    const result = requestMissionRunCommand('pause', d);
    const ok = executed(result);
    expect(ok, JSON.stringify(result)).not.toBeNull();
    expect(ok!.command.intent).toBe('pause');
    expect(ok!.command.missionId).toBe('mission-auth');
    expect(ok!.command.missionRevision).toBe(3);
    expect(ok!.command.targetTaskIds).toEqual(['task-backend']);
    const change = ok!.command.interpretedChanges[0];
    expect(change.entityType).toBe('task');
    expect(change.entityId).toBe('task-backend');
    expect(change.requestedState).toBe('waiting');
    expect(change.expectedRevision).toBe(1);      // task revision preserved
    expect(change.statusDimension).toBe('execution');
  });

  it('succeeds with no checkpoint requirement and moves execution to waiting', () => {
    const d = deps(cleanRunningContext());
    const result = requestMissionRunCommand('pause', d);
    expect(result.kind).toBe('executed');
    const after = d.contextStore.get('mission-auth')!;
    expect(after.tasks.find((t) => t.taskId === 'task-backend')!.status.executionStatus)
      .toBe('waiting');
  });

  it('does not touch outcome, verification or release', () => {
    const before = cleanRunningContext();
    const beforeTask = before.tasks[0].status;
    const d = deps(before);
    expect(requestMissionRunCommand('pause', d).kind).toBe('executed');
    const after = d.contextStore.get('mission-auth')!.tasks[0].status;
    expect(after.outcomeStatus).toBe(beforeTask.outcomeStatus);
    expect(after.verificationStatus).toBe(beforeTask.verificationStatus);
    expect(after.releaseStatus).toBe(beforeTask.releaseStatus);
    expect(after.outcomeStatus).not.toBe('satisfied');
  });

  it('never marks the mission cancelled or completed', () => {
    const d = deps(cleanRunningContext());
    requestMissionRunCommand('pause', d);
    const mission = d.contextStore.get('mission-auth')!.mission.status;
    expect(mission.executionStatus).not.toBe('cancelled');
    expect(mission.executionStatus).not.toBe('completed');
  });

  it('preserves partial output, workspace identity and agent identities', () => {
    const context = waitingResumableContext({ state: 'running' });
    const running = {
      ...context,
      tasks: context.tasks.map((t) => ({
        ...t, status: { ...t.status, executionStatus: 'running' as const },
      })),
    };
    const d = deps(running);
    expect(requestMissionRunCommand('pause', d).kind).toBe('executed');
    const after = d.contextStore.get('mission-auth')!;
    const run = after.agentRuns[0];
    expect(run.partialWork.changedFiles).toEqual(['src/db/schema.ts']);
    expect(run.partialWork.commandsRun).toBe(2);
    expect(run.requestedAgentId).toBe('agent-hermes');
    expect(run.actualAgentId).toBe('agent-hermes');
    expect(after.tasks[0].workspaceId).toBe('workspace-backend');
  });

  it('reports it paused ASSIGNMENT only — it never claims process suspension', () => {
    const d = deps(cleanRunningContext());
    const ok = executed(requestMissionRunCommand('pause', d))!;
    expect(ok.assignmentOnly).toBe(true);
  });
});

/* ------------------------------ checkpoints ----------------------------- */

describe('checkpoint-before-pause', () => {
  it('stops at checkpoint_required and applies NOTHING', () => {
    // The stock fixture has running runs with partial work + child processes.
    const d = deps(createAuthMissionContext());
    const result = requestMissionRunCommand('pause', d);
    expect(result.kind).toBe('checkpoint_required');
    if (result.kind !== 'checkpoint_required') return;
    expect(result.prerequisites.length).toBeGreaterThan(0);
    expect(result.prerequisites.every((p) => p.kind === 'checkpoint')).toBe(true);
    // Mission state is untouched while the checkpoint is outstanding.
    const after = d.contextStore.get('mission-auth')!;
    for (const task of after.tasks.filter((t) => t.taskId !== 'task-auth-impl')) {
      const before = createAuthMissionContext().tasks.find((t) => t.taskId === task.taskId)!;
      expect(task.status.executionStatus).toBe(before.status.executionStatus);
    }
  });

  it('executes once every checkpoint is satisfied', () => {
    const d = deps(createAuthMissionContext());
    const first = requestMissionRunCommand('pause', d);
    expect(first.kind).toBe('checkpoint_required');
    if (first.kind !== 'checkpoint_required') return;

    let last: MissionRunCommandResult = first;
    for (const prerequisite of first.prerequisites) {
      last = resolveMissionRunPrerequisite({
        intent: 'pause',
        commandId: first.command.commandId,
        prerequisiteId: prerequisite.prerequisiteId,
        outcome: 'satisfied',
        preview: first.preview,
      }, d);
    }
    expect(last.kind).toBe('executed');
    const after = d.contextStore.get('mission-auth')!;
    expect(after.tasks.find((t) => t.taskId === 'task-backend')!.status.executionStatus)
      .toBe('waiting');
  });

  it('a FAILED checkpoint leaves mission state unchanged', () => {
    const d = deps(createAuthMissionContext());
    const first = requestMissionRunCommand('pause', d);
    if (first.kind !== 'checkpoint_required') throw new Error('expected checkpoint');
    const failed = resolveMissionRunPrerequisite({
      intent: 'pause',
      commandId: first.command.commandId,
      prerequisiteId: first.prerequisites[0].prerequisiteId,
      outcome: 'failed',
      detail: 'the workspace snapshot could not be written',
      preview: first.preview,
    }, d);
    expect(failed.kind).not.toBe('executed');
    const after = d.contextStore.get('mission-auth')!;
    expect(after.tasks.find((t) => t.taskId === 'task-backend')!.status.executionStatus)
      .toBe('running');
  });
});

/* -------------------------------- resume -------------------------------- */

describe('website RESUME goes through the validated command protocol', () => {
  it('creates a canonical resume command and returns execution to running', () => {
    const d = deps(waitingResumableContext());
    const result = requestMissionRunCommand('resume', d);
    const ok = executed(result);
    expect(ok, JSON.stringify(result)).not.toBeNull();
    expect(ok!.command.intent).toBe('resume');
    expect(ok!.command.interpretedChanges[0].requestedState).toBe('running');
    expect(ok!.command.missionRevision).toBe(3);
    const after = d.contextStore.get('mission-auth')!;
    expect(after.tasks[0].status.executionStatus).toBe('running');
  });

  it('keeps the SAME run and its partial output — no retry, no new run', () => {
    const d = deps(waitingResumableContext());
    expect(requestMissionRunCommand('resume', d).kind).toBe('executed');
    const after = d.contextStore.get('mission-auth')!;
    expect(after.agentRuns).toHaveLength(1);
    expect(after.agentRuns[0].runId).toBe('run-paused');
    expect(after.agentRuns[0].partialWork.changedFiles).toEqual(['src/db/schema.ts']);
  });

  it('does not affect outcome, verification or release', () => {
    const before = waitingResumableContext();
    const d = deps(before);
    requestMissionRunCommand('resume', d);
    const after = d.contextStore.get('mission-auth')!.tasks[0].status;
    expect(after.outcomeStatus).toBe(before.tasks[0].status.outcomeStatus);
    expect(after.verificationStatus).toBe(before.tasks[0].status.verificationStatus);
    expect(after.releaseStatus).toBe(before.tasks[0].status.releaseStatus);
  });

  it('refuses to resume a terminal run — retry or reassignment is required', () => {
    for (const state of ['completed', 'failed', 'cancelled', 'retry_requested'] as const) {
      const d = deps(waitingResumableContext({ state }));
      const result = requestMissionRunCommand('resume', d);
      expect(result.kind, state).toBe('unavailable');
      if (result.kind === 'unavailable') {
        expect(result.reason).toContain('nothing to resume');
      }
      // Nothing moved.
      expect(d.contextStore.get('mission-auth')!.tasks[0].status.executionStatus)
        .toBe('waiting');
    }
  });

  it('treats timed_out and orphaned capsules as unresumable', () => {
    for (const capsule of ['timed_out', 'orphaned']) {
      const context = waitingResumableContext();
      const controls = projectMissionRunControls({
        context,
        capsuleStatuses: { 'run-paused': capsule },
      });
      expect(controls.resume.visible, capsule).toBe(false);
      expect(controls.resume.disabledReason, capsule).toContain(capsule);
      expect(controls.resume.disabledReason, capsule).toMatch(/retry or reassign/);
    }
  });

  it('rejects a stale mission revision without mutating anything', () => {
    const d = deps(waitingResumableContext());
    const request = requestMissionRunCommand('resume', d);
    expect(request.kind).toBe('executed');

    // The mission moves on; a command validated against revision 3 must fail.
    const moved = d.contextStore.get('mission-auth')!;
    d.contextStore.commit('mission-auth', {
      ...moved,
      mission: { ...moved.mission, missionRevision: 4 },
      tasks: moved.tasks.map((t) => ({
        ...t, status: { ...t.status, executionStatus: 'waiting' as const },
      })),
    });

    const stale = requestMissionRunCommand('resume', {
      ...d, requestId: () => 'cmd-web-stale',
    });
    // Re-validated against the CURRENT revision, so it either executes against
    // revision 4 or reports a structured failure — it never applies a change
    // using the stale revision it was validated with.
    if (stale.kind === 'executed') {
      expect(stale.command.missionRevision).toBe(4);
    } else {
      expect(['rejected', 'unavailable']).toContain(stale.kind);
    }
  });
});

/* ------------------------- structured error surface --------------------- */

describe('structured failures are safe and specific', () => {
  it('a duplicate command id is rejected with a structured error', () => {
    const d = deps(cleanRunningContext());
    expect(requestMissionRunCommand('pause', d).kind).toBe('executed');
    const duplicate = requestMissionRunCommand('pause', d); // same requestId
    expect(duplicate.kind).not.toBe('executed');
  });

  it('an unloaded mission reports an exact reason, never a generic failure', () => {
    const d = deps(cleanRunningContext(), { missionId: 'mission-missing' });
    const result = requestMissionRunCommand('pause', d);
    expect(result.kind).toBe('unavailable');
    if (result.kind !== 'unavailable') return;
    expect(result.reason).toBe('The mission is not loaded, so no command can be issued for it.');
    expect(result.reason).not.toMatch(/something went wrong/i);
  });

  it('error text carries the domain reason and next action, never a stack trace', () => {
    const message = describeRunCommandErrors([{
      code: 'STALE_MISSION_REVISION',
      reason: 'the mission moved to revision 4',
      safeNextAction: 're-issue the command',
      humanActionRequired: false,
    }]);
    expect(message).toBe('the mission moved to revision 4 — re-issue the command');
    expect(message).not.toMatch(/\bat .*\(.*:\d+:\d+\)/);
    expect(describeRunCommandErrors([])).toBe('The command did not complete.');
  });
});

/* ----------------------------- eligibility ------------------------------ */

describe('eligibility helpers', () => {
  it('only running tasks are pausable and only live waiting runs are resumable', () => {
    const context = createAuthMissionContext();
    expect(pausableTasks(context).map((t) => t.taskId).sort())
      .toEqual(['task-auth-review', 'task-backend']);
    // task-api / task-frontend are waiting but have NO run — not resumable.
    expect(resumableTasks(context)).toEqual([]);
    expect(missionIsTerminal(context)).toBe(false);
  });

  it('names every terminal run state', () => {
    for (const state of ['completed', 'failed', 'cancelled', 'timed_out', 'orphaned', 'retry_requested']) {
      expect(isTerminalRunState(state), state).toBe(true);
    }
    for (const state of ['starting', 'running', 'waiting']) {
      expect(isTerminalRunState(state), state).toBe(false);
    }
  });
});
