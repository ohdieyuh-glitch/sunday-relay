/**
 * THE J1 ROLE-TO-CREDENTIAL MAPPING, PROVEN OFFLINE.
 *
 * The Agentic Architect (role PROMPT_ARCHITECT) is Anthropic on ANTHROPIC_ARCHITECT_API_KEY;
 * the Coding Agent is Anthropic on ANTHROPIC_API_KEY; the reviewer is xAI. Nothing here
 * opens a socket: the architect's transport is an injected fetch.
 */

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import {
  JULIUS_CONTEXT_COMPILER_VERSION, JuliusDispatchError, safeReviewDiagnostics, type JuliusContextSnapshot,
} from '../../src/relay/mission/julius';
import {
  JULIUS_HANDED_FAILURE_OUTCOME_UNKNOWN, juliusHandedOutcomeUnknown,
} from '../../src/relay/mission/julius/julius-execution-coordinator';
import {
  ANTHROPIC_SCHEMA_KEYWORDS, anthropicStructuredOutputSchema, createJ1ArchitectRunner, runAnthropicArchitect, type ArchitectRunner,
} from '../../src/relay/connectors/gpt-architect/anthropic-architect-runner';
import { ARCHITECT_PLAN_SCHEMA } from '../../src/relay/connectors/gpt-architect/plan-schema';
import { ARCHITECT_GUIDANCE_SCHEMA } from '../../src/relay/connectors/gpt-architect/guidance-schema';
import { ARCHITECT_REBUTTAL_SCHEMA } from '../../src/relay/connectors/gpt-architect/rebuttal-schema';
import { ARCHITECT_CONSULTATION_SCHEMA } from '../../src/relay/connectors/gpt-architect/architecture-schema';
import { JULIUS_RESEARCH_ASK_LIMITS, sanitizeJuliusResearchAsks, withJuliusResearchAsks } from '../../src/relay/mission/julius/julius-research-protocol';
import { LIVE_REACH_READ_CAPABILITIES, LIVE_REACH_SOURCES } from '../../src/relay/mission/live-reach';
import { HOSTED_API_KEY_ENV, HOSTED_MODEL_ENV } from '../hosted-coding-agent/hosted-readiness';
import type { ShellEffectPort } from './executor-effects';
import { architectCorrectionMaxTokens, architectProviderRefusalLine, createInMemoryArtifactExchange } from './live-workers';
import { resolveLiveWorkers } from './live-composition';
import {
  J1_ROLE_CREDENTIALS, architectIndependenceProblems, j1RoleCredential, resolveArchitectCredential,
} from './live-composition';

const { ORG_ATTRIBUTION_ROLE_ENV } = createRequire(__filename)('../../scripts/julius-org-attribution.mjs') as {
  ORG_ATTRIBUTION_ROLE_ENV: Record<'architect' | 'coder', { key: string; expected: string; model: string }>;
};

const ARCHITECT_KEY = 'FAKETESTNOTREAL-architect-key';
const CODER_KEY = 'FAKETESTNOTREAL-coder-key';
/* Fixture organization ids only. */
const ORGS = { architect: 'aff8a85a-82c3-4ca7-afa7-8d3f63856dc4', coder: 'be82739b-746c-4288-a91b-6a332816e790' };

const J1_ENV: Record<string, string> = {
  JULIUS_ARCHITECT_PROVIDER: 'anthropic',
  ANTHROPIC_ARCHITECT_API_KEY: ARCHITECT_KEY,
  RELAY_ANTHROPIC_ARCHITECT_MODEL: 'claude-opus-5-5',
  RELAY_PROMPT_ARCHITECT_MODE: 'live',
  RELAY_PROMPT_ARCHITECT_MAX_TOKENS: '20000',
  ANTHROPIC_API_KEY: CODER_KEY,
  RELAY_HOSTED_CODING_MODEL: 'claude-opus-5-5',
  RELAY_HERMES_PROVIDER: 'xai',
  RELAY_HERMES_MODEL: 'grok-build-0.1',
  RELAY_HERMES_EXECUTABLE: '/usr/bin/true',
};

const SHELL = { async run() { throw new Error('the shell is not used here'); } } as unknown as ShellEffectPort;

function resolve(env: Record<string, string | undefined>, extra: Partial<Parameters<typeof resolveLiveWorkers>[0]> = {}) {
  return resolveLiveWorkers({
    env, projectId: 'proj-1', workspacePath: '/tmp/ws', testCommand: 'npm test',
    contexts: { snapshotFor: () => SNAPSHOT }, artifacts: createInMemoryArtifactExchange(), shell: null,
    ...extra,
  });
}

const SNAPSHOT: JuliusContextSnapshot = {
  contextId: 'ctx-1', runId: 'run-live', taskId: 'plan-1', workerId: 'prompt-architect-anthropic',
  workerRole: 'PROMPT_ARCHITECT', compilerVersion: JULIUS_CONTEXT_COMPILER_VERSION,
  missionContractRevision: 1, cardRevision: 'card-test-1', projectBrainRevision: 0,
  taskContractRevision: 1, taskContractDigest: 'sha256:contract',
  sourceEntryIds: [], dependencyTaskIds: [], evidenceIds: [], findingIds: [],
  acceptanceCriterionIds: ['AC-1'], contentHash: 'sha256:test',
  integrityVersion: null, integrityConflicts: null, integrityExcludedEntryIds: null, integrityEvictedEntryIds: null,
  characterCount: 24, redactionCount: 0, truncated: false,
  packet: { missionId: 'mission-1', taskId: 'plan-1', workerId: 'prompt-architect-anthropic', sourceEntryIds: [], blocks: [{ kind: 'CONSTRAINT', text: 'OBJECTIVE: test' }], truncated: false },
};

const DISPATCH = { taskId: 'plan-1', attempt: { leaseGeneration: 1 }, contextId: 'ctx-1', taskType: 'plan' } as const;

describe('the role-to-credential table', () => {
  it('names one provider, key, expected organization and model per role, and the two Anthropic roles share none of them', () => {
    expect(J1_ROLE_CREDENTIALS.map((row) => [row.role, row.provider, row.keyEnv, row.expectedOrgEnv])).toEqual([
      ['PROMPT_ARCHITECT', 'anthropic', 'ANTHROPIC_ARCHITECT_API_KEY', 'JULIUS_EXPECTED_ANTHROPIC_ARCHITECT_ORG_ID'],
      ['CODING_AGENT', 'anthropic', 'ANTHROPIC_API_KEY', 'JULIUS_EXPECTED_ANTHROPIC_ORG_ID'],
      ['INDEPENDENT_REVIEWER', 'xai', 'XAI_API_KEY', null],
    ]);
    expect(j1RoleCredential('PROMPT_ARCHITECT').displayName).toBe('Agentic Architect');
    // The coder row is the hosted Coding Agent's own variables.
    expect(j1RoleCredential('CODING_AGENT').keyEnv).toBe(HOSTED_API_KEY_ENV);
    expect(j1RoleCredential('CODING_AGENT').modelEnv).toBe(HOSTED_MODEL_ENV);
  });

  it('the spend-free org script reads exactly the table names for each role', () => {
    for (const [role, row] of [['architect', j1RoleCredential('PROMPT_ARCHITECT')], ['coder', j1RoleCredential('CODING_AGENT')]] as const) {
      expect(ORG_ATTRIBUTION_ROLE_ENV[role]).toEqual({ key: row.keyEnv, expected: row.expectedOrgEnv, model: row.modelEnv });
    }
  });
});

describe('the architect reads its own key only, and the coder its own', () => {
  it('the Anthropic architect resolves from ANTHROPIC_ARCHITECT_API_KEY and never from ANTHROPIC_API_KEY or OpenAI', () => {
    const resolved = resolveArchitectCredential({ ...J1_ENV, OPENAI_API_KEY: 'FAKETESTNOTREAL-openai', OPENAI_PROMPT_ARCHITECT_MODEL: 'gpt-5.6-sol' });
    expect(resolved).toMatchObject({ ok: true, provider: 'anthropic', keyEnv: 'ANTHROPIC_ARCHITECT_API_KEY', apiKey: ARCHITECT_KEY });
    expect(resolved.config.model).toBe('claude-opus-5-5');
    expect(resolved.config.maxOutputTokens).toBe(20_000);
  });

  it('MUTATION: an unset architect key refuses by name and does not fall back to ANTHROPIC_API_KEY or OpenAI', () => {
    const { ANTHROPIC_ARCHITECT_API_KEY: _unset, ...without } = J1_ENV;
    const env = { ...without, OPENAI_API_KEY: 'FAKETESTNOTREAL-openai', OPENAI_PROMPT_ARCHITECT_MODEL: 'gpt-5.6-sol' };
    expect(resolveArchitectCredential(env)).toMatchObject({ ok: false, reason: 'live_config_missing', missing: ['ANTHROPIC_ARCHITECT_API_KEY'] });
    const resolution = resolve(env);
    expect(resolution.ok).toBe(false);
    expect(resolution.problems).toContainEqual({ role: 'PROMPT_ARCHITECT', reason: 'live_config_missing', missing: ['ANTHROPIC_ARCHITECT_API_KEY'] });
    expect(resolution.entries).toEqual([]);
  });

  it('an unset coder key refuses the coder by name; the architect key is not borrowed', () => {
    const { ANTHROPIC_API_KEY: _unset, ...without } = J1_ENV;
    const resolution = resolve(without);
    const coder = resolution.problems.find((problem) => problem.role === 'CODING_AGENT');
    expect(coder?.missing).toContain('ANTHROPIC_API_KEY');
  });

  it('an unknown architect provider is refused by name, never defaulted', () => {
    expect(resolveArchitectCredential({ ...J1_ENV, JULIUS_ARCHITECT_PROVIDER: 'antropic' })).toMatchObject({ ok: false, reason: 'architect_provider_unknown' });
  });

  it('OpenAI is not required: the J1 composition resolves the architect with no OpenAI variable at all', () => {
    const resolution = resolve(J1_ENV);
    expect(resolution.problems.filter((problem) => problem.role === 'PROMPT_ARCHITECT')).toEqual([]);
    expect(JSON.stringify(resolution.problems)).not.toContain('OPENAI');
    expect(resolution.requested.architectModel).toBe('claude-opus-5-5');
  });

  it('the architect dispatch sends ANTHROPIC_ARCHITECT_API_KEY, and nothing else, to its runner', async () => {
    const keys: string[] = [];
    const run: ArchitectRunner = async (request) => {
      keys.push(request.apiKey);
      return { ok: false, failureClass: 'authentication_failed', message: 'fixture' };
    };
    const resolution = resolve(J1_ENV, { shell: SHELL, verifiedOrganizations: ORGS, runners: { architect: run } });
    const architect = resolution.entries.find((entry) => entry.worker.role === 'PROMPT_ARCHITECT');
    expect(architect?.worker).toMatchObject({ workerId: 'prompt-architect-anthropic', adapterId: 'anthropic-architect-live', providerId: 'anthropic', role: 'PROMPT_ARCHITECT' });
    await expect(architect!.adapter.dispatch(DISPATCH)).rejects.toMatchObject({ code: 'AUTH_CONFIGURATION' });
    expect(keys).toEqual([ARCHITECT_KEY]);
  });
});

describe('architect_not_independent: defence in depth for two Anthropic roles', () => {
  const base = { architectProvider: 'anthropic', coderProvider: 'anthropic', reviewerProvider: 'xai', requireOrganizations: true } as const;

  it('independent: different key variables, different keys, different verified organizations, a third provider reviewing', () => {
    expect(architectIndependenceProblems({ ...base, env: J1_ENV, organizations: ORGS })).toEqual([]);
    expect(resolve(J1_ENV, { shell: SHELL, verifiedOrganizations: ORGS }).problems
      .filter((problem) => problem.reason === 'architect_not_independent')).toEqual([]);
  });

  it('(a) MUTATION: the same key in both variables is refused', () => {
    expect(architectIndependenceProblems({ ...base, env: { ...J1_ENV, ANTHROPIC_ARCHITECT_API_KEY: CODER_KEY }, organizations: ORGS }))
      .toContain('architect_and_coder_share_a_key');
  });

  it('(b) MUTATION: the same verified organization is refused, and a dispatching composition without verified organizations is refused', () => {
    expect(architectIndependenceProblems({ ...base, env: J1_ENV, organizations: { architect: ORGS.coder, coder: ORGS.coder } }))
      .toContain('architect_and_coder_share_an_organization');
    const unverified = resolve(J1_ENV, { shell: SHELL });
    expect(unverified.ok).toBe(false);
    expect(unverified.problems).toContainEqual({ role: 'PROMPT_ARCHITECT', reason: 'architect_not_independent', missing: ['organizations_not_verified'] });
    const same = resolve(J1_ENV, { shell: SHELL, verifiedOrganizations: { architect: ORGS.coder, coder: ORGS.coder } });
    expect(same.problems).toContainEqual({ role: 'PROMPT_ARCHITECT', reason: 'architect_not_independent', missing: ['architect_and_coder_share_an_organization'] });
    // The preflight's composition cannot dispatch, so it is checked on (a) and (c) only.
    expect(resolve(J1_ENV).problems.filter((problem) => problem.reason === 'architect_not_independent')).toEqual([]);
  });

  it('(c) MUTATION: a reviewer on the architect\'s or coder\'s provider is refused', () => {
    expect(architectIndependenceProblems({ ...base, env: J1_ENV, organizations: ORGS, reviewerProvider: 'anthropic' }))
      .toContain('reviewer_shares_a_provider_with_architect_or_coder');
  });
});

describe('a refused Anthropic architect request: classified, recorded in existing columns, never retried', () => {
  const RATE = {
    'request-id': 'req_011CFAKEREQUEST0001',
    'anthropic-ratelimit-requests-limit': '50', 'anthropic-ratelimit-requests-remaining': '0',
    'anthropic-ratelimit-tokens-limit': '90000', 'anthropic-ratelimit-tokens-remaining': '12',
  };
  const refusingRaw = (status: number, raw: string, calls: { count: number }): typeof fetch =>
    (async () => {
      calls.count += 1;
      return new Response(raw, { status, headers: RATE });
    }) as unknown as typeof fetch;

  async function dispatchRefused(status: number, type: string, message: string) {
    return dispatchRaw(status, JSON.stringify({ type: 'error', error: { type, message } }));
  }

  async function dispatchRaw(status: number, raw: string) {
    const calls = { count: 0 };
    const lines: string[] = [];
    const resolution = resolve(J1_ENV, {
      shell: SHELL, verifiedOrganizations: ORGS, report: (line) => lines.push(line),
      runners: { architect: createJ1ArchitectRunner({ fetch: refusingRaw(status, raw, calls) }) },
    });
    const architect = resolution.entries.find((entry) => entry.worker.role === 'PROMPT_ARCHITECT')!;
    const error = await architect.adapter.dispatch(DISPATCH).then(() => null, (thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(JuliusDispatchError);
    return { error: error as JuliusDispatchError, calls, lines };
  }

  it('#479 UNCHANGED: a 429 after the handoff is one call and OUTCOME UNKNOWN, never retried', async () => {
    const { error, calls, lines } = await dispatchRefused(429, 'rate_limit_error', 'rate limited');
    expect(calls.count).toBe(1);
    expect(error).toMatchObject({ code: 'RATE_LIMIT', retryable: true, failureClass: 'rate_limited' });
    expect(error.diagnostics?.runtimeStarted, 'nothing attests the provider processed nothing').not.toBe(false);
    expect(juliusHandedOutcomeUnknown(error, true)).toBe(JULIUS_HANDED_FAILURE_OUTCOME_UNKNOWN);
    expect(lines).toEqual([
      'provider_refusal role=PROMPT_ARCHITECT provider=anthropic http=429 type=rate_limit_error limit_tokens=90000 remaining_tokens=12 limit_requests=50 remaining_requests=0 request_id=req_011CFAKEREQUEST0001'
        + ' error_code=none message_class=other message_bytes=12 message_sha256=d292012eb3769a2f60ab0b28588143cc1a936b37cf63a76637e646b7c34fa5d1 excerpt=kept message="rate limited"',
    ]);
  });

  it('MUTATION: insufficient credit is AUTH_CONFIGURATION, non-retryable, one call', async () => {
    const { error, calls } = await dispatchRefused(400, 'invalid_request_error', 'Your credit balance is too low to access the Anthropic API.');
    expect(calls.count).toBe(1);
    expect(error).toMatchObject({ code: 'AUTH_CONFIGURATION', retryable: false, failureClass: 'insufficient_credit' });
    expect(juliusHandedOutcomeUnknown(error, true), 'non-retryable is never retried, before or after the handoff').toBeNull();
  });

  it('the evidence lands in the existing columns, through the domain allowlist', async () => {
    const { error } = await dispatchRefused(529, 'overloaded_error', 'busy');
    const row = safeReviewDiagnostics(error.diagnostics);
    expect(row).toMatchObject({
      transport: 'anthropic', provider: 'anthropic', providerHttpStatus: 529,
      providerRequestId: 'req_011CFAKEREQUEST0001', providerRequestAvailability: 'CAPTURED', providerRequestUnavailableReason: null,
      failureShape: 'anthropic_error_overloaded_error',
    });
    expect(error.diagnostics?.costBasis, 'no price table exists for this model: UNKNOWN, never $0').toBe('UNKNOWN');
  });

  it('MUTATION: the key never reaches the error, its message, its diagnostics or the stdout line', async () => {
    const { error, lines } = await dispatchRefused(401, 'authentication_error', `invalid x-api-key ${ARCHITECT_KEY}`);
    const everything = JSON.stringify({ message: error.message, safe: error.safeMessage, diagnostics: error.diagnostics, lines });
    expect(everything).not.toContain('FAKETESTNOTREAL');
    expect(everything).not.toContain(CODER_KEY);
  });

  // THE SANITIZED MESSAGE FIELDS (run 40698923582's 400 was undiagnosable). The
  // class, retryability and call count of every body below are asserted
  // unchanged; the new fields come after request_id, so the old prefix is intact.
  const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
  const OLD_PREFIX_400 = 'provider_refusal role=PROMPT_ARCHITECT provider=anthropic http=400 type=invalid_request_error limit_tokens=90000 remaining_tokens=12 limit_requests=50 remaining_requests=0 request_id=req_011CFAKEREQUEST0001 ';
  const bodyOf = (message: string, details?: Record<string, unknown>): string =>
    JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message, ...(details === undefined ? {} : { details }) } });
  const assertOneSafeLine = (lines: readonly string[], raw: string): string => {
    expect(lines).toHaveLength(1);
    const line = lines[0]!;
    expect(line, 'one printable-ASCII line').toMatch(/^[\x20-\x7e]+$/u);
    if (raw.length > 0) expect(line, 'never the raw body').not.toContain(raw);
    for (const header of Object.keys(RATE)) expect(line, 'never a header name').not.toContain(header);
    expect(line, 'the message value is the last field and closes the line').toMatch(/ message="(?:[^"\\]|\\.)*"$/u);
    return line;
  };

  const bodies: readonly [string, string, string, string, boolean][] = [
    ['spend limit', 'You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC.', 'spend_limit', 'WORKER_EXECUTION_FAILURE', false],
    ['credit too low', 'Your credit balance is too low to access the Anthropic API.', 'credit_too_low', 'AUTH_CONFIGURATION', true],
    ['schema too complex', 'Schema is too complex for compilation.', 'schema_too_complex', 'WORKER_EXECUTION_FAILURE', false],
    ['workspace header', 'anthropic-workspace-id header is not valid', 'workspace_header', 'WORKER_EXECUTION_FAILURE', false],
    ['other', 'messages: field required', 'other', 'WORKER_EXECUTION_FAILURE', false],
  ];
  for (const [label, message, messageClass, code, credit] of bodies) {
    it(`MUTATION: ${label} -> message_class=${messageClass}, ${code} exactly as before, one call`, async () => {
      const raw = bodyOf(message, { error_code: 'fake_code' });
      const { error, calls, lines } = await dispatchRaw(400, raw);
      expect(calls.count).toBe(1);
      expect(error).toMatchObject({ code, failureClass: credit ? 'insufficient_credit' : 'provider_error' });
      if (credit) expect(error).toMatchObject({ retryable: false });
      const line = assertOneSafeLine(lines, raw);
      expect(line).toBe(`${OLD_PREFIX_400}error_code=fake_code message_class=${messageClass} message_bytes=${Buffer.byteLength(message)} message_sha256=${sha(message)} excerpt=kept message="${message}"`);
      const row = JSON.stringify(safeReviewDiagnostics(error.diagnostics));
      expect(row, 'the excerpt goes to stdout only, never the diagnostics row').not.toContain(message);
      expect(JSON.stringify({ m: error.message, s: error.safeMessage }), 'nor the error message').not.toContain(message);
    });
  }

  it('MUTATION: an sk-ant key and a 40-character hex token never reach the line; quotes and backslashes are escaped', async () => {
    const message = 'bad "key" sk-ant-api03-FAKE0000 at C:\\path trace ' + 'deadbeef'.repeat(5);
    const raw = bodyOf(message);
    const { lines } = await dispatchRaw(400, raw);
    const line = assertOneSafeLine(lines, raw);
    expect(line).not.toContain('FAKE0000');
    expect(line).not.toContain('deadbeef');
    expect(line.endsWith(` message_sha256=${sha(message)} excerpt=kept message="bad \\"key\\" [redacted] at C:\\\\path trace [redacted]"`)).toBe(true);
  });

  it('MUTATION: a 10 KB message is cut to 240 characters on the line; length and digest are of the whole message', async () => {
    const message = `You have reached your specified API usage limits. ${'pad '.repeat(2_600)}TAILMARKER`;
    const raw = bodyOf(message);
    const { error, lines } = await dispatchRaw(400, raw);
    expect(error).toMatchObject({ code: 'WORKER_EXECUTION_FAILURE', failureClass: 'provider_error' });
    const line = assertOneSafeLine(lines, raw);
    const excerpt = /message="(.*)"$/u.exec(line)![1]!;
    expect(excerpt.length).toBeLessThanOrEqual(240);
    expect(line).not.toContain('TAILMARKER');
    expect(line).toContain(` message_class=spend_limit message_bytes=${message.length} message_sha256=${sha(message)} excerpt=kept `);
    // The classifying read stops at 8,192 characters, as before, so no type reaches the line.
    expect(line).toContain(' type=unknown ');
  });

  it('non-ASCII and control characters cannot break the line', async () => {
    const message = 'one\ntwo\r\n::error::three\u0000 caf\u00e9 \u2028 \ud83d\ude00';
    const { lines } = await dispatchRaw(400, bodyOf(message));
    const line = assertOneSafeLine(lines, '');
    expect(line.endsWith(`message_bytes=${Buffer.byteLength(message)} message_sha256=${sha(message)} excerpt=kept message="one two ::error::three caf? ?"`)).toBe(true);
  });

  it('a non-JSON body and an empty body: no message evidence, class and code exactly as before', async () => {
    for (const raw of ['<html>Bad Gateway sk-ant-api03-FAKE0000</html>', '']) {
      const { error, calls, lines } = await dispatchRaw(400, raw);
      expect(calls.count).toBe(1);
      expect(error).toMatchObject({ code: 'WORKER_EXECUTION_FAILURE', failureClass: 'provider_error' });
      const line = assertOneSafeLine(lines, raw);
      expect(line).toBe('provider_refusal role=PROMPT_ARCHITECT provider=anthropic http=400 type=unknown limit_tokens=90000 remaining_tokens=12 limit_requests=50 remaining_requests=0 request_id=req_011CFAKEREQUEST0001'
        + ' error_code=none message_class=unavailable message_bytes=unknown message_sha256=unknown excerpt=none message=""');
    }
  });

  it('an omitted excerpt is never printed, even if the evidence object still carries text', () => {
    const base = {
      httpStatus: 400, errorType: 'invalid_request_error', errorTypeUnparseable: false, requestId: null, requestIdUnavailableReason: 'request_id_header_absent' as const,
      rateLimit: {
        requestsLimit: null, requestsRemaining: null, tokensLimit: null, tokensRemaining: null,
        inputTokensLimit: null, inputTokensRemaining: null, outputTokensLimit: null, outputTokensRemaining: null,
      },
    };
    for (const omitted of ['prompt_overlap', 'unsafe_residue'] as const) {
      const line = architectProviderRefusalLine('anthropic', {
        ...base,
        providerMessage: { messageClass: 'other', errorCode: null, errorCodeUnusable: false, excerpt: 'PROMPTSECRET', excerptOmitted: omitted, messageBytes: 12, messageSha256: 'a'.repeat(64) },
      });
      expect(line.endsWith(` excerpt=omitted_${omitted} message=""`)).toBe(true);
      expect(line).not.toContain('PROMPTSECRET');
    }
    const nullExcerpt = architectProviderRefusalLine('anthropic', {
      ...base,
      providerMessage: { messageClass: 'other', errorCode: null, errorCodeUnusable: false, excerpt: null, excerptOmitted: null, messageBytes: 1, messageSha256: 'a'.repeat(64) },
    });
    expect(nullExcerpt.endsWith(' excerpt=omitted_unsafe_residue message=""')).toBe(true);
  });

  it('MUTATION: a provider message that echoes the real dispatched prompt is omitted from the line; class unchanged', async () => {
    let seen = '';
    const calls = { count: 0 };
    const lines: string[] = [];
    const echoing = (async (_url: unknown, init?: RequestInit) => {
      calls.count += 1;
      const sent = JSON.parse(String(init?.body)) as { system: string };
      seen = sent.system.replace(/\s+/gu, ' ').slice(0, 80);
      return new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: `system: ${seen} is invalid` } }), { status: 400, headers: RATE });
    }) as unknown as typeof fetch;
    const resolution = resolve(J1_ENV, {
      shell: SHELL, verifiedOrganizations: ORGS, report: (line) => lines.push(line),
      runners: { architect: createJ1ArchitectRunner({ fetch: echoing }) },
    });
    const architect = resolution.entries.find((entry) => entry.worker.role === 'PROMPT_ARCHITECT')!;
    const error = await architect.adapter.dispatch(DISPATCH).then(() => null, (thrown: unknown) => thrown);
    expect(error).toMatchObject({ code: 'WORKER_EXECUTION_FAILURE', failureClass: 'provider_error' });
    expect(calls.count).toBe(1);
    expect(seen.length).toBeGreaterThan(40);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(' excerpt=omitted_prompt_overlap message=""');
    expect(lines[0]).not.toContain(seen.slice(0, 30));
  });

  it('the line re-checks what it is handed: a hostile excerpt, code or class cannot break it', () => {
    const line = architectProviderRefusalLine('anthropic', {
      httpStatus: 400, errorType: null, errorTypeUnparseable: false, requestId: null, requestIdUnavailableReason: 'request_id_header_absent',
      rateLimit: {
        requestsLimit: null, requestsRemaining: null, tokensLimit: null, tokensRemaining: null,
        inputTokensLimit: null, inputTokensRemaining: null, outputTokensLimit: null, outputTokensRemaining: null,
      },
      providerMessage: {
        messageClass: 'evil class' as never, errorCode: 'a b', errorCodeUnusable: false,
        excerpt: `x"\n::error::y${'z'.repeat(400)}`, excerptOmitted: null, messageBytes: -1, messageSha256: 'NOTHEX',
      },
    });
    expect(line).toMatch(/^[\x20-\x7e]+$/u);
    expect(line).toContain(' error_code=unusable message_class=other message_bytes=unknown message_sha256=unknown excerpt=kept message="x\\"?::error::y');
    expect(/message="(.*)"$/u.exec(line)![1]!.replace(/\\(.)/gu, '$1').length).toBeLessThanOrEqual(240);
  });
});

describe('the answer schema Anthropic receives is the supported subset of every real architect schema', () => {
  const WRAPPED = [
    ['plan', withJuliusResearchAsks(ARCHITECT_PLAN_SCHEMA)],
    ['guidance', withJuliusResearchAsks(ARCHITECT_GUIDANCE_SCHEMA)],
    ['rebuttal', withJuliusResearchAsks(ARCHITECT_REBUTTAL_SCHEMA)],
    ['consultation', withJuliusResearchAsks(ARCHITECT_CONSULTATION_SCHEMA)],
  ] as const;

  /** Every keyword at a schema position, recursively. Property NAMES are not keywords. */
  const keywordsOf = (node: unknown, out = new Set<string>()): Set<string> => {
    if (Array.isArray(node)) { for (const entry of node) keywordsOf(entry, out); return out; }
    if (node === null || typeof node !== 'object') return out;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      out.add(key);
      if (key === 'properties' || key === '$defs' || key === 'definitions') for (const sub of Object.values(value as object)) keywordsOf(sub, out);
      else if (key === 'items' || key === 'anyOf' || key === 'allOf') keywordsOf(value, out);
    }
    return out;
  };

  const sentSchema = async (schema: Record<string, unknown>): Promise<unknown> => {
    const bodies: string[] = [];
    const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(String(init?.body));
      return new Response(JSON.stringify({ error: { type: 'api_error', message: 'x' } }), { status: 500 });
    }) as typeof fetch;
    await runAnthropicArchitect({ apiKey: ARCHITECT_KEY, config: resolveArchitectCredential(J1_ENV).config, instructions: 'C', input: 'P', schema: { name: 'n', schema } }, { fetch: fetchImpl });
    expect(bodies).toHaveLength(1);
    return (JSON.parse(bodies[0]!) as { output_config: { format: { schema: unknown } } }).output_config.format.schema;
  };

  it('the real wrapped schemas carry maxItems (the research ask), so the transform is needed', () => {
    for (const [name, schema] of WRAPPED) expect(keywordsOf(schema).has('maxItems'), name).toBe(true);
  });

  it('MUTATION-CHECKED: what goes on the wire for each of the four real schemas holds only allowlisted keywords', async () => {
    for (const [name, schema] of WRAPPED) {
      const sent = await sentSchema(schema);
      for (const keyword of keywordsOf(sent)) expect(ANTHROPIC_SCHEMA_KEYWORDS.has(keyword), `${name}: ${keyword}`).toBe(true);
      expect(keywordsOf(sent).has('maxItems'), name).toBe(false);
    }
  });

  it('the bound the schema no longer carries is still enforced after parse: an over-limit ask list is refused', () => {
    const ask = { source: LIVE_REACH_SOURCES[0], capability: LIVE_REACH_READ_CAPABILITIES[0], reference: 'https://example.test/a', purpose: 'p' };
    const limit = JULIUS_RESEARCH_ASK_LIMITS.asks;
    expect(sanitizeJuliusResearchAsks(Array.from({ length: limit }, () => ({ ...ask })))?.length).toBe(limit);
    expect(sanitizeJuliusResearchAsks(Array.from({ length: limit + 1 }, () => ({ ...ask }))), 'one over the limit is refused whole').toBeNull();
    expect(sanitizeJuliusResearchAsks([{ ...ask, reference: 'x'.repeat(JULIUS_RESEARCH_ASK_LIMITS.referenceChars + 1) }])).toBeNull();
    expect(sanitizeJuliusResearchAsks([{ ...ask, purpose: 'x'.repeat(JULIUS_RESEARCH_ASK_LIMITS.purposeChars + 1) }])).toBeNull();
  });

  it('an unsupported keyword is refused BEFORE any request: zero fetch calls, pre-send, non-retryable', async () => {
    let calls = 0;
    const fetchImpl = (async () => { calls += 1; return new Response('{}'); }) as unknown as typeof fetch;
    const bads: Record<string, unknown>[] = [
      { type: 'object', properties: {}, required: [], additionalProperties: false, patternProperties: {} },
      { type: 'object', properties: { a: { oneOf: [{ type: 'string' }] } }, required: ['a'], additionalProperties: false },
      { type: 'object', properties: { a: { type: 'string', format: 'credit-card' } }, required: ['a'], additionalProperties: false },
      { type: 'object', properties: {}, required: [], additionalProperties: true },
      { type: 'object', properties: {}, required: [] },
      {
        type: 'object', properties: { a: { $ref: '#/$defs/node' } }, required: ['a'], additionalProperties: false,
        $defs: { node: { type: 'object', properties: { next: { $ref: '#/$defs/node' } }, required: ['next'], additionalProperties: false } },
      },
      { type: 'object', properties: { a: { $ref: 'https://example.test/schema' } }, required: ['a'], additionalProperties: false },
      { type: 'object', properties: { a: { type: 'array', items: { type: 'string' }, contains: { type: 'string' } } }, required: ['a'], additionalProperties: false },
      { type: 'object', properties: {}, required: [], additionalProperties: false, if: {}, then: {} },
      { type: 'object', properties: {}, required: [], additionalProperties: false, somethingNew: 1 },
    ];
    for (const bad of bads) {
      const outcome = await runAnthropicArchitect({ apiKey: ARCHITECT_KEY, config: resolveArchitectCredential(J1_ENV).config, instructions: 'C', input: 'P', schema: { name: 'n', schema: bad } }, { fetch: fetchImpl });
      expect(outcome, JSON.stringify(bad)).toMatchObject({ ok: false, failureClass: 'architect_schema_unsupported' });
    }
    expect(calls).toBe(0);
    // Through the adapter: INVALID_REQUEST, non-retryable, attested unsent, so the #479 gate has nothing to hold.
    const resolution = resolve(J1_ENV, {
      shell: SHELL, verifiedOrganizations: ORGS,
      runners: { architect: (request) => runAnthropicArchitect({ ...request, schema: { name: 'n', schema: { type: 'object', not: {} } } }, { fetch: fetchImpl }) },
    });
    const architect = resolution.entries.find((entry) => entry.worker.role === 'PROMPT_ARCHITECT')!;
    const error = await architect.adapter.dispatch(DISPATCH).then(() => null, (thrown: unknown) => thrown) as JuliusDispatchError;
    expect(error).toMatchObject({ code: 'INVALID_REQUEST', retryable: false, failureClass: 'architect_schema_unsupported' });
    expect(error.diagnostics?.runtimeStarted).toBe(false);
    expect(juliusHandedOutcomeUnknown(error, true)).toBeNull();
    expect(calls).toBe(0);
  });

  it('strips only the client-enforced bounds, and keeps minItems 0 or 1', () => {
    const out = anthropicStructuredOutputSchema({
      type: 'object', additionalProperties: false, required: ['a', 'b', 'c'],
      properties: {
        a: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'string', minLength: 1, maxLength: 9, pattern: '^x$' } },
        b: { type: 'array', minItems: 2, items: { type: 'integer', minimum: 0, maximum: 9 } },
        c: { type: ['string', 'null'], format: 'uri', description: 'kept' },
      },
    });
    expect(out).toEqual({
      type: 'object', additionalProperties: false, required: ['a', 'b', 'c'],
      properties: {
        a: { type: 'array', minItems: 1, items: { type: 'string' } },
        b: { type: 'array', items: { type: 'integer' } },
        c: { description: 'kept', anyOf: [{ type: 'string', format: 'uri' }, { type: 'null' }] },
      },
    });
  });
});

describe('type arrays reach Anthropic as anyOf, never as an array-valued type', () => {
  const WIRE = [
    ['plan', withJuliusResearchAsks(ARCHITECT_PLAN_SCHEMA)],
    ['guidance', withJuliusResearchAsks(ARCHITECT_GUIDANCE_SCHEMA)],
    ['rebuttal', withJuliusResearchAsks(ARCHITECT_REBUTTAL_SCHEMA)],
    ['consultation', withJuliusResearchAsks(ARCHITECT_CONSULTATION_SCHEMA)],
  ] as const;
  /** Every schema node, recursively, through properties, items, anyOf and allOf. */
  const nodesOf = (node: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] => {
    if (node === null || typeof node !== 'object' || Array.isArray(node)) return out;
    const record = node as Record<string, unknown>;
    out.push(record);
    if (record.properties) for (const sub of Object.values(record.properties as object)) nodesOf(sub, out);
    if (record.items) nodesOf(record.items, out);
    for (const key of ['anyOf', 'allOf'] as const) if (Array.isArray(record[key])) for (const sub of record[key] as unknown[]) nodesOf(sub, out);
    return out;
  };
  const onWire = async (schema: Record<string, unknown>): Promise<unknown> => {
    const bodies: string[] = [];
    const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(String(init?.body));
      return new Response(JSON.stringify({ error: { type: 'api_error', message: 'x' } }), { status: 500 });
    }) as typeof fetch;
    await runAnthropicArchitect({ apiKey: ARCHITECT_KEY, config: resolveArchitectCredential(J1_ENV).config, instructions: 'C', input: 'P', schema: { name: 'n', schema } }, { fetch: fetchImpl });
    return (JSON.parse(bodies[0]!) as { output_config: { format: { schema: unknown } } }).output_config.format.schema;
  };

  it('MUTATION-CHECKED: no array-valued type on the wire for any of the four real schemas, and unions stay within the documented 16', async () => {
    const sourceUnions = WIRE.map(([, schema]) => nodesOf(schema).filter((node) => Array.isArray(node.type)).length);
    expect(sourceUnions.reduce((a, b) => a + b, 0), 'the real schemas do carry type arrays').toBeGreaterThan(0);
    for (const [name, schema] of WIRE) {
      const nodes = nodesOf(await onWire(schema));
      expect(nodes.filter((node) => Array.isArray(node.type)).map((node) => JSON.stringify(node.type)), name).toEqual([]);
      expect(nodes.filter((node) => Array.isArray(node.anyOf)).length, `${name}: union-typed parameters`).toBeLessThanOrEqual(16);
    }
  });

  it('distributes each keyword to its own branch: an object-or-null keeps the object shape on the object branch; enum is split per branch', () => {
    const out = anthropicStructuredOutputSchema({
      type: 'object', additionalProperties: false, required: ['a', 'b', 'c'],
      properties: {
        a: { type: ['object', 'null'], description: 'kept outside', properties: { x: { type: 'string' } }, required: ['x'], additionalProperties: false },
        b: { type: ['string', 'null'], enum: ['one', 'two', null] },
        c: { type: ['string', 'integer'], enum: ['one'], maxLength: 3, minimum: 0 },
      },
    });
    expect(out.properties).toEqual({
      a: { description: 'kept outside', anyOf: [{ type: 'object', properties: { x: { type: 'string' } }, required: ['x'], additionalProperties: false }, { type: 'null' }] },
      b: { anyOf: [{ type: 'string', enum: ['one', 'two'] }, { type: 'null', enum: [null] }] },
      // The integer branch keeps no enum value, so it could match nothing and is dropped; the bounds are stripped.
      c: { anyOf: [{ type: 'string', enum: ['one'] }] },
    });
    // An object branch without additionalProperties:false is still refused, after the rewrite.
    expect(() => anthropicStructuredOutputSchema({ type: ['object', 'null'], properties: {} })).toThrow('architect_schema_unsupported:additionalProperties');
  });
});

describe('a correction re-ask is started only if it can finish inside the coordinator\'s deadline', () => {
  const NOW = 1_800_000_000_000;
  const ceiling = resolveArchitectCredential(J1_ENV).config.maxOutputTokens;

  /** A dispatch whose first answer is not JSON, so the adapter wants a correction; `deadlineAtMs` is the coordinator's. */
  async function dispatchWithDeadline(remainingAfterFirstMs: number) {
    const bodies: Record<string, unknown>[] = [];
    let clock = NOW;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    try {
      const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        // The first answer arrives 200 s in; the correction (if any) answers at once.
        if (bodies.length === 1) clock = NOW + 200_000;
        return new Response(JSON.stringify({
          id: 'msg_01FAKEANSWER', model: 'claude-opus-5-5', stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'this is not json' }], usage: { input_tokens: 10, output_tokens: 10 },
        }), { status: 200 });
      }) as typeof fetch;
      const resolution = resolve(J1_ENV, { shell: SHELL, verifiedOrganizations: ORGS, runners: { architect: createJ1ArchitectRunner({ fetch: fetchImpl }) } });
      const architect = resolution.entries.find((entry) => entry.worker.role === 'PROMPT_ARCHITECT')!;
      const deadlineAtMs = NOW + 200_000 + remainingAfterFirstMs;
      const error = await architect.adapter.dispatch({ ...DISPATCH, deadlineAtMs }).then(() => null, (thrown: unknown) => thrown) as JuliusDispatchError;
      return { error, bodies };
    } finally {
      nowSpy.mockRestore();
    }
  }
  /** The remaining window that buys exactly `tokens` at 40 tok/s after the 30 s margin. */
  const windowFor = (tokens: number): number => 30_000 + (tokens / 40) * 1000;

  it('the budget is computed from the deadline: min(ceiling, floor((remaining - 30 s) x 40 tok/s)), or skip below 6000', () => {
    expect(architectCorrectionMaxTokens(undefined, NOW, ceiling)).toBeNull();
    expect(architectCorrectionMaxTokens(NOW + windowFor(12_000), NOW, ceiling)).toBe(12_000);
    expect(architectCorrectionMaxTokens(NOW + 3_600_000, NOW, ceiling)).toBe(ceiling);
    expect(architectCorrectionMaxTokens(NOW + windowFor(6_000), NOW, ceiling)).toBe(6_000);
    expect(architectCorrectionMaxTokens(NOW + windowFor(6_000) - 25, NOW, ceiling)).toBe('skip');
    // A ceiling below the floor is its own floor: the 4,000-token connector default is not refused every correction.
    expect(architectCorrectionMaxTokens(NOW + windowFor(4_000), NOW, 4_000)).toBe(4_000);
    expect(architectCorrectionMaxTokens(NOW + windowFor(4_000) - 25, NOW, 4_000)).toBe('skip');
  });

  it('MUTATION-CHECKED: a slow first answer skips the correction: no extra fetch, the known validation failure, NOT a TIMEOUT', async () => {
    const { error, bodies } = await dispatchWithDeadline(windowFor(5_999));
    expect(bodies).toHaveLength(1);
    expect(error).toMatchObject({ code: 'WORKER_EXECUTION_FAILURE', retryable: false, failureClass: 'unparseable_plan_json' });
  });

  it('a fast first answer gets a correction whose max_tokens is the computed budget, on the wire', async () => {
    const { error, bodies } = await dispatchWithDeadline(windowFor(12_000));
    expect(bodies).toHaveLength(2);
    expect(bodies[0]!.max_tokens).toBe(ceiling);
    expect(bodies[1]!.max_tokens).toBe(12_000);
    expect(error).toMatchObject({ failureClass: 'unparseable_plan_json', retryable: false });
  });

  it('exactly at the 6000 floor the correction is made; one token short it is not', async () => {
    const at = await dispatchWithDeadline(windowFor(6_000));
    expect(at.bodies.map((body) => body.max_tokens)).toEqual([ceiling, 6_000]);
    const below = await dispatchWithDeadline(windowFor(6_000) - 25);
    expect(below.bodies).toHaveLength(1);
  });

  it('the coordinator hands the adapter the very deadline it enforces', () => {
    const source = readFileSync('src/relay/mission/julius/julius-execution-coordinator.ts', 'utf8');
    expect(source).toContain('const deadlineAtMs=Date.now()+declaredTimeoutMs;');
    expect(source).toContain('const running=run(controller.signal,deadlineAtMs);');
    expect(source).toContain('Math.max(0,deadlineAtMs-Date.now())');
    expect(source).toContain('(signal,deadlineAtMs)=>this.router.dispatch(worker,{taskId:request.claim.taskId,contextId:request.claim.contextId,taskType:request.taskType,signal,deadlineAtMs,');
  });
});

describe('an org spend-limit 400 at the architect adapter: its own category, fail-closed, one provider, one call', () => {
  const RATE = { 'request-id': 'req_011CFAKEREQUEST0002' };
  const SPEND = 'You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC.';
  const CREDIT = 'Your credit balance is too low to access the Anthropic API.';
  const body = (message: string): string => JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message } });

  async function dispatchWith(status: number, raw: string) {
    const urls: string[] = [];
    const lines: string[] = [];
    // ANY OTHER TRANSPORT IS A FALLBACK: the global fetch must never be reached.
    const globalFetch = vi.fn(async () => { throw new Error('fallback transport reached'); });
    vi.stubGlobal('fetch', globalFetch);
    try {
      const injected = (async (url: RequestInfo | URL) => {
        urls.push(String(url));
        return new Response(raw, { status, headers: RATE });
      }) as unknown as typeof fetch;
      const resolution = resolve(J1_ENV, {
        shell: SHELL, verifiedOrganizations: ORGS, report: (line) => lines.push(line),
        runners: { architect: createJ1ArchitectRunner({ fetch: injected }) },
      });
      const architect = resolution.entries.find((entry) => entry.worker.role === 'PROMPT_ARCHITECT')!;
      const error = await architect.adapter.dispatch(DISPATCH).then(() => null, (thrown: unknown) => thrown);
      expect(error, 'fails closed: the dispatch throws, never resolves').toBeInstanceOf(JuliusDispatchError);
      expect(globalFetch, 'no fallback transport').not.toHaveBeenCalled();
      return { error: error as JuliusDispatchError, urls, lines };
    } finally {
      vi.unstubAllGlobals();
    }
  }

  it('MUTATION: spend limit is non-retryable WORKER_EXECUTION_FAILURE / provider_error, one call to the pinned Anthropic URL', async () => {
    const { error, urls, lines } = await dispatchWith(400, body(SPEND));
    expect(urls).toEqual(['https://api.anthropic.com/v1/messages']);
    expect(error).toMatchObject({ code: 'WORKER_EXECUTION_FAILURE', retryable: false, failureClass: 'provider_error' });
    expect(juliusHandedOutcomeUnknown(error, true), 'non-retryable: never re-sent, before or after the handoff').toBeNull();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(' http=400 type=invalid_request_error ');
    expect(lines[0], 'the operator-visible blocker signal').toContain(' message_class=spend_limit ');
    expect(lines[0]).toContain(` excerpt=kept message="${SPEND}"`);
  });

  it('MUTATION: spend limit is distinct from credit (AUTH_CONFIGURATION / insufficient_credit) and auth (AUTH_CONFIGURATION / authentication_failed)', async () => {
    const spend = await dispatchWith(400, body(SPEND));
    const credit = await dispatchWith(400, body(CREDIT));
    const auth = await dispatchWith(401, JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }));
    expect(credit.error).toMatchObject({ code: 'AUTH_CONFIGURATION', retryable: false, failureClass: 'insufficient_credit' });
    expect(auth.error).toMatchObject({ code: 'AUTH_CONFIGURATION', retryable: false, failureClass: 'authentication_failed' });
    expect(new Set([spend.error.failureClass, credit.error.failureClass, auth.error.failureClass]).size).toBe(3);
    expect(spend.error.code).not.toBe(credit.error.code);
    expect(credit.lines[0]).toContain(' message_class=credit_too_low ');
    expect(auth.lines[0]).toContain(' http=401 type=authentication_error ');
    for (const run of [spend, credit, auth]) expect(run.urls).toHaveLength(1);
  });

  it('the spend-limit line never carries a key, the org id, or the dispatched prompt', async () => {
    const hostile = `${SPEND} org ${ORGS.architect} key ${ARCHITECT_KEY} workspace wrkspc_01TFFXWF62v6c3KaYy8gVTEe`;
    const { error, lines } = await dispatchWith(400, body(hostile));
    expect(error).toMatchObject({ code: 'WORKER_EXECUTION_FAILURE', retryable: false, failureClass: 'provider_error' });
    const everything = JSON.stringify({ lines, message: error.message, safe: error.safeMessage, row: safeReviewDiagnostics(error.diagnostics) });
    for (const secret of [ORGS.architect, 'aff8a85a', ARCHITECT_KEY, 'FAKETESTNOTREAL', 'wrkspc_01TFFXWF62v6c3KaYy8gVTEe']) {
      expect(everything, `${secret} never travels`).not.toContain(secret);
    }
    expect(lines[0]).toContain(' message_class=spend_limit ');
  });

  it('MUTATION: the real architect key, shorter than every shape rule, is redacted by value and the excerpt is kept', async () => {
    expect(ARCHITECT_KEY.length).toBeLessThan(32);
    const { lines } = await dispatchWith(400, body(`invalid key ${ARCHITECT_KEY}`));
    expect(lines[0]!.endsWith(' excerpt=kept message="invalid key [redacted]"')).toBe(true);
  });

  it('UNCHANGED BY THIS COMMIT: the paid-slot log classifier does not yet read message_class=spend_limit as PROVIDER_BLOCKED', async () => {
    // A tripwire, not an endorsement: promoting a spend limit to PROVIDER_BLOCKED
    // is a classification change outside this commit's scope and needs a ruling.
    const { classifyProviderFailure } = await import('../../scripts/julius-paid-slot.mjs');
    const { lines } = await dispatchWith(400, body(SPEND));
    expect(classifyProviderFailure(lines[0]!)).toBeNull();
    const credit = await dispatchWith(400, body(CREDIT));
    expect(classifyProviderFailure(credit.lines[0]!)).toBe('CREDIT_BALANCE');
  });
});
