/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 3
 * Lightweight trace REFERENCES (PURE).
 *
 * Milestone 4 builds the complete append-only Aquala Trace Event Ledger. This
 * milestone only records ordered, deduplicated, redacted POINTERS to events
 * that ledger will own, so a capsule never becomes a second copy of the event
 * stream. Two rules matter most:
 *
 *   - a reference from the agent itself is an AGENT CLAIM, never trusted
 *     supervisory observation — `agent_report` can never carry
 *     `trusted_source`/`verified` integrity;
 *   - `verified` integrity is NEVER asserted by this milestone. Nothing here
 *     hash-chains anything, so a capsule's trace integrity stays
 *     `not_evaluated` until the ledger can actually prove it.
 */

import { redactCommandMetadata } from '../commands/command-events';
import { capsuleError, capsuleFail, capsuleOk, type CapsuleResult } from './capsule-errors';

export const TRACE_REFERENCE_SOURCES = [
  'relay_supervisor',
  'adapter',
  'agent_report',
  'workspace_monitor',
  'permission_service',
  'review_service',
  'approval_service',
  'cost_service',
] as const;
export type TraceReferenceSource = (typeof TRACE_REFERENCE_SOURCES)[number];

export const TRACE_REFERENCE_INTEGRITIES = ['unverified', 'trusted_source', 'verified'] as const;
export type TraceReferenceIntegrity = (typeof TRACE_REFERENCE_INTEGRITIES)[number];

/** Sources Relay itself operates — an agent cannot speak for these. */
export const TRUSTED_SUPERVISORY_SOURCES: readonly TraceReferenceSource[] = [
  'relay_supervisor',
  'workspace_monitor',
  'permission_service',
  'review_service',
  'approval_service',
  'cost_service',
];

export interface TraceReference {
  readonly referenceId: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly occurredAt: string;
  readonly actorId: string;
  readonly source: TraceReferenceSource;
  readonly integrity: TraceReferenceIntegrity;
  /** Optional redacted pointer metadata — never the event payload itself. */
  readonly metadata?: Record<string, unknown>;
}

/** The ordered reference collections a capsule carries. */
export const TRACE_REFERENCE_CHANNELS = [
  'promptEvents',
  'toolEvents',
  'commandEvents',
  'permissionEvents',
  'fileEvents',
  'processEvents',
  'reviewEvents',
  'approvalEvents',
  'errors',
  'warnings',
] as const;
export type TraceReferenceChannel = (typeof TRACE_REFERENCE_CHANNELS)[number];

export type TraceReferenceCollections = {
  readonly [K in TraceReferenceChannel]: readonly TraceReference[];
};

export function createEmptyTraceReferences(): TraceReferenceCollections {
  return {
    promptEvents: [],
    toolEvents: [],
    commandEvents: [],
    permissionEvents: [],
    fileEvents: [],
    processEvents: [],
    reviewEvents: [],
    approvalEvents: [],
    errors: [],
    warnings: [],
  };
}

export interface TraceReferenceInput {
  referenceId: string;
  eventId: string;
  eventType: string;
  occurredAt: string;
  actorId: string;
  source: TraceReferenceSource;
  integrity?: TraceReferenceIntegrity;
  metadata?: Record<string, unknown>;
}

/**
 * Builds an immutable reference. Integrity is DERIVED, never taken on trust:
 * an `agent_report` source is always `unverified` (an agent cannot certify
 * itself), and no caller may claim `verified` in this milestone — that word
 * belongs to the Trace Ledger's integrity check.
 */
export function createTraceReference(
  input: TraceReferenceInput,
  options: { subjectAgentIds?: readonly string[] } = {},
): CapsuleResult<TraceReference> {
  if (!input.eventId.trim()) {
    return capsuleFail(
      capsuleError(
        'DUPLICATE_TRACE_REFERENCE',
        'a trace reference requires a non-empty event id',
        'supply the ledger event id this reference points at',
        { field: 'eventId' },
      ),
    );
  }

  const requested = input.integrity ?? 'unverified';
  const isAgentClaim = input.source === 'agent_report';
  const subjects = options.subjectAgentIds ?? [];

  // 21/139: agents cannot provide TRUSTED SUPERVISORY events about themselves.
  if (
    !isAgentClaim &&
    TRUSTED_SUPERVISORY_SOURCES.includes(input.source) &&
    subjects.includes(input.actorId)
  ) {
    return capsuleFail(
      capsuleError(
        'AGENT_SELF_ATTESTATION_FORBIDDEN',
        `${input.actorId} is the agent under observation and cannot emit a ${input.source} event about itself`,
        'record this as an agent_report claim, or let a supervisory service emit it',
        { field: 'source', expected: 'a supervisory actor', actual: input.actorId },
      ),
    );
  }

  const integrity: TraceReferenceIntegrity = isAgentClaim
    ? 'unverified'
    : requested === 'verified'
      ? 'trusted_source' // no hash chaining exists yet — never claim `verified`
      : requested;

  return capsuleOk(
    Object.freeze({
      referenceId: input.referenceId,
      eventId: input.eventId,
      eventType: input.eventType,
      occurredAt: input.occurredAt,
      actorId: input.actorId,
      source: input.source,
      integrity,
      ...(input.metadata ? { metadata: Object.freeze(redactCommandMetadata(input.metadata)) } : {}),
    }),
  );
}

/** True when the reference is a supervisory observation rather than a claim
    the agent made about its own work. */
export function isTrustedSupervisoryReference(reference: TraceReference): boolean {
  return reference.source !== 'agent_report' && reference.integrity !== 'unverified';
}

/** Every event id already referenced anywhere in the capsule's collections. */
export function collectReferencedEventIds(
  collections: TraceReferenceCollections,
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const channel of TRACE_REFERENCE_CHANNELS) {
    for (const reference of collections[channel]) ids.add(reference.eventId);
  }
  return ids;
}

/**
 * Appends to ONE channel, preserving order and rejecting an event id already
 * referenced in ANY channel. The input collections are never mutated.
 */
export function appendTraceReference(
  collections: TraceReferenceCollections,
  channel: TraceReferenceChannel,
  reference: TraceReference,
): CapsuleResult<TraceReferenceCollections> {
  if (collectReferencedEventIds(collections).has(reference.eventId)) {
    return capsuleFail(
      capsuleError(
        'DUPLICATE_TRACE_REFERENCE',
        `event ${reference.eventId} is already referenced by this capsule`,
        'reference a distinct ledger event, or inspect the existing reference',
        { field: channel, actual: reference.eventId },
      ),
    );
  }
  return capsuleOk({
    ...collections,
    [channel]: Object.freeze([...collections[channel], reference]),
  });
}
