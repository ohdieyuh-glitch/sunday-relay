# Ceremony transport — NOT a landing candidate

Orphan branch. It shares no history with `main` and must never be merged.

| | |
|---|---|
| branch | `relay/julius-reviewer-failure-truth` |
| base | `8afb872d7a9e91569d9cb70457773bef887a5c56` |
| head | `628527d3b8dacef33c4af199ff2d703cd2996a5d` |
| tree | `e68d2922d9f825b935b6b851c365797e0c4e7724` |
| commits | 1, authored AND committed by `julius-worker[bot]` |

## Use

    git fetch origin ceremony/reviewer-failure-truth-pr
    git checkout origin/ceremony/reviewer-failure-truth-pr -- ceremony/
    export JULIUS_WORKER_APP_ID=<the App ID>
    # JULIUS_WORKER_APP_PEM must already be in the shell
    bash ceremony/open-reviewer-failure-truth-worker-pr.sh

## What this branch carries

Amended in place for PR #265: the stream-watchdog and request-timeout repair added after the zero-cost reproduction. The PR already exists, so this opener will refuse; the pins record what the founder approves.
