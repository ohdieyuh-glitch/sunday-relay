import {
  closeSync, existsSync, linkSync, openSync, readFileSync, renameSync, unlinkSync, writeSync,
} from 'node:fs';
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
 *
 * THE RECLAIM IS GUARDED. The first version renamed the lock path
 * unconditionally after classifying it stale, and two processes racing that
 * reclaim could interleave so the slower one displaced the winner's LIVE
 * lock — both then held, and an iteration is a paid dispatch. Now the
 * reclaim takes the file to quarantine ATOMICALLY and only then looks at
 * what it actually took: the classified stale owner means a legitimate
 * reclaim; anything else means a live lock was displaced, and it is restored
 * with a no-clobber `link` — never a rename, which would displace whatever
 * third lock appeared meanwhile.
 *
 * WHAT REMAINS OPEN, said plainly: if a third process acquires in the
 * microseconds between a wrongful quarantine and its restore, the restore is
 * refused (the evidence is preserved, the failure names the displaced owner)
 * — but the displaced holder cannot be handed its protection back. Callers
 * doing long-held work can call `stillHeld()` at their own checkpoints; the
 * primitive cannot check it for them.
 *
 * AN UNREADABLE LOCK IS NOT RECLAIMED. It may be a live owner mid-write, and
 * the worker above this primitive already refused to guess — a primitive
 * that guessed underneath it was a policy leak, found in review. Remove one
 * by hand after inspecting it.
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

const sameOwner = (a: LockOwner, b: LockOwner): boolean =>
  a.pid === b.pid && a.hostname === b.hostname
  && a.acquiredAt === b.acquiredAt && a.purpose === b.purpose;

function readOwner(path: string): LockOwner | null {
  try {
    const owner = JSON.parse(readFileSync(path, 'utf8')) as LockOwner;
    if (typeof owner.pid !== 'number' || typeof owner.acquiredAt !== 'string') return null;
    return owner;
  } catch {
    return null;
  }
}

export function inspectLock(runDir: string): LockClassification {
  const lockPath = join(runDir, LOCK_FILE);
  if (!existsSync(lockPath)) return { status: 'free', owner: null };
  const owner = readOwner(lockPath);
  if (owner === null) return { status: 'unreadable', owner: null };
  return ownerAlive(owner) ? { status: 'held_by_live_owner', owner } : { status: 'stale_owner_dead', owner };
}

export type StaleReclaimOutcome =
  /** The quarantined file WAS the classified stale lock; the path is free. */
  | { readonly kind: 'reclaimed'; readonly preservedAs: string }
  /** Someone else reclaimed first; the path's state is theirs to have. */
  | { readonly kind: 'already_reclaimed' }
  /** A LIVE lock was taken by mistake and put back untouched. */
  | { readonly kind: 'displacement_restored'; readonly displaced: LockOwner }
  /** A live lock was taken, and a third lock appeared before it could be
   *  restored. The quarantined file is the evidence; the displaced owner's
   *  work is no longer protected, and nothing can hand that back. */
  | { readonly kind: 'displacement_unrestorable'; readonly displaced: LockOwner; readonly preservedAs: string };

/**
 * Displace a lock CLASSIFIED stale, without trusting the classification
 * across the race window. Take-then-verify: the rename is atomic, so what
 * was taken is exactly what is inspected — a classification made before
 * another process swapped the file cannot displace that process's lock
 * undetected, which is precisely what the unconditional rename allowed.
 */
export function reclaimClassifiedStaleLock(
  runDir: string,
  classified: LockOwner,
  quarantineName: string,
): StaleReclaimOutcome {
  const lockPath = join(runDir, LOCK_FILE);
  const quarantinePath = join(runDir, quarantineName);
  try {
    renameSync(lockPath, quarantinePath);
  } catch {
    return { kind: 'already_reclaimed' };
  }

  const taken = readOwner(quarantinePath);
  if (taken !== null && sameOwner(taken, classified)) {
    return { kind: 'reclaimed', preservedAs: quarantineName };
  }

  // The file taken is NOT the stale lock that justified taking it. Restore
  // with a no-clobber link: if a third lock already occupies the path, a
  // rename would displace IT and repeat the bug being fixed here.
  const displaced = taken ?? { pid: -1, hostname: 'unknown', acquiredAt: 'unknown', purpose: 'unreadable' };
  try {
    linkSync(quarantinePath, lockPath);
    unlinkSync(quarantinePath);
    return { kind: 'displacement_restored', displaced };
  } catch {
    return { kind: 'displacement_unrestorable', displaced, preservedAs: quarantineName };
  }
}

export interface AcquiredLock {
  runDir: string;
  owner: LockOwner;
  /** Re-read the lock and answer whether it is still OURS. Long-held work
   *  should ask at its own checkpoints; the primitive cannot ask for it. */
  stillHeld(): boolean;
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

      // Post-acquire verification: a reclaimer racing on an older
      // classification could have quarantined this fresh lock between the
      // create and here. A mismatch means the protection is already gone —
      // refuse to pretend otherwise, and touch nothing that is not ours.
      const check = readOwner(lockPath);
      if (check === null || !sameOwner(check, owner)) {
        return fail(relayError('permission-denied',
          'The lock was displaced during acquisition — a racing reclaim took it. Nothing was mutated.'));
      }

      const stillHeld = (): boolean => {
        const current = readOwner(lockPath);
        return current !== null && sameOwner(current, owner);
      };
      const release = (): void => {
        const current = readOwner(lockPath);
        if (current !== null && sameOwner(current, owner)) {
          try { unlinkSync(lockPath); } catch { /* already released */ }
        }
      };
      return ok({ lock: { runDir, owner, stillHeld, release }, diagnostics });
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
    if (classification.status === 'unreadable') {
      // NOT reclaimed: an unreadable lock may be a live owner mid-write, and
      // guessing costs a double dispatch of paid work. Found in review as a
      // policy leak under a worker that already refused to guess.
      return fail(relayError('permission-denied',
        'The run lock exists but cannot be read. It was not reclaimed — it may be a live owner '
        + 'mid-write. Inspect the lock file and remove it by hand if it is truly abandoned.'));
    }
    if (classification.status === 'stale_owner_dead' && classification.owner !== null) {
      const reclaim = reclaimClassifiedStaleLock(
        runDir,
        classification.owner,
        `${LOCK_FILE}.stale-${now().replace(/[:.]/g, '-')}-${classification.owner.pid}`,
      );
      if (reclaim.kind === 'reclaimed') {
        diagnostics.push(
          `stale lock from dead pid ${classification.owner.pid} preserved as ${reclaim.preservedAs} and reclaimed`);
        continue;
      }
      if (reclaim.kind === 'already_reclaimed') {
        // Another process won the reclaim; the next attempt reads the truth.
        continue;
      }
      if (reclaim.kind === 'displacement_restored') {
        diagnostics.push(
          `a racing reclaim nearly displaced the live lock of pid ${reclaim.displaced.pid}; restored untouched`);
        continue;
      }
      return fail(relayError('permission-denied',
        `A racing reclaim displaced the live lock of pid ${reclaim.displaced.pid} and a third lock `
        + `arrived before it could be restored. The displaced lock is preserved as ${reclaim.preservedAs}; `
        + 'that process\'s work is no longer protected and this acquisition refuses to add a second hazard.'));
    }
    // 'free': the holder released between the failed create and the inspect.
  }
  return fail(relayError('permission-denied', 'Run lock could not be acquired within the bounded attempts.'));
}
