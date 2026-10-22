import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { KeyStore } from './julius-key-store';

import {
  verifyRunOrdering,
  J1_RESTART_LIMITS, createFileDispatchLedger, createJuliusDispatch, createMemoryDispatchLedger, createUncomposedJuliusDispatch,
  frozenMissionProblems, handleJuliusDispatchRoute, isJuliusDispatchRoute, isLoopbackPeer,
  type DispatchLedger, type DispatchProviders, type DispatchRow, type FrozenMission, type JuliusDispatchController,
  type JuliusDispatchRouteRequest, type RoleCallInput, type RoleCallOutput, type RoleProvider,
} from './julius-dispatch';

/* Provider key canaries are built at run time (a literal assignment trips the repository's boundary scan) and have no key-like prefix. */
const canary = (name: string): string => ['canary', name, 'ZZ9', 'x7Q2m4k8w1'].join('_');
const KEYS = { OPENAI_API_KEY: canary('openai'), ANTHROPIC_API_KEY: canary('anthropic'), XAI_API_KEY: canary('xai') };
const sha = (v: string): string => createHash('sha256').update(v, 'utf8').digest('hex');

const FROZEN: FrozenMission = {
  missionId: 'mission-j1-frozen', contractSha256: sha('contract'), checkerSha256: sha('checker'),
  missionAuthor: 'author-a', checkerAuthor: 'author-b', seededDefect: false, preregId: 'prereg-1',
};
const FOUNDER = 'player-founder';
const PROJECT = 'proj-1';
const RUN = 'run:abc123';
/** The UI-action time the game client reports: before the test clock's first tick (2026-10-22T12:00:01Z). */
const UI_UTC = '2026-10-22T11:59:30.000Z';

interface Harness {
  readonly env: Record<string, string | undefined>;
  readonly calls: RoleCallInput[];
  readonly logs: string[];
  readonly ledger: DispatchLedger & { readonly held?: DispatchRow[] };
  readonly controller: JuliusDispatchController;
  readonly providers: DispatchProviders;
}

/** Every echoed model string the pre-existing fake behaviours use; the Part A tests below replace this per provider. */
const FAKE_ECHOES: readonly string[] = ['m', 'g', 'echo-m', 'grok-served', 'xai-model', 'openai-model', 'anthropic-model', 'gpt-fake', 'claude-fake', 'grok-fake'];
type Behaviour = (input: RoleCallInput) => Promise<RoleCallOutput> | RoleCallOutput;
const FAKE_MODEL = { architect: 'gpt-fake', coder: 'claude-fake', reviewer: 'grok-fake' } as const;
function fakeProvider(role: 'architect' | 'coder' | 'reviewer', providerId: string, keyEnv: string | null, calls: RoleCallInput[], behave?: Behaviour): RoleProvider {
  return {
    providerId, keyEnv, model: FAKE_MODEL[role], fake: true, servedModelAllow: FAKE_ECHOES,
    async call(input) {
      calls.push(input);
      if (behave !== undefined) return behave(input);
      const base = { ok: true, responseId: `resp_${role}_00112233445566`, model: `${providerId}-model`, usage: { input: 10, output: 20, total: 30 } };
      if (role === 'architect') return { ...base, text: 'PLAN: write add(a,b)' };
      if (role === 'coder') return { ...base, text: 'function add(a,b){return a+b}', changedPaths: 3 };
      return { ...base, text: 'looks right', verdict: 'approve' };
    },
  };
}

const storeOver = (keys: Record<string, string>): KeyStore => ({ getKey: (n) => { const v = keys[n]; if (v === undefined) throw new Error('absent'); return v; }, has: (n) => keys[n] !== undefined });

function harness(options: {
  readonly ledger?: DispatchLedger & { readonly held?: DispatchRow[] };
  readonly behave?: Partial<Record<'architect' | 'coder' | 'reviewer', Behaviour>>;
  readonly providerIds?: readonly [string, string, string];
  readonly env?: Record<string, string | undefined>;
  readonly frozen?: FrozenMission;
  readonly run?: { missionId: string; contractSha256: string; state: string } | null;
  readonly checkerPass?: boolean;
  readonly providers?: null;
  readonly mode?: 'live' | 'fake';
  readonly omitMode?: boolean;
  readonly models?: Partial<Record<'architect' | 'coder' | 'reviewer', string>>;
  /** R3: undefined = a store over KEYS for mode live and none for fake; null = none; a store = that store. */
  readonly keyStore?: KeyStore | null;
} = {}): Harness {
  const env: Record<string, string | undefined> = {
    JULIUS_J1_ENABLED: '1', JULIUS_J1_FOUNDER_PLAYER_ID: FOUNDER, JULIUS_J1_PROJECT_ID: PROJECT, JULIUS_J1_REVIEWER_PROVIDER: (options.providerIds ?? ['openai', 'anthropic', 'xai'])[2], JULIUS_J1_BUDGET_CAP_USD: '10', JULIUS_J1_LEG_ESTIMATE_USD: '1', ...KEYS, ...options.env,
  };
  const calls: RoleCallInput[] = [];
  const logs: string[] = [];
  const ids = options.providerIds ?? ['openai', 'anthropic', 'xai'];
  const providers: DispatchProviders = {
    architect: fakeProvider('architect', ids[0], 'OPENAI_API_KEY', calls, options.behave?.architect),
    coder: fakeProvider('coder', ids[1], 'ANTHROPIC_API_KEY', calls, options.behave?.coder),
    reviewer: fakeProvider('reviewer', ids[2], 'XAI_API_KEY', calls, options.behave?.reviewer),
  };
  for (const role of ['architect', 'coder', 'reviewer'] as const) if (options.models?.[role] !== undefined) (providers[role] as { model: string }).model = options.models[role]!;
  const ledger = options.ledger ?? createMemoryDispatchLedger();
  const keyStore: KeyStore | null = options.keyStore !== undefined ? options.keyStore : options.mode === 'live' ? storeOver(KEYS) : null;
  let clock = Date.parse('2026-10-22T12:00:00Z');
  let n = 0;
  const controller = options.providers === null
    ? createUncomposedJuliusDispatch(() => env, () => clock)
    : createJuliusDispatch({
      providers, ledger, ...(keyStore === null ? {} : { keyStore }), ...(options.mode === 'live' ? { briefSha256: (options.frozen ?? FROZEN).contractSha256 } : {}), ...(options.omitMode === true ? {} : { mode: options.mode ?? 'fake' }), env: () => env, now: () => (clock += 1000), log: (line) => logs.push(line),
      newId: () => `disp_${(n += 1)}`,
      frozen: options.frozen ?? FROZEN,
      checker: { check: async () => ({ pass: options.checkerPass ?? true }) },
      runs: { lookup: async () => (options.run === undefined ? { missionId: FROZEN.missionId, contractSha256: FROZEN.contractSha256, state: 'READY' } : options.run) },
    });
  return { env, calls, logs, ledger, controller, providers };
}

const input = (over: Partial<Parameters<JuliusDispatchController['dispatch']>[0]> = {}) => ({
  projectId: PROJECT, runId: RUN, callerPlayerId: FOUNDER, sessionId: 'sess-1', idempotencyKey: 'key-0000001',
  clientTriggerId: 'trig-00000001', clientLogSha256: sha('client line'), clientUiActionUtc: UI_UTC, ...over,
});
const rowsOf = async (h: Harness): Promise<readonly DispatchRow[]> => h.ledger.rows();
const phases = (rows: readonly DispatchRow[]): string[] => rows.map((r) => (r.phase === 'pre_call' || r.phase === 'result' ? `${String(r.phase)}:${String(r.role)}` : String(r.phase)));

describe('J1 chain, fake providers', () => {
  it('runs Architect -> Coder -> Reviewer with the acceptance row first and a pre_call before every call', async () => {
    const h = harness();
    const out = await h.controller.dispatch(input());
    expect(out).toMatchObject({ ok: true, status: 202, replayed: false });
    await h.controller.whenIdle();
    expect(h.calls.map((c) => c.role)).toEqual(['architect', 'coder', 'reviewer']);
    expect(phases(await rowsOf(h))).toEqual([
      'run_created', 'run_start', 'pre_call:architect', 'result:architect', 'pre_call:coder', 'result:coder',
      'pre_call:reviewer', 'result:reviewer', 'checker', 'result:final',
    ]);
    const rows = await rowsOf(h);
    expect(rows[1]).toMatchObject({ clientLogSha256: sha('client line'), clientTriggerId: 'trig-00000001', runOrdinal: 1, reviewerProvider: 'xai' });
    const results = rows.filter((r) => r.phase === 'result' && r.role !== 'final');
    expect(results.map((r) => r.providerResponseId)).toEqual(['resp_architect_00112233445566', 'resp_coder_00112233445566', 'resp_reviewer_00112233445566']);
    expect(results[1]).toMatchObject({ changedPaths: 3, outputChars: 'function add(a,b){return a+b}'.length });
    // the coder saw the plan, the reviewer saw both
    expect(h.calls[1].architectText).toBe('PLAN: write add(a,b)');
    expect(h.calls[2].coderArtifact).toBe('function add(a,b){return a+b}');
    const res = h.controller.result({ projectId: PROJECT, runId: RUN, callerPlayerId: FOUNDER });
    const data = (res.body as { data: { state: string; resultText: string; resultSha256: string } }).data;
    expect(data.state).toBe('COMPLETED');
    expect(data.resultSha256).toBe(sha(data.resultText));
    expect(rows[rows.length - 1]).toMatchObject({ phase: 'result', state: 'COMPLETED', resultSha256: data.resultSha256 });
    const result = JSON.parse(data.resultText) as { roles: { responseIdTail: string; responseIdSha16: string }[] };
    expect(result.roles.map((r) => r.responseIdTail)).toEqual(['33445566', '33445566', '33445566']);
    expect(result.roles[0].responseIdSha16).toBe(sha('resp_architect_00112233445566').slice(0, 16));
  });

  it('trims the coder final message ONCE: the reviewer, the ledger hashes and the result bytes all carry the trimmed artifact', async () => {
    const bare = '{"records":[]}';
    const h = harness({ behave: { coder: () => ({ ok: true, responseId: 'resp_coder_00112233445566', model: 'anthropic-model', usage: { input: 1, output: 2, total: 3 }, text: `
  ${bare}  

`, changedPaths: 1 }) } });
    await h.controller.dispatch(input());
    await h.controller.whenIdle();
    expect(h.calls[2].coderArtifact).toBe(bare);
    const rows = await rowsOf(h);
    const coderResult = rows.find((r) => r.phase === 'result' && r.role === 'coder');
    expect(coderResult).toMatchObject({ outputSha256: sha(bare), outputChars: bare.length });
    const data = (h.controller.result({ projectId: PROJECT, runId: RUN, callerPlayerId: FOUNDER }).body as { data: { resultText: string; resultSha256: string } }).data;
    const result = JSON.parse(data.resultText) as { artifactText: string; artifactSha256: string };
    expect(result.artifactText).toBe(bare);
    expect(result.artifactSha256).toBe(sha(bare));
    expect(data.resultSha256).toBe(sha(data.resultText));
  });

  it('rows hold ids, hashes and counts, never the plan, the artifact or the review text', async () => {
    const h = harness();
    await h.controller.dispatch(input());
    await h.controller.whenIdle();
    const text = JSON.stringify(await rowsOf(h));
    for (const forbidden of ['PLAN: write add', 'function add', 'looks right']) expect(text).not.toContain(forbidden);
  });

  it('streams ordered events through a cursor and ends terminal', async () => {
    const h = harness();
    await h.controller.dispatch(input());
    await h.controller.whenIdle();
    const first = h.controller.events({ projectId: PROJECT, runId: RUN, callerPlayerId: FOUNDER, cursor: 0 }).body as { data: { events: { sequence: number; type: string }[]; nextCursor: number; terminal: boolean; state: string } };
    expect(first.data.events.map((e) => e.type)).toEqual([
      'chain.accepted', 'role.started', 'role.completed', 'role.started', 'role.completed', 'role.started', 'role.completed', 'checker.started', 'checker.completed', 'chain.completed',
    ]);
    expect(first.data.events.map((e) => e.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(first.data.terminal).toBe(true);
    const tail = h.controller.events({ projectId: PROJECT, runId: RUN, callerPlayerId: FOUNDER, cursor: 8 }).body as { data: { events: { sequence: number }[]; nextCursor: number } };
    expect(tail.data.events.map((e) => e.sequence)).toEqual([9, 10]);
    expect(tail.data.nextCursor).toBe(10);
  });

  it('a reviewer rejection or a failing hidden checker is reported as FAILED, never forced to pass', async () => {
    const rej = harness({ behave: { reviewer: () => ({ ok: true, text: 'no', responseId: 'resp_r', model: 'm', verdict: 'reject' }) } });
    await rej.controller.dispatch(input());
    await rej.controller.whenIdle();
    expect(JSON.parse(((rej.controller.result({ projectId: PROJECT, runId: RUN, callerPlayerId: FOUNDER }).body as { data: { resultText: string } }).data.resultText))).toMatchObject({ state: 'FAILED', failure: 'reviewer_rejected' });
    const chk = harness({ checkerPass: false });
    await chk.controller.dispatch(input());
    await chk.controller.whenIdle();
    expect(JSON.parse(((chk.controller.result({ projectId: PROJECT, runId: RUN, callerPlayerId: FOUNDER }).body as { data: { resultText: string } }).data.resultText))).toMatchObject({ state: 'FAILED', failure: 'checker_failed', checkerPass: false });
  });

  it('a coder that executed no tool cannot complete the chain; the reviewer is then never called', async () => {
    const h = harness({ behave: { coder: () => ({ ok: true, text: 'prose only', responseId: 'resp_c', model: 'm', changedPaths: 0 }) } });
    await h.controller.dispatch(input());
    await h.controller.whenIdle();
    expect(h.calls.map((c) => c.role)).toEqual(['architect', 'coder']);
    expect(JSON.parse(((h.controller.result({ projectId: PROJECT, runId: RUN, callerPlayerId: FOUNDER }).body as { data: { resultText: string } }).data.resultText))).toMatchObject({ state: 'FAILED', failure: 'coder_no_workspace_change' });
  });

  it('a failed leg that has id, model, usage and requests keeps all of them in the ledger row (paid-leg row)', async () => {
    const h = harness({ behave: { reviewer: () => ({ ok: false, text: '', responseId: 'resp_paid_00112233', model: 'grok-served', usage: { input: 10, output: null, total: null }, requests: 1, failureClass: 'xai_verdict_unreadable', shownSha256: 'a'.repeat(64) }) } });
    await h.controller.dispatch(input());
    await h.controller.whenIdle();
    const row = (await rowsOf(h)).find((r) => r.phase === 'result' && r.role === 'reviewer');
    expect(row).toMatchObject({ outcome: 'xai_verdict_unreadable', providerResponseId: 'resp_paid_00112233', model: 'grok-served', requests: 1, usage: { input: 10, output: null, total: null }, shownSha256: 'a'.repeat(64) });
  });

  it('G3-2: a leg with no usage (throw, timeout, empty usage) carries an explicit spend_unknown marker, never null-as-zero, and the unknown is counted not priced', async () => {
    const h = harness({ behave: { coder: () => ({ ok: false, text: '', responseId: 'sess_paid_0011', model: null, failureClass: 'coder_timed_out', usage: { input: null, output: null, total: null } }) } });
    await h.controller.dispatch(input());
    await h.controller.whenIdle();
    const rows = await rowsOf(h);
    const arch = rows.find((r) => r.phase === 'result' && r.role === 'architect');
    const coder = rows.find((r) => r.phase === 'result' && r.role === 'coder');
    expect(arch).toMatchObject({ spend: 'usage_reported', spendUnknown: false });
    expect(coder).toMatchObject({ spend: 'spend_unknown', spendUnknown: true, providerResponseId: 'sess_paid_0011' });
    expect(coder).not.toHaveProperty('costUsd');
    const thrown = harness({ behave: { architect: () => { throw new Error('boom'); } } });
    await thrown.controller.dispatch(input());
    await thrown.controller.whenIdle();
    const trows = await rowsOf(thrown);
    expect(trows.find((r) => r.phase === 'result' && r.role === 'architect')).toMatchObject({ spend: 'spend_unknown', spendUnknown: true, usage: null });
    expect(trows.find((r) => r.role === 'final')).toMatchObject({ spendUnknownLegs: 1 });
    const result = JSON.parse((thrown.controller.result({ projectId: PROJECT, runId: RUN, callerPlayerId: FOUNDER }).body as { data: { resultText: string } }).data.resultText) as { spendUnknownLegs: number; roles: { spend: string }[] };
    expect(result.spendUnknownLegs).toBe(1);
    expect(result.roles[0].spend).toBe('spend_unknown');
  });

  it('G3-2: an adapter that says the provider was never contacted is not_contacted, and a later budget_refused row records unknown legs', async () => {
    const h = harness({
      env: { JULIUS_J1_BUDGET_CAP_USD: '2', JULIUS_J1_LEG_ESTIMATE_USD: '1' },
      behave: { architect: () => ({ ok: false, text: '', responseId: null, model: null, failureClass: 'key_missing', providerContacted: false }) },
    });
    await h.controller.dispatch(input());
    await h.controller.whenIdle();
    expect((await rowsOf(h)).find((r) => r.phase === 'result' && r.role === 'architect')).toMatchObject({ spend: 'not_contacted', spendUnknown: false });
    const two = harness({ env: { JULIUS_J1_BUDGET_CAP_USD: '2', JULIUS_J1_LEG_ESTIMATE_USD: '1' }, behave: { architect: () => ({ ok: true, text: 'plan', responseId: 'resp_a_00112233', model: 'm' }) } });
    await two.controller.dispatch(input());
    await two.controller.whenIdle();
    expect((await rowsOf(two)).find((r) => r.phase === 'budget_refused')).toMatchObject({ unknownSpendLegs: 1, role: 'reviewer' });
  });

  it('changedPaths and toolInvocations are ledgered separately; unknown stays null and is never 0', async () => {
    const h = harness({ behave: { coder: () => ({ ok: true, text: 'art', responseId: 'resp_c_0011223344', model: 'm', changedPaths: 2, toolInvocations: null, evidence: 'EVIDENCE TEXT' }) } });
    await h.controller.dispatch(input());
    await h.controller.whenIdle();
    const coderRow = (await rowsOf(h)).find((r) => r.phase === 'result' && r.role === 'coder');
    expect(coderRow).toMatchObject({ changedPaths: 2, toolInvocations: null, evidenceSha256: sha('EVIDENCE TEXT'), evidenceChars: 13 });
    expect(coderRow).not.toHaveProperty('toolCalls');
    const none = harness({ behave: { coder: () => ({ ok: true, text: 'art', responseId: 'resp_c_0011223344', model: 'm' }) } });
    await none.controller.dispatch(input());
    await none.controller.whenIdle();
    expect((await rowsOf(none)).find((r) => r.phase === 'result' && r.role === 'coder')).toMatchObject({ outcome: 'no_workspace_change', changedPaths: null, toolInvocations: null });
  });

  it('hands the coder evidence to the reviewer and ledgers the reviewer shown digest', async () => {
    const h = harness({ behave: { coder: () => ({ ok: true, text: 'art', responseId: 'resp_c_0011223344', model: 'm', changedPaths: 1, evidence: 'M\tsrc/a.js' }), reviewer: () => ({ ok: true, text: 'fine', responseId: 'resp_r_0011223344', model: 'g', verdict: 'approve', shownSha256: sha('shown') }) } });
    await h.controller.dispatch(input());
    await h.controller.whenIdle();
    expect(h.calls[2]).toMatchObject({ coderArtifact: 'art', coderEvidence: 'M\tsrc/a.js' });
    expect((await rowsOf(h)).find((r) => r.phase === 'result' && r.role === 'reviewer')).toMatchObject({ shownSha256: sha('shown') });
  });

  it('a provider that throws or times out is a failure class, not the provider message', async () => {
    const h = harness({ behave: { architect: () => { throw new Error(`boom ${KEYS.OPENAI_API_KEY}`); } } });
    await h.controller.dispatch(input());
    await h.controller.whenIdle();
    const blob = JSON.stringify([await rowsOf(h), h.controller.events({ projectId: PROJECT, runId: RUN, callerPlayerId: FOUNDER, cursor: 0 }), h.logs]);
    expect(blob).not.toContain(KEYS.OPENAI_API_KEY);
    expect(blob).toContain('provider_error');
    expect(h.calls.map((c) => c.role)).toEqual(['architect']);
  });
});

describe('J1 negative controls', () => {
  it('kill switch OFF (unset, 0, true, empty) refuses with no ledger row and no provider call', async () => {
    for (const value of [undefined, '0', 'true', '']) {
      const h = harness({ env: { JULIUS_J1_ENABLED: value } });
      const out = await h.controller.dispatch(input());
      expect(out).toMatchObject({ ok: false, status: 503, code: 'julius_dispatch_disabled' });
      expect(h.calls).toHaveLength(0);
      expect(await rowsOf(h)).toHaveLength(0);
    }
  });

  it('kill switch flipped OFF between roles halts the chain before the next role', async () => {
    // eslint-disable-next-line prefer-const
    let h: Harness;
    h = harness({ behave: { architect: () => { h.env.JULIUS_J1_ENABLED = '0'; return { ok: true, text: 'plan', responseId: 'resp_a', model: 'm' }; } } });
    await h.controller.dispatch(input());
    await h.controller.whenIdle();
    expect(h.calls.map((c) => c.role)).toEqual(['architect']);
    const final = (await rowsOf(h)).find((r) => r.phase === 'result' && r.role === 'final');
    expect(final).toMatchObject({ state: 'HALTED', failure: 'kill_switch_flipped' });
  });

  it('G3-8: flipping the kill switch AFTER the role loop check, while the pre_call row is being written, stops THAT call', async () => {
    // eslint-disable-next-line prefer-const
    let h: Harness;
    const ledger = createMemoryDispatchLedger({ failWrites: (r) => { if (r.phase === 'pre_call' && r.role === 'coder') h.env.JULIUS_J1_ENABLED = '0'; return false; } });
    h = harness({ ledger });
    await h.controller.dispatch(input());
    await h.controller.whenIdle();
    expect(h.calls.map((c) => c.role)).toEqual(['architect']);
    const rows = await rowsOf(h);
    expect(rows.find((r) => r.phase === 'call_not_made')).toMatchObject({ role: 'coder', reason: 'kill_switch_flipped_before_call' });
    expect(rows.find((r) => r.phase === 'result' && r.role === 'coder')).toBeUndefined();
    expect(rows.find((r) => r.role === 'final')).toMatchObject({ state: 'HALTED', failure: 'kill_switch_flipped' });
  });

  it('ledger write failure on the acceptance row refuses and calls nothing', async () => {
    const h = harness({ ledger: createMemoryDispatchLedger({ failWrites: (r) => r.phase === 'run_start' }) });
    const out = await h.controller.dispatch(input());
    expect(out).toMatchObject({ ok: false, status: 503, code: 'julius_dispatch_ledger_unavailable' });
    expect(h.calls).toHaveLength(0);
    // and the slot was released: a healthy retry on a healthy ledger is not "busy"
    expect(await h.controller.dispatch(input({ runId: 'run:other' }))).toMatchObject({ ok: false, code: 'julius_dispatch_ledger_unavailable' });
  });

  it('ledger write failure on a pre_call row means NO call for that role', async () => {
    const h = harness({ ledger: createMemoryDispatchLedger({ failWrites: (r) => r.phase === 'pre_call' && r.role === 'coder' }) });
    await h.controller.dispatch(input());
    await h.controller.whenIdle();
    expect(h.calls.map((c) => c.role)).toEqual(['architect']);
    expect((await rowsOf(h)).find((r) => r.phase === 'result' && r.role === 'final')).toMatchObject({ state: 'HALTED', failure: 'ledger_write_failed' });
  });

  it('ledger write failure on a result row stops the chain after the call that could not be recorded', async () => {
    const h = harness({ ledger: createMemoryDispatchLedger({ failWrites: (r) => r.phase === 'result' && r.role === 'architect' }) });
    await h.controller.dispatch(input());
    await h.controller.whenIdle();
    expect(h.calls.map((c) => c.role)).toEqual(['architect']);
    const events = (h.controller.events({ projectId: PROJECT, runId: RUN, callerPlayerId: FOUNDER, cursor: 0 }).body as { data: { events: { type: string; responseIdTail?: string }[] } }).data.events;
    // the id is still visible for a console reconcile even though the row is not
    expect(events.find((e) => e.type === 'role.completed')?.responseIdTail).toBe('33445566');
    expect(JSON.parse(((h.controller.result({ projectId: PROJECT, runId: RUN, callerPlayerId: FOUNDER }).body as { data: { resultText: string } }).data.resultText))).toMatchObject({ state: 'HALTED', failure: 'ledger_write_failed_after_call' });
  });

  it('a second concurrent dispatch is refused busy, and the first still completes', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const h = harness({ behave: { architect: async () => { await gate; return { ok: true, text: 'plan', responseId: 'resp_a', model: 'm' }; } } });
    const first = await h.controller.dispatch(input());
    expect(first).toMatchObject({ ok: true, status: 202 });
    const second = await h.controller.dispatch(input({ runId: 'run:second', idempotencyKey: 'key-0000002' }));
    expect(second).toMatchObject({ ok: false, status: 429, code: 'julius_dispatch_busy' });
    release();
    await h.controller.whenIdle();
    expect(h.calls.map((c) => c.role)).toEqual(['architect', 'coder', 'reviewer']);
    // idle again: a distinct run is now accepted
    expect(await h.controller.dispatch(input({ runId: 'run:second', idempotencyKey: 'key-0000002' }))).toMatchObject({ ok: true });
    await h.controller.whenIdle();
  });

  it('two truly simultaneous dispatches start exactly one chain', async () => {
    const h = harness();
    const [a, b] = await Promise.all([
      h.controller.dispatch(input()),
      h.controller.dispatch(input({ runId: 'run:second', idempotencyKey: 'key-0000002' })),
    ]);
    await h.controller.whenIdle();
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(h.calls.filter((c) => c.role === 'architect')).toHaveLength(1);
  });

  it('the key never appears in rows, events, results, logs or the route body, even when a provider echoes it', async () => {
    const echo = (role: string): Behaviour => (i) => ({
      ok: true, responseId: `resp_${role}_${i.apiKey}_tail`, model: 'm',
      text: `echo ${i.apiKey} and ${Object.values(KEYS).join(' ')}`, changedPaths: 1, verdict: 'approve', usage: { input: 1, output: 1, total: 2 },
    });
    const h = harness({ behave: { architect: echo('a'), coder: echo('c'), reviewer: echo('r') } });
    await h.controller.dispatch(input());
    await h.controller.whenIdle();
    const blob = JSON.stringify([
      await rowsOf(h), h.logs,
      h.controller.events({ projectId: PROJECT, runId: RUN, callerPlayerId: FOUNDER, cursor: 0 }),
      h.controller.result({ projectId: PROJECT, runId: RUN, callerPlayerId: FOUNDER }),
    ]);
    for (const key of Object.values(KEYS)) expect(blob).not.toContain(key);
    expect(blob).toContain('[redacted]');
    // and the keys DID reach the ports (the control is not vacuous)
    expect(h.calls.map((c) => c.apiKey)).toEqual([KEYS.OPENAI_API_KEY, KEYS.ANTHROPIC_API_KEY, KEYS.XAI_API_KEY]);
  });

  it('a role whose key is not in the environment is not called and the chain fails by name', async () => {
    const h = harness({ env: { XAI_API_KEY: undefined } });
    await h.controller.dispatch(input());
    await h.controller.whenIdle();
    expect(h.calls.map((c) => c.role)).toEqual(['architect', 'coder']);
    expect((await rowsOf(h)).find((r) => r.phase === 'result' && r.role === 'final')).toMatchObject({ state: 'FAILED', failure: 'provider_key_missing' });
  });

  it('refuses a reviewer from the coder\'s (or architect\'s) provider', async () => {
    for (const ids of [['openai', 'anthropic', 'anthropic'], ['openai', 'anthropic', 'openai'], ['x', 'x', 'y']] as const) {
      const h = harness({ providerIds: ids });
      expect(await h.controller.dispatch(input())).toMatchObject({ ok: false, code: 'julius_dispatch_reviewer_not_independent' });
      expect(h.calls).toHaveLength(0);
    }
  });

  it('refuses a mission that is not frozen, not hidden-checked by another author, or seeded', async () => {
    expect(frozenMissionProblems(FROZEN)).toEqual([]);
    for (const bad of [{ ...FROZEN, checkerAuthor: 'AUTHOR-A' }, { ...FROZEN, seededDefect: true }, { ...FROZEN, checkerSha256: 'nope' }, { ...FROZEN, preregId: '' }]) {
      const h = harness({ frozen: bad });
      expect(await h.controller.dispatch(input())).toMatchObject({ ok: false, code: 'julius_dispatch_mission_not_frozen' });
      expect(h.calls).toHaveLength(0);
    }
  });

  it('refuses a run that is another mission, another contract, not READY, or unknown', async () => {
    expect(await harness({ run: { missionId: 'other', contractSha256: FROZEN.contractSha256, state: 'READY' } }).controller.dispatch(input())).toMatchObject({ code: 'julius_dispatch_mission_not_frozen_mission' });
    expect(await harness({ run: { missionId: FROZEN.missionId, contractSha256: sha('edited'), state: 'READY' } }).controller.dispatch(input())).toMatchObject({ code: 'julius_dispatch_mission_not_frozen_mission' });
    expect(await harness({ run: { missionId: FROZEN.missionId, contractSha256: FROZEN.contractSha256, state: 'RUNNING' } }).controller.dispatch(input())).toMatchObject({ code: 'julius_dispatch_run_not_ready' });
    expect(await harness({ run: null }).controller.dispatch(input())).toMatchObject({ status: 404, code: 'julius_dispatch_run_not_found' });
  });

  it('refuses everyone but the one founder player in the one configured project, and a second pairing', async () => {
    const h = harness();
    expect(await h.controller.dispatch(input({ callerPlayerId: 'someone-else' }))).toMatchObject({ status: 403, code: 'julius_dispatch_founder_only' });
    expect(await h.controller.dispatch(input({ projectId: 'proj-2' }))).toMatchObject({ status: 403, code: 'julius_dispatch_wrong_project' });
    expect(await harness({ env: { JULIUS_J1_FOUNDER_PLAYER_ID: undefined } }).controller.dispatch(input())).toMatchObject({ code: 'julius_dispatch_not_configured' });
    expect(await h.controller.dispatch(input())).toMatchObject({ ok: true });
    await h.controller.whenIdle();
    expect(await h.controller.dispatch(input({ runId: 'run:second', sessionId: 'sess-2', idempotencyKey: 'key-0000002' }))).toMatchObject({ status: 403, code: 'julius_dispatch_second_pairing' });
    expect(h.calls).toHaveLength(3);
  });

  it('a run is dispatched once: the same key replays without a second chain, another key is refused', async () => {
    const h = harness();
    await h.controller.dispatch(input());
    await h.controller.whenIdle();
    expect(await h.controller.dispatch(input())).toMatchObject({ ok: true, status: 200, replayed: true });
    expect(await h.controller.dispatch(input({ idempotencyKey: 'key-0000099' }))).toMatchObject({ status: 403, code: 'julius_dispatch_run_creator_mismatch' });
    expect(h.calls).toHaveLength(3);
    expect((await rowsOf(h)).filter((r) => r.phase === 'run_start')).toHaveLength(1);
  });

  it('caps: two runs of the frozen mission, then refused; the daily cap also binds', async () => {
    const h = harness({ env: { JULIUS_J1_DAILY_CAP: '10' } });
    for (const [i, run] of ['run:1', 'run:2'].entries()) {
      expect(await h.controller.dispatch(input({ runId: run, idempotencyKey: `key-000000${i + 1}` }))).toMatchObject({ ok: true });
      await h.controller.whenIdle();
    }
    expect(await h.controller.dispatch(input({ runId: 'run:3', idempotencyKey: 'key-0000003' }))).toMatchObject({ status: 429, code: 'julius_dispatch_mission_cap_reached' });
    const d = harness({ env: { JULIUS_J1_DAILY_CAP: '1' } });
    await d.controller.dispatch(input());
    await d.controller.whenIdle();
    expect(await d.controller.dispatch(input({ runId: 'run:2', idempotencyKey: 'key-0000002' }))).toMatchObject({ status: 429, code: 'julius_dispatch_cap_reached' });
    expect((await rowsOf(h)).filter((r) => r.phase === 'run_start').map((r) => r.runOrdinal)).toEqual([1, 2]);
  });

  it('shipped composition: switch on but no adapters composed refuses by name', async () => {
    const h = harness({ providers: null });
    expect(await h.controller.dispatch(input())).toMatchObject({ status: 503, code: 'julius_dispatch_providers_not_composed' });
    h.env.JULIUS_J1_ENABLED = '0';
    expect(await h.controller.dispatch(input())).toMatchObject({ status: 503, code: 'julius_dispatch_disabled' });
  });
});

describe('J1 reviewer acceptance protocol (D1-D12) controls', () => {
  const WIRE_BAN = /openai|anthropic|xai|gpt|claude|grok|requested/i;

  it('run_start / pre_call / result / final rows carry the exact fields the reviewer crosscheck reads', async () => {
    const h = harness();
    await h.controller.dispatch(input());
    await h.controller.whenIdle();
    const rows = await rowsOf(h);
    expect(rows[1]).toMatchObject({
      phase: 'run_start', runId: RUN, missionId: FROZEN.missionId, frozenSha256: FROZEN.contractSha256, budgetCapUsd: 10,
      authorizedPlayerHash: sha(FOUNDER).slice(0, 16), keyHash: sha('key-0000001').slice(0, 16), mode: 'fake',
    });
    const pre = rows.filter((r) => r.phase === 'pre_call');
    expect(pre.map((r) => r.role)).toEqual(['architect', 'coder', 'reviewer']);
    for (const r of pre) expect(r).toMatchObject({ runId: RUN, keyHash: sha('key-0000001').slice(0, 16), playerHash: sha(FOUNDER).slice(0, 16), mode: 'fake' });
    expect(pre[2]).toMatchObject({ provider: 'xai', model: 'grok-fake' });
    expect(pre.every((r) => typeof r.at === 'string' && typeof r.model === 'string')).toBe(true);
    const results = rows.filter((r) => r.phase === 'result' && r.role !== 'final');
    expect(results.every((r) => typeof r.providerResponseId === 'string' && r.providerResponseId !== '' && typeof r.model === 'string' && r.usage !== null)).toBe(true);
    expect(results[2]).toMatchObject({ model: 'xai-model' });
    const final = rows[rows.length - 1];
    expect(final).toMatchObject({ phase: 'result', role: 'final', mode: 'fake' });
    expect(final.checkerOutputSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(final.resultSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(String(pre[0].at) > String(rows[1].at)).toBe(true);
    expect(JSON.stringify(rows)).not.toMatch(/seeded|forcedCatch/);
  });

  it('D8: the adapter-reported provider request count per response id is ledgered', async () => {
    const h = harness({ behave: { reviewer: () => ({ ok: true, text: 'fine', responseId: 'resp_rev_1', model: 'echo-m', verdict: 'approve', requests: 4 }) } });
    await h.controller.dispatch(input());
    await h.controller.whenIdle();
    const rev = (await rowsOf(h)).find((r) => r.phase === 'result' && r.role === 'reviewer');
    expect(rev).toMatchObject({ providerResponseId: 'resp_rev_1', model: 'echo-m', requests: 4 });
  });

  it('a leg with no provider response id or no provider-echoed model is NOT accepted (empty response_id regression)', async () => {
    for (const bad of [{ responseId: '' }, { responseId: null }, { model: null }, { model: '' }]) {
      const h = harness({ behave: { reviewer: () => ({ ok: true, text: 'fine', responseId: 'resp_x', model: 'm', verdict: 'approve', ...bad }) as RoleCallOutput } });
      await h.controller.dispatch(input());
      await h.controller.whenIdle();
      const final = (await rowsOf(h)).find((r) => r.phase === 'result' && r.role === 'final');
      expect(final).toMatchObject({ state: 'FAILED', failure: 'reviewer_response_identity_missing' });
      expect((await rowsOf(h)).some((r) => r.phase === 'checker')).toBe(false);
    }
  });

  it('the wire (dispatch answer, events, result) never names a provider or a model', async () => {
    const h = harness();
    const out = await h.controller.dispatch(input());
    await h.controller.whenIdle();
    const wire = JSON.stringify([
      out, h.controller.events({ projectId: PROJECT, runId: RUN, callerPlayerId: FOUNDER, cursor: 0 }),
      h.controller.result({ projectId: PROJECT, runId: RUN, callerPlayerId: FOUNDER }),
    ]);
    expect(wire).not.toMatch(WIRE_BAN);
    expect(JSON.stringify(await rowsOf(h))).toMatch(/xai/);
  });

  it('events carry the client chain vocabulary: role architect|coder|reviewer|checker, phase started|done|refused', async () => {
    const h = harness();
    await h.controller.dispatch(input());
    await h.controller.whenIdle();
    const ev = (h.controller.events({ projectId: PROJECT, runId: RUN, callerPlayerId: FOUNDER, cursor: 0 }).body as { data: { mode: string; events: { role?: string; phase?: string }[] } }).data;
    expect(ev.mode).toBe('fake');
    expect(ev.events.filter((e) => e.role !== undefined).map((e) => `${e.role}:${e.phase}`)).toEqual([
      'architect:started', 'architect:done', 'coder:started', 'coder:done', 'reviewer:started', 'reviewer:done', 'checker:started', 'checker:done',
    ]);
  });

  it('D11: a fake adapter cannot run live and a real adapter cannot run under the fake label', async () => {
    const live = harness({ mode: 'live' });
    expect(await live.controller.dispatch(input())).toMatchObject({ code: 'julius_dispatch_mode_mismatch' });
    expect(live.calls).toHaveLength(0);
    const h = harness();
    (h.providers.coder as { fake: boolean }).fake = false;
    expect(await h.controller.dispatch(input())).toMatchObject({ code: 'julius_dispatch_mode_mismatch' });
  });

  it('D6: the reviewer provider is read from config; a mismatch or a missing value refuses', async () => {
    expect(await harness({ env: { JULIUS_J1_REVIEWER_PROVIDER: 'anthropic' } }).controller.dispatch(input())).toMatchObject({ code: 'julius_dispatch_reviewer_config_mismatch' });
    expect(await harness({ env: { JULIUS_J1_REVIEWER_PROVIDER: undefined } }).controller.dispatch(input())).toMatchObject({ code: 'julius_dispatch_not_configured' });
    const h = harness();
    await h.controller.dispatch(input());
    await h.controller.whenIdle();
    expect(h.logs.join('\n')).toContain('reviewer=xai');
  });

  it('N2: a budget cap below one leg is refused before any pre_call, with a budget_refused row and no provider call', async () => {
    const h = harness({ env: { JULIUS_J1_BUDGET_CAP_USD: '0.5', JULIUS_J1_LEG_ESTIMATE_USD: '1' } });
    await h.controller.dispatch(input());
    await h.controller.whenIdle();
    expect(h.calls).toHaveLength(0);
    expect(phases(await rowsOf(h))).toEqual(['run_created', 'run_start', 'budget_refused', 'result:final']);
    const two = harness({ env: { JULIUS_J1_BUDGET_CAP_USD: '2', JULIUS_J1_LEG_ESTIMATE_USD: '1' } });
    await two.controller.dispatch(input());
    await two.controller.whenIdle();
    expect(two.calls.map((c) => c.role)).toEqual(['architect', 'coder']);
    expect((await rowsOf(two)).some((r) => r.phase === 'budget_refused' && r.role === 'reviewer')).toBe(true);
    expect(await harness({ env: { JULIUS_J1_BUDGET_CAP_USD: undefined } }).controller.dispatch(input())).toMatchObject({ code: 'julius_dispatch_not_configured' });
    expect(await harness({ env: { JULIUS_J1_BUDGET_CAP_USD: '-1' } }).controller.dispatch(input())).toMatchObject({ code: 'julius_dispatch_not_configured' });
  });

  it('N5/D7: the same key for another run is refused; the same key and run replays with no new pre_call', async () => {
    const h = harness({ env: { JULIUS_J1_DAILY_CAP: '10' } });
    await h.controller.dispatch(input());
    await h.controller.whenIdle();
    const before = (await rowsOf(h)).length;
    expect(await h.controller.dispatch(input())).toMatchObject({ ok: true, replayed: true });
    expect(await h.controller.dispatch(input({ runId: 'run:other' }))).toMatchObject({ status: 409, code: 'julius_dispatch_key_reused' });
    expect((await rowsOf(h)).length).toBe(before);
    expect(h.calls).toHaveLength(3);
  });

  it('D9: after a restart a half-finished run is ORPHANED, never resumed, and a finished one keeps its hash but not its text', async () => {
    const ledger = createMemoryDispatchLedger();
    const first = harness({ ledger, env: { JULIUS_J1_DAILY_CAP: '10' } });
    await first.controller.dispatch(input());
    await first.controller.whenIdle();
    const finalRow = (await ledger.rows()).find((r) => r.phase === 'result' && r.role === 'final');
    await ledger.append({ phase: 'run_start', dispatchId: 'disp_x', runId: 'run:dead', missionId: FROZEN.missionId, frozenSha256: FROZEN.contractSha256, authorizedPlayerHash: sha(FOUNDER).slice(0, 16), keyHash: sha('key-0000077').slice(0, 16), projectHash: sha(PROJECT).slice(0, 16), at: '2026-10-22T12:30:00.000Z', mode: 'fake' });
    await ledger.append({ phase: 'pre_call', runId: 'run:dead', role: 'architect', at: '2026-10-22T12:30:01.000Z' });
    const second = harness({ ledger, env: { JULIUS_J1_DAILY_CAP: '10', JULIUS_J1_MAX_RUNS_PER_MISSION: '10' } });
    expect(await second.controller.recover()).toEqual({ orphaned: ['run:dead'], finished: [RUN] });
    const countAfterRecover = (await ledger.rows()).length;
    expect((await ledger.rows()).some((r) => r.phase === 'orphaned' && r.runId === 'run:dead')).toBe(true);
    await second.controller.recover();
    expect((await ledger.rows()).length).toBe(countAfterRecover);
    expect(await second.controller.dispatch(input({ runId: 'run:dead', idempotencyKey: 'key-0000077' }))).toMatchObject({ ok: true, replayed: true, state: 'ORPHANED' });
    expect(await second.controller.dispatch(input({ runId: 'run:dead', idempotencyKey: 'key-0000078' }))).toMatchObject({ status: 403, code: 'julius_dispatch_run_creator_mismatch' });
    expect(second.controller.result({ projectId: PROJECT, runId: 'run:dead', callerPlayerId: FOUNDER }).status).toBe(409);
    const ev = second.controller.events({ projectId: PROJECT, runId: 'run:dead', callerPlayerId: FOUNDER, cursor: 0 }).body as { data: { state: string; terminal: boolean } };
    expect(ev.data).toMatchObject({ state: 'ORPHANED', terminal: true });
    const lost = second.controller.result({ projectId: PROJECT, runId: RUN, callerPlayerId: FOUNDER });
    expect(lost.status).toBe(410);
    expect(JSON.stringify(lost.body)).toContain(String(finalRow?.resultSha256));
    expect(await second.controller.dispatch(input())).toMatchObject({ ok: true, replayed: true, state: 'COMPLETED' });
    expect(second.calls).toHaveLength(0);
    expect((await ledger.rows()).filter((r) => r.phase === 'pre_call' && r.runId === RUN)).toHaveLength(3);
  });

  it('N4: a ledger that cannot be written makes the run refuse before any provider call', async () => {
    const h = harness({ ledger: createMemoryDispatchLedger({ failWrites: () => true }) });
    expect(await h.controller.dispatch(input())).toMatchObject({ status: 503 });
    expect(h.calls).toHaveLength(0);
  });
});

describe('G3-6 final-row failure and restart are explicit, not swallowed', () => {
  it('a ledger that fails the FINAL row surfaces state UNRECORDED on events, a named result refusal with the hash, a ledger event and a log line', async () => {
    const h = harness({ ledger: createMemoryDispatchLedger({ failWrites: (r) => r.phase === 'result' && r.role === 'final' }) });
    await h.controller.dispatch(input());
    await h.controller.whenIdle();
    const ev = (h.controller.events({ projectId: PROJECT, runId: RUN, callerPlayerId: FOUNDER, cursor: 0 }).body as { data: { state: string; terminal: boolean; events: { type: string; failure?: string }[] } }).data;
    expect(ev.state).toBe('UNRECORDED');
    expect(ev.terminal).toBe(true);
    expect(ev.events[ev.events.length - 1]).toMatchObject({ type: 'chain.final_row_failed', failure: 'ledger_write_failed_final_row' });
    const res = h.controller.result({ projectId: PROJECT, runId: RUN, callerPlayerId: FOUNDER });
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toContain('julius_dispatch_final_row_unwritten');
    expect(JSON.stringify(res.body)).toMatch(/[0-9a-f]{64}/);
    expect(h.logs.join(' ')).toContain('final_row_unwritten');
    expect((await rowsOf(h)).some((r) => r.role === 'final')).toBe(false);
  });
  it('RESTART LIMIT (stated): the in-memory pairing bind resets, but a repeat dispatch of the same run is still refused from the ledger', async () => {
    expect(J1_RESTART_LIMITS.boundSessionSurvivesRestart).toBe(false);
    expect(J1_RESTART_LIMITS.statement).toMatch(/boundSession/);
    const ledger = createMemoryDispatchLedger();
    const first = harness({ ledger, env: { JULIUS_J1_DAILY_CAP: '10', JULIUS_J1_MAX_RUNS_PER_MISSION: '10' } });
    await first.controller.dispatch(input());
    await first.controller.whenIdle();
    const second = harness({ ledger, env: { JULIUS_J1_DAILY_CAP: '10', JULIUS_J1_MAX_RUNS_PER_MISSION: '10' } });
    expect(await second.controller.dispatch(input())).toMatchObject({ status: 409, code: 'julius_dispatch_already_dispatched' });
    expect(await second.controller.dispatch(input({ idempotencyKey: 'key-0000099' }))).toMatchObject({ status: 403, code: 'julius_dispatch_run_creator_mismatch' });
    expect(second.calls).toHaveLength(0);
    // the limit itself: a NEW session pairing on a NEW run is not blocked by the first process's bound session
    expect(await second.controller.dispatch(input({ runId: 'run:next', sessionId: 'sess-other', idempotencyKey: 'key-0000002' }))).toMatchObject({ ok: true });
  });
});

describe('G3-4 the mode is DERIVED from the composed adapters, and composeRoleProviders is required', () => {
  it('with no declared mode, all-fake adapters stamp fake on rows, events and results; the controller does not need to be told', async () => {
    const h = harness({ omitMode: true });
    expect(await h.controller.dispatch(input())).toMatchObject({ ok: true, mode: 'fake' });
    await h.controller.whenIdle();
    const rows = await rowsOf(h);
    expect(rows.filter((r) => r.mode !== undefined).every((r) => r.mode === 'fake')).toBe(true);
    expect(rows.find((r) => r.phase === 'run_start')).toMatchObject({ mode: 'fake' });
    expect(rows.find((r) => r.role === 'final')).toMatchObject({ mode: 'fake' });
  });
  it('a declared mode that contradicts the adapters is refused; mixed fake/real adapters are refused', async () => {
    expect(await harness({ mode: 'live' }).controller.dispatch(input())).toMatchObject({ code: 'julius_dispatch_mode_mismatch' });
    const mixed = harness({ omitMode: true });
    (mixed.providers.reviewer as { fake: boolean }).fake = false;
    expect(await mixed.controller.dispatch(input())).toMatchObject({ code: 'julius_dispatch_mode_mismatch' });
    expect(mixed.calls).toHaveLength(0);
  });
  it('the controller itself requires composeRoleProviders: shared model families or an unmappable model are refused before any row', async () => {
    const shared = harness({ omitMode: true, models: { coder: 'gpt-other' } });
    expect(await shared.controller.dispatch(input())).toMatchObject({ status: 503, code: 'julius_dispatch_providers_not_composed' });
    const unmapped = harness({ omitMode: true, models: { reviewer: 'mystery-1' } });
    expect(await unmapped.controller.dispatch(input())).toMatchObject({ status: 503, code: 'julius_dispatch_providers_not_composed' });
    expect(shared.calls).toHaveLength(0);
    expect(await rowsOf(shared)).toHaveLength(0);
  });
});

describe('G3-3 the run creator and the ordering evidence are recorded and enforced', () => {
  it('dispatch creates the run itself in one authenticated flow: run_created carries creator hashes, UI utc and the ledger time, and precedes run_start and every pre_call', async () => {
    const h = harness();
    await h.controller.dispatch(input());
    await h.controller.whenIdle();
    const rows = await rowsOf(h);
    const created = rows.find((r) => r.phase === 'run_created');
    expect(created).toMatchObject({ runId: RUN, creatorPlayerHash: sha(FOUNDER).slice(0, 16), creatorKeyHash: sha('key-0000001').slice(0, 16), uiActionUtc: UI_UTC, clientLogSha256: sha('client line') });
    expect(rows.indexOf(created!)).toBeLessThan(rows.findIndex((r) => r.phase === 'run_start'));
    expect(Date.parse(String(created!.uiActionUtc))).toBeLessThan(Date.parse(String(created!.at)));
    expect(verifyRunOrdering(rows, RUN)).toEqual({ ok: true });
    expect(rows.find((r) => r.role === 'final')).toMatchObject({ orderOk: true });
  });
  it('a UI-action time at or after the ledger run_created time, in the future, missing or unparsable is run_order_violation with no row and no call', async () => {
    for (const bad of ['2026-10-22T13:00:00.000Z', '2026-10-22T12:00:01.000Z', 'soon', '', undefined]) {
      const h = harness();
      const out = await h.controller.dispatch(input({ clientUiActionUtc: bad as string }));
      expect(out).toMatchObject({ ok: false, status: 409, code: 'julius_dispatch_run_order_violation' });
      expect(h.calls).toHaveLength(0);
      expect(await rowsOf(h)).toHaveLength(0);
    }
  });
  it('a run whose ledger creator is another player or another key is run_creator_mismatch; the same creator is only already_dispatched', async () => {
    const ledger = createMemoryDispatchLedger();
    const created = (over: Record<string, string>): DispatchRow => ({ phase: 'run_created', runId: RUN, creatorPlayerHash: sha(FOUNDER).slice(0, 16), creatorKeyHash: sha('key-0000001').slice(0, 16), uiActionUtc: UI_UTC, at: '2026-10-22T11:59:40.000Z', ...over });
    await ledger.append(created({ creatorPlayerHash: sha('someone-else').slice(0, 16) }));
    const h = harness({ ledger });
    expect(await h.controller.dispatch(input())).toMatchObject({ status: 403, code: 'julius_dispatch_run_creator_mismatch' });
    const other = createMemoryDispatchLedger();
    await other.append(created({ creatorKeyHash: sha('key-0000042').slice(0, 16) }));
    expect(await harness({ ledger: other }).controller.dispatch(input())).toMatchObject({ status: 403, code: 'julius_dispatch_run_creator_mismatch' });
    const same = createMemoryDispatchLedger();
    await same.append(created({}));
    expect(await harness({ ledger: same }).controller.dispatch(input())).toMatchObject({ status: 409, code: 'julius_dispatch_already_dispatched' });
    expect(h.calls).toHaveLength(0);
  });
  it('verifyRunOrdering fails a ledger whose order or times break UI-action < run_created <= pre_call <= result', () => {
    const base: DispatchRow[] = [
      { phase: 'run_created', runId: RUN, uiActionUtc: UI_UTC, at: '2026-10-22T12:00:01.000Z' },
      { phase: 'run_start', runId: RUN, at: '2026-10-22T12:00:01.000Z' },
      { phase: 'pre_call', runId: RUN, role: 'architect', at: '2026-10-22T12:00:02.000Z' },
      { phase: 'result', runId: RUN, role: 'architect', at: '2026-10-22T12:00:03.000Z' },
    ];
    expect(verifyRunOrdering(base, RUN)).toEqual({ ok: true });
    expect(verifyRunOrdering([base[1], base[0], base[2], base[3]], RUN)).toMatchObject({ ok: false });
    expect(verifyRunOrdering([base[0], base[1], { ...base[2], at: '2026-10-22T12:00:00.500Z' }, base[3]], RUN)).toMatchObject({ ok: false });
    expect(verifyRunOrdering([{ ...base[0], uiActionUtc: '2026-10-22T12:00:01.000Z' }, ...base.slice(1)], RUN)).toMatchObject({ ok: false });
    expect(verifyRunOrdering([base[0], base[1], base[3], base[2]], RUN)).toMatchObject({ ok: false });
    expect(verifyRunOrdering(base.slice(1), RUN)).toMatchObject({ ok: false });
  });
});

describe('Part 2: bridge echo and clock offset (REQUIRED in live, optional in code)', () => {
  const fakeH = (over: Parameters<typeof harness>[0] = {}) => harness({ mode: 'fake', env: { JULIUS_J1_DAILY_CAP: '2' }, ...over });
  /** Same harness with the three adapters flipped to real (fake:false): the controller derives mode live. No provider is ever reached in these tests. */
  const liveH = (over: Parameters<typeof harness>[0] = {}) => {
    const h = harness({ mode: 'live', env: { JULIUS_J1_DAILY_CAP: '5' }, ...over });
    for (const role of ['architect', 'coder', 'reviewer'] as const) (h.providers[role] as { fake: boolean }).fake = false;
    return h;
  };
  const echoOf = (h: Harness): { bridgeUtc: string; echoId: string } => {
    const e = h.controller.issueEcho({ projectId: PROJECT, callerPlayerId: FOUNDER });
    if (!e.ok) throw new Error('echo refused');
    return { bridgeUtc: e.bridgeUtc, echoId: e.echoId };
  };

  it('issueEcho returns the bridge UTC (ISO) and an opaque nonce, founder and project only, and a kill switch off issues nothing', () => {
    const h = fakeH();
    const e = echoOf(h);
    expect(e.bridgeUtc).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/u);
    expect(e.echoId.length).toBeGreaterThanOrEqual(16);
    expect(echoOf(h).echoId).not.toBe(e.echoId);
    expect(h.controller.issueEcho({ projectId: PROJECT, callerPlayerId: 'someone' })).toMatchObject({ ok: false, status: 403, code: 'julius_dispatch_founder_only' });
    expect(h.controller.issueEcho({ projectId: 'proj-9', callerPlayerId: FOUNDER })).toMatchObject({ ok: false, status: 403, code: 'julius_dispatch_wrong_project' });
    const off = harness({ env: { JULIUS_J1_ENABLED: '0' } });
    expect(off.controller.issueEcho({ projectId: PROJECT, callerPlayerId: FOUNDER })).toMatchObject({ ok: false, status: 503, code: 'julius_dispatch_disabled' });
  });
  it('a valid echo and an offset within +-1000 ms dispatches, and run_created records clientOffsetMs and echoId', async () => {
    const h = liveH();
    const e = echoOf(h);
    expect(await h.controller.dispatch(input({ clientOffsetMs: -1000, echoId: e.echoId }))).toMatchObject({ ok: true, status: 202 });
    await h.controller.whenIdle();
    expect((await rowsOf(h)).find((r) => r.phase === 'run_created')).toMatchObject({ clientOffsetMs: -1000, echoId: e.echoId });
  });
  it('|offset| > 1000 is 409 julius_dispatch_clock_offset_out_of_range, recorded REFUSED, no provider call, and counts against the daily cap', async () => {
    const h = fakeH();
    for (const [i, off] of [1001, -1001].entries()) {
      const e = echoOf(h);
      expect(await h.controller.dispatch(input({ runId: `run:r${i}`, idempotencyKey: `key-000000${i + 1}`, clientOffsetMs: off, echoId: e.echoId }))).toMatchObject({ ok: false, status: 409, code: 'julius_dispatch_clock_offset_out_of_range' });
    }
    const rows = await rowsOf(h);
    expect(rows.filter((r) => r.phase === 'run_refused')).toHaveLength(2);
    expect(rows.find((r) => r.phase === 'run_refused')).toMatchObject({ status: 'REFUSED', code: 'julius_dispatch_clock_offset_out_of_range', clientOffsetMs: 1001 });
    expect(rows.some((r) => r.phase === 'run_start' || r.phase === 'run_created')).toBe(false);
    expect(h.calls).toHaveLength(0);
    const e3 = echoOf(h);
    expect(await h.controller.dispatch(input({ runId: 'run:r3', idempotencyKey: 'key-0000003', clientOffsetMs: 0, echoId: e3.echoId }))).toMatchObject({ ok: false, status: 429, code: 'julius_dispatch_cap_reached' });
    expect(h.calls).toHaveLength(0);
  });
  it('an unknown, expired or reused echoId is 409 julius_dispatch_clock_echo_unknown, recorded REFUSED, no provider call; the echo lives 120 s', async () => {
    const h = fakeH();
    expect(await h.controller.dispatch(input({ clientOffsetMs: 0, echoId: 'never-issued-0000000000' }))).toMatchObject({ ok: false, status: 409, code: 'julius_dispatch_clock_echo_unknown' });
    expect((await rowsOf(h)).filter((r) => r.phase === 'run_refused')).toHaveLength(1);
    const used = fakeH({ env: { JULIUS_J1_DAILY_CAP: '5' } });
    const e = echoOf(used);
    expect(await used.controller.dispatch(input({ clientOffsetMs: 0, echoId: e.echoId }))).toMatchObject({ ok: true });
    await used.controller.whenIdle();
    expect(await used.controller.dispatch(input({ runId: 'run:2', idempotencyKey: 'key-0000002', clientOffsetMs: 0, echoId: e.echoId }))).toMatchObject({ ok: false, status: 409, code: 'julius_dispatch_clock_echo_unknown' });
    /* the harness clock advances 1 s per reading: issue an echo, then burn more than 120 readings */
    const old = fakeH({ env: { JULIUS_J1_DAILY_CAP: '5' } });
    const oe = echoOf(old);
    for (let i = 0; i < 130; i += 1) old.controller.issueEcho({ projectId: PROJECT, callerPlayerId: FOUNDER });
    expect(await old.controller.dispatch(input({ clientOffsetMs: 0, echoId: oe.echoId }))).toMatchObject({ ok: false, status: 409, code: 'julius_dispatch_clock_echo_unknown' });
    expect(h.calls).toHaveLength(0);
    expect(old.calls).toHaveLength(0);
  });
  it('an offset-out-of-range request consumes its echo (it cannot be retried with the same echo)', async () => {
    const h = fakeH({ env: { JULIUS_J1_DAILY_CAP: '5' } });
    const e = echoOf(h);
    await h.controller.dispatch(input({ clientOffsetMs: 5000, echoId: e.echoId }));
    expect(await h.controller.dispatch(input({ clientOffsetMs: 0, echoId: e.echoId }))).toMatchObject({ ok: false, code: 'julius_dispatch_clock_echo_unknown' });
  });
  it('LIVE requires both fields (missing or non-numeric offset, missing echo: refused, recorded, no call); the fake label does not require them', async () => {
    const live = liveH();
    const e = echoOf(live);
    expect(await live.controller.dispatch(input({ echoId: e.echoId }))).toMatchObject({ ok: false, status: 400, code: 'julius_dispatch_clock_binding_required' });
    expect(await live.controller.dispatch(input({ runId: 'run:b', idempotencyKey: 'key-0000002', clientOffsetMs: 0 }))).toMatchObject({ ok: false, status: 400, code: 'julius_dispatch_clock_binding_required' });
    expect(await live.controller.dispatch(input({ runId: 'run:c', idempotencyKey: 'key-0000003', clientOffsetMs: Number.NaN, echoId: e.echoId }))).toMatchObject({ ok: false, status: 400, code: 'julius_dispatch_clock_binding_required' });
    expect((await rowsOf(live)).filter((r) => r.phase === 'run_refused')).toHaveLength(3);
    expect(live.calls).toHaveLength(0);
    const fake = fakeH({ env: { JULIUS_J1_DAILY_CAP: '5' } });
    expect(await fake.controller.dispatch(input())).toMatchObject({ ok: true });
  });
  it('the route: GET /echo is loopback, paired and founder-only like the other GETs, and POST passes clientOffsetMs and echoId through', async () => {
    const h = fakeH({ env: { JULIUS_J1_DAILY_CAP: '5' } });
    const TOK = { founder: { playerId: FOUNDER, projectId: PROJECT, sessionId: 'sess-1' } } as Record<string, { playerId: string; projectId: string; sessionId: string }>;
    const ports = { dispatch: h.controller, verifyNativeSession: ({ token }: { token: string }) => TOK[token] ?? null };
    const req = (over: Partial<JuliusDispatchRouteRequest> = {}): JuliusDispatchRouteRequest => ({
      method: 'GET', path: '/wonderland/julius/dispatch/echo', url: `/wonderland/julius/dispatch/echo?projectId=${PROJECT}`,
      authorization: 'Relay-Session founder', origin: undefined, rawBody: undefined, idempotencyKey: undefined, now: 1,
      operatorToken: 'operator-secret-value', remoteAddress: '127.0.0.1', host: '127.0.0.1:8787', forwarded: false, ...over,
    });
    expect(isJuliusDispatchRoute('/wonderland/julius/dispatch/echo')).toBe(true);
    const res = await handleJuliusDispatchRoute(req(), ports);
    expect(res.status).toBe(200);
    const data = (res.body as { data: { bridgeUtc: string; echoId: string } }).data;
    expect(Object.keys(data).sort()).toEqual(['bridgeUtc', 'echoId']);
    expect((await handleJuliusDispatchRoute(req({ remoteAddress: '10.0.0.5' }), ports)).status).toBe(403);
    expect((await handleJuliusDispatchRoute(req({ authorization: undefined }), ports)).status).toBe(401);
    expect((await handleJuliusDispatchRoute(req({ method: 'POST' }), ports)).status).toBe(405);
    const post = await handleJuliusDispatchRoute(req({
      method: 'POST', path: '/wonderland/julius/dispatch', url: `/wonderland/julius/dispatch?projectId=${PROJECT}`, idempotencyKey: 'key-0000001',
      rawBody: JSON.stringify({ runId: RUN, clientTriggerId: 'trig-00000001', clientLogSha256: sha('client line'), clientUiActionUtc: UI_UTC, clientOffsetMs: 12, echoId: data.echoId }),
    }), ports);
    expect(post.status).toBe(202);
    await h.controller.whenIdle();
    expect((await rowsOf(h)).find((r) => r.phase === 'run_created')).toMatchObject({ clientOffsetMs: 12, echoId: data.echoId });
    const bad = await handleJuliusDispatchRoute(req({
      method: 'POST', path: '/wonderland/julius/dispatch', url: `/wonderland/julius/dispatch?projectId=${PROJECT}`, idempotencyKey: 'key-0000002',
      rawBody: JSON.stringify({ runId: 'run:x', clientTriggerId: 'trig-00000001', clientLogSha256: sha('client line'), clientUiActionUtc: UI_UTC, clientOffsetMs: 'twelve', echoId: 7 }),
    }), ports);
    expect(bad.status).toBe(400);
  });
});

describe('J1 file ledger', () => {
  const dirs: string[] = [];
  const fresh = (): string => { const d = mkdtempSync(join(tmpdir(), 'j1-ledger-')); dirs.push(d); return join(d, 'ledger.jsonl'); };
  afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

  it('persists rows, and a restart on the same file still refuses the run and the mission cap', async () => {
    const file = fresh();
    const a = createFileDispatchLedger({ file });
    const h = harness({ ledger: a });
    await h.controller.dispatch(input());
    await h.controller.whenIdle();
    a.close();
    const b = createFileDispatchLedger({ file });
    const h2 = harness({ ledger: b, env: { JULIUS_J1_DAILY_CAP: '10' } });
    expect(await h2.controller.dispatch(input())).toMatchObject({ status: 409, code: 'julius_dispatch_already_dispatched' });
    expect(await h2.controller.dispatch(input({ runId: 'run:2', idempotencyKey: 'key-0000002' }))).toMatchObject({ ok: true });
    await h2.controller.whenIdle();
    expect(await h2.controller.dispatch(input({ runId: 'run:3', idempotencyKey: 'key-0000003' }))).toMatchObject({ code: 'julius_dispatch_mission_cap_reached' });
    b.close();
    const lines = readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as DispatchRow);
    expect(lines.filter((r) => r.phase === 'run_start')).toHaveLength(2);
    for (const key of Object.values(KEYS)) expect(readFileSync(file, 'utf8')).not.toContain(key);
  });

  it('refuses to open a file with a corrupt or unterminated line', () => {
    const file = fresh();
    writeFileSync(file, '{"phase":"run_start"}\nnot json\n');
    expect(() => createFileDispatchLedger({ file })).toThrow(/refusing to open/);
    writeFileSync(file, '{"phase":"run_start"}');
    expect(() => createFileDispatchLedger({ file })).toThrow(/unterminated/);
  });

  it('a closed file ledger rejects appends, so dispatch refuses instead of running unrecorded', async () => {
    const file = fresh();
    const a = createFileDispatchLedger({ file });
    a.close();
    const h = harness({ ledger: a });
    expect(await h.controller.dispatch(input())).toMatchObject({ status: 503, code: 'julius_dispatch_ledger_unavailable' });
    expect(h.calls).toHaveLength(0);
  });
});

describe('J1 HTTP edge', () => {
  const TOKENS: Record<string, { playerId: string; projectId: string; sessionId: string }> = {
    founder: { playerId: FOUNDER, projectId: PROJECT, sessionId: 'sess-1' },
    other: { playerId: 'someone-else', projectId: PROJECT, sessionId: 'sess-9' },
    elsewhere: { playerId: FOUNDER, projectId: 'proj-2', sessionId: 'sess-3' },
  };
  const ports = (h: Harness) => ({ dispatch: h.controller, verifyNativeSession: ({ token }: { token: string }) => TOKENS[token] ?? null });
  const body = (over: Record<string, unknown> = {}): string => JSON.stringify({ runId: RUN, clientTriggerId: 'trig-00000001', clientLogSha256: sha('client line'), clientUiActionUtc: UI_UTC, ...over });
  const post = (over: Partial<JuliusDispatchRouteRequest> = {}): JuliusDispatchRouteRequest => ({
    method: 'POST', path: '/wonderland/julius/dispatch', url: `/wonderland/julius/dispatch?projectId=${PROJECT}`,
    authorization: 'Relay-Session founder', origin: undefined, rawBody: body(), idempotencyKey: 'key-0000001', now: 1,
    operatorToken: 'operator-secret-value', remoteAddress: '127.0.0.1', host: '127.0.0.1:8787', forwarded: false, ...over,
  });

  it('loopback: accepts 127.0.0.1, ::1, ::ffff:127.0.0.1 with a loopback Host; refuses everything else before any provider', async () => {
    expect(isLoopbackPeer('127.0.0.1', '127.0.0.1:8787', false)).toBe(true);
    expect(isLoopbackPeer('::1', '[::1]:8787', false)).toBe(true);
    expect(isLoopbackPeer('::ffff:127.0.0.1', 'localhost:8787', false)).toBe(true);
    for (const over of [
      { remoteAddress: '10.0.0.5' }, { remoteAddress: '192.168.1.20' }, { remoteAddress: '0.0.0.0' }, { remoteAddress: undefined },
      { host: 'relay.example.com' }, { host: undefined }, { host: '127.0.0.1.evil.test' }, { forwarded: true },
    ]) {
      const h = harness();
      const res = await handleJuliusDispatchRoute(post(over), ports(h));
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ error: { kind: 'julius_dispatch_not_loopback' } });
      expect(h.calls).toHaveLength(0);
      expect(await rowsOf(h)).toHaveLength(0);
    }
    // reads are loopback-only too
    const h = harness();
    const read = await handleJuliusDispatchRoute(post({ method: 'GET', path: '/wonderland/julius/dispatch/result', url: `/wonderland/julius/dispatch/result?projectId=${PROJECT}&runId=${RUN}`, remoteAddress: '10.0.0.5' }), ports(h));
    expect(read.status).toBe(403);
  });

  it('happy path over the route: 202, then events and result through the GETs, with the client-visible hashes', async () => {
    const h = harness();
    const res = await handleJuliusDispatchRoute(post(), ports(h));
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ data: { runId: RUN, dispatchId: 'disp_1', state: 'ACCEPTED', replayed: false, ledgerRef: 'julius-j1-ledger:disp_1' } });
    await h.controller.whenIdle();
    const get = (path: string, extra = ''): Promise<{ status: number; body: unknown }> =>
      handleJuliusDispatchRoute(post({ method: 'GET', path, url: `${path}?projectId=${PROJECT}&runId=${encodeURIComponent(RUN)}${extra}`, rawBody: undefined, idempotencyKey: undefined }), ports(h));
    const events = await get('/wonderland/julius/dispatch/events', '&cursor=0&mode=page');
    expect(events.status).toBe(200);
    expect((events.body as { data: { terminal: boolean; state: string } }).data).toMatchObject({ terminal: true, state: 'COMPLETED' });
    const result = await get('/wonderland/julius/dispatch/result');
    const data = (result.body as { data: { resultText: string; resultSha256: string } }).data;
    expect(sha(data.resultText)).toBe(data.resultSha256);
    expect((await get('/wonderland/julius/dispatch/events', '&cursor=-1')).status).toBe(400);
    expect((await get('/wonderland/julius/dispatch/events', '&cursor=1.5')).status).toBe(400);
  });

  it('the operator bearer, a browser origin and a missing or unknown session can never dispatch', async () => {
    for (const [over, status, kind] of [
      [{ authorization: 'Bearer operator-secret-value' }, 403, 'julius_dispatch_operator_is_not_the_game'],
      [{ origin: 'https://iwonderlabs.com' }, 403, 'julius_dispatch_browser_refused'],
      [{ authorization: undefined }, 401, 'sign_in_required'],
      [{ authorization: 'Relay-Session nobody' }, 401, 'sign_in_required'],
    ] as const) {
      const h = harness();
      const res = await handleJuliusDispatchRoute(post(over), ports(h));
      expect(res.status).toBe(status);
      expect(res.body).toMatchObject({ error: { kind } });
      expect(h.calls).toHaveLength(0);
      expect(await rowsOf(h)).toHaveLength(0);
    }
  });

  it('a session paired for another project, or another player, is refused', async () => {
    const h = harness();
    expect((await handleJuliusDispatchRoute(post({ authorization: 'Relay-Session elsewhere' }), ports(h))).status).toBe(403);
    const other = await handleJuliusDispatchRoute(post({ authorization: 'Relay-Session other' }), ports(h));
    expect(other).toMatchObject({ status: 403, body: { error: { kind: 'julius_dispatch_founder_only' } } });
    expect(h.calls).toHaveLength(0);
  });

  it('kill switch off refuses the dispatch route even for the paired founder', async () => {
    const h = harness({ env: { JULIUS_J1_ENABLED: undefined } });
    const res = await handleJuliusDispatchRoute(post(), ports(h));
    expect(res).toMatchObject({ status: 503, body: { error: { kind: 'julius_dispatch_disabled' } } });
    expect(await rowsOf(h)).toHaveLength(0);
  });

  it('no client log binding, no dispatch: missing or malformed clientLogSha256 / clientTriggerId / key / runId', async () => {
    for (const over of [
      { rawBody: body({ clientLogSha256: undefined }) }, { rawBody: body({ clientLogSha256: 'abc' }) }, { rawBody: body({ clientLogSha256: sha('x').toUpperCase() }) },
      { rawBody: body({ clientTriggerId: 'short' }) }, { rawBody: body({ clientUiActionUtc: undefined }) }, { rawBody: body({ clientUiActionUtc: 'yesterday' }) }, { rawBody: body({ runId: '../x' }) }, { rawBody: 'not json' }, { rawBody: undefined },
      { idempotencyKey: undefined }, { idempotencyKey: 'k' },
    ]) {
      const h = harness();
      const res = await handleJuliusDispatchRoute(post(over), ports(h));
      expect(res.status).toBe(400);
      expect(h.calls).toHaveLength(0);
      expect(await rowsOf(h)).toHaveLength(0);
    }
  });

  it('a second concurrent dispatch over the route is 429 busy', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const h = harness({ behave: { architect: async () => { await gate; return { ok: true, text: 'plan', responseId: 'resp_a', model: 'm' }; } } });
    expect((await handleJuliusDispatchRoute(post(), ports(h))).status).toBe(202);
    const second = await handleJuliusDispatchRoute(post({ rawBody: body({ runId: 'run:second' }), idempotencyKey: 'key-0000002' }), ports(h));
    expect(second).toMatchObject({ status: 429, body: { error: { kind: 'julius_dispatch_busy' } } });
    release();
    await h.controller.whenIdle();
  });

  it('another player cannot read a run they did not dispatch; an unknown run is 404 and an unfinished result 409', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const h = harness({ behave: { architect: async () => { await gate; return { ok: true, text: 'plan', responseId: 'resp_a', model: 'm' }; } } });
    await handleJuliusDispatchRoute(post(), ports(h));
    const read = (token: string, runId: string, path = '/wonderland/julius/dispatch/result'): Promise<{ status: number; body: unknown }> =>
      handleJuliusDispatchRoute(post({ method: 'GET', path, url: `${path}?projectId=${PROJECT}&runId=${encodeURIComponent(runId)}`, authorization: `Relay-Session ${token}`, rawBody: undefined }), ports(h));
    expect((await read('founder', RUN)).status).toBe(409);
    expect((await read('founder', 'run:nope')).status).toBe(404);
    expect((await read('other', RUN, '/wonderland/julius/dispatch/events')).status).toBe(404);
    release();
    await h.controller.whenIdle();
    expect((await read('founder', RUN)).status).toBe(200);
  });
});

describe('Part A: the served-model allow-list is checked by the CONTROLLER for every role', () => {
  const okCoder = (model: string): Behaviour => () => ({ ok: true, text: 'art', responseId: 'resp_c_0011223344', model, usage: { input: 11, output: 22, total: 33 }, requests: 2, changedPaths: 1 });
  const lastResult = async (h: Harness, role: string): Promise<DispatchRow> => (await h.ledger.rows()).filter((r) => r.phase === 'result' && r.role === role)[0]!;
  const strict = (h: Harness, role: 'architect' | 'coder' | 'reviewer', allow?: readonly string[]): void => {
    (h.providers[role] as { servedModelAllow?: readonly string[] }).servedModelAllow = allow;
  };

  it('architect: an echoed model outside the role list fails the leg, keeping id, model, usage and requests in the result row', async () => {
    const h = harness({ behave: { architect: () => ({ ok: true, text: 'plan', responseId: 'resp_a_0011223344', model: 'gpt-other', usage: { input: 5, output: 6, total: 11 }, requests: 1 }) } });
    strict(h, 'architect', ['gpt-fake']);
    await h.controller.dispatch(input());
    await h.controller.whenIdle();
    expect(h.calls.map((c) => c.role)).toEqual(['architect']);
    expect(await lastResult(h, 'architect')).toMatchObject({ outcome: 'served_model_mismatch', providerResponseId: 'resp_a_0011223344', model: 'gpt-other', usage: { input: 5, output: 6, total: 11 }, requests: 1, spend: 'usage_reported' });
  });

  it('coder: an echoed model outside the role list fails the leg and the chain stops before the reviewer', async () => {
    const h = harness({ behave: { coder: okCoder('claude-surprise') } });
    strict(h, 'coder', ['claude-fake']);
    await h.controller.dispatch(input());
    await h.controller.whenIdle();
    expect(h.calls.map((c) => c.role)).toEqual(['architect', 'coder']);
    expect(await lastResult(h, 'coder')).toMatchObject({ outcome: 'served_model_mismatch', providerResponseId: 'resp_c_0011223344', model: 'claude-surprise', usage: { input: 11, output: 22, total: 33 }, requests: 2 });
    const r = await h.controller.result({ projectId: PROJECT, runId: RUN, callerPlayerId: FOUNDER });
    expect(JSON.stringify(r)).toContain('coder_served_model_mismatch');
  });

  it('reviewer: an echoed model outside the role list fails the leg (the controller check, independent of the adapter)', async () => {
    const h = harness({ behave: { reviewer: () => ({ ok: true, text: 'fine', responseId: 'resp_r_0011223344', model: 'grok-other', verdict: 'approve', usage: { input: 1, output: 2, total: 3 }, requests: 1 }) } });
    strict(h, 'reviewer', ['grok-fake']);
    await h.controller.dispatch(input());
    await h.controller.whenIdle();
    expect(await lastResult(h, 'reviewer')).toMatchObject({ outcome: 'served_model_mismatch', model: 'grok-other', usage: { input: 1, output: 2, total: 3 } });
  });

  it('with no list the default is exactly [requested model]: strict equality, never loosened implicitly', async () => {
    const h = harness({ behave: { architect: () => ({ ok: true, text: 'plan', responseId: 'resp_a_0011223344', model: 'gpt-fake-20260101' }) } });
    strict(h, 'architect', undefined);
    await h.controller.dispatch(input());
    await h.controller.whenIdle();
    expect(await lastResult(h, 'architect')).toMatchObject({ outcome: 'served_model_mismatch' });
    const same = harness({ behave: { architect: () => ({ ok: true, text: 'plan', responseId: 'resp_a_0011223344', model: 'gpt-fake' }) } });
    strict(same, 'architect', undefined);
    await same.controller.dispatch(input());
    await same.controller.whenIdle();
    expect(await lastResult(same, 'architect')).toMatchObject({ outcome: 'ok' });
  });

  it('an alias is accepted only when it is listed by name', async () => {
    const alias = 'claude-fake-20260101';
    const listed = harness({ behave: { coder: okCoder(alias) } });
    strict(listed, 'coder', ['claude-fake', alias]);
    await listed.controller.dispatch(input());
    await listed.controller.whenIdle();
    expect(await lastResult(listed, 'coder')).toMatchObject({ outcome: 'ok', model: alias });
    const unlisted = harness({ behave: { coder: okCoder(alias) } });
    strict(unlisted, 'coder', ['claude-fake']);
    await unlisted.controller.dispatch(input());
    await unlisted.controller.whenIdle();
    expect(await lastResult(unlisted, 'coder')).toMatchObject({ outcome: 'served_model_mismatch' });
  });
});

describe('C2: the brief hash equals the frozen contract hash, is recorded in run_start, and a mismatch refuses before any provider call', () => {
  const withBrief = (briefSha256: string | undefined, mode: 'fake' | 'live' = 'fake'): Harness => {
    const h = harness();
    if (mode === 'live') for (const role of ['architect', 'coder', 'reviewer'] as const) (h.providers[role] as { fake: boolean }).fake = false;
    const ids = (() => { let n = 0; return () => `disp_${(n += 1)}`; })();
    let clock = Date.parse('2026-10-22T12:00:00Z');
    const controller = createJuliusDispatch({
      providers: h.providers, ledger: h.ledger, mode, env: () => h.env, now: () => (clock += 1000), newId: ids, frozen: FROZEN,
      ...(briefSha256 === undefined ? {} : { briefSha256 }),
      checker: { check: async () => ({ pass: true }) },
      runs: { lookup: async () => ({ missionId: FROZEN.missionId, contractSha256: FROZEN.contractSha256, state: 'READY' }) },
    });
    return { ...h, controller };
  };

  it('a matching brief hash is recorded in the run_start row', async () => {
    const h = withBrief(FROZEN.contractSha256);
    expect(await h.controller.dispatch(input())).toMatchObject({ ok: true });
    await h.controller.whenIdle();
    expect((await rowsOf(h)).find((r) => r.phase === 'run_start')).toMatchObject({ briefSha256: FROZEN.contractSha256, contractSha256: FROZEN.contractSha256 });
  });

  it('a different brief hash refuses with no ledger row and no provider call', async () => {
    const h = withBrief(sha('some other brief'));
    expect(await h.controller.dispatch(input())).toMatchObject({ ok: false, status: 503, code: 'julius_dispatch_brief_not_frozen_contract' });
    await h.controller.whenIdle();
    expect(h.calls).toHaveLength(0);
    expect(await rowsOf(h)).toHaveLength(0);
  });

  it('live mode with no brief hash at all refuses (no implicit default); fake mode may omit it', async () => {
    const live = withBrief(undefined, 'live');
    expect(await live.controller.dispatch(input())).toMatchObject({ ok: false, code: 'julius_dispatch_brief_not_frozen_contract' });
    expect(live.calls).toHaveLength(0);
    const fake = withBrief(undefined, 'fake');
    expect(await fake.controller.dispatch(input())).toMatchObject({ ok: true });
    await fake.controller.whenIdle();
  });
});

describe('R3 the KeyStore is REQUIRED in live mode (the controller itself refuses, before any ledger row or provider call)', () => {
  const live = (over: Parameters<typeof harness>[0] = {}) => {
    const h = harness({ mode: 'live', env: { JULIUS_J1_DAILY_CAP: '5' }, ...over });
    for (const role of ['architect', 'coder', 'reviewer'] as const) (h.providers[role] as { fake: boolean }).fake = false;
    return h;
  };
  const liveInput = (h: Harness) => { const e = h.controller.issueEcho({ projectId: PROJECT, callerPlayerId: FOUNDER }); if (!e.ok) throw new Error('echo'); return input({ clientBridgeUtcEcho: e.bridgeUtc, clientEchoId: e.echoId } as never); };
  it('derived live with NO keyStore dep: 503 julius_dispatch_key_store_required, zero ledger rows, zero provider calls', async () => {
    const h = live({ keyStore: null });
    const out = await h.controller.dispatch(liveInput(h));
    expect(out).toMatchObject({ ok: false, status: 503, code: 'julius_dispatch_key_store_required' });
    expect(await h.ledger.rows()).toEqual([]);
    expect(h.calls).toHaveLength(0);
  });
  it('the env key is NOT a fallback in live: the canary keys sit in the env and the refusal still happens', async () => {
    const h = live({ keyStore: null });
    expect(h.env.OPENAI_API_KEY).toBeDefined();
    expect(await h.controller.dispatch(liveInput(h))).toMatchObject({ code: 'julius_dispatch_key_store_required' });
  });
  it('derived live WITH a keyStore passes this gate (no key_store_required)', async () => {
    const h = live();
    const out = await h.controller.dispatch(liveInput(h));
    expect(out).not.toMatchObject({ code: 'julius_dispatch_key_store_required' });
  });
  it('fake mode keeps the legacy env read: no keyStore, the chain runs and reads the keys from the env', async () => {
    const h = harness();
    expect(await h.controller.dispatch(input())).toMatchObject({ ok: true, status: 202 });
    await h.controller.whenIdle();
    expect(h.calls.map((c) => c.role)).toEqual(['architect', 'coder', 'reviewer']);
  });
});
