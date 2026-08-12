/**
 * TEST SUPPORT — fake role boundaries that drive the REAL `mission.ts` pipeline
 * to `verified_complete` without contacting OpenAI, Claude Code, or Hermes.
 *
 * The happy-path fixtures are the ones proven in `orchestrator.test.ts`; they
 * live here too so a full-stack test can boot `createBridgeServer` with a REAL
 * `createMissionRegistry` and watch a mission run through the HTTP surface. This
 * is test infrastructure, not a second engine — the pipeline it exercises is the
 * one and only `mission.ts`.
 */

import { buildAttestation, digest, type ExecutionAttestation } from './attestation';
import { codingHandoffDigest, type CodingOutcome } from './coding';
import type { MissionRoleDeps } from './mission';
import type { HermesOutcome } from './hermes-reviewer';
import type { OpenAiArchitectResult } from './openai-architect';
import type { CodingTerminalState } from './types';

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

const ARTIFACT_DIGEST = digest('artifact-v1');

const ARCHITECT_RESULT: OpenAiArchitectResult = {
  handoff: GOOD_HANDOFF,
  receipt: {
    provider: 'openai',
    model: 'gpt-test',
    requestedModel: 'gpt-test',
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

function goodCodingOutcome(handoffDigest: string, missionRevision: string): CodingOutcome {
  return {
    verifiedComplete: false,
    verificationPassed: true,
    deterministicPassed: true,
    inspectionAssessment: 'allowed',
    filesChanged: ['src/normalize.js'],
    protectedChanges: [],
    sourceUnchanged: true,
    completionOutcome: 'unsatisfied',
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
      inspectionAssessment: 'allowed',
      testCommand: 'node --test test/normalize.test.js',
      testPassed: true,
      testExitCode: 0,
      testOutput: 'ok 3',
      unifiedDiff: '--- a/src/normalize.js\n+++ b/src/normalize.js',
      claimedFileContent: 'export function normalizeProjectName() {}',
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

export interface JourneyHarness {
  readonly deps: MissionRoleDeps;
  readonly calls: { architect: number; fusion: number; coding: number; reviewer: number };
}

/**
 * Fake role deps that carry the real pipeline to `verified_complete`. The
 * architect is the FUSION (offline) path so no provider key is required; the
 * coding leg emits real state transitions and a terminal, and the reviewer
 * approves. Every call is counted so a test can assert who actually ran.
 */
export function journeyRoleDeps(): JourneyHarness {
  const calls = { architect: 0, fusion: 0, coding: 0, reviewer: 0 };
  const deps: MissionRoleDeps = {
    resolveClaudeRuntime: () => ({
      ok: true,
      runtime: {
        executablePath: '/fake/claude',
        capabilities: { executablePath: '/fake/claude' } as never,
        provenance: 'fake',
      },
    }),
    hermesPreflight: () => ({
      ready: true,
      missing: [],
      reason: null,
      executable: 'hermes',
      oneShotSupported: true,
      readOnlySupported: true,
      model: 'claude-opus-4-8',
      provider: 'Anthropic',
      authenticatedProviders: ['Anthropic'],
      livenessVerified: true,
      billingPath: 'subscription',
    }) as never,
    runOpenAiArchitect: async () => { calls.architect += 1; return ARCHITECT_RESULT; },
    runFusionArchitect: async () => {
      calls.fusion += 1;
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
      } as never;
    },
    runCodingMission: async (input) => {
      calls.coding += 1;
      input.onState?.('coding');
      input.publishTerminal?.(terminalState());
      input.onState?.('claim_submitted');
      input.onState?.('relay_verifying');
      return goodCodingOutcome(codingHandoffDigest(input.handoff), input.missionRevision ?? '');
    },
    runHermesReview: async () => { calls.reviewer += 1; return approvedReview(); },
    relayPreflight: () => ({ ready: true, missing: [] }),
  };
  return { deps, calls };
}
