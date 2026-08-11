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

| PR | What | Reviews | Suite |
|---|---|---|---|
| #118 | Defect 3 — the served reviewer model | 2 rounds, 24 mutation proofs | 6930/6930 |
| #119 | Configurable Repository Targets | 1 round: 1 Critical, 2 High, 14 more — all repaired | 1173/1173 on the affected files |
| #120 | Wonderland | 1 round: 5 High — all repaired | 123/123 |
| #121 | Frontend polish | 2 rounds: 3 High, 4 Medium, 3 Low — all repaired but one, deliberately left open | see below |

---

## The two things that cannot be finished from here

Both are **verified** boundaries, not assumptions. Each names the exact action.

### 1. The paid three-role run against a real repository

**Status: the pipeline carries a real repository target end to end and refuses
correctly. No PAID role has ever run against one.**

Measured in this environment: `XAI_API_KEY`, `OPENAI_API_KEY`,
`ANTHROPIC_API_KEY` and `RELAY_BRIDGE_API_TOKEN` are all **absent**.
`~/.hermes/auth.json` exists but is the founder's own Hermes credential, and
`CLAUDE.md` forbids touching it — using it would be spending the founder's money
without being asked.

So the architect and the reviewer are injected in every end-to-end test. That is
stated in the tests themselves rather than glossed.

**What would close it.** With a registered local repository and credentials set:

```
XAI_API_KEY=…  RELAY_HERMES_MODEL=grok-4  RELAY_HERMES_PROVIDER=xai \
OPENAI_API_KEY=…  OPENAI_PROMPT_ARCHITECT_MODEL=gpt-4o  RELAY_PROMPT_ARCHITECT_MODE=live \
  node dist-relay-bridge/server.cjs
```

then start a Mission with a `repositoryTarget` and `intendedWritePaths`. Two
things to watch, because they are the unproven halves:

- **Does xAI populate `model` in Hermes' usage report?** Probed directly here
  (Hermes v0.18.2, isolated `HERMES_HOME`, no credential, nothing spent): the
  binary accepts `--usage-file`, writes the file even on failure, and its schema
  carries `model` AND `provider` keys — so Relay reads the right field from the
  right file. The value was `null` because the run failed at the credential.
  **One real review settles it**, and both outcomes are already truthful:
  populated → attested; absent → `servedModel: null` and the words "served model
  not reported by the provider".
- **Does Grok review a real repository's diff well?** Unknown and unspent.
  `HOSTED_MISSION_EVIDENCE.md` already records that reviewer behaviour on larger
  diffs is untested, and a real repository makes the review packet much larger.

**Operator invariant, unchanged:** never deploy the bridge while a Mission is in
flight. The registry is an in-memory `Map` and a redeploy destroys a paid run.

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
2. **No durable store** for registrations.
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
