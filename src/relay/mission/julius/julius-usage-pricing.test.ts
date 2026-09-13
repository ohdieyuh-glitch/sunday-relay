import { describe, expect, it } from 'vitest';

import {
  JULIUS_USAGE_PRICES,
  juliusUsageCost,
  type JuliusMeteredUsage,
} from './julius-usage-pricing';

/**
 * The figures below are real: the architect and reviewer rows of qualification
 * attempt 2 (run 34757974058, worker-diagnostics.tsv), priced by hand against the
 * provider pages the table cites.
 */

const AT = '2026-09-13T12:51:03.000Z';
const one = (over: Partial<JuliusMeteredUsage> = {}): JuliusMeteredUsage => ({
  promptTokens: 2527, cachedPromptTokens: 0, cacheWritePromptTokens: 0,
  outputTokens: 4378, reasoningTokens: 435, requests: 1, ...over,
});

describe('the recorded prices are the providers\' own, and say where they came from', () => {
  it('holds exactly the two peer models the paid workflow pins, frozen', () => {
    expect(JULIUS_USAGE_PRICES.map((price) => price.model)).toEqual(['gpt-5.6-sol', 'grok-build-0.1']);
    expect(Object.isFrozen(JULIUS_USAGE_PRICES)).toBe(true);
    for (const price of JULIUS_USAGE_PRICES) {
      expect(Object.isFrozen(price)).toBe(true);
      expect(price.readOn).toBe('2026-09-13');
    }
  });

  it('gpt-5.6-sol: $4 / $0.40 cached / $5 cache write / $20 out, 2x input and 1.5x output above 272K, promotional to 2026-11-21', () => {
    const sol = JULIUS_USAGE_PRICES.find((price) => price.model === 'gpt-5.6-sol')!;
    expect(sol.base).toEqual({ inputMicrosPerMTok: 4_000_000, cachedInputMicrosPerMTok: 400_000, cacheWriteMicrosPerMTok: 5_000_000, outputMicrosPerMTok: 20_000_000 });
    expect(sol.upper).toEqual({ fromPromptTokens: 272_001, rates: { inputMicrosPerMTok: 8_000_000, cachedInputMicrosPerMTok: 800_000, cacheWriteMicrosPerMTok: 10_000_000, outputMicrosPerMTok: 30_000_000 } });
    expect(sol.reasoning).toBe('INCLUDED_IN_OUTPUT');
    expect(sol.validThrough).toBe('2026-11-21');
    expect(sol.source).toContain('developers.openai.com/api/docs/pricing');
  });

  it('grok-build-0.1: $1 / $0.20 / $2 under 200k, doubled from 200k, reasoning beyond output', () => {
    const grok = JULIUS_USAGE_PRICES.find((price) => price.model === 'grok-build-0.1')!;
    expect(grok.base).toEqual({ inputMicrosPerMTok: 1_000_000, cachedInputMicrosPerMTok: 200_000, cacheWriteMicrosPerMTok: 1_000_000, outputMicrosPerMTok: 2_000_000 });
    expect(grok.upper).toEqual({ fromPromptTokens: 200_000, rates: { inputMicrosPerMTok: 2_000_000, cachedInputMicrosPerMTok: 400_000, cacheWriteMicrosPerMTok: 2_000_000, outputMicrosPerMTok: 4_000_000 } });
    expect(grok.reasoning).toBe('BILLED_BEYOND_OUTPUT');
    expect(grok.source).toContain('docs.x.ai');
  });
});

describe('a dispatch is priced from what its provider reported', () => {
  it('prices run 34757974058\'s first architect dispatch exactly', () => {
    // 2,527 prompt x $4/M + 4,378 output x $20/M; the 435 reasoning tokens are inside the 4,378.
    expect(juliusUsageCost({ model: 'gpt-5.6-sol', at: AT, requests: [one()] }))
      .toEqual({ ok: true, usdMicros: 10_108 + 87_560, priceRef: 'gpt-5.6-sol@2026-09-13', exact: true });
  });

  it('prices a cached prompt at the cached rate and rounds the fraction up, never down', () => {
    // Run 34757974058's second architect dispatch: 1,656 uncached x 4 + 1,098 x 0.4 + 4,451 x 20 = 96,083.2 µ$.
    const cost = juliusUsageCost({
      model: 'gpt-5.6-sol', at: AT,
      requests: [one({ promptTokens: 2754, cachedPromptTokens: 1098, outputTokens: 4451, reasoningTokens: 489 })],
    });
    expect(cost).toEqual({ ok: true, usdMicros: 96_084, priceRef: 'gpt-5.6-sol@2026-09-13', exact: true });
  });

  it('adds reasoning for a provider that bills it beyond output: run 34757974058\'s first review', () => {
    const base = { promptTokens: 6657, cachedPromptTokens: 0, cacheWritePromptTokens: 0, outputTokens: 7673, requests: 1 };
    expect(juliusUsageCost({ model: 'grok-build-0.1', at: AT, requests: [{ ...base, reasoningTokens: 0 }] }))
      .toMatchObject({ ok: true, usdMicros: 6_657 + 15_346 });
    expect(juliusUsageCost({ model: 'grok-build-0.1', at: AT, requests: [{ ...base, reasoningTokens: 1000 }] }))
      .toMatchObject({ ok: true, usdMicros: 6_657 + 15_346 + 2_000 });
  });

  it('never adds reasoning twice for a provider whose output already counts it', () => {
    const without = juliusUsageCost({ model: 'gpt-5.6-sol', at: AT, requests: [one({ reasoningTokens: 0 })] });
    const withReasoning = juliusUsageCost({ model: 'gpt-5.6-sol', at: AT, requests: [one({ reasoningTokens: 4000 })] });
    expect(withReasoning).toEqual(without);
  });

  it('sums every request a dispatch bought', () => {
    const cost = juliusUsageCost({ model: 'gpt-5.6-sol', at: AT, requests: [one(), one()] });
    expect(cost).toMatchObject({ ok: true, usdMicros: 2 * 97_668 });
  });

  it('THE REASON THIS EXISTS: one maximum-output architect call costs over eight times its 300,000 µ$ hold', () => {
    const cost = juliusUsageCost({ model: 'gpt-5.6-sol', at: AT, requests: [one({ promptTokens: 10_000, outputTokens: 128_000 })] });
    expect(cost).toMatchObject({ ok: true, usdMicros: 2_600_000 });
    expect(cost.ok && cost.usdMicros > 8 * 300_000).toBe(true);
  });
});

describe('a tier is decided per request, and an aggregate that cannot settle it pays the upper one', () => {
  it('gpt-5.6-sol: 272,000 prompt tokens is short context, 272,001 is long for the whole request', () => {
    const at = (prompt: number) => juliusUsageCost({ model: 'gpt-5.6-sol', at: AT, requests: [one({ promptTokens: prompt, outputTokens: 1000 })] });
    expect(at(272_000)).toMatchObject({ usdMicros: 272_000 * 4 + 1000 * 20, exact: true });
    expect(at(272_001)).toMatchObject({ usdMicros: 272_001 * 8 + 1000 * 30, exact: true });
  });

  it('grok-build-0.1: a prompt that REACHES 200,000 tokens is billed at the higher rate for every token', () => {
    const at = (prompt: number) => juliusUsageCost({
      model: 'grok-build-0.1', at: AT,
      requests: [{ promptTokens: prompt, cachedPromptTokens: 0, cacheWritePromptTokens: 0, outputTokens: 1000, reasoningTokens: 0, requests: 1 }],
    });
    expect(at(199_999)).toMatchObject({ usdMicros: 199_999 + 2000, exact: true });
    expect(at(200_000)).toMatchObject({ usdMicros: 400_000 + 4000, exact: true });
  });

  it('an aggregate under the threshold is exact; one over it is priced high and says it is a bound', () => {
    const aggregate = (prompt: number) => juliusUsageCost({
      model: 'grok-build-0.1', at: AT,
      requests: [{ promptTokens: prompt, cachedPromptTokens: 0, cacheWritePromptTokens: 0, outputTokens: 0, reasoningTokens: 0, requests: 2 }],
    });
    expect(aggregate(150_000)).toMatchObject({ usdMicros: 150_000, exact: true });
    expect(aggregate(300_000)).toMatchObject({ usdMicros: 600_000, exact: false });
  });
});

describe('an absent count is priced at its bound, never at the cheaper reading', () => {
  it('unreported cache writes price the uncached prompt at the dearer of input and cache write', () => {
    expect(juliusUsageCost({ model: 'gpt-5.6-sol', at: AT, requests: [one({ cacheWritePromptTokens: null })] }))
      .toMatchObject({ ok: true, usdMicros: 2527 * 5 + 87_560, exact: false });
  });

  it('unreported cached tokens are priced as uncached input', () => {
    expect(juliusUsageCost({ model: 'gpt-5.6-sol', at: AT, requests: [one({ promptTokens: 2754, cachedPromptTokens: null, outputTokens: 4451 })] }))
      .toMatchObject({ ok: true, usdMicros: 2754 * 4 + 4451 * 20, exact: false });
  });

  it('reported cache writes are priced at the cache-write rate', () => {
    expect(juliusUsageCost({ model: 'gpt-5.6-sol', at: AT, requests: [one({ promptTokens: 3000, cachedPromptTokens: 1000, cacheWritePromptTokens: 1000, outputTokens: 0 })] }))
      .toMatchObject({ ok: true, usdMicros: 1000 * 4 + 400 + 1000 * 5, exact: true });
  });
});

describe('what is not priced says why, and a refusal refuses the whole dispatch', () => {
  it.each([
    ['a model with no recorded price', { model: 'claude-fable-5' }, 'model_unpriced'],
    ['a near-miss model name', { model: 'gpt-5.6-sol-pro' }, 'model_unpriced'],
    ['a day after the promotional window', { at: '2026-11-22T00:00:00.000Z' }, 'price_not_in_force'],
    ['a day before the price was read', { at: '2026-09-12T23:59:59.000Z' }, 'price_not_in_force'],
    ['an unreadable instant', { at: 'yesterday' }, 'price_not_in_force'],
    ['no requests at all', { requests: [] }, 'no_requests'],
    ['an unreported prompt', { requests: [one({ promptTokens: null })] }, 'usage_unreported'],
    ['unreported output', { requests: [one({ outputTokens: null })] }, 'usage_unreported'],
    ['more cached than prompt', { requests: [one({ cachedPromptTokens: 3000 })] }, 'usage_inconsistent'],
    ['a negative count', { requests: [one({ outputTokens: -1 })] }, 'usage_inconsistent'],
    ['a fractional count', { requests: [one({ promptTokens: 2527.5 })] }, 'usage_inconsistent'],
    ['a request count of zero', { requests: [one({ requests: 0 })] }, 'usage_inconsistent'],
    ['a priced first request and an unreported second', { requests: [one(), one({ outputTokens: null })] }, 'usage_unreported'],
  ] as const)('%s', (_label, over, refusal) => {
    expect(juliusUsageCost({ model: 'gpt-5.6-sol', at: AT, requests: [one()], ...over })).toEqual({ ok: false, refusal });
  });

  it('grok\'s price stops at its review horizon, and gpt-5.6-sol\'s last promotional day still prices', () => {
    const grok = { promptTokens: 10, cachedPromptTokens: 0, cacheWritePromptTokens: 0, outputTokens: 10, reasoningTokens: 0, requests: 1 };
    expect(juliusUsageCost({ model: 'grok-build-0.1', at: '2026-12-12T23:59:59.000Z', requests: [grok] }).ok).toBe(true);
    expect(juliusUsageCost({ model: 'grok-build-0.1', at: '2026-12-13T00:00:00.000Z', requests: [grok] }))
      .toEqual({ ok: false, refusal: 'price_not_in_force' });
    expect(juliusUsageCost({ model: 'gpt-5.6-sol', at: '2026-11-21T23:59:59.000Z', requests: [one()] }).ok).toBe(true);
  });

  it('a reasoning provider that did not report reasoning is not priced as if it did none', () => {
    expect(juliusUsageCost({
      model: 'grok-build-0.1', at: AT,
      requests: [{ promptTokens: 10, cachedPromptTokens: 0, cacheWritePromptTokens: 0, outputTokens: 10, reasoningTokens: null, requests: 1 }],
    })).toEqual({ ok: false, refusal: 'reasoning_unreported' });
    // And for a provider whose output already counts it, the absence costs nothing extra.
    expect(juliusUsageCost({ model: 'gpt-5.6-sol', at: AT, requests: [one({ reasoningTokens: null })] }).ok).toBe(true);
  });
});
