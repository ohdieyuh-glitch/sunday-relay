import { describe, expect, it } from 'vitest';
import { assignTask } from './coordination/ownership';
import { checkDuplicateWork } from './coordination/checks';
import { acquireFileClaim } from './coordination/claims';
import { evaluateDispatchEligibility } from './coordination/eligibility';
import { compileHandoff, type CompileHandoffInput } from './handoff/compiler';
import { compileRevisionContract } from './handoff/revision';
import { evaluateCompletionPolicy } from './verification/completion';
import { evaluateDispatchBudget } from './verification/budget';
import { evaluateAutomaticRepair, type RepairPlanFacts } from './recovery/repair';
import { detectNoProgress, detectRepeatedFailure, failureFingerprint } from './recovery/detection';
import { decideRecovery } from './recovery/decision';
import {
  deterministicIds, fixedId, makeAssignment, makeBlueprint, makeEvidence,
  makePermissionPolicy, makePolicy, makeProject, makeRun, makeTask, makeUsage,
  makeVerdict,
} from './testing/factories';
import type { ContextVersion, LedgerVersion } from './protocol/ids';

/**
 * Section-24 deterministic integration scenarios: the full Prompt-3
 * coordination surface working together. No dispatch, no agents, no shell,
 * no Git — coordination metadata only.
 */

const NOW = '2026-07-21T22:30:00.000Z';

const goodPlan: RepairPlanFacts = {
  narrow: true, unambiguous: true, sameAgentAvailable: true, sameSessionAvailable: true,
  insideTaskObjective: true, filesTouched: ['src/sim/feature.ts'], requiresProtectedFile: false,
  requiresNewPermission: false, requiresDestructiveCommand: false, requiresDeployment: false,
  requiresNewDependency: false, requiresNewCredentials: false,
};

function compileInput(overrides: Partial<CompileHandoffInput> = {}): CompileHandoffInput {
  return {
    project: makeProject(),
    run: makeRun({ status: 'active', phase: 'handoff' }),
    task: makeTask({ status: 'assigned', ownerAssignmentId: fixedId('asn') }),
    assignment: makeAssignment({ leaseExpiresAt: '2026-07-21T23:00:00.000Z' }),
    role: 'coding-agent',
    blueprint: makeBlueprint(),
    completionPolicy: makePolicy({ acceptedProvenance: ['simulated'] }),
    permissionPolicy: makePermissionPolicy(),
    budget: { maxUsd: 1 },
    loopPolicy: { maxAutomaticRevisions: 1 },
    stoppingCondition: { description: 'stop after report', maxRuntimeMs: 60000 },
    ledgerVersion: 1 as LedgerVersion,
    contextVersion: 1 as ContextVersion,
    baseRevision: 'rev-abc123',
    provenance: 'simulated',
    ids: deterministicIds(),
    now: NOW,
    idempotencyKey: 'scenario-compile',
    ...overrides,
  };
}

describe('Section 24 — integration scenarios', () => {
  it('S1: eligible initial handoff — owner, lease, deps, claims, versions, budget all green; nothing dispatched', () => {
    const assigned = assignTask({
      task: makeTask({ status: 'queued' }),
      existingAssignments: [], role: 'coding-agent', adapterId: 'sim-coding-agent',
      ids: deterministicIds(), now: NOW, leaseMs: 3_600_000, provenance: 'simulated',
    });
    expect(assigned.ok).toBe(true);
    if (!assigned.ok) return;

    const compiled = compileHandoff(compileInput({ task: assigned.value.task, assignment: assigned.value.assignment }));
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    const eligibility = evaluateDispatchEligibility({
      project: makeProject(), run: makeRun({ status: 'active', phase: 'handoff' }),
      task: assigned.value.task, assignment: assigned.value.assignment,
      allTasks: [assigned.value.task], fileClaims: [], resourceClaims: [],
      handoff: compiled.value.pkg, policy: makePolicy({ acceptedProvenance: ['simulated'] }),
      usage: [], costEstimate: { usd: 0.05 }, currentLedgerVersion: 1,
      currentRepositoryRevision: 'rev-abc123', currentTime: NOW,
    });
    expect(eligibility.outcome).toBe('eligible');
    expect(eligibility.failedChecks).toEqual([]);
  });

  it('S2: duplicate work prevented — same equivalence key, no second owner or handoff', () => {
    const active = makeTask({ taskId: fixedId('tsk', 'A'), equivalenceKey: 'impl:banner', status: 'working' });
    const decision = checkDuplicateWork({ candidate: { equivalenceKey: 'impl:banner' }, existingTasks: [active] });
    expect(decision.outcome).toBe('duplicate_active');
    expect(decision.conflictingTaskIds).toEqual([fixedId('tsk', 'A')]);
    expect(decision.recommendedAction).toContain('existing task');
  });

  it('S3: file conflict prevented with conflict references', () => {
    const claimA = acquireFileClaim({ taskId: fixedId('tsk', 'A'), path: 'src/shared/core.ts', mode: 'write', existing: [], ids: deterministicIds(), now: NOW, leaseMs: 60_000 });
    if (!claimA.ok) return;
    const claimB = acquireFileClaim({ taskId: fixedId('tsk', 'B'), path: 'src/shared', mode: 'write', existing: [claimA.value.claim], ids: deterministicIds(), now: NOW, leaseMs: 60_000 });
    expect(claimB.ok).toBe(false);
    if (!claimB.ok) {
      expect(claimB.error.details?.join(' ')).toContain(fixedId('tsk', 'A'));
    }
  });

  it('S4: stale handoff prevented after the ledger advances', () => {
    const compiled = compileHandoff(compileInput());
    if (!compiled.ok) return;
    const eligibility = evaluateDispatchEligibility({
      project: makeProject(), run: makeRun({ status: 'active', phase: 'handoff' }),
      task: makeTask({ status: 'assigned', ownerAssignmentId: fixedId('asn') }),
      assignment: makeAssignment({ leaseExpiresAt: '2026-07-21T23:00:00.000Z' }),
      allTasks: [], fileClaims: [], resourceClaims: [],
      handoff: compiled.value.pkg, policy: makePolicy({ acceptedProvenance: ['simulated'] }),
      usage: [], costEstimate: { usd: 0.05 },
      currentLedgerVersion: 2, // canonical decision advanced the ledger
      currentRepositoryRevision: 'rev-abc123', currentTime: NOW,
    });
    expect(eligibility.outcome).toBe('checkpoint_required');
    expect(eligibility.failedChecks.map((c) => c.id)).toContain('ledger-current');
  });

  it('S5: low-risk completion satisfied by verified evidence only — agent claims unused', () => {
    const result = evaluateCompletionPolicy({
      policy: makePolicy({ acceptedProvenance: ['simulated'] }),
      task: makeTask(),
      evidence: [makeEvidence()],
      reviewerVerdict: makeVerdict('approved'),
      currentRepositoryRevision: 'rev-abc123',
      currentTime: NOW,
    });
    expect(result.outcome).toBe('satisfied');
    expect(result.reviewerIndependence).toBe('satisfied');
  });

  it('S6: one focused repair allowed — all 15 conditions pass, RevisionContract compiles within policy', () => {
    const run = makeRun({ status: 'active', phase: 'review', repairCount: 0 });
    const verdict = makeVerdict('changes_requested');
    const decision = evaluateAutomaticRepair({
      run, task: makeTask(), verdict, failureEvidenceRefs: [fixedId('evd')], plan: goodPlan,
      budget: evaluateDispatchBudget({ policy: { maxUsd: 1 }, currentUsage: [makeUsage({ kind: 'actual', usd: 0.1 })], estimatedNextOperation: { usd: 0.1 }, currentTime: NOW }),
      budgetWarningCheckpointActive: false, unresolvedDecisionConflict: false, findingConflictsWithCanonicalDecision: false,
    });
    expect(decision.outcome).toBe('allowed');

    const compiled = compileHandoff(compileInput());
    if (!compiled.ok) return;
    const revision = compileRevisionContract({
      task: makeTask(), parentPackage: compiled.value.pkg, verdict, decision,
      failureEvidenceRefs: [fixedId('evd')], requiredCorrection: 'Fix R1.',
      behaviorToPreserve: ['golden path'], verificationToRerun: ['npx vitest run'],
      budgetRemaining: { maxUsd: 0.8 }, stoppingCondition: { description: 'stop after repair', maxRuntimeMs: 60000 },
      ledgerVersion: 1 as LedgerVersion, contextVersion: 1 as ContextVersion, baseRevision: 'rev-abc123',
      provenance: 'simulated', ids: deterministicIds(), now: NOW, idempotencyKey: 'scenario-revision',
    });
    expect(revision.ok).toBe(true);
    if (revision.ok) {
      expect(revision.value.contract.conditionsChecked.every((c) => c.satisfied)).toBe(true);
      expect(revision.value.contract.allowedFiles).toEqual(makeTask().claimedFiles);
    }
  });

  it('S7: repair checkpointed when one required condition fails — no dispatch-eligible RevisionContract', () => {
    const decision = evaluateAutomaticRepair({
      run: makeRun({ status: 'active', phase: 'review' }), task: makeTask(),
      verdict: makeVerdict('changes_requested'), failureEvidenceRefs: [fixedId('evd')],
      plan: { ...goodPlan, requiresProtectedFile: true },
      budget: evaluateDispatchBudget({ policy: { maxUsd: 1 }, currentUsage: [], estimatedNextOperation: { usd: 0.1 }, currentTime: NOW }),
      budgetWarningCheckpointActive: false, unresolvedDecisionConflict: false, findingConflictsWithCanonicalDecision: false,
    });
    expect(decision.outcome).toBe('checkpoint_required');
    expect(decision.failedConditions).toEqual(['no-protected-file']);
    const compiled = compileHandoff(compileInput());
    if (!compiled.ok) return;
    const revision = compileRevisionContract({
      task: makeTask(), parentPackage: compiled.value.pkg, verdict: makeVerdict('changes_requested'), decision,
      failureEvidenceRefs: [fixedId('evd')], requiredCorrection: 'x', behaviorToPreserve: [], verificationToRerun: [],
      budgetRemaining: {}, stoppingCondition: { description: 's', maxRuntimeMs: 1000 },
      ledgerVersion: 1 as LedgerVersion, contextVersion: 1 as ContextVersion, baseRevision: 'rev-abc123',
      provenance: 'simulated', ids: deterministicIds(), now: NOW, idempotencyKey: 'scenario-r7',
    });
    expect(revision.ok).toBe(false);
  });

  it('S8: repeated failure + no progress stops the loop — a second repair is impossible', () => {
    const fp = failureFingerprint({ category: 'test-failure', commandIdentity: 'npx vitest run', failedTestIds: ['t1'], exitCode: 1, repoRevision: 'rev-1', taskId: 'tsk_1' });
    const repeated = detectRepeatedFailure(
      [{ fingerprint: fp, repoRevision: 'rev-1', afterRepair: false }],
      { fingerprint: fp, repoRevision: 'rev-1', afterRepair: true },
    );
    expect(repeated.outcome).toBe('repeated_after_repair');
    const noProgress = detectNoProgress(
      { diffFingerprint: 'd1', evidenceIds: ['e1'], blockingFindingIds: ['R1'], failureFingerprint: fp },
      { diffFingerprint: 'd1', evidenceIds: ['e1'], blockingFindingIds: ['R1'], failureFingerprint: fp },
    );
    expect(noProgress.outcome).toBe('no_progress');
    const recovery = decideRecovery({
      run: makeRun({ repairCount: 1 }), repeatedFailure: repeated, noProgress,
      budget: evaluateDispatchBudget({ policy: { maxUsd: 1 }, currentUsage: [], estimatedNextOperation: { usd: 0.1 }, currentTime: NOW }),
      repairDecisionOutcome: 'denied', requiresProtectedFile: false, requiresNewPermission: false,
      requiresDeployment: false, credentialsMissing: false, productOrArchitectureAmbiguity: false,
      sessionResumable: true, requiredEnforcementUnsupported: false, evidenceSufficientForNarrowRepair: true,
    });
    expect(recovery.outcome).toBe('checkpoint_required');
    expect(recovery.reasons).toContain('repeated-after-repair');
  });

  it('S9: budget stops dispatch — projected overrun denies eligibility with budget evidence', () => {
    const compiled = compileHandoff(compileInput());
    if (!compiled.ok) return;
    const eligibility = evaluateDispatchEligibility({
      project: makeProject(), run: makeRun({ status: 'active', phase: 'handoff' }),
      task: makeTask({ status: 'assigned', ownerAssignmentId: fixedId('asn') }),
      assignment: makeAssignment({ leaseExpiresAt: '2026-07-21T23:00:00.000Z' }),
      allTasks: [], fileClaims: [], resourceClaims: [],
      handoff: compiled.value.pkg, policy: makePolicy({ acceptedProvenance: ['simulated'] }),
      usage: [makeUsage({ kind: 'actual', usd: 0.9 })], costEstimate: { usd: 0.5 },
      currentLedgerVersion: 1, currentRepositoryRevision: 'rev-abc123', currentTime: NOW,
    });
    expect(eligibility.outcome).toBe('denied');
    expect(eligibility.failedChecks.map((c) => c.id)).toContain('budget-permits');
    expect(eligibility.projectedBudget.outcome).toBe('denied');
    expect(eligibility.projectedBudget.reasons.join(' ')).toContain('exceeds the hard ceiling');
  });
});
