import { describe, expect, it, vi } from 'vitest';
import {
  applyAskInputPolicy, createJuliusAsk, createMemoryAskStore, defaultCallerDailyCap, handleJuliusAskRoute, safetyIdentifierFor,
  type AskLedgerLine, type JuliusAskResult,
} from './julius-ask';
import { readGptArchitectConfig } from '../src/relay/connectors/gpt-architect/config';
import { runGptArchitect, type GptRunOutcome, type GptRunRequest } from '../src/relay/connectors/gpt-architect/gpt-runner';

/* Slices 1 and 2 of the F4-F8 plan, beyond the 17 independent controls: the pure input policy, the AskStore seam and its
   in-memory durable fake (reserve, the named 409 states, the HMAC key binding), the player effort policy, and the wire field.
   No network, no provider, no Postgres: the SDK is mocked. */
const sdk = vi.hoisted(() => ({ bodies: [] as Array<Record<string, unknown>> }));
vi.mock('openai', () => ({
  default: class {
    responses = {
      create: async (body: Record<string, unknown>) => {
        sdk.bodies.push(body);
        return { id: 'resp_store_000111', model: 'model-served', status: 'completed', output: [], output_text: JSON.stringify({ answer: 'ok' }), usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
      },
    };
  },
}));

const DAY0 = Date.UTC(2026, 9, 19, 12, 0, 0);
const SECRET = ['binding', 'secret', 'for', 'tests', '0123456789'].join('-');
// The provider-key canary is built at run time so no key-shaped literal exists in the source (the repository boundary scan refuses one).
const STORE_KEY = ['canary', 'store', 'key', '0011223344'].join('_');
const env = (extra: Record<string, string | undefined> = {}): Record<string, string | undefined> => ({
  JULIUS_ASK_ENABLED: '1', OPENAI_API_KEY: STORE_KEY, OPENAI_PROMPT_ARCHITECT_MODEL: 'model-configured',
  RELAY_PROMPT_ARCHITECT_MODE: 'live', ...extra,
});
const answered = (): GptRunOutcome => ({ ok: true, actualModel: 'm', responseId: 'resp_x_000111', status: 'completed', outputText: JSON.stringify({ answer: 'fine' }), usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, reasoningTokens: 0, totalTokens: 2 } });
const timedOut = (): GptRunOutcome => ({ ok: false, failureClass: 'timeout', message: 'timed out' });

function rig(store = createMemoryAskStore(), outcome: () => GptRunOutcome = answered) {
  const requests: GptRunRequest[] = [];
  const make = (e: Record<string, string | undefined> = env()) => createJuliusAsk({
    env: e, readConfig: readGptArchitectConfig, now: () => DAY0, ledger: store,
    runArchitect: async (request) => { requests.push(request); return outcome(); },
  });
  return { store, requests, make };
}
type Controller = ReturnType<typeof createJuliusAsk>;
const ask = (c: Controller, over: Partial<{ question: unknown; idempotencyKey: unknown; caller: unknown }> = {}): Promise<JuliusAskResult> =>
  c.handleAsk({ question: 'What is Julius?', idempotencyKey: 'store-key-0001', caller: 'player:p1', ...over });
const refusal = (r: JuliusAskResult) => (r.ok ? { code: 'ANSWERED', httpStatus: 200 } : { code: r.code, httpStatus: r.httpStatus });

describe('applyAskInputPolicy (pure)', () => {
  it('strips control, bidi and zero-width characters and keeps TAB, LF and the visible text', () => {
    const noisy = ['a', String.fromCharCode(0x0d), 'b', String.fromCharCode(0x200b), 'c\td', String.fromCharCode(0x202e), '\ne'].join('');
    expect(applyAskInputPolicy(noisy)).toEqual({ ok: true, question: 'ab' + 'c\td\ne' });
  });

  it('refuses a question that is empty once the hidden characters are gone', () => {
    expect(applyAskInputPolicy(String.fromCharCode(0x200b, 0x0007))).toEqual({ ok: false, code: 'julius_ask_question_invalid', httpStatus: 400 });
  });

  it('refuses credential, e-mail and phone shapes (a hidden character cannot split a shape) with a 400', () => {
    const key = ['sk', 'a'.repeat(24)].join('-');
    const split = `${key.slice(0, 3)}${String.fromCharCode(0x200b)}${key.slice(3)}`;
    const email = ['someone', 'example.org'].join('@');
    const phone = '(415) 555-0134';
    for (const text of [`my key ${key}`, `my key ${split}`, `mail ${email}`, `call ${phone}`, `Authorization: Bearer ${'t'.repeat(24)}`]) {
      expect(applyAskInputPolicy(text), text.slice(0, 14)).toEqual({ ok: false, code: 'julius_ask_input_refused', httpStatus: 400 });
    }
  });

  it('refuses a self-declared age under 13 with its own code, and lets ordinary numbers and older ages through', () => {
    for (const text of ['I am 11 years old', "i'm 9 and curious", 'my age is 12', 'I just turned 8', 'I am eleven']) {
      expect(applyAskInputPolicy(text), text).toEqual({ ok: false, code: 'julius_ask_age_restricted', httpStatus: 403 });
    }
    for (const text of ['I am 13 years old', "I'm 5 minutes away from the library", 'Who is the 11th architect?', 'I am one of the players', 'room 12 on level 3']) {
      expect(applyAskInputPolicy(text), text).toMatchObject({ ok: true });
    }
  });

  it('derives the safety identifier from the caller hash only: stable, prefixed, opaque', () => {
    expect(safetyIdentifierFor('abcd1234abcd1234')).toBe(safetyIdentifierFor('abcd1234abcd1234'));
    expect(safetyIdentifierFor('abcd1234abcd1234')).toMatch(/^jask_[0-9a-f]{32}$/);
    expect(safetyIdentifierFor('abcd1234abcd1234')).not.toBe(safetyIdentifierFor('abcd1234abcd1235'));
  });
});

describe('the policy refusals reserve nothing and never reach the provider', () => {
  it('a refused question writes no row, makes no provider call and does not consume the key', async () => {
    const { store, requests, make } = rig();
    const c = make();
    expect(refusal(await ask(c, { question: `mail ${['a', 'example.org'].join('@')}` }))).toEqual({ code: 'julius_ask_input_refused', httpStatus: 400 });
    expect(await store.rows()).toHaveLength(0);
    expect(requests).toHaveLength(0);
    expect((await ask(c)).ok, 'the same key is still usable for a clean question').toBe(true);
  });
});

describe('the AskStore seam: reserve is one atomic step', () => {
  const input = (over: Partial<Parameters<ReturnType<typeof createMemoryAskStore>['reserve']>[0]> = {}) => ({
    line: { phase: 'pre_call', askId: 'ask_1', at: new Date(DAY0).toISOString(), callerHash: 'c1', keyHash: 'k1' } as AskLedgerLine,
    callerHash: 'c1', keyHash: 'k1', questionMac: null, utcDay: '2026-10-19', globalCap: 3, callerCap: 2, ...over,
  });

  it('reserves, then reports duplicate for the same (caller, key) with the result row when there is one', async () => {
    const store = createMemoryAskStore();
    expect(await store.reserve(input())).toEqual({ kind: 'reserved' });
    expect(await store.reserve(input({ line: { phase: 'pre_call', askId: 'ask_2', at: new Date(DAY0).toISOString() } }))).toMatchObject({ kind: 'duplicate', askId: 'ask_1', result: null });
    await store.append({ phase: 'result', askId: 'ask_1', outcome: 'answered' });
    expect(await store.reserve(input())).toMatchObject({ kind: 'duplicate', result: { outcome: 'answered' } });
  });

  it('counts the day globally and per caller, global first, and a duplicate takes precedence over both caps', async () => {
    const store = createMemoryAskStore();
    const row = (n: number, caller: string) => input({ keyHash: `k${n}`, callerHash: caller, line: { phase: 'pre_call', askId: `ask_${n}`, at: new Date(DAY0).toISOString(), callerHash: caller, keyHash: `k${n}` } });
    expect(await store.reserve(row(1, 'a'))).toEqual({ kind: 'reserved' });
    expect(await store.reserve(row(2, 'a'))).toEqual({ kind: 'reserved' });
    expect(await store.reserve(row(3, 'a'))).toEqual({ kind: 'caller_cap_reached' });
    expect(await store.reserve(row(4, 'b'))).toEqual({ kind: 'reserved' });
    expect(await store.reserve(row(5, 'b'))).toEqual({ kind: 'cap_reached' });
    expect(await store.reserve(row(1, 'a'))).toMatchObject({ kind: 'duplicate' });
    expect(await store.reserve(row(6, 'c'))).toEqual({ kind: 'cap_reached' });
    expect(await store.reserve({ ...row(7, 'c'), utcDay: '2026-10-20', line: { phase: 'pre_call', askId: 'ask_7', at: '2026-10-20T00:00:01.000Z' } })).toEqual({ kind: 'reserved' });
  });

  it('parallel reservations through one store cannot pass the same check', async () => {
    const store = createMemoryAskStore();
    const results = await Promise.all([1, 2, 3, 4, 5, 6].map((n) => store.reserve(input({ keyHash: `p${n}`, callerHash: `pc${n}`, callerCap: 9, globalCap: 2, line: { phase: 'pre_call', askId: `ask_p${n}`, at: new Date(DAY0).toISOString(), callerHash: `pc${n}`, keyHash: `p${n}` } }))));
    expect(results.filter((r) => r.kind === 'reserved')).toHaveLength(2);
    expect((await store.rows()).filter((l) => l.phase === 'pre_call')).toHaveLength(2);
  });

  it('refuses 503 with NO provider call when the durable insert cannot commit, and holds no slot', async () => {
    let failing = true;
    const { requests, make } = rig(createMemoryAskStore({ failWrites: () => failing }));
    const c = make(env({ JULIUS_ASK_DAILY_CAP: '1' }));
    expect(refusal(await ask(c))).toEqual({ code: 'julius_ask_ledger_unavailable', httpStatus: 503 });
    expect(requests).toHaveLength(0);
    failing = false;
    expect((await ask(c)).ok).toBe(true);
  });
});

describe('the named 409 states after a duplicate key (a restart or a replica)', () => {
  it('already_answered carries askId, ledgerRef and answerDigest and never the text', async () => {
    const { store, make } = rig();
    const first = await ask(make());
    const again = await ask(make());
    expect(first.ok).toBe(true);
    expect(again).toMatchObject({ ok: false, code: 'julius_ask_already_answered', httpStatus: 409 });
    const detail = again.ok ? {} : again.detail ?? {};
    expect(detail).toEqual({ askId: first.ok ? first.askId : '', ledgerRef: first.ok ? first.ledgerRef : '', answerDigest: first.ok ? first.answerDigest : '' });
    expect(JSON.stringify(await store.rows())).not.toContain('fine');
    const route = await handleJuliusAskRoute({
      method: 'POST', authorization: 'Relay-Session t', origin: undefined, rawBody: JSON.stringify({ question: 'What is Julius?' }), idempotencyKey: 'store-key-0001', now: DAY0, operatorToken: 'op',
    }, { ask: make(), verifyNativeSession: () => ({ playerId: 'p1' }) });
    expect(route.status).toBe(409);
    expect(route.body).toMatchObject({ error: { kind: 'julius_ask_already_answered', detail: { answerDigest: first.ok ? first.answerDigest : '' } } });
  });

  it('previous_attempt_failed names the failure class, and a retry never buys a second call', async () => {
    const { requests, make } = rig(createMemoryAskStore(), timedOut);
    expect(refusal(await ask(make()))).toEqual({ code: 'julius_ask_provider_failed', httpStatus: 502 });
    const again = await ask(make());
    expect(again).toMatchObject({ ok: false, code: 'julius_ask_previous_attempt_failed', httpStatus: 409, detail: { failureClass: 'timeout' } });
    expect(requests).toHaveLength(1);
  });

  it('attempt_unknown when the pre-call row exists and the result row does not (a crash during the call)', async () => {
    const { store, requests, make } = rig();
    await ask(make());
    const kept = (await store.rows()).filter((l) => l.phase === 'pre_call');
    const crashed = createMemoryAskStore();
    for (const line of kept) await crashed.append(line);
    const { make: makeAfter, requests: after } = rig(crashed);
    const result = await ask(makeAfter());
    expect(result).toMatchObject({ ok: false, code: 'julius_ask_attempt_unknown', httpStatus: 409, detail: { askId: kept[0]?.askId } });
    expect(requests).toHaveLength(1);
    expect(after).toHaveLength(0);
  });

  it('binds a key to one question across a restart with an HMAC when the operator holds a secret; the digest is not a plain hash', async () => {
    const { store, make } = rig();
    const withSecret = env({ JULIUS_ASK_BINDING_SECRET: SECRET });
    await ask(make(withSecret), { question: 'first question' });
    const pre = (await store.rows()).find((l) => l.phase === 'pre_call');
    expect(String(pre?.questionMac)).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(pre)).not.toContain('first question');
    expect(refusal(await ask(make(withSecret), { question: 'another question' }))).toEqual({ code: 'julius_ask_idempotency_key_reused', httpStatus: 409 });
    expect(refusal(await ask(make(withSecret), { question: 'first question' }))).toEqual({ code: 'julius_ask_already_answered', httpStatus: 409 });
  });

  it('with no secret no question-derived value is stored, and any reused key after a restart is still refused', async () => {
    const { store, requests, make } = rig();
    await ask(make(), { question: 'first question' });
    expect(Object.keys((await store.rows())[0] ?? {})).not.toContain('questionMac');
    const again = await ask(make(), { question: 'a different question' });
    expect(again.ok).toBe(false);
    expect(requests).toHaveLength(1);
  });
});

describe('the per-caller cap and the player effort policy', () => {
  it('defaults the per-caller cap strictly below the global cap from 3 up, and applies it to players only', async () => {
    expect([1, 2, 3, 4, 20].map(defaultCallerDailyCap)).toEqual([1, 2, 2, 3, 3]);
    const { make } = rig();
    const c = make(env({ JULIUS_ASK_DAILY_CAP: '10' }));
    const players: boolean[] = [];
    const operators: boolean[] = [];
    for (let n = 0; n < 5; n += 1) {
      players.push((await ask(c, { caller: 'player:x', idempotencyKey: `capped-key-${n}000` })).ok);
      operators.push((await ask(c, { caller: 'operator', idempotencyKey: `oper-key-${n}0000` })).ok);
    }
    expect(players).toEqual([true, true, true, false, false]);
    expect(operators.slice(0, 5)).toEqual([true, true, true, true, true]);
  });

  it('caps a PLAYER at medium by default and ledgers policy_capped; the operator is not capped; a lower effort is not "capped"', async () => {
    const { store, requests, make } = rig();
    const c = make(env({ JULIUS_ASK_MAX_CONCURRENT: '4' }));
    await ask(c, { question: 'h'.repeat(900), idempotencyKey: 'effort-key-0001' });
    await ask(c, { question: 'l'.repeat(20), idempotencyKey: 'effort-key-0002' });
    await ask(c, { question: 'h'.repeat(900), idempotencyKey: 'effort-key-0003', caller: 'operator' });
    expect(requests.map((r) => r.config.reasoningEffort)).toEqual(['medium', 'low', 'high']);
    const pre = (await store.rows()).filter((l) => l.phase === 'pre_call');
    expect(pre.map((l) => [l.reasoningEffortChosen, l.effortBasis])).toEqual([['medium', 'policy_capped'], ['low', 'dynamic'], ['high', 'dynamic']]);
  });

  it('an unusable JULIUS_ASK_PLAYER_MAX_EFFORT falls back to the restrictive default, never to no ceiling', async () => {
    const { requests, make } = rig();
    await ask(make(env({ JULIUS_ASK_PLAYER_MAX_EFFORT: 'xhigh' })), { question: 'h'.repeat(900) });
    expect(requests[0]?.config.reasoningEffort).toBe('medium');
  });
});

describe('the wire', () => {
  it('the real runner forwards safety_identifier only when the request carries one', async () => {
    sdk.bodies.length = 0;
    const base = { apiKey: 'canary_store_key_0011223344', config: readGptArchitectConfig(env()), instructions: 'i', input: 'q', maxRetries: 0 } as const;
    await runGptArchitect(base);
    await runGptArchitect({ ...base, safetyIdentifier: 'jask_demo' });
    expect(sdk.bodies.map((b) => b.safety_identifier)).toEqual([undefined, 'jask_demo']);
    expect(Object.prototype.hasOwnProperty.call(sdk.bodies[0] ?? {}, 'safety_identifier')).toBe(false);
  });
});
