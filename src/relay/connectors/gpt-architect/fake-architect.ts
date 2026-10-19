import type { GptRunOutcome, GptRunRequest } from './gpt-runner';

/**
 * THE DETERMINISTIC OFFLINE FAKE.
 *
 * Implements the same outcome contract as the live runner and makes ZERO
 * provider calls, so the whole automated suite and Demo Simulation can
 * exercise every path — success, refusal, malformed output, timeout,
 * cancellation, disconnection, known and unknown usage — without an account.
 *
 * It never imports the OpenAI SDK.
 */

export type FakeScenario =
  | 'success' | 'success_needs_input' | 'refused' | 'malformed'
  | 'incomplete' | 'timeout' | 'disconnected' | 'unknown_usage';

const PLAN = {
  objectiveSummary: 'Design a small TypeScript URL-validation module.',
  assumptions: [
    { id: 'A1', statement: 'Only http and https schemes must be accepted.', confidence: 'medium' },
  ],
  unresolvedQuestions: [
    { id: 'Q1', question: 'Should internationalized domains be supported?', blocksImplementation: false },
  ],
  requirements: [
    { id: 'R1', statement: 'Expose isValidUrl(value: string): boolean.', rationale: 'A single predicate keeps the surface small.' },
  ],
  architectureDecisions: [
    {
      id: 'D1', decision: 'Use the WHATWG URL parser rather than a regular expression.',
      rationale: 'The platform parser is correct by construction and needs no maintenance.',
      alternativesConsidered: ['hand-written regular expression'], accepted: false,
    },
  ],
  implementationSteps: [
    { order: 1, description: 'Add src/url.ts exporting isValidUrl.', filesTouched: ['src/url.ts'] },
    { order: 2, description: 'Add src/url.test.ts covering valid and invalid inputs.', filesTouched: ['src/url.test.ts'] },
  ],
  acceptanceCriteria: ['isValidUrl returns false for a non-http scheme.'],
  testPlan: ['One focused vitest file asserting accepted and rejected inputs.'],
  risks: [
    { id: 'RISK1', risk: 'Over-permissive parsing accepts unintended schemes.', mitigation: 'Assert the scheme explicitly.', severity: 'medium' },
  ],
  prohibitedActions: ['Do not add a dependency.'],
  handoff: {
    objective: 'Add a bounded URL validation module.',
    boundedTask: 'Create src/url.ts and src/url.test.ts.',
    acceptanceCriteria: ['isValidUrl rejects non-http(s) schemes.'],
    requiredTests: ['src/url.test.ts'],
    allowedFileScope: ['src/url.ts', 'src/url.test.ts'],
    prohibitedActions: ['Do not modify unrelated files.'],
    grantedTools: ['Read files', 'Edit assigned files'],
    missionContractRef: 'fixture:mission-contract',
    environmentRef: null,
    expectedEvidence: ['test result', 'changed files'],
  },
  proposedContractAmendments: [],
  contextRefs: ['ctx-user-request'],
};

/** A deterministic outcome for the requested scenario. No network, ever. */
export function runFakeArchitect(
  scenario: FakeScenario,
  _request?: Partial<GptRunRequest>,
): GptRunOutcome {
  const usage = {
    inputTokens: 812, cachedInputTokens: 0, outputTokens: 431,
    reasoningTokens: 96, totalTokens: 1243,
  };
  const unknownUsage = {
    inputTokens: null, cachedInputTokens: null, outputTokens: null,
    reasoningTokens: null, totalTokens: null,
  };

  switch (scenario) {
    case 'success':
      return {
        ok: true, actualModel: 'fake-architect-model', responseId: 'resp_fake_success',
        status: 'completed', outputText: JSON.stringify(PLAN), usage,
      };
    case 'success_needs_input':
      return {
        ok: true, actualModel: 'fake-architect-model', responseId: 'resp_fake_needs_input',
        status: 'completed',
        outputText: JSON.stringify({
          ...PLAN,
          unresolvedQuestions: [
            { id: 'Q1', question: 'Which schemes are permitted?', blocksImplementation: true },
          ],
        }),
        usage,
      };
    case 'unknown_usage':
      return {
        ok: true, actualModel: 'fake-architect-model', responseId: 'resp_fake_no_usage',
        status: 'completed', outputText: JSON.stringify(PLAN), usage: unknownUsage,
      };
    case 'refused':
      return {
        ok: false, failureClass: 'refused',
        message: 'The provider refused this request.',
        actualModel: 'fake-architect-model', responseId: 'resp_fake_refused',
      };
    case 'malformed':
      return {
        ok: true, actualModel: 'fake-architect-model', responseId: 'resp_fake_malformed',
        status: 'completed', outputText: '{ "objectiveSummary": "truncated', usage,
      };
    case 'incomplete':
      return {
        ok: false, failureClass: 'incomplete_response',
        message: 'The response was incomplete (max_output_tokens).',
        actualModel: 'fake-architect-model', responseId: 'resp_fake_incomplete',
      };
    case 'timeout':
      return { ok: false, failureClass: 'timeout', message: 'The planning request timed out.' };
    case 'disconnected':
      return {
        ok: false, failureClass: 'network_disconnected',
        message: 'The connection to the provider was lost.',
      };
  }
}

/** The plan the fake returns, for tests that assert on its content. */
export const FAKE_ARCHITECT_PLAN = PLAN;
