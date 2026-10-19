/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 2
 * Workspace compatibility (PURE, domain records only).
 *
 * One active write owner per workspace, no silent inheritance, no CLI/browser
 * worktree confusion, isolation preserved. A workspace ownership transfer is
 * always an EXPLICIT state change — when a reassignment implies one, this
 * module produces the change so the executor applies it visibly or not at
 * all. No live worktree is ever transferred in this milestone.
 */

import type { RelayMissionCommandContext } from './command-context';
import { findAgent, findTask, findWorkspace, isActiveRunState } from './command-context';
import { commandError, type RelayMissionCommandError } from './command-errors';
import type { RelayMissionCommandDraft, RelayStateChange } from './command-types';

export interface WorkspaceAssessment {
  compatible: boolean;
  errors: RelayMissionCommandError[];
  /** Explicit ownership changes a reassignment REQUIRES (appended to the
      command's interpreted changes by the validator — never applied
      implicitly). */
  requiredOwnershipChanges: RelayStateChange[];
  ownershipTransferDetected: boolean;
  affectedWorkspaceIds: string[];
  reasons: string[];
}

export function evaluateWorkspaceCompatibility(
  draft: Pick<RelayMissionCommandDraft, 'interpretedChanges'>,
  context: RelayMissionCommandContext,
): WorkspaceAssessment {
  const errors: RelayMissionCommandError[] = [];
  const requiredOwnershipChanges: RelayStateChange[] = [];
  const affectedWorkspaceIds: string[] = [];
  const reasons: string[] = [];
  let ownershipTransferDetected = false;

  /* Runs this same command cancels — their write ownership is being released,
     so a transfer to a replacement does not create CONCURRENT ownership. */
  const cancelledRunIds = new Set(
    draft.interpretedChanges
      .filter((c) => c.entityType === 'agent_run' && c.requestedState === 'cancelled')
      .map((c) => c.entityId),
  );
  const cancelledTaskIds = new Set(
    draft.interpretedChanges
      .filter(
        (c) =>
          c.entityType === 'task' &&
          c.statusDimension === 'execution' &&
          c.requestedState === 'cancelled',
      )
      .map((c) => c.entityId),
  );

  for (const change of draft.interpretedChanges) {
    if (change.entityType === 'workspace') {
      ownershipTransferDetected = true;
      affectedWorkspaceIds.push(change.entityId);
      continue;
    }
    if (change.entityType !== 'task' || !change.requestedState.startsWith('owner:')) continue;

    const task = findTask(context, change.entityId);
    const newOwnerId = change.requestedState.slice('owner:'.length);
    const newOwner = findAgent(context, newOwnerId);
    if (!task || !newOwner) continue; // existence is validated by the pipeline
    if (!task.workspaceId) continue;
    const workspace = findWorkspace(context, task.workspaceId);
    if (!workspace) {
      errors.push(
        commandError(
          'WORKSPACE_INCOMPATIBLE',
          `task ${task.taskId} references workspace ${task.workspaceId} which is not in the mission context`,
          'load the workspace record before reassigning this task',
          { entityType: 'workspace', entityId: task.workspaceId },
        ),
      );
      continue;
    }
    affectedWorkspaceIds.push(workspace.workspaceId);

    /* The browser worktree and the CLI worktree must never be confused: an
       agent whose writable paths live in one kind cannot inherit the other
       implicitly — Milestone 2 rejects cross-kind inheritance outright. */
    const agentWorkspaceKinds = context.workspaces
      .filter((w) => w.writeOwnerAgentId === newOwner.agentId)
      .map((w) => w.kind);
    if (agentWorkspaceKinds.length > 0 && !agentWorkspaceKinds.includes(workspace.kind)) {
      errors.push(
        commandError(
          'WORKSPACE_INCOMPATIBLE',
          `${newOwner.agentId} currently owns a ${agentWorkspaceKinds[0]} — it cannot silently inherit the ${workspace.kind} ${workspace.workspaceId}`,
          'open a compatible workspace explicitly instead of inheriting across worktree kinds',
          {
            entityType: 'workspace',
            entityId: workspace.workspaceId,
            expected: agentWorkspaceKinds[0],
            actual: workspace.kind,
          },
        ),
      );
      continue;
    }

    const currentOwnerId = workspace.writeOwnerAgentId;
    if (currentOwnerId && currentOwnerId !== newOwner.agentId) {
      /* Is the current owner still actively writing? Concurrent write
         ownership is rejected unless this command releases it. */
      const ownerStillActive = context.agentRuns.some(
        (r) =>
          r.actualAgentId === currentOwnerId &&
          r.taskId !== undefined &&
          isActiveRunState(r.state) &&
          !cancelledRunIds.has(r.runId) &&
          !cancelledTaskIds.has(r.taskId),
      );
      if (ownerStillActive && !workspace.allowsParallelWriters) {
        errors.push(
          commandError(
            'WORKSPACE_INCOMPATIBLE',
            `${workspace.workspaceId} write ownership is held by ${currentOwnerId}, whose run is still active — reassignment would create concurrent write ownership`,
            'stop or checkpoint the current owner first, or target a different workspace',
            {
              entityType: 'workspace',
              entityId: workspace.workspaceId,
              expected: 'a released write owner',
              actual: `active owner ${currentOwnerId}`,
            },
          ),
        );
        continue;
      }
    }

    if (currentOwnerId !== newOwner.agentId) {
      ownershipTransferDetected = true;
      const alreadyExplicit = draft.interpretedChanges.some(
        (c) =>
          c.entityType === 'workspace' &&
          c.entityId === workspace.workspaceId &&
          c.requestedState === `write_owner:${newOwner.agentId}`,
      );
      if (!alreadyExplicit) {
        requiredOwnershipChanges.push({
          changeId: `${change.changeId}-ws`,
          entityType: 'workspace',
          entityId: workspace.workspaceId,
          previousState: `write_owner:${currentOwnerId ?? 'none'}`,
          requestedState: `write_owner:${newOwner.agentId}`,
          reason: `workspace write ownership transfers explicitly with the ${task.taskId} reassignment`,
        });
      }
      reasons.push(
        `${workspace.workspaceId} write ownership transfers from ${currentOwnerId ?? 'none'} to ${newOwner.agentId} (isolation mode ${workspace.isolationMode} is preserved)`,
      );
    }
  }

  return {
    compatible: errors.length === 0,
    errors,
    requiredOwnershipChanges,
    ownershipTransferDetected,
    affectedWorkspaceIds: [...new Set(affectedWorkspaceIds)],
    reasons,
  };
}
