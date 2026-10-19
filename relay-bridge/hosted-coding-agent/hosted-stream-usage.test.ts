import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  NO_HOSTED_STREAM_USAGE,
  observeHostedMessages,
  type HostedObservation,
} from './hosted-observation';
import {
  createInMemoryArtifactExchange,
  createLiveHostedCodingAdapter,
} from '../julius/live-workers';
import {
  JuliusDispatchError,
  createJuliusContextSnapshot,
  safeReviewDiagnostics,
  type JuliusTask,
  type JuliusWorker,
} from '../../src/relay/mission/julius';

/**
 * WHAT A CUT-OFF RUN SPENT, WHICH IT ALWAYS KNEW AND ALWAYS THREW AWAY.
 *
 * The hosted runtime reports its usage in the terminal `result` message. A run
 * Relay aborts at its own runtime ceiling never gets one, so until now the
 * record for such a run said the cost, the input tokens and the output tokens
 * were all UNKNOWN.
 *
 * Paid run `34485676189` attempt 1 is that run: cut off at 360,000 ms with
 * twelve tool calls done, `costUsdMicros: null`. The commentary beside it in
 * `coder-envelope.ts` says it plainly — "we paid and cannot say how much."
 *
 * EVERY ASSISTANT TURN HAD ALREADY REPORTED ITS OWN USAGE. The SDK's
 * `SDKAssistantMessage` carries `message: BetaMessage`, and `BetaMessage.usage`
 * is a required field with `input_tokens`, `output_tokens`,
 * `cache_read_input_tokens` and `cache_creation_input_tokens`. Relay read none
 * of it. "The runtime reported nothing" was a fact about this parser.
 *
 * THE REPAIR IS A FLOOR, AND STAYS ONE. The sum over observed turns is a LOWER
 * BOUND on what the run consumed. It is not the runtime's total, it carries no
 * cost — an assistant turn reports tokens and never dollars — and no cost basis
 * is ever derived from it. These cases hold both halves: that the floor is
 * observed, and that it never becomes a total.
 */

const assistant = (usage: Record<string, unknown> | null, over: Record<string, unknown> = {}): unknown => ({
  type: 'assistant',
  message: usage === null ? { content: [] } : { content: [], usage },
  ...over,
});

const result = (over: Record<string, unknown> = {}): unknown => ({
  type: 'result',
  subtype: 'success',
  is_error: false,
  num_turns: 3,
  duration_ms: 1000,
  usage: { input_tokens: 9_000, output_tokens: 4_000 },
  total_cost_usd: 0.25,
  ...over,
});

const init = (): unknown => ({ type: 'system', subtype: 'init', model: 'claude-fable-5', session_id: 's' });

const observe = (messages: readonly unknown[]): HostedObservation => observeHostedMessages(messages);

/* ================================================= A the floor is observed */

describe('A — the stream reports what the terminal message never got to', () => {
  it('1. a stream with no assistant turn establishes no floor, and says so with null', () => {
    const observed = observe([init()]);
    expect(observed.streamUsage).toEqual(NO_HOSTED_STREAM_USAGE);
    // ZERO TURNS IS NOT ZERO TOKENS. A count of 0 is a true statement about
    // how many turns were seen; a token total of 0 would be a false one about
    // what they consumed.
    expect(observed.streamUsage.messages).toBe(0);
    expect(observed.streamUsage.inputTokens).toBeNull();
    expect(observed.streamUsage.outputTokens).toBeNull();
  });

  it('2. one turn with usage establishes the floor', () => {
    const observed = observe([init(), assistant({ input_tokens: 1_200, output_tokens: 300 })]);
    expect(observed.streamUsage.messages).toBe(1);
    expect(observed.streamUsage.inputTokens).toBe(1_200);
    expect(observed.streamUsage.outputTokens).toBe(300);
  });

  it('3. several turns sum', () => {
    const observed = observe([
      init(),
      assistant({ input_tokens: 1_000, output_tokens: 100 }),
      assistant({ input_tokens: 2_000, output_tokens: 250 }),
      assistant({ input_tokens: 3_000, output_tokens: 75 }),
    ]);
    expect(observed.streamUsage.messages).toBe(3);
    expect(observed.streamUsage.inputTokens).toBe(6_000);
    expect(observed.streamUsage.outputTokens).toBe(425);
  });

  it('4. cache components accumulate independently, and stay null while nobody reports them', () => {
    const observed = observe([
      init(),
      assistant({ input_tokens: 1_000, output_tokens: 100, cache_read_input_tokens: 900, cache_creation_input_tokens: null }),
      assistant({ input_tokens: 1_000, output_tokens: 100, cache_read_input_tokens: 1_100 }),
    ]);
    expect(observed.streamUsage.cacheReadInputTokens).toBe(2_000);
    // Null in the API's own types means "not reported for this turn", not zero,
    // and no turn here reported it at all.
    expect(observed.streamUsage.cacheCreationInputTokens).toBeNull();
  });

  it('5. a component only some turns report is the sum of the ones that did — a floor, not a null', () => {
    const observed = observe([
      init(),
      assistant({ input_tokens: 1_000, output_tokens: 100 }),
      assistant({ input_tokens: 1_000, output_tokens: 100, cache_read_input_tokens: 512 }),
    ]);
    expect(observed.streamUsage.cacheReadInputTokens).toBe(512);
  });

  it('6. a user message is not counted, so a tool result cannot double the floor', () => {
    const observed = observe([
      init(),
      assistant({ input_tokens: 1_000, output_tokens: 100 }),
      // The harness replaying a tool result. It carries no usage of its own,
      // and counting a usage block if one appeared there would double the
      // assistant turn beside it.
      { type: 'user', message: { content: [], usage: { input_tokens: 999_999, output_tokens: 999_999 } } },
    ]);
    expect(observed.streamUsage.messages).toBe(1);
    expect(observed.streamUsage.inputTokens).toBe(1_000);
  });

  it('7. a turn with no usage block does not count toward the turns the floor is built from', () => {
    const observed = observe([init(), assistant(null), assistant({ input_tokens: 500, output_tokens: 20 })]);
    expect(observed.streamUsage.messages).toBe(1);
    expect(observed.streamUsage.inputTokens).toBe(500);
  });

  it('8. a turn whose content is missing entirely still contributes its usage', () => {
    // The last turn of a cut-off run is the one most likely to arrive without
    // parseable content, and it is also the most interesting. An early return
    // on the content guard would drop exactly it.
    const observed = observe([init(), { type: 'assistant', message: { usage: { input_tokens: 700, output_tokens: 40 } } }]);
    expect(observed.streamUsage.messages).toBe(1);
    expect(observed.streamUsage.inputTokens).toBe(700);
  });
});

/* ================================================== B what the runtime said */

describe('B — the runtime marks its own interrupted turns, and Relay counts them', () => {
  it('9. an aborted turn is counted', () => {
    const observed = observe([
      init(),
      assistant({ input_tokens: 1_000, output_tokens: 100 }),
      assistant({ input_tokens: 1_000, output_tokens: 60 }, { aborted: true }),
    ]);
    expect(observed.streamUsage.abortedMessages).toBe(1);
    expect(observed.streamUsage.messages).toBe(2);
  });

  it('10. an aborted turn with no usage block is still counted as aborted', () => {
    const observed = observe([init(), assistant(null, { aborted: true })]);
    expect(observed.streamUsage.abortedMessages).toBe(1);
    // It contributes nothing to the floor, and says so.
    expect(observed.streamUsage.messages).toBe(0);
    expect(observed.streamUsage.inputTokens).toBeNull();
  });

  it('11. a normally completed turn is not marked aborted', () => {
    const observed = observe([init(), assistant({ input_tokens: 10, output_tokens: 1 })]);
    expect(observed.streamUsage.abortedMessages).toBe(0);
  });
});

/* ============================================ C the floor is never the total */

describe('C — a floor never becomes a total, a report, or a cost', () => {
  it('12. THE FINDING: a run cut off before any result reports UNKNOWN and a floor, together', () => {
    const observed = observe([
      init(),
      assistant({ input_tokens: 12_000, output_tokens: 900 }),
      assistant({ input_tokens: 14_000, output_tokens: 1_100 }, { aborted: true }),
      // and then nothing: Relay's abort timer fired and the runtime never
      // produced a result message.
    ]);

    // UNCHANGED, and deliberately so. The runtime reported no total and no
    // cost, and Relay still says exactly that.
    expect(observed.usage.source).toBe('unavailable');
    expect(observed.usage.inputTokens).toBeNull();
    expect(observed.usage.outputTokens).toBeNull();
    expect(observed.usage.totalCostUsd).toBeNull();
    expect(observed.resultSubtype).toBeNull();

    // AND THE FLOOR IS THERE. This is what paid run 34485676189 attempt 1 would
    // have carried: not the cost, which nobody billed us for in a message we
    // ever saw, but the work the turns themselves reported doing.
    expect(observed.streamUsage.messages).toBe(2);
    expect(observed.streamUsage.abortedMessages).toBe(1);
    expect(observed.streamUsage.inputTokens).toBe(26_000);
    expect(observed.streamUsage.outputTokens).toBe(2_000);
  });

  it('13. a completed run keeps the runtime total as the authority, beside its floor', () => {
    const observed = observe([
      init(),
      assistant({ input_tokens: 12_000, output_tokens: 900 }),
      result(),
    ]);
    expect(observed.usage.source).toBe('runtime_reported');
    expect(observed.usage.inputTokens).toBe(9_000);
    expect(observed.usage.totalCostUsd).toBe(0.25);
    // Different numbers about different things, and neither overwrote the other.
    expect(observed.streamUsage.inputTokens).toBe(12_000);
  });

  it('14. the floor carries no cost at all — not in its values, and not in its type', () => {
    const cut = observe([init(), assistant({ input_tokens: 5, output_tokens: 5 })]);
    expect(Object.keys(cut.streamUsage).some((key) => key.toLowerCase().includes('cost'))).toBe(false);
    expect(Object.keys(cut.streamUsage).some((key) => key.toLowerCase().includes('usd'))).toBe(false);
    // AND THE SHAPE ITSELF REFUSES ONE. A cost field nobody populates yet is
    // an invitation to populate it, and an assistant turn has no cost to give:
    // the runtime reports dollars once, in the result message, and a floor that
    // could carry a number would eventually be read as one.
    const declaration = readFileSync(join(process.cwd(), 'relay-bridge/hosted-coding-agent/hosted-observation.ts'), 'utf8');
    const shape = declaration.slice(declaration.indexOf('export interface HostedStreamUsage {'));
    const body = shape.slice(0, shape.indexOf('\n}'));
    expect(body.toLowerCase()).not.toContain('cost');
    expect(body.toLowerCase()).not.toContain('usd');
  });

  it('15a. the fold does not depend on where the result sits in the stream', () => {
    // The floor is a sum over the turns that reported, and a turn reports
    // whether or not a result has already been seen. Gating the fold on "no
    // result yet" would read as harmless — no SDK stream puts a turn after its
    // result — and would quietly make the record depend on message order.
    const before = observe([init(), assistant({ input_tokens: 400, output_tokens: 40 }), result()]);
    const after = observe([init(), result(), assistant({ input_tokens: 400, output_tokens: 40 })]);
    expect(after.streamUsage).toEqual(before.streamUsage);
    expect(after.streamUsage.inputTokens).toBe(400);
  });

  it('15. a result that reports nothing leaves the total UNKNOWN even when a floor exists', () => {
    // The runtime finished and reported no usage. A floor is not permission to
    // call that a report: `source` stays `unavailable`, so nothing downstream
    // can settle a budget against it.
    const observed = observe([
      init(),
      assistant({ input_tokens: 800, output_tokens: 90 }),
      result({ usage: undefined, total_cost_usd: undefined }),
    ]);
    expect(observed.usage.source).toBe('unavailable');
    expect(observed.usage.inputTokens).toBeNull();
    expect(observed.streamUsage.inputTokens).toBe(800);
  });
});

/* ============================================ D the floor reaches the record */

describe('D — a timed-out dispatch carries the floor into its durable diagnostics', () => {
  const task: JuliusTask = {
    taskId: 'task', missionId: 'mission', parentTaskId: null, dependencyIds: [],
    requiredEvidenceTypes: [], taskType: 'implementation', role: 'CODING_AGENT',
    ordinal: 1, state: 'ACTIVE',
  };
  const worker: JuliusWorker = {
    workerId: 'coder', role: 'CODING_AGENT', adapterId: 'hosted', providerId: 'anthropic',
    capabilities: ['code'], taskTypes: ['implementation'], concurrencyLimit: 1,
    timeoutMs: 360_000, maxRetries: 1, status: 'AVAILABLE',
  };
  const snapshot = createJuliusContextSnapshot({
    contextId: 'ctx', runId: 'run', task, worker, entries: [], maxCharacters: 2_000,
    missionContractRevision: 1, cardRevision: 'card', projectBrainRevision: 1,
    dependencyTaskIds: [], evidenceIds: [], findingIds: [], acceptanceCriterionIds: [],
  });

  /** The stream paid run 34485676189 attempt 1 would have produced. */
  const cutOffStream = (): HostedObservation => observe([
    init(),
    assistant({ input_tokens: 12_000, output_tokens: 900 }),
    assistant({ input_tokens: 14_000, output_tokens: 1_100, cache_read_input_tokens: 10_240 }, { aborted: true }),
  ]);

  const dispatchTimedOut = async (): Promise<JuliusDispatchError> => {
    const artifacts = createInMemoryArtifactExchange();
    artifacts.seed({ kind: 'PLAN', runId: 'run', taskId: 'plan-1', leaseGeneration: 1, role: 'PROMPT_ARCHITECT' }, 'THE PLAN');
    const adapter = createLiveHostedCodingAdapter({
      worker,
      contexts: { snapshotFor: (contextId) => (contextId === 'ctx' ? snapshot : null) },
      artifacts,
      projectId: 'project',
      apiKey: 'not-a-real-key',
      requestedModel: 'claude-fable-5',
      workspacePath: '/tmp/does-not-matter',
      testCommand: 'npm test',
      shell: {
        run: async () => ({ status: 'SUCCEEDED', exitCode: 0, stdout: 'abc123', stderr: '', invocationId: 'inv' }),
      },
      // The runtime is never reached: the fake stands in for it and returns the
      // outcome Relay's own abort timer produces.
      queryLoader: async () => (() => { throw new Error('the query function is never called'); }) as never,
      run: async () => ({
        kind: 'timed_out',
        safeMessage: 'The hosted Coding Agent exceeded its runtime bound.',
        observation: cutOffStream(),
        startedAt: '2026-09-11T00:00:00.000Z',
        completedAt: '2026-09-11T00:06:00.000Z',
      }),
    });
    try {
      await adapter.dispatch({ taskId: 'task', attempt: { leaseGeneration: 1 }, reads: { plan: { taskId: 'plan-1', leaseGeneration: 1 } }, contextId: 'ctx', taskType: 'implementation' });
    } catch (error) {
      if (error instanceof JuliusDispatchError) return error;
      throw error;
    }
    throw new Error('the dispatch was expected to be refused');
  };

  it('16. the refusal is a TIMEOUT, and it carries the floor the stream established', async () => {
    const error = await dispatchTimedOut();
    expect(error.code).toBe('TIMEOUT');
    expect(error.failureClass).toBe('coder_timed_out');
    const diagnostics = error.diagnostics as Record<string, unknown> | null;
    expect(diagnostics).not.toBeNull();
    expect(diagnostics?.streamUsageMessages).toBe(2);
    expect(diagnostics?.streamAbortedMessages).toBe(1);
    expect(diagnostics?.streamInputTokens).toBe(26_000);
    expect(diagnostics?.streamOutputTokens).toBe(2_000);
    expect(diagnostics?.streamCacheReadInputTokens).toBe(10_240);
  });

  it('17. and the money is still UNKNOWN, because the floor is not a bill', async () => {
    const diagnostics = (await dispatchTimedOut()).diagnostics as Record<string, unknown> | null;
    // THE DISTINCTION THE LEDGER DEPENDS ON. A token floor says the run did
    // work; it does not say what the provider charged. `costBasis` staying
    // UNKNOWN is what keeps the reservation held instead of settled at a
    // number nobody billed.
    expect(diagnostics?.costUsdMicros).toBeNull();
    expect(diagnostics?.costBasis).toBe('UNKNOWN');
    expect(diagnostics?.costSource).toBe('unavailable');
    expect(diagnostics?.inputTokens).toBeNull();
    expect(diagnostics?.outputTokens).toBeNull();
    // And the run did launch, which is the difference between spending nothing
    // and spending an unknown amount.
    expect(diagnostics?.runtimeStarted).toBe(true);
    expect(diagnostics?.timedOut).toBe(true);
  });

  it('18. the allowlist admits every stream column, so none is dropped on the way to the ledger', () => {
    // `safeReviewDiagnostics` rebuilds the record from its own allowlist, so a
    // field the adapter sets and the allowlist omits is discarded silently —
    // the exact three-layer miss that cost `cachedInputTokens` a landing.
    const rebuilt = safeReviewDiagnostics({
      streamUsageMessages: 2, streamAbortedMessages: 1,
      streamInputTokens: 26_000, streamOutputTokens: 2_000,
      streamCacheReadInputTokens: 10_240, streamCacheCreationInputTokens: 4_096,
    }) as Record<string, unknown> | null;
    expect(rebuilt?.streamUsageMessages).toBe(2);
    expect(rebuilt?.streamAbortedMessages).toBe(1);
    expect(rebuilt?.streamInputTokens).toBe(26_000);
    expect(rebuilt?.streamOutputTokens).toBe(2_000);
    expect(rebuilt?.streamCacheReadInputTokens).toBe(10_240);
    expect(rebuilt?.streamCacheCreationInputTokens).toBe(4_096);
  });

  it('19. a successful dispatch reports the same columns, so the two paths cannot drift', async () => {
    // Findings C and E were both this shape: a diagnostic present on one path
    // and absent on the other, discovered only when the missing path was the
    // one that mattered. Both are built by one function; this holds it.
    // The builder lives with the Claude Code provider now: it is that provider's
    // account of its own session, behind the Coding Agent port.
    const source = readFileSync(join(process.cwd(), 'relay-bridge/julius/claude-code-coding-provider.ts'), 'utf8');
    const builders = [...source.matchAll(/hostedCoderDiagnostics\(\{/gu)].length;
    expect(builders, 'the coder diagnostics must come from one builder used by every path').toBeGreaterThan(1);
    for (const column of ['streamUsageMessages', 'streamAbortedMessages', 'streamInputTokens',
      'streamOutputTokens', 'streamCacheReadInputTokens', 'streamCacheCreationInputTokens']) {
      expect((source.match(new RegExp(`${column}:`, 'gu')) ?? []).length,
        `${column} must be set exactly once, inside the shared builder`).toBe(1);
    }
  });

  it('20. every stream column reaches the exported bundle', () => {
    // The third layer. A diagnostic the allowlist admits and the dump never
    // selects lives for one paid run and is destroyed with the database.
    const dump = readFileSync(join(process.cwd(), '.github/julius-live-evidence-dump.sh'), 'utf8');
    for (const column of ['diag_streamUsageMessages', 'diag_streamAbortedMessages', 'diag_streamInputTokens',
      'diag_streamOutputTokens', 'diag_streamCacheReadInputTokens', 'diag_streamCacheCreationInputTokens']) {
      expect(dump, `${column} must reach worker-diagnostics.tsv`).toContain(`'facts'->>'${column}'`);
    }
  });
});
