import { describe, expect, it } from 'vitest';

import { observeRun, type ObservedRun } from './run-observation';
import { emptyOperationalRecord } from './llmops-contracts';
import { ingest } from './operational-intake';
import { projectOperations } from './llmops-projection';
import type { ClaudeRunOutcome } from '../../connectors/claude-code/process-runner';
import type { ParsedStreamState } from '../../connectors/claude-code/stream-parser';

/**
 * DOES THE PRODUCER ACTUALLY FIT THE PRODUCER'S INPUT?
 *
 * `run-observation.test.ts` proves the mapping's rules against inputs of its
 * own devising. That is exactly the test that stays green while the real
 * adapter emits a shape it never sees — the whole point of the structural type
 * is that it does not import the connector, and the cost of that is that
 * nothing checks the two still agree.
 *
 * So this file imports the connector's REAL types, as TYPES ONLY. There is no
 * runtime edge: `mission`/`shared` must not depend on a connector, and a
 * type-only import erases at compile time. What it buys is that `tsc` fails the
 * day `ClaudeRunOutcome` or `ParsedStreamState` stops fitting `ObservedRun` —
 * which is the failure this seam is otherwise blind to.
 *
 * WHAT IS STILL NOT WIRED, stated here because the fixture below could easily
 * be mistaken for integration: nothing calls this on a live run. There is no
 * store accumulating a `RelayOperationalRecord` across runs, so no shipped
 * surface reports a real one. This proves the SHAPES meet; it does not prove
 * anything is measuring.
 */

/** A real completed run, shaped exactly as `process-runner` emits it. */
const completedOutcome: ClaudeRunOutcome = {
  parsed: {
    sessionId: 'sess_1',
    model: 'claude-opus-5',
    initSeen: true,
    isError: false,
    resultSubtype: null,
    toolActivity: [],
    usage: {
      numTurns: 4, durationMs: 12_400, apiDurationMs: 9_100, reportedCostUsd: 0.42,
    },
  } as unknown as ParsedStreamState,
  stderr: '',
  exitCode: 0,
  signal: null,
  startedAt: '2026-08-05T11:59:47.600Z',
  completedAt: '2026-08-05T12:00:00.000Z',
  durationMs: 12_800,
  timedOut: false,
  cancelled: false,
  outputTruncated: false,
  termination: 'not_required',
  redactions: 0,
};

/** The mapping a caller performs. Kept here so `tsc` checks it against reality. */
function fromConnector(outcome: ClaudeRunOutcome, attempt: number): ObservedRun {
  const parsed = outcome.parsed;
  return {
    termination: outcome.timedOut ? 'timed_out'
      : outcome.spawnError ? 'spawn_failed'
        : parsed.isError ? 'reported_error' : 'completed',
    usage: {
      numTurns: parsed.usage.numTurns,
      durationMs: parsed.usage.durationMs,
      apiDurationMs: parsed.usage.apiDurationMs,
      reportedCostUsd: parsed.usage.reportedCostUsd,
    },
    outcomeDurationMs: outcome.durationMs,
    resultSubtype: parsed.resultSubtype,
    attempt,
    observedAt: outcome.completedAt,
  };
}

describe('the producer accepts what the connector actually emits', () => {
  it('reads a completed run into latency, with the provider’s own figures', () => {
    const observed = observeRun(fromConnector(completedOutcome, 1));
    // The provider reported 12400ms; the harness measured 12800ms including
    // spawn and teardown. They are different measurements and the provider's
    // wins where it exists.
    expect(observed.latency.find((s) => s.phase === 'total')?.durationMs).toBe(12_400);
    expect(observed.latency.find((s) => s.phase === 'generation')?.durationMs).toBe(9_100);
    expect(observed.errors).toEqual([]);
    expect(observed.attemptsObserved).toBe(1);
  });

  it('reads a timed-out run as a provider timeout, using the harness clock', () => {
    // A timeout has no provider-reported duration — the CLI never printed a
    // result line — so the harness's wall clock is all there is.
    const timedOut: ClaudeRunOutcome = {
      ...completedOutcome,
      timedOut: true,
      durationMs: 600_000,
      parsed: {
        ...completedOutcome.parsed,
        usage: { numTurns: null, durationMs: null, apiDurationMs: null, reportedCostUsd: null },
      } as unknown as ParsedStreamState,
    };
    const observed = observeRun(fromConnector(timedOut, 2));
    expect(observed.errors[0].kind).toBe('provider_timeout');
    expect(observed.errors[0].attempt).toBe(2);
    expect(observed.latency.find((s) => s.phase === 'total')?.durationMs).toBe(600_000);
    // Nothing invented a generation time the provider never reported.
    expect(observed.latency.find((s) => s.phase === 'generation')).toBeUndefined();
  });

  it('reads a spawn failure as the WORKSPACE’s failure, not the provider’s', () => {
    const spawnFailed: ClaudeRunOutcome = {
      ...completedOutcome, spawnError: 'ENOENT', exitCode: null,
    };
    expect(observeRun(fromConnector(spawnFailed, 1)).errors[0].kind).toBe('workspace_failure');
  });

  it('carries the CLI’s own result subtype through as detail', () => {
    const errored: ClaudeRunOutcome = {
      ...completedOutcome,
      parsed: {
        ...completedOutcome.parsed, isError: true, resultSubtype: 'error_max_turns',
      } as unknown as ParsedStreamState,
    };
    const observed = observeRun(fromConnector(errored, 1));
    expect(observed.errors[0].kind).toBe('provider_error');
    expect(observed.errors[0].detail).toBe('error_max_turns');
  });

  it('four real runs make the error rate KNOWN, which nothing else could', () => {
    // Every rate in the product was `unknown_denominator` before a producer
    // existed — correct, and useless.
    const outcomes: ClaudeRunOutcome[] = [
      completedOutcome,
      completedOutcome,
      completedOutcome,
      { ...completedOutcome, timedOut: true },
    ];
    let record = emptyOperationalRecord('p');
    for (const [index, outcome] of outcomes.entries()) {
      record = ingest(record, observeRun(fromConnector(outcome, index + 1)));
    }
    const view = projectOperations(record, '2026-08-05T12:00:05.000Z');
    expect(view.errorRate.known && view.errorRate.value).toBeCloseTo(0.25, 5);
    expect(view.latency.find((l) => l.phase === 'total')?.samples).toBe(4);
    expect(view.health).toBe('failing');
  });
});
