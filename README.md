# Ceremony transport — NOT a landing candidate

Orphan branch. It shares no history with `main` and must never be merged.

| | |
|---|---|
| branch | `relay/julius-worker-deadline` |
| base | `0845c593a8eb0d48c2329b907d966474e7273d89` |
| head | `f8bd107e0c30f9460ba605bade2ad83f2d09e639` |
| tree | `019a65375c0dfbcdf3df1d16d36c037c4990a85c` |
| commits | 1, authored AND committed by `julius-worker[bot]` |

## Use

    git fetch origin ceremony/worker-deadline-pr
    git checkout origin/ceremony/worker-deadline-pr -- ceremony/
    export JULIUS_WORKER_APP_ID=<the App ID>
    # JULIUS_WORKER_APP_PEM must already be in the shell
    bash ceremony/open-worker-deadline-worker-pr.sh

## What this branch carries

Step 7 of the nine-candidate path: the Julius-owned watchdog around dispatch (explicit TIMEOUT, AbortSignal forwarded, late results unable to reach mission state, settlement exactly once). Originally frozen at `79824e98`, stacked on reviewer-envelope; rebased onto `0845c593` after #256–#262, re-authored as `julius-worker[bot]`, and patch-identical to `79824e98` (`git patch-id --stable`).
