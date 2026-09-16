# Ceremony transport — NOT a landing candidate

Orphan branch. It shares no history with `main` and must never be merged.

| | |
|---|---|
| branch | `relay/julius-peer-channel` |
| base | `ad03df90c9cb80657b23a0bee4890c17af18a022` |
| head | `846792dd1132d6b74cc455d3da0b55ee930d2dd0` |
| tree | `dcda54181ba284395083d1b913a7a5a01a1957fc` |
| commits | 3, authored AND committed by `julius-worker[bot]` |

## Use

    git fetch origin ceremony/julius-peer-channel-pr
    git checkout origin/ceremony/julius-peer-channel-pr -- ceremony/
    export JULIUS_WORKER_APP_ID=<the App ID>
    # JULIUS_WORKER_APP_PEM must already be in the shell
    bash ceremony/open-julius-peer-channel-worker-pr.sh

## What this branch carries

Provider-free development for the sustained Prompt Architect and Independent Reviewer: a typed, Julius-audited peer channel; the reviewer's canonical verdicts on the live path; and a bounded Architect-Reviewer disagreement. Three logical commits. No provider was contacted and no qualification semantics changed.
