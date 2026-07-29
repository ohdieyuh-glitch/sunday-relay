/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 2
 * Checkpoint-before-intervention calculation (PURE).
 *
 * Commands that interrupt active work (pause / cancel / redirect / reassign /
 * a compound stop) must first capture what would otherwise be lost. This
 * module CALCULATES the requirement from deterministic domain records — it
 * never checkpoints real files or touches real processes. A required
 * checkpoint becomes a prerequisite the executor enforces before any state
 * change applies.
 */

import type {
  CommandAgentRunContext,
  RelayMissionCommandContext,
} from './command-context';
import { findActiveRunForTask } from './command-context';
import type {
  RelayCommandCheckpointCapture,
  RelayCommandCheckpointRequirement,
  RelayMissionCommandDraft,
  RelayMissionCommandIntent,
} from './command-types';

const INTERVENTION_INTENTS: readonly RelayMissionCommandIntent[] = [
  'pause',
  'cancel',
  'redirect',
  'reassign',
];

function capturesForRun(
  run: CommandAgentRunContext,
  hasWorkspace: boolean,
): { captures: RelayCommandCheckpointCapture[]; reasons: string[] } {
  const captures: RelayCommandCheckpointCapture[] = [];
  const reasons: string[] = [];
  const w = run.partialWork;
  if (w.changedFiles.length > 0) {
    captures.push('partial_output', 'changed_files');
    reasons.push(`${w.changedFiles.length} changed file(s) would be lost`);
  }
  if (w.commandsRun > 0) {
    captures.push('commands');
    reasons.push(`${w.commandsRun} command(s) already ran`);
  }
  if (w.testsRun > 0) {
    captures.push('tests');
    reasons.push(`${w.testsRun} test run(s) already recorded`);
  }
  if (w.knownErrors.length > 0) {
    captures.push('errors');
    reasons.push(`${w.knownErrors.length} known error(s) must be preserved`);
  }
  if (w.findingIds.length > 0) {
    captures.push('findings');
    reasons.push(`${w.findingIds.length} confirmed partial finding(s) must be preserved`);
  }
  if (run.childProcessRefs.length > 0) {
    captures.push('processes');
    reasons.push(`${run.childProcessRefs.length} child process reference(s) recorded`);
  }
  if (hasWorkspace && captures.length > 0) {
    captures.push('workspace_state');
    reasons.push('the workspace state must be captured before interruption');
  }
  if (w.costConsumedUsd > 0) {
    captures.push('cost');
    reasons.push(`$${w.costConsumedUsd.toFixed(2)} already consumed must be accounted`);
  }
  if (w.unresolvedQuestions.length > 0) {
    captures.push('unresolved_questions');
    reasons.push(`${w.unresolvedQuestions.length} unresolved question(s) must be preserved`);
  }
  return { captures, reasons };
}

/**
 * One requirement per targeted task with an active run. A run with NO partial
 * work and no child processes needs no checkpoint (`not_required`). A run
 * whose checkpoint is already satisfied reports `satisfied`; a failed
 * checkpoint reports `failed` — execution never proceeds past `required` or
 * `failed`.
 */
export function calculateCheckpointRequirements(
  draft: Pick<RelayMissionCommandDraft, 'intent' | 'secondaryIntents' | 'targetTaskIds'>,
  context: RelayMissionCommandContext,
): RelayCommandCheckpointRequirement[] {
  const intents = [draft.intent, ...draft.secondaryIntents];
  if (!intents.some((i) => INTERVENTION_INTENTS.includes(i))) return [];

  const requirements: RelayCommandCheckpointRequirement[] = [];
  for (const taskId of draft.targetTaskIds) {
    const run = findActiveRunForTask(context, taskId);
    if (!run) continue;
    const task = context.tasks.find((t) => t.taskId === taskId);
    const { captures, reasons } = capturesForRun(run, Boolean(task?.workspaceId));
    const required = captures.length > 0;
    requirements.push({
      required,
      taskId,
      runId: run.runId,
      reasons: required ? reasons : ['no partial work recorded — nothing to capture'],
      requiredCapture: captures,
      status: !required
        ? 'not_required'
        : run.checkpointStatus === 'satisfied'
          ? 'satisfied'
          : run.checkpointStatus === 'failed'
            ? 'failed'
            : 'required',
    });
  }
  return requirements;
}
