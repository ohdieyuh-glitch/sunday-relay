import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  AGENTIC_ARCHITECT_ALLOWED_TOOLS,
  AGENTIC_ARCHITECT_DEFAULT_MAX_COST_CENTS,
  AGENTIC_ARCHITECT_DEFAULT_MAX_TURNS,
  AGENTIC_ARCHITECT_READ_TOOLS,
  JULIUS_ARCHITECT_RUNTIME_DEFAULT,
  agenticArchitectChildEnv,
  agenticArchitectToolAuthority,
  createAgentSdkArchitectAdapter,
  resolveJuliusArchitectRuntime,
  runAgenticArchitect,
  type AgenticArchitectSlotRun,
} from './hosted-architect';
import { HOSTED_CHILD_ENV_KEYS, HOSTED_CHILD_MODEL_PIN_KEYS } from './hosted-envelope';
import type { HostedQueryFn } from './hosted-runner';
import { JuliusDispatchError, type JuliusProviderAdapter } from '../../src/relay/mission/julius/julius-router';

/**
 * THE AGENTIC ARCHITECT RUNTIME, PROVEN OFFLINE. The SDK is faked at its boundary — the `query` function — exactly as
 * the Coding Agent's SDK tests fake it: real message shapes in, the real runner, envelope, authority and accounting.
 * No process is spawned and no provider is called.
 */

const MODEL = 'claude-opus-5-5';
const ARCHITECT_KEY = 'FAKETESTNOTREAL-architect-key';
const CODER_KEY = 'FAKETESTNOTREAL-coder-key';
const workspace = mkdtempSync(join(tmpdir(), 'agentic-architect-'));
mkdirSync(join(workspace, 'src'));
writeFileSync(join(workspace, 'src', 'a.ts'), 'export const a = 1;\n');
const outside = mkdtempSync(join(tmpdir(), 'agentic-architect-outside-'));
writeFileSync(join(outside, 'secret.txt'), 'not yours');
afterAll(() => { rmSync(workspace, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); });

const PLAN = { objectiveSummary: 'Plan the change.' };

interface Call { readonly prompt: string; readonly options: Record<string, unknown> }

/** A scripted session. `cost` null reports no figure; `served` names the answering model. */
function session(input: {
  readonly cost?: number | null; readonly served?: string; readonly answer?: unknown;
  readonly tools?: readonly string[]; readonly subtype?: string;
} = {}) {
  return (options: Record<string, unknown>): unknown[] => {
    const served = input.served ?? MODEL;
    const answer = input.answer ?? PLAN;
    return [
      { type: 'system', subtype: 'init', session_id: 'sess-arch', model: MODEL, cwd: options.cwd, tools: input.tools ?? [...AGENTIC_ARCHITECT_ALLOWED_TOOLS], apiKeySource: 'ANTHROPIC_API_KEY' },
      { type: 'assistant', parent_tool_use_id: null, request_id: 'req_arch_1', message: { id: 'msg_arch_1', model: served, usage: { input_tokens: 900, output_tokens: 300 }, content: [{ type: 'tool_use', name: 'StructuredOutput', input: answer }] } },
      {
        type: 'result', subtype: input.subtype ?? 'success', is_error: (input.subtype ?? 'success') !== 'success', terminal_reason: 'completed', result: '',
        num_turns: 2, duration_ms: 5, permission_denials: [],
        ...(input.cost === null ? {} : { total_cost_usd: input.cost ?? 0.123456, usage: { input_tokens: 900, output_tokens: 300 } }),
        modelUsage: { [served]: { inputTokens: 900, outputTokens: 300 } },
        structured_output: answer,
      },
    ];
  };
}

/** A fake `query` that records every call and plays one script per call. */
function fakeSdk(scripts: Array<(options: Record<string, unknown>) => unknown[] | 'hang' | Error>): { query: HostedQueryFn; calls: Call[] } {
  const calls: Call[] = [];
  const query: HostedQueryFn = ({ prompt, options }) => {
    calls.push({ prompt, options });
    const script = scripts[Math.min(calls.length - 1, scripts.length - 1)]!;
    return (async function* () {
      const played = script(options);
      if (played === 'hang') {
        const controller = options.abortController as AbortController;
        await new Promise<void>((_, reject) => controller.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true }));
        return;
      }
      if (played instanceof Error) throw played;
      for (const message of played) yield message;
    })();
  };
  return { query, calls };
}

const LIMITS = { maxTurns: 16, maxCostCents: 100, maxRuntimeMs: 5_000 };
const REQUEST = { instructions: 'CHARTER', input: 'PACKET', schema: { name: 'plan', schema: { type: 'object' } } };

/** A minimal stand-in for the existing slot: one ask through `run`, a result in the slot's own usage shape. */
const slotOf = (run: AgenticArchitectSlotRun): JuliusProviderAdapter => ({
  adapterId: 'agentic-architect-agent-sdk',
  async dispatch() {
    const outcome = await run(REQUEST);
    if (!outcome.ok) throw new Error('unreachable');
    return {
      workerId: 'agentic-architect-sdk', providerId: 'anthropic', status: 'SUCCEEDED', safeSummary: 'plan', evidence: [],
      usage: { inputTokens: 1, outputTokens: 1, costBasis: 'UNKNOWN', billingPath: 'API_BILLED' },
      diagnostics: { transport: 'openai', costBasis: 'UNKNOWN' },
    };
  },
});

const adapterWith = (query: HostedQueryFn, overrides: Partial<Parameters<typeof createAgentSdkArchitectAdapter>[0]> = {}) =>
  createAgentSdkArchitectAdapter({
    adapterId: 'agentic-architect-agent-sdk', requestedModel: MODEL, apiKey: ARCHITECT_KEY, workspacePath: workspace,
    maxRuntimeMs: 5_000, queryLoader: async () => query, host: { path: '/usr/bin', home: '/home/architect' },
    slot: slotOf, ...overrides,
  });

/* --------------------------------------------------------------------------------------------- the switch */

describe('JULIUS_ARCHITECT_RUNTIME', () => {
  it('defaults to the existing Messages runner when unset or empty', () => {
    expect(JULIUS_ARCHITECT_RUNTIME_DEFAULT).toBe('messages');
    expect(resolveJuliusArchitectRuntime({})).toEqual({ ok: true, runtime: 'messages' });
    expect(resolveJuliusArchitectRuntime({ JULIUS_ARCHITECT_RUNTIME: '  ' })).toEqual({ ok: true, runtime: 'messages' });
  });
  it('selects the SDK runner only on the exact word agent_sdk', () => {
    expect(resolveJuliusArchitectRuntime({ JULIUS_ARCHITECT_RUNTIME: 'agent_sdk' })).toEqual({ ok: true, runtime: 'agent_sdk' });
    expect(resolveJuliusArchitectRuntime({ JULIUS_ARCHITECT_RUNTIME: 'messages' })).toEqual({ ok: true, runtime: 'messages' });
  });
  it.each(['agent-sdk', 'AGENT_SDK', 'sdk', 'openai'])('refuses %s rather than defaulting', (value) => {
    expect(resolveJuliusArchitectRuntime({ JULIUS_ARCHITECT_RUNTIME: value })).toEqual({ ok: false, refusal: 'architect_runtime_unknown' });
  });
});

/* --------------------------------------------------------------------------------------------- the tools */

describe('the architect may use approved read-only tools only (default deny)', () => {
  const hook = agenticArchitectToolAuthority({ workspacePath: workspace });
  const ask = (tool_name: string, tool_input: Record<string, unknown> = {}) => hook({ tool_name, tool_input });
  const denied = (out: unknown): boolean => typeof out === 'object' && out !== null && 'hookSpecificOutput' in out;

  it('the allow list is exactly Read, Grep and Glob plus the SDK answer carrier', () => {
    expect([...AGENTIC_ARCHITECT_READ_TOOLS]).toEqual(['Read', 'Grep', 'Glob']);
    expect([...AGENTIC_ARCHITECT_ALLOWED_TOOLS]).toEqual(['Read', 'Grep', 'Glob', 'StructuredOutput']);
  });

  it('allows a read and a search inside the workspace', async () => {
    expect(denied(await ask('Read', { file_path: join(workspace, 'src', 'a.ts') }))).toBe(false);
    expect(denied(await ask('Grep', { pattern: 'export', path: workspace }))).toBe(false);
    expect(denied(await ask('Glob', { pattern: 'src/**/*.ts' }))).toBe(false);
    expect(denied(await ask('StructuredOutput', { objectiveSummary: 'x' }))).toBe(false);
  });

  it.each([
    ['Write', { file_path: join(workspace, 'new.ts'), content: 'x' }],
    ['Edit', { file_path: join(workspace, 'src', 'a.ts'), old_string: '1', new_string: '2' }],
    ['MultiEdit', { file_path: join(workspace, 'src', 'a.ts') }],
    ['NotebookEdit', { notebook_path: join(workspace, 'n.ipynb') }],
    ['Bash', { command: 'env' }],
    ['WebFetch', { url: 'https://example.com' }],
    ['WebSearch', { query: 'x' }],
    ['Task', { prompt: 'x' }],
    ['mcp__evil__tool', {}],
    ['', {}],
  ])('denies %s', async (tool, input) => {
    expect(denied(await ask(tool, input))).toBe(true);
  });

  it('confines an allowed read to the workspace by real path', async () => {
    expect(denied(await ask('Read', { file_path: join(outside, 'secret.txt') }))).toBe(true);
    expect(denied(await ask('Glob', { pattern: '../**' }))).toBe(true);
  });

  it('the session is offered only the read tools, approves nothing else and asks nobody', async () => {
    const { query, calls } = fakeSdk([session()]);
    await runAgenticArchitect({ queryFn: query, request: REQUEST, apiKey: ARCHITECT_KEY, requestedModel: MODEL, workspacePath: workspace, limits: LIMITS });
    const options = calls[0]!.options;
    expect(options.tools).toEqual(['Read', 'Grep', 'Glob']);
    expect(options.allowedTools).toEqual(['Read', 'Grep', 'Glob', 'StructuredOutput']);
    for (const tool of ['Write', 'Edit', 'Bash', 'WebFetch', 'WebSearch', 'Task', 'NotebookEdit']) expect(options.disallowedTools).toContain(tool);
    expect(options.permissionMode).toBe('dontAsk');
    expect(options.settingSources).toEqual([]);
    expect(options.mcpServers).toEqual({});
    expect(options.strictMcpConfig).toBe(true);
    expect(options.cwd).toBe(workspace);
    expect(options.outputFormat).toEqual({ type: 'json_schema', schema: REQUEST.schema.schema });
  });

  it('a runtime that GRANTS a tool beyond the allow list is refused, not trusted', async () => {
    const { query } = fakeSdk([session({ tools: ['Read', 'Grep', 'Glob', 'Bash'] })]);
    const call = await runAgenticArchitect({ queryFn: query, request: REQUEST, apiKey: ARCHITECT_KEY, requestedModel: MODEL, workspacePath: workspace, limits: LIMITS });
    expect(call.kind).toBe('failed');
    if (call.kind === 'failed') expect(call.error.failureClass).toBe('architect_envelope_not_honoured');
  });
});

/* --------------------------------------------------------------------------------------------- the env */

describe('the architect child environment', () => {
  const allowed = new Set([...HOSTED_CHILD_ENV_KEYS, ...HOSTED_CHILD_MODEL_PIN_KEYS]);

  it('is built from nothing: the allowlisted names, the ARCHITECT key, no retries', () => {
    const env = agenticArchitectChildEnv({ apiKey: ARCHITECT_KEY, model: MODEL, path: '/usr/bin', home: '/home/a' });
    for (const key of Object.keys(env)) expect(allowed.has(key), `${key} is not on the allowlist`).toBe(true);
    expect(env.ANTHROPIC_API_KEY).toBe(ARCHITECT_KEY);
    expect(env.CLAUDE_CODE_MAX_RETRIES).toBe('0');
    expect(env.CLAUDE_CODE_NO_MODEL_FALLBACK).toBe('1');
    expect('CLAUDE_CODE_OAUTH_TOKEN' in env).toBe(false);
  });

  it('reaches the session with no coder key and no GITHUB_TOKEN, whatever the host holds', async () => {
    const saved = { coder: process.env.ANTHROPIC_API_KEY, github: process.env.GITHUB_TOKEN };
    process.env.ANTHROPIC_API_KEY = CODER_KEY;
    process.env.GITHUB_TOKEN = 'FAKETESTNOTREAL-github';
    try {
      const { query, calls } = fakeSdk([session()]);
      await adapterWith(query).dispatch({ taskId: 'plan-1', contextId: 'ctx' });
      const env = calls[0]!.options.env as Record<string, string>;
      expect(env.ANTHROPIC_API_KEY).toBe(ARCHITECT_KEY);
      expect(Object.values(env)).not.toContain(CODER_KEY);
      expect('GITHUB_TOKEN' in env).toBe(false);
      expect(Object.values(env)).not.toContain('FAKETESTNOTREAL-github');
      for (const key of Object.keys(env)) expect(allowed.has(key), `${key} is not on the allowlist`).toBe(true);
      expect(env.CLAUDE_CODE_MAX_RETRIES).toBe('0');
    } finally {
      if (saved.coder === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = saved.coder;
      if (saved.github === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = saved.github;
    }
  });
});

/* --------------------------------------------------------------------------------------------- failures */

describe('failure handling, the #479 rules', () => {
  const run = (scripts: Parameters<typeof fakeSdk>[0], signal?: AbortSignal, limits = LIMITS) => {
    const sdk = fakeSdk(scripts);
    return runAgenticArchitect({ queryFn: sdk.query, request: { ...REQUEST, ...(signal === undefined ? {} : { signal }) }, apiKey: ARCHITECT_KEY, requestedModel: MODEL, workspacePath: workspace, limits })
      .then((call) => ({ call, calls: sdk.calls }));
  };
  const errorOf = (call: Awaited<ReturnType<typeof runAgenticArchitect>>): JuliusDispatchError => {
    if (call.kind !== 'failed') throw new Error('expected a failure');
    return call.error;
  };
  const init = (options: Record<string, unknown>) => ({ type: 'system', subtype: 'init', session_id: 's', model: MODEL, cwd: options.cwd, tools: ['Read', 'Grep', 'Glob'] });

  it('a timeout is TIMEOUT: retryable only as a class (the coordinator makes it outcome-unknown after the handoff)', async () => {
    const { call, calls } = await run([() => 'hang'], undefined, { ...LIMITS, maxRuntimeMs: 20 });
    const error = errorOf(call);
    expect(error.code).toBe('TIMEOUT');
    expect(error.failureClass).toBe('architect_timed_out');
    expect(calls).toHaveLength(1);
  });

  it('a STRUCTURED rate limit on the first request attests nothing was processed', async () => {
    const { call } = await run([(o) => [init(o), { type: 'assistant', parent_tool_use_id: null, error: 'rate_limit', message: { content: [] } }, { type: 'result', subtype: 'error_during_execution', is_error: true, result: 'API Error: 429' }]]);
    const error = errorOf(call);
    expect(error.code).toBe('RATE_LIMIT');
    expect(error.retryable).toBe(true);
    expect(error.diagnostics?.runtimeStarted).toBe(false);
  });

  it('a rate limit AFTER a model turn was processed and billed: runtimeStarted true', async () => {
    const { call } = await run([(o) => [init(o),
      { type: 'assistant', parent_tool_use_id: null, message: { model: MODEL, usage: { output_tokens: 5 }, content: [{ type: 'tool_use', name: 'Read', input: {} }] } },
      { type: 'assistant', parent_tool_use_id: null, error: 'rate_limit', message: { content: [] } },
      { type: 'result', subtype: 'error_during_execution', is_error: true, result: 'API Error: 429', total_cost_usd: 0.01, usage: { input_tokens: 1, output_tokens: 5 } }]]);
    const error = errorOf(call);
    expect(error.code).toBe('RATE_LIMIT');
    expect(error.diagnostics?.runtimeStarted).toBe(true);
    expect(error.diagnostics?.costUsdMicros).toBe(10_000);
  });

  it('a rate limit known only from PROSE is never read as unprocessed', async () => {
    const { call } = await run([(o) => [init(o), { type: 'result', subtype: 'error_during_execution', is_error: true, result: '429 Too Many Requests' }]]);
    const error = errorOf(call);
    expect(error.code).not.toBe('RATE_LIMIT');
    expect(error.retryable).toBe(false);
  });

  it.each([
    ['structured billing_error', (o: Record<string, unknown>) => [init(o), { type: 'assistant', parent_tool_use_id: null, error: 'billing_error', message: { content: [] } }, { type: 'result', subtype: 'error_during_execution', is_error: true, result: 'x' }]],
    ['the provider sentence', (o: Record<string, unknown>) => [init(o), { type: 'result', subtype: 'error_during_execution', is_error: true, result: 'Credit balance is too low to access the Anthropic API.' }]],
  ])('credit too low (%s) is never retryable', async (_name, script) => {
    const { call } = await run([script]);
    const error = errorOf(call);
    expect(error.failureClass).toBe('architect_credit_unavailable');
    expect(error.retryable).toBe(false);
  });

  it('a served model that is not the requested one halts (architect_served_model_mismatch), charged what it cost', async () => {
    const { call } = await run([session({ served: 'claude-opus-5' })]);
    const error = errorOf(call);
    expect(error.failureClass).toBe('architect_served_model_mismatch');
    expect(error.retryable).toBe(false);
    expect(error.diagnostics?.costUsdMicros).toBe(123_456);
  });

  it('a dated build of the requested model is the requested model', async () => {
    const { call } = await run([session({ served: `${MODEL}-20261001` })]);
    expect(call.kind).toBe('answered');
  });

  it('a cancelled dispatch launches nothing', async () => {
    const controller = new AbortController();
    controller.abort();
    const { call, calls } = await run([session()], controller.signal);
    expect(errorOf(call).code).toBe('CANCELLED');
    expect(calls).toHaveLength(0);
  });
});

/* --------------------------------------------------------------------------------------------- the budget */

describe('budget enforcement and durable accounting', () => {
  it('passes the turn bound and the dispatch allocation (rounded down) to the runtime', async () => {
    const { query, calls } = fakeSdk([session()]);
    await adapterWith(query).dispatch({ taskId: 'plan-1', contextId: 'ctx', allocation: { usdMicros: 1_234_567, policyVersion: 'julius-allocation.v3', basis: 'test' } });
    expect(calls[0]!.options.maxTurns).toBe(AGENTIC_ARCHITECT_DEFAULT_MAX_TURNS);
    expect(calls[0]!.options.maxBudgetUsd).toBe(1.23);
  });

  it('with no allocation keeps the conservative 50¢ floor', async () => {
    const { query, calls } = fakeSdk([session()]);
    await adapterWith(query).dispatch({ taskId: 'plan-1', contextId: 'ctx' });
    expect(calls[0]!.options.maxBudgetUsd).toBe(AGENTIC_ARCHITECT_DEFAULT_MAX_COST_CENTS / 100);
  });

  it('settles the SDK-reported figure as PROVIDER_REPORTED on the result usage', async () => {
    const { query } = fakeSdk([session({ cost: 0.123456 })]);
    const result = await adapterWith(query).dispatch({ taskId: 'plan-1', contextId: 'ctx' });
    expect(result.usage).toMatchObject({ usdMicros: 123_456, costBasis: 'PROVIDER_REPORTED', billingPath: 'API_BILLED' });
    expect(result.diagnostics).toMatchObject({ costUsdMicros: 123_456, costBasis: 'PROVIDER_REPORTED', transport: 'hosted', provider: 'anthropic' });
  });

  it('an UNKNOWN cost stays UNKNOWN: no amount, never $0', async () => {
    const { query } = fakeSdk([session({ cost: null })]);
    const result = await adapterWith(query).dispatch({ taskId: 'plan-1', contextId: 'ctx' });
    const usage = result.usage as Record<string, unknown>;
    expect(usage.costBasis).toBe('UNKNOWN');
    expect('usdMicros' in usage).toBe(false);
    expect((result.diagnostics as Record<string, unknown>).costUsdMicros).toBeUndefined();
  });

  it('refuses an allocation below one cent before anything launches', async () => {
    const { query, calls } = fakeSdk([session()]);
    const refused = await adapterWith(query).dispatch({ taskId: 'plan-1', contextId: 'ctx', allocation: { usdMicros: 9_999, policyVersion: 'v', basis: 'b' } }).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(JuliusDispatchError);
    expect((refused as JuliusDispatchError).failureClass).toBe('architect_allocation_below_one_cent');
    expect((refused as JuliusDispatchError).diagnostics?.runtimeStarted).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('refuses a session that reports more than its allocation, and still carries the figure to the ledger', async () => {
    const { query } = fakeSdk([session({ cost: 0.5 })]);
    const refused = await adapterWith(query).dispatch({ taskId: 'plan-1', contextId: 'ctx', allocation: { usdMicros: 100_000, policyVersion: 'v', basis: 'b' } }).catch((e: unknown) => e);
    expect((refused as JuliusDispatchError).failureClass).toBe('architect_cost_exceeded');
    expect((refused as JuliusDispatchError).retryable).toBe(false);
    expect((refused as JuliusDispatchError).diagnostics?.costUsdMicros).toBe(500_000);
  });

  it('a runtime budget stop is the same cost refusal', async () => {
    const { query } = fakeSdk([session({ subtype: 'error_max_budget_usd' })]);
    const refused = await adapterWith(query).dispatch({ taskId: 'plan-1', contextId: 'ctx' }).catch((e: unknown) => e);
    expect((refused as JuliusDispatchError).failureClass).toBe('architect_cost_exceeded');
  });

  it('a correction call is bounded by what is LEFT, and refused when the first figure is unknown', async () => {
    const twice = (run: AgenticArchitectSlotRun): JuliusProviderAdapter => ({
      adapterId: 'x',
      async dispatch() {
        await run(REQUEST);
        await run(REQUEST);
        return { workerId: 'w', providerId: 'anthropic', status: 'SUCCEEDED', safeSummary: 's', evidence: [], usage: {} };
      },
    });
    const bounded = fakeSdk([session({ cost: 0.3 })]);
    const result = await adapterWith(bounded.query, { slot: twice }).dispatch({ taskId: 'p', contextId: 'c', allocation: { usdMicros: 1_000_000, policyVersion: 'v', basis: 'b' } });
    expect(bounded.calls.map((c) => c.options.maxBudgetUsd)).toEqual([1, 0.7]);
    expect(result.usage).toMatchObject({ usdMicros: 600_000, costBasis: 'PROVIDER_REPORTED' });

    const unbounded = fakeSdk([session({ cost: null })]);
    const refused = await adapterWith(unbounded.query, { slot: twice }).dispatch({ taskId: 'p', contextId: 'c' }).catch((e: unknown) => e);
    expect((refused as JuliusDispatchError).failureClass).toBe('architect_correction_unbounded');
    expect(unbounded.calls).toHaveLength(1);
    // The session that ran is held as unknown spend: no amount, and it ran.
    expect((refused as JuliusDispatchError).diagnostics?.runtimeStarted).toBe(true);
    expect((refused as JuliusDispatchError).diagnostics?.costUsdMicros).toBeNull();
    expect((refused as JuliusDispatchError).diagnostics?.costBasis).toBe('UNKNOWN');
  });

  it('refuses to exist without the architect key', () => {
    expect(() => adapterWith(fakeSdk([session()]).query, { apiKey: '' })).toThrow('agentic_architect_requires_live_config');
  });
});
