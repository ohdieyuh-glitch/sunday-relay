# Ceremony transport — NOT a landing candidate

Orphan branch. It shares no history with `main` and must never be merged.

| | |
|---|---|
| branch | `relay/julius-architect-reviewer-participation` |
| base | `d2cda3793ca70be5b4464cbcaaae063f785a56fb` |
| head | `4201e7eb22b1802124a091de39b05fe398ea94b6` |
| tree | `3c964a0f06d4c2d321caa7bccb97331513142e08` |
| commits | 1, authored AND committed by `julius-worker[bot]` |

## Use

    git fetch origin ceremony/architect-reviewer-participation-pr
    git checkout origin/ceremony/architect-reviewer-participation-pr -- ceremony/
    export JULIUS_WORKER_APP_ID=<the App ID>
    # JULIUS_WORKER_APP_PEM must already be in the shell
    bash ceremony/open-architect-reviewer-participation-worker-pr.sh

## What this branch carries

Step 5 of the nine-candidate path to the paid continuous-worker qualification. Originally frozen at `f00b58ec`, stacked on coder-participation; rebased onto `d2cda379` after #256, #257, #259, #258 and #260, re-authored as `julius-worker[bot]`, and patch-identical to `f00b58ec` (`git patch-id --stable`).
