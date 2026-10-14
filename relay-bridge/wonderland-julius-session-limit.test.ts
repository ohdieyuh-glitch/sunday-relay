import { describe, expect, it } from 'vitest';

import {
  WONDERLAND_JULIUS_SESSION_MAX_IN_FLIGHT,
  WONDERLAND_JULIUS_SESSION_RATE,
  createWonderlandJuliusSessionLimit,
} from './wonderland-julius-routes';
import { createSessionRateLimit } from './wonderland-social-routes';

/**
 * ONE SESSION'S SHARE OF THE JULIUS WORLD (row 12; internal engineering X1 for the independent reviewer's LOW
 * JU-348-05: "no per-session rate limit; one paired member polling a large run can hold all 4 world connections, so
 * every other player's world gets 503").
 *
 * The limit has two halves. IN FLIGHT: at most N requests of one native session are being answered at once, so one
 * session holds at most N of the world pool's four connections. RATE: at most `limit` requests per `windowMs`, the
 * bridge's existing sliding window (`createSessionRateLimit`, #356's EOS client config limit) reused, not re-written.
 */

const NOW = 1_757_289_600_000;
const allowAll = (): { readonly ok: true } => ({ ok: true });

describe('the limit itself: N in flight per session, and a rate', () => {
  it('admits up to N at once for one session, refuses the next with Retry-After 1, and a release frees exactly one slot', () => {
    const limit = createWonderlandJuliusSessionLimit({ maxInFlight: 2, rate: allowAll });
    const first = limit.admit('session-a', NOW);
    const second = limit.admit('session-a', NOW);
    expect(first.ok && second.ok).toBe(true);
    expect(limit.admit('session-a', NOW)).toEqual({ ok: false, retryAfterSeconds: 1 });
    if (!first.ok) throw new Error('unreachable');
    first.release();
    const third = limit.admit('session-a', NOW);
    expect(third.ok).toBe(true);
    expect(limit.admit('session-a', NOW)).toEqual({ ok: false, retryAfterSeconds: 1 });
  });

  it('a release is idempotent: releasing one admission twice frees ONE slot, never two', () => {
    const limit = createWonderlandJuliusSessionLimit({ maxInFlight: 2, rate: allowAll });
    const first = limit.admit('session-a', NOW);
    const second = limit.admit('session-a', NOW);
    if (!first.ok || !second.ok) throw new Error('fixture: both should be admitted');
    first.release();
    first.release();
    expect(limit.admit('session-a', NOW).ok).toBe(true);
    // A double release must not have opened a third slot beside `second` and the one just admitted.
    expect(limit.admit('session-a', NOW)).toEqual({ ok: false, retryAfterSeconds: 1 });
  });

  it('sessions are independent: one session at its limit costs another nothing', () => {
    const limit = createWonderlandJuliusSessionLimit({ maxInFlight: 1, rate: allowAll });
    expect(limit.admit('session-a', NOW).ok).toBe(true);
    expect(limit.admit('session-a', NOW).ok).toBe(false);
    expect(limit.admit('session-b', NOW).ok).toBe(true);
  });

  it('the rate is the bridge\'s own sliding window: over it is refused until the oldest counted request leaves it', () => {
    const limit = createWonderlandJuliusSessionLimit({ maxInFlight: 5, rate: createSessionRateLimit(3, 10_000) });
    for (const at of [NOW, NOW + 1_000, NOW + 2_000]) {
      const admitted = limit.admit('session-a', at);
      if (!admitted.ok) throw new Error(`fixture: admission at ${at} refused`);
      admitted.release();
    }
    // The oldest counted request (NOW) leaves the window at NOW + 10 000: from NOW + 2 500 that is 7.5 s, said as 8.
    expect(limit.admit('session-a', NOW + 2_500)).toEqual({ ok: false, retryAfterSeconds: 8 });
    expect(limit.admit('session-a', NOW + 10_001).ok).toBe(true);
  });

  it('a request refused for being one too many in flight is NOT counted against the rate', () => {
    const limit = createWonderlandJuliusSessionLimit({ maxInFlight: 1, rate: createSessionRateLimit(2, 10_000) });
    const held = limit.admit('session-a', NOW);
    if (!held.ok) throw new Error('fixture: first admission refused');
    for (let i = 0; i < 5; i += 1) expect(limit.admit('session-a', NOW)).toEqual({ ok: false, retryAfterSeconds: 1 });
    held.release();
    // Only ONE request has been counted, so a second is still within the rate of two.
    const second = limit.admit('session-a', NOW);
    expect(second.ok).toBe(true);
    if (second.ok) second.release();
    // CONTROL: the rate does bite -- the third counted request is refused by it, not by the in-flight bound.
    expect(limit.admit('session-a', NOW)).toEqual({ ok: false, retryAfterSeconds: 10 });
  });

  it('a request refused by the rate holds no slot: the session\'s next admitted request is not blocked by it', () => {
    let refuse = true;
    const limit = createWonderlandJuliusSessionLimit({ maxInFlight: 1, rate: () => (refuse ? { ok: false, retryAfterMs: 1 } : { ok: true }) });
    expect(limit.admit('session-a', NOW)).toEqual({ ok: false, retryAfterSeconds: 1 });
    refuse = false;
    expect(limit.admit('session-a', NOW).ok).toBe(true);
  });

  it('a limit that could admit nothing is refused when it is built, not discovered by the first player', () => {
    for (const maxInFlight of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => createWonderlandJuliusSessionLimit({ maxInFlight, rate: allowAll }), String(maxInFlight)).toThrow(/maxInFlight/u);
    }
  });

  it('the bridge\'s numbers: 2 in flight (the client holds at most a stream leg and a result read), 30 per 10 s', () => {
    expect(WONDERLAND_JULIUS_SESSION_MAX_IN_FLIGHT).toBe(2);
    expect(WONDERLAND_JULIUS_SESSION_RATE).toEqual({ limit: 30, windowMs: 10_000 });
    expect(Object.isFrozen(WONDERLAND_JULIUS_SESSION_RATE)).toBe(true);
  });
});
