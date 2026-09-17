import type { JuliusRecordedDecision, JuliusTask } from './julius-runtime';
import { effectivelyAcceptedTaskIds, isJuliusRepairOf } from './julius-repair-lineage';
import { juliusYieldContinuationOf } from './julius-segment-lineage';

/**
 * RELEASE — the moment work becomes claimable, decided by Julius.
 *
 * The declared mission graph is plan → plan review → build → build review.
 * The claim query used to offer any BLOCKED task whose dependencies were
 * SUCCEEDED, and `build` depends on `plan` — so on the tick after the plan
 * succeeded, `build` and `plan:review` were BOTH claimable and the build ran
 * before anyone had reviewed the plan. Paid run 34037313976 did exactly that:
 * a correct implementation, refused later for an unrelated reason, produced
 * against a plan whose review then rejected it.
 *
 * SUCCEEDED IS NOT ACCEPTED. A dependency is satisfied when Julius has
 * accepted it — an ACCEPT decision, or a REPAIR superseded by an accepted
 * repair lineage, the same rule completion uses — or when it was SKIPPED. This
 * evaluator is pure: it names the BLOCKED tasks whose every dependency is
 * satisfied, and the pipeline writes the release in the same durable write as
 * the decision that satisfied it. The claim query offers RUNNABLE tasks only,
 * so nothing else can make a BLOCKED task claimable.
 */

export interface JuliusReleaseInput {
  readonly tasks: readonly JuliusTask[];
  readonly decisions: readonly JuliusRecordedDecision[];
}

export interface JuliusWithheldTask {
  readonly taskId: string;
  /** The dependencies that are not yet accepted (or are missing, failed or cancelled). */
  readonly waitingOn: readonly string[];
}

export interface JuliusReleaseResult {
  /** BLOCKED tasks Julius may now make RUNNABLE, in deterministic order. */
  readonly releasable: readonly string[];
  /** BLOCKED tasks that stay BLOCKED, and why. */
  readonly withheld: readonly JuliusWithheldTask[];
}

/** Decisions that satisfy a dependent. COMPLETE is an acceptance that also completes. */
export const JULIUS_RELEASING_ACTIONS: readonly string[] = Object.freeze(['ACCEPT', 'COMPLETE']);

export function evaluateJuliusRelease(input: JuliusReleaseInput): JuliusReleaseResult {
  const byId = new Map(input.tasks.map((task) => [task.taskId, task]));
  const accepted = effectivelyAcceptedTaskIds(input.tasks, input.decisions, JULIUS_RELEASING_ACTIONS);
  const releasable: JuliusTask[] = [];
  const withheld: JuliusWithheldTask[] = [];
  for (const task of input.tasks) {
    if (task.state !== 'BLOCKED') continue;
    const waitingOn = task.dependencyIds.filter((id) => {
      const dependency = byId.get(id);
      // A dependency the run does not hold can never be accepted here.
      if (dependency === undefined) return true;
      if (dependency.state === 'SKIPPED') return false;
      if (dependency.state !== 'SUCCEEDED') return true;
      return !accepted.has(id);
    });
    if (waitingOn.length === 0) releasable.push(task);
    else withheld.push({ taskId: task.taskId, waitingOn });
  }
  releasable.sort((a, b) => a.ordinal - b.ordinal || a.taskId.localeCompare(b.taskId));
  return { releasable: releasable.map((task) => task.taskId), withheld };
}

/**
 * CAN THIS TASK STILL BE ACCEPTED? — the liveness half of the release rule,
 * for the run-state judgement. A SUCCEEDED task is accepted, or its acceptance
 * is still pending, or it is dead:
 *
 *   - effectively accepted (ACCEPT, or REPAIR superseded by an accepted repair
 *     lineage)                                                       → live
 *   - its current decision is REPAIR and some repair child is non-terminal,
 *     or SUCCEEDED and itself still acceptable                       → live
 *   - its current decision is HALT, or REPAIR with every repair child dead → dead
 *   - no decision yet: a review child is non-terminal, or SUCCEEDED (its
 *     verdict is being decided), or it has no children at all (verification
 *     has not run yet)                                                → live
 *   - no decision and every child is FAILED or CANCELLED               → dead
 *   - no decision because it YIELDED: live while the segment it yielded to is
 *     non-terminal or still acceptable, dead when that segment is
 *
 * Returned as a predicate over task ids so the graph walk can consult it per
 * dependency without recomputing the lineage.
 */
export function canStillBeAccepted(
  tasks: readonly JuliusTask[],
  decisions: readonly JuliusRecordedDecision[],
): (taskId: string) => boolean {
  const accepted = effectivelyAcceptedTaskIds(tasks, decisions, JULIUS_RELEASING_ACTIONS);
  const current = new Map<string, JuliusRecordedDecision>();
  for (const decision of decisions) current.set(decision.taskId, decision);
  const byId = new Map(tasks.map((task) => [task.taskId, task]));
  const children = new Map<string, JuliusTask[]>();
  for (const task of tasks) {
    if (task.parentTaskId === null) continue;
    const list = children.get(task.parentTaskId) ?? [];
    list.push(task);
    children.set(task.parentTaskId, list);
  }
  const live = (child: JuliusTask): boolean => child.state === 'RUNNABLE' || child.state === 'ACTIVE' || child.state === 'BLOCKED';
  const memo = new Map<string, boolean>();
  const walk = (taskId: string, walking: Set<string>): boolean => {
    if (accepted.has(taskId)) return true;
    const known = memo.get(taskId);
    if (known !== undefined) return known;
    if (walking.has(taskId)) return false;
    walking.add(taskId);
    const decision = current.get(taskId);
    const kids = children.get(taskId) ?? [];
    let answer: boolean;
    const subject = byId.get(taskId);
    const continuation = decision === undefined && subject !== undefined ? juliusYieldContinuationOf(subject, tasks) : null;
    if (continuation !== null) {
      // A YIELDED DISPATCH LIVES AND DIES WITH THE SEGMENT IT YIELDED TO: it was
      // never reviewed, so nothing else can ever decide it.
      answer = live(continuation) || (continuation.state === 'SUCCEEDED' && walk(continuation.taskId, walking));
    } else if (decision === undefined) {
      /**
       * ONLY A REVIEW DECIDES AN UNDECIDED TASK. Counting any child kept a task
       * live on the strength of, say, a SUCCEEDED sub-agent while the review
       * that would actually have decided it had failed for good — so a
       * dependent waited on an acceptance that could never come.
       */
      const reviews = kids.filter((kid) => kid.role === 'INDEPENDENT_REVIEWER');
      answer = reviews.length === 0
        // No review scheduled yet: verification has not run, and it will.
        ? true
        : reviews.some((kid) => live(kid) || kid.state === 'SUCCEEDED');
    } else if (decision.action === 'REPAIR') {
      // The SAME lineage rule acceptance itself uses: a child that is merely
      // repair-SHAPED supersedes nothing, so it cannot keep its parent live.
      answer = subject !== undefined && kids.some((kid) => isJuliusRepairOf(subject, kid)
        && (live(kid) || (kid.state === 'SUCCEEDED' && walk(kid.taskId, walking))));
    } else {
      answer = false;
    }
    walking.delete(taskId);
    memo.set(taskId, answer);
    return answer;
  };
  return (taskId) => walk(taskId, new Set());
}
