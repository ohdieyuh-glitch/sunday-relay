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
    // And no model, which is the field this decoder used to drop entirely.
    expect(r.usage.model).toBeNull();
  });

  /**
   * THE SERVED MODEL CROSSES THE WIRE.
   *
   * The harness has parsed the served model out of Hermes' own usage report
   * since the usage file existed, and this decoder copied the token counts and
   * silently discarded the model — the first of three layers that each lost
   * the one field proving which model actually reviewed (defect 3).
   */
  it('decodes the served model the service reported', async () => {
    const r = await transport(() => reply(200, {
      protocol: HERMES_SERVICE_PROTOCOL, status: 'completed', reviewText: 'APPROVED',
      usage: { inputTokens: 120, outputTokens: 45, model: 'grok-4-0709' },
    })).getReview('r1');
    expect(r.usage.model).toBe('grok-4-0709');
    expect(r.usage.source).toBe('harness_reported');
  });

  it('treats a usage report that names only a model as a report', async () => {
    // Hermes can name the model without token counts. Calling that
    // 'unavailable' would discard the served model as collateral.
    const r = await transport(() => reply(200, {
      protocol: HERMES_SERVICE_PROTOCOL, status: 'completed', reviewText: 'APPROVED',
      usage: { model: 'grok-4-0709' },
    })).getReview('r1');
    expect(r.usage.source).toBe('harness_reported');
    expect(r.usage.model).toBe('grok-4-0709');
    // Unknown tokens are still Unknown — naming a model does not invent them.
    expect(r.usage.inputTokens).toBeNull();
    expect(r.usage.outputTokens).toBeNull();
  });

  it('refuses a non-string served model instead of coercing one', async () => {
    const r = await transport(() => reply(200, {
      protocol: HERMES_SERVICE_PROTOCOL, status: 'completed', reviewText: 'APPROVED',
      usage: { inputTokens: 1, outputTokens: 2, model: { name: 'grok-4' } },
    })).getReview('r1');
    expect(r.usage.model).toBeNull();
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

/**
 * A REFUSAL IS A DECISION; A BYTE CEILING IS A CEILING.
 *
 * Two faults this covers. Every error status used to flatten to
 * `service_unreachable`, so a service that authenticated the caller,
 * understood the request and DECLINED it read as a network outage. And the
 * response cap was applied to `raw.length` after `res.text()` had already
 * buffered everything — it bounded parsing, not memory, and counted UTF-16
 * units, so a 256K-unit cap admitted roughly a megabyte of UTF-8.
 */
describe('refusal, outage and oversize stay three different answers', () => {
  const withBody = (status: number, body: unknown, extra: Record<string, unknown> = {}): FetchLike =>
    () => Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
      ...extra,
    } as Awaited<ReturnType<FetchLike>>);

  const startArgs = {
    runId: 'r1', idempotencyKey: 'k1', prompt: 'review',
    limits: { timeoutMs: 1000, maxOutputBytes: 1000, maxTurns: 1, maxPromptBytes: 1000 },
  };

  it('reports a deliberate refusal as review_refused, not as an unreachable service', async () => {
    const r = await transport(withBody(409, {
      protocol: HERMES_SERVICE_PROTOCOL, kind: 'review_refused',
      error: 'UPSTREAM-PROSE-THAT-MUST-NOT-BE-REFLECTED',
    })).startReview(startArgs);
    expect(r.accepted).toBe(false);
    expect(r.failureKind).toBe('review_refused');
    // Code can branch on refusal without mistaking it for an outage.
    expect(r.failureKind).not.toBe('service_unreachable');
    // The KIND crosses the boundary; the upstream prose does not.
    expect(r.safeMessage ?? '').not.toContain('UPSTREAM-PROSE-THAT-MUST-NOT-BE-REFLECTED');
  });

  it('keeps authentication, protocol and outage distinct from refusal', async () => {
    expect((await transport(withBody(401, {})).startReview(startArgs)).failureKind)
      .toBe('authentication_failed');
    expect((await transport(withBody(500, 'not json')).startReview(startArgs)).failureKind)
      .toBe('service_unreachable');
    expect((await transport(withBody(409, { protocol: 'some.other.v9', kind: 'review_refused' }))
      .startReview(startArgs)).failureKind).toBe('service_unreachable');
    expect((await transport(withBody(409, { protocol: HERMES_SERVICE_PROTOCOL, kind: 'not_a_real_kind' }))
      .startReview(startArgs)).failureKind).toBe('service_unreachable');
  });

  it('accepts a body just under the ceiling and refuses one just over it, in BYTES', async () => {
    const pad = (bytes: number) =>
      `{"protocol":"${HERMES_SERVICE_PROTOCOL}","connected":true,"identity":{"provider":"xai"},"pad":"${'x'.repeat(bytes)}"}`;
    const underOk = await transport(withBody(200, pad(1000))).testConnection();
    expect(underOk.failureKind).toBeNull();
    const over = await transport(withBody(200, pad(300_000))).testConnection();
    expect(over.failureKind).toBe('malformed_response');
  });

  it('counts multi-byte UTF-8 as its real byte length, not its string length', async () => {
    // 200_000 four-byte characters = 800_000 bytes but only 400_000 UTF-16
    // units. Measured as a string this slipped under a 256K cap.
    const emoji = '😀'.repeat(200_000);
    const r = await transport(withBody(200, `{"protocol":"${HERMES_SERVICE_PROTOCOL}","pad":"${emoji}"}`))
      .testConnection();
    expect(r.failureKind).toBe('malformed_response');
  });

  it('refuses an oversized declared Content-Length before reading the body', async () => {
    let bodyRead = false;
    const fetchImpl: FetchLike = () => Promise.resolve({
      ok: true, status: 200,
      headers: { get: (n: string) => (n.toLowerCase() === 'content-length' ? '99999999' : null) },
      text: async () => { bodyRead = true; return '{}'; },
    } as Awaited<ReturnType<FetchLike>>);
    const r = await transport(fetchImpl).testConnection();
    expect(r.failureKind).toBe('malformed_response');
    expect(bodyRead, 'an over-declared body must not be read at all').toBe(false);
  });

  it('stops a streamed body the moment it crosses the ceiling, even with a lying Content-Length', async () => {
    let chunksServed = 0;
    const chunk = new Uint8Array(64 * 1024);
    const fetchImpl: FetchLike = () => Promise.resolve({
      ok: true, status: 200,
      headers: { get: () => '10' }, // a lie
      body: {
        getReader: () => ({
          read: async () => {
            chunksServed += 1;
            // Would stream forever if nothing stopped it.
            return { done: false, value: chunk };
          },
          cancel: async () => undefined,
        }),
      },
      text: async () => '{}',
    } as unknown as Awaited<ReturnType<FetchLike>>);
    const r = await transport(fetchImpl).testConnection();
    expect(r.failureKind).toBe('malformed_response');
    // It abandoned the stream rather than draining it forever.
    expect(chunksServed).toBeLessThan(64);
  });

  it('reports a stream that fails mid-read as unreadable, not as a verdict', async () => {
    const fetchImpl: FetchLike = () => Promise.resolve({
      ok: true, status: 200,
      headers: { get: () => null },
      body: {
        getReader: () => ({
          read: async () => { throw new Error('connection reset'); },
          cancel: async () => undefined,
        }),
      },
      text: async () => '{}',
    } as unknown as Awaited<ReturnType<FetchLike>>);
    const r = await transport(fetchImpl).testConnection();
    expect(r.connected).toBe(false);
    expect(r.failureKind).toBe('malformed_response');
  });
});

/**
 * PROVIDER IDENTITY IS NEVER INFERRED.
 *
 * `strOrNull(identity.provider) ?? 'xai'` behind a cast meant an absent,
 * blank, mistyped or unrecognised provider silently became xAI — inference,
 * in the one place the milestone promises there is none.
 */
describe('a provider Relay cannot read is not a connected provider', () => {
  const identity = (id: unknown) => ({
    protocol: HERMES_SERVICE_PROTOCOL, connected: true,
    identity: { provider: id, requestedModel: 'm', credentialPresent: true, verifiable: true },
  });

  for (const [label, value] of [
    ['missing', undefined], ['blank', ''], ['whitespace', '   '],
    ['unknown', 'openai'], ['wrong type', 42], ['null', null],
  ] as const) {
    it(`refuses to infer a provider when it is ${label}`, async () => {
      const r = await transport(() => reply(200, identity(value))).testConnection();
      expect(r.connected, `${label} must not report connected`).toBe(false);
      expect(r.identity).toBeNull();
      expect(r.failureKind).toBe('provider_unverified');
      // Above all: it did not become xAI.
      expect(JSON.stringify(r)).not.toContain('"xai"');
    });
  }

  it('accepts each real provider exactly as declared', async () => {
    for (const p of ['xai', 'anthropic'] as const) {
      const r = await transport(() => reply(200, identity(p))).testConnection();
      expect(r.connected).toBe(true);
      expect(r.identity?.provider).toBe(p);
    }
  });

  it('keeps a service-declared provider separate from a verified model', async () => {
    const r = await transport(() => reply(200, identity('anthropic'))).testConnection();
    // Declared, but nothing here verified a model.
    expect(r.identity?.provider).toBe('anthropic');
    expect(r.identity?.verifiedModelId).toBeNull();
  });
});

/* -------------------------------------- temporary vs permanent refusals --- */

/**
 * THE DISTINCTION THE SERVICE DREW, PRESERVED ONE HOP LATER.
 *
 * `relay-hermes-service/service.ts` is careful that capacity is not a refusal:
 * "capacity clears on its own; a refusal does not". The bridge then rewrote
 * every refusal with one sentence — *"This is a decision by the service, not a
 * network fault"* — which for a 503 is the exact opposite of what the service
 * said, and tells an operator to change a request that was never the problem.
 *
 * `shutting_down` and `validation_failed` were worse: the service emits both
 * and the bridge's vocabulary did not contain them, so `refusalFromBody`
 * dropped them and reported `service_unreachable`. Every ordinary deploy sent
 * an operator to check networking that was working perfectly.
 */
describe('a temporary condition is not reported as a decision', () => {
  const body = (status: number, kind: string): FetchLike =>
    () => Promise.resolve({
      ok: false,
      status,
      text: async () => JSON.stringify({
        protocol: HERMES_SERVICE_PROTOCOL, kind, error: 'UPSTREAM-PROSE',
      }),
    } as Awaited<ReturnType<FetchLike>>);

  const start = {
    runId: 'r1', idempotencyKey: 'k1', prompt: 'review',
    limits: { timeoutMs: 1000, maxOutputBytes: 1000, maxTurns: 1, maxPromptBytes: 1000 },
  };

  it('a 503 capacity refusal decodes as capacity_exhausted, and says it will clear', async () => {
    const r = await transport(body(503, 'capacity_exhausted')).startReview(start);
    expect(r.accepted).toBe(false);
    expect(r.failureKind).toBe('capacity_exhausted');
    expect(r.failureKind).not.toBe('service_unreachable');
    expect(r.safeMessage ?? '').toContain('temporary');
    expect(r.safeMessage ?? '').toContain('may be sent again unchanged');
    // The wording that was wrong for this case must not be what it gets.
    expect(r.safeMessage ?? '').not.toContain('decision by the service');
    // Upstream prose still never crosses the boundary.
    expect(r.safeMessage ?? '').not.toContain('UPSTREAM-PROSE');
  });

  it('a draining service decodes as shutting_down, not as unreachable', async () => {
    const r = await transport(body(503, 'shutting_down')).startReview(start);
    expect(r.failureKind).toBe('shutting_down');
    expect(r.safeMessage ?? '').toContain('temporary');
    expect(r.safeMessage ?? '').toContain('deploy');
  });

  it('a malformed request decodes as validation_failed, and says retrying will not help', async () => {
    const r = await transport(body(422, 'validation_failed')).startReview(start);
    expect(r.failureKind).toBe('validation_failed');
    expect(r.safeMessage ?? '').toContain('will fail again');
  });

  it('a deliberate refusal keeps the permanent framing', async () => {
    const r = await transport(body(409, 'review_refused')).startReview(start);
    expect(r.failureKind).toBe('review_refused');
    expect(r.safeMessage ?? '').toContain('decision by the service');
  });

  it('an evicted or unknown run is passed through as unknown, not rewritten to failed', async () => {
    const r = await transport(() => Promise.resolve({
      ok: true, status: 200,
      text: async () => JSON.stringify({
        protocol: HERMES_SERVICE_PROTOCOL, runId: 'gone', status: 'unknown',
        usage: {}, failureKind: null,
        safeMessage: 'There is no in-memory record of that review here.',
      }),
    } as Awaited<ReturnType<FetchLike>>)).getReview('gone');
    expect(r.status).toBe('unknown');
    expect(r.failureKind).toBeNull();
    expect(r.reviewText).toBeNull();
    expect(r.usage.source).toBe('unavailable');
  });
});
