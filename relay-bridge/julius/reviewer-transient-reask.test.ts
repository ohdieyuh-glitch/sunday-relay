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
import { JULIUS_CONTEXT_COMPILER_VERSION, type JuliusContextSnapshot } from '../../src/relay/mission/julius';
import { loadHermesConfig, reviewDiagnostics, type HermesConfig, type HermesOutcome, type ReviewPacket } from '../hermes-reviewer';
import {
  REVIEW_TRANSIENT_REASK_BACKOFF_MS,
  REVIEW_TRANSIENT_REASK_LIMIT,
  REVIEW_TRANSIENT_REASK_SHAPES,
  resolveReviewerDeadline,
  reviewerOperativeTimeoutMs,
  reviewerReaskWithinDeadline,
} from '../reviewer-deadline';
import { createInMemoryArtifactExchange, createLiveHermesReviewerAdapter } from './live-workers';

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
    integrityVersion: null, integrityConflicts: null,
    integrityExcludedEntryIds: null, integrityEvictedEntryIds: null,
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
  const artifacts = createInMemoryArtifactExchange();
  artifacts.seed({ kind: 'PLAN', runId: 'run-live', taskId: 'plan-1', leaseGeneration: 1, role: 'PROMPT_ARCHITECT' }, JSON.stringify(VALID_PLAN));
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
      taskId: 'plan-1:review', attempt: { leaseGeneration: 1 }, reads: { subject: { taskId: 'plan-1', leaseGeneration: 1 }, plan: { taskId: 'plan-1', leaseGeneration: 1 } }, contextId: 'ctx-1', taskType: 'review:plan',
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

/** A first ask the ENGINE ended on its own per-request timeout after `elapsedMs`. */
const timedOut = (elapsedMs: number, instants?: { startedAt: string; completedAt: string }): HermesOutcome => ({
  kind: 'review_incomplete',
  safeMessage: 'The Hermes reviewer timed out.',
  shape: 'review_timeout',
  diagnostics: reviewDiagnostics({
    transport: 'local', shape: 'review_timeout', outcome: 'failed', provider: 'xai', requestedModel: 'grok-build-0.1',
    processExitCode: 1, timedOut: true, processStarted: true, exitObserved: true, elapsedMs,
  }),
  startedAt: instants?.startedAt ?? iso(0),
  completedAt: instants?.completedAt ?? iso(elapsedMs),
});

const ENGINE_TIMEOUT_MS = 94_200;

/**
 * #43: THE RE-ASK IS GONE. Neither shape is positive evidence that the provider
 * processed nothing. A `review_timeout` is the engine's request timeout after
 * the request was sent, and `review_service_unavailable` cannot tell the
 * provider's pre-processing 429 from a 503 after send. Re-asking either could
 * buy a second paid review. So each one ends the dispatch after exactly ONE
 * engine call. The coordinator then records it as OUTCOME UNKNOWN; see
 * `julius-handed-outcome-unknown.test.ts` and the live-composition reviewer
 * cases for the `reasonCode` on `task.failed`.
 */
describe('#43 · the live reviewer adapter never re-asks an ambiguous failure', () => {
  it('the re-ask policy names NO shape', () => {
    expect([...REVIEW_TRANSIENT_REASK_SHAPES]).toEqual([]);
  });

  it('an engine timeout raised early, with a whole review still in the window, is NOT re-asked: one engine call, TIMEOUT', async () => {
    const r = rig([timedOut(ENGINE_TIMEOUT_MS), APPROVED]);
    const failure = await failureOf(r.dispatch());
    expect(r.calls, 'exactly one engine call').toHaveLength(1);
    expect(r.sleeps, 'no backoff was waited for a second ask').toEqual([]);
    expect(failure).toMatchObject({ code: 'TIMEOUT', failureClass: 'review_timeout' });
  });

  it('a fast 503 is NOT re-asked either: one engine call, PROVIDER_UNAVAILABLE', async () => {
    const r = rig([transient(25_000), APPROVED]);
    const failure = await failureOf(r.dispatch());
    expect(r.calls).toHaveLength(1);
    expect(r.sleeps).toEqual([]);
    expect(failure).toMatchObject({ code: 'PROVIDER_UNAVAILABLE', failureClass: 'review_service_unavailable' });
  });

  it('even with the limit raised, nothing is re-asked: the shape set decides, and it is empty', async () => {
    const r = rig([timedOut(ENGINE_TIMEOUT_MS), transient(25_000), APPROVED], { transientReaskLimit: 5 });
    await failureOf(r.dispatch());
    expect(r.calls).toHaveLength(1);
  });

  it('a final upstream error (500) is never re-asked', async () => {
    const r = rig([transient(25_000, 'review_provider_http_error'), APPROVED]);
    const failure = await failureOf(r.dispatch());
    expect(r.calls).toHaveLength(1);
    expect(failure.code).toBe('PROVIDER_UNAVAILABLE');
  });

  it('a review that answered first time records no re-ask shape', async () => {
    const r = rig([APPROVED]);
    const result = await r.dispatch() as { diagnostics: Record<string, unknown> };
    expect(result.diagnostics.reviewAttempts).toBe(1);
    expect(result.diagnostics.reviewReaskShape).toBeNull();
  });
});
