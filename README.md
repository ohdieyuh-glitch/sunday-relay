# Ceremony transport — NOT a landing candidate

Orphan branch. It shares no history with `main` and must never be merged.

| | |
|---|---|
| branch | `relay/julius-qualification-repair-2` |
| base | `44fd503a72993a34cd73c5cf948021cab4349218` |
| head | `3a6c58d6f5944df141d4976204cb097cbc4e31e5` |
| tree | `f4342e832ac72a146ce10730995374930d0bad82` |
| commits | 4, authored AND committed by `julius-worker[bot]` |

## Use

    git fetch origin ceremony/qualification-repair-2-pr
    git checkout origin/ceremony/qualification-repair-2-pr -- ceremony/
    export JULIUS_WORKER_APP_ID=<the App ID>
    # JULIUS_WORKER_APP_PEM must already be in the shell
    bash ceremony/open-qualification-repair-2-worker-pr.sh

## What this branch carries

Repairs required by paid qualification attempt 4 (run 34774471909), plus the founder-directed paid-run archive. Attempt 5 is dispatched automatically once this lands.
