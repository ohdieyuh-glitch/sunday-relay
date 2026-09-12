# Julius: the live store could not read its own ledger, so two guarantees were not in force

## 1. The gap

`JuliusTimelinePostgresRepository` implements `JuliusTimelineReader` against the
real events table. Its only references in the repository were its own
declaration and the barrel that exports it. **Nothing in production constructed
it.**

Both consumers of a timeline reader are bound behind a structural probe —
`typeof store.timeline === 'function'` — and `createJuliusPostgresRuntimeStore`
returned no such method.

## 2. What was therefore not in force

**The research meter.** `durableLedger` rebuilds a slot's retrieval spend from
the run's own rows. Unbound, the mediator keeps an in-process Map, so a bridge
restart forgets what every slot has already spent. That is the exact defect the
durable projection was built to close — and it was never reached in production.
"Research consumption is restart-durable" was true of the code and false of the
deployment.

**The money ledger.** `deps.timeline` is what `projectSlotLedgerFor` reads
`budget.reserved` and `budget.settled` from. Unbound, allocation v3 falls back to
counting rounds off the task rows: a lower bound that cannot tell an open
reservation from one settled for less. The fallback is correct and reports itself
as conservative in its own basis; reaching it in production was not the plan.

Two of the six paid-qualification preconditions depend on these.

## 3. Why nothing caught it

The store factory's own comment leans on the conformance test: *"if a port method
is added without a repository implementing it, the conformance test fails before
this file can compile against the barrel."*

That is true, and it cannot apply here. `JuliusTimelineReader` is **not** part of
`JuliusRuntimeStore`, so there was no required port to be missing. A conformance
test proves the REQUIRED surface and is silent about an optional capability —
which is exactly the kind that gets dropped.

## 4. The harness map had already recorded it

`scripts/export-julius-harness.mjs` carried the file in its **"not composed"**
list, with the reason *"a read model no live surface consumes yet"*. An accurate
note about a real gap, kept as a deliberate declaration rather than read as a
defect.

The export refuses a declaration for a file a root actually reaches, so binding
it **failed the harness check** until that line came out. That refusal is why the
map can be trusted.

## 5. What this changes

`createJuliusPostgresRuntimeStore` constructs the repository and binds
`timeline`, and the capability is named in the **return type** rather than left
to the probe. A probe fails quietly; a declared method that goes missing fails at
the type. That is what makes the next optional capability impossible to drop the
same way.

No behaviour changes for a mission that neither researches nor allocates — the
fallbacks were already correct. What changes is that the durable paths are
reached.

## 6. Proofs

`relay-bridge/julius/live-timeline-binding.test.ts` — 8 cases, plus the existing
harness-export suite:

* the method exists on the composed production store;
* it is in the signature, not left to a structural probe;
* it is the real repository and **not a stub that answers empty** — binding an
  empty reader would be worse than not binding, because it would rebuild every
  ledger as zero while the honest fallbacks at least report themselves as
  conservative;
* the handoffs wrapper the entrypoint actually composes does not drop it;
* both consumers are still behind the probe, each matched to its own site;
* neither is behind a literal;
* the projection still refuses rather than inventing when nothing is bound;
* the harness map no longer declares it uncomposed, and the generated manifest
  now carries it as production.

## 7. Adversarial mutations

Six applied, six killed: the timeline unbound; bound but absent from the return
type; a stub answering empty; the handoffs wrapper rebuilding instead of
spreading; each consumer's gate replaced by a literal.

**One survived and its proof was too weak to see it.** "The research ledger gate
is removed" passed because the proof asserted the probe string appeared
*somewhere* in the file — and the probe appears once per consumer, so removing
one left the other to satisfy it while that consumer became unreachable. Both
sites are now counted and each matched to the consumer that follows it, and a
companion case refuses a `...(false` or `...(true` spread outright: a capability
bound in a branch nothing takes is the whole failure mode this file exists to
prevent.

## 8. Gate

Full gate green on this tree: `npm test` **10,344 passed / 0 failed** across 530
files, `typecheck` (all four passes), `build`, `relay:build`,
`relay:bridge:build`, `julius:harness:check`, repository boundary, parity gate,
surface parity (strict), YC demo check, CLI contract verify, persistence contract
verify, persistence recovery drill, workspace verify, Claude contract verify,
`git diff --check`.

No provider was contacted. No mission spent anything.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01TqJcJuQiraGDnFnjA4gyUc
