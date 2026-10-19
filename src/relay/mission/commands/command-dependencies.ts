/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 2
 * Dependency protection (PURE) — no command may silently orphan a dependent.
 *
 * Pure functions over the task dependency lists in the command context; not a
 * graph database. Direct dependents are always identified; cancellation also
 * walks the transitive closure because invalidation cascades.
 */

import type { RelayMissionCommandContext } from './command-context';
import type { RelayMissionCommandDraft } from './command-types';

export interface DependencyImpact {
  /** Every dependent task id the command affects (deduplicated, ordered). */
  affectedDependencyIds: string[];
  /** Dependents blocked while a prerequisite pauses. */
  blockedDependents: string[];
  /** Dependents invalidated when a prerequisite is cancelled (transitive). */
  invalidatedDependents: string[];
  /** Consumers of output that a redirect would take away. */
  consumersOfRedirectedOutput: string[];
  /** True when active dependents are damaged — raises command risk. */
  highImpact: boolean;
  reasons: string[];
}

function directDependents(context: RelayMissionCommandContext, taskId: string): string[] {
  return context.tasks.filter((t) => t.dependsOn.includes(taskId)).map((t) => t.taskId);
}

function transitiveDependents(context: RelayMissionCommandContext, taskId: string): string[] {
  const seen = new Set<string>();
  const queue = [taskId];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const dep of directDependents(context, current)) {
      if (!seen.has(dep)) {
        seen.add(dep);
        queue.push(dep);
      }
    }
  }
  return [...seen];
}

export function analyzeDependencyImpact(
  draft: Pick<RelayMissionCommandDraft, 'intent' | 'secondaryIntents' | 'targetTaskIds'>,
  context: RelayMissionCommandContext,
): DependencyImpact {
  const intents = [draft.intent, ...draft.secondaryIntents];
  const blocked: string[] = [];
  const invalidated: string[] = [];
  const consumers: string[] = [];
  const reasons: string[] = [];

  for (const taskId of draft.targetTaskIds) {
    if (intents.includes('pause')) {
      for (const dep of directDependents(context, taskId)) {
        blocked.push(dep);
        reasons.push(`pausing ${taskId} blocks dependent ${dep}`);
      }
    }
    if (intents.includes('cancel')) {
      for (const dep of transitiveDependents(context, taskId)) {
        invalidated.push(dep);
        reasons.push(`cancelling ${taskId} invalidates dependent ${dep}`);
      }
    }
    if (intents.includes('redirect')) {
      for (const dep of directDependents(context, taskId)) {
        consumers.push(dep);
        reasons.push(`${dep} consumes the output ${taskId} currently produces`);
      }
    }
    // Reassignment PRESERVES dependency relationships — dependents are listed
    // as affected so nothing is silently orphaned, but they are not damaged.
    if (intents.includes('reassign') && !intents.includes('cancel')) {
      for (const dep of directDependents(context, taskId)) {
        if (!blocked.includes(dep) && !invalidated.includes(dep)) {
          reasons.push(`reassigning ${taskId} preserves its dependency to ${dep}`);
        }
      }
    }
  }

  const affected = [...new Set([...blocked, ...invalidated, ...consumers])];
  /* Blocking a dependent behind a safe pause is a MEDIUM consequence; what
     raises risk is INVALIDATION — a dependent whose input is being destroyed. */
  const highImpact = invalidated.length > 0;

  return {
    affectedDependencyIds: affected,
    blockedDependents: [...new Set(blocked)],
    invalidatedDependents: [...new Set(invalidated)],
    consumersOfRedirectedOutput: [...new Set(consumers)],
    highImpact,
    reasons,
  };
}

/** Prerequisites that are NOT satisfied for starting/resuming a task —
    starting work whose inputs do not exist yet is a blocked dependency. */
export function findUnmetPrerequisites(
  context: RelayMissionCommandContext,
  taskId: string,
): string[] {
  const task = context.tasks.find((t) => t.taskId === taskId);
  if (!task) return [];
  return task.dependsOn.filter((depId) => {
    const dep = context.tasks.find((t) => t.taskId === depId);
    return !dep || dep.status.executionStatus !== 'completed';
  });
}
