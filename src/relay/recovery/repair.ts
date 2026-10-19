import type { RelayRun, RelayTask, ReviewerVerdictRecord, VerificationRecord } from '../protocol/contracts';
import { FIFTEEN_CONDITIONS } from '../protocol/contracts';
import type { BudgetDecision } from '../verification/budget';

/**
 * Guided Mode one-repair decision (Prompt 3, Decision 4 / RELAY_MVP_SPEC §6).
 * Evaluates ALL 15 founder-approved conditions from structured inputs and
 * returns the decision — it never dispatches. Condition names match
 * RevisionContract.conditionsChecked so the compiled contract records the
 * exact evaluation.
 */

export type RepairOutcome = 'allowed' | 'checkpoint_required' | 'denied';

export interface RepairConditionResult {
  condition: string;
  satisfied: boolean;
  detail: string;
}

export interface AutomaticRepairDecision {
  outcome: RepairOutcome;
  conditions: RepairConditionResult[];
  failedConditions: string[];
  supportingEvidenceRefs: string[];
  reviewerFindingIds: string[];
  repairCount: number;
  requiredUserAction?: string;
  safeSummary: string;
}

export interface RepairPlanFacts {
  narrow: boolean;
  unambiguous: boolean;
  sameAgentAvailable: boolean;
  sameSessionAvailable: boolean;
  insideTaskObjective: boolean;
  filesTouched: string[];
  requiresProtectedFile: boolean;
  requiresNewPermission: boolean;
  requiresDestructiveCommand: boolean;
  requiresDeployment: boolean;
  requiresNewDependency: boolean;
  dependencyPreApproved?: boolean;
  requiresNewCredentials: boolean;
}

export interface RepairEvaluationInput {
  run: RelayRun;
  task: RelayTask;
  verdict: ReviewerVerdictRecord;
  failedVerification?: VerificationRecord;
  failureEvidenceRefs: string[];
  plan: RepairPlanFacts;
  budget: BudgetDecision;
  budgetWarningCheckpointActive: boolean;
  unresolvedDecisionConflict: boolean;
  findingConflictsWithCanonicalDecision: boolean;
}

export function evaluateAutomaticRepair(input: RepairEvaluationInput): AutomaticRepairDecision {
  const { run, task, verdict, failedVerification, failureEvidenceRefs, plan, budget, budgetWarningCheckpointActive, unresolvedDecisionConflict, findingConflictsWithCanonicalDecision } = input;

  const objectiveEvidence = failureEvidenceRefs.length > 0 || failedVerification?.outcome === 'failed' || verdict.findings.length > 0;
  const filesCovered = plan.filesTouched.every((f) => task.claimedFiles.includes(f));
  const dependencyOk = !plan.requiresNewDependency || plan.dependencyPreApproved === true;

  const evaluations: Record<(typeof FIFTEEN_CONDITIONS)[number], [boolean, string]> = {
    'objective-evidence': [objectiveEvidence, 'Failure must be supported by objective evidence (verification/finding refs).'],
    'narrow-unambiguous': [plan.narrow && plan.unambiguous, 'Repair must be narrow and unambiguous.'],
    'same-agent-session': [plan.sameAgentAvailable && plan.sameSessionAvailable, 'Same coding agent and session must be able to continue.'],
    'inside-task-objective': [plan.insideTaskObjective, 'Repair must stay inside the existing task objective.'],
    'inside-file-claims': [filesCovered, 'Repair must stay inside the existing file claims.'],
    'no-protected-file': [!plan.requiresProtectedFile, 'No protected file may change.'],
    'no-new-permission': [!plan.requiresNewPermission, 'No new permission may be required.'],
    'no-destructive-command': [!plan.requiresDestructiveCommand, 'No destructive command may be required.'],
    'no-deployment': [!plan.requiresDeployment, 'No deployment may be required.'],
    'no-new-dependency': [dependencyOk, 'No new dependency unless already approved.'],
    'no-new-credentials': [!plan.requiresNewCredentials, 'No additional credentials may be required.'],
    'within-budget': [budget.outcome === 'allowed' || budget.outcome === 'warning', 'Projected cost must stay inside the approved budget.'],
    'no-budget-warning-checkpoint': [!budgetWarningCheckpointActive, 'No budget-warning checkpoint may be active.'],
    'no-unresolved-decision': [!unresolvedDecisionConflict, 'No unresolved product/architecture decision may exist.'],
    'no-conflict-with-canonical-decision': [!findingConflictsWithCanonicalDecision, 'The finding must not conflict with an accepted canonical decision.'],
  };

  const conditions: RepairConditionResult[] = FIFTEEN_CONDITIONS.map((condition) => {
    const [satisfied, detail] = evaluations[condition];
    return { condition, satisfied, detail };
  });
  const failedConditions = conditions.filter((c) => !c.satisfied).map((c) => c.condition);

  const limitReached = run.repairCount >= run.loopPolicy.maxAutomaticRevisions;
  let outcome: RepairOutcome;
  if (limitReached) outcome = 'denied';
  else if (failedConditions.length > 0) outcome = 'checkpoint_required';
  else outcome = 'allowed';

  return {
    outcome,
    conditions,
    failedConditions,
    supportingEvidenceRefs: failureEvidenceRefs,
    reviewerFindingIds: verdict.findings.map((f) => f.id),
    repairCount: run.repairCount,
    requiredUserAction:
      outcome === 'denied'
        ? 'Automatic repairs are exhausted — respond to the checkpoint or fail the run.'
        : outcome === 'checkpoint_required'
          ? `Approve or reject: ${failedConditions.join(', ')}.`
          : undefined,
    safeSummary:
      outcome === 'allowed'
        ? 'All 15 conditions satisfied — one automatic repair may compile.'
        : outcome === 'denied'
          ? `Repair limit reached (${run.repairCount}/${run.loopPolicy.maxAutomaticRevisions}) — never a second automatic repair.`
          : `Conditions failed: ${failedConditions.join(', ')}.`,
  };
}
