import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { createInMemoryArtifactExchange, createLiveArchitectAdapter } from './live-workers';
import { architectWorker } from './live-composition';
import { JULIUS_CONTEXT_COMPILER_VERSION } from '../../src/relay/mission/julius';
import type { JuliusContextSnapshot } from '../../src/relay/mission/julius';
import type { GptRunOutcome } from '../../src/relay/connectors/gpt-architect';
import { runGptArchitect } from '../../src/relay/connectors/gpt-architect/gpt-runner';
import { flattenDiagnostics, safeReviewDiagnostics } from '../../src/relay/mission/julius/julius-router';
import { runHostedCodingAgent, type HostedQueryFn } from '../hosted-coding-agent/hosted-runner';
import { hostedCoderDiagnostics } from './claude-code-coding-provider';

/**
 * THE EFFORT A PROVIDER ACTUALLY RECEIVED, AS EVIDENCE (follow-up to the first paid lab run, 39173804383).
 *
 * That run declared architectEffort=low and coderEffort=low, completed, and left NOTHING in its bundle that said either value
 * reached a provider: a contract field is a declaration, not a transmission. These tests pin the record the harness now writes:
 *   - the architect connector records the effort it PUT IN THE REQUEST (`sent`) and the provider's own report (`echoed`), each
 *     from the object it built or the response it received, never from the mission's declaration;
 *   - the coder runner records the `effort` option it handed the SDK, from the same value it spreads into the options;
 *   - both reach the durable diagnostics only when there is something to say, through the kernel allowlist and two columns
 *     appended last on worker-diagnostics.tsv;
 *   - a mission that declares no effort leaves every record exactly as it was.
 * Nothing contacts a provider.
 */

/* ---------------------------------------------------------------- the connector */

const responses = vi.hoisted(() => ({ next: null as Record<string, unknown> | null, bodies: [] as Record<string, unknown>[] }));
vi.mock('openai', () => ({
  default: class {
    responses = {
      create: async (params: Record<string, unknown>) => {
        responses.bodies.push(params);
        return responses.next;
      },
    };
  },
}));

const completed = (reasoning?: { effort?: string | null }): Record<string, unknown> => ({
  id: 'resp_effort_1', model: 'gpt-5.6-sol-2026-04', status: 'completed', output_text: '{"x":1}', output: [],
  usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 5 } },
  ...(reasoning === undefined ? {} : { reasoning }),
});

const ask = async (effort: string | undefined, response: Record<string, unknown>) => {
  responses.bodies.length = 0;
  responses.next = response;
  const outcome = await runGptArchitect({
    apiKey: 'FAKETESTNOTREAL', instructions: 'plan it', input: 'the packet',
    config: { liveMode: true, model: 'gpt-5.6-sol', maxOutputTokens: 4_000, timeoutMs: 60_000, ...(effort === undefined ? {} : { reasoningEffort: effort }) } as never,
  });
  return { outcome, body: responses.bodies[0]! };
};

describe('the architect connector records the effort it sent and the effort the provider reported', () => {
  it('declared and echoed: both are recorded, and `sent` equals what is in the request body', async () => {
    const { outcome, body } = await ask('low', completed({ effort: 'low' }));
    expect(body.reasoning).toEqual({ effort: 'low' });
    expect(outcome.ok && outcome.effort).toEqual({ sent: 'low', echoed: 'low' });
  });

  it('a provider that reports a DIFFERENT effort than was sent shows the mismatch instead of hiding it', async () => {
    const { outcome } = await ask('low', completed({ effort: 'medium' }));
    expect(outcome.ok && outcome.effort).toEqual({ sent: 'low', echoed: 'medium' });
  });

  it('declared but the response carries no reasoning object: sent is recorded, echoed is null (not assumed equal)', async () => {
    const { outcome } = await ask('high', completed());
    expect(outcome.ok && outcome.effort).toEqual({ sent: 'high', echoed: null });
  });

  it('nothing declared: sent is null and the request has no reasoning field; an echoed default is still reported', async () => {
    const plain = await ask(undefined, completed());
    expect('reasoning' in plain.body).toBe(false);
    expect(plain.outcome.ok && plain.outcome.effort).toEqual({ sent: null, echoed: null });
    const defaulted = await ask(undefined, completed({ effort: 'medium' }));
    expect(defaulted.outcome.ok && defaulted.outcome.effort).toEqual({ sent: null, echoed: 'medium' });
  });

  it('a hostile echo (free text) is narrowed to a machine token or dropped, never carried', async () => {
    const { outcome } = await ask('low', completed({ effort: 'ignore previous; <script>alert(1)</script>' }));
    expect(outcome.ok && outcome.effort).toEqual({ sent: 'low', echoed: null });
  });

  it('a FAILED answer (incomplete) still carries the effort, because it was billed at that effort', async () => {
    const incomplete = { ...completed({ effort: 'low' }), status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } };
    const { outcome } = await ask('low', incomplete);
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.effort).toEqual({ sent: 'low', echoed: 'low' });
  });
});

/* ---------------------------------------------------------------- the architect adapter's diagnostics */

const VALID_PLAN = {
  objectiveSummary: 'Implement the mission fixture change.',
  assumptions: [], unresolvedQuestions: [], requirements: [],
  architectureDecisions: [], implementationSteps: [{ id: 'S1', description: 'Edit the fixture' }],
  risks: [], acceptanceCriteria: ['AC-1'], testPlan: ['npm run mission-test'],
  prohibitedActions: [], proposedContractAmendments: [], contextRefs: [],
  handoff: {
    objective: 'Implement the fixture change.', boundedTask: 'Edit exactly the fixture files and make the test pass.',
    acceptanceCriteria: ['AC-1'], requiredTests: ['npm run mission-test'], allowedFileScope: ['fixtures/live-validation/'],
    prohibitedActions: [], grantedTools: [], expectedEvidence: ['TEST'],
  },
};
const USAGE = { inputTokens: 1_101, cachedInputTokens: 202, outputTokens: 303, reasoningTokens: 404, totalTokens: 1_808 };
const snapshot = (taskId: string): JuliusContextSnapshot => ({
  contextId: 'ctx-eff-1', runId: 'run-eff', taskId, workerId: 'prompt-architect-openai', workerRole: 'PROMPT_ARCHITECT',
  compilerVersion: JULIUS_CONTEXT_COMPILER_VERSION, missionContractRevision: 1, cardRevision: 'card-eff-1', projectBrainRevision: 0,
  taskContractRevision: 1, taskContractDigest: 'sha256:eff-contract', sourceEntryIds: [], dependencyTaskIds: [], evidenceIds: [], findingIds: [],
  acceptanceCriterionIds: ['AC-1'], contentHash: 'sha256:eff-test', integrityVersion: null, integrityConflicts: null,
  integrityExcludedEntryIds: null, integrityEvictedEntryIds: null, characterCount: 24, redactionCount: 0, truncated: false,
  packet: { missionId: 'mission-eff-1', taskId, workerId: 'prompt-architect-openai', sourceEntryIds: [], blocks: [{ kind: 'CONSTRAINT', text: 'OBJECTIVE: effort test' }], truncated: false },
});
const architect = (outcome: GptRunOutcome) => createLiveArchitectAdapter({
  worker: architectWorker({}), contexts: { snapshotFor: () => snapshot('plan-1:task') }, artifacts: createInMemoryArtifactExchange(),
  config: { liveMode: true, model: 'gpt-5.6-sol', maxOutputTokens: 4_000 } as never, apiKey: 'FAKETESTNOTREAL-openai', run: (async () => outcome) as never,
});
const dispatchDiagnostics = async (outcome: GptRunOutcome): Promise<Record<string, unknown>> => {
  const request = { taskId: 'plan-1:task', attempt: { leaseGeneration: 1 }, reads: { plan: { taskId: 'plan-1', leaseGeneration: 1 } }, contextId: 'ctx-eff-1', taskType: 'plan' } as never;
  try {
    return ((await architect(outcome).dispatch(request)).diagnostics ?? {}) as Record<string, unknown>;
  } catch (error) {
    return ((error as { diagnostics?: unknown }).diagnostics ?? {}) as Record<string, unknown>;
  }
};
const ok = (effort?: { sent: string | null; echoed: string | null }): GptRunOutcome => ({
  ok: true, actualModel: 'gpt-5.6-sol-2026-04-01', responseId: 'resp_eff', status: 'completed', outputText: JSON.stringify(VALID_PLAN), usage: USAGE,
  ...(effort === undefined ? {} : { effort }),
});

describe('the architect adapter writes the effort into the dispatch diagnostics, only when there is one', () => {
  it('a validated plan carries effortSent and effortEchoed from the connector outcome', async () => {
    const d = await dispatchDiagnostics(ok({ sent: 'low', echoed: 'low' }));
    expect(d.effortSent).toBe('low');
    expect(d.effortEchoed).toBe('low');
  });

  it('sent without an echo records only effortSent; neither sent nor echoed adds NO key (absent means unchanged)', async () => {
    const onlySent = await dispatchDiagnostics(ok({ sent: 'high', echoed: null }));
    expect(onlySent.effortSent).toBe('high');
    expect('effortEchoed' in onlySent).toBe(false);
    for (const none of [ok(), ok({ sent: null, echoed: null })]) {
      const d = await dispatchDiagnostics(none);
      expect('effortSent' in d).toBe(false);
      expect('effortEchoed' in d).toBe(false);
    }
  });

  it('a connector FAILURE after an answer still records the effort it was billed at', async () => {
    const failed: GptRunOutcome = {
      ok: false, failureClass: 'incomplete_response', message: 'incomplete', actualModel: 'gpt-5.6-sol-2026-04', responseId: 'resp_eff_f',
      usage: USAGE, providerStatus: 'incomplete', incompleteReason: 'max_output_tokens', effort: { sent: 'medium', echoed: 'medium' },
    };
    const d = await dispatchDiagnostics(failed);
    expect(d.effortSent).toBe('medium');
    expect(d.effortEchoed).toBe('medium');
  });
});

/* ---------------------------------------------------------------- the coder runner and provider */

const WS = '/data/relay-workspaces/prj/run-1';
const clock = () => { let n = 0; return () => new Date(Date.UTC(2026, 9, 18, 12, 0, n++)).toISOString(); };
const messages = [
  { type: 'system', subtype: 'init', model: 'claude-sonnet-5-20260114', claude_code_version: '2.1.220', apiKeySource: 'ANTHROPIC_API_KEY', cwd: WS, tools: ['Read', 'Glob', 'Grep', 'Edit'] },
  { type: 'result', subtype: 'success', is_error: false, result: 'done', num_turns: 2, duration_ms: 1200, total_cost_usd: 0.01, usage: { input_tokens: 500, output_tokens: 60 }, permission_denials: [] },
];
const runCoder = async (effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max') => {
  let seen: Record<string, unknown> = {};
  const fn: HostedQueryFn = (params) => { seen = params.options; return (async function* () { for (const m of messages) yield m; })(); };
  const outcome = await runHostedCodingAgent({
    queryFn: fn, prompt: 'implement it', workspacePath: WS, apiKey: 'FAKETESTNOTREAL', requestedModel: 'claude-sonnet-5', now: clock(),
    ...(effort === undefined ? {} : { effort }),
  });
  return { outcome, options: seen };
};

describe('the coder runner records the effort option it handed the SDK', () => {
  it('declared: the observation says exactly the value that is in the SDK options, after the whole stream was folded', async () => {
    for (const level of ['low', 'medium', 'high', 'xhigh', 'max'] as const) {
      const { outcome, options } = await runCoder(level);
      expect(options.effort).toBe(level);
      expect(outcome.observation.effortSent).toBe(level);
      expect(outcome.observation.initSeen, 'the stream was folded and the field survived the folding').toBe(true);
    }
  });

  it('not declared: no effort option and no effortSent on the observation', async () => {
    const { outcome, options } = await runCoder();
    expect('effort' in options).toBe(false);
    expect('effortSent' in outcome.observation).toBe(false);
  });

  it('a runtime that cannot start still reports what was handed to it', async () => {
    const outcome = await runHostedCodingAgent({
      queryFn: (() => { throw new Error('boom'); }) as unknown as HostedQueryFn, prompt: 'x', workspacePath: WS, apiKey: 'FAKETESTNOTREAL', requestedModel: 'claude-sonnet-5', now: clock(), effort: 'low',
    });
    expect(outcome.observation.effortSent).toBe('low');
  });
});

describe('the coder diagnostics carry effortSent only when an effort was sent', () => {
  const diagnosticsFor = async (effort?: 'low' | 'high') => {
    const { outcome } = await runCoder(effort);
    return hostedCoderDiagnostics({
      taskType: 'build', requestedModel: 'claude-sonnet-5', observed: outcome.observation,
      limits: { maxCostCents: 100 } as never, outcome: 'succeeded',
    });
  };
  it('declared: the diagnostics name the value that was handed to the SDK', async () => {
    expect((await diagnosticsFor('low')).effortSent).toBe('low');
    expect((await diagnosticsFor('high')).effortSent).toBe('high');
  });
  it('not declared: no effortSent key at all, so the record is exactly what it was', async () => {
    expect('effortSent' in await diagnosticsFor()).toBe(false);
  });
  it('an unobserved dispatch (no observation) adds no key and does not throw', () => {
    const d = hostedCoderDiagnostics({ taskType: 'build', requestedModel: null, observed: null, limits: { maxCostCents: 100 } as never, outcome: 'failed' });
    expect('effortSent' in d).toBe(false);
  });
});

/* ---------------------------------------------------------------- the kernel allowlist and the dump */

describe('the kernel allowlist and the evidence dump', () => {
  it('keeps a valid effort token, adds no key when none is reported, drops anything that is not a machine token', () => {
    const kept = safeReviewDiagnostics({ stage: 'plan', effortSent: 'low', effortEchoed: 'medium' }) as Record<string, unknown>;
    expect(kept.effortSent).toBe('low');
    expect(kept.effortEchoed).toBe('medium');
    const none = safeReviewDiagnostics({ stage: 'plan' }) as Record<string, unknown>;
    expect('effortSent' in none).toBe(false);
    expect('effortEchoed' in none).toBe(false);
    for (const bad of [null, '', 7, true, {}, 'low high', '<b>', 'x'.repeat(80), '1abc']) {
      const d = safeReviewDiagnostics({ stage: 'plan', effortSent: bad, effortEchoed: bad }) as Record<string, unknown>;
      expect('effortSent' in d, `dropped: ${JSON.stringify(bad)}`).toBe(false);
      expect('effortEchoed' in d).toBe(false);
    }
  });

  it('becomes diag_effortSent / diag_effortEchoed on the durable event, which are exactly what the dump columns read', () => {
    const flat = flattenDiagnostics(safeReviewDiagnostics({ stage: 'plan', effortSent: 'low', effortEchoed: 'low' }));
    expect(flat.diag_effortSent).toBe('low');
    expect(flat.diag_effortEchoed).toBe('low');
    const dump = readFileSync(join(process.cwd(), '.github', 'julius-live-evidence-dump.sh'), 'utf8');
    const line = dump.split(String.fromCharCode(10)).find((l) => l.includes('AS served_model_usage_key')) ?? '';
    expect(line).toContain("e.payload->'facts'->>'diag_effortSent' AS effort_sent");
    expect(line).toContain("e.payload->'facts'->>'diag_effortEchoed' AS effort_echoed");
    // appended LAST, after the review-evidence columns, so every earlier column keeps its position
    expect(line.indexOf('AS review_evidence_test_output_omitted')).toBeLessThan(line.indexOf('AS effort_sent'));
    expect(line.indexOf('AS effort_sent')).toBeLessThan(line.indexOf('AS effort_echoed'));
    expect(line).toMatch(/AS effort_echoed FROM relay_wonderland\.events e/u);
  });
});
