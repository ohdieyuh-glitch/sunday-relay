# Julius — current engineering state

> **This file is the durable record.** Claude Code session history disappears;
> repository evidence does not. Update it whenever meaningful state changes and
> before ending a session. Never rely on `/resume` as the sole record.

**Session date:** 2026-09-06
**Checkout:** `/home/thomasajvt13/dev/sunday-relay-main` (a linked worktree)
**Branch:** `relay/coder-ceiling-mission-budget`
**HEAD:** see §8 for the current commit list (the branch is rebuilt as work lands)
**Base:** `origin/main` = `b2dc9f239eeb54764beca97a2966afa24c7cc3a4` (#233)
**Working tree:** clean; ahead of `origin/main`, **not pushed**.

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
