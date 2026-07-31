# Mission Economics — Mission Operations Milestone 5

Status: implemented (deterministic, shared website/CLI core, **no provider
billing integration, no live pricing, no database persistence**)
Canonical implementation: `src/relay/mission/economics/` — ONE implementation,
imported by both surfaces. `src/relay/mission/economics-barrel.ts` is a thin
re-export of it (no logic), because the CLI boundary permits the `../mission`
barrel but not a deep `../mission/economics` path. There is no second copy and
nothing to keep in sync; the earlier "byte-identical in both repos" wording
described the pre-separation state, when the surfaces lived in two
repositories.
Website surface: `src/relay/ui/project-workspace/RelayMissionEconomics.tsx`
CLI surface: `relay mission economics|budget|receipts`

## Why cost per verified mission

A cheap model call that causes three repairs, a retry, and a human
intervention is expensive. A more expensive call that lands a verified result
first time is cheap. Cost per model call answers the wrong question; only the
mission-level figure tells the truth, and only when the mission actually
succeeded.

## Money

Stored as `{ currency, amountMicros }` where `amountMicros` is a base-10
INTEGER STRING of millionths of a currency unit. Arithmetic goes through
BigInt inside `money.ts` and returns to a string; BigInt never escapes,
because the trace canonicalizer rejects it and stored records must stay JSON.

Floating point never determines financial truth: `0.1 + 0.2` is exactly
`$0.30` here. Thresholds are basis points (10,000 = 100%) computed with
integer maths and truncated toward zero, so a threshold is never rounded past.

Currencies are never converted. Mixing them produces `currency_conflict` and
no combined total.

## Receipts

Thirteen categories (planning, model inference, agent execution, tool
execution, workspace, testing, build, review, repair, retry, infrastructure,
human intervention, adjustment); two cost classes (estimated / actual); five
statuses (pending / provisional / finalized / voided / disputed); five sources
(provider reported / adapter observed / Relay calculated / human entered /
development fixture).

Rules that hold: a finalized receipt must carry an amount; a pending receipt
may not; only an adjustment may be negative, and it must name the receipt it
corrects and why; a finalized provider-reported actual must cite the provider
usage it came from; a Relay-calculated amount must cite a rate reference;
valuing human time requires an explicit rate reference, because Relay never
invents an hourly rate. Finalization is idempotent for the same amount and
refuses a different one — that is a correction, and corrections are
adjustments. A voided receipt can never reactivate. Everything stays
inspectable.

### Attribution

Project → Mission → Task → Run → Capsule → Actual agent → PSP version →
Category. Mission id, project id, and mission revision are mandatory, and a
receipt stays bound to the revision it was incurred under.

The rule that matters most: **a requested agent that never verifiably launched
is never billed for execution.** A failed Codex launch may produce an adapter
or infrastructure cost; it produces no Codex execution cost. An authorized
fallback attributes cost to the agent that ACTUALLY ran while the requested
identity stays visible.

## Budgets

A budget carries a total limit (or `not_configured`, which is disclosed and is
NOT "unlimited"), a hard-limit switch, a warning threshold in basis points, an
optional approval threshold, category limits, and repair/retry/runtime limits.

Three separate decisions, never conflated: a **warning** informs, an
**approval threshold** requires a human, and a **hard limit** blocks. A hard
limit cannot be bypassed by using another agent, a fallback, more commands,
more pending receipts, a new run, or the other surface — the evaluation is
shared.

Budget changes go through the existing Milestone 2 `change_budget` intent.
There is no competing command. An increase carries mission revision and policy
version, requires approval where policy says so, changes nothing before
approval, and records the approval in history; the prior limit stays visible.
An agent may never approve its own budget. A stale approval cannot modify a
newer budget.

## Evaluation

Finalized actual always counts. Provisional counts toward the PROJECTION. A
pending receipt with no amount stays UNKNOWN and never becomes zero — the
projected total is then reported as a lower bound. Voided receipts never
count; disputed receipts are held out and shown separately; adjustments apply
exactly once.

## Aggregation and completeness

Estimated and actual are separate ledgers. A category with no data is `null`,
not zero. Completeness is `not_available`, `estimated_only`, `partial`,
`complete`, `disputed`, or `currency_conflict`.

`verifiedMissionCost` is calculated ONLY when the outcome is satisfied, the
verification is verified, cost records are complete, and trace integrity has
not failed. Execution completing, a reviewer finishing, a completion claim, or
a release being approved are none of those things.

## Trace and capsule integration

Twelve economics event types are registered in the Milestone 4 ledger
(receipt created/finalized/disputed/voided, adjustment recorded, budget
created/warning/approval-required/increase-approved/hard-limit, economics
recalculated, verified mission cost calculated). Adapters return DRAFTS; the
ledger allocates sequence, binds the previous hash, redacts, and hashes. No UI
or CLI component appends an event directly. Trace metadata carries ids,
canonical amounts, currency, category, source, status, and budget references —
never a provider credential, billing credential, PSP secret, payment detail,
or raw invoice.

Capsules link receipt IDs only through the existing Milestone 3 boundary.
Attaching a cost never changes identity, review credit, verification, or
release.

## Surfaces and parity

Both surfaces render the SAME `projectMissionEconomics` output, so they cannot
disagree about what a mission cost. Missing amounts render as "Unknown",
"Pending", "Not available", or "Not configured" — never `$0.00`. The website
shows a compact summary in the workspace; the CLI prints the same values,
wrapping prose at narrow widths and printing safe receipt summaries only.

Nine capabilities are registered in the parity registry: mission-cost-receipts,
mission-budget-status, mission-budget-change, mission-economics-summary,
mission-cost-breakdown, budget-warning, budget-hard-limit, budget-approval,
verified-mission-cost. Strict parity passes with no founder exception.

## Current limitations, stated plainly

- the receipt repository is **in-memory and non-production**; no database
  persistence;
- there is **no provider billing integration** and **no live pricing lookup** —
  rate references exist, and fixture rates are fictional and marked
  `development_fixture`;
- **no production receipt** is written and **no payment or marketplace call**
  is made;
- the CLI carries the shared economics core but not the Milestone 1–4 domains,
  so it builds the four-status snapshot structurally.

## Future boundaries

- **Milestone 6 — Mission Operations interface**: the full economics surface.
- **Milestone 7 — PSP economics**: aggregate performance across missions; this
  milestone supplies the correct per-mission input.
- Provider billing adapters, live pricing, and durable persistence remain
  future work and are not implemented here.
