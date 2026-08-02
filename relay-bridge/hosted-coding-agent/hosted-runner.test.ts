import { describe, expect, it } from 'vitest';
import { runHostedCodingAgent, type HostedQueryFn } from './hosted-runner';
import { DEFAULT_HOSTED_LIMITS } from './hosted-envelope';

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
