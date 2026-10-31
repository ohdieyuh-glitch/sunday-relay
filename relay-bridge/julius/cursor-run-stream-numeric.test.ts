import { describe, expect, it } from 'vitest';

import { createCursorCloudAgentsTransport, openCursorRunStream, type CursorFetch } from './cursor-cloud-agents-transport';
import { captureCursorRunStream, createMemoryEvidenceSink } from './cursor-run-stream-evidence';

/* Skywalker 43b93a4e N1 (NaN and non-finite settings fail open) and L4 Q33 (the 20/min cap), written failing-first. */

const KEY = 'SENTINEL-KEY-0123456789-never-print';
const REF = { agentId: 'bc-00000000-0000-4000-8000-000000000001', runId: 'run-00000000-0000-0000-0000-000000000001' };
const ev = (event: string, data: unknown, id?: string): string => `${id === undefined ? '' : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const FULL = [ev('status', { runId: REF.runId, status: 'RUNNING' }), ev('tool_call', { callId: 'c1', name: 'edit_file', status: 'completed', args: { path: 'a.txt' } }, '1'), ev('result', { runId: REF.runId, status: 'FINISHED' }, '2'), ev('done', {}, '3')].join('');

function setup(body: () => ReadableStream<Uint8Array> | null, opts: Record<string, unknown> = {}) {
  let streams = 0;
  const fetch: CursorFetch = async () => {
    streams += 1;
    return { ok: true, status: 200, headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? 'text/event-stream' : null) }, body: body(), text: async () => '' };
  };
  let t = Date.parse('2026-10-30T18:00:00.000Z');
  const now = (): number => t;
  const sleep = async (ms: number): Promise<void> => { t += Number.isFinite(ms) ? ms : 0; };
  const transport = createCursorCloudAgentsTransport({ fetch, getApiKey: () => KEY, now, sleep, ...opts });
  return { transport, now, sleep, opens: () => streams };
}
const sse = (s: string): ReadableStream<Uint8Array> => new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(s)); c.close(); } });

describe('Skywalker N1: non-finite numeric settings never fail open', () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1, 0, 100]) {
    it(`requestsPerMinute ${bad}: at most 20 stream opens per minute`, async () => {
      const s = setup(() => null, { requestsPerMinute: bad });
      const kinds: string[] = [];
      for (let i = 0; i < 25; i += 1) {
        const o = await openCursorRunStream(s.transport, REF, null, { deadlineAtMs: s.now() + 60_000 });
        kinds.push(o.kind === 'not_sent' ? o.cause : o.kind);
        if (o.kind === 'opened') o.close();
      }
      expect(s.opens()).toBeLessThanOrEqual(20);
      expect(kinds.filter((k) => k === 'rate_budget_exhausted').length).toBeGreaterThanOrEqual(5);
    });
  }
  it('maxStreamBytes NaN keeps the default cap, and a small finite cap still applies', async () => {
    const s = setup(() => sse(FULL));
    const r = await captureCursorRunStream({ transport: s.transport, ref: REF, sink: createMemoryEvidenceSink(), now: s.now, sleep: s.sleep, deadlineAtMs: s.now() + 60_000, maxStreamBytes: Number.NaN });
    expect(r.cause).toBeNull();
    const small = setup(() => sse(FULL));
    const r2 = await captureCursorRunStream({ transport: small.transport, ref: REF, sink: createMemoryEvidenceSink(), now: small.now, sleep: small.sleep, deadlineAtMs: small.now() + 60_000, maxStreamBytes: 10 });
    expect(r2.cause).toBe('e2_stream_too_large');
  });
  it('maxStreamBytes -Infinity is a zero cap (refused), not no cap', async () => {
    const s = setup(() => sse(FULL));
    const r = await captureCursorRunStream({ transport: s.transport, ref: REF, sink: createMemoryEvidenceSink(), now: s.now, sleep: s.sleep, deadlineAtMs: s.now() + 60_000, maxStreamBytes: Number.NEGATIVE_INFINITY });
    expect(r.cause).toBe('e2_stream_too_large');
  });
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
    it(`maxReconnects ${bad} keeps the default (5): 6 connections at most`, async () => {
      const s = setup(() => sse(ev('status', { runId: REF.runId, status: 'RUNNING' })), { requestsPerMinute: 20 });
      const r = await captureCursorRunStream({ transport: s.transport, ref: REF, sink: createMemoryEvidenceSink(), now: s.now, sleep: s.sleep, deadlineAtMs: s.now() + 3_600_000, maxReconnects: bad });
      expect(r.connections).toBeLessThanOrEqual(6);
      expect(r.cause).toBe('e2_stream_reconnect_limit');
    });
  }
  it('reconnectDelayMs NaN keeps the 3000 ms floor', async () => {
    const sleeps: number[] = [];
    const s = setup(() => sse(ev('status', { runId: REF.runId, status: 'RUNNING' })));
    await captureCursorRunStream({ transport: s.transport, ref: REF, sink: createMemoryEvidenceSink(), now: s.now, sleep: async (ms) => { sleeps.push(ms); await s.sleep(ms); }, deadlineAtMs: s.now() + 3_600_000, reconnectDelayMs: Number.NaN, maxReconnects: 2 });
    expect(sleeps.length).toBeGreaterThan(0);
    expect(sleeps.every((ms) => Number.isFinite(ms) && ms >= 3000)).toBe(true);
  });
  it('idleTimeoutMs NaN keeps the default, and a NaN deadline is no capture', async () => {
    const s = setup(() => sse(FULL));
    const r = await captureCursorRunStream({ transport: s.transport, ref: REF, sink: createMemoryEvidenceSink(), deadlineAtMs: Date.now() + 60_000, idleTimeoutMs: Number.NaN });
    expect(r.cause).toBeNull();
    const d = setup(() => sse(FULL));
    const r2 = await captureCursorRunStream({ transport: d.transport, ref: REF, sink: createMemoryEvidenceSink(), now: d.now, sleep: d.sleep, deadlineAtMs: Number.NaN });
    expect(r2.cause).toBe('e2_stream_no_terminal');
  });
  it('transport timings: NaN requestTimeoutMs / rateLimitBackoffMs / pollIntervalMs fall back to defaults (a stream still opens)', async () => {
    const s = setup(() => null, { requestTimeoutMs: Number.NaN, rateLimitBackoffMs: Number.NaN, pollIntervalMs: Number.NaN });
    const o = await openCursorRunStream(s.transport, REF, null, { deadlineAtMs: s.now() + 60_000 });
    expect(o.kind).toBe('opened');
    if (o.kind === 'opened') o.close();
  });
});
