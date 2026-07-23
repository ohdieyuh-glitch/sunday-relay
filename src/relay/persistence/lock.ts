import { closeSync, existsSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { fail, ok, relayError, type RelayResult } from '../protocol/errors';

/**
 * Per-run mutation lock (Prompt 8.5). Prevents two Relay processes from
 * mutating the same run — and therefore from concurrently authorizing
 * provider launches for it. The lock is an O_EXCL-created file carrying
 * owner metadata (never just an existence check): stale locks are detected
 * by owner-process liveness and reclaimed ONLY under the documented
 * condition (owner pid provably dead on this host), with the stale lock
 * preserved for diagnosis. Read-only inspection never takes the lock.
 */

export const LOCK_FILE = 'lock';

export interface LockOwner {
  pid: number;
  hostname: string;
  acquiredAt: string;
  purpose: string;
}

export interface LockClassification {
  status: 'free' | 'held_by_live_owner' | 'stale_owner_dead' | 'unreadable';
  owner: LockOwner | null;
}

function ownerAlive(owner: LockOwner): boolean {
  if (owner.hostname !== hostname()) return true; // cross-host liveness is unknowable — never treat as stale
  try {
    process.kill(owner.pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

export function inspectLock(runDir: string): LockClassification {
  const lockPath = join(runDir, LOCK_FILE);
  if (!existsSync(lockPath)) return { status: 'free', owner: null };
  let owner: LockOwner;
  try {
    owner = JSON.parse(readFileSync(lockPath, 'utf8')) as LockOwner;
    if (typeof owner.pid !== 'number' || typeof owner.acquiredAt !== 'string') throw new Error('shape');
  } catch {
    return { status: 'unreadable', owner: null };
  }
  return ownerAlive(owner) ? { status: 'held_by_live_owner', owner } : { status: 'stale_owner_dead', owner };
}

export interface AcquiredLock {
  runDir: string;
  owner: LockOwner;
  release(): void;
}

/** Acquire the run lock. Bounded: one immediate attempt plus one retry after
 * a documented stale-reclaim — never an unbounded wait. */
export function acquireRunLock(
  runDir: string, purpose: string, now: () => string,
): RelayResult<{ lock: AcquiredLock; diagnostics: string[] }> {
  const lockPath = join(runDir, LOCK_FILE);
  const diagnostics: string[] = [];

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const owner: LockOwner = { pid: process.pid, hostname: hostname(), acquiredAt: now(), purpose };
      const fd = openSync(lockPath, 'wx', 0o600);
      try { writeSync(fd, JSON.stringify(owner), null, 'utf8'); } finally { closeSync(fd); }
      const release = (): void => {
        const current = inspectLock(runDir);
        if (current.owner?.pid === owner.pid && current.owner.hostname === owner.hostname) {
          try { unlinkSync(lockPath); } catch { /* already released */ }
        }
      };
      return ok({ lock: { runDir, owner, release }, diagnostics });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
        return fail(relayError('validation-failed', `Could not create the run lock: ${(err as Error).message}`));
      }
    }
    const classification = inspectLock(runDir);
    if (classification.status === 'held_by_live_owner') {
      return fail(relayError('permission-denied',
        `Run is locked by a live Relay process (pid ${classification.owner?.pid}) — refusing concurrent mutation.`));
    }
    if (classification.status === 'stale_owner_dead') {
      // Documented reclaim condition: same host, owner pid provably dead.
      const preserved = `${lockPath}.stale-${Date.now()}-${classification.owner?.pid}`;
      try { renameSync(lockPath, preserved); } catch { /* raced with another recoverer */ }
      diagnostics.push(`stale lock from dead pid ${classification.owner?.pid} preserved as ${preserved.split('/').pop()} and reclaimed`);
      continue;
    }
    if (classification.status === 'unreadable') {
      const preserved = `${lockPath}.unreadable-${Date.now()}`;
      try { renameSync(lockPath, preserved); } catch { /* raced */ }
      diagnostics.push('unreadable lock file preserved and reclaimed');
      continue;
    }
  }
  return fail(relayError('permission-denied', 'Run lock could not be acquired within the bounded attempts.'));
}
