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

This is the one deliberate exception to the `RelayFigure` discipline: a wait
TOTAL is a plain number, and it is a FLOOR rather than an estimate. The
`intervals` count beside it is what tells a reader the difference — a total of
0ms across 1 interval means the wait happened and could not be timed.

**3. A rate with an unknown denominator is unknown.** Two errors out of an
unknown number of attempts is not a 100% error rate and not a 0% one.
`RelayAttemptBase` carries the denominator and its provenance
(`counted | estimated | unavailable`) separately from every numerator.

**4. A self-evaluation is not an independent one.** `RelayEvaluation` requires
both `judgedBy` and `authoredBy`, and `isIndependentEvaluation` DERIVES
independence from whether they differ.

Deriving it is not enough on its own, because a caller can still choose the
answer by choosing a SPELLING. A Cyrillic `а` (U+0430) reads as a Latin `a` and
survives NFKC unchanged — NFKC normalises compatibility forms, not confusables —
so `judgedBy: 'аgent'` against `authoredBy: 'agent'` counted as independent. So
identities are folded through a small confusables table as well as NFKC, and
invisible characters are stripped.

That table is a mitigation and is not claimed to be complete. Where an identity
still carries a character this product does not issue, comparison **fails
closed**: `isIndependentEvaluation` returns false, and `isSelfApproved` returns
true. Neither grants a benefit on the strength of a spelling nobody can verify.

## Health is derived, and silence is not health

`healthy | degraded | failing | unknown`, computed last, from everything else.

**A silent system is not a healthy one.** The commonest way a dashboard lies is
by showing the last good state forever after the thing feeding it stopped
reporting, so a newest-signal older than `HEALTH_STALE_AFTER_MS` produces
`unknown` — its own state, with its own colour, never folded into `healthy`.

Health always carries a REASON. A state without one is a colour.

| State | When |
|---|---|
| `unknown` | nothing observed, an unreadable timestamp, a signal dated in the FUTURE, or a stale newest signal |
| `failing` | one or more errors the run did not recover from |
| `degraded` | a repair loop ended with its finding open, a failing evaluation, or any recovered error |
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

**Both surfaces render it.** `RelayProjectBrainStatus` shows the freshness line
and every section; `relay project brain` prints the same document from the same
generator. A document that was never generated is reported as exactly that,
never as an empty document — a project with nothing recorded and a deployment
that generates nothing are different facts.

## Both surfaces, one projection

`projectOperations` is called by the workspace panel and by
`relay project operations`. Neither computes a figure of its own — the CLI's
`--json` output IS the view object, asserted by identity rather than by
equality, because a CLI that reshaped it would be a second implementation
waiting to disagree with the website's. Two people reading different numbers off
two screens in the same conversation is the failure a parity contract exists to
prevent.

## Tokens and cost are CITED, not recomputed

The view names six things. Four are modelled here; tokens and money already had
a careful model next door — receipts with statuses, cost classes, sources and an
explicit unknown discipline — so `spend-citation.ts` reads that model and
reports it. It does not add up a second opinion, because two summations of the
same receipts eventually disagree and both look equally plausible on screen.

What it refuses:

- **An unknown amount is never a zero.** A pending receipt has `amount: null`;
  it is counted as cost-not-yet-known and the count is printed beside the total,
  so a small total cannot be read as a cheap run.
- **Estimated is never added to actual.** A projection and a bill are different
  facts, reported in separate rows.
- **A voided or disputed receipt is not spend.** Counted and excluded, never
  silently dropped. Its TOKENS are still counted: the tokens were spent
  whatever later happened to the receipt.
- **A refund is not dropped.** `adjustment` is the one category permitted a
  negative amount, so it is how a credit or a correction is recorded. Excluding
  it made every refund invisible and every total too high.
- **Nothing leaves the total silently.** A receipt excluded by category — human
  time, chiefly — is counted in `excludedByCategory`, and an amount that exists
  but cannot be parsed is `amountUnreadable` rather than being folded into
  `amountUnknown`, which means "no amount yet".
- **Currencies are not mixed.** Per-currency totals; no invented conversion.
- **A fixture is never a bill.** `development_fixture`-sourced receipts are
  counted and labelled.

Arithmetic is `bigint` throughout, on the exact integer strings the receipts
carry. `Number(micros) / 1e6` loses exactness above 2^53 and loses it
invisibly — and a token count of 9007199254740993 must not print as
9007199254740992. Display rounds half away from zero on the integer rather than
truncating: truncation printed 999999 micros as `0.99`, understating every total
by up to a cent while looking exact.

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

## The first producer

`shared/llmops/run-observation.ts` turns a finished run into operational signal;
`connectors/claude-code/run-observation-adapter.ts` classifies a real
`ClaudeRunOutcome` and hands it over. The split is not cosmetic: `shared/` may
not import a connector in any file that ships, so a mapping written beside the
projection could only ever live in a test — where the boundary rules exempt it,
and where nothing could use it.

**Elapsed time is only a LATENCY when the thing being timed ran.**
`ClaudeRunOutcome.durationMs` is not nullable — the harness always measured
something — so falling back to it unconditionally gave a process that never
started a "total latency" of two milliseconds. A completed run and a timed-out
one both spent that time working, and their elapsed time is a latency.

The timed-out sample is right-censored at the configured runtime limit, so a
population of timeouts piles at that constant and moves when somebody tunes it.
Excluding them would be worse — the slowest runs are exactly the ones that time
out, so dropping them would make a degrading system show IMPROVING latency. A spawn
failure and a cancellation did not, and contribute no sample at all.

The provider's own `duration_ms` is preferred where it exists, because the
harness's clock includes spawn and teardown. Both are checked for usability
rather than nullness: `??` does not fall through on `NaN`, so a garbage provider
figure used to discard a perfectly good harness measurement.

**Failures stay distinct, in the order the shipping classifier already uses.**
`event-normalizer.ts` ranks them cancelled > timedOut > spawnError > isError,
and the adapter matches it exactly. Two producers that disagree about what one
run WAS put two vocabularies into one record, which is what the single-producer
rule exists to prevent — and the first version broke it by ranking `spawnError`
first, on the reasoning that a process which never started cannot have timed
out. `spawnError` does not mean that: it is set from `child.on('error')`, which
Node also emits when a process cannot be KILLED, and the connector's own event
says "failed to start OR RUN". So that order reclassified a real timeout whose
SIGKILL failed as a workspace failure and discarded its latency.

Both co-occurrences are reachable: the watchdog sets `timedOut`, then the kill
grace window leaves the run cancellable for several more seconds. An operator
who cancels a hung run in that window has not run a failed provider attempt.

**A cancelled run is not an attempt.** It is not a trial of the provider, and
counting it would raise the error rate's denominator while never raising its
numerator — quietly reporting a system as more reliable the more often somebody
interrupted it. Everything else counts one.

It is not invisible, though. A cancelled run carries its `observedAt` into the
record even with no latency and no error, because without it a project somebody
is interrupting all day would be byte-identical to one nobody is using, and
health would report that nothing had been observed. What it does NOT record is
the provider time and money a cancelled run still consumed — that belongs to a
receipt, and no receipt producer exists yet.

**An unrecognised termination becomes an `unknown` error**, never silence.
Producing no error while still counting the attempt deflates the rate, and the
intake already holds the rule this follows: the count of `unknown` is itself the
signal that a case is missing.

Its test fixture carries every field `ParsedStreamState` and `ClaudeRunOutcome`
require, with **no cast**. The first version cast through `as unknown`, which
hid six missing required fields and would not have failed on a seventh — so the
claim "proven against the connector's real types" was worth less than it
sounded. Without the cast, a new required field breaks the file, which is the
whole reason to test against the real type rather than a hand-drawn shape.

## The store

The producer reads one run; `operational-store.ts` accumulates them. That is the
difference between a model and an instrument — until something folds
observations together across runs, every surface can only truthfully report that
nothing is being measured, and both of ours did for two milestones.

**It never claims durability it does not have.** The backing declares itself
`durable` or `volatile-test-only`, and the store carries that label out
verbatim. A dashboard that survives nothing while implying it survives
everything is worse than no dashboard.

**It is bounded, and says what it dropped.** The most recently RECORDED 500
latency samples and 200 error events are kept — "newest" by arrival, not by
timestamp — and every eviction is counted into `droppedLatency` /
`droppedErrors`. Both surfaces render both counts. A percentile over a truncated
window is a percentile OF THE WINDOW: a reader who knows four thousand samples
fell off the end reads it as recent history, and a reader who does not reads it
as the project's.

**A bound must not corrupt a figure.** Capping the error LIST while `attempts`
kept growing reported ten thousand failures out of ten thousand attempts as a
**2% error rate**, and let a project evict its way from `failing` to `healthy`
by failing more. Every error ever ingested was either KEPT or DROPPED, so `kept + droppedErrors`
is not an estimate — it is exact, and the record already carried it. The count
is that sum, or the record's own counter where that is larger. Consulting only
the counters left the original defect intact on any record without them: 200
kept and 5000 dropped still reported 200 errors, 3.85% where the truth was 100%,
and `degraded` where the truth was `failing`.

**Unrecovered has no such bound, and says so.** `droppedErrors` counts
evictions, not how many of them the run survived. On a record carrying no
counter it is a FLOOR, `unrecoveredIsExact` is false, and health declines to
claim every error was recovered — a claim about errors the record can no longer
see.

**A write says when it replaced something.** Bytes that cannot be read are
overwritten — a record nobody can parse helps nobody — but `replacedUnreadable`
marks it, because doing it silently means the loss is mentioned nowhere.

**A read has three answers, not two.** `null` means nothing has been recorded;
`null` with `unreadable` means bytes exist that could not be read as this
project's record; `ok: false` means the backing could not answer. A record
written by an earlier build is repaired on read rather than trusted — a missing
counter would otherwise become `NaN`, and `NaN > 0` is false, so the disclosure
would silently disappear instead of obviously breaking.

**A failed read is not a project with no data**, and a failed write is returned
rather than swallowed. `null` from a read means nothing has been recorded; an
`ok: false` means the store could not answer, and those are different sentences.

**Two runs finishing at once do not lose one another.** Read-modify-write over a
key/value seam is last-write-wins, so writes through one store instance are
serialised per project. Twenty concurrent observations all survive; without the
chain, nineteen are lost and the record keeps one. `concurrencyScope: 'process'`
is the honest limit — two PROCESSES writing the same project are not protected,
and nothing here can make them so without a compare-and-set the seam does not
have.

## Not implemented

**Nothing calls `observeClaudeRun` on a live run.** The producer is proven
against the connector's real types; the store and both surfaces are proven
against the domain's. What is
missing is the CALL — a run handler that observes its own outcome and records
it, and a host that reads the record back into `operationsView`. Until that
exists both surfaces truthfully report that no operations source is wired,
because none is.

Receipts still have no producer either, so `spend` remains `null` in every
shipped host. The CLI's `brain` view generates a document from an empty memory on
every invocation, which is why it truthfully reports that nothing has been
recorded. The functions
exist and are tested against fixtures; no adapter, run handler or bridge invokes
them, so no live run is being measured and `spend` is `null` in every shipped
host. Both surfaces say so in those words rather than rendering zeroes. Token counts are modelled by `mission/economics` receipts
(`input_token`, `output_token`, `cached_input_token`) and are cited from there
rather than duplicated here. There is no persistence for short-term memory, no
UI for approving a promotion proposal, and no scheduled refresh of the Brain
document; `refreshBrainDocument` is a pure function and something still has to
call it.

None of that is blocked on a founder action. It is simply not built yet, and
this file will say so until it is.
