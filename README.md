# Ceremony transport — NOT a landing candidate

Orphan branch. It shares no history with `main` and must never be merged.

| | |
|---|---|
| branch | `relay/julius-reviewer-transient-reask` |
| base | `9f155b919b0243e20fc3af132e9ea9176fd470ba` |
| head | `3b78b4d7d7144cd0e59dc9fc3f85385f10d583a3` |
| tree | `87d557c99bcf25d4313adf64436e424894abaf85` |
| commits | 1, authored AND committed by `julius-worker[bot]` |

## Use

    git fetch origin ceremony/reviewer-transient-reask-pr
    git checkout origin/ceremony/reviewer-transient-reask-pr -- ceremony/
    export JULIUS_WORKER_APP_ID=<the App ID>
    # JULIUS_WORKER_APP_PEM must already be in the shell
    bash ceremony/open-reviewer-transient-reask-worker-pr.sh

**`JULIUS_WORKER_APP_ID` is NOT `325202980`** — that is the bot's USER id. The App
ID is the much smaller number on the app's settings page; the script refuses
`325202980` by name.

The opener re-verifies base, head, tree, commit count and the authorship of every
commit against the real remote **before** it touches GitHub, refuses if a PR for
the branch is already open, takes its title from the body's `# ` heading, and
prints no credential material.

## What this branch carries

The fifteenth candidate. `relay/julius-reviewer-transient-upstream` made the live
reviewer path produce `review_service_unavailable` (retryable) for a 429/503, and
`relay/julius-reviewer-envelope` gives a review stage exactly ONE pipeline attempt.
Together those leave the retryable shape with no attempt to spend on it: the first
provider hiccup on any of the qualification's five review dispatches ends the
mission. This candidate is the bounded, adapter-internal, same-deadline re-ask the
founder's reviewer policy permits: once, after a 5 s backoff, only when the
declared deadline still holds a whole review, with the second engine run handed
the remaining window and the reason for the second call on the record
(`reviewReaskShape`, dumped as `review_reask_shape`).

It is frozen on trusted main directly and touches `live-workers.ts`,
`reviewer-deadline.ts`, `julius-router.ts`, the evidence dump, the composition
test and the first-live-mission test — so it overlaps `reviewer-envelope`
(`reviewer-deadline.ts`, both append), the two participation candidates
(`live-workers.ts`) and `ending-diagnostics` / `coder-stream-usage` (the dump
line). Whichever lands first moves `main`; the rest are rebased and re-frozen.
Recommended: land it AFTER `reviewer-envelope` and `reviewer-transient-upstream`,
since it is the answer to the gap the two of them open together. On a `main`
without `reviewer-envelope` it is harmless — a review then has three task
attempts and one in-adapter re-ask each, all bounded by the same deadline.

Thirteen proofs; ten adversarial mutations, ten killed. Typecheck clean on the
candidate and on the fourteen-candidate rehearsal stack with it applied. No
provider was contacted. No mission spent anything.

## After the merge

`ceremony/verify-landing.mjs` **requires `--repo <checkout of landed main>`**.
