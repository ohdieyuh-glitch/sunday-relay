/**
 * SUNDAY RELAY — WEBSITE MISSION PAUSE / RESUME (command path, PURE).
 *
 * The website's PAUSE and RESUME controls go through the SAME validated
 * Mission Command Protocol (Milestone 2) as every other mission command:
 *
 *   interpret (deterministic) → validate (24-step pipeline) → preview →
 *   prerequisites (checkpoint / approval) → ATOMIC execution → ordered events
 *
 * Nothing here mutates mission state. Not one line applies a status: the
 * executor owns that, atomically, after re-confirming revisions at apply time.
 * A button may therefore never fabricate a pause, skip a checkpoint, bypass a
 * stale-revision check, or invent a resume.
 *
 * The CLI reaches the same capability through `/pause` and `/resume` → Relay
 * Core `pause-run` / `resume-run`. The SEMANTICS are shared; the presentation
 * is not.
 *
 * PHYSICAL PROCESS SUSPENSION IS NOT CLAIMED. Relay pauses its own assignment
 * and execution state; it does not send a signal to an external agent process
 * and does not report one as suspended. `assignmentOnly` states that limit
 * explicitly rather than implying more than Relay actually did.
 *
 * No React, no clock, no network — ids and timestamps are injected.
 */

import {
  executeMissionCommand,
  resolveCommandPrerequisite,
  submitMissionCommand,
  type InMemoryMissionCommandRepository,
  type InMemoryMissionContextStore,
  type RelayCommandPrerequisite,
  type RelayMissionCommand,
  type RelayMissionCommandError,
  type RelayMissionCommandInterpreter,
  type RelayMissionCommandPreview,
} from '../../mission/commands';
import {
  pausableTasks,
  resumableTasks,
  type MissionRunIntent,
} from './mission-run-controls';

/* ------------------------------ dependencies ---------------------------- */

export interface MissionRunCommandDeps {
  interpreter: RelayMissionCommandInterpreter;
  repository: InMemoryMissionCommandRepository;
  contextStore: InMemoryMissionContextStore;
  /** Injected clock — this module never reads one. */
  now: () => string;
  /** Injected id factory — deterministic in tests. */
  requestId: () => string;
  actorUserId: string;
  projectId: string;
  missionId: string;
}

/* -------------------------------- results ------------------------------- */

export type MissionRunCommandResult =
  | {
      kind: 'executed';
      intent: MissionRunIntent;
      command: RelayMissionCommand;
      preview: RelayMissionCommandPreview;
      appliedChangeIds: string[];
      duplicate: boolean;
      /** Relay paused/resumed its OWN assignment — never an OS process. */
      assignmentOnly: true;
    }
  | {
      kind: 'checkpoint_required';
      intent: MissionRunIntent;
      command: RelayMissionCommand;
      preview: RelayMissionCommandPreview;
      /** Unsatisfied prerequisites — execution has NOT run. */
      prerequisites: RelayCommandPrerequisite[];
    }
  | {
      kind: 'rejected';
      intent: MissionRunIntent;
      errors: RelayMissionCommandError[];
      command?: RelayMissionCommand;
      preview?: RelayMissionCommandPreview;
    }
  | {
      /** Validated and previewed; the user has not confirmed yet. Nothing
       *  has been applied and nothing will be until `confirm` is called. */
      kind: 'confirmation_required';
      intent: MissionRunIntent;
      command: RelayMissionCommand;
      preview: RelayMissionCommandPreview;
    }
  | {
      kind: 'clarification_required';
      intent: MissionRunIntent;
      reason: string;
      missingInformation: string[];
    }
  | {
      kind: 'unavailable';
      intent: MissionRunIntent;
      /** Safe, exact reason. Never a stack trace, never a raw provider string. */
      reason: string;
    };

/* ------------------------------ command text ---------------------------- */

/**
 * The deterministic interpreter's canonical phrasing. The website never sends
 * free user prose here: it names exactly what the projection already resolved,
 * so interpretation cannot drift from what the control offered.
 */
export function missionRunCommandText(
  intent: MissionRunIntent,
  targetTaskIds: readonly string[],
): string {
  if (intent === 'pause') {
    return targetTaskIds.length === 1 ? `pause ${targetTaskIds[0]}` : 'pause mission';
  }
  return targetTaskIds.length === 1 ? `resume ${targetTaskIds[0]}` : 'resume mission';
}

/* -------------------------------- submit -------------------------------- */

/**
 * Submit a pause or resume, and execute it when nothing is outstanding.
 *
 * The targets come from the SAME projection the control used, so the command
 * always describes what the user actually saw. Everything after that belongs
 * to the domain.
 */
export function requestMissionRunCommand(
  intent: MissionRunIntent,
  deps: MissionRunCommandDeps,
  options: { stopForConfirmation?: boolean } = {},
): MissionRunCommandResult {
  const context = deps.contextStore.get(deps.missionId);
  if (!context) {
    return {
      kind: 'unavailable',
      intent,
      reason: 'The mission is not loaded, so no command can be issued for it.',
    };
  }

  const targets = intent === 'pause'
    ? pausableTasks(context).map((t) => t.taskId)
    : resumableTasks(context).map((t) => t.taskId);

  if (targets.length === 0) {
    return {
      kind: 'unavailable',
      intent,
      reason: intent === 'pause'
        ? 'No task is running, so there is nothing to pause.'
        : 'No task is waiting on a resumable run, so there is nothing to resume.',
    };
  }

  const requestId = deps.requestId();
  const issuedAt = deps.now();

  const submitted = submitMissionCommand({
    request: {
      requestId,
      projectId: deps.projectId,
      missionId: deps.missionId,
      issuedByUserId: deps.actorUserId,
      issuedAt,
      text: missionRunCommandText(intent, targets),
    },
    interpreter: deps.interpreter,
    context,
    repository: deps.repository,
    commandId: requestId,
  });

  switch (submitted.kind) {
    case 'clarification_required':
      return {
        kind: 'clarification_required',
        intent,
        reason: submitted.reason,
        missingInformation: [...submitted.missingInformation],
      };
    case 'interpretation_rejected':
      return { kind: 'unavailable', intent, reason: submitted.reason };
    case 'duplicate':
      return { kind: 'rejected', intent, errors: [submitted.error] };
    case 'rejected':
      return {
        kind: 'rejected',
        intent,
        errors: [...submitted.errors],
        command: submitted.command,
        ...(submitted.preview ? { preview: submitted.preview } : {}),
      };
    default:
      break;
  }

  // Validated. Outstanding prerequisites STOP here — nothing is applied.
  const outstanding = submitted.prerequisites.filter(
    (prerequisite) => prerequisite.status !== 'satisfied',
  );
  if (outstanding.length > 0) {
    return {
      kind: 'checkpoint_required',
      intent,
      command: submitted.command,
      preview: submitted.preview,
      prerequisites: outstanding,
    };
  }

  /* The preview belongs to the user BEFORE anything is applied. When the
     surface asks to confirm — or when the domain itself says the command is
     only ready_for_confirmation — stop here and hand back the projection. */
  if (options.stopForConfirmation === true
    || submitted.preview.status === 'ready_for_confirmation') {
    return {
      kind: 'confirmation_required',
      intent,
      command: submitted.command,
      preview: submitted.preview,
    };
  }

  return executeValidatedRunCommand(intent, submitted.command, submitted.preview, deps);
}

/**
 * Execute a command the user has now confirmed. Outstanding prerequisites are
 * re-checked first, so confirming can never skip a checkpoint.
 */
export function confirmMissionRunCommand(
  input: {
    intent: MissionRunIntent;
    commandId: string;
    preview: RelayMissionCommandPreview;
  },
  deps: MissionRunCommandDeps,
): MissionRunCommandResult {
  const command = deps.repository.getCommand(input.commandId);
  if (!command) {
    return {
      kind: 'unavailable',
      intent: input.intent,
      reason: 'The command is no longer available to execute.',
    };
  }
  const outstanding = deps.repository
    .getPrerequisites(input.commandId)
    .filter((prerequisite) => prerequisite.status !== 'satisfied');
  if (outstanding.length > 0) {
    return {
      kind: 'checkpoint_required',
      intent: input.intent,
      command,
      preview: input.preview,
      prerequisites: outstanding,
    };
  }
  return executeValidatedRunCommand(input.intent, command, input.preview, deps);
}

/* ------------------------------ checkpoint ------------------------------ */

/**
 * Record a checkpoint (or approval) outcome and, once nothing is outstanding,
 * execute. A FAILED prerequisite leaves mission state untouched — the command
 * simply does not execute, and the failure is reported.
 */
export function resolveMissionRunPrerequisite(
  input: {
    intent: MissionRunIntent;
    commandId: string;
    prerequisiteId: string;
    outcome: 'satisfied' | 'failed';
    detail?: string;
    preview: RelayMissionCommandPreview;
  },
  deps: MissionRunCommandDeps,
): MissionRunCommandResult {
  const resolved = resolveCommandPrerequisite({
    commandId: input.commandId,
    prerequisiteId: input.prerequisiteId,
    outcome: input.outcome,
    ...(input.detail === undefined ? {} : { detail: input.detail }),
    repository: deps.repository,
    actorId: deps.actorUserId,
    occurredAt: deps.now(),
  });
  if (!resolved.ok) {
    return { kind: 'rejected', intent: input.intent, errors: [resolved.error] };
  }

  const command = deps.repository.getCommand(input.commandId);
  if (!command) {
    return {
      kind: 'unavailable',
      intent: input.intent,
      reason: 'The command is no longer available to execute.',
    };
  }

  const outstanding = deps.repository
    .getPrerequisites(input.commandId)
    .filter((prerequisite) => prerequisite.status !== 'satisfied');
  if (outstanding.length > 0) {
    return {
      kind: 'checkpoint_required',
      intent: input.intent,
      command,
      preview: input.preview,
      prerequisites: outstanding,
    };
  }

  return executeValidatedRunCommand(input.intent, command, input.preview, deps);
}

/* -------------------------------- execute ------------------------------- */

function executeValidatedRunCommand(
  intent: MissionRunIntent,
  command: RelayMissionCommand,
  preview: RelayMissionCommandPreview,
  deps: MissionRunCommandDeps,
): MissionRunCommandResult {
  const executed = executeMissionCommand({
    commandId: command.commandId,
    repository: deps.repository,
    contextStore: deps.contextStore,
    actorId: deps.actorUserId,
    occurredAt: deps.now(),
  });

  if (!executed.ok) {
    return {
      kind: 'rejected',
      intent,
      errors: [...executed.errors],
      ...(executed.command ? { command: executed.command } : {}),
      preview,
    };
  }

  return {
    kind: 'executed',
    intent,
    command: executed.command,
    preview,
    appliedChangeIds: [...executed.appliedChangeIds],
    duplicate: executed.duplicate,
    assignmentOnly: true,
  };
}

/* ------------------------------- messaging ------------------------------ */

/**
 * The exact, safe limitation shown beside a successful pause. Relay stopped
 * assigning and moved execution to waiting; it did NOT suspend an external
 * agent process, and it does not claim to have.
 */
export const PAUSE_ASSIGNMENT_ONLY_NOTE =
  'Relay paused its own assignment and moved execution to waiting. '
  + 'An external agent process is not suspended by Relay and is not reported as suspended.';

export const RESUME_ASSIGNMENT_ONLY_NOTE =
  'Relay resumed the same run and returned execution to running. '
  + 'Prior partial work is preserved; nothing was retried or reassigned.';

/**
 * A safe, human sentence for a structured command failure. Uses the domain's
 * own message and remediation — never a generic "something went wrong", never
 * a stack trace, never raw provider output.
 */
export function describeRunCommandErrors(errors: readonly RelayMissionCommandError[]): string {
  if (errors.length === 0) return 'The command did not complete.';
  const first = errors[0];
  return first.safeNextAction ? `${first.reason} — ${first.safeNextAction}` : first.reason;
}
