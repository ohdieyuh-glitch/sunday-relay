import { describe, expect, it } from 'vitest';

import { observeRun } from './run-observation';
import { emptyOperationalRecord } from './llmops-contracts';
import { ingest } from './operational-intake';
import { projectOperations } from './llmops-projection';

/**
 * THE FIRST REAL PRODUCER.
 *
 * What is tested here is not that the mapping compiles. It is that the
 * connector's own nulls survive the trip: the Claude CLI initialises every
 * usage figure to `null`, and a producer that turned those into zeroes would
 * make a run that reported nothing look instantaneous — undoing every rule the
 * domain enforces, at the one seam where real data enters.
 */

const AT = '2026-08-05T12:00:00.000Z';

describe('a run that reported no duration is not a fast run', () => {
  it('produces no latency sample at all when the provider reported none', () => {
    const observed = observeRun({ termination: 'completed', observedAt: AT });
    expect(observed.latency).toEqual([]);
    // And the view then NAMES the untimed phases rather than drawing zeroes.
    const view = projectOperations(
      ingest(emptyOperationalRecord('p'), observed), AT,
    );
    expect(view.latency).toEqual([]);
    expect(view.missingPhases).toContain('total');
    expect(view.missingPhases).toContain('generation');
  });

  it('prefers the provider’s own duration over the harness wall clock', () => {
    // They measure different things — the harness's includes spawn and
    // teardown — so the provider's figure wins where it exists.
    const observed = observeRun({
      termination: 'completed',
      usage: { durationMs: 1200, apiDurationMs: 900 },
      outcomeDurationMs: 4000,
      observedAt: AT,
    });
    const total = observed.latency.find((s) => s.phase === 'total');
    expect(total?.durationMs).toBe(1200);
    expect(observed.latency.find((s) => s.phase === 'generation')?.durationMs).toBe(900);
  });

  it('falls back to the harness clock only when the provider reported none', () => {
    const observed = observeRun({
      termination: 'timed_out', outcomeDurationMs: 30_000, observedAt: AT,
    });
    expect(observed.latency.find((s) => s.phase === 'total')?.durationMs).toBe(30_000);
  });
});

describe('the three failures stay three failures', () => {
  it('a timeout, a spawn failure and a reported error do not merge', () => {
    const kinds = (['timed_out', 'spawn_failed', 'reported_error'] as const)
      .map((termination) => observeRun({ termination, observedAt: AT }).errors[0]?.kind);
    // A process that never started is the WORKSPACE's failure; calling it a
    // provider error sends someone to read the wrong logs.
    expect(kinds).toEqual(['provider_timeout', 'workspace_failure', 'provider_error']);
  });

  it('a completed run produces no error', () => {
    expect(observeRun({ termination: 'completed', observedAt: AT }).errors).toEqual([]);
  });

  it('carries the connector’s subtype through without interpreting it', () => {
    const observed = observeRun({
      termination: 'reported_error', resultSubtype: 'error_max_turns', observedAt: AT,
    });
    expect(observed.errors[0].detail).toBe('error_max_turns');
  });

  it('absent recovery means NOT KNOWN to have recovered', () => {
    // Unrecovered errors are what make health `failing`, so the default is the
    // one that cannot understate a problem.
    expect(observeRun({ termination: 'timed_out', observedAt: AT }).errors[0].recovered)
      .toBe(false);
    expect(observeRun({ termination: 'timed_out', recovered: true, observedAt: AT })
      .errors[0].recovered).toBe(true);
  });
});

describe('a terminal outcome is one attempt, and that is what makes a rate possible', () => {
  it('every termination counts exactly one attempt', () => {
    for (const termination of ['completed', 'timed_out', 'spawn_failed', 'reported_error'] as const) {
      expect(observeRun({ termination, observedAt: AT }).attemptsObserved, termination).toBe(1);
    }
  });

  it('turns an unknown error rate into a known one', () => {
    // Before a producer existed, EVERY rate in the product was
    // `unknown_denominator` — correct, and useless.
    let record = emptyOperationalRecord('p');
    for (const termination of ['completed', 'completed', 'completed', 'timed_out'] as const) {
      record = ingest(record, observeRun({ termination, observedAt: AT }));
    }
    const view = projectOperations(record, AT);
    expect(view.errorRate.known).toBe(true);
    expect(view.errorRate.known && view.errorRate.value).toBeCloseTo(0.25, 5);
    expect(view.health).toBe('failing');
  });
});

describe('a malformed outcome reduces what is known, never the run', () => {
  it('survives hostile input without throwing', () => {
    for (const observedAt of ['', 'now', '2026-13-45', AT]) {
      expect(() => observeRun({
        termination: 'reported_error',
        usage: { durationMs: Number.NaN, apiDurationMs: -1 },
        observedAt,
      })).not.toThrow();
    }
    // An undated run yields nothing rather than an undated sample.
    const undated = observeRun({ termination: 'timed_out', observedAt: 'now' });
    expect(undated.latency).toEqual([]);
    expect(undated.errors).toEqual([]);
    // The attempt still happened, and is still counted.
    expect(undated.attemptsObserved).toBe(1);
  });
});
