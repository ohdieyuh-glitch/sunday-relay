import { describe, expect, it } from 'vitest';

import {
  MAX_ERROR_EVENTS, MAX_LATENCY_SAMPLES, createOperationalStore,
  type OperationalBacking,
} from './operational-store';
import { projectOperations } from './llmops-projection';
import type { RunObservation } from './run-observation';

/**
 * THE STORE THAT MAKES THE MODEL AN INSTRUMENT.
 *
 * What is tested is not that a Map round-trips. It is the four ways a store
 * quietly lies: by claiming durability it does not have, by truncating without
 * saying so, by losing a concurrent write, and by reporting a failed read as an
 * empty project.
 */

const AT = (seconds: number) =>
  new Date(Date.parse('2026-08-05T12:00:00.000Z') + seconds * 1000).toISOString();

const observation = (over: Partial<RunObservation> = {}): RunObservation => ({
  latency: [{ phase: 'total', durationMs: 1000, observedAt: AT(0) }],
  errors: [],
  observedAt: AT(0),
  attemptsObserved: 1,
  ...over,
});

function memoryBacking(over: Partial<OperationalBacking> = {}): OperationalBacking {
  const map = new Map<string, string>();
  return {
    durability: 'volatile-test-only',
    locationLabel: 'in-memory (test)',
    async getText(key) { return map.get(key) ?? null; },
    async putText(key, value) { map.set(key, value); },
    ...over,
  };
}

describe('the store never claims durability it does not have', () => {
  it('carries the backing’s own label out verbatim', () => {
    const store = createOperationalStore(memoryBacking());
    expect(store.status.durability).toBe('volatile-test-only');
    expect(store.status.locationLabel).toBe('in-memory (test)');
    // And it is honest about what its serialisation does and does not cover.
    expect(store.status.concurrencyScope).toBe('process');
  });

  it('does not upgrade a volatile backing to a durable one', () => {
    const store = createOperationalStore(memoryBacking({ durability: 'durable' }));
    expect(store.status.durability).toBe('durable');
  });
});

describe('nothing recorded is not the same as an empty record', () => {
  it('reads null before anything is written', async () => {
    const result = await createOperationalStore(memoryBacking()).read('p');
    expect(result.ok && result.record).toBeNull();
  });

  it('a FAILED read is not a project with no data', async () => {
    const store = createOperationalStore(memoryBacking({
      async getText() { throw new Error('backing unavailable'); },
    }));
    const result = await store.read('p');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toContain('backing unavailable');
  });

  it('a failed write is reported, never swallowed', async () => {
    const store = createOperationalStore(memoryBacking({
      async putText() { throw new Error('disk full'); },
    }));
    const result = await store.record('p', observation());
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toContain('disk full');
  });

  it('unreadable stored text is treated as absent, not as a crash', async () => {
    const store = createOperationalStore(memoryBacking({
      async getText() { return '{not json'; },
    }));
    const result = await store.record('p', observation());
    expect(result.ok).toBe(true);
    expect(result.ok && result.record.latency.length).toBe(1);
  });

  it('a record stored under another project is not adopted', async () => {
    const store = createOperationalStore(memoryBacking({
      async getText() { return JSON.stringify({ projectId: 'someone-else', latency: [] }); },
    }));
    const result = await store.record('p', observation());
    expect(result.ok && result.record.projectId).toBe('p');
    expect(result.ok && result.record.latency.length).toBe(1);
  });
});

describe('observations accumulate across runs', () => {
  it('folds many runs into one record, and the rate becomes knowable', async () => {
    const store = createOperationalStore(memoryBacking());
    for (let i = 0; i < 3; i += 1) await store.record('p', observation({ observedAt: AT(i) }));
    await store.record('p', observation({
      errors: [{ kind: 'provider_timeout', at: AT(3), recovered: false, attempt: 1 }],
      observedAt: AT(3),
    }));

    const read = await store.read('p');
    expect(read.ok && read.record).not.toBeNull();
    const view = projectOperations(read.ok && read.record ? read.record : (() => { throw new Error('no record'); })(), AT(4));
    expect(view.latency.find((l) => l.phase === 'total')?.samples).toBe(4);
    expect(view.errorRate.known && view.errorRate.value).toBeCloseTo(0.25, 5);
    expect(view.health).toBe('failing');
  });

  it('keeps projects apart', async () => {
    const store = createOperationalStore(memoryBacking());
    await store.record('a', observation());
    await store.record('b', observation());
    await store.record('b', observation({ observedAt: AT(1) }));
    const a = await store.read('a');
    const b = await store.read('b');
    expect(a.ok && a.record?.latency.length).toBe(1);
    expect(b.ok && b.record?.latency.length).toBe(2);
  });
});

describe('the record is bounded, and says what it dropped', () => {
  it('keeps the newest samples and counts the evictions', async () => {
    const store = createOperationalStore(memoryBacking());
    const extra = 7;
    for (let i = 0; i < MAX_LATENCY_SAMPLES + extra; i += 1) {
      await store.record('p', observation({
        latency: [{ phase: 'total', durationMs: i, observedAt: AT(i) }],
        observedAt: AT(i),
      }));
    }
    const read = await store.read('p');
    const record = read.ok && read.record ? read.record : null;
    expect(record?.latency.length).toBe(MAX_LATENCY_SAMPLES);
    // A p95 over a truncated window is a p95 OF THE WINDOW, so the count is
    // reported rather than left for the reader to guess at.
    expect(record?.droppedLatency).toBe(extra);
    // The NEWEST survived, not the oldest.
    expect(record?.latency[record.latency.length - 1].durationMs)
      .toBe(MAX_LATENCY_SAMPLES + extra - 1);
    // And the surface can see it.
    expect(projectOperations(record!, AT(9999)).droppedLatency).toBe(extra);
  });

  it('bounds errors separately from latency', async () => {
    const store = createOperationalStore(memoryBacking());
    for (let i = 0; i < MAX_ERROR_EVENTS + 3; i += 1) {
      await store.record('p', observation({
        latency: [],
        errors: [{ kind: 'tool_failure', at: AT(i), recovered: true, attempt: 1 }],
        observedAt: AT(i),
      }));
    }
    const read = await store.read('p');
    expect(read.ok && read.record?.errors.length).toBe(MAX_ERROR_EVENTS);
    expect(read.ok && read.record?.droppedErrors).toBe(3);
  });
});

describe('two runs finishing at once do not lose one another', () => {
  it('serialises writes per project through one store instance', async () => {
    // Without the per-project chain both calls read the old record and the
    // second overwrites the first's observation — silently, and exactly when
    // the system is busiest.
    let inFlight = 0;
    let overlapped = false;
    const store = createOperationalStore(memoryBacking({
      async putText() {
        inFlight += 1;
        if (inFlight > 1) overlapped = true;
        await new Promise((resolve) => { setTimeout(resolve, 1); });
        inFlight -= 1;
      },
    }));

    // A DETERMINISTIC race, not a hopeful one. Every read is held until all
    // twenty have arrived, so unserialised writers all see the same empty
    // record and the last one wins. Timing-based versions of this test pass
    // without the chain — the first draft of it did.
    const map = new Map<string, string>();
    const arrived: (() => void)[] = [];
    let release = () => {};
    const allArrived = new Promise<void>((resolve) => { release = resolve; });
    const real = createOperationalStore({
      durability: 'volatile-test-only',
      locationLabel: 'in-memory (test)',
      async getText(key) {
        arrived.push(() => {});
        if (arrived.length >= 20) release();
        // Serialised writers arrive one at a time and would deadlock on a
        // barrier, so the wait is bounded rather than absolute.
        await Promise.race([allArrived, new Promise((r) => { setTimeout(r, 5); })]);
        return map.get(key) ?? null;
      },
      async putText(key, value) { map.set(key, value); },
    });

    await Promise.all(Array.from({ length: 20 }, (_, i) =>
      real.record('p', observation({
        latency: [{ phase: 'total', durationMs: i, observedAt: AT(i) }],
        observedAt: AT(i),
      }))));

    const read = await real.read('p');
    // All twenty survived. Unserialised, they all read the same empty record
    // and the last write keeps one.
    expect(read.ok && read.record?.latency.length).toBe(20);
    expect(read.ok && read.record?.attempts.attempts).toBe(20);

    await Promise.all([store.record('q', observation()), store.record('q', observation())]);
    expect(overlapped).toBe(false);
  });

  it('a failed write does not wedge the chain for later ones', async () => {
    let fail = true;
    const map = new Map<string, string>();
    const store = createOperationalStore({
      durability: 'volatile-test-only',
      locationLabel: 'in-memory (test)',
      async getText(key) { return map.get(key) ?? null; },
      async putText(key, value) {
        if (fail) { fail = false; throw new Error('transient'); }
        map.set(key, value);
      },
    });
    const first = await store.record('p', observation());
    expect(first.ok).toBe(false);
    const second = await store.record('p', observation({ observedAt: AT(1) }));
    expect(second.ok).toBe(true);
  });
});
