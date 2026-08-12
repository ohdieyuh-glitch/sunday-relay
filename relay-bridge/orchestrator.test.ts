import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMissionRegistry, selectArchitectPath } from './mission';
import { resolveRoleSlots } from './role-slot-config';
import { LIFECYCLE_SERVING } from '../relay-hermes-service/service';
import type { MissionRoleDeps } from './mission';
import { buildAttestation, decideCompletion, declaredBillingPath, digest, isPaidApiCall, occupantBillingPath } from './attestation';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROLE_OCCUPANTS } from '../src/relay/mission/role-slots';
import {
  createRepositoryRegistration,
  resolveRepositoryTarget,
} from '../src/relay/mission/repository-target';
import type { ExecutionAttestation } from './attestation';
import {
  runHermesReview,
  hermesPreflight,
  parseHermesStatus,
  classifyHermesUpstreamFailure,
  validateHermesReview,
  escapeInvalidJsonEscapes,
} from './hermes-reviewer';
import type { HermesOutcome, ReviewPacket } from './hermes-reviewer';
import { normalizeObservation } from '../src/relay/mission/evidence';
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
  OPENAI_API_KEY: 'sk-FAKETESTNOTREAL-never-served', // relay-boundary:allow-fixture — synthetic, asserts it is never serialized
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
    requestedModel: 'gpt-test',
    // A fixture that names the SAME model for both would hide a mismatch, so
    // the returned identity is deliberately the dated variant a provider sends.
    actualModel: 'gpt-test-2026-01-01',
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
/** What a repaired implementation hashes to: different bytes, different digest. */
const REPAIRED_ARTIFACT_DIGEST = digest('artifact-v2-repaired');

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
      actualActor: 'Claude Code',
      actualRuntime: 'claude-code-local',
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

/**
 * `artifactDigest` FOLLOWS THE ARTIFACT, because in production it must.
 *
 * Every run of this harness returned the single constant `ARTIFACT_DIGEST`, so
 * a repaired implementation was indistinguishable from the one it replaced —
 * and the completion engine's staleness check (reviewed digest vs current
 * digest) was satisfied by an accident of the fixture. The repair-completes
 * test passed for years of runs against code that refused every real repair
 * with "The artifact changed after review; the review is stale".
 *
 * A repair is a different artifact. The fixture now says so.
 */
function goodCodingOutcome(
  handoffDigest: string,
  missionRevision: string,
  passed = true,
  artifactDigest: string = ARTIFACT_DIGEST,
): CodingOutcome {
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
    retainedWorktreePath: null,
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
      claimedFileContent: 'export function normalizeProjectName() {}',
    changedFileContents: 'function normalizeProjectName(){}',
      artifactDigest,
      relayEvidence: ['Relay inspection assessment: allowed'],
    },
  };
}

const approvedReview = (): HermesOutcome => ({
  kind: 'reviewed',
  startedAt: AT,
  completedAt: AT,
  provider: 'Anthropic',
  requestedModel: 'claude-opus-4-8',
  servedModel: 'claude-opus-4-8',
  result: {
    verdict: 'approved',
    summary: 'The implementation satisfies every acceptance criterion.',
    findings: [],
    requirementsChecked: [{ requirement: 'Existing tests pass', status: 'passed', evidence: 'Relay ran the tests.' }],
    parseRepaired: false,
  },
});

/* ------------------------------------------------------------ harness */

interface Harness {
  calls: { architect: number; fusion: number; coding: number; reviewer: number; hermesPreflight: number; runtime: number };
  order: string[];
  codingInput: Parameters<NonNullable<MissionRoleDeps['runCodingMission']>>[0] | null;
  reviewPacket: ReviewPacket | null;
  /** The contract the Prompt Architect was actually handed. */
  architectContract: { liveEvidence?: string[] } | null;
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
    architectContract: null,
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
            missing: ['hermes provider authentication (the configured provider rejected the reviewer credential)'],
            reason: 'The Hermes reviewer is not available. Missing: hermes provider authentication.',
            executable: 'hermes',
            oneShotSupported: true,
            readOnlySupported: true,
            model: null,
            provider: null,
            authenticatedProviders: [],
            livenessVerified: false,
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
            livenessVerified: true,
            billingPath: 'subscription',
          };
    },
    runOpenAiArchitect: async (contract) => {
      h.calls.architect += 1;
      h.order.push('openai');
      h.architectContract = contract as { liveEvidence?: string[] };
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
        // A REPAIR CHANGES THE BYTES, so it changes the digest. Keyed on the
        // revision input rather than a call counter, because it is the repair
        // that makes it different, not the fact that it is the second run.
        input.revision === undefined ? ARTIFACT_DIGEST : REPAIRED_ARTIFACT_DIGEST,
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

function registry(h: Harness, env: NodeJS.ProcessEnv = LIVE_ENV, claudeMode: 'live' | 'fake' = 'fake') {
  return createMissionRegistry({
    fusionBaseUrl: 'http://localhost:3000',
    sundayMode: 'fast',
    /**
     * `fake` for almost everything: the runtime resolver is injected, so this
     * only decides which OCCUPANT the mission binds. A test that needs to
     * exercise a real coding occupant asks for `live`, and still contacts
     * nothing — the resolver is a stub either way.
     */
    claudeMode,
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

async function runMission(
  h: Harness, env: NodeJS.ProcessEnv = LIVE_ENV, missionId = 'm-orc',
  claudeMode: 'live' | 'fake' = 'fake',
) {
  const reg = registry(h, env, claudeMode);
  reg.start({ missionId, objective: 'Create a production-safe project-name normalization utility.' });
  const view = await settle(reg, missionId);
  return { reg, view };
}

/**
 * THIS FILE'S MISSIONS RUN ON A FOUNDER MACHINE, AND SAY SO.
 *
 * `isProductionDeployment` is one-way and reads the real process environment,
 * which is correct — a host must not be talkable out of being production. The
 * cost is that a developer with `NODE_ENV=production` exported would otherwise
 * see two dozen failures here with no connection to what they changed. The
 * assumption is stated instead of inherited; the one test that WANTS a
 * production host sets its marker itself.
 */
const HOST_MARKERS = [
  'NODE_ENV', 'RAILWAY_ENVIRONMENT', 'RAILWAY_ENVIRONMENT_NAME', 'RAILWAY_SERVICE_ID',
] as const;
const savedHostMarkers = new Map<string, string | undefined>();

const originalFetch = globalThis.fetch;
beforeEach(() => {
  for (const name of HOST_MARKERS) {
    savedHostMarkers.set(name, process.env[name]);
    delete process.env[name];
  }
  globalThis.fetch = vi.fn(async () => {
    throw new Error('no network call may happen in an orchestrator test');
  }) as unknown as typeof fetch;
});
afterEach(() => {
  for (const [name, value] of savedHostMarkers) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  savedHostMarkers.clear();
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
    /**
     * REQUESTED AND SERVED, BOTH ON THE WIRE. The fixture's provider answers
     * with a dated variant, so these two strings genuinely differ — which is
     * how this asserts the receipt carries what ANSWERED and not merely what
     * was configured. The single `model` field this replaced held `gpt-test`.
     */
    expect(view.architectReceipt?.requestedModel).toBe('gpt-test');
    expect(view.architectReceipt?.servedModel).toBe('gpt-test-2026-01-01');
    // And the label the founder reads in the Live Terminal names the model
    // that answered. It used to name `gpt-test`.
    expect(view.handoff?.architectLabel).toBe('ChatGPT · gpt-test-2026-01-01');
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

  /**
   * WHAT THE REVIEW COST, ACCORDING TO THE OCCUPANT THAT RAN.
   *
   * Every hosted review has attested `subscription` — a literal written into
   * the reviewer leg — while the occupant Relay actually binds is registered
   * `billingPath: 'api'` and reviews on an xAI API key. The attestation
   * contradicted the registry entry for the very occupant it names, in the
   * direction that hides cost, and `isPaidApiCall` tests `api_billed`, so
   * every real review was also invisible to Relay's own accounting.
   *
   * The coding leg had always derived this from its occupant. The reviewer leg
   * asserted it. Both now use one translation, which is why these assert the
   * two legs AGREE rather than checking one of them.
   */
  it('attests the review against the bound occupant, not a literal', async () => {
    const h = harness();
    const { view } = await runMission(h, LIVE_ENV, 'm-review-billing');
    const reviewer = view.attestations?.find((a) => a.role === 'reviewer');
    expect(reviewer).toBeDefined();
    // The bound occupant is registered `api`, so the attestation must say so.
    expect(reviewer?.billingPath).toBe('api_billed');
    // The founder-facing review card must not disagree with the attestation
    // beside it, which is how one of them stayed wrong for so long.
    expect(view.review?.billing).toBe('api_billed');
    /**
     * And the accounting must now count it. `isPaidApiCall` keys on exactly
     * this value, so while the reviewer attested `subscription` every real
     * review was invisible to Relay's own record of what a mission spent.
     */
    expect(isPaidApiCall(buildAttestation({
      missionId: 'm-review-billing',
      role: 'reviewer',
      requestedActor: 'Hermes',
      actualActor: 'Hermes',
      requestedRuntime: 'hermes-agent-cli',
      actualRuntime: 'hermes-agent-cli',
      billingPath: reviewer!.billingPath,
      launchVerified: true,
      completionVerified: true,
      fallbackOccurred: false,
      inputDigest: 'sha256:probe',
      startedAt: AT,
      completedAt: AT,
    }))).toBe(true);
  });

  it('no registered Reviewer is subscription-billed, so the old literal could not have been right for any of them', () => {
    /**
     * The reason this was a defect rather than a mismatched default: there is
     * no Reviewer occupant the discarded literal described. Asserted against
     * the registry so that adding a genuinely subscription-billed Reviewer one
     * day fails here and gets read, rather than silently making a removed bug
     * look like it had been correct.
     */
    const reviewers = ROLE_OCCUPANTS.filter((o) => o.role === 'reviewer');
    expect(reviewers.length).toBeGreaterThan(0);
    for (const o of reviewers) {
      expect(occupantBillingPath(o.billingPath)).not.toBe('subscription');
    }
  });

  it('an unresolvable occupant bills as unknown, never as the cheaper answer', () => {
    // Unknown is not zero, and it is not "free" either.
    expect(occupantBillingPath(undefined)).toBe('unknown');
  });

  describe('RELAY_HERMES_BILLING_MODE, which was documented and then ignored', () => {
    /**
     * `.env.example` has always offered this variable under "the reviewer's
     * provider, model and billing mode are separate facts and must each be
     * reported truthfully. Do not infer billing" — and nothing read it. An
     * operator who set it correctly still got the literal.
     */
    it('is unset by default, so the registry decides', () => {
      expect(declaredBillingPath(undefined)).toBeNull();
      expect(declaredBillingPath('')).toBeNull();
      expect(declaredBillingPath('   ')).toBeNull();
    });

    it('carries every mode the documentation offers', () => {
      // Read from the file that makes the promise, so a mode documented and
      // not implemented fails here instead of silently reading as unknown.
      const documented = readFileSync('.env.example', 'utf8')
        .split('\n')
        .find((l) => l.includes('api_billed | subscription'));
      expect(documented).toBeDefined();
      const modes = (documented ?? '').replace('#', '').split('|').map((m) => m.trim()).filter(Boolean);
      expect(modes.length).toBeGreaterThan(3);
      for (const mode of modes) {
        // `unknown` is the one that is also the fallback; every other
        // documented mode must survive the round trip as itself.
        expect(declaredBillingPath(mode)).toBe(mode);
      }
    });

    it('reads a misspelling as unknown rather than ignoring it', () => {
      /**
       * A typo must not silently fall through to the registry and read as
       * agreement. The operator said something Relay could not understand,
       * and that is a different fact from them having said nothing.
       */
      expect(declaredBillingPath('subscribtion')).toBe('unknown');
      expect(declaredBillingPath('free')).toBe('unknown');
    });

    it('outranks the registry, because the operator knows their own account', async () => {
      const h = harness();
      const { view } = await runMission(
        h,
        { ...LIVE_ENV, RELAY_HERMES_BILLING_MODE: 'subscription' },
        'm-billing-declared',
      );
      const reviewer = view.attestations?.find((a) => a.role === 'reviewer');
      // The occupant is registered `api`; the operator says they pay by
      // subscription. Relay reports what they said, not what it assumed.
      expect(reviewer?.billingPath).toBe('subscription');
      expect(view.review?.billing).toBe('subscription');
    });
  });

  it('15. a blocking finding produces review_blocked and never returns the task to Claude', async () => {
    const h = harness({
      reviewer: async () => ({
        kind: 'reviewed',
        startedAt: AT,
        completedAt: AT,
        provider: 'Anthropic',
        requestedModel: 'claude-opus-4-8',
        servedModel: 'claude-opus-4-8',
        result: {
          verdict: 'approved',
          summary: 'Approved with a blocking caveat.',
          findings: [
            { findingId: 'F-1', severity: 'blocking', requirement: 'Edge cases', explanation: 'Empty input crashes.', evidence: 'line 3' },
          ],
          requirementsChecked: [],
          parseRepaired: false,
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
    retainedWorktreePath: null,
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

  it('30. Hermes billing is reported from the occupant and never blocks completion', async () => {
    /**
     * THIS TEST USED TO PIN THE DEFECT. It asserted `subscription` on both the
     * attestation and the review card, and it passed for as long as the code
     * hard-coded that literal — so the suite agreed with a claim the registry
     * had already contradicted, and the disagreement could only be found by
     * reading the two files side by side.
     *
     * Its real subject is the second half, which is unchanged: whatever the
     * review cost, it never blocks a completion. The billing values now come
     * from the bound occupant instead of from this file's expectations.
     */
    const h = harness();
    const { view } = await runMission(h, LIVE_ENV, 'm-billing');
    expect(view.state).toBe('verified_complete');
    const reviewer = view.attestations?.find((a) => a.role === 'reviewer');
    expect(reviewer?.billingPath).toBe('api_billed');
    expect(view.review?.billing).toBe('api_billed');
    expect(view.review?.provider).toBe('Anthropic');
    expect(view.review?.servedModel).toBe('claude-opus-4-8');
    expect(view.review?.requestedModel).toBe('claude-opus-4-8');
    expect(view.error).toBeUndefined();
  });
});

/* -------------------------------------------------- reviewer preflight */

/**
 * The REAL binary's flags, including `--usage-file`.
 *
 * This fixture predated the reviewer asking Hermes what model actually answered.
 * `hermesPreflight` now requires `--usage-file` in the help text — a build
 * without it cannot attest a served model, and discovering that as "the probe
 * produced no output" sends an operator to look at the model, the credential and
 * the prompt, none of which is the problem. Verified against
 * `hermes --help` on Hermes Agent 0.18.2, which lists `[--usage-file PATH]`.
 */
const PREFLIGHT_HELP =
  'usage: hermes [-h] [-z PROMPT] [--safe-mode] [--provider PROVIDER] [--usage-file PATH]';
const PREFLIGHT_STATUS = [
  '◆ Environment',
  '  Model:        claude-opus-4-8',
  '  Provider:     Anthropic',
  '◆ Auth Providers',
  '  Nous Portal   ✓ logged in',
  '  OpenAI Codex  ✗ not logged in',
].join('\n');

/** A probe whose one-shot (`-z`) answer the test chooses. */
const probeWithLiveness = (livenessText: string, seen?: { args: string[][] }) =>
  (_exe: string, args: string[]) => {
    seen?.args.push(args);
    if (args[0] === '--help') return { ok: true, text: PREFLIGHT_HELP };
    if (args[0] === 'status') return { ok: true, text: PREFLIGHT_STATUS };
    return { ok: true, text: livenessText };
  };

describe('the reviewer preflight proves the reviewer can actually answer', () => {
  it('refuses a hermes that cannot report its served model, and names the flag', () => {
    /**
     * The mission and the probe both pass `--usage-file`. A build without it
     * cannot attest which model reviewed — the whole point of defect 3 — and
     * without this gate it failed the probe as "produced no output", which sends
     * an operator to look at the model, the credential and the prompt, none of
     * which is the problem. A re-review found the missing gate.
     */
    const oldHelp = 'usage: hermes [-h] [-z PROMPT] [--safe-mode] [--provider PROVIDER]';
    const result = hermesPreflight(
      { executable: 'hermes', timeoutMs: 1000, maxOutputBytes: 4096, model: 'grok-4', provider: 'xai' },
      {
        probe: (_exe: string, args: string[]) => {
          if (args[0] === '--help') return { ok: true, text: oldHelp };
          if (args[0] === 'status') return { ok: true, text: PREFLIGHT_STATUS };
          return { ok: true, text: 'APPROVED' };
        },
      },
    );
    expect(result.ready).toBe(false);
    expect(result.missing.join(' ')).toContain('--usage-file');
    // And NOT the misleading message the absence used to produce.
    expect(result.missing.join(' ')).not.toContain('produced no output');
  });

  it('reads the real execution configuration and confirms liveness', () => {
    const seen = { args: [] as string[][] };
    const result = hermesPreflight(
      { executable: 'hermes', timeoutMs: 1000, maxOutputBytes: 1024 },
      { probe: probeWithLiveness('OK', seen) },
    );
    expect(result.ready).toBe(true);
    expect(result.oneShotSupported).toBe(true);
    expect(result.readOnlySupported).toBe(true);
    expect(result.model).toBe('claude-opus-4-8');
    expect(result.provider).toBe('Anthropic');
    /**
     * `unknown`, and this asserted `subscription`. A Hermes authenticated by
     * API key prints no "logged in" line at all, so the probe cannot tell the
     * two apart — it was answering a question it has no way to observe, and
     * this assertion made that look verified. Provider and model above are
     * genuinely read from the configuration; billing is not.
     */
    expect(result.billingPath).toBe('unknown');
    expect(result.livenessVerified).toBe(true);
    expect(parseHermesStatus(PREFLIGHT_STATUS).authenticatedProviders).toContain('Nous Portal');

    // The liveness probe must exercise the SAME path the review will take.
    const liveness = seen.args.find((a) => a[0] === '-z');
    expect(liveness).toBeDefined();
    expect(liveness).toContain('--safe-mode');
  });

  it('an unrunnable reviewer is reported as unavailable, and is not asked to answer', () => {
    const seen = { args: [] as string[][] };
    const dead = hermesPreflight(
      { executable: 'hermes', timeoutMs: 1000, maxOutputBytes: 1024 },
      {
        probe: (_exe: string, args: string[]) => {
          seen.args.push(args);
          return { ok: false, text: '' };
        },
      },
    );
    expect(dead.ready).toBe(false);
    expect(dead.reason).toMatch(/not available/i);
    expect(dead.missing.join(' ')).toContain('hermes executable');
    expect(dead.livenessVerified).toBe(false);
    // No spawn is spent asking a missing executable to generate anything.
    expect(seen.args.some((a) => a[0] === '-z')).toBe(false);
  });

  /**
   * THE REGRESSION. This exact output — exit 0, HTTP 400, "Incorrect API key"
   * — passed preflight in production and cost a metered Prompt Architect call
   * and a full Coding Agent run before the reviewer was found to be dead.
   */
  it('a present-but-rejected credential fails preflight instead of passing it', () => {
    const result = hermesPreflight(
      { executable: 'hermes', timeoutMs: 1000, maxOutputBytes: 1024 },
      {
        probe: probeWithLiveness(
          'HTTP 400: {"code":"invalid-argument","error":"Incorrect API key provided. '
          + 'You can obtain an API key from https://console.x.ai."}',
        ),
      },
    );
    expect(result.ready).toBe(false);
    expect(result.livenessVerified).toBe(false);
    expect(result.missing.join(' ')).toContain('provider authentication');
  });

  it('a reviewer that answers nothing at all is not ready', () => {
    const result = hermesPreflight(
      { executable: 'hermes', timeoutMs: 1000, maxOutputBytes: 1024 },
      { probe: probeWithLiveness('   \n  ') },
    );
    expect(result.ready).toBe(false);
    expect(result.missing.join(' ')).toContain('no output');
  });

  /**
   * A Hermes authenticated by API KEY has no "logged in" line anywhere, and a
   * logged-in unrelated service is not evidence about the model provider. The
   * old gate treated both as authentication, which is how a dead key passed.
   */
  it('readiness comes from the liveness answer, not from who is logged in', () => {
    const noLogins = (_exe: string, args: string[]) => {
      if (args[0] === '--help') return { ok: true, text: PREFLIGHT_HELP };
      if (args[0] === 'status') {
        return { ok: true, text: '◆ Environment\n  Model:        grok-4.3\n  Provider:     xAI' };
      }
      return { ok: true, text: 'OK' };
    };
    const result = hermesPreflight(
      { executable: 'hermes', timeoutMs: 1000, maxOutputBytes: 1024 },
      { probe: noLogins },
    );
    expect(result.authenticatedProviders).toEqual([]);
    expect(result.livenessVerified).toBe(true);
    expect(result.ready).toBe(true);
  });

  it('classifies upstream failures without repeating the vendor body', () => {
    const auth = classifyHermesUpstreamFailure('HTTP 400: {"error":"Incorrect API key provided."}');
    expect(auth).toEqual({ kind: 'authentication', status: 400 });
    expect(classifyHermesUpstreamFailure('HTTP 401: {"error":"nope"}')?.kind).toBe('authentication');
    expect(classifyHermesUpstreamFailure('HTTP 503: {"error":"overloaded"}'))
      .toEqual({ kind: 'upstream', status: 503 });
    // A real review that merely mentions the words is not an upstream failure.
    expect(classifyHermesUpstreamFailure('{"verdict":"approved","summary":"checked the api key handling"}'))
      .toBeNull();
  });
});

describe('a review that quotes code still parses, without loosening validation', () => {
  /** The exact shape the real reviewer produced: a regex pasted into evidence. */
  const QUOTED_REGEX_REVIEW =
    '{"verdict":"approved","summary":"Implementation satisfies the acceptance criteria.",'
    + '"findings":[],"requirementsChecked":[{"requirement":"Collapse repeated hyphens.",'
    + '"status":"passed","evidence":"Code: .replace(/[\\s_]+/g, \'-\').replace(/-+/g, \'-\')"}]}';

  it('recovers the review the reviewer actually wrote', () => {
    // Precondition: this is genuinely invalid JSON, not a test that proves nothing.
    expect(() => JSON.parse(QUOTED_REGEX_REVIEW)).toThrow();

    const parsed = validateHermesReview(QUOTED_REGEX_REVIEW);
    expect(parsed).not.toBeNull();
    expect(parsed?.verdict).toBe('approved');
    expect(parsed?.requirementsChecked[0]?.status).toBe('passed');
    // The backslash was the reviewer's intent, and it survives as one.
    expect(parsed?.requirementsChecked[0]?.evidence).toContain('[\\s_]+');
    expect(parsed?.parseRepaired).toBe(true);
  });

  it('valid output is not touched, and is not reported as repaired', () => {
    const clean = validateHermesReview(
      '{"verdict":"changes_required","summary":"no","findings":[],"requirementsChecked":[]}',
    );
    expect(clean?.verdict).toBe('changes_required');
    expect(clean?.parseRepaired).toBe(false);
  });

  it('the repair cannot manufacture a verdict', () => {
    // Escapes repaired, but the verdict is still not one Relay accepts.
    expect(validateHermesReview(
      '{"verdict":"looks-good","summary":"s","findings":[],"requirementsChecked":[{"evidence":"\\s"}]}',
    )).toBeNull();
    // A missing summary is still fatal after a repair.
    expect(validateHermesReview('{"verdict":"approved","summary":"","findings":[],"x":"\\s"}'))
      .toBeNull();
  });

  it('the repair cannot rescue truncated or structurally broken output', () => {
    // Cut mid-string: braces unbalanced, so no repair can close it.
    expect(validateHermesReview('{"verdict":"approved","summary":"it was fine and the \\s')).toBeNull();
    expect(validateHermesReview('not a review at all')).toBeNull();
    expect(validateHermesReview('')).toBeNull();
  });

  it('escapes only what JSON does not define', () => {
    // Valid escapes pass through untouched — including an already-escaped pair.
    expect(escapeInvalidJsonEscapes('a\\nb\\"c\\\\d')).toBe('a\\nb\\"c\\\\d');
    // \s is not a JSON escape, so the backslash becomes a literal one.
    expect(escapeInvalidJsonEscapes('\\s')).toBe('\\\\s');
    // An escaped backslash followed by s must NOT be double-processed.
    expect(escapeInvalidJsonEscapes('\\\\s')).toBe('\\\\s');
  });
});

describe('a reviewer that cannot authenticate says so', () => {
  const spawnReturning = (text: string, code: number) => ((
    _exe: string,
    _args: string[],
    _opts: { cwd: string },
  ) => {
    const child = {
      stdout: { on: (_e: string, cb: (c: Buffer) => void) => cb(Buffer.from(text)) },
      stderr: { on: () => undefined },
      on: (event: string, cb: (arg?: unknown) => void) => {
        if (event === 'close') setTimeout(() => cb(code), 0);
      },
      kill: () => undefined,
    };
    return child as never;
  }) as never;

  const packet = {
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
  };

  it('reports a rejected credential rather than a malformed review', async () => {
    const outcome = await runHermesReview({
      packet,
      config: { executable: 'hermes', timeoutMs: 1000, maxOutputBytes: 4096 },
      now: () => AT,
      spawnImpl: spawnReturning(
        'HTTP 400: {"code":"invalid-argument","error":"Incorrect API key provided."}',
        0,
      ),
    });
    expect(outcome.kind).toBe('review_incomplete');
    if (outcome.kind !== 'review_incomplete') throw new Error('unreachable');
    expect(outcome.safeMessage).toMatch(/could not authenticate/i);
    // The vendor's body is classified, never echoed.
    expect(outcome.safeMessage).not.toContain('console.x.ai');
    expect(outcome.safeMessage).not.toMatch(/no valid structured review/i);
  });

  it('still reports a genuinely malformed review as malformed', async () => {
    const outcome = await runHermesReview({
      packet,
      config: { executable: 'hermes', timeoutMs: 1000, maxOutputBytes: 4096 },
      now: () => AT,
      spawnImpl: spawnReturning('I have reviewed it and it looks fine to me.', 0),
    });
    expect(outcome.kind).toBe('review_incomplete');
    if (outcome.kind !== 'review_incomplete') throw new Error('unreachable');
    expect(outcome.safeMessage).toMatch(/no valid structured review/i);
  });
});

/**
 * ROLE SLOTS AT THE MISSION BOUNDARY.
 *
 * The registry is pure domain and has its own tests. What these prove is that
 * a top-level caller actually reaches it, that a refusal lands BEFORE any role
 * is dispatched, and that what the mission tells a founder about who holds each
 * role comes from the binding rather than from a sentence written once.
 */
const HOSTED_BASE: NodeJS.ProcessEnv = {
  ...LIVE_ENV,
  // Railway sets this on every service in every environment, so it is the
  // marker a deploy config cannot forget.
  RAILWAY_ENVIRONMENT: 'production',
};
const HOSTED_ENV: NodeJS.ProcessEnv = {
  ...HOSTED_BASE,
  RELAY_ROLE_CODING_AGENT: 'claude_agent_sdk_hosted',
  ANTHROPIC_API_KEY: 'sk-ant-FAKETESTNOTREAL-never-served', // relay-boundary:allow-fixture — synthetic
  RELAY_HOSTED_CODING_MODEL: 'claude-test',
  // SELECTS the occupant; the RELAY_HERMES_* names below CONFIGURE the
  // transport it needs. Two variables, two jobs — merging them gave one
  // variable two incompatible readers.
  RELAY_ROLE_REVIEWER: 'hermes_remote_service',
  RELAY_HERMES_MODE: 'remote',
  RELAY_HERMES_SERVICE_URL: 'https://hermes.internal',
  RELAY_HERMES_SERVICE_TOKEN: 'not-a-real-token',
  RELAY_HERMES_TRUSTED_ORIGINS: 'https://hermes.internal',
};

describe('role slots decide who may hold each role, before anything is dispatched', () => {
  it('refuses a hosted deployment that names no Coding Agent, rather than guessing one', async () => {
    const h = harness();
    const { view } = await runMission(h, HOSTED_BASE, 'm-role-unnamed');
    expect(view.state).toBe('failed');
    expect(view.phase).toBe('preflight_blocked');
    expect(view.error?.code).toBe('role_binding_refused');
    expect(view.error?.retryable).toBe(false);
    // The whole point of binding first: nothing was consumed.
    expect(h.calls.architect).toBe(0);
    expect(h.calls.coding).toBe(0);
    expect(h.calls.reviewer).toBe(0);
  });

  it('refuses an installed-CLI Coding Agent on a hosted deployment, and says what it does support', async () => {
    const h = harness();
    const { view } = await runMission(
      h,
      { ...HOSTED_ENV, RELAY_ROLE_CODING_AGENT: 'claude_code_local' },
      'm-role-local-on-host',
      'live',
    );
    expect(view.error?.code).toBe('role_binding_refused');
    // "Not ready yet" and "never, on this host" are different answers, and
    // telling a founder the first is how they were once sent to install
    // something on a machine that was not the one with the problem.
    expect(view.error?.safeMessage).toContain('founder_machine');
    expect(h.calls.architect).toBe(0);
    expect(h.calls.coding).toBe(0);
  });

  it('refuses an occupant nobody registered', async () => {
    const h = harness();
    const { view } = await runMission(
      h,
      { ...HOSTED_ENV, RELAY_ROLE_CODING_AGENT: 'gpt5_codex_turbo' },
      'm-role-unknown',
      'live',
    );
    expect(view.error?.code).toBe('role_binding_refused');
    expect(view.error?.safeMessage).toContain('gpt5_codex_turbo');
    expect(h.calls.architect).toBe(0);
  });

  /**
   * BOUND IS NOT DISPATCHABLE, AND THE MISSION MUST SAY SO RATHER THAN RUN
   * SOMETHING ELSE.
   *
   * This combination binds — every occupant is registered, hosted-capable and
   * configured. It is still refused, because `runCodingMission` drives the
   * Claude Code CLI and `runHermesReview` spawns a local Hermes; neither
   * consults the hosted runner or the remote transport. Without this refusal
   * the mission announced "Claude Agent SDK (hosted)" in its preflight and
   * then ran the local CLI, which attested itself — one occupant narrated,
   * another doing the work.
   */
  /**
   * THIS TEST USED TO ASSERT THE OPPOSITE, AND THE ASSERTION HAD GONE STALE.
   *
   * It required the fully-hosted shape to be refused `occupant_not_dispatchable`
   * naming `hermes_remote_service`, on the grounds that the mission spawned a
   * local Hermes and consulted no transport. That stopped being true when
   * `callReviewer` began dispatching on the resolved transport — `remote`
   * calls the Hermes service and returns the same `HermesOutcome` — but the
   * dispatchable set still excluded it, so a deployment that had configured
   * the remote Reviewer correctly was told this bridge could not drive it.
   *
   * The refusal mechanism is unchanged and still covered, by a unit test over
   * `missionDispatchProblems` with a synthetic occupant — which is where it
   * belongs, since asserting it here required a real occupant to stay broken.
   */
  it('no longer refuses the fully-hosted shape as undrivable', async () => {
    const h = harness();
    const { view } = await runMission(h, HOSTED_ENV, 'm-role-hosted-dispatchable', 'live');
    expect(view.error?.code).not.toBe('occupant_not_dispatchable');
    expect(JSON.stringify(view)).not.toContain('cannot yet dispatch it');
  });

  /**
   * THE KEYLESS OFFLINE PIPELINE STILL RUNS ON A HOSTED DEPLOYMENT.
   *
   * `RELAY_BRIDGE_FAKE_CLAUDE=1` is a documented capability — a whole mission
   * with no credential and no spend. Modelling the fake as a MODE of the
   * installed-CLI occupant broke it on a container, because that occupant
   * declares `founder_machine` and the fake needs no CLI at all. It is a
   * different occupant, and this is the proof that saying so restored it.
   */
  /**
   * THE KEYLESS OFFLINE PIPELINE ON A HOST — the regression this branch caused
   * and then repaired twice.
   *
   * `RELAY_BRIDGE_FAKE_CLAUDE=1` with the development architect is a whole
   * mission with no credential and no spend, and it worked on a container
   * before this branch. It broke twice: first because the fake was modelled as
   * a MODE of the installed-CLI occupant, and then because binding demanded a
   * REVIEWER the development path never dispatches — a dead end whose stated
   * remedy could not be performed, since no reviewer occupant runs on a
   * container. Binding now mirrors dispatch.
   */
  it('runs the keyless offline pipeline on a hosted deployment', async () => {
    // `fusionVerified` makes the coding leg report a verified result, so this
    // asserts COMPLETION. Without it the mission ended `verification_failed`
    // and the test still passed, because it only checked which error it was
    // NOT — a barrier for the branch's headline claim, satisfied by a failure.
    const h = harness({ fusionVerified: true });
    const { view } = await runMission(
      h,
      // No coding-agent name, no reviewer, no credential — on a hosted host.
      { RAILWAY_ENVIRONMENT: 'production', RELAY_PROMPT_ARCHITECT_MODE: 'fusion' },
      'm-role-hosted-fake',
      'fake',
    );
    expect(view.state).toBe('verified_complete');
    expect(h.calls.fusion).toBe(1);
    // Zero spend, and no reviewer was called — that is the whole shape.
    expect(h.calls.architect).toBe(0);
    expect(h.calls.reviewer).toBe(0);
  });

  /**
   * NAMING A REVIEWER MUST NOT KILL THE ONE HOSTED SHAPE THAT WORKS. The
   * dispatch check ran over every BOUND role rather than every DISPATCHED one,
   * so an operator following `.env.example` and setting the hosted reviewer
   * broke the pipeline that had just been repaired.
   */
  it('ignores a reviewer this mission will not dispatch', async () => {
    const h = harness({ fusionVerified: true });
    const { view } = await runMission(
      h,
      {
        RAILWAY_ENVIRONMENT: 'production',
        RELAY_PROMPT_ARCHITECT_MODE: 'fusion',
        RELAY_ROLE_REVIEWER: 'hermes_remote_service',
        RELAY_HERMES_MODE: 'remote',
        RELAY_HERMES_SERVICE_URL: 'https://hermes.internal',
        RELAY_HERMES_SERVICE_TOKEN: 'not-a-real-token',
        RELAY_HERMES_TRUSTED_ORIGINS: 'https://hermes.internal',
      },
      'm-role-hosted-fake-with-reviewer',
      'fake',
    );
    expect(view.state).toBe('verified_complete');
    expect(h.calls.reviewer).toBe(0);
  });

  /**
   * THE DANGEROUS HALF OF THE CONFLICT. Naming the fake occupant WITHOUT
   * RELAY_BRIDGE_FAKE_CLAUDE binds the fake while the real Claude Code CLI
   * resolves — and the fake shares the local occupant's actor name and adapter
   * id, so nothing downstream objects. A real, subscription-billed run would
   * be attested `simulated` and reach verified_complete.
   */
  it('refuses the fake occupant named without the mode that selects it', async () => {
    const h = harness();
    const { view } = await runMission(
      h,
      { ...LIVE_ENV, RELAY_ROLE_CODING_AGENT: 'claude_code_fake' },
      'm-role-fake-named-live',
      'live',
    );
    expect(view.state).toBe('failed');
    expect(view.error?.code).toBe('role_binding_refused');
    expect(view.error?.safeMessage).toContain('RELAY_BRIDGE_FAKE_CLAUDE=1');
    expect(view.error?.safeMessage).toContain('spent nothing');
    expect(h.calls.architect).toBe(0);
    expect(h.calls.coding).toBe(0);
  });

  /** Both settings naming the SAME occupant is agreement, not a conflict. */
  it('accepts fake mode alongside a matching explicit name', async () => {
    const h = harness({ fusionVerified: true });
    const { view } = await runMission(
      h,
      { RELAY_PROMPT_ARCHITECT_MODE: 'fusion', RELAY_ROLE_CODING_AGENT: 'claude_code_fake' },
      'm-role-fake-agreement',
      'fake',
    );
    expect(view.error?.code).not.toBe('role_binding_refused');
  });

  /**
   * A LIVE mission still requires a Reviewer everywhere. Optionality is derived
   * from the architect path because that is the same signal the mission uses to
   * decide whether it reviews at all — it is not a way to opt out of review.
   */
  it('still requires a Reviewer on the live path', async () => {
    const h = harness();
    const { view } = await runMission(
      h,
      { ...HOSTED_BASE, RELAY_ROLE_CODING_AGENT: 'claude_agent_sdk_hosted',
        ANTHROPIC_API_KEY: 'sk-ant-FAKETESTNOTREAL-never-served', // relay-boundary:allow-fixture — synthetic
        RELAY_HOSTED_CODING_MODEL: 'claude-test' },
      'm-role-live-needs-reviewer',
      'live',
    );
    expect(view.error?.code).toBe('role_binding_refused');
    expect(view.error?.safeMessage).toContain('RELAY_ROLE_REVIEWER');
    expect(h.calls.architect).toBe(0);
  });

  /**
   * Fake mode and a named occupant are a CONFLICT, not a precedence. Silently
   * overriding ran a simulated agent under a name the operator chose — and on
   * the development path nothing reviews the result, so it could reach
   * `verified_complete`.
   */
  it('refuses fake mode and an explicitly named Coding Agent together', async () => {
    const h = harness();
    const { view } = await runMission(
      h,
      { RELAY_PROMPT_ARCHITECT_MODE: 'fusion', RELAY_ROLE_CODING_AGENT: 'claude_agent_sdk_hosted' },
      'm-role-conflict',
      'fake',
    );
    expect(view.error?.code).toBe('role_binding_refused');
    expect(view.error?.safeMessage).toContain('RELAY_ROLE_CODING_AGENT');
    expect(view.error?.safeMessage).toContain('claude_agent_sdk_hosted');
    expect(h.calls.fusion).toBe(0);
    expect(h.calls.coding).toBe(0);
  });

  it('binds the fake coding occupant on a hosted deployment', () => {
    // Isolating the half this occupant fixes: on a container, the offline
    // coding runtime is no longer the thing standing in the way.
    const resolution = resolveRoleSlots({
      architectMode: 'fusion',
      reviewerOccupant: 'hermes_remote_service',
      codingAgentOccupant: undefined,
      fakeCodingRuntime: true,
      requiresReview: false,
      hosted: true,
      configuredNames: new Set([
        'RELAY_HERMES_MODE', 'RELAY_HERMES_SERVICE_URL',
        'RELAY_HERMES_SERVICE_TOKEN', 'RELAY_HERMES_TRUSTED_ORIGINS',
      ]),
    });
    expect(resolution.binding.ok).toBe(true);
    if (!resolution.binding.ok) return;
    expect(resolution.binding.bindings.coding_agent?.occupant.occupantId).toBe('claude_code_fake');
  });

  it('lets a bound, dispatchable combination proceed', async () => {
    const h = harness();
    const { view } = await runMission(h, LIVE_ENV, 'm-role-dispatchable');
    expect(view.error?.code).not.toBe('role_binding_refused');
    expect(view.error?.code).not.toBe('occupant_not_dispatchable');
    expect(h.calls.architect).toBe(1);
  });

  /**
   * THE REQUESTED HALF OF THE ATTESTATION COMES FROM THE BINDING.
   *
   * It used to be the literal `'Claude Code'` / `'claude-code-local'` /
   * `'subscription'`, written three lines apart. The ACTUAL half stays what the
   * coding leg observed, which is why the two are separate fields at all.
   */
  it('hands the bound occupant to the coding leg, which is where identity is attested', async () => {
    const h = harness();
    await runMission(h, LIVE_ENV, 'm-role-attestation');
    // The coding leg is faked here, so this asserts the HANDOVER. That the
    // attestation is then built from it is asserted against the real
    // `runCodingMission` in `coding-leg-offline.test.ts`.
    expect(h.codingInput?.requestedOccupant).toEqual({
      // The RUNTIME-facing name, not the UI label — `actorMatches` compares
      // this with what the adapter reports, so both halves need one vocabulary.
      actorName: 'Claude Code',
      adapterId: 'claude-code-local',
      // Nothing was spent: the offline pipeline is `none`, which the coding
      // leg translates to `simulated` rather than laundering into a payer.
      billingPath: 'none',
    });
  });

  it('names the installed CLI when that is genuinely the bound occupant', async () => {
    const h = harness();
    const { view } = await runMission(h, LIVE_ENV, 'm-role-named-live', 'live');
    const preflight = view.events.find((e) => e.headline.startsWith('Preflight passed'));
    expect(preflight?.meta).toContain('claude_code_local');
    expect(preflight?.detail).toContain('Claude Code (installed CLI)');
  });

  it('names the bound occupants in the preflight event, from the binding itself', async () => {
    const h = harness();
    const { view } = await runMission(h, LIVE_ENV, 'm-role-named');
    const preflight = view.events.find((e) => e.headline.startsWith('Preflight passed'));
    expect(preflight).toBeDefined();
    expect(preflight?.meta).toContain('openai_gpt_architect');
    // `claudeMode: 'fake'` is the keyless offline pipeline, and it binds the
    // occupant that actually runs rather than the installed CLI it is
    // standing in for. Announcing `claude_code_local` here while a synthetic
    // executable ran is the untruth the registry exists to prevent.
    expect(preflight?.meta).toContain('claude_code_fake');
    expect(preflight?.meta).toContain('hermes_local');
    expect(preflight?.detail).toContain('Relay fake Claude Code');
  });

  /**
   * PRODUCTION IS ONE-WAY, INCLUDING HERE.
   *
   * `isProductionDeployment` is documented as a signal that can only turn
   * production ON, because "a host that can be talked out of being a
   * production host is not one". Asking only the INJECTED environment
   * reintroduced exactly that: a curated `architectEnv` would make a real
   * server evaluate as a founder machine, switch development defaults on, and
   * bind an installed CLI inside a container. This drives the real process
   * environment against an injected one that says nothing about Railway.
   */
  it('treats the real process environment as production even when the injected one is silent', async () => {
    const saved = process.env.RAILWAY_ENVIRONMENT;
    process.env.RAILWAY_ENVIRONMENT = 'production';
    try {
      const h = harness();
      // LIVE_ENV carries no Railway marker at all, and names no coding agent.
      const { view } = await runMission(h, LIVE_ENV, 'm-role-oneway-production');
      expect(view.state).toBe('failed');
      // Hosted, so development defaults are OFF and the unnamed slots refuse.
      expect(view.error?.code).toBe('role_binding_refused');
      expect(view.error?.safeMessage).toContain('will not guess');
      expect(h.calls.architect).toBe(0);
    } finally {
      if (saved === undefined) delete process.env.RAILWAY_ENVIRONMENT;
      else process.env.RAILWAY_ENVIRONMENT = saved;
    }
  });

  it('carries no credential value into any mission event', async () => {
    const h = harness();
    const { view } = await runMission(h, HOSTED_ENV, 'm-role-secrecy');
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain('sk-ant-FAKETESTNOTREAL');
    expect(serialized).not.toContain('not-a-real-token');
  });
});

/**
 * THE HOSTED CODING SURFACE, THROUGH THE REAL MISSION REGISTRY.
 *
 * The seam and the invoker were proven by driving `runCodingMission` directly.
 * That is exactly why a blocker survived: the mission probed for an installed
 * `claude` CLI unconditionally, so on a container the hosted occupant — whose
 * whole purpose is to need no CLI — still died with "Install Claude Code". No
 * test noticed, because every other orchestrator test injects
 * `resolveClaudeRuntime`.
 *
 * These do NOT inject it. The mission must reach the hosted invoker without a
 * CLI existing anywhere.
 */
describe('a hosted Coding Agent reaches its own surface, with no CLI on the host', () => {
  const HOSTED_CODER_ENV: NodeJS.ProcessEnv = {
    RAILWAY_ENVIRONMENT: 'production',
    RELAY_PROMPT_ARCHITECT_MODE: 'fusion',
    RELAY_ROLE_CODING_AGENT: 'claude_agent_sdk_hosted',
    ANTHROPIC_API_KEY: 'sk-ant-FAKETESTNOTREAL-never-served', // relay-boundary:allow-fixture — synthetic
    RELAY_HOSTED_CODING_MODEL: 'claude-test',
  };

  /** A registry with the real runtime resolution left in place. */
  const hostedRegistry = (h: Harness, built: { invoker: boolean }) => createMissionRegistry({
    fusionBaseUrl: 'http://localhost:3000',
    sundayMode: 'fast',
    claudeMode: 'live',
    confirmLive: true,
    architectEnv: HOSTED_CODER_ENV,
    hermesEnv: HOSTED_CODER_ENV,
    now: () => AT,
    deps: {
      ...h.deps,
      // The ONLY stub: the runtime resolver stays real, so a CLI probe would
      // still refuse. Recording construction is what proves the leg was reached.
      resolveClaudeRuntime: undefined,
      createHostedInvoker: () => {
        built.invoker = true;
        return async () => { throw new Error('not reached in this test'); };
      },
    },
  });

  it('does not refuse for a Claude Code CLI it will never spawn', async () => {
    /**
     * A CLI-LESS HOST, SIMULATED HONESTLY. `probeClaudeCapabilities` resolves
     * the executable by scanning `process.env.PATH` directly, so emptying PATH
     * is exactly a container with no `claude` on it. Without this the test
     * passes on a developer machine that HAS the CLI — which is precisely how
     * this blocker survived a full green gate.
     */
    const savedPath = process.env.PATH;
    process.env.PATH = '';
    try {
      const h = harness();
      const built = { invoker: false };
      const reg = hostedRegistry(h, built);
      reg.start({ missionId: 'm-hosted-no-cli', objective: 'Normalize project names.' });
      const view = await settle(reg, 'm-hosted-no-cli');
      // The CLI probe's refusal is the thing that must NOT happen.
      expect(view.error?.code).not.toBe('coding_agent_not_ready');
      expect(JSON.stringify(view)).not.toContain('Install Claude Code');
      // And the hosted surface really was the one selected.
      expect(built.invoker).toBe(true);
    } finally {
      if (savedPath === undefined) delete process.env.PATH;
      else process.env.PATH = savedPath;
    }
  });

  it('still refuses a hosted Coding Agent whose SDK credential is unset', async () => {
    const h = harness();
    const built = { invoker: false };
    const reg = createMissionRegistry({
      fusionBaseUrl: 'http://localhost:3000',
      sundayMode: 'fast',
      claudeMode: 'live',
      confirmLive: true,
      architectEnv: { ...HOSTED_CODER_ENV, ANTHROPIC_API_KEY: '' },
      hermesEnv: { ...HOSTED_CODER_ENV, ANTHROPIC_API_KEY: '' },
      now: () => AT,
      deps: {
        ...h.deps,
        resolveClaudeRuntime: undefined,
        createHostedInvoker: () => { built.invoker = true; return async () => { throw new Error('x'); }; },
      },
    });
    reg.start({ missionId: 'm-hosted-no-key', objective: 'Normalize project names.' });
    const view = await settle(reg, 'm-hosted-no-key');
    expect(view.state).toBe('failed');
    // Binding refuses first — the credential is declared configuration for
    // this occupant, so the refusal names the variable rather than a probe.
    expect(view.error?.code).toBe('role_binding_refused');
    expect(view.error?.safeMessage).toContain('ANTHROPIC_API_KEY');
    expect(built.invoker).toBe(false);
    expect(h.calls.coding).toBe(0);
  });
});

/**
 * THE REVIEWER TRANSPORT, ON A REAL MISSION.
 *
 * The remote reviewer and its preflight are each proven in their own file.
 * What those cannot prove is that the MISSION uses them — and that is the step
 * that has gone wrong before in this repository: the hosted Coding Agent's
 * transport worked while the mission probed unconditionally for the local CLI,
 * so the hosted path died on a container that was never going to have one.
 *
 * So this runs the real mission registry and asserts which reviewer it
 * actually reached.
 */
describe('the mission reviews through the transport its deployment configured', () => {
  const REMOTE_ENV: NodeJS.ProcessEnv = {
    ...LIVE_ENV,
    RELAY_HERMES_MODE: 'remote',
    RELAY_HERMES_SERVICE_URL: 'https://hermes.example.com',
    RELAY_HERMES_SERVICE_TOKEN: 'service-token',
    RELAY_HERMES_TRUSTED_ORIGINS: 'https://hermes.example.com',
  };

  it('calls the REMOTE reviewer and never the local one', async () => {
    const h = harness();
    let remoteCalls = 0;
    let localPreflights = 0;
    h.deps.runRemoteHermesReview = async () => {
      remoteCalls += 1;
      return approvedReview();
    };
    // If the mission ever probed for a local binary here, this would fire —
    // and on a container it would fail the mission before the remote reviewer
    // was reached at all.
    /**
     * A COMPLETE result, not a cast.
     *
     * The first version cast a two-field object, which the bridge typecheck
     * refused — correctly. A cast here would have hidden the same class of
     * mistake that broke the remote-review fixture earlier in this branch.
     */
    h.deps.hermesPreflight = () => {
      localPreflights += 1;
      return {
        ready: true,
        missing: [],
        executable: 'hermes',
        oneShotSupported: true,
        readOnlySupported: true,
        model: 'hermes-3',
        provider: 'test-provider',
        authenticatedProviders: [],
        livenessVerified: true,
        billingPath: 'subscription',
      };
    };
    // The remote readiness probe, answered without a network.
    h.deps.remoteReviewerFetch = (() => Promise.resolve(new Response(JSON.stringify({
      lifecycle: LIFECYCLE_SERVING,
      evidence: {
        installed: true, compatible: true, credentialPresent: true,
        readOnlyEnforceable: true, verifiedModelId: 'hermes-3', failureReason: null,
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))) as unknown as typeof fetch;
    const reg = registry(h, REMOTE_ENV, 'fake');
    reg.start({ missionId: 'msn-remote-1', objective: 'Normalize project names safely' });
    await settle(reg, 'msn-remote-1');

    expect(remoteCalls).toBe(1);
    expect(localPreflights).toBe(0);
    expect(h.calls.reviewer).toBe(0);
  });

  it('calls the LOCAL reviewer when the deployment did not configure remote', async () => {
    const h = harness();
    let remoteCalls = 0;
    h.deps.runRemoteHermesReview = async () => {
      remoteCalls += 1;
      return approvedReview();
    };
    const reg = registry(h, LIVE_ENV, 'fake');
    reg.start({ missionId: 'msn-local-1', objective: 'Normalize project names safely' });
    await settle(reg, 'msn-local-1');

    expect(h.calls.reviewer).toBe(1);
    expect(remoteCalls).toBe(0);
  });

  it('refuses the mission when remote was configured and cannot be had', async () => {
    const h = harness();
    let remoteCalls = 0;
    h.deps.runRemoteHermesReview = async () => {
      remoteCalls += 1;
      return approvedReview();
    };
    const reg = registry(h, { ...REMOTE_ENV, RELAY_HERMES_SERVICE_TOKEN: '' }, 'fake');
    reg.start({ missionId: 'msn-remote-broken', objective: 'Normalize project names safely' });
    const view = await settle(reg, 'msn-remote-broken');

    // No reviewer ran, of either kind, and the mission says why rather than
    // complaining about a binary nobody intended to use.
    expect(remoteCalls).toBe(0);
    expect(h.calls.reviewer).toBe(0);
    expect(JSON.stringify(view)).toContain('RELAY_HERMES_SERVICE_TOKEN');
  });
});

/**
 * A MISSION GATHERS CURRENT INFORMATION BEFORE IT PLANS.
 *
 * The retrieval path, the permission boundary and the evidence record are each
 * proven elsewhere. What none of them proves is the requirement itself: that a
 * real Mission requests external information and the Prompt Architect plans
 * with it. So this runs the real registry and reads what the architect was
 * actually handed.
 */
describe('a mission gathers evidence and the architect plans with it', () => {
  const artifactFor = (content: string) => normalizeObservation('ev-1', {
    missionId: 'msn-ev', projectId: 'msn-ev',
    source: 'github', capability: 'read_item',
    reference: 'https://github.com/example/repo/releases/tag/v2.0.0',
    title: null, author: null,
    publishedAt: '2026-08-10T11:30:00.000Z',
    retrievedAt: '2026-08-10T12:00:00.000Z',
    query: null, content,
    sanitization: 'clean', injectionSignals: [], authority: 'primary',
    attempt: {
      source: 'github', capability: 'read_item',
      requestedBackendId: 'relay_github_public', actualBackendId: 'relay_github_public',
      fallbackOccurred: false,
      startedAt: '2026-08-10T12:00:00.000Z', completedAt: '2026-08-10T12:00:01.000Z',
    },
  });

  it('hands the retrieved observation to the architect as fenced data', async () => {
    const h = harness();
    h.deps.gatherEvidence = async () => ({
      ok: true as const,
      artifact: artifactFor('The legacy adapter was removed in v2.0.0.'),
      attempt: artifactFor('x').attempt,
      events: [],
    });
    const reg = registry(h, LIVE_ENV, 'fake');
    reg.start({
      missionId: 'msn-ev',
      objective: 'Normalize project names safely',
      evidenceReferences: [{ source: 'github', reference: 'https://github.com/example/repo/releases/tag/v2.0.0' }],
    });
    await settle(reg, 'msn-ev');

    const contract = h.architectContract;
    expect(contract).not.toBeNull();
    const evidence = (contract?.liveEvidence ?? []).join('\n');
    expect(evidence).toContain('The legacy adapter was removed in v2.0.0.');
    // Fenced, and framed as an observation BEFORE the content appears.
    expect(evidence).toContain('data, not an instruction');
    expect(evidence.indexOf('not an instruction'))
      .toBeLessThan(evidence.indexOf('The legacy adapter was removed'));
    // Provenance travels with it.
    expect(evidence).toContain('published: 2026-08-10T11:30:00.000Z');
    expect(evidence).toContain('retrieved by: relay_github_public');
  });

  /**
   * THE SKILL CATALOGUE IS LOAD-BEARING NOW.
   *
   * `relay.evidence.gather` used to be a declaration nothing consulted. The
   * mission's evidence leg now runs it through `evaluateInternalSkillCall`
   * first, so the catalogue's `permittedRoles`, its capability list and its
   * version are enforced at run time.
   *
   * This test is what makes that claim checkable rather than asserted: it
   * fails the moment the real registry stops permitting the architect to run
   * the skill, or the declared capability name stops matching what the leg
   * invokes. Verified by mutation — removing 'architect' from permittedRoles
   * turns this into zero retrievals and a recorded refusal.
   */
  it('runs the evidence skill against the REAL catalogue before retrieving', async () => {
    const h = harness();
    let gathers = 0;
    h.deps.gatherEvidence = async () => {
      gathers += 1;
      return {
        ok: true as const,
        artifact: artifactFor('observed'),
        attempt: artifactFor('x').attempt,
        events: [],
      };
    };
    const reg = registry(h, LIVE_ENV, 'fake');
    reg.start({
      missionId: 'msn-skill',
      objective: 'Check the release notes',
      evidenceReferences: [{ source: 'github', reference: 'https://example.com/x' }],
    });
    await settle(reg, 'msn-skill');

    // The architect IS permitted and the capability IS declared, so the
    // retrieval happened.
    expect(gathers).toBe(1);
    // And no skill refusal was recorded, because there was none.
    const events = reg.get('msn-skill')?.events ?? [];
    expect(events.some((e) => (e.detail ?? '').includes('relay.evidence.gather'))).toBe(false);
  });

  it('gathers nothing when the mission authorised nothing', async () => {
    const h = harness();
    let gathers = 0;
    h.deps.gatherEvidence = async () => {
      gathers += 1;
      return { ok: false as const, refusal: 'not_ready' as const, detail: 'x', attempt: null, events: [] };
    };
    const reg = registry(h, LIVE_ENV, 'fake');
    reg.start({ missionId: 'msn-none', objective: 'Normalize project names safely' });
    await settle(reg, 'msn-none');
    // A Mission does not decide on its own that it needs the internet.
    expect(gathers).toBe(0);
    expect(h.architectContract?.liveEvidence).toBeUndefined();
  });

  it('continues without evidence it could not retrieve, and says so', async () => {
    const h = harness();
    h.deps.gatherEvidence = async () => ({
      ok: false as const, refusal: 'capability_disabled' as const,
      detail: 'switched off', attempt: null, events: [],
    });
    const reg = registry(h, LIVE_ENV, 'fake');
    reg.start({
      missionId: 'msn-refused',
      objective: 'Normalize project names safely',
      evidenceReferences: [{ source: 'github', reference: 'https://example.com/x' }],
    });
    const view = await settle(reg, 'msn-refused');

    // No fabricated observation reaches the architect...
    expect(h.architectContract?.liveEvidence).toBeUndefined();
    // ...and the refusal is on the record rather than silent.
    expect(JSON.stringify(view)).toContain('Did not retrieve');
    expect(JSON.stringify(view)).toContain('capability_disabled');
  });

  it('retrieves BEFORE the architect runs, not after', async () => {
    // A plan made from a recollection cannot be fixed by evidence arriving
    // after it.
    const h = harness();
    h.deps.gatherEvidence = async () => {
      h.order.push('evidence');
      return {
        ok: true as const, artifact: artifactFor('current'),
        attempt: artifactFor('x').attempt, events: [],
      };
    };
    const reg = registry(h, LIVE_ENV, 'fake');
    reg.start({
      missionId: 'msn-order',
      objective: 'Normalize project names safely',
      evidenceReferences: [{ source: 'github', reference: 'https://example.com/x' }],
    });
    await settle(reg, 'msn-order');
    expect(h.order.indexOf('evidence')).toBeGreaterThanOrEqual(0);
    expect(h.order.indexOf('evidence')).toBeLessThan(h.order.indexOf('openai'));
  });
});

/**
 * WHAT THE MISSION VIEW CARRIES ABOUT WHAT IT READ.
 *
 * References, never content. A surface showing WHAT was read opens a page of
 * untrusted text in a browser; a surface showing THAT it was read, when, and
 * from where is the useful half and carries none of that risk — and it is
 * exactly what the Project Brain records.
 */
describe('the mission view carries evidence references', () => {
  const gatherOk = (h: ReturnType<typeof harness>) => {
    h.deps.gatherEvidence = async () => {
      const artifact = normalizeObservation('ev-9', {
        missionId: 'msn-ref', projectId: 'msn-ref',
        source: 'github', capability: 'read_item',
        reference: 'https://github.com/example/repo/releases/tag/v2.0.0',
        title: null, author: null,
        publishedAt: '2026-08-10T11:30:00.000Z',
        retrievedAt: '2026-08-10T12:00:00.000Z',
        query: null,
        content: 'SECRET-LOOKING BODY TEXT that must not travel.',
        sanitization: 'clean', injectionSignals: [], authority: 'primary',
        attempt: {
          source: 'github', capability: 'read_item',
          requestedBackendId: 'relay_github_public',
          actualBackendId: 'relay_http_fetch',
          fallbackOccurred: true,
          startedAt: '2026-08-10T12:00:00.000Z', completedAt: '2026-08-10T12:00:01.000Z',
        },
      });
      return { ok: true as const, artifact, attempt: artifact.attempt, events: [] };
    };
  };

  it('reports what was read, when, and which backend served it', async () => {
    const h = harness();
    gatherOk(h);
    const reg = registry(h, LIVE_ENV, 'fake');
    reg.start({
      missionId: 'msn-ref',
      objective: 'Normalize project names safely',
      evidenceReferences: [{ source: 'github', reference: 'https://example.com/x' }],
    });
    const view = await settle(reg, 'msn-ref');

    expect(view.evidence).toHaveLength(1);
    const ref = view.evidence?.[0];
    expect(ref?.evidenceId).toBe('ev-9');
    expect(ref?.publishedAt).toBe('2026-08-10T11:30:00.000Z');
    expect(ref?.contentFingerprint).toMatch(/^fnv1a-/);
    // Requested versus actual survives all the way to the wire.
    expect(ref?.actualBackendId).toBe('relay_http_fetch');
    expect(ref?.fallbackOccurred).toBe(true);
  });

  it('never puts retrieved CONTENT on the wire', async () => {
    const h = harness();
    gatherOk(h);
    const reg = registry(h, LIVE_ENV, 'fake');
    reg.start({
      missionId: 'msn-ref',
      objective: 'Normalize project names safely',
      evidenceReferences: [{ source: 'github', reference: 'https://example.com/x' }],
    });
    const view = await settle(reg, 'msn-ref');
    // The whole point of a reference. A browser rendering retrieved text would
    // be opening untrusted content in the surface built to display honesty.
    expect(JSON.stringify(view.evidence)).not.toContain('SECRET-LOOKING BODY TEXT');
  });

  it('distinguishes authorised-and-retrieved-none from authorised-nothing', async () => {
    const refused = harness();
    refused.deps.gatherEvidence = async () => ({
      ok: false as const, refusal: 'not_ready' as const, detail: 'x', attempt: null, events: [],
    });
    const regA = registry(refused, LIVE_ENV, 'fake');
    regA.start({
      missionId: 'msn-empty',
      objective: 'Normalize project names safely',
      evidenceReferences: [{ source: 'github', reference: 'https://example.com/x' }],
    });
    const withNone = await settle(regA, 'msn-empty');
    // Authorised, retrieved none — an EMPTY list, not an absent one.
    expect(withNone.evidence).toEqual([]);

    const none = harness();
    const regB = registry(none, LIVE_ENV, 'fake');
    regB.start({ missionId: 'msn-unauth', objective: 'Normalize project names safely' });
    const unauthorised = await settle(regB, 'msn-unauth');
    // Authorised nothing — ABSENT. A different fact.
    expect(unauthorised.evidence).toBeUndefined();
  });
});

/**
 * THE TWO REVIEWER DECISIONS MUST NAME THE SAME OCCUPANT.
 *
 * `resolveReviewerTransport` decides who reviews; the role slot decides who is
 * BOUND, and the binding is what the mission attests. Nothing reconciled them
 * — harmless while both were Hermes, reachable the moment a provider Reviewer
 * existed.
 *
 * The configuration below is the one the founder handoff recommends, which is
 * what makes this worth a mission-level test rather than a unit one: it is the
 * path a founder actually takes.
 */
describe('the Reviewer that reviews is the Reviewer that is attested', () => {
  const PROVIDER_REVIEWER_ENV: NodeJS.ProcessEnv = {
    ...LIVE_ENV,
    RELAY_OPENAI_REVIEWER_MODE: 'live',
    RELAY_OPENAI_REVIEWER_MODEL: 'gpt-test',
  };

  it('REFUSES before any spend when an operator EXPLICITLY names the other one', async () => {
    // Two statements that disagree. Relay refuses rather than picking, because
    // picking is the substitution: it would review with OpenAI and attest
    // `hermes_local`, which is the defect the dispatch check exists to stop.
    const h = harness();
    const { view } = await runMission(
      h,
      { ...PROVIDER_REVIEWER_ENV, RELAY_ROLE_REVIEWER: 'hermes_local' },
      'm-reviewer-conflict',
      'live',
    );

    expect(view.state).toBe('failed');
    const text = JSON.stringify(view);
    // It names BOTH settings, so an operator knows which two disagree.
    expect(text).toContain('RELAY_ROLE_REVIEWER');
    expect(text).toContain('RELAY_OPENAI_REVIEWER_MODE');
    // Refused at the PREFLIGHT, so the architect was never paid for a mission
    // that could not have been honestly reviewed.
    expect(h.architectContract).toBeNull();
  });

  it('follows the ONE statement an operator made, rather than refusing over its own default', async () => {
    // `RELAY_OPENAI_REVIEWER_MODE=live` with no named occupant is a founder
    // saying which Reviewer they want, exactly once. Relay used to apply its
    // development default and attest `hermes_local` while OpenAI reviewed;
    // refusing instead would have been honest but hostile, since the only
    // thing disagreeing was a default Relay invented.
    const h = harness();
    const { view } = await runMission(h, PROVIDER_REVIEWER_ENV, 'm-reviewer-implied', 'live');
    const text = JSON.stringify(view);
    expect(text).not.toContain('Relay refuses rather than reviewing with one');
    // And the mission is not refused as undrivable either: the provider
    // Reviewer is a branch `callReviewer` actually has.
    expect(text).not.toContain('cannot yet dispatch it');
  });

  it('runs when the two are set to agree', async () => {
    const h = harness();
    const { view } = await runMission(
      h,
      { ...PROVIDER_REVIEWER_ENV, RELAY_ROLE_REVIEWER: 'openai_reviewer' },
      'm-reviewer-agrees',
      'live',
    );
    // It gets past the reviewer coherence check — whatever happens later is
    // some other leg's business, and this test asserts only that this refusal
    // is not the one that stopped it.
    expect(JSON.stringify(view)).not.toContain('would run "openai_reviewer"');
  });

  it('leaves the ordinary local configuration alone', async () => {
    // No reviewer transport configuration selects local Hermes, which is what
    // the laptop default binds. Nothing to disagree about, and a founder who
    // changed nothing must not meet a new refusal.
    const h = harness();
    const { view } = await runMission(h, LIVE_ENV, 'm-reviewer-local', 'live');
    expect(JSON.stringify(view)).not.toContain('Relay refuses rather than reviewing with one');
  });
});

/**
 * A REJECTED IMPLEMENTATION GETS EXACTLY ONE REPAIR.
 *
 * Relay used to stop dead at `review_blocked`. The repair vocabulary existed in
 * `review-repair.ts` with no caller, so a mission a Reviewer could have
 * unblocked in one pass died with three paid legs behind it — the Architect's
 * request, the Coding Agent's run, and the Reviewer's own.
 *
 * The rules that make this a repair rather than an unbounded retry are the
 * ones worth testing: it happens only for BLOCKING findings, the agent resumes
 * from the bytes the Reviewer read, a SECOND review judges the result, and a
 * repair that still fails is still refused.
 */

/** A rejection with one BLOCKING finding — the only kind that triggers a repair. */
const rejectedReview = (): HermesOutcome => ({
  kind: 'reviewed',
  startedAt: AT,
  completedAt: AT,
  provider: 'xAI',
  requestedModel: 'grok-build-0.1',
  servedModel: 'grok-build-0.1',
  result: {
    verdict: 'changes_required',
    summary: 'The guard is missing.',
    findings: [{
      findingId: 'F-1',
      severity: 'blocking',
      requirement: 'Refuse unknown schema versions.',
      explanation: 'No guard exists.',
      evidence: 'src/normalize.js line 4',
    }],
    requirementsChecked: [{ requirement: 'Refuse unknown schema versions', status: 'failed', evidence: 'No guard.' }],
    parseRepaired: false,
  },
});

/** The SAME reviewer, satisfied on the second look. */
const repairedReview = (): HermesOutcome => ({
  kind: 'reviewed',
  startedAt: AT,
  completedAt: AT,
  provider: 'xAI',
  requestedModel: 'grok-build-0.1',
  servedModel: 'grok-build-0.1',
  result: {
    verdict: 'approved',
    summary: 'The guard is present now.',
    findings: [],
    requirementsChecked: [{ requirement: 'Refuse unknown schema versions', status: 'passed', evidence: 'Guard added.' }],
    parseRepaired: false,
  },
});

/** An APPROVAL carrying an advisory note. Must not trigger a repair. */
const advisoryReview = (): HermesOutcome => ({
  kind: 'reviewed',
  startedAt: AT,
  completedAt: AT,
  provider: 'xAI',
  requestedModel: 'grok-build-0.1',
  servedModel: 'grok-build-0.1',
  result: {
    verdict: 'approved',
    summary: 'Fine, with a note.',
    findings: [{
      findingId: 'F-1',
      severity: 'minor',
      requirement: 'Style.',
      explanation: 'Could be tidier.',
      evidence: 'src/normalize.js line 9',
    }],
    requirementsChecked: [{ requirement: 'Existing tests pass', status: 'passed', evidence: 'Relay ran the tests.' }],
    parseRepaired: false,
  },
});

describe('the coding agent gets one bounded repair when the reviewer rejects', () => {
  const rejectThenApprove = () => {
    let call = 0;
    return async () => {
      call += 1;
      return call === 1
        ? rejectedReview()
        : repairedReview();
    };
  };

  it('repairs, re-reviews, and COMPLETES when the second review approves', async () => {
    const h = harness({ reviewer: rejectThenApprove() });
    const { view } = await runMission(h, LIVE_ENV, 'm-repair-ok', 'live');

    // Two coding runs and two reviews: the repair is real work, judged again.
    expect(h.calls.coding).toBe(2);
    expect(h.calls.reviewer).toBe(2);
    expect(view.state).toBe('verified_complete');
    const text = JSON.stringify(view);
    expect(text).toContain('Repair attempt started');
    expect(text).toContain('Re-review complete');

    /**
     * THE PART THAT WAS MISSING, and the reason this test passed while
     * production refused every repair.
     *
     * The repaired artifact must become the mission's artifact. Only
     * `rec.review` moved, so completion compared the repaired review's digest
     * against the FIRST attempt's evidence and answered "The artifact changed
     * after review; the review is stale" — true, and Relay describing its own
     * omission. The fixture returned one constant digest for every run, so the
     * comparison could not fail here.
     */
    expect(view.artifactDigest).toBe(REPAIRED_ARTIFACT_DIGEST);
    expect(view.review?.reviewedArtifactDigest).toBe(REPAIRED_ARTIFACT_DIGEST);
    // Same artifact on both sides — which is the whole invariant.
    expect(view.review?.reviewedArtifactDigest).toBe(view.artifactDigest);
  });

  it('judges the repair on the REPAIR’s verification, not the first attempt’s', async () => {
    /**
     * The direction that matters more than the refusal. Every other completion
     * input reads from the same `evidence` — `scopePreserved`,
     * `deterministicTestsPassed`, `protectedPathsUntouched` — so leaving it
     * behind meant a repair that broke scope would have been assessed against
     * an inspection taken before it ran.
     *
     * Here the repair comes back UNAUTHORIZED. An approving re-review must not
     * rescue it.
     */
    let call = 0;
    const h = harness({
      reviewer: rejectThenApprove(),
      coding: async (hh) => goodCodingOutcome(
        codingHandoffDigest(hh.codingInput?.handoff ?? { objective: '', instructions: [], constraints: [], acceptanceCriteria: [] }),
        hh.codingInput?.missionRevision ?? '',
        // First run clean; the REPAIR is the one that goes out of scope.
        ++call === 1,
        call === 1 ? ARTIFACT_DIGEST : REPAIRED_ARTIFACT_DIGEST,
      ),
    });
    const { view } = await runMission(h, LIVE_ENV, 'm-repair-scope', 'live');
    expect(view.state).not.toBe('verified_complete');
  });

  it('REFUSES completion when the repair is rejected too', async () => {
    // The bound, and the honesty: one attempt, and a second rejection ends it.
    // A loop that kept going would spend a founder's money in a circle.
    const h = harness({
      reviewer: async () => rejectedReview(),
    });
    const { view } = await runMission(h, LIVE_ENV, 'm-repair-fail', 'live');

    expect(h.calls.coding).toBe(2);
    expect(h.calls.reviewer).toBe(2);
    expect(view.state).toBe('failed');
    expect(view.error?.code).toBe('review_blocked');
  });

  it('does NOT repair when the findings are not blocking', async () => {
    // An approved review with advisory findings is a completion, not a repair.
    // Repairing here would spend money to address something nobody blocked on.
    const h = harness({
      reviewer: async () => advisoryReview(),
    });
    const { view } = await runMission(h, LIVE_ENV, 'm-repair-none', 'live');

    expect(h.calls.coding).toBe(1);
    expect(h.calls.reviewer).toBe(1);
    expect(view.state).toBe('verified_complete');
    expect(JSON.stringify(view)).not.toContain('Repair attempt started');
  });
});

/**
 * A REPAIR THAT PRODUCES NOTHING MUST SAY SO.
 *
 * The first production run of the repair leg fired correctly and then went
 * silent: "Repair attempt started — 3 blocking finding(s)" followed by the
 * completion decision, with nothing in between. The mission was refused for
 * the right reason — the original rejection stood — and the record could not
 * say whether the repair ran and failed, stopped at a precondition, or never
 * started at all.
 *
 * I wrote that blindness, in the same session that removed five instances of
 * it from elsewhere. This is the test that keeps it removed.
 */
describe('a repair that yields nothing explains itself', () => {
  it('records why, and still refuses the mission', async () => {
    const h = harness({ reviewer: async () => rejectedReview() });
    // The repair attempt produces no evidence, exactly as production did.
    const inner = h.deps.runCodingMission as NonNullable<MissionRoleDeps['runCodingMission']>;
    let call = 0;
    h.deps.runCodingMission = async (input) => {
      call += 1;
      const real = await inner(input);
      if (call === 1) return real;
      /**
       * Derived from a REAL outcome rather than cast from a literal. A cast
       * here would compile against a shape I imagined, and the repair leg
       * reads fields this test would then never have supplied — the same
       * failure mode as the `as never` I removed from the coding leg earlier.
       */
      return { ...real, ok: false, stopped: true, stopReason: 'Workspace preparation failed.', evidence: null };
    };

    const { view } = await runMission(h, LIVE_ENV, 'm-repair-empty', 'live');
    const text = JSON.stringify(view);

    expect(text).toContain('Repair attempt started');
    // The point: the silence is gone.
    expect(text).toContain('Repair produced no verifiable result');
    expect(text).toContain('Workspace preparation failed');
    // And the refusal is unchanged — a failed repair never becomes a pass.
    expect(view.state).toBe('failed');
    expect(view.error?.code).toBe('review_blocked');
  });
});

/**
 * DEFECT 3 — THE REVIEWER'S SERVED MODEL.
 *
 * `HOSTED_MISSION_EVIDENCE.md` carried this as the one open defect of the
 * hosted pipeline: the mission attested a reviewer model it had never been
 * told, because ONE `model` field carried two different facts. The reviewer
 * leg computed
 *
 *     resolvedModel = outcome.model ?? hermesReady.model
 *
 * and both operands were CONFIGURATION — the remote path hardcoded
 * `model: null` into its outcome, so every hosted review fell through to the
 * preflight's configured value, which was then written into the attestation
 * and rendered on the founder's review card as the model that reviewed.
 *
 * These tests hold the two axes apart. Each one fails against the code it
 * describes: the first three all produced `'claude-opus-4-8'` on the served
 * axis before the split, and the last two did not exist as behaviour at all.
 */
describe('defect 3 — requested and served reviewer models are separate facts', () => {
  /**
   * Narrows a fixture to its `reviewed` variant before spreading it.
   *
   * `HermesOutcome` is a union, and spreading the union into an object literal
   * makes TypeScript check the result against EVERY member — including
   * `launch_failed`, which has no model fields. Narrowing here keeps the model
   * overrides type-checked against the variant that actually has them.
   */
  const reviewed = (o: HermesOutcome): Extract<HermesOutcome, { kind: 'reviewed' }> => {
    if (o.kind !== 'reviewed') throw new Error(`fixture is ${o.kind}, not a reviewed outcome`);
    return o;
  };

  /** The remote transport's real shape: it asks for a review, not for a model. */
  const remoteStyleOutcome = (servedModel: string | null): HermesOutcome => ({
    ...reviewed(approvedReview()),
    requestedModel: null,
    servedModel,
  });

  it('an unreported served model stays Unknown and is never filled from the preflight', async () => {
    const h = harness({ reviewer: async () => remoteStyleOutcome(null) });
    const { view } = await runMission(h, LIVE_ENV, 'm-served-unknown');

    expect(view.state).toBe('verified_complete');
    // The REQUESTED axis may fall back to the preflight — both name what was
    // asked for, and the preflight's value is verified configuration.
    expect(view.review?.requestedModel).toBe('claude-opus-4-8');
    // The SERVED axis has no fallback anywhere. This is the whole defect: it
    // used to read 'claude-opus-4-8' here, having been told nothing.
    expect(view.review?.servedModel).toBeNull();

    const reviewer = view.attestations?.find((a) => a.role === 'reviewer');
    expect(reviewer?.requestedModel).toBe('claude-opus-4-8');
    expect(reviewer?.actualModel).toBeUndefined();
    // Unknown is not a substitution, so the review still counts.
    expect(reviewer?.fallbackOccurred).toBe(false);
    expect(reviewer?.completionVerified).toBe(true);
    // And the record says so in words, rather than showing a model.
    expect(JSON.stringify(view)).toContain('served model not reported by the provider');
  });

  it('a reported served model is attested as the model that reviewed', async () => {
    const h = harness({ reviewer: async () => remoteStyleOutcome('claude-opus-4-8') });
    const { view } = await runMission(h, LIVE_ENV, 'm-served-known');

    expect(view.state).toBe('verified_complete');
    expect(view.review?.servedModel).toBe('claude-opus-4-8');
    expect(view.attestations?.find((a) => a.role === 'reviewer')?.actualModel).toBe('claude-opus-4-8');
    expect(JSON.stringify(view)).toContain('served model claude-opus-4-8');
  });

  it('COMPLETES when the provider resolves the requested model to a snapshot', async () => {
    /**
     * THE REGRESSION THE FIRST VERSION OF THIS BLOCK SHIPPED.
     *
     * `requested !== served` called `gpt-4o` answered by `gpt-4o-2024-08-06` a
     * substitution — the pair `reviewer-served-model.test.ts` calls "the
     * ordinary case", and the pair `runOpenAiReview` really produces. On the
     * `openai_reviewer` configuration this repository's own docs recommend for a
     * hosted run, EVERY mission then failed at the review step with
     * `retryable: false`, after the review had been paid for, and the founder was
     * told their provider had swapped the reviewer. An independent review found
     * it by probing the real registry.
     *
     * A snapshot of the requested family is the same model named exactly.
     */
    const h = harness({
      reviewer: async () => ({
        ...reviewed(approvedReview()),
        requestedModel: 'claude-opus-4-8',
        servedModel: 'claude-opus-4-8-20260114',
      }),
    });
    const { view } = await runMission(h, LIVE_ENV, 'm-served-resolution');

    expect(view.state).toBe('verified_complete');
    // BOTH facts on the record, and they are different strings.
    expect(view.review?.requestedModel).toBe('claude-opus-4-8');
    expect(view.review?.servedModel).toBe('claude-opus-4-8-20260114');

    const reviewer = view.attestations?.find((a) => a.role === 'reviewer');
    expect(reviewer?.actualModel).toBe('claude-opus-4-8-20260114');
    // A resolution is NOT a fallback. Removing only the refusal would still
    // have failed the mission through this field → `attestsRealExecution`.
    expect(reviewer?.fallbackOccurred).toBe(false);
    expect(reviewer?.completionVerified).toBe(true);
  });

  it('rules the SAME relationship the same way for the architect', async () => {
    /**
     * The architect fixture's provider answers `gpt-test` with
     * `gpt-test-2026-01-01`. One file was calling that a substitution on the
     * reviewer leg and `fallbackOccurred: false` on the architect leg, four
     * hundred lines apart. Both now ask `classifyModelIdentity`.
     */
    const { view } = await runMission(harness(), LIVE_ENV, 'm-architect-resolution');
    const architect = view.attestations?.find((a) => a.role === 'prompt_architect');
    expect(architect?.requestedModel).toBe('gpt-test');
    expect(architect?.actualModel).toBe('gpt-test-2026-01-01');
    expect(architect?.fallbackOccurred).toBe(false);
    expect(view.state).toBe('verified_complete');
  });

  it('marks the architect\'s attestation as a fallback when its model IS substituted', async () => {
    /**
     * Without this case the architect assertion above passes against a literal
     * `false` — a resolution and a hardcoded false are the same value. A
     * genuine substitution is what distinguishes the rule from the constant it
     * replaced.
     */
    const h = harness({
      architect: async () => ({
        ...ARCHITECT_RESULT,
        receipt: { ...ARCHITECT_RESULT.receipt, requestedModel: 'gpt-test', actualModel: 'gpt-test-mini' },
      }),
    });
    const { view } = await runMission(h, LIVE_ENV, 'm-architect-substituted');
    const architect = view.attestations?.find((a) => a.role === 'prompt_architect');
    expect(architect?.actualModel).toBe('gpt-test-mini');
    // A variant is not a snapshot, so this is a substitution for the architect
    // exactly as it would be for the reviewer.
    expect(architect?.fallbackOccurred).toBe(true);

    /**
     * AND THE MISSION OUTCOME, WHICH IS WHY THE PREVIOUS VERSION OF THIS TEST
     * LET A HIGH-SEVERITY DEFECT SHIP.
     *
     * It asserted only the flag. `fallbackOccurred: true` reaches
     * `attestsRealExecution` → `decideCompletion`, so the mission died at the
     * very END — after the Coding Agent and the Reviewer had both run and been
     * paid — with the message "The Prompt Architect did not produce an attested
     * execution" and no event naming a model anywhere. An independent review
     * found it by running the real registry. A test that checks a flag and not
     * the outcome is a test that agrees with the code about a field and knows
     * nothing about the behaviour.
     */
    expect(view.state).toBe('failed');
    expect(view.error?.code).toBe('prompt_architect_failed');
    expect(view.error?.safeMessage).toContain('gpt-test-mini');
    expect(view.error?.safeMessage).toContain('gpt-test');
    // Refused where the fact was discovered: the Coding Agent never ran.
    expect(h.calls.coding).toBe(0);
    expect(h.calls.reviewer).toBe(0);
    // And the record explains itself rather than leaving four green architect
    // events followed by a terminal failure with an unrelated reason.
    expect(JSON.stringify(view)).toContain('the provider substituted the model');
  });

  it('a provider that substitutes the reviewer model has its review refused', async () => {
    // Requested one model, answered with another. Relay performs no fallback
    // and does not accept one performed on the far side of the API either.
    const h = harness({
      reviewer: async () => ({ ...reviewed(approvedReview()), requestedModel: 'grok-4', servedModel: 'grok-3-mini' }),
    });
    const { view } = await runMission(h, LIVE_ENV, 'm-served-substituted');

    expect(view.state).toBe('failed');
    expect(view.error?.code).toBe('review_incomplete');
    // BOTH names are in the record. A refusal that hid one of them would be
    // the same crime in a different direction.
    expect(view.error?.safeMessage).toContain('grok-3-mini');
    expect(view.error?.safeMessage).toContain('grok-4');

    const reviewer = view.attestations?.find((a) => a.role === 'reviewer');
    // A substitution IS a fallback — performed by somebody else.
    expect(reviewer?.fallbackOccurred).toBe(true);
    expect(reviewer?.requestedModel).toBe('grok-4');
    expect(reviewer?.actualModel).toBe('grok-3-mini');
    // An approved verdict from a substituted model never completes a mission.
    expect(view.state).not.toBe('verified_complete');
  });

  it('a substituted RE-review is refused and the original rejection stands', async () => {
    let call = 0;
    const h = harness({
      reviewer: async () => {
        call += 1;
        // First look rejects. The repair is then re-reviewed — by a different
        // model than the one requested, which must not be adopted.
        if (call === 1) return rejectedReview();
        return { ...reviewed(repairedReview()), requestedModel: 'grok-build-0.1', servedModel: 'grok-build-0.2' };
      },
    });
    const { view } = await runMission(h, LIVE_ENV, 'm-rereview-substituted', 'live');
    const text = JSON.stringify(view);

    expect(call).toBe(2);
    expect(text).toContain('Re-review refused');
    expect(text).toContain('grok-build-0.2');
    // The approval carried by the substituted re-review is not adopted: the
    // first verdict is still the one on the record.
    expect(view.review?.verdict).toBe('changes_required');
    expect(view.state).toBe('failed');
    expect(view.error?.code).toBe('review_blocked');
  });

  it('never leaves an attestationRef pointing at an attestation the record does not hold', async () => {
    /**
     * `buildAttestation` derives its id from `missionId:role:startedAt`, so
     * rebuilding the reviewer attestation from the SECOND review produces a new
     * id — while the "Hermes response received" event appended during the FIRST
     * review still carries the old one. Every repaired mission's record
     * therefore contained an event referencing a reviewer attestation the record
     * no longer held, and it was the event a founder reads first. A re-review
     * found it by diffing the refs against the ids.
     *
     * The invariant, asserted rather than the symptom: every `attestationRef` in
     * the events either resolves to a current attestation, or is NAMED in a
     * notice that explains what happened to it. Erasing the reference would
     * erase the fact that the first attestation existed and was superseded.
     */
    let call = 0;
    const h = harness({
      reviewer: async () => {
        call += 1;
        if (call === 1) return { ...reviewed(rejectedReview()), requestedModel: 'grok-build-0.1', servedModel: null };
        return { ...reviewed(repairedReview()), requestedModel: 'grok-build-0.1', servedModel: 'grok-build-0.1' };
      },
    });
    const { view } = await runMission(h, LIVE_ENV, 'm-rereview-refs', 'live');
    expect(view.review?.verdict).toBe('approved');

    const ids = new Set((view.attestations ?? []).map((a) => a.attestationId));
    const text = JSON.stringify(view);
    const refs = (view.events ?? [])
      .map((e) => e.attestationRef)
      .filter((r): r is string => typeof r === 'string' && r !== '');
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      const resolved = ids.has(ref);
      // A ref the record no longer holds must be explained by the record.
      const explained = !resolved && text.includes(ref) && text.includes('superseded');
      expect(resolved || explained, `attestationRef ${ref} is neither held nor explained`).toBe(true);
    }
    // And the notice names BOTH ids, so an auditor can follow the substitution.
    expect(text).toContain('superseded by the re-review');
  });

  it('an accepted re-review replaces the first attempt\'s model facts, not just its verdict', async () => {
    let call = 0;
    const h = harness({
      reviewer: async () => {
        call += 1;
        /**
         * THE FIRST LOOK REPORTS NO SERVED MODEL; THE SECOND REPORTS ONE.
         *
         * Both attempts naming the same model made the assertions below pass by
         * coincidence — the first review's attestation already held the right
         * value, so removing the rebuild changed nothing a test could see. This
         * is the divergence an independent review actually probed.
         */
        if (call === 1) return { ...reviewed(rejectedReview()), requestedModel: 'grok-build-0.1', servedModel: null };
        return { ...reviewed(repairedReview()), requestedModel: 'grok-build-0.1', servedModel: 'grok-build-0.1' };
      },
    });
    const { view } = await runMission(h, LIVE_ENV, 'm-rereview-model', 'live');

    expect(view.review?.verdict).toBe('approved');
    // The card describes the review that STANDS, so its model facts are the
    // second look's. Carrying the first attempt's here would describe a review
    // the mission no longer relies on.
    expect(view.review?.requestedModel).toBe('grok-build-0.1');
    expect(view.review?.servedModel).toBe('grok-build-0.1');
    /**
     * AND THE ATTESTATION DESCRIBES THE SAME REVIEW.
     *
     * Overwriting only `rec.review` left the machine-read attestation
     * describing the FIRST review, so a mission whose first look reported no
     * served model and whose second reported one showed the model on the
     * founder's card and `actualModel: undefined` in the record — for the same
     * mission. An independent review found that by probing the real registry.
     */
    const reviewer = view.attestations?.find((a) => a.role === 'reviewer');
    expect(reviewer?.actualModel).toBe(view.review?.servedModel ?? undefined);
    expect(reviewer?.requestedModel).toBe('grok-build-0.1');
    expect(reviewer?.completionVerified).toBe(true);
  });
});

/* ========= the three-role pipeline against a REAL registered repository ========= */

/**
 * THE END-TO-END PROOF THE GOAL ASKS FOR, minus the paid providers.
 *
 * Every role boundary here is injected — the same harness the rest of this file
 * uses — so no provider is contacted and nothing is spent. What is REAL is the
 * repository: a `git init` on disk, a registered target, a resolved
 * authorization, an isolated worktree, and Relay's own observation of what
 * actually changed.
 *
 * This closes the third item `REPOSITORY_TARGETS.md` listed as not built. The
 * coding leg could already target a real repository; the MISSION could not
 * select one, so the three-role pipeline still ran against the fixture.
 *
 * WHAT THIS DOES NOT PROVE, and the document says so: that OpenAI, a hosted
 * Coding Agent and xAI have run this against a real repository. Those are paid
 * calls behind a founder authorization boundary. What is proven is that the
 * pipeline carries a target from `start()` to the worktree and refuses when it
 * should.
 */
describe('a Mission can target a real repository end to end', () => {
  const temporaries: string[] = [];
  afterEach(() => {
    for (const path of temporaries.splice(0)) {
      try { rmSync(path, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  });

  function realProject(): string {
    const root = mkdtempSync(join(tmpdir(), 'relay-mission-repo-'));
    temporaries.push(root);
    const git = (args: string[]) => execFileSync('git', args, {
      cwd: root,
      env: {
        PATH: process.env.PATH ?? '', HOME: root,
        GIT_AUTHOR_NAME: 'F', GIT_AUTHOR_EMAIL: 'f@x',
        GIT_COMMITTER_NAME: 'F', GIT_COMMITTER_EMAIL: 'f@x',
      },
    });
    git(['init', '--quiet', '--initial-branch=main']);
    mkdirSync(join(root, 'src'), { recursive: true });
    mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
    writeFileSync(join(root, 'src', 'app.ts'), 'export const version = 1;\n');
    writeFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'name: ci\n');
    git(['add', '--', '.']);
    git(['commit', '-m', 'baseline']);
    return root;
  }

  function targetFor(root: string) {
    const grants = (['read', 'write_worktree', 'commit'] as const).map((permission) => ({
      permission, authorizedBy: 'founder', authorizedAt: AT, expiresAt: null, note: null,
    }));
    const registration = createRepositoryRegistration({
      draft: {
        identity: { provider: 'local', host: null, owner: null, name: 'proj', defaultBranch: 'main' },
        location: { kind: 'local_path', path: root },
        scope: { read: ['**'], write: ['src/**'] },
        grants,
        ceilings: { maxFilesChanged: 5, maxLinesRemoved: 100, allowDeletions: false },
        registeredBy: 'founder',
      },
      now: AT,
    });
    if (!registration.ok) throw new Error(registration.error.message);
    const resolved = resolveRepositoryTarget({
      registration: registration.value,
      request: {
        repositoryKey: 'local:proj', selectedBy: 'founder', selectedAt: AT,
        workingBranch: 'relay/mission-e2e', permissions: grants.map((g) => g.permission),
      },
      now: AT,
    });
    if (!resolved.ok) throw new Error(resolved.error.message);
    return resolved.target;
  }

  it('carries the target from start() to the coding leg, and says so in the terminal', async () => {
    const root = realProject();
    const target = targetFor(root);
    const h = harness();
    const reg = registry(h, LIVE_ENV, 'fake');
    reg.start({
      missionId: 'm-real-repo',
      objective: 'Bump the version constant.',
      repositoryTarget: target,
      intendedWritePaths: ['src/app.ts'],
    });
    await settle(reg, 'm-real-repo');

    // The coding leg received the target, not the fixture.
    expect(h.codingInput?.repositoryTarget?.repositoryKey).toBe('local:proj');
    expect(h.codingInput?.intendedWritePaths).toEqual(['src/app.ts']);

    /**
     * AND THE LIVE TERMINAL SAYS WHICH REPOSITORY. Calling a founder's
     * repository "the controlled fixture (throwaway repository)" would be a
     * false claim about blast radius, on the line they read to know what Relay
     * is touching.
     */
    expect(h.codingInput?.projectLabel).toContain('local:proj');
    expect(h.codingInput?.projectLabel).toContain('relay/mission-e2e');
    expect(h.codingInput?.projectLabel).not.toContain('throwaway');
  });

  it('leaves the fixture path completely unchanged when no target is given', async () => {
    const h = harness();
    await runMission(h, LIVE_ENV, 'm-no-target');
    expect(h.codingInput?.repositoryTarget).toBeUndefined();
    expect(h.codingInput?.intendedWritePaths).toEqual([]);
    expect(h.codingInput?.projectLabel).toContain('throwaway repository');
  });

  it('runs the WHOLE three-role pipeline against the real repository and leaves it untouched', async () => {
    /**
     * The real coding leg — not the harness stub — so a real isolated worktree is
     * created from the real repository, a real file is edited by the repo's own
     * fake Claude, and Relay really inspects the result. The architect and the
     * reviewer stay injected: those are the paid roles.
     */
    const root = realProject();
    const before = readFileSync(join(root, 'src', 'app.ts'), 'utf8');
    const h = harness();
    delete (h.deps as { runCodingMission?: unknown }).runCodingMission;

    const reg = registry(h, LIVE_ENV, 'fake');
    reg.start({
      missionId: 'm-real-full',
      objective: 'Bump the version constant.',
      repositoryTarget: targetFor(root),
      intendedWritePaths: ['src/app.ts'],
    });
    const view = await settle(reg, 'm-real-full');

    // The architect ran, and the reviewer was reached — the pipeline is intact.
    expect(h.calls.architect).toBe(1);
    expect(view.state === 'verified_complete' || view.state === 'failed').toBe(true);

    /**
     * WHATEVER THE OUTCOME, THE SOURCE REPOSITORY IS UNTOUCHED. This is the
     * property the worktree design exists for, and it must hold on a failure
     * path as well as a success one.
     */
    expect(readFileSync(join(root, 'src', 'app.ts'), 'utf8')).toBe(before);
    const status = execFileSync('git', ['status', '--porcelain=v1'], {
      cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: root },
    });
    expect(status.trim(), 'the founder\'s repository is dirty').toBe('');
  }, 120_000);

  it('refuses a Mission whose declared file is protected, before any agent starts', async () => {
    const root = realProject();
    const h = harness();
    delete (h.deps as { runCodingMission?: unknown }).runCodingMission;
    const reg = registry(h, LIVE_ENV, 'fake');
    reg.start({
      missionId: 'm-real-protected',
      objective: 'Disable CI.',
      repositoryTarget: targetFor(root),
      intendedWritePaths: ['.github/workflows/ci.yml'],
    });
    const view = await settle(reg, 'm-real-protected');
    expect(view.state).toBe('failed');
    // And the founder's repository never changed.
    const status = execFileSync('git', ['status', '--porcelain=v1'], {
      cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: root },
    });
    expect(status.trim()).toBe('');
  }, 120_000);

  /* ------------------------------------------------------ shipContext */
  /**
   * `shipContext` is the gate the ship route trusts to decide a mission has
   * something to ship. A review found it wired but never tested directly. It
   * returns non-null ONLY for a mission that is verified_complete AND has a real
   * repository target AND retained a worktree — three conditions the ship route
   * would otherwise have to re-derive. Each of these drives the real registry to
   * a state and asserts the gate's answer, so a regression in any one condition
   * — a mission shippable when it is not — fails here.
   */

  it('shipContext is null for an unknown mission', () => {
    const reg = registry(harness(), LIVE_ENV, 'fake');
    expect(reg.shipContext('no-such-mission')).toBeNull();
  });

  it('beginShip is a mutual-exclusion claim: a second in-flight ship is refused', () => {
    // The concurrent-ship guard, at the registry. A ship route claims a mission
    // before its await; a second concurrent request must see the claim.
    const reg = registry(harness(), LIVE_ENV, 'fake');
    expect(reg.beginShip('m-lock')).toBe(true);
    expect(reg.beginShip('m-lock')).toBe(false); // already in flight
    expect(reg.beginShip('m-other')).toBe(true); // a different mission is free
    reg.endShip('m-lock');
    expect(reg.beginShip('m-lock')).toBe(true); // released, claimable again
  });

  it('shipContext is null for a verified mission with NO repository target', async () => {
    // The ordinary throwaway-fixture path reaches verified_complete, but there
    // is no real target — nothing to ship — and the gate says so.
    // NOTE (defense in depth, not a gap): a no-target mission has BOTH a null
    // repositoryTarget AND a null retainedWorktreePath — the coding leg retains a
    // worktree only for a real target — so conditions 3 and 4 co-fire here.
    // Isolating condition 3 alone would need a null-target-with-worktree record,
    // a state the real pipeline never produces; the target-carrying gate is
    // mutation-proven separately by the no-worktree/ready pair below.
    const { reg } = await runMission(harness(), LIVE_ENV, 'm-ship-no-target');
    expect(reg.get('m-ship-no-target')?.state).toBe('verified_complete');
    expect(reg.shipContext('m-ship-no-target')).toBeNull();
  });

  it('shipContext is null for a verified real-target mission that retained NO worktree', async () => {
    // A real target, but the coding leg kept no worktree (the default outcome's
    // retainedWorktreePath is null): there is nothing on disk to re-judge.
    const target = targetFor(realProject());
    const reg = registry(harness(), LIVE_ENV, 'fake');
    reg.start({
      missionId: 'm-ship-no-wt',
      objective: 'Bump the version constant.',
      repositoryTarget: target,
      intendedWritePaths: ['src/normalize.js'],
    });
    expect((await settle(reg, 'm-ship-no-wt')).state).toBe('verified_complete');
    expect(reg.shipContext('m-ship-no-wt')).toBeNull();
  });

  it('shipContext returns the target and retained worktree for a verified real-target mission', async () => {
    const target = targetFor(realProject());
    const RETAINED = '/tmp/relay-retained-worktree-fixture';
    const h = harness({
      coding: async (hh) => ({
        ...goodCodingOutcome(
          codingHandoffDigest(hh.codingInput!.handoff),
          hh.codingInput!.missionRevision ?? '',
        ),
        retainedWorktreePath: RETAINED,
      }),
    });
    const reg = registry(h, LIVE_ENV, 'fake');
    reg.start({
      missionId: 'm-ship-ready',
      objective: 'Bump the version constant.',
      repositoryTarget: target,
      intendedWritePaths: ['src/normalize.js'],
    });
    expect((await settle(reg, 'm-ship-ready')).state).toBe('verified_complete');
    const ctx = reg.shipContext('m-ship-ready');
    expect(ctx).not.toBeNull();
    expect(ctx?.target.repositoryKey).toBe('local:proj');
    expect(ctx?.worktreePath).toBe(RETAINED);

    // ...and once a ship is RECORDED, the same mission is no longer shippable:
    // the ship route disposes the worktree and calls recordShipOutcome, which a
    // review (Medium) found was missing — without it a shipped mission still
    // read verified_complete and still offered itself for another ship.
    reg.recordShipOutcome('m-ship-ready', { shipped: true });
    expect(reg.shipContext('m-ship-ready')).toBeNull();
    // The mission itself is still verified_complete (recordShipOutcome does not
    // hijack the mission state machine); it simply stops being shippable.
    expect(reg.get('m-ship-ready')?.state).toBe('verified_complete');
  });
});
