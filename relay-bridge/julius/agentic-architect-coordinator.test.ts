import { describe, expect, it } from 'vitest';

import { createInMemoryArtifactExchange, createLiveArchitectAdapter } from './live-workers';
import { agenticArchitectWorker } from './live-composition';
import { createAgentSdkArchitectAdapter } from '../hosted-coding-agent/hosted-architect';
import type { HostedQueryFn } from '../hosted-coding-agent/hosted-runner';
import {
  JULIUS_CONTEXT_COMPILER_VERSION,
  JuliusExecutionCoordinator, JuliusProviderHealthRegistry, JuliusProviderRouter, JuliusWorkerRegistry,
  type JuliusCardPolicy, type JuliusContextSnapshot, type JuliusExecutionPorts,
} from '../../src/relay/mission/julius';
import { JULIUS_RUN_HALTING_FAILURE_CLASSES } from '../../src/relay/mission/julius/julius-coding-agent';

/**
 * THE #479 RULES FOR THE AGENTIC ARCHITECT, through the REAL architect slot (`createLiveArchitectAdapter`), the REAL
 * SDK runtime wrapper and the REAL coordinator, counting SDK sessions. The SDK is a scripted `query`; nothing is
 * spawned and no provider is contacted.
 */

const MODEL = 'claude-opus-5-5';
const worker = agenticArchitectWorker({ RELAY_PROMPT_ARCHITECT_TIMEOUT_MS: '200' });
const policy: JuliusCardPolicy = {
  revision: 'card', autonomy: 'AUTONOMOUS', allowedProviders: [worker.providerId], capabilities: ['plan'],
  network: false, filesystemMutation: false, fallback: false, automaticRetry: true,
  subagents: { allowed: false, maxDepth: 0, maxActive: 0, maxTotal: 0 },
  iterativeReview: { allowed: false, maxRounds: 0 }, concurrency: 1, approvals: [],
};

function snapshot(taskId: string): JuliusContextSnapshot {
  return {
    contextId: 'ctx-479', runId: 'run-479', taskId, workerId: worker.workerId,
    workerRole: 'PROMPT_ARCHITECT', compilerVersion: JULIUS_CONTEXT_COMPILER_VERSION,
    missionContractRevision: 1, cardRevision: 'card', projectBrainRevision: 0,
    taskContractRevision: 1, taskContractDigest: 'sha256:contract',
    sourceEntryIds: [], dependencyTaskIds: [], evidenceIds: [], findingIds: [],
    acceptanceCriterionIds: ['AC-1'], contentHash: 'sha256:content',
    integrityVersion: null, integrityConflicts: null,
    integrityExcludedEntryIds: null, integrityEvictedEntryIds: null,
    characterCount: 24, redactionCount: 0, truncated: false,
    packet: {
      missionId: 'mission-479', taskId, workerId: worker.workerId, sourceEntryIds: [],
      blocks: [{ kind: 'CONSTRAINT', text: 'OBJECTIVE: #479' }], truncated: false,
    },
  };
}

const claim = {
  runId: 'run-479', projectId: 'project', taskId: 'plan-1', leaseOwner: 'scheduler', leaseGeneration: 1,
  capability: 'plan', contextId: 'ctx-479',
  task: {
    taskId: 'plan-1', missionId: 'mission-479', parentTaskId: null, dependencyIds: [],
    requiredEvidenceTypes: ['ARTIFACT' as const], taskType: 'plan',
    role: 'PROMPT_ARCHITECT' as const, ordinal: 0, state: 'ACTIVE' as const,
  },
};

type Script = (options: Record<string, unknown>) => unknown[] | 'hang';
const init = (o: Record<string, unknown>) => ({ type: 'system', subtype: 'init', session_id: 's', model: MODEL, cwd: o.cwd, tools: ['Read', 'Grep', 'Glob', 'StructuredOutput'] });
const answered = (served: string): Script => (o) => [init(o),
  { type: 'assistant', parent_tool_use_id: null, request_id: 'req_1', message: { model: served, usage: { input_tokens: 10, output_tokens: 10 }, content: [] } },
  { type: 'result', subtype: 'success', is_error: false, terminal_reason: 'completed', result: '{}', num_turns: 1, total_cost_usd: 0.05, usage: { input_tokens: 10, output_tokens: 10 }, modelUsage: { [served]: { inputTokens: 10, outputTokens: 10 } }, structured_output: {} }];

async function drive(script: Script) {
  let calls = 0;
  const query: HostedQueryFn = ({ options }) => {
    calls += 1;
    return (async function* () {
      const played = script(options);
      if (played === 'hang') {
        await new Promise<void>((_, reject) => (options.abortController as AbortController).signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
        return;
      }
      for (const message of played) yield message;
    })();
  };
  const adapter = createAgentSdkArchitectAdapter({
    adapterId: worker.adapterId, requestedModel: MODEL, apiKey: 'FAKETESTNOTREAL-architect', workspacePath: '/workspace/mission',
    maxRuntimeMs: 100, queryLoader: async () => query,
    slot: (run) => createLiveArchitectAdapter({
      worker, contexts: { snapshotFor: () => snapshot('plan-1') }, artifacts: createInMemoryArtifactExchange(),
      config: { liveMode: true, model: MODEL, maxOutputTokens: 4_000, timeoutMs: 100, apiKeyPresent: true, unusable: [] },
      apiKey: 'FAKETESTNOTREAL-architect', run,
    }),
  });
  const registry = new JuliusWorkerRegistry();
  registry.register(worker);
  const rows: Record<string, unknown>[] = [];
  const released: { usdMicros: number | null | undefined; spendUnknown: boolean | undefined }[] = [];
  const ports: JuliusExecutionPorts = {
    async reserve() { return { reservationId: 'r', state: 'RESERVED', denialReason: null }; },
    async commit() {}, async release(input) { released.push({ usdMicros: input.usdMicros, spendUnknown: input.spendUnknown }); },
    async persistEvidence() {}, async acceptResult() { return { duplicate: false }; },
    async recordEvent(input) { rows.push({ type: input.type, ...input.payload }); },
  };
  const coordinator = new JuliusExecutionCoordinator(
    new JuliusProviderRouter(registry, new Map([[worker.adapterId, adapter]]), new JuliusProviderHealthRegistry()), ports);
  const result = await coordinator.execute({
    claim, policy, role: 'PROMPT_ARCHITECT', taskType: 'plan', capability: 'plan', operationId: 'op',
    resources: { usdMicros: 10, inputTokens: 10, outputTokens: 10, toolCalls: 0, runtimeMs: 100 },
  });
  return { result, calls: () => calls, rows, released };
}

describe('#479 · the Agentic Architect after the handoff', () => {
  it('a timeout is HANDED_TIMEOUT_OUTCOME_UNKNOWN: one SDK session, never retried, the hold closed unknown', async () => {
    const h = await drive(() => 'hang');
    expect(h.calls(), 'exactly one SDK session').toBe(1);
    expect(h.result).toMatchObject({ status: 'FAILED', code: 'TIMEOUT', reasonCode: 'HANDED_TIMEOUT_OUTCOME_UNKNOWN' });
    expect(h.rows.filter((row) => row.type === 'retry.scheduled'), 'never retried').toEqual([]);
    expect(h.released, 'unknown spend, never released as $0').toEqual([{ usdMicros: null, spendUnknown: true }]);
  });

  it('a STRUCTURED rate limit on the first request is the one retry the coordinator allows, with nothing held', async () => {
    const h = await drive((o) => [init(o), { type: 'assistant', parent_tool_use_id: null, error: 'rate_limit', message: { content: [] } }, { type: 'result', subtype: 'error_during_execution', is_error: true, result: 'API Error: 429' }]);
    expect(h.calls()).toBe(1);
    expect(h.result).toMatchObject({ status: 'RETRY', code: 'RATE_LIMIT' });
    expect(h.rows.filter((row) => row.type === 'retry.scheduled')).toHaveLength(1);
    expect(h.released).toEqual([{ usdMicros: null, spendUnknown: false }]);
  });

  it('a rate limit after a billed turn is HANDED_FAILURE_OUTCOME_UNKNOWN, charged what it reported', async () => {
    const h = await drive((o) => [init(o),
      { type: 'assistant', parent_tool_use_id: null, message: { model: MODEL, usage: { output_tokens: 5 }, content: [] } },
      { type: 'assistant', parent_tool_use_id: null, error: 'rate_limit', message: { content: [] } },
      { type: 'result', subtype: 'error_during_execution', is_error: true, result: 'x', total_cost_usd: 0.02, usage: { input_tokens: 1, output_tokens: 5 } }]);
    expect(h.calls()).toBe(1);
    expect(h.result).toMatchObject({ status: 'FAILED', code: 'RATE_LIMIT', reasonCode: 'HANDED_FAILURE_OUTCOME_UNKNOWN' });
    expect(h.released).toEqual([{ usdMicros: 20_000, spendUnknown: false }]);
  });

  it('credit too low is non-retryable: one session, no retry row', async () => {
    const h = await drive((o) => [init(o), { type: 'result', subtype: 'error_during_execution', is_error: true, result: 'Credit balance is too low to access the Anthropic API.' }]);
    expect(h.calls()).toBe(1);
    expect(h.result).toMatchObject({ status: 'FAILED', code: 'PROVIDER_UNAVAILABLE', failureClass: 'architect_credit_unavailable' });
    expect(h.rows.filter((row) => row.type === 'retry.scheduled')).toEqual([]);
    expect(h.rows.find((row) => row.type === 'task.failed')).toMatchObject({ errorRetryable: false });
  });

  it('a served-model mismatch fails on a RUN-HALTING class, charged what it cost', async () => {
    const h = await drive(answered('claude-opus-5'));
    expect(h.calls()).toBe(1);
    expect(h.result).toMatchObject({ status: 'FAILED', failureClass: 'architect_served_model_mismatch' });
    expect(JULIUS_RUN_HALTING_FAILURE_CLASSES).toContain('architect_served_model_mismatch');
    expect(h.rows.find((row) => row.type === 'task.failed')).toMatchObject({ reasonCode: 'architect_served_model_mismatch' });
    expect(h.released).toEqual([{ usdMicros: 50_000, spendUnknown: false }]);
  });
});
