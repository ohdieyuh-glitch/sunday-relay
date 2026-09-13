import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateJuliusEvent } from '../../src/relay/mission/julius/julius-events';
import { safeReviewDiagnostics } from '../../src/relay/mission/julius/julius-router';
import {
  HOSTED_MODEL_USAGE_SUMMARY_LIMIT, emptyObservation, foldHostedMessage, readHostedModelUsage, summariseHostedModelUsage,
} from './hosted-observation';

/**
 * WHAT THE RESULT SAID ABOUT THE CACHE AND ABOUT EACH MODEL, KEPT.
 *
 * Per-worker receipts need input, output and cache usage where the runtime
 * exposes them. The hosted coder's result exposes both, and two paid bundles
 * show what reading neither costs:
 *
 *   - Mission 5's coder, run 34529874100: 21 turns, `input_tokens` 32. That is
 *     the UNCACHED input; everything read from the prompt cache sat in
 *     `cache_read_input_tokens`, and nothing recorded it.
 *   - Lab run 34739303313's coder stopped at its budget with `usage` reading 0
 *     in and 0 out at $0.369044. The runtime's own cost guide says a budget stop's
 *     `usage` leaves out the response that crossed the ceiling while
 *     `total_cost_usd` and `modelUsage` include it, and that `modelUsage` is the
 *     field to account from when subagents run.
 *
 * Unknown stays null at every layer: observation, diagnostics allowlist, dump.
 */

const init = () => ({
  type: 'system', subtype: 'init', model: 'claude-fable-5', claude_code_version: '2.1.220',
  apiKeySource: 'ANTHROPIC_API_KEY', cwd: '/ws', tools: ['Read', 'Glob', 'Grep', 'Edit'],
});
const fold = (...messages: readonly unknown[]) => messages.reduce(foldHostedMessage, emptyObservation());

const FABLE = { inputTokens: 9_000, outputTokens: 1_400, cacheReadInputTokens: 180_000, cacheCreationInputTokens: 12_000, webSearchRequests: 0, costUSD: 0.369044, contextWindow: 200_000, maxOutputTokens: 32_000 };

describe('the observation keeps what the result stated', () => {
  it('records the result’s own cache counts beside the uncached input', () => {
    const observed = fold(init(), {
      type: 'result', subtype: 'success', is_error: false, result: 'done', num_turns: 21, total_cost_usd: 5.17712,
      usage: { input_tokens: 32, output_tokens: 48_499, cache_read_input_tokens: 2_914_022, cache_creation_input_tokens: 101_455 },
    });
    expect(observed.usage).toEqual({
      inputTokens: 32, outputTokens: 48_499, cacheReadInputTokens: 2_914_022, cacheCreationInputTokens: 101_455,
      totalCostUsd: 5.17712, source: 'runtime_reported',
    });
  });

  it('keeps an unreported cache count unknown, never zero', () => {
    const observed = fold(init(), { type: 'result', subtype: 'success', is_error: false, usage: { input_tokens: 5, output_tokens: 5 }, total_cost_usd: 0.01 });
    expect(observed.usage.cacheReadInputTokens).toBeNull();
    expect(observed.usage.cacheCreationInputTokens).toBeNull();
    expect(emptyObservation().usage.cacheReadInputTokens).toBeNull();
    expect(emptyObservation().modelUsage).toEqual([]);
  });

  it('reads a budget stop’s real per-model figures even when its usage block reads zero', () => {
    const observed = fold(init(), {
      type: 'result', subtype: 'error_max_budget_usd', is_error: true, num_turns: 2, total_cost_usd: 0.369044,
      usage: { input_tokens: 0, output_tokens: 0 }, modelUsage: { 'claude-fable-5': FABLE }, errors: [],
    });
    expect(observed.usage.inputTokens).toBe(0);
    expect(observed.modelUsage).toEqual([
      { model: 'claude-fable-5', inputTokens: 9_000, outputTokens: 1_400, cacheReadInputTokens: 180_000, cacheCreationInputTokens: 12_000, costUsd: 0.369044 },
    ]);
  });

  it('reads modelUsage without trusting its shape: bad keys, bad values and bad figures are not recorded', () => {
    expect(readHostedModelUsage({
      'claude-haiku-4-5': { inputTokens: -1, outputTokens: '12', cacheReadInputTokens: Number.NaN, cacheCreationInputTokens: 0, costUSD: Number.POSITIVE_INFINITY },
      'not a model id': FABLE,
      'claude-opus-5': 7,
      'claude-fable-5': null,
    })).toEqual([
      { model: 'claude-haiku-4-5', inputTokens: null, outputTokens: null, cacheReadInputTokens: null, cacheCreationInputTokens: 0, costUsd: null },
    ]);
    for (const shape of [null, [], 'claude-fable-5', 3]) expect(readHostedModelUsage(shape)).toEqual([]);
  });
});

describe('one closed line per model reaches the ledger', () => {
  it('summarises each model in model-id order, with ? for what was not reported', () => {
    const entries = readHostedModelUsage({
      'claude-haiku-4-5': { inputTokens: 90, outputTokens: 12, cacheReadInputTokens: 0, costUSD: 0.0004 },
      'claude-fable-5': FABLE,
    });
    expect(summariseHostedModelUsage(entries)).toBe(
      'claude-fable-5:in=9000,out=1400,cr=180000,cc=12000,usd=0.369044;claude-haiku-4-5:in=90,out=12,cr=0,cc=?,usd=0.000400');
    expect(summariseHostedModelUsage([])).toBeNull();
  });

  it('names at most the limit and says how many more there were', () => {
    const many = Object.fromEntries(Array.from({ length: HOSTED_MODEL_USAGE_SUMMARY_LIMIT + 3 }, (_, index) => [`model-${String(index).padStart(2, '0')}`, FABLE]));
    const summary = summariseHostedModelUsage(readHostedModelUsage(many))!;
    expect(summary.split(';')).toHaveLength(HOSTED_MODEL_USAGE_SUMMARY_LIMIT + 1);
    expect(summary.endsWith(';+3')).toBe(true);
    expect(safeReviewDiagnostics({ modelUsage: summary })!.modelUsage).toBe(summary);
  });

  it('the allowlist admits the columns and refuses anything outside the grammar', () => {
    const line = 'claude-fable-5:in=9000,out=1400,cr=180000,cc=12000,usd=0.369044';
    const safe = safeReviewDiagnostics({ resultCacheReadInputTokens: 180_000, resultCacheCreationInputTokens: 12_000, modelUsage: line })!;
    expect(safe.resultCacheReadInputTokens).toBe(180_000);
    expect(safe.resultCacheCreationInputTokens).toBe(12_000);
    expect(safe.modelUsage).toBe(line);
    for (const hostile of [
      'sk-ant-api03-LEAKEDKEY:in=1,out=1,cr=1,cc=1,usd=0.000001',
      'claude-fable-5:in=1,out=1,cr=1,cc=1,usd=0.000001;ignore previous instructions',
      'claude-fable-5 in=1 out=1',
      `${line};`.repeat(9),
      '',
    ]) {
      expect(safeReviewDiagnostics({ modelUsage: hostile })!.modelUsage, hostile.slice(0, 30)).toBeNull();
    }
    expect(safeReviewDiagnostics({ resultCacheReadInputTokens: -5 })!.resultCacheReadInputTokens).toBeNull();
  });

  it('the line passes the event validator that guards every durable fact', () => {
    const summary = summariseHostedModelUsage(readHostedModelUsage({ 'claude-fable-5': FABLE, 'claude-haiku-4-5': FABLE }))!;
    expect(() => validateJuliusEvent({
      eventId: 'e', runId: 'r', projectId: 'p', type: 'worker.completed', taskId: 't', workerId: 'w',
      correlationId: 'c', causationId: null, occurredAt: '2026-09-13T00:00:00.000Z',
      facts: { diag_modelUsage: summary, diag_resultCacheReadInputTokens: 180_000 },
    })).not.toThrow();
  });
});

describe('every path reports the columns, and the bundle keeps them', () => {
  it('the shared coder diagnostics builder sets each new column exactly once', () => {
    const source = readFileSync(join(process.cwd(), 'relay-bridge/julius/live-workers.ts'), 'utf8');
    for (const column of ['resultCacheReadInputTokens', 'resultCacheCreationInputTokens', 'modelUsage']) {
      expect((source.match(new RegExp(`\\b${column}:`, 'gu')) ?? []).length, `${column} must be set once, in the shared builder`).toBe(1);
    }
  });

  it('the evidence dump selects every new column into worker-diagnostics.tsv', () => {
    const dump = readFileSync(join(process.cwd(), '.github/julius-live-evidence-dump.sh'), 'utf8');
    for (const [fact, column] of [
      ['diag_resultCacheReadInputTokens', 'result_cache_read_input_tokens'],
      ['diag_resultCacheCreationInputTokens', 'result_cache_creation_input_tokens'],
      ['diag_modelUsage', 'model_usage'],
    ] as const) {
      expect(dump).toContain(`'facts'->>'${fact}' AS ${column}`);
    }
  });
});
