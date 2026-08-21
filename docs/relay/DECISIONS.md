# Sunday Relay — Architecture Decision Records

> Status: all ADRs below are **accepted** (Phase 1 architecture lock,
> 2026-07-21) per founder decisions 1–10 and the accepted pre-Phase-1
> analysis. Format: context → decision → consequences, kept deliberately
> terse; contracts live in PROTOCOL.md, structure in ARCHITECTURE.md.

## ADR-001 — Headless Relay Core
Context: Relay must power CLI, desktop, and Sunday mobile without
duplicated workflow logic. Decision: relay-core is headless,
provider-neutral, transport-neutral, credential-free; all clients speak
serializable `relay.protocol.v1`. Consequences: core is testable
deterministically; UI is replaceable; a service boundary can be added
without core changes.

## ADR-002 — Directory/module placement
Context: single-package Vite + esbuild repo; tsconfig includes `src/` only.
Decision: logical boundaries as directories under `src/relay/*` in the
existing npm package; no monorepo. Consequences: zero shared-file changes;
boundary tests (not package walls) enforce isolation; revisit only on
repository evidence of unsuitability.

## ADR-003 — Hybrid local/cloud execution
Context: founders already own local agent subscriptions; Aquala also funds
cloud calls. Decision: two disjoint dispatch paths — local adapters using
native provider auth; cloud dispatch through the Railway gateway. Never
mixed per dispatch. Consequences: local demos cost nothing and leak
nothing; cloud spend keeps all Sunday production guards.

## ADR-004 — Credential ownership
Context: AGENTS.md §5.2 (keys server-side only); local tools hold their own
auth. Decision: Relay Core never holds/reads/serializes credentials; only
opaque `sessionRef`s; cloud keys stay in Railway env. Consequences:
no-secret-output tests become tractable; a compromised Relay state file
leaks no credentials.

## ADR-005 — Spend authorization layering
Context: Relay needs budgets; Sunday already has a non-bypassable global
breaker. Decision: inner Relay BudgetPolicy AND outer
`SpendAuthorizationPort` (Railway implementation outside core) must both
approve Aquala-funded calls; core cannot import fusion-engine.
Consequences: dependency direction stays clean (gateway → protocol);
RELAY_INTEGRATION.md §5 guarantees preserved under new architecture.

## ADR-006 — Canonical Project Ledger
Context: System 1; project memory must outlive provider sessions. Decision:
user/project-owned ledger with six-way classification; agents are execution
resources, never the source of truth. Consequences: Project Brain view is a
projection; provider lock-in avoided.

## ADR-007 — Append-only typed events
Context: prototype's prose `{at, stage, summary}` events cannot power
clients or audits. Decision: typed EventEnvelopes, append-only, monotonic
gap-free `sequence` = ledger version; prose derived at render. Consequences:
persisted format survives UI evolution; deletion becomes supersession
events; audit trail is complete by construction.

## ADR-008 — State-machine approach
Context: artifact-presence derivation (prototype) cannot express blocked/
checkpoint/failed. Decision: explicit RelayRun (status × phase) and
RelayTask (13 states) machines in relay-core with table-driven guards;
illegal transitions are typed errors. Consequences: deterministic harness;
the state grid is exhaustively testable.

## ADR-009 — Runtime schema validation
Context: repo convention is hand-rolled validators (no zod); every boundary
input is untrusted. Decision: hand-rolled per-contract validators in
relay-protocol, reusing the prototype's proven patterns (placeholder
rejection, label checks, per-field paths). Consequences: zero dependencies;
error messages stay operator-grade.

## ADR-010 — Imported Architect Blueprint
Context: ChatGPT currently serves as external human-supervised Prompt
Architect. Decision: three architect sources (simulated / imported / live
adapter later); imported Blueprints are untrusted external artifacts
promoted only by human `accept-blueprint`; no provider hardcoded.
Consequences: the real workflow needs no paid Architect call; provenance
is honest; live adapter slots in later without contract change.

## ADR-011 — Codex as first live independent Reviewer
Context: Decision 3. Decision: provider-neutral ReviewerAdapter port;
SimulatedReviewer first; CodexReviewerAdapter first live; independence
derived from assignment/session lineage, never report text; manual review
labeled `manual`, never presented as automated. Consequences: self-review
is structurally impossible to pass off; the prototype's string comparison
survives only as a backstop.

## ADR-012 — One bounded automatic repair
Context: Decision 4; unbounded loops are a forbidden failure mode.
Decision: `repairCount ≤ 1` enforced in relay-core; auto-repair only when
all 15 conditions hold (recorded in the Revision Contract); otherwise
checkpoint_required; after repair, re-verify + re-review per policy; never
a second automatic repair. Consequences: worst case is bounded and
auditable; escalation is the default, not the exception.

## ADR-013 — Enforcement classification
Context: paste/manual paths cannot technically enforce restrictions;
pretending otherwise is the lie the product forbids. Decision: every
restriction carries `enforced | advisory | unsupported`; UI/CLI must
display the true level; unsupported blocks high-risk tasks when policy
requires enforcement; SECURITY_BOUNDARIES.md holds the per-adapter matrix.
Consequences: honesty is a schema field, not a hope; adapters must declare
capabilities.

## ADR-014 — Provider adapter pattern
Context: Systems 2/3; no permanent brand assumptions. Decision: four ports
(Architect / CodingAgent / Reviewer / Verification); adapters declare
identity, capabilities, enforcement levels; routing is manual/default in
MVP. Consequences: Hermes/others are additive; capability-based routing
slots behind the same assignment interface.

## ADR-015 — Simulation strategy
Context: July 24 demo must be real mechanism, zero paid calls, zero fake
claims. Decision: deterministic simulation adapters implementing the same
ports, every output stamped `provenance: simulated`, runs stamped
`provenanceProfile`; simulation declares simulated-vs-enforced policies.
Consequences: the demo exercises the true core; truthfulness holds on
stage; adapter contract tests are shared with future live adapters.

## ADR-016 — Local persistence direction
Context: canonical state must outlive processes; browser localStorage
(prototype) is disqualified; no new dependencies wanted. Decision:
repository ports in relay-storage; Prompt 2 in-memory; the persistence
prompt implements append-only JSONL event log + JSON projections under a
project-local `.relay/` directory using node builtins; SQLite reconsidered
only with repository evidence of need. Consequences: zero deps; files are
user-ownable and diffable; migration path is projection rebuild.

## ADR-017 — Worktree-isolation requirement
Context: Decisions 1/6; a live coding agent without containment can touch
anything. Decision: the isolated worktree manager (creation, containment,
protected-path diff inspection, command allowlist, cancellation, crash
recovery) is a hard precondition for ANY live coding-agent adapter; its
safety tests gate the stretch goal. Consequences: the live demo is
gated by safety, not by ambition; enforcement matrix's "E" column for
local adapters is real.

## ADR-018 — UI as a Relay Core client
Context: Decision 9; UI_VISION.md. Decision: CLI/desktop/mobile consume
serializable commands/queries/events/read models only; no state
transitions, completion, routing, policy, repair, or promotion logic in
clients; Mission Control displays state, never invents it. Consequences:
one core, many faces; client boundary tests are source-level assertions.

## ADR-019 — Prototype preservation and supersession
Context: Decision 7; the golden-path web app is valuable but not the
architecture. Decision: keep it committed and labeled "Relay Protocol
Prototype"; do not delete during this phase; classify its pasted evidence
`unverified claim` permanently; reuse its validators/gate predicates/test
patterns as seeds; mark RELAY_STATUS.md and RELAY_INTEGRATION.md
superseded with headers, not deletion. Consequences: history and demo
value preserved; no ambiguity about what is authoritative.

## ADR-020 — Task creation follows blueprint acceptance
Context: the addendum's literal workflow reads "objective → Canonical Task
Contract → Prompt Architect Blueprint", but the Canonical Task Contract
derives from the accepted Blueprint's `taskBreakdown`, and the run state
machine orders phases blueprint → handoff → implementation. Decision: the
owned RelayTask is created AFTER `accept-blueprint`; blueprint reports are
run-level (no taskId/packageId — PROTOCOL §1.3). This is a deliberate
refinement of the addendum's literal ordering, applied identically in
RELAY_MVP_SPEC §4, ARCHITECTURE §5, PROTOCOL §2.3, TEST_STRATEGY §11.
Consequences: tasks always trace to an accepted blueprint; no phantom
architect-phase task is needed; the founder may re-order only by amending
this ADR.

## ADR-021 — Marble supplies the backdrop; Unreal owns everything with consequences
Context: World Labs Marble can generate the founder's reference world from an
image, but what it returns is a single-viewpoint reconstruction — a shell whose
measured parallax tolerance is 1.7 m at native scale, with the lighting baked
into an unlit texture. Decision: Marble is a VISUAL layer only, imported with
collision disabled and tagged; it is anchored at the arrival camera and scaled
x6, which is free because uniform scaling about the reconstruction viewpoint
leaves every ray from that camera unchanged — and the ground-plane offset is
deliberately NOT applied with it, because translation is the one operation that
breaks that invariance. Unreal keeps collision, navigation, Relay Dogs, Compound
Agents, multiplayer, interactions and GVE. Marble never generates Relay Dogs,
enforced by an image-attestation gate rather than by a text instruction: a text
instruction was already tried and cost 1,580 credits when image conditioning
beat it. Splats are downloaded and not imported — UE 5.8 has no native splat
renderer here and nothing has measured one. Consequences: the far distance stops
being authored primitives; the parallax limit is permanent and the answer to it
is more authored geometry, never a larger shell; the shell is convincing from
HeroCam0 and less so off-axis. Full record, with the rejected alternatives and
the measurements behind each: ADR-021-MARBLE-IS-A-BACKDROP.md.

## Dependency analysis (Decision requirement — no dependencies added this phase)

| Proposed dependency | Why considered | Existing equivalent | Security/maintenance | Verdict |
| --- | --- | --- | --- | --- |
| zod (schema validation) | contract validation | hand-rolled validators (prototype-proven, repo convention) | new supply-chain surface; version churn | **rejected** (ADR-009) |
| SQLite (better-sqlite3) | durable storage | node builtins + JSONL/JSON (ADR-016) | native build complexity | **deferred** — revisit only with evidence |
| CLI framework (commander/yargs) | argument parsing | `node:util.parseArgs` builtin | unnecessary surface | **rejected** for MVP |
| EventEmitter/stream libs | event feed | node builtins | unnecessary | **rejected** |
| esbuild (CLI bundling) | build the CLI | **already a repo dependency** (backend build) | none new | **reuse** |
| vitest | tests | already present | none new | **reuse** |

**Dependencies added this phase: none. Proposed for later phases: none —
every MVP need is covered by builtins or existing repo dependencies.**
