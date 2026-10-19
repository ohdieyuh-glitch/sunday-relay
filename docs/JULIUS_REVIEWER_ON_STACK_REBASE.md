# Rebasing the reviewer repair over the contract stack — a tested recipe

> **What this is.** Two candidates sit on `main` `755d9d2` and only one can land
> first. `relay/julius-contract-stack-worker` is the stated priority, so this
> branch — `relay/julius-reviewer-timeout-diagnostics` — is the one that will
> need replaying. This document records the rebase that was actually performed
> in a throwaway worktree on 2026-09-09, the one conflict that needed a hand,
> exactly how it was resolved, and what the composed tree passed. Nothing was
> pushed and neither candidate was touched.
>
> **Why now.** The same document written for the contract stack
> (`JULIUS_STACK_REBASE_NOTES.md`) turned "resolve five conflicts under time
> pressure" into "replay a rebase whose three conflicts are known", twice. This
> is the same trade, taken before it is urgent rather than after.

## What overlaps, and what does not

The two branches share five files:

| File | Conflicts? |
|---|---|
| `.github/julius-live-evidence-dump.sh` | **yes**, twice — the same hunk |
| `.github/workflows/julius-first-live-mission.yml` | no — auto-merged |
| `relay-bridge/hermes-reviewer.ts` | no — auto-merged |
| `relay-bridge/julius/julius-live-composition.test.ts` | no — auto-merged |
| `src/relay/mission/julius/julius-router.ts` | no — auto-merged |

Four of the five compose without a hand because the two branches append to
*different* regions of them. Only the evidence dump collides, and it collides
for one reason: both sides edit the single `dump "SELECT … diag_… "` line that
writes `worker-diagnostics.tsv`. The stack rewrites it and appends a block of
new dumps after it; the reviewer branch rewrites the same line to add the
process-lifecycle columns. Git sees one region, two rewrites.

## The recipe — verified

```bash
git fetch origin main relay/julius-reviewer-timeout-diagnostics relay/julius-contract-stack-worker
git checkout -B local/reviewer-on-stack origin/relay/julius-reviewer-timeout-diagnostics
git rebase --onto origin/relay/julius-contract-stack-worker origin/main
```

It stops **twice**, both times on `.github/julius-live-evidence-dump.sh`, and
both times the resolution is the same:

> **Take the REPLAYED side's `dump "SELECT …"` line, and keep every other line
> from HEAD.** The replayed line is the same query as HEAD's plus the reviewer's
> columns, so it supersedes it; everything below it on the HEAD side — the
> Project Brain, sessions, task-contract, contract-event and trajectory dumps
> the stack added, with their comments — is carried through untouched.

Concretely, at each stop: HEAD's side is ~48 lines beginning with its
diagnostics line; the replayed side is ONE line. Resolved = `[replayed[0]] +
head[1:]`. Then `bash -n` the script, `git add`, `git rebase --continue`.

The first stop replays `3cafae55` (the lifecycle columns); the second replays
`0c9d6a58` (`packet_bytes`). If the reviewer branch grows another commit that
touches that line, expect a third stop resolved identically.

**Result on 2026-09-09:** 3 commits over `relay/julius-contract-stack-worker`,
and the composed dump carries both sides — `process_started`, `signal_sent`,
`cleanup_completed`, `packet_bytes` from the reviewer, and `project-brain.tsv`,
`sessions.tsv`, `task-contracts.tsv`, `contract-events.tsv`, `trajectory.tsv`
from the stack.

## What the composed tree passed

| Check | Result |
|---|---|
| `npm run typecheck` (all four projects) | clean |
| whole-repository `npm test` | **507 files passed**, 3 skipped (the env-gated real-infra suites), **9,780 tests passed**, 30 todo, exit 0 |
| both sides' symbols present | `PLAN_ATTEMPT_LIMIT`, `reasonClaim`, `contractProposalFromPlan`, `executedBindingFor`, `coderContractBrief`, `CAPABILITY_PROOF_COLUMNS`, `runRecoveryDrill` (stack) and `DEFAULT_KILL_GRACE_MS`, `isEngineReportedTimeout`, `cleanupCompleted`, `packetBytes`, `firstOutputAfterMs` (reviewer) |
| `julius:harness:check` | PASS, **manifest unchanged** |
| surface parity (strict), YC demo, CLI contract, persistence recovery drill | PASS |
| repository boundary, parity gate, `build`, `relay:bridge:build` | PASS |

The two branches compose. That is now a measured fact rather than an
expectation.

## If the reviewer repair lands FIRST instead

Then the stack is the branch that replays, and the collision is the same single
hunk with the sides swapped: take the replayed stack's diagnostics line only if
it is the newer one — it is not, since the reviewer's carries strictly more
columns — so in that direction keep **HEAD's** line and append the stack's block
below it. Everything else in `JULIUS_STACK_REBASE_NOTES.md` still applies.
