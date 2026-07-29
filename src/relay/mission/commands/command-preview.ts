/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 2
 * Command preview — a PURE projection of typed command information.
 *
 * The preview explains what Relay WILL do, what Relay WILL NOT do, what is
 * affected, the risk, and whether a human must confirm — derived entirely
 * from the validated (or rejected) command, its prerequisites, and the
 * validator's analyses. Nothing here is hardcoded to one scenario and
 * nothing here mutates state. The full Mission Operations interface
 * (Milestone 6) renders this projection.
 */

import type { RelayMissionCommandContext } from './command-context';
import { findTask } from './command-context';
import type { RelayMissionCommandError } from './command-errors';
import type {
  RelayCommandPrerequisite,
  RelayMissionCommand,
  RelayMissionCommandRisk,
} from './command-types';

export interface RelayMissionCommandPreview {
  requestedCommand: string;
  interpretation: string;
  relayWill: string[];
  relayWillNot: string[];
  affectedEntities: string[];
  risk: RelayMissionCommandRisk;
  approval: 'required' | 'not_required';
  status: 'ready_to_execute' | 'ready_for_confirmation' | 'rejected';
  independenceRisk: boolean;
  errors: RelayMissionCommandError[];
}

export interface CommandPreviewAnalyses {
  preservedFindingIds: string[];
  invalidatedReviewIds: string[];
  reReviewRequired: boolean;
  riskFactors: string[];
}

function describeIntent(command: RelayMissionCommand): string {
  const compound =
    command.secondaryIntents.length > 0
      ? ` (compound: ${[command.intent, ...command.secondaryIntents].join(' + ')})`
      : '';
  const targets = command.targetTaskIds.length > 0 ? ` targeting ${command.targetTaskIds.join(', ')}` : '';
  return `${command.intent}${compound}${targets}`;
}

export function projectCommandPreview(
  command: RelayMissionCommand,
  prerequisites: RelayCommandPrerequisite[],
  context: RelayMissionCommandContext,
  analyses: CommandPreviewAnalyses,
  errors: RelayMissionCommandError[] = [],
): RelayMissionCommandPreview {
  const relayWill: string[] = [];
  const relayWillNot: string[] = [];

  /* ------------------------------- WILL ------------------------------- */
  for (const p of prerequisites) {
    if (p.kind === 'checkpoint' && p.status !== 'satisfied') {
      relayWill.push(`checkpoint ${p.taskId ?? 'the active task'} before any interruption (${p.description})`);
    }
  }
  if (analyses.preservedFindingIds.length > 0) {
    relayWill.push(
      `preserve confirmed partial finding(s) ${analyses.preservedFindingIds.join(', ')}`,
    );
  }
  for (const change of command.interpretedChanges) {
    relayWill.push(
      `${change.entityType} ${change.entityId}: ${change.previousState} → ${change.requestedState} (${change.reason})`,
    );
  }
  if (analyses.reReviewRequired) {
    relayWill.push('preserve the independent re-review requirement for the current artifact');
  }

  /* ----------------------------- WILL NOT ----------------------------- */
  const verificationApproved = command.interpretedChanges.some(
    (c) => c.statusDimension === 'verification' && c.requestedState === 'approved',
  );
  const releaseTouched = command.interpretedChanges.some(
    (c) => c.statusDimension === 'release',
  );
  if (analyses.reReviewRequired || analyses.invalidatedReviewIds.length > 0) {
    const repairOwners = command.interpretedChanges
      .filter((c) => c.entityType === 'task' && c.requestedState.startsWith('owner:'))
      .map((c) => c.requestedState.slice('owner:'.length));
    for (const owner of repairOwners) {
      relayWillNot.push(`allow ${owner} to approve its own repair`);
    }
  }
  if (!verificationApproved) relayWillNot.push('mark verification complete');
  if (!releaseTouched) relayWillNot.push('mark release eligible');
  relayWillNot.push('merge changes', 'deploy');
  if (command.permissionChangeDetected) {
    relayWillNot.push('change any permission before explicit authorized approval');
  }

  /* ----------------------------- AFFECTED ----------------------------- */
  const affected = new Set<string>();
  for (const id of command.targetTaskIds) affected.add(id);
  for (const id of command.affectedDependencies) affected.add(id);
  for (const id of command.affectedWorkspaces) affected.add(id);
  for (const id of command.affectedReviews) affected.add(id);
  for (const id of command.affectedFindings) affected.add(id);
  for (const id of command.targetAgentIds) affected.add(id);
  for (const taskId of command.targetTaskIds) {
    const task = findTask(context, taskId);
    if (task?.workspaceId) affected.add(task.workspaceId);
  }

  const rejected = command.status === 'rejected' || errors.length > 0;
  const needsConfirmation =
    command.approvalRequired ||
    prerequisites.some((p) => p.status === 'pending');

  return {
    requestedCommand: command.naturalLanguageRequest,
    interpretation: describeIntent(command),
    relayWill: rejected ? [] : relayWill,
    relayWillNot,
    affectedEntities: [...affected],
    risk: command.risk,
    approval: command.approvalRequired ? 'required' : 'not_required',
    status: rejected ? 'rejected' : needsConfirmation ? 'ready_for_confirmation' : 'ready_to_execute',
    independenceRisk: command.independenceRiskDetected,
    errors,
  };
}
