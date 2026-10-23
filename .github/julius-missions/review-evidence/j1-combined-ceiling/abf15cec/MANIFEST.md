# DEVELOPER-SUPPLIED EVIDENCE — not independent acceptance

Evidence collected at commit `abf15cec3e9dc83f71d3dc809abd7d2fd624be60`. The tree of that commit is `c28255391dd550bbd813ab07282a879c73613748`. These logs are not part of that tree; they were produced by running the commands below with that commit checked out and the working tree otherwise clean. This is not an independent acceptance run.

`abf15cec` differs from `29d08713d3f3312c8dbb9cd9379ee6e7e1a1bc05` (tree `44c2eb81a09e083811d38969eee0aadfc95bb274`) by a comment in `relay-bridge/julius-dispatch-repeat-ceiling.test.ts` only. The comment had said that removing the per-leg `Number.isSafeInteger` conjunct would verify legs of 1.5 and 2.5 as 4. That sentence was wrong: the running-sum check still refuses the first 1.5. The ceiling module and the xAI adapter are byte-identical to `29d08713`.

| Item | Value |
|---|---|
| Date (UTC) | 2026-10-23T07:28:49Z (logs from 2026-10-23T07:27:47Z through 2026-10-23T07:28:41Z) |
| OS | Linux 6.12.94+ x86_64 GNU/Linux |
| Node | v22.23.4 |
| npm | 10.9.9 |
| Commit | `abf15cec3e9dc83f71d3dc809abd7d2fd624be60` |
| Tree | `c28255391dd550bbd813ab07282a879c73613748` |
| Ceiling source sha256 | `cc0c42c7c0f7a4fd6e28dbb9587cb3cc64b30d9019b7061275623798dd177dcb` |
| xAI reviewer source sha256 | `f0fbe997c9d356022a2ac04ecef458b498a866c4f82cb4fec0b8066f82842f29` |

## Typecheck — pass

Command:

```
npm run typecheck
```

That script is `tsc -b --noEmit && tsc -p relay-bridge/tsconfig.json --noEmit && tsc -p relay-hermes-service/tsconfig.json --noEmit && tsc -p scripts/tsconfig.json --noEmit`.

Result: exit 0. Started 2026-10-23T07:27:47.058Z, ended 2026-10-23T07:28:18.688Z. Log: `typecheck.log`.

## Vitest — 321 passed / 1 skipped / 0 failed

Command:

```
npx vitest run --reporter=default --reporter=json --outputFile=/tmp/j1-vitest-abf15cec.json \
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

Result: Test Files 13 passed | 1 skipped (14). Tests 321 passed | 1 skipped (322). Exit 0. The JSON report records `numPassedTests` 321, `numFailedTests` 0, `numPendingTests` 1, `numTotalTests` 322. The skipped test is the opt-in smoke in `relay-bridge/julius-local-shell-port.smoke.test.ts` (`J1_REAL_SMOKE` was not set). Started 2026-10-23T07:27:47.052Z; vitest printed start 07:27:47 and duration 1.69s. Logs: `vitest.log`, `vitest.json`.

Compared with the same command at `fbd7192a` (313 passed / 1 skipped / 0 failed): +8 tests. `julius-xai-direct-reviewer.test.ts` 11 → 13, `julius-dispatch-adapters.test.ts` 45 → 46, `julius-dispatch-repeat-ceiling.test.ts` 17 → 22. Every other file in the suite has the same count. See `BEFORE-AFTER.md`.

## Mutation check — ad hoc harness, not the reviewer's original list

No mutation harness was in the tree at `fbd7192a`. The independent reviewer's original 10-mutant list was not available, and it is not reconstructed here. The `fbd7192a` directory records a different ad hoc set of 13 edits (10 killed, and M5, M8, and M11 survived). This directory's `mutate-repeat-ceiling.mjs` keeps those ceiling edits, records the new expectation for M5 and M11, splits the old M8 into M8a and M8b, and adds five xAI receipt mutants.

The harness applies one mutant at a time, runs vitest, restores the file, and checks sha256. Ceiling mutants run `npx vitest run relay-bridge/julius-dispatch-repeat-ceiling.test.ts --reporter=verbose`. xAI mutants run that plus `relay-bridge/julius-xai-direct-reviewer.test.ts` and `relay-bridge/julius-dispatch-adapters.test.ts`. Exit 0 means every mutant matched its recorded expectation, including the one expected to survive.

Command:

```
node .github/julius-missions/review-evidence/j1-combined-ceiling/abf15cec/mutate-repeat-ceiling.mjs
```

Result: 19/19 matched expectation. 18 killed, 1 survived. Exit 0. Started 2026-10-23T07:28:27Z, ended 2026-10-23T07:28:41Z. After the run, `git diff` on `julius-dispatch-repeat-ceiling.ts` and `julius-xai-direct-reviewer.ts` was empty and the sha256 values above matched the harness output. Log: `mutation.log`.

Killed (18):

- M1 per-run env `Math.min` changed to `Math.max`
- M2 combined env `Math.min` changed to `Math.max`
- M3 `repeatWorstCaseUsdMicros` returns the estimate envelope
- M4 per-run comparison `>` changed to `>=`
- M5 `spendUnknownLegs > 0` changed to `> 99`
- M6 combined comparison `>` changed to `>=`
- M7 a non-integer or negative `costUsdMicros` counts as 0
- M8b both `Number.isSafeInteger` checks removed (the per-leg conjunct and the running-sum check)
- M9 `roleCount <= 0` changed to `< 0`
- M10 a not-contacted null cost is no longer treated as zero
- M11 the `sealed` conjunct removed from the receipt check
- M12 a second prior run is allowed (`starts.length > 2`)
- M13 the frozen ceiling applies to every mission id
- F1-success-omits-tick-receipt: the success return drops `costUsdMicros`
- F1-missing-ticks-become-zero: invalid or missing ticks return 0
- F1-cost-taken-from-input-tokens: `costUsdMicros` is set from `input_tokens`
- F1-fractional-ticks-are-rounded: a tick count not divisible by 10_000 is rounded into micros
- F1-negative-ticks-become-zero: negative ticks return 0

Survived (1):

- M8a deletes only `!Number.isSafeInteger(leg.costUsdMicros)` and leaves the running-sum check in place. Expectation recorded in the harness: survived. Actual: survived.

M8a is the reviewer's per-leg `Number.isSafeInteger` mutant. It still survives. After each addition, `verifyRun1Spend` refuses when `!Number.isSafeInteger(sum)` (`julius-dispatch-repeat-ceiling.ts` line 147). That backstop refuses 1.5, NaN, Infinity, and a value above `MAX_SAFE_INTEGER` even if the per-leg conjunct is gone. A negative cost is refused by `costUsdMicros < 0`, which M8a does not remove. Two legs of 1.5 and 2.5 still fail on the first add, so that fixture does not kill M8a either. M8b, which removes both safe-integer checks, is killed by those fixtures. The ceiling module was not changed to make M8a observable on its own. F3 forbids a logic change there. This package does not claim the reviewer's exact M8 mutant was caught.

## Seed format test — pre-existing failure, out of scope

Command:

```
node --test relay-bridge/julius-inworld-mission/julius-inworld-data-1/seed/format.test.mjs
```

Result: exit 1. The file fails at load with `ENOENT` opening `seed/out/normalized.json` (resolved next to the test file). The same failure is in the `fbd7192a` evidence. It is pre-existing, unchanged, and out of scope. Log: `seed-format.test.log`.

## Where a dollar receipt comes from at this commit

`costUsdMicros` is set only from a dollar amount the provider response itself returns. Token counts are not priced. A missing, non-integer, negative, or non-finite amount is left absent and is never stored as 0.

- Architect, successful leg (`julius-dispatch-adapters.ts` lines 112-116). OpenAI Responses usage on `GptRunOutcome` is token counts only. The success return does not set `costUsdMicros`.
- Coder, successful leg (`julius-dispatch-adapters.ts` lines 397-415). The wired auth mode is `CLAUDE_SUBSCRIPTION` (`julius-dispatch-wiring-real.ts` line 30). In that mode `hostedCoderCost` returns `costUsdMicros: null` (`julius/claude-code-coding-provider.ts` lines 84-86), including when `total_cost_usd` is present. That figure is a priced estimate, not a bill, and this adapter does not copy it and does not derive a dollar cost from tokens. The failure path at line 339 still copies `outcome.costUsdMicros`, which the subscription cost function sets to null. This run does not switch the wiring and does not work around the null. Under the current wiring the coder leg cannot produce a provider dollar receipt, so a repeat stays refused.
- Hermes reviewer, successful leg (`julius-dispatch-adapters.ts` lines 480-490). `costMicros` / `estimated_cost` is a harness estimate. It is not copied onto `costUsdMicros`.
- xAI reviewer (`julius-xai-direct-reviewer.ts`). `costUsdMicrosFromXaiTicks` (lines 51-56) reads `usage.cost_in_usd_ticks`. One USD is 10_000_000_000 ticks, so one micro-USD is 10_000 ticks. The tick count is copied into `costUsdMicros` only when it is a non-negative safe integer divisible by 10_000. Otherwise the field is omitted. The value is applied where usage is parsed (line 123), forwarded by `paid()` when it is a number (lines 104-108), and set on the success return (line 143). An explicit 0 tick count is a real zero receipt.

The controller still stores `costUsdMicros: out.costUsdMicros ?? null` (`julius-dispatch.ts` line 550; the reviewer cited line 547 at `fbd7192a`, before the header comment grew). A real-shaped chain still has null architect and coder receipts, so a repeat of that chain is `julius_dispatch_repeat_spend_unknown`.
