# Ceremony transport — NOT a landing candidate

Orphan branch. It shares no history with `main` and must never be merged.

| | |
|---|---|
| branch | `relay/julius-research-attempt` |
| base | `9f155b919b0243e20fc3af132e9ea9176fd470ba` |
| head | `17c438ca57b06883ef3d632ab305af564c4436c0` |
| tree | `492cf9d942a2c2e2bbbf5a84a9adba6ef93f682c` |
| commits | 1, authored AND committed by `julius-worker[bot]` |

## Use

    git fetch origin ceremony/research-attempt-pr
    git checkout origin/ceremony/research-attempt-pr -- ceremony/
    export JULIUS_WORKER_APP_ID=<the App ID>
    # JULIUS_WORKER_APP_PEM must already be in the shell
    bash ceremony/open-research-attempt-worker-pr.sh

**`JULIUS_WORKER_APP_ID` is NOT `325202980`** — that is the bot's USER id, where
the commit address comes from. The App ID is a much smaller number on the app's
settings page; the script refuses `325202980` by name.

The opener re-verifies base, head, tree, commit count and the authorship of
every commit against the real remote **before** it touches GitHub, refuses if a
PR for the branch is already open, takes its title from the body's `# ` heading
rather than a literal, and prints no credential material. Its five pre-GitHub
checks were dry-run against the pushed branch and all five pass.

## What this one is, and the correction inside it

A retrieval is paid for inside `serve()` and recorded only afterwards, and the
mediator's own settlement writes nothing durable. A process dying in between
spent with nothing on the record.

**The standing note says that window costs two retrievals, both charged. It
costs one.** The checkpoint runs once per non-duplicate result, after the asking
task is already `SUCCEEDED`, and nothing re-enters it — so the retrieval is not
bought twice, it is simply lost, along with the answer, while the durable ledger
counts one fewer than were bought. An under-counted budget can be exceeded.

The repair is the `research.attempted` row: written before the spend, keyed by
the checkpoint's own id, paired with the charges it produced. An attempt with no
charge beside it is the loss, in the bundle.

**A re-entry guard was built and taken out.** The reproduction showed there is
no second serve to guard, which would have made it the same unreachable branch
as the guard removed here before it. Two proofs hold that decision, including
one on the `!outcome.duplicate` gate that makes the absence correct.

## Seven candidates now, six published

Six are independent on base `9f155b91` — `participant-isolation`,
`architect-envelope`, `ending-diagnostics`, `reviewer-envelope`,
`research-authority`, `coder-stream-usage` — and this one makes seven. Any order
works; the first to land moves `main` and the others' openers then refuse on a
stale base until they are rebased and re-frozen. That refusal is the safety
property working, not a fault.

**File-set overlaps to expect on the second and later rebases:**

* `research-authority` and `reviewer-envelope` both touch `JULIUS_HARNESS_MANIFEST.md`,
  which is GENERATED — resolve by running `npm run julius:harness:export` after
  the rebase and committing the result, never by hand-editing it.
* `coder-stream-usage` and `ending-diagnostics` both touch
  `relay-bridge/julius/live-workers.ts` and `src/relay/mission/julius/julius-router.ts`.
* This one and `coder-stream-usage` both touch
  `.github/julius-live-evidence-dump.sh`, in different queries.

All of these edits are additive in distinct regions; the rebases are mechanical.

`relay/julius-worker-deadline` (`79824e98`) remains STACKED on
`reviewer-envelope` and its ceremony is deliberately unpublished: its opener
would check `origin/main` against that branch's head and could never pass.

## After the merge

`ceremony/verify-landing.mjs` **requires `--repo <checkout of landed main>`**.
Without it, proofs 9 and 10 die with `MODULE_NOT_FOUND` for
`scripts/julius-main-monotonicity.mjs`, because it resolves that path from the
working directory and a ceremony worktree has no `scripts/`.
