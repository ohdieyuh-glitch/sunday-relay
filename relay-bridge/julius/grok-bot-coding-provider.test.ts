import { describe, expect, it } from 'vitest';

import {
  GROK_BOT_CODER_CONFIG_DEFAULTS, GROK_BOT_CODER_PROVIDER_KIND, GROK_CODER_FOUNDER_AUTHORIZATION_TOKEN, GROK_CODER_REQUESTED_MODEL_UNATTESTED_EVIDENCE,
  createGrokBotCodingAgentProvider, createShellGrokBotWorkspacePort, grokBotCoderConfigRefusal, grokCoderAgentId, grokCoderIdempotencyKey,
  isSafeBranchName, isSundayRelayRepo,
  type CodingAgentCreateInput, type CodingAgentCreateOutcome, type CodingAgentPollOutcome, type CodingAgentResultOutcome, type CodingAgentTransport,
  type GrokBotCoderConfig, type GrokBotWorkspacePort,
} from './grok-bot-coding-provider';
import { juliusCodingAgentFailureDisposition, type JuliusCodingAgentProviderOutcome, type JuliusCodingAgentRequest } from '../../src/relay/mission/julius/julius-coding-agent';
import { juliusHandedOutcomeUnknown } from '../../src/relay/mission/julius/julius-execution-coordinator';
import { JuliusDispatchError } from '../../src/relay/mission/julius/julius-router';

/**
 * THE GROK BOT CODER, AGAINST A FAKE TRANSPORT AND A FAKE WORKSPACE. Nothing here reaches a network, a shell or a key.
 * Every value is fake; the model id `fake-grok-coder-1` is not a real Cursor id.
 */

const BASE = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const MODEL = 'fake-grok-coder-1';
const TARGET = 'https://github.com/example-org/example-target';

const request = (over: Partial<{ budget: number | null; permittedPaths: string[]; outOfScope: string[]; contextId: string }> = {}) => ({
  version: 'julius-coding-agent.v1',
  identity: { runId: 'run-1', missionId: 'mission-1', taskId: 'task-1', taskType: 'build', contextId: over.contextId ?? 'ctx-1' },
  workspacePath: '/workspace/mission', contract: null, plan: 'THE PLAN',
  sections: { acceptedGuidance: [], architecture: [], findings: [], continuation: [], missionContext: [] },
  permissions: { mayEditFiles: true, mayRunCommands: false, mayUseNetwork: false, permittedPaths: over.permittedPaths ?? ['src/'], outOfScope: over.outOfScope ?? [], prohibitedActions: [] },
  requiredEvidence: ['TEST'], budget: { usdMicros: over.budget === undefined ? 500_000 : over.budget }, protocol: { participation: 'ASK', researchAuthority: 'READ' },
}) as unknown as JuliusCodingAgentRequest;

const config = (over: Partial<GrokBotCoderConfig> = {}): GrokBotCoderConfig => ({
  ...GROK_BOT_CODER_CONFIG_DEFAULTS,
  pinnedModelId: MODEL, coderModelFamily: 'vendor-a', reviewerModelFamily: 'vendor-b', targetRepoUrl: TARGET, runDeadlineMs: 60_000,
  ...over,
});

const goodResult = (over: Partial<Extract<CodingAgentResultOutcome, { kind: 'result' }>> = {}): CodingAgentResultOutcome => ({
  kind: 'result', finalText: 'done', durationMs: 1234,
  branches: [{ repoUrl: 'github.com/example-org/example-target', branch: 'cursor/fix-1', prUrl: null }],
  usage: { inputTokens: 10, outputTokens: 5, cacheWriteTokens: 0, cacheReadTokens: 2, totalTokens: 17 },
  reportedModelId: MODEL, reportedModelSource: 'run.fake', ...over,
});

function fakeTransport(script: {
  create?: (input: CodingAgentCreateInput) => CodingAgentCreateOutcome;
  poll?: CodingAgentPollOutcome;
  result?: CodingAgentResultOutcome;
} = {}) {
  const calls = { create: [] as CodingAgentCreateInput[], poll: 0, result: 0, cancel: 0 };
  const transport: CodingAgentTransport = {
    transportKind: 'fake',
    async createRun(input) { calls.create.push(input); return script.create?.(input) ?? { kind: 'created', ref: { agentId: input.agentId, runId: 'run-x' } }; },
    async pollUntilTerminal() { calls.poll += 1; return script.poll ?? { kind: 'terminal', status: 'FINISHED', polls: 3 }; },
    async fetchResult() { calls.result += 1; return script.result ?? goodResult(); },
    async cancelRun() { calls.cancel += 1; return 'cancelled'; },
  };
  return { transport, calls };
}

function fakeWorkspace(over: Partial<{ changes: { path: string; change: 'MODIFIED' | 'ADDED' | 'DELETED' }[]; fetchOk: boolean; applyOk: boolean; baseOk: boolean }> = {}) {
  const calls = { fetch: 0, apply: 0 };
  const workspace: GrokBotWorkspacePort = {
    async baseRevision() { return over.baseOk === false ? { ok: false, cause: 'x' } : { ok: true, sha: BASE }; },
    async fetchBranch() { calls.fetch += 1; return over.fetchOk === false ? { ok: false, cause: 'fetch_failed' } : { ok: true, headSha: HEAD, changes: over.changes ?? [{ path: 'src/a.ts', change: 'MODIFIED' }] }; },
    async applyFetched() { calls.apply += 1; return over.applyOk === false ? { ok: false, cause: 'apply_failed' } : { ok: true }; },
  };
  return { workspace, calls };
}

const run = async (opts: { cfg?: GrokBotCoderConfig | null; t?: ReturnType<typeof fakeTransport>; w?: ReturnType<typeof fakeWorkspace>; req?: JuliusCodingAgentRequest; pin?: string; signal?: AbortSignal } = {}) => {
  const t = opts.t ?? fakeTransport();
  const w = opts.w ?? fakeWorkspace();
  const lines: string[] = [];
  const provider = createGrokBotCodingAgentProvider({
    config: opts.cfg === undefined ? config() : opts.cfg, transport: t.transport, workspace: w.workspace, now: () => 1_000, log: (l) => lines.push(l),
    ...(opts.pin === undefined ? {} : { founderAuthorizationPin: opts.pin }),
  });
  const outcome = await provider.execute(opts.req ?? request(), opts.signal);
  return { outcome, t, w, lines, provider };
};

const failed = (o: JuliusCodingAgentProviderOutcome) => { if (o.kind !== 'failed') throw new Error(`expected failed, got ${o.kind}`); return o; };
const completed = (o: JuliusCodingAgentProviderOutcome) => { if (o.kind !== 'completed') throw new Error(`expected completed, got ${o.kind}`); return o; };

/** What live-workers.ts does with a failed outcome, then what the coordinator decides about a handed dispatch. */
const coordinatorView = (o: JuliusCodingAgentProviderOutcome) => {
  const f = failed(o);
  const d = juliusCodingAgentFailureDisposition(f.failure);
  const err = new JuliusDispatchError(d.code, d.retryable, f.safeMessage, f.providerFailureClass, { ...f.diagnostics, runtimeStarted: f.runtimeStarted });
  return { code: d.code, retryable: d.retryable, handed: juliusHandedOutcomeUnknown(err, true) };
};

describe('the happy path', () => {
  it('creates once with the pinned model, polls, fetches the untrusted branch, applies it as a patch, and reports evidence', async () => {
    const { outcome, t, w } = await run();
    const c = completed(outcome);
    expect(t.calls.create).toHaveLength(1);
    expect(t.calls.create[0]?.modelId).toBe(MODEL);
    expect(t.calls.create[0]?.repoUrl).toBe(TARGET);
    expect(t.calls.create[0]?.startingRef).toBe(BASE);
    expect(w.calls).toEqual({ fetch: 1, apply: 1 });
    expect(c.observation.providerModel).toBe(MODEL);
    expect(c.observation.inputTokens).toBe(10);
    expect(c.observation.diagnostics).toMatchObject({
      codingAgentProvider: GROK_BOT_CODER_PROVIDER_KIND, servedModelVerdict: 'MATCH', patchApplied: true, agentBranch: 'cursor/fix-1', agentHeadSha: HEAD,
      inputTokens: 10, outputTokens: 5, totalTokens: 17, providerStatus: 'finished', createCalls: 1,
    });
  });

  it('records a PR url as untrusted and never acts on it', async () => {
    const { outcome } = await run({ t: fakeTransport({ result: goodResult({ branches: [{ repoUrl: 'github.com/example-org/example-target', branch: 'cursor/x', prUrl: 'https://github.com/example-org/example-target/pull/9' }] }) }) });
    expect(completed(outcome).observation.diagnostics).toMatchObject({ untrustedPrUrl: 'https://github.com/example-org/example-target/pull/9' });
  });
});

describe('cost: unknown is never $0', () => {
  it('a completed run is NOT_APPLICABLE, unverified, charged the full reservation; tokens are evidence only', async () => {
    const c = completed((await run()).outcome);
    expect(c.observation.costUsdMicros).toBeNull();
    expect(c.observation.costBasis).toBe('NOT_APPLICABLE');
    expect(c.observation.diagnostics).toMatchObject({ costBasis: 'NOT_APPLICABLE', billingPath: 'SUBSCRIPTION', spendVerified: false, chargedAs: 'FULL_RESERVATION' });
    expect(c.observation.diagnostics).not.toHaveProperty('executionCostUsdMicros');
  });

  it('zero recorded tokens still charge in full', async () => {
    const c = completed((await run({ t: fakeTransport({ result: goodResult({ usage: { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, totalTokens: 0 } }) }) })).outcome);
    expect(c.observation.costUsdMicros).not.toBe(0);
    expect(c.observation.diagnostics).toMatchObject({ usageAllZero: true, chargedAs: 'FULL_RESERVATION' });
  });

  it('a configured fixed reservation is the execution charge; zero is refused as configuration', async () => {
    const c = completed((await run({ cfg: config({ fixedPerAttemptReservationUsdMicros: 200_000 }) })).outcome);
    expect(c.observation.diagnostics).toMatchObject({ executionCostUsdMicros: 200_000, chargedAs: 'FIXED_PER_ATTEMPT_RESERVATION' });
    expect(grokBotCoderConfigRefusal(config({ fixedPerAttemptReservationUsdMicros: 0 }))?.providerFailureClass).toBe('coder_grok_config_fixed_reservation_invalid');
  });

  it('every failure after the create carries the full-charge facts', async () => {
    for (const t of [
      fakeTransport({ create: () => ({ kind: 'outcome_unknown', cause: 'network' }) }),
      fakeTransport({ poll: { kind: 'deadline', polls: 9 } }),
      fakeTransport({ poll: { kind: 'terminal', status: 'ERROR', polls: 1 } }),
      fakeTransport({ result: goodResult({ reportedModelId: null }) }),
    ]) {
      const f = failed((await run({ t })).outcome);
      expect(f.runtimeStarted).toBe(true);
      expect(f.costUsdMicros).not.toBe(0);
      expect(f.diagnostics).toMatchObject({ costBasis: 'NOT_APPLICABLE', spendVerified: false, chargedAs: 'FULL_RESERVATION' });
    }
  });
});

describe('failure mapping, in the existing vocabulary', () => {
  it('did-not-start (refused or rejected) is runtimeStarted:false, and a 429 is proven unprocessed', async () => {
    for (const create of [
      (): CodingAgentCreateOutcome => ({ kind: 'not_sent', cause: 'key_absent' }),
      (): CodingAgentCreateOutcome => ({ kind: 'rejected', status: 401, cause: 'authentication' }),
      (): CodingAgentCreateOutcome => ({ kind: 'rejected', status: 400, cause: 'invalid_request' }),
      (): CodingAgentCreateOutcome => ({ kind: 'rejected', status: 402, cause: 'credit' }),
    ]) {
      const f = failed((await run({ t: fakeTransport({ create }) })).outcome);
      expect(f.runtimeStarted).toBe(false);
      expect(coordinatorView(f).handed).toBeNull();
    }
    const limited = (await run({ t: fakeTransport({ create: () => ({ kind: 'rejected', status: 429, cause: 'rate_limited' }) }) })).outcome;
    expect(failed(limited).failure).toBe('RATE_LIMITED');
    expect(coordinatorView(limited)).toMatchObject({ code: 'RATE_LIMIT', retryable: true, handed: null });
  });

  it('a create that timed out after sending is HANDED_TIMEOUT_OUTCOME_UNKNOWN', async () => {
    const { outcome } = await run({ t: fakeTransport({ create: () => ({ kind: 'outcome_unknown', cause: 'timeout' }) }) });
    expect(failed(outcome)).toMatchObject({ failure: 'TIMEOUT', runtimeStarted: true, providerFailureClass: 'coder_grok_create_outcome_unknown' });
    expect(coordinatorView(outcome).handed).toBe('HANDED_TIMEOUT_OUTCOME_UNKNOWN');
  });

  it('any other unconfirmed create is HANDED_FAILURE_OUTCOME_UNKNOWN (FAIL_TASK:HANDED_OUTCOME_UNKNOWN), charged in full', async () => {
    for (const cause of ['network', 'server_error', 'malformed_response', 'aborted_in_flight'] as const) {
      const { outcome } = await run({ t: fakeTransport({ create: () => ({ kind: 'outcome_unknown', cause }) }) });
      expect(failed(outcome)).toMatchObject({ failure: 'INTERRUPTED', runtimeStarted: true });
      expect(failed(outcome).diagnostics).toMatchObject({ outcomeUnknown: true, chargedAs: 'FULL_RESERVATION' });
      expect(coordinatorView(outcome).handed).toBe('HANDED_FAILURE_OUTCOME_UNKNOWN');
    }
  });

  it('a run that passes its deadline is cancelled (best effort) and is a TIMEOUT, outcome unknown', async () => {
    const t = fakeTransport({ poll: { kind: 'deadline', polls: 12 } });
    const { outcome } = await run({ t });
    expect(t.calls.cancel).toBe(1);
    expect(failed(outcome)).toMatchObject({ failure: 'TIMEOUT', providerFailureClass: 'coder_timed_out' });
    expect(coordinatorView(outcome).handed).toBe('HANDED_TIMEOUT_OUTCOME_UNKNOWN');
  });

  it('terminal statuses map: ERROR→PROCESS_EXIT, EXPIRED→TIMEOUT, CANCELLED→CANCELLED; a lost poll is unknown', async () => {
    const f = async (poll: CodingAgentPollOutcome) => failed((await run({ t: fakeTransport({ poll }) })).outcome);
    expect((await f({ kind: 'terminal', status: 'ERROR', polls: 1 })).failure).toBe('PROCESS_EXIT');
    expect((await f({ kind: 'terminal', status: 'EXPIRED', polls: 1 })).failure).toBe('TIMEOUT');
    expect((await f({ kind: 'terminal', status: 'CANCELLED', polls: 1 })).failure).toBe('CANCELLED');
    expect((await f({ kind: 'poll_failed', cause: 'unexpected_status', polls: 1 })).diagnostics).toMatchObject({ outcomeUnknown: true });
    expect((await f({ kind: 'poll_failed', cause: 'authentication', polls: 1 })).failure).toBe('AUTHENTICATION');
  });

  it('an agentId conflict is never adopted: operator action, outcome unknown', async () => {
    const { outcome } = await run({ t: fakeTransport({ create: () => ({ kind: 'conflict', status: 409 }) }) });
    expect(failed(outcome)).toMatchObject({ failure: 'CONTINUATION_UNAVAILABLE', runtimeStarted: true, providerFailureClass: 'coder_grok_agent_id_conflict' });
    expect(juliusCodingAgentFailureDisposition('CONTINUATION_UNAVAILABLE').operatorAction).toBe(true);
  });

  it('an unreadable result is PARTIAL_RESPONSE; a bad patch is TOOL_CRASH', async () => {
    expect(failed((await run({ t: fakeTransport({ result: { kind: 'unavailable', cause: 'x' } }) })).outcome).failure).toBe('PARTIAL_RESPONSE');
    expect(failed((await run({ w: fakeWorkspace({ applyOk: false }) })).outcome).failure).toBe('TOOL_CRASH');
    expect(failed((await run({ w: fakeWorkspace({ fetchOk: false }) })).outcome).failure).toBe('TOOL_CRASH');
  });
});

describe('no retry after outcome-unknown: the create is called exactly once', () => {
  it.each(['timeout', 'network', 'server_error', 'malformed_response', 'aborted_in_flight'] as const)('cause %s', async (cause) => {
    const t = fakeTransport({ create: () => ({ kind: 'outcome_unknown', cause }) });
    await run({ t });
    expect(t.calls.create).toHaveLength(1);
    expect(t.calls.poll).toBe(0);
    expect(t.calls.cancel).toBe(0);
  });
});

describe('idempotency', () => {
  it('the same dispatch always derives the same agentId; a different context derives a different one', async () => {
    const a = await run();
    const b = await run();
    const c = await run({ req: request({ contextId: 'ctx-2' }) });
    expect(a.t.calls.create[0]?.agentId).toBe(b.t.calls.create[0]?.agentId);
    expect(a.t.calls.create[0]?.idempotencyKey).toBe(b.t.calls.create[0]?.idempotencyKey);
    expect(c.t.calls.create[0]?.agentId).not.toBe(a.t.calls.create[0]?.agentId);
    expect(a.t.calls.create[0]?.agentId).toMatch(/^bc-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/u);
    expect(grokCoderAgentId(grokCoderIdempotencyKey(request()))).toBe(a.t.calls.create[0]?.agentId);
  });

  it('a create answered with a different agentId is refused as malformed', async () => {
    const { outcome } = await run({ t: fakeTransport({ create: () => ({ kind: 'created', ref: { agentId: 'bc-other', runId: 'r' } }) }) });
    expect(failed(outcome).providerFailureClass).toBe('coder_grok_agent_id_mismatch');
  });
});

describe('served-model attestation matrix', () => {
  const unattested = fakeTransport.bind(null, { result: goodResult({ reportedModelId: null, reportedModelSource: null }) });
  it('reported and equal: MATCH, completes', async () => {
    expect(completed((await run()).outcome).observation.diagnostics).toMatchObject({ servedModelAttestation: 'reported by provider' });
  });
  it('reported and different: coder_served_model_mismatch', async () => {
    const f = failed((await run({ t: fakeTransport({ result: goodResult({ reportedModelId: 'some-other-model' }) }) })).outcome);
    expect(f).toMatchObject({ failure: 'SERVED_MODEL_MISMATCH', providerFailureClass: 'coder_served_model_mismatch' });
  });
  it('not reported (the default, since no field is documented): coder_served_model_unattested, and nothing is applied', async () => {
    const w = fakeWorkspace();
    const f = failed((await run({ t: unattested(), w })).outcome);
    expect(f).toMatchObject({ failure: 'SERVED_MODEL_UNATTESTED', providerFailureClass: 'coder_served_model_unattested' });
    expect(w.calls).toEqual({ fetch: 0, apply: 0 });
  });
  it('the flag alone does not relax it, nor the flag with the TODO-FOUNDER constant', async () => {
    const cfg = config({ acceptRequestedModelUnattested: true, founderAuthorizationToken: GROK_CODER_FOUNDER_AUTHORIZATION_TOKEN });
    expect(failed((await run({ cfg, t: unattested() })).outcome).providerFailureClass).toBe('coder_served_model_unattested');
    expect(failed((await run({ cfg: config({ acceptRequestedModelUnattested: true }), t: unattested() })).outcome).providerFailureClass).toBe('coder_served_model_unattested');
  });
  it('a matching founder pin without the flag does not relax it', async () => {
    const pin = 'founder-issued-fake-pin';
    expect(failed((await run({ cfg: config({ acceptRequestedModelUnattested: false, founderAuthorizationToken: pin }), t: unattested(), pin })).outcome).providerFailureClass).toBe('coder_served_model_unattested');
  });
  it('the flag with a matching founder pin proceeds and says "requested model, unattested by provider"', async () => {
    const pin = 'founder-issued-fake-pin';
    const c = completed((await run({ cfg: config({ acceptRequestedModelUnattested: true, founderAuthorizationToken: pin }), t: unattested(), pin })).outcome);
    expect(c.observation.providerModel).toBeNull();
    expect(c.observation.diagnostics).toMatchObject({ servedModelAttestation: GROK_CODER_REQUESTED_MODEL_UNATTESTED_EVIDENCE, servedModelVerdict: 'UNATTESTED' });
  });
  it('the relaxation never covers a mismatch', async () => {
    const pin = 'founder-issued-fake-pin';
    const f = failed((await run({ cfg: config({ acceptRequestedModelUnattested: true, founderAuthorizationToken: pin }), t: fakeTransport({ result: goodResult({ reportedModelId: 'other' }) }), pin })).outcome);
    expect(f.providerFailureClass).toBe('coder_served_model_mismatch');
  });
});

describe('configuration fails closed, before anything is sent', () => {
  const refusedClass = async (cfg: GrokBotCoderConfig | null) => {
    const t = fakeTransport();
    const f = failed((await run({ cfg, t })).outcome);
    expect(f.runtimeStarted).toBe(false);
    expect(t.calls.create).toHaveLength(0);
    return f.providerFailureClass;
  };
  it('absent config, and the all-null defaults', async () => {
    expect(await refusedClass(null)).toBe('coder_grok_config_absent');
    expect(await refusedClass(GROK_BOT_CODER_CONFIG_DEFAULTS)).toBe('coder_grok_config_model_absent');
  });
  it('no Claude, no router alias', async () => {
    expect(await refusedClass(config({ pinnedModelId: 'claude-opus-5-5' }))).toBe('coder_grok_model_claude_refused');
    expect(await refusedClass(config({ pinnedModelId: 'auto' }))).toBe('coder_grok_model_router_refused');
  });
  it('same family as the reviewer is refused unless explicitly allowed', async () => {
    expect(await refusedClass(config({ coderModelFamily: 'xai', reviewerModelFamily: 'XAI ' }))).toBe('coder_grok_same_family_as_reviewer');
    expect(await refusedClass(config({ coderModelFamily: null }))).toBe('coder_grok_config_family_absent');
    completed((await run({ cfg: config({ coderModelFamily: 'xai', reviewerModelFamily: 'xai', allowSameFamilyAsReviewer: true }) })).outcome);
  });
  it('the model id and family are pure config: a non-xAI coder (e.g. a Composer-style id) and an xAI coder both run against a different-family reviewer', async () => {
    const composer = fakeTransport({ result: goodResult({ reportedModelId: 'fake-composer-model' }) });
    completed((await run({ cfg: config({ pinnedModelId: 'fake-composer-model', coderModelFamily: 'cursor', reviewerModelFamily: 'xai' }), t: composer })).outcome);
    expect(composer.calls.create[0]?.modelId).toBe('fake-composer-model');
    const grok = fakeTransport({ result: goodResult({ reportedModelId: 'fake-grok-model' }) });
    completed((await run({ cfg: config({ pinnedModelId: 'fake-grok-model', coderModelFamily: 'xai', reviewerModelFamily: 'openai' }), t: grok })).outcome);
    expect(await refusedClass(config({ pinnedModelId: 'fake-grok-model', coderModelFamily: 'xai', reviewerModelFamily: 'xai' }))).toBe('coder_grok_same_family_as_reviewer');
    expect(await refusedClass(config({ pinnedModelId: 'fake-composer-model', coderModelFamily: 'cursor', reviewerModelFamily: 'Cursor' }))).toBe('coder_grok_same_family_as_reviewer');
  });
  it('sunday-relay is refused as a target, in any spelling', async () => {
    for (const url of ['https://github.com/ohdieyuh-glitch/sunday-relay', 'github.com/OHDIEYUH-GLITCH/Sunday-Relay.git', 'https://github.com/someone/sunday-relay/', 'git@github.com:ohdieyuh-glitch/sunday-relay.git']) {
      expect(isSundayRelayRepo(url)).toBe(true);
      expect(await refusedClass(config({ targetRepoUrl: url }))).toBe('coder_grok_target_is_sunday_relay');
    }
    expect(isSundayRelayRepo(TARGET)).toBe(false);
  });
  it('a deadline is required; a missing transport or workspace refuses; a tiny budget refuses', async () => {
    expect(await refusedClass(config({ runDeadlineMs: null }))).toBe('coder_grok_config_deadline_absent');
    expect(await refusedClass(config({ targetRepoUrl: 'https://gitlab.com/a/b' }))).toBe('coder_grok_config_target_invalid');
    const p = createGrokBotCodingAgentProvider({ config: config(), transport: null, workspace: fakeWorkspace().workspace });
    expect(failed(await p.execute(request())).providerFailureClass).toBe('coder_grok_transport_absent');
    const t = fakeTransport();
    expect(failed((await run({ t, req: request({ budget: 5_000 }) })).outcome).failure).toBe('COST_CEILING_REACHED');
    expect(t.calls.create).toHaveLength(0);
  });
  it('an aborted signal refuses before the create', async () => {
    const ac = new AbortController(); ac.abort();
    const t = fakeTransport();
    expect(failed((await run({ t, signal: ac.signal })).outcome)).toMatchObject({ failure: 'CANCELLED', runtimeStarted: false });
    expect(t.calls.create).toHaveLength(0);
  });
});

describe('the agent branch is untrusted', () => {
  it('a change outside permitted paths applies nothing', async () => {
    const w = fakeWorkspace({ changes: [{ path: 'src/a.ts', change: 'MODIFIED' }, { path: '.github/workflows/x.yml', change: 'ADDED' }] });
    const f = failed((await run({ w })).outcome);
    expect(f).toMatchObject({ failure: 'ENVELOPE_NOT_HONOURED', providerFailureClass: 'coder_grok_patch_out_of_scope' });
    expect(w.calls.apply).toBe(0);
  });
  it('a push to another repository, two branches, or an unsafe name are refused', async () => {
    const other = goodResult({ branches: [{ repoUrl: 'github.com/evil/repo', branch: 'x', prUrl: null }] });
    expect(failed((await run({ t: fakeTransport({ result: other }) })).outcome).providerFailureClass).toBe('coder_grok_branch_outside_target');
    const two = goodResult({ branches: [{ repoUrl: 'github.com/example-org/example-target', branch: 'a', prUrl: null }, { repoUrl: 'github.com/example-org/example-target', branch: 'b', prUrl: null }] });
    expect(failed((await run({ t: fakeTransport({ result: two }) })).outcome).providerFailureClass).toBe('coder_grok_branches_ambiguous');
    const unsafe = goodResult({ branches: [{ repoUrl: 'github.com/example-org/example-target', branch: '--upload-pack=x', prUrl: null }] });
    expect(failed((await run({ t: fakeTransport({ result: unsafe }) })).outcome).providerFailureClass).toBe('coder_grok_branch_name_unsafe');
    expect(isSafeBranchName('cursor/fix-1')).toBe(true);
    expect(isSafeBranchName('a..b')).toBe(false);
  });
  it('no branch: completes with nothing applied', async () => {
    const w = fakeWorkspace();
    const c = completed((await run({ w, t: fakeTransport({ result: goodResult({ branches: [] }) }) })).outcome);
    expect(c.observation.diagnostics).toMatchObject({ patchApplied: false });
    expect(w.calls.fetch).toBe(0);
  });
});

describe('the shell-backed workspace port issues fixed commands: fetch into a private ref, never merge or checkout', () => {
  it('commands carry the hook and protocol pins and no merge/checkout/push', async () => {
    const cmds: string[] = [];
    const port = createShellGrokBotWorkspacePort({
      ids: { runId: 'r', projectId: 'p', taskId: 't', workerId: 'w' },
      shell: { run: async (i: { command: string }) => { cmds.push(i.command); return { status: 'SUCCEEDED', stdout: i.command.includes('fetch') ? `HEAD ${HEAD}\nM\tsrc/a.ts\n` : i.command.includes('apply') ? 'APPLIED' : BASE, stderr: '', exitCode: 0 }; } } as never,
    });
    expect(await port.baseRevision('/w')).toEqual({ ok: true, sha: BASE });
    expect(await port.fetchBranch({ workspacePath: '/w', repoUrl: TARGET, branch: 'cursor/fix-1', baseRevision: BASE })).toMatchObject({ ok: true, headSha: HEAD });
    expect(await port.applyFetched({ workspacePath: '/w', baseRevision: BASE, headSha: HEAD })).toEqual({ ok: true });
    expect(await port.fetchBranch({ workspacePath: '/w', repoUrl: TARGET, branch: '-x', baseRevision: BASE })).toEqual({ ok: false, cause: 'fetch_input_unsafe' });
    for (const c of cmds) {
      expect(c).toContain('core.hooksPath=/dev/null');
      expect(c).not.toMatch(/\bgit\b[^\n]*\s(merge(?! ?-base)|checkout|push|commit|reset)\s/u);
    }
  });
});
