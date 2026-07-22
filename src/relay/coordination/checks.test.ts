import { describe, expect, it } from 'vitest';
import {
  checkDependencies, checkDuplicateWork, validateBaseRevision, validateDecisionCurrency,
  validateEvidenceFreshness, validateHandoffFreshness, validateLedgerVersion,
} from './checks';
import { fixedId, makeTask } from '../testing/factories';
import type { RelayTask } from '../protocol/contracts';
import type { TaskId } from '../protocol/ids';

const tid = (t: string) => fixedId('tsk', t);

describe('B — duplicate-work prevention (structured keys only)', () => {
  const key = 'impl:spend-banner:v1';

  it('flags an equivalent ACTIVE task and an equivalent COMPLETED task', () => {
    const active = checkDuplicateWork({ candidate: { equivalenceKey: key }, existingTasks: [makeTask({ taskId: tid('a'), equivalenceKey: key, status: 'working' })] });
    expect(active.outcome).toBe('duplicate_active');
    expect(active.conflictingTaskIds).toEqual([tid('a')]);

    const completed = checkDuplicateWork({
      candidate: { equivalenceKey: key },
      existingTasks: [makeTask({ taskId: tid('b'), equivalenceKey: key, status: 'completed', completionEvidenceRefs: [fixedId('bnd')] })],
    });
    expect(completed.outcome).toBe('duplicate_completed');
    expect(completed.evidenceRefs).toEqual([fixedId('bnd')]);
  });

  it('idempotency-key reuse maps to the existing task', () => {
    const result = checkDuplicateWork({
      candidate: { equivalenceKey: key, idempotencyKey: 'create-1' },
      existingTasks: [],
      idempotencyIndex: new Map([['create-1', tid('orig')]]),
    });
    expect(result.outcome).toBe('duplicate_active');
    expect(result.reasonCode).toBe('idempotency-key-reuse');
  });

  it('supersession, decision obsolescence, revision-of, retry policy, and distinct keys', () => {
    const superseded = checkDuplicateWork({
      candidate: { equivalenceKey: key },
      existingTasks: [makeTask({ taskId: tid('old'), equivalenceKey: key, status: 'working', supersededBy: tid('new') })],
    });
    expect(superseded.outcome).toBe('superseded');

    const obsolete = checkDuplicateWork({
      candidate: { equivalenceKey: key },
      existingTasks: [],
      obsoletingDecisions: [{ decisionId: fixedId('dcn'), obsoletesEquivalenceKey: key }],
    });
    expect(obsolete.outcome).toBe('obsolete');
    expect(obsolete.decisionIds).toEqual([fixedId('dcn')]);

    const revision = checkDuplicateWork({ candidate: { revisionOf: tid('parent') }, existingTasks: [makeTask({ taskId: tid('parent') })] });
    expect(revision.outcome).toBe('revision_of_existing');

    const failedTask = makeTask({ taskId: tid('f'), equivalenceKey: key, status: 'failed' });
    expect(checkDuplicateWork({ candidate: { equivalenceKey: key }, existingTasks: [failedTask], retryFailedAllowed: true }).outcome).toBe('retry_allowed');
    expect(checkDuplicateWork({ candidate: { equivalenceKey: key }, existingTasks: [failedTask] }).outcome).toBe('checkpoint_required');

    const different = checkDuplicateWork({ candidate: { equivalenceKey: 'other-key' }, existingTasks: [makeTask({ equivalenceKey: key, status: 'working' })] });
    expect(different.outcome).toBe('clear'); // no semantic claims — distinct keys never match
  });
});

describe('C — dependency validation', () => {
  const dep = (taskId: TaskId, overrides: Partial<RelayTask> = {}) => makeTask({ taskId, ...overrides });
  const withDeps = (deps: TaskId[]) => makeTask({ taskId: tid('main'), dependencies: deps });
  const byId = (...tasks: RelayTask[]) => new Map(tasks.map((t) => [t.taskId, t]));

  it('eligible when every dependency completed with evidence; blocked otherwise', () => {
    const done = dep(tid('d1'), { status: 'completed', completionEvidenceRefs: [fixedId('bnd')] });
    const task = withDeps([done.taskId]);
    expect(checkDependencies({ task, taskById: byId(task, done), requireCompletionEvidence: true }).outcome).toBe('eligible');

    const noEvidence = dep(tid('d2'), { status: 'completed' });
    const t2 = withDeps([noEvidence.taskId]);
    expect(checkDependencies({ task: t2, taskById: byId(t2, noEvidence), requireCompletionEvidence: true }).outcome).toBe('blocked');
  });

  it('missing → invalid; incomplete/cancelled/obsolete → blocked; failed → policy', () => {
    const task = withDeps([tid('ghost')]);
    expect(checkDependencies({ task, taskById: byId(task) }).outcome).toBe('invalid');

    for (const status of ['working', 'cancelled', 'obsolete'] as const) {
      const d = dep(tid(`d-${status}`), { status });
      const t = withDeps([d.taskId]);
      expect(checkDependencies({ task: t, taskById: byId(t, d) }).outcome, status).toBe('blocked');
    }
    const failed = dep(tid('df'), { status: 'failed' });
    const t = withDeps([failed.taskId]);
    expect(checkDependencies({ task: t, taskById: byId(t, failed) }).outcome).toBe('blocked');
    expect(checkDependencies({ task: t, taskById: byId(t, failed), failedDependencyBehavior: 'checkpoint_required' }).outcome).toBe('checkpoint_required');
  });

  it('supersession follows the replacement; self and circular dependencies are invalid; stale deps checkpoint', () => {
    const replacement = dep(tid('new'), { status: 'completed', completionEvidenceRefs: [fixedId('bnd')] });
    const old = dep(tid('old'), { status: 'obsolete', supersededBy: replacement.taskId });
    const task = withDeps([old.taskId]);
    expect(checkDependencies({ task, taskById: byId(task, old, replacement), requireCompletionEvidence: true }).outcome).toBe('eligible');

    const selfDep = makeTask({ taskId: tid('self'), dependencies: [tid('self')] });
    expect(checkDependencies({ task: selfDep, taskById: byId(selfDep) }).outcome).toBe('invalid');

    const a = makeTask({ taskId: tid('ca'), dependencies: [tid('cb')] });
    const b = makeTask({ taskId: tid('cb'), dependencies: [tid('ca')] });
    const circular = checkDependencies({ task: a, taskById: byId(a, b) });
    expect(circular.outcome).toBe('invalid');
    expect(circular.circularPath).toBeDefined();

    const stale = dep(tid('ds'), { status: 'completed', completionEvidenceRefs: [fixedId('bnd')], contextVersion: 1 as RelayTask['contextVersion'] });
    const t = withDeps([stale.taskId]);
    expect(
      checkDependencies({ task: t, taskById: byId(t, stale), requireCompletionEvidence: true, minimumDependencyContextVersion: 5 }).outcome,
    ).toBe('checkpoint_required');
  });
});

describe('F — version & staleness validation', () => {
  it('ledger/context versions: current, stale (revalidatable vs blocking), unavailable, invalid', () => {
    expect(validateLedgerVersion(4, 4).status).toBe('current');
    expect(validateLedgerVersion(3, 4).status).toBe('stale_blocking');
    expect(validateLedgerVersion(3, 4, { revalidatable: true }).status).toBe('stale_but_revalidatable');
    expect(validateLedgerVersion(undefined, 4).status).toBe('unavailable');
    expect(validateLedgerVersion(-1, 4).status).toBe('invalid');
  });

  it('base revision honesty: missing current revision is unavailable, never assumed current', () => {
    expect(validateBaseRevision('rev-a', 'rev-a').status).toBe('current');
    expect(validateBaseRevision('rev-a', 'rev-b').status).toBe('stale_blocking');
    expect(validateBaseRevision('rev-a', undefined).status).toBe('unavailable');
    expect(validateBaseRevision(undefined, 'rev-b').status).toBe('unavailable');
  });

  it('decision supersession invalidates; superseded decisions do not', () => {
    const task = makeTask();
    const decision = { decisionId: fixedId('dcn'), at: 't', title: 'T', decision: 'd', rationale: 'r', rejectedAlternatives: [], decidedBy: 'founder' };
    expect(validateDecisionCurrency(task, [{ decision, conflictsWithTask: true }]).status).toBe('stale_blocking');
    expect(validateDecisionCurrency(task, [{ decision: { ...decision, supersededBy: fixedId('dcn', '2') }, conflictsWithTask: true }]).status).toBe('current');
  });

  it('handoff freshness: stale ledger blocks; expiry blocks; current passes', () => {
    const pkg = { ledgerVersion: 5, contextVersion: 5, baseRevision: 'rev-a' };
    expect(validateHandoffFreshness(pkg, { ledgerVersion: 5, baseRevision: 'rev-a', now: 'T' }).status).toBe('current');
    expect(validateHandoffFreshness(pkg, { ledgerVersion: 6, baseRevision: 'rev-a', now: 'T' }).status).toBe('stale_blocking');
    expect(validateHandoffFreshness({ ...pkg, expiresAt: '2026-01-01' }, { ledgerVersion: 5, baseRevision: 'rev-a', now: '2026-07-21' }).status).toBe('stale_blocking');
  });

  it('evidence freshness: old-revision evidence blocks unless policy explicitly allows it', () => {
    const evidence = { repoRevision: 'rev-a', executedAt: 'T' };
    expect(validateEvidenceFreshness(evidence, { baseRevision: 'rev-a', now: 'T' }).status).toBe('current');
    expect(validateEvidenceFreshness(evidence, { baseRevision: 'rev-b', now: 'T' }).status).toBe('stale_blocking');
    expect(validateEvidenceFreshness(evidence, { baseRevision: 'rev-b', now: 'T', allowOldRevision: true }).status).toBe('stale_but_revalidatable');
  });
});
