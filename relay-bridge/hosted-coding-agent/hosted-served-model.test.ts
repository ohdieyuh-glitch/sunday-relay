import { describe, expect, it } from 'vitest';
import {
  HOSTED_SERVED_MODEL_BASES,
  dominantTurnModel,
  hostedServedModel,
  observeHostedMessages,
} from './hosted-observation';
import { DEFAULT_HOSTED_LIMITS, compileHostedEnvelope } from './hosted-envelope';
import type { HostedRunOutcome, HostedQueryFn } from './hosted-runner';
import { createClaudeCodeCodingAgentProvider, hostedCoderDiagnostics } from '../julius/claude-code-coding-provider';
import {
  JULIUS_SERVED_MODEL_BASES,
  flattenDiagnostics,
  safeReviewDiagnostics,
} from '../../src/relay/mission/julius';
import type { JuliusCodingAgentRequest } from '../../src/relay/mission/julius/julius-coding-agent';

/**
 * WHAT SERVED THE CODING AGENT, AS OPPOSED TO WHAT ITS RUNTIME ANNOUNCED.
 *
 * The coder's `servedModel` was the `model` field of the runtime's `init`
 * message. That message arrives before any turn exists. Paid attempt 1 (run
 * 36568129865) announced `claude-fable-5`, and its only turn then produced zero
 * tokens because the credential had no credit. The bundle still recorded
 * `served_model=claude-fable-5`, so a reader could not tell that run apart from
 * one that worked.
 *
 * A served model is now named only when two accounts agree: the turns that
 * produced output all name ONE model, and the result's own `modelUsage` credits
 * that model with output. The announcement travels beside the verdict and is
 * never consulted.
 */

const init = (model: string | null = 'claude-fable-5'): unknown => ({
  type: 'system', subtype: 'init', session_id: 'sess-1', model, claude_code_version: '2.1.0',
  apiKeySource: 'none', cwd: '/workspace/mission', tools: ['Read', 'Edit'],
});

/** One turn of the session, as the SDK delivers it: the API's own message, with its model and its usage. */
const turn = (model: string, outputTokens: number, over: Record<string, unknown> = {}): unknown => ({
  type: 'assistant', parent_tool_use_id: null, session_id: 'sess-1',
  message: { model, content: [{ type: 'text', text: 'working' }], usage: { input_tokens: 100, output_tokens: outputTokens } },
  ...over,
});

const modelUsage = (entries: Record<string, { in?: number; out: number; canonical?: string }>) =>
  Object.fromEntries(Object.entries(entries).map(([key, value]) => [key, {
    inputTokens: value.in ?? 100, outputTokens: value.out, cacheReadInputTokens: 0, cacheCreationInputTokens: 0,
    webSearchRequests: 0, costUSD: 0.01, contextWindow: 200_000, maxOutputTokens: 32_000,
    ...(value.canonical === undefined ? {} : { canonicalModel: value.canonical }),
  }]));

const result = (over: Record<string, unknown> = {}): unknown => ({
  type: 'result', subtype: 'success', is_error: false, num_turns: 2, duration_ms: 1000,
  usage: { input_tokens: 200, output_tokens: 900 }, total_cost_usd: 0.2, terminal_reason: 'completed',
  result: 'Implemented the slug.', permission_denials: [],
  modelUsage: modelUsage({ 'claude-fable-5': { out: 900 } }),
  ...over,
});

/** The coder's diagnostics as they reach the durable row: built, allowlisted, flattened. */
const durableRow = (messages: readonly unknown[], outcome: 'succeeded' | 'failed' = 'succeeded') =>
  flattenDiagnostics(safeReviewDiagnostics(hostedCoderDiagnostics({
    taskType: 'build', requestedModel: 'claude-fable-5', observed: observeHostedMessages(messages),
    limits: DEFAULT_HOSTED_LIMITS, outcome,
  })));

describe('the control case: paid attempt 1, replayed', () => {
  /**
   * RECONSTRUCTED FROM THE BUNDLE, and held to it. Attempt 1's CODING_AGENT row
   * in `worker-diagnostics.tsv` recorded:
   *   requested_model=claude-fable-5, served_model=claude-fable-5, num_turns=1,
   *   result_subtype=success, is_error=true, terminal_reason=api_error,
   *   result_class=REPORTED_ERROR, failure_reason=credit_unavailable,
   *   input_tokens=0, output_tokens=0, stream_usage_messages=1,
   *   stream_input_tokens=0, stream_output_tokens=0, runtime_started=true.
   * The replay must reproduce every one of those except `served_model`.
   * Otherwise it is not attempt 1, and the case proves nothing.
   */
  const creditError = 'API Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}';
  const attempt1 = (usage: Record<string, unknown> | undefined, syntheticModel = '<synthetic>'): readonly unknown[] => [
    init('claude-fable-5'),
    // The runtime surfaces an API failure as an assistant message with zero usage.
    turn(syntheticModel, 0, { message: { model: syntheticModel, content: [{ type: 'text', text: creditError }], usage: { input_tokens: 0, output_tokens: 0 } } }),
    result({
      subtype: 'success', is_error: true, terminal_reason: 'api_error', num_turns: 1, result: creditError,
      usage: { input_tokens: 0, output_tokens: 0 }, total_cost_usd: 0,
      ...(usage === undefined ? { modelUsage: undefined } : { modelUsage: usage }),
    }),
  ];

  it.each([
    ['an empty modelUsage', modelUsage({})],
    ['a modelUsage that names the announced model with zero output', modelUsage({ 'claude-fable-5': { in: 0, out: 0 } })],
    ['no modelUsage at all', undefined],
  ])('with %s, the replay reproduces the recorded row and names NO served model', (_label, usage) => {
    const row = durableRow(attempt1(usage), 'failed');
    // The recorded columns, reproduced.
    expect(row).toMatchObject({
      diag_requestedModel: 'claude-fable-5', diag_numTurns: 1, diag_resultSubtype: 'success', diag_isError: true,
      diag_terminalReason: 'api_error', diag_resultClass: 'REPORTED_ERROR', diag_failureReason: 'credit_unavailable',
      diag_inputTokens: 0, diag_outputTokens: 0, diag_streamUsageMessages: 1, diag_streamInputTokens: 0,
      diag_streamOutputTokens: 0, diag_runtimeStarted: true,
    });
    // The one column that was wrong. The announcement is still on the row, under its own name.
    expect(row.diag_servedModel, 'attempt 1 served nothing, and the row must not say otherwise').toBeNull();
    expect(row.diag_servedModelBasis).toBe('no_output_turns');
    expect(row.diag_announcedModel).toBe('claude-fable-5');
    expect(row.diag_turnModel).toBeNull();
    expect(row.diag_turnModelCount).toBe(0);
  });

  it('the placeholder model is not what excludes the turn: zero output is', () => {
    // A runtime that labelled its error message with the real model id still served nothing.
    const row = durableRow(attempt1(modelUsage({ 'claude-fable-5': { in: 0, out: 0 } }), 'claude-fable-5'), 'failed');
    expect(row.diag_servedModel).toBeNull();
    expect(row.diag_servedModelBasis).toBe('no_output_turns');
  });

  it('the rule this replaces would have passed it', () => {
    // Held so the control stays a control. If the announcement stopped naming the
    // model, this case would pass for the wrong reason.
    expect(observeHostedMessages(attempt1(modelUsage({}))).actualModel).toBe('claude-fable-5');
  });
});

describe('a served model is named only when the turns and the result agree', () => {
  it('a healthy session: one model on every output-bearing turn, credited by the result', () => {
    const row = durableRow([init(), turn('claude-fable-5', 400), turn('claude-fable-5', 500), result()]);
    expect(row).toMatchObject({
      diag_servedModel: 'claude-fable-5', diag_servedModelBasis: 'attested', diag_announcedModel: 'claude-fable-5',
      diag_turnModel: 'claude-fable-5', diag_turnModelCount: 1, diag_resultModelCount: 1,
      diag_resultModelFirst: 'claude-fable-5', diag_resultModelFirstOutputTokens: 900,
      diag_resultModelSecond: null, diag_resultModelSecondOutputTokens: null,
    });
  });

  it('a helper model in modelUsage is reported beside the verdict and does not unseat it', () => {
    const row = durableRow([init(), turn('claude-fable-5', 900), result({
      modelUsage: modelUsage({ 'claude-helper-1': { in: 40, out: 12 }, 'claude-fable-5': { out: 900 } }),
    })]);
    expect(row).toMatchObject({
      diag_servedModel: 'claude-fable-5', diag_servedModelBasis: 'attested', diag_resultModelCount: 2,
      // Largest producer first, whatever order the runtime wrote them in.
      diag_resultModelFirst: 'claude-fable-5', diag_resultModelFirstOutputTokens: 900,
      diag_resultModelSecond: 'claude-helper-1', diag_resultModelSecondInputTokens: 40, diag_resultModelSecondOutputTokens: 12,
    });
  });

  it('a fallback is recorded as what it is: announced one model, served another', () => {
    // The row says what served. Whether that model is the one requested is for the reader to judge, not this parser.
    const row = durableRow([init('claude-fable-5'), turn('claude-sonnet-5', 700), result({
      modelUsage: modelUsage({ 'claude-sonnet-5': { out: 700 } }),
    })]);
    expect(row).toMatchObject({
      diag_requestedModel: 'claude-fable-5', diag_announcedModel: 'claude-fable-5',
      diag_servedModel: 'claude-sonnet-5', diag_servedModelBasis: 'attested',
    });
  });

  it('turns that name two models: no single model served the dispatch', () => {
    const row = durableRow([init(), turn('claude-fable-5', 300), turn('claude-sonnet-5', 600), result({
      modelUsage: modelUsage({ 'claude-fable-5': { out: 300 }, 'claude-sonnet-5': { out: 600 } }),
    })]);
    expect(row).toMatchObject({
      diag_servedModel: null, diag_servedModelBasis: 'mixed_turn_models',
      diag_turnModel: 'claude-sonnet-5', diag_turnModelCount: 2,
    });
  });

  it('a stream cut off before its result: the turns are evidence, the verdict waits for the runtime', () => {
    const row = durableRow([init(), turn('claude-fable-5', 800)], 'failed');
    expect(row).toMatchObject({
      diag_servedModel: null, diag_servedModelBasis: 'no_result',
      diag_turnModel: 'claude-fable-5', diag_turnModelCount: 1, diag_resultModelCount: null,
    });
  });

  it('a result that carried no modelUsage is not a result that agreed', () => {
    const row = durableRow([init(), turn('claude-fable-5', 800), result({ modelUsage: undefined })]);
    expect(row).toMatchObject({ diag_servedModel: null, diag_servedModelBasis: 'no_model_usage', diag_resultModelCount: null });
  });

  it.each([
    ['credits a different model', modelUsage({ 'claude-sonnet-5': { out: 800 } })],
    ['names the model with zero output', modelUsage({ 'claude-fable-5': { out: 0 } })],
    ['names no model at all', modelUsage({})],
  ])('a result that %s disagrees with the turns', (_label, usage) => {
    const row = durableRow([init(), turn('claude-fable-5', 800), result({ modelUsage: usage })]);
    expect(row.diag_servedModel).toBeNull();
    expect(row.diag_servedModelBasis).toBe('result_disagrees');
  });

  it('an alias key is matched through the SDK\'s own canonical model id', () => {
    const row = durableRow([init(), turn('claude-fable-5', 800), result({
      modelUsage: modelUsage({ fable: { out: 800, canonical: 'claude-fable-5' } }),
    })]);
    expect(row).toMatchObject({ diag_servedModel: 'claude-fable-5', diag_servedModelBasis: 'attested', diag_resultModelFirst: 'fable' });
  });

  it('a subagent\'s turn and an error delivered as a message are not the session\'s turns', () => {
    const observed = observeHostedMessages([
      init(), turn('claude-fable-5', 800),
      turn('claude-helper-1', 500, { parent_tool_use_id: 'toolu_1' }),
      turn('claude-other-2', 50, { error: 'rate_limit' }),
      result({ modelUsage: modelUsage({ 'claude-fable-5': { out: 800 }, 'claude-helper-1': { out: 500 } }) }),
    ]);
    expect(observed.turnModels).toEqual([{ model: 'claude-fable-5', turns: 1, outputTokens: 800 }]);
    expect(hostedServedModel(observed)).toEqual({ servedModel: 'claude-fable-5', basis: 'attested' });
  });

  it('more entries than the columns hold: the count says so, and the largest three are kept', () => {
    const row = durableRow([init(), turn('claude-fable-5', 900), result({
      modelUsage: modelUsage({ a: { out: 1 }, b: { out: 30 }, 'claude-fable-5': { out: 900 }, c: { out: 20 } }),
    })]);
    expect(row).toMatchObject({
      diag_resultModelCount: 4,
      diag_resultModelFirst: 'claude-fable-5', diag_resultModelSecond: 'b', diag_resultModelThird: 'c',
    });
  });

  it('a turn tally is per model and in first-seen order; the dominant model is evidence, not the verdict', () => {
    const observed = observeHostedMessages([init(), turn('m-one', 10), turn('m-two', 30), turn('m-one', 25), result()]);
    expect(observed.turnModels).toEqual([
      { model: 'm-one', turns: 2, outputTokens: 35 },
      { model: 'm-two', turns: 1, outputTokens: 30 },
    ]);
    expect(dominantTurnModel(observed)).toBe('m-one');
    expect(hostedServedModel(observed).servedModel).toBeNull();
  });
});

describe('the new columns survive the allowlist, and only as what they are', () => {
  it('the domain\'s closed set of bases is the adapter\'s, member for member', () => {
    expect([...JULIUS_SERVED_MODEL_BASES]).toEqual([...HOSTED_SERVED_MODEL_BASES]);
  });

  it('a basis outside the set, and a credential-shaped model id, become null on the way to the ledger', () => {
    const safe = safeReviewDiagnostics({
      servedModelBasis: 'trust_me', announcedModel: 'sk-ant-api03-notakey', turnModel: 'claude fable', resultModelFirst: 'Bearer abc',
      resultModelFirstOutputTokens: -5, resultModelSecondInputTokens: 1.5, turnModelCount: 2, resultModelCount: 3,
    });
    expect(safe).toMatchObject({
      servedModelBasis: null, announcedModel: null, turnModel: null, resultModelFirst: null,
      resultModelFirstOutputTokens: null, resultModelSecondInputTokens: null, turnModelCount: 2, resultModelCount: 3,
    });
  });

  it('a failed dispatch that observed nothing reports every new column as unknown, not as a verdict', () => {
    const row = flattenDiagnostics(safeReviewDiagnostics(hostedCoderDiagnostics({
      taskType: 'build', requestedModel: 'claude-fable-5', observed: null, limits: DEFAULT_HOSTED_LIMITS, outcome: 'failed',
    })));
    for (const key of ['diag_servedModel', 'diag_servedModelBasis', 'diag_announcedModel', 'diag_turnModel', 'diag_turnModelCount', 'diag_resultModelCount', 'diag_resultModelFirst']) {
      expect(row[key], `${key} must be unknown when nothing was observed`).toBeNull();
    }
  });
});

describe('the completed outcome carries the attested model, the same answer as its diagnostics', () => {
  const request = {
    version: 'julius-coding-agent.v1', identity: { runId: 'r', missionId: 'm', taskId: 't', taskType: 'build', contextId: 'c' },
    workspacePath: '/workspace/mission', contract: null, plan: 'THE PLAN',
    sections: { acceptedGuidance: [], architecture: [], findings: [], continuation: [], missionContext: [] },
    permissions: { mayEditFiles: true, mayRunCommands: false, mayUseNetwork: false, permittedPaths: [], outOfScope: [], prohibitedActions: [] },
    requiredEvidence: ['TEST'], budget: { usdMicros: null }, protocol: { participation: 'HOW TO ASK', researchAuthority: 'WHAT TO READ' },
  } as unknown as JuliusCodingAgentRequest;
  const providerOver = (messages: readonly unknown[]) => createClaudeCodeCodingAgentProvider({
    apiKey: 'FAKETESTNOTREAL', requestedModel: 'claude-fable-5',
    run: (async (): Promise<HostedRunOutcome> => ({
      kind: 'completed', observation: observeHostedMessages(messages),
      envelope: compileHostedEnvelope({ workspacePath: '/workspace/mission' }), startedAt: 't', completedAt: 't',
    })) as never,
    queryLoader: async () => (() => (async function* () { /* none */ })()) as HostedQueryFn,
  });

  it('attested: the observation names the served model', async () => {
    const outcome = await providerOver([init(), turn('claude-fable-5', 900), result()]).execute(request);
    expect(outcome.kind).toBe('completed');
    if (outcome.kind !== 'completed') return;
    expect(outcome.observation.providerModel).toBe('claude-fable-5');
    expect(outcome.observation.diagnostics).toMatchObject({ servedModel: 'claude-fable-5', servedModelBasis: 'attested' });
  });

  it('announced but not attested: the observation names nobody, and never the announcement', async () => {
    const outcome = await providerOver([init('claude-fable-5'), turn('claude-sonnet-5', 900), result()]).execute(request);
    if (outcome.kind !== 'completed') throw new Error('expected a completed outcome');
    expect(outcome.observation.providerModel).toBeNull();
    expect(outcome.observation.diagnostics).toMatchObject({ servedModel: null, servedModelBasis: 'result_disagrees', announcedModel: 'claude-fable-5' });
  });
});
