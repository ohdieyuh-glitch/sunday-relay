# Project Brain LLMOps

**Status: CONTRACTS AND PROJECTION IMPLEMENTED AND TESTED. TWO SURFACES.
NOTHING IS WIRED TO A LIVE RUN YET.**

Those are three different claims. Nothing in this document should be read as
"Relay is measuring your production latency today" — the model exists, both
surfaces render it, and no producer writes into it. When one does, that fact
belongs in this section and nowhere else.

---

## What was missing

Before this milestone the repository had a rich model of what a mission COST —
`mission/economics`, with receipts, budget evaluation, provider spend
categories, and an explicit `unknown-cost` discipline. It had a four-dimension
status model. It had durable persistence and recovery.

It had nothing at all for what a run cost in TIME, where it failed, what it was
waiting for, or whether anyone independent had judged it. Measured rather than
remembered: `latency`, `waiting_on_user` and `repair_loop` each appeared **zero
times** in `src/relay`.

`AqualaExecutionStatus` has a `waiting` state, but it does not say what the run
is waiting FOR — and "waiting on the user" is the one kind a user can act on.

## The four rules, carried by types

Each of these is enforced by a type or a derivation, not by a convention that
the next surface has to remember.

**1. An unobserved phase is absent, never zero.** There is no
`durationMs: 0` standing in for "we did not measure it". A sample that was not
taken is not in the array, and the projection reports `missingPhases` by name so
a surface can say which. `RelayFigure` is the type that stops this leaking:

```ts
type RelayFigure =
  | { known: true; value: number }
  | { known: false; reason: RelayUnknownReason };
```

There is no numeric field to read without first checking `known`. Both renderers
have exactly one function that turns a figure into text, and neither has a
branch producing `0` for an unknown.

**2. Waiting on a human is not latency.** Time blocked on user input, user
approval, a credential or a budget authorization is time the system is not
spending and not failing. Folding it into latency makes every metric a measure
of how fast someone answered a question and makes an idle system look slow. Wait
intervals are their own record with a REASON, and `WAITING_ON_USER_REASONS` is
the subset a person can personally clear.

An interval that happened and could not be measured still counts as an interval
and contributes zero milliseconds. Dropping it would under-report how often the
run blocked, which is the figure someone uses to decide whether to go and do
something else.

**3. A rate with an unknown denominator is unknown.** Two errors out of an
unknown number of attempts is not a 100% error rate and not a 0% one.
`RelayAttemptBase` carries the denominator and its provenance
(`counted | estimated | unavailable`) separately from every numerator.

**4. A self-evaluation is not an independent one.** `RelayEvaluation` requires
both `judgedBy` and `authoredBy`, and `isIndependentEvaluation` DERIVES
independence from whether they differ. It is not a flag a caller can assert.
This is the same rule the repository applies to its own review gate, and the
reason it is a type rather than a note is that every other form of it has been
violated at least once in this codebase's history.

## Health is derived, and silence is not health

`healthy | degraded | failing | unknown`, computed last, from everything else.

**A silent system is not a healthy one.** The commonest way a dashboard lies is
by showing the last good state forever after the thing feeding it stopped
reporting, so a newest-signal older than `HEALTH_STALE_AFTER_MS` produces
`unknown` — its own state, with its own colour, never folded into `healthy`.

Health always carries a REASON. A state without one is a colour.

| State | When |
|---|---|
| `unknown` | nothing observed, an unreadable timestamp, or the newest signal is stale |
| `failing` | one or more errors the run did not recover from |
| `degraded` | a repair loop ended with its finding open, a failing evaluation, or recovered errors |
| `healthy` | recent signal, nothing unrecovered, nothing open |

## A repair loop that ran out of budget did not succeed

`RELAY_REPAIR_OUTCOMES` distinguishes `converged`, `limit_reached`, `abandoned`
and `in_progress`. `limit_reached` and `abandoned` are counted as `endedUnfixed`
and never as repairs: a loop that exhausted its budget with the finding still
open has produced an unfixed defect AND a bill, and a surface that renders that
as "done" is lying about the state of the code.

`in_progress` is not `endedUnfixed`, because it has not ended.

## Two kinds of memory

The Project Brain already had one: approved, sourced entries a human let in.
That is the right default for durable knowledge and useless for "the suite went
red four minutes ago", which nobody is going to approve.

| | Short-term | Long-term |
|---|---|---|
| Enters by | observation | **approval** |
| Bounded | yes, `SHORT_TERM_CAPACITY` | no |
| Evicted | by recency, and the count is reported | never |
| Cited as | a fact about the last few minutes | a fact about the project |

**Promotion is a proposal, never an act.** `proposePromotion` returns a
`RelayPromotionProposal` carrying no approver and no approval time. There is
deliberately no function in the module that produces an approved entry: if an
agent could promote its own observation, "the Brain says so" would mean "an
agent wrote it down twice", and the approval gate that makes long-term memory
worth trusting would be decorative.

Eviction is counted and carried. A surface reporting "64 recent events" when 300
were observed and 236 fell off the end is describing its own buffer and calling
it the project's history.

## Continuously refreshed documentation

`refreshBrainDocument` regenerates the Brain's documentation from current
memory, and reports what it was generated FROM — the counts, and the newest
input timestamp — rather than only its conclusions. A document about a busy
project and a document about a project nothing has reported on for a day look
identical when a generator prints conclusions alone.

"Continuously refreshed" is a promise about staleness, and a promise about
staleness needs a number and an observed timestamp or it is a word in a README.
`BRAIN_DOC_STALE_AFTER_MS` is that number.

Entries approved by their own author get their own section rather than being
filtered out. They exist and are being used, and hiding them would make the
Brain look better than it is.

## Both surfaces, one projection

`projectOperations` is called by the workspace panel and by
`relay project operations`. Neither computes a figure of its own — the CLI's
`--json` output IS the view object, asserted by identity rather than by
equality, because a CLI that reshaped it would be a second implementation
waiting to disagree with the website's. Two people reading different numbers off
two screens in the same conversation is the failure a parity contract exists to
prevent.

## Intake: where a provider's `null` meets a metric

`operational-intake.ts` is the only place the two touch, and the rule is stated
once and applied everywhere in it: **a null, a NaN, a negative, or an
`unavailable` usage class produces NO SAMPLE.** Not a zero, not a defaulted
field — nothing enters the array, and the projection then names that phase under
`missingPhases`.

A zero duration IS kept, because zero is only wrong as a stand-in for unknown;
an actually-instant phase is a fact, and dropping it would be the mirror of the
same bug.

Two more defaults that go the safe way:

- An **unrecognised failure label becomes `unknown`**, never the closest-looking
  match. Deciding that `connection_reset` is a `provider_timeout` invents a
  diagnosis, and the count of `unknown` errors is itself the signal that the
  mapping needs a case.
- **Absent recovery means NOT KNOWN to have recovered.** Defaulting to
  `recovered: true` would quietly downgrade every failure an adapter forgot to
  annotate, and unrecovered errors are exactly what make health `failing`.

`newestSignalAt` is computed from the signals present rather than from the wall
clock at ingest: a record assembled at noon from an hour-old log is an hour old,
and staleness drives health.

Every intake function takes a STRUCTURAL type rather than importing a
connector's interface. The domain must not depend on a particular adapter, and
an import edge from `mission/` into `connectors/` would invert the same layering
the website boundary rule protects.

## Not implemented

**Nothing calls the intake yet.** The functions exist and are tested against
fixtures; no adapter, run handler or bridge invokes them, so no live run is
being measured. Token counts are modelled by `mission/economics` receipts
(`input_token`, `output_token`, `cached_input_token`) and are cited from there
rather than duplicated here. There is no persistence for short-term memory, no
UI for approving a promotion proposal, and no scheduled refresh of the Brain
document; `refreshBrainDocument` is a pure function and something still has to
call it.

None of that is blocked on a founder action. It is simply not built yet, and
this file will say so until it is.
