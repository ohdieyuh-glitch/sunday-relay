# Paid run 34529874100 — Mission 5, the first paid mission with a repair round that landed

**TASK COMPLETE — PAID LIVE MISSION 5 REACHED VERIFIED COMPLETION.**

Every claim below is read from the durable evidence bundle the run uploaded, or
from a check re-run here outside the sandbox. Where the bundle cannot answer
something this document says so. The qualifications at the end are part of the
result, not footnotes to it.

## The causal question

> Can Julius's three real workers take a mission that spans **three production
> modules**, absorb a blocking independent review, repair the plan, implement
> against a locked contract, and reach VERIFIED COMPLETION — while the record
> stays truthful about a reviewer that failed on the way?

Mission 4 answered the one-file version of that question with no repair round
and no failure. Mission 5 answered the harder one.

## Identifiers

| | |
|---|---|
| trusted main | `ed81b12e834ce60015926dfc56500dd4b09d4c72` (#250) |
| zero-spend preflight | run `34529455464` (#44), `workflow_dispatch`, attempt 1 — **success**, 20:57:55Z → 21:00:44Z |
| paid GitHub Actions run | `34529874100` (#45), `workflow_dispatch`, attempt 1 — **success**, 21:02:13Z → 21:32:54Z |
| durable Julius run | `run:cecba99c779c967f128dd58c` |
| mission | `mission:julius-live-5` / project `prj-julius-live-5` / tenant `tenant` |
| marker namespace | `julius-live-mission-5` |
| card revision | `card:julius-live:1` |
| result | **COMPLETED after 7 ticks**, 21:04:14.605Z → 21:32:39.370Z (28 min 25 s) |
| terminal trajectory event | `COMPLETION / VERIFIED / MISSION_VERIFIED` — `{"tasks": 6, "decisions": 3}` |
| evidence artifact | `10174157554` (22,484 bytes), expires **2026-09-24** |

The run was dispatched under the founder's standing authorization with
`confirm_live: "RUN LIVE MISSION"` and `acknowledge_rerun: "RERUN PAID MISSION"`,
because Mission 5 had been attempted before (34504244415).

## What each worker did

| task | role / stage | state | provider | served model | dispatches |
|---|---|---|---|---|---|
| `:plan` | PROMPT_ARCHITECT / plan | SUCCEEDED | openai | `gpt-5.6-sol` | 1 |
| `:plan:review` | INDEPENDENT_REVIEWER / review:plan | SUCCEEDED | xai (local Hermes) | `grok-build-0.1` | 1 |
| `repair::plan:1:task` | PROMPT_ARCHITECT / repair:plan | SUCCEEDED | openai | `gpt-5.6-sol` | 1 |
| `repair::plan:1:task:review` | INDEPENDENT_REVIEWER / review:repair:plan | SUCCEEDED | xai (local Hermes) | `grok-build-0.1` | 1 |
| `:build` | CODING_AGENT / build | SUCCEEDED | anthropic (hosted) | `claude-fable-5` | 1 |
| `:build:review` | INDEPENDENT_REVIEWER / review:build | SUCCEEDED | xai (local Hermes) | `grok-build-0.1` | **2** |

Six tasks, all SUCCEEDED. Three verification decisions:
`REPAIR / BLOCKING_FINDINGS` on the plan, then `ACCEPT / TASK_VERIFIED` on the
repaired plan and `ACCEPT / TASK_VERIFIED` on the build.

## The repair round is the new part

The Independent Reviewer refused the architect's first plan with **three
blocking findings**, all recorded verbatim in the bundle:

1. *[major] INTEGRATION* — `compileJuliusContext` must actually route through
   the integrity layer, and `createJuliusContextSnapshot` must carry what the
   layer decided. A new module nothing calls is not an integration.
2. *[blocking] BACKWARD COMPATIBILITY* — every new input optional; a call that
   supplies no claims must behave exactly as it does today; the integrity layer
   must not call the functions exported by `julius-memory-trust.ts`.
3. *[major] CONCRETENESS* — implementation steps 5 and 6 were phrased as "will
   integrate … while preserving …", which is an intention rather than an
   instruction a coding agent can execute.

The architect's first plan was 23,412 characters. The repaired plan was
**34,121** — 45.7% longer, and the delta is exactly the three findings. The
second review approved it with no blocking findings.

This is the first paid Julius mission in which the repair loop ran **and the
mission still completed**. Mission 5's earlier attempt (34504244415) ran three
repair rounds and then lost the coder; this one needed one round and kept it.

## The Task Contract lifecycle

From `task-contracts.tsv` and `contract-events.tsv`, contract
`contract:run:cecba99c779c967f128dd58c:build`:

| when | what | revision |
|---|---|---|
| 21:04:14.642 | created `DRAFT` by `relay-bootstrap` | 1 |
| 21:05:33.627 | `julius.contract.proposed` by task `:plan` | 2 |
| 21:13:03.455 | **`CHALLENGED`** — `BLOCKING_FINDINGS`, disposition `CHALLENGE` by `independent-reviewer-hermes`, 3 evidence ids | 2 |
| 21:14:52.575 | `julius.contract.proposed` by the repair task | 3 |
| 21:14:52.621 | `CHALLENGED` again by `julius-verification-resume` (the resumed leg of the same decision) | 3 |
| 21:18:26.026 | **`LOCKED`**, `locked_by_evaluator_id = independent-reviewer-hermes` | 3 |
| 21:18:26 / 21:27:36 / 21:29:10 | `julius.task.claimed` — CODING_AGENT, then the reviewer twice | 3 |

Binding digest, identical on every claim after the lock:

```
sha256:72f79d1bec984fc1c9f0cf0f48ced738d988bfa9f95466eff5b0f3ac6e066ae9
```

**The coder was never dispatched under an unlocked contract**: the lock at
21:18:26.026 precedes the coder's claim at 21:18:26.135 by 109 ms, and both
reviewer claims on the build carry the same revision-3 digest.

## Spend

Mission ceiling **$30**, repair ceiling **3 cycles**, both from
`.github/julius-missions/julius-live-mission-5/contract.json`.

| role | allocation | basis | settled | cost basis |
|---|---|---|---|---|
| PROMPT_ARCHITECT ×2 | 300,000 µ$ each | ESTIMATE | — | **UNKNOWN** |
| INDEPENDENT_REVIEWER ×3 | 300,000 µ$ each | ESTIMATE | — | **UNKNOWN** |
| CODING_AGENT | **7,500,000 µ$** | **CODER_SHARE** | **5,177,120 µ$** | PROVIDER_REPORTED |

The coder's share is exactly `floor(30 / (1 + 3)) = $7.50` under
`julius-allocation.v1`, and it settled at **$5.177120 — 69.0% of its share**,
against Mission 4's 27.8% of $5.00. Three modules cost 3.7× one module.

`cost-accounting.tsv` reports **1 known component and 5 unknown**. Total known
spend for the run: **$5.177120 of a $30 ceiling.** The architect and the
reviewer report tokens and never a price, so their cost stays `UNKNOWN` rather
than becoming zero. Unknown is not zero.

## The reviewer failed once, and the record says which clock fired

`failures.tsv` carries exactly one row: `:build:review`,
`julius.retry.scheduled`, `TIMEOUT`, `review_timeout`, retryable **true**,
21:29:10.749Z. The diagnostics #239 added make it reconstructable without
guessing:

| field | attempt 1 | attempt 2 |
|---|---|---|
| `elapsed_ms` | **94,160** | 208,407 |
| `timeout_ms` | 480,112 | 480,112 |
| `first_output_after_ms` | 93,901 | 207,242 |
| `output_bytes_observed` | **110** | 5,704 |
| `json_detected` / `verdict_present` | false / false | true / true |
| `process_exit_code` | **0** | 0 |
| `signal_sent` | *(absent)* | *(absent)* |
| `timed_out` | true | false |
| `cleanup_completed` | true | true |

**Julius's own deadline never fired.** The reviewer used 19.6% of it, exited by
itself with code 0, and Relay sent no signal. What timed out was *Hermes's own
provider request* — `isEngineReportedTimeout` matched the engine's own line in
those 110 bytes, and `hermes-reviewer.ts` records that as `review_timeout` with
`timedOut: true`, `exitCode` present and `signalSent` null precisely so the two
clocks stay distinguishable. The retry succeeded 3.5 minutes later.

This is the reviewer's real failure mode on this workload, and it is **not** the
one #248's deadline policy governs: a 480-second Julius ceiling cannot help
against an upstream request that gives up at 94 seconds.

Finding D from Mission 4 also re-appears, smaller: the plan review ran
**449,140 ms of 480,112 ms — 93.5%** of its deadline. The derived deadline
introduced in #248 is holding, with 31 seconds of margin.

## What Julius actually built

`workspace-status.txt` lists exactly three modified files and nothing else:

```
 M src/relay/mission/julius/julius-context-integrity.ts
 M src/relay/mission/julius/julius-context-snapshot.ts
 M src/relay/mission/julius/julius-runtime.ts
```

+249 / −19 across the three, replacing every
`context_integrity_not_implemented` stub with a body:

- **`classifyContextAuthority`** — authority read off provenance, standing and
  type, never off the text. `CONTRADICTED` and `SUPERSEDED` are terminal and
  classify `ASSERTION` whatever they say.
- **`rankContextCandidates`** — authority → trust → evidence count → task scope
  → role scope → recency → a deterministic `claimId::entryId` tie-break. Never
  similarity, never arrival order.
- **`detectContextConflicts`** — supersession, then terminal trust, then trust
  standing, then authority, then the locked contract, and `UNRESOLVED /
  UNRESOLVED_AUTHORITATIVE_CLASH` when two equals genuinely clash.
- **`compileContextWithIntegrity`** — fails closed on an unresolved clash.
- **`compileJuliusContext`** gained an optional claim-qualified path; the
  claim-free path is the original code, with the inline redaction regex lifted
  into a shared `redactJuliusCredentialText` used by both.
- **`createJuliusContextSnapshot`** carries `conflicts` and `excludedEntryIds`
  **only** when the integrity layer ran, and the hash material is unchanged when
  it did not.

Two properties worth naming, because a plausible implementation could have
missed either:

1. **Redaction happens before selection** on the claim path, so
   credential-shaped text cannot survive by ranking well.
2. **The integrity layer re-enforces SECRET, role and task scope itself**, as
   its first act, rather than trusting the caller to have filtered — verified by
   reading `compileContextWithIntegrity`, not by trusting its comment.

Export surface: `julius-context-integrity.ts` **identical at 15 exports**,
`julius-context-snapshot.ts` **identical at 2**, `julius-runtime.ts` 25 → 26 —
one additive `export interface JuliusContextIntegrityRecord`. No `enum`, no
`namespace`, no `declare`: nothing non-erasable, which matters because the
mission's own test command runs under Node's type stripping.

## Independent re-verification, outside the sandbox

The sandbox is disposable and its verdict is its own. Re-run here on a detached
worktree of trusted main `ed81b12e`, with the mission's seeded specification
restored **byte-identically from trusted main** (`git show` of
`.github/julius-missions/julius-live-mission-5/seed/…`), using the repository's
own slice loader rather than the sandbox's copy:

```
node --import ./.julius/loader.mjs --test src/relay/mission/julius/julius-context-integrity.test.ts
```

| state | result |
|---|---|
| trusted main, candidate **not** applied | **3 pass / 18 fail** of 21 |
| candidate applied (`git apply`, clean, no fuzz) | **21 pass / 0 fail** |
| candidate reverted (`git apply -R`) | **3 pass / 18 fail** again |

The three that pass in both directions are the right three: the declared
vocabulary, and the two regression guards on the existing compiler that must
keep passing. That is the same 18/21 the fixture recorded before it was frozen.

Two further checks on the applied candidate:

- `npm run typecheck` — all four projects, **exit 0**.
- `npx vitest run src/relay/mission/julius` — **689 passed across 38 files**.
  (The seeded spec itself is a `node:test` file and vitest reports "no test
  suite found" for it; that file is not part of trusted main.)

**The coder never touched the specification.** The candidate diff contains no
hunk for `julius-context-integrity.test.ts` — it changes only the three
production modules it was allowed to change.

### The candidate is byte-identical to what the sandbox produced

Regenerating `git diff` here against the same base produces a file differing
from the bundle's `workspace.diff` in **6 bytes, all of them inside `index`
lines**: git abbreviated the blob SHAs to 7 characters in the sandbox's smaller
object store and to 8 here. Every content line is identical.

The `DIFF` evidence row records **25,338 characters** while the exported
`workspace.diff` is **25,077 bytes**. Nothing is missing: the executor's command
is `git --no-pager diff && git --no-pager diff --stat`, and the `--stat` block
for these three files is **exactly 261 bytes**. 25,077 + 261 = 25,338.

## Evidence chain

Twelve rows in `evidence.tsv`, in order: the architect's ARTIFACT (23,412
chars, `sha256:754bc9a3…`); three FAILED `REVIEW_FINDING`s; the repaired
ARTIFACT (34,121 chars, `sha256:49d277dc…`); a PASSED repair review; three
PASSED `COMMAND_EXECUTION`s (base, diff, test — every one exit 0); the
**DIFF PASSED** (25,338 chars); the **TEST PASSED** ("deterministic test command
exited 0"); and the PASSED build review.

`project-brain.tsv` carries 29 entries: 26 written by `relay-bootstrap` at run
creation (the objective, 17 requirements, 7 constraints, the criteria), then
**three DECISION entries written by `independent-reviewer-hermes`** — one per
verification decision, at revisions 27, 28 and 29.

## Capability proofs carried in the same bundle

`capability-proofs.tsv` — five rows, all `VERIFIED`, all provider-free on real
PostgreSQL: RESTART / RECOVERY (2), FAILURE RECOVERY (2), REPAIR LOOP (1). Each
names the exercised production path and its digest.

## No founder rescue, and no write to trusted main

- The run drove itself to `COMPLETION / VERIFIED / MISSION_VERIFIED`. No human
  intervened after dispatch.
- `origin/main` is `ed81b12e834ce60015926dfc56500dd4b09d4c72` before the run and
  after it. Julius worked in `/tmp/julius-workspace/tenant/ws` inside its
  disposable sandbox and its whole output is the candidate diff.
- Both markers exist: `julius-live-mission-5-attempted` (10173109349, 21:04:14Z)
  and `julius-live-mission-5-completed` (10174152092, 21:32:40Z). A further
  dispatch of mission 5 therefore still requires `acknowledge_rerun`, which is
  correct.

## What this run proved

1. **VERIFIED COMPLETION on a three-module mission**, with real providers on all
   three roles and no founder rescue.
2. **The repair loop works end to end on a paid run and the mission still
   completes** — blocking findings, a repaired plan, an independent second
   review, and a lock only after the review approved.
3. **The contract gate held**: `CHALLENGED` twice, `LOCKED` once, one binding
   digest on every post-lock claim.
4. **#250's `failure_reason` column behaves as designed**: absent (null) on
   every success row rather than defaulted to a value.
5. **#250's five recovered diagnostics reach a bundle**: `provider_status`,
   `incomplete_reason`, `reasoning_tokens`, `max_output_tokens` and
   `total_tokens` are columns in `worker-diagnostics.tsv` for the first time.
6. **A failure inside a successful run is recorded truthfully**, with enough
   detail to say which of two clocks fired.
7. **Cross-provider cost accounting stayed honest**: one known component, five
   `UNKNOWN`, no estimate dressed as a measurement.

## What this run did NOT prove

- **It did not prove the candidate should land.** It proves the candidate makes
  the mission's own specification pass and does not regress the julius suite or
  the typecheck. Landing it is a separate human decision.
- **It did not exercise the integrity layer in production.** Nothing in Relay
  passes `claims` to `compileJuliusContext` yet, so the claim-qualified path is
  reachable only from tests. The mission was scoped that way deliberately.
- **It did not price the architect or the reviewer.** Those transports report
  tokens and no cost, and the record says `UNKNOWN` rather than inventing one.
- **It did not establish the coder's cost as a rate.** $5.177120 for three
  modules is one datapoint, as $1.390954 for one module was.
- **It says nothing about the Hermes upstream timeout's frequency.** One
  occurrence in four reviewer dispatches on one run is not a rate.

## Open findings after this run

| id | finding | status |
|---|---|---|
| **G** *(new)* | The Independent Reviewer's real failure mode here is Hermes's own upstream request timeout at ≈94 s, far inside Julius's 480 s deadline. Julius's deadline policy cannot govern it; only a retry can, and one retry is what saved this run. | open |
| **D** | The plan reviewer ran at 93.5% of its deadline (449,140 / 480,112 ms). Better than Mission 4's 95.4%, still thin. | open, improved |
| **E** | The architect's success path carries fewer diagnostics than the failure path #247 repaired — no `elapsed_ms`, no `provider_status`, no cost. | open |
| **C** | The terminal `task.failed` on the retryable path carries no diagnostics (`julius-task-pipeline.ts:916`). Not exercised here — the retry succeeded. | open, deferred |
| **F** | `RELAY_PROMPT_ARCHITECT_TIMEOUT_MS` has two defaults: 300000 in `gpt-architect/config.ts`, 90000 in `relay-bridge/openai-architect.ts`. | open |

`XAI_API_KEY: MISSING` in the preflight banner is **not** a finding: the
reviewer transport is the local Hermes binary, which authenticates from its own
configuration, and it attested `served_model = grok-build-0.1` on all three
dispatches that produced a verdict. The fourth, the one that failed upstream,
carries no `served_model` at all — which is correct: nothing served it.

## Provenance of this record

Written from the durable bundle (artifact `10174157554`, downloaded and read
here) and from checks re-run in this container against trusted main
`ed81b12e834ce60015926dfc56500dd4b09d4c72`. The candidate is preserved
byte-identically at `docs/candidates/julius-live-mission-5-candidate.diff`
(`sha256:258830914fbb83d95f47546c552b669c2a27b4a30ff2f02a5ed4886e2764f051`,
25,077 bytes) because the evidence artifact expires on 2026-09-24.

It is a candidate: **not merged, not endorsed, not scheduled to land.**
