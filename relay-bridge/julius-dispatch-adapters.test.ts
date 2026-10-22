import { describe, expect, it } from 'vitest';

import type { GptArchitectConfig, GptRunOutcome, GptRunRequest } from '../src/relay/connectors/gpt-architect';
import type { JuliusCodingAgentProvider, JuliusCodingAgentProviderOutcome, JuliusCodingAgentRequest } from '../src/relay/mission/julius/julius-coding-agent';
import type { JuliusApiIdentity, JuliusApiResult, JuliusRunView } from '../src/relay/mission/julius/julius-runtime-api';
import type { HermesConfig, HermesOutcome, ReviewPacket } from './hermes-reviewer';
import {
  composeRoleProviders, modelFamily, createArchitectRoleProvider, createCoderRoleProvider, createJuliusRunLookup, createReviewerRoleProvider,
  deriveCoderToolCalls, type CoderExecutorRecord,
} from './julius-dispatch-adapters';
import { createJuliusDispatch, createMemoryDispatchLedger, type FrozenMission, type RoleCallInput } from './julius-dispatch';
import type { ShellEffectInput, ShellEffectPort, ShellEffectResult } from './julius/executor-effects';

const canary = (name: string): string => ['canary', name, 'ZZ9', 'x7Q2m4k8w1'].join('_');
const KEY = { openai: canary('openai'), xai: canary('xai') };
const HEAD = 'a'.repeat(40);

const call = (over: Partial<RoleCallInput> = {}): RoleCallInput => ({
  role: 'architect', runId: 'run:1', dispatchId: 'disp_1', missionId: 'mission-1', apiKey: 'k', architectText: null, coderArtifact: null, ...over,
});

/* ----------------------------------------------------------------------------------------------- architect */

const gptConfig: GptArchitectConfig = { apiKeyPresent: true, model: 'gpt-requested', liveMode: true, maxOutputTokens: 4000, timeoutMs: 1000, unusable: [] };
const gptUsage = { inputTokens: 5, cachedInputTokens: null, outputTokens: 7, reasoningTokens: null, totalTokens: 12 };

describe('architect adapter', () => {
  it('wraps the runner: key, brief and instructions go in; the response id and the PROVIDER-echoed model come out', async () => {
    const seen: GptRunRequest[] = [];
    const provider = createArchitectRoleProvider({
      config: gptConfig, brief: 'BRIEF', keyEnv: 'OPENAI_API_KEY',
      run: async (request) => { seen.push(request); return { ok: true, actualModel: 'gpt-served', responseId: 'resp_abc123456789', status: 'completed', outputText: '{"plan":1}', usage: gptUsage } as GptRunOutcome; },
    });
    expect(provider).toMatchObject({ providerId: 'openai', model: 'gpt-requested', keyEnv: 'OPENAI_API_KEY', fake: false });
    const out = await provider.call(call({ apiKey: KEY.openai }));
    expect(out).toMatchObject({ ok: true, text: '{"plan":1}', responseId: 'resp_abc123456789', model: 'gpt-served', usage: { input: 5, output: 7, total: 12 }, requests: 1 });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ apiKey: KEY.openai, input: 'BRIEF' });
  });

  it('a failed call reports a class only, keeps a response id if the provider gave one, and never a message', async () => {
    const provider = createArchitectRoleProvider({
      config: gptConfig, brief: 'B', keyEnv: 'OPENAI_API_KEY',
      run: async () => ({ ok: false, failureClass: 'rate_limited', message: `leaked ${KEY.openai}`, responseId: 'resp_zz99887766' } as GptRunOutcome),
    });
    const out = await provider.call(call());
    expect(out).toMatchObject({ ok: false, failureClass: 'rate_limited', responseId: 'resp_zz99887766' });
    expect(JSON.stringify(out)).not.toContain(KEY.openai);
  });

  it('a thrown runner is provider_error; a non-live config or a missing model is refused at construction', async () => {
    const thrower = createArchitectRoleProvider({ config: gptConfig, brief: 'B', keyEnv: 'K', run: async () => { throw new Error(`boom ${KEY.openai}`); } });
    expect(await thrower.call(call())).toMatchObject({ ok: false, failureClass: 'provider_error', responseId: null });
    expect(() => createArchitectRoleProvider({ config: { ...gptConfig, liveMode: false }, brief: 'B', keyEnv: 'K' })).toThrow('architect_role_requires_live_config');
    expect(() => createArchitectRoleProvider({ config: { ...gptConfig, model: null }, brief: 'B', keyEnv: 'K' })).toThrow('architect_role_requires_live_config');
    expect(() => createArchitectRoleProvider({ config: gptConfig, brief: 'B', keyEnv: ' ' })).toThrow('architect_role_requires_key_env');
  });
});

/* ----------------------------------------------------------------------------------------------- coder */

interface ShellScript { readonly start?: ShellEffectResult; readonly close?: ShellEffectResult; readonly throwOn?: 'start' | 'close' }
function fakeShell(script: ShellScript = {}): ShellEffectPort & { readonly inputs: ShellEffectInput[] } {
  const inputs: ShellEffectInput[] = [];
  return {
    inputs,
    async run(input) {
      inputs.push(input);
      const isClose = input.invocationKey.endsWith(':status');
      if (script.throwOn === (isClose ? 'close' : 'start')) throw new Error('executor down');
      if (isClose) return script.close ?? { status: 'SUCCEEDED', exitCode: 0, stdout: ' M a.js\u0000?? b.js\u0000', stderr: '', invocationId: 'inv_close' };
      return script.start ?? { status: 'SUCCEEDED', exitCode: 0, stdout: `HEAD ${HEAD}\n`, stderr: '', invocationId: 'inv_start' };
    },
  };
}

function completed(over: { toolInvocations?: number | null; providerModel?: string | null; finalText?: string | null; responseId?: unknown } = {}): JuliusCodingAgentProviderOutcome {
  return {
    kind: 'completed',
    finalText: over.finalText === undefined ? '{"artifact":true}' : over.finalText,
    observation: {
      providerModel: over.providerModel === undefined ? 'claude-served' : over.providerModel, turns: 4,
      toolInvocations: over.toolInvocations === undefined ? 9 : over.toolInvocations, inputTokens: 100, outputTokens: 50,
      costUsdMicros: null, costBasis: 'NOT_APPLICABLE',
      diagnostics: { responseId: over.responseId === undefined ? 'session-0011223344' : over.responseId },
    },
  };
}
function fakeCoding(outcome: JuliusCodingAgentProviderOutcome | (() => never)): JuliusCodingAgentProvider & { readonly requests: JuliusCodingAgentRequest[] } {
  const requests: JuliusCodingAgentRequest[] = [];
  return { providerKind: 'fake-coding', requests, async execute(request) { requests.push(request); return typeof outcome === 'function' ? outcome() : outcome; } };
}
const coder = (provider: JuliusCodingAgentProvider, shell: ShellEffectPort, extra: { onExecutorRecord?: (r: CoderExecutorRecord) => void } = {}) =>
  createCoderRoleProvider({ provider, shell, projectId: 'proj-1', workerId: 'w-coder', workspacePath: '/work', brief: 'BRIEF', model: 'claude-requested', keyEnv: null, ...extra });

describe('coder adapter: toolCalls come from the executor record', () => {
  it('counts the paths the executor saw changed, not the session invocation count', async () => {
    const provider = fakeCoding(completed({ toolInvocations: 99 }));
    const shell = fakeShell();
    const records: CoderExecutorRecord[] = [];
    const out = await coder(provider, shell, { onExecutorRecord: (r) => records.push(r) }).call(call({ role: 'coder', architectText: 'PLAN' }));
    expect(out).toMatchObject({ ok: true, text: '{"artifact":true}', responseId: 'session-0011223344', model: 'claude-served', toolCalls: 2, usage: { input: 100, output: 50, total: 150 } });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ captured: true, changedPaths: 2, closeInvocationId: 'inv_close', startInvocationId: 'inv_start' });
    // Both executor steps went through the port, scoped to this run and dispatch.
    expect(shell.inputs.map((i) => i.invocationKey)).toEqual(['disp_1:coder:base', 'disp_1:coder:status']);
    expect(shell.inputs[0]).toMatchObject({ runId: 'run:1', projectId: 'proj-1', workerId: 'w-coder' });
  });

  it('a session that says it ran tools but left the workspace untouched reports ZERO', async () => {
    const out = await coder(fakeCoding(completed({ toolInvocations: 10 })), fakeShell({ close: { status: 'SUCCEEDED', exitCode: 0, stdout: '', stderr: '', invocationId: 'inv_c' } }))
      .call(call({ role: 'coder', architectText: 'PLAN' }));
    expect(out).toMatchObject({ ok: true, toolCalls: 0 });
  });

  it('a close-out the executor did not capture reports zero, whatever the session claims', async () => {
    const out = await coder(fakeCoding(completed({ toolInvocations: 10 })), fakeShell({ close: { status: 'FAILED', exitCode: 1, stdout: ' M a.js\u0000', stderr: '', invocationId: 'inv_c' } }))
      .call(call({ role: 'coder', architectText: 'PLAN' }));
    expect(out).toMatchObject({ ok: true, toolCalls: 0 });
  });

  it('deriveCoderToolCalls ignores uncaptured records', () => {
    const base: CoderExecutorRecord = { startInvocationId: null, closeInvocationId: 'i', captured: true, changedPaths: 3, baseTree: null, endTree: null };
    expect(deriveCoderToolCalls(base)).toBe(3);
    expect(deriveCoderToolCalls({ ...base, captured: false })).toBe(0);
  });

  it('a session that attests no model reports null, so the controller refuses the leg', async () => {
    const out = await coder(fakeCoding(completed({ providerModel: null })), fakeShell()).call(call({ role: 'coder', architectText: 'PLAN' }));
    expect(out).toMatchObject({ ok: true, model: null });
  });

  it('a failed session returns the provider failure class and runs no close-out', async () => {
    const shell = fakeShell();
    const provider = fakeCoding({ kind: 'failed', failure: 'TIMEOUT', runtimeStarted: true, costUsdMicros: null, safeMessage: 'x', providerFailureClass: 'coder_timed_out', diagnostics: { responseId: 'session-failed-1' } });
    const out = await coder(provider, shell).call(call({ role: 'coder', architectText: 'PLAN' }));
    expect(out).toMatchObject({ ok: false, failureClass: 'coder_timed_out', responseId: 'session-failed-1' });
    expect(shell.inputs.map((i) => i.invocationKey)).toEqual(['disp_1:coder:base']);
  });

  it('refuses without a plan, and refuses when the executor start or close is unavailable', async () => {
    const provider = fakeCoding(completed());
    expect(await coder(provider, fakeShell()).call(call({ role: 'coder' }))).toMatchObject({ ok: false, failureClass: 'architect_plan_absent' });
    expect(provider.requests).toHaveLength(0);
    expect(await coder(provider, fakeShell({ throwOn: 'start' })).call(call({ role: 'coder', architectText: 'P' }))).toMatchObject({ ok: false, failureClass: 'executor_start_unavailable' });
    expect(await coder(provider, fakeShell({ start: { status: 'FAILED', exitCode: 1, stdout: '', stderr: '', invocationId: 'i' } })).call(call({ role: 'coder', architectText: 'P' }))).toMatchObject({ ok: false, failureClass: 'executor_start_refused' });
    expect(provider.requests).toHaveLength(0);
    expect(await coder(provider, fakeShell({ throwOn: 'close' })).call(call({ role: 'coder', architectText: 'P' }))).toMatchObject({ ok: false, failureClass: 'executor_close_unavailable' });
  });

  it('the request carries the brief and plan, forbids commands and network, and is scoped to the workspace', async () => {
    const provider = fakeCoding(completed());
    await coder(provider, fakeShell()).call(call({ role: 'coder', architectText: 'THE PLAN' }));
    const request = provider.requests[0]!;
    expect(request).toMatchObject({ plan: 'THE PLAN', workspacePath: '/work', permissions: { mayRunCommands: false, mayUseNetwork: false }, identity: { runId: 'run:1', missionId: 'mission-1' } });
    expect(request.sections.missionContext[0]!.text).toBe('BRIEF');
  });
});

/* ----------------------------------------------------------------------------------------------- reviewer */

const hermesConfig: HermesConfig = { executable: 'hermes-fake', model: 'grok-requested', provider: 'xai', timeoutMs: 1000, maxOutputBytes: 1000 };
const usage = { inputTokens: 20, outputTokens: 30, totalTokens: 50, model: 'grok-served', apiCalls: 3, costMicros: null, currency: null, source: 'harness_reported' as const };
const reviewed = (verdict: 'approved' | 'changes_required' | 'unable_to_review', servedModel: string | null = 'grok-served'): HermesOutcome => ({
  kind: 'reviewed', result: { verdict, summary: 'SUMMARY', findings: [], requirementsChecked: [], parseRepaired: false },
  startedAt: 't0', completedAt: 't1', requestedModel: 'grok-requested', servedModel, provider: 'xai', diagnostics: {} as never, usage,
});
const reviewer = (run: (input: { packet: ReviewPacket; config: HermesConfig }) => Promise<HermesOutcome>, responseIdOf: () => string | null = () => 'xai-resp-0011223344') =>
  createReviewerRoleProvider({ config: hermesConfig, brief: 'BRIEF', keyEnv: 'XAI_API_KEY', responseIdOf, run: run as never });
const rcall = call({ role: 'reviewer', architectText: 'PLAN', coderArtifact: '{"artifact":true}' });

describe('reviewer adapter (xAI through Hermes)', () => {
  it('maps approved to approve and carries the injected response id, served model, tokens and the Hermes request count', async () => {
    const packets: ReviewPacket[] = [];
    const out = await reviewer(async ({ packet }) => { packets.push(packet); return reviewed('approved'); }).call(rcall);
    expect(out).toMatchObject({ ok: true, verdict: 'approve', responseId: 'xai-resp-0011223344', model: 'grok-served', usage: { input: 20, output: 30, total: 50 }, requests: 3 });
    expect(packets[0]).toMatchObject({ missionId: 'mission-1', handoffJson: 'PLAN', changedFileContents: '{"artifact":true}' });
  });

  it('changes_required is reject; unable_to_review is a failure, not a verdict', async () => {
    expect(await reviewer(async () => reviewed('changes_required')).call(rcall)).toMatchObject({ ok: true, verdict: 'reject' });
    expect(await reviewer(async () => reviewed('unable_to_review')).call(rcall)).toMatchObject({ ok: false, failureClass: 'reviewer_unable_to_review' });
  });

  it('the served model is never filled from the request, and a missing response id stays null', async () => {
    const out = await reviewer(async () => reviewed('approved', null), () => null).call(rcall);
    expect(out).toMatchObject({ ok: true, model: null, responseId: null });
    const blank = await reviewer(async () => reviewed('approved'), () => '  ').call(rcall);
    expect(blank).toMatchObject({ responseId: null });
    const thrown = await reviewer(async () => reviewed('approved'), () => { throw new Error('x'); }).call(rcall);
    expect(thrown).toMatchObject({ responseId: null });
  });

  it('incomplete and launch failures are classes only', async () => {
    const incomplete = { kind: 'review_incomplete', safeMessage: `m ${KEY.xai}`, shape: 'review_timeout', diagnostics: {}, startedAt: 'a', completedAt: 'b', usage } as unknown as HermesOutcome;
    const out = await reviewer(async () => incomplete).call(rcall);
    expect(out).toMatchObject({ ok: false, failureClass: 'review_timeout', responseId: null, requests: 3 });
    expect(JSON.stringify(out)).not.toContain(KEY.xai);
    expect(await reviewer(async () => ({ kind: 'launch_failed', safeMessage: 'x' })).call(rcall)).toMatchObject({ ok: false, failureClass: 'reviewer_launch_failed' });
    expect(await reviewer(async () => { throw new Error('x'); }).call(rcall)).toMatchObject({ ok: false, failureClass: 'provider_error' });
  });

  it('refuses without the plan or the artifact, and refuses a non-xai Hermes provider at construction', async () => {
    let ran = false;
    const r = reviewer(async () => { ran = true; return reviewed('approved'); });
    expect(await r.call(call({ role: 'reviewer', architectText: 'P' }))).toMatchObject({ ok: false, failureClass: 'review_inputs_absent' });
    expect(ran).toBe(false);
    expect(() => createReviewerRoleProvider({ config: { ...hermesConfig, provider: 'anthropic' }, brief: 'B', keyEnv: 'K', responseIdOf: () => null })).toThrow('reviewer_role_requires_xai_provider');
    expect(() => createReviewerRoleProvider({ config: { ...hermesConfig, model: undefined }, brief: 'B', keyEnv: 'K', responseIdOf: () => null })).toThrow('reviewer_role_requires_live_config');
  });
});

/* ----------------------------------------------------------------------------------------------- RunLookup */

const identity: JuliusApiIdentity = { tenantId: 't', projectId: 'proj-1', actorId: 'bridge', scopes: ['run:read'] };
const view = (over: Partial<JuliusRunView> = {}): JuliusRunView => ({
  runId: 'run:1', missionId: 'mission-1', state: 'READY', revision: 1, cardRevision: 'c', missionContractRevision: 1, projectBrainRevision: 1,
  taskCounts: {} as never, activeTasks: 0, pendingApprovals: 0, ...over,
});
const lookupWith = (result: JuliusApiResult<JuliusRunView>, sha: string | null = 'f'.repeat(64)) =>
  createJuliusRunLookup({ api: { inspectRun: async () => result }, identityFor: () => identity, contractSha256Of: async () => sha });

describe('RunLookup adapter', () => {
  it('reads mission id and state from inspectRun and the contract sha256 from the injected source', async () => {
    expect(await lookupWith({ ok: true, value: view() }).lookup({ projectId: 'proj-1', runId: 'run:1' })).toEqual({ missionId: 'mission-1', contractSha256: 'f'.repeat(64), state: 'READY' });
  });
  it('unknown run or another project is null; a lookup the identity cannot make throws', async () => {
    expect(await lookupWith({ ok: false, reason: 'run_not_found', safeMessage: '' }).lookup({ projectId: 'proj-1', runId: 'r' })).toBeNull();
    expect(await lookupWith({ ok: false, reason: 'not_authorized_for_project', safeMessage: '' }).lookup({ projectId: 'proj-1', runId: 'r' })).toBeNull();
    await expect(lookupWith({ ok: false, reason: 'scope_missing', safeMessage: '' }).lookup({ projectId: 'proj-1', runId: 'r' })).rejects.toThrow('run_lookup_scope_missing');
  });
  it('an unrecorded contract hash becomes an empty string, which the controller can never match', async () => {
    expect(await lookupWith({ ok: true, value: view() }, null).lookup({ projectId: 'proj-1', runId: 'r' })).toMatchObject({ contractSha256: '' });
  });
});

/* ----------------------------------------------------------------------------------------------- through the controller */

describe('composed through the J1 controller (fakes only)', () => {
  const sha = 'c'.repeat(64);
  const frozen: FrozenMission = { missionId: 'mission-1', contractSha256: sha, checkerSha256: 'd'.repeat(64), missionAuthor: 'a', checkerAuthor: 'b', seededDefect: false, preregId: 'p' };
  function run(responseIdOf: () => string | null, coderShell: ShellEffectPort = fakeShell()) {
    const providers = composeRoleProviders({
      architect: createArchitectRoleProvider({ config: gptConfig, brief: 'B', keyEnv: 'OPENAI_API_KEY', fake: true, run: async () => ({ ok: true, actualModel: 'gpt-served', responseId: 'resp_arch_0011223344', status: 'completed', outputText: 'PLAN', usage: gptUsage }) as GptRunOutcome }),
      coder: createCoderRoleProvider({ provider: fakeCoding(completed()), shell: coderShell, projectId: 'proj-1', workerId: 'w', workspacePath: '/w', brief: 'B', model: 'claude-requested', keyEnv: null, fake: true }),
      reviewer: createReviewerRoleProvider({ config: hermesConfig, brief: 'B', keyEnv: 'XAI_API_KEY', responseIdOf, fake: true, run: (async () => reviewed('approved')) as never }),
    });
    const env = { JULIUS_J1_ENABLED: '1', JULIUS_J1_FOUNDER_PLAYER_ID: 'founder', JULIUS_J1_PROJECT_ID: 'proj-1', JULIUS_J1_REVIEWER_PROVIDER: 'xai', JULIUS_J1_BUDGET_CAP_USD: '10', JULIUS_J1_LEG_ESTIMATE_USD: '1', OPENAI_API_KEY: KEY.openai, XAI_API_KEY: KEY.xai };
    let clock = Date.parse('2026-10-22T12:00:00Z');
    const ledger = createMemoryDispatchLedger();
    const controller = createJuliusDispatch({
      providers, ledger, mode: 'fake', env: () => env, now: () => (clock += 1000), frozen, checker: { check: async () => ({ pass: true }) },
      runs: createJuliusRunLookup({ api: { inspectRun: async () => ({ ok: true, value: view() }) }, identityFor: () => identity, contractSha256Of: async () => sha }),
    });
    return { controller, ledger };
  }
  const dispatchInput = { projectId: 'proj-1', runId: 'run:1', callerPlayerId: 'founder', sessionId: 's1', idempotencyKey: 'key-0000001', clientTriggerId: 'trig-00000001', clientLogSha256: 'e'.repeat(64) };

  it('completes, with a response id and a served model on every leg and the coder tool count from the executor', async () => {
    const h = run(() => 'xai-resp-0011223344');
    expect(await h.controller.dispatch(dispatchInput)).toMatchObject({ ok: true, status: 202 });
    await h.controller.whenIdle();
    const results = (await h.ledger.rows()).filter((r) => r.phase === 'result' && r.role !== 'final');
    expect(results.map((r) => [r.role, r.provider, r.outcome])).toEqual([['architect', 'openai', 'ok'], ['coder', 'anthropic', 'ok'], ['reviewer', 'xai', 'ok']]);
    for (const row of results) { expect(String(row.providerResponseId).length).toBeGreaterThan(8); expect(row.model).not.toBeNull(); }
    expect(results[1]).toMatchObject({ toolCalls: 2 });
    expect(results[2]).toMatchObject({ requests: 3 });
    expect((await h.ledger.rows()).find((r) => r.role === 'final')).toMatchObject({ state: 'COMPLETED' });
  });

  it('a reviewer leg with no response id is refused by the controller, so the chain cannot complete on it', async () => {
    const h = run(() => null);
    await h.controller.dispatch(dispatchInput);
    await h.controller.whenIdle();
    const rows = await h.ledger.rows();
    expect(rows.find((r) => r.phase === 'result' && r.role === 'reviewer')).toMatchObject({ outcome: 'response_identity_missing' });
    expect(rows.find((r) => r.role === 'final')).toMatchObject({ state: 'FAILED', failure: 'reviewer_response_identity_missing' });
  });

  it('a coder that changed nothing is refused as no_tool_execution', async () => {
    const h = run(() => 'xai-resp-0011223344', fakeShell({ close: { status: 'SUCCEEDED', exitCode: 0, stdout: '', stderr: '', invocationId: 'i' } }));
    await h.controller.dispatch(dispatchInput);
    await h.controller.whenIdle();
    expect((await h.ledger.rows()).find((r) => r.role === 'final')).toMatchObject({ state: 'FAILED', failure: 'coder_no_tool_execution' });
  });

  it('composeRoleProviders refuses duplicate independence groups and a fake/real mix', () => {
    const a = createArchitectRoleProvider({ config: gptConfig, brief: 'B', keyEnv: 'K', run: async () => { throw new Error('x'); } });
    const c = createCoderRoleProvider({ provider: fakeCoding(completed()), shell: fakeShell(), projectId: 'p', workerId: 'w', workspacePath: '/w', brief: 'B', model: 'm', keyEnv: null });
    expect(() => composeRoleProviders({ architect: a, coder: c, reviewer: { ...a } })).toThrow('role_providers_not_independent');
    const r = createReviewerRoleProvider({ config: hermesConfig, brief: 'B', keyEnv: 'K', responseIdOf: () => null, fake: true });
    expect(() => composeRoleProviders({ architect: a, coder: c, reviewer: r })).toThrow('role_providers_mixed_fake_and_real');

  });

  it('composeRoleProviders refuses three providers whose models share a family (provider AND model family)', () => {
    const a = createArchitectRoleProvider({ config: gptConfig, brief: 'B', keyEnv: 'K', run: async () => { throw new Error('x'); } });
    const same = createCoderRoleProvider({ provider: fakeCoding(completed()), shell: fakeShell(), projectId: 'p', workerId: 'w', workspacePath: '/w', brief: 'B', model: `${a.model}-other`, keyEnv: null });
    const r = createReviewerRoleProvider({ config: hermesConfig, brief: 'B', keyEnv: 'K', responseIdOf: () => null });
    expect(() => composeRoleProviders({ architect: a, coder: same, reviewer: r })).toThrow('role_models_not_independent_families');
    expect(modelFamily('GPT-5.6-sol')).toBe('gpt');
    expect(modelFamily('')).toBe('');
  });
});
