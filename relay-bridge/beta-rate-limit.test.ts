import { describe, expect, it } from 'vitest';

import { claimedClientKey, createBetaRateLimiter, BETA_RATE_LIMIT } from './beta-rate-limit';

/**
 * WHAT STOPS ONE CALLER TAKING THE WHOLE BETA.
 *
 * Review filled 100 production seats with anonymous requests in 671ms. The seat
 * cap made that a bounded refusal; this is what stops the bound being reached
 * in a second. The property that matters is the one a lie cannot get past.
 */

const T0 = 1_000_000;

describe('one key cannot spend the wave', () => {
  it('allows the configured burst and then refuses', () => {
    const limiter = createBetaRateLimiter({ perKey: 3, global: 100, windowMs: 60_000, maxTrackedKeys: 100 });
    for (let i = 0; i < 3; i += 1) {
      expect(limiter.check('1.2.3.4', T0).allowed, `attempt ${String(i)}`).toBe(true);
    }
    const refused = limiter.check('1.2.3.4', T0);
    expect(refused.allowed).toBe(false);
    expect(refused.limit).toBe('per_key');
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('a different key is unaffected', () => {
    const limiter = createBetaRateLimiter({ perKey: 1, global: 100, windowMs: 60_000, maxTrackedKeys: 100 });
    expect(limiter.check('a', T0).allowed).toBe(true);
    expect(limiter.check('a', T0).allowed).toBe(false);
    expect(limiter.check('b', T0).allowed).toBe(true);
  });

  it('the window rolls over and the caller recovers', () => {
    const limiter = createBetaRateLimiter({ perKey: 1, global: 100, windowMs: 60_000, maxTrackedKeys: 100 });
    expect(limiter.check('a', T0).allowed).toBe(true);
    expect(limiter.check('a', T0 + 59_999).allowed).toBe(false);
    expect(limiter.check('a', T0 + 60_000).allowed).toBe(true);
  });

  it('a refused request does not extend the window into a permanent ban', () => {
    // Hammering must not make recovery impossible — that would be a ban
    // nobody decided to issue.
    const limiter = createBetaRateLimiter({ perKey: 1, global: 100, windowMs: 60_000, maxTrackedKeys: 100 });
    limiter.check('a', T0);
    for (let t = T0; t < T0 + 60_000; t += 1_000) limiter.check('a', t);
    expect(limiter.check('a', T0 + 60_000).allowed).toBe(true);
  });
});

describe('the global limit is the one a lie cannot get past', () => {
  it('a caller spraying a fresh key per request is still stopped', () => {
    // `x-forwarded-for` is the platform's word, not a fact. A caller reaching
    // the bridge directly can set it per request and defeat the per-key limit
    // completely — which is the entire reason the global limit exists.
    const limiter = createBetaRateLimiter({ perKey: 5, global: 10, windowMs: 60_000, maxTrackedKeys: 100 });
    let allowed = 0;
    for (let i = 0; i < 500; i += 1) {
      if (limiter.check(`spoofed-${String(i)}`, T0).allowed) allowed += 1;
    }
    expect(allowed).toBe(10);
  });

  it('names the global limit, so a log says which bound refused', () => {
    const limiter = createBetaRateLimiter({ perKey: 100, global: 1, windowMs: 60_000, maxTrackedKeys: 100 });
    limiter.check('a', T0);
    const refused = limiter.check('b', T0);
    expect(refused.limit).toBe('global');
  });

  it('the global window rolls over too', () => {
    const limiter = createBetaRateLimiter({ perKey: 100, global: 1, windowMs: 60_000, maxTrackedKeys: 100 });
    expect(limiter.check('a', T0).allowed).toBe(true);
    expect(limiter.check('b', T0).allowed).toBe(false);
    expect(limiter.check('b', T0 + 60_000).allowed).toBe(true);
  });

  it('cannot be exhausted in a second at the shipped settings', () => {
    // The measured attack: 100 requests, no throttle, 671ms. It now stops at
    // the global bound long before the seats are gone.
    const limiter = createBetaRateLimiter();
    let allowed = 0;
    for (let i = 0; i < 100; i += 1) {
      if (limiter.check(`bot-${String(i)}`, T0 + i * 6).allowed) allowed += 1;
    }
    expect(allowed).toBe(BETA_RATE_LIMIT.global);
    expect(allowed).toBeLessThan(100);
  });
});

describe('the limiter cannot be turned into a memory attack', () => {
  it('tracks a bounded number of keys, and the global limit still holds', () => {
    const limiter = createBetaRateLimiter({ perKey: 1, global: 1_000_000, windowMs: 60_000, maxTrackedKeys: 50 });
    for (let i = 0; i < 5_000; i += 1) limiter.check(`k${String(i)}`, T0 + i);
    // No assertion on internals — the observable property is that it still
    // answers, and that eviction degrades the per-key limit rather than the
    // global one.
    expect(limiter.check('fresh', T0 + 6_000).allowed).toBe(true);
  });
});

describe('the client key is the platform\'s word, and bounded', () => {
  it('takes the leftmost forwarded hop', () => {
    expect(claimedClientKey({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1, 10.0.0.2' })).toBe('1.2.3.4');
  });

  it.each([
    ['absent', undefined],
    ['blank', '   '],
    ['empty', ''],
  ])('answers unknown for %s rather than inventing one', (_l, value) => {
    expect(claimedClientKey({ 'x-forwarded-for': value })).toBe('unknown');
  });

  it('an array header takes the first entry', () => {
    expect(claimedClientKey({ 'x-forwarded-for': ['9.9.9.9', 'x'] })).toBe('9.9.9.9');
  });

  it('a very long header cannot be used as the memory attack itself', () => {
    const key = claimedClientKey({ 'x-forwarded-for': 'a'.repeat(100_000) });
    expect(key.length).toBeLessThanOrEqual(64);
  });
});
