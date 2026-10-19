import type {
  AgentHandoffPackage, CompletionPolicy, DecisionRecord, FileClaim, RelayProject,
  RelayRun, RelayTask, ResourceClaim, TaskAssignment, UsageRecord,
} from '../protocol/contracts';
import type { TaskId } from '../protocol/ids';
import { TERMINAL_RUN_STATUSES, TERMINAL_TASK_STATUSES } from '../protocol/enums';
import { leaseState } from './ownership';
import { checkDependencies, checkDuplicateWork, validateBaseRevision, validateDecisionCurrency, validateLedgerVersion } from './checks';
import { inspectFileClaimConflicts } from './claims';
import { validateHandoffPackage } from '../handoff/validation';
import { evaluateDispatchBudget } from '../verification/budget';
import type { RepeatedFailureDecision } from '../recovery/detection';
import type { NoProgressDecision } from '../recovery/detection';

/**
 * The centralized pre-execution battery (Prompt 3, Section 8 / PROTOCOL
 * §2.4). One deterministic evaluation of every dispatch precondition —
 * structured multi-check output, never a bare boolean, and it NEVER
 * dispatches or mutates anything. A later orchestrator consumes the result.
 */

export type EligibilityOutcome = 'eligible' | 'denied' | 'checkpoint_required' | 'blocked';

export interface EligibilityCheck {
  id: string;
  ok: boolean;
  onFailure: Exclude<EligibilityOutcome, 'eligible'>;
  detail: string;
}

export interface DispatchEligibilityResult {
  outcome: EligibilityOutcome;
  failedChecks: EligibilityCheck[];
  warnings: string[];
  requiredUserActions: string[];
  ledgerVersion: number;
  contextVersion: number;
  projectedBudget: ReturnType<typeof evaluateDispatchBudget>;
  safeSummary: string;
}

export interface DispatchEligibilityInput {
  project: RelayProject | null;
  run: RelayRun | null;
  task: RelayTask | null;
  assignment: TaskAssignment | null;
  allTasks: readonly RelayTask[];
  fileClaims: readonly FileClaim[];
  resourceClaims: readonly ResourceClaim[];
  handoff: AgentHandoffPackage | null;
  policy: CompletionPolicy;
  usage: readonly UsageRecord[];
  costEstimate: { usd?: number; tokens?: number; runtimeMs?: number } | null;
  currentLedgerVersion: number;
  /** Sequence of the last CANONICAL-affecting event. Handoff staleness is
   * judged against this when supplied — historical bookkeeping events
   * (incl. the package's own handoff.created) never invalidate a package;
   * canonical decisions/promotions do. Falls back to currentLedgerVersion. */
  lastCanonicalLedgerVersion?: number;
  currentRepositoryRevision?: string;
  decisionsSinceContext?: ReadonlyArray<{ decision: DecisionRecord; conflictsWithTask: boolean }>;
  repeatedFailure?: RepeatedFailureDecision;
  noProgress?: NoProgressDecision;
  expectedIdempotencyKey?: string;
  currentTime: string;
}

export function evaluateDispatchEligibility(input: DispatchEligibilityInput): DispatchEligibilityResult {
  const checks: EligibilityCheck[] = [];
  const warnings: string[] = [];
  const push = (id: string, ok: boolean, onFailure: EligibilityCheck['onFailure'], detail: string) =>
    checks.push({ id, ok, onFailure, detail });

  const { project, run, task, assignment, handoff, currentTime } = input;

  push('project-exists', project !== null, 'denied', project ? 'Project found.' : 'Project not found.');
  push(
    'run-dispatchable',
    !!run && run.status === 'active' && !(TERMINAL_RUN_STATUSES as readonly string[]).includes(run.status) &&
      ['handoff', 'implementation', 'repair'].includes(run.phase),
    run?.status === 'checkpoint_required' ? 'checkpoint_required' : 'blocked',
    run ? `Run is ${run.status}/${run.phase}.` : 'Run not found.',
  );
  push('no-cancellation', !!run && run.status !== 'cancelled', 'denied', 'Run must not be cancelled.');
  push('no-open-checkpoint', !run?.checkpoint || run.checkpoint.respondedAt !== undefined, 'checkpoint_required', run?.checkpoint && !run.checkpoint.respondedAt ? `Unresolved checkpoint: ${run.checkpoint.reason}` : 'No unresolved checkpoint.');
  push('task-exists', task !== null, 'denied', task ? 'Task found.' : 'Task not found.');

  const budget = evaluateDispatchBudget({
    policy: handoff?.budget ?? {},
    loopPolicy: run?.loopPolicy,
    repairCount: run?.repairCount ?? 0,
    currentUsage: input.usage,
    estimatedNextOperation: input.costEstimate,
    currentTime,
  });

  if (!task || !run || !project) {
    return finalize(checks, warnings, budget, input);
  }

  push(
    'task-not-terminal',
    !(TERMINAL_TASK_STATUSES as readonly string[]).includes(task.status) && !task.supersededBy,
    'denied',
    task.supersededBy ? `Task superseded by ${task.supersededBy}.` : `Task status is ${task.status}.`,
  );

  const lease = assignment ? leaseState(assignment, currentTime) : null;
  push('task-owned', assignment !== null, 'blocked', assignment ? 'Owner assigned.' : 'Task has no active owner.');
  push('lease-valid', lease === 'active', 'blocked', lease ? `Lease is ${lease}.` : 'No lease.');
  push(
    'assignment-matches',
    // Ownership absence is already caught by task-owned; this check only
    // verifies an EXISTING assignment matches the handoff target.
    !assignment || (!!handoff && assignment.taskId === task.taskId && handoff.targetAdapterId === assignment.adapterId && handoff.role === assignment.role),
    'denied',
    'Handoff must target the assigned owner and role.',
  );

  const duplicate = checkDuplicateWork({
    candidate: { equivalenceKey: task.equivalenceKey, revisionOf: task.revisionOf },
    existingTasks: input.allTasks.filter((t) => t.taskId !== task.taskId),
  });
  push(
    'no-duplicate-work',
    ['clear', 'revision_of_existing', 'retry_allowed'].includes(duplicate.outcome),
    duplicate.outcome === 'checkpoint_required' ? 'checkpoint_required' : 'denied',
    duplicate.safeSummary,
  );

  const taskById = new Map<TaskId, RelayTask>(input.allTasks.map((t) => [t.taskId, t]));
  taskById.set(task.taskId, task);
  const deps = checkDependencies({ task, taskById, requireCompletionEvidence: true });
  push('dependencies-satisfied', deps.outcome === 'eligible', deps.outcome === 'invalid' ? 'denied' : deps.outcome === 'checkpoint_required' ? 'checkpoint_required' : 'blocked', deps.safeSummary);

  const foreignFileConflicts = task.claimedFiles.flatMap((path) =>
    inspectFileClaimConflicts({ taskId: task.taskId, path, mode: 'write' }, input.fileClaims, currentTime),
  );
  push('file-claims-clear', foreignFileConflicts.length === 0, 'blocked', foreignFileConflicts.length ? `File conflicts: ${foreignFileConflicts.map((c) => `${c.path}→${c.taskId}`).join(', ')}` : 'No file conflicts.');

  const foreignResourceConflicts = input.resourceClaims.filter(
    (c) => c.status === 'active' && c.expiresAt > currentTime && c.taskId !== task.taskId && task.claimedResources.includes(c.resource) && c.mode === 'exclusive',
  );
  push('resource-claims-clear', foreignResourceConflicts.length === 0, 'blocked', foreignResourceConflicts.length ? `Resource conflicts: ${foreignResourceConflicts.map((c) => c.resource).join(', ')}` : 'No resource conflicts.');

  const effectiveLedgerVersion = input.lastCanonicalLedgerVersion ?? input.currentLedgerVersion;
  const ledgerCurrent = handoff !== null && (handoff.ledgerVersion as number) >= effectiveLedgerVersion;
  push(
    'ledger-current',
    ledgerCurrent,
    'checkpoint_required',
    ledgerCurrent
      ? `Package ledger v${handoff?.ledgerVersion} covers canonical v${effectiveLedgerVersion}.`
      : `Package pinned at ledger v${handoff?.ledgerVersion} but canonical state moved to v${effectiveLedgerVersion} — never silently dispatched.`,
  );
  const contextFresh = validateLedgerVersion(handoff?.contextVersion, task.contextVersion as number, { revalidatable: true });
  push('context-current', contextFresh.status === 'current', 'checkpoint_required', contextFresh.detail);
  const revisionFresh = validateBaseRevision(handoff?.baseRevision, input.currentRepositoryRevision);
  push('base-revision-current', revisionFresh.status !== 'stale_blocking' && revisionFresh.status !== 'invalid', 'checkpoint_required', revisionFresh.detail);

  const decisionCurrency = validateDecisionCurrency(task, input.decisionsSinceContext ?? []);
  push('no-invalidating-decision', decisionCurrency.status === 'current', 'denied', decisionCurrency.detail);

  if (handoff && assignment) {
    const handoffValidation = validateHandoffPackage({
      pkg: handoff, run, task, assignment,
      // Agree with the canonical-aware ledger-current rule above: a package
      // that saw all canonical state validates as current.
      currentLedgerVersion: (handoff.ledgerVersion as number) >= effectiveLedgerVersion ? (handoff.ledgerVersion as number) : effectiveLedgerVersion,
      currentBaseRevision: input.currentRepositoryRevision,
      now: currentTime,
      // Staleness is reported by the dedicated ledger/base-revision checks
      // as checkpoint_required (explicit revalidation, never silent dispatch);
      // handoff-valid covers structural defects, which deny.
      staleRevalidatable: true,
      requiredEnforcement: input.policy.enforcementRequirements,
    });
    push('handoff-valid', handoffValidation.outcome === 'valid', handoffValidation.outcome === 'checkpoint_required' ? 'checkpoint_required' : 'denied', handoffValidation.errors.concat(handoffValidation.warnings).join(' ') || 'Handoff validates.');
  } else if (!handoff) {
    push('handoff-valid', false, 'denied', 'No handoff package supplied.');
  }
  // (missing assignment alone is already reported by task-owned/lease-valid)

  push('budget-permits', budget.outcome === 'allowed' || budget.outcome === 'warning', budget.outcome === 'checkpoint_required' ? 'checkpoint_required' : 'denied', budget.safeSummary);
  if (budget.outcome === 'warning') warnings.push(budget.safeSummary);

  push('loop-permits', run.repairCount <= run.loopPolicy.maxAutomaticRevisions, 'denied', `repairCount ${run.repairCount} vs limit ${run.loopPolicy.maxAutomaticRevisions}.`);
  push('no-repeated-failure-stop', input.repeatedFailure?.outcome !== 'repeated_after_repair', 'checkpoint_required', input.repeatedFailure?.safeSummary ?? 'No repeated-failure stop active.');
  push('no-no-progress-stop', input.noProgress?.outcome !== 'no_progress', 'checkpoint_required', input.noProgress?.safeSummary ?? 'No no-progress stop active.');
  push('idempotency-satisfied', !input.expectedIdempotencyKey || handoff?.idempotencyKey === input.expectedIdempotencyKey, 'denied', 'Handoff idempotency key must match the expected dispatch key.');

  return finalize(checks, warnings, budget, input);
}

function finalize(
  checks: EligibilityCheck[],
  warnings: string[],
  budget: ReturnType<typeof evaluateDispatchBudget>,
  input: DispatchEligibilityInput,
): DispatchEligibilityResult {
  const failed = checks.filter((c) => !c.ok);
  const outcome: EligibilityOutcome =
    failed.length === 0 ? 'eligible' :
    failed.some((c) => c.onFailure === 'denied') ? 'denied' :
    failed.some((c) => c.onFailure === 'blocked') ? 'blocked' :
    'checkpoint_required';
  return {
    outcome,
    failedChecks: failed,
    warnings,
    requiredUserActions: failed.filter((c) => c.onFailure === 'checkpoint_required').map((c) => `Resolve: ${c.id} — ${c.detail}`),
    ledgerVersion: input.currentLedgerVersion,
    contextVersion: (input.task?.contextVersion as number) ?? 0,
    projectedBudget: budget,
    safeSummary:
      outcome === 'eligible'
        ? `Eligible: all ${checks.length} checks passed.`
        : `${outcome}: ${failed.length}/${checks.length} checks failed (${failed.map((c) => c.id).join(', ')}).`,
  };
}
