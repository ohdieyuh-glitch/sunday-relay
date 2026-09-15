import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  JuliusExecutionCoordinator, JuliusProviderHealthRegistry, JuliusProviderRouter, JuliusWorkerRegistry,
  type JuliusCardPolicy, type JuliusExecutionPorts, type JuliusProviderAdapter,
} from '.';

/**
 * THE DEADLINE A WORKER DECLARES IS NOW THE DEADLINE IT GETS.
 *
 * `JuliusWorker.timeoutMs` was read in exactly one place — `register`, which
 * checks it is a positive integer — and consulted nowhere else. Every adapter
 * bounds ITSELF: the OpenAI client's `timeout`, the hosted runner's abort
 * timer, `runHermesReview`'s window. So the declared number was a MIRROR of
 * adapter behaviour, true for exactly as long as each adapter's own timer kept
 * working, with nothing standing behind it.
 *
 * That is the arrangement `reviewer-deadline.ts` was written about — "a reader
 * of the composition root learned a number that bound nothing" — and it was
 * repaired there by making the declared and the operative number come from one
 * derivation. This is the other half: something that ENFORCES the declaration,
 * so a worker whose timer never fires, or whose promise never settles, cannot
 * hold a dispatch open until the lease expires and take the job's wall clock
 * with it.
 *
 * IT MUST NEVER BE REACHED ON A HEALTHY RUN. Every adapter is configured to
 * stop first; reaching this limit means one outlived its own timer, which is a
 * finding rather than a remedy. The proofs below therefore drive adapters that
 * deliberately misbehave, which is the only way to observe the layer at all.
 */

const ROOT = process.cwd();
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8');

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
const resources = { usdMicros: 10, inputTokens: 10, outputTokens: 10, toolCalls: 1, runtimeMs: 100 };
const request = {
  claim, policy, role: 'CODING_AGENT' as const, taskType: 'implementation',
  capability: 'code', operationId: 'operation', resources,
};

interface Released { readonly reason: string; readonly usdMicros: number | null; readonly spendUnknown: boolean }

/** An adapter that settles LATE — after Julius has already timed it out. */
const late = (afterMs: number, settle: 'resolve' | 'reject'): { adapter: JuliusProviderAdapter; done: Promise<void> } => {
  let signalDone = (): void => {};
  const done = new Promise<void>(resolve => { signalDone = () => resolve(); });
  return {
    done,
    adapter: {
      adapterId: 'adapter',
      async dispatch() {
        await new Promise(resolve => setTimeout(resolve, afterMs));
        signalDone();
        if (settle === 'reject') throw new Error('the provider failed, eventually');
        return {
          workerId: 'worker', providerId: 'provider', status: 'SUCCEEDED', safeSummary: 'late',
          evidence: [{ type: 'TEST', status: 'PASSED', safeSummary: 'late evidence' }],
          usage: { usdMicros: 99 },
        };
      },
    },
  };
};

/** One coordinator over one adapter, with the worker's declared deadline as a
    parameter — because the number under test is the WORKER's, not a constant. */
const harness = (adapter: JuliusProviderAdapter, declaredTimeoutMs: number) => {
  const rows: Record<string, unknown>[] = [];
  const released: Released[] = [];
  const registry = new JuliusWorkerRegistry();
  registry.register({
    workerId: 'worker', role: 'CODING_AGENT', adapterId: 'adapter', providerId: 'provider',
    capabilities: ['code'], taskTypes: ['implementation'], concurrencyLimit: 1,
    timeoutMs: declaredTimeoutMs, maxRetries: 2, status: 'AVAILABLE',
  });
  const calls: string[] = [];
  const ports: JuliusExecutionPorts = {
    async reserve() { calls.push('reserve'); return { reservationId: 'reservation', state: 'RESERVED', denialReason: null }; },
    async commit() { calls.push('commit'); },
    async release(input) {
      calls.push('release');
      released.push({
        reason: String((input as { reason?: unknown }).reason),
        usdMicros: (input as { usdMicros?: number | null }).usdMicros ?? null,
        spendUnknown: (input as { spendUnknown?: boolean }).spendUnknown === true,
      });
    },
    async persistEvidence() { calls.push('persistEvidence'); },
    async acceptResult() { calls.push('acceptResult'); return { duplicate: false }; },
    async recordEvent(input) { rows.push({ type: input.type, ...input.payload }); },
  };
  const coordinator = new JuliusExecutionCoordinator(
    new JuliusProviderRouter(registry, new Map([['adapter', adapter]]), new JuliusProviderHealthRegistry()),
    ports,
  );
  return { rows, released, calls, coordinator };
};

/** An adapter that ignores its signal entirely — the case the race exists for.
    It records the signal it was handed so the forwarding can be observed. */
const deaf = (): { adapter: JuliusProviderAdapter; signals: AbortSignal[] } => {
  const signals: AbortSignal[] = [];
  return {
    signals,
    adapter: {
      adapterId: 'adapter',
      async dispatch(input) {
        if (input.signal) signals.push(input.signal);
        // Never settles, and never looks at the signal. A well-behaved adapter
        // would reject here; this one is why looking is not enough.
        return await new Promise(() => {});
      },
    },
  };
};

const facts = (rows: readonly Record<string, unknown>[], type: string): Record<string, unknown> =>
  rows.filter(row => row.type === type).at(-1) ?? {};

/** Whole-millisecond wall clock against a finer timer: the only slack these bounds allow. */
const CLOCK_GRANULARITY_MS = 1;

describe('1–4 · a worker that outlives its declared deadline is cut', () => {
  it('1 · the dispatch ends as a retryable TIMEOUT rather than hanging', async () => {
    const { adapter } = deaf();
    const h = harness(adapter, 40);
    expect(await h.coordinator.execute(request)).toMatchObject({ status: 'RETRY', code: 'TIMEOUT' });
  }, 30_000);

  it('2 · the row names the declared limit and how long the worker actually ran', async () => {
    const { adapter } = deaf();
    const h = harness(adapter, 40);
    await h.coordinator.execute(request);
    const row = facts(h.rows, 'retry.scheduled');
    expect(row.failureClass).toBe('worker_deadline_exceeded');
    // Which limit was reached, not merely that one was.
    expect(row.diag_timeoutMs).toBe(40);
    expect(row.diag_timedOut).toBe(true);
    expect(typeof row.diag_elapsedMs).toBe('number');
    // ONE MILLISECOND OF CLOCK GRANULARITY, NOT A LOOSER BOUND. `Date.now()` is
    // whole milliseconds while the timer runs on a finer monotonic clock, so a
    // 40 ms timer can read as 39 elapsed. Verify Relay on PR #269 failed once
    // exactly so and passed on re-run. Anything earlier is still refused.
    expect(row.diag_elapsedMs as number).toBeGreaterThanOrEqual(40 - CLOCK_GRANULARITY_MS);
  }, 30_000);

  it('3 · the hold is NOT freed as if nothing had been spent', async () => {
    // THE LOAD-BEARING ONE. A dispatch cut mid-flight had already reached a
    // provider, so its cost is unknown rather than zero. Releasing it as a
    // clean nothing would hand the mission that money a second time.
    const { adapter } = deaf();
    const h = harness(adapter, 40);
    await h.coordinator.execute(request);
    expect(h.released).toHaveLength(1);
    expect(h.released[0]!.reason).toBe('TIMEOUT');
    expect(h.released[0]!.usdMicros, 'nothing was reported, so nothing is claimed').toBeNull();
    expect(h.released[0]!.spendUnknown, 'unknown spend, never a free hold').toBe(true);
  }, 30_000);

  it('4 · the adapter is TOLD to stop, as well as abandoned', async () => {
    // Two mechanisms, because one is not enough: the signal lets a well-behaved
    // adapter release what it holds, and the race is what actually returns when
    // it does not.
    const { adapter, signals } = deaf();
    const h = harness(adapter, 40);
    await h.coordinator.execute(request);
    expect(signals, 'the adapter must receive a signal at all').toHaveLength(1);
    expect(signals[0]!.aborted, 'and it must be aborted when the deadline passes').toBe(true);
  }, 30_000);
});

describe('5–7 · and nothing else changes', () => {
  it('5 · a dispatch well inside the deadline is untouched', async () => {
    const quick: JuliusProviderAdapter = {
      adapterId: 'adapter',
      async dispatch() {
        return {
          workerId: 'worker', providerId: 'provider', status: 'SUCCEEDED', safeSummary: 'done',
          evidence: [{ type: 'TEST', status: 'PASSED', safeSummary: 'tests pass' }],
          usage: { usdMicros: 8 },
        };
      },
    };
    const h = harness(quick, 5_000);
    expect(await h.coordinator.execute(request)).toMatchObject({ status: 'COMPLETED', workerId: 'worker' });
    expect(h.released, 'a completed dispatch releases nothing').toHaveLength(0);
  }, 30_000);

  it('6 · an adapter that rejects on its own keeps its own classification', async () => {
    // The race must not convert a real provider failure into a deadline story.
    const refused: JuliusProviderAdapter = {
      adapterId: 'adapter',
      async dispatch() { throw { code: 401 }; },
    };
    const h = harness(refused, 5_000);
    expect(await h.coordinator.execute(request)).toMatchObject({ status: 'FAILED', code: 'AUTH_CONFIGURATION' });
    expect(facts(h.rows, 'task.failed').failureClass).not.toBe('worker_deadline_exceeded');
  }, 30_000);

  it('7 · external cancellation still reaches the adapter', async () => {
    const { adapter, signals } = deaf();
    const h = harness(adapter, 60_000);
    const outer = new AbortController();
    const running = h.coordinator.execute({ ...request, signal: outer.signal });
    // Long deadline, so only the caller's own abort can end this.
    await new Promise(resolve => setTimeout(resolve, 20));
    outer.abort();
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(signals[0]!.aborted, 'the caller’s abort must be forwarded, not swallowed').toBe(true);
    void running.catch(() => {});
  }, 30_000);
});

describe('8–9 · the number comes from the worker', () => {
  it('8 · two workers with different declarations are cut at their own', async () => {
    // The mutation this kills: a literal, or one worker's number applied to
    // another. A second opinion about how long a worker may take is how
    // declared and operative deadlines came to differ by 160 s once already.
    for (const declared of [30, 120]) {
      const { adapter } = deaf();
      const h = harness(adapter, declared);
      const startedAt = Date.now();
      await h.coordinator.execute(request);
      const elapsed = Date.now() - startedAt;
      expect(facts(h.rows, 'retry.scheduled').diag_timeoutMs, `declared ${declared}`).toBe(declared);
      expect(elapsed, `declared ${declared} must actually bound the wait`).toBeGreaterThanOrEqual(declared - CLOCK_GRANULARITY_MS);
    }
  }, 30_000);

  it('9 · the coordinator reads worker.timeoutMs and holds no number of its own', () => {
    const source = read('src/relay/mission/julius/julius-execution-coordinator.ts');
    expect(source).toContain('dispatchWithinDeadline(worker.timeoutMs,request.signal,');
    // A numeric literal handed to the deadline helper would be exactly the
    // second opinion this exists to prevent.
    expect(source).not.toMatch(/dispatchWithinDeadline\(\s*[0-9]/u);
  });
});

/**
 * 10–16 · FALSIFICATION. Every way a late, racing or duplicated settlement
 * could reach mission state after Julius has already ended the dispatch.
 *
 * The founder's requirement is that correctness must NOT depend on the adapter
 * honouring cancellation, so each of these drives an adapter that does not.
 */
describe('10–16 · a late result changes nothing', () => {
  it('10 · an adapter that resolves one tick after the deadline is discarded', async () => {
    const { adapter, done } = late(60, 'resolve');
    const h = harness(adapter, 30);
    expect(await h.coordinator.execute(request)).toMatchObject({ status: 'RETRY', code: 'TIMEOUT' });
    // Let the abandoned promise actually settle, then let any microtask it
    // might have queued run. Nothing may have changed.
    await done;
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(h.calls, 'a late success must reach no port that advances the mission')
      .toEqual(['reserve', 'release']);
    expect(h.rows.some(row => row.type === 'worker.completed'), 'never completed').toBe(false);
  }, 30_000);

  it('11 · a late result creates no evidence and no accepted result', async () => {
    const { adapter, done } = late(60, 'resolve');
    const h = harness(adapter, 30);
    await h.coordinator.execute(request);
    await done;
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(h.calls).not.toContain('persistEvidence');
    expect(h.calls).not.toContain('acceptResult');
    expect(h.calls).not.toContain('commit');
  }, 30_000);

  it('12 · settlement happens exactly once, and it is the release', async () => {
    const { adapter, done } = late(60, 'resolve');
    const h = harness(adapter, 30);
    await h.coordinator.execute(request);
    await done;
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(h.calls.filter(call => call === 'release')).toHaveLength(1);
    expect(h.calls.filter(call => call === 'commit')).toHaveLength(0);
    expect(h.released).toHaveLength(1);
  }, 30_000);

  it('13 · an adapter that REJECTS after the deadline does not double-report', async () => {
    // The adapter's own timer firing just after Julius's is the realistic
    // collision: two timeouts, one dispatch. Only Julius's may be recorded.
    const { adapter, done } = late(60, 'reject');
    const h = harness(adapter, 30);
    expect(await h.coordinator.execute(request)).toMatchObject({ status: 'RETRY', code: 'TIMEOUT' });
    await done.catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 20));
    const failures = h.rows.filter(row => row.type === 'retry.scheduled' || row.type === 'task.failed');
    expect(failures, 'one ending, not two').toHaveLength(1);
    expect(failures[0]!.failureClass).toBe('worker_deadline_exceeded');
    expect(h.calls.filter(call => call === 'release')).toHaveLength(1);
  }, 30_000);

  it('14 · an adapter that throws exactly as the watchdog fires yields one ending', async () => {
    // Same scheduled tick for both. Whichever wins the race, exactly one
    // ending is recorded and exactly one release happens.
    const racing: JuliusProviderAdapter = {
      adapterId: 'adapter',
      async dispatch() {
        await new Promise(resolve => setTimeout(resolve, 30));
        throw { code: 'ETIMEDOUT' };
      },
    };
    const h = harness(racing, 30);
    const outcome = await h.coordinator.execute(request);
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(outcome.status, 'a timeout either way').toBe('RETRY');
    expect(h.rows.filter(row => row.type === 'retry.scheduled' || row.type === 'task.failed')).toHaveLength(1);
    expect(h.calls.filter(call => call === 'release')).toHaveLength(1);
  }, 30_000);

  it('15 · cancelling while the deadline is pending still ends exactly once', async () => {
    const { adapter } = deaf();
    const h = harness(adapter, 40);
    const outer = new AbortController();
    const running = h.coordinator.execute({ ...request, signal: outer.signal });
    setTimeout(() => outer.abort(), 10);
    await running;
    await new Promise(resolve => setTimeout(resolve, 60));
    expect(h.calls.filter(call => call === 'release')).toHaveLength(1);
    expect(h.calls).not.toContain('commit');
  }, 30_000);

  it('16 · a worker declaring an unusable deadline is refused at construction', async () => {
    // The layer beneath: a deadline that is zero, negative or fractional never
    // reaches the dispatch path, because the registry will not hold it.
    const registry = new JuliusWorkerRegistry();
    for (const timeoutMs of [0, -1, 1.5, Number.NaN]) {
      expect(() => registry.register({
        workerId: `w-${timeoutMs}`, role: 'CODING_AGENT', adapterId: 'adapter', providerId: 'provider',
        capabilities: ['code'], taskTypes: ['implementation'], concurrencyLimit: 1,
        timeoutMs, maxRetries: 2, status: 'AVAILABLE',
      }), `timeoutMs=${timeoutMs}`).toThrow('invalid_worker_timeoutMs');
    }
  });
});

describe('17 · a recorded timeout stays a timeout', () => {
  it('17 · replaying the durable rows never reads the cut as work that succeeded', async () => {
    // Restart/replay reads the event rows. A `retry.scheduled` carrying
    // `worker_deadline_exceeded` and no `worker.completed` beside it is the
    // whole record of this dispatch, and nothing in it can be mistaken for a
    // result — which is what "do not silently continue dependent work" needs.
    const { adapter, done } = late(60, 'resolve');
    const h = harness(adapter, 30);
    await h.coordinator.execute(request);
    await done;
    await new Promise(resolve => setTimeout(resolve, 20));
    const replayed = h.rows.map(row => row.type);
    expect(replayed).toContain('worker.dispatched');
    expect(replayed).toContain('retry.scheduled');
    expect(replayed, 'no completion was ever written').not.toContain('worker.completed');
    const ending = h.rows.filter(row => row.type === 'retry.scheduled').at(-1)!;
    expect(ending.failureClass).toBe('worker_deadline_exceeded');
    expect(ending.diag_timedOut).toBe(true);
    // And the spend it may have incurred is still unknown rather than zero.
    expect(h.released[0]!.spendUnknown).toBe(true);
  }, 30_000);
});

/**
 * 18 · THE ORDERING IS THE MECHANISM.
 *
 * Cases 10–13 and 17 show that a late result changes nothing. They cannot show
 * WHY, and the why is a single structural fact: every step that touches mission
 * state is below the awaited deadline, so a promise that settles afterwards has
 * already lost the race and nothing reads it.
 *
 * A runtime guard asserting the same thing would bind nothing — the race throws
 * first, so it could never fire — and it would not survive the one edit that
 * could actually break this, which is moving a line above the await. So the
 * ordering is what is pinned.
 */
describe('18 · nothing that advances the mission runs before the deadline is awaited', () => {
  it('18 · persistEvidence, acceptResult and commit are all below the await', () => {
    const source = read('src/relay/mission/julius/julius-execution-coordinator.ts');
    const body = /async execute\(request:JuliusExecutionRequest\)[\s\S]*?\n  \}\n/u.exec(source)?.[0] ?? '';
    expect(body, 'the execute body must be findable').not.toBe('');
    const awaitedAt = body.indexOf('await dispatchWithinDeadline(');
    expect(awaitedAt, 'the deadline must be awaited at all').toBeGreaterThan(-1);
    for (const step of ['this.ports.persistEvidence(', 'this.ports.acceptResult(', 'this.ports.commit(']) {
      const at = body.indexOf(step);
      expect(at, `${step} must exist`).toBeGreaterThan(-1);
      expect(at, `${step} must not run before the deadline is awaited`).toBeGreaterThan(awaitedAt);
    }
    // And the dispatch really is raced, not merely awaited with a timer beside it.
    expect(source).toContain('return await Promise.race([');
  });
});
