import { fail, ok, relayError, type RelayResult } from '../protocol/errors';
import type { FileClaim, ResourceClaim } from '../protocol/contracts';
import type { ClaimId, IdFactory, TaskId } from '../protocol/ids';

/**
 * File + resource claims (Prompt 3) — metadata-only coordination controls.
 * No file is read or modified, no Git runs. Paths are normalized safely and
 * hostile shapes are rejected. read = shared, write = exclusive;
 * parent/child overlaps conflict for writes.
 */

export function normalizeRepoPath(raw: string): RelayResult<string> {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return fail(relayError('validation-failed', 'Path must be a non-empty string.'));
  }
  if (raw.includes('\0')) return fail(relayError('validation-failed', 'Path contains a null byte.'));
  const slashed = raw.replace(/\\/g, '/');
  if (/^([a-zA-Z]:)?\//.test(slashed)) {
    return fail(relayError('validation-failed', 'Absolute paths are rejected — repository-relative only.'));
  }
  const parts: string[] = [];
  for (const part of slashed.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') return fail(relayError('validation-failed', 'Parent traversal (..) is rejected.'));
    parts.push(part);
  }
  if (parts.length === 0) return fail(relayError('validation-failed', 'Path resolves to nothing.'));
  return ok(parts.join('/'));
}

const isPrefix = (parent: string, child: string) => child === parent || child.startsWith(`${parent}/`);

export interface FileClaimConflict {
  claimId: ClaimId;
  taskId: TaskId;
  path: string;
  kind: 'exact' | 'parent-child';
}

export function inspectFileClaimConflicts(
  request: { taskId: TaskId; path: string; mode: 'read' | 'write' },
  existing: readonly FileClaim[],
  now: string,
): FileClaimConflict[] {
  const conflicts: FileClaimConflict[] = [];
  for (const claim of existing) {
    if (claim.status !== 'active' || claim.expiresAt <= now) continue;
    if (claim.taskId === request.taskId) continue; // same-owner handled by acquire
    const overlaps = isPrefix(claim.path, request.path) || isPrefix(request.path, claim.path);
    if (!overlaps) continue;
    if (request.mode === 'read' && claim.mode === 'read') continue; // shared reads coexist
    conflicts.push({
      claimId: claim.claimId,
      taskId: claim.taskId,
      path: claim.path,
      kind: claim.path === request.path ? 'exact' : 'parent-child',
    });
  }
  return conflicts;
}

export interface AcquireClaimInput {
  taskId: TaskId;
  path: string;
  mode: 'read' | 'write';
  existing: readonly FileClaim[];
  ids: IdFactory;
  now: string;
  leaseMs: number;
}

export function acquireFileClaim(input: AcquireClaimInput): RelayResult<{ claim: FileClaim; idempotent: boolean }> {
  const normalized = normalizeRepoPath(input.path);
  if (!normalized.ok) return normalized;
  const path = normalized.value;

  const own = input.existing.find(
    (c) => c.taskId === input.taskId && c.path === path && c.status === 'active' && c.expiresAt > input.now,
  );
  if (own) {
    if (own.mode === input.mode || own.mode === 'write') return ok({ claim: own, idempotent: true });
  }

  const conflicts = inspectFileClaimConflicts({ taskId: input.taskId, path, mode: input.mode }, input.existing, input.now);
  if (conflicts.length > 0) {
    return fail(
      relayError('duplicate-task', `File claim conflict on \`${path}\`.`, {
        entityIds: { taskId: input.taskId },
        details: conflicts.map((c) => `${c.kind} conflict with ${c.taskId} (${c.path})`),
      }),
    );
  }
  const claim: FileClaim = {
    claimId: input.ids.next('clm') as ClaimId,
    taskId: input.taskId,
    path,
    mode: input.mode,
    claimedAt: input.now,
    expiresAt: new Date(Date.parse(input.now) + input.leaseMs).toISOString(),
    status: 'active',
  };
  return ok({ claim, idempotent: false });
}

export function releaseFileClaim(claim: FileClaim, now: string): RelayResult<FileClaim> {
  if (claim.status !== 'active') {
    return fail(relayError('illegal-transition', `Claim is already ${claim.status}.`, { entityIds: { claimId: claim.claimId } }));
  }
  void now;
  return ok({ ...claim, status: 'released' });
}

export function expireFileClaim(claim: FileClaim, now: string): RelayResult<FileClaim> {
  if (claim.status !== 'active' || claim.expiresAt > now) {
    return fail(relayError('illegal-transition', 'Claim is not due for expiry.', { entityIds: { claimId: claim.claimId } }));
  }
  return ok({ ...claim, status: 'expired' });
}

export function renewFileClaim(claim: FileClaim, now: string, leaseMs: number): RelayResult<FileClaim> {
  if (claim.status !== 'active' || claim.expiresAt <= now) {
    return fail(relayError('illegal-transition', 'Only an unexpired active claim can renew.', { entityIds: { claimId: claim.claimId } }));
  }
  return ok({ ...claim, expiresAt: new Date(Date.parse(now) + leaseMs).toISOString() });
}

/* ------------------------- resource claims ------------------------ */

export function acquireResourceClaim(input: {
  taskId: TaskId;
  resource: string;
  mode: 'exclusive' | 'shared';
  existing: readonly ResourceClaim[];
  ids: IdFactory;
  now: string;
  leaseMs: number;
}): RelayResult<{ claim: ResourceClaim; idempotent: boolean }> {
  if (typeof input.resource !== 'string' || input.resource.trim() === '') {
    return fail(relayError('validation-failed', 'Resource key must be an explicit non-empty string.'));
  }
  const own = input.existing.find(
    (c) => c.taskId === input.taskId && c.resource === input.resource && c.status === 'active' && c.expiresAt > input.now,
  );
  if (own) return ok({ claim: own, idempotent: true });

  const conflicting = input.existing.filter(
    (c) =>
      c.resource === input.resource &&
      c.status === 'active' &&
      c.expiresAt > input.now &&
      c.taskId !== input.taskId &&
      (c.mode === 'exclusive' || input.mode === 'exclusive'),
  );
  if (conflicting.length > 0) {
    return fail(
      relayError('duplicate-task', `Resource \`${input.resource}\` is claimed.`, {
        entityIds: { taskId: input.taskId },
        details: conflicting.map((c) => `held by ${c.taskId} (${c.mode})`),
      }),
    );
  }
  const claim: ResourceClaim = {
    claimId: input.ids.next('clm') as ClaimId,
    taskId: input.taskId,
    resource: input.resource,
    mode: input.mode,
    claimedAt: input.now,
    expiresAt: new Date(Date.parse(input.now) + input.leaseMs).toISOString(),
    status: 'active',
  };
  return ok({ claim, idempotent: false });
}

export function releaseResourceClaim(claim: ResourceClaim): RelayResult<ResourceClaim> {
  if (claim.status !== 'active') {
    return fail(relayError('illegal-transition', `Claim is already ${claim.status}.`, { entityIds: { claimId: claim.claimId } }));
  }
  return ok({ ...claim, status: 'released' });
}
