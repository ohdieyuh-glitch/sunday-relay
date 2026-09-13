/**
 * WHAT A PEER DISPATCH COST, WORKED OUT FROM WHAT ITS PROVIDER REPORTED.
 *
 * Qualification attempt 2 (run 34757974058) settled all ten Prompt Architect
 * and Independent Reviewer dispatches `UNKNOWN`, even though every one of them
 * came back with token counts. The slot ledger therefore booked each one at its
 * 300,000 µ$ hold, whatever it really bought. On that run the hold was larger
 * than the bill, so the ledger was pessimistic. At the provider's maximum output
 * (128,000 tokens at $20/M for the architect, about $2.56 in one call) the hold
 * is smaller than the bill, and a ledger that charges a silent dispatch its hold
 * UNDER-counts: it lends the rest of the mission money a peer has already spent.
 *
 * `MEASURED_FROM_USAGE` is the basis `julius-cost-accounting` reserved for this:
 * token counts the boundary reported, priced against a table recorded at the
 * time. This module is that table and the arithmetic, and nothing else.
 *
 * WHAT IT REFUSES TO PRICE, returning a reason instead of a number:
 *   - a model with no recorded price;
 *   - a dispatch completed outside the window its price was recorded for
 *     (gpt-5.6-sol's price is promotional "at least through November 21, 2026";
 *     after that nobody has told Relay what it costs);
 *   - usage that is missing a count the price needs, or is inconsistent;
 *   - reasoning a provider bills beyond its output count and did not report.
 *
 * WHERE A COUNT IS ABSENT BUT A BOUND IS STILL KNOWN, it prices the bound, never
 * the cheaper reading: unreported cached tokens are priced as uncached input, and
 * unreported cache writes as the dearer of input and cache write. A per-request
 * tier the aggregate cannot settle is priced at the upper tier. The one direction
 * this figure may be wrong is high.
 *
 * Pure: no clock (`at` is handed in), no Node, no network.
 */

/** Micro-dollars per one million tokens. Integers, so the arithmetic is exact until the final round-up. */
export interface JuliusUsageRates {
  readonly inputMicrosPerMTok: number;
  readonly cachedInputMicrosPerMTok: number;
  readonly cacheWriteMicrosPerMTok: number;
  readonly outputMicrosPerMTok: number;
}

export interface JuliusUsagePrice {
  readonly model: string;
  /** Where the figures were read, and the day, so a reader can check them. */
  readonly source: string;
  readonly readOn: string;
  /** The last day (UTC) this price is in force for Relay. After it, UNKNOWN. */
  readonly validThrough: string;
  /**
   * Whether the provider's `output_tokens` already counts reasoning.
   * OpenAI: reasoning is "billed as output tokens" and included in `output_tokens`.
   * xAI: its documented usage example reports 9 output tokens, 110 reasoning
   * tokens and a total of 151 = 32 + 9 + 110, so reasoning is beyond output.
   */
  readonly reasoning: 'INCLUDED_IN_OUTPUT' | 'BILLED_BEYOND_OUTPUT';
  readonly base: JuliusUsageRates;
  /**
   * The dearer tier and the prompt size, in tokens, from which a whole request is
   * billed at it. Null when the provider publishes one tier.
   */
  readonly upper: { readonly fromPromptTokens: number; readonly rates: JuliusUsageRates } | null;
}

const rates = (input: number, cached: number, cacheWrite: number, output: number): JuliusUsageRates =>
  Object.freeze({
    inputMicrosPerMTok: input, cachedInputMicrosPerMTok: cached,
    cacheWriteMicrosPerMTok: cacheWrite, outputMicrosPerMTok: output,
  });

/**
 * THE TABLE, read from each provider's own pricing page on 2026-09-13.
 *
 * Only the two peer models the paid workflow pins. The Coding Agent's runtime
 * reports the dollar amount it billed (`PROVIDER_REPORTED`), which outranks any
 * table, so it has no entry here and needs none.
 */
export const JULIUS_USAGE_PRICES: readonly JuliusUsagePrice[] = Object.freeze([
  Object.freeze({
    model: 'gpt-5.6-sol',
    source: 'developers.openai.com/api/docs/pricing (Standard: short context input $4.00, cached input $0.40, '
      + 'cache writes $5.00, output $20.00; long context $8.00, $0.80, $10.00, $30.00) and '
      + 'developers.openai.com/api/docs/models/gpt-5.6-sol ("Prompts with >272K input tokens are priced at 2x input '
      + 'and 1.5x output for the full request"; "promotional pricing is available at least through November 21, 2026")',
    readOn: '2026-09-13',
    validThrough: '2026-11-21',
    reasoning: 'INCLUDED_IN_OUTPUT',
    base: rates(4_000_000, 400_000, 5_000_000, 20_000_000),
    upper: Object.freeze({ fromPromptTokens: 272_001, rates: rates(8_000_000, 800_000, 10_000_000, 30_000_000) }),
  }),
  Object.freeze({
    model: 'grok-build-0.1',
    source: 'docs.x.ai/docs/models/grok-build-0.1 (< 200k prompt tokens: input $1.00, cached input $0.20, output $2.00; '
      + '>= 200k: $2.00, $0.40, $4.00; "Requests whose prompt reaches 200k tokens are billed at the higher rate for all '
      + 'tokens in the request") and docs.x.ai/docs/api-reference (Responses usage example: reasoning beyond output)',
    readOn: '2026-09-13',
    // xAI states no end date. A price nobody re-reads is a guess by next quarter,
    // so it stops being used ninety days after it was read.
    validThrough: '2026-12-12',
    reasoning: 'BILLED_BEYOND_OUTPUT',
    // xAI publishes no cache-write price; a written prompt token is still a prompt token.
    base: rates(1_000_000, 200_000, 1_000_000, 2_000_000),
    upper: Object.freeze({ fromPromptTokens: 200_000, rates: rates(2_000_000, 400_000, 2_000_000, 4_000_000) }),
  }),
]);

/**
 * ONE REQUEST'S USAGE, or several a harness reported as one figure.
 *
 * `promptTokens` is EVERY prompt token billed, cached and cache-written ones
 * included. A harness that reports input with the cache already subtracted (Hermes
 * does) adds it back before calling here.
 */
export interface JuliusMeteredUsage {
  readonly promptTokens: number | null;
  readonly cachedPromptTokens: number | null;
  readonly cacheWritePromptTokens: number | null;
  readonly outputTokens: number | null;
  readonly reasoningTokens: number | null;
  /** How many provider requests this figure covers. 1 is exact; anything else is an aggregate. */
  readonly requests: number | null;
}

export const JULIUS_USAGE_PRICING_REFUSALS = [
  'model_unpriced', 'price_not_in_force', 'usage_unreported', 'usage_inconsistent', 'reasoning_unreported',
  'no_requests',
] as const;
export type JuliusUsagePricingRefusal = (typeof JULIUS_USAGE_PRICING_REFUSALS)[number];

export type JuliusUsageCost =
  | {
    readonly ok: true;
    readonly usdMicros: number;
    /** `<model>@<readOn>`: which recorded price produced the figure. */
    readonly priceRef: string;
    /** False when any bound above was priced instead of an exact count. */
    readonly exact: boolean;
  }
  | { readonly ok: false; readonly refusal: JuliusUsagePricingRefusal };

const count = (value: number | null): number | null | 'invalid' => {
  if (value === null) return null;
  return Number.isSafeInteger(value) && value >= 0 ? value : 'invalid';
};

const day = (iso: string): string | null => {
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null;
};

/**
 * Price every request one dispatch made, as a single figure.
 *
 * ALL OR NOTHING. A dispatch whose second attempt reported no usage is not a
 * dispatch that cost what its first attempt cost; one refusal refuses the sum.
 */
export function juliusUsageCost(input: {
  readonly model: string;
  /** When the dispatch completed. The price must be in force on that UTC day. */
  readonly at: string;
  readonly requests: readonly JuliusMeteredUsage[];
}): JuliusUsageCost {
  const price = JULIUS_USAGE_PRICES.find((entry) => entry.model === input.model);
  if (price === undefined) return { ok: false, refusal: 'model_unpriced' };
  const on = day(input.at);
  if (on === null || on < price.readOn || on > price.validThrough) return { ok: false, refusal: 'price_not_in_force' };
  if (input.requests.length === 0) return { ok: false, refusal: 'no_requests' };

  // Micro-dollars times one million, summed exactly and rounded up once.
  let scaled = 0;
  let exact = true;
  for (const usage of input.requests) {
    const prompt = count(usage.promptTokens);
    const output = count(usage.outputTokens);
    const cached = count(usage.cachedPromptTokens);
    const written = count(usage.cacheWritePromptTokens);
    const reasoning = count(usage.reasoningTokens);
    const requests = count(usage.requests);
    if ([prompt, output, cached, written, reasoning, requests].includes('invalid')) {
      return { ok: false, refusal: 'usage_inconsistent' };
    }
    if (prompt === null || output === null) return { ok: false, refusal: 'usage_unreported' };
    if (requests === 0) return { ok: false, refusal: 'usage_inconsistent' };
    const cachedKnown = cached as number | null;
    const writtenKnown = written as number | null;
    if ((cachedKnown ?? 0) + (writtenKnown ?? 0) > (prompt as number)) return { ok: false, refusal: 'usage_inconsistent' };

    let billedOutput = output as number;
    if (price.reasoning === 'BILLED_BEYOND_OUTPUT') {
      if (reasoning === null) return { ok: false, refusal: 'reasoning_unreported' };
      billedOutput += reasoning as number;
    }

    // THE TIER. Exact for one request; for an aggregate, the base tier holds only
    // when even the whole aggregate stays under the threshold, because no single
    // request in it can be larger than the whole.
    let tier = price.base;
    if (price.upper !== null && (prompt as number) >= price.upper.fromPromptTokens) {
      tier = price.upper.rates;
      if (requests !== 1) exact = false;
    }

    const uncached = (prompt as number) - (cachedKnown ?? 0) - (writtenKnown ?? 0);
    const uncachedRate = writtenKnown === null
      ? Math.max(tier.inputMicrosPerMTok, tier.cacheWriteMicrosPerMTok)
      : tier.inputMicrosPerMTok;
    if (cachedKnown === null || writtenKnown === null) exact = false;
    scaled += uncached * uncachedRate
      + (cachedKnown ?? 0) * tier.cachedInputMicrosPerMTok
      + (writtenKnown ?? 0) * tier.cacheWriteMicrosPerMTok
      + billedOutput * tier.outputMicrosPerMTok;
  }
  if (!Number.isSafeInteger(scaled)) return { ok: false, refusal: 'usage_inconsistent' };
  return { ok: true, usdMicros: Math.ceil(scaled / 1_000_000), priceRef: `${price.model}@${price.readOn}`, exact };
}
