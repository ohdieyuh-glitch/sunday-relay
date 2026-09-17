# Julius PR 5: Coding Agent attempt truth — an attempt ends when every field says it did, stops when it is told to, and holds its lease only while its work is real

The first boundary of the founder's provider-free master directive after #277.
Each defect was **reproduced on main `81be9c7c`** with a provider-free probe
before it was fixed.

No provider was called and no credential was read. There was no Anthropic,
OpenAI or xAI spend of any kind, and no qualification setting was weakened (the
job stays 120 minutes, see §3).

---

## 1 · A result is a success only when every field of it says so

**Reproduced:** the hosted fake SDK yielded `error_max_turns` with
`is_error: false` → the runner returned `completed` → the adapter returned
`SUCCEEDED` → the diff and tests ran and the evidence was minted. A `success`
with no `is_error`, an unknown subtype, and a `success` that ended
`terminal_reason: tool_deferred` behaved the same way.

- **One classifier for both Claude Code surfaces**
  (`claude-code-result-class.v1`, using the SDK's own subtype and
  `TerminalReason` vocabularies; a test pins them to the installed SDK's
  declarations). Success requires:
  - the subtype is `success`;
  - `is_error` is the boolean `false` (absent is *not* false);
  - the terminal reason is absent or `completed`.
- An error subtype is that error, whatever `is_error` says. Unknown is refused,
  never trusted.
- **The hosted runner, the Julius provider diagnostics and the local CLI
  adapter** all read it. `implementationPresent` is no longer `is_error === false`.
- **The record says what the result amounted to:** `resultClass` and
  `terminalReason` are in the domain's allowlist, with evidence-dump columns.
  Only vocabulary members leave; the runtime's strings are matched, never
  forwarded.

## 2 · The abort reaches the session, and nothing after it is evidence

**Reproduced:** `createClaudeCodeCodingAgentProvider.execute(request)` had no
signal parameter. A deadline cut ended Julius's side of the race while the paid
session kept editing the workspace until its own timer fired. And an outside
abort was only *forwarded*: the coordinator kept waiting, and an adapter that
ignored the signal had its late result persisted, accepted and settled.

- **Provider:**
  - The signal is connected to the runner's own controller, which the SDK holds.
  - A dispatch aborted before launch loads nothing.
  - An abort that lands as the stream ends is still a cancellation: charged,
    never `completed`.
- **Coordinator:**
  - An outside abort ends the race at once as `CANCELLED`.
  - The hold is kept, because the runtime may have run.
  - The signal's token reason (for example `lease_lost`) becomes the failure
    class; prose becomes `dispatch_cancelled`.
  - An abort that lands in the same turn as the answer still wins.
- **Adapter:** no executor step runs and no artifact is written after an abort.
- **Fixture providers** honour the signal. **A duplicate abort** is one
  cancellation: one release, one terminal row, one SDK abort event.

## 3 · The provider's deadline is not the attempt's

**Reproduced:** `CODER_WORKER.timeoutMs` was `DEFAULT_HOSTED_LIMITS.maxRuntimeMs`,
the session's own limit (734 386 ms). The dispatch it bounds also runs:
- the base read (15 s);
- the status and diff captures (30 s + 30 s);
- the tests (300 s).

A session that used its allowance was therefore cut while its tests ran, and the
finished work became a `TIMEOUT` retry.

- The worker declares the **attempt**, `coderAttemptDeadlineMs()`: the session
  limit plus the pre- and post-session executor allowances (1 169 386 ms). Every
  step bound comes from one table (`CODER_EXECUTOR_STEP_TIMEOUTS_MS`), and a
  structural test refuses a literal.
- The per-effect sandbox overhead (15 s) is a **stated assumption,
  LIVE VALIDATION REQUIRED**.
- **Job budget:** the job-share proof now counts whole attempts. The coder
  share is 40 of the unchanged 120 minutes: reviewers 50 + coder 40 + architect
  10 + infrastructure 15 = 115.

## 4 · A lease is renewed while the work is real, and never past its bound

**Reproduced:**
- The live lease was a flat 600 000 ms beside that coder deadline, and
  `JuliusRunWriter.heartbeat` had no production caller.
- With renewal absent (main's behaviour) and two run loops on one store, a coder
  attempt longer than its lease was swept `REQUEUE` mid-session, under the worker
  still running it.

**What changed:**
- **Derived:** the live lease is the longest registered worker deadline plus a
  600 s settlement allowance.
- **Renewed:** the run loop renews from admission. A claim queued behind another
  task gets a whole lease before it runs, and a renewal refused at admission
  runs nothing.
- **Bounded:** renewal never writes an expiry past the task's hold bound (every
  worker of its role at its deadline, plus settlement).
- **Loss:**
  - A renewal the store refuses aborts the dispatch `lease_lost`.
  - A worker stuck past the bound is stopped `lease_hold_exhausted`.
  - Renewals that keep failing abort before the last confirmed expiry passes.
- **`finishTask`'s refusal is no longer ignored**, so a requeue that never
  happened is not recorded as a `RETRY`.

---

## Proofs

Three commits, all authored and committed by julius-worker[bot]:

1. **How an attempt ends** — the classifier, its use on both surfaces and in the
   record, the abort through provider, coordinator and adapter.
2. **How long an attempt holds** — the attempt deadline and the lease keeper,
   with the live wiring and the real-PostgreSQL CI step.
3. **What the mutants found** — seven proofs, no production code.

**New proofs (68)**
- `result-classification.test.ts` (15) — every combination is total and maps to
  one class; error subtypes whatever `is_error` says; unreported flag; every
  non-`completed` terminal reason and an unknown one; unknown subtypes; the
  runtime's strings never forwarded; the vocabularies equal the installed SDK's
  declarations; the local parser, run record and event stream read the same rule.
- `coding-agent-attempt-truth.test.ts` (17) — the real hosted runner under the
  real Claude provider and coder adapter: six refused result shapes never reach
  `SUCCEEDED` or an executor step after the base; `success`/`completed` and an
  older runtime's absent reason succeed; the budget stop keeps its refusal; the
  abort before launch loads nothing; mid-session the SDK's own controller is
  aborted and only the base read ran; a double abort tells the session once; an
  abort as the stream ends is a charged cancellation at the adapter AND at the
  provider port; an abort between executor steps stops the next.
- `julius-dispatch-cancellation.test.ts` (7) — the coordinator ends at once,
  keeps the hold, names a token reason and nothing else, lets a late answer
  change nothing, is idempotent, and wins at every microtask distance from the
  answer.
- `julius-lease-keeper.test.ts` (15) — fake clock and timers: renewal inside
  the lease for twenty leases, one chain, a carried transient failure, `stop`
  waits and nothing renews after; the hold bound is never exceeded and aborts;
  a refusal aborts `lease_lost`; persistent failures abort before the confirmed
  expiry; the derivations.
- `julius-attempt-lease.e2e.test.ts` (11) — two run loops on one memory store:
  the legitimate long attempt keeps its lease and completes while another worker
  reclaims nothing (and, without renewal, is reclaimed — the defect); the first
  renewal precedes dispatch; a renewal refused at admission runs nothing; a
  paused stale worker is aborted `lease_lost` and writes no evidence, result or
  requeue, even when its provider ignores the abort; a stuck worker stops at its
  hold bound; renewal ends with the task; a refused finish is not a `RETRY`.
- `julius-lease-renewal.real-postgres.test.ts` (3, CI `first-live-topology`) —
  on the real schema: renewals keep `lease_expires_at` ahead and the sweep
  reclaims nothing; a reclaimed holder's renewal is refused by the generation
  fence and leaves the new lease untouched; no expiry past the hold bound.
- **Structural** — the live lease is derived and renewed (live composition); the
  worker's deadline is the attempt, every step bound comes from one table, and
  the job shares add up with whole attempts (coder envelope, reviewer deadline).
- **Existing proofs** — observation fixtures gained `terminalReason: null`; two
  local-connector fixtures describe a completed run as `success`, which is what
  the runtime sends; one envelope fixture's pace was lowered so it still fits an
  attempt with its executor steps. No assertion was weakened.

## Mutation testing

| Set | Run | Killed | Equivalent |
|---|---|---|---|
| PR 5 — classification, abort, deadline, lease (45) | 45 | 45 | 0 |
| PR 1 + PR 2 + PR 3 + PR 4 regression, at this head (none skipped) | 155 | 153 | 2 |
| **Total** | **200** | **198** | **2** |

- First run of the PR 5 set: 38 of 45 genuinely killed. Seven were closed by the
  third commit (the local run record and event stream; the provider-port abort
  contract; the keeper stopping with the task; the loop's interval check; the
  derived live lease; the refused-finish requeue). One of the seven had looked
  killed only because a Windows-only failure sits in its test file; kills were
  checked against each file's baseline failures.
- Regression: C2-M17 is killed by the PR 4 pending-review-research proof that
  closed it at #277. **C3-M16 and P3-M15** are the equivalents documented at
  #270 and #275.

## Gates at the frozen head

Frozen head `b808979e3a8671a96baea44073d83c17fd2213ee`, tree `ef2b82ba216b5b37bdad88d19b9144890fb35779`, on trusted main
`81be9c7cbc88022cd4da6a41ce594bf3718a2582`.

- `npm run typecheck` (four passes) — exit 0
- `julius:harness:check` — OK (manifest regenerated for the two new modules);
  `git diff --check` — clean
- `relay-repository-boundary.mjs`, `build`, `relay:build`, `relay:bridge:build`,
  `relay:hermes:build`, `relay-parity-gate.mjs`, `relay:surface-parity:check` and
  `:strict`, `relay:yc-demo:check`, `relay:cli:contract-verify` — all exit 0
- Julius kernel suite — 82 files, 1655 tests, 0 failed (before the proofs-only
  third commit); the attempt-truth, hosted, bridge Julius, connector and harness
  suites pass apart from failures identical on main
- Broad `vitest run` in twelve shards on this Windows workstation, compared
  failure by failure against trusted main in a separate worktree: 11 885 tests;
  145 failing on the branch against 143 on main; no main-only failures. The two
  branch-only failures (`repository-remote-transport` push refusal and
  `workspace` claim inspection — load-sensitive git tests) pass when rerun alone.
  Everything else fails identically on both (Windows file modes, `ps`, `/bin/sh`
  spawns, provenance CLI stubs). The offline Claude Code contract harness spawns
  `/bin/sh` and runs on Linux CI only; its two new scenarios were executed
  directly here and produce refused results.

CI at this head: running when this PR opens; this section is updated with its result.

## Not in this PR — next boundaries and one founder decision

- **Attempt-scoped workspace and change attribution** (attempt 1 edits and
  fails, attempt 2 starts, Julius tells the two apart). This is the next PR in
  this phase. It needs executor-side workspace snapshots and a typed
  failed-attempt change record, a boundary of its own.
- **FOUNDER DECISION — the attempt ceiling.** `CODER_WORKER.maxRetries` (1) and
  `architectWorker().maxRetries` (1) are validated and never enforced: plan and
  build tasks get `MAX_TASK_ATTEMPTS = 3`, while the job budget assumes 2. The
  two ways to make that true move a paid-qualification parameter:
  - enforce the declared retries (fewer live retries); or
  - budget three attempts (the job grows to about 140 minutes).

  Neither is done here.
- **LIVE VALIDATION REQUIRED:**
  - whether the real Claude Agent SDK child process stops when its
    `abortController` fires;
  - whether current runtimes send `terminal_reason: completed` on a normal
    finish (absent is accepted, so an older runtime is not refused);
  - the executor's real per-effect overhead.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01KLYuWBeq4erDEd89bec95L
