import { describe, expect, it } from 'vitest';

import {
  errorFromFailure, ingest, samplesFromTurn,
} from './operational-intake';
import { emptyOperationalRecord } from './llmops-contracts';
import { projectOperations } from './llmops-projection';

/**
 * INTAKE — the only place a provider's `null` meets a metric.
 *
 * Everything the projection is careful about can be undone here by a single
 * `?? 0`. A dashboard with a gap in it looks broken, and `?? 0` makes the gap
 * go away by asserting the run was instantaneous.
 */

const AT = '2026-08-05T12:00:00.000Z';

describe('a null duration produces NO SAMPLE, not a zero', () => {
  it('drops every unusable duration and keeps the usable ones', () => {
    const samples = samplesFromTurn({
      durationMs: 1200,
      apiDurationMs: null,
      toolDurationMs: Number.NaN,
      queuedMs: -5,
      observedAt: AT,
    });
    expect(samples.map((s) => s.phase)).toEqual(['total']);
    expect(samples[0].durationMs).toBe(1200);
  });

  it('a zero duration IS a real observation and is kept', () => {
    // Zero is only wrong as a stand-in for unknown. An actually-instant phase
    // is a fact, and dropping it would be the mirror of the bug.
    const samples = samplesFromTurn({ queuedMs: 0, observedAt: AT });
    expect(samples.map((s) => s.phase)).toEqual(['queue']);
    expect(samples[0].durationMs).toBe(0);
  });

  it('an adapter that could not observe usage has not observed a fast turn', () => {
    const samples = samplesFromTurn({
      durationMs: 900, apiDurationMs: 500, usageClass: 'unavailable', observedAt: AT,
    });
    expect(samples).toEqual([]);
  });

  it('an unreadable timestamp yields nothing rather than an undated sample', () => {
    expect(samplesFromTurn({ durationMs: 100, observedAt: 'not-a-date' })).toEqual([]);
  });

  it('a turn with nothing observable is an empty array, not a failure', () => {
    expect(samplesFromTurn({ observedAt: AT })).toEqual([]);
  });

  it('the projection then NAMES the missing phases rather than showing zeroes', () => {
    const record = ingest(emptyOperationalRecord('p'), {
      latency: samplesFromTurn({ durationMs: 1200, apiDurationMs: null, observedAt: AT }),
    });
    const view = projectOperations(record, AT);
    expect(view.latency.map((l) => l.phase)).toEqual(['total']);
    expect(view.missingPhases).toContain('generation');
  });
});

describe('an unrecognised failure stays unknown rather than being diagnosed', () => {
  it('maps the labels it knows', () => {
    expect(errorFromFailure({ kind: 'rate_limit', observedAt: AT })?.kind).toBe('rate_limited');
    expect(errorFromFailure({ kind: 'TOOL_ERROR', observedAt: AT })?.kind).toBe('tool_failure');
  });

  it('does not guess at one it does not know', () => {
    // Deciding `connection_reset` is a timeout invents a diagnosis, and the
    // count of `unknown` is itself the signal that a case is missing.
    expect(errorFromFailure({ kind: 'connection_reset', observedAt: AT })?.kind).toBe('unknown');
    expect(errorFromFailure({ kind: null, observedAt: AT })?.kind).toBe('unknown');
  });

  it('absent recovery means NOT KNOWN to have recovered', () => {
    // Defaulting to recovered would quietly downgrade every failure an adapter
    // forgot to annotate, and unrecovered errors are what make health FAILING.
    expect(errorFromFailure({ kind: 'provider_error', observedAt: AT })?.recovered).toBe(false);
    expect(errorFromFailure({ kind: 'provider_error', observedAt: AT, recovered: true })?.recovered)
      .toBe(true);
  });

  it('refuses an undated failure', () => {
    expect(errorFromFailure({ kind: 'provider_error', observedAt: '' })).toBeNull();
  });
});

describe('ingest keeps the record honest about its own age', () => {
  it('newestSignalAt comes from the SIGNALS, not from the ingest time', () => {
    // A record assembled at noon from an hour-old log is an hour old, and
    // staleness drives health.
    const old = '2026-08-05T11:00:00.000Z';
    const record = ingest(emptyOperationalRecord('p'), {
      latency: samplesFromTurn({ durationMs: 10, observedAt: old }),
    });
    expect(record.newestSignalAt).toBe(old);
    const view = projectOperations(record, '2026-08-05T12:00:00.000Z');
    expect(view.health).toBe('unknown');
    expect(view.healthReason).toContain('silent system');
  });

  it('keeps the NEWEST across repeated ingests, in either order', () => {
    let record = emptyOperationalRecord('p');
    record = ingest(record, { latency: samplesFromTurn({ durationMs: 1, observedAt: '2026-08-05T12:00:00.000Z' }) });
    record = ingest(record, { latency: samplesFromTurn({ durationMs: 1, observedAt: '2026-08-05T11:00:00.000Z' }) });
    expect(record.newestSignalAt).toBe('2026-08-05T12:00:00.000Z');
  });

  it('an adapter that cannot count attempts leaves every rate unknown', () => {
    const record = ingest(emptyOperationalRecord('p'), {
      errors: [errorFromFailure({ kind: 'provider_error', observedAt: AT })!],
    });
    expect(record.attempts.source).toBe('unavailable');
    // It does NOT fall back to the number of errors it happens to have seen.
    expect(projectOperations(record, AT).errorRate.known).toBe(false);
  });

  it('counted attempts accumulate across ingests', () => {
    let record = ingest(emptyOperationalRecord('p'), { attemptsObserved: 3 });
    record = ingest(record, { attemptsObserved: 2 });
    expect(record.attempts).toEqual({ attempts: 5, source: 'counted' });
  });

  it('a nonsense attempt count does not corrupt a counted base', () => {
    let record = ingest(emptyOperationalRecord('p'), { attemptsObserved: 4 });
    record = ingest(record, { attemptsObserved: Number.NaN });
    expect(record.attempts).toEqual({ attempts: 4, source: 'counted' });
  });
});
