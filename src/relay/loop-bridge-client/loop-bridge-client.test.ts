import { describe, expect, it, vi } from 'vitest';

import { createLoopBridgeClient } from './index';

/**
 * THE LOOP BRIDGE CLIENT.
 *
 * Driven entirely by an injected fetch: nothing here opens a socket, resolves a
 * host or spawns anything. What is asserted is what the CLI depends on and
 * cannot verify for itself — where the token goes, what a failure is called,
 * and that a failed request never becomes a fabricated run state.
 */

const TOKEN = 'operator-secret-token';
const URL_BASE = 'https://bridge.example.com';

type Call = { url: string; init: Record<string, unknown> };

function spy(status: number, body: unknown) {
  const calls: Call[] = [];
  const impl = (async (url: string, init: Record<string, unknown>) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    };
  }) as unknown as typeof fetch;
  return { calls, impl };
}

const client = (fetchImpl: typeof fetch, overrides: Record<string, unknown> = {}) =>
  createLoopBridgeClient({ bridgeUrl: URL_BASE, token: TOKEN, fetchImpl, ...overrides });

describe('where the token goes', () => {
  it('travels in an Authorization header and NOWHERE else', async () => {
    const f = spy(200, { data: { runId: 'lpr_1' } });
    await client(f.impl).status('lpr_1');
    const [call] = f.calls;
    expect(call).toBeDefined();
    if (call === undefined) return;
    const headers = call.init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${TOKEN}`);
    // Never in the URL — proxies log those. Never in the body.
    expect(call.url).not.toContain(TOKEN);
    expect(String(call.init.body ?? '')).not.toContain(TOKEN);
  });

  it('refuses to send anything at all without a configured bridge or token', async () => {
    const f = spy(200, { data: {} });
    const noUrl = await createLoopBridgeClient({ bridgeUrl: '', token: TOKEN, fetchImpl: f.impl })
      .status('lpr_1');
    const noToken = await createLoopBridgeClient({ bridgeUrl: URL_BASE, token: '', fetchImpl: f.impl })
      .status('lpr_1');
    expect(noUrl.ok).toBe(false);
    expect(noToken.ok).toBe(false);
    expect(f.calls, 'a misconfigured client must open no connection').toHaveLength(0);
  });

  it('refuses a cleartext remote bridge rather than degrading to it', async () => {
    const f = spy(200, { data: {} });
    const result = await createLoopBridgeClient({
      bridgeUrl: 'http://bridge.example.com', token: TOKEN, fetchImpl: f.impl,
    }).status('lpr_1');
    expect(result.ok).toBe(false);
    expect(f.calls).toHaveLength(0);
  });

  it('addresses the one route family, with the run id encoded', async () => {
    const f = spy(200, { data: {} });
    await client(f.impl).status('lpr_1/../admin');
    expect(f.calls[0]?.url).toBe(`${URL_BASE}/relay-api/loop/status/lpr_1%2F..%2Fadmin`);
  });

  it('never follows a redirect — that is how a token reaches an origin nobody configured', async () => {
    const f = spy(302, '');
    const result = await client(f.impl).status('lpr_1');
    expect(f.calls[0]?.init.redirect).toBe('manual');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe('unreachable');
  });
});

describe('a failure is named, and never becomes a run state', () => {
  it('honours the server’s own kind', async () => {
    const f = spy(403, { kind: 'loop_engine_disabled', error: 'The Loop engine is not enabled.' });
    const result = await client(f.impl).status('lpr_1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe('loop_engine_disabled');
    expect(result.status).toBe(403);
  });

  it('is incurious about WHY a credential was rejected', async () => {
    const f = spy(401, '');
    const result = await client(f.impl).status('lpr_1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe('authentication_failed');
    // Absent, malformed, expired and wrong are one answer to a caller.
    expect(result.message).not.toMatch(/expired|malformed|missing/i);
  });

  it('reports an unreachable bridge as unreachable, claiming nothing about the run', async () => {
    const impl = (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
    const result = await client(impl).status('lpr_1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe('unreachable');
    // The distinction the whole surface depends on: Relay could not ASK.
    expect(result.message).not.toMatch(/failed|stopped|completed/i);
  });

  it('a body that is not JSON is an invalid response, not a run', async () => {
    const f = spy(200, '<html>gateway</html>');
    const result = await client(f.impl).status('lpr_1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe('invalid_response');
  });

  it('a 200 with no data envelope is refused rather than read as an empty run', async () => {
    const f = spy(200, { somethingElse: true });
    const result = await client(f.impl).status('lpr_1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe('invalid_response');
  });

  it('an oversized body is refused before it is trusted', async () => {
    const f = spy(200, { data: { pad: 'x'.repeat(200) } });
    const result = await client(f.impl, { maxResponseBytes: 50 }).status('lpr_1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe('invalid_response');
  });

  it('redacts the token from the KIND as well as the message', async () => {
    // The kind was not redacted, and `loop-execution.ts` prints it to stdout.
    // A server answering `{"kind":"refused: <token>"}` therefore got the
    // credential onto the terminal, past a docstring promising it never is.
    const f = spy(400, { kind: `refused: ${TOKEN}`, error: 'nope' });
    const result = await client(f.impl).status('lpr_1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).not.toContain(TOKEN);
    expect(result.message).not.toContain(TOKEN);
  });

  it('a token that is ITSELF a valid-looking kind is still not printed', async () => {
    /*
     * THE TEST ABOVE PASSED FOR THE WRONG REASON, and this is the one that
     * would have caught it.
     *
     * A shape check was added and called redaction. `TOKEN` contains hyphens,
     * so it failed `^[a-z][a-z0-9_]{0,63}$` whatever the redaction did — the
     * assertion held while the leak was wide open. A token made only of
     * lowercase letters, digits and underscores matches that shape perfectly,
     * and `loop-execution.ts` prints the kind to stdout.
     */
    const shapedToken = 'rlb_live_9f3a2c8d1e';
    const f = spy(400, { kind: shapedToken, error: 'nope' });
    const result = await createLoopBridgeClient({
      bridgeUrl: URL_BASE, token: shapedToken, fetchImpl: f.impl,
    }).status('lpr_1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind, 'the credential must never become the printed kind')
      .not.toContain(shapedToken);
  });

  it('redacts BEFORE truncating, so no prefix of the token survives', async () => {
    // Slicing first cut a token across the 2000-character boundary and left
    // its prefix behind. A shorter secret is still a secret.
    const long = `${'x'.repeat(1990)}${TOKEN} trailing`;
    const f = spy(400, { kind: 'validation_failed', error: long });
    const result = await client(f.impl).status('lpr_1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    /*
     * TEN, NOT TWELVE — and that difference is the whole test.
     *
     * Slicing at 2000 leaves exactly the first TEN characters of this token, so
     * asserting on a twelve-character prefix passed against the buggy code as
     * well: the leaked fragment was never that long. The assertion has to name
     * the fragment that actually survived.
     */
    const survivingPrefix = TOKEN.slice(0, 10);
    expect(survivingPrefix.length).toBe(10);
    expect(result.message, 'the prefix left behind by slice-then-redact')
      .not.toContain(survivingPrefix);
  });

  it('a LIST where an object was expected is refused, not passed through', async () => {
    // `typeof [] === 'object'`, so `{"data":[]}` slipped past the guard and
    // `executeLoopHistory` threw inside a promise the CLI does not catch.
    const f = spy(200, { data: [] });
    const result = await client(f.impl).history('lpe_1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe('invalid_response');
  });

  it('a kind that is not a vocabulary word is not relayed onward', async () => {
    // The kind is a word the CLI branches on, not free text. A kilobyte of
    // prose in that slot is a malformed response, not something to pass along.
    for (const kind of ['A'.repeat(500), 'has spaces', 'Uppercase', '', '../../etc']) {
      const f = spy(400, { kind, error: 'nope' });
      const result = await client(f.impl).status('lpr_1');
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.kind, JSON.stringify(kind)).not.toBe(kind);
    }
  });

  it('a data envelope that is not an object is refused, not passed through', async () => {
    // `'data' in envelope` was the whole check, so `{"data":null}` came back
    // ok:true and the renderer threw inside a promise the CLI does not catch —
    // an unhandled rejection rather than a message.
    for (const data of [null, 5, 'text', true]) {
      const f = spy(200, { data });
      const result = await client(f.impl).status('lpr_1');
      expect(result.ok, JSON.stringify(data)).toBe(false);
      if (result.ok) continue;
      expect(result.kind).toBe('invalid_response');
    }
  });

  it('a real data object still passes', async () => {
    const f = spy(200, { data: { runId: 'lpr_1' } });
    const result = await client(f.impl).status('lpr_1');
    expect(result.ok).toBe(true);
  });

  it('redacts token-shaped text a server sent back', async () => {
    const f = spy(400, { kind: 'validation_failed', error: `bad request for ${TOKEN}` });
    const result = await client(f.impl).status('lpr_1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).not.toContain(TOKEN);
  });
});

describe('the control route', () => {
  it('POSTs the action with the caller’s request id', async () => {
    const f = spy(200, { data: { runId: 'lpr_1' } });
    await client(f.impl).control({ runId: 'lpr_1', action: 'stop', requestId: 'req-9', reason: null });
    const [call] = f.calls;
    expect(call?.url).toBe(`${URL_BASE}/relay-api/loop/stop/lpr_1`);
    expect(call?.init.method).toBe('POST');
    expect(JSON.parse(String(call?.init.body))).toEqual({ requestId: 'req-9', reason: null });
  });

  it('times out as a timeout, not as a refusal', async () => {
    const impl = (async (_url: string, init: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    })) as unknown as typeof fetch;
    const result = await createLoopBridgeClient({
      bridgeUrl: URL_BASE, token: TOKEN, fetchImpl: impl, timeoutMs: 20,
    }).status('lpr_1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe('timeout');
  }, 30_000);
});

describe('what it never does', () => {
  it('has no branch that could synthesise a status', async () => {
    // A client that invents `state: "running"` on a failed read is the whole
    // failure mode this layer exists to make impossible. Asserted structurally
    // as well as behaviourally: no Loop state word is written in this module.
    const source = await import('node:fs').then((fs) => fs.readFileSync(
      new URL('./loop-bridge-client.ts', import.meta.url), 'utf8',
    ));
    const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
    for (const word of ['running', 'completed', 'paused', 'stopped', 'failed']) {
      expect(code, `the client must not write the run state "${word}"`)
        .not.toMatch(new RegExp(`['"\`]${word}['"\`]`));
    }
  });

  it('reads capability without sending a body', async () => {
    const f = spy(200, { data: { loopEngineEnabled: false, supportedRoles: [] } });
    const result = await client(f.impl).capability();
    expect(result.ok).toBe(true);
    expect(f.calls[0]?.init.body).toBeUndefined();
    expect(f.calls[0]?.init.method).toBe('GET');
  });
});

// Keeps `vi` referenced when the suite is filtered to a subset.
void vi;
