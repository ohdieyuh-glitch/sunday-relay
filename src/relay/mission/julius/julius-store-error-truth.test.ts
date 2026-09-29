import { describe, expect, it } from 'vitest';

import {
  JuliusExecutionCoordinator, JuliusPersistenceUnavailable, JuliusProviderHealthRegistry, JuliusProviderRouter, JuliusWorkerRegistry,
  type JuliusCardPolicy, type JuliusExecutionPorts, type JuliusProviderAdapter,
} from '.';

/**
 * JULIUS'S OWN BOOKKEEPING FAILURES ARE JULIUS'S, NEVER THE WORKER'S.
 *
 * The coordinator used to turn every throw that was not a dispatch error into a
 * non-retryable `WORKER_EXECUTION_FAILURE`, including its own writes, so a
 * database race was recorded as the worker failing. Worse, a failure AFTER the
 * store had accepted the result was caught as a failed attempt: its
 * `task.failed` contradicted the store, and its `release` wrote a second
 * `budget.settled` after the commit's.
 *
 * Each phase is pinned here, keyed to the two thresholds that cannot be undone:
 * the work HANDED to a provider (money may be spent), and the result ACCEPTED
 * by the store (the store owns the task).
 */

const policy: JuliusCardPolicy = {
  revision: 'card', autonomy: 'AUTONOMOUS', allowedProviders: ['provider'], capabilities: ['code'], network: false,
  filesystemMutation: true, fallback: false, automaticRetry: true,
  subagents: { allowed: false, maxDepth: 0, maxActive: 0, maxTotal: 0 }, iterativeReview: { allowed: false, maxRounds: 0 },
  concurrency: 1, approvals: [],
};
const claim = {
  runId: 'run', projectId: 'project', taskId: 'task', leaseOwner: 'scheduler', leaseGeneration: 1, capability: 'code', contextId: 'context',
  task: { taskId: 'task', missionId: 'mission', parentTaskId: null, dependencyIds: [], requiredEvidenceTypes: ['TEST' as const], taskType: 'implementation', role: 'CODING_AGENT' as const, ordinal: 0, state: 'ACTIVE' as const },
};
const request = {
  claim, policy, role: 'CODING_AGENT' as const, taskType: 'implementation', capability: 'code',
  resources: { usdMicros: 10, inputTokens: 10, outputTokens: 10, toolCalls: 1, runtimeMs: 100 }, operationId: 'operation',
};

/** A store error exactly as the pg driver raises it: a SQLSTATE and a severity. */
const pg = (code: string) => Object.assign(new Error(`driver ${code}`), { code, severity: 'ERROR' });
const lost = () => pg('08006');

/**
 * A step that fails with the scripted errors in order, then succeeds. The
 * scripted list is consumed per CALL, so a step retried three times with three
 * failures fails for good.
 */
const failing = (failures: readonly unknown[], then: () => unknown = () => undefined) => {
  let call = 0;
  return async () => { const failure = failures[call]; call += 1; if (failure !== undefined) throw failure; return then(); };
};

const answering = (usdMicros: number | null = 4_250_000): JuliusProviderAdapter => ({
  adapterId: 'adapter',
  async dispatch() {
    return { workerId: 'worker', providerId: 'provider', status: 'SUCCEEDED', safeSummary: 'done', evidence: [{ type: 'TEST', status: 'PASSED', safeSummary: 'tests pass' }], usage: usdMicros === null ? {} : { usdMicros } };
  },
});

function harness(options: { adapter?: JuliusProviderAdapter; ports?: Partial<JuliusExecutionPorts>; failEvents?: Partial<Record<string, readonly unknown[]>> } = {}) {
  const adapter = options.adapter ?? answering();
  const log = { dispatches: 0, events: [] as string[], releases: [] as Array<{ usdMicros?: number | null; spendUnknown?: boolean }>, commits: 0, pauses: [] as number[] };
  const eventCalls = new Map<string, number>();
  const counted: JuliusProviderAdapter = { adapterId: adapter.adapterId, async dispatch(input) { log.dispatches += 1; return adapter.dispatch(input); } };
  const registry = new JuliusWorkerRegistry();
  registry.register({ workerId: 'worker', role: 'CODING_AGENT', adapterId: 'adapter', providerId: 'provider', capabilities: ['code'], taskTypes: ['implementation'], concurrencyLimit: 1, timeoutMs: 1_000, maxRetries: 2, status: 'AVAILABLE' });
  const ports: JuliusExecutionPorts = {
    async reserve() { return { reservationId: 'reservation', state: 'RESERVED', denialReason: null }; },
    async commit() { log.commits += 1; },
    async release(input) { log.releases.push({ usdMicros: input.usdMicros, spendUnknown: input.spendUnknown }); },
    async persistEvidence() { /* recorded */ },
    async acceptResult() { return { duplicate: false }; },
    async recordEvent(input) {
      const calls = (eventCalls.get(input.type) ?? 0) + 1;
      eventCalls.set(input.type, calls);
      const failure = options.failEvents?.[input.type]?.[calls - 1];
      if (failure !== undefined) throw failure;
      log.events.push(input.type);
    },
    ...options.ports,
  };
  const router = new JuliusProviderRouter(registry, new Map([['adapter', counted]]), new JuliusProviderHealthRegistry());
  return { log, coordinator: new JuliusExecutionCoordinator(router, ports, async (ms) => { log.pauses.push(ms); }) };
}

describe('P0: before the work is handed, nothing is spent and the failure is Julius\'s', () => {
  it.each([
    ['worker.selected', false],
    ['budget.reserved', true],
    ['worker.dispatched', true],
  ] as const)('a store that keeps failing the %s event: RETRY as PERSISTENCE_FAILURE, never dispatched', async (type, reserved) => {
    const h = harness({ failEvents: { [type]: [lost(), lost(), lost()] } });
    const outcome = await h.coordinator.execute(request);
    expect(outcome).toMatchObject({ status: 'RETRY', code: 'PERSISTENCE_FAILURE', failureClass: 'persist_before_dispatch' });
    expect(h.log.dispatches, 'nothing was handed').toBe(0);
    expect(h.log.pauses, 'three attempts, two pauses').toEqual([250, 1000]);
    // A hold that was taken is released as spending nothing; none was taken before the reservation.
    expect(h.log.releases).toEqual(reserved ? [{ usdMicros: null, spendUnknown: false }] : []);
    expect(h.log.events).toContain('retry.scheduled');
    expect(h.log.events).not.toContain('task.failed');
  });

  it('a reservation the store cannot take: RETRY, never dispatched, nothing to release', async () => {
    const h = harness({ ports: { reserve: failing([pg('57P01'), pg('57P01'), pg('57P01')]) as never } });
    expect(await h.coordinator.execute(request)).toMatchObject({ status: 'RETRY', code: 'PERSISTENCE_FAILURE', failureClass: 'persist_before_dispatch' });
    expect(h.log.dispatches).toBe(0);
    expect(h.log.releases).toEqual([]);
  });

  it('a transient failure that clears is retried as bookkeeping, and the dispatch happens once', async () => {
    const h = harness({ failEvents: { 'worker.dispatched': [lost()] } });
    expect(await h.coordinator.execute(request)).toMatchObject({ status: 'COMPLETED' });
    expect(h.log.dispatches).toBe(1);
    expect(h.log.pauses).toEqual([250]);
  });

  it('an INTEGRITY error before the dispatch fails once and is not retried: repeating it cannot cure it', async () => {
    const h = harness({ failEvents: { 'worker.selected': [pg('23505')] } });
    const outcome = await h.coordinator.execute(request);
    expect(outcome).toMatchObject({ status: 'FAILED', code: 'PERSISTENCE_FAILURE', failureClass: 'persist_before_dispatch', diagnostics: { diag_storeErrorClass: 'integrity', diag_runtimeStarted: false } });
    expect(h.log.pauses).toEqual([]);
    expect(h.log.dispatches).toBe(0);
  });

  /**
   * THE SAME RULE ONE WRITE LATER. `worker.dispatched` is written inside the
   * dispatch phase but BEFORE the work is handed, so its failure is judged by a
   * second branch (`!handed ? persistenceFailure('persist_before_dispatch', …)`),
   * not by the reservation phase's. The case above never reaches it; without
   * this one, that branch could call every store error transient and retry an
   * integrity violation at the task level unobserved.
   */
  it('an INTEGRITY error writing worker.dispatched (still before the handoff) fails once, is not retried, and frees the hold', async () => {
    const h = harness({ failEvents: { 'worker.dispatched': [pg('23505')] } });
    const outcome = await h.coordinator.execute(request);
    expect(outcome).toMatchObject({ status: 'FAILED', code: 'PERSISTENCE_FAILURE', failureClass: 'persist_before_dispatch', diagnostics: { diag_storeErrorClass: 'integrity', diag_runtimeStarted: false } });
    expect(h.log.pauses, 'an integrity error is not retried as bookkeeping either').toEqual([]);
    expect(h.log.dispatches, 'nothing was handed').toBe(0);
    expect(h.log.releases, 'the hold is released as spending nothing').toEqual([{ usdMicros: null, spendUnknown: false }]);
  });
});

describe('P1: out of the dispatch, only the worker\'s boundary is the worker\'s', () => {
  it('a PostgreSQL error raised inside the adapter (a write it made for Julius) is Julius\'s, not retried, and keeps the hold', async () => {
    const h = harness({ adapter: { adapterId: 'adapter', async dispatch() { throw pg('40001'); } } });
    const outcome = await h.coordinator.execute(request);
    expect(outcome).toMatchObject({ status: 'FAILED', code: 'PERSISTENCE_FAILURE', failureClass: 'persist_during_dispatch', diagnostics: { diag_storeErrorClass: 'serialization', diag_runtimeStarted: true } });
    expect(h.log.releases, 'it may have been paid for: the hold stays').toEqual([{ usdMicros: null, spendUnknown: true }]);
  });

  it('an adapter\'s own failure is still the worker\'s, and a bare code is not taken for PostgreSQL', async () => {
    for (const thrown of [new Error('adapter broke'), { code: '40001' }]) {
      const h = harness({ adapter: { adapterId: 'adapter', async dispatch() { throw thrown; } } });
      expect(await h.coordinator.execute(request)).toMatchObject({ status: 'FAILED', code: 'WORKER_EXECUTION_FAILURE' });
    }
  });
});

describe('P2: a paid answer is recorded by retrying the bookkeeping, never the dispatch', () => {
  it('evidence that fails to persist twice and then lands: COMPLETED, dispatched once', async () => {
    let persists = 0;
    const h = harness({ ports: { async persistEvidence() { persists += 1; if (persists < 3) throw lost(); } } });
    expect(await h.coordinator.execute(request)).toMatchObject({ status: 'COMPLETED', duplicate: false });
    expect(h.log.dispatches).toBe(1);
    expect(persists).toBe(3);
    expect(h.log.commits).toBe(1);
  });

  it('a result the store will not take after three attempts: FAILED as PERSISTENCE_FAILURE, NOT retried, and charged what the answer cost', async () => {
    const h = harness({ ports: { acceptResult: failing([lost(), lost(), lost()]) as never } });
    const outcome = await h.coordinator.execute(request);
    expect(outcome).toMatchObject({ status: 'FAILED', code: 'PERSISTENCE_FAILURE', failureClass: 'persist_after_answer', diagnostics: { diag_storeErrorClass: 'connection' } });
    expect(h.log.dispatches, 'a task retry would have paid for the same answer twice').toBe(1);
    expect(h.log.releases).toEqual([{ usdMicros: 4_250_000, spendUnknown: false }]);
    expect(h.log.events).toContain('task.failed');
    expect(h.log.events).not.toContain('retry.scheduled');
  });

  it('an integrity error writing evidence is not retried at all', async () => {
    let persists = 0;
    const h = harness({ ports: { async persistEvidence() { persists += 1; throw pg('23505'); } } });
    expect(await h.coordinator.execute(request)).toMatchObject({ status: 'FAILED', code: 'PERSISTENCE_FAILURE', diagnostics: { diag_storeErrorClass: 'integrity' } });
    expect(persists).toBe(1);
  });

  it.each([
    ['stale_worker_result', 'lease_superseded'],
    ['result_after_cancellation', 'result_after_cancellation'],
  ])('the store refusing a result with %s is a CANCELLED attempt (%s), never a worker failure, and still charged', async (message, failureClass) => {
    const h = harness({ ports: { async acceptResult() { throw new Error(message); } } });
    expect(await h.coordinator.execute(request)).toMatchObject({ status: 'FAILED', code: 'CANCELLED', failureClass });
    expect(h.log.releases).toEqual([{ usdMicros: 4_250_000, spendUnknown: false }]);
  });

  it('an accept retried after a lost acknowledgement finds its OWN write: the result is this dispatch\'s, not a replay', async () => {
    const h = harness({ ports: { acceptResult: failing([lost()], () => ({ duplicate: true })) as never } });
    expect(await h.coordinator.execute(request)).toMatchObject({ status: 'COMPLETED', duplicate: false });
  });

  it('a genuine replay, answered duplicate on the first attempt, is still a duplicate', async () => {
    const h = harness({ ports: { async acceptResult() { return { duplicate: true }; } } });
    expect(await h.coordinator.execute(request)).toMatchObject({ status: 'COMPLETED', duplicate: true });
  });
});

describe('P3: once the store has the result, the dispatch COMPLETED', () => {
  it('a settlement that cannot be written: COMPLETED, reported UNRECORDED, and the hold is NEVER released', async () => {
    const h = harness({ ports: { commit: failing([lost(), lost(), lost()]) as never } });
    const outcome = await h.coordinator.execute(request);
    expect(outcome).toMatchObject({ status: 'COMPLETED', unrecorded: [{ step: 'settlement', storeErrorClass: 'connection' }] });
    expect(h.log.releases, 'a release after a commit wrote a second budget.settled').toEqual([]);
    expect(h.log.events).not.toContain('task.failed');
    expect(h.log.events, 'the completion is still recorded').toContain('worker.completed');
  });

  it('a settlement that throws a non-store error: one attempt, COMPLETED, still never released', async () => {
    let commits = 0;
    const h = harness({ ports: { async commit() { commits += 1; throw new Error('settlement bug'); } } });
    expect(await h.coordinator.execute(request)).toMatchObject({ status: 'COMPLETED', unrecorded: [{ step: 'settlement', storeErrorClass: null }] });
    expect(commits).toBe(1);
    expect(h.log.releases).toEqual([]);
  });

  it('a completion event that cannot be written: COMPLETED, reported UNRECORDED', async () => {
    const h = harness({ failEvents: { 'worker.completed': [lost(), lost(), lost()] } });
    expect(await h.coordinator.execute(request)).toMatchObject({ status: 'COMPLETED', unrecorded: [{ step: 'completed_event', storeErrorClass: 'connection' }] });
    expect(h.log.releases).toEqual([]);
    expect(h.log.commits).toBe(1);
  });

  it('a settlement that fails once and then lands: COMPLETED with nothing unrecorded', async () => {
    const h = harness({ ports: { commit: failing([lost()]) as never } });
    const outcome = await h.coordinator.execute(request);
    expect(outcome).toMatchObject({ status: 'COMPLETED' });
    expect(outcome).not.toHaveProperty('unrecorded');
  });
});

describe('when the ending itself cannot be written, the failure leaves typed', () => {
  it('after a paid answer: JuliusPersistenceUnavailable, handed, with the class', async () => {
    const h = harness({
      ports: { acceptResult: failing([lost(), lost(), lost()]) as never, release: failing([lost(), lost(), lost()]) as never },
    });
    const thrown = await h.coordinator.execute(request).then(() => null, (error: unknown) => error);
    expect(thrown).toBeInstanceOf(JuliusPersistenceUnavailable);
    expect(thrown).toMatchObject({ phase: 'persist_after_answer', handed: true, storeErrorClass: 'connection' });
  });

  it('before anything was handed: JuliusPersistenceUnavailable, not handed', async () => {
    const h = harness({ failEvents: { 'worker.selected': [lost(), lost(), lost()], 'retry.scheduled': [lost(), lost(), lost()] } });
    const thrown = await h.coordinator.execute(request).then(() => null, (error: unknown) => error);
    expect(thrown).toMatchObject({ name: 'JuliusPersistenceUnavailable', phase: 'persist_before_dispatch', handed: false });
    expect(h.log.dispatches).toBe(0);
  });
});
