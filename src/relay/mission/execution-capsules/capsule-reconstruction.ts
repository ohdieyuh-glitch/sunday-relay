/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 3
 * Limited capsule reconstruction and snapshot validation (PURE).
 *
 * DEFERRED TO MILESTONE 4: rebuilding a capsule from raw Aquala Trace events,
 * hash-chain integrity, and cross-capsule ledger reconciliation. This module
 * does only what Milestone 3 can honestly do — validate a stored snapshot, and
 * replay an ordered list of capsule OPERATION RECORDS to find the first one
 * that does not hold. Neither input is ever mutated.
 */

import { capsuleError, type RelayExecutionCapsuleError } from './capsule-errors';
import {
  identityLaunchVerified,
  identityObservedAgentId,
} from './capsule-identity';
import { isTerminalCapsuleStatus, validateCapsuleStatusTransition } from './capsule-status';
import { collectReferencedEventIds, TRACE_REFERENCE_CHANNELS } from './capsule-trace-reference';
import type { RelayAgentExecutionCapsule } from './capsule-types';
import { validateCapsuleInvariants } from './capsule-types';

export type CapsuleSnapshotValidation =
  | { ok: true }
  | { ok: false; error: RelayExecutionCapsuleError };

/**
 * Validates a stored capsule snapshot: every cross-field invariant, plus the
 * structural checks a persisted (or forged) record could otherwise smuggle
 * past — duplicate trace event ids across channels, out-of-order references,
 * and identity contradictions.
 */
export function validateCapsuleSnapshot(
  capsule: RelayAgentExecutionCapsule,
): CapsuleSnapshotValidation {
  const invariant = validateCapsuleInvariants(capsule);
  if (invariant) return { ok: false, error: invariant };

  const seen = new Set<string>();
  for (const channel of TRACE_REFERENCE_CHANNELS) {
    let previousAt: string | null = null;
    for (const reference of capsule.traceReferences[channel]) {
      if (seen.has(reference.eventId)) {
        return {
          ok: false,
          error: capsuleError(
            'DUPLICATE_TRACE_REFERENCE',
            `event ${reference.eventId} is referenced more than once`,
            'remove the duplicate reference',
            { capsuleId: capsule.capsuleId, runId: capsule.runId, field: channel },
          ),
        };
      }
      seen.add(reference.eventId);
      if (previousAt !== null && reference.occurredAt < previousAt) {
        return {
          ok: false,
          error: capsuleError(
            'INVALID_TIMESTAMP_ORDER',
            `${channel} references regress in time (${reference.occurredAt} after ${previousAt})`,
            'append references in observation order',
            {
              capsuleId: capsule.capsuleId,
              field: channel,
              expected: `>= ${previousAt}`,
              actual: reference.occurredAt,
            },
          ),
        };
      }
      previousAt = reference.occurredAt;
    }
  }

  // Trace integrity is never `verified` in this milestone — nothing chains or
  // proves anything yet, so a snapshot claiming otherwise is not trustworthy.
  if (capsule.traceIntegrityStatus === 'verified') {
    return {
      ok: false,
      error: capsuleError(
        'CAPSULE_RECONSTRUCTION_FAILED',
        'trace integrity cannot be "verified" before the Aquala Trace ledger exists',
        'leave trace integrity not_evaluated until the ledger verifies it',
        {
          capsuleId: capsule.capsuleId,
          field: 'traceIntegrityStatus',
          expected: 'not_evaluated | pending | failed',
          actual: 'verified',
        },
      ),
    };
  }

  return { ok: true };
}

/* -------------------------------------------------------- replay */

/** An immutable record of one lifecycle step, ordered by `sequence`. Emitted
    by callers today; the Trace ledger will own these in Milestone 4. */
export interface CapsuleOperationRecord {
  readonly sequence: number;
  readonly operation: string;
  readonly occurredAt: string;
  readonly resultingStatus: RelayAgentExecutionCapsule['status'];
  readonly launchVerified: boolean;
  readonly observedAgentId?: string;
  readonly missionRevision: number;
  readonly taskRevision: number;
  readonly traceEventIds?: readonly string[];
}

export type CapsuleReplayResult =
  | { ok: true; operations: number }
  | { ok: false; failedIndex: number; error: RelayExecutionCapsuleError };

/**
 * Replays operation records against the capsule they claim to describe,
 * failing on the FIRST record that does not hold: a status sequence the
 * transition table forbids, an identity contradiction, a revision change, a
 * duplicate trace event id, or a timestamp regression. Reports the index so a
 * caller can point at the exact operation.
 */
export function replayCapsuleOperations(
  capsule: RelayAgentExecutionCapsule,
  operations: readonly CapsuleOperationRecord[],
): CapsuleReplayResult {
  const fail = (index: number, error: RelayExecutionCapsuleError): CapsuleReplayResult => ({
    ok: false,
    failedIndex: index,
    error,
  });

  let status: RelayAgentExecutionCapsule['status'] = 'prepared';
  let previousAt: string | null = null;
  let previousSequence = -1;
  let launchVerifiedSoFar = false;
  const seenEventIds = new Set<string>();

  for (let index = 0; index < operations.length; index += 1) {
    const record = operations[index];

    if (record.sequence <= previousSequence) {
      return fail(
        index,
        capsuleError(
          'CAPSULE_RECONSTRUCTION_FAILED',
          `operation sequence ${record.sequence} does not extend ${previousSequence}`,
          'replay operations in their recorded order',
          { capsuleId: capsule.capsuleId, field: 'sequence' },
        ),
      );
    }
    if (previousAt !== null && record.occurredAt < previousAt) {
      return fail(
        index,
        capsuleError(
          'INVALID_TIMESTAMP_ORDER',
          `operation ${record.operation} regresses in time (${record.occurredAt} after ${previousAt})`,
          'correct the operation timestamps',
          {
            capsuleId: capsule.capsuleId,
            field: 'occurredAt',
            expected: `>= ${previousAt}`,
            actual: record.occurredAt,
          },
        ),
      );
    }
    if (
      record.missionRevision !== capsule.binding.missionRevision ||
      record.taskRevision !== capsule.binding.taskRevision
    ) {
      return fail(
        index,
        capsuleError(
          'RESPONSIBILITY_REVISION_MISMATCH',
          `operation ${record.operation} claims revisions ${record.missionRevision}/${record.taskRevision}, but the capsule is bound to ${capsule.binding.missionRevision}/${capsule.binding.taskRevision}`,
          'create a new run for the new revision instead of re-pointing this one',
          {
            capsuleId: capsule.capsuleId,
            field: 'binding',
            expected: `${capsule.binding.missionRevision}/${capsule.binding.taskRevision}`,
            actual: `${record.missionRevision}/${record.taskRevision}`,
          },
        ),
      );
    }
    if (
      record.observedAgentId &&
      identityObservedAgentId(capsule.identity) &&
      record.observedAgentId !== identityObservedAgentId(capsule.identity)
    ) {
      return fail(
        index,
        capsuleError(
          'ACTUAL_AGENT_NOT_VERIFIED',
          `operation ${record.operation} names ${record.observedAgentId}, but the capsule observed ${identityObservedAgentId(capsule.identity)}`,
          'reconcile the observed runtime identity',
          {
            capsuleId: capsule.capsuleId,
            field: 'identity',
            expected: identityObservedAgentId(capsule.identity),
            actual: record.observedAgentId,
          },
        ),
      );
    }

    if (record.resultingStatus !== status) {
      const validation = validateCapsuleStatusTransition(status, record.resultingStatus);
      if (!validation.ok) {
        return fail(
          index,
          capsuleError(
            'INVALID_CAPSULE_STATUS_TRANSITION',
            `operation ${record.operation}: ${validation.reason}`,
            'correct the operation history',
            {
              capsuleId: capsule.capsuleId,
              field: 'status',
              expected: `a valid transition from ${status}`,
              actual: record.resultingStatus,
            },
          ),
        );
      }
    }

    launchVerifiedSoFar = launchVerifiedSoFar || record.launchVerified;
    if (
      (record.resultingStatus === 'running' ||
        record.resultingStatus === 'waiting' ||
        record.resultingStatus === 'stalled') &&
      !launchVerifiedSoFar
    ) {
      return fail(
        index,
        capsuleError(
          'LAUNCH_NOT_VERIFIED',
          `operation ${record.operation} reaches ${record.resultingStatus} without a verified launch`,
          'attach a trusted launch attestation before activity states',
          { capsuleId: capsule.capsuleId, field: 'launchVerified' },
        ),
      );
    }

    for (const eventId of record.traceEventIds ?? []) {
      if (seenEventIds.has(eventId)) {
        return fail(
          index,
          capsuleError(
            'DUPLICATE_TRACE_REFERENCE',
            `operation ${record.operation} references event ${eventId} twice`,
            'reference each ledger event once',
            { capsuleId: capsule.capsuleId, field: 'traceEventIds', actual: eventId },
          ),
        );
      }
      seenEventIds.add(eventId);
    }

    status = record.resultingStatus;
    previousAt = record.occurredAt;
    previousSequence = record.sequence;
  }

  if (status !== capsule.status) {
    return fail(
      Math.max(operations.length - 1, 0),
      capsuleError(
        'CAPSULE_RECONSTRUCTION_FAILED',
        `replay ends at "${status}" but the stored capsule is "${capsule.status}"`,
        'record the missing operations, or investigate the divergence',
        {
          capsuleId: capsule.capsuleId,
          field: 'status',
          expected: capsule.status,
          actual: status,
        },
      ),
    );
  }
  if (identityLaunchVerified(capsule.identity) !== launchVerifiedSoFar) {
    return fail(
      Math.max(operations.length - 1, 0),
      capsuleError(
        'CAPSULE_RECONSTRUCTION_FAILED',
        'the replayed launch-verification history disagrees with the stored identity',
        'investigate the divergence before trusting this capsule',
        {
          capsuleId: capsule.capsuleId,
          field: 'identity',
          expected: String(identityLaunchVerified(capsule.identity)),
          actual: String(launchVerifiedSoFar),
        },
      ),
    );
  }
  if (isTerminalCapsuleStatus(capsule.status) && !capsule.finishedAt) {
    return fail(
      Math.max(operations.length - 1, 0),
      capsuleError(
        'INVALID_TIMESTAMP_ORDER',
        'a terminal capsule must record finishedAt',
        'record the terminal timestamp',
        { capsuleId: capsule.capsuleId, field: 'finishedAt' },
      ),
    );
  }

  // Trace references present on the capsule must all be accounted for when a
  // replay claims to be complete.
  const referenced = collectReferencedEventIds(capsule.traceReferences);
  for (const eventId of referenced) {
    if (seenEventIds.size > 0 && !seenEventIds.has(eventId)) {
      return fail(
        Math.max(operations.length - 1, 0),
        capsuleError(
          'CAPSULE_RECONSTRUCTION_FAILED',
          `the capsule references event ${eventId}, which no replayed operation produced`,
          'record the missing operation, or investigate the unexplained reference',
          { capsuleId: capsule.capsuleId, field: 'traceReferences', actual: eventId },
        ),
      );
    }
  }

  return { ok: true, operations: operations.length };
}
