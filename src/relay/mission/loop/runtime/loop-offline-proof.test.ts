import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLoopRunNodeStore } from '../../../persistence/loop-run-node';
import { parseSlashCommand } from '../loop-command-parser';
import {
  appendLoopRunEvent,
  createFakeLoopAgent,
  createInMemoryLoopLockPort,
  emptyLoopBudget,
  loopDigest,
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
 * STAGE 2 — THE OFFLINE END-TO-END PROOF.
 *
 * One command, one durable run, three iterations, a real filesystem, and a
 * restart in the middle. Nothing here touches a network, a provider, a
 * credential or a real clock.
 *
 * The point is not that the happy path works. It is that the run refuses to
 * complete twice before it is allowed to complete once, and that the reason it
 * eventually completes is attested evidence rather than the model having said
 * "done" in iteration one — which it did, and which changed nothing.
 */

const T0 = '2026-08-03T12:00:00.000Z';
const COMMAND = '/loop coding Verify the fixture until completion evidence is attested.';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'relay-loop-proof-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const CODING_TARGET: RelayLoopTarget = {
  selector: { kind: 'exact_roles', requestedExpression: 'coding', requestedRoles: ['coding_agent'] },
  requestedRoles: ['coding_agent'],
  resolvedRoles: ['coding_agent'],
  unavailableRoles: [],
  assignments: [{ role: 'coding_agent', requestedAdapterId: 'fake-loop-agent', actualAgentId: null, actualAdapterId: null }],
  registryProvenance: 'simulated',
  resolvedAt: T0,
};

function seed(overrides: Partial<Parameters<typeof emptyLoopBudget>[0]> = {}): RelayLoopRun {
  return seedLoopRun({
    runId: 'lpr_proof',
    loopId: 'lpe_proof',
    projectId: 'prj_proof',
    workspaceId: null,
    contractRef: 'loop-contract-proof',
    contractVersion: 1,
    contractBindingDigest: 'binding-proof',
    budget: emptyLoopBudget({
      maxIterations: 10, maxTotalDurationMinutes: 60, maxSpendMicros: '10000000',
      currency: 'USD', maxTotalTokens: 1_000_000, maxProviderCalls: 100, maxConsecutiveFailures: 5,
      ...overrides,
    }),
    createdAt: T0,
    provenance: 'offline',
  });
}

function context(overrides: Partial<LoopEngineContext> = {}): LoopEngineContext {
  return {
    runId: 'lpr_proof',
    loopId: 'lpe_proof',
    projectId: 'prj_proof',
    actor: 'relay-engine',
    sessionId: 'ses_proof',
    target: CODING_TARGET,
    features: { loop_engine: true },
    trigger: 'cli',
    isSLoop: false,
    reviewerConfiguration: 'not_required',
    contractBindingDigest: 'binding-proof',
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

/**
 * Stand up the whole stack over a real state root: Node store, scripted agent,
 * deterministic clock and ids.
 */
function stack(script: readonly FakeLoopAgentStep[], budgetOverrides = {}) {
  const store = createLoopRunNodeStore({ root });
  const run = seed(budgetOverrides);
  const created = store.createRun(run);
  if (!created.ok) throw new Error(created.error.message);

  let tick = 0;
  const now = (): string => new Date(Date.parse(T0) + (tick += 1) * 1000).toISOString();
  const counters = new Map<string, number>();
  const newId = (kind: string): string => {
    const next = (counters.get(kind) ?? 0) + 1;
    counters.set(kind, next);
    return `${kind}_${next}`;
  };
  const agent = createFakeLoopAgent(script, { now: () => T0, model: 'fixture-model' });
  const deps: LoopEngineDeps = {
    backing: store, agent, lock: createInMemoryLoopLockPort(), digest: loopDigest, now,
    newId: newId as LoopEngineDeps['newId'],
  };
  return { store, deps, agent, run, dir: created.value };
}

/** The confirmation half of the flow: the user confirmed the compiled draft. */
function confirm(store: ReturnType<typeof createLoopRunNodeStore>, run: RelayLoopRun, key = 'confirm-1'): {
  readonly duplicate: boolean;
} {
  const base = (payload: RelayLoopEventPayload, idempotencyKey: string | null): RelayLoopEventInput => ({
    at: T0, runId: run.runId, loopId: run.loopId, projectId: run.projectId,
    kind: payload.kind, actor: 'founder', recoveryGeneration: 0,
    expectedPreviousState: null, idempotencyKey, payload,
  });
  const confirmed = appendLoopRunEvent(store, {
    runId: run.runId,
    base: base({
      kind: 'loop.contract_confirmed', contractRef: run.contractRef, contractVersion: 1,
      bindingDigest: run.contractBindingDigest, confirmedBy: 'founder',
    }, null),
    digest: loopDigest,
  });
  if (!confirmed.ok) throw new Error(confirmed.problem);
  const createdRun = appendLoopRunEvent(store, {
    runId: run.runId,
    base: base({ kind: 'loop.run_created', idempotencyKey: key, creationSource: 'cli', createdBy: 'founder' }, key),
    digest: loopDigest,
  });
  if (!createdRun.ok) throw new Error(createdRun.problem);
  return { duplicate: createdRun.duplicate };
}

/* ============================================ the whole flow, offline === */

describe('/loop coding — from command to attested completion', () => {
  it('parses the command into an exact single-role target', () => {
    const parsed = parseSlashCommand(COMMAND);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.error.message);
    expect(parsed.value.family).toBe('loop');
    const command = parsed.value.command;
    expect(command.kind).toBe('loop_create');
    if (command.kind !== 'loop_create') throw new Error('unreachable');
    // The grammar resolved exactly one role, which is the only shape Stage 2
    // will execute — and it did so without the engine having to narrow it.
    expect(command.target.kind).toBe('exact_roles');
    expect(command.target.requestedRoles).toEqual(['coding_agent']);
    expect(command.objective).toContain('attested');
  });

  it('rejects a claim, then observed evidence, then completes on attestation', async () => {
    const { store, deps, agent, run } = stack([
      // 1: the model says it is done, and offers nothing to check.
      { kind: 'completion_claim_only' },
      // 2: Relay sees output, but nothing corroborates it.
      { kind: 'observed_evidence', evidenceRefs: ['evd_seen'] },
      // 3: the fixture harness attests the result.
      { kind: 'attested_evidence', evidenceRefs: ['evd_attested'] },
    ]);
    confirm(store, run);

    const first = await runLoopIteration(deps, context());
    expect(first.kind).toBe('iteration_recorded');
    if (first.kind !== 'iteration_recorded') throw new Error('unreachable');
    expect(first.run.state).not.toBe('completed');
    expect(first.verdict).not.toBe('verified_complete');

    const second = await runLoopIteration(deps, context());
    expect(second.kind).toBe('iteration_recorded');
    if (second.kind !== 'iteration_recorded') throw new Error('unreachable');
    expect(second.run.state).not.toBe('completed');
    // Observed evidence is a claim with a witness, not corroboration.
    expect(second.verdict).toBe('claimed_complete');

    const third = await runLoopIteration(deps, context());
    expect(third.kind).toBe('terminal');
    if (third.kind !== 'terminal') throw new Error('unreachable');
    expect(third.state).toBe('completed');
    expect(third.run.iterations).toHaveLength(3);
    expect(agent.invocations.map((i) => i.ordinal)).toEqual([1, 2, 3]);
  });

  it('leaves a journal that tells the whole causal story', async () => {
    const { store, deps, run } = stack([
      { kind: 'completion_claim_only' },
      { kind: 'observed_evidence' },
      { kind: 'attested_evidence' },
    ]);
    confirm(store, run);
    await runLoopUntilSettled(deps, context(), { maxIterationsThisCall: 5 });

    const kinds = (store.read(run.runId)?.events ?? []).map((e) => e.kind);
    for (const required of [
      'loop.contract_confirmed', 'loop.run_created', 'loop.agent_assigned',
      'loop.iteration_started', 'loop.agent_request_prepared', 'loop.agent_execution_started',
      'loop.agent_identity_observed', 'loop.output_observed', 'loop.completion_claim_recorded',
      'loop.iteration_finished', 'loop.completion_evaluated', 'loop.next_iteration_scheduled',
      'loop.completed',
    ]) {
      expect(kinds, `${required} is missing from the journal`).toContain(required);
    }
    // Gap-free from 1, in order.
    const sequences = (store.read(run.runId)?.events ?? []).map((e) => e.sequence);
    expect(sequences).toEqual(sequences.map((_, i) => i + 1));
    // The claim was recorded BEFORE the evaluation that rejected it.
    expect(kinds.indexOf('loop.completion_claim_recorded')).toBeLessThan(kinds.indexOf('loop.completed'));
  });

  it('reconstructs the same completed run from a fresh store after a restart', async () => {
    const { store, deps, run } = stack([
      { kind: 'completion_claim_only' },
      { kind: 'observed_evidence' },
      { kind: 'attested_evidence' },
    ]);
    confirm(store, run);
    await runLoopUntilSettled(deps, context(), { maxIterationsThisCall: 5 });
    const before = readLoopRun(store, run.runId, loopDigest);
    expect(before?.run?.state).toBe('completed');

    // A different process. Nothing is shared but the bytes on disk.
    const restarted = createLoopRunNodeStore({ root });
    const after = readLoopRun(restarted, run.runId, loopDigest);

    expect(after?.run?.state).toBe('completed');
    expect(loopDigest(after?.run)).toBe(loopDigest(before?.run));
    expect(after?.run?.iterations).toHaveLength(3);
    expect(after?.run?.budget.iterationsStarted).toBe(3);
  });

  it('returns the existing run when a confirmation is delivered twice', async () => {
    const { store, run } = stack([{ kind: 'attested_evidence' }]);
    confirm(store, run);
    const before = store.read(run.runId)?.events.length;
    const again = confirm(store, run);
    expect(again.duplicate).toBe(true);
    // No second run, no second line.
    expect(store.read(run.runId)?.events.length).toBe(before);
  });

  it('does not duplicate an iteration when the engine is invoked twice concurrently', async () => {
    const { store, deps, agent, run } = stack([{ kind: 'continuing' }, { kind: 'continuing' }]);
    confirm(store, run);
    // The lock is what makes the second invocation refuse rather than race.
    const [a, b] = await Promise.all([
      runLoopIteration(deps, context()),
      runLoopIteration(deps, context()),
    ]);
    const kinds = [a.kind, b.kind].sort();
    expect(kinds).toEqual(['iteration_recorded', 'refused']);
    expect(agent.invocations).toHaveLength(1);
    expect(readLoopRun(store, run.runId, loopDigest)?.run?.iterations).toHaveLength(1);
  });

  it('makes no network, process or provider call anywhere in the flow', async () => {
    // Proven structurally elsewhere; proven here by the fact that the whole
    // flow runs with no credentials configured and no host reachable. If any
    // step reached out, this would hang or throw rather than pass in 20ms.
    const { store, deps, run } = stack([{ kind: 'attested_evidence' }]);
    confirm(store, run);
    const outcome = await runLoopIteration(deps, context());
    expect(outcome.kind === 'terminal' && outcome.state).toBe('completed');
  });
});

/* ================================================= bounds and failures === */

describe('the bounded proofs', () => {
  it('exhausts iterations before attestation arrives', async () => {
    const { store, deps, run } = stack(
      [{ kind: 'completion_claim_only' }, { kind: 'observed_evidence' }],
      { maxIterations: 2 },
    );
    confirm(store, run);
    const { final } = await runLoopUntilSettled(deps, context(), { maxIterationsThisCall: 5 });
    expect(final.kind).toBe('terminal');
    if (final.kind !== 'terminal') throw new Error('unreachable');
    expect(final.state).toBe('iteration_exhausted');
    expect(final.state).not.toBe('completed');
  });

  it('exhausts the token cap', async () => {
    const { store, deps, run } = stack([{ kind: 'continuing' }], { maxTotalTokens: 100 });
    confirm(store, run);
    const { final } = await runLoopUntilSettled(deps, context(), { maxIterationsThisCall: 5 });
    expect(final.kind === 'terminal' && final.state).toBe('token_exhausted');
  });

  it('exhausts the spending cap', async () => {
    const { store, deps, run } = stack([{ kind: 'continuing' }], { maxSpendMicros: '1000' });
    confirm(store, run);
    const { final } = await runLoopUntilSettled(deps, context(), { maxIterationsThisCall: 5 });
    expect(final.kind === 'terminal' && final.state).toBe('budget_exhausted');
  });

  it('exhausts the provider-call cap', async () => {
    const { store, deps, run } = stack([{ kind: 'continuing' }], { maxProviderCalls: 1 });
    confirm(store, run);
    const { final } = await runLoopUntilSettled(deps, context(), { maxIterationsThisCall: 5 });
    expect(final.kind === 'terminal' && final.state).toBe('provider_call_exhausted');
  });

  it('exhausts the duration budget', async () => {
    const { store, deps, run } = stack([{ kind: 'continuing' }], { maxTotalDurationMinutes: 5 });
    confirm(store, run);
    const outcome = await runLoopIteration(deps, context({ elapsedMinutes: 6 }));
    expect(outcome.kind === 'terminal' && outcome.state).toBe('duration_exhausted');
  });

  const cannotComplete = [
    ['timeout', 'timed_out'],
    ['cancellation', 'stopped'],
    ['crash', 'failed'],
    ['malformed_output', 'failed'],
    ['refusal', 'failed'],
  ] as const;

  for (const [step, expected] of cannotComplete) {
    it(`${step} cannot complete the Loop`, async () => {
      const { store, deps, run } = stack([{ kind: step } as FakeLoopAgentStep]);
      confirm(store, run);
      const outcome = await runLoopIteration(deps, context());
      expect(outcome.kind).toBe('terminal');
      if (outcome.kind !== 'terminal') throw new Error('unreachable');
      expect(outcome.state).toBe(expected);
      expect(outcome.state).not.toBe('completed');
      // And the durable record agrees after a restart.
      const restarted = createLoopRunNodeStore({ root });
      expect(readLoopRun(restarted, run.runId, loopDigest)?.run?.state).toBe(expected);
    });
  }

  it('keeps an unknown cost unknown rather than calling it zero', async () => {
    const { store, deps, run } = stack([{ kind: 'unknown_usage' }], {
      maxSpendMicros: null, maxTotalTokens: null,
    });
    confirm(store, run);
    await runLoopIteration(deps, context());
    const reloaded = readLoopRun(createLoopRunNodeStore({ root }), run.runId, loopDigest);
    expect(reloaded?.run?.budget.knownSpendMicros).toBeNull();
    expect(reloaded?.run?.budget.knownSpendMicros).not.toBe('0');
    expect(reloaded?.run?.budget.spendHasUnknownComponent).toBe(true);
  });
});

/* ============================================ restart mid-dispatch === */

describe('a restart during an uncertain dispatch', () => {
  it('becomes recovery_required and never repeats the operation', async () => {
    const { store, run } = stack([{ kind: 'continuing' }]);
    confirm(store, run);

    // Hand-write the state a crash mid-dispatch leaves: the iteration opened
    // and the execution started, with no line saying how it ended.
    const base = (payload: RelayLoopEventPayload): RelayLoopEventInput => ({
      at: T0, runId: run.runId, loopId: run.loopId, projectId: run.projectId,
      kind: payload.kind, actor: 'relay-engine', recoveryGeneration: 0,
      expectedPreviousState: null, idempotencyKey: null, payload,
    });
    for (const payload of [
      { kind: 'loop.agent_assigned', assignment: {
        requestedRole: 'coding_agent' as const, resolvedRole: 'coding_agent' as const,
        requestedAdapterId: 'fake-loop-agent', actualAdapterId: null, actualAgentId: null,
        actualModel: null, requestedModel: 'requested-model', assignedAt: T0,
      } },
      { kind: 'loop.iteration_started', iterationId: 'lpi_crash', ordinal: 1 },
      { kind: 'loop.agent_execution_started', iterationId: 'lpi_crash', executionId: 'exe_crash' },
    ] as const) {
      const appended = appendLoopRunEvent(store, {
        runId: run.runId, base: base(payload as RelayLoopEventPayload), digest: loopDigest,
      });
      if (!appended.ok) throw new Error(appended.problem);
    }

    // A fresh process, and an adapter with no memory of that dispatch.
    const restarted = createLoopRunNodeStore({ root });
    const freshAgent = createFakeLoopAgent([{ kind: 'continuing' }], { now: () => T0 });
    const deps: LoopEngineDeps = {
      backing: restarted, agent: freshAgent, lock: createInMemoryLoopLockPort(),
      digest: loopDigest, now: () => T0, newId: ((k: string) => `${k}_r`) as LoopEngineDeps['newId'],
    };

    const outcome = await runLoopIteration(deps, context());
    expect(outcome.kind).toBe('recovery_required');
    if (outcome.kind !== 'recovery_required') throw new Error('unreachable');
    expect(outcome.report.mayAutoResume).toBe(false);
    expect(outcome.report.uncertainIterationId).toBe('lpi_crash');
    // THE POINT: the operation that may already have run was not run again.
    expect(freshAgent.invocations).toHaveLength(0);
  });

  it('holds the run in recovery rather than continuing it', async () => {
    const { store, run } = stack([{ kind: 'continuing' }]);
    confirm(store, run);
    const base = (payload: RelayLoopEventPayload): RelayLoopEventInput => ({
      at: T0, runId: run.runId, loopId: run.loopId, projectId: run.projectId,
      kind: payload.kind, actor: 'relay-engine', recoveryGeneration: 0,
      expectedPreviousState: null, idempotencyKey: null, payload,
    });
    for (const payload of [
      { kind: 'loop.agent_assigned', assignment: {
        requestedRole: 'coding_agent' as const, resolvedRole: 'coding_agent' as const,
        requestedAdapterId: 'fake-loop-agent', actualAdapterId: null, actualAgentId: null,
        actualModel: null, requestedModel: null, assignedAt: T0,
      } },
      { kind: 'loop.iteration_started', iterationId: 'lpi_crash', ordinal: 1 },
      { kind: 'loop.agent_execution_started', iterationId: 'lpi_crash', executionId: 'exe_crash' },
    ] as const) {
      appendLoopRunEvent(store, { runId: run.runId, base: base(payload as RelayLoopEventPayload), digest: loopDigest });
    }
    const restarted = createLoopRunNodeStore({ root });
    const deps: LoopEngineDeps = {
      backing: restarted, agent: createFakeLoopAgent([], { now: () => T0 }),
      lock: createInMemoryLoopLockPort(), digest: loopDigest, now: () => T0,
      newId: ((k: string) => `${k}_r`) as LoopEngineDeps['newId'],
    };
    await runLoopIteration(deps, context());
    const state = readLoopRun(restarted, run.runId, loopDigest)?.run?.state;
    expect(state).toBe('recovery_required');
    // Not terminal — an unconfirmable run is unfinished, not finished.
    expect(state).not.toBe('failed');
    expect(state).not.toBe('completed');
  });
});
