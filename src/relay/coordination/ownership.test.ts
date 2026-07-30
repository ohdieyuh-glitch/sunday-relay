import { describe, expect, it } from 'vitest';
import {
  assignTask, expireTaskLease, inspectTaskOwnership, leaseState, releaseTask,
  renewTaskLease, transferTaskOwnership, type AssignmentWithKey,
} from './ownership';
import { deterministicIds, fixedId, makeAssignment, makeTask } from '../testing/factories';

const NOW = '2026-07-21T22:30:00.000Z';
const LEASE_MS = 60_000;

const base = () => ({
  task: makeTask({ status: 'queued' as const }),
  existingAssignments: [] as AssignmentWithKey[],
  role: 'coding-agent' as const,
  adapterId: 'sim-coding-agent',
  ids: deterministicIds(),
  now: NOW,
  leaseMs: LEASE_MS,
  provenance: 'simulated' as const,
});

describe('A — ownership', () => {
  it('assigns an unowned task with a valid lease and emits task.assigned', () => {
    const result = assignTask(base());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.task.status).toBe('assigned');
    expect(result.value.task.ownerAssignmentId).toBe(result.value.assignment.assignmentId);
    expect(result.value.assignment.leaseExpiresAt).toBe('2026-07-21T22:31:00.000Z');
    expect(result.value.events.map((e) => e.kind)).toEqual(['task.assigned']);
  });

  it('rejects a second active owner (one owner at a time)', () => {
    const first = assignTask(base());
    if (!first.ok) throw new Error(`assignTask failed: ${first.error.message}`);
    const second = assignTask({ ...base(), task: first.value.task, existingAssignments: [first.value.assignment], adapterId: 'other-agent' });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe('duplicate-task');
  });

  it('idempotent same assignment returns the original; conflicting key errors', () => {
    const input = { ...base(), idempotencyKey: 'assign-1' };
    const first = assignTask(input);
    if (!first.ok) throw new Error(`assignTask failed: ${first.error.message}`);
    const replay = assignTask({ ...input, existingAssignments: [first.value.assignment] });
    expect(replay.ok).toBe(true);
    if (replay.ok) expect(replay.value.assignment.assignmentId).toBe(first.value.assignment.assignmentId);
    const conflicting = assignTask({ ...input, existingAssignments: [first.value.assignment], adapterId: 'someone-else' });
    expect(conflicting.ok).toBe(false);
    if (!conflicting.ok) expect(conflicting.error.code).toBe('duplicate-idempotency-key');
  });

  it('rejects terminal, superseded, and obsolete tasks', () => {
    for (const status of ['completed', 'failed', 'cancelled', 'obsolete'] as const) {
      const result = assignTask({ ...base(), task: makeTask({ status }) });
      expect(result.ok, status).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('immutable');
    }
    const superseded = assignTask({ ...base(), task: makeTask({ status: 'queued', supersededBy: fixedId('tsk', 'newer') }) });
    expect(superseded.ok).toBe(false);
  });

  it('transfer supersedes the previous assignment and preserves history; renewal after transfer fails', () => {
    const first = assignTask(base());
    if (!first.ok) throw new Error(`assignTask failed: ${first.error.message}`);
    const transferred = transferTaskOwnership({
      ...base(),
      task: first.value.task,
      existingAssignments: [first.value.assignment],
      currentAssignment: first.value.assignment,
      adapterId: 'replacement-agent',
    });
    expect(transferred.ok).toBe(true);
    if (!transferred.ok) return;
    const superseded = transferred.value.endedAssignments[0];
    expect(superseded.endReason).toBe('superseded');
    expect(leaseState(superseded, NOW)).toBe('superseded');
    expect(transferred.value.assignment.adapterId).toBe('replacement-agent');
    expect(transferred.value.events.some((e) => e.kind === 'task.ownership_changed')).toBe(true);

    const lateRenewal = renewTaskLease({ task: transferred.value.task, assignment: superseded, requestedBy: 'sim-coding-agent', now: NOW, leaseMs: LEASE_MS });
    expect(lateRenewal.ok).toBe(false);
  });

  it('release returns the task to queued with no owner and keeps the record historical', () => {
    const first = assignTask(base());
    if (!first.ok) throw new Error(`assignTask failed: ${first.error.message}`);
    const released = releaseTask({ task: first.value.task, assignment: first.value.assignment, now: NOW, reason: 'operator request' });
    expect(released.ok).toBe(true);
    if (!released.ok) return;
    expect(released.value.task.status).toBe('queued');
    expect(released.value.task.ownerAssignmentId).toBeNull();
    expect(released.value.assignment.endedAt).toBe(NOW);
  });

  it('ownership from report strings is untrusted — inspect uses coordination state only', () => {
    const assignment = makeAssignment();
    const view = inspectTaskOwnership(makeTask(), [assignment], NOW);
    expect(view.owner?.assignmentId).toBe(assignment.assignmentId);
    expect(view.history).toHaveLength(1);
  });
});

describe('B — lease boundaries', () => {
  const expiring = makeAssignment({ leaseExpiresAt: '2026-07-21T22:31:00.000Z' });

  it('active before, expired AT, expired after the boundary', () => {
    expect(leaseState(expiring, '2026-07-21T22:30:59.999Z')).toBe('active');
    expect(leaseState(expiring, '2026-07-21T22:31:00.000Z')).toBe('expired');
    expect(leaseState(expiring, '2026-07-21T22:31:00.001Z')).toBe('expired');
  });

  it('renewal works for the owner on an active lease only; wrong owner rejected', () => {
    const task = makeTask({ status: 'working', ownerAssignmentId: expiring.assignmentId });
    const renewed = renewTaskLease({ task, assignment: expiring, requestedBy: 'sim-coding-agent', now: '2026-07-21T22:30:30.000Z', leaseMs: LEASE_MS });
    expect(renewed.ok).toBe(true);
    if (renewed.ok) expect(renewed.value.assignment.leaseExpiresAt).toBe('2026-07-21T22:31:30.000Z');

    const wrongOwner = renewTaskLease({ task, assignment: expiring, requestedBy: 'impostor', now: '2026-07-21T22:30:30.000Z', leaseMs: LEASE_MS });
    expect(wrongOwner.ok).toBe(false);
    if (!wrongOwner.ok) expect(wrongOwner.error.code).toBe('permission-denied');

    const expired = renewTaskLease({ task, assignment: expiring, requestedBy: 'sim-coding-agent', now: '2026-07-21T22:32:00.000Z', leaseMs: LEASE_MS });
    expect(expired.ok).toBe(false);

    const terminal = renewTaskLease({ task: makeTask({ status: 'completed' }), assignment: expiring, requestedBy: 'sim-coding-agent', now: '2026-07-21T22:30:30.000Z', leaseMs: LEASE_MS });
    expect(terminal.ok).toBe(false);
    if (!terminal.ok) expect(terminal.error.code).toBe('immutable');
  });

  it('explicit expiry recovery: task requeued, no silent transfer, history preserved', () => {
    const task = makeTask({ status: 'working', ownerAssignmentId: expiring.assignmentId, leaseExpiresAt: expiring.leaseExpiresAt });
    const notDue = expireTaskLease({ task, assignment: expiring, now: '2026-07-21T22:30:00.000Z' });
    expect(notDue.ok).toBe(false);
    const recovered = expireTaskLease({ task, assignment: expiring, now: '2026-07-21T22:31:00.000Z' });
    expect(recovered.ok).toBe(true);
    if (!recovered.ok) return;
    expect(recovered.value.task.status).toBe('queued');
    expect(recovered.value.task.ownerAssignmentId).toBeNull();
    expect(recovered.value.assignment.endReason).toBe('lease-expired');
    expect(recovered.value.events.map((e) => e.kind)).toEqual(['task.lease_expired']);
  });

  it('lease state survives serialization', () => {
    const roundTrip = JSON.parse(JSON.stringify(expiring));
    expect(leaseState(roundTrip, '2026-07-21T22:32:00.000Z')).toBe('expired');
  });
});
