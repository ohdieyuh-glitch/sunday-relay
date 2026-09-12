# Julius: a paid retrieval could vanish, and the record would not have noticed

## 1. The window

`driveResearchCheckpoint` awaits `deps.research.serve()` and appends its
`research.retrieved` rows afterwards. The mediator's own settlement — the thing
that looks like the accounting — is an in-process Map (`research-mediator.ts`)
that writes nothing durable. So between the retrieval returning and its first
row landing, a process that died had **spent with nothing at all on the record**.

## 2. What it costs is not what it looks like

The obvious reading is a double charge: the restart asks again and pays twice.
**It does not**, and the correction matters more than the repair.

The checkpoint is driven from `driveContinuousLifecycle` — once, guarded by
`!outcome.duplicate`, after the dispatch that asked has already ended and its
task is `SUCCEEDED`. Nothing re-enters it. The reproduction agrees: served once,
no rows, and a restarted drive serving zero.

So the retrieval is simply **lost**. Bought, unrecorded, its answer never
delivered, the continuation never minted, and the mission carrying on as though
it had never asked. The durable ledger — rebuilt from rows, and the only budget
that survives a restart — then counts one retrieval fewer than were bought.

A budget that over-counts is pessimistic. One that **under-counts can be
exceeded**.

## 3. The repair is to say so

`research.attempted` is written before a socket can exist, carrying the
checkpoint's own id, the slot, and how many asks were in flight. The charge rows
carry the same key.

An attempt with no charge beside it **is** the loss — visible in the bundle
rather than inferred from a gap nobody can see. `research.tsv` exports the row,
its key and its ask count.

## 4. What is deliberately absent, and why that is the point

**No re-entry guard.**

An earlier guard in this exact place compared the *continuation's* id against
the durable task rows, and was removed because it could never fire:
`nextSegmentNumber` is the highest existing segment plus one, so that id is new
by construction. It asked whether the work it was about to create already
existed — never.

I built a replacement that asked the answerable question instead — *was an
attempt already made for this segment* — and then the reproduction showed there
is no second serve to guard. Shipping it would have been the same mistake in a
new place: a branch that cannot be taken, with a comment claiming a protection
nothing performs. **It came out.**

Two proofs hold that decision:

* case 16 asserts the reason code and the helper appear nowhere in the pipeline;
* case 12 asserts the `!outcome.duplicate` gate that makes the absence correct —
  so if that gate ever goes, a replayed result **would** buy a second retrieval,
  and this file is what says so.

## 5. Proofs

`src/relay/mission/julius/julius-research-attempt.test.ts` — 16 cases:

* **A (1–8)** the loss, end to end. The window reproduced by failing the append
  of the first charge row, which is exactly what a process dying there leaves
  behind: served once, paid for, no charge, no continuation, the attempt
  standing alone. A transport that dies holding the answer leaves the same
  record. A healthy run pairs its attempt with the charges it produced. The
  attempt is written **before** the retrieval, or it could not be the scar. The
  key is the checkpoint's own id rather than a second identifier to keep in
  step. Each serve gets its own attempt.
* **B (9–12)** there is no second spend: the asking task is already `SUCCEEDED`
  when the retrieval is made; a recovery sweep does not buy it again; the run
  reaches an ending rather than stalling on an answer that is never coming; and
  the `!outcome.duplicate` premise is checked in the source.
* **C (13–16)** the record: the event is registered, the dump selects it, the
  passage claims no protection it does not provide, and no unreachable guard
  was left behind.

## 6. Adversarial mutations

Eleven applied, eleven killed: the attempt row never written, or written after
the spend; the key becoming its own identifier; the charge no longer naming its
attempt; the ask count understated; the `!outcome.duplicate` gate removed; the
event type unregistered; the dump forgetting the rows, then the key; the comment
claiming exactly-once; and an unreachable re-entry guard coming back.

## 7. What this does not do

It is **not** exactly-once and no passage in it says so — a proof reads the
comment to check. The window is not closed; closing it needs the retrieval keyed
and deduplicated at the transport, which Live Reach has no identity for. It does
not recover the lost answer, and it does not re-ask.

What changed is that the loss is recorded instead of silent, which is what made
it impossible to notice.

## 8. Gate

Full gate green on this tree: `npm test` **10,352 passed / 0 failed** across 530
files, `typecheck` (all four passes), `build`, `relay:build`,
`relay:bridge:build`, `julius:harness:check`, repository boundary, parity gate,
surface parity (strict), YC demo check, CLI contract verify, persistence contract
verify, persistence recovery drill, workspace verify, Claude contract verify,
`git diff --check`.

No provider was contacted. No mission spent anything.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01TqJcJuQiraGDnFnjA4gyUc
