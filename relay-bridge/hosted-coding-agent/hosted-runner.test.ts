import { describe, expect, it } from 'vitest';
import { runHostedCodingAgent, type HostedQueryFn } from './hosted-runner';
import { DEFAULT_HOSTED_LIMITS, hostedLimitsForAllocation } from './hosted-envelope';

/**
 * The full hosted pipeline, driven by a fake `query` that yields the real SDK
 * message shapes. No provider call, no spend — and every containment and
 * truthfulness rule asserted before a single paid execution exists.
 */

const WS = '/data/relay-workspaces/prj/run-1';
const clock = () => {
  let n = 0;
  return () => new Date(Date.UTC(2026, 7, 2, 12, 0, n++)).toISOString();
};

const init = (over: Record<string, unknown> = {}) => ({
  type: 'system', subtype: 'init', model: 'claude-sonnet-5-20260114',
  claude_code_version: '2.1.220', apiKeySource: 'ANTHROPIC_API_KEY',
  cwd: WS, tools: ['Read', 'Glob', 'Grep', 'Edit'], ...over,
});
const result = (over: Record<string, unknown> = {}) => ({
  type: 'result', subtype: 'success', is_error: false, result: 'done',
  num_turns: 2, duration_ms: 1200, total_cost_usd: 0.01,
  usage: { input_tokens: 500, output_tokens: 60 }, permission_denials: [], ...over,
});

const fakeQuery = (messages: readonly unknown[]): { fn: HostedQueryFn; seen: Record<string, unknown>[] } => {
  const seen: Record<string, unknown>[] = [];
  const fn: HostedQueryFn = (params) => {
    seen.push(params.options);
    return (async function* () { for (const m of messages) yield m; })();
  };
  return { fn, seen };
};

const run = (messages: readonly unknown[], over: Partial<Parameters<typeof runHostedCodingAgent>[0]> = {}) => {
  const { fn, seen } = fakeQuery(messages);
  return runHostedCodingAgent({
    queryFn: fn, prompt: 'implement the normalizer', workspacePath: WS,
    apiKey: 'sk-ant-SECRET-VALUE', requestedModel: 'claude-sonnet-5',
    now: clock(), ...over,
  }).then((outcome) => ({ outcome, options: seen[0] }));
};

describe('the options actually handed to the runtime', () => {
  it('pins cwd, restricts tools, and loads no settings source', async () => {
    const { options } = await run([init(), result()]);
    expect(options.cwd).toBe(WS);
    expect(options.allowedTools).toEqual(['Read', 'Glob', 'Grep', 'Edit']);
    expect(options.disallowedTools).toContain('Bash');
    expect(options.settingSources).toEqual([]);
    expect(options.maxTurns).toBe(DEFAULT_HOSTED_LIMITS.maxTurns);
  });

  it('passes the credential only through the child environment', async () => {
    const { options } = await run([init(), result()]);
    const env = options.env as Record<string, string>;
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-SECRET-VALUE');
    // Everything else on the host is absent by construction.
    expect(env.RELAY_BRIDGE_API_TOKEN).toBeUndefined();
    expect(env.XAI_API_KEY).toBeUndefined();
    const withoutEnv = { ...options, env: undefined };
    expect(JSON.stringify(withoutEnv)).not.toContain('sk-ant');
  });

  it('sends a requested model, and sends none when none was requested', async () => {
    expect((await run([init(), result()])).options.model).toBe('claude-sonnet-5');
    const none = await run([init(), result()], { requestedModel: null });
    expect(none.options.model).toBeUndefined();
  });
});

describe('a completed run reports observed identity', () => {
  it('reports the model the runtime answered with, not the one requested', async () => {
    const { outcome } = await run([init(), result()]);
    expect(outcome.kind).toBe('completed');
    if (outcome.kind !== 'completed') return;
    expect(outcome.observation.actualModel).toBe('claude-sonnet-5-20260114');
    expect(outcome.envelope.model).toBe('claude-sonnet-5');
    expect(outcome.observation.actualModel).not.toBe(outcome.envelope.model);
  });

  it('carries runtime-reported usage and cost', async () => {
    const { outcome } = await run([init(), result()]);
    if (outcome.kind !== 'completed') throw new Error('expected completed');
    expect(outcome.observation.usage.source).toBe('runtime_reported');
    expect(outcome.observation.usage.totalCostUsd).toBeCloseTo(0.01);
  });
});

describe('Relay refuses results a clean exit would otherwise pass', () => {
  it('refuses a run the runtime granted Bash to, despite a success result', async () => {
    const { outcome } = await run([init({ tools: ['Read', 'Edit', 'Bash'] }), result()]);
    expect(outcome.kind).toBe('refused');
    if (outcome.kind !== 'refused') return;
    expect(outcome.safeMessage).toContain('Bash');
  });

  it('refuses a run that started outside the isolated workspace', async () => {
    const { outcome } = await run([init({ cwd: '/home/founder/sunday-relay-product' }), result()]);
    expect(outcome.kind).toBe('refused');
  });

  it('refuses a stream with no init, because the envelope cannot be checked', async () => {
    const { outcome } = await run([result()]);
    expect(outcome.kind).toBe('refused');
    if (outcome.kind !== 'refused') return;
    expect(outcome.safeMessage).toContain('initialization');
  });

  it('refuses a run whose reported cost exceeds the ceiling', async () => {
    const { outcome } = await run([init(), result({ total_cost_usd: 9.99 })]);
    expect(outcome.kind).toBe('refused');
    if (outcome.kind !== 'refused') return;
    expect(outcome.safeMessage).toContain('ceiling');
  });

  it('still reports what it observed on a refusal', async () => {
    // A refused run owes an honest receipt too.
    const { outcome } = await run([init({ tools: ['Read', 'Bash'] }), result()]);
    if (outcome.kind !== 'refused') throw new Error('expected refused');
    expect(outcome.observation.actualModel).toBe('claude-sonnet-5-20260114');
  });
});

describe('stopping a hosted run', () => {
  it('reports a cancelled run as cancelled, never as completed', async () => {
    const { fn } = fakeQuery([init()]);
    const outcome = await runHostedCodingAgent({
      queryFn: (p) => {
        const inner = fn(p);
        return (async function* () {
          for await (const m of inner) yield m;
          throw new Error('aborted');
        })();
      },
      prompt: 'x', workspacePath: WS, apiKey: 'k', requestedModel: null,
      now: clock(), onCancel: (cancel) => cancel(),
    });
    expect(outcome.kind).toBe('cancelled');
  });

  it('reduces a provider error to a fixed sentence that cannot quote the request', async () => {
    const outcome = await runHostedCodingAgent({
      queryFn: () => (async function* () {
        throw new Error('401 from https://api.anthropic.com with x-api-key sk-ant-LEAKED');
      })(),
      prompt: 'x', workspacePath: WS, apiKey: 'sk-ant-LEAKED', requestedModel: null, now: clock(),
    });
    expect(outcome.kind).toBe('launch_failed');
    expect(JSON.stringify(outcome)).not.toContain('sk-ant');
    expect(JSON.stringify(outcome)).not.toContain('api.anthropic.com');
  });
});

/**
 * PAID MISSION 5 STOPPED HERE AND THE RECORD COULD NOT SAY WHY.
 *
 * Its coder ran six of twenty-six turns, made five tool calls, changed nothing
 * and cost $0.885661. `worker-diagnostics.tsv` carried every fact about the
 * SHAPE of that failure and none about its cause, because the cause was in a
 * thrown error the runner reduced to a fixed sentence — correctly, since a
 * provider error can quote the request and the request can quote the
 * credential.
 *
 * The fixed sentence stays. What is new is that the error is CLASSIFIED before
 * it is dropped: matched against a pattern table that returns a constant, so
 * the reason is recordable and the text still never leaves.
 */
describe('a provider error is classified on its way to being discarded', () => {
  const throwsAfterInit = (message: string) => runHostedCodingAgent({
    queryFn: () => (async function* () {
      yield init();
      throw new Error(message);
    })(),
    prompt: 'x', workspacePath: WS, apiKey: 'sk-ant-SECRET-VALUE', requestedModel: null, now: clock(),
  });

  it('names the reason a run stopped part-way, without repeating one character of it', async () => {
    const outcome = await throwsAfterInit('API Error: 429 {"type":"rate_limit_error","message":"rate limit for sk-ant-api03-AAAABBBB"}');
    expect(outcome.kind).toBe('refused');
    if (outcome.kind !== 'refused') throw new Error('expected refused');
    expect(outcome.refusalCode).toBe('coder_provider_error_after_init');
    expect(outcome.failureReason).toBe('rate_limited');
    const rendered = JSON.stringify(outcome);
    for (const fragment of ['sk-ant', 'api03', 'AAAABBBB', 'rate_limit_error', '429']) {
      expect(rendered.includes(fragment), `${fragment} escaped`).toBe(false);
    }
  });

  it('distinguishes the ordinary long-run failures from one another', async () => {
    const cases = [
      ['API Error: 529 overloaded_error', 'provider_overloaded'],
      ['prompt is too long: 300000 tokens > 200000 maximum', 'context_length_exceeded'],
      ['terminated: stream disconnected after 6 turns', 'stream_interrupted'],
    ] as const;
    for (const [message, reason] of cases) {
      const outcome = await throwsAfterInit(message);
      if (outcome.kind !== 'refused') throw new Error('expected refused');
      expect(outcome.failureReason, message).toBe(reason);
    }
  });

  it('classifies a launch failure the same way, and still quotes nothing', async () => {
    const outcome = await runHostedCodingAgent({
      queryFn: () => (async function* () {
        throw new Error('401 from https://api.anthropic.com with x-api-key sk-ant-LEAKED');
      })(),
      prompt: 'x', workspacePath: WS, apiKey: 'sk-ant-LEAKED', requestedModel: null, now: clock(),
    });
    expect(outcome.kind).toBe('launch_failed');
    if (outcome.kind !== 'launch_failed') throw new Error('expected launch_failed');
    expect(outcome.failureReason).toBe('provider_auth_rejected');
    expect(JSON.stringify(outcome)).not.toContain('sk-ant');
  });

  it('says "no_message" when the throw carried no message at all', async () => {
    // Unknown stays Unknown: a throw with nothing in it is not an execution
    // error we recognised, and `unclassified` would claim we read something.
    const outcome = await throwsAfterInit('');
    if (outcome.kind !== 'refused') throw new Error('expected refused');
    expect(outcome.failureReason).toBe('no_message');
  });

  it('gives a cancellation and a timeout no provider reason, because neither is one', async () => {
    // The abort that Relay itself raised would classify as a broken stream and
    // say something false beside `cancelled`.
    const cancelled = await runHostedCodingAgent({
      queryFn: () => (async function* () { yield init(); throw new Error('The operation was aborted'); })(),
      prompt: 'x', workspacePath: WS, apiKey: 'k', requestedModel: null, now: clock(),
      onCancel: (cancel) => cancel(),
    });
    expect(cancelled.kind).toBe('cancelled');
    expect((cancelled as { failureReason?: unknown }).failureReason).toBeUndefined();
  });
});

/**
 * DEFECT 1 (paid run 34037313976): the mission authorised $20 and the hosted
 * run was refused at 50 cents AFTER the work was done. The limit is now what
 * Julius reserved; these cases hold both ends of that seam.
 */
describe('the execution limit is the allocation Julius reserved', () => {
  it('a run over 50¢ SUCCEEDS when Julius allocated more, and is refused when it did not', async () => {
    const messages = [init(), result({ total_cost_usd: 0.9 })];
    const granted = await run(messages, { limits: hostedLimitsForAllocation(5_000_000) });
    expect(granted.outcome.kind).toBe('completed');
    const ungoverned = await run(messages);
    expect(ungoverned.outcome.kind).toBe('refused');
    if (ungoverned.outcome.kind === 'refused') expect(ungoverned.outcome.refusalCode).toBe('coder_cost_exceeded');
  });

  it('a run over its ALLOCATION is still refused, however large the mission budget was', async () => {
    const { outcome } = await run([init(), result({ total_cost_usd: 5.01 })], { limits: hostedLimitsForAllocation(5_000_000) });
    expect(outcome.kind).toBe('refused');
    if (outcome.kind === 'refused') expect(outcome.refusalCode).toBe('coder_cost_exceeded');
  });

  it('tells the runtime to stop at the allocation, in dollars, alongside the turn bound', async () => {
    const { options } = await run([init(), result()], { limits: hostedLimitsForAllocation(5_000_000) });
    expect(options.maxBudgetUsd).toBe(5);
    expect(options.maxTurns).toBe(DEFAULT_HOSTED_LIMITS.maxTurns);
    const ungoverned = await run([init(), result()]);
    expect(ungoverned.options.maxBudgetUsd, 'the conservative default still binds the runtime').toBe(0.5);
  });

  it('rounds the allocation DOWN to whole cents, never admitting more than the reservation', () => {
    expect(hostedLimitsForAllocation(1_234_567).maxCostCents).toBe(123);
    expect(hostedLimitsForAllocation(0).maxCostCents).toBe(0);
    expect(() => hostedLimitsForAllocation(-1)).toThrow('hosted_allocation_invalid');
    expect(() => hostedLimitsForAllocation(Number.NaN)).toThrow('hosted_allocation_invalid');
    expect(hostedLimitsForAllocation(5_000_000).maxRuntimeMs).toBe(DEFAULT_HOSTED_LIMITS.maxRuntimeMs);
  });

  it('a runtime budget stop is a COST refusal, not an untrusted result', async () => {
    const { outcome } = await run(
      [init(), result({ subtype: 'error_max_budget_usd', is_error: true, total_cost_usd: 5.0 })],
      { limits: hostedLimitsForAllocation(5_000_000) },
    );
    expect(outcome.kind).toBe('refused');
    if (outcome.kind !== 'refused') return;
    expect(outcome.refusalCode).toBe('coder_cost_exceeded');
    expect(outcome.safeMessage).toContain('500¢');
  });

  it('Unknown cost stays Unknown and is not refused as if it were over', async () => {
    const { outcome } = await run([init(), result({ total_cost_usd: undefined, usage: undefined })], { limits: hostedLimitsForAllocation(10_000) });
    expect(outcome.kind).toBe('completed');
    if (outcome.kind === 'completed') expect(outcome.observation.usage.source).toBe('unavailable');
  });
});
