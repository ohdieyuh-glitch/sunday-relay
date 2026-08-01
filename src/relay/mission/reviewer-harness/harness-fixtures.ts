import {
  NO_HARNESS_CAPABILITIES,
  type ProposedReviewResult, type ReviewerHarnessCapabilities,
  type ReviewerHarnessIdentity, type ReviewerHarnessUsage,
} from './harness-contracts';

/**
 * THE DETERMINISTIC FAKE REVIEWER HARNESS — a FIXTURE, not an adapter.
 *
 * It lives in the mission layer beside the contract it satisfies, exactly
 * like the other domain fixtures, because an adapter may never import the
 * mission layer (`relay-core-boundary.test.ts`: adapters do not own mission
 * verdicts). A fixture that IS mission-shaped belongs on the mission side.
 *
 * It implements the canonical adapter's observable surface and makes ZERO
 * provider calls, so the whole suite and Demo Simulation can exercise every
 * path — clean review, findings, blockers, inconclusive, malformed finding,
 * malformed verdict, cancellation, disconnection, known and unknown identity,
 * known and unknown usage.
 *
 * It advertises only what its own tests prove: it streams nothing and has no
 * subagents, so those capabilities stay false.
 */

export type FakeHarnessScenario =
  | 'clean' | 'with_findings' | 'blocked' | 'inconclusive'
  | 'malformed_finding' | 'malformed_verdict' | 'cancelled' | 'disconnected';

/** Capabilities this fake genuinely demonstrates in its tests. */
export const FAKE_HARNESS_CAPABILITIES: ReviewerHarnessCapabilities = Object.freeze({
  ...NO_HARNESS_CAPABILITIES,
  supportsStructuredFindings: true,
  supportsEvidenceReferences: true,
  supportsCancellation: true,
  supportsReadOnlyExecution: true,
  supportsActualIdentity: true,
  supportsLocalExecution: true,
  // Deliberately false: this fake streams nothing and spawns no subagents.
  supportsStreaming: false,
  supportsSubagents: false,
  supportsUsageReporting: true,
});

export const FAKE_HARNESS_ADAPTER_ID = 'fake-reviewer-harness';

/** A fully known identity. `unknownIdentity` omits what a real harness may
    genuinely fail to report. */
export function fakeHarnessIdentity(overrides: Partial<ReviewerHarnessIdentity> = {}): ReviewerHarnessIdentity {
  return {
    role: 'reviewer',
    requestedHarness: 'Fake Harness',
    actualHarness: 'Fake Harness',
    harnessVersion: '0.0.1-fixture',
    harnessAdapterId: FAKE_HARNESS_ADAPTER_ID,
    requestedModel: 'fixture-model',
    actualModel: 'fixture-model',
    provider: 'fixture-provider',
    executionMode: 'simulated',
    runId: 'fake-run-1',
    sessionRefRedacted: '…fixture',
    launchVerified: true,
    ...overrides,
  };
}

export const FAKE_KNOWN_USAGE: ReviewerHarnessUsage = Object.freeze({
  inputTokens: 1200, outputTokens: 340, totalTokens: 1540,
  executionMs: 4200, costMicros: null, currency: null, source: 'harness_reported',
});

const finding = (over: Partial<Record<string, unknown>> = {}): Record<string, unknown> => ({
  proposedId: 'PF1',
  severity: 'major',
  title: 'Unvalidated input reaches the parser',
  description: 'The value is passed to the parser without a length check.',
  affectedFiles: ['src/url.ts'],
  evidenceRefs: ['evidence:diff-1'],
  reproduction: 'Call isValidUrl with a 10MB string.',
  impact: 'A very large input can stall the request.',
  recommendedRepair: 'Bound the input length before parsing.',
  blocking: false,
  ...over,
});

/** The raw result a harness would return, before Relay validates it. */
export function fakeHarnessResult(scenario: FakeHarnessScenario): unknown {
  switch (scenario) {
    case 'clean':
      // A clean review returns NO findings. That is a valid result.
      return { verdict: 'passed', summary: 'No issues found.', findings: [], inspectedEvidenceRefs: ['evidence:diff-1'] };
    case 'with_findings':
      return {
        verdict: 'needs_changes', summary: 'One non-blocking issue.',
        findings: [finding()], inspectedEvidenceRefs: ['evidence:diff-1'],
      };
    case 'blocked':
      return {
        verdict: 'blocked', summary: 'A blocking defect was found.',
        findings: [finding({ proposedId: 'PF2', severity: 'critical', blocking: true })],
        inspectedEvidenceRefs: ['evidence:diff-1', 'evidence:test-1'],
      };
    case 'inconclusive':
      return {
        verdict: 'inconclusive', summary: 'The evidence was insufficient to review.',
        findings: [], inspectedEvidenceRefs: [],
      };
    case 'malformed_finding':
      // Missing impact and recommendedRepair.
      return {
        verdict: 'needs_changes', summary: 'Malformed.',
        findings: [{ proposedId: 'PF3', severity: 'major', title: 'x', description: 'y', affectedFiles: [], evidenceRefs: [], blocking: false }],
        inspectedEvidenceRefs: [],
      };
    case 'malformed_verdict':
      return { verdict: 'looks_fine_to_me', summary: 'Not a canonical verdict.', findings: [], inspectedEvidenceRefs: [] };
    case 'cancelled':
      return { verdict: 'inconclusive', summary: 'Cancelled before completion.', findings: [], inspectedEvidenceRefs: [] };
    case 'disconnected':
      return null;
  }
}

/** The already-validated shape, for tests that need a known-good result. */
export const FAKE_CLEAN_RESULT: ProposedReviewResult = Object.freeze({
  verdict: 'passed', summary: 'No issues found.', findings: [],
  inspectedEvidenceRefs: ['evidence:diff-1'],
});
