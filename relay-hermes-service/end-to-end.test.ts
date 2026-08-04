import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHermesService, setLifecycleState, SERVICE_TOKEN_ENV } from './service';
import { createLocalHermesTransport } from '../relay-bridge/reviewer-harness/hermes/local-transport';
import { createRemoteHermesTransport } from '../relay-bridge/reviewer-harness/hermes/remote-transport';
import { writeFakeHermes } from '../relay-bridge/reviewer-harness/hermes/fake-executable';
import { loadHermesProviderConfig } from '../relay-bridge/reviewer-harness/hermes/hermes-provider';

/**
 * THE MILESTONE PROOF, entirely offline:
 *
 *   Relay bridge -> remote transport -> Hermes Reviewer service
 *     -> fake Hermes executable -> safe structured result
 *
 * A real HTTP server on an ephemeral loopback port, the real remote transport
 * as its client, the real service routing, the real local transport as the
 * service's engine, and the repository's existing fake Hermes executable at
 * the bottom. Nothing here contacts a provider, and nothing leaves the machine.
 */

const TOKEN = 'private-service-token';
let dir: string;
let baseUrl: string;
let server: ReturnType<typeof createHermesService>;
let previousToken: string | undefined;

const providerConfig = () => {
  const r = loadHermesProviderConfig({
    RELAY_HERMES_PROVIDER: 'anthropic',
    RELAY_HERMES_MODEL: 'claude-sonnet-5',
    ANTHROPIC_API_KEY: 'sk-ant-FAKE-NEVER-USED',
  } as NodeJS.ProcessEnv);
  if (!r.ok) throw new Error('provider config should load');
  return r.config;
};

/** The bridge's client, pointed at the service over real HTTP. */
const bridgeClient = (token = TOKEN) => createRemoteHermesTransport({
  serviceUrl: baseUrl,
  serviceToken: token,
  timeoutMs: 15_000,
});

/** `listen` is asynchronous; `address()` is null until it has bound. */
function listenOn(srv: ReturnType<typeof createHermesService>): Promise<string> {
  return new Promise((resolve) => {
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address() as AddressInfo;
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

async function startService(scenario: Parameters<typeof writeFakeHermes>[1]): Promise<void> {
  const executable = writeFakeHermes(join(dir, `hermes-${scenario}`), scenario);
  const engine = createLocalHermesTransport({
    executable,
    provider: providerConfig(),
    // A fake key that is never sent anywhere — the fake executable ignores it.
    apiKey: 'sk-ant-FAKE-NEVER-USED',
  });
  server = createHermesService(engine);
  baseUrl = await listenOn(server);
  setLifecycleState('ready');
}

beforeAll(async () => {
  previousToken = process.env[SERVICE_TOKEN_ENV];
  process.env[SERVICE_TOKEN_ENV] = TOKEN;
  dir = mkdtempSync(join(tmpdir(), 'relay-hermes-e2e-'));
  await startService('clean');
});

afterAll(() => {
  server?.close();
  if (previousToken === undefined) delete process.env[SERVICE_TOKEN_ENV];
  else process.env[SERVICE_TOKEN_ENV] = previousToken;
  rmSync(dir, { recursive: true, force: true });
});

// 30s of polling inside a 60s case budget. The helper used to give up after
// 6s while its callers allowed 60, so a loaded machine failed on the helper's
// clock rather than on behaviour. No assertion changes — only the patience.
const waitForSettled = async (runId: string, client = bridgeClient()) => {
  for (let i = 0; i < 300; i += 1) {
    const state = await client.getReview(runId);
    if (state.status !== 'running') return state;
    await new Promise((r) => { setTimeout(r, 100); });
  }
  throw new Error('review never settled');
};

describe('bridge -> service -> fake Hermes, over real HTTP', () => {
  it('answers health without a credential and without touching a provider', async () => {
    const res = await fetch(`${baseUrl}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  }, 30_000);

  it('refuses every /v1 route without the service token', async () => {
    for (const [method, path] of [
      ['GET', '/v1/readiness'], ['POST', '/v1/test-connection'],
      ['POST', '/v1/reviews'], ['GET', '/v1/reviews/x'], ['POST', '/v1/reviews/x/cancel'],
    ] as const) {
      const res = await fetch(`${baseUrl}${path}`, { method });
      expect(res.status, `${method} ${path}`).toBe(401);
    }
  }, 30_000);

  it('refuses an incorrect token and accepts the correct one', async () => {
    const wrong = await bridgeClient('not-the-token').readiness();
    expect(wrong.installed).toBe(false);
    expect(wrong.failureReason).toContain('rejected the Relay Bridge credential');

    const right = await bridgeClient().readiness();
    expect(right.bridgeAvailable).toBe(true);
    // Two readiness round-trips, each spawning a probe process against the
    // fake executable; the 5s default is not a budget for that.
  }, 30_000);

  it('reports readiness through the whole chain without creating a run', async () => {
    const res = await fetch(`${baseUrl}/v1/readiness`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    const body = await res.json() as Record<string, unknown>;
    expect(body.protocol).toBe('relay-hermes-reviewer.v1');
    expect(body.runCreated).toBe(false);
    // Host layout never leaves the service.
    expect(JSON.stringify(body)).not.toContain('binaryPath');
    expect(JSON.stringify(body)).not.toContain(dir);
  }, 30_000);

  it('never returns credential material anywhere in the chain', async () => {
    const readiness = await bridgeClient().readiness();
    const connection = await bridgeClient().testConnection();
    const serialized = JSON.stringify({ readiness, connection });
    expect(serialized).not.toContain('sk-ant-FAKE');
    expect(serialized).not.toContain(TOKEN);
  }, 30_000);

  it('runs a review end to end and returns a safe structured result', async () => {
    const client = bridgeClient();
    const started = await client.startReview({
      runId: 'e2e-1', idempotencyKey: 'e2e-key-1',
      prompt: 'Review this diff and respond in the required format.',
      limits: { timeoutMs: 20_000, maxOutputBytes: 64 * 1024, maxTurns: 1, maxPromptBytes: 64 * 1024 },
    });
    expect(started.accepted).toBe(true);
    expect(started.duplicate).toBe(false);

    const state = await waitForSettled(started.runId, client);
    expect(state.protocol).toBe('relay-hermes-reviewer.v1');
    expect(state.status).toBe('completed');
    // A real verdict came back through four layers.
    expect(state.reviewText).toBeTruthy();
    expect(typeof state.reviewText).toBe('string');
  }, 60_000);

  it('does not start a second paid run for a repeated idempotency key', async () => {
    const client = bridgeClient();
    const request = {
      runId: 'e2e-dup-a', idempotencyKey: 'shared-key',
      prompt: 'first', limits: { timeoutMs: 20_000, maxOutputBytes: 4096, maxTurns: 1, maxPromptBytes: 4096 },
    };
    const first = await client.startReview(request);
    // The SAME request replayed — a retry, not a new review.
    const second = await client.startReview(request);
    expect(second.duplicate).toBe(true);
    expect(second.runId).toBe(first.runId);
  }, 30_000);

  /**
   * This case used to replay the key with a different run id AND a different
   * prompt and expect a silent `duplicate: true` — so a key reused for a
   * genuinely different review returned some OTHER run's identity, and the
   * caller could never tell the two reviews had been conflated. A key is a
   * promise about one request; a different request under the same key is a
   * conflict, and it is now refused as a decision rather than an outage.
   */
  it('refuses an idempotency key replayed for a materially different review', async () => {
    const client = bridgeClient();
    const base = {
      idempotencyKey: 'conflict-key',
      limits: { timeoutMs: 20_000, maxOutputBytes: 4096, maxTurns: 1, maxPromptBytes: 4096 },
    };
    const first = await client.startReview({ ...base, runId: 'e2e-conf-a', prompt: 'first' });
    expect(first.accepted).toBe(true);

    const conflicting = await client.startReview({ ...base, runId: 'e2e-conf-b', prompt: 'DIFFERENT' });
    expect(conflicting.accepted).toBe(false);
    expect(conflicting.failureKind).toBe('review_refused');
    // Still no second paid run, which was the point of the original case.
    // `unknown`, not `failed`: no run by that id exists here, and absence is
    // not a failure report.
    expect((await client.getReview('e2e-conf-b')).status).toBe('unknown');
  }, 30_000);

  it('rejects an unknown field rather than silently ignoring it', async () => {
    const res = await fetch(`${baseUrl}/v1/reviews`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        runId: 'x', idempotencyKey: 'k', prompt: 'p',
        limits: { timeoutMs: 1000, maxOutputBytes: 1000, maxTurns: 1, maxPromptBytes: 1000 },
        apiKey: 'sk-ant-INJECTED',
      }),
    });
    // A caller trying to hand the service a credential is refused outright.
    expect(res.status).toBe(422);
  }, 30_000);

  it('rejects malformed limits', async () => {
    const res = await fetch(`${baseUrl}/v1/reviews`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ runId: 'x', idempotencyKey: 'k2', prompt: 'p', limits: { timeoutMs: -1 } }),
    });
    expect(res.status).toBe(422);
  }, 30_000);

  it('reports an unknown run truthfully instead of inventing state', async () => {
    const state = await bridgeClient().getReview('never-existed');
    expect(state.status).toBe('unknown');
    expect(state.failureKind, 'absence is not a failure and the service answered').toBeNull();
    expect(state.reviewText).toBeNull();
    // ALL THREE causes are named, and none is asserted as the one that
    // happened. The message used to say only "do not survive a restart";
    // once retention became bounded (independent review, F1) that became a
    // guess, because an old completed run can now also have been evicted, and
    // neither of those is an id that never existed.
    expect(state.safeMessage).toContain('never created');
    expect(state.safeMessage).toContain('restart');
    expect(state.safeMessage).toContain('evicted');
  }, 30_000);

  it('reports Unknown usage rather than zero when the harness reported none', async () => {
    const state = await bridgeClient().getReview('never-existed');
    expect(state.usage.source).toBe('unavailable');
    expect(state.usage.inputTokens).toBeNull();
  }, 30_000);
});

describe('a non-zero exit cannot approve', () => {
  let failDir: string;
  let failServer: ReturnType<typeof createHermesService>;
  let failUrl: string;

  beforeAll(async () => {
    failDir = mkdtempSync(join(tmpdir(), 'relay-hermes-e2e-fail-'));
    const executable = writeFakeHermes(join(failDir, 'hermes-crash'), 'crash');
    failServer = createHermesService(createLocalHermesTransport({
      executable, provider: providerConfig(), apiKey: 'sk-ant-FAKE-NEVER-USED',
    }));
    failUrl = await listenOn(failServer);
    setLifecycleState('ready');
  });

  afterAll(() => {
    failServer?.close();
    rmSync(failDir, { recursive: true, force: true });
  });

  it('never reports a completed verdict when Hermes exits non-zero', async () => {
    const client = createRemoteHermesTransport({
      serviceUrl: failUrl, serviceToken: TOKEN, timeoutMs: 15_000,
    });
    const started = await client.startReview({
      runId: 'bad-1', idempotencyKey: 'bad-key-1', prompt: 'review',
      limits: { timeoutMs: 20_000, maxOutputBytes: 4096, maxTurns: 1, maxPromptBytes: 4096 },
    });
    expect(started.accepted).toBe(true);

    let state = await client.getReview(started.runId);
    for (let i = 0; i < 60 && state.status === 'running'; i += 1) {
      await new Promise((r) => { setTimeout(r, 100); });
      state = await client.getReview(started.runId);
    }
    // A non-zero exit can never become an approval.
    expect(state.status).not.toBe('completed');
    expect(state.reviewText).toBeNull();
  }, 60_000);
});

/**
 * THE SHUTDOWN PATH, PROVEN RATHER THAN ASSUMED.
 *
 * `main.ts` answers SIGTERM by refusing new reviews and then calling
 * `engine.cancelAll()`. The refusal half was already covered; `cancelAll`
 * itself was covered by nothing, which left the most consequential half of the
 * shutdown contract — a platform restart must never manufacture an approval —
 * resting on an untested call.
 *
 * The orphan check is deliberately made against the real process table. The
 * abort path terminates the process GROUP and resolves immediately without
 * waiting for the child to close, so a settled run status proves that
 * cancellation was requested, NOT that anything actually died.
 */
describe('the SIGTERM path cancels live runs and leaves nothing behind', () => {
  let shutdownDir: string;
  /** Unique, so the process table can be searched without ambiguity. */
  const probe = `relay-shutdown-probe-${process.pid}`;

  beforeAll(() => {
    shutdownDir = mkdtempSync(join(tmpdir(), 'relay-hermes-shutdown-'));
  });

  afterAll(() => {
    rmSync(shutdownDir, { recursive: true, force: true });
  });

  const processTableHas = (token: string): boolean => {
    // If the platform cannot be asked, the test fails loudly rather than
    // passing without having checked anything.
    const table = execFileSync('ps', ['-eo', 'args'], { encoding: 'utf8' });
    return table.includes(token);
  };

  const settle = async (predicate: () => boolean, tries = 100): Promise<void> => {
    for (let i = 0; i < tries && !predicate(); i += 1) {
      await new Promise((r) => { setTimeout(r, 100); });
    }
  };

  it('cancels an in-flight review, which then reports no verdict and no orphan', async () => {
    const executable = writeFakeHermes(join(shutdownDir, probe), 'hang');
    const engine = createLocalHermesTransport({
      executable, provider: providerConfig(), apiKey: 'sk-ant-FAKE-NEVER-USED',
    });

    const started = await engine.startReview({
      runId: 'shutdown-1', idempotencyKey: 'shutdown-key-1', prompt: 'review',
      // Comfortably longer than this test needs, so a PASS can only come from
      // cancellation and never from the runner's own timeout firing first.
      limits: { timeoutMs: 30_000, maxOutputBytes: 4096, maxTurns: 1, maxPromptBytes: 4096 },
    });
    expect(started.accepted).toBe(true);

    // There is a real child process, and the run is genuinely live.
    await settle(() => processTableHas(probe), 50);
    expect(processTableHas(probe), 'the fake Hermes should be running before cancellation').toBe(true);
    expect((await engine.getReview('shutdown-1')).status).toBe('running');

    // EXACTLY what main.ts does on SIGTERM.
    await engine.cancelAll?.();

    let state = await engine.getReview('shutdown-1');
    for (let i = 0; i < 60 && state.status === 'running'; i += 1) {
      await new Promise((r) => { setTimeout(r, 100); });
      state = await engine.getReview('shutdown-1');
    }

    // An interrupted review is never a completed one, and carries no verdict.
    expect(state.status).toBe('cancelled');
    expect(state.reviewText).toBeNull();
    // Usage nobody reported stays Unknown. It never becomes zero.
    expect(state.usage.source).toBe('unavailable');
    expect(state.usage.inputTokens).toBeNull();

    // And the process group is really gone.
    await settle(() => !processTableHas(probe), 100);
    expect(processTableHas(probe), 'a cancelled review left an orphan Hermes process').toBe(false);
  }, 60_000);
});

/**
 * RUN IDENTITY SAFETY.
 *
 * `runs.set(runId, …)` used to overwrite silently. A second request reusing a
 * run id destroyed the first record and, with it, the only reference to that
 * run's AbortController — so `cancelAll()` could never reach it and a
 * shutdown left its Hermes process group alive. That is precisely the orphan
 * this service promises cannot happen, produced by a caller sending a
 * duplicate id.
 */
describe('a run record is never replaced, and a collision orphans nothing', () => {
  let dir2: string;
  const probe2 = `relay-collision-probe-${process.pid}`;

  beforeAll(() => { dir2 = mkdtempSync(join(tmpdir(), 'relay-hermes-collision-')); });
  afterAll(() => { rmSync(dir2, { recursive: true, force: true }); });

  const tableHas = (token: string): boolean =>
    execFileSync('ps', ['-eo', 'args'], { encoding: 'utf8' }).includes(token);

  const wait = async (predicate: () => boolean, tries = 100): Promise<void> => {
    for (let i = 0; i < tries && !predicate(); i += 1) {
      await new Promise((r) => { setTimeout(r, 100); });
    }
  };

  const limits = { timeoutMs: 30_000, maxOutputBytes: 4096, maxTurns: 1, maxPromptBytes: 4096 };

  it('refuses a duplicate runId instead of overwriting the live run', async () => {
    const executable = writeFakeHermes(join(dir2, probe2), 'hang');
    const engine = createLocalHermesTransport({
      executable, provider: providerConfig(), apiKey: 'sk-ant-FAKE-NEVER-USED',
    });

    const first = await engine.startReview({
      runId: 'collide-1', idempotencyKey: 'key-A', prompt: 'first', limits,
    });
    expect(first.accepted).toBe(true);
    await wait(() => tableHas(probe2), 50);
    expect(tableHas(probe2)).toBe(true);

    // Same runId, DIFFERENT idempotency key — the collision.
    const second = await engine.startReview({
      runId: 'collide-1', idempotencyKey: 'key-B', prompt: 'second', limits,
    });
    expect(second.accepted).toBe(false);
    // A decision, not an outage.
    expect(second.failureKind).toBe('review_refused');

    // The FIRST run is untouched and still live.
    expect((await engine.getReview('collide-1')).status).toBe('running');

    // And shutdown still reaches it — the orphan the collision used to cause.
    await engine.cancelAll?.();
    let state = await engine.getReview('collide-1');
    for (let i = 0; i < 60 && state.status === 'running'; i += 1) {
      await new Promise((r) => { setTimeout(r, 100); });
      state = await engine.getReview('collide-1');
    }
    expect(state.status).toBe('cancelled');
    expect(state.reviewText).toBeNull();
    await wait(() => !tableHas(probe2), 100);
    expect(tableHas(probe2), 'the collision left an orphan Hermes process').toBe(false);
  }, 90_000);

  it('returns the same run for a replayed key, and refuses a key reused for a different request', async () => {
    const executable = writeFakeHermes(join(dir2, 'hermes-idem-clean'), 'clean');
    const engine = createLocalHermesTransport({
      executable, provider: providerConfig(), apiKey: 'sk-ant-FAKE-NEVER-USED',
    });
    const req = { runId: 'idem-1', idempotencyKey: 'key-1', prompt: 'same', limits };

    const a = await engine.startReview(req);
    const b = await engine.startReview(req);
    expect(a.accepted).toBe(true);
    expect(b.accepted).toBe(true);
    expect(b.duplicate).toBe(true);
    expect(b.runId).toBe(a.runId);

    // Same key, materially different request — a conflict, not a duplicate.
    const c = await engine.startReview({ ...req, runId: 'idem-2', prompt: 'DIFFERENT evidence' });
    expect(c.accepted).toBe(false);
    expect(c.failureKind).toBe('review_refused');
    // The original run was not replaced by the conflicting request.
    expect((await engine.getReview('idem-1')).runId).toBe('idem-1');
  }, 60_000);
});
