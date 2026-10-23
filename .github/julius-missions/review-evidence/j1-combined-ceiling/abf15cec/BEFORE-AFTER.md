# DEVELOPER-SUPPLIED EVIDENCE — not independent acceptance

Before/after for the same commands. Before is `fbd7192a420ac4feee0359e3fdcd585cff6b0e22` (logs in `../fbd7192a/`). After is `abf15cec3e9dc83f71d3dc809abd7d2fd624be60` (logs in this directory). Neither run is independent acceptance.

## Typecheck

| Commit | Result |
|---|---|
| fbd7192a | exit 0 |
| abf15cec | exit 0 |

## Vitest (the same 14 files)

| Commit | Test files | Tests |
|---|---|---|
| fbd7192a | 13 passed, 1 skipped (14) | 313 passed, 1 skipped, 0 failed (314) |
| abf15cec | 13 passed, 1 skipped (14) | 321 passed, 1 skipped, 0 failed (322) |

The skip at both commits is `relay-bridge/julius-local-shell-port.smoke.test.ts` (one test, `J1_REAL_SMOKE` unset).

| File | fbd7192a | abf15cec |
|---|---:|---:|
| julius-dispatch.test.ts | 81 | 81 |
| julius-dispatch-adapters.test.ts | 45 | 46 |
| julius-dispatch-wiring.test.ts | 41 | 41 |
| julius-dispatch-repeat-ceiling.test.ts | 17 | 22 |
| julius-dispatch-bundle.test.ts | 23 | 23 |
| julius-dispatch-source-scan.test.ts | 11 | 11 |
| julius-xai-direct-reviewer.test.ts | 11 | 13 |
| julius-frozen-checker.test.ts | 14 | 14 |
| julius-inworld-checker.test.ts | 19 | 19 |
| julius-key-store.test.ts | 11 | 11 |
| julius-architect-charter-parity.test.ts | 3 | 3 |
| julius-coder-isolation.test.ts | 11 | 11 |
| julius-local-shell-port.test.ts | 26 | 26 |
| julius-local-shell-port.smoke.test.ts | 1 skipped | 1 skipped |

The eight new tests, by title:

1. `a successful leg copies integer costUsdMicros from usage.cost_in_usd_ticks and does not price the token counts`
2. `keeps an explicit zero tick count and leaves a missing or unusable tick count absent, never zero`
3. `a real-shaped chain records only the xAI tick receipt, and the repeat stays spend_unknown`
4. `spendUnknownLegs above zero refuses even when every leg has a valid integer receipt`
5. `a non-integer, non-finite, negative, or unsafe costUsdMicros is refused and is not treated as zero` (1.5, NaN, +Infinity, -Infinity, -1, `MAX_SAFE_INTEGER + 1`, and the pair 1.5 and 2.5)
6. `an unsealed run is refused even when orderOk is true and every receipt is valid`
7. `admits exactly $30.00 with the production worst case and refuses one micro-dollar over as above_per_run`
8. `reaches combined_ceiling_exceeded only when the combined cap is lowered below actual plus the per-run worst case`

Other ceiling tests in that file were renamed so the title matches the frozen $30/$60 behavior. Those renames are not extra tests.

## Mutation

The original reviewer list of 10 mutants was not in the tree and is not reconstructed. Both harnesses are ad hoc and committed next to these logs.

| Commit | Harness | Killed | Survived |
|---|---|---:|---:|
| fbd7192a | 13 ceiling edits | 10 | 3 (M5 spendUnknownLegs, M8 per-leg isSafeInteger, M11 sealed) |
| abf15cec | 14 ceiling edits + 5 xAI receipt edits (19) | 18 | 1 (M8a, per-leg isSafeInteger only) |

M5 and M11 are killed at `abf15cec`. M8b (both safe-integer checks removed) is killed. M8a, the per-leg-only deletion, still survives because the running-sum `Number.isSafeInteger` check refuses the same non-integer values. The ceiling decision logic was not edited.

## Seed format test

| Commit | Result |
|---|---|
| fbd7192a | exit 1, ENOENT on `seed/out/normalized.json` at load |
| abf15cec | exit 1, same ENOENT |

Pre-existing, unchanged, out of scope.

## Coder receipt

Unchanged at both commits. Wired mode `CLAUDE_SUBSCRIPTION`. `hostedCoderCost` returns `costUsdMicros: null`. The success adapter does not invent a dollar figure. Repeats of a real-shaped chain stay refused.
