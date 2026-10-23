# DEVELOPER-SUPPLIED EVIDENCE — not independent acceptance

Logs in this directory were produced at code commit `1f687cca1d43f304cc0c43d69bd196689996c8ec` (tree `c3782c39419a862a9ed2218f711bf1f14400c084`). They do not replace independent reproduction. Commands, checksums, and counts are in `MANIFEST.md`.

The live xAI path is UNTESTED. No real xAI response was captured. Every receipt in these tests comes from a `fetchImpl` fixture.

## The reviewer call is one non-streaming Responses POST

`createXaiDirectReviewerRoleProvider` posts to `${base}/responses` (`relay-bridge/julius-xai-direct-reviewer.ts:95`). `base` defaults to `https://api.x.ai/v1` (`relay-bridge/reviewer-harness/hermes/xai-models.ts:24`, applied at `julius-xai-direct-reviewer.ts:74`).

The body is exactly `{ model, store: false, input }` (`julius-xai-direct-reviewer.ts:98`). There is no `stream` parameter and no `stream_options`. The adapter reads the whole body with `res.text()` (`:102`) and `JSON.parse` (`:118`), then reads top-level `usage.cost_in_usd_ticks` (`:126` and `:130`). It does not read a final SSE chunk.

Grep at this commit (`grep.log`):

```
rg -n 'stream_options|\bstream\b' relay-bridge/julius-xai-direct-reviewer.ts
```

No matches. The only `stream` substring in that file is the word "non-streaming" in the comment at line 23.

```
rg -n 'Math\.(round|floor|ceil)|toFixed' relay-bridge/julius-xai-direct-reviewer.ts
```

No matches. The conversion does not use `Math.round`, `Math.floor`, `Math.ceil`, or `toFixed`.

## Conversion

`costUsdMicrosFromXaiTicks` (`julius-xai-direct-reviewer.ts:56-64`) keeps a non-negative safe integer tick count and sets:

- `q = t / 10_000n`, `r = t % 10_000n` (BigInt integer division)
- `micros = r > 0n ? q + 1n : q`

That is the integer quotient plus 1 when the remainder is non-zero. The raw provider value is `costUsdTicksRaw: ticks` on the same return (`:63`). The success leg and post-200 failures spread both fields (`:131-132`, `:151`, `:114`). The controller stores both on the result row (`julius-dispatch.ts:552`):

`costUsdMicros: out.costUsdMicros ?? null, costUsdTicksRaw: out.costUsdTicksRaw ?? null`

A missing, null, negative, non-integer, non-safe, string, NaN, or infinite tick count returns null. It is not stored as 0. Architect, coder, and Hermes legs still do not set a dollar receipt. The wired coder remains `CLAUDE_SUBSCRIPTION` and `hostedCoderCost` still returns `costUsdMicros: null`.

## Float division is equivalent on safe integers

For every safe integer `t`, `Math.ceil(t / 10000)` equals this integer ceiling. A 1-tick remainder adds `1e-4` to a quotient below about `9e11`. Half an ulp there is `0.00006103515625` (ulp `0.0001220703125` at the largest safe quotient), and `0.0001` is larger, so the float rounds up to the next representable value and `Math.ceil` lands on the next micro. No safe integer is a counterexample, and this package does not claim one.

The tests at `9_007_199_254_740_000` → `900_719_925_474` and `9_007_199_254_740_001` → `900_719_925_475` are plain correctness checks (`k * 10000` and one tick above it, `k = 900_719_925_474`), both safe integers.

Mutant `F1-float-ceil-division` replaces the BigInt quotient and remainder with `BigInt(Math.ceil(Number(t) / 10_000))` and leaves raw-tick storage in place. It survived. That survival is equivalence on the safe-integer domain, not a missing test. The other conversion mutants (floor, round, drop remainder, drop raw ticks, accept negative, accept non-integer, missing ticks become 0, cost taken from input tokens, success return drops the receipt) were killed. `M8a` (per-leg `Number.isSafeInteger` only) still survives for the reason already recorded at `abf15cec`: the running-sum check refuses the same values.

## Seed format test

`node --test relay-bridge/julius-inworld-mission/julius-inworld-data-1/seed/format.test.mjs` still fails at load with ENOENT on `seed/out/normalized.json`. Same failure as at `fbd7192a` and `abf15cec`. Pre-existing, unchanged, out of scope.
