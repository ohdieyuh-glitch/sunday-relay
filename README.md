# Ceremony transport — NOT a landing candidate

Orphan branch. It shares no history with `main` and must never be merged.

| | |
|---|---|
| branch | `relay/julius-research-authority` |
| base | `9f155b919b0243e20fc3af132e9ea9176fd470ba` |
| head | `bdcd6b04deec79be5088b84bca15df78b0a3cea0` |
| tree | `ef9a88ae8c7c480b38582d818fd6bde9fc66711e` |
| commits | 1, authored AND committed by `julius-worker[bot]` |

## Use

    git fetch origin ceremony/research-authority-pr
    git checkout origin/ceremony/research-authority-pr -- ceremony/
    export JULIUS_WORKER_APP_ID=<the App ID>
    # JULIUS_WORKER_APP_PEM must already be in the shell
    bash ceremony/open-research-authority-worker-pr.sh

**`JULIUS_WORKER_APP_ID` is NOT `325202980`** — that is the bot's USER id, where
the commit address comes from. The App ID is a much smaller number on the app's
settings page; the script refuses `325202980` by name.

The opener re-verifies base, head, tree, commit count and the authorship of
every commit against the real remote **before** it touches GitHub, refuses if a
PR for the branch is already open, takes its title from the body's `# ` heading
rather than a literal, and prints no credential material. Its five pre-GitHub
checks were dry-run against the pushed branch and all five pass.

## What this one is

Governed research has been complete and unreachable. `assembleLiveJuliusRuntime`
accepts `researchPolicyFor` and `researchProbes`; the live entrypoint passed
neither, so every paid mission has run under `noJuliusResearch` whatever its
document said. This connects the two, and puts a grant in front of it.

**It authorises nothing.** The grant table in
`scripts/julius-live-contract-check.mjs` is empty, no contract declares a
research clause, no backend is observed anywhere, and a proof asserts each of
those. Every retrieval is still refused, by the same gates, for the same
reasons. What changes is that granting research is now possible, bounded,
visible in one named table — and impossible for a mission to do for itself.

The three facts it keeps apart: what a mission is AUTHORISED to read (its
contract), what an operator has OBSERVED a backend serve (the environment), and
whether anything is retrieved (the mediator, from both). A contract asserting
its own reachability would be the mission vouching for the one thing it cannot
know.

## Five candidates now, four published

Four are independent on base `9f155b91` — `participant-isolation`,
`architect-envelope`, `ending-diagnostics`, and this one — plus
`reviewer-envelope`, also on `9f155b91`. Any order works; the first to land
moves `main` and the others' openers then refuse on a stale base until they are
rebased and re-frozen. That refusal is the safety property working, not a fault.

**This candidate and `reviewer-envelope` both touch
`JULIUS_HARNESS_MANIFEST.md`**, which is GENERATED. Whichever lands second
resolves it by running `npm run julius:harness:export` after the rebase and
committing the result — never by hand-editing the manifest.

`relay/julius-worker-deadline` (`79824e98`) remains STACKED on
`reviewer-envelope` and its ceremony is deliberately unpublished: its opener
would check `origin/main` against that branch's head and could never pass.

## After the merge

`ceremony/verify-landing.mjs` **requires `--repo <checkout of landed main>`**.
Without it, proofs 9 and 10 die with `MODULE_NOT_FOUND` for
`scripts/julius-main-monotonicity.mjs`, because it resolves that path from the
working directory and a ceremony worktree has no `scripts/`.
