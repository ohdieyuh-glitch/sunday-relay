# Ceremony transport — NOT a landing candidate

This branch is an **orphan**: it shares no history with `main` and must never be
merged into anything. It exists only to carry the artifacts needed to open one
worker-authored pull request from a machine that holds the `julius-worker`
GitHub App credential.

Candidate under ceremony:

| | |
|---|---|
| branch | `relay/julius-coder-failure-reason` |
| base | `5909ae004f11ad88269159f0c30d505c8ca491ea` |
| head | `6fb24609f17f565e2ebb2b20cad293a68d28c100` |
| tree | `341e0a1363ebb198f646276b7b7a155fa78a1d46` |
| commits | 2, each authored AND committed by `julius-worker[bot]` |

## Use

    git fetch origin ceremony/coder-diagnostics-pr
    git checkout origin/ceremony/coder-diagnostics-pr -- ceremony/
    export JULIUS_WORKER_APP_ID=<the App ID>
    # JULIUS_WORKER_APP_PEM must already be in the shell
    bash ceremony/open-coder-diagnostics-worker-pr.sh

**`JULIUS_WORKER_APP_ID` is NOT `325202980`.** That number is the bot's USER id
— it is where the commit address
`325202980+julius-worker[bot]@users.noreply.github.com` comes from, and it is
`user.id` on every PR the bot opens. The App ID is a different, much smaller
number on the app's own settings page (Settings → Developer settings → GitHub
Apps → julius-worker → "App ID"). The script refuses `325202980` by name,
because signing a JWT with the user id yields a 401 that used to surface several
lines later as a Python `KeyError`.

`open-coder-diagnostics-worker-pr.sh` re-verifies base, head, tree, commit count
and the authorship of every commit against the real remote **before** it touches
GitHub, and refuses if a PR for the branch is already open. It prints no
credential material. Every GitHub response it reads goes through
`github-field.py` — a FILE, never inline `python3 - <<'X'`, which makes python
read its program from stdin so the piped JSON is never read at all. That fault
killed the read-back on #247 and again on #249, in both cases *after* the pull
request had already been created.

Delete this branch once the PR is open.

## Also carried here, because the session scratchpad is ephemeral

`verify-landing.mjs` (the landing proofs) and `build-evidence.py` (fetches the
GitHub facts they read) live only in a session scratchpad otherwise. If this
container is reclaimed mid-landing they would be lost, and they are what proves
a landing is trusted. They are here so any session can recover them:

    node ceremony/verify-landing.mjs --repo <dir> --evidence <file>

`AUDIT_README_CLASS.md` records the 2026-09-10 sweep for other assumptions of
the kind that failed run 34433098911.
