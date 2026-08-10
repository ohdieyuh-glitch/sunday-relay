import { describe, expect, it } from 'vitest';

import {
  checkRetrievalBudget,
  emptyMeter,
  recordRetrieval,
  reportUsage,
  type RetrievalMeter,
} from './live-reach-metering';

/**
 * THE TESTS THAT MATTER HERE ARE THE ONES ABOUT NOT KNOWING.
 *
 * Counting successful fetches is arithmetic. The reason this module exists is
 * the three cases underneath it: a request Relay refused itself (spent
 * nothing), a request that never got an answer (spent something Relay cannot
 * measure), and a byte budget over a sum that cannot account for every read.
 */

const AT = '2026-08-10T10:00:00.000Z';
const later = (n: number): string => `2026-08-10T10:0${String(n)}:00.000Z`;

const meter = (records: Parameters<typeof recordRetrieval>[1][]): RetrievalMeter =>
  records.reduce(recordRetrieval, emptyMeter('msn-1'));

describe('what counts as spent', () => {
  it('counts a retrieval the host answered', () => {
    const m = meter([{ source: 'web', outcome: 'observed', bytes: 1_000, at: AT }]);
    expect(m.counted).toBe(1);
    expect(m.unknownEffect).toBe(0);
    expect(m.bytes).toBe(1_000);
  });

  it('counts a THROTTLED request, because the host counted it too', () => {
    // A 429 is the host telling you it saw the request. Not charging for it
    // would make rate limiting free to hammer.
    const m = meter([{ source: 'web', outcome: 'throttled', bytes: null, at: AT, retryAfter: '30' }]);
    expect(m.counted).toBe(1);
    expect(m.lastRetryAfter).toBe('30');
  });

  it('counts an unauthenticated request the same way', () => {
    expect(meter([{ source: 'github', outcome: 'unauthenticated', bytes: null, at: AT }]).counted).toBe(1);
  });

  it('records an unreachable attempt as UNCONFIRMED, never as counted', () => {
    // Relay cannot tell whether a DNS failure or a post-connect timeout
    // reached the host. Both readings are wrong; a third field is right.
    const m = meter([{ source: 'web', outcome: 'unreachable', bytes: null, at: AT }]);
    expect(m.counted).toBe(0);
    expect(m.unknownEffect).toBe(1);
  });

  it('leaves the meter completely untouched when Relay refused it itself', () => {
    // No socket opened, so nothing was spent — including the clock. A mission
    // whose every request was refused has retrieved nothing.
    const before = emptyMeter('msn-1');
    const after = recordRetrieval(before, { source: 'web', outcome: 'not_attempted', bytes: null, at: AT });
    expect(after).toEqual(before);
    expect(after.firstAt).toBeNull();
  });
});

describe('bytes are partial, and say so', () => {
  it('is NULL before anything is measured, not zero', () => {
    // Zero would claim a body of no bytes was read. Nothing was read at all.
    expect(emptyMeter('msn-1').bytes).toBeNull();
    expect(reportUsage(emptyMeter('msn-1')).bytes).toBeNull();
  });

  it('stays null when every counted retrieval carried no size', () => {
    const m = meter([{ source: 'web', outcome: 'throttled', bytes: null, at: AT }]);
    expect(m.bytes).toBeNull();
    expect(m.unsized).toBe(1);
  });

  it('sums known sizes and reports how many it cannot speak for', () => {
    const m = meter([
      { source: 'web', outcome: 'observed', bytes: 400, at: AT },
      { source: 'web', outcome: 'throttled', bytes: null, at: later(1) },
      { source: 'rss', outcome: 'observed', bytes: 600, at: later(2) },
    ]);
    expect(m.bytes).toBe(1_000);
    expect(m.unsized).toBe(1);
  });

  it('does not attribute a size to an unconfirmed attempt', () => {
    const m = meter([{ source: 'web', outcome: 'unreachable', bytes: 999, at: AT }]);
    expect(m.bytes).toBeNull();
    // And it is not counted as an unsized COUNTED retrieval either — it was
    // never counted.
    expect(m.unsized).toBe(0);
  });
});

describe('per source, and over time', () => {
  it('keeps sources apart', () => {
    const m = meter([
      { source: 'web', outcome: 'observed', bytes: 10, at: AT },
      { source: 'github', outcome: 'observed', bytes: 20, at: later(1) },
      { source: 'github', outcome: 'unreachable', bytes: null, at: later(2) },
    ]);
    expect(m.bySource.web).toEqual({ counted: 1, unknownEffect: 0 });
    expect(m.bySource.github).toEqual({ counted: 1, unknownEffect: 1 });
  });

  it('keeps the first and last times a retrieval actually happened', () => {
    const m = meter([
      { source: 'web', outcome: 'observed', bytes: 10, at: AT },
      { source: 'web', outcome: 'observed', bytes: 10, at: later(5) },
    ]);
    expect(m.firstAt).toBe(AT);
    expect(m.lastAt).toBe(later(5));
  });

  it('keeps the last throttle’s Retry-After even after a later success', () => {
    // It remains the most recent thing the host said about its own limit, and
    // an operator deciding whether to retry wants it.
    const m = meter([
      { source: 'web', outcome: 'throttled', bytes: null, at: AT, retryAfter: '60' },
      { source: 'web', outcome: 'observed', bytes: 10, at: later(1) },
    ]);
    expect(m.lastRetryAfter).toBe('60');
  });

  it('records a throttle with no Retry-After as unknown rather than a guess', () => {
    const m = meter([{ source: 'web', outcome: 'throttled', bytes: null, at: AT }]);
    expect(m.lastRetryAfter).toBeNull();
  });
});

describe('the budget', () => {
  const spend = (n: number): RetrievalMeter =>
    meter(Array.from({ length: n }, (_, i) => ({
      source: 'web' as const, outcome: 'observed' as const, bytes: 10, at: later(i),
    })));

  it('allows a retrieval under the cap', () => {
    expect(checkRetrievalBudget(spend(2), { maxRetrievals: 3, maxBytes: null }).ok).toBe(true);
  });

  it('refuses at the cap, BEFORE the fetch rather than after', () => {
    const verdict = checkRetrievalBudget(spend(3), { maxRetrievals: 3, maxBytes: null });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.refusal).toBe('retrieval_budget_exhausted');
  });

  it('charges an UNCONFIRMED attempt against the cap', () => {
    // The pessimistic reading, and the only one that fails closed: otherwise a
    // host that never answers is a way to retry without limit.
    const m = meter([
      { source: 'web', outcome: 'unreachable', bytes: null, at: AT },
      { source: 'web', outcome: 'unreachable', bytes: null, at: later(1) },
    ]);
    const verdict = checkRetrievalBudget(m, { maxRetrievals: 2, maxBytes: null });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.detail).toContain('could not confirm');
  });

  it('treats no cap as no cap, rather than as zero', () => {
    expect(checkRetrievalBudget(spend(50), { maxRetrievals: null, maxBytes: null }).ok).toBe(true);
  });

  it('reports a byte budget as UNENFORCEABLE when a read had no size', () => {
    // The failure this prevents: a 10 KB cap sitting over a sum that omits
    // every unsized read looks enforced and is not.
    const m = meter([
      { source: 'web', outcome: 'observed', bytes: 100, at: AT },
      { source: 'web', outcome: 'throttled', bytes: null, at: later(1) },
    ]);
    const verdict = checkRetrievalBudget(m, { maxRetrievals: null, maxBytes: 10_000 });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.refusal).toBe('byte_budget_unenforceable');
      // And it does NOT claim the budget was exhausted — 100 is far under
      // 10,000. The problem is the measurement, and it says which.
      expect(verdict.detail).toContain('reported no size');
    }
  });

  it('enforces a byte budget when every read was measured', () => {
    const m = meter([{ source: 'web', outcome: 'observed', bytes: 10_000, at: AT }]);
    const verdict = checkRetrievalBudget(m, { maxRetrievals: null, maxBytes: 10_000 });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.refusal).toBe('byte_budget_exhausted');
  });

  it('allows a fresh mission under a byte budget', () => {
    // `bytes: null` must not read as "already at the cap" or as an error.
    expect(checkRetrievalBudget(emptyMeter('msn-1'), { maxRetrievals: null, maxBytes: 1_000 }).ok).toBe(true);
  });
});

describe('what gets reported', () => {
  it('states the unit, so nobody reads it as money', () => {
    // Retrieval spends a rate limit and bandwidth. There is no cost field
    // anywhere in this module, and this test is what keeps one from arriving.
    const usage = reportUsage(meter([{ source: 'web', outcome: 'observed', bytes: 5, at: AT }]));
    expect(usage.unit).toBe('retrievals_and_bytes');
    expect(JSON.stringify(usage)).not.toMatch(/cost|usd|cents|price|spend/i);
  });

  it('keeps confirmed and unconfirmed separate all the way out', () => {
    const usage = reportUsage(meter([
      { source: 'web', outcome: 'observed', bytes: 5, at: AT },
      { source: 'web', outcome: 'unreachable', bytes: null, at: later(1) },
    ]));
    expect(usage.retrievals).toBe(1);
    expect(usage.unconfirmedRetrievals).toBe(1);
  });
});
