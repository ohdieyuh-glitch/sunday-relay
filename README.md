# Ceremony transport — NOT a landing candidate

Orphan branch. It shares no history with `main` and must never be merged.

| | |
|---|---|
| branch | `relay/julius-architect-envelope` |
| base | `9f155b919b0243e20fc3af132e9ea9176fd470ba` |
| head | `9f7a20138f3b8e85575c8ce5cdf428df1aa1f06e` |
| tree | `278c6a925fb92d55ef8e0835d6abed542edcf6c7` |
| commits | 1, authored AND committed by `julius-worker[bot]` |

## Use

    git fetch origin ceremony/architect-envelope-pr
    git checkout origin/ceremony/architect-envelope-pr -- ceremony/
    export JULIUS_WORKER_APP_ID=<the App ID>
    # JULIUS_WORKER_APP_PEM must already be in the shell
    bash ceremony/open-architect-envelope-worker-pr.sh

**`JULIUS_WORKER_APP_ID` is NOT `325202980`** — that is the bot's USER id, where
the commit address comes from. The App ID is a much smaller number on the app's
settings page; the script refuses `325202980` by name.

The opener re-verifies base, head, tree, commit count and the authorship of
every commit against the real remote **before** it touches GitHub, refuses if a
PR for the branch is already open, takes its title from the body's `# ` heading
rather than a literal, and prints no credential material. Its five pre-GitHub
checks were dry-run against the pushed branch and all five pass.

## Independent of the participant-isolation candidate

`ceremony/participant-isolation-pr` is frozen on the SAME base and touches a
disjoint set of files. The two may be opened and approved in either order.
Whichever lands first moves `main`, at which point the other's opener will
refuse (`main moved: … — STOP, the candidate is stale`) and that candidate is
rebased and re-frozen before its ceremony is run. That refusal is the safety
property working, not a fault.

## What this branch carries

Finding F. `RELAY_PROMPT_ARCHITECT_TIMEOUT_MS` and
`RELAY_PROMPT_ARCHITECT_MAX_TOKENS` are each read by two modules with two
different defaults, and three things downstream were built on the wrong one:

1. Julius's composition DECLARED its architect's deadline as the connector's
   fallback, while the number that cuts the call off is resolved from the
   environment. They agreed under the empty environment and no other — the same
   declared-versus-operative drift `reviewer-deadline.ts` exists to end.
2. The job-budget proof modelled the architect's share from that same fallback,
   so raising the real deadline would not have moved the proof.
3. **`.env.example` SET both variables to the demo path's numbers**, so any
   environment copied from this repository handed Julius's architect a
   1,200-token ceiling and a 90 s deadline, silently. Not hypothetical.

No default value changes. The configuration surface is deliberately not split.
13 proofs; 13 mutations killed, no survivors; 4 differential pairs for two
mutants that are equivalent under a workflow setting no architect deadline.
Full suite 10,349 passed / 0 failed. Nothing paid ran. No provider was contacted.

## After the merge

`ceremony/verify-landing.mjs` **requires `--repo <checkout of landed main>`**.
Without it, proofs 9 and 10 die with `MODULE_NOT_FOUND` for
`scripts/julius-main-monotonicity.mjs`, because it resolves that path from the
working directory and a ceremony worktree has no `scripts/`.
