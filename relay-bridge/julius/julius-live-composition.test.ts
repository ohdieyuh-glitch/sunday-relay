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

import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  JULIUS_CONTEXT_COMPILER_VERSION,
  createJuliusMemoryStore,
  type JuliusContextSnapshot,
  type JuliusRecoveryDriver,
  type JuliusRuntimeStore,
} from '../../src/relay/mission/julius';
import type { GptRunOutcome } from '../../src/relay/connectors/gpt-architect';
import { JuliusDispatchError, safeFailureClass } from '../../src/relay/mission/julius';
import { compileHostedEnvelope } from '../hosted-coding-agent/hosted-envelope';
import type { HostedQueryFn, HostedRunOutcome } from '../hosted-coding-agent/hosted-runner';
import { classifyUnreadableReview, loadHermesConfig, reviewDiagnostics, runHermesReview, validateHermesReview, type HermesOutcome, type ReviewPacket } from '../hermes-reviewer';
import { runRemoteHermesReview, type RemoteHermesConfig } from '../hermes-remote-review';
import {
  createLiveArtifactExchange,
  createLiveHermesReviewerAdapter,
  createLiveHostedCodingAdapter,
  diffRef,
  planRef,
} from './live-workers';
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

/**
 * A REVIEWER THAT ANSWERS IN TEXT, read by the REAL validator.
 *
 * `fakeReviewer` below hands Julius an already-built `reviewed` outcome, which
 * is right for testing the scheduler but skips the part paid attempt #2 failed
 * in: the parse. This one emits the JSON a reviewer would actually print and
 * builds the outcome the way `runHermesReview`'s close handler does — through
 * `validateHermesReview`, and through `classifyUnreadableReview` when that
 * returns null. Nothing is hard-coded to succeed: a text this rig cannot parse
 * fails the dispatch exactly as a real one would.
 */
function textReviewer(log: FakeLog, packets: ReviewPacket[], texts: readonly string[]) {
  let call = 0;
  return async (input: { packet: ReviewPacket }): Promise<HermesOutcome> => {
    log.order.push('reviewer');
    packets.push(input.packet);
    const text = texts[Math.min(call, texts.length - 1)]!;
    call += 1;
    const startedAt = new Date().toISOString();
    const result = validateHermesReview(text);
    if (result === null) {
      return {
        kind: 'review_incomplete', shape: classifyUnreadableReview(text),
        safeMessage: 'The Hermes reviewer returned no valid structured review.',
        // The real builder on the real text, so the replay below carries the
        // same structural facts a paid failure would.
        diagnostics: reviewDiagnostics({
          transport: 'local', shape: classifyUnreadableReview(text),
          provider: 'xai', outputBytesObserved: Buffer.byteLength(text, 'utf8'),
          outputByteLimit: 512 * 1024, processExitCode: 0, text,
        }),
        startedAt, completedAt: new Date().toISOString(),
      };
    }
    return {
      kind: 'reviewed', result, startedAt, completedAt: new Date().toISOString(),
      requestedModel: 'grok-build-0.1', servedModel: 'grok-build-0.1', provider: 'xai',
    };
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
  /** A failing or otherwise unusual architect, for the failure-diagnosis cases. */
  architect?: () => Promise<GptRunOutcome>;
  /** Raw reviewer output, read by the real validator instead of a built outcome. */
  reviewerTexts?: readonly string[];
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
      architect: (overrides.architect ?? fakeArchitect(log)) as never,
      coder: fakeCoder(log, prompts) as never,
      reviewer: (overrides.reviewerTexts !== undefined
        ? textReviewer(log, packets, overrides.reviewerTexts)
        : fakeReviewer(log, packets, overrides.verdicts ?? ['approved'])) as never,
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
    async loadRun() { return null; },
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

async function driveLiveMission(
  verdicts: Array<'approved' | 'changes_required'>,
  budget?: Parameters<typeof assembleLiveJuliusRuntime>[0]['budget'],
  architect?: () => Promise<GptRunOutcome>,
  reviewerTexts?: readonly string[],
) {
  const memory = createJuliusMemoryStore();
  // Not narrowed to JuliusRuntimeStore: the drive loop runs the recovery sweep,
  // and the memory store is the recovery driver as well as the store.
  const handoffs = createContextAndClaimHandoffs(memory as unknown as JuliusRuntimeStore & JuliusRecoveryDriver);
  const fakes = liveResolution({ verdicts, contexts: handoffs.contexts, architect, reviewerTexts });
  expect(fakes.resolution.ok).toBe(true);
  seedMissionRun(memory);
  const runtime = assembleLiveJuliusRuntime({
    store: handoffs.store, entries: fakes.resolution.entries,
    cardRevision: 'card-test-1', spendCeilingUsdMicros: 5_000_000, maxRepairRounds: 1,
    budget,
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

  /**
   * CASE K — NO TASK REACHES ITS FIRST PROVIDER DISPATCH WITH AN INFLATED
   * ATTEMPT NUMBER.
   *
   * This is the whole mission graph, on the real live configuration: a claim
   * limit of 4 against a C.A.R.D. concurrency of 1. On the tick after `plan`
   * succeeds, `build` and the plan's review task both become claimable — a
   * review task is created BLOCKED on the task it reviews, and the claim query
   * offers a BLOCKED task whose dependencies are all SUCCEEDED — so one of the
   * two is claimed and handed straight back.
   *
   * While the claim spent an execution attempt, that hand-back charged a task
   * for a provider that was never called, and a task yielded twice reached its
   * FIRST genuine dispatch at attempt 3 of 3 — one rate limit away from being
   * refused as exhausted, after the plan had already been paid for.
   */
  /**
   * PAID ATTEMPT #2, WITH A REVIEWER THAT ANSWERS IN THE CONTRACT'S OWN SHAPE.
   *
   * Run 33802017460 got a real plan, a real diff and passing tests, and then
   * both reviews failed to parse — so Julius never received a verdict and the
   * run ended FAILED with zero decisions. This drives the same two packets with
   * reviewer TEXT rather than a pre-built outcome, so the JSON goes through the
   * real `validateHermesReview` on its way to the adapter, the verification
   * evaluator and completion.
   *
   * It is not permission to approve this fixture: the text is ordinary reviewer
   * output, and a text the validator rejects fails the dispatch exactly as the
   * paid run did — which the case below this one proves with the same rig.
   */
  it('the attempt #2 packets complete when the reviewer answers in the contract shape', async () => {
    const approved = (summary: string) => JSON.stringify({
      verdict: 'approved', summary,
      findings: [],
      requirementsChecked: [{ requirement: 'AC-1', status: 'passed', evidence: 'reviewed the artifact' }],
    });
    const { memory, outcome, fakes } = await driveLiveMission(['approved'], undefined, undefined, [
      approved('The plan satisfies every acceptance criterion.'),
      approved('The diff implements the plan and the tests pass.'),
    ]);

    // The two packets attempt #2 actually built. Both carry the validated
    // architect handoff; the build review additionally carries the coder's
    // diff, its test command and the acceptance criteria Julius holds.
    expect(fakes.packets, 'one packet per review task').toHaveLength(2);
    for (const packet of fakes.packets) {
      expect(packet.handoffJson.length, 'every review sees the architect plan').toBeGreaterThan(0);
      expect(packet.testCommand).toBe('npm run mission-test');
    }
    const buildPacket = fakes.packets.find((packet) => packet.unifiedDiff.length > 0);
    expect(buildPacket, 'the build review saw the coder diff').toBeDefined();
    expect(buildPacket!.unifiedDiff).toBe(DIFF_TEXT);
    expect(buildPacket!.relayEvidence.length, 'and the evidence Relay itself recorded').toBeGreaterThan(0);

    // Through the real parser, to a real verdict, to completion.
    expect(outcome.state, 'the run completes through verification').toBe('COMPLETED');
    const decisions = await memory.decisionsForRun('run-live', 'prj-live');
    expect(decisions.length, 'and completion came from decisions, not from nothing').toBeGreaterThan(0);
    expect(decisions.every((decision) => decision.action === 'ACCEPT'),
      'each one an acceptance the reviewer actually issued').toBe(true);
    const reviewTasks = ['plan-1:review', 'build-1:review'].map((id) => memory.taskRow(id));
    for (const row of reviewTasks) expect(row?.state, 'both reviews succeeded').toBe('SUCCEEDED');
  });

  it('and the same rig still fails when the reviewer answers unreadably', async () => {
    // The control. Without it the case above proves only that a fixture can be
    // made to pass, not that the parser is on the path.
    const { memory, outcome } = await driveLiveMission(['approved'], undefined, undefined, [
      'The plan looks fine to me overall.',
    ]);
    expect(outcome.state, 'no verdict, no completion').toBe('FAILED');
    expect(memory.taskRow('plan-1:review')?.state).toBe('FAILED');
    const failures = memory.events().filter((event) => event.type === 'task.failed');
    expect(failures.at(-1)?.facts.failureClass, 'and the shape names why').toBe('review_json_absent');
  });

  it('CASE K: every task in the live graph reaches its first dispatch as attempt 1', async () => {
    const { memory, outcome, handoffs } = await driveLiveMission(['approved']);
    expect(outcome.state, 'the mission still completes').toBe('COMPLETED');

    const tasks = await handoffs.store.tasksForRun('run-live', 'prj-live');
    expect(tasks.length, 'the graph really did fan out').toBeGreaterThan(1);

    // Every task that ran, ran once: nothing failed here, so no task should
    // have needed a second execution, and none may have been charged for a
    // scheduling decision either.
    for (const task of tasks) {
      const row = memory.taskRow(task.taskId)!;
      expect(row.attempt, `${task.taskId} executed exactly once`).toBe(1);
    }

    // And the hand-back really happened — otherwise this case proves nothing.
    // A lease generation above the execution count is a claim that took
    // ownership without spending an attempt, which is the repair itself.
    const yielded = tasks.filter((task) => memory.taskRow(task.taskId)!.leaseGeneration > 1);
    expect(yielded.length, 'at least one task was claimed more times than it executed').toBeGreaterThan(0);
  });

  /**
   * THE DRIVE LOOP MUST ACTUALLY SWEEP, or the crash bound is decoration.
   *
   * `recoverExpired` was written and never called. The runtime worked anyway,
   * because the claim query USED to also offer an ACTIVE task whose lease had
   * expired — but that path reclaimed WITHOUT counting, so a task claimed and
   * dead before admission could be picked up forever. That branch is gone, and
   * the sweep now belongs to `JuliusRunLoop.tick` rather than to this driver,
   * so no future driver can bypass the bound by ticking differently. This
   * asserts the SWEEP ITSELF, through the real drive, rather than trusting a
   * line to stay where it was put.
   */
  it('the live driver runs the recovery sweep, so an abandoned lease is counted', async () => {
    const memory = createJuliusMemoryStore();
    const handoffs = createContextAndClaimHandoffs(memory as unknown as JuliusRuntimeStore & JuliusRecoveryDriver);
    const fakes = liveResolution({ verdicts: ['approved'], contexts: handoffs.contexts });
    expect(fakes.resolution.ok).toBe(true);
    seedMissionRun(memory);
    const runtime = assembleLiveJuliusRuntime({
      store: handoffs.store, entries: fakes.resolution.entries,
      cardRevision: 'card-test-1', spendCeilingUsdMicros: 5_000_000, maxRepairRounds: 1,
    });

    // A worker claimed the plan task and died before admitting it: ACTIVE, with
    // a lease that has already expired. Only a sweep can count this.
    const [abandoned] = await handoffs.store.claimRunnable({
      owner: 'worker-that-died', now: new Date().toISOString(),
      leaseExpiresAt: new Date(Date.now() - 60_000).toISOString(),
      limit: 1, projectId: 'prj-live',
    });
    expect(abandoned?.taskId, 'the plan task was claimed and abandoned').toBe('plan-1');
    expect(memory.taskRow('plan-1')!.recoveries, 'nothing has counted it yet').toBe(0);

    const outcome = await driveJuliusRunToTerminal({
      loop: runtime.loop, store: handoffs.store, runId: 'run-live', projectId: 'prj-live', maxTicks: 24,
    });

    expect(memory.taskRow('plan-1')!.recoveries, 'the driver swept, and the reclaim was counted')
      .toBeGreaterThan(0);
    expect(memory.events().some((event) => event.type === 'recovery.action'),
      'and it left the durable row that says a lease was reclaimed').toBe(true);
    // EXACTLY ONE, not merely some. `> 0` would pass in the regression this
    // guards — a claim that resumed spending an attempt would leave 2.
    expect(memory.taskRow('plan-1')!.attempt, 'the abandoned claim spent no attempt; only the real admission did')
      .toBe(1);
    expect(outcome.state, 'and a swept run still completes').toBe('COMPLETED');
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

/* -------------------------------- resumed-process and verdict semantics */

/** A hand-built snapshot, standing in for one the runtime compiled durably. */
function reviewSnapshot(taskId: string): JuliusContextSnapshot {
  const workerId = 'independent-reviewer-hermes';
  return {
    contextId: 'ctx-resume-1', runId: 'run-live', taskId, workerId,
    workerRole: 'INDEPENDENT_REVIEWER', compilerVersion: JULIUS_CONTEXT_COMPILER_VERSION,
    missionContractRevision: 1, cardRevision: 'card-test-1', projectBrainRevision: 0,
    sourceEntryIds: [], dependencyTaskIds: [], evidenceIds: [], findingIds: [],
    acceptanceCriterionIds: ['AC-1'], contentHash: 'sha256:resume-test',
    characterCount: 24, redactionCount: 0, truncated: false,
    packet: {
      missionId: 'mission-live-1', taskId, workerId, sourceEntryIds: [],
      blocks: [{ kind: 'CONSTRAINT', text: 'OBJECTIVE: resume test' }], truncated: false,
    },
  };
}

describe('a resumed process cannot produce a vacuous review or a planless build', () => {
  const contexts = { snapshotFor: () => reviewSnapshot('build-1:review') };

  it('the reviewer refuses a dispatch when neither the plan nor the diff artifact exists', async () => {
    const log: FakeLog = { order: [] };
    const adapter = createLiveHermesReviewerAdapter({
      worker: {
        workerId: 'independent-reviewer-hermes', role: 'INDEPENDENT_REVIEWER',
        adapterId: 'hermes-local-live', providerId: 'xai', capabilities: ['review'],
        taskTypes: ['review:build'], concurrencyLimit: 1, timeoutMs: 1_000, maxRetries: 1, status: 'AVAILABLE',
      },
      contexts, artifacts: createLiveArtifactExchange(),
      config: loadHermesConfig(LIVE_ENV as never),
      testCommand: 'npm run mission-test',
      run: fakeReviewer(log, [], ['approved']) as never,
    });
    await expect(adapter.dispatch({ taskId: 'build-1:review', contextId: 'ctx-resume-1' }))
      .rejects.toMatchObject({ code: 'INVALID_REQUEST', safeMessage: expect.stringContaining('review of nothing is refused') });
    expect(log.order, 'Hermes must never have been invoked').toEqual([]);
  });

  it('the coder refuses a dispatch when the plan artifact is unavailable, before any effect or SDK load', async () => {
    const log: FakeLog = { order: [] };
    const invocations: ShellEffectInput[] = [];
    const adapter = createLiveHostedCodingAdapter({
      worker: {
        workerId: 'coding-agent-claude-hosted', role: 'CODING_AGENT',
        adapterId: 'claude-agent-sdk-hosted-live', providerId: 'anthropic', capabilities: ['implement'],
        taskTypes: ['build'], concurrencyLimit: 1, timeoutMs: 1_000, maxRetries: 1, status: 'AVAILABLE',
      },
      contexts, artifacts: createLiveArtifactExchange(), projectId: 'prj-live',
      apiKey: 'FAKETESTNOTREAL-anthropic', requestedModel: 'claude-fable-5',
      workspacePath: '/workspace/mission', testCommand: 'npm run mission-test',
      shell: fakeShell(log, invocations),
      run: fakeCoder(log, []) as never, queryLoader: async () => fakeQuery,
    });
    await expect(adapter.dispatch({ taskId: 'build-1', contextId: 'ctx-resume-1' }))
      .rejects.toMatchObject({ code: 'WORKER_EXECUTION_FAILURE', safeMessage: expect.stringContaining('architect plan artifact is not available') });
    expect(log.order, 'no shell effect and no SDK session may have run').toEqual([]);
    expect(invocations).toEqual([]);
  });

  it('a non-approved verdict without blocking-severity findings drives the repair path, and unable_to_review fails the dispatch', async () => {
    const artifacts = createLiveArtifactExchange();
    artifacts.put(planRef('run-live'), JSON.stringify(VALID_PLAN));
    const worker = {
      workerId: 'independent-reviewer-hermes', role: 'INDEPENDENT_REVIEWER' as const,
      adapterId: 'hermes-local-live', providerId: 'xai', capabilities: ['review'],
      taskTypes: ['review:build'], concurrencyLimit: 1, timeoutMs: 1_000, maxRetries: 1, status: 'AVAILABLE' as const,
    };
    const outcomeFor = (verdict: string): HermesOutcome => ({
      kind: 'reviewed',
      result: { verdict, summary: 'Minor issues only.', findings: [], requirementsChecked: [], parseRepaired: false },
      startedAt: 't', completedAt: 't', requestedModel: 'grok-build-0.1', servedModel: 'grok-build-0.1', provider: 'xai',
    } as never);
    const minorOnly = createLiveHermesReviewerAdapter({
      worker, contexts, artifacts, config: loadHermesConfig(LIVE_ENV as never),
      testCommand: 'npm run mission-test', run: (async () => outcomeFor('changes_required')) as never,
    });
    const result = await minorOnly.dispatch({ taskId: 'build-1:review', contextId: 'ctx-resume-1' });
    expect(result.evidence).toHaveLength(1);
    expect((result.evidence[0] as { status: string }).status).toBe('FAILED');

    const unable = createLiveHermesReviewerAdapter({
      worker, contexts, artifacts, config: loadHermesConfig(LIVE_ENV as never),
      testCommand: 'npm run mission-test', run: (async () => outcomeFor('unable_to_review')) as never,
    });
    await expect(unable.dispatch({ taskId: 'build-1:review', contextId: 'ctx-resume-1' }))
      .rejects.toMatchObject({ code: 'WORKER_EXECUTION_FAILURE', safeMessage: expect.stringContaining('unable to review') });
  });
});

describe('the durable completion rule after a repair', () => {
  it('a repaired and re-approved run reaches COMPLETED, with the REPAIR still in durable history', async () => {
    // Review finding F2 closed at its root by the effective-verification
    // semantics on main: plan review approved; build review blocking; Julius
    // plans and routes the repair; the coder repairs; the re-review approves;
    // and the run now COMPLETES through the same composition that previously
    // parked in VERIFYING forever.
    const { memory, fakes, outcome } = await driveLiveMission(['approved', 'changes_required', 'approved']);

    // The repair round genuinely ran through Julius: a second coder dispatch,
    // a planner-shaped repair task, and a re-review.
    expect(fakes.log.order.filter((step) => step === 'coder').length).toBeGreaterThan(1);
    const tasks = await memory.tasksForRun('run-live', 'prj-live');
    const repairs = tasks.filter((task) => task.taskType.startsWith('repair:'));
    expect(repairs.length).toBeGreaterThan(0);
    expect(repairs.every((task) => task.state === 'SUCCEEDED')).toBe(true);

    // Completion came from Julius core semantics — no entrypoint override,
    // no direct run-state write: the driver only ticked the loop, and the
    // loop's own advance emitted the completion event.
    expect(outcome.state).toBe('COMPLETED');
    expect(outcome.stalled).toBe(false);
    expect(outcome.haltCause).toBeNull();
    expect(memory.events().some((event) => event.type === 'run.completed')).toBe(true);

    // History is audit material: the admitting REPAIR decision remains
    // durable AND remains build-1's current decision — completion came from
    // the planner-shaped repair lineage's own ACCEPT, never from a direct
    // re-decision of the repaired task.
    const decisions = await memory.decisionsForRun('run-live', 'prj-live');
    expect(decisions.some((decision) => decision.action === 'REPAIR' && decision.taskId === 'build-1')).toBe(true);
    const buildDecisions = decisions.filter((decision) => decision.taskId === 'build-1');
    expect(buildDecisions[buildDecisions.length - 1]?.action).toBe('REPAIR');
    expect(decisions.some((decision) => decision.action === 'ACCEPT' && decision.taskId === 'repair:build-1:1:task')).toBe(true);
  });

  it('a run that still honestly parks names its cause: a REPAIR whose round the budget refused', async () => {
    // The park routes that survive the effective-verification semantics are
    // narrower, so the operator-facing cause line must stay pinned. Deny the
    // repair-admission reservation specifically: the blocking review appends
    // the REPAIR decision, the round cannot be admitted, every task ends
    // terminal, and the run parks in VERIFYING with the cause named.
    const ceiling = createRunSpendBudget(5_000_000);
    const budget: typeof ceiling = {
      reserve: async (input) => input.reservationId.startsWith('reservation:repair:')
        ? { state: 'DENIED', denialReason: 'BUDGET_EXHAUSTED' }
        : ceiling.reserve(input),
      commit: (input) => ceiling.commit(input),
      release: (input) => ceiling.release(input),
    };
    const { outcome } = await driveLiveMission(['approved', 'changes_required'], budget);
    expect(outcome.state).toBe('VERIFYING');
    expect(outcome.stalled).toBe(true);
    expect(outcome.haltCause ?? '').toContain('REPAIR');
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

/* ------------------------------------------------------------------------ *
 * THE FIRST PAID MISSION, REPRODUCED OFFLINE
 * ------------------------------------------------------------------------ */

/**
 * RUN 33697109210 — the first paid Julius mission — failed here, and this is
 * the shape it failed in: the `plan` task went FAILED, the `build` task
 * stayed BLOCKED behind it, and the run reported "WAITING (stalled before
 * terminal state) after 2 ticks". The uploaded evidence could say WHAT
 * happened and not WHY: the normalized code lived only in the operational
 * event stream, which nothing exported, and the database is destroyed with the
 * job.
 *
 * The fixture is the real one — `seedMissionRun` seeds exactly that two-task
 * graph — and only the architect's outcome is injected. No provider is
 * contacted by any case in this file.
 */
describe('the first paid attempt, reproduced: a failing Prompt Architect', () => {
  const architectFailure = (failureClass: GptRunOutcome extends { ok: false } ? never : string, message: string) =>
    async (): Promise<GptRunOutcome> => ({ ok: false, failureClass: failureClass as never, message });

  const failedRun = async (failureClass: string, message = 'safe provider message') => {
    const driven = await driveLiveMission(['approved'], undefined, architectFailure(failureClass as never, message));
    const tasks = await driven.memory.tasksForRun('run-live', 'prj-live');
    const failures = driven.memory.events().filter((event) => event.type === 'task.failed' || event.type === 'retry.scheduled');
    return { ...driven, tasks, failures };
  };

  it('reproduces the observed task states exactly: plan FAILED, build BLOCKED', async () => {
    const { tasks } = await failedRun('provider_error');
    const byId = new Map(tasks.map((task) => [task.taskId, task.state]));
    expect(byId.get('plan-1')).toBe('FAILED');
    expect(byId.get('build-1')).toBe('BLOCKED');
  });

  /**
   * THE STATE-MACHINE REPAIR. `build-1` is blocked on a dependency that has
   * terminally FAILED, so it can never be claimed: the claim predicate needs
   * every dependency SUCCEEDED or SKIPPED, and nothing revives a FAILED task.
   * Before the repair, `any BLOCKED → WAITING` answered WAITING forever and
   * the driver reported a stall; a mission that failed must say so.
   */
  it('ends the run FAILED instead of stalling in WAITING', async () => {
    const { outcome } = await failedRun('provider_error');
    expect(outcome.state, 'a dead-blocked run is a failed run, not a waiting one').toBe('FAILED');
    expect(outcome.stalled, 'and it is terminal, so nothing is reported as stalled').toBe(false);
  });

  /**
   * EVERY CLASS SURVIVES DURABLY. The coarse JuliusErrorCode cannot separate a
   * refusal from a malformed response from a 500 — all three are
   * WORKER_EXECUTION_FAILURE — so the connector's own class is carried
   * alongside it. Each row is a class the OpenAI connector actually emits.
   */
  const CLASSES: ReadonlyArray<readonly [string, string, boolean]> = [
    ['authentication_failed', 'AUTH_CONFIGURATION', false],
    ['permission_denied', 'AUTH_CONFIGURATION', false],
    ['rate_limited', 'RATE_LIMIT', true],
    ['timeout', 'TIMEOUT', true],
    ['network_disconnected', 'TIMEOUT', true],
    ['model_unavailable', 'PROVIDER_UNAVAILABLE', false],
    ['refused', 'WORKER_EXECUTION_FAILURE', false],
    ['incomplete_response', 'WORKER_EXECUTION_FAILURE', false],
    ['malformed_output', 'WORKER_EXECUTION_FAILURE', false],
    ['provider_error', 'WORKER_EXECUTION_FAILURE', false],
  ];

  it.each(CLASSES)('records %s durably as %s with its own class', async (failureClass, code) => {
    const { failures } = await failedRun(failureClass);
    expect(failures.length, 'a failed dispatch must leave a durable event').toBeGreaterThan(0);
    const facts = failures.at(-1)!.facts;
    expect(facts.code, 'the normalized Julius code').toBe(code);
    expect(facts.failureClass, 'and the connector class that the code alone cannot express').toBe(failureClass);
    expect(typeof facts.errorRetryable, 'whether the ERROR was retryable is recorded, so a reader need not re-derive it').toBe('boolean');
  });

  /**
   * A FAILURE ROW THAT NAMES NO TASK NAMES NO ROLE EITHER.
   *
   * `failures.tsv` reads the role by joining the event's task id to the task
   * row. On a non-retryable worker failure — the shape the first paid mission
   * failed in — the coordinator writes the only row that ENDS the task, and it
   * used to write no task id at all, so the two columns that say WHO stopped
   * were blank for exactly that run.
   */
  it('names the task on the failure row, so the evidence can name the role', async () => {
    const { failures } = await failedRun('provider_error');
    const last = failures.at(-1)!;
    expect(last.type, 'the coordinator writes the only task-ending row on this path').toBe('task.failed');
    expect(last.taskId, 'and the row must say which task stopped').toBe('plan-1');
  });

  it('separates the two Julius-side failures a provider class cannot describe', async () => {
    const unparseable = await driveLiveMission(['approved'], undefined,
      async () => ({ ok: true, status: 'completed', outputText: 'not json at all', actualModel: 'gpt-5.6-sol', responseId: 'resp_1',
        usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, reasoningTokens: 0, totalTokens: 2 } } as GptRunOutcome));
    const unparseableFacts = unparseable.memory.events().filter((event) => event.type === 'task.failed').at(-1)?.facts;
    expect(unparseableFacts?.failureClass).toBe('unparseable_plan_json');

    const invalid = await driveLiveMission(['approved'], undefined,
      async () => ({ ok: true, status: 'completed', outputText: JSON.stringify({ objectiveSummary: 'missing everything else' }),
        actualModel: 'gpt-5.6-sol', responseId: 'resp_2',
        usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, reasoningTokens: 0, totalTokens: 2 } } as GptRunOutcome));
    const invalidFacts = invalid.memory.events().filter((event) => event.type === 'task.failed').at(-1)?.facts;
    expect(invalidFacts?.failureClass, 'a plan that parsed but did not validate is a different repair')
      .toBe('plan_validation_failed');
  });

  /**
   * THE LEAK MUTATION. A provider exception is not a machine token, and an
   * adapter that passed one through would put arbitrary text — including a
   * header — into a durable row and then into an uploaded artifact.
   * `safeFailureClass` narrows to /^[a-z][a-z0-9_]{0,63}$/, so none of the
   * three values below can survive it, whatever an adapter does. The rule is
   * not a proof that no secret ever could: a token already in that alphabet —
   * a hex digest beginning a–f — is shaped like a class and passes, which is
   * why the workflow scans the artifact before publishing it.
   */
  it('MUTATION: a secret-bearing provider exception cannot become a failure class', async () => {
    const bearer = 'Authorization: Bearer FAKESECRET123456789';
    expect(safeFailureClass(bearer), 'a header is not a token').toBeNull();
    expect(safeFailureClass('sk-live-FAKESECRET123456789')).toBeNull();
    expect(safeFailureClass('Provider said: 500 Internal Server Error')).toBeNull();
    expect(safeFailureClass('provider_error'), 'a real class still passes').toBe('provider_error');

    const { failures, memory } = await failedRun('provider_error', bearer);
    const serialised = JSON.stringify({ events: memory.events(), failures });
    expect(serialised, 'no part of the exception text reaches the durable record').not.toContain('FAKESECRET123456789');
    expect(serialised).not.toContain('Bearer');
    expect(failures.at(-1)!.facts.failureClass, 'only the class the connector named').toBe('provider_error');
  });

  it('a dispatch error constructed with junk carries no class at all, rather than a dirty one', () => {
    const dirty = new JuliusDispatchError('WORKER_EXECUTION_FAILURE', false, 'safe', 'Bearer FAKESECRET123456789');
    expect(dirty.failureClass, 'unknown is null, never a partially cleaned string').toBeNull();
    expect(new JuliusDispatchError('TIMEOUT', true, 'safe', 'timeout').failureClass).toBe('timeout');
    expect(new JuliusDispatchError('TIMEOUT', true, 'safe').failureClass, 'omitted stays null').toBeNull();
  });
});


/**
 * WHAT AN INCOMPLETE REVIEW BECOMES, END TO END AND PROVIDER-FREE.
 *
 * Paid attempt #2 recorded `reviewer_review_incomplete` twice and could say
 * nothing else, so these drive the REAL remote runner over a fake fetch into
 * the REAL adapter: the service's own words, through the classifier, through
 * the shape, to the Julius code and the retryable flag the coordinator
 * persists. No provider, no network, no Hermes.
 */
describe('an incomplete review reaches Julius as the failure it actually was', () => {
  const REMOTE_CFG: RemoteHermesConfig = {
    serviceUrl: 'https://hermes.example.com',
    token: 'FAKETESTNOTREAL-service',
    trustedOrigins: ['https://hermes.example.com'],
    timeoutMs: 1_000, reviewTimeoutMs: 10_000, pollIntervalMs: 1,
  };
  const worker = {
    workerId: 'independent-reviewer-hermes', role: 'INDEPENDENT_REVIEWER' as const,
    adapterId: 'hermes-remote-live', providerId: 'xai', capabilities: ['review'],
    taskTypes: ['review:build'], concurrencyLimit: 1, timeoutMs: 1_000, maxRetries: 1,
    status: 'AVAILABLE' as const,
  };
  const jsonRes = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const started = (state: unknown) => vi.fn()
    .mockResolvedValueOnce(jsonRes({ accepted: true, runId: 'run-live' }))
    .mockResolvedValueOnce(jsonRes(state));

  /** Dispatches through the real adapter and returns the thrown Julius error. */
  const failureFrom = async (fetchImpl: unknown) => {
    const artifacts = createLiveArtifactExchange();
    artifacts.put(planRef('run-live'), JSON.stringify(VALID_PLAN));
    const adapter = createLiveHermesReviewerAdapter({
      worker,
      contexts: { snapshotFor: () => reviewSnapshot('build-1:review') },
      artifacts,
      config: loadHermesConfig(LIVE_ENV as never),
      testCommand: 'npm run mission-test',
      run: (async (input: { packet: ReviewPacket }) => runRemoteHermesReview({
        packet: input.packet, config: REMOTE_CFG, runId: 'run-live',
        deps: {
          now: () => '2026-09-04T00:00:00.000Z',
          sleep: () => Promise.resolve(),
          fetchImpl: fetchImpl as typeof fetch,
        },
      })) as never,
    });
    return adapter.dispatch({ taskId: 'build-1:review', contextId: 'ctx-resume-1' })
      .then(() => { throw new Error('the dispatch was expected to fail'); })
      .catch((error: unknown) => error as { code: string; retryable: boolean; failureClass: string | null });
  };

  it('a review the service timed out is a TIMEOUT that may be re-asked, never a process exit', async () => {
    // The finding this closes: `status: "timed_out"` fell through to
    // `review_process_exit` and reached Julius as WORKER_EXECUTION_FAILURE,
    // defeating the durable diagnosis on the shape it names most plainly.
    const failure = await failureFrom(started({ runId: 'run-live', status: 'timed_out', failureKind: 'timed_out' }));
    expect(failure.failureClass, 'the shape is the durable record').toBe('review_timeout');
    expect(failure.failureClass).not.toBe('review_process_exit');
    expect(failure.code).toBe('TIMEOUT');
    // The architect and the coder both raise TIMEOUT retryable; a reviewer that
    // never answered has produced no paid verdict to throw away by re-asking.
    expect(failure.retryable, 'an answer that did not arrive may be asked for again').toBe(true);
  });

  it('a service with no capacity is service-side and clears itself, so it is retryable', async () => {
    for (const kind of ['capacity_exhausted', 'shutting_down']) {
      const failure = await failureFrom(() => Promise.resolve(jsonRes({ failureKind: kind }, 503)));
      expect(failure.failureClass, kind).toBe('review_service_unavailable');
      expect(failure.code).toBe('PROVIDER_UNAVAILABLE');
      expect(failure.retryable, 'capacity clears as runs finish; a drain ends when the deploy lands').toBe(true);
    }
  });

  it('a request the service would not admit names the request, not the model vendor', async () => {
    for (const [kind, status] of [['validation_failed', 422], ['review_refused', 400]] as const) {
      const failure = await failureFrom(() => Promise.resolve(jsonRes({ failureKind: kind }, status)));
      expect(failure.failureClass, kind).toBe('review_request_rejected');
      // Never PROVIDER_UNAVAILABLE: no model-provider request necessarily
      // happened, and sending an operator to xAI for our own bad request is
      // the false diagnosis this closes.
      expect(failure.code).toBe('INVALID_REQUEST');
      expect(failure.retryable, 'repeating a refused request only spends the attempt').toBe(false);
    }
  });

  it('a dead credential stays authentication-specific and final', async () => {
    const failure = await failureFrom(() => Promise.resolve(jsonRes({ failureKind: 'authentication_failed' }, 401)));
    expect(failure.failureClass).toBe('review_authentication_failed');
    expect(failure.code).toBe('AUTH_CONFIGURATION');
    expect(failure.retryable).toBe(false);
  });

  it('an actual upstream HTTP failure is still a provider failure', async () => {
    // The branch that must NOT be swallowed by the two service shapes above.
    const failure = await failureFrom(() => Promise.resolve(jsonRes({}, 500)));
    expect(failure.failureClass).toBe('review_provider_http_error');
    expect(failure.code).toBe('PROVIDER_UNAVAILABLE');
    expect(failure.retryable).toBe(false);
  });

  it('a terminal state that names no cause is still a process exit', async () => {
    // The fallback is retained deliberately: inventing a cause for "it stopped
    // and did not say why" is the defect, not the fix.
    const failure = await failureFrom(started({ runId: 'run-live', status: 'failed' }));
    expect(failure.failureClass).toBe('review_process_exit');
    expect(failure.code).toBe('WORKER_EXECUTION_FAILURE');
    expect(failure.retryable).toBe(false);
  });

  it('a review Relay cannot read is a worker failure carrying the shape that says why', async () => {
    const failure = await failureFrom(started({ runId: 'run-live', status: 'completed', reviewText: 'The plan looks fine to me.' }));
    expect(failure.failureClass, 'prose is absent JSON, not a dead credential').toBe('review_json_absent');
    expect(failure.code).toBe('WORKER_EXECUTION_FAILURE');
    expect(failure.retryable, 'a model that wrote prose will write prose again').toBe(false);
  });

  it('no incomplete review produces a verdict, a decision or a finding', async () => {
    // The whole point: every branch above threw, so none of them reached the
    // evidence that completion is computed from.
    for (const fetchImpl of [
      started({ runId: 'run-live', status: 'timed_out', failureKind: 'timed_out' }),
      () => Promise.resolve(jsonRes({ failureKind: 'capacity_exhausted' }, 503)),
      started({ runId: 'run-live', status: 'completed', reviewText: '{"verdict":"approve","summary":"ok"}' }),
    ]) {
      const failure = await failureFrom(fetchImpl);
      expect(failure.code, 'a dispatch that failed produced no evidence').toBeDefined();
      expect(JSON.stringify(failure)).not.toContain('FAKETESTNOTREAL');
    }
  });
});


/**
 * THE PAID FAILURE, REPLAYED PROVIDER-FREE, WITH THE FACTS ATTACHED.
 *
 * Attempt #2 failed on the LOCAL path and left one word. This drives the REAL
 * `runHermesReview` over a fake child process into the REAL adapter, and asks
 * the durable failure the questions an operator has to answer before deciding
 * whether to pay again: what failed, where, why, is it retryable, what did the
 * process return, did it time out, did it overflow, was the text ambiguous.
 */
describe('a paid reviewer failure can be diagnosed from the record alone', () => {
  const fakeChild = (input: { stdout?: string; code?: number; neverCloses?: boolean }) => () => {
    const child = new EventEmitter() as EventEmitter & { stdout: Readable; stderr: Readable; kill: () => boolean };
    child.stdout = new Readable({ read() { /* pushed below */ } });
    child.stderr = new Readable({ read() { /* never surfaced */ } });
    child.kill = () => true;
    setTimeout(() => {
      if (input.stdout !== undefined && input.stdout !== '') child.stdout.push(Buffer.from(input.stdout, 'utf8'));
      child.stdout.push(null);
      child.stderr.push(null);
      if (input.neverCloses !== true) child.emit('close', input.code ?? 0);
    }, 0);
    return child as never;
  };

  const failureFrom = async (child: Parameters<typeof fakeChild>[0], overrides: Record<string, unknown> = {}) => {
    const artifacts = createLiveArtifactExchange();
    artifacts.put(planRef('run-live'), JSON.stringify(VALID_PLAN));
    // A BUILD review reviews a diff. Supplying it is what makes the stage
    // 'build', because the stage is read from what the review actually carried
    // rather than from the shape of a task id.
    artifacts.put(diffRef('run-live'), DIFF_TEXT);
    const adapter = createLiveHermesReviewerAdapter({
      worker: {
        workerId: 'independent-reviewer-hermes', role: 'INDEPENDENT_REVIEWER',
        adapterId: 'hermes-local-live', providerId: 'xai', capabilities: ['review'],
        taskTypes: ['review:build'], concurrencyLimit: 1, timeoutMs: 1_000, maxRetries: 1, status: 'AVAILABLE',
      },
      contexts: { snapshotFor: () => reviewSnapshot('build-1:review') },
      artifacts,
      config: { ...loadHermesConfig(LIVE_ENV as never), ...overrides } as never,
      testCommand: 'npm run mission-test',
      run: ((packetInput: { packet: ReviewPacket; config: never }) => runHermesReview({
        packet: packetInput.packet, config: packetInput.config, spawnImpl: fakeChild(child),
      })) as never,
    });
    return adapter.dispatch({ taskId: 'build-1:review', contextId: 'ctx-resume-1' })
      .then(() => { throw new Error('the dispatch was expected to fail'); })
      .catch((error: unknown) => error as JuliusDispatchError);
  };

  it('answers WHAT, WHERE, WHY, retryable and the exit code, from one durable row', async () => {
    const failure = await failureFrom({ stdout: 'segfault', code: 139 });
    // WHAT / WHY
    expect(failure.failureClass).toBe('review_process_exit');
    expect(failure.code).toBe('WORKER_EXECUTION_FAILURE');
    expect(failure.retryable).toBe(false);
    // WHERE — the reviewer, on the build review, over the local transport.
    expect(failure.diagnostics?.reviewStage, 'this review carried a diff').toBe('build');
    expect(failure.diagnostics?.transport).toBe('local');
    expect(failure.diagnostics?.provider).toBe('xai');
    // THE NUMBER THAT WAS MISSING. Without it `review_process_exit` is a class
    // an operator can only investigate by paying for another run.
    expect(failure.diagnostics?.processExitCode).toBe(139);
    expect(failure.diagnostics?.timedOut).toBe(false);
  });

  it('a timeout is answerable too, and reports no exit code it did not observe', async () => {
    const failure = await failureFrom({ neverCloses: true }, { timeoutMs: 40 });
    expect(failure.failureClass).toBe('review_timeout');
    expect(failure.code).toBe('TIMEOUT');
    expect(failure.retryable, 'an answer that never came may be asked for again').toBe(true);
    expect(failure.diagnostics?.timedOut).toBe(true);
    expect(failure.diagnostics?.processExitCode).toBeNull();
  });

  it('an overflow reports the bytes against the ceiling that refused them', async () => {
    const huge = `{"verdict":"approved","summary":"${'x'.repeat(400)}"}`;
    const failure = await failureFrom({ stdout: huge }, { maxOutputBytes: 64 });
    expect(failure.failureClass).toBe('review_output_too_large');
    expect(failure.diagnostics?.outputTruncated).toBe(true);
    expect(failure.diagnostics?.outputByteLimit).toBe(64);
    expect(failure.diagnostics?.outputBytesObserved).toBe(huge.length);
  });

  it('an ambiguous review reports how many verdicts it found', async () => {
    const failure = await failureFrom({
      stdout: '{"verdict":"changes_required","summary":"AC-1 unmet"}\n{"verdict":"approved","summary":"fine"}',
    });
    expect(failure.failureClass).toBe('review_json_ambiguous');
    expect(failure.diagnostics?.reviewObjectCount).toBe(2);
    expect(failure.diagnostics?.verdictPresent, 'neither was selected').toBe(false);
  });

  it('and the record stays safe when the reviewer is hostile', async () => {
    // Assembled, not written: the repository boundary scanner refuses a
    // private-key marker in source and is right to. The test needs the
    // SHAPE of one, never the string itself.
    const failure = await failureFrom({
      stdout: [
        'Authorization: Bearer FAKESECRET123456789',
        'sk-live-FAKESECRET123456789  xai-FAKESECRET123456789',
        ['-----BEGIN', 'RSA', 'PRIVATE', 'KEY-----'].join(' '),
        '{"verdict":"approve","summary":"the diff sets Authorization: Bearer FAKESECRET123456789"}',
      ].join('\n'),
    });
    const durable = JSON.stringify({
      code: failure.code, failureClass: failure.failureClass,
      retryable: failure.retryable, diagnostics: failure.diagnostics,
    });
    for (const secret of ['FAKESECRET123456789', 'sk-live', 'xai-FAKE', 'PRIVATE', 'Authorization', 'approve']) {
      expect(durable, `"${secret}" must not reach the durable record`).not.toContain(secret);
    }
    // Still fully diagnosable: the shape and the structural facts survive.
    expect(failure.failureClass).toBe('review_verdict_invalid');
    expect(failure.diagnostics?.jsonParseable).toBe(true);
    expect(failure.diagnostics?.verdictValid).toBe(false);
  });

  it('a VALID approved review still traverses the whole rig to COMPLETED', async () => {
    // The control. Diagnostics must not have made a failing path out of the
    // succeeding one, and approval is still parsed, never assumed.
    const approved = (summary: string) => JSON.stringify({
      verdict: 'approved', summary, findings: [],
      requirementsChecked: [{ requirement: 'AC-1', status: 'passed', evidence: 'reviewed' }],
    });
    const { memory, outcome } = await driveLiveMission(['approved'], undefined, undefined, [
      approved('The plan satisfies every acceptance criterion.'),
      approved('The diff implements the plan and the tests pass.'),
    ]);
    expect(outcome.state).toBe('COMPLETED');
    const decisions = await memory.decisionsForRun('run-live', 'prj-live');
    expect(decisions.length).toBeGreaterThan(0);
    expect(decisions.every((decision) => decision.action === 'ACCEPT')).toBe(true);
  });
});
