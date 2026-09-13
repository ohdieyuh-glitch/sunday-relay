# Ceremony transport — NOT a landing candidate

Orphan branch. It shares no history with `main` and must never be merged.

| | |
|---|---|
| branch | `relay/julius-qualification-repair` |
| base | `9fc999f7491a04977d997e58a67a4bc3ed4a35a5` |
| head | `650e81071293051c9429c765d111fa0dc3e9e8b6` |
| tree | `a35c7b78e5f63be311235c2a77a951f8e8a82632` |
| commits | 4, authored AND committed by `julius-worker[bot]` |

## Use

    git fetch origin ceremony/qualification-repair-pr
    git checkout origin/ceremony/qualification-repair-pr -- ceremony/
    export JULIUS_WORKER_APP_ID=<the App ID>
    # JULIUS_WORKER_APP_PEM must already be in the shell
    bash ceremony/open-qualification-repair-worker-pr.sh

## What this branch carries

Amended in place for PR #268: the Live Lab's repair fan-out fix (parts 1 and 2) added before approval. The PR already exists, so this opener will refuse; the pins record what the founder approves.
