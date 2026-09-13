# Ceremony transport — NOT a landing candidate

Orphan branch. It shares no history with `main` and must never be merged.

| | |
|---|---|
| branch | `relay/julius-qualification-repair` |
| base | `9fc999f7491a04977d997e58a67a4bc3ed4a35a5` |
| head | `999793eefca30e4d433a492d442d77240d168779` |
| tree | `5aa3515c186a33bc9dcec3aeddb1fa30d82c005f` |
| commits | 2, authored AND committed by `julius-worker[bot]` |

## Use

    git fetch origin ceremony/qualification-repair-pr
    git checkout origin/ceremony/qualification-repair-pr -- ceremony/
    export JULIUS_WORKER_APP_ID=<the App ID>
    # JULIUS_WORKER_APP_PEM must already be in the shell
    bash ceremony/open-qualification-repair-worker-pr.sh

## What this branch carries

Required by paid qualification attempt 3 (run 34766115321). Attempt 4 is dispatched automatically once this lands.
