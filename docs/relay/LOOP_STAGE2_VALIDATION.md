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
| Surface parity | PASS — 220/220 files, 26 CLI commands (at `777d690`; 230/230 and 27 after the Stage 2 surfaces landed) |
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

---

## Resolution — 2026-08-04, execution session

### The dependency gate is REPAIRED, and the earlier diagnosis was right

The diagnosis above was correct and the reproduction was sound. It was
incomplete in one respect, which is what made the repair look founder-gated:
the `claude` binary in this worktree was **not merely missing its manifest, it
was truncated** — 205 467 830 bytes against the complete 275 012 592. An
interrupted download on a volume that is 94 % full, not a packaging quirk.

It was also **not shared**. Every worktree carries its own `node_modules`;
`~/sunday-relay-hermes-service` and `~/sunday-relay-mcp-foundation` both held
complete, correct copies of the same version (`0.3.220`, matching
`package-lock.json`). Only this worktree's copy was broken, so repairing it
could not disturb another session — the reason the earlier session held back
does not apply.

**What was done:** the truncated file was removed and the complete one from
`~/sunday-relay-hermes-service` was **hardlinked** in (same filesystem, so zero
additional disk on a nearly-full volume), and the three missing metadata files
were copied. `cmp` reports the two binaries identical. No production resolution
logic was altered, no manifest was fabricated, and no test was skipped or
weakened — the install is simply correct now.

### What Stage 2 was still missing, and now is not

The suite result above was accurate and the branch was still incomplete, in a
way a passing suite could not show: **three things existed with nothing
connecting them.**

| Existed, with tests | Missing |
|---|---|
| `src/relay/ui/loop/loop-run-view.ts` — the projection of a running Loop | any component that rendered it |
| `src/relay/cli/loop-execution.ts` — every execution command, behind a port | any implementation of that port |
| a durable single-Loop runtime and authenticated bridge routes | anything in argv that reached them |

A projection nothing renders is a surface that exists in the repository and not
in the product — precisely the condition the MCP milestone's reachability check
was built to catch. Added:

- `RelayLoopRunPanel.tsx` and its host, where **restoration is a read, not a
  cache**: the browser persists only `{runId, loopId}` and fetches the rest, so
  a finished run cannot come back from a refresh still looking alive. Only the
  server's own state class may animate, and a control with no handler is not
  drawn at all;
- `src/relay/loop-bridge-client/` — the missing adapter, reusing the Reviewer
  client's target validation rather than copying it, because a second copy of a
  control that decides where a bearer token may be sent is the copy that drifts;
- `src/relay/cli/loop-run-cli.ts` — the argv seam. Reads and controls of a
  **named** run reach the bridge; drafts keep going to the preview; a control
  needs `--authorize` **and** a caller-minted `--idempotency-key`, because an id
  the CLI generated would be new on every attempt and a retry after a timeout
  would arrive as a second decision;
- a `loop-run-observation` capability entry, so the parity gate holds the new
  surface to being reachable rather than merely present.

### Documentation that had stopped being true

`LOOP_ENGINE.md` still said **"RUNTIME NOT IMPLEMENTED"** three commits after
the runtime landed, and the Loop overview said "no Loop has ever run" and "Loop
execution is not implemented in this build". A stale status line is the same
defect as a comment claiming a gate the code does not have, pointed the other
way — and it is worse here, because it invites the next session to rebuild
something that exists. All three now state the four separate facts:
implemented · offline · default OFF · never run in production.
