# Ceremony transport — NOT a landing candidate

Orphan branch. It shares no history with `main` and must never be merged.

| | |
|---|---|
| branch | `relay/julius-reviewer-envelope` |
| base | `9f155b919b0243e20fc3af132e9ea9176fd470ba` |
| head | `8b294c481d20a5367f487d7950bd4dcb24f971a7` |
| tree | `cce26bbdc16f44ce8903a5490da352ef6cb76383` |
| commits | 1, authored AND committed by `julius-worker[bot]` |

## Use

    git fetch origin ceremony/reviewer-envelope-pr
    git checkout origin/ceremony/reviewer-envelope-pr -- ceremony/
    export JULIUS_WORKER_APP_ID=<the App ID>
    # JULIUS_WORKER_APP_PEM must already be in the shell
    bash ceremony/open-reviewer-envelope-worker-pr.sh

**`JULIUS_WORKER_APP_ID` is NOT `325202980`** — that is the bot's USER id, where
the commit address comes from. The App ID is a much smaller number on the app's
settings page; the script refuses `325202980` by name.

The opener re-verifies base, head, tree, commit count and the authorship of
every commit against the real remote **before** it touches GitHub, refuses if a
PR for the branch is already open, takes its title from the body's `# ` heading
rather than a literal, and prints no credential material. Its five pre-GitHub
checks were dry-run against the pushed branch and all five pass.

## This one is the decision you made

`MAX_REVIEWER_ATTEMPTS` was enforced by nothing, so lowering it would have spent
nothing less. The lever that actually works is bounding the reviewer where
attempts are really spent: **one pipeline attempt per review stage**, enforced in
`julius-task-pipeline.ts`, with the model constant derived from that same number
instead of restated beside it.

The per-attempt reviewer deadline goes **up**, from 480,112 ms to **756,000 ms**,
because the analytical model was understating the engine by at least 2.5x. Three
attempts at 756,000 ms is 37.8 minutes inside the reviewer's 50-minute share.

**A real trade is inside this diff and is stated in section 7 of the PR body**: a
reviewer that hangs once and then answers no longer recovers, because the retry
that recovered paid run 34306850331 is the same retry that spent three paid cuts
on 34311556047 without learning anything.

## Four candidates now, and this one has a dependent

Three are independent on base `9f155b91` — `participant-isolation`,
`architect-envelope`, `ending-diagnostics` — and touch file sets disjoint from
one another and from this one. Any order works; the first to land moves `main`
and the others' openers then refuse on a stale base until they are rebased and
re-frozen. That refusal is the safety property working, not a fault.

**`relay/julius-worker-deadline` (`79824e98`) is STACKED on this branch**, not on
main, and its ceremony is deliberately not published yet: its opener would check
`origin/main` against this branch's head and could never pass. It is pushed,
fully gated (10,362 passed / 0 failed) and frozen; once this candidate is
accepted on main it is rebased onto the new main, re-frozen, and its ceremony
published then.

## After the merge

`ceremony/verify-landing.mjs` **requires `--repo <checkout of landed main>`**.
Without it, proofs 9 and 10 die with `MODULE_NOT_FOUND` for
`scripts/julius-main-monotonicity.mjs`, because it resolves that path from the
working directory and a ceremony worktree has no `scripts/`.
