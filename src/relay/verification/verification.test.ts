import { describe, expect, it } from 'vitest';
import { evaluateCompletionPolicy, type CompletionEvaluationInput } from './completion';
import { evaluateDispatchBudget, type BudgetEvaluationInput } from './budget';
import { fixedId, makeEvidence, makePolicy, makeTask, makeUsage, makeVerdict } from '../testing/factories';

const NOW = '2026-07-21T23:00:00.000Z';

function completionInput(overrides: Partial<CompletionEvaluationInput> = {}): CompletionEvaluationInput {
  return {
    policy: makePolicy({ acceptedProvenance: ['simulated'] }),
    task: makeTask(),
    evidence: [makeEvidence()],
    reviewerVerdict: makeVerdict('approved'),
    currentRepositoryRevision: 'rev-abc123',
    currentTime: NOW,
    ...overrides,
  };
}

describe('I — low-risk CompletionPolicy evaluation', () => {
  it('satisfied when required evidence passes, is fresh, correctly pinned, and independently reviewed', () => {
    const result = evaluateCompletionPolicy(completionInput());
    expect(result.outcome).toBe('satisfied');
    expect(result.satisfied).toEqual(['command:npx vitest run']);
    expect(result.reviewerIndependence).toBe('satisfied');
    expect(result.revisionMatch).toBe(true);
  });

  it('missing, failed, unavailable, unverified, and stale evidence are each honest and distinct', () => {
    expect(evaluateCompletionPolicy(completionInput({ evidence: [] })).outcome).toBe('unsatisfied');
    expect(evaluateCompletionPolicy(completionInput({ evidence: [makeEvidence({ verificationStatus: 'failed' })] })).outcome).toBe('failed');
    const unavailable = evaluateCompletionPolicy(completionInput({ evidence: [makeEvidence({ verificationStatus: 'unavailable' })] }));
    expect(unavailable.outcome).toBe('unsatisfied'); // never treated as passed
    const unverified = evaluateCompletionPolicy(completionInput({ evidence: [makeEvidence({ verificationStatus: 'unverified' })] }));
    expect(unverified.outcome).toBe('unsatisfied'); // neither passed nor failed
    const stale = evaluateCompletionPolicy(completionInput({ evidence: [makeEvidence({ repoRevision: 'rev-old' })] }));
    expect(stale.outcome).toBe('stale');
    expect(stale.revisionMatch).toBe(false);
  });

  it('agent claims cannot satisfy requirements: wrong task/run evidence never matches', () => {
    expect(evaluateCompletionPolicy(completionInput({ evidence: [makeEvidence({ taskId: fixedId('tsk', 'other') })] })).outcome).toBe('unsatisfied');
    expect(evaluateCompletionPolicy(completionInput({ evidence: [makeEvidence({ runId: fixedId('run', 'other') })] })).outcome).toBe('unsatisfied');
  });

  it('provenance: a live policy rejects simulated evidence; a simulation policy accepts it explicitly', () => {
    const livePolicy = evaluateCompletionPolicy(completionInput({ policy: makePolicy({ acceptedProvenance: undefined }) }));
    expect(livePolicy.outcome).toBe('unsatisfied');
    expect(livePolicy.requirements[0].status).toBe('provenance-rejected');
    const simPolicy = evaluateCompletionPolicy(completionInput());
    expect(simPolicy.outcome).toBe('satisfied');
  });

  it('verifier allowlist, independence requirements, and unresolved blocking findings gate completion', () => {
    const wrongVerifier = evaluateCompletionPolicy(completionInput({ policy: makePolicy({ acceptedProvenance: ['simulated'], allowedVerifiers: ['trusted-verifier'] }) }));
    expect(wrongVerifier.requirements[0].status).toBe('verifier-rejected');

    expect(evaluateCompletionPolicy(completionInput({ reviewerVerdict: undefined })).reviewerIndependence).toBe('missing');
    const selfReview = evaluateCompletionPolicy(completionInput({ reviewerVerdict: makeVerdict('approved', { independent: false }) }));
    expect(selfReview.reviewerIndependence).toBe('not-independent');
    expect(selfReview.outcome).toBe('unsatisfied');

    const blocking = evaluateCompletionPolicy(completionInput({ reviewerVerdict: makeVerdict('changes_requested') }));
    expect(blocking.unresolvedBlockingFindings).toEqual(['R1']);
    expect(blocking.outcome).toBe('unsatisfied');
    const resolved = evaluateCompletionPolicy(completionInput({ reviewerVerdict: makeVerdict('changes_requested'), resolvedFindingIds: ['R1'] }));
    expect(resolved.unresolvedBlockingFindings).toEqual([]);
  });

  it('unsupported required enforcement: low-risk → unsupported; high-risk → checkpoint_required', () => {
    const policy = makePolicy({
      acceptedProvenance: ['simulated'],
      enforcementRequirements: [{ control: 'protected-paths', minimumLevel: 'enforced' }],
    });
    const low = evaluateCompletionPolicy(completionInput({ policy, enforcementCapabilities: { 'protected-paths': 'advisory' } }));
    expect(low.outcome).toBe('unsupported');
    const high = evaluateCompletionPolicy(completionInput({ policy: { ...policy, riskLevel: 'high' }, enforcementCapabilities: {} }));
    expect(high.outcome).toBe('checkpoint_required');
    const capable = evaluateCompletionPolicy(completionInput({ policy, enforcementCapabilities: { 'protected-paths': 'enforced' } }));
    expect(capable.outcome).toBe('satisfied');
  });

  it('policy-declared requirements drive the evaluation — multiple missing requirements are all reported', () => {
    const strict = makePolicy({
      acceptedProvenance: ['simulated'],
      requiredEvidence: [
        { evidenceType: 'command', command: 'npx vitest run', mustPass: true },
        { evidenceType: 'command', command: 'npm run typecheck', mustPass: true },
        { evidenceType: 'diff', mustPass: true },
      ],
    });
    const result = evaluateCompletionPolicy(completionInput({ policy: strict }));
    expect(result.missing).toEqual(['command:npm run typecheck', 'diff']);
    // mustPass:false requirement tolerates a failing check
    const lenient = makePolicy({ acceptedProvenance: ['simulated'], requiredEvidence: [{ evidenceType: 'command', command: 'npx vitest run', mustPass: false }] });
    expect(evaluateCompletionPolicy(completionInput({ policy: lenient, evidence: [makeEvidence({ verificationStatus: 'failed' })] })).outcome).toBe('satisfied');
  });
});

describe('J — budget stop-before-dispatch', () => {
  function budgetInput(overrides: Partial<BudgetEvaluationInput> = {}): BudgetEvaluationInput {
    return {
      policy: { maxUsd: 1, warningAtFraction: 0.8, missingEstimate: 'checkpoint' },
      currentUsage: [makeUsage({ kind: 'actual', usd: 0.2 })],
      estimatedNextOperation: { usd: 0.1 },
      currentTime: NOW,
      ...overrides,
    };
  }

  it('under budget allows; warning threshold warns; projected overrun denies; actual overrun denies', () => {
    expect(evaluateDispatchBudget(budgetInput()).outcome).toBe('allowed');
    expect(evaluateDispatchBudget(budgetInput({ estimatedNextOperation: { usd: 0.65 } })).outcome).toBe('warning');
    expect(evaluateDispatchBudget(budgetInput({ estimatedNextOperation: { usd: 0.85 } })).outcome).toBe('denied');
    expect(evaluateDispatchBudget(budgetInput({ currentUsage: [makeUsage({ kind: 'actual', usd: 1.2 })], estimatedNextOperation: { usd: 0 } })).outcome).toBe('denied');
  });

  it('no rounding bypass: projected exactly one cent over the ceiling is denied', () => {
    const result = evaluateDispatchBudget(budgetInput({ currentUsage: [makeUsage({ kind: 'actual', usd: 0.995 })], estimatedNextOperation: { usd: 0.006 } }));
    expect(result.outcome).toBe('denied');
  });

  it('token, runtime, and loop/revision ceilings deny', () => {
    expect(
      evaluateDispatchBudget(budgetInput({ policy: { maxTokens: 1000 }, currentUsage: [makeUsage({ kind: 'actual', tokens: 900 })], estimatedNextOperation: { tokens: 200 } })).outcome,
    ).toBe('denied');
    expect(
      evaluateDispatchBudget(budgetInput({ policy: { maxRuntimeMs: 60000 }, currentUsage: [makeUsage({ kind: 'actual', runtimeMs: 59000 })], estimatedNextOperation: { runtimeMs: 2000 } })).outcome,
    ).toBe('denied');
    expect(
      evaluateDispatchBudget(budgetInput({ loopPolicy: { maxAutomaticRevisions: 1 }, repairCount: 2 })).outcome,
    ).toBe('denied');
  });

  it('missing estimates follow policy: allow / checkpoint / deny — always represented honestly', () => {
    expect(evaluateDispatchBudget(budgetInput({ estimatedNextOperation: null, policy: { maxUsd: 1, missingEstimate: 'allow' } })).outcome).toBe('allowed');
    expect(evaluateDispatchBudget(budgetInput({ estimatedNextOperation: null })).outcome).toBe('checkpoint_required');
    expect(evaluateDispatchBudget(budgetInput({ estimatedNextOperation: null, policy: { maxUsd: 1, missingEstimate: 'deny' } })).outcome).toBe('denied');
    const result = evaluateDispatchBudget(budgetInput({ estimatedNextOperation: null }));
    expect(result.estimateMissing).toBe(true);
  });

  it('estimated vs actual usage stay distinct; the larger governs the basis', () => {
    const result = evaluateDispatchBudget(
      budgetInput({ currentUsage: [makeUsage({ kind: 'actual', usd: 0.2 }), makeUsage({ kind: 'estimated', usd: 0.5 })], estimatedNextOperation: { usd: 0.1 } }),
    );
    expect(result.actual.usd).toBe(0.2);
    expect(result.projected.usd).toBe(0.6); // basis = max(actual, estimated) + next
  });
});
