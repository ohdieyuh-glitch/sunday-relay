import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createCursorCloudAgentsTransport, cursorGlobalFetch, type CursorFetch } from './cursor-cloud-agents-transport';
import {
  E2_STREAM_CAUSES, E2_STREAM_LABEL_FAKE, E2_STREAM_LABEL_LIVE, captureCursorRunStream, createFileEvidenceSink, createMemoryEvidenceSink, verifyEvidenceChain,
} from './cursor-run-stream-evidence';

/**
 * E2 PART A, THE CAPTURE: an in-memory SSE fixture served by a FAKE fetch through the real transport. Nothing leaves the
 * process; the "key" is a sentinel. Event names and payloads follow the public docs (Stream A Run); every value is fake.
 */

const KEY = 'SENTINEL-KEY-0123456789-never-print';
const REF = { agentId: 'bc-00000000-0000-4000-8000-000000000001', runId: 'run-00000000-0000-0000-0000-000000000001' };
const ev = (event: string, data: unknown, id?: string): string => `${id === undefined ? '' : `id: ${id}\n`}event: ${event}\ndata: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`;
const START = ev('status', { runId: REF.runId, status: 'RUNNING' });
const READ_RUN = ev('tool_call', { callId: 'call-1', name: 'read_file', status: 'running', args: { path: 'README.md' } }, '1713033005000-0');
const READ_DONE = ev('tool_call', { callId: 'call-1', name: 'read_file', status: 'completed', args: { path: 'README.md' }, result: { success: { content: '# Project' } } }, '1713033006000-0');
const SHELL_DONE = ev('tool_call', { callId: 'call-2', name: 'run_terminal_cmd', status: 'completed', args: { command: 'npm test' }, result: { output: 'ok' } }, '1713033007000-0');
const RESULT = ev('result', { runId: REF.runId, status: 'FINISHED', text: 'done', durationMs: 12357, git: { branches: [{ repoUrl: 'github.com/example-org/t', branch: 'cursor/x' }] } }, '1713033010000-0');
const DONE = ev('done', {}, '1713033010000-0');
const NORMAL = [START, ev('assistant', { text: 'I will' }, '1713033000000-0'), READ_RUN, READ_DONE, ev('heartbeat', {}, '1713033006500-0'), SHELL_DONE, RESULT, DONE];

type Conn = { status?: number; headers?: Record<string, string>; chunks?: readonly (string | Uint8Array)[] } | 'throw';
function serve(conns: readonly Conn[], over: { getApiKey?: () => string | null } = {}) {
  const seen: { url: string; lastEventId: string | null; accept: string | undefined }[] = [];
  const fetch: CursorFetch = async (url, init) => {
    seen.push({ url, lastEventId: init.headers['Last-Event-ID'] ?? null, accept: init.headers.Accept });
    const c = conns[Math.min(seen.length - 1, conns.length - 1)] as Conn;
    if (c === 'throw') throw new Error(`reset ${init.headers.Authorization}`);
    const h: Record<string, string> = { 'content-type': 'text/event-stream', 'x-cursor-stream-retention-seconds': '3600', ...Object.fromEntries(Object.entries(c.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])) };
    const chunks = (c.chunks ?? []).map((x) => (typeof x === 'string' ? new TextEncoder().encode(x) : x));
    const status = c.status ?? 200;
    return {
      ok: status >= 200 && status < 300, status, headers: { get: (n: string) => h[n.toLowerCase()] ?? null },
      body: new ReadableStream<Uint8Array>({ start(ctl) { for (const ch of chunks) ctl.enqueue(ch); ctl.close(); } }),
      text: async () => '',
    };
  };
  let t = Date.parse('2026-10-30T18:00:00.000Z');
  const sleeps: number[] = [];
  const transport = createCursorCloudAgentsTransport({ fetch, getApiKey: over.getApiKey ?? (() => KEY), now: () => t, sleep: async (ms) => { sleeps.push(ms); t += ms; } });
  return { transport, seen, sleeps, now: () => t, sleep: async (ms: number) => { sleeps.push(ms); t += ms; } };
}
async function capture(conns: readonly Conn[], extra: { maxReconnects?: number; deadlineAtMs?: number; signal?: AbortSignal; maxStreamBytes?: number } = {}) {
  const s = serve(conns);
  const sink = createMemoryEvidenceSink();
  const evidence = await captureCursorRunStream({ transport: s.transport, ref: REF, sink, now: s.now, sleep: s.sleep, deadlineAtMs: extra.deadlineAtMs ?? s.now() + 3_600_000, ...(extra.maxReconnects === undefined ? {} : { maxReconnects: extra.maxReconnects }), ...(extra.signal === undefined ? {} : { signal: extra.signal }), ...(extra.maxStreamBytes === undefined ? {} : { maxStreamBytes: extra.maxStreamBytes }) });
  return { evidence, lines: sink.lines, seen: s.seen, sleeps: s.sleeps };
}
const records = (lines: readonly string[]) => lines.map((l) => JSON.parse(l) as Record<string, unknown>);
const events = (lines: readonly string[]) => records(lines).filter((r) => r.kind === 'event').map((r) => r.event);

describe('E2 capture: a hashed, ordered, chained record of the run stream', () => {
  it('normal capture: every event in order, chained, a final hash over the whole record; Cursor\'s report, labelled fake here', async () => {
    const { evidence, lines, seen } = await capture([{ chunks: NORMAL }]);
    expect(evidence.cause).toBeNull();
    expect(seen).toEqual([{ url: `https://api.cursor.com/v1/agents/${REF.agentId}/runs/${REF.runId}/stream`, lastEventId: null, accept: 'text/event-stream' }]);
    expect(events(lines)).toEqual(['status', 'assistant', 'tool_call', 'tool_call', 'heartbeat', 'tool_call', 'result', 'done']);
    const rs = records(lines);
    expect(rs[0]).toMatchObject({ kind: 'header', seq: 0, agentId: REF.agentId, runId: REF.runId, source: 'cursor_platform_report_not_independent_of_cursor' });
    expect(rs.map((r) => r.seq)).toEqual(rs.map((_r, i) => i));
    expect(rs.at(-1)).toMatchObject({ kind: 'final', cause: null, label: E2_STREAM_LABEL_FAKE });
    const ev1 = rs.find((r) => r.kind === 'event' && r.event === 'tool_call') as Record<string, unknown>;
    expect(ev1.rawSha256).toBe(createHash('sha256').update(READ_RUN.replace(/\n\n$/u, '')).digest('hex'));
    expect(ev1.id).toBe('1713033005000-0');
    expect(ev1.receivedAt).toBe('2026-10-30T18:00:00.000Z');
    const v = verifyEvidenceChain(lines);
    expect(v).toEqual({ ok: true, finalHash: evidence.finalHash, records: lines.length });
    expect(evidence).toMatchObject({
      label: E2_STREAM_LABEL_FAKE, mode: 'fake', independentOfCursor: false, records: lines.length, retentionSeconds: '3600', connections: 1,
      duplicatesDropped: 0, partialDiscarded: 0, terminal: { status: 'FINISHED', durationMs: 12357 }, perEventTimestamps: 'not_provided', exitCodes: 'not_provided',
    });
    expect(evidence.fileSha256).toBe(createHash('sha256').update(lines.slice(0, -1).map((l) => `${l}\n`).join('')).digest('hex'));
    expect(evidence.toolCalls).toEqual([
      { callId: 'call-1', name: 'read_file', status: 'completed', keyCall: false, truncatedArgs: false, truncatedResult: false, argsSha256: createHash('sha256').update(JSON.stringify({ path: 'README.md' })).digest('hex'), resultSha256: createHash('sha256').update(JSON.stringify({ success: { content: '# Project' } })).digest('hex') },
      { callId: 'call-2', name: 'run_terminal_cmd', status: 'completed', keyCall: true, truncatedArgs: false, truncatedResult: false, argsSha256: createHash('sha256').update(JSON.stringify({ command: 'npm test' })).digest('hex'), resultSha256: createHash('sha256').update(JSON.stringify({ output: 'ok' })).digest('hex') },
    ]);
    expect(Object.isFrozen(evidence)).toBe(true);
    expect(E2_STREAM_LABEL_LIVE).toBe('cursor_platform_reported');
  });
  it('a tampered, reordered, dropped or appended record breaks the chain', async () => {
    const { lines } = await capture([{ chunks: NORMAL }]);
    const edit = (i: number, f: (r: Record<string, unknown>) => void) => lines.map((l, j) => { if (j !== i) return l; const r = JSON.parse(l) as Record<string, unknown>; f(r); return JSON.stringify(r); });
    expect(verifyEvidenceChain(edit(3, (r) => { r.data = '{"callId":"call-1","name":"write","status":"running"}'; })).ok).toBe(false);
    expect(verifyEvidenceChain([lines[0] as string, lines[2] as string, lines[1] as string, ...lines.slice(3)]).ok).toBe(false);
    expect(verifyEvidenceChain([...lines.slice(0, 3), ...lines.slice(4)]).ok).toBe(false);
    expect(verifyEvidenceChain([...lines, lines.at(-1) as string]).ok).toBe(false);
    expect(verifyEvidenceChain(lines.slice(0, -1)).ok).toBe(false);
    expect(verifyEvidenceChain([]).ok).toBe(false);
    expect(verifyEvidenceChain(['not json']).ok).toBe(false);
    expect(verifyEvidenceChain(edit(lines.length - 1, (r) => { r.fileSha256 = '0'.repeat(64); })).ok).toBe(false);
    expect(verifyEvidenceChain(edit(1, (r) => { r.seq = 7; })).ok).toBe(false);
  });
  it('Last-Event-ID resume after a dropped connection: the replayed range is de-duplicated, nothing is lost', async () => {
    const { evidence, lines, seen, sleeps } = await capture([
      { chunks: [START, READ_RUN, READ_DONE] },
      { chunks: [START, READ_DONE, SHELL_DONE, RESULT, DONE] },
    ]);
    expect(evidence.cause).toBeNull();
    expect(seen.map((s) => s.lastEventId)).toEqual([null, '1713033006000-0']);
    expect(sleeps).toEqual([3_000]);
    expect(events(lines)).toEqual(['status', 'tool_call', 'tool_call', 'status', 'tool_call', 'result', 'done']);
    expect(records(lines).filter((r) => r.kind === 'connection').map((r) => [r.n, r.lastEventId])).toEqual([[1, null], [2, '1713033006000-0']]);
    expect(evidence).toMatchObject({ connections: 2, duplicatesDropped: 1 });
    expect(verifyEvidenceChain(lines).ok).toBe(true);
  });
  it('a dropped connection before any id, after more than the leading status, is a gap', async () => {
    const { evidence } = await capture([{ chunks: [START, ev('assistant', { text: 'x' })] }, { chunks: NORMAL }]);
    expect(evidence.cause).toBe('e2_stream_gap');
  });
  it('a dropped connection after only the leading status reconnects without Last-Event-ID', async () => {
    const { evidence, seen } = await capture([{ chunks: [START] }, { chunks: NORMAL }]);
    expect(evidence.cause).toBeNull();
    expect(seen.map((s) => s.lastEventId)).toEqual([null, null]);
  });
  it('gap: a resume that does not start with status, a 400 invalid_last_event_id, or reconnects exhausted', async () => {
    expect((await capture([{ chunks: [START, READ_RUN] }, { chunks: [READ_DONE, RESULT, DONE] }])).evidence.cause).toBe('e2_stream_gap');
    expect((await capture([{ chunks: [START, READ_RUN] }, { status: 400 }])).evidence.cause).toBe('e2_stream_gap');
    const ex = await capture([{ chunks: [START, READ_RUN] }, { chunks: [START] }], { maxReconnects: 3 });
    expect(ex.evidence.cause).toBe('e2_stream_gap');
    expect(ex.seen.length).toBe(4);
    const net = await capture([{ chunks: [START, READ_RUN] }, 'throw'], { maxReconnects: 2 });
    expect(net.evidence.cause).toBe('e2_stream_gap');
    expect(net.seen.length).toBe(3);
  });
  it('410 stream_expired on open or on resume is e2_stream_expired; never a fallback to the diff', async () => {
    expect((await capture([{ status: 410 }])).evidence.cause).toBe('e2_stream_expired');
    const r = await capture([{ chunks: [START, READ_RUN] }, { status: 410 }]);
    expect(r.evidence.cause).toBe('e2_stream_expired');
    expect(r.evidence.label).toBe(E2_STREAM_LABEL_FAKE);
    expect(verifyEvidenceChain(r.lines).ok).toBe(true);
  });
  it('no start: an empty stream, a first event that is not status, the wrong content type, an open that fails', async () => {
    expect((await capture([{ chunks: [] }])).evidence.cause).toBe('e2_stream_no_start');
    expect((await capture([{ chunks: [READ_RUN, RESULT, DONE] }])).evidence.cause).toBe('e2_stream_no_start');
    expect((await capture([{ headers: { 'content-type': 'application/json' }, chunks: NORMAL }])).evidence.cause).toBe('e2_stream_no_start');
    expect((await capture([{ status: 401 }])).evidence.cause).toBe('e2_stream_open_failed');
    expect((await capture([{ status: 500 }])).evidence.cause).toBe('e2_stream_open_failed');
    expect((await capture(['throw'], { maxReconnects: 0 })).evidence.cause).toBe('e2_stream_open_failed');
  });
  it('missing terminal: done without result, or the deadline before done', async () => {
    expect((await capture([{ chunks: [START, READ_RUN, DONE] }])).evidence.cause).toBe('e2_stream_no_terminal');
    const s = serve([{ chunks: [START, READ_RUN] }]);
    const sink = createMemoryEvidenceSink();
    const e = await captureCursorRunStream({ transport: s.transport, ref: REF, sink, now: s.now, sleep: s.sleep, deadlineAtMs: s.now() + 1_000 });
    expect(e.cause).toBe('e2_stream_no_terminal');
  });
  it('a truncated write/apply/shell call fails closed; a truncated read does not', async () => {
    const trunc = (name: string, which: 'args' | 'result') => ev('tool_call', { callId: 'c9', name, status: 'completed', truncated: { [which]: true } }, '1713033008000-0');
    for (const name of ['edit_file', 'write', 'apply_patch', 'run_terminal_cmd', 'mcp', 'delete_file', 'something_new']) {
      for (const which of ['args', 'result'] as const) {
        const { evidence, lines } = await capture([{ chunks: [START, trunc(name, which), RESULT, DONE] }]);
        expect(evidence.cause, `${name}/${which}`).toBe('e2_stream_truncated_key_call');
        expect(events(lines)).toEqual(['status', 'tool_call']);
      }
    }
    const read = await capture([{ chunks: [START, trunc('read_file', 'result'), RESULT, DONE] }]);
    expect(read.evidence.cause).toBeNull();
    expect(read.evidence.toolCalls[0]).toMatchObject({ name: 'read_file', truncatedResult: true, keyCall: false, resultSha256: null });
  });
  it('the key in event args is scrubbed before writing; key characters that survive fail closed and are never written', async () => {
    const withKey = ev('tool_call', { callId: 'c3', name: 'run_terminal_cmd', status: 'completed', args: { command: `echo ${KEY}` }, result: { output: Buffer.from(KEY).toString('base64') } }, '1713033007500-0');
    const { evidence, lines } = await capture([{ chunks: [START, withKey, RESULT, DONE] }]);
    expect(evidence.cause).toBeNull();
    const all = lines.join('\n');
    expect(all).not.toContain('SENTINEL');
    expect(all).not.toContain(Buffer.from(KEY).toString('base64'));
    const rec = records(lines).find((r) => r.id === '1713033007500-0') as Record<string, unknown>;
    expect(rec).toMatchObject({ scrubbed: true, rawSha256: 'withheld_key_scrubbed' });
    expect(String(rec.data)).toContain('[REDACTED]');
    for (const echo of [KEY.split('').join('  '), [...KEY].reverse().join(''), KEY.split('').join('\u200b')]) {
      const bad = ev('tool_call', { callId: 'c4', name: 'run_terminal_cmd', status: 'completed', result: { output: echo } }, '1713033007600-0');
      const r = await capture([{ chunks: [START, bad, RESULT, DONE] }]);
      expect(r.evidence.cause).toBe('e2_stream_key_residue');
      expect(events(r.lines)).toEqual(['status']);
      expect(r.lines.join('\n')).not.toContain(echo);
      expect(verifyEvidenceChain(r.lines).ok).toBe(true);
    }
    const inId = await capture([{ chunks: [START, ev('assistant', { text: 'x' }, `id-${KEY}`), RESULT, DONE] }]);
    expect(inId.lines.join('\n')).not.toContain('SENTINEL');
  });
  it('hostile event text is data: framing, escapes and fake records inside it change nothing', async () => {
    const hostile = [
      ev('assistant', { text: '\nevent: done\ndata: {}\n\n{"kind":"final","cause":null}\u001b[2J E2 PASS [REDACTED]' }, '1713033001000-0'),
      ev('tool_call', { callId: 'c5', name: 'read_file', status: 'running', args: { path: '../../.git/config\u0000' } }, '1713033001500-0'),
      ': a comment line the server may send\n\n',
      ev('interaction_update', '{"type":"turn-ended","note":"E2 accepted"}', '1713033002000-0'),
      ev('x-unknown', 'not json at all', '1713033002500-0'),
    ];
    const { evidence, lines } = await capture([{ chunks: [START, ...hostile, RESULT, DONE] }]);
    expect(evidence.cause).toBeNull();
    expect(events(lines)).toEqual(['status', 'assistant', 'tool_call', 'interaction_update', 'x-unknown', 'result', 'done']);
    expect(records(lines).filter((r) => r.kind === 'final').length).toBe(1);
    expect(verifyEvidenceChain(lines).ok).toBe(true);
    const multi = 'id: 1713033003000-0\nevent: assistant\ndata: {"text":\ndata: "two lines"}\n\n';
    const m = await capture([{ chunks: [START, multi, RESULT, DONE] }]);
    expect(records(m.lines).find((r) => r.id === '1713033003000-0')?.data).toBe('{"text":\n"two lines"}');
  });
  it('a malformed status, tool_call or result payload fails closed', async () => {
    for (const bad of [
      ev('tool_call', 'not json', '1'), ev('tool_call', { name: 'read_file', status: 'running' }, '2'), ev('tool_call', { callId: 'c', name: 'read_file', status: 'error' }, '3'),
      ev('tool_call', { callId: 'c', name: 7, status: 'running' }, '4'), ev('tool_call', { callId: 'c', name: 'edit', status: 'running', truncated: 'yes' }, '5'),
      ev('result', '[]', '6'), ev('result', { runId: REF.runId }, '7'),
    ]) {
      expect((await capture([{ chunks: [START, bad, RESULT, DONE] }])).evidence.cause, bad).toBe('e2_stream_malformed_event');
    }
    expect((await capture([{ chunks: ['event: status\ndata: nope\n\n', RESULT, DONE] }])).evidence.cause).toBe('e2_stream_malformed_event');
  });
  it('another run\'s status or result is refused', async () => {
    expect((await capture([{ chunks: [ev('status', { runId: 'run-other', status: 'RUNNING' }), RESULT, DONE] }])).evidence.cause).toBe('e2_stream_run_mismatch');
    expect((await capture([{ chunks: [START, ev('result', { runId: 'run-other', status: 'FINISHED' }, '9'), DONE] }])).evidence.cause).toBe('e2_stream_run_mismatch');
  });
  it('a stream error event fails closed and its text is scrubbed', async () => {
    const r = await capture([{ chunks: [START, ev('error', { code: 'internal', message: `boom ${KEY}` }, '1713033004000-0'), DONE] }]);
    expect(r.evidence.cause).toBe('e2_stream_error_event');
    expect(r.lines.join('\n')).not.toContain('SENTINEL');
  });
  it('out-of-order events: a call going back from completed to running, anything after result but done, anything after done', async () => {
    expect((await capture([{ chunks: [START, READ_DONE, ev('tool_call', { callId: 'call-1', name: 'read_file', status: 'running' }, '1713033009000-0'), RESULT, DONE] }])).evidence.cause).toBe('e2_stream_out_of_order');
    expect((await capture([{ chunks: [START, RESULT, SHELL_DONE, DONE] }])).evidence.cause).toBe('e2_stream_out_of_order');
    expect((await capture([{ chunks: [START, RESULT, DONE, SHELL_DONE] }])).evidence.cause).toBe('e2_stream_out_of_order');
    expect((await capture([{ chunks: [START, RESULT, ev('heartbeat', {}, '1713033011000-0'), DONE] }])).evidence.cause).toBeNull();
  });
  it('duplicate ids: an exact replay is dropped; the same id and event with different data, or a call renamed, is a conflict', async () => {
    const replay = await capture([{ chunks: [START, READ_RUN, READ_RUN, RESULT, DONE] }]);
    expect(replay.evidence).toMatchObject({ cause: null, duplicatesDropped: 1 });
    const changed = ev('tool_call', { callId: 'call-1', name: 'read_file', status: 'running', args: { path: 'OTHER.md' } }, '1713033005000-0');
    expect((await capture([{ chunks: [START, READ_RUN, changed, RESULT, DONE] }])).evidence.cause).toBe('e2_stream_conflicting_event');
    const renamed = ev('tool_call', { callId: 'call-1', name: 'edit_file', status: 'completed' }, '1713033006000-0');
    expect((await capture([{ chunks: [START, READ_RUN, renamed, RESULT, DONE] }])).evidence.cause).toBe('e2_stream_conflicting_event');
    const recompleted = ev('tool_call', { callId: 'call-1', name: 'read_file', status: 'completed', result: { other: 1 } }, '1713033006100-0');
    expect((await capture([{ chunks: [START, READ_DONE, recompleted, RESULT, DONE] }])).evidence.cause).toBe('e2_stream_conflicting_event');
    /* The docs' own example gives result and done the same id: different events, not a duplicate. */
    expect((await capture([{ chunks: NORMAL }])).evidence.duplicatesDropped).toBe(0);
  });
  it('partial lines: events split across chunks (and inside a UTF-8 character) are joined; a trailing partial event is discarded and resumed', async () => {
    const whole = NORMAL.join('') + '';
    const bytes = new TextEncoder().encode(whole.replace('I will', 'I will \u00e9\u{1f600}'));
    const pieces: Uint8Array[] = [];
    for (let i = 0; i < bytes.length; i += 1) pieces.push(bytes.slice(i, i + 1));
    const split = await capture([{ chunks: pieces }]);
    expect(split.evidence.cause).toBeNull();
    expect(events(split.lines)).toEqual(['status', 'assistant', 'tool_call', 'tool_call', 'heartbeat', 'tool_call', 'result', 'done']);
    expect(String(records(split.lines).find((r) => r.event === 'assistant')?.data)).toContain('\u00e9\u{1f600}');
    const crlf = await capture([{ chunks: [NORMAL.join('').replace(/\n/gu, '\r\n')] }]);
    expect(crlf.evidence.cause).toBeNull();
    const cut = SHELL_DONE.slice(0, 40);
    const partial = await capture([{ chunks: [START, READ_RUN, READ_DONE, cut] }, { chunks: [START, SHELL_DONE, RESULT, DONE] }]);
    expect(partial.evidence).toMatchObject({ cause: null, partialDiscarded: 1, connections: 2 });
    expect(partial.seen[1]?.lastEventId).toBe('1713033006000-0');
    expect(events(partial.lines)).toEqual(['status', 'tool_call', 'tool_call', 'status', 'tool_call', 'result', 'done']);
  });
  it('large events: under the cap they are captured whole; over the per-event or total cap the capture fails closed', async () => {
    const big = 'x'.repeat(900_000);
    const ok = await capture([{ chunks: [START, ev('tool_call', { callId: 'c6', name: 'read_file', status: 'completed', result: { content: big } }, '1713033007700-0'), RESULT, DONE] }]);
    expect(ok.evidence.cause).toBeNull();
    expect(ok.evidence.toolCalls[0]?.resultSha256).toBe(createHash('sha256').update(JSON.stringify({ content: big })).digest('hex'));
    const huge = await capture([{ chunks: [START, ev('assistant', { text: 'y'.repeat(1_100_000) }, '1713033007800-0'), RESULT, DONE] }]);
    expect(huge.evidence.cause).toBe('e2_stream_event_too_large');
    const noNewline = await capture([{ chunks: [START, `data: ${'z'.repeat(1_100_000)}`] }]);
    expect(noNewline.evidence.cause).toBe('e2_stream_event_too_large');
    const many = Array.from({ length: 70 }, (_v, i) => ev('assistant', { text: 'w'.repeat(1_000) }, `id-${i}`));
    expect((await capture([{ chunks: [START, ...many, RESULT, DONE] }], { maxStreamBytes: 60_000 })).evidence.cause).toBe('e2_stream_too_large');
    expect((await capture([{ chunks: [START, ...many, RESULT, DONE] }], { maxStreamBytes: 200_000 })).evidence.cause).toBeNull();
    /* The cap can only be lowered: asking for more than 64 MiB still means 64 MiB. */
    expect((await capture([{ chunks: [START, ...many, RESULT, DONE] }], { maxStreamBytes: 1e12 })).evidence.cause).toBeNull();
  }, 60_000);
  it('an aborted signal stops the capture as e2_stream_aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    expect((await capture([{ chunks: NORMAL }], { signal: ac.signal })).evidence.cause).toBe('e2_stream_aborted');
  });
  it('a fake transport yields evidence labelled fake; a hand-made transport opens nothing; only a live stamp could be live', async () => {
    const sink = createMemoryEvidenceSink();
    const e = await captureCursorRunStream({ transport: { transportKind: 'cursor_cloud_agents_v1' }, ref: REF, sink, deadlineAtMs: Date.now() + 1_000 });
    expect(e).toMatchObject({ cause: 'e2_stream_open_failed', label: E2_STREAM_LABEL_FAKE, mode: 'fake' });
    const live = createCursorCloudAgentsTransport({ fetch: cursorGlobalFetch, getApiKey: () => null });
    const e2 = await captureCursorRunStream({ transport: live, ref: REF, sink: createMemoryEvidenceSink(), deadlineAtMs: Date.now() + 1_000 });
    expect(e2).toMatchObject({ cause: 'e2_stream_open_failed', label: E2_STREAM_LABEL_FAKE });
  });
  it('the file sink refuses an existing file and appends in order', async () => {
    const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'e2-'));
    try {
      const path = join(dir, 'stream.jsonl');
      const s = serve([{ chunks: NORMAL }]);
      const e = await captureCursorRunStream({ transport: s.transport, ref: REF, sink: createFileEvidenceSink(path), now: s.now, sleep: s.sleep, deadlineAtMs: s.now() + 60_000 });
      const lines = readFileSync(path, 'utf8').split('\n').filter((l) => l !== '');
      expect(verifyEvidenceChain(lines)).toEqual({ ok: true, finalHash: e.finalHash, records: lines.length });
      const again = await captureCursorRunStream({ transport: s.transport, ref: REF, sink: createFileEvidenceSink(path), now: s.now, sleep: s.sleep, deadlineAtMs: s.now() + 60_000 });
      expect(again.cause).toBe('e2_evidence_write_failed');
      expect(readFileSync(path, 'utf8').split('\n').filter((l) => l !== '')).toEqual(lines);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('a call keeps what earlier updates said: args from running, truncation flags', async () => {
    const run = ev('tool_call', { callId: 'c7', name: 'read_file', status: 'running', args: { path: 'a' }, truncated: { result: true } }, '1713033007900-0');
    const done = ev('tool_call', { callId: 'c7', name: 'read_file', status: 'completed', result: { ok: 1 } }, '1713033007950-0');
    const { evidence } = await capture([{ chunks: [START, run, done, RESULT, DONE] }]);
    expect(evidence.cause).toBeNull();
    expect(evidence.toolCalls).toEqual([{ callId: 'c7', name: 'read_file', status: 'completed', keyCall: false, truncatedArgs: false, truncatedResult: true, argsSha256: createHash('sha256').update('{"path":"a"}').digest('hex'), resultSha256: createHash('sha256').update('{"ok":1}').digest('hex') }]);
  });
  it('SSE framing details: CRLF split across chunks, a comment inside an event, an id with NUL is ignored', async () => {
    const bytes = new TextEncoder().encode(NORMAL.join('').replace(/\n/gu, '\r\n'));
    const pieces: Uint8Array[] = [];
    for (let i = 0; i < bytes.length; i += 5) pieces.push(bytes.slice(i, i + 5));
    const crlf = await capture([{ chunks: pieces }]);
    expect(crlf.evidence.cause).toBeNull();
    expect(events(crlf.lines)).toEqual(['status', 'assistant', 'tool_call', 'tool_call', 'heartbeat', 'tool_call', 'result', 'done']);
    const withComment = 'id: 1713033004500-0\n: keepalive\nevent: assistant\ndata: {"text":"c"}\n\n';
    const c = await capture([{ chunks: [START, withComment, RESULT, DONE] }]);
    expect(records(c.lines).find((r) => r.id === '1713033004500-0')?.rawSha256).toBe(createHash('sha256').update('id: 1713033004500-0\nevent: assistant\ndata: {"text":"c"}').digest('hex'));
    const nul = await capture([{ chunks: [START, 'id: a\u0000b\nevent: assistant\ndata: {"text":"n"}\n\n', RESULT, DONE] }]);
    expect(records(nul.lines).find((r) => r.event === 'assistant')?.id).toBeNull();
  });
  it('the verifier also refuses a record that is not in its canonical form', async () => {
    const { lines } = await capture([{ chunks: NORMAL }]);
    expect(verifyEvidenceChain(lines.map((l, i) => (i === 2 ? l.replace('{', '{ ') : l))).ok).toBe(false);
  });
  it('the verifier refuses a re-hashed record whose sequence, count or file hash is wrong, and a non-canonical final line', async () => {
    const { lines } = await capture([{ chunks: NORMAL }]);
    const sha = (x: string): string => createHash('sha256').update(x).digest('hex');
    const rechain = (edit: (r: Record<string, unknown>, i: number) => void, fileOk = true): string[] => {
      const out: string[] = [];
      let prev = '0'.repeat(64);
      lines.forEach((l, i) => {
        const { hash: _h, ...r } = JSON.parse(l) as Record<string, unknown>;
        r.prev = prev;
        if (i === lines.length - 1 && fileOk) r.fileSha256 = sha(out.map((x) => `${x}\n`).join(''));
        edit(r, i);
        const h = sha(JSON.stringify(r));
        out.push(JSON.stringify({ ...r, hash: h }));
        prev = h;
      });
      return out;
    };
    expect(verifyEvidenceChain(rechain(() => undefined)).ok).toBe(true);
    expect(verifyEvidenceChain(rechain((r, i) => { if (i === 2) r.seq = 7; })).ok).toBe(false);
    expect(verifyEvidenceChain(rechain((r, i) => { if (i === lines.length - 1) r.fileSha256 = '0'.repeat(64); }, false)).ok).toBe(false);
    expect(verifyEvidenceChain(lines.map((l, i) => (i === lines.length - 1 ? l.replace('{', '{ ') : l))).ok).toBe(false);
  });
  it('anything after done, even a heartbeat, is out of order; a status without a status field is malformed', async () => {
    expect((await capture([{ chunks: [START, RESULT, DONE, ev('heartbeat', {}, '1713033011000-0')] }])).evidence.cause).toBe('e2_stream_out_of_order');
    expect((await capture([{ chunks: [ev('status', { runId: REF.runId }), RESULT, DONE] }])).evidence.cause).toBe('e2_stream_malformed_event');
  });
  it('every cause is in the published list', () => {
    expect([...E2_STREAM_CAUSES].sort()).toEqual([
      'e2_evidence_write_failed', 'e2_stream_aborted', 'e2_stream_conflicting_event', 'e2_stream_error_event', 'e2_stream_event_too_large', 'e2_stream_expired', 'e2_stream_gap',
      'e2_stream_key_residue', 'e2_stream_malformed_event', 'e2_stream_no_start', 'e2_stream_no_terminal', 'e2_stream_open_failed', 'e2_stream_out_of_order', 'e2_stream_run_mismatch',
      'e2_stream_too_large', 'e2_stream_truncated_key_call',
    ]);
  });
});
