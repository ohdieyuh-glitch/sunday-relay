import type { DecisionRecord, RelayTask } from '../protocol/contracts';
import type { TaskId } from '../protocol/ids';

/**
 * Deterministic duplicate-work, dependency, and staleness decisions
 * (Prompt 3). Duplicate detection compares STRUCTURED equivalence keys only
 * — Relay makes no semantic natural-language equivalence claims (Section 3;
 * anti-goal: pretending semantic dedup is solved).
 */

/* ------------------------- duplicate work ------------------------- */

export type DuplicateOutcome =
  | 'clear'
  | 'duplicate_active'
  | 'duplicate_completed'
  | 'superseded'
  | 'obsolete'
  | 'revision_of_existing'
  | 'retry_allowed'
  | 'checkpoint_required';

export interface DuplicateWorkDecision {
  outcome: DuplicateOutcome;
  reasonCode: string;
  conflictingTaskIds: TaskId[];
  decisionIds: string[];
  evidenceRefs: string[];
  safeSummary: string;
  recommendedAction: string;
}

export interface DuplicateCheckInput {
  candidate: {
    equivalenceKey?: string;
    idempotencyKey?: string;
    revisionOf?: TaskId;
  };
  existingTasks: readonly RelayTask[];
  /** Task ids previously created under the same idempotency key. */
  idempotencyIndex?: ReadonlyMap<string, TaskId>;
  /** Accepted decisions that obsolete matching equivalence keys. */
  obsoletingDecisions?: ReadonlyArray<{ decisionId: string; obsoletesEquivalenceKey: string }>;
  /** Policy: may a previously failed equivalent task be retried? */
  retryFailedAllowed?: boolean;
}

const decision = (
  outcome: DuplicateOutcome,
  reasonCode: string,
  safeSummary: string,
  recommendedAction: string,
  extra: Partial<DuplicateWorkDecision> = {},
): DuplicateWorkDecision => ({
  outcome,
  reasonCode,
  conflictingTaskIds: [],
  decisionIds: [],
  evidenceRefs: [],
  safeSummary,
  recommendedAction,
  ...extra,
});

export function checkDuplicateWork(input: DuplicateCheckInput): DuplicateWorkDecision {
  const { candidate, existingTasks, idempotencyIndex, obsoletingDecisions, retryFailedAllowed } = input;

  if (candidate.idempotencyKey && idempotencyIndex?.has(candidate.idempotencyKey)) {
    const taskId = idempotencyIndex.get(candidate.idempotencyKey)!;
    return decision('duplicate_active', 'idempotency-key-reuse', 'This idempotency key already created a task.', 'Use the existing task.', {
      conflictingTaskIds: [taskId],
    });
  }

  if (candidate.revisionOf) {
    const parent = existingTasks.find((t) => t.taskId === candidate.revisionOf);
    if (parent) {
      return decision('revision_of_existing', 'explicit-revision', `Revision of existing task ${parent.taskId}.`, 'Proceed as a revision, not a new task.', {
        conflictingTaskIds: [parent.taskId],
      });
    }
  }

  if (!candidate.equivalenceKey) {
    return decision('clear', 'no-equivalence-key', 'No structured equivalence key — no deterministic duplicate basis.', 'Proceed.');
  }

  const key = candidate.equivalenceKey;
  const obsoleting = (obsoletingDecisions ?? []).filter((d) => d.obsoletesEquivalenceKey === key);
  if (obsoleting.length > 0) {
    return decision('obsolete', 'decision-obsoletes-key', 'A newer canonical decision made this work obsolete.', 'Do not create the task; review the decision.', {
      decisionIds: obsoleting.map((d) => d.decisionId),
    });
  }

  const equivalents = existingTasks.filter((t) => t.equivalenceKey === key);
  const superseded = equivalents.filter((t) => t.supersededBy);
  const active = equivalents.filter(
    (t) => !t.supersededBy && !['completed', 'failed', 'cancelled', 'obsolete'].includes(t.status),
  );
  const completed = equivalents.filter((t) => t.status === 'completed');
  const failed = equivalents.filter((t) => t.status === 'failed');

  if (active.length > 0) {
    return decision('duplicate_active', 'equivalent-active-task', 'An equivalent task is already active under the same equivalence key.', 'Attach to the existing task instead of creating a duplicate.', {
      conflictingTaskIds: active.map((t) => t.taskId),
    });
  }
  if (completed.length > 0) {
    return decision('duplicate_completed', 'equivalent-completed-task', 'Equivalent work was already completed.', 'Verify the completed task covers this request.', {
      conflictingTaskIds: completed.map((t) => t.taskId),
      evidenceRefs: completed.flatMap((t) => t.completionEvidenceRefs ?? []),
    });
  }
  if (failed.length > 0) {
    if (retryFailedAllowed) {
      return decision('retry_allowed', 'retry-of-failed-task', 'An equivalent task failed; policy permits a retry.', 'Create the retry with a reference to the failed task.', {
        conflictingTaskIds: failed.map((t) => t.taskId),
      });
    }
    return decision('checkpoint_required', 'retry-requires-approval', 'An equivalent task failed; retry needs operator approval.', 'Respond to the checkpoint.', {
      conflictingTaskIds: failed.map((t) => t.taskId),
    });
  }
  if (superseded.length > 0 && equivalents.length === superseded.length) {
    return decision('superseded', 'equivalents-superseded', 'All equivalent tasks were superseded.', 'Follow the superseding task chain.', {
      conflictingTaskIds: superseded.map((t) => t.taskId),
    });
  }
  return decision('clear', 'no-conflict', 'No duplicate under this equivalence key.', 'Proceed.');
}

/* -------------------------- dependencies -------------------------- */

export type DependencyOutcome = 'eligible' | 'blocked' | 'checkpoint_required' | 'invalid';

export interface DependencyDecision {
  outcome: DependencyOutcome;
  missing: TaskId[];
  incomplete: TaskId[];
  failed: TaskId[];
  cancelled: TaskId[];
  obsolete: TaskId[];
  stale: TaskId[];
  missingEvidence: TaskId[];
  circularPath?: TaskId[];
  safeSummary: string;
}

export interface DependencyCheckInput {
  task: RelayTask;
  taskById: ReadonlyMap<TaskId, RelayTask>;
  /** Policy: does a failed dependency block (default) or checkpoint? */
  failedDependencyBehavior?: 'blocked' | 'checkpoint_required';
  /** Dependencies completed before this ledger version need revalidation. */
  minimumDependencyContextVersion?: number;
  requireCompletionEvidence?: boolean;
}

function findCycle(start: TaskId, taskById: ReadonlyMap<TaskId, RelayTask>): TaskId[] | null {
  const path: TaskId[] = [];
  const visiting = new Set<TaskId>();
  const visit = (id: TaskId): TaskId[] | null => {
    if (visiting.has(id)) return [...path.slice(path.indexOf(id)), id];
    const task = taskById.get(id);
    if (!task) return null;
    visiting.add(id);
    path.push(id);
    for (const dep of task.dependencies) {
      const cycle = visit(dep);
      if (cycle) return cycle;
    }
    visiting.delete(id);
    path.pop();
    return null;
  };
  return visit(start);
}

export function checkDependencies(input: DependencyCheckInput): DependencyDecision {
  const { task, taskById, failedDependencyBehavior = 'blocked', minimumDependencyContextVersion, requireCompletionEvidence } = input;
  const result: DependencyDecision = {
    outcome: 'eligible', missing: [], incomplete: [], failed: [], cancelled: [],
    obsolete: [], stale: [], missingEvidence: [], safeSummary: '',
  };

  if (task.dependencies.includes(task.taskId)) {
    return { ...result, outcome: 'invalid', circularPath: [task.taskId, task.taskId], safeSummary: 'Task depends on itself.' };
  }
  const cycle = findCycle(task.taskId, taskById);
  if (cycle) {
    return { ...result, outcome: 'invalid', circularPath: cycle, safeSummary: `Circular dependency: ${cycle.join(' → ')}.` };
  }

  for (const depId of task.dependencies) {
    const dep = taskById.get(depId);
    if (!dep) { result.missing.push(depId); continue; }
    const effective = dep.supersededBy ? taskById.get(dep.supersededBy) : dep;
    if (!effective) { result.missing.push(depId); continue; }
    if (effective.status === 'obsolete') { result.obsolete.push(effective.taskId); continue; }
    if (effective.status === 'cancelled') { result.cancelled.push(effective.taskId); continue; }
    if (effective.status === 'failed') { result.failed.push(effective.taskId); continue; }
    if (effective.status !== 'completed') { result.incomplete.push(effective.taskId); continue; }
    if (requireCompletionEvidence && (effective.completionEvidenceRefs?.length ?? 0) === 0) {
      result.missingEvidence.push(effective.taskId);
      continue;
    }
    if (minimumDependencyContextVersion !== undefined && (effective.contextVersion as number) < minimumDependencyContextVersion) {
      result.stale.push(effective.taskId);
    }
  }

  if (result.missing.length > 0) {
    return { ...result, outcome: 'invalid', safeSummary: `Missing dependency task(s): ${result.missing.join(', ')}.` };
  }
  if (result.failed.length > 0) {
    return { ...result, outcome: failedDependencyBehavior, safeSummary: `Failed dependency task(s): ${result.failed.join(', ')}.` };
  }
  if (result.cancelled.length > 0 || result.obsolete.length > 0 || result.incomplete.length > 0 || result.missingEvidence.length > 0) {
    return { ...result, outcome: 'blocked', safeSummary: 'Dependencies are not completed (cancelled/obsolete/incomplete/unevidenced dependencies never count as complete).' };
  }
  if (result.stale.length > 0) {
    return { ...result, outcome: 'checkpoint_required', safeSummary: 'Dependency completed against an older context version — revalidation required.' };
  }
  return { ...result, safeSummary: 'All dependencies satisfied.' };
}

/* --------------------------- staleness ---------------------------- */

export type FreshnessStatus = 'current' | 'stale_but_revalidatable' | 'stale_blocking' | 'unavailable' | 'invalid';

export interface FreshnessResult {
  status: FreshnessStatus;
  detail: string;
}

export function validateLedgerVersion(expected: number | undefined, actual: number, opts: { revalidatable?: boolean } = {}): FreshnessResult {
  if (expected === undefined) return { status: 'unavailable', detail: 'No ledger version supplied.' };
  if (expected < 0 || !Number.isInteger(expected)) return { status: 'invalid', detail: 'Ledger version is not a valid sequence.' };
  if (expected === actual) return { status: 'current', detail: `Ledger v${actual}.` };
  return {
    status: opts.revalidatable ? 'stale_but_revalidatable' : 'stale_blocking',
    detail: `Pinned ledger v${expected} but the ledger is at v${actual} — never silently dispatched.`,
  };
}

export const validateContextVersion = validateLedgerVersion;

export function validateBaseRevision(pinned: string | undefined, current: string | undefined): FreshnessResult {
  if (!current) return { status: 'unavailable', detail: 'Current repository revision not supplied (represented honestly, never assumed).' };
  if (!pinned) return { status: 'unavailable', detail: 'No pinned base revision.' };
  if (pinned === current) return { status: 'current', detail: `Base revision ${current}.` };
  return { status: 'stale_blocking', detail: `Pinned ${pinned} but repository is at ${current}.` };
}

export function validateDecisionCurrency(
  task: RelayTask,
  decisionsSinceContext: ReadonlyArray<{ decision: DecisionRecord; conflictsWithTask: boolean }>,
): FreshnessResult {
  void task; // identity kept in the signature for auditability of call sites
  const conflicting = decisionsSinceContext.filter((d) => d.conflictsWithTask && !d.decision.supersededBy);
  if (conflicting.length > 0) {
    return { status: 'stale_blocking', detail: `Invalidated by accepted decision(s): ${conflicting.map((d) => d.decision.decisionId).join(', ')}.` };
  }
  return { status: 'current', detail: 'No invalidating decisions.' };
}

export function validateHandoffFreshness(
  pkg: { ledgerVersion: number; contextVersion: number; baseRevision: string; expiresAt?: string },
  current: { ledgerVersion: number; baseRevision?: string; now: string },
): FreshnessResult {
  if (pkg.expiresAt && pkg.expiresAt <= current.now) {
    return { status: 'stale_blocking', detail: 'Handoff package expired.' };
  }
  const ledger = validateLedgerVersion(pkg.ledgerVersion, current.ledgerVersion);
  if (ledger.status !== 'current') return ledger;
  return validateBaseRevision(pkg.baseRevision, current.baseRevision);
}

export function validateEvidenceFreshness(
  evidence: { repoRevision: string; executedAt: string; expiresAt?: string },
  current: { baseRevision?: string; now: string; allowOldRevision?: boolean },
): FreshnessResult {
  if (evidence.expiresAt && evidence.expiresAt <= current.now) {
    return { status: 'stale_blocking', detail: 'Evidence expired.' };
  }
  if (!current.baseRevision) return { status: 'unavailable', detail: 'No current revision to compare against.' };
  if (evidence.repoRevision === current.baseRevision) return { status: 'current', detail: 'Evidence pinned to the current revision.' };
  return current.allowOldRevision
    ? { status: 'stale_but_revalidatable', detail: 'Evidence from an older revision — policy explicitly permits it.' }
    : { status: 'stale_blocking', detail: `Evidence pinned to ${evidence.repoRevision}, current is ${current.baseRevision}.` };
}
