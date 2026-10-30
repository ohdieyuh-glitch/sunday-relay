import type {
  CodingAgentBranch,
  CodingAgentCreateInput,
  CodingAgentCreateOutcome,
  CodingAgentPollOutcome,
  CodingAgentResultOutcome,
  CodingAgentRunRef,
  CodingAgentTerminalStatus,
  CodingAgentTransport,
  CodingAgentUsage,
} from './grok-bot-coding-provider';

/**
 * THE CURSOR CLOUD AGENTS API v1 (public beta) AS A {@link CodingAgentTransport}, over an INJECTED fetch.
 *
 * Read from the public docs only, without a key, on 2026-10-30:
 *  - https://cursor.com/docs/cloud-agent/api/endpoints.md
 *      POST /v1/agents                       create (body: prompt.text, model.id, repos[{url,startingRef}], autoCreatePR, agentId)
 *      GET  /v1/agents/{id}/runs/{runId}     status CREATING|RUNNING|WAITING_FOR_BACKGROUND_WORK → FINISHED|ERROR|CANCELLED|EXPIRED;
 *                                            terminal runs carry `result`, `durationMs`, `git.branches[{repoUrl (no scheme), branch?, prUrl?}]`
 *      GET  /v1/agents/{id}/usage?runId=     per-run token usage; "Runs without any recorded token usage report zeros"
 *      POST /v1/agents/{id}/runs/{runId}/cancel   `409 run_not_cancellable` when terminal
 *      `agentId` "Useful for idempotent create flows — re-POSTing the same agentId returns 409 agent_id_conflict"
 *  - https://cursor.com/docs/cloud-agent/api/overview   ("Webhooks are coming soon": this transport POLLS)
 *  - https://cursor.com/docs/api.md                     (Basic or Bearer auth; default 20 requests/minute; 429 on limit)
 *
 * UNDOCUMENTED, AND THEREFORE FAIL-CLOSED CONFIGURATION, NEVER AN ASSUMPTION:
 *  - No served-model field is documented on the agent, run or usage record. `attestedModelField` is null by default, so
 *    `reportedModelId` is null and the provider halts `coder_served_model_unattested`. A person may name a field once the
 *    API is observed to return one; nothing here guesses its name.
 *  - `Retry-After` is documented only for the Admin API; it is honoured when present (bounded), otherwise backoff is ours.
 *  - The exact error-body shape for Cloud Agents codes is not pinned down; mapping is by HTTP status only.
 *
 * THE KEY: obtained from an injected getter at the moment of each request, placed in exactly one header, and never put in a
 * result, an error, a log line or a diagnostic. Any response string that contains it is redacted before it leaves.
 * `CURSOR_API_KEY_ENV_NAME` is a NAME for the composition root; this module never reads the environment.
 */

export const CURSOR_API_ORIGIN = 'https://api.cursor.com';
export const CURSOR_API_KEY_ENV_NAME = 'CURSOR_API_KEY';
export const CURSOR_CLOUD_AGENTS_TRANSPORT_KIND = 'cursor-cloud-agents-v1';

export interface CursorFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly headers?: { get(name: string): string | null };
  /** The streamed body (WHATWG fetch). When present it is the ONLY way the body is read, and it is read with a byte cap. */
  readonly body?: ReadableStream<Uint8Array> | null;
  /** Fallback only for a response without a stream; its length is still capped before anything is parsed. */
  text(): Promise<string>;
}
export type CursorFetch = (url: string, init: {
  readonly method: 'GET' | 'POST';
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly redirect: 'error';
  readonly signal?: AbortSignal;
}) => Promise<CursorFetchResponse>;

/** Where, on which record, a served model id would be read. Null (the default): nowhere, because none is documented. */
export interface CursorAttestedModelField { readonly record: 'agent' | 'run'; readonly path: readonly string[] }

export interface CursorCloudAgentsTransportOptions {
  readonly fetch: CursorFetch;
  readonly getApiKey: () => string | null;
  readonly now?: () => number;
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Must equal {@link CURSOR_API_ORIGIN}; anything else is refused at construction. */
  readonly baseUrl?: string;
  /** Between status polls. Default 6000 (10/min, half the documented 20/min); never below 3000. */
  readonly pollIntervalMs?: number;
  /** Per request. Default 30000. */
  readonly requestTimeoutMs?: number;
  /** First 429 backoff when no Retry-After is given. Default 10000, doubling to 60000. */
  readonly rateLimitBackoffMs?: number;
  readonly attestedModelField?: CursorAttestedModelField | null;
  readonly log?: (line: string) => void;
}

const MIN_POLL_MS = 3_000;
const MAX_BACKOFF_MS = 60_000;
const MAX_RETRY_AFTER_MS = 120_000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
/** Strings the service returns that reach evidence: bounded here, before the router's own caps. */
const MAX_FINAL_TEXT_CHARS = 16_000;
const MAX_PR_URL_CHARS = 300;
const PR_URL = /^https:\/\/github\.com\/[A-Za-z0-9._~\/%#?=&+-]+$/u;
const REPORTED_MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

/**
 * Reads a response body, never past {@link MAX_BODY_BYTES}: a declared Content-Length over the cap is refused unread, and the
 * stream is counted chunk by chunk and cancelled the moment it passes the cap. Null: oversized or unreadable (never parsed).
 */
export async function readCappedBody(res: CursorFetchResponse, maxBytes: number = MAX_BODY_BYTES): Promise<string | null> {
  const declared = res.headers?.get('content-length') ?? null;
  if (declared !== null && /^\d+$/u.test(declared.trim()) && Number(declared.trim()) > maxBytes) {
    try { await res.body?.cancel(); } catch { /* best effort */ }
    return null;
  }
  if (res.body !== undefined && res.body !== null) {
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) { try { await reader.cancel(); } catch { /* best effort */ } return null; }
        chunks.push(value);
      }
    } catch { return null; }
    const all = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) { all.set(c, at); at += c.byteLength; }
    try { return new TextDecoder('utf-8', { fatal: true }).decode(all); } catch { return null; }
  }
  let text: string;
  try { text = await res.text(); } catch { return null; }
  return Buffer.byteLength(text, 'utf8') > maxBytes ? null : text;
}
const ACTIVE = new Set(['CREATING', 'RUNNING', 'WAITING_FOR_BACKGROUND_WORK']);
const TERMINAL = new Set<CodingAgentTerminalStatus>(['FINISHED', 'ERROR', 'CANCELLED', 'EXPIRED']);
const REDACTED = '[REDACTED]';
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;

const defaultSleep = (ms: number, signal?: AbortSignal): Promise<void> => new Promise((resolve) => {
  if (signal?.aborted === true) { resolve(); return; }
  const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
  const onAbort = (): void => { clearTimeout(timer); resolve(); };
  signal?.addEventListener('abort', onAbort, { once: true });
});

/** An untrusted PR link is kept only as a bounded https://github.com/… URL; anything else is dropped. */
const safePrUrl = (v: string | null): string | null => (v !== null && v.length <= MAX_PR_URL_CHARS && PR_URL.test(v) ? v : null);
const isAborted = (signal: AbortSignal | undefined): boolean => signal?.aborted === true;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const count = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);

type Sent =
  | { readonly kind: 'response'; readonly status: number; readonly body: unknown; readonly retryAfterMs: number | null }
  | { readonly kind: 'not_sent'; readonly cause: 'aborted' | 'key_absent' }
  | { readonly kind: 'failed_in_flight'; readonly cause: 'timeout' | 'network' | 'aborted_in_flight' };

export function createCursorCloudAgentsTransport(options: CursorCloudAgentsTransportOptions): CodingAgentTransport {
  const base = options.baseUrl ?? CURSOR_API_ORIGIN;
  if (base !== CURSOR_API_ORIGIN) throw new Error('cursor_base_url_unpinned');
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const pollMs = Math.max(MIN_POLL_MS, options.pollIntervalMs ?? 6_000);
  const requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
  const firstBackoff = Math.max(1_000, options.rateLimitBackoffMs ?? 10_000);
  const modelField = options.attestedModelField ?? null;
  const log = options.log ?? ((): void => undefined);

  /** The key, only for the duration of one request. A malformed key is treated as absent. */
  const readKey = (): string | null => {
    let key: string | null;
    try { key = options.getApiKey(); } catch { return null; }
    return typeof key === 'string' && key.length >= 8 && !/[\s\u0000-\u001f\u007f]/u.test(key) ? key : null;
  };
  /** Removes every occurrence of the key from a string the service returned. */
  const scrub = (text: string | null, key: string): string | null => (text === null ? null : text.split(key).join(REDACTED));

  async function send(method: 'GET' | 'POST', path: string, body: unknown, signal: AbortSignal | undefined): Promise<Sent & { key?: string }> {
    if (signal?.aborted === true) return { kind: 'not_sent', cause: 'aborted' };
    const key = readKey();
    if (key === null) return { kind: 'not_sent', cause: 'key_absent' };
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), requestTimeoutMs);
    const onAbort = (): void => timeout.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const res = await options.fetch(`${CURSOR_API_ORIGIN}${path}`, {
        method,
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: 'error',
        signal: timeout.signal,
      });
      const text = await readCappedBody(res);
      let parsed: unknown = null;
      if (text !== null && text.length > 0) { try { parsed = JSON.parse(text); } catch { parsed = null; } }
      const ra = res.headers?.get('retry-after') ?? null;
      const raSeconds = ra !== null && /^\d{1,6}$/u.test(ra.trim()) ? Number(ra.trim()) : null;
      return { kind: 'response', status: res.status, body: parsed, retryAfterMs: raSeconds === null ? null : Math.min(raSeconds * 1000, MAX_RETRY_AFTER_MS), key };
    } catch {
      // Never the error itself: its message can carry a URL, a header or a body.
      if (isAborted(signal)) return { kind: 'failed_in_flight', cause: 'aborted_in_flight' };
      return { kind: 'failed_in_flight', cause: timeout.signal.aborted ? 'timeout' : 'network' };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  /** GETs are safe to repeat: a 429 waits (Retry-After when given, else doubling backoff) and tries again, never past the deadline. */
  async function getWithBackoff(path: string, deadlineAtMs: number, signal: AbortSignal | undefined): Promise<Sent & { key?: string } | { kind: 'deadline' }> {
    let backoff = firstBackoff;
    for (;;) {
      const r = await send('GET', path, undefined, signal);
      if (r.kind !== 'response' || r.status !== 429) return r;
      const wait = r.retryAfterMs ?? backoff;
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      log(`cursor-transport rate-limited wait_ms=${wait}`);
      if (now() + wait > deadlineAtMs) return { kind: 'deadline' };
      await sleep(wait, signal);
      if (isAborted(signal)) return { kind: 'not_sent', cause: 'aborted' };
    }
  }

  const readModel = (record: unknown, key: string): string | null => {
    if (modelField === null) return null;
    let cur: unknown = record;
    for (const part of modelField.path) cur = isRecord(cur) ? cur[part] : undefined;
    if (typeof cur !== 'string' || cur === '') return null;
    const scrubbed = scrub(cur, key);
    return scrubbed !== null && REPORTED_MODEL_ID.test(scrubbed) ? scrubbed : null;
  };

  return {
    transportKind: CURSOR_CLOUD_AGENTS_TRANSPORT_KIND,

    async createRun(input: CodingAgentCreateInput, signal?: AbortSignal): Promise<CodingAgentCreateOutcome> {
      if (!/^bc-[A-Za-z0-9-]{1,100}$/u.test(input.agentId) || !/^[0-9a-f]{40}$/u.test(input.startingRef) || input.modelId === '' || input.promptText === '') {
        return { kind: 'not_sent', cause: 'request_invalid' };
      }
      const r = await send('POST', '/v1/agents', {
        prompt: { text: input.promptText },
        model: { id: input.modelId },
        repos: [{ url: input.repoUrl, startingRef: input.startingRef }],
        // The agent's branch is untrusted: no PR is opened, and it never pushes onto the starting ref.
        workOnCurrentBranch: false,
        autoCreatePR: false,
        mode: 'agent',
        name: input.name,
        agentId: input.agentId,
      }, signal);
      if (r.kind === 'not_sent') return { kind: 'not_sent', cause: r.cause };
      if (r.kind === 'failed_in_flight') {
        log(`cursor-transport create outcome-unknown cause=${r.cause}`);
        return { kind: 'outcome_unknown', cause: r.cause };
      }
      const s = r.status;
      if (s >= 200 && s < 300) {
        const agent = isRecord(r.body) && isRecord(r.body.agent) ? r.body.agent : null;
        const run = isRecord(r.body) && isRecord(r.body.run) ? r.body.run : null;
        const agentId = typeof agent?.id === 'string' ? agent.id : null;
        const runId = typeof run?.id === 'string' ? run.id : null;
        if (agentId === null || runId === null || !SAFE_ID.test(agentId) || !SAFE_ID.test(runId)) return { kind: 'outcome_unknown', cause: 'malformed_response' };
        return { kind: 'created', ref: { agentId, runId } };
      }
      if (s === 409) return { kind: 'conflict', status: 409 };
      if (s === 401) return { kind: 'rejected', status: s, cause: 'authentication' };
      if (s === 403) return { kind: 'rejected', status: s, cause: 'forbidden' };
      if (s === 429) return { kind: 'rejected', status: s, cause: 'rate_limited' };
      if (s === 402) return { kind: 'rejected', status: s, cause: 'credit' };
      if (s === 404) return { kind: 'rejected', status: s, cause: 'not_found' };
      if (s === 400 || s === 422) return { kind: 'rejected', status: s, cause: 'invalid_request' };
      // 5xx and anything unexpected: the service may have acted (docs: a server error "may still have" taken effect).
      log(`cursor-transport create outcome-unknown status=${s}`);
      return { kind: 'outcome_unknown', cause: 'server_error' };
    },

    async pollUntilTerminal(ref: CodingAgentRunRef, { deadlineAtMs, signal }): Promise<CodingAgentPollOutcome> {
      if (!SAFE_ID.test(ref.agentId) || !SAFE_ID.test(ref.runId)) return { kind: 'poll_failed', cause: 'malformed_response', polls: 0 };
      const path = `/v1/agents/${encodeURIComponent(ref.agentId)}/runs/${encodeURIComponent(ref.runId)}`;
      let polls = 0;
      let transient = 0;
      for (;;) {
        if (signal?.aborted === true) return { kind: 'aborted', polls };
        if (now() >= deadlineAtMs) return { kind: 'deadline', polls };
        const r = await getWithBackoff(path, deadlineAtMs, signal);
        polls += 1;
        if (r.kind === 'deadline') return { kind: 'deadline', polls };
        if (r.kind === 'not_sent') return r.cause === 'aborted' ? { kind: 'aborted', polls } : { kind: 'poll_failed', cause: 'key_absent', polls };
        if (r.kind === 'failed_in_flight') {
          if (r.cause === 'aborted_in_flight') return { kind: 'aborted', polls };
          transient += 1;
        } else if (r.status === 401 || r.status === 403) {
          return { kind: 'poll_failed', cause: 'authentication', polls };
        } else if (r.status === 404) {
          return { kind: 'poll_failed', cause: 'not_found', polls };
        } else if (r.status >= 200 && r.status < 300) {
          const status = isRecord(r.body) && typeof r.body.status === 'string' ? r.body.status : null;
          if (status !== null && TERMINAL.has(status as CodingAgentTerminalStatus)) return { kind: 'terminal', status: status as CodingAgentTerminalStatus, polls };
          if (status === null || !ACTIVE.has(status)) return { kind: 'poll_failed', cause: 'malformed_response', polls };
          transient = 0;
        } else if (r.status >= 500) {
          transient += 1;
        } else {
          return { kind: 'poll_failed', cause: 'unexpected_status', polls };
        }
        // Repeated transient read failures end the poll: the run's outcome is then unknown, which the provider says.
        if (transient >= 5) return { kind: 'poll_failed', cause: 'unexpected_status', polls };
        const wait = Math.min(pollMs, Math.max(0, deadlineAtMs - now()));
        if (wait <= 0) return { kind: 'deadline', polls };
        await sleep(wait, signal);
      }
    },

    async fetchResult(ref: CodingAgentRunRef, signal?: AbortSignal): Promise<CodingAgentResultOutcome> {
      if (!SAFE_ID.test(ref.agentId) || !SAFE_ID.test(ref.runId)) return { kind: 'unavailable', cause: 'ref_invalid' };
      const agentPath = `/v1/agents/${encodeURIComponent(ref.agentId)}`;
      const deadline = now() + 5 * 60_000;
      const run = await getWithBackoff(`${agentPath}/runs/${encodeURIComponent(ref.runId)}`, deadline, signal);
      if (run.kind !== 'response' || run.status < 200 || run.status >= 300 || !isRecord(run.body) || run.key === undefined) return { kind: 'unavailable', cause: 'run_unreadable' };
      const key = run.key;
      const body = run.body;
      if (body.status !== 'FINISHED') return { kind: 'unavailable', cause: 'run_not_finished' };
      const fullText = typeof body.result === 'string' ? scrub(body.result, key) : null;
      const finalTextTruncated = fullText !== null && fullText.length > MAX_FINAL_TEXT_CHARS;
      const finalText = fullText === null ? null : finalTextTruncated ? fullText.slice(0, MAX_FINAL_TEXT_CHARS) : fullText;
      const durationMs = count(body.durationMs);
      const branches: CodingAgentBranch[] = [];
      const git = isRecord(body.git) ? body.git : null;
      if (git !== null && git.branches !== undefined) {
        if (!Array.isArray(git.branches)) return { kind: 'unavailable', cause: 'branches_malformed' };
        for (const b of git.branches) {
          if (!isRecord(b) || typeof b.repoUrl !== 'string') return { kind: 'unavailable', cause: 'branches_malformed' };
          branches.push(Object.freeze({
            repoUrl: scrub(b.repoUrl, key) as string,
            branch: typeof b.branch === 'string' ? scrub(b.branch, key) : null,
            prUrl: safePrUrl(typeof b.prUrl === 'string' ? scrub(b.prUrl, key) : null),
          }));
        }
      }
      let usage: CodingAgentUsage | null = null;
      const u = await getWithBackoff(`${agentPath}/usage?runId=${encodeURIComponent(ref.runId)}`, deadline, signal);
      if (u.kind === 'response' && u.status >= 200 && u.status < 300 && isRecord(u.body) && Array.isArray(u.body.runs)) {
        const entry = u.body.runs.find((x) => isRecord(x) && x.id === ref.runId);
        const usageRecord = isRecord(entry) && isRecord(entry.usage) ? entry.usage : null;
        if (usageRecord !== null) {
          const fields = ['inputTokens', 'outputTokens', 'cacheWriteTokens', 'cacheReadTokens', 'totalTokens'] as const;
          const values = fields.map((f) => count(usageRecord[f]));
          if (values.every((v) => v !== null)) {
            const [inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens, totalTokens] = values as number[];
            usage = Object.freeze({ inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens, totalTokens }) as CodingAgentUsage;
          }
        }
      }
      let reportedModelId: string | null = null;
      if (modelField !== null) {
        if (modelField.record === 'run') reportedModelId = readModel(body, key);
        else {
          const a = await getWithBackoff(agentPath, deadline, signal);
          if (a.kind === 'response' && a.status >= 200 && a.status < 300) reportedModelId = readModel(a.body, key);
        }
      }
      return {
        kind: 'result', finalText, finalTextTruncated, durationMs, branches: Object.freeze(branches), usage, reportedModelId,
        reportedModelSource: reportedModelId === null || modelField === null ? null : `${modelField.record}.${modelField.path.join('.')}`,
      };
    },

    async cancelRun(ref: CodingAgentRunRef): Promise<'cancelled' | 'not_cancellable' | 'failed'> {
      if (!SAFE_ID.test(ref.agentId) || !SAFE_ID.test(ref.runId)) return 'failed';
      const r = await send('POST', `/v1/agents/${encodeURIComponent(ref.agentId)}/runs/${encodeURIComponent(ref.runId)}/cancel`, undefined, undefined);
      if (r.kind !== 'response') return 'failed';
      if (r.status >= 200 && r.status < 300) return 'cancelled';
      return r.status === 409 ? 'not_cancellable' : 'failed';
    },
  };
}
