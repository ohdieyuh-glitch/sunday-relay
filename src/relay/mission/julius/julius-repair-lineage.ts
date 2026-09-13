import type { JuliusRecordedDecision, JuliusTask } from './julius-runtime';
import { juliusYieldContinuationOf } from './julius-segment-lineage';

/**
 * REPAIR LINEAGE — what a repair IS, stated once.
 *
 * Three places used to restate the shape of a repair task and they had
 * drifted: the planner minted `repair:<parent taskType>` on a CODING_AGENT for
 * every subject, completion recognised exactly that shape, and the live
 * registration table accepted `repair:build` alone. Paid run 34037313976 hit
 * the gap: a rejected PLAN produced a `repair:plan` task on the Coding Agent,
 * which nothing routes, and the run failed `PROVIDER_UNAVAILABLE` after the
 * plan had been paid for.
 *
 * THE STAGE IS THE SUBJECT'S STAGE. A repair of a plan is a plan; a repair of a
 * repair of a build is still a build. So the type is `repair:<stage>` where the
 * stage strips every `repair:` prefix, and the role is the subject's own —
 * the Prompt Architect revises plans, the Coding Agent repairs code. Rounds
 * count the whole lineage from durable rows, so a repair-cycle bound bounds the
 * lineage rather than each hop.
 */

/** The stage a task type belongs to: `repair:repair:build` → `build`. */
export function stageOfTaskType(taskType: string): string {
  let stage = taskType;
  while (stage.startsWith('repair:')) stage = stage.slice('repair:'.length);
  return stage;
}

/** The task type a repair of `taskType` carries. Idempotent across rounds. */
export function repairTaskTypeFor(taskType: string): string {
  return `repair:${stageOfTaskType(taskType)}`;
}

/**
 * THE PLANNER'S FULL CONTRACT, so an impostor supersedes nothing: parent link,
 * the parent's role, the parent's stage, and the planner's own id shape.
 */
export function isJuliusRepairOf(parent: JuliusTask, child: JuliusTask): boolean {
  if (child.parentTaskId !== parent.taskId || child.role !== parent.role) return false;
  if (child.taskType !== repairTaskTypeFor(parent.taskType)) return false;
  const idPrefix = `repair:${parent.taskId}:`;
  if (!child.taskId.startsWith(idPrefix) || !child.taskId.endsWith(':task')) return false;
  const round = child.taskId.slice(idPrefix.length, -':task'.length);
  return /^[1-9]\d*$/.test(round);
}

/** The repair ancestors of a task, nearest first, ending at the lineage root's child. */
export function repairAncestorsOf(task: JuliusTask, tasks: readonly JuliusTask[]): JuliusTask[] {
  const byId = new Map(tasks.map((item) => [item.taskId, item]));
  const ancestors: JuliusTask[] = [];
  const seen = new Set<string>([task.taskId]);
  let current = task;
  while (current.parentTaskId !== null) {
    const parent = byId.get(current.parentTaskId);
    if (parent === undefined || seen.has(parent.taskId) || !isJuliusRepairOf(parent, current)) break;
    ancestors.push(parent);
    seen.add(parent.taskId);
    current = parent;
  }
  return ancestors;
}

/** The task a repair lineage began from; the task itself when it is not a repair. */
export function repairLineageRootOf(task: JuliusTask, tasks: readonly JuliusTask[]): JuliusTask {
  const ancestors = repairAncestorsOf(task, tasks);
  return ancestors.length === 0 ? task : ancestors[ancestors.length - 1]!;
}

/**
 * HOW MANY REPAIR ROUNDS PRECEDE A NEW ROUND ON THIS SUBJECT: the rounds above
 * it in its lineage plus the rounds already minted beneath it. Computed from
 * task rows alone, so a store that never wrote a repair-cycle row (the live
 * path) still bounds the lineage honestly.
 */
export function repairRoundsBefore(subject: JuliusTask, tasks: readonly JuliusTask[]): number {
  const above = repairAncestorsOf(subject, tasks).length;
  const below = tasks.filter((item) => isJuliusRepairOf(subject, item)).length;
  return above + below;
}

/**
 * EFFECTIVE ACCEPTANCE, the one rule completion and release share.
 *
 * A task is effectively accepted when its CURRENT decision is accepting, or is
 * REPAIR and some SUCCEEDED repair child of it is itself effectively accepted.
 * A HALT, or a REPAIR nobody repaired, is never accepted. A task with no
 * decision is in the result only when it YIELDED and the segment it yielded to
 * is itself effectively accepted; any other undecided task is not.
 */
export function effectivelyAcceptedTaskIds(
  tasks: readonly JuliusTask[],
  decisions: readonly JuliusRecordedDecision[],
  acceptingActions: readonly string[] = ['ACCEPT'],
): ReadonlySet<string> {
  const current = new Map<string, JuliusRecordedDecision>();
  for (const decision of decisions) current.set(decision.taskId, decision);
  const byId = new Map(tasks.map((task) => [task.taskId, task]));
  const repairChildren = new Map<string, JuliusTask[]>();
  for (const task of tasks) {
    if (task.parentTaskId === null) continue;
    const parent = byId.get(task.parentTaskId);
    if (parent === undefined || !isJuliusRepairOf(parent, task)) continue;
    const children = repairChildren.get(task.parentTaskId) ?? [];
    children.push(task);
    repairChildren.set(task.parentTaskId, children);
  }
  const accepted = new Set<string>();
  const walk = (taskId: string, walking: Set<string>): boolean => {
    const decision = current.get(taskId);
    if (decision === undefined) {
      /**
       * A YIELDED DISPATCH IS JUDGED THROUGH ITS CONTINUATION. It was never
       * reviewed, because it was never finished; the segment it yielded to
       * carries the unit's work, so the dispatch is accepted exactly when that
       * segment is. Any other undecided task is not accepted.
       */
      const subject = byId.get(taskId);
      const continuation = subject === undefined ? null : juliusYieldContinuationOf(subject, tasks);
      if (continuation === null || continuation.state !== 'SUCCEEDED' || walking.has(taskId)) return false;
      walking.add(taskId);
      return walk(continuation.taskId, walking);
    }
    if (acceptingActions.includes(decision.action)) return true;
    if (decision.action !== 'REPAIR') return false;
    if (walking.has(taskId)) return false;
    walking.add(taskId);
    return (repairChildren.get(taskId) ?? [])
      .some((child) => child.state === 'SUCCEEDED' && walk(child.taskId, walking));
  };
  for (const taskId of current.keys()) if (walk(taskId, new Set())) accepted.add(taskId);
  for (const task of tasks) {
    if (!current.has(task.taskId) && walk(task.taskId, new Set())) accepted.add(task.taskId);
  }
  return accepted;
}
