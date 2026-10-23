# DEVELOPER-SUPPLIED EVIDENCE — not independent acceptance

Evidence at code commit `22a0a9cb2cc93f64929f1dd855aa242936f739e9`. Tree `5e6bdf5b23aab307bd3f73150c5073af62c082bd`. These logs are not part of that tree. They do not replace independent reproduction. The call shape, the integer conversion, and the two equivalent survivors are in `README.md`.

| Item | Value |
|---|---|
| Date (UTC) | 2026-10-23T08:14:31Z (logs from 2026-10-23T08:10:13Z through 2026-10-23T08:13:04Z) |
| OS | Linux 6.12.94+ x86_64 GNU/Linux |
| Node | v22.23.4 |
| npm | 10.9.9 |
| Code commit | `22a0a9cb2cc93f64929f1dd855aa242936f739e9` |
| Code tree | `5e6bdf5b23aab307bd3f73150c5073af62c082bd` |
| Test commit | `cad2097eaf6fd602dd6a9bcf2761d8f45717abc3` |
| Ceiling source sha256 | `cc0c42c7c0f7a4fd6e28dbb9587cb3cc64b30d9019b7061275623798dd177dcb` |
| xAI reviewer source sha256 | `9c7caadd79e72a5c7d7962482b6fd3c734909d0201c9dd3c9b32ab62e6b22d72` |

The ceiling sha256 is the same value recorded at `1f687cca`. This head does not change that file. The xAI sha256 changed because the header at lines 15-17 now says the tick field is unverified. The conversion function is the same.

The live xAI path is UNTESTED. No real response was captured.

## Log checksums

| File | SHA-256 |
|---|---|
| `typecheck.log` | `6c748bb0f5ac22f97c0696d5243f81b8230f47c741863d783e59719d6d1169df` |
| `vitest.log` | `c292a3b8d255d7bf9e76104a87bf40b3584ded94dda597e229511154f83bee66` |
| `vitest.json` | `07b31c9a80460ec4d717d68cefa9fcb7ae79367b2eaca7a5dcd725b4f5623063` |
| `mutation.log` | `d0135e5b66a24914080457878be1edb8b258d88bd6c62e089fbe2dd8a488d2be` |
| `grep.log` | `793ba84da4435b24f5132150a626d4a67b86d4462a0d6f8852197ea519b9041c` |
| `seed-format.test.log` | `c90098bf41c8e503a073851367e0bcb5726ac9bfbff5404ec994015fea2e03b1` |

## Typecheck — pass

```
npm run typecheck
```

`tsc -b --noEmit && tsc -p relay-bridge/tsconfig.json --noEmit && tsc -p relay-hermes-service/tsconfig.json --noEmit && tsc -p scripts/tsconfig.json --noEmit`. Exit 0. 2026-10-23T08:10:13.471Z–08:10:47.592Z. Log: `typecheck.log`.

## Vitest — 327 passed / 1 skipped / 0 failed

```
npx vitest run --reporter=default --reporter=json --outputFile=/tmp/j1-vitest-22a0a9cb.json \
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

Test Files 13 passed | 1 skipped (14). Tests 327 passed | 1 skipped (328). JSON: `numPassedTests` 327, `numFailedTests` 0, `numPendingTests` 1, `numTotalTests` 328. The skip is `relay-bridge/julius-local-shell-port.smoke.test.ts` (`J1_REAL_SMOKE` unset). Started 2026-10-23T08:10:13Z, duration 2.19s. Logs: `vitest.log`, `vitest.json`.

Same command at `1f687cca`: 324 passed | 1 skipped | 0 failed. The three added `it` blocks are two in `julius-dispatch-repeat-ceiling.test.ts` (22 → 24) and one in `julius-xai-direct-reviewer.test.ts` (15 → 16). Adapters stays 47. The `1e16` assertion is inside the existing invalid-ticks test.

On the unmutated tree those three tests pass. Each one fails when its mutant is applied by itself (`mutation.log`):

| Mutant | Only failing test | Result the mutant produced |
|---|---|---|
| `F-a-per-leg-safe-integer-removed` (same edit as `M8a`) | `refuses a non-integer leg when the total of the legs is still a safe integer` | 1 failed \| 23 passed. Verified `{ verified: true, actualUsdMicros: 30000000 }`. The `1.5 + 2.5` test stayed green. |
| `F-b-running-sum-safe-integer-removed` | `refuses two Number.MAX_SAFE_INTEGER legs because their sum is not a safe integer` | 1 failed \| 23 passed. Per-leg check left intact. Verified `{ verified: true, actualUsdMicros: 18014398509481982 }`. |
| `N1-paid-omits-tick-receipt` | `a refused 200 still carries costUsdMicros and costUsdTicksRaw when the ticks were valid` | 1 failed \| 62 passed across the xAI and adapter files. `costUsdMicros: 16` and `costUsdTicksRaw: 158500` were absent. |

## Mutation — 28/28 matched expectation

```
node .github/julius-missions/review-evidence/j1-combined-ceiling/22a0a9cb/mutate-repeat-ceiling.mjs
```

26 killed, 2 survived. Exit 0, because both survivors were the recorded expectation. 2026-10-23T08:12:42Z–08:13:04Z. After the run, `git diff` on the ceiling and xAI sources was empty and the sha256 values above matched the harness. Log: `mutation.log`.

| Mutant | Expectation | Result |
|---|---|---|
| `M1-per-run-env-can-raise` | killed | killed |
| `M2-combined-env-can-raise` | killed | killed |
| `M3-worst-case-is-estimate-envelope` | killed | killed |
| `M4-exact-per-run-refused` | killed | killed |
| `M5-spend-unknown-count-ignored` | killed | killed |
| `M6-exact-combined-refused` | killed | killed |
| `M7-missing-cost-counts-as-zero` | killed | killed |
| `M8a-per-leg-safe-integer-removed` | killed | killed. Same edit as F-a. Survived at `1f687cca` because the running-sum check caught `1.5` and `1.5 + 2.5`. |
| `F-a-per-leg-safe-integer-removed` | killed | killed. Same edit as M8a. |
| `F-b-running-sum-safe-integer-removed` | killed | killed. Deletes only `julius-dispatch-repeat-ceiling.ts:147`. |
| `M8b-both-safe-integer-checks-removed` | killed | killed. Deletes the per-leg conjunct and the running-sum check. This is not F-b. |
| `M9-zero-role-count-still-bounds` | killed | killed |
| `M10-not-contacted-null-is-unknown` | killed | killed |
| `M11-sealed-check-removed` | killed | killed |
| `M12-second-prior-run-allowed` | killed | killed |
| `M13-other-mission-uses-frozen-ceiling` | killed | killed |
| `F1-success-omits-tick-receipt` | killed | killed |
| `F1-missing-ticks-become-zero` | killed | killed |
| `F1-cost-taken-from-input-tokens` | killed | killed |
| `F1-ceil-becomes-floor` | killed | killed |
| `F1-ceil-becomes-round` | killed | killed |
| `F1-remainder-check-dropped` | killed | killed |
| `F1-float-ceil-division` | survived | survived. Equivalent on safe integers. Not a test gap. |
| `F1-remainder-gt-becomes-gte` | survived | survived. `r >= 1n` matches `r > 0n` for a non-negative remainder. Not a test gap. |
| `N1-paid-omits-tick-receipt` | killed | killed |
| `F1-drop-raw-ticks` | killed | killed |
| `F1-accept-negative` | killed | killed |
| `F1-accept-non-integer` | killed | killed |

## Seed format test — pre-existing, out of scope

```
node --test relay-bridge/julius-inworld-mission/julius-inworld-data-1/seed/format.test.mjs
```

Exit 1. ENOENT on `seed/out/normalized.json`. 2026-10-23T08:10:13Z. Log: `seed-format.test.log`.
