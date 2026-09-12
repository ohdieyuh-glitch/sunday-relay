# Ceremony transport — NOT a landing candidate

Orphan branch. It shares no history with `main` and must never be merged.

| | |
|---|---|
| branch | `relay/julius-guidance-delivery` |
| base | `9f155b919b0243e20fc3af132e9ea9176fd470ba` |
| head | `e72e9def670100764973f651b6999f93cb34c932` |
| tree | `54409cb2ede115cf1b9381defe6ac8f1f18f6f4f` |
| commits | 1, authored AND committed by `julius-worker[bot]` |

## Use

    git fetch origin ceremony/guidance-delivery-pr
    git checkout origin/ceremony/guidance-delivery-pr -- ceremony/
    export JULIUS_WORKER_APP_ID=<the App ID>
    # JULIUS_WORKER_APP_PEM must already be in the shell
    bash ceremony/open-guidance-delivery-worker-pr.sh

**`JULIUS_WORKER_APP_ID` is NOT `325202980`** — that is the bot's USER id, where
the commit address comes from. The App ID is a much smaller number on the app's
settings page; the script refuses `325202980` by name.

The opener re-verifies base, head, tree, commit count and the authorship of
every commit against the real remote **before** it touches GitHub, refuses if a
PR for the branch is already open, takes its title from the body's `# ` heading
rather than a literal, and prints no credential material. Its five pre-GitHub
checks were dry-run against the pushed branch and all five pass.

## Read this one before running it

**It changes what a worker is shown on a paid path.** The Coding Agent will be
handed the architect's guidance packet, which today it is not. Nothing new is
authorised — the packet is already written, already paid for and already reviewed
— but the coder's prompt genuinely gains content, so this is not a
record-keeping change like the others in the queue.

The gap: the packet's only consumer was the Independent Reviewer. The coder's
continuation carried `brain:segment-resume` — what the coder itself said before
pausing — and nothing else. A mission could buy an architect dispatch, buy a
review of its output, block the coder on the architect so it could not proceed
without the answer, and then resume it without the answer.

It also resolves `guidanceConsumed` from UNKNOWN to a measurement, and only as a
consequence: nothing consumed guidance, which is why nothing could count it.

## Eight candidates now, seven published

Seven are independent on base `9f155b91` — `participant-isolation`,
`architect-envelope`, `ending-diagnostics`, `reviewer-envelope`,
`research-authority`, `coder-stream-usage`, `research-attempt` — and this one
makes eight. Any order works; the first to land moves `main` and the others'
openers then refuse on a stale base until they are rebased and re-frozen. That
refusal is the safety property working, not a fault.

**File-set overlaps to expect on the second and later rebases:**

* `research-authority` and `reviewer-envelope` both touch `JULIUS_HARNESS_MANIFEST.md`,
  which is GENERATED — resolve by running `npm run julius:harness:export` after
  the rebase and committing the result, never by hand-editing it.
* `coder-stream-usage` and `ending-diagnostics` both touch
  `relay-bridge/julius/live-workers.ts` and `src/relay/mission/julius/julius-router.ts`.
* `research-attempt`, `coder-stream-usage` and this one all touch
  `.github/julius-live-evidence-dump.sh`, in different queries.
* `research-attempt` and this one both touch
  `src/relay/mission/julius/julius-task-pipeline.ts`, in different functions.

All of these edits are additive in distinct regions; the rebases are mechanical.

`relay/julius-worker-deadline` (`79824e98`) remains STACKED on
`reviewer-envelope` and its ceremony is deliberately unpublished: its opener
would check `origin/main` against that branch's head and could never pass.

## After the merge

`ceremony/verify-landing.mjs` **requires `--repo <checkout of landed main>`**.
Without it, proofs 9 and 10 die with `MODULE_NOT_FOUND` for
`scripts/julius-main-monotonicity.mjs`, because it resolves that path from the
working directory and a ceremony worktree has no `scripts/`.
