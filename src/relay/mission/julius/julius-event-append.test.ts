import { describe, expect, it } from 'vitest';

import { createJuliusMemoryStore } from './julius-memory-store';
import { canonicalJuliusEventIdentity, JULIUS_EVENT_IDENTITY_VERSION, JuliusEventIdConflict, type JuliusOperationalEvent } from './julius-events';
import { JULIUS_EVENT_APPEND_CASES, type JuliusEventAppendStore } from '../../persistence/julius-event-append-conformance';

/**
 * THE EVENT APPEND CONTRACT, ON THE IN-MEMORY STORE.
 *
 * The same cases run against real PostgreSQL in CI
 * (`julius-event-append.real-postgres.test.ts`). Two stores, one contract: that
 * is the whole point of writing them once.
 */

const RUN = {
  runId: 'run-1', missionId: 'msn-1', projectId: 'prj-1', state: 'READY' as const,
  cardRevision: 'card-r1', missionContractRevision: 1, projectBrainRevision: 0, version: 1,
};

const memoryStore = (): { store: JuliusEventAppendStore; event: (over?: Partial<JuliusOperationalEvent>) => JuliusOperationalEvent } => {
  const memory = createJuliusMemoryStore();
  memory.seedRun(RUN);
  const event = (over: Partial<JuliusOperationalEvent> = {}): JuliusOperationalEvent => ({
    eventId: 'event:1', runId: 'run-1', projectId: 'prj-1', type: 'task.created',
    taskId: 'task-1', workerId: null, correlationId: 'corr-1', causationId: null,
    occurredAt: '2099-01-01T00:00:00.000Z', facts: { outcome: 'SUCCEEDED' },
    ...over,
  });
  return {
    event,
    store: {
      append: (value) => memory.appendEvent(value),
      rowsFor: async (eventId) => memory.events().filter((row) => row.eventId === eventId).length,
      factsFor: async (eventId) => memory.events().find((row) => row.eventId === eventId)?.facts ?? null,
    },
  };
};

describe('the in-memory store keeps the event append contract', () => {
  for (const contractCase of JULIUS_EVENT_APPEND_CASES) {
    it(contractCase.name, async () => {
      const { store, event } = memoryStore();
      await expect(contractCase.run(store, event)).resolves.toBeUndefined();
    });
  }

  it('the conflict it raises is the typed one, naming the event', async () => {
    const { store, event } = memoryStore();
    await store.append(event({ eventId: 'event:typed', facts: { a: 1 } }));
    const error = await store.append(event({ eventId: 'event:typed', facts: { a: 2 } })).then(() => null, (raised: unknown) => raised);
    expect(error).toBeInstanceOf(JuliusEventIdConflict);
    expect((error as JuliusEventIdConflict).eventId).toBe('event:typed');
  });
});

describe('what makes two writes the same event', () => {
  const base: JuliusOperationalEvent = {
    eventId: 'event:x', runId: 'run-1', projectId: 'prj-1', type: 'task.created',
    taskId: 'task-1', workerId: 'worker-1', correlationId: 'corr-1', causationId: null,
    occurredAt: '2099-01-01T00:00:00.000Z', facts: { b: 2, a: 1, c: null },
  };

  it('is the facts and the subject, at any key order and any depth', () => {
    expect(canonicalJuliusEventIdentity({ ...base, facts: { a: 1, b: 2, c: null } }))
      .toBe(canonicalJuliusEventIdentity(base));
    expect(canonicalJuliusEventIdentity(base)).toContain(JULIUS_EVENT_IDENTITY_VERSION);
  });

  it('is NOT the instant it was written, or no replay could ever be idempotent', () => {
    const later: JuliusOperationalEvent = { ...base, occurredAt: '2099-09-09T09:09:09.000Z' };
    expect(canonicalJuliusEventIdentity(later)).toBe(canonicalJuliusEventIdentity(base));
  });

  it('is NOT the id: two ids may carry the same event, and the id is what the store keys on', () => {
    const renamed: JuliusOperationalEvent = { ...base, eventId: 'event:other' };
    expect(canonicalJuliusEventIdentity(renamed)).toBe(canonicalJuliusEventIdentity(base));
  });

  it('changes when anything the event says changes', () => {
    for (const over of [
      { runId: 'run-2' }, { projectId: 'prj-2' }, { type: 'task.cancelled' as const },
      { taskId: 'task-2' }, { taskId: null }, { workerId: null },
      { correlationId: 'corr-2' }, { causationId: 'event:cause' },
      { facts: { b: 2, a: 1 } }, { facts: { b: 2, a: 1, c: 0 } }, { facts: { b: '2', a: 1, c: null } },
    ]) {
      expect(canonicalJuliusEventIdentity({ ...base, ...over }), JSON.stringify(over))
        .not.toBe(canonicalJuliusEventIdentity(base));
    }
  });
});
