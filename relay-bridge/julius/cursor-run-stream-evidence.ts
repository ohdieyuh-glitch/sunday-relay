import { createHash } from 'node:crypto';
import { appendFile, writeFile } from 'node:fs/promises';

import { cursorTransportMode, openCursorRunStream, type CursorStreamOpen } from './cursor-cloud-agents-transport';
import type { CodingAgentRunRef } from './grok-bot-coding-provider';

/**
 * E2 PART A: A LIVE-CAPTURED, HASHED, ORDERED, CHAINED RECORD OF THE RUN'S SSE STREAM
 * (`GET /v1/agents/{id}/runs/{runId}/stream`, https://cursor.com/docs/cloud-agent/api/endpoints.md, "Stream A Run").
 *
 * WHAT IT IS: Cursor's own report of its own run (its runtime's `tool_call` events), captured by Julius as it arrived. It is
 * NOT independent of Cursor and never claims to be (`independentOfCursor: false`). It is only labelled
 * {@link E2_STREAM_LABEL_LIVE} when every connection was opened by a live-stamped transport that is still live at the end;
 * anything else is {@link E2_STREAM_LABEL_FAKE}, which E2 refuses. `live` itself is never proof the bytes came from Cursor.
 *
 * THE RECORD: JSON lines, in order: a header, one record per connection, one per event, and a final record. Every record
 * carries `seq` and `prev` (the previous record's hash) and its own `hash` (sha256 of the record without `hash`); the final
 * record carries `fileSha256` over every earlier line, so its hash covers the whole record ({@link verifyEvidenceChain}).
 * Each event record holds its receive time (Julius's clock), the SSE id/event/data AFTER key scrubbing, and the sha256 of
 * the raw event lines (withheld when the scrub changed anything, so no hash of key-bearing text is kept).
 *
 * NOT IN THE DOCS, SO NOT INVENTED: per-event timestamps and exit codes are `not_provided`; the retention window is only the
 * `X-Cursor-Stream-Retention-Seconds` header when sent; the SSE id is opaque and never parsed or ordered. Tool names other
 * than the documented read-only `read_file` are treated as key calls (write, apply, shell, mcp, anything new).
 */

export const E2_STREAM_LABEL_LIVE = 'cursor_platform_reported';
export const E2_STREAM_LABEL_FAKE = 'fake';
export const E2_STREAM_SOURCE = 'cursor_platform_report_not_independent_of_cursor';

/** Every fail-closed cause a capture can end with. */
export const E2_STREAM_CAUSES = Object.freeze([
  'e2_stream_open_failed', 'e2_stream_no_start', 'e2_stream_gap', 'e2_stream_expired', 'e2_stream_no_terminal', 'e2_stream_truncated_key_call',
  'e2_stream_key_residue', 'e2_stream_malformed_event', 'e2_stream_run_mismatch', 'e2_stream_error_event', 'e2_stream_out_of_order',
  'e2_stream_conflicting_event', 'e2_stream_event_too_large', 'e2_stream_too_large', 'e2_stream_aborted', 'e2_evidence_write_failed',
] as const);
export type E2StreamCause = (typeof E2_STREAM_CAUSES)[number];

/** Where records go, one line at a time, in order. */
export interface E2EvidenceSink { append(line: string): Promise<void> }
export function createMemoryEvidenceSink(): E2EvidenceSink & { readonly lines: string[] } {
  const lines: string[] = [];
  return { lines, append: async (line) => { lines.push(line); } };
}
/** A file sink: the first line creates the file and refuses one that exists; the rest append. */
export function createFileEvidenceSink(path: string): E2EvidenceSink {
  let first = true;
  return {
    async append(line) {
      if (first) { await writeFile(path, `${line}\n`, { flag: 'wx', mode: 0o600 }); first = false; return; }
      await appendFile(path, `${line}\n`);
    },
  };
}

export interface E2ToolCall {
  readonly callId: string;
  readonly name: string;
  readonly status: 'running' | 'completed';
  /** Not `read_file`: a write, apply, shell, mcp or unknown call, whose truncation fails the capture closed. */
  readonly keyCall: boolean;
  readonly truncatedArgs: boolean;
  readonly truncatedResult: boolean;
  /** sha256 of the (scrubbed) JSON value as re-serialised, or null when Cursor sent none. */
  readonly argsSha256: string | null;
  readonly resultSha256: string | null;
}
export interface E2StreamEvidence {
  readonly label: typeof E2_STREAM_LABEL_LIVE | typeof E2_STREAM_LABEL_FAKE;
  readonly mode: 'live' | 'fake';
  readonly independentOfCursor: false;
  readonly agentId: string;
  readonly runId: string;
  readonly cause: E2StreamCause | null;
  readonly records: number;
  readonly finalHash: string;
  readonly fileSha256: string;
  readonly retentionSeconds: string;
  readonly connections: number;
  readonly duplicatesDropped: number;
  readonly partialDiscarded: number;
  readonly terminal: { readonly status: string; readonly durationMs: number | 'not_provided' } | null;
  readonly toolCalls: readonly E2ToolCall[];
  readonly perEventTimestamps: 'not_provided';
  readonly exitCodes: 'not_provided';
}

/** One SSE event's text, or the whole stream, is never held past these. */
export const E2_MAX_EVENT_BYTES = 1024 * 1024;
export const E2_MAX_STREAM_BYTES = 64 * 1024 * 1024;
const READ_ONLY_TOOL_NAMES = new Set(['read_file']);
const ZERO = '0'.repeat(64);
const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');
const isAborted = (signal: AbortSignal | undefined): boolean => signal?.aborted === true;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const parseJson = (s: string): { ok: true; value: unknown } | { ok: false } => { try { return { ok: true, value: JSON.parse(s) as unknown }; } catch { return { ok: false }; } };
const defaultSleep = (ms: number, signal?: AbortSignal): Promise<void> => new Promise((resolve) => {
  if (isAborted(signal)) { resolve(); return; }
  const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
  const onAbort = (): void => { clearTimeout(t); resolve(); };
  signal?.addEventListener('abort', onAbort, { once: true });
});

/** The hash chain over records written to a sink. */
class Chain {
  private prev = ZERO;
  private seq = 0;
  private readonly file = createHash('sha256');
  constructor(private readonly sink: E2EvidenceSink) {}
  get count(): number { return this.seq; }
  get head(): string { return this.prev; }
  fileDigest(): string { return this.file.copy().digest('hex'); }
  async write(fields: Record<string, unknown>): Promise<string> {
    const body = { ...fields, seq: this.seq, prev: this.prev };
    const hash = sha256(JSON.stringify(body));
    const line = JSON.stringify({ ...body, hash });
    await this.sink.append(line);
    this.file.update(`${line}\n`);
    this.prev = hash;
    this.seq += 1;
    return hash;
  }
}

/** Checks a record end to end: order, links, hashes, one final record last, and its whole-file hash. */
export function verifyEvidenceChain(lines: readonly string[]): { readonly ok: true; readonly finalHash: string; readonly records: number } | { readonly ok: false; readonly at: number } {
  let prev = ZERO;
  const file = createHash('sha256');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] as string;
    const p = parseJson(line);
    if (!p.ok || !isRecord(p.value)) return { ok: false, at: i };
    const { hash, ...rest } = p.value;
    if (rest.seq !== i || rest.prev !== prev || typeof hash !== 'string' || sha256(JSON.stringify(rest)) !== hash) return { ok: false, at: i };
    if (JSON.stringify(p.value) !== line) return { ok: false, at: i };
    const last = i === lines.length - 1;
    if ((i === 0) !== (rest.kind === 'header')) return { ok: false, at: i };
    if (last !== (rest.kind === 'final')) return { ok: false, at: i };
    if (last && (rest.fileSha256 !== file.copy().digest('hex') || rest.records !== lines.length)) return { ok: false, at: i };
    file.update(`${line}\n`);
    prev = hash;
  }
  return lines.length < 2 ? { ok: false, at: 0 } : { ok: true, finalHash: prev, records: lines.length };
}

class Stop { constructor(readonly cause: E2StreamCause | null) {} }

/** One parsed SSE event, before scrubbing. */
interface RawEvent { readonly id: string | null; readonly event: string; readonly data: string; readonly raw: string }

/**
 * Captures the run's stream live from the run start, before any result is accepted. Resumes with Last-Event-ID after a
 * dropped connection (spaced at least `reconnectDelayMs`, default 3000, inside the documented 20 requests/minute), and ends
 * with null (complete: a `result` for this run, then `done`) or a named fail-closed cause. Never falls back to anything.
 */
export async function captureCursorRunStream(input: {
  readonly transport: unknown;
  readonly ref: CodingAgentRunRef;
  readonly sink: E2EvidenceSink;
  readonly deadlineAtMs: number;
  readonly signal?: AbortSignal;
  readonly now?: () => number;
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly maxReconnects?: number;
  readonly reconnectDelayMs?: number;
  /** Lower only: the total-bytes cap, never above {@link E2_MAX_STREAM_BYTES}. */
  readonly maxStreamBytes?: number;
}): Promise<E2StreamEvidence> {
  const now = input.now ?? Date.now;
  const sleep = input.sleep ?? defaultSleep;
  const maxReconnects = Math.max(0, input.maxReconnects ?? 5);
  const reconnectDelayMs = Math.max(3_000, input.reconnectDelayMs ?? 3_000);
  const maxStreamBytes = Math.min(E2_MAX_STREAM_BYTES, Math.max(0, input.maxStreamBytes ?? E2_MAX_STREAM_BYTES));
  const { ref, signal } = input;
  const iso = (): string => new Date(now()).toISOString();
  const chain = new Chain(input.sink);

  let connections = 0;
  let reconnects = 0;
  let everOpened = false;
  let allLive = true;
  let retention: string | null = null;
  let lastId: string | null = null;
  let sawUnresumable = false;
  let duplicatesDropped = 0;
  let partialDiscarded = 0;
  let totalBytes = 0;
  let resultData: string | null = null;
  let terminal: E2StreamEvidence['terminal'] = null;
  let doneSeen = false;
  const seen = new Map<string, string>();
  const calls = new Map<string, E2ToolCall>();

  const finish = async (cause: E2StreamCause | null, writable: boolean): Promise<E2StreamEvidence> => {
    const mode: 'live' | 'fake' = everOpened && allLive && cursorTransportMode(input.transport) === 'live' ? 'live' : 'fake';
    const label = mode === 'live' ? E2_STREAM_LABEL_LIVE : E2_STREAM_LABEL_FAKE;
    let finalHash = '';
    let fileSha256 = '';
    let finalCause = cause;
    if (writable) {
      fileSha256 = chain.fileDigest();
      try {
        finalHash = await chain.write({
          kind: 'final', cause, label, mode, records: chain.count + 1, connections, duplicatesDropped, partialDiscarded,
          retentionSeconds: retention ?? 'not_provided', fileSha256, endedAt: iso(),
        });
      } catch { finalCause = 'e2_evidence_write_failed'; finalHash = ''; }
    }
    return Object.freeze({
      label, mode, independentOfCursor: false as const, agentId: ref.agentId, runId: ref.runId, cause: finalCause,
      records: chain.count, finalHash, fileSha256, retentionSeconds: retention ?? 'not_provided', connections, duplicatesDropped, partialDiscarded,
      terminal, toolCalls: Object.freeze([...calls.values()]), perEventTimestamps: 'not_provided' as const, exitCodes: 'not_provided' as const,
    });
  };

  try {
    await chain.write({ kind: 'header', v: 1, source: E2_STREAM_SOURCE, agentId: ref.agentId, runId: ref.runId, startedAt: iso() });
  } catch { return finish('e2_evidence_write_failed', false); }

  try {
    for (;;) {
      if (isAborted(signal)) throw new Stop('e2_stream_aborted');
      if (connections > 0) {
        if (reconnects >= maxReconnects) throw new Stop(everOpened ? 'e2_stream_gap' : 'e2_stream_open_failed');
        if (lastId === null && sawUnresumable) throw new Stop('e2_stream_gap');
        reconnects += 1;
        await sleep(reconnectDelayMs, signal);
        if (isAborted(signal)) throw new Stop('e2_stream_aborted');
      }
      if (now() >= input.deadlineAtMs) throw new Stop('e2_stream_no_terminal');
      connections += 1;
      const n = connections;
      const open: CursorStreamOpen = await openCursorRunStream(input.transport, ref, lastId, { deadlineAtMs: input.deadlineAtMs, ...(signal === undefined ? {} : { signal }) });
      await chain.write({
        kind: 'connection', n, lastEventId: lastId, at: iso(), outcome: open.kind,
        status: open.kind === 'opened' || open.kind === 'status' ? open.status : null,
        cause: open.kind === 'not_sent' || open.kind === 'failed_in_flight' ? open.cause : null,
        retentionSeconds: open.kind === 'opened' ? open.retentionSeconds : null, mode: open.kind === 'opened' ? open.mode : null,
      });
      if (open.kind === 'not_sent') throw new Stop(open.cause === 'aborted' ? 'e2_stream_aborted' : 'e2_stream_open_failed');
      if (open.kind === 'deadline') throw new Stop('e2_stream_no_terminal');
      if (open.kind === 'failed_in_flight') {
        if (open.cause === 'aborted_in_flight') throw new Stop('e2_stream_aborted');
        continue;
      }
      if (open.kind === 'status') {
        if (open.status === 410) throw new Stop('e2_stream_expired');
        if (open.status === 400 && everOpened) throw new Stop('e2_stream_gap');
        throw new Stop('e2_stream_open_failed');
      }
      const first = !everOpened;
      everOpened = true;
      if (open.mode !== 'live') allLive = false;
      retention = retention ?? open.retentionSeconds;
      try {
        const ct = (open.contentType ?? '').trim().toLowerCase();
        if (!ct.startsWith('text/event-stream')) throw new Stop(first ? 'e2_stream_no_start' : 'e2_stream_gap');
        let inConn = 0;
        const onEvent = async (e: RawEvent): Promise<void> => {
          // Scrub every field and the raw lines before anything is written; surviving key characters stop the capture.
          const parts: string[] = [];
          let scrubbed = false;
          for (const text of [e.raw, e.id ?? '', e.event, e.data]) {
            const s = open.scrub(text);
            if (s.kind === 'residue') throw new Stop('e2_stream_key_residue');
            scrubbed = scrubbed || s.scrubbed;
            parts.push(s.text);
          }
          const [, sid, sevent, sdata] = parts as [string, string, string, string];
          if (inConn === 0 && e.event !== 'status') throw new Stop(first ? 'e2_stream_no_start' : 'e2_stream_gap');
          inConn += 1;
          if (e.id !== null) {
            const k = `${e.id}\u0000${e.event}`;
            const prior = seen.get(k);
            const digest = sha256(e.data);
            lastId = e.id;
            if (prior === digest) { duplicatesDropped += 1; return; }
            if (prior !== undefined) {
              await writeEvent();
              throw new Stop('e2_stream_conflicting_event');
            }
            seen.set(k, digest);
          } else if (e.event !== 'status') {
            sawUnresumable = true;
          }
          await writeEvent();
          await interpret(e.event, sdata);
          async function writeEvent(): Promise<void> {
            await chain.write({
              kind: 'event', conn: n, receivedAt: iso(), id: e.id === null ? null : sid, event: sevent, data: sdata,
              rawSha256: scrubbed ? 'withheld_key_scrubbed' : sha256(e.raw), scrubbed,
            });
          }
        };
        const interpret = async (event: string, data: string): Promise<void> => {
          if (doneSeen) throw new Stop('e2_stream_out_of_order');
          if (resultData !== null && !['done', 'heartbeat', 'status', 'result'].includes(event)) throw new Stop('e2_stream_out_of_order');
          const p = (): unknown => { const r = parseJson(data); if (!r.ok) throw new Stop('e2_stream_malformed_event'); return r.value; };
          if (event === 'status') {
            const v = p();
            if (!isRecord(v) || typeof v.runId !== 'string' || typeof v.status !== 'string') throw new Stop('e2_stream_malformed_event');
            if (v.runId !== ref.runId) throw new Stop('e2_stream_run_mismatch');
          } else if (event === 'tool_call') {
            const v = p();
            if (!isRecord(v) || typeof v.callId !== 'string' || v.callId === '' || v.callId.length > 256 || typeof v.name !== 'string' || v.name === '' || v.name.length > 256
              || (v.status !== 'running' && v.status !== 'completed')) throw new Stop('e2_stream_malformed_event');
            const t = v.truncated;
            if (t !== undefined && (!isRecord(t) || Object.entries(t).some(([k, x]) => !['args', 'result'].includes(k) || x !== true))) throw new Stop('e2_stream_malformed_event');
            const prior = calls.get(v.callId);
            if (prior !== undefined && prior.name !== v.name) throw new Stop('e2_stream_conflicting_event');
            if (prior?.status === 'completed' && v.status === 'running') throw new Stop('e2_stream_out_of_order');
            const argsSha256 = 'args' in v ? sha256(JSON.stringify(v.args)) : prior?.argsSha256 ?? null;
            const resultSha256 = 'result' in v ? sha256(JSON.stringify(v.result)) : prior?.resultSha256 ?? null;
            if (prior?.status === 'completed' && (argsSha256 !== prior.argsSha256 || resultSha256 !== prior.resultSha256)) throw new Stop('e2_stream_conflicting_event');
            const call: E2ToolCall = Object.freeze({
              callId: v.callId, name: v.name, status: v.status, keyCall: !READ_ONLY_TOOL_NAMES.has(v.name),
              truncatedArgs: (isRecord(t) && t.args === true) || prior?.truncatedArgs === true,
              truncatedResult: (isRecord(t) && t.result === true) || prior?.truncatedResult === true,
              argsSha256, resultSha256,
            });
            calls.set(v.callId, call);
            if (call.keyCall && (call.truncatedArgs || call.truncatedResult)) throw new Stop('e2_stream_truncated_key_call');
          } else if (event === 'result') {
            const v = p();
            if (!isRecord(v) || typeof v.runId !== 'string' || typeof v.status !== 'string') throw new Stop('e2_stream_malformed_event');
            if (v.runId !== ref.runId) throw new Stop('e2_stream_run_mismatch');
            if (resultData !== null && resultData !== data) throw new Stop('e2_stream_conflicting_event');
            resultData = data;
            const d = v.durationMs;
            terminal = Object.freeze({ status: v.status, durationMs: typeof d === 'number' && Number.isInteger(d) && d >= 0 ? d : 'not_provided' as const });
          } else if (event === 'error') {
            throw new Stop('e2_stream_error_event');
          } else if (event === 'done') {
            if (resultData === null) throw new Stop('e2_stream_no_terminal');
            doneSeen = true;
          }
        };
        const ended = await readSse(open.body, async (e) => onEvent(e), (bytes) => {
          totalBytes += bytes;
          if (totalBytes > maxStreamBytes) throw new Stop('e2_stream_too_large');
        }, signal);
        if (ended.partial) partialDiscarded += 1;
        if (doneSeen) return await finish(null, true);
        if (inConn === 0 && first) throw new Stop('e2_stream_no_start');
      } finally {
        open.close();
      }
    }
  } catch (e) {
    if (e instanceof Stop) return finish(e.cause, true);
    return finish('e2_evidence_write_failed', false);
  }
}

/**
 * Reads one connection's body as Server-Sent Events (WHATWG HTML, "event stream interpretation"): lines end in CRLF, LF or CR;
 * `:` lines are comments; `field: value` drops one leading space; `data` lines join with LF; a blank line dispatches; an id
 * containing NUL is ignored. Bytes are decoded as UTF-8 across chunk boundaries (invalid UTF-8 is malformed). A trailing
 * event with no blank line is DISCARDED (`partial`), never dispatched.
 */
async function readSse(
  body: ReadableStream<Uint8Array> | null,
  dispatch: (e: RawEvent) => Promise<void>,
  countBytes: (n: number) => void,
  signal: AbortSignal | undefined,
): Promise<{ partial: boolean }> {
  if (body === null) return { partial: false };
  const reader = body.getReader();
  const onAbort = (): void => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener('abort', onAbort, { once: true });
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buf = '';
  let id: string | null = null;
  let event = '';
  let data: string[] = [];
  let raw: string[] = [];
  let pendingBytes = 0;
  const reset = (): void => { id = null; event = ''; data = []; raw = []; pendingBytes = 0; };
  const line = async (l: string): Promise<void> => {
    if (l === '') {
      if (raw.length > 0 && data.length > 0) await dispatch({ id, event: event === '' ? 'message' : event, data: data.join('\n'), raw: raw.join('\n') });
      reset();
      return;
    }
    if (l.startsWith(':')) return;
    pendingBytes += l.length + 1;
    if (pendingBytes > E2_MAX_EVENT_BYTES) throw new Stop('e2_stream_event_too_large');
    raw.push(l);
    const at = l.indexOf(':');
    const field = at === -1 ? l : l.slice(0, at);
    let value = at === -1 ? '' : l.slice(at + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
    else if (field === 'id' && !value.includes('\u0000')) id = value;
  };
  const drain = async (final: boolean): Promise<void> => {
    for (;;) {
      const m = /\r\n|\n|\r/u.exec(buf);
      if (m === null) break;
      if (m[0] === '\r' && m.index === buf.length - 1 && !final) break;
      const l = buf.slice(0, m.index);
      buf = buf.slice(m.index + m[0].length);
      await line(l);
    }
    if (buf.length > E2_MAX_EVENT_BYTES) throw new Stop('e2_stream_event_too_large');
  };
  try {
    for (;;) {
      if (isAborted(signal)) throw new Stop('e2_stream_aborted');
      let r: ReadableStreamReadResult<Uint8Array>;
      try { r = await reader.read(); } catch { if (isAborted(signal)) throw new Stop('e2_stream_aborted'); break; }
      if (r.done) break;
      countBytes(r.value.byteLength);
      try { buf += decoder.decode(r.value, { stream: true }); } catch { throw new Stop('e2_stream_malformed_event'); }
      await drain(false);
    }
    try { buf += decoder.decode(); } catch { throw new Stop('e2_stream_malformed_event'); }
    await drain(true);
    return { partial: buf !== '' || raw.length > 0 };
  } finally {
    signal?.removeEventListener('abort', onAbort);
    try { reader.releaseLock(); } catch { /* still reading */ }
  }
}
