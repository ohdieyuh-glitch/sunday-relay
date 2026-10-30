import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { CURSOR_API_KEY_ENV_NAME, CURSOR_API_ORIGIN, CURSOR_ATTESTED_MODEL_FIELD, createCursorCloudAgentsTransport, cursorGlobalFetch, cursorKeyForms, cursorTransportMode, isRequestEchoField, readAttestedModelId, readCappedBody, type CursorFetch, type CursorFetchResponse } from './cursor-cloud-agents-transport';
import { GROK_BOT_CODER_CONFIG_DEFAULTS, createGrokBotCodingAgentProvider, type CodingAgentCreateInput } from './grok-bot-coding-provider';
import type { JuliusCodingAgentRequest } from '../../src/relay/mission/julius/julius-coding-agent';

/**
 * THE CURSOR CLOUD AGENTS TRANSPORT AGAINST A FAKE FETCH. No request leaves the process; the "key" is a sentinel string.
 * Response shapes follow https://cursor.com/docs/cloud-agent/api/endpoints.md; every value is fake.
 */

const SENTINEL = 'SENTINEL-KEY-0123456789-never-print';
const AGENT = 'bc-00000000-0000-4000-8000-000000000001';
const RUN = 'run-abc';
const BASE = 'c'.repeat(40);

type Call = { url: string; method: string; headers: Readonly<Record<string, string>>; body?: string; redirect: string };
type Reply = { status: number; body?: unknown; retryAfter?: string; requestId?: string } | 'throw' | 'hang';

function fakeFetch(route: (call: Call, n: number) => Reply) {
  const calls: Call[] = [];
  const fetch: CursorFetch = async (url, init) => {
    const call: Call = { url, method: init.method, headers: init.headers, redirect: init.redirect, ...(init.body === undefined ? {} : { body: init.body }) };
    calls.push(call);
    const r = route(call, calls.length);
    if (r === 'throw') throw new Error(`socket reset while sending ${init.headers.Authorization}`);
    if (r === 'hang') {
      return new Promise((_, reject) => { init.signal?.addEventListener('abort', () => reject(new Error(`aborted ${init.headers.Authorization}`))); });
    }
    return {
      ok: r.status >= 200 && r.status < 300, status: r.status,
      headers: { get: (n: string) => (n.toLowerCase() === 'retry-after' ? r.retryAfter ?? null : n.toLowerCase() === 'x-request-id' ? r.requestId ?? null : null) },
      text: async () => (r.body === undefined ? '' : JSON.stringify(r.body)),
    };
  };
  return { fetch, calls };
}

function clock() {
  let t = 0;
  const sleeps: number[] = [];
  return { now: () => t, sleep: async (ms: number) => { sleeps.push(ms); t += ms; }, sleeps, advance: (ms: number) => { t += ms; } };
}

const input: CodingAgentCreateInput = {
  idempotencyKey: 'k', agentId: AGENT, name: 'julius t', promptText: 'do it', modelId: 'fake-grok-coder-1', repoUrl: 'https://github.com/example-org/example-target', startingRef: BASE,
};
const created = { status: 201, body: { agent: { id: AGENT, latestRunId: RUN }, run: { id: RUN, agentId: AGENT, status: 'CREATING' } } };

const make = (route: (call: Call, n: number) => Reply, over: Partial<Parameters<typeof createCursorCloudAgentsTransport>[0]> = {}) => {
  const f = fakeFetch(route);
  const c = clock();
  const lines: string[] = [];
  const transport = createCursorCloudAgentsTransport({ fetch: f.fetch, getApiKey: () => SENTINEL, now: c.now, sleep: c.sleep, log: (l) => lines.push(l), requestTimeoutMs: 50, ...over });
  return { transport, f, c, lines };
};

describe('the pinned origin and the request shape', () => {
  it('refuses any base URL but https://api.cursor.com', () => {
    expect(() => createCursorCloudAgentsTransport({ fetch: fakeFetch(() => created).fetch, getApiKey: () => SENTINEL, baseUrl: 'https://api.x.ai' })).toThrow('cursor_base_url_unpinned');
    expect(CURSOR_API_ORIGIN).toBe('https://api.cursor.com');
    expect(CURSOR_API_KEY_ENV_NAME).toBe('CURSOR_API_KEY');
  });

  it('POSTs /v1/agents once with the pinned model, the client agentId, no PR and no push to the starting ref', async () => {
    const { transport, f } = make(() => created);
    expect(await transport.createRun(input)).toEqual({ kind: 'created', ref: { agentId: AGENT, runId: RUN } });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]?.url).toBe('https://api.cursor.com/v1/agents');
    const body = JSON.parse(f.calls[0]?.body ?? '{}');
    expect(body).toMatchObject({ model: { id: 'fake-grok-coder-1' }, agentId: AGENT, autoCreatePR: false, workOnCurrentBranch: false, repos: [{ url: input.repoUrl, startingRef: BASE }] });
    expect(f.calls[0]?.headers.Authorization).toBe(`Bearer ${SENTINEL}`);
    expect(f.calls.every((c) => c.url.startsWith(`${CURSOR_API_ORIGIN}/`))).toBe(true);
  });

  it('the same input sends the same agentId (idempotent create; a repeat is the service\'s 409)', async () => {
    const { transport, f } = make((_, n) => (n === 1 ? created : { status: 409, body: { error: { code: 'agent_id_conflict' } } }));
    await transport.createRun(input);
    expect(await transport.createRun(input)).toEqual({ kind: 'conflict', status: 409 });
    expect(JSON.parse(f.calls[0]?.body ?? '').agentId).toBe(JSON.parse(f.calls[1]?.body ?? '').agentId);
  });

  it('an unsafe input is never sent', async () => {
    const { transport, f } = make(() => created);
    expect(await transport.createRun({ ...input, startingRef: 'main' })).toEqual({ kind: 'not_sent', cause: 'request_invalid' });
    expect(await transport.createRun({ ...input, agentId: 'x' })).toEqual({ kind: 'not_sent', cause: 'request_invalid' });
    expect(f.calls).toHaveLength(0);
  });
});

describe('create outcomes: positive refusals vs outcome unknown; never retried', () => {
  it.each([
    [401, { kind: 'rejected', status: 401, cause: 'authentication' }],
    [403, { kind: 'rejected', status: 403, cause: 'forbidden' }],
    [429, { kind: 'rejected', status: 429, cause: 'rate_limited' }],
    [402, { kind: 'rejected', status: 402, cause: 'credit' }],
    [400, { kind: 'rejected', status: 400, cause: 'invalid_request' }],
    [500, { kind: 'outcome_unknown', cause: 'server_error' }],
    [503, { kind: 'outcome_unknown', cause: 'server_error' }],
  ])('HTTP %i, sent exactly once', async (status, expected) => {
    const { transport, f } = make(() => ({ status }));
    expect(await transport.createRun(input)).toEqual(expected);
    expect(f.calls).toHaveLength(1);
  });

  it('a network failure, a timeout and a malformed 2xx are outcome_unknown, sent exactly once', async () => {
    const net = make(() => 'throw');
    expect(await net.transport.createRun(input)).toEqual({ kind: 'outcome_unknown', cause: 'network' });
    expect(net.f.calls).toHaveLength(1);
    const slow = make(() => 'hang');
    expect(await slow.transport.createRun(input)).toEqual({ kind: 'outcome_unknown', cause: 'timeout' });
    expect(slow.f.calls).toHaveLength(1);
    const bad = make(() => ({ status: 200, body: { agent: {} } }));
    expect(await bad.transport.createRun(input)).toEqual({ kind: 'outcome_unknown', cause: 'malformed_response' });
  });

  it('an absent or malformed key is not_sent, and nothing reaches fetch', async () => {
    for (const key of [null, '', 'has space key', 'short']) {
      const { transport, f } = make(() => created, { getApiKey: () => key });
      expect(await transport.createRun(input)).toEqual({ kind: 'not_sent', cause: 'key_absent' });
      expect(f.calls).toHaveLength(0);
    }
    const throwing = make(() => created, { getApiKey: () => { throw new Error(SENTINEL); } });
    expect(await throwing.transport.createRun(input)).toEqual({ kind: 'not_sent', cause: 'key_absent' });
  });
});

describe('polling: bounded, deadline-respecting, rate-limit aware', () => {
  const runUrl = `${CURSOR_API_ORIGIN}/v1/agents/${AGENT}/runs/${RUN}`;
  it('polls until terminal at the configured interval', async () => {
    const { transport, f, c } = make((_, n) => ({ status: 200, body: { id: RUN, status: n < 3 ? 'RUNNING' : 'FINISHED' } }), { pollIntervalMs: 4_000 });
    expect(await transport.pollUntilTerminal({ agentId: AGENT, runId: RUN }, { deadlineAtMs: 100_000 })).toEqual({ kind: 'terminal', status: 'FINISHED', polls: 3 });
    expect(f.calls.map((x) => x.url)).toEqual([runUrl, runUrl, runUrl]);
    expect(c.sleeps).toEqual([4_000, 4_000]);
  });

  it('never polls faster than 3s, and stops at the deadline without sleeping past it', async () => {
    const { transport, c } = make(() => ({ status: 200, body: { status: 'RUNNING' } }), { pollIntervalMs: 10 });
    expect(await transport.pollUntilTerminal({ agentId: AGENT, runId: RUN }, { deadlineAtMs: 10_000 })).toMatchObject({ kind: 'deadline' });
    expect(c.sleeps.every((s) => s >= 1 && s <= 3_000)).toBe(true);
    expect(c.now()).toBeLessThanOrEqual(10_000);
  });

  it('L2: pollIntervalMs:1 still waits at least 3000 ms between polls (only the deadline may cut the last wait)', async () => {
    const { transport, c, f } = make(() => ({ status: 200, body: { status: 'RUNNING' } }), { pollIntervalMs: 1 });
    expect(await transport.pollUntilTerminal({ agentId: AGENT, runId: RUN }, { deadlineAtMs: 100_000 })).toMatchObject({ kind: 'deadline' });
    expect(c.sleeps.length).toBeGreaterThanOrEqual(30);
    expect(c.sleeps.slice(0, -1).every((s) => s >= 3_000)).toBe(true);
    expect(f.calls.length).toBeLessThanOrEqual(Math.ceil(100_000 / 3_000) + 1);
  });

  it('a 429 honours Retry-After, else backs off doubling to a cap, and gives up at the deadline', async () => {
    const ra = make((_, n) => (n === 1 ? { status: 429, retryAfter: '7' } : { status: 200, body: { status: 'FINISHED' } }));
    expect(await ra.transport.pollUntilTerminal({ agentId: AGENT, runId: RUN }, { deadlineAtMs: 1_000_000 })).toMatchObject({ kind: 'terminal' });
    expect(ra.c.sleeps[0]).toBe(7_000);
    const bo = make(() => ({ status: 429 }));
    expect(await bo.transport.pollUntilTerminal({ agentId: AGENT, runId: RUN }, { deadlineAtMs: 200_000 })).toMatchObject({ kind: 'deadline' });
    expect(bo.c.sleeps.slice(0, 4)).toEqual([10_000, 20_000, 40_000, 60_000]);
    expect(bo.c.now()).toBeLessThanOrEqual(200_000);
  });

  it('auth loss, a vanished run and an unknown status stop the poll', async () => {
    expect(await make(() => ({ status: 401 })).transport.pollUntilTerminal({ agentId: AGENT, runId: RUN }, { deadlineAtMs: 1e6 })).toMatchObject({ kind: 'poll_failed', cause: 'authentication' });
    expect(await make(() => ({ status: 404 })).transport.pollUntilTerminal({ agentId: AGENT, runId: RUN }, { deadlineAtMs: 1e6 })).toMatchObject({ kind: 'poll_failed', cause: 'not_found' });
    expect(await make(() => ({ status: 200, body: { status: 'WHATEVER' } })).transport.pollUntilTerminal({ agentId: AGENT, runId: RUN }, { deadlineAtMs: 1e6 })).toMatchObject({ kind: 'poll_failed', cause: 'malformed_response' });
  });

  it('repeated 5xx while polling ends after a bounded number of tries', async () => {
    const { transport, f } = make(() => ({ status: 502 }));
    expect(await transport.pollUntilTerminal({ agentId: AGENT, runId: RUN }, { deadlineAtMs: 1e9 })).toMatchObject({ kind: 'poll_failed' });
    expect(f.calls.length).toBe(5);
  });

  it('an aborted signal stops polling', async () => {
    const ac = new AbortController(); ac.abort();
    expect(await make(() => ({ status: 200, body: { status: 'RUNNING' } })).transport.pollUntilTerminal({ agentId: AGENT, runId: RUN }, { deadlineAtMs: 1e6, signal: ac.signal })).toMatchObject({ kind: 'aborted' });
  });
});

describe('result: branches, usage, and a served model only from a configured field', () => {
  const finished = { status: 200, body: { id: RUN, status: 'FINISHED', result: 'done', durationMs: 900, git: { branches: [{ repoUrl: 'github.com/example-org/example-target', branch: 'cursor/fix-1', prUrl: 'https://github.com/example-org/example-target/pull/1' }] }, model: { id: 'fake-grok-coder-1' } } };
  const usage = { status: 200, body: { runs: [{ id: RUN, usage: { inputTokens: 10, outputTokens: 4, cacheWriteTokens: 0, cacheReadTokens: 1, totalTokens: 15 } }] } };
  const route = (call: Call): Reply => (call.url.includes('/usage') ? usage : finished);

  it('by default reports NO served model, even when the body happens to carry one', async () => {
    const r = await make(route).transport.fetchResult({ agentId: AGENT, runId: RUN });
    expect(r).toMatchObject({ kind: 'result', finalText: 'done', durationMs: 900, reportedModelId: null, usage: { totalTokens: 15 } });
    if (r.kind === 'result') expect(r.branches[0]).toEqual({ repoUrl: 'github.com/example-org/example-target', branch: 'cursor/fix-1', prUrl: 'https://github.com/example-org/example-target/pull/1' });
  });

  it('F4: no option can name the field; the reviewed constant is null; a body carrying model.id on the run or agent is never reported', async () => {
    expect(CURSOR_ATTESTED_MODEL_FIELD).toBeNull();
    /* A caller passing the removed option is ignored. */
    const opts = { attestedModelField: { record: 'run', path: ['model', 'id'] } } as never;
    const r = await make(route, opts).transport.fetchResult({ agentId: AGENT, runId: RUN });
    expect(r).toMatchObject({ reportedModelId: null, reportedModelSource: null });
  });

  it('F4: request-echo fields never count, even if the constant were changed to name one', () => {
    for (const path of [['model', 'id'], ['model'], ['modelId'], ['Model_ID'], ['requestedModel'], ['config', 'model', 'name'], []]) {
      for (const record of ['run', 'agent'] as const) {
        expect(isRequestEchoField({ record, path }), path.join('.')).toBe(true);
        expect(readAttestedModelId({ model: { id: 'x1' }, modelId: 'x1', Model_ID: 'x1', requestedModel: 'x1', config: { model: { name: 'x1' } } }, { record, path }, (v) => v)).toBeNull();
      }
    }
    expect(isRequestEchoField({ record: 'run', path: ['servedBy', 'engine'] })).toBe(false);
  });
  it('missing usage is null, not zero', async () => {
    const r = await make((call) => (call.url.includes('/usage') ? { status: 404 } : finished)).transport.fetchResult({ agentId: AGENT, runId: RUN });
    expect(r).toMatchObject({ kind: 'result', usage: null });
  });

  it('a run that is not FINISHED has no result', async () => {
    expect(await make(() => ({ status: 200, body: { status: 'ERROR' } })).transport.fetchResult({ agentId: AGENT, runId: RUN })).toEqual({ kind: 'unavailable', cause: 'run_not_finished' });
  });

  it('cancel maps 409 run_not_cancellable', async () => {
    expect(await make(() => ({ status: 409 })).transport.cancelRun({ agentId: AGENT, runId: RUN })).toBe('not_cancellable');
    expect(await make(() => ({ status: 200, body: { id: RUN } })).transport.cancelRun({ agentId: AGENT, runId: RUN })).toBe('cancelled');
  });
});

describe('the key never leaves: not in logs, results, evidence or errors', () => {
  it('a sentinel key echoed by the service, by thrown errors and by every path is absent from everything observable', async () => {
    const echo = (call: Call): Reply => {
      if (call.method === 'POST' && call.url.endsWith('/v1/agents')) return created;
      if (call.url.includes('/usage')) return { status: 200, body: { runs: [], echo: SENTINEL } };
      return { status: 200, body: { status: 'FINISHED', result: `you sent ${SENTINEL}`, git: { branches: [{ repoUrl: 'github.com/example-org/example-target', branch: null, prUrl: `https://x/${SENTINEL}` }] } } };
    };
    const lines: string[] = [];
    const { transport } = make(echo, { log: (l) => lines.push(l) });
    const request = {
      version: 'julius-coding-agent.v1', identity: { runId: 'r', missionId: 'm', taskId: 't', taskType: 'build', contextId: 'c' },
      workspacePath: '/w', contract: null, plan: 'P', sections: { acceptedGuidance: [], architecture: [], findings: [], continuation: [], missionContext: [] },
      permissions: { mayEditFiles: true, mayRunCommands: false, mayUseNetwork: false, permittedPaths: [], outOfScope: [], prohibitedActions: [] },
      requiredEvidence: [], budget: { usdMicros: null }, protocol: { participation: 'A', researchAuthority: 'R' },
    } as unknown as JuliusCodingAgentRequest;
    const provider = createGrokBotCodingAgentProvider({
      config: { ...GROK_BOT_CODER_CONFIG_DEFAULTS, pinnedModelId: 'fake-grok-coder-1', coderModelFamily: 'a', reviewerModelFamily: 'b', reviewerModelId: 'fake-reviewer-model', targetRepoUrl: 'https://github.com/example-org/example-target', runDeadlineMs: 60_000 },
      transport, workspace: { baseRevision: async () => ({ ok: true, sha: BASE }), fetchBranch: async () => ({ ok: false, cause: 'x' }), applyFetched: async () => ({ ok: false, cause: 'x' }) },
      log: (l) => lines.push(l), now: () => 0,
    });
    const outcomes: unknown[] = [await provider.execute(request), await transport.fetchResult({ agentId: AGENT, runId: RUN })];
    expect(JSON.stringify(outcomes[1])).toContain('[REDACTED]');
    for (const route of [() => 'throw' as const, () => 'hang' as const, () => ({ status: 500, body: { message: SENTINEL } }), () => ({ status: 401, body: { message: SENTINEL } })]) {
      const t = make(route, { log: (l) => lines.push(l) });
      outcomes.push(await createGrokBotCodingAgentProvider({ config: { ...GROK_BOT_CODER_CONFIG_DEFAULTS, pinnedModelId: 'fake-grok-coder-1', coderModelFamily: 'a', reviewerModelFamily: 'b', reviewerModelId: 'fake-reviewer-model', targetRepoUrl: 'https://github.com/example-org/example-target', runDeadlineMs: 60_000 }, transport: t.transport, workspace: { baseRevision: async () => ({ ok: true, sha: BASE }), fetchBranch: async () => ({ ok: false, cause: 'x' }), applyFetched: async () => ({ ok: false, cause: 'x' }) }, log: (l) => lines.push(l) }).execute(request));
      outcomes.push(await t.transport.pollUntilTerminal({ agentId: AGENT, runId: RUN }, { deadlineAtMs: 100 }) as never);
    }
    const everything = JSON.stringify({ outcomes, lines });
    expect(everything).not.toContain(SENTINEL);
    expect(everything).not.toContain(SENTINEL.slice(0, 16));
  });
});

describe('F14: timeouts, the run deadline and aborts are labelled as such', () => {
  it('five in-flight timeouts (or 5xx) end the poll as transient_exhausted, not unexpected_status', async () => {
    for (const reply of ['hang' as const, 'throw' as const, { status: 503 }]) {
      const r = await make(() => reply).transport.pollUntilTerminal({ agentId: AGENT, runId: RUN }, { deadlineAtMs: 1e9 });
      expect(r, JSON.stringify(reply)).toEqual({ kind: 'poll_failed', cause: 'transient_exhausted', polls: 5 });
    }
    expect(await make(() => ({ status: 418 })).transport.pollUntilTerminal({ agentId: AGENT, runId: RUN }, { deadlineAtMs: 1e9 })).toMatchObject({ cause: 'unexpected_status' });
  });
  it('fetchResult never waits past the run deadline it is given', async () => {
    const { transport, c } = make(() => ({ status: 429, retryAfter: '60' }));
    expect(await transport.fetchResult({ agentId: AGENT, runId: RUN }, undefined, { deadlineAtMs: 30_000 })).toEqual({ kind: 'unavailable', cause: 'deadline' });
    expect(c.now()).toBeLessThanOrEqual(30_000);
    /* Without a run deadline the five-minute cap still holds. */
    const capped = make(() => ({ status: 429, retryAfter: '120' }));
    expect(await capped.transport.fetchResult({ agentId: AGENT, runId: RUN })).toEqual({ kind: 'unavailable', cause: 'deadline' });
    expect(capped.c.now()).toBeLessThanOrEqual(5 * 60_000);
  });
  it('an abort before or during fetchResult reads as aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    expect(await make(() => ({ status: 200, body: {} })).transport.fetchResult({ agentId: AGENT, runId: RUN }, ac.signal)).toEqual({ kind: 'unavailable', cause: 'aborted' });
    const mid = new AbortController();
    const p = make(() => 'hang', { requestTimeoutMs: 60_000 }).transport.fetchResult({ agentId: AGENT, runId: RUN }, mid.signal);
    setTimeout(() => mid.abort(), 5);
    expect(await p).toEqual({ kind: 'unavailable', cause: 'aborted' });
  });
});

describe('F15/E8: the mode label and the receipt', () => {
  it('only a transport over the real global fetch is live; constructing one sends nothing; it is frozen', () => {
    const spy: string[] = [];
    const orig = globalThis.fetch;
    globalThis.fetch = (async (u: string) => { spy.push(String(u)); throw new Error('no network in tests'); }) as never;
    try {
      const live = createCursorCloudAgentsTransport({ fetch: cursorGlobalFetch, getApiKey: () => null });
      expect(cursorTransportMode(live)).toBe('live');
      expect(Object.isFrozen(live)).toBe(true);
      expect(cursorTransportMode(make(() => created).transport)).toBe('fake');
      expect(cursorTransportMode({ ...live })).toBe('fake');
      expect(cursorTransportMode({ transportKind: 'cursor_cloud_agents_v1' })).toBe('fake');
      expect(cursorTransportMode(null)).toBe('fake');
      expect(spy).toEqual([]);
    } finally {
      globalThis.fetch = orig;
    }
  });
  it('the result carries run id, createdAt, a request id header and the response body sha256', async () => {
    const runBody = { id: RUN, status: 'FINISHED', result: 'done', createdAt: '2026-10-30T16:00:00.000Z' };
    const r = await make((call) => (call.url.includes('/usage') ? { status: 404 } : { status: 200, body: runBody, requestId: 'req_abc-123' })).transport.fetchResult({ agentId: AGENT, runId: RUN });
    expect(r.kind === 'result' && r.receipt).toEqual({ runId: RUN, createdAt: '2026-10-30T16:00:00.000Z', requestId: 'req_abc-123', responseSha256: createHash('sha256').update(JSON.stringify(runBody)).digest('hex') });
  });
  it('a malformed request id, createdAt or run id is not carried; a request id holding the key is dropped', async () => {
    const runBody = { id: '../x', status: 'FINISHED', result: 'done', createdAt: 'yesterday' };
    for (const requestId of ['has space', `x${SENTINEL}`, 'a'.repeat(200)]) {
      const r = await make((call) => (call.url.includes('/usage') ? { status: 404 } : { status: 200, body: runBody, requestId })).transport.fetchResult({ agentId: AGENT, runId: RUN });
      expect(r.kind === 'result' && r.receipt, requestId).toMatchObject({ runId: null, createdAt: null, requestId: null });
    }
  });
});

describe('L2: no request ever follows a redirect', () => {
  it('every call in a create, poll, result, usage and cancel cycle is made with redirect:error', async () => {
    const finished = { status: 200, body: { id: RUN, status: 'FINISHED', result: 'done', git: { branches: [] } } };
    const { transport, f } = make((call, n) => (n === 1 ? created : call.url.includes('/usage') ? { status: 200, body: { runs: [] } } : finished));
    await transport.createRun(input);
    await transport.pollUntilTerminal({ agentId: AGENT, runId: RUN }, { deadlineAtMs: 1e6 });
    await transport.fetchResult({ agentId: AGENT, runId: RUN });
    await transport.cancelRun({ agentId: AGENT, runId: RUN });
    expect(f.calls.length).toBeGreaterThanOrEqual(5);
    for (const call of f.calls) expect(call.redirect).toBe('error');
  });
});

describe('M1: the 2 MiB body cap holds while streaming, and an oversized body is never parsed', () => {
  const CAP = 2 * 1024 * 1024;
  const CHUNK = 64 * 1024;
  /** A body that would parse as a FINISHED run if it were read whole. */
  function streamed(totalBytes: number, opts: { contentLength?: string; throwOnRead?: boolean } = {}) {
    const stats = { pulled: 0, cancelled: false, textCalled: false };
    const head = new TextEncoder().encode('{"status":"FINISHED","result":"');
    const tail = new TextEncoder().encode('"}');
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (opts.throwOnRead === true) throw new Error('the body must not be read');
        if (sent >= totalBytes) { controller.close(); return; }
        let chunk: Uint8Array;
        if (sent === 0) chunk = head;
        else if (sent + CHUNK >= totalBytes - tail.length) chunk = new Uint8Array([...new Uint8Array(Math.max(0, totalBytes - tail.length - sent)).fill(97), ...tail]);
        else chunk = new Uint8Array(CHUNK).fill(97);
        sent += chunk.byteLength;
        stats.pulled += chunk.byteLength;
        controller.enqueue(chunk);
      },
      cancel() { stats.cancelled = true; },
    });
    const res: CursorFetchResponse = {
      ok: true, status: 200, body,
      headers: { get: (n: string) => (n.toLowerCase() === 'content-length' ? opts.contentLength ?? null : null) },
      text: async () => { stats.textCalled = true; throw new Error('text() must not be used when a stream exists'); },
    };
    return { res, stats };
  }
  const transportFor = (res: CursorFetchResponse) => {
    const c = clock();
    return createCursorCloudAgentsTransport({ fetch: async () => res, getApiKey: () => SENTINEL, now: c.now, sleep: c.sleep, requestTimeoutMs: 5_000 });
  };

  it('a 3 MiB streamed body is cut at the cap, cancelled, and never parsed (the poll sees no status)', async () => {
    const { res, stats } = streamed(3 * CAP / 2);
    const out = await transportFor(res).pollUntilTerminal({ agentId: AGENT, runId: RUN }, { deadlineAtMs: 1e6 });
    expect(out).toMatchObject({ kind: 'poll_failed', cause: 'malformed_response' });
    expect(stats.cancelled).toBe(true);
    /* The stream may queue one chunk ahead (highWaterMark 1); nothing beyond that is pulled. */
    expect(stats.pulled).toBeLessThanOrEqual(CAP + 2 * CHUNK);
    expect(stats.textCalled).toBe(false);
  });

  it('a declared Content-Length over the cap is refused without reading a byte', async () => {
    const { res, stats } = streamed(100, { contentLength: String(CAP + 1), throwOnRead: true });
    expect(await readCappedBody(res)).toBeNull();
    expect(stats.pulled).toBe(0);
    expect(stats.textCalled).toBe(false);
  });

  it('a body of exactly the cap is read and parsed; one byte more is not', async () => {
    const ok = streamed(CAP);
    const atCap = await readCappedBody(ok.res);
    expect(atCap).not.toBeNull();
    expect(JSON.parse(atCap as string)).toMatchObject({ status: 'FINISHED' });
    expect(await readCappedBody(streamed(CAP + 1).res)).toBeNull();
  });

  it('the text() fallback (no stream) is still capped before parsing', async () => {
    const big: CursorFetchResponse = { ok: true, status: 200, text: async () => `{"status":"FINISHED","x":"${'a'.repeat(CAP)}"}` };
    expect(await readCappedBody(big)).toBeNull();
    const small: CursorFetchResponse = { ok: true, status: 200, text: async () => '{"status":"RUNNING"}' };
    expect(await readCappedBody(small)).toBe('{"status":"RUNNING"}');
  });
});

describe('L4: service strings that reach evidence are bounded', () => {
  const usage = { status: 200, body: { runs: [] } };
  const result = async (run: Record<string, unknown>, over: Partial<Parameters<typeof createCursorCloudAgentsTransport>[0]> = {}) => {
    const r = await make((call) => (call.url.includes('/usage') ? usage : { status: 200, body: { id: RUN, status: 'FINISHED', ...run } }), over).transport.fetchResult({ agentId: AGENT, runId: RUN });
    if (r.kind !== 'result') throw new Error(`expected result, got ${r.kind}`);
    return r;
  };
  const branch = (prUrl: unknown) => ({ git: { branches: [{ repoUrl: 'github.com/example-org/example-target', branch: 'cursor/x', prUrl }] } });

  it('F12: the key echoed URL-encoded, or in base64/base64url at any alignment inside a longer string, is scrubbed', async () => {
    const echoes = [
      `q=${encodeURIComponent(SENTINEL)}&x=1`,
      ...[0, 1, 2].flatMap((pad) => {
        const raw = Buffer.from(`${'p'.repeat(pad)}${SENTINEL}tail`);
        return [raw.toString('base64'), raw.toString('base64url')];
      }),
      Buffer.from(SENTINEL).toString('base64'),
    ];
    for (const echo of echoes) {
      const r = await result({ result: `before ${echo} after` });
      for (const form of cursorKeyForms(SENTINEL)) expect(r.finalText, echo).not.toContain(form);
      expect(r.finalText, echo).toContain('[REDACTED]');
      const decoded = (r.finalText ?? '').split(' ').map((w) => Buffer.from(w, 'base64').toString('latin1')).join(' ');
      expect(decoded, echo).not.toContain(SENTINEL);
      expect(decodeURIComponent((r.finalText ?? '').replace(/%(?![0-9A-F]{2})/giu, ''))).not.toContain(SENTINEL);
    }
    expect(cursorKeyForms('')).toEqual([]);
    expect(cursorKeyForms('abc')).toEqual([]);
  });

  it('prUrl survives only as https://github.com/... of at most 300 characters', async () => {
    expect((await result(branch('https://github.com/example-org/example-target/pull/7'))).branches[0]?.prUrl).toBe('https://github.com/example-org/example-target/pull/7');
    for (const bad of ['http://github.com/a/b/pull/1', 'https://evil.example/a/b/pull/1', 'https://github.com.evil.example/a', 'https://github.com/a/b/pull/1 inject', `https://github.com/${'a'.repeat(300)}`, 'javascript:alert(1)', 'https://github.com/a\nb']) {
      expect((await result(branch(bad))).branches[0]?.prUrl, bad).toBeNull();
    }
  });

  it('finalText is truncated to its cap, with a flag', async () => {
    const long = await result({ result: 'x'.repeat(20_000) });
    expect(long.finalText?.length).toBe(16_000);
    expect(long.finalTextTruncated).toBe(true);
    const short = await result({ result: 'done' });
    expect(short).toMatchObject({ finalText: 'done', finalTextTruncated: false });
  });

  it('a reported model id must have the model-id shape, or it is not reported', () => {
    const field = { record: 'run' as const, path: ['servedBy', 'engine'] };
    expect(readAttestedModelId({ servedBy: { engine: 'fake-grok-coder-1' } }, field, (v) => v)).toBe('fake-grok-coder-1');
    for (const bad of ['a'.repeat(129), 'model with space', 'model\nnext', '-leading', 'mödel']) {
      expect(readAttestedModelId({ servedBy: { engine: bad } }, field, (v) => v), bad).toBeNull();
    }
    expect(readAttestedModelId({ servedBy: { engine: 'fake-1' } }, field, () => null)).toBeNull();
  });
});
