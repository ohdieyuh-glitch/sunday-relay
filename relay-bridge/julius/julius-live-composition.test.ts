/**
 * THE LIVE JULIUS COMPOSITION, PROVEN OFFLINE.
 *
 * Every test here runs with zero network, zero PostgreSQL and zero spawned
 * process: the REAL adapter code paths execute against injected provider
 * fakes, the REAL run loop executes against the in-memory Julius store, and
 * the fakes are injected through the same seams the production entrypoint
 * leaves at their defaults. What is being proven is the WIRING — role
 * resolution, fail-closed refusal, Julius-owned sequencing and completion,
 * payload termination, secret non-persistence — not provider behaviour.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createJuliusMemoryStore,
  type JuliusRuntimeStore,
} from '../../src/relay/mission/julius';
import type { GptRunOutcome } from '../../src/relay/connectors/gpt-architect';
import { compileHostedEnvelope } from '../hosted-coding-agent/hosted-envelope';
import type { HostedQueryFn, HostedRunOutcome } from '../hosted-coding-agent/hosted-runner';
import type { HermesOutcome, ReviewPacket } from '../hermes-reviewer';
import { createLiveArtifactExchange } from './live-workers';
import {
  ARCHITECT_WORKER,
  CODER_WORKER,
  assembleLiveJuliusRuntime,
  createContextAndClaimHandoffs,
  createRunSpendBudget,
  driveJuliusRunToTerminal,
  resolveLiveWorkers,
} from './live-composition';
import { createLiveJuliusBootstrapPort, buildTaskId, planTaskId } from './bootstrap';
import type { MissionSeedStore } from './mission-seed';
import type { ShellEffectInput, ShellEffectPort } from './executor-effects';
import { parseLiveMissionContract, compileBootstrapRequest } from '../julius-live-mission';

/* --------------------------------------------------------------- fixtures */

const LIVE_ENV: Record<string, string> = {
  OPENAI_API_KEY: 'FAKETESTNOTREAL-openai',
  OPENAI_PROMPT_ARCHITECT_MODEL: 'gpt-5.6-sol',
  RELAY_PROMPT_ARCHITECT_MODE: 'live',
  ANTHROPIC_API_KEY: 'FAKETESTNOTREAL-anthropic',
  RELAY_HOSTED_CODING_MODEL: 'claude-fable-5',
  RELAY_HERMES_PROVIDER: 'xai',
  RELAY_HERMES_MODEL: 'grok-build-0.1',
};

/** A secret-shaped canary planted in provider output; it must never persist. */
const SECRET_CANARY = 'sk-canary-must-never-appear';

const VALID_PLAN = {
  objectiveSummary: 'Implement the mission fixture change.',
  assumptions: [], unresolvedQuestions: [], requirements: [],
  architectureDecisions: [], implementationSteps: [{ id: 'S1', description: `Edit the fixture (${SECRET_CANARY})` }],
  risks: [], acceptanceCriteria: ['AC-1'], testPlan: ['npm run mission-test'],
  prohibitedActions: [], proposedContractAmendments: [], contextRefs: [],
  handoff: {
    objective: 'Implement the fixture change.',
    boundedTask: 'Edit exactly the fixture files and make the test pass.',
    acceptanceCriteria: ['AC-1'], requiredTests: ['npm run mission-test'],
    allowedFileScope: ['fixtures/live-validation/'], prohibitedActions: [],
    grantedTools: [], expectedEvidence: ['TEST'],
  },
};

const DIFF_TEXT = [
  'diff --git a/fixtures/live-validation/normalize.ts b/fixtures/live-validation/normalize.ts',
  '--- a/fixtures/live-validation/normalize.ts',
  '+++ b/fixtures/live-validation/normalize.ts',
  '+export const normalized = true;',
].join('\n');

interface FakeLog { readonly order: string[]; }

function fakeArchitect(log: FakeLog) {
  return async (): Promise<GptRunOutcome> => {
    log.order.push('architect');
    return {
      ok: true, actualModel: 'gpt-5.6-sol', responseId: 'resp_test_1', status: 'completed',
      outputText: JSON.stringify(VALID_PLAN),
      usage: { inputTokens: 100, cachedInputTokens: 0, outputTokens: 50, reasoningTokens: 0, totalTokens: 150 },
    };
  };
}

function fakeCoder(log: FakeLog, prompts: string[]) {
  return async (input: { prompt: string; workspacePath: string }): Promise<HostedRunOutcome> => {
    log.order.push('coder');
    prompts.push(input.prompt);
    const startedAt = new Date().toISOString();
    return {
      kind: 'completed',
      observation: {
        initSeen: true, sessionId: 'sess-test', actualModel: 'claude-fable-5',
        runtimeVersion: 'test', apiKeySource: 'env', reportedCwd: input.workspacePath,
        reportedTools: ['Read', 'Glob', 'Grep', 'Edit'], toolTargets: [], toolsUsed: ['Edit'],
        permissionDenials: 0, numTurns: 3, durationMs: 10,
        usage: { inputTokens: 500, outputTokens: 200, totalCostUsd: 0.02, source: 'runtime_reported' },
        resultSubtype: 'success', isError: false, finalText: `done (${SECRET_CANARY})`,
        thinkingBlocksOmitted: 0, unknownMessageCount: 0,
      },
      envelope: compileHostedEnvelope({ workspacePath: input.workspacePath }),
      startedAt, completedAt: new Date().toISOString(),
    } as HostedRunOutcome;
  };
}

function fakeReviewer(log: FakeLog, packets: ReviewPacket[], verdicts: Array<'approved' | 'changes_required'>) {
  let call = 0;
  return async (input: { packet: ReviewPacket }): Promise<HermesOutcome> => {
    log.order.push('reviewer');
    packets.push(input.packet);
    const verdict = verdicts[Math.min(call, verdicts.length - 1)];
    call += 1;
    const startedAt = new Date().toISOString();
    return {
      kind: 'reviewed',
      result: {
        verdict,
        summary: verdict === 'approved' ? 'No blocking findings.' : 'Blocking defect found.',
        findings: verdict === 'approved' ? [] : [{
          findingId: `finding-${call}`, severity: 'blocking', requirement: 'AC-1',
          explanation: 'The change does not satisfy AC-1.', evidence: 'diff',
        }],
        requirementsChecked: [{ requirement: 'AC-1', status: verdict === 'approved' ? 'passed' as const : 'failed' as const, evidence: 'diff reviewed' }],
        parseRepaired: false,
      },
      startedAt, completedAt: new Date().toISOString(),
      requestedModel: 'grok-build-0.1', servedModel: 'grok-build-0.1', provider: 'xai',
    } as HermesOutcome;
  };
}

function fakeShell(log: FakeLog, invocations: ShellEffectInput[]): ShellEffectPort {
  let n = 0;
  return {
    async run(input) {
      log.order.push(`shell:${input.command.includes('rev-parse') ? 'base' : input.command.includes('diff') ? 'diff' : 'test'}`);
      invocations.push(input);
      n += 1;
      const stdout = input.command.includes('rev-parse') ? 'abc123def\n'
        : input.command.includes('diff') ? DIFF_TEXT
          : 'mission-test: 1 passed\n';
      return { status: 'SUCCEEDED', exitCode: 0, stdout, stderr: '', invocationId: `fake-invocation-${n}` };
    },
  };
}

const fakeQuery: HostedQueryFn = () => (async function* () { /* never yields */ })();

function liveResolution(overrides: {
  env?: Record<string, string | undefined>;
  verdicts?: Array<'approved' | 'changes_required'>;
  shell?: ShellEffectPort | null;
  contexts?: Parameters<typeof resolveLiveWorkers>[0]['contexts'];
}) {
  const log: FakeLog = { order: [] };
  const prompts: string[] = [];
  const packets: ReviewPacket[] = [];
  const invocations: ShellEffectInput[] = [];
  const artifacts = createLiveArtifactExchange();
  const shell = overrides.shell === undefined ? fakeShell(log, invocations) : overrides.shell;
  const resolution = resolveLiveWorkers({
    env: overrides.env ?? LIVE_ENV,
    projectId: 'prj-live', workspacePath: '/workspace/mission', testCommand: 'npm run mission-test',
    contexts: overrides.contexts ?? { snapshotFor: () => null },
    artifacts, shell,
    runners: {
      architect: fakeArchitect(log) as never,
      coder: fakeCoder(log, prompts) as never,
      reviewer: fakeReviewer(log, packets, overrides.verdicts ?? ['approved']) as never,
      queryLoader: async () => fakeQuery,
    },
  });
  return { resolution, log, prompts, packets, invocations, artifacts };
}

/* ---------------------------------------------- role → adapter resolution */

describe('C.A.R.D. role resolution', () => {
  it('resolves each role to its live Julius adapter with the requested models', () => {
    const { resolution } = liveResolution({});
    expect(resolution.ok).toBe(true);
    const byRole = new Map(resolution.entries.map((entry) => [entry.worker.role, entry]));
    expect(byRole.get('PROMPT_ARCHITECT')?.worker.adapterId).toBe('openai-architect-live');
    expect(byRole.get('PROMPT_ARCHITECT')?.worker.providerId).toBe('openai');
    expect(byRole.get('CODING_AGENT')?.worker.adapterId).toBe('claude-agent-sdk-hosted-live');
    expect(byRole.get('CODING_AGENT')?.worker.providerId).toBe('anthropic');
    expect(byRole.get('INDEPENDENT_REVIEWER')?.worker.adapterId).toBe('hermes-local-live');
    expect(byRole.get('INDEPENDENT_REVIEWER')?.worker.providerId).toBe('xai');
    expect(resolution.requested).toEqual({
      architectModel: 'gpt-5.6-sol', codingModel: 'claude-fable-5',
      reviewerProvider: 'xai', reviewerModel: 'grok-build-0.1',
    });
    // Every adapter answers for exactly one worker; none holds another adapter.
    for (const entry of resolution.entries) {
      expect(entry.adapter.adapterId).toBe(entry.worker.adapterId);
      expect(Object.keys(entry.adapter)).toEqual(['adapterId', 'dispatch']);
    }
  });

  it('fails closed, naming the exact missing variable, before any adapter exists', () => {
    const cases: Array<[string, string]> = [
      ['OPENAI_API_KEY', 'PROMPT_ARCHITECT'],
      ['OPENAI_PROMPT_ARCHITECT_MODEL', 'PROMPT_ARCHITECT'],
      ['RELAY_PROMPT_ARCHITECT_MODE', 'PROMPT_ARCHITECT'],
      ['ANTHROPIC_API_KEY', 'CODING_AGENT'],
      ['RELAY_HOSTED_CODING_MODEL', 'CODING_AGENT'],
      ['RELAY_HERMES_PROVIDER', 'INDEPENDENT_REVIEWER'],
      ['RELAY_HERMES_MODEL', 'INDEPENDENT_REVIEWER'],
    ];
    for (const [variable, role] of cases) {
      const env = { ...LIVE_ENV, [variable]: undefined };
      const { resolution, log } = liveResolution({ env });
      expect(resolution.ok, `${variable} missing must refuse`).toBe(false);
      expect(resolution.entries, `${variable} missing must construct nothing`).toEqual([]);
      const problem = resolution.problems.find((entry) => entry.role === role);
      expect(problem, `${variable} must be attributed to ${role}`).toBeDefined();
      expect(problem!.missing.join(' '), `${role} refusal must name ${variable}`).toContain(variable);
      expect(log.order, 'no provider fake may have been called').toEqual([]);
    }
  });

  it('refuses a reviewer that shares the Coding Agent vendor', () => {
    const { resolution } = liveResolution({ env: { ...LIVE_ENV, RELAY_HERMES_PROVIDER: 'anthropic' } });
    expect(resolution.ok).toBe(false);
    expect(resolution.problems.some((problem) => problem.reason === 'reviewer_not_independent')).toBe(true);
  });

  it('refuses the coding agent when no executor shell port exists — no local fallback', () => {
    const { resolution } = liveResolution({ shell: null });
    expect(resolution.ok).toBe(false);
    const coding = resolution.problems.find((problem) => problem.role === 'CODING_AGENT');
    expect(coding?.missing.join(' ')).toContain('executor shell port');
  });
});

/* -------------------------------------------- no scripted adapter in live */

describe('scripted and test adapters are unreachable in live mode', () => {
  it('the live composition modules never import the deterministic fixtures', () => {
    const files = [
      join('relay-bridge', 'julius', 'live-composition.ts'),
      join('relay-bridge', 'julius', 'live-workers.ts'),
      join('relay-bridge', 'julius', 'executor-effects.ts'),
      join('relay-bridge', 'julius', 'bootstrap.ts'),
      join('relay-bridge', 'julius', 'postgres-store.ts'),
      join('relay-bridge', 'julius-live-mission.ts'),
    ];
    for (const file of files) {
      const source = readFileSync(join(process.cwd(), file), 'utf8');
      expect(source, `${file} must not reach the scripted fixtures`).not.toMatch(/julius-runtime-fixtures|scriptedAdapter|runFakeArchitect/);
    }
  });
});

/* --------------------------------------------------- the bootstrap port */

function fakeSeeds(calls: string[]): MissionSeedStore {
  return {
    async ensureBase() { calls.push('ensureBase'); },
    async insertCriteria(runId, criteria) { calls.push(`criteria:${runId}:${criteria.length}`); },
    async insertBrainEntries(runId, _projectId, entries) { calls.push(`brain:${runId}:${entries.length}`); },
  };
}

function fakeRuns(calls: Array<Record<string, unknown>>) {
  let version = 0;
  return {
    async createRun(input: { runId: string }) { version = 1; calls.push({ createRun: input }); return { runId: input.runId, state: 'CREATED', version }; },
    async addTask(input: { task: { taskId: string } }) { calls.push({ addTask: input.task }); return true; },
    async transition(input: { to: string }) { version += 1; calls.push({ transition: input.to }); return { state: input.to, version }; },
  };
}

const BOOTSTRAP_REQUEST = () => compileBootstrapRequest({
  missionId: 'mission-live-1', projectId: 'prj-live', tenantId: 'tenant-live',
  objective: 'Prove the live chain with a tiny fixture.',
  requirements: ['Normalize a mission label.'], constraints: ['Touch only the fixture.'],
  acceptanceCriteria: [{ id: 'AC-1', text: 'The fixture test passes.', blocking: true }],
  testCommand: 'npm run mission-test', workspacePath: '/workspace/mission',
}, [
  { role: 'PROMPT_ARCHITECT', integrationId: 'a', adapterId: 'openai-architect-live', independenceGroup: 'openai', requiredCapabilities: ['plan'] },
  { role: 'CODING_AGENT', integrationId: 'b', adapterId: 'claude-agent-sdk-hosted-live', independenceGroup: 'anthropic', requiredCapabilities: ['implement'] },
  { role: 'INDEPENDENT_REVIEWER', integrationId: 'c', adapterId: 'hermes-local-live', independenceGroup: 'xai', requiredCapabilities: ['review'] },
], 'card-test-1');

describe('the production JuliusBootstrapPort', () => {
  it('creates the run, criteria, brain entries and the plan→build task graph, then advances to READY', async () => {
    const seedCalls: string[] = [];
    const runCalls: Array<Record<string, unknown>> = [];
    const port = createLiveJuliusBootstrapPort({
      runs: fakeRuns(runCalls) as never, seeds: fakeSeeds(seedCalls),
      tenantId: 'tenant-live', executionId: 'execution-live',
    });
    const outcome = await port.submit(BOOTSTRAP_REQUEST());
    expect(outcome.accepted).toBe(true);
    if (!outcome.accepted) return;
    expect(outcome.state).toBe('READY');
    expect(seedCalls[0]).toBe('ensureBase');
    expect(seedCalls).toContain(`criteria:${outcome.runId}:1`);
    const tasks = runCalls.filter((call) => 'addTask' in call).map((call) => (call.addTask as { taskId: string }).taskId);
    expect(tasks).toEqual([planTaskId(outcome.runId), buildTaskId(outcome.runId)]);
    expect(runCalls.filter((call) => 'transition' in call).map((call) => call.transition)).toEqual(['PLANNING', 'READY']);
  });

  it('refuses a mission with no criteria, no blocking criterion, or a missing role', async () => {
    const port = createLiveJuliusBootstrapPort({
      runs: fakeRuns([]) as never, seeds: fakeSeeds([]),
      tenantId: 'tenant-live', executionId: 'execution-live',
    });
    const base = BOOTSTRAP_REQUEST();
    const noCriteria = await port.submit({ ...base, acceptanceCriteria: [] });
    expect(noCriteria.accepted).toBe(false);
    if (!noCriteria.accepted) expect(noCriteria.reasonCode).toBe('acceptance_criteria_missing');
    const noBlocking = await port.submit({
      ...base,
      acceptanceCriteria: [{ id: 'AC-1', text: 'soft', blocking: false }],
    });
    expect(noBlocking.accepted).toBe(false);
    if (!noBlocking.accepted) expect(noBlocking.reasonCode).toBe('blocking_acceptance_criterion_missing');
    const noReviewer = await port.submit({ ...base, workers: base.workers.filter((worker) => worker.role !== 'INDEPENDENT_REVIEWER') });
    expect(noReviewer.accepted).toBe(false);
    if (!noReviewer.accepted) expect(noReviewer.reasonCode).toBe('invalid_worker_configuration');
  });
});

/* ------------------------------------- the full drive, Julius in control */

function seedMissionRun(store: ReturnType<typeof createJuliusMemoryStore>): void {
  store.seedRun({
    runId: 'run-live', missionId: 'mission-live-1', projectId: 'prj-live', state: 'READY',
    cardRevision: 'card-test-1', missionContractRevision: 1, projectBrainRevision: 0, version: 1,
  });
  store.seedTask('run-live', {
    taskId: 'plan-1', missionId: 'mission-live-1', parentTaskId: null, dependencyIds: [],
    requiredEvidenceTypes: ['ARTIFACT'], taskType: 'plan', role: 'PROMPT_ARCHITECT', ordinal: 0, state: 'RUNNABLE',
  });
  store.seedTask('run-live', {
    taskId: 'build-1', missionId: 'mission-live-1', parentTaskId: null, dependencyIds: ['plan-1'],
    requiredEvidenceTypes: ['TEST'], taskType: 'build', role: 'CODING_AGENT', ordinal: 1, state: 'BLOCKED',
  });
  // Empty evidence-type list, matching the bootstrap: the runtime evaluates a
  // criterion's types against every verified task, so the TEST requirement is
  // carried by the build task's own requiredEvidenceTypes instead.
  store.seedCriteria('run-live', [
    { criterionId: 'AC-1', description: 'The fixture test passes.', requiredEvidenceTypes: [] },
  ]);
  store.seedBrain('run-live', [{
    entryId: 'brain-1', kind: 'CONSTRAINT', text: 'OBJECTIVE: prove the live chain with a tiny fixture.',
    taskIds: [], allowedRoles: ['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER'], sensitivity: 'INTERNAL',
  }]);
}

async function driveLiveMission(verdicts: Array<'approved' | 'changes_required'>) {
  const memory = createJuliusMemoryStore();
  const handoffs = createContextAndClaimHandoffs(memory as unknown as JuliusRuntimeStore);
  const fakes = liveResolution({ verdicts, contexts: handoffs.contexts });
  expect(fakes.resolution.ok).toBe(true);
  seedMissionRun(memory);
  const runtime = assembleLiveJuliusRuntime({
    store: handoffs.store, entries: fakes.resolution.entries,
    cardRevision: 'card-test-1', spendCeilingUsdMicros: 5_000_000, maxRepairRounds: 1,
  });
  const outcome = await driveJuliusRunToTerminal({
    loop: runtime.loop, store: handoffs.store, runId: 'run-live', projectId: 'prj-live', maxTicks: 24,
  });
  return { memory, handoffs, fakes, runtime, outcome };
}

describe('a full mission drive with Julius in control', () => {
  it('runs architect → coder → reviewer through Julius and completes only via verification', async () => {
    const { memory, fakes, outcome } = await driveLiveMission(['approved']);
    expect(outcome.state).toBe('COMPLETED');
    expect(outcome.stalled).toBe(false);

    // Julius sequencing: the architect ran first, and the coder never ran
    // before it — dependency gating, not worker choice.
    expect(fakes.log.order[0]).toBe('architect');
    expect(fakes.log.order.indexOf('coder')).toBeGreaterThan(fakes.log.order.indexOf('architect'));

    // Tool effects went through the executor port: base, diff and test.
    expect(fakes.invocations.map((invocation) => invocation.taskId)).toEqual(['build-1', 'build-1', 'build-1']);
    expect(fakes.log.order.filter((step) => step.startsWith('shell:'))).toEqual(['shell:base', 'shell:diff', 'shell:test']);

    // The reviewer reviewed the CODER'S diff, delivered through Julius-owned
    // artifacts — the coder never called the reviewer.
    const buildReview = fakes.packets.find((packet) => packet.unifiedDiff.length > 0);
    expect(buildReview?.unifiedDiff).toBe(DIFF_TEXT);
    expect(buildReview?.testCommand).toBe('npm run mission-test');

    // Structured results entered Julius: evidence rows exist for every role.
    const evidence = await memory.evidenceForRun('run-live', 'prj-live');
    const types = new Set(evidence.map((item) => item.type));
    expect(types.has('ARTIFACT')).toBe(true);
    expect(types.has('TEST')).toBe(true);
    expect(types.has('DIFF')).toBe(true);
    expect(types.has('REVIEW_FINDING')).toBe(true);

    // Completion is Julius's: verification decisions exist and accepted.
    const decisions = await memory.decisionsForRun('run-live', 'prj-live');
    expect(decisions.length).toBeGreaterThan(0);
    expect(decisions.some((decision) => decision.action === 'ACCEPT' || decision.action === 'COMPLETE')).toBe(true);
  });

  it('a blocking review verdict forces exactly one Julius repair cycle, and completion is withheld when it stays blocking', async () => {
    const { memory, fakes, outcome } = await driveLiveMission(['changes_required']);
    expect(outcome.state).not.toBe('COMPLETED');

    const tasks = await memory.tasksForRun('run-live', 'prj-live');
    const repairs = tasks.filter((task) => task.taskType.startsWith('repair:'));
    expect(repairs.length).toBeGreaterThan(0);
    expect(fakes.log.order.filter((step) => step === 'coder').length).toBeGreaterThan(1);

    const findings = await memory.findingsForRun('run-live', 'prj-live');
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((finding) => finding.blocking)).toBe(true);
  });

  it('provider payloads terminate at the adapters: no plan text, provider body or secret reaches durable state', async () => {
    const { memory, handoffs } = await driveLiveMission(['approved']);
    const durable = JSON.stringify({
      tasks: await memory.tasksForRun('run-live', 'prj-live'),
      evidence: await memory.evidenceForRun('run-live', 'prj-live'),
      findings: await memory.findingsForRun('run-live', 'prj-live'),
      decisions: await memory.decisionsForRun('run-live', 'prj-live'),
      contexts: memory.contexts(),
      brain: await handoffs.store.brainEntriesForRun('run-live', 'prj-live'),
    });
    expect(durable).not.toContain(SECRET_CANARY);
    expect(durable).not.toContain('boundedTask');
    expect(durable).not.toContain('FAKETESTNOTREAL-openai');
    expect(durable).not.toContain('FAKETESTNOTREAL-anthropic');
  });

  it('the run spend budget denies past its ceiling instead of dispatching', async () => {
    const budget = createRunSpendBudget(100);
    const first = await budget.reserve({ reservationId: 'r1', runId: 'r', projectId: 'p', taskId: 't', usdMicros: 80, inputTokens: 0, outputTokens: 0, toolCalls: 0, runtimeMs: 0, now: 'now' });
    const second = await budget.reserve({ reservationId: 'r2', runId: 'r', projectId: 'p', taskId: 't', usdMicros: 80, inputTokens: 0, outputTokens: 0, toolCalls: 0, runtimeMs: 0, now: 'now' });
    const replay = await budget.reserve({ reservationId: 'r1', runId: 'r', projectId: 'p', taskId: 't', usdMicros: 80, inputTokens: 0, outputTokens: 0, toolCalls: 0, runtimeMs: 0, now: 'now' });
    expect(first.state).toBe('RESERVED');
    expect(second.state).toBe('DENIED');
    expect(replay.state).toBe('RESERVED');
  });
});

/* --------------------------------------------------- the entry contract */

describe('the live mission contract file', () => {
  it('refuses malformed contracts with a named problem', () => {
    expect(parseLiveMissionContract('not json').ok).toBe(false);
    const missing = parseLiveMissionContract(JSON.stringify({ missionId: 'm' }));
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.problem).toContain('projectId');
    const noCriteria = parseLiveMissionContract(JSON.stringify({
      missionId: 'm', projectId: 'p', tenantId: 't', objective: 'o',
      testCommand: 'npm test', workspacePath: '/w', acceptanceCriteria: [],
    }));
    expect(noCriteria.ok).toBe(false);
    if (!noCriteria.ok) expect(noCriteria.problem).toContain('acceptanceCriteria');
  });

  it('compiles a deterministic bootstrap request so re-running the same contract resumes the same run', () => {
    const contract = {
      missionId: 'm', projectId: 'p', tenantId: 't', objective: 'o',
      requirements: [], constraints: [],
      acceptanceCriteria: [{ id: 'AC-1', text: 'passes', blocking: true }],
      testCommand: 'npm test', workspacePath: '/w',
    } as const;
    const first = compileBootstrapRequest(contract, [], 'card-test-1');
    const second = compileBootstrapRequest(contract, [], 'card-test-1');
    expect(first.idempotencyKey).toBe(second.idempotencyKey);
    expect(first.completionRule).toBe('all_blocking_criteria_and_independent_review');
    expect(JSON.stringify(first)).not.toContain('API_KEY');
  });

  it('worker roles resolved by the composition are what the bootstrap request carries', () => {
    const { resolution } = liveResolution({});
    const request = compileBootstrapRequest({
      missionId: 'm', projectId: 'p', tenantId: 't', objective: 'o',
      requirements: [], constraints: [],
      acceptanceCriteria: [{ id: 'AC-1', text: 'passes', blocking: true }],
      testCommand: 'npm test', workspacePath: '/w',
    }, resolution.entries.map((entry) => ({
      role: entry.worker.role as never, integrationId: entry.worker.workerId,
      adapterId: entry.worker.adapterId, independenceGroup: entry.worker.providerId,
      requiredCapabilities: entry.worker.capabilities,
    })), 'card-test-1');
    expect(request.workers.map((worker) => worker.adapterId)).toEqual([
      ARCHITECT_WORKER.adapterId, CODER_WORKER.adapterId, 'hermes-local-live',
    ]);
  });
});
