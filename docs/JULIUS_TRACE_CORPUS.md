# The Julius trace corpus

**What a trace is here.** One mission shape, driven end to end, whose record can
be read afterwards. The beta brief names twelve shapes the corpus must cover. This
document is the ledger of which shape is covered by what, and the table below is
**machine-checked**: `scripts/julius-trace-corpus.test.ts` reads it, resolves every
file, and requires every case reference to name a case that exists. A reference
that cannot be resolved is not evidence, and that rule applies to this page too.

**Two kinds of trace, and the distinction is the whole point.**

- **DETERMINISTIC** — driven through the real runtime with the provider replaced
  at its own boundary. It proves Julius's behaviour and nothing about a model.
  Zero spend, repeatable, and it is what every row below except one is.
- **LIVE** — a real provider answered. **The corpus holds exactly ONE**: paid run
  `34414726976`, recorded in `docs/JULIUS_PAID_RUN_34414726976_LIVE_RUN_3.md`. It
  covers the clean-success shape and no other, and it recorded four gaps of its
  own, of which the reviewer never having a defect in front of it is the one this
  corpus most needs a second run for.

Volume is not the point and is not claimed: there is no value in three hundred
copies of one shape. Coverage is the point, and the gaps are named rather than
padded.

| # | Shape | Kind | Where | Case |
|---|---|---|---|---|
| 1 | clean success | DETERMINISTIC | `relay-bridge/julius/julius-live-composition.test.ts` | `runs architect → coder → reviewer through Julius and completes only via verification` |
| 1L | clean success | **LIVE** | `docs/JULIUS_PAID_RUN_34414726976_LIVE_RUN_3.md` | *(bundle, not a case)* |
| 2 | architect retry / correction | DETERMINISTIC | `src/relay/mission/julius/julius-paid-run-34037313976.e2e.test.ts` | `plan → plan review REJECTS → architect revises → re-review ACCEPTS` |
| 3 | coder repair | DETERMINISTIC | `relay-bridge/julius/julius-live-composition.test.ts` | `a repaired and re-approved run reaches COMPLETED, with the REPAIR still in durable history` |
| 4 | reviewer rejection | DETERMINISTIC | `relay-bridge/julius/julius-live-composition.test.ts` | `catches the defect, sends it back, and completes once the repair removes it` |
| 5 | successful re-review | DETERMINISTIC | `relay-bridge/julius/julius-live-composition.test.ts` | `approves the same diff when it arrives first: the catch is content, not a round counter` |
| 5b | re-review that refuses to launder | DETERMINISTIC | `relay-bridge/julius/julius-live-composition.test.ts` | `catches the defect again when the repair does not remove it` |
| 6 | timeout | DETERMINISTIC | `src/relay/mission/julius/julius-chaos.test.ts` | `without leaving the task ACTIVE` |
| 7 | provider failure | DETERMINISTIC | `src/relay/mission/julius/julius-continuous-lifecycle.e2e.test.ts` | `a coder whose provider is rate limited FOREVER` |
| 8 | provider refusal (of the caller) | DETERMINISTIC | `src/relay/mission/julius/julius-continuous-lifecycle.e2e.test.ts` | `a reviewer whose provider refuses` |
| 9 | budget pressure | DETERMINISTIC | `src/relay/mission/julius/julius-chaos.test.ts` | `stops rather than looping when the budget is exhausted mid-run` |
| 10 | restart / recovery | DETERMINISTIC | `src/relay/mission/julius/julius-chaos.test.ts` | `nothing is executed twice across a crash` |
| 11 | context-integrity challenge | DETERMINISTIC | `src/relay/mission/julius/julius-context-delivery.e2e.test.ts` | `carries the one verified fact, ahead of sixty plausible unverified ones` |
| 11b | context clash, failed closed | DETERMINISTIC | `src/relay/mission/julius/julius-context-delivery.e2e.test.ts` | `fails the task with a named failure class instead of throwing out of the tick` |
| 12 | prior-learning case | DETERMINISTIC | `src/relay/mission/julius/julius-learning-loop.e2e.test.ts` | `promotes the artifact, and reports the WEAKEST improvement as its value` |
| 13 | tool effects in a mission | DETERMINISTIC | `relay-bridge/julius/julius-live-composition.test.ts` | `Tool effects went through the executor port` |
| 14 | provider refusal (of the REQUEST — content), re-planned | DETERMINISTIC | `src/relay/mission/julius/julius-continuous-lifecycle.e2e.test.ts` | `named, re-planned by the architect, and the mission is NOT collapsed` |
| 18 | knowledge carried from one mission to the next, verified only | DETERMINISTIC | `relay-bridge/julius-bridge-seam.real-postgres.test.ts` | `what mission A’s reviewer verified and a repair answered reaches the next run of THAT mission’s plan — and nothing else of A does` |
| 15 | mission created over the bridge, then observed — one record, on a real PostgreSQL (gated) | DETERMINISTIC | `relay-bridge/julius-bridge-seam.real-postgres.test.ts` | `what a client creates is what a client then watches, and both are what the database holds` |
| 16 | the whole chain on a real PostgreSQL, repair round included, dumped and gated (gated) | DETERMINISTIC | `src/relay/persistence/julius-live-chain.e2e.test.ts` | `drives a mission with a repair round, dumps it, and the gate reads what the run actually did` |
| 17 | a memory verified by a reviewer — durable standing with history, and a refusal by name | DETERMINISTIC | `src/relay/mission/julius/julius-continuous-lifecycle.e2e.test.ts` | `raises the architect` |

## What the corpus does NOT cover, stated rather than padded

- **A tool-HEAVY mission.** Row 13 proves four tool effects reach the independent
  executor inside a real mission — base revision, change set, diff, test. A
  mission with dozens of effects against the real Docker sandbox is the executor's
  own sibling proof (`scripts/julius-sibling-e2e.ts`), which needs Docker, a
  signing key and PostgreSQL, and was not run here.
- **A LIVE content refusal.** Row 8 is a provider declining the CALLER; row 14
  is a provider declining the REQUEST — a class of its own on all three peers
  now, and re-planned by the architect rather than collapsing the mission. Every
  refusal trace in this corpus is deterministic: no real model has declined a
  real Julius request on the record, so the corpus proves the machinery and not
  the models' behaviour. Named in `docs/JULIUS_BETA_READINESS.md`, row 11.
- **A LIVE trace of any shape except clean success.** One paid run exists. Every
  adversarial shape in this corpus is deterministic, which means the corpus proves
  Julius handles these shapes and does not prove a real model produces them.
- **A paid matched pair for the Learning Loop.** Row 12's improvement is measured
  from the durable trajectory of two real runs of the real loop; the worker's
  dependence on the learned fact is the fixture's premise and the file says so.

## Why this is a ledger and not a corpus of stored artifacts

A stored trace is a file that ages: it records what the runtime did on the day it
was captured, and it keeps asserting that after the runtime changes. Each row
above is instead a mission the suite RE-DRIVES, so the trace is regenerated on
every run and a behaviour that stops happening fails a test rather than
disagreeing with an archive. The one genuinely archived trace — paid run
34414726976 — is archived because it cannot be re-driven without spending money,
and its document says exactly what it did and did not prove.
