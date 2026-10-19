/**
 * ONE CONTRACT FOR APPENDING AN EVENT, RUN AGAINST EVERY STORE THAT CLAIMS IT.
 *
 * The in-memory store and PostgreSQL disagreed about what a repeated event id
 * meant: memory compared the id alone and silently dropped a DIFFERENT event
 * written under a used id; PostgreSQL compared `JSON.stringify` of a payload
 * that had been through `jsonb` — which reorders keys — so a genuine replay
 * almost always read as a conflict. Neither behaviour was the contract the
 * ledger claims, and no suite compared the two.
 *
 * These cases are the contract. They are written once and run twice: against
 * the in-memory store, and against real PostgreSQL in CI. A store that passes
 * one and fails the other is the drift this file exists to stop.
 */

import type { JuliusOperationalEvent } from '../mission/julius';

export interface JuliusEventAppendStore {
  /** True when this call recorded the event, false when the same event was already there. */
  append(event: JuliusOperationalEvent): Promise<boolean>;
  /** How many rows carry this event id. */
  rowsFor(eventId: string): Promise<number>;
  /** The facts the store holds for this event id, or null when it holds none. */
  factsFor(eventId: string): Promise<Record<string, unknown> | null>;
}

export interface JuliusEventAppendCase {
  readonly name: string;
  run(store: JuliusEventAppendStore, event: (over?: Partial<JuliusOperationalEvent>) => JuliusOperationalEvent): Promise<void>;
}

/** Thrown by a case when the store did something the contract forbids. */
const fail = (message: string): never => { throw new Error(`event append contract: ${message}`); };
const equal = (actual: unknown, expected: unknown, message: string): void => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(`${message} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
};
const conflicts = async (action: () => Promise<unknown>, message: string): Promise<void> => {
  const outcome = await action().then(() => 'no error' as const, (error: unknown) => error);
  if (outcome === 'no error') fail(`${message} — the write was accepted`);
  const name = (outcome as Error).message;
  if (!/julius_event_id_conflict/u.test(name)) fail(`${message} — refused with ${name}`);
};

export const JULIUS_EVENT_APPEND_CASES: readonly JuliusEventAppendCase[] = [
  {
    name: 'a new event is recorded once',
    async run(store, event) {
      const row = event({ eventId: 'event:new' });
      equal(await store.append(row), true, 'a new event reports itself recorded');
      equal(await store.rowsFor('event:new'), 1, 'one row');
    },
  },
  {
    name: 'the same event replayed is idempotent: no duplicate, no error',
    async run(store, event) {
      const row = event({ eventId: 'event:replay' });
      await store.append(row);
      equal(await store.append(row), false, 'a replay reports that it recorded nothing');
      equal(await store.rowsFor('event:replay'), 1, 'still one row');
    },
  },
  {
    name: 'key order is not meaning: the same facts in another order are the same event',
    async run(store, event) {
      const first = event({ eventId: 'event:order', facts: { alpha: 1, beta: 'two', gamma: null } });
      await store.append(first);
      const reordered = event({ eventId: 'event:order', facts: { gamma: null, beta: 'two', alpha: 1 } });
      equal(await store.append(reordered), false, 'a reordered payload is the same event');
      equal(await store.rowsFor('event:order'), 1, 'still one row');
    },
  },
  {
    name: 'a later instant is not a different event: the ledger keeps the first',
    async run(store, event) {
      const first = event({ eventId: 'event:instant', occurredAt: '2099-01-01T00:00:00.000Z' });
      await store.append(first);
      equal(await store.append(event({ eventId: 'event:instant', occurredAt: '2099-06-06T12:00:00.000Z' })), false,
        'the same event written later is the same event');
      equal(await store.rowsFor('event:instant'), 1, 'still one row');
    },
  },
  {
    name: 'the same id carrying different facts is a typed conflict, and nothing is written',
    async run(store, event) {
      await store.append(event({ eventId: 'event:conflict', facts: { outcome: 'SUCCEEDED' } }));
      await conflicts(
        () => store.append(event({ eventId: 'event:conflict', facts: { outcome: 'FAILED' } })),
        'a different event under a used id',
      );
      equal(await store.rowsFor('event:conflict'), 1, 'one row');
      equal((await store.factsFor('event:conflict'))?.outcome, 'SUCCEEDED', 'the recorded facts stand');
    },
  },
  {
    name: 'a different subject under a used id is a conflict too',
    async run(store, event) {
      await store.append(event({ eventId: 'event:subject', taskId: 'task-a' }));
      await conflicts(() => store.append(event({ eventId: 'event:subject', taskId: 'task-b' })), 'another task under a used id');
      await conflicts(() => store.append(event({ eventId: 'event:subject', type: 'task.cancelled' })), 'another type under a used id');
      equal(await store.rowsFor('event:subject'), 1, 'one row');
    },
  },
  {
    name: 'two different events both record',
    async run(store, event) {
      equal(await store.append(event({ eventId: 'event:two-a', facts: { n: 1 } })), true, 'the first records');
      equal(await store.append(event({ eventId: 'event:two-b', facts: { n: 2 } })), true, 'the second records');
      equal(await store.rowsFor('event:two-a'), 1, 'one row each');
      equal(await store.rowsFor('event:two-b'), 1, 'one row each');
    },
  },
];
