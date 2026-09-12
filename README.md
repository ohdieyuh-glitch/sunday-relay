# Landing order — REHEARSED, not a landing candidate

Orphan branch. It shares no history with `main` and must never be merged.

Twelve frozen candidates sit above trusted main `9f155b91`. They share seven
files. The overlaps were documented and had never been executed, so this is the
whole sequence actually performed, end to end, with the gate run on the result.

## The order, and what each step costs

Each candidate is one commit, so a rebase is a cherry-pick. Steps are listed in
the order they were rehearsed, which is ordered to minimise conflicts — NOT to
unblock anything. The minimum path to the paid qualification is five of these
fourteen and is set out under "The five the paid qualification actually needs"
below; a founder working this table top to bottom would run thirteen ceremonies
before reaching the last one that mission requires.

| # | candidate | frozen head | conflicts |
|---|---|---|---|
| 1 | `relay/julius-research-authority` | `bdcd6b04` | none |
| 2 | `relay/julius-coder-participation` | `1519cae3` | none |
| 3 | `relay/julius-continuous-1-fixture` | `26ee83c2` | none |
| 4 | `relay/julius-reviewer-envelope` | `8b294c48` | none |
| 5 | `relay/julius-worker-deadline` | `79824e98` | none |
| 6 | `relay/julius-ending-diagnostics` | `9fd7ca33` | **two files** |
| 7 | `relay/julius-coder-stream-usage` | `78840a0d` | **the evidence dump** |
| 8 | `relay/julius-research-attempt` | `17c438ca` | none |
| 9 | `relay/julius-guidance-delivery` | `e72e9def` | none |
| 10 | `relay/julius-live-timeline` | `1afe7810` | **the generated manifest** |
| 11 | `relay/julius-architect-envelope` | `9f7a2013` | none from git — see below |
| 12 | `relay/julius-participant-isolation` | `88f5df6e` | none |
| 13 | `relay/julius-architect-reviewer-participation` | `f00b58ec` | none from git — same rename, see below |
| 14 | `relay/julius-reviewer-transient-upstream` | `0311fcef` | none |
| 15 | `relay/julius-reviewer-transient-reask` | `3b78b4d7` | `reviewer-deadline.ts` (both append), `live-workers.ts` (participation), the evidence dump (same resolver) — frozen on main, rehearsed LAST |

Steps 3, 5, 13 and 14 are STACKED: the fixture is frozen on
`research-authority`'s head, `worker-deadline` on `reviewer-envelope`'s,
`architect-reviewer-participation` on `coder-participation`'s, and
`reviewer-transient-upstream` on `architect-reviewer-participation`'s — the one
three-deep chain, and it is three deep because both of its ancestors touch
`hermes-reviewer.ts` and `julius-live-composition.test.ts`. Basing it on main
instead would have produced conflicts in both files, which costs the founder
more than a documented stack does. Each must be rebased onto the
post-landing `main` and **re-frozen worker-authored** before its own PR can be
opened, and its opener's `BASE`, `HEAD` and `TREE` constants updated to match.
That is true of every candidate after the first one to land, stacked or not.

## The fifteenth candidate, and why the minimum path is nine

`reviewer-transient-upstream` (14) makes the live reviewer answer a 429/503 with
the RETRYABLE shape; `reviewer-envelope` (4) gives a review stage ONE pipeline
attempt. Integrated, the retryable shape reaches a pipeline with nothing left to
spend on it, and the first provider hiccup on any of the qualification's five
review dispatches ends the paid mission. Candidate 15 —
`relay/julius-reviewer-transient-reask` @ `3b78b4d7`, ceremony
`ceremony/reviewer-transient-reask-pr` — is the bounded adapter-internal re-ask
inside the same declared deadline: once, after 5 s, only when the remaining
window still holds the policy's floor, the second run given the remainder, the
reason on the record as `review_reask_shape`. Rehearsed on top of all fourteen
(2026-09-12): typecheck clean, harness current, qualification suites 215/215.

The founder's canonical policies (one attempt per normal review stage; a
Julius-owned watchdog) put 4, 5 and 14 on the paid path as well, so the honest
minimum is the five below plus 4, 5, 14 and 15 — nine — landed in that order,
15 last because it answers the gap 4 and 14 open together.

## The five the paid qualification actually needs

The heartbeat names two separate requirements, and between them they pick out
five candidates rather than the three this file used to claim:

* §4 — no paid provider call until **participant isolation** is accepted on
  main. That is step 12 here, purely because it conflicts with nothing and so
  sorted late. It blocks the run outright.
* §3 — the required sequence opens with *Architect serious pre-lock
  investigation/research*, and asks that all three slots get research under
  governed policy. That needs **research-authority** (the seam),
  **coder-participation** and **architect-reviewer-participation** (the three
  ask channels) and the **q1 fixture** (the mission that grants any of it).

| order | candidate | why | conflicts |
|---|---|---|---|
| 1 | `relay/julius-participant-isolation` | §4 precondition; overlaps nothing else | none |
| 2 | `relay/julius-research-authority` | the research seam | none |
| 3 | `relay/julius-coder-participation` | the coder's ask channel | none |
| 4 | `relay/julius-continuous-1-fixture` | the mission, and the only research grant | stacked on 2 |
| 5 | `relay/julius-architect-reviewer-participation` | the other two ask channels | stacked on 3 |

Steps 1–3 are independent of each other and of the remaining nine: they may be
opened in any order and each lands clean. Steps 4 and 5 are the two held
candidates in this set and each needs its rebase, re-freeze and a written
ceremony once its parent lands.

Nothing here says the other nine do not matter. It says the paid qualification
does not wait on them.

## The grant and the channel disagreed, and the mission would have bought the wrong record

Worth recording because it survived a rehearsal, a six-precondition audit and a
provider-free drive to COMPLETED without anything noticing.

The q1 fixture sealed its research grant naming **one** role, and said why in
its own comment: only the Coding Agent had a channel through which an ask could
reach Julius, and granting the other two would have been authority no run could
spend. That was true when it was written. `architect-reviewer-participation`
then gave the Prompt Architect and the Independent Reviewer exactly such a
channel — `researchAsks` as a REQUIRED field on both their schemas — and the
grant was never revisited.

So on the integrated stack both slots asked on every turn and every ask was
refused `role_not_authorized`, on the one mission whose charter asks the
Architect to investigate BEFORE the contract locks. A refused ask does not fail
the run: it routes CONTINUE with the reason on the record. The mission would
have completed, spent its budget, and produced evidence proving the opposite of
what it was specified to demonstrate.

Measured rather than reasoned, against the integrated stack: architect refused,
reviewer refused, identical coder request allowed. Repaired in the fixture
candidate (frozen head `26ee83c2`) by naming all three slots in both halves of
the grant. It bought no new authority — the budget was already three slots'
worth, two retrievals each against a mission ceiling of six — so the same six
retrievals are now reachable by three slots on the same one host with the same
one read capability. Re-measured after: all three allowed, an unlisted host
still refused for every slot. Four mutations, all killed.

The general lesson, which is the reason this is written down: a permission
narrowed because a capability was missing has to be revisited when the
capability arrives, and nothing in this repository was watching that pair. The
tripwire that pinned the granted roles now states the property it always meant
— no slot may be granted research it cannot ask for — against a named list, so
the next slot has to be argued for rather than inherited.

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

    relay-bridge/julius/ending-diagnostics.test.ts             (import + one use)
    relay-bridge/julius/julius-peer-qualification.e2e.test.ts  (one use)
    relay-bridge/julius/julius-live-composition.test.ts        (one use, step 13)

Each becomes `architectWorker({})`. Step 13 reproduced this exactly: the
cherry-pick reported CLEAN and `tsc` then named the one reference. **`npm run typecheck` is the only gate that
catches this** — vitest transforms with esbuild and does not type-check — so
whoever lands `architect-envelope` after either of those two must run typecheck
before pushing, not only the suite.

## What the rehearsal proves

All fourteen applied in this order, with the four resolutions above and nothing
else. The combined stack then passed the full gate:

    npm test                      10,644 passing across 543 files, 0 failed
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

Rehearsal head `cb3a8b65`, on `rehearsal/landing-order`, for the fourteen as
they were first frozen. The q1 fixture has since been re-frozen at `26ee83c2`
(the grant repair above), so re-running the recipe now produces a different head
and one more test — 10,644 rather than 10,643. The head above is kept as the
record of what was actually rehearsed, not as a target to reproduce.

**That branch is deliberately NOT pushed.** Fifteen commits carrying every
candidate's change, authored by `julius-worker[bot]`, would look exactly like a
shortcut past the ceremony — one PR instead of fourteen, one approval instead
of fourteen, and no provenance binding any of them. Julius does not write trusted
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

Ten of the fourteen candidates. The other four are **held** and have no
published ceremony on purpose, because each is frozen on another candidate's
head rather than on main and its opener's base check could never pass:

    relay/julius-worker-deadline                    stacked on reviewer-envelope
    relay/julius-continuous-1-fixture               stacked on research-authority
    relay/julius-architect-reviewer-participation   stacked on coder-participation
    relay/julius-reviewer-transient-upstream        stacked on the above

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
