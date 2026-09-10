> **This PR targets Sunday Relay only.**
> **This PR must be squash-merged.**
> **Do not merge without founder authorization.**
> **This PR does not itself dispatch a paid mission.**

Base SHA: `6b2d62e762c6c38ce2a57faa35c7821a4582ed56`
Head SHA: `ab16ed0422341d992443e78ebcd662d1497027b6`
Tree SHA: `079deefb6d9236fd351bd442ee20d0ce15477fcd`
Commits: 1

## Relay Product Scope

The OpenAI Prompt Architect connector, the failed-dispatch diagnostics that
carry its answer, the router allowlist that admits them, one mission contract
field and its checker. No website, no CLI action, no new dependency, no
deployment config. `JULIUS_HARNESS_MANIFEST.md` unchanged and verifies current.

## What happened

Paid Live Mission 4's first attempt — run **34459684814** on trusted main
`6b2d62e7`, durable run `run:5545869f03f9d6a0708d2383` — crossed the paid
boundary and failed at the architect after 62 seconds. `PROMPT_ARCHITECT/plan`
FAILED with `failureClass=incomplete_response`; `CODING_AGENT/build` BLOCKED; no
disposition, no lock, no coder, no reviewer, no verification decisions. A real
call was billed: the `response_id` exists and `gpt-5.6-sol` answered.

Every safety gate held. The paid-attempt marker persisted correctly.

## What the evidence could not say

The durable record held the class and almost nothing else — no tokens, no
ceiling, no provider status, no reason. The cause could only be approached by
reading the connector's source, which is the failure this repository exists to
prevent.

**The provider's own `incomplete_details.reason` is unrecoverable.** Two
independent reasons, either sufficient:

1. Julius wrote it only into a free-text `message`, which the evidence allowlist
   withholds — correctly, because a message is prose.
2. `gpt-runner.ts` sets `store: false`, so OpenAI never persisted the response
   and the `response_id` cannot be dereferenced.

Also established: **no paid run has ever recorded architect token usage.** Live
Run 3's `worker-diagnostics.tsv` has **0 rows** — success-path diagnostics
landed in #243, *after* it — and Mission 4's failure path discarded usage.

## The observability repair

`GptRunFailure` **had no `usage` field at all**. The connector computed the
provider's usage and returned without it on every one of the four post-response
failure paths: a refusal, an incomplete answer, a non-`completed` status and an
empty output were all billed and all reported nothing. `costBasis` was then
honestly `UNKNOWN` — but unknown *only because the answer had been discarded*,
which is the one kind of unknown this system may not manufacture.

A failed dispatch now records `providerStatus`, `incompleteReason` (narrowed to
a machine token, never prose), `inputTokens`, `outputTokens`, `reasoningTokens`,
`totalTokens`, the `maxOutputTokens` in force, `elapsedMs`, attempt, `outcome`
and `failureClass`.

`reasoningTokens` because on a reasoning model it is spent against the **same**
ceiling as the visible answer — it is the number that would explain an
exhaustion — and the ceiling is recorded beside it so the comparison is
checkable rather than asserted. `costBasis` stays `UNKNOWN`: this transport
reports tokens and never a price, and one is still never inferred from the
other. **Absent stays null, never zero.**

## A failure before validation no longer claims a failed validation

`validation_passed=false` on Mission 4's row said the plan had been validated
and rejected. Nothing was validated — the connector returned first. Those are
different sentences about a paid run and only one is true. It is `null` on that
path now: "never reached", which is what happened.

The same edit separates a distinction that was being collapsed: a provider that
**answered** with no usable text records `jsonParseable: false`, a real
observation; a call that **never reached** the provider records `null`, because
nothing was observed and `false` would be a reading nobody took.

## Capacity — stated at its true confidence

**Capacity exhaustion is the leading hypothesis and is NOT demonstrated.**

`DEFAULT_MAX_OUTPUT_TOKENS = 4000`, and `RELAY_PROMPT_ARCHITECT_MAX_TOKENS` has
never been set in any commit, so every paid mission ran at 4,000. On the
Responses API a reasoning model spends reasoning tokens against that same
ceiling.

But the obvious story does not survive contact with Live Run 3, whose architect
produced **15,638 characters of raw `outputText`** (`live-workers.ts:752` uses
`outcome.outputText.length`, so that is the model's own output) and validated —
under the *same* 4,000 ceiling. If Mission 4 merely needed more room, the
expected shape is **truncated JSON**. What happened was **no output at all**
(`json_detected: false`): the budget went before any visible token, or
generation stopped at the very start. `content_filter` is the other documented
reason for `status: incomplete` and cannot be ruled out.

So the ceiling is raised as a **bounded, auditable hypothesis**, not as a fix,
and the same change makes the next run *measure* it.

## The ceiling is governed, and its bound is not a guess

Not a blanket environment bump. `limits.architectMaxOutputTokens` lives in the
**mission contract**, beside `spendUsd` and `repairCycles`. Optional — a mission
that declares nothing keeps the connector default and behaves exactly as every
mission before it did.

`fixedResourceEstimate` has always reserved **20,000 output tokens per
dispatch** while the connector capped the architect at **4,000**: two numbers
describing the same call, disagreeing five-fold, stated nowhere a mission author
would look. `ARCHITECT_OUTPUT_TOKEN_RESERVATION` now names the reservation, the
estimate uses it, and it is the maximum a contract may declare.

**That is the safety property the larger ceiling needs:** a mission cannot buy
more output than the budget already reserves, so a raised token limit can never
outrun the mission's own `spendUsd` ceiling by arriving unbudgeted. Mission 4
declares 20,000; **20,001 is refused, naming both numbers.** Raising it further
is a deliberate edit in both places, and a test holds the two constants to each
other because the checker is dependency-free and must repeat the number.

## Not repaired, and named so it is not discovered twice

On the **retryable** path the terminal `task.failed` row carries zero
diagnostics while each `retry.scheduled` row carries all 59 —
`JuliusDispatchOutcome` returns the code and the class to
`julius-task-pipeline.ts:916` but not the diagnostics. It did **not** affect
Mission 4, whose failure was not retryable and whose terminal row carried
everything. Repairing it widens a core return type, which is its own change and
its own risk; a test pins the working half so a later repair is measurable.

## Mutation-tested, six ways, every one caught

| Mutation | Result |
|---|---|
| revert the failure site to report no usage (**the original defect**) | 1 failed |
| drop `incompleteReason` | 1 failed |
| remove `reasoningTokens` from the router allowlist | 2 failed |
| drift the two reservation constants apart | 1 failed |
| make the estimate stop using the constant | 1 failed |
| revert `validationPassed` to the masquerading `false` | 1 failed |

## Gate

`npm test` **9,876 passed / 0 failed** across 511 files (3 skipped, 30 todo);
`typecheck` (4 passes); `build`; `relay:build`; `relay:bridge:build`;
`relay:julius:build`; `relay:julius:preflight:build`;
`relay-repository-boundary`; `relay-parity-gate`;
`relay:surface-parity:check:strict`; `relay:yc-demo:check`;
`relay:cli:contract-verify`; `export-julius-harness --check` **current**,
manifest untouched; `git diff --check`; `relay:persistence:contract-verify`;
`relay:persistence:recovery-drill`; `relay:workspace:verify`;
`relay:claude:contract-verify`.

**Provider calls made by this change: zero.**

## After this lands

The zero-spend preflight on the new trusted main, then the **deliberate rerun**
of Paid Live Mission 4 (`acknowledge_rerun`, because attempt 1 left a marker).
Whether the raised ceiling was the answer will then be a measurement in the
evidence bundle rather than an inference from source.
