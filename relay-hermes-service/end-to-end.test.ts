import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHermesService, SERVICE_TOKEN_ENV } from './service';
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

const waitForSettled = async (runId: string, client = bridgeClient()) => {
  for (let i = 0; i < 60; i += 1) {
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
  });

  it('refuses every /v1 route without the service token', async () => {
    for (const [method, path] of [
      ['GET', '/v1/readiness'], ['POST', '/v1/test-connection'],
      ['POST', '/v1/reviews'], ['GET', '/v1/reviews/x'], ['POST', '/v1/reviews/x/cancel'],
    ] as const) {
      const res = await fetch(`${baseUrl}${path}`, { method });
      expect(res.status, `${method} ${path}`).toBe(401);
    }
  });

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
  });

  it('does not start a second paid run for a repeated idempotency key', async () => {
    const client = bridgeClient();
    const first = await client.startReview({
      runId: 'e2e-dup-a', idempotencyKey: 'shared-key',
      prompt: 'first', limits: { timeoutMs: 20_000, maxOutputBytes: 4096, maxTurns: 1, maxPromptBytes: 4096 },
    });
    const second = await client.startReview({
      runId: 'e2e-dup-b', idempotencyKey: 'shared-key',
      prompt: 'second', limits: { timeoutMs: 20_000, maxOutputBytes: 4096, maxTurns: 1, maxPromptBytes: 4096 },
    });
    expect(second.duplicate).toBe(true);
    expect(second.runId).toBe(first.runId);
  });

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
  });

  it('rejects malformed limits', async () => {
    const res = await fetch(`${baseUrl}/v1/reviews`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ runId: 'x', idempotencyKey: 'k2', prompt: 'p', limits: { timeoutMs: -1 } }),
    });
    expect(res.status).toBe(422);
  });

  it('reports an unknown run truthfully instead of inventing state', async () => {
    const state = await bridgeClient().getReview('never-existed');
    expect(state.status).toBe('failed');
    expect(state.reviewText).toBeNull();
    expect(state.safeMessage).toContain('do not survive a restart');
  });

  it('reports Unknown usage rather than zero when the harness reported none', async () => {
    const state = await bridgeClient().getReview('never-existed');
    expect(state.usage.source).toBe('unavailable');
    expect(state.usage.inputTokens).toBeNull();
  });
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
  });
});
