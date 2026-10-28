import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

import { beforeAll, describe, expect, it } from 'vitest';

import {
  JULIUS_LATENCY_JITTER, JULIUS_LATENCY_SCHEMA, JULIUS_SIMULATED_LATENCY_LABEL,
  juliusInjectedLatencyMs, juliusLatencyMatrix, juliusLatencyStats, measureJuliusLatencyCase,
  type JuliusLatencyCaseResult, type JuliusLatencyRecord,
} from './julius-latency-measure';

/**
 * JULIUS'S OWN OVERHEAD UNDER SIMULATED PROVIDER LATENCY — row 13's missing
 * latency evidence, measured rather than asserted to the millisecond.
 *
 * Beside `julius-multi-mission.e2e.test.ts`, which proves many missions
 * complete and stay isolated through one loop. This file wraps the same kind
 * of scripted fake providers in INJECTED delays (fixed 0 ms; seeded uniform
 * 50–500 ms) and separates Julius's time from the simulated provider's.
 *
 * SIMULATED PROVIDER LATENCY, EVERYWHERE. No real provider is called and none
 * of these numbers is a real provider's latency; that stays Unknown.
 *
 * NON-FLAKY BY SHAPE. Every bound is a RATIO with an order of magnitude of
 * headroom over what was measured, never an absolute millisecond figure about
 * one laptop:
 *   - Julius's time per dispatch stays under 25% of the mean injected delay
 *     (measured ≈1–2%);
 *   - one loop dispatches serially, so its makespan is at least the serial
 *     sum — a fact about the current design, recorded rather than hidden;
 *   - four loops over one store finish twelve missions in under 75% of the
 *     serial sum (measured ≈27%), never beat the critical path, and dispatch
 *     every task exactly once.
 */

const ports = {
  nowMs: () => performance.now(),
  sleep: (ms: number) => new Promise<void>((done) => { setTimeout(done, ms); }),
};

const RECORD_PATH = resolve(__dirname, 'julius-latency-measure.json');

/** Bounds shared by the live run and the committed record. */
const MAX_JULIUS_OVER_INJECTED = 0.25;
const MAX_PARALLEL_MAKESPAN_OVER_SERIAL = 0.75;

function assertShape(result: JuliusLatencyCaseResult) {
  expect(result.label, `${result.name} carries the simulated label`).toBe(JULIUS_SIMULATED_LATENCY_LABEL);
  expect(result.completedMissions, `${result.name}: every mission completes`).toBe(result.missions);
  // plan, plan review, build, build review — and never a task run twice,
  // which is the multi-loop reliability claim.
  expect(result.dispatches, `${result.name}: four dispatches per mission`).toBe(result.missions * 4);
  expect(result.distinctDispatchedTasks, `${result.name}: no task dispatched twice`).toBe(result.dispatches);
  if (result.loops === 1) {
    expect(result.juliusPerDispatchMs, `${result.name}: Julius time is measured for one loop`).not.toBeNull();
    expect(result.juliusPerDispatchMs!).toBeGreaterThanOrEqual(0);
    // ONE LOOP NEVER OVERLAPS TWO PROVIDER CALLS: `tick` runs its admitted
    // claims one after another. Concurrency across missions comes from more
    // workers, which the multi-loop cases measure.
    expect(result.makespanMs, `${result.name}: a single loop is serial`).toBeGreaterThanOrEqual(result.serialInjectedMs);
  } else {
    // Not attributable while loops share one event loop: Unknown, not zero.
    expect(result.juliusPerDispatchMs).toBeNull();
    expect(result.tickJulius).toBeNull();
  }
  if (result.serialInjectedMs === 0) {
    // Nothing to be a fraction of: the ratio is undefined, not zero.
    expect(result.juliusOverInjected).toBeNull();
    expect(result.makespanOverSerial).toBeNull();
  } else {
    expect(result.makespanMs, `${result.name}: no schedule beats the critical path`).toBeGreaterThanOrEqual(result.criticalPathInjectedMs);
    if (result.loops === 1) {
      expect(result.juliusOverInjected!, `${result.name}: Julius per dispatch vs mean simulated delay`).toBeLessThan(MAX_JULIUS_OVER_INJECTED);
    } else {
      expect(result.makespanOverSerial!, `${result.name}: parallel loops beat the serial sum`).toBeLessThan(MAX_PARALLEL_MAKESPAN_OVER_SERIAL);
    }
  }
}

describe('injected latency is deterministic and honest about Unknown', () => {
  it('draws the same seeded delay per task and attempt, inside the profile', () => {
    const keys = Array.from({ length: 200 }, (_, index) => `run-${String(index)}:plan#1`);
    const first = keys.map((key) => juliusInjectedLatencyMs(JULIUS_LATENCY_JITTER, key));
    const again = keys.map((key) => juliusInjectedLatencyMs(JULIUS_LATENCY_JITTER, key));
    expect(again).toEqual(first);
    for (const value of first) {
      expect(value).toBeGreaterThanOrEqual(50);
      expect(value).toBeLessThanOrEqual(500);
    }
    // A spread, not a constant: the draw is doing something.
    expect(new Set(first).size).toBeGreaterThan(50);
    expect(juliusInjectedLatencyMs({ kind: 'fixed', ms: 0 }, 'anything')).toBe(0);
  });

  it('reports no sample as null rather than zero', () => {
    expect(juliusLatencyStats([])).toEqual({ count: 0, meanMs: null, p50Ms: null, p95Ms: null, maxMs: null });
    expect(juliusLatencyStats([3, 1, 2])).toMatchObject({ count: 3, meanMs: 2, p50Ms: 2, maxMs: 3 });
  });
});

describe('Julius overhead under simulated provider latency, 1 / 3 / 12 missions', () => {
  const results = new Map<string, JuliusLatencyCaseResult>();

  beforeAll(async () => {
    // Discarded warm-up, so module loading is not booked to the first case.
    await measureJuliusLatencyCase({ name: 'warm-up', missions: 3, loops: 1, claimLimit: 10, profile: { kind: 'fixed', ms: 0 } }, ports);
    for (const item of juliusLatencyMatrix('test')) results.set(item.name, await measureJuliusLatencyCase(item, ports));
  }, 300_000);

  it('runs every case of the test matrix to verified completion, labelled simulated', () => {
    expect([...results.keys()]).toEqual(juliusLatencyMatrix('test').map((item) => item.name));
    for (const result of results.values()) assertShape(result);
  });

  it('keeps Julius’s per-dispatch time a small fraction of the simulated provider delay', () => {
    for (const missions of [1, 3, 12]) {
      const result = results.get(`jitter-50-500ms/${String(missions)}-missions/1-loop`)!;
      expect(result.juliusOverInjected!, `${String(missions)} missions`).toBeLessThan(MAX_JULIUS_OVER_INJECTED);
      // The tick's own time is the tick minus the provider: a tick that spent
      // most of its wall clock in Julius would show here.
      expect(result.tickJulius!.meanMs!).toBeLessThan(result.tickWall.meanMs!);
    }
  });

  it('twelve missions over four loops finish well inside the serial sum', () => {
    const parallel = results.get('jitter-50-500ms/12-missions/4-loops')!;
    const serial = results.get('jitter-50-500ms/12-missions/1-loop')!;
    // The same seeded delays, so the two serial sums are the same number.
    expect(parallel.serialInjectedMs).toBe(serial.serialInjectedMs);
    expect(parallel.makespanMs).toBeLessThan(serial.makespanMs * MAX_PARALLEL_MAKESPAN_OVER_SERIAL);
    expect(parallel.makespanMs).toBeGreaterThanOrEqual(parallel.idealMakespanMs);
  });
});

describe('the committed record (`npm run julius:latency:measure`)', () => {
  const record = JSON.parse(readFileSync(RECORD_PATH, 'utf8')) as JuliusLatencyRecord;

  it('is the current schema, labelled simulated, and covers the record matrix', () => {
    expect(record.schema).toBe(JULIUS_LATENCY_SCHEMA);
    expect(record.label).toBe(JULIUS_SIMULATED_LATENCY_LABEL);
    expect(record.label).toMatch(/not real-provider latency/u);
    expect(typeof record.generatedAt).toBe('string');
    // A matrix change without a re-measure leaves a stale record: regenerate.
    expect(record.cases.map((item) => item.name)).toEqual(juliusLatencyMatrix('record').map((item) => item.name));
  });

  it('holds the same shape and ratio bounds the live run does', () => {
    for (const result of record.cases) assertShape(result);
  });
});
