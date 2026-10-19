import { describe, expect, it } from 'vitest';

import { hostedServedModel, hostedServedModelVerdict, observeHostedMessages } from '../hosted-coding-agent/hosted-observation';
import { compileHostedEnvelope } from '../hosted-coding-agent/hosted-envelope';
import type { HostedRunOutcome, HostedQueryFn } from '../hosted-coding-agent/hosted-runner';
import { createClaudeCodeCodingAgentProvider } from './claude-code-coding-provider';
import { juliusCodingAgentFailureDisposition, type JuliusCodingAgentRequest } from '../../src/relay/mission/julius/julius-coding-agent';

/**
 * THE MODEL THAT ANSWERED IS THE ONE ASKED FOR, OR THE DISPATCH STOPS.
 *
 * Founder decision, 2026-09-30: the paid coder is claude-opus-5-5, with no automatic downgrade, and
 * a STOP rather than a substitute. Nothing compared the model the runtime attests with the one
 * requested, so a session answered by another model finished as a success.
 *
 * The verdict reads the runtime's own attestation (`hostedServedModel`): the turns that produced
 * output, credited by the result's `modelUsage`. It is the same rule the subscription smoke applies:
 * the requested model EXACTLY, or its DATED BUILD (`<requested>-YYYYMMDD`), by the turn's model or
 * the crediting entry's key or `canonicalModel`. Nothing looser. Anything short of an attestation is
 * UNATTESTED, and a stop too. Every fixture value is fake.
 */

const REQUESTED = 'claude-opus-5-5';
const init = { type: 'system', subtype: 'init', session_id: 's', model: REQUESTED, claude_code_version: '2.1.220', apiKeySource: 'none', cwd: '/workspace/mission', tools: ['Read', 'Edit'] };
const turn = (model: string, output: number) => ({
  type: 'assistant', parent_tool_use_id: null, session_id: 's',
  message: { model, content: [{ type: 'text', text: 'working' }], usage: { input_tokens: 100, output_tokens: output } },
});
const result = (usage: Record<string, { out: number; canonical?: string }>) => ({
  type: 'result', subtype: 'success', is_error: false, num_turns: 1, duration_ms: 1000, usage: { input_tokens: 100, output_tokens: 50 },
  total_cost_usd: 0.2, terminal_reason: 'completed', result: 'Implemented.', permission_denials: [],
  modelUsage: Object.fromEntries(Object.entries(usage).map(([key, value]) => [key, {
    inputTokens: 100, outputTokens: value.out, ...(value.canonical === undefined ? {} : { canonicalModel: value.canonical }),
  }])),
});
const request = {
  version: 'julius-coding-agent.v1', identity: { runId: 'r', missionId: 'm', taskId: 't', taskType: 'build', contextId: 'c' },
  workspacePath: '/workspace/mission', contract: null, plan: 'THE PLAN',
  sections: { acceptedGuidance: [], architecture: [], findings: [], continuation: [], missionContext: [] },
  permissions: { mayEditFiles: true, mayRunCommands: false, mayUseNetwork: false, permittedPaths: [], outOfScope: [], prohibitedActions: [] },
  requiredEvidence: ['TEST'], budget: { usdMicros: null }, protocol: { participation: 'HOW TO ASK', researchAuthority: 'WHAT TO READ' },
} as unknown as JuliusCodingAgentRequest;
const providerOver = (messages: readonly unknown[], authMode?: 'CLAUDE_SUBSCRIPTION') => createClaudeCodeCodingAgentProvider({
  apiKey: authMode === 'CLAUDE_SUBSCRIPTION' ? '' : 'FAKETESTNOTREAL', requestedModel: REQUESTED,
  ...(authMode === undefined ? {} : { authMode }),
  run: (async (): Promise<HostedRunOutcome> => ({
    kind: 'completed', observation: observeHostedMessages(messages),
    envelope: compileHostedEnvelope({ workspacePath: '/workspace/mission' }), startedAt: 't', completedAt: 't',
  })) as never,
  queryLoader: async () => (() => (async function* () { /* none */ })()) as HostedQueryFn,
});

const EXACT = [init, turn(REQUESTED, 50), result({ [REQUESTED]: { out: 50 } })];
const DATED = [init, turn(`${REQUESTED}-20260915`, 50), result({ [`${REQUESTED}-20260915`]: { out: 50 } })];
const HELPER = [init, turn(REQUESTED, 50), result({ [REQUESTED]: { out: 50 }, 'claude-haiku-4-5-20251001': { out: 300 } })];
const ANOTHER = [init, turn('claude-sonnet-5', 50), result({ 'claude-sonnet-5': { out: 50 } })];
const SWITCHED = [init, turn(REQUESTED, 50), turn('claude-sonnet-5', 40), result({ [REQUESTED]: { out: 50 }, 'claude-sonnet-5': { out: 40 } })];

describe('the verdict: the requested model exactly, or its dated build, and nothing looser', () => {
  const verdictOf = (messages: readonly unknown[]) => hostedServedModelVerdict(hostedServedModel(observeHostedMessages(messages)), REQUESTED);

  it.each([
    ['the requested model, credited by its own key', EXACT, 'MATCH'],
    ['its dated build', DATED, 'MATCH'],
    ['an alias the SDK resolves to its dated build (canonicalModel)', [init, turn(`${REQUESTED}-20260915`, 50), result({ opus: { out: 50, canonical: `${REQUESTED}-20260915` } })], 'MATCH'],
    // The turn names an ALIAS. The crediting entry carries the full name either as its canonicalModel ...
    ['a turn alias whose entry resolves it to the requested model (canonicalModel)', [init, turn('opus', 50), result({ opus: { out: 50, canonical: REQUESTED } })], 'MATCH'],
    // ... or as its key, with the alias as the canonicalModel.
    ['a turn alias whose entry is keyed by the requested model', [init, turn('opus', 50), result({ [REQUESTED]: { out: 50, canonical: 'opus' } })], 'MATCH'],
    ['a turn alias that resolves to another model', [init, turn('opus', 50), result({ opus: { out: 50, canonical: 'claude-sonnet-5' } })], 'MISMATCH'],
    ['a helper model beside it in modelUsage', HELPER, 'MATCH'],
    ['another model, attested', ANOTHER, 'MISMATCH'],
    ['a shorter suffix (-2026)', [init, turn(`${REQUESTED}-2026`, 50), result({ [`${REQUESTED}-2026`]: { out: 50 } })], 'MISMATCH'],
    ['a longer name (claude-opus-5-50)', [init, turn('claude-opus-5-50', 50), result({ 'claude-opus-5-50': { out: 50 } })], 'MISMATCH'],
    ['a dated build with a tail', [init, turn(`${REQUESTED}-20260915-beta`, 50), result({ [`${REQUESTED}-20260915-beta`]: { out: 50 } })], 'MISMATCH'],
    ['no turn produced output', [init, result({ [REQUESTED]: { out: 50 } })], 'UNATTESTED'],
    ['two models took turns: a mid-session switch', SWITCHED, 'UNATTESTED'],
    ['the result credits another model than the turns', [init, turn(REQUESTED, 50), result({ 'claude-sonnet-5': { out: 50 } })], 'UNATTESTED'],
  ])('%s → %s', (_label, messages, expected) => {
    expect(verdictOf(messages as readonly unknown[])).toBe(expected);
  });

  it('an empty requested model matches nothing', () => {
    expect(hostedServedModelVerdict(hostedServedModel(observeHostedMessages([init, turn('x', 5), result({ x: { out: 5 } })])), '')).toBe('MISMATCH');
  });
});

describe('the provider: a mismatch or an unattested session is a failure, and nothing it produced is a result', () => {
  it('EXACT, a dated build, and a helper beside the requested model complete, with the attested model named', async () => {
    for (const [messages, named] of [[EXACT, REQUESTED], [DATED, `${REQUESTED}-20260915`], [HELPER, REQUESTED]] as const) {
      const outcome = await providerOver(messages).execute(request);
      expect(outcome.kind, named).toBe('completed');
      if (outcome.kind === 'completed') expect(outcome.observation.providerModel).toBe(named);
    }
  });

  it('ANOTHER MODEL: SERVED_MODEL_MISMATCH, class coder_served_model_mismatch; the runtime started and its cost is carried', async () => {
    const outcome = await providerOver(ANOTHER).execute(request);
    expect(outcome).toMatchObject({
      kind: 'failed', failure: 'SERVED_MODEL_MISMATCH', providerFailureClass: 'coder_served_model_mismatch', runtimeStarted: true, costUsdMicros: 200_000,
    });
    if (outcome.kind === 'failed') {
      expect(outcome.diagnostics).toMatchObject({ requestedModel: REQUESTED, servedModel: 'claude-sonnet-5', servedModelBasis: 'attested' });
      expect(outcome.safeMessage).not.toContain('claude-sonnet-5');
    }
  });

  it('A MID-SESSION SWITCH: SERVED_MODEL_UNATTESTED, class coder_served_model_unattested', async () => {
    const outcome = await providerOver(SWITCHED).execute(request);
    expect(outcome).toMatchObject({ kind: 'failed', failure: 'SERVED_MODEL_UNATTESTED', providerFailureClass: 'coder_served_model_unattested', runtimeStarted: true });
    if (outcome.kind === 'failed') expect(outcome.diagnostics).toMatchObject({ servedModel: null, servedModelBasis: 'mixed_turn_models' });
  });

  it('on the subscription path the stop reports no bill, as every subscription ending does', async () => {
    const outcome = await providerOver(ANOTHER, 'CLAUDE_SUBSCRIPTION').execute(request);
    expect(outcome).toMatchObject({ kind: 'failed', failure: 'SERVED_MODEL_MISMATCH', costUsdMicros: null });
  });

  it('the domain never retries either, and a person has to act', () => {
    for (const failure of ['SERVED_MODEL_MISMATCH', 'SERVED_MODEL_UNATTESTED'] as const) {
      expect(juliusCodingAgentFailureDisposition(failure)).toEqual({ code: 'WORKER_EXECUTION_FAILURE', retryable: false, operatorAction: true });
    }
  });
});
