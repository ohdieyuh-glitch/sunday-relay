/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 4
 * Chain verification and the integrity report (PURE).
 *
 * Walks the ledger from genesis and stops at the FIRST event that does not
 * hold, reporting how far the chain was verified. It never repairs anything,
 * never mutates an event, and never reports a partially valid trace as
 * verified — a broken trace stays broken and stays inspectable.
 *
 * Because every event's hash covers its own `previousEventHash` and
 * `sequence`, tampering with metadata, reordering, removing a middle event,
 * inserting an unhashed event, or replacing an event all break the walk.
 */

import { recomputeEventHash } from './trace-event-factory';
import { GENESIS_EVENT_TYPE } from './trace-event-types';
import { isValidHashFormat } from './trace-hashing';
import {
  isSupportedCanonicalizationVersion,
  isSupportedEventSchema,
  type AqualaTraceEvent,
  type AqualaTraceManifest,
} from './trace-types';

export type AqualaTraceIntegrityReason =
  | 'invalid_genesis'
  | 'sequence_gap'
  | 'duplicate_sequence'
  | 'duplicate_event_id'
  | 'previous_hash_mismatch'
  | 'event_hash_mismatch'
  | 'unsupported_schema_version'
  | 'unsupported_canonicalization_version'
  | 'trace_identity_mismatch'
  | 'scope_mismatch'
  | 'timestamp_regression'
  | 'invalid_event_type'
  | 'invalid_source_trust'
  | 'redaction_failure';

export interface AqualaTraceIntegrityReport {
  readonly traceId: string;
  readonly valid: boolean;
  readonly eventCount: number;
  /** The highest sequence verified before any failure. */
  readonly verifiedThroughSequence: number;
  readonly headEventId?: string;
  readonly headHash?: string;

  readonly firstInvalidSequence?: number;
  readonly firstInvalidEventId?: string;
  readonly reason?: AqualaTraceIntegrityReason;
  readonly detail?: string;

  readonly expectedHash?: string;
  readonly actualHash?: string;
}

/**
 * Verifies the full chain against the manifest. Pure: the events array and
 * every event in it are read-only here.
 */
export function verifyTraceIntegrity(
  manifest: AqualaTraceManifest,
  events: readonly AqualaTraceEvent[],
): AqualaTraceIntegrityReport {
  const base = { traceId: manifest.traceId, eventCount: events.length };

  const fail = (
    reason: AqualaTraceIntegrityReason,
    event: AqualaTraceEvent | undefined,
    verifiedThroughSequence: number,
    detail: string,
    hashes: { expectedHash?: string; actualHash?: string } = {},
  ): AqualaTraceIntegrityReport =>
    Object.freeze({
      ...base,
      valid: false,
      verifiedThroughSequence,
      firstInvalidSequence: event?.sequence,
      firstInvalidEventId: event?.eventId,
      reason,
      detail,
      ...hashes,
    });

  if (events.length === 0) {
    return fail('invalid_genesis', undefined, 0, 'a trace must contain at least its genesis event');
  }

  const seenIds = new Set<string>();
  const seenSequences = new Set<number>();
  let previousHash: string | null = null;
  let previousOccurredAt: string | null = null;
  let verified = 0;

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];

    /* ---- genesis rules ---- */
    if (index === 0) {
      if (event.sequence !== 1) {
        return fail('invalid_genesis', event, 0, `genesis sequence must be 1, found ${event.sequence}`);
      }
      if (event.previousEventHash !== null) {
        return fail('invalid_genesis', event, 0, 'genesis must have a null previous hash');
      }
      if (event.eventType !== GENESIS_EVENT_TYPE) {
        return fail('invalid_genesis', event, 0, `genesis must be ${GENESIS_EVENT_TYPE}`);
      }
      if (event.eventId !== manifest.genesisEventId) {
        return fail(
          'invalid_genesis',
          event,
          0,
          `genesis event id ${event.eventId} does not match the manifest (${manifest.genesisEventId})`,
        );
      }
    } else {
      if (event.previousEventHash === null) {
        return fail(
          'invalid_genesis',
          event,
          verified,
          'only the genesis event may carry a null previous hash',
        );
      }
      if (event.eventType === GENESIS_EVENT_TYPE) {
        return fail('invalid_genesis', event, verified, 'a trace may contain only one genesis event');
      }
    }

    /* ---- identity and scope ---- */
    if (event.traceId !== manifest.traceId) {
      return fail(
        'trace_identity_mismatch',
        event,
        verified,
        `event belongs to trace ${event.traceId}, not ${manifest.traceId}`,
      );
    }
    if (event.projectId !== manifest.projectId) {
      return fail('scope_mismatch', event, verified, `event project ${event.projectId} is out of scope`);
    }
    if (manifest.missionId && event.missionId && event.missionId !== manifest.missionId) {
      return fail('scope_mismatch', event, verified, `event mission ${event.missionId} is out of scope`);
    }
    if (manifest.taskId && event.taskId && event.taskId !== manifest.taskId) {
      return fail('scope_mismatch', event, verified, `event task ${event.taskId} is out of scope`);
    }

    /* ---- versions ---- */
    if (!isSupportedEventSchema(event.schemaVersion)) {
      return fail(
        'unsupported_schema_version',
        event,
        verified,
        `event schema "${event.schemaVersion}" is not supported`,
      );
    }
    if (!isSupportedCanonicalizationVersion(event.canonicalizationVersion)) {
      return fail(
        'unsupported_canonicalization_version',
        event,
        verified,
        `canonicalization "${event.canonicalizationVersion}" is not supported`,
      );
    }

    /* ---- uniqueness and ordering ---- */
    if (seenIds.has(event.eventId)) {
      return fail('duplicate_event_id', event, verified, `event id ${event.eventId} appears twice`);
    }
    if (seenSequences.has(event.sequence)) {
      return fail('duplicate_sequence', event, verified, `sequence ${event.sequence} appears twice`);
    }
    if (event.sequence !== index + 1) {
      return fail(
        'sequence_gap',
        event,
        verified,
        `expected sequence ${index + 1}, found ${event.sequence}`,
      );
    }
    if (previousOccurredAt !== null && event.occurredAt < previousOccurredAt) {
      return fail(
        'timestamp_regression',
        event,
        verified,
        `occurredAt ${event.occurredAt} precedes ${previousOccurredAt}`,
      );
    }

    /* ---- chain links ---- */
    if (index > 0 && event.previousEventHash !== previousHash) {
      return fail(
        'previous_hash_mismatch',
        event,
        verified,
        'the event does not link to the preceding event',
        { expectedHash: previousHash ?? undefined, actualHash: event.previousEventHash ?? undefined },
      );
    }
    if (!isValidHashFormat(event.eventHash)) {
      return fail('event_hash_mismatch', event, verified, 'the stored hash is not a valid SHA-256 digest');
    }

    const recomputed = recomputeEventHash(event);
    if (!recomputed.ok) {
      return fail(
        'redaction_failure',
        event,
        verified,
        `the stored event cannot be canonicalized: ${recomputed.error.reason}`,
      );
    }
    if (recomputed.value !== event.eventHash) {
      return fail('event_hash_mismatch', event, verified, 'the event content does not match its hash', {
        expectedHash: recomputed.value,
        actualHash: event.eventHash,
      });
    }

    seenIds.add(event.eventId);
    seenSequences.add(event.sequence);
    previousHash = event.eventHash;
    previousOccurredAt = event.occurredAt;
    verified = event.sequence;
  }

  const head = events[events.length - 1];
  return Object.freeze({
    ...base,
    valid: true,
    verifiedThroughSequence: verified,
    headEventId: head.eventId,
    headHash: head.eventHash,
  });
}
