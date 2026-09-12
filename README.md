# Ceremony transport — NOT a landing candidate

Orphan branch. It shares no history with `main` and must never be merged.

| | |
|---|---|
| branch | `relay/julius-continuous-1-fixture` |
| base | `5bcd406f1baa22d0487666cbde360d23a8052151` |
| head | `3079cfdf81eaf08df8829f40415c56753a361478` |
| tree | `11afd6e6f2d192cac5c0f80ff62a4e50d64c9d32` |
| commits | 2, authored AND committed by `julius-worker[bot]` |

## Use

    git fetch origin ceremony/continuous-1-fixture-pr
    git checkout origin/ceremony/continuous-1-fixture-pr -- ceremony/
    export JULIUS_WORKER_APP_ID=<the App ID>
    # JULIUS_WORKER_APP_PEM must already be in the shell
    bash ceremony/open-continuous-1-fixture-worker-pr.sh

## What this branch carries

Step 4 of the nine-candidate minimum path. Commit 1 is the frozen fixture `26ee83c2`
(originally stacked on `research-authority`), rebased onto `main` after #256, #257,
#259 and #258 and patch-identical. Commit 2 sets `julius-continuous-1`'s finite
`spendUsd` to 60 — this qualification's funded provider total, for schema and
allocation compatibility only, NOT a permanent Julius cap; it must be refreshed to the
funded balance before any future paid run.
