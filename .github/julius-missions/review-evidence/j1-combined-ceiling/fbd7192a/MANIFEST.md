# DEVELOPER-SUPPLIED EVIDENCE — not independent acceptance

Evidence collected at commit `fbd7192a420ac4feee0359e3fdcd585cff6b0e22` before any product-code change in this run. The tree of that commit is `8487fb3c408f2d05567fd55e8f9aa1183a6b1e16`. These logs are not part of that tree; they were produced by checking that commit out and running the commands below.

| Item | Value |
|---|---|
| Date (UTC) | 2026-10-23T07:18:15Z (logs from 2026-10-23T07:11:58Z through 2026-10-23T07:17:57Z) |
| OS | Linux 6.12.94+ x86_64 GNU/Linux |
| Node | v22.23.4 |
| npm | 10.9.9 |
| Commit | `fbd7192a420ac4feee0359e3fdcd585cff6b0e22` |
| Tree | `8487fb3c408f2d05567fd55e8f9aa1183a6b1e16` |

## Typecheck — pass

Command:

```
npm run typecheck
```

That script is `tsc -b --noEmit && tsc -p relay-bridge/tsconfig.json --noEmit && tsc -p relay-hermes-service/tsconfig.json --noEmit && tsc -p scripts/tsconfig.json --noEmit`.

Result: exit 0. Log: `typecheck.log`.

## Vitest — 313 passed / 1 skipped / 0 failed

Command:

```
npx vitest run --reporter=default --reporter=json --outputFile=/tmp/j1-vitest-fbd7192a.json \
  relay-bridge/julius-dispatch.test.ts \
  relay-bridge/julius-dispatch-adapters.test.ts \
  relay-bridge/julius-dispatch-wiring.test.ts \
  relay-bridge/julius-dispatch-repeat-ceiling.test.ts \
  relay-bridge/julius-dispatch-bundle.test.ts \
  relay-bridge/julius-dispatch-source-scan.test.ts \
  relay-bridge/julius-xai-direct-reviewer.test.ts \
  relay-bridge/julius-frozen-checker.test.ts \
  relay-bridge/julius-inworld-checker.test.ts \
  relay-bridge/julius-key-store.test.ts \
  relay-bridge/julius-architect-charter-parity.test.ts \
  relay-bridge/julius-coder-isolation.test.ts \
  relay-bridge/julius-local-shell-port.test.ts \
  relay-bridge/julius-local-shell-port.smoke.test.ts
```

Result: Test Files 13 passed | 1 skipped (14). Tests 313 passed | 1 skipped (314). Exit 0. The skipped test is the opt-in smoke in `relay-bridge/julius-local-shell-port.smoke.test.ts` (`J1_REAL_SMOKE` was not set). Logs: `vitest.log`, `vitest.json`.

## Mutation check — not the reviewer's original harness

No mutation harness was in the tree at `fbd7192a`. The independent reviewer's original 10-mutant list was not available to reproduce exactly, so this directory does not present a reconstructed list as if it were that original.

`mutate-repeat-ceiling.mjs` is an ad hoc harness written for this evidence. It applies one textual edit at a time to `relay-bridge/julius-dispatch-repeat-ceiling.ts`, runs `npx vitest run relay-bridge/julius-dispatch-repeat-ceiling.test.ts --reporter=verbose`, then restores the file and checks its sha256 (`870090be098e32cfb49134be21dcccbf736e2d50c93e8cc14e0f964c0a4dc34f`).

Command:

```
node .github/julius-missions/review-evidence/j1-combined-ceiling/fbd7192a/mutate-repeat-ceiling.mjs
```

Result: 13/13 matched expectation. Exit 0. Log: `mutation.log`.

Killed by the tests at this commit (10):

- M1 per-run env `Math.min` changed to `Math.max`
- M2 combined env `Math.min` changed to `Math.max`
- M3 `repeatWorstCaseUsdMicros` returns the estimate envelope
- M4 per-run comparison `>` changed to `>=`
- M6 combined comparison `>` changed to `>=`
- M7 a non-integer or negative `costUsdMicros` counts as 0
- M9 `roleCount <= 0` changed to `< 0`
- M10 a not-contacted null cost is no longer treated as zero
- M12 a second prior run is allowed (`starts.length > 2`)
- M13 the frozen ceiling applies to every mission id

Survived at this commit (3). These are the reviewer checks that no current test fails when removed:

- M5 `spendUnknownLegs > 0` changed to `> 99`
- M8 `Number.isSafeInteger` removed from the `costUsdMicros` guard
- M11 the `sealed` conjunct removed from the receipt check

An earlier local attempt in this same session dropped M5 so that ten mutants would all show as killed. That log was discarded. It is not this evidence.

## Seed format test — pre-existing failure, out of scope

Command:

```
node --test relay-bridge/julius-inworld-mission/julius-inworld-data-1/seed/format.test.mjs
```

Result: exit 1. The file fails at load with `ENOENT` opening `seed/out/normalized.json` (resolved next to the test file). This is pre-existing, unchanged, and out of scope. Log: `seed-format.test.log`.

## Coder receipt under the current wiring

No product code is changed in this commit. The wired coder auth mode is `CLAUDE_SUBSCRIPTION` (`relay-bridge/julius-dispatch-wiring-real.ts` line 30). In that mode `hostedCoderCost` returns `costUsdMicros: null` (`relay-bridge/julius/claude-code-coding-provider.ts` lines 84-86). This run does not switch that wiring and does not treat `total_cost_usd` as a bill. Under the current wiring the coder leg cannot produce a provider dollar receipt, so a repeat stays refused.

At this commit, successful architect (`julius-dispatch-adapters.ts` lines 112-116), coder (lines 396-411), and Hermes reviewer (lines 476-484) legs, and the xAI reviewer (`julius-xai-direct-reviewer.ts` line 128), do not set `costUsdMicros`. The controller stores null at `julius-dispatch.ts` line 547. The coder failure path can copy `outcome.costUsdMicros`; the subscription cost function sets that to null.
