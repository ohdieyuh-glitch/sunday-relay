import { describe, expect, it } from 'vitest';

import { createCursorCloudAgentsTransport, cursorGlobalFetch, openCursorRunStream, type CursorFetch } from './cursor-cloud-agents-transport';

/**
 * E2 PART A, THE OPENER: `GET /v1/agents/{id}/runs/{runId}/stream` through the existing transport, against a FAKE fetch.
 * No request leaves the process; the "key" is a sentinel. Shapes from https://cursor.com/docs/cloud-agent/api/endpoints.md
 * ("Stream A Run"); every value here is fake.
 */

const KEY = 'SENTINEL-KEY-0123456789-never-print';
const REF = { agentId: 'bc-00000000-0000-4000-8000-000000000001', runId: 'run-abc' };
type Seen = { url: string; headers: Readonly<Record<string, string>>; redirect: string; method: string };
type Reply = { status: number; headers?: Record<string, string>; body?: string } | 'throw';

function harness(route: (n: number) => Reply, over: { getApiKey?: () => string | null; requestTimeoutMs?: number } = {}) {
  const seen: Seen[] = [];
  const fetch: CursorFetch = async (url, init) => {
    seen.push({ url, headers: init.headers, redirect: init.redirect, method: init.method });
    const r = route(seen.length);
    if (r === 'throw') throw new Error(`reset ${init.headers.Authorization}`);
    const h = Object.fromEntries(Object.entries(r.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    const bytes = new TextEncoder().encode(r.body ?? '');
    return {
      ok: r.status >= 200 && r.status < 300, status: r.status,
      headers: { get: (n: string) => h[n.toLowerCase()] ?? null },
      body: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes); c.close(); } }),
      text: async () => r.body ?? '',
    };
  };
  let t = 0;
  const sleeps: number[] = [];
  const lines: string[] = [];
  const transport = createCursorCloudAgentsTransport({ fetch, getApiKey: over.getApiKey ?? (() => KEY), now: () => t, sleep: async (ms) => { sleeps.push(ms); t += ms; }, log: (l) => lines.push(l), requestTimeoutMs: over.requestTimeoutMs ?? 50 });
  return { transport, seen, sleeps, lines };
}
const ok = (headers: Record<string, string> = {}): Reply => ({ status: 200, headers: { 'Content-Type': 'text/event-stream', ...headers }, body: 'event: status\ndata: {}\n\n' });

describe('E2 opener: the run stream through the existing transport', () => {
  it('sends one GET to the pinned stream URL with the key in one header, Accept text/event-stream, redirects refused', async () => {
    const h = harness(() => ok({ 'X-Cursor-Stream-Retention-Seconds': '3600' }));
    const r = await openCursorRunStream(h.transport, REF, null, { deadlineAtMs: 60_000 });
    expect(r.kind).toBe('opened');
    if (r.kind !== 'opened') return;
    expect(h.seen).toEqual([{ url: `https://api.cursor.com/v1/agents/${REF.agentId}/runs/${REF.runId}/stream`, method: 'GET', redirect: 'error', headers: { Authorization: `Bearer ${KEY}`, Accept: 'text/event-stream' } }]);
    expect(r.retentionSeconds).toBe('3600');
    expect(r.contentType).toBe('text/event-stream');
    expect(r.mode).toBe('fake');
    expect(r.body).not.toBeNull();
    r.close();
    r.close();
    expect(JSON.stringify(r)).not.toContain('SENTINEL');
  });
  it('resumes with Last-Event-ID exactly as given', async () => {
    const h = harness(() => ok());
    const r = await openCursorRunStream(h.transport, REF, '1713033006000-0', { deadlineAtMs: 60_000 });
    expect(r.kind).toBe('opened');
    expect(h.seen[0]?.headers['Last-Event-ID']).toBe('1713033006000-0');
  });
  it('a malformed or absent retention header is null, never a guess', async () => {
    for (const v of ['', 'soon', '-1', '1e9', '12 34', '1234567890']) {
      const r = await openCursorRunStream(harness(() => ok({ 'X-Cursor-Stream-Retention-Seconds': v })).transport, REF, null, { deadlineAtMs: 60_000 });
      expect(r.kind === 'opened' && r.retentionSeconds, v).toBeNull();
    }
    const r = await openCursorRunStream(harness(() => ok({ 'X-Cursor-Stream-Retention-Seconds': ' 600 ' })).transport, REF, null, { deadlineAtMs: 60_000 });
    expect(r.kind === 'opened' && r.retentionSeconds).toBe('600');
    const none = await openCursorRunStream(harness(() => ok()).transport, REF, null, { deadlineAtMs: 60_000 });
    expect(none.kind === 'opened' && none.retentionSeconds).toBeNull();
  });
  it('sends nothing: a transport this module did not build, a bad ref, a bad or key-carrying Last-Event-ID, no key, an aborted signal', async () => {
    const h = harness(() => ok());
    const handMade = { transportKind: 'cursor_cloud_agents_v1', createRun: async () => ({ kind: 'not_sent', cause: 'x' }) };
    expect(await openCursorRunStream(handMade, REF, null, { deadlineAtMs: 1 })).toEqual({ kind: 'not_sent', cause: 'transport_unknown' });
    expect(await openCursorRunStream({ ...h.transport }, REF, null, { deadlineAtMs: 1 })).toEqual({ kind: 'not_sent', cause: 'transport_unknown' });
    expect(await openCursorRunStream(null, REF, null, { deadlineAtMs: 1 })).toEqual({ kind: 'not_sent', cause: 'transport_unknown' });
    for (const ref of [{ ...REF, runId: '../x' }, { ...REF, agentId: '' }, { ...REF, runId: 'a b' }]) {
      expect(await openCursorRunStream(h.transport, ref, null, { deadlineAtMs: 1 }), JSON.stringify(ref)).toEqual({ kind: 'not_sent', cause: 'ref_invalid' });
    }
    for (const id of ['', 'a b', 'x\ny', 'é', 'x'.repeat(257), `id-${KEY}`, `id-${Buffer.from(KEY).toString('hex').slice(0, 20)}`]) {
      expect(await openCursorRunStream(h.transport, REF, id, { deadlineAtMs: 1 }), id).toEqual({ kind: 'not_sent', cause: 'last_event_id_invalid' });
    }
    expect(await openCursorRunStream(harness(() => ok(), { getApiKey: () => null }).transport, REF, null, { deadlineAtMs: 1 })).toEqual({ kind: 'not_sent', cause: 'key_absent' });
    const ac = new AbortController();
    ac.abort();
    expect(await openCursorRunStream(h.transport, REF, null, { deadlineAtMs: 1, signal: ac.signal })).toEqual({ kind: 'not_sent', cause: 'aborted' });
    expect(h.seen).toEqual([]);
    expect(await openCursorRunStream(h.transport, REF, 'x'.repeat(256), { deadlineAtMs: 1 })).toMatchObject({ kind: 'opened' });
  });
  it('410 stream_expired, 400 invalid_last_event_id and 401 come back as a status only; the body is dropped', async () => {
    for (const status of [410, 400, 401, 404, 500, 304, 302, 199]) {
      const h = harness(() => ({ status, body: JSON.stringify({ code: 'stream_expired', message: `echo ${KEY}` }) }));
      const r = await openCursorRunStream(h.transport, REF, null, { deadlineAtMs: 60_000 });
      expect(r).toEqual({ kind: 'status', status });
    }
  });
  it('429 waits (Retry-After, else the backoff, doubling each time as for polls) and tries again, never past the deadline', async () => {
    const h = harness((n) => (n === 1 ? { status: 429, headers: { 'Retry-After': '7' } } : n === 2 ? { status: 429 } : ok()));
    const r = await openCursorRunStream(h.transport, REF, null, { deadlineAtMs: 60_000 });
    expect(r.kind).toBe('opened');
    expect(h.sleeps).toEqual([7_000, 20_000]);
    expect(h.lines).toEqual(['cursor-transport stream rate-limited wait_ms=7000', 'cursor-transport stream rate-limited wait_ms=20000']);
    const late = harness(() => ({ status: 429 }));
    expect(await openCursorRunStream(late.transport, REF, null, { deadlineAtMs: 25_000 })).toEqual({ kind: 'deadline' });
    expect(late.sleeps).toEqual([10_000]);
    expect(late.seen.length).toBe(2);
  });
  it('a network failure or a stall before headers is reported without the error text', async () => {
    const h = harness(() => 'throw');
    expect(await openCursorRunStream(h.transport, REF, null, { deadlineAtMs: 60_000 })).toEqual({ kind: 'failed_in_flight', cause: 'network' });
    const stall: CursorFetch = (_u, init) => new Promise((_, reject) => { init.signal?.addEventListener('abort', () => reject(new Error('stalled'))); });
    const t = createCursorCloudAgentsTransport({ fetch: stall, getApiKey: () => KEY, requestTimeoutMs: 5 });
    expect(await openCursorRunStream(t, REF, null, { deadlineAtMs: Date.now() + 60_000 })).toEqual({ kind: 'failed_in_flight', cause: 'timeout' });
    const ac = new AbortController();
    const p = openCursorRunStream(createCursorCloudAgentsTransport({ fetch: stall, getApiKey: () => KEY, requestTimeoutMs: 60_000 }), REF, null, { deadlineAtMs: Date.now() + 60_000, signal: ac.signal });
    setTimeout(() => ac.abort(), 5);
    expect(await p).toEqual({ kind: 'failed_in_flight', cause: 'aborted_in_flight' });
  });
  it('the opened stream is not cut by the header timeout, and close() or the caller\'s abort ends it', async () => {
    let sig: AbortSignal | undefined;
    const fetch: CursorFetch = async (_u, init) => { sig = init.signal; return { ok: true, status: 200, headers: { get: () => null }, body: null, text: async () => '' }; };
    const t = createCursorCloudAgentsTransport({ fetch, getApiKey: () => KEY, requestTimeoutMs: 5 });
    const ac = new AbortController();
    const r = await openCursorRunStream(t, REF, null, { deadlineAtMs: Date.now() + 60_000, signal: ac.signal });
    await new Promise((res) => setTimeout(res, 20));
    expect(sig?.aborted).toBe(false);
    ac.abort();
    expect(sig?.aborted).toBe(true);
    const r2 = await openCursorRunStream(t, REF, null, { deadlineAtMs: Date.now() + 60_000 });
    expect(r.kind).toBe('opened');
    if (r2.kind === 'opened') { expect(sig?.aborted).toBe(false); r2.close(); expect(sig?.aborted).toBe(true); }
  });
  it('the scrubber is bound to the key that was sent: patterns redact; surviving key characters are residue', async () => {
    const r = await openCursorRunStream(harness(() => ok()).transport, REF, null, { deadlineAtMs: 60_000 });
    if (r.kind !== 'opened') throw new Error('not opened');
    expect(r.scrub('plain')).toEqual({ kind: 'clean', text: 'plain', scrubbed: false });
    expect(r.scrub(`a ${KEY} b`)).toEqual({ kind: 'clean', text: 'a [REDACTED] b', scrubbed: true });
    expect(r.scrub(`a ${Buffer.from(KEY).toString('base64')} b`)).toEqual({ kind: 'clean', text: 'a [REDACTED] b', scrubbed: true });
    expect(r.scrub(KEY.split('').join('  '))).toEqual({ kind: 'residue' });
    expect(r.scrub([...KEY].reverse().join(''))).toEqual({ kind: 'residue' });
  });
  it('a live transport whose global fetch was replaced opens nothing and is fake from then on', async () => {
    const live = createCursorCloudAgentsTransport({ fetch: cursorGlobalFetch, getApiKey: () => KEY });
    const orig = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = (async (u: string) => { calls.push(String(u)); throw new Error('no'); }) as typeof fetch;
    try {
      expect(await openCursorRunStream(live, REF, null, { deadlineAtMs: Date.now() + 1_000 })).toEqual({ kind: 'not_sent', cause: 'transport_untrusted' });
    } finally { globalThis.fetch = orig; }
    expect(calls).toEqual([]);
    const { cursorTransportMode } = await import('./cursor-cloud-agents-transport');
    expect(cursorTransportMode(live)).toBe('fake');
  });
});
