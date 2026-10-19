import type {
  DurableCheckpointReason,
  DurableMissionRecord,
  DurableMissionRecordDraft,
  DurableOwnerLease,
} from './durable-contracts';
import { draftFromRecord } from './durable-record';
import type { DurableMissionStorePort, DurableWriteResult } from './durable-store';

/**
 * CHECKPOINT POLICY AND THE OWNERSHIP GUARD.
 *
 * Two jobs, both small and both pure except for the one awaited write:
 *
 * 1. WHEN TO SAVE. `shouldCheckpoint` is the entire policy — a checkpoint is
 *    written at a named safe boundary, and only when the mission actually
 *    changed since the last one. Terminal output, keystrokes and animation
 *    frames are not boundaries and keep using their existing storage.
 *
 * 2. WHO OWNS THE MISSION. A lease (session id + expiry) is carried in the
 *    record itself. It is the smallest guard that prevents two tabs — or a
 *    double-clicked Resume — from starting the same work twice. It is not
 *    distributed locking, and it is not claimed to be.
 */

/** How long a claim stays valid without being renewed. */
export const OWNER_LEASE_MS = 30_000;

export interface CheckpointDecision {
  readonly write: boolean;
  readonly reason: DurableCheckpointReason | null;
  /** Why a write was skipped — surfaced in tests and diagnostics only. */
  readonly skipped: string | null;
}

/**
 * Decide whether this change deserves a durable checkpoint. `previous` is
 * the last successfully written record (null before the first one).
 */
export function shouldCheckpoint(input: {
  reason: DurableCheckpointReason;
  previous: DurableMissionRecord | null;
  next: DurableMissionRecordDraft;
}): CheckpointDecision {
  const { reason, previous, next } = input;
  if (previous === null) return { write: true, reason, skipped: null };

  // A boundary that changed nothing material is not worth a write — this is
  // what keeps checkpoints at boundaries rather than at every render.
  const materiallyEqual =
    previous.missionState === next.missionState &&
    previous.stage === next.stage &&
    previous.currentTaskRef === next.currentTaskRef &&
    previous.checkpointReason === reason &&
    previous.lastCompletedAction?.actionId === next.lastCompletedAction?.actionId &&
    previous.inFlightAction?.actionId === next.inFlightAction?.actionId &&
    previous.inFlightAction?.outcome === next.inFlightAction?.outcome &&
    previous.evidence.filesReportedChanged.length === next.evidence.filesReportedChanged.length &&
    previous.evidence.findingRefs.length === next.evidence.findingRefs.length &&
    previous.evidence.repairRefs.length === next.evidence.repairRefs.length &&
    previous.usage.knownCostMicros === next.usage.knownCostMicros &&
    previous.usage.budgetStatus === next.usage.budgetStatus;

  if (materiallyEqual) {
    return { write: false, reason: null, skipped: 'no material change since the last checkpoint' };
  }
  return { write: true, reason, skipped: null };
}

/* --------------------------------------------------------------- leases */

export function claimLease(sessionId: string, now: string): DurableOwnerLease {
  const expires = new Date(Date.parse(now) + OWNER_LEASE_MS).toISOString();
  return { sessionId, claimedAt: now, expiresAt: expires };
}

/** Is this session allowed to act on the record right now? */
export function leaseAllows(
  record: DurableMissionRecord | null,
  sessionId: string,
  now: string,
): boolean {
  if (record === null || record.owner === null) return true;
  if (record.owner.sessionId === sessionId) return true;
  const expires = Date.parse(record.owner.expiresAt);
  const current = Date.parse(now);
  if (!Number.isFinite(expires) || !Number.isFinite(current)) return true;
  return expires <= current; // an expired foreign lease may be taken over
}

/* ------------------------------------------------------------- resuming */

export type ResumeOutcome =
  | { readonly ok: true; readonly record: DurableMissionRecord; readonly alreadyOwned: boolean }
  | { readonly ok: false; readonly reason: string };

/**
 * ACCEPT A RESUME EXACTLY ONCE.
 *
 * The record's `recoveryGeneration` is bumped and the lease is claimed in the
 * SAME durable write. A second click (or a refresh mid-resume) re-reads the
 * record, sees its own session already holding the current generation, and
 * returns `alreadyOwned` instead of starting a second execution.
 *
 * `inFlight` guards the window before that write lands: two synchronous
 * clicks cannot both reach storage.
 */
export function createResumeCoordinator(store: DurableMissionStorePort) {
  const inFlight = new Map<string, Promise<ResumeOutcome>>();
  const accepted = new Map<string, number>();

  const resume = async (input: {
    missionId: string;
    sessionId: string;
    now: string;
  }): Promise<ResumeOutcome> => {
    const { missionId, sessionId, now } = input;
    const pending = inFlight.get(missionId);
    if (pending !== undefined) {
      // A resume is already being written — the second caller waits for the
      // same result rather than producing a second one.
      const result = await pending;
      return result.ok ? { ...result, alreadyOwned: true } : result;
    }

    const run = (async (): Promise<ResumeOutcome> => {
      const read = await store.read(missionId);
      if (!read.ok) {
        return { ok: false, reason: `mission record is not resumable (${read.reason})` };
      }
      const record = read.record;
      if (!leaseAllows(record, sessionId, now)) {
        return { ok: false, reason: 'another session currently holds this mission' };
      }
      const alreadyAcceptedGeneration = accepted.get(missionId);
      if (
        alreadyAcceptedGeneration !== undefined &&
        alreadyAcceptedGeneration >= record.recoveryGeneration &&
        record.owner?.sessionId === sessionId
      ) {
        // This session already resumed this generation — a repeat click.
        return { ok: true, record, alreadyOwned: true };
      }

      // `draftFromRecord` drops the stored checksum — re-sealing over a
      // stale one would produce a record that fails its own verification.
      const draft: DurableMissionRecordDraft = {
        ...draftFromRecord(record),
        recoveryGeneration: record.recoveryGeneration + 1,
        owner: claimLease(sessionId, now),
        updatedAt: now,
      };
      const written: DurableWriteResult = await store.write(draft);
      if (!written.ok) return { ok: false, reason: written.reason };
      accepted.set(missionId, written.record.recoveryGeneration);
      return { ok: true, record: written.record, alreadyOwned: false };
    })();

    inFlight.set(missionId, run);
    try {
      return await run;
    } finally {
      inFlight.delete(missionId);
    }
  };

  return {
    resume,
    /** Test/diagnostic view of which generation this session accepted. */
    acceptedGeneration: (missionId: string): number | null => accepted.get(missionId) ?? null,
  };
}
