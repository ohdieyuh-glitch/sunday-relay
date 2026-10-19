import { describe, it, expect } from 'vitest';
import {
  architectPreflight,
  loadArchitectConfig,
  validateHandoff,
  extractJson,
  runOpenAiArchitect,
  PromptArchitectBlockedError,
} from './openai-architect';
import type { OpenAiArchitectConfig } from './openai-architect';
import { validateHermesReview, hasBlockingFinding, buildReviewPrompt } from './hermes-reviewer';
import { buildAttestation, attestsRealExecution, isPaidApiCall, decideCompletion, digest } from './attestation';
import type { ExecutionAttestation } from './attestation';

/**
 * Three-role honesty invariants. No real provider is ever called here — the
 * OpenAI boundary is a mocked fetch and the Hermes boundary is validated as
 * pure text. These lock the rules that keep the gate report truthful.
 */

const GOOD_HANDOFF = {
  objective: 'Normalize project names',
  task: 'Implement normalizeProjectName',
  implementationInstructions: ['Trim', 'Lowercase', 'Collapse separators'],
  constraints: ['Edit only src/normalize.js'],
  acceptanceCriteria: ['Existing tests pass'],
  allowedFiles: ['src/normalize.js'],
  prohibitedFiles: ['package.json'],
  recommendedChecks: ['node --test'],
};

const okFetch = (content: string, usage = { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }) =>
  (async () =>
    ({
      ok: true,
      status: 200,
      json: async () => ({ id: 'chatcmpl-abcdef123456', choices: [{ message: { content } }], usage }),
    }) as unknown as Response) as unknown as typeof fetch;

const LIVE_CFG: OpenAiArchitectConfig = {
  apiKey: 'test-key',
  model: 'gpt-test',
  mode: 'live',
  maxOutputTokens: 500,
  timeoutMs: 5000,
};

const runArchitect = (fetchImpl: typeof fetch, config: OpenAiArchitectConfig = LIVE_CFG) =>
  runOpenAiArchitect({
    originalRequest: 'Create a production-safe project-name normalization utility.',
    missionId: 'm1',
    objective: 'Normalize project names',
    constraints: ['Edit only src/normalize.js'],
    acceptanceCriteria: ['Existing tests pass'],
    allowedFiles: ['src/normalize.js'],
    prohibitedFiles: ['package.json'],
    verificationCommand: 'node --test test/normalize.test.js',
    projectDescription: 'throwaway fixture',
    config,
    fetchImpl,
    now: () => '2026-07-23T00:00:00.000Z',
  });

describe('1-2. Prompt Architect configuration gate', () => {
  it('a missing key/model/live-mode yields a safe blocked state, never a call', () => {
    expect(architectPreflight({}).ready).toBe(false);
    expect(architectPreflight({ apiKey: 'k', model: 'm' }).missing).toContain('RELAY_PROMPT_ARCHITECT_MODE=live');
    // A key alone must NOT enable live mode.
    expect(architectPreflight({ apiKey: 'k', model: 'm', mode: undefined }).ready).toBe(false);
    expect(architectPreflight({ mode: 'live', model: 'm' }).missing).toContain('OPENAI_API_KEY');
    expect(architectPreflight({ mode: 'live', apiKey: 'k' }).missing).toContain('OPENAI_PROMPT_ARCHITECT_MODEL');
    expect(architectPreflight(LIVE_CFG).ready).toBe(true);
  });

  it('loadArchitectConfig never returns live mode merely because a key exists', () => {
    const cfg = loadArchitectConfig({ OPENAI_API_KEY: 'k' } as NodeJS.ProcessEnv);
    expect(cfg.mode).toBeUndefined();
    expect(architectPreflight(cfg).ready).toBe(false);
  });

  it('an unconfigured architect throws blocked instead of calling the provider', async () => {
    let called = false;
    const spy = (async () => {
      called = true;
      return {} as Response;
    }) as unknown as typeof fetch;
    await expect(runArchitect(spy, { mode: undefined })).rejects.toBeInstanceOf(PromptArchitectBlockedError);
    expect(called).toBe(false);
  });
});

describe('3. Malformed Prompt Architect output is never replaced by a fixture', () => {
  it('rejects non-JSON, empty, and structurally invalid handoffs', async () => {
    await expect(runArchitect(okFetch('not json at all'))).rejects.toBeInstanceOf(PromptArchitectBlockedError);
    await expect(runArchitect(okFetch('   '))).rejects.toBeInstanceOf(PromptArchitectBlockedError);
    await expect(runArchitect(okFetch(JSON.stringify({ objective: 'x' })))).rejects.toBeInstanceOf(
      PromptArchitectBlockedError,
    );
    // Missing required arrays is also a hard failure.
    const missingCriteria = { ...GOOD_HANDOFF, acceptanceCriteria: [] };
    await expect(runArchitect(okFetch(JSON.stringify(missingCriteria)))).rejects.toBeInstanceOf(
      PromptArchitectBlockedError,
    );
  });

  it('validateHandoff accepts a well-formed handoff and extractJson handles fences', () => {
    expect(validateHandoff(GOOD_HANDOFF).task).toBe('Implement normalizeProjectName');
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('a provider auth/credit failure is surfaced honestly, not as a handoff', async () => {
    const fail = (status: number) =>
      (async () => ({ ok: false, status, json: async () => ({}) }) as unknown as Response) as unknown as typeof fetch;
    await expect(runArchitect(fail(401))).rejects.toMatchObject({ code: 'architect_auth_failed' });
    await expect(runArchitect(fail(429))).rejects.toMatchObject({ code: 'architect_rate_limited_or_no_credit' });
  });
});

describe('4 + 15. Handoff is captured with a safe, redacted receipt', () => {
  it('returns a typed handoff and never exposes the key or full request id', async () => {
    const r = await runArchitect(okFetch(JSON.stringify(GOOD_HANDOFF)));
    expect(r.handoff.implementationInstructions).toHaveLength(3);
    expect(r.receipt.billingPath).toBe('api_billed');
    // Sunday Alcatraz coordinates the route; the request itself leaves the
    // bridge directly for OpenAI, and the receipt states that path plainly.
    expect(r.receipt.coordinatedBy).toBe('sunday-alcatraz');
    expect(r.receipt.networkPath).toBe('relay-bridge-direct-openai');
    expect(r.receipt.coordinationLabel).toMatch(/coordinated by sunday alcatraz/i);
    expect(r.receipt.coordinationLabel).not.toMatch(/routed through/i);
    expect(r.receipt.totalTokens).toBe(30);
    expect(r.receipt.requestIdRedacted).toBe('…123456');
    const serialized = JSON.stringify(r);
    expect(serialized).not.toContain('test-key');
    expect(serialized).not.toContain('chatcmpl-abcdef123456');
  });
});

describe('7 + 10 + 11. Hermes review validation', () => {
  it('the review packet carries the artifact + evidence, not the coder conclusion as authority', () => {
    const prompt = buildReviewPrompt({
      missionId: 'm1',
      originalRequest: 'req',
      handoffJson: '{"a":1}',
      baseRevision: 'rev1',
      artifactDigest: 'dig1',
      changedFiles: ['src/normalize.js'],
      unifiedDiff: '--- a\n+++ b',
      changedFileContents: 'function x(){}',
      testCommand: 'node --test',
      testOutput: 'ok',
      relayEvidence: ['tests passed'],
    });
    expect(prompt).toContain('src/normalize.js');
    expect(prompt).toContain('ARTIFACT DIGEST: dig1');
    expect(prompt).toMatch(/judge the artifact yourself/i);
    expect(prompt).toMatch(/no write access/i);
  });

  it('invalid or unparseable Hermes output can NEVER approve', () => {
    expect(validateHermesReview('the code looks good to me, approved!')).toBeNull();
    expect(validateHermesReview('')).toBeNull();
    expect(validateHermesReview('{ broken json')).toBeNull();
    // A JSON object with an invalid verdict is rejected outright.
    expect(validateHermesReview(JSON.stringify({ verdict: 'looks_fine', summary: 'x' }))).toBeNull();
    // Missing summary is rejected.
    expect(validateHermesReview(JSON.stringify({ verdict: 'approved' }))).toBeNull();
  });

  it('a blocking finding is detected even when the verdict says approved', () => {
    const r = validateHermesReview(
      JSON.stringify({
        verdict: 'approved',
        summary: 'ok',
        findings: [{ findingId: 'F-1', severity: 'blocking', requirement: 'r', explanation: 'e', evidence: 'v' }],
        requirementsChecked: [],
      }),
    );
    expect(r).not.toBeNull();
    expect(hasBlockingFinding(r!)).toBe(true);
  });
});

describe('9 + 12 + 13 + 14. Completion authority', () => {
  const att = (role: ExecutionAttestation['role'], over: Partial<ExecutionAttestation> = {}): ExecutionAttestation =>
    buildAttestation({
      missionId: 'm1',
      role,
      requestedActor: 'x',
      actualActor: 'x',
      requestedRuntime: 'r',
      actualRuntime: 'r',
      billingPath: 'api_billed',
      launchVerified: true,
      completionVerified: true,
      fallbackOccurred: false,
      inputDigest: digest('in'),
      startedAt: '2026-07-23T00:00:00.000Z',
      ...over,
    });

  const base = {
    handoffStored: true,
    handoffDeliveredAutomatically: true,
    scopePreserved: true,
    deterministicTestsPassed: true,
    protectedPathsUntouched: true,
    reviewerApproved: true,
    blockingFindings: 0,
    reviewedArtifactDigest: 'd1',
    currentArtifactDigest: 'd1',
  };
  const all = {
    prompt_architect: att('prompt_architect'),
    coding_agent: att('coding_agent', { billingPath: 'subscription' }),
    reviewer: att('reviewer', { billingPath: 'subscription' }),
  };

  it('12. all three attested + approved + evidence => verified_complete', () => {
    expect(decideCompletion({ attestations: all, ...base }).state).toBe('verified_complete');
  });

  it('9. a reviewer that never launched earns no credit', () => {
    const d = decideCompletion({
      attestations: { ...all, reviewer: att('reviewer', { launchVerified: false, completionVerified: false }) },
      ...base,
    });
    expect(d.state).toBe('reviewer_launch_failed');
  });

  it('a launched-but-invalid review is review_incomplete, not approval', () => {
    const d = decideCompletion({
      attestations: { ...all, reviewer: att('reviewer', { completionVerified: false }) },
      ...base,
    });
    expect(d.state).toBe('review_incomplete');
  });

  it('11. a blocking finding => review_blocked (never auto-repaired)', () => {
    expect(decideCompletion({ attestations: all, ...base, blockingFindings: 1 }).state).toBe('review_blocked');
    expect(decideCompletion({ attestations: all, ...base, reviewerApproved: false }).state).toBe('review_blocked');
  });

  it('13. an artifact change after review invalidates it', () => {
    const d = decideCompletion({ attestations: all, ...base, currentArtifactDigest: 'd2' });
    expect(d.state).toBe('review_incomplete');
  });

  it('passing tests alone are NOT sufficient — a missing architect blocks completion', () => {
    const { prompt_architect: _drop, ...rest } = all;
    expect(decideCompletion({ attestations: rest, ...base }).state).toBe('verification_failed');
  });

  it('a fallback can never satisfy a required role', () => {
    const d = decideCompletion({
      attestations: { ...all, prompt_architect: att('prompt_architect', { fallbackOccurred: true }) },
      ...base,
    });
    expect(d.state).toBe('verification_failed');
  });

  it('billing truthfulness: only a real api_billed execution counts as paid', () => {
    expect(isPaidApiCall(att('prompt_architect'))).toBe(true);
    expect(isPaidApiCall(att('reviewer', { billingPath: 'subscription' }))).toBe(false);
    expect(isPaidApiCall(att('prompt_architect', { billingPath: 'simulated' }))).toBe(false);
    // Not launched => not real => not paid.
    expect(attestsRealExecution(att('reviewer', { launchVerified: false }))).toBe(false);
  });
});
