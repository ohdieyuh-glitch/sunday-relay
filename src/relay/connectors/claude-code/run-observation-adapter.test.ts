import { describe, expect, it } from 'vitest';

import { observeClaudeRun, toObservedRun } from './run-observation-adapter';
import type { ClaudeRunOutcome } from './process-runner';
import type { ParsedStreamState } from './stream-parser';
import { emptyOperationalRecord, ingest, projectOperations } from '../../shared/llmops';

/**
 * THE ADAPTER, AGAINST REAL OUTCOMES.
 *
 * The first version of this test lived in `shared/`, cast its fixture through
 * `as unknown as ParsedStreamState`, and claimed to prove the producer fit real
 * connector output. It proved less than it said: the cast hid SIX missing
 * required fields, so adding a seventh would not have failed `tsc` — and the
 * mapping it validated was defined in the test, where the boundary rules exempt
 * it, so nothing could ship it.
 *
 * This fixture carries every field `ParsedStreamState` requires, with NO cast.
 * That is what makes the claim true rather than merely stated: a new required
 * field breaks this file, which is the entire point of testing against the real
 * type instead of a hand-drawn shape.
 */

const parsed = (over: Partial<ParsedStreamState> = {}): ParsedStreamState => ({
  sessionId: 'sess_1',
  model: 'claude-opus-5',
  cwd: '/workspace',
  initSeen: true,
  isError: false,
  resultSubtype: null,
  finalResult: null,
  toolActivity: [],
  assistantTextChunks: [],
  unknownRecordCount: 0,
  malformedLineCount: 0,
  thinkingBlocksOmitted: 0,
  usage: { numTurns: 4, durationMs: 12_400, apiDurationMs: 9_100, reportedCostUsd: 0.42 },
  ...over,
});

const outcome = (over: Partial<ClaudeRunOutcome> = {}): ClaudeRunOutcome => ({
  parsed: parsed(),
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
  ...over,
});

describe('elapsed time is only a latency when the thing being timed ran', () => {
  it('a completed run uses the provider’s figure over the harness clock', () => {
    // 12400 reported by the CLI; 12800 measured by the harness including spawn
    // and teardown. Different measurements; the provider's is the latency.
    const observed = observeClaudeRun(outcome());
    expect(observed.latency.find((s) => s.phase === 'total')?.durationMs).toBe(12_400);
    expect(observed.latency.find((s) => s.phase === 'generation')?.durationMs).toBe(9_100);
    expect(observed.errors).toEqual([]);
    expect(observed.attemptsObserved).toBe(1);
  });

  it('a SPAWN FAILURE has no latency at all', () => {
    // `ClaudeRunOutcome.durationMs` is not nullable — the harness always
    // measured something — so the first version gave a process that never
    // started a "total latency" of two milliseconds.
    const observed = observeClaudeRun(outcome({
      spawnError: 'ENOENT', exitCode: null, durationMs: 2,
      parsed: parsed({ usage: { numTurns: null, durationMs: null, apiDurationMs: null, reportedCostUsd: null } }),
    }));
    expect(observed.latency).toEqual([]);
    expect(observed.errors[0].kind).toBe('workspace_failure');
    expect(observed.attemptsObserved).toBe(1);
  });

  it('a timed-out run DOES have a latency — it spent that time working', () => {
    const observed = observeClaudeRun(outcome({
      timedOut: true, durationMs: 600_000,
      parsed: parsed({ usage: { numTurns: null, durationMs: null, apiDurationMs: null, reportedCostUsd: null } }),
    }), { attempt: 2 });
    expect(observed.latency.find((s) => s.phase === 'total')?.durationMs).toBe(600_000);
    expect(observed.errors[0].kind).toBe('provider_timeout');
    expect(observed.errors[0].attempt).toBe(2);
    // Nothing invented a generation time the provider never reported.
    expect(observed.latency.find((s) => s.phase === 'generation')).toBeUndefined();
  });

  it('a garbage provider figure does not destroy a usable harness one', () => {
    // `??` does not fall through on NaN, so the first version discarded a
    // perfectly good measurement whenever the provider sent nonsense.
    const observed = observeClaudeRun(outcome({
      parsed: parsed({ usage: { numTurns: 1, durationMs: Number.NaN, apiDurationMs: null, reportedCostUsd: null } }),
      durationMs: 4_000,
    }));
    expect(observed.latency.find((s) => s.phase === 'total')?.durationMs).toBe(4_000);
  });
});

describe('a cancelled run is not a completed one, and not an attempt', () => {
  it('is classified as cancelled rather than silently completing', () => {
    const observed = observeClaudeRun(outcome({
      cancelled: true, durationMs: 3_500,
      parsed: parsed({ usage: { numTurns: null, durationMs: null, apiDurationMs: null, reportedCostUsd: null } }),
    }));
    expect(toObservedRun(outcome({ cancelled: true })).termination).toBe('cancelled');
    // Its truncated duration is not a latency, and it is not a failure.
    expect(observed.latency).toEqual([]);
    expect(observed.errors).toEqual([]);
    // And it is NOT a denominator: counting it would report a system as more
    // reliable the more often someone interrupted it.
    expect(observed.attemptsObserved).toBe(0);
  });

  it('cancelling does not become a provider error even when isError is set', () => {
    const observed = observeClaudeRun(outcome({
      cancelled: true, parsed: parsed({ isError: true, resultSubtype: 'aborted' }),
    }));
    expect(observed.errors).toEqual([]);
  });

  it('interrupted runs do not flatter the error rate', () => {
    let record = emptyOperationalRecord('p');
    for (const o of [outcome(), outcome(), outcome({ timedOut: true })]) {
      record = ingest(record, observeClaudeRun(o, { attempt: 1 }));
    }
    const before = projectOperations(record, '2026-08-05T12:00:05.000Z');
    expect(before.errorRate.known && before.errorRate.value).toBeCloseTo(1 / 3, 5);

    for (let i = 0; i < 10; i += 1) {
      record = ingest(record, observeClaudeRun(outcome({ cancelled: true }), { attempt: 1 }));
    }
    const after = projectOperations(record, '2026-08-05T12:00:05.000Z');
    // Ten cancellations must not turn a 33% error rate into 8%.
    expect(after.errorRate.known && after.errorRate.value).toBeCloseTo(1 / 3, 5);
  });
});

describe('the classification carries the connector’s own facts', () => {
  it('reads a reported error and its subtype', () => {
    const observed = observeClaudeRun(outcome({
      parsed: parsed({ isError: true, resultSubtype: 'error_max_turns' }),
    }));
    expect(observed.errors[0].kind).toBe('provider_error');
    expect(observed.errors[0].detail).toBe('error_max_turns');
  });

  it('follows the shipping normalizer: cancelled, then timeout, then spawn, then error', () => {
    // This assertion used to say a spawn failure outranked a timeout, which was
    // my reasoning rather than the product's. `event-normalizer.ts` ships the
    // opposite order, and a second producer that disagrees about what one run
    // was is the defect this adapter exists to avoid.
    expect(toObservedRun(outcome({ timedOut: true, parsed: parsed({ isError: true }) })).termination)
      .toBe('timed_out');
    expect(toObservedRun(outcome({ spawnError: 'ENOENT', timedOut: true })).termination)
      .toBe('timed_out');
    expect(toObservedRun(outcome({ cancelled: true, spawnError: 'ENOENT' })).termination)
      .toBe('cancelled');
    expect(toObservedRun(outcome({ spawnError: 'ENOENT' })).termination).toBe('spawn_failed');
  });

  it('does not decide whether the run recovered — the caller knows, this does not', () => {
    expect(observeClaudeRun(outcome({ timedOut: true })).errors[0].recovered).toBe(false);
    expect(observeClaudeRun(outcome({ timedOut: true }), { recovered: true }).errors[0].recovered)
      .toBe(true);
  });
});

describe('the classification agrees with the classifier that ships', () => {
  it('a cancelled run that also timed out is a CANCELLATION', () => {
    // Both flags are reachable: the watchdog sets `timedOut`, then the kill
    // grace window leaves the run cancellable for several seconds. The shipping
    // `event-normalizer.ts` calls this `agent.process_cancelled`, and two
    // producers that disagree about what one run was put two vocabularies into
    // one record.
    const observed = observeClaudeRun(outcome({ cancelled: true, timedOut: true, durationMs: 600_000 }));
    expect(toObservedRun(outcome({ cancelled: true, timedOut: true })).termination).toBe('cancelled');
    // An operator who cancels a hung run has not run a failed provider attempt.
    expect(observed.errors).toEqual([]);
    expect(observed.attemptsObserved).toBe(0);
    expect(observed.latency).toEqual([]);
  });

  it('a timeout whose kill failed stays a TIMEOUT, not a workspace failure', () => {
    // `spawnError` is set from `child.on('error')`, which Node also emits when
    // a process cannot be KILLED — the connector's own event says "failed to
    // start OR RUN". Ranking it above `timedOut` reclassified a real timeout
    // and threw away its latency.
    const observed = observeClaudeRun(outcome({
      timedOut: true, spawnError: 'kill EPERM', durationMs: 600_000,
      parsed: parsed({ usage: { numTurns: null, durationMs: null, apiDurationMs: null, reportedCostUsd: null } }),
    }));
    expect(observed.errors[0].kind).toBe('provider_timeout');
    expect(observed.latency.find((s) => s.phase === 'total')?.durationMs).toBe(600_000);
  });

  it('a spawn failure with no other flag is still the workspace’s', () => {
    expect(observeClaudeRun(outcome({ spawnError: 'ENOENT' })).errors[0].kind)
      .toBe('workspace_failure');
  });

  it('a cancelled run still tells the record that something happened', () => {
    // Otherwise a project somebody is interrupting all day is byte-identical to
    // one nobody is using, and health reports "nothing has been observed".
    const record = ingest(emptyOperationalRecord('p'),
      observeClaudeRun(outcome({ cancelled: true })));
    expect(record.newestSignalAt).toBe('2026-08-05T12:00:00.000Z');
    const view = projectOperations(record, '2026-08-05T12:00:05.000Z');
    expect(view.health).not.toBe('unknown');
    expect(view.newestSignalAt).not.toBeNull();
  });
});
