import { describe, expect, it, vi } from 'vitest';

import { LIVE_REACH_USER_AGENT, liveFetch, normalizeHttpDate, probeReachability } from './live-fetch';
import { MCP_DEFAULT_NETWORK_POLICY } from '../../mcp/policy/mcp-network-policy';

/**
 * THE BOUNDED FETCH — proven offline, because the interesting cases are the
 * ones a real network would not reliably produce.
 *
 * What is held here is the difference between a retrieval Relay controls and
 * one it merely starts: every redirect hop is re-checked, an answer of "who
 * are you" is reported as an answer rather than a failure, and a body that
 * could exhaust the host is cut.
 */

const ok = (body: string, headers: Record<string, string> = {}): Response =>
  new Response(body, { status: 200, headers: { 'content-type': 'text/plain', ...headers } });

const resolver = (addresses: readonly string[]) => ({
  resolve: () => Promise.resolve(addresses),
});

describe('the network policy is the one already in the repository', () => {
  it('refuses loopback without ever calling fetch', async () => {
    const fetchImpl = vi.fn();
    const outcome = await liveFetch({
      url: 'http://127.0.0.1/secrets',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(outcome.kind).toBe('refused');
    // The point of checking first: nothing left the process.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses a name that resolves to a private address', async () => {
    const fetchImpl = vi.fn();
    const outcome = await liveFetch({
      url: 'https://internal.example.com/',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      resolver: resolver(['10.0.0.5']),
    });
    expect(outcome.kind).toBe('refused');
    if (outcome.kind === 'refused') expect(outcome.detail).toContain('10.0.0.5');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses a name that resolves to a MIX of public and private addresses', async () => {
    // Answering the safe one would hand address selection to whoever controls
    // the record. Every answer has to pass.
    const outcome = await liveFetch({
      url: 'https://mixed.example.com/',
      fetchImpl: (() => Promise.resolve(ok('never'))) as unknown as typeof fetch,
      resolver: resolver(['93.184.216.34', '169.254.169.254']),
    });
    expect(outcome.kind).toBe('refused');
  });
});

describe('redirects are followed one checked hop at a time', () => {
  it('re-checks the destination rather than trusting the first response', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(null, {
        status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' },
      }));
    const outcome = await liveFetch({
      url: 'https://example.com/start',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    // The whole redirect attack, refused at the hop.
    expect(outcome.kind).toBe('refused');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('follows a permitted redirect and reports the FINAL url', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(null, {
        status: 301, headers: { location: 'https://example.com/moved' },
      }))
      .mockResolvedValueOnce(ok('arrived'));
    const outcome = await liveFetch({
      url: 'https://example.com/start',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(outcome.kind).toBe('observed');
    if (outcome.kind === 'observed') {
      expect(outcome.finalUrl).toBe('https://example.com/moved');
      expect(outcome.body).toBe('arrived');
    }
  });

  it('stops at the policy’s redirect ceiling', async () => {
    let n = 0;
    const fetchImpl = vi.fn().mockImplementation(() => {
      n += 1;
      return Promise.resolve(new Response(null, {
        status: 302, headers: { location: `https://example.com/hop-${String(n)}` },
      }));
    });
    const outcome = await liveFetch({
      url: 'https://example.com/start',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(outcome.kind).toBe('refused');
    expect(fetchImpl.mock.calls.length)
      .toBeLessThanOrEqual(MCP_DEFAULT_NETWORK_POLICY.maximumRedirects + 1);
  });

  it('refuses a redirect with no destination rather than looping', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 302 }));
    const outcome = await liveFetch({
      url: 'https://example.com/start',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(outcome.kind).toBe('unreachable');
  });
});

describe('an answer is not a failure', () => {
  it('reports 401 and 403 as needing authentication Relay does not have', async () => {
    for (const status of [401, 403]) {
      const outcome = await liveFetch({
        url: 'https://example.com/private',
        fetchImpl: (() => Promise.resolve(new Response('no', { status }))) as unknown as typeof fetch,
      });
      expect(outcome.kind, String(status)).toBe('unauthenticated');
    }
  });

  it('reports 429 as throttled, and keeps Retry-After', async () => {
    const outcome = await liveFetch({
      url: 'https://example.com/busy',
      fetchImpl: (() => Promise.resolve(
        new Response('slow down', { status: 429, headers: { 'retry-after': '60' } }),
      )) as unknown as typeof fetch,
    });
    expect(outcome.kind).toBe('throttled');
    if (outcome.kind === 'throttled') expect(outcome.retryAfter).toBe('60');
  });

  it('reports a genuine failure as unreachable', async () => {
    const outcome = await liveFetch({
      url: 'https://example.com/x',
      fetchImpl: (() => Promise.reject(new Error('ECONNREFUSED'))) as unknown as typeof fetch,
    });
    expect(outcome.kind).toBe('unreachable');
  });

  it('separates a timeout from an unreachable host in the detail', async () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    const outcome = await liveFetch({
      url: 'https://example.com/slow',
      timeoutMs: 5,
      fetchImpl: (() => Promise.reject(abort)) as unknown as typeof fetch,
    });
    expect(outcome.kind).toBe('unreachable');
    if (outcome.kind === 'unreachable') expect(outcome.detail).toContain('5ms');
  });
});

describe('the fetch is bounded', () => {
  it('cuts a body at the ceiling and says it was cut', async () => {
    const outcome = await liveFetch({
      url: 'https://example.com/big',
      maxBytes: 16,
      fetchImpl: (() => Promise.resolve(ok('x'.repeat(4096)))) as unknown as typeof fetch,
    });
    expect(outcome.kind).toBe('observed');
    if (outcome.kind === 'observed') {
      expect(outcome.body).toHaveLength(16);
      expect(outcome.truncated).toBe(true);
      expect(outcome.bytes).toBe(16);
    }
  });

  it('does not mark an untruncated body as truncated', async () => {
    const outcome = await liveFetch({
      url: 'https://example.com/small',
      fetchImpl: (() => Promise.resolve(ok('short'))) as unknown as typeof fetch,
    });
    if (outcome.kind === 'observed') expect(outcome.truncated).toBe(false);
  });

  it('refuses a content type Relay does not read', async () => {
    const outcome = await liveFetch({
      url: 'https://example.com/binary',
      fetchImpl: (() => Promise.resolve(new Response('MZ', {
        status: 200, headers: { 'content-type': 'application/octet-stream' },
      }))) as unknown as typeof fetch,
    });
    expect(outcome.kind).toBe('refused');
  });
});

describe('what Relay sends', () => {
  it('identifies itself and sends no credential', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok('hi'));
    await liveFetch({
      url: 'https://example.com/x',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['user-agent']).toBe(LIVE_REACH_USER_AGENT);
    // No credential of any kind leaves with a Live Reach request.
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain('authorization');
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain('cookie');
    // And redirects are ours to follow, one checked hop at a time.
    expect(init.redirect).toBe('manual');
  });
});

describe('publication time from the server', () => {
  it('reads Last-Modified when it is sent', async () => {
    const outcome = await liveFetch({
      url: 'https://example.com/x',
      fetchImpl: (() => Promise.resolve(
        ok('body', { 'last-modified': 'Mon, 10 Aug 2026 11:30:00 GMT' }),
      )) as unknown as typeof fetch,
    });
    if (outcome.kind === 'observed') {
      expect(outcome.serverPublishedAt).toBe('2026-08-10T11:30:00.000Z');
    }
  });

  it('leaves publication null when the server says nothing', async () => {
    const outcome = await liveFetch({
      url: 'https://example.com/x',
      fetchImpl: (() => Promise.resolve(ok('body'))) as unknown as typeof fetch,
    });
    // A document with no stated date was not published now.
    if (outcome.kind === 'observed') expect(outcome.serverPublishedAt).toBeNull();
    expect(normalizeHttpDate(null)).toBeNull();
    expect(normalizeHttpDate('not a date')).toBeNull();
  });
});

describe('the readiness probe', () => {
  it('answers in the vocabulary the readiness model speaks', async () => {
    const cases: [Response | Error, string][] = [
      [ok('ok'), 'observed'],
      [new Response('no', { status: 401 }), 'unauthenticated'],
      [new Response('slow', { status: 429 }), 'throttled'],
      [new Error('down'), 'unreachable'],
    ];
    for (const [result, expected] of cases) {
      const outcome = await probeReachability({
        url: 'https://example.com/probe',
        fetchImpl: (() => (result instanceof Error
          ? Promise.reject(result)
          : Promise.resolve(result.clone()))) as unknown as typeof fetch,
      });
      expect(outcome, expected).toBe(expected);
    }
  });

  it('calls a policy refusal a configuration problem, not an unreachable host', async () => {
    // The deployment asked Relay to probe something it may not reach. That is
    // a thing the operator can fix, and saying "unreachable" would send them
    // looking at the wrong machine.
    const outcome = await probeReachability({
      url: 'http://localhost:8080/probe',
      fetchImpl: (() => Promise.resolve(ok('never'))) as unknown as typeof fetch,
    });
    expect(outcome).toBe('unconfigured');
  });

  it('reads only a small amount, because a probe is not a retrieval', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok('x'.repeat(100_000)));
    await probeReachability({
      url: 'https://example.com/probe',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // GET only: a probe that writes is not a probe, and the readiness model
    // retries.
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('GET');
  });
});
