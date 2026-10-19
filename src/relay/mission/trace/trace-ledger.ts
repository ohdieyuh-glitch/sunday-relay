/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 4
 * The append-only Aquala Trace ledger (PURE).
 *
 * The single writer. It creates a trace with exactly one genesis event,
 * appends single events and atomic batches, guards against stale heads,
 * completes a trace, and seals it. There is deliberately no update, replace,
 * delete, reorder, metadata-edit, hash-rewrite, or reopen operation — those
 * capabilities simply do not exist on this surface.
 *
 * Completion and sealing are different things: completion says operational
 * execution ended, sealing says the record is finished. A completed trace can
 * still receive the late events that genuinely arrive after work stops — cost
 * receipts, human approval, the release decision, an integrity audit.
 */

import { createAqualaTraceEvent, deepFreeze } from './trace-event-factory';
import { traceError, traceFail, traceOk, type AqualaTraceError, type TraceResult } from './trace-errors';
import {
  GENESIS_EVENT_TYPE,
  LEDGER_CONTROLLED_EVENT_TYPES,
  POST_COMPLETION_EVENT_TYPES,
} from './trace-event-types';
import { verifyTraceIntegrity } from './trace-integrity';
import { InMemoryTraceRepository } from './trace-repository';
import {
  CURRENT_CANONICALIZATION_VERSION,
  CURRENT_HASH_ALGORITHM,
  CURRENT_TRACE_SCHEMA_VERSION,
  isSupportedCanonicalizationVersion,
  isSupportedHashAlgorithm,
  isSupportedTraceSchema,
  type AqualaTraceEvent,
  type AqualaTraceEventDraft,
  type AqualaTraceHead,
  type AqualaTraceLifecycleStatus,
  type AqualaTraceManifest,
  type AqualaTraceRetentionClassification,
  type AqualaTraceSchemaVersion,
  type AqualaTraceSourceProduct,
} from './trace-types';

/* --------------------------------------------------------- trace creation */

export interface CreateTraceInput {
  traceId: string;
  projectId: string;
  missionId?: string;
  taskId?: string;
  createdByActorId: string;
  createdAt: string;
  genesisEventId: string;
  retentionClassification: AqualaTraceRetentionClassification;
  sourceProduct: AqualaTraceSourceProduct;
  sourceService: string;
  /** Explicit versions, for tests that assert rejection of unsupported ones. */
  schemaVersion?: string;
  canonicalizationVersion?: string;
  hashAlgorithm?: string;
  metadata?: Record<string, unknown>;
}

export interface CreatedTrace {
  manifest: AqualaTraceManifest;
  genesis: AqualaTraceEvent;
}

/**
 * Creates a trace and its single genesis event: sequence 1, previous hash
 * null, hash computed over the redacted envelope. No other event may ever
 * carry a null previous hash, and no trace may contain a second genesis.
 */
export function createTrace(
  repository: InMemoryTraceRepository,
  input: CreateTraceInput,
): TraceResult<CreatedTrace> {
  if (!input.projectId?.trim()) {
    return traceFail(
      traceError('MISSING_PROJECT_ID', 'a trace requires a project id', 'supply the project id', {
        traceId: input.traceId,
        field: 'projectId',
      }),
    );
  }

  const schemaVersion = input.schemaVersion ?? CURRENT_TRACE_SCHEMA_VERSION;
  if (!isSupportedTraceSchema(schemaVersion)) {
    return traceFail(
      traceError(
        'UNSUPPORTED_TRACE_SCHEMA',
        `trace schema version "${schemaVersion}" is not supported`,
        'create the trace under a supported schema version',
        {
          traceId: input.traceId,
          field: 'schemaVersion',
          expected: CURRENT_TRACE_SCHEMA_VERSION,
          actual: schemaVersion,
        },
      ),
    );
  }
  const canonicalizationVersion = input.canonicalizationVersion ?? CURRENT_CANONICALIZATION_VERSION;
  if (!isSupportedCanonicalizationVersion(canonicalizationVersion)) {
    return traceFail(
      traceError(
        'UNSUPPORTED_CANONICALIZATION_VERSION',
        `canonicalization version "${canonicalizationVersion}" is not supported`,
        'create the trace under a supported canonicalization version',
        {
          traceId: input.traceId,
          field: 'canonicalizationVersion',
          expected: CURRENT_CANONICALIZATION_VERSION,
          actual: canonicalizationVersion,
        },
      ),
    );
  }
  const hashAlgorithm = input.hashAlgorithm ?? CURRENT_HASH_ALGORITHM;
  if (!isSupportedHashAlgorithm(hashAlgorithm)) {
    return traceFail(
      traceError(
        'UNSUPPORTED_HASH_ALGORITHM',
        `hash algorithm "${hashAlgorithm}" is not supported`,
        'create the trace under a supported hash algorithm',
        {
          traceId: input.traceId,
          field: 'hashAlgorithm',
          expected: CURRENT_HASH_ALGORITHM,
          actual: hashAlgorithm,
        },
      ),
    );
  }
  if (repository.hasTrace(input.traceId)) {
    return traceFail(
      traceError(
        'DUPLICATE_TRACE_ID',
        `trace ${input.traceId} already exists`,
        'inspect the existing trace, or create one under a fresh id',
        { traceId: input.traceId, field: 'traceId' },
      ),
    );
  }

  // A provisional manifest so the factory can validate scope; genesis hash is
  // filled in once the event exists.
  const provisional: AqualaTraceManifest = {
    traceId: input.traceId,
    schemaVersion: schemaVersion as AqualaTraceSchemaVersion,
    projectId: input.projectId,
    ...(input.missionId ? { missionId: input.missionId } : {}),
    ...(input.taskId ? { taskId: input.taskId } : {}),
    createdByActorId: input.createdByActorId,
    createdAt: input.createdAt,
    canonicalizationVersion: CURRENT_CANONICALIZATION_VERSION,
    hashAlgorithm: CURRENT_HASH_ALGORITHM,
    genesisEventId: input.genesisEventId,
    genesisHash: '',
    sourceProducts: [input.sourceProduct],
    retentionClassification: input.retentionClassification,
    lifecycleStatus: 'open',
  };

  const genesis = createAqualaTraceEvent({
    manifest: provisional,
    sequence: 1,
    previousEventHash: null,
    draft: {
      eventId: input.genesisEventId,
      traceId: input.traceId,
      projectId: input.projectId,
      ...(input.missionId ? { missionId: input.missionId } : {}),
      ...(input.taskId ? { taskId: input.taskId } : {}),
      eventFamily: 'trace',
      eventType: GENESIS_EVENT_TYPE,
      sourceProduct: input.sourceProduct,
      sourceService: input.sourceService,
      actorId: input.createdByActorId,
      actorType: 'relay',
      sourceTrust: 'observed',
      occurredAt: input.createdAt,
      metadata: {
        retentionClassification: input.retentionClassification,
        traceSchemaVersion: schemaVersion,
        canonicalizationVersion,
        hashAlgorithm,
        ...(input.metadata ?? {}),
      },
    },
  });
  if (!genesis.ok) return traceFail(genesis.error);

  const manifest: AqualaTraceManifest = deepFreeze({
    ...provisional,
    genesisHash: genesis.value.eventHash,
  });

  const created = repository.createTrace(manifest, genesis.value);
  if (!created.ok) return traceFail(created.error);
  return traceOk({ manifest: created.value, genesis: genesis.value });
}

/* ---------------------------------------------------------------- append */

export interface AppendEventInput {
  traceId: string;
  draft: AqualaTraceEventDraft;
  /** Optimistic concurrency: the head the caller believes it read. */
  expectedHead?: AqualaTraceHead | { eventHash: string } | null;
  subjectAgentIds?: readonly string[];
  /** Permits the ledger's own lifecycle events, which callers may not emit. */
  allowLedgerControlledType?: boolean;
}

function lifecycleGuard(
  manifest: AqualaTraceManifest,
  eventType: string,
): AqualaTraceError | null {
  if (manifest.lifecycleStatus === 'sealed') {
    return traceError(
      'TRACE_SEALED',
      `trace ${manifest.traceId} is sealed and accepts no further events`,
      'inspect the sealed trace; start a new trace for new work',
      { traceId: manifest.traceId, field: 'lifecycleStatus', actual: 'sealed' },
    );
  }
  if (manifest.lifecycleStatus === 'integrity_failed') {
    return traceError(
      'TRACE_INTEGRITY_FAILED',
      `trace ${manifest.traceId} failed integrity verification and accepts no normal appends`,
      'investigate the integrity failure; the invalid trace is preserved for inspection',
      { traceId: manifest.traceId, field: 'lifecycleStatus', actual: 'integrity_failed' },
    );
  }
  if (manifest.lifecycleStatus === 'completed' && !POST_COMPLETION_EVENT_TYPES.includes(eventType)) {
    return traceError(
      'TRACE_SEAL_REJECTED',
      `"${eventType}" is not a permitted late event on a completed trace`,
      'append only late cost, approval, release, evidence, or integrity events after completion',
      { traceId: manifest.traceId, field: 'eventType', actual: eventType },
    );
  }
  return null;
}

function headGuard(
  manifest: AqualaTraceManifest,
  head: AqualaTraceHead | null,
  expected: AppendEventInput['expectedHead'],
): AqualaTraceError | null {
  if (expected === undefined || expected === null) return null;
  const actualHash = head?.eventHash ?? null;
  if (expected.eventHash !== actualHash) {
    return traceError(
      'STALE_TRACE_HEAD',
      'the trace head moved since it was read — another writer appended first',
      're-read the current head and retry the append',
      {
        traceId: manifest.traceId,
        field: 'expectedHead.eventHash',
        expected: actualHash ?? 'none',
        actual: expected.eventHash,
      },
    );
  }
  if ('sequence' in expected && head && expected.sequence !== head.sequence) {
    return traceError(
      'STALE_TRACE_HEAD',
      'the expected head sequence does not match the current head',
      're-read the current head and retry the append',
      {
        traceId: manifest.traceId,
        field: 'expectedHead.sequence',
        expected: String(head.sequence),
        actual: String(expected.sequence),
      },
    );
  }
  return null;
}

/** Appends exactly one event. Nothing is stored unless every check passes. */
export function appendTraceEvent(
  repository: InMemoryTraceRepository,
  input: AppendEventInput,
): TraceResult<AqualaTraceEvent> {
  const batch = appendTraceEventBatch(repository, {
    traceId: input.traceId,
    drafts: [input.draft],
    expectedHead: input.expectedHead,
    subjectAgentIds: input.subjectAgentIds,
    allowLedgerControlledType: input.allowLedgerControlledType,
  });
  if (!batch.ok) return traceFail(batch.error);
  return traceOk(batch.value[0]);
}

export interface AppendBatchInput {
  traceId: string;
  drafts: readonly AqualaTraceEventDraft[];
  expectedHead?: AqualaTraceHead | { eventHash: string } | null;
  subjectAgentIds?: readonly string[];
  allowLedgerControlledType?: boolean;
}

/**
 * Atomic batch append: every draft is validated, redacted, chained, and
 * hashed BEFORE anything is stored. One bad draft rejects the whole batch and
 * the ledger is left byte-for-byte unchanged.
 */
export function appendTraceEventBatch(
  repository: InMemoryTraceRepository,
  input: AppendBatchInput,
): TraceResult<AqualaTraceEvent[]> {
  const manifest = repository.getManifest(input.traceId);
  if (!manifest) {
    return traceFail(
      traceError('TRACE_NOT_FOUND', `trace ${input.traceId} does not exist`, 'create the trace first', {
        traceId: input.traceId,
      }),
    );
  }
  if (input.drafts.length === 0) {
    return traceFail(
      traceError(
        'EVENT_BATCH_REJECTED',
        'an append batch must contain at least one event',
        'supply at least one event draft',
        { traceId: input.traceId, field: 'drafts' },
      ),
    );
  }

  const head = repository.getHead(input.traceId);
  const staleness = headGuard(manifest, head, input.expectedHead);
  if (staleness) return traceFail(staleness);

  const existingEvents = repository.listEvents(input.traceId);
  const existingIds = new Set(existingEvents.map((e) => e.eventId));
  const lastOccurredAt = existingEvents[existingEvents.length - 1]?.occurredAt ?? null;

  const prepared: AqualaTraceEvent[] = [];
  let previousHash = head?.eventHash ?? null;
  let sequence = (head?.sequence ?? 0) + 1;
  let previousOccurredAt = lastOccurredAt;
  const batchIds = new Set<string>();

  const rejectBatch = (error: AqualaTraceError, index: number): TraceResult<AqualaTraceEvent[]> =>
    traceFail({
      ...error,
      reason:
        input.drafts.length > 1
          ? `batch rejected at draft ${index}: ${error.reason}`
          : error.reason,
    });

  for (let index = 0; index < input.drafts.length; index += 1) {
    const draft = input.drafts[index];

    const lifecycle = lifecycleGuard(manifest, draft.eventType);
    if (lifecycle) return rejectBatch(lifecycle, index);

    if (!input.allowLedgerControlledType && LEDGER_CONTROLLED_EVENT_TYPES.includes(draft.eventType)) {
      return rejectBatch(
        traceError(
          'INVALID_EVENT_TYPE',
          `"${draft.eventType}" is emitted by the ledger itself and cannot be appended by a caller`,
          'use the createTrace, completeTrace, or sealTrace operation instead',
          { traceId: input.traceId, eventId: draft.eventId, field: 'eventType', actual: draft.eventType },
        ),
        index,
      );
    }

    if (existingIds.has(draft.eventId) || batchIds.has(draft.eventId)) {
      return rejectBatch(
        traceError(
          'DUPLICATE_EVENT_ID',
          `event ${draft.eventId} already exists in this trace or batch`,
          'append the event under a fresh event id',
          { traceId: input.traceId, eventId: draft.eventId, field: 'eventId' },
        ),
        index,
      );
    }

    if (previousOccurredAt !== null && draft.occurredAt < previousOccurredAt) {
      return rejectBatch(
        traceError(
          'TIMESTAMP_REGRESSION',
          `event occurredAt ${draft.occurredAt} precedes the previous event (${previousOccurredAt})`,
          'append events in observation order with normalized timestamps',
          {
            traceId: input.traceId,
            eventId: draft.eventId,
            field: 'occurredAt',
            expected: `>= ${previousOccurredAt}`,
            actual: draft.occurredAt,
          },
        ),
        index,
      );
    }

    const created = createAqualaTraceEvent({
      draft,
      manifest,
      sequence,
      previousEventHash: previousHash,
      subjectAgentIds: input.subjectAgentIds,
    });
    if (!created.ok) return rejectBatch(created.error, index);

    prepared.push(created.value);
    batchIds.add(created.value.eventId);
    previousHash = created.value.eventHash;
    previousOccurredAt = created.value.occurredAt;
    sequence += 1;
  }

  // Only now does anything touch storage. A failure above stored nothing.
  const appended: AqualaTraceEvent[] = [];
  for (const event of prepared) {
    const stored = repository.appendEvent(event);
    if (!stored.ok) {
      // Unreachable in correct use — the ledger allocated these sequences from
      // the same head it just read. Surface loudly rather than half-writing.
      return traceFail({
        ...stored.error,
        code: 'EVENT_BATCH_REJECTED',
        reason: `batch storage failed after validation: ${stored.error.reason}`,
      });
    }
    appended.push(stored.value);
  }

  const products = new Set<AqualaTraceSourceProduct>(manifest.sourceProducts);
  for (const event of appended) products.add(event.sourceProduct);
  if (products.size !== manifest.sourceProducts.length) {
    repository.updateLifecycle(input.traceId, manifest.lifecycleStatus, [...products]);
  }

  return traceOk(appended);
}

/* ---------------------------------------------------- completion + seal */

export interface CompleteTraceInput {
  traceId: string;
  eventId: string;
  actorId: string;
  occurredAt: string;
  sourceService: string;
  reason: string;
  metadata?: Record<string, unknown>;
}

/**
 * Marks operational execution finished. This is NOT sealing, and it never
 * sets verification, outcome, or release — those remain Milestone 1 facts
 * driven by evidence and review.
 */
export function completeTrace(
  repository: InMemoryTraceRepository,
  input: CompleteTraceInput,
): TraceResult<AqualaTraceEvent> {
  const manifest = repository.getManifest(input.traceId);
  if (!manifest) {
    return traceFail(
      traceError('TRACE_NOT_FOUND', `trace ${input.traceId} does not exist`, 'create the trace first', {
        traceId: input.traceId,
      }),
    );
  }
  if (manifest.lifecycleStatus !== 'open') {
    return traceFail(
      traceError(
        manifest.lifecycleStatus === 'sealed' ? 'TRACE_SEALED' : 'TRACE_SEAL_REJECTED',
        `trace ${input.traceId} is ${manifest.lifecycleStatus} and cannot be completed again`,
        'inspect the trace lifecycle',
        { traceId: input.traceId, field: 'lifecycleStatus', actual: manifest.lifecycleStatus },
      ),
    );
  }

  const appended = appendTraceEvent(repository, {
    traceId: input.traceId,
    allowLedgerControlledType: true,
    draft: {
      eventId: input.eventId,
      traceId: input.traceId,
      projectId: manifest.projectId,
      ...(manifest.missionId ? { missionId: manifest.missionId } : {}),
      ...(manifest.taskId ? { taskId: manifest.taskId } : {}),
      eventFamily: 'trace',
      eventType: 'trace_completed',
      sourceProduct: 'sunday_relay',
      sourceService: input.sourceService,
      actorId: input.actorId,
      actorType: 'relay',
      sourceTrust: 'observed',
      occurredAt: input.occurredAt,
      metadata: { reason: input.reason, ...(input.metadata ?? {}) },
    },
  });
  if (!appended.ok) return traceFail(appended.error);

  repository.updateLifecycle(input.traceId, 'completed');
  return traceOk(appended.value);
}

export interface SealTraceInput {
  traceId: string;
  eventId: string;
  actorId: string;
  occurredAt: string;
  sourceService: string;
  reason: string;
}

/**
 * Sealing is explicit and verified: the complete chain is checked FIRST, a
 * seal event is appended as the final entry, and the chain is re-verified
 * INCLUDING that event. Integrity failure blocks sealing and marks the trace
 * `integrity_failed` so the problem stays visible.
 */
export function sealTrace(
  repository: InMemoryTraceRepository,
  input: SealTraceInput,
): TraceResult<AqualaTraceEvent> {
  const manifest = repository.getManifest(input.traceId);
  if (!manifest) {
    return traceFail(
      traceError('TRACE_NOT_FOUND', `trace ${input.traceId} does not exist`, 'create the trace first', {
        traceId: input.traceId,
      }),
    );
  }
  if (manifest.lifecycleStatus === 'sealed') {
    return traceFail(
      traceError(
        'TRACE_SEALED',
        `trace ${input.traceId} is already sealed`,
        'inspect the sealed trace',
        { traceId: input.traceId, field: 'lifecycleStatus', actual: 'sealed' },
      ),
    );
  }

  const before = verifyTraceIntegrity(manifest, repository.listEvents(input.traceId));
  if (!before.valid) {
    repository.updateLifecycle(input.traceId, 'integrity_failed');
    return traceFail(
      traceError(
        'TRACE_SEAL_REJECTED',
        `integrity verification failed (${before.reason}) — a broken trace is never sealed`,
        'investigate the first invalid event; the trace is preserved for inspection',
        {
          traceId: input.traceId,
          eventId: before.firstInvalidEventId,
          sequence: before.firstInvalidSequence,
          field: 'integrity',
          humanActionRequired: true,
        },
      ),
    );
  }

  const head = repository.getHead(input.traceId);
  const appended = appendTraceEvent(repository, {
    traceId: input.traceId,
    allowLedgerControlledType: true,
    draft: {
      eventId: input.eventId,
      traceId: input.traceId,
      projectId: manifest.projectId,
      ...(manifest.missionId ? { missionId: manifest.missionId } : {}),
      ...(manifest.taskId ? { taskId: manifest.taskId } : {}),
      eventFamily: 'trace',
      eventType: 'trace_sealed',
      sourceProduct: 'sunday_relay',
      sourceService: input.sourceService,
      actorId: input.actorId,
      actorType: 'relay',
      sourceTrust: 'attested',
      occurredAt: input.occurredAt,
      metadata: {
        finalEventCountBeforeSeal: before.eventCount,
        previousHeadHash: head?.eventHash ?? null,
        verifiedIntegrity: true,
        verifiedThroughSequence: before.verifiedThroughSequence,
        sealingActor: input.actorId,
        sealingReason: input.reason,
        traceSchemaVersion: manifest.schemaVersion,
        eventSchemaVersion: '1.0.0',
        canonicalizationVersion: manifest.canonicalizationVersion,
        hashAlgorithm: manifest.hashAlgorithm,
      },
    },
  });
  if (!appended.ok) return traceFail(appended.error);

  const after = verifyTraceIntegrity(manifest, repository.listEvents(input.traceId));
  if (!after.valid) {
    repository.updateLifecycle(input.traceId, 'integrity_failed');
    return traceFail(
      traceError(
        'TRACE_SEAL_REJECTED',
        `the trace failed re-verification after the seal event (${after.reason})`,
        'investigate the integrity failure',
        { traceId: input.traceId, field: 'integrity', humanActionRequired: true },
      ),
    );
  }

  repository.updateLifecycle(input.traceId, 'sealed');
  return traceOk(appended.value);
}

/** Records an integrity failure on a trace, keeping it visible and frozen. */
export function markTraceIntegrityFailed(
  repository: InMemoryTraceRepository,
  traceId: string,
): TraceResult<AqualaTraceLifecycleStatus> {
  const updated = repository.updateLifecycle(traceId, 'integrity_failed');
  if (!updated.ok) return traceFail(updated.error);
  return traceOk('integrity_failed');
}
