import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { sameStoredJuliusEvent } from './julius-event-postgres';
import { JULIUS_EVENT_APPEND_CASES, type JuliusEventAppendStore } from './julius-event-append-conformance';
import type { JuliusOperationalEvent } from '../mission/julius';

/**
 * THE DECISION THE POSTGRESQL WRITER MAKES, WITHOUT A DATABASE.
 *
 * Whether a row already IS this event is what makes a replay idempotent and a
 * rewrite a conflict. It used to compare `JSON.stringify` of a payload that had
 * been through `jsonb` — which reorders keys — so it answered "different" for
 * events that were identical, and every honest replay was refused. The decision
 * is separated from the transaction so it can be proven here, and the same
 * behaviour is proven end to end against real PostgreSQL in CI.
 *
 * The second half of this file checks the CONTRACT CASES themselves: a case
 * that cannot fail proves nothing, so each is run against a store that breaks
 * the rule it names.
 */

const EVENT: JuliusOperationalEvent = {
  eventId: 'event:1', runId: 'run-1', projectId: 'prj-1', type: 'task.created',
  taskId: 'task-1', workerId: 'worker-1', correlationId: 'corr-1', causationId: null,
  occurredAt: '2099-01-01T00:00:00.000Z', facts: { outcome: 'SUCCEEDED', attempt: 2, clean: true, note: null },
};
/** What the writer stores, in the order it builds it. */
const stored = (event: JuliusOperationalEvent): Record<string, unknown> => ({
  schemaVersion: 'relay-julius-event.v1',
  runId: event.runId, projectId: event.projectId, type: event.type, taskId: event.taskId,
  workerId: event.workerId, correlationId: event.correlationId, causationId: event.causationId,
  occurredAt: event.occurredAt, facts: event.facts,
});
/** What `jsonb` hands back: the same content, its own key order, at every depth. */
const reordered = (value: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort((a, b) => (a.length - b.length) || a.localeCompare(b))) {
    const item = value[key];
    out[key] = item !== null && typeof item === 'object' && !Array.isArray(item)
      ? reordered(item as Record<string, unknown>) : item;
  }
  return out;
};

describe('whether a stored row already is this event', () => {
  it('is yes for the same event, whatever order the database hands the keys back in', () => {
    expect(sameStoredJuliusEvent(stored(EVENT), EVENT)).toBe(true);
    const roundTripped = reordered(stored(EVENT));
    expect(Object.keys(roundTripped)[0], 'the round trip really reorders').not.toBe('schemaVersion');
    expect(sameStoredJuliusEvent(roundTripped, EVENT)).toBe(true);
  });

  it('is yes for a replay written at a later instant: the ledger keeps the first', () => {
    expect(sameStoredJuliusEvent(stored(EVENT), { ...EVENT, occurredAt: '2099-12-31T23:59:59.000Z' })).toBe(true);
  });

  it('is no whenever the event says something else', () => {
    for (const over of [
      { facts: { outcome: 'FAILED', attempt: 2, clean: true, note: null } },
      { facts: { outcome: 'SUCCEEDED', attempt: 3, clean: true, note: null } },
      { facts: { outcome: 'SUCCEEDED', attempt: 2, clean: false, note: null } },
      { facts: { outcome: 'SUCCEEDED', attempt: 2, clean: true, note: '' } },
      { taskId: 'task-2' }, { type: 'task.cancelled' as const }, { runId: 'run-2' },
      { projectId: 'prj-2' }, { workerId: null }, { correlationId: 'corr-2' }, { causationId: 'event:0' },
    ]) {
      expect(sameStoredJuliusEvent(stored(EVENT), { ...EVENT, ...over }), JSON.stringify(over)).toBe(false);
    }
  });

  it('is no for a row it cannot read at all', () => {
    for (const payload of [null, undefined, 'a payload', 42, []]) {
      expect(sameStoredJuliusEvent(payload, EVENT), String(payload)).toBe(false);
    }
  });

  it('reads a difference nested inside a fact, not only at the top level', () => {
    // `facts` is scalars by contract, but the stored payload is whatever the
    // column holds, and a canonical form that stopped at the first level would
    // call these two rows the same event.
    const deep = (value: unknown) => ({ ...stored(EVENT), facts: { nested: value } });
    const event = { ...EVENT, facts: { nested: ['a', 'b'] } } as unknown as JuliusOperationalEvent;
    expect(sameStoredJuliusEvent(deep(['a', 'b']), event)).toBe(true);
    expect(sameStoredJuliusEvent(deep(['b', 'a']), event)).toBe(false);
    expect(sameStoredJuliusEvent(deep([{ x: 1 }]), { ...EVENT, facts: { nested: [{ x: 2 }] } } as unknown as JuliusOperationalEvent)).toBe(false);
  });
});

describe('the writer acts on that decision', () => {
  /**
   * The throw itself lives inside the transaction, where only a database can
   * reach it — the real-PostgreSQL conformance job proves it end to end. This
   * holds the one line that connects the decision to the refusal, so removing
   * it cannot pass unnoticed here either.
   */
  it('refuses the write when the row is not this event, and refuses it with the typed conflict', () => {
    const source = readFileSync(join(process.cwd(), 'src/relay/persistence/julius-event-postgres.ts'), 'utf8');
    expect(source).toContain('if(!sameStoredJuliusEvent(payload,event))throw new JuliusEventIdConflict(event.eventId);');
    // And nothing else decides it: one comparison, one throw.
    expect([...source.matchAll(/throw new JuliusEventIdConflict/gu)]).toHaveLength(1);
    expect(source, 'the decision is one exported function').toContain('export const sameStoredJuliusEvent=');
  });
});

/* ------------------------------------------------- the cases can actually fail */

/** A store that records everything and refuses nothing: every case must catch it. */
const permissiveStore = (): JuliusEventAppendStore => {
  const rows: JuliusOperationalEvent[] = [];
  return {
    append: async (event) => { rows.push(event); return true; },
    rowsFor: async (eventId) => rows.filter((row) => row.eventId === eventId).length,
    factsFor: async (eventId) => rows.find((row) => row.eventId === eventId)?.facts ?? null,
  };
};
/** A store that refuses everything with the wrong error: a conflict case must not accept it. */
const wrongErrorStore = (): JuliusEventAppendStore => {
  const rows: JuliusOperationalEvent[] = [];
  return {
    append: async (event) => {
      if (rows.some((row) => row.eventId === event.eventId)) throw new Error('something else went wrong');
      rows.push(event);
      return true;
    },
    rowsFor: async (eventId) => rows.filter((row) => row.eventId === eventId).length,
    factsFor: async (eventId) => rows.find((row) => row.eventId === eventId)?.facts ?? null,
  };
};

describe('the contract cases would catch a store that broke them', () => {
  const event = (over: Partial<JuliusOperationalEvent> = {}): JuliusOperationalEvent => ({ ...EVENT, ...over });

  it('every case but the first fails against a store that records everything', async () => {
    const outcomes = await Promise.all(JULIUS_EVENT_APPEND_CASES.map(async (contractCase) =>
      contractCase.run(permissiveStore(), event).then(() => 'passed' as const, () => 'failed' as const)));
    // The first case ("a new event is recorded once") and the last ("two different
    // events both record") are honest about a permissive store; the rest are the
    // rules it breaks, and each must catch it.
    expect(outcomes.filter((outcome) => outcome === 'failed').length).toBeGreaterThanOrEqual(JULIUS_EVENT_APPEND_CASES.length - 2);
  });

  it('a conflict case refuses a store that raises the wrong error', async () => {
    const conflictCases = JULIUS_EVENT_APPEND_CASES.filter((contractCase) => contractCase.name.includes('conflict'));
    expect(conflictCases.length).toBeGreaterThan(0);
    for (const contractCase of conflictCases) {
      await expect(contractCase.run(wrongErrorStore(), event), contractCase.name).rejects.toThrow(/refused with/u);
    }
  });
});
