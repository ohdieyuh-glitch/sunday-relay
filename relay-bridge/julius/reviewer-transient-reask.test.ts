/**
 * ONE TRANSIENT RE-ASK, INSIDE THE SAME DEADLINE — AND NOTHING WIDER.
 *
 * A review stage gets exactly one pipeline attempt, and `review_service_unavailable`
 * is `retryable: true`. On the live path those two met and a single 429 or 503
 * on any of a mission's five review dispatches was FINAL: the retryable shape
 * reached a pipeline with no attempt left to spend on it. The pipeline's rule is
 * right — a second task attempt re-asks the same packet against the same wall —
 * and the adapter's answer is not that: an answer that never arrived is asked
 * for ONCE more, after a short backoff, only when the declared deadline still
 * holds a whole review, and the second engine run is handed the REMAINING
 * window so the adapter still stops before Julius does.
 *
 * Every case drives the REAL reviewer adapter with the runner injected. No
 * process, no network, no clock waited out.
 */

import { describe, expect, it } from 'vitest';
import { JULIUS_CONTEXT_COMPILER_VERSION, safeReviewDiagnostics, type JuliusContextSnapshot } from '../../src/relay/mission/julius';
import { loadHermesConfig, reviewDiagnostics, type HermesConfig, type HermesOutcome, type ReviewPacket } from '../hermes-reviewer';
import {
  REVIEW_TRANSIENT_REASK_BACKOFF_MS,
  REVIEW_TRANSIENT_REASK_LIMIT,
  resolveReviewerDeadline,
  reviewerOperativeTimeoutMs,
  reviewerReaskWithinDeadline,
} from '../reviewer-deadline';
import { createLiveArtifactExchange, createLiveHermesReviewerAdapter, planRef } from './live-workers';

const LIVE_ENV: Record<string, string> = {
  RELAY_HERMES_PROVIDER: 'xai',
  RELAY_HERMES_MODEL: 'grok-build-0.1',
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

const worker = {
  workerId: 'independent-reviewer-hermes', role: 'INDEPENDENT_REVIEWER' as const,
  adapterId: 'hermes-local-live', providerId: 'xai', capabilities: ['review'],
  taskTypes: ['review:plan'], concurrencyLimit: 1, timeoutMs: reviewerOperativeTimeoutMs(), maxRetries: 1,
  status: 'AVAILABLE' as const,
};

function snapshot(taskId: string): JuliusContextSnapshot {
  const workerId = worker.workerId;
  return {
    contextId: 'ctx-1', runId: 'run-live', taskId, workerId,
    workerRole: 'INDEPENDENT_REVIEWER', compilerVersion: JULIUS_CONTEXT_COMPILER_VERSION,
    missionContractRevision: 1, cardRevision: 'card-test-1', projectBrainRevision: 0,
    taskContractRevision: 1, taskContractDigest: 'sha256:contract',
    sourceEntryIds: [], dependencyTaskIds: [], evidenceIds: [], findingIds: [],
    acceptanceCriterionIds: ['AC-1'], contentHash: 'sha256:content',
    characterCount: 24, redactionCount: 0, truncated: false,
    packet: {
      missionId: 'mission-live-1', taskId, workerId, sourceEntryIds: [],
      blocks: [{ kind: 'CONSTRAINT', text: 'OBJECTIVE: reask test' }], truncated: false,
    },
  };
}

const T0 = Date.parse('2026-09-12T12:00:00.000Z');
const iso = (offsetMs: number): string => new Date(T0 + offsetMs).toISOString();

/** A first ask that came back with a transient status after `elapsedMs`. */
const transient = (elapsedMs: number, shape: 'review_service_unavailable' | 'review_provider_http_error' = 'review_service_unavailable', instants?: { startedAt: string; completedAt: string }): HermesOutcome => ({
  kind: 'review_incomplete',
  safeMessage: 'The Hermes reviewer reported an upstream provider error.',
  shape,
  diagnostics: reviewDiagnostics({
    transport: 'local', shape, outcome: 'failed', provider: 'xai', requestedModel: 'grok-build-0.1',
    processExitCode: 1, timedOut: false, providerHttpStatus: shape === 'review_service_unavailable' ? 503 : 500,
    processStarted: true, exitObserved: true, elapsedMs,
  }),
  startedAt: instants?.startedAt ?? iso(0),
  completedAt: instants?.completedAt ?? iso(elapsedMs),
});

const APPROVED: HermesOutcome = {
  kind: 'reviewed',
  result: { verdict: 'approved', summary: 'The plan satisfies every acceptance criterion.', findings: [], requirementsChecked: [], parseRepaired: false },
  startedAt: iso(0), completedAt: iso(1_000), requestedModel: 'grok-build-0.1', servedModel: 'grok-build-0.1', provider: 'xai',
} as never;

interface Rig {
  readonly calls: { readonly config: HermesConfig; readonly packet: ReviewPacket }[];
  readonly sleeps: number[];
  readonly dispatch: (signal?: AbortSignal) => Promise<unknown>;
}

function rig(outcomes: readonly HermesOutcome[], options: { readonly onSleep?: () => void; readonly transientReaskLimit?: number } = {}): Rig {
  const artifacts = createLiveArtifactExchange();
  artifacts.put(planRef('run-live'), JSON.stringify(VALID_PLAN));
  const calls: Rig['calls'] = [];
  const sleeps: number[] = [];
  let call = 0;
  const adapter = createLiveHermesReviewerAdapter({
    worker,
    contexts: { snapshotFor: () => snapshot('plan-1:review') },
    artifacts,
    config: loadHermesConfig(LIVE_ENV as never),
    testCommand: 'npm run mission-test',
    run: (async (input: { packet: ReviewPacket; config: HermesConfig }) => {
      calls.push({ config: input.config, packet: input.packet });
      const next = outcomes[Math.min(call, outcomes.length - 1)]!;
      call += 1;
      return next;
    }) as never,
    sleep: async (ms) => { sleeps.push(ms); options.onSleep?.(); },
    ...(options.transientReaskLimit === undefined ? {} : { transientReaskLimit: options.transientReaskLimit }),
  });
  return {
    calls, sleeps,
    dispatch: (signal) => adapter.dispatch({
      taskId: 'plan-1:review', contextId: 'ctx-1', taskType: 'review:plan',
      allocation: { usdMicros: 300_000, basis: 'ESTIMATE', policyVersion: 'julius-allocation.v1' },
      ...(signal === undefined ? {} : { signal }),
    }),
  };
}

const failureOf = (promise: Promise<unknown>) => promise
  .then(() => { throw new Error('the dispatch was expected to fail'); })
  .catch((error: unknown) => error as { code: string; retryable: boolean; failureClass: string | null; diagnostics?: Record<string, unknown> });

const DEADLINE = reviewerOperativeTimeoutMs();
const FLOOR = resolveReviewerDeadline().floorMs;

describe('the decision, as arithmetic', () => {
  it('allows a re-ask only when the remaining window still holds a whole review', () => {
    const fast = reviewerReaskWithinDeadline({ deadlineMs: DEADLINE, consumedMs: 30_000 });
    expect(fast.allowed).toBe(true);
    if (fast.allowed) expect(fast.remainingMs).toBe(DEADLINE - 30_000 - REVIEW_TRANSIENT_REASK_BACKOFF_MS);
    // Exactly at the boundary is allowed; one millisecond past it is not.
    const edge = DEADLINE - REVIEW_TRANSIENT_REASK_BACKOFF_MS - FLOOR;
    expect(reviewerReaskWithinDeadline({ deadlineMs: DEADLINE, consumedMs: edge }).allowed).toBe(true);
    const over = reviewerReaskWithinDeadline({ deadlineMs: DEADLINE, consumedMs: edge + 1 });
    expect(over.allowed).toBe(false);
    if (!over.allowed) expect(over.reason).toBe('INSUFFICIENT_REMAINING');
  });

  it('a consumed time that cannot be established is refused, never read as zero', () => {
    for (const consumedMs of [null, Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      const decision = reviewerReaskWithinDeadline({ deadlineMs: DEADLINE, consumedMs });
      expect(decision.allowed, String(consumedMs)).toBe(false);
      if (!decision.allowed) expect(decision.reason).toBe('CONSUMED_UNKNOWN');
    }
  });

  it('the bounds are the ones the policy states, and the limit is one', () => {
    expect(REVIEW_TRANSIENT_REASK_LIMIT).toBe(1);
    expect(REVIEW_TRANSIENT_REASK_BACKOFF_MS).toBeGreaterThan(0);
    expect(REVIEW_TRANSIENT_REASK_BACKOFF_MS).toBeLessThan(FLOOR);
    expect(() => reviewerReaskWithinDeadline({ deadlineMs: 0, consumedMs: 0 })).toThrow('invalid_reask_deadline');
    expect(() => reviewerReaskWithinDeadline({ deadlineMs: DEADLINE, consumedMs: 0, floorMs: 0 })).toThrow('invalid_reask_floor');
  });
});

describe('the live reviewer adapter re-asks a transient status once, inside the deadline', () => {
  it('a fast 503 followed by a real verdict is a SUCCEEDED review that bought two calls', async () => {
    const r = rig([transient(25_000), APPROVED]);
    const result = await r.dispatch() as { status: string; diagnostics: Record<string, unknown> };
    expect(result.status).toBe('SUCCEEDED');
    expect(r.calls, 'asked twice, not three times').toHaveLength(2);
    expect(r.sleeps, 'one backoff, the policy length').toEqual([REVIEW_TRANSIENT_REASK_BACKOFF_MS]);
    // THE RECORD SAYS BOTH: how many calls, and why the second was bought.
    expect(result.diagnostics.reviewAttempts).toBe(2);
    expect(result.diagnostics.reviewReaskShape).toBe('review_service_unavailable');
    // And the durable allowlist carries it through.
    expect(safeReviewDiagnostics(result.diagnostics)?.reviewReaskShape).toBe('review_service_unavailable');
  });

  it('the second run is given the REMAINING window, so the two asks and the backoff never exceed the declared deadline', async () => {
    const r = rig([transient(25_000), APPROVED]);
    await r.dispatch();
    const [first, second] = r.calls;
    expect(first!.config.timeoutMs, 'the first ask had the whole deadline').toBe(DEADLINE);
    expect(second!.config.timeoutMs).toBe(DEADLINE - 25_000 - REVIEW_TRANSIENT_REASK_BACKOFF_MS);
    expect(25_000 + REVIEW_TRANSIENT_REASK_BACKOFF_MS + second!.config.timeoutMs, 'the whole dispatch fits the deadline exactly').toBe(DEADLINE);
    expect(second!.config.timeoutMs, 'and the window it got still holds a whole review').toBeGreaterThanOrEqual(FLOOR);
    // Everything else about the configuration is unchanged.
    expect({ ...second!.config, timeoutMs: DEADLINE }).toEqual(first!.config);
  });

  it('a 503 that arrived too late in the window is NOT re-asked, and fails exactly as it did before', async () => {
    const tooLate = DEADLINE - REVIEW_TRANSIENT_REASK_BACKOFF_MS - FLOOR + 1;
    const r = rig([transient(tooLate), APPROVED]);
    const failure = await failureOf(r.dispatch());
    expect(r.calls, 'asked once').toHaveLength(1);
    expect(r.sleeps).toEqual([]);
    expect(failure.code).toBe('PROVIDER_UNAVAILABLE');
    expect(failure.retryable, 'the shape keeps its classification; the pipeline decides what to do with it').toBe(true);
    expect(failure.failureClass).toBe('review_service_unavailable');
    expect(failure.diagnostics?.reviewAttempts).toBe(1);
    expect(failure.diagnostics?.reviewReaskShape).toBeNull();
  });

  it('a second transient answer is final: the limit is one, never a loop', async () => {
    const r = rig([transient(20_000), transient(20_000), APPROVED]);
    const failure = await failureOf(r.dispatch());
    expect(r.calls, 'exactly two calls were bought').toHaveLength(2);
    expect(failure.failureClass).toBe('review_service_unavailable');
    expect(failure.diagnostics?.reviewAttempts).toBe(2);
    expect(failure.diagnostics?.reviewReaskShape).toBe('review_service_unavailable');
  });

  it('the consumed time charges every ask AND every backoff, observed by letting a proof buy two re-asks', async () => {
    // Production never raises the limit. The point is the arithmetic: under a
    // limit of one nothing reads the consumed time after the backoff, so an
    // accounting error there would be invisible until the day the limit
    // changed. Two re-asks make the third window observable.
    const r = rig([transient(20_000), transient(30_000), APPROVED], { transientReaskLimit: 2 });
    const result = await r.dispatch() as { status: string; diagnostics: Record<string, unknown> };
    expect(result.status).toBe('SUCCEEDED');
    expect(r.calls).toHaveLength(3);
    expect(r.sleeps).toEqual([REVIEW_TRANSIENT_REASK_BACKOFF_MS, REVIEW_TRANSIENT_REASK_BACKOFF_MS]);
    const consumedBeforeThird = 20_000 + REVIEW_TRANSIENT_REASK_BACKOFF_MS + 30_000 + REVIEW_TRANSIENT_REASK_BACKOFF_MS;
    expect(r.calls[2]!.config.timeoutMs).toBe(DEADLINE - consumedBeforeThird);
    expect(result.diagnostics.reviewAttempts).toBe(3);
    expect(() => rig([APPROVED], { transientReaskLimit: -1 })).toThrow('hermes_reviewer_adapter_reask_limit_invalid');
  });

  it('a final upstream error (500) is never re-asked', async () => {
    const r = rig([transient(5_000, 'review_provider_http_error'), APPROVED]);
    const failure = await failureOf(r.dispatch());
    expect(r.calls).toHaveLength(1);
    expect(failure.failureClass).toBe('review_provider_http_error');
    expect(failure.retryable).toBe(false);
  });

  it('a first ask whose duration cannot be established is not re-asked — unknown is not zero', async () => {
    const r = rig([transient(5_000, 'review_service_unavailable', { startedAt: 'not-a-time', completedAt: iso(5_000) }), APPROVED]);
    const failure = await failureOf(r.dispatch());
    expect(r.calls).toHaveLength(1);
    expect(failure.failureClass).toBe('review_service_unavailable');
  });

  it('a dispatch already cancelled is not re-asked, and one cancelled during the backoff buys nothing more', async () => {
    const cancelledBefore = new AbortController();
    cancelledBefore.abort();
    const before = rig([transient(5_000), APPROVED]);
    const refused = await failureOf(before.dispatch(cancelledBefore.signal));
    expect(before.calls).toHaveLength(1);
    expect(refused.failureClass).toBe('review_service_unavailable');

    const cancelledDuring = new AbortController();
    const during = rig([transient(5_000), APPROVED], { onSleep: () => cancelledDuring.abort() });
    const cut = await failureOf(during.dispatch(cancelledDuring.signal));
    expect(during.sleeps, 'the backoff began').toHaveLength(1);
    expect(during.calls, 'and no second call followed it').toHaveLength(1);
    expect(cut.failureClass).toBe('review_service_unavailable');
  });

  it('an exhausted mission buys no re-ask, the same way it buys no correction', async () => {
    const artifacts = createLiveArtifactExchange();
    artifacts.put(planRef('run-live'), JSON.stringify(VALID_PLAN));
    let calls = 0;
    const adapter = createLiveHermesReviewerAdapter({
      worker, contexts: { snapshotFor: () => snapshot('plan-1:review') }, artifacts,
      config: loadHermesConfig(LIVE_ENV as never), testCommand: 'npm run mission-test',
      run: (async () => { calls += 1; return calls === 1 ? transient(5_000) : APPROVED; }) as never,
      sleep: async () => {},
    });
    const failure = await failureOf(adapter.dispatch({
      taskId: 'plan-1:review', contextId: 'ctx-1', taskType: 'review:plan',
      allocation: { usdMicros: 0, basis: 'EXHAUSTED', policyVersion: 'julius-allocation.v1' },
    }));
    expect(calls).toBe(1);
    expect(failure.failureClass).toBe('review_service_unavailable');
  });

  it('a review that answered first time records no re-ask shape', async () => {
    const r = rig([APPROVED]);
    const result = await r.dispatch() as { diagnostics: Record<string, unknown> };
    expect(result.diagnostics.reviewAttempts).toBe(1);
    expect(result.diagnostics.reviewReaskShape).toBeNull();
  });
});
