# Ceremony transport — NOT a landing candidate

Orphan branch. It shares no history with `main` and must never be merged.

| | |
|---|---|
| branch | `relay/julius-participant-isolation` |
| base | `9f155b919b0243e20fc3af132e9ea9176fd470ba` |
| head | `88f5df6e6bc50ce885c11af1bad8e0c0c7b46a91` |
| tree | `1f1a757f2466da4de13b19107d8660a2e6ea4580` |
| commits | 1, authored AND committed by `julius-worker[bot]` |

## Use

    git fetch origin ceremony/participant-isolation-pr
    git checkout origin/ceremony/participant-isolation-pr -- ceremony/
    export JULIUS_WORKER_APP_ID=<the App ID>
    # JULIUS_WORKER_APP_PEM must already be in the shell
    bash ceremony/open-participant-isolation-worker-pr.sh

**`JULIUS_WORKER_APP_ID` is NOT `325202980`** — that is the bot's USER id, where
the commit address comes from. The App ID is a much smaller number on the app's
settings page; the script refuses `325202980` by name.

The opener re-verifies base, head, tree, commit count and the authorship of
every commit against the real remote **before** it touches GitHub, refuses if a
PR for the branch is already open, takes its title from the body's `# ` heading
rather than a literal, and prints no credential material. Its five pre-GitHub
checks were dry-run against the pushed branch and all five pass.

## Independent of the architect-envelope candidate

`ceremony/architect-envelope-pr` is frozen on the SAME base and touches a
disjoint set of files. The two may be opened and approved in either order.
Whichever lands first moves `main`, at which point the other's opener will
refuse (`main moved: … — STOP, the candidate is stale`) and that candidate is
rebased and re-frozen before its ceremony is run. That refusal is the safety
property working, not a fault.

## What this branch carries

The salvage of #143 — mission ownership — re-audited and repaired against
current trusted main rather than replayed.

The mission-family gate proved a caller held *a* session; it never proved the
mission named in the path was theirs. Mission ids are caller-chosen and
therefore guessable, so `GET`, `cancel`, `retry` and the idempotent branch of
`start` all answered for any id, to any session — including a `browser_read_only`
session reading every operator-started paid mission.

#143's own fix expressed the caller as one `string | null`, which on today's
bridge collapses "an anonymous browser is asking" into "the operator is asking"
and escalates rather than contains. The scope is a TYPE here, so that collapse
cannot be written; a mutation reintroducing #143's exact formula dies.

**Read section 4 of the PR body before approving.** The anonymous branch is
fail-closed — a paired read-only session sees no mission at all, operator-started
ones included — because a pairing grant carries no mission or resource field, so
the scope it was granted is the empty set. That closes the paired-browser watch
of an operator mission until a grant can name one. The PR body states the
residual and the defined way to restore the watch.

41 proofs; 19 adversarial mutations, 19 killed, no survivors. Full suite 10,376
passed / 0 failed. Nothing paid ran. No provider was contacted.

## After the merge

`ceremony/verify-landing.mjs` **requires `--repo <checkout of landed main>`**.
Without it, proofs 9 and 10 die with `MODULE_NOT_FOUND` for
`scripts/julius-main-monotonicity.mjs`, because it resolves that path from the
working directory and a ceremony worktree has no `scripts/`.
