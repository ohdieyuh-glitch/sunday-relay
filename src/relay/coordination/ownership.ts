import { fail, ok, relayError, type RelayResult } from '../protocol/errors';
import type { RelayTask, TaskAssignment } from '../protocol/contracts';
import type { EventDraft } from '../protocol/envelopes';
import type { AssignmentId, IdFactory, SessionRefId } from '../protocol/ids';
import type { Provenance, Role } from '../protocol/enums';
import { TERMINAL_TASK_STATUSES } from '../protocol/enums';
import { RELAY_PROTOCOL_VERSION } from '../protocol/version';

/**
 * Task ownership + leases (Prompt 3, PROTOCOL §2.4–2.5). One active owner
 * per task; leases expire with injected time; expiry never silently
 * transfers ownership — recovery creates NEW records; history is
 * append-only (ended assignments keep endedAt/endReason). Trusted ownership
 * lives HERE, never in agent-report strings. Operations are pure: they
 * return updated records + event drafts; the caller persists/appends.
 */

export type LeaseState = 'active' | 'expired' | 'released' | 'superseded';

export function leaseState(assignment: TaskAssignment, now: string): LeaseState {
  if (assignment.endedAt) {
    return assignment.endReason === 'superseded' ? 'superseded' : 'released';
  }
  // Boundary rule: a lease is expired AT its expiration instant.
  if (assignment.leaseExpiresAt && assignment.leaseExpiresAt <= now) return 'expired';
  return 'active';
}

export function activeAssignment(
  assignments: readonly TaskAssignment[],
  taskId: RelayTask['taskId'],
  now: string,
): TaskAssignment | null {
  return assignments.find((a) => a.taskId === taskId && leaseState(a, now) === 'active') ?? null;
}

export interface AssignTaskInput {
  task: RelayTask;
  existingAssignments: readonly TaskAssignment[];
  role: Role;
  adapterId: string;
  ids: IdFactory;
  now: string;
  leaseMs: number;
  provenance: Provenance;
  sessionRef?: SessionRefId;
  idempotencyKey?: string;
  correlationId?: string;
}

export interface OwnershipOutcome {
  task: RelayTask;
  assignment: TaskAssignment;
  /** Assignments whose lease ended as part of this operation. */
  endedAssignments: TaskAssignment[];
  events: EventDraft[];
}

const draft = (task: RelayTask, kind: EventDraft['kind'], safeSummary: string, extra: Partial<EventDraft> = {}): EventDraft => ({
  protocolVersion: RELAY_PROTOCOL_VERSION,
  at: '',
  projectId: task.projectId,
  runId: task.runId,
  taskId: task.taskId,
  source: 'relay-core',
  kind,
  provenance: 'simulated',
  classification: 'historical',
  safeSummary,
  payload: {},
  ...extra,
});

/** Idempotency ledger for assignments: key → assignmentId, kept by callers
 * via the assignment's own idempotencyKey field. */
export interface AssignmentWithKey extends TaskAssignment {
  idempotencyKey?: string;
}

export function assignTask(input: AssignTaskInput): RelayResult<OwnershipOutcome> {
  const { task, existingAssignments, role, adapterId, ids, now, leaseMs, provenance, sessionRef, idempotencyKey, correlationId } = input;

  if ((TERMINAL_TASK_STATUSES as readonly string[]).includes(task.status)) {
    return fail(relayError('immutable', `Cannot assign a terminal (${task.status}) task.`, { entityIds: { taskId: task.taskId } }));
  }
  if (task.supersededBy) {
    return fail(relayError('illegal-transition', 'Cannot assign a superseded task.', { entityIds: { taskId: task.taskId, supersededBy: task.supersededBy } }));
  }

  if (idempotencyKey) {
    const prior = existingAssignments.find((a) => (a as AssignmentWithKey).idempotencyKey === idempotencyKey);
    if (prior) {
      const same = prior.adapterId === adapterId && prior.role === role && prior.taskId === task.taskId;
      if (same) {
        return ok({ task, assignment: prior, endedAssignments: [], events: [] });
      }
      return fail(
        relayError('duplicate-idempotency-key', 'Idempotency key was already used for a different assignment.', {
          entityIds: { taskId: task.taskId, assignmentId: prior.assignmentId },
        }),
      );
    }
  }

  const current = activeAssignment(existingAssignments, task.taskId, now);
  if (current) {
    return fail(
      relayError('duplicate-task', 'Task already has an active owner — one owner at a time.', {
        entityIds: { taskId: task.taskId, assignmentId: current.assignmentId },
      }),
    );
  }

  const assignment: AssignmentWithKey = {
    assignmentId: ids.next('asn') as AssignmentId,
    taskId: task.taskId,
    role,
    adapterId,
    assignedAt: now,
    provenance,
    sessionRef,
    leaseExpiresAt: new Date(Date.parse(now) + leaseMs).toISOString(),
    idempotencyKey,
  };
  const nextStatus = task.status === 'queued' || task.status === 'proposed' ? 'assigned' : task.status;
  const nextTask: RelayTask = {
    ...task,
    status: nextStatus,
    ownerAssignmentId: assignment.assignmentId,
    leaseExpiresAt: assignment.leaseExpiresAt,
    updatedAt: now,
  };
  return ok({
    task: nextTask,
    assignment,
    endedAssignments: [],
    events: [
      { ...draft(task, 'task.assigned', `Task assigned to ${adapterId} (${role}).`, { provenance, correlationId, payload: { adapterId, role, assignmentId: assignment.assignmentId, leaseExpiresAt: assignment.leaseExpiresAt } }), at: now },
    ],
  });
}

export function renewTaskLease(input: {
  task: RelayTask;
  assignment: TaskAssignment;
  requestedBy: string;
  now: string;
  leaseMs: number;
}): RelayResult<OwnershipOutcome> {
  const { task, assignment, requestedBy, now, leaseMs } = input;
  if ((TERMINAL_TASK_STATUSES as readonly string[]).includes(task.status)) {
    return fail(relayError('immutable', 'Cannot renew a lease on a terminal task.', { entityIds: { taskId: task.taskId } }));
  }
  if (requestedBy !== assignment.adapterId) {
    return fail(
      relayError('permission-denied', 'Only the assigned owner (or an explicit transfer) may renew the lease.', {
        entityIds: { taskId: task.taskId, assignmentId: assignment.assignmentId },
      }),
    );
  }
  const state = leaseState(assignment, now);
  if (state !== 'active') {
    return fail(relayError('illegal-transition', `Cannot renew a ${state} lease — recover it explicitly.`, { entityIds: { assignmentId: assignment.assignmentId } }));
  }
  const renewed: TaskAssignment = { ...assignment, leaseExpiresAt: new Date(Date.parse(now) + leaseMs).toISOString() };
  return ok({
    task: { ...task, leaseExpiresAt: renewed.leaseExpiresAt, updatedAt: now },
    assignment: renewed,
    endedAssignments: [],
    events: [{ ...draft(task, 'task.state_changed', 'Lease renewed by owner.', { payload: { status: task.status, leaseExpiresAt: renewed.leaseExpiresAt } }), at: now }],
  });
}

export function releaseTask(input: { task: RelayTask; assignment: TaskAssignment; now: string; reason: string }): RelayResult<OwnershipOutcome> {
  const { task, assignment, now, reason } = input;
  if (assignment.endedAt) {
    return fail(relayError('illegal-transition', 'Assignment already ended.', { entityIds: { assignmentId: assignment.assignmentId } }));
  }
  const ended: TaskAssignment = { ...assignment, endedAt: now, endReason: reason };
  const nextTask: RelayTask = { ...task, status: 'queued', ownerAssignmentId: null, leaseExpiresAt: undefined, updatedAt: now };
  return ok({
    task: nextTask,
    assignment: ended,
    endedAssignments: [ended],
    events: [
      { ...draft(task, 'task.ownership_changed', `Ownership released: ${reason}.`, { payload: { previousAssignmentId: assignment.assignmentId, status: 'queued' } }), at: now },
    ],
  });
}

/** Transfer = end the previous assignment (superseded) + create a new one.
 * History is preserved; the previous record is never rewritten. */
export function transferTaskOwnership(input: AssignTaskInput & { currentAssignment: TaskAssignment }): RelayResult<OwnershipOutcome> {
  const { currentAssignment, now } = input;
  if (currentAssignment.endedAt) {
    return fail(relayError('illegal-transition', 'Cannot transfer from an already-ended assignment.', { entityIds: { assignmentId: currentAssignment.assignmentId } }));
  }
  const superseded: TaskAssignment = { ...currentAssignment, endedAt: now, endReason: 'superseded' };
  const remaining = input.existingAssignments.filter((a) => a.assignmentId !== currentAssignment.assignmentId);
  const assigned = assignTask({ ...input, existingAssignments: remaining });
  if (!assigned.ok) return assigned;
  return ok({
    ...assigned.value,
    endedAssignments: [superseded, ...assigned.value.endedAssignments],
    events: [
      { ...draft(input.task, 'task.ownership_changed', `Ownership transferred from ${currentAssignment.adapterId} to ${input.adapterId}.`, { payload: { from: currentAssignment.assignmentId, to: assigned.value.assignment.assignmentId } }), at: now },
      ...assigned.value.events,
    ],
  });
}

/** Explicit expiry recovery (crash recovery): the expired assignment stays
 * historical; the task returns to queued with no owner. */
export function expireTaskLease(input: { task: RelayTask; assignment: TaskAssignment; now: string }): RelayResult<OwnershipOutcome> {
  const { task, assignment, now } = input;
  if (leaseState(assignment, now) !== 'expired') {
    return fail(relayError('illegal-transition', 'Lease is not expired.', { entityIds: { assignmentId: assignment.assignmentId } }));
  }
  const ended: TaskAssignment = { ...assignment, endedAt: now, endReason: 'lease-expired' };
  const nextTask: RelayTask = { ...task, status: 'queued', ownerAssignmentId: null, leaseExpiresAt: undefined, updatedAt: now };
  return ok({
    task: nextTask,
    assignment: ended,
    endedAssignments: [ended],
    events: [
      { ...draft(task, 'task.lease_expired', 'Lease expired — task returned to queue (no silent transfer).', { payload: { assignmentId: assignment.assignmentId } }), at: now },
    ],
  });
}

export interface OwnershipView {
  taskId: RelayTask['taskId'];
  owner: TaskAssignment | null;
  leaseState: LeaseState | null;
  history: TaskAssignment[];
}

export function inspectTaskOwnership(
  task: RelayTask,
  assignments: readonly TaskAssignment[],
  now: string,
): OwnershipView {
  const forTask = assignments.filter((a) => a.taskId === task.taskId);
  const owner = activeAssignment(forTask, task.taskId, now);
  return {
    taskId: task.taskId,
    owner,
    leaseState: owner ? 'active' : forTask.length > 0 ? leaseState(forTask[forTask.length - 1], now) : null,
    history: [...forTask],
  };
}
