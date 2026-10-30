/**
 * THE J1 ROLE-TO-CREDENTIAL MAPPING, PROVEN OFFLINE.
 *
 * The Agentic Architect (role PROMPT_ARCHITECT) is Anthropic on ANTHROPIC_ARCHITECT_API_KEY;
 * the Coding Agent is Anthropic on ANTHROPIC_API_KEY; the reviewer is xAI. Nothing here
 * opens a socket: the architect's transport is an injected fetch.
 */

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
import { architectCorrectionMaxTokens, createInMemoryArtifactExchange } from './live-workers';
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
  const refusing = (status: number, type: string, message: string, calls: { count: number }): typeof fetch =>
    (async () => {
      calls.count += 1;
      return new Response(JSON.stringify({ type: 'error', error: { type, message } }), { status, headers: RATE });
    }) as unknown as typeof fetch;

  async function dispatchRefused(status: number, type: string, message: string) {
    const calls = { count: 0 };
    const lines: string[] = [];
    const resolution = resolve(J1_ENV, {
      shell: SHELL, verifiedOrganizations: ORGS, report: (line) => lines.push(line),
      runners: { architect: createJ1ArchitectRunner({ fetch: refusing(status, type, message, calls) }) },
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
    expect(lines).toHaveLength(1);
    // The unchanged part of the line, byte for byte; then the message evidence and the body SHAPE (sizes, hashes, flags: never text).
    expect(lines[0]).toMatch(/^provider_refusal role=PROMPT_ARCHITECT provider=anthropic http=429 type=rate_limit_error limit_tokens=90000 remaining_tokens=12 limit_requests=50 remaining_requests=0 request_id=req_011CFAKEREQUEST0001 message_class=other message_len=12 message_sha256=d292012eb3769a2f messages_accepted=FAIL generation_ok=FAIL shape=model:[A-Za-z0-9._-]+,max_tokens:[0-9]+,effort:[a-z]+,body_bytes:[0-9]+,body_sha:[0-9a-f]{16},system_chars:[0-9]+,system_bytes:[0-9]+,input_chars:[0-9]+,input_bytes:[0-9]+,messages:1,parts:string,schema_bytes:[0-9]+,schema_sha:[0-9a-f]{16},nul:0,lone_surrogate:0,ctrl:0,empty_system:0,empty_input:0,json_valid:1$/u);
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
