# Ceremony transport — NOT a landing candidate

Orphan branch. It shares no history with `main` and must never be merged.

| | |
|---|---|
| branch | `relay/julius-evidence-completeness` |
| base | `482e6a05161c1619514742519f393688ffdcb230` |
| head | `7b0950d41d7a345e38aff482d061782cc7402df4` |
| tree | `8c8e3d206ebe063e6e017c69c97270c289567f2d` |
| commits | 2, each authored AND committed by `julius-worker[bot]` |

## Use

    git fetch origin ceremony/evidence-completeness-pr
    git checkout origin/ceremony/evidence-completeness-pr -- ceremony/
    export JULIUS_WORKER_APP_ID=<the App ID>
    # JULIUS_WORKER_APP_PEM must already be in the shell
    bash ceremony/open-evidence-completeness-worker-pr.sh

**`JULIUS_WORKER_APP_ID` is NOT `325202980`** — that is the bot's USER id, where
the commit address comes from. The App ID is a much smaller number on the app's
settings page; the script refuses `325202980` by name.

The opener re-verifies base, head, tree, commit count and the authorship of
every commit against the real remote **before** it touches GitHub, refuses if a
PR for the branch is already open, takes its title from the body's `# ` heading
rather than a literal, and prints no credential material.

## What this branch carries

The follow-up to #253: the paid evidence bundle now carries the rows the paid
proof's own questions are answered from, and carries them in the order the
ledger committed them.

Five of the eight fields §6.5 of `docs/JULIUS_CONTINUOUS_ARMING.md` names as the
answers to A–H were written durably and never exported, so they were destroyed
with the mission's database. Everything that was exported was sorted by a wall
clock with no tiebreak.

Nothing paid ran. No provider was contacted. No mission authorises research.
