import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMissionRegistry, selectArchitectPath } from './mission';
import type { MissionRoleDeps } from './mission';
import { buildAttestation, decideCompletion, digest } from './attestation';
import type { ExecutionAttestation } from './attestation';
import { runHermesReview, hermesPreflight, parseHermesStatus } from './hermes-reviewer';
import type { HermesOutcome, ReviewPacket } from './hermes-reviewer';
import { codingHandoffDigest, type CodingOutcome } from './coding';
import type { OpenAiArchitectResult } from './openai-architect';
import type { CodingTerminalState, LiveMissionUpdate } from './types';
import { buildCodingTerminalView } from '../src/relay/ui/project-workspace/coding-terminal';

/**
 * PRODUCTION THREE-ROLE ORCHESTRATOR.
 *
 * Every role boundary is injected, so this file proves the WIRING of the real
 * `mission.ts` pipeline — which role it calls, in what order, how many times,
 * what it hands over, and what it refuses to complete — without ever
 * contacting OpenAI, Claude Code, or Hermes. `globalThis.fetch` is replaced
 * with a spy that fails the test if anything reaches the network.
 */

const LIVE_ENV: NodeJS.ProcessEnv = {
  RELAY_PROMPT_ARCHITECT_MODE: 'live',
  OPENAI_API_KEY: 'sk-test-value-never-serialized',
  OPENAI_PROMPT_ARCHITECT_MODEL: 'gpt-test',
};
const FUSION_ENV: NodeJS.ProcessEnv = { RELAY_PROMPT_ARCHITECT_MODE: 'fusion' };
const AT = '2026-07-23T10:00:00.000Z';

const GOOD_HANDOFF = {
  objective: 'Normalize project names safely',
  task: 'Implement normalizeProjectName',
  implementationInstructions: ['Trim the input', 'Lowercase it', 'Collapse separators'],
  constraints: ['Edit only src/normalize.js'],
  acceptanceCriteria: ['Existing tests pass'],
  allowedFiles: ['src/normalize.js'],
  prohibitedFiles: ['package.json'],
  recommendedChecks: ['node --test test/normalize.test.js'],
};

const ARCHITECT_RESULT: OpenAiArchitectResult = {
  handoff: GOOD_HANDOFF,
  receipt: {
    provider: 'openai',
    model: 'gpt-test',
    requestIdRedacted: '…123456',
    startedAt: AT,
    completedAt: AT,
    inputTokens: 10,
    outputTokens: 20,
    totalTokens: 30,
    inputDigest: digest('in'),
    outputDigest: digest('out'),
    billingPath: 'api_billed',
    coordinatedBy: 'sunday-alcatraz',
    networkPath: 'relay-bridge-direct-openai',
    coordinationLabel: 'Coordinated by Sunday Alcatraz · direct OpenAI request from the Relay bridge',
  },
};

const ARTIFACT_DIGEST = digest('artifact-v1');

function terminalState(): CodingTerminalState {
  return {
    executionId: 'exec1234',
    externalSessionRedacted: '…abcd',
    runtime: 'Claude Code (local CLI)',
    billing: 'subscription',
    status: 'complete',
    projectLabel: 'Relay controlled fixture (throwaway repository)',
    startedAt: AT,
    endedAt: AT,
    permissions: {
      allowedTools: ['Read', 'Edit'],
      allowedFiles: ['src/normalize.js'],
      protectedPaths: ['package.json', 'test'],
      deniedCapabilities: ['Bash'],
    },
    lines: [
      { sequence: 0, at: AT, kind: 'session', truth: 'system_notice', text: 'Claude Code session started.' },
      { sequence: 1, at: AT, kind: 'tool', truth: 'agent_claim', text: 'Edit src/normalize.js', target: 'src/normalize.js' },
      { sequence: 2, at: AT, kind: 'verification', truth: 'relay_evidence', text: 'Required tests passed under Relay verification.' },
    ],
    activeFile: 'src/normalize.js',
    changedFiles: ['src/normalize.js'],
    diff: '--- a/src/normalize.js\n+++ b/src/normalize.js',
    test: { command: 'node --test test/normalize.test.js', status: 'passed', exitCode: 0, output: 'ok 3' },
    claim: { summary: 'Implemented the normalizer.', filesChanged: ['src/normalize.js'], checksRun: ['Reported completing the task'] },
    attestation: {
      attestationId: 'att_coding_x',
      launchVerified: true,
      completionVerified: true,
      fallbackOccurred: false,
      billingPath: 'subscription',
    },
  };
}

function codingAttestation(missionRevision: string): ExecutionAttestation {
  return buildAttestation({
    missionId: 'm1',
    missionRevision,
    role: 'coding_agent',
    requestedActor: 'Claude Code',
    actualActor: 'Claude Code',
    requestedRuntime: 'claude-code-local',
    actualRuntime: 'claude-code-local',
    billingPath: 'subscription',
    launchVerified: true,
    completionVerified: true,
    fallbackOccurred: false,
    inputDigest: digest('prompt'),
    startedAt: AT,
    completedAt: AT,
  });
}

function goodCodingOutcome(handoffDigest: string, missionRevision: string, passed = true): CodingOutcome {
  return {
    verifiedComplete: false, // the reviewed policy is never satisfied by the coding leg alone
    verificationPassed: passed,
    deterministicPassed: passed,
    inspectionAssessment: passed ? 'allowed' : 'unauthorized_change',
    filesChanged: ['src/normalize.js'],
    protectedChanges: [],
    sourceUnchanged: true,
    completionOutcome: passed ? 'unsatisfied' : 'failed',
    cancelled: false,
    stopped: false,
    stopReason: null,
    claim: { summary: 'Implemented the normalizer.', filesChanged: ['src/normalize.js'], checksRun: ['Reported completing the task'] },
    attestation: codingAttestation(missionRevision),
    deliveredHandoffDigest: handoffDigest,
    evidence: {
      baseRevision: 'rev1',
      allowedFiles: ['src/normalize.js'],
      prohibitedFiles: ['package.json', 'README.md', 'test', '.git'],
      changedFiles: ['src/normalize.js'],
      protectedChanges: [],
      sourceUnchanged: true,
      inspectionAssessment: passed ? 'allowed' : 'unauthorized_change',
      testCommand: 'node --test test/normalize.test.js',
      testPassed: passed,
      testExitCode: passed ? 0 : 1,
      testOutput: passed ? 'ok 3' : 'not ok 1',
      unifiedDiff: '--- a/src/normalize.js\n+++ b/src/normalize.js',
      changedFileContents: 'function normalizeProjectName(){}',
      artifactDigest: ARTIFACT_DIGEST,
      relayEvidence: ['Relay inspection assessment: allowed'],
    },
  };
}

const approvedReview = (): HermesOutcome => ({
  kind: 'reviewed',
  startedAt: AT,
  completedAt: AT,
  provider: 'Anthropic',
  model: 'claude-opus-4-8',
  result: {
    verdict: 'approved',
    summary: 'The implementation satisfies every acceptance criterion.',
    findings: [],
    requirementsChecked: [{ requirement: 'Existing tests pass', status: 'passed', evidence: 'Relay ran the tests.' }],
  },
});

/* ------------------------------------------------------------ harness */

interface Harness {
  calls: { architect: number; fusion: number; coding: number; reviewer: number; hermesPreflight: number; runtime: number };
  order: string[];
  codingInput: Parameters<NonNullable<MissionRoleDeps['runCodingMission']>>[0] | null;
  reviewPacket: ReviewPacket | null;
  deps: MissionRoleDeps;
}

function harness(
  over: {
    architect?: () => Promise<OpenAiArchitectResult>;
    coding?: (h: Harness) => Promise<CodingOutcome>;
    reviewer?: () => Promise<HermesOutcome>;
    hermesReady?: boolean;
    runtimeReady?: boolean;
    codingPassed?: boolean;
    fusionVerified?: boolean;
  } = {},
): Harness {
  const h: Harness = {
    calls: { architect: 0, fusion: 0, coding: 0, reviewer: 0, hermesPreflight: 0, runtime: 0 },
    order: [],
    codingInput: null,
    reviewPacket: null,
    deps: {},
  };

  h.deps = {
    resolveClaudeRuntime: () => {
      h.calls.runtime += 1;
      h.order.push('claude-preflight');
      return over.runtimeReady === false
        ? { ok: false, code: 'live_not_ready', safeMessage: 'Claude Code is not logged in.' }
        : {
            ok: true,
            runtime: {
              executablePath: '/fake/claude',
              capabilities: { executablePath: '/fake/claude' } as never,
              provenance: 'fake',
            },
          };
    },
    hermesPreflight: () => {
      h.calls.hermesPreflight += 1;
      h.order.push('hermes-preflight');
      return over.hermesReady === false
        ? {
            ready: false,
            missing: ['hermes authenticated provider'],
            reason: 'The Hermes reviewer is not available. Missing: hermes authenticated provider.',
            executable: 'hermes',
            oneShotSupported: true,
            readOnlySupported: true,
            model: null,
            provider: null,
            authenticatedProviders: [],
            billingPath: 'subscription',
          }
        : {
            ready: true,
            missing: [],
            executable: 'hermes',
            oneShotSupported: true,
            readOnlySupported: true,
            model: 'claude-opus-4-8',
            provider: 'Anthropic',
            authenticatedProviders: ['Nous Portal'],
            billingPath: 'subscription',
          };
    },
    runOpenAiArchitect: async () => {
      h.calls.architect += 1;
      h.order.push('openai');
      return over.architect ? await over.architect() : ARCHITECT_RESULT;
    },
    runFusionArchitect: async () => {
      h.calls.fusion += 1;
      h.order.push('fusion');
      return {
        objective: 'Normalize project names safely',
        instructions: ['Trim the input'],
        constraints: ['Edit only src/normalize.js'],
        acceptanceCriteria: ['Existing tests pass'],
        briefText: 'brief',
        architectLabel: 'Sunday Alcatraz engine · offline models (no provider key on host)',
        architectProvenance: 'simulated',
        traceId: null,
        modelsUsed: [],
      };
    },
    runCodingMission: async (input) => {
      h.calls.coding += 1;
      h.order.push('claude');
      h.codingInput = input;
      input.onState?.('coding');
      input.publishTerminal?.(terminalState());
      input.onState?.('claim_submitted');
      input.onState?.('relay_verifying');
      h.order.push('relay-verification');
      if (over.coding) return await over.coding(h);
      return goodCodingOutcome(
        codingHandoffDigest(input.handoff),
        input.missionRevision ?? '',
        over.codingPassed !== false,
      );
    },
    runHermesReview: async (input) => {
      h.calls.reviewer += 1;
      h.order.push('hermes');
      h.reviewPacket = input.packet;
      return over.reviewer ? await over.reviewer() : approvedReview();
    },
    relayPreflight: () => {
      h.order.push('relay-preflight');
      return { ready: true, missing: [] };
    },
  };

  if (over.fusionVerified) {
    const inner = h.deps.runCodingMission as NonNullable<MissionRoleDeps['runCodingMission']>;
    h.deps.runCodingMission = async (input) => ({ ...(await inner(input)), verifiedComplete: true });
  }

  return h;
}

function registry(h: Harness, env: NodeJS.ProcessEnv = LIVE_ENV) {
  return createMissionRegistry({
    fusionBaseUrl: 'http://localhost:3000',
    sundayMode: 'fast',
    claudeMode: 'fake',
    confirmLive: true,
    architectEnv: env,
    hermesEnv: env,
    now: () => AT,
    deps: h.deps,
  });
}

const TERMINAL_STATES = new Set(['verified_complete', 'failed', 'cancelled']);

async function settle(reg: ReturnType<typeof registry>, missionId: string, tries = 200): Promise<LiveMissionUpdate> {
  for (let i = 0; i < tries; i++) {
    const view = reg.get(missionId);
    if (view && TERMINAL_STATES.has(view.state)) return view;
    await new Promise((r) => setTimeout(r, 5));
  }
  return reg.get(missionId) as LiveMissionUpdate;
}

async function runMission(h: Harness, env: NodeJS.ProcessEnv = LIVE_ENV, missionId = 'm-orc') {
  const reg = registry(h, env);
  reg.start({ missionId, objective: 'Create a production-safe project-name normalization utility.' });
  const view = await settle(reg, missionId);
  return { reg, view };
}

const originalFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.fetch = vi.fn(async () => {
    throw new Error('no network call may happen in an orchestrator test');
  }) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------- 1 – 4 */

describe('1-4. the live path calls the real Prompt Architect exactly once, after a full-team preflight', () => {
  it('1 + 2. live mode calls runOpenAiArchitect once and never the offline Fusion architect', async () => {
    const h = harness();
    const { view } = await runMission(h);
    expect(view.state).toBe('verified_complete');
    expect(h.calls.architect).toBe(1);
    expect(h.calls.fusion).toBe(0);
  });

  it('3. offline (development) mode never calls OpenAI', async () => {
    const h = harness({ fusionVerified: true });
    const { view } = await runMission(h, FUSION_ENV, 'm-offline');
    expect(h.calls.architect).toBe(0);
    expect(h.calls.fusion).toBe(1);
    expect(h.calls.reviewer).toBe(0);
    expect(view.state).toBe('verified_complete');
    expect(selectArchitectPath(FUSION_ENV)).toBe('fusion');
    expect(selectArchitectPath({ OPENAI_API_KEY: 'k' })).toBe('blocked');
  });

  it('4. the whole team is verified BEFORE the OpenAI request is made', async () => {
    const h = harness();
    await runMission(h);
    const openai = h.order.indexOf('openai');
    expect(h.order.indexOf('claude-preflight')).toBeLessThan(openai);
    expect(h.order.indexOf('hermes-preflight')).toBeLessThan(openai);
    expect(h.order.indexOf('relay-preflight')).toBeLessThan(openai);
  });
});

/* ------------------------------------------------------------- 5 – 8 */

describe('5-8. an unavailable role blocks before spend; the persisted handoff is the delivered handoff', () => {
  it('5. a missing Hermes blocks the mission before OpenAI is consumed', async () => {
    const h = harness({ hermesReady: false });
    const { view } = await runMission(h, LIVE_ENV, 'm-no-hermes');
    expect(view.state).toBe('failed');
    expect(view.phase).toBe('preflight_blocked');
    expect(view.error?.code).toBe('reviewer_not_available');
    expect(view.error?.retryable).toBe(false);
    expect(h.calls.architect).toBe(0);
    expect(h.calls.coding).toBe(0);
    expect(h.calls.reviewer).toBe(0);
  });

  it('an unavailable Coding Agent also blocks before OpenAI is consumed', async () => {
    const h = harness({ runtimeReady: false });
    const { view } = await runMission(h, LIVE_ENV, 'm-no-claude');
    expect(view.phase).toBe('preflight_blocked');
    expect(h.calls.architect).toBe(0);
  });

  it('6. the validated OpenAI handoff is persisted with its digest and receipt', async () => {
    const h = harness();
    const { view } = await runMission(h);
    expect(view.handoff?.objective).toBe(GOOD_HANDOFF.objective);
    expect(view.handoff?.instructions).toEqual(GOOD_HANDOFF.implementationInstructions);
    expect(view.handoff?.architectProvenance).toBe('live');
    expect(view.handoffDigest).toBeTruthy();
    expect(view.architectReceipt?.model).toBe('gpt-test');
    expect(view.architectReceipt?.billingPath).toBe('api_billed');
    expect(view.architectReceipt?.networkPath).toBe('relay-bridge-direct-openai');
  });

  it('7 + 8. the exact persisted handoff is delivered to Claude Code, once', async () => {
    const h = harness();
    const { view } = await runMission(h);
    expect(h.calls.coding).toBe(1);
    expect(h.codingInput?.handoff.objective).toBe(view.handoff?.objective);
    expect(h.codingInput?.handoff.instructions).toEqual(view.handoff?.instructions);
    // Digest equality is the proof — not a reconstruction from UI state.
    expect(codingHandoffDigest(h.codingInput!.handoff)).toBe(view.handoffDigest);
  });
});

/* ----------------------------------------------------------- 9 – 13 */

describe('9-13. deterministic verification gates the independent review', () => {
  it('9 + 11. verification runs before Hermes, and Hermes runs exactly once', async () => {
    const h = harness();
    await runMission(h);
    expect(h.calls.reviewer).toBe(1);
    expect(h.order.indexOf('relay-verification')).toBeLessThan(h.order.indexOf('hermes'));
  });

  it('10. a failed verification prevents Hermes from launching and never retries Claude', async () => {
    const h = harness({ codingPassed: false });
    const { view } = await runMission(h, LIVE_ENV, 'm-verify-fail');
    expect(view.phase).toBe('verification_failed');
    expect(h.calls.reviewer).toBe(0);
    expect(h.calls.coding).toBe(1);
    // Evidence and terminal output are preserved, not discarded.
    expect(view.terminal?.lines.length).toBeGreaterThan(0);
    expect(view.claim).toBeDefined();
  });

  it('12. Hermes receives the exact current artifact digest and the full evidence packet', async () => {
    const h = harness();
    const { view } = await runMission(h);
    expect(h.reviewPacket?.artifactDigest).toBe(ARTIFACT_DIGEST);
    expect(view.artifactDigest).toBe(ARTIFACT_DIGEST);
    expect(h.reviewPacket?.missionRevision).toBe(view.missionRevision);
    expect(h.reviewPacket?.originalRequest).toContain('project-name normalization');
    expect(h.reviewPacket?.unifiedDiff).toContain('src/normalize.js');
    expect(h.reviewPacket?.testCommand).toBe('node --test test/normalize.test.js');
    expect(h.reviewPacket?.allowedFiles).toEqual(['src/normalize.js']);
  });

  it('13. the reviewer runs read-only: one-shot, --safe-mode, in an empty scratch cwd', async () => {
    const seen: { exe: string; args: string[]; cwd: string } = { exe: '', args: [], cwd: '' };
    const fakeSpawn = ((exe: string, args: string[], opts: { cwd: string }) => {
      seen.exe = exe;
      seen.args = args;
      seen.cwd = opts.cwd;
      const listeners: Record<string, (arg?: unknown) => void> = {};
      const child = {
        stdout: { on: (_e: string, cb: (c: Buffer) => void) => cb(Buffer.from(JSON.stringify({ verdict: 'approved', summary: 'ok', findings: [], requirementsChecked: [] }))) },
        stderr: { on: () => undefined },
        on: (event: string, cb: (arg?: unknown) => void) => {
          listeners[event] = cb;
          if (event === 'close') setTimeout(() => cb(0), 0);
        },
        kill: () => undefined,
      };
      return child as never;
    }) as never;

    const outcome = await runHermesReview({
      packet: {
        missionId: 'm1',
        originalRequest: 'req',
        handoffJson: '{}',
        baseRevision: 'rev1',
        artifactDigest: ARTIFACT_DIGEST,
        changedFiles: ['src/normalize.js'],
        unifiedDiff: 'diff',
        changedFileContents: 'content',
        testCommand: 'node --test',
        testOutput: 'ok',
        relayEvidence: ['tests passed'],
      },
      config: { executable: 'hermes', timeoutMs: 1000, maxOutputBytes: 1024 },
      now: () => AT,
      spawnImpl: fakeSpawn,
    });

    expect(outcome.kind).toBe('reviewed');
    expect(seen.args[0]).toBe('-z');
    expect(seen.args).toContain('--safe-mode');
    // The reviewer has no path into the controlled project.
    expect(seen.cwd).toContain('relay-hermes-review-');
    expect(seen.cwd).not.toContain('sunday-relay');
    // The prompt itself states the read-only rule.
    expect(seen.args[1]).toMatch(/no write access/i);
  });
});

/* ---------------------------------------------------------- 14 – 20 */

describe('14-20. only a genuine, current, approving review can complete the mission', () => {
  it('14. invalid Hermes output can never approve', async () => {
    const h = harness({
      reviewer: async () => ({
        kind: 'review_incomplete',
        safeMessage: 'The Hermes reviewer returned no valid structured review.',
        startedAt: AT,
        completedAt: AT,
      }),
    });
    const { view } = await runMission(h, LIVE_ENV, 'm-invalid-review');
    expect(view.phase).toBe('review_incomplete');
    expect(view.state).toBe('failed');
    expect(view.review).toBeUndefined();
  });

  it('a reviewer that never launches earns no credit', async () => {
    const h = harness({
      reviewer: async () => ({ kind: 'launch_failed', safeMessage: 'The Hermes reviewer could not be started.' }),
    });
    const { view } = await runMission(h, LIVE_ENV, 'm-review-launch');
    expect(view.phase).toBe('reviewer_launch_failed');
    const reviewer = view.attestations?.find((a) => a.role === 'reviewer');
    expect(reviewer?.launchVerified).toBe(false);
    expect(reviewer?.completionVerified).toBe(false);
  });

  it('15. a blocking finding produces review_blocked and never returns the task to Claude', async () => {
    const h = harness({
      reviewer: async () => ({
        kind: 'reviewed',
        startedAt: AT,
        completedAt: AT,
        provider: 'Anthropic',
        model: 'claude-opus-4-8',
        result: {
          verdict: 'approved',
          summary: 'Approved with a blocking caveat.',
          findings: [
            { findingId: 'F-1', severity: 'blocking', requirement: 'Edge cases', explanation: 'Empty input crashes.', evidence: 'line 3' },
          ],
          requirementsChecked: [],
        },
      }),
    });
    const { view } = await runMission(h, LIVE_ENV, 'm-blocked');
    expect(view.phase).toBe('review_blocked');
    expect(view.review?.findings[0].findingId).toBe('F-1');
    expect(h.calls.coding).toBe(1); // no repair dispatch
    expect(view.events.some((e) => e.findingId === 'F-1')).toBe(true);
  });

  const att = (role: ExecutionAttestation['role'], over: Partial<ExecutionAttestation> = {}): ExecutionAttestation =>
    buildAttestation({
      missionId: 'm1',
      missionRevision: 'rev_a',
      role,
      requestedActor: 'x',
      actualActor: 'x',
      requestedRuntime: 'r',
      actualRuntime: 'r',
      billingPath: 'subscription',
      launchVerified: true,
      completionVerified: true,
      fallbackOccurred: false,
      inputDigest: digest('in'),
      startedAt: AT,
      ...over,
    });
  const ALL = {
    prompt_architect: att('prompt_architect', { billingPath: 'api_billed' }),
    coding_agent: att('coding_agent'),
    reviewer: att('reviewer'),
  };
  const BASE = {
    requiresIndependentReview: true as const,
    missionRevision: 'rev_a',
    handoffStored: true,
    handoffDeliveredAutomatically: true,
    persistedHandoffDigest: 'h1',
    deliveredHandoffDigest: 'h1',
    scopePreserved: true,
    deterministicTestsPassed: true,
    protectedPathsUntouched: true,
    reviewerApproved: true,
    blockingFindings: 0,
    reviewedArtifactDigest: 'd1',
    currentArtifactDigest: 'd1',
  };

  it('16. Hermes approval is insufficient without deterministic evidence', () => {
    expect(decideCompletion({ attestations: ALL, ...BASE, deterministicTestsPassed: false }).state).toBe(
      'verification_failed',
    );
    expect(decideCompletion({ attestations: ALL, ...BASE, scopePreserved: false }).state).toBe('verification_failed');
  });

  it('17. passing tests are insufficient without Hermes approval', () => {
    expect(decideCompletion({ attestations: ALL, ...BASE, reviewerApproved: false }).state).toBe('review_blocked');
    expect(decideCompletion({ attestations: ALL, ...BASE, blockingFindings: 1 }).state).toBe('review_blocked');
    const { reviewer: _drop, ...noReviewer } = ALL;
    expect(decideCompletion({ attestations: noReviewer, ...BASE }).state).toBe('reviewer_launch_failed');
  });

  it('18. all three genuine attestations are required, and a fallback satisfies nothing', async () => {
    const h = harness();
    const { view } = await runMission(h);
    const roles = (view.attestations ?? []).map((a) => a.role).sort();
    expect(roles).toEqual(['coding_agent', 'prompt_architect', 'reviewer']);
    expect((view.attestations ?? []).every((a) => a.launchVerified && a.completionVerified && !a.fallbackOccurred)).toBe(true);
    expect(
      decideCompletion({
        attestations: { ...ALL, prompt_architect: att('prompt_architect', { fallbackOccurred: true }) },
        ...BASE,
      }).state,
    ).toBe('verification_failed');
  });

  it('19. the live path requires an independent review — the coding leg cannot self-complete', async () => {
    const h = harness();
    await runMission(h);
    expect(h.codingInput?.requiresIndependentReview).toBe(true);
    // The authority defaults to requiring review: omitting the reviewer fails.
    const { reviewer: _drop, ...noReviewer } = ALL;
    const { requiresIndependentReview: _flag, ...noFlag } = BASE;
    expect(decideCompletion({ attestations: noReviewer, ...noFlag }).state).toBe('reviewer_launch_failed');
  });

  it('20. a stale review can never complete the mission', () => {
    expect(decideCompletion({ attestations: ALL, ...BASE, currentArtifactDigest: 'd2' }).state).toBe('review_incomplete');
    expect(decideCompletion({ attestations: ALL, ...BASE, reviewedArtifactDigest: undefined }).state).toBe(
      'review_incomplete',
    );
    // A role attested against a different mission revision is rejected.
    expect(
      decideCompletion({
        attestations: { ...ALL, reviewer: att('reviewer', { missionRevision: 'rev_b' }) },
        ...BASE,
      }).state,
    ).toBe('verification_failed');
  });
});

/* ---------------------------------------------------------- 21 – 26 */

describe('21-26. refresh, duplicate dispatch, uncertainty, and cancellation', () => {
  it('21 + 22 + 23. a refresh (repeat poll + repeat start) never repeats a completed role', async () => {
    const h = harness();
    const { reg, view } = await runMission(h, LIVE_ENV, 'm-refresh');
    expect(view.state).toBe('verified_complete');

    for (let i = 0; i < 5; i++) reg.get('m-refresh');
    reg.start({ missionId: 'm-refresh', objective: 'Create a production-safe project-name normalization utility.' });
    await new Promise((r) => setTimeout(r, 25));

    expect(h.calls.architect).toBe(1);
    expect(h.calls.coding).toBe(1);
    expect(h.calls.reviewer).toBe(1);
    const after = reg.get('m-refresh');
    expect(after?.state).toBe('verified_complete');
    expect(after?.events.length).toBe(view.events.length);
  });

  it('24. duplicate POSTs do not duplicate role calls', async () => {
    const h = harness();
    const reg = registry(h);
    reg.start({ missionId: 'm-dupe', objective: 'Create a production-safe project-name normalization utility.' });
    reg.start({ missionId: 'm-dupe', objective: 'Create a production-safe project-name normalization utility.' });
    reg.start({ missionId: 'm-dupe', objective: 'Create a production-safe project-name normalization utility.' });
    const view = await settle(reg, 'm-dupe');
    expect(view.state).toBe('verified_complete');
    expect(h.calls.architect).toBe(1);
    expect(h.calls.coding).toBe(1);
    expect(h.calls.reviewer).toBe(1);
  });

  it('25. an uncertain dispatch is never retried automatically', async () => {
    const h = harness({
      coding: async () => {
        throw new Error('the process vanished mid-dispatch');
      },
    });
    const reg = registry(h);
    reg.start({ missionId: 'm-uncertain', objective: 'Create a production-safe project-name normalization utility.' });
    const first = await settle(reg, 'm-uncertain');
    expect(first.state).toBe('failed');
    expect(h.calls.coding).toBe(1);

    // An explicit founder retry finds the dispatch outcome unknown and stops
    // there — it never redispatches the coding agent on its own.
    reg.retry('m-uncertain');
    const second = await settle(reg, 'm-uncertain');
    expect(second.phase).toBe('dispatch_status_uncertain');
    expect(second.error?.retryable).toBe(false);
    expect(h.calls.coding).toBe(1);
    expect(h.calls.reviewer).toBe(0);
  });

  it('26. cancellation prevents the next role from starting and preserves what ran', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const h = harness({
      coding: async (self) => {
        await gate;
        return {
          ...goodCodingOutcome('x', self.codingInput?.missionRevision ?? ''),
          cancelled: true,
          stopped: true,
          stopReason: 'The coding agent was cancelled.',
        };
      },
    });
    const reg = registry(h);
    reg.start({ missionId: 'm-cancel', objective: 'Create a production-safe project-name normalization utility.' });
    await new Promise((r) => setTimeout(r, 20));
    reg.cancel('m-cancel');
    release();
    const view = await settle(reg, 'm-cancel');

    expect(view.state).toBe('cancelled');
    expect(view.phase).toBe('cancelled');
    expect(h.calls.reviewer).toBe(0);
    // Completed roles and captured output survive the cancellation.
    expect(view.attestations?.some((a) => a.role === 'prompt_architect')).toBe(true);
    expect(view.handoff).toBeDefined();
    expect(view.terminal?.lines.length).toBeGreaterThan(0);
  });
});

/* ---------------------------------------------------------- 27 – 30 */

describe('27-30. console events, secrecy, terminal regression, and reviewer billing', () => {
  it('27. mission events stay ordered and cover the whole three-role sequence', async () => {
    const h = harness();
    const { view } = await runMission(h, LIVE_ENV, 'm-events');
    expect(view.events.map((e) => e.sequence)).toEqual(view.events.map((_, i) => i));
    for (let i = 1; i < view.events.length; i++) {
      expect(Date.parse(view.events[i].at)).toBeGreaterThanOrEqual(Date.parse(view.events[i - 1].at));
    }
    const headlines = view.events.map((e) => e.headline).join('\n');
    for (const expected of [
      /Preflight started/,
      /Preflight passed/,
      /Prompt Architect dispatch prepared/,
      /OpenAI request started/,
      /OpenAI response received/,
      /Handoff validated/,
      /Handoff persisted/,
      /Coding Agent assignment created/,
      /Relay verification passed/,
      /Artifact digest created/,
      /Reviewer assignment created/,
      /Hermes launched/,
      /Hermes response received/,
      /Review validated/,
      /Completion decision started/,
      /MISSION VERIFIED/,
    ]) {
      expect(headlines).toMatch(expected);
    }
    // Every event carries its mission revision, and references are safe.
    expect(view.events.every((e) => e.missionRevision === view.missionRevision)).toBe(true);
    expect(view.events.some((e) => e.artifactRef === ARTIFACT_DIGEST)).toBe(true);
    expect(view.events.some((e) => typeof e.attestationRef === 'string')).toBe(true);
  });

  it('28. no credential or raw provider identifier is serialized to the browser', async () => {
    const h = harness();
    const { view } = await runMission(h, LIVE_ENV, 'm-secrets');
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain('sk-test-value-never-serialized');
    expect(serialized).not.toContain('OPENAI_API_KEY=');
    expect(serialized).not.toMatch(/sk-[A-Za-z0-9_-]{16,}/);
    expect(serialized).not.toContain('chatcmpl-');
  });

  it('29. the existing Coding Agent terminal still renders from the mission view', async () => {
    const h = harness();
    const { view } = await runMission(h, LIVE_ENV, 'm-terminal');
    const rendered = buildCodingTerminalView({ terminal: view.terminal, phase: 'complete' });
    expect(rendered.present).toBe(true);
    expect(rendered.statusLabel).toBe('COMPLETE');
    expect(rendered.changedFiles).toEqual(['src/normalize.js']);
    expect(rendered.test?.status).toBe('passed');
    expect(rendered.attested).toBe(true);
    expect(rendered.lines.map((l) => l.sequence)).toEqual(rendered.lines.map((_, i) => i));
  });

  it('30. Hermes subscription billing is reported and never blocks completion', async () => {
    const h = harness();
    const { view } = await runMission(h, LIVE_ENV, 'm-billing');
    expect(view.state).toBe('verified_complete');
    const reviewer = view.attestations?.find((a) => a.role === 'reviewer');
    expect(reviewer?.billingPath).toBe('subscription');
    expect(view.review?.billing).toBe('subscription');
    expect(view.review?.provider).toBe('Anthropic');
    expect(view.review?.model).toBe('claude-opus-4-8');
    expect(view.error).toBeUndefined();
  });
});

/* -------------------------------------------------- reviewer preflight */

describe('the reviewer preflight proves availability without consuming a review', () => {
  it('reads the real execution configuration from local probes only', () => {
    const help = 'usage: hermes [-h] [-z PROMPT] [--safe-mode] [--provider PROVIDER]';
    const status = [
      '◆ Environment',
      '  Model:        claude-opus-4-8',
      '  Provider:     Anthropic',
      '◆ Auth Providers',
      '  Nous Portal   ✓ logged in',
      '  OpenAI Codex  ✗ not logged in',
    ].join('\n');
    const probe = (_exe: string, args: string[]) => ({
      ok: true,
      text: args[0] === '--help' ? help : status,
    });
    const result = hermesPreflight(
      { executable: 'hermes', timeoutMs: 1000, maxOutputBytes: 1024 },
      { probe },
    );
    expect(result.ready).toBe(true);
    expect(result.oneShotSupported).toBe(true);
    expect(result.readOnlySupported).toBe(true);
    expect(result.model).toBe('claude-opus-4-8');
    expect(result.provider).toBe('Anthropic');
    expect(result.billingPath).toBe('subscription');
    expect(parseHermesStatus(status).authenticatedProviders).toContain('Nous Portal');
  });

  it('an unrunnable or unauthenticated reviewer is reported as unavailable', () => {
    const dead = hermesPreflight(
      { executable: 'hermes', timeoutMs: 1000, maxOutputBytes: 1024 },
      { probe: () => ({ ok: false, text: '' }) },
    );
    expect(dead.ready).toBe(false);
    expect(dead.reason).toMatch(/not available/i);
    expect(dead.missing.join(' ')).toContain('hermes executable');
  });
});
