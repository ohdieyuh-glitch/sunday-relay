import { describe, expect, it } from 'vitest';

import {
  JULIUS_COUNTERS, JULIUS_HISTOGRAMS, projectJuliusMetrics, runtimeVersionsIn,
  summariseJuliusEvals, summariseSamples,
} from './julius-metrics';
import { JULIUS_TRAJECTORY_KINDS, type JuliusTrajectoryEvent } from './julius-trajectory';
import { createJuliusHarness, seedRun, task, worker } from './julius-runtime-fixtures';

/**
 * NUMBERS THAT CANNOT DISAGREE WITH THE RECORD.
 *
 * Every counter and histogram is a projection of the trajectory rather than a
 * parallel tally, so the tests that matter most are the ones about what
 * happens when there is NOTHING to count. An average over an empty set is not
 * zero; it does not exist, and reporting zero is the specific lie that makes a
 * placeholder look like a measurement.
 */

const CODER = worker({ workerId: 'coder', role: 'CODING_AGENT', capabilities: ['implement'], taskTypes: ['build'] });
const scope = { projectId: 'prj-1' };

const trajectory = (over: Partial<JuliusTrajectoryEvent> & { kind: JuliusTrajectoryEvent['kind'] }): JuliusTrajectoryEvent => ({
  trajectoryEventId: `t-${Math.abs(over.kind.length)}-${over.idempotencyKey ?? over.kind}`,
  runId: 'run-1', projectId: 'prj-1', taskId: null, workerId: null, providerId: null, contextId: null,
  runtimeVersion: 'julius-runtime.v1', policyVersion: 'card-r1', cardRevision: 'card-r1',
  missionContractRevision: 1, projectBrainRevision: 0,
  durationMs: null, usdMicros: null, inputTokens: null, outputTokens: null,
  outcome: null, safeFacts: {}, idempotencyKey: over.idempotencyKey ?? over.kind,
  occurredAt: '2026-08-27T00:00:00.000Z', ...over,
});

/* ------------------------------------------------------------ histograms */

describe('a histogram over samples that exist', () => {
  it('is entirely null when there are none', () => {
    const empty = summariseSamples([]);
    expect(empty.count).toBe(0);
    for (const field of ['sum', 'min', 'p50', 'p95', 'max'] as const) {
      expect(empty[field], field).toBeNull();
    }
  });

  it('excludes an unobserved sample rather than counting it as zero', () => {
    // A task whose duration was never observed did not take no time.
    const summary = summariseSamples([null, 100, null, 300]);
    expect(summary.count).toBe(2);
    expect(summary.min).toBe(100);
    expect(summary.max).toBe(300);
    expect(summary.sum).toBe(400);
  });

  it('excludes a value that is not a real measurement', () => {
    expect(summariseSamples([Number.NaN, Number.POSITIVE_INFINITY, -5]).count).toBe(0);
  });

  it('computes exact nearest-rank percentiles', () => {
    const summary = summariseSamples([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(summary.p50).toBe(5);
    expect(summary.p95).toBe(10);
    expect(summary.min).toBe(1);
    expect(summary.max).toBe(10);
    expect(summary.sum).toBe(55);
  });

  it('handles a single sample without special-casing', () => {
    const summary = summariseSamples([42]);
    expect([summary.min, summary.p50, summary.p95, summary.max]).toEqual([42, 42, 42, 42]);
  });
});

/* --------------------------------------------------------------- counters */

describe('counters are a projection of the trajectory', () => {
  it('declares every counter and histogram exactly once', () => {
    expect(new Set(JULIUS_COUNTERS).size).toBe(JULIUS_COUNTERS.length);
    expect(new Set(JULIUS_HISTOGRAMS).size).toBe(JULIUS_HISTOGRAMS.length);
  });

  it('reports zero for everything on an empty sample, and says the sample was empty', () => {
    const snapshot = projectJuliusMetrics([], 'julius-runtime.v1');
    expect(snapshot.sampledEvents).toBe(0);
    for (const counter of JULIUS_COUNTERS) expect(snapshot.counters[counter], counter).toBe(0);
    for (const name of JULIUS_HISTOGRAMS) expect(snapshot.histograms[name].count, name).toBe(0);
  });

  it('counts runs by distinct run id, not by event', () => {
    const events = [
      trajectory({ kind: 'COMPLETION', outcome: 'VERIFIED', runId: 'a', idempotencyKey: '1' }),
      trajectory({ kind: 'COMPLETION', outcome: 'VERIFIED', runId: 'a', idempotencyKey: '2' }),
      trajectory({ kind: 'COMPLETION', outcome: 'VERIFIED', runId: 'b', idempotencyKey: '3' }),
      trajectory({ kind: 'COMPLETION', outcome: 'FAILED', runId: 'c', idempotencyKey: '4' }),
    ];
    const snapshot = projectJuliusMetrics(events, 'julius-runtime.v1');
    expect(snapshot.counters.julius_runs_completed).toBe(2);
    expect(snapshot.counters.julius_runs_failed).toBe(1);
  });

  it('separates runtime versions and never blends them', () => {
    // Comparing generations is the whole point; an average across two runtimes
    // is a number about neither of them.
    const events = [
      trajectory({ kind: 'DISPATCH', durationMs: 100, runtimeVersion: 'v1', idempotencyKey: '1' }),
      trajectory({ kind: 'DISPATCH', durationMs: 900, runtimeVersion: 'v2', idempotencyKey: '2' }),
    ];
    expect(runtimeVersionsIn(events)).toEqual(['v1', 'v2']);
    expect(projectJuliusMetrics(events, 'v1').histograms.julius_task_duration_ms.max).toBe(100);
    expect(projectJuliusMetrics(events, 'v2').histograms.julius_task_duration_ms.max).toBe(900);
  });

  it('carries no run, task, worker or user dimension', () => {
    const snapshot = projectJuliusMetrics([trajectory({ kind: 'DISPATCH' })], 'julius-runtime.v1');
    const keys = Object.keys(snapshot);
    for (const forbidden of ['runId', 'taskId', 'workerId', 'userId', 'projectId', 'missionId']) {
      expect(keys, forbidden).not.toContain(forbidden);
    }
    // The one dimension is the runtime version, which is a small closed set.
    expect(snapshot.runtimeVersion).toBe('julius-runtime.v1');
  });

  it('has a counter or histogram for every trajectory kind that carries one', () => {
    // Not every kind needs a counter, but a kind that is emitted and appears
    // in NO number is a fact the runtime records and nothing can read.
    const counted = new Set([
      'TASK_TOPOLOGY', 'DISPATCH', 'RETRY', 'FALLBACK', 'REPAIR', 'SUBAGENT',
      'GAUNTLET_ROUND', 'FINDING', 'RECOVERY', 'COMPLETION', 'CONTEXT_COMPILED',
    ]);
    const uncounted = JULIUS_TRAJECTORY_KINDS.filter((kind) => !counted.has(kind));
    // WORKER_SELECTED / PROVIDER_SELECTED / VERIFICATION are recorded for
    // provenance rather than for a rate, and that is a deliberate choice
    // stated here rather than an omission.
    expect(uncounted.sort()).toEqual(['PROVIDER_SELECTED', 'VERIFICATION', 'WORKER_SELECTED']);
  });
});

/* ------------------------------------------------------------------ evals */

describe('the eval summary', () => {
  it('reports null cost-per-completion when nothing completed', () => {
    // Reporting zero would make the cheapest generation the one that never
    // finished anything.
    const summary = summariseJuliusEvals([
      trajectory({ kind: 'DISPATCH', usdMicros: 5_000, idempotencyKey: '1' }),
    ], 'julius-runtime.v1');
    expect(summary.verifiedCompletions).toBe(0);
    expect(summary.knownUsdMicros).toBe(5_000);
    expect(summary.knownCostPerVerifiedCompletion).toBeNull();
  });

  it('reports null average duration when nothing recorded one', () => {
    const summary = summariseJuliusEvals([trajectory({ kind: 'DISPATCH' })], 'julius-runtime.v1');
    expect(summary.averageDurationMs).toBeNull();
  });

  it('reports a real zero rate alongside a zero run count, so the two are distinguishable', () => {
    const empty = summariseJuliusEvals([], 'julius-runtime.v1');
    expect(empty.runs).toBe(0);
    expect(empty.verifiedCompletionRate).toBe(0);
    expect(empty.knownCostPerVerifiedCompletion).toBeNull();
  });

  it('computes a rate and a cost from a real mixed sample', () => {
    const events = [
      trajectory({ kind: 'TASK_TOPOLOGY', runId: 'a', idempotencyKey: '1' }),
      trajectory({ kind: 'TASK_TOPOLOGY', runId: 'b', idempotencyKey: '2' }),
      trajectory({ kind: 'DISPATCH', runId: 'a', usdMicros: 1_000, durationMs: 200, idempotencyKey: '3' }),
      trajectory({ kind: 'DISPATCH', runId: 'b', usdMicros: 3_000, durationMs: 400, idempotencyKey: '4' }),
      trajectory({ kind: 'COMPLETION', runId: 'a', outcome: 'VERIFIED', idempotencyKey: '5' }),
      trajectory({ kind: 'COMPLETION', runId: 'b', outcome: 'FAILED', idempotencyKey: '6' }),
    ];
    const summary = summariseJuliusEvals(events, 'julius-runtime.v1');
    expect(summary.runs).toBe(2);
    expect(summary.verifiedCompletions).toBe(1);
    expect(summary.verifiedCompletionRate).toBe(0.5);
    expect(summary.knownUsdMicros).toBe(4_000);
    expect(summary.knownCostPerVerifiedCompletion).toBe(4_000);
    expect(summary.unknownCostComponents, 'both dispatches reported').toBe(0);
    expect(summary.costComplete).toBe(true);
    expect(summary.averageDurationMs).toBe(300);
  });

  /**
   * THE LIVE RUN 3 SHAPE. One dispatch reported and one did not, and the old
   * summary published `totalUsdMicros: 1000` — a floor wearing a total's name,
   * which is exactly how a mission that cost at least $0.61 was reported as a
   * mission that cost $0.61. Omitting the unknown from the SUM is right;
   * omitting it from the SUMMARY is what made the number unquotable.
   */
  it('counts an unknown cost rather than dropping it, so a floor is never read as a total', () => {
    const summary = summariseJuliusEvals([
      trajectory({ kind: 'DISPATCH', usdMicros: 1_000, idempotencyKey: '1' }),
      trajectory({ kind: 'DISPATCH', usdMicros: null, idempotencyKey: '2' }),
    ], 'julius-runtime.v1');
    expect(summary.knownUsdMicros, 'the unknown one is never added as zero').toBe(1_000);
    expect(summary.unknownCostComponents, 'and it is never simply dropped either').toBe(1);
    expect(summary.costComplete).toBe(false);
  });

  /**
   * Only a DISPATCH can cost money. A RETRY or a COMPLETION row carries no cost
   * by construction, so counting its absent cost as unmeasured would make every
   * window incomplete forever and the flag would stop meaning anything.
   */
  it('counts only dispatches as cost components', () => {
    const summary = summariseJuliusEvals([
      trajectory({ kind: 'DISPATCH', usdMicros: 1_000, idempotencyKey: '1' }),
      trajectory({ kind: 'RETRY', usdMicros: null, idempotencyKey: '2' }),
      trajectory({ kind: 'COMPLETION', outcome: 'VERIFIED', usdMicros: null, idempotencyKey: '3' }),
    ], 'julius-runtime.v1');
    expect(summary.unknownCostComponents).toBe(0);
    expect(summary.costComplete, 'the only dispatch reported its cost').toBe(true);
  });

  it('reports the version it summarised, so two are never confused', () => {
    expect(summariseJuliusEvals([], 'v-old').runtimeVersion).toBe('v-old');
  });
});

/* ------------------------------------------------- against a real runtime */

describe('the numbers come from a real run', () => {
  it('counts a completed run, its dispatches and its context sizes', async () => {
    const harness = createJuliusHarness({ workers: [{ worker: CODER, script: [{ kind: 'succeed' }] }] });
    seedRun(harness, { tasks: [task({ taskId: 'task-1' })] });
    await harness.loop.tick(scope);

    const events = harness.store.trajectory();
    const snapshot = projectJuliusMetrics(events, 'julius-runtime.v1');
    expect(snapshot.counters.julius_runs_started).toBe(1);
    expect(snapshot.counters.julius_runs_completed).toBe(1);
    expect(snapshot.counters.julius_tasks_dispatched).toBeGreaterThan(0);
    expect(snapshot.histograms.julius_context_characters.count).toBeGreaterThan(0);

    const summary = summariseJuliusEvals(events, 'julius-runtime.v1');
    expect(summary.verifiedCompletions).toBe(1);
    expect(summary.verifiedCompletionRate).toBe(1);
  });

  it('records the COMPLETION fact the SQL summary counts verified runs by', async () => {
    // `summarize` looks for `event_kind='COMPLETION' AND outcome='VERIFIED'`
    // and nothing emitted one, so `verifiedCompletionRate` was structurally
    // zero for every project and every runtime version.
    const harness = createJuliusHarness({ workers: [{ worker: CODER, script: [{ kind: 'succeed' }] }] });
    seedRun(harness, { tasks: [task({ taskId: 'task-1' })] });
    await harness.loop.tick(scope);
    const completion = harness.store.trajectory().find((event) => event.kind === 'COMPLETION');
    expect(completion).toBeDefined();
    expect(completion!.outcome).toBe('VERIFIED');
  });

  it('records the topology, the selection and the provider of a real dispatch', async () => {
    const harness = createJuliusHarness({ workers: [{ worker: CODER, script: [{ kind: 'succeed' }] }] });
    seedRun(harness, { tasks: [task({ taskId: 'task-1' })] });
    await harness.loop.tick(scope);
    const kinds = new Set(harness.store.trajectory().map((event) => event.kind));
    for (const expected of ['TASK_TOPOLOGY', 'WORKER_SELECTED', 'PROVIDER_SELECTED', 'CONTEXT_COMPILED', 'DISPATCH', 'VERIFICATION', 'COMPLETION'] as const) {
      expect(kinds.has(expected), expected).toBe(true);
    }
    const provider = harness.store.trajectory().find((event) => event.kind === 'PROVIDER_SELECTED');
    expect(provider!.providerId).toBe(CODER.providerId);
  });

  it('never writes a chain of thought or a credential into a trajectory fact', async () => {
    const harness = createJuliusHarness({ workers: [{ worker: CODER, script: [{ kind: 'succeed' }] }] });
    seedRun(harness, { tasks: [task({ taskId: 'task-1' })] });
    await harness.loop.tick(scope);
    const serialized = JSON.stringify(harness.store.trajectory());
    expect(serialized.toLowerCase()).not.toContain('chain of thought');
    expect(serialized.toLowerCase()).not.toContain('scratchpad');
    expect(serialized).not.toMatch(/sk-[A-Za-z0-9]{8,}|Bearer\s+\S{16,}/);
    for (const event of harness.store.trajectory()) {
      for (const value of Object.values(event.safeFacts)) {
        expect(value === null || ['string', 'number', 'boolean'].includes(typeof value)).toBe(true);
      }
    }
  });
});
