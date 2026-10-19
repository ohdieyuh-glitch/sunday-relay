import { describe, expect, it } from 'vitest';
import { runHostedCodingAgent } from './hosted-runner';
import { hostedLimitsForAllocation, DEFAULT_HOSTED_LIMITS } from './hosted-envelope';

/**
 * A BUDGET STOP IS JULIUS'S CEILING, WHICHEVER WAY THE STREAM ENDS.
 *
 * Paid run 34739303313 granted the Coding Agent a $0.30 ceiling. The runtime
 * worked two turns, reported `error_max_budget_usd` with a provider-reported
 * cost of $0.369044 in its result message, and the SDK then threw. Julius
 * recorded `coder_provider_error_after_init` / `execution_error`: a provider
 * error, not retryable. The real cause — the grant — was invisible in the one
 * record that survives the job.
 *
 * These cases drive the real runner with a fake `query` that yields the real
 * SDK message shapes, in the order that run produced them.
 */

const WS = '/data/relay-workspaces/prj/run-1';
const clock = () => {
  let n = 0;
  return () => new Date(Date.UTC(2026, 8, 13, 5, 7, n++)).toISOString();
};
const init = () => ({
  type: 'system', subtype: 'init', model: 'claude-fable-5',
  claude_code_version: '2.1.220', apiKeySource: 'ANTHROPIC_API_KEY',
  cwd: WS, tools: ['Read', 'Glob', 'Grep', 'Edit'],
});
const budgetStop = () => ({
  type: 'result', subtype: 'error_max_budget_usd', is_error: true,
  num_turns: 2, duration_ms: 5_700, total_cost_usd: 0.369044,
  usage: { input_tokens: 0, output_tokens: 0 }, permission_denials: [],
});

const THIRTY_CENTS = hostedLimitsForAllocation(300_000);

const runWith = (messages: readonly unknown[], thenThrow: string | null) => runHostedCodingAgent({
  queryFn: () => (async function* () {
    for (const message of messages) yield message;
    if (thenThrow !== null) throw new Error(thenThrow);
  })(),
  prompt: 'implement the trust core', workspacePath: WS, apiKey: 'sk-ant-SECRET-VALUE',
  requestedModel: 'claude-fable-5', limits: THIRTY_CENTS, now: clock(),
});

describe('the runtime stopped itself at the ceiling Julius granted', () => {
  it('the grant in the paid run was thirty cents', () => {
    expect(THIRTY_CENTS.maxCostCents).toBe(30);
    expect(DEFAULT_HOSTED_LIMITS.maxCostCents).toBe(50);
  });

  it('a budget stop followed by a thrown error is a cost refusal, not a provider error', async () => {
    const outcome = await runWith([init(), budgetStop()], 'Claude Code process exited with code 1');
    expect(outcome.kind).toBe('refused');
    if (outcome.kind !== 'refused') throw new Error('expected refused');
    expect(outcome.refusalCode).toBe('coder_cost_exceeded');
    expect(outcome.safeMessage).toBe('The hosted runtime stopped at its 30¢ budget ceiling.');
    // Nothing is classified from the thrown text: the cause is the runtime's own result.
    expect(outcome.failureReason).toBeUndefined();
    expect(JSON.stringify(outcome)).not.toContain('exited with code');
  });

  it('and it keeps every fact the runtime reported before it stopped', async () => {
    const outcome = await runWith([init(), budgetStop()], 'Claude Code process exited with code 1');
    if (outcome.kind !== 'refused') throw new Error('expected refused');
    expect(outcome.observation.resultSubtype).toBe('error_max_budget_usd');
    expect(outcome.observation.initSeen).toBe(true);
    expect(outcome.observation.usage.totalCostUsd).toBe(0.369044);
  });

  it('is the same refusal the stream gives when it ends without throwing', async () => {
    const thrown = await runWith([init(), budgetStop()], 'Claude Code process exited with code 1');
    const clean = await runWith([init(), budgetStop()], null);
    if (thrown.kind !== 'refused' || clean.kind !== 'refused') throw new Error('expected refused');
    expect(thrown.refusalCode).toBe(clean.refusalCode);
    expect(thrown.safeMessage).toBe(clean.safeMessage);
  });

  it('a throw after init with NO terminal result is still a provider error, classified and never quoted', async () => {
    const outcome = await runWith([init()], 'API Error: 529 overloaded_error for sk-ant-api03-LEAKED');
    if (outcome.kind !== 'refused') throw new Error('expected refused');
    expect(outcome.refusalCode).toBe('coder_provider_error_after_init');
    expect(outcome.failureReason).toBe('provider_overloaded');
    expect(JSON.stringify(outcome)).not.toContain('sk-ant');
  });

  it('a throw after a different error result is not mistaken for a budget stop', async () => {
    const outcome = await runWith([init(), { ...budgetStop(), subtype: 'error_during_execution' }], 'stream disconnected');
    if (outcome.kind !== 'refused') throw new Error('expected refused');
    expect(outcome.refusalCode).toBe('coder_provider_error_after_init');
    expect(outcome.failureReason).toBe('stream_interrupted');
  });
});
