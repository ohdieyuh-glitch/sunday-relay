import { describe, expect, it } from 'vitest';

import {
  emptyOperationalRecord, isIndependentEvaluation,
  type RelayErrorEvent, type RelayEvaluation, type RelayLatencySample,
  type RelayOperationalRecord, type RelayRepairLoop, type RelayWaitInterval,
} from './llmops-contracts';
import {
  HEALTH_STALE_AFTER_MS, MIN_SAMPLES_FOR_TAIL, projectOperations,
} from './llmops-projection';

/**
 * THE OPERATIONS VIEW.
 *
 * What is tested here is not that the arithmetic works. It is the four places
 * an operations dashboard normally starts lying:
 *
 *   - it renders "0" for a thing it never measured;
 *   - it reports a percentage whose denominator it does not know;
 *   - it keeps showing the last good state after the feed went silent;
 *   - it counts a self-assessment as a passing independent review.
 */

const AS_OF = '2026-08-05T12:00:00.000Z';
const RECENT = '2026-08-05T11:59:00.000Z';

const record = (over: Partial<RelayOperationalRecord> = {}): RelayOperationalRecord => ({
  ...emptyOperationalRecord('proj_1'),
  newestSignalAt: RECENT,
  ...over,
});

const sample = (over: Partial<RelayLatencySample> = {}): RelayLatencySample => ({
  phase: 'total', durationMs: 1000, observedAt: RECENT, ...over,
});

/* ------------------------------------------------------------- unknowns */

describe('an unobserved thing is UNKNOWN, and never zero', () => {
  it('a project with no signal at all reports unknown health, not healthy', () => {
    const view = projectOperations(emptyOperationalRecord('proj_1'), AS_OF);
    expect(view.health).toBe('unknown');
    expect(view.healthReason).toContain('No operational signal');
    expect(view.signalAgeMs.known).toBe(false);
  });

  it('names the phases nobody timed instead of showing them as 0ms', () => {
    const view = projectOperations(record({ latency: [sample({ phase: 'queue' })] }), AS_OF);
    expect(view.missingPhases).toContain('generation');
    expect(view.missingPhases).toContain('tool_execution');
    expect(view.missingPhases).not.toContain('queue');
    // The phase that WAS observed is the only one with a figure.
    expect(view.latency.map((l) => l.phase)).toEqual(['queue']);
  });

  it('refuses a tail percentile it does not have the samples for', () => {
    // A p95 from three samples is the maximum of three samples wearing a
    // percentile's name, and it moves 40% when the next one lands.
    const few = projectOperations(record({
      latency: Array.from({ length: 3 }, (_, i) => sample({ durationMs: 100 + i })),
    }), AS_OF);
    expect(few.latency[0].p95Ms.known).toBe(false);
    expect(few.latency[0].p95Ms.known === false && few.latency[0].p95Ms.reason)
      .toBe('insufficient_samples');
    // And reports it once there is a population.
    const many = projectOperations(record({
      latency: Array.from({ length: MIN_SAMPLES_FOR_TAIL }, (_, i) => sample({ durationMs: i })),
    }), AS_OF);
    expect(many.latency[0].p95Ms.known).toBe(true);
  });

  it('a rate whose denominator is unknown is unknown, not 0 and not 1', () => {
    const errors: RelayErrorEvent[] = [
      { kind: 'provider_timeout', at: RECENT, recovered: true, attempt: 1 },
      { kind: 'tool_failure', at: RECENT, recovered: false, attempt: 1 },
    ];
    const view = projectOperations(record({ errors }), AS_OF);
    expect(view.errorCount).toBe(2);
    expect(view.errorRate.known).toBe(false);
    expect(view.errorRate.known === false && view.errorRate.reason).toBe('unknown_denominator');

    // With a counted base it becomes a real rate.
    const counted = projectOperations(
      record({ errors, attempts: { attempts: 10, source: 'counted' } }),
      AS_OF,
    );
    expect(counted.errorRate.known && counted.errorRate.value).toBeCloseTo(0.2, 5);
  });
});

/* ------------------------------------------------------------- staleness */

describe('a silent system is not a healthy one', () => {
  it('goes unknown once the newest signal is older than the horizon', () => {
    const old = new Date(Date.parse(AS_OF) - HEALTH_STALE_AFTER_MS - 60_000).toISOString();
    const view = projectOperations(record({ newestSignalAt: old }), AS_OF);
    expect(view.health).toBe('unknown');
    expect(view.healthReason).toContain('silent system');
  });

  it('is healthy only with a recent signal AND nothing wrong', () => {
    const view = projectOperations(record({
      attempts: { attempts: 5, source: 'counted' },
    }), AS_OF);
    expect(view.health).toBe('healthy');
  });

  it('an unrecovered error is failing, and a recovered one is only degraded', () => {
    const unrecovered = projectOperations(record({
      errors: [{ kind: 'provider_error', at: RECENT, recovered: false, attempt: 1 }],
      attempts: { attempts: 3, source: 'counted' },
    }), AS_OF);
    expect(unrecovered.health).toBe('failing');
    expect(unrecovered.unrecoveredErrorCount).toBe(1);

    const recovered = projectOperations(record({
      errors: [{ kind: 'provider_error', at: RECENT, recovered: true, attempt: 1 }],
      attempts: { attempts: 3, source: 'counted' },
    }), AS_OF);
    expect(recovered.health).toBe('degraded');
    expect(recovered.unrecoveredErrorCount).toBe(0);
  });
});

/* --------------------------------------------------------------- waiting */

describe('waiting on a human is not latency', () => {
  const waits: RelayWaitInterval[] = [
    { reason: 'user_approval', since: '2026-08-05T11:00:00.000Z', until: '2026-08-05T11:30:00.000Z' },
    { reason: 'rate_limit', since: '2026-08-05T11:40:00.000Z', until: '2026-08-05T11:41:00.000Z' },
  ];

  it('separates the wait a person can shorten from every other kind', () => {
    const view = projectOperations(record({ waits }), AS_OF);
    expect(view.waitingOnUserMs).toBe(30 * 60 * 1000);
    // The rate-limit wait is real and counted, and is NOT waiting on the user.
    expect(view.waits.find((w) => w.reason === 'rate_limit')?.totalMs).toBe(60 * 1000);
    expect(view.waitingOnUserOpen).toBe(false);
  });

  it('an OPEN wait is measured to now and reported as still open', () => {
    const view = projectOperations(record({
      waits: [{ reason: 'user_input', since: '2026-08-05T11:00:00.000Z', until: null }],
    }), AS_OF);
    expect(view.waitingOnUserMs).toBe(60 * 60 * 1000);
    expect(view.waitingOnUserOpen).toBe(true);
  });

  it('an unreadable interval still counts as an interval, contributing no time', () => {
    // Dropping it would under-report how often the run blocked — the figure a
    // person uses to decide whether to go and do something else. An interval
    // that happened and could not be measured is not an interval that did not
    // happen, so it is counted with zero milliseconds.
    const badStart = projectOperations(record({
      waits: [{ reason: 'credential', since: 'not-a-date', until: null }],
    }), AS_OF);
    expect(badStart.waits[0].intervals).toBe(1);
    expect(badStart.waits[0].totalMs).toBe(0);
    expect(badStart.waits[0].openIntervals).toBe(1);
    // And it is still a wait ON THE USER, so the flag is honest.
    expect(badStart.waitingOnUserOpen).toBe(true);

    const badEnd = projectOperations(record({
      waits: [{ reason: 'credential', since: RECENT, until: 'not-a-date' }],
    }), AS_OF);
    expect(badEnd.waits[0].intervals).toBe(1);
    expect(badEnd.waits[0].totalMs).toBe(0);
  });

  it('latency figures contain no wait time at all', () => {
    const view = projectOperations(record({
      latency: [sample({ durationMs: 500 })],
      waits: [{ reason: 'user_approval', since: '2026-08-05T10:00:00.000Z', until: RECENT }],
    }), AS_OF);
    // Nearly two hours of waiting, and the total-phase p50 is still 500ms.
    expect(view.latency[0].p50Ms.known && view.latency[0].p50Ms.value).toBe(500);
    expect(view.waitingOnUserMs).toBeGreaterThan(6_000_000);
  });
});

/* ----------------------------------------------------------- evaluations */

describe('a self-evaluation is not an independent one', () => {
  const evaluation = (over: Partial<RelayEvaluation> = {}): RelayEvaluation => ({
    evaluationId: 'ev_1', rubricId: 'correctness', verdict: 'pass',
    judgedBy: 'reviewer-a', authoredBy: 'agent-b', at: RECENT, ...over,
  });

  it('independence is derived from who judged and who authored', () => {
    expect(isIndependentEvaluation(evaluation())).toBe(true);
    expect(isIndependentEvaluation(evaluation({ judgedBy: 'agent-b' }))).toBe(false);
    // Case and padding do not buy independence.
    expect(isIndependentEvaluation(evaluation({ judgedBy: '  AGENT-B ' }))).toBe(false);
    // An unattributed judgement is not independent either.
    expect(isIndependentEvaluation(evaluation({ judgedBy: '' }))).toBe(false);
  });

  it('counts a self-assessed pass separately from an independent one', () => {
    const view = projectOperations(record({
      evaluations: [
        evaluation({ evaluationId: 'ev_1' }),
        evaluation({ evaluationId: 'ev_2', judgedBy: 'agent-b' }),
      ],
      attempts: { attempts: 2, source: 'counted' },
    }), AS_OF);
    expect(view.evaluations.total).toBe(2);
    expect(view.evaluations.independent).toBe(1);
    expect(view.evaluations.selfAssessed).toBe(1);
    expect(view.evaluations.independentCoverage.known
      && view.evaluations.independentCoverage.value).toBeCloseTo(0.5, 5);
  });

  it('no evaluations means unknown coverage, not full coverage', () => {
    const view = projectOperations(record({}), AS_OF);
    expect(view.evaluations.independentCoverage.known).toBe(false);
  });

  it('a failing evaluation degrades health', () => {
    const view = projectOperations(record({
      evaluations: [evaluation({ verdict: 'fail' })],
      attempts: { attempts: 1, source: 'counted' },
    }), AS_OF);
    expect(view.health).toBe('degraded');
    expect(view.evaluations.failed).toBe(1);
  });
});

/* ---------------------------------------------------------- repair loops */

describe('a repair loop that ran out of budget did not succeed', () => {
  const loop = (over: Partial<RelayRepairLoop> = {}): RelayRepairLoop => ({
    loopId: 'lp_1',
    cycles: [{ cycle: 1, findingId: 'f_1', repaired: false, at: RECENT }],
    outcome: 'limit_reached',
    ...over,
  });

  it('counts a limit-reached loop as ended UNFIXED, never as a repair', () => {
    const view = projectOperations(record({
      repairLoops: [loop(), loop({ loopId: 'lp_2', outcome: 'converged' })],
      attempts: { attempts: 2, source: 'counted' },
    }), AS_OF);
    expect(view.repairs.loops).toBe(2);
    expect(view.repairs.converged).toBe(1);
    expect(view.repairs.limitReached).toBe(1);
    expect(view.repairs.endedUnfixed).toBe(1);
    expect(view.health).toBe('degraded');
    expect(view.healthReason).toContain('still open');
  });

  it('an in-progress loop has not ended, so it is not unfixed', () => {
    const view = projectOperations(record({
      repairLoops: [loop({ outcome: 'in_progress' })],
      attempts: { attempts: 1, source: 'counted' },
    }), AS_OF);
    expect(view.repairs.inProgress).toBe(1);
    expect(view.repairs.endedUnfixed).toBe(0);
    expect(view.health).toBe('healthy');
  });
});

/* ------------------------------------------------------------ robustness */

describe('the projection never produces a number it cannot stand behind', () => {
  it('drops a non-finite or negative latency sample rather than averaging it in', () => {
    const view = projectOperations(record({
      latency: [
        sample({ durationMs: Number.NaN }),
        sample({ durationMs: -1 }),
        sample({ durationMs: Number.POSITIVE_INFINITY }),
        sample({ durationMs: 250 }),
      ],
    }), AS_OF);
    expect(view.latency[0].samples).toBe(1);
    expect(view.latency[0].maxMs.known && view.latency[0].maxMs.value).toBe(250);
  });

  it('an unreadable asOf does not produce NaN anywhere', () => {
    const view = projectOperations(record({
      latency: [sample()],
      waits: [{ reason: 'user_input', since: RECENT, until: null }],
    }), 'not-a-date');
    expect(view.health).toBe('unknown');
    expect(Number.isNaN(view.waitingOnUserMs)).toBe(false);
    expect(view.signalAgeMs.known).toBe(false);
  });
});
