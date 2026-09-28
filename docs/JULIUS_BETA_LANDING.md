# Landing `relay/julius-beta-qualification`

**This page is the ceremony's input, not a narrative.** It holds the PR body, the
facts a reviewer needs before reading 47 commits, and the things this branch
does NOT claim.

**The ceremony is `docs/JULIUS_WORKER_PR_RUNBOOK.md`, and until 2026-09-27 this
line named `ceremony/push-as-worker.sh` — a path that has never existed in this
repository.** It was the exact failure this page warns about two sections below:
a reviewer sent chasing a phantom. The runbook is real, it was walked once for
PR #237, and its three steps divide cleanly by authority:

| Step | What it does | Who |
|---|---|---|
| 1 | re-author the candidate's commits as the App on a NEW branch, reference untouched | this lane |
| 2 | mint an installation token, push, open the PR **as the App** | this lane |
| 3 | approve at the head SHA, squash-merge at that head | **the founder, and only the founder** |

Step 3 is not a courtesy. `scripts/julius-main-provenance.mjs` requires the
landed PR's author to be `julius-worker[bot]` and its approver to be a
*different* login, so the lane that wrote the code is structurally incapable of
completing its own landing. That is the point of the gate.

## The state of the candidate

| | |
|---|---|
| Branch | `relay/julius-beta-qualification`, head `c9877602` |
| Base | `origin/main` `a384b215` (#287), unmoved at the time of writing |
| Commits ahead | 47 |
| Commits behind | 0 — merges with no conflict (`git merge-tree`: none) |
| Worktree | clean; `git diff --check` clean |
| Authored by | `Claude <noreply@anthropic.com>` and `julius-stack-rehearsal <rehearsal@local.invalid>` — **neither is the App**, which is what Step 1 of the runbook exists to correct |

**Gates that can run on the founder's Windows workstation.** Run them, do not
take this list on trust — the list below is the command, so it can be repeated:

```
npm run typecheck                       # FOUR steps: root, relay-bridge, relay-hermes-service, scripts
node scripts/relay-repository-boundary.mjs
node scripts/relay-parity-gate.mjs
npm run relay:surface-parity:check && npm run relay:surface-parity:check:strict
npm run relay:yc-demo:check
npm run relay:cli:contract-verify
npm run build && npm run relay:build && npm run relay:hermes:build && npm run relay:bridge:build
npm run julius:harness:verify       # export THEN check: see the note below
git diff --check
```

All of them pass at this branch's head. **`npm run julius:harness:verify`, not `:check`.** `generated/JULIUS_HARNESS_SOURCE.txt`
is gitignored and stamps the HEAD it was generated at, so `--check` alone compares
an artifact that is stale the instant a commit lands — and on a clean checkout it
fails outright with "export missing". A gate that cannot pass on a fresh clone
sends a reviewer chasing a phantom, so the gate is export-then-check, which is
what actually asserts something: that the TRACKED manifest
(`JULIUS_HARNESS_MANIFEST.md`) is current, that every exported file still hashes
to its source, and that the trace reaches what it claims. This lane ran the two
halves by hand all session and never noticed the list was wrong.

**`npm run typecheck` is listed first
because it is the one this lane broke and did not notice:** its FOURTH step
(`scripts/tsconfig.json`) failed for several commits while every individually
invoked check the lane ran was green, and vitest — which does not typecheck —
ran the offending file happily. The integration lane found it by running the
gate rather than the parts. Run the gate.

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
- **Many missions, one loop**: three missions interleaved to verified
  completion, cross-mission isolation asserted over the packets each worker was
  handed (not just the rows), a failing mission that does not take its
  neighbours down, and twelve missions measured.
- **The founder's fourth mission class has rows**: an everyday planning mission
  completes through the same lifecycle, and a mission whose acceptance needs an
  action no tool can take does NOT complete.
- **Provider neutrality is structural**: a sweep fails if any kernel file names
  a vendor, a model or one of the trio's adapter ids in code; two exemptions,
  each with its argument.
- **The loop's last step has a projection**: `GET .../result` — verified (the
  runtime's own completion decision, quoted), every criterion with the basis it
  was judged on, the deliverables (a product, never a reviewer's finding), the
  cost with its unknowns, and a failure a failed run can always name.

**What this branch does not claim**

- No paid provider ran for it. Every proof here is deterministic or against a
  real PostgreSQL; the representative paid qualification mission is still
  outstanding and is the founder's to authorise.
- No Unreal change has been made under Julius's contracts.
- The Docker executor's sibling proof needs a Linux runner and did not run here.
- `npm test` whole-suite has no number from this workstation (memory), so CI is
  the authority.

**Independent evidence from the integration lane** (quoted verbatim, at their
request; the acceptance ran on `relay/wonderland-julius-integration` @
`69dda2a4`, which carries Julius `b46092af`, against Wonderland Core's builds
`8cccaa50` and `b281f6a1`):

> Integration lane: the first in-engine (PIE) Wonderland↔Julius acceptance
> passed every data clause at zero spend, on the production bridge against an
> isolated PostgreSQL. A signed-in player's single-use code paired the Unreal
> client. The world adopted the exact run Julius created (same runId and
> missionId, READY, mapped to QUEUED in the Mission Contract's task set). It
> switched to a second run of the same mission and back. A dropped link read
> STALE with the mission untouched, and both reconnect and a full play restart
> recovered the same durable run. From Julius's side both runs stayed READY and
> never dispatched, and an identical resubmission was the same run. One criterion
> A second pass on Core's build b281f6a1 (attempt 853f3956f00747b1, all 23
> clauses) met the remaining visible criterion: the Missions panel names the
> mission and shows 'QUEUED through Julius. Run <runId>. Julius reports READY.'
> under a JULIUS LIVE badge, before and after a full play restart. One surface
> still disagrees: the HUD strip's headline reads 'UNOBSERVED' beside a live link,
> and Wonderland Core is correcting it.

The second pass ran on Julius `b46092af` — this branch's head — so the verdict
covers the create/observe contract as it stands. It does NOT cover the `result`
view: no Unreal client has called it yet. The witness is the lane that found three real defects in this one's
code (the Windows containment hole and both rerun defects), which is why it is
quoted rather than paraphrased.

**What that acceptance settles, and what it does not.** The DATA path is proved
in the engine — a player pairs, the world adopts the exact run Julius created,
switches between two runs of one mission, survives a dropped link and a play
restart, and Julius's own side shows both runs READY and never dispatched — and
the visible panel now names the mission and its run under a JULIUS LIVE badge,
across a play restart. Three things are still NOT proved, and none of them is
proved by that acceptance: the HUD strip's headline still reads UNOBSERVED beside
a live link (Wonderland Core's to correct); **no run in it ever EXECUTED** — both
runs stayed READY and never dispatched, because dispatch is where money is spent;
and no Unreal client has called the `result` view, so the projection a user would
be shown has never been rendered.

**Where the detail lives**: `docs/handoffs/JULIUS_CURRENT.md` §000d (read that
first), `docs/JULIUS_BETA_READINESS.md` (the scorecard and its arithmetic),
`docs/JULIUS_MVP_QUALIFICATION.md` (every claim resolved to a case),
`docs/JULIUS_WONDERLAND_CONTRACT.md` (what the bridge serves and what it
refuses), `docs/JULIUS_TRACE_CORPUS.md`.

---

## What the reviewer should be sceptical about

1. **The readiness number.** 80%, computed from the table's own weights; the
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
