import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ASK_ANSWER_MAX_CHARS, createAskLedger, createJuliusAsk, handleJuliusAskRoute, isJuliusAskRoute,
  type AskLedgerLine, type JuliusAskResult,
} from './julius-ask';
import { readGptArchitectConfig } from '../src/relay/connectors/gpt-architect/config';
import { runGptArchitect, type GptRunOutcome, type GptRunRequest } from '../src/relay/connectors/gpt-architect/gpt-runner';

/* The SDK is mocked for the whole file: the fake-runner tests never reach it, and the real-runner tests below prove what
   options the runner builds the client with and how many requests one ask can send. Nothing contacts a provider. */
const sdk = vi.hoisted(() => ({
  constructed: [] as Array<Record<string, unknown>>,
  creates: 0,
  impl: null as null | (() => Promise<unknown>),
}));
vi.mock('openai', () => ({
  default: class {
    constructor(options: Record<string, unknown>) { sdk.constructed.push(options); }
    responses = {
      create: async () => {
        sdk.creates += 1;
        if (sdk.impl === null) throw new Error('no SDK behaviour configured');
        return sdk.impl();
      },
    };
  },
}));

/* The "key" is built at run time so no secret-shaped literal exists in this source. */
const CANARY = ['canary', 'key', 'a1b2c3d4e5f6a7b8c9d0'].join('_');
const RAW_RESPONSE_ID = ['resp', '0123456789abcdef0123'].join('_');
const OPERATOR = ['operator', 'token', 'for', 'tests'].join('-');
const GOOD_KEY = 'idem-key-0001';

const baseEnv = (extra: Record<string, string | undefined> = {}): Record<string, string | undefined> => ({
  JULIUS_ASK_ENABLED: '1',
  OPENAI_API_KEY: CANARY,
  OPENAI_PROMPT_ARCHITECT_MODEL: 'model-configured',
  RELAY_PROMPT_ARCHITECT_MODE: 'live',
  ...extra,
});

const usage = { inputTokens: 120, cachedInputTokens: 20, outputTokens: 80, reasoningTokens: 30, totalTokens: 200 };
const answered = (answer: string, extra: Partial<Extract<GptRunOutcome, { ok: true }>> = {}): GptRunOutcome => ({
  ok: true, actualModel: 'model-served', responseId: RAW_RESPONSE_ID, status: 'completed',
  outputText: JSON.stringify({ answer }), usage, ...extra,
});

interface Harness {
  readonly ask: ReturnType<typeof createJuliusAsk>;
  readonly events: string[];
  readonly lines: AskLedgerLine[];
  readonly requests: GptRunRequest[];
  calls(): number;
  setNow(ms: number): void;
}

function harness(options: {
  env?: Record<string, string | undefined>;
  outcome?: () => GptRunOutcome | Promise<GptRunOutcome>;
  ledgerFails?: boolean;
  ledgerDelayMs?: number;
} = {}): Harness {
  const events: string[] = [];
  const lines: AskLedgerLine[] = [];
  const requests: GptRunRequest[] = [];
  let now = Date.UTC(2026, 9, 19, 12, 0, 0);
  const ask = createJuliusAsk({
    env: options.env ?? baseEnv(),
    readConfig: readGptArchitectConfig,
    now: () => now,
    ledger: {
      append: async (line) => {
        events.push(`ledger:${String(line.phase)}`);
        if (options.ledgerDelayMs !== undefined) await new Promise((r) => setTimeout(r, options.ledgerDelayMs));
        if (options.ledgerFails === true) throw new Error('disk full');
        lines.push(line);
      },
    },
    runArchitect: async (request) => {
      events.push('runArchitect');
      requests.push(request);
      return (options.outcome ?? (() => answered('a plain answer')))();
    },
  });
  return { ask, events, lines, requests, calls: () => requests.length, setNow: (ms) => { now = ms; } };
}

const ask = (h: Harness, over: Partial<{ question: unknown; idempotencyKey: unknown; caller: unknown }> = {}): Promise<JuliusAskResult> =>
  h.ask.handleAsk({ question: 'What is Julius?', idempotencyKey: GOOD_KEY, caller: 'player:p1', ...over });

function failure(result: JuliusAskResult): { code: string; httpStatus: number } {
  if (result.ok) throw new Error('expected a refusal');
  return { code: result.code, httpStatus: result.httpStatus };
}
function success(result: JuliusAskResult) {
  if (!result.ok) throw new Error(`expected an answer, got ${result.code}`);
  return result;
}

describe('ask Julius: refusals that must never reach the provider', () => {
  it('is disabled unless JULIUS_ASK_ENABLED is exactly 1', async () => {
    for (const flag of [undefined, '', '0', 'true', 'yes', ' 1']) {
      const h = harness({ env: baseEnv({ JULIUS_ASK_ENABLED: flag }) });
      expect(failure(await ask(h))).toEqual({ code: 'julius_ask_disabled', httpStatus: 503 });
      expect(h.calls()).toBe(0);
      expect(h.lines).toHaveLength(0);
    }
  });

  it('requires a non-empty caller', async () => {
    for (const caller of [undefined, null, '', '   ', 42]) {
      const h = harness();
      expect(failure(await ask(h, { caller }))).toEqual({ code: 'julius_ask_caller_required', httpStatus: 401 });
      expect(h.calls()).toBe(0);
    }
  });

  it('refuses a question that is not a string, is empty, or is over 2000 characters', async () => {
    for (const question of [undefined, null, 7, {}, '', '   \n ', 'x'.repeat(2001), ` ${'x'.repeat(2001)} `]) {
      const h = harness();
      expect(failure(await ask(h, { question }))).toEqual({ code: 'julius_ask_question_invalid', httpStatus: 400 });
      expect(h.calls()).toBe(0);
      expect(h.lines).toHaveLength(0);
    }
  });

  it('accepts exactly 2000 characters, and trims before measuring', async () => {
    const h = harness();
    success(await ask(h, { question: `  ${'x'.repeat(2000)}  ` }));
    expect(h.requests[0]?.input).toBe('x'.repeat(2000));
    expect(h.lines[0]?.questionLength).toBe(2000);
  });

  it('refuses a missing or badly shaped idempotency key', async () => {
    const bad = [undefined, null, 12345678, '', 'short12', 'x'.repeat(81), 'has space 123', 'semi;colon-123', 'dot.dot.dot.dot', 'new\nline-1234'];
    for (const idempotencyKey of bad) {
      const h = harness();
      expect(failure(await ask(h, { idempotencyKey }))).toEqual({ code: 'julius_ask_idempotency_key_invalid', httpStatus: 400 });
      expect(h.calls()).toBe(0);
    }
  });

  it('accepts the 8 and 80 character key boundaries', async () => {
    const h = harness();
    success(await ask(h, { idempotencyKey: 'a_b-9xyz' }));
    success(await ask(h, { idempotencyKey: 'k'.repeat(80) }));
    expect(h.calls()).toBe(2);
  });

  it('refuses, naming nothing secret, when the architect is not configured', async () => {
    const h = harness({ env: baseEnv({ OPENAI_API_KEY: undefined }) });
    const refusal = await ask(h);
    expect(failure(refusal)).toEqual({ code: 'julius_ask_not_configured', httpStatus: 503 });
    expect(h.calls()).toBe(0);
    expect(h.lines).toHaveLength(0);
  });
});

describe('ask Julius: the answer', () => {
  it('returns the documented shape, the served model and the real usage, and never the raw response id', async () => {
    const h = harness();
    const result = success(await ask(h));
    expect(result.role).toBe('architect');
    expect(result.provider).toBe('openai');
    expect(result.model).toBe('model-served');
    expect(result.usage).toEqual({ input: 120, cached: 20, output: 80, reasoning: 30, total: 200 });
    expect(result.costBasis).toBe('UNKNOWN');
    expect(result.billingPath).toBe('API_BILLED');
    expect(result.answer).toBe('a plain answer');
    expect(result.askId).toMatch(/^ask_[0-9a-f]{20}$/);
    expect(result.ledgerRef).toBe(`julius-ask-ledger:${result.askId}`);
    expect(result.responseId).not.toBe(RAW_RESPONSE_ID);
    expect(result.responseId.endsWith(RAW_RESPONSE_ID.slice(-6))).toBe(true);
    expect(JSON.stringify(result)).not.toContain(RAW_RESPONSE_ID);
  });

  it('asks for a bare {answer:string} schema, with the ask output cap, and no tool or research field', async () => {
    const h = harness();
    success(await ask(h));
    const request = h.requests[0];
    expect(request?.schema?.schema).toMatchObject({ required: ['answer'], properties: { answer: { type: 'string' } } });
    expect(request?.config.maxOutputTokens).toBe(1500);
    expect(request?.config.timeoutMs).toBeLessThanOrEqual(90_000);
    expect(Object.keys(request ?? {}).sort()).toEqual(['apiKey', 'config', 'input', 'instructions', 'maxRetries', 'schema']);
    expect(request?.instructions).toContain('no tools');
    /* One ask is at most one billed provider request. */
    expect(request?.maxRetries).toBe(0);
  });

  it('bounds the output tokens: configurable downward, never above 4000, and a bad value falls back', async () => {
    const cases: Array<[string | undefined, number]> = [['800', 800], ['99999', 4000], ['4000', 4000], ['0', 1500], ['abc', 1500], ['-5', 1500], ['12.5', 1500]];
    for (const [raw, expected] of cases) {
      const h = harness({ env: baseEnv({ JULIUS_ASK_MAX_OUTPUT_TOKENS: raw }) });
      success(await ask(h));
      expect(h.requests[0]?.config.maxOutputTokens).toBe(expected);
    }
  });

  it('sanitizes the answer: removes the exact key, secret-shaped strings and escape sequences', async () => {
    const shaped = ['sk', 'x'.repeat(30)].join('-');
    const esc = String.fromCharCode(27);
    const raw = `key ${CANARY} and ${shaped} and ${esc}[31mred${esc}[0m text`;
    const h = harness({ outcome: () => answered(raw) });
    const result = success(await ask(h));
    expect(result.answer).not.toContain(CANARY);
    expect(result.answer).not.toContain(shaped);
    expect(result.answer).not.toContain(esc);
    expect(result.answer).toContain('red');
  });

  it('caps the answer at 8000 characters', async () => {
    const h = harness({ outcome: () => answered('word '.repeat(5000)) });
    const result = success(await ask(h));
    expect(result.answer.length).toBeLessThanOrEqual(ASK_ANSWER_MAX_CHARS);
    expect(result.answer.length).toBeGreaterThan(7000);
  });
});

describe('ask Julius: idempotency and the daily cap', () => {
  it('returns the FIRST answer for a repeated key and does not call the provider again', async () => {
    let n = 0;
    const h = harness({ outcome: () => answered(`answer number ${++n}`) });
    const first = success(await ask(h));
    const second = success(await ask(h));
    expect(h.calls()).toBe(1);
    expect(second.askId).toBe(first.askId);
    expect(second.answer).toBe('answer number 1');
    expect(h.lines).toHaveLength(2);
  });

  it('shares one paid call between two concurrent requests with the same key', async () => {
    const h = harness({ outcome: async () => { await new Promise((r) => setTimeout(r, 10)); return answered('slow'); } });
    const [a, b] = await Promise.all([ask(h), ask(h)]);
    expect(h.calls()).toBe(1);
    expect(success(a).askId).toBe(success(b).askId);
  });

  it('does not let one caller replay another caller\'s answer with the same key', async () => {
    const h = harness();
    const a = success(await ask(h, { caller: 'player:a' }));
    const b = success(await ask(h, { caller: 'player:b' }));
    expect(h.calls()).toBe(2);
    expect(a.askId).not.toBe(b.askId);
  });

  it('stores a provider failure too, so a retry with the same key cannot buy a second call', async () => {
    const h = harness({ outcome: () => ({ ok: false, failureClass: 'timeout', message: 'timed out', usage }) });
    expect(failure(await ask(h)).httpStatus).toBe(502);
    expect(failure(await ask(h)).httpStatus).toBe(502);
    expect(h.calls()).toBe(1);
  });

  it('stops at the daily cap with 429, still replays stored answers, and resets on the next UTC day', async () => {
    const h = harness({ env: baseEnv({ JULIUS_ASK_DAILY_CAP: '2' }) });
    success(await ask(h, { idempotencyKey: 'key-number-1' }));
    success(await ask(h, { idempotencyKey: 'key-number-2' }));
    expect(failure(await ask(h, { idempotencyKey: 'key-number-3' }))).toEqual({ code: 'julius_ask_cap_reached', httpStatus: 429 });
    expect(h.calls()).toBe(2);
    success(await ask(h, { idempotencyKey: 'key-number-1' }));
    expect(h.calls()).toBe(2);
    h.setNow(Date.UTC(2026, 9, 20, 0, 0, 1));
    success(await ask(h, { idempotencyKey: 'key-number-3' }));
    expect(h.calls()).toBe(3);
  });

  it('defaults the daily cap to 20', async () => {
    const h = harness();
    for (let i = 0; i < 20; i += 1) success(await ask(h, { idempotencyKey: `key-number-${String(i).padStart(2, '0')}` }));
    expect(failure(await ask(h, { idempotencyKey: 'key-number-over' })).code).toBe('julius_ask_cap_reached');
    expect(h.calls()).toBe(20);
  });
});

describe('ask Julius: the ledger', () => {
  it('writes the pre-call line BEFORE the provider is contacted, and the result line after', async () => {
    const h = harness();
    success(await ask(h));
    expect(h.events).toEqual(['ledger:pre_call', 'runArchitect', 'ledger:result']);
  });

  it('keeps the question text, the answer, the key and the caller out of every ledger line, and the raw response id out of the pre-call line', async () => {
    const question = 'a distinctive question about the weather in the library';
    const h = harness();
    success(await ask(h, { question, caller: 'player:secret-id-77', idempotencyKey: 'idem-secret-key-42' }));
    const dump = JSON.stringify(h.lines);
    expect(dump).not.toContain('distinctive');
    expect(dump).not.toContain(CANARY);
    expect(JSON.stringify(h.lines[0])).not.toContain(RAW_RESPONSE_ID);
    /* The FULL provider id is in the result row (for dashboard reconciliation) and nowhere else. */
    expect(h.lines[1]).toMatchObject({ providerResponseId: RAW_RESPONSE_ID });
    expect(dump).not.toContain('secret-id-77');
    expect(dump).not.toContain('idem-secret-key-42');
    expect(h.lines[0]).toMatchObject({ phase: 'pre_call', questionLength: question.length, maxOutputTokens: 1500 });
    expect(String(h.lines[0]?.callerHash)).toMatch(/^[0-9a-f]{16}$/);
    expect(String(h.lines[0]?.keyHash)).toMatch(/^[0-9a-f]{16}$/);
    expect(h.lines[1]).toMatchObject({ phase: 'result', outcome: 'answered', usage: { input: 120, cached: 20, output: 80, reasoning: 30, total: 200 } });
  });

  it('refuses to call the provider when the pre-call line cannot be written', async () => {
    const h = harness({ ledgerFails: true });
    expect(failure(await ask(h))).toEqual({ code: 'julius_ask_ledger_unavailable', httpStatus: 503 });
    expect(h.calls()).toBe(0);
  });

  it('does not remember a refusal made before any provider contact: the same key works once the ledger recovers', async () => {
    let broken = true;
    const requests: GptRunRequest[] = [];
    const controller = createJuliusAsk({
      env: baseEnv(), readConfig: readGptArchitectConfig, now: () => 1,
      ledger: { append: () => { if (broken) throw new Error('down'); } },
      runArchitect: async (request) => { requests.push(request); return answered('after recovery'); },
    });
    const input = { question: 'q', idempotencyKey: GOOD_KEY, caller: 'player:p1' };
    expect(failure(await controller.handleAsk(input)).code).toBe('julius_ask_ledger_unavailable');
    broken = false;
    expect(success(await controller.handleAsk(input)).answer).toBe('after recovery');
    expect(requests).toHaveLength(1);
  });

  it('records the usage of a failed call in the result line', async () => {
    const h = harness({ outcome: () => ({ ok: false, failureClass: 'incomplete_response', message: 'cut off', usage }) });
    await ask(h);
    expect(h.lines[1]).toMatchObject({ phase: 'result', outcome: 'julius_ask_provider_failed', usage: { total: 200 } });
  });

  it('the production ledger appends one JSON line per event to its file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'julius-ask-'));
    try {
      const file = join(dir, 'nested', 'ledger.jsonl');
      const ledger = createAskLedger(file);
      ledger.append({ phase: 'pre_call', askId: 'ask_1' });
      ledger.append({ phase: 'result', askId: 'ask_1' });
      const written = readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { phase: string });
      expect(written.map((l) => l.phase)).toEqual(['pre_call', 'result']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('ask Julius: provider failures and the key', () => {
  it('maps every provider failure class to 502 with a fixed safe code, never the provider text', async () => {
    for (const failureClass of ['authentication_failed', 'rate_limited', 'timeout', 'refused', 'incomplete_response', 'model_unavailable'] as const) {
      const h = harness({ outcome: () => ({ ok: false, failureClass, message: `raw provider body ${CANARY}`, usage }) });
      const result = await ask(h);
      expect(failure(result)).toEqual({ code: 'julius_ask_provider_failed', httpStatus: 502 });
      expect(JSON.stringify(result)).not.toContain(CANARY);
    }
  });

  it('maps a thrown error to 502 and does not leak its message', async () => {
    const h = harness({ outcome: () => { throw new Error(`boom ${CANARY}`); } });
    const result = await ask(h);
    expect(failure(result)).toEqual({ code: 'julius_ask_provider_failed', httpStatus: 502 });
    expect(JSON.stringify(result)).not.toContain(CANARY);
    expect(JSON.stringify(h.lines)).not.toContain(CANARY);
  });

  it('maps unparseable or empty structured output to 502', async () => {
    for (const outputText of ['not json', '{}', '{"answer":7}', '{"answer":"   "}']) {
      const h = harness({ outcome: () => answered('x', { outputText }) });
      expect(failure(await ask(h))).toEqual({ code: 'julius_ask_provider_malformed', httpStatus: 502 });
    }
  });

  it('never returns, ledgers or logs the key (canary), on any path', async () => {
    const spies = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error'), vi.spyOn(console, 'info')];
    try {
      const results: JuliusAskResult[] = [];
      const h = harness({ outcome: () => answered(`the key is ${CANARY}`) });
      results.push(await ask(h));
      const bad = harness({ outcome: () => ({ ok: false, failureClass: 'authentication_failed', message: CANARY }) });
      results.push(await ask(bad));
      results.push(await ask(harness(), { question: CANARY.padEnd(2500, 'x') }));
      const everything = JSON.stringify([results, h.lines, bad.lines, spies.map((s) => s.mock.calls)]);
      expect(everything).not.toContain(CANARY);
      /* The runner DID receive the key: that is the one place it is allowed to go. */
      expect(h.requests[0]?.apiKey).toBe(CANARY);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});

describe('ask Julius: the cap is reserved before the first await, and one ask is one billed request', () => {
  const settle = () => new Promise((r) => setTimeout(r, 15));
  const gated = () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    return { gate, release: () => release() };
  };

  it('N parallel distinct-key asks with cap 2 make exactly 2 provider calls', async () => {
    const { gate, release } = gated();
    const h = harness({
      env: baseEnv({ JULIUS_ASK_DAILY_CAP: '2', JULIUS_ASK_MAX_CONCURRENT: '10' }),
      ledgerDelayMs: 3,
      outcome: async () => { await gate; return answered('released'); },
    });
    const all = Promise.all([1, 2, 3, 4, 5, 6].map((n) => ask(h, { idempotencyKey: `parallel-key-${n}` })));
    await settle();
    expect(h.calls()).toBe(2);
    release();
    const results = await all;
    expect(h.calls()).toBe(2);
    expect(results.filter((r) => r.ok)).toHaveLength(2);
    expect(results.filter((r) => !r.ok).map((r) => failure(r).code)).toEqual(Array(4).fill('julius_ask_cap_reached'));
  });

  it('allows one ask in flight by default: a second distinct-key ask is refused as busy, then works after the first finishes', async () => {
    const { gate, release } = gated();
    const h = harness({ ledgerDelayMs: 3, outcome: async () => { await gate; return answered('slow'); } });
    const first = ask(h, { idempotencyKey: 'first-key-0001' });
    const second = ask(h, { idempotencyKey: 'second-key-0002' });
    expect(failure(await second)).toEqual({ code: 'julius_ask_busy', httpStatus: 429 });
    release();
    success(await first);
    expect(h.calls()).toBe(1);
    success(await ask(h, { idempotencyKey: 'second-key-0002' }));
    expect(h.calls()).toBe(2);
  });

  it('gives the reserved cap slot back when the pre-call line cannot be written', async () => {
    let broken = true;
    const requests: GptRunRequest[] = [];
    const controller = createJuliusAsk({
      env: baseEnv({ JULIUS_ASK_DAILY_CAP: '1' }), readConfig: readGptArchitectConfig, now: () => 1,
      ledger: { append: async () => { await Promise.resolve(); if (broken) throw new Error('down'); } },
      runArchitect: async (request) => { requests.push(request); return answered('ok'); },
    });
    expect(failure(await controller.handleAsk({ question: 'q', idempotencyKey: 'ledger-key-001', caller: 'c' })).code).toBe('julius_ask_ledger_unavailable');
    broken = false;
    success(await controller.handleAsk({ question: 'q', idempotencyKey: 'ledger-key-002', caller: 'c' }));
    expect(requests).toHaveLength(1);
    expect(failure(await controller.handleAsk({ question: 'q', idempotencyKey: 'ledger-key-003', caller: 'c' })).code).toBe('julius_ask_cap_reached');
  });

  it('a provider failure keeps its cap slot (it may have been billed) and frees the concurrency slot', async () => {
    const h = harness({
      env: baseEnv({ JULIUS_ASK_DAILY_CAP: '1' }),
      outcome: () => ({ ok: false, failureClass: 'provider_error', message: 'x' }),
    });
    expect(failure(await ask(h, { idempotencyKey: 'fail-key-00001' })).code).toBe('julius_ask_provider_failed');
    expect(failure(await ask(h, { idempotencyKey: 'fail-key-00002' })).code).toBe('julius_ask_cap_reached');
  });

  it('the real runner builds the SDK client with maxRetries 1 when nothing is said (unchanged) and 0 when asked', async () => {
    sdk.constructed.length = 0;
    sdk.impl = async () => { throw new Error('stop'); };
    const config = readGptArchitectConfig(baseEnv());
    await runGptArchitect({ apiKey: CANARY, config, instructions: 'i', input: 'q' });
    await runGptArchitect({ apiKey: CANARY, config, instructions: 'i', input: 'q', maxRetries: 0 });
    expect(sdk.constructed.map((o) => o.maxRetries)).toEqual([1, 0]);
  });

  it('end to end over the real runner and a mocked SDK: one ask is one SDK request with no retry, and the failure reconciles', async () => {
    sdk.constructed.length = 0;
    sdk.creates = 0;
    sdk.impl = async () => { throw Object.assign(new Error(`upstream said ${CANARY}`), { status: 503, name: 'InternalServerError' }); };
    const lines: AskLedgerLine[] = [];
    const controller = createJuliusAsk({
      env: baseEnv(), readConfig: readGptArchitectConfig, now: () => 1,
      ledger: { append: (line) => { lines.push(line); } }, runArchitect: runGptArchitect,
    });
    const result = await controller.handleAsk({ question: 'q', idempotencyKey: 'e2e-key-0001', caller: 'c' });
    expect(failure(result)).toEqual({ code: 'julius_ask_provider_failed', httpStatus: 502 });
    expect(sdk.creates).toBe(1);
    expect(sdk.constructed).toHaveLength(1);
    expect(sdk.constructed[0]?.maxRetries).toBe(0);
    expect(lines[1]).toMatchObject({ phase: 'result', failureClass: 'provider_error', providerHttpStatus: 503, attempts: 1 });
    expect(JSON.stringify([result, lines])).not.toContain(CANARY);
  });
});

describe('ask Julius: the result ledger row reconciles a billed call', () => {
  it('records failure class, incomplete reason, provider status, HTTP status, full response id, model, usage and attempts', async () => {
    const h = harness({
      outcome: () => ({
        ok: false, failureClass: 'incomplete_response', message: 'cut off mid sentence', usage, responseId: RAW_RESPONSE_ID,
        actualModel: 'model-served', providerStatus: 'incomplete', incompleteReason: 'max_output_tokens', providerHttpStatus: 200,
      }),
    });
    const result = await ask(h);
    expect(failure(result).httpStatus).toBe(502);
    expect(h.lines[1]).toEqual({
      phase: 'result', askId: expect.any(String), at: expect.any(String), outcome: 'julius_ask_provider_failed',
      failureClass: 'incomplete_response', incompleteReason: 'max_output_tokens', providerStatus: 'incomplete',
      providerHttpStatus: 200, providerResponseId: RAW_RESPONSE_ID, model: 'model-served', attempts: 1, answerSha256: null, answerChars: null,
      usage: { input: 120, cached: 20, output: 80, reasoning: 30, total: 200 },
    });
    expect(JSON.stringify(h.lines)).not.toContain('cut off');
    expect(JSON.stringify(result)).not.toContain(RAW_RESPONSE_ID);
  });

  it('records malformed structured output as its own failure class, with the response id', async () => {
    const h = harness({ outcome: () => answered('x', { outputText: 'not json' }) });
    await ask(h);
    expect(h.lines[1]).toMatchObject({ outcome: 'julius_ask_provider_malformed', failureClass: 'malformed_output', providerResponseId: RAW_RESPONSE_ID });
  });

  it('a success row has no failure fields set and carries the response id and status', async () => {
    const h = harness();
    await ask(h);
    expect(h.lines[1]).toMatchObject({
      outcome: 'answered', failureClass: null, incompleteReason: null, providerStatus: 'completed', providerHttpStatus: null,
      providerResponseId: RAW_RESPONSE_ID, attempts: 1,
    });
    expect(JSON.stringify(h.lines)).not.toContain('a plain answer');
  });
});

describe('ask Julius: the answer digest ties the rendered text to the provider answer and the ledger row', () => {
  const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

  it('answerDigest is the sha256 of the exact returned answer, answerChars its length, and the ledger row carries both without the text', async () => {
    const question = 'a distinctive digest question';
    const h = harness({ outcome: () => answered('The answer with unicode: café ☃') });
    const result = success(await ask(h, { question }));
    expect(result.answerDigest).toBe(sha256(result.answer));
    expect(result.answerDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(result.answerChars).toBe(result.answer.length);
    expect(h.lines[1]).toMatchObject({ phase: 'result', answerSha256: result.answerDigest, answerChars: result.answer.length });
    const dump = JSON.stringify(h.lines);
    expect(dump).not.toContain('unicode');
    expect(dump).not.toContain('distinctive');
    expect(dump).not.toContain(CANARY);
  });

  it('the digest is of the SANITIZED text, not the provider text', async () => {
    const h = harness({ outcome: () => answered(`secret ${CANARY} end`) });
    const result = success(await ask(h));
    expect(result.answer).not.toContain(CANARY);
    expect(result.answerDigest).toBe(sha256(result.answer));
    expect(result.answerDigest).not.toBe(sha256(`secret ${CANARY} end`));
  });

  it('the digest of a capped answer is the digest of the capped text', async () => {
    const h = harness({ outcome: () => answered('word '.repeat(5000)) });
    const result = success(await ask(h));
    expect(result.answerChars).toBeLessThanOrEqual(ASK_ANSWER_MAX_CHARS);
    expect(result.answerDigest).toBe(sha256(result.answer));
    expect(h.lines[1]).toMatchObject({ answerSha256: sha256(result.answer), answerChars: result.answer.length });
  });

  it('a replay of the same key returns the same digest and writes no second row', async () => {
    let n = 0;
    const h = harness({ outcome: () => answered(`answer ${++n}`) });
    const first = success(await ask(h));
    const second = success(await ask(h));
    expect(second.answerDigest).toBe(first.answerDigest);
    expect(h.lines).toHaveLength(2);
  });

  it('a failure has no digest and no length in its ledger row, and none in the refusal', async () => {
    const h = harness({ outcome: () => ({ ok: false, failureClass: 'timeout', message: 'slow', responseId: RAW_RESPONSE_ID }) });
    const result = await ask(h);
    expect(failure(result).httpStatus).toBe(502);
    expect(Object.keys(result)).not.toContain('answerDigest');
    expect(h.lines[1]).toMatchObject({ answerSha256: null, answerChars: null });
  });

  it('the HTTP success body carries answerDigest and answerChars', async () => {
    const h = harness();
    const live = { handleAsk: (input: Parameters<typeof h.ask.handleAsk>[0]) => h.ask.handleAsk(input) };
    const response = await handleJuliusAskRoute(
      {
        method: 'POST', authorization: `Bearer ${OPERATOR}`, origin: undefined, rawBody: JSON.stringify({ question: 'hello' }),
        idempotencyKey: GOOD_KEY, now: 1, operatorToken: OPERATOR,
      },
      { ask: live, verifyNativeSession: () => null },
    );
    const data = (response.body as { data: { answer: string; answerDigest: string; answerChars: number } }).data;
    expect(response.status).toBe(200);
    expect(data.answerDigest).toBe(sha256(data.answer));
    expect(data.answerChars).toBe(data.answer.length);
  });
});

describe('ask Julius: an idempotency key is bound to its question', () => {
  it('refuses the same key with a different question, and still replays the same question', async () => {
    const h = harness();
    const first = success(await ask(h, { question: 'first question' }));
    expect(failure(await ask(h, { question: 'a different question' }))).toEqual({ code: 'julius_ask_idempotency_key_reused', httpStatus: 409 });
    expect(success(await ask(h, { question: '  first question  ' })).askId).toBe(first.askId);
    expect(h.calls()).toBe(1);
  });
});

describe('ask Julius: the HTTP edge', () => {
  const okAsk = { handleAsk: vi.fn(async () => ({ ...success(await ask(harness())) })) };
  const ports = (verify: (i: { token: string; now: number }) => { playerId: string } | null = () => null) =>
    ({ ask: okAsk, verifyNativeSession: verify });
  const request = (over: Partial<Parameters<typeof handleJuliusAskRoute>[0]> = {}) => ({
    method: 'POST', authorization: undefined as string | undefined, origin: undefined as string | undefined,
    rawBody: JSON.stringify({ question: 'hello' }), idempotencyKey: GOOD_KEY, now: 1, operatorToken: OPERATOR, ...over,
  });

  it('claims exactly the one path', () => {
    expect(isJuliusAskRoute('/wonderland/julius/ask')).toBe(true);
    expect(isJuliusAskRoute('/wonderland/julius/ask/x')).toBe(false);
    expect(isJuliusAskRoute('/wonderland/julius')).toBe(false);
  });

  it('refuses a non-POST, an unauthenticated call, a wrong bearer, and a browser-origin session', async () => {
    okAsk.handleAsk.mockClear();
    expect((await handleJuliusAskRoute(request({ method: 'GET' }), ports())).status).toBe(405);
    expect((await handleJuliusAskRoute(request(), ports())).status).toBe(401);
    expect((await handleJuliusAskRoute(request({ authorization: 'Bearer wrong-token-value' }), ports())).status).toBe(401);
    const accepts = (): { playerId: string } => ({ playerId: 'p1' });
    expect((await handleJuliusAskRoute(request({ authorization: 'Relay-Session tok', origin: 'https://example.invalid' }), ports(accepts))).status).toBe(401);
    expect((await handleJuliusAskRoute(request({ authorization: 'Relay-Session tok' }), ports(() => null))).status).toBe(401);
    expect(okAsk.handleAsk).not.toHaveBeenCalled();
  });

  it('accepts the operator bearer and a paired native session, naming the caller to the controller', async () => {
    const seen: unknown[] = [];
    const spy = { handleAsk: async (input: unknown) => { seen.push(input); return success(await ask(harness())); } };
    const op = await handleJuliusAskRoute(request({ authorization: `Bearer ${OPERATOR}` }), { ask: spy, verifyNativeSession: () => null });
    const pl = await handleJuliusAskRoute(request({ authorization: 'Relay-Session tok' }), { ask: spy, verifyNativeSession: () => ({ playerId: 'p9' }) });
    expect([op.status, pl.status]).toEqual([200, 200]);
    expect(seen).toMatchObject([{ caller: 'operator', question: 'hello', idempotencyKey: GOOD_KEY }, { caller: 'player:p9' }]);
    expect(JSON.stringify(op.body)).not.toContain('"ok"');
  });

  it('turns a refusal into a status with a fixed message, and a malformed body into a 400', async () => {
    const h = harness();
    const live = { handleAsk: (input: Parameters<typeof h.ask.handleAsk>[0]) => h.ask.handleAsk(input) };
    const auth = { authorization: `Bearer ${OPERATOR}` };
    const badBody = await handleJuliusAskRoute(request({ ...auth, rawBody: '{not json' }), { ask: live, verifyNativeSession: () => null });
    expect(badBody.status).toBe(400);
    const noBody = await handleJuliusAskRoute(request({ ...auth, rawBody: undefined }), { ask: live, verifyNativeSession: () => null });
    expect(noBody.status).toBe(400);
    const noKey = await handleJuliusAskRoute(request({ ...auth, idempotencyKey: undefined }), { ask: live, verifyNativeSession: () => null });
    expect(noKey.status).toBe(400);
    expect(h.calls()).toBe(0);
    expect(JSON.stringify(noKey.body)).toContain('julius_ask_idempotency_key_invalid');
  });
});
