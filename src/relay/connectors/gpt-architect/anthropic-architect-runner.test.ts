import { describe, expect, it } from 'vitest';

import { ARCHITECT_PLAN_SCHEMA } from './plan-schema';
import type { GptArchitectConfig } from './config';
import {
  ANTHROPIC_MESSAGES_URL, anthropicPinnedFetch, anthropicRateLimitEvidence, anthropicRequestId, anthropicStructuredOutputSchema,
  classifyAnthropicStatus, createJ1ArchitectRunner, runAnthropicArchitect,
} from './anthropic-architect-runner';

/**
 * THE ANTHROPIC AGENTIC ARCHITECT, PROVEN OFFLINE. Every request goes to an
 * injected fetch; nothing here opens a socket or spends anything.
 */

const KEY = 'FAKETESTNOTREAL-architect-key-0000';
const CONFIG: GptArchitectConfig = {
  apiKeyPresent: true, model: 'claude-opus-5-5', liveMode: true, maxOutputTokens: 20_000, timeoutMs: 1_000, unusable: [],
};
const REQUEST = { apiKey: KEY, config: CONFIG, instructions: 'CHARTER', input: 'PACKET' };
const PLAN = JSON.stringify({ objectiveSummary: 'x' });

interface Call { readonly url: string; readonly init: RequestInit }

function fetchReturning(response: () => Response, calls: Call[]): typeof fetch {
  return (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return response();
  }) as typeof fetch;
}

const okBody = (overrides: Record<string, unknown> = {}): string => JSON.stringify({
  id: 'msg_01FAKEANSWER', type: 'message', model: 'claude-opus-5-5', stop_reason: 'end_turn',
  content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: PLAN }],
  usage: { input_tokens: 1200, output_tokens: 800, cache_read_input_tokens: 0 },
  ...overrides,
});

const RATE_HEADERS = {
  'request-id': 'req_011CFAKEREQUEST0001',
  'anthropic-ratelimit-requests-limit': '50',
  'anthropic-ratelimit-requests-remaining': '0',
  'anthropic-ratelimit-tokens-limit': '90000',
  'anthropic-ratelimit-tokens-remaining': '12',
  'anthropic-ratelimit-input-tokens-limit': '80000',
  'anthropic-ratelimit-input-tokens-remaining': '10',
  'anthropic-ratelimit-output-tokens-limit': '10000',
  'anthropic-ratelimit-output-tokens-remaining': '2',
};

const errorResponse = (status: number, type: string, message: string, headers: Record<string, string> = RATE_HEADERS): Response =>
  new Response(JSON.stringify({ type: 'error', error: { type, message: `${message} ${KEY}` } }), { status, headers });

async function run(response: () => Response) {
  const calls: Call[] = [];
  const outcome = await runAnthropicArchitect(REQUEST, { fetch: fetchReturning(response, calls) });
  return { outcome, calls };
}

describe('the request: one POST to the pinned Messages API, the key in one header', () => {
  it('succeeds with the text answer, the served model, the usage and the request id', async () => {
    const { outcome, calls } = await run(() => new Response(okBody(), { status: 200, headers: RATE_HEADERS }));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.anthropic.com/v1/messages');
    expect(calls[0]!.init.method).toBe('POST');
    expect(calls[0]!.init.redirect).toBe('error');
    const headers = new Headers(calls[0]!.init.headers);
    expect(headers.get('x-api-key')).toBe(KEY);
    expect(headers.get('anthropic-version')).toBe('2023-06-01');
    expect(headers.get('authorization')).toBeNull();
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body).toMatchObject({
      model: 'claude-opus-5-5', max_tokens: 20_000, system: 'CHARTER',
      messages: [{ role: 'user', content: 'PACKET' }],
      output_config: { format: { type: 'json_schema', schema: anthropicStructuredOutputSchema(ARCHITECT_PLAN_SCHEMA) } },
    });
    expect(body.output_config.effort, 'no effort unless the mission declared one').toBeUndefined();
    expect(body.thinking, 'thinking is not sent').toBeUndefined();
    expect(body.tool_choice, 'no forced tool: a 400 on this model').toBeUndefined();
    expect(outcome).toMatchObject({
      ok: true, actualModel: 'claude-opus-5-5', responseId: 'msg_01FAKEANSWER', status: 'end_turn', outputText: PLAN,
      usage: { inputTokens: 1200, outputTokens: 800, cachedInputTokens: 0, reasoningTokens: null, totalTokens: null },
      providerRequestId: 'req_011CFAKEREQUEST0001', providerRequestUnavailableReason: null,
    });
  });

  it('sends the declared effort and the job schema when given', async () => {
    const calls: Call[] = [];
    const schema = { name: 'guidance', schema: { type: 'object', properties: {}, required: [], additionalProperties: false } };
    await runAnthropicArchitect({ ...REQUEST, config: { ...CONFIG, reasoningEffort: 'high' }, schema },
      { fetch: fetchReturning(() => new Response(okBody(), { status: 200 }), calls) });
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.output_config).toEqual({ format: { type: 'json_schema', schema: schema.schema }, effort: 'high' });
  });

  it('the served model is the response, never the request; an absent one is unattested (empty)', async () => {
    const other = await run(() => new Response(okBody({ model: 'claude-sonnet-5-5' }), { status: 200 }));
    expect(other.outcome.ok && other.outcome.actualModel).toBe('claude-sonnet-5-5');
    const none = await run(() => new Response(okBody({ model: undefined }), { status: 200 }));
    expect(none.outcome.ok && none.outcome.actualModel).toBe('');
  });

  it('the origin is pinned: any other origin or embedded credentials are refused before a request', () => {
    const never = (() => { throw new Error('must not be called'); }) as unknown as typeof fetch;
    for (const url of ['https://api.anthropic.com.evil.test/v1/messages', 'http://api.anthropic.com/v1/messages', 'https://user:pw@api.anthropic.com/v1/messages', 'not a url']) {
      expect(() => anthropicPinnedFetch(never, url, {}), url).toThrow('anthropic_base_url_unpinned');
    }
    expect(ANTHROPIC_MESSAGES_URL).toBe('https://api.anthropic.com/v1/messages');
  });

  it('a redirect is refused, not followed, and is one request', async () => {
    const calls: Call[] = [];
    const outcome = await runAnthropicArchitect(REQUEST, {
      fetch: (async (url: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(url), init: init ?? {} });
        expect(init?.redirect).toBe('error');
        throw new TypeError('fetch failed: unexpected redirect');
      }) as typeof fetch,
    });
    expect(calls).toHaveLength(1);
    expect(outcome).toMatchObject({ ok: false, failureClass: 'network_disconnected' });
  });
});

describe('refusals are classified by status exactly as the GPT runner does, plus the balance', () => {
  const cases: readonly [number, string, string, string][] = [
    [401, 'authentication_error', 'invalid x-api-key', 'authentication_failed'],
    [403, 'permission_error', 'not allowed', 'permission_denied'],
    [404, 'not_found_error', 'model: claude-opus-5-5', 'model_unavailable'],
    [429, 'rate_limit_error', 'rate limited', 'rate_limited'],
    [500, 'api_error', 'internal', 'provider_error'],
    [529, 'overloaded_error', 'the service is busy', 'provider_error'],
    [400, 'invalid_request_error', 'Your credit balance is too low to access the Anthropic API.', 'insufficient_credit'],
    [402, 'billing_error', 'payment required', 'insufficient_credit'],
    [400, 'invalid_request_error', 'messages: field required', 'provider_error'],
  ];
  for (const [status, type, message, expected] of cases) {
    it(`${status} ${type} -> ${expected}, one request, evidence kept, no key or provider text`, async () => {
      const { outcome, calls } = await run(() => errorResponse(status, type, message));
      expect(calls).toHaveLength(1);
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.failureClass).toBe(expected);
      expect(outcome).toMatchObject({
        refusal: {
          httpStatus: status, errorType: type, errorTypeUnparseable: false,
          requestId: 'req_011CFAKEREQUEST0001', requestIdUnavailableReason: null,
          rateLimit: {
            requestsLimit: 50, requestsRemaining: 0, tokensLimit: 90000, tokensRemaining: 12,
            inputTokensLimit: 80000, inputTokensRemaining: 10, outputTokensLimit: 10000, outputTokensRemaining: 2,
          },
        },
      });
      const text = JSON.stringify(outcome);
      expect(text, 'the key never appears').not.toContain('FAKETESTNOTREAL');
      expect(text, 'the provider message never travels').not.toContain(message);
    });
  }

  it('a timeout is a timeout, one request', async () => {
    const calls: Call[] = [];
    const outcome = await runAnthropicArchitect({ ...REQUEST, config: { ...CONFIG, timeoutMs: 5 } }, {
      fetch: ((url: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(url), init: init ?? {} });
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        });
      }) as typeof fetch,
    });
    expect(calls).toHaveLength(1);
    expect(outcome).toMatchObject({ ok: false, failureClass: 'timeout' });
  });

  it('a network error is network_disconnected, and its text never travels', async () => {
    const outcome = await runAnthropicArchitect(REQUEST, {
      fetch: (async () => { throw new Error(`ECONNRESET while sending ${KEY}`); }) as unknown as typeof fetch,
    });
    expect(outcome).toMatchObject({ ok: false, failureClass: 'network_disconnected' });
    expect(JSON.stringify(outcome)).not.toContain('FAKETESTNOTREAL');
    expect(JSON.stringify(outcome)).not.toContain('ECONNRESET');
  });

  it('MUTATION: insufficient credit is never the generic 400, the rate limit or a retryable class', () => {
    expect(classifyAnthropicStatus(400, 'invalid_request_error', true)).toBe('insufficient_credit');
    expect(classifyAnthropicStatus(400, 'invalid_request_error', false)).toBe('provider_error');
    expect(classifyAnthropicStatus(429, 'rate_limit_error', false)).toBe('rate_limited');
  });

  it('a refusal stop and a max_tokens stop are failures that carry what the call consumed', async () => {
    const refused = await run(() => new Response(okBody({ stop_reason: 'refusal' }), { status: 200 }));
    expect(refused.outcome).toMatchObject({ ok: false, failureClass: 'refused', providerStatus: 'refusal', usage: { inputTokens: 1200 } });
    const cut = await run(() => new Response(okBody({ stop_reason: 'max_tokens' }), { status: 200 }));
    expect(cut.outcome).toMatchObject({ ok: false, failureClass: 'incomplete_response', incompleteReason: 'max_tokens', usage: { outputTokens: 800 } });
    const empty = await run(() => new Response(okBody({ content: [{ type: 'thinking', thinking: '' }] }), { status: 200 }));
    expect(empty.outcome).toMatchObject({ ok: false, failureClass: 'malformed_output' });
  });

  it('no key refuses before any request', async () => {
    const calls: Call[] = [];
    const outcome = await runAnthropicArchitect({ ...REQUEST, apiKey: '  ' }, { fetch: fetchReturning(() => new Response(okBody()), calls) });
    expect(calls).toHaveLength(0);
    expect(outcome).toMatchObject({ ok: false, failureClass: 'authentication_failed' });
  });
});

describe('header evidence is bounded, and garbage is unavailable', () => {
  it('garbage request ids and counts become unavailable / null', async () => {
    const garbage = {
      'request-id': 'sk-ant-FAKETESTNOTREAL leaked',
      'anthropic-ratelimit-tokens-limit': '-5',
      'anthropic-ratelimit-tokens-remaining': '1e9',
      'anthropic-ratelimit-requests-limit': '99999999999999999999',
      'anthropic-ratelimit-requests-remaining': 'NaN',
    };
    const { outcome } = await run(() => errorResponse(429, 'rate_limit_error', 'slow down', garbage));
    if (outcome.ok) throw new Error('expected a refusal');
    expect(outcome.refusal).toMatchObject({
      requestId: null, requestIdUnavailableReason: 'request_id_header_unusable',
      rateLimit: { tokensLimit: null, tokensRemaining: null, requestsLimit: null, requestsRemaining: null, outputTokensLimit: null },
    });
    expect(JSON.stringify(outcome)).not.toContain('FAKETESTNOTREAL');
    expect(anthropicRequestId(new Headers())).toEqual({ requestId: null, reason: 'request_id_header_absent' });
    expect(anthropicRateLimitEvidence(new Headers()).tokensLimit).toBeNull();
  });

  it('an error type that is not a safe token is unparseable, never quoted', async () => {
    const { outcome } = await run(() => new Response(JSON.stringify({ error: { type: 'Bad Type!', message: 'x' } }), { status: 500 }));
    if (outcome.ok) throw new Error('expected a refusal');
    expect(outcome.refusal).toMatchObject({ errorType: null, errorTypeUnparseable: true });
    const { outcome: noBody } = await run(() => new Response('<html>', { status: 502 }));
    if (noBody.ok) throw new Error('expected a refusal');
    expect(noBody.refusal).toMatchObject({ httpStatus: 502, errorType: null, errorTypeUnparseable: false });
  });
});

describe('the J1 runner boundary', () => {
  it('createJ1ArchitectRunner returns the Messages runner, and makes exactly one request per call', async () => {
    const calls: Call[] = [];
    const runner = createJ1ArchitectRunner({ fetch: fetchReturning(() => errorResponse(429, 'rate_limit_error', 'slow'), calls) });
    const outcome = await runner(REQUEST);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(ANTHROPIC_MESSAGES_URL);
    expect(outcome).toMatchObject({ ok: false, failureClass: 'rate_limited' });
  });
});
