# Julius worker deadline tests: prove the boundary on a clock the test owns

**Test-only hardening. No production code changed. Do not merge without fresh exact-head founder approval of `dde16322b3af76460c6a3b3a0bc7cb86b7dfc091`.**

| | |
|---|---|
| head | `dde16322b3af76460c6a3b3a0bc7cb86b7dfc091` |
| base | trusted `main` `237c32a24533635a4cc0c0a78956971ea7f11aab` |
| tree | `3a44531a5ccecda987852c58dda20d9d7edd4b2d` |
| shape | 1 commit, 1 file (`src/relay/mission/julius/julius-worker-deadline.test.ts`), +75 / −20; authored **and** committed by `julius-worker[bot]` |
| pushed by | the julius-worker App, through `ceremony/push-as-worker.sh`, not a founder credential |

---

## The flake

Test 8, *two workers with different declarations are cut at their own*, failed twice on Linux CI by exactly one millisecond. Both failures passed on rerun with nothing changed:

```
AssertionError: declared 30 must actually bound the wait: expected 29 to be greater than or equal to 30
```

The runs were `35070607489` (PR #272) and `35112610337` attempt 1 (`main` after #273).

## Root cause, measured rather than assumed

The test asserted `Date.now() - startedAt >= declared` around a real `setTimeout(declared)`. **Node does not promise that bound.**

| Evidence | Result |
|---|---|
| `Timeout._idleStart` across 2,000 timers | an **integer millisecond every time**: timers are armed at truncated loop time |
| real arm instant minus `_idleStart` (the truncation deficit) | 0 to 0.998 ms (p50 0.564, p90 0.842); 1,995 of 2,000 in [0, 1) |
| consequence | `setTimeout(30)` falls due as early as **29.002 ms** after the call, and `Date.now()` truncates independently, so it reports **29** |
| hypothesis refuted first: stale cached loop time | 60 ms of synchronous work before arming still fired at 30 ms or later, so Node refreshes loop time when arming |
| why only CI | Windows timers are coarse and fire late: 0 early fires in 300+ runs, and the original tests passed 12/12 locally. Linux timers fire precisely enough to expose the early edge. |

Test 2's `diag_elapsedMs >= 40` compares the coordinator's own `Date.now()` against a `setTimeout(40)`, so it has **the identical latent defect** and is fixed in the same change. Tests 10–15 and 17 sleep in real time but assert outcomes, not elapsed bounds, so they are unaffected and unchanged.

## The deterministic replacement

The boundary is **driven, not sampled**. Tests 2 and 8 fake only `setTimeout`, `clearTimeout` and `Date`, the three the deadline path touches, and require:

1. exactly **one** deadline timer is armed for the dispatch;
2. one millisecond before the declared deadline, it is still **pending**;
3. exactly at the declared deadline, it has **fired**;
4. the outcome is `RETRY` / `TIMEOUT`, `diag_timeoutMs` equals the declared number, and `diag_elapsedMs`, read from the coordinator's own clock, **equals** the declared number.

No sleep, no retry, no loosened bound, and no change to the production deadline. The kernel has no injectable timer to reuse: `JuliusClock` is `now(): string` and cannot schedule. So vitest fake timers were the most deterministic mechanism available without a production change. The repository already uses them in 23 places.

## It is stricter than what it replaces

Mutations applied to `dispatchWithinDeadline` in the production coordinator, each under an `EXIT` trap and reverted. The coordinator is byte-identical to trusted `main`.

| Mutation | Fixed tests | Original tests |
|---|---|---|
| `declaredTimeoutMs - 5` (cuts early) | **FAIL**: "must not cut before its own deadline"; elapsed 35 ≠ 40 | would fail |
| `declaredTimeoutMs * 2` (cuts late) | **FAIL**: "must cut exactly at its own deadline"; test 2 "must have fired at 40" | **PASS: blind to a late cut** |
| literal `30` for every worker | **FAIL**: "declared 120 must not cut before its own deadline"; elapsed 30 ≠ 40 | — |
| the real implementation | pass | pass |

## Repeated runs

The whole file ran **20 of 20** green on Windows, 10 of them with three processes pinning the CPU. Under fake timers the scheduler cannot move the result.

## Gates

Local, provider-free: `git diff --check` clean; no bare `if (…) return;` and no conditional skips (the `ci-test-accounting` shape); `relay-repository-boundary.mjs` exit 0.

Typecheck and the full suite, including the accounting and harness scanners, are left to `Relay CI` on this PR. The workstation had under 1 GB free while the Unreal editor was using 6.4 GB, and a local typecheck had already been memory-killed once today.

No provider was contacted.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01Vj7TKWqvdcoNL2Q7kNj8tY
