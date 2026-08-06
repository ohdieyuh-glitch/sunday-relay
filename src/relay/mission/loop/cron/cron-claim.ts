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
   *  `null` when it cannot be held right now — never a guess. */
  acquireOccurrenceLock(occurrenceId: string): { release(): void } | null;
  /** Has any process ever claimed this occurrence? The at-most-once truth. */
  claimMarkerExists(occurrenceId: string): boolean;
  /** Persist the claim marker ATOMICALLY. Throwing means not claimed. */
  writeClaimMarker(occurrence: CronOccurrence, at: string): void;
  /** Append the trigger-claimed journal event. Throwing after the marker is
   *  a recorded gap, not an unclaim. */
  appendTriggerClaimed(occurrence: CronOccurrence, at: string): void;
  now(): string;
}

export type OccurrenceClaimOutcome =
  /** This process owns the occurrence. `journalRecorded: false` means the
   *  marker held but the trigger event could not be appended — the claim
   *  stands, and the gap is the caller's to surface. */
  | { readonly kind: 'claimed'; readonly journalRecorded: boolean }
  /** A marker already exists: a retry, a duplicate delivery, a second
   *  worker, or a manual run-now that got there first. Not a failure. */
  | { readonly kind: 'already_handled' }
  /** The occurrence lock could not be held. Somebody may be mid-claim;
   *  trying again later is the whole answer. */
  | { readonly kind: 'lock_unavailable' }
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
  const lock = port.acquireOccurrenceLock(occurrence.occurrenceId);
  if (lock === null) return { kind: 'lock_unavailable' };

  try {
    if (port.claimMarkerExists(occurrence.occurrenceId)) {
      return { kind: 'already_handled' };
    }

    try {
      port.writeClaimMarker(occurrence, port.now());
    } catch (error) {
      return {
        kind: 'claim_failed',
        problem: (error instanceof Error ? error.message : String(error)).slice(0, 200),
      };
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
  } finally {
    lock.release();
  }
}
