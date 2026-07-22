import type { RelayRun } from '../protocol/contracts';
import type { BudgetDecision } from '../verification/budget';
import type { NoProgressDecision, RepeatedFailureDecision } from './detection';

/**
 * Bounded recovery decision (Prompt 3, Section 20). Deterministic and
 * conservative: automatic work STOPS whenever the founder-locked stop
 * conditions hold. No automatic provider reassignment exists in this phase
 * — the strongest automatic action is compiling the single revision.
 */

export type RecoveryOutcome = 'continue_same_agent' | 'compile_revision' | 'checkpoint_required' | 'blocked' | 'fail_run';

export interface RecoveryDecision {
  outcome: RecoveryOutcome;
  reasons: string[];
  safeSummary: string;
}

export interface RecoveryEvaluationInput {
  run: RelayRun;
  repeatedFailure: RepeatedFailureDecision;
  noProgress: NoProgressDecision;
  budget: BudgetDecision;
  repairDecisionOutcome?: 'allowed' | 'checkpoint_required' | 'denied';
  requiresProtectedFile: boolean;
  requiresNewPermission: boolean;
  requiresDeployment: boolean;
  credentialsMissing: boolean;
  productOrArchitectureAmbiguity: boolean;
  sessionResumable: boolean;
  requiredEnforcementUnsupported: boolean;
  evidenceSufficientForNarrowRepair: boolean;
  /** Attempt was still healthy (no failure yet) — agent may simply continue. */
  attemptHealthy?: boolean;
}

export function decideRecovery(input: RecoveryEvaluationInput): RecoveryDecision {
  const reasons: string[] = [];
  const stop = (outcome: RecoveryOutcome, summary: string): RecoveryDecision => ({ outcome, reasons, safeSummary: summary });

  if (input.requiresProtectedFile) { reasons.push('protected-file-required'); return stop('blocked', 'A protected file would need to change — automatic work stops.'); }
  if (input.credentialsMissing) { reasons.push('credentials-missing'); return stop('blocked', 'Required credentials are missing — automatic work stops.'); }
  if (input.requiredEnforcementUnsupported) { reasons.push('enforcement-unsupported'); return stop('blocked', 'Required enforcement is unsupported on this path.'); }
  if (input.requiresDeployment) { reasons.push('deployment-required'); return stop('checkpoint_required', 'Deployment is never automatic — checkpoint.'); }
  if (input.requiresNewPermission) { reasons.push('permission-expansion'); return stop('checkpoint_required', 'Permission expansion requires the operator.'); }
  if (input.productOrArchitectureAmbiguity) { reasons.push('ambiguity'); return stop('checkpoint_required', 'Product/architecture ambiguity — operator decision required.'); }
  if (!input.sessionResumable) { reasons.push('session-not-resumable'); return stop('checkpoint_required', 'The session cannot safely resume.'); }
  if (input.budget.outcome === 'denied') { reasons.push('budget-denied'); return stop('checkpoint_required', 'Budget denies another operation.'); }
  if (input.repeatedFailure.outcome === 'repeated_after_repair') {
    reasons.push('repeated-after-repair');
    return stop('checkpoint_required', 'The single repair already failed with the same failure — never a second automatic repair.');
  }
  if (input.run.repairCount >= input.run.loopPolicy.maxAutomaticRevisions && input.repeatedFailure.outcome !== 'first_occurrence') {
    reasons.push('repair-exhausted');
    return stop('checkpoint_required', 'Automatic repairs are exhausted.');
  }
  if (input.repeatedFailure.outcome === 'repeated' && input.noProgress.outcome === 'no_progress') {
    reasons.push('repeated-without-progress');
    return stop('checkpoint_required', 'Same failure repeats without material progress — automatic work stops.');
  }
  if (input.noProgress.outcome === 'no_progress') {
    reasons.push('no-progress');
    return stop('checkpoint_required', 'No progress detected — another automatic dispatch is not justified.');
  }
  if (input.attemptHealthy) {
    reasons.push('healthy');
    return stop('continue_same_agent', 'Attempt is progressing — same agent continues.');
  }
  if (!input.evidenceSufficientForNarrowRepair) {
    reasons.push('insufficient-evidence-for-narrow-repair');
    return stop('checkpoint_required', 'Evidence is insufficient to define a narrow repair.');
  }
  if (input.repairDecisionOutcome === 'allowed') {
    reasons.push('one-repair-available');
    return stop('compile_revision', 'One focused automatic repair may compile.');
  }
  reasons.push('repair-not-allowed');
  return stop('checkpoint_required', 'Automatic repair is not permitted — operator decision required.');
}
