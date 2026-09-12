# Ceremony transport — NOT a landing candidate

Orphan branch. It shares no history with `main` and must never be merged.

| | |
|---|---|
| branch | `relay/julius-live-timeline` |
| base | `9f155b919b0243e20fc3af132e9ea9176fd470ba` |
| head | `1afe7810b3c00879fe4f15f89db7acc8175aa275` |
| tree | `473ef20fd7bef076ce455cceccdd5b3dd4a03351` |
| commits | 1, authored AND committed by `julius-worker[bot]` |

## Use

    git fetch origin ceremony/live-timeline-pr
    git checkout origin/ceremony/live-timeline-pr -- ceremony/
    export JULIUS_WORKER_APP_ID=<the App ID>
    # JULIUS_WORKER_APP_PEM must already be in the shell
    bash ceremony/open-live-timeline-worker-pr.sh

**`JULIUS_WORKER_APP_ID` is NOT `325202980`** — that is the bot's USER id, where
the commit address comes from. The App ID is a much smaller number on the app's
settings page; the script refuses `325202980` by name.

The opener re-verifies base, head, tree, commit count and the authorship of
every commit against the real remote **before** it touches GitHub, refuses if a
PR for the branch is already open, takes its title from the body's `# ` heading
rather than a literal, and prints no credential material. Its five pre-GitHub
checks were dry-run against the pushed branch and all five pass.

## Land this one first if you land only one

It makes **two of the six paid-qualification preconditions true**, and they were
not. `JuliusTimelinePostgresRepository` had no production caller, so the live
store answered no `timeline` — and both consumers are gated on that one probe:

* the research meter's durable ledger, which means research spend was **not**
  restart-durable in the deployment, only in the code;
* the per-slot money ledger allocation v3 projects, which means allocation was
  running on its conservative task-row fallback.

No conformance test could catch it: `JuliusTimelineReader` is not part of
`JuliusRuntimeStore`, so there was no required port to be missing. The harness
map had the file in its **"not composed"** list all along, with an accurate
reason — a real gap kept as a deliberate declaration.

No behaviour changes for a mission that neither researches nor allocates; the
fallbacks were already correct. What changes is that the durable paths are
reached.

## Nine candidates now, eight published

Eight are independent on base `9f155b91` — `participant-isolation`,
`architect-envelope`, `ending-diagnostics`, `reviewer-envelope`,
`research-authority`, `coder-stream-usage`, `research-attempt`,
`guidance-delivery` — and this one makes nine. Any order works; the first to land
moves `main` and the others' openers then refuse on a stale base until they are
rebased and re-frozen. That refusal is the safety property working, not a fault.

**File-set overlaps to expect on the second and later rebases:**

* `JULIUS_HARNESS_MANIFEST.md` is GENERATED and is touched by
  `research-authority`, `reviewer-envelope` and this one — resolve by running
  `npm run julius:harness:export` after the rebase and committing the result,
  never by hand-editing it.
* `coder-stream-usage` and `ending-diagnostics` both touch
  `relay-bridge/julius/live-workers.ts` and `src/relay/mission/julius/julius-router.ts`.
* `research-attempt`, `coder-stream-usage` and `guidance-delivery` all touch
  `.github/julius-live-evidence-dump.sh`, in different queries.
* `research-attempt` and `guidance-delivery` both touch
  `src/relay/mission/julius/julius-task-pipeline.ts`, in different functions.

All of these edits are additive in distinct regions; the rebases are mechanical.

**Read the `guidance-delivery` README before running that one** — it is the only
candidate in the queue that changes what a worker is SHOWN on a paid path.

`relay/julius-worker-deadline` (`79824e98`) remains STACKED on
`reviewer-envelope` and its ceremony is deliberately unpublished: its opener
would check `origin/main` against that branch's head and could never pass.

## After the merge

`ceremony/verify-landing.mjs` **requires `--repo <checkout of landed main>`**.
Without it, proofs 9 and 10 die with `MODULE_NOT_FOUND` for
`scripts/julius-main-monotonicity.mjs`, because it resolves that path from the
working directory and a ceremony worktree has no `scripts/`.
