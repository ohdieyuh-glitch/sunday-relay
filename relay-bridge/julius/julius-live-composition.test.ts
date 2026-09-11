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
  juliusTaskContractBindingDigest,
  seedJuliusTaskContract,
  type JuliusContextSnapshot,
  type JuliusRecoveryDriver,
  type JuliusRuntimeStore,
} from '../../src/relay/mission/julius';
import type { GptRunOutcome } from '../../src/relay/connectors/gpt-architect';
import { JULIUS_PARTICIPATION_CHANNELS, JULIUS_PARTICIPATION_MARKER, JuliusDispatchError, safeFailureClass, safeReviewDiagnostics, sanitizeJuliusResearchAsks } from '../../src/relay/mission/julius';
import { compileHostedEnvelope } from '../hosted-coding-agent/hosted-envelope';
import type { HostedQueryFn, HostedRunInput, HostedRunOutcome } from '../hosted-coding-agent/hosted-runner';
import { buildReviewPrompt, loadHermesConfig, reviewDiagnostics, runHermesReview, type HermesOutcome, type ReviewPacket } from '../hermes-reviewer';
import { UNKNOWN_USAGE } from '../reviewer-harness/hermes/runner';
import { runRemoteHermesReview, type RemoteHermesConfig } from '../hermes-remote-review';
import { JULIUS_REVIEW_STAGES, repairTaskTypeFor, reviewChargeFor, reviewStageOf } from '../../src/relay/mission/julius';
import { DEFAULT_HOSTED_LIMITS, type HostedLimits } from '../hosted-coding-agent/hosted-envelope';
import {
  createLiveArtifactExchange,
  createLiveArchitectAdapter,
  createLiveHermesReviewerAdapter,
  createLiveHostedCodingAdapter,
  diffRef,
  guidanceRef,
  planRef,
} from './live-workers';
import {
  ARCHITECT_WORKER,
  CODER_WORKER,
  reviewerWorker,
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

/** What a reviewer that DID answer wrote, read by the real validator. */
const APPROVING_REVIEW = JSON.stringify({
  verdict: 'approved', summary: 'The plan satisfies every acceptance criterion.',
  findings: [], requirementsChecked: [{ requirement: 'AC-1', status: 'passed', evidence: 'read the plan' }],
});

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
        reportedTools: ['Read', 'Glob', 'Grep', 'Edit'], toolTargets: [], toolsUsed: ['Edit'], toolInvocations: 3,
        permissionDenials: 0, numTurns: 3, durationMs: 10,
        usage: { inputTokens: 500, outputTokens: 200, totalCostUsd: 0.02, source: 'runtime_reported' },
        // A COMPLETED run whose stream also reported per-turn usage. The two
        // are different numbers about different things: the terminal total,
        // and the floor the turns established on the way there.
        streamUsage: {
          messages: 3, abortedMessages: 0,
          inputTokens: 480, outputTokens: 190,
          cacheReadInputTokens: 0, cacheCreationInputTokens: 0,
        },
        resultSubtype: 'success', isError: false, finalText: `done (${SECRET_CANARY})`,
        thinkingBlocksOmitted: 0, unknownMessageCount: 0,
      },
      envelope: compileHostedEnvelope({ workspacePath: input.workspacePath }),
      startedAt, completedAt: new Date().toISOString(),
    } as HostedRunOutcome;
  };
}

/** A child process that prints one answer and exits, for the REAL runner. */
function spawnEmitting(stdout: string, code = 0) {
  return () => {
    const child = new EventEmitter() as EventEmitter & { stdout: Readable; stderr: Readable; kill: () => boolean };
    child.stdout = new Readable({ read() { /* pushed below */ } });
    child.stderr = new Readable({ read() { /* never surfaced */ } });
    /* A SIGNALLED PROCESS DIES. The runner now waits for the child it killed
       to be gone before it reports, so a `kill` that returns true and leaves
       the process running models a reviewer this repository has never met —
       `hermes-reviewer-lifecycle.test.ts` owns the cases where one does — and
       makes every timeout case here wait out the escalation grace instead. */
    child.kill = () => { child.emit('close', null); return true; };
    setTimeout(() => {
      if (stdout !== '') child.stdout.push(Buffer.from(stdout, 'utf8'));
      child.stdout.push(null);
      child.stderr.push(null);
      child.emit('close', code);
    }, 0);
    return child as never;
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
/**
 * A REVIEWER WHOSE PROCESS HANGS, for the first `hangFirst` dispatches.
 *
 * The shape paid run 34311556047 actually failed in: the child launches, never
 * writes a byte, never exits, and Relay's window closes on it. Driving the real
 * runner over a never-closing child is what makes this the same code path the
 * paid run took, rather than a hand-built `review_timeout` outcome.
 */
function hangingReviewer(
  log: FakeLog, packets: ReviewPacket[], hangFirst: number, answer: string,
) {
  let call = 0;
  const spawnHanging = (() => {
    const child = new EventEmitter() as EventEmitter & { stdout: Readable; stderr: Readable; kill: () => boolean };
    child.stdout = new Readable({ read() { /* nothing ever arrives */ } });
    child.stderr = new Readable({ read() { /* nothing ever arrives */ } });
    child.kill = () => { child.emit('close', null); return true; };
    return child as never;
  }) as never;
  return async (input: { packet: ReviewPacket }): Promise<HermesOutcome> => {
    log.order.push('reviewer');
    packets.push(input.packet);
    const hangs = call < hangFirst;
    call += 1;
    return runHermesReview({
      packet: input.packet,
      // Milliseconds instead of the production three minutes: what is being
      // proven is the ORDER of events, not the duration of one.
      config: { ...loadHermesConfig(LIVE_ENV as never), timeoutMs: 30, killGraceMs: 10 },
      spawnImpl: hangs ? spawnHanging : spawnEmitting(answer),
    });
  };
}

function textReviewer(log: FakeLog, packets: ReviewPacket[], texts: readonly string[]) {
  let call = 0;
  return async (input: { packet: ReviewPacket }): Promise<HermesOutcome> => {
    log.order.push('reviewer');
    packets.push(input.packet);
    const text = texts[Math.min(call, texts.length - 1)]!;
    call += 1;
    /**
     * THE REAL RUNNER, over a fake process.
     *
     * This used to rebuild the close handler's outcome by hand, which drifted:
     * it never ran `classifyHermesUpstreamFailure`, so an `HTTP 401:` answer
     * was classified by JSON shape and carried no status — and the harness that
     * exists to prove the paid path could not reproduce the way paid attempt #4
     * actually failed. Driving the real runner removes the duplicate entirely.
     */
    return runHermesReview({
      packet: input.packet,
      config: loadHermesConfig(LIVE_ENV as never),
      spawnImpl: spawnEmitting(text),
    });
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
      diagnostics: reviewDiagnostics({
        transport: 'local', shape: null, outcome: 'succeeded', provider: 'xai',
        requestedModel: 'grok-build-0.1', servedModel: 'grok-build-0.1',
        elapsedMs: 1_234, timeoutMs: 400_000, processStarted: true, exitObserved: true,
      }),
      usage: UNKNOWN_USAGE,
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
  /** How many reviewer dispatches hang until Relay's window closes on them. */
  reviewerHangsFirst?: number;
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
      reviewer: (overrides.reviewerHangsFirst !== undefined
        ? hangingReviewer(log, packets, overrides.reviewerHangsFirst, APPROVING_REVIEW)
        : overrides.reviewerTexts !== undefined
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
    // Bootstrap authors the build's task contract before the run is READY, so a
    // fake that omitted it would prove a bootstrap production cannot perform.
    async putTaskContract(input: { contract: { contractId: string; taskId: string; contractRevision: number; state: string } }) {
      calls.push({ putTaskContract: input.contract });
      return true;
    },
  };
}

const BOOTSTRAP_REQUEST = () => compileBootstrapRequest({
  missionId: 'mission-live-1', markerNamespace: 'test-namespace', projectId: 'prj-live', tenantId: 'tenant-live',
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
  // THE BUILD'S TASK CONTRACT, exactly as `createLiveJuliusBootstrapPort` writes
  // it: revision 1, a DRAFT, authored by Julius from the mission's own terms.
  // The accepting plan review is what locks it, which is where the production
  // pipeline locks it — so this drive exercises the real ordering rather than a
  // pre-agreed shortcut.
  const seeded = seedJuliusTaskContract({
    runId: 'run-live', taskId: 'build-1', missionContractRevision: 1,
    objective: 'Prove the live chain with a tiny fixture.',
    requirements: ['Normalize a mission label.'], constraints: ['Touch only the fixture.'],
    acceptanceCriteria: [{ id: 'AC-1', text: 'The fixture test passes.', blocking: true }],
    filesInScope: [], filesOutOfScope: [], spendUsd: 5, repairCycles: 1, requiredEvidence: ['TEST'],
  });
  if (!seeded.seeded) throw new Error(`fixture contract not derivable: ${seeded.reasonCode}`);
  void store.putTaskContract({ projectId: 'prj-live', contract: seeded.contract, occurredAt: '2026-09-08T00:00:00.000Z' });
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
  reviewerHangsFirst?: number,
) {
  const memory = createJuliusMemoryStore();
  // Not narrowed to JuliusRuntimeStore: the drive loop runs the recovery sweep,
  // and the memory store is the recovery driver as well as the store.
  const handoffs = createContextAndClaimHandoffs(memory as unknown as JuliusRuntimeStore & JuliusRecoveryDriver);
  const fakes = liveResolution({ verdicts, contexts: handoffs.contexts, architect, reviewerTexts, reviewerHangsFirst });
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
   * limit of 4 against a C.A.R.D. concurrency of 1. Before the release rule,
   * on the tick after `plan` succeeded `build` and the plan's review were BOTH
   * claimable, so one was claimed and handed straight back; now only what
   * Julius released is offered, and the hand-back is exercised by the build
   * and the build's review instead.
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

  /**
   * WHAT PAID RUN 34311556047 DID, DRIVEN HERE FOR NOTHING.
   *
   * Its Independent Reviewer hung on `review:plan` three times — 180 s each,
   * zero bytes, no exit — the run FAILED after four ticks and the Coding Agent
   * stayed BLOCKED. The safety behaviour was right and is what these cases
   * pin: a reviewer that cannot answer must never become a build that runs.
   * The reviewer is the REAL runner over a child that never writes and never
   * exits, so this is the same code path the paid run took.
   */
  it('a reviewer that hangs is asked ONCE and leaves the build BLOCKED', async () => {
    const { memory, outcome, fakes } = await driveLiveMission(
      ['approved'], undefined, undefined, undefined, Number.MAX_SAFE_INTEGER,
    );

    expect(outcome.state, 'a reviewer that never answered is not a completion').toBe('FAILED');
    expect(memory.taskRow('plan-1:review')?.state).toBe('FAILED');
    // THE WHOLE POINT. Never "the reviewer was unavailable, so the build ran".
    expect(memory.taskRow('build-1')?.state, 'the build was never released').toBe('BLOCKED');
    expect(memory.taskRow('build-1:review'), 'and so there is no build review').toBeNull();

    /**
     * ONE ATTEMPT, AND ONLY ONE.
     *
     * This read THREE, matching `failures.tsv` from run 34311556047. A review
     * now gets a single pipeline attempt, because the reviewer's failure is a
     * request that outran the engine's own per-request deadline and the second
     * and third asks reach the same wall with the same packet — three paid
     * cuts instead of one, and no more information.
     *
     * The coordinator still writes ONE `retry.scheduled`: its job is to
     * classify the ERROR, and a timeout genuinely is retryable. Whether the run
     * carries on is `decideJuliusContinuation`'s, and it declines — the same
     * division that already let a SUPERVISED run stop on a retryable error. The
     * terminal `task.failed` below is the authority on what actually happened.
     */
    const scheduled = memory.events().filter((event) => event.type === 'retry.scheduled');
    expect(scheduled).toHaveLength(1);
    expect(fakes.log.order.filter((step) => step === 'reviewer')).toHaveLength(1);
    for (const event of scheduled) {
      const facts = event.facts as Record<string, unknown>;
      // TIMEOUT STAYS RETRYABLE. It describes an answer that did not arrive,
      // not one that arrived wrong, and nothing paid for is thrown away.
      expect(facts.code).toBe('TIMEOUT');
      expect(facts.errorRetryable).toBe(true);
      expect(facts.failureClass).toBe('review_timeout');
    }

    /**
     * AND EACH ROW SAYS WHICH ASK IT WAS — 1, 2, then 3.
     *
     * Run 34311556047's three reviewer rows were distinguishable only by
     * `occurred_at`: a reader could count them and infer an order, but "this
     * was the third and last ask" was nowhere on the record, and an inference
     * is not evidence. This is the OUTER number — how many times Julius
     * dispatched the task — which is not `planAttempts`/`reviewAttempts`, the
     * provider calls made INSIDE one dispatch. Both are on the row now, and
     * they answer different questions.
     */
    expect(scheduled.map((event) => (event.facts as Record<string, unknown>).attempt)).toEqual([1]);
    // It rides every event, not only the failures: the ask that happened must
    // be visible from the dispatch row too, not only from its outcome. There is
    // one now, and the row still says which it was rather than leaving a reader
    // to infer it.
    const dispatched = memory.events().filter((event) => event.type === 'worker.dispatched'
      && event.taskId === 'plan-1:review');
    expect(dispatched.map((event) => (event.facts as Record<string, unknown>).attempt)).toEqual([1]);

    const failed = memory.events().filter((event) => event.type === 'task.failed')
      .find((event) => event.taskId === 'plan-1:review')!;
    const facts = failed.facts as Record<string, unknown>;
    expect(facts.reasonCode, 'and the run says WHY it stopped asking').toBe('RETRY_ATTEMPTS_EXHAUSTED');
    expect(facts.code).toBe('TIMEOUT');

    /**
     * AND THE PROCESS FACTS SURVIVE TO THE DURABLE ROW.
     *
     * This is the half the paid bundle was missing, and it matters MORE now
     * that there is one attempt rather than three: a row reading
     * `timed_out=true, bytes=0, no exit code` cannot say whether the provider
     * was slow, unreachable, or never asked — Hermes prints a one-shot review
     * in a single write at the end, so zero bytes is what an in-flight review
     * and a dead one both look like. These columns are the difference, and the
     * single ask has to carry all of it.
     */
    // ON THE DISPATCH ROW, which is where the bundle reads it: the terminal
    // `task.failed` is the pipeline's own autonomy decision and carries the
    // reason code, not the worker's telemetry. `worker-diagnostics.tsv` selects
    // exactly the rows that have a transport.
    const dispatch = scheduled.map((event) => event.facts as Record<string, unknown>);
    for (const attempt of dispatch) {
      expect(attempt.diag_processStarted).toBe(true);
      expect(attempt.diag_processPidObserved).toBe(false);
      expect(attempt.diag_firstOutputObserved).toBe(false);
      expect(attempt.diag_firstOutputAfterMs).toBeNull();
      expect(attempt.diag_exitObserved).toBe(true);
      expect(attempt.diag_signalSent).toBe('SIGTERM');
      expect(attempt.diag_cleanupCompleted, 'no reviewer was left running').toBe(true);
      expect(attempt.diag_timeoutMs).toBe(30);
      expect(attempt.diag_elapsedMs).not.toBeNull();
      // UNKNOWN IS NULL. Relay reads a pipe, not a socket.
      expect(attempt.diag_providerRequestStarted).toBeNull();
      // And the fields the paid bundle DID have still read the same.
      expect(attempt.diag_timedOut).toBe(true);
      expect(attempt.diag_outputBytesObserved).toBe(0);
      expect(attempt.diag_processExitCode).toBeNull();
      expect(attempt.diag_servedModel).toBeNull();
    }
  });

  /**
   * THE CASE THIS REPLACES, AND WHY THE TRADE WAS MADE.
   *
   * This read "a reviewer that hangs once and then answers still completes the
   * run", after paid run 34306850331: its first plan review timed out, its
   * second answered, and the mission COMPLETED. That recovery is real and it is
   * what a pipeline-level retry buys.
   *
   * It is given up deliberately. The retry that recovered 34306850331 is the
   * same retry that spent three paid cuts on 34311556047 without learning
   * anything, and the two are indistinguishable in advance: the packet, the
   * prompt, the engine and its per-request deadline are identical on the second
   * ask. What replaces it is a deadline large enough that the first ask should
   * not have to be lucky — 756 000 ms rather than 480 112 — plus the reviewer's
   * own bounded in-adapter correction, which handles a malformed answer inside
   * this one dispatch and is untouched.
   */
  it('a reviewer that hangs once is not asked again, and the run fails honestly', async () => {
    const { memory, outcome, fakes } = await driveLiveMission(
      ['approved'], undefined, undefined, undefined, 1,
    );

    expect(outcome.state, 'one ask, and it did not answer').toBe('FAILED');
    expect(memory.taskRow('plan-1:review')?.state).toBe('FAILED');
    // The safety property is unchanged and is the reason this is acceptable: a
    // reviewer that did not answer never becomes a build that ran.
    expect(memory.taskRow('build-1')?.state).toBe('BLOCKED');
    expect(fakes.log.order.filter((step) => step === 'reviewer')).toHaveLength(1);
    const failed = memory.events().filter((event) => event.type === 'task.failed')
      .find((event) => event.taskId === 'plan-1:review')!;
    expect((failed.facts as Record<string, unknown>).reasonCode).toBe('RETRY_ATTEMPTS_EXHAUSTED');
  });

  it('no review is ever asked a question that mentions the timeout', async () => {
    // A timeout is Relay's fact about its own window, not feedback on a plan.
    // Feeding it back would turn an infrastructure failure into a correction
    // the reviewer is asked to act on.
    //
    // This case was written around a RETRIED review — "asked the same question"
    // — and the retry is gone. The invariant it was protecting is not: every
    // packet the reviewer is ever handed must be free of Relay's own telemetry,
    // and that is now asserted over all of them rather than over a pair.
    const { fakes } = await driveLiveMission(['approved'], undefined, undefined, undefined, 1);
    expect(fakes.packets.length, 'the reviewer must have been asked at all').toBeGreaterThanOrEqual(1);
    for (const packet of fakes.packets) {
      const rendered = JSON.stringify(packet);
      for (const word of ['timed out', 'timeout', 'SIGTERM', 'review_timeout']) {
        expect(rendered.toLowerCase()).not.toContain(word.toLowerCase());
      }
    }
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
    const factsFor = (taskId: string) =>
      failures.find((event) => event.taskId === taskId)!.facts as Record<string, unknown>;
    const planFacts = factsFor('plan-1:review');
    expect(planFacts.failureClass, 'and the shape names why').toBe('review_json_absent');
    /**
     * AND THE FACTS SURVIVE THE LEDGER, which is the half a unit test on the
     * adapter cannot see. Facts are flat scalars by contract and the runtime
     * coerces anything else with `String(value)`, so the first version of this
     * telemetry reached the durable row as `[object Object]` and every column
     * the artifact reads out of it was null — present in tests, destroyed on
     * the only path that spends money.
     */
    expect(planFacts.diag_transport).toBe('local');
    expect(planFacts.diag_failureShape).toBe('review_json_absent');
    expect(planFacts.diag_jsonParseable).toBe(false);
    expect(JSON.stringify(planFacts), 'no fact may be a stringified object').not.toContain('[object Object]');
    /**
     * AND THE REVIEW NAMES ITS OWN STAGE — from the dispatched task type, not
     * from whether a diff existed (the first derivation) or from the task id
     * (the second). Under the declared graph an unreadable PLAN review ends
     * the run before any build: the plan can never be accepted, so nothing is
     * released, the coder never runs and no build review exists to misname.
     * Paid run 34037313976 built first and reviewed the plan afterwards.
     */
    expect(planFacts.diag_stage, 'the plan review is a plan review').toBe('plan');
    expect(memory.taskRow('build-1')?.state, 'the build was never released').toBe('BLOCKED');
    expect(memory.taskRow('build-1:review'), 'and so there is no build review').toBeNull();
    expect(failures.map((event) => event.taskId)).toEqual(['plan-1:review']);
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

    // The race that produced hand-backs is gone: with the release rule only
    // what Julius accepted is claimable, so the declared graph offers one
    // task per tick and nothing is claimed and handed straight back. The
    // attempt rule above is still the property under test; this records
    // that the topology no longer exercises the hand-back at all.
    const yielded = tasks.filter((task) => memory.taskRow(task.taskId)!.leaseGeneration > 1);
    expect(yielded, 'no task was claimed more times than it executed').toEqual([]);
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
    // The plan review accepts; every implementation review rejects.
    const { memory, fakes, outcome } = await driveLiveMission(['approved', 'changes_required']);
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
    taskContractRevision: 1, taskContractDigest: 'sha256:resume-contract',
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
    await expect(adapter.dispatch({ taskId: 'build-1:review', contextId: 'ctx-resume-1', taskType: 'review:build' }))
      .rejects.toMatchObject({ code: 'INVALID_REQUEST', safeMessage: expect.stringContaining('review of nothing is refused') });
    expect(log.order, 'Hermes must never have been invoked').toEqual([]);
  });

  it('the reviewer refuses a dispatch that names no stage, rather than guessing one', async () => {
    const log: FakeLog = { order: [] };
    const artifacts = createLiveArtifactExchange();
    artifacts.put(planRef('run-live'), JSON.stringify(VALID_PLAN));
    const adapter = createLiveHermesReviewerAdapter({
      worker: {
        workerId: 'independent-reviewer-hermes', role: 'INDEPENDENT_REVIEWER',
        adapterId: 'hermes-local-live', providerId: 'xai', capabilities: ['review'],
        taskTypes: ['review:build'], concurrencyLimit: 1, timeoutMs: 1_000, maxRetries: 1, status: 'AVAILABLE',
      },
      contexts, artifacts,
      config: loadHermesConfig(LIVE_ENV as never),
      testCommand: 'npm run mission-test',
      run: fakeReviewer(log, [], ['approved']) as never,
    });
    await expect(adapter.dispatch({ taskId: 'build-1:review', contextId: 'ctx-resume-1' }))
      .rejects.toMatchObject({ code: 'INVALID_REQUEST', failureClass: 'reviewer_stage_unknown' });
    expect(log.order).toEqual([]);
  });

  it('the reviewer refuses a guidance review whose packet it cannot read, before Hermes runs', async () => {
    // THE GAP THIS CLOSES. `charge.requires` has named the guidance packet
    // since the stage vocabulary was written, and this adapter read only the
    // plan — so a guidance review would have passed its own preconditions
    // holding the plan and NOT the thing it exists to judge, and its
    // "approved" would have released a continuation.
    const log: FakeLog = { order: [] };
    const artifacts = createLiveArtifactExchange();
    artifacts.put(planRef('run-live'), JSON.stringify(VALID_PLAN));
    const adapter = createLiveHermesReviewerAdapter({
      worker: {
        workerId: 'independent-reviewer-hermes', role: 'INDEPENDENT_REVIEWER',
        adapterId: 'hermes-local-live', providerId: 'xai', capabilities: ['review'],
        taskTypes: ['review:guidance'], concurrencyLimit: 1, timeoutMs: 1_000, maxRetries: 1, status: 'AVAILABLE',
      },
      contexts, artifacts,
      config: loadHermesConfig(LIVE_ENV as never),
      testCommand: 'npm run mission-test',
      run: fakeReviewer(log, [], ['approved']) as never,
    });
    await expect(adapter.dispatch({
      taskId: 'guidance:build-1:1:task:review', contextId: 'ctx-resume-1', taskType: 'review:guidance',
    })).rejects.toMatchObject({ code: 'INVALID_REQUEST', failureClass: 'reviewer_guidance_absent' });
    expect(log.order, 'Hermes must never have been invoked').toEqual([]);
  });

  it('a guidance review is prompted as GUIDANCE, carries the packet, and demands no diff', async () => {
    const log: FakeLog = { order: [] };
    const packets: ReviewPacket[] = [];
    const artifacts = createLiveArtifactExchange();
    artifacts.put(planRef('run-live'), JSON.stringify(VALID_PLAN));
    artifacts.put(guidanceRef('guidance:build-1:1:task'), '{"subObjective":"Reuse the existing reader."}');
    const adapter = createLiveHermesReviewerAdapter({
      worker: {
        workerId: 'independent-reviewer-hermes', role: 'INDEPENDENT_REVIEWER',
        adapterId: 'hermes-local-live', providerId: 'xai', capabilities: ['review'],
        taskTypes: ['review:guidance'], concurrencyLimit: 1, timeoutMs: 1_000, maxRetries: 1, status: 'AVAILABLE',
      },
      contexts, artifacts,
      config: loadHermesConfig(LIVE_ENV as never),
      testCommand: 'npm run mission-test',
      run: fakeReviewer(log, packets, ['approved']) as never,
    });
    const result = await adapter.dispatch({
      taskId: 'guidance:build-1:1:task:review', contextId: 'ctx-resume-1', taskType: 'review:guidance',
    });
    expect(result.status).toBe('SUCCEEDED');
    expect(packets).toHaveLength(1);
    expect(packets[0]!.stage).toBe('guidance');
    expect(packets[0]!.charge?.subject).toBe('GUIDANCE');
    expect(packets[0]!.guidanceJson).toContain('Reuse the existing reader.');

    // AND THE PROMPT ASKS THE RIGHT QUESTION. Before the GUIDANCE branch
    // existed this fell through to the implementation rubric: a reviewer told
    // it was judging an implementation, shown an empty diff, and never shown
    // the packet at all.
    const prompt = buildReviewPrompt(packets[0]!);
    expect(prompt).toContain('INDEPENDENT reviewer of GUIDANCE');
    expect(prompt).toContain('THE GUIDANCE UNDER REVIEW');
    expect(prompt).toContain('Reuse the existing reader.');
    expect(prompt).toContain('never widen scope');
    expect(prompt).not.toContain('UNIFIED DIFF:');
    expect(prompt).not.toContain('REVIEW of an implementation');
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
    const result = await minorOnly.dispatch({ taskId: 'build-1:review', contextId: 'ctx-resume-1', taskType: 'review:plan' });
    expect(result.evidence).toHaveLength(1);
    expect((result.evidence[0] as { status: string }).status).toBe('FAILED');

    const unable = createLiveHermesReviewerAdapter({
      worker, contexts, artifacts, config: loadHermesConfig(LIVE_ENV as never),
      testCommand: 'npm run mission-test', run: (async () => outcomeFor('unable_to_review')) as never,
    });
    await expect(unable.dispatch({ taskId: 'build-1:review', contextId: 'ctx-resume-1', taskType: 'review:plan' }))
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

/**
 * THE TASK CONTRACT, PROVEN IN A MISSION RATHER THAN IN A UNIT TEST.
 *
 * `julius-task-contract.ts` and its store are proven on their own, and the run
 * loop is proven to refuse a dispatch whose contract is not locked. What was
 * NOT proven anywhere is the property the contract exists for, in the shape a
 * mission actually has it: that by the time the Coding Agent is dispatched the
 * agreement is LOCKED, and that the reviewer of its work holds the SAME
 * agreement — not an equal-looking one, the same digest.
 *
 * A run where those two diverge is the failure the whole mechanism is for: a
 * coder judged against terms it was never given. It is invisible to a unit
 * test, because a unit test constructs both sides itself.
 *
 * `seedMissionRun` seeds the build's contract exactly as the production
 * bootstrap writes it — revision 1, DRAFT — and nothing here locks it by hand;
 * the accepting plan review is what locks it, which is where production locks
 * it too.
 */
describe('the task contract is locked before the coder runs, and binds its reviewer too', () => {
  const claims = (memory: ReturnType<typeof createJuliusMemoryStore>) =>
    memory.events()
      .filter((event) => event.type === 'task.claimed')
      .map((event) => ({ taskId: event.taskId, facts: event.facts as Record<string, unknown> }));

  it('the build is dispatched under a LOCKED contract, and its review holds the same digest', async () => {
    const { memory, outcome } = await driveLiveMission(['approved']);
    expect(outcome.state, 'the drive must complete for this to mean anything').toBe('COMPLETED');

    const contract = await memory.loadTaskContract({ projectId: 'prj-live', taskId: 'build-1' });
    expect(contract, 'the build has a contract at all').not.toBeNull();
    expect(contract!.state, 'and it is LOCKED, not still a draft').toBe('LOCKED');
    expect(contract!.bindingDigest, 'a locked contract carries its binding').toMatch(/^sha256:[0-9a-f]{16,}$/u);
    expect(contract!.lockedByEvaluatorId, 'and names who locked it').not.toBeNull();

    // THE ORDER. The lock is not merely present at the end of the run — the
    // build was CLAIMED carrying it, which is the only thing that proves the
    // coder was never dispatched under an unagreed charge.
    const build = claims(memory).find((claim) => claim.taskId === 'build-1');
    expect(build, 'the build was claimed').toBeDefined();
    expect(build!.facts.bindingDigest, 'the coder carried the binding into its dispatch')
      .toBe(contract!.bindingDigest);
    expect(build!.facts.contractRevision).toBe(contract!.contractRevision);

    // THE SAME AGREEMENT, NOT AN EQUAL-LOOKING ONE. Every claim that carries a
    // binding at all carries THIS one; a review of the build holding a
    // different digest would be a review against terms the coder never had.
    const bound = claims(memory).filter((claim) => claim.facts.bindingDigest !== null);
    expect(bound.length, 'the coder and at least one reviewer are bound').toBeGreaterThan(1);
    for (const claim of bound) {
      expect(claim.facts.bindingDigest, `${claim.taskId} holds the coder's binding`)
        .toBe(contract!.bindingDigest);
      expect(claim.facts.contractId, `${claim.taskId} holds the coder's contract`)
        .toBe(contract!.contractId);
    }
  });

  it('the coder\'s prompt carries the locked terms — the same charge its reviewer grades against', async () => {
    const { memory, fakes } = await driveLiveMission(['approved']);
    const locked = await memory.loadTaskContract({ projectId: 'prj-live', taskId: 'build-1' });
    expect(locked?.state).toBe('LOCKED');

    // The hosted coder's prompt, as the runner received it.
    const prompt = fakes.prompts[0];
    expect(prompt).toBeDefined();
    expect(prompt).toContain('--- TASK CONTRACT (locked; the reviewer grades against exactly this) ---');
    expect(prompt).toContain(`CONTRACT: ${locked!.contractId} revision ${locked!.contractRevision}`);
    expect(prompt).toContain(`BINDING DIGEST: ${locked!.bindingDigest}`);
    // The objective is whatever revision was LOCKED — here the architect's revision 2, not the seeded text.
    expect(prompt).toContain(`OBJECTIVE: ${locked!.objective}`);
    expect(prompt).toContain('ROUND: build');
    expect(prompt).toContain('[AC-1] The fixture test passes.');
    // After the plan, not instead of it: the plan is what the coder builds,
    // the contract is what the build is held to.
    expect(prompt!.indexOf('--- ARCHITECT PLAN ---')).toBeLessThan(prompt!.indexOf('--- TASK CONTRACT'));

    // And it is the SAME document the reviewer was handed: one binding digest
    // in the coder's prompt and in the build review's packet.
    const buildReview = fakes.packets.find((packet) => packet.stage === 'build');
    expect(buildReview?.contract?.binding.bindingDigest).toBe(locked!.bindingDigest);
    expect(buildReview?.contract?.objective).toBe(locked!.objective);
    expect(locked!.contractRevision, 'the architect revised the seeded terms and THAT revision was locked').toBe(2);
  });

  it('the architect is NOT bound, and null says so rather than an absence', async () => {
    // The plan task is not the contract's subject and has none. Reporting a
    // digest for it would be inventing an agreement; omitting the fact would
    // make "no contract" and "nothing was recorded" the same answer.
    const { memory } = await driveLiveMission(['approved']);
    const plan = claims(memory).find((claim) => claim.taskId === 'plan-1');
    expect(plan, 'the plan was claimed').toBeDefined();
    expect(plan!.facts.bindingDigest, 'the architect is bound by the MISSION contract, not a task one').toBeNull();
    expect(plan!.facts.contractId).toBeNull();
    expect('bindingDigest' in plan!.facts, 'and the fact is present, so null is an answer').toBe(true);
  });

  it('the binding a claim carried is the one the terms actually hash to', async () => {
    // Re-derived from the stored terms rather than trusted as a label — the
    // same check `loadTaskContract` performs on read, done here against the
    // value a dispatch actually carried. A digest agreeing with the row but not
    // with the terms would be a binding nobody could verify.
    const { memory } = await driveLiveMission(['approved']);
    const contract = await memory.loadTaskContract({ projectId: 'prj-live', taskId: 'build-1' });
    expect(contract).not.toBeNull();
    expect(juliusTaskContractBindingDigest(contract!), 're-derived from the terms themselves')
      .toBe(contract!.bindingDigest);
  });

  it('only ONE revision is ever locked, however many the run wrote', async () => {
    const { memory } = await driveLiveMission(['approved']);
    const revisions = await memory.taskContractRevisions({ projectId: 'prj-live', taskId: 'build-1' });
    expect(revisions.length, 'at least the seeded one').toBeGreaterThan(0);
    expect(revisions.filter((row) => row.state === 'LOCKED'), 'at most one locked revision').toHaveLength(1);
    // Every other revision is a draft or superseded — never a second live
    // agreement sitting beside the one the coder was dispatched under.
    for (const row of revisions) {
      if (row.state === 'LOCKED') continue;
      expect(['DRAFT', 'CHALLENGED', 'SUPERSEDED'], `revision ${row.contractRevision}`).toContain(row.state);
    }
  });
});

/* --------------------------------------------------- the entry contract */

describe('the live mission contract file', () => {
  it('refuses malformed contracts with a named problem', () => {
    expect(parseLiveMissionContract('not json').ok).toBe(false);
    // Each missing required field is NAMED, in the order they are checked —
    // a contract that says only which of thirteen fields is wrong is a contract
    // an operator can fix without reading the parser.
    const noNamespace = parseLiveMissionContract(JSON.stringify({ missionId: 'm' }));
    expect(noNamespace.ok).toBe(false);
    if (!noNamespace.ok) expect(noNamespace.problem).toContain('markerNamespace');
    const missing = parseLiveMissionContract(JSON.stringify({ missionId: 'm', markerNamespace: 'test-namespace' }));
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.problem).toContain('projectId');
    const noCriteria = parseLiveMissionContract(JSON.stringify({
      missionId: 'm', markerNamespace: 'test-namespace', projectId: 'p', tenantId: 't', objective: 'o',
      testCommand: 'npm test', workspacePath: '/w', acceptanceCriteria: [],
    }));
    expect(noCriteria.ok).toBe(false);
    if (!noCriteria.ok) expect(noCriteria.problem).toContain('acceptanceCriteria');
  });

  it('compiles a deterministic bootstrap request so re-running the same contract resumes the same run', () => {
    const contract = {
      missionId: 'm', markerNamespace: 'test-namespace', projectId: 'p', tenantId: 't', objective: 'o',
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
      missionId: 'm', markerNamespace: 'test-namespace', projectId: 'p', tenantId: 't', objective: 'o',
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
  /** `extra` carries what a real post-response failure carries: the provider
   *  answered, so it reported usage, and may have said why it stopped. */
  const architectFailure = (
    failureClass: GptRunOutcome extends { ok: false } ? never : string,
    message: string,
    extra: Partial<Extract<GptRunOutcome, { ok: false }>> = {},
  ) =>
    async (): Promise<GptRunOutcome> => ({ ok: false, failureClass: failureClass as never, message, ...extra });

  const failedRun = async (
    failureClass: string,
    message = 'safe provider message',
    extra: Partial<Extract<GptRunOutcome, { ok: false }>> = {},
  ) => {
    const driven = await driveLiveMission(['approved'], undefined, architectFailure(failureClass as never, message, extra));
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
  /**
   * PAID LIVE MISSION 4, ATTEMPT ONE, REPRODUCED — run 34459684814.
   *
   * The architect burned 62 seconds of `gpt-5.6-sol` and returned
   * `status: incomplete` having emitted no JSON. Its durable row recorded the
   * class and nothing else: no tokens, no ceiling, no reason. The connector had
   * computed the provider's usage and dropped it one line later on every
   * failure path, and the provider's own `incomplete_details.reason` survived
   * only inside a free-text message the evidence allowlist withholds — so the
   * cause could be established only by reading the connector's source.
   *
   * A paid failure has to be diagnosable and costable from its own evidence.
   */
  it('records what an incomplete plan consumed, the ceiling it consumed, and why it stopped', async () => {
    const { failures } = await failedRun('incomplete_response', 'safe provider message', {
      usage: { inputTokens: 4_210, cachedInputTokens: null, outputTokens: 4_000, reasoningTokens: 3_968, totalTokens: 8_210 },
      incompleteReason: 'max_output_tokens',
      providerStatus: 'incomplete',
    });
    const facts = failures.at(-1)!.facts;

    expect(facts.failureClass, 'the class the run actually produced').toBe('incomplete_response');
    // THE THREE THAT WERE MISSING.
    expect(facts.diag_incompleteReason, 'the provider\'s own word for why it stopped').toBe('max_output_tokens');
    expect(facts.diag_reasoningTokens, 'what the reasoning consumed — the number that explains it').toBe(3_968);
    expect(facts.diag_maxOutputTokens, 'against the ceiling in force, so the comparison is checkable').toBe(4_000);
    // AND WHAT IT COST, which a failed call was billed for either way.
    expect(facts.diag_inputTokens).toBe(4_210);
    expect(facts.diag_outputTokens).toBe(4_000);
    // Still honestly UNKNOWN in dollars: this transport reports tokens, never a price.
    expect(facts.diag_costBasis, 'tokens are not a price, and one is never inferred from the other').toBe('UNKNOWN');
    // AND WHAT THE PROVIDER CALLED IT, plus the wall clock a reader would otherwise guess at.
    expect(facts.diag_providerStatus).toBe('incomplete');
    expect(facts.diag_totalTokens).toBe(8_210);
    expect(typeof facts.diag_elapsedMs, 'the call took real time and the row says how much').toBe('number');
  });

  /**
   * A FAILURE BEFORE VALIDATION MUST NOT REPORT FAILED VALIDATION.
   *
   * `validation_passed=false` on Mission 4's row said the plan was validated
   * and rejected. Nothing was validated: the connector returned first. Those
   * are different sentences about a paid run and only one of them is true.
   */
  it('does not claim a validation verdict it never reached', async () => {
    const { failures } = await failedRun('incomplete_response', 'safe provider message', {
      usage: { inputTokens: 10, cachedInputTokens: null, outputTokens: 0, reasoningTokens: 0, totalTokens: 10 },
      incompleteReason: 'max_output_tokens',
      providerStatus: 'incomplete',
    });
    const facts = failures.at(-1)!.facts;
    expect(facts.diag_validationPassed, 'null is "never reached", which is what happened').toBeNull();
    expect(facts.diag_validationReasonCode, 'and no reason, because there was no verdict').toBeNull();
  });

  /**
   * THE PROVIDER ANSWERED WITH NOTHING vs NEVER ANSWERED — a real distinction.
   * The first is an observation that no JSON was produced; the second observed
   * nothing at all, and `false` there would be a reading nobody took.
   */
  it('separates "no JSON was produced" from "nothing was observed"', async () => {
    const answered = await failedRun('incomplete_response', 'm', {
      usage: { inputTokens: 1, cachedInputTokens: null, outputTokens: 0, reasoningTokens: 0, totalTokens: 1 },
      responseId: 'resp_x', providerStatus: 'incomplete',
    });
    expect(answered.failures.at(-1)!.facts.diag_jsonParseable, 'it answered, and no JSON was in it').toBe(false);

    const never = await failedRun('model_unavailable');
    expect(never.failures.at(-1)!.facts.diag_jsonParseable, 'nothing was observed, so nothing is claimed').toBeNull();
  });

  /**
   * ABSENT IS NOT ZERO. A failure raised BEFORE the provider answered has no
   * usage to report, and writing 0 would be a measurement nobody took.
   * `model_unavailable` is that shape and is not retryable, so the row that
   * ends the task is the one carrying the diagnostics.
   */
  it('reports null, not zero, when the call never reached the provider', async () => {
    const { failures } = await failedRun('model_unavailable');
    const facts = failures.at(-1)!.facts;
    expect(facts.diag_inputTokens).toBeNull();
    expect(facts.diag_outputTokens).toBeNull();
    expect(facts.diag_reasoningTokens).toBeNull();
    expect(facts.diag_incompleteReason).toBeNull();
    expect(facts.diag_maxOutputTokens, 'the ceiling is a fact of the request, so it is known even here').toBe(4_000);
  });

  /**
   * A RETRYABLE FAILURE CARRIES ITS DIAGNOSTICS ON EVERY ATTEMPT IT SCHEDULES.
   *
   * Recorded because the retry path and the terminal path do not agree, and the
   * disagreement is worth pinning rather than discovering twice: each
   * `retry.scheduled` row carries the full diagnostic set, and the `task.failed`
   * row written when the run's own autonomy declines to retry again carries
   * none — `JuliusDispatchOutcome` returns the code and the class to the
   * pipeline but not the diagnostics, so the pipeline has nothing to write.
   *
   * It did not affect Paid Live Mission 4, whose architect failure was NOT
   * retryable and whose terminal row carried everything. Repairing it means
   * widening a core return type, which is its own change; this test holds the
   * half that works so a later repair can be measured against it.
   */
  it('carries the diagnostics on each scheduled retry', async () => {
    const { failures } = await failedRun('rate_limited');
    const scheduled = failures.filter((event) => event.type === 'retry.scheduled');
    expect(scheduled.length, 'a retryable class must schedule at least one retry').toBeGreaterThan(0);
    for (const event of scheduled) {
      expect(event.facts.diag_maxOutputTokens, 'every scheduled retry says what ceiling it ran under').toBe(4_000);
      expect(event.facts.diag_requestedModel).not.toBeUndefined();
    }
  });

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
  /**
   * A REVIEW SERVICE THAT ANSWERS ROUNDS, NOT A FIXED PAIR.
   *
   * One review is submit-then-poll. A shape the adapter corrects is asked
   * again, which is a second submit and a second poll — so a fake that
   * resolved exactly twice would answer the corrected ask with `undefined` and
   * every corrected shape would arrive as a launch failure. It answers the
   * same way every round, which is what a stubborn model does and the case
   * these tests are about.
   */
  const started = (state: unknown) => {
    let call = 0;
    return vi.fn(async () => {
      call += 1;
      return call % 2 === 1 ? jsonRes({ accepted: true, runId: 'run-live' }) : jsonRes(state);
    });
  };

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
    return adapter.dispatch({ taskId: 'build-1:review', contextId: 'ctx-resume-1', taskType: 'review:plan' })
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
    expect(failure.retryable, 'a model that wrote prose TWICE will write prose again').toBe(false);
    // AND IT WAS ASKED TWICE. Prose is a shape defect, so the adapter names it
    // and re-asks once; a model that answers with prose again is the final
    // failure this always was, and the record says two calls were bought.
    expect((failure as { diagnostics?: Record<string, unknown> }).diagnostics?.reviewAttempts).toBe(2);
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

  /**
   * PAID RUN 33802017460 — A REAL PLAN, A REAL DIFF, PASSING TESTS, AND BOTH
   * REVIEWS UNREADABLE.
   *
   * Julius never received a verdict and the run ended FAILED with zero
   * decisions. The malformed shapes are `retryable: false` for a good reason —
   * a plain retry asks the identical question and gets the identical answer —
   * but a CORRECTION is a different act. It names the shape defect from the
   * CLOSED shape token, never from the model's own (malformed) text, and asks
   * once more.
   */
  /** Answers a scripted review text per round, and records every prompt it was given. */
  const rounds = (...texts: readonly string[]) => {
    const prompts: string[] = [];
    let call = 0;
    const fetchImpl = vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
      call += 1;
      if (call % 2 === 1) {
        prompts.push(String((JSON.parse(String(init?.body ?? '{}')) as { prompt?: unknown }).prompt ?? ''));
        return jsonRes({ accepted: true, runId: 'run-live' });
      }
      const text = texts[Math.min(Math.ceil(call / 2) - 1, texts.length - 1)]!;
      return jsonRes({ runId: 'run-live', status: 'completed', reviewText: text });
    });
    return { prompts, fetchImpl };
  };

  const APPROVED = JSON.stringify({
    verdict: 'approved', summary: 'The plan satisfies every acceptance criterion.',
    findings: [], requirementsChecked: [{ requirement: 'AC-1', status: 'passed', evidence: 'read the plan' }],
  });

  /** Dispatches through the real adapter and returns the SUCCESSFUL result. */
  const resultFrom = async (fetchImpl: unknown) => {
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
        deps: { now: () => '2026-09-04T00:00:00.000Z', sleep: () => Promise.resolve(), fetchImpl: fetchImpl as typeof fetch },
      })) as never,
    });
    return adapter.dispatch({ taskId: 'build-1:review', contextId: 'ctx-resume-1', taskType: 'review:plan' });
  };

  it('prose first, a real verdict second: the run that died here now gets one', async () => {
    const { prompts, fetchImpl } = rounds('The plan looks fine to me.', APPROVED);
    const result = await resultFrom(fetchImpl);
    expect(result.status, 'the review succeeded on the corrected ask').toBe('SUCCEEDED');
    expect(prompts, 'exactly one correction was bought').toHaveLength(2);
  });

  it('the correction names the shape defect, and carries none of the unreadable answer', async () => {
    const unreadable = 'The plan looks fine to me. Ship it.';
    const { prompts, fetchImpl } = rounds(unreadable, APPROVED);
    await resultFrom(fetchImpl);

    const corrected = prompts[1]!;
    expect(prompts[0], 'the first ask carried no correction').not.toContain('CORRECTION —');
    expect(corrected, 'the second names what was wrong').toContain('contained no JSON report at all');
    expect(corrected, 'and it is the last thing read before the emit instruction')
      .toMatch(/CORRECTION —[\s\S]*Emit the JSON now\.$/u);
    // THE UNREADABLE TEXT NEVER TRAVELS BACK, and that is STRUCTURAL rather
    // than checked: `review_incomplete` carries a safe message, a closed shape
    // and diagnostics, and the review text is not among them — the adapter
    // could not quote it if it wanted to. This assertion is the second line,
    // for the day someone adds the raw text to that outcome.
    expect(corrected, 'never the answer itself').not.toContain(unreadable);
  });

  it('each correctable shape is told what it specifically got wrong', async () => {
    const cases: readonly (readonly [string, string, string])[] = [
      ['review_json_absent', 'The plan looks fine to me.', 'contained no JSON report at all'],
      ['review_json_ambiguous', `${APPROVED}\n${APPROVED}`, 'MORE THAN ONE object carrying a verdict'],
      ['review_verdict_missing', '{"summary":"ok","findings":[]}', 'contained JSON with no verdict'],
      ['review_verdict_invalid', '{"verdict":"approve","summary":"ok","findings":[],"requirementsChecked":[]}', 'outside the permitted set'],
    ];
    for (const [shape, text, expected] of cases) {
      const { prompts, fetchImpl } = rounds(text, APPROVED);
      const result = await resultFrom(fetchImpl);
      expect(prompts, `${shape} is re-asked once`).toHaveLength(2);
      expect(prompts[1], `${shape} is told what it got wrong`).toContain(expected);
      expect(result.status, `${shape} recovers`).toBe('SUCCEEDED');
    }
  });

  it('an exhausted mission buys no correction, and the refusal is the one it always was', async () => {
    // A CORRECTION IS A SPEND. The architect's allocation is a reservation
    // rather than a per-call cap, so a second call cannot exceed it — but
    // buying one for a mission with nothing left is the ceiling being ignored.
    const { prompts, fetchImpl } = rounds('The plan looks fine to me.', APPROVED);
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
        deps: { now: () => '2026-09-04T00:00:00.000Z', sleep: () => Promise.resolve(), fetchImpl: fetchImpl as typeof fetch },
      })) as never,
    });
    const failure = await adapter.dispatch({
      taskId: 'build-1:review', contextId: 'ctx-resume-1', taskType: 'review:plan',
      allocation: { usdMicros: 0, basis: 'EXHAUSTED', policyVersion: 'julius-allocation.v1' },
    })
      .then(() => { throw new Error('the dispatch was expected to fail'); })
      .catch((error: unknown) => error as { failureClass: string | null; diagnostics?: Record<string, unknown> });

    expect(prompts, 'asked once, and never again').toHaveLength(1);
    expect(failure.failureClass, 'and it fails exactly as it did before the re-ask existed').toBe('review_json_absent');
    expect(failure.diagnostics?.reviewAttempts).toBe(1);
  });

  it('a mission that still has budget does buy the correction', async () => {
    // The other side of the guard: a positive allocation changes nothing about
    // the behaviour proved above, so the refusal is the budget's and not a
    // silent disabling of the re-ask.
    const { prompts, fetchImpl } = rounds('The plan looks fine to me.', APPROVED);
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
        deps: { now: () => '2026-09-04T00:00:00.000Z', sleep: () => Promise.resolve(), fetchImpl: fetchImpl as typeof fetch },
      })) as never,
    });
    const result = await adapter.dispatch({
      taskId: 'build-1:review', contextId: 'ctx-resume-1', taskType: 'review:plan',
      allocation: { usdMicros: 300_000, basis: 'ESTIMATE', policyVersion: 'julius-allocation.v1' },
    });
    expect(prompts, 'the correction was bought').toHaveLength(2);
    expect(result.status).toBe('SUCCEEDED');
  });

  it('a failure that is NOT a shape defect is never re-asked', async () => {
    // A timeout, a 503 and a refused credential describe an answer that did not
    // arrive. Two of them are already retryable at the TASK level, where the
    // attempt ceiling and the spend budget govern; re-asking here would spend
    // inside a dispatch for a defect no instruction can fix.
    for (const [kind, body, status] of [
      ['timed out', { runId: 'run-live', status: 'timed_out', failureKind: 'timed_out' }, 200],
      ['capacity', { failureKind: 'capacity_exhausted' }, 503],
      ['dead credential', { failureKind: 'authentication_failed' }, 401],
    ] as const) {
      let calls = 0;
      const fetchImpl = vi.fn(async () => {
        calls += 1;
        return calls === 1 && status === 200 ? jsonRes({ accepted: true, runId: 'run-live' }) : jsonRes(body, status);
      });
      const failure = await resultFrom(fetchImpl)
        .then(() => { throw new Error('the dispatch was expected to fail'); })
        .catch((error: unknown) => error as { diagnostics?: Record<string, unknown> });
      expect(failure.diagnostics?.reviewAttempts, `${kind} is asked exactly once`).toBe(1);
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
    /* A SIGNALLED PROCESS DIES. The runner now waits for the child it killed
       to be gone before it reports, so a `kill` that returns true and leaves
       the process running models a reviewer this repository has never met —
       `hermes-reviewer-lifecycle.test.ts` owns the cases where one does — and
       makes every timeout case here wait out the escalation grace instead. */
    child.kill = () => { child.emit('close', null); return true; };
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
    return adapter.dispatch({ taskId: 'build-1:review', contextId: 'ctx-resume-1', taskType: 'review:build' })
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
    expect(failure.diagnostics?.stage, 'this review carried a diff').toBe('build');
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


/**
 * PAID ATTEMPT #3, REPLAYED PROVIDER-FREE.
 *
 * Run 33897565981 bought a real GPT-5.6 Sol plan that parsed and then failed
 * `validateArchitectPlan`. The durable record said `plan_validation_failed` and
 * could not say WHICH of fifteen rules refused it, so a fourth paid run was the
 * only way to find out. These drive the REAL architect adapter, the REAL JSON
 * parse and the REAL validator over a fake provider outcome, and read the
 * diagnostics the coordinator now persists.
 */
describe('a refused plan names the rule it broke', () => {
  const BASE = {
    objectiveSummary: 'Implement the mission fixture change.',
    assumptions: [{ id: 'A1', statement: 'The fixture exists.', confidence: 'medium' }],
    unresolvedQuestions: [],
    requirements: [{ id: 'R1', statement: 'It must pass.', rationale: 'The contract says so.' }],
    architectureDecisions: [{ id: 'D1', decision: 'Edit in place.', rationale: 'Smallest change.', alternativesConsidered: [], accepted: false }],
    implementationSteps: [{ order: 1, description: 'Edit the fixture.', filesTouched: ['fixtures/a.ts'] }],
    acceptanceCriteria: ['AC-1'], testPlan: ['npm run mission-test'],
    risks: [], prohibitedActions: [], proposedContractAmendments: [], contextRefs: [],
    handoff: {
      objective: 'Implement the fixture change.',
      boundedTask: 'Edit exactly the fixture files and make the test pass.',
      acceptanceCriteria: ['AC-1'], requiredTests: ['npm run mission-test'],
      allowedFileScope: ['fixtures/live-validation/'], prohibitedActions: [],
      grantedTools: [], expectedEvidence: ['TEST'],
      missionContractRef: 'contract-1', environmentRef: null,
    },
  };
  const withPlan = (change: (p: typeof BASE) => void) => {
    const plan = JSON.parse(JSON.stringify(BASE)) as typeof BASE;
    change(plan);
    return async (): Promise<GptRunOutcome> => ({
      ok: true, status: 'completed', outputText: JSON.stringify(plan),
      actualModel: 'gpt-5.6-sol-2026-08-01', responseId: 'resp_paid3',
      usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, reasoningTokens: 0, totalTokens: 2 },
    } as GptRunOutcome);
  };
  const planFailure = async (change: (p: typeof BASE) => void) => {
    const driven = await driveLiveMission(['approved'], undefined, withPlan(change));
    const failed = driven.memory.events().filter((event) => event.type === 'task.failed').at(-1)!;
    return { driven, facts: failed.facts as Record<string, unknown> };
  };

  it('a VALID plan still succeeds and stores its artifact, and the mission completes', async () => {
    const { memory, outcome } = await driveLiveMission(['approved'], undefined, withPlan(() => { /* unchanged */ }));
    expect(memory.taskRow('plan-1')?.state, 'the plan task succeeded').toBe('SUCCEEDED');
    expect(outcome.state, 'and the whole rig still reaches COMPLETED').toBe('COMPLETED');
    const decisions = await memory.decisionsForRun('run-live', 'prj-live');
    expect(decisions.every((decision) => decision.action === 'ACCEPT')).toBe(true);
  });

  it('every refusal names its rule, leaves the build blocked, and fabricates no evidence', async () => {
    const cases: readonly [string, (p: typeof BASE) => void][] = [
      ['objective_summary_empty', (p) => { p.objectiveSummary = ''; }],
      ['assumption_statement_empty', (p) => { p.assumptions[0]!.statement = ''; }],
      ['decision_statement_empty', (p) => { p.architectureDecisions[0]!.decision = ''; }],
      ['decision_rationale_empty', (p) => { p.architectureDecisions[0]!.rationale = ''; }],
      ['decision_pre_accepted', (p) => { (p.architectureDecisions[0] as { accepted: boolean }).accepted = true; }],
      ['handoff_objective_empty', (p) => { p.handoff.objective = ''; }],
      ['handoff_bounded_task_empty', (p) => { p.handoff.boundedTask = ''; }],
      ['handoff_allowed_scope_empty', (p) => { p.handoff.allowedFileScope = []; }],
      ['plan_false_work_claim', (p) => { p.objectiveSummary = 'Done — files were edited already.'; }],
      ['required_string_array_invalid', (p) => { (p as { testPlan: unknown }).testPlan = [1]; }],
    ];
    for (const [expected, change] of cases) {
      const { driven, facts } = await planFailure(change);
      expect(facts.failureClass, expected).toBe('plan_validation_failed');
      // THE FACT PAID ATTEMPT #3 DID NOT HAVE — read through the REAL pipeline
      // ledger, which flattens facts to scalars. Asserting a nested object here
      // is what proved the first version of this telemetry never survived.
      expect(facts.diag_validationReasonCode, `${expected}: the rule must be named`).toBe(expected);
      expect(facts.diag_stage).toBe('plan');
      expect(facts.diag_jsonParseable, 'it parsed; it did not validate').toBe(true);
      expect(facts.diag_validationPassed).toBe(false);
      expect(facts.diag_servedModel, 'the model the provider said answered').toBe('gpt-5.6-sol-2026-08-01');
      expect(facts.diag_outputBytesObserved as number).toBeGreaterThan(0);
      expect(JSON.stringify(facts), 'no fact may be a stringified object').not.toContain('[object Object]');
      // The mission stops, and nothing downstream is invented.
      expect(driven.memory.taskRow('plan-1')?.state, expected).toBe('FAILED');
      expect(driven.memory.taskRow('build-1')?.state, 'the build never runs on a refused plan').not.toBe('SUCCEEDED');
      expect(await driven.memory.decisionsForRun('run-live', 'prj-live'), 'no verification decision').toHaveLength(0);
    }
  });

  it('a plan that did not even parse is a different repair, and says so', async () => {
    const driven = await driveLiveMission(['approved'], undefined,
      async () => ({ ok: true, status: 'completed', outputText: 'not json at all',
        actualModel: 'gpt-5.6-sol', responseId: 'resp_x',
        usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, reasoningTokens: 0, totalTokens: 2 } } as GptRunOutcome));
    const facts = driven.memory.events().filter((event) => event.type === 'task.failed').at(-1)!.facts as Record<string, unknown>;
    expect(facts.failureClass).toBe('unparseable_plan_json');
    expect(facts.diag_jsonParseable).toBe(false);
    // No validation happened, so no rule is named — null, not a guess.
    expect(facts.diag_validationReasonCode).toBeNull();
  });

  it('the plan itself never reaches the durable record', async () => {
    const SECRET = 'sk-live-FAKESECRET123456789';
    const { facts } = await planFailure((p) => {
      p.objectiveSummary = '';
      p.handoff.boundedTask = `Rotate ${SECRET} and Authorization: Bearer FAKESECRET123456789`;
    });
    const durable = JSON.stringify(facts);
    for (const secret of [SECRET, 'FAKESECRET123456789', 'Authorization', 'Rotate']) {
      expect(durable, `"${secret}" must not reach the durable record`).not.toContain(secret);
    }
    expect(facts.diag_validationReasonCode).toBe('objective_summary_empty');
  });
});

/**
 * A REFUSED PLAN IS A SELF-INFLICTED ERROR, AND JULIUS REPAIRS THOSE.
 *
 * Paid runs 34185920678 and 34186711214 each bought one `gpt-5.6-sol` answer,
 * had it refused for a single field, and ended FAILED — no coder, no diff, no
 * review, no repair. Everywhere else in the run a recoverable failure gets one
 * bounded attempt at recovery; the architect's own validator was the exception,
 * and the mission paid for it twice.
 *
 * The correction is built from the CLOSED reason code and the STRUCTURAL path,
 * never from the model's own output, and it happens exactly once.
 */
describe('a refused plan is corrected once, and the record says it was', () => {
  const VALID_PLAN = () => ({
    objectiveSummary: 'Implement the mission fixture change.',
    assumptions: [{ id: 'A1', statement: 'The fixture exists.', confidence: 'medium' }],
    unresolvedQuestions: [],
    requirements: [{ id: 'R1', statement: 'It must pass.', rationale: 'The contract says so.' }],
    architectureDecisions: [{ id: 'D1', decision: 'Edit in place.', rationale: 'Smallest change.', alternativesConsidered: [], accepted: false }],
    implementationSteps: [{ order: 1, description: 'Edit the fixture.', filesTouched: ['fixtures/a.ts'] }],
    acceptanceCriteria: ['AC-1'], testPlan: ['npm run mission-test'],
    risks: [], prohibitedActions: [], proposedContractAmendments: [], contextRefs: [],
    handoff: {
      objective: 'Implement the fixture change.',
      boundedTask: 'Edit exactly the fixture files and make the test pass.',
      acceptanceCriteria: ['AC-1'], requiredTests: ['npm run mission-test'],
      allowedFileScope: ['fixtures/live-validation/'], prohibitedActions: [],
      grantedTools: [], expectedEvidence: ['TEST'],
      missionContractRef: 'contract-1', environmentRef: null,
    },
  });

  /** An architect that answers a scripted sequence and records what it was told. */
  const scripted = (...bodies: readonly unknown[]) => {
    const instructions: string[] = [];
    const architect = async (request: { instructions: string }): Promise<GptRunOutcome> => {
      instructions.push(request.instructions);
      const body = bodies[Math.min(instructions.length - 1, bodies.length - 1)];
      return {
        ok: true, status: 'completed',
        outputText: typeof body === 'string' ? body : JSON.stringify(body),
        actualModel: 'gpt-5.6-sol-2026-08-01', responseId: `resp_attempt_${instructions.length}`,
        usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, reasoningTokens: 0, totalTokens: 2 },
      } as GptRunOutcome;
    };
    return { instructions, architect: architect as unknown as () => Promise<GptRunOutcome> };
  };

  const claiming = () => {
    const plan = VALID_PLAN();
    plan.objectiveSummary = 'Done — files were edited already.';
    return plan;
  };

  it('the mission that died twice for one field now reaches COMPLETED', async () => {
    const { instructions, architect } = scripted(claiming(), VALID_PLAN());
    const { memory, outcome } = await driveLiveMission(['approved'], undefined, architect);

    expect(instructions, 'exactly one correction was bought').toHaveLength(2);
    expect(memory.taskRow('plan-1')?.state, 'the plan task succeeded on the correction').toBe('SUCCEEDED');
    expect(outcome.state, 'and the whole mission reaches COMPLETED').toBe('COMPLETED');
    expect(memory.taskRow('build-1')?.state, 'the coder actually ran').toBe('SUCCEEDED');
    const decisions = await memory.decisionsForRun('run-live', 'prj-live');
    expect(decisions.length, 'completion is still verification-decided').toBeGreaterThan(0);
  });

  it('the correction names the rule and the field, and carries no model text', async () => {
    const { instructions, architect } = scripted(claiming(), VALID_PLAN());
    await driveLiveMission(['approved'], undefined, architect);
    const corrected = instructions[1]!;

    expect(corrected, 'the first attempt was NOT corrected').not.toBe(instructions[0]);
    expect(corrected.startsWith(instructions[0]!), 'the charter is kept, the correction appended').toBe(true);
    expect(corrected, 'it names where').toContain('plan.objectiveSummary');
    expect(corrected, 'and what the rule is about').toContain('FUTURE tense');
    // THE MODEL'S OWN WORDS NEVER TRAVEL BACK. Feeding a refused plan to the
    // model invites it to repeat it — the lesson the charter itself learned,
    // having once quoted the four banned phrases verbatim.
    expect(corrected, 'never the refused sentence').not.toContain('Done — files were edited already.');
    expect(corrected.toLowerCase(), 'nor the phrase it tripped on').not.toContain('files were edited');
  });

  it('a plan refused TWICE fails as it always did, after exactly two calls', async () => {
    const { instructions, architect } = scripted(claiming(), claiming(), VALID_PLAN());
    const { memory, outcome } = await driveLiveMission(['approved'], undefined, architect);

    expect(instructions, 'one correction, never two').toHaveLength(2);
    expect(memory.taskRow('plan-1')?.state).toBe('FAILED');
    expect(memory.taskRow('build-1')?.state, 'the build never runs on a refused plan').not.toBe('SUCCEEDED');
    expect(outcome.state, 'and a third answer is never bought, whatever it would have been').not.toBe('COMPLETED');

    const facts = memory.events().filter((event) => event.type === 'task.failed').at(-1)!.facts as Record<string, unknown>;
    expect(facts.diag_validationReasonCode).toBe('plan_false_work_claim');
    expect(facts.diag_validationField, 'the path, published').toBe('plan.objectiveSummary');
    expect(facts.diag_validationClaimPhrase, 'and which phrase').toBe('files_were_edited');
    // THE SPEND IS ACCOUNTABLE. A retry the artifact could not show would be a
    // provider call nobody could account for.
    expect(facts.diag_planAttempts, 'the record says how many calls were bought').toBe(2);
    expect(facts.diag_responseId, 'and it is the LAST response, not the first').toBe('resp_attempt_2');
  });

  it('an unparseable answer gets the same one correction, and says so', async () => {
    const { instructions, architect } = scripted('not json at all', VALID_PLAN());
    const { memory, outcome } = await driveLiveMission(['approved'], undefined, architect);
    expect(instructions).toHaveLength(2);
    expect(instructions[1], 'told what was wrong, in our words').toContain('parseable JSON');
    expect(memory.taskRow('plan-1')?.state).toBe('SUCCEEDED');
    expect(outcome.state).toBe('COMPLETED');
  });

  it('a plan valid the first time buys nothing extra', async () => {
    const { instructions, architect } = scripted(VALID_PLAN());
    const { memory, outcome } = await driveLiveMission(['approved'], undefined, architect);
    expect(instructions, 'one call, as before').toHaveLength(1);
    expect(memory.taskRow('plan-1')?.state).toBe('SUCCEEDED');
    expect(outcome.state).toBe('COMPLETED');
    expect(memory.taskRow('build-1')?.state, 'and the coder still ran behind it').toBe('SUCCEEDED');
    expect(memory.events().some((event) => event.type === 'task.failed'), 'nothing failed on the way').toBe(false);
  });

  it('every rule the validator can name is correctable, so none of them is silently terminal', async () => {
    // A reason code with no correction would fall through to the old terminal
    // behaviour without anything saying so. Each is driven through the real
    // pipeline and must buy exactly two calls.
    const cases: readonly (readonly [string, (p: ReturnType<typeof VALID_PLAN>) => void])[] = [
      ['objective_summary_empty', (p) => { p.objectiveSummary = ''; }],
      ['assumption_statement_empty', (p) => { p.assumptions[0]!.statement = ''; }],
      ['decision_statement_empty', (p) => { p.architectureDecisions[0]!.decision = ''; }],
      ['decision_rationale_empty', (p) => { p.architectureDecisions[0]!.rationale = ''; }],
      ['decision_pre_accepted', (p) => { (p.architectureDecisions[0] as unknown as { accepted: boolean }).accepted = true; }],
      ['handoff_objective_empty', (p) => { p.handoff.objective = ''; }],
      ['handoff_bounded_task_empty', (p) => { p.handoff.boundedTask = ''; }],
      ['handoff_allowed_scope_empty', (p) => { p.handoff.allowedFileScope = []; }],
      ['plan_false_work_claim', (p) => { p.objectiveSummary = 'Done — files were edited already.'; }],
      ['required_string_array_invalid', (p) => { (p as unknown as { testPlan: unknown }).testPlan = [1]; }],
      ['handoff_array_invalid', (p) => { (p.handoff as unknown as { requiredTests: unknown }).requiredTests = 7; }],
      ['handoff_missing', (p) => { (p as unknown as { handoff: unknown }).handoff = null; }],
      ['plan_object_invalid', () => { /* replaced wholesale below */ }],
    ];
    for (const [expected, change] of cases) {
      const broken = expected === 'plan_object_invalid' ? 'null' : (() => {
        const plan = VALID_PLAN();
        change(plan);
        return plan;
      })();
      const { instructions, architect } = scripted(broken, VALID_PLAN());
      const { memory } = await driveLiveMission(['approved'], undefined, architect);
      expect(instructions, `${expected} must be correctable`).toHaveLength(2);
      expect(memory.taskRow('plan-1')?.state, `${expected} recovers on the correction`).toBe('SUCCEEDED');
    }
  }, 30_000);
});


/**
 * WHICH REVIEW A FAILURE WAS, INCLUDING THE ONES A REPAIR CREATES.
 *
 * The first derivation read the stage from whether a diff artifact existed, and
 * the build ran BEFORE the plan review — so every plan review was recorded as a
 * build review. The second parsed the task id. The stage is now the task TYPE
 * Julius dispatches with, read by the domain's own `reviewStageOf`, and a
 * dispatch that carries none is refused rather than guessed (see the adapter
 * cases below).
 */
describe('the review stage is read from the dispatched task type', () => {
  it('names every stage, and only from a review type', () => {
    expect(reviewStageOf('review:plan')).toBe('plan');
    expect(reviewStageOf('review:build')).toBe('build');
    expect(reviewStageOf('review:repair:plan')).toBe('repair:plan');
    expect(reviewStageOf('review:repair:build')).toBe('repair:build');
    expect(reviewStageOf('plan-1:review'), 'a task id is not a type').toBeNull();
    expect(reviewStageOf('run:526ca97da0e94b6223a5320a:plan:review')).toBeNull();
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
/**
 * PAID ATTEMPT #4, REPLAYED THROUGH THE REAL LEDGER.
 *
 * Run 33907599197 reached the reviewer and recorded
 * `review_authentication_failed` with no number — one shape covering a dead key
 * (401), a key without model access (403) and a malformed request whose body
 * merely says `api-key` (400). These drive the REAL local runner over a fake
 * process into the REAL adapter and read the facts the REAL pipeline ledger
 * persisted, because a status that only exists on an adapter-local object is
 * not a status the artifact can show.
 */
describe('the reviewer HTTP status reaches the durable record', () => {
  const upstreamRun = async (stdout: string) => {
    const driven = await driveLiveMission(['approved'], undefined, undefined, [stdout]);
    const failed = driven.memory.events().filter((event) => event.type === 'task.failed');
    return failed.find((event) => event.taskId === 'plan-1:review')!.facts as Record<string, unknown>;
  };

  it('a dead credential is durably a 401', async () => {
    const facts = await upstreamRun('HTTP 401: {"error":"invalid api-key"}');
    expect(facts.failureClass).toBe('review_authentication_failed');
    expect(facts.julius_code ?? facts.code).toBe('AUTH_CONFIGURATION');
    // THE NUMBER PAID ATTEMPT #4 DID NOT HAVE.
    expect(facts.diag_providerHttpStatus).toBe(401);
    expect(facts.diag_stage).toBe('plan');
    expect(facts.diag_transport).toBe('local');
  });

  it('a key without model access is durably a 403, and not confused with a dead one', async () => {
    const facts = await upstreamRun('HTTP 403: {"error":"model not permitted"}');
    expect(facts.failureClass, 'same shape').toBe('review_authentication_failed');
    expect(facts.diag_providerHttpStatus, 'different repair').toBe(403);
  });

  it('an upstream error keeps its own shape and its own number', async () => {
    const facts = await upstreamRun('HTTP 500: {"error":"boom"}');
    expect(facts.failureClass).toBe('review_provider_http_error');
    expect(facts.diag_providerHttpStatus).toBe(500);
  });

  it('a review that simply could not be read carries no status at all', async () => {
    const facts = await upstreamRun('The plan looks fine to me overall.');
    expect(facts.failureClass).toBe('review_json_absent');
    // null, never 0 — nobody read a status here.
    expect(facts.diag_providerHttpStatus).toBeNull();
  });

  it('and the provider body never reaches the ledger, only the integer', async () => {
    const facts = await upstreamRun(
      'HTTP 401: {"error":"invalid api-key sk-live-FAKESECRET123456789","header":"Authorization: Bearer FAKESECRET123456789"}',
    );
    expect(facts.diag_providerHttpStatus).toBe(401);
    const durable = JSON.stringify(facts);
    for (const secret of ['FAKESECRET123456789', 'sk-live', 'Authorization', 'Bearer', 'invalid api-key']) {
      expect(durable, `"${secret}" must not reach the durable record`).not.toContain(secret);
    }
    expect(durable, 'and nothing is a stringified object').not.toContain('[object Object]');
  });
});

/* ------------------------------------------------------------------------ *
 * PAID RUN 34037313976 — THE ADAPTERS' SHARE OF THE FOUR DEFECTS
 * ------------------------------------------------------------------------ */

const LIVE_REVIEWER_WORKER = {
  workerId: 'independent-reviewer-hermes', role: 'INDEPENDENT_REVIEWER' as const,
  adapterId: 'hermes-local-live', providerId: 'xai', capabilities: ['review'],
  taskTypes: ['review:plan', 'review:build', 'review:repair:plan', 'review:repair:build'],
  concurrencyLimit: 1, timeoutMs: 1_000, maxRetries: 1, status: 'AVAILABLE' as const,
};

/** A snapshot with the FINDING entries Julius compiles for a repair re-review. */
function repairReviewSnapshot(taskId: string): JuliusContextSnapshot {
  const snapshot = reviewSnapshot(taskId);
  return {
    ...snapshot, findingIds: ['f-1'],
    packet: { ...snapshot.packet, blocks: [...snapshot.packet.blocks, { kind: 'FINDING', text: 'REVIEW FINDING f-1 [HIGH]: no verification strategy' }] },
  };
}

function reviewerAdapterFor(input: { taskId: string; artifacts: ReturnType<typeof createLiveArtifactExchange>; packets: ReviewPacket[]; log: FakeLog; snapshot?: JuliusContextSnapshot }) {
  return createLiveHermesReviewerAdapter({
    worker: LIVE_REVIEWER_WORKER,
    contexts: { snapshotFor: () => input.snapshot ?? reviewSnapshot(input.taskId) },
    artifacts: input.artifacts,
    config: loadHermesConfig(LIVE_ENV as never),
    testCommand: 'npm run mission-test',
    run: fakeReviewer(input.log, input.packets, ['changes_required']) as never,
  });
}

describe('DEFECT 2 — the live reviewer adapter reviews the stage it was dispatched for', () => {
  it('a PLAN review sees the plan and no diff or test output, even when a diff artifact exists', async () => {
    const artifacts = createLiveArtifactExchange();
    artifacts.put(planRef('run-live'), JSON.stringify(VALID_PLAN));
    artifacts.put(diffRef('run-live'), DIFF_TEXT);
    const packets: ReviewPacket[] = [];
    const adapter = reviewerAdapterFor({ taskId: 'plan-1:review', artifacts, packets, log: { order: [] } });
    const result = await adapter.dispatch({ taskId: 'plan-1:review', contextId: 'ctx-resume-1', taskType: 'review:plan' });
    expect(packets).toHaveLength(1);
    const packet = packets[0]!;
    expect(packet.stage).toBe('plan');
    expect(packet.charge?.subject).toBe('PLAN');
    expect(packet.charge?.mustNotDemand).toContain('a unified diff');
    expect(packet.handoffJson).toBe(JSON.stringify(VALID_PLAN));
    expect(packet.unifiedDiff, 'no implementation is shown to a plan review').toBe('');
    expect(packet.changedFiles).toEqual([]);
    expect(packet.testOutput).toBe('');
    // A rejecting verdict is EVIDENCE, nothing else: the adapter holds no store
    // and returns findings for Julius to record and decide on.
    expect(result.status).toBe('SUCCEEDED');
    expect(result.evidence.every((item) => (item as { type: string }).type === 'REVIEW_FINDING')).toBe(true);
    // `diagnostics` is the reviewer's own lifecycle, narrowed by the domain
    // allowlist before it reaches any durable row. It is listed here because
    // this assertion is a LEAK check — a new key on this result is exactly what
    // it exists to catch — and because the plan review's record must carry no
    // more than the build review's does.
    expect(Object.keys(result).sort()).toEqual(['diagnostics', 'evidence', 'providerId', 'safeSummary', 'status', 'usage', 'workerId']);
    expect(JSON.stringify(result.diagnostics), 'and it quotes no part of the plan it read')
      .not.toContain(VALID_PLAN.objectiveSummary);
  });

  /**
   * THE GAP LIVE RUN 3 EXPOSED. Both of its reviews were APPROVED and its
   * `worker-diagnostics.tsv` came back with zero rows — the adapter returned
   * `usage: { toolCalls: 0 }` and nothing else on the succeeding path, so the
   * served model survived only because a prose evidence summary happened to
   * name it, and the elapsed time of a healthy review survived nowhere.
   */
  it('a review that SUCCEEDED carries the same lifecycle a failed one does', async () => {
    const artifacts = createLiveArtifactExchange();
    artifacts.put(planRef('run-live'), JSON.stringify(VALID_PLAN));
    const packets: ReviewPacket[] = [];
    const adapter = reviewerAdapterFor({ taskId: 'plan-1:review', artifacts, packets, log: { order: [] } });
    const result = await adapter.dispatch({ taskId: 'plan-1:review', contextId: 'ctx-resume-1', taskType: 'review:plan' });
    expect(result.status).toBe('SUCCEEDED');
    const diagnostics = result.diagnostics as Record<string, unknown>;

    // The evidence dump keys on transport, so this is the field that decides
    // whether the attempt gets a row at all.
    expect(diagnostics.transport).toBe('local');
    expect(diagnostics.outcome, 'stated, never inferred from a null failure shape').toBe('succeeded');
    expect(diagnostics.failureShape, 'and there is no failure to shape').toBeNull();
    // Which review this was, and how many provider calls the dispatch bought —
    // both known to the dispatch and to neither transport.
    expect(diagnostics.stage).toBe('plan');
    expect(diagnostics.reviewAttempts).toBe(1);
    // The model that answered, on a row rather than inside a sentence.
    expect(diagnostics.servedModel).toBe('grok-build-0.1');
    expect(diagnostics.requestedModel).toBe('grok-build-0.1');
    // The pair that answers "was the window big enough?" for free.
    expect(diagnostics.elapsedMs).toBe(1_234);
    expect(diagnostics.timeoutMs).toBe(400_000);
    expect(typeof diagnostics.startedAt).toBe('string');
    expect(typeof diagnostics.completedAt).toBe('string');
    // Nothing was billed to Relay here and no harness estimate was reported, so
    // the basis is UNKNOWN — which is not zero, and is why the reservation is
    // held rather than settled.
    expect(diagnostics.costBasis).toBe('UNKNOWN');
    expect(diagnostics.estimatedCostUsdMicros).toBeNull();
    expect((result.usage as { costBasis: string }).costBasis).toBe('UNKNOWN');
  });

  /**
   * ELAPSED TIME IS DERIVED ONLY WHERE NOBODY MEASURED IT — the remote and
   * provider transports run no process and time nothing — and it is derived
   * from two instants that are both on the same row, so the arithmetic can be
   * checked rather than trusted.
   */
  it('derives an elapsed time only when the transport measured none', async () => {
    const artifacts = createLiveArtifactExchange();
    artifacts.put(planRef('run-live'), JSON.stringify(VALID_PLAN));
    const unmeasured = createLiveHermesReviewerAdapter({
      worker: LIVE_REVIEWER_WORKER,
      contexts: { snapshotFor: () => reviewSnapshot('plan-1:review') },
      artifacts,
      config: loadHermesConfig(LIVE_ENV as never),
      testCommand: 'npm run mission-test',
      run: (async () => ({
        kind: 'reviewed',
        result: { verdict: 'approved', summary: 'No blocking findings.', findings: [], requirementsChecked: [], parseRepaired: false },
        startedAt: '2026-09-09T23:03:10.000Z', completedAt: '2026-09-09T23:06:36.500Z',
        requestedModel: 'grok-build-0.1', servedModel: 'grok-build-0.1', provider: 'xai',
        diagnostics: reviewDiagnostics({ transport: 'remote', shape: null, outcome: 'succeeded' }),
        usage: UNKNOWN_USAGE,
      })) as never,
    });
    const result = await unmeasured.dispatch({ taskId: 'plan-1:review', contextId: 'ctx-resume-1', taskType: 'review:plan' });
    const diagnostics = result.diagnostics as Record<string, unknown>;
    expect(diagnostics.elapsedMs, 'the difference between the two instants beside it').toBe(206_500);
    expect(diagnostics.startedAt).toBe('2026-09-09T23:03:10.000Z');
    expect(diagnostics.completedAt).toBe('2026-09-09T23:06:36.500Z');
  });

  it('a BUILD review is refused when no implementation exists to judge, and an EMPTY diff is no implementation', async () => {
    const artifacts = createLiveArtifactExchange();
    artifacts.put(planRef('run-live'), JSON.stringify(VALID_PLAN));
    const log: FakeLog = { order: [] };
    const adapter = reviewerAdapterFor({ taskId: 'build-1:review', artifacts, packets: [], log });
    await expect(adapter.dispatch({ taskId: 'build-1:review', contextId: 'ctx-resume-1', taskType: 'review:build' }))
      .rejects.toMatchObject({ code: 'INVALID_REQUEST', failureClass: 'reviewer_implementation_absent' });
    // The exchange stores whatever `git diff` printed, so a coder that edited
    // nothing leaves an empty string — which is not an implementation either.
    artifacts.put(diffRef('run-live'), '');
    await expect(adapter.dispatch({ taskId: 'build-1:review', contextId: 'ctx-resume-1', taskType: 'review:build' }))
      .rejects.toMatchObject({ code: 'INVALID_REQUEST', failureClass: 'reviewer_implementation_absent' });
    expect(log.order).toEqual([]);
  });

  it('the findings are the findings, not the founder\'s request: they are not repeated into the request block', async () => {
    const artifacts = createLiveArtifactExchange();
    artifacts.put(planRef('run-live'), JSON.stringify(VALID_PLAN));
    artifacts.put(diffRef('run-live'), DIFF_TEXT);
    const packets: ReviewPacket[] = [];
    const adapter = reviewerAdapterFor({
      taskId: 'repair:build-1:1:task:review', artifacts, packets, log: { order: [] },
      snapshot: repairReviewSnapshot('repair:build-1:1:task:review'),
    });
    await adapter.dispatch({ taskId: 'repair:build-1:1:task:review', contextId: 'ctx-resume-1', taskType: 'review:repair:build' });
    expect(packets[0]!.priorFindings).toEqual(['REVIEW FINDING f-1 [HIGH]: no verification strategy']);
    expect(packets[0]!.originalRequest, 'the request is the mission, not the verdict on it')
      .not.toContain('REVIEW FINDING');
    expect(packets[0]!.originalRequest).toContain('OBJECTIVE: resume test');
  });

  it('a BUILD review carries the diff and the implementation charge', async () => {
    const artifacts = createLiveArtifactExchange();
    artifacts.put(planRef('run-live'), JSON.stringify(VALID_PLAN));
    artifacts.put(diffRef('run-live'), DIFF_TEXT);
    const packets: ReviewPacket[] = [];
    const adapter = reviewerAdapterFor({ taskId: 'build-1:review', artifacts, packets, log: { order: [] } });
    await adapter.dispatch({ taskId: 'build-1:review', contextId: 'ctx-resume-1', taskType: 'review:build' });
    expect(packets[0]!.stage).toBe('build');
    expect(packets[0]!.charge?.subject).toBe('IMPLEMENTATION');
    expect(packets[0]!.unifiedDiff).toBe(DIFF_TEXT);
  });

  it('a REPAIR review carries the prior findings, and proceeds without them when the round was admitted by failed evidence', async () => {
    const artifacts = createLiveArtifactExchange();
    artifacts.put(planRef('run-live'), JSON.stringify(VALID_PLAN));
    artifacts.put(diffRef('run-live'), DIFF_TEXT);
    const log: FakeLog = { order: [] };
    /**
     * NOT A REFUSAL. Julius admits a repair round on the subject's own FAILED
     * evidence as well as on a reviewer finding, and such a round has no
     * findings by construction — an earlier version of this adapter refused
     * there, which would have failed a run that was repairing exactly as
     * designed.
     */
    const bare: ReviewPacket[] = [];
    const evidenceAdmitted = reviewerAdapterFor({ taskId: 'repair:build-1:1:task:review', artifacts, packets: bare, log });
    const outcome = await evidenceAdmitted.dispatch({ taskId: 'repair:build-1:1:task:review', contextId: 'ctx-resume-1', taskType: 'review:repair:build' });
    expect(outcome.status).toBe('SUCCEEDED');
    expect(bare[0]!.stage).toBe('repair:build');
    expect(bare[0]!.priorFindings).toEqual([]);
    const packets: ReviewPacket[] = [];
    const informed = reviewerAdapterFor({
      taskId: 'repair:build-1:1:task:review', artifacts, packets, log, snapshot: repairReviewSnapshot('repair:build-1:1:task:review'),
    });
    await informed.dispatch({ taskId: 'repair:build-1:1:task:review', contextId: 'ctx-resume-1', taskType: 'review:repair:build' });
    expect(packets[0]!.stage).toBe('repair:build');
    expect(packets[0]!.priorFindings).toEqual(['REVIEW FINDING f-1 [HIGH]: no verification strategy']);
    expect(packets[0]!.charge?.repair).toBe(true);
  });

  it('swapping the reviewer runner does not change what the stage means', async () => {
    // Two different reviewer implementations receive the identical packet for
    // the identical dispatch: the stage and charge are Julius's, not theirs.
    const artifacts = createLiveArtifactExchange();
    artifacts.put(planRef('run-live'), JSON.stringify(VALID_PLAN));
    const seen: ReviewPacket[] = [];
    for (const runner of [fakeReviewer({ order: [] }, seen, ['approved']), textReviewer({ order: [] }, seen, [JSON.stringify({ verdict: 'approved', summary: 'ok', findings: [], requirementsChecked: [] })])]) {
      const adapter = createLiveHermesReviewerAdapter({
        worker: LIVE_REVIEWER_WORKER, contexts: { snapshotFor: () => reviewSnapshot('plan-1:review') },
        artifacts, config: loadHermesConfig(LIVE_ENV as never), testCommand: 'npm run mission-test', run: runner as never,
      });
      await adapter.dispatch({ taskId: 'plan-1:review', contextId: 'ctx-resume-1', taskType: 'review:plan' });
    }
    expect(seen).toHaveLength(2);
    expect(seen[0]!.stage).toBe(seen[1]!.stage);
    expect(seen[0]!.charge).toEqual(seen[1]!.charge);
    expect(seen[0]!.unifiedDiff).toBe(seen[1]!.unifiedDiff);
  });
});

describe('DEFECT 1 — the live coder adapter is limited to what Julius allocated', () => {
  const coderAdapter = (input: { runs: HostedRunInput[]; cost?: number; refuse?: boolean }) => {
    const log: FakeLog = { order: [] };
    const artifacts = createLiveArtifactExchange();
    artifacts.put(planRef('run-live'), JSON.stringify(VALID_PLAN));
    const run = async (runInput: HostedRunInput): Promise<HostedRunOutcome> => {
      input.runs.push(runInput);
      const completed = await fakeCoder(log, [])(runInput) as Extract<HostedRunOutcome, { kind: 'completed' }>;
      const observation = { ...completed.observation, usage: { ...completed.observation.usage, totalCostUsd: input.cost ?? 0.02 } };
      if (input.refuse) {
        return { kind: 'refused', refusalCode: 'coder_cost_exceeded', safeMessage: 'over', observation, envelope: completed.envelope, startedAt: completed.startedAt, completedAt: completed.completedAt } as HostedRunOutcome;
      }
      return { ...completed, observation };
    };
    return createLiveHostedCodingAdapter({
      worker: {
        workerId: 'coding-agent-claude-hosted', role: 'CODING_AGENT', adapterId: 'claude-agent-sdk-hosted-live', providerId: 'anthropic',
        capabilities: ['implement'], taskTypes: ['build'], concurrencyLimit: 1, timeoutMs: 1_000, maxRetries: 1, status: 'AVAILABLE',
      },
      contexts: { snapshotFor: () => reviewSnapshot('build-1') }, artifacts, projectId: 'prj-live',
      apiKey: 'FAKETESTNOTREAL-anthropic', requestedModel: 'claude-fable-5',
      workspacePath: '/workspace/mission', testCommand: 'npm run mission-test',
      shell: fakeShell(log, []), run: run as never, queryLoader: async () => fakeQuery,
    });
  };

  it('with an allocation, the hosted limits ARE the allocation; without one, the conservative default', async () => {
    const runs: HostedRunInput[] = [];
    const adapter = coderAdapter({ runs, cost: 0.9 });
    const granted = await adapter.dispatch({ taskId: 'build-1', contextId: 'ctx-resume-1', taskType: 'build', allocation: { usdMicros: 5_000_000, policyVersion: 'julius-allocation.v1', basis: 'CODER_SHARE' } });
    expect((runs[0]!.limits as HostedLimits).maxCostCents).toBe(500);
    expect((runs[0]!.limits as HostedLimits).maxTurns).toBe(DEFAULT_HOSTED_LIMITS.maxTurns);
    expect(granted.status).toBe('SUCCEEDED');
    expect((granted.usage as { usdMicros: number }).usdMicros).toBe(900_000);
    await adapter.dispatch({ taskId: 'build-1', contextId: 'ctx-resume-1', taskType: 'build' });
    expect(runs[1]!.limits).toBe(DEFAULT_HOSTED_LIMITS);
  });

  it('an allocation below one cent is refused BEFORE the runtime is reached, because a $0 ceiling still bills a turn', async () => {
    const runs: HostedRunInput[] = [];
    const adapter = coderAdapter({ runs });
    await expect(adapter.dispatch({ taskId: 'build-1', contextId: 'ctx-resume-1', taskType: 'build', allocation: { usdMicros: 6_000, policyVersion: 'julius-allocation.v1', basis: 'CODER_REMAINDER' } }))
      .rejects.toMatchObject({ code: 'WORKER_EXECUTION_FAILURE', failureClass: 'coder_allocation_below_one_cent' });
    expect(runs, 'no hosted run was started').toEqual([]);
  });

  it('names the round that spent the money: a repair refusal is not recorded as the first build', async () => {
    const runs: HostedRunInput[] = [];
    const adapter = coderAdapter({ runs, cost: 5.25, refuse: true });
    await expect(adapter.dispatch({ taskId: 'repair:build-1:1:task', contextId: 'ctx-resume-1', taskType: 'repair:build', allocation: { usdMicros: 5_000_000, policyVersion: 'julius-allocation.v1', basis: 'CODER_SHARE' } }))
      .rejects.toMatchObject({ diagnostics: expect.objectContaining({ stage: 'repair:build' }) });
  });

  it('a cost refusal carries the money beside it: observed, ceiling and source', async () => {
    const runs: HostedRunInput[] = [];
    const adapter = coderAdapter({ runs, cost: 5.25, refuse: true });
    await expect(adapter.dispatch({ taskId: 'build-1', contextId: 'ctx-resume-1', taskType: 'build', allocation: { usdMicros: 5_000_000, policyVersion: 'julius-allocation.v1', basis: 'CODER_SHARE' } }))
      .rejects.toMatchObject({
        code: 'WORKER_EXECUTION_FAILURE', failureClass: 'coder_cost_exceeded',
        diagnostics: expect.objectContaining({ costUsdMicros: 5_250_000, costCeilingUsdMicros: 5_000_000, costSource: 'runtime_reported', stage: 'build' }),
      });
  });
});

/**
 * WHY THE BUILD FAILED HAS TO REACH THE ROW, AND THE PROVIDER'S WORDS MUST NOT.
 *
 * Paid Mission 5's rerun (run 34504244415) got the plan accepted after three
 * reviewed repair rounds, locked the contract at revision 5, dispatched the
 * coder — and the coder stopped after six of its twenty-six turns having
 * changed nothing, for $0.885661. Every column the bundle had said the same
 * thing the run already knew: `coder_provider_error_after_init`, which names
 * the boundary and not the cause. The cause was in the runtime's final text,
 * which by deliberate design never leaves `hosted-runner.ts`.
 *
 * These hold the repair to both halves at once, through the real adapter and
 * the real allowlist: the classified reason arrives, and the text it was
 * classified from does not.
 */
describe('a coder failure records WHY, in a closed vocabulary, and quotes nothing', () => {
  const coderAdapterWithFinalText = (input: { runs: HostedRunInput[]; finalText?: string | null; refuse?: boolean; runnerReason?: string }) => {
    const log: FakeLog = { order: [] };
    const artifacts = createLiveArtifactExchange();
    artifacts.put(planRef('run-live'), JSON.stringify(VALID_PLAN));
    const run = async (runInput: HostedRunInput): Promise<HostedRunOutcome> => {
      input.runs.push(runInput);
      const completed = await fakeCoder(log, [])(runInput) as Extract<HostedRunOutcome, { kind: 'completed' }>;
      // `in`, not `??`: an explicit null is the case where the runtime failed
      // and said nothing, which is a different fact from not overriding it.
      const observation = { ...completed.observation, finalText: 'finalText' in input ? input.finalText ?? null : completed.observation.finalText };
      if (input.refuse) {
        return {
          kind: 'refused', refusalCode: 'coder_provider_error_after_init',
          // The fixed sentence the runner really sends. It is constant on
          // purpose and is not where the answer comes from.
          safeMessage: 'The hosted run failed after it started.',
          ...(input.runnerReason === undefined ? {} : { failureReason: input.runnerReason }),
          observation, envelope: completed.envelope, startedAt: completed.startedAt, completedAt: completed.completedAt,
        } as HostedRunOutcome;
      }
      return { ...completed, observation };
    };
    return createLiveHostedCodingAdapter({
      worker: {
        workerId: 'coding-agent-claude-hosted', role: 'CODING_AGENT', adapterId: 'claude-agent-sdk-hosted-live', providerId: 'anthropic',
        capabilities: ['implement'], taskTypes: ['build'], concurrencyLimit: 1, timeoutMs: 1_000, maxRetries: 1, status: 'AVAILABLE',
      },
      contexts: { snapshotFor: () => reviewSnapshot('build-1') }, artifacts, projectId: 'prj-live',
      apiKey: 'FAKETESTNOTREAL-anthropic', requestedModel: 'claude-fable-5',
      workspacePath: '/workspace/mission', testCommand: 'npm run mission-test',
      shell: fakeShell(log, []), run: run as never, queryLoader: async () => fakeQuery,
    });
  };

  const failedDiagnostics = async (finalText: string | null): Promise<Record<string, unknown>> => {
    const runs: HostedRunInput[] = [];
    const adapter = coderAdapterWithFinalText({ runs, finalText, refuse: true });
    const failure = await adapter
      .dispatch({ taskId: 'build-1', contextId: 'ctx-resume-1', taskType: 'build' })
      .then(() => null)
      .catch((error: unknown) => error as { diagnostics?: Record<string, unknown> });
    expect(failure, 'the refusal must fail the dispatch').not.toBeNull();
    return failure!.diagnostics ?? {};
  };

  it('classifies the runtime\'s own final text into the vocabulary the domain admits', async () => {
    const diagnostics = await failedDiagnostics('API Error: 429 {"type":"rate_limit_error"}');
    expect(diagnostics.failureReason).toBe('rate_limited');
    // And it survived `safeReviewDiagnostics`, which the dispatch error applies
    // on construction — a value the domain refused would read null here.
    expect(safeReviewDiagnostics(diagnostics)?.failureReason).toBe('rate_limited');
  });

  it('carries NO fragment of that text into any diagnostic value', async () => {
    const diagnostics = await failedDiagnostics('API Error 401: invalid x-api-key sk-ant-api03-AAAABBBBCCCC for org acme-internal');
    expect(diagnostics.failureReason).toBe('provider_auth_rejected');
    const rendered = JSON.stringify(safeReviewDiagnostics(diagnostics));
    for (const fragment of ['sk-ant', 'api03', 'AAAABBBB', 'x-api-key', 'acme-internal']) {
      expect(rendered.includes(fragment), `${fragment} reached a durable row`).toBe(false);
    }
  });

  it('says "no_message" when the runtime failed silently — not "unclassified", and never zero', async () => {
    expect((await failedDiagnostics(null)).failureReason).toBe('no_message');
  });

  it('prefers the runner\'s own classification of the thrown error over the final text', async () => {
    // On `coder_provider_error_after_init` the runtime THREW instead of
    // finishing, so the cause is in the thrown error and the final text is
    // whatever the stream had managed to emit before it. Mission 5's was 25
    // bytes. The runner classifies the throw; this proves that answer wins.
    const runs: HostedRunInput[] = [];
    const adapter = coderAdapterWithFinalText({ runs, finalText: 'Execution error', refuse: true, runnerReason: 'provider_overloaded' });
    const failure = await adapter
      .dispatch({ taskId: 'build-1', contextId: 'ctx-resume-1', taskType: 'build' })
      .then(() => null)
      .catch((error: unknown) => error as { diagnostics?: Record<string, unknown> });
    expect(failure!.diagnostics?.failureReason).toBe('provider_overloaded');
  });

  it('a build that WORKED has no failure reason, rather than one inferred from its summary', async () => {
    // The success path shares this builder, so a classifier run on a healthy
    // summary would read the word "error" in a test log as a failure.
    const runs: HostedRunInput[] = [];
    const adapter = coderAdapterWithFinalText({ runs, finalText: 'Implemented the change. 0 errors, 0 failures.' });
    const granted = await adapter.dispatch({ taskId: 'build-1', contextId: 'ctx-resume-1', taskType: 'build' });
    expect(granted.status).toBe('SUCCEEDED');
    expect((granted.diagnostics as Record<string, unknown>).outcome).toBe('succeeded');
    expect((granted.diagnostics as Record<string, unknown>).failureReason).toBeNull();
  });
});

/**
 * THE REGISTRATION TABLE IS THE THING THAT FAILED.
 *
 * Paid run 34037313976 rejected a plan, minted a `repair:plan` task on the
 * Coding Agent, and failed `PROVIDER_UNAVAILABLE` because nobody was
 * registered to take it. The routability check now refuses such a repair
 * before it exists, which turns that outage into a named halt — but a halt is
 * still a dead mission. What keeps the mission ALIVE is this table, and it is
 * one hand-maintained array away from the same failure.
 */
describe('every repair the planner can mint has a registered worker', () => {
  const registrations = () => [ARCHITECT_WORKER, CODER_WORKER, reviewerWorker('xai')];

  it('the seeded graph\'s two task types can each be repaired by their own role', () => {
    // A repair inherits its subject's ROLE and STAGE, so these are exactly the
    // two repairs the seeded plan → build graph can produce.
    for (const [role, taskType] of [['PROMPT_ARCHITECT', 'repair:plan'], ['CODING_AGENT', 'repair:build']] as const) {
      const takers = registrations().filter((worker) => worker.role === role && worker.taskTypes.includes(taskType));
      expect(takers.map((worker) => worker.workerId), `${role} ${taskType} is routable`).toHaveLength(1);
    }
  });

  it('and every repair has a reviewer for its own re-review', () => {
    for (const taskType of ['review:plan', 'review:build', 'review:repair:plan', 'review:repair:build']) {
      expect(reviewerWorker('xai').taskTypes, taskType).toContain(taskType);
    }
  });

  it('the Coding Agent does NOT take a plan repair — the shape the paid run minted', () => {
    expect(CODER_WORKER.taskTypes).not.toContain('repair:plan');
    expect(CODER_WORKER.taskTypes).toContain('repair:build');
    expect(ARCHITECT_WORKER.taskTypes).toContain('repair:plan');
  });

  /**
   * THE TABLE THAT KEEPS A MISSION ALIVE, DERIVED RATHER THAN RESTATED.
   *
   * The cases above enumerate the two repairs the seeded graph produces, which
   * was true when the graph had two stages. The domain now defines six review
   * stages and the architect takes two more task types, and a list written by
   * hand goes stale the moment somebody adds a seventh. These read the domain's
   * own vocabularies, so a stage added there fails here until a worker takes it.
   */
  it('every review stage the domain defines has a registered reviewer', () => {
    const reviewer = reviewerWorker('xai');
    for (const stage of JULIUS_REVIEW_STAGES) {
      expect(reviewer.taskTypes, `review:${stage} must be routable`).toContain(`review:${stage}`);
    }
    // And nothing is registered that the domain does not define, which is how a
    // typo in this array becomes a task type nothing ever produces.
    for (const taskType of reviewer.taskTypes) {
      expect(reviewStageOf(taskType), `${taskType} names a real stage`).not.toBeNull();
    }
    expect(reviewer.taskTypes).toHaveLength(JULIUS_REVIEW_STAGES.length);
  });

  it('every work stage a worker may be asked for has exactly one taker', () => {
    const registrations = [ARCHITECT_WORKER, CODER_WORKER, reviewerWorker('xai')];
    // The stages that are WORK rather than review, each with the role that owns
    // it. A repair inherits its subject's role and stage, so the repair of each
    // is the same worker's.
    const owners = [
      ['PROMPT_ARCHITECT', 'plan'], ['PROMPT_ARCHITECT', 'repair:plan'],
      ['PROMPT_ARCHITECT', 'guidance'], ['PROMPT_ARCHITECT', 'repair:guidance'],
      ['CODING_AGENT', 'build'], ['CODING_AGENT', 'repair:build'],
    ] as const;
    for (const [role, taskType] of owners) {
      const takers = registrations.filter((item) => item.role === role && item.taskTypes.includes(taskType));
      expect(takers.map((item) => item.workerId), `${role} ${taskType}`).toHaveLength(1);
    }
    // Every work stage the domain defines is in that table — so a stage added
    // to `JULIUS_REVIEW_STAGES` cannot be quietly left without an owner.
    expect(new Set(owners.map(([, taskType]) => taskType))).toEqual(new Set(JULIUS_REVIEW_STAGES));
  });

  it('a guidance task and its review are registered together, or the mission stalls', () => {
    // A `guidance` task nobody can re-review is minted, dispatched, and then
    // never accepted — and the continuation BLOCKED on it never releases. That
    // is a stalled mission rather than a refused one, which is worse: the
    // routability preflight catches an unroutable task, and nothing catches an
    // unreviewable one.
    const architectGuides = ARCHITECT_WORKER.taskTypes.includes('guidance');
    const reviewerJudges = reviewerWorker('xai').taskTypes.includes('review:guidance');
    expect(architectGuides, 'the two registrations move together').toBe(reviewerJudges);
  });

  it('a guidance review is charged as GUIDANCE and requires the packet itself', () => {
    // The gap this closes: `charge.requires` has named the packet since the
    // stage vocabulary was written, and the live adapter read only the plan —
    // so a guidance review could pass its own preconditions holding the plan
    // and not the thing it exists to judge.
    for (const stage of ['guidance', 'repair:guidance'] as const) {
      const charge = reviewChargeFor(stage);
      expect(charge.subject).toBe('GUIDANCE');
      expect(charge.requires).toContain('guidance');
      expect(charge.requires).toContain('plan');
      expect(charge.requires, 'guidance has no diff to demand').not.toContain('diff');
    }
  });

  it('a repair of a repair is still its stage, so one registration covers every round', () => {
    // `repairTaskTypeFor` strips every prefix, so round two of a build repair
    // is `repair:build` again and needs no further registration.
    expect(repairTaskTypeFor('repair:build')).toBe('repair:build');
    expect(repairTaskTypeFor('repair:plan')).toBe('repair:plan');
    for (const worker of registrations()) {
      for (const taskType of worker.taskTypes) {
        expect(taskType, `${worker.workerId} registers a doubled repair type`).not.toMatch(/repair:repair:/u);
      }
    }
  });
});

/**
 * THE PLAN REVISION IS A PAID DISPATCH NOTHING HAD EXERCISED.
 *
 * `repair:plan` reaches the Prompt Architect because a repair inherits its
 * subject's role. That branch shows the rejected plan beside the reviewer's
 * findings and replaces the artifact the Coding Agent will read — production
 * code on the paid path, and until these cases it ran for the first time in a
 * mission that costs money.
 */
describe('the architect revises a rejected plan', () => {
  const REVISED = { ...VALID_PLAN, objectiveSummary: 'Revised: add the verification strategy the review asked for.' };

  const architectAdapter = (input: { artifacts: ReturnType<typeof createLiveArtifactExchange>; seen: Array<Record<string, unknown>>; snapshot?: JuliusContextSnapshot }) =>
    createLiveArchitectAdapter({
      worker: ARCHITECT_WORKER,
      contexts: { snapshotFor: () => input.snapshot ?? reviewSnapshot('repair:plan-1:1:task') },
      artifacts: input.artifacts,
      config: { liveMode: true, model: 'gpt-5.6-sol', maxOutputTokens: 4_000 } as never,
      apiKey: 'FAKETESTNOTREAL-openai',
      run: (async (call: Record<string, unknown>) => {
        input.seen.push(call);
        return {
          ok: true, actualModel: 'gpt-5.6-sol', responseId: 'resp_revision_1', status: 'completed',
          outputText: JSON.stringify(REVISED),
          usage: { inputTokens: 120, cachedInputTokens: 0, outputTokens: 60, reasoningTokens: 0, totalTokens: 180 },
        };
      }) as never,
    });

  it('shows the architect the plan it is revising, and says the revision is a revision', async () => {
    const artifacts = createLiveArtifactExchange();
    artifacts.put(planRef('run-live'), JSON.stringify(VALID_PLAN));
    const seen: Array<Record<string, unknown>> = [];
    const result = await architectAdapter({ artifacts, seen })
      .dispatch({ taskId: 'repair:plan-1:1:task', contextId: 'ctx-resume-1', taskType: 'repair:plan' });

    expect(result.status).toBe('SUCCEEDED');
    const call = seen[0]!;
    expect(String(call.input), 'the rejected plan is shown').toContain('PRIOR PLAN');
    expect(String(call.input)).toContain(VALID_PLAN.objectiveSummary);
    expect(String(call.instructions), 'and the charter says this is a revision').toContain('This is a PLAN REVISION');
    expect(String(call.instructions)).toContain('Keep the mission objective and every acceptance criterion exactly as stated');
    expect(String(call.instructions), 'and forbids claiming work that has not happened')
      .toContain('Do not claim any finding is resolved by implementation work');
    // The revision REPLACES the plan the Coding Agent will read.
    expect(artifacts.get(planRef('run-live'))).toBe(JSON.stringify(REVISED));
  });

  it('a first plan is not a revision: no prior plan, no revision charter', async () => {
    const artifacts = createLiveArtifactExchange();
    const seen: Array<Record<string, unknown>> = [];
    await architectAdapter({ artifacts, seen, snapshot: reviewSnapshot('plan-1') })
      .dispatch({ taskId: 'plan-1', contextId: 'ctx-resume-1', taskType: 'plan' });
    expect(String(seen[0]!.instructions)).not.toContain('This is a PLAN REVISION');
    expect(String(seen[0]!.input)).not.toContain('PRIOR PLAN');
  });

  it('refuses to revise a plan this process cannot see, rather than writing a new one over it', async () => {
    // The artifact exchange is same-process: after a restart the plan is gone
    // even though its task succeeded durably. Revising from nothing would
    // silently replace a reviewed plan with an unreviewed one.
    const artifacts = createLiveArtifactExchange();
    const seen: Array<Record<string, unknown>> = [];
    await expect(architectAdapter({ artifacts, seen })
      .dispatch({ taskId: 'repair:plan-1:1:task', contextId: 'ctx-resume-1', taskType: 'repair:plan' }))
      .rejects.toMatchObject({ code: 'WORKER_EXECUTION_FAILURE', failureClass: 'prior_plan_unavailable' });
    expect(seen, 'no provider was reached').toEqual([]);
    expect(artifacts.get(planRef('run-live'))).toBeNull();
  });
});

/**
 * WHAT THE CODER ASKED FOR, AND WHAT THE RECORD SAYS ABOUT ASKING.
 *
 * The channel itself is proved in the domain (`julius-worker-participation`)
 * and end to end through the production composition (`Q8` in the peer
 * qualification). These are the adapter's own obligations at the seam: the
 * request is handed on exactly as written, an unreadable one neither fails the
 * dispatch nor vanishes, the worker's prose never becomes a durable value, and
 * "did not ask" is never confused with "had no way to".
 */
describe('a coder’s request crosses the adapter without being cleaned or lost', () => {
  const coderWithFinalText = (input: { runs: HostedRunInput[]; finalText?: string | null; refuse?: boolean }) => {
    const log: FakeLog = { order: [] };
    const artifacts = createLiveArtifactExchange();
    artifacts.put(planRef('run-live'), JSON.stringify(VALID_PLAN));
    const run = async (runInput: HostedRunInput): Promise<HostedRunOutcome> => {
      input.runs.push(runInput);
      const completed = await fakeCoder(log, [])(runInput) as Extract<HostedRunOutcome, { kind: 'completed' }>;
      const observation = { ...completed.observation, finalText: 'finalText' in input ? input.finalText ?? null : completed.observation.finalText };
      if (input.refuse) {
        return {
          kind: 'refused', refusalCode: 'coder_provider_error_after_init',
          safeMessage: 'The hosted run failed after it started.',
          observation, envelope: completed.envelope, startedAt: completed.startedAt, completedAt: completed.completedAt,
        } as HostedRunOutcome;
      }
      return { ...completed, observation };
    };
    return createLiveHostedCodingAdapter({
      worker: {
        workerId: 'coding-agent-claude-hosted', role: 'CODING_AGENT', adapterId: 'claude-agent-sdk-hosted-live', providerId: 'anthropic',
        capabilities: ['implement'], taskTypes: ['build'], concurrencyLimit: 1, timeoutMs: 1_000, maxRetries: 1, status: 'AVAILABLE',
      },
      contexts: { snapshotFor: () => reviewSnapshot('build-1') }, artifacts, projectId: 'prj-live',
      apiKey: 'FAKETESTNOTREAL-anthropic', requestedModel: 'claude-fable-5',
      workspacePath: '/workspace/mission', testCommand: 'npm run mission-test',
      shell: fakeShell(log, []), run: run as never, queryLoader: async () => fakeQuery,
    });
  };

  const succeed = async (finalText: string | null) => {
    const runs: HostedRunInput[] = [];
    const result = await coderWithFinalText({ runs, finalText })
      .dispatch({ taskId: 'build-1', contextId: 'ctx-resume-1', taskType: 'build' });
    return { result, runs, diagnostics: result.diagnostics as Record<string, unknown> };
  };

  const ask = (body: Record<string, unknown>, prose = 'I am blocked.'): string =>
    `${prose}\n${JULIUS_PARTICIPATION_MARKER}\n${JSON.stringify(body)}\n`;

  it('the dispatch prompt carries the protocol, so the channel is one the worker was told about', async () => {
    const { runs } = await succeed('Done.');
    expect(runs[0]!.prompt).toContain(JULIUS_PARTICIPATION_MARKER);
    expect(runs[0]!.prompt).toContain('no block is the ordinary case');
  });

  it('hands the request on exactly as written — the adapter does not sanitise', async () => {
    const request = { question: 'Which reading does the exporter support?', blockedOn: ['the exporter is off-slice'] };
    const { result, diagnostics } = await succeed(ask({ guidanceRequest: request }));
    expect(result.guidanceRequest).toEqual(request);
    expect(diagnostics.participationAskedGuidance).toBe(true);
    expect(diagnostics.participationReadable).toBe(true);
    expect(diagnostics.participationRefusal).toBeNull();
  });

  /**
   * A REQUEST THE DOMAIN WILL REFUSE STILL HAS TO REACH IT. `researchAsks: 'please'`
   * is unusable, and the pipeline's `RESEARCH_ASK_UNREADABLE` row is the only
   * evidence the worker tried. An adapter that filtered it would erase that.
   */
  it('carries a request the domain will refuse, rather than dropping it here', async () => {
    const { result } = await succeed(ask({ researchAsks: 'please look this up' }));
    expect(result.researchAsks).toBe('please look this up');
  });

  it('a block that could not be read neither fails the dispatch nor vanishes from the record', async () => {
    const doubled = `${ask({ guidanceRequest: { question: 'first' } })}\n${ask({ guidanceRequest: { question: 'second' } })}`;
    const { result, diagnostics } = await succeed(doubled);
    expect(result.status).toBe('SUCCEEDED');
    expect('guidanceRequest' in result, 'no channel is invented from an ambiguous block').toBe(false);
    expect(diagnostics.participationPresent).toBe(true);
    expect(diagnostics.participationReadable).toBe(false);
    expect(diagnostics.participationRefusal).toBe('PARTICIPATION_REPEATED');
    // And the refusal survives the domain allowlist, which is the only hop that
    // decides what a durable row may contain.
    expect(safeReviewDiagnostics(diagnostics)?.participationRefusal).toBe('PARTICIPATION_REPEATED');
  });

  it('a worker that asked for nothing is recorded as present:false, not as unknown', async () => {
    const { diagnostics } = await succeed('Implemented the change; the suite is green.');
    expect(diagnostics.participationPresent).toBe(false);
    expect(diagnostics.participationReadable).toBeNull();
    expect(diagnostics.participationAskedGuidance).toBe(false);
  });

  /**
   * UNKNOWN IS NOT FALSE. A run whose runtime never produced a final message
   * gave the worker nowhere to ask. Reporting `false` there would assert that
   * it chose not to — on precisely the runs where nobody can know.
   */
  it('a run with no final message reports UNKNOWN for every participation fact', async () => {
    const { diagnostics } = await succeed(null);
    for (const key of ['participationPresent', 'participationReadable', 'participationRefusal',
      'participationAskedGuidance', 'participationAskedResearch', 'participationAskedResume']) {
      expect(diagnostics[key], `${key} must be unknown, not false`).toBeNull();
    }
  });

  /**
   * THE SAME FACTS ON BOTH ENDINGS. A column present on a success and absent on
   * a failure reads as a bug in the record — the reason `hostedCoderDiagnostics`
   * is one function.
   */
  it('a failed dispatch carries the same participation facts a successful one does', async () => {
    const runs: HostedRunInput[] = [];
    const failure = await coderWithFinalText({ runs, finalText: ask({ guidanceRequest: { question: 'why' } }), refuse: true })
      .dispatch({ taskId: 'build-1', contextId: 'ctx-resume-1', taskType: 'build' })
      .then(() => null)
      .catch((error: unknown) => error as { diagnostics?: Record<string, unknown> });
    const diagnostics = failure!.diagnostics ?? {};
    expect(diagnostics.participationPresent).toBe(true);
    expect(diagnostics.participationAskedGuidance).toBe(true);
  });

  it('carries no fragment of the worker’s own prose into any durable value', async () => {
    const prose = 'I think the exporter probably writes NULL as the literal word NULL, sk-ant-api03-SECRET.';
    const { diagnostics } = await succeed(ask({ guidanceRequest: { question: prose } }, prose));
    const rendered = JSON.stringify(safeReviewDiagnostics(diagnostics));
    for (const fragment of ['probably', 'sk-ant', 'api03', 'SECRET', 'literal word']) {
      expect(rendered.includes(fragment), `${fragment} reached a durable row`).toBe(false);
    }
  });

  /**
   * ONE FLAG PER CHANNEL, held to the channel list itself: a channel added
   * without an exported column would otherwise be invisible in every bundle.
   */
  it('the diagnostics carry exactly one flag per declared channel', async () => {
    const { diagnostics } = await succeed('Done.');
    const flags = Object.keys(diagnostics).filter((key) => key.startsWith('participationAsked'));
    expect(flags).toHaveLength(JULIUS_PARTICIPATION_CHANNELS.length);
  });
});

/**
 * THE OTHER TWO SLOTS GET THE SAME DOOR.
 *
 * `julius-worker-participation` gave the Coding Agent a way to ask, through the
 * only structured thing an agentic session returns. The Prompt Architect and
 * the Independent Reviewer answer with objects, so for them an ask is a FIELD —
 * the same typed ask, the same sanitizer, the same policy. Until this, the
 * paid qualification's own required sequence began with something impossible:
 * "Architect serious pre-lock investigation/research".
 */
describe('the architect and the reviewer can ask, through their own answers', () => {
  const ASK = {
    source: 'web', capability: 'read_item',
    reference: 'https://docs.example.test/spec',
    purpose: 'Establish a fact the mission packet does not carry.',
  };

  /** The locked terms a guidance dispatch is refused without. */
  const CONTRACT_CHARGE = Object.freeze({
    stage: 'build' as const,
    binding: { contractId: 'contract:run-live:build-1', taskId: 'build-1', contractRevision: 1, bindingDigest: `sha256:${'a'.repeat(64)}` },
    objective: 'Normalize the mission label.',
    responsibilityBoundary: 'Only the one module.',
    inScope: ['src/slug.ts'], outOfScope: [], permittedPaths: ['src/slug.ts'],
    prohibitedActions: [], blockingCriteria: ['AC-1'], contractReviewCriteria: ['AC-1 holds'],
    requiredEvidence: ['TEST'] as const, requiredChecks: ['npm test'], failureConditions: [],
    stoppingCondition: 'The suite is green.',
  });

  const architectFor = (output: unknown, seen: Array<Record<string, unknown>>, taskType = 'plan') => ({
    adapter: createLiveArchitectAdapter({
      worker: ARCHITECT_WORKER,
      contexts: { snapshotFor: () => reviewSnapshot('plan-1') },
      artifacts: (() => { const a = createLiveArtifactExchange(); a.put(planRef('run-live'), JSON.stringify(VALID_PLAN)); return a; })(),
      config: { liveMode: true, model: 'gpt-5.6-sol', maxOutputTokens: 4_000 } as never,
      apiKey: 'FAKETESTNOTREAL-openai',
      run: (async (call: Record<string, unknown>) => {
        seen.push(call);
        return {
          ok: true, actualModel: 'gpt-5.6-sol', responseId: 'resp_ask_1', status: 'completed',
          outputText: JSON.stringify(output),
          usage: { inputTokens: 100, cachedInputTokens: 0, outputTokens: 50, reasoningTokens: 0, totalTokens: 150 },
        };
      }) as never,
    }),
    taskType,
  });

  const planWith = (asks: unknown) => ({ ...VALID_PLAN, researchAsks: asks });

  /**
   * THE SCHEMA IS WHAT MAKES THE MODEL ANSWER. Strict mode needs the property
   * AND its name in `required`; a schema carrying only the first is rejected by
   * the API, and that rejection would arrive on a paid call.
   */
  it('the plan dispatch now sends a schema, and that schema requires the ask', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const { adapter } = architectFor(planWith([]), seen);
    await adapter.dispatch({ taskId: 'plan-1', contextId: 'ctx-resume-1', taskType: 'plan' });
    const schema = (seen[0]!.schema as { schema: Record<string, unknown> }).schema;
    expect(Object.keys(schema.properties as object)).toContain('researchAsks');
    expect(schema.required).toContain('researchAsks');
    // And it did not lose what the plan schema already demanded.
    expect(schema.required).toContain('objectiveSummary');
  });

  it('the guidance dispatch carries it too — a post-lock question is still a question', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const { adapter } = architectFor({
      subObjective: 'Do the thing.', relevantRequirements: ['R'], relevantConstraints: ['C'],
      repositoryFindings: ['F'], runtimeFindings: ['F'], references: [],
      recommendedActions: ['A'], additionalProhibitions: [], affectedCriterionIds: [], unresolvedQuestions: [],
      researchAsks: [ASK],
    }, seen);
    const result = await adapter.dispatch({
      taskId: 'guidance:build-1:1:task', contextId: 'ctx-resume-1', taskType: 'guidance',
      contract: CONTRACT_CHARGE,
    });
    const schema = (seen[0]!.schema as { schema: Record<string, unknown> }).schema;
    expect(schema.required).toContain('researchAsks');
    expect(result.researchAsks).toEqual([ASK]);
  });

  it('the charter tells the architect what the field is — a field nobody was told about is unused', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const { adapter } = architectFor(planWith([]), seen);
    await adapter.dispatch({ taskId: 'plan-1', contextId: 'ctx-resume-1', taskType: 'plan' });
    const instructions = String(seen[0]!.instructions);
    expect(instructions).toContain('"researchAsks"');
    expect(instructions).toContain('before the work that depends on it');
    // The role charter is still there; the ask is added beside it, not instead.
    expect(instructions).toContain('You are the Prompt Architect');
  });

  it('a pre-lock ask reaches the pipeline untouched, and the domain sanitizer accepts it', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const { adapter } = architectFor(planWith([ASK]), seen);
    const result = await adapter.dispatch({ taskId: 'plan-1', contextId: 'ctx-resume-1', taskType: 'plan' });
    expect(result.researchAsks).toEqual([ASK]);
    expect(sanitizeJuliusResearchAsks(result.researchAsks)).toHaveLength(1);
    // The plan still validated: the new field does not break the fifteen rules.
    expect(result.status).toBe('SUCCEEDED');
    expect(result.contractProposal).toBeDefined();
  });

  /**
   * AN EMPTY LIST IS AN ANSWER, NOT AN ASK. The schema makes the field
   * required, so `[]` is what a worker that needs nothing must write. Carrying
   * it on would open a checkpoint for a question nobody posed and record a
   * refusal against a worker that did exactly as instructed.
   */
  it('an empty list is not carried, so needing nothing costs no checkpoint', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const { adapter } = architectFor(planWith([]), seen);
    const result = await adapter.dispatch({ taskId: 'plan-1', contextId: 'ctx-resume-1', taskType: 'plan' });
    expect('researchAsks' in result).toBe(false);
  });

  it('an ask the domain will refuse is still carried, rather than cleaned here', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const { adapter } = architectFor(planWith([{ ...ASK, hosts: ['evil.example'] }]), seen);
    const result = await adapter.dispatch({ taskId: 'plan-1', contextId: 'ctx-resume-1', taskType: 'plan' });
    expect(result.researchAsks).toBeDefined();
    expect(sanitizeJuliusResearchAsks(result.researchAsks), 'the DOMAIN refuses it, not the adapter').toBeNull();
  });

  /* ------------------------------------------------------------- reviewer */

  const reviewText = (asks: unknown): string => JSON.stringify({
    verdict: 'approved', summary: 'No blocking findings.', findings: [],
    requirementsChecked: [{ requirement: 'AC-1', status: 'passed', evidence: 'diff reviewed' }],
    ...(asks === undefined ? {} : { researchAsks: asks }),
  });

  const reviewerFor = (text: string, packets: ReviewPacket[]) => {
    const log: FakeLog = { order: [] };
    const artifacts = createLiveArtifactExchange();
    artifacts.put(planRef('run-live'), JSON.stringify(VALID_PLAN));
    return createLiveHermesReviewerAdapter({
      worker: {
        workerId: 'independent-reviewer-hermes', role: 'INDEPENDENT_REVIEWER',
        adapterId: 'hermes-local-live', providerId: 'xai', capabilities: ['review'],
        taskTypes: ['review:plan'], concurrencyLimit: 1, timeoutMs: 1_000, maxRetries: 1, status: 'AVAILABLE',
      },
      contexts: { snapshotFor: () => reviewSnapshot('plan-1:review') },
      artifacts,
      config: loadHermesConfig(LIVE_ENV as never),
      testCommand: 'npm run mission-test',
      run: textReviewer(log, packets, [text]) as never,
    });
  };

  it('the review prompt declares the field and states the same bounds', async () => {
    const packets: ReviewPacket[] = [];
    await reviewerFor(reviewText([]), packets)
      .dispatch({ taskId: 'plan-1:review', contextId: 'ctx-resume-1', taskType: 'review:plan' });
    expect(packets).toHaveLength(1);
    const prompt = buildReviewPrompt(packets[0]!);
    /**
     * THE DECLARED SHAPE, not merely the word somewhere in the prompt. The
     * guidance paragraph also names the field, so `toContain('"researchAsks"')`
     * passes with the shape declaration deleted — and a reviewer told what the
     * field means but not that its answer may carry it would have nowhere to
     * put one.
     */
    expect(prompt).toContain('"researchAsks":[{"source":string,"capability":string,"reference":string,"purpose":string}]}');
    expect(prompt).toContain('Julius decides whether this mission is authorised');
    expect(prompt).toContain('At most 3 per answer');
  });

  it('a reviewer’s ask survives the REAL parser and reaches the dispatch result', async () => {
    const packets: ReviewPacket[] = [];
    const result = await reviewerFor(reviewText([ASK]), packets)
      .dispatch({ taskId: 'plan-1:review', contextId: 'ctx-resume-1', taskType: 'review:plan' });
    expect(result.researchAsks).toEqual([ASK]);
    expect(sanitizeJuliusResearchAsks(result.researchAsks)).toHaveLength(1);
  });

  it('a reviewer that asked for nothing carries nothing, and a review with no field is unchanged', async () => {
    for (const text of [reviewText([]), reviewText(undefined)]) {
      const packets: ReviewPacket[] = [];
      const result = await reviewerFor(text, packets)
        .dispatch({ taskId: 'plan-1:review', contextId: 'ctx-resume-1', taskType: 'review:plan' });
      expect('researchAsks' in result).toBe(false);
      expect(result.status).toBe('SUCCEEDED');
    }
  });
});
