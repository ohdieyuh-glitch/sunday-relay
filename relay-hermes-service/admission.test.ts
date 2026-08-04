import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  ADMISSION_CEILINGS, evaluateAdmission, selectEvictions,
} from '../relay-bridge/reviewer-harness/hermes/admission';
import { createLocalHermesTransport } from '../relay-bridge/reviewer-harness/hermes/local-transport';
import { loadHermesProviderConfig } from '../relay-bridge/reviewer-harness/hermes/hermes-provider';
import { handleServiceRoute, SERVICE_TOKEN_ENV, CAPACITY_RETRY_AFTER_SECONDS } from './service';
import type { RemoteHermesReviewInput } from '../relay-bridge/reviewer-harness/hermes/hermes-transport';

/**
 * F1 — AGGREGATE ADMISSION CONTROL. The adversarial suite for the independent
 * review's first blocking finding.
 *
 * The reproduction that opened the finding: 200 concurrent
 * `POST /v1/reviews` from one authenticated caller were ALL accepted. Per-run
 * ceilings were excellent and aggregate ones did not exist, so each accepted
 * review spawned a Hermes process group holding the provider credential for up
 * to 600 s, and neither the run map nor the idempotency map was ever evicted.
 *
 * These tests are written to FAIL on the pre-repair code. The concurrency case
 * is the same 200-request shape the reviewer used.
 */

const providerConfig = () => {
  const r = loadHermesProviderConfig({
    RELAY_HERMES_PROVIDER: 'anthropic',
    RELAY_HERMES_MODEL: 'claude-sonnet-5',
    ANTHROPIC_API_KEY: 'sk-ant-FAKE-NEVER-USED',
  } as NodeJS.ProcessEnv);
  if (!r.ok) throw new Error('provider config should load');
  return r.config;
};

/**
 * A faithful in-memory child-process double.
 *
 * `EventEmitter` rather than a hand-rolled `{ on: () => undefined }`: the
 * runner's `terminateTree` calls `child.once('close', …)`, and a double
 * missing one method turns a cancellation path into an uncaught `TypeError`
 * that vitest reports as a run error even while every assertion passes. A
 * double that cannot survive the code path it is standing in for is not
 * evidence about that path.
 *
 * `pid` is deliberately absent so `terminateTree` uses `child.kill()` and
 * never reaches `process.kill(-pid)` — no real signal is sent anywhere.
 */
function fakeChild(): EventEmitter & Record<string, unknown> {
  const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = undefined;
  child.killed = false;
  child.kill = (): boolean => { child.killed = true; return true; };
  child.unref = (): void => undefined;
  return child;
}

/**
 * A spawn that never settles, so admitted runs stay ACTIVE for the whole test.
 * It records every invocation, which is how "no process spawn before
 * admission" is proven rather than asserted.
 */
function hangingSpawn() {
  const calls: unknown[] = [];
  const children: Array<EventEmitter & Record<string, unknown>> = [];
  const impl = ((...args: unknown[]) => {
    calls.push(args);
    const child = fakeChild();
    children.push(child);
    return child;
  }) as never;
  return { calls, children, impl };
}

/** A spawn whose child exits cleanly on the next tick. */
function settlingSpawn() {
  const impl = ((...__args: unknown[]) => {
    const child = fakeChild();
    setTimeout(() => child.emit('close', 0, null), 0);
    return child;
  }) as never;
  return impl;
}

const input = (n: number, timeoutMs = 600_000): RemoteHermesReviewInput => ({
  runId: `run-${n}`,
  idempotencyKey: `key-${n}`,
  prompt: 'review the fixture',
  limits: { timeoutMs, maxOutputBytes: 1024, maxTurns: 1, maxPromptBytes: 1024 },
});

const transport = (spawnImpl: never, ceilings = ADMISSION_CEILINGS) =>
  createLocalHermesTransport({
    executable: '/nonexistent/hermes',
    provider: providerConfig(),
    apiKey: 'sk-ant-FAKE-NEVER-USED',
    spawnImpl,
    ceilings,
  });

/* ------------------------------------------------------ the policy ------- */

describe('the aggregate policy bounds only what the service can truthfully enforce', () => {
  it('bounds concurrent runs', () => {
    const at = { activeCount: ADMISSION_CEILINGS.maxActiveReviews, activeTimeoutBudgetMs: 0 };
    const verdict = evaluateAdmission(at, 1000);
    expect(verdict.admitted).toBe(false);
    if (!verdict.admitted) expect(verdict.reason).toBe('active_run_limit');
  });

  it('bounds outstanding worst-case wall clock independently of the count', () => {
    // One slot free, but the wall-clock budget cannot absorb another full run.
    const at = {
      activeCount: 1,
      activeTimeoutBudgetMs: ADMISSION_CEILINGS.maxActiveTimeoutBudgetMs - 1,
    };
    const verdict = evaluateAdmission(at, 1000);
    expect(verdict.admitted).toBe(false);
    if (!verdict.admitted) expect(verdict.reason).toBe('active_wall_clock_limit');
  });

  it('admits when both bounds have room', () => {
    expect(evaluateAdmission({ activeCount: 0, activeTimeoutBudgetMs: 0 }, 1000).admitted).toBe(true);
  });

  it('the refusal message names the ceiling and NOTHING about other callers', () => {
    const verdict = evaluateAdmission(
      { activeCount: ADMISSION_CEILINGS.maxActiveReviews, activeTimeoutBudgetMs: 0 },
      1000,
    );
    expect(verdict.admitted).toBe(false);
    if (verdict.admitted) return;
    // Sanitized: no run id, no idempotency key, no host, no pid, no occupancy.
    expect(verdict.safeMessage).not.toMatch(/run-|key-|pid|127\.0\.0\.1|localhost|\/home\//);
    expect(verdict.safeMessage).toContain('capacity limit, not a fault');
  });
});

/* -------------------------------------------------- concurrency ---------- */

describe('admission is atomic under concurrency', () => {
  it('200 concurrent creations do NOT all get accepted (the review reproduction)', async () => {
    const spawn = hangingSpawn();
    const engine = transport(spawn.impl);

    const results = await Promise.all(
      Array.from({ length: 200 }, (_, i) => engine.startReview(input(i))),
    );

    const accepted = results.filter((r) => r.accepted);
    expect(accepted.length).toBeLessThanOrEqual(ADMISSION_CEILINGS.maxActiveReviews);
    expect(accepted.length).toBeGreaterThan(0);
    // Every refusal is a capacity statement, not an outage and not a refusal
    // of the request itself.
    for (const refused of results.filter((r) => !r.accepted)) {
      expect(refused.failureKind).toBe('capacity_exhausted');
    }
  });

  it('NO process is spawned for a refused request — the credential never reaches a child', async () => {
    const spawn = hangingSpawn();
    const engine = transport(spawn.impl);
    await Promise.all(Array.from({ length: 50 }, (_, i) => engine.startReview(input(i))));
    // One spawn per ADMITTED run, and not one more.
    expect(spawn.calls.length).toBeLessThanOrEqual(ADMISSION_CEILINGS.maxActiveReviews);
  });

  it('the FINAL slot is handed to exactly one of two simultaneous callers', async () => {
    const spawn = hangingSpawn();
    const engine = transport(spawn.impl, { ...ADMISSION_CEILINGS, maxActiveReviews: 1 });
    const [a, b] = await Promise.all([engine.startReview(input(1)), engine.startReview(input(2))]);
    expect([a.accepted, b.accepted].filter(Boolean)).toHaveLength(1);
  });
});

/* ------------------------------------------------------ idempotency ------ */

describe('idempotency survives capacity', () => {
  it('a duplicate key returns the EXISTING run even when the service is full', async () => {
    const spawn = hangingSpawn();
    const engine = transport(spawn.impl, { ...ADMISSION_CEILINGS, maxActiveReviews: 1 });

    const first = await engine.startReview(input(1));
    expect(first.accepted).toBe(true);

    // A different request is refused for capacity …
    const other = await engine.startReview(input(2));
    expect(other.accepted).toBe(false);
    expect(other.failureKind).toBe('capacity_exhausted');

    // … but the SAME request replayed is still answered with its own run,
    // because a duplicate consumes no new capacity. A retry loop that got a
    // 503 for work already accepted would start a second review on the next
    // attempt, which is the failure this ordering prevents.
    const replay = await engine.startReview(input(1));
    expect(replay.accepted).toBe(true);
    expect(replay.duplicate).toBe(true);
    expect(replay.runId).toBe(first.runId);
    expect(spawn.calls.length).toBe(1);
  });

  it('a reused key with a DIFFERENT request is still refused, not conflated', async () => {
    const spawn = hangingSpawn();
    const engine = transport(spawn.impl);
    await engine.startReview(input(1));
    const conflated = await engine.startReview({ ...input(1), prompt: 'a materially different review' });
    expect(conflated.accepted).toBe(false);
    expect(conflated.failureKind).toBe('review_refused');
  });
});

/* -------------------------------------------------------- release -------- */

describe('capacity is released exactly once', () => {
  it('a settled run frees its slot for the next caller', async () => {
    const engine = transport(settlingSpawn(), { ...ADMISSION_CEILINGS, maxActiveReviews: 1 });
    const first = await engine.startReview(input(1));
    expect(first.accepted).toBe(true);
    // Let the settle handler run.
    await new Promise((r) => setTimeout(r, 30));
    const second = await engine.startReview(input(2));
    expect(second.accepted, 'a finished run must free its slot').toBe(true);
  });

  it('cancelAll releases every live slot, and a later settle does NOT release twice', async () => {
    const spawn = hangingSpawn();
    const engine = transport(spawn.impl, { ...ADMISSION_CEILINGS, maxActiveReviews: 2 });
    await engine.startReview(input(1));
    await engine.startReview(input(2));
    expect((await engine.startReview(input(3))).accepted).toBe(false);

    await engine.cancelAll?.();

    // Two slots came back — not four, which is what a double release would
    // produce and what would let the service exceed its own ceiling.
    expect((await engine.startReview(input(4))).accepted).toBe(true);
    expect((await engine.startReview(input(5))).accepted).toBe(true);
    expect((await engine.startReview(input(6))).accepted).toBe(false);
  });
});

/* ------------------------------------------------------- retention ------- */

describe('retention is bounded, and never at the cost of a live run', () => {
  it('evicts the oldest terminal runs beyond the ceiling', () => {
    const order = Array.from({ length: 70 }, (_, i) => `r${i}`);
    const doomed = selectEvictions(order, () => false, { ...ADMISSION_CEILINGS, maxRetainedTerminalRuns: 64 });
    expect(doomed).toEqual(['r0', 'r1', 'r2', 'r3', 'r4', 'r5']);
  });

  it('NEVER selects an active run, however long the list is', () => {
    const order = Array.from({ length: 70 }, (_, i) => `r${i}`);
    // The oldest ten are still running — evicting one would strand its
    // AbortController and leave a Hermes process group nothing can reach.
    const active = new Set(order.slice(0, 10));
    const doomed = selectEvictions(order, (id) => active.has(id), {
      ...ADMISSION_CEILINGS, maxRetainedTerminalRuns: 64,
    });
    for (const id of doomed) expect(active.has(id)).toBe(false);
  });

  it('evicts nothing while under the ceiling', () => {
    expect(selectEvictions(['a', 'b'], () => false)).toEqual([]);
  });

  it('an evicted run reports honestly — never "lost to a restart" when it was evicted', async () => {
    const engine = transport(hangingSpawn().impl);
    const state = await engine.getReview('never-existed');
    expect(state.status).toBe('failed');
    // All three causes are named; none is asserted as the one that happened.
    expect(state.safeMessage).toContain('never created');
    expect(state.safeMessage).toContain('restart');
    expect(state.safeMessage).toContain('evicted');
  });

  /**
   * THE IDEMPOTENCY MAP IS THE OTHER HALF OF THE LEAK.
   *
   * Capping the run map while retaining every idempotency entry forever would
   * move the unbounded growth rather than remove it: one entry per review, for
   * the life of the process, is exactly the shape of the original finding.
   * `selectEvictions` is unit-tested above; this exercises the real transport
   * end to end, because the eviction that matters is the one the transport
   * performs on `byIdempotencyKey`, not the id list the policy returns.
   */
  it('evicts idempotency entries WITH their run, end to end through the transport', async () => {
    const engine = transport(settlingSpawn(), { ...ADMISSION_CEILINGS, maxRetainedTerminalRuns: 2 });

    // Five runs, each allowed to settle so it becomes terminal and evictable.
    for (let n = 0; n < 5; n += 1) {
      expect((await engine.startReview(input(n))).accepted, `run ${n}`).toBe(true);
      await new Promise((r) => setTimeout(r, 20));
    }

    // The oldest runs are gone from the run map.
    expect((await engine.getReview('run-0')).failureKind).toBe('service_unreachable');
    expect((await engine.getReview('run-1')).failureKind).toBe('service_unreachable');
    // The newest survive, so retention is bounded rather than simply broken.
    expect((await engine.getReview('run-4')).failureKind).not.toBe('service_unreachable');

    /*
     * The load-bearing assertion. `key-0` belonged to the evicted `run-0`.
     * If the idempotency map still held it, this MATERIALLY DIFFERENT request
     * would be refused as a conflicting reuse — the stale entry answering for
     * a run that no longer exists. Being accepted as a fresh run is the proof
     * that the key went with its run.
     */
    const reused = await engine.startReview({
      ...input(99), idempotencyKey: 'key-0', prompt: 'a materially different review',
    });
    expect(reused.accepted, 'an evicted run must release its idempotency key').toBe(true);
    expect(reused.duplicate).toBe(false);
  });

  it('a RETAINED run still honours its idempotency key — eviction is the only thing that frees it', async () => {
    const engine = transport(settlingSpawn(), { ...ADMISSION_CEILINGS, maxRetainedTerminalRuns: 8 });
    expect((await engine.startReview(input(1))).accepted).toBe(true);
    await new Promise((r) => setTimeout(r, 20));

    // Same key, same request: the existing run is returned, not a second one.
    const replay = await engine.startReview(input(1));
    expect(replay.accepted).toBe(true);
    expect(replay.duplicate, 'a retained run must still answer its own key').toBe(true);
    expect(replay.runId).toBe('run-1');

    // Same key, different request: still refused while the run is retained.
    const conflicting = await engine.startReview({
      ...input(1), prompt: 'a materially different review',
    });
    expect(conflicting.accepted).toBe(false);
    expect(conflicting.failureKind).toBe('review_refused');
  });
});

/* ---------------------------------------------------- the HTTP shape ----- */

describe('the service answers capacity as a temporary condition', () => {
  const env = { [SERVICE_TOKEN_ENV]: 'secret' } as unknown as NodeJS.ProcessEnv;

  const capacityEngine = {
    mode: 'local' as const,
    readiness: vi.fn(),
    testConnection: vi.fn(),
    getReview: vi.fn(),
    cancelReview: vi.fn(),
    startReview: async () => ({
      accepted: false, runId: 'r', duplicate: false,
      failureKind: 'capacity_exhausted' as const,
      safeMessage: 'The Hermes Reviewer service is already running its maximum of 4 concurrent reviews.',
    }),
  };

  it('503 with Retry-After, not 409 — the request was fine, the timing was not', async () => {
    const result = await handleServiceRoute({
      method: 'POST', path: '/v1/reviews', authorization: 'Bearer secret', env,
      body: {
        runId: 'r', idempotencyKey: 'k', prompt: 'p',
        limits: { timeoutMs: 1000, maxOutputBytes: 1024, maxTurns: 1, maxPromptBytes: 1024 },
      },
    }, capacityEngine as never);

    expect(result.status).toBe(503);
    expect(result.body.kind).toBe('capacity_exhausted');
    expect(result.body.retryAfterSeconds).toBe(CAPACITY_RETRY_AFTER_SECONDS);
  });

  it('readiness publishes the ceilings but never the current occupancy', async () => {
    const result = await handleServiceRoute({
      method: 'GET', path: '/v1/readiness', authorization: 'Bearer secret', env, body: undefined,
    }, { ...capacityEngine, readiness: async () => ({}) } as never);

    const capacity = result.body.capacity as Record<string, unknown>;
    expect(capacity.maxActiveReviews).toBe(ADMISSION_CEILINGS.maxActiveReviews);
    // Occupancy would tell one caller what other callers are doing.
    expect(Object.keys(capacity)).not.toContain('activeCount');
    expect(Object.keys(capacity)).not.toContain('activeTimeoutBudgetMs');
  });
});
