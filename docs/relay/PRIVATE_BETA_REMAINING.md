# Private beta — what is proven, and the two things that need the founder

Written 2026-08-11 at the end of the Wonderland + Repository Targets goal. Its
purpose is to be exact about the boundary between *built and proven* and *built
and unproven*, so nobody has to reconstruct it later.

Four PRs. Every one has been through at least one independent read-only review;
all four have been through a review-and-repair cycle, and **every review found
real defects, including defects introduced by the previous round's repair.**

A second pattern is worth naming, because it recurred across every PR and cost
more time than the defects did: **the check that exists rather than the check
that holds.** Repeatedly, a guard was written, shipped, and only later probed —
and the probe showed it had never been able to fail. The parity parser filtered
for a token that its own split had already discarded; the CSS scanner read a
comment as a selector and so examined half its subjects; a gradient scanner
stopped at the first `)`, which belonged to the colour, and never reached the
value it was checking. Each read as working. The discipline that catches this
is not more review — it is reverting the fix and requiring the named test to
fall. Where that is done, the guards are real; where it is skipped, roughly one
guard in five proves inert.

| PR | What | Reviews | Suite | State |
|---|---|---|---|---|
| #118 | Defect 3 — the served reviewer model | 2 rounds, 24 mutation proofs | 6930/6930 | **MERGED 55c03b4** |
| #119 | Configurable Repository Targets + the shipping runner | 1 round: 1 Critical, 2 High, 14 more — all repaired | 225/225 on the affected files | open, CI running |
| #120 | Wonderland | 1 round: 5 High — all repaired | 123/123 | **MERGED c6a0d2b** |
| #121 | Frontend polish | 2 rounds: 3 High, 4 Medium, 3 Low — all repaired but one, deliberately left open | 6917/6917, full gate green | open, re-review running |

---

## The two things that cannot be finished from here

Both are **verified** boundaries, not assumptions. Each names the exact action.

### 1. The paid run is DONE; the SHIP path is built; the LIVE GitHub ship is the founder boundary

**Build → verify → review → VERIFIED COMPLETE is proven live.** On 2026-08-12 a
real paid three-role mission ran in production and reached `verified_complete`
(`mission-live-proof-1786524602`). The reviewer served `grok-build-0.1`,
attested from Hermes' actual usage — DEFECT 3 CLOSED AGAINST A REAL RUN — and the
architect's `gpt-4o` → `gpt-4o-2024-08-06` was classified a resolution, not a
substitution. See `HOSTED_MISSION_EVIDENCE.md`. The founder provided the Railway
token; `XAI_API_KEY` lives on the Hermes service, `OPENAI`/`ANTHROPIC` on the
bridge. The old "all credentials absent" note is superseded.

**The SHIP path is built and tested on the ship-wiring branch (not yet on main).** register a
repository (operator route) → durable store → `/mission/start` resolves the key
into a target (operator-only) → the coding leg builds/verifies against it and
RETAINS the verified worktree → `POST /mission/:id/ship` re-observes and
re-judges that worktree and runs COMMIT → DEPLOY → LIVE VERIFY → SHIPPED. Every
seam has real-git / real-deploy / real-HTTP tests and mutation proofs. This
lives on the ship-wiring branch and touches the money-spending auth handler, so
it is independently reviewed before it merges.

**What is NOT done, and is a genuine founder boundary:** the LIVE GitHub ship —
the actual PUSH / PR / MERGE against a real GitHub repository. It needs, and only
the founder can provide:

1. the ship-wiring branch reviewed, merged, and deployed;
2. a real GitHub repository Relay is authorized to write to;
3. a push credential (`GITHUB_TOKEN`) — verified absent on Railway, so it must
   be set;
4. explicit ship authorization for that repository.

Relay must never infer the target repository or the production authorization —
`POST /mission/:id/ship` is operator-only and separately authorized precisely so
neither is implied by "build this."

### 2. Wonderland compiled and playable

**Status: the Relay↔Unreal contract is parity-checked in both directions and the
C++ has never been compiled.**

No Unreal Engine binary exists in this environment. The parity test proves the
shapes agree with TypeScript and that no field escapes the parser; it proves
nothing about whether UnrealHeaderTool accepts the reflection, whether the module
links, or whether anything renders.

**What would close it.** Unreal Engine 5.4, then open `wonderland/Wonderland.uproject`
and build the `Wonderland` module. Specific things that may fail on first
compile, listed so the failure is expected rather than surprising: the
`USTRUCT`/`UENUM` reflection, `int64` and `double` `UPROPERTY`s, `TObjectPtr`
usage, and the `WONDERLAND_API` macro, which is assumed to be UBT-generated.

The level itself does not exist — there is no `.umap`. `ApplyWorldState` has no
caller, and the HTTP transport between the bridge and the client is deferred.
Those are listed in `WONDERLAND.md` §11 as deferred, and they are the difference
between "the contract is real" and "the world is playable".

---

## What IS proven, offline and for real

Worth stating precisely, because "offline" is not the same as "simulated":

- A **real** `git init` repository, a **real** isolated `git worktree`, real files
  edited by a real child process, and Relay observing what actually changed from
  git rather than from any agent's claim.
- The source repository **byte-for-byte unchanged** with `git status` clean
  afterwards — asserted on the failure path as well as the success one.
- A **real** HTTP server and a **real** `fetch`: SHIPPED only when the running
  system reports the committed revision; **not** shipped on a stale one; **not**
  shipped when nothing is listening.
- Refusals that fire before a worktree exists, an agent starts, or anything is
  spent: a remote target with no provider, a Mission with no declared files, an
  out-of-scope path, a protected path, a missing `write_worktree`.
- Defect 3's chain proven against a fake `hermes` writing a real usage file and a
  fake service returning a real usage block.
- **The lifecycle is WALKED, not merely decided.** `grep shipStage relay-bridge`
  used to return nothing: `repository-lifecycle.ts` could decide every step of
  `COMMIT → PUSH → PR → MERGE → DEPLOY → LIVE VERIFY → SHIPPED` and nothing ever
  asked it. `ship-runner.ts` now walks the credential-free part end to end and
  stops at the first refusal, reporting the stage it REACHED. PUSH/PR/MERGE stay
  out deliberately — they need a remote credential, and a runner that skipped
  them and still said `shipped` is the failure it exists to prevent.
- **A revoked grant lands mid-run**, because the registration is re-READ at each
  step rather than captured once. This was a value field whose comment claimed
  it was re-read; mutation testing showed deleting the revalidation entirely
  changed no test, because nothing could change between steps.
- **A ship run reaches Project Brain.** `repository-brain-feed.ts` was built and
  had no caller. A not-shipped verdict is recorded under `error`, because a
  Brain fed only the runs that worked learns that everything works. Nothing is
  promoted to long-term memory: a run is an episode, not a durable fact.

## What is NOT built, and is not pretended to be

`REPOSITORY_TARGETS.md` carries the full list. The load-bearing ones:

1. **The remote provider exists and has never made a request.**
   `github-remote-provider.ts` implements the port with an injected fetch and is
   proven offline — credential never surfaced, provider body never surfaced,
   segments validated before they reach a URL, merge confirmed by reading it
   back. The dangerous operations are unreachable rather than refused: no
   `force` field, no ref deletion, no repository creation. But no credential
   exists here, so not one real call has been made, and the mission engine does
   not invoke it at the `pushed`/`pull_request_open`/`merged` stages yet.
2. **No durable store** for registrations. They are built and read as values, so
   a bridge restart loses every one — and registration is the authorization
   spine, so after a restart no Mission can target a repository until a human
   re-registers it. The store belongs in `src/relay/persistence` on the same
   key/value backing as the others; `beta-enrollment-node.ts` is the precedent.
   This is the largest remaining credential-free gap and it is NOT started.
3. **Review-packet fidelity at real repository size is unproven** — the design
   document flags this as the highest-risk remaining item, and three defects in a
   previous goal were display sanitizers truncating machine-read payloads.

---

## The pattern this goal produced, recorded because it will recur

Across four PRs and five review rounds, the recurring defect was never a crash.
It was **a check that existed rather than a check that held**:

- a parity test whose regex could not cross a `)`, so a field named
  `bWonderlandApproved = true` was added to both sides of an authority boundary
  and 98 tests passed;
- an "ordinal 0" check that read the first declared *name* instead of the value;
- a rename that hid the deletion of a protected CI file, saved only by the text
  format of a diff summary;
- `git add -fv` walking past a deny-list containing `-f`;
- three guards a document headlined with no test coverage at all.

And twice, a guard **hid what it was written to find**: a symlink check that
reported deletions as symlinks, and an unreflected-member detector whose own
filter discarded the whole struct.

The technique that caught all of them is the same one: apply the mutation, watch
the named test fall, and when it does not fall, treat that as the finding.
