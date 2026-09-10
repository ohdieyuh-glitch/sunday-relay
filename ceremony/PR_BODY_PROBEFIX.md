> **This PR targets Sunday Relay only.**
> **This PR must be squash-merged.**
> **Do not merge without founder authorization.**
> **This PR does not itself dispatch a paid mission.**

Base SHA: `d7af081b7404e3b1d42ee7a96ce3a1a05893527a`
Head SHA: `bafc36039826eb09a9b6c71bcb16c7bc4c4a51a6`
Tree SHA: `17bd24a0e3e26bfcc6e5bb14f47fa194edd91547`
Commits: 1

## Relay Product Scope

One repair to the zero-spend preflight, its new module, its tests, and the docs
that were made false by it. No website, no CLI action, no workflow change, no
deployment config, no new dependency, no change to any Julius production file —
`JULIUS_HARNESS_MANIFEST.md` is unchanged and verifies current.

## What happened

Paid Live Mission 4's zero-spend preflight failed in two seconds, at no cost, on
trusted main `d7af081b` — Actions run **34433098911**. Steps 1–17 were green,
**including step 14, the provisioner**, so slice mode and the seed overlay both
work on a real runner. Step 18:

```
PREFLIGHT FAILED: ENOENT: no such file or directory,
open '/tmp/julius-workspace/tenant/ws/README.md'
```

Steps 19 onward were skipped. **No provider was contacted and nothing was
spent.** The gate did exactly its job. What failed was an assumption *inside*
it.

## What was actually wrong

The preflight's decisive check writes a marker into a workspace file **on the
host** and requires it to appear in a diff captured **inside the sandbox**. That
is the mission's own hand-off, and a break in it hands the Independent Reviewer
an empty diff after an architect and a coding agent have already been paid.
Proving `git rev-parse` alone would not catch it, which is why the check exists.

The check needs a file `git diff` will report — **tracked**, and **text**. It
named one: the literal string `README.md`.

Every mission seeded from a throwaway tree happens to ship a `README.md`, so the
assumption survived three paid missions without ever being a stated requirement
of a mission workspace. **Mission 4 is the first slice mission** — its workspace
is `git archive` of three real Relay files plus one overlaid spec — and it has
none. Measured across all four missions, with the old requirement applied:

| Mission | tracked `README.md` | tracked files |
|---|---|---|
| `julius-first-live` | yes | 4 |
| `julius-live-mission-2` | yes | 4 |
| `julius-live-mission-3` | yes | 4 |
| `julius-live-mission-4` | **no** | 6 |

The `JULIUS_PROJECT_ID: prj-julius-first-live` visible in that job's env dump is
**not** related, and was checked rather than assumed: missions 2 and 3 also
declare their own `projectId` and both ran. It scopes the preflight's disposable
identity, not the mission's project.

## The repair

**`scripts/julius-live-probe-file.ts`** (new, 0 imports) picks the probe file
from a list of tracked paths. Deterministic, in three tiers:

1. `README.md` when git tracks it — so the three earlier missions probe exactly
   the file they always probed and their preflight output is unchanged;
2. ordinary paths, in git's own (sorted) order;
3. `.julius/` tooling paths **last**, so a slice mission probes mission source
   rather than its import harness.

It rejects, with a reason each, what git would not diff usefully: unreadable
(`unreadable:ENOENT`), larger than 1 MiB, containing a NUL byte, or not valid
UTF-8 — the last two because git renders such a file as `Binary files differ`
and the marker would never appear no matter how well the hand-off worked. It
reads nothing itself; the reader is injected, so the choice is a pure function
of the tracked list and the bytes on disk.

**`scripts/julius-live-preflight.ts`** now asks the **sandbox's own git**
(`git -c core.quotePath=false ls-files`) — the same view that will capture the
mission's diff, so it is the view that must agree the file is tracked — names
the file it picked in its output *and in every failure message*, and restores it
as **bytes** rather than a decoded string, so a missing trailing newline or a
CRLF ending cannot become a diff the mission never asked for. A workspace with
nothing tracked and readable is a **stated failure**, not a skip.

Chosen, against each real mission workspace:

```
julius-first-live      -> README.md (318B, examined 1/4)
julius-live-mission-2  -> README.md (457B, examined 1/4)
julius-live-mission-3  -> README.md (496B, examined 1/4)
julius-live-mission-4  -> src/relay/mission/julius/julius-memory-trust.test.ts (9908B, examined 1/6)
```

## The seam, because the seam is what broke

The chooser is pure and the preflight is a script with a database, an executor
client and four credentials — so the code *joining* them is the one part neither
a unit test nor a build reaches. That join is precisely what broke: the old
preflight's entire probe-file logic was `join(workspace, 'README.md')`, fifteen
untested characters between two well-tested things.

So the join is a function too — `resolveProbeFile(run, read)` — with the sandbox
injected. The preflight passes its real `runInSandbox`; the tests pass one that
shells to real git in a real provisioned mission workspace. `PROBE_LIST_COMMAND`
is exported and asserted, so the tests drive the seam rather than a paraphrase.

## The guard that would have caught it

`scripts/julius-mission-slice.test.ts` now provisions **every** mission in
`.github/julius-missions/` the way the provisioner does — both seed kinds,
slice + harness + overlay, or the throwaway tree — and asserts the probe can be
satisfied: a tracked text file is chosen, `resolveProbeFile` reaches that same
file, the marker reaches `git diff`, and restoring leaves `git status` clean.

**Mutation-tested, three ways:**

| Mutation | Result |
|---|---|
| restore the old hardcoded `README.md` behaviour | **1 failed** — precisely `julius-live-mission-4` |
| drop the NUL-byte rejection | **3 failed** |
| send the sandbox a different list command | **4 failed** |

A future mission whose workspace cannot satisfy the preflight is now a red
`npm test`, at the cost of nothing, rather than a dispatched workflow run.

## Two now-false sentences, corrected

- The preflight's header claimed "the only commands it runs are
  `git rev-parse HEAD` and `git --no-pager diff`". It now also runs
  `git ls-files`; the header says so.
- The receipt-scope proof was described by **counting** — "while its third
  sandbox exists" — in the source comment and in `docs/JULIUS_BETA_READINESS.md`.
  This change adds a round-trip, and an ordinal that has gone stale once should
  not be load-bearing. It is named by its role instead.

`docs/JULIUS_MISSION_SANDBOX.md` gains "the one thing every mission workspace
must contain", and `docs/handoffs/JULIUS_CURRENT.md` gains §00m.

## The lesson

Three paid missions passing did not make `README.md` a property of a mission
workspace — it made it a coincidence nobody had had reason to notice. The
preflight is the right gate and it fired correctly and cheaply; the repair is to
stop it asserting something no test held it to.

## Gate

`npm test` **9,859 passed / 0 failed** across 511 files (3 skipped, 30 todo);
`typecheck` (4 passes); `build`; `relay:build`; `relay:bridge:build`;
`relay:julius:preflight:build`; `relay-repository-boundary`;
`relay-parity-gate`; `relay:surface-parity:check:strict`; `relay:yc-demo:check`;
`relay:cli:contract-verify`; `export-julius-harness --check` **current**;
`git diff --check`; `relay:persistence:contract-verify`;
`relay:persistence:recovery-drill`; `relay:workspace:verify`;
`relay:claude:contract-verify`.

## What this PR does NOT claim

The repaired preflight has **not** been run against the real executor and
sandbox: the repository trust gate requires `refs/heads/main` on *every*
dispatch, dry or paid, so a branch cannot be dry-run — correctly, and not
something to weaken for convenience. What is proven here is the chooser and the
seam against real git in real provisioned mission workspaces, plus a clean
build of the preflight bundle. The executor round-trip mechanics are untouched;
the change adds one `git ls-files` call through the identical `runInSandbox`
helper that already carries `git rev-parse HEAD` and `git --no-pager diff`.

The first thing after this lands is the zero-spend preflight on the new trusted
main. Mission 4 does not dispatch until it passes.
