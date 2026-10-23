# DEVELOPER-SUPPLIED EVIDENCE — not independent acceptance

Evidence at code commit `1f687cca1d43f304cc0c43d69bd196689996c8ec`. Tree `c3782c39419a862a9ed2218f711bf1f14400c084`. These logs are not part of that tree. They do not replace independent reproduction. The call shape, the integer conversion, and the float-division equivalence are in `README.md`.

| Item | Value |
|---|---|
| Date (UTC) | 2026-10-23T07:49:42Z (logs from 2026-10-23T07:48:24Z through 2026-10-23T07:49:26Z) |
| OS | Linux 6.12.94+ x86_64 GNU/Linux |
| Node | v22.23.4 |
| npm | 10.9.9 |
| Commit | `1f687cca1d43f304cc0c43d69bd196689996c8ec` |
| Tree | `c3782c39419a862a9ed2218f711bf1f14400c084` |
| Ceiling source sha256 | `cc0c42c7c0f7a4fd6e28dbb9587cb3cc64b30d9019b7061275623798dd177dcb` |
| xAI reviewer source sha256 | `7f91658b1d2ded710c0d41cba97e8ff0da0c6c1569308d39a11eed61c4e66e68` |

The live xAI path is UNTESTED. No real response was captured.

## Log checksums

| File | SHA-256 |
|---|---|
| `typecheck.log` | `6c748bb0f5ac22f97c0696d5243f81b8230f47c741863d783e59719d6d1169df` |
| `vitest.log` | `6490b9646de3d13c9ea05b61a14a8403d53b1f00bc35d9e7cf0816b742d5e348` |
| `vitest.json` | `a0b1b3dbd8014dff123c7417ca120b5d026304eca1d56e695909becad4b55fe5` |
| `mutation.log` | `f6b197ff43880c19281607bf9c640b6bad51f3e234606779f30e441942daca1d` |
| `grep.log` | `f6e8beffca149efa08c57b02ed305dc06b80258cbe8424fad0a40cdd6f7e034a` |
| `seed-format.test.log` | `f8bd887ee2da43cc7df860cf80e0bc29346a21c9cdedd9c638b126ca48293b70` |

## Typecheck — pass

```
npm run typecheck
```

`tsc -b --noEmit && tsc -p relay-bridge/tsconfig.json --noEmit && tsc -p relay-hermes-service/tsconfig.json --noEmit && tsc -p scripts/tsconfig.json --noEmit`. Exit 0. 2026-10-23T07:48:24.333Z–07:48:57.288Z. Log: `typecheck.log`.

## Vitest — 324 passed / 1 skipped / 0 failed

```
npx vitest run --reporter=default --reporter=json --outputFile=/tmp/j1-vitest-1f687cca.json \
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

Test Files 13 passed | 1 skipped (14). Tests 324 passed | 1 skipped (325). JSON: `numPassedTests` 324, `numFailedTests` 0, `numPendingTests` 1, `numTotalTests` 325. The skip is `relay-bridge/julius-local-shell-port.smoke.test.ts` (`J1_REAL_SMOKE` unset). Started 2026-10-23T07:48:24.333Z, duration 2.11s. Logs: `vitest.log`, `vitest.json`.

Same command at `abf15cec`: 321 passed | 1 skipped | 0 failed. The three added tests are two in `julius-xai-direct-reviewer.test.ts` (13 → 15) and one in `julius-dispatch-adapters.test.ts` (46 → 47). Every other file in the suite is unchanged.

On the red test commit `66c9841f359ce06af00f0be8adeeca5a3ba7bcdc`, before the conversion, those two files were 4 failed | 58 passed (62):

- `rounds cost_in_usd_ticks up to integer micros...` — `158_500` produced no `costUsdMicros` and no `costUsdTicksRaw` (expected 16 and 158500).
- `over-states a safe tick count...` — `costUsdTicksRaw` was undefined for ticks `0`.
- `a real-shaped chain records only the xAI tick receipt...` — the architect result row had no `costUsdTicksRaw` key.
- `rounds a 158_500 tick response up to 16 micros on the ledger...` — reviewer `costUsdMicros` was null and `costUsdTicksRaw` was absent.

Already passing on that red commit: invalid ticks stay null, and an SSE body or a body with no top-level `usage` produces no receipt.

## Mutation — 24/24 matched expectation

```
node .github/julius-missions/review-evidence/j1-combined-ceiling/1f687cca/mutate-repeat-ceiling.mjs
```

22 killed, 2 survived. Exit 0, because both survivors were the recorded expectation. 2026-10-23T07:49:07Z–07:49:26Z. After the run, `git diff` on the ceiling and xAI sources was empty and the sha256 values above matched the harness. Log: `mutation.log`.

Survived:

- `M8a-per-leg-safe-integer-removed`. The running-sum `Number.isSafeInteger` check still refuses the fixtures. Same fact as at `abf15cec`.
- `F1-float-ceil-division`. `Math.ceil(t / 10000)` matches the integer ceiling for every safe integer. Equivalence, not a test gap. See `README.md`.

Killed: M1–M7, M8b, M9–M13, and `F1-success-omits-tick-receipt`, `F1-missing-ticks-become-zero`, `F1-cost-taken-from-input-tokens`, `F1-ceil-becomes-floor`, `F1-ceil-becomes-round`, `F1-remainder-check-dropped`, `F1-drop-raw-ticks`, `F1-accept-negative`, `F1-accept-non-integer`.

## Seed format test — pre-existing, out of scope

```
node --test relay-bridge/julius-inworld-mission/julius-inworld-data-1/seed/format.test.mjs
```

Exit 1. ENOENT on `seed/out/normalized.json`. Log: `seed-format.test.log`.
