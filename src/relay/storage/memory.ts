import { fail, ok, relayError, type RelayResult } from '../protocol/errors';
import type { EventEnvelope, ReportEnvelope } from '../protocol/envelopes';
import type {
  AgentHandoffPackage, AgentSessionReference, ArtifactReference, EvidenceBundle,
  EvidenceRecord, FailureRecord, FileClaim, HandoffCompilationRecord,
  RelayProject, RelayRun, RelayTask, ResourceClaim, TaskAssignment, UsageRecord,
} from '../protocol/contracts';
import type { ProjectId } from '../protocol/ids';
import type { EventStorePort, KeyedStorePort, RelayStores } from './interfaces';

/**
 * TEST/DEV-ONLY in-memory adapters. They are deterministic, volatile, and
 * refuse to be constructed without an explicit acknowledgement — they can
 * never be selected as production persistence by accident. Nothing here
 * survives a process restart, and `durability` says so.
 */

class InMemoryKeyedStore<T> implements KeyedStorePort<T> {
  private readonly map = new Map<string, T>();
  get(id: string): T | null {
    return this.map.get(id) ?? null;
  }
  put(id: string, value: T): RelayResult<null> {
    if (typeof id !== 'string' || id.trim() === '') {
      return fail(relayError('validation-failed', 'Store key must be a non-empty string.'));
    }
    this.map.set(id, value);
    return ok(null);
  }
  list(): readonly T[] {
    return [...this.map.values()];
  }
  /** Explicit testing helper — the only reset path. */
  resetForTest(): void {
    this.map.clear();
  }
}

class InMemoryEventStore implements EventStorePort {
  private readonly byProject = new Map<string, EventEnvelope[]>();
  private readonly byEventId = new Map<string, EventEnvelope>();
  private readonly byIdempotency = new Map<string, EventEnvelope>();
  private readonly byClaimId = new Map<string, EventEnvelope>();

  listByProject(projectId: ProjectId): readonly EventEnvelope[] {
    return this.byProject.get(projectId) ?? [];
  }
  findByEventId(eventId: string): EventEnvelope | null {
    return this.byEventId.get(eventId) ?? null;
  }
  findByIdempotencyKey(projectId: ProjectId, key: string): EventEnvelope | null {
    return this.byIdempotency.get(`${projectId}::${key}`) ?? null;
  }
  findByClaimId(claimId: string): EventEnvelope | null {
    return this.byClaimId.get(claimId) ?? null;
  }

  append(event: EventEnvelope, idempotencyKey?: string): RelayResult<null> {
    if (this.byEventId.has(event.eventId)) {
      return fail(relayError('duplicate-event', 'Event id already exists.', { entityIds: { eventId: event.eventId } }));
    }
    const events = this.byProject.get(event.projectId) ?? [];
    const expected = (events.length === 0 ? 0 : events[events.length - 1].sequence) + 1;
    if (event.sequence !== expected) {
      return fail(
        relayError('sequence-violation', `Expected sequence ${expected}, got ${event.sequence} (gaps and duplicates are rejected).`, {
          entityIds: { projectId: event.projectId, eventId: event.eventId },
        }),
      );
    }
    // Append-only: stored envelopes are frozen; no update/delete API exists.
    const frozen = Object.freeze(event);
    events.push(frozen);
    this.byProject.set(event.projectId, events);
    this.byEventId.set(event.eventId, frozen);
    if (idempotencyKey) this.byIdempotency.set(`${event.projectId}::${idempotencyKey}`, frozen);
    if (event.kind === 'ledger.claim_recorded' && event.refs?.claimId) {
      this.byClaimId.set(event.refs.claimId, frozen);
    }
    return ok(null);
  }

  resetForTest(): void {
    this.byProject.clear();
    this.byEventId.clear();
    this.byIdempotency.clear();
    this.byClaimId.clear();
  }
}

export interface InMemoryRelayStores extends RelayStores {
  resetAllForTest(): void;
}

/** The explicit configuration path: constructing volatile stores REQUIRES
 * acknowledging volatility. There is no default/implicit construction. */
export function createInMemoryRelayStores(opts: { acknowledgeVolatile: true }): InMemoryRelayStores {
  if (opts?.acknowledgeVolatile !== true) {
    throw new Error(
      'In-memory Relay stores are test/dev-only and volatile; pass { acknowledgeVolatile: true } explicitly.',
    );
  }
  const projects = new InMemoryKeyedStore<RelayProject>();
  const runs = new InMemoryKeyedStore<RelayRun>();
  const events = new InMemoryEventStore();
  const tasks = new InMemoryKeyedStore<RelayTask>();
  const assignments = new InMemoryKeyedStore<TaskAssignment>();
  const fileClaims = new InMemoryKeyedStore<FileClaim>();
  const resourceClaims = new InMemoryKeyedStore<ResourceClaim>();
  const packages = new InMemoryKeyedStore<AgentHandoffPackage>();
  const compilations = new InMemoryKeyedStore<HandoffCompilationRecord>();
  const failures = new InMemoryKeyedStore<FailureRecord>();
  const reports = new InMemoryKeyedStore<ReportEnvelope>();
  const evidence = new InMemoryKeyedStore<EvidenceRecord>();
  const evidenceBundles = new InMemoryKeyedStore<EvidenceBundle>();
  const sessionRefs = new InMemoryKeyedStore<AgentSessionReference>();
  const artifacts = new InMemoryKeyedStore<ArtifactReference>();
  const usage = new InMemoryKeyedStore<UsageRecord>();
  return {
    projects,
    runs,
    events,
    tasks,
    assignments,
    fileClaims,
    resourceClaims,
    packages,
    compilations,
    failures,
    reports,
    evidence,
    evidenceBundles,
    sessionRefs,
    artifacts,
    usage,
    durability: 'volatile-test-only',
    resetAllForTest() {
      for (const store of [
        projects, runs, tasks, assignments, fileClaims, resourceClaims, packages,
        compilations, failures, reports, evidence, evidenceBundles, sessionRefs,
        artifacts, usage,
      ]) {
        (store as InMemoryKeyedStore<unknown>).resetForTest();
      }
      events.resetForTest();
    },
  };
}
