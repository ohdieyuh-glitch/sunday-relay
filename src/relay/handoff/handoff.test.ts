import { describe, expect, it } from 'vitest';
import { compileHandoff, type CompileHandoffInput } from './compiler';
import { validateHandoffPackage } from './validation';
import { compileRevisionContract, type CompileRevisionInput } from './revision';
import { evaluateAutomaticRepair } from '../recovery/repair';
import {
  deterministicIds, fixedId, makeAssignment, makeBlueprint, makePackage,
  makePermissionPolicy, makePolicy, makeProject, makeRun, makeTask, makeVerdict,
} from '../testing/factories';
import type { ContextVersion, LedgerVersion } from '../protocol/ids';
import type { Role } from '../protocol/enums';

const NOW = '2026-07-21T22:30:00.000Z';

function compileInput(overrides: Partial<CompileHandoffInput> = {}): CompileHandoffInput {
  return {
    project: makeProject(),
    run: makeRun({ status: 'active', phase: 'handoff' }),
    task: makeTask({ status: 'assigned', ownerAssignmentId: fixedId('asn') }),
    assignment: makeAssignment(),
    role: 'coding-agent',
    blueprint: makeBlueprint(),
    completionPolicy: makePolicy(),
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
    idempotencyKey: 'compile-1',
    ...overrides,
  };
}

describe('H — handoff compiler', () => {
  it('compiles a coding-agent package pinned to ledger/context/base revision with role composition', () => {
    const result = compileHandoff(compileInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { pkg, record, events } = result.value;
    expect(pkg.ledgerVersion).toBe(1);
    expect(pkg.contextVersion).toBe(1);
    expect(pkg.baseRevision).toBe('rev-abc123');
    expect(pkg.targetAdapterId).toBe('sim-coding-agent');
    expect(pkg.expectedReportType).toBe('implementation');
    expect(pkg.permittedFiles.map((f) => f.value)).toEqual(['src/sim/feature.ts']);
    expect(pkg.prohibitedActions.some((p) => p.value === 'protected:.git' && p.enforcement === 'enforced')).toBe(true);
    expect(pkg.requiredEvidence.join(' ')).toContain('policy:command:npx vitest run');
    expect(pkg.contextRefs).toContain(fixedId('blu'));
    expect(record.ledgerVersion).toBe(1);
    expect(record.inputRefs.some((r) => r.includes('run-blueprint'))).toBe(true);
    expect(events.map((e) => e.kind)).toEqual(['handoff.created']);
  });

  it('role-specific packages differ: architect/reviewer/security/operations', () => {
    const byRole = new Map<Role, ReturnType<typeof compileHandoff>>();
    for (const role of ['architect', 'reviewer', 'security-reviewer', 'operations'] as const) {
      byRole.set(role, compileHandoff(compileInput({ role, assignment: makeAssignment({ role }), idempotencyKey: `compile-${role}` })));
    }
    const architect = byRole.get('architect')!;
    const reviewer = byRole.get('reviewer')!;
    const security = byRole.get('security-reviewer')!;
    if (!architect.ok || !reviewer.ok || !security.ok) throw new Error('compilation failed');
    expect(architect.value.pkg.expectedReportType).toBe('blueprint');
    expect(reviewer.value.pkg.expectedReportType).toBe('review');
    expect(reviewer.value.pkg.responsibilityBoundary).toContain('do not trust the implementer');
    expect(security.value.pkg.requiredEvidence.join(' ')).toContain('secret-policy');
    expect(architect.value.pkg.responsibilityBoundary).not.toBe(reviewer.value.pkg.responsibilityBoundary);
  });

  it('context selection: only associated/pinned decisions included; exclusions recorded; artifacts stay references', () => {
    const relevant = { record: { decisionId: fixedId('dcn', 'rel'), at: NOW, title: 'Relevant', decision: 'd', rationale: 'r', rejectedAlternatives: [], decidedBy: 'founder' }, associatedTaskIds: [fixedId('tsk')] };
    const unrelated = { record: { decisionId: fixedId('dcn', 'far'), at: NOW, title: 'Unrelated', decision: 'd', rationale: 'r', rejectedAlternatives: [], decidedBy: 'founder' } };
    const superseded = { record: { ...relevant.record, decisionId: fixedId('dcn', 'old'), supersededBy: fixedId('dcn', 'rel') }, pinned: true };
    const result = compileHandoff(compileInput({ decisions: [relevant, unrelated, superseded], artifactRefs: ['art_big-diff'] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.pkg.contextRefs).toContain(fixedId('dcn', 'rel'));
    expect(result.value.pkg.contextRefs).not.toContain(fixedId('dcn', 'far'));
    expect(result.value.pkg.contextRefs).not.toContain(fixedId('dcn', 'old'));
    expect(result.value.record.compilerVersion).toContain('excluded=');
    expect(result.value.pkg.contextRefs).toContain('art_big-diff'); // a reference, never inlined content
  });

  it('deterministic + idempotent compilation; conflicting reuse of the key errors; wrong assignment rejected', () => {
    const a = compileHandoff(compileInput());
    const b = compileHandoff(compileInput());
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(JSON.stringify({ ...b.value.pkg, packageId: '' })).toBe(JSON.stringify({ ...a.value.pkg, packageId: '' }));

    const replay = compileHandoff(compileInput({ priorCompilations: [{ record: a.value.record, pkg: a.value.pkg, idempotencyKey: 'compile-1' }] }));
    expect(replay.ok && replay.value.idempotent).toBe(true);

    const conflicting = compileHandoff(
      compileInput({
        role: 'reviewer',
        assignment: makeAssignment({ role: 'reviewer', adapterId: 'other' }),
        priorCompilations: [{ record: a.value.record, pkg: a.value.pkg, idempotencyKey: 'compile-1' }],
      }),
    );
    expect(conflicting.ok).toBe(false);

    const wrongOwner = compileHandoff(compileInput({ assignment: makeAssignment({ taskId: fixedId('tsk', 'other') }) }));
    expect(wrongOwner.ok).toBe(false);
  });
});

describe('H — handoff validation', () => {
  const validInput = () => ({
    pkg: makePackage(),
    run: makeRun({ status: 'active' as const, phase: 'handoff' as const }),
    task: makeTask(),
    assignment: makeAssignment(),
    currentLedgerVersion: 1,
    currentBaseRevision: 'rev-abc123',
    now: NOW,
  });

  it('accepts a valid package; rejects wrong association/owner/role', () => {
    expect(validateHandoffPackage(validInput()).outcome).toBe('valid');
    expect(validateHandoffPackage({ ...validInput(), pkg: makePackage({ runId: fixedId('run', 'other') }) }).outcome).toBe('rejected');
    expect(validateHandoffPackage({ ...validInput(), assignment: makeAssignment({ adapterId: 'someone-else' }) }).outcome).toBe('rejected');
    expect(validateHandoffPackage({ ...validInput(), assignment: makeAssignment({ role: 'reviewer' }) }).outcome).toBe('rejected');
  });

  it('stale ledger/base revision rejects (or checkpoints when revalidatable); expiry rejects', () => {
    expect(validateHandoffPackage({ ...validInput(), currentLedgerVersion: 2 }).outcome).toBe('rejected');
    expect(validateHandoffPackage({ ...validInput(), currentLedgerVersion: 2, staleRevalidatable: true }).outcome).toBe('checkpoint_required');
    expect(validateHandoffPackage({ ...validInput(), currentBaseRevision: 'rev-new' }).outcome).toBe('rejected');
    expect(validateHandoffPackage({ ...validInput(), pkg: makePackage({ expiresAt: '2026-07-21T22:00:00.000Z' }) }).outcome).toBe('rejected');
  });

  it('rejects allowed/protected conflicts, credential-shaped data, unbounded packages, and unsupported required enforcement', () => {
    const conflicted = makePackage({ permittedFiles: [{ value: '.git/config', enforcement: 'advisory' }] });
    expect(validateHandoffPackage({ ...validInput(), pkg: conflicted }).errors.join(' ')).toContain('protected path');

    const leaky = makePackage({ objective: 'use sk-abcdefghijklmnop to auth' });
    expect(validateHandoffPackage({ ...validInput(), pkg: leaky }).errors.join(' ')).toContain('credential-shaped');

    const unbounded = makePackage({ budget: {}, stoppingCondition: { description: 'just stop eventually' } });
    expect(validateHandoffPackage({ ...validInput(), pkg: unbounded }).outcome).toBe('rejected');

    const needsEnforced = validateHandoffPackage({
      ...validInput(),
      requiredEnforcement: [{ control: 'worktree-isolation', minimumLevel: 'enforced' }],
    });
    expect(needsEnforced.outcome).toBe('rejected');
    expect(needsEnforced.errors.join(' ')).toContain('worktree-isolation');
  });
});

describe('L — revision contract compilation', () => {
  const allowedDecision = () =>
    evaluateAutomaticRepair({
      run: makeRun({ status: 'active', phase: 'review' }),
      task: makeTask(),
      verdict: makeVerdict('changes_requested'),
      failureEvidenceRefs: [fixedId('evd')],
      plan: {
        narrow: true, unambiguous: true, sameAgentAvailable: true, sameSessionAvailable: true,
        insideTaskObjective: true, filesTouched: ['src/sim/feature.ts'], requiresProtectedFile: false,
        requiresNewPermission: false, requiresDestructiveCommand: false, requiresDeployment: false,
        requiresNewDependency: false, requiresNewCredentials: false,
      },
      budget: { outcome: 'allowed', reasons: [], actual: { usd: 0, tokens: 0, runtimeMs: 0 }, projected: {}, estimateMissing: false, safeSummary: 'ok' },
      budgetWarningCheckpointActive: false,
      unresolvedDecisionConflict: false,
      findingConflictsWithCanonicalDecision: false,
    });

  function revisionInput(overrides: Partial<CompileRevisionInput> = {}): CompileRevisionInput {
    return {
      task: makeTask(),
      parentPackage: makePackage(),
      verdict: makeVerdict('changes_requested'),
      decision: allowedDecision(),
      failureEvidenceRefs: [fixedId('evd')],
      requiredCorrection: 'Fix R1 exactly as recommended.',
      behaviorToPreserve: ['golden path still completes'],
      verificationToRerun: ['npx vitest run'],
      budgetRemaining: { maxUsd: 0.5 },
      stoppingCondition: { description: 'stop after repair report', maxRuntimeMs: 60000 },
      ledgerVersion: 1 as LedgerVersion,
      contextVersion: 1 as ContextVersion,
      baseRevision: 'rev-abc123',
      provenance: 'simulated',
      ids: deterministicIds(),
      now: NOW,
      idempotencyKey: 'revision-1',
      ...overrides,
    };
  }

  it('compiles a narrow contract: task identity preserved, claims not expanded, all 15 evaluations recorded', () => {
    const result = compileRevisionContract(revisionInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { contract, record } = result.value;
    expect(contract.taskId).toBe(fixedId('tsk'));
    expect(contract.parentPackageId).toBe(fixedId('pkg'));
    expect(contract.findingsTargeted).toEqual(['R1']);
    expect(contract.conditionsChecked).toHaveLength(15);
    expect(contract.allowedFiles).toEqual(makeTask().claimedFiles); // never expanded
    expect(contract.protectedPaths).toEqual(['protected:.git']);
    expect(contract.behaviorToPreserve).toEqual(['golden path still completes']);
    expect(contract.ledgerVersion).toBe(1);
    expect(contract.baseRevision).toBe('rev-abc123');
    expect(record.inputRefs.join(' ')).toContain('finding:R1');
  });

  it('refuses: non-allowed decision, missing failure evidence, missing findings, foreign parent package', () => {
    const denied = { ...allowedDecision(), outcome: 'checkpoint_required' as const };
    expect(compileRevisionContract(revisionInput({ decision: denied })).ok).toBe(false);
    expect(compileRevisionContract(revisionInput({ failureEvidenceRefs: [] })).ok).toBe(false);
    expect(compileRevisionContract(revisionInput({ verdict: makeVerdict('approved') })).ok).toBe(false);
    expect(compileRevisionContract(revisionInput({ parentPackage: makePackage({ taskId: fixedId('tsk', 'other') }) })).ok).toBe(false);
  });

  it('is deterministic and idempotent per key', () => {
    const a = compileRevisionContract(revisionInput());
    const b = compileRevisionContract(revisionInput());
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(JSON.stringify({ ...b.value.contract, packageId: '' })).toBe(JSON.stringify({ ...a.value.contract, packageId: '' }));
    const replay = compileRevisionContract(revisionInput({ priorRevisions: [{ contract: a.value.contract, record: a.value.record }] }));
    expect(replay.ok && replay.value.idempotent).toBe(true);
  });
});
