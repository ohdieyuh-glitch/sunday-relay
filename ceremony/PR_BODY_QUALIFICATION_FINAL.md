# Julius: the continuous-worker qualification's last eleven changes, landed together

This PR carries eleven frozen, worker-authored candidates on top of trusted main `62030242` (#263). Every commit is authored and committed by `julius-worker[bot]`. The six from the original fourteen are the rehearsed candidates, applied in the rehearsed landing order with the documented resolutions; the other five were written and verified in this session. The tree equals the stack that passed typecheck, the harness check and 634 of 636 qualification-critical tests locally; the two failures are the known Windows-only cases and also fail on untouched main.

## Why they land together, and why before the paid run

Paid lab run 34739303313 (Mission 4 A/B, main 0845c593) FAILED at the build: every allocation was `ESTIMATE_NO_LEDGER` at 300000 µ$, because the PostgreSQL store on main has no `timeline`, so the Coding Agent was stopped by its own $0.30 `maxBudgetUsd` after two turns. `julius-continuous-1` would have failed identically. `live-timeline` repairs that; `guidance-delivery` is required for the qualification's guidance leg; `coder-stream-usage` is required for the paid receipt to carry the coder's tokens. Found by the Live Evaluation Lab session and verified here.

## The commits, oldest first

### Julius: what a paid run leaves behind when it ends

Two findings, one sentence: facts a boundary already had in hand did not reach
the rows a reader opens afterwards.

THE TERMINAL ROW COULD NOT SAY WHY (finding C).

`JuliusExecutionOutcome`'s failure arm was `{status, code, failureClass?}`. The
coordinator flattened the adapter's diagnostics onto its OWN `retry.scheduled`
and then had nowhere to put them — so when a run's autonomy declined a retry,
`julius-task-pipeline` wrote the terminal `task.failed`, the row that ENDS the
task, with five fields and nothing about the provider. Not an omission at the
call site: the type gave the pipeline nothing to write.

What was lost is what the next decision needs. A coder that times out has
usually already spent money, and `costUsdMicros` is in those diagnostics; so is
the served model, the response id, the tokens, and the failure class beneath the
code. All of it sat one event earlier under a different type, where a reader
asking "why did this paid mission end" does not look.

The arm now carries `diagnostics`, already flattened and sanitised, and the
pipeline spreads it onto that row. The key is ABSENT when the boundary reported
none, because absent and empty are different claims and an always-present `{}`
would change the shape of every outcome with nothing to say. The `diag_` prefix
`flattenDiagnostics` applies is what makes the spread safe: no carried key can
collide with `code`, `reasonCode`, `awaitingHuman`, `failureClass` or
`errorRetryable`, which are Julius's own and not an adapter's to overwrite.

THE SUCCESSFUL RUN LEFT THINNER EVIDENCE THAN THE FAILED ONE (finding E).

`planDiagnostics` takes eighteen optional fields and six call sites each chose a
subset by hand. Only ONE — the connector-failure path — passed the whole
provider picture.

The three REFUSAL sites (unparseable JSON, guidance invalid, plan invalid)
passed no tokens at all, so a plan that was BOUGHT and then thrown away recorded
nothing about what it cost. Both SUCCESS sites omitted the elapsed time, the
provider's status, the total and reasoning tokens, and the ceiling in force.
That is the wrong way round: the paid proof reads the run that worked.

One constructor, `providerFacts`, now builds every fact the provider's own
answer carries, and all six sites spread it. Nothing here is new information —
every field was already on the outcome and already in scope at every site. What
was missing was a reason a site could not quietly report a subset.

CACHED INPUT WAS READ AND NEVER RECORDED, ANYWHERE.

`GptUsage.cachedInputTokens` has always been populated from
`input_tokens_details.cached_tokens` and reached no diagnostic on any path.
Cached input is billed at a different rate, so a row carrying `inputTokens`
alone reports a quantity at one price when part of it was bought at another.

Adding the column upstream turned out to be one THIRD of the repair. A
diagnostic reaches a reader through three layers, and this field was missing
from two of them:

  emit      live-workers.ts builds it            — added here
  admit     safeReviewDiagnostics's allowlist    — a field absent here is
                                                   dropped on its way to the
                                                   durable record without a word
  export    julius-live-evidence-dump.sh         — a key absent here is written
                                                   durably and destroyed with
                                                   the database

Each gap was caught by a guard rather than by inspection. The allowlist gap fell
out of these proofs: the success case reads the adapter's return DIRECTLY and
passed, while the refusal cases read it back through `JuliusDispatchError` —
which sanitises — and did not. The export gap was caught by the completeness
guard the previous evidence repair installed, which is the first time that guard
has refused a change other than its own.

WHAT IS DELIBERATELY UNCHANGED. A call that never reached the provider still
reports null for every provider number, never zero: nothing was observed, and
the one kind of unknown this system may not manufacture is the kind it created
by discarding an answer. A success still reports `incompleteReason: null`,
because a success is by definition not incomplete.

Twelve proofs, provider-free: the connector is replaced by a scripted outcome,
so nothing is contacted and nothing is spent. Six drive the real adapter through
every ending it has — validated, unparseable, invalid, and a call that never
landed — with every usage number distinct, so a field populated from the wrong
one cannot pass by coincidence. Two are structural: every `planDiagnostics` call
spreads the constructor, and the constructor reads each token from its own
field. Four hold the coordinator-to-pipeline hand-off.

The structural guard is brace-matched rather than pattern-guessed. A capped
regex found four of the six sites and stopped, because the two longest arguments
outran the cap — a guard silently covering less than it claimed, which is the
same fault as the vacuous `toContain` that shipped in the last evidence repair.

Thirteen adversarial mutations, thirteen killed, no survivors: a success site
and a refusal site each dropping the spread; `cachedInputTokens` read off
`inputTokens` and `totalTokens` off `outputTokens`; a success claiming an
incomplete reason; `providerStatus` never reported; a call that never landed
reporting zero instead of null; `cachedInputTokens` dropped from the allowlist;
the coordinator dropping the carried facts on the retry return; an empty set
reported as `{}` rather than absent; the pipeline dropping the spread; the
`diag_` prefix removed so a carried key can collide; and the export column
removed, so an allowlisted key is written durably and dies with the database.

No provider was contacted. No mission spent anything.

### Julius: the coder knew what it had spent and the parser never asked

Paid run 34485676189 attempt 1 was cut off by Relay's own abort timer at the
360 000 ms runtime ceiling, twelve tool calls in. Its record says the cost, the
input tokens and the output tokens are all UNKNOWN, and the comment beside it in
`coder-envelope.ts` states the consequence plainly: we paid and cannot say how
much.

That was true about the cost and false about everything else.

THE RUNTIME REPORTS ITS TOTAL IN THE TERMINAL `result` MESSAGE, which an aborted
run never reaches — so `foldHostedMessage`, which read usage only from that
message, had nothing. But every assistant turn in the stream had already carried
its own usage block the whole time: `SDKAssistantMessage.message` is a
`BetaMessage`, and `BetaMessage.usage` is a REQUIRED field with `input_tokens`,
`output_tokens`, `cache_read_input_tokens` and `cache_creation_input_tokens`.
Relay read none of it and discarded all of it. "The runtime reported nothing"
was a fact about this parser.

`HostedStreamUsage` now folds those turns as they arrive.

IT IS A FLOOR AND IT STAYS ONE, which is most of what this change is about. The
sum over observed turns is a LOWER BOUND on what the run consumed. It is not the
runtime's total: on a completed run both exist side by side and neither
overwrites the other. It carries no cost, in its values OR in its type — an
assistant turn reports tokens and never dollars, and a cost field nobody
populates yet is an invitation to populate it. And no basis is derived from it:
`costBasis` stays UNKNOWN on exactly the runs the floor now describes, so the
ledger keeps holding the reservation instead of settling against a number nobody
billed.

UNKNOWN IS STILL NOT ZERO. A component no turn reported stays null rather than
becoming a sum of nothing, and an empty floor is `messages: 0` with every token
total null — zero turns is a true statement about how many were seen, zero tokens
would be a false one about what they consumed.

The runtime's own word for what Relay's timer did is recorded too: the SDK marks
an interrupted turn `aborted`, and those are counted separately from the turns
that completed.

ALL THREE HOPS, because the last time one was missed it cost a landing. The
observation folds it, `safeReviewDiagnostics` admits all six columns, the shared
`hostedCoderDiagnostics` builder sets them once so the success and failure paths
cannot drift, and `worker-diagnostics.tsv` exports them — which the completeness
guard from #254 checks in both directions on its own.

Twenty-one proofs, including the finding itself reconstructed: the stream paid
run 34485676189 attempt 1 would have produced, driven through the REAL coder
adapter to a real `JuliusDispatchError`, asserting both halves — the floor is
there, and the money is still UNKNOWN.

Eighteen adversarial mutations, eighteen killed, no survivors: an unreported
component zero-defaulted; the empty floor reading as zero tokens; user messages
counted; the fold placed after the content guard, which would have dropped the
last turn of a cut-off run — the most interesting one; aborted turns uncounted,
and a usage-less aborted turn dropped; a turn with no usage block counted anyway;
the floor overwriting the runtime total; the floor filling the runtime-total
column; the floor settling the cost basis; the floor gaining a cost field; each
column dropped from the builder, from the allowlist, and from the dump.

Three survived their first run and each pointed somewhere real. Two were
equivalent as written — an added key the allowlist drops, and a type field nobody
populates — and were rewritten to actually bite. The third gated the fold on "no
result yet", which no SDK stream can distinguish today; rather than leave it, the
fold is now proven ORDER-INDEPENDENT, which is the property that mutation was
really about.

The historical row keeps its null. The instrumentation postdates it and there is
no bundle to read the floor back out of; what it has now is an accurate note
saying why.

No provider was contacted. No mission spent anything.

### Julius: a paid retrieval could vanish, and the record would not have noticed

`driveResearchCheckpoint` awaits `deps.research.serve()` and appends its
`research.retrieved` rows afterwards. The mediator's own settlement — the thing
that looks like the accounting — is an in-process Map that writes nothing
durable. So between the retrieval returning and its first row landing there was
a window in which a process that died had SPENT with nothing at all on the
record.

I THOUGHT THAT WINDOW COST TWO RETRIEVALS AND IT COSTS ONE. The obvious reading
is a double charge: the restart asks again and pays twice. It does not. The
checkpoint is driven from `driveContinuousLifecycle`, once, guarded by
`!outcome.duplicate`, after the dispatch that asked has already ended and its
task is SUCCEEDED. Nothing re-enters it. The reproduction says the same thing:
served once, no rows, a restarted drive serving zero.

So the retrieval is simply LOST. Bought, unrecorded, its answer never delivered,
the continuation never minted, and the mission carrying on as though it had
never asked. The durable ledger — rebuilt from rows, and the only budget that
survives a restart — then counts one retrieval fewer than were bought. A budget
that over-counts is pessimistic; one that UNDER-counts can be exceeded.

AND NOTHING SAID SO, which is the part this repairs.

`research.attempted` is written before a socket can exist, carrying the
checkpoint's own id, the slot and how many asks were in flight. The charge rows
carry the same key. So an attempt with no charge beside it IS the loss, visible
in the bundle rather than inferred from a gap nobody can see, and
`research.tsv` exports it.

WHAT IS DELIBERATELY ABSENT. No re-entry guard. An earlier guard in this exact
place compared the CONTINUATION's id against the durable task rows and was
removed because it could never fire — `nextSegmentNumber` is the highest
existing segment plus one, so that id is new by construction. I built one that
asked the answerable question instead, and then the reproduction showed there is
no second serve to guard: it would have been the same mistake in a new place,
with a comment claiming a protection nothing performed. It came out. A proof
asserts its reason code appears nowhere in the pipeline, and another asserts the
`!outcome.duplicate` gate that makes the absence correct — so if that gate ever
goes, a replayed result WOULD buy a second retrieval and this file says so.

Sixteen proofs. The window reproduced by failing the append of the first charge
row, which is what a process dying there leaves behind: served once, paid for,
no charge, no continuation, and the attempt standing alone. A transport that
dies holding the answer leaves the same record. A healthy run pairs its attempt
with the charges it produced. The attempt is written BEFORE the retrieval, or it
could not be the scar. The run still reaches an ending rather than stalling on
an answer that is never coming.

Eleven adversarial mutations, eleven killed: the attempt row never written, or
written after the spend; the key becoming its own identifier rather than the
checkpoint's; the charge no longer naming its attempt; the ask count
understated; the `!outcome.duplicate` gate removed; the event type
unregistered; the dump forgetting the rows and then the key; the comment
claiming exactly-once; and an unreachable re-entry guard coming back.

This is not exactly-once and no passage in it says so. The window is not closed
— closing it needs the retrieval keyed and deduplicated at the transport, which
Live Reach has no identity for. What changed is that the loss is now recorded
instead of silent, which is what made it impossible to notice.

No provider was contacted. No mission spent anything.

### Julius: the architect's advice never reached the worker it was written for

A guidance packet was stored as an artifact. Its only consumer in this
repository is the Independent Reviewer, so it could judge the advice. The Coding
Agent that asked the question was handed nothing.

What the coder's continuation actually carried was `brain:segment-resume` —
what the coder itself said before it paused. A mission could buy an architect
dispatch, buy a review of its output, mint a continuation blocked on the
architect so the coder could not proceed without the answer, and then resume
that coder without the answer. The packet's own type calls its `taskId` "the
task the guidance is FOR — the coder's task". That task never saw it.

The comment that used to sit at the issue site said the text "travels to the
coder the way the plan does — as an artifact the composition owns". The plan has
a reader in the coder adapter. This did not. I checked every path that could
have closed it: the context compiler, the context snapshot, the coder adapter's
prompt, and any store read for a packet. There was none.

RESEARCH ALREADY CLOSED THE SAME LOOP, twenty lines away.
`brain:research-answer:<continuation>` puts the observations on the
continuation's own Project Brain channel, under a comment saying the answer
travels "exactly as the architect's question does". The architect's QUESTION had
that channel. Its ANSWER did not.

So guidance now travels the same way: one Project Brain, one redaction path, one
provenance record, no prose side channel. `renderJuliusGuidanceHandoff` is the
domain's, bounded at 6,000 characters, and a cut SAYS SO — advice silently
truncated would leave a coder reasoning from a packet it believes it read in
full. It leads with what it is: the Mission Contract is unchanged, nothing below
widens it, and a prohibition here only ever narrows. It ends with what the
architect could NOT settle, which is the part a coder most needs to know it is
deciding for itself.

WHO IT REACHED IS ON THE ROW. `deliveredTo` on `guidance.issued` names the
continuation, or is NULL when none was waiting — advice nobody can read is a
fact about the run, and an absent field would be a third state a reader cannot
tell from either.

THE CONTINUATION IS FOUND, NOT COMPUTED. `pendingSegmentFor` reads the rows for
the BLOCKED segment waiting on the guidance task — which is the edge the barrier
actually is, and not the subject the research barrier waits on. Two waiting
segments is a shape nobody has built and resolves to null rather than to a
guess, because picking the likelier one would be Julius deciding which pause an
answer belonged to. The revision is in the entry id, because `appendBrainEntry`
is idempotent per id and a revised packet would otherwise be silently dropped
while the record said a second was issued.

AND THAT IS WHY `guidanceConsumed` WAS UNKNOWN. Two existing proofs said so in
as many words — "nothing in the runtime knows it. The guidance packet is never
compiled into any dispatch's context, so there is no point at which this
dispatch consumed N packets is a fact." That was true, and it was a statement
about a packet nobody delivered rather than about a dimension nobody could
measure. It is now counted off the entries the compiler ADMITTED, beside
`brainRetrievals`, so a packet whose budget dropped the advice reports carrying
none — the truth about what the worker was shown. The number is a consequence of
the delivery, never a column filled in to look complete.

Twenty-one proofs: the delivery, its recipient, the null case reached through a
real segment ceiling, the waiting-segment lookup, the rendering and its
truncation, and the measurement.

Fourteen adversarial mutations, fourteen killed: the advice never delivered, or
delivered to the subject instead of the continuation; the revision dropped from
the entry id; `deliveredTo` absent instead of null; the lookup using the subject
rather than the guidance task; two waiting segments resolved by guessing; a
SUCCEEDED segment or a non-segment task counted as waiting; `guidanceConsumed`
hardcoded, or returned to absent; the unresolved questions dropped from the
handoff; the contract disclaimer removed; truncation made silent; and the
handoff unbounded.

One survived and its proof was vacuous: the null-delivery case ran a rig that
issued no guidance at all, so a loop over zero rows passed whatever the field
did. It now reaches the segment ceiling, asserts exactly one issued row, and the
mutation dies.

Two existing proofs were REPAIRED rather than deleted, and both are the honest
record of what changed: the dimension nothing can measure is now one rather than
two, and `checkpoints` keeps its reason.

The #254 completeness guard caught the third hop on its own — a new fact on the
effort row that the bundle would have destroyed with the database. Both new
facts are exported.

WHAT THIS CHANGES ON A PAID PATH, said plainly: the Coding Agent will be shown
advice it currently is not. Nothing new is authorised; a packet that was already
written, already paid for and already reviewed now reaches its reader.

No provider was contacted. No mission spent anything.

### Julius: the live store could not read its own ledger, so two guarantees were not in force

`JuliusTimelinePostgresRepository` implements `JuliusTimelineReader` against the
real events table. Its only references in the repository were its own
declaration and the barrel that exports it. Nothing in production constructed
it.

That mattered because BOTH consumers of a timeline reader are bound behind a
structural probe — `typeof store.timeline === 'function'` — and
`createJuliusPostgresRuntimeStore` returned no such method:

THE RESEARCH METER. `durableLedger` rebuilds a slot's retrieval spend from the
run's own rows. Unbound, the mediator keeps an in-process Map, so a bridge
restart forgets what every slot has already spent. That is the exact defect the
durable projection was built to close, and the projection was never reached in
production — so "research consumption is restart-durable" was true of the code
and false of the deployment.

THE MONEY LEDGER. `deps.timeline` is what `projectSlotLedgerFor` reads
`budget.reserved` and `budget.settled` from. Unbound, allocation v3 falls back to
counting rounds off the task rows: a lower bound that cannot tell an open
reservation from one settled for less. The fallback is correct and says so in its
own basis; reaching it in production was not the plan.

WHY NOTHING CAUGHT IT. This file's own comment leans on the store conformance
test — "if a port method is added without a repository implementing it, the
conformance test fails." That is true and it cannot apply here:
`JuliusTimelineReader` is not part of `JuliusRuntimeStore`, so there was no
required port to be missing. A conformance test proves the REQUIRED surface and
is silent about an optional capability, which is exactly the kind that gets
dropped.

THE HARNESS MAP HAD RECORDED IT. `scripts/export-julius-harness.mjs` carried the
file in its "not composed" list with the reason "a read model no live surface
consumes yet" — an accurate note about a real gap, kept as a deliberate
declaration rather than read as a defect. The export refuses a declaration for a
file a root actually reaches, so binding it failed the harness check until that
line came out. That refusal is why the map can be trusted.

THE CAPABILITY IS IN THE RETURN TYPE, not left to the probe. A probe fails
quietly; a declared method that goes missing fails at the type. That is what
makes the next optional capability impossible to drop the same way.

Fourteen proofs across two files: the method exists on the composed production
store, it is in the signature, it is the real repository rather than a stub that
would answer empty — binding an empty reader would be worse than not binding,
because it would rebuild every ledger as zero while the honest fallbacks at
least report themselves as conservative — the handoffs wrapper the entrypoint
composes does not drop it, both consumers are still behind the probe, neither is
behind a literal, the projection still refuses rather than inventing when
nothing is bound, and the harness map now carries the file as production.

Six adversarial mutations, six killed: the timeline unbound; bound but absent
from the return type; a stub answering empty; the handoffs wrapper rebuilding
instead of spreading; each consumer's gate replaced by a literal.

One survived and its proof was too weak to see it. "The research ledger gate is
removed" passed because the proof asserted the probe string appeared SOMEWHERE
in the file — and the probe appears once per consumer, so removing one left the
other to satisfy it while that consumer became unreachable. Both sites are now
counted and each is matched to the consumer that follows it, and a companion
case refuses a `...(false` or `...(true` spread outright: a capability bound in a
branch nothing takes is the whole failure mode this file exists to prevent.

No behaviour changes for any mission that does not research or allocate — the
fallbacks were already correct. What changes is that the durable paths are
reached.

No provider was contacted. No mission spent anything.

### Julius: the architect's declared deadline was never resolved from the environment

One environment variable, two architects, and a deadline declared from the
fallback rather than from the answer.

`RELAY_PROMPT_ARCHITECT_TIMEOUT_MS` and `RELAY_PROMPT_ARCHITECT_MAX_TOKENS` are
each read by TWO modules, and the two disagreed about what an unset environment
means:

  src/relay/connectors/gpt-architect/config.ts   300_000 ms   4,000 tokens
  relay-bridge/openai-architect.ts                90_000 ms   1,200 tokens

Both pairs arrived in one commit, 97106c56, and neither referenced the other.
The VALUES are defensible — Julius's connector asks for a full plan, the bridge
path for one compact handoff, and a smaller answer needs less wall clock — so
this keeps both and pins both rather than unifying them.

WHAT WAS NOT DEFENSIBLE, in three places.

FIRST, THE DECLARATION. `ARCHITECT_WORKER.timeoutMs` read the connector's
`DEFAULT_TIMEOUT_MS`. The number that actually cuts an architect call off is
`readGptArchitectConfig(env).timeoutMs` — `runGptArchitect` hands it to the
OpenAI client — and the variable moves it. So the declared and the operative
deadline agreed under the empty environment and under no other, which is
precisely the declared-versus-operative drift `reviewer-deadline.ts` was
written to end, surviving one role over underneath a comment claiming it had
been ended. `ARCHITECT_WORKER` is now `architectWorker(env)`, a function of the
environment exactly as `reviewerWorker` is a function of the provider, and the
composition builds ONE worker object for both the registration and the adapter.

SECOND, THE JOB BUDGET. `coder-envelope.test.ts` modelled the architect's
worst-case share as `DEFAULT_TIMEOUT_MS * 2`: the same fallback, times a
literal attempt count. Raising the architect's real deadline in the workflow
would have raised the real worst case while the proof that the four shares fit
inside `JOB_BUDGET_MS` stayed where it was and kept passing — the reviewer's
Mission 4 failure in miniature, a model compared against a window with both
agreeing while the real thing ran past them. The share now comes from
`architectWorstCaseSpendMs(env)`, resolved from the workflow's OWN `env:` block
through the same resolver the adapter uses, times the worker's own
`maxRetries + 1`.

THIRD, AND THIS ONE WAS NOT HYPOTHETICAL: `.env.example` SET both variables, to
the bridge demo path's numbers. Any environment copied from this repository's
own example therefore handed JULIUS a 1,200-token ceiling and a 90 s deadline
without saying so. A plan truncated at 1,200 tokens is the incomplete-plan
failure that has already cost one paid run and its diagnostics carry an
`incompleteReason` field because of it. Both lines are now commented out, with
both envelopes stated, so each path uses its own default unless an operator
deliberately moves both.

AND THE TWO PATHS DISAGREED ABOUT MALFORMED INPUT TOO. The bridge's
`architectPreflight` refused a non-positive bound and named the variable; the
connector coerced it to the default and said nothing, so an operator who asked
for something got something else in silence. `GptArchitectConfig` now carries
`unusable` — the NAMES of variables that were set to something unusable, never
their values — and `evaluateReadiness` refuses and names them, the same
fail-closed-and-named contract the composition root states at its top. Absence
is still not a fault: nobody asked for anything, so nothing was ignored.

DELIBERATELY NOT CHANGED. The four default values, which are proportionate to
the two different answers. The configuration surface: splitting the variable in
two so one path can be tuned without the other is a real option and a real
config change, and it is not smuggled in here. The coupling is instead stated
at both definitions, in `.env.example`, and asserted by a proof that shows one
variable moving both paths.

Thirteen proofs. Four sweep environments that actually SET the variable, because
under the empty one every broken version of this code is indistinguishable from
a correct one — which is exactly how the previous repair of this same file
shipped an architect assertion that could never have observed the drift it was
named after. One proof enumerates every reader of both variables across
`git ls-files` and pins every default, so a third reader with a fourth default
cannot appear unnoticed.

Thirteen adversarial mutations, thirteen killed, no survivors: the declaration
back to the fallback and back to a literal; the composition resolving the
environment twice; each of the four defaults silently unified; a bare literal
back at a read site; a third production reader; the connector defaulting an
unusable bound again; absence treated as a fault; an unusable value reaching the
client as the number itself; and `.env.example` setting the demo envelope again
or teaching only one of the two.

Two further mutations are EQUIVALENT under a workflow that sets no architect
deadline — hardcoding the budget share, and loosening the workflow reader to
match a commented-out line — so they are run as four differential pairs instead,
each pair holding one configuration with and without the repair. All four
behaved as specified: a workflow that over-allocates the architect fails the
budget proof, the hardcoded share is caught too, a commented value is ignored,
and a reader loosened to match it is not.

No provider was contacted. No mission spent anything.

### Julius: a provider hiccup ended the reviewer's task for good, on the only path Julius uses

`review_service_unavailable` is the reviewer's retryable shape, and the mapping
in `live-workers.ts` explains why it exists: capacity clears as runs finish and a
drain ends when the deploy lands, so neither is a verdict and neither needs a
human first.

That shape was produced by `hermes-remote-review.ts` and by nothing else. The
LOCAL path — the one `createLiveHermesReviewerAdapter` actually runs, and the
only reviewer the live Julius composition has — answered EVERY upstream status
with `review_provider_http_error`, which is final. Driven with a real review,
429, 500, 502, 503 and 504 all classify identically: the status reaches the
diagnostics and never the verdict. So one provider condition was a transient
blip down one transport and a dead review down the other, and the reasoning
attached to the retry governed a shape the live path could not reach.

The qualification's own shape dispatches the reviewer FIVE times — plan, build,
guidance, and both continuation segments. Five chances for one 503 to end a paid
mission that had already bought a plan, a lock and a build.

ONE LIST, READ BY BOTH TRANSPORTS. `HERMES_TRANSIENT_UPSTREAM_STATUSES` is 429
and 503, exactly what the remote path has always treated as transient, and the
remote path now reads it instead of its own literals. 500, 502 and 504 stay
final on purpose: nothing observed says they clear by themselves, and widening
the set on a hunch would spend a paid dispatch to find out. An authentication
refusal is untouched and still needs a person.

TWO EXISTING CASES PINNED THE OLD ANSWER and are corrected rather than deleted.
Both kept properties worth keeping — that an upstream failure is NAMED rather
than falling through to an unreadable shape, and that the status survives
whichever class it lands in — and both happened to use a 503 or a 429 as the
example, which recorded the defect alongside the property. The properties are
unchanged; the examples now use a status that really is final, and a new case
states the distinction directly.

Proven by driving the real runner over a fake process, at the adapter seam
through the real reviewer adapter, and on the remote path against the shared
list so the two transports cannot come to different answers again. Five
mutations, all killed.

WHAT THIS DOES NOT DO. It does not change how many attempts a review stage gets.
The founder's rule — one task attempt per normal review stage rather than the
generic ceiling of three — is not implemented anywhere, and reading the pipeline
suggests a reviewer that ANSWERS already gets exactly one attempt, because an
answered review succeeds and is never re-dispatched. Whether the rule asks for
something beyond that is a question about intent, not about code, so it is left
alone here rather than guessed at.

### Julius: a transient provider status reached a pipeline with no attempt left to spend on it

`review_service_unavailable` is the reviewer's retryable shape: a 429 or a 503,
capacity that clears as runs finish, a drain that ends when the deploy lands.
`relay/julius-reviewer-transient-upstream` made the live path produce it. And
`relay/julius-reviewer-envelope` gives a review stage exactly ONE pipeline
attempt, because a second task attempt re-asks the same packet against the
same wall and that is a blind retry.

Both are right, and together they left a hole: the retryable shape reached a
pipeline with nothing left to spend on it, so on the integrated stack the first
provider hiccup on any review dispatch ended the mission. The qualification's
shape dispatches the reviewer five times, and the transient-upstream candidate
said in its own message that the attempt question was "left alone here rather
than guessed at".

THE ADAPTER ASKS ONCE MORE, INSIDE THE SAME DEADLINE. Not a task retry: the
answer never arrived, so nothing paid for is thrown away. Bounded two ways.
ONCE — `REVIEW_TRANSIENT_REASK_LIMIT` is 1. And only when the declared deadline
still holds a whole review after what the first ask consumed:
`reviewerReaskWithinDeadline` reads the time the asks so far took off the
runner's own two instants, subtracts a fixed 5 s backoff, and allows the re-ask
only if what remains is at least the policy's own floor — the largest duration
it believes a review can need. The second engine run is handed the REMAINING
window, not the full one, so the adapter still stops before the deadline Julius
enforces around the dispatch. A pure function, proven at its boundary.

UNKNOWN IS NOT ZERO. A first ask whose duration cannot be established from its
own instants is refused the re-ask, and the transient failure surfaces exactly
as it did before this existed.

THE RECORD SAYS WHY. `reviewAttempts` already said how many calls a dispatch
bought; a count of two could not say whether the second was a correction of a
malformed answer or a re-ask after a full service. `reviewReaskShape` is the
closed shape token of the answer that caused the second call, on the allowlist,
in the evidence dump as `review_reask_shape`, and null when the dispatch asked
once.

A CANCELLATION WINS. A dispatch already aborted is not re-asked, and one
aborted during the backoff buys nothing more — the wait ends on the signal.

THE LIMIT IS AN INPUT ON THE ADAPTER, production never passes it. Under the
policy's own limit of one, nothing reads the consumed time after the one
backoff, so an accounting error there would have been invisible until the day
the limit changed. A proof drives two re-asks and observes that the third window
is the deadline less every ask AND every backoff.

ONE EXISTING CASE CHANGED, corrected rather than deleted. "A failure that is NOT
a shape defect is never re-asked" listed a 503 on the reasoning that it was
"already retryable at the TASK level, where the attempt ceiling governs". That
ceiling is now one. The timeout and the dead credential keep their single ask;
the 503 is re-asked once and a service still full after that is final, with
both calls on the record. Two other cases now assert the second call as well.

Thirteen proofs. Ten adversarial mutations, ten killed, no survivors: the
deadline check removed; the limit ignored; unknown consumed time read as zero;
the second run keeping the full window; the signal ignored; the backoff not
charged into consumed time; a cancellation during the backoff ignored; the
re-ask shape not recorded; the transient shape
widened to every incomplete review; and the default limit not the policy's
constant.

`JULIUS_HARNESS_MANIFEST.md` records one more edge from the live composition to
the bridge's provider stack: the adapter reading the deadline policy.

No provider was contacted. No mission spent anything.

### Julius: an early reviewer timeout is re-asked once, inside the same declared deadline

Found and first written by the Live Evaluation Lab session on this machine
(its commit 3e5240fa); verified independently, re-authored as the worker, and
landed here with the rest of the qualification's reviewer envelope.

THE FINDING, FROM THE PAID RECORD. Both of the last two COMPLETED paid missions
had a first review attempt time out and a second ask then complete it. Run
34470535718 (Mission 4): `plan:review` cut by Relay at 400 093 ms, completed on
the next ask in 381 880 ms. Run 34529874100 (Mission 5): `build:review` dead
after 94 200 ms — the engine's own 90 s request timeout, inside a 480 112 ms
window — completed on the next ask in under 209 s. Both completed because the
pipeline still granted a second task attempt.

THE GAP ON THE INTEGRATED STACK. `reviewer-envelope` grants a review stage ONE
pipeline attempt, on the reasoning that a repeated ask reaches the same wall.
`reviewer-transient-reask` then added a bounded in-adapter re-ask, but only for
`review_service_unavailable` (429/503); its own comment still called a timeout
"already retryable at the task level", which the first candidate had removed.
So on the stack `review_timeout` had no path at all: the shape the paid
reviewer path has shown most often became FINAL, after the coder had spent.
Mission 5's event, replayed on the stack, fails the mission.

THE REPAIR, NARROW. The policy names the shapes the re-ask answers
(`REVIEW_TRANSIENT_REASK_SHAPES`): the transient status, and `review_timeout`.
Same limit (one), same backoff, same rule: only when the remaining declared
window still holds a whole review. That rule is what keeps this from being a
blind retry of a window-cut review — a review Relay itself stopped has consumed
the whole deadline and is refused by arithmetic — so only a timeout the engine
raised early enough to leave a review's worth of window is asked again, which
is exactly the measured case. The record names it: `review_reask_shape` reads
`review_timeout`.

PROVEN: six adapter-level cases in reviewer-transient-reask.test.ts (the
measured 94 200 ms case re-asked and SUCCEEDED; a window-cut timeout refused; a
too-late timeout refused; the two shapes sharing one re-ask; unknown duration
refused; the policy naming exactly two shapes), and one end-to-end case that
drives the REAL runner over a child printing the engine's own timeout preamble,
then the real backoff, to a COMPLETED mission with `retry.scheduled` never
written. The hanging-reviewer rig is made faithful in compressed time: a hang
now reports the whole declared window consumed, as it does in production, so
"a reviewer that hangs is asked ONCE" still holds and is still proven.

### Julius: a mission granted research ran with every ask refused, because nobody observed the reach

`julius-continuous-1` grants governed research to all three slots, and the
qualification it exists for opens with the Prompt Architect investigating before
the contract locks. On the paid path none of it could happen. Live Reach refuses a
capability no backend has been OBSERVED serving, the entrypoint reads that
observation from `JULIUS_RESEARCH_OBSERVED_BACKENDS`, and the paid workflow never
set it. So every research ask would have been refused, the refusal routed CONTINUE
as designed, and the mission could have completed — a paid record proving the
opposite of what it was dispatched to show. Found by the Live Evaluation Lab
session and verified independently before this was written.

THE OBSERVATION IS MADE, NOT ASSERTED. The design is explicit that reach is an
operator's fact, not a contract's; a literal in the workflow's `env:` would be the
workflow vouching for a reach nobody looked at. A new entrypoint subcommand,
`observe-research --contract <path>`, parses the contract with the same parser and
research sealing `run` uses, and for every granted source, read capability and host
performs one side-effect-free GET of `https://<host>/` through `probeReachability` —
Relay's own bounded fetch and network policy, the path the retrieval itself takes.
The backend named is the registry's own first candidate, the same one
`LiveReachService.probe` reports. Only `observed` counts; an exception is
`unreachable`; the claim is deduplicated and round-tripped through
`observedResearchBackends` before it is printed.

FAIL CLOSED. Research granted and nothing observed exits 1 with
`research_unobservable`, and the new preflight step stops the job before the paid
step exists. No research granted prints `research_not_granted` and exports nothing.
Action capabilities and wildcard hosts are never probed.

THE WORKFLOW STEP runs on dry runs too — it contacts no model provider, so the free
preflight proves it — and writes to `$GITHUB_ENV` only when exactly one line matches
the anchored, closed-alphabet claim grammar. The evidence bundle keeps the
observation by allowlist, never as a raw log.

Proven: 23 cases for the subcommand, workflow structural cases for the step's
placement, ungated dry-run execution, the single-line export and the evidence
filter. Eleven adversarial mutations, eleven killed. Run for real against the
contract: `www.postgresql.org` observed through `relay_http_fetch`, claim
`relay_http_fetch:read_item`; Mission 5's contract reports no research granted.
`run` is byte-for-byte unchanged, including its usage line.

`JULIUS_HARNESS_MANIFEST.md` records one new edge: the entrypoint importing the
Live Reach fetch.

No model provider was contacted. No mission spent anything.

### Julius: one paid provider slot, one queue, one dispatch path

Paid Julius runs were serialised by one workflow-level concurrency group. GitHub
keeps exactly ONE pending run per group, so a third paid dispatch silently
CANCELLED the one already waiting, and nothing in the group knew that the
continuous qualification outranks a lab experiment. Two sessions dispatching at
once, or one CLI retrying after a TLS reset, could evict the qualification or buy
the same mission twice.

ADMISSION, NOT A CONCURRENCY PRIMITIVE. A new `paid-slot` job runs first on every
paid dispatch. It holds no secret and no environment, proves the checkout from the
pinned verifier exactly as the paid job does, refuses a malformed queue claim or a
lane the mission is not granted, and then waits in `scripts/julius-paid-slot.mjs`
until no other paid run holds the slot and it is first among the waiting under
(lane, created at, run id). Lanes: qualification > qualification-repair > lab >
regression. A waiting run is never cancelled and never preempts an admitted one; a
queued run proceeds by itself when the slot is released. An API error, a lagging
listing or an unreadable title resolves to WAIT; admission needs two PROCEED
readings fifteen seconds apart; the wait is bounded below the hosted-job cap. The
paid job `needs:` admission and keeps a job-level group as a second line. The
workflow-level group becomes per run.

A LANE IS A GRANT. `MISSION_LANES` in the contract checker says which lanes each
mission may claim — `julius-continuous-1` alone may take `qualification` — and
`--lane` refuses anything else before a provider can be reached.

ONE DISPATCH PATH. `scripts/julius-paid-dispatch.mjs` names each attempt
`<mission>@<main sha12>#<lane>#a<n>`, carried into the run title; dispatches nothing
if that attempt is queued or running; refuses a consumed attempt; requires a
successful preflight at the same main (dispatching and awaiting one if needed); and
after any failed dispatch call looks for the key before retrying, so a request
GitHub accepted and whose answer was lost is found rather than repeated. The
`paid-slot` job refuses a second run carrying an earlier run's key, so even a
client that bypassed this file cannot make one key spend twice.
`julius-paid-slot.mjs status` reports IDLE, QUALIFICATION_ACTIVE, LAB_ACTIVE, QUEUED,
PREFLIGHT_BLOCKED or PROVIDER_BLOCKED with the holder, queue order, SHA and pinned
models; PROVIDER_BLOCKED is claimed only from a read log.

PROVIDER READINESS, CHECKED FOR FREE. A new preflight step asks each provider's
model-metadata endpoint whether it accepts its key and serves the pinned model —
nothing generated, nothing billed — and fails the job on 401/403, 404 or an
unreachable provider. The key reaches curl only as a `--config` on stdin. Balance
is stated as UNKNOWN: no provider exposes a spend-free balance query.

A bug the proof caught while writing it: the first version set `failed=1` inside a
function run at the end of a pipeline — a subshell — so a refused credential would
have passed. The verdict is now read from the recorded result lines.

A PROVIDER THAT NEVER RECOVERS ENDS IN BOUNDED CALLS, pinned at the live-lifecycle
level: a refused credential once, a permanent rate limit to the attempt ceiling, a
refused review exactly once, and the mission never completes around it.

Three existing workflow cases pinned the evicting group and a whole-file checkout
count; they are corrected to the new guarantees, not deleted. 38 new proofs across
the queue rule, the dispatch client, the workflow wiring (including the readiness
step driven over a fake curl) and the lifecycle bound. Thirteen adversarial
mutations, thirteen killed.

No provider was contacted. No mission spent anything.

## Resolutions applied (documented in ceremony/landing-order)

- `.github/julius-live-evidence-dump.sh`: three additive column merges (`cached_input_tokens`, six `stream_*` columns, `review_reask_shape`), line count unchanged each time.
- `julius-execution-coordinator.ts`: `dispatchWithinDeadline` and `carriedDiagnostics` both kept.
- `JULIUS_HARNESS_MANIFEST.md`: regenerated with `npm run julius:harness:export`.
- `ARCHITECT_WORKER` → `architectWorker({})` in three tests, folded into the architect-envelope commit.

No model provider was contacted by any of these changes.

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01KLYuWBeq4erDEd89bec95L
