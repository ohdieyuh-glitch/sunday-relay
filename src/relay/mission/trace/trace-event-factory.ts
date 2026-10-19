/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 4
 * The trusted event factory (PURE).
 *
 * This is the ONLY way an `AqualaTraceEvent` comes into existence. A caller
 * supplies identity, family/type, actor, trust, timestamp, and metadata; the
 * LEDGER supplies sequence, previous hash, and the event hash. That split is
 * the point: an agent (or any caller) cannot choose where it sits in the
 * chain, cannot pick its own hash, and therefore cannot rewrite or forge its
 * own audit history.
 *
 * Order is fixed: validate → redact → canonicalize → hash → freeze. Nothing
 * is persisted here; the factory has no repository access at all.
 */

import { canonicalEventInput } from './trace-canonicalization';
import { traceError, traceFail, traceOk, type TraceResult } from './trace-errors';
import {
  familyForEventType,
  isKnownTraceEventType,
} from './trace-event-types';
import { sha256Hex } from './trace-hashing';
import { redactEventMetadata } from './trace-redaction';
import { validateSourceTrust } from './trace-source-trust';
import {
  AQUALA_TRACE_ACTOR_TYPES,
  AQUALA_TRACE_EVENT_FAMILIES,
  AQUALA_TRACE_SOURCE_PRODUCTS,
  AQUALA_TRACE_SOURCE_TRUSTS,
  CURRENT_CANONICALIZATION_VERSION,
  CURRENT_EVENT_SCHEMA_VERSION,
  CURRENT_HASH_ALGORITHM,
  isSupportedEventSchema,
  type AqualaTraceEvent,
  type AqualaTraceEventDraft,
  type AqualaTraceManifest,
} from './trace-types';

export interface CreateTraceEventInput {
  draft: AqualaTraceEventDraft;
  manifest: AqualaTraceManifest;
  /** Ledger-allocated position. Callers never choose these. */
  sequence: number;
  previousEventHash: string | null;
  /** Agent ids the event is ABOUT, for self-attestation refusal. */
  subjectAgentIds?: readonly string[];
}

const required = (value: string | undefined): boolean => Boolean(value && value.trim());

/**
 * Builds one immutable, hashed event. Returns a structured error instead of
 * throwing, and never mutates the draft or the manifest.
 */
export function createAqualaTraceEvent(
  input: CreateTraceEventInput,
): TraceResult<AqualaTraceEvent> {
  const { draft, manifest, sequence, previousEventHash } = input;

  /* ---- 1. trace identity ---- */
  if (draft.traceId !== manifest.traceId) {
    return traceFail(
      traceError(
        'TRACE_IDENTITY_MISMATCH',
        `event names trace ${draft.traceId}, but this ledger is ${manifest.traceId}`,
        'append the event to its own trace',
        {
          traceId: manifest.traceId,
          eventId: draft.eventId,
          field: 'traceId',
          expected: manifest.traceId,
          actual: draft.traceId,
        },
      ),
    );
  }
  if (!required(draft.eventId)) {
    return traceFail(
      traceError('INVALID_EVENT_SEQUENCE', 'an event requires a non-empty event id', 'supply an event id', {
        traceId: manifest.traceId,
        field: 'eventId',
      }),
    );
  }

  /* ---- 2. scope: project, mission, task ---- */
  if (!required(draft.projectId)) {
    return traceFail(
      traceError('MISSING_PROJECT_ID', 'an event requires a project id', 'supply the project id', {
        traceId: manifest.traceId,
        eventId: draft.eventId,
        field: 'projectId',
      }),
    );
  }
  if (draft.projectId !== manifest.projectId) {
    return traceFail(
      traceError(
        'TRACE_SCOPE_MISMATCH',
        `event project ${draft.projectId} contradicts the trace scope ${manifest.projectId}`,
        'append the event to the trace that owns its project',
        {
          traceId: manifest.traceId,
          eventId: draft.eventId,
          field: 'projectId',
          expected: manifest.projectId,
          actual: draft.projectId,
        },
      ),
    );
  }
  if (manifest.missionId && draft.missionId && draft.missionId !== manifest.missionId) {
    return traceFail(
      traceError(
        'TRACE_SCOPE_MISMATCH',
        `event mission ${draft.missionId} contradicts the trace scope ${manifest.missionId}`,
        'append the event to the trace that owns its mission',
        {
          traceId: manifest.traceId,
          eventId: draft.eventId,
          field: 'missionId',
          expected: manifest.missionId,
          actual: draft.missionId,
        },
      ),
    );
  }
  if (manifest.taskId && draft.taskId && draft.taskId !== manifest.taskId) {
    return traceFail(
      traceError(
        'TRACE_SCOPE_MISMATCH',
        `event task ${draft.taskId} contradicts the trace scope ${manifest.taskId}`,
        'append the event to the trace that owns its task',
        {
          traceId: manifest.traceId,
          eventId: draft.eventId,
          field: 'taskId',
          expected: manifest.taskId,
          actual: draft.taskId,
        },
      ),
    );
  }

  /* ---- 3. schema versions ---- */
  const schemaVersion = draft.schemaVersion ?? CURRENT_EVENT_SCHEMA_VERSION;
  if (!isSupportedEventSchema(schemaVersion)) {
    return traceFail(
      traceError(
        'UNSUPPORTED_EVENT_SCHEMA',
        `event schema version "${schemaVersion}" is not supported`,
        'emit the event under a supported schema version',
        {
          traceId: manifest.traceId,
          eventId: draft.eventId,
          field: 'schemaVersion',
          expected: CURRENT_EVENT_SCHEMA_VERSION,
          actual: schemaVersion,
        },
      ),
    );
  }

  /* ---- 4. family and type ---- */
  if (!(AQUALA_TRACE_EVENT_FAMILIES as readonly string[]).includes(draft.eventFamily)) {
    return traceFail(
      traceError(
        'INVALID_EVENT_FAMILY',
        `"${draft.eventFamily}" is not a known event family`,
        'use a registered event family',
        { traceId: manifest.traceId, eventId: draft.eventId, field: 'eventFamily', actual: draft.eventFamily },
      ),
    );
  }
  if (!isKnownTraceEventType(draft.eventType)) {
    return traceFail(
      traceError(
        'INVALID_EVENT_TYPE',
        `"${draft.eventType}" is not a registered trace event type`,
        'register the event type, or use an existing one',
        { traceId: manifest.traceId, eventId: draft.eventId, field: 'eventType', actual: draft.eventType },
      ),
    );
  }
  const expectedFamily = familyForEventType(draft.eventType);
  if (expectedFamily && expectedFamily !== draft.eventFamily) {
    return traceFail(
      traceError(
        'INVALID_EVENT_FAMILY',
        `"${draft.eventType}" belongs to the "${expectedFamily}" family, not "${draft.eventFamily}"`,
        'file the event under its registered family',
        {
          traceId: manifest.traceId,
          eventId: draft.eventId,
          field: 'eventFamily',
          expected: expectedFamily,
          actual: draft.eventFamily,
        },
      ),
    );
  }

  /* ---- 5. source product and service ---- */
  if (!(AQUALA_TRACE_SOURCE_PRODUCTS as readonly string[]).includes(draft.sourceProduct)) {
    return traceFail(
      traceError(
        'INVALID_SOURCE_PRODUCT',
        `"${draft.sourceProduct}" is not a known Aquala source product`,
        'use a registered source product',
        { traceId: manifest.traceId, eventId: draft.eventId, field: 'sourceProduct', actual: draft.sourceProduct },
      ),
    );
  }
  if (!required(draft.sourceService)) {
    return traceFail(
      traceError(
        'INVALID_SOURCE_SERVICE',
        'an event must name the service that produced it',
        'supply the emitting source service',
        { traceId: manifest.traceId, eventId: draft.eventId, field: 'sourceService' },
      ),
    );
  }

  /* ---- 6. actor ---- */
  if (!required(draft.actorId)) {
    return traceFail(
      traceError('INVALID_ACTOR', 'an event must identify its actor', 'supply the actor id', {
        traceId: manifest.traceId,
        eventId: draft.eventId,
        field: 'actorId',
      }),
    );
  }
  if (!(AQUALA_TRACE_ACTOR_TYPES as readonly string[]).includes(draft.actorType)) {
    return traceFail(
      traceError(
        'INVALID_ACTOR',
        `"${draft.actorType}" is not a known actor type`,
        'use a registered actor type',
        { traceId: manifest.traceId, eventId: draft.eventId, field: 'actorType', actual: draft.actorType },
      ),
    );
  }

  /* ---- 7. source trust (self-attestation refused here) ---- */
  if (!(AQUALA_TRACE_SOURCE_TRUSTS as readonly string[]).includes(draft.sourceTrust)) {
    return traceFail(
      traceError(
        'INVALID_SOURCE_TRUST',
        `"${draft.sourceTrust}" is not a known source-trust level`,
        'use claim, observed, attested, or verified',
        { traceId: manifest.traceId, eventId: draft.eventId, field: 'sourceTrust', actual: draft.sourceTrust },
      ),
    );
  }
  const trust = validateSourceTrust({
    actorId: draft.actorId,
    actorType: draft.actorType,
    sourceService: draft.sourceService,
    requestedTrust: draft.sourceTrust,
    subjectAgentIds: input.subjectAgentIds,
  });
  if (!trust.ok) {
    return traceFail({ ...trust.error, traceId: manifest.traceId, eventId: draft.eventId });
  }

  /* ---- 8. revisions ---- */
  if (
    draft.missionRevision !== undefined &&
    (!Number.isInteger(draft.missionRevision) || draft.missionRevision < 0)
  ) {
    return traceFail(
      traceError(
        'INVALID_MISSION_REVISION',
        'mission revision must be a non-negative integer',
        'supply the mission revision the event refers to',
        {
          traceId: manifest.traceId,
          eventId: draft.eventId,
          field: 'missionRevision',
          actual: String(draft.missionRevision),
        },
      ),
    );
  }
  if (
    draft.taskRevision !== undefined &&
    (!Number.isInteger(draft.taskRevision) || draft.taskRevision < 0)
  ) {
    return traceFail(
      traceError(
        'INVALID_TASK_REVISION',
        'task revision must be a non-negative integer',
        'supply the task revision the event refers to',
        {
          traceId: manifest.traceId,
          eventId: draft.eventId,
          field: 'taskRevision',
          actual: String(draft.taskRevision),
        },
      ),
    );
  }
  if (!required(draft.occurredAt)) {
    return traceFail(
      traceError(
        'TIMESTAMP_REGRESSION',
        'an event must record when it occurred',
        'supply a normalized ISO timestamp',
        { traceId: manifest.traceId, eventId: draft.eventId, field: 'occurredAt' },
      ),
    );
  }

  /* ---- 9. REDACT before anything is hashed ---- */
  const redaction = redactEventMetadata(draft.metadata ?? {});
  if (!redaction.ok) {
    return traceFail({ ...redaction.error, traceId: manifest.traceId, eventId: draft.eventId });
  }

  /* ---- 10-13. assemble, canonicalize, hash ---- */
  const envelope = {
    eventId: draft.eventId,
    traceId: draft.traceId,
    schemaVersion,
    canonicalizationVersion: CURRENT_CANONICALIZATION_VERSION,
    hashAlgorithm: CURRENT_HASH_ALGORITHM,
    projectId: draft.projectId,
    ...(draft.missionId !== undefined ? { missionId: draft.missionId } : {}),
    ...(draft.taskId !== undefined ? { taskId: draft.taskId } : {}),
    ...(draft.commandId !== undefined ? { commandId: draft.commandId } : {}),
    ...(draft.capsuleId !== undefined ? { capsuleId: draft.capsuleId } : {}),
    ...(draft.runId !== undefined ? { runId: draft.runId } : {}),
    ...(draft.missionRevision !== undefined ? { missionRevision: draft.missionRevision } : {}),
    ...(draft.taskRevision !== undefined ? { taskRevision: draft.taskRevision } : {}),
    ...(draft.artifactRevision !== undefined ? { artifactRevision: draft.artifactRevision } : {}),
    sequence,
    eventFamily: draft.eventFamily,
    eventType: draft.eventType,
    sourceProduct: draft.sourceProduct,
    sourceService: draft.sourceService,
    actorId: draft.actorId,
    actorType: draft.actorType,
    sourceTrust: trust.value,
    occurredAt: draft.occurredAt,
    metadata: redaction.value.metadata,
    redactionStatus: redaction.value.status,
    previousEventHash,
  };

  const canonical = canonicalEventInput(envelope);
  if (!canonical.ok) {
    return traceFail({ ...canonical.error, traceId: manifest.traceId, eventId: draft.eventId });
  }

  const event: AqualaTraceEvent = {
    ...envelope,
    eventHash: sha256Hex(canonical.value),
  };

  return traceOk(deepFreeze(event));
}

/** Recomputes the hash of an already-built event, for verification. */
export function recomputeEventHash(event: AqualaTraceEvent): TraceResult<string> {
  const canonical = canonicalEventInput(event as unknown as Record<string, unknown>);
  if (!canonical.ok) return traceFail(canonical.error);
  return traceOk(sha256Hex(canonical.value));
}

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const inner of Object.values(value as Record<string, unknown>)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}
