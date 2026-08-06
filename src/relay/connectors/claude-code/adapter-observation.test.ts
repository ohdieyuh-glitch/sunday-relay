import { describe, expect, it, vi } from 'vitest';

import { recordClaudeObservation } from './run-observation-adapter';
import type { ClaudeRunOutcome } from './process-runner';
import type { ParsedStreamState } from './stream-parser';
import {
  createOperationalStore, emptyOperationalRecord, projectOperations,
  type OperationalBacking, type RunObservation,
} from '../../shared/llmops';

/**
 * THE CALL — an adapter observing its own run.
 *
 * What matters here is not that a number reaches a store. It is the three ways
 * an instrument ruins the thing it measures: by failing the run when the store
 * fails, by losing the write when the process exits, and by reporting a failure
 * nowhere.
 *
 * The adapter itself spawns a real process, so these exercise the seam it uses
 * — `observeClaudeRun` into a store — with the same failure modes the adapter's
 * try/catch is written against.
 */

const parsed = (over: Partial<ParsedStreamState> = {}): ParsedStreamState => ({
  sessionId: 's', model: 'm', cwd: '/w', initSeen: true, isError: false,
  resultSubtype: null, finalResult: null, toolActivity: [], assistantTextChunks: [],
  unknownRecordCount: 0, malformedLineCount: 0, thinkingBlocksOmitted: 0,
  usage: { numTurns: 1, durationMs: 1200, apiDurationMs: 900, reportedCostUsd: 0.01 },
  ...over,
});

const outcome = (over: Partial<ClaudeRunOutcome> = {}): ClaudeRunOutcome => ({
  parsed: parsed(), stderr: '', exitCode: 0, signal: null,
  startedAt: '2026-08-05T11:59:47.600Z', completedAt: '2026-08-05T12:00:00.000Z',
  durationMs: 1400, timedOut: false, cancelled: false, outputTruncated: false,
  termination: 'not_required', redactions: 0, ...over,
});

const backing = (over: Partial<OperationalBacking> = {}): OperationalBacking => {
  const map = new Map<string, string>();
  return {
    durability: 'volatile-test-only',
    locationLabel: 'in-memory (test)',
    async getText(key) { return map.get(key) ?? null; },
    async putText(key, value) { map.set(key, value); },
    ...over,
  };
};

/**
 * Calls the SHIPPING guard, not a copy of it.
 *
 * The first draft of this file reimplemented the adapter's try/catch here —
 * which is the same mistake as defining a connector mapping inside the test
 * that proves the mapping: it would stay green while the adapter's real guard
 * changed underneath it.
 */
async function observeInto(
  operations: { record(p: string, o: RunObservation): Promise<{ ok: boolean }> } | undefined,
  run: ClaudeRunOutcome,
  onObservationFailed?: (reason: string) => void,
): Promise<'run-completed'> {
  await recordClaudeObservation(
    { ...(operations === undefined ? {} : { operations }),
      ...(onObservationFailed === undefined ? {} : { onObservationFailed }) },
    'proj', run, { attempt: 1 },
  );
  // The run's result is produced regardless — this is the whole point.
  return 'run-completed';
}

describe('an instrument must not break the thing it measures', () => {
  it('a store that THROWS does not fail the run', async () => {
    const onObservationFailed = vi.fn();
    const result = await observeInto(
      { async record() { throw new Error('disk on fire'); } },
      outcome(), onObservationFailed,
    );
    expect(result).toBe('run-completed');
    // And the failure is not swallowed.
    expect(onObservationFailed).toHaveBeenCalledWith('disk on fire');
  });

  it('a store that DECLINES the write does not fail the run, and says so', async () => {
    const onObservationFailed = vi.fn();
    const result = await observeInto(
      { async record() { return { ok: false }; } }, outcome(), onObservationFailed,
    );
    expect(result).toBe('run-completed');
    expect(onObservationFailed).toHaveBeenCalledWith('the operations store declined the write');
  });

  it('no sink at all is the current state of every host, and is not an error', async () => {
    const onObservationFailed = vi.fn();
    expect(await observeInto(undefined, outcome(), onObservationFailed)).toBe('run-completed');
    expect(onObservationFailed).not.toHaveBeenCalled();
  });

  it('a failure with no callback is genuinely unobserved — nothing throws', async () => {
    // Stated because it is a real cost of not passing one, not a detail.
    await expect(observeInto(
      { async record() { throw new Error('gone'); } }, outcome(),
    )).resolves.toBe('run-completed');
  });
});

describe('what reaches the store is what the run actually was', () => {
  it('a completed run lands as latency with no error', async () => {
    const store = createOperationalStore(backing());
    await observeInto(store, outcome());
    const read = await store.read('proj');
    const view = projectOperations(
      read.ok && read.record ? read.record : emptyOperationalRecord('proj'),
      '2026-08-05T12:00:05.000Z',
    );
    expect(view.latency.find((l) => l.phase === 'total')?.samples).toBe(1);
    expect(view.errorCount).toBe(0);
    expect(view.errorRate.known && view.errorRate.value).toBe(0);
    expect(view.health).toBe('healthy');
  });

  it('a cancelled run does not become an attempt, so it cannot flatter the rate', async () => {
    const store = createOperationalStore(backing());
    await observeInto(store, outcome());
    await observeInto(store, outcome({ timedOut: true }));
    for (let i = 0; i < 8; i += 1) await observeInto(store, outcome({ cancelled: true }));

    const read = await store.read('proj');
    const view = projectOperations(read.ok && read.record ? read.record : null!, '2026-08-05T12:00:05.000Z');
    // Two real attempts, one of which failed. Eight cancellations change nothing.
    expect(view.errorRate.known && view.errorRate.value).toBeCloseTo(0.5, 5);
    expect(view.health).toBe('failing');
  });

  it('a spawn failure records the failure and no latency', async () => {
    const store = createOperationalStore(backing());
    await observeInto(store, outcome({
      spawnError: 'ENOENT', durationMs: 2,
      parsed: parsed({ usage: { numTurns: null, durationMs: null, apiDurationMs: null, reportedCostUsd: null } }),
    }));
    const read = await store.read('proj');
    const record = read.ok && read.record ? read.record : null;
    expect(record?.errors[0].kind).toBe('workspace_failure');
    // A process that never ran has no latency — not a 2ms one.
    expect(record?.latency).toEqual([]);
  });

  it('many runs accumulate into one record the surfaces can read', async () => {
    const store = createOperationalStore(backing());
    for (let i = 0; i < 5; i += 1) await observeInto(store, outcome());
    const read = await store.read('proj');
    const view = projectOperations(read.ok && read.record ? read.record : null!, '2026-08-05T12:00:05.000Z');
    expect(view.latency.find((l) => l.phase === 'total')?.samples).toBe(5);
    expect(view.newestSignalAt).not.toBeNull();
  });
});
