/**
 * THE ENGINE GAVE UP, AND THE RECORD NOW SAYS SO — WITH WHAT IT BOUGHT.
 *
 * Paid qualification 34753589938 (main 8afb872d) ended at its plan review. The
 * reviewer — freshly proven to hold no tool — timed out once on the engine's own
 * request deadline, was re-asked inside its window, and then exited 0 with 111
 * bytes that held no JSON and no HTTP status. That classified as
 * `review_json_absent`: "the model wrote prose". Nothing could say otherwise,
 * because Hermes answers several of its own failures with a fixed sentence and
 * exit status 0, and because the usage file Hermes writes on failure was read
 * only on success — so the run could not even prove a paid provider was asked.
 *
 * These proofs drive the REAL `runHermesReview` over a fake engine that behaves
 * the way the pinned Hermes does, and the REAL reviewer adapter over it.
 */

import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JULIUS_CONTEXT_COMPILER_VERSION, safeReviewDiagnostics, type JuliusContextSnapshot } from '../../src/relay/mission/julius';
import {
  buildReviewPrompt,
  classifyEngineGiveUp,
  loadHermesConfig,
  runHermesReview,
  type HermesConfig,
  type ReviewPacket,
} from '../hermes-reviewer';
import { createLiveArtifactExchange, createLiveHermesReviewerAdapter, planRef } from './live-workers';

const LIVE_ENV: Record<string, string> = {
  RELAY_HERMES_EXECUTABLE: process.execPath,
  RELAY_HERMES_PROVIDER: 'xai',
  RELAY_HERMES_MODEL: 'grok-build-0.1',
  RELAY_HERMES_LIVE: '1',
};

const VALID_PLAN = {
  objectiveSummary: 'Implement the mission fixture change.',
  assumptions: [], unresolvedQuestions: [], requirements: [],
  architectureDecisions: [], implementationSteps: [{ id: 'S1', description: 'Edit the fixture' }],
  risks: [], acceptanceCriteria: ['AC-1'], testPlan: ['npm run mission-test'],
  prohibitedActions: [], proposedContractAmendments: [], contextRefs: [],
  handoff: {
    objective: 'Implement the fixture change.', boundedTask: 'Edit exactly the fixture files.',
    acceptanceCriteria: ['AC-1'], requiredTests: ['npm run mission-test'],
    allowedFileScope: ['fixtures/live-validation/'], prohibitedActions: [], grantedTools: [], expectedEvidence: ['TEST'],
  },
};

const APPROVED = JSON.stringify({
  verdict: 'approved', summary: 'The plan satisfies every acceptance criterion.',
  findings: [], requirementsChecked: [{ requirement: 'AC-1', status: 'passed', evidence: 'read the plan' }],
});

/** The pinned engine's own give-up sentences, as `agent/conversation_loop.py` returns them. */
const GIVE_UPS: ReadonlyArray<readonly [string, string]> = [
  ['Model generated invalid tool call: read_file', 'review_engine_invalid_tool_call'],
  ['Billing or credits exhausted: HTTP-less summary from the provider', 'review_engine_billing_exhausted'],
  ['Response truncated due to output length limit', 'review_engine_output_limit'],
  ["max_tokens exceeds the provider's output cap for this model. Lower model.max_tokens in config.yaml.", 'review_engine_output_limit'],
  ['⚠️ **Thinking Budget Exhausted**\n\nThe model used all its output tokens on reasoning', 'review_engine_output_limit'],
  ['Context length exceeded (412,000 tokens). Cannot compress further.', 'review_engine_context_exceeded'],
  ['Request payload too large (413). Cannot compress further.', 'review_engine_context_exceeded'],
  ['API call failed after 1 retries: Connection error.', 'review_engine_gave_up'],
  ['Invalid API response after 1 retries: empty choices', 'review_engine_gave_up'],
  ['I apologize, but I encountered repeated errors: upstream reset', 'review_engine_gave_up'],
  // A REFUSAL IS ITS OWN SHAPE, and it is classified BEFORE the give-ups: a
  // content filter's sentence contains the word "error", and reading it as the
  // provider giving up would send the same ask to another model to be declined
  // again. The request is what has to change.
  ['API Error: 400 {"type":"content_policy_violation"}', 'review_content_refused'],
  ['API call failed: response blocked by the content filter', 'review_content_refused'],
  ['Upstream returned stop_reason: refusal', 'review_content_refused'],
  ["I can't help with that.", 'review_content_refused'],
];

describe('the classifier names each fixed give-up sentence, and nothing else', () => {
  it('maps every pinned literal to its closed shape', () => {
    for (const [text, shape] of GIVE_UPS) expect(classifyEngineGiveUp(`${text}\n`), text).toBe(shape);
  });

  it('matches only at the start, so a review quoting the sentence is not one', () => {
    expect(classifyEngineGiveUp('The plan is fine. Note: Model generated invalid tool call: read_file')).toBeNull();
    expect(classifyEngineGiveUp('I looked at the plan and it seems okay to me.')).toBeNull();
    expect(classifyEngineGiveUp('')).toBeNull();
    // A REVIEW THAT DISCUSSES a content policy is a review, not a refusal — the
    // refusal patterns are anchored, and this one is reached only when no
    // verdict-bearing JSON was found at all.
    expect(classifyEngineGiveUp('The diff adds a content filter to the upload path, which is correct.')).toBeNull();
    // An apology alone stays unclassified: a coarse class beats a wrong one.
    expect(classifyEngineGiveUp('I am sorry, the diff was hard to follow.')).toBeNull();
  });

  it('a refusal is not a give-up, and is the one shape that is the REQUEST’s fault', () => {
    // The distinction the operator needs: the provider was reachable, answered,
    // and declined. Retrying the same ask anywhere reaches the same answer.
    expect(classifyEngineGiveUp('API Error: 400 content_filter triggered')).toBe('review_content_refused');
    expect(classifyEngineGiveUp('API call failed after 2 retries: Connection error.')).toBe('review_engine_gave_up');
  });
});

/**
 * A FAKE ENGINE, as a script file: writes Hermes's usage report to the path
 * after `--usage-file` (or none), prints `stdout`, exits `code`. A file rather
 * than `node -e`, because `-z` and the rest of the reviewer's flags would
 * otherwise be read as node's own options.
 */
const FAKE_DIR = mkdtempSync(join(tmpdir(), 'julius-fake-hermes-'));
let fakes = 0;
const spawnWith = (stdout: string, usage: Record<string, unknown> | null, code = 0) => {
  const script = join(FAKE_DIR, `engine-${fakes += 1}.cjs`);
  writeFileSync(script, [
    'const argv = process.argv.slice(2);',
    'const at = argv.indexOf("--usage-file");',
    `const usage = ${JSON.stringify(usage)};`,
    'if (usage !== null && at > -1) require("node:fs").writeFileSync(argv[at + 1], JSON.stringify(usage));',
    `process.stdout.write(${JSON.stringify(stdout)});`,
    `process.exitCode = ${code};`,
  ].join(String.fromCharCode(10)));
  return ((_executable: string, args: readonly string[], options: object) =>
    spawn(process.execPath, [script, ...args], options as never)) as never;
};

const PACKET = {
  missionId: 'msn-1', originalRequest: 'the request', handoffJson: JSON.stringify(VALID_PLAN),
  baseRevision: 'abc', artifactDigest: 'sha256:0', changedFiles: [], unifiedDiff: '', changedFileContents: '',
  testCommand: 'npm test', testOutput: '', relayEvidence: [],
} as unknown as ReviewPacket;

const USAGE = { model: 'grok-build-0.1', input_tokens: 24_117, output_tokens: 312, api_calls: 3, failed: false, completed: false };

describe('the real runner: a give-up is named, and its usage survives', () => {
  it('an invalid tool call with exit 0 is review_engine_invalid_tool_call, not review_json_absent, and carries the usage', async () => {
    const outcome = await runHermesReview({
      packet: PACKET, config: loadHermesConfig(LIVE_ENV as never),
      spawnImpl: spawnWith('Model generated invalid tool call: read_file\n', USAGE),
    });
    expect(outcome.kind).toBe('review_incomplete');
    if (outcome.kind !== 'review_incomplete') return;
    expect(outcome.shape).toBe('review_engine_invalid_tool_call');
    expect(outcome.usage?.apiCalls, 'the engine asked the provider three times').toBe(3);
    expect(outcome.usage?.inputTokens).toBe(24_117);
    expect(outcome.diagnostics.servedModel, 'what answered, from the engine, even on failure').toBe('grok-build-0.1');
    expect(outcome.safeMessage).not.toContain('read_file');
  }, 30_000);

  it('plain prose is still review_json_absent, and an engine timeout is still a timeout', async () => {
    const prose = await runHermesReview({ packet: PACKET, config: loadHermesConfig(LIVE_ENV as never), spawnImpl: spawnWith('The plan looks fine to me.\n', USAGE) });
    expect(prose.kind === 'review_incomplete' && prose.shape).toBe('review_json_absent');
    const timeout = await runHermesReview({ packet: PACKET, config: loadHermesConfig(LIVE_ENV as never), spawnImpl: spawnWith('API call failed after 1 retries: Request timed out.\n', USAGE) });
    expect(timeout.kind === 'review_incomplete' && timeout.shape).toBe('review_timeout');
  }, 30_000);

  it("the stream watchdogs' own sentences are timeouts, not prose and not a provider that gave up", async () => {
    // The first is paid qualification 34753589938's 111-byte re-ask, reproduced
    // on the pinned engine against a silent stream; neither says "timed out".
    for (const sentence of [
      'API call failed after 1 retries: Codex stream produced no SSE events for 12s after first byte (threshold: 12s)',
      'API call failed after 1 retries: Codex stream produced no bytes for 120s (threshold: 120s)',
      'API call failed after 1 retries: Codex Responses stream did not emit a terminal response',
    ]) {
      const outcome = await runHermesReview({ packet: PACKET, config: loadHermesConfig(LIVE_ENV as never), spawnImpl: spawnWith(`${sentence}\n`, USAGE) });
      expect(outcome.kind === 'review_incomplete' && outcome.shape, sentence).toBe('review_timeout');
    }
  }, 30_000);

  it('no usage report is UNKNOWN usage, never zero', async () => {
    const outcome = await runHermesReview({ packet: PACKET, config: loadHermesConfig(LIVE_ENV as never), spawnImpl: spawnWith('Billing or credits exhausted: out of credit\n', null) });
    expect(outcome.kind === 'review_incomplete' && outcome.shape).toBe('review_engine_billing_exhausted');
    if (outcome.kind !== 'review_incomplete') return;
    expect(outcome.usage?.apiCalls ?? null).toBeNull();
    expect(outcome.usage?.inputTokens ?? null).toBeNull();
  }, 30_000);
});

const worker = {
  workerId: 'independent-reviewer-hermes', role: 'INDEPENDENT_REVIEWER' as const,
  adapterId: 'hermes-local-live', providerId: 'xai', capabilities: ['review'],
  taskTypes: ['review:plan'], concurrencyLimit: 1, timeoutMs: 900_000, maxRetries: 1, status: 'AVAILABLE' as const,
};

function snapshot(taskId: string): JuliusContextSnapshot {
  return {
    contextId: 'ctx-1', runId: 'run-live', taskId, workerId: worker.workerId,
    workerRole: 'INDEPENDENT_REVIEWER', compilerVersion: JULIUS_CONTEXT_COMPILER_VERSION,
    missionContractRevision: 1, cardRevision: 'card-test-1', projectBrainRevision: 0,
    taskContractRevision: 1, taskContractDigest: 'sha256:contract',
    sourceEntryIds: [], dependencyTaskIds: [], evidenceIds: [], findingIds: [],
    acceptanceCriterionIds: ['AC-1'], contentHash: 'sha256:content',
    // A fixture packet was compiled without claims, so no integrity decision
    // was made for it. NULL says that; `[]` would say it was checked.
    integrityVersion: null, integrityConflicts: null,
    integrityExcludedEntryIds: null, integrityEvictedEntryIds: null,
    characterCount: 24, redactionCount: 0, truncated: false,
    packet: { missionId: 'mission-live-1', taskId, workerId: worker.workerId, sourceEntryIds: [], blocks: [{ kind: 'CONSTRAINT', text: 'OBJECTIVE: give-up test' }], truncated: false },
  };
}

const adapterOver = (answers: ReadonlyArray<{ stdout: string; usage: Record<string, unknown> | null }>) => {
  const artifacts = createLiveArtifactExchange();
  artifacts.put(planRef('run-live'), JSON.stringify(VALID_PLAN));
  const prompts: string[] = [];
  let call = 0;
  const adapter = createLiveHermesReviewerAdapter({
    worker, contexts: { snapshotFor: () => snapshot('plan-1:review') }, artifacts,
    config: loadHermesConfig(LIVE_ENV as never), testCommand: 'npm run mission-test',
    run: (async (input: { packet: ReviewPacket; config: HermesConfig }) => {
      prompts.push(buildReviewPrompt(input.packet));
      const answer = answers[Math.min(call, answers.length - 1)]!;
      call += 1;
      return runHermesReview({ packet: input.packet, config: input.config, spawnImpl: spawnWith(answer.stdout, answer.usage) });
    }) as never,
    sleep: async () => {},
  });
  return {
    prompts,
    dispatch: () => adapter.dispatch({
      taskId: 'plan-1:review', contextId: 'ctx-1', taskType: 'review:plan',
      allocation: { usdMicros: 21_000_000, basis: 'SHARED_POOL', policyVersion: 'julius-allocation.v3' },
    }),
  };
};

const failureOf = (promise: Promise<unknown>) => promise
  .then(() => { throw new Error('the dispatch was expected to fail'); })
  .catch((error: unknown) => error as { code: string; retryable: boolean; failureClass: string | null; diagnostics?: Record<string, unknown> });

describe('the reviewer adapter: told it has no tools, corrected once if it tries one', () => {
  it('every review prompt says plainly that the reviewer holds no tool', () => {
    const prompt = buildReviewPrompt(PACKET);
    expect(prompt).toContain('You have NO tools in this review');
    expect(prompt).toContain('Do not attempt any tool call');
  });

  it('an invalid tool call is corrected once, naming the absence of tools, and a real verdict then succeeds', async () => {
    const rig = adapterOver([
      { stdout: 'Model generated invalid tool call: read_file\n', usage: USAGE },
      { stdout: APPROVED, usage: { ...USAGE, completed: true } },
    ]);
    const result = await rig.dispatch() as { status: string; diagnostics: Record<string, unknown> };
    expect(result.status).toBe('SUCCEEDED');
    expect(rig.prompts).toHaveLength(2);
    expect(rig.prompts[1]).toContain('CORRECTION — your previous answer tried to call a tool. This review has NO tools of any kind.');
    expect(rig.prompts[1]).not.toContain('read_file');
    expect(result.diagnostics.reviewReaskShape).toBe('review_engine_invalid_tool_call');
  }, 30_000);

  it('a reviewer that DECLINES the request fails it as the request’s fault, never as a provider that gave up', async () => {
    // The whole point of the class: an operator reading this row can tell "the
    // model would not review this" from "the provider broke". INVALID_REQUEST is
    // what the Coding Agent's CONTENT_REFUSED carries, so one phenomenon has one
    // code across the three peers; and it is never retried, because retrying the
    // same ask reaches the same answer wherever it is sent.
    const rig = adapterOver([{ stdout: 'API Error: 400 {"type":"content_policy_violation"}\n', usage: USAGE }]);
    const failure = await failureOf(rig.dispatch());
    expect(failure.failureClass).toBe('review_content_refused');
    expect(failure.code).toBe('INVALID_REQUEST');
    expect(failure.retryable).toBe(false);
    // WHAT IT COST IS STILL ON THE ROW: a refusal that was paid for is spend.
    expect(safeReviewDiagnostics(failure.diagnostics)?.servedModel).toBe('grok-build-0.1');
  }, 30_000);

  it('a failed review records the engine\'s tokens, call count and served model on the durable row', async () => {
    const rig = adapterOver([
      { stdout: 'Model generated invalid tool call: read_file\n', usage: USAGE },
      { stdout: 'Model generated invalid tool call: run_terminal\n', usage: USAGE },
    ]);
    const failure = await failureOf(rig.dispatch());
    expect(failure.failureClass).toBe('review_engine_invalid_tool_call');
    expect(failure.code).toBe('WORKER_EXECUTION_FAILURE');
    expect(failure.retryable).toBe(false);
    const safe = safeReviewDiagnostics(failure.diagnostics);
    expect(safe?.engineApiCalls).toBe(3);
    expect(safe?.inputTokens).toBe(24_117);
    expect(safe?.outputTokens).toBe(312);
    expect(safe?.servedModel).toBe('grok-build-0.1');
  }, 30_000);

  it('exhausted credits and an engine that gave up are the provider\'s, final, and never re-asked', async () => {
    for (const [stdout, shape] of [
      ['Billing or credits exhausted: out of credit\n', 'review_engine_billing_exhausted'],
      ['API call failed after 1 retries: Connection error.\n', 'review_engine_gave_up'],
    ] as const) {
      const rig = adapterOver([{ stdout, usage: USAGE }, { stdout: APPROVED, usage: USAGE }]);
      const failure = await failureOf(rig.dispatch());
      expect(rig.prompts, shape).toHaveLength(1);
      expect(failure.failureClass).toBe(shape);
      expect(failure.code).toBe('PROVIDER_UNAVAILABLE');
      expect(failure.retryable).toBe(false);
    }
  }, 30_000);

  it('a context ceiling is the request\'s, not the provider\'s', async () => {
    const rig = adapterOver([{ stdout: 'Context length exceeded (412,000 tokens). Cannot compress further.\n', usage: USAGE }]);
    const failure = await failureOf(rig.dispatch());
    expect(failure.failureClass).toBe('review_engine_context_exceeded');
    expect(failure.code).toBe('INVALID_REQUEST');
  }, 30_000);
});
