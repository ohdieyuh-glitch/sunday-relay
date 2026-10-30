import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { ARCHITECT_PLAN_SCHEMA } from './plan-schema';
import type { GptArchitectConfig } from './config';
import {
  ANTHROPIC_MESSAGES_URL, anthropicPinnedFetch, anthropicRateLimitEvidence, anthropicRequestId, anthropicStructuredOutputSchema,
  classifyAnthropicStatus, createJ1ArchitectRunner, PROVIDER_MESSAGE_EXCERPT_MAX, providerMessageEvidence, runAnthropicArchitect,
  sanitizeProviderExcerpt,
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
      const { providerMessage, ...rest } = outcome.refusal!;
      expect(JSON.stringify({ ...outcome, refusal: rest }), 'the provider message travels only as sanitized evidence').not.toContain(message);
      expect(providerMessage?.excerpt, 'the key-length token is redacted out of the excerpt').toBe(message === 'invalid x-api-key' ? 'invalid [redacted]' : `${message} [redacted]`);
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

/**
 * THE PROVIDER MESSAGE AS SANITIZED EVIDENCE (run 40698923582's architect 400
 * was undiagnosable because the message was dropped). Every fake body below is
 * offline; the class of every one is asserted unchanged.
 */
describe('the provider message survives only as sanitized evidence, and never changes the class', () => {
  const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
  const FAKE_ANT_KEY = 'sk-ant-api03-FAKE0000';
  const HEX40 = 'deadbeef'.repeat(5);
  const body = (message: string, details?: Record<string, unknown>): string =>
    JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message, ...(details === undefined ? {} : { details }) } });
  const EXTRA_HEADERS = { 'x-fake-trace': 'FAKEHEADERVALUE01', 'set-cookie': 'session=FAKECOOKIE01' };
  const respond = (status: number, raw: string): (() => Response) => () => new Response(raw, { status, headers: { ...RATE_HEADERS, ...EXTRA_HEADERS } });
  async function refusalOf(status: number, raw: string, request: typeof REQUEST = REQUEST) {
    const calls: Call[] = [];
    const outcome = await runAnthropicArchitect(request, { fetch: fetchReturning(respond(status, raw), calls) });
    expect(calls).toHaveLength(1);
    if (outcome.ok || outcome.refusal === undefined) throw new Error('expected a refusal');
    return { ...outcome, refusal: outcome.refusal };
  }
  const assertNoRawOrHeaders = (outcome: unknown, raw: string): void => {
    const text = JSON.stringify(outcome);
    if (raw.length > 0) expect(text, 'the raw body never travels').not.toContain(raw);
    for (const header of [...Object.keys(RATE_HEADERS), ...Object.keys(EXTRA_HEADERS)]) expect(text, `header ${header} never travels`).not.toContain(header);
    for (const value of Object.values(EXTRA_HEADERS)) expect(text, 'no header value travels').not.toContain(value);
  };

  const cases: readonly [string, string, string, string][] = [
    ['spend limit', 'You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC.', 'spend_limit', 'provider_error'],
    ['workspace spend limit', 'You have reached your specified workspace API usage limits.', 'spend_limit', 'provider_error'],
    ['credit too low', 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.', 'credit_too_low', 'insufficient_credit'],
    ['schema too complex', 'Schema is too complex for compilation. Simplify your schema.', 'schema_too_complex', 'provider_error'],
    ['workspace header', 'anthropic-workspace-id header is not valid for this organization', 'workspace_header', 'provider_error'],
    ['other', 'messages.0.content: Input should be a valid list', 'other', 'provider_error'],
  ];
  for (const [label, message, messageClass, failureClass] of cases) {
    it(`${label}: class ${messageClass}, failure class ${failureClass} unchanged, length and digest of the full message`, async () => {
      const raw = body(message, { error_code: 'fake_code.v1' });
      const outcome = await refusalOf(400, raw);
      expect(outcome.failureClass).toBe(failureClass);
      expect(outcome.failureClass).toBe(classifyAnthropicStatus(400, 'invalid_request_error', /credit balance is too low/iu.test(message)));
      expect(outcome.refusal.providerMessage).toEqual({
        messageClass, errorCode: 'fake_code.v1', errorCodeUnusable: false, excerpt: message, excerptOmitted: null,
        messageBytes: Buffer.byteLength(message, 'utf8'), messageSha256: sha(message),
      });
      assertNoRawOrHeaders(outcome, raw);
    });
  }

  it('MUTATION: an sk-ant key and a 40-character hex token are redacted; neither survives anywhere', async () => {
    const message = `bad key ${FAKE_ANT_KEY} trace ${HEX40} x-api-key: FAKEsecret9 Bearer FAKEbearer1 end`;
    const outcome = await refusalOf(400, body(message));
    expect(outcome.refusal.providerMessage?.excerpt).toBe('bad key [redacted] trace [redacted] [redacted] [redacted] end');
    const text = JSON.stringify(outcome);
    for (const secret of [FAKE_ANT_KEY, 'FAKE0000', HEX40, 'deadbeef', 'FAKEsecret9', 'FAKEbearer1']) expect(text).not.toContain(secret);
    expect(outcome.refusal.providerMessage?.messageSha256, 'the digest is of the unredacted message').toBe(sha(message));
  });

  it('MUTATION: a 10 KB message is excerpted to at most 240 characters; length and digest cover all of it; the class is unchanged', async () => {
    const message = `Schema is too complex for compilation. ${'word '.repeat(2_048)}TAILMARKER`;
    expect(message.length).toBeGreaterThan(10_000);
    const raw = body(message, { error_code: 'grammar_too_large' });
    const outcome = await refusalOf(400, raw);
    // The 8,192-character classifying read cannot parse a body this long; that is unchanged: no type, status-only class.
    expect(outcome.refusal.errorType).toBeNull();
    expect(outcome.failureClass).toBe(classifyAnthropicStatus(400, null, false));
    const evidence = outcome.refusal.providerMessage!;
    expect(evidence.excerpt!.length).toBeLessThanOrEqual(PROVIDER_MESSAGE_EXCERPT_MAX);
    expect(evidence.excerpt!.length).toBe(PROVIDER_MESSAGE_EXCERPT_MAX);
    expect(evidence.excerpt).not.toContain('TAILMARKER');
    expect(evidence).toMatchObject({
      messageClass: 'schema_too_complex', errorCode: 'grammar_too_large', messageBytes: message.length, messageSha256: sha(message),
    });
    assertNoRawOrHeaders(outcome, raw);
  });

  it('MUTATION: a credit message beyond the 8,192-character classifying read is NOT insufficient_credit, exactly as before', async () => {
    const message = `Your credit balance is too low to access the Anthropic API. ${'x '.repeat(5_000)}`;
    const outcome = await refusalOf(400, body(message));
    expect(outcome.failureClass, 'the evidence parse never feeds the class').toBe('provider_error');
    expect(outcome.refusal.providerMessage?.messageClass, 'though the evidence still names it').toBe('credit_too_low');
  });

  it('non-ASCII and control characters become printable ASCII on one line; bytes count UTF-8', async () => {
    const message = 'line1\nline2\r\n\ttab \u0000nul \u001b[31mred caf\u00e9 \u2028sep \ud83d\ude00 "q" \\ end';
    const outcome = await refusalOf(400, body(message));
    const evidence = outcome.refusal.providerMessage!;
    expect(evidence.excerpt).toMatch(/^[\x20-\x7e]*$/u);
    expect(evidence.excerpt).toBe('line1 line2 tab nul [31mred caf? sep ? "q" \\ end');
    expect(evidence.messageBytes).toBe(Buffer.byteLength(message, 'utf8'));
    expect(evidence.messageSha256).toBe(sha(message));
  });

  it('an error_code that is not a safe token is unusable, never quoted; an absent one is null', async () => {
    const bad = await refusalOf(400, body('x', { error_code: 'has space "and quote"' }));
    expect(bad.refusal.providerMessage).toMatchObject({ errorCode: null, errorCodeUnusable: true });
    expect(JSON.stringify(bad)).not.toContain('and quote');
    const none = await refusalOf(400, body('x'));
    expect(none.refusal.providerMessage).toMatchObject({ errorCode: null, errorCodeUnusable: false });
  });

  it('a non-JSON body and an empty body carry no message evidence, and classify exactly as before', async () => {
    const html = '<html><body>Bad Gateway sk-ant-api03-FAKE0000</body></html>';
    const nonJson = await refusalOf(400, html);
    expect(nonJson.refusal).toMatchObject({ errorType: null, errorTypeUnparseable: false, providerMessage: null });
    expect(nonJson.failureClass).toBe(classifyAnthropicStatus(400, null, false));
    assertNoRawOrHeaders(nonJson, html);
    expect(JSON.stringify(nonJson)).not.toContain('Bad Gateway');
    const empty = await refusalOf(400, '');
    expect(empty.refusal).toMatchObject({ errorType: null, providerMessage: null });
    expect(empty.failureClass).toBe(classifyAnthropicStatus(400, null, false));
  });

  it('the sanitizer redacts before it cuts, so no key straddles the 240-character edge', () => {
    // A 40-character token starting at 220 would leave a 17-character, unredactable fragment if the cut came first.
    const message = `${'a '.repeat(110)}${HEX40} tail`;
    const excerpt = sanitizeProviderExcerpt(message);
    expect(excerpt.length).toBeLessThanOrEqual(PROVIDER_MESSAGE_EXCERPT_MAX);
    expect(excerpt).not.toContain('deadbeef');
    expect(excerpt.endsWith('a [redacted] tail')).toBe(true);
    expect(sanitizeProviderExcerpt(`${'b '.repeat(112)}${FAKE_ANT_KEY}`)).not.toContain('FAKE');
  });

  it('providerMessageEvidence never throws on garbage', async () => {
    for (const raw of [null, '', 'null', '[]', '{"error":null}', '{"error":"x"}', '{"error":{"message":42}}', '{'.repeat(70_000)]) {
      const evidence = await providerMessageEvidence(raw);
      if (evidence !== null) expect(evidence.excerpt).toMatch(/^[\x20-\x7e]*$/u);
    }
    expect(await providerMessageEvidence('{'.repeat(70_000)), 'beyond the evidence bound: null').toBeNull();
    expect(await providerMessageEvidence('{"error":{"message":42}}')).toMatchObject({ messageClass: 'other', excerpt: '', messageBytes: 0 });
    expect(await providerMessageEvidence('{"error":null}')).toBeNull();
  });
});

/**
 * THE ADVERSARIAL REDACTION MATRIX. Each row is a provider message; the excerpt
 * is either exactly the expected redacted text, or omitted with a reason, and
 * the listed fragments appear nowhere in the outcome. Category, length and
 * digest are kept in every row.
 */
describe('adversarial messages: redacted, or omitted when redaction cannot be trusted', () => {
  const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
  const PROMPT_REQUEST = {
    ...REQUEST,
    instructions: 'You are the Prompt Architect for project acme-widgets. Plan the change carefully and cite the files.',
    input: 'Customer Jane Roe reports that the invoice export drops the last line item when the total exceeds 1000.',
  };
  const body = (message: string): string => JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message } });
  async function evidenceOf(message: string, request = PROMPT_REQUEST) {
    const calls: Call[] = [];
    const outcome = await runAnthropicArchitect(request, { fetch: fetchReturning(() => new Response(body(message), { status: 400 }), calls) });
    if (outcome.ok || outcome.refusal === undefined) throw new Error('expected a refusal');
    expect(outcome.failureClass).toBe(classifyAnthropicStatus(400, 'invalid_request_error', /credit balance is too low/iu.test(message)));
    const evidence = outcome.refusal.providerMessage!;
    expect(evidence.messageBytes).toBe(Buffer.byteLength(message, 'utf8'));
    expect(evidence.messageSha256).toBe(sha(message));
    return { evidence, text: JSON.stringify(outcome) };
  }

  const rows: readonly { name: string; message: string; excerpt: string | null; omitted?: 'prompt_overlap' | 'unsafe_residue'; never: readonly string[] }[] = [
    { name: 'sk-ant key', message: 'invalid key sk-ant-api03-FAKE0000 supplied', excerpt: 'invalid key [redacted] supplied', never: ['FAKE0000', 'sk-ant'] },
    { name: 'OpenAI/xAI/GitHub/AWS keys', message: 'keys sk-proj-FAKEabc123 xai-FAKEabc123 ghp_FAKEabc123 github_pat_FAKE_abc123 AKIAFAKE00000000', excerpt: 'keys [redacted] [redacted] [redacted] [redacted] [redacted]', never: ['FAKEabc123', 'AKIAFAKE'] },
    { name: 'bearer and key=value', message: 'Authorization: Bearer FAKEtok3n password=FAKEpw1 token: FAKEtk2', excerpt: '[redacted] [redacted] [redacted]', never: ['FAKEtok3n', 'FAKEpw1', 'FAKEtk2'] },
    { name: '40-character hex token', message: `trace ${'deadbeef'.repeat(5)} done`, excerpt: 'trace [redacted] done', never: ['deadbeef'] },
    { name: 'e-mail address', message: 'org owner ohdieyuh.fake@example.com must approve', excerpt: 'org owner [redacted] must approve', never: ['ohdieyuh', 'example.com'] },
    { name: 'bare @ that redaction misses', message: 'contact admin@localhost for access', excerpt: null, omitted: 'unsafe_residue', never: ['admin@localhost'] },
    { name: 'short key fragment that redaction misses', message: 'bad key sk-abc', excerpt: null, omitted: 'unsafe_residue', never: ['sk-abc'] },
    { name: 'URL with a query token', message: 'see https://console.anthropic.com/settings?token=FAKEq1 now', excerpt: 'see [redacted] now', never: ['FAKEq1', 'console.anthropic'] },
    { name: 'IP address', message: 'blocked from 203.0.113.77 today', excerpt: 'blocked from [redacted] today', never: ['203.0.113.77'] },
    { name: 'phone and card numbers', message: 'call +1 (415) 555-0100 card 4111 1111 1111 1111 ok', excerpt: 'call [redacted] card [redacted] ok', never: ['555-0100', '4111'] },
    { name: 'prompt text echoed (input)', message: 'messages.0.content: the invoice export drops the last line item is not allowed', excerpt: null, omitted: 'prompt_overlap', never: ['invoice export', 'Jane'] },
    { name: 'prompt text echoed (system), different case and spacing', message: 'system:   PLAN THE CHANGE   carefully and cite', excerpt: null, omitted: 'prompt_overlap', never: ['PLAN THE CHANGE', 'carefully'] },
    { name: 'unicode, controls and bidi', message: 'caf\u00e9 \u202eevil\u202c \u0007bell \ud83d\ude00 \u00a0nbsp', excerpt: 'caf? evil bell ? nbsp', never: ['\u202e', '\u0007'] }, // F1: bidi controls are \p{Cf}, now stripped rather than `?`
    { name: 'a spend-limit date is kept', message: 'You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC.', excerpt: 'You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC.', never: [] },
  ];
  for (const row of rows) {
    it(`${row.name}`, async () => {
      const { evidence, text } = await evidenceOf(row.message);
      expect(evidence.excerpt).toBe(row.excerpt);
      expect(evidence.excerptOmitted).toBe(row.omitted ?? null);
      if (evidence.excerpt !== null) {
        expect(evidence.excerpt).toMatch(/^[\x20-\x7e]*$/u);
        expect(evidence.excerpt.length).toBeLessThanOrEqual(PROVIDER_MESSAGE_EXCERPT_MAX);
      }
      for (const fragment of row.never) expect(text, `${fragment} never travels`).not.toContain(fragment);
    });
  }

  it('very long input: 60 KB of keys, e-mails and text; capped, redacted, digest of all of it', async () => {
    const chunk = 'note sk-ant-api03-FAKE0000 x a.b@example.com y ';
    const message = chunk.repeat(Math.floor(60_000 / chunk.length));
    const { evidence, text } = await evidenceOf(message);
    expect(evidence.excerpt!.length).toBeLessThanOrEqual(PROVIDER_MESSAGE_EXCERPT_MAX);
    expect(text).not.toContain('FAKE0000');
    expect(text).not.toContain('example.com');
  });

  it('MUTATION: a worst-case 64 KB message cannot make the redaction regexes quadratic: bounded work, digest of all of it', async () => {
    for (const message of ['a'.repeat(64_000), `${'a.'.repeat(31_000)}x`, `${'1-'.repeat(31_000)}`, `x${'@a'.repeat(31_000)}`]) {
      const started = performance.now();
      const evidence = await providerMessageEvidence(JSON.stringify({ error: { type: 'invalid_request_error', message } }), [PROMPT_REQUEST.instructions, PROMPT_REQUEST.input]);
      const elapsed = performance.now() - started;
      expect(elapsed, `bounded work for a ${message.length}-character message`).toBeLessThan(500);
      expect(evidence?.messageSha256).toBe(sha(message));
      expect(evidence?.messageBytes).toBe(message.length);
      if (evidence?.excerpt != null) expect(evidence.excerpt.length).toBeLessThanOrEqual(PROVIDER_MESSAGE_EXCERPT_MAX);
    }
  });

  it('the omission never moves the class: credit text that also echoes the prompt is still insufficient_credit', async () => {
    const message = 'Your credit balance is too low to access the Anthropic API. Customer Jane Roe reports that the invoice';
    const { evidence } = await evidenceOf(message);
    expect(evidence).toMatchObject({ messageClass: 'credit_too_low', excerpt: null, excerptOmitted: 'prompt_overlap' });
  });
});

/**
 * BEFORE/AFTER: the classification as the unpatched runner computed it,
 * frozen here verbatim (the 8,192-character parse, the token rule, the credit
 * regex), must equal the patched runner's on every body.
 */
describe('UNCHANGED CLASSIFICATION: the patched runner classifies every body exactly as the frozen original', () => {
  const frozenCredit = /credit balance is too low/iu;
  const frozenToken = /^[a-z][a-z0-9_]{0,47}$/u;
  function frozenClassify(status: number, raw: string): { failureClass: string; errorType: string | null } {
    let parsed: { type: unknown; message: string } | null = null;
    try {
      const value = JSON.parse(raw.slice(0, 8_192)) as { error?: { type?: unknown; message?: unknown } };
      parsed = { type: value?.error?.type, message: typeof value?.error?.message === 'string' ? value.error.message : '' };
    } catch { parsed = null; }
    const errorType = typeof parsed?.type === 'string' && frozenToken.test(parsed.type) ? parsed.type : null;
    return { failureClass: classifyAnthropicStatus(status, errorType, frozenCredit.test(parsed?.message ?? '')), errorType };
  }
  const json = (type: string, message: string): string => JSON.stringify({ type: 'error', error: { type, message } });
  const corpus: readonly [number, string][] = [
    [400, json('invalid_request_error', 'Your credit balance is too low to access the Anthropic API.')],
    [400, json('invalid_request_error', 'YOUR CREDIT BALANCE IS TOO LOW')],
    [400, json('invalid_request_error', 'You have reached your specified API usage limits.')],
    [400, json('invalid_request_error', 'Schema is too complex for compilation.')],
    [400, json('invalid_request_error', 'anthropic-workspace-id header is not valid')],
    [400, json('invalid_request_error', 'messages: field required')],
    [400, json('invalid_request_error', `Your credit balance is too low ${'x'.repeat(9_000)}`)],
    [400, json('billing_error', 'whatever')],
    [402, json('invalid_request_error', 'payment required')],
    [401, json('authentication_error', 'invalid x-api-key')],
    [403, json('permission_error', 'no')],
    [404, json('not_found_error', 'model')],
    [429, json('rate_limit_error', 'slow')],
    [500, json('api_error', 'internal')],
    [529, json('overloaded_error', 'busy')],
    [400, json('Bad Type!', 'credit balance is too low')],
    [400, '<html>Bad Gateway</html>'],
    [400, ''],
    [502, '{"error":null}'],
  ];
  it('every corpus body: same failure class and error type', async () => {
    for (const [status, raw] of corpus) {
      const calls: Call[] = [];
      const outcome = await runAnthropicArchitect(REQUEST, { fetch: fetchReturning(() => new Response(raw, { status }), calls) });
      expect(calls).toHaveLength(1);
      if (outcome.ok || outcome.refusal === undefined) throw new Error('expected a refusal');
      const frozen = frozenClassify(status, raw);
      expect({ status, failureClass: outcome.failureClass, errorType: outcome.refusal.errorType }).toEqual({ status, ...frozen });
    }
  });
});
