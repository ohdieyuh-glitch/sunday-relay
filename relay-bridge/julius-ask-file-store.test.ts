import { afterEach, describe, expect, it, vi } from 'vitest';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJuliusAsk, type AskLedger, type AskLedgerLine, type AskReserveInput, type JuliusAskResult } from './julius-ask';
import { createFileAskStore, selectAskLedger, type FileAskStore } from './julius-ask-file-store';
import { readGptArchitectConfig } from '../src/relay/connectors/gpt-architect/config';
import type { GptRunOutcome, GptRunRequest } from '../src/relay/connectors/gpt-architect/gpt-runner';

/* The single-instance FILE store for the founder-only demo: real files in a temp directory, a real restart (a NEW store object and a
   NEW controller on the same file), the in-process lock under parallel asks, a torn tail, garbage, and the operator wiring.
   No network, no provider, no Postgres. */
const DAY0 = Date.UTC(2026, 9, 19, 12, 0, 0);
const SECRET = ['binding', 'secret', 'for', 'file', 'tests', '0123456789'].join('-');
// Built at run time so no key-shaped literal exists in the source (the repository boundary scan refuses one).
const PROVIDER_KEY = ['canary', 'file', 'store', 'key', '0011223344'].join('_');
const QUESTION = 'What does the architect do all day?';
const ANSWER = 'It reviews plans and writes them down.';
const env = (extra: Record<string, string | undefined> = {}): Record<string, string | undefined> => ({
  JULIUS_ASK_ENABLED: '1', OPENAI_API_KEY: PROVIDER_KEY, OPENAI_PROMPT_ARCHITECT_MODEL: 'model-configured',
  RELAY_PROMPT_ARCHITECT_MODE: 'live', JULIUS_ASK_BINDING_SECRET: SECRET, ...extra,
});
const answered = (): GptRunOutcome => ({
  ok: true, actualModel: 'm', responseId: 'resp_file_000111', status: 'completed', outputText: JSON.stringify({ answer: ANSWER }),
  usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, reasoningTokens: 0, totalTokens: 2 },
});

const dirs: string[] = [];
const stores: FileAskStore[] = [];
const tempFile = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'julius-ask-file-'));
  dirs.push(dir);
  return join(dir, 'nested', 'ask-store.jsonl');
};
const open = (file: string): FileAskStore => {
  const store = createFileAskStore({ file });
  stores.push(store);
  return store;
};
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const requests: GptRunRequest[] = [];
const controllerOn = (ledger: AskLedger, e: Record<string, string | undefined> = env()) => createJuliusAsk({
  env: e, readConfig: readGptArchitectConfig, now: () => DAY0, ledger,
  runArchitect: async (request) => { requests.push(request); return answered(); },
});
type Controller = ReturnType<typeof controllerOn>;
const ask = (c: Controller, over: Partial<{ question: unknown; idempotencyKey: unknown; caller: unknown }> = {}): Promise<JuliusAskResult> =>
  c.handleAsk({ question: QUESTION, idempotencyKey: 'file-key-0001', caller: 'player:p1', ...over });
const refusal = (r: JuliusAskResult) => (r.ok ? { code: 'ANSWERED', httpStatus: 200 } : { code: r.code, httpStatus: r.httpStatus });
const fileLines = (file: string): string[] => readFileSync(file, 'utf8').split('\n').filter((l) => l !== '');
const preCall = (n: number, extra: Record<string, unknown> = {}): AskLedgerLine => ({
  phase: 'pre_call', askId: `ask_seed_${n}`, at: new Date(DAY0).toISOString(), callerHash: `c${n}`, keyHash: `k${n}`, ...extra,
} as AskLedgerLine);
const reserveInput = (n: number, over: Partial<AskReserveInput> = {}): AskReserveInput => ({
  line: preCall(n), callerHash: `c${n}`, keyHash: `k${n}`, questionBinding: null, utcDay: '2026-10-19', globalCap: 100, callerCap: 100, ...over,
});

describe('a REAL restart: a new store and a new controller on the same file keep the caps and the idempotency', () => {
  it('serves a player through the file store, then after a restart the same key is already_answered with the same digest and the cap holds', async () => {
    requests.length = 0;
    const file = tempFile();
    const capped = env({ JULIUS_ASK_DAILY_CAP: '2', JULIUS_ASK_CALLER_DAILY_CAP: '2' });
    const before = open(file);
    const c1 = controllerOn(before, capped);
    const a = await ask(c1, { idempotencyKey: 'restart-key-0001' });
    const b = await ask(c1, { idempotencyKey: 'restart-key-0002' });
    expect(a.ok && b.ok).toBe(true);
    expect(requests).toHaveLength(2);
    before.close();

    const after = open(file);
    const c2 = controllerOn(after, capped);
    const again = await ask(c2, { idempotencyKey: 'restart-key-0001' });
    expect(again).toMatchObject({ ok: false, code: 'julius_ask_already_answered', httpStatus: 409 });
    expect(again.ok ? '' : again.detail?.answerDigest).toBe(a.ok ? a.answerDigest : 'missing');
    expect(refusal(await ask(c2, { idempotencyKey: 'restart-key-0001', question: 'a different question' }))).toEqual({ code: 'julius_ask_idempotency_key_reused', httpStatus: 409 });
    expect(refusal(await ask(c2, { idempotencyKey: 'restart-key-0003' }))).toEqual({ code: 'julius_ask_cap_reached', httpStatus: 429 });
    expect(requests, 'no second billed call after the restart').toHaveLength(2);
  });

  it('the per-caller cap survives a restart while another caller is still served', async () => {
    requests.length = 0;
    const file = tempFile();
    const e = env({ JULIUS_ASK_DAILY_CAP: '10', JULIUS_ASK_CALLER_DAILY_CAP: '2' });
    const before = open(file);
    const c1 = controllerOn(before, e);
    await ask(c1, { idempotencyKey: 'caller-key-0001' });
    await ask(c1, { idempotencyKey: 'caller-key-0002' });
    before.close();
    const c2 = controllerOn(open(file), e);
    expect(refusal(await ask(c2, { idempotencyKey: 'caller-key-0003' }))).toEqual({ code: 'julius_ask_caller_cap_reached', httpStatus: 429 });
    expect((await ask(c2, { idempotencyKey: 'caller-key-0004', caller: 'player:p2' })).ok).toBe(true);
  });

  it('without a binding secret a repeated key after a restart is key_not_bound, never the old digest', async () => {
    requests.length = 0;
    const file = tempFile();
    const noSecret = env({ JULIUS_ASK_BINDING_SECRET: undefined });
    const before = open(file);
    expect((await ask(controllerOn(before, noSecret))).ok).toBe(true);
    before.close();
    const again = await ask(controllerOn(open(file), noSecret), { question: 'a different question' });
    expect(refusal(again)).toEqual({ code: 'julius_ask_key_not_bound', httpStatus: 409 });
    expect(requests).toHaveLength(1);
  });

  it('a crash between the pre-call row and the result row reads back as attempt_unknown after a restart', async () => {
    const file = tempFile();
    const first = open(file);
    const e = env();
    await ask(controllerOn(first, e));
    first.close();
    const kept = fileLines(file).filter((l) => (JSON.parse(l) as { phase: string }).phase === 'pre_call');
    writeFileSync(file, `${kept.join('\n')}\n`);
    requests.length = 0;
    const result = await ask(controllerOn(open(file), e));
    expect(result).toMatchObject({ ok: false, code: 'julius_ask_attempt_unknown', httpStatus: 409 });
    expect(requests).toHaveLength(0);
  });
});

describe('what the file holds', () => {
  it('is one JSON line per row, synced, with ids and digests only: no question, no answer, no key, no provider key', async () => {
    const file = tempFile();
    const store = open(file);
    expect((await ask(controllerOn(store))).ok).toBe(true);
    const text = readFileSync(file, 'utf8');
    expect(text.endsWith('\n')).toBe(true);
    const rows = fileLines(file).map((l) => JSON.parse(l) as { phase: string; questionBinding?: { v: number; mac: string } });
    expect(rows.map((r) => r.phase)).toEqual(['pre_call', 'result']);
    expect(rows[0]?.questionBinding).toEqual({ v: 1, mac: expect.stringMatching(/^[0-9a-f]{64}$/) });
    for (const forbidden of [QUESTION, ANSWER, 'file-key-0001', 'player:p1', PROVIDER_KEY, SECRET]) expect(text).not.toContain(forbidden);
  });

  it('creates the missing parent directory and reports its own path', () => {
    const file = tempFile();
    expect(existsSync(file)).toBe(false);
    const store = open(file);
    expect(existsSync(file)).toBe(true);
    expect(store.file).toBe(file);
  });
});

describe('the in-process lock', () => {
  it('eight parallel asks from eight players under a global cap of 3 buy exactly 3 calls and write exactly 3 pre-call rows', async () => {
    requests.length = 0;
    const file = tempFile();
    const store = open(file);
    const c = controllerOn(store, env({ JULIUS_ASK_DAILY_CAP: '3', JULIUS_ASK_MAX_CONCURRENT: '8' }));
    const results = await Promise.all([1, 2, 3, 4, 5, 6, 7, 8].map((n) => ask(c, { caller: `player:par${n}`, idempotencyKey: `parallel-key-000${n}` })));
    expect(results.filter((r) => r.ok)).toHaveLength(3);
    expect(results.filter((r) => !r.ok).every((r) => !r.ok && r.code === 'julius_ask_cap_reached')).toBe(true);
    expect(requests).toHaveLength(3);
    const rows = fileLines(file).map((l) => JSON.parse(l) as { phase: string });
    expect(rows.filter((r) => r.phase === 'pre_call')).toHaveLength(3);
    expect(rows.filter((r) => r.phase === 'result')).toHaveLength(3);
  });

  it('parallel reservations for ONE key insert once and the rest are duplicates, with one row in the file', async () => {
    const file = tempFile();
    const store = open(file);
    const outcomes = await Promise.all([1, 2, 3, 4, 5].map((n) => store.reserve(reserveInput(1, { line: preCall(1, { askId: `ask_same_${n}` }) }))));
    expect(outcomes.filter((o) => o.kind === 'reserved')).toHaveLength(1);
    expect(outcomes.filter((o) => o.kind === 'duplicate')).toHaveLength(4);
    expect(fileLines(file)).toHaveLength(1);
  });

  it('parallel appends never interleave: every line is whole and in order', async () => {
    const file = tempFile();
    const store = open(file);
    await Promise.all(Array.from({ length: 40 }, (_unused, n) => store.append({ phase: 'result', askId: `ask_${n}`, pad: 'x'.repeat(300) })));
    const ids = fileLines(file).map((l) => (JSON.parse(l) as { askId: string }).askId);
    expect(ids).toEqual(Array.from({ length: 40 }, (_unused, n) => `ask_${n}`));
  });
});

describe('fail closed: when the row cannot be written, nothing is bought', () => {
  it('refuses 503 with no provider call when the store cannot append, and keeps nothing in memory', async () => {
    requests.length = 0;
    const file = tempFile();
    const store = open(file);
    store.close();
    expect(refusal(await ask(controllerOn(store)))).toEqual({ code: 'julius_ask_ledger_unavailable', httpStatus: 503 });
    expect(requests).toHaveLength(0);
    expect(await store.rows()).toHaveLength(0);
  });
});

describe('a torn or garbage file', () => {
  it('TOLERATES a torn final line: it is moved to <file>.torn, cut from the file, and the next append starts a clean line', async () => {
    const file = tempFile();
    const first = open(file);
    await first.append(preCall(1));
    first.close();
    appendFileSync(file, '{"phase":"pre_call","askId":"ask_to');
    const reopened = open(file);
    expect(await reopened.rows()).toHaveLength(1);
    expect(readFileSync(`${file}.torn`, 'utf8')).toBe('{"phase":"pre_call","askId":"ask_to\n');
    expect(readFileSync(file, 'utf8').endsWith('}\n')).toBe(true);
    await reopened.append(preCall(2));
    reopened.close();
    const third = open(file);
    expect((await third.rows()).map((r) => r.askId)).toEqual(['ask_seed_1', 'ask_seed_2']);
  });

  it('keeps a complete final row whose newline was lost, and terminates it', async () => {
    const file = tempFile();
    const first = open(file);
    first.close();
    writeFileSync(file, JSON.stringify(preCall(1)));
    const reopened = open(file);
    expect(await reopened.rows()).toHaveLength(1);
    await reopened.append(preCall(2));
    reopened.close();
    expect((await open(file).rows()).map((r) => r.askId)).toEqual(['ask_seed_1', 'ask_seed_2']);
  });

  it('REFUSES to open a file with garbage in the middle, or a complete line that is not a valid row (the lost row could be a cap or a key)', () => {
    const file = tempFile();
    open(file).close();
    const good = JSON.stringify(preCall(1));
    for (const bad of ['not json at all', '[1,2,3]', '{"phase":"other"}', '{"phase":"pre_call","askId":"a"}', '']) {
      writeFileSync(file, `${good}\n${bad}\n${good}\n`);
      expect(() => createFileAskStore({ file }), bad === '' ? 'empty line' : bad).toThrow(/line 2/);
    }
  });
});

describe('the operator wiring (JULIUS_ASK_STORE_FILE)', () => {
  const fallback = (): AskLedger => ({ kind: 'file', append: async () => undefined });

  it('absent or empty keeps the fallback: the players are still refused 503 and the operator is served', async () => {
    requests.length = 0;
    for (const e of [{}, { JULIUS_ASK_STORE_FILE: '' }, { JULIUS_ASK_STORE_FILE: '   ' }]) {
      const fb = fallback();
      const ledger = selectAskLedger(e, fb);
      expect(ledger).toBe(fb);
      const c = controllerOn(ledger);
      expect(refusal(await ask(c))).toEqual({ code: 'julius_ask_durable_ledger_required', httpStatus: 503 });
      expect((await ask(c, { caller: 'operator' })).ok).toBe(true);
    }
  });

  it('set to a path it opens the file store, which is the only way a player ask is served', async () => {
    const file = tempFile();
    const ledger = selectAskLedger({ JULIUS_ASK_STORE_FILE: file }, fallback());
    stores.push(ledger as FileAskStore);
    expect(ledger).not.toBeUndefined();
    expect((await ask(controllerOn(ledger))).ok).toBe(true);
    expect(fileLines(file)).toHaveLength(2);
  });

  it('an unopenable file keeps the fallback (players 503), says so on stderr, and never prints a row', () => {
    const file = tempFile();
    open(file).close();
    writeFileSync(file, 'garbage-row-content-0001\n');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fb = fallback();
    expect(selectAskLedger({ JULIUS_ASK_STORE_FILE: file }, fb)).toBe(fb);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0]?.[0])).not.toContain('garbage-row-content-0001');
  });
});
