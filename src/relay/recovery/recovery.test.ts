import { describe, expect, it } from 'vitest';
import { evaluateAutomaticRepair, type RepairEvaluationInput, type RepairPlanFacts } from './repair';
import { detectNoProgress, detectRepeatedFailure, failureFingerprint, type AttemptSummary } from './detection';
import { decideRecovery, type RecoveryEvaluationInput } from './decision';
import { FIFTEEN_CONDITIONS, fixedId, makeRun, makeTask, makeVerdict } from '../testing/factories';
import type { BudgetDecision } from '../verification/budget';

const okBudget: BudgetDecision = { outcome: 'allowed', reasons: [], actual: { usd: 0, tokens: 0, runtimeMs: 0 }, projected: {}, estimateMissing: false, safeSummary: 'ok' };

const goodPlan: RepairPlanFacts = {
  narrow: true, unambiguous: true, sameAgentAvailable: true, sameSessionAvailable: true,
  insideTaskObjective: true, filesTouched: ['src/sim/feature.ts'], requiresProtectedFile: false,
  requiresNewPermission: false, requiresDestructiveCommand: false, requiresDeployment: false,
  requiresNewDependency: false, requiresNewCredentials: false,
};

function repairInput(overrides: Partial<RepairEvaluationInput> = {}): RepairEvaluationInput {
  return {
    run: makeRun({ status: 'active', phase: 'review' }),
    task: makeTask(),
    verdict: makeVerdict('changes_requested'),
    failureEvidenceRefs: [fixedId('evd')],
    plan: goodPlan,
    budget: okBudget,
    budgetWarningCheckpointActive: false,
    unresolvedDecisionConflict: false,
    findingConflictsWithCanonicalDecision: false,
    ...overrides,
  };
}

describe('K — Guided one-repair decision (all 15 conditions)', () => {
  it('all conditions pass → allowed, with a condition-by-condition record', () => {
    const decision = evaluateAutomaticRepair(repairInput());
    expect(decision.outcome).toBe('allowed');
    expect(decision.conditions).toHaveLength(15);
    expect(decision.conditions.every((c) => c.satisfied)).toBe(true);
    expect(decision.reviewerFindingIds).toEqual(['R1']);
  });

  it('each plan-level condition failing individually → checkpoint_required naming that condition', () => {
    const cases: Array<[Partial<RepairPlanFacts>, string]> = [
      [{ narrow: false }, 'narrow-unambiguous'],
      [{ unambiguous: false }, 'narrow-unambiguous'],
      [{ sameAgentAvailable: false }, 'same-agent-session'],
      [{ sameSessionAvailable: false }, 'same-agent-session'],
      [{ insideTaskObjective: false }, 'inside-task-objective'],
      [{ filesTouched: ['outside/claims.ts'] }, 'inside-file-claims'],
      [{ requiresProtectedFile: true }, 'no-protected-file'],
      [{ requiresNewPermission: true }, 'no-new-permission'],
      [{ requiresDestructiveCommand: true }, 'no-destructive-command'],
      [{ requiresDeployment: true }, 'no-deployment'],
      [{ requiresNewDependency: true }, 'no-new-dependency'],
      [{ requiresNewCredentials: true }, 'no-new-credentials'],
    ];
    for (const [patch, condition] of cases) {
      const decision = evaluateAutomaticRepair(repairInput({ plan: { ...goodPlan, ...patch } }));
      expect(decision.outcome, condition).toBe('checkpoint_required');
      expect(decision.failedConditions, condition).toContain(condition);
    }
    // pre-approved dependency passes
    expect(evaluateAutomaticRepair(repairInput({ plan: { ...goodPlan, requiresNewDependency: true, dependencyPreApproved: true } })).outcome).toBe('allowed');
  });

  it('budget, checkpoint, ambiguity, and canonical-conflict conditions fail correctly; several failures reported together', () => {
    expect(evaluateAutomaticRepair(repairInput({ budget: { ...okBudget, outcome: 'denied' } })).failedConditions).toContain('within-budget');
    expect(evaluateAutomaticRepair(repairInput({ budgetWarningCheckpointActive: true })).failedConditions).toContain('no-budget-warning-checkpoint');
    expect(evaluateAutomaticRepair(repairInput({ unresolvedDecisionConflict: true })).failedConditions).toContain('no-unresolved-decision');
    expect(evaluateAutomaticRepair(repairInput({ findingConflictsWithCanonicalDecision: true })).failedConditions).toContain('no-conflict-with-canonical-decision');
    const evidenceless = evaluateAutomaticRepair(repairInput({ failureEvidenceRefs: [], verdict: makeVerdict('approved'), plan: { ...goodPlan, requiresDeployment: true } }));
    expect(evidenceless.failedConditions.length).toBeGreaterThanOrEqual(2);
  });

  it('repair limits: count 0 allowed; count 1 denied; zero-revision policy denied — decision never dispatches', () => {
    expect(evaluateAutomaticRepair(repairInput()).outcome).toBe('allowed');
    const exhausted = evaluateAutomaticRepair(repairInput({ run: makeRun({ repairCount: 1 }) }));
    expect(exhausted.outcome).toBe('denied');
    const disabled = evaluateAutomaticRepair(repairInput({ run: makeRun({ loopPolicy: { maxAutomaticRevisions: 0 } }) }));
    expect(disabled.outcome).toBe('denied');
    expect(FIFTEEN_CONDITIONS).toHaveLength(15); // the founder-approved set, exactly
  });
});

describe('M — repeated-failure detection', () => {
  const fp = (patch = {}) => failureFingerprint({ category: 'test-failure', commandIdentity: 'npx vitest run', failedTestIds: ['a', 'b'], exitCode: 1, repoRevision: 'rev-1', taskId: 'tsk_1', ...patch });

  it('fingerprints are stable, order-insensitive for test ids, and exclude secrets by construction', () => {
    expect(fp()).toBe(fp());
    expect(fp()).toBe(failureFingerprint({ category: 'test-failure', commandIdentity: 'npx vitest run', failedTestIds: ['b', 'a'], exitCode: 1, repoRevision: 'rev-other', taskId: 'tsk_1' }));
    expect(fp()).not.toBe(fp({ exitCode: 2 }));
    expect(fp()).not.toContain('sk-'); // fingerprint is a hash of safe structured fields only
  });

  it('first occurrence / repeated / repeated-after-repair / materially changed / unavailable / revision awareness', () => {
    expect(detectRepeatedFailure([], { fingerprint: fp(), repoRevision: 'rev-1', afterRepair: false }).outcome).toBe('first_occurrence');
    const history = [{ fingerprint: fp(), repoRevision: 'rev-1', afterRepair: false }];
    const repeated = detectRepeatedFailure(history, { fingerprint: fp(), repoRevision: 'rev-1', afterRepair: false });
    expect(repeated.outcome).toBe('repeated');
    expect(repeated.sameRevision).toBe(true);
    const newRev = detectRepeatedFailure(history, { fingerprint: fp(), repoRevision: 'rev-2', afterRepair: false });
    expect(newRev.sameRevision).toBe(false);
    expect(detectRepeatedFailure(history, { fingerprint: fp(), repoRevision: 'rev-2', afterRepair: true }).outcome).toBe('repeated_after_repair');
    expect(detectRepeatedFailure(history, { fingerprint: fp({ exitCode: 2 }), repoRevision: 'rev-2', afterRepair: false }).outcome).toBe('materially_changed');
    expect(detectRepeatedFailure(history, null).outcome).toBe('unavailable');
  });
});

describe('N — no-progress detection (conservative)', () => {
  const attempt = (patch: Partial<AttemptSummary> = {}): AttemptSummary => ({
    diffFingerprint: 'diff-1', repoRevision: 'rev-1', evidenceIds: ['evd_1'], blockingFindingIds: ['R1', 'R2'], failureFingerprint: 'ff-1', reportPayloadFingerprint: 'rp-1', ...patch,
  });

  it('progress signals: new diff, new evidence, fewer blocking findings, changed failure', () => {
    expect(detectNoProgress(attempt(), attempt({ diffFingerprint: 'diff-2' })).outcome).toBe('progress');
    expect(detectNoProgress(attempt(), attempt({ evidenceIds: ['evd_1', 'evd_2'] })).outcome).toBe('progress');
    expect(detectNoProgress(attempt(), attempt({ blockingFindingIds: ['R1'] })).outcome).toBe('progress');
    expect(detectNoProgress(attempt(), attempt({ failureFingerprint: 'ff-2' })).outcome).toBe('progress');
  });

  it('identical everything is no_progress; unsupported completion claims alone are never progress', () => {
    const identical = detectNoProgress(attempt(), attempt());
    expect(identical.outcome).toBe('no_progress');
    expect(identical.signals).toContain('identical-diff');
    const claimsOnly = detectNoProgress(attempt(), attempt({ onlyUnsupportedClaims: true }));
    expect(claimsOnly.outcome).toBe('no_progress');
    expect(claimsOnly.signals).toContain('only-unsupported-claims');
  });

  it('insufficient data is honest: missing prior attempt or no comparable fingerprints', () => {
    expect(detectNoProgress(null, attempt()).outcome).toBe('insufficient_data');
    const sparse = detectNoProgress(
      { evidenceIds: [], blockingFindingIds: [] },
      { evidenceIds: [], blockingFindingIds: [] },
    );
    expect(sparse.outcome).toBe('insufficient_data');
  });
});

describe('O — bounded recovery decision', () => {
  function recoveryInput(overrides: Partial<RecoveryEvaluationInput> = {}): RecoveryEvaluationInput {
    return {
      run: makeRun(),
      repeatedFailure: { outcome: 'first_occurrence', matchingFingerprints: [], sameRevision: false, safeSummary: '' },
      noProgress: { outcome: 'progress', signals: ['new-diff'], safeSummary: '' },
      budget: okBudget,
      repairDecisionOutcome: 'allowed',
      requiresProtectedFile: false,
      requiresNewPermission: false,
      requiresDeployment: false,
      credentialsMissing: false,
      productOrArchitectureAmbiguity: false,
      sessionResumable: true,
      requiredEnforcementUnsupported: false,
      evidenceSufficientForNarrowRepair: true,
      ...overrides,
    };
  }

  it('continue same agent when healthy; compile the one revision when allowed', () => {
    expect(decideRecovery(recoveryInput({ attemptHealthy: true })).outcome).toBe('continue_same_agent');
    expect(decideRecovery(recoveryInput()).outcome).toBe('compile_revision');
  });

  it('stops (never reassigns, never second-repairs) on every founder stop condition', () => {
    const stops: Array<[Partial<RecoveryEvaluationInput>, string]> = [
      [{ repeatedFailure: { outcome: 'repeated_after_repair', matchingFingerprints: [], sameRevision: true, safeSummary: '' } }, 'checkpoint_required'],
      [{ run: makeRun({ repairCount: 1 }), repeatedFailure: { outcome: 'repeated', matchingFingerprints: [], sameRevision: true, safeSummary: '' } }, 'checkpoint_required'],
      [{ noProgress: { outcome: 'no_progress', signals: [], safeSummary: '' } }, 'checkpoint_required'],
      [{ budget: { ...okBudget, outcome: 'denied' } }, 'checkpoint_required'],
      [{ requiresNewPermission: true }, 'checkpoint_required'],
      [{ requiresProtectedFile: true }, 'blocked'],
      [{ requiresDeployment: true }, 'checkpoint_required'],
      [{ credentialsMissing: true }, 'blocked'],
      [{ productOrArchitectureAmbiguity: true }, 'checkpoint_required'],
      [{ sessionResumable: false }, 'checkpoint_required'],
      [{ requiredEnforcementUnsupported: true }, 'blocked'],
      [{ evidenceSufficientForNarrowRepair: false }, 'checkpoint_required'],
      [{ repairDecisionOutcome: 'denied' as const }, 'checkpoint_required'],
    ];
    for (const [patch, expected] of stops) {
      const decision = decideRecovery(recoveryInput(patch));
      expect(decision.outcome, JSON.stringify(patch).slice(0, 60)).toBe(expected);
      expect(['continue_same_agent', 'compile_revision']).not.toContain(decision.outcome);
    }
  });
});
