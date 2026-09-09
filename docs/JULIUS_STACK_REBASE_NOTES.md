# Rebasing the contract stack onto the 34186711214 repair — a tested recipe

> **What this is.** `relay/julius-contract-stack-rebased` (35 commits over
> `main` `872f1790`) and `relay/julius-architect-gate-fix` (8 commits over the
> same `main`, head `d8c9fab1`) both change five files. A dry `git merge-tree`
> of the two reports conflicts in all five. This document records the rebase
> that was actually performed in a throwaway worktree on 2026-09-08, the three
> conflicts that needed a hand, exactly how each was resolved, and what the
> resolved tree passed. Nothing was pushed and neither branch was touched.
>
> **When it is needed.** The repair lands first, as a squash on `main` (see
> `docs/JULIUS_WORKER_PR_RUNBOOK.md`). The contract stack then follows it, and
> this recipe turns "resolve five conflicts under time pressure" into "replay a
> rebase whose three conflicts are known".

## Which commits collide, and why

| File | This branch | The repair |
|---|---|---|
| `.github/julius-live-evidence-dump.sh` | appends dumps after the worker-diagnostics line (`634fd237`, then `416a7640`, `49d00201`, `a63ce319`) | rewrites that same diagnostics line (`98a4a002`, `5127618a`, `adb3c750`) |
| `relay-bridge/julius/live-workers.ts` | inserts `contractProposalFromPlan` before the architect adapter (`89837def`); the coder's charge (`f27c217d`, `75ee1cf2`) | inserts `planCorrection` and `PLAN_ATTEMPT_LIMIT` at the same spot; the two bounded corrections |
| `scripts/julius-first-live-mission.test.ts` | the evidence file list grows | the diagnostics columns change |
| `src/relay/mission/julius/julius-router.ts` | `526d5d35` (superseded) | `98a4a002` |
| `src/relay/mission/prompt-architect/plan-schema-parity.test.ts` | `24d91a40`, `526d5d35` (both superseded) | `98a4a002`, `6e3ccd39` |

Two commits on this branch — `24d91a40` and `526d5d35` — are earlier drafts of
the repair's `98a4a002` and are **dropped**, not replayed. That removes the
router and plan-schema-parity conflicts entirely; the remaining three are
mechanical.

## The recipe — verified

```bash
git fetch origin main relay/julius-architect-gate-fix relay/julius-contract-stack-rebased
git checkout -B relay/julius-contract-stack-on-repair origin/relay/julius-contract-stack-rebased

# Replay every commit over main onto the repair, dropping the two superseded drafts.
GIT_SEQUENCE_EDITOR="sed -i -E '/^pick (24d91a40|526d5d35)/d'" \
  git -c core.editor=true rebase -i --onto origin/relay/julius-architect-gate-fix origin/main
```

The rebase stops three times. Each stop, and its resolution:

1. **`634fd237` — `.github/julius-live-evidence-dump.sh`, one hunk.** Keep the
   repair's worker-diagnostics `dump "SELECT … diag_stage …"` line (HEAD side)
   and keep this branch's appended block (the Project Brain and sessions dumps
   with their comment); drop only the replayed side's copy of the old
   diagnostics line. `bash -n` the script, `git add`, `git rebase --continue`.
2. **`89837def` — `relay-bridge/julius/live-workers.ts`, one hunk.** Both
   sides inserted a top-level block inside one `/** … */` region: the repair's
   `planCorrection(...)` + `const PLAN_ATTEMPT_LIMIT = 2;` and this branch's
   `contractProposalFromPlan(...)`. Keep **both**, repair's first, reopening
   the doc comment (`/**`) before this branch's block. `git add`, continue.
3. **`b0cdb1f2` — `docs/handoffs/JULIUS_CURRENT.md`, one hunk.** The repair
   never touches the handoff; the hunk is an artifact of the two dropped
   drafts. Take the replayed commit's version:
   `git checkout --theirs docs/handoffs/JULIUS_CURRENT.md && git add …`, continue.
   (Every later handoff commit applied cleanly.)

Result on 2026-09-08: **33 commits** over
`origin/relay/julius-architect-gate-fix`, 53 files, +9,701 / −64.

**Re-verified 2026-09-09, against the shape PR #237 will land.** The stack has
grown since, and the recipe held exactly: 52 commits over `main` replay as
**50** over the repair (the same two superseded drafts dropped), stopping at the
same three conflicts, resolved the same three ways. Result: 73 files,
+13,060 / −79. The counts move with the branch; the three conflicts do not.

## What the resolved tree passed (2026-09-08, cloud container)

| Check | Result |
|---|---|
| `npm run typecheck` (all four projects) | clean, on both dates |
| contract integrity + gate e2e, prompt-architect suite (the repair's own tests), live composition, contract-brief parity, first-live-mission evidence test, Beta Gate, paid-run replay | **9 files, 378 tests passed** |
| both sides present | `reasonClaim`, `PLAN_ATTEMPT_LIMIT`, `REVIEW_ATTEMPT_LIMIT` (repair) and `executedBindingFor`, `coderContractBrief`, `contract.challenged`, `trajectory.tsv` (stack) all in the tree |
| `julius:harness:export` | manifest unchanged |
| whole-repository `npx vitest run` | **505 files passed**, 1 skipped (env-gated real-infra), **9,716 tests passed**, 26 todo, exit 0 |

On the 2026-09-09 replay the resolved tree also passed all three typechecks and
the ten seam files that hold both sides together — the contract integrity e2e,
the whole prompt-architect suite, the policy router, the live composition and
brief parity, the Beta Gate, the drill support and the first-live-mission
evidence test — **399 tests, 0 failed**, and every symbol from both sides is
present in the tree (`reasonClaim`, `PLAN_ATTEMPT_LIMIT`, `REVIEW_ATTEMPT_LIMIT`
from the repair; `executedBindingFor`, `coderContractBrief`,
`contract.challenged`, `trajectory.tsv`, `CAPABILITY_PROOF_COLUMNS`,
`runRecoveryDrill` from the stack) — and the WHOLE repository suite on the
rebased tree: **506 files passed**, 3 skipped (the env-gated real-infra
suites), **9,759 tests passed**, 30 todo, exit 0. The two branches compose; that
is now a measured fact on both dates rather than an expectation.

The rebased branch exists only in the cloud container's throwaway worktree —
`local/stack-on-gate-fix` on 09-08 (head `03a2b879`), `local/stack-on-237` on
09-09 — and was deliberately not pushed either time, since no branch for it has
been sanctioned. The recipe above reproduces it in under a minute.

## After the repair lands as a squash

The squash on `main` has the same TREE as `d8c9fab1` but a new SHA, so:

```bash
git fetch origin main
git rebase --onto origin/main origin/relay/julius-architect-gate-fix relay/julius-contract-stack-on-repair
```

replays the 33 commits onto the squash with no new conflicts (identical base
tree). Then the stack itself needs its own worker-authored PR — the same
runbook, with `relay/julius-contract-stack-on-repair` in place of the repair
branch and 33 commits in place of 8.

## Never

- rebase or force-push `relay/julius-architect-gate-fix` or
  `relay/julius-contract-stack-rebased` to do this — both are references;
- merge the repair INTO the stack branch to sidestep the rebase: it would carry
  the eight pre-squash commits into a PR whose base then contains their squash;
- keep `24d91a40` / `526d5d35`: they are superseded and re-conflict on the
  router and the plan-schema test.
