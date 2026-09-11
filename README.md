# Ceremony transport — NOT a landing candidate

Orphan branch. It shares no history with `main` and must never be merged.

| | |
|---|---|
| branch | `relay/julius-continuous-arming` |
| base | `9eab011735130ab382868854ed05b24756765da3` |
| head | `b0c0a83db00ec1bd2b6d353dc483782f997459f9` |
| tree | `427736bef2794578a236cbf3e53cd464af7e7afb` |
| commits | 17, each authored AND committed by `julius-worker[bot]` |

## Use

    git fetch origin ceremony/continuous-arming-pr
    git checkout origin/ceremony/continuous-arming-pr -- ceremony/
    export JULIUS_WORKER_APP_ID=<the App ID>
    # JULIUS_WORKER_APP_PEM must already be in the shell
    bash ceremony/open-continuous-arming-worker-pr.sh

**`JULIUS_WORKER_APP_ID` is NOT `325202980`** — that is the bot's USER id, where
the commit address comes from. The App ID is a much smaller number on the app's
settings page; the script refuses `325202980` by name.

The opener re-verifies base, head, tree, commit count and the authorship of
every commit against the real remote **before** it touches GitHub, refuses if a
PR for the branch is already open, and prints no credential material. It
resolves its PR body against its own directory, and reads every GitHub response
through `github-field.py` — never inline `python3 - <<'X'`, which makes python
read its program from stdin and killed the read-back on #247 and #249 after the
PR had already been created.

Delete this branch once the PR is open.

## What the PR carries

The live continuous-worker arming stack: governed research for all three peer
slots behind one mission-sealed allowlist, research as a real barrier rather
than a note filed afterwards, the architect's guidance stages registered live
now that the reviewer can genuinely read a guidance packet, allocation v2 and
per-dispatch effort telemetry, and the five further ASK-vs-ANSWER gaps that
wiring the path exposed.

Nothing paid ran. No provider was contacted. No mission authorizes any research:
the door is built, governed and closed.

Two findings in it are decisions rather than defects, and the PR body says so —
the slot envelope would have starved Mission 5's coder, so the live composition
still allocates under v1; and the research ledger binds within a bridge process
rather than across a restart.

## Also carried here, because the session scratchpad is ephemeral

    node ceremony/verify-landing.mjs --repo <dir> --evidence <file>

`build-evidence.py` fetches the GitHub facts the landing proofs read.
`AUDIT_README_CLASS.md` records the 2026-09-10 assumption sweep, carried forward
from the previous ceremony unchanged.
