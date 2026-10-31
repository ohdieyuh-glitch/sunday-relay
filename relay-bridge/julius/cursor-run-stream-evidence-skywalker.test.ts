import { describe, expect, it } from 'vitest';

import { createCursorCloudAgentsTransport, openCursorRunStream, type CursorFetch } from './cursor-cloud-agents-transport';
import { captureCursorRunStream, createMemoryEvidenceSink, E2_MAX_RECONNECTS } from './cursor-run-stream-evidence';

/* Skywalker review of 0774db05 (F3 reconnect limit, F3 shared request budget, F4 secrets at the transport scrub, F5 idle
 * timeout), written failing-first. F6 (resume loss) is covered by the PILOT H-1 test: any resume fails closed. */

const KEY = 'SENTINEL-KEY-0123456789-never-print';
const REF = { agentId: 'bc-00000000-0000-4000-8000-000000000001', runId: 'run-00000000-0000-0000-0000-000000000001' };
const ev = (event: string, data: unknown, id?: string): string => `${id === undefined ? '' : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const START = ev('status', { runId: REF.runId, status: 'RUNNING' });
const FULL = [START, ev('tool_call', { callId: 'c1', name: 'read_file', status: 'completed' }, '1713033002000-0'), ev('result', { runId: REF.runId, status: 'FINISHED' }, '1713033010000-0'), ev('done', {}, '1713033010000-0')];
const sse = (chunks: readonly string[]): ReadableStream<Uint8Array> => new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(new TextEncoder().encode(x)); c.close(); } });

function setup(streamFor: (n: number) => ReadableStream<Uint8Array>, realClock = false) {
  const urls: string[] = [];
  let streams = 0;
  const fetch: CursorFetch = async (url) => {
    urls.push(url);
    if (url.endsWith('/stream')) {
      streams += 1;
      return { ok: true, status: 200, headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? 'text/event-stream' : null) }, body: streamFor(streams), text: async () => '' };
    }
    return { ok: false, status: 404, headers: { get: () => null }, body: null, text: async () => '{}' };
  };
  let t = Date.parse('2026-10-30T18:00:00.000Z');
  const now = realClock ? Date.now : () => t;
  const sleep = realClock ? undefined : async (ms: number) => { t += ms; };
  const transport = createCursorCloudAgentsTransport({ fetch, getApiKey: () => KEY, now, ...(sleep === undefined ? {} : { sleep }) });
  return { transport, urls, now, sleep };
}

describe('Skywalker 0774db05: stream limits and scrub', () => {
  it('F3: the reconnect count is bounded whatever the caller asks, with a named cause', async () => {
    const s = setup(() => sse([START]));
    const r = await captureCursorRunStream({ transport: s.transport, ref: REF, sink: createMemoryEvidenceSink(), now: s.now, sleep: s.sleep!, deadlineAtMs: s.now() + 3_600_000, maxReconnects: 50 });
    expect(r.cause).toBe('e2_stream_reconnect_limit');
    expect(E2_MAX_RECONNECTS).toBeLessThanOrEqual(10);
    expect(r.connections).toBe(E2_MAX_RECONNECTS + 1);
  });
  it('F3: the ~20 requests/minute budget is shared with the transport\'s other calls; exhausted gives a named cause', async () => {
    const s = setup((n) => sse(n === 1 ? [START] : FULL));
    while (s.urls.length < 19) await s.transport.fetchResult(REF);
    expect(s.urls.length).toBe(19);
    const r = await captureCursorRunStream({ transport: s.transport, ref: REF, sink: createMemoryEvidenceSink(), now: s.now, sleep: s.sleep!, deadlineAtMs: s.now() + 3_600_000 });
    expect(r.cause).toBe('e2_stream_rate_budget');
    expect(s.urls.length).toBe(20);
    /* Control: the same capture on a fresh transport reconnects and completes. */
    const fresh = setup((n) => sse(n === 1 ? [START] : FULL));
    expect((await captureCursorRunStream({ transport: fresh.transport, ref: REF, sink: createMemoryEvidenceSink(), now: fresh.now, sleep: fresh.sleep!, deadlineAtMs: fresh.now() + 3_600_000 })).cause).toBeNull();
  });
  it('F5: an idle connection (no bytes after the start) is cut by the idle timeout, well before the overall deadline', async () => {
    const s = setup(() => new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode(START)); } }), true);
    const t0 = Date.now();
    const r = await captureCursorRunStream({ transport: s.transport, ref: REF, sink: createMemoryEvidenceSink(), deadlineAtMs: Date.now() + 60_000, idleTimeoutMs: 400 });
    expect(r.cause).toBe('e2_stream_idle');
    expect(Date.now() - t0).toBeLessThan(1_500);
  });
  it('F4: the transport\'s stream scrub also removes non-Cursor secrets (sk-ant-, xai-, AKIA, org-) and counts them', async () => {
    const s = setup(() => sse(FULL));
    const open = await openCursorRunStream(s.transport, REF, null, { deadlineAtMs: s.now() + 60_000 });
    expect(open.kind).toBe('opened');
    if (open.kind !== 'opened') return;
    const secrets = ['sk-ant-api03-' + 'abcdefghijklmnopqrstuvwxyzAB', 'xai-' + 'abcdefghijklmnopqrstuvwxyz', 'AKIA' + 'IOSFODNN7EXAMPLE', 'org-' + 'abcdefghijklmnopqrstuvwx'];
    const out = open.scrub(`args ${secrets.join(' and ')} end`);
    open.close();
    expect(out.kind).toBe('clean');
    if (out.kind !== 'clean') return;
    for (const x of secrets) expect(out.text).not.toContain(x);
    expect(out.secrets).toBe(4);
    expect(out.scrubbed).toBe(true);
  });
});
