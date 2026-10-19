import { describe, expect, it } from 'vitest';
import {
  JuliusExecutionCoordinator, JuliusProviderHealthRegistry, JuliusProviderRouter, JuliusWorkerRegistry,
  type JuliusCardPolicy, type JuliusExecutionPorts, type JuliusProviderAdapter,
} from '.';

/**
 * AN ABORT FROM OUTSIDE ENDS THE DISPATCH — IT DOES NOT MERELY ASK.
 *
 * The coordinator forwarded an outside abort to the adapter and then kept
 * waiting: an adapter that ignored the signal held the dispatch open until the
 * worker's own deadline, and a result that arrived after the abort was
 * persisted, accepted and settled as though nobody had stopped it. A lost lease
 * is exactly such an abort, so a stale worker's late answer became evidence.
 */

const policy: JuliusCardPolicy = {
  revision: 'card', autonomy: 'AUTONOMOUS', allowedProviders: ['provider'], capabilities: ['code'],
  network: false, filesystemMutation: true, fallback: false, automaticRetry: true,
  subagents: { allowed: false, maxDepth: 0, maxActive: 0, maxTotal: 0 },
  iterativeReview: { allowed: false, maxRounds: 0 }, concurrency: 1, approvals: [],
};
const claim = {
  runId: 'run', projectId: 'project', taskId: 'task', leaseOwner: 'scheduler', leaseGeneration: 1,
  capability: 'code', contextId: 'context',
  task: {
    taskId: 'task', missionId: 'mission', parentTaskId: null, dependencyIds: [],
    requiredEvidenceTypes: ['TEST' as const], taskType: 'implementation',
    role: 'CODING_AGENT' as const, ordinal: 0, state: 'ACTIVE' as const,
  },
};
const request = {
  claim, policy, role: 'CODING_AGENT' as const, taskType: 'implementation', capability: 'code', operationId: 'operation',
  resources: { usdMicros: 10, inputTokens: 10, outputTokens: 10, toolCalls: 1, runtimeMs: 100 },
};
const RESULT = {
  workerId: 'worker', providerId: 'provider', status: 'SUCCEEDED' as const, safeSummary: 'done',
  evidence: [{ type: 'TEST', status: 'PASSED', safeSummary: 'evidence' }], usage: { usdMicros: 77 },
};

const harness = (adapter: JuliusProviderAdapter, declaredTimeoutMs = 60_000) => {
  const events: { type: string; payload: Record<string, unknown> }[] = [];
  const released: { reason: string; usdMicros: number | null; spendUnknown: boolean }[] = [];
  const calls: string[] = [];
  const registry = new JuliusWorkerRegistry();
  registry.register({
    workerId: 'worker', role: 'CODING_AGENT', adapterId: 'adapter', providerId: 'provider',
    capabilities: ['code'], taskTypes: ['implementation'], concurrencyLimit: 1,
    timeoutMs: declaredTimeoutMs, maxRetries: 2, status: 'AVAILABLE',
  });
  const ports: JuliusExecutionPorts = {
    async reserve() { calls.push('reserve'); return { reservationId: 'reservation', state: 'RESERVED', denialReason: null }; },
    async commit() { calls.push('commit'); },
    async release(input) {
      calls.push('release');
      released.push({ reason: input.reason, usdMicros: input.usdMicros ?? null, spendUnknown: input.spendUnknown === true });
    },
    async persistEvidence() { calls.push('persistEvidence'); },
    async acceptResult() { calls.push('acceptResult'); return { duplicate: false }; },
    async recordEvent(input) { events.push({ type: input.type, payload: input.payload }); },
  };
  const coordinator = new JuliusExecutionCoordinator(
    new JuliusProviderRouter(registry, new Map([['adapter', adapter]]), new JuliusProviderHealthRegistry()),
    ports,
  );
  return { events, released, calls, coordinator };
};

/** An adapter that ignores its signal and answers later — the case the race exists for. */
const deafThenAnswers = (afterMs: number): { adapter: JuliusProviderAdapter; answered: Promise<void> } => {
  let done = (): void => undefined;
  const answered = new Promise<void>((resolve) => { done = resolve; });
  return {
    answered,
    adapter: {
      adapterId: 'adapter',
      async dispatch() {
        await new Promise((resolve) => setTimeout(resolve, afterMs));
        done();
        return RESULT;
      },
    },
  };
};

const settle = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('an outside abort ends the dispatch', () => {
  it('ends at once as a CANCELLED failure, not at the worker deadline', async () => {
    const { adapter } = deafThenAnswers(5_000);
    const h = harness(adapter, 60_000);
    const outer = new AbortController();
    const started = Date.now();
    const running = h.coordinator.execute({ ...request, signal: outer.signal });
    await settle(10);
    outer.abort();
    const outcome = await running;
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(outcome).toMatchObject({ status: 'FAILED', code: 'CANCELLED', failureClass: 'dispatch_cancelled' });
    expect(h.events.filter((event) => event.type === 'task.failed')).toHaveLength(1);
  }, 30_000);

  it('keeps the hold of a dispatch that may have run, and settles nothing else', async () => {
    const { adapter } = deafThenAnswers(5_000);
    const h = harness(adapter);
    const outer = new AbortController();
    const running = h.coordinator.execute({ ...request, signal: outer.signal });
    await settle(10);
    outer.abort();
    await running;
    expect(h.released).toEqual([{ reason: 'CANCELLED', usdMicros: null, spendUnknown: true }]);
    expect(h.calls).not.toContain('persistEvidence');
    expect(h.calls).not.toContain('acceptResult');
    expect(h.calls).not.toContain('commit');
  }, 30_000);

  it('names why the signal was aborted when its owner said so in a token, and nothing else', async () => {
    for (const [reason, failureClass] of [
      ['lease_lost', 'lease_lost'],
      ['Lease lost: sk-ant-SECRET', 'dispatch_cancelled'],
      [new Error('lease_lost'), 'dispatch_cancelled'],
    ] as const) {
      const { adapter } = deafThenAnswers(5_000);
      const h = harness(adapter);
      const outer = new AbortController();
      const running = h.coordinator.execute({ ...request, signal: outer.signal });
      await settle(5);
      outer.abort(reason);
      expect(await running).toMatchObject({ code: 'CANCELLED', failureClass });
    }
  }, 30_000);

  it('a result the adapter delivers after the abort creates no evidence, no acceptance and no settlement', async () => {
    const { adapter, answered } = deafThenAnswers(40);
    const h = harness(adapter);
    const outer = new AbortController();
    const running = h.coordinator.execute({ ...request, signal: outer.signal });
    await settle(5);
    outer.abort('lease_lost');
    await running;
    await answered;
    await settle(20);
    expect(h.calls.filter((call) => call === 'release')).toHaveLength(1);
    expect(h.calls).not.toContain('persistEvidence');
    expect(h.calls).not.toContain('acceptResult');
    expect(h.calls).not.toContain('commit');
    expect(h.events.map((event) => event.type)).not.toContain('worker.completed');
  }, 30_000);

  it('aborting twice is one cancellation: one release, one terminal row', async () => {
    const { adapter } = deafThenAnswers(5_000);
    const h = harness(adapter);
    const outer = new AbortController();
    const running = h.coordinator.execute({ ...request, signal: outer.signal });
    await settle(5);
    outer.abort('lease_lost');
    outer.abort('something_else');
    await running;
    outer.abort();
    await settle(10);
    expect(h.calls.filter((call) => call === 'release')).toHaveLength(1);
    expect(h.events.filter((event) => event.type === 'task.failed')).toHaveLength(1);
    expect(h.events.find((event) => event.type === 'task.failed')!.payload).toMatchObject({ code: 'CANCELLED', failureClass: 'lease_lost' });
  }, 30_000);

  it('an abort that lands in the same turn as the answer still wins, and what the answer cost is charged', async () => {
    // Every microtask distance between the answer and the abort: whichever side
    // of the race the abort lands on, nothing from the dispatch becomes state.
    let chargedAfterAnswer = 0;
    for (let hops = 0; hops <= 12; hops += 1) {
      const outer = new AbortController();
      const adapter: JuliusProviderAdapter = {
        adapterId: 'adapter',
        dispatch() {
          let chain = Promise.resolve();
          for (let index = 0; index < hops; index += 1) chain = chain.then(() => undefined);
          void chain.then(() => outer.abort());
          return Promise.resolve(RESULT);
        },
      };
      const h = harness(adapter);
      const outcome = await h.coordinator.execute({ ...request, signal: outer.signal });
      if (outcome.status === 'COMPLETED') {
        // The abort had not landed when Julius accepted the answer.
        expect(h.calls, `hops ${hops}`).toContain('acceptResult');
      } else {
        expect(outcome, `hops ${hops}`).toMatchObject({ status: 'FAILED', code: 'CANCELLED' });
        expect(h.calls, `hops ${hops}`).not.toContain('persistEvidence');
        expect(h.calls, `hops ${hops}`).not.toContain('acceptResult');
        if (h.released[0]!.usdMicros === 77) chargedAfterAnswer += 1;
      }
    }
    // Some distance lands after the answer was in hand and before anything was kept.
    expect(chargedAfterAnswer).toBeGreaterThan(0);
  }, 30_000);

  it('a dispatch aborted before it is handed over spends nothing and holds nothing', async () => {
    const { adapter } = deafThenAnswers(5_000);
    const h = harness(adapter);
    const outer = new AbortController();
    outer.abort('lease_lost');
    const outcome = await h.coordinator.execute({ ...request, signal: outer.signal });
    expect(outcome).toMatchObject({ status: 'FAILED', code: 'CANCELLED', failureClass: 'lease_lost' });
    expect(h.released).toEqual([{ reason: 'CANCELLED', usdMicros: null, spendUnknown: false }]);
  }, 30_000);
});
