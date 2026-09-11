# Ceremony transport — NOT a landing candidate

Orphan branch. It shares no history with `main` and must never be merged.

| | |
|---|---|
| branch | `relay/julius-peer-hardening` |
| base | `ca77604a7197be0937c0ae82f968987496c82513` |
| head | `00aa547dbb30d29a6ffb28d9f33005a2075369ff` |
| tree | `0f7e2a2522f8a90d7866b707dd1edf7c5902d775` |
| commits | 4, each authored AND committed by `julius-worker[bot]` |

## Use

    git fetch origin ceremony/peer-hardening-pr
    git checkout origin/ceremony/peer-hardening-pr -- ceremony/
    export JULIUS_WORKER_APP_ID=<the App ID>
    # JULIUS_WORKER_APP_PEM must already be in the shell
    bash ceremony/open-peer-hardening-worker-pr.sh

**`JULIUS_WORKER_APP_ID` is NOT `325202980`** — that is the bot's USER id, where
the commit address comes from. The App ID is a much smaller number on the app's
settings page; the script refuses `325202980` by name.

The opener re-verifies base, head, tree, commit count and the authorship of
every commit against the real remote **before** it touches GitHub, refuses if a
PR for the branch is already open, and prints no credential material.

## What this branch carries

The zero-spend qualification of trusted main `ca77604a`, and the five blockers
it found. `docs/JULIUS_ZERO_SPEND_QUALIFICATION.md` on the candidate is the
record.

Nothing paid ran. No provider was contacted. No mission authorises research.
