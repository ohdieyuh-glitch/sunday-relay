# Julius sustained peers, PR 2: the architect answers, only accepted guidance instructs, findings have a life, and a completion nobody checked cannot happen

PR #270 gave Julius typed peers. This is the second half: the peers now hold
positions over time, the record says what happened to every problem raised, and
the mission cannot call itself done on the reviewer's word about the WORK plus
nobody's word about the SYSTEM.

Five improvements, six commits, provider-free throughout. No provider call was
made, no credential is touched, and no Anthropic spend of any kind.

---

## 1 · The architect can answer a disagreement, live

PR #270 could mint a `rebuttal` task and nothing could serve it, so every live
challenge resolved `REBUTTAL_UNROUTABLE` — the challenge upheld because nobody
could answer it. The live architect now takes the rebuttal branch with its own
charter, its own strict closed schema, and the DOMAIN's own sanitizer as the
adapter's validator, so the adapter and the kernel cannot disagree about what a
usable rebuttal is.

The charter is explicit that the terms are not on the table, and the schema
gives a strict model nowhere to put one. An architect whose position genuinely
requires a mission term to move sets `missionTermsMustChange` — which escalates
the disagreement to whoever owns the mission rather than moving anything.

`rebuttal` joins `JULIUS_REVIEW_STAGES` as a CONDITIONAL stage, not a normal
one: counting it as normal makes the reviewer's per-review deadline
unsatisfiable (792 000 ms needed against 750 000 allowed), which
`reviewer-deadline.test.ts` refuses at build time rather than discovering on a
paid run.

## 2 · Only guidance Julius accepted ever instructs

A guidance packet used to reach the waiting coder the moment the architect wrote
it. The reviewer then judged it, and where it was sent back the coder's context
already held it: the correction arrived later, beside advice Julius had
rejected, and both read as instructions. A reader that cannot tell them apart
follows the first.

A packet is now a PROPOSAL scoped to the architect task that wrote it, and
ACCEPTANCE of that task's review is the only thing that delivers it — run-wide,
under an authoritative heading, carried forward into every continuation.
Nothing is erased: the rejected packet stays on the record as the proposal it
was, labelled, and outside every executable context.

## 3 · A finding has a life, and only the reviewer that raised it can end one

Findings were recorded OPEN and stayed OPEN forever, so a completed mission's
record still said the problem was there. The opposite mistake would be worse and
is refused: OPEN → ADDRESSED → RESOLVED / SUPERSEDED, where a repair that ran
moves a finding to ADDRESSED **and no further**, and only a re-review that
explicitly answers about that finding, by id, can end it. Silence resolves
nothing. A finding keeps its identity — category, severity, evidence, target,
origin review, repair linkage, resolution review — across review → repair →
re-review, including a second round, whose nesting the first version could not
climb.

The re-review is shown a BOUNDED diff of the round: the findings it must answer,
the evidence before and after, and the sentence that a finding it does not
answer stays exactly as it is.

## 4 · An argument is bounded conditional work, and it is visible

The mission-aware tick planner did not know peer tasks existed, so an argument
spent from an allowance sized for a mission that never argues. The plan is
unchanged (`julius-continuous-1` still plans 73 — a disagreement is never the
main path); the hard maximum counts one rebuttal and one re-review per review
that could challenge; and the allowance grows only for arguments that actually
happened. `disagreementTicks` rides on the allowance, the drive's tick account
and the entrypoint's tick line. Exhaustion is still an explicit FAILED with
every number, and an operator `max_ticks` still only tightens.

## 5 · The architecture is durable state, watched, and checked before completion

The architect's picture of the system lived in prose inside one dispatch and
ended with it, so drift could be argued about and never detected.

**It is state.** A bounded typed revision: components, boundaries (INTERFACE /
SCHEMA / DEPENDENCY / OWNERSHIP / SECURITY / CONCURRENCY / PERSISTENCE /
INVARIANT), dependencies with their assumptions, decisions with what was
rejected and why, assumptions with HOLDS / UNVERIFIED / INVALIDATED, open
questions with owners, risks with impact and mitigation. The whole revision
rides on its ledger row, so a restart, a continuation or a ledger reconstruction
rebuilds it from rows alone — no second store, no in-memory mission truth. A row
that would not pass the allowlist today is ignored rather than trusted.

**It is advisory.** The peer authority guard refuses a revision that names a
mission-owned term or mints a Julius-only outcome, under the same rule that
refuses it in a guidance packet. Where the design and the contract disagree the
disagreement is RECORDED with `resolvedBy: CONTRACT`, and the contract stands.

**Julius goes back to it.** Seven named triggers — implementation drift,
evidence that contradicts a named assumption, a dependency change, a repair
required for an architectural reason, a coder's guidance question, a re-plan
proposal, and the pre-completion check — each derived from rows that already
exist, each cause-once by `arch:<trigger>:r<revision>:<subject>`, and at most
twelve consultations in one run however much it drifts.

**Material is a list, not a feeling.** Drift is architectural when it crosses a
boundary the architecture declares. A rename, a reformat, a comment, a log line,
a doc or a test-only change is not drift, and an assessment demanding a repair or
a re-plan on the strength of one is refused by name.

**After the terms lock, a material revision is a re-plan.** It is PROPOSED,
scoped to the consultation that wrote it, and becomes the design in force only
when that consultation's review is ACCEPTED — the same rule that keeps rejected
guidance out of the coder's context, applied to the design itself. One that
conflicts with the locked terms is not a revision at all: it is escalated
`replan_requires_contract_revision`, and changing the agreement stays where it
belongs.

**The final check can stop a completion.** ALIGNED, DRIFT_NON_BLOCKING,
DRIFT_REQUIRES_REPAIR or REPLAN_REQUIRED, with the drift it names and evidence
for it. It is an ASSESSMENT, never a verdict: the architect cannot mint
VERIFIED, cannot accept a task and cannot complete a mission. The strongest
thing it can do is hold the run at the completion gate with the reason and the
drifting work on the record.

**Nothing that never opted in is stranded.** A run that recorded no architecture
is not gated at all, and a consultation no registered worker accepts is recorded
`served: false` and carried past — the lesson paid run 34037313976 taught the
guidance path, applied before it could cost anything here.

---

## Bugs reproduced before they were fixed

- **The architecture consulted itself in a loop.** A consultation states the
  WHOLE design rather than a diff, so an architect that found nothing to change
  answered with what was already in force — and Julius numbered it as a new
  revision, which changed the id of the pre-completion trigger, which minted
  another consultation, eight times over until the run cap stopped it. Found by
  the first e2e run of P23. A revision identical to the one in force is now
  recorded `architecture.unchanged` and numbered nothing.
- **Findings were folded OPEN forever.** `readVerdictLedger` filtered out
  `finding.` rows, so every repair re-addressed the same finding each round and
  a reviewer saying "still open" was refused as a repeat.
- **A second repair round could not see the finding it was repairing.** Repairs
  nest, so round two's lineage root is round one; the reviewer answering "is the
  original problem fixed?" is answering about a finding recorded against the
  unit. Fixed with `repairLineageRootOf` in three places.
- **Accepted guidance did not survive a continuation.** The packet reached the
  waiting coder and then vanished at the next segment boundary.
- **The conflict check would have been dead where it matters.** Read off the
  architect's own binding it returns null — the architect that drafts the terms
  is bound by none — so the check is made against the contracts that govern WORK
  in the run.

## Proofs

Provider-free: every worker answers from a script, and the live-adapter proofs
inject the provider call.

| Area | File | Tests |
| --- | --- | --- |
| Rebuttal schema ↔ domain parity | `rebuttal-schema-parity.test.ts` | 7 |
| Accepted-guidance-only delivery | `julius-guidance-authority.e2e.test.ts` | 5 |
| Live peer protocol | `julius-peer-live.e2e.test.ts` | 4 |
| Finding lifecycle | `julius-finding-lifecycle.test.ts` | 19 |
| Finding lifecycle, end to end | `julius-finding-lifecycle.e2e.test.ts` | 9 |
| Tick capacity | `julius-tick-budget.test.ts` | 18 |
| Architecture state | `julius-architecture-state.test.ts` | 17 |
| Architecture state, end to end | `julius-architecture-state.e2e.test.ts` | 7 |
| Drift, triggers, materiality, the gate | `julius-architecture-drift.test.ts` | 38 |
| The same, end to end | `julius-architecture-drift.e2e.test.ts` | 10 |
| Consultation schema ↔ domain parity | `architecture-schema-parity.test.ts` | 9 |
| The live architect's own branches | `julius-live-composition.test.ts` (+4) | 155 |

## Mutation testing

**94 mutants run against this branch — 93 killed.**

- **41 of 41** written for this PR's five changes are killed, across the six
  areas the work touches: peer authority, guidance gating, finding resolution,
  disagreement bounds, drift materiality, and the final verification gate.
- **52 of 53** from PR #270, re-run here to prove this PR weakened nothing that
  already landed. The one survivor is **C3-M16**, the equivalent mutant
  documented when #270 landed: a non-material disagreement's work is always
  decided before its disagreement resolves, so removing the materiality filter
  from the repair sweep changes no reachable behaviour. Artificial behaviour is
  not being added to kill it.

Five mutants survived their first run, and each was a real hole rather than a
harmless edit — the live architect's own branches were never driven, a "foreign
finding" was only ever proven with an id nobody had issued, a consultation's
tick cost was only ever asserted as zero, a rejected proposal's revision number
was unproven, and the rebuttal stage's exclusion from the normal-stage budget
was checked by no test the mutant's list reached. All five are closed by the
final commit, which names the mutant beside each proof.

One mutant of this PR's own set was **mis-specified and replaced rather than
counted**: `P2C5-M13` originally multiplied the consultation's return value by
zero, which left the consultation happening and removed only a recompute the
next advance performs anyway. Rewritten to disable the consultation itself, it
is killed by nine of the ten drift e2e proofs.

## Gates

`npx tsc -b --noEmit` across all four projects, `relay-repository-boundary.mjs`,
`julius:harness:check`, `git diff --check`, and the Julius kernel, bridge,
connector and script suites: **1 988 passing**, with three failures that are
present identically on clean `main` on this Windows workstation and are
environment noise, not behaviour — `npx` not resolvable from a spawned test
(`julius-research-authority` 22), an ESM path scheme (`reviewer-envelope` 7),
and an empty stdout from a spawned node script (`reviewer-deadline` mirror). The
broad Julius selection was run on both this branch and a clean-`main` worktree
at `2c91dd11`: the failure sets are identical.

## Known residuals

- **Completion does not require every finding RESOLVED.** The gate added here is
  the architecture's; a mission can still complete with an ADDRESSED finding no
  reviewer ended. Making that a completion condition is a separate decision with
  its own blast radius.
- **`DRIFT_REQUIRES_REPAIR` holds rather than repairs.** The run stays VERIFYING
  with `ARCHITECTURE_DRIFT_REQUIRES_REPAIR` and the drifting task named; Julius
  does not itself mint the repair, because re-opening an already-accepted task
  needs the store-side finding status the lifecycle deliberately keeps on the
  ledger. A later revision that says ALIGNED clears the hold.
- **A rebuttal whose dispatch fails leaves the disagreement open.** There is no
  default resolution on provider failure, by design; the alternative is
  resolving an argument nobody made.
- **The architecture consultation is one call for two questions.** The schema
  requires both halves, so a mid-mission consultation also assesses consistency;
  the last assessment for the revision in force is the one the gate reads.

## What remains for PR 3

Cross-mission architecture memory, the Project Brain's durable home for these
revisions, and completion conditioned on finding resolution.

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01KLYuWBeq4erDEd89bec95L
