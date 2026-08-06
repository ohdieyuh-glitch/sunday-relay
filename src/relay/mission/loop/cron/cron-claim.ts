/**
 * SUNDAY RELAY — CLAIM BEFORE EFFECT.
 *
 * CRON_LOOPS.md's approved sequence, verbatim: acquire the occurrence lock;
 * if the claim marker exists, already handled; write the marker atomically;
 * append the trigger-claimed journal event; ONLY THEN may the caller
 * preflight, check budget and create the run. This module is that sequence,
 * pure over an injected `OccurrenceClaimPort`, so the file-backed adapter
 * can be replaced without touching the protocol — the port decision the doc
 * made in advance.
 *
 * AT-MOST-ONCE RESTS ON THE MARKER, and the honest consequence of the
 * approved ordering is stated rather than hidden: a crash BETWEEN marker and
 * journal event leaves a claimed occurrence whose trigger event was never
 * recorded. A retry answers `already_handled` — no double dispatch, which is
 * the property that guards money — and the journal gap is reported on the
 * claiming pass itself (`journalRecorded: false`), because a record that
 * silently lacks an event it owes is the lie the operations record exists
 * to not tell.
 */

import type { CronOccurrence } from './cron-occurrences';

export interface OccurrenceClaimPort {
  /** The generalized run-lock, against the occurrence's own directory.
   *  `null` when it cannot be held right now — never a guess. EVERY writer
   *  of a claim marker — scheduler pass, retry, manual run-now — must hold
   *  THIS lock first; a writer that skips it re-opens the double-claim this
   *  sequence exists to close. */
  acquireOccurrenceLock(occurrenceId: string): OccurrenceLockAnswer;
  /** Has any process ever claimed this occurrence? The at-most-once truth. */
  claimMarkerExists(occurrenceId: string): boolean;
  /** Persist the claim marker ATOMICALLY and EXCLUSIVELY — the write must
   *  fail if a marker already exists (no overwrite; temp+rename alone is not
   *  enough), so at-most-once holds even if a lock is ever wrongly held
   *  twice. Throwing means not claimed. */
  writeClaimMarker(occurrence: CronOccurrence, at: string): void;
  /** Append the trigger-claimed journal event. Throwing after the marker is
   *  a recorded gap, not an unclaim. */
  appendTriggerClaimed(occurrence: CronOccurrence, at: string): void;
  now(): string;
}

/**
 * Why a lock was or was not acquired. Review of the adapter found every
 * failure collapsed into one "try later" — which hid an unreadable lock's
 * remove-it-by-hand instruction behind an answer that promised retrying was
 * the whole answer. `held` retries; `blocked` does not clear without a
 * human; `failed` names an IO problem a retry may clear.
 */
export type OccurrenceLockAnswer =
  | { readonly acquired: true; release(): void }
  | { readonly acquired: false; readonly kind: 'held' | 'blocked' | 'failed'; readonly problem: string };

export type OccurrenceClaimOutcome =
  /** This process owns the occurrence. `journalRecorded: false` means the
   *  marker held but the trigger event could not be appended — the claim
   *  stands, and the gap is the caller's to surface. */
  | { readonly kind: 'claimed'; readonly journalRecorded: boolean }
  /** A marker already exists: a retry, a duplicate delivery, a second
   *  worker, or a manual run-now that got there first. Not a failure. */
  | { readonly kind: 'already_handled' }
  /** The occurrence lock is held by a live claimant. Somebody may be
   *  mid-claim; trying again later is the whole answer. */
  | { readonly kind: 'lock_unavailable' }
  /** The lock will NOT clear on retry — an unreadable lock file or an
   *  unrestorable displacement needs a human. The problem says which. */
  | { readonly kind: 'lock_blocked'; readonly problem: string }
  /** The marker could not be written. NOT claimed; a retry is safe. */
  | { readonly kind: 'claim_failed'; readonly problem: string };

/**
 * Claim one occurrence, or say exactly why not.
 *
 * Total: every port failure maps to a named outcome, and the lock releases
 * on every path — a claim protocol that can leak its own lock turns one
 * crashed pass into a stuck schedule.
 */
export function claimOccurrence(
  port: OccurrenceClaimPort,
  occurrence: CronOccurrence,
): OccurrenceClaimOutcome {
  const problemOf = (error: unknown): string =>
    (error instanceof Error ? error.message : String(error)).slice(0, 200);

  let lock: OccurrenceLockAnswer;
  try {
    lock = port.acquireOccurrenceLock(occurrence.occurrenceId);
  } catch (error) {
    // A throwing lock port is unknown state, not "somebody holds it".
    return { kind: 'claim_failed', problem: problemOf(error) };
  }
  if (!lock.acquired) {
    if (lock.kind === 'held') return { kind: 'lock_unavailable' };
    if (lock.kind === 'blocked') return { kind: 'lock_blocked', problem: lock.problem };
    return { kind: 'claim_failed', problem: lock.problem };
  }

  let outcome: OccurrenceClaimOutcome;
  try {
    outcome = claimUnderLock(port, occurrence, problemOf);
  } finally {
    // A throwing release is CONTAINED: destroying the computed outcome would
    // lose exactly the journal-gap report this module exists to make. The
    // lock may remain held; the next pass then answers lock_unavailable — a
    // stuck schedule that says so beats a lost claim record.
    try { lock.release(); } catch { /* contained; see above */ }
  }
  return outcome;
}

function claimUnderLock(
  port: OccurrenceClaimPort,
  occurrence: CronOccurrence,
  problemOf: (error: unknown) => string,
): OccurrenceClaimOutcome {
  {
    let handled: boolean;
    try {
      handled = port.claimMarkerExists(occurrence.occurrenceId);
    } catch (error) {
      // Cannot tell claimed from unclaimed — writing a marker on that
      // ignorance could double-claim. Fail closed; a retry is safe.
      return { kind: 'claim_failed', problem: problemOf(error) };
    }
    if (handled) return { kind: 'already_handled' };
  }

  try {
    port.writeClaimMarker(occurrence, port.now());
  } catch (error) {
    return { kind: 'claim_failed', problem: problemOf(error) };
  }

  // The marker is durable: the occurrence IS claimed from here, whatever
  // happens to the journal append. Reporting the append's failure without
  // un-claiming is the honest reading of marker-then-journal.
  try {
    port.appendTriggerClaimed(occurrence, port.now());
    return { kind: 'claimed', journalRecorded: true };
  } catch {
    return { kind: 'claimed', journalRecorded: false };
  }
}
