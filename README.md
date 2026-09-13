# Ceremony transport — NOT a landing candidate

Orphan branch. It shares no history with `main` and must never be merged.

| | |
|---|---|
| branch | `relay/julius-batch-1` |
| base | `2110e2c5127532025d5affcd62070e6fe522ced9` |
| head | `e4b0d05bbdb383c9103de4caff23308c2aa1b7fa` |
| tree | `3f4073eb0db458292dcca003fe3c89267a622879` |
| commits | 3, authored AND committed by `julius-worker[bot]` |

## Use

    git fetch origin ceremony/julius-batch-1-pr
    git checkout origin/ceremony/julius-batch-1-pr -- ceremony/
    export JULIUS_WORKER_APP_ID=<the App ID>
    # JULIUS_WORKER_APP_PEM must already be in the shell
    bash ceremony/open-julius-batch-1-worker-pr.sh

## What this branch carries

Julius development batch 1: three improvements from paid qualification attempt 2 (run 34757974058), one logical commit each, per the founder's batch cadence.
