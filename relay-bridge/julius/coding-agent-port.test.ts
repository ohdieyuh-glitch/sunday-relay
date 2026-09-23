import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  JULIUS_CODING_AGENT_CHARTER,
  JULIUS_CODING_AGENT_FAILURES,
  juliusCodingAgentFailureDisposition,
  renderJuliusCodingAgentPrompt,
  type JuliusCodingAgentRequest,
} from '../../src/relay/mission/julius/julius-coding-agent';
import {
  JULIUS_CONTEXT_COMPILER_VERSION,
  JuliusDispatchError,
  type JuliusContextSnapshot,
  type JuliusProviderResult,
  type JuliusWorker,
} from '../../src/relay/mission/julius';
import type { HostedRunInput, HostedRunOutcome, HostedQueryFn } from '../hosted-coding-agent/hosted-runner';
import { compileHostedEnvelope } from '../hosted-coding-agent/hosted-envelope';
import { classifyHostedFailure } from '../hosted-coding-agent/hosted-failure-reason';
import {
  codingAgentFailureFromHostedOutcome,
  createClaudeCodeCodingAgentProvider,
} from './claude-code-coding-provider';
import {
  createCodexShapedCodingAgentProvider,
  createFakeExecutorShell,
  createScriptedCodingAgentProvider,
  type CodexShapedResponse,
} from './coding-agent-fixtures';
import {
  createJuliusCodingAgentAdapter,
  createInMemoryArtifactExchange,
} from './live-workers';

/**
 * THE CODING AGENT PORT: WHAT A PROVIDER IS SHOWN, WHAT IT CAN SAY, AND WHAT
 * HAPPENS WHEN IT FAILS — WHICHEVER PROVIDER IT IS.
 *
 * Provider-free: Claude Code is its real provider module with an injected
 * runner, Codex-shaped and generic providers are deterministic fixtures, and the
 * executor is a fake that records every effect.
 */

const WORKER: JuliusWorker = {
  workerId: 'coding-agent', role: 'CODING_AGENT', adapterId: 'coding-agent-adapter', providerId: 'any',
  capabilities: ['implement'], taskTypes: ['build', 'repair:build'], concurrencyLimit: 1, timeoutMs: 1_000, maxRetries: 1, status: 'AVAILABLE',
};
const CHARGE = Object.freeze({
  stage: 'build' as const,
  binding: { contractId: 'contract:run-live:build-1', taskId: 'build-1', contractRevision: 2, bindingDigest: `sha256:${'b'.repeat(64)}` },
  objective: 'Normalize the mission label.', responsibilityBoundary: 'Only the slug module.',
  inScope: ['src/slug.ts'], outOfScope: ['src/persistence/'], permittedPaths: ['src/slug.ts', 'src/slug.test.ts'],
  prohibitedActions: ['adding a dependency'], blockingCriteria: ['[AC-1] The slug test passes.'], contractReviewCriteria: ['AC-1 holds'],
  requiredEvidence: ['TEST'] as const, requiredChecks: ['npm test'], failureConditions: ['AC-1 fails'],
  stoppingCondition: 'The suite is green.',
});

/** A compiled packet holding one of each kind of entry, so sectioning can be seen. */
function snapshot(): JuliusContextSnapshot {
  const blocks = [
    { entryId: 'brain:objective', kind: 'OBJECTIVE' as const, text: 'OBJECTIVE: normalize the mission label.' },
    { entryId: 'brain:guidance-answer:segment:build-1:2:task:r1', kind: 'HANDOFF' as const, text: 'ACCEPTED GUIDANCE: reuse the existing reader.' },
    { entryId: 'brain:architecture:run-live:r1', kind: 'DECISION' as const, text: 'ACCEPTED ARCHITECTURE (revision 1): JournalReader boundary.' },
    { entryId: 'brain:finding:f1', kind: 'FINDING' as const, text: 'REVIEW FINDING: NULL renders as the literal word.' },
    { entryId: 'brain:segment-resume:segment:build-1:2:task', kind: 'HANDOFF' as const, text: 'RESUME: tests written, wiring next.' },
    { entryId: 'brain:decision:plan-1:ACCEPT:TASK_VERIFIED', kind: 'DECISION' as const, text: 'ACCEPT (TASK_VERIFIED): plan accepted.' },
  ];
  return {
    contextId: 'ctx-1', runId: 'run-live', taskId: 'build-1', workerId: WORKER.workerId, workerRole: 'CODING_AGENT',
    compilerVersion: JULIUS_CONTEXT_COMPILER_VERSION, missionContractRevision: 1, cardRevision: 'card-1', projectBrainRevision: 3,
    taskContractRevision: 2, taskContractDigest: CHARGE.binding.bindingDigest,
    sourceEntryIds: blocks.map((block) => block.entryId), dependencyTaskIds: [], evidenceIds: [], findingIds: [], acceptanceCriterionIds: ['AC-1'],
    contentHash: 'sha256:test', characterCount: 100, redactionCount: 0, truncated: false,
    packet: {
      missionId: 'mission-1', taskId: 'build-1', workerId: WORKER.workerId,
      sourceEntryIds: blocks.map((block) => block.entryId),
      blocks: blocks.map((block) => ({ kind: block.kind, text: block.text })), truncated: false,
    },
  };
}

const PLAN = JSON.stringify({ objectiveSummary: 'Normalize the label.', steps: ['edit slug.ts'] });

function adapterWith(provider: Parameters<typeof createJuliusCodingAgentAdapter>[0]['provider'], shell = createFakeExecutorShell({})) {
  const artifacts = createInMemoryArtifactExchange();
  artifacts.seed({ kind: 'PLAN', runId: 'run-live', taskId: 'plan-1', leaseGeneration: 1, role: 'PROMPT_ARCHITECT' }, PLAN);
  return {
    shell,
    adapter: createJuliusCodingAgentAdapter({
      worker: WORKER, contexts: { snapshotFor: () => snapshot() }, artifacts, projectId: 'prj-live',
      workspacePath: '/workspace/mission', testCommand: 'npm test', shell, provider,
    }),
  };
}

const DISPATCH = { taskId: 'build-1', contextId: 'ctx-1', taskType: 'build', attempt: { leaseGeneration: 1 }, reads: { plan: { taskId: 'plan-1', leaseGeneration: 1 } }, contract: CHARGE, allocation: { usdMicros: 2_000_000, policyVersion: 'v3', basis: 'CODER_SHARE' } };

/** The same adapter, keeping the exchange so a test can read the bodies back. */
function adapterKeepingArtifacts(provider: Parameters<typeof createJuliusCodingAgentAdapter>[0]['provider'], shell = createFakeExecutorShell({})) {
  const artifacts = createInMemoryArtifactExchange();
  artifacts.seed({ kind: 'PLAN', runId: 'run-live', taskId: 'plan-1', leaseGeneration: 1, role: 'PROMPT_ARCHITECT' }, PLAN);
  return {
    artifacts,
    adapter: createJuliusCodingAgentAdapter({
      worker: WORKER, contexts: { snapshotFor: () => snapshot() }, artifacts, projectId: 'prj-live',
      workspacePath: '/workspace/mission', testCommand: 'npm test', shell, provider,
    }),
  };
}

const refusalOf = async (promise: Promise<unknown>) =>
  promise.then(() => null, (error: unknown) => error as JuliusDispatchError);

/* ------------------------------------------------------ the request */

describe('C1 — a provider is shown a governed request, in sections by authority', () => {
  it('sorts the packet: accepted guidance, architecture, findings and continuation each stand apart', async () => {
    const provider = createScriptedCodingAgentProvider({ script: [{ kind: 'completed' }] });
    const { adapter } = adapterWith(provider);
    await adapter.dispatch(DISPATCH);
    const request = provider.requests[0]!;
    expect(request.sections.acceptedGuidance.map((block) => block.entryId)).toEqual(['brain:guidance-answer:segment:build-1:2:task:r1']);
    expect(request.sections.architecture.map((block) => block.entryId)).toEqual(['brain:architecture:run-live:r1']);
    expect(request.sections.findings.map((block) => block.entryId)).toEqual(['brain:finding:f1']);
    expect(request.sections.continuation.map((block) => block.entryId)).toEqual(['brain:segment-resume:segment:build-1:2:task']);
    expect(request.sections.missionContext.map((block) => block.entryId)).toEqual(['brain:objective', 'brain:decision:plan-1:ACCEPT:TASK_VERIFIED']);
  });

  it('carries the locked terms, the permissions and the budget — and nothing of Julius\'s internals', async () => {
    const provider = createScriptedCodingAgentProvider({ script: [{ kind: 'completed' }] });
    const { adapter } = adapterWith(provider);
    await adapter.dispatch(DISPATCH);
    const request = provider.requests[0]!;
    expect(request.contract?.binding.bindingDigest).toBe(CHARGE.binding.bindingDigest);
    expect(request.permissions).toEqual({
      mayEditFiles: true, mayRunCommands: false, mayUseNetwork: false,
      permittedPaths: ['src/slug.ts', 'src/slug.test.ts'], outOfScope: ['src/persistence/'], prohibitedActions: ['adding a dependency'],
    });
    expect(request.budget).toEqual({ usdMicros: 2_000_000 });
    expect(request.identity).toEqual({ runId: 'run-live', missionId: 'mission-1', taskId: 'build-1', taskType: 'build', contextId: 'ctx-1' });
    // The whole top level, so a field added later is a decision someone made here.
    expect(Object.keys(request).sort()).toEqual(['budget', 'contract', 'identity', 'permissions', 'plan', 'protocol', 'requiredEvidence', 'sections', 'version', 'workspacePath']);
    const text = JSON.stringify(request);
    for (const internal of ['leaseGeneration', 'reservationId', 'owner', 'policyRevision', 'cardRevision']) {
      expect(text.includes(internal), `${internal} reached a provider`).toBe(false);
    }
  });

  it('one canonical rendering: the plan, then the terms, then accepted guidance, then advisory architecture, then findings, and how to ask last', () => {
    const request = {
      version: 'julius-coding-agent.v1', identity: { runId: 'r', missionId: 'm', taskId: 't', taskType: 'build', contextId: 'c' },
      workspacePath: '/w', contract: CHARGE, plan: 'THE PLAN',
      sections: {
        acceptedGuidance: [{ entryId: 'g', kind: 'HANDOFF', text: 'GUIDANCE TEXT' }],
        architecture: [{ entryId: 'a', kind: 'DECISION', text: 'ARCHITECTURE TEXT' }],
        findings: [{ entryId: 'f', kind: 'FINDING', text: 'FINDING TEXT' }],
        continuation: [], missionContext: [{ entryId: 'o', kind: 'OBJECTIVE', text: 'OBJECTIVE TEXT' }],
      },
      permissions: { mayEditFiles: true, mayRunCommands: false, mayUseNetwork: false, permittedPaths: [], outOfScope: [], prohibitedActions: [] },
      requiredEvidence: ['TEST'], budget: { usdMicros: null }, protocol: { participation: 'HOW TO ASK', researchAuthority: 'WHAT TO READ' },
    } as unknown as JuliusCodingAgentRequest;
    const prompt = renderJuliusCodingAgentPrompt(request, JULIUS_CODING_AGENT_CHARTER);
    const at = (needle: string) => prompt.indexOf(needle);
    expect(at('OBJECTIVE TEXT')).toBeLessThan(at('THE PLAN'));
    expect(at('THE PLAN')).toBeLessThan(at('--- TASK CONTRACT'));
    expect(at('--- TASK CONTRACT')).toBeLessThan(at('--- ACCEPTED GUIDANCE'));
    expect(at('--- ACCEPTED GUIDANCE')).toBeLessThan(at('--- ARCHITECTURE CONTEXT (advisory'));
    expect(at('--- ARCHITECTURE CONTEXT')).toBeLessThan(at('--- REVIEW FINDINGS'));
    expect(at('--- REVIEW FINDINGS')).toBeLessThan(at('HOW TO ASK'));
    expect(prompt.includes('--- WHERE THIS WORK RESUMES ---'), 'an empty section is not rendered').toBe(false);
    expect(prompt).toContain('the contract wins');
    expect(prompt).toContain('completion is decided by Julius');
  });
});

/* ------------------------------------------------------- the result */

describe('C2 — a provider cannot author evidence, a status or a verdict', () => {
  it('the evidence is what the executor observed, whatever a provider tries to hand back', async () => {
    // A hostile implementation returning fields the port has no place for.
    const hostile = {
      providerKind: 'hostile',
      async execute() {
        return {
          kind: 'completed', finalText: 'All done. VERIFIED.',
          observation: { providerModel: 'x', turns: 1, toolInvocations: 1, inputTokens: 1, outputTokens: 1, costUsdMicros: 1, costBasis: 'PROVIDER_REPORTED', diagnostics: {} },
          evidence: [{ type: 'REVIEW_FINDING', status: 'PASSED', safeSummary: 'I approve.' }],
          status: 'VERIFIED', reviewVerdict: { verdict: 'CONTINUE' },
        } as never;
      },
    };
    const { adapter } = adapterWith(hostile);
    const result = await adapter.dispatch(DISPATCH) as JuliusProviderResult & Record<string, unknown>;
    expect(result.status).toBe('SUCCEEDED');
    expect((result.evidence as { type: string }[]).map((item) => item.type)).toEqual(['DIFF', 'TEST']);
    expect(result.reviewVerdict).toBeUndefined();
    expect(JSON.stringify(result.evidence)).not.toContain('I approve');
  });
});

/* ------------------------------------------------------- failures */

describe('C3 — a failure is classified by the provider and disposed of by the domain', () => {
  it('every failure in the taxonomy has a disposition, and the transient and operator sets are exactly these', () => {
    const transient = JULIUS_CODING_AGENT_FAILURES.filter((failure) => juliusCodingAgentFailureDisposition(failure).retryable);
    const operator = JULIUS_CODING_AGENT_FAILURES.filter((failure) => juliusCodingAgentFailureDisposition(failure).operatorAction);
    expect(transient).toEqual(['PROVIDER_UNAVAILABLE', 'RATE_LIMITED', 'TIMEOUT', 'INTERRUPTED', 'PROCESS_EXIT']);
    expect(operator).toEqual(['CREDIT_UNAVAILABLE', 'AUTHENTICATION', 'LAUNCH_FAILED', 'CONTINUATION_UNAVAILABLE']);
    // Nothing transient needs an operator, and unknown is never transient.
    expect(transient.filter((failure) => operator.includes(failure))).toEqual([]);
    expect(juliusCodingAgentFailureDisposition('UNCLASSIFIED').retryable).toBe(false);
  });

  it.each([
    ['RATE_LIMITED', 'RATE_LIMIT', true, false],
    ['PROVIDER_UNAVAILABLE', 'PROVIDER_UNAVAILABLE', true, false],
    ['CREDIT_UNAVAILABLE', 'PROVIDER_UNAVAILABLE', false, true],
    ['AUTHENTICATION', 'AUTH_CONFIGURATION', false, true],
    ['CONTEXT_OVERFLOW', 'INVALID_REQUEST', false, false],
    ['MALFORMED_OUTPUT', 'WORKER_EXECUTION_FAILURE', false, false],
    ['UNCLASSIFIED', 'WORKER_EXECUTION_FAILURE', false, false],
  ] as const)('%s fails the dispatch as %s (retryable %s, operator %s), and produces no evidence', async (failure, code, retryable, operator) => {
    const provider = createScriptedCodingAgentProvider({ script: [{ kind: 'failed', failure, costUsdMicros: 40_000 }] });
    const { adapter, shell } = adapterWith(provider);
    const refusal = await refusalOf(adapter.dispatch(DISPATCH));
    expect(refusal).toBeInstanceOf(JuliusDispatchError);
    expect(refusal!.code).toBe(code);
    expect(refusal!.retryable).toBe(retryable);
    expect(refusal!.diagnostics).toMatchObject({ codingAgentFailure: failure, operatorActionRequired: operator, costUsdMicros: 40_000, runtimeStarted: true });
    // No diff, no test: a failure produces no evidence to be judged. The close-out
    // look at the workspace DOES run, because a failed attempt still owns what it changed.
    expect(shell.invocations.map((effect) => effect.invocationKey)).toEqual(['build-1:base', 'build-1:status']);
    expect((refusal!.implementation as { attemptOutcome: string }).attemptOutcome).toBe('FAILED');
  });

  it('a paid session followed by an executor refusal still carries what the session cost', async () => {
    const provider = createScriptedCodingAgentProvider({ script: [{ kind: 'completed', costUsdMicros: 870_000 }] });
    const shell = createFakeExecutorShell({
      refuse: 'test',
      refusal: () => new JuliusDispatchError('WORKER_EXECUTION_FAILURE', false, 'Executor refused.', 'executor_refused', { executorRefusal: 'policy_digest_mismatch' }),
    });
    const { adapter } = adapterWith(provider, shell);
    const refusal = await refusalOf(adapter.dispatch(DISPATCH));
    expect(refusal!.failureClass).toBe('executor_refused');
    expect(refusal!.diagnostics).toMatchObject({ costUsdMicros: 870_000, runtimeStarted: true });
  });
});

/* ---------------------------------------------------- claude code */

describe('C4 — the Claude Code provider translates its runtime into the taxonomy', () => {
  const observed = (over: Record<string, unknown> = {}) => ({
    initSeen: true, sessionId: 'sess', actualModel: 'claude-x', runtimeVersion: 't', apiKeySource: 'env', reportedCwd: '/workspace/mission',
    reportedTools: ['Read', 'Edit'], toolTargets: [], toolsUsed: ['Edit'], toolInvocations: 5, permissionDenials: 0, numTurns: 4, durationMs: 1,
    usage: { inputTokens: 900, outputTokens: 300, totalCostUsd: 0.31, source: 'runtime_reported' },
    streamUsage: { messages: 4, abortedMessages: 0, inputTokens: 880, outputTokens: 290, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
    resultSubtype: 'error_during_execution', isError: true, finalText: null, thinkingBlocksOmitted: 0, unknownMessageCount: 0,
    ...over,
  });
  const refused = (refusalCode: string, finalText: string | null, failureReason?: string): HostedRunOutcome => ({
    kind: 'refused', refusalCode, safeMessage: 'The hosted run failed after it started.',
    ...(failureReason === undefined ? {} : { failureReason }),
    observation: observed({ finalText }), envelope: compileHostedEnvelope({ workspacePath: '/workspace/mission' }),
    startedAt: 't', completedAt: 't',
  }) as never;

  it.each([
    ['API Error: 429 {"type":"rate_limit_error"}', 'RATE_LIMITED'],
    ['API Error: 529 overloaded_error', 'PROVIDER_UNAVAILABLE'],
    ['API Error: 503 upstream gateway', 'PROVIDER_UNAVAILABLE'],
    ['the stream was aborted before it completed', 'INTERRUPTED'],
    ['API Error: 400 {"message":"Your credit balance is too low to access the Anthropic API."}', 'CREDIT_UNAVAILABLE'],
    ['API Error: 401 authentication_error', 'AUTHENTICATION'],
    ['prompt is too long: 250000 tokens > 200000 maximum', 'CONTEXT_OVERFLOW'],
    ['something nobody recognises', 'UNCLASSIFIED'],
  ])('after launch, "%s" is %s', (text, failure) => {
    // The provider module classifies the runtime's text first and maps the class; this is that path.
    expect(codingAgentFailureFromHostedOutcome(refused('coder_provider_error_after_init', text) as never, classifyHostedFailure(text))).toBe(failure);
  });

  it('through the real provider module: a 429 after launch is now retryable, and the old refusal code still names it', async () => {
    const runs: HostedRunInput[] = [];
    const run = async (runInput: HostedRunInput): Promise<HostedRunOutcome> => {
      runs.push(runInput);
      return refused('coder_provider_error_after_init', 'API Error: 429 {"type":"rate_limit_error"}');
    };
    const provider = createClaudeCodeCodingAgentProvider({ apiKey: 'FAKETESTNOTREAL', requestedModel: 'claude-x', run: run as never, queryLoader: async () => (() => (async function* () { /* none */ })()) as HostedQueryFn });
    const { adapter } = adapterWith(provider);
    const refusal = await refusalOf(adapter.dispatch(DISPATCH));
    expect(refusal!.code).toBe('RATE_LIMIT');
    expect(refusal!.retryable).toBe(true);
    expect(refusal!.failureClass, 'the provider\'s own token is kept for continuity').toBe('coder_provider_error_after_init');
    expect(refusal!.diagnostics).toMatchObject({ codingAgentFailure: 'RATE_LIMITED', failureReason: 'rate_limited', costUsdMicros: 310_000, runtimeStarted: true });
    // And the session was handed the canonical prompt, sections and all.
    expect(runs[0]!.prompt).toContain('--- ACCEPTED GUIDANCE');
    expect(runs[0]!.prompt).toContain('--- ARCHITECTURE CONTEXT (advisory');
  });

  it('credit exhaustion needs an operator, and is never retried as if it were transient', async () => {
    const run = async (): Promise<HostedRunOutcome> =>
      refused('coder_result_untrusted', 'API Error: 400 {"message":"Your credit balance is too low to access the Anthropic API."}');
    const provider = createClaudeCodeCodingAgentProvider({ apiKey: 'FAKETESTNOTREAL', requestedModel: 'claude-x', run: run as never, queryLoader: async () => (() => (async function* () { /* none */ })()) as HostedQueryFn });
    const { adapter } = adapterWith(provider);
    const refusal = await refusalOf(adapter.dispatch(DISPATCH));
    expect(refusal!.retryable).toBe(false);
    expect(refusal!.diagnostics).toMatchObject({ codingAgentFailure: 'CREDIT_UNAVAILABLE', operatorActionRequired: true, failureReason: 'credit_unavailable' });
  });
});

/* ------------------------------------------------------ swappability */

describe('C5 — swap the provider, keep the semantics', () => {
  const completedHosted = async (input: HostedRunInput): Promise<HostedRunOutcome> => ({
    kind: 'completed',
    observation: {
      initSeen: true, sessionId: 'sess', actualModel: 'claude-x', runtimeVersion: 't', apiKeySource: 'env', reportedCwd: input.workspacePath,
      reportedTools: ['Read', 'Edit'], toolTargets: [], toolsUsed: ['Edit'], toolInvocations: 4, permissionDenials: 0, numTurns: 3, durationMs: 1,
      usage: { inputTokens: 500, outputTokens: 200, totalCostUsd: 0.02, source: 'runtime_reported' },
      streamUsage: { messages: 3, abortedMessages: 0, inputTokens: 480, outputTokens: 190, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
      resultSubtype: 'success', isError: false, terminalReason: null, finalText: 'Implemented the slug.', thinkingBlocksOmitted: 0, unknownMessageCount: 0,
    },
    envelope: compileHostedEnvelope({ workspacePath: input.workspacePath }), startedAt: 't', completedAt: 't',
  }) as never;

  const providers = () => ({
    'claude-code': createClaudeCodeCodingAgentProvider({ apiKey: 'FAKETESTNOTREAL', requestedModel: 'claude-x', run: completedHosted as never, queryLoader: async () => (() => (async function* () { /* none */ })()) as HostedQueryFn }),
    'codex-shaped': createCodexShapedCodingAgentProvider({
      renderPrompt: (request) => renderJuliusCodingAgentPrompt(request, JULIUS_CODING_AGENT_CHARTER),
      respond: (): CodexShapedResponse => ({ status: 'completed', output_text: 'Implemented the slug.', model: 'codex-x', usage: { input_tokens: 500, output_tokens: 200, cost_usd: 0.02 } }),
    }),
    'generic': createScriptedCodingAgentProvider({ script: [{ kind: 'completed', finalText: 'Implemented the slug.' }] }),
  });

  it('the same work yields the same Julius result under every provider — only the transport differs', async () => {
    const shapes: Record<string, unknown> = {};
    for (const [name, provider] of Object.entries(providers())) {
      const { adapter, shell } = adapterWith(provider);
      const result = await adapter.dispatch(DISPATCH);
      shapes[name] = {
        status: result.status,
        evidence: (result.evidence as { type: string; status: string }[]).map((item) => `${item.type}:${item.status}`),
        channels: ['guidanceRequest', 'researchAsks', 'segmentResume', 'reviewVerdict', 'architecture'].filter((key) => (result as unknown as Record<string, unknown>)[key] !== undefined),
        effects: shell.invocations.map((effect) => effect.invocationKey),
      };
    }
    expect(shapes['codex-shaped']).toEqual(shapes['claude-code']);
    expect(shapes.generic).toEqual(shapes['claude-code']);
    expect(shapes['claude-code']).toEqual({
      status: 'SUCCEEDED', evidence: ['DIFF:PASSED', 'TEST:PASSED'], channels: [],
      effects: ['build-1:base', 'build-1:status', 'build-1:diff', 'build-1:test'],
    });
  });

  it('the same failure disposes the same way under every provider, though each names it in its own words', async () => {
    const codex = createCodexShapedCodingAgentProvider({
      renderPrompt: (request) => renderJuliusCodingAgentPrompt(request, JULIUS_CODING_AGENT_CHARTER),
      respond: () => ({ status: 'failed', error: { code: 'rate_limit_exceeded' }, usage: { input_tokens: 10, output_tokens: 0 } }),
    });
    const claude = createClaudeCodeCodingAgentProvider({
      apiKey: 'FAKETESTNOTREAL', requestedModel: 'claude-x',
      run: (async (input: HostedRunInput) => ({ ...(await completedHosted(input)), kind: 'refused', refusalCode: 'coder_provider_error_after_init', safeMessage: 'x', failureReason: 'rate_limited' })) as never,
      queryLoader: async () => (() => (async function* () { /* none */ })()) as HostedQueryFn,
    });
    const generic = createScriptedCodingAgentProvider({ script: [{ kind: 'failed', failure: 'RATE_LIMITED' }] });
    const dispositions = [];
    for (const provider of [claude, codex, generic]) {
      const refusal = await refusalOf(adapterWith(provider).adapter.dispatch(DISPATCH));
      dispositions.push({ code: refusal!.code, retryable: refusal!.retryable, failure: refusal!.diagnostics?.codingAgentFailure });
    }
    expect(new Set(dispositions.map((item) => JSON.stringify(item))).size).toBe(1);
    expect(dispositions[0]).toEqual({ code: 'RATE_LIMIT', retryable: true, failure: 'RATE_LIMITED' });
  });
});

/* --------------------------------------------- the workspace, honestly */

describe('C6 — what the executor saw is what the record says', () => {
  const MARKER = 'JULIUS_WORKER_PARTICIPATION_V1';

  it('new files are part of the change set and of the diff the reviewer reads', async () => {
    const provider = createScriptedCodingAgentProvider({ script: [{ kind: 'completed' }] });
    const shell = createFakeExecutorShell({ status: [' M src/slug.ts', '?? src/slug.test.ts'], untrackedDiff: 'diff --git a/src/slug.test.ts\n+new test\n' });
    const { adapter } = adapterWith(provider, shell);
    const result = await adapter.dispatch(DISPATCH) as JuliusProviderResult & { implementation?: { workspace: { changes: unknown[] } } };
    expect(result.implementation?.workspace).toEqual({
      captured: true, truncated: false,
      changes: [{ path: 'src/slug.ts', change: 'MODIFIED' }, { path: 'src/slug.test.ts', change: 'UNTRACKED' }],
    });
    const diffCommand = shell.invocations.find((effect) => effect.invocationKey === 'build-1:diff')!.command;
    expect(diffCommand, 'untracked files are rendered into the diff').toContain('git ls-files --others --exclude-standard');
    const closeCommand = shell.invocations.find((effect) => effect.invocationKey === 'build-1:status')!.command;
    expect(closeCommand, 'the change set is still read the same way').toContain('git status --porcelain=v1 --untracked-files=all -z');
    expect(closeCommand, 'beside the three-tree attribution of this attempt').toContain('git diff --name-status -z');
    expect((result.evidence as { type: string; status: string; safeSummary: string }[])[0]).toMatchObject({ type: 'DIFF', status: 'PASSED' });
    expect((result.evidence as { safeSummary: string }[])[0]!.safeSummary).toContain('2 changed path(s), 1 new');
  });

  it('a session that changed nothing is not PASSED evidence of a change', async () => {
    const provider = createScriptedCodingAgentProvider({ script: [{ kind: 'completed' }] });
    const { adapter } = adapterWith(provider, createFakeExecutorShell({ status: [] }));
    const result = await adapter.dispatch(DISPATCH);
    const diff = (result.evidence as { type: string; status: string; safeSummary: string }[])[0]!;
    expect(diff.status).toBe('INCONCLUSIVE');
    expect(diff.safeSummary).toContain('observed no change');
  });

  it('a change set the executor could not read is recorded as uncaptured, never as an empty one', async () => {
    const provider = createScriptedCodingAgentProvider({ script: [{ kind: 'completed' }] });
    const { adapter } = adapterWith(provider, createFakeExecutorShell({ statusFails: true }));
    const result = await adapter.dispatch(DISPATCH) as JuliusProviderResult & { implementation?: { workspace: { captured: boolean } } };
    expect(result.implementation?.workspace.captured).toBe(false);
    expect((result.evidence as { status: string }[])[0]!.status).toBe('INCONCLUSIVE');
  });

  it('refuses to store anything when the dispatch does not say which attempt it is', async () => {
    /**
     * A BODY UNDER A GUESSED GENERATION IS THE SILENT OVERWRITE #285 REMOVED.
     *
     * The coordinator populates `attempt` from the claim it already holds, so
     * absence means the dispatch path itself is broken. Defaulting to 0 would
     * collide every round of a repair onto one row and look like it worked —
     * which is exactly what a mutation of this guard did: it passed the entire
     * suite, because nothing asserted the refusal. This is that assertion.
     */
    const { adapter, artifacts } = adapterKeepingArtifacts(createScriptedCodingAgentProvider({ script: [{ kind: 'completed' }] }));
    const { attempt: _dropped, ...withoutAttempt } = DISPATCH;

    const error = await refusalOf(adapter.dispatch(withoutAttempt));
    expect(error, 'the dispatch must be refused, not completed').not.toBeNull();
    expect(error?.failureClass).toBe('dispatch_attempt_absent');

    for (const generation of [0, 1, 2]) {
      expect(
        await artifacts.get({ kind: 'DIFF', runId: 'run-live', taskId: 'build-1', leaseGeneration: generation }),
        `nothing was stored under generation ${String(generation)}`,
      ).toBeNull();
    }
  });

  it('a diff that could not be captured leaves no stale diff behind for the reviewer, and does not destroy the round that explains the repair', async () => {
    const provider = createScriptedCodingAgentProvider({ script: [{ kind: 'completed' }] });
    const artifacts = createInMemoryArtifactExchange();
    artifacts.seed({ kind: 'PLAN', runId: 'run-live', taskId: 'plan-1', leaseGeneration: 1, role: 'PROMPT_ARCHITECT' }, PLAN);
    // ROUND ONE really happened and its diff is why a repair was asked for.
    artifacts.seed({ kind: 'DIFF', runId: 'run-live', taskId: 'build-1', leaseGeneration: 1, role: 'CODING_AGENT' }, 'THE PREVIOUS ROUND\'S DIFF');

    const adapter = createJuliusCodingAgentAdapter({
      worker: WORKER, contexts: { snapshotFor: () => snapshot() }, artifacts, projectId: 'prj-live',
      workspacePath: '/workspace/mission', testCommand: 'npm test', shell: createFakeExecutorShell({ diffFails: true }), provider,
    });
    // ROUND TWO runs and its capture fails.
    await adapter.dispatch({ ...DISPATCH, attempt: { leaseGeneration: 2 } });

    expect(
      await artifacts.get({ kind: 'DIFF', runId: 'run-live', taskId: 'build-1', leaseGeneration: 2 }),
      'this round captured nothing, so the review refuses instead of judging old work',
    ).toBeNull();
    /**
     * AND THE ROUND BEFORE IT IS STILL THERE. This is the half the per-run map
     * could not give: it bought "no stale diff" by ERASING round one, which is
     * the evidence explaining why round two exists. Attempt-scoped keys mean
     * absence and history are no longer a trade.
     */
    expect(
      await artifacts.get({ kind: 'DIFF', runId: 'run-live', taskId: 'build-1', leaseGeneration: 1 }),
      'the round that explains the repair survives the repair',
    ).toBe('THE PREVIOUS ROUND\'S DIFF');
  });

  it('the coder\'s report is handed to Julius exactly as written — Julius, not the adapter, refuses what it must', async () => {
    const report = { outcome: 'COMPLETED', summary: 'Mission complete.', filesTouched: [], testsRun: [], remainingUncertainty: [], blockedReason: null };
    const provider = createScriptedCodingAgentProvider({ script: [{ kind: 'completed', finalText: `Done.\n${MARKER}\n${JSON.stringify({ report })}` }] });
    const { adapter } = adapterWith(provider);
    const result = await adapter.dispatch(DISPATCH) as JuliusProviderResult & { implementation?: { report?: unknown; providerKind: string } };
    expect(result.implementation?.report).toEqual(report);
    expect(result.implementation?.providerKind).toBe('generic-scripted');
  });

  it('what the coder saw the design do reaches Julius as written, beside the work — and the adapter records no architecture', async () => {
    const architectureObservations = [{ kind: 'BOUNDARY_CROSSED', subject: 'JournalReader', claim: 'Had to widen peek().', evidenceRefs: ['src/journal.ts:40'] }];
    const provider = createScriptedCodingAgentProvider({
      script: [{ kind: 'completed', finalText: `Done.
${MARKER}
${JSON.stringify({ architectureObservations })}` }],
    });
    const { adapter } = adapterWith(provider);
    const result = await adapter.dispatch(DISPATCH) as JuliusProviderResult;
    expect(result.architectureObservations).toEqual(architectureObservations);
    expect(result.architecture).toBeUndefined();
    expect(result.consistency).toBeUndefined();
    expect(result.status).toBe('SUCCEEDED');
    // What the executor saw is still the evidence; an observation is not evidence of anything.
    expect(result.evidence.map((item) => (item as { type: string }).type).sort()).toEqual(['DIFF', 'TEST']);
  });
});

/* --------------------------------------------- the digest of what it captured */

describe('what the coder records about the bodies it produced', () => {
  /**
   * THE DIGEST THE ADAPTER COMPUTES IS THE DIGEST THE RECORD KEEPS.
   *
   * DIFF evidence used to carry `artifactRef: "diff:<runId>"` — a key into the
   * in-process exchange, keyed per RUN so the next repair round overwrites it —
   * and no hash at all. TEST evidence carried neither: an exit code, and a
   * sentence about output nobody could identify.
   */
  it('names the diff and the test output by their whole sha256, and by a reference that RESOLVES', async () => {
    const { adapter, artifacts } = adapterKeepingArtifacts(createScriptedCodingAgentProvider({ script: [{ kind: 'completed' }] }));
    const result = await adapter.dispatch(DISPATCH) as JuliusProviderResult;
    const evidence = result.evidence as Array<Record<string, unknown>>;
    const diff = evidence.find((item) => item.type === 'DIFF')!;
    const test = evidence.find((item) => item.type === 'TEST')!;

    const diffBody = await artifacts.get({ kind: 'DIFF', runId: 'run-live', taskId: 'build-1', leaseGeneration: 1 });
    const testBody = await artifacts.get({ kind: 'TEST_OUTPUT', runId: 'run-live', taskId: 'build-1', leaseGeneration: 1 });
    expect(testBody, 'the test output body was captured').not.toBeNull();

    const sha = (value: string) => createHash('sha256').update(value).digest('hex');
    if (diffBody !== null) {
      expect(diff.integrityHash, 'the digest identifies the captured diff exactly').toBe(sha(diffBody));
    }
    expect(test.integrityHash, 'and the test output, which carried nothing before').toBe(sha(testBody!));
    expect(String(test.integrityHash)).toMatch(/^[0-9a-f]{64}$/u);

    /**
     * THIS ASSERTION USED TO SAY THE OPPOSITE, and it was right to.
     *
     * `artifactRef` was null because the only name a body had was a key into a
     * map that died with the process — "no durable store holds these yet, so
     * nothing is claimed". The bodies are durable and attempt-scoped now, so a
     * row that still claimed nothing would be withholding a reference that
     * works. What the reference must NOT be is a run-keyed string like
     * `diff:run-live`, which is what the old exchange would have offered and
     * what the next repair round would have overwritten.
     */
    expect(test.artifactRef, 'the reference names the ATTEMPT, so a later round cannot take it over')
      .toBe(`artifact:julius-work-artifact.v1:run-live:build-1:g1:TEST_OUTPUT`);
    expect(diff.artifactRef === null || String(diff.artifactRef).endsWith(':g1:DIFF'),
      'and the diff either has its own attempt-scoped reference or none at all').toBe(true);
    expect(String(test.artifactRef), 'never a per-run key').not.toBe('diff:run-live');
    expect(JSON.stringify(evidence), 'and no digest is left as theatre in a sentence').not.toContain('sha256:');
  });
});

describe('a diff the executor never captured', () => {
  /**
   * A digest of whatever `stdout` happened to hold would be a real sha256 of a
   * body nobody produced — the plausible-looking stand-in this column exists to
   * keep out. The evidence already says INCONCLUSIVE; the digest must say
   * nothing at all.
   */
  it('is identified by nothing, while the test output it did capture still is', async () => {
    const { adapter } = adapterKeepingArtifacts(
      createScriptedCodingAgentProvider({ script: [{ kind: 'completed' }] }),
      createFakeExecutorShell({ diffFails: true }),
    );
    const result = await adapter.dispatch(DISPATCH) as JuliusProviderResult;
    const evidence = result.evidence as Array<Record<string, unknown>>;
    const diff = evidence.find((item) => item.type === 'DIFF')!;
    expect(diff.status, 'a diff nobody captured is not PASSED').not.toBe('PASSED');
    expect(diff.integrityHash, 'and it names no bytes').toBeNull();
    expect(evidence.find((item) => item.type === 'TEST')!.integrityHash, 'the captured body still does')
      .toMatch(/^[0-9a-f]{64}$/u);
  });
});
