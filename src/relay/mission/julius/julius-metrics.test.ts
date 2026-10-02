import { describe, expect, it } from 'vitest';

import {
  JULIUS_COUNTERS, JULIUS_HISTOGRAMS, projectJuliusMetrics, runtimeVersionsIn,
  summariseJuliusEvals, summariseSamples,
} from './julius-metrics';
import { JULIUS_TRAJECTORY_KINDS, isJuliusProviderAttempt, juliusDispatchRowClass, type JuliusTrajectoryEvent } from './julius-trajectory';
import { juliusLearningMetrics } from './julius-learning-loop';
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

/* ------------------------------------------------- what a DISPATCH row is */

/**
 * NINE WRITERS SHARE THE KIND (the 2026-10-01 census, registered as the Learning
 * Loop's precondition in the readiness ledger). These are their row shapes as
 * written, and what each one is.
 */
describe('what a DISPATCH row is', () => {
  const ROWS = {
    held: trajectory({ kind: 'DISPATCH', outcome: 'GOVERNANCE_HELD', safeFacts: { reasonCode: 'run_paused' }, idempotencyKey: 'w1' }),
    approvalDenied: trajectory({ kind: 'DISPATCH', outcome: 'APPROVAL_DENIED', idempotencyKey: 'w2' }),
    policyDenied: trajectory({ kind: 'DISPATCH', outcome: 'POLICY_DENIED', idempotencyKey: 'w3' }),
    notLocked: trajectory({ kind: 'DISPATCH', outcome: 'CONTRACT_NOT_LOCKED', safeFacts: { reasonCode: 'contract_unlocked' }, idempotencyKey: 'w4' }),
    mismatch: trajectory({ kind: 'DISPATCH', outcome: 'REVIEW_CONTRACT_MISMATCH', idempotencyKey: 'w5' }),
    stale: trajectory({ kind: 'DISPATCH', outcome: 'CONTRACT_STALE', idempotencyKey: 'w6' }),
    failedNamed: trajectory({ kind: 'DISPATCH', outcome: 'TIMEOUT', providerId: 'openai', contextId: 'ctx-1', durationMs: 120_000, idempotencyKey: 'w7a' }),
    failedUnnamed: trajectory({ kind: 'DISPATCH', outcome: 'POLICY_DENIED', contextId: 'ctx-1', idempotencyKey: 'w7b' }),
    completed: trajectory({
      kind: 'DISPATCH', outcome: 'COMPLETED', providerId: 'anthropic', contextId: 'ctx-1',
      durationMs: 60_000, inputTokens: 100, outputTokens: 50, idempotencyKey: 'w8',
    }),
    toolStep: trajectory({
      kind: 'DISPATCH', outcome: 'SUCCEEDED', policyVersion: 'tool-settlement.v1', durationMs: 41,
      usdMicros: 0, inputTokens: 0, outputTokens: 0,
      safeFacts: { toolId: 'shell.exec', invocationId: 'inv-1', evidenceCount: 1, artifactCount: 0 }, idempotencyKey: 'w9',
    }),
  };

  it('classifies each writer\'s row as what it is', () => {
    for (const refusal of [ROWS.held, ROWS.approvalDenied, ROWS.policyDenied, ROWS.notLocked, ROWS.mismatch, ROWS.stale]) {
      expect(juliusDispatchRowClass(refusal), refusal.outcome!).toBe('REFUSAL');
    }
    expect(juliusDispatchRowClass(ROWS.failedNamed)).toBe('PROVIDER');
    expect(juliusDispatchRowClass(ROWS.completed)).toBe('PROVIDER');
    expect(juliusDispatchRowClass(ROWS.toolStep)).toBe('TOOL');
    // A refusal outcome AFTER a context was compiled (the coordinator's own
    // POLICY_DENIED) is not proven pre-provider, so it is never read as free.
    expect(juliusDispatchRowClass(ROWS.failedUnnamed)).toBe('UNATTRIBUTED');
  });

  it('a row that names nothing is UNATTRIBUTED, and counts as an attempt: it may have been paid for', () => {
    const bare = trajectory({ kind: 'DISPATCH', idempotencyKey: 'bare' });
    expect(juliusDispatchRowClass(bare)).toBe('UNATTRIBUTED');
    expect(isJuliusProviderAttempt(bare)).toBe(true);
  });

  it('only a non-empty STRING toolId makes a tool step, and only a measureless refusal is a refusal', () => {
    expect(juliusDispatchRowClass(trajectory({ kind: 'DISPATCH', safeFacts: { toolId: 7 }, idempotencyKey: 'n' }))).toBe('UNATTRIBUTED');
    expect(juliusDispatchRowClass(trajectory({ kind: 'DISPATCH', safeFacts: { toolId: '' }, idempotencyKey: 'e' }))).toBe('UNATTRIBUTED');
    expect(juliusDispatchRowClass(trajectory({ kind: 'DISPATCH', outcome: 'APPROVAL_DENIED', durationMs: 5, idempotencyKey: 'm' }))).toBe('UNATTRIBUTED');
    expect(isJuliusProviderAttempt(trajectory({ kind: 'RETRY', providerId: 'openai', idempotencyKey: 'r' })), 'not a DISPATCH row').toBe(false);
  });
});

/**
 * THE EVAL LAYER MEASURES PROVIDER ATTEMPTS. Each case is one of the census's
 * defects, built so that the formula it replaces would fail it.
 */
describe('the eval layer measures provider attempts, not every DISPATCH row', () => {
  const V = 'julius-runtime.v1';
  const provider = (key: string, durationMs: number, usdMicros: number | null = 1_000) => trajectory({
    kind: 'DISPATCH', outcome: 'COMPLETED', providerId: 'provider-a', contextId: 'ctx-1',
    durationMs, usdMicros, inputTokens: 10, outputTokens: 5, idempotencyKey: key,
  });
  const tool = (key: string, durationMs: number) => trajectory({
    kind: 'DISPATCH', outcome: 'SUCCEEDED', policyVersion: 'tool-settlement.v1', durationMs,
    usdMicros: 0, inputTokens: 0, outputTokens: 0, safeFacts: { toolId: 'shell.exec' }, idempotencyKey: key,
  });
  const refusal = (key: string) => trajectory({ kind: 'DISPATCH', outcome: 'APPROVAL_DENIED', idempotencyKey: key });

  it('(b) a mission that ran MORE tool steps does not read as faster', () => {
    const fewer = [provider('p1', 60_000), tool('t1', 40)];
    const more = [provider('p1', 60_000), tool('t1', 40), tool('t2', 33), tool('t3', 362), tool('t4', 43)];
    expect(summariseJuliusEvals(fewer, V).averageDurationMs).toBe(60_000);
    expect(summariseJuliusEvals(more, V).averageDurationMs, 'tool time is not provider time').toBe(60_000);
    const histograms = projectJuliusMetrics(more, V).histograms;
    expect(histograms.julius_task_duration_ms).toMatchObject({ count: 1, max: 60_000 });
    expect(histograms.julius_tool_step_duration_ms).toMatchObject({ count: 4, min: 33, max: 362 });
  });

  it('(c) a tool step or a refusal is never a reroute: paid run 36915013287\'s shape reads 0', () => {
    const a2 = [
      provider('p1', 50_543, null), provider('p2', 1_000, null), provider('p3', 71_810, null), provider('p4', 41_844, null),
      tool('t1', 41), tool('t2', 43), tool('t3', 33), tool('t4', 362), refusal('r1'),
    ];
    const counters = projectJuliusMetrics(a2, V).counters;
    expect(counters.julius_reroutes).toBe(0);
    expect(counters.julius_tasks_dispatched).toBe(4);
    expect(counters.julius_tool_steps).toBe(4);
    expect(counters.julius_dispatch_refusals).toBe(1);
  });

  it('(a\') a refusal called nobody: its absent cost and usage are never unknown', () => {
    const events = [provider('p1', 1_000), refusal('r1')];
    const summary = summariseJuliusEvals(events, V);
    expect(summary.unknownCostComponents).toBe(0);
    expect(summary.costComplete).toBe(true);
    const learning = juliusLearningMetrics(events, V);
    expect(learning.dispatches).toBe(1);
    expect(learning.unknownUsageComponents, 'the token dimensions stay measurable').toBe(0);
    expect(learning.knownInputTokens).toBe(10);
  });

  it('an attempt that reported no cost is still unknown: the fix narrows the components, never forgives one', () => {
    const summary = summariseJuliusEvals([provider('p1', 1_000, null), tool('t1', 40)], V);
    expect(summary.unknownCostComponents).toBe(1);
    expect(summary.costComplete).toBe(false);
  });

  it('(e) the known sum is over every row that names an amount, as the SQL twin sums it', () => {
    const events = [
      provider('p1', 1_000),
      trajectory({ kind: 'RETRY', outcome: 'TIMEOUT', providerId: 'provider-a', contextId: 'ctx-1', usdMicros: 250_000, idempotencyKey: 'retry' }),
      trajectory({ kind: 'SUBAGENT', outcome: 'AUTHORIZED', usdMicros: 7_000, idempotencyKey: 'sub' }),
    ];
    expect(summariseJuliusEvals(events, V).knownUsdMicros).toBe(1_000 + 250_000 + 7_000);
  });
});
