import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ASK_EFFORTS, ASK_QUESTION_MAX_CHARS, createAskLedger, createJuliusAsk, createMemoryAskStore, handleJuliusAskRoute, markAskStoreDurable, reserveOverDurableLedger, selectAskBudget,
  type AskLedger, type AskLedgerLine, type AskReserveInput, type AskStore, type JuliusAskResult,
} from './julius-ask';
import { createFileAskStore, type FileAskStore } from './julius-ask-file-store';
import { readGptArchitectConfig } from '../src/relay/connectors/gpt-architect/config';
import { runGptArchitect, type GptRunOutcome, type GptRunRequest } from '../src/relay/connectors/gpt-architect/gpt-runner';

/* The SDK is mocked for the whole file so the real-runner tests can read the exact request body; nothing reaches a provider. */
const sdk = vi.hoisted(() => ({
  bodies: [] as Array<Record<string, unknown>>,
  constructed: [] as Array<Record<string, unknown>>,
  impl: null as null | (() => Promise<unknown>),
}));
vi.mock('openai', () => ({
  default: class {
    constructor(options: Record<string, unknown>) { sdk.constructed.push(options); }
    responses = {
      create: async (body: Record<string, unknown>) => {
        sdk.bodies.push(body);
        if (sdk.impl === null) throw new Error('no SDK behaviour configured');
        return sdk.impl();
      },
    };
  },
}));

/* node:fs passes through unchanged, except that a test can make the NEXT fsync fail (EIO) to drive the file store's
   durable-write failure path. Nothing else in node:fs is altered. */
const fsFault = vi.hoisted(() => ({ failNextFsyncs: 0, fsyncCalls: 0 }));
vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>();
  const fsyncSync = (fd: number): void => {
    fsFault.fsyncCalls += 1;
    if (fsFault.failNextFsyncs > 0) {
      fsFault.failNextFsyncs -= 1;
      throw Object.assign(new Error('EIO: i/o error, fsync'), { code: 'EIO' });
    }
    real.fsyncSync(fd);
  };
  return { ...real, fsyncSync, default: { ...real, fsyncSync } };
});

/**
 * PLAYER-EXPOSURE NEGATIVE CONTROLS for the "ask Julius" route (reviewer findings F4-F8, threat review of fa35bc64,
 * re-review of 0ad05422). Written by SECOND JULIUS (juju2) as an independent suite. It FIXES NOTHING.
 *
 * Every test named "REQUIRED ..." describes one behaviour the reviewer requires before any player can reach the route,
 * and is expected to FAIL on 0ad05422 with an assertion message that names the missing behaviour. Every test named
 * "CONTROL ..." passes on 0ad05422 and shows the harness can tell a working control from a missing one.
 *
 * Everything goes through the exported API (createJuliusAsk, handleJuliusAskRoute, createAskLedger, selectAskBudget) and
 * the route's own dependency seams (runArchitect, readConfig, now, ledger, env, modelCapabilities). No network, no
 * provider, no Postgres. The `openai` SDK is mocked so the real runner's request body can be read.
 *
 * REBASED onto 167a3581 (the FOUNDER no-artificial-token-caps head). This suite asserts NO numeric output-token ceiling
 * of its own anywhere, and the blocks at the end pin, as CONTROLS: the route imposes no token ceiling (an operator
 * override passes through unchanged at and around the removed 500/1200/1500/4000 values); the budget basis is one of
 * operator_override | provider_max | omitted and is ledgered; the effort is the closed set low|medium|high; a caller
 * cannot raise its own budget except through the documented lever (the trimmed question length); answerSha256 in the
 * result row equals the sha256 of the exact UTF-8 bytes of the returned answer and the response carries it as answerDigest;
 * and the protections that stay (daily call cap, concurrency, one billed call with maxRetries 0, authentication).
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
  /* Reviewer ruling (mailbox 4ce81b, item 1): a PLAYER ask with no safety secret is refused 503. Every test here therefore runs
     WITH one by default; the tests about the no-secret case remove it explicitly (JULIUS_ASK_SAFETY_SECRET: undefined). */
  JULIUS_ASK_SAFETY_SECRET: ['exposure', 'safety', 'default', '0123456789'].join('-'),
  ...extra,
});

const usage = { inputTokens: 10, cachedInputTokens: 0, outputTokens: 5, reasoningTokens: 0, totalTokens: 15 };
const answered = (answer: string): GptRunOutcome => ({
  ok: true, actualModel: 'model-served', responseId: ['resp', 'exposure', '000111'].join('_'), status: 'completed',
  outputText: JSON.stringify({ answer }), usage,
});
const timedOut = (): GptRunOutcome => ({ ok: false, failureClass: 'timeout', message: 'timed out', usage });

/** An in-memory stand-in for the Postgres ledger: shared between instances (a restart or a replica), can be broken. */
interface FakeDurableStore extends AskStore {
  readonly durable: true;
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
    /* A player needs an atomic reserve (the rows-based path is operator-only): the fake serialises it like the real store. */
    reserve: (input) => reserveOverDurableLedger(store, input),
  };
  /* A plain {durable: true} object is no longer accepted: the store factory (here, the test's) brands its own store. */
  return markAskStoreDurable(store);
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
  modelCapabilities?: Parameters<typeof createJuliusAsk>[0]['modelCapabilities'];
  runArchitect?: (request: GptRunRequest) => Promise<GptRunOutcome>;
}) {
  return createJuliusAsk({
    env: o.env ?? env(),
    readConfig: o.readConfig ?? readGptArchitectConfig,
    now: o.now ?? (() => DAY0),
    ledger: o.ledger,
    runArchitect: o.runArchitect ?? o.provider.run,
    ...(o.modelCapabilities === undefined ? {} : { modelCapabilities: o.modelCapabilities }),
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
    const c = instance({ ledger: durableStore(), provider: p, env: env({ JULIUS_ASK_MAX_CONCURRENT: '4', JULIUS_ASK_SAFETY_SECRET: ['safety', 'secret', 'for', 'the', 'test', '0123456789'].join('-') }) });
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

/* ===================================================================================================================== */
/* Added on the rebase to 167a3581: the founder's no-artificial-token-caps directive and what must stay.                 */

const sha256Hex = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex');
const sdkAnswer = (answer: string) => async () => ({
  id: ['resp', 'sdk', '000222'].join('_'), model: 'model-served', status: 'completed', output: [],
  output_text: JSON.stringify({ answer }), usage: { input_tokens: 3, output_tokens: 4, total_tokens: 7 },
});
const lastBody = (): Record<string, unknown> => sdk.bodies[sdk.bodies.length - 1] ?? {};
const BASES: readonly string[] = ['operator_override', 'provider_max', 'omitted'];
const rowOf = (store: FakeDurableStore, phase: string, askId?: string): AskLedgerLine | undefined =>
  store.held.find((l) => l.phase === phase && (askId === undefined || l.askId === askId));

describe('NO ROUTE TOKEN CEILING (founder directive): the provider\'s own limit applies unless the operator sets one', () => {
  it('CONTROL: selectAskBudget, with no override and no documented maximum, omits max_output_tokens for EVERY allowed question length', () => {
    const capped: number[] = [];
    for (let n = 1; n <= ASK_QUESTION_MAX_CHARS; n += 1) {
      const b = selectAskBudget({ questionChars: n });
      if (b.maxOutputTokens !== null || b.basis !== 'omitted') capped.push(n);
    }
    expect(capped, 'a route-imposed output ceiling appeared for these question lengths').toEqual([]);
  });

  it('CONTROL: through the controller the runner is told to OMIT max_output_tokens and the pre-call row records "omitted"', async () => {
    const store = durableStore();
    const p = provider();
    const c = instance({ ledger: store, provider: p });
    const questions = ['short', 'm'.repeat(500), 'h'.repeat(ASK_QUESTION_MAX_CHARS)];
    for (const [i, question] of questions.entries()) expect((await ask(c, { question, idempotencyKey: `omit-key-000${i}` })).ok).toBe(true);
    expect(p.requests.map((r) => r.omitMaxOutputTokens), 'every ask must omit the output field').toEqual([true, true, true]);
    const pre = store.held.filter((l) => l.phase === 'pre_call');
    expect(pre.map((l) => [l.budgetBasis, l.maxOutputTokensSent])).toEqual([['omitted', 'omitted'], ['omitted', 'omitted'], ['omitted', 'omitted']]);
  });

  it('CONTROL: the real runner sends NO max_output_tokens field on the wire, for a short and a 2000-character question', async () => {
    sdk.bodies.length = 0;
    sdk.impl = sdkAnswer('wire answer');
    const c = instance({ ledger: durableStore(), provider: provider(), runArchitect: runGptArchitect });
    expect((await ask(c, { question: 'short', idempotencyKey: 'wire-key-0001' })).ok).toBe(true);
    expect((await ask(c, { question: 'w'.repeat(ASK_QUESTION_MAX_CHARS), idempotencyKey: 'wire-key-0002' })).ok).toBe(true);
    expect(sdk.bodies).toHaveLength(2);
    expect(sdk.bodies.map((b) => Object.prototype.hasOwnProperty.call(b, 'max_output_tokens')), 'max_output_tokens reached the wire').toEqual([false, false]);
  });

  it('CONTROL: an operator override passes through UNCHANGED at and around the removed 500/1200/1500/4000 values (no clamp, no floor)', async () => {
    sdk.impl = sdkAnswer('override answer');
    const values = [1, 499, 500, 501, 1199, 1200, 1201, 1499, 1500, 1501, 3999, 4000, 4001, 32768, 1_000_000];
    const wrong: string[] = [];
    for (const v of values) {
      sdk.bodies.length = 0;
      const store = durableStore();
      const c = instance({ ledger: store, provider: provider(), runArchitect: runGptArchitect, env: env({ JULIUS_ASK_MAX_OUTPUT_TOKENS: String(v) }) });
      const result = await ask(c, { idempotencyKey: `override-key-${v}` });
      const pre = rowOf(store, 'pre_call');
      const sent = lastBody().max_output_tokens;
      if (!result.ok || sent !== v || pre?.budgetBasis !== 'operator_override' || pre?.maxOutputTokensSent !== v) {
        wrong.push(`${v}: ok=${String(result.ok)} sent=${String(sent)} basis=${String(pre?.budgetBasis)} ledgered=${String(pre?.maxOutputTokensSent)}`);
      }
    }
    expect(wrong, 'an operator override was clamped, floored or mis-recorded').toEqual([]);
  });

  it('CONTROL: a documented provider maximum (the modelCapabilities seam) is sent as-is and recorded as provider_max', async () => {
    const store = durableStore();
    const p = provider();
    const c = instance({ ledger: store, provider: p, modelCapabilities: () => ({ maxOutputTokens: 128_000 }) });
    expect((await ask(c)).ok).toBe(true);
    expect(p.requests[0]?.config.maxOutputTokens).toBe(128_000);
    expect(p.requests[0]?.omitMaxOutputTokens).not.toBe(true);
    expect(rowOf(store, 'pre_call')).toMatchObject({ budgetBasis: 'provider_max', maxOutputTokensSent: 128_000 });
  });
});

describe('BUDGET BASIS AND EFFORT: closed sets, chosen server-side, ledgered', () => {
  it('CONTROL: the basis is exactly one of operator_override | provider_max | omitted, ledgered for the askId, and matches what was sent', async () => {
    const scenarios = [
      { name: 'omitted', e: env(), caps: undefined },
      { name: 'operator_override', e: env({ JULIUS_ASK_MAX_OUTPUT_TOKENS: '7777' }), caps: undefined },
      { name: 'provider_max', e: env(), caps: () => ({ maxOutputTokens: 64_000 }) },
    ];
    for (const s of scenarios) {
      const store = durableStore();
      const result = await ask(instance({ ledger: store, provider: provider(), env: s.e, modelCapabilities: s.caps }));
      expect(result.ok, s.name).toBe(true);
      const pre = rowOf(store, 'pre_call');
      expect(BASES, `basis ${String(pre?.budgetBasis)} is outside the closed set`).toContain(pre?.budgetBasis);
      expect(pre?.budgetBasis).toBe(s.name);
      expect(pre?.maxOutputTokensSent === 'omitted', `"omitted" is ledgered exactly when nothing was sent (${s.name})`).toBe(s.name === 'omitted');
      expect(rowOf(store, 'result', String(pre?.askId)), 'the result row reconciles with the pre-call row by askId').toBeDefined();
    }
  });

  it('CONTROL: ASK_EFFORTS is exactly low|medium|high and selectAskBudget never leaves it, for every length', () => {
    expect([...ASK_EFFORTS]).toEqual(['low', 'medium', 'high']);
    const outside: string[] = [];
    for (let n = 0; n <= ASK_QUESTION_MAX_CHARS; n += 1) {
      for (const caps of [{}, { supportsReasoningEffort: true }]) {
        const effort = selectAskBudget({ questionChars: n, modelCapabilities: caps }).reasoningEffort;
        if (effort === null || !ASK_EFFORTS.includes(effort)) outside.push(`${n}:${String(effort)}`);
      }
    }
    expect(outside, 'an effort outside the closed set was chosen').toEqual([]);
    expect(selectAskBudget({ questionChars: 50, modelCapabilities: { supportsReasoningEffort: false } }).reasoningEffort).toBeNull();
  });

  it('CONTROL: an unknown effort carried by the config never reaches the wire (refused, or replaced by the route\'s closed-set choice)', async () => {
    sdk.impl = sdkAnswer('effort answer');
    const leaked: string[] = [];
    for (const bogus of ['xhigh', 'minimal', 'max', 'none', 'HIGH']) {
      sdk.bodies.length = 0;
      const c = instance({
        ledger: durableStore(), provider: provider(), runArchitect: runGptArchitect,
        readConfig: (e) => ({ ...readGptArchitectConfig(e), reasoningEffort: bogus as never }),
      });
      const result = await ask(c, { idempotencyKey: `effort-key-${bogus}` });
      const effort = (lastBody().reasoning as { effort?: unknown } | undefined)?.effort;
      const refusedBeforeWire = !result.ok && sdk.bodies.length === 0;
      const closedOnWire = sdk.bodies.length === 1 && typeof effort === 'string' && (ASK_EFFORTS as readonly string[]).includes(effort);
      if (!(refusedBeforeWire || closedOnWire)) leaked.push(`${bogus} -> ${String(effort)} (${result.ok ? 'answered' : result.code})`);
    }
    expect(leaked, 'an effort outside low|medium|high reached the provider').toEqual([]);
  });

  it('CONTROL: an unusable operator override is refused (503, fails closed, no provider call, no ledger row), never run uncapped', async () => {
    const accepted: string[] = [];
    for (const raw of ['abc', '0', '-5', '12.5', 'Infinity', 'NaN', '1e400']) {
      const store = durableStore();
      const p = provider();
      const result = await ask(instance({ ledger: store, provider: p, env: env({ JULIUS_ASK_MAX_OUTPUT_TOKENS: raw }) }));
      const refused = !result.ok && result.httpStatus === 503 && p.requests.length === 0 && store.held.length === 0;
      if (!refused) accepted.push(`${raw}: ${result.ok ? 'answered' : `${result.httpStatus} ${result.code}`} calls=${p.requests.length}`);
    }
    expect(accepted, 'an unusable override was not refused').toEqual([]);
  });

  it('CONTROL: a model known to reject an effort gets none, and the pre-call row says not_sent', async () => {
    const store = durableStore();
    const p = provider();
    expect((await ask(instance({ ledger: store, provider: p, modelCapabilities: () => ({ supportsReasoningEffort: false }) }))).ok).toBe(true);
    expect(p.requests[0]?.config.reasoningEffort).toBeUndefined();
    expect(rowOf(store, 'pre_call')).toMatchObject({ reasoningEffortChosen: null, effortBasis: 'not_sent' });
  });
});

describe('A CALLER CANNOT RAISE ITS OWN BUDGET (the route docs: only the trimmed question length and the operator environment)', () => {
  const pick = (r: GptRunRequest | undefined) => ({
    omit: r?.omitMaxOutputTokens, max: r?.omitMaxOutputTokens === true ? 'omitted' : r?.config.maxOutputTokens,
    effort: r?.config.reasoningEffort, timeoutMs: r?.config.timeoutMs, maxRetries: r?.maxRetries,
  });

  it('CONTROL: budget fields in the request BODY change nothing the runner receives or the ledger records (compared with a plain body)', async () => {
    const run = async (body: Record<string, unknown>, key: string) => {
      const store = durableStore();
      const p = provider();
      const response = await handleJuliusAskRoute({
        method: 'POST', authorization: 'Relay-Session paired-token', origin: undefined, rawBody: JSON.stringify(body),
        idempotencyKey: key, now: DAY0, operatorToken: OPERATOR,
      }, { ask: instance({ ledger: store, provider: p }), verifyNativeSession: () => ({ playerId: 'raiser' }) });
      const pre = rowOf(store, 'pre_call');
      return { status: response.status, sent: pick(p.requests[0]), ledger: [pre?.budgetBasis, pre?.maxOutputTokensSent, pre?.reasoningEffortChosen] };
    };
    const plain = await run({ question: 'short question' }, 'raise-key-0001');
    const raised = await run({
      question: 'short question', max_output_tokens: 100_000, maxOutputTokens: 100_000, reasoningEffort: 'high', reasoning: { effort: 'high' },
      budgetBasis: 'operator_override', maxRetries: 5, timeoutMs: 600_000, JULIUS_ASK_MAX_OUTPUT_TOKENS: '100000',
    }, 'raise-key-0002');
    expect(plain.status).toBe(200);
    expect(raised, 'a caller-supplied budget field changed the request or the ledger').toEqual(plain);
    expect(plain.sent).toMatchObject({ omit: true, effort: 'low', maxRetries: 0 });
  });

  it('CONTROL: extra fields on the controller input are ignored', async () => {
    const p = provider();
    const c = instance({ ledger: durableStore(), provider: p });
    await c.handleAsk({ question: 'short question', idempotencyKey: 'extra-key-0001', caller: 'player:p1' });
    await c.handleAsk({ question: 'short question', idempotencyKey: 'extra-key-0002', caller: 'player:p1', maxOutputTokens: 99_999, reasoningEffort: 'high', budget: { basis: 'operator_override' } } as never);
    expect(pick(p.requests[1])).toEqual(pick(p.requests[0]));
  });

  it('CONTROL: the one caller lever is the documented one, the TRIMMED length: padding whitespace cannot raise the effort', async () => {
    const p = provider();
    /* The operator allows players up to 'high' here; with the default (JULIUS_ASK_PLAYER_MAX_EFFORT unset = 'medium') the third
       question is capped to 'medium' (see julius-ask-store.test.ts). */
    const c = instance({ ledger: durableStore(), provider: p, env: env({ JULIUS_ASK_PLAYER_MAX_EFFORT: 'high' }) });
    await ask(c, { question: `  hi${' '.repeat(1500)}`, idempotencyKey: 'lever-key-0001' });
    await ask(c, { question: 'a'.repeat(201), idempotencyKey: 'lever-key-0002' });
    await ask(c, { question: 'a'.repeat(801), idempotencyKey: 'lever-key-0003' });
    /* The last two are the DOCUMENTED lever (effort by length), pinned so a change to it is visible; see the report's risk note. */
    expect(p.requests.map((r) => r.config.reasoningEffort)).toEqual(['low', 'medium', 'high']);
  });
});

describe('ANSWER DIGEST: the result row and the response tie the rendered text to one answer', () => {
  it('CONTROL: answerSha256 in the result row is the sha256 of the exact UTF-8 bytes of the returned answer, and the response carries it as answerDigest', async () => {
    const text = `caf${String.fromCodePoint(0xe9)} ${String.fromCodePoint(0x1f600)} and ${String.fromCodePoint(0x4e2d)} line`;
    const store = durableStore();
    const c = instance({ ledger: store, provider: provider([], () => answered(text)) });
    const response = await handleJuliusAskRoute({
      method: 'POST', authorization: `Bearer ${OPERATOR}`, origin: undefined, rawBody: JSON.stringify({ question: 'digest question' }),
      idempotencyKey: 'digest-key-0001', now: DAY0, operatorToken: OPERATOR,
    }, { ask: c, verifyNativeSession: () => null });
    expect(response.status).toBe(200);
    /* What a client sees: the body as bytes on the wire, decoded once. */
    const wire = Buffer.from(JSON.stringify(response.body), 'utf8');
    const data = (JSON.parse(wire.toString('utf8')) as { data: { answer: string; answerDigest: string; answerChars: number; askId: string } }).data;
    const expected = sha256Hex(Buffer.from(data.answer, 'utf8'));
    expect(data.answer).toBe(text);
    expect(data.answerDigest, 'the response must carry the sha256 of the answer it returns').toBe(expected);
    expect(data.answerChars).toBe(text.length);
    expect(rowOf(store, 'result', data.askId), 'the result row must carry the same digest').toMatchObject({ answerSha256: expected, answerChars: text.length });
    expect(JSON.stringify(store.held)).not.toContain('caf');
  });
});

describe('PROTECTIONS THAT STAY with no token ceiling', () => {
  it('CONTROL: one ask is exactly one billed request: maxRetries 0 on the SDK client and one SDK call, even when the provider fails', async () => {
    sdk.bodies.length = 0;
    sdk.constructed.length = 0;
    sdk.impl = async () => { throw Object.assign(new Error('upstream unavailable'), { status: 503, name: 'InternalServerError' }); };
    const store = durableStore();
    const result = await ask(instance({ ledger: store, provider: provider(), runArchitect: runGptArchitect }));
    expect(result).toEqual({ ok: false, code: 'julius_ask_provider_failed', httpStatus: 502 });
    expect(sdk.bodies).toHaveLength(1);
    expect(sdk.constructed.map((o) => o.maxRetries)).toEqual([0]);
    expect(rowOf(store, 'result')).toMatchObject({ attempts: 1, failureClass: 'provider_error' });
  });

  it('CONTROL: the daily call cap and the concurrency limit still refuse (429) without a provider call', async () => {
    const p = provider();
    const c = instance({ ledger: durableStore(), provider: p, env: env({ JULIUS_ASK_DAILY_CAP: '2' }) });
    await ask(c, { idempotencyKey: 'stay-cap-0001' });
    await ask(c, { idempotencyKey: 'stay-cap-0002' });
    expect(await ask(c, { idempotencyKey: 'stay-cap-0003' })).toEqual({ ok: false, code: 'julius_ask_cap_reached', httpStatus: 429 });
    expect(p.requests).toHaveLength(2);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const slow = provider([], async () => { await gate; return answered('slow'); });
    const busy = instance({ ledger: durableStore(), provider: slow });
    const first = ask(busy, { idempotencyKey: 'stay-busy-0001' });
    expect(await ask(busy, { idempotencyKey: 'stay-busy-0002' })).toEqual({ ok: false, code: 'julius_ask_busy', httpStatus: 429 });
    release();
    expect((await first).ok).toBe(true);
    expect(slow.requests).toHaveLength(1);
  });

  it('CONTROL: authentication: no credential, a wrong bearer, or a browser origin is refused 401 before the controller runs', async () => {
    const store = durableStore();
    const p = provider();
    const c = instance({ ledger: store, provider: p });
    const base = { method: 'POST', rawBody: JSON.stringify({ question: 'hello' }), idempotencyKey: 'auth-key-0001', now: DAY0, operatorToken: OPERATOR };
    const statuses = [
      await handleJuliusAskRoute({ ...base, authorization: undefined, origin: undefined }, { ask: c, verifyNativeSession: () => ({ playerId: 'x' }) }),
      await handleJuliusAskRoute({ ...base, authorization: 'Bearer wrong-operator-value', origin: undefined }, { ask: c, verifyNativeSession: () => null }),
      await handleJuliusAskRoute({ ...base, authorization: 'Relay-Session paired-token', origin: 'https://example.invalid' }, { ask: c, verifyNativeSession: () => ({ playerId: 'x' }) }),
    ].map((r) => r.status);
    expect(statuses).toEqual([401, 401, 401]);
    expect(p.requests).toHaveLength(0);
    expect(store.held).toHaveLength(0);
  });
});

/* ===================================================================================================================== */
/* ADDED by juju2 on 255e27bf (branch dev/ask-negative-controls-3): what slices 1-2 and the file store do NOT yet give.     */
/* Every test named "REQUIRED (slice 3) ..." is expected to FAIL at 255e27bf with a message that names the missing          */
/* behaviour, and to stay red until the Postgres slice 3 (or the store change it names) lands. Every "CONTROL (slice 3) ..." */
/* passes at 255e27bf and shows the red test next to it cannot be turned green by refusing everything.                      */
/* Production code is untouched; where a seam does not exist yet, the comment on the test names the seam it needs.          */

const secretFrom = (label: string): string => ['ask', 'operator', label, '0123456789abcdef'].join('-');
const gated = () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  return { gate, release: () => release() };
};

/**
 * SLICE 3 SEAM: a store FACTORY that gives two independent AskStore objects over ONE backing row set (two replicas, or two
 * processes, over one table). Today the only reservation building block is reserveOverDurableLedger, which createMemoryAskStore
 * and createFileAskStore both use; its lock is keyed by the store OBJECT, so two objects mean two locks. Each replica below is a
 * separate object with its own lock, exactly as two processes would be. The append takes 5 ms (a database round trip), so both
 * replicas read the rows before either insert lands.
 * SLICE 3 swaps THIS factory for two Postgres stores (two pools) over one throwaway database; only then can these tests go green.
 * A green produced by a module-level (process-wide) lock would NOT be a fix: real replicas are separate processes.
 */
function replicaOver(backing: AskLedgerLine[]): AskStore {
  const store: AskStore = {
    durable: true,
    async append(line) { await new Promise((resolve) => setTimeout(resolve, 5)); backing.push(line); },
    async rows() { return backing.slice(); },
    reserve: (input) => reserveOverDurableLedger(store, input),
  };
  return markAskStoreDurable(store);
}

describe('REPLICAS OVER ONE ROW SET (slice 3): the reserve is atomic across store instances, not only inside one object', () => {
  it('CONTROL (slice 3): two replicas over one row set, asked ONE AFTER THE OTHER, share a daily cap of 1', async () => {
    const backing: AskLedgerLine[] = [];
    const p = provider();
    const capped = env({ JULIUS_ASK_DAILY_CAP: '1' });
    const first = await ask(instance({ ledger: replicaOver(backing), provider: p, env: capped }), { caller: 'player:r1', idempotencyKey: 'replica-seq-0001' });
    const second = await ask(instance({ ledger: replicaOver(backing), provider: p, env: capped }), { caller: 'player:r2', idempotencyKey: 'replica-seq-0002' });
    expect(first.ok, `the first replica answers: ${describeResult(first)}`).toBe(true);
    expect(second).toMatchObject({ ok: false, code: 'julius_ask_cap_reached', httpStatus: 429 });
    expect(p.requests).toHaveLength(1);
  });

  it('REQUIRED (slice 3): two replicas over one row set, asked AT THE SAME TIME, buy exactly ONE call under a daily cap of 1', async () => {
    const backing: AskLedgerLine[] = [];
    const p = provider();
    const capped = env({ JULIUS_ASK_DAILY_CAP: '1' });
    const [a, b] = await Promise.all([
      ask(instance({ ledger: replicaOver(backing), provider: p, env: capped }), { caller: 'player:r1', idempotencyKey: 'replica-par-0001' }),
      ask(instance({ ledger: replicaOver(backing), provider: p, env: capped }), { caller: 'player:r2', idempotencyKey: 'replica-par-0002' }),
    ]);
    expect(p.requests.length, `MISSING: two replicas each passed the count before either insert landed and bought ${p.requests.length} calls past a cap of 1 (${describeResult(a)} / ${describeResult(b)})`).toBe(1);
    expect([a.ok, b.ok].filter((ok) => ok === true), 'exactly one of the two is answered (a store that refuses both is not a fix)').toHaveLength(1);
    expect([a, b].find((r) => !r.ok)).toMatchObject({ ok: false, code: 'julius_ask_cap_reached', httpStatus: 429 });
  });

  it('REQUIRED (slice 3): one (caller, key) sent to two replicas AT THE SAME TIME is ONE billed call', async () => {
    const backing: AskLedgerLine[] = [];
    const p = provider();
    const bound = env({ JULIUS_ASK_BINDING_SECRET: secretFrom('binding') });
    const [a, b] = await Promise.all([
      ask(instance({ ledger: replicaOver(backing), provider: p, env: bound }), { caller: 'player:same', idempotencyKey: 'replica-one-key-01' }),
      ask(instance({ ledger: replicaOver(backing), provider: p, env: bound }), { caller: 'player:same', idempotencyKey: 'replica-one-key-01' }),
    ]);
    expect(p.requests.length, `MISSING: one idempotency key bought ${p.requests.length} billed calls on two replicas (${describeResult(a)} / ${describeResult(b)})`).toBe(1);
    expect([a.ok, b.ok].filter((ok) => ok === true), 'exactly one of the two is answered').toHaveLength(1);
    const refused = [a, b].find((r) => !r.ok);
    expect(refused?.ok === false ? refused.httpStatus : 0, 'the other gets a named 409 for the key (attempt_unknown while the first is in flight)').toBe(409);
    expect(backing.filter((row) => row.phase === 'pre_call'), 'one (caller, key) pair has ONE pre-call row (the unique index)').toHaveLength(1);
  });
});

/* ===================================================================================================================== */
/**
 * A store that commits the pre-call row and THEN throws (a connection lost after COMMIT). It is branded because THIS factory
 * built it. The provider is never contacted in this case: the reserve threw before the route reached the runner.
 *
 * THE CAPABILITY SEAM (agreed by JUDEV for slice 3): the route writes a not_contacted result row ONLY for a store that declares
 * it takes one. Here that is the plain property `recordsNotContacted: true`. The production NAME and mechanism are the builder's
 * (it is to be BRANDED by the store factory, like durability via markAskStoreDurable); when it lands, this fake switches to it.
 */
type CommitThenThrowStore = AskStore & { readonly held: AskLedgerLine[]; readonly recordsNotContacted?: true };
function commitThenThrowStore(options: { readonly recordsNotContacted: boolean }): CommitThenThrowStore {
  const inner = createMemoryAskStore();
  let throwAfterNextCommit = true;
  const store: CommitThenThrowStore = {
    durable: true,
    ...(options.recordsNotContacted ? { recordsNotContacted: true as const } : {}),
    held: inner.held,
    append: (line) => inner.append(line),
    rows: () => inner.rows(),
    async reserve(input: AskReserveInput) {
      const outcome = await inner.reserve(input);
      if (throwAfterNextCommit && outcome.kind === 'reserved') { throwAfterNextCommit = false; throw new Error('connection reset after COMMIT'); }
      return outcome;
    },
  };
  return markAskStoreDurable(store);
}

describe('DURABLE-WRITE FAILURE (slice 3, reviewer ruling 4ce81b item 3): commit-then-throw on the player path, a crash mid-call, the demo file store', () => {
  it('CONTROL (ruling 3): the demo FILE store keeps the documented 409 attempt_unknown when an fsync fails, and the row keeps its slot after a restart', async () => {
    /* The ruling: "the demo FILE store keeps the documented attempt_unknown 409". The first version of this test (dfcf7109)
       REQUIRED a 503 and a rollback here; the ruling overrides that, so it is now a control of today's behaviour: writeDurably
       keeps a row whose bytes were written but whose fsync failed ("never under-counting a cap"), and the route answers
       attempt_unknown. Seam: createFileAskStore plus a failing fsync from the node:fs mock. */
    const dir = mkdtempSync(join(tmpdir(), 'julius-ask-exposure-fsync-'));
    const file = join(dir, 'ask-store.jsonl');
    let first: FileAskStore | null = null;
    let reopened: FileAskStore | null = null;
    try {
      first = createFileAskStore({ file });
      const p = provider();
      const capped = env({ JULIUS_ASK_DAILY_CAP: '1', JULIUS_ASK_BINDING_SECRET: secretFrom('binding') });
      fsFault.failNextFsyncs = 1;
      const fsyncsBefore = fsFault.fsyncCalls;
      const refused = await ask(instance({ ledger: first, provider: p, env: capped }), { idempotencyKey: 'fsync-fail-0001' });
      expect(fsFault.fsyncCalls, 'the injected fsync failure was reached').toBeGreaterThan(fsyncsBefore);
      expect(p.requests, 'no provider call after a failed durable write').toHaveLength(0);
      expect(refused).toMatchObject({ ok: false, code: 'julius_ask_attempt_unknown', httpStatus: 409 });
      first.close();
      first = null;
      reopened = createFileAskStore({ file });
      const restarted = instance({ ledger: reopened, provider: p, env: capped });
      expect(await ask(restarted, { idempotencyKey: 'fsync-fail-0001' }), 'the same key after a restart').toMatchObject({ ok: false, code: 'julius_ask_attempt_unknown', httpStatus: 409 });
      expect(await ask(restarted, { idempotencyKey: 'fsync-fail-0002' }), 'the row keeps the only slot under a cap of 1').toMatchObject({ ok: false, code: 'julius_ask_cap_reached', httpStatus: 429 });
      expect(p.requests).toHaveLength(0);
    } finally {
      fsFault.failNextFsyncs = 0;
      first?.close();
      reopened?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('REQUIRED (slice 3, ruling 3): PLAYER + a store that commits then throws BEFORE the provider call: 503, a not_contacted result row, and the SAME key retried is answered with exactly one call under cap 1', async () => {
    /* The ruling: on the PLAYER path, when the route KNOWS the provider was not contacted (the reserve threw before the call),
       it answers 503 julius_ask_ledger_unavailable and writes a result row marking the attempt not_contacted; the SAME key then
       retries and is answered, and the dead attempt spends no slot. Today the route reads its own row back and answers 409
       attempt_unknown ("a billed call may have happened"), which is false here, and the row keeps the only slot.
       Seam it needs: (i) the compensating result row (outcome not_contacted), and (ii) a reserve that neither counts a
       not_contacted attempt against the caps nor treats its key as used. The demo FILE store is carved out by the same ruling
       (control above), so the route needs to know which stores take the compensation: the CAPABILITY seam (recordsNotContacted,
       see commitThenThrowStore). THIS store declares it. */
    const store = commitThenThrowStore({ recordsNotContacted: true });
    const p = provider();
    const c = instance({ ledger: store, provider: p, env: env({ JULIUS_ASK_DAILY_CAP: '1', JULIUS_ASK_BINDING_SECRET: secretFrom('binding') }) });
    const first = await ask(c, { idempotencyKey: 'commit-throw-0001' });
    expect(p.requests, 'the provider was never contacted on the first attempt').toHaveLength(0);
    expect(first, `MISSING (ruling 3): a commit-then-throw that never reached the provider was answered ${describeResult(first)}; required 503 ledger_unavailable`).toEqual({ ok: false, code: 'julius_ask_ledger_unavailable', httpStatus: 503 });
    const pre = store.held.find((row) => row.phase === 'pre_call');
    const mark = store.held.find((row) => row.phase === 'result' && row.askId === pre?.askId);
    expect(String(mark?.outcome), 'MISSING (ruling 3): no result row marks the dead attempt not_contacted').toMatch(/not_contacted/);
    const retry = await ask(c, { idempotencyKey: 'commit-throw-0001' });
    expect(retry.ok, `MISSING (ruling 3): the same key could not be retried after a 503 that bought nothing (cap 1): ${describeResult(retry)}`).toBe(true);
    expect(p.requests, 'the retry is exactly one billed call').toHaveLength(1);
  });

  it('REQUIRED (slice 3, ruling 3): the not_contacted compensation follows the STORE CAPABILITY: a store WITHOUT it keeps 409 attempt_unknown and gets no not_contacted row; a store WITH it gets 503, a not_contacted row and an answered same-key retry', async () => {
    /* Both sides of the capability in one test, so a route that compensates for EVERY store (ignoring the capability, which would
       break the demo file store's documented 409) and a route that compensates for NONE (today) both fail. The WITHOUT side is
       today's behaviour and passes; the WITH side is red today because the route has no capability check and never writes a
       not_contacted row. The seam is the property recordsNotContacted on the fake; the production name is the builder's. */
    const run = async (recordsNotContacted: boolean, key: string) => {
      const store = commitThenThrowStore({ recordsNotContacted });
      const p = provider();
      const c = instance({ ledger: store, provider: p, env: env({ JULIUS_ASK_DAILY_CAP: '1', JULIUS_ASK_BINDING_SECRET: secretFrom('binding') }) });
      const first = await ask(c, { idempotencyKey: key });
      const callsAfterFirst = p.requests.length;
      const marks = store.held.filter((row) => row.phase === 'result' && /not_contacted/.test(String(row.outcome)));
      const retry = await ask(c, { idempotencyKey: key });
      return { first, callsAfterFirst, marks: marks.length, retry, calls: p.requests.length };
    };
    const without = await run(false, 'capability-off-01');
    expect(without.callsAfterFirst, 'WITHOUT the capability: the provider was not contacted').toBe(0);
    expect(without.first, 'WITHOUT the capability: the documented 409 attempt_unknown stays').toMatchObject({ ok: false, code: 'julius_ask_attempt_unknown', httpStatus: 409 });
    expect(without.marks, 'WITHOUT the capability: no not_contacted row is written').toBe(0);
    expect(without.retry, 'WITHOUT the capability: the same key stays attempt_unknown').toMatchObject({ ok: false, code: 'julius_ask_attempt_unknown', httpStatus: 409 });
    expect(without.calls, 'WITHOUT the capability: nothing was bought').toBe(0);
    const withIt = await run(true, 'capability-on-001');
    expect(withIt.callsAfterFirst, 'WITH the capability: the provider was not contacted on the first attempt').toBe(0);
    expect(withIt.first, `MISSING (capability): a store that records not_contacted got ${describeResult(withIt.first)}, the same as a store without it; required 503 ledger_unavailable`).toEqual({ ok: false, code: 'julius_ask_ledger_unavailable', httpStatus: 503 });
    expect(withIt.marks, 'MISSING (capability): no not_contacted row for a store that takes one').toBe(1);
    expect(withIt.retry.ok, `MISSING (capability): the same key retried was not answered: ${describeResult(withIt.retry)}`).toBe(true);
    expect(withIt.calls, 'WITH the capability: the retry is exactly one billed call').toBe(1);
  });

  it('CONTROL (ruling 3): a pre-call row with NO result row (a crash mid-call, the provider possibly contacted) still answers the same key 409 attempt_unknown after a restart', async () => {
    /* The provider IS contacted here; the result row is lost because the store goes down during the call (the route swallows a
       lost result row so a paid answer is not discarded). A restart then sees a pre-call row with no outcome. */
    const store = durableStore();
    const p = provider([], () => { store.broken = true; return answered('paid, then the store went down'); });
    const bound = env({ JULIUS_ASK_BINDING_SECRET: secretFrom('binding') });
    const first = await ask(instance({ ledger: store, provider: p, env: bound }), { idempotencyKey: 'crash-mid-0001' });
    expect(first.ok, `the paid answer is still returned: ${describeResult(first)}`).toBe(true);
    store.broken = false;
    expect(store.held.filter((row) => row.phase === 'result'), 'the result row was lost').toHaveLength(0);
    const afterRestart = await ask(instance({ ledger: store, provider: p, env: bound }), { idempotencyKey: 'crash-mid-0001' });
    expect(afterRestart).toMatchObject({ ok: false, code: 'julius_ask_attempt_unknown', httpStatus: 409 });
    expect(p.requests).toHaveLength(1);
  });
});

/* ===================================================================================================================== */
describe('SAFETY SECRET FOR PLAYERS (slice 3, reviewer ruling 4ce81b item 1)', () => {
  it('REQUIRED (slice 3, ruling 1): a PLAYER ask with NO safety secret is refused 503 not-configured, with no provider call and no cap slot held', async () => {
    /* The ruling: a player ask with no safety secret = 503 not-configured, no provider contact, no slot held. Today the route
       sends no safety_identifier (safetyBasis none) and answers. BOTH operator secrets are removed here, because the route falls
       back to JULIUS_ASK_BINDING_SECRET for the safety identifier (julius-ask.ts:576); whether that fallback counts as "a safety
       secret" under the ruling is for the reviewer to say, and this test holds under either reading. */
    const store = durableStore();
    const p = provider();
    const noSecret = env({ JULIUS_ASK_SAFETY_SECRET: undefined, JULIUS_ASK_BINDING_SECRET: undefined, JULIUS_ASK_DAILY_CAP: '1' });
    const refused = await ask(instance({ ledger: store, provider: p, env: noSecret }), { idempotencyKey: 'no-safety-0001' });
    expect(p.requests.length, `MISSING (ruling 1): a player ask with no safety secret reached the provider (${describeResult(refused)})`).toBe(0);
    expect(refused.ok === false && refused.httpStatus === 503 && /not_configured/.test(refused.code), `MISSING (ruling 1): required 503 with a not-configured code, got ${describeResult(refused)}`).toBe(true);
    expect(store.held, 'the refusal wrote no row, so it holds no cap slot').toHaveLength(0);
    const configured = await ask(instance({ ledger: store, provider: p, env: env({ JULIUS_ASK_DAILY_CAP: '1' }) }), { idempotencyKey: 'no-safety-0002' });
    expect(configured.ok, `with the secret set, the only slot under a cap of 1 is still free: ${describeResult(configured)}`).toBe(true);
  });

  it('CONTROL (ruling 1): an OPERATOR ask with no safety secret still works; no safety_identifier is sent and the pre-call row says safetyBasis none', async () => {
    const store = durableStore();
    const p = provider();
    const noSecret = env({ JULIUS_ASK_SAFETY_SECRET: undefined, JULIUS_ASK_BINDING_SECRET: undefined });
    const result = await ask(instance({ ledger: store, provider: p, env: noSecret }), { caller: 'operator', idempotencyKey: 'op-no-safety-01' });
    expect(result.ok, `the operator works without a safety secret: ${describeResult(result)}`).toBe(true);
    expect(p.requests).toHaveLength(1);
    expect(Object.prototype.hasOwnProperty.call(p.requests[0] ?? {}, 'safetyIdentifier')).toBe(false);
    expect(rowOf(store, 'pre_call')).toMatchObject({ safetyBasis: 'none' });
  });
});

/* ===================================================================================================================== */
describe('PLAYER DEFAULT EFFORT CAP (reviewer ruling 4ce81b item 2)', () => {
  it('CONTROL (ruling 2): with JULIUS_ASK_PLAYER_MAX_EFFORT unset a player\'s long question is capped to medium and ledgered policy_capped; the operator is not capped', async () => {
    const long = 'a'.repeat(801);
    const playerStore = durableStore();
    const pp = provider();
    expect((await ask(instance({ ledger: playerStore, provider: pp }), { question: long, idempotencyKey: 'effort-cap-0001' })).ok).toBe(true);
    expect(pp.requests[0]?.config.reasoningEffort).toBe('medium');
    expect(rowOf(playerStore, 'pre_call')).toMatchObject({ reasoningEffortChosen: 'medium', effortBasis: 'policy_capped' });
    const operatorStore = durableStore();
    const op = provider();
    expect((await ask(instance({ ledger: operatorStore, provider: op }), { question: long, caller: 'operator', idempotencyKey: 'effort-cap-0002' })).ok).toBe(true);
    expect(op.requests[0]?.config.reasoningEffort).toBe('high');
    expect(rowOf(operatorStore, 'pre_call')).toMatchObject({ reasoningEffortChosen: 'high', effortBasis: 'dynamic' });
  });
});

/* ===================================================================================================================== */
describe('SECOND PROCESS ON ONE STORE FILE (slice 3): a second store over the same file is refused or serialised', () => {
  it('CONTROL (slice 3): a RESTART (the first store closed, the file reopened) keeps the daily cap of 1 and the key', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'julius-ask-exposure-restart-'));
    const file = join(dir, 'ask-store.jsonl');
    let a: FileAskStore | null = null;
    let b: FileAskStore | null = null;
    try {
      const p = provider();
      const capped = env({ JULIUS_ASK_DAILY_CAP: '1' });
      a = createFileAskStore({ file });
      expect((await ask(instance({ ledger: a, provider: p, env: capped }), { idempotencyKey: 'file-restart-0001' })).ok).toBe(true);
      a.close();
      a = null;
      b = createFileAskStore({ file });
      expect(await ask(instance({ ledger: b, provider: p, env: capped }), { idempotencyKey: 'file-restart-0002' })).toMatchObject({ ok: false, code: 'julius_ask_cap_reached' });
      expect(p.requests).toHaveLength(1);
    } finally {
      a?.close();
      b?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('REQUIRED (slice 3): while one store holds the file, a SECOND store over the same path is refused at open, or sees the first one\'s rows (cap 1 = 1 call, one key = 1 call)', async () => {
    /* What is asserted, and why: two bridge processes started with the same JULIUS_ASK_STORE_FILE each load the rows ONCE at start
       and lock only inside themselves, so the second never sees the first's inserts (the file store's own header says it is not
       safe for two processes). Either of two fixes satisfies this test: (1) the second open FAILS (an exclusive lock on the file,
       so selectAskLedger falls back and players get 503), or (2) every reserve re-reads and locks the FILE, so the two serialise
       and the cap and the key hold. Two stores in one test process stand in for two processes (separate objects, separate
       snapshots, separate locks). What is never acceptable is the outcome today: both open, both reserve, two calls. */
    const dir = mkdtempSync(join(tmpdir(), 'julius-ask-exposure-second-'));
    const file = join(dir, 'ask-store.jsonl');
    let a: FileAskStore | null = null;
    let b: FileAskStore | null = null;
    try {
      const p = provider();
      const capped = env({ JULIUS_ASK_DAILY_CAP: '1', JULIUS_ASK_CALLER_DAILY_CAP: '1', JULIUS_ASK_BINDING_SECRET: secretFrom('binding') });
      a = createFileAskStore({ file });
      let secondOpenError: unknown = null;
      try { b = createFileAskStore({ file }); } catch (error) { secondOpenError = error; }
      if (b === null) {
        /* Fix (1): the second open is refused. The first store must still serve, so a store that refuses everything does not pass. */
        expect(secondOpenError, 'the second open was refused with an error').toBeInstanceOf(Error);
        const served = await ask(instance({ ledger: a, provider: p, env: capped }), { caller: 'player:one', idempotencyKey: 'second-proc-0001' });
        expect(served.ok, `the first process keeps serving after refusing the second: ${describeResult(served)}`).toBe(true);
        expect(p.requests).toHaveLength(1);
      } else {
        /* Fix (2), or today: both opened, so the two must serialise over the file. */
        const viaA = instance({ ledger: a, provider: p, env: capped });
        const viaB = instance({ ledger: b, provider: p, env: capped });
        const first = await ask(viaA, { caller: 'player:one', idempotencyKey: 'second-proc-0001' });
        const sameKey = await ask(viaB, { caller: 'player:one', idempotencyKey: 'second-proc-0001' });
        const otherKey = await ask(viaB, { caller: 'player:two', idempotencyKey: 'second-proc-0002' });
        expect(first.ok, `the first process answers: ${describeResult(first)}`).toBe(true);
        expect(p.requests.length, `MISSING: a second store opened the same file with a stale snapshot and bought ${p.requests.length} calls (same key: ${describeResult(sameKey)}; cap 1: ${describeResult(otherKey)})`).toBe(1);
        expect(sameKey).toMatchObject({ ok: false, httpStatus: 409 });
        expect(otherKey).toMatchObject({ ok: false, code: 'julius_ask_cap_reached', httpStatus: 429 });
      }
    } finally {
      a?.close();
      b?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/* ===================================================================================================================== */
describe('FAIRNESS UNDER A SMALL CONCURRENCY POOL (slice 3): one player cannot hold every slot', () => {
  it('CONTROL (slice 3): with 2 slots, two DIFFERENT players asking at once are both admitted and answered', async () => {
    const { gate, release } = gated();
    const p = provider([], async () => { await gate; return answered('fair'); });
    const c = instance({ ledger: durableStore(), provider: p, env: env({ JULIUS_ASK_MAX_CONCURRENT: '2' }) });
    const hog = ask(c, { caller: 'player:hog', idempotencyKey: 'fair-ctl-0001' });
    const other = ask(c, { caller: 'player:fair', idempotencyKey: 'fair-ctl-0002' });
    release();
    const results = await Promise.all([hog, other]);
    expect(results.map((r) => r.ok)).toEqual([true, true]);
    expect(p.requests).toHaveLength(2);
  });

  it('REQUIRED (slice 3): a per-caller concurrency limit of 1: while a player has one ask in flight, its second is refused 429 and another player gets the free slot', async () => {
    /* The property: no single caller may hold more than ONE in-flight ask, so with a pool of N >= 2 slots one player can never
       starve every other caller. Today the pool is global only: the hog's two fresh keys take both slots and the next player gets
       429 busy. (With the DEFAULT pool of 1 any one in-flight ask blocks every caller for up to ASK_MAX_TIMEOUT_MS; the default
       pool size for player mode is a separate design decision, see F4_F8_SLICE3_DESIGN_DELTA.md.) Seam: none new; the in-flight
       count per callerHash sits next to `inFlight` (and, across replicas, in the store). */
    const { gate, release } = gated();
    const p = provider([], async () => { await gate; return answered('fair'); });
    const c = instance({ ledger: durableStore(), provider: p, env: env({ JULIUS_ASK_MAX_CONCURRENT: '2' }) });
    const hog1 = ask(c, { caller: 'player:hog', idempotencyKey: 'fair-hog-0001' });
    const hog2 = ask(c, { caller: 'player:hog', idempotencyKey: 'fair-hog-0002' });
    const other = ask(c, { caller: 'player:fair', idempotencyKey: 'fair-oth-0001' });
    release();
    const [h1, h2, o] = await Promise.all([hog1, hog2, other]);
    expect(o.ok, `MISSING: one player held every concurrency slot and the other player was refused: ${describeResult(o)} (hog's second ask: ${describeResult(h2)})`).toBe(true);
    expect(h1.ok, 'the hog\'s first ask is answered').toBe(true);
    expect(h2.ok === false && h2.httpStatus === 429 && /busy/.test(h2.code), `the hog's second concurrent ask is refused 429 (a per-caller busy code), got ${describeResult(h2)}`).toBe(true);
    expect(p.requests).toHaveLength(2);
  });
});

/* ===================================================================================================================== */
describe('HASHES A DICTIONARY CANNOT INVERT (slice 3): operator secrets are in every caller-derived value', () => {
  const firstPreCall = async (secrets: { safety: string; binding: string }, caller = 'player:12345', key = 'hash-key-000001') => {
    const store = durableStore();
    const p = provider();
    await ask(instance({ ledger: store, provider: p, env: env({ JULIUS_ASK_SAFETY_SECRET: secrets.safety, JULIUS_ASK_BINDING_SECRET: secrets.binding }) }), { caller, idempotencyKey: key });
    return { row: rowOf(store, 'pre_call'), safetyIdentifier: (p.requests[0] as unknown as { safetyIdentifier?: unknown } | undefined)?.safetyIdentifier };
  };
  const ONE = { safety: secretFrom('safety-one'), binding: secretFrom('binding-one') };
  const TWO = { safety: secretFrom('safety-two'), binding: secretFrom('binding-two') };

  it('CONTROL (slice 3): two operator secrets give two different safetyIdentifiers for the same caller (an HMAC, not a bare hash of the id)', async () => {
    const one = await firstPreCall(ONE);
    const two = await firstPreCall(TWO);
    expect(typeof one.safetyIdentifier).toBe('string');
    expect(two.safetyIdentifier, 'the safety identifier does not depend on the operator secret').not.toBe(one.safetyIdentifier);
    expect(String(one.safetyIdentifier)).not.toContain('12345');
  });

  it('CONTROL (slice 3): with the SAME secrets the ledgered callerHash and keyHash are stable across a restart (the caps depend on it)', async () => {
    const one = await firstPreCall(ONE);
    const again = await firstPreCall(ONE);
    expect(typeof one.row?.callerHash).toBe('string');
    expect(again.row?.callerHash).toBe(one.row?.callerHash);
    expect(again.row?.keyHash).toBe(one.row?.keyHash);
  });

  it('REQUIRED (slice 3): the ledgered callerHash and keyHash are KEYED by an operator secret, so a small player id cannot be recovered by enumeration', async () => {
    /* ONE precise assertion, chosen over "wider than 16 hex": the stored hashes must CHANGE when the operator secret changes. A
       wider unsalted sha256 is still reversible by enumerating small ids (the reviewer recovered player:12345 from ids 0..99999),
       so width alone does not protect anything; a key does. Today sha() is sha256(value).slice(0, 16), the same for every server.
       Seam: the route reads no ledger-hash secret today; this test sets the two operator secrets it does read. If slice 3 adds a
       dedicated one (e.g. a ledger-hash secret), set it here as well, differently in ONE and TWO. Width stays 16 to 64 hex. */
    const one = await firstPreCall(ONE);
    const two = await firstPreCall(TWO);
    const unsalted = sha256Hex('player:12345');
    expect(two.row?.callerHash, `MISSING: the ledgered callerHash is ${String(one.row?.callerHash)} under both secrets; it is the first 16 hex of sha256("player:12345") (${unsalted.slice(0, 16)}), recoverable by enumerating ids`).not.toBe(one.row?.callerHash);
    expect(two.row?.keyHash, 'MISSING: the ledgered keyHash does not depend on an operator secret').not.toBe(one.row?.keyHash);
    expect(unsalted.startsWith(String(one.row?.callerHash)), 'the stored callerHash must not be a prefix of the unsalted sha256 of the caller').toBe(false);
  });
});
