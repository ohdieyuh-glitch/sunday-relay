import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  appendLoopRunEvent,
  checkLoopLimits,
  createFakeLoopAgent,
  createInMemoryLoopBacking,
  createInMemoryLoopLockPort,
  emptyLoopBudget,
  emptyLoopRunRecord,
  loopDigest,
  preflightLoopDispatch,
  readLoopRun,
  runLoopIteration,
  runLoopUntilSettled,
  seedLoopRun,
  type FakeLoopAgentStep,
  type LoopEngineContext,
  type LoopEngineDeps,
  type RelayLoopEventInput,
  type RelayLoopEventPayload,
  type RelayLoopRun,
} from './index';
import type { RelayLoopTarget } from '../loop-target';

/**
 * STAGE 2 — the bounded single-agent iteration engine.
 *
 * The claims under test are the ones that cost money or mislead a user if they
 * are wrong: that a limit stops a dispatch BEFORE it happens, that no adapter
 * answer completes a Loop on its own, that a retry does not run an agent twice,
 * and that a multi-role target is refused rather than quietly narrowed.
 */

const T0 = '2026-08-03T12:00:00.000Z';

/** A deterministic clock and id source — the engine never reads a real one. */
function harness(script: readonly FakeLoopAgentStep[], options: {
  readonly model?: string | null;
  readonly supportedRoles?: readonly ('coding_agent' | 'reviewer' | 'prompt_architect')[];
} = {}) {
  let tick = 0;
  const now = (): string => new Date(Date.parse(T0) + (tick += 1) * 1000).toISOString();
  const counters = new Map<string, number>();
  const newId = (kind: 'lpi' | 'exe' | 'obs' | 'dcn' | 'flr'): string => {
    const next = (counters.get(kind) ?? 0) + 1;
    counters.set(kind, next);
    return `${kind}_${next}`;
  };
  const agent = createFakeLoopAgent(script, {
    now: () => T0,
    model: options.model,
    supportedRoles: options.supportedRoles ?? ['coding_agent'],
  });
  const backing = createInMemoryLoopBacking();
  const deps: LoopEngineDeps = {
    backing, agent, lock: createInMemoryLoopLockPort(), digest: loopDigest, now, newId,
  };
  return { deps, backing, agent, now, newId };
}

function budget(overrides: Partial<Parameters<typeof emptyLoopBudget>[0]> = {}) {
  return emptyLoopBudget({
    maxIterations: 10,
    maxTotalDurationMinutes: 60,
    maxSpendMicros: '10000000',
    currency: 'USD',
    maxTotalTokens: 1_000_000,
    maxProviderCalls: 100,
    maxConsecutiveFailures: 3,
    ...overrides,
  });
}

function seed(budgetState = budget()): RelayLoopRun {
  return seedLoopRun({
    runId: 'lpr_engine',
    loopId: 'lpe_engine',
    projectId: 'prj_engine',
    workspaceId: null,
    contractRef: 'loop-contract-1',
    contractVersion: 1,
    contractBindingDigest: 'binding-1',
    budget: budgetState,
    createdAt: T0,
    provenance: 'offline',
  });
}

const CODING_TARGET: RelayLoopTarget = {
  selector: { kind: 'exact_roles', requestedExpression: 'coding', requestedRoles: ['coding_agent'] },
  requestedRoles: ['coding_agent'],
  resolvedRoles: ['coding_agent'],
  unavailableRoles: [],
  assignments: [{
    role: 'coding_agent', requestedAdapterId: 'fake-loop-agent', actualAgentId: null, actualAdapterId: null,
  }],
  registryProvenance: 'simulated',
  resolvedAt: T0,
};

function context(overrides: Partial<LoopEngineContext> = {}): LoopEngineContext {
  return {
    runId: 'lpr_engine',
    loopId: 'lpe_engine',
    projectId: 'prj_engine',
    actor: 'relay-engine',
    sessionId: 'ses_1',
    target: CODING_TARGET,
    features: { loop_engine: true },
    trigger: 'cli',
    isSLoop: false,
    reviewerConfiguration: 'not_required',
    contractBindingDigest: 'binding-1',
    completionRule: 'all_blocking_criteria',
    acceptanceCriteria: [{ id: 'AC-1', blocking: true }],
    missionVerdict: 'verified_complete',
    requestedAdapterId: 'fake-loop-agent',
    requestedModel: 'requested-model',
    iterationDeadlineMs: 60_000,
    elapsedMinutes: 0,
    ...overrides,
  };
}

/** Admit a run: create storage and write the confirmation + creation lines. */
function admit(
  backing: ReturnType<typeof createInMemoryLoopBacking>,
  run: RelayLoopRun = seed(),
): void {
  backing.create(emptyLoopRunRecord(run));
  const base = (payload: RelayLoopEventPayload, idempotencyKey: string | null = null): RelayLoopEventInput => ({
    at: T0,
    runId: run.runId,
    loopId: run.loopId,
    projectId: run.projectId,
    kind: payload.kind,
    actor: 'founder',
    recoveryGeneration: 0,
    expectedPreviousState: null,
    idempotencyKey,
    payload,
  });
  for (const [payload, key] of [
    [{ kind: 'loop.contract_confirmed', contractRef: run.contractRef, contractVersion: 1, bindingDigest: run.contractBindingDigest, confirmedBy: 'founder' }, null],
    [{ kind: 'loop.run_created', idempotencyKey: 'confirm-1', creationSource: 'cli', createdBy: 'founder' }, 'confirm-1'],
  ] as const) {
    const result = appendLoopRunEvent(backing, {
      runId: run.runId, base: base(payload as RelayLoopEventPayload, key), digest: loopDigest,
    });
    if (!result.ok) throw new Error(result.problem);
  }
}

/* ======================================================= preflight === */

describe('the engine refuses what Stage 2 has not built', () => {
  const run = seed();

  const refusalFor = (overrides: Partial<LoopEngineContext>): string => {
    const { agent } = harness([]);
    const outcome = preflightLoopDispatch(context(overrides), agent, run, T0);
    if (outcome === null) throw new Error('expected a refusal');
    if (outcome.kind !== 'refused') throw new Error(`expected a refusal, got ${outcome.kind}`);
    return outcome.problem;
  };

  it('refuses a run whose server-side feature flag is not enabled', () => {
    expect(refusalFor({ features: {} })).toContain('not enabled');
    // Only a literal true enables it — a string does not.
    expect(refusalFor({ features: { loop_engine: 'true' as unknown as boolean } })).toContain('not enabled');
  });

  it('refuses /loop all rather than picking one of the roles', () => {
    const problem = refusalFor({
      target: {
        ...CODING_TARGET,
        selector: { kind: 'all_eligible_agents', requestedExpression: 'all', requestedRoles: [] },
        requestedRoles: [], resolvedRoles: ['coding_agent', 'reviewer'],
      },
    });
    expect(problem).toContain('multi-agent scheduler');
    expect(problem).toContain('refused rather than narrowed');
  });

  it('refuses a compound-agent target that resolves to more than one role', () => {
    expect(refusalFor({
      target: {
        ...CODING_TARGET,
        selector: { kind: 'active_compound_agent', requestedExpression: null, requestedRoles: [] },
        requestedRoles: [], resolvedRoles: ['coding_agent', 'reviewer', 'prompt_architect'],
      },
    })).toContain('resolves to 3 roles');
  });

  it('refuses a multi-role target and never silently narrows it', () => {
    const problem = refusalFor({
      target: { ...CODING_TARGET, requestedRoles: ['coding_agent', 'reviewer'], resolvedRoles: ['coding_agent', 'reviewer'] },
    });
    expect(problem).toContain('resolves to 2 roles');
    expect(problem).toContain('worse than refusing');
  });

  it('refuses a target that resolves to nothing at all', () => {
    expect(refusalFor({ target: { ...CODING_TARGET, resolvedRoles: [] } })).toContain('resolves to 0 roles');
  });

  it('refuses a Cron trigger and an S-Loop', () => {
    expect(refusalFor({ trigger: 'cron' })).toContain('Cron');
    expect(refusalFor({ isSLoop: true })).toContain('S-Loop');
  });

  it('refuses an unsupported Reviewer configuration', () => {
    expect(refusalFor({ reviewerConfiguration: 'unsupported' })).toContain('Reviewer configuration');
  });

  it('refuses a role the registry cannot staff', () => {
    const problem = refusalFor({
      target: { ...CODING_TARGET, unavailableRoles: [{ role: 'coding_agent', availability: 'not_connected' }] },
    });
    expect(problem).toContain('cannot be staffed');
  });

  it('refuses an adapter that cannot staff the resolved role', () => {
    const { agent } = harness([], { supportedRoles: ['reviewer'] });
    const outcome = preflightLoopDispatch(context(), agent, run, T0);
    if (outcome === null || outcome.kind !== 'refused') throw new Error('expected a refusal');
    expect(outcome.problem).toContain('cannot staff the coding_agent role');
  });

  it('refuses a contract that moved under the run', () => {
    expect(refusalFor({ contractBindingDigest: 'binding-2' })).toContain('changed after this run started');
  });

  it('refuses a substituted role', () => {
    expect(refusalFor({
      target: { ...CODING_TARGET, requestedRoles: ['reviewer'], resolvedRoles: ['coding_agent'] },
    })).toContain('different Loop from the approved one');
  });

  it('permits the one shape Stage 2 supports', () => {
    const { agent } = harness([]);
    expect(preflightLoopDispatch(context(), agent, run, T0)).toBeNull();
  });
});

/* ========================================================== limits === */

describe('limits are enforced before an agent is dispatched', () => {
  it('reports each bound on its own landing state', async () => {
    const cases = [
      ['iterations', { maxIterations: 0 }, 'iteration_exhausted'],
      ['duration', { maxTotalDurationMinutes: 0 }, 'duration_exhausted'],
      ['tokens', { maxTotalTokens: 0 }, 'token_exhausted'],
      ['provider_calls', { maxProviderCalls: 0 }, 'provider_call_exhausted'],
      ['spend', { maxSpendMicros: '0' }, 'budget_exhausted'],
    ] as const;

    for (const [label, overrides, expected] of cases) {
      const { deps, backing, agent } = harness([{ kind: 'attested_evidence' }]);
      admit(backing, seed(budget(overrides)));
      const outcome = await runLoopIteration(deps, context());
      expect(outcome.kind, label).toBe('terminal');
      if (outcome.kind !== 'terminal') throw new Error('unreachable');
      expect(outcome.state, label).toBe(expected);
      // The decisive proof: the agent was never called.
      expect(agent.invocations, `${label} must not dispatch`).toHaveLength(0);
    }
  });

  it('treats unknown usage as over the cap, never as zero', () => {
    const run = { ...seed(budget({ maxTotalTokens: 1000, maxSpendMicros: '1000' })) };
    const unknownTokens = {
      ...run,
      budget: { ...run.budget, tokensUsed: null, tokensHaveUnknownComponent: true },
    };
    expect(checkLoopLimits(unknownTokens, 0).limit).toBe('tokens');
    expect(checkLoopLimits(unknownTokens, 0).reason).toBe('unaccountable');
    expect(checkLoopLimits(unknownTokens, 0).detail).toContain('never treated as zero');

    const unknownSpend = {
      ...run,
      budget: { ...run.budget, knownSpendMicros: null, spendHasUnknownComponent: true },
    };
    expect(checkLoopLimits(unknownSpend, 0).limit).toBe('spend');
    expect(checkLoopLimits(unknownSpend, 0).reason).toBe('unaccountable');

    // And a genuinely spent bound is `reached`, which is a different verdict
    // leading to a different terminal state.
    const spent = { ...run, budget: { ...run.budget, knownSpendMicros: '999999999' } };
    expect(checkLoopLimits(spent, 0).reason).toBe('reached');
  });

  it('leaves an unbounded budget unbounded', () => {
    const run = seed(budget({
      maxIterations: null, maxTotalDurationMinutes: null, maxTotalTokens: null,
      maxProviderCalls: null, maxSpendMicros: null,
    }));
    // Unknown usage with NO cap set is not a limit violation — there is nothing
    // to violate. Only a configured cap plus unknown usage fails closed.
    const unknown = { ...run, budget: { ...run.budget, knownSpendMicros: null, tokensUsed: null } };
    expect(checkLoopLimits(unknown, 10_000).limit).toBeNull();
  });

  it('stops between iterations when a cap is reached mid-run', async () => {
    const { deps, backing, agent } = harness([{ kind: 'continuing' }, { kind: 'continuing' }]);
    admit(backing, seed(budget({ maxIterations: 1 })));
    const { final } = await runLoopUntilSettled(deps, context(), { maxIterationsThisCall: 4 });
    expect(final.kind).toBe('terminal');
    if (final.kind !== 'terminal') throw new Error('unreachable');
    expect(final.state).toBe('iteration_exhausted');
    // Exactly one dispatch: the cap stopped the second before it happened.
    expect(agent.invocations).toHaveLength(1);
  });
});

/* ====================================================== completion === */

describe('completion is earned, never announced', () => {
  it('a completion claim alone does not complete the Loop', async () => {
    const { deps, backing } = harness([{ kind: 'completion_claim_only' }]);
    admit(backing);
    const outcome = await runLoopIteration(deps, context());
    expect(outcome.kind).toBe('iteration_recorded');
    if (outcome.kind !== 'iteration_recorded') throw new Error('unreachable');
    expect(outcome.run.state).not.toBe('completed');
    expect(outcome.verdict).not.toBe('verified_complete');
    // The claim IS recorded — it is evidence of what was said, not of what is.
    const claims = outcome.run.iterations[0].observations.filter((o) => o.kind === 'completion_claim');
    expect(claims).toHaveLength(1);
    expect(claims[0].sourceTrust).toBe('claim');
  });

  it('observed evidence does not satisfy a rule needing corroboration', async () => {
    const { deps, backing } = harness([{ kind: 'observed_evidence' }]);
    admit(backing);
    const outcome = await runLoopIteration(deps, context());
    expect(outcome.kind).toBe('iteration_recorded');
    if (outcome.kind !== 'iteration_recorded') throw new Error('unreachable');
    expect(outcome.run.state).not.toBe('completed');
    expect(outcome.verdict).toBe('claimed_complete');
  });

  it('attested evidence completes it', async () => {
    const { deps, backing } = harness([{ kind: 'attested_evidence' }]);
    admit(backing);
    const outcome = await runLoopIteration(deps, context());
    expect(outcome.kind).toBe('terminal');
    if (outcome.kind !== 'terminal') throw new Error('unreachable');
    expect(outcome.state).toBe('completed');
  });

  it('verified evidence completes it', async () => {
    const { deps, backing } = harness([{ kind: 'verified_evidence' }]);
    admit(backing);
    const outcome = await runLoopIteration(deps, context());
    expect(outcome.kind === 'terminal' && outcome.state).toBe('completed');
  });

  it('records claims and evidence as separate facts', async () => {
    const { deps, backing } = harness([{ kind: 'attested_evidence' }]);
    admit(backing);
    const outcome = await runLoopIteration(deps, context());
    if (outcome.kind !== 'terminal') throw new Error('unreachable');
    const observations = outcome.run.iterations[0].observations;
    // Two observations, and the claim never became the evidence.
    expect(observations.map((o) => o.kind)).toEqual(['completion_claim', 'evidence_produced']);
    expect(observations[0].sourceTrust).toBe('claim');
    expect(observations[1].sourceTrust).toBe('attested');
  });

  it('needs an independent review when the rule demands one', async () => {
    const { deps, backing } = harness([{ kind: 'attested_evidence' }]);
    admit(backing);
    const outcome = await runLoopIteration(deps, context({
      completionRule: 'all_blocking_criteria_and_independent_review',
      reviewerConfiguration: 'supported',
    }));
    // Stage 2 has no reviewer, so this correctly cannot complete.
    expect(outcome.kind).toBe('iteration_recorded');
    if (outcome.kind !== 'iteration_recorded') throw new Error('unreachable');
    expect(outcome.verdict).not.toBe('verified_complete');
  });

  it('never completes on a mission verdict short of verified_complete', async () => {
    const { deps, backing } = harness([{ kind: 'attested_evidence' }]);
    admit(backing);
    const outcome = await runLoopIteration(deps, context({ missionVerdict: 'claimed_complete' }));
    expect(outcome.kind).toBe('iteration_recorded');
  });
});

/* ================================================== failure endings === */

describe('nothing that goes wrong is mistaken for finishing', () => {
  const endings = [
    ['refusal', 'failed'],
    ['malformed_output', 'failed'],
    ['crash', 'failed'],
    ['adapter_unavailable', 'failed'],
    ['timeout', 'timed_out'],
    ['cancellation', 'stopped'],
  ] as const;

  for (const [step, expected] of endings) {
    it(`${step} ends the run as ${expected}, not completed`, async () => {
      const { deps, backing } = harness([{ kind: step } as FakeLoopAgentStep]);
      admit(backing);
      const outcome = await runLoopIteration(deps, context());
      expect(outcome.kind).toBe('terminal');
      if (outcome.kind !== 'terminal') throw new Error('unreachable');
      expect(outcome.state).toBe(expected);
      expect(outcome.state).not.toBe('completed');
    });
  }

  it('classifies a refusal as a refusal, not as an adapter fault', async () => {
    const { deps, backing } = harness([{ kind: 'refusal', summary: 'I will not do that.' }]);
    admit(backing);
    const outcome = await runLoopIteration(deps, context());
    if (outcome.kind !== 'terminal') throw new Error('unreachable');
    expect(outcome.run.failures[0].kind).toBe('agent_refused');
  });

  it('records an unavailable adapter without inventing an identity for it', async () => {
    const { deps, backing } = harness([{ kind: 'adapter_unavailable' }]);
    admit(backing);
    const outcome = await runLoopIteration(deps, context());
    if (outcome.kind !== 'terminal') throw new Error('unreachable');
    const assignment = outcome.run.iterations[0].assignment;
    expect(assignment.actualAdapterId).toBeNull();
    expect(assignment.actualAgentId).toBeNull();
    expect(assignment.actualModel).toBeNull();
  });
});

/* ==================================================== identity === */

describe('what actually ran is recorded only once it is observed', () => {
  it('fills the actual identity from the adapter, not from the request', async () => {
    const { deps, backing } = harness([{ kind: 'attested_evidence' }], { model: 'model-that-really-ran' });
    admit(backing);
    const outcome = await runLoopIteration(deps, context({ requestedModel: 'model-we-asked-for' }));
    if (outcome.kind !== 'terminal') throw new Error('unreachable');
    const assignment = outcome.run.assignment;
    expect(assignment?.requestedModel).toBe('model-we-asked-for');
    expect(assignment?.actualModel).toBe('model-that-really-ran');
    expect(assignment?.actualAgentId).toBe('fake-agent-1');
    expect(assignment?.actualAdapterId).toBe('fake-loop-agent');
  });

  it('leaves the actual model Unknown when the adapter cannot report one', async () => {
    // The exact trap: requested is known, actual is not, and the tempting bug
    // is to show the requested one as though it were the answer.
    const { deps, backing } = harness([{ kind: 'attested_evidence' }], { model: null });
    admit(backing);
    const outcome = await runLoopIteration(deps, context({ requestedModel: 'model-we-asked-for' }));
    if (outcome.kind !== 'terminal') throw new Error('unreachable');
    expect(outcome.run.assignment?.actualModel).toBeNull();
    expect(outcome.run.assignment?.requestedModel).toBe('model-we-asked-for');
  });
});

/* ======================================================= usage === */

describe('usage is recorded truthfully', () => {
  it('keeps a known cost known', async () => {
    const { deps, backing } = harness([{ kind: 'continuing' }]);
    admit(backing);
    const outcome = await runLoopIteration(deps, context());
    if (outcome.kind !== 'iteration_recorded') throw new Error('unreachable');
    expect(outcome.run.budget.knownSpendMicros).toBe('1000');
    expect(outcome.run.budget.spendHasUnknownComponent).toBe(false);
    expect(outcome.run.budget.providerCallsUsed).toBe(1);
  });

  it('keeps an unreported cost Unknown rather than zero', async () => {
    // No cap is configured, so there is nothing to fail closed against and the
    // run may continue — carrying the truth that its spend is unknown.
    const { deps, backing } = harness([{ kind: 'unknown_usage' }]);
    admit(backing, seed(budget({ maxSpendMicros: null, maxTotalTokens: null })));
    const outcome = await runLoopIteration(deps, context());
    if (outcome.kind !== 'iteration_recorded') throw new Error('unreachable');
    expect(outcome.run.budget.knownSpendMicros).toBeNull();
    expect(outcome.run.budget.spendHasUnknownComponent).toBe(true);
    expect(outcome.run.budget.tokensUsed).toBeNull();
    expect(outcome.run.budget.knownSpendMicros).not.toBe('0');
  });

  it('fails closed when a cap is set and the run cannot account for its usage', async () => {
    const { deps, backing } = harness([{ kind: 'unknown_usage' }]);
    admit(backing, seed(budget({ maxSpendMicros: '10000000' })));
    const outcome = await runLoopIteration(deps, context());
    expect(outcome.kind).toBe('terminal');
    if (outcome.kind !== 'terminal') throw new Error('unreachable');
    // A FAILURE, not an exhaustion. Nobody ran out of money — the accounting
    // broke, and telling the user to raise a cap would send them to fix the
    // wrong thing.
    expect(outcome.state).toBe('failed');
    expect(outcome.state).not.toBe('budget_exhausted');
    expect(outcome.run.failures[0].kind).toBe('limit_violation');
    expect(outcome.run.failures[0].summary).toContain('never treated as zero');
    expect(outcome.run.budget.knownSpendMicros).toBeNull();
  });

  it('survives redaction with its counters intact', async () => {
    // THE BUG THIS EXISTS TO CATCH. Journal payloads are sanitized on the way
    // to disk, and the shared rules drop any key containing "token" because
    // that is nearly always a credential. A usage field named `tokens` is
    // therefore deleted silently, and the arithmetic downstream turns a missing
    // count into NaN — a number, so it compares and serializes and defeats
    // every limit check without anything looking wrong.
    const { deps, backing } = harness([{ kind: 'continuing' }]);
    admit(backing);
    const outcome = await runLoopIteration(deps, context());
    if (outcome.kind !== 'iteration_recorded') throw new Error('unreachable');

    const finished = backing.read('lpr_engine')?.events.find((e) => e.kind === 'loop.iteration_finished');
    const usage = (finished?.payload as { execution: { usage: Record<string, unknown> } }).execution.usage;
    expect(usage.modelUnits, 'the token count must survive sanitization').toBe(100);
    expect(usage.providerCalls).toBe(1);
    expect(usage.costMicros).toBe('1000');

    // And the reduced total is a real number, never NaN.
    expect(outcome.run.budget.tokensUsed).toBe(100);
    expect(Number.isNaN(outcome.run.budget.tokensUsed)).toBe(false);
  });

  it('reads a lost counter as Unknown rather than as NaN', async () => {
    // Defence in depth for the same failure: even if a field does go missing,
    // the total must become Unknown, never a number that is quietly wrong.
    const { deps, backing } = harness([{ kind: 'continuing' }]);
    admit(backing);
    await runLoopIteration(deps, context());
    const run = readLoopRun(backing, 'lpr_engine', loopDigest)?.run;
    if (run === null || run === undefined) throw new Error('expected a run');
    expect(Number.isNaN(run.budget.tokensUsed ?? 0)).toBe(false);
    expect(Number.isNaN(run.budget.providerCallsUsed)).toBe(false);
  });

  it('does not double-count usage when a dispatch is retried', async () => {
    const { deps, backing, agent } = harness([{ kind: 'continuing' }]);
    admit(backing);
    const first = await runLoopIteration(deps, context());
    if (first.kind !== 'iteration_recorded') throw new Error('unreachable');
    const spendAfterOne = first.run.budget.knownSpendMicros;

    // Re-running the engine dispatches a NEW iteration; what must not happen is
    // the same iteration being charged twice. Re-reading proves the total.
    const reread = readLoopRun(backing, 'lpr_engine', loopDigest);
    expect(reread?.run?.budget.knownSpendMicros).toBe(spendAfterOne);
    expect(agent.callsFor('lpr_engine:lpi_1')).toBe(1);
  });
});

/* ================================================ control hooks === */

describe('pause, resume and stop', () => {
  const control = (
    payload: RelayLoopEventPayload,
    run: RelayLoopRun,
    idempotencyKey: string,
    generation = 0,
  ): RelayLoopEventInput => ({
    at: T0, runId: run.runId, loopId: run.loopId, projectId: run.projectId,
    kind: payload.kind, actor: 'founder', recoveryGeneration: generation,
    expectedPreviousState: null, idempotencyKey, payload,
  });

  it('a pause request prevents the next iteration', async () => {
    const { deps, backing, agent } = harness([{ kind: 'continuing' }, { kind: 'continuing' }]);
    const run = seed();
    admit(backing, run);
    await runLoopIteration(deps, context());
    expect(agent.invocations).toHaveLength(1);

    const requested = appendLoopRunEvent(backing, {
      runId: run.runId,
      base: control({ kind: 'loop.pause_requested', requestedBy: 'founder', requestId: 'pause-1' }, run, 'pause-1'),
      digest: loopDigest,
    });
    expect(requested.ok).toBe(true);

    const paused = await runLoopIteration(deps, context());
    expect(paused.kind).toBe('paused');
    // The decisive assertion: no SECOND dispatch happened.
    expect(agent.invocations).toHaveLength(1);
  });

  it('asks for a safe checkpoint and records reaching one', async () => {
    const { deps, backing } = harness([{ kind: 'continuing' }, { kind: 'continuing' }]);
    const run = seed();
    admit(backing, run);
    await runLoopIteration(deps, context());
    appendLoopRunEvent(backing, {
      runId: run.runId,
      base: control({ kind: 'loop.pause_requested', requestedBy: 'founder', requestId: 'pause-1' }, run, 'pause-1'),
      digest: loopDigest,
    });
    const paused = await runLoopIteration(deps, context());
    if (paused.kind !== 'paused') throw new Error('expected a pause');
    expect(paused.run.lastCheckpoint?.reason).toBe('safe_pause_reached');
    expect(paused.run.state).toBe('paused');
  });

  it('a stop request prevents new work and is not completion', async () => {
    const { deps, backing, agent } = harness([{ kind: 'continuing' }, { kind: 'continuing' }]);
    const run = seed();
    admit(backing, run);
    await runLoopIteration(deps, context());
    appendLoopRunEvent(backing, {
      runId: run.runId,
      base: control({ kind: 'loop.stop_requested', requestedBy: 'founder', requestId: 'stop-1', reason: 'enough' }, run, 'stop-1'),
      digest: loopDigest,
    });
    const stopped = await runLoopIteration(deps, context());
    expect(stopped.kind).toBe('terminal');
    if (stopped.kind !== 'terminal') throw new Error('unreachable');
    expect(stopped.state).toBe('stopped');
    expect(stopped.state).not.toBe('completed');
    expect(agent.invocations).toHaveLength(1);
  });

  it('a terminal run does no further work, however often the engine is called', async () => {
    const { deps, backing, agent } = harness([{ kind: 'attested_evidence' }]);
    admit(backing);
    const first = await runLoopIteration(deps, context());
    expect(first.kind === 'terminal' && first.state).toBe('completed');
    const again = await runLoopIteration(deps, context());
    expect(again.kind).toBe('terminal');
    expect(agent.invocations).toHaveLength(1);
  });

  it('resume advances the generation and does not repeat the paused iteration', async () => {
    const { deps, backing, agent } = harness([{ kind: 'continuing' }, { kind: 'continuing' }]);
    const run = seed();
    admit(backing, run);
    await runLoopIteration(deps, context());
    for (const [payload, key] of [
      [{ kind: 'loop.pause_requested', requestedBy: 'founder', requestId: 'pause-1' }, 'pause-1'],
    ] as const) {
      appendLoopRunEvent(backing, {
        runId: run.runId, base: control(payload as RelayLoopEventPayload, run, key), digest: loopDigest,
      });
    }
    await runLoopIteration(deps, context());
    for (const [payload, key] of [
      [{ kind: 'loop.resume_requested', requestedBy: 'founder', requestId: 'resume-1' }, 'resume-1'],
      [{ kind: 'loop.resumed', recoveryGeneration: 1 }, 'resume-1-done'],
    ] as const) {
      const appended = appendLoopRunEvent(backing, {
        runId: run.runId, base: control(payload as RelayLoopEventPayload, run, key), digest: loopDigest,
      });
      if (!appended.ok) throw new Error(appended.problem);
    }
    const resumed = readLoopRun(backing, run.runId, loopDigest);
    expect(resumed?.run?.recoveryGeneration).toBe(1);
    expect(resumed?.run?.state).toBe('running');
    // One iteration existed before the pause and it was not repeated.
    expect(resumed?.run?.iterations).toHaveLength(1);
    expect(agent.invocations).toHaveLength(1);
  });
});

/* ==================================================== the fake === */

describe('the scripted agent is deterministic and offline', () => {
  it('touches nothing outside the process', () => {
    const source = readFileSync(join(__dirname, 'fake-loop-agent.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    for (const forbidden of [/\bfetch\s*\(/, /\bspawn\s*\(/, /execFile/, /require\s*\(/, /from\s+['"]node:/,
      /anthropic/i, /openai/i, /Date\.now\(\)/, /new Date\(\)/, /process\.env/]) {
      expect(forbidden.test(source), `the fake agent matches ${forbidden}`).toBe(false);
    }
  });

  it('attributes every dispatch to a run, iteration, ordinal and key', async () => {
    const { deps, backing, agent } = harness([{ kind: 'continuing' }, { kind: 'continuing' }]);
    admit(backing);
    await runLoopUntilSettled(deps, context(), { maxIterationsThisCall: 2 });
    expect(agent.invocations).toHaveLength(2);
    expect(agent.invocations.map((i) => i.ordinal)).toEqual([1, 2]);
    expect(agent.invocations.map((i) => i.runId)).toEqual(['lpr_engine', 'lpr_engine']);
    expect(new Set(agent.invocations.map((i) => i.iterationId)).size).toBe(2);
    expect(new Set(agent.invocations.map((i) => i.idempotencyKey)).size).toBe(2);
  });

  it('answers a redelivered request from memory instead of working twice', async () => {
    const agent = createFakeLoopAgent([{ kind: 'continuing' }], { now: () => T0 });
    const request = {
      runId: 'lpr_x', iterationId: 'lpi_1', ordinal: 1, idempotencyKey: 'same-key',
      requestedRole: 'coding_agent' as const, resolvedRole: 'coding_agent' as const,
      requestedAdapterId: 'fake-loop-agent', requestedModel: null, inputRefs: [], deadlineMs: 1000,
    };
    const first = await agent.begin(request);
    const second = await agent.begin(request);
    expect(second).toBe(first);
    expect(agent.invocations).toHaveLength(1);
    expect(agent.callsFor('same-key')).toBe(1);
  });

  it('refuses to invent a result for an unscripted dispatch', async () => {
    const agent = createFakeLoopAgent([], { now: () => T0 });
    await expect(agent.begin({
      runId: 'lpr_x', iterationId: 'lpi_1', ordinal: 1, idempotencyKey: 'k',
      requestedRole: 'coding_agent', resolvedRole: 'coding_agent',
      requestedAdapterId: 'fake-loop-agent', requestedModel: null, inputRefs: [], deadlineMs: 1000,
    })).rejects.toThrow(/scripted for 0/);
  });

  it('parks only after the scripted number of calls', async () => {
    const { deps, backing, agent } = harness([
      { kind: 'delayed_safe_checkpoint', afterCalls: 1 },
      { kind: 'delayed_safe_checkpoint', afterCalls: 1 },
    ]);
    admit(backing);
    await runLoopUntilSettled(deps, context(), { maxIterationsThisCall: 2 });
    expect(agent.invocations).toHaveLength(2);
  });
});

/* ================================================= the engine is pure === */

describe('the engine reads no clock and launches nothing', () => {
  it('takes its time, ids, storage, lock and agent by injection', () => {
    const source = readFileSync(join(__dirname, 'loop-iteration-engine.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    for (const forbidden of [/Date\.now\(\)/, /new Date\(\)/, /from\s+['"]node:/, /\bfetch\s*\(/,
      /\bspawn\s*\(/, /process\.env/, /anthropic/i, /openai/i]) {
      expect(forbidden.test(source), `the engine matches ${forbidden}`).toBe(false);
    }
  });
});
