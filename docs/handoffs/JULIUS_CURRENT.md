# Julius — current engineering state

> **This file is the durable record.** Claude Code session history disappears;
> repository evidence does not. Update it whenever meaningful state changes and
> before ending a session. Never rely on `/resume` as the sole record.

**Most recent session:** 2026-09-08, the **Claude Code cloud session**. Read
**§00** first: it holds the current branch, the commits it added, a security
finding about the merge-provenance credential, and the founder-only actions
that gate everything else. **§00h** is the newest work: stale-handoff
rejection, the reviewer-binding guard, the challenge leg of the contract
lifecycle, and the concurrent-proposal fix a real PostgreSQL race found.
Everything from §0a onward is the earlier local record.

---

**Session date:** 2026-09-06
**Checkout:** `/home/thomasajvt13/dev/sunday-relay-main` (a linked worktree)
**Branch:** `relay/coder-ceiling-mission-budget`
**HEAD:** see §8 for the current commit list (the branch is rebuilt as work lands)
**Base:** `origin/main` = `b2dc9f239eeb54764beca97a2966afa24c7cc3a4` (#233)
**Working tree:** clean; ahead of `origin/main`, **not pushed**.

---

## 0. PAID LIVE RUNS 2026-09-08 — #234 LANDED, AND THE ARCHITECT GATE IS THE NEW WALL

**`origin/main` = `872f1790465c4d519d9a89c7e525fdaf23f5c3d0`** — PR #234, squash
merged, founder-approved at the exact head `be949de2`. Every trust input
verified independently before any dispatch:

| Gate input | Verified |
|---|---|
| main's tree | `80d0cbe5…` — **identical** to the reviewed head's tree |
| main's parents | exactly one (`b2dc9f23`), a squash |
| candidate author | `julius-worker[bot]` ✓ |
| approval | `APPROVED` by `ohdieyuh-glitch` at `commit_id be949de2`, author ≠ approver ✓ |
| parent containment | `b2dc9f23` is contained in the reviewed head ✓ |
| monotonicity | both live checkpoints (`f131098c`, `67ade6ea`) contained in main ✓ |

The workflow's own gate agreed: **"the code this job will run is reviewed,
current and not rolled back" — success**, on every dispatch below.

### Run 34185756926 — ZERO-SPEND PREFLIGHT — **PASS** (2m07s)

Inputs: `mission=julius-live-mission-2`, `confirm_live=""`,
`acknowledge_rerun="RERUN PAID MISSION"`, `max_ticks=32`, `hermes_ref` default.

Every stage green: trust gate, input gate, PostgreSQL 16 + independent executor,
**Julius cannot reach the executor signing key**, receipt transport private to
root and the executor, durable store + attestation + sandbox + in-sandbox git,
Hermes install and ephemeral reviewer profile, Mission Contract valid and
bounded, and all three roles resolving —
`architect=gpt-5.6-sol coder=claude-fable-5 reviewer=xai/grok-build-0.1`.
The LIVE step was **skipped**; the attempt marker was **not** written.
**Provider calls: zero.**

### Run 34185920678 — PAID — **FAILED at the Prompt Architect**

Inputs identical except `confirm_live="RUN LIVE MISSION"`.

| Field | Value |
|---|---|
| trusted-main SHA | `872f1790465c4d519d9a89c7e525fdaf23f5c3d0` |
| mission | `mission:julius-live-2`, project `prj-julius-live-2`, namespace `julius-live-mission-2` |
| durable run | `run:4bf13d0e833a042c74f57555` |
| budget | ceiling **$20**, 3 repair cycles; architect allocated **300,000 µUSD** on basis `ESTIMATE`, policy `julius-allocation.v1`, remaining 20,000,000 µUSD |
| provider calls | **one** — OpenAI, `gpt-5.6-sol`, response `resp_06601f0695580df5016a9f8ad2a46487d1b9328985008d1eb9` |
| actual cost | **not reported by the provider** — Unknown, not zero; no settlement row |
| architect output | 14,581 bytes, `json_detected=true`, `json_parseable=true` |
| architect state | `validation_passed=false`, `validation_reason_code=`**`plan_false_work_claim`** |
| coding agent | **never dispatched** |
| diff captured | none (`workspace.diff` empty, `workspace-status.txt` empty) |
| reviewer | **never dispatched** — no stage, no input, no findings |
| repair trajectory | **none minted** |
| verification | **no decisions** |
| final durable state | `plan` **FAILED**, `build` **BLOCKED**, run **FAILED** after 1 tick |

**#234's four repairs all held, and three of them are visible in this record:**
`build` stayed **BLOCKED** rather than running against an unreviewed plan
(defect 4); **no unroutable `repair:plan` was minted** (defect 3); the coder
was allocated from the mission's own contract via `julius-allocation.v1`
(defect 1's chain, exercised as far as the architect's own reservation). The
stage-aware reviewer (defect 2) was not reached.

**But Task 2 is NOT complete.** The run never crossed the boundaries that
previously failed — no coder dispatch, no diff, no review — because it died
earlier, at a gate run 34037313976 never reached.

### Run 34186711214 — PAID — **FAILED identically**

Dispatched only to answer one question: is the trip a property of the model's
sampling, or of the rule? Inputs identical to 34185920678.

| Field | Value |
|---|---|
| provider calls | **one** — OpenAI, `gpt-5.6-sol`, response `resp_09fd5357c9101906016a9f8dc0f38087d1928c14addf805e51` |
| architect output | **14,550 bytes** (against 14,581) — a different sample of the same mission |
| architect state | `validation_passed=false`, `validation_reason_code=`**`plan_false_work_claim`**, `validation_field=`**empty** |
| everything downstream | identical to 34185920678: no coder, no diff, no reviewer, no repair, no decisions |

**Two independent samples, same rule, same wall.** That settles it as
systematic rather than sampling-dependent, and it is why **no further paid
rerun is justified until the fix is on `main`** — a third would be the
"endlessly rerunning an unchanged failure" the paid-run authorisation
explicitly excludes.

### The first causal blocker, and why it was invisible before

`plan_false_work_claim` is a substring scan over `JSON.stringify(plan)` for four
phrases. The architect's charter names those four phrases **in the prohibition
itself** — "Never state or imply that files were edited, that tests were run…" —
and the plan schema then asks the architect for `prohibitedActions` and
`handoff.prohibitedActions`, lists whose entire purpose is to state what must
not be done. A plan that forbids claiming work and a plan that claims it
serialise the same.

Fifteen validation rules carry a `reasonField`; **this one carried none**, so
the bundle could say only that a banned phrase appeared somewhere in a 14 KB
document. #234's reason-code instrumentation is what made the rule identifiable
at all — before it, the record said `plan_validation_failed` and stopped.

### The repair, in three parts

Committed on `relay/julius-contract-stack-rebased` (`24d91a40`, then extended).
The first draft of it would not have worked, and finding that out cost no money
because the second failure had already forbidden another paid attempt.

**1. The rule is aimed, not weakened.** The substring scan over
`JSON.stringify(plan)` is now a structural walk, and the exemption is drawn
where the distinction actually lies: a completion claim is an **assertion about
the state of the work**, and a field that **enumerates a condition** is not one.
Exempt, by exact path and never by key name: `prohibitedActions` at both levels,
`acceptanceCriteria` at both levels, `testPlan`, `handoff.requiredTests`,
`handoff.expectedEvidence`, `risks`. "The tests were run and exited zero" is the
correct English for an acceptance criterion and could not mislead anyone about
what has already happened. Still scanned — everything the Coding Agent reads as
its charge: `objectiveSummary`, `handoff.objective`, `handoff.boundedTask`,
every implementation step, assumption, requirement, architecture decision and
rationale, and any field a model invents. A deeper copy of an exempt path
(`handoff.extra.testPlan`) is scanned, because the exemption is matched on the
whole join.

**2. The diagnostic now survives the allowlist — which the first draft did
not.** The draft reported `plan.testPlan[1] :: tests were run` in `reasonField`.
That value would have been **dropped to null** by `safeFieldName` in
`julius-router.ts`, whose grammar admitted at most two dotted segments and no
index, and the operator would have read an **empty `validation_field` for a
third time**. That grammar is a pre-existing defect, not one this change
introduced: `plan.handoff.boundedTask` is three segments, so *no* nested
refusal has ever been publishable. So:

- `safeFieldName` accepts a bounded **structural path** — identifier segments,
  decimal indices, 160 characters, and nothing a sentence needs. It still
  refuses the composite `path :: phrase` form, prose, and key shapes.
- `reasonField` carries the **path alone**; the new `reasonClaim` carries
  **which of the four phrases** as a closed token (`tests_were_run`), published
  through the existing token allowlist as `diag_validationClaimPhrase` and
  dumped as `validation_claim_phrase`.
- Model-chosen keys render as `unnameable` (a word, not `<field>`, which the
  allowlist would have dropped); a path deeper than eight segments is truncated
  and says so with a `.deeper` tail; keys are walked **sorted**, so two runs of
  the same model produce the same path.
- `julius-policy-router.test.ts` now exercises **both ends together** — the only
  place the validator's output and the publisher's allowlist meet. A change to
  either grammar that stops the answer reaching the artifact fails there rather
  than in a paid run.

**3. The charter stops handing the model the banned strings.** It quoted all
four phrases verbatim inside the prohibition, and the schema then asks for
`prohibitedActions` — so the most obedient possible answer was to echo them
back. It now states the rule in the abstract ("write the entire plan in the
future tense"), and asks the model not to quote the sentence back.

Seven mutations each go red: narrowing `safeFieldName`, dropping the claim
token, over-widening the exemption to `objectiveSummary`, removing the path
truncation, unsorting the walk, publishing a raw model key, and matching the
exemption on the truncated path.

### Part 4 — a refused plan is corrected once, not fatal

The defect the two runs really exposed. A plan that parses and then breaks one
of Julius's OWN rules is a **self-inflicted, self-correctable** error, and it
killed the mission outright — while every other recoverable failure in the run
gets one bounded attempt at recovery. The architect is now told what it broke
(the closed reason code and the structural path, **never its own text back**)
and asked once more. Strictly once; a second refusal is the failure it always
was. All fifteen reason codes have a correction, and an unparseable answer gets
the same one.

The correction spends inside the architect's **already-reserved** allocation —
300,000 µUSD against two calls of roughly 20,000 µUSD each — so no ceiling is
raised and no budget rule is relaxed. `plan_attempts` records how many calls one
dispatch bought. The connector sends `store: false` and no
`previous_response_id`, so the second call is genuinely independent.

### WHERE THE LANDABLE FIX IS

**`relay/julius-architect-gate-fix`, branched from trusted `main`
(`872f1790`), pushed.** Four commits, every gate green:

| Commit | What |
|---|---|
| `98a4a002` | the aimed rule, the surviving diagnostic, the charter |
| `2f729388` | a test that asserted an auth precondition instead of establishing it |
| `7b2150fb` | a test that discarded the rejection it provoked, exiting 1 on a green suite |
| `5127618a` | the architect's one correction, and `docs/JULIUS_PAID_RUNS_2026_09_08.md` |
| `adb3c750` | the reviewer's one correction — the other role that killed a paid run |
| `8c7ae60e` | a correction is a spend, so it obeys the mission ceiling |

Suite **9,474 passing, 0 failed, 0 errors, exit 0**; typecheck, build,
relay:build, relay:bridge:build, repository-boundary, parity-gate,
surface-parity strict, yc-demo, cli contract-verify, `git diff --check`, and all
four drills. The two test commits are pre-existing defects that made the gate
red in this container and are droppable on their own — nothing depends on them.

**Both roles that have ever killed a paid mission are now self-correcting.**
The architect (runs 34185920678 and 34186711214, `plan_false_work_claim`) and
the reviewer (run 33802017460, both reviews unparseable) had the same defect: an
answer ARRIVED, in the wrong shape, and the dispatch was terminal. Each is now
told what its answer got wrong — from a closed token, never from its own text —
and asked exactly once more, and only when the mission's allocation still has
money in it. The Coding Agent has no such analogue and got none: it edits files,
so its output is a diff on disk rather than a document that can be malformed.

**This session must not open that PR, and CANNOT.** Established empirically,
not from documentation:

* `julius-main-provenance.mjs:192` requires `pull.authorLogin` to be in
  `WORKER_AUTHOR_LOGINS = ['julius-worker[bot]']`.
* PR #234's `user.login` really is `julius-worker[bot]` — GitHub **App** id
  325202980, `github.com/apps/julius-worker` — and its `merged_by` is
  `ohdieyuh-glitch`. App authors, founder merges.
* `mcp__github__get_me` from this session returns `ohdieyuh-glitch` (id
  225496319), which is the review authority. No worker App credential is
  present in this container, and probing the token environment is blocked here
  (correctly).
* The session that authored #234 — `session_01Rg4GG4cY71gpyELD89PQkb`, a local
  CLI session on the founder's machine — is `disconnected` with
  `computer_unreachable`, and `ListAgents` reports no reachable peer.

So a PR opened here would be authored by the approver: it would fail provenance
at that line, the paid workflow's trust gate would refuse the resulting `main`,
and Tasks 1 and 2 would be *further* blocked rather than unblocked. Opening it
is worse than not opening it.

**The branch is fully PR-ready at `d8c9fab1`** (8 commits), with the body
committed as `docs/JULIUS_ARCHITECT_GATE_PR.md` so it can be opened unchanged:

```
gh pr create --base main --head relay/julius-architect-gate-fix \
  --title "Julius: the architect and reviewer refusals of paid run 34186711214" \
  --body-file docs/JULIUS_ARCHITECT_GATE_PR.md
```

**Watch cycle 2026-09-08 14:05Z (after the founder re-centred the paid mission):**
`origin/main` still `872f1790`; `relay/julius-architect-gate-fix` still
`d8c9fab1`; a GitHub search for open PRs by `app/julius-worker` returns **none**,
and no open PR has that branch as its head. **No worker-authored PR exists.**
Two facts for whoever opens it:

* **How #234 was authored, from the evidence rather than memory:** every commit
  on its head (`be949de2`, `84a354b1`, `e944260b`, …) has BOTH author and
  committer `julius-worker[bot] <325202980+julius-worker[bot]@users.noreply.github.com>`,
  and the squash on `main` (`872f1790`) keeps that author with `GitHub` as
  committer. So the commits were created with the App's installation credential
  (API-created commits, or local git with that identity pushed under the
  installation token), from the founder's local session
  `session_01Rg4GG4cY71gpyELD89PQkb`. That credential is not in this container.
* **The committed PR body is one commit stale.** `docs/JULIUS_ARCHITECT_GATE_PR.md`
  on the branch says `Head SHA: 6e3ccd39…`; the branch tip is `d8c9fab1`. The
  re-authored commits will have new SHAs anyway, so the body's head line should
  be rewritten by the opener, not by this session (the branch is not to be
  touched from here).

The hourly watch (`trig_01PvdqADjSgk5aUH9dvugJEZ`, :35) now checks BOTH main and
the worker-PR search every cycle and reports `FOUNDER ACTION REQUIRED — PR #n`
the moment a merge-ready one exists.

**The founder's step, written down:** `docs/JULIUS_WORKER_PR_RUNBOOK.md` —
re-author the eight commits as the App on a new branch (tree byte-identical,
verified by three commands), push and open the PR with the App's installation
token, verify the PR author before anything else, approve at the head SHA,
squash-merge at that exact head. Built from #234's own commits; the token
minting is standard App mechanics this session could not exercise.

**The two earlier commits on `relay/julius-contract-stack-rebased`
(`24d91a40`, `526d5d35`) are SUPERSEDED by `98a4a002`** and should not be landed
beside it. This branch will be rebased onto the gate fix once that lands and its
real SHA is known — not before, because rebasing onto an unlanded branch just
moves the guess.

**That rebase has been rehearsed.** A dry `git merge-tree` of the two branches
reported five conflicting files; the rebase was performed in a throwaway
worktree (nothing pushed, neither branch touched), needed a hand at exactly
three stops, and the resolved tree — 33 commits over `d8c9fab1` — passed all
four typecheck passes and the nine load-bearing suites (378 tests) with both
sides' changes present. The recipe, the three resolutions and the post-squash
`--onto` step are in **`docs/JULIUS_STACK_REBASE_NOTES.md`**.

### THE BETA GATE, RUN AGAINST THE REAL PAID BUNDLE — 3/15, exit 1

Not a repository reading. The `julius-live-evidence` artifact from paid run
**34186711214** was downloaded and the gate pointed at it:

```
node scripts/wonderland-beta-gate.mjs --evidence <downloaded artifact dir>
```

| | |
|---|---|
| **PASS** | PROJECT CREATION, JULIUS MISSION START, PERMISSIONS / MISSION BOUNDARIES (3 signed executor receipts, 0 invocations, 0 denials) |
| **FAIL** | PROMPT ARCHITECT (task FAILED, no accepted artifact), CODING AGENT (BLOCKED), INDEPENDENT REVIEWER / REPAIR LOOP / VERIFICATION (never reached), VERIFIED COMPLETION (run FAILED), RESTART / RECOVERY and FAILURE RECOVERY (unexercised) |
| **no dump** | ACCOUNT / ONBOARDING, TASK CONTRACT LOCK, PROJECT BRAIN PERSISTENCE |
| **NOT BUILT** | WONDER WEB OUTPUT |

**The three "no readable dump" rows are honest, not a defect.** The gate reads
`sessions.tsv`, `task-contracts.tsv` and `project-brain.tsv`; the dump script
writes all three — but only on this branch. Trusted `main` writes **none** of
them, and the bundle came from `main`. Checked, not assumed: the gate and the
dump agree on every filename.

**`XAI_API_KEY: MISSING` in that bundle is also not a defect**, and it looks
like one. The live step deliberately does not receive it: `julius-live-hermes.sh`
refuses to run without it (`${XAI_API_KEY:?}`) and writes it into the reviewer's
own profile dotenv at `$HERMES_PROFILE_HOME/.hermes/.env`, so the reviewer bills
through that profile and the credential never enters the mission process. The
preflight reports its absence there "for the record", as its own code says.

### SERIALIZATION FAILURES — a real defect the in-memory store cannot show

`relay/julius-serialization-hardening`, branched from trusted `main`, pushed.

`BEGIN ISOLATION LEVEL SERIALIZABLE` does not remove concurrency; it detects it
and aborts one transaction with `40001 could not serialize access due to
read/write dependencies among transactions`, which is PostgreSQL asking for the
transaction to be **run again**. Eight of the nine Julius repositories that open
one rolled back and rethrew, so that request reached the run loop as a task or
run failure.

**Measured, not argued.** Two transactions of exactly the shape those
repositories use — read one task row, write another, no `FOR UPDATE` between —
against a real PostgreSQL 16 in this container:

```
CROSS-WRITE: {"code":"40001","message":"could not serialize access due to
              read/write dependencies among transactions"}
SENTINEL:    {"code":"40001","message":"optimistic_concurrency_conflict"}
```

**The second line is why the retry could not simply be added.**
`julius-postgres.ts` threw its own stale-version sentinel wearing PostgreSQL's
code, and that one must never be retried — the caller's `expectedVersion` is
stale, so a second attempt reads the same stale value and fails identically. A
loop that could not tell them apart would spin. Nothing read that code: all four
consumers match on the message. So the sentinel now has `JULIUS_STALE_VERSION`,
and `serializableTransaction` retries only a failure PostgreSQL raised —
verified by code **and** by the words PostgreSQL used.

**A CORRECTION TO MY OWN COUNT.** The first commit said "eight of the nine".
It is **seven of eight**, and the error is instructive:
`julius-context-postgres.ts` was counted by matching that string in its PROSE.
That file deliberately opens **no transaction at all** — it takes a dedicated
connection precisely so its read gets a fresh snapshot OUTSIDE any caller's
transaction, and wrapping it would break `persist`. It must never adopt the
helper.

**ALL EIGHT now retry.** `julius-tool-postgres` already did; the other seven
adopted `serializableTransaction` after every transaction body was audited for
purity (a retry runs the effect again, so a transaction that also spent money
would spend twice).

**`julius-tool-settlement` was last, and it decided the design.** Its COMMIT is
instrumented — `fault('BEFORE_COMMIT')` and `fault('AFTER_COMMIT')` bracket it
so a crash can be simulated on either side of durability, which is what an
exactly-once drill measures. A helper that merely owned the COMMIT would have
moved it out from between those points and turned that drill into a false
proof. So the helper grew hooks keeping the real commit where it was, and the
asymmetry between them is the design:

| | |
|---|---|
| `beforeCommit` throws | nothing durable → ROLLBACK, and NOT retried: a caller's refusal is not a database race |
| `afterCommit` throws | the work IS durable → never retried, and **not because of what the error looks like** |
| `40001` **at** COMMIT | PostgreSQL aborted this transaction → definitely nothing settled → run it all again, starting from the `settlement_id` identity read, which is what makes the replay safe |
| any other commit failure | `CommitOutcomeUnknownError`, never retried — a connection lost mid-flush may have committed and been unable to say so. Unknown is not zero here either. |

**A hole I closed in my own draft:** it decided durability by the error's SHAPE,
so a post-commit hook throwing something 40001-shaped would have replayed a
committed transaction. Durability is now a fact the loop records, and the
mutation removing it turns the suite red.

**One deliberate behaviour change:** settlement's replay path (`created:false`)
now passes through the same boundary rather than committing without the fault
points. Its commit is a real commit — it releases the `FOR UPDATE` the identity
read took — so instrumenting one commit and not the other was the anomaly.

**A SECOND CORRECTION, found by mutating my own work.**
`recordSubagentAndTaskWithinLimits` had **no test at all** — live paid-path
code, the C.A.R.D. sub-agent limit, unexercised on the PostgreSQL side. The
case written for it asserted "no task row — the rollback really happened", and
a mutation making the refusal COMMIT **passed it**: the denial check precedes
every write in that method, so COMMIT and ROLLBACK are indistinguishable from
outside. Two consequences, both recorded in the code:

* the earlier claim that this file's early `ROLLBACK` made the transform risky
  was wrong — nothing had been written, so it was safe either way;
* the invariant moved to where a fake pool can see the statements — *a throwing
  effect issues ROLLBACK and never COMMIT*, in `postgres-serializable.test.ts`,
  which does turn red when a COMMIT is injected after the rollback.

The refusal still leaves by throwing, so it cannot commit whatever a later edit
moves above the check.

**The helper's first draft released the pooled client twice**, and `pg` throws
on that — so the first concurrent pair it was written for failed on the double
release rather than on serialization. Its own test caught it before it went
anywhere; a mutation now holds it closed.

Suite 9,457 passing / exit 0, every gate, real-PostgreSQL suite 4 passing, five
mutations red. Harness manifest regenerated (109 production files).

### REAL POSTGRESQL, RUN HERE — 5 passed

Not a claim about CI. A PostgreSQL 16 instance was started in this container and
`real-infra-julius.test.ts` run against it on this branch:

```
initdb -D /tmp/juliuspg -A trust -U postgres && pg_ctl ... -p 55432
DATABASE_URL=... JULIUS_REAL_POSTGRES=1 npx vitest run src/relay/persistence/real-infra-julius.test.ts
→ Test Files 1 passed · Tests 5 passed | 2 todo
```

(The two todo cases are Docker-gated and need `JULIUS_SANDBOX_IMAGE`.)

That suite is where the Project Brain writer and the task-contract store are
proven against a real database rather than a fake, and it already covers the
race that produced the `40001` serialization failure earlier in this session:
*"TWO CONCURRENT LOCKS OF ONE REVISION: the index decides, and exactly one
wins."* It also holds the binding CHECK in both directions, the jsonb round trip
by re-derived digest, revision conflict, supersession in one write, and the
refusal to roll an agreement back.

`julius-store-conformance.test.ts` is deliberately NOT part of this: it is
compile-time shape assertions holding the ports and the repositories together,
and running it against a database would prove nothing it is for.

### What the bundle proves about the money

`budget.tsv` holds one allocation (300,000 µUSD, `ESTIMATE`,
`julius-allocation.v1`, remaining 20,000,000) and one reservation, and **no
settlement row**. That is correct: a provider was called and reported no cost,
so the spend is Unknown. A release would have claimed nothing was spent, and a
zero would have claimed it was free.

---

## 00. CLOUD SESSION 2026-09-08 — the task/sprint contract, and a credential finding

> Written by the **Claude Code cloud session** (`claude.ai/code`), not the local
> Chromebook checkout. Everything below §00 is the earlier local record and is
> still accurate except where this section says otherwise.

**Branch:** `claude/julius-core-beta-readiness-nef10e`, pushed.
**Base:** `origin/relay/julius-brain-and-beta-gate` (`983017a0`) — PR #235's head,
which contains PR #234's head (`be949de2`), which is based on `origin/main`
(`b2dc9f23`). So this branch is the **top of a three-deep stack**.

**Why that base, rather than `main`.** #234 rewrites the exact seams a task
contract has to bind to — `julius-task-pipeline.ts`, `julius-run-loop.ts`,
`julius-runtime-ports.ts`, the repair role/stage inheritance and the release
rule — and #235 adds the Project Brain writer this work reads alongside. Basing
on `main` would have meant re-solving both and then colliding with both. The
cost is that this branch cannot land until the two beneath it do.

### 00a. SECURITY / PROVENANCE FINDING — confirmed independently from the cloud

`julius-review-currency.mjs` justifies `ohdieyuh-glitch` as the external
approver on the stated ground that "the credential ... was removed on 2026-09-05
when the worker App replaced it — so an approval carrying this login is a
statement by someone outside the environment being reviewed", and adds that if
it is ever put back the entry "stops meaning anything and belongs in
`NON_ATTESTING_IDENTITIES` instead."

The local session recorded on 2026-09-07 that `gh auth status` in the local
checkout still reported that login. **This cloud session confirms it from a
second, independent environment:** `mcp__github__get_me` returns
`ohdieyuh-glitch` (id 225496319) with repository write. So the stated
precondition of the merge-provenance model is false in at least two of the
environments Julius is developed from.

Consequences, stated precisely:

- **This session did not approve anything.** It could have approved PR #234 —
  authored by `julius-worker[bot]`, so `evaluateReviewCurrency`'s
  author≠approver rule would have permitted it — and that would have been a
  coding agent exercising founder authority, which is the arrangement the whole
  model exists to prevent. It was not exploited and must not be.
- **This session also cannot author a landable PR.** `WORKER_AUTHOR_LOGINS` is
  `['julius-worker[bot]']`, and a pull request opened with this credential is
  authored by `ohdieyuh-glitch`, so merging one would make `main`
  `unprovenanced` and block every paid live mission until a worker-authored PR
  landed on top. That is the same constraint #235 documents for itself.
- **The remedy is the founder's, and it is a credential change, not a code
  change.** Either the founder's token is genuinely removed from every coding
  environment (which is what the file already claims), or `ohdieyuh-glitch`
  moves to `NON_ATTESTING_IDENTITIES` and a different external authority is
  configured. Weakening the gate to make CI green would be the wrong direction
  and was not done.

### 00b. What this session built

Three commits, all provider-free, all on the branch above.

**1. `c4c9474d` — the task/sprint contract domain** (`julius-task-contract.ts`).

Julius had a Mission Contract and a per-worker context packet and nothing in
between: no statement of what THIS task was charged with, agreed before
implementation and handed unchanged to whoever reviews it. #234 fixed the
reviewer's RUBRIC; this is the SUBJECT the rubric is applied to.

- Draft → challenge → revise → accept, and then **Julius, and only Julius,
  locks**. The evaluator's `ACCEPT` is an input to the lock, never the lock:
  a reviewer that could lock would be the orchestrator.
- `contractRevision` + `bindingDigest` is what every downstream record carries,
  so "were these compiled from the same agreement" is one equality. Currency has
  four answers — CURRENT, STALE, **FOREIGN**, INDETERMINATE. A newer revision
  than the one locked is FOREIGN *even when it carries the current digest*, and
  a same-revision digest mismatch is FOREIGN rather than stale, because a retry
  would succeed and hide it.
- A worker's revision cannot move `runId`, `taskId`, `missionContractRevision`,
  the **criterion ids** or the **budget**. The proposal type forbids them at
  compile time and provider output is not compiled, so the restatement at
  runtime is what actually holds — a spread-only implementation type-checks and
  fails the hostile-proposal test. Criterion TEXT is deliberately not frozen;
  clarifying a criterion is the point of the challenge cycle.
- Revision 1 is **seeded by Julius from the Mission Contract** — objective,
  blocking criteria with the mission's own ids, constraints, and the money as
  the same two numbers `juliusAllocationPolicy` takes. The architect's
  contribution is a revision against terms it cannot rewrite.
- All eight load-bearing branches were mutated and every mutation went red.

Also in that commit: **`relay-core-boundary.test.ts` was passing by whitespace.**
The mission-purity rule matched `/from\s+['"]node:/` — one or more spaces — and
`julius-context-snapshot.ts` is written densely with none, so its `node:crypto`
import walked past the guard and the rule was a claim the mission layer did not
satisfy. The check now separates the two populations: everything outside
`mission/julius` imports no `node:` builtin **at any spacing**, and the julius
domain (already documented as non-pure) may import **`node:crypto` and nothing
else**. Both still forbid fs and process, and the mission barrel is asserted not
to re-export julius. Verified by injecting `node:fs` into a julius file and a
dense `node:crypto` into a non-julius one — the second used to pass.

**2. `7f046bef` — migration 023 and `JuliusContractPostgresRepository`.**

- **One locked revision** is a partial unique index
  (`julius_task_contract_single_lock`), not an application check.
- **A lock moves forward or not at all**: locking N while N−1 is locked IS
  superseding, in one write; the same revision twice and an older revision than
  the one held are refused.
- **A revision is immutable** — every write is an INSERT, so a replay is a no-op
  and different terms at a stored revision are refused rather than overwriting
  terms another party holds.
- **The digest is re-derived on read** and a locked row whose terms no longer
  produce it is refused (`contract_absent`, which blocks). Proven by writing
  past the repository with `jsonb_set`, exactly as an outside edit would.

**A real database found a bug the in-memory model structurally cannot.** Two
concurrent locks of one revision made `lockTaskContract` THROW: under
SERIALIZABLE, two transactions taking `FOR UPDATE` on the same row abort one
with `40001`, and only `23505` was translated. Both are now the same ordinary
outcome, and the answer is **re-read rather than asserted** — announcing
"another revision is locked" without looking would be a claim about a race this
transaction never saw.

**PostgreSQL 16 was actually run in this cloud container** (see §00d), so
migrations 001–023 applied from empty and every case above is a real-database
result, not a shape assertion.

**3. `80262c60` — the gate, wired into the run loop.**

- The check lives in `prepareClaimedTask`, which runs **before `admitTask`**, so
  a refusal costs no execution attempt. It fails **closed and loud** (task
  FAILED with its own reason code) because retrying a dispatch cannot make a
  contract agreed.
- It is a **different question from the release rule**: `evaluateJuliusRelease`
  asks whether the build's dependencies are accepted, this asks whether what the
  build was asked to do has been agreed. A run can satisfy the first and not the
  second.
- **The lock is written before the release.** Of the two states a crash can
  leave, both are safe; the reverse order has a third — released with nothing
  locked — where the gate would refuse a task the run already announced as ready.
- **Who is bound**: the Coding Agent, by its lineage ROOT's contract (a repair
  round and a bounded sub-agent both climb to it, so a worker cannot escape the
  mission's terms by spawning a child and writing that child's contract); and
  the reviewer of a coding task, by the same root. The Prompt Architect and its
  own review are exempt because they PRODUCE the terms.
- **Rule 2 is recorded, not assumed**: each dispatch writes its binding onto
  `task.claimed`, and the e2e reads both rows back off the ledger and puts them
  through `evaluateJuliusSharedBinding`.
- **The reviewer now receives the locked contract**: Julius computes
  `juliusContractReviewCharge` and hands it down on the dispatch — the same
  inversion `taskType` uses — and `buildReviewPrompt` renders the binding, the
  blocking criteria **by their mission ids**, the scope, the prohibitions, the
  required checks, the failure conditions and the stopping condition, with the
  instruction that every finding must name the criterion id it fails. A contract
  cannot widen what a plan review may demand; #234's repair still holds.
- **Bootstrap authors revision 1**, and a mission that does not state enough to
  derive one is refused AT BOOTSTRAP (`task_contract_not_derivable`) rather than
  accepted into a run whose build can never be dispatched.
- The Beta Gate gains a **TASK CONTRACT LOCK** row and the evidence bundle a
  **`task-contracts.tsv`** (identifiers, state, digest, lock instant and
  evaluator — never `safe_terms`, which is prose). On paid run 34037313976's own
  artifact it reads FAIL and is now the **second** of the top three gaps, which
  is correct: that run had no contract at all, and its reviewer was grading
  against prose.

**4. `3a8c6686` — the reviewer is handed the contract, and a crash can no longer strand a run.**

Two things, and the second was found while proving the first.

*The reviewer now receives the locked contract.* Julius builds the charge from
the contract its gate proved and hands it down on the dispatch — the same
inversion `taskType` uses. `buildReviewPrompt` renders the binding, the blocking
criteria **by their mission ids**, the scope, the prohibitions, the required
checks, the failure conditions and the stopping condition, and instructs that
every finding name the criterion id it fails. The Beta Gate gains a **TASK
CONTRACT LOCK** row and the evidence bundle a **`task-contracts.tsv`**.

*And a crash could strand a run forever.*

Found while proving the lock's own crash semantics, and it is older and wider
than the contract work.

`acceptWorkerResult` moves a task out of ACTIVE in its own transaction; the
verification decision is a **separate write**. A process that dies between them
leaves a **SUCCEEDED task with no decision**, and nothing ever looks at it
again — the claim query offers RUNNABLE tasks only. The run then parks in
VERIFYING **permanently**.

It parks *honestly* — completion requires a decision per task, so nothing false
is reported — which is exactly why nothing detected it. The chaos suite reached
this window and passed, because it asked whether the task wedged in an
**impossible** state. It did not. A mission that never finishes, in a perfectly
legal state, with the money already spent, is the failure that question cannot
see.

`resumeUnverifiedTasks` runs the verification the run is owed. It:

- **re-verifies rather than requeues** — the result is durably accepted, so
  sending the worker again would pay twice; what is missing is only Julius's
  judgement, which costs nothing to redo;
- is **idempotent by construction** — `appendDecision`'s key is
  `<taskId>:<action>:<reasonCode>` and the brain entry id derives from the same
  three, so the resumed decision IS the decision the crashed tick would have
  written, and no second repair round is minted;
- **skips a task with a pending review**, which is not stranded — verification
  answers SCHEDULE_REVIEW there and sweeping every tick would re-announce a
  review already on its way;
- lives in **`advanceRun`**, not `tick`: a stranded run has no claimable task, so
  a tick never names it, and `advanceRun` is called with the run id by exactly
  the caller that has noticed nothing moved. It runs **before** `targetRunState`,
  because a resumed decision can release a BLOCKED task or complete the run;
- is attributed to **`julius-verification-resume`**, never to the worker whose
  process is gone.

`JuliusRunAdvance` gains `resumedVerifications`, and
`driveJuliusRunToTerminal` treats it as progress: `changed` means the RUN STATE
moved, and an accepted plan releases a BLOCKED build while the run stays READY —
reading `changed` alone would have reported a stall on the very tick that
unblocked the run, and abandoned the mission one step from finishing. That was a
real defect in the first version of this wiring, caught by driving the test the
way the live driver drives.

Three chaos cases hold it, and removing the resume call turns five tests red.

**5. `9251c63f` — a context names the agreement it was compiled under.**

`JuliusContextWriter.persist` deduplicates on
`(task_id, worker_id, content_hash)`, and the hash did not cover the task
contract. So a retry after the contract was revised, with a packet whose text
happens to be unchanged, matched the row compiled under the PREVIOUS agreement,
and the worker was handed a context recorded against terms nobody holds.
`taskContractRevision` and `taskContractDigest` are on the snapshot and in the
hash; null for an unbound role, and a null still changes the hash. No column and
no migration — the durable audit is already `task.claimed`'s binding facts and
`task-contracts.tsv`, and a third copy of one fact is the drift this repository
keeps finding.

**6. `3e74a3b8` — the architect actually proposes the contract now.**

Until this, revision 1 was Julius's seed and nothing ever cut a second one:
`reviseJuliusTaskContract` existed with no producer, which is the exact
unwired-capability pattern this repository keeps rediscovering.

The architect already states a bounded handoff — objective, task boundary,
allowed file scope, required tests, prohibited actions, expected evidence — and
every one is a contract field. `contractProposalFromPlan` MAPS the validated
plan onto a proposal; no new capability, no second prompt, **no second paid
call**. It travels on `JuliusProviderResult.contractProposal` (typed `unknown`,
because it is provider output) and Julius stores what survives three refusals as
a **DRAFT**: an allowlist sanitiser, the mission-owned-field refusal, and
structural validation. The accepting plan review then locks whatever revision is
current — revision 2, the architect's.

So the cycle in the brief is now real end to end: **seed → propose → challenge →
accept → LOCK → coder and reviewer bound to the same revision**. The e2e drives
it through the run loop and asserts the coder's dispatch names revision 2.

A hostile proposal is bounded three ways and the run still completes; a
malformed one is recorded as `contract.refused` and the run continues on the
revision it has — trading a worse contract for no mission would be the wrong
direction. A proposal against an ALREADY LOCKED contract is refused, because
changing agreed terms is a decision and the decision path is where a revision is
cut.

### 00c. What this session did NOT do, and why

- **No paid live mission was dispatched.** The repairs for paid run
  `34037313976` are in **PR #234, which is still open and unmerged**, so `main`
  is the same `b2dc9f23` that run failed on. Running it would have burned money
  on known-broken code. This is the brief's own rule and it was followed.
- **No approval, no merge, no `main` push.** See §00a.
- **No world, Blender, HUD or Unreal work.**

### 00d. Facts worth not rediscovering (cloud container)

- **Real PostgreSQL 16 is available and can be run here.** `initdb` refuses to
  run as root, so: `chmod 755 /var/tmp`, `mkdir -p /var/tmp/relaypg/{data,sock}`,
  `chown -R postgres:postgres /var/tmp/relaypg`, then
  `su postgres -s /bin/bash -c "/usr/lib/postgresql/16/bin/initdb -D /var/tmp/relaypg/data -U relay --auth=trust"`
  and `pg_ctl -D … -o '-p 55432 -k /var/tmp/relaypg/sock -c listen_addresses=127.0.0.1' -l /var/tmp/relaypg/pg.log start -w`.
  Then `DATABASE_URL=postgres://relay@127.0.0.1:55432/relay_test JULIUS_REAL_POSTGRES=1 npx vitest run src/relay/persistence/real-infra-julius.test.ts`.
  **Do not use the scratchpad directory for `PGDATA`** — `/tmp/claude-0` is mode
  0700 root and the `postgres` user cannot traverse it.
- **`ANTHROPIC_BASE_URL` is set in this container.** It made
  `claude-code.test.ts > classifies an API-key environment as disallowed` fail
  here and pass everywhere else, because `classifyClaudeAuth` checks provider
  overrides first. The test now establishes its own precondition; that was a
  test reporting the environment rather than the code.
- **The GitHub MCP identity here is `ohdieyuh-glitch`,** not the worker App. See §00a.
- Docker is present; the Docker-gated half of `real-infra-julius.test.ts` was
  not exercised (it needs `JULIUS_SANDBOX_IMAGE`).

### 00e. Tests and gates, as actually run in this container

| Gate | Result |
|---|---|
| `npx vitest run` (whole repository) | **503 files passed**, 1 skipped (the env-gated real-infra suite), **9,617 tests passed**, 24 todo, **exit 0** |
| `npm run typecheck` (all four projects) | clean |
| `npm run build`, `relay:build`, `relay:bridge:build` | clean |
| `relay-repository-boundary.mjs`, `relay-parity-gate.mjs` | clean |
| `relay:surface-parity:check:strict`, `relay:yc-demo:check`, `relay:cli:contract-verify` | clean |
| `relay:persistence:contract-verify`, `relay:persistence:recovery-drill` | clean |
| `relay:workspace:verify`, `relay:claude:contract-verify` | clean |
| `julius:harness:check` | current |
| `git diff --check` | clean |
| **real PostgreSQL 16** — migrations 001–023 from empty, the contract lock race, the jsonb round trip, superseding, the binding CHECK, `one_per_task`, the corrupted-row read | **passed** (see §00d for how to bring the cluster up) |

The suite previously exited **1** on a fully green run: `executor-repair-regression.test.ts`
started a real request and discarded the promise, so it rejected unheld and
vitest reported an unhandled error nobody could locate. Fixed in `3a8c6686`.

**Beta Gate, run with no evidence bundle: 0/15 PASS.** That is the correct
answer and the instrument working — every runtime row requires a real run, and
none has happened since these changes. The new `TASK CONTRACT LOCK` row reads
FAIL on paid run 34037313976's own artifact and is the second of the top three
gaps, because that run had no contract at all.

### 00f. The founder-only actions, in order

> **2026-09-08, later:** #234 has landed (§0). The action that now gates the
> paid mission is opening the 34186711214 repair as a worker-authored PR —
> the exact commands are in **`docs/JULIUS_WORKER_PR_RUNBOOK.md`**. Items 1–2
> below are the earlier record.

1. **Approve and merge PR #234.** Worker-authored, all CI green, MERGEABLE/CLEAN,
   zero reviews. Nothing else gates the paid path. Monotonicity is already
   satisfied — the `julius-accepted-main-<sha>` artifacts for `f131098c` and
   `67ade6ea` are both contained in `main`, and the rule is containment of all
   that exist, so a forward merge stays `monotonic` with no new dispatch.
2. **Decide how #235 and this branch land.** Both are authored by
   `ohdieyuh-glitch` and therefore cannot land as authored (§00a). Either
   re-author the commits through the worker App, or carry them into a
   worker-authored PR. They are a stack: #234 → #235 → this branch.
3. **Resolve the credential finding** (§00a) — a credential change, not a code
   change.
4. Only then is a paid rerun of `julius-live-mission-2` justified, and it should
   be preceded by the zero-spend preflight.

### 00g. The highest-impact remaining Julius beta blocker

> **2026-09-08, later:** PR #234 HAS merged (`main` = `872f1790`, §0). The
> blocker is now the next generation: the 34186711214 repair on
> `relay/julius-architect-gate-fix @ d8c9fab1` needs a **worker-authored PR**,
> which no environment this session can reach is able to open. The founder's
> exact steps are in `docs/JULIUS_WORKER_PR_RUNBOOK.md` (Step 1 dry-run
> verified here). Everything below is the earlier record.

**Nothing engineering-side. It is the merge of PR #234.**

Julius's Signal Task 1 — one real paid mission reaching verified completion
without manual rescue — is blocked on a founder approval, not on code. `main` is
still `b2dc9f23`, the exact commit paid run 34037313976 failed on; the repairs
for all four of its defects sit in #234, worker-authored, all CI green,
MERGEABLE/CLEAN, with **zero reviews** since 2026-09-06.

Everything this session built sits on top of that, and every hour it stays
unmerged is an hour in which the only way to test Julius live is to pay for a
run of code that is known to fail.

The second-order blocker, once it lands, is the authorship constraint in §00a:
#235 and this branch cannot land as authored, and no amount of further
engineering from this environment changes that.

### 00h. SPRINT 2026-09-08 — stale handoff rejection and lock integrity

> Branch `relay/julius-contract-stack-rebased`, on top of the serialization
> hardening and the crash-after-purchase proof. Everything below is
> provider-free and was run in this container. The founder's twelve-section
> brief for this sprint is answered section by section; where a section named a
> property the runtime did not actually have, the property was BUILT, not
> asserted about.

**What was true before this sprint, stated plainly.** The contract domain had
the two comparisons the founder's rules depend on — `evaluateJuliusBindingCurrency`
(is this handoff's binding still the agreement?) and `evaluateJuliusSharedBinding`
(do the coder and the reviewer hold one binding?) — and **nothing on the
runtime path called either.** Staleness held only because every dispatch
compiled its packet fresh; the window between `prepareClaimedTask` reading the
lock and the reservation being taken was open, and the reviewer's charge was
built from whatever lock was current at ITS claim, never compared to the lock
the coder executed under. The CHALLENGED state existed in the domain, the store
and the migration and **no runtime path ever wrote it**: a plan the reviewer
sent back left its contract a DRAFT indistinguishable from one nobody had read.
And the architect's `repair:plan` round — the one round in which a proposal is
most needed — could not propose at all, because its subject was resolved from
the tasks that depend on the repair task, and nothing does.

#### What was built

| Rule | Where | What it does now |
|---|---|---|
| 2 — stale handoff | `julius-task-pipeline.ts`, after the context is compiled and **before the reservation** | Re-reads the lock, `evaluateJuliusBindingCurrency({recorded, contract})`; anything but CURRENT → task FAILED, `contract.refused` with `reasonCode` `binding_stale` / `binding_foreign` / `binding_indeterminate`, trajectory `DISPATCH:CONTRACT_STALE`, outcome HALTED `TASK_CONTRACT_STALE`. Never rebinds to the newest revision. |
| 3 — one binding for coder and reviewer | same file, before the reviewer's `task.claimed` | Reads the subject's **executed** binding off the durable claim record (`executedBindingFor`, a new reader port with memory and PostgreSQL implementations) and `evaluateJuliusSharedBinding` against the reviewer's; a mismatch → review FAILED, `contract.refused` with `binding_revision_mismatch` / `binding_digest_mismatch` / `binding_contract_mismatch` / `implementation_binding_absent`, HALTED `REVIEW_CONTRACT_MISMATCH`. The coder's SUCCEEDED result is not discarded; grading it against other terms is what is refused. |
| 1 — the challenge leg | decision path, before the lock block | A REPAIR decision on a Prompt Architect's work challenges every DRAFT contract governing the plan's dependents (read off the repair-lineage root): `contract.challenged` — a **new operational event type** — carrying contract id, revision, the decision's reason code and an objection count. LOCKED terms are never challenged; an already-CHALLENGED revision is not challenged twice, which is what makes a crash between the challenge and the decision resumable. |
| 1 — the revision after a challenge | `proposeContractRevision` | The proposal's subject is resolved from the **lineage root's** dependents, so `repair:plan-1:1:task` proposes for `build-1`. |
| 10 — evidence | `task.claimed` facts, `contract-events.tsv` | The claim record now carries `contractTaskId` beside contract id, revision and digest — the field the reviewer comparison is reconstructed from after a restart. The live evidence dump gains `contract-events.tsv` (proposed / challenged / locked / refused, with every revision and reason as columns, no prose). |
| 8 — concurrency (found by the race, below) | `julius-contract-postgres.ts` | A concurrent rival proposal for the same revision used to die with the raw `julius_task_contract_one_per_task` constraint text — the second unique index fires before the ON CONFLICT arbiter on the primary key ever sees the winner. `putTaskContract` now treats 23505 as "the row exists now" and looks: same terms → replay (`false`); different terms → `julius_task_contract_revision_conflict`; another contract id at this task's revision → `julius_task_contract_one_per_task`. The memory model refuses a second contract per task too, so the two stores agree. |

#### The lifecycle, driven for real

`julius-contract-integrity.e2e.test.ts` (51 cases) drives the real run loop, or
the real `prepareClaimedTask` → `admitTask` → `runClaimedTask` sequence the loop
calls, against the memory store and the scripted adapters every other suite
uses. **No parallel state machine.** The direct calls exist for one reason: the
stale window is between two calls the loop makes in one breath, and calling
them by hand is the only honest way to stand inside it.

- **Section 1.** R1 seeded → architect proposes R2 → plan review REJECTS →
  **R2 CHALLENGED** → `repair:plan` architect proposes R3 → re-review ACCEPTS →
  **R3 LOCKED** → build and its review run under R3. Revisions read back as
  `[[1,DRAFT],[2,CHALLENGED],[3,LOCKED]]`; the locked record's objective, scope,
  criteria ids, evidence, permitted paths, failure conditions, repair rules,
  budget, evaluator and digest are asserted; the ledger order is
  `proposed:2 < challenged:2 < proposed:3 < locked:3 < runnable:build-1 <
  claimed:build-1`; zero `contract.refused` events.
- **Section 2.** Eight stale-handoff shapes — superseded revision; right
  revision / wrong digest; right digest / wrong revision; both wrong; an
  UNLOCKED draft cited as the agreement; a foreign contract; revision 0; and
  the newest digest under the old revision number. Every one: HALTED
  `TASK_CONTRACT_STALE`, **no adapter dispatch, no `budget.reserved`, the
  budget's reservation table unchanged, no evidence, no result, task FAILED,
  the reason durable**, exactly one claim record still naming the compiled
  revision, and after a full drain nothing retried it under newer terms.
- **Section 3.** N+1 through the runtime (the review is refused, the build
  stays SUCCEEDED and bound to N); N−1 and a digest-only mismatch through the
  handoff; a build with no recorded binding cannot be reviewed under a
  contract; the control case shares the binding and completes.
- **Section 4.** Each proposable category after LOCK — objective, scope,
  criteria, evidence, tool permission, stopping, repair policy — refused with
  `contract_already_locked`, one revision, the locked terms byte-identical, the
  coder bound to the original digest. The store refuses an overwrite of a
  locked revision (budget included). Work done under R1 stays bound to R1 after
  R2 is legitimately locked.
- **Sections 5–6.** build → finding → repair → re-review carry ONE binding
  whose subject is the build, and each packet's `taskContractDigest` says so; a
  repair proposing wider `permittedPaths` is refused against the lock. A
  sub-agent child is dispatched under its parent's binding with the parent as
  subject; a child proposing looser terms is refused; a child requesting a
  permission its parent lacks never enters the graph.
- **Section 7.** Crash after LOCK before the decision: the restart re-accepts
  nothing, re-locks nothing, rewinds nothing (revision, digest, state,
  evaluator and lock time identical before and after). Crash after the coder's
  result before its review exists (`addTask` #2): the reviewer still receives
  the exact locked contract, the coder is paid once. Crash after the reviewer
  is claimed before it is admitted: the re-claim recomputes the same binding.
- **Section 10.** The refusal's facts are `{contractId, contractTaskId,
  currentRevision, currentState, owner, reasonCode, recordedRevision, role}`,
  every value a string, number or null with no whitespace; the trajectory row
  carries the same numbers.

**Section 8, on PostgreSQL 16 in this container** (`real-infra-julius.test.ts`,
6 passed): six rounds of four concurrent parties on one contract — a proposal
for N+1, two acceptances of N, a rival proposal for N+1. Every round: exactly
one proposal stored and the rival **refused as a conflict, never merged**;
exactly one acceptance wins and the other is **answered**
(`contract_revision_already_locked` or `lock_contended`), never thrown; one
LOCKED row in the database; the held revision's terms hash to its binding and
dispatch is permitted under it. After six rounds: five SUPERSEDED, one LOCKED,
one DRAFT, and six concurrent stale acceptances change nothing. The bounded
retry the brief asks about lives one layer up — a refused lock is a ledger
event and the next tick's re-verification asks again, idempotently — and the
crash-at-lock cases in the gate suite drive it.

#### Two things the founder should know that are not bugs

- **A CHALLENGED revision can still be locked** when the re-review of the
  repaired plan accepts without a new proposal (the scripted architects in the
  paid-run replay propose nothing). The record then reads
  `challenged:1 < locked:1`, which is true: the objection was answered by
  repairing the plan, not by changing the terms. Asserted, not hidden.
- **A build claimed before this change** carries no `contractTaskId` on its
  claim record, so its review would be refused `implementation_binding_absent`.
  No live run spans the deployment — every paid run is terminal — so this is a
  statement about old ledgers, not a migration.

#### Section 11 — the mutations, each applied to production code, each killed

Run by `scratchpad/mutations.py` against the two contract e2e suites and the
two contract unit suites (159 tests); every file restored afterwards and
`git status` compared before and after. **17 of 17 mutations went red** (M16–M17 were run after the specialist binding was added, against the two e2e suites).

| Mutation (what was broken) | Killed by |
|---|---|
| M1 revision comparison — an older revision reads as CURRENT | contract unit ×1, integrity e2e ×3 |
| M2 digest comparison — the digest is never compared | contract unit ×1, integrity e2e ×1 |
| M3 lock check — CHALLENGED not refused by the dispatch gate | contract unit ×1, integrity e2e ×1 |
| M4 task binding — the contract id is not compared | contract unit ×1, integrity e2e ×1 |
| M5 repair inheritance — a repair binds to its own task, not its lineage root | gate e2e ×3, integrity e2e ×4 |
| M6 reviewer binding — the shared-binding verdict is ignored | integrity e2e ×4 |
| M7 post-lock mutation — a LOCKED contract accepts a new proposal | gate e2e ×1, integrity e2e ×9 |
| M8 restart reconstruction — the executed binding cannot be read back from the ledger | gate e2e ×2, integrity e2e ×13 |
| M9 stale guard — only FOREIGN refused; STALE and INDETERMINATE run | integrity e2e ×4 |
| M10 store lock integrity — a lock granted to any digest | store unit ×1 |
| M11 challenge — a rejected plan never challenges its terms | integrity e2e ×2 |
| M12 proposal lineage — a plan revision cannot find its contract | integrity e2e ×1 |
| M13 stale refusal leaves the task ACTIVE instead of FAILED | integrity e2e ×8 |
| M14 claim record drops the contract subject | gate e2e ×2, integrity e2e ×23 |
| M15 superseded lock — an older revision may be locked over a newer one | store unit ×1 |
| M16 specialist binding — a specialist resolves to no subject (the old behaviour) | integrity e2e ×8 |
| M17 specialist binding — a specialist with no coding ancestor is unbound instead of self-bound | integrity e2e ×4 |

#### Section 9 — the binding audit, and the fourth null it found

`resolveWorkerRole` accepts `SPECIALIST:*` and the router will pay for it, and
`juliusContractSubjectTaskId` answered **null** for every specialist — the same
null the architect gets, meaning "not bound", so a specialist child of a build
would have run a provider under no agreement whatever its parent had locked.
Nothing in production spawns one today; the compound-agent contract says
specialists are spawned by Julius under its own policy, i.e. as sub-agents.

Now a specialist is bound by the coding work it was spawned under (the parent
chain is climbed through any role to the nearest Coding Agent, and that
lineage's root is the subject — nested specialists included), and a specialist
with **no** coding ancestor is bound to **itself**: it needs a contract of its
own or it is refused `contract_absent` before admission, attempt 0, nothing
reserved. The fixture that seeds a deployment now seeds one contract per
subject using the runtime's own resolver rather than a copy of the rule. The
audit is enumerated, not implied: twelve placements across all four role
shapes, and the only nulls are `plan-1` and `plan-1:review`.

#### The coder receives the terms it is bound by

Until this change the contract charge reached only the reviewer, on the stated
reasoning that a coder "is bound by the contract but does not review against
it". So the coder was briefed by the plan in its context packet, the reviewer
graded against the locked contract, and "the coder executed under the
contract" meant only that a binding was written beside its claim. Now every
bound dispatch — build, repair round, sub-agent child — carries the same
`JuliusContractReviewCharge` the reviewer gets (stage `build` / `repair:build`
for the round), the hosted Claude coder renders it as a `--- TASK CONTRACT ---`
block after the architect plan (objective, boundary, scope, permitted paths,
prohibited actions, blocking criteria, required evidence and checks, failure
conditions, stopping condition, and the contract id, revision and digest), the
scripted adapter records it, and the e2e suite asserts the coder, its repair,
its review and its re-review hold one charge whose binding equals the binding
on each claim. The architect and its review receive none. This is a change to
the live coder prompt on the paid path, made deliberately: the reviewer and the
coder now hold one document rather than two readings of a plan. The coder's
brief also carries the contract's review criteria — what the reviewer will
check — and `contract-brief-parity.test.ts` holds the two renderers to every
content field of the charge, with a `satisfies` clause that refuses to compile
when a field is added to the type without a value in the test.

#### Section 12B — the contract and the Project Brain

Decided and proven rather than assumed: the Brain does NOT carry the contract.
The terms reach a worker on its dispatch (the charge above), and the packet's
content hash already covers both the Brain revision and the contract revision
and digest, so a packet compiled under either a different Brain or a different
agreement is a different document. What the Brain does carry — the DECISION
entry Julius writes when it accepts or repairs — is keyed on exactly what the
decision is keyed on, and the crash-after-LOCK case now asserts that the
resumed acceptance writes it once: no second Brain entry for an acceptance that
happened once. Writing `contract.locked` / `contract.challenged` into the Brain
was considered and not done: a worker would then read the agreement's state as
mission knowledge rather than receive it as its charge, and the two could
drift.

#### Section 12A — the Project Brain, read back into a packet on the real database

The write path was already proven on PostgreSQL (the run-row counter, the
`entry_kind` CHECK, the replay guard). What a worker actually RECEIVES is the
other half, and it is now proven there too: the production reader maps the
stored kinds back (`ACCEPTANCE_UPDATE` → `REQUIREMENT`, anything it cannot
classify → `ARTIFACT`, never dropped), scopes task-bound rows to their task
(the task the entries were written for compiles all five; another task in the
run compiles only the run-level constraint), and the packet's content hash
covers the Brain revision, so the same entries under a stale revision are a
different document. None of that is provable in memory, where the "store" is
the Map the compiler reads.

#### Section 12C — the repair trajectory is complete, and the bundle carries it

The trajectory is the record evals read to say what a run did, and until now
its DISPATCH rows could not say which agreement a dispatch ran under: a repair
lineage whose rounds ran under two revisions read as one story. Every DISPATCH
and RETRY row for a bound task now carries `contractTaskId`, `contractRevision`
and `bindingDigest` in its safe facts (null for the architect and its review —
a fact, not an omission). And the live evidence bundle gains `trajectory.tsv`:
kind, task, worker, provider, outcome, cost, duration, tokens, the closed safe
facts and the instant, ordered as they happened — which is exactly the "repair
path" and "cost" the founder asked to be preserved for the paid rerun, per row
rather than as a summary. The dump-enumeration test validates the new query
against the migrations like every other.

#### Section 12D — the Beta Gate measures the binding, not only the lock

`TASK CONTRACT LOCK` used to pass on the lock table alone: a contract locked
before the build. That cannot tell a build claimed under an OLDER revision, or a
review claimed under a NEWER one, from the run it exists to certify — exactly
the two shapes the guards above refuse. The live evidence dump now writes the
`julius.task.claimed` rows of every bound task into `contract-events.tsv`
beside the contract events (the revision and digest each coder and reviewer
actually executed under), and the row requires, when that file is present,
that the build and its review were claimed under the governing lock's revision
and digest and that no `binding_*` / `implementation_binding_absent` refusal
touched either. An older bundle without the dump keeps the weaker proof and its
basis says so. Six gate cases hold it — a stale claim (FAIL naming both
revisions), a binding refusal (FAIL naming the reason), a missing claim row
(FAIL: absence is not agreement), a review at a different revision than the
build (FAIL naming the review), the right revision under a different digest
(FAIL), and no dump (PASS, "not measurable") — and five mutations of the gate
logic were run against them. Two of the five SURVIVED the first three cases
(a missing claim row, and a digest-only mismatch, were untested); the cases
above were added for them and all five now die.

#### The dispatch path, checked ahead of the day it is needed

The three GitHub Actions tools the watch will use (`actions_run_trigger`,
`actions_list`, `actions_get`) load in this environment with the expected
shapes, and the paid workflow's `workflow_dispatch` inputs are exactly
`confirm_live`, `acknowledge_rerun`, `max_ticks` (default `24`), `hermes_ref`
(pinned default) and `mission` (default `julius-first-live`). The watch routine
now carries the verbatim payload — `workflow_id: julius-first-live-mission.yml`,
`ref: main`, `inputs: {mission: julius-live-mission-2, confirm_live: "",
acknowledge_rerun: "RERUN PAID MISSION", max_ticks: "32"}` — and the exact
MCP calls for each trust check, since no `gh` binary exists here. No run was
dispatched: `main` has not moved.

A note for the record: the repository's boundary scanner refused the first
draft of the worker-PR runbook for a push URL carrying an inline token
(`[secret] … possible connection URL with inline credentials`). The runbook now
authenticates `gh` and git from a token file and pushes with a plain remote.
That is the scanner doing its job on documentation, and it was right.

#### Section 12F — trust verification from this environment, stated precisely

`scripts/julius-main-provenance.mjs` and the review-currency check shell out to
`gh api`, and this container has no `gh` binary, so neither script can be RUN
here. On the day the repair lands, the watch's independent verification
(exact containment of `d8c9fab1`'s changes, candidate author
`julius-worker[bot]`, approver a different login, tree equality with the
reviewed head, accepted-main monotonicity, review currency) is done through the
GitHub MCP tools — `get_commit`, `pull_request_read` (`get`, `get_reviews`,
`get_commits`), `list_commits`, and the Actions artifact listing for the
`julius-accepted-main-<sha>` checkpoints — and the paid workflow's own step
"Gate: the code this job will run is reviewed, current and not rolled back"
remains the authority at dispatch: it runs the same scripts with the worker's
credential and refuses on its own. Nothing here weakens or reimplements those
gates; the pre-check exists so that a dispatch is never attempted against a
`main` the gate would refuse.

#### The gate, as run on the committed tree in this container

| Gate | Result |
|---|---|
| `npm test` (whole repository) | **504 files passed**, 1 skipped (env-gated real-infra), **9,688 tests passed**, 25 todo, exit 0, 183s |
| `npm run typecheck` (all four projects) | clean |
| `npm run build`, `relay:build`, `relay:bridge:build` | clean |
| `relay-repository-boundary.mjs`, `relay-parity-gate.mjs` | clean |
| `relay:surface-parity:check:strict`, `relay:yc-demo:check`, `relay:cli:contract-verify` | clean |
| `relay:persistence:contract-verify`, `relay:persistence:recovery-drill`, `relay:workspace:verify`, `relay:claude:contract-verify` | clean |
| `julius:harness:check` | current after `julius:harness:export`; the committed manifest is unchanged (the gitignored single-file export had gone stale, which is the check working) |
| `git diff --check` | clean |
| **real PostgreSQL 16** — migrations from empty, contract lock race, jsonb round trip, superseding, the binding CHECK, `one_per_task`, the corrupted-row read, **the six-round revision/acceptance race** | **6 passed**, 2 todo (Docker-gated) |
| mutations (17, production code, each restored) | 17 killed |

The same gate (every step above except the mutation row) was re-run in full
before each later commit on the branch — `49d00201` (Beta Gate binding row),
`f27c217d` (the coder's charge), `a63ce319` (trajectory) — and was green each
time: 9,698 and 9,699 tests on the two later whole-repository runs. The Brain
round-trip commit changed only the env-gated real-PostgreSQL suite and this
document, and was gated by all four typecheck passes, the real-PostgreSQL
suite on a fresh database (7 passed) and `git diff --check`.

### 00j. THE CREDENTIAL CEREMONY WAS ATTEMPTED AND THE ENVIRONMENT REFUSED IT

**2026-09-08.** The founder authorised a temporary `julius-worker` App private
key so this session could open the worker-authored PR itself, and supplied the
PEM. **Everything that does not touch the key succeeded. Every command that
touches the key was refused by the Claude Code auto-mode classifier**, which is
a guard in this environment, not a Julius rule and not something to route
around.

| Step | Result |
|---|---|
| ephemeral tmpfs dir `/dev/shm/julius-ceremony.FL1F89` | created (0700) |
| **copy the PEM into it** | **BLOCKED BY CLASSIFIER** |
| **run the minting script against the PEM** (upload path, no copy) | **BLOCKED BY CLASSIFIER** |
| re-author the eight repair commits as the App | **done and verified** (below) |
| push, open PR | not reached — needs the installation token |

The re-authored branch is real and waiting, in a throwaway worktree:

* worker head **`8fdd5acf9f4c1ab74231816eb462a4748e222b4e`**, branch
  `relay/julius-architect-gate-fix-worker`, not pushed;
* tree `868bf1c97d61b0d462945456a843b6e668beda45` — **identical** to the
  reference `relay/julius-architect-gate-fix @ d8c9fab1`;
* exactly **8** commits over `main`, every one authored AND committed by
  `julius-worker[bot] <325202980+julius-worker[bot]@users.noreply.github.com>`
  (one identity line, `sort -u`);
* the reference branch is untouched.

The minting script (`scratchpad/mint-installation-token.mjs`, session-local)
was proven end to end against a throwaway RSA key earlier the same day: it
validated the PEM, signed a ten-minute RS256 JWT, and reached GitHub's
installation lookup, which answered `404 Integration not found` for the
throwaway key — the correct answer at the correct step. It prints only the
installation id, the token expiry and the granted permissions.

**Nothing was destroyed.** The PEM remains where the founder uploaded it; no
key, branch, evidence bundle, database, handoff or workflow file was deleted,
revoked or rotated, per the founder's retention directive of the same day.
The `/dev/shm` copy of the key does not exist because the copy was refused —
not because anything was cleaned up.

**What unblocks it, founder's choice:**

1. **Add a Bash permission rule** for this session (the denial message names
   this remedy) allowing the ceremony commands, and this session finishes the
   ceremony in one pass — the branch is already re-authored and verified.
2. **Run `docs/JULIUS_WORKER_PR_RUNBOOK.md` on a machine that holds the key.**
   Step 1 is dry-run verified; steps 2–3 are ordinary App mechanics. The
   runbook is complete and current.
3. Supply a **short-lived installation token** instead of the App private key.
   Lower risk class, but likely refused by the same guard, and unverified.

Until one of those happens the paid path is where it was: `origin/main` at
`872f1790`, no `julius-worker[bot]` PR open, Tasks 1 and 2 NOT COMPLETE.

### 00k. THE WHOLE EVIDENCE CHAIN, PROVEN ON A REAL DATABASE, PROVIDER-FREE

**The join nobody had tested.** Three things were each proven separately: the
RUNTIME against an in-memory store (a program agreeing with itself), the DUMP's
column names against the migration SQL read as text, and the BETA GATE against
TSV fixtures written by hand in its own test. Between them sat the join that
actually decides whether a paid run leaves usable evidence: **a real run's rows,
read out of PostgreSQL by the dump's own queries, parsed by the gate.** That is
exactly where free dry runs #1 and #2 failed — `evidence.tsv` and `findings.tsv`
arrived reading `unavailable` because a query named a column the migrations
never created — and a paid run cannot be repeated for free to find out.

`src/relay/persistence/julius-live-chain.e2e.test.ts` (env-gated, same gate as
the real-infra suite) closes it:

1. seeds the deployment through the **production** `MissionSeedStore`, creates
   the run through `JuliusPostgresRepository`, walks `CREATED → PLANNING →
   READY` (the transition table refuses the shortcut), seeds the build's
   contract as a DRAFT exactly as the bootstrap writes it;
2. drives a **complete mission** through the production Postgres store with
   scripted adapters — plan, plan review accepts, build, **build review
   REJECTS**, repair round, re-review accepts — to `COMPLETED`;
3. runs the **14 queries the shipping dump script contains**, extracted from
   the script itself, with the same `-A -F '\t'` flags, and refuses the
   `unavailable` sentinel on every file;
4. hands the result to the **Beta Gate**, which passes ten runtime rows from
   database output: PROJECT CREATION, JULIUS MISSION START, PROMPT ARCHITECT,
   CODING AGENT, **TASK CONTRACT LOCK**, INDEPENDENT REVIEWER, REPAIR LOOP,
   VERIFICATION, VERIFIED COMPLETION, PROJECT BRAIN PERSISTENCE — with the
   contract row earning the STRONG basis ("the build and its review were
   claimed under that revision and digest"), the logic added the same day and
   never before read against real rows;
5. then **moves the claim's recorded revision in the database** — the one place
   a mismatch can be manufactured without touching code, and the shape a stale
   handoff leaves behind — re-dumps, and requires the gate to FAIL naming
   revision 99.

**Mutations, both killed.** L1: a dump query names a column the migrations never
created → the test fails (this is the dry-run #1/#2 defect, now caught before a
paid run rather than after). L2: the gate stops comparing the binding a build
ran under → survived against the happy path alone, which is why step 5 exists;
with it, killed.

**What it does NOT cover, stated rather than implied:** the dump script wraps
each query in `docker exec` against the mission's container; there is no
container here, so the TRANSPORT is unexercised — the `first-live-topology` job
covers that. The SQL, the row shapes and the gate's reading of them are covered.

Also confirmed the same session: all 23 migrations apply from empty to a fresh
database (59 tables in `relay_wonderland`), and all 14 dump queries execute
against it.

### 00l. WHAT A SUCCESSFUL PAID RUN CAN ACTUALLY SCORE — the Beta Gate's ceiling

**"15/15" is not reachable by one clean mission, by construction.** This is a
property of the instrument, not a defect in it, and it needs saying before a
paid run comes back reading 11/15 and somebody calls that a failure.

Four rows cannot be earned by a flawless single run:

| Row | What it requires | Why a clean run cannot earn it |
|---|---|---|
| `WONDER WEB OUTPUT` | the module to exist | **NOT BUILT** — nobody has written it |
| `ACCOUNT / ONBOARDING` | `sessions.tsv` naming a real player | both bounded missions run under an operator token, so it reads as the operator |
| `FAILURE RECOVERY` | a `julius.retry.scheduled` whose task later SUCCEEDED | nothing to retry if nothing fails |
| `RESTART / RECOVERY` | a non-empty `recovery_action` | nothing to reclaim if nothing crashes |

And a fifth, `REPAIR LOOP`, needs a **rejected** review — a mission whose
reviewer approves first time earns no repair round.

So the arithmetic for a single paid mission, today:

* flawless (no rejection, no retry, no crash) → **10/15**
* with a rejected review and a repair round → **11/15**
* plus one transient provider failure that retried and succeeded → **12/15**
* plus a crash whose lease was reclaimed → **13/15**, which is the **ceiling**
  until Wonder Web is built and a real account starts a mission

Verified rather than reasoned: run 34186711214's `failures.tsv` carries **zero**
`julius.retry.scheduled` rows and **zero** non-empty `recovery_action` values,
so both rows read FAIL there — correctly, because neither path ran. And the
provider-free chain proof in §00k, which DOES script a rejection and a repair,
earns ten rows without receipts.

**The design question, for the founder, not for me to answer by editing the
gate.** `RESTART / RECOVERY` asks a paid mission to crash in order to prove
recovery works. The recovery path is already proven by
`relay:persistence:recovery-drill` and by the chaos suite, on demand and for
free. Should that row accept a drill artifact as proof, or should it keep
demanding a crash inside the measured mission? Making it accept the drill would
raise the achievable score to 14/15; it would also mean the row no longer says
"this mission recovered". **Nothing was changed either way** — weakening a gate
to improve a number is the one thing the gate exists to prevent, and which of
those two the row should mean is a product decision.

**ANSWERED BY THE FOUNDER, 2026-09-08, and built — see §00m.** The row now
accepts a drill, under conditions that make "accepts a drill" mean something.

### 00m. THE FOUNDER'S ANSWER — MISSION PROOF and CAPABILITY PROOF are two questions

The founder's instruction, in their words: *"Do NOT weaken the gate merely to
increase a score. But also do NOT require a healthy paid mission to deliberately
crash just to prove restart/recovery… A flawless paid run should therefore be
able to report: RESTART/RECOVERY: CAPABILITY PROVEN — NOT EXERCISED THIS MISSION
rather than pretending the mission recovered from a crash. Preserve the ability
to separately detect when a real mission DID crash and recover."*

That is now what it does. Two commits: the gate's evidence model, and the drill
that can earn the new verdict.

#### The model

Every row carries **two** facts, and the report prints both:

| Axis | Values | Read from |
|---|---|---|
| MISSION — *what did this run prove?* | `EXERCISED`, `FAILED`, `NOT EXERCISED`, `UNKNOWN` | that run's own durable rows, only |
| CAPABILITY — *what is Julius ready to do?* | `PROVEN`, `STALE`, `UNPROVEN`, `NOT ADMISSIBLE` | a recorded drill attestation, only |

and one verdict derived from them: `PASS`, `CAPABILITY PROVEN`, `FAIL`,
`NOT BUILT`. A flawless mission reads

```
RESTART / RECOVERY   CAPABILITY PROVEN   NOT EXERCISED   NOT EXERCISED THIS MISSION —
  nothing was interrupted in this run, so no lease was ever reclaimed; proven instead
  by a drill: npm run julius:recovery-drill drove 2 production file(s) against
  real-postgres,two-processes,real-lease-expiry,no-provider-call and passed 12 step(s)
```

and a mission that **did** crash and recover still reads `PASS` / `EXERCISED`,
naming the recovery actions. The meanings did not collapse; that is the point.

#### Three rules that keep the third verdict from becoming a laundry

1. **A failed mission is never rescued.** Exercised and broken reads `FAIL`
   whatever any drill says. The drill proves the path; it cannot un-break what
   this run did.
2. **Mission-required rows admit no drill at all.** The eight a run physically
   walks between "a project exists" and COMPLETED — creation, start, plan,
   build, contract lock, review, verification, completion — are
   `NOT ADMISSIBLE`, so 15/15 cannot be reached by drilling past a mission that
   never built anything. An attestation filed against one is reported as seen
   and inadmissible, never silently dropped.
3. **An attestation is evidence, not an assertion.** `capability-proofs.tsv` is
   admissible only when its outcome is `VERIFIED`, every `exercised_path` still
   hashes to the `exercised_digest` it recorded, those paths **cover every file
   the row's own probe names**, and the drill's transcript is present with the
   declared number of `[PASS]` steps and no `[FAIL]`. Edit a proven file and the
   proof reports `CAPABILITY STALE` — capability proofs expire rather than
   accumulating as folklore about a tree that has changed underneath them.

Each row now publishes `implementedBy` in `--json`, so a drill author reads the
coverage requirement out of the report instead of out of the gate's source.

Six mutations were run against the new axis — a launderable failed mission,
universal admissibility, and dropping each of the digest, coverage, transcript
and outcome checks — and the tests kill all six.

#### The drill that earns it

`npm run julius:recovery-drill` (`scripts/julius-recovery-drill.ts`), two real
processes over one real PostgreSQL:

* **A** bootstraps a mission through the production seed store and ticks the
  production run loop; its architect adapter calls `process.exit(87)`
  mid-dispatch, leaving the task ACTIVE with the lease held, the generation
  recorded and nothing written back. A crash, not a cancellation.
* **the lease really expires** — the orchestrator asks the database whether
  `lease_expires_at` has passed rather than injecting a future `now`, because a
  sweep proven against a fabricated clock is proven against a clock nobody runs.
  `assembleLiveJuliusRuntime` gained an optional `leaseMs` for this; production
  still gets ten minutes.
* **B** is a fresh process that has never seen the run. It assembles the same
  production runtime and ticks; the run loop's own sweep reclaims the lease
  through `recoverExpired` → `planJuliusRecovery`, requeues, and the mission
  finishes.

Twelve steps, and the refusals are the point: a recovery that **replays** the
crashed dispatch is a double spend, so the drill fails unless the crash banked
no result and the reclaimed task ran exactly once afterwards; a run that
completes without the sweep having acted fails the same way; and a database
that already holds the drill's run is refused outright, because a drill that
reads the previous run's sweep and reports PASS about it is not testimony. A
failed drill still files its ledger, recording `FAILED`, which the gate refuses
on the outcome column and on the transcript both. Zero provider calls: the
three C.A.R.D. adapters are fakes and only the recovery path is production.

Where it runs:

* **`first-live-topology`** on every relevant PR — it already has the real
  PostgreSQL — and that step **fails if the gate refuses what the drill
  produced**. This is what stops the drill and the gate drifting apart.
* **after a paid mission**, in a database of its own and after the dump, copying
  `capability-proofs.tsv` and the transcript into `julius-live-evidence/`, so a
  paid bundle carries its own capability proof. Nothing there may fail the job.

#### The audit of the other four rows — verdicts unchanged, as instructed

| Row | What changed | Verdict |
|---|---|---|
| `REPAIR LOOP` | "no repair task" now reads NOT EXERCISED — a mission whose reviewer approves first time has not *failed* at repairing — and a drill is admissible | unchanged; no attestation exists |
| `FAILURE RECOVERY` | separates "nothing failed retryably" (NOT EXERCISED) from "retries scheduled, none succeeded" (FAILED) and an unreadable dump (UNKNOWN) | unchanged; no attestation exists |
| `ACCOUNT / ONBOARDING` | a missing dump reads UNKNOWN, an empty one NOT EXERCISED | unchanged |
| `WONDER WEB OUTPUT` | gains an UNKNOWN branch for the day the module exists and its dump does not | unchanged — still NOT BUILT |

`RESTART / RECOVERY`'s probe also dropped `src/relay/persistence/index.ts` and
gained `src/relay/persistence/julius-recovery-postgres.ts`: now that the file
list decides what a drill must have driven, a re-export in it would let an
attestation claim a file it never exercised.

#### The new ceiling

The §00l arithmetic, restated. A flawless single paid mission can now report
**11 of 15 proven** — ten by the mission, one by drill — with `REPAIR LOOP`,
`FAILURE RECOVERY`, `ACCOUNT / ONBOARDING` and `WONDER WEB OUTPUT` open; a
mission with a rejected review and a repair round, **12**. `REPAIR LOOP` and
`FAILURE RECOVERY` are now *drillable* and no drill has been written for them,
which is honest work outstanding rather than a gate that flatters itself.

**Verified end to end in this container on real PostgreSQL 16**, not reasoned:
the drill passes its twelve steps, the gate accepts its attestation, a second
run against the same database is refused and files `FAILED`, and the completed
live-chain mission dumped by the shipping script's own queries — carrying that
attestation — reads **9 rows proven by the mission and 1 by the drill**, with
`TASK CONTRACT LOCK` correctly FAILED because that proof deliberately mutates a
claim revision in the database at the end.

### 00i. The next paid rerun — the record it must leave (template, to be filled by the run)

> Not a run. This is the shape the record takes the moment the watch dispatches
> the paid rerun of `julius-live-mission-2` on a trusted `main` carrying the
> 34186711214 repair. Every row is a fact the bundle or the Actions run states;
> **Unknown stays Unknown**, never inferred. Fill it from
> `julius-live-evidence/` (the dump) and the Actions job log, in this order.
>
> **CORRECTION, 2026-09-08 — read this before filling anything in.** The paid
> run executes on **`main` + the repair**, and the contract stack is NOT on
> main. Verified by reading all three trees:
>
> * the bundle will carry **nine** files — `runs`, `tasks`, `evidence`,
>   `decisions`, `findings`, `failures`, `budget`, `tool-invocations`,
>   `worker-diagnostics` — and **not** `task-contracts.tsv`,
>   `project-brain.tsv`, `sessions.tsv`, `contract-events.tsv` or
>   `trajectory.tsv`. Those five arrive only when the contract stack lands.
>   Their absence is the bundle being what that commit writes, **not** a failed
>   run, and must not be recorded as one.
> * **`scripts/wonderland-beta-gate.mjs` does not exist on `main` or on the
>   repair branch.** The gate is an instrument on this stack: run it from a
>   checkout of `relay/julius-contract-stack-rebased` against the DOWNLOADED
>   bundle, exactly as was done for run 34186711214. Rows needing the five
>   absent files will read "no dump", which is the honest answer.
> * **TASK 2's proof is in `worker-diagnostics.tsv`**, whose columns the repair
>   branch adds: `validation_passed`, `validation_reason_code`,
>   `validation_field`, `validation_claim_phrase`, `plan_attempts`,
>   `review_attempts`. A crossed architect boundary reads as
>   `validation_passed=t`, or as one refusal that NAMES its field and claim
>   phrase followed by a second attempt that passes — which is precisely what
>   runs 34185920678 and 34186711214 could not produce.

| Field | Where it comes from | Value |
|---|---|---|
| Actions run id | the dispatch response / `actions_list` | |
| exact `main` SHA, frozen | the gate step "reviewed, current and not rolled back" | |
| provenance verdict / approver / author | the same step's log (`julius-main-provenance.mjs`) | |
| monotonicity checkpoint(s) contained | the same step | |
| mission inputs | `mission=julius-live-mission-2`, `confirm_live=RUN LIVE MISSION`, `acknowledge_rerun=RERUN PAID MISSION`, `max_ticks=32`, `hermes_ref` default | |
| budget ceiling / repair cycles | `runs.tsv`, mission contract (`spendUsd`, `repairCycles`) | |
| provider calls (count, model, response ids) | `worker-diagnostics.tsv`, job log (`resp_…`) | |
| architect: `plan_attempts`, `validation_passed`, `validation_reason_code`, `validation_field`, `validation_claim_phrase` | `worker-diagnostics.tsv`, `failures.tsv` — **this is TASK 2's evidence** | |
| plan review: verdict, findings | `evidence.tsv` (REVIEW_FINDING), `findings.tsv`, `decisions.tsv` | |
| contract: id, revision locked, digest, lock instant, evaluator | `task-contracts.tsv` — **absent until the stack lands**; record Unknown | |
| contract: challenged revisions, if any | `contract-events.tsv` — **absent until the stack lands**; record Unknown | |
| coder: allocation, cost, outcome | `budget.tsv`, `worker-diagnostics.tsv` (`cost_usd_micros`, `cost_source`, `runtime_started`); the claim binding needs `contract-events.tsv`, absent until the stack lands | |
| the actual diff | the run's artifact / `evidence.tsv` DIFF row | |
| build review: claim binding, verdict, findings | `contract-events.tsv`, `findings.tsv`, `evidence.tsv` | |
| repair path: rounds, task ids, cost | `tasks.tsv` (`repair:*`), `decisions.tsv`, `budget.tsv`; per-row trajectory needs `trajectory.tsv`, absent until the stack lands | |
| verification decisions, in order | `decisions.tsv` | |
| binding refusals (`binding_*`, `*_mismatch`) | only observable once the stack lands; **the stale-handoff and reviewer-binding guards are not on main**, so this run cannot exercise them | |
| total cost (µUSD) and per-role settlement | `budget.tsv`, `worker-diagnostics.tsv` | |
| final run state / halt cause | `runs.tsv`, `live-mission.evidence.txt` | |
| Beta Gate over this bundle | run from a `relay/julius-contract-stack-rebased` checkout (the gate is absent on main): `node scripts/wonderland-beta-gate.mjs --evidence <downloaded dir>` | |

Declarations, only when the rows above say so:

- `TASK 1 COMPLETE — JULIUS LIVE RUN 2` when the final state is `COMPLETED`
  via `MISSION_VERIFIED` with no founder rescue.
- `TASK 2 COMPLETE — JULIUS BLOCKER KILL` when, in addition,
  `worker-diagnostics.tsv` shows the architect gate that killed 34185920678 and
  34186711214 was CROSSED on this exact rerun: `validation_passed=t`, or one
  refusal carrying a non-empty `validation_field` and `validation_claim_phrase`
  followed by a second attempt (`plan_attempts=2`) that passed. Both prior runs
  recorded `validation_passed=f` with an EMPTY `validation_field` and a single
  attempt; either shape above is the repair working.

If it fails: the first causal blocker is the earliest row above that is not
what the design says, classified RUNTIME / PERSISTENCE / PROVIDER / EXTERNAL,
reproduced provider-free, fixed, and taken back through the worker-PR runbook.

### 00j. Where this session left things (2026-09-08, ~14:50Z)

**Branch `relay/julius-contract-stack-rebased`**, pushed, 36 commits over
`main` `872f1790`; the newest fourteen, oldest last:

- `423f2867` Docs: the contract stack's rebase onto the repair, rehearsed and recorded
- `e59626d6` Handoff: the dispatch path checked ahead of the day it is needed
- `75ee1cf2` Julius: the coder sees the review criteria, and the two renderings of the contract are held to every field
- `a1ca0d3f` Docs: the runbook's re-authoring step is dry-run verified, and the blocker section names the current generation
- `4087f12c` Docs: the founder's runbook for landing the 34186711214 repair as a worker-authored PR
- `059e89fe` Julius: the Project Brain a run wrote is read back into a worker's packet, proven on PostgreSQL
- `a63ce319` Julius: every dispatch row names the agreement it ran under, and the bundle carries the trajectory
- `f27c217d` Julius: the coder receives the locked terms it is bound by
- `49d00201` Beta Gate: the contract row measures the binding a build ran under, not only the lock
- `416a7640` Julius: a stale handoff cannot buy a provider, and the reviewer holds the coder's binding
- `a4ff8f74` Julius: prove a crash after the answer is bought never buys it twice
- `8c0f3eca` Handoff: all eight repositories retry, and settlement's boundary is the design
- `7d04f7cc` Handoff: six of eight retry, and the two corrections behind that number
- `8eed1d5a` Handoff: correct the serialization count, and name the three still exposed

**Every gate green on the tree as pushed** (§00h's table, re-run before each
commit that touched code). **Nothing paid was dispatched.** `origin/main` is
`872f1790`; no `julius-worker[bot]` PR exists; the hourly watch
(`trig_01PvdqADjSgk5aUH9dvugJEZ`, :35 UTC) carries the verbatim dispatch
payload and the MCP-based trust checks.

**The one action that unblocks Signal Task 1** is the founder's:
`docs/JULIUS_WORKER_PR_RUNBOOK.md`, Step 1 dry-run verified. After that squash
lands, `docs/JULIUS_STACK_REBASE_NOTES.md` carries this branch onto it with
three known resolutions, verified against the whole suite (9,716 tests).

**Task 1 and Task 2 remain NOT COMPLETE** — they need the paid rerun.

---

## 0a. PR #234 SUPERSEDES THIS BRANCH'S HEADLINE FIX — READ FIRST

**Session 2026-09-07.** Before doing anything else on the coder ceiling: it is
already fixed, better, in an open pull request nobody had noticed from here.

**PR #234 — `relay/julius-run-34037313976-defects`**, authored by
`julius-worker[bot]` in a different session, repairs **all four** defects of paid
run 34037313976, not just the one this branch found:

| Defect | What it was | This branch |
|---|---|---|
| 1 | The mission budget did not govern the hosted Coding Agent | `14741f7` — the same bug, a narrower fix |
| 2 | The reviewer was not stage-aware, so a **plan** review demanded a diff | not addressed — **this is the false-findings root cause** |
| 3 | A rejected plan minted an unroutable `repair:plan` | not addressed — **this is the `PROVIDER_UNAVAILABLE` dead end** |
| 4 | Build ran before the plan review cleared | not addressed |

#234's DEFECT 1 is `julius-allocation.v1`: mission contract → run budget →
per-dispatch share → **reservation** → adapter limit, with settlement, unknown
cost handling and `maxBudgetUsd` on the SDK. `14741f7` computed the same number
for mission 2 ($5.00) and stopped there. **`14741f7` is superseded. Do not land
both** — they edit the same files in the same places.

Its state, verified 2026-09-07: **all CI green** (Verify Relay 7m29s, both
topology jobs, sibling-control-plane, Vercel), `MERGEABLE`/`CLEAN`, **zero
commits behind main**, and **zero reviews**.

### The one action, and why I did not take it

The paid workflow's trust gate requires the commit to be the tip of `main`, and
`reviewed-main provenance` to say `provenant` for it. That means a pull request
**authored by the coding worker** and **approved by the founder** —
`WORKER_AUTHOR_LOGINS = ['julius-worker[bot]']` against
`REVIEW_AUTHORITY_LOGINS`. #234 satisfies the author half already.

**So the single blocking action is: the founder approves and merges PR #234.**
Nothing else gates Phase 2/3. Monotonicity is already satisfied — two
non-expired `julius-accepted-main-<sha>` artifacts exist (`f131098c`,
`67ade6ea`, both 2026-09-06) and **both are contained in `main`**, and the rule
is containment of all of them, so a forward merge keeps it `monotonic` with no
new `accept main` dispatch.

**A discrepancy worth the founder's attention.** `julius-review-currency.mjs`
justifies the founder login as an external approver on the grounds that the
credential "was removed on 2026-09-05 when the worker App replaced it — so an
approval carrying this login is a statement by someone outside the environment
being reviewed." **It was not removed.** `gh auth status` in this checkout on
2026-09-07 reports `ohdieyuh-glitch` with `repo` and `workflow` scopes. The
environment being reviewed can therefore approve its own worker-authored
candidate, which is precisely the "self-certification with extra steps" the file
names as the thing to prevent. I did not use it, and the gate should not be
relied on until the token is actually gone.

---

## 0b. Where the work lives now (2026-09-07)

| Branch | PR | Base | State |
|---|---|---|---|
| `relay/julius-run-34037313976-defects` | **#234** | `main` | worker-authored, CI green, MERGEABLE, **0 reviews** — the blocker |
| `relay/julius-brain-and-beta-gate` | **#235** (draft) | #234 | this session's work, stacked |
| `relay/coder-ceiling-mission-budget` | — | `main` | **superseded**, kept as the record. Do not land. |

### The authorship constraint, which is not obvious and is load-bearing

`julius-main-provenance.mjs` answers `unprovenanced` unless the pull request that
landed the current `main` commit was **authored by `julius-worker[bot]`**
(`WORKER_AUTHOR_LOGINS`). This coding environment holds **only** the founder
credential — `gh auth status` says `ohdieyuh-glitch`, and there is no worker App
credential in `~/.config/gh/hosts.yml` or the environment.

**Therefore #235 cannot land on `main` as authored, and merging it would make
`main` unprovenanced and block every paid live mission** until a worker-authored
PR landed on top. It is a draft for exactly that reason. To land it, the commits
must be re-authored through the worker App, or carried into a worker-authored
pull request.

This is also why #234 — worker-authored, in a different session's environment —
is the only currently available route to trusted main.

### What #235 contains

- **The Project Brain's write side, wired into the run loop.** Verification
  decisions now persist, guarded by `decisionRecorded` so a replay writes nothing
  and moves no revision. Revisions are allocated by the store under the run row's
  lock and continue past a bootstrap seed. `brainKindToStored` closes a trap
  where OBJECTIVE/REQUIREMENT/EVIDENCE would have been rejected by migration
  014's CHECK **inside a paid mission** while passing every in-memory test.
- **The Beta Gate** (`npm run relay:beta-gate`), with its CODING AGENT probe
  repointed from the superseded `coder-budget.ts` to `julius-allocation-runtime.ts`.
- **A schema reader fix that #234 also needs** — the evidence-dump check could
  not see migration 001, so half the database was invisible to it.
- **`project-brain.tsv` and `sessions.tsv`**, making two Beta Gate rows
  measurable rather than permanently unknown.

Gates on #235: typecheck clean on all four projects, Julius domain and
persistence suites green, #234's own paid-run reproduction still green,
repository-boundary / parity / harness-manifest / `git diff --check` all pass.
**Provider calls this session: zero.**

---

## 0. The checkouts, and why the divergence matters

| Checkout | Branch | HEAD | Tree | Contains |
|---|---|---|---|---|
| `/home/thomasajvt13/dev/sunday-relay` (primary) | `relay/wonderland-v2` | `0250fa2` (moved during this session) | dirty — `wonderland/infra/build/hero_shots.py` **and** `wonderland/v2/layout_v2.py` modified | the **world** stream, **actively worked by another session** |
| `/home/thomasajvt13/dev/sunday-relay-main` (linked) | `relay/coder-ceiling-mission-budget` | see §8 | clean | the **Julius + web** stream |

`origin/main` and `origin/relay/wonderland-v2` diverged at `3247473` (#117).
Since then: **main +71 commits, wonderland-v2 +775 commits.** They are two
different products' worth of work and neither is a superset.

**Verified, not assumed:**

- `src/relay/ui/landing/` — `RelayLanding.tsx`, `choreography.ts`, `three/`,
  `brand-casing.test.tsx`, the i.Wonder / Relay's Wonderland 3-D landing from
  **#229** — exists **only on `main`**. It is **absent from `wonderland-v2`**.
- `wonderland/` on `wonderland-v2` holds `WorldDesign/ infra/ marble/ proof/
  rendering/ tests/ tools/ v2/ web/`. On `main` it holds only
  `Config/ Scripts/ Source/ Tools/`.
- `wonderland/web/{gait,inspector,player}` on `wonderland-v2` is the nearest
  thing in the repository to a Wonder Web surface, and it is **not** connected
  to Julius mission output.

**Do not** reset, checkout-over, or blind-merge either branch into the other.
Integration must be targeted (cherry-pick or a dedicated integration worktree),
and the 3-D landing must survive it.

---

## 1. Signal Cycle #1

### Task 1 — a real end-to-end creation mission: **NOT COMPLETE**

Verified against GitHub Actions, not against unit tests. `julius-first-live-mission.yml`
has **17 dispatches**. Eleven never reached the paid step — the `success` ones
stop at *"Preflight complete — stopping here (no confirm_live given)"*, confirmed
by reading that step's conclusion, and three `failure` ones died in preflight.

**Six dispatches entered the LIVE step. All six failed. None has ever reached
`COMPLETED`.**

| # | run | commit | mission | plan | build | review | stopped on |
|---|---|---|---|---|---|---|---|
| 1 | `33697109210` | `fb4f21f` | 1 | ✗ | — | — | the `plan` task; no marker uploaded — the run F6's marker guard exists because of |
| 2 | `33802017460` | `6e52a11` | 1 | ✅ | ✅ | ✗ | both reviews `reviewer_review_incomplete` |
| 3 | `33897565981` | `1e78bb0` | 1 | ✗ | BLOCKED | — | `plan_validation_failed` |
| 4 | `33907599197` | `569e418` | 1 | ✅ | ✅ | ✗ | both reviews `review_authentication_failed` |
| 5 | `33924009789` | `9c593ff` | 2 | ✅ | ✗ | ACTIVE | `coder_refused` — the opaque single class, before the four-way split |
| 6 | `34037313976` | `b2dc9f2` | 2 | ✅ | ✗ | ✅ | `coder_cost_exceeded` — the same failure, finally named |

**Read the column, not the rows.** Six paid runs is not six random failures; it
is one pipeline being walked forward a step at a time, each blocker fixed in
turn:

`plan_validation_failed` → #218 · `reviewer_review_incomplete` → #217 ·
`review_authentication_failed` → **no code change; a replaced secret — see §6** ·
`coder_refused` (opaque) → the four-way refusal split ·
**`coder_cost_exceeded` → `14741f7`, this session.**

Run 6 is the furthest any mission has got: **plan ✅, reviewer ✅ (on retry),
verification ✅ — and build the only ✗ on the happy path.**

**And the ceiling is not only mission 2's problem.** Mission 1's build SUCCEEDED
in both runs that reached it; mission 2's has failed both times. Mission 1 asks
for a trim-and-lowercase with four acceptance criteria; mission 2 for a
summariser with an earliest-entry tie-break, two exact refusal messages and six
criteria — a materially bigger job. The constant therefore caps how hard a
mission Julius can complete at all: any task whose Coding Agent reports more than
fifty cents was refused, whatever budget the founder had authorised.

**Stated as evidence rather than as inference**, because the tempting version of
that sentence is not supported: *what mission 1's coder actually cost is not
recorded anywhere.* The pre-`14741f7` bundles have no cost column, and
`worker-diagnostics.tsv` only carries a row for a worker that FAILED — a
succeeding coder writes none. So mission 1's build passing the ceiling means its
reported cost was ≤50¢ **or was never reported at all**: `withinCostCeiling`
treats an unknown cost as within bounds on purpose ("unknown cost is not a pass
and not a failure"), so a run whose provider reports no cost is never refused.
The `reportedCostUsd` column added in `14741f7` is what makes the next run able
to answer this.

The best artifact this project has is run `34037313976`:

```
gh run download 34037313976 -R ohdieyuh-glitch/sunday-relay
```

### Task 2 — the highest-impact blocker: **FOUND, REPRODUCED, FIXED**

**What run 34037313976 recorded** (`runs.tsv`, `tasks.tsv`, `failures.tsv`,
`worker-diagnostics.tsv`):

| task | role | state | why |
|---|---|---|---|
| `…:plan` | PROMPT_ARCHITECT | SUCCEEDED | validated plan artifact, 15,812 chars |
| `…:build` | CODING_AGENT | **FAILED** | `WORKER_EXECUTION_FAILURE` / **`coder_cost_exceeded`** |
| `…:plan:review` | INDEPENDENT_REVIEWER | SUCCEEDED | after one retryable `review_timeout` |
| `repair:…:plan:1:task` | CODING_AGENT | FAILED | `PROVIDER_UNAVAILABLE` |
| run | — | **FAILED** | `TASK_FAILED` after 5 ticks |

**The finding that matters.** `worker-diagnostics.tsv` records the coder run as
`resultSubtype: success`, `isError: false`, `numTurns: 7`, `toolUseCount: 6`,
`permissionDenials: 0`, `implementationPresent: true`. The uploaded
`workspace.diff` implements `summarizeRuns` — count, totalMs, earliest-entry
tie-break, both exact refusal messages — and replaces the placeholder test with
five real cases.

**That diff was replayed offline into the mission's own declared command:**

```
node --test run-summary.test.js   →  5 passed, 0 failed, exit 0
```

Every blocking acceptance criterion of `mission:julius-live-2` is satisfied by
the work that run produced. **Julius threw it away.**

**Root cause.** `DEFAULT_HOSTED_LIMITS.maxCostCents = 50`
(`relay-bridge/hosted-coding-agent/hosted-envelope.ts`) is a global constant.
`createLiveHostedCodingAdapter` called `runHostedCodingAgent` **without
`limits`**, so every Julius Coding Agent invocation was refused above 50¢ — while
#233 had recorded a founder-authorised **$20 / 3 repair cycles** for exactly this
mission. The authorisation reached the C.A.R.D. and `JuliusBudgetPort`
(`spendCeilingUsdMicros`), then stopped one level short of the worker that spends.

**The consequence, which the artifact could not explain.** The workspace diff is
captured *after* the coder's result is accepted. A refused result strands the
edit and hands the Independent Reviewer nothing — so its six blocking findings
that run ("No edit occurred. The supplied resulting content is empty") were
**every one of them false about a workspace that had been correctly edited**.
Verification then decided `REPAIR / BLOCKING_FINDINGS` on that false basis.

**The fix** (commit `14741f7`):

- `relay-bridge/julius/coder-budget.ts` — one place derives the per-invocation
  ceiling from what the mission bought: `spendUsd ÷ (1 + repairCycles)`, the
  number of times the contract permits a Coding Agent dispatch. Mission 1 → 250¢,
  mission 2 → 500¢. Unreadable or absent budget falls back to the 50¢ default
  (the direction #233 chose); a mission bounded tighter keeps its smaller number.
- The ceiling is threaded `contract.limits → resolveLiveWorkers →
  createLiveHostedCodingAdapter → runHostedCodingAgent`. `hosted-invoker.ts`
  (the browser route the constant was written for) is untouched.
- `costCeilingCents` and `reportedCostUsd` now travel through the domain's closed
  diagnostics shape (`safeReviewDiagnostics`) into the durable row and out into
  `worker-diagnostics.tsv`. The free preflight prints the ceiling the paid run
  will enforce, on an allowlisted numbers-only line.

**The rerun evidence, offline and free** — `julius-live-composition.test.ts`,
`describe('paid run 34037313976, reproduced: a mission-blind coder ceiling')`.
These drive the **real** `runHostedCodingAgent` (its trust, containment and cost
gates all execute) over a fake `query` yielding the shape the paid run observed:

- today's exact signature reproduces: build `FAILED`,
  `WORKER_EXECUTION_FAILURE`, `coder_cost_exceeded`, not retryable, run `FAILED`;
- the **identical** run, differing only in whether the mission's authorisation
  reached the worker, reaches `COMPLETED`;
- the diff artifact is `null` on the refused path and present on the funded one
  (this is the false-findings bug, held);
- a mutation pinning the ceiling below the run's cost turns it red again.

**Still outstanding:** the paid rerun. See §6.

### Task 3 — Wonderland Beta Gate: **BUILT AND EXECUTABLE**

`npm run relay:beta-gate [-- --evidence <dir>] [-- --json]`
(`scripts/wonderland-beta-gate.mjs`, locked by `scripts/wonderland-beta-gate.test.ts`).

Fourteen capabilities, each resolving to exactly **PASS / FAIL / NOT BUILT**. No
percentage, no fourth value. **PASS requires a live mission evidence bundle** —
there is structurally no branch that infers a pass from repository state, so a
green suite cannot produce one. Exit 0 only when all fourteen PASS.

Against run `34037313976` — **7/14 PASS, NOT BETA READY**:

| Capability | Verdict | Basis |
|---|---|---|
| ACCOUNT / ONBOARDING | FAIL | the live mission runs under an operator token; no run evidence exercises onboarding |
| PROJECT CREATION | PASS | run created for `mission:julius-live-2` |
| JULIUS MISSION START | PASS | accepted in READY, loop driven |
| PROMPT ARCHITECT | PASS | plan task SUCCEEDED with a validated artifact |
| CODING AGENT | **FAIL** | build FAILED (`WORKER_EXECUTION_FAILURE`/`coder_cost_exceeded`) |
| INDEPENDENT REVIEWER | PASS | review task SUCCEEDED, 6 structured findings |
| REPAIR LOOP | **FAIL** | 1 repair task created, none SUCCEEDED |
| VERIFICATION | PASS | recorded `REPAIR/BLOCKING_FINDINGS` |
| VERIFIED COMPLETION | **FAIL** | run ended FAILED |
| WONDER WEB OUTPUT | **NOT BUILT** | no Wonder Web module exists |
| PROJECT BRAIN PERSISTENCE | FAIL | the bundle carries no Project Brain dump; no durable brain write proven |
| RESTART / RECOVERY | FAIL | no restart occurred; recovery unexercised |
| FAILURE RECOVERY | PASS | `review_timeout` retried, then SUCCEEDED |
| PERMISSIONS / MISSION BOUNDARIES | PASS | 0 permission denials, 4 signed executor receipts |

**Top three beta gaps** (creation-path order, computed deterministically):
1. **CODING AGENT** — `coder_cost_exceeded` *(fixed in `14741f7`; awaits the paid rerun)*
2. **REPAIR LOOP** — no repair task has ever succeeded
3. **VERIFIED COMPLETION** — no run has ever reached COMPLETED

Pointed at this repository with **no** evidence it reports **0/14**, which is the
honest answer and the reason the gate is worth having.

### Task 4 — world quality: **NOT STARTED THIS SESSION, AND NOT FOR LACK OF TOOLING**

Deliberate: Julius's creation path was the higher-priority work, and the
founder's own instruction is that Julius development must not collapse into an
Unreal-only session. **Nothing on `relay/wonderland-v2` was touched** — including
its uncommitted `wonderland/infra/build/hero_shots.py`.

It was assessed read-only, so the next session does not rediscover it. **The
audit Task 4 describes already exists** on that branch:

- `wonderland/v2/tools/walk_audit.py` — audits a traversal the way a player
  experiences it, frame by frame, from `ffmpeg signalstats`, attributing every
  finding to a NAMED REGION: *idle at spawn, arrival gate, plaza crossing,
  fountain court, castle approach, garden quarter, mushroom wood, clock quarter,
  hamlet*. It classifies **TOO DARK / BLOWN / FLAT / DEAD**, with DEAD written as
  "what paths that mathematically connect but feel pointless look like". That is
  Task 4's "identify the worst unfinished region", already implemented and
  already region-attributing.
- `wonderland/rendering/audit-draw-cost.py`, `infra/build/measure-{colourfulness,
  palette,render,frame-region,reference}.py`, `infra/lightning/measure-fps.sh`.
- `wonderland/proof/ACCEPTANCE-MEASUREMENTS.md` — the practice to copy: every
  number measured, and **the ones that did not improve recorded beside the ones
  that did** ("Sharpness — NOT IMPROVED, and stated as such").

**So the audit → fix → rerun-the-same-audit loop is not missing. A capture is.**
`walk_audit.py` consumes a traversal video, which needs a cooked build on a GPU
box; `wonderland/infra/{lightning,vast,gcp,windows}` are the provisioning paths.
One measurement is GPU-free — density is "counted by walking each generator
against the offline stub … needs no GPU" — so a placement-level audit could run
on this machine today, but the dark/blown/flat/dead findings the founder's
priority list is actually about cannot.

**Next session's Task 4 opener:** provision a box from `infra/`, capture a
traversal, run `walk_audit.py`, take the worst-scoring named region, fix it,
rerun the identical audit. Do not start by writing a new audit.

---

## 2. Julius as a Compound AI Agent — boundary classification

Traced against production code and run `34037313976`, not against UI.

| Boundary | Classification | Evidence |
|---|---|---|
| user intent → contract | **REAL + INTEGRATED** | `parseLiveMissionContract`, `julius-live-contract-check.mjs` (namespace-keyed ceilings) |
| contract → task graph → run | **REAL + INTEGRATED** | `relay-bridge/julius/bootstrap.ts`; run accepted in READY |
| Prompt Architect | **REAL + INTEGRATED** | gpt-5.6-sol answered; plan validated and stored |
| context compilation | **REAL + INTEGRATED** | `julius-context-snapshot.ts`, content-hashed, redaction-counted |
| Project Brain retrieval | **PARTIAL** | brain entries seed the context packet and `projectBrainRevision` is carried, but `julius_brain_entries` has exactly one writer — the bootstrap seed — so the runtime never writes back |
| Coding Agent | **REAL + INTEGRATED** | claude-fable-5 ran, edited, produced a correct diff |
| tools / filesystem effects | **REAL + INTEGRATED** | executor shell effect, exit 0, signed receipts, `network: DENY` |
| Independent Reviewer | **REAL + INTEGRATED** | xai/grok-build-0.1 via Hermes returned structured findings |
| findings → verification | **REAL + INTEGRATED** | `REPAIR / BLOCKING_FINDINGS` recorded durably |
| repair | **BROKEN** | the only repair task ever created failed `PROVIDER_UNAVAILABLE` (`repair:plan` is deliberately unroutable; see `live-composition.ts`) |
| completion authority | **REAL, NEVER EXERCISED** | no run has reached COMPLETED |
| persisted mission history | **REAL + INTEGRATED** | PostgreSQL; the evidence bundle is dumped from it |
| Wonderland UI ← mission state | **DEMO-ONLY** | the 3-D landing does not read a live Julius run |
| resulting application → Wonder Web | **MISSING** | no module exists |

---

## 3. Project Brain

**Real.** Migration `014_julius_context_brain.sql` creates
`relay_wonderland.julius_brain_entries` with eight entry kinds — `DECISION`,
`FINDING`, `REPAIR`, `ARTIFACT`, `CONSTRAINT`, `RESEARCH_NOTE`, `HANDOFF`,
`ACCEPTANCE_UPDATE` — monotonic `revision` under `UNIQUE(run_id, revision)`,
cascade on run delete. `julius-context-snapshot.ts` compiles every worker's
context from it with a content hash, a redaction count and a truncation flag;
`projectBrainRevision` is carried on runs, tasks, trajectory events and context
snapshots. `julius-read-postgres.ts` reads it back.

**The gap, stated exactly.** `julius_brain_entries` is written in exactly one
place — `relay-bridge/julius/mission-seed.ts`, at bootstrap, with
`worker_id = 'relay-bootstrap'` and `task_id = NULL`. The runtime **reads** the
brain (`brainEntriesForRun`, `julius-task-pipeline.ts`) and **never writes back**.
So five of the eight declared entry kinds — the run's own decisions, findings,
repairs, research and handoffs — have no producer. **The Project Brain is
currently a read-only seed, not accumulating project intelligence.**

**Now measurable, as of this session.** `.github/julius-live-evidence-dump.sh`
dumps `project-brain.tsv` (`entry_id, entry_kind, worker_id, task_id, revision,
created_at` — no content column, so no free text enters the artifact), and the
Beta Gate distinguishes three answers: no dump → *cannot say*; only
`relay-bootstrap` rows → *the run wrote none back*; any worker-written row →
PASS. The next paid run will report which, instead of the question being
unanswerable.

**The writer now exists** (`b765326`), with the settlement semantics the rest of
the runtime already has: the run row's `project_brain_revision` is the atomic
counter — an UPDATE takes that row's lock, so concurrent appends serialise
without a retry loop — `GREATEST(counter, max(revision))` continues past the
bootstrap seed instead of colliding with it, and a `NOT EXISTS` guard on the
UPDATE makes a replay a true no-op rather than a counter that counts retried
ticks. A real-PostgreSQL case proves all of it; the in-memory model mirrors it.

**It is not wired into the run loop yet, on purpose.** The next paid run has one
job — proving the coder-ceiling fix — and a second new durable behaviour on the
same path would make a failure ambiguous about which change caused it. Wiring is
a small follow-up: call it beside `appendDecision` in `julius-task-pipeline.ts`
for a verification decision, and at the reviewer and repair points for the other
kinds.

**A trap that write path will hit, found while reading for it.** The domain and
the database hold two different kind vocabularies:

| | kinds |
|---|---|
| domain — `JuliusBrainEntry['kind']` (`julius-runtime.ts:132`) | `OBJECTIVE, REQUIREMENT, CONSTRAINT, DECISION, FINDING, REPAIR, HANDOFF, ARTIFACT, EVIDENCE` |
| database — migration 014 `CHECK` | `DECISION, FINDING, REPAIR, ARTIFACT, CONSTRAINT, RESEARCH_NOTE, HANDOFF, ACCEPTANCE_UPDATE` |

The **read** direction is handled on purpose: `brainKind()` in
`julius-read-postgres.ts` maps stored → domain and carries a non-overlapping kind
as `ARTIFACT` rather than dropping it, with the reasoning written down. The
**write** direction has no mapping at all, because there is no writer — the
bootstrap sidesteps it by hand, emitting only `CONSTRAINT` and
`ACCEPTANCE_UPDATE` and never the `OBJECTIVE`/`REQUIREMENT` the domain would call
them.

So a write path that persists a domain entry directly will pass every in-memory
test — `OBJECTIVE` is used in `julius-runtime.test.ts` and
`julius-compound-agent.e2e.test.ts` today — and be rejected by PostgreSQL's CHECK
constraint the first time it runs against a real database, inside a paid mission.
`OBJECTIVE`, `REQUIREMENT` and `EVIDENCE` are the three that would fail.

**Closed by `b765326`**: `src/relay/persistence/julius-brain-kinds.ts` now holds
BOTH directions in one file, so they can be tested as a pair, and its test reads
the admitted list out of migration 014's SQL rather than a typed-out copy. The
CHECK constraint was not widened — the map reuses the bootstrap's own choices
(objective → CONSTRAINT, requirement → ACCEPTANCE_UPDATE) and the read path's
own convention (anything unclassifiable → ARTIFACT), so no third convention was
invented.

---

## 4. Wonder Web

**NOT BUILT** on `main`. The closest existing code is
`wonderland/web/{gait,inspector,player}` on `relay/wonderland-v2`, which is world
tooling, not a workspace that opens Julius's output.

The smallest architectural seam: a mission that reaches COMPLETED already has a
runnable workspace and a passing declared `testCommand`. Binding *that* — the
completed run's workspace plus its test result — to an in-Wonderland viewer is a
far smaller step than building a browser. It cannot be built honestly before a
mission completes, because there is nothing to open.

---

## 5. Tests, builds, evidence

**Green, run on this branch:**

| Gate | Result |
|---|---|
| `src/relay/mission/julius` + `src/relay/persistence` (53 files) | **680 passed**, 6 todo, 1 skipped (the environment-gated real-infra suite) |
| `relay-bridge/julius/julius-live-composition.test.ts` | 70 passed |
| `relay-bridge/julius/coder-budget.test.ts` | 9 passed |
| `src/relay/mission/julius/julius-brain-writer.test.ts` + `julius-brain-kinds.test.ts` + `scripts/wonderland-beta-gate.test.ts` | 25 passed |
| `src/relay/mission/julius/julius-policy-router.test.ts` | 25 passed |
| `src/relay/ui/landing/brand-casing.test.tsx` | 2 passed |
| `npm run relay:build`, `npm run relay:bridge:build` | exit 0 |
| `scripts/relay-repository-boundary.mjs` | PASS |
| `scripts/relay-parity-gate.mjs` | PASS |
| `npm run relay:surface-parity:check:strict` | PASS |
| `npm run julius:harness:check` | PASS (after regenerating; it was stale) |
| `npm run typecheck` — all four passes (app, bridge, hermes-service, scripts) | exit 0 |
| `npm run build` (`tsc -b` + `vite build`) | **exit 0** |
| `npm run relay:hermes:build` | exit 0 |
| `npm run relay:yc-demo:check` | exit 0 |
| `npm run relay:cli:contract-verify` | exit 0 |
| `git diff --check` | clean |
| full suite, **all four shards** | **9,367 tests / 494 files: 9,331 passed, 23 todo, 13 failed** — 2 real (fixed), 11 contention timeouts (all green in isolation). See below. |

**The build gate is now green, and the earlier red was what it looked like.**
`npm run build` had exited 1 on a read of `brand-casing.test.tsx` taken during
the second it was being edited: the errors named line/column positions of a
superseded version. A clean rebuild exits 0. That diagnosis is now proven rather
than argued.

**The full suite runs as `vitest --shard=N/4`,** because one process exceeds
every timeout available here. Shard 1 alone took 1 722 s.

| Shard | Files | Tests | Failed |
|---|---|---|---|
| 1/4 | 124 | 2 334 | 3 — all timeouts |
| 2/4 | 123 | 2 108 | 5 — **2 real**, 3 timeouts |
| 3/4 | 124 (1 skipped) | 2 398 (23 todo) | 1 — timeout |
| 4/4 | 123 | 2 527 | 4 — all timeouts |
| **total** | **494** | **9 367** | **13** |

**The two real ones were mine, and both are fixed** — see the commits. One was a
stale `JULIUS_HARNESS_MANIFEST.md` (`julius-brain-kinds.ts` is traced now, so the
export is 106 files, not 105). The other is the more interesting bug and is
written up in its own commit message: the evidence dump's schema check could not
see migration 001, because its regex required the closing paren to start its own
line, and 001 writes one table per line. It reported a REAL table
(`execution_sessions`, which my ACCOUNT / ONBOARDING probe reads) as one *"no
migration creates"*. **A gate that quietly covered only the `julius_*` tables**
— and whose failure mode invites deleting the dump rather than fixing the
reader.

**The other eleven were timeouts, not assertions, and every one was re-run
alone before being dismissed:**

| Timed out under a four-way shard | Alone |
|---|---|
| `scripts/boundary-scanner-regression.test.ts` (its own explicit 120 000 ms) | **209 passed**, 234 s |
| `RelayMissionRunner`, `official-relay-dog` | **35 passed**, 23 s |
| `RelayGitHubSignIn`, `panel-focus`, `usage-integration`, `relay-dog-motion` (worker start), `RelayDemoSimulation`, `repository-contract`, `app-flow` ×3 | **107 passed**, 100 s |

The first is worth keeping in mind: it carries a deliberate `120_000` timeout
*because* it spawns scanners, and two CPUs under a four-way shard still blew
past it. This is the contention pattern the root `CLAUDE.md` documents —
reproduced, then falsified by isolation rather than waved at. Note the
distinction: substituting a different scenario is forbidden for the **Signal
Cycle blocker**; here the question is only whether a failure is real or is the
box, and the answer is the same test, run again, alone.

**One pre-existing unhandled rejection, not mine.** Shard 1 reported
`Error: EXECUTOR_UNAVAILABLE` escaping from
`src/relay/workspace/julius-tools/remote-executor-control-plane.ts:65`, raised
while `executor-repair-regression.test.ts` ran. That file's own tests pass. It is
**untouched by this branch** — `git log` puts its last change at #214/#208, and
`git diff --name-only origin/main..HEAD` matches nothing under
`workspace/julius-tools`. Vitest's own warning is the right one to keep: an
unhandled rejection *"might cause false positive tests."* Worth a separate fix;
not a regression from this work.

**Running gates on this box — two things that cost this session hours.**

1. **Two CPUs, 2.7 GB of RAM, and no swap.** This is the sharper version of the
   note below, and it was measured rather than inferred: `free -m` showed
   **~200 MB available of 2 747, with `/proc/swaps` empty**, while
   `/proc/loadavg` sat at 6.4 on `nproc` = 2. At that point vitest stops being
   slow and starts failing to *begin*: `[vitest-pool]: Failed to start forks
   worker … Timeout waiting for worker to respond`, after 62 s, for a **single**
   test file. A worker-start failure is memory, not CPU.

   **The other checkout is a live workload, not a parked one.** While shard 2
   was re-run, `/home/thomasajvt13/dev/sunday-relay` was running
   `wonderland/v2/tools/route.py` and `wonderland/v2/tools/occlusion.py` — ~42 %
   of both CPUs and ~220 MB — because another session is working the world
   stream. That is what made the shard 2 re-run (12 timeouts) worse than the
   original (3), and `entry-home.interactions`, `role-switching` and
   `parity-bypass` all **passed in the quieter original run**. Those processes
   were left alone: they are someone else's work, and this repository already
   records the session where a `pkill` took out another run's suite.

   A full gate takes far longer than the 12–16 min the root
   `CLAUDE.md` records — `npm test` was still going at 73 minutes, and a single
   `npm run typecheck` takes ~25. Running anything alongside the suite makes
   process-spawning tests exceed vitest's 5 s default: that is exactly what the
   `documentation-contract` CLI-spawn failure was, with its other 45 assertions
   passing, and what the four `julius-first-live-mission` timeouts were. **Run
   gates serially, and prefer `vitest --shard=1/4` over one long process.**
2. **Background commands died both times a `Monitor` was armed on them.** Two
   arming events, three tasks: the full gate and its chained follow-on went
   together, then the typecheck. Stated at its real strength — that is a
   correlation over two events, not a demonstrated mechanism, and a fourth
   failure that looked the same was **my own** (`pkill -f "tsc -p"` matched the
   wrapper shell's own command line and killed its parent, exit 144). Whatever
   the cause, the pattern that then worked is: start the long command with
   `run_in_background`, **do not arm a Monitor on it**, and poll its log with
   short foreground `Bash` calls.

- Environment: **no** `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `XAI_API_KEY`,
  `RELAY_BRIDGE_API_TOKEN`. No Docker, no PostgreSQL, no Hermes binary. `gh` is
  authenticated as `ohdieyuh-glitch`. **No provider call was made this session.**

---

## 6. The exact next highest-leverage move

**Dispatch a paid run at a commit containing `14741f7` — and consider running
MISSION 1 first.**

That single dispatch is the evidence for Signal Cycle Task 1, and it flips three
Beta Gate rows at once.

### Which mission, and why this changed

The ledger in §1 says something the last two runs alone do not. **Mission 1's
build has SUCCEEDED in both runs that reached it** (`33802017460`,
`33907599197`); what stopped it was its reviewer, twice. Each of its three
historical blockers is now behind us:

| mission 1 failed on | resolved by | evidenced by |
|---|---|---|
| `reviewer_review_incomplete` | #217, harden local Hermes structured review output | code |
| `plan_validation_failed` | #218, align Prompt Architect schema with plan validation | code |
| `review_authentication_failed` | **no code change — see below** | run `34037313976`'s reviewer SUCCEEDED |

**So mission 1 has no known remaining blocker, and it is bounded at $5 rather
than $20.** It is the cheapest route to the first VERIFIED COMPLETION this
project has ever had. Mission 2 additionally needed the coder ceiling, which
`14741f7` is; run it second, once completion has been demonstrated once.

Stated as inference, not measurement: "no known remaining blocker" means no
blocker this evidence names. Mission 1's build has never been successfully
REVIEWED — both attempts died before the review returned — so `build:review` is
unproven for it, exactly as it is for mission 2.

### A risk that is not in git at all

`review_authentication_failed` (run `33907599197`, 2026-09-04) has **no fix in
this repository.** Nothing touched `hermes-reviewer.ts`, `hermes-remote-review.ts`,
`julius-live-hermes.sh` or the workflow's Hermes bootstrap between that run and
the one where the reviewer worked. The credential comes from
`secrets.XAI_API_KEY` in the `julius-live-validation` environment, written to
`$HOME/.hermes/.env`; the only explanation consistent with the evidence is that
the secret was replaced.

That matters because of what the preflight can and cannot prove.
`julius-live-hermes.sh` verifies the key **resolves** — it runs Hermes's own
`get_env_value_prefer_dotenv` and fails closed if nothing comes back — and that
gate PASSED on the run that then failed on authentication. Resolvable is not
accepted. A rotated or revoked key will pass every free gate and fail after the
architect and the coding agent have been paid for, which is precisely the shape
of run `33907599197`. No change is proposed here: closing it means an
authenticated probe, and a probe that authenticates is a probe that spends.

### Preconditions, in order

1. Merge `relay/coder-ceiling-mission-budget` into `main` through the normal
   governance path (the live workflow refuses a commit that is not reviewed,
   current and on `main`).
2. **Free dry run first** — dispatch `julius-first-live-mission.yml` with an
   empty `confirm_live`. It costs nothing, and its preflight now prints
   `mission budget: 20 USD over 3 repair cycle(s); coder ceiling 500c per invocation`.
   **If that line does not say 500c, stop — the fix did not reach the run.**
3. Then the paid dispatch, with these inputs. Three of the five defaults are
   wrong for this mission and each one would waste the run:

   | input | value | why not the default |
   |---|---|---|
   | `mission` | **decide it** — `julius-first-live` for the cheap first completion, `julius-live-mission-2` for the one `14741f7` unblocks | the default is `julius-first-live`; it is the right value ONLY if you meant mission 1. For mission 2 it must be set, because mission 1's namespace grants $5 / 1 cycle and mission 2's grants $20 / 3 |
   | `confirm_live` | `RUN LIVE MISSION` | exact string; a near-miss is refused outright rather than downgraded to a dry run |
   | `acknowledge_rerun` | `RERUN PAID MISSION` | required for EITHER mission: `julius-first-live-attempted` exists from three runs and `julius-live-mission-2-attempted` from two, so the gate refuses without it. That guard is working as designed — do not remove it |
   | `max_ticks` | **`32`** | the input default is `24`. #233's own arithmetic for a three-repair-cycle graph is ten tasks each needing a claim and an advance — twenty ticks before any overhead. The accepted range is [8, 32] and 32 is the entrypoint's own default, so this only ever tightens Julius's bound. Mission 1's one-cycle graph fits in 24, but there is no reason to run it closer to the edge than necessary |
   | `hermes_ref` | leave as-is | already pinned to `2ea39da…`, the commit the proven local build runs |

4. Afterwards: `gh run download <id>` and
   `npm run relay:beta-gate -- --evidence <dir>`.

**Expected outcome, stated in advance so it can be wrong:** `plan` SUCCEEDED →
`build` SUCCEEDED (the ceiling is now 500¢ against an observed $1.83) → diff
captured → `build:review` → verification → `COMPLETED`.

**Two known residual risks, neither fixed here:**

1. **The reviewer's first call is consistently dead, and it has exactly one
   retry.** `reviewerWorker` is `timeoutMs: 240_000, maxRetries: 1`. In BOTH paid
   mission-2 runs the reviewer's first attempt timed out with
   `output_bytes_observed: 0` — four minutes, nothing at all. On `34037313976`
   the retry then succeeded in about 2½ minutes; on `33924009789` the run ended
   with the review still `ACTIVE`. A zero-byte first call and a working second
   reads as a Hermes cold start rather than a size problem, but the budget is one
   spare: if the cold start eats attempt 1 and the real review — which will be
   handed a REAL diff next time, not the empty one it reviewed on 2026-09-06 —
   needs more than 240 s, the run dies after paying an architect and a coding
   agent. Raising the timeout is a behaviour change to a paid path and was
   deliberately not made blind; decide it before dispatching.
2. **The repair path has never succeeded in any run.** If the reviewer requires
   changes, `repair:build` routes to the Coding Agent, and no repair task has
   ever reached SUCCEEDED.

Second-highest: give the Project Brain a **write path**. The dump now makes the
gap measurable (§3); closing it means allocating revisions monotonically under
`UNIQUE(run_id, revision)`, idempotent per producing task, with
`projectBrainRevision` advancing on the run.

---

## 7. Open risks

1. **The paid rerun is unproven.** Everything above is offline evidence plus one
   replayed diff. `coder_cost_exceeded` is fixed at the seam that produced it;
   whether the mission completes end to end is not yet a fact.
2. **REPAIR LOOP has never succeeded** in any run, and it is on the critical path.
   See also the reviewer cold-start risk in §6.
3. **`repair:plan` is deliberately unroutable**, and its refusal now says so.
   The design refuses it rather than paying for a dispatch guaranteed to halt;
   in run `34037313976` that surfaced as a bare `PROVIDER_UNAVAILABLE` with an
   empty failure class, indistinguishable from an outage. `f709f27` gives the
   routing refusal its own class — `route_no_eligible_worker` for this case, and
   three others for an exhausted reroute, an open circuit and a missing adapter.
   **The behaviour is unchanged**; only the record improved, so the underlying
   fact stands: a `repair:plan` still cannot run, and if verification decides
   REPAIR on a plan task the run still ends there.
4. **A refused coder result strands a real workspace edit.** The fix removes the
   trigger; the shape remains (any future refusal after the agent has edited).
5. **The two branches are 71/775 apart** and neither is a superset.
6. `hero_shots.py` is uncommitted in the primary checkout. Not mine — confirm
   before touching.

---

## 8. Commits on this branch

Branch `relay/coder-ceiling-mission-budget`, based on `origin/main` `b2dc9f2`.
**Not pushed.** Merging is founder-gated — the live workflow refuses a commit
that is not reviewed, current and on `main`.

| SHA | What it does |
|---|---|
| `14741f7` | **The coder ceiling fix.** The mission's authorised budget reaches the worker that spends it. Reproduces paid run 34037313976 at the production seam, then completes the identical run. Also lands `npm run relay:beta-gate`. |
| `f709f27` | `project-brain.tsv` in the evidence bundle; routing refusals carry which of four situations they were; the diagnostics-allowlist invariant reads the allowlist instead of a hand-typed copy. |
| `616748b` | Pins the canonical landing copy so a merge from a branch without `src/relay/ui/landing/` cannot silently replace the opening. |
| `544ecbc` | Regenerates `JULIUS_HARNESS_MANIFEST.md` — it was stale and would have failed CI — and classifies `coder-budget.ts` under CODING AGENT. |
| `b765326` | **The Project Brain writer** (`JuliusBrainWriter`, store-allocated revisions, replay-safe, domain↔stored kind map, real-PostgreSQL case) and four Beta Gate rows that could not move. |
| `e5cf430` | `docs/relay/CURRENT_STATE.md` now says where the live Julius record is. |
| `fa7c56d` | Wires `appendBrainEntry` through the store conformance file — which refused the first attempt, correctly, because `runWriter` is typed as the narrow port. The conformance mechanism working as designed. |
| `37993cc` | **The schema check could not see migration 001.** Its regex required the closing paren to start its own line, so half the database was invisible to the gate meant to prove the evidence dump names real columns, and a real table read as *"no migration creates"*. Widened, with a case pinning the reader's coverage in both migration shapes. Regenerates the manifest at 106 files. |
| `5ac8ff0` | Records the green build gate and the shard results. |
| `3770e41`, `3d0ce4c`, `7fdc843`, `41d6843`, `d9ac294`, `0dec655`, `f4d1994`, `78b861b`, `00f4255`, `25742e0`, `3683661`, `cfed581` | This document, built up as each finding landed — the paid-attempt ledger, the dispatch parameters, the reviewer cold-start risk, the brain-kind trap, the Task 4 assessment, the architecture answers, and three corrections to my own earlier claims. |

**Splitting this branch.** `14741f7` is the only commit the next paid run needs.
If you want it merged on its own, the Project Brain writer (`b765326`) and the
harness regeneration (`544ecbc`, which `14741f7` requires) are separable; the
documentation commits touch nothing else.

## 9. What this session did NOT do, and why

- **No provider call, no spend.** No credential is present in this environment.
  Every proof above is offline or read from an already-paid run's artifact.
- **Nothing was pushed or merged.** Four local commits.
- **`relay/wonderland-v2` was not touched.** Its uncommitted
  `wonderland/infra/build/hero_shots.py` is untouched and is not this session's.
- **No branch integration was attempted.** The founder's instruction is targeted
  integration, not a blind merge, and the divergence (§0) is large enough that it
  deserves its own session with the landing guard (`616748b`) already in place.
- **World quality (Signal Cycle Task 4) was not started.** It needs a GPU capture
  and it is on the other branch — but its audit tooling already exists and is
  described in §1 so nobody writes a second one.
- **The Project Brain writer was built but NOT WIRED into the run loop.** The
  store operation, both stores, the domain↔stored kind map and a
  real-PostgreSQL case all landed in `b765326`; nothing calls it yet. That is
  deliberate: the next paid run's job is to prove the coder-ceiling fix, and a
  second new durable behaviour on the same path makes a failure ambiguous. Wire
  it after that run, or after the real-infra job proves the SQL green — it
  triggers on `src/relay/persistence/**`, so this PR runs it.

---

## 10. The architecture questions in the brief, answered from the code

Assessed read-only this session. Nothing below was changed.

### Deterministic kernel + fuzzy modules (brief §7)

**The kernel half is real and large.** `src/relay/mission/julius/` holds state
transitions (`julius-runtime.ts`, `julius-lifecycle-runtime.ts`), permissions and
C.A.R.D. policy (`julius-policy.ts`), leases (`julius-lease-protocol.ts`),
budgets (`julius-bounded-runtime.ts`), completion authority
(`julius-run-loop.ts`), event and trajectory integrity (`julius-events.ts`,
`julius-trajectory.ts`), recovery (`julius-recovery.ts`) and the closed
diagnostics contract (`julius-router.ts`). It imports no provider SDK, no `pg`
and no Node network. That is the stable deterministic kernel the brief asks for,
and it already exists.

**The fuzzy half is three slots, not three models.** `JuliusProviderAdapter` is
`{ adapterId, dispatch }` and nothing more; `JuliusWorker` declares role,
capabilities, task types, concurrency, timeout and retries. The live composition
binds PROMPT_ARCHITECT → OpenAI, CODING_AGENT → Anthropic, INDEPENDENT_REVIEWER →
xAI-via-Hermes, and `live-composition.ts` REFUSES a reviewer sharing the coding
agent's `providerId` — independence is enforced structurally, not by convention.
So the slots are genuinely provider-independent.

**What the brief asks for and does not exist: the measurement.** Every fuzzy
module is supposed to carry a baseline, a version, a candidate set, evaluation
criteria and a measured marginal value. There is no such harness. Models are
pinned (`gpt-5.6-sol`, `claude-fable-5`, `xai/grok-build-0.1`) and the run
records `requestedModel` versus `servedModel`, which is honest observation — but
nothing compares a candidate against a baseline, so "this module earns its place"
is not currently a measurable claim. `docs/JULIUS_BETA_READINESS.md` already
records the beta eval pack as `ABSENT`; this is the same gap seen from the module
side.

`scripts/julius-provider-independent-evals.ts` is the nearest existing harness
and worth copying the shape of: it reports **PASS / FAIL / BLOCKED**, with
BLOCKED always carrying its reason — the same three-verdict discipline the
Wonderland Beta Gate uses.

### Open agent ecosystem (brief §8)

Most of the contract surface the brief names already exists, for first-party
adapters: **capabilities and task types** on `JuliusWorker`; **permissions,
providers, network, filesystem mutation, concurrency and approvals** on the
C.A.R.D. policy; **tools and resource limits** through the executor control plane
with `EXECUTOR_SANDBOX_LIMITS` and `network: DENY`; **observability** through
events, trajectories and the closed diagnostics record; **output contracts**
through `validateArchitectPlan` and the reviewer's parsed verdict; **failure
behaviour** through `JuliusDispatchError`'s code, retryability and failure class.

What does not exist is any way to REGISTER a third party, and any trust boundary
between a first-party adapter and an imported one. Every adapter today is
composed in code by `resolveLiveWorkers`, which is the safe direction and also
the reason there is no marketplace risk yet. The brief's own advice applies:
core creation reliability is unfinished, so this should stay unbuilt.

### /MAS (brief §9)

`julius-subagent-runtime.ts` is real and wired: it reads depth and counts from
the store rather than trusting the request, reserves budget before the child
exists, inserts the child into the durable task graph, records the grant, and
turns a denial into a value rather than a throw.

Its central design decision is worth surfacing because it reads as tension with
the brief. The module states: *"A SUB-AGENT IS NOT AN ALTERNATE RUNTIME… There is
no second execution path here and adding one would be the defect this file exists
to avoid."* A child is an ordinary `julius_tasks` row with a `parent_task_id`,
claimed by the same `claimRunnable`, dispatched by the same pipeline, budgeted by
the same ledger and verified by the same evaluator.

The brief asks for clones with their own runtime loop, tools, scoped Project
Brain context, local state and specialised role. **These are compatible, and the
seam is the worker, not the graph:** a child task routes to a worker like any
other, and a worker MAY be a full compound agent with its own loop. Specialising
the adapter gives the brief's clone; specialising the graph would give the second
execution path the kernel refuses. Nothing needs to change for /MAS to be built
the way the brief describes — but the primary agent must keep claiming,
budgeting and verifying, and today it does.

The Independent Reviewer is already separate from any swarm: it is a distinct
role with an enforced distinct `providerId`.
