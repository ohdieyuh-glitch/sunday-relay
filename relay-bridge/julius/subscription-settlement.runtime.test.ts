import { describe, expect, it } from 'vitest';

import { JULIUS_CONTEXT_COMPILER_VERSION, JuliusDispatchError, type JuliusContextSnapshot, type JuliusWorker } from '../../src/relay/mission/julius';
import { juliusCostComponent, summariseJuliusMissionCost } from '../../src/relay/mission/julius/julius-cost-accounting';
import type { JuliusRunLoop } from '../../src/relay/mission/julius/julius-run-loop';
import { projectJuliusSlotViews } from '../../src/relay/mission/julius/julius-runtime-api';
import {
  cardPolicy, createJuliusHarness, seedTaskContractInto, task, verificationPolicy, worker,
} from '../../src/relay/mission/julius/julius-runtime-fixtures';
import type { JuliusRunRow } from '../../src/relay/mission/julius/julius-runtime-ports';
import { JULIUS_SHARED_CEILING_VERSION, juliusSharedCeilingPolicy } from '../../src/relay/mission/julius/julius-shared-ceiling';
import { projectJuliusSlotLedger } from '../../src/relay/mission/julius/julius-slot-ledger';
import type { ClaudeAuthMode } from '../hosted-coding-agent/hosted-auth';
import { runHostedCodingAgent, type HostedQueryFn } from '../hosted-coding-agent/hosted-runner';
import { createClaudeCodeCodingAgentProvider } from './claude-code-coding-provider';
import { createFakeExecutorShell } from './coding-agent-fixtures';
import { createJuliusCodingAgentAdapter, createLiveArtifactExchange, planRef, type LiveArtifactExchange } from './live-workers';

/**
 * A SUBSCRIPTION-BACKED CODER DISPATCH, FROM THE PROVIDER TO THE LEDGER.
 *
 * The defect this exists for: the success ending priced itself by hand and never
 * looked at the auth mode, so a SUCCESSFUL `CLAUDE_SUBSCRIPTION` dispatch settled the
 * runtime's notional `total_cost_usd` as `PROVIDER_REPORTED` Anthropic API spend —
 * while every failure ending was right. The test that guarded it read the source
 * text, and the diagnostics lines alone satisfied it. Found by the Wonderland
 * integration lane reading the ledger path. And behind it a second half: the kernel
 * had no `NOT_APPLICABLE` branch, so even a correct provider's settlement was written
 * to the durable ledger as `UNKNOWN`.
 *
 * So this follows the money the way it actually travels. The Claude Code provider
 * and the hosted runner are REAL, fed a fake SDK that yields the SDK's own message
 * shapes; the Coding Agent adapter is the REAL live adapter; the executor is the
 * fake shell. In the second half that adapter is put into the REAL kernel — the
 * scheduler, the coordinator, the pipeline and the memory timeline — under the
 * live allocation rule (v3), and the durable rows are read back through the same
 * projections the bridge serves. NO PROVIDER IS CONTACTED.
 *
 * TWO CONCEPTS, AND BOTH ARE HELD (the founder's rule):
 *   - BILLING: a subscription dispatch is never API spend — `usdMicros` null, basis
 *     `NOT_APPLICABLE`, billing path `SUBSCRIPTION` — and never `UNKNOWN`, never $0.
 *   - EXECUTION BUDGET: the runtime's price still consumes the mission's budget,
 *     exactly as a bill would, so the billing mode cannot change what a later round
 *     is granted. That is asserted as EQUALITY between an API run and a
 *     subscription run.
 */

const WS = '/workspace/mission';
/** What the runtime priced the successful session at, and the failed one. */
const PRICED_USD = 0.42;
const PRICED_MICROS = 420_000;
const FAILED_PRICED_USD = 0.3;
const FAILED_PRICED_MICROS = 300_000;

const DIFF_TEXT = [
  'diff --git a/src/slug.ts b/src/slug.ts',
  '--- a/src/slug.ts',
  '+++ b/src/slug.ts',
  '@@ -1 +1 @@',
  '-export const slug = (s: string) => s;',
  '+export const slug = (s: string) => s.trim().toLowerCase();',
  '',
].join('\n');

const init = { type: 'system', subtype: 'init', model: 'claude-x-served', claude_code_version: '2.1.220', apiKeySource: 'none', cwd: WS, tools: ['Read', 'Glob', 'Grep', 'Edit'], session_id: 'sess-1' };
const result = (over: Record<string, unknown>) => ({
  type: 'result', subtype: 'success', is_error: false, result: 'Implemented the slug.', num_turns: 3, duration_ms: 1_200,
  total_cost_usd: PRICED_USD, usage: { input_tokens: 500, output_tokens: 60 }, permission_denials: [], session_id: 'sess-1', ...over,
});
/**
 * A TURN OF THE SESSION and the result's own account of it, both naming the requested model: the
 * attestation a real session carries, and the one the served-model guard reads (founder rule,
 * 2026-09-30: no automatic downgrade). Without it a success is an unattested session, and fails.
 */
const turn = { type: 'assistant', parent_tool_use_id: null, session_id: 'sess-1', message: { model: 'claude-x', content: [{ type: 'text', text: 'Implemented.' }], usage: { input_tokens: 500, output_tokens: 60 } } };
const SUCCESS = [init, turn, result({ modelUsage: { 'claude-x': { inputTokens: 500, outputTokens: 60 } } })];
const MAX_TURNS = [init, result({ subtype: 'error_max_turns', is_error: true, total_cost_usd: FAILED_PRICED_USD })];
/** A session whose runtime never starts: the SDK throws before any message, as a failed spawn does. */
const NEVER_STARTED = Object.freeze({ neverStarted: true as const });
type Session = readonly unknown[] | typeof NEVER_STARTED;

/** The fake SDK: every call yields the next script in `sessions`, the last repeating. */
const fakeSdk = (sessions: readonly Session[]): { queryFn: HostedQueryFn; calls: { count: number } } => {
  const calls = { count: 0 };
  const queryFn: HostedQueryFn = () => {
    const session = sessions[Math.min(calls.count, sessions.length - 1)]!;
    calls.count += 1;
    return (async function* () {
      if (session === NEVER_STARTED) throw new Error('spawn claude ENOENT');
      for (const message of session as readonly unknown[]) yield message;
    })();
  };
  return { queryFn, calls };
};

const claudeProvider = (mode: ClaudeAuthMode | undefined, queryFn: HostedQueryFn) => createClaudeCodeCodingAgentProvider({
  // Under a subscription the key is the empty string, exactly as the composition passes it.
  apiKey: mode === 'CLAUDE_SUBSCRIPTION' ? '' : 'FAKETESTNOTREAL',
  requestedModel: 'claude-x', run: runHostedCodingAgent, queryLoader: async () => queryFn,
  ...(mode === undefined ? {} : { authMode: mode }),
});

/* ================================================ the adapter, every ending */

const ADAPTER_WORKER: JuliusWorker = {
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
  contextId: 'ctx-1', runId: 'run-live', taskId: 'build-1', workerId: ADAPTER_WORKER.workerId, workerRole: 'CODING_AGENT',
  compilerVersion: JULIUS_CONTEXT_COMPILER_VERSION, missionContractRevision: 1, cardRevision: 'card-1', projectBrainRevision: 3,
  taskContractRevision: 2, taskContractDigest: CHARGE.binding.bindingDigest,
  sourceEntryIds: ['brain:objective'], dependencyTaskIds: [], evidenceIds: [], findingIds: [], acceptanceCriterionIds: ['AC-1'],
  contentHash: 'sha256:test', characterCount: 40, redactionCount: 0, truncated: false,
  integrityVersion: null, integrityConflicts: null, integrityExcludedEntryIds: null, integrityEvictedEntryIds: null,
  packet: {
    missionId: 'mission-1', taskId: 'build-1', workerId: ADAPTER_WORKER.workerId, sourceEntryIds: ['brain:objective'],
    blocks: [{ kind: 'OBJECTIVE', text: 'OBJECTIVE: normalize the mission label.' }], truncated: false,
  },
});
const DISPATCH = { taskId: 'build-1', contextId: 'ctx-1', taskType: 'build', contract: CHARGE, allocation: { usdMicros: 2_000_000, policyVersion: 'v3', basis: 'CODER_SHARE' } };

const adapterOver = (mode: ClaudeAuthMode | undefined, sessions: readonly Session[], shell =createFakeExecutorShell({ diff: DIFF_TEXT, status: [' M src/slug.ts'], testExitCode: 0 })) => {
  const artifacts = createLiveArtifactExchange();
  artifacts.put(planRef('run-live'), JSON.stringify({ objectiveSummary: 'Normalize.', steps: ['edit'] }));
  const sdk = fakeSdk(sessions);
  const adapter = createJuliusCodingAgentAdapter({
    worker: ADAPTER_WORKER, contexts: { snapshotFor: () => snapshot() }, artifacts, projectId: 'prj-live',
    workspacePath: WS, testCommand: 'npm test', shell, provider: claudeProvider(mode, sdk.queryFn),
  });
  return { adapter, sdk };
};
const refusalOf = async (promise: Promise<unknown>): Promise<JuliusDispatchError> => {
  const settled = await promise.then(() => null, (error: unknown) => error);
  expect(settled, 'the dispatch must fail').toBeInstanceOf(JuliusDispatchError);
  return settled as JuliusDispatchError;
};

describe('the adapter reports a subscription dispatch as no bill, at every ending', () => {
  it('SUCCESS: no API amount, NOT_APPLICABLE, SUBSCRIPTION, and the runtime price named apart as execution', async () => {
    const { adapter } = adapterOver('CLAUDE_SUBSCRIPTION', [SUCCESS]);
    const usage = (await adapter.dispatch(DISPATCH as never)).usage as Record<string, unknown>;
    expect(usage.usdMicros, 'no bill exists, so no amount is reported at all').toBeUndefined();
    expect(usage.costBasis).toBe('NOT_APPLICABLE');
    expect(usage.billingPath).toBe('SUBSCRIPTION');
    expect(usage.executionUsdMicros, 'the runtime price travels, for the execution budget only').toBe(PRICED_MICROS);
  });

  it('SUCCESS in API mode is unchanged: the runtime figure IS the bill', async () => {
    const { adapter } = adapterOver(undefined, [SUCCESS]);
    const usage = (await adapter.dispatch(DISPATCH as never)).usage as Record<string, unknown>;
    expect(usage.usdMicros).toBe(PRICED_MICROS);
    expect(usage.costBasis).toBe('PROVIDER_REPORTED');
    expect(usage.billingPath).toBe('API_BILLED');
    expect('executionUsdMicros' in usage, 'a bill needs no second figure beside it').toBe(false);
  });

  it('A PROVIDER FAILURE AFTER LAUNCH carries the same facts through the durable allowlist', async () => {
    const { adapter } = adapterOver('CLAUDE_SUBSCRIPTION', [MAX_TURNS]);
    const refusal = await refusalOf(adapter.dispatch(DISPATCH as never));
    // `JuliusDispatchError` sanitises its diagnostics at construction, so these
    // are read AFTER the allowlist: a fact it did not name would be null here.
    expect(refusal.diagnostics).toMatchObject({
      runtimeStarted: true, costUsdMicros: null, costBasis: 'NOT_APPLICABLE',
      billingPath: 'SUBSCRIPTION', executionCostUsdMicros: FAILED_PRICED_MICROS,
    });
  });

  it('AN EXECUTOR FAILURE AFTER A COMPLETED SESSION still says the session was not billed, and what it consumed', async () => {
    const { adapter } = adapterOver('CLAUDE_SUBSCRIPTION', [SUCCESS], createFakeExecutorShell({
      diff: DIFF_TEXT, status: [' M src/slug.ts'], testExitCode: 0, refuse: 'diff',
      refusal: () => new JuliusDispatchError('WORKER_EXECUTION_FAILURE', false, 'The executor refused the diff.', 'executor_refused'),
    }));
    const refusal = await refusalOf(adapter.dispatch(DISPATCH as never));
    expect(refusal.diagnostics).toMatchObject({
      runtimeStarted: true, costUsdMicros: null, costBasis: 'NOT_APPLICABLE',
      billingPath: 'SUBSCRIPTION', executionCostUsdMicros: PRICED_MICROS,
    });
  });

  /**
   * JULIUS'S OWN STORE, AFTER A PAID SESSION (independent review F8, F9, F10).
   * The executor steps write PostgreSQL through the shell port. A raw store
   * error used to leave the adapter unwrapped: an ETIMEDOUT became a provider
   * TIMEOUT and was retried, buying a second paid session (F8); a code-less
   * driver string became the worker's failure (F9); and either way the
   * session's cost facts were dropped (F10).
   */
  const afterASession = (refusal: () => Error) => adapterOver('CLAUDE_SUBSCRIPTION', [SUCCESS], createFakeExecutorShell({
    diff: DIFF_TEXT, status: [' M src/slug.ts'], testExitCode: 0, refuse: 'diff', refusal,
  }));
  const sessionFacts = { runtimeStarted: true, costBasis: 'NOT_APPLICABLE', billingPath: 'SUBSCRIPTION', executionCostUsdMicros: PRICED_MICROS };

  it('F8: a socket ETIMEDOUT from Julius’s own write after the session is Julius’s, not retried, and keeps the session’s cost', async () => {
    const { adapter, sdk } = afterASession(() => Object.assign(new Error('read ETIMEDOUT'), { code: 'ETIMEDOUT' }));
    const refusal = await refusalOf(adapter.dispatch(DISPATCH as never));
    expect(refusal).toMatchObject({ code: 'PERSISTENCE_FAILURE', retryable: false });
    expect(refusal.diagnostics).toMatchObject({ ...sessionFacts, storeErrorClass: 'connection' });
    expect(sdk.calls.count, 'one paid session, never a second').toBe(1);
  });

  it('F9: a code-less driver string after the session is a store failure, not the worker’s', async () => {
    const { adapter } = afterASession(() => new Error('Connection terminated unexpectedly'));
    const refusal = await refusalOf(adapter.dispatch(DISPATCH as never));
    expect(refusal).toMatchObject({ code: 'PERSISTENCE_FAILURE', retryable: false });
    expect(refusal.diagnostics).toMatchObject({ ...sessionFacts, storeErrorClass: 'connection' });
  });

  it('F8: a persistence failure that arrives already typed as retryable is still never retried after the session', async () => {
    const { adapter, sdk } = afterASession(() => new JuliusDispatchError('PERSISTENCE_FAILURE', true, 'Store blip.', 'persist_during_dispatch'));
    const refusal = await refusalOf(adapter.dispatch(DISPATCH as never));
    expect(refusal).toMatchObject({ code: 'PERSISTENCE_FAILURE', retryable: false });
    expect(refusal.diagnostics).toMatchObject(sessionFacts);
    expect(sdk.calls.count).toBe(1);
  });

  it('F10: any other raw error after the session still carries what the session consumed', async () => {
    const { adapter } = afterASession(() => new TypeError('Cannot read properties of undefined'));
    const refusal = await refusalOf(adapter.dispatch(DISPATCH as never));
    expect(refusal).toMatchObject({ code: 'WORKER_EXECUTION_FAILURE', retryable: false });
    expect(refusal.diagnostics).toMatchObject(sessionFacts);
  });

  it('BEFORE the session, a transient store error says nothing ran, and may be retried for free', async () => {
    const { adapter, sdk } = adapterOver('CLAUDE_SUBSCRIPTION', [SUCCESS], createFakeExecutorShell({
      diff: DIFF_TEXT, status: [' M src/slug.ts'], testExitCode: 0, refuse: 'base',
      refusal: () => Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }),
    }));
    const refusal = await refusalOf(adapter.dispatch(DISPATCH as never));
    expect(refusal).toMatchObject({ code: 'PERSISTENCE_FAILURE', retryable: true });
    expect(refusal.diagnostics).toMatchObject({ runtimeStarted: false, storeErrorClass: 'connection' });
    expect(sdk.calls.count, 'no session was launched').toBe(0);
  });
});

/* =================================================== the kernel's ledger */

const ARCHITECT = worker({
  workerId: 'architect', role: 'PROMPT_ARCHITECT',
  capabilities: ['plan'], taskTypes: ['plan', 'repair:plan'], providerId: 'openai', adapterId: 'architect-adapter',
});
const CODER = worker({
  workerId: 'coder', role: 'CODING_AGENT',
  capabilities: ['implement'], taskTypes: ['build', 'repair:build'], providerId: 'anthropic', adapterId: 'coder-adapter',
});
const REVIEWER = worker({
  workerId: 'reviewer', role: 'INDEPENDENT_REVIEWER',
  capabilities: ['review'], taskTypes: ['review:plan', 'review:build', 'review:repair:plan', 'review:repair:build'],
  providerId: 'hermes', adapterId: 'reviewer-adapter',
});
const RUN: JuliusRunRow = {
  runId: 'run-1', missionId: 'msn-1', projectId: 'prj-1', state: 'READY',
  cardRevision: 'card-r1', missionContractRevision: 7, projectBrainRevision: 3, version: 1,
};
const scope = { projectId: 'prj-1' };
const PLAN_OK = { kind: 'succeed' as const, evidence: [{ type: 'ARTIFACT', status: 'PASSED', safeSummary: 'Plan written.' }] };
const REVIEW_ACCEPT = { kind: 'succeed' as const, evidence: [{ type: 'REVIEW_FINDING', status: 'PASSED', safeSummary: 'No blocking findings.' }], answerFindings: 'RESOLVED' as const };
/** Mission 6's own terms: $5, one repair round. */
const CEILING = 5_000_000;

/** Ticks until nothing is claimed; returns how many ticks that took. */
async function drain(loop: JuliusRunLoop, maxTicks = 16): Promise<number> {
  for (let tick = 0; tick < maxTicks; tick += 1) {
    const report = await loop.tick(scope);
    if (report.claimed === 0) return tick;
  }
  return maxTicks;
}

/**
 * The real kernel with the REAL live Coding Agent adapter in the coder's slot.
 * The architect and the reviewer stay scripted: their settlements are identical in
 * every run below, so any difference between runs is the coder's alone.
 */
async function runMission(mode: ClaudeAuthMode | undefined, sessions: readonly Session[]) {
  const harness = createJuliusHarness({
    workers: [
      { worker: ARCHITECT, script: [PLAN_OK, PLAN_OK] },
      { worker: CODER, script: [] },
      { worker: REVIEWER, script: [REVIEW_ACCEPT, REVIEW_ACCEPT, REVIEW_ACCEPT] },
    ],
    card: cardPolicy({ allowedProviders: ['openai', 'anthropic', 'hermes'], capabilities: ['plan', 'implement', 'review'], concurrency: 1 }),
    verification: verificationPolicy({ reviewerRequired: true, maxRepairRounds: 1 }),
    capabilityFor: (item) => (item.role === 'PROMPT_ARCHITECT' ? 'plan' : item.role === 'INDEPENDENT_REVIEWER' ? 'review' : 'implement'),
    // THE LIVE RULE: one shared ceiling with protected floors, decided from the ledger.
    allocation: juliusSharedCeilingPolicy({ ceilingUsdMicros: CEILING, authorizedRepairRounds: 1 }),
    budgetUsdMicros: CEILING,
  });
  harness.store.seedRun(RUN);
  harness.store.seedTask('run-1', task({ taskId: 'plan-1', ordinal: 0, role: 'PROMPT_ARCHITECT', taskType: 'plan', requiredEvidenceTypes: ['ARTIFACT'] }));
  harness.store.seedTask('run-1', task({
    taskId: 'build-1', ordinal: 1, role: 'CODING_AGENT', taskType: 'build',
    state: 'BLOCKED', dependencyIds: ['plan-1'], requiredEvidenceTypes: ['TEST'],
  }));
  seedTaskContractInto(harness.store, { runId: 'run-1', projectId: 'prj-1', taskId: 'build-1' });
  harness.store.seedCriteria('run-1', [{ criterionId: 'ac-1', description: 'The slug is normalized.', requiredEvidenceTypes: [] }]);
  harness.store.seedBrain('run-1', [
    { entryId: 'brain-1', kind: 'OBJECTIVE', text: 'Normalize the slug.', taskIds: [], allowedRoles: ['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER'], sensitivity: 'INTERNAL' },
  ]);

  const artifacts: LiveArtifactExchange = createLiveArtifactExchange();
  artifacts.put(planRef('run-1'), JSON.stringify({ objectiveSummary: 'Normalize the slug.', steps: ['edit src/slug.ts'] }));
  const sdk = fakeSdk(sessions);
  const live = createJuliusCodingAgentAdapter({
    worker: CODER,
    contexts: { snapshotFor: (contextId: string) => harness.store.contexts().filter((item) => item.contextId === contextId).at(-1) ?? null } as never,
    artifacts, projectId: 'prj-1', workspacePath: WS, testCommand: 'npm test',
    shell: createFakeExecutorShell({ diff: DIFF_TEXT, status: [' M src/slug.ts'], testExitCode: 0 }),
    provider: claudeProvider(mode, sdk.queryFn),
  });
  harness.adapters.set(CODER.adapterId, live as never);
  expect(await drain(harness.loop), 'the mission settles well inside the tick budget').toBeLessThan(16);

  const { entries } = await harness.store.timeline({ runId: 'run-1', projectId: 'prj-1', sinceSequence: 0, limit: 10_000 });
  const settledForBuild = entries.filter((entry) => entry.type === 'budget.settled' && entry.taskId === 'build-1');
  const ledger = projectJuliusSlotLedger({
    runId: 'run-1', policy: null, policyVersion: JULIUS_SHARED_CEILING_VERSION, ceilingUsdMicros: CEILING,
    rows: entries.filter((entry) => entry.type.startsWith('budget.')).map((entry) => ({ type: entry.type, taskId: entry.taskId, facts: entry.facts })),
  });
  const cost = summariseJuliusMissionCost(entries.filter((entry) => entry.type === 'budget.settled').map((entry) => juliusCostComponent({
    taskId: entry.taskId ?? '', role: typeof entry.facts.role === 'string' ? entry.facts.role : null,
    basis: entry.facts.costBasis, usdMicros: entry.facts.usdMicros, estimatedUsdMicros: entry.facts.estimatedUsdMicros,
  })));
  const coderView = projectJuliusSlotViews(entries).find((view) => view.role === 'CODING_AGENT')!;
  return { sdkCalls: sdk.calls.count, settledForBuild, ledger, cost, coderView };
}

describe('the kernel settles a subscription dispatch as no bill — and still charges its execution', () => {
  it('SUCCESS: the durable row says NOT_APPLICABLE / SUBSCRIPTION with no amount, and nothing reads it as spend', async () => {
    const run = await runMission('CLAUDE_SUBSCRIPTION', [SUCCESS]);
    expect(run.sdkCalls, 'the live adapter really was the coder').toBeGreaterThan(0);
    const settled = run.settledForBuild[0]!;
    expect(settled.facts).toMatchObject({
      usdMicros: null, costBasis: 'NOT_APPLICABLE', billingPath: 'SUBSCRIPTION',
      executionUsdMicros: PRICED_MICROS, released: false,
    });
    // Every reader of that row agrees it is not money: the cost accounting…
    const coderComponent = run.cost.components.find((component) => component.taskId === 'build-1')!;
    expect(coderComponent).toMatchObject({ basis: 'NOT_APPLICABLE', knownUsdMicros: null, estimatedUsdMicros: null });
    // …the slot view the bridge serves as `/slots`…
    expect(run.coderView.knownUsdMicros, 'the world is never shown a subscription as API spend').toBe(0);
    // …and the slot ledger, which charges it as EXECUTION and never as known spend.
    const account = run.ledger.bySlot.CODING_AGENT!;
    expect(account.settledKnownUsdMicros).toBe(0);
    expect(account.settledExecutionUsdMicros).toBe(PRICED_MICROS);
  });

  it('the SAME mission in API mode books the same figure as a bill, and leaves the mission EXACTLY as much to lend', async () => {
    const subscription = await runMission('CLAUDE_SUBSCRIPTION', [SUCCESS]);
    const api = await runMission(undefined, [SUCCESS]);
    expect(api.settledForBuild[0]!.facts).toMatchObject({
      usdMicros: PRICED_MICROS, costBasis: 'PROVIDER_REPORTED', billingPath: 'API_BILLED', released: false,
    });
    expect('executionUsdMicros' in api.settledForBuild[0]!.facts).toBe(false);
    expect(api.ledger.bySlot.CODING_AGENT!.settledKnownUsdMicros).toBe(PRICED_MICROS);
    expect(api.coderView.knownUsdMicros).toBe(PRICED_MICROS);

    // THE EXECUTION BUDGET DOES NOT DEPEND ON THE BILLING MODE. Held per slot and
    // unlent across the mission are identical, so every later grant is too.
    const held = (ledger: typeof api.ledger, slot: string) => {
      const account = ledger.bySlot[slot]!;
      return account.outstandingUsdMicros + account.settledKnownUsdMicros + account.settledUnknownUsdMicros + account.settledExecutionUsdMicros;
    };
    for (const slot of ['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER']) {
      expect(held(subscription.ledger, slot), slot).toBe(held(api.ledger, slot));
      expect(subscription.ledger.bySlot[slot]!.remainingOwnEnvelopeUsdMicros, slot).toBe(api.ledger.bySlot[slot]!.remainingOwnEnvelopeUsdMicros);
    }
    expect(subscription.ledger.unallocatedUsdMicros).toBe(api.ledger.unallocatedUsdMicros);
    // And the money view differs by exactly the coder's bill, which the subscription never had.
    expect(api.cost.knownUsdMicros - subscription.cost.knownUsdMicros).toBe(PRICED_MICROS);
  });

  it('A FAILURE AFTER LAUNCH settles unreleased, NOT_APPLICABLE / SUBSCRIPTION, charged at the runtime price — never UNKNOWN', async () => {
    const run = await runMission('CLAUDE_SUBSCRIPTION', [MAX_TURNS]);
    const first = run.settledForBuild[0]!;
    expect(first.facts).toMatchObject({
      usdMicros: null, costBasis: 'NOT_APPLICABLE', billingPath: 'SUBSCRIPTION',
      executionUsdMicros: FAILED_PRICED_MICROS,
      // It RAN on the Max plan: the hold is kept, so no reader takes it for "never sent".
      released: false,
    });
    expect(run.ledger.bySlot.CODING_AGENT!.settledExecutionUsdMicros).toBeGreaterThanOrEqual(FAILED_PRICED_MICROS);
    expect(run.coderView.knownUsdMicros).toBe(0);
  });

  it('A LAUNCH THAT NEVER REACHED THE RUNTIME releases its hold, and still says how it would have been paid', async () => {
    const run = await runMission('CLAUDE_SUBSCRIPTION', [NEVER_STARTED]);
    const first = run.settledForBuild[0]!;
    // Nothing was sent, so the hold is FREED — the one case `released: true` means —
    // and the row still does not pretend a charge exists that nobody read.
    expect(first.facts).toMatchObject({
      usdMicros: null, costBasis: 'NOT_APPLICABLE', billingPath: 'SUBSCRIPTION',
      executionUsdMicros: null, released: true,
    });
    expect(run.ledger.bySlot.CODING_AGENT!.settledExecutionUsdMicros).toBe(0);
  });
});
