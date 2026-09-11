# Julius: the coder knew what it had spent and the parser never asked

## 1. The finding, with the run that produced it

Paid run `34485676189` attempt 1 was cut off by Relay's own abort timer at the
360,000 ms runtime ceiling, twelve tool calls in. Its record says the cost, the
input tokens and the output tokens are all UNKNOWN, and the commentary beside it
in `coder-envelope.ts` states the consequence plainly:

> A timed-out hosted run reports no usage at all, so what it spent is UNKNOWN
> and stays null — we paid and cannot say how much.

That was true about the cost and false about everything else.

## 2. Why

`foldHostedMessage` read usage from ONE message: the terminal `result`. The
runtime reports its total there, and a run Relay aborts never reaches it.

Every assistant turn had been carrying its own usage the whole time.
`SDKAssistantMessage.message` is a `BetaMessage`, and `BetaMessage.usage` is a
**required** field with `input_tokens`, `output_tokens`,
`cache_read_input_tokens` and `cache_creation_input_tokens`. Relay read none of
it. "The runtime reported nothing" was a fact about the parser.

## 3. What this adds

`HostedStreamUsage` — folded turn by turn, present on every run, and reported in
six new diagnostics columns:

| column | what it is |
|---|---|
| `streamUsageMessages` | assistant turns whose usage block was readable |
| `streamAbortedMessages` | turns the runtime itself marked `aborted` — its own word for what Relay's timer did |
| `streamInputTokens` | summed over those turns |
| `streamOutputTokens` | summed over those turns |
| `streamCacheReadInputTokens` | summed over those turns |
| `streamCacheCreationInputTokens` | summed over those turns |

## 4. It is a floor, and most of this change is keeping it one

* **Not the total.** On a completed run both exist side by side; neither
  overwrites the other. `usage.source` still says `runtime_reported` only when
  the runtime actually reported.
* **No cost, in the values or in the type.** An assistant turn reports tokens
  and never dollars. A cost field nobody populates yet is an invitation to
  populate it, so the shape refuses one and a proof reads the declaration to
  check.
* **No basis derived from it.** `costBasis` stays `UNKNOWN` on exactly the runs
  the floor now describes, so the ledger keeps holding the reservation instead
  of settling against a number nobody billed.
* **Unknown is still not zero.** A component no turn reported stays null rather
  than becoming a sum of nothing. An empty floor is `messages: 0` with every
  token total null — zero turns is a true statement about how many were seen;
  zero tokens would be a false one about what they consumed.

## 5. All three hops, because the last time one was missed it cost a landing

The `cachedInputTokens` miss went: allowlist ✓, adapter ✓, dump ✗. So:

1. `foldHostedMessage` folds it into the observation;
2. `safeReviewDiagnostics` admits all six columns;
3. the shared `hostedCoderDiagnostics` builder sets each exactly once, so the
   success and failure paths cannot drift — the shape both Finding C and
   Finding E had;
4. `worker-diagnostics.tsv` exports all six.

The completeness guard from #254 checks hops 2 and 4 against each other in both
directions on its own, and passes.

## 6. Proofs

`relay-bridge/hosted-coding-agent/hosted-stream-usage.test.ts` — 21 cases:

* **A (1–8)** the floor is observed: none, one turn, several summed, cache
  components accumulating independently, a component only some turns report,
  a user message not counted, a turn with no usage block not counted, and a turn
  with no parseable content still contributing — the last turn of a cut-off run
  is the most likely to arrive that way and the most interesting.
* **B (9–11)** the runtime's own `aborted` marker, counted separately.
* **C (12–15a)** the floor is never the total: **the finding reconstructed** —
  a stream cut off before any result reports UNKNOWN *and* a floor, together;
  a completed run keeps the runtime total as the authority; the floor carries no
  cost in values or type; a result that reports nothing leaves the total UNKNOWN
  even beside a floor; and the fold is order-independent.
* **D (16–20)** the floor reaches the record: the cut-off stream driven through
  the **real coder adapter** to a real `JuliusDispatchError`, asserting both
  halves — the floor is there, the money is still UNKNOWN, `runtimeStarted` is
  true and `timedOut` is true; the allowlist admits every column; the builder
  sets each exactly once; the dump exports each.

## 7. Adversarial mutations

Eighteen applied, eighteen killed, no survivors: an unreported component
zero-defaulted; the empty floor reading as zero tokens; user messages counted;
the fold placed after the content guard; aborted turns uncounted and a
usage-less aborted turn dropped; a turn with no usage block counted anyway; the
floor overwriting the runtime total; the floor filling the runtime-total column;
the floor settling the cost basis; the floor gaining a cost field; and each
column dropped from the builder, the allowlist and the dump.

**Three survived their first run and each pointed somewhere real.** Two were
equivalent as written — an added key the allowlist drops, and a type field
nobody populates — and were rewritten to actually bite. The third gated the fold
on "no result yet", which no SDK stream can distinguish today; rather than leave
it as equivalent, the fold is now proven ORDER-INDEPENDENT, which is the
property that mutation was really about.

## 8. What this does not do

The historical row for `34485676189` keeps its `costUsdMicros: null`. The
instrumentation postdates it and there is no bundle to read the floor back out
of; what it has now is an accurate note saying why, instead of a claim that the
run reported nothing.

It does not make a cut-off run's cost knowable. The runtime reports dollars once,
in the result message, and an aborted run has none. That stays UNKNOWN, and the
ledger still holds the reservation for it.

## 9. Gate

Full gate green on this tree: `npm test` **10,356 passed / 0 failed** across 530
files, `typecheck` (all four passes), `build`, `relay:build`,
`relay:bridge:build`, `julius:harness:check`, repository boundary, parity gate,
surface parity (strict), YC demo check, CLI contract verify, persistence contract
verify, persistence recovery drill, workspace verify, Claude contract verify,
`git diff --check`.

No provider was contacted. No mission spent anything.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01TqJcJuQiraGDnFnjA4gyUc
