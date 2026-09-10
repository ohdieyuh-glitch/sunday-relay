# Paid run 34470535718 — Mission 4, the first fully verified paid mission

**PAID LIVE MISSION 4 COMPLETE — VERIFIED COMPLETION, CANDIDATE ONLY.**

Every claim below is read from the durable evidence bundle uploaded by the run
itself (artifact `10150146877`), or from an independent re-verification
performed outside the sandbox and described as such. Where the bundle cannot
answer something, this document says so rather than filling the gap. The
findings at the end are part of the result, not footnotes to it.

## The causal question

> After the architect observability repair and the governed output ceiling,
> can Julius take a real engineering task from trusted main through a real paid
> architect, an independent evaluator, an explicit contract disposition, a
> lock, a real paid coder confined to a disposable sandbox, real tests and a
> real paid independent reviewer bound to the *same* digest — and reach VERIFIED
> COMPLETION without touching trusted main and without founder rescue?

Yes. This is the first paid mission to do it.

## Identifiers

| | |
|---|---|
| trusted main | `5be73c5653ba26b607b6e805c720ebddc549dd5f` |
| GitHub Actions run | `34470535718` (#36), `workflow_dispatch`, attempt 1 |
| durable Julius run | `run:c8910d0afb5608e0ea68aa72` |
| mission | `mission:julius-live-4` / project `prj-julius-live-4` / tenant `tenant` |
| marker namespace | `julius-live-mission-4` |
| contract sha256 (attempted marker) | `43e9f3b1274160c23bcc517951dde3771aceb0221f19e8dbeb889d7af711513c` |
| result | **COMPLETED** after 5 ticks |
| wall clock | 11:20:07Z → 11:41:25Z (21 min 18 s) |
| card revision | `card:julius-live:1` |
| prior attempt | `34459684814`, failed at the architect after 1 tick |
| evidence artifact | `10150146877` |

The rerun was deliberate: attempt one left an `attempted` marker, so this
dispatch carried `acknowledge_rerun = "RERUN PAID MISSION"` alongside
`confirm_live = "RUN LIVE MISSION"`, pre-authorized by the founder.

## The number that settled the capacity question

The repair landed in #247 raised the architect's output ceiling as an
explicitly **labelled hypothesis**, not a demonstrated fix. The commit message
and handoff §00n both said so: Live Run 3 produced 15,638 characters of raw
`outputText` under the same 4,000 ceiling and validated, and Mission 4 attempt
one produced *zero* output rather than truncated JSON, leaving the evidence
ambiguous between reasoning-consumed budget and a content filter.

This run measured it. From `worker-diagnostics.tsv`:

```
run:c8910d0afb5608e0ea68aa72:plan   PROMPT_ARCHITECT   openai / gpt-5.6-sol
  output_tokens          = 4158     <-- old DEFAULT_MAX_OUTPUT_TOKENS was 4000
  input_tokens           = 2303
  output_bytes_observed  = 19332
  json_detected = true   json_parseable = true   validation_passed = true
  plan_attempts = 1      dispatch_attempt = 1    outcome = succeeded
  response_id   = resp_05cb55d930387944016aa29269092887d1b5ccb8903a2c896f
  cost_basis    = UNKNOWN
```

**The plan that satisfies this mission does not fit in 4,000 output tokens.**
It needed 4,158 — 158 over the old hard cap — on the first attempt, no retry.

### What that does and does not establish

It **does** establish that the mission's plan genuinely requires more than the
old ceiling, which is what the ceiling change was for. It is a measurement, not
an inference from source code.

It does **not** establish attempt one's `incomplete_details.reason`. That is
permanently unrecoverable: the Responses API call ran with `store: false`, so
there is no provider-side copy, and the diagnostics allowlist in force at the
time discarded the reason before it reached durable state. That lost causal
evidence is itself the Julius observability defect that #247 repaired; it
cannot be recovered retroactively for run 34459684814. This run is also a
*different* call to a non-deterministic model, so it is corroboration of the
capacity story, not proof of that specific failure.

## The Task Contract lifecycle

From `task-contracts.tsv` and `contract-events.tsv`:

| when | what | revision |
|---|---|---|
| 11:20:07.828 | contract created `DRAFT` by `relay-bootstrap` | 1 |
| 11:21:11.348 | `julius.contract.proposed` by task `:plan` | 2 |
| 11:34:13.779 | `julius.contract.disposition` → **`NO_CHALLENGE`** / `TASK_VERIFIED`, evaluator `independent-reviewer-hermes` | 2 |
| 11:34:13.782 | **`LOCKED`**, `locked_by_evaluator_id = independent-reviewer-hermes` | 2 |
| 11:34:13.828 | `julius.task.claimed` — `CODING_AGENT` | 2 |
| 11:36:29.601 | `julius.task.claimed` — `INDEPENDENT_REVIEWER` | 2 |

Binding digest, identical on both claims and on both dispatch rows:
`sha256:7e55471e12e7214f8d418c6ce11afdfcd334536d73c25584666d6448e4ae10e3`.

The evaluator issued a machine-readable disposition before the lock, which is
the leg wired in §00k. It chose `NO_CHALLENGE`; the CHALLENGE leg was not
exercised by this run.

## What each worker did

| task | role | transport / provider | served model | outcome |
|---|---|---|---|---|
| `:plan` | PROMPT_ARCHITECT | openai | `gpt-5.6-sol` | SUCCEEDED, 1 attempt |
| `:plan:review` | INDEPENDENT_REVIEWER | local (Hermes) / xai | `grok-build-0.1` | **TIMEOUT**, then SUCCEEDED on attempt 2 |
| `:build` | CODING_AGENT | hosted / anthropic | `claude-fable-5` | SUCCEEDED, 1 attempt |
| `:build:review` | INDEPENDENT_REVIEWER | local (Hermes) / xai | `grok-build-0.1` | SUCCEEDED, 1 attempt |

Coder detail: `num_turns = 11`, `tool_use_count = 10`, `permission_denials = 0`,
`implementation_present = true`, `result_subtype = success`, `is_error = false`.
Three executor `shell.bash` invocations (`base`, `diff`, `test`), all exit 0.

`XAI_API_KEY` is reported `MISSING` in the preflight evidence: the reviewer runs
through the local Hermes binary under an isolated `HERMES_HOME`, which carries
its own auth. `provider = xai` names the model behind Hermes, not a direct key.

## Spend

| Event | Allocated | Basis | Remaining after |
|---|---|---|---|
| `:plan` | 300,000 µ$ | ESTIMATE | 19,700,000 |
| `:plan:review` attempt 1 | 300,000 µ$ | ESTIMATE | 19,700,000 |
| `:plan:review` attempt 2 | 300,000 µ$ | ESTIMATE | 19,700,000 |
| `:build` | **5,000,000 µ$** | CODER_SHARE | 19,400,000 |
| `:build:review` | 300,000 µ$ | ESTIMATE | 18,009,046 |

The coder share is exactly `floor(20 / (1 + 3)) = $5.00` under
`julius-allocation.v1`, against the contract's `spendUsd: 20` /
`repairCycles: 3`. It settled at **1,390,954 µ$ = $1.390954**,
`cost_basis = PROVIDER_REPORTED`, `cost_source = runtime_reported`, against
`cost_ceiling_usd_micros = 5,000,000`.

Architect and both reviewers settled **`UNKNOWN`**. Those transports report
tokens, never a price. From `cost-accounting.tsv`:

```
CODING_AGENT           1 component   known 1390954 µ$   unknown 0
INDEPENDENT_REVIEWER   2 components  known 0            unknown 2
PROMPT_ARCHITECT       1 component   known 0            unknown 1
```

**Total known spend: $1.39.** Unknown stayed unknown; nothing was inferred from
configuration or filled with a zero.

**The raised token ceiling did not buy its way past the budget.** The
architect's allocation was the same 300,000 µ$ ESTIMATE it has always been, the
reservation was taken and settled normally, and `remaining_usd_micros` fell
monotonically. `ARCHITECT_OUTPUT_TOKEN_RESERVATION` (20,000) is the bound the
contract's `architectMaxOutputTokens` is validated against, and it is the same
figure `fixedResourceEstimate` already reserved — which is why a raised limit
cannot arrive unbudgeted.

## Project Brain writes

22 entries at `project-brain.tsv`: 1 objective CONSTRAINT, 12
`ACCEPTANCE_UPDATE` requirements, 6 CONSTRAINT, 1 criteria, and **2 DECISION
entries** written by `independent-reviewer-hermes`, one per accepted task, each
carrying its `task_id`. Revisions run 1→22 without a gap.

## Verification and completion

```
decision:94faff25-83b8-4942-b31b-a85b62c1c153  :plan   ACCEPT  TASK_VERIFIED  11:34:13.788
decision:55660c5b-c6b6-4ea8-aec0-807352395241  :build  ACCEPT  TASK_VERIFIED  11:41:25.595
```

Both `VERIFICATION` trajectory rows record `criteriaMissing: 0`, and each is
followed by a `julius-verification-resume` row confirming the same verdict
survives the resume path. Terminal event:

```
COMPLETION  VERIFIED  {"tasks": 4, "decisions": 2, "reasonCode": "MISSION_VERIFIED"}
```

`findings.tsv` has **0 rows** — no blocking findings, so no repair cycle was
minted. `failures.tsv` has exactly one row, the reviewer timeout below.

## No founder rescue, and no write to trusted main

`origin/main` was `5be73c5653ba26b607b6e805c720ebddc549dd5f` before the run and
is unchanged after it, with **0 commits** on main since 11:19Z. Julius's entire
output is the workspace diff in the evidence bundle. It is a **candidate**;
landing it is a separate, human decision.

## What Julius built

One file, `src/relay/mission/julius/julius-memory-trust.ts`, **+110 / −5**. All
five `memory_trust_not_implemented` stubs replaced with real implementations of
the Project Brain v2 trust core:

- a candidate is admitted `UNVERIFIED` **whatever `requestedTrust` asked for** —
  auto-generate is allowed, auto-trust is not;
- blank `claimId` / `entryId` / `assertedBy`, or a provenance outside the
  vocabulary, is REFUSED with a reason code;
- promotion to `VERIFIED` requires `REVIEW` or `FINDING` evidence **and** an
  authority that is not the claim's own `assertedBy` — a claim cannot verify
  itself; `APPROVED` requires `DECISION` evidence; `SUPPORTED` requires evidence
  the asserter did not supply;
- promotion only ever raises standing in `UNVERIFIED < SUPPORTED < VERIFIED <
  APPROVED`, and `CONTRADICTED` / `SUPERSEDED` are never promotion targets;
- a terminal claim is never promoted again;
- contradiction records the conflict on **both** claims and deletes neither, and
  an `APPROVED` claim is not demoted by a bare conflicting assertion;
- retrieval never returns a `CONTRADICTED` or `SUPERSEDED` claim, whatever it
  once was;
- every function copies rather than mutates, with freshly allocated nested
  collections.

## Independent re-verification (outside the sandbox)

The bundle's `TEST/PASSED` evidence is the sandbox's own claim. It was checked
independently on a detached worktree of trusted main `5be73c56` with the
candidate applied, the mission's seed test restored, and **no `node_modules`**,
running the contract's own command:

```
node --import ./.julius/loader.mjs --test src/relay/mission/julius/julius-memory-trust.test.ts
  → tests 10, pass 10, fail 0, EXIT=0
```

Counterfactual on the same worktree with the candidate reverted:
**pass 1, fail 9** — the one pass being the vocabulary test, which the stubs
already satisfied. The work was necessary and the tests are real.

Constraint audit against the contract:

| constraint | result |
|---|---|
| `git apply --check` against `5be73c56` | clean |
| files changed | exactly one, the named file |
| exported names / signatures unchanged | identical, 12 exports |
| imports added | none |
| non-erasable syntax (`enum`, `namespace`, param properties) | none |
| `memory_trust_not_implemented` remaining | 0 |
| `npm run typecheck` (all four passes, bridge included) | clean |

## Capability proofs carried in the same bundle

`capability-proofs.tsv`, 5 rows, all `VERIFIED`, all on real PostgreSQL with no
provider call: RESTART / RECOVERY (12 steps, two processes, real lease expiry),
FAILURE RECOVERY (12 steps, transient and permanent), REPAIR LOOP (12 steps,
rejected review, bounded rounds), each pinned to the digest of the source file
it exercised.

## Findings

### FINDING D — the plan reviewer is running at 95.4% of its timeout

`:plan:review` attempt 1 **timed out**:

```
timed_out = true   elapsed_ms = 400093   timeout_ms = 400000
first_output_observed = false   process_started = true   process_pid_observed = true
signal_sent = SIGTERM   exit_observed = true   cleanup_completed = true
→ julius.retry.scheduled   julius_code = TIMEOUT   retryable = true
```

Over budget by **93 milliseconds**. Attempt 2 succeeded:

```
first_output_after_ms = 381447   elapsed_ms = 381880   timeout_ms = 400000
```

**18.1 seconds of margin.** The reviewer is silent for ~381 s and then emits
everything in a burst, so the timeout is not measuring progress — it is racing
the burst. The build review, on a larger packet (41,601 bytes vs 28,058),
finished in 218,324 ms (54.6% of budget), so this is specific to the plan
review, not to Hermes generally.

The retry machinery worked exactly as designed on its first real paid exercise —
SIGTERM, clean teardown, diagnostics preserved, retry scheduled, second attempt
succeeded, mission completed. That is the good news; the margin is the bad news.
**This is the next repair target.**

### FINDING E — the success path now carries fewer diagnostics than the failure path

#247 added `providerStatus`, `incompleteReason`, `reasoningTokens`,
`totalTokens`, `maxOutputTokens` and `elapsedMs` to **failed** architect
dispatches. The succeeding architect row carries `input_tokens` and
`output_tokens` but none of the rest. So the bundle cannot say how much of those
4,158 tokens was reasoning, nor what ceiling was in force at the time.

Nothing is misstated — absent renders unknown, per the repository's rule — but
the asymmetry is backwards: the run we can learn most from is the one that
worked. Had `reasoningTokens` been present here, the capacity story would be
settled rather than corroborated.

### FINDING C (from §00n) — still open, deliberately deferred

On the retryable path the terminal `task.failed` row carries zero diagnostics,
because `JuliusDispatchOutcome` does not return them to
`julius-task-pipeline.ts:916`. This run confirms the other half: the
`julius.retry.scheduled` row for the reviewer timeout carried a full 59-key
diagnostic payload. The defect is only in the terminal row.

## What this run proved

1. A real paid architect, evaluator, coder and reviewer can carry a real
   engineering task to VERIFIED COMPLETION with no founder intervention.
2. One immutable locked Task Contract bound the coder and the reviewer to the
   **same** digest, and the evaluator issued an explicit machine-readable
   disposition before the lock.
3. Julius engineered Sunday Relay **without touching Sunday Relay**: trusted
   main is byte-identical before and after.
4. The candidate is correct by a test suite Julius could not edit, verified
   independently of the sandbox that produced it.
5. Spend accounting held: a real provider-reported charge, two honest UNKNOWNs,
   a coder share computed by policy, and a raised token ceiling that changed no
   allocation.
6. The reviewer retry path recovered a real timeout on a real paid run.

## What this run did NOT prove

1. **Attempt one's failure reason.** Unrecoverable (`store: false` + the
   discarding allowlist). Corroborated, not proven.
2. **The CHALLENGE leg.** The evaluator chose `NO_CHALLENGE`; CHALLENGE remains
   proven only provider-free.
3. **The repair cycle.** Zero blocking findings, so no repair was minted. The
   repair loop remains proven by drill, not by a paid run.
4. **Reasoning-token accounting on success.** See FINDING E.
5. **That the candidate should land.** Correctness is not the same as a decision
   to merge. This record makes no such recommendation.

## Provenance of this record

Written from evidence artifact `10150146877` of run `34470535718`
(`budget.tsv`, `capability-proofs.tsv`, `contract-events.tsv`,
`cost-accounting.tsv`, `decisions.tsv`, `evidence.tsv`, `failures.tsv`,
`findings.tsv`, `live-mission.evidence.txt`, `project-brain.tsv`, `runs.tsv`,
`task-contracts.tsv`, `tasks.tsv`, `tool-invocations.tsv`, `trajectory.tsv`,
`worker-diagnostics.tsv`, `workspace.diff`, `workspace-status.txt`), plus the
two marker artifacts `10149390009` (attempted) and `10150135422` (completed),
and the independent re-verification described above. No figure here was carried
over from an earlier run.
