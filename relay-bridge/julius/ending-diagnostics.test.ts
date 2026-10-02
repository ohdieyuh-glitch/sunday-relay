import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createInMemoryArtifactExchange, createLiveArchitectAdapter } from './live-workers';
import { architectWorker } from './live-composition';
import { JULIUS_CONTEXT_COMPILER_VERSION } from '../../src/relay/mission/julius';
import type { JuliusContextSnapshot } from '../../src/relay/mission/julius';
import type { GptRunOutcome } from '../../src/relay/connectors/gpt-architect';

/**
 * WHAT A PAID RUN LEAVES BEHIND WHEN IT ENDS.
 *
 * Two findings, one sentence: the facts a boundary already had in hand did not
 * reach the rows a reader opens afterwards.
 *
 * C — THE TERMINAL ROW COULD NOT SAY WHY. `JuliusExecutionOutcome`'s failure
 * arm was `{status, code, failureClass?}`. The coordinator flattened the
 * adapter's diagnostics onto its OWN `retry.scheduled` and then had nowhere to
 * put them, so when a run's autonomy declined a retry, `julius-task-pipeline`
 * wrote the terminal `task.failed` — the row that ENDS the task — with five
 * fields and nothing about the provider. Not an omission at the call site: the
 * type gave the pipeline nothing to write. What was lost is exactly what the
 * next decision needs, including `costUsdMicros`: a coder that times out has
 * usually already spent money, and that figure sat one event earlier under a
 * different type.
 *
 * E — THE SUCCESSFUL RUN LEFT THINNER EVIDENCE THAN THE FAILED ONE. Six call
 * sites hand `planDiagnostics` a hand-picked subset of eighteen optional
 * fields. Only the connector-failure path passed the whole provider picture.
 * The three REFUSAL sites — unparseable JSON, guidance invalid, plan invalid —
 * passed no tokens at all, so a plan that was bought and then thrown away
 * recorded nothing about its cost. Both SUCCESS sites omitted the elapsed time,
 * the provider's status, the total and reasoning tokens and the ceiling. That
 * is the wrong way round, because the paid proof reads the run that worked.
 *
 * `cachedInputTokens` was read by the connector into `GptUsage` and reached no
 * diagnostic anywhere, on any path. Cached input is billed at a different rate,
 * so a row carrying `inputTokens` alone reports a quantity at one price when
 * part of it was bought at another.
 *
 * NOTHING HERE IS NEW INFORMATION. Every field was already on the outcome and
 * already in scope. What was missing was a reason a site could not quietly
 * report a subset.
 */

/**
 * EVERY CALL'S ARGUMENT OBJECT, brace-matched rather than pattern-guessed.
 *
 * A capped `[\s\S]{0,N}?` regex found four of the six sites and stopped: the
 * two longest arguments outran the cap, so the guard silently covered less than
 * it claimed. Counting braces cannot miss a long one, and the exact count below
 * fails when a site is added or removed rather than quietly covering fewer.
 */
const callBodies = (source: string, opener: string): readonly string[] => {
  const bodies: string[] = [];
  for (let at = source.indexOf(opener); at !== -1; at = source.indexOf(opener, at + 1)) {
    let depth = 0;
    let end = at + opener.length - 1;
    for (; end < source.length; end += 1) {
      if (source[end] === '{') depth += 1;
      else if (source[end] === '}') { depth -= 1; if (depth === 0) break; }
    }
    bodies.push(source.slice(at, end + 1));
  }
  return bodies;
};

const ROOT = process.cwd();
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8');

const VALID_PLAN = {
  objectiveSummary: 'Implement the mission fixture change.',
  assumptions: [], unresolvedQuestions: [], requirements: [],
  architectureDecisions: [], implementationSteps: [{ id: 'S1', description: 'Edit the fixture' }],
  risks: [], acceptanceCriteria: ['AC-1'], testPlan: ['npm run mission-test'],
  prohibitedActions: [], proposedContractAmendments: [], contextRefs: [],
  handoff: {
    objective: 'Implement the fixture change.',
    boundedTask: 'Edit exactly the fixture files and make the test pass.',
    acceptanceCriteria: ['AC-1'], requiredTests: ['npm run mission-test'],
    allowedFileScope: ['fixtures/live-validation/'], prohibitedActions: [],
    grantedTools: [], expectedEvidence: ['TEST'],
  },
};

/** Every usage number distinct, so a field reported from the wrong one shows. */
const USAGE = {
  inputTokens: 1_101, cachedInputTokens: 202, outputTokens: 303,
  reasoningTokens: 404, totalTokens: 1_808,
};

function planSnapshot(taskId: string): JuliusContextSnapshot {
  return {
    contextId: 'ctx-diag-1', runId: 'run-diag', taskId, workerId: 'prompt-architect-openai',
    workerRole: 'PROMPT_ARCHITECT', compilerVersion: JULIUS_CONTEXT_COMPILER_VERSION,
    missionContractRevision: 1, cardRevision: 'card-diag-1', projectBrainRevision: 0,
    taskContractRevision: 1, taskContractDigest: 'sha256:diag-contract',
    sourceEntryIds: [], dependencyTaskIds: [], evidenceIds: [], findingIds: [],
    acceptanceCriterionIds: ['AC-1'], contentHash: 'sha256:diag-test',
    // A fixture packet was compiled without claims, so no integrity decision
    // was made for it. NULL says that; `[]` would say it was checked.
    integrityVersion: null, integrityConflicts: null,
    integrityExcludedEntryIds: null, integrityEvictedEntryIds: null,
    characterCount: 24, redactionCount: 0, truncated: false,
    packet: {
      missionId: 'mission-diag-1', taskId, workerId: 'prompt-architect-openai',
      sourceEntryIds: [], blocks: [{ kind: 'CONSTRAINT', text: 'OBJECTIVE: diagnostics test' }],
      truncated: false,
    },
  };
}

/** Provider-free: the connector is replaced by a scripted outcome. Nothing is
    contacted and nothing is spent; these assert the RECORD, never a real run. */
const architect = (outcome: GptRunOutcome, artifacts = createInMemoryArtifactExchange()) =>
  createLiveArchitectAdapter({
    worker: architectWorker({}),
    contexts: { snapshotFor: () => planSnapshot('plan-1:task') },
    artifacts,
    config: { liveMode: true, model: 'gpt-5.6-sol', maxOutputTokens: 4_000 } as never,
    apiKey: 'FAKETESTNOTREAL-openai',
    run: (async () => outcome) as never,
  });

const succeeded = (outputText: string): GptRunOutcome => ({
  ok: true, actualModel: 'gpt-5.6-sol-2026-04', responseId: 'resp_diag_success',
  status: 'completed', outputText, usage: USAGE,
});

/** The provider facts every ending must carry, whatever the ending is. */
const PROVIDER_FACTS = [
  'servedModel', 'responseId', 'providerStatus', 'inputTokens', 'cachedInputTokens',
  'outputTokens', 'reasoningTokens', 'totalTokens', 'maxOutputTokens', 'incompleteReason',
  'elapsedMs',
] as const;

const dispatched = async (outcome: GptRunOutcome): Promise<Record<string, unknown>> => {
  const result = await architect(outcome).dispatch({
    taskId: 'plan-1:task', attempt: { leaseGeneration: 1 }, reads: { plan: { taskId: 'plan-1', leaseGeneration: 1 } }, contextId: 'ctx-diag-1', taskType: 'plan',
  });
  return (result.diagnostics ?? {}) as Record<string, unknown>;
};

const refused = async (outcome: GptRunOutcome): Promise<Record<string, unknown>> => {
  try {
    await architect(outcome).dispatch({ taskId: 'plan-1:task', attempt: { leaseGeneration: 1 }, reads: { plan: { taskId: 'plan-1', leaseGeneration: 1 } }, contextId: 'ctx-diag-1', taskType: 'plan' });
  } catch (error) {
    return ((error as { diagnostics?: unknown }).diagnostics ?? {}) as Record<string, unknown>;
  }
  throw new Error('the dispatch was expected to be refused');
};

describe('A · 1–6 · the architect reports the same provider facts however it ends', () => {
  it('1 · a plan that VALIDATED carries every provider fact', async () => {
    // The heart of finding E. A successful paid architect call used to record
    // no elapsed time, no provider status, no total or reasoning tokens and no
    // ceiling — so the run that the paid proof actually reads left less
    // evidence than one that failed.
    const diagnostics = await dispatched(succeeded(JSON.stringify(VALID_PLAN)));
    for (const fact of PROVIDER_FACTS) {
      expect(diagnostics, `a validated plan must report ${fact}`).toHaveProperty(fact);
    }
    expect(diagnostics.outcome).toBe('succeeded');
    expect(diagnostics.servedModel).toBe('gpt-5.6-sol-2026-04');
    expect(diagnostics.providerStatus).toBe('completed');
  });

  it('2 · every usage number arrives from its OWN field', async () => {
    // Distinct fixtures, so a row populated from the wrong member of `usage`
    // cannot pass by coincidence.
    const diagnostics = await dispatched(succeeded(JSON.stringify(VALID_PLAN)));
    expect(diagnostics.inputTokens).toBe(USAGE.inputTokens);
    expect(diagnostics.cachedInputTokens).toBe(USAGE.cachedInputTokens);
    expect(diagnostics.outputTokens).toBe(USAGE.outputTokens);
    expect(diagnostics.reasoningTokens).toBe(USAGE.reasoningTokens);
    expect(diagnostics.totalTokens).toBe(USAGE.totalTokens);
    // The ceiling in force, so "it ran out" stays checkable.
    expect(diagnostics.maxOutputTokens).toBe(4_000);
  });

  it('3 · a plan that was BOUGHT and then refused still reports what it cost', async () => {
    // The unparseable-JSON path. A provider call was made and its answer thrown
    // away; reporting no tokens there makes the spend invisible in the one row
    // that explains the refusal.
    const diagnostics = await refused(succeeded('this is not json at all'));
    expect(diagnostics.jsonParseable).toBe(false);
    for (const fact of PROVIDER_FACTS) {
      expect(diagnostics, `a refused plan must report ${fact}`).toHaveProperty(fact);
    }
    expect(diagnostics.inputTokens).toBe(USAGE.inputTokens);
    expect(diagnostics.totalTokens).toBe(USAGE.totalTokens);
  });

  it('4 · a plan that parsed and then FAILED VALIDATION reports the same', async () => {
    const diagnostics = await refused(succeeded(JSON.stringify({ objectiveSummary: 'nothing else' })));
    expect(diagnostics.validationPassed).toBe(false);
    expect(diagnostics.validationReasonCode).not.toBeNull();
    for (const fact of PROVIDER_FACTS) {
      expect(diagnostics, `a rejected plan must report ${fact}`).toHaveProperty(fact);
    }
    expect(diagnostics.outputTokens).toBe(USAGE.outputTokens);
  });

  it('5 · a connector failure that never reached the provider reports null, not zero', async () => {
    // The other direction, and the one that must NOT be "fixed". No answer came
    // back, so every provider number is unknown — and unknown is null.
    const diagnostics = await refused({
      ok: false, failureClass: 'network_disconnected', message: 'the call never landed',
    });
    expect(diagnostics.servedModel).toBeNull();
    expect(diagnostics.responseId).toBeNull();
    expect(diagnostics.providerStatus).toBeNull();
    for (const token of ['inputTokens', 'cachedInputTokens', 'outputTokens', 'reasoningTokens', 'totalTokens']) {
      expect(diagnostics[token], `${token} must be null, never 0`).toBeNull();
    }
    // Validation was never reached, which is not the same claim as failing it.
    expect(diagnostics.validationPassed).toBeNull();
  });

  it('6 · elapsedMs is a measurement, and incompleteReason is null on a success', async () => {
    const diagnostics = await dispatched(succeeded(JSON.stringify(VALID_PLAN)));
    expect(typeof diagnostics.elapsedMs).toBe('number');
    expect(diagnostics.elapsedMs as number).toBeGreaterThanOrEqual(0);
    // A success is by definition not incomplete. Null is the true answer, and
    // reporting anything else would be a sentence the provider never said.
    expect(diagnostics.incompleteReason).toBeNull();
  });
});

describe('B · 7–8 · no site can report a subset', () => {
  const source = () => read('relay-bridge/julius/live-workers.ts');

  it('7 · every planDiagnostics call spreads the one constructor', () => {
    // THE GUARD THAT MAKES SECTION A HOLD FOR SITES IT DOES NOT DRIVE. Six
    // behavioural proofs cannot cover a seventh site added later, and picking
    // fields by hand is exactly how six sites came to disagree.
    const calls = callBodies(source(), 'planDiagnostics({');
    // Ten since the architect gained a rebuttal branch and an architecture
    // consultation: each one's refusal and success report through the same one
    // constructor. Twelve since PR 12: a PLAN or GUIDANCE body Julius cannot
    // store after the paid call fails through the same constructor too
    // (`storedAfterCallFailure`), and the loop below holds both to it.
    expect(calls.length, 'the call sites must still be findable').toBe(12);
    for (const body of calls) {
      expect(body, `a planDiagnostics call omits providerFacts: ${body.slice(0, 80)}`)
        .toContain('...providerFacts(');
    }
  });

  it('8 · the constructor reports every provider fact, and each from its own source', () => {
    const body = /const providerFacts = \([\s\S]*?\n\}\);/u.exec(source())?.[0] ?? '';
    expect(body, 'providerFacts must be findable').not.toBe('');
    for (const fact of PROVIDER_FACTS) {
      expect(body, `providerFacts must report ${fact}`).toMatch(new RegExp(`\\b${fact}:`, 'u'));
    }
    // The mutation this kills: reading one usage number off another.
    for (const token of ['inputTokens', 'cachedInputTokens', 'outputTokens', 'reasoningTokens', 'totalTokens']) {
      expect(body, `${token} must come from usage.${token}`).toContain(`${token}: outcome.usage?.${token}`);
    }
  });
});

describe('C · 9–12 · the terminal row can finally say why', () => {
  const coordinator = () => read('src/relay/mission/julius/julius-execution-coordinator.ts');
  const pipeline = () => read('src/relay/mission/julius/julius-task-pipeline.ts');

  it('9 · the failure outcome carries the flattened diagnostics', () => {
    const source = coordinator();
    // The type must offer them…
    expect(source).toMatch(/readonly diagnostics\?:Record<string,string\|number\|boolean\|null>;/u);
    // …and every failure return must actually carry them. Three: selection,
    // retry, and the terminal failure.
    expect([...source.matchAll(/\.\.\.carriedDiagnostics\(failure\)/gu)]).toHaveLength(3);
  });

  it('10 · absent when the boundary reported none — not an empty object', () => {
    // Absent and empty are different claims, and an always-present `{}` would
    // also change the shape of every outcome with nothing to say.
    expect(coordinator()).toContain('return Object.keys(flat).length===0?{}:{diagnostics:flat};');
  });

  it('11 · the pipeline puts them on the row that ends the task', () => {
    const source = pipeline();
    const terminal = /await ledger\.event\('task\.failed', \{[\s\S]*?awaitingHuman: carryOn\.awaitingHuman,/u
      .exec(source)?.[0] ?? '';
    expect(terminal, 'the terminal task.failed must be findable').not.toBe('');
    expect(terminal, 'the terminal task.failed must carry the boundary facts')
      .toContain('...(outcome.diagnostics ?? {})');
  });

  it('12 · the diag_ prefix is what makes the spread safe', () => {
    // The row already writes `code`, `reasonCode`, `awaitingHuman`,
    // `failureClass` and `errorRetryable`. A carried key that collided with one
    // of those would replace a fact Julius owns with one an adapter supplied.
    expect(read('src/relay/mission/julius/julius-router.ts'))
      .toContain('out[`diag_${key}`]=entry;');
  });
});

describe('D · 13 · the architect says how it is paid for, on every ending', () => {
  it('13 · a validated plan and a refused one both name API_BILLED, beside an amount nobody reported', async () => {
    // BY CONSTRUCTION, NOT BY INFERENCE: this adapter cannot exist without an
    // OpenAI API key, so every dispatch it makes is billed to that key. The
    // amount stays unknown — Chat Completions never states a price — and the
    // ledger can now say "API-billed, amount not reported" instead of UNKNOWN.
    const result = await architect(succeeded(JSON.stringify(VALID_PLAN))).dispatch({
      taskId: 'plan-1:task', attempt: { leaseGeneration: 1 }, reads: { plan: { taskId: 'plan-1', leaseGeneration: 1 } }, contextId: 'ctx-diag-1', taskType: 'plan',
    });
    expect(result.usage).toMatchObject({ costBasis: 'UNKNOWN', billingPath: 'API_BILLED' });
    expect((result.usage as Record<string, unknown>).usdMicros, 'the path is known; the amount is not').toBeUndefined();
    expect(result.diagnostics).toMatchObject({ costBasis: 'UNKNOWN', billingPath: 'API_BILLED' });
    // Bought and then refused: the same fact, read AFTER the durable allowlist.
    expect(await refused(succeeded('this is not a plan'))).toMatchObject({ costBasis: 'UNKNOWN', billingPath: 'API_BILLED' });
  });
});
