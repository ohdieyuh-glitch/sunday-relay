# Paid run 34414726976 — Live Run 3, and the first contract-bound completion

**TASK 5 COMPLETE — CONTRACT-BOUND JULIUS LIVE RUN.**

Every claim below is read from the durable evidence bundle uploaded by the run
itself. Where the bundle cannot answer something, this document says so rather
than filling the gap. Four qualifications at the end record what this run did
**not** prove; they are part of the result, not footnotes to it.

## The causal question

> Can real worker output and real Independent Reviewer output reach VERIFIED
> COMPLETION while the coder, the reviewer, repair lineage, Project Brain
> writes, restart/replay and final verification all stay bound to ONE immutable
> locked Task Contract, with no founder rescue?

## Identifiers

| | |
|---|---|
| trusted main | `4ce61f98829403f3905b19a88584f8e3414ff842` |
| GitHub Actions run | `34414726976` (#31), `workflow_dispatch`, attempt 1 |
| durable Julius run | `run:132b1d96d9eebad0ecf386d5` |
| mission | `mission:julius-live-3` / project `prj-julius-live-3` / tenant `tenant` |
| marker namespace | `julius-live-mission-3` |
| contract sha256 (from the attempted marker) | `940192bcf5e1280d9b02197c03f6ef2f06ae49fd442025615d2a59a74f29ae23` |
| result | **COMPLETED** after 4 ticks |
| wall clock | 22:57:48Z → 23:06:51Z (9 min 3 s) |
| card revision | `card:julius-live:1` |

## The Task Contract lifecycle

From `task-contracts.tsv` and `contract-events.tsv`:

| when | what | revision |
|---|---|---|
| 22:59:25.573 | contract created `DRAFT` by `relay-bootstrap` | 1 |
| 23:00:29.726 | `julius.contract.proposed` by task `:plan` | 2 |
| 23:03:10.389 | **`LOCKED`**, `locked_by_evaluator_id = independent-reviewer-hermes` | 2 |
| 23:03:10.429 | `julius.task.claimed` — `CODING_AGENT` | 2 |
| 23:03:58.956 | `julius.task.claimed` — `INDEPENDENT_REVIEWER` | 2 |

**Locked revision: 2.**
**Binding digest: `sha256:e35b6d88bf79ec266f5a884a9e832521e97db50d2c4b4e3cc65844f281ba6942`.**

Revision 1 is a `DRAFT` and carries no digest, so the two revisions cannot be
compared digest-to-digest; what the bundle supports is that the contract was
revised once before it locked, and that the lock was performed by the
independent evaluator rather than by the coder.

### The binding, proven twice from independent tables

`contract-events.tsv` — the claim rows:

```
:build         julius.task.claimed  rev 2  sha256:e35b6d88…  CODING_AGENT
:build:review  julius.task.claimed  rev 2  sha256:e35b6d88…  INDEPENDENT_REVIEWER
```

`trajectory.tsv` — the DISPATCH rows, recorded by a different code path:

```
:build         coding-agent-claude-hosted   bindingDigest sha256:e35b6d88…  contractRevision 2
:build:review  independent-reviewer-hermes  bindingDigest sha256:e35b6d88…  contractRevision 2
```

Two different workers, two different providers, one revision, one digest. The
`plan` and `plan:review` dispatch rows carry a null binding, which is correct:
the contract governs the BUILD task and the plan precedes the lock.

## What each worker did

### Prompt Architect — `PROMPT_ARCHITECT/plan`, SUCCEEDED

`evidence.tsv` 23:00:29 — `ARTIFACT/PASSED`: *"Validated architect plan stored
for this run (15638 chars, sha256:67e78e5abfab1a2f…)."*

### Coding Agent — `CODING_AGENT/build`, SUCCEEDED

Three executor shell effects, all exit 0, each with a signed receipt
(`tool-invocations.tsv`, `receipt-ids.txt` carries six receipt ids):

```
23:03:11  :build:base:g1  COMMAND_EXECUTION/PASSED
23:03:58  :build:diff:g1  COMMAND_EXECUTION/PASSED
23:03:58  :build:test:g1  COMMAND_EXECUTION/PASSED
```

- `DIFF/PASSED` — workspace diff captured, 5,442 chars.
- `TEST/PASSED` — the contract's declared command `node --test path-scope.test.js`
  exited 0 under executor invocation `:build:test:g1`.
- `workspace-status.txt`: `M path-scope.js`, `M path-scope.test.js` — the two
  files the mission named, and nothing else.

The implementation resolves with `node:path` and decides containment with
`path.relative`, refusing `..`, `../sep`-prefixed and absolute relatives. It
did **not** use the naive `resolved.startsWith(root)` form.

**Independently re-verified after the run**, outside Julius: the diff applies
cleanly to the seeded workspace, `node --test path-scope.test.js` reports
**12 passed / 0 failed**, and a separate adversarial harness covering all seven
acceptance criteria passes 12/12 — including
`resolveWithin('/srv/data', '../data-backup/x')` throwing
`path_scope_escapes_root`, which is the sibling-prefix case the mission was
built around.

### Independent Reviewer — two tasks, both SUCCEEDED

- `review:plan` 23:03:10 — `REVIEW_FINDING/PASSED`, *"approved with no blocking
  findings (served model grok-build-0.1)"*.
- `review:build` 23:06:36 — `REVIEW_FINDING/PASSED`, same shape, same served
  model.

`findings.tsv` is empty: no findings were raised, blocking or otherwise.

Which reviewer binary ran, from `hermes-bootstrap.evidence.txt`:

```
hermes_ref=2ea39daeb1f675d72e5c21c9400f2d58d7e6d71a
hermes_version=Hermes Agent v0.18.2 (2026.7.7.2)
hermes_profile=/tmp/julius-hermes-home (mode 700)
hermes_credential=REGISTERED
hermes_request_timeout_seconds=90 (resolved by hermes itself)
relay_reviewer_window_ms=400000 (engine worst case 360000ms, and it fits)
```

The two deadlines landed in the correct order — the repair from paid run
34311556047 holding on a live run for the first time.

## Project Brain writes

`project-brain.tsv` holds 20 entries. Eighteen are the bootstrap seed
(`relay-bootstrap`, revisions 1–18: the objective, ten requirements, six
constraints, the criteria). **Two were written by the run**:

```
rev 19  23:03:10  DECISION  independent-reviewer-hermes  :plan   ACCEPT/TASK_VERIFIED
rev 20  23:06:36  DECISION  independent-reviewer-hermes  :build  ACCEPT/TASK_VERIFIED
```

Durable entries authored by the run's own evaluator, not only by the bootstrap.

## Verification and completion

`decisions.tsv`:

```
decision:12f4f285…  :plan   ACCEPT  TASK_VERIFIED  23:03:10.397
decision:56d4f975…  :build  ACCEPT  TASK_VERIFIED  23:06:36.379
```

`runs.tsv`: `run:132b1d96d9eebad0ecf386d5  mission:julius-live-3  COMPLETED`.

## No founder rescue

One workflow run, `run_attempt 1`. `failures.tsv` is empty — nothing was
interrupted, retried or recovered. No database row was hand-edited, no step was
re-run, no second dispatch occurred. Nothing was rescued because nothing needed
rescuing.

Both durable markers exist and pin the run to the commit:

```
attempted_at=2026-09-09T22:59:24Z  run_id=34414726976  commit=4ce61f98…
completed_at=2026-09-09T23:06:36Z  run_id=34414726976  commit=4ce61f98…
```

## Spend

From `budget.tsv`. Ceiling 20,000,000 micros ($20), granted to this namespace by
a recorded founder decision.

| task | role | allocated | basis | settled |
|---|---|---|---|---|
| `:plan` | PROMPT_ARCHITECT | 300,000 | ESTIMATE | *(none recorded)* |
| `:plan:review` | INDEPENDENT_REVIEWER | 300,000 | ESTIMATE | *(none recorded)* |
| `:build` | CODING_AGENT | 5,000,000 | CODER_SHARE | **608,861** |
| `:build:review` | INDEPENDENT_REVIEWER | 300,000 | ESTIMATE | *(none recorded)* |

The coder's allocation is exactly `floor(20 / (1 + 3)) = 5` dollars, the
`julius-allocation.v1` share for a $20 ceiling with three repair cycles.

- **Recorded spend: $0.608861** (the Coding Agent, `PROVIDER_REPORTED`).
- **Unknown spend: the Prompt Architect and both Independent Reviewer calls.**
  Their reservations settled with no `usd_micros`. Their true cost is not zero
  and is not knowable from this bundle.
- **Total mission cost: at least $0.608861. The exact total is UNKNOWN.**

Unknown is not zero. See qualification 4.

## What this run proved

1. A Task Contract can be proposed, revised, locked by an independent evaluator,
   and carried unchanged through a real paid mission.
2. The Coding Agent and the Independent Reviewer executed against **the same
   locked revision and the same binding digest** — the central claim, visible in
   two independently-produced tables.
3. Real worker output: a real architect plan, a real implementation in a real
   sandbox behind signed executor receipts, a real deterministic test run.
4. Real independent review by a pinned reviewer binary under both deadlines.
5. Durable Project Brain writes authored by the run itself.
6. VERIFIED COMPLETION with no founder rescue.

## What this run did NOT prove

### 1. CONTRACT CHALLENGE LEG NOT EXERCISED

No independent challenge occurred in this paid run. The word "challenge" does
not appear anywhere in the bundle: there is no `julius.contract.challenged`
event, and no recorded reason explaining that none was raised. The CHALLENGE leg
is wired and tested provider-free, but this run neither exercised it nor
documented its absence. **Silence is not a disposition** — a future run must
record `CHALLENGE` or `NO_CHALLENGE` with a reason.

### 2. REVIEWER CATCHING POWER NOT EXERCISED

The Coding Agent produced correct code on the first implementation. The reviewer
therefore approved correctly — independently confirmed above, so this was not a
rubber stamp — but it never had a defect in front of it. *"The reviewer agreed
with code that was genuinely right"* is a strictly weaker claim than *"the
reviewer caught something wrong"*, and only the first is supported here. The
sibling-prefix trap did not spring because the coder did not take the bait.

### 3. SUCCESS-PATH REVIEWER DIAGNOSTICS GAP

`worker-diagnostics.tsv` contains **zero rows**. The lifecycle columns added
after paid run 34311556047 are emitted only on the failure path — the evidence
dump selects on `diag_transport IS NOT NULL` — so a clean run produces no
per-attempt telemetry at all: no `elapsed_ms`, no `dispatch_attempt`, no
served-model row. The served model survives only because `evidence.tsv` names it
in a prose summary. A successful reviewer attempt is currently less
reconstructable than a failed one.

### 4. COST ACCOUNTING GAP

Recorded coder spend is `$0.608861`. The Prompt Architect and Independent
Reviewer costs are **not available in the current ledger** — their reservations
settled with no reported figure. A `NULL` here means "not reported", never
"free". Any total presented as `$0.608861` would be wrong; the honest figure is
"at least $0.61, remainder unknown".

## What was repaired in this same change

Qualifications 3 and 4 are defects in the RECORD, not in the run, so they were
fixed rather than filed. Both repairs land in the commit that carries this
document; neither changes anything this run proved, and neither is retroactive —
Live Run 3's bundle is what it is.

**Success-path diagnostics.** `JuliusProviderResult` now carries an optional
sanitised `diagnostics`, and the execution coordinator flattens it onto
`worker.completed` exactly as it already did onto `task.failed` and
`retry.scheduled`. All three live adapters populate it on the path that
succeeds: the reviewer's process lifecycle, the coder's turn/tool/denial counts
from the same builder its refusal uses, and the architect's served model,
response id and attempt count. The record gains `outcome` (so a success is a
stated fact rather than the absence of a `failureShape`), `startedAt`,
`completedAt`, and the locked `contractRevision` and `contractBindingDigest` —
the last two written by Julius and never by the adapter, which may describe its
transport and not what it was bound to. The reviewer's usage file, previously
read for its `model` and otherwise discarded, now yields its token counts too.

**Cost accounting.** `julius.budget.settled` now names its task, its role and
its `costBasis` from a closed four — `PROVIDER_REPORTED`,
`MEASURED_FROM_USAGE`, `ESTIMATED`, `UNKNOWN` — and a basis its own data cannot
support is demoted to `UNKNOWN` rather than published. A harness's estimate
(Hermes writes one) is recorded on its own axis and never added to a known
total. The bundle gains `cost-accounting.tsv`, a per-role rollup keeping billed,
estimated and unmeasured components apart. `JuliusEvalSummary.totalUsdMicros`,
which summed the dispatches that reported and silently dropped the ones that did
not, is now `knownUsdMicros` beside `unknownCostComponents` and `costComplete`,
in the pure summary and in its SQL mirror alike. Had that existed on 2026-09-09,
this run would have summarised as `knownUsdMicros: 608861,
unknownCostComponents: 3, costComplete: false` — which is the sentence this
document had to write by hand.

Neither repair touches the Task Contract lock, provenance, reviewer separation,
executor boundaries, Project Brain durability, rerun history, evidence integrity
or the per-mission budget ceilings.

## Provenance of this record

The evidence bundle is artifact `julius-live-evidence` (id 10128862354) of run
34414726976, 14,130 bytes, 26 files. It was produced by the run, scanned by the
workflow's two credential checks before upload, and read here without
modification.
