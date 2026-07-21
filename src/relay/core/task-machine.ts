import { fail, ok, relayError, type RelayResult } from '../protocol/errors';
import type { CompletionPolicy, DecisionRecord, RelayTask, TaskAssignment } from '../protocol/contracts';
import type { TaskStatus } from '../protocol/enums';
import { TERMINAL_TASK_STATUSES } from '../protocol/enums';
import type { BundleId, ContextVersion, FailureId, LedgerVersion } from '../protocol/ids';

/**
 * RelayTask state contracts (PROTOCOL §2.4). Deterministic transition
 * validation + the Prompt-2 invariants; full duplicate-work coordination
 * (the pre-execution battery wired into dispatch) lands with the
 * coordination prompt — the callable primitives live here already.
 */

const TASK_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  proposed: ['queued', 'cancelled', 'obsolete'],
  queued: ['assigned', 'cancelled', 'obsolete'],
  assigned: ['working', 'queued', 'cancelled', 'obsolete'],
  working: ['waiting', 'reviewing', 'blocked', 'checkpoint_required', 'completed', 'failed', 'cancelled'],
  waiting: ['working', 'blocked', 'cancelled'],
  reviewing: ['revision_required', 'completed', 'failed', 'checkpoint_required', 'cancelled'],
  revision_required: ['working', 'blocked', 'checkpoint_required', 'cancelled', 'failed'],
  blocked: ['working', 'checkpoint_required', 'cancelled', 'failed'],
  checkpoint_required: ['working', 'cancelled', 'failed'],
  completed: [],
  failed: [],
  cancelled: [],
  obsolete: [],
};

export interface TaskTransitionContext {
  now: string;
  /** Required when entering `working`. */
  ownerAssignmentId?: TaskAssignment['assignmentId'];
  /** Required when entering `completed` and policy demands evidence. */
  completionEvidenceRefs?: BundleId[];
  completionPolicy?: CompletionPolicy;
  /** Required when entering `revision_required`. */
  findingIds?: string[];
  failureId?: FailureId;
}

export function transitionTask(
  task: RelayTask,
  to: TaskStatus,
  ctx: TaskTransitionContext,
): RelayResult<RelayTask> {
  if ((TERMINAL_TASK_STATUSES as readonly string[]).includes(task.status)) {
    return fail(
      relayError('immutable', `Task is terminal (${task.status}) and cannot transition to ${to}.`, {
        entityIds: { taskId: task.taskId },
      }),
    );
  }
  if (!TASK_TRANSITIONS[task.status].includes(to)) {
    return fail(
      relayError('illegal-transition', `Task cannot go ${task.status} → ${to}.`, {
        entityIds: { taskId: task.taskId },
      }),
    );
  }
  if (to === 'working') {
    const owner = ctx.ownerAssignmentId ?? task.ownerAssignmentId;
    if (!owner) {
      return fail(
        relayError('illegal-transition', 'A task cannot start working without an explicit owner assignment.', {
          entityIds: { taskId: task.taskId },
        }),
      );
    }
    if (task.status === 'revision_required' && !task.revisionRefs) {
      return fail(
        relayError('evidence-required', 'Revision work requires recorded blocking findings.', {
          entityIds: { taskId: task.taskId },
        }),
      );
    }
    return ok({ ...task, status: to, ownerAssignmentId: owner, updatedAt: ctx.now });
  }
  if (to === 'completed') {
    const policyNeedsEvidence = (ctx.completionPolicy?.requiredEvidence.length ?? 0) > 0;
    const refs = ctx.completionEvidenceRefs ?? task.completionEvidenceRefs ?? [];
    if (policyNeedsEvidence && refs.length === 0) {
      return fail(
        relayError('evidence-required', 'The completion policy requires evidence references before completion.', {
          entityIds: { taskId: task.taskId },
        }),
      );
    }
    return ok({ ...task, status: to, completionEvidenceRefs: refs, updatedAt: ctx.now });
  }
  if (to === 'revision_required') {
    const findings = ctx.findingIds ?? [];
    if (findings.length === 0 && !ctx.failureId) {
      return fail(
        relayError('evidence-required', 'revision_required must reference a blocking finding or failed verification.', {
          entityIds: { taskId: task.taskId },
        }),
      );
    }
    return ok({
      ...task,
      status: to,
      revisionRefs: { findingIds: findings, failureId: ctx.failureId },
      updatedAt: ctx.now,
    });
  }
  return ok({ ...task, status: to, updatedAt: ctx.now });
}

/** Ownership changes are explicit — never implied by a status write. */
export function assignOwner(
  task: RelayTask,
  assignment: TaskAssignment,
  now: string,
): RelayResult<RelayTask> {
  if ((TERMINAL_TASK_STATUSES as readonly string[]).includes(task.status)) {
    return fail(
      relayError('immutable', `Cannot assign an owner to a terminal (${task.status}) task.`, {
        entityIds: { taskId: task.taskId },
      }),
    );
  }
  if (assignment.taskId !== task.taskId) {
    return fail(relayError('validation-failed', 'Assignment does not reference this task.', { entityIds: { taskId: task.taskId } }));
  }
  const status: TaskStatus = task.status === 'queued' ? 'assigned' : task.status;
  return ok({
    ...task,
    status,
    ownerAssignmentId: assignment.assignmentId,
    leaseExpiresAt: assignment.leaseExpiresAt,
    updatedAt: now,
  });
}

/* ------------------------------------------------------------------ */
/* Staleness primitives (callable now; full coordination wiring later) */
/* ------------------------------------------------------------------ */

export function checkStaleContext(
  task: RelayTask,
  latestRelevantVersion: LedgerVersion | ContextVersion | number,
): RelayResult<null> {
  if ((task.contextVersion as number) < (latestRelevantVersion as number)) {
    return fail(
      relayError('stale-context', `Task context v${task.contextVersion} is older than the consumed state's v${latestRelevantVersion}.`, {
        entityIds: { taskId: task.taskId },
      }),
    );
  }
  return ok(null);
}

export function checkStaleLedgerVersion(
  expected: LedgerVersion | number,
  actual: LedgerVersion | number,
): RelayResult<null> {
  if ((expected as number) !== (actual as number)) {
    return fail(
      relayError('stale-ledger-version', `Expected ledger v${expected} but the ledger is at v${actual}.`, {}),
    );
  }
  return ok(null);
}

/** PROTOCOL §2.4: a DecisionRecord accepted after the task's contextVersion
 * that conflicts with the task refuses execution. Conflict detection is a
 * caller-supplied predicate in Prompt 2 (the coordination prompt wires the
 * real matcher). */
export function checkDecisionInvalidation(
  task: RelayTask,
  decisionsSinceContext: ReadonlyArray<{ decision: DecisionRecord; conflictsWithTask: boolean }>,
): RelayResult<null> {
  const conflicting = decisionsSinceContext.find((d) => d.conflictsWithTask);
  if (conflicting) {
    return fail(
      relayError('invalidated-by-decision', `Task is invalidated by accepted decision "${conflicting.decision.title}".`, {
        entityIds: { taskId: task.taskId, decisionId: conflicting.decision.decisionId },
      }),
    );
  }
  return ok(null);
}

/** Lease expiry recovery: crashed agents never lock work forever. */
export function expireLeaseIfDue(task: RelayTask, now: string): RelayTask | null {
  if (!task.leaseExpiresAt || task.leaseExpiresAt > now) return null;
  if (task.status !== 'assigned' && task.status !== 'working') return null;
  return {
    ...task,
    status: 'queued',
    ownerAssignmentId: null,
    leaseExpiresAt: undefined,
    updatedAt: now,
  };
}
