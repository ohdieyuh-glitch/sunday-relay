import { describe, expect, it } from 'vitest';
import {
  assignOwner, checkDecisionInvalidation, checkStaleContext, checkStaleLedgerVersion,
  expireLeaseIfDue, transitionTask,
} from './task-machine';
import { fixedId, makePolicy, makeTask } from '../testing/factories';
import type { RelayTask, TaskAssignment } from '../protocol/contracts';
import type { ContextVersion, LedgerVersion } from '../protocol/ids';

const NOW = '2026-07-21T23:00:00.000Z';

const assignment = (overrides: Partial<TaskAssignment> = {}): TaskAssignment => ({
  assignmentId: fixedId('asn'),
  taskId: fixedId('tsk'),
  role: 'coding-agent',
  adapterId: 'sim-coding-agent',
  assignedAt: NOW,
  provenance: 'simulated',
  ...overrides,
});

describe('I — task lifecycle and invariants', () => {
  it('creates, queues, assigns (explicit ownership), works, reviews, completes with evidence', () => {
    let task = makeTask();
    for (const to of ['queued'] as const) {
      const r = transitionTask(task, to, { now: NOW });
      expect(r.ok).toBe(true);
      if (r.ok) task = r.value;
    }
    const assigned = assignOwner(task, assignment(), NOW);
    expect(assigned.ok).toBe(true);
    if (!assigned.ok) return;
    expect(assigned.value.status).toBe('assigned');
    expect(assigned.value.ownerAssignmentId).toBe(fixedId('asn'));

    const working = transitionTask(assigned.value, 'working', { now: NOW });
    expect(working.ok).toBe(true);
    if (!working.ok) return;
    const reviewing = transitionTask(working.value, 'reviewing', { now: NOW });
    expect(reviewing.ok).toBe(true);
    if (!reviewing.ok) return;
    const completed = transitionTask(reviewing.value, 'completed', {
      now: NOW,
      completionPolicy: makePolicy(),
      completionEvidenceRefs: [fixedId('bnd')],
    });
    expect(completed.ok).toBe(true);
    if (completed.ok) expect(completed.value.completionEvidenceRefs).toEqual([fixedId('bnd')]);
  });

  it('owner is required before working', () => {
    const task = makeTask({ status: 'assigned', ownerAssignmentId: null });
    const result = transitionTask(task, 'working', { now: NOW });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('owner');
  });

  it('completion without required evidence is refused (evidence-required)', () => {
    const task = makeTask({ status: 'reviewing' });
    const result = transitionTask(task, 'completed', { now: NOW, completionPolicy: makePolicy() });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('evidence-required');
    // A policy with no required evidence permits completion without refs.
    const lenient = transitionTask(task, 'completed', {
      now: NOW,
      completionPolicy: makePolicy({ requiredEvidence: [] }),
    });
    expect(lenient.ok).toBe(true);
  });

  it('revision_required must reference a blocking finding or failure', () => {
    const task = makeTask({ status: 'reviewing' });
    const bare = transitionTask(task, 'revision_required', { now: NOW });
    expect(bare.ok).toBe(false);
    if (!bare.ok) expect(bare.error.code).toBe('evidence-required');
    const withFinding = transitionTask(task, 'revision_required', { now: NOW, findingIds: ['R1'] });
    expect(withFinding.ok).toBe(true);
    if (withFinding.ok) expect(withFinding.value.revisionRefs?.findingIds).toEqual(['R1']);
  });

  it('terminal protection: completed cannot return to working; cancelled cannot complete; obsolete cannot assign', () => {
    const completed = makeTask({ status: 'completed' });
    const backToWork = transitionTask(completed, 'working', { now: NOW, ownerAssignmentId: fixedId('asn') });
    expect(backToWork.ok).toBe(false);
    if (!backToWork.ok) expect(backToWork.error.code).toBe('immutable');

    const cancelled = makeTask({ status: 'cancelled' });
    expect(transitionTask(cancelled, 'completed', { now: NOW }).ok).toBe(false);

    const obsolete = makeTask({ status: 'obsolete' });
    const assignObsolete = assignOwner(obsolete, assignment(), NOW);
    expect(assignObsolete.ok).toBe(false);
    if (!assignObsolete.ok) expect(assignObsolete.error.code).toBe('immutable');
  });

  it('illegal adjacent transitions are structured errors', () => {
    const proposed = makeTask();
    const jump = transitionTask(proposed, 'working', { now: NOW, ownerAssignmentId: fixedId('asn') });
    expect(jump.ok).toBe(false);
    if (!jump.ok) expect(jump.error.code).toBe('illegal-transition');
  });

  it('ownership changes are explicit and mismatched assignments are refused', () => {
    const task = makeTask({ status: 'queued' });
    const wrongTask = assignOwner(task, assignment({ taskId: fixedId('tsk', 'other') }), NOW);
    expect(wrongTask.ok).toBe(false);
  });
});

describe('I — staleness primitives and lease recovery', () => {
  it('records context/ledger versions and detects staleness deterministically', () => {
    const task: RelayTask = makeTask({ contextVersion: 3 as ContextVersion });
    expect(task.contextVersion).toBe(3);
    expect(task.baseRevision).toBe('rev-abc123');
    expect(checkStaleContext(task, 3 as LedgerVersion).ok).toBe(true);
    const stale = checkStaleContext(task, 5 as LedgerVersion);
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error.code).toBe('stale-context');

    expect(checkStaleLedgerVersion(4, 4).ok).toBe(true);
    const conflict = checkStaleLedgerVersion(4, 6);
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) expect(conflict.error.code).toBe('stale-ledger-version');
  });

  it('invalidated-by-decision primitive flags conflicting accepted decisions', () => {
    const task = makeTask();
    const decision = {
      decisionId: fixedId('dcn'), at: NOW, title: 'Drop this feature', decision: 'd',
      rationale: 'r', rejectedAlternatives: [], decidedBy: 'founder',
    };
    expect(checkDecisionInvalidation(task, [{ decision, conflictsWithTask: false }]).ok).toBe(true);
    const invalidated = checkDecisionInvalidation(task, [{ decision, conflictsWithTask: true }]);
    expect(invalidated.ok).toBe(false);
    if (!invalidated.ok) expect(invalidated.error.code).toBe('invalidated-by-decision');
  });

  it('expired leases return the task to queued with no owner (crash recovery)', () => {
    const task = makeTask({ status: 'working', ownerAssignmentId: fixedId('asn'), leaseExpiresAt: '2026-07-21T22:59:00.000Z' });
    const recovered = expireLeaseIfDue(task, NOW);
    expect(recovered?.status).toBe('queued');
    expect(recovered?.ownerAssignmentId).toBeNull();
    // Not due → untouched; terminal → untouched.
    expect(expireLeaseIfDue(makeTask({ status: 'working', ownerAssignmentId: fixedId('asn'), leaseExpiresAt: '2026-07-22T01:00:00.000Z' }), NOW)).toBeNull();
    expect(expireLeaseIfDue(makeTask({ status: 'completed', leaseExpiresAt: '2026-07-21T22:00:00.000Z' }), NOW)).toBeNull();
  });
});
