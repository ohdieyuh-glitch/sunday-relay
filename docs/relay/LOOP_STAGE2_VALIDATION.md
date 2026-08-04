# Loop Engine — Stage 2 validation and dependency-gate findings

Recorded 2026-08-04 on branch `relay/loop-engine`, worktree
`~/sunday-relay-loop-engine`, on a 2-core / 2.7 GB box shared by three active
Relay sessions and no swap. The contention matters and is reported rather than
smoothed over: it is the cause of every non-dependency failure below.

## The dependency gate

`relay-bridge/hosted-coding-agent/hosted-coding-agent.test.ts >
readiness is free and offline > resolves BOTH package shapes against the
really-installed SDK`

**Verdict: environmental base failure. Not caused by this branch.**

Cause, established rather than assumed:
`node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/` exists but contains
only a `claude` binary and **no `package.json`**. The probe in
`hosted-readiness.ts` resolves that package by manifest, which cannot succeed
against a directory that has no manifest, so `runtimeBinaryPresent` is `false`.

Proven by **Option B** — reproduction against untouched `origin/main` under the
identical dependency installation:

1. A disposable worktree was created at `origin/main` (`2252731`).
2. This worktree's `node_modules` was symlinked into it, so the installation
   condition was byte-identical rather than merely similar.
3. The same test failed there with the same assertion.
4. The disposable worktree was removed and pruned.

Corroborating evidence:

- This branch changes **zero** files under `relay-bridge/`, and **zero**
  dependency files (`package.json`, `package-lock.json`) —
  `git diff --name-only origin/main..HEAD` over those paths is empty.
- The test file itself is unchanged since `origin/main` commit `2252731`.

The test was **not** skipped, weakened, or given a fake manifest, and no
production resolution logic was altered to accommodate the broken install.
Repairing the installation (Option A) is a founder-gated action because it
mutates a shared `node_modules` that other sessions are actively testing
against.

## Complete suite

```
Test Files  5 failed | 200 passed (205)
     Tests  5 failed | 4396 passed (4401)
  Duration  4272.01s
```

The same suite took **685s** earlier the same day when the box was quiet. The
6× slowdown is another session running a full suite concurrently with
`--max-old-space-size=1200`.

**Zero Loop files failed.**

### The five failures, classified

| File | Classification | Evidence |
|---|---|---|
| `hosted-coding-agent.test.ts` | Environmental dependency | Reproduced at untouched `origin/main` (above) |
| `coding-agent-cli.test.ts` | Timeout | Passes 9/9 in isolation |
| `supervised/supervised.test.ts` | Timeout | Passes 9/9 in isolation |
| `RelayDemoMissionSummary.test.tsx` | Timeout | Passes with `--testTimeout=300000` |
| `ui/preview/app-flow.test.tsx` | Timeout | Passes with `--testTimeout=300000` |

The last two were re-run together: **18/18 passed**. Three of the four
timeouts exceeded even a 120s per-test timeout during the contended full-suite
run; one exceeded the 5s default. None is an assertion failure.

## Everything else

| Check | Result |
|---|---|
| App typecheck (`tsc -b --noEmit`) | exit 0 |
| Bridge typecheck | exit 0 |
| Website build (`npm run build`) | exit 0 |
| CLI build (`relay:build`) | exit 0 |
| Bridge build (`relay:bridge:build`) | exit 0 |
| Surface parity | PASS — 220/220 files, 26 CLI commands |
| Strict surface parity | PASS |
| Repository boundary scanner (secret + artifact shape) | PASS |
| Core boundary | 66/66 |
| UI boundary | 5/5 |
| Browser boundary | 41/41 |
| `git diff --check origin/main..HEAD` | clean |
| Tracked artifacts after builds | none |

### A note on the aggregate typecheck

`npm run typecheck` (which chains both projects) was **OOM-killed** (exit 137)
twice while the box had ~1 GB free across three sessions. Run separately, and
with `--max-old-space-size=600`, both projects typecheck clean. That is a
memory limit on this machine, not a type error — the same check passed
unbounded earlier the same day when memory was free.

### A note on two boundary tests

`Relay Core … never import the Node persistence implementation` and
`no browser module reaches the Node persistence layer through a re-export
chain` first reported as failures, having taken 31s and 296s against a 5s
default timeout. Re-run on a quieter box the first takes **480ms** and the
whole file passes in **6.15s**, 66/66. Contention, not a graph this branch
made expensive.

## External, provider and paid calls

**Zero** of each, across every Loop test and every proof. The only agent
adapter in this build is the deterministic scripted fake, which is
structurally prevented from reaching a network, a process, a provider SDK, a
credential or a real clock — asserted by a test that reads its source.
