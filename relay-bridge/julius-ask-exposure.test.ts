import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createAskLedger, createJuliusAsk, handleJuliusAskRoute,
  type AskLedger, type AskLedgerLine, type JuliusAskResult,
} from './julius-ask';
import { readGptArchitectConfig } from '../src/relay/connectors/gpt-architect/config';
import type { GptRunOutcome, GptRunRequest } from '../src/relay/connectors/gpt-architect/gpt-runner';

/**
 * PLAYER-EXPOSURE NEGATIVE CONTROLS for the "ask Julius" route (reviewer findings F4-F8, threat review of fa35bc64,
 * re-review of 0ad05422). Written by SECOND JULIUS (juju2) as an independent suite. It FIXES NOTHING.
 *
 * Every test named "REQUIRED ..." describes one behaviour the reviewer requires before any player can reach the route,
 * and is expected to FAIL on 0ad05422 with an assertion message that names the missing behaviour. Every test named
 * "CONTROL ..." passes on 0ad05422 and shows the harness can tell a working control from a missing one.
 *
 * Everything goes through the exported API (createJuliusAsk, handleJuliusAskRoute, createAskLedger) and the route's
 * own dependency seams (runArchitect, readConfig, now, ledger, env). No network, no provider, no Postgres.
 *
 * ---------------------------------------------------------------------------------------------------------------------
 * THE PROPOSED SEAM (the route has no durable-store seam today; this is the smallest one these tests assume, AMENDABLE):
 *   The durable store is injected AS the `ledger` dependency. It is an AskLedger that also carries
 *     durable: true                                  (a Postgres-backed ledger says so; stdout and file ledgers do not)
 *     rows(): Promise<readonly AskLedgerLine[]>      (every row it holds, so a fresh instance can rebuild cap/key state)
 *   append() rejects when the row was NOT durably written (unchanged contract).
 *   "Player mode" = the caller string starts with `player:` (what handleJuliusAskRoute passes for a native session).
 *
 * THE PROPOSED PER-CALLER CAP: env JULIUS_ASK_CALLER_DAILY_CAP (positive integer); with nothing set, the default per-caller
 *   cap is STRICTLY BELOW the global daily cap, so one caller can never exhaust everyone's budget.
 *
 * THE PROPOSED RULE (input policy, F7; a human policy decision, written down here so the reviewer can amend it):
 *   P1 LENGTH: a question longer than 2000 characters after trim is refused 400 (already true).
 *   P2 CONTROL CHARACTERS: C0 controls except TAB and LF, DEL, C1 controls (U+0080-U+009F), bidi embeddings/overrides/
 *      isolates (U+202A-U+202E, U+2066-U+2069), zero-width characters (U+200B-U+200F), U+2028/U+2029 and U+FEFF are
 *      STRIPPED before the provider sees the question; the visible text is kept.
 *   P3 SECRETS: a question containing a credential-shaped token (an `sk-` key shape, or `Bearer <token>`) is never sent to
 *      the provider verbatim: it is refused (4xx, no provider call) or the token is redacted. Either satisfies the rule.
 *   P4 PERSONAL DATA: an e-mail address or a phone-number shape is never sent to the provider verbatim (refused or
 *      redacted, as P3).
 *   P5 MINORS: a question that self-declares an age under 13 ("I am 11 years old", "I'm 9") is REFUSED (4xx) with no
 *      provider call, never answered.
 *   P6 SAFETY IDENTIFIER: every provider request carries `safetyIdentifier`, a string derived from the caller hash:
 *      stable for one caller, different between callers, and never containing the raw caller id.
 *   Moderation (a provider moderation call) is NOT pinned here: there is no seam for it and the reviewer left the policy
 *   to a human decision.
 *
 * THE FAILURE-CACHING READING (F8): the route's own comment says "A failed attempt is stored too: it may have been billed",
 *   and the existing test pins that a retry with the same key cannot buy a second call. This suite keeps that reading:
 *   a retry with the SAME key after a PROVIDER failure is REFUSED WITH A NAMED REASON (a 4xx code different from the
 *   fresh failure code, 409 suggested), with no second provider call, so a client can tell "this key already failed,
 *   use a new key" from a new failure. What must NOT be cached is a failure that never reached the provider: a throw
 *   before contact (for example readConfig throwing) must not poison the key forever.
 * ---------------------------------------------------------------------------------------------------------------------
 */

/* Built at run time so no secret-shaped or personal-data-shaped literal exists in this source. */
const PROVIDER_KEY = ['canary', 'exposure', 'f0e1d2c3b4a5968778'].join('_');
const SECRET_SHAPED = ['sk', 'proj', 'Q'.repeat(12) + 'w'.repeat(12) + '7'.repeat(8)].join('-');
const BEARER_SHAPED = ['Bearer', ['tok', 'Z'.repeat(28)].join('_')].join(' ');
const EMAIL_SHAPED = ['jamie.player', ['example', 'org'].join('.')].join('@');
const PHONE_SHAPED = ['+1', '415', '555', '0134'].join(' ');
const OPERATOR = ['operator', 'token', 'exposure', 'tests'].join('-');
const DAY0 = Date.UTC(2026, 9, 19, 12, 0, 0);

const env = (extra: Record<string, string | undefined> = {}): Record<string, string | undefined> => ({
  JULIUS_ASK_ENABLED: '1',
  OPENAI_API_KEY: PROVIDER_KEY,
  OPENAI_PROMPT_ARCHITECT_MODEL: 'model-configured',
  RELAY_PROMPT_ARCHITECT_MODE: 'live',
  ...extra,
});

const usage = { inputTokens: 10, cachedInputTokens: 0, outputTokens: 5, reasoningTokens: 0, totalTokens: 15 };
const answered = (answer: string): GptRunOutcome => ({
  ok: true, actualModel: 'model-served', responseId: ['resp', 'exposure', '000111'].join('_'), status: 'completed',
  outputText: JSON.stringify({ answer }), usage,
});
const timedOut = (): GptRunOutcome => ({ ok: false, failureClass: 'timeout', message: 'timed out', usage });

/** An in-memory stand-in for the Postgres ledger: shared between instances (a restart or a replica), can be broken. */
interface FakeDurableStore extends AskLedger {
  readonly durable: true;
  rows(): Promise<readonly AskLedgerLine[]>;
  readonly held: AskLedgerLine[];
  readonly events: string[];
  broken: boolean;
}
function durableStore(events: string[] = []): FakeDurableStore {
  const held: AskLedgerLine[] = [];
  const store: FakeDurableStore = {
    durable: true,
    held,
    events,
    broken: false,
    async append(line) {
      events.push(`store:${String(line.phase)}`);
      await Promise.resolve();
      if (store.broken) throw new Error('durable store unavailable');
      held.push(line);
    },
    async rows() { return held.slice(); },
  };
  return store;
}

/** The provider side, shared between instances so a restart cannot hide a second paid call. */
interface FakeProvider {
  readonly requests: GptRunRequest[];
  outcome: () => GptRunOutcome | Promise<GptRunOutcome>;
  readonly run: (request: GptRunRequest) => Promise<GptRunOutcome>;
}
function provider(events: string[] = [], outcome: () => GptRunOutcome | Promise<GptRunOutcome> = () => answered('a plain answer')): FakeProvider {
  const p: FakeProvider = {
    requests: [],
    outcome,
    run: async (request) => { events.push('provider'); p.requests.push(request); return p.outcome(); },
  };
  return p;
}

function instance(o: {
  ledger: AskLedger;
  provider: FakeProvider;
  env?: Record<string, string | undefined>;
  now?: () => number;
  readConfig?: (e: Record<string, string | undefined>) => ReturnType<typeof readGptArchitectConfig>;
}) {
  return createJuliusAsk({
    env: o.env ?? env(),
    readConfig: o.readConfig ?? readGptArchitectConfig,
    now: o.now ?? (() => DAY0),
    ledger: o.ledger,
    runArchitect: o.provider.run,
  });
}

type Controller = ReturnType<typeof createJuliusAsk>;
const ask = (c: Controller, over: Partial<{ question: unknown; idempotencyKey: unknown; caller: unknown }> = {}): Promise<JuliusAskResult> =>
  c.handleAsk({ question: 'What is Julius?', idempotencyKey: 'exposure-key-0001', caller: 'player:p1', ...over });

/** A rejected handleAsk is a result too: it is reported, not allowed to crash the harness. */
type Settled = JuliusAskResult | { readonly ok: 'threw'; readonly message: string };
async function settle(p: Promise<JuliusAskResult>): Promise<Settled> {
  try { return await p; } catch (error) { return { ok: 'threw', message: error instanceof Error ? error.message : String(error) }; }
}
const describeResult = (r: Settled): string => (r.ok === true ? `answered (${r.askId})` : r.ok === false ? `refused ${r.httpStatus} ${r.code}` : `threw: ${r.message}`);

function quietConsole<T>(fn: () => Promise<T>): Promise<T> {
  const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  return fn().finally(() => spy.mockRestore());
}

/* ===================================================================================================================== */
describe('DURABLE LEDGER (F6): the pre-call row goes to a durable store, and the route refuses when it cannot', () => {
  it('CONTROL: the pre-call row is written to the injected durable store BEFORE the provider call, and a player is answered', async () => {
    const events: string[] = [];
    const store = durableStore(events);
    const p = provider(events);
    const result = await ask(instance({ ledger: store, provider: p }));
    expect(result.ok, `a player with a durable store must be answered, got ${describeResult(result)}`).toBe(true);
    expect(events).toEqual(['store:pre_call', 'provider', 'store:result']);
    expect(store.held[0]).toMatchObject({ phase: 'pre_call' });
  });

  it('CONTROL: when the durable pre-call write fails the route refuses, makes NO provider call, and releases the slot', async () => {
    const store = durableStore();
    const p = provider();
    const c = instance({ ledger: store, provider: p, env: env({ JULIUS_ASK_DAILY_CAP: '1' }) });
    store.broken = true;
    const refused = await ask(c, { idempotencyKey: 'durable-fail-0001' });
    expect(refused).toEqual({ ok: false, code: 'julius_ask_ledger_unavailable', httpStatus: 503 });
    expect(p.requests).toHaveLength(0);
    store.broken = false;
    const after = await ask(c, { idempotencyKey: 'durable-fail-0002' });
    expect(after.ok, `the cap slot was not released after a failed durable write: ${describeResult(after)}`).toBe(true);
    expect(p.requests).toHaveLength(1);
  });

  it('REQUIRED: a player ask with only the STDOUT ledger is refused (503 ledger unavailable) with no provider call', async () => {
    const p = provider();
    const result = await quietConsole(() => ask(instance({ ledger: createAskLedger(null), provider: p })));
    expect(p.requests.length, 'MISSING: player mode accepted the stdout ledger (not durable, cannot fail closed) and called the provider').toBe(0);
    expect(result.ok, `MISSING: player ask over the stdout ledger must be refused, got ${describeResult(result)}`).toBe(false);
    expect(result.ok === false ? result.code : '', 'the refusal must name the ledger').toMatch(/ledger/);
  });

  it('REQUIRED: a player ask with only the FILE ledger is refused: a file is not the durable store required for players', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'julius-ask-exposure-'));
    try {
      const p = provider();
      const result = await ask(instance({ ledger: createAskLedger(join(dir, 'ledger.jsonl')), provider: p }));
      expect(p.requests.length, 'MISSING: player mode accepted a local file ledger (no fsync, per-host) instead of the durable store').toBe(0);
      expect(result.ok, `MISSING: player ask over the file ledger must be refused, got ${describeResult(result)}`).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('REQUIRED: even the operator is refused over the STDOUT ledger (it cannot fail closed); the operator over a FILE ledger stays allowed', async () => {
    const p = provider();
    const stdout = await quietConsole(() => ask(instance({ ledger: createAskLedger(null), provider: p }), { caller: 'operator' }));
    expect(p.requests.length, 'MISSING: with no state root (stdout ledger) the route still called the provider; F6 asks for 503').toBe(0);
    expect(stdout.ok, `MISSING: stdout-ledger ask must be refused, got ${describeResult(stdout)}`).toBe(false);
    const dir = mkdtempSync(join(tmpdir(), 'julius-ask-exposure-'));
    try {
      const file = await ask(instance({ ledger: createAskLedger(join(dir, 'ledger.jsonl')), provider: p }), { caller: 'operator' });
      expect(file.ok, `the operator smoke path (file ledger) must keep working, got ${describeResult(file)}`).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/* ===================================================================================================================== */
describe('PER-CALLER CAP (F5): one caller cannot exhaust another caller\'s budget', () => {
  it('REQUIRED: with JULIUS_ASK_CALLER_DAILY_CAP=2 each caller gets exactly 2, and the third is refused 429 while another caller still gets 2', async () => {
    const p = provider();
    const c = instance({ ledger: durableStore(), provider: p, env: env({ JULIUS_ASK_DAILY_CAP: '10', JULIUS_ASK_CALLER_DAILY_CAP: '2' }) });
    const a = [] as JuliusAskResult[];
    for (const n of [1, 2, 3]) a.push(await ask(c, { caller: 'player:a', idempotencyKey: `caller-a-key-${n}` }));
    expect(a.slice(0, 2).every((r) => r.ok), 'the first two asks of caller A are within its cap').toBe(true);
    expect(a[2]?.ok, `MISSING: caller A got a THIRD ask past its own daily cap of 2 (${describeResult(a[2] as JuliusAskResult)})`).toBe(false);
    expect(a[2]?.ok === false ? a[2].httpStatus : 0, 'the per-caller refusal is a 429').toBe(429);
    const b1 = await ask(c, { caller: 'player:b', idempotencyKey: 'caller-b-key-1' });
    const b2 = await ask(c, { caller: 'player:b', idempotencyKey: 'caller-b-key-2' });
    expect([b1.ok, b2.ok], 'caller B has its own independent cap of 2').toEqual([true, true]);
    expect(p.requests.length, 'provider calls: 2 for A and 2 for B').toBe(4);
  });

  it('REQUIRED: with the DEFAULT caps one caller using 20 fresh keys cannot stop a second caller from asking', async () => {
    const p = provider();
    const c = instance({ ledger: durableStore(), provider: p });
    for (let i = 0; i < 20; i += 1) await ask(c, { caller: 'player:greedy', idempotencyKey: `greedy-key-${String(i).padStart(3, '0')}` });
    const other = await ask(c, { caller: 'player:other', idempotencyKey: 'other-key-0001' });
    expect(other.ok, `MISSING: one caller exhausted the shared budget and the next caller was refused: ${describeResult(other)}`).toBe(true);
  });

  it('REQUIRED: the per-caller cap counts the AUTHENTICATED session, not a caller named in the request body', async () => {
    const p = provider();
    const c = instance({ ledger: durableStore(), provider: p, env: env({ JULIUS_ASK_DAILY_CAP: '10', JULIUS_ASK_CALLER_DAILY_CAP: '1' }) });
    const route = (playerId: string, key: string, bodyCaller: string) => handleJuliusAskRoute({
      method: 'POST', authorization: 'Relay-Session paired-token', origin: undefined,
      rawBody: JSON.stringify({ question: 'hello', caller: bodyCaller }), idempotencyKey: key, now: DAY0, operatorToken: OPERATOR,
    }, { ask: c, verifyNativeSession: () => ({ playerId }) });
    const first = await route('p1', 'session-key-0001', 'player:p1');
    const second = await route('p1', 'session-key-0002', 'player:p2');
    expect(first.status, 'the first ask of session p1 is within its cap').toBe(200);
    expect(second.status, 'MISSING: session p1 got a second ask past its per-caller cap of 1 (body claimed player:p2)').toBe(429);
    const p2 = await route('p2', 'session-key-0003', 'player:p1');
    expect(p2.status, 'session p2 still has its own cap').toBe(200);
  });

  it('CONTROL: the caller identity comes from the authenticated session; a caller field in the body is ignored', async () => {
    const seen: unknown[] = [];
    const spy = { handleAsk: async (input: unknown): Promise<JuliusAskResult> => { seen.push(input); return { ok: false, code: 'spy', httpStatus: 418 }; } };
    await handleJuliusAskRoute({
      method: 'POST', authorization: 'Relay-Session paired-token', origin: undefined,
      rawBody: JSON.stringify({ question: 'hello', caller: 'player:victim' }), idempotencyKey: 'spy-key-00001', now: DAY0, operatorToken: OPERATOR,
    }, { ask: spy, verifyNativeSession: () => ({ playerId: 'real' }) });
    await handleJuliusAskRoute({
      method: 'POST', authorization: undefined, origin: undefined,
      rawBody: JSON.stringify({ question: 'hello', caller: 'operator' }), idempotencyKey: 'spy-key-00002', now: DAY0, operatorToken: OPERATOR,
    }, { ask: spy, verifyNativeSession: () => null });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ caller: 'player:real' });
  });
});

/* ===================================================================================================================== */
describe('INPUT POLICY (F7): what a player may send to the provider (see THE PROPOSED RULE at the top of this file)', () => {
  it('CONTROL (P1): a question over 2000 characters is refused 400 with no provider call and no ledger row', async () => {
    const store = durableStore();
    const p = provider();
    const result = await ask(instance({ ledger: store, provider: p }), { question: 'q'.repeat(2001) });
    expect(result).toEqual({ ok: false, code: 'julius_ask_question_invalid', httpStatus: 400 });
    expect(p.requests).toHaveLength(0);
    expect(store.held).toHaveLength(0);
  });

  it('REQUIRED (P2): control, bidi and zero-width characters are stripped before the provider sees the question', async () => {
    const ch = (code: number) => String.fromCharCode(code);
    const hostile = [ch(0x00), ch(0x07), ch(0x1b) + '[31m', ch(0x7f), ch(0x9b), ch(0x202e), ch(0x2066), ch(0x200b), ch(0x2028), ch(0xfeff)];
    const question = `where ${hostile.join('is')} the library`;
    const p = provider();
    const result = await ask(instance({ ledger: durableStore(), provider: p }), { question });
    expect(result.ok, `a question with stray control characters is answered after cleaning, got ${describeResult(result)}`).toBe(true);
    const sent = p.requests[0]?.input ?? '';
    const bad = (c: string): boolean => { const n = c.codePointAt(0) ?? 0; return (n <= 0x1f && n !== 0x09 && n !== 0x0a) || (n >= 0x7f && n <= 0x9f) || (n >= 0x200b && n <= 0x200f) || n === 0x2028 || n === 0x2029 || (n >= 0x202a && n <= 0x202e) || (n >= 0x2066 && n <= 0x2069) || n === 0xfeff; };
    const found = [...sent].filter(bad).map((c) => `U+${c.codePointAt(0)?.toString(16).padStart(4, '0')}`);
    expect(found, 'MISSING: the question reached the provider with these unstripped characters (the plan\'s "sanitized question" is not in the code)').toEqual([]);
    expect(sent).toContain('library');
  });

  it('REQUIRED (P3): a credential-shaped token in the question never reaches the provider verbatim (refused or redacted)', async () => {
    const store = durableStore();
    const p = provider();
    const result = await ask(instance({ ledger: store, provider: p }), { question: `my key is ${SECRET_SHAPED} and header ${BEARER_SHAPED}, is it valid?` });
    const sent = p.requests.map((r) => r.input).join('\n');
    expect(sent.includes(SECRET_SHAPED), 'MISSING: an sk- key shape typed by a player was sent to the provider verbatim').toBe(false);
    expect(sent.includes(BEARER_SHAPED.split(' ')[1] ?? ''), 'MISSING: a Bearer token typed by a player was sent to the provider verbatim').toBe(false);
    expect(result.ok === false ? result.httpStatus < 500 : true, `a refusal under P3 is a 4xx, got ${describeResult(result)}`).toBe(true);
    expect(JSON.stringify(store.held)).not.toContain(SECRET_SHAPED);
  });

  it('REQUIRED (P4): an e-mail address or phone number in the question never reaches the provider verbatim (refused or redacted)', async () => {
    const p = provider();
    const result = await ask(instance({ ledger: durableStore(), provider: p }), { question: `email me at ${EMAIL_SHAPED} or call ${PHONE_SHAPED}` });
    const sent = p.requests.map((r) => r.input).join('\n');
    expect(sent.includes(EMAIL_SHAPED), 'MISSING: a player\'s e-mail address was sent to the provider verbatim (no PII policy)').toBe(false);
    expect(sent.includes(PHONE_SHAPED), 'MISSING: a player\'s phone number was sent to the provider verbatim (no PII policy)').toBe(false);
    expect(result.ok === false ? result.httpStatus < 500 : true, `a refusal under P4 is a 4xx, got ${describeResult(result)}`).toBe(true);
  });

  it('REQUIRED (P5): a question that self-declares an age under 13 is refused (4xx) with no provider call', async () => {
    for (const question of ['I am 11 years old, what is Julius?', "i'm 9 and want to know about the library"]) {
      const p = provider();
      const result = await ask(instance({ ledger: durableStore(), provider: p }), { question });
      expect(p.requests.length, `MISSING: no minors policy: "${question}" was sent to the provider`).toBe(0);
      expect(result.ok === false && result.httpStatus >= 400 && result.httpStatus < 500, `MISSING: minors marker must be refused 4xx, got ${describeResult(result)}`).toBe(true);
    }
  });

  it('REQUIRED (P6): every provider request carries a safetyIdentifier derived from the caller: stable, distinct, never the raw id', async () => {
    const p = provider();
    const c = instance({ ledger: durableStore(), provider: p, env: env({ JULIUS_ASK_MAX_CONCURRENT: '4' }) });
    await ask(c, { caller: 'player:alpha-777', idempotencyKey: 'safety-key-0001' });
    await ask(c, { caller: 'player:alpha-777', idempotencyKey: 'safety-key-0002' });
    await ask(c, { caller: 'player:beta-888', idempotencyKey: 'safety-key-0003' });
    const ids = p.requests.map((r) => (r as unknown as { safetyIdentifier?: unknown }).safetyIdentifier);
    expect(typeof ids[0], 'MISSING: the provider request carries no safetyIdentifier (F7)').toBe('string');
    expect(ids[1], 'the safetyIdentifier is stable for one caller').toBe(ids[0]);
    expect(ids[2], 'two callers get different safetyIdentifiers').not.toBe(ids[0]);
    expect(String(ids[0]), 'the safetyIdentifier must not contain the raw caller id').not.toContain('alpha-777');
  });
});

/* ===================================================================================================================== */
describe('RESTART / REPLICA IDEMPOTENCY (F4): state lives in the durable store, not only in the process', () => {
  it('REQUIRED: the same key after a restart (fresh instance, same durable store) makes NO second provider call', async () => {
    const store = durableStore();
    const p = provider();
    const first = await ask(instance({ ledger: store, provider: p }));
    expect(first.ok).toBe(true);
    const afterRestart = await settle(ask(instance({ ledger: store, provider: p })));
    expect(p.requests.length, `MISSING: a restart forgot the key and BOUGHT A SECOND CALL for it (${describeResult(afterRestart)})`).toBe(1);
    const sameAnswer = afterRestart.ok === true && first.ok && afterRestart.askId === first.askId;
    const namedRefusal = afterRestart.ok === false && afterRestart.httpStatus < 500 && /key|idempot|replay|already/.test(afterRestart.code);
    expect(sameAnswer || namedRefusal, `after a restart the key returns the stored answer or a named key refusal, got ${describeResult(afterRestart)}`).toBe(true);
  });

  it('REQUIRED: a key that FAILED at the provider before a restart does not buy a second call after it; the stored failure is returned', async () => {
    const store = durableStore();
    const p = provider([], timedOut);
    const first = await ask(instance({ ledger: store, provider: p }));
    expect(first).toMatchObject({ ok: false, httpStatus: 502 });
    p.outcome = () => answered('second paid call');
    const afterRestart = await settle(ask(instance({ ledger: store, provider: p })));
    expect(p.requests.length, `MISSING: a restart forgot a possibly billed failure and paid again for the same key (${describeResult(afterRestart)})`).toBe(1);
    expect(afterRestart.ok, 'the stored failure (or a named refusal) comes back, not a new answer').toBe(false);
  });

  it('REQUIRED: the daily cap survives a restart: a fresh instance counts today\'s pre-call rows in the durable store', async () => {
    const store = durableStore();
    const p = provider();
    const capped = env({ JULIUS_ASK_DAILY_CAP: '2' });
    const before = instance({ ledger: store, provider: p, env: capped });
    await ask(before, { idempotencyKey: 'restart-cap-0001' });
    await ask(before, { idempotencyKey: 'restart-cap-0002' });
    expect(p.requests).toHaveLength(2);
    const after = await settle(ask(instance({ ledger: store, provider: p, env: capped }), { idempotencyKey: 'restart-cap-0003' }));
    expect(p.requests.length, `MISSING: a restart reset the daily cap to zero and a third call was bought (${describeResult(after)})`).toBe(2);
    expect(after).toMatchObject({ ok: false, code: 'julius_ask_cap_reached', httpStatus: 429 });
  });

  it('REQUIRED: two replicas sharing one durable store share one daily cap', async () => {
    const store = durableStore();
    const p = provider();
    const capped = env({ JULIUS_ASK_DAILY_CAP: '2' });
    const a = instance({ ledger: store, provider: p, env: capped });
    const b = instance({ ledger: store, provider: p, env: capped });
    await ask(a, { idempotencyKey: 'replica-key-0001' });
    await ask(b, { idempotencyKey: 'replica-key-0002' });
    const third = await settle(ask(a, { idempotencyKey: 'replica-key-0003' }));
    expect(p.requests.length, `MISSING: each replica kept its own cap, so the pair bought a third call past a cap of 2 (${describeResult(third)})`).toBe(2);
    expect(third).toMatchObject({ ok: false, code: 'julius_ask_cap_reached' });
  });
});

/* ===================================================================================================================== */
describe('FAILURE CACHING (F8): a failure is bound to its key only when the provider may have billed it', () => {
  it('REQUIRED: a throw BEFORE provider contact (readConfig throws once) does not poison the key: the same key works afterwards', async () => {
    let throwNext = true;
    const p = provider();
    const c = instance({
      ledger: durableStore(), provider: p,
      readConfig: (e) => { if (throwNext) { throwNext = false; throw new Error('config read failed'); } return readGptArchitectConfig(e); },
    });
    const first = await settle(ask(c));
    expect(first.ok, 'the first attempt cannot be answered').not.toBe(true);
    expect(p.requests).toHaveLength(0);
    const retry = await settle(ask(c));
    expect(retry.ok, `MISSING: a failure that never reached the provider was cached forever for this key: ${describeResult(retry)}`).toBe(true);
    expect(p.requests).toHaveLength(1);
  });

  it('REQUIRED: a retry with the SAME key after a provider failure is refused with a NAMED reason (not a silent replay), with no second call', async () => {
    const store = durableStore();
    const p = provider([], timedOut);
    const c = instance({ ledger: store, provider: p });
    const first = await ask(c);
    expect(first).toEqual({ ok: false, code: 'julius_ask_provider_failed', httpStatus: 502 });
    /* Pinned minimum (passes today): the failure row records its class. */
    expect(store.held.find((l) => l.phase === 'result')).toMatchObject({ outcome: 'julius_ask_provider_failed', failureClass: 'timeout' });
    const retry = await settle(ask(c));
    expect(p.requests.length, 'a retry with the same key must never buy a second call').toBe(1);
    expect(retry.ok, 'the retry is not answered').toBe(false);
    const code = retry.ok === false ? retry.code : '';
    const status = retry.ok === false ? retry.httpStatus : 0;
    expect(code, 'MISSING: the retry replays the original failure code, so a client cannot tell "this key already failed, use a new key" from a new failure').not.toBe('julius_ask_provider_failed');
    expect(status >= 400 && status < 500, `the named refusal is a 4xx (409 suggested), got ${status}`).toBe(true);
  });
});

/* ===================================================================================================================== */
describe('KEY BINDING (F8, already fixed at 0ad05422)', () => {
  it('CONTROL: the same key with a different question is refused 409 key_reused and buys nothing', async () => {
    const p = provider();
    const c = instance({ ledger: durableStore(), provider: p });
    const first = await ask(c, { question: 'first question' });
    expect(first.ok).toBe(true);
    expect(await ask(c, { question: 'another question' })).toEqual({ ok: false, code: 'julius_ask_idempotency_key_reused', httpStatus: 409 });
    expect(p.requests).toHaveLength(1);
  });
});
