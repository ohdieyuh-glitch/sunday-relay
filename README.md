# Ceremony transport — NOT a landing candidate

Orphan branch. It shares no history with `main` and must never be merged.

| | |
|---|---|
| branch | `relay/julius-research-batch` |
| base | `2110e2c5127532025d5affcd62070e6fe522ced9` |
| head | `b21d48a6f077a6ade50b0cadf52faf98d1c144d0` |
| tree | `423349b4a729e54ea7572e672c03dfd9674c78fc` |
| commits | 4, authored AND committed by `julius-worker[bot]` |

## Use

    git fetch origin ceremony/research-batch-pr
    git checkout origin/ceremony/research-batch-pr -- ceremony/
    export JULIUS_WORKER_APP_ID=<the App ID>
    # JULIUS_WORKER_APP_PEM must already be in the shell
    bash ceremony/open-research-batch-worker-pr.sh

## What this branch carries

Supersedes #266. One critical blocker exception (commit 1) plus the founder's three-improvement research batch (commits 2–4).
