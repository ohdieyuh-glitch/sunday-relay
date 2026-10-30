import { describe, expect, it } from 'vitest';

import { createCursorCloudAgentsTransport, type CursorFetch } from './cursor-cloud-agents-transport';
import { captureCursorRunStream, createMemoryEvidenceSink } from './cursor-run-stream-evidence';

/*
 * PILOT 43b93a4e N-7 (same SSE id, different event name) and M-2 (an id-less mid-run status looks like a start), and
 * Skywalker 43b93a4e N2 (the model is not bound to the evidence file), written failing-first. Fake fetch, sentinel key.
 */
const KEY = 'SENTINEL-KEY-0123456789-never-print';
const AGENT = 'bc-00000000-0000-4000-8000-000000000001';
const RUN = 'run-00000000-0000-0000-0000-000000000001';
const ev = (event: string, data: unknown, id?: string): string => `${id === undefined ? '' : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const START = ev('status', { runId: RUN, status: 'RUNNING' });
const EDIT = ev('tool_call', { callId: 'c1', name: 'edit_file', status: 'completed', args: { path: 'a.txt' } }, '1');
const RESULT = ev('result', { runId: RUN, status: 'FINISHED' }, '2');
const DONE = ev('done', {}, '2');

function setup(sse: string) {
  const fetch: CursorFetch = async (url, init) => {
    if (init.method === 'POST' && url.endsWith('/v1/agents')) {
      const body = JSON.stringify({ agent: { id: AGENT }, run: { id: RUN } });
      return { ok: true, status: 201, headers: { get: () => 'application/json' }, body: new Response(body).body, text: async () => body };
    }
    return { ok: true, status: 200, headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? 'text/event-stream' : null) }, body: new Response(sse).body, text: async () => '' };
  };
  return createCursorCloudAgentsTransport({ fetch, getApiKey: () => KEY });
}
const create = (t: ReturnType<typeof setup>) => t.createRun({ idempotencyKey: 'k', agentId: AGENT, name: 'n', promptText: 'p', modelId: 'composer-1', repoUrl: 'https://github.com/o/r', startingRef: 'a'.repeat(40) });
const header = (lines: readonly string[]): Record<string, unknown> => JSON.parse(lines[0] as string) as Record<string, unknown>;

describe('PILOT N-7: one SSE id under two event names is a conflict', () => {
  it('a tool_call and a status sharing an id are refused', async () => {
    const t = setup([START, EDIT, ev('status', { runId: RUN, status: 'RUNNING' }, '1'), RESULT, DONE].join(''));
    const r = await captureCursorRunStream({ transport: t, ref: { agentId: AGENT, runId: RUN }, sink: createMemoryEvidenceSink(), deadlineAtMs: Date.now() + 60_000 });
    expect(r.cause).toBe('e2_stream_conflicting_event');
  });
  it('done may carry the id of the result it closes (the documented shape) and still completes', async () => {
    const t = setup([START, EDIT, RESULT, DONE].join(''));
    expect((await captureCursorRunStream({ transport: t, ref: { agentId: AGENT, runId: RUN }, sink: createMemoryEvidenceSink(), deadlineAtMs: Date.now() + 60_000 })).cause).toBeNull();
  });
});

describe('PILOT M-2 / Skywalker N2: where the run came from, and its model, are recorded in the file', () => {
  it('a run this transport created is recorded as created_by_this_transport with the model it asked for', async () => {
    const t = setup([START, EDIT, RESULT, DONE].join(''));
    const c = await create(t);
    if (c.kind !== 'created') throw new Error(c.kind);
    const sink = createMemoryEvidenceSink();
    const r = await captureCursorRunStream({ transport: t, ref: c.ref, sink, deadlineAtMs: Date.now() + 60_000 });
    expect(r.cause).toBeNull();
    expect(header(sink.lines)).toMatchObject({ start: 'created_by_this_transport', requestedModelId: 'composer-1' });
    expect(r.start).toBe('created_by_this_transport');
  });
  it('a ref the transport did not create (attached mid-run, id-less RUNNING status) is recorded as unproven, model null', async () => {
    const t = setup([START, EDIT, RESULT, DONE].join(''));
    const sink = createMemoryEvidenceSink();
    const r = await captureCursorRunStream({ transport: t, ref: { agentId: AGENT, runId: RUN }, sink, deadlineAtMs: Date.now() + 60_000 });
    expect(header(sink.lines)).toMatchObject({ start: 'unproven', requestedModelId: null });
    expect(r.start).toBe('unproven');
  });
  it('a copied ref object with the same ids from another transport is unproven', async () => {
    const a = setup([START, EDIT, RESULT, DONE].join(''));
    const c = await create(a);
    if (c.kind !== 'created') throw new Error(c.kind);
    const b = setup([START, EDIT, RESULT, DONE].join(''));
    const sink = createMemoryEvidenceSink();
    await captureCursorRunStream({ transport: b, ref: { ...c.ref }, sink, deadlineAtMs: Date.now() + 60_000 });
    expect(header(sink.lines)).toMatchObject({ start: 'unproven' });
  });
});
