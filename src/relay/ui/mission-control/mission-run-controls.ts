/**
 * SUNDAY RELAY — WEBSITE MISSION PAUSE / RESUME (control projection, PURE).
 *
 * Which run controls a user may see, and why. This is a projection over the
 * REAL mission context — it never invents eligibility and never reports a
 * control as available when the underlying command could not succeed.
 *
 * The CLI reaches the same capability through `/pause` and `/resume`; this is
 * the website's projection of the same eligibility rules. Presentation is not
 * shared between the surfaces — the SEMANTICS are.
 *
 * No React, no clock, no network. The caller supplies the mission context.
 */

import type {
  CommandTaskContext,
  RelayMissionCommandContext,
} from '../../mission/commands';

/** The canonical intents. Never `suspend`, `freeze` or `unpause`. */
export type MissionRunIntent = 'pause' | 'resume';

/** A control the surface may render. */
export interface MissionRunControl {
  intent: MissionRunIntent;
  /** User-facing label. Internal semantics stay `pause` / `resume`. */
  label: string;
  visible: boolean;
  enabled: boolean;
  /** Truthful pending label while a command is in flight. */
  pending: boolean;
  pendingLabel: string;
  /**
   * Why the control is unavailable. Rendered as an accessible explanation —
   * never a clickable dead control with no reason.
   */
  disabledReason: string | null;
  /** The tasks the intent would target, resolved from real state. */
  targetTaskIds: string[];
}

export interface MissionRunControls {
  pause: MissionRunControl;
  resume: MissionRunControl;
  /** True once the mission can no longer pause or resume at all. */
  terminal: boolean;
}

/** A command already in flight for this mission. */
export type MissionRunPending = MissionRunIntent | null;

const TERMINAL_EXECUTION = ['completed', 'failed', 'cancelled'] as const;

/** Tasks that are actually running — the only pausable ones. */
export function pausableTasks(context: RelayMissionCommandContext): CommandTaskContext[] {
  return context.tasks.filter((task) => task.status.executionStatus === 'running');
}

/**
 * Tasks that are genuinely resumable: waiting, and still attached to a run
 * that has not reached a terminal state. A waiting task whose run completed,
 * failed, was cancelled, timed out or was orphaned needs retry or
 * reassignment — never resume — so it is deliberately NOT resumable here.
 *
 * `capsuleStatuses` lets a caller supply Milestone 3 Execution Capsule states
 * (which carry `timed_out` and `orphaned`, states the run vocabulary does not
 * express). A terminal capsule blocks resume even when the run record still
 * looks waiting, because a terminal capsule never returns to running.
 */
export function resumableTasks(
  context: RelayMissionCommandContext,
  capsuleStatuses: Readonly<Record<string, string>> = {},
): CommandTaskContext[] {
  return context.tasks.filter((task) => {
    if (task.status.executionStatus !== 'waiting') return false;
    const run = latestRunForTask(context, task.taskId);
    if (!run) return false;
    if (isTerminalRunState(run.state)) return false;
    const capsule = capsuleStatuses[run.runId];
    return !(capsule !== undefined && isTerminalRunState(capsule));
  });
}

export function latestRunForTask(
  context: RelayMissionCommandContext,
  taskId: string,
): RelayMissionCommandContext['agentRuns'][number] | undefined {
  const runs = context.agentRuns.filter((run) => run.taskId === taskId);
  return runs[runs.length - 1];
}

/**
 * A run (or its capsule) that can never be resumed. `timed_out` and
 * `orphaned` are included explicitly: they look paused from the outside but
 * require intervention. `retry_requested` is terminal for RESUME too — a
 * retry is a NEW run, never a revived one.
 */
export function isTerminalRunState(state: string): boolean {
  return ['completed', 'failed', 'cancelled', 'timed_out', 'orphaned', 'retry_requested']
    .includes(state);
}

/** The mission itself has stopped — no run control applies any more. */
export function missionIsTerminal(context: RelayMissionCommandContext): boolean {
  return (TERMINAL_EXECUTION as readonly string[])
    .includes(context.mission.status.executionStatus);
}

function control(
  intent: MissionRunIntent,
  input: {
    visible: boolean;
    enabled: boolean;
    pending: boolean;
    disabledReason: string | null;
    targetTaskIds: string[];
  },
): MissionRunControl {
  return {
    intent,
    label: intent === 'pause' ? 'PAUSE' : 'RESUME',
    pendingLabel: intent === 'pause' ? 'PAUSING' : 'RESUMING',
    ...input,
  };
}

/**
 * Project the run controls for a mission.
 *
 * Rules:
 *   running / eligible active   PAUSE visible, RESUME hidden
 *   pause in flight             PAUSE disabled + PAUSING, duplicates blocked
 *   waiting / paused            RESUME visible, PAUSE hidden
 *   resume in flight            RESUME disabled + RESUMING, duplicates blocked
 *   terminal mission            both hidden
 *   not eligible                hidden, or disabled with an exact reason
 */
export function projectMissionRunControls(input: {
  context: RelayMissionCommandContext;
  pending?: MissionRunPending;
  /** False when the actor may not issue mission commands here. */
  canIssueCommands?: boolean;
  /** Milestone 3 capsule status by runId, when the surface has it. */
  capsuleStatuses?: Readonly<Record<string, string>>;
}): MissionRunControls {
  const { context } = input;
  const pending = input.pending ?? null;
  const canIssue = input.canIssueCommands !== false;
  const terminal = missionIsTerminal(context);

  const pausable = pausableTasks(context);
  const resumable = resumableTasks(context, input.capsuleStatuses ?? {});

  if (terminal) {
    const reason = `The mission is ${context.mission.status.executionStatus} — run controls no longer apply.`;
    return {
      terminal,
      pause: control('pause', {
        visible: false, enabled: false, pending: false,
        disabledReason: reason, targetTaskIds: [],
      }),
      resume: control('resume', {
        visible: false, enabled: false, pending: false,
        disabledReason: reason, targetTaskIds: [],
      }),
    };
  }

  const permissionReason = canIssue
    ? null
    : 'You do not have permission to issue mission commands for this mission.';

  const pausePending = pending === 'pause';
  const resumePending = pending === 'resume';

  const pauseVisible = pausable.length > 0;
  const resumeVisible = !pauseVisible && resumable.length > 0;

  const pauseDisabledReason = !canIssue
    ? permissionReason
    : pausePending
      ? 'A pause command is already in flight.'
      : pending !== null
        ? 'Another mission command is already in flight.'
        : pausable.length === 0
          ? 'No task is running, so there is nothing to pause.'
          : null;

  const resumeDisabledReason = !canIssue
    ? permissionReason
    : resumePending
      ? 'A resume command is already in flight.'
      : pending !== null
        ? 'Another mission command is already in flight.'
        : resumable.length === 0
          ? waitingButUnresumableReason(context, input.capsuleStatuses ?? {})
          : null;

  return {
    terminal,
    pause: control('pause', {
      visible: pauseVisible,
      enabled: pauseVisible && pauseDisabledReason === null,
      pending: pausePending,
      disabledReason: pauseDisabledReason,
      targetTaskIds: pausable.map((t) => t.taskId),
    }),
    resume: control('resume', {
      visible: resumeVisible,
      enabled: resumeVisible && resumeDisabledReason === null,
      pending: resumePending,
      disabledReason: resumeDisabledReason,
      targetTaskIds: resumable.map((t) => t.taskId),
    }),
  };
}

/**
 * A waiting task whose run is terminal is a real, common situation. Say so
 * exactly rather than showing a dead RESUME the user cannot use.
 */
function waitingButUnresumableReason(
  context: RelayMissionCommandContext,
  capsuleStatuses: Readonly<Record<string, string>>,
): string {
  const waiting = context.tasks.filter((t) => t.status.executionStatus === 'waiting');
  if (waiting.length === 0) return 'No task is waiting, so there is nothing to resume.';
  for (const task of waiting) {
    const run = latestRunForTask(context, task.taskId);
    if (!run) {
      return 'The waiting task has no run to resume — start or reassign it instead.';
    }
    const capsule = capsuleStatuses[run.runId];
    const blocking = isTerminalRunState(run.state)
      ? run.state
      : capsule !== undefined && isTerminalRunState(capsule)
        ? capsule
        : null;
    if (blocking !== null) {
      return `The run for the waiting task is ${blocking} and cannot resume — retry or reassign it instead.`;
    }
  }
  return 'No task is waiting, so there is nothing to resume.';
}
