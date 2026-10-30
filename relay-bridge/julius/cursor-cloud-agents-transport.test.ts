import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { CURSOR_API_KEY_ENV_NAME, CURSOR_API_ORIGIN, CURSOR_ATTESTED_MODEL_FIELD, createCursorCloudAgentsTransport, cursorGlobalFetch, carriesCursorKey, cursorGlobalFetchIntact, cursorKeyForms, cursorTransportMode, isRequestEchoField, readAttestedModelId, readCappedBody, type CursorFetch, type CursorFetchResponse } from './cursor-cloud-agents-transport';
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
  it('F4 + PILOT Low 8: modelName (and its spellings) is a request echo and never attests', () => {
    for (const path of [['modelName'], ['model_name'], ['MODEL-NAME'], ['ModelName'], ['agent', 'modelName'], ['requestedModelName'], ['requested_model_name'], ['model-id']]) {
      for (const record of ['run', 'agent'] as const) {
        expect(isRequestEchoField({ record, path }), path.join('.')).toBe(true);
        expect(readAttestedModelId({ modelName: 'x1', model_name: 'x1', 'MODEL-NAME': 'x1', ModelName: 'x1', agent: { modelName: 'x1' }, requestedModelName: 'x1', requested_model_name: 'x1', 'model-id': 'x1' }, { record, path }, (v) => v)).toBeNull();
      }
    }
    /* Not over-broad: a segment that merely contains "model" is not an echo by this rule. */
    for (const path of [['servedModel'], ['modelServedBy'], ['models_used', 'x'], ['namedModel']]) expect(isRequestEchoField({ record: 'run', path }), path.join('.')).toBe(false);
    expect(readAttestedModelId({ servedModel: 'x1' }, { record: 'run', path: ['servedModel'] }, (v) => v)).toBe('x1');
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
      config: { ...GROK_BOT_CODER_CONFIG_DEFAULTS, pinnedModelId: 'fake-grok-coder-1', coderModelFamily: 'xai', reviewerModelFamily: 'openai', reviewerModelId: 'fake-gpt-reviewer-1', targetRepoUrl: 'https://github.com/example-org/example-target', runDeadlineMs: 60_000 }, reviewerPin: { modelId: 'fake-gpt-reviewer-1', modelFamily: 'openai' },
      transport, workspace: { baseRevision: async () => ({ ok: true, sha: BASE }), fetchBranch: async () => ({ ok: false, cause: 'x' }), applyFetched: async () => ({ ok: false, cause: 'x' }) },
      log: (l) => lines.push(l), now: () => 0,
    });
    const outcomes: unknown[] = [await provider.execute(request), await transport.fetchResult({ agentId: AGENT, runId: RUN })];
    expect(JSON.stringify(outcomes[1])).toContain('[REDACTED]');
    for (const route of [() => 'throw' as const, () => 'hang' as const, () => ({ status: 500, body: { message: SENTINEL } }), () => ({ status: 401, body: { message: SENTINEL } })]) {
      const t = make(route, { log: (l) => lines.push(l) });
      outcomes.push(await createGrokBotCodingAgentProvider({ config: { ...GROK_BOT_CODER_CONFIG_DEFAULTS, pinnedModelId: 'fake-grok-coder-1', coderModelFamily: 'xai', reviewerModelFamily: 'openai', reviewerModelId: 'fake-gpt-reviewer-1', targetRepoUrl: 'https://github.com/example-org/example-target', runDeadlineMs: 60_000 }, reviewerPin: { modelId: 'fake-gpt-reviewer-1', modelFamily: 'openai' }, transport: t.transport, workspace: { baseRevision: async () => ({ ok: true, sha: BASE }), fetchBranch: async () => ({ ok: false, cause: 'x' }), applyFetched: async () => ({ ok: false, cause: 'x' }) }, log: (l) => lines.push(l) }).execute(request));
      outcomes.push(await t.transport.pollUntilTerminal({ agentId: AGENT, runId: RUN }, { deadlineAtMs: 100 }) as never);
    }
    const everything = JSON.stringify({ outcomes, lines });
    expect(everything).not.toContain(SENTINEL);
    expect(everything).not.toContain(SENTINEL.slice(0, 16));
  });
  it('Skywalker N3: a run id that echoes the key (hex fragment) never reaches the provider\'s diagnostics', async () => {
    const hexFragment = Buffer.from(SENTINEL).toString('hex').slice(0, 32);
    const lines: string[] = [];
    const { transport } = make(() => ({ status: 201, body: { agent: { id: AGENT }, run: { id: `run-${hexFragment}`, agentId: AGENT, status: 'CREATING' } } }), { log: (l) => lines.push(l) });
    const request = {
      version: 'julius-coding-agent.v1', identity: { runId: 'r', missionId: 'm', taskId: 't', taskType: 'build', contextId: 'c' },
      workspacePath: '/w', contract: null, plan: 'P', sections: { acceptedGuidance: [], architecture: [], findings: [], continuation: [], missionContext: [] },
      permissions: { mayEditFiles: true, mayRunCommands: false, mayUseNetwork: false, permittedPaths: [], outOfScope: [], prohibitedActions: [] },
      requiredEvidence: [], budget: { usdMicros: null }, protocol: { participation: 'A', researchAuthority: 'R' },
    } as unknown as JuliusCodingAgentRequest;
    const out = await createGrokBotCodingAgentProvider({
      config: { ...GROK_BOT_CODER_CONFIG_DEFAULTS, pinnedModelId: 'fake-grok-coder-1', coderModelFamily: 'xai', reviewerModelFamily: 'openai', reviewerModelId: 'fake-gpt-reviewer-1', targetRepoUrl: 'https://github.com/example-org/example-target', runDeadlineMs: 60_000 }, reviewerPin: { modelId: 'fake-gpt-reviewer-1', modelFamily: 'openai' },
      transport, workspace: { baseRevision: async () => ({ ok: true, sha: BASE }), fetchBranch: async () => ({ ok: false, cause: 'x' }), applyFetched: async () => ({ ok: false, cause: 'x' }) },
      log: (l) => lines.push(l), now: () => 0,
    }).execute(request);
    expect(out).toMatchObject({ kind: 'failed' });
    const everything = JSON.stringify({ out, lines }).toLowerCase();
    expect(everything).not.toContain(hexFragment.slice(0, 16));
    expect(everything).not.toContain(SENTINEL.toLowerCase());
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
    expect(cursorGlobalFetchIntact()).toBe(true);
    // No key: nothing could be sent even if something tried.
    const live = createCursorCloudAgentsTransport({ fetch: cursorGlobalFetch, getApiKey: () => null });
    expect(cursorTransportMode(live)).toBe('live');
    expect(Object.isFrozen(live)).toBe(true);
    expect(cursorTransportMode(make(() => created).transport)).toBe('fake');
    expect(cursorTransportMode({ ...live })).toBe('fake');
    expect(cursorTransportMode({ transportKind: 'cursor_cloud_agents_v1' })).toBe('fake');
    expect(cursorTransportMode(null)).toBe('fake');
  });
  it('Skywalker N2b: replacing undici\'s global dispatcher after load is a replacement too: nothing is sent through it and the transport is fake for good', async () => {
    const SLOT = Symbol.for('undici.globalDispatcher.1');
    const g = globalThis as unknown as Record<symbol, unknown>;
    const original = g[SLOT];
    expect(original).toBeDefined();
    const live = createCursorCloudAgentsTransport({ fetch: cursorGlobalFetch, getApiKey: () => SENTINEL, now: () => 0, sleep: async () => undefined, requestTimeoutMs: 2_000 });
    expect(cursorTransportMode(live)).toBe('live');
    const dispatched: string[] = [];
    const stub = {
      dispatch(opts: { origin?: unknown; path?: unknown }, handler: { onError?: (e: Error) => void; onResponseError?: (c: unknown, e: Error) => void }) {
        dispatched.push(`${String(opts.origin)}${String(opts.path)}`);
        const e = new Error('stub dispatcher');
        if (typeof handler.onResponseError === 'function') handler.onResponseError(null, e); else handler.onError?.(e);
        return true;
      },
      close: async () => undefined, destroy: async () => undefined, on() { return this; }, off() { return this; }, once() { return this; }, emit: () => false,
    };
    g[SLOT] = stub;
    let builtWhileReplaced: unknown;
    try {
      expect(cursorGlobalFetchIntact()).toBe(false);
      expect(cursorTransportMode(live)).toBe('fake');
      builtWhileReplaced = createCursorCloudAgentsTransport({ fetch: cursorGlobalFetch, getApiKey: () => SENTINEL });
      expect(cursorTransportMode(builtWhileReplaced)).toBe('fake');
      expect(await live.createRun(input)).toEqual({ kind: 'not_sent', cause: 'transport_untrusted' });
      await expect(cursorGlobalFetch(`${CURSOR_API_ORIGIN}/v1/agents`, { method: 'GET', headers: {}, redirect: 'error' })).rejects.toThrow('cursor_global_fetch_replaced');
      expect(dispatched).toEqual([]);
    } finally {
      g[SLOT] = original;
    }
    expect(cursorGlobalFetchIntact()).toBe(true);
    expect(cursorTransportMode(live)).toBe('fake');
    expect(cursorTransportMode(builtWhileReplaced)).toBe('fake');
  });
  it('F7 part B (PILOT R5_liveStamp): a fake installed in globalThis.fetch is never called and never yields "live"', async () => {
    const spy: string[] = [];
    const orig = globalThis.fetch;
    const live = createCursorCloudAgentsTransport({ fetch: cursorGlobalFetch, getApiKey: () => SENTINEL, now: () => 0, sleep: async () => undefined });
    expect(cursorTransportMode(live)).toBe('live');
    const route = (u: string): Response => {
      spy.push(u);
      if (u.endsWith('/v1/agents')) return new Response(JSON.stringify(created.body), { status: 201 });
      if (u.endsWith(`/runs/${RUN}`)) return new Response(JSON.stringify({ id: RUN, status: 'FINISHED', result: 'done' }), { status: 200 });
      return new Response('{}', { status: 200 });
    };
    globalThis.fetch = (async (u: unknown) => route(String(u))) as typeof fetch;
    let builtAfter: ReturnType<typeof createCursorCloudAgentsTransport> | undefined;
    try {
      expect(cursorGlobalFetchIntact()).toBe(false);
      // Read while replaced: fake.
      expect(cursorTransportMode(live)).toBe('fake');
      // A transport built while replaced is never live.
      builtAfter = createCursorCloudAgentsTransport({ fetch: cursorGlobalFetch, getApiKey: () => SENTINEL });
      expect(cursorTransportMode(builtAfter)).toBe('fake');
      // Every call is refused before anything is sent; the fake is never reached.
      expect(await live.createRun(input)).toEqual({ kind: 'not_sent', cause: 'transport_untrusted' });
      expect(await live.pollUntilTerminal({ agentId: AGENT, runId: RUN }, { deadlineAtMs: 1e9 })).toEqual({ kind: 'poll_failed', cause: 'transport_untrusted', polls: 1 });
      expect(await live.fetchResult({ agentId: AGENT, runId: RUN })).toEqual({ kind: 'unavailable', cause: 'run_unreadable' });
      expect(await live.cancelRun({ agentId: AGENT, runId: RUN })).toBe('failed');
      // The adapter itself refuses too, if called directly.
      await expect(cursorGlobalFetch(`${CURSOR_API_ORIGIN}/v1/agents`, { method: 'GET', headers: {}, redirect: 'error' })).rejects.toThrow('cursor_global_fetch_replaced');
      expect(spy).toEqual([]);
    } finally {
      globalThis.fetch = orig;
    }
    // Once a transport has seen its fetch replaced, it stays "fake" even after the original is put back.
    expect(cursorGlobalFetchIntact()).toBe(true);
    expect(cursorTransportMode(live)).toBe('fake');
    // A transport BUILT while the global was replaced stays "fake" after the original is put back, even if it never sent.
    expect(cursorTransportMode(builtAfter)).toBe('fake');
  });
  it('F7 part B, end to end: the provider over a replaced global fetch records "fake", sends nothing and starts nothing', async () => {
    const spy: string[] = [];
    const orig = globalThis.fetch;
    const live = createCursorCloudAgentsTransport({ fetch: cursorGlobalFetch, getApiKey: () => SENTINEL, now: () => 0, sleep: async () => undefined });
    globalThis.fetch = (async (u: unknown) => { spy.push(String(u)); return new Response(JSON.stringify(created.body), { status: 201 }); }) as typeof fetch;
    try {
      const request = {
        version: 'julius-coding-agent.v1', identity: { runId: 'r', missionId: 'm', taskId: 't', taskType: 'build', contextId: 'c' },
        workspacePath: '/w', contract: null, plan: 'P', sections: { acceptedGuidance: [], architecture: [], findings: [], continuation: [], missionContext: [] },
        permissions: { mayEditFiles: true, mayRunCommands: false, mayUseNetwork: false, permittedPaths: ['src/'], outOfScope: [], prohibitedActions: [] },
        requiredEvidence: [], budget: { usdMicros: null }, protocol: { participation: 'A', researchAuthority: 'R' },
      } as unknown as JuliusCodingAgentRequest;
      const out = await createGrokBotCodingAgentProvider({
        config: { ...GROK_BOT_CODER_CONFIG_DEFAULTS, pinnedModelId: 'fake-grok-coder-1', coderModelFamily: 'xai', reviewerModelFamily: 'openai', reviewerModelId: 'fake-gpt-reviewer-1', targetRepoUrl: 'https://github.com/example-org/example-target', runDeadlineMs: 60_000 }, reviewerPin: { modelId: 'fake-gpt-reviewer-1', modelFamily: 'openai' },
        transport: live, workspace: { baseRevision: async () => ({ ok: true, sha: BASE }), fetchBranch: async () => ({ ok: false, cause: 'x' }), applyFetched: async () => ({ ok: false, cause: 'x' }) },
        now: () => 0,
      }).execute(request);
      expect(out).toMatchObject({ kind: 'failed', runtimeStarted: false, providerFailureClass: 'coder_grok_transport_untrusted' });
      expect(JSON.stringify(out)).not.toContain('"live"');
      expect(spy).toEqual([]);
    } finally {
      globalThis.fetch = orig;
    }
  });
  it('F7 part B, residual limit: a fake installed BEFORE the module loads is captured; one returning plain objects is still refused', async () => {
    const orig = globalThis.fetch;
    const spy: string[] = [];
    try {
      globalThis.fetch = (async (u: unknown) => { spy.push(String(u)); return { ok: true, status: 200, headers: new Headers(), body: null, text: async () => '{}' }; }) as never;
      vi.resetModules();
      const plain = await import('./cursor-cloud-agents-transport');
      await expect(plain.cursorGlobalFetch(`${CURSOR_API_ORIGIN}/v1/agents`, { method: 'GET', headers: {}, redirect: 'error' })).rejects.toThrow('cursor_global_fetch_response_foreign');
      expect(spy).toHaveLength(1);
      /* The documented residual: a pre-import fake that returns real Response objects cannot be told apart in-process. */
      globalThis.fetch = (async () => new Response('{}', { status: 200 })) as typeof fetch;
      vi.resetModules();
      const preImport = await import('./cursor-cloud-agents-transport');
      expect(preImport.cursorTransportMode(preImport.createCursorCloudAgentsTransport({ fetch: preImport.cursorGlobalFetch, getApiKey: () => null }))).toBe('live');
    } finally {
      globalThis.fetch = orig;
      vi.resetModules();
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

  it('M1a: the declared length alone decides — a small, readable body under an oversized Content-Length is still refused', async () => {
    const { res, stats } = streamed(100, { contentLength: String(CAP + 1) });
    expect(await readCappedBody(res)).toBeNull();
    expect(stats.pulled).toBe(0);
    const honest = streamed(100, { contentLength: '100' });
    expect(await readCappedBody(honest.res)).not.toBeNull();
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

  it('PILOT Low 9: the key echoed in hex (lower, upper, %XX), at every byte alignment inside a longer hex string, is scrubbed', async () => {
    const hex = Buffer.from(SENTINEL).toString('hex');
    const echoes: string[] = [];
    for (const pad of [0, 1, 2]) {
      const raw = Buffer.from(`${'p'.repeat(pad)}${SENTINEL}tail`).toString('hex');
      echoes.push(raw, raw.toUpperCase(), raw.replace(/(..)/gu, '%$1'), raw.toUpperCase().replace(/(..)/gu, '%$1'));
    }
    echoes.push(hex, hex.toUpperCase());
    for (const echo of echoes) {
      const r = await result({ result: `before ${echo} after` });
      expect(r.finalText, echo).toContain('[REDACTED]');
      expect((r.finalText ?? '').toLowerCase(), echo).not.toContain(hex);
      const decoded = (r.finalText ?? '').split(' ').map((w) => Buffer.from(w.replace(/%/gu, ''), 'hex').toString('latin1')).join(' ');
      expect(decoded, echo).not.toContain(SENTINEL);
      expect(decoded, echo).not.toContain(SENTINEL.slice(0, 16));
    }
    expect(cursorKeyForms(SENTINEL)).toEqual(expect.arrayContaining([hex, hex.toUpperCase(), hex.replace(/(..)/gu, '%$1'), hex.toUpperCase().replace(/(..)/gu, '%$1')]));
  });
  it('PILOT Low 9: a request-id header carrying the key in hex is dropped', async () => {
    const hexKey = Buffer.from(SENTINEL).toString('hex');
    const runBody = { id: RUN, status: 'FINISHED', result: 'done' };
    const r = await make((call) => (call.url.includes('/usage') ? { status: 404 } : { status: 200, body: runBody, requestId: `req-${hexKey}` })).transport.fetchResult({ agentId: AGENT, runId: RUN });
    expect(r.kind === 'result' && r.receipt?.requestId).toBeNull();
  });
  it('Skywalker L3/P5: the key upper-cased, lower-cased, space-separated, and its hex space-, colon- or dash-separated, is scrubbed', async () => {
    const hex = Buffer.from(SENTINEL).toString('hex');
    const pairs = hex.match(/../gu) ?? [];
    const echoes = [
      SENTINEL.toUpperCase(), SENTINEL.toLowerCase(), SENTINEL.split('').join(' '), SENTINEL.toUpperCase().split('').join(' '),
      SENTINEL.split('').join('\t'), pairs.join(' '), pairs.join(':'), pairs.join('-'), pairs.join(' ').toUpperCase(), pairs.join(':').toUpperCase(),
    ];
    for (const echo of echoes) {
      const r = await result({ result: `before ${echo} after` });
      expect(r.finalText, echo).toBe('before [REDACTED] after');
    }
    /* never over-broad: ordinary text, and a mere prefix of the key in finalText, are kept */
    expect((await result({ result: 'SENTINEL plain words 0123456789' })).finalText).toBe('SENTINEL plain words 0123456789');
  });
  it('Skywalker L3/P5: a request id carrying a TRUNCATED key echo (base64 or hex prefix, any case) is dropped; an ordinary one is kept', async () => {
    const b64 = Buffer.from(SENTINEL).toString('base64');
    const hex = Buffer.from(SENTINEL).toString('hex');
    for (const rid of [`rq-${b64.slice(0, 20)}`, `rq-${b64.slice(8, 28)}`, `rq-${hex.slice(0, 16)}`, `rq-${hex.slice(10, 30).toUpperCase()}`, `rq-${SENTINEL.slice(0, 16).toLowerCase()}`]) {
      const r = await make((call) => (call.url.includes('/usage') ? { status: 404 } : { status: 200, body: { id: RUN, status: 'FINISHED', result: 'done' }, requestId: rid })).transport.fetchResult({ agentId: AGENT, runId: RUN });
      expect(r.kind === 'result' && r.receipt?.requestId, rid).toBeNull();
    }
    const ok = await make((call) => (call.url.includes('/usage') ? { status: 404 } : { status: 200, body: { id: RUN, status: 'FINISHED', result: 'done' }, requestId: 'req_01HZX5Q7ABCDEF' })).transport.fetchResult({ agentId: AGENT, runId: RUN });
    expect(ok.kind === 'result' && ok.receipt?.requestId).toBe('req_01HZX5Q7ABCDEF');
    expect(carriesCursorKey('req_01HZX5Q7ABCDEF', SENTINEL)).toBe(false);
    expect(carriesCursorKey('anything', '')).toBe(false);
  });
  it('Skywalker N3: a create response whose run or agent id echoes the key (any form, a fragment, any case) is never handed back', async () => {
    const b64url = Buffer.from(SENTINEL).toString('base64url');
    const hex = Buffer.from(SENTINEL).toString('hex');
    const ids = [SENTINEL, SENTINEL.toLowerCase(), `run-${b64url.slice(0, 24)}`, `run-${hex.slice(4, 24)}`, `run-${hex.toUpperCase()}`];
    for (const bad of ids) {
      for (const body of [{ agent: { id: AGENT }, run: { id: bad, agentId: AGENT, status: 'CREATING' } }, { agent: { id: bad }, run: { id: RUN, agentId: bad, status: 'CREATING' } }]) {
        const { transport, lines } = make(() => ({ status: 201, body }));
        const out = await transport.createRun(input);
        expect(out, bad).toEqual({ kind: 'outcome_unknown', cause: 'malformed_response' });
        expect(JSON.stringify(out)).not.toContain(SENTINEL);
        expect(lines.join('\n')).toContain('cause=id_carries_key');
        expect(lines.join('\n')).not.toContain(SENTINEL);
      }
    }
    /* and the provider's diagnostics therefore never carry it: the run is outcome-unknown with no run id recorded */
    const { transport } = make(() => ({ status: 201, body: { agent: { id: AGENT }, run: { id: SENTINEL, agentId: AGENT, status: 'CREATING' } } }));
    expect(await transport.createRun(input)).not.toHaveProperty('ref');
  });
  it('F12: with a key whose encodings differ from it (reserved characters, + and / in base64), every form is scrubbed', async () => {
    const KEY = 'K3y?>~/&=+\u00fc-sentinel-0123456789';
    for (const pad of [0, 1, 2]) expect(/[+/]/u.test(Buffer.concat([Buffer.alloc(pad), Buffer.from(KEY)]).toString('base64')), `pad ${pad}`).toBe(true);
    expect(encodeURIComponent(KEY)).not.toBe(KEY);
    const echoes = [
      { echo: `q=${encodeURIComponent(KEY)}&x=1`, decode: (w: string) => { try { return decodeURIComponent(w); } catch { return w; } } },
      { echo: `q=${encodeURIComponent(KEY).replace(/%20/gu, '+')}&x=1`, decode: (w: string) => { try { return decodeURIComponent(w.replace(/\+/gu, ' ')); } catch { return w; } } },
      ...[0, 1, 2].flatMap((pad) => {
        const raw = Buffer.from(`${'p'.repeat(pad)}${KEY}tail`);
        return [
          { echo: raw.toString('base64'), decode: (w: string) => Buffer.from(w, 'base64').toString('utf8') },
          { echo: raw.toString('base64url'), decode: (w: string) => Buffer.from(w, 'base64url').toString('utf8') },
        ];
      }),
    ];
    for (const { echo, decode } of echoes) {
      const r = await result({ result: `before ${echo} after` }, { getApiKey: () => KEY });
      const text = r.finalText ?? '';
      expect(text, echo).toContain('[REDACTED]');
      for (const word of text.split(' ')) expect(decode(word), echo).not.toContain(KEY);
    }
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
