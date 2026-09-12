# Julius: the architect's advice never reached the worker it was written for

## 1. The gap

A guidance packet was stored as an artifact. Its only consumer in this
repository is the Independent Reviewer — `live-workers.ts:1323` — so the
reviewer could judge the advice. The Coding Agent that asked the question was
handed nothing.

What the coder's continuation actually carried was `brain:segment-resume`: what
the coder itself said before it paused.

So a mission could buy an architect dispatch, buy a review of its output, mint a
continuation blocked on the architect *so the coder could not proceed without
the answer* — and then resume that coder without the answer. The packet's own
type calls its `taskId` "the task the guidance is FOR — the coder's task". That
task never saw it.

The comment that used to sit at the issue site said the text "travels to the
coder the way the plan does — as an artifact the composition owns". The plan has
a reader in the coder adapter. This did not. Every path that could have closed
it was checked: the context compiler, the context snapshot, the coder adapter's
prompt, and any store read for a packet. There was none.

## 2. Research already closed the same loop, twenty lines away

`brain:research-answer:<continuation>` puts retrieved observations on the
continuation's own Project Brain channel, under a comment saying the answer
travels "exactly as the architect's question does".

The architect's **question** had that channel. Its **answer** did not.

## 3. What this adds

Guidance now travels the same way — one Project Brain, one redaction path, one
provenance record, no prose side channel.

* `renderJuliusGuidanceHandoff` is the domain's, bounded at 6,000 characters,
  and **a cut says so**: advice silently truncated would leave a coder reasoning
  from a packet it believes it read in full.
* It **leads with what it is**: the Mission Contract is unchanged, nothing below
  widens it, a prohibition here only ever narrows.
* It **ends with what the architect could not settle** — the part a coder most
  needs to know it is deciding for itself.
* `deliveredTo` on `guidance.issued` names the continuation, or is **null** when
  none was waiting. Advice nobody can read is a fact about the run; an absent
  field would be a third state a reader cannot tell from either.

**The continuation is found, not computed.** `pendingSegmentFor` reads the rows
for the BLOCKED segment waiting on the *guidance task* — the edge the barrier
actually is, not the subject the research barrier waits on. Two waiting segments
is a shape nobody has built and resolves to null rather than a guess, because
picking the likelier one would be Julius deciding which pause an answer belonged
to. The revision is in the entry id, because `appendBrainEntry` is idempotent per
id and a revised packet would otherwise be silently dropped while the record
said a second was issued.

## 4. And that is why `guidanceConsumed` was UNKNOWN

Two existing proofs said so in as many words:

> `guidanceConsumed`: nothing in the runtime knows it. The guidance packet is
> never compiled into any dispatch's context, so there is no point at which
> "this dispatch consumed N packets" is a fact.

True — and a statement about a packet nobody delivered, not about a dimension
nobody could measure. It is now counted off the entries the compiler **admitted**,
beside `brainRetrievals`, so a packet whose character budget dropped the advice
reports carrying none: the truth about what the worker was shown. The number is a
consequence of the delivery, never a column filled in to look complete.

`checkpoints` keeps its own reason and stays absent.

## 5. Proofs

`src/relay/mission/julius/julius-guidance-delivery.test.ts` — 21 cases:

* **A (1–5)** the delivery: the continuation carries the handoff, it carries the
  advice rather than a reference to it, the row names who it reached, the null
  case reached through a **real segment ceiling**, and the revision in the id.
* **B (6–10)** the waiting-segment lookup: the one BLOCKED segment, nothing
  waiting, another subject's segment, two waiting segments, and a BLOCKED task
  that is not a segment.
* **C (11–15)** the rendering: the disclaimer in the text the coder reads, empty
  sections omitted, bounded, truncation announced, revision and checkpoint in
  the header.
* **D (16–20a)** the measurement: the continuation reports consuming it, the
  dispatch that asked reports none, a run with no guidance round measures zero
  rather than unknown, it counts what the packet admitted, it is a consequence
  of the delivery, and both new facts reach the bundle.

## 6. Adversarial mutations

Fourteen applied, fourteen killed: the advice never delivered, or delivered to
the subject instead of the continuation; the revision dropped from the entry id;
`deliveredTo` absent instead of null; the lookup using the subject rather than
the guidance task; two waiting segments resolved by guessing; a SUCCEEDED segment
or a non-segment task counted as waiting; `guidanceConsumed` hardcoded, or
returned to absent; the unresolved questions dropped; the contract disclaimer
removed; truncation made silent; and the handoff unbounded.

**One survived and its proof was vacuous.** The null-delivery case ran a rig
that issued no guidance at all, so a loop over zero rows passed whatever the
field did. It now reaches the segment ceiling, asserts exactly one issued row,
and the mutation dies.

## 7. Two existing proofs repaired, not deleted

Both are the honest record of what changed: the dimension nothing can measure is
now one rather than two, and the per-slot summary reads `guidanceConsumed` as
measured-and-zero on a run with no guidance round.

## 8. The guard caught the third hop on its own

The #254 completeness guard failed the build on a new fact the effort row wrote
and the bundle would have destroyed with the database. Both new facts —
`guidanceConsumed` on the effort row, `deliveredTo` on the guidance row — are
exported, and a proof pins them.

## 9. What this changes on a paid path

**The Coding Agent will be shown advice it currently is not.** Nothing new is
authorised: a packet that was already written, already paid for and already
reviewed now reaches its reader.

## 10. Gate

Full gate green on this tree: `npm test` **10,356 passed / 0 failed** across 530
files, `typecheck` (all four passes), `build`, `relay:build`,
`relay:bridge:build`, `julius:harness:check`, repository boundary, parity gate,
surface parity (strict), YC demo check, CLI contract verify, persistence contract
verify, persistence recovery drill, workspace verify, Claude contract verify,
`git diff --check`.

No provider was contacted. No mission spent anything.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01TqJcJuQiraGDnFnjA4gyUc
