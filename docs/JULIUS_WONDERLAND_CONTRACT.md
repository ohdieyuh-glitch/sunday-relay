# The Julius → Wonderland contract

**What this is.** The read surface Wonderland may draw a Julius mission from, and
the rule that governs it: **the Julius runtime is authoritative and the UI is a
consumer.** Wonderland renders what this surface says. It never derives a
conclusion Julius did not reach, and it never holds state Julius does not hold.

**What this is not.** It is not a Wonderland change. No file under `wonderland/`
is touched by it, and none needs to be: this document plus
`JuliusRuntimeApi.inspectSlots` is the interface, so the session that owns the
Wonderland client can consume it without a merge against this lane.

---

## The surface

Everything is on `src/relay/mission/julius/julius-runtime-api.ts`
(`JuliusRuntimeApi`). It is transport-neutral on purpose — no HTTP, no
framework, no serialization — and every method takes an identity as its FIRST
argument and refuses before it reads anything.

| What Wonderland must represent | Where it comes from | State today |
|---|---|---|
| mission state | `inspectRun` → `JuliusRunView.state` | **served by the API** |
| C.A.R.D. lifecycle | `JuliusRunView.cardRevision`, `missionContractRevision` | revisions only; the policy body is not exposed |
| Prompt Architect state | `inspectSlots` → `JuliusSlotView` | **new** |
| Coding Agent state | `inspectSlots` → `JuliusSlotView` | **new** |
| Independent Reviewer state | `inspectSlots` → `JuliusSlotView` | **new** |
| provider identity | `JuliusSlotView.providerId`, `requestedModel`, `servedModel` | **new**, and null where the provider was silent |
| usage / cost where known | `JuliusSlotView.knownUsdMicros` + `costComplete` + `unknownCostComponents` | **new**, as a FLOOR |
| errors | `JuliusSlotView.lastFailureClass`, plus `timeline` | **new** per slot |
| evidence | `inspectEvidence` | served |
| verification | `inspectVerification` | served |
| repair | `inspectTasks` (a repair is a task; `repair:<stage>` is its type) | served |
| completion | `inspectRun` → state `COMPLETED`, and `run.completed` on the timeline | served |
| Project Brain references | `JuliusRunView.projectBrainRevision` | a revision only; entries are not exposed |
| C.A.R.D. slot occupancy history | `timeline` | raw rows |

## The four rules a client must implement, because the shape enforces them

1. **`null` is Unknown and renders as Unknown.** Never `0`, never a default,
   never the requested model shown as the served one. Every nullable field in
   `JuliusSlotView` is nullable because the runtime genuinely may not know.
2. **A cost is a FLOOR unless `costComplete` is true.** Paid run 34414726976
   settled $0.608861 on a mission whose architect and both reviewer calls
   reported nothing. A client that sums `knownUsdMicros` across slots and labels
   it a total publishes a figure three components short. Label it "at least".
3. **`NEVER_DISPATCHED` is a state, not an empty row.** Early in a mission two of
   three slots are in it. A client that draws an empty row as "idle" tells the
   founder a worker is waiting when nothing has ever asked it to work.
4. **Ordering is `sequence`, never `occurredAt`.** Several events of one mission
   routinely land in the same millisecond, and a wall-clock sort has no
   deterministic tiebreak. `lastSequence` is the ledger position the store
   allocates on append.

## How it is served

**`GET /relay-api/julius/runs/<runId>/<view>`** on the bridge, where `<view>` is
one of `run`, `slots`, `tasks`, `evidence`, `verification`, `timeline`.
Operator `Bearer` credential; `X-Relay-Tenant` and `X-Relay-Project` headers name
the scope, never the path. Read-only: any other method answers 405.

**Every answer is `JuliusRuntimeApi`'s own, verbatim.** `relay-bridge/julius-state-routes.ts`
maps a path to a method and a refusal to a status code, and computes nothing
about a mission. The API is composed over the SAME `createJuliusPostgresRuntimeStore`
the mission job writes through, so there is still exactly one state authority —
Julius's durable rows — and this is a second READER of it, not a second writer
and not a second opinion.

**With no `DATABASE_URL` the family answers 503 and names the variable.** It never
answers an empty run. "No durable state is reachable from this process" and "this
mission has done nothing" are different facts, and a client that confused them
would tell a founder their mission had done nothing. This is the one deployment
decision the mount needed — the long-lived HTTP server now holds a read
connection to Julius's store when configured — and it is made fail-closed rather
than assumed.

**Refusals a client will see and must render as what they are:** `401
operator_required`; `503 julius_state_unavailable` (with the missing variable);
`404 run_not_found` — and a run that exists but belongs to another project
answers the same 404, deliberately, so the route cannot be used to enumerate
other tenants' run ids.

## What is NOT served yet, and what it would take

**A browser session cannot read it yet.** The operator credential governs this
surface because it already governs everything that spends money; which fields a
browser session may see — `providerId` among them — is a product decision that
comes after the mount, not before it. Wonderland's own client reaches the bridge
through the operator path today.

**Control is not mounted.** Pause, resume, cancel and approval decisions exist on
the API and are deliberately not served: they change a run, and a run is changed
by the process that owns it. `approvers` refuses every approval for the same
reason.

Two further gaps, both recorded rather than worked around:

- **Provider qualification is not on the slot view.** `juliusProviderQualification`
  lives in `src/relay/mission/role-slots`, which is a Relay concern; Julius does
  not import it, because Julius core must not depend on a Relay feature. A
  client that wants to show "VERIFIED / COMPATIBLE / UNSUPPORTED" beside a slot
  joins `JuliusSlotView.servedModel` to the registry itself. That join belongs in
  the bridge, one layer above both.
- **Project Brain entries are not exposed.** Only the revision is. An entry
  carries text a worker was shown, and what a browser may read of it is the same
  authenticated-surface decision as above.

## The stability promise

`JuliusSlotView` is additive-only. A field may be added; none will change
meaning, and none will stop being nullable. `state` is a closed set
(`NEVER_DISPATCHED` / `ACTIVE` / `IDLE` / `FAILED`) and a new member would be a
breaking change announced here. `role` is the three permanent peers and never a
`SPECIALIST:*` — a specialist is a bounded child of a slot, and
`inspectSubagents` is where its record lives.
