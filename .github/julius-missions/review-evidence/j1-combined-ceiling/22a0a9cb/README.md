# DEVELOPER-SUPPLIED EVIDENCE — not independent acceptance

Logs in this directory were produced at code commit `22a0a9cb2cc93f64929f1dd855aa242936f739e9` (tree `5e6bdf5b23aab307bd3f73150c5073af62c082bd`). They do not replace independent reproduction. Commands, checksums, and counts are in `MANIFEST.md`.

The live xAI path is UNTESTED. No real xAI response was captured. Every receipt in these tests comes from a `fetchImpl` fixture.

## What this head changes

`cad2097eaf6fd602dd6a9bcf2761d8f45717abc3` adds the tests. `22a0a9cb2cc93f64929f1dd855aa242936f739e9` changes comments only. Ceiling decision logic and `costUsdMicrosFromXaiTicks` are unchanged from `1f687cca`. The BigInt overflow guard at `julius-xai-direct-reviewer.ts:62` is still there.

- F-a / M8a. `julius-dispatch-repeat-ceiling.test.ts:127-140` uses legs exactly `[30000000, 1e-10]` and `[1, Number.MIN_VALUE]`. Both sums collapse to a safe integer, so the running-sum check does not refuse them. The `1.5 + 2.5` assertion in the test above (`:115-124`) stays green when only the per-leg `Number.isSafeInteger` conjunct is deleted.
- F-b. `julius-dispatch-repeat-ceiling.test.ts:142-152` uses two `Number.MAX_SAFE_INTEGER` legs. The per-leg check accepts each one. Deleting only the running-sum check (`julius-dispatch-repeat-ceiling.ts:147`) verifies the sum `18014398509481982`.
- N1. `julius-xai-direct-reviewer.test.ts:175-190` sends ticks `158500` and then refuses the 200 for a missing response id, a model mismatch (`grok-other`), and an unreadable verdict (`nope`). Each refusal must still carry `costUsdMicros: 16` and `costUsdTicksRaw: 158500`. `paid()` already spreads those fields (`julius-xai-direct-reviewer.ts:114`); this head does not change that line.
- `1e16` is an extra assertion inside the existing invalid-ticks test (`julius-xai-direct-reviewer.test.ts:169-172`). `Number.isSafeInteger(1e16)` is false. It did not add an `it`.
- F-d. `julius-xai-direct-reviewer.ts:15-17` states that `usage.cost_in_usd_ticks` is UNVERIFIED on a live call because no real response was captured. `julius-dispatch-adapters.ts:585` and `:601-606` state that `server.ts:458-459` calls `createJ1LiveDispatchFromEnv` when `JULIUS_J1_ENABLED === '1'` (`julius-dispatch-wiring.ts:15-16`), and that factory reaches `createJ1ProductionComposition` at `julius-dispatch-wiring-core.ts:235`. Otherwise `server.ts:460` uses `createUncomposedJuliusDispatch`.

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

## Two equivalent survivors

For every safe integer `t`, `Math.ceil(t / 10000)` equals this integer ceiling. A 1-tick remainder adds `1e-4` to a quotient below about `9e11`. Half an ulp there is `0.00006103515625` (ulp `0.0001220703125` at the largest safe quotient), and `0.0001` is larger, so the float rounds up to the next representable value and `Math.ceil` lands on the next micro. No safe integer is a counterexample, and this package does not claim one.

The tests at `9_007_199_254_740_000` → `900_719_925_474` and `9_007_199_254_740_001` → `900_719_925_475` are plain correctness checks (`k * 10000` and one tick above it, `k = 900_719_925_474`), both safe integers.

Mutant `F1-float-ceil-division` replaces the BigInt quotient and remainder with `BigInt(Math.ceil(Number(t) / 10_000))` and leaves raw-tick storage in place. It survived. That survival is equivalence on the safe-integer domain, not a missing test.

Mutant `F1-remainder-gt-becomes-gte` replaces `r > 0n` with `r >= 1n`. A non-negative remainder is either `0` or at least `1`, so the two predicates match. It survived. That is the same conversion, not a missing test.

## Seed format test

`node --test relay-bridge/julius-inworld-mission/julius-inworld-data-1/seed/format.test.mjs` still fails at load with ENOENT on `seed/out/normalized.json`. Same failure as at `fbd7192a`, `abf15cec`, and `1f687cca`. Pre-existing, unchanged, out of scope.
