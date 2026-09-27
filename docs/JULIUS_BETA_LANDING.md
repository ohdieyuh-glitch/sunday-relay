# Landing `relay/julius-beta-qualification`

**This page is the ceremony's input, not a narrative.** It holds the PR body, the
facts a reviewer needs before reading 32 commits, and the things this branch
does NOT claim. The landing itself is a founder act: this lane never pushes with
the founder's credential and never merges its own work — see
`ceremony/push-as-worker.sh` and the worker-App notes.

## The state of the candidate

| | |
|---|---|
| Branch | `relay/julius-beta-qualification` |
| Base | `origin/main` `a384b215` (#287), unmoved at the time of writing |
| Commits ahead | 36 |
| Commits behind | 0 — merges with no conflict (`git merge-tree`: none) |
| Worktree | clean; `git diff --check` clean |

**Gates that can run on the founder's Windows workstation, all passing:** the
three typechecks (`tsc -b`, `relay-bridge`, `scripts`), the repository boundary
scan, the parity gate and both surface-parity checks, the YC/demo readiness
check, the CLI contract verification, the website build, the CLI build, the
Hermes service build, the bridge bundle, and the Julius harness manifest check.

**Gates that cannot run here, and why:** `npm test` whole-suite (the machine has
~7 GB free with an Unreal editor resident; two attempts were killed for memory,
so the suite is measured per directory at `--maxWorkers=2` instead — Julius
kernel 1,900/1,900, bridge Julius 590 passing with one Windows-only `npx ENOENT`,
persistence real-PostgreSQL 42/42 against a local container). The POSIX
file-mode suites (`persistence.test.ts`, `lock-reclaim`, `beta-enrollment-node`,
`durable-mission-node`) fail on Windows before and after this branch. CI on
Linux is the authority on green, and that is what the PR is for.

## PR body

> Copy the section below verbatim as the pull request description. The trailer
> is required by this repository's attribution rule.

---

**Julius private-beta qualification: the MVP loop, made truthful end to end**

This branch takes Julius from "the pieces exist" to "the loop runs, and the
record says what happened". It is one lane's work on the founder's MVP
objective: a user gives Julius a useful objective, Julius structures it,
executes it, keeps trustworthy state, detects failure, reviews independently,
repairs, and returns a verified result with evidence.

**What was found and fixed, rather than added**

- Two modules were counted as capabilities while every exported function threw
  (`julius-context-integrity`, the memory trust core). Implemented, wired into
  the real dispatch path, and readiness corrected downward at the time.
- Every trajectory measurement column was null on every successful dispatch, so
  every cost, token count and duration the eval layer reported was an empty
  projection.
- A sub-agent could hold the Independent Reviewer role.
- The whole-evidence-chain proof (`julius-live-chain.e2e`) had been failing on
  `origin/main` and every branch since the charged-findings rule landed, and no
  workflow ran it — a dead proof nobody was reading. Revived, and put in the
  workflow.
- `workspaceContained` never checked `isAbsolute`, so on Windows another drive
  and a UNC share read as CONTAINED — and that predicate gates what the Docker
  executor mounts. Every POSIX case passed, which is how it survived.
- A commit message claimed a change (one shared pg pool) that a skipped patch
  had never applied. Corrected in the tree and recorded in the handoff.

**What is new**

- **Context integrity on the real path**: authority ranking, conflict detection,
  fail-closed on an unresolved clash, and the decision durable (migration 025).
- **A claim store at its minimum** (migration 026): a memory's standing, durable
  with its history; every brain write admits a claim; an accepted independent
  review promotes the reviewed work's entries through the trust core, which
  refuses self-verification by name; the compiler reads the recorded standing.
- **Knowledge that outlives its mission**: the bootstrap inherits the project's
  VERIFIED and APPROVED claims into each new mission, keeping each fact's
  author, evidence and standing — capped, never across projects, never from the
  run doing the carrying.
- **A content refusal is a class on all three peers, and it is ROUTED**: Julius
  raises the guidance itself, the architect restates the ask, the work continues
  in a continuation segment, and the refused task ends SKIPPED rather than
  failing the mission. One re-plan per unit, bounded by durable state. A
  declined REVIEW is deliberately not re-planned.
- **Wonderland can create and observe a mission over the bridge**:
  `POST /relay-api/julius/missions` (bootstrap only, `dispatched: false`) and the
  read-only run/slots/tasks/evidence/verification/timeline views, both operator
  only, both over the same PostgreSQL store the mission job writes through.
- **One active run per mission**, with an explicit rerun path that requires a
  caller-supplied key, because nothing derived from durable state can identify a
  rerun safely.
- **Test writes can no longer reach the live database**: real-PostgreSQL suites
  read `JULIUS_TEST_DATABASE_URL` only, with a sweep test that fails if any test
  file reads `DATABASE_URL` again.
- **Provider qualification keyed to the served model**, and a Learning Loop that
  measures and gates without writing.

**What this branch does not claim**

- No paid provider ran for it. Every proof here is deterministic or against a
  real PostgreSQL; the representative paid qualification mission is still
  outstanding and is the founder's to authorise.
- No Unreal change has been made under Julius's contracts.
- The Docker executor's sibling proof needs a Linux runner and did not run here.
- `npm test` whole-suite has no number from this workstation (memory), so CI is
  the authority.

**Independent evidence from the integration lane** (quoted verbatim, at their
request, and attributed to the tree the drill ran on):

> Integration lane: the Wonderland↔Julius drill
> (`scripts/wonderland-julius-create-observe.mjs`,
> `relay/wonderland-julius-integration` @ `6191dc11`, which contains Julius
> `00fa52ad`) passes 36 of 36 clauses at zero spend. It ran against the
> production bridge binary and an isolated PostgreSQL, and covers: mission
> creation and read-back; the Mission Contract projection (READY shown as
> Queued); the native Unreal client's single-use pairing and world stream; and
> one active run per mission, including the keyed explicit rerun under a real
> six-way race (exactly one new run, no two answers claiming it). This is
> wire-level evidence only: the in-engine (PIE) acceptance has not run yet.

The diff from `00fa52ad` to this branch's head is documents and test files only
— no runtime code — so that verdict covers the runtime as it stands. It was
written by the lane that found three real defects in this one's code (the
Windows containment hole, and both rerun defects), which is the kind of
witness worth quoting.

**Where the detail lives**: `docs/handoffs/JULIUS_CURRENT.md` §000d (read that
first), `docs/JULIUS_BETA_READINESS.md` (the scorecard and its arithmetic),
`docs/JULIUS_MVP_QUALIFICATION.md` (every claim resolved to a case),
`docs/JULIUS_WONDERLAND_CONTRACT.md` (what the bridge serves and what it
refuses), `docs/JULIUS_TRACE_CORPUS.md`.

---

## What the reviewer should be sceptical about

1. **The readiness number.** 79%, computed from the table's own weights; the
   arithmetic has been wrong twice on this page and was corrected both times.
   Recompute it rather than trusting the headline.
2. **Every "proven" claim is a named case.** `docs/JULIUS_MVP_QUALIFICATION.md`
   is machine-checked — the test resolves every file and requires every case
   reference to exist — but it does not check that the case PASSES. `npm test`
   does.
3. **A deterministic proof is not a live one.** Where a row says DETERMINISTIC,
   a provider was replaced at its own boundary. That proves Julius and nothing
   about a model.

## After the merge

- Run the paid representative mission (founder), and record served models per
  peer; two provider legs are COMPATIBLE-not-VERIFIED until then.
- Run `julius-real-infra.yml` on Linux for the Docker executor proof, the
  whole-evidence-chain suite, and the claim-standing suite.
- The Wonderland integration lane is building the Unreal client against
  `docs/JULIUS_WONDERLAND_CONTRACT.md`; its drill exercises these routes over
  the built bridge binary against its own isolated database.
