/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 2
 * Permission compatibility (PURE, domain records only).
 *
 * Validates replacement-agent permissions against what a task actually
 * requires and classifies permission CHANGES (expansion vs narrowing,
 * production access, security weakening). Never touches real operating-system
 * permissions — these are typed compatibility records.
 */

import type {
  CommandPermissionContext,
  CommandTaskContext,
  RelayMissionCommandContext,
} from './command-context';
import { findAgent, findTask, findWorkspace } from './command-context';
import { commandError, type RelayMissionCommandError } from './command-errors';
import type { RelayMissionCommandDraft } from './command-types';

export interface PermissionAssessment {
  compatible: boolean;
  errors: RelayMissionCommandError[];
  /** Any permission change is present in the command. */
  permissionChangeDetected: boolean;
  /** The change EXPANDS authority (never a narrowing). */
  permissionExpansionRequested: boolean;
  productionExpansionRequested: boolean;
  securityWeakeningRequested: boolean;
  reasons: string[];
}

/** '*' covers everything; otherwise simple prefix coverage ('src/' covers
    'src/auth/session.ts'). Deterministic — no globbing engine. */
function pathCovered(permitted: string[], required: string): boolean {
  return permitted.some((p) => p === '*' || required === p || required.startsWith(p));
}

function permissionsCoverTask(
  permissions: CommandPermissionContext,
  task: CommandTaskContext,
  context: RelayMissionCommandContext,
  needsWrite: boolean,
): string[] {
  const problems: string[] = [];
  const workspace = task.workspaceId ? findWorkspace(context, task.workspaceId) : undefined;
  const requiredReadable = workspace?.readablePaths ?? [];
  const requiredWritable = needsWrite ? (workspace?.writablePaths ?? []) : [];

  for (const path of requiredReadable) {
    if (!pathCovered(permissions.readablePaths, path)) {
      problems.push(`missing read permission for ${path}`);
    }
  }
  for (const path of requiredWritable) {
    if (!pathCovered(permissions.writablePaths, path)) {
      problems.push(`missing write permission for ${path}`);
    }
  }
  if (needsWrite && permissions.writablePaths.length === 0) {
    problems.push('the agent holds no write permissions at all (read-only)');
  }
  if (task.touchesProduction && !permissions.productionAccess) {
    problems.push('the task touches production but the agent has no production access');
  }
  return problems;
}

const WRITE_RESPONSIBILITIES: readonly CommandTaskContext['responsibility'][] = [
  'implementation',
  'repair',
  'operations',
];

export function evaluatePermissionCompatibility(
  draft: Pick<RelayMissionCommandDraft, 'interpretedChanges'>,
  context: RelayMissionCommandContext,
): PermissionAssessment {
  const errors: RelayMissionCommandError[] = [];
  const reasons: string[] = [];
  let permissionChangeDetected = false;
  let permissionExpansionRequested = false;
  let productionExpansionRequested = false;
  let securityWeakeningRequested = false;

  for (const change of draft.interpretedChanges) {
    /* ------- ownership changes: does the new owner qualify? ------- */
    if (change.entityType === 'task' && change.requestedState.startsWith('owner:')) {
      const task = findTask(context, change.entityId);
      const newOwnerId = change.requestedState.slice('owner:'.length);
      const agent = findAgent(context, newOwnerId);
      if (!task || !agent) continue; // existence is validated by the pipeline
      const permissions = agent.passport.permissions;

      if (permissions.revoked) {
        errors.push(
          commandError(
            'PERMISSION_INCOMPATIBLE',
            `${agent.agentId} permissions are revoked`,
            'restore or re-issue the agent permissions before reassigning',
            { entityType: 'permission', entityId: agent.agentId, actual: 'revoked', expected: 'active' },
          ),
        );
        continue;
      }
      if (
        permissions.expiresAt !== null &&
        permissions.expiresAt <= context.mission.evaluationTime
      ) {
        errors.push(
          commandError(
            'PERMISSION_INCOMPATIBLE',
            `${agent.agentId} permissions expired at ${permissions.expiresAt}`,
            'renew the agent permissions before reassigning',
            {
              entityType: 'permission',
              entityId: agent.agentId,
              expected: `valid after ${context.mission.evaluationTime}`,
              actual: `expired ${permissions.expiresAt}`,
            },
          ),
        );
        continue;
      }
      if (!agent.passport.compatibleResponsibilities.includes(task.responsibility)) {
        errors.push(
          commandError(
            'PERMISSION_INCOMPATIBLE',
            `${agent.agentId} passport does not cover the "${task.responsibility}" responsibility`,
            'choose an agent whose passport covers this responsibility',
            {
              entityType: 'permission',
              entityId: agent.agentId,
              expected: task.responsibility,
              actual: agent.passport.compatibleResponsibilities.join(',') || 'none',
            },
          ),
        );
      }
      const needsWrite = WRITE_RESPONSIBILITIES.includes(task.responsibility);
      for (const problem of permissionsCoverTask(permissions, task, context, needsWrite)) {
        errors.push(
          commandError(
            'PERMISSION_INCOMPATIBLE',
            `${agent.agentId}: ${problem}`,
            'grant the missing permission explicitly or choose a compatible agent',
            { entityType: 'permission', entityId: agent.agentId },
          ),
        );
      }
      // A repair assignment NEVER carries release authority with it.
      if (task.responsibility === 'repair') {
        reasons.push(
          `${agent.agentId} receives repair implementation only — no release authority travels with a repair assignment`,
        );
      }
    }

    /* -------------- explicit permission-state changes -------------- */
    if (change.entityType === 'permission') {
      permissionChangeDetected = true;
      const agent = findAgent(context, change.entityId);
      if (agent?.passport.permissions.revoked) {
        errors.push(
          commandError(
            'PERMISSION_INCOMPATIBLE',
            `${change.entityId} permissions are revoked — nothing may be changed on a revoked grant`,
            're-issue the permission grant through the founder before amending it',
            { entityType: 'permission', entityId: change.entityId, actual: 'revoked' },
          ),
        );
      }
      if (change.requestedState === 'production_writes:allowed') {
        if (change.previousState !== 'production_writes:allowed') {
          permissionExpansionRequested = true;
          productionExpansionRequested = true;
          reasons.push('production write access is an expansion of authority');
        }
      } else if (change.requestedState === 'production_writes:prohibited') {
        reasons.push('production write prohibition is a narrowing — no expansion');
      } else if (change.requestedState.startsWith('network:')) {
        const previous = change.previousState.split(':')[1] ?? 'none';
        const requested = change.requestedState.split(':')[1] ?? 'none';
        const order = ['none', 'restricted', 'full'];
        if (order.indexOf(requested) > order.indexOf(previous)) {
          permissionExpansionRequested = true;
          securityWeakeningRequested = true;
          reasons.push(`network policy widens from ${previous} to ${requested}`);
        }
      } else if (change.requestedState.startsWith('secrets:')) {
        securityWeakeningRequested = true;
        permissionExpansionRequested = true;
        reasons.push('secret policy changes are always security-relevant');
      }
    }
  }

  return {
    compatible: errors.length === 0,
    errors,
    permissionChangeDetected,
    permissionExpansionRequested,
    productionExpansionRequested,
    securityWeakeningRequested,
    reasons,
  };
}
