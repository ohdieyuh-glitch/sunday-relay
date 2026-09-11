# Ceremony transport — NOT a landing candidate

Orphan branch. It shares no history with `main` and must never be merged.

| | |
|---|---|
| branch | `relay/julius-ending-diagnostics` |
| base | `9f155b919b0243e20fc3af132e9ea9176fd470ba` |
| head | `9fd7ca33492092e33182c5d5976e42d377d98cb5` |
| tree | `372baab5efb3c994ecf5f1401b95367391c4f129` |
| commits | 1, authored AND committed by `julius-worker[bot]` |

## Use

    git fetch origin ceremony/ending-diagnostics-pr
    git checkout origin/ceremony/ending-diagnostics-pr -- ceremony/
    export JULIUS_WORKER_APP_ID=<the App ID>
    # JULIUS_WORKER_APP_PEM must already be in the shell
    bash ceremony/open-ending-diagnostics-worker-pr.sh

**`JULIUS_WORKER_APP_ID` is NOT `325202980`** — that is the bot's USER id, where
the commit address comes from. The App ID is a much smaller number on the app's
settings page; the script refuses `325202980` by name.

The opener re-verifies base, head, tree, commit count and the authorship of
every commit against the real remote **before** it touches GitHub, refuses if a
PR for the branch is already open, takes its title from the body's `# ` heading
rather than a literal, and prints no credential material. Its five pre-GitHub
checks were dry-run against the pushed branch and all five pass.

## Three candidates, one base, disjoint files

`ceremony/participant-isolation-pr` and `ceremony/architect-envelope-pr` are
frozen on the SAME base and touch file sets disjoint from this one and from each
other. Any order works. Whichever lands first moves `main`, at which point the
others' openers refuse (`main moved: … — STOP, the candidate is stale`) and
those candidates are rebased and re-frozen before their ceremonies run. That
refusal is the safety property working, not a fault.

## What this branch carries

Findings C and E, which are the same sentence twice: facts a boundary already
had in hand did not reach the rows a reader opens afterwards.

**C.** `JuliusExecutionOutcome`'s failure arm was `{status, code,
failureClass?}`. The coordinator flattened the adapter's diagnostics onto its
own `retry.scheduled` and then had nowhere to put them, so the terminal
`task.failed` — the row that ENDS a task when a run's autonomy declines a retry
— carried five fields and nothing about the provider. Not an omission: the type
gave the pipeline nothing to write. `costUsdMicros` is among what was lost, and
a coder that times out has usually already spent money.

**E.** Six `planDiagnostics` call sites each picked a subset of eighteen
optional fields by hand. Only the connector-failure path passed the whole
provider picture. The three refusal sites reported no tokens at all, so a plan
that was bought and thrown away recorded nothing about its cost; both success
sites omitted the elapsed time, the provider's status, the total and reasoning
tokens, and the ceiling. The successful run left thinner evidence than the
failed one, which is the wrong way round.

**And a three-layer miss.** `cachedInputTokens` was read by the connector and
reached no diagnostic anywhere. Adding it upstream turned out to be one third of
the repair: it was also absent from the `safeReviewDiagnostics` allowlist (so it
would have been dropped before the durable record) and from the evidence dump
(so it would have died with the database). Both gaps were caught by guards
rather than by inspection — the second by the completeness guard the previous
evidence repair installed, refusing a change other than its own for the first
time.

12 proofs, provider-free; 13 mutations, 13 killed, no survivors. Full suite
10,347 passed / 0 failed. Nothing paid ran. No provider was contacted.

## After the merge

`ceremony/verify-landing.mjs` **requires `--repo <checkout of landed main>`**.
Without it, proofs 9 and 10 die with `MODULE_NOT_FOUND` for
`scripts/julius-main-monotonicity.mjs`, because it resolves that path from the
working directory and a ceremony worktree has no `scripts/`.
