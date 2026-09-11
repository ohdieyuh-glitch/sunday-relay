# Ceremony transport — NOT a landing candidate

Orphan branch. It shares no history with `main` and must never be merged.

| | |
|---|---|
| branch | `relay/julius-coder-stream-usage` |
| base | `9f155b919b0243e20fc3af132e9ea9176fd470ba` |
| head | `78840a0d6c59a83f00d598d0c92eb4477f3d86d5` |
| tree | `cbb6921f19c710e016c05981cdc0a8cc3dd3602a` |
| commits | 1, authored AND committed by `julius-worker[bot]` |

## Use

    git fetch origin ceremony/coder-stream-usage-pr
    git checkout origin/ceremony/coder-stream-usage-pr -- ceremony/
    export JULIUS_WORKER_APP_ID=<the App ID>
    # JULIUS_WORKER_APP_PEM must already be in the shell
    bash ceremony/open-coder-stream-usage-worker-pr.sh

**`JULIUS_WORKER_APP_ID` is NOT `325202980`** — that is the bot's USER id, where
the commit address comes from. The App ID is a much smaller number on the app's
settings page; the script refuses `325202980` by name.

The opener re-verifies base, head, tree, commit count and the authorship of
every commit against the real remote **before** it touches GitHub, refuses if a
PR for the branch is already open, takes its title from the body's `# ` heading
rather than a literal, and prints no credential material. Its five pre-GitHub
checks were dry-run against the pushed branch and all five pass.

## What this one is

Paid run `34485676189` attempt 1 was cut off at its 360,000 ms ceiling and its
record says it reported no usage at all. Every assistant turn had already
carried a full `BetaMessage.usage` block — required by the SDK's own types — and
Relay read usage only from the terminal `result` message an aborted run never
reaches. It discarded all of it.

The floor those turns establish is now folded, carried through the allowlist and
the shared diagnostics builder, and exported. It is a **floor**: not the
runtime's total, carrying no cost in its values or its type, and settling no cost
basis. A cut-off run's money stays UNKNOWN and the ledger keeps holding the
reservation.

## Six candidates now, five published

Five are independent on base `9f155b91` — `participant-isolation`,
`architect-envelope`, `ending-diagnostics`, `reviewer-envelope`,
`research-authority` — and this one makes six. Any order works; the first to land
moves `main` and the others' openers then refuse on a stale base until they are
rebased and re-frozen. That refusal is the safety property working, not a fault.

**File-set overlaps to expect on the second and later rebases:**

* `research-authority` and `reviewer-envelope` both touch `JULIUS_HARNESS_MANIFEST.md`,
  which is GENERATED — resolve by running `npm run julius:harness:export` after
  the rebase and committing the result, never by hand-editing it.
* This candidate and `ending-diagnostics` both touch
  `relay-bridge/julius/live-workers.ts` and `src/relay/mission/julius/julius-router.ts`.
  Both edits are additive in distinct regions; the rebase is mechanical.

`relay/julius-worker-deadline` (`79824e98`) remains STACKED on
`reviewer-envelope` and its ceremony is deliberately unpublished: its opener
would check `origin/main` against that branch's head and could never pass.

## After the merge

`ceremony/verify-landing.mjs` **requires `--repo <checkout of landed main>`**.
Without it, proofs 9 and 10 die with `MODULE_NOT_FOUND` for
`scripts/julius-main-monotonicity.mjs`, because it resolves that path from the
working directory and a ceremony worktree has no `scripts/`.
