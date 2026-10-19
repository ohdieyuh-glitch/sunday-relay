/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 4
 * Deterministic IN-MEMORY trace repository — clearly labeled: this is the
 * milestone's test/development persistence boundary, NOT a database and NOT
 * production persistence. No production trace is written anywhere.
 *
 * The repository is deliberately dumb: it stores, indexes, and returns frozen
 * clones. All validation, hashing, chaining, and lifecycle transitions belong
 * to `trace-ledger.ts`, which is the only writer. There is no update API, no
 * replace-event API, no delete API, and no way to reorder anything.
 */

import { traceError, traceFail, traceOk, type TraceResult } from './trace-errors';
import type {
  AqualaTraceEvent,
  AqualaTraceEventFamily,
  AqualaTraceHead,
  AqualaTraceLifecycleStatus,
  AqualaTraceManifest,
  AqualaTraceSourceProduct,
} from './trace-types';

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const inner of Object.values(value as Record<string, unknown>)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

const frozenClone = <T>(value: T): T => deepFreeze(deepClone(value));

interface StoredTrace {
  manifest: AqualaTraceManifest;
  events: AqualaTraceEvent[];
  eventIds: Set<string>;
}

export class InMemoryTraceRepository {
  private readonly traces = new Map<string, StoredTrace>();

  /* ------------------------------------------------------------ traces */

  createTrace(
    manifest: AqualaTraceManifest,
    genesis: AqualaTraceEvent,
  ): TraceResult<AqualaTraceManifest> {
    if (this.traces.has(manifest.traceId)) {
      return traceFail(
        traceError(
          'DUPLICATE_TRACE_ID',
          `trace ${manifest.traceId} already exists — trace ids are unique`,
          'inspect the existing trace, or create one under a fresh id',
          { traceId: manifest.traceId, field: 'traceId' },
        ),
      );
    }
    this.traces.set(manifest.traceId, {
      manifest: deepClone(manifest),
      events: [deepFreeze(genesis)],
      eventIds: new Set([genesis.eventId]),
    });
    return traceOk(frozenClone(manifest));
  }

  getManifest(traceId: string): AqualaTraceManifest | null {
    const stored = this.traces.get(traceId);
    return stored ? frozenClone(stored.manifest) : null;
  }

  hasTrace(traceId: string): boolean {
    return this.traces.has(traceId);
  }

  listTracesByProject(projectId: string): AqualaTraceManifest[] {
    return [...this.traces.values()]
      .filter((t) => t.manifest.projectId === projectId)
      .map((t) => frozenClone(t.manifest));
  }

  listTracesByMission(missionId: string): AqualaTraceManifest[] {
    return [...this.traces.values()]
      .filter((t) => t.manifest.missionId === missionId)
      .map((t) => frozenClone(t.manifest));
  }

  listTracesByTask(taskId: string): AqualaTraceManifest[] {
    return [...this.traces.values()]
      .filter((t) => t.manifest.taskId === taskId)
      .map((t) => frozenClone(t.manifest));
  }

  /* ------------------------------------------------------------ events */

  /**
   * APPEND-ONLY. The sequence must be exactly the next slot and the event id
   * must be fresh. This is the last line of defence; the ledger has already
   * validated everything else.
   */
  appendEvent(event: AqualaTraceEvent): TraceResult<AqualaTraceEvent> {
    const stored = this.traces.get(event.traceId);
    if (!stored) {
      return traceFail(
        traceError('TRACE_NOT_FOUND', `trace ${event.traceId} does not exist`, 'create the trace first', {
          traceId: event.traceId,
          eventId: event.eventId,
        }),
      );
    }
    if (stored.eventIds.has(event.eventId)) {
      return traceFail(
        traceError(
          'DUPLICATE_EVENT_ID',
          `event ${event.eventId} already exists in this trace`,
          'append the event under a fresh event id',
          { traceId: event.traceId, eventId: event.eventId, field: 'eventId' },
        ),
      );
    }
    if (event.sequence !== stored.events.length + 1) {
      return traceFail(
        traceError(
          'INVALID_EVENT_SEQUENCE',
          `sequence ${event.sequence} does not extend the ordered ledger (next is ${stored.events.length + 1})`,
          'recompute the next sequence from the head and append again',
          {
            traceId: event.traceId,
            eventId: event.eventId,
            sequence: event.sequence,
            field: 'sequence',
            expected: String(stored.events.length + 1),
            actual: String(event.sequence),
          },
        ),
      );
    }
    const frozen = deepFreeze(event);
    stored.events.push(frozen);
    stored.eventIds.add(event.eventId);
    return traceOk(frozen);
  }

  getEvent(traceId: string, eventId: string): AqualaTraceEvent | null {
    const stored = this.traces.get(traceId);
    return stored?.events.find((e) => e.eventId === eventId) ?? null;
  }

  /** Every event in sequence order. The returned ARRAY is a copy, so mutating
      it can never reorder or truncate the stored ledger. */
  listEvents(traceId: string): AqualaTraceEvent[] {
    return [...(this.traces.get(traceId)?.events ?? [])];
  }

  getHead(traceId: string): AqualaTraceHead | null {
    const events = this.traces.get(traceId)?.events ?? [];
    const head = events[events.length - 1];
    if (!head) return null;
    return Object.freeze({
      sequence: head.sequence,
      eventId: head.eventId,
      eventHash: head.eventHash,
    });
  }

  getHeadEvent(traceId: string): AqualaTraceEvent | null {
    const events = this.traces.get(traceId)?.events ?? [];
    return events[events.length - 1] ?? null;
  }

  eventCount(traceId: string): number {
    return this.traces.get(traceId)?.events.length ?? 0;
  }

  /* ----------------------------------------------------------- indexes */

  listEventsByCapsule(traceId: string, capsuleId: string): AqualaTraceEvent[] {
    return this.listEvents(traceId).filter((e) => e.capsuleId === capsuleId);
  }

  listEventsByCommand(traceId: string, commandId: string): AqualaTraceEvent[] {
    return this.listEvents(traceId).filter((e) => e.commandId === commandId);
  }

  listEventsByFamily(traceId: string, family: AqualaTraceEventFamily): AqualaTraceEvent[] {
    return this.listEvents(traceId).filter((e) => e.eventFamily === family);
  }

  /* ------------------------------------------------- manifest lifecycle */

  /**
   * The ONLY manifest mutation, and only through the ledger: lifecycle status
   * plus the growing set of source products that have contributed. Identity,
   * genesis, versions, and creation facts can never change.
   */
  updateLifecycle(
    traceId: string,
    lifecycleStatus: AqualaTraceLifecycleStatus,
    sourceProducts?: readonly AqualaTraceSourceProduct[],
  ): TraceResult<AqualaTraceManifest> {
    const stored = this.traces.get(traceId);
    if (!stored) {
      return traceFail(
        traceError('TRACE_NOT_FOUND', `trace ${traceId} does not exist`, 'create the trace first', {
          traceId,
        }),
      );
    }
    stored.manifest = {
      ...stored.manifest,
      lifecycleStatus,
      ...(sourceProducts ? { sourceProducts: [...sourceProducts] } : {}),
    };
    return traceOk(frozenClone(stored.manifest));
  }
}
