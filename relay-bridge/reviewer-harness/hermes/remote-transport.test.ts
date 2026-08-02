import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRemoteHermesTransport, type FetchLike } from './remote-transport';
import { HERMES_SERVICE_PROTOCOL } from './hermes-transport';

/**
 * The remote transport, driven entirely by an injected fake fetch. Nothing
 * here opens a socket, resolves a host, or spawns a process.
 */

const NOW = '2026-08-02T12:00:00.000Z';
const TOKEN = 'service-token-secret';

const reply = (status: number, body: unknown): ReturnType<FetchLike> =>
  Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  });

const transport = (fetchImpl: FetchLike) => createRemoteHermesTransport({
  serviceUrl: 'http://hermes.railway.internal:8080',
  serviceToken: TOKEN,
  fetchImpl,
  now: () => NOW,
});

const captured = (status: number, body: unknown) => {
  const calls: { url: string; headers: Record<string, string>; body?: string }[] = [];
  const fn: FetchLike = (url, init) => {
    calls.push({ url, headers: init.headers, body: init.body });
    return reply(status, body);
  };
  return { fn, calls };
};

const READY_BODY = {
  protocol: HERMES_SERVICE_PROTOCOL,
  evidence: {
    installed: true, version: '0.18.2', compatible: true,
    machineInterface: 'oneshot', machineInterfaceVerified: true,
    credentialPresent: true, modelVerified: false,
    requestedModel: 'claude-sonnet-5', verifiedModelId: null,
    readOnlyEnforceable: true, failureReason: null,
    binaryPath: '/opt/hermes/bin/hermes',
  },
};

describe('remote mode never touches the bridge container', () => {
  it('imports no process, discovery or profile module', () => {
    // Structural, not behavioural: the file must not be ABLE to spawn.
    // Comments are stripped first — this asserts about CODE, and prose that
    // merely discusses spawning is not a capability.
    const code = readFileSync(join(__dirname, 'remote-transport.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    for (const forbidden of [
      'node:child_process', 'spawn(', 'spawnSync', 'execFile',
      './discovery', './isolated-profile', './runner', 'RELAY_HERMES_EXECUTABLE',
    ]) {
      expect(code, `remote transport references ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('reports itself as the remote mode', () => {
    expect(transport(() => reply(200, READY_BODY)).mode).toBe('remote');
  });
});

describe('authentication', () => {
  it('sends the service token as a bearer credential', async () => {
    const { fn, calls } = captured(200, READY_BODY);
    await transport(fn).readiness();
    expect(calls[0].headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('reports a rejected credential as authentication_failed, not unreachable', async () => {
    for (const status of [401, 403]) {
      const r = await transport(() => reply(status, {})).testConnection();
      expect(r.failureKind, `status ${status}`).toBe('authentication_failed');
      expect(r.connected).toBe(false);
    }
  });

  it('never returns the token or any derived description of it', async () => {
    const r = await transport(() => reply(401, { protocol: HERMES_SERVICE_PROTOCOL })).testConnection();
    const s = JSON.stringify(r);
    expect(s).not.toContain(TOKEN);
    // A length or a hash is not a secret, but it lets two deployments be
    // compared for equality — more than a caller needs.
    expect(s).not.toMatch(/tokenLength|length"\s*:|hash|sha256/i);
    expect(s).not.toContain('Bearer');
  });
});

describe('responses are validated before they become evidence', () => {
  it('rejects a protocol mismatch rather than guessing', async () => {
    const r = await transport(() => reply(200, { protocol: 'something-else.v9', connected: true })).testConnection();
    expect(r.failureKind).toBe('protocol_mismatch');
    // A service claiming success on an unknown protocol is still not connected.
    expect(r.connected).toBe(false);
  });

  it('rejects unparseable and oddly-shaped bodies', async () => {
    expect((await transport(() => reply(200, 'not json')).testConnection()).failureKind).toBe('malformed_response');
    expect((await transport(() => reply(200, [1, 2, 3])).testConnection()).failureKind).toBe('malformed_response');
  });

  it('rejects an oversized body instead of parsing it', async () => {
    const huge = `{"protocol":"${HERMES_SERVICE_PROTOCOL}","pad":"${'x'.repeat(300_000)}"}`;
    expect((await transport(() => reply(200, huge)).testConnection()).failureKind).toBe('malformed_response');
  });

  it('reports an unreachable service distinctly from a bad token', async () => {
    const r = await transport(() => Promise.reject(new Error('ECONNREFUSED http://hermes.railway.internal:8080'))).testConnection();
    expect(r.failureKind).toBe('service_unreachable');
    // The cause is not reflected: it names internal host layout.
    expect(JSON.stringify(r)).not.toContain('railway.internal');
  });

  it('rejects an unknown run status', async () => {
    const r = await transport(() => reply(200, { protocol: HERMES_SERVICE_PROTOCOL, status: 'probably_fine' })).getReview('r1');
    expect(r.status).toBe('failed');
    expect(r.failureKind).toBe('malformed_response');
  });
});

describe('readiness', () => {
  it('maps service evidence without inventing anything', async () => {
    const e = await transport(() => reply(200, READY_BODY)).readiness();
    expect(e.installed).toBe(true);
    expect(e.version).toBe('0.18.2');
    expect(e.readOnlyEnforceable).toBe(true);
    expect(e.credentialPresent).toBe(true);
    // Credential present, model still unverified — the Anthropic case.
    expect(e.modelVerified).toBe(false);
    expect(e.verifiedModelId).toBeNull();
  });

  it('never lets a binary path leave the service', async () => {
    const e = await transport(() => reply(200, READY_BODY)).readiness();
    expect(e.binaryPath).toBeNull();
    expect(JSON.stringify(e)).not.toContain('/opt/hermes');
  });

  it('says the BRIDGE answered even when the Hermes service did not', async () => {
    // Collapsing these would send an operator to debug the wrong system.
    const e = await transport(() => Promise.reject(new Error('down'))).readiness();
    expect(e.bridgeAvailable).toBe(true);
    expect(e.installed).toBe(false);
    expect(e.failureReason).toContain('could not reach the Hermes Reviewer service');
  });
});

describe('test-connection never creates a run', () => {
  it('reports runCreated false even if the service claims otherwise', async () => {
    const r = await transport(() => reply(200, {
      protocol: HERMES_SERVICE_PROTOCOL, connected: true, runCreated: true,
      identity: { provider: 'anthropic', requestedModel: 'claude-sonnet-5', credentialPresent: true, verifiable: false, verifiedModelId: null },
    })).testConnection();
    expect(r.runCreated).toBe(false);
  });

  it('keeps requested and verified identity separate', async () => {
    const r = await transport(() => reply(200, {
      protocol: HERMES_SERVICE_PROTOCOL, connected: false,
      identity: { provider: 'anthropic', requestedModel: 'claude-sonnet-5', credentialPresent: true, verifiable: false, verifiedModelId: null },
      failureKind: 'provider_unverified', safeMessage: 'no token-free verification exists',
    })).testConnection();
    expect(r.identity?.requestedModel).toBe('claude-sonnet-5');
    expect(r.identity?.verifiedModelId).toBeNull();
    expect(r.failureKind).toBe('provider_unverified');
  });

  it('does not conflate the two providers', async () => {
    const r = await transport(() => reply(200, {
      protocol: HERMES_SERVICE_PROTOCOL, connected: true,
      identity: { provider: 'xai', requestedModel: 'grok-4', credentialPresent: true, verifiable: true, verifiedModelId: 'grok-4' },
    })).testConnection();
    expect(r.identity?.provider).toBe('xai');
    expect(r.identity?.verifiedModelId).toBe('grok-4');
  });
});

describe('reviews', () => {
  it('sends the prompt in a JSON body, never a shell command or a URL', async () => {
    const { fn, calls } = captured(200, { protocol: HERMES_SERVICE_PROTOCOL, accepted: true, runId: 'r1' });
    await transport(fn).startReview({
      runId: 'r1', idempotencyKey: 'k1', prompt: 'review this; rm -rf /',
      limits: { timeoutMs: 1000, maxOutputBytes: 1000, maxTurns: 1, maxPromptBytes: 1000 },
    });
    expect(calls[0].url).not.toContain('rm -rf');
    expect(JSON.parse(calls[0].body as string).prompt).toBe('review this; rm -rf /');
  });

  it('never puts a provider credential in the request', async () => {
    const { fn, calls } = captured(200, { protocol: HERMES_SERVICE_PROTOCOL, accepted: true, runId: 'r1' });
    await transport(fn).startReview({
      runId: 'r1', idempotencyKey: 'k1', prompt: 'x',
      limits: { timeoutMs: 1, maxOutputBytes: 1, maxTurns: 1, maxPromptBytes: 1 },
    });
    const sent = calls[0].body as string;
    expect(sent).not.toMatch(/sk-ant|xai-|API_KEY/i);
  });

  it('surfaces a duplicate idempotency key without treating it as a new run', async () => {
    const r = await transport(() => reply(200, {
      protocol: HERMES_SERVICE_PROTOCOL, accepted: true, runId: 'r1', duplicate: true,
    })).startReview({
      runId: 'r2', idempotencyKey: 'k1', prompt: 'x',
      limits: { timeoutMs: 1, maxOutputBytes: 1, maxTurns: 1, maxPromptBytes: 1 },
    });
    expect(r.duplicate).toBe(true);
    expect(r.runId).toBe('r1');
  });

  it('carries a verdict only for a completed run', async () => {
    for (const status of ['cancelled', 'timed_out', 'failed', 'running']) {
      const r = await transport(() => reply(200, {
        protocol: HERMES_SERVICE_PROTOCOL, status, reviewText: 'APPROVED',
      })).getReview('r1');
      // A cancellation or a timeout is not a completion and has no verdict.
      expect(r.reviewText, status).toBeNull();
    }
    const done = await transport(() => reply(200, {
      protocol: HERMES_SERVICE_PROTOCOL, status: 'completed', reviewText: 'APPROVED',
    })).getReview('r1');
    expect(done.reviewText).toBe('APPROVED');
  });

  it('keeps unreported usage Unknown rather than zero', async () => {
    const r = await transport(() => reply(200, { protocol: HERMES_SERVICE_PROTOCOL, status: 'completed' })).getReview('r1');
    expect(r.usage.source).toBe('unavailable');
    expect(r.usage.inputTokens).toBeNull();
  });

  it('does not report a cancellation request as a confirmed termination', async () => {
    const r = await transport(() => reply(200, {
      protocol: HERMES_SERVICE_PROTOCOL, requested: true, terminationConfirmed: false,
    })).cancelReview('r1');
    expect(r.requested).toBe(true);
    expect(r.terminationConfirmed).toBe(false);
  });
});

/**
 * A CATEGORISED FAILURE IS THE PRODUCT HERE.
 *
 * This transport's whole reason for returning kinds rather than one vague
 * "not connected" is that each kind sends an operator somewhere different. Two
 * ways that guarantee can quietly rot:
 *
 *   1. two distinct faults collapsing into one kind — a timeout and a refused
 *      connection both arrive as a thrown error, and reporting the slow case
 *      as "unreachable" sends someone to check a URL that is perfectly fine;
 *   2. an unrecognised kind being CAST into the union — the run status is
 *      validated against its known list, so a kind must be too, or arbitrary
 *      upstream text travels on with the authority of a checked value.
 */
describe('failures stay categorised, and the categories stay honest', () => {
  /** Answers nothing, ever, but honours the abort the transport arms. */
  const neverAnswers: FetchLike = (_url, init) => new Promise((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => { reject(new Error('aborted')); }, { once: true });
  });

  it('reports its own timeout as timed_out, never as an unreachable service', async () => {
    const slow = createRemoteHermesTransport({
      serviceUrl: 'http://hermes.railway.internal:8080',
      serviceToken: TOKEN,
      timeoutMs: 25,
      now: () => NOW,
      fetchImpl: neverAnswers,
    });
    const r = await slow.testConnection();
    // A service answering too slowly is not a service that is not there. One
    // is a wedged or overloaded box, the other a bad URL or a dead deploy.
    expect(r.failureKind).toBe('timed_out');
    expect(r.connected).toBe(false);
    expect(r.runCreated).toBe(false);
    // The distinction must not have cost the redaction guarantees.
    const serialized = JSON.stringify(r);
    expect(serialized).not.toContain(TOKEN);
    expect(serialized).not.toContain('railway.internal');
  }, 15_000);

  it('still reports a refused connection as service_unreachable', async () => {
    // The companion half: the two must not have merged in the other direction.
    const r = await transport(() => Promise.reject(new Error('ECONNREFUSED'))).testConnection();
    expect(r.failureKind).toBe('service_unreachable');
  });

  it('drops a failure kind that is not in the protocol vocabulary', async () => {
    const r = await transport(() => reply(200, {
      protocol: HERMES_SERVICE_PROTOCOL,
      connected: false,
      failureKind: 'everything_is_fine_actually',
    })).testConnection();
    // Not laundered into the union by a cast — Relay's own honest default.
    expect(r.failureKind).toBe('provider_unverified');
  });

  it('keeps a failure kind the service is genuinely entitled to send', async () => {
    const r = await transport(() => reply(200, {
      protocol: HERMES_SERVICE_PROTOCOL,
      connected: false,
      failureKind: 'credentials_missing',
    })).testConnection();
    expect(r.failureKind).toBe('credentials_missing');
  });

  it('drops an unrecognised refusal kind when a review is refused', async () => {
    const r = await transport(() => reply(200, {
      protocol: HERMES_SERVICE_PROTOCOL, accepted: false, failureKind: 'made_up_kind',
    })).startReview({
      runId: 'r1', idempotencyKey: 'k1', prompt: 'review',
      limits: { timeoutMs: 1000, maxOutputBytes: 1000, maxTurns: 1, maxPromptBytes: 1000 },
    });
    expect(r.accepted).toBe(false);
    expect(r.failureKind).toBe('malformed_response');
  });
});
