# Julius PR 6: attempt-scoped workspace truth — Julius never attributes attempt 1's changes to attempt 2

The next boundary of the founder's provider-free master directive, on trusted
main `04b2adcf`. Every defect below was **reproduced there** with a
provider-free probe before it was fixed.

No provider was called and no credential was read. There was no Anthropic,
OpenAI or xAI spend of any kind. **The attempt ceiling is untouched** — it
remains the separate founder decision — and no paid-qualification parameter
moved: the job is still 120 minutes and the coder's share still 40.

---

## The defect

A mission has ONE workspace and it is never reset. The only change set Julius
had was `git status` against HEAD — the sum of everything every attempt, every
repair round and every earlier task had left there. So:

- attempt 2 of a build was credited with attempt 1's edits, and scope-checked
  against the sum;
- an attempt that failed before the capture ran left edits **no record
  mentioned at all**: they appeared inside the next attempt's diff;
- a change set that could not be read was an empty one, and an empty one read
  as "the executor observed no change" — a dirty workspace passing for clean.

## 1 · Three trees per attempt, taken without touching the workspace

The executor records a tree object at each moment of an attempt: HEAD's tree,
the working tree at the start, the working tree at the end.

- **It writes into a TEMPORARY index**, seeded from the repository's own (so the
  snapshot is a stat pass, not a rehash) and never written back. The real index,
  the staging state and `git status` are exactly as they were, and the temporary
  file is removed on the way out.
- **The change set is read with that index unset** — with it set, git compares
  the workspace against the snapshot and reports a clean tree.
- **Only a forty-hex tree id is ever interpolated** into a command.

## 2 · What the attempt inherited, what it owns, what the mission carries

| Set | From | Meaning |
|---|---|---|
| `inherited` | base → start | what it found already changed |
| `own` | start → end | **what this attempt changed** |
| `cumulative` | base → end | what the mission carries now |

Kept rather than subtracted: an attempt that puts a file back the way HEAD has
it changed something and left nothing, so a path can be `own` and not
`cumulative`.

**The invariant:** attempt 1 edits A and B and fails; attempt 2 edits B and C.
Attempt 2 owns B and C, reports A and B as inherited, and never claims A.

## 3 · Failed attempts own what they changed

The close-out look runs on a failure too, and the record travels to the kernel
on the dispatch error — diagnostics are flat scalars by contract, and a change
set is neither. Julius records it, scope-checks the attempt's OWN changes
against its locked contract, and names a stray path under the attempt that made
it. A failed attempt mints no diff evidence: it produced no result to review.

**Not after an abort.** PR #278's rule stands: a cancelled dispatch collects no
executor evidence. The record then says UNKNOWN with `DISPATCH_CANCELLED` as
the reason, which is the honest answer.

## 4 · Unknown is never clean

An uncaptured change set is empty because nothing is known. Julius now derives
`captured` itself from the three trees being present and every set readable —
never from an adapter saying so — and reports cleanliness as `UNKNOWN`,
`OBSERVED_CLEAN` or `OBSERVED_CHANGED`. A successful attempt whose change set
was never read gets Julius's own FAILED DIFF evidence, so an accepted result
can never rest on a workspace nobody read.

## 5 · One undo, and only one

Julius authorises a restore **only** when the last recorded attempt of the task
failed AND its own changes broke the contract's scope — nothing of it will be
reviewed, and leaving the edits makes them the next attempt's inheritance.

- The decision is read from the **ledger**, so a restart, a requeue or another
  worker reaches the same one.
- Both trees travel with the request: the one to restore to, and the one the
  workspace must **still be**.
- The executor refuses if the workspace has moved since — recorded, not retried.
- It puts back only the paths that attempt changed. There is no `git reset
  --hard`, and no broad reset, anywhere on this path.

---

## Proofs

Three commits, all authored and committed by julius-worker[bot]:

1. **The executor and the record shape** — the snapshot commands, the adapter,
   the attribution module, the dispatch carrier, the raised step bounds.
2. **The kernel owns the attribution** — recording, scope, the UNKNOWN rule, the
   undo decision from the ledger, the real-PostgreSQL proof and its CI step.
3. **What the mutants found** — two proofs, no production code.

**New proofs (52)**

- `julius-workspace-attribution.test.ts` (12) — a tree id is forty hex
  characters and nothing else reaches a command; the tree-diff parser
  (modify/add/delete/typechange, rename as its two paths, copy, unsafe paths
  dropped, truncation reported); a record is captured only when all three trees
  are, and a partial one has EMPTY sets and null trees; an uncaptured record
  still says what a restore did; UNKNOWN vs OBSERVED_CLEAN vs OBSERVED_CHANGED;
  the undo is asked for only for a failed, scope-refused, actually-changed
  attempt.
- `coder-workspace.test.ts` (13) — the snapshot writes a temporary index and
  nothing that resets, stashes, commits or cleans; the change set runs with that
  index unset; the three tree diffs; the undo guards on the tree the refused
  attempt left and never interpolates a non-tree-id; what the start and the
  close-out print, including a silent executor read as REFUSED rather than done.
- `coder-attempt-workspace.test.ts` (9) — through the real adapter with a fake
  executor: a successful attempt carries three trees and three sets; a failed
  one takes the close-out and carries it on the error; a runtime that never
  started looks for nothing; a cancelled dispatch collects nothing and says
  `DISPATCH_CANCELLED`; a missing start or end snapshot leaves the attribution
  uncaptured while the change set still arrives; the undo is reported restored,
  refused, or never asked for.
- `julius-attempt-workspace.e2e.test.ts` (14) — the real pipeline: attempt 1
  fails having changed A and B; attempt 2 owns only B and C and reports A and B
  as inherited, and **never claims A**; every record carries task, attempt and
  lease generation; a failed attempt's stray path is named under attempt 1 and
  earns exactly one undo, which is withdrawn once a later attempt stays in
  scope, never taken from another task, refused when the tree moved, and never
  asked for after a cancellation; a fresh runtime over the same store reaches
  the same decision; a replay writes the record once; an unread workspace is
  UNKNOWN and gets Julius's own FAILED evidence.
- `julius-attempt-attribution.real-postgres.test.ts` (4, CI
  `first-live-topology`) — two attempts are two rows the second cannot
  overwrite; the undo decision is reconstructable from the rows alone; a
  replayed record writes one row; another task and another run in the same
  database never reach this task's attribution.
- **Existing proofs** — the coder port and PR 5's attempt-truth suites now
  expect the close-out step on a failed attempt (`['base', 'status']`), which is
  the behaviour change; the implementation allowlist test covers the new fields.
  No assertion was weakened.

## Mutation testing

| Set | Run | Killed | Equivalent |
|---|---|---|---|
| PR 6 — attribution, snapshots, the undo, UNKNOWN, identity (29) | 29 | 29 | 0 |
| PR 1 + PR 2 + PR 3 + PR 4 + PR 5 regression, at this head (none skipped) | 200 | 198 | 2 |
| **Total** | **229** | **227** | **2** |

- First run of the PR 6 set: 27 of 29 killed. Both survivors were about WHICH
  attempt record the undo reads — the FIRST instead of the last, and any task's
  instead of this task's — and both needed a case the suite did not yet have (a
  third attempt; a second Coding Agent task). Closed in the third commit.
- Regression: C2-M17 is killed by the PR 4 proof that closed it at #277.
  **C3-M16 and P3-M15** are the equivalents documented at #270 and #275.
- The mutants cover the founder's list: inherited/own inversion (P6-M12),
  own measured from HEAD (P6-M13), attempt identity loss (P6-M23), UNKNOWN to
  CLEAN (P6-M02, P6-M24), the adapter's word for `captured` (P6-M01), stale
  snapshot reuse and restore without tree equality (P6-M10, P6-M15), restore
  scope (P6-M04, P6-M05, P6-M06, P6-M28), the next attempt claiming the prior
  delta (P6-M18, P6-M19), scope-check bypass (P6-M22), post-abort evidence
  (P6-M17), cross-task and last-attempt reads (P6-M26, P6-M27), and the record
  never being written at all (P6-M29).

## Gates at the frozen head

Frozen head `6b1dfee3433b7eb7412fcbdece383cc9b9a9fefe`, tree `e8ee66d4090cc54c3c03337b7b2c4118669782fe`, on trusted main
`04b2adcffa4f740353c415b9743191432bb7a741`.

- `npm run typecheck` (four passes) — exit 0
- `julius:harness:check` — OK (manifest regenerated for the two new modules);
  `git diff --check` — clean
- `relay-repository-boundary.mjs`, `build`, `relay:build`, `relay:bridge:build`,
  `relay:hermes:build`, `relay-parity-gate.mjs`, `relay:surface-parity:check`
  and `:strict`, `relay:yc-demo:check`, `relay:cli:contract-verify` — all exit 0
- Julius kernel, bridge Julius and hosted suites — 2 383 tests, 0 failed apart
  from the one Windows-only failure identical on main (`npx` cannot be spawned)
- Broad `vitest run` in twelve shards on this Windows workstation, compared
  failure by failure against trusted main in a separate worktree: 11 939 tests
  on the branch; **zero branch-only failures**. 145 fail on the branch against
  185 on main — the 40 main-only failures are load-sensitive git/worktree and
  ship-runner tests that pass on the branch run. Everything else fails
  identically on both (Windows file modes, `ps`, `/bin/sh` spawns, provenance
  CLI stubs).

CI at this head: running when this PR opens; this section is updated with its result.

## Not in this PR

- **The attempt ceiling** (2 declared vs 3 operative) — still the founder's
  decision, deliberately untouched here.
- **LIVE VALIDATION REQUIRED:** whether the seeded-index snapshot really fits
  the raised executor bounds (30 s base, 45 s close-out) on a repository of
  production size, and the executor's true per-effect overhead.
- Binary and unusual files are carried as paths like any other change: the
  snapshot is content-addressed by git itself, so nothing here reads file
  contents. A path git cannot name safely is dropped from the record rather
  than guessed at.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01KLYuWBeq4erDEd89bec95L
