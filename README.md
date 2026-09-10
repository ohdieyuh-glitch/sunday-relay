# Ceremony transport — NOT a landing candidate

This branch is an **orphan**: it shares no history with `main` and must never be
merged into anything. It exists only to carry the two artifacts needed to open
one worker-authored pull request from a machine that holds the `julius-worker`
GitHub App credential.

Candidate under ceremony:

| | |
|---|---|
| branch | `relay/julius-preflight-probe-discovery` |
| base | `d7af081b7404e3b1d42ee7a96ce3a1a05893527a` |
| head | `bafc36039826eb09a9b6c71bcb16c7bc4c4a51a6` |
| tree | `17bd24a0e3e26bfcc6e5bb14f47fa194edd91547` |
| commits | 1, authored AND committed by `julius-worker[bot]` |

## Use

    git fetch origin ceremony/probefix-pr
    git checkout origin/ceremony/probefix-pr -- ceremony/
    export JULIUS_WORKER_APP_ID=325202980       # if not already set
    # JULIUS_WORKER_APP_PEM must already be in the shell
    bash ceremony/open-probefix-worker-pr.sh

`open-probefix-worker-pr.sh` re-verifies base, head, tree, commit count and the
authorship of every commit against the real remote **before** it touches GitHub,
and refuses if a PR for the branch is already open. It prints no credential
material.

Delete this branch once the PR is open.
