import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  CODER_MODEL_FAMILY_ALLOWLIST, GROK_BOT_CODER_CONFIG_DEFAULTS, GROK_BOT_CODER_PROVIDER_KIND, canonicalModelFamily, familyFromModelId, grokBotCoderConfigRefusal, normaliseModelId, resolveModelFamily,
  createGrokBotCodingAgentProvider, createShellGrokBotWorkspacePort, grokCoderAgentId, grokCoderIdempotencyKey,
  isProtectedRepoPath, isSafeBranchName, isSundayRelayRepo,
  type CodingAgentCreateInput, type CodingAgentCreateOutcome, type CodingAgentPollOutcome, type CodingAgentResultOutcome, type CodingAgentTransport,
  type GrokBotCoderConfig, type GrokBotWorkspacePort,
} from './grok-bot-coding-provider';
import { grokWorkspaceCommands } from './grok-workspace-commands';
import { juliusCodingAgentFailureDisposition, type JuliusCodingAgentProviderOutcome, type JuliusCodingAgentRequest } from '../../src/relay/mission/julius/julius-coding-agent';
import { juliusHandedOutcomeUnknown } from '../../src/relay/mission/julius/julius-execution-coordinator';
import { JuliusDispatchError, safeReviewDiagnostics } from '../../src/relay/mission/julius/julius-router';

/**
 * THE GROK BOT CODER, AGAINST A FAKE TRANSPORT AND A FAKE WORKSPACE. Nothing here reaches a network, a shell or a key.
 * Every value is fake; the model id `fake-grok-coder-1` is not a real Cursor id.
 */

const BASE = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const MODEL = 'fake-grok-coder-1';
const TARGET = 'https://github.com/example-org/example-target';
/** A fake reviewer id the reviewed family table resolves (to openai), so the default fixture passes the H1 checks. */
const REVIEWER = 'fake-gpt-reviewer-1';

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
  pinnedModelId: MODEL, coderModelFamily: 'xai', reviewerModelFamily: 'openai', reviewerModelId: REVIEWER, targetRepoUrl: TARGET, runDeadlineMs: 60_000,
  ...over,
});

/** The removed relaxation fields, smuggled in anyway: they must change nothing. */
const legacy = (over: Record<string, unknown>): GrokBotCoderConfig => ({ ...config(), ...over }) as never;

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

function fakeWorkspace(over: Partial<{ changes: { path: string; change: 'MODIFIED' | 'ADDED' | 'DELETED' }[]; fetchOk: boolean; applyOk: boolean; baseOk: boolean; unsafeEntries: number }> = {}) {
  const calls = { fetch: 0, apply: 0 };
  const workspace: GrokBotWorkspacePort = {
    async baseRevision() { return over.baseOk === false ? { ok: false, cause: 'x' } : { ok: true, sha: BASE }; },
    async fetchBranch() { calls.fetch += 1; return over.fetchOk === false ? { ok: false, cause: 'fetch_failed' } : { ok: true, headSha: HEAD, changes: over.changes ?? [{ path: 'src/a.ts', change: 'MODIFIED' }], unsafeEntries: over.unsafeEntries ?? 0 }; },
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
    /* A caller that still passes the removed pin is ignored: the factory has no such input. */
    ...(opts.pin === undefined ? {} : ({ founderAuthorizationPin: opts.pin } as never)),
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
  it('F8: a completed run is UNKNOWN basis and path (pool or prepaid credit, unverified), charged the full reservation; tokens are evidence only', async () => {
    const c = completed((await run()).outcome);
    expect(c.observation.costUsdMicros).toBeNull();
    expect(c.observation.costBasis).toBe('UNKNOWN');
    expect(c.observation.diagnostics).toMatchObject({ costBasis: 'UNKNOWN', billingPath: 'UNKNOWN', billingNote: 'cursor_pool_or_prepaid_credit_spend_unverified', spendVerified: false, chargedAs: 'FULL_RESERVATION' });
    expect(JSON.stringify(c.observation.diagnostics)).not.toMatch(/SUBSCRIPTION|NOT_APPLICABLE/u);
    expect(c.observation.diagnostics).not.toHaveProperty('executionCostUsdMicros');
  });

  it('zero recorded tokens still charge in full', async () => {
    const c = completed((await run({ t: fakeTransport({ result: goodResult({ usage: { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, totalTokens: 0 } }) }) })).outcome);
    expect(c.observation.costUsdMicros).not.toBe(0);
    expect(c.observation.diagnostics).toMatchObject({ usageAllZero: true, chargedAs: 'FULL_RESERVATION' });
  });

  it('F8: no fixed figure stands in for a cost: the option is gone, and a stale one changes nothing', async () => {
    expect(GROK_BOT_CODER_CONFIG_DEFAULTS).not.toHaveProperty('fixedPerAttemptReservationUsdMicros');
    const c = completed((await run({ cfg: legacy({ fixedPerAttemptReservationUsdMicros: 200_000 }) })).outcome);
    expect(c.observation.diagnostics).not.toHaveProperty('executionCostUsdMicros');
    expect(c.observation.diagnostics).toMatchObject({ chargedAs: 'FULL_RESERVATION' });
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
      expect(f.diagnostics).toMatchObject({ costBasis: 'UNKNOWN', billingPath: 'UNKNOWN', spendVerified: false, chargedAs: 'FULL_RESERVATION' });
    }
  });
});

describe('H2: an ending whose outcome is unknown never carries the fixed reservation; the full reservation holds', () => {
  const FIXED = 200_000;
  const endings: readonly [string, () => ReturnType<typeof fakeTransport>][] = [
    ['create timed out after sending', () => fakeTransport({ create: () => ({ kind: 'outcome_unknown', cause: 'timeout' }) })],
    ['create sent without a confirmed answer', () => fakeTransport({ create: () => ({ kind: 'outcome_unknown', cause: 'network' }) })],
    ['409 agent id conflict', () => fakeTransport({ create: () => ({ kind: 'conflict', status: 409 }) })],
    ['agentId mismatch', () => fakeTransport({ create: () => ({ kind: 'created', ref: { agentId: 'bc-00000000-0000-4000-8000-000000000000', runId: 'run-x' } }) })],
    ['poll failure', () => fakeTransport({ poll: { kind: 'poll_failed', cause: 'malformed_response', polls: 2 } })],
    ['poll failure (authentication)', () => fakeTransport({ poll: { kind: 'poll_failed', cause: 'authentication', polls: 2 } })],
    ['run deadline (timeout)', () => fakeTransport({ poll: { kind: 'deadline', polls: 9 } })],
    ['run expired (timeout)', () => fakeTransport({ poll: { kind: 'terminal', status: 'EXPIRED', polls: 3 } })],
  ];
  for (const [name, make] of endings) {
    it(name, async () => {
      const f = failed((await run({ cfg: legacy({ fixedPerAttemptReservationUsdMicros: FIXED }), t: make() })).outcome);
      expect(f.runtimeStarted).toBe(true);
      expect(f.costUsdMicros).toBeNull();
      expect(f.diagnostics).not.toHaveProperty('executionCostUsdMicros');
      expect(f.diagnostics).toMatchObject({ chargedAs: 'FULL_RESERVATION', spendVerified: false });
      expect(f.diagnostics.outcomeUnknown === true || f.diagnostics.timedOut === true).toBe(true);
    });
  }
  it('a known ending (the run reported ERROR) also holds the full reservation', async () => {
    const f = failed((await run({ cfg: legacy({ fixedPerAttemptReservationUsdMicros: FIXED }), t: fakeTransport({ poll: { kind: 'terminal', status: 'ERROR', polls: 1 } }) })).outcome);
    expect(f.diagnostics).not.toHaveProperty('executionCostUsdMicros');
    expect(f.diagnostics).toMatchObject({ chargedAs: 'FULL_RESERVATION', costBasis: 'UNKNOWN' });
  });
});

describe('M2: a run Julius stops following is cancelled, best effort, and recorded', () => {
  for (const cause of ['authentication', 'not_found', 'malformed_response', 'key_absent', 'unexpected_status'] as const) {
    it(`poll failure (${cause}): cancel requested once, outcome unknown`, async () => {
      const { outcome, t, w } = await run({ t: fakeTransport({ poll: { kind: 'poll_failed', cause, polls: 2 } }) });
      const f = failed(outcome);
      expect(t.calls.cancel).toBe(1);
      expect(f.diagnostics).toMatchObject({ cancelRequested: 'cancelled', outcomeUnknown: true });
      expect(w.calls).toEqual({ fetch: 0, apply: 0 });
      expect(t.calls.result).toBe(0);
    });
  }
  it('the authentication branch is outcome unknown and maps to an unknown handed outcome', async () => {
    const { outcome } = await run({ t: fakeTransport({ poll: { kind: 'poll_failed', cause: 'authentication', polls: 1 } }) });
    expect(failed(outcome).providerFailureClass).toBe('coder_grok_poll_unauthenticated');
    expect(failed(outcome).diagnostics.outcomeUnknown).toBe(true);
  });
  it('agentId mismatch: the returned run is cancelled, not followed', async () => {
    const t = fakeTransport({ create: () => ({ kind: 'created', ref: { agentId: 'bc-00000000-0000-4000-8000-000000000000', runId: 'run-x' } }) });
    const { outcome } = await run({ t });
    expect(t.calls.cancel).toBe(1);
    expect(t.calls.poll).toBe(0);
    expect(failed(outcome).diagnostics).toMatchObject({ cancelRequested: 'cancelled', outcomeUnknown: true });
  });
  it('a cancel that throws is recorded as failed and changes nothing else', async () => {
    const t = fakeTransport({ poll: { kind: 'poll_failed', cause: 'malformed_response', polls: 2 } });
    t.transport.cancelRun = async () => { t.calls.cancel += 1; throw new Error('boom'); };
    const f = failed((await run({ t })).outcome);
    expect(t.calls.cancel).toBe(1);
    expect(f.diagnostics).toMatchObject({ cancelRequested: 'failed', outcomeUnknown: true });
    expect(f.providerFailureClass).toBe('coder_grok_poll_failed');
  });
  it('a 409 and an outcome-unknown create have no run reference, so nothing is cancelled', async () => {
    for (const create of [() => ({ kind: 'conflict', status: 409 }) as const, () => ({ kind: 'outcome_unknown', cause: 'timeout' }) as const]) {
      const t = fakeTransport({ create });
      await run({ t });
      expect(t.calls.cancel).toBe(0);
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
    expect(completed((await run()).outcome).observation.diagnostics).toMatchObject({ servedModelAttestation: 'reported_by_provider' });
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
  it('F3: nothing relaxes it: no factory pin, no config flag or token, in any combination (the relaxation is removed)', async () => {
    const pin = 'founder-issued-fake-pin';
    for (const over of [{ acceptRequestedModelUnattested: true }, { acceptRequestedModelUnattested: true, founderAuthorizationToken: pin }, { founderAuthorizationToken: pin }]) {
      const w = fakeWorkspace();
      const f = failed((await run({ cfg: legacy(over), t: unattested(), w, pin })).outcome);
      expect(f.providerFailureClass, JSON.stringify(over)).toBe('coder_served_model_unattested');
      expect(w.calls.apply).toBe(0);
    }
    const mod = await import('./grok-bot-coding-provider');
    expect(Object.keys(mod).filter((k) => /FOUNDER|RELAX|UNATTESTED/u.test(k))).toEqual([]);
    expect(Object.keys(GROK_BOT_CODER_CONFIG_DEFAULTS).filter((k) => /founder|allowSame|acceptRequested/iu.test(k))).toEqual([]);
  });
  it('a mismatch is a mismatch', async () => {
    const f = failed((await run({ t: fakeTransport({ result: goodResult({ reportedModelId: 'other' }) }) })).outcome);
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
  it('same family as the reviewer is refused, and no flag, token or pin changes that', async () => {
    expect(await refusedClass(config({ coderModelFamily: 'xai', reviewerModelFamily: 'XAI ' }))).toBe('coder_grok_same_family_as_reviewer');
    expect(await refusedClass(config({ coderModelFamily: null }))).toBe('coder_grok_config_family_absent');
    const pin = 'founder-pin-test-0001';
    for (const over of [{ allowSameFamilyAsReviewer: true }, { allowSameFamilyAsReviewer: true, founderAuthorizationToken: pin }]) {
      const f = failed((await run({ cfg: legacy({ ...over, coderModelFamily: 'xai', reviewerModelFamily: 'xai' }), pin })).outcome);
      expect(f.providerFailureClass).toBe('coder_grok_same_family_as_reviewer');
      expect(f.runtimeStarted).toBe(false);
    }
  });
  it('H1: aliases are one family, the family is also read from the model id, and the reviewer\'s own model is never the coder', async () => {
    for (const [coder, reviewer] of [['xai', 'x.ai'], ['x-ai', 'XAI'], ['grok', 'xai'], ['x_ai', 'Grok '], ['anthropic', 'claude'], ['openai', 'gpt'], ['composer', 'cursor']]) {
      expect(await refusedClass(config({ coderModelFamily: coder, reviewerModelFamily: reviewer })), `${coder}/${reviewer}`).toBe('coder_grok_same_family_as_reviewer');
    }
    /* Stated families differ, but both model ids name xAI. */
    expect(await refusedClass(config({ pinnedModelId: 'grok-code-fast-1', coderModelFamily: 'vendor-a', reviewerModelFamily: 'vendor-b', reviewerModelId: 'grok-4' }))).toBe('coder_grok_same_family_as_reviewer');
    expect(await refusedClass(config({ pinnedModelId: 'xai-coder-2', coderModelFamily: 'cursor', reviewerModelFamily: 'xai', reviewerModelId: 'fake-reviewer-model' }))).toBe('coder_grok_same_family_as_reviewer');
    expect(await refusedClass(config({ pinnedModelId: 'fake-coder', coderModelFamily: 'xai', reviewerModelFamily: 'vendor-b', reviewerModelId: 'Grok-4.2' }))).toBe('coder_grok_same_family_as_reviewer');
    /* The reviewer's own id, in any case. */
    for (const id of [MODEL, MODEL.toUpperCase(), ` ${MODEL} `]) {
      expect(await refusedClass(config({ reviewerModelId: id }))).toBe('coder_grok_same_model_as_reviewer');
    }
    expect(await refusedClass(config({ reviewerModelId: null }))).toBe('coder_grok_config_reviewer_model_absent');
    expect(await refusedClass(config({ reviewerModelId: '  ' }))).toBe('coder_grok_config_reviewer_model_absent');
    expect(canonicalModelFamily(' X.AI ')).toBe('xai');
    expect(familyFromModelId('grok-code-fast-1')).toBe('xai');
    expect(familyFromModelId('composer-1')).toBe('cursor');
    expect(familyFromModelId('fake-coder-1')).toBeNull();
  });
  it('H1 fail-closed (PILOT R1 residuals): an opaque model id is refused whatever family is declared for it', async () => {
    /* PILOT's exact accepted cases at a1795dc0. */
    expect(await refusedClass(config({ pinnedModelId: 'code-supernova-1', coderModelFamily: 'cursor', reviewerModelFamily: 'xai', reviewerModelId: 'grok-4' }))).toBe('coder_grok_model_family_unrecognised');
    expect(await refusedClass(config({ pinnedModelId: 'fast-coder-1', coderModelFamily: 'vendor-z', reviewerModelFamily: 'xai', reviewerModelId: 'grok-4' }))).toBe('coder_grok_model_family_unrecognised');
    /* An opaque reviewer id cannot show independence either. */
    expect(await refusedClass(config({ pinnedModelId: 'fake-composer-1', coderModelFamily: 'cursor', reviewerModelFamily: 'vendor-b', reviewerModelId: 'fake-reviewer-model' }))).toBe('coder_grok_reviewer_family_unrecognised');
    /* A declaration that disagrees with the resolved family is refused, on either side. */
    expect(await refusedClass(config({ pinnedModelId: 'fake-composer-1', coderModelFamily: 'google', reviewerModelFamily: 'xai', reviewerModelId: 'grok-build-0.1' }))).toBe('coder_grok_family_declaration_mismatch');
    expect(await refusedClass(config({ pinnedModelId: 'fake-composer-1', coderModelFamily: 'cursor', reviewerModelFamily: 'google', reviewerModelId: 'grok-build-0.1' }))).toBe('coder_grok_family_declaration_mismatch');
    expect(await refusedClass(config({ pinnedModelId: 'fake-composer-1', coderModelFamily: 'cursor', reviewerModelFamily: 'openai', reviewerModelId: 'gemini-x' }))).toBe('coder_grok_family_declaration_mismatch');
    /* The real reviewer (grok-build-0.1, xAI) still refuses an xAI coder, and a recognised non-xAI coder still runs. */
    expect(await refusedClass(config({ pinnedModelId: 'grok-code-fast-1', coderModelFamily: 'cursor', reviewerModelFamily: 'xai', reviewerModelId: 'grok-build-0.1' }))).toBe('coder_grok_same_family_as_reviewer');
    expect(grokBotCoderConfigRefusal(config({ pinnedModelId: 'composer-1', coderModelFamily: 'cursor', reviewerModelFamily: 'xai', reviewerModelId: 'grok-build-0.1' }))).toBeNull();
    /* The allowlist is a reviewed constant and ships empty. */
    expect(Object.isFrozen(CODER_MODEL_FAMILY_ALLOWLIST)).toBe(true);
    expect(Object.keys(CODER_MODEL_FAMILY_ALLOWLIST)).toEqual([]);
  });
  it('H1: resolveModelFamily reads the reviewed table, then an allowlist entry naming a known family; nothing else', () => {
    const allow = Object.freeze({ 'code-supernova': 'cursor', 'odd-model': 'vendor-z', 'gx-coder': 'Grok' });
    expect(resolveModelFamily('code-supernova-1')).toBeNull();
    expect(resolveModelFamily('code-supernova-1', allow)).toBe('cursor');
    expect(resolveModelFamily('Code Supernova 20261001', allow)).toBe('cursor');
    expect(resolveModelFamily('gx-coder-2', allow)).toBe('xai');
    expect(resolveModelFamily('odd-model', allow)).toBeNull();
    expect(resolveModelFamily('toString', allow)).toBeNull();
    expect(resolveModelFamily('__proto__', allow)).toBeNull();
    expect(resolveModelFamily('grok-4', {})).toBe('xai');
    expect(resolveModelFamily('composer-1', { 'composer': 'openai' })).toBe('cursor');
  });
  it('H1: the same-model check compares normalised ids (PILOT: m-coder-20261001 vs m-coder)', async () => {
    for (const [coder, reviewer] of [
      ['m-coder-20261001', 'm-coder'], ['m-coder', 'm-coder-2026-10-01'], ['M-Coder-v2', 'm-coder'], ['m_coder.1', 'm-coder'],
      ['m-coder-preview', 'M CODER'], ['m-coder-beta-1', 'm-coder'], ['m\u200bcoder', 'mcoder'], ['ｍ-coder-1', 'm-coder'],
      ['grok-build-0.1', 'grok-build'], ['fake-grok-coder-1', 'FAKE_GROK_CODER@2'],
    ] as const) {
      expect(normaliseModelId(coder), `${coder}/${reviewer}`).toBe(normaliseModelId(reviewer));
      /* Non-ASCII coder ids never pass the model-id shape; the comparison itself is checked above. */
      if (/^[\x21-\x7e]+$/u.test(coder)) expect(await refusedClass(config({ pinnedModelId: coder, reviewerModelId: reviewer })), `${coder}/${reviewer}`).toBe('coder_grok_same_model_as_reviewer');
    }
    expect(normaliseModelId('m-coder-20261001')).toBe('m-coder');
    expect(normaliseModelId('composer-1')).toBe('composer');
    expect(normaliseModelId('grok-code-fast-1')).toBe('grok-code-fast');
    expect(normaliseModelId('m-coder')).not.toBe(normaliseModelId('m-coderx'));
  });
  it('L1: router aliases and Claude lookalikes in any spelling are refused', async () => {
    for (const id of ['auto', 'Auto', 'AUTO', 'cursor-auto', 'auto-smart', 'best', 'default', 'default-model', 'model.default', 'latest', 'router', 'balance', 'Balance', 'BALANCE', 'balanced', 'intelligence', 'Intelligence', 'cursor-balance', 'router.intelligence', 'cheapest', 'fastest']) {
      expect(await refusedClass(config({ pinnedModelId: id })), id).toBe('coder_grok_model_router_refused');
    }
    for (const id of ['c1aude-4', 'cl4ude-4', 'CLAUDE-4', 's0nnet-4', '0pus-5', 'Haiku-3']) {
      expect(await refusedClass(config({ pinnedModelId: id })), id).toBe('coder_grok_model_claude_refused');
    }
    /* Non-ASCII spellings (fullwidth, zero-width) never pass the model-id shape. */
    expect(await refusedClass(config({ pinnedModelId: 'claude\u200b-4' }))).not.toBeNull();
    expect(await refusedClass(config({ pinnedModelId: 'ｃｌａｕｄｅ-4' }))).not.toBeNull();
  });
  it('the model id and family are pure config: a non-xAI coder (e.g. a Composer-style id) and an xAI coder both run against a different-family reviewer', async () => {
    const composer = fakeTransport({ result: goodResult({ reportedModelId: 'fake-composer-model' }) });
    completed((await run({ cfg: config({ pinnedModelId: 'fake-composer-model', coderModelFamily: 'cursor', reviewerModelFamily: 'xai', reviewerModelId: 'grok-build-0.1' }), t: composer })).outcome);
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
    expect(f.diagnostics).toMatchObject({ patchApplied: false }); // F7: the durable row says nothing was applied
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
      workspacePath: '/w',
      ids: { runId: 'r', projectId: 'p', taskId: 't', workerId: 'w' },
      shell: { run: async (i: { command: string }) => { cmds.push(i.command); return { status: 'SUCCEEDED', stdout: i.command.includes('fetch') ? `HEAD ${HEAD}\n:100644 100644 1111111111111111111111111111111111111111 2222222222222222222222222222222222222222 M\tsrc/a.ts\n` : i.command.includes('apply') ? 'APPLIED' : BASE, stderr: '', exitCode: 0 }; } } as never,
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

describe('M3: the scope check sees modes and type changes (git diff --raw --no-renames)', () => {
  const Z = '0'.repeat(40);
  const raw = (oldMode: string, newMode: string, status: string, path: string) => `:${oldMode} ${newMode} ${oldMode === '000000' ? Z : '1'.repeat(40)} ${newMode === '000000' ? Z : '2'.repeat(40)} ${status}\t${path}`;
  const portWith = (lines: string[]) => createShellGrokBotWorkspacePort({
    workspacePath: '/w',
    ids: { runId: 'r', projectId: 'p', taskId: 't', workerId: 'w' },
    shell: { run: async (i: { command: string }) => ({ status: 'SUCCEEDED', stdout: i.command.includes('fetch') ? `HEAD ${HEAD}\n${lines.join('\n')}\n` : 'APPLIED', stderr: '', exitCode: 0 }) } as never,
  });
  const fetch = (lines: string[]) => portWith(lines).fetchBranch({ workspacePath: '/w', repoUrl: TARGET, branch: 'cursor/fix-1', baseRevision: BASE });

  it('the fetch command lists with --raw --no-renames --no-abbrev, never --name-status', () => {
    const cmd = grokWorkspaceCommands.fetchBranch('example-org', 'example-target', 'cursor/fix-1', BASE);
    expect(cmd).toContain(`diff --raw --no-renames --no-abbrev ${BASE} "$head"`);
    expect(cmd).not.toContain('--name-status');
  });
  it('plain modify, add, delete and an edit to an existing executable are plain changes', async () => {
    expect(await fetch([raw('100644', '100644', 'M', 'src/a.ts'), raw('000000', '100644', 'A', 'src/new.ts'), raw('100755', '100755', 'M', 'src/run.sh'), raw('100644', '000000', 'D', 'src/old.ts'), raw('100755', '000000', 'D', 'src/gone.sh')]))
      .toEqual({ ok: true, headSha: HEAD, unsafeEntries: 0, changes: [{ path: 'src/a.ts', change: 'MODIFIED' }, { path: 'src/new.ts', change: 'ADDED' }, { path: 'src/run.sh', change: 'MODIFIED' }, { path: 'src/old.ts', change: 'DELETED' }, { path: 'src/gone.sh', change: 'DELETED' }] });
  });
  it('a symlink (120000), a gitlink (160000) or a type change (T), on either side, is counted unsafe', async () => {
    for (const line of [raw('000000', '120000', 'A', 'src/link'), raw('100644', '120000', 'T', 'src/a.ts'), raw('120000', '100644', 'T', 'src/a.ts'), raw('000000', '160000', 'A', 'src/sub'), raw('160000', '160000', 'M', 'src/sub'), raw('120000', '000000', 'D', 'src/link'), raw('100644', '100755', 'T', 'src/x')]) {
      const r = await fetch([raw('100644', '100644', 'M', 'src/a.ts'), line]);
      expect(r, line).toMatchObject({ ok: true, unsafeEntries: 1 });
    }
  });
  it('anything that is not a raw line is malformed: name-status, renames, abbreviated ids, quoted paths', async () => {
    for (const line of ['M\tsrc/a.ts', `:100644 100644 ${'1'.repeat(40)} ${'2'.repeat(40)} R100\tsrc/a.ts\tsrc/b.ts`, ':100644 100644 1111111 2222222 M\tsrc/a.ts', `:100644 100644 ${'1'.repeat(40)} ${'2'.repeat(40)} M\t"src/\\303\\251.ts"`, `:100644 100644 ${'1'.repeat(40)} ${'2'.repeat(40)} X\tsrc/a.ts`]) {
      expect(await fetch([line]), line).toEqual({ ok: false, cause: 'fetch_output_malformed' });
    }
  });
  it('the provider refuses a patch with any unsafe entry, and a port that does not say is treated as unsafe; nothing is applied', async () => {
    for (const unsafeEntries of [1, 3]) {
      const w = fakeWorkspace({ unsafeEntries });
      const f = failed((await run({ w })).outcome);
      expect(f.providerFailureClass).toBe('coder_grok_patch_out_of_scope');
      expect(f.diagnostics).toMatchObject({ unsafeEntryCount: unsafeEntries });
      expect(w.calls.apply).toBe(0);
    }
    const silent = fakeWorkspace();
    silent.workspace.fetchBranch = async () => ({ ok: true, headSha: HEAD, changes: [{ path: 'src/a.ts', change: 'MODIFIED' }] }) as never;
    const f = failed((await run({ w: silent })).outcome);
    expect(f.providerFailureClass).toBe('coder_grok_patch_out_of_scope');
    expect(silent.calls.apply).toBe(0);
  });
});

describe('F5/F6/F13: exec bits, protected paths, an empty permitted list, and the bound workspace path', () => {
  const Z = '0'.repeat(40);
  const raw = (oldMode: string, newMode: string, status: string, path: string) => `:${oldMode} ${newMode} ${oldMode === '000000' ? Z : '1'.repeat(40)} ${newMode === '000000' ? Z : '2'.repeat(40)} ${status}\t${path}`;
  const portAt = (bound: string, lines: string[], seen: string[] = []) => createShellGrokBotWorkspacePort({
    workspacePath: bound,
    ids: { runId: 'r', projectId: 'p', taskId: 't', workerId: 'w' },
    shell: { run: async (i: { command: string }) => { seen.push(i.command); return { status: 'SUCCEEDED', stdout: i.command.includes('fetch') ? `HEAD ${HEAD}\n${lines.join('\n')}\n` : i.command.includes('apply') ? 'APPLIED' : BASE, stderr: '', exitCode: 0 }; } } as never,
  });

  it('F5 + PILOT Low 5: an executable-bit flip either way, and a NEW executable file, are unsafe', async () => {
    for (const line of [raw('100644', '100755', 'M', 'src/run.sh'), raw('100755', '100644', 'M', 'src/run.sh'), raw('000000', '100755', 'A', 'src/new.sh')]) {
      expect(await portAt('/w', [line]).fetchBranch({ workspacePath: '/w', repoUrl: TARGET, branch: 'cursor/fix-1', baseRevision: BASE }), line).toMatchObject({ ok: true, unsafeEntries: 1 });
    }
    expect(await portAt('/w', [raw('000000', '100755', 'A', 'src/new.sh'), raw('000000', '100755', 'A', 'src/new2.sh')]).fetchBranch({ workspacePath: '/w', repoUrl: TARGET, branch: 'cursor/fix-1', baseRevision: BASE })).toMatchObject({ ok: true, unsafeEntries: 2 });
    expect(await portAt('/w', [raw('000000', '100644', 'A', 'src/new.ts'), raw('100755', '100755', 'M', 'src/run.sh')]).fetchBranch({ workspacePath: '/w', repoUrl: TARGET, branch: 'cursor/fix-1', baseRevision: BASE })).toMatchObject({ ok: true, unsafeEntries: 0 });
  });

  it('F6: .git, .gitmodules, .gitattributes, .github, .githooks and .husky are protected in any case, at any depth', () => {
    for (const path of ['.git/config', '.GIT/hooks/pre-commit', 'src/.Git/x', '.gitmodules', '.GitModules', 'lib/.gitattributes', '.github/workflows/ci.yml', '.GITHUB/x', '.githooks/pre-push', '.husky/pre-commit', '.git./x', '.git /x', 'a\\.git\\config', '．git/config']) {
      expect(isProtectedRepoPath(path), path).toBe(true);
    }
    for (const path of ['src/a.ts', 'src/git/x', 'docs/.gitignore', 'src/.github-pages/x', 'my.git/x', 'husky/x']) expect(isProtectedRepoPath(path), path).toBe(false);
  });

  it('F6: the provider refuses a protected path even inside a permitted prefix, and nothing is applied', async () => {
    for (const path of ['src/.GIT/hooks/post-checkout', '.github/workflows/x.yml', 'src/.gitattributes']) {
      const w = fakeWorkspace({ changes: [{ path, change: 'ADDED' }] });
      const f = failed((await run({ w, req: request({ permittedPaths: ['src/', '.github/', ''] }) })).outcome);
      expect(f.providerFailureClass, path).toBe('coder_grok_patch_out_of_scope');
      expect(f.diagnostics).toMatchObject({ protectedPathTouched: true });
      expect(w.calls.apply).toBe(0);
    }
  });

  it('F6: an empty (or all-blank) permitted list refuses every change; no change at all still completes', async () => {
    for (const permittedPaths of [[], [''], ['  ', '']]) {
      const w = fakeWorkspace();
      const f = failed((await run({ w, req: request({ permittedPaths }) })).outcome);
      expect(f.providerFailureClass, JSON.stringify(permittedPaths)).toBe('coder_grok_patch_out_of_scope');
      expect(f.diagnostics).toMatchObject({ permittedPathsEmpty: true });
      expect(w.calls.apply).toBe(0);
    }
    const none = fakeWorkspace({ changes: [] });
    completed((await run({ w: none, req: request({ permittedPaths: [] }) })).outcome);
  });

  it('F13: every port call must name the bound workspace path, or nothing runs', async () => {
    const seen: string[] = [];
    const port = portAt('/workspace/mission', [raw('100644', '100644', 'M', 'src/a.ts')], seen);
    expect(await port.baseRevision('/elsewhere')).toEqual({ ok: false, cause: 'workspace_path_mismatch' });
    expect(await port.fetchBranch({ workspacePath: '/workspace/mission/', repoUrl: TARGET, branch: 'cursor/fix-1', baseRevision: BASE })).toEqual({ ok: false, cause: 'workspace_path_mismatch' });
    expect(await port.applyFetched({ workspacePath: '/elsewhere', baseRevision: BASE, headSha: HEAD })).toEqual({ ok: false, cause: 'workspace_path_mismatch' });
    expect(seen).toEqual([]);
    expect(await port.baseRevision('/workspace/mission')).toEqual({ ok: true, sha: BASE });
    expect(await createShellGrokBotWorkspacePort({ workspacePath: '', ids: { runId: 'r', projectId: 'p', taskId: 't', workerId: 'w' }, shell: { run: async () => { throw new Error('ran'); } } as never }).baseRevision('')).toEqual({ ok: false, cause: 'workspace_path_mismatch' });
    /* The provider passes the request's path: a port bound elsewhere stops the run before anything is created. */
    const t = fakeTransport();
    const f = failed((await run({ t, w: { workspace: portAt('/elsewhere', []), calls: { fetch: 0, apply: 0 } } as never })).outcome);
    expect(f.runtimeStarted).toBe(false);
    expect(t.calls.create).toHaveLength(0);
  });
});

describe('F5: with REAL git (local temp repository, no network), the generated diff command and the port\'s parser agree', () => {
  it('a plain edit, a new plain file and an edit to an existing executable pass; a new executable, an exec-bit flip, a symlink, a type change and a gitlink are unsafe; .github is protected', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'grok-raw-'));
    try {
      const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: dir, encoding: 'utf8' }).trim();
      git('init', '-q');
      mkdirSync(join(dir, 'src'));
      for (const f of ['a.ts', 'flip.sh', 'unflip.sh', 'tolink.ts']) writeFileSync(join(dir, 'src', f), `${f}\n`);
      chmodSync(join(dir, 'src', 'unflip.sh'), 0o755);
      git('add', '-A'); git('commit', '-q', '-m', 'base');
      const base = git('rev-parse', 'HEAD');
      const plain = async (mutate: () => void, indexOnly = false) => {
        git('checkout', '-q', '--detach', base);
        mutate();
        if (!indexOnly) git('add', '-A');
        git('commit', '-q', '-m', 'agent');
        const head = git('rev-parse', 'HEAD');
        const diffLine = grokWorkspaceCommands.fetchBranch('example-org', 'example-target', 'cursor/fix-1', base).split('\n').at(-1)!;
        const out = execFileSync('bash', ['-c', `head=${head}\n${diffLine}`], { cwd: dir, encoding: 'utf8' });
        const port = createShellGrokBotWorkspacePort({
          workspacePath: dir, ids: { runId: 'r', projectId: 'p', taskId: 't', workerId: 'w' },
          shell: { run: async () => ({ status: 'SUCCEEDED', stdout: `HEAD ${head}\n${out}`, stderr: '', exitCode: 0 }) } as never,
        });
        return port.fetchBranch({ workspacePath: dir, repoUrl: TARGET, branch: 'cursor/fix-1', baseRevision: base });
      };
      expect(await plain(() => { writeFileSync(join(dir, 'src', 'a.ts'), 'edited\n'); writeFileSync(join(dir, 'src', 'new.ts'), 'x\n'); writeFileSync(join(dir, 'src', 'unflip.sh'), 'edited\n'); }))
        .toEqual({ ok: true, headSha: expect.any(String), unsafeEntries: 0, changes: [{ path: 'src/a.ts', change: 'MODIFIED' }, { path: 'src/new.ts', change: 'ADDED' }, { path: 'src/unflip.sh', change: 'MODIFIED' }] });
      /* PILOT R11 newExecutableFile: a new file at mode 100755 is now unsafe. */
      expect(await plain(() => { writeFileSync(join(dir, 'src', 'new.sh'), 'x\n'); chmodSync(join(dir, 'src', 'new.sh'), 0o755); })).toMatchObject({ ok: true, unsafeEntries: 1 });
      expect(await plain(() => chmodSync(join(dir, 'src', 'flip.sh'), 0o755))).toMatchObject({ ok: true, unsafeEntries: 1 });
      expect(await plain(() => chmodSync(join(dir, 'src', 'unflip.sh'), 0o644))).toMatchObject({ ok: true, unsafeEntries: 1 });
      expect(await plain(() => symlinkSync('../../etc/passwd', join(dir, 'src', 'link')))).toMatchObject({ ok: true, unsafeEntries: 1 });
      expect(await plain(() => { rmSync(join(dir, 'src', 'tolink.ts')); symlinkSync('a.ts', join(dir, 'src', 'tolink.ts')); })).toMatchObject({ ok: true, unsafeEntries: 1 });
      expect(await plain(() => { git('update-index', '--add', '--cacheinfo', `160000,${base},src/sub`); }, true)).toMatchObject({ ok: true, unsafeEntries: 1 });
      const gh = await plain(() => { mkdirSync(join(dir, '.github', 'workflows'), { recursive: true }); writeFileSync(join(dir, '.github', 'workflows', 'x.yml'), 'on: push\n'); });
      expect(gh).toMatchObject({ ok: true, unsafeEntries: 0 });
      expect(gh.ok && gh.changes.some((c) => isProtectedRepoPath(c.path))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('F14: the provider labels an abort during the result read as CANCELLED, and passes the run deadline', () => {
  it('abort during fetchResult: CANCELLED (not PARTIAL_RESPONSE), cancel requested, nothing applied', async () => {
    const ac = new AbortController();
    const t = fakeTransport();
    t.transport.fetchResult = async () => { ac.abort(); return { kind: 'unavailable', cause: 'aborted' }; };
    const w = fakeWorkspace();
    const f = failed((await run({ t, w, signal: ac.signal })).outcome);
    expect(f).toMatchObject({ failure: 'CANCELLED', providerFailureClass: 'coder_cancelled' });
    expect(t.calls.cancel).toBe(1);
    expect(w.calls.apply).toBe(0);
  });
  it('the result read gets the run deadline; a poll that ran out of transient retries has its own class', async () => {
    const t = fakeTransport();
    const seen: unknown[] = [];
    const orig = t.transport.fetchResult.bind(t.transport);
    t.transport.fetchResult = async (ref, signal, options) => { seen.push(options); return orig(ref, signal, options); };
    completed((await run({ t })).outcome);
    expect(seen).toEqual([{ deadlineAtMs: 1_000 + 60_000 }]);
    const f = failed((await run({ t: fakeTransport({ poll: { kind: 'poll_failed', cause: 'transient_exhausted', polls: 5 } }) })).outcome);
    expect(f).toMatchObject({ providerFailureClass: 'coder_grok_poll_transient_exhausted' });
    expect(f.diagnostics).toMatchObject({ outcomeUnknown: true, pollFailureCause: 'transient_exhausted' });
  });
});

describe('F15/E8: transportMode is stamped by the transport module, not claimed; the receipt is carried', () => {
  it('a fake that calls itself the Cursor transport is labelled fake', async () => {
    const t = fakeTransport();
    (t.transport as { transportKind: string }).transportKind = 'cursor_cloud_agents_v1';
    const c = completed((await run({ t })).outcome);
    expect(c.observation.diagnostics).toMatchObject({ transportMode: 'fake' });
  });
  it('receipt fields reach the evidence; a mismatched run id is recorded as such', async () => {
    const sha = 'e'.repeat(64);
    const c = completed((await run({ t: fakeTransport({ result: goodResult({ receipt: { runId: 'run-x', createdAt: '2026-10-30T16:00:00Z', requestId: 'req_1', responseSha256: sha } }) }) })).outcome);
    expect(c.observation.diagnostics).toMatchObject({ cursorRequestId: 'req_1', cursorRunCreatedAt: '2026-10-30T16:00:00Z', runResponseSha256: sha, receiptRunIdMatches: true });
    const m = completed((await run({ t: fakeTransport({ result: goodResult({ receipt: { runId: 'run-other', createdAt: null, requestId: null, responseSha256: 'nothex' } }) }) })).outcome);
    expect(m.observation.diagnostics).toMatchObject({ receiptRunIdMatches: false });
    expect(m.observation.diagnostics).not.toHaveProperty('runResponseSha256');
    expect(m.observation.toolInvocations).toBeNull();
  });
});

describe('Grok Bot coder: identifiers reach the router diagnostics', () => {
  it('F7: the kinds are router tokens and every durable fact survives safeReviewDiagnostics unchanged', async () => {
    expect(GROK_BOT_CODER_PROVIDER_KIND).toMatch(/^[a-z][a-z0-9_]{0,63}$/u);
    const sha = 'f'.repeat(64);
    const { outcome } = await run({ t: fakeTransport({ result: goodResult({ receipt: { runId: 'run-1', createdAt: '2026-10-30T16:00:00Z', requestId: 'req_1', responseSha256: sha } }) }) });
    const diag = completed(outcome).observation.diagnostics as Record<string, unknown>;
    const safe = safeReviewDiagnostics(diag)!;
    const keys = ['codingAgentProvider', 'transportMode', 'servedModelVerdict', 'servedModelAttestation', 'spendVerified', 'chargedAs', 'billingNote',
      'cursorRunId', 'cursorRequestId', 'cursorRunCreatedAt', 'runResponseSha256', 'receiptRunIdMatches', 'baseRevision', 'agentHeadSha', 'patchApplied', 'billingPath', 'costBasis'] as const;
    for (const k of keys) {
      expect(diag[k], k).not.toBeUndefined();
      expect(safe[k], k).toBe(diag[k]);
    }
    expect(safe).toMatchObject({ codingAgentProvider: 'grok_bot_cloud_agent', transportMode: 'fake', spendVerified: false, chargedAs: 'FULL_RESERVATION', patchApplied: true, billingPath: 'UNKNOWN' });
  });
  it('F7: an outcome-unknown ending keeps outcomeUnknown, the run id and the cancel result on the durable row', async () => {
    const f = failed((await run({ t: fakeTransport({ create: () => ({ kind: 'outcome_unknown', cause: 'timeout' }) }) })).outcome);
    const safe = new JuliusDispatchError('WORKER_EXECUTION_FAILURE', false, 'x', f.providerFailureClass, f.diagnostics).diagnostics!;
    expect(safe).toMatchObject({ outcomeUnknown: true, codingAgentProvider: 'grok_bot_cloud_agent', spendVerified: false });
  });
  it('a MATCH run: cursorAgentId, agentBranch, cursorServedModel and servedModel all survive safeReviewDiagnostics', async () => {
    const { outcome, t } = await run();
    const safe = safeReviewDiagnostics(completed(outcome).observation.diagnostics)!;
    expect(safe).toMatchObject({ cursorAgentId: t.calls.create[0]?.agentId, agentBranch: 'cursor/fix-1', cursorServedModel: MODEL, servedModel: MODEL });
    expect(safe.cursorAgentId).toMatch(/^bc-[0-9a-f]{8}-/u);
  });
  it('a MISMATCH run reports what the API said in cursorServedModel and never in servedModel', async () => {
    const f = failed((await run({ t: fakeTransport({ result: goodResult({ reportedModelId: 'some-other-model' }) }) })).outcome);
    expect(f.diagnostics).toMatchObject({ cursorServedModel: 'some-other-model', servedModelVerdict: 'MISMATCH' });
    expect(f.diagnostics).not.toHaveProperty('servedModel');
    const safe = new JuliusDispatchError('WORKER_EXECUTION_FAILURE', false, 'x', f.providerFailureClass, f.diagnostics).diagnostics!;
    expect(safe).toMatchObject({ cursorServedModel: 'some-other-model', servedModel: null });
  });
});

describe('PILOT Low 6: the apply step ignores external diff drivers and textconv (REAL git, local temp repository, no network)', () => {
  it('the generated apply command passes --no-ext-diff --no-textconv, and a hostile diff.external / textconv cannot change what is applied', () => {
    const cmd = grokWorkspaceCommands.applyFetched('a'.repeat(40), 'b'.repeat(40));
    for (const line of cmd.split('\n').filter((l) => l.includes(' diff '))) expect(line).toContain('diff --no-ext-diff --no-textconv --binary');
    const dir = mkdtempSync(join(tmpdir(), 'grok-apply-'));
    try {
      const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: dir, encoding: 'utf8' }).trim();
      git('init', '-q');
      writeFileSync(join(dir, 'a.txt'), 'good\n');
      writeFileSync(join(dir, '.gitattributes'), '*.txt diff=evil\n');
      git('add', '-A'); git('commit', '-q', '-m', 'base');
      const base = git('rev-parse', 'HEAD');
      writeFileSync(join(dir, 'a.txt'), 'good\nbetter\n');
      git('commit', '-q', '-am', 'agent');
      const head = git('rev-parse', 'HEAD');
      git('checkout', '-q', '--detach', base);
      /* Hostile repository config: an external diff that prints a forged patch, and a textconv that rewrites content. */
      const evil = join(dir, 'evil.sh');
      writeFileSync(evil, '#!/bin/sh\nprintf "diff --git a/a.txt b/a.txt\\n--- a/a.txt\\n+++ b/a.txt\\n@@ -1 +1 @@\\n-good\\n+EVIL\\n"\n');
      chmodSync(evil, 0o755);
      git('config', 'diff.external', evil);
      git('config', 'diff.evil.textconv', 'sed s/good/EVIL/');
      git('config', 'diff.evil.binary', 'false');
      const out = execFileSync('bash', ['-c', grokWorkspaceCommands.applyFetched(base, head)], { cwd: dir, encoding: 'utf8' });
      expect(out.trim().endsWith('APPLIED')).toBe(true);
      expect(execFileSync('cat', ['a.txt'], { cwd: dir, encoding: 'utf8' })).toBe('good\nbetter\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
