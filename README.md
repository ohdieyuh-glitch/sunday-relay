# Landing order — REHEARSED, not a landing candidate

Orphan branch. It shares no history with `main` and must never be merged.

Twelve frozen candidates sit above trusted main `9f155b91`. They share seven
files. The overlaps were documented and had never been executed, so this is the
whole sequence actually performed, end to end, with the gate run on the result.

## The order, and what each step costs

Each candidate is one commit, so a rebase is a cherry-pick. Steps are listed in
the order they were rehearsed; the first three are the ones the paid
qualification needs, and they land clean.

| # | candidate | frozen head | conflicts |
|---|---|---|---|
| 1 | `relay/julius-research-authority` | `bdcd6b04` | none |
| 2 | `relay/julius-coder-participation` | `1519cae3` | none |
| 3 | `relay/julius-continuous-1-fixture` | `9b924a31` | none |
| 4 | `relay/julius-reviewer-envelope` | `8b294c48` | none |
| 5 | `relay/julius-worker-deadline` | `79824e98` | none |
| 6 | `relay/julius-ending-diagnostics` | `9fd7ca33` | **two files** |
| 7 | `relay/julius-coder-stream-usage` | `78840a0d` | **the evidence dump** |
| 8 | `relay/julius-research-attempt` | `17c438ca` | none |
| 9 | `relay/julius-guidance-delivery` | `e72e9def` | none |
| 10 | `relay/julius-live-timeline` | `1afe7810` | **the generated manifest** |
| 11 | `relay/julius-architect-envelope` | `9f7a2013` | none from git — see below |
| 12 | `relay/julius-participant-isolation` | `88f5df6e` | none |

Steps 3 and 5 are STACKED: the fixture is frozen on `research-authority`'s head
and `worker-deadline` on `reviewer-envelope`'s. Each must be rebased onto the
post-landing `main` and **re-frozen worker-authored** before its own PR can be
opened, and its opener's `BASE`, `HEAD` and `TREE` constants updated to match.
That is true of every candidate after the first one to land, stacked or not.

## The three real conflicts, and how each resolves

### Step 6 — `ending-diagnostics`

**`.github/julius-live-evidence-dump.sh`** — both sides append columns to the
same `worker-diagnostics.tsv` query. Additive: the merge keeps ours and splices
in every column theirs added. `ceremony/merge-dump.py` does exactly that and
refuses anything that is not that shape. Run it in the conflicted worktree:

    python3 ceremony/merge-dump.py && git add -A && git cherry-pick --continue

**`src/relay/mission/julius/julius-execution-coordinator.ts`** — both sides add
a different block after the same `/**`. Keep BOTH, in cherry-pick order, and
give the second block back the comment opener the conflict swallowed. Nothing is
chosen between: `dispatchWithinDeadline` and `carriedDiagnostics` are unrelated.

### Step 7 — `coder-stream-usage`

The evidence dump again, same shape, same resolver. It takes six
`stream_*` columns from the incoming side.

### Step 10 — `live-timeline`

**`JULIUS_HARNESS_MANIFEST.md` is GENERATED.** Never hand-edit it and never take
one side:

    git checkout --theirs -- JULIUS_HARNESS_MANIFEST.md
    git add JULIUS_HARNESS_MANIFEST.md
    npm run julius:harness:export
    git add -A && git cherry-pick --continue

## Step 11 — the conflict git cannot see

`architect-envelope` renames `ARCHITECT_WORKER` to `architectWorker(env)`.
`ending-diagnostics` and `coder-participation` each reference the old name on
lines that merge **cleanly**, so git reports no conflict at all and the stack
compiles only until `tsc` runs. Three references, in two files:

    relay-bridge/julius/ending-diagnostics.test.ts        (import + one use)
    relay-bridge/julius/julius-peer-qualification.e2e.test.ts  (one use)

Each becomes `architectWorker({})`. **`npm run typecheck` is the only gate that
catches this** — vitest transforms with esbuild and does not type-check — so
whoever lands `architect-envelope` after either of those two must run typecheck
before pushing, not only the suite.

## What the rehearsal proves

All twelve applied in this order, with the four resolutions above and nothing
else. The combined stack then passed the full gate:

    npm test                      10,605 passing across 541 files, 0 failed
    typecheck, build              0
    relay:build, relay:bridge:build             0
    relay-repository-boundary.mjs, relay-parity-gate.mjs   0
    relay:surface-parity:check:strict, relay:yc-demo:check 0
    relay:cli:contract-verify                   0
    relay:persistence:contract-verify           0
    relay:persistence:recovery-drill            0
    relay:workspace:verify                      0
    relay:claude:contract-verify                0
    julius:harness:check                        OK
    git diff --check                            0

Rehearsal head `45dee6a0`, tree `12c25099`, on `rehearsal/landing-order`.

**That branch is deliberately NOT pushed.** Thirteen commits carrying every
candidate's change, authored by `julius-worker[bot]`, would look exactly like a
shortcut past the ceremony — one PR instead of twelve, one approval instead of
twelve, and no provenance binding any of them. Julius does not write trusted
main except one reviewed candidate at a time. The recipe above is
deterministic: re-run it and the head and tree come out the same.

## What it does NOT prove

A cherry-pick onto a moving local branch reproduces the TREE each squash merge
would produce; it does not reproduce the SHAs, and it is not a substitute for CI
on the real PR. Land one, let CI run, then rebase the next onto the new `main` —
the rehearsal says where the work is, not that it can be skipped.

`generated/JULIUS_HARNESS_SOURCE.txt` is gitignored and per-checkout. A fresh
worktree reports it stale until `npm run julius:harness:export` runs there;
that is not a conflict and not a manifest problem.

## Which ceremonies are actually runnable right now

Every opener re-verifies `origin/main == BASE` before it touches GitHub, so a
ceremony pinned to a base that has since moved REFUSES rather than opening a PR
for a stale tree. That is the safety property working. Audited against the
remote at 2026-09-12 07:40Z, with `BASE`, `HEAD` and `TREE` read out of each
opener and compared to the pushed branch:

**Ready — base is trusted main `9f155b91`, head and tree match:**

    ceremony/architect-envelope-pr        ceremony/participant-isolation-pr
    ceremony/coder-participation-pr       ceremony/research-attempt-pr
    ceremony/coder-stream-usage-pr        ceremony/research-authority-pr
    ceremony/ending-diagnostics-pr        ceremony/reviewer-envelope-pr
    ceremony/guidance-delivery-pr         ceremony/live-timeline-pr

Ten of the twelve candidates. The other two are **held** and have no published
ceremony on purpose, because each is frozen on another candidate's head rather
than on main and its opener's base check could never pass:

    relay/julius-worker-deadline          stacked on reviewer-envelope
    relay/julius-continuous-1-fixture     stacked on research-authority

Each needs a rebase onto the post-landing `main` and a re-freeze
worker-authored before its ceremony can be written.

**Spent — pinned to an older base; do not run these.** Their openers will
refuse, and the refusal is correct:

    ceremony/evidence-completeness-pr   base 482e6a05   PR #254, merged 16:32Z
    ceremony/peer-hardening-pr          base ca77604a   PR #253, merged 10:12Z
    ceremony/continuous-arming-pr       base 9eab0117
    ceremony/coder-diagnostics-pr       base 5909ae00
    ceremony/coder-envelope-pr          base 6b2d62e7
    ceremony/mission5-pr                base 6b2d62e7
    ceremony/probefix-pr                base 6b2d62e7

After the FIRST of the ten lands, `main` moves and the remaining nine are all
pinned to a stale base — every one of them then needs the rebase and re-freeze
described above, in the order this file gives.
