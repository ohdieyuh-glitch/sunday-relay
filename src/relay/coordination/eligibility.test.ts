import { describe, expect, it } from 'vitest';
import { evaluateDispatchEligibility, type DispatchEligibilityInput } from './eligibility';
import {
  fixedId, makeAssignment, makeFileClaim, makePackage, makePolicy, makeProject,
  makeRun, makeTask, makeUsage,
} from '../testing/factories';

const NOW = '2026-07-21T22:30:00.000Z';

export function eligibleInput(overrides: Partial<DispatchEligibilityInput> = {}): DispatchEligibilityInput {
  const task = makeTask({ status: 'assigned', ownerAssignmentId: fixedId('asn') });
  return {
    project: makeProject(),
    run: makeRun({ status: 'active', phase: 'handoff' }),
    task,
    assignment: makeAssignment({ leaseExpiresAt: '2026-07-21T23:00:00.000Z' }),
    allTasks: [task],
    fileClaims: [],
    resourceClaims: [],
    handoff: makePackage(),
    policy: makePolicy({ acceptedProvenance: ['simulated'] }),
    usage: [],
    costEstimate: { usd: 0.05 },
    currentLedgerVersion: 1,
    currentRepositoryRevision: 'rev-abc123',
    currentTime: NOW,
    ...overrides,
  };
}

describe('G — centralized pre-execution battery', () => {
  it('a fully eligible task passes every check and mutates nothing', () => {
    const input = eligibleInput();
    const before = JSON.stringify(input.task);
    const result = evaluateDispatchEligibility(input);
    expect(result.outcome).toBe('eligible');
    expect(result.failedChecks).toEqual([]);
    expect(JSON.stringify(input.task)).toBe(before); // evaluator never mutates
    expect(result.projectedBudget.outcome).toBe('allowed');
  });

  const failureCases: Array<[string, Partial<DispatchEligibilityInput>, string, string]> = [
    ['missing project', { project: null }, 'denied', 'project-exists'],
    ['missing owner', { assignment: null }, 'blocked', 'task-owned'],
    ['expired lease', { assignment: makeAssignment({ leaseExpiresAt: '2026-07-21T22:00:00.000Z' }) }, 'blocked', 'lease-valid'],
    ['wrong run phase', { run: makeRun({ status: 'active', phase: 'blueprint' }) }, 'blocked', 'run-dispatchable'],
    ['terminal task', { task: makeTask({ status: 'completed' }) }, 'denied', 'task-not-terminal'],
    ['stale ledger', { currentLedgerVersion: 5 }, 'checkpoint_required', 'ledger-current'],
    ['stale base revision', { currentRepositoryRevision: 'rev-new' }, 'checkpoint_required', 'base-revision-current'],
    ['missing handoff', { handoff: null }, 'denied', 'handoff-valid'],
    ['budget denial', { costEstimate: { usd: 5 } }, 'denied', 'budget-permits'],
    ['cancellation', { run: makeRun({ status: 'cancelled' }) }, 'denied', 'no-cancellation'],
    [
      'active checkpoint',
      { run: makeRun({ status: 'checkpoint_required', checkpoint: { checkpointId: fixedId('ckp'), runId: fixedId('run'), reason: 'r', requestedAt: NOW } }) },
      'checkpoint_required',
      'no-open-checkpoint',
    ],
    [
      'repeated failure stop',
      { repeatedFailure: { outcome: 'repeated_after_repair', matchingFingerprints: [], sameRevision: true, safeSummary: 'stop' } },
      'checkpoint_required',
      'no-repeated-failure-stop',
    ],
    [
      'no-progress stop',
      { noProgress: { outcome: 'no_progress', signals: [], safeSummary: 'stop' } },
      'checkpoint_required',
      'no-no-progress-stop',
    ],
    ['idempotency mismatch', { expectedIdempotencyKey: 'different-key' }, 'denied', 'idempotency-satisfied'],
  ];

  it.each(failureCases)('%s → structured failure', (_name, patch, outcome, checkId) => {
    const result = evaluateDispatchEligibility(eligibleInput(patch));
    expect(result.outcome).toBe(outcome);
    expect(result.failedChecks.map((c) => c.id)).toContain(checkId);
  });

  it('duplicate equivalent task, incomplete dependency, file conflict, decision invalidation', () => {
    const task = makeTask({ status: 'assigned', ownerAssignmentId: fixedId('asn'), equivalenceKey: 'impl:x' });
    const twin = makeTask({ taskId: fixedId('tsk', 'twin'), equivalenceKey: 'impl:x', status: 'working' });
    const dup = evaluateDispatchEligibility(eligibleInput({ task, allTasks: [task, twin] }));
    expect(dup.failedChecks.map((c) => c.id)).toContain('no-duplicate-work');

    const dependent = makeTask({ status: 'assigned', ownerAssignmentId: fixedId('asn'), dependencies: [fixedId('tsk', 'dep')] });
    const incompleteDep = makeTask({ taskId: fixedId('tsk', 'dep'), status: 'working' });
    const deps = evaluateDispatchEligibility(eligibleInput({ task: dependent, allTasks: [dependent, incompleteDep] }));
    expect(deps.failedChecks.map((c) => c.id)).toContain('dependencies-satisfied');

    const conflict = evaluateDispatchEligibility(
      eligibleInput({ fileClaims: [makeFileClaim({ taskId: fixedId('tsk', 'other'), path: 'src/sim/feature.ts' })] }),
    );
    expect(conflict.outcome).toBe('blocked');
    expect(conflict.failedChecks.map((c) => c.id)).toContain('file-claims-clear');

    const invalidated = evaluateDispatchEligibility(
      eligibleInput({
        decisionsSinceContext: [
          { decision: { decisionId: fixedId('dcn'), at: NOW, title: 'Drop', decision: 'd', rationale: 'r', rejectedAlternatives: [], decidedBy: 'founder' }, conflictsWithTask: true },
        ],
      }),
    );
    expect(invalidated.outcome).toBe('denied');
    expect(invalidated.failedChecks.map((c) => c.id)).toContain('no-invalidating-decision');
  });

  it('multiple failed checks are all returned together with required user actions', () => {
    const result = evaluateDispatchEligibility(eligibleInput({ assignment: null, currentLedgerVersion: 9, costEstimate: { usd: 100 } }));
    expect(result.failedChecks.length).toBeGreaterThanOrEqual(3);
    expect(result.outcome).toBe('denied'); // denied outranks blocked/checkpoint
    expect(result.safeSummary).toContain('checks failed');
  });

  it('budget warning is a warning, not a denial', () => {
    const result = evaluateDispatchEligibility(
      eligibleInput({ usage: [makeUsage({ kind: 'actual', usd: 0.7 })], costEstimate: { usd: 0.15 }, handoff: makePackage({ budget: { maxUsd: 1, warningAtFraction: 0.8 } }) }),
    );
    expect(result.outcome).toBe('eligible');
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
