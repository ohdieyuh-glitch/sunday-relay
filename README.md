# Ceremony transport — NOT a landing candidate

Orphan branch. It shares no history with `main` and must never be merged.

| | |
|---|---|
| branch | `relay/julius-continuous-workers` |
| base | `ed81b12e834ce60015926dfc56500dd4b09d4c72` |
| head | `ce543849459eda7587d448a00bc175c4585a6775` |
| tree | `3583ff65277a3e706024b980c8688d00c762b684` |
| commits | 3, each authored AND committed by `julius-worker[bot]` |

## Use

    git fetch origin ceremony/continuous-workers-pr
    git checkout origin/ceremony/continuous-workers-pr -- ceremony/
    export JULIUS_WORKER_APP_ID=<the App ID>
    # JULIUS_WORKER_APP_PEM must already be in the shell
    bash ceremony/open-continuous-workers-worker-pr.sh

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

## Also carried here, because the session scratchpad is ephemeral

    node ceremony/verify-landing.mjs --repo <dir> --evidence <file>

`build-evidence.py` fetches the GitHub facts the landing proofs read.
`AUDIT_README_CLASS.md` records the 2026-09-10 assumption sweep.
