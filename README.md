# Ceremony transport — NOT a landing candidate

Orphan branch. It shares no history with `main` and must never be merged.

| | |
|---|---|
| branch | `relay/julius-reviewer-failure-truth` |
| base | `8afb872d7a9e91569d9cb70457773bef887a5c56` |
| head | `9a6d994e02ed9da6908ad28eaeab2686004d14d7` |
| tree | `d0308b976a9c85fc19c12366ab9197ee4072ad48` |
| commits | 1, authored AND committed by `julius-worker[bot]` |

## Use

    git fetch origin ceremony/reviewer-failure-truth-pr
    git checkout origin/ceremony/reviewer-failure-truth-pr -- ceremony/
    export JULIUS_WORKER_APP_ID=<the App ID>
    # JULIUS_WORKER_APP_PEM must already be in the shell
    bash ceremony/open-reviewer-failure-truth-worker-pr.sh

## What this branch carries

Repair after paid qualification run 34753589938 failed at the tool-less Independent Reviewer. One worker-authored commit on accepted main `8afb872d` (#264). The paid qualification reruns as attempt 2 immediately after this lands.
