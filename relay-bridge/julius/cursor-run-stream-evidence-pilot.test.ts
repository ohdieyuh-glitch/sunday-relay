import { mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createCursorCloudAgentsTransport, type CursorFetch } from './cursor-cloud-agents-transport';
import { captureCursorRunStream, createFileEvidenceSink, createMemoryEvidenceSink, verifyEvidenceChain, type E2EvidenceSink } from './cursor-run-stream-evidence';

/**
 * PILOT's review of 0774db05 (PILOT_REVIEW_0774db05.md), capture findings H-1, H-2, M-1, M-2, M-3, M-4, M-6, L-5, L-6,
 * each reproduced as a test. Fake fetch, sentinel key, nothing leaves the process.
 */

const KEY = 'SENTINEL-KEY-0123456789-never-print';
const REF = { agentId: 'bc-00000000-0000-4000-8000-000000000001', runId: 'run-00000000-0000-0000-0000-000000000001' };
const ev = (event: string, data: unknown, id?: string): string => `${id === undefined ? '' : `id: ${id}\n`}event: ${event}\ndata: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`;
const START = ev('status', { runId: REF.runId, status: 'RUNNING' });
const call = (callId: string, name: string, status: string, id: string, extra: Record<string, unknown> = {}): string => ev('tool_call', { callId, name, status, args: { path: 'a.ts' }, ...extra }, id);
const RESULT = ev('result', { runId: REF.runId, status: 'FINISHED', durationMs: 10 }, '1713033010000-0');
const DONE = ev('done', {}, '1713033010000-0');

type Conn = { chunks: readonly (string | Uint8Array)[] } | { pull: ReadableStream<Uint8Array> };
function serve(conns: readonly Conn[], realClock = false) {
  const seen: (string | null)[] = [];
  const fetch: CursorFetch = async (_url, init) => {
    seen.push(init.headers['Last-Event-ID'] ?? null);
    const c = conns[Math.min(seen.length - 1, conns.length - 1)] as Conn;
    const body = 'pull' in c ? c.pull : new ReadableStream<Uint8Array>({ start(ctl) { for (const ch of c.chunks) ctl.enqueue(typeof ch === 'string' ? new TextEncoder().encode(ch) : ch); ctl.close(); } });
    return { ok: true, status: 200, headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? 'text/event-stream' : null) }, body, text: async () => '' };
  };
  let t = Date.parse('2026-10-30T18:00:00.000Z');
  const now = realClock ? Date.now : () => t;
  const sleep = realClock ? undefined : async (ms: number) => { t += ms; };
  const transport = createCursorCloudAgentsTransport({ fetch, getApiKey: () => KEY, now, ...(sleep === undefined ? {} : { sleep }) });
  return { transport, seen, now, sleep };
}
async function capture(conns: readonly Conn[], o: { sink?: E2EvidenceSink; realClock?: boolean; deadlineMs?: number } = {}) {
  const s = serve(conns, o.realClock === true);
  const sink = o.sink ?? createMemoryEvidenceSink();
  const evidence = await captureCursorRunStream({ transport: s.transport, ref: REF, sink, now: s.now, ...(s.sleep === undefined ? {} : { sleep: s.sleep }), deadlineAtMs: s.now() + (o.deadlineMs ?? 3_600_000) });
  return { evidence, lines: 'lines' in sink ? (sink as { lines: string[] }).lines : [], seen: s.seen };
}

describe('PILOT 0774db05: capture findings', () => {
  it('H-1: a capture that had to resume with Last-Event-ID fails (skipped events are invisible), even if the replay looks complete', async () => {
    const edit = call('c1', 'edit_file', 'running', '1713033002000-0');
    const r = await capture([{ chunks: [START, edit] }, { chunks: [START, ev('assistant', { text: 'x' }, '1713033005000-0'), ev('heartbeat', {}, '1713033006000-0'), RESULT, DONE] }]);
    expect(r.seen).toEqual([null, '1713033002000-0']);
    expect(r.evidence.cause).toBe('e2_stream_resumed');
    expect(r.evidence.connections).toBe(2);
    expect(verifyEvidenceChain(r.lines).ok).toBe(true);
  });
  it('H-2: an identical replayed event fails the capture, on one connection or after a resume (counted, never silent)', async () => {
    const run = call('c1', 'read_file', 'running', '1713033002000-0');
    const done = call('c1', 'read_file', 'completed', '1713033003000-0', { result: { ok: 1 } });
    const one = await capture([{ chunks: [START, run, run, done, RESULT, DONE] }]);
    expect(one.evidence.cause).toBe('e2_stream_duplicate_event');
    expect(one.evidence.duplicates).toBe(1);
    const replay = await capture([{ chunks: [START, run] }, { chunks: [START, run, done, RESULT, DONE] }]);
    expect(replay.evidence.cause).toBe('e2_stream_resumed');
    expect(replay.evidence.duplicates).toBe(1);
    const partial = await capture([{ chunks: [START, run, 'id: 1713033003000-0\nevent: tool_call\ndata: {"cal'] }, { chunks: [START, run, done, RESULT, DONE] }]);
    expect(partial.evidence.cause).toBe('e2_stream_resumed');
    expect(partial.evidence).toMatchObject({ partialDiscarded: 1, duplicates: 1 });
  });
  it('M-1: a terminal result other than FINISHED fails', async () => {
    for (const status of ['ERROR', 'CANCELLED', 'EXPIRED', 'finished']) {
      const r = await capture([{ chunks: [START, call('c1', 'read_file', 'completed', '1713033002000-0'), ev('result', { runId: REF.runId, status }, '1713033010000-0'), DONE] }]);
      expect(r.evidence.cause).toBe('e2_stream_terminal_not_finished');
    }
  });
  it('M-2: a stream that starts mid-run (its first status carries an id) is no start', async () => {
    const r = await capture([{ chunks: [ev('status', { runId: REF.runId, status: 'RUNNING' }, '1713033009000-0'), call('c1', 'read_file', 'completed', '1713033009500-0'), RESULT, DONE] }]);
    expect(r.evidence.cause).toBe('e2_stream_no_start');
  });
  it('M-3: a tool call still running at done fails', async () => {
    const r = await capture([{ chunks: [START, call('c1', 'read_file', 'completed', '1713033002000-0'), call('c2', 'run_terminal_cmd', 'running', '1713033003000-0'), RESULT, DONE] }]);
    expect(r.evidence.cause).toBe('e2_stream_call_unfinished');
  });
  it('M-4: the deadline holds inside an open connection: endless heartbeats abort at the deadline', async () => {
    let n = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pull = new ReadableStream<Uint8Array>({
      start(ctl) { ctl.enqueue(new TextEncoder().encode(START)); },
      pull(ctl) { return new Promise((res) => { timer = setTimeout(() => { n += 1; ctl.enqueue(new TextEncoder().encode(ev('heartbeat', {}, `17130330${String(10000 + n)}-0`))); res(); }, 100); }); },
      cancel() { clearTimeout(timer); },
    });
    const t0 = Date.now();
    const r = await capture([{ pull }], { realClock: true, deadlineMs: 500 });
    const took = Date.now() - t0;
    clearTimeout(timer);
    expect(r.evidence.cause).toBe('e2_stream_no_terminal');
    expect(took).toBeLessThan(1_500);
    expect(took).toBeGreaterThanOrEqual(450);
  });
  it('M-6: other secrets in stored records are redacted at store time and counted', async () => {
    const secrets = [
      'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8', 'github_pat_' + '11ABCDEFG9753197531_abcdefghijklmnopqrstuvwxyz', 'AKIA' + 'IOSFODNN7EXAMPLE',
      'sk-' + 'proj-abcdefghijklmnop9753197531', 'xai-' + 'abcdefghijklmnopqrstuvwx1234', 'gsk_' + 'abcdefghijklmnopqrstuvwx1234',
      'eyJhbGciOiJIUzI1NiJ9.' + 'eyJzdWIiOiIxMjM0NTY3ODkwIn0.' + 'dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
    ];
    const args = { command: `curl -H "Authorization: Bearer ${'tok_' + 'abcdefghijklmnop'}" -u x ${secrets.join(' ')}`, basic: 'Basic ' + 'dXNlcjpwYXNzd29yZA==' };
    const r = await capture([{ chunks: [START, ev('tool_call', { callId: 'c1', name: 'run_terminal_cmd', status: 'completed', args, result: { output: 'ok' } }, '1713033002000-0'), RESULT, DONE] }]);
    expect(r.evidence.cause).toBeNull();
    const text = r.lines.join('\n');
    for (const s of [...secrets, 'tok_abcdefghijklmnop', 'dXNlcjpwYXNzd29yZA==']) expect(text).not.toContain(s);
    expect(r.evidence.secretsRedacted).toBe(9);
    const rec = r.lines.map((l) => JSON.parse(l) as Record<string, unknown>).find((x) => x.event === 'tool_call');
    expect(rec).toMatchObject({ secretsRedacted: 9, rawSha256: 'withheld_key_scrubbed' });
    expect(verifyEvidenceChain(r.lines).ok).toBe(true);
  });
  it('L-5: a symlink swapped in for the evidence file after the first write is never followed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'e2l5-'));
    try {
      const path = join(dir, 'ev.jsonl');
      const victim = join(dir, 'victim.txt');
      writeFileSync(victim, 'victim\n');
      const file = createFileEvidenceSink(path);
      let first = true;
      const sink: E2EvidenceSink = {
        async append(line) {
          await file.append(line);
          if (first) { first = false; renameSync(path, `${path}.moved`); symlinkSync(victim, path); }
        },
        ...(file.close === undefined ? {} : { close: async () => { await file.close?.(); } }),
      };
      const r = await capture([{ chunks: [START, call('c1', 'read_file', 'completed', '1713033002000-0'), RESULT, DONE] }], { sink });
      expect(readFileSync(victim, 'utf8')).toBe('victim\n');
      expect(r.evidence.cause).toBe('e2_evidence_write_failed');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('L-6: the per-event cap counts UTF-8 bytes, not characters', async () => {
    const small = await capture([{ chunks: [START, ev('assistant', { text: '\u00e9'.repeat(400_000) }, '1713033002000-0'), call('c1', 'read_file', 'completed', '1713033003000-0'), RESULT, DONE] }]);
    expect(small.evidence.cause).toBeNull();
    const big = await capture([{ chunks: [START, ev('assistant', { text: '\u00e9'.repeat(600_000) }, '1713033002000-0'), RESULT, DONE] }]);
    expect(big.evidence.cause).toBe('e2_stream_event_too_large');
  }, 30_000);
});
