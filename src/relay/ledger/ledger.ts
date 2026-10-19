import { RELAY_PROTOCOL_VERSION } from '../protocol/version';
import { fail, ok, relayError, type RelayResult } from '../protocol/errors';
import { parseEvent, type EventDraft, type EventEnvelope } from '../protocol/envelopes';
import type { EventId, LedgerVersion, ProjectId } from '../protocol/ids';
import type { EventStorePort } from '../storage/interfaces';

/**
 * Canonical Project Ledger foundation (PROTOCOL §2.2, ARCHITECTURE §4).
 * relay-ledger is the SOLE appender: it assigns eventId+sequence, enforces
 * gap-free monotonic ordering, append-only immutability, and idempotency.
 * Projections are pure reductions over the event sequence (projection.ts).
 * Initial ledger version for a new project is 0 (no events).
 */

export function currentLedgerVersion(store: EventStorePort, projectId: ProjectId): LedgerVersion {
  const events = store.listByProject(projectId);
  return (events.length === 0 ? 0 : events[events.length - 1].sequence) as LedgerVersion;
}

export interface AppendInput {
  draft: EventDraft;
  eventId: EventId;
  idempotencyKey?: string;
}

/** Append one event. Returns the stored envelope. Idempotent per
 * idempotencyKey: replaying the same key with the SAME kind+payload returns
 * the original event without a second append; a DIFFERENT payload under the
 * same key is a `duplicate-idempotency-key` error. */
export function appendEvent(store: EventStorePort, input: AppendInput): RelayResult<EventEnvelope> {
  const { draft, eventId, idempotencyKey } = input;

  if (idempotencyKey) {
    const existing = store.findByIdempotencyKey(draft.projectId, idempotencyKey);
    if (existing) {
      const same =
        existing.kind === draft.kind && JSON.stringify(existing.payload) === JSON.stringify(draft.payload);
      if (same) return ok(existing);
      return fail(
        relayError('duplicate-idempotency-key', 'Idempotency key was already used with a different payload.', {
          entityIds: { projectId: draft.projectId, eventId: existing.eventId },
        }),
      );
    }
  }

  if (store.findByEventId(eventId)) {
    return fail(relayError('duplicate-event', 'Event id already appended.', { entityIds: { eventId } }));
  }

  const sequence = (currentLedgerVersion(store, draft.projectId) as number) + 1;
  const envelope: EventEnvelope = {
    ...draft,
    protocolVersion: RELAY_PROTOCOL_VERSION,
    eventId,
    sequence,
    refs: { ...(draft.refs ?? {}), ledgerVersion: sequence as LedgerVersion },
  };

  const parsed = parseEvent(envelope);
  if (!parsed.ok) return parsed;

  const frozen = Object.freeze(parsed.value);
  const stored = store.append(frozen, idempotencyKey);
  if (!stored.ok) return stored;
  return ok(frozen);
}

/** Replay-safe access: the full ordered history (append-only — the store
 * exposes no mutation of stored events). */
export function listEvents(store: EventStorePort, projectId: ProjectId): readonly EventEnvelope[] {
  return store.listByProject(projectId);
}
