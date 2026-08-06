import { describe, expect, it } from 'vitest';

import { decideOverlap } from './cron-overlap';

/**
 * OVERLAP DECISIONS. The doctrine under test: an unknown policy fails
 * CLOSED, a bound-carrying policy without its bound is refused, and every
 * branch names itself.
 */

describe('an idle schedule dispatches under every known policy', () => {
  it.each(['skip', 'queue_one', 'replace'])('%s', (policy) => {
    expect(decideOverlap(policy, { activeRuns: 0, queuedRuns: 0 }))
      .toEqual({ action: 'dispatch' });
  });
  it('queue_all and parallel_with_limit, with their bounds', () => {
    expect(decideOverlap('queue_all', { activeRuns: 0, queuedRuns: 0, queueLimit: 3 }))
      .toEqual({ action: 'dispatch' });
    expect(decideOverlap('parallel_with_limit', { activeRuns: 0, queuedRuns: 0, parallelLimit: 2 }))
      .toEqual({ action: 'dispatch' });
  });
});

describe('a live run changes the answer, per policy', () => {
  it('skip skips', () => {
    expect(decideOverlap('skip', { activeRuns: 1, queuedRuns: 0 }).action).toBe('skip');
  });

  it('queue_one queues exactly one and then skips', () => {
    expect(decideOverlap('queue_one', { activeRuns: 1, queuedRuns: 0 }).action).toBe('queue');
    const full = decideOverlap('queue_one', { activeRuns: 1, queuedRuns: 1 });
    expect(full.action).toBe('skip');
    if (full.action === 'skip') expect(full.reason).toContain('queue of one');
  });

  it('queue_all queues to its limit and then skips by name', () => {
    expect(decideOverlap('queue_all', { activeRuns: 1, queuedRuns: 2, queueLimit: 3 }).action)
      .toBe('queue');
    const full = decideOverlap('queue_all', { activeRuns: 1, queuedRuns: 3, queueLimit: 3 });
    expect(full.action).toBe('skip');
    if (full.action === 'skip') expect(full.reason).toContain('limit of 3');
  });

  it('replace NEVER claims the stop happened — the caller owns it', () => {
    const decision = decideOverlap('replace', { activeRuns: 1, queuedRuns: 0 });
    expect(decision.action).toBe('replace_after_safe_stop');
    if (decision.action === 'replace_after_safe_stop') {
      expect(decision.reason).toContain('nothing here stopped it');
    }
  });

  it('parallel_with_limit dispatches under the limit and skips at it', () => {
    expect(decideOverlap('parallel_with_limit', { activeRuns: 1, queuedRuns: 0, parallelLimit: 2 }).action)
      .toBe('dispatch');
    expect(decideOverlap('parallel_with_limit', { activeRuns: 2, queuedRuns: 0, parallelLimit: 2 }).action)
      .toBe('skip');
  });
});

describe('what is refused, fail-closed', () => {
  it('an UNKNOWN policy never dispatches — silently dispatching is how unlimited ships', () => {
    // Mutation check: a default branch that dispatches fails this.
    for (const policy of ['parallel', 'yolo', '', 'queue']) {
      const decision = decideOverlap(policy, { activeRuns: 0, queuedRuns: 0 });
      expect(decision.action, policy).toBe('refused');
    }
  });

  it('a bound-carrying policy without its bound is refused, not defaulted', () => {
    for (const queueLimit of [undefined, 0, -1, 2.5, Number.NaN]) {
      expect(decideOverlap('queue_all', { activeRuns: 0, queuedRuns: 0, queueLimit }).action)
        .toBe('refused');
    }
    for (const parallelLimit of [undefined, 0, -1, 2.5, Number.NaN]) {
      expect(decideOverlap('parallel_with_limit', { activeRuns: 0, queuedRuns: 0, parallelLimit }).action)
        .toBe('refused');
    }
  });

  it('counts that are not counts are refused', () => {
    expect(decideOverlap('skip', { activeRuns: -1, queuedRuns: 0 }).action).toBe('refused');
    expect(decideOverlap('skip', { activeRuns: 0, queuedRuns: 1.5 }).action).toBe('refused');
    expect(decideOverlap('skip', { activeRuns: Number.NaN, queuedRuns: 0 }).action).toBe('refused');
  });
});
