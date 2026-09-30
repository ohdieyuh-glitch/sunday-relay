import { describe, expect, it } from 'vitest';

import { JuliusDispatchError, type JuliusContextSnapshot, type JuliusWorker } from '../../src/relay/mission/julius';
import { JULIUS_CONTEXT_COMPILER_VERSION } from '../../src/relay/mission/julius';
import { JULIUS_CODING_AGENT_RESULT_CLASSES, safeReviewDiagnostics } from '../../src/relay/mission/julius/julius-router';
import { CLAUDE_CODE_RESULT_CLASSES } from '../../src/relay/connectors/claude-code/result-classification';
import { runHostedCodingAgent, type HostedQueryFn } from '../hosted-coding-agent/hosted-runner';
import { createClaudeCodeCodingAgentProvider } from './claude-code-coding-provider';
import { createFakeExecutorShell, createScriptedCodingAgentProvider } from './coding-agent-fixtures';
import { createJuliusCodingAgentAdapter, createLiveArtifactExchange, diffRef, planRef, testOutputRef } from './live-workers';

/**
 * CODING AGENT ATTEMPT TRUTH — HOW AN ATTEMPT ENDS.
 *
 * Provider-free throughout. Claude Code is its REAL provider module over the
 * REAL hosted runner, fed a fake SDK `query` that yields the SDK's own message
 * shapes; the executor is a fake that records every effect it was asked for.
 *
 *   1. A result is a success only when every field of it says so. An error
 *      subtype beside `is_error: false`, a success with no `is_error`, an
 *      unknown subtype, or a success that ended for any terminal reason but
 *      `completed` never becomes SUCCEEDED, and never reaches the executor.
 *   2. The abort signal reaches the session. The session stops, the attempt is
 *      a cancellation, no executor effect or artifact follows, and aborting
 *      twice changes nothing.
 */

const WS = '/workspace/mission';
const WORKER: JuliusWorker = {
  workerId: 'coding-agent', role: 'CODING_AGENT', adapterId: 'coding-agent-adapter', providerId: 'anthropic',
  capabilities: ['implement'], taskTypes: ['build', 'repair:build'], concurrencyLimit: 1, timeoutMs: 1_000, maxRetries: 1, status: 'AVAILABLE',
};
const CHARGE = Object.freeze({
  stage: 'build' as const,
  binding: { contractId: 'contract:run-live:build-1', taskId: 'build-1', contractRevision: 2, bindingDigest: `sha256:${'b'.repeat(64)}` },
  objective: 'Normalize the mission label.', responsibilityBoundary: 'Only the slug module.',
  inScope: ['src/slug.ts'], outOfScope: ['src/persistence/'], permittedPaths: ['src/slug.ts'],
  prohibitedActions: ['adding a dependency'], blockingCriteria: ['[AC-1] The slug test passes.'], contractReviewCriteria: ['AC-1 holds'],
  requiredEvidence: ['TEST'] as const, requiredChecks: ['npm test'], failureConditions: ['AC-1 fails'],
  stoppingCondition: 'The suite is green.',
});
const snapshot = (): JuliusContextSnapshot => ({
  contextId: 'ctx-1', runId: 'run-live', taskId: 'build-1', workerId: WORKER.workerId, workerRole: 'CODING_AGENT',
  compilerVersion: JULIUS_CONTEXT_COMPILER_VERSION, missionContractRevision: 1, cardRevision: 'card-1', projectBrainRevision: 3,
  taskContractRevision: 2, taskContractDigest: CHARGE.binding.bindingDigest,
  sourceEntryIds: ['brain:objective'], dependencyTaskIds: [], evidenceIds: [], findingIds: [], acceptanceCriterionIds: ['AC-1'],
  contentHash: 'sha256:test', characterCount: 40, redactionCount: 0, truncated: false,
    // A fixture packet was compiled without claims, so no integrity decision
    // was made for it. NULL says that; `[]` would say it was checked.
    integrityVersion: null, integrityConflicts: null,
    integrityExcludedEntryIds: null, integrityEvictedEntryIds: null,
  packet: {
    missionId: 'mission-1', taskId: 'build-1', workerId: WORKER.workerId, sourceEntryIds: ['brain:objective'],
    blocks: [{ kind: 'OBJECTIVE', text: 'OBJECTIVE: normalize the mission label.' }], truncated: false,
  },
});
const DISPATCH = { taskId: 'build-1', contextId: 'ctx-1', taskType: 'build', contract: CHARGE, allocation: { usdMicros: 2_000_000, policyVersion: 'v3', basis: 'CODER_SHARE' } };

const init = { type: 'system', subtype: 'init', model: 'claude-x-served', claude_code_version: '2.1.220', apiKeySource: 'ANTHROPIC_API_KEY', cwd: WS, tools: ['Read', 'Glob', 'Grep', 'Edit'], session_id: 'sess-1' };
const result = (over: Record<string, unknown>) => ({
  type: 'result', subtype: 'success', is_error: false, result: 'Implemented the slug.', num_turns: 3, duration_ms: 1_200,
  total_cost_usd: 0.02, usage: { input_tokens: 500, output_tokens: 60 }, permission_denials: [], session_id: 'sess-1', ...over,
});
/**
 * A TURN OF THE SESSION, and the result's own account of it, both naming the requested model: the
 * attestation a real session always carries, and the one the served-model guard reads (founder rule,
 * 2026-09-30: no automatic downgrade). A success fixture without it is now an unattested session.
 */
const turn = { type: 'assistant', parent_tool_use_id: null, session_id: 'sess-1', message: { model: 'claude-x', content: [{ type: 'text', text: 'Implemented.' }], usage: { input_tokens: 500, output_tokens: 60 } } };
const attested = { modelUsage: { 'claude-x': { inputTokens: 500, outputTokens: 60 } } };

interface SdkSeen { abortSignals: AbortSignal[]; calls: number }

/** The fake SDK: yields the given messages; `holdAfterInit` makes it run until aborted, as a real session would. */
const fakeSdk = (messages: readonly unknown[], behaviour: { holdAfterInit?: boolean; onInit?: () => void } = {}): { queryFn: HostedQueryFn; seen: SdkSeen } => {
  const seen: SdkSeen = { abortSignals: [], calls: 0 };
  const queryFn: HostedQueryFn = (params) => {
    seen.calls += 1;
    const controller = params.options.abortController as AbortController;
    seen.abortSignals.push(controller.signal);
    return (async function* () {
      for (const message of messages) {
        yield message;
        if ((message as { subtype?: string }).subtype === 'init') {
          behaviour.onInit?.();
          if (behaviour.holdAfterInit === true) {
            await new Promise<void>((_resolve, reject) => {
              const stop = (): void => reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
              if (controller.signal.aborted) stop();
              controller.signal.addEventListener('abort', stop, { once: true });
            });
          }
        }
      }
    })();
  };
  return { queryFn, seen };
};

const claude = (queryFn: HostedQueryFn, run = runHostedCodingAgent) =>
  createClaudeCodeCodingAgentProvider({ apiKey: 'FAKETESTNOTREAL', requestedModel: 'claude-x', run, queryLoader: async () => queryFn });

const adapterOver = (provider: Parameters<typeof createJuliusCodingAgentAdapter>[0]['provider']) => {
  const shell = createFakeExecutorShell({});
  const artifacts = createLiveArtifactExchange();
  artifacts.put(planRef('run-live'), JSON.stringify({ objectiveSummary: 'Normalize.', steps: ['edit'] }));
  const adapter = createJuliusCodingAgentAdapter({
    worker: WORKER, contexts: { snapshotFor: () => snapshot() }, artifacts, projectId: 'prj-live',
    workspacePath: WS, testCommand: 'npm test', shell, provider,
  });
  return { adapter, shell, artifacts };
};

const refusalOf = async (promise: Promise<unknown>): Promise<JuliusDispatchError> => {
  const settled = await promise.then(() => null, (error: unknown) => error);
  expect(settled, 'the dispatch must not succeed').toBeInstanceOf(JuliusDispatchError);
  return settled as JuliusDispatchError;
};
const steps = (shell: ReturnType<typeof createFakeExecutorShell>): string[] =>
  shell.invocations.map((effect) => effect.invocationKey.split(':').pop()!);

/* ------------------------------------------------ 1. strict classification */

describe('1 — a result is a success only when every field of it says so', () => {
  const refusedShapes: readonly (readonly [string, Record<string, unknown>, string])[] = [
    ['an error subtype beside is_error:false', { subtype: 'error_max_turns', is_error: false }, 'MAX_TURNS'],
    ['error_during_execution beside is_error:false', { subtype: 'error_during_execution', is_error: false }, 'EXECUTION_ERROR'],
    ['a success with no is_error at all', { is_error: undefined }, 'ERROR_FLAG_UNREPORTED'],
    ['a success that ended tool_deferred', { terminal_reason: 'tool_deferred' }, 'TERMINAL_REASON_NOT_COMPLETED'],
    ['a success that ended for a reason nobody knows', { terminal_reason: 'invented_later' }, 'TERMINAL_REASON_NOT_COMPLETED'],
    ['a subtype nobody knows, beside is_error:false', { subtype: 'error_invented_later', is_error: false }, 'UNKNOWN_SUBTYPE'],
  ];

  for (const [name, over, resultClass] of refusedShapes) {
    it(`${name} is refused, never SUCCEEDED, and captures the attempt without minting evidence`, async () => {
      const { queryFn } = fakeSdk([init, result(over)]);
      const { adapter, shell, artifacts } = adapterOver(claude(queryFn));
      const refusal = await refusalOf(adapter.dispatch(DISPATCH));
      expect(refusal.code).toBe('WORKER_EXECUTION_FAILURE');
      expect(refusal.retryable).toBe(false);
      expect(refusal.failureClass).toBe('coder_result_untrusted');
      expect(refusal.diagnostics).toMatchObject({ resultClass, implementationPresent: false, runtimeStarted: true });
      // The close-out look at the workspace runs — a failed attempt still owns what it
      // changed — and nothing that would become evidence: no diff artifact, no test run.
      expect(steps(shell)).toEqual(['base', 'status']);
      expect(artifacts.get(diffRef('run-live'))).toBeNull();
      expect(artifacts.get(testOutputRef('run-live'))).toBeNull();
      expect((refusal.implementation as { attemptOutcome: string }).attemptOutcome).toBe('FAILED');
    });
  }

  it('a success, is_error:false and terminal reason completed is the one that succeeds, and says so', async () => {
    const { queryFn } = fakeSdk([init, turn, result({ terminal_reason: 'completed', ...attested })]);
    const { adapter, shell } = adapterOver(claude(queryFn));
    const done = await adapter.dispatch(DISPATCH);
    expect(done.status).toBe('SUCCEEDED');
    // `runtimeStarted` is what the evidence dump exports as worker-diagnostics.tsv's
    // `runtime_started`. On a failure the adapter overrides it; on a success nothing
    // does, so this is the only line that holds it to the truth.
    expect(done.diagnostics).toMatchObject({ resultClass: 'SUCCESS', terminalReason: 'completed', implementationPresent: true, runtimeStarted: true });
    expect(steps(shell)).toEqual(['base', 'status', 'diff', 'test']);
  });

  it('a success from an older runtime that sends no terminal reason still succeeds', async () => {
    const { queryFn } = fakeSdk([init, turn, result({ ...attested })]);
    const { adapter } = adapterOver(claude(queryFn));
    const done = await adapter.dispatch(DISPATCH);
    expect(done.status).toBe('SUCCEEDED');
    expect(done.diagnostics).toMatchObject({ resultClass: 'SUCCESS', terminalReason: null });
  });

  it('the budget stop keeps its own refusal whatever is_error says', async () => {
    const { queryFn } = fakeSdk([init, result({ subtype: 'error_max_budget_usd', is_error: false })]);
    const { adapter } = adapterOver(claude(queryFn));
    const refusal = await refusalOf(adapter.dispatch(DISPATCH));
    expect(refusal.failureClass).toBe('coder_cost_exceeded');
    expect(refusal.diagnostics).toMatchObject({ resultClass: 'BUDGET_STOP', codingAgentFailure: 'COST_CEILING_REACHED' });
  });

  it('the durable record keeps the class and the reason, and refuses anything that is not a vocabulary token', () => {
    expect([...JULIUS_CODING_AGENT_RESULT_CLASSES]).toEqual([...CLAUDE_CODE_RESULT_CLASSES]);
    expect(safeReviewDiagnostics({ resultClass: 'MAX_TURNS', terminalReason: 'tool_deferred' })).toMatchObject({ resultClass: 'MAX_TURNS', terminalReason: 'tool_deferred' });
    expect(safeReviewDiagnostics({ resultClass: 'max_turns', terminalReason: 'Tool Deferred: sk-ant-SECRET' })).toMatchObject({ resultClass: null, terminalReason: null });
  });
});

/* ------------------------------------------------------ 2. abort forwarding */

describe('2 — the abort reaches the session, and nothing after it is evidence', () => {
  it('a dispatch aborted before launch loads no runtime, starts no session and spends nothing', async () => {
    let loads = 0;
    const { queryFn, seen } = fakeSdk([init, result({})]);
    const provider = createClaudeCodeCodingAgentProvider({ apiKey: 'FAKETESTNOTREAL', requestedModel: 'claude-x', queryLoader: async () => { loads += 1; return queryFn; } });
    const controller = new AbortController();
    controller.abort();
    const request = { identity: { taskType: 'build' } } as never;
    const outcome = await provider.execute(request, controller.signal);
    expect(outcome).toMatchObject({ kind: 'failed', failure: 'CANCELLED', runtimeStarted: false, costUsdMicros: null });
    expect(loads).toBe(0);
    expect(seen.calls).toBe(0);
  });

  it('an abort mid-session reaches the SDK: the session stops, the attempt is cancelled, and no executor effect follows', async () => {
    let initSeen = (): void => undefined;
    const running = new Promise<void>((resolve) => { initSeen = resolve; });
    const { queryFn, seen } = fakeSdk([init, result({})], { holdAfterInit: true, onInit: () => initSeen() });
    const { adapter, shell, artifacts } = adapterOver(claude(queryFn));
    const controller = new AbortController();
    const dispatched = adapter.dispatch({ ...DISPATCH, signal: controller.signal });
    await running;
    expect(seen.abortSignals[0]!.aborted).toBe(false);
    controller.abort();
    const refusal = await refusalOf(dispatched);
    // THE PROVIDER STOPPED: the SDK's own controller was aborted, and its stream ended.
    expect(seen.abortSignals[0]!.aborted).toBe(true);
    expect(refusal.code).toBe('CANCELLED');
    expect(refusal.retryable).toBe(false);
    expect(refusal.failureClass).toBe('coder_cancelled');
    expect(refusal.diagnostics).toMatchObject({ codingAgentFailure: 'CANCELLED', runtimeStarted: true });
    // NO EVIDENCE AFTER ABORT: only the base read ran, and no artifact was written.
    expect(steps(shell)).toEqual(['base']);
    expect(artifacts.get(diffRef('run-live'))).toBeNull();
    expect(artifacts.get(testOutputRef('run-live'))).toBeNull();
  });

  it('aborting twice is one cancellation: the session is told once and the outcome is the same', async () => {
    let initSeen = (): void => undefined;
    const running = new Promise<void>((resolve) => { initSeen = resolve; });
    const { queryFn, seen } = fakeSdk([init, result({})], { holdAfterInit: true, onInit: () => initSeen() });
    let cancels = 0;
    const counted: typeof runHostedCodingAgent = (input) => runHostedCodingAgent({
      ...input,
      ...(input.onCancel === undefined ? {} : { onCancel: (cancel) => input.onCancel!(() => { cancels += 1; cancel(); }) }),
    });
    const { adapter, shell } = adapterOver(claude(queryFn, counted));
    const controller = new AbortController();
    const dispatched = adapter.dispatch({ ...DISPATCH, signal: controller.signal });
    await running;
    let sdkAbortEvents = 0;
    seen.abortSignals[0]!.addEventListener('abort', () => { sdkAbortEvents += 1; });
    controller.abort();
    controller.abort();
    const refusal = await refusalOf(dispatched);
    controller.abort();
    expect(cancels).toBe(1);
    expect(sdkAbortEvents).toBe(1);
    expect(refusal.code).toBe('CANCELLED');
    expect(steps(shell)).toEqual(['base']);
  });

  it('an abort that lands as the stream ends still ends the dispatch as a cancellation, charged and never completed', async () => {
    const controller = new AbortController();
    const { queryFn } = fakeSdk([init, result({})]);
    const endsThenAborted: typeof runHostedCodingAgent = async (input) => {
      const outcome = await runHostedCodingAgent({ ...input, onCancel: () => undefined });
      controller.abort();
      return outcome;
    };
    const { adapter, shell, artifacts } = adapterOver(claude(queryFn, endsThenAborted));
    const refusal = await refusalOf(adapter.dispatch({ ...DISPATCH, signal: controller.signal }));
    expect(refusal.code).toBe('CANCELLED');
    expect(refusal.diagnostics).toMatchObject({ runtimeStarted: true, costUsdMicros: 20_000 });
    expect(steps(shell)).toEqual(['base']);
    expect(artifacts.get(diffRef('run-live'))).toBeNull();
  });

  it('the provider itself never returns completed for a dispatch aborted as its stream ended', async () => {
    // The port's own contract, whichever Julius-side adapter reads it.
    const controller = new AbortController();
    const { queryFn } = fakeSdk([init, result({})]);
    const endsThenAborted: typeof runHostedCodingAgent = async (input) => {
      const outcome = await runHostedCodingAgent({ ...input, onCancel: () => undefined });
      controller.abort();
      return outcome;
    };
    // A real governed request, captured from the adapter that builds it.
    const recorder = createScriptedCodingAgentProvider({ script: [{ kind: 'completed' }] });
    await adapterOver(recorder).adapter.dispatch(DISPATCH);
    const outcome = await claude(queryFn, endsThenAborted).execute(recorder.requests[0]!, controller.signal);
    expect(outcome).toMatchObject({ kind: 'failed', failure: 'CANCELLED', runtimeStarted: true, costUsdMicros: 20_000, providerFailureClass: 'coder_cancelled' });
  });

  it('an abort between the executor steps stops the next one', async () => {
    const controller = new AbortController();
    const provider = createScriptedCodingAgentProvider({ script: [{ kind: 'completed' }] });
    const shell = createFakeExecutorShell({});
    const aborting = {
      async run(effect: Parameters<typeof shell.run>[0]) {
        const answer = await shell.run(effect);
        if (effect.invocationKey.endsWith(':status')) controller.abort();
        return answer;
      },
    };
    const artifacts = createLiveArtifactExchange();
    artifacts.put(planRef('run-live'), JSON.stringify({ objectiveSummary: 'Normalize.', steps: ['edit'] }));
    const adapter = createJuliusCodingAgentAdapter({
      worker: WORKER, contexts: { snapshotFor: () => snapshot() }, artifacts, projectId: 'prj-live',
      workspacePath: WS, testCommand: 'npm test', shell: aborting, provider,
    });
    const refusal = await refusalOf(adapter.dispatch({ ...DISPATCH, signal: controller.signal }));
    expect(refusal.code).toBe('CANCELLED');
    expect(refusal.failureClass).toBe('coder_cancelled_before_diff');
    expect(steps(shell)).toEqual(['base', 'status']);
    expect(artifacts.get(diffRef('run-live'))).toBeNull();
  });

  it('a deterministic provider honours the signal too: aborted before launch, it is never asked', async () => {
    const provider = createScriptedCodingAgentProvider({ script: [{ kind: 'completed' }] });
    const { adapter, shell } = adapterOver(provider);
    const controller = new AbortController();
    controller.abort();
    const refusal = await refusalOf(adapter.dispatch({ ...DISPATCH, signal: controller.signal }));
    expect(refusal.code).toBe('CANCELLED');
    expect(refusal.failureClass).toBe('coder_cancelled_before_base');
    expect(steps(shell)).toEqual([]);
    expect(provider.requests).toHaveLength(0);
  });
});
